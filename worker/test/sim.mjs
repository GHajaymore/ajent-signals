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

// 2) trading loop over history — long + PROVISIONAL short, side breakdown
const pf = (ts) => { const gw = ts.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0); const gl = Math.abs(ts.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0)); return gl ? (gw / gl).toFixed(2) : (gw ? '∞' : '0'); };
const line = (label, ts) => { const w = ts.filter((t) => t.pnl > 0).length; const p = ts.reduce((s, t) => s + t.pnl, 0); return `${label} n:${String(ts.length).padStart(3)} win:${ts.length ? Math.round(w / ts.length * 100) : 0}% PF:${String(pf(ts)).padStart(4)} pnl:${p >= 0 ? '+' : ''}${p}`; };
const allL = [], allS = [];
for (const sym of ['ES', 'NQ', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX']) {
  const meta = MARKETS[sym];
  const { candles } = await fetchDailyCandles(meta, { DATA_PROVIDER: 'yahoo' });
  const store = memStore();
  for (let i = 210; i < candles.length; i++) {
    const sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    await processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, store, now: candles[i].t, risk: 250 });
  }
  const trades = store.all('TRADE');
  const L = trades.filter((t) => t.side !== 'SHORT'), S = trades.filter((t) => t.side === 'SHORT');
  allL.push(...L); allS.push(...S);
  console.log(`${sym.padEnd(5)} ${line('LONG ', L)}   |   ${line('SHORT', S)}`);
}
console.log('----');
console.log(`POOL  ${line('LONG ', allL)}`);
console.log(`POOL  ${line('SHORT', allS)}   <- PROVISIONAL`);
