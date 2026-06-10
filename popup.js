import {
  formatPrice, formatPct, formatFunding, fundingCountdown, isStale,
} from './format.js';
// LightweightCharts is loaded as a global by vendor/lightweight-charts...js (classic script).

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

let currentTf = '5m';
let snap = null;
let lastWsAt = 0; // when the background last pushed a WS-sourced snapshot

const $ = (id) => document.getElementById(id);

function wsLive() {
  return Date.now() - lastWsAt < 6000;
}

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

  const fresh = !isStale(snap.updatedAt, Date.now());
  $('dot').className = 'dot' + (fresh ? ' live' : '');
  const src = $('src');
  if (wsLive()) { src.textContent = 'WS实时'; src.className = 'src ws'; }
  else { src.textContent = '轮询5s'; src.className = 'src'; }
}

function renderCountdown() {
  if (snap && snap.nextFundingTime) {
    $('countdown').textContent = fundingCountdown(snap.nextFundingTime, Date.now());
  }
}

// REST refresh so the header always shows fresh data even if the background WS
// is down. Runs every 5s while the popup is open; WS pushes (below) interleave.
async function loadRestSnapshot() {
  if (wsLive()) return; // WS is feeding live data; skip the redundant poll
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

let chart = null;
let series = null;

// Create the interactive TradingView lightweight chart once.
// Scroll = zoom time axis, drag = pan, drag price axis = scale high/low,
// double-click price axis = reset autoscale, crosshair shows OHLC.
function ensureChart() {
  if (chart) return;
  const el = $('chart');
  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { color: '#11151c' }, textColor: '#8b95a1', fontSize: 11 },
    grid: { vertLines: { color: '#1b222c' }, horzLines: { color: '#1b222c' } },
    rightPriceScale: { borderColor: '#2a3441' },
    timeScale: { borderColor: '#2a3441', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  series = chart.addCandlestickSeries({
    upColor: '#0ecb81', downColor: '#f6465d',
    wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    borderVisible: false,
  });
}

async function loadChart(tf) {
  const cfg = TF[tf];
  const msg = $('chartMsg');
  msg.style.display = 'none';
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=${cfg.interval}&limit=${cfg.limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    ensureChart();
    const data = raw.map((k) => ({
      time: Math.floor(k[0] / 1000), // ms -> UTCTimestamp seconds
      open: +k[1], high: +k[2], low: +k[3], close: +k[4],
    }));
    series.setData(data);
    chart.timeScale().fitContent();
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
        if (v.source === 'ws') lastWsAt = Date.now();
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
