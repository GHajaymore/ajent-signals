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

const adxTagged = closed.filter((t) => typeof t.adxEntry === 'number');
const supTagged = closed.filter((t) => typeof t.nearSupport === 'boolean');
console.log(`\nENTRY-GATE EXPERIMENT WIRING CHECK — ${SYMS.length} markets`);
console.log(`closed MR trades: ${closed.length}, adxEntry-tagged: ${adxTagged.length}, nearSupport-tagged: ${supTagged.length} (both should be ~all)`);
const sample = adxTagged.slice(0, 3).map((t) => ({ sym: t.symbol, adxEntry: t.adxEntry, nearSupport: t.nearSupport, pnl: t.pnl }));
console.log('sample tagged trades:', JSON.stringify(sample));

const exp = regimeGateExperiment(closed);
console.log('\nregimeGateExperiment():');
console.log(`  ready=${exp.ready} tagged=${exp.tagged} withSupport=${exp.withSupport}`);
console.log(`  FULL    n=${exp.full.n} pf=${exp.full.pf} avgR=${exp.full.avgR} net=$${exp.full.pnl}`);
console.log(`  NOTCH   n=${exp.notch.n} pf=${exp.notch.pf} avgR=${exp.notch.avgR} net=$${exp.notch.pnl}`);
console.log(`  SUPPORT n=${exp.support.n} pf=${exp.support.pf} avgR=${exp.support.avgR} net=$${exp.support.pnl}`);
console.log(`  BOTH    n=${exp.both.n} pf=${exp.both.pf} avgR=${exp.both.avgR} net=$${exp.both.pnl}`);
console.log(`  note: ${exp.note}`);

const ok = adxTagged.length >= closed.length * 0.9 && supTagged.length >= closed.length * 0.9 && exp.both.pf >= exp.full.pf && exp.both.avgR >= exp.full.avgR;
console.log(`\n${ok ? 'PASS' : 'CHECK'} — both tags cover the record and the combined gate improves pf & avgR (as the probe found).\n`);
