import {
  formatPrice, formatPct, formatFunding, fundingCountdown, isStale, computeEMA,
  intervalToMs, candleCloseRemainingMs, formatDuration,
} from './format.js';
// LightweightCharts is loaded as a global by vendor/lightweight-charts...js (classic script).

const SYMBOLS = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', SOLUSDT: 'SOL', BNBUSDT: 'BNB', XAUUSDT: 'XAU' };
const DEFAULT_SYMBOL = 'BTCUSDT';

// Standard candle intervals (like any trading app), each showing ~120 candles.
const TF = {
  '5m':  { interval: '5m',  limit: 120 },
  '15m': { interval: '15m', limit: 120 },
  '1h':  { interval: '1h',  limit: 120 },
  '4h':  { interval: '4h',  limit: 120 },
  '1d':  { interval: '1d',  limit: 120 },
};

const tickerUrl = (s) => `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${s}`;
const premiumUrl = (s) => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`;
const klinesUrl = (s, interval, limit) =>
  `https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=${interval}&limit=${limit}`;

let currentSymbol = DEFAULT_SYMBOL;
let currentTf = '5m';
let snap = null;
let lastWsAt = 0;

const EMA_PERIOD = 20;
let chart = null;
let series = null;
let emaSeries = null;
let chartLoadSeq = 0; // only the latest loadChart() may render (race guard)

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Time left until the current candle of the selected timeframe closes.
function renderCandleCountdown() {
  const ms = candleCloseRemainingMs(intervalToMs(TF[currentTf].interval), Date.now());
  $('ccd').textContent = '收盘 ' + formatDuration(ms);
}

function clearHeader() {
  $('price').textContent = '--';
  $('change').textContent = '--'; $('change').className = 'change';
  $('funding').textContent = '--'; $('funding').className = 'v';
  $('countdown').textContent = '--';
  $('high').textContent = '--'; $('low').textContent = '--';
}

// REST refresh so the header always shows fresh data even if the background WS
// is down. Runs every 5s while the popup is open; WS pushes interleave.
async function loadRestSnapshot() {
  if (wsLive()) return;
  const sym = currentSymbol;
  try {
    const [t, p] = await Promise.all([
      fetch(tickerUrl(sym)).then((r) => r.json()),
      fetch(premiumUrl(sym)).then((r) => r.json()),
    ]);
    if (sym !== currentSymbol) return; // user switched mid-fetch
    snap = {
      symbol: sym,
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
  emaSeries = chart.addLineSeries({
    color: '#f0b90b', // Binance gold
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
}

async function loadChart(sym, tf) {
  const myId = ++chartLoadSeq; // newest call wins; older in-flight loads abort
  const cfg = TF[tf];
  const msg = $('chartMsg');
  msg.style.display = 'none';

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(klinesUrl(sym, cfg.interval, cfg.limit));
      if (myId !== chartLoadSeq) return; // superseded by a newer switch
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      if (myId !== chartLoadSeq) return;

      ensureChart();
      const el = $('chart');
      if (el.clientWidth) chart.resize(el.clientWidth, el.clientHeight); // size safety

      // lightweight-charts renders time as UTC. Shift each timestamp by the local
      // timezone offset so the axis + crosshair read in the user's local time
      // (Beijing/UTC+8 here). Per-candle offset handles DST for non-CN zones too.
      const data = raw.map((k) => ({
        time: Math.floor(k[0] / 1000) - new Date(k[0]).getTimezoneOffset() * 60,
        open: +k[1], high: +k[2], low: +k[3], close: +k[4],
      }));
      series.setData(data);

      const ema = computeEMA(data.map((d) => d.close), EMA_PERIOD);
      const emaData = [];
      for (let i = 0; i < data.length; i++) {
        if (ema[i] != null) emaData.push({ time: data[i].time, value: ema[i] });
      }
      emaSeries.setData(emaData);

      // Reset both axes — without this, a manually-dragged price scale stays
      // pinned to the previous symbol's range and the new candles render
      // off-screen (black chart), since fitContent() only fits the time axis.
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
      return; // success
    } catch (e) {
      if (myId !== chartLoadSeq) return; // superseded — stay quiet
      if (attempt < 2) {
        await sleep(350); // transient (proxy/timeout) — back off and retry
        if (myId !== chartLoadSeq) return;
      } else {
        msg.textContent = '图表加载失败,点击重试';
        msg.style.display = 'flex';
      }
    }
  }
}

function setActive(barId, predicate) {
  [...$(barId).querySelectorAll('button')].forEach((b) => b.classList.toggle('active', predicate(b)));
}

function switchSymbol(sym) {
  if (sym === currentSymbol) return;
  currentSymbol = sym;
  setActive('symbar', (b) => b.dataset.sym === sym);
  chrome.storage.local.set({ symbol: sym }); // background + offscreen follow this
  snap = null;
  lastWsAt = 0;
  clearHeader();
  loadRestSnapshot();
  loadChart(currentSymbol, currentTf);
}

function initBars() {
  $('symbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) switchSymbol(b.dataset.sym);
  });
  $('tf').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    currentTf = b.dataset.tf;
    setActive('tf', (x) => x === b);
    renderCandleCountdown();
    loadChart(currentSymbol, currentTf);
  });
  $('chartMsg').addEventListener('click', () => loadChart(currentSymbol, currentTf));
}

async function init() {
  initBars();

  // restore saved symbol
  try {
    const { symbol } = await chrome.storage.local.get('symbol');
    if (symbol && SYMBOLS[symbol]) currentSymbol = symbol;
  } catch {}
  setActive('symbar', (b) => b.dataset.sym === currentSymbol);

  // instant render from the background's cached snapshot (same symbol only)
  try {
    const { snap: s } = await chrome.storage.session.get('snap');
    if (s && s.price != null && s.symbol === currentSymbol) {
      snap = s; renderSnap(); renderCountdown();
    }
  } catch {}

  // live updates from the background, applied when fresher and same symbol
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.snap && changes.snap.newValue) {
      const v = changes.snap.newValue;
      if (v.symbol === currentSymbol && v.price != null && (!snap || v.updatedAt >= snap.updatedAt)) {
        if (v.source === 'ws') lastWsAt = Date.now();
        snap = v;
        renderSnap();
      }
    }
  });

  loadRestSnapshot();
  setInterval(loadRestSnapshot, 5000);
  setInterval(renderCountdown, 1000);
  renderCandleCountdown();
  setInterval(renderCandleCountdown, 1000);

  loadChart(currentSymbol, currentTf);
}

init();
