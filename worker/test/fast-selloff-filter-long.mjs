// (a) THE FIX TEST: the bad years (2018/2020/2022) are FAST crashes where price drops hard while
// still above the slow 200-SMA gate, so the dip-buyer catches a falling knife. Does a FAST-SELLOFF
// filter — skip the MR entry when the market has already dropped sharply over the last few days —
// avoid those years WITHOUT gutting the good ones? Tests skip thresholds on the ~10y MR data, by
// year and IS/OOS (a fix that only helps in-sample is overfit). Long-only equity.
//   node test/fast-selloff-filter-long.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit } from '../src/scheduler.js';

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

// Collect every MR entry ONCE, tagged with the 3-day and 5-day % drop into the entry, plus outcome.
const trades = [];
for (const sym of Object.keys(DATA)) {
  const candles = DATA[sym], meta = MARKETS[sym];
  let pos = null, lastCloseDay = null;
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c, now = candles[i].t;
    let sig = computeSignal(candles.slice(0, i + 1), price);
    if (sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', plan: null };
    if (pos) {
      if (mrShouldExit(sig, pos, price, now, 65)) {
        const r = pos.risk || 1e-9;
        trades.push({ sym, resultR: (price - pos.entry) / r, pnl: Math.round(((price - pos.entry) / r) * RISK - COST), ret3: pos.ret3, ret5: pos.ret5, year: new Date(pos.openedAt).getUTCFullYear(), openedAt: pos.openedAt, closedAt: now });
        lastCloseDay = new Date(now).toISOString().slice(0, 10); pos = null;
      }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      const day = new Date(now).toISOString().slice(0, 10); if (day === lastCloseDay) continue;
      const ret3 = i >= 3 ? (price / candles[i - 3].c - 1) * 100 : 0, ret5 = i >= 5 ? (price / candles[i - 5].c - 1) * 100 : 0;
      pos = { entry: price, stop: sig.plan.stop, risk: sig.plan.risk, side: 'LONG', exitAbove: 65, maxHoldMin: sig.plan.maxHoldMin, openedAt: now, ret3, ret5 };
    }
  }
}
trades.sort((a, b) => a.closedAt - b.closedAt);
const mid = trades.length ? trades[Math.floor(trades.length * 0.6)].closedAt : 0;
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, retDD: 0 };
  const gw = t.filter((x) => x.pnl > 0).reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  let eq = 0, pk = 0, dd = 0; for (const x of t) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * t.filter((x) => x.pnl > 0).length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
// A filter keeps a trade if its entry drop wasn't a fast crash worse than the threshold.
const keep = (t, field, thr) => t[field] >= thr; // e.g. ret5 >= -6 keeps mild dips, skips -8% crashes
const line = (s) => `n=${String(s.n).padStart(4)} net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} win=${String(s.win).padStart(3)}% maxDD=$${String(s.maxDD).padStart(6)} return/DD=${s.retDD}`;
console.log(`\nFAST-SELLOFF FILTER — ${Object.keys(DATA).length} equity markets, ~${RANGE}, MR long. Skip entries after a sharp N-day drop.\n`);
console.log('  BASELINE (no filter)        ', line(st(trades)));
for (const [field, thr] of [['ret5', -10], ['ret5', -8], ['ret5', -6], ['ret5', -5], ['ret3', -6], ['ret3', -5], ['ret3', -4]]) {
  const kept = trades.filter((t) => keep(t, field, thr)), skipped = trades.length - kept.length;
  const full = st(kept), is = st(kept.filter((t) => t.closedAt < mid)), oos = st(kept.filter((t) => t.closedAt >= mid));
  console.log(`  skip ${field} < ${thr}% (-${skipped} trades)  FULL ${line(full)}`);
  console.log(`     IS  ${line(is)}\n     OOS ${line(oos)}`);
}
console.log('\n  Best filter — by year (did it kill the 2018/2020/2022 losses?):');
const F = (t) => keep(t, 'ret5', -6);
for (const y of [...new Set(trades.map((t) => t.year))].sort()) {
  const b = st(trades.filter((t) => t.year === y)), f = st(trades.filter((t) => t.year === y && F(t)));
  console.log(`   ${y}  baseline net=$${String(b.net).padStart(6)} pf=${String(b.pf).padStart(5)}  ->  filtered net=$${String(f.net).padStart(6)} pf=${String(f.pf).padStart(5)}`);
}
console.log('');
