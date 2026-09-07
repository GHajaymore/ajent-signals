// PROBE (tests "we can make short-term profit BOTH ways"): the purest version — short-term
// mean-reversion with NO trend filter. Buy oversold (RSI2<15), short overbought (RSI2>85),
// quick exit back through the mean (RSI2 50), 2xATR stop, short hold. If capturing swings in
// BOTH directions is profitable, this is where it shows. Full cycles incl bears.
//   node test/shortterm-bothways.mjs
import { sma, rsi, atr } from '../src/indicators.js';

const RISK = 250, COST = 6;
const MARKETS = [
  { sym: 'S&P 500', y: '^GSPC', range: '10y' },
  { sym: 'Nasdaq', y: '^IXIC', range: '10y' },
  { sym: 'BTC', y: 'BTC-USD', range: '8y' },
  { sym: 'ETH', y: 'ETH-USD', range: '8y' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDaily(ySym, range, attempt = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=${range}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error('no result');
    const ts = res.timestamp || [], q = res.indicators.quote[0], out = [];
    for (let i = 0; i < ts.length; i++) { const c = q.close[i], h = q.high[i], l = q.low[i]; if (c == null || h == null || l == null) continue; out.push({ t: ts[i] * 1000, c, h, l }); }
    return out.length > 260 ? out : null;
  } catch (e) { if (attempt < 3) { await sleep(2500 * (attempt + 1)); return fetchDaily(ySym, range, attempt + 1); } return null; }
}

// mode: 'longMR' (long-only, in-uptrend — the production recipe), 'bothNoGate' (long RSI2<15
// AND short RSI2>85, NO trend filter), 'bothGated' (long only in uptrend, short only in downtrend).
function sim(candles, mode) {
  const closes = candles.map((x) => x.c);
  const r2 = rsi(closes, 2), s200 = sma(closes, 200), atrArr = atr(candles, 14);
  const closed = []; let pos = null;
  for (let i = 210; i < candles.length; i++) {
    const price = closes[i], a = atrArr[i], rsi2 = r2[i], trend = s200[i];
    if (a == null || rsi2 == null || trend == null || !(a > 0)) continue;
    if (pos) {
      const long = pos.side > 0;
      const stopHit = long ? price <= pos.stop : price >= pos.stop;
      const meanHit = long ? rsi2 > 50 : rsi2 < 50;           // quick short-term exit at the mean
      const tooOld = candles[i].t - pos.openedAt > 6 * 24 * 60 * 60000;
      if (stopHit || meanHit || tooOld) {
        const resultR = (pos.side * (price - pos.entry)) / pos.risk;
        closed.push({ resultR, pnl: Math.round(resultR * RISK - COST), closedAt: candles[i].t });
        pos = null;
      }
    }
    if (!pos) {
      const up = price > trend, down = price < trend;
      let side = 0;
      if (mode === 'longMR') { if (up && rsi2 < 15 && price < candles[i - 1].l) side = 1; }
      else if (mode === 'bothNoGate') { if (rsi2 < 15) side = 1; else if (rsi2 > 85) side = -1; }
      else if (mode === 'bothGated') { if (up && rsi2 < 15) side = 1; else if (down && rsi2 > 85) side = -1; }
      if (side) { const risk = Math.max(a * 2, price * 0.004); pos = { side, entry: price, stop: side > 0 ? price - risk : price + risk, risk, openedAt: candles[i].t }; }
    }
  }
  return closed;
}
function stats(t) {
  if (!t.length) return { n: 0, winRate: 0, pf: 0, pnl: 0, avgR: 0, maxDD: 0 };
  const w = t.filter((x) => x.pnl > 0), l = t.filter((x) => x.pnl < 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of [...t].sort((a, b) => a.closedAt - b.closedAt)) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)), avgR: +(t.reduce((s, x) => s + x.resultR, 0) / t.length).toFixed(3), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(4)} win=${String(s.winRate).padStart(3)}% pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(7)} net=$${String(s.pnl).padStart(7)} maxDD=$${String(s.maxDD).padStart(7)}` : '(no trades)';

console.log('\nSHORT-TERM MEAN-REVERSION BOTH WAYS (quick exit at the mean), full cycles\n');
const pooled = { longMR: [], bothNoGate: [], bothGated: [] };
for (const m of MARKETS) {
  await sleep(1500);
  const candles = await fetchDaily(m.y, m.range);
  if (!candles) { console.log(`${m.sym}: no data`); continue; }
  console.log(`${m.sym} (${((candles[candles.length - 1].t - candles[0].t) / (365.25 * 864e5)).toFixed(1)}y)`);
  for (const mode of ['longMR', 'bothNoGate', 'bothGated']) { const tr = sim(candles, mode); pooled[mode].push(...tr); console.log(`   ${mode.padEnd(11)} ${fmt(stats(tr))}`); }
}
console.log('\nPOOLED:');
for (const mode of ['longMR', 'bothNoGate', 'bothGated']) console.log(`   ${mode.padEnd(11)} ${fmt(stats(pooled[mode]))}`);
console.log('\n longMR = production long-only. bothNoGate = long oversold + short overbought, no trend filter.');
console.log(' If either both-ways mode beats long-only net (and PF>1.3), short-term both-ways earns its place.\n');
