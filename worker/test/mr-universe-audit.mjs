// AUDIT: the MR backtest validates only 10 markets (ES NQ YM RTY XJO SX5E N225 TSX BTC ETH),
// but the live equity engine ALSO trades sector ETFs (XLF XLE XLV XLK SMH XLY SPY QQQ IWM) and
// more indices (FTSE DAX HSI NIFTY SENSEX BNF SSE KOSPI CAC) — none per-market validated. This
// is a WHERE-to-trade question (not param tuning): does the MR edge actually hold on every
// market we trade? Runs the LIVE recipe (computeSignal + adopted %B<0.30 gate on non-crypto)
// per market and flags any with no/negative edge.   node test/mr-universe-audit.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6, PB_ADOPT_MAX = 0.30;
// Every MR-eligible symbol (indices + ETFs + crypto). FX/commodities route to the both-ways engine.
const MR_SYMS = ['ES', 'NQ', 'YM', 'RTY', 'SPY', 'QQQ', 'IWM', 'XJO', 'SX5E', 'N225', 'TSX', 'FTSE', 'DAX', 'HSI', 'NIFTY', 'SENSEX', 'BNF', 'SSE', 'KOSPI', 'CAC', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'BTC', 'ETH'];
const CORE10 = new Set(['ES', 'NQ', 'YM', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX', 'BTC', 'ETH']);
const CRYPTO = new Set(['BTC', 'ETH']);

const DATA = {};
for (const sym of MR_SYMS) {
  if (!MARKETS[sym]) { console.log(`  (not in MARKETS: ${sym})`); continue; }
  try { const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 260) DATA[sym] = candles; else console.log(`  (thin/no data: ${sym})`); }
  catch (e) { console.log(`  (fetch fail: ${sym})`); }
}

function runMarket(sym) {
  const candles = DATA[sym], meta = MARKETS[sym], record = { open: {}, closed: [], lastClose: {} };
  for (let i = 210; i < candles.length; i++) {
    let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    if (!CRYPTO.has(sym) && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB_ADOPT_MAX) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
  }
  return record.closed;
}
function st(t) {
  if (!t.length) return { n: 0, win: 0, avgR: 0, pf: 0, pnl: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
}
const rows = [];
for (const sym of MR_SYMS) { if (!DATA[sym]) continue; rows.push({ sym, core: CORE10.has(sym), crypto: CRYPTO.has(sym), s: st(runMarket(sym)) }); }
rows.sort((a, b) => a.s.avgR - b.s.avgR); // worst edge first

console.log(`\nMR UNIVERSE AUDIT — ${rows.length} markets, live recipe (computeSignal + %B<0.30 gate on equities). Sorted worst→best avgR.\n`);
console.log('  SYM     tag        n   win   avgR    pf    net$');
for (const r of rows) {
  const tag = r.crypto ? 'crypto' : r.core ? 'core10' : 'UNVALID';
  const flag = r.s.n >= 8 && (r.s.avgR < 0.05 || r.s.pf < 1.2) ? '  ⚠ weak' : '';
  console.log(`  ${r.sym.padEnd(7)} ${tag.padEnd(8)} ${String(r.s.n).padStart(3)}  ${String(r.s.win).padStart(3)}%  ${String(r.s.avgR).padStart(6)}  ${String(r.s.pf).padStart(4)}  ${String(r.s.pnl).padStart(6)}${flag}`);
}
// Aggregate: core10 vs the untested extension (non-crypto, non-core).
const agg = (f) => { const all = []; for (const r of rows) if (f(r)) all.push(...runMarket(r.sym)); return st(all); };
console.log('\nAGGREGATE:');
console.log('  core10 (validated)      ', JSON.stringify(st([].concat(...rows.filter((r) => r.core).map((r) => runMarket(r.sym))))));
console.log('  extension (untested eq) ', JSON.stringify(st([].concat(...rows.filter((r) => !r.core && !r.crypto).map((r) => runMarket(r.sym))))));
console.log('  crypto                  ', JSON.stringify(st([].concat(...rows.filter((r) => r.crypto).map((r) => runMarket(r.sym))))));
console.log('');
