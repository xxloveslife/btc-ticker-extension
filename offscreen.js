// Runs inside the offscreen document (a normal page context that, unlike the
// service worker, is not killed after 30s idle). It polls Binance REST every
// few seconds and pushes each quote to the service worker, which updates the
// toolbar badge + tooltip. This keeps the hover tooltip fresh-on-every-hover
// without depending on the WebSocket.
const TICKER_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT';
const PREMIUM_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT';
const POLL_MS = 3000;

async function poll() {
  try {
    const [t, p] = await Promise.all([
      fetch(TICKER_URL).then((r) => r.json()),
      fetch(PREMIUM_URL).then((r) => r.json()),
    ]);
    chrome.runtime.sendMessage({ type: 'quote', t, p });
  } catch (e) {
    // network blip; next tick will retry
  }
}

poll();
setInterval(poll, POLL_MS);
