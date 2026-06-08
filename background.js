// MV3 service worker: holds a Binance futures WebSocket, pushes the latest
// quote to the toolbar badge + tooltip, and caches a snapshot for the popup.
import {
  formatBadgePrice, formatPrice, formatPct, formatFunding,
  fundingCountdown, isStale, UP, DOWN, STALE,
} from './format.js';

const WS_URL =
  'wss://fstream.binance.com/stream?streams=btcusdt@ticker/btcusdt@markPrice@1s';
const STALE_MS = 10000;

let ws = null;
let reconnectDelay = 1000; // exponential backoff, capped at 30s

let snap = {
  price: null, changePct: null, high: null, low: null,
  fundingRate: null, nextFundingTime: null, markPrice: null,
  updatedAt: 0, connected: false,
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
  snap.updatedAt = Date.now();
  snap.connected = true;
  applyBadge();
  persist();
}

function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => { reconnectDelay = 1000; snap.connected = true; };
  ws.onmessage = handleMessage;
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onclose = () => {
    snap.connected = false;
    applyBadge();
    persist();
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  // Fires while the worker is alive; the periodic alarm below is the safety net
  // if the worker was suspended in between.
  setTimeout(ensureConnected, delay);
}

function ensureConnected() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  connect();
}

// markPrice@1s keeps the worker alive while connected; this alarm revives it and
// reconnects if Chrome suspended the worker, and refreshes the stale indicator.
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { ensureConnected(); applyBadge(); });

chrome.runtime.onInstalled.addListener(ensureConnected);
chrome.runtime.onStartup.addListener(ensureConnected);

// Explicit fallback for the popup if storage.session is empty.
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.type === 'getSnap') sendResponse({ snap });
  return false;
});

// Kick off on every worker start.
ensureConnected();
applyBadge();
