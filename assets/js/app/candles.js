// Fetches real historical OHLC candles (15-minute bars over a ~1-month window)
// for real indicator computation. A higher timeframe than 5m gives a much
// better signal-to-noise ratio and a naturally larger ATR, so stops sit outside
// the quote-feed noise. Same public feed + CORS-proxy chain as liveData.js —
// unofficial and best-effort, not a licensed data source.

const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

export async function fetchCandles(yahooSymbol, { interval = '15m', range = '1mo', minCandles = 30 } = {}) {
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
