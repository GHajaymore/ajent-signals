// TREND-LEG ENTRY-QUALITY probe (2026-09-25) — the live trend leg is 0/7 (whipsawed in a choppy
// down stretch) and drags the ensemble win rate. ADX floor was already rejected (#7). Test NOVEL,
// principled entry-quality gates that should lift the trend leg's WIN RATE by skipping whipsaw-prone
// entries, and check robustness (full + IS/OOS split + per-year) before proposing anything:
//   slope200  — only enter when the 200-SMA is RISING (long-term uptrend), slope over 20d > 0
//   above50   — only enter when price is a margin ABOVE the 50-SMA (not right at it, where chop lives)
//   both      — slope200 AND above50
//   node test/trend-quality-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { processPosition } from '../src/scheduler.js';
import { sma } from '../src/indicators.js';

const RISK = 250, COST = 6, RANGE = '10y';
const SYMS = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'DAX', 'N225', 'FTSE', 'HSI', 'KOSPI', 'CAC', 'TSX', 'SX5E'];
const MARGIN = 0.01; // "comfortably above" the 50-SMA = 1%

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

// gate: which extra entry-quality filter to require. Trend BUYs that fail it are vetoed.
function run(gate) {
  const out = [];
  for (const sym of Object.keys(DATA)) {
    const candles = DATA[sym], meta = MARKETS[sym];
    const record = { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} };
    for (let i = 210; i < candles.length; i++) {
      const price = candles[i].c, now = candles[i].t;
      const closes = candles.slice(0, i + 1).map((c) => c.c);
      let sig = computeTrend(candles.slice(0, i + 1), price);
      if (sig.verdict === 'BUY' && gate !== 'none') {
        const s50 = sma(closes, 50), s200 = sma(closes, 200);
        const s200prev = sma(closes.slice(0, closes.length - 20), 200); // 200-SMA 20 bars ago
        const rising = s200 != null && s200prev != null && s200 > s200prev;
        const above = s50 != null && price >= s50 * (1 + MARGIN);
        let ok = true;
        if (gate === 'slope200') ok = rising;
        else if (gate === 'above50') ok = above;
        else if (gate === 'both') ok = rising && above;
        if (!ok) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      }
      processPosition({ symbol: sym, meta, sig, live: price, open: true, record, now, risk: RISK, cost: COST, strat: 'trend', shouldExit: trendShouldExit, openMap: record.openTrend, lastCloseMap: record.lastCloseTrend });
    }
    for (const t of record.closed) out.push({ ...t, sym, year: new Date(t.openedAt || t.closedAt).getUTCFullYear() });
  }
  return out;
}
const st = (t) => {
  if (!t.length) return { n: 0, net: 0, pf: 0, win: 0, maxDD: 0, retDD: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  const srt = t.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0, pk = 0, dd = 0; for (const x of srt) { eq += x.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
  return { n: t.length, net: Math.round(eq), pf: +(gw / (gl || 1)).toFixed(2), win: Math.round(100 * w.length / t.length), maxDD: Math.round(dd), retDD: +(eq / -(dd || 1)).toFixed(2) };
};
const line = (s) => `n=${String(s.n).padStart(4)} net=$${String(s.net).padStart(6)} pf=${String(s.pf).padStart(5)} win=${String(s.win).padStart(3)}% maxDD=$${String(s.maxDD).padStart(6)} ret/DD=${s.retDD}`;
// IS/OOS split by median openedAt so we see if a gate holds out of sample (not just curve-fit).
function isoos(t) { const srt = t.slice().sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0)); const mid = srt[Math.floor(srt.length / 2)]?.openedAt || 0; return [srt.filter((x) => (x.openedAt || 0) < mid), srt.filter((x) => (x.openedAt || 0) >= mid)]; }

console.log(`\nTREND-QUALITY — ${Object.keys(DATA).length} equity markets, ~${RANGE}, trend leg only. Does a trend-quality gate lift WIN RATE robustly?\n`);
for (const g of ['none', 'slope200', 'above50', 'both']) {
  const all = run(g); const [is, oos] = isoos(all);
  console.log(`  ${g.padEnd(9)} FULL ${line(st(all))}`);
  console.log(`  ${''.padEnd(9)} IS   ${line(st(is))}`);
  console.log(`  ${''.padEnd(9)} OOS  ${line(st(oos))}`);
  console.log('');
}
