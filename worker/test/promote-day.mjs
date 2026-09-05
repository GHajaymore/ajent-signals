// PROMOTION GATE — equity DAY-TRADING, BOTH WAYS. The daily equity engine is long-only
// (stocks drift up), but intraday there is NO drift, so a down day is a short setup
// (the user's ES-short case). This tests a both-ways intraday mean-reversion cell on
// 15-minute bars, flat by the close, through the same 5 gates as promote.mjs.
//
// HONEST CAVEAT: Yahoo only serves ~60 days of 15m history, so this is ONE short
// window — walk-forward folds are ~20 days each. Treat a PASS as "worth shipping as an
// EXPERIMENT and watching live", never as "proven". The live forward record is the judge.
//   node test/promote-day.mjs
import { fetchIntradayCandles } from '../src/data.js';
import { sma, rsi, atr } from '../src/indicators.js';

const SYMS = { ES: 'ES=F', NQ: 'NQ=F', YM: 'YM=F', RTY: 'RTY=F' };

// Both-ways intraday MR. Long = oversold flush while intraday-up; short = overbought
// pop while intraday-down (trend-gated by SMA-N). `noTrend` drops the gate (symmetric,
// the old "Active" shape). Exit: RSI reverts through mid / stop / time cap / flat-by-close.
function simulate(candles, p) {
  const cl = candles.map((c) => c.c);
  const r2 = rsi(cl, 2), sT = sma(cl, p.trendSma), A = atr(candles, 14);
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
  const trades = []; let pos = null;
  for (let i = p.trendSma + 5; i < candles.length; i++) {
    const price = cl[i], a = A[i] || price * 0.01;
    const lastBarOfDay = i === candles.length - 1 || dayOf(candles[i + 1].t) !== dayOf(candles[i].t);
    if (pos) {
      const long = pos.dir > 0;
      let exit = null;
      if (long ? price <= pos.stop : price >= pos.stop) exit = pos.stop;         // vol stop
      else if (r2[i] != null && (long ? r2[i] > 50 : r2[i] < 50)) exit = price;  // mean reached
      else if (i - pos.oi >= p.maxHoldBars) exit = price;                        // time cap
      else if (lastBarOfDay) exit = price;                                       // FLAT BY CLOSE
      if (exit != null) { trades.push({ r: (pos.dir * (exit - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; }
    }
    if (!pos && !lastBarOfDay && r2[i] != null && sT[i] != null) {               // don't open on the last bar
      const up = price > sT[i], dn = price < sT[i];
      let dir = 0;
      if (r2[i] < p.entryBelow && (p.noTrend || up)) dir = 1;
      else if (r2[i] > (100 - p.entryBelow) && (p.noTrend || dn)) dir = -1;
      if (dir !== 0) { const risk = Math.max(a * p.stopAtr, price * 0.0025); pos = { dir, entry: price, risk, stop: dir > 0 ? price - risk : price + risk, oi: i }; }
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

// ---- data ----
const data = {};
for (const [nm, y] of Object.entries(SYMS)) { try { const { candles } = await fetchIntradayCandles({ yahoo: y }, {}, { interval: '15m', range: '60d' }); if (candles && candles.length > 200) data[nm] = candles; } catch (e) { /* skip */ } }
const have = Object.keys(data);
console.log(`\nDAY-TRADING BOTH-WAYS GATE — 15m, ~60d. Symbols: ${have.join(', ')} (bars: ${have.map((n) => data[n].length).join('/')})\n`);

const CANDS = [
  { name: 'Day both-ways MR · trend-gated (SMA30)', p: { entryBelow: 10, trendSma: 30, stopAtr: 1.5, maxHoldBars: 26, noTrend: false },
    neighbours: [{ entryBelow: 8, trendSma: 30, stopAtr: 1.5, maxHoldBars: 26 }, { entryBelow: 12, trendSma: 30, stopAtr: 1.5, maxHoldBars: 26 }, { entryBelow: 10, trendSma: 20, stopAtr: 1.5, maxHoldBars: 26 }, { entryBelow: 10, trendSma: 40, stopAtr: 1.5, maxHoldBars: 26 }] },
  { name: 'Day both-ways MR · no trend gate', p: { entryBelow: 10, trendSma: 30, stopAtr: 1.5, maxHoldBars: 26, noTrend: true },
    neighbours: [{ entryBelow: 8, trendSma: 30, stopAtr: 1.5, maxHoldBars: 26, noTrend: true }, { entryBelow: 12, trendSma: 30, stopAtr: 1.5, maxHoldBars: 26, noTrend: true }, { entryBelow: 10, trendSma: 30, stopAtr: 1.5, maxHoldBars: 20, noTrend: true }, { entryBelow: 10, trendSma: 30, stopAtr: 2, maxHoldBars: 26, noTrend: true }] },
];
// Exclude RTY from the traded set (known intraday loser), keep it only as an OOS probe.
const tradedSyms = have.filter((s) => s !== 'RTY');
const runAll = (syms, p) => { let all = []; for (const s of syms) all = all.concat(simulate(data[s], p)); return agg(all); };

for (const cand of CANDS) {
  const mkts = tradedSyms;
  const pooled = runAll(mkts, cand.p);
  const g1 = pooled.pf >= 1.3 && pooled.avgR > 0.05 && pooled.n >= 40;
  // Walk-forward: 3 time thirds of each symbol's bars.
  const foldRun = (lo, hi) => { let all = []; for (const s of mkts) { const c = data[s]; all = all.concat(simulate(c.slice(Math.floor(c.length * lo), Math.floor(c.length * hi)), cand.p)); } return agg(all); };
  const folds = [foldRun(0, 1 / 3), foldRun(1 / 3, 2 / 3), foldRun(2 / 3, 1)];
  const foldTraded = folds.filter((f) => f.n >= 5).length, foldPos = folds.filter((f) => f.n >= 5 && f.avgR > 0).length;
  const g2 = foldPos >= Math.max(2, foldTraded - 1);
  // OOS: RTY held out entirely (never in the traded/search set).
  const oos = have.includes('RTY') ? runAll(['RTY'], cand.p) : { avgR: 0, n: 0 };
  const g3 = have.includes('RTY') ? (oos.avgR > 0 && oos.n >= 15) : null;
  const nb = cand.neighbours.map((p) => runAll(mkts, { ...cand.p, ...p }).avgR), nbPos = nb.filter((v) => v > 0).length;
  const g4 = nbPos >= Math.ceil(nb.length * 0.75);
  const g5 = pooled.shortAvgR > 0 && pooled.shortN >= 15;
  const gate = (p, label, detail) => console.log(`    ${p === null ? '· n/a' : p ? '✅' : '❌'} ${label.padEnd(15)} ${detail}`);
  console.log(`▶ ${cand.name}`);
  gate(g1, '1 Pooled', `pf ${pooled.pf} · win ${pooled.win}% · avgR ${pooled.avgR} · n=${pooled.n}`);
  gate(g2, '2 Walk-forward', `folds avgR [${folds.map((f) => f.avgR).join(', ')}] — ${foldPos}/${foldTraded} positive`);
  gate(g3, '3 Out-of-sample', have.includes('RTY') ? `RTY held out: avgR ${oos.avgR} · n=${oos.n}` : 'RTY unavailable');
  gate(g4, '4 Robust', `neighbours [${nb.join(', ')}] — ${nbPos}/${nb.length} positive`);
  gate(g5, '5 Short side', `shorts avgR ${pooled.shortAvgR} · n=${pooled.shortN}`);
  const pass = g1 && g2 && (g3 !== false) && g4 && g5;
  console.log(`    VERDICT: ${pass ? '✅ PROMOTE (as an EXPERIMENT — thin ~60d window)' : '❌ HOLD'}\n`);
}
