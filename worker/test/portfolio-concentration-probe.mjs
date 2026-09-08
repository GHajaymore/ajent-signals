// PROBE (new axis — portfolio risk, not signal edge): the engine opens EVERY firing signal
// with no concurrency cap, so the paper account can hold 10+ highly-correlated positions at
// once (all US equities dip together) — effectively one big bet, not diversification. Does a
// concentration cap cut drawdown more than it cuts return (better return/DD)? Generates each
// market's real trades (post-%B recipe), then REPLAYS them on one account under different caps.
//   node test/portfolio-concentration-probe.mjs
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6, PB = 0.30;
// Correlation buckets: US equities (indices+sectors) move together; intl equities; crypto.
const BUCKET = {};
for (const s of ['ES', 'NQ', 'YM', 'RTY', 'SPY', 'QQQ', 'IWM', 'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY']) BUCKET[s] = 'us';
for (const s of ['SX5E', 'N225', 'TSX', 'FTSE', 'DAX', 'HSI', 'NIFTY', 'SENSEX', 'BNF', 'SSE', 'KOSPI', 'CAC']) BUCKET[s] = 'intl';
for (const s of ['BTC', 'ETH']) BUCKET[s] = 'crypto';
const CRYPTO = new Set(['BTC', 'ETH']);
const SYMS = Object.keys(BUCKET);

const DATA = {};
for (const sym of SYMS) { if (!MARKETS[sym]) continue; try { const { candles } = await fetchDailyCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 260) DATA[sym] = candles; } catch (e) { /* skip */ } }

// Real trades per market (with confidence + bucket), post-%B recipe.
const trades = [];
for (const sym of Object.keys(DATA)) {
  const candles = DATA[sym], meta = MARKETS[sym], record = { open: {}, closed: [], lastClose: {} };
  const confAt = {};
  for (let i = 210; i < candles.length; i++) {
    let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
    if (!CRYPTO.has(sym) && sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
    if (sig.verdict === 'BUY') confAt[candles[i].t] = sig.confidence || 75;
    processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
  }
  for (const t of record.closed) trades.push({ sym, bucket: BUCKET[sym], openedAt: t.openedAt, closedAt: t.closedAt, pnl: t.pnl, conf: confAt[t.openedAt] || 75 });
}
// Entry order: by date, then by confidence desc (when a cap binds, keep the strongest signals).
trades.sort((a, b) => a.openedAt - b.openedAt || b.conf - a.conf);

// Replay under a concentration policy. globalMax = max total concurrent; bucketMax = max per bucket.
function replay({ globalMax = Infinity, bucketMax = Infinity }) {
  const open = []; // {closedAt, bucket}
  const accepted = [];
  for (const t of trades) {
    // free positions that closed on/before this entry
    for (let k = open.length - 1; k >= 0; k--) if (open[k].closedAt <= t.openedAt) open.splice(k, 1);
    const glob = open.length, buck = open.filter((o) => o.bucket === t.bucket).length;
    if (glob >= globalMax || buck >= bucketMax) continue; // capped — skip this signal
    open.push({ closedAt: t.closedAt, bucket: t.bucket });
    accepted.push(t);
  }
  // Equity curve by close date.
  accepted.sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0, pk = 0, dd = 0; const w = accepted.filter((x) => x.pnl > 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(accepted.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  for (const x of accepted) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: accepted.length, net: Math.round(eq), maxDD: Math.round(dd), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / (accepted.length || 1)), retDD: +(eq / -(dd || 1)).toFixed(2) };
}
const fmt = (p) => `n=${String(p.n).padStart(3)} net=$${String(p.net).padStart(6)} maxDD=$${String(p.maxDD).padStart(6)} pf=${String(p.pf).padStart(5)} win=${p.win}% return/DD=${p.retDD}`;

// How concentrated does it actually get (max simultaneous open under no cap)?
let peak = 0, peakUS = 0; { const open = []; for (const t of trades) { for (let k = open.length - 1; k >= 0; k--) if (open[k].closedAt <= t.openedAt) open.splice(k, 1); open.push({ closedAt: t.closedAt, bucket: t.bucket }); peak = Math.max(peak, open.length); peakUS = Math.max(peakUS, open.filter((o) => o.bucket === 'us').length); } }
console.log(`\nPORTFOLIO CONCENTRATION PROBE — ${Object.keys(DATA).length} markets, one account, post-%B.`);
console.log(`Peak simultaneous open (no cap): ${peak} total, ${peakUS} US-equity (correlated).\n`);
console.log('  no cap             ', fmt(replay({})));
console.log('  --- global cap ---');
for (const g of [4, 6, 8, 10]) console.log(`  global max ${String(g).padStart(2)}       `, fmt(replay({ globalMax: g })));
console.log('  --- per-bucket cap (limit correlated exposure) ---');
for (const b of [2, 3, 4]) console.log(`  bucket max ${b}         `, fmt(replay({ bucketMax: b })));
console.log('  --- combined ---');
console.log('  bucket 3 + global 6', fmt(replay({ bucketMax: 3, globalMax: 6 })));
console.log('');
