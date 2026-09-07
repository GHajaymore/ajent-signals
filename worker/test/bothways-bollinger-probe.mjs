// Does Bollinger %B — the strongest equity MR confirmation (see bollinger-robustness.mjs) —
// also help the BOTH-WAYS cells (FX + commodities)? Symmetric by construction: a long wants
// the close below the lower band (%B<thr), a short wants it above the upper band (%B>1-thr).
// Tests it ON TOP of the already-adopted ranging filter (computeBothMR stands aside at ADX>=25).
//   node test/bothways-bollinger-probe.mjs
import { computeBothMR, bothMRShouldExit } from '../src/bothways.js';
import { processPosition } from '../src/scheduler.js';

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
function bbPctB(c, p = 20, k = 2) {
  const n = c.length, close = c.map((x) => x.c), o = new Array(n).fill(null);
  for (let i = p - 1; i < n; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += close[j]; const m = s / p;
    let v = 0; for (let j = i - p + 1; j <= i; j++) v += (close[j] - m) ** 2; const sd = Math.sqrt(v / p);
    const lo = m - k * sd, hi = m + k * sd; o[i] = hi === lo ? 0.5 : (close[i] - lo) / (hi - lo);
  }
  return o;
}
const DATA = {}, PB = {}, CELLOF = {};
for (const [cell, syms] of Object.entries(CELLS)) for (const [sym, y] of Object.entries(syms)) {
  await sleep(1400); const c = await fetchDaily(y);
  if (!c) { console.log(`  (no data: ${sym})`); continue; }
  DATA[sym] = c; CELLOF[sym] = cell; PB[sym] = bbPctB(c, 20, 2);
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
    for (const t of record.closed) { t.sym = sym; t.side = t.side || (t.resultR != null ? t.side : null); closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, winRate: 0, pf: 0, avgR: 0, pnl: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)}` : '(none)';

// Symmetric %B gate: long wants close below the lower band, short above the upper band.
const pbGate = (thr) => (sig, s, i) => { const pb = PB[s][i]; if (pb == null) return false; return sig.verdict === 'BUY' ? pb < thr : pb > (1 - thr); };

const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt)), mid = tMin + (tMax - tMin) * 0.6;
const b = st(baseline);
console.log(`\nBOTH-WAYS BOLLINGER %B PROBE — ${SYMS.length} symbols (FX + commodities), on top of the ranging filter\n`);
console.log(`baseline (ranging-filtered engine): ${fmt(b)}\n`);

console.log('SYMMETRIC %B GATE (buy %B<thr, sell %B>1-thr) — full + OOS + per-leg:');
for (const thr of [0.10, 0.15, 0.20, 0.25, 0.30]) {
  const c = run(pbGate(thr)), full = st(c), test = st(c.filter((t) => t.closedAt >= mid));
  const longs = st(c.filter((t) => t.side === 'LONG')), shorts = st(c.filter((t) => t.side === 'SHORT'));
  const kept = b.n ? Math.round((full.n / b.n) * 100) : 0;
  console.log(`  %B thr ${thr}  keeps ${String(kept).padStart(3)}%`);
  console.log(`     FULL ${fmt(full)}`);
  console.log(`     OOS  ${fmt(test)}`);
  console.log(`     long ${fmt(longs)}  |  short ${fmt(shorts)}`);
}

// Walk-forward for %B<0.20 (the middle of the plateau) — does it hold every period?
console.log('\nWALK-FORWARD (4 folds) — %B<0.20 symmetric gate:');
const cand = run(pbGate(0.20)); let wins = 0;
for (let f = 0; f < 4; f++) {
  const lo = tMin + (tMax - tMin) * (f / 4), hi = tMin + (tMax - tMin) * ((f + 1) / 4);
  const inF = (t) => t.closedAt >= lo && t.closedAt < hi;
  const bb = st(baseline.filter(inF)), gg = st(cand.filter(inF));
  const win = gg.n && bb.n && gg.pf > bb.pf && gg.avgR > bb.avgR; if (win) wins++;
  console.log(`   fold ${f + 1} (${new Date(lo).getFullYear()}-${new Date(hi).getFullYear()})  base pf=${String(bb.pf).padStart(5)} avgR=${String(bb.avgR).padStart(6)} n=${String(bb.n).padStart(3)}  ->  %B pf=${String(gg.pf).padStart(5)} avgR=${String(gg.avgR).padStart(6)} n=${String(gg.n).padStart(3)}  ${win ? 'WIN' : '·'}`);
}
console.log(`   folds won: ${wins}/4  ${wins >= 3 ? '(stable)' : '(not stable)'}`);
console.log('\nREAD: %B earns interest for both-ways only if it lifts pf AND avgR, holds OOS, works on BOTH legs, keeps a workable count, and wins >=3/4 folds. Otherwise it stays an indices-only edge.\n');
