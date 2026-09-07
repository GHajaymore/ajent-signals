// BOTH-WAYS IMPROVEMENT PROBE — the both-ways FX/commodity edge is thin (pf ~1.17, avgR
// ~0.06): likely too many low-quality entries. The equity filters didn't transfer, so test
// signals suited to a SYMMETRIC mean-reverter: deeper RSI extremes, a real DISLOCATION from
// the mean (|price-SMA| in ATR), and RANGING-only regime (mean-reversion dies in trends, so
// low ADX should help even though the notch didn't). Runs the exact computeBothMR, vetoes
// BUY/SELL by each gate, reports full + OOS + long/short. node test/bothways-improve-probe.mjs
//
// FINDING (2026-09-06): a RANGING-ADX filter materially improves the thin both-ways edge —
// mean-reversion works in ranges, not trends, and FX/commodities have no drift. Validated
// through the robustness gate: pf 1.17 -> 1.45 (ADX<20) / 1.23 (ADX<25, keeps 46%), OOS
// 1.26 -> 2.34 / 1.75, SYMMETRIC (long & short both lift), a smooth ADX-threshold plateau
// (pf 2.0@<15 -> 1.23@<25), and 3/4 walk-forward folds. Cell-specific — the OPPOSITE of the
// equity dip-buyer (which wants the ADX 15-20 NOTCH). Deeper-RSI and dislocation don't help.
// CANDIDATE for the both-ways EXPERIMENT cells (already unproven/tracked). Recommend to Ajay.
import { computeBothMR, bothMRShouldExit, BOTH_CELLS } from '../src/bothways.js';
import { processPosition } from '../src/scheduler.js';
import { adx } from '../src/indicators.js';

const RISK = 250, COST = 6;
const CELLS = {
  fx: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  commodity: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F', ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDaily(y, a = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=10y`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error('no result');
    const ts = res.timestamp || [], q = res.indicators.quote[0], out = [];
    for (let i = 0; i < ts.length; i++) { const c = q.close[i], h = q.high[i], l = q.low[i]; if (c == null || h == null || l == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? c, h, l, c }); }
    return out.length > 300 ? out : null;
  } catch (e) { if (a < 3) { await sleep(2500 * (a + 1)); return fetchDaily(y, a + 1); } return null; }
}
const DATA = {}, ADX = {}, CELLOF = {};
for (const [cell, syms] of Object.entries(CELLS)) for (const [sym, y] of Object.entries(syms)) {
  await sleep(1400); const c = await fetchDaily(y);
  if (!c) { console.log(`  (no data: ${sym})`); continue; }
  DATA[sym] = c; CELLOF[sym] = cell; ADX[sym] = adx(c, 14).adx;
}
const SYMS = Object.keys(DATA);

function run(keepSig) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], cell = CELLOF[sym], meta = { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeBothMR(candles.slice(0, i + 1), candles[i].c, cell);
      if (keepSig && (sig.verdict === 'BUY' || sig.verdict === 'SELL') && !keepSig(sig, sym, i)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, strat: 'mrBoth', shouldExit: bothMRShouldExit });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, winRate: 0, pf: 0, avgR: 0, pnl: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)}` : '(none)';

// Gates on the both-ways signal (has rsiMR, trendMA, atr, price).
const stretch = (k) => (sig) => sig.trendMA != null && sig.atr > 0 && Math.abs(sig.price - sig.trendMA) > k * sig.atr;
const ranging = (x) => (sig, s, i) => { const a = ADX[s][i]; return a != null && a < x; };
const deeper = (m) => (sig, s) => { const lo = BOTH_CELLS[CELLOF[s]].lower, up = 100 - lo; return sig.verdict === 'BUY' ? sig.rsiMR < lo - m : sig.rsiMR > up + m; };

const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt)), mid = tMin + (tMax - tMin) * 0.6;
const VARIANTS = [
  ['baseline', null],
  ['dislocation >1.0xATR from SMA', stretch(1.0)],
  ['dislocation >1.5xATR from SMA', stretch(1.5)],
  ['ranging ADX<20', ranging(20)],
  ['ranging ADX<25', ranging(25)],
  ['deeper RSI (extreme +5)', deeper(5)],
  ['dislocation1.0 + ranging25', (sig, s, i) => stretch(1.0)(sig) && ranging(25)(sig, s, i)],
];
console.log(`\nBOTH-WAYS IMPROVEMENT PROBE — ${SYMS.length} symbols (FX + commodities)\n`);
for (const [name, keep] of VARIANTS) {
  const c = run(keep), full = st(c), test = st(c.filter((t) => t.closedAt >= mid));
  const kept = baseline.length ? Math.round(full.n / baseline.length * 100) : 0;
  const l = st(c.filter((t) => t.side === 'LONG')), sh = st(c.filter((t) => t.side === 'SHORT'));
  console.log(`${name.padEnd(30)} keeps ${String(kept).padStart(3)}%`);
  console.log(`   FULL ${fmt(full)}`);
  console.log(`   OOS  ${fmt(test)}   long ${l.pf} / short ${sh.pf} pf`);
}
// --- ROBUSTNESS GATE for the ranging-ADX candidate --------------------------
console.log('\nROBUSTNESS — ranging ADX filter:');
console.log('  PARAMETER PLATEAU (ADX threshold; smooth ridge = robust):');
for (const x of [15, 18, 20, 22, 25, 30]) { const s = st(run(ranging(x))); console.log(`     ADX<${x}  pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(6)} n=${String(s.n).padStart(3)}`); }
console.log('  WALK-FORWARD (4 sequential folds; wins >=3/4 = stable):');
for (const x of [20, 25]) {
  const c = run(ranging(x)); let wins = 0; const line = [];
  for (let f = 0; f < 4; f++) {
    const lo = tMin + (tMax - tMin) * (f / 4), hi = tMin + (tMax - tMin) * ((f + 1) / 4), inF = (t) => t.closedAt >= lo && t.closedAt < hi;
    const b = st(baseline.filter(inF)), g = st(c.filter(inF)); const win = g.n && b.n && g.pf > b.pf && g.avgR > b.avgR; if (win) wins++;
    line.push(`f${f + 1} ${g.pf}${win ? '*' : ''}`);
  }
  console.log(`     ADX<${x}: ${line.join('  ')}  -> ${wins}/4 ${wins >= 3 ? '(stable)' : '(erratic)'}`);
}
console.log('\nREAD: a gate earns interest only if it lifts pf AND avgR AND holds OOS while keeping a');
console.log('usable trade count, plateaus over its parameter, and wins >=3/4 walk-forward folds.\n');
