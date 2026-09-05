// Combination lab for the USER-FACING indicator palette. Tests the exact indicators
// the Strategy Builder exposes (assets/js/app/customStrategy.js) — RSI, MA, MACD,
// Bollinger, Stochastic, Momentum — in every 1/2/3-indicator AND-combination, BOTH
// directions, aggregated per asset class. Reports the combos with a real edge and the
// honest short-side avgR, so we can see which user-buildable rules actually work (and
// which combos are worth validating for a future engine). Read-only.
//   node test/combos.mjs
import { fetchDailyCandles } from '../src/data.js';
import { sma, rsi, atr, macd, bollinger, stochastic, roc } from '../src/indicators.js';

const GROUPS = {
  FX: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  Commodities: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F' },
  Equities: { ES: 'ES=F', NQ: 'NQ=F', RTY: 'RTY=F', N225: '^N225', XJO: '^AXJO' },
};

// Precompute every array a preset might read, once per market.
function precompute(candles) {
  const cl = candles.map((c) => c.c);
  return { cl, atr: atr(candles, 14), rsi2: rsi(cl, 2), rsi14: rsi(cl, 14), sma50: sma(cl, 50), sma200: sma(cl, 200), macd: macd(cl, 12, 26, 9), boll: bollinger(cl, 20, 2), stoch: stochastic(cl, 14), roc: roc(cl, 12) };
}

// Each preset = one condition from the palette, with its bull/bear reading at bar i.
const ok = (v) => v != null && !Number.isNaN(v);
const PRESETS = {
  'RSI2<15': (i, x, p) => (ok(x.rsi2[i]) ? { bull: x.rsi2[i] < 15, bear: x.rsi2[i] > 85 } : null),
  'RSI14<30': (i, x, p) => (ok(x.rsi14[i]) ? { bull: x.rsi14[i] < 30, bear: x.rsi14[i] > 70 } : null),
  'Price>SMA50': (i, x, p) => (ok(x.sma50[i]) ? { bull: p > x.sma50[i], bear: p < x.sma50[i] } : null),
  'Price>SMA200': (i, x, p) => (ok(x.sma200[i]) ? { bull: p > x.sma200[i], bear: p < x.sma200[i] } : null),
  'MACD>signal': (i, x, p) => (ok(x.macd.macdLine[i]) && ok(x.macd.signalLine[i]) ? { bull: x.macd.macdLine[i] > x.macd.signalLine[i], bear: x.macd.macdLine[i] < x.macd.signalLine[i] } : null),
  'Price<lowerBB': (i, x, p) => (ok(x.boll.lower[i]) ? { bull: p < x.boll.lower[i], bear: p > x.boll.upper[i] } : null),
  'Stoch<20': (i, x, p) => (ok(x.stoch[i]) ? { bull: x.stoch[i] < 20, bear: x.stoch[i] > 80 } : null),
  'ROC>0': (i, x, p) => (ok(x.roc[i]) ? { bull: x.roc[i] > 0, bear: x.roc[i] < 0 } : null),
};
// One representative preset per indicator type — the pool for 2- and 3-way combos.
const PRIMARIES = ['RSI2<15', 'Price>SMA50', 'MACD>signal', 'Price<lowerBB', 'Stoch<20', 'ROC>0'];

// Evaluate a combo (list of preset keys) at bar i: computable? all-bull? all-bear?
function combo(keys, i, x, price) {
  let allBull = true, allBear = true;
  for (const k of keys) { const r = PRESETS[k](i, x, price); if (!r) return null; allBull = allBull && r.bull; allBear = allBear && r.bear; }
  return { bull: allBull, bear: allBear };
}

