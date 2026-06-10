// MV3 service worker: holds a Binance futures WebSocket (fast path), falls back
// to REST polling when the WS can't connect (e.g. proxy blocks wss). Pushes the
// latest quote to the toolbar badge + tooltip and caches a snapshot for the popup.
import {
  formatBadgePrice, formatPrice, formatPct, formatFunding,
  fundingCountdown, isStale, UP, DOWN, STALE,
} from './format.js';

const WS_URL =
  'wss://fstream.binance.com/stream?streams=btcusdt@ticker/btcusdt@markPrice@1s';
const TICKER_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT';
const PREMIUM_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT';
const STALE_MS = 10000;

let ws = null;
let reconnectDelay = 1000; // exponential backoff, capped at 30s

let snap = {
  price: null, changePct: null, high: null, low: null,
  fundingRate: null, nextFundingTime: null, markPrice: null,
  updatedAt: 0, connected: false, source: null, // source: 'ws' | 'rest'
};

function persist() {
  // storage.session lets the popup render instantly and listen for live updates.
  chrome.storage.session.set({ snap }).catch(() => {});
}

function applyBadge() {
  const now = Date.now();
  const stale = !snap.connected || snap.price == null || isStale(snap.updatedAt, now, STALE_MS);
  if (stale) {
    chrome.action.setBadgeText({ text: '—' });
    chrome.action.setBadgeBackgroundColor({ color: STALE });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
    chrome.action.setTitle({ title: 'BTC 永续行情 · 重连中 / 数据延迟' });
    return;
  }
  chrome.action.setBadgeText({ text: formatBadgePrice(snap.price) });
  chrome.action.setBadgeBackgroundColor({ color: snap.changePct >= 0 ? UP : DOWN });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });

  const lines = [`BTC永续  $${formatPrice(snap.price)}   ${formatPct(snap.changePct)}`];
  if (snap.fundingRate != null) {
    lines.push(`资金费率 ${formatFunding(snap.fundingRate)} · ${fundingCountdown(snap.nextFundingTime, now)}`);
  }
  chrome.action.setTitle({ title: lines.join('\n') });
}

function commit(source) {
  snap.source = source;
  snap.updatedAt = Date.now();
  snap.connected = true;
  applyBadge();
  persist();
}

// ---- WebSocket (fast path) ----

function handleMessage(ev) {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  const data = msg && msg.data;
  const stream = msg && msg.stream;
  if (!data || !stream) return;

  if (stream.indexOf('ticker') !== -1) {
    snap.price = parseFloat(data.c);
    snap.changePct = parseFloat(data.P);
    snap.high = parseFloat(data.h);
    snap.low = parseFloat(data.l);
  } else if (stream.indexOf('markPrice') !== -1) {
    snap.markPrice = parseFloat(data.p);
    snap.fundingRate = parseFloat(data.r);
    snap.nextFundingTime = data.T;
    if (snap.price == null && isFinite(snap.markPrice)) snap.price = snap.markPrice;
  }
  commit('ws');
}

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => { console.log('[btc] ws open'); reconnectDelay = 1000; };
  ws.onmessage = handleMessage;
  ws.onerror = () => { console.log('[btc] ws error'); try { ws.close(); } catch {} };
  ws.onclose = (e) => {
    console.log('[btc] ws close', e && e.code, e && e.reason);
    applyBadge();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  setTimeout(ensureConnected, delay);
}

function ensureConnected() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  connect();
}

// ---- REST poll (fallback when wss is blocked or the WS is stale) ----

// Merge a REST ticker + premiumIndex pair into the snapshot.
function applyQuote(t, p) {
  snap.price = parseFloat(t.lastPrice);
  snap.changePct = parseFloat(t.priceChangePercent);
  snap.high = parseFloat(t.highPrice);
  snap.low = parseFloat(t.lowPrice);
  snap.fundingRate = parseFloat(p.lastFundingRate);
  snap.nextFundingTime = p.nextFundingTime;
  snap.markPrice = parseFloat(p.markPrice);
  commit('rest');
}

async function pollRest() {
  try {
    const [t, p] = await Promise.all([
      fetch(TICKER_URL).then((r) => r.json()),
      fetch(PREMIUM_URL).then((r) => r.json()),
    ]);
    applyQuote(t, p);
  } catch (e) {
    applyBadge();
  }
}

// Offscreen document keeps polling every few seconds (the service worker sleeps,
// it doesn't), so the badge + hover tooltip stay fresh without the WebSocket.
async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Poll Binance REST every few seconds to keep the toolbar badge and tooltip fresh.',
    });
  } catch (e) {
    // createDocument throws if one already exists — safe to ignore.
  }
}

// markPrice@1s keeps the worker alive while the WS is connected; this alarm
// revives the worker if Chrome suspended it, reconnects, and REST-polls whenever
// the WS data has gone stale so the badge keeps refreshing even without the WS.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  ensureConnected();
  ensureOffscreen(); // recreate the poller if it was torn down
  if (isStale(snap.updatedAt, Date.now(), STALE_MS)) pollRest();
  applyBadge();
});

chrome.runtime.onInstalled.addListener(ensureConnected);
chrome.runtime.onStartup.addListener(ensureConnected);

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.type === 'quote') { applyQuote(req.t, req.p); return false; }
  if (req && req.type === 'getSnap') { sendResponse({ snap }); return false; }
  return false;
});

// Kick off on every worker start: immediate REST snapshot, start the offscreen
// poller, and try the WS (which takes over at ~1s if it ever connects).
ensureConnected();
ensureOffscreen();
pollRest();
applyBadge();
