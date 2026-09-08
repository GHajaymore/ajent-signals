// PROBE (new macro dimension): does the VIX regime at entry predict MR dip-buy success?
// Distinct from the already-rejected per-market ATR vol-explosion gate — VIX is cross-asset
// FEAR. Two competing hypotheses: buy dips only when calm (avoid buying into a crisis that
// keeps falling) vs only when fearful (deeper fear = better bounces). Buckets US-equity MR
// trades (where VIX is the right gauge) by VIX-at-entry, then tests band gates under the
// robustness gate (IS/OOS + smooth plateau). Post-%B recipe.   node test/mr-vix-regime-probe.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6, PB = 0.30;
// US-equity MR markets — VIX is the coherent fear gauge for these.
const US = ['ES', 'NQ', 'YM', 'RTY', 'SPY', 'QQQ', 'IWM', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchVix(a = 0) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=10y';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error('no vix');
    const ts = res.timestamp || [], c = res.indicators.quote[0].close, map = {};
    for (let i = 0; i < ts.length; i++) if (c[i] != null) map[new Date(ts[i] * 1000).toISOString().slice(0, 10)] = c[i];
    return map;
  } catch (e) { if (a < 3) { await sleep(2500 * (a + 1)); return fetchVix(a + 1); } throw e; }
}
const VIX = await fetchVix();
const vixAt = (t) => { const d = new Date(t); for (let k = 0; k < 5; k++) { const key = new Date(d.getTime() - k * 86400000).toISOString().slice(0, 10); if (VIX[key] != null) return VIX[key]; } return null; };

const DATA = {};
for (const sym of US) { if (!MARKETS[sym]) continue; try { const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 260) DATA[sym] = candles; } catch (e) { /* skip */ } }
const SYMS = Object.keys(DATA);

// Run all US-equity MR trades (post-%B), tagging each with VIX-at-entry. gate=[lo,hi] restricts entries.
function run(gate) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym], record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      const vx = vixAt(candles[i].t);
      if (sig.verdict === 'BUY' && gate && (vx == null || vx < gate[0] || vx >= gate[1])) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      const before = record.closed.length;
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
      if (record.open[sym] && record.open[sym].vixTag === undefined) record.open[sym].vixTag = vx; // tag entry VIX
      if (record.closed.length > before) record.closed[0].vixTag = record.closed[0].vixTag ?? vx;
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)}` : '(none)';

const all = run(null);
console.log(`\nMR × VIX-REGIME PROBE — ${SYMS.length} US-equity markets, post-%B. VIX-at-entry buckets.\n`);
// vixTag was set on the open pos but the closed record may not carry it reliably; recompute from openedAt.
for (const t of all) t.vix = vixAt(t.openedAt);
const buckets = [[0, 13], [13, 16], [16, 20], [20, 25], [25, 100]];
console.log('EDGE BY VIX-AT-ENTRY BUCKET:');
for (const [lo, hi] of buckets) console.log(`  VIX ${String(lo).padStart(2)}-${hi === 100 ? '∞ ' : String(hi).padStart(2)}  ${fmt(st(all.filter((t) => t.vix != null && t.vix >= lo && t.vix < hi)))}`);
console.log(`  ALL         ${fmt(st(all))}`);
// Test a few candidate band gates full + OOS.
let tMin = Infinity, tMax = -Infinity; for (const t of all) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;
const gates = { 'no gate': null, 'VIX<20': [0, 20], 'VIX<25': [0, 25], 'VIX 13-25': [13, 25], 'VIX>=18': [18, 100] };
console.log('\nGATE TEST (full / OOS):');
for (const [name, g] of Object.entries(gates)) { const c = run(g); console.log(`  ${name.padEnd(11)} full ${fmt(st(c))}\n              oos  ${fmt(st(c.filter((t) => t.closedAt >= mid)))}`); }
console.log('');
