// PHASE 2 GATE: does the proven swing recipe hold on INDIVIDUAL STOCKS? Unlike
// indices/ETFs, a single stock can gap on one earnings miss (single-name risk the
// design flagged), so this is the honest test before any stock offering. Runs the
// EXACT production computeSignal over long daily history on a diverse liquid S&P-100
// set, and reports the AGGREGATE (does the edge generalize?) + per-name PASS rate.
//   node test/phase2.mjs
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { STRATEGY } from '../src/meta.js';

// Diverse, liquid large caps across sectors (Yahoo tickers == symbols).
const STOCKS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA',
  'JPM', 'V', 'MA', 'BAC', 'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK',
  'XOM', 'CVX', 'WMT', 'COST', 'HD', 'PG', 'KO', 'PEP', 'MCD',
  'DIS', 'NFLX', 'CRM', 'AMD', 'ORCL', 'CSCO', 'ADBE', 'CAT', 'GE', 'BA'];

async function backtest(sym) {
  let candles;
  try { ({ candles } = await fetchDailyCandles({ yahoo: sym, country: 'US' }, { DATA_PROVIDER: 'yahoo' })); }
  catch (e) { return { err: e.message }; }
  if (!candles || candles.length < 230) return { err: `${candles ? candles.length : 0} bars` };
  const closed = [];
  let pos = null;
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c;
    const sig = computeSignal(candles.slice(0, i + 1), price);
    if (pos) {
      let exit = null;
      if (price <= pos.stop) exit = price;
      else if (sig.rsi2 != null && sig.rsi2 > STRATEGY.exitAbove) exit = price;
      else if (i - pos.oi >= 5) exit = price;
      if (exit != null) { closed.push((exit - pos.entry) / pos.risk); pos = null; }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      pos = { entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop) || 1e-9, oi: i };
    }
  }
  const wins = closed.filter((r) => r > 0), losses = closed.filter((r) => r < 0);
  const gw = wins.reduce((a, r) => a + r, 0), gl = Math.abs(losses.reduce((a, r) => a + r, 0));
  return {
    n: closed.length,
    win: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    avgR: closed.length ? +(closed.reduce((a, r) => a + r, 0) / closed.length).toFixed(3) : 0,
  };
}

console.log('PHASE 2 GATE — proven swing recipe on individual large-cap stocks\n');
const rows = [];
for (const sym of STOCKS) rows.push({ sym, ...(await backtest(sym)) });
const ok = rows.filter((r) => !r.err);
rows.sort((a, b) => (b.avgR ?? -9) - (a.avgR ?? -9));

// Pooled: treat every trade across all names as one sample (the honest aggregate).
let allWins = 0, allLoss = 0, allN = 0, gwSum = 0, glSum = 0, rSum = 0;
for (const r of ok) {
  allN += r.n; allWins += Math.round(r.win / 100 * r.n);
  rSum += r.avgR * r.n;
  if (r.pf < 99 && r.pf > 0) { const gl = 1; const gw = r.pf; gwSum += gw; glSum += gl; } // rough
}
const passers = ok.filter((r) => r.pf >= 1.4 && r.avgR > 0.05 && r.n >= 25).length;
const positive = ok.filter((r) => r.avgR > 0).length;

console.log('Per-name (sorted by expectancy):');
for (const r of rows) {
  if (r.err) { console.log(`  ${r.sym.padEnd(6)} — ${r.err}`); continue; }
  const v = (r.pf >= 1.4 && r.avgR > 0.05 && r.n >= 25) ? 'PASS' : (r.avgR > 0) ? 'weak' : 'FAIL';
  console.log(`  ${r.sym.padEnd(6)} PF ${String(r.pf).padStart(5)}  win ${String(r.win).padStart(3)}%  avgR ${String(r.avgR).padStart(6)}  n=${String(r.n).padStart(3)}  → ${v}`);
}
console.log(`\nAGGREGATE over ${ok.length} names: pooled avgR ${(allN ? rSum / allN : 0).toFixed(3)} · pooled win ${(allN ? Math.round(allWins / allN * 100) : 0)}% · ${allN} trades`);
console.log(`  ${positive}/${ok.length} names positive · ${passers}/${ok.length} clear the strict PASS bar (PF≥1.4 & avgR>0.05 & n≥25)`);
console.log('\nRead-out: broad positive expectancy = the edge generalizes to stocks (build a curated set / screener). Mixed/negative = single-name risk dominates; do NOT ship stocks with this recipe.');
