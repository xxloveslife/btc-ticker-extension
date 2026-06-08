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
  if (price >= 100000) return Math.round(price / 1000) + 'k';
  if (price >= 10000) return (price / 1000).toFixed(1);
  if (price >= 1000) return (price / 1000).toFixed(2);
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

// Binance REST kline rows -> {t,o,h,l,c} candles.
export function klinesToCandles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
}
