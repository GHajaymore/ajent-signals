// Does the validated combined entry filter (support + ADX-notch) also REDUCE risk
// clustering, not just improve returns? Mean-reversion dips cluster in selloffs, stacking
// simultaneous risk. If the filter skips the mid-air / dead-zone dips that cluster worst,
// it lowers peak concurrent exposure too — a safety argument for adopting it. Compares peak
// concurrency unfiltered vs combined-filtered.  node test/concurrent-filter-compare.mjs
//
// FINDING (2026-09-07): the combined filter is a DOUBLE WIN — return AND risk. Beyond pf
// 2.61→4.96, it cuts time-weighted avg open 1.4→0.86 positions (−39% capital-at-risk) and
// entries into a crowded book (≥5 open) 30%→10%, peak 8%→7%. It skips the mid-air/dead-zone
// dips that cluster worst in selloffs — a mechanical safety consequence of its design, not a
// fit. Strengthens the (still measure-first) equity-filter adoption case.
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { atr, adx } from '../src/indicators.js';
import { DATA } from './bt.mjs';

const RISK = 250, ACCOUNT = 25000;
const SYMS = Object.keys(DATA);
const IND = {};
for (const s of SYMS) IND[s] = { atr: atr(DATA[s], 14), adx: adx(DATA[s], 14).adx };

function nearLevel(c, i, atrVal, kAtr = 0.5, lookback = 60, L = 3) {
  if (!(atrVal > 0)) return false;
  const price = c[i].c; let best = Infinity;
  for (let j = i - L; j >= Math.max(L, i - lookback); j--) {
    let lowP = true, highP = true;
    for (let k = j - L; k <= j + L; k++) { if (k === j || !c[k]) continue; if (c[k].l < c[j].l) lowP = false; if (c[k].h > c[j].h) highP = false; }
    if (lowP) best = Math.min(best, Math.abs(price - c[j].l));
    if (highP) best = Math.min(best, Math.abs(price - c[j].h));
  }
  return best !== Infinity && best <= kAtr * atrVal;
}
const combined = (s, i) => nearLevel(DATA[s], i, IND[s].atr[i]) && (() => { const a = IND[s].adx[i]; return a != null && !(a >= 15 && a < 20); })();

function exposure(keep) {
  const intervals = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (keep && sig.verdict === 'BUY' && !keep(sym, i)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: 6 });
    }
    const endT = candles[candles.length - 1].t;
    for (const t of record.closed) intervals.push({ a: t.openedAt, b: t.closedAt });
    for (const s of Object.keys(record.open)) intervals.push({ a: record.open[s].openedAt, b: endT });
  }
  const opens = intervals.map((iv) => iv.a).sort((x, y) => x - y);
  let maxC = 0, maxAt = 0; const dist = {};
  for (const t of opens) { const live = intervals.filter((iv) => iv.a <= t && iv.b > t).length; dist[live] = (dist[live] || 0) + 1; if (live > maxC) { maxC = live; maxAt = t; } }
  const edges = [...new Set(intervals.flatMap((iv) => [iv.a, iv.b]))].sort((x, y) => x - y);
  let w = 0, span = 0;
  for (let i = 0; i < edges.length - 1; i++) { const dt = edges[i + 1] - edges[i]; const live = intervals.filter((iv) => iv.a <= edges[i] && iv.b > edges[i]).length; w += live * dt; span += dt; }
  const crowded = opens.filter((t) => intervals.filter((iv) => iv.a <= t && iv.b > t).length >= 5).length;
  return { n: intervals.length, maxC, maxAt, avg: span ? +(w / span).toFixed(2) : 0, crowdedShare: opens.length ? Math.round(crowded / opens.length * 100) : 0 };
}

const base = exposure(null), filt = exposure(combined);
const line = (name, e) => console.log(`  ${name.padEnd(20)} trades=${String(e.n).padStart(3)}  peak=${e.maxC} pos ($${e.maxC * RISK} = ${(e.maxC * RISK / ACCOUNT * 100).toFixed(0)}%)  avg=${e.avg}  entries into a crowded book (>=5 open)=${e.crowdedShare}%`);
console.log(`\nCONCURRENT EXPOSURE — unfiltered vs combined-filtered (${SYMS.length} markets)\n`);
line('unfiltered', base);
line('combined filter', filt);
console.log(`\n  Peak risk ${(base.maxC * RISK / ACCOUNT * 100).toFixed(0)}% → ${(filt.maxC * RISK / ACCOUNT * 100).toFixed(0)}%; crowded-entry share ${base.crowdedShare}% → ${filt.crowdedShare}%.`);
console.log('  If the filter lowers both, it improves returns AND cuts risk clustering — a double win.\n');
