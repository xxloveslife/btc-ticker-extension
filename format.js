// Pure, dependency-free formatting + helper functions.
// Imported by background.js (service worker), popup.js, and the node test suite.
// Keep this file free of any chrome.* / DOM / WebSocket references so it stays unit-testable.

export const UP = '#0ecb81';    // Binance-style green
export const DOWN = '#f6465d';  // Binance-style red
export const STALE = '#888888'; // grey when disconnected / data delayed

// Compact price for the toolbar badge (Chrome shows ~4 chars comfortably).
//   68432.5 -> "68.4"   104210 -> "104k"   6842 -> "6.84"
export function formatBadgePrice(price) {
  if (!isFinite(price) || price <= 0) return '—';
  if (price >= 100000) return Math.round(price / 1000) + 'k'; // 104k
  if (price >= 10000) return (price / 1000).toFixed(1);        // 68.4 (BTC)
  if (price >= 1000) return String(Math.round(price));         // 4310 (XAU)
  if (price >= 1) return price.toFixed(0);
  return price.toPrecision(2);
}

// Full price with thousands separators: 68432.5 -> "68,432.5"
export function formatPrice(price) {
  if (!isFinite(price)) return '--';
  const dp = price >= 1000 ? 1 : price >= 1 ? 2 : 4;
  return price.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Signed 24h change percent (input is already a percent number from the ticker stream).
export function formatPct(p) {
  if (!isFinite(p)) return '--';
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}

// Funding rate (input is a fraction, e.g. 0.0001) -> "+0.0100%"
export function formatFunding(rate) {
  if (!isFinite(rate)) return '--';
  const pct = rate * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(4) + '%';
}

// Human countdown until the next funding settlement.
export function fundingCountdown(nextMs, nowMs) {
  if (!nextMs || !isFinite(nextMs)) return '';
  let s = Math.floor((nextMs - nowMs) / 1000);
  if (s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}时${String(m).padStart(2, '0')}分后结算`;
  if (m > 0) return `${m}分${String(ss).padStart(2, '0')}秒后结算`;
  return `${ss}秒后结算`;
}

// True when the snapshot is missing or older than thresholdMs.
export function isStale(updatedAt, nowMs, thresholdMs = 10000) {
  return !updatedAt || (nowMs - updatedAt) > thresholdMs;
}

// Candle interval string -> milliseconds (the timeframes we support).
export function intervalToMs(interval) {
  const m = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  return m[interval] || 0;
}

// Time until the current candle closes. Binance candle boundaries are UTC-aligned
// and each supported interval evenly divides the epoch, so this is exact.
export function candleCloseRemainingMs(intervalMs, nowMs) {
  if (!intervalMs) return 0;
  return intervalMs - (nowMs % intervalMs);
}

// ms -> "MM:SS", or "H:MM:SS" once it exceeds an hour.
export function formatDuration(ms) {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); const ss = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// Exponential moving average over `values`, seeded with the SMA of the first
// `period` points. Returns an array the same length as values; entries before
// enough data are null (so the line starts once it's meaningful).
export function computeEMA(values, period) {
  const out = new Array(Array.isArray(values) ? values.length : 0).fill(null);
  if (!Array.isArray(values) || period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += values[i];
  let prev = sma / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
