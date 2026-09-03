// Fast invariant tests for the critical worker logic — a regression net after all
// the ensemble/adaptive/non-disclosure work. No framework: assert + count.
//   node test/unit.mjs   (exits non-zero on any failure)
import { STRATEGY, publicStrategy } from '../src/meta.js';
import { computeAdaptive, perEngineWeights, ADAPT } from '../src/adaptive.js';
import { mrShouldExit } from '../src/scheduler.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { highImpactToday } from '../src/calendar.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log(`  ✗ ${msg}`); } };

// --- Non-disclosure: the public strategy must NOT carry the recipe -----------
const pub = JSON.stringify(publicStrategy(null));
for (const secret of ['entryBelow', 'exitAbove', 'deepBelow', 'stopAtrMult', 'trendSma', 'indicatorPeriod', 'RSI', 'Connors', 'Bollinger']) {
  ok(!pub.includes(secret), `publicStrategy leaks "${secret}"`);
}
ok(publicStrategy(null).name === 'Ajent Pulse', 'public name is Ajent Pulse');
ok(!!publicStrategy(null).approach, 'public approach blurb present');

// --- Adaptive dials: bounded + gated ----------------------------------------
const few = computeAdaptive({ closed: [{ pnl: 100, strat: 'mr' }] }, STRATEGY);
ok(few.learning === true, 'adaptive learns with a tiny sample');
ok(few.stopMult === STRATEGY.stopAtrMult && few.sizeMult === 1, 'defaults hold while learning');
const many = computeAdaptive({ closed: Array.from({ length: 80 }, (_, i) => ({ pnl: i % 3 ? 300 : -100, exitReason: 'rsiRecover', strat: 'mr' })) }, STRATEGY);
ok(many.stopMult >= ADAPT.stop.min && many.stopMult <= ADAPT.stop.max, 'stopMult within bounds');
ok(many.sizeMult >= ADAPT.size.min && many.sizeMult <= ADAPT.size.max, 'sizeMult within bounds');

// --- Per-engine weights: bounded + gated ------------------------------------
const ew = perEngineWeights([...Array.from({ length: 30 }, () => ({ pnl: 200, strat: 'trend' })), { pnl: -50, strat: 'mr' }]);
ok(ew.trend.weight >= ADAPT.engineWeight.min && ew.trend.weight <= ADAPT.engineWeight.max, 'trend weight within bounds');
ok(ew.mr.learning === true && ew.mr.weight === 1, 'engine stays 1.0 while under-sampled');

// --- Exit rules --------------------------------------------------------------
const longPos = { side: 'LONG', stop: 90, openedAt: 0, maxHoldMin: 9e9, exitAbove: 65 };
ok(mrShouldExit({ rsi2: 40 }, longPos, 95, 1) === null, 'MR holds when above stop & not recovered');
ok(mrShouldExit({ rsi2: 70 }, longPos, 95, 1) === 'rsiRecover', 'MR books profit on recovery');
ok(mrShouldExit({ rsi2: 40 }, longPos, 89, 1) === 'stop', 'MR stops out below the stop');
const tPos = { side: 'LONG', stop: 90, openedAt: 0, maxHoldMin: 9e9 };
ok(trendShouldExit({ trendMA: 100 }, tPos, 95, 1) === 'trendBreak', 'trend exits below the follow-MA');
ok(trendShouldExit({ trendMA: 100 }, tPos, 105, 1) === null, 'trend holds above the follow-MA');
ok(trendShouldExit({ trendMA: 100 }, tPos, 88, 1) === 'stop', 'trend stops out below the stop');

// --- News/event filter -------------------------------------------------------
ok(highImpactToday('US', new Date('2026-09-04T12:00:00Z')) != null, 'US jobs report flagged (first Friday)');
ok(highImpactToday('US', new Date('2026-09-10T12:00:00Z')) == null, 'ordinary day is clear');
ok(highImpactToday('JP', new Date('2026-09-04T12:00:00Z')) == null, 'US events do not hit JP');

// --- Trend engine ------------------------------------------------------------
// Synthetic uptrend: rising line → should be an uptrend above a rising MA.
const upC = Array.from({ length: 260 }, (_, i) => ({ t: i * 86400000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i }));
ok(computeTrend(upC).verdict === 'BUY', 'trend fires in a clean uptrend');
const flatC = Array.from({ length: 260 }, (_, i) => ({ t: i * 86400000, o: 100, h: 101, l: 99, c: 100 }));
ok(computeTrend(flatC).verdict === 'NO_TRADE', 'trend stands aside in a flat market');

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
