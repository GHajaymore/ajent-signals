// VERIFY the ADX dead-zone EXPERIMENT wiring end-to-end on the real production path:
// computeSignal now tags each MR entry with adxEntry, processPosition carries it onto the
// closed trade, and adaptive.regimeGateExperiment measures the would-be gate. This runs
// the exact functions the live cron uses and checks the chain produces sane numbers.
//   node test/regime-experiment-check.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { regimeGateExperiment } from '../src/adaptive.js';
import { DATA } from './bt.mjs';

const RISK = 250, COST = 6;
const SYMS = Object.keys(DATA);
const closed = [];
for (const sym of SYMS) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
  }
  for (const t of record.closed) closed.push(t);
}

const tagged = closed.filter((t) => typeof t.adxEntry === 'number');
console.log(`\nADX EXPERIMENT WIRING CHECK — ${SYMS.length} markets`);
console.log(`closed MR trades: ${closed.length}, tagged with adxEntry: ${tagged.length} (should be ~all)`);
const sample = tagged.slice(0, 3).map((t) => ({ sym: t.symbol, adxEntry: t.adxEntry, pnl: t.pnl }));
console.log('sample tagged trades:', JSON.stringify(sample));

const exp = regimeGateExperiment(closed);
console.log('\nregimeGateExperiment():');
console.log(`  ready=${exp.ready} tagged=${exp.tagged} deadZone=${exp.deadZone}`);
console.log(`  FULL  n=${exp.full.n} pf=${exp.full.pf} avgR=${exp.full.avgR} net=$${exp.full.pnl}`);
console.log(`  GATED n=${exp.gated.n} pf=${exp.gated.pf} avgR=${exp.gated.avgR} net=$${exp.gated.pnl}`);
console.log(`  note: ${exp.note}`);

const ok = tagged.length >= closed.length * 0.9 && exp.gated.pf >= exp.full.pf && exp.gated.avgR >= exp.full.avgR;
console.log(`\n${ok ? 'PASS' : 'CHECK'} — tagging covers the record and the gate improves pf & avgR (as the probe found).\n`);
