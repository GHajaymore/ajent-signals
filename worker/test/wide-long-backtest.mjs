// WIDE + LONG backtest (Ajay: "widen the universe"). The standing bt.mjs is 10 markets × ~2y (a
// mostly-bull window). This runs the ADOPTED recipe (computeSignal + %B<0.30, long-only) across a
// broad EQUITY index/ETF universe over ~10 YEARS — so it spans the 2022 bear and the 2020 crash.
// It validates the two things that matter most for down markets: (a) does the trend gate actually
// keep the strategy OUT of bear-market dips (entries below the 200-SMA ≈ 0)? and (b) does the edge
// hold across a full cycle, with drawdown a fraction of buy-and-hold's? Fetches long history direct
// from Yahoo (fetchDailyCandles hardcodes 2y).  node test/wide-long-backtest.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { mrShouldExit } from '../src/scheduler.js';
import { sma } from '../src/indicators.js';

const RISK = 250, COST = 6, PB = 0.30, RANGE = '10y';
// Long-history equity index/ETF set (ETFs + cash indices go back a decade+ on Yahoo).
const SYMS = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'DAX', 'N225', 'FTSE', 'HSI', 'KOSPI', 'CAC', 'TSX', 'SX5E'];

async function fetchLong(yahooSym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=${RANGE}`;
  const r = (await (await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } })).json())?.chart?.result?.[0];
  if (!r) return null;
  const q = r.indicators.quote[0], ts = r.timestamp || [], out = [];
  for (let i = 0; i < ts.length; i++) { if (q.close[i] == null || q.high[i] == null || q.low[i] == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? q.close[i], h: q.high[i], l: q.low[i], c: q.close[i] }); }
  return out;
}

const DATA = {};
for (const s of SYMS) { try { const c = await fetchLong(MARKETS[s].yahoo); if (c && c.length > 300) DATA[s] = c; } catch (e) { /* skip */ } }
const have = Object.keys(DATA);

const trades = [];
let belowSma = 0, totalEntries = 0;
for (const sym of have) {
  const candles = DATA[sym], meta = MARKETS[sym];
  const closes = candles.map((c) => c.c);
  const s200 = sma(closes, 200);
  let pos = null, lastCloseDay = null;
  for (let i = 210; i < candles.length; i++) {
    const price = candles[i].c, now = candles[i].t;
    let sig = computeSignal(candles.slice(0, i + 1), price);
    if (sig.verdict === 'BUY' && typeof sig.pctB === 'number' && sig.pctB >= PB) sig = { ...sig, verdict: 'NO_TRADE', plan: null };
    if (pos) {
      if (mrShouldExit(sig, pos, price, now, 65)) {
        const r = pos.risk || 1e-9, resultR = (price - pos.entry) / r;
        trades.push({ sym, resultR, pnl: Math.round(resultR * RISK - COST), year: new Date(pos.openedAt).getUTCFullYear(), openedAt: pos.openedAt, closedAt: now });
        lastCloseDay = new Date(now).toISOString().slice(0, 10); pos = null;
      }
    }
    if (!pos && sig.verdict === 'BUY' && sig.plan) {
      const day = new Date(now).toISOString().slice(0, 10);
      if (day === lastCloseDay) continue;
      totalEntries++; if (s200[i] != null && price < s200[i]) belowSma++;
      pos = { entry: price, stop: sig.plan.stop, risk: sig.plan.risk, side: 'LONG', exitAbove: 65, maxHoldMin: sig.plan.maxHoldMin, openedAt: now };
    }
  }
}

const st = (t) => {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), l = t.filter((x) => x.pnl < 0);
  const gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(l.reduce((s, x) => s + x.pnl, 0));
  const srt = t.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0, pk = 0, dd = 0; for (const x of srt) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, win: Math.round(100 * w.length / t.length), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + x.resultR, 0) / t.length).toFixed(3), net: Math.round(t.reduce((s, x) => s + x.pnl, 0)), maxDD: Math.round(dd) };
};
const span = trades.length ? `${new Date(Math.min(...trades.map((t) => t.openedAt))).toISOString().slice(0, 7)} → ${new Date(Math.max(...trades.map((t) => t.closedAt))).toISOString().slice(0, 7)}` : '—';
const all = st(trades);
console.log(`\nWIDE + LONG BACKTEST — ${have.length}/${SYMS.length} equity markets, ~${RANGE}, adopted %B recipe, long-only.`);
console.log(`span ${span}\n`);
console.log('  OVERALL  ', JSON.stringify(all));
console.log(`\n  TREND GATE: ${belowSma} of ${totalEntries} entries were below the 200-SMA (${(100 * belowSma / (totalEntries || 1)).toFixed(1)}%) — the recipe should almost never dip-buy in a downtrend.`);
console.log('\n  BY YEAR (does the edge survive bear years — 2020 crash, 2022 bear?):');
const years = [...new Set(trades.map((t) => t.year))].sort();
for (const y of years) { const s = st(trades.filter((t) => t.year === y)); console.log(`   ${y}  n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% pf=${String(s.pf).padStart(5)} net=$${String(s.net).padStart(6)} maxDD=$${s.maxDD}`); }
console.log('');
