// Market data with a pluggable provider (ESM). env carries DATA_PROVIDER +
// DATA_API_KEY. Returns { candles:[{t,o,h,l,c}] oldest->newest, live }.
async function yahoo(symbol, { range = '2y' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status} ${symbol}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r) throw new Error(`yahoo: no data ${symbol}`);
  const q = r.indicators.quote[0], ts = r.timestamp || [], out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
    out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  const live = r.meta?.regularMarketPrice;
  // The exchange timestamp of the live quote (ms). For free CME futures this is
  // the delayed quote's real time, so `now - liveTime` is the TRUE feed delay —
  // far better than assuming a fixed 15-min lag.
  const lt = r.meta?.regularMarketTime;
  return { candles: out, live: typeof live === 'number' ? live : (out.length ? out[out.length - 1].c : null), liveTime: typeof lt === 'number' ? lt * 1000 : null };
}

async function twelvedata(symbol, key) {
  if (!key) throw new Error('DATA_API_KEY required for twelvedata');
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=520&order=ASC&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`twelvedata HTTP ${res.status} ${symbol}`);
  const j = await res.json();
  if (j.status === 'error') throw new Error(`twelvedata: ${j.message} (${symbol})`);
  const out = (j.values || []).map((v) => ({ t: new Date(v.datetime).getTime(), o: +v.open, h: +v.high, l: +v.low, c: +v.close }))
    .filter((k) => Number.isFinite(k.c));
  return { candles: out, live: out.length ? out[out.length - 1].c : null, liveTime: null };
}

export async function fetchDailyCandles(market, env) {
  const provider = (env.DATA_PROVIDER || 'yahoo').toLowerCase();
  if (provider === 'twelvedata') return twelvedata(market.td || market.yahoo, env.DATA_API_KEY);
  return yahoo(market.yahoo);
}
