// CLOSE THE GAP: does vol-scaled sizing also help the NON-equity legs — crypto (MR+trend, no %B
// gate) and the both-ways FX/commodity engine (computeBothMR, long+short)? Their vol dynamics
// differ (crypto is always high-vol; FX low; commodities spike), so vol-scaling could behave
// differently. Tests flat vs defensive 0.4–1.0 vs vol-target 0.5–1.3, by leg, IS/OOS. ~10y.
//   node test/vol-scaled-noneq-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { computeBothMR, bothMRShouldExit } from '../src/bothways.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6, RANGE = '10y';
const CRYPTO = ['BTC', 'ETH'];
const FX = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD'];
const COMMOD = ['GC', 'SI', 'HG', 'CL', 'NG'];
const ALL = [...CRYPTO, ...FX, ...COMMOD];

async function fetchLong(y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=${RANGE}`;
  const r = (await (await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } })).json())?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators.quote[0], ts = r.timestamp || [], out = [];
  for (let i = 0; i < ts.length; i++) { if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] }); }
  return out;
}
const DATA = {};
for (const s of ALL) { try { const c = await fetchLong(MARKETS[s].yahoo); if (c && c.length > 300) DATA[s] = c; } catch (e) { /* skip */ } }
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function rvol(c, i, w) { if (i < w + 1) return null; const rs = []; for (let k = i - w + 1; k <= i; k++) rs.push(Math.log(c[k] / c[k - 1])); const m = rs.reduce((a, b) => a + b, 0) / rs.length; return Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / rs.length); }

function runMarket(sym, policy) {
  const candles = DATA[sym], meta = MARKETS[sym], closes = candles.map((c) => c.c);
  const bothWays = meta.engine === 'mrBoth';
  const record = { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} };
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c, now = candles[i].t;
    const cur = rvol(closes, i, 20), base = rvol(closes, i, 100);
    const dials = { sizeMult: policy ? clamp((base && cur) ? base / cur : 1, policy.lo, policy.hi) : 1 };
    if (bothWays) {
      const sig = computeBothMR(candles.slice(0, i + 1), price, meta.cell);
      processPosition({ symbol: sym, meta, sig, live: price, open: true, record, now, risk: RISK, cost: COST, dials, strat: 'mr', shouldExit: bothMRShouldExit });
    } else { // crypto: MR (no %B gate) + trend concurrent
      const mrSig = computeSignal(candles.slice(0, i + 1), price);
      processPosition({ symbol: sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials, strat: 'mr', shouldExit: mrShouldExit });
      const trendSig = computeTrend(candles.slice(0, i + 1), price);
      processPosition({ symbol: sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials, strat: 'trend', shouldExit: trendShouldExit, openMap: record.openTrend, lastCloseMap: record.lastCloseTrend });
    }
  }
  return record.closed.map((t) => ({ ...t, sym }));
}
function group(syms, policy) { const all = []; for (const s of syms) if (DATA[s]) all.push(...runMarket(s, policy)); return all.sort((a, b) => a.closedAt - b.closedAt); }
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, maxDD: 0, retDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
const line = (s) => `n=${String(s.n).padStart(4)} net=$${String(s.net).padStart(7)} pf=${String(s.pf).padStart(5)} maxDD=$${String(s.maxDD).padStart(7)} return/DD=${s.retDD}`;
console.log(`\nVOL-SCALED on NON-EQUITY legs — ~${RANGE}. crypto=MR+trend(no %B); FX/commod=both-ways.\n`);
for (const [label, syms] of [['CRYPTO (BTC,ETH)   ', CRYPTO], ['FX (7 pairs)        ', FX], ['COMMODITIES (5)     ', COMMOD]]) {
  const have = syms.filter((s) => DATA[s]);
  console.log(`  ${label} [${have.length}/${syms.length} mkts]`);
  for (const [pl, p] of [['flat     ', null], ['def 0.4-1.0', { lo: 0.4, hi: 1.0 }], ['vt 0.5-1.3', { lo: 0.5, hi: 1.3 }]]) {
    const all = group(syms, p), mid = all.length ? all[Math.floor(all.length * 0.6)].closedAt : 0;
    console.log(`     ${pl}  ${line(st(all))}   IS r/DD=${st(all.filter((t) => t.closedAt < mid)).retDD} OOS r/DD=${st(all.filter((t) => t.closedAt >= mid)).retDD}`);
  }
}
console.log('');
