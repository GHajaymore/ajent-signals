// Fetches real historical OHLC candles (15-minute bars over a ~1-month window)
// for real indicator computation. A higher timeframe than 5m gives a much
// better signal-to-noise ratio and a naturally larger ATR, so stops sit outside
// the quote-feed noise. Same public feed + CORS-proxy chain as liveData.js —
// unofficial and best-effort, not a licensed data source.

import { fetchServerCandles, backendConfigured } from './backendApi.js';

const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

export async function fetchCandles(yahooSymbol, { interval = '15m', range = '1mo', minCandles = 30, appSymbol = null } = {}) {
  // Prefer the Worker: it fetches Yahoo server-side (no browser CORS, edge-cached)
  // using the SAME instrument the strategy trades, so the chart is reliable and on
  // the right scale. Falls back to the (usually dead) public proxies only if the
  // backend isn't available.
  if (appSymbol) {
    try {
      const srv = await fetchServerCandles(appSymbol, interval, range);
      if (srv && srv.length >= minCandles) return srv;
    } catch (e) { /* fall through */ }
  }
  // The public CORS proxies are dead (corsproxy.io → 401, allorigins → CORS), so
  // once the Worker backend is configured there's no working browser-side fallback.
  // Fail cleanly instead of spamming dead-proxy requests — the chart then shows its
  // "history unavailable" state (only non-server symbols reach here anyway).
  if (backendConfigured()) throw new Error(`no server candles for ${appSymbol || yahooSymbol}`);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const res = await fetch(wrap(url), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result || !result.timestamp) throw new Error('no candle data in response');
      const ts = result.timestamp;
      const q = result.indicators.quote[0];
      const candles = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) continue;
        candles.push({ t: ts[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
      }
      if (candles.length < minCandles) throw new Error('too few usable candles');
      return candles;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all proxies failed');
}
