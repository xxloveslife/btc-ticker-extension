// MV3 service worker: tracks the selected symbol (BTCUSDT / XAUUSDT), holds a
// Binance futures WebSocket (fast path), falls back to REST + an offscreen
// poller, and pushes the latest quote to the toolbar badge + tooltip + popup.
import {
  formatBadgePrice, formatPrice, formatPct, formatFunding,
  fundingCountdown, isStale, UP, DOWN, STALE,
} from './format.js';

const SYMBOLS = {
  BTCUSDT: { label: 'BTC' },
  ETHUSDT: { label: 'ETH' },
  SOLUSDT: { label: 'SOL' },
  BNBUSDT: { label: 'BNB' },
  XAUUSDT: { label: 'XAU' },
};
const DEFAULT_SYMBOL = 'BTCUSDT';
const STALE_MS = 10000;

const MAX_WS_FAILURES = 3; // give up on the WS after this many consecutive fails

let symbol = DEFAULT_SYMBOL;
let ws = null;
let reconnectDelay = 1000; // exponential backoff, capped at 30s
let wsFailures = 0;
let wsDisabled = false; // proxy/network blocks wss -> stop retrying, use REST only

function freshSnap(sym) {
  return {
    symbol: sym, price: null, changePct: null, high: null, low: null,
    fundingRate: null, nextFundingTime: null, markPrice: null,
    updatedAt: 0, connected: false, source: null,
  };
}
let snap = freshSnap(symbol);

const lower = (s) => s.toLowerCase();
const streamUrl = (s) =>
  `wss://fstream.binance.com/stream?streams=${lower(s)}@ticker/${lower(s)}@markPrice@1s`;
const tickerUrl = (s) => `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${s}`;
const premiumUrl = (s) => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`;
const labelOf = (s) => (SYMBOLS[s] && SYMBOLS[s].label) || s;

function persist() {
  chrome.storage.session.set({ snap }).catch(() => {});
}

function applyBadge() {
  const now = Date.now();
  const stale = !snap.connected || snap.price == null || isStale(snap.updatedAt, now, STALE_MS);
  if (stale) {
    chrome.action.setBadgeText({ text: '—' });
    chrome.action.setBadgeBackgroundColor({ color: STALE });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });
    chrome.action.setTitle({ title: `${labelOf(symbol)} 永续 · 重连中 / 数据延迟` });
    return;
  }
  chrome.action.setBadgeText({ text: formatBadgePrice(snap.price) });
  chrome.action.setBadgeBackgroundColor({ color: snap.changePct >= 0 ? UP : DOWN });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });

  const lines = [`${labelOf(symbol)}永续  $${formatPrice(snap.price)}   ${formatPct(snap.changePct)}`];
  if (snap.fundingRate != null) {
    lines.push(`资金费率 ${formatFunding(snap.fundingRate)} · ${fundingCountdown(snap.nextFundingTime, now)}`);
  }
  chrome.action.setTitle({ title: lines.join('\n') });
}

function commit(source) {
  snap.symbol = symbol;
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
  if (stream.indexOf(lower(symbol)) !== 0) return; // message for a symbol we left

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
  if (wsDisabled) return;
  try {
    ws = new WebSocket(streamUrl(symbol));
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => { console.log('[btc] ws open', symbol); reconnectDelay = 1000; wsFailures = 0; };
  ws.onmessage = handleMessage;
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onclose = () => {
    applyBadge();
    wsFailures += 1;
    if (wsFailures >= MAX_WS_FAILURES) {
      wsDisabled = true; // network blocks wss; REST + offscreen keep things fresh
      console.log('[btc] WebSocket blocked here; falling back to REST polling (this is fine).');
      return;
    }
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  setTimeout(ensureConnected, delay);
}

function ensureConnected() {
  if (wsDisabled) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  connect();
}

// ---- REST fallback + offscreen poller ----

// Merge a REST ticker + premiumIndex pair (for `sym`) into the snapshot.
function applyQuote(sym, t, p) {
  if (sym !== symbol) return; // a poll for the symbol we just switched away from
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
  const sym = symbol;
  try {
    const [t, p] = await Promise.all([
      fetch(tickerUrl(sym)).then((r) => r.json()),
      fetch(premiumUrl(sym)).then((r) => r.json()),
    ]);
    applyQuote(sym, t, p);
  } catch (e) {
    applyBadge();
  }
}

async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Poll Binance REST every few seconds to keep the toolbar badge and tooltip fresh.',
    });
  } catch (e) {
    // already exists — safe to ignore
  }
}

// ---- Symbol switching ----

function setSymbol(newSym) {
  if (!SYMBOLS[newSym] || newSym === symbol) return;
  symbol = newSym;
  snap = freshSnap(symbol);
  applyBadge();          // show "—" immediately, no stale cross-symbol price
  persist();
  try { if (ws) ws.close(); } catch {}
  ws = null;
  reconnectDelay = 1000;
  ensureConnected();
  pollRest();            // fast fresh data for the new symbol
}

// ---- Wiring (listeners registered synchronously at top level) ----

chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  ensureConnected();
  ensureOffscreen();
  if (isStale(snap.updatedAt, Date.now(), STALE_MS)) pollRest();
  applyBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.symbol && changes.symbol.newValue) {
    setSymbol(changes.symbol.newValue);
  }
});

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req && req.type === 'quote') { applyQuote(req.symbol, req.t, req.p); return false; }
  if (req && req.type === 'getSnap') { sendResponse({ snap }); return false; }
  return false;
});

// Kick off on every worker start: load the saved symbol, then connect + poll.
chrome.storage.local.get('symbol').then((res) => {
  if (res && res.symbol && SYMBOLS[res.symbol]) symbol = res.symbol;
  snap = freshSnap(symbol);
  ensureConnected();
  ensureOffscreen();
  pollRest();
  applyBadge();
});
