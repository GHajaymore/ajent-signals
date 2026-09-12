// PROTOTYPE + VALIDATE: a COUNTERCYCLICAL size dial. The live sizeMult is procyclical (sizes up
// after good expectancy -> into crashes). Instead, scale each entry's size INVERSELY to how
// elevated the market's volatility is vs its own norm — small size in high-vol crash regimes
// (2018/2020/2022), full size when calm. Tests whether that defends the bad years WITHOUT gutting
// the good ones, with an IS/OOS split (a defense that only helps in-sample is overfit). MR long,
// ~10y equity. sizeMult = clamp(baselineVol / currentVol, lo, hi).
//   node test/vol-scaled-size-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit } from '../src/scheduler.js';

const RISK = 250, COST = 6, PB = 0.30, RANGE = '10y';
const SYMS = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'DAX', 'N225', 'FTSE', 'HSI', 'KOSPI', 'CAC', 'TSX', 'SX5E'];

async function fetchLong(y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=${RANGE}`;
  const r = (await (await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } })).json())?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators.quote[0], ts = r.timestamp || [], out = [];
  for (let i = 0; i < ts.length; i++) { if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] }); }
  return out;
}
const DATA = {};
for (const s of SYMS) { try { const c = await fetchLong(MARKETS[s].yahoo); if (c && c.length > 300) DATA[s] = c; } catch (e) { /* skip */ } }

// realized vol = stdev of last `w` daily log-returns.
function rvol(closes, i, w) {
  if (i < w + 1) return null;
  const rs = []; for (let k = i - w + 1; k <= i; k++) rs.push(Math.log(closes[k] / closes[k - 1]));
  const m = rs.reduce((a, b) => a + b, 0) / rs.length;
  return Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / rs.length);
}

// Collect each MR entry ONCE, tagged with its vol ratio (current 20d vs baseline 100d) + outcome.
const trades = [];
for (const sym of Object.keys(DATA)) {
  const candles = DATA[sym], meta = MARKETS[sym], closes = candles.map((c) => c.c);
  let pos = null, lastCloseDay = null;
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c, now = candles[i].t;
    let sig = computeSignal(candles.slice(0, i + 1), price);
    if (sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', plan: null };
    if (pos) {
      if (mrShouldExit(sig, pos, price, now, 65)) {
        trades.push({ sym, resultR: (price - pos.entry) / (pos.risk || 1e-9), volRatio: pos.volRatio, year: new Date(pos.openedAt).getUTCFullYear(), openedAt: pos.openedAt, closedAt: now });
        lastCloseDay = new Date(now).toISOString().slice(0, 10); pos = null;
      }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      const day = new Date(now).toISOString().slice(0, 10); if (day === lastCloseDay) continue;
      const cur = rvol(closes, i, 20), base = rvol(closes, i, 100);
      pos = { entry: price, stop: sig.plan.stop, risk: sig.plan.risk, side: 'LONG', exitAbove: 65, maxHoldMin: sig.plan.maxHoldMin, openedAt: now, volRatio: (cur && base) ? cur / base : 1 };
    }
  }
}
trades.sort((a, b) => a.closedAt - b.closedAt);
const mid = trades.length ? trades[Math.floor(trades.length * 0.6)].closedAt : 0;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// sizeMult for a trade under a vol-scaling policy; baseline = flat 1.0.
const sizeOf = (t, policy) => policy ? clamp(1 / (t.volRatio || 1), policy.lo, policy.hi) : 1;
const st = (t, policy) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, maxDD: 0, retDD: 0 };
  const pnl = (x) => Math.round((x.resultR * RISK * sizeOf(x, policy)) - COST);
  const gw = t.filter((x) => pnl(x) > 0).reduce((s, x) => s + pnl(x), 0), gl = Math.abs(t.filter((x) => pnl(x) < 0).reduce((s, x) => s + pnl(x), 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += pnl(x); pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(t.reduce((s, x) => s + pnl(x), 0)), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * t.filter((x) => pnl(x) > 0).length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
const line = (s) => `net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} maxDD=$${String(s.maxDD).padStart(6)} return/DD=${s.retDD}`;
console.log(`\nVOL-SCALED SIZE — ${Object.keys(DATA).length} equity mkts, ~${RANGE}, MR long. size = clamp(baselineVol/currentVol, lo, hi).\n`);
const policies = [['FLAT (baseline)', null], ['scale 0.4–1.0', { lo: 0.4, hi: 1.0 }], ['scale 0.3–1.0', { lo: 0.3, hi: 1.0 }], ['scale 0.4–1.2', { lo: 0.4, hi: 1.2 }], ['scale 0.5–1.3', { lo: 0.5, hi: 1.3 }]];
for (const [label, p] of policies) {
  console.log(`  ${label.padEnd(16)} FULL ${line(st(trades, p))}`);
  console.log(`  ${' '.repeat(16)} IS   ${line(st(trades.filter((t) => t.closedAt < mid), p))}`);
  console.log(`  ${' '.repeat(16)} OOS  ${line(st(trades.filter((t) => t.closedAt >= mid), p))}`);
}
console.log('\n  By year — FLAT vs scale 0.4–1.0 (did vol-scaling defend the crashes?):');
for (const y of [...new Set(trades.map((t) => t.year))].sort()) {
  const ty = trades.filter((t) => t.year === y);
  console.log(`   ${y}  flat net=$${String(st(ty, null).net).padStart(6)}  ->  vol-scaled net=$${String(st(ty, { lo: 0.4, hi: 1.0 }).net).padStart(6)}`);
}
console.log('');
