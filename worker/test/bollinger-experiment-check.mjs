// Verify the Bollinger %B measured experiment end to end: MR entries tag pbEntry, it flows to
// closed trades, and bollingerBandExperiment() produces the crypto-excluded counterfactual.
//   node test/bollinger-experiment-check.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { DATA } from './bt.mjs';
import { bollingerBandExperiment } from '../src/adaptive.js';

const RISK = 250, COST = 6;
const closed = [];
for (const sym of Object.keys(DATA)) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
  }
  for (const t of record.closed) closed.push(t);
}
const withPb = closed.filter((c) => typeof c.pbEntry === 'number');
console.log(`\nMR closed trades: ${closed.length}, tagged with pbEntry: ${withPb.length}`);
console.log(`sample pbEntry values: ${withPb.slice(0, 6).map((c) => `${c.symbol}=${c.pbEntry}`).join(', ')}`);
console.log('\nbollingerBandExperiment(closed):');
console.log(JSON.stringify(bollingerBandExperiment(closed), null, 2));
