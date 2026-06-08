import {
  formatPrice, formatPct, formatFunding, fundingCountdown,
  klinesToCandles, isStale,
} from './format.js';
import { drawCandles } from './chart.js';

const TF = {
  '1H': { interval: '1m', limit: 60 },
  '1D': { interval: '15m', limit: 96 },
  '1W': { interval: '1h', limit: 168 },
};

let currentTf = '1D';
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

  const live = snap.connected && !isStale(snap.updatedAt, Date.now());
  $('dot').className = 'dot' + (live ? ' live' : '');
}

function renderCountdown() {
  if (snap && snap.nextFundingTime) {
    $('countdown').textContent = fundingCountdown(snap.nextFundingTime, Date.now());
  }
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

  // Instant render from the background's cached snapshot.
  try {
    const { snap: s } = await chrome.storage.session.get('snap');
    if (s) { snap = s; renderSnap(); renderCountdown(); }
  } catch {}

  // Live updates while the popup is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.snap) {
      snap = changes.snap.newValue;
      renderSnap();
    }
  });

  setInterval(renderCountdown, 1000);
  loadChart(currentTf);
}

init();
