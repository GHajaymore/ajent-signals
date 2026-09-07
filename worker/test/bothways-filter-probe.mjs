// BOTH-WAYS filter probe — extend the validated MR filters to the SHORT side. On the
// symmetric both-ways engine (FX + commodities), do the two edges that helped the long
// dip-buyer help SYMMETRICALLY? For a LONG, "near a level" = near a pivot LOW (support);
// for a SHORT, near a pivot HIGH (resistance). ADX-notch (skip 15-20) is direction-free.
// Runs the EXACT production computeBothMR + bothMRShouldExit, reports full + OOS + the
// LONG/SHORT split, so we see whether the short leg specifically improves.
//   node test/bothways-filter-probe.mjs
//
// VERDICT (2026-09-06): the equity long-MR filters DO NOT TRANSFER to both-ways. The
// both-ways baseline is a much thinner edge (pf ~1.17 vs equity 2.61). Support/resistance
// proximity is marginal and worse OOS (helps shorts a little, hurts longs); ADX-notch
// HURTS (no dead zone here — the both-ways edge is regime-agnostic); combined cuts 77% of
// trades for no OOS gain. So these two filters are LONG-EQUITY-SPECIFIC, not universal —
// each (style x direction x asset-class) cell needs its OWN filter research. The thin
// both-ways edge is itself a separate candidate for improvement (different signals).
import { computeBothMR, bothMRShouldExit } from '../src/bothways.js';
import { processPosition } from '../src/scheduler.js';
import { atr, adx } from '../src/indicators.js';

const RISK = 250, COST = 6;
const CELLS = {
  fx: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  commodity: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F', ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDaily(ySym, attempt = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=10y`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error('no result');
    const ts = res.timestamp || [], q = res.indicators.quote[0], out = [];
    for (let i = 0; i < ts.length; i++) { const c = q.close[i], h = q.high[i], l = q.low[i]; if (c == null || h == null || l == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? c, h, l, c }); }
    return out.length > 300 ? out : null;
  } catch (e) { if (attempt < 3) { await sleep(2500 * (attempt + 1)); return fetchDaily(ySym, attempt + 1); } return null; }
}

// Direction-aware level proximity: long -> near a pivot LOW (support); short -> pivot HIGH.
function nearLevelDir(c, i, atrVal, kAtr, dir, lookback = 60, L = 3) {
  if (!(atrVal > 0)) return false;
  const price = c[i].c; let best = Infinity;
  for (let j = i - L; j >= Math.max(L, i - lookback); j--) {
    let piv = true;
    for (let k = j - L; k <= j + L; k++) { if (k === j || !c[k]) continue; if (dir > 0 ? c[k].l < c[j].l : c[k].h > c[j].h) { piv = false; break; } }
    if (piv) best = Math.min(best, Math.abs(price - (dir > 0 ? c[j].l : c[j].h)));
  }
  return best !== Infinity && best <= kAtr * atrVal;
}

const DATA = {}, IND = {}, CELLOF = {};
for (const [cell, syms] of Object.entries(CELLS)) {
  for (const [sym, y] of Object.entries(syms)) {
    await sleep(1400);
    const c = await fetchDaily(y);
    if (!c) { console.log(`  (no data: ${sym})`); continue; }
    DATA[sym] = c; CELLOF[sym] = cell; IND[sym] = { atr: atr(c, 14), adx: adx(c, 14).adx };
  }
}
const SYMS = Object.keys(DATA);

const support = (s, i, dir) => nearLevelDir(DATA[s], i, IND[s].atr[i], 0.5, dir);
const notch = (s, i) => { const a = IND[s].adx[i]; return a != null && !(a >= 15 && a < 20); };
function run(keep) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], cell = CELLOF[sym], meta = { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeBothMR(candles.slice(0, i + 1), candles[i].c, cell);
      if (keep && (sig.verdict === 'BUY' || sig.verdict === 'SELL')) {
        const dir = sig.verdict === 'BUY' ? 1 : -1;
        if (!keep(sym, i, dir)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
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
const longs = (t) => t.filter((x) => x.side === 'LONG'), shorts = (t) => t.filter((x) => x.side === 'SHORT');

console.log(`\nBOTH-WAYS FILTER PROBE — ${SYMS.length} symbols (FX + commodities), 60/40 IS/OOS\n`);
const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt)), mid = tMin + (tMax - tMin) * 0.6;
const VARIANTS = [
  ['baseline', null],
  ['resistance/support 0.5xATR', (s, i, d) => support(s, i, d)],
  ['ADX notch 15-20', (s, i) => notch(s, i)],
  ['BOTH (level + notch)', (s, i, d) => support(s, i, d) && notch(s, i)],
];
for (const [name, keep] of VARIANTS) {
  const c = run(keep), full = st(c), test = st(c.filter((t) => t.closedAt >= mid));
  console.log(`${name.padEnd(28)} keeps ${String(baseline.length ? Math.round(full.n / baseline.length * 100) : 0).padStart(3)}%`);
  console.log(`   FULL  ${fmt(full)}`);
  console.log(`   long  ${fmt(st(longs(c)))}`);
  console.log(`   short ${fmt(st(shorts(c)))}`);
  console.log(`   OOS   ${fmt(test)}`);
}
console.log('\nREAD: does the SHORT leg specifically improve with resistance-proximity + notch, and');
console.log('hold OOS? If shorts stay weak, the filters are long-only; if both legs lift, symmetric.\n');
