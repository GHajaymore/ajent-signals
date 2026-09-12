// (1) THE DEFENSE TEST: do the ADAPTIVE DIALS soften the regime-dependent bad years? The live
// scheduler recomputes computeAdaptive(pooledRecord) each tick — sizeMult (cut size after poor
// pooled expectancy) + per-engine weight (down-weight a losing engine, floor 0.5x). This runs all
// markets in ONE date-ordered timeline with ONE shared pooled record, recomputing the dials as
// trades close, so the size dial actually reacts to a losing stretch — vs the static-size ensemble.
// (Applies sizeMult + engine weight; omits stopMult, which would further help.)  ~10y equity.
//   node test/adaptive-long-backtest.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';
import { computeAdaptive } from '../src/adaptive.js';

const RISK = 250, COST = 6, PB = 0.30, RANGE = '10y';
const SYMS = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'DAX', 'N225', 'FTSE', 'HSI', 'KOSPI', 'CAC', 'TSX', 'SX5E'];
const BASE = { stopAtrMult: 2, exitAbove: 65 };

async function fetchLong(y) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=${RANGE}`;
  const r = (await (await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } })).json())?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators.quote[0], ts = r.timestamp || [], out = [];
  for (let i = 0; i < ts.length; i++) { if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] }); }
  return out;
}
const DATA = {};
for (const s of SYMS) { try { const c = await fetchLong(MARKETS[s].yahoo); if (c && c.length > 300) DATA[s] = c; } catch (e) { /* skip */ } }

// Merged, date-ordered event stream across all markets (each event = one market's bar).
const events = [];
for (const sym of Object.keys(DATA)) { const c = DATA[sym]; for (let i = 210; i < c.length; i++) events.push({ t: c[i].t, sym, i }); }
events.sort((a, b) => a.t - b.t);

function run(adaptive) {
  const record = { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} };
  let dials = null, sinceRecalc = 0;
  const closedTrades = [];
  const drain = () => { while (record.closed.length) { const t = record.closed.pop(); closedTrades.push(t); } };
  for (const ev of events) {
    const candles = DATA[ev.sym], meta = MARKETS[ev.sym], i = ev.i, price = candles[i].c, now = candles[i].t;
    let mrSig = computeSignal(candles.slice(0, i + 1), price);
    if (mrSig.verdict === 'BUY' && typeof mrSig.pctB === 'number' && mrSig.pctB >= PB) mrSig = { ...mrSig, verdict: 'NO_TRADE', direction: 0, plan: null };
    const trendSig = computeTrend(candles.slice(0, i + 1), price);
    const before = record.closed.length;
    processPosition({ symbol: ev.sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials: adaptive ? dials : null, strat: 'mr', shouldExit: mrShouldExit });
    processPosition({ symbol: ev.sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, dials: adaptive ? dials : null, strat: 'trend', shouldExit: trendShouldExit, openMap: record.openTrend, lastCloseMap: record.lastCloseTrend });
    if (adaptive && (record.closed.length > before || ++sinceRecalc >= 50)) { dials = computeAdaptive(record, BASE); sinceRecalc = 0; }
    // keep record.closed bounded (matches live cap) but archive to closedTrades for full-period stats
    if (record.closed.length > 260) { const extra = record.closed.splice(260); for (const t of extra) closedTrades.push(t); }
  }
  drain();
  return closedTrades.map((t) => ({ ...t, year: new Date(t.openedAt || t.closedAt).getUTCFullYear() }));
}
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, win: 0, maxDD: 0, retDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  const srt = t.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0, pk = 0, dd = 0; for (const x of srt) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
const staticE = run(false), adaptiveE = run(true);
const line = (s) => `n=${String(s.n).padStart(4)} net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} win=${String(s.win).padStart(3)}% maxDD=$${String(s.maxDD).padStart(6)} return/DD=${s.retDD}`;
console.log(`\nADAPTIVE-LONG — ${Object.keys(DATA).length} equity markets, ~${RANGE}, ensemble, ONE pooled record.\n`);
console.log('  STATIC size    ', line(st(staticE)));
console.log('  ADAPTIVE dials ', line(st(adaptiveE)));
console.log('\n  By year — does the size dial soften the bad years?');
for (const y of [...new Set(staticE.map((t) => t.year))].sort()) {
  const s = st(staticE.filter((t) => t.year === y)), a = st(adaptiveE.filter((t) => t.year === y));
  console.log(`   ${y}  static net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)}  ->  adaptive net=$${String(a.net).padStart(6)} pf=${String(a.pf).padStart(5)}`);
}
console.log('');
