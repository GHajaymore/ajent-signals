// PHASE 1 GATE: does the proven swing recipe (Ajent Pulse mean-reversion) actually
// hold on FOREX majors and SECTOR ETFs? Honest-numbers rule: a cell only goes live
// if the edge is real HERE. This runs the EXACT production computeSignal over long
// daily history per symbol and reports PF / win / expectancy — the evidence to
// decide which Phase-1 markets (if any) are worth adding. Read-only.
//   node test/phase1.mjs
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { STRATEGY } from '../src/meta.js';

// Sector/thematic ETFs are NEW underlyings (unlike SPY/QQQ, which just mirror the
// index futures we already trade). Forex majors are a genuinely different asset.
const FOREX = { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X' };
const ETF = { XLK: 'XLK', XLF: 'XLF', XLE: 'XLE', XLV: 'XLV', XLY: 'XLY', XLI: 'XLI', SMH: 'SMH', XLU: 'XLU' };

async function backtest(yahoo) {
  let candles;
  try { ({ candles } = await fetchDailyCandles({ yahoo, country: 'US' }, { DATA_PROVIDER: 'yahoo' })); }
  catch (e) { return { err: e.message }; }
  if (!candles || candles.length < 230) return { err: `only ${candles ? candles.length : 0} bars` };
  const closed = [];
  let pos = null;
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c;
    const sig = computeSignal(candles.slice(0, i + 1), price);
    if (pos) {
      let exit = null;
      if (price <= pos.stop) exit = price;                       // volatility stop
      else if (sig.rsi2 != null && sig.rsi2 > STRATEGY.exitAbove) exit = price; // reverted to mean
      else if (i - pos.oi >= 5) exit = price;                    // 5-day time cap
      if (exit != null) { closed.push((exit - pos.entry) / pos.risk); pos = null; }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      pos = { entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop) || 1e-9, oi: i };
    }
  }
  const wins = closed.filter((r) => r > 0), losses = closed.filter((r) => r < 0);
  const gw = wins.reduce((a, r) => a + r, 0), gl = Math.abs(losses.reduce((a, r) => a + r, 0));
  const years = (candles[candles.length - 1].t - candles[210].t) / (365.25 * 24 * 3600 * 1000) || 1;
  return {
    n: closed.length,
    win: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    avgR: closed.length ? +(closed.reduce((a, r) => a + r, 0) / closed.length).toFixed(3) : 0,
    perYr: Math.round(closed.length / years),
  };
}

async function run(label, set) {
  console.log(`\n${label}`);
  const rows = [];
  for (const [sym, y] of Object.entries(set)) {
    const r = await backtest(y);
    rows.push({ sym, ...r });
  }
  rows.sort((a, b) => (b.avgR ?? -9) - (a.avgR ?? -9));
  for (const r of rows) {
    if (r.err) { console.log(`  ${r.sym.padEnd(8)} — ${r.err}`); continue; }
    const verdict = (r.pf >= 1.4 && r.avgR > 0.05 && r.n >= 25) ? 'PASS' : (r.pf >= 1.1 && r.avgR > 0) ? 'weak' : 'FAIL';
    console.log(`  ${r.sym.padEnd(8)} PF ${String(r.pf).padStart(5)}  win ${String(r.win).padStart(3)}%  avgR ${String(r.avgR).padStart(6)}  n=${String(r.n).padStart(3)}  → ${verdict}`);
  }
  return rows;
}

console.log('PHASE 1 GATE — proven swing recipe on new markets (long daily history)');
console.log('PASS = PF≥1.4 & avgR>0.05 & n≥25 (a real, tradable edge). Bench: index PF ~2.6+.');
await run('FOREX majors', FOREX);
await run('SECTOR ETFs', ETF);
console.log('\nRead-out: only PASS symbols are candidates to go live as a Phase-1 cell; the rest are honestly not tradable with this recipe (like crypto).');
