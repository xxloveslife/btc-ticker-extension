// Runs inside the offscreen document (a normal page context that, unlike the
// service worker, is not killed after 30s idle). It polls Binance REST for the
// currently-selected symbol every few seconds and pushes each quote to the
// service worker, keeping the badge + hover tooltip fresh without the WebSocket.
const tickerUrl = (s) => `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${s}`;
const premiumUrl = (s) => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`;
const POLL_MS = 3000;

async function poll() {
  try {
    const { symbol = 'BTCUSDT' } = await chrome.storage.local.get('symbol');
    const [t, p] = await Promise.all([
      fetch(tickerUrl(symbol), { cache: 'no-store' }).then((r) => r.json()),
      fetch(premiumUrl(symbol), { cache: 'no-store' }).then((r) => r.json()),
    ]);
    chrome.runtime.sendMessage({ type: 'quote', symbol, t, p });
  } catch (e) {
    // network blip; next tick will retry
  }
}

poll();
setInterval(poll, POLL_MS);
