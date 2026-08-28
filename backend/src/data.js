// Market data with a pluggable provider. Switching feeds is a one-key change:
//   DATA_PROVIDER=yahoo        (default, no key — good to start, unofficial)
//   DATA_PROVIDER=twelvedata   + DATA_API_KEY=<key>   (real feed, free tier)
// Add a provider by writing one async function that returns { candles, live }.
//
// candles: [{ t, o, h, l, c }] oldest -> newest.  live: current price.

const PROVIDER = (process.env.DATA_PROVIDER || 'yahoo').toLowerCase();
const KEY = process.env.DATA_API_KEY || '';

// Pick the provider's ticker for a market (markets.js carries per-provider ids;
// falls back to the Yahoo symbol so an unmapped market still resolves).
function symbolFor(market) {
  if (PROVIDER === 'twelvedata') return market.td || market.yahoo;
  return market.yahoo;
}

async function yahoo(symbol, { range = '2y' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-backend/1.0' } });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status} for ${symbol}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r) throw new Error(`yahoo: no data for ${symbol}`);
  const q = r.indicators.quote[0], ts = r.timestamp || [], out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
    out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  const live = r.meta?.regularMarketPrice;
  return { candles: out, live: typeof live === 'number' ? live : (out.length ? out[out.length - 1].c : null) };
}

async function twelvedata(symbol, { outputsize = 520 } = {}) {
  if (!KEY) throw new Error('DATA_API_KEY is required for DATA_PROVIDER=twelvedata');
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&order=ASC&apikey=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`twelvedata HTTP ${res.status} for ${symbol}`);
  const j = await res.json();
  if (j.status === 'error') throw new Error(`twelvedata: ${j.message || 'error'} (${symbol})`);
  const out = (j.values || []).map((v) => ({ t: new Date(v.datetime).getTime(), o: +v.open, h: +v.high, l: +v.low, c: +v.close }))
    .filter((k) => Number.isFinite(k.c) && Number.isFinite(k.h) && Number.isFinite(k.l));
  return { candles: out, live: out.length ? out[out.length - 1].c : null };
}

const PROVIDERS = { yahoo, twelvedata };

// market: the object from markets.js (has .yahoo, optional .td).
async function fetchDailyCandles(market, opts = {}) {
  const fn = PROVIDERS[PROVIDER] || yahoo;
  return fn(symbolFor(market), opts);
}

module.exports = { fetchDailyCandles, PROVIDER };
