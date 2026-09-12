// (b) The REAL strategy over ~10y: the CONCURRENT-SLOTS ensemble (MR slot + independent trend slot,
// matching the current scheduler.js) on the wide equity universe, by year — so we see whether the
// trend leg rescues MR's bad regime years, or whether the whole strategy is regime-dependent.
// (Still omits the dynamic adaptive dials — those widen stops / cut size after losing stretches, so
// they'd further DAMPEN the bad years; this is a with-ensemble floor, above the MR-only floor.)
//   node test/ensemble-long-backtest.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';
import { sma } from '../src/indicators.js';

const RISK = 250, COST = 6, PB = 0.30, RANGE = '10y';
const SYMS = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'DAX', 'N225', 'FTSE', 'HSI', 'KOSPI', 'CAC', 'TSX', 'SX5E'];

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

// mode: 'mr' | 'ensemble' (concurrent slots). Returns closed trades tagged with year + leg.
function run(mode) {
  const out = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} };
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      let mrSig = computeSignal(candles.slice(0, i + 1), price);
      if (mrSig.verdict === 'BUY' && typeof mrSig.pctB === 'number' && mrSig.pctB >= PB) mrSig = { ...mrSig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig: mrSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'mr', shouldExit: mrShouldExit });
      if (mode === 'ensemble') {
        const trendSig = computeTrend(candles.slice(0, i + 1), price);
        processPosition({ symbol: sym, meta, sig: trendSig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'trend', shouldExit: trendShouldExit, openMap: record.openTrend, lastCloseMap: record.lastCloseTrend });
      }
    }
    for (const t of record.closed) out.push({ ...t, sym, year: new Date(t.openedAt || t.closedAt).getUTCFullYear() });
  }
  return out;
}
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, win: 0, maxDD: 0, retDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  const srt = t.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0, pk = 0, dd = 0; for (const x of srt) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
const mr = run('mr'), en = run('ensemble');
const line = (s) => `n=${String(s.n).padStart(4)} net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} win=${String(s.win).padStart(3)}% maxDD=$${String(s.maxDD).padStart(6)} return/DD=${s.retDD}`;
console.log(`\nENSEMBLE-LONG — ${Object.keys(DATA).length} equity markets, ~${RANGE}, concurrent slots (MR + trend).\n`);
console.log('  MR-only  ', line(st(mr)));
console.log('  ENSEMBLE ', line(st(en)), `  [${en.filter((t) => (t.strat || 'mr') === 'mr').length}MR + ${en.filter((t) => t.strat === 'trend').length}tr]`);
console.log('\n  ENSEMBLE by year (does the trend leg rescue MR bad years?):');
for (const y of [...new Set(en.map((t) => t.year))].sort()) {
  const e = st(en.filter((t) => t.year === y)), m = st(mr.filter((t) => t.year === y));
  console.log(`   ${y}  ensemble pf=${String(e.pf).padStart(5)} net=$${String(e.net).padStart(6)}   |  MR-only pf=${String(m.pf).padStart(5)} net=$${m.net}`);
}
console.log('');
