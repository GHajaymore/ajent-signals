// PROMOTION GATE — the mechanical decision of whether a candidate strategy earns a
// place in Ajent Pulse (a new cell, or a recipe change). A high pooled backtest is
// necessary but NOT sufficient — that's how you overfit. A candidate must also clear:
//   1. Pooled edge      — pf≥1.3, avgR>0.05, n≥40 on all history.
//   2. Walk-forward     — positive in ≥2/3 sequential time folds (not one lucky era).
//   3. Out-of-sample    — positive on symbols held out of the search.
//   4. Robust plateau   — the parameter NEIGHBOURS also work (not a lone spike).
//   5. Short side       — for a both-ways cell, shorts avgR>0 (the whole point).
// Only a candidate that PASSES all five should be promoted (server-side, versioned).
//   node test/promote.mjs
import { fetchDailyCandles } from '../src/data.js';
import { sma, rsi, bollinger, stochastic, roc, macd, atr } from '../src/indicators.js';

// ---- candidates under test (add rows to vet more) -----------------------------
const CANDIDATES = [
  { name: 'FX · RSI14 symmetric MR (both)', group: 'FX', direction: 'both',
    conds: [{ ind: 'rsi', period: 14, lower: 30 }],
    neighbours: [[{ ind: 'rsi', period: 10, lower: 30 }], [{ ind: 'rsi', period: 21, lower: 30 }], [{ ind: 'rsi', period: 14, lower: 25 }], [{ ind: 'rsi', period: 14, lower: 35 }]] },
  { name: 'FX · Bollinger 2σ MR (both)', group: 'FX', direction: 'both',
    conds: [{ ind: 'boll', period: 20, mult: 2 }],
    neighbours: [[{ ind: 'boll', period: 20, mult: 1.5 }], [{ ind: 'boll', period: 20, mult: 2.5 }], [{ ind: 'boll', period: 15, mult: 2 }], [{ ind: 'boll', period: 25, mult: 2 }]] },
  { name: 'FX · Stochastic MR (both)', group: 'FX', direction: 'both',
    conds: [{ ind: 'stoch', period: 14, lower: 20 }],
    neighbours: [[{ ind: 'stoch', period: 10, lower: 20 }], [{ ind: 'stoch', period: 21, lower: 20 }], [{ ind: 'stoch', period: 14, lower: 15 }], [{ ind: 'stoch', period: 14, lower: 25 }]] },
  { name: 'Commodities · RSI2+SMA50+ROC (both)', group: 'Commodities', direction: 'both',
    conds: [{ ind: 'rsi', period: 2, lower: 15 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }],
    neighbours: [[{ ind: 'rsi', period: 2, lower: 10 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 2, lower: 20 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 3, lower: 15 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 2, lower: 15 }, { ind: 'ma', period: 40 }, { ind: 'roc', period: 12 }]] },
  // Widening probes (2026-09-04): do rates / ags clear the gate? VERDICT — NEITHER ships.
  // Ags = clear FAIL (pf 0.63, negative expectancy). Rates = promising (pf 2.01, shorts
  // +0.135) but UNDER-SAMPLED (n=23 across only 3 Treasury instruments, fails n≥40/OOS).
  // Rates stays a WATCH candidate — re-run as data accumulates or with more instruments.
  { name: 'Rates · RSI2+SMA50+ROC (both)', group: 'Rates', direction: 'both',
    conds: [{ ind: 'rsi', period: 2, lower: 15 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }],
    neighbours: [[{ ind: 'rsi', period: 2, lower: 10 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 2, lower: 20 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 3, lower: 15 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 2, lower: 15 }, { ind: 'ma', period: 40 }, { ind: 'roc', period: 12 }]] },
  { name: 'Rates · RSI14 symmetric MR (both)', group: 'Rates', direction: 'both',
    conds: [{ ind: 'rsi', period: 14, lower: 30 }],
    neighbours: [[{ ind: 'rsi', period: 10, lower: 30 }], [{ ind: 'rsi', period: 21, lower: 30 }], [{ ind: 'rsi', period: 14, lower: 25 }], [{ ind: 'rsi', period: 14, lower: 35 }]] },
  { name: 'Ags · RSI2+SMA50+ROC (both)', group: 'Ags', direction: 'both',
    conds: [{ ind: 'rsi', period: 2, lower: 15 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }],
    neighbours: [[{ ind: 'rsi', period: 2, lower: 10 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 2, lower: 20 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 3, lower: 15 }, { ind: 'ma', period: 50 }, { ind: 'roc', period: 12 }], [{ ind: 'rsi', period: 2, lower: 15 }, { ind: 'ma', period: 40 }, { ind: 'roc', period: 12 }]] },
];

