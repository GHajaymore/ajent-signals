// Local check of the Worker's core (no Cloudflare needed): Pro-token security +
// the trading loop over ~2y of real data with an in-memory KV.  node test/sim.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';
import { issueProToken, verifyProToken } from '../src/auth.js';

function memStore() {
  const m = new Map(); const k = (pk, sk) => `${pk}|${sk}`;
  return {
    put: async (i) => { m.set(k(i.pk, i.sk), i); },
    get: async (pk, sk) => m.get(k(pk, sk)) || null,
    del: async (pk, sk) => { m.delete(k(pk, sk)); },
    all: (pk) => [...m.values()].filter((v) => v.pk === pk),
  };
}

// 1) Pro token security
const tok = await issueProToken('user123', 31, 'secret');
console.log('AUTH  valid:', await verifyProToken(tok, 'secret'),
  '| wrong-secret:', await verifyProToken(tok, 'nope'),
  '| tampered:', await verifyProToken(tok.slice(0, -2) + 'xy', 'secret'),
  '| garbage:', await verifyProToken('abc', 'secret'));

// 2) trading loop over history
for (const sym of ['ES', 'RTY', 'XJO']) {
  const meta = MARKETS[sym];
  const { candles } = await fetchDailyCandles(meta, { DATA_PROVIDER: 'yahoo' });
  const store = memStore();
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    await processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, store, now: candles[i].t, risk: 250 });
  }
  const trades = store.all('TRADE');
  const wins = trades.filter((t) => t.pnl > 0).length;
  console.log(`LOOP  ${sym.padEnd(4)} trades:${trades.length} wins:${wins} openLeft:${store.all('POS#OPEN').length}`);
}
