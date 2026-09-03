// LAB — INTRADAY DAY-TRADING validator (run BEFORE enabling the experiment live).
//   node test/daytrade.mjs
//
// The free Yahoo feed only serves 15-minute bars for ~60 days, so this is a SHORT
// sample by construction — treat every number as provisional and never advertise
// it. The point is a go/no-go gate: does intraday mean-reversion, LONG-ONLY and
// FLAT BY CLOSE (no overnight risk), clear a positive, robust bar net of costs? An
// earlier intraday version LOST money live, so the default expectation is skepticism
// — we only ship it as a tracked experiment, and only mark it "proven" if a wide
// parameter PLATEAU is positive here, not one lucky setting.
import { MARKETS } from '../src/markets.js';
import { fetchIntradayCandles } from '../src/data.js';
import { computeDaySignal } from '../src/daytrade.js';
import { sma, rsi, atr, stdev } from '../src/indicators.js';

const START = 25000, RISK = 250, COST = 6;
const YEAR = 365.25 * 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
// Intraday-liquid markets only. Crypto trades 24/7 (no "session close"), so the
// flat-by-close rule doesn't apply the same way — kept separate, informational.
const SYMS = ['ES', 'NQ', 'YM', 'RTY'];

const fmt = (r) => `PF ${String(r.pf).padStart(4)}  win ${String(r.winRate).padStart(3)}%  n=${String(r.trades).padStart(4)}  P&L ${String(r.totalPnl).padStart(7)}  MAR ${String(r.mar).padStart(6)}  DD ${String(r.maxDD).padStart(6)}%  avg ${String(r.avgTrade).padStart(5)}`;

// Fetch real 15-min bars once, reuse across variants.
const DATA = {};
for (const sym of SYMS) {
  try {
    const { candles } = await fetchIntradayCandles(MARKETS[sym], { DATA_PROVIDER: 'yahoo' }, { interval: '15m', range: '60d' });
    if (candles && candles.length > 200) DATA[sym] = candles;
    else console.log(`  (skip ${sym}: only ${candles ? candles.length : 0} bars)`);
  } catch (e) { console.log(`  (skip ${sym}: ${e.message})`); }
}

// Is bar i the last bar of its trading session? True when the NEXT bar jumps to a
// new America/New_York calendar day, or there's a >1h gap (overnight/weekend), or
// it's the final bar we have. This is what enforces FLAT BY CLOSE.
const nyDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
function isSessionEnd(c, i) {
  if (i >= c.length - 1) return true;
  if (c[i + 1].t - c[i].t > HOUR) return true;      // overnight / weekend gap
  return nyDay(c[i + 1].t) !== nyDay(c[i].t);        // next bar is a new day
}

// Precompute indicator arrays ONCE per market (the intraday sample is ~4600 bars,
// so recomputing them per bar per param would be O(n^2)). Only trendSma varies
// among the indicator inputs, so precompute the three we sweep; thresholds are
// applied to these arrays in the fast backtester below. This mirrors the exact
// entry/stop/exit logic in daytrade.js — asserted against it before the sweep.
const PRE = {};
for (const sym of Object.keys(DATA)) {
  const c = DATA[sym];
  const closes = c.map((x) => x.c);
  const eos = c.map((_, i) => isSessionEnd(c, i));
  PRE[sym] = {
    c, closes, eos,
    rsi2: rsi(closes, 2), atr14: atr(c, 14), sma20: sma(closes, 20), sd20: stdev(closes, 20),
    sma: { 30: sma(closes, 30), 50: sma(closes, 50), 100: sma(closes, 100) },
  };
}

function backtest(params, syms = Object.keys(DATA)) {
  const closed = [];
  let tMin = Infinity, tMax = -Infinity;
  for (const sym of syms) {
    const p = PRE[sym], c = p.c, closes = p.closes;
    const trend = p.sma[params.trendSma];
    let pos = null, openIdx = -1;
    for (let i = 60; i < c.length; i++) {
      const price = closes[i], t = c[i].t, eos = p.eos[i], r2 = p.rsi2[i];
      if (pos) {
        const barsHeld = i - openIdx;
        let exit = null;
        if (price <= pos.stop) exit = 'stop';
        else if (r2 != null && r2 > params.exitAbove) exit = 'rsiRecover';
        else if (barsHeld >= params.maxHoldBars) exit = 'timeStop';
        else if (eos) exit = 'flatByClose';   // never carry overnight
        if (exit) {
          const rr = Math.abs(pos.entry - pos.stop) || 1e-9;
          const resultR = (price - pos.entry) / rr;
          closed.push({ pnl: Math.round(resultR * RISK - COST), openedAt: pos.t, closedAt: t, exit });
          pos = null;
        }
      }
      // Entry: LONG-ONLY oversold flush below the prior bar's low, in an intraday
      // uptrend. Don't open on the last bar of a session (would be flat immediately).
      if (!pos && !eos) {
        const tr = trend[i], atrN = p.atr14[i];
        if (tr != null && atrN > 0 && r2 != null && price > tr && r2 < params.entryBelow && price < c[i - 1].l) {
          const risk = Math.max(atrN * params.stopAtrMult, price * 0.0025);
          pos = { entry: price, stop: price - risk, t };
          openIdx = i;
        }
      }
    }
  }
  for (const tr of closed) { tMin = Math.min(tMin, tr.openedAt); tMax = Math.max(tMax, tr.closedAt); }
  closed.sort((a, b) => a.closedAt - b.closedAt);
  let eq = START, peak = START, maxDD = 0, gw = 0, gl = 0;
  const wins = closed.filter((t) => t.pnl > 0).length, losses = closed.filter((t) => t.pnl < 0).length;
  for (const t of closed) { eq += t.pnl; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, (eq - peak) / peak); if (t.pnl > 0) gw += t.pnl; else gl += Math.abs(t.pnl); }
  const years = (tMax - tMin) / YEAR || (1 / 6);
  const cagr = (Math.pow(Math.max(eq, 1) / START, 1 / years) - 1) * 100;
  const totalPnl = Math.round(eq - START);
  return {
    trades: closed.length, winRate: Math.round((wins / ((wins + losses) || 1)) * 100),
    totalPnl, maxDD: +(maxDD * 100).toFixed(1), pf: +(gw / (gl || 1)).toFixed(2),
    mar: maxDD ? +(cagr / Math.abs(maxDD * 100)).toFixed(2) : 0,
    avgTrade: closed.length ? Math.round((eq - START) / closed.length) : 0,
    stopRate: closed.length ? Math.round(closed.filter((t) => t.exit === 'stop').length / closed.length * 100) : 0,
    eosRate: closed.length ? Math.round(closed.filter((t) => t.exit === 'flatByClose').length / closed.length * 100) : 0,
  };
}

