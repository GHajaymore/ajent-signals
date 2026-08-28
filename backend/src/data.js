// Server-side market data. No CORS (this is a server), so it's far more reliable
// than the browser's proxy chain. For production, replace this with a licensed
// feed (Alpaca / Twelve Data / Polygon) and read the key from process.env.
//
// Returns daily candles: [{ t, o, h, l, c }] oldest -> newest.
async function fetchDailyCandles(yahooSymbol, { range = '2y' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-backend/1.0' } });
  if (!res.ok) throw new Error(`data HTTP ${res.status} for ${yahooSymbol}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`no data for ${yahooSymbol}`);
  const q = r.indicators.quote[0], ts = r.timestamp || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
    out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  // meta.regularMarketPrice is the current (live) price for the forming day.
  const live = r.meta?.regularMarketPrice;
  return { candles: out, live: typeof live === 'number' ? live : (out.length ? out[out.length - 1].c : null) };
}

module.exports = { fetchDailyCandles };
