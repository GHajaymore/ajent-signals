// Does the TREND-FOLLOW engine (trend.js) have a real edge on FX + commodities?
// The swing/mean-reversion recipe was already shown NOT to work on FX (phase1.mjs:
// thin, unreliable samples). But FX and commodities are trending assets, so this
// runs the EXACT production trend engine (computeTrend + its ATR trailing-stop exit)
// over long daily history per symbol and reports PF / win / avgR / n. Read-only.
//   node test/trend-newmarkets.mjs
import { fetchDailyCandles } from '../src/data.js';
import { computeTrend, TREND } from '../src/trend.js';

const GROUPS = {
  'FX majors': { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  'Commodities': { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F' },
  'Ags': { ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F' },
  'Benchmark (already live)': { ES: 'ES=F', NQ: 'NQ=F' },
};

const HOLD_BARS = 60; // ~ the trend engine's multi-week time stop, in daily bars

async function backtest(yahoo) {
  let candles;
  try { ({ candles } = await fetchDailyCandles({ yahoo, country: 'US' }, { DATA_PROVIDER: 'yahoo' })); }
  catch (e) { return { err: e.message }; }
  if (!candles || candles.length < TREND.trendSma + 40) return { err: `only ${candles ? candles.length : 0} bars` };
  const closed = [];
  let pos = null;
  for (let i = TREND.trendSma + 10; i < candles.length; i++) {
    const price = candles[i].c;
    const sig = computeTrend(candles.slice(0, i + 1));
    if (pos) {
      pos.peak = Math.max(pos.peak, price);
      const atrN = sig.atr;
      const trailLevel = (atrN && atrN > 0) ? pos.peak - TREND.trailAtrMult * atrN : -Infinity;
      const stopLevel = Math.max(pos.stop, trailLevel);
      let exit = null;
      if (price <= stopLevel) exit = price;              // trailing / initial stop
      else if (i - pos.oi >= HOLD_BARS) exit = price;    // multi-week time cap
      if (exit != null) { closed.push((exit - pos.entry) / pos.risk); pos = null; }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      pos = { entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop) || 1e-9, oi: i, peak: sig.plan.entry };
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

// PASS = a real, tradable trend edge with enough trades to trust.
const verdict = (r) => r.err ? `skip (${r.err})` : (r.pf >= 1.4 && r.avgR > 0.05 && r.n >= 25) ? 'PASS' : (r.avgR > 0 ? 'weak' : 'FAIL');

console.log('TREND engine on new markets — PASS = PF≥1.4 & avgR>0.05 & n≥25\n');
for (const [group, syms] of Object.entries(GROUPS)) {
  console.log(group);
  const results = [];
  for (const [name, y] of Object.entries(syms)) results.push([name, await backtest(y)]);
  results.sort((a, b) => (b[1].avgR || -9) - (a[1].avgR || -9));
  for (const [name, r] of results) {
    if (r.err) { console.log(`  ${name.padEnd(8)} ${verdict(r)}`); continue; }
    console.log(`  ${name.padEnd(8)} PF ${String(r.pf).padStart(5)}  win ${String(r.win).padStart(3)}%  avgR ${String(r.avgR).padStart(6)}  n=${String(r.n).padStart(3)}  → ${verdict(r)}`);
  }
  console.log('');
}
