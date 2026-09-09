// PROBE: does the MR dip-buyer's edge rise MONOTONICALLY with setup depth? Buckets every closed
// MR trade by how oversold it was at entry (%B at entry — lower = deeper below the lower Bollinger
// band) and reports win / expectancy / avgR / PF per tier. If deeper setups genuinely earn more,
// the GRADIENT itself is honest proof the engine's ranking is real (the Danelfin pattern) — not a
// single cherry-picked hero number. Post-%B recipe (entries only when %B<0.30). Read-only analysis.
//   node test/edge-by-tier-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit } from '../src/scheduler.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6, PB_ADOPT_MAX = 0.30;
// %B setup-depth tiers are an EQUITY dip-buyer concept — the live %B<0.30 gate only applies to
// non-crypto (crypto runs the full recipe with the edge reversed), so crypto is excluded here.
const SYMS = Object.keys(DATA).filter((s) => !MARKETS[s]?.crypto);

// Bucket edges on %B at entry (deepest first). All live entries are %B<0.30.
const TIERS = [
  { key: 'below band', lo: -Infinity, hi: 0.0 },
  { key: '%B 0.00–0.10', lo: 0.0, hi: 0.10 },
  { key: '%B 0.10–0.20', lo: 0.10, hi: 0.20 },
  { key: '%B 0.20–0.30', lo: 0.20, hi: 0.30 },
];
function tierOf(pb) {
  if (typeof pb !== 'number') return null;
  return TIERS.find((t) => pb >= t.lo && pb < t.hi)?.key ?? null;
}

function backtest() {
  const trades = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    let pos = null, lastCloseDay = null;
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      let sig = computeSignal(candles.slice(0, i + 1), price);
      if (!meta.crypto && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB_ADOPT_MAX) {
        sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      if (pos) {
        const reason = mrShouldExit(sig, pos, price, now, 65);
        if (reason) {
          const r = pos.risk || 1e-9, resultR = (price - pos.entry) / r;
          trades.push({ sym, pctB: pos.pctB, resultR, pnl: Math.round(resultR * RISK - COST), closedAt: now });
          lastCloseDay = new Date(now).toISOString().slice(0, 10); pos = null;
        }
      }
      if (!pos && sig.verdict === 'BUY' && sig.plan) {
        const day = new Date(now).toISOString().slice(0, 10);
        if (day === lastCloseDay) continue;
        pos = { entry: price, stop: sig.plan.stop, risk: sig.plan.risk, side: 'LONG', pctB: sig.pctB, exitAbove: 65, maxHoldMin: sig.plan.maxHoldMin, openedAt: now };
      }
    }
  }
  return trades.sort((a, b) => a.closedAt - b.closedAt);
}
function stats(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), l = t.filter((x) => x.pnl < 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), exp: +(t.reduce((s, x) => s + x.pnl, 0) / t.length).toFixed(1),
    avgR: +(t.reduce((s, x) => s + x.resultR, 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2) };
}

const all = backtest();
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% exp=$${String(s.exp).padStart(6)} avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(6)}` : '(none)';
console.log(`\nEDGE BY SETUP DEPTH — ${SYMS.length} markets, post-%B recipe. Deeper (lower %B) first.\n`);
let prev = Infinity, monotonic = true;
for (const t of TIERS) {
  const s = stats(all.filter((x) => tierOf(x.pctB) === t.key));
  console.log(`  ${t.key.padEnd(14)} ${fmt(s)}`);
  if (s.n) { if (s.avgR > prev + 0.001) monotonic = false; prev = s.avgR; }
}
console.log('  ' + '-'.repeat(60));
console.log(`  ${'ALL'.padEnd(14)} ${fmt(stats(all))}`);
console.log(`\n  avgR monotonically non-increasing as setups get shallower: ${monotonic ? 'YES ✓' : 'NO'}`);
console.log('');
