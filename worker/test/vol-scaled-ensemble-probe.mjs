// VERIFY the vol-scaled size dial on the FULL ENSEMBLE (MR + trend concurrent slots), not just
// MR-only — the last check before it's an adoption proposal. Applies size = clamp(baseVol/curVol,
// lo, hi) to BOTH legs at entry, ~10y equity, by year + IS/OOS. Equity ETF/cash-index set (a fair
// stand-in for the live equity board: live ES/NQ/YM/RTY are proxied by SPY/QQQ/DIA/IWM here).
//   node test/vol-scaled-ensemble-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';

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
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function rvol(closes, i, w) { if (i < w + 1) return null; const rs = []; for (let k = i - w + 1; k <= i; k++) rs.push(Math.log(closes[k] / closes[k - 1])); const m = rs.reduce((a, b) => a + b, 0) / rs.length; return Math.sqrt(rs.reduce((a, b) => a + (b - m) * (b - m), 0) / rs.length); }

// policy: null = flat, else {lo,hi}. Runs the concurrent-slots ensemble; size dial applied at entry.
function run(policy) {
  const out = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym], closes = candles.map((c) => c.c);
    const record = { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} };
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      const cur = rvol(closes, i, 20), base = rvol(closes, i, 100);
      const sizeMult = policy ? clamp((base && cur) ? base / cur : 1, policy.lo, policy.hi) : 1;
      const dials = { sizeMult };
      let mrSig = computeSignal(candles.slice(0, i + 1), price);
      if (mrSig.verdict === 'BUY' && typeof mrSig.pctB === 'number' && mrSig.pctB >= PB) mrSig = { ...mrSig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials, strat: 'mr', shouldExit: mrShouldExit });
      const trendSig = computeTrend(candles.slice(0, i + 1), price);
      processPosition({ symbol: sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials, strat: 'trend', shouldExit: trendShouldExit, openMap: record.openTrend, lastCloseMap: record.lastCloseTrend });
    }
    for (const t of record.closed) out.push({ ...t, year: new Date(t.openedAt || t.closedAt).getUTCFullYear() });
  }
  return out.sort((a, b) => a.closedAt - b.closedAt);
}
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, maxDD: 0, retDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
const flat = run(null), def = run({ lo: 0.4, hi: 1.0 }), vt = run({ lo: 0.5, hi: 1.3 });
const mid = flat.length ? flat[Math.floor(flat.length * 0.6)].closedAt : 0;
const isoos = (t) => `IS ${JSON.stringify(st(t.filter((x) => x.closedAt < mid)))} OOS ${JSON.stringify(st(t.filter((x) => x.closedAt >= mid)))}`;
const line = (s) => `net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} maxDD=$${String(s.maxDD).padStart(6)} return/DD=${s.retDD}`;
console.log(`\nVOL-SCALED on the ENSEMBLE — ${Object.keys(DATA).length} equity mkts, ~${RANGE}, MR+trend concurrent slots.\n`);
console.log('  FLAT (current)     FULL', line(st(flat)));
console.log('     ', isoos(flat));
console.log('  DEFENSIVE 0.4–1.0  FULL', line(st(def)));
console.log('     ', isoos(def));
console.log('  VOL-TARGET 0.5–1.3 FULL', line(st(vt)));
console.log('     ', isoos(vt));
console.log('\n  By year — FLAT -> DEFENSIVE -> VOL-TARGET (net $):');
for (const y of [...new Set(flat.map((t) => t.year))].sort()) {
  const f = st(flat.filter((t) => t.year === y)).net, d = st(def.filter((t) => t.year === y)).net, v = st(vt.filter((t) => t.year === y)).net;
  console.log(`   ${y}  $${String(f).padStart(6)}  ->  $${String(d).padStart(6)}  ->  $${String(v).padStart(6)}`);
}
console.log('');
