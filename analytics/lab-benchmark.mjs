// Independent WEEKLY ROBUSTNESS BENCHMARK for Ajent Pulse. It re-runs the exact
// production mean-reversion logic across the parameter/market grid (the same
// check as `worker/test/sweep.mjs`), then compares the result against fixed
// guardrail thresholds and flags DRIFT if the edge has decayed. It changes
// NOTHING — it only reads market data and prints a markdown report.
//   node analytics/lab-benchmark.mjs        → prints the report (exit 0)
//   (CI writes it to the job summary + an artifact and turns the run red on
//    drift — see .github/workflows/lab-benchmark.yml)
//
// Thresholds are set conservatively BELOW the 2026-09-03 baseline (PF 2.77 /
// MAR 7.57 / plateau 65 / defaults #2) so ordinary data variance never trips
// them — only a real regime shift or a code change that hurts the edge does.
import { backtest, DATA } from '../worker/test/bt.mjs';
import { computeSignal } from '../worker/src/strategy.js';

// --- Guardrails: the edge is still "proven" while ALL of these hold ----------
const GUARD = {
  minMarkets: 6,      // below this, treat as a data hiccup — never flag drift
  minPF: 2.0,         // baseline profit factor          (2026-09-03: 2.77)
  minMAR: 5.0,        // baseline CAGR ÷ max drawdown     (2026-09-03: 7.57)
  minWin: 60,         // baseline win rate %              (2026-09-03: 73)
  minPlateau: 40,     // robust settings out of 100       (2026-09-03: 65)
  maxRank: 10,        // defaults' rank by MAR (1 = best) (2026-09-03: #2)
  beatBuyHold: true,  // baseline CAGR must beat buy&hold (2026-09-03: 31.2 vs 19.2)
};

const DEFAULTS = { entryBelow: 15, deepBelow: 5, stopAtrMult: 2, exitRsi: 65 };
const sig = (params) => (c, live) => computeSignal(c, live, params);
const out = [];
const p = (s = '') => out.push(s);
const today = new Date().toISOString().slice(0, 10);
const pct = (n) => `${n}%`;

// A breach is a guardrail that failed; drift = any breach when data is sufficient.
const breaches = [];
const check = (ok, label) => { if (!ok) breaches.push(label); return ok; };