// Both-ways backtest: enter when all conditions agree; exit when they no longer agree
// in the position's direction (generic 'setup ended'), a 2.5×ATR stop, or a time cap.
function simulate(candles, x, keys) {
  const trades = []; let pos = null;
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c, a = x.atr[i] || price * 0.01;
    if (pos) {
      const long = pos.dir > 0;
      const c = combo(keys, i, x, price);
      const stillOn = c && (long ? c.bull : c.bear);
      let exit = null;
      if (long ? price <= pos.stop : price >= pos.stop) exit = pos.stop;
      else if (!stillOn) exit = price;
      else if (i - pos.oi >= 20) exit = price;
      if (exit != null) { trades.push({ r: (pos.dir * (exit - pos.entry)) / pos.risk, dir: pos.dir }); pos = null; }
    }
    if (!pos) {
      const c = combo(keys, i, x, price); if (!c) continue;
      const dir = c.bull ? 1 : c.bear ? -1 : 0;
      if (dir !== 0) { const risk = Math.max(a * 2.5, price * 0.004); pos = { dir, entry: price, risk, stop: dir > 0 ? price - risk : price + risk, oi: i }; }
    }
  }
  return trades;
}

function agg(trades) {
  const R = trades.map((t) => t.r), w = R.filter((r) => r > 0), l = R.filter((r) => r < 0);
  const gw = w.reduce((a, r) => a + r, 0), gl = Math.abs(l.reduce((a, r) => a + r, 0));
  const sh = trades.filter((t) => t.dir < 0);
  return {
    n: R.length, win: R.length ? Math.round(w.length / R.length * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    avgR: R.length ? +(R.reduce((a, r) => a + r, 0) / R.length).toFixed(3) : 0,
    shortN: sh.length, shortAvgR: sh.length ? +(sh.reduce((a, t) => a + t.r, 0) / sh.length).toFixed(3) : 0,
  };
}

// Build the combo list: all singles, all primary pairs, all primary triples.
function pairs(arr) { const o = []; for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) o.push([arr[i], arr[j]]); return o; }
function triples(arr) { const o = []; for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) for (let k = j + 1; k < arr.length; k++) o.push([arr[i], arr[j], arr[k]]); return o; }
const COMBOS = [...Object.keys(PRESETS).map((k) => [k]), ...pairs(PRIMARIES), ...triples(PRIMARIES)];

// ---- run ----
const DATA = {};
for (const [group, syms] of Object.entries(GROUPS)) {
  DATA[group] = [];
  for (const yahoo of Object.values(syms)) {
    try { const { candles } = await fetchDailyCandles({ yahoo, country: 'US' }, { DATA_PROVIDER: 'yahoo' }); if (candles && candles.length > 300) DATA[group].push({ candles, x: precompute(candles) }); }
    catch (e) { /* skip */ }
  }
}

console.log(`\nCOMBINATION LAB — ${COMBOS.length} user-buildable combos × ${Object.keys(GROUPS).length} classes, both ways.`);
console.log('Ranked by avgR; only combos with n≥40 shown. shortAvgR = the honest short-side test.\n');
for (const [group, markets] of Object.entries(DATA)) {
  const scored = COMBOS.map((keys) => {
    let all = []; for (const m of markets) all = all.concat(simulate(m.candles, m.x, keys));
    return { keys, ...agg(all) };
  }).filter((r) => r.n >= 40).sort((a, b) => b.avgR - a.avgR);
  console.log(`=== ${group} (${markets.length} symbols) — top 8 of ${scored.length} viable ===`);
  for (const r of scored.slice(0, 8)) {
    const flag = r.pf >= 1.3 && r.avgR > 0.05 ? '✅' : (r.avgR > 0 ? '· ' : '✗ ');
    console.log(`  ${flag} ${r.keys.join(' + ').padEnd(46)} pf ${String(r.pf).padStart(5)} win ${String(r.win).padStart(3)}% avgR ${String(r.avgR).padStart(6)} n=${String(r.n).padStart(4)} | short avgR ${String(r.shortAvgR).padStart(6)} (n=${r.shortN})`);
  }
  console.log('');
}
