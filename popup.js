import {
  formatPrice, formatPct, formatFunding, fundingCountdown,
  klinesToCandles, isStale,
} from './format.js';
import { drawCandles } from './chart.js';

// Standard candle intervals (like any trading app), each showing ~120 candles.
const TF = {
  '5m':  { interval: '5m',  limit: 120 },
  '15m': { interval: '15m', limit: 120 },
  '1h':  { interval: '1h',  limit: 120 },
  '4h':  { interval: '4h',  limit: 120 },
  '1d':  { interval: '1d',  limit: 120 },
};

const TICKER_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT';
const PREMIUM_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT';

let currentTf = '15m';
let snap = null;

const $ = (id) => document.getElementById(id);

function renderSnap() {
  if (!snap) return;
  if (snap.price != null) $('price').textContent = '$' + formatPrice(snap.price);
  if (snap.changePct != null) {
    const el = $('change');
    el.textContent = formatPct(snap.changePct);
    el.className = 'change ' + (snap.changePct >= 0 ? 'up' : 'down');
  }
  if (snap.fundingRate != null) {
    const f = $('funding');
    f.textContent = formatFunding(snap.fundingRate);
    f.className = 'v ' + (snap.fundingRate >= 0 ? 'up' : 'down');
  }
  if (snap.high != null) $('high').textContent = '$' + formatPrice(snap.high);
  if (snap.low != null) $('low').textContent = '$' + formatPrice(snap.low);

  const live = !isStale(snap.updatedAt, Date.now());
  $('dot').className = 'dot' + (live ? ' live' : '');
}

function renderCountdown() {
  if (snap && snap.nextFundingTime) {
    $('countdown').textContent = fundingCountdown(snap.nextFundingTime, Date.now());
  }
}

// REST refresh so the header always shows fresh data even if the background WS
// is down. Runs every 5s while the popup is open; WS pushes (below) interleave.
async function loadRestSnapshot() {
  try {
    const [t, p] = await Promise.all([
      fetch(TICKER_URL).then((r) => r.json()),
      fetch(PREMIUM_URL).then((r) => r.json()),
    ]);
    snap = {
      price: parseFloat(t.lastPrice),
      changePct: parseFloat(t.priceChangePercent),
      high: parseFloat(t.highPrice),
      low: parseFloat(t.lowPrice),
      fundingRate: parseFloat(p.lastFundingRate),
      nextFundingTime: p.nextFundingTime,
      markPrice: parseFloat(p.markPrice),
      updatedAt: Date.now(),
      connected: true,
    };
    renderSnap();
    renderCountdown();
  } catch {}
}

async function loadChart(tf) {
  const cfg = TF[tf];
  const canvas = $('chart');
  const msg = $('chartMsg');
  msg.style.display = 'none';
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    const candles = klinesToCandles(raw);
    requestAnimationFrame(() => drawCandles(canvas, candles));
  } catch (e) {
    msg.textContent = '图表加载失败,点击重试';
    msg.style.display = 'flex';
  }
}

function initTabs() {
  const tf = $('tf');
  tf.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    currentTf = b.dataset.tf;
    [...tf.querySelectorAll('button')].forEach((x) => x.classList.toggle('active', x === b));
    loadChart(currentTf);
  });
  $('chartMsg').addEventListener('click', () => loadChart(currentTf));
}

async function init() {
  initTabs();

  // 1) instant render from the background's cached snapshot, if any
  try {
    const { snap: s } = await chrome.storage.session.get('snap');
    if (s && s.price != null) { snap = s; renderSnap(); renderCountdown(); }
  } catch {}

  // 2) live WS updates from the background, applied when they're fresher
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.snap && changes.snap.newValue) {
      const v = changes.snap.newValue;
      if (v.price != null && (!snap || v.updatedAt >= snap.updatedAt)) {
        snap = v;
        renderSnap();
      }
    }
  });

  // 3) REST refresh now + every 5s (header always fresh even if wss is blocked)
  loadRestSnapshot();
  setInterval(loadRestSnapshot, 5000);
  setInterval(renderCountdown, 1000);

  loadChart(currentTf);
}

init();
