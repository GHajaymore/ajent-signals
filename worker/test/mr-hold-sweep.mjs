// MR TIME-STOP (max-hold) SWEEP — the one exit axis never tested (mr-exit-sweep + exit-tuning-probe
// only swept the RSI-recovery THRESHOLD, not the HOLD DURATION). Live book says it matters: MR
// RSI-recovery exits are 88% win / +$2,848, but timeStop trades are 15% win / −$1,049, and losers
// drag ~4.8d vs winners ~2.4d — i.e. a dip that hasn't reverted in a few days is a failed setup
// bleeding to the 5-day cap. Does cutting the hold shorter robustly raise expectancy/PF? Swept with
// the adopted %B<0.30 gate, equity universe, ~10y, IS/OOS split + per-market so a fit is exposed.
//   node test/mr-hold-sweep.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6, PB = 0.30, RANGE = '10y';
const SYMS = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'DAX', 'N225', 'FTSE', 'HSI', 'KOSPI', 'CAC', 'TSX', 'SX5E'];
const HOLDS = [2, 3, 4, 5, 7, 10]; // days; 5 = current live default

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

function run(holdDays) {
  const holdMin = holdDays * 24 * 60;
  const out = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} };
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      let sig = computeSignal(candles.slice(0, i + 1), price);
      if (sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      if (sig.plan) sig.plan = { ...sig.plan, maxHoldMin: holdMin }; // override the hold cap under test
      processPosition({ symbol: sym, meta, sig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'mr', shouldExit: mrShouldExit });
    }
    for (const t of record.closed) out.push({ ...t, sym });
  }
  return out;
}
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, win: 0, maxDD: 0, retDD: 0, exp: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  const srt = t.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0, pk = 0, dd = 0; for (const x of srt) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2), exp: Math.round(eq / t.length) };
};
const line = (s) => `n=${String(s.n).padStart(4)} net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} win=${String(s.win).padStart(3)}% exp=$${String(s.exp).padStart(4)} maxDD=$${String(s.maxDD).padStart(6)} ret/DD=${s.retDD}`;
function isoos(t) { const srt = t.slice().sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0)); const mid = srt[Math.floor(srt.length / 2)]?.openedAt || 0; return [srt.filter((x) => (x.openedAt || 0) < mid), srt.filter((x) => (x.openedAt || 0) >= mid)]; }

console.log(`\nMR HOLD SWEEP — ${Object.keys(DATA).length} equity markets, ~${RANGE}, %B<${PB}. Does a shorter time stop cut the dead-money losers?\n`);
for (const h of HOLDS) {
  const all = run(h); const [is, oos] = isoos(all);
  const tag = h === 5 ? ' (current)' : '';
  console.log(`  hold=${h}d${tag}`);
  console.log(`    FULL ${line(st(all))}`);
  console.log(`    IS   ${line(st(is))}`);
  console.log(`    OOS  ${line(st(oos))}`);
}
console.log('');
