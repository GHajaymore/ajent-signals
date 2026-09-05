// Verify the SHIPPED both-ways engine (src/bothways.js) reproduces the edge the
// promotion gate validated — i.e. the production code, not just the lab's inline
// conditions, actually trades the FX/commodity cells profitably both ways.
//   node test/bothways-engine.mjs
import { fetchDailyCandles } from '../src/data.js';
import { computeBothMR, bothMRShouldExit } from '../src/bothways.js';

const CELLS = {
  fx: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  commodity: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F' },
};

function backtest(candles, cell) {
  const trades = []; let pos = null;
  for (let i = 60; i < candles.length; i++) {
    const sub = candles.slice(0, i + 1);
    const sig = computeBothMR(sub, null, cell);
    const price = candles[i].c, now = candles[i].t;
    if (pos) {
      const ex = bothMRShouldExit(sig, pos, price, now);
      if (ex) { const r = (pos.dir * (price - pos.entry)) / pos.risk; trades.push({ r, dir: pos.dir }); pos = null; }
    }
    if (!pos && (sig.verdict === 'BUY' || sig.verdict === 'SELL')) {
      const dir = sig.direction;
      pos = { dir, entry: sig.plan.entry, stop: sig.plan.stop, risk: sig.plan.risk, side: dir < 0 ? 'SHORT' : 'LONG', maxHoldMin: sig.plan.maxHoldMin, openedAt: now };
    }
  }
  return trades;
}

let fail = 0;
for (const [cell, syms] of Object.entries(CELLS)) {
  let all = [];
  for (const y of Object.values(syms)) {
    try { const { candles } = await fetchDailyCandles({ yahoo: y, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 300) all = all.concat(backtest(candles, cell)); }
    catch (e) { /* skip */ }
  }
  const R = all.map((t) => t.r), w = R.filter((r) => r > 0), l = R.filter((r) => r < 0);
  const gw = w.reduce((a, r) => a + r, 0), gl = Math.abs(l.reduce((a, r) => a + r, 0));
  const sh = all.filter((t) => t.dir < 0), shR = sh.reduce((a, t) => a + t.r, 0) / (sh.length || 1);
  const pf = gl ? +(gw / gl).toFixed(2) : 99, avgR = R.length ? +(R.reduce((a, r) => a + r, 0) / R.length).toFixed(3) : 0;
  const pass = pf >= 1.3 && avgR > 0.05 && R.length >= 40 && shR > 0;
  if (!pass) fail++;
  console.log(`${cell.padEnd(10)} pf ${String(pf).padStart(5)} win ${String(R.length ? Math.round(w.length / R.length * 100) : 0).padStart(3)}% avgR ${String(avgR).padStart(6)} n=${String(R.length).padStart(3)} | short avgR ${shR.toFixed(3)} (n=${sh.length}) → ${pass ? '✅ edge holds' : '❌ REGRESSED'}`);
}
console.log(`\nbothways-engine.mjs — ${fail === 0 ? 'all cells hold the edge ✅' : fail + ' cell(s) regressed ❌'}`);
if (fail) process.exit(1);