console.log(`\nINTRADAY day-trading lab — ${Object.keys(DATA).length} markets, 15m bars, ~${(DATA[Object.keys(DATA)[0]] || []).length} bars each (~60 days). LONG-ONLY, FLAT BY CLOSE.\n`);

// Defaults (what daytrade.js ships with).
const DEF = { indicatorPeriod: 2, entryBelow: 10, exitAbove: 60, deepBelow: 3, trendSma: 30, stopAtrMult: 1.5, maxHoldBars: 26 };
// The markets the experiment actually trades live — RTY is excluded (net loser).
const TRADED = ['ES', 'NQ', 'YM'].filter((s) => DATA[s]);

// FIDELITY CHECK: the fast backtester must reproduce the production engine's BUY
// bars exactly, else the sweep is testing something other than what ships. Compare
// on the first market over a bounded window (the engine is O(n^2), so sample it).
{
  const sym = Object.keys(DATA)[0], c = DATA[sym], p = PRE[sym], trend = p.sma[DEF.trendSma];
  let engineFires = 0, fastFires = 0, mism = 0;
  for (let i = 200; i < Math.min(c.length, 900); i++) {
    const price = c[i].c;
    const sig = computeDaySignal(c.slice(0, i + 1), price, DEF);
    const eF = sig.verdict === 'BUY';
    const tr = trend[i], atrN = p.atr14[i], r2 = p.rsi2[i];
    const fF = tr != null && atrN > 0 && r2 != null && price > tr && r2 < DEF.entryBelow && price < c[i - 1].l;
    if (eF) engineFires++; if (fF) fastFires++; if (eF !== fF) mism++;
  }
  console.log(`Fidelity (${sym}, 700 bars): engine BUYs=${engineFires} fast BUYs=${fastFires} mismatches=${mism}${mism ? '  <-- WARNING: fast path diverges from engine' : '  OK'}\n`);
}
console.log('Default recipe (pooled, all 4):');
console.log('  ' + fmt(backtest(DEF)));
console.log('Default recipe (TRADED set, RTY excluded):');
console.log('  ' + fmt(backtest(DEF, TRADED)) + '\n');

console.log('Per-market (default recipe):');
for (const sym of Object.keys(DATA)) console.log(`  ${sym.padEnd(5)} ${fmt(backtest(DEF, [sym]))}`);

// Robustness sweep — a wide plateau of positive settings is the bar to clear, not
// one cherry-picked winner. Grid over the dials that matter.
console.log('\nRobustness sweep (pooled, sorted by PF):');
const grid = [];
for (const entryBelow of [5, 10, 15])
  for (const exitAbove of [50, 60, 70])
    for (const trendSma of [30, 50, 100])
      for (const stopAtrMult of [1, 1.5, 2])
        grid.push({ ...DEF, entryBelow, exitAbove, trendSma, stopAtrMult });
const results = grid.map((p) => ({ p, r: backtest(p) })).filter((x) => x.r.trades >= 10);
results.sort((a, b) => b.r.pf - a.r.pf);
const robust = results.filter((x) => x.r.pf >= 1.3 && x.r.totalPnl > 0).length;
for (const { p, r } of results.slice(0, 12)) {
  console.log(`  entry<${String(p.entryBelow).padStart(2)} exit>${p.exitAbove} sma${String(p.trendSma).padStart(3)} stop${p.stopAtrMult}x  ${fmt(r)}`);
}
console.log(`\n  ${robust}/${results.length} settings clear PF>=1.3 AND positive P&L.`);
const posShare = results.length ? Math.round(results.filter((x) => x.r.totalPnl > 0).length / results.length * 100) : 0;
console.log(`  ${posShare}% of settings are net positive.\n`);

// Honest verdict.
const def = backtest(DEF);
const robustPlateau = robust >= Math.ceil(results.length * 0.4) && posShare >= 60;
if (def.pf >= 1.3 && def.totalPnl > 0 && robustPlateau) {
  console.log('VERDICT: intraday shows a positive, reasonably robust edge on this short sample.');
  console.log('  -> May graduate from EXPERIMENT to a tracked style — but keep it labelled provisional');
  console.log('     (60-day sample) and let the LIVE paper record confirm before any "proven" claim.\n');
} else {
  console.log('VERDICT: NOT proven. Ship as a clearly-labelled EXPERIMENT only — tracked on its own');
  console.log('  live paper record, no advertised returns, never merged into the Swing record. Do NOT');
  console.log('  mark it proven or auto-size it up. Re-run this gate as the live record accumulates.\n');
}