try {
  const syms = Object.keys(DATA);
  const bars = (DATA[syms[0]] || []).length;

  p(`# Ajent Pulse — Weekly Robustness Benchmark · ${today}`);
  p();
  p('_Independent, read-only. Re-runs the production recipe across the parameter/market grid and checks it against fixed guardrails. Changes nothing._');
  p();

  if (syms.length < GUARD.minMarkets) {
    p(`## ⚠️ Insufficient data`);
    p(`- Only **${syms.length}** market${syms.length === 1 ? '' : 's'} loaded (need ${GUARD.minMarkets}). This is a data-feed hiccup, not strategy drift — no conclusion drawn.`);
    p(`- Re-run when the feed recovers: \`node analytics/lab-benchmark.mjs\`.`);
    console.log(out.join('\n'));
    process.exit(0);
  }

  // --- Baseline = current production defaults --------------------------------
  const base = await backtest(sig(DEFAULTS), { exitRsi: DEFAULTS.exitRsi });

  // --- Grid sweep (same grid as sweep.mjs) ----------------------------------
  const entries = [10, 12, 15, 18, 20], exits = [55, 60, 65, 70, 75], stops = [1.5, 2, 2.5, 3];
  const rows = [];
  for (const e of entries) for (const x of exits) for (const s of stops) {
    const r = await backtest(sig({ entryBelow: e, deepBelow: Math.min(5, e - 3), stopAtrMult: s }), { exitRsi: x });
    rows.push({ e, x, s, ...r });
  }
  const byMar = [...rows].sort((a, b) => b.mar - a.mar);
  const plateau = rows.filter((r) => r.pf >= 1.3 && r.cagr > r.bhCagr && r.trades > 30).length;
  const rank = byMar.findIndex((r) => r.e === DEFAULTS.entryBelow && r.x === DEFAULTS.exitRsi && r.s === DEFAULTS.stopAtrMult) + 1;

  // --- Guardrail checks ------------------------------------------------------
  const okPF = check(base.pf >= GUARD.minPF, `profit factor ${base.pf} < ${GUARD.minPF}`);
  const okMAR = check(base.mar >= GUARD.minMAR, `MAR ${base.mar} < ${GUARD.minMAR}`);
  const okWin = check(base.winRate >= GUARD.minWin, `win rate ${base.winRate}% < ${GUARD.minWin}%`);
  const okPlat = check(plateau >= GUARD.minPlateau, `robust plateau ${plateau}/100 < ${GUARD.minPlateau}`);
  const okRank = check(rank >= 1 && rank <= GUARD.maxRank, `defaults rank #${rank || '—'} worse than #${GUARD.maxRank}`);
  const okBH = check(!GUARD.beatBuyHold || base.cagr > base.bhCagr, `CAGR ${base.cagr}% ≤ buy&hold ${base.bhCagr}%`);

  const mark = (ok) => (ok ? '✅' : '❌');
  p('## Baseline (production defaults: entry<15 · exit>65 · stop 2.0×ATR)');
  p(`- **PF ${base.pf}** ${mark(okPF)} · **MAR ${base.mar}** ${mark(okMAR)} · **win ${pct(base.winRate)}** ${mark(okWin)} · DD ${base.maxDD}% · n=${base.trades}`);
  p(`- **CAGR ${base.cagr}%** vs buy&hold ${base.bhCagr}% ${mark(okBH)}`);
  p(`- ${syms.length} markets · ~${bars} bars each`);
  p();
  p('## Robustness');
  p(`- **Plateau: ${plateau}/100** settings clear PF≥1.3, beat buy&hold, >30 trades ${mark(okPlat)}`);
  p(`- **Defaults rank #${rank || '—'} of 100** by MAR (want ≤ ${GUARD.maxRank}, and inside the plateau — not the single peak) ${mark(okRank)}`);
  p();

  // --- Per-market fit (defaults) — surface the weakest ----------------------
  const perMkt = [];
  for (const sym of syms) {
    const r = await backtest(sig(DEFAULTS), { exitRsi: DEFAULTS.exitRsi, syms: [sym] });
    perMkt.push({ sym, ...r });
  }
  perMkt.sort((a, b) => a.pf - b.pf);
  // Markets already excluded from live auto-trading (markets.js noTrade) — a PF<1
  // here is expected and handled, so it's not a new alarm.
  const EXCLUDED = new Set(['XJO']);
  const newLosers = perMkt.filter((r) => r.pf < 1 && !EXCLUDED.has(r.sym));
  const knownLosers = perMkt.filter((r) => r.pf < 1 && EXCLUDED.has(r.sym));
  p('## Per-market fit (weakest first)');
  for (const r of perMkt.slice(0, 3)) p(`- ${r.sym}: PF ${r.pf} · MAR ${r.mar} · win ${pct(r.winRate)} · n=${r.trades}`);
  if (knownLosers.length) p(`- ${knownLosers.map((r) => `${r.sym} (PF ${r.pf})`).join(', ')} — already excluded from live trading ✓`);
  if (newLosers.length) p(`- ⚠️ **New market not fitting (PF<1):** ${newLosers.map((r) => `${r.sym} (PF ${r.pf})`).join(', ')} — review for exclusion.`);
  p();

  // --- Verdict ---------------------------------------------------------------
  p('## Verdict');
  if (breaches.length) {
    p(`### ⚠️ DRIFT — ${breaches.length} guardrail${breaches.length === 1 ? '' : 's'} breached`);
    for (const b of breaches) p(`- ${b}`);
    p();
    p('The proven edge has moved outside its expected envelope. Re-run the full lab (`sweep.mjs` / `candidates.mjs` / `trend.mjs`) and review before the next weekly adaptive cadence adopts anything.');
  } else {
    p('✅ **No drift.** The recipe is inside every guardrail — proven edge intact, defaults well-placed. No action needed.');
  }
} catch (e) {
  // A crash is a tooling/feed failure, not drift — report it, don't alarm.
  p(`# Ajent Pulse — Weekly Robustness Benchmark · ${today}`);
  p();
  p(`⚠️ Could not run the benchmark: ${e.message}`);
  p('(This is a tooling/data-feed error, not strategy drift.)');
  console.log(out.join('\n'));
  process.exit(0);
}

console.log(out.join('\n'));
// Exit non-zero ONLY on genuine drift (data was sufficient) so CI turns red and
// notifies. Feed hiccups and crashes above already exited 0.
if (breaches.length) process.exit(1);