const UNIVERSE = {
  FX: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  Commodities: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F' },
  Rates: { ZN: 'ZN=F', ZB: 'ZB=F', ZF: 'ZF=F' },
  Ags: { ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F', KC: 'KC=F', SB: 'SB=F', CT: 'CT=F' },
};

// ---- condition evaluation (precompute arrays per symbol × param set) -----------
function buildEval(cond, candles) {
  const cl = candles.map((c) => c.c);
  if (cond.ind === 'rsi') { const a = rsi(cl, cond.period); const hi = 100 - cond.lower; return (i, p) => (a[i] == null ? null : { bull: a[i] < cond.lower, bear: a[i] > hi }); }
  if (cond.ind === 'ma') { const a = sma(cl, cond.period); return (i, p) => (a[i] == null ? null : { bull: p > a[i], bear: p < a[i] }); }
  if (cond.ind === 'boll') { const { upper, lower } = bollinger(cl, cond.period, cond.mult || 2); return (i, p) => (lower[i] == null ? null : { bull: p < lower[i], bear: p > upper[i] }); }
  if (cond.ind === 'stoch') { const a = stochastic(cl, cond.period); const hi = 100 - cond.lower; return (i, p) => (a[i] == null ? null : { bull: a[i] < cond.lower, bear: a[i] > hi }); }
  if (cond.ind === 'roc') { const a = roc(cl, cond.period); return (i, p) => (a[i] == null ? null : { bull: a[i] > 0, bear: a[i] < 0 }); }
  if (cond.ind === 'macd') { const { macdLine, signalLine } = macd(cl, cond.fast || 12, cond.slow || 26, 9); return (i, p) => (macdLine[i] == null || signalLine[i] == null ? null : { bull: macdLine[i] > signalLine[i], bear: macdLine[i] < signalLine[i] }); }
  return () => null;
}

// Both-ways backtest over a bar range [from,to). Exit = setup ended / 2.5×ATR stop /
// 20-bar cap. Returns per-trade R with direction.
function simulate(candles, conds, direction, from, to) {
  const evals = conds.map((c) => buildEval(c, candles));
  const at = (i, price) => { let bull = true, bear = true; for (const e of evals) { const r = e(i, price); if (!r) return null; bull = bull && r.bull; bear = bear && r.bear; } return { bull, bear }; };
  const A = atr(candles, 14);
  const lo = Math.max(210, from), hi = Math.min(candles.length, to);
  const trades = []; let pos = null;
  for (let i = lo; i < hi; i++) {
    const price = candles[i].c, a = A[i] || price * 0.01;
    if (pos) {
      const long = pos.dir > 0, s = at(i, price), on = s && (long ? s.bull : s.bear);
      let exit = null;
      if (long ? price <= pos.stop : price >= pos.stop) exit = pos.stop;
      else if (!on) exit = price; else if (i - pos.oi >= 20) exit = price;
      if (exit != null) { trades.push({ r: (pos.dir * (exit - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; }
    }
    if (!pos) {
      const s = at(i, price); if (!s) continue;
      const dir = direction !== 'short' && s.bull ? 1 : direction !== 'long' && s.bear ? -1 : 0;
      if (dir !== 0) { const risk = Math.max(a * 2.5, price * 0.004); pos = { dir, entry: price, risk, stop: dir > 0 ? price - risk : price + risk, oi: i }; }
    }
  }
  return trades;
}

function agg(trades) {
  const R = trades.map((t) => t.r), w = R.filter((r) => r > 0), l = R.filter((r) => r < 0);
  const gw = w.reduce((a, r) => a + r, 0), gl = Math.abs(l.reduce((a, r) => a + r, 0));
  const sh = trades.filter((t) => t.dir < 0);
  return { n: R.length, win: R.length ? Math.round(w.length / R.length * 100) : 0, pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0), avgR: R.length ? +(R.reduce((a, r) => a + r, 0) / R.length).toFixed(3) : 0, shortN: sh.length, shortAvgR: sh.length ? +(sh.reduce((a, t) => a + t.r, 0) / sh.length).toFixed(3) : 0 };
}

const runAll = (mkts, conds, dir, from = 0, to = 1e9) => { let all = []; for (const c of mkts) all = all.concat(simulate(c, conds, dir, from, to)); return agg(all); };

// ---- run ----
const cache = {};
async function loadGroup(group) {
  if (cache[group]) return cache[group];
  const data = {};
  for (const [nm, y] of Object.entries(UNIVERSE[group])) { try { const { candles } = await fetchDailyCandles({ yahoo: y, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 400) data[nm] = candles; } catch (e) { /* skip */ } }
  cache[group] = data; return data;
}

function evaluate(cand, data) {
  const have = Object.keys(data), mkts = have.map((n) => data[n]);
  const pooled = runAll(mkts, cand.conds, cand.direction);
  const g1 = pooled.pf >= 1.3 && pooled.avgR > 0.05 && pooled.n >= 40;
  const maxLen = Math.max(...mkts.map((c) => c.length));
  const folds = [[0, maxLen / 3], [maxLen / 3, 2 * maxLen / 3], [2 * maxLen / 3, maxLen]].map(([a, b]) => runAll(mkts, cand.conds, cand.direction, Math.floor(a), Math.floor(b)));
  const foldPos = folds.filter((f) => f.n >= 5 && f.avgR > 0).length, foldTraded = folds.filter((f) => f.n >= 5).length;
  const g2 = foldPos >= Math.max(2, foldTraded - 1);
  const half = Math.ceil(have.length / 2), oos = runAll(have.slice(half).map((n) => data[n]), cand.conds, cand.direction);
  const g3 = oos.avgR > 0 && oos.n >= 20;
  const nb = cand.neighbours.map((c) => runAll(mkts, c, cand.direction).avgR), nbPos = nb.filter((v) => v > 0).length;
  const g4 = nbPos >= Math.ceil(nb.length * 0.75);
  const g5 = cand.direction !== 'both' || (pooled.shortAvgR > 0 && pooled.shortN >= 15);
  const gate = (p, label, detail) => console.log(`    ${p ? '✅' : '❌'} ${label.padEnd(15)} ${detail}`);
  console.log(`\n▶ ${cand.name}  (${have.join(', ')})`);
  gate(g1, '1 Pooled', `pf ${pooled.pf} · win ${pooled.win}% · avgR ${pooled.avgR} · n=${pooled.n}`);
  gate(g2, '2 Walk-forward', `folds avgR [${folds.map((f) => f.avgR).join(', ')}] — ${foldPos}/${foldTraded} traded folds positive`);
  gate(g3, '3 Out-of-sample', `holdout [${have.slice(half).join(', ')}] avgR ${oos.avgR} · n=${oos.n}`);
  gate(g4, '4 Robust', `neighbours [${nb.join(', ')}] — ${nbPos}/${nb.length} positive`);
  gate(g5, '5 Short side', cand.direction === 'both' ? `shorts avgR ${pooled.shortAvgR} · n=${pooled.shortN}` : 'n/a');
  const pass = g1 && g2 && g3 && g4 && g5;
  console.log(`    VERDICT: ${pass ? '✅ PROMOTE' : '❌ HOLD'}  (freq ≈ ${(pooled.n / mkts.length).toFixed(0)} trades/symbol over history)`);
  return pass;
}

console.log('\n=== PROMOTION GATE — must clear all 5 to earn an Ajent Pulse cell ===');
for (const cand of CANDIDATES) { const data = await loadGroup(cand.group); evaluate(cand, data); }
console.log('');
