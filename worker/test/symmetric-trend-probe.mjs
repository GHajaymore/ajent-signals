// PROBE (answers the regime-bias critique): a ~2yr sample is a mostly-up period, so of
// course longs won and shorts lost. The fair test is across FULL market cycles that include
// real bear markets (2022, 2020 crash, 2018 crypto winter). Does a SYMMETRIC trend-follower
// — long in uptrends, SHORT in downtrends, riding whichever way the trend goes (this is
// trend-following, NOT fighting it) — beat long-only over the long haul?
// Fetches long daily history straight from Yahoo. node test/symmetric-trend-probe.mjs
import { sma, atr } from '../src/indicators.js';

const RISK = 250, COST = 6;
// Long-history symbols with multiple bull AND bear cycles.
const MARKETS = [
  { sym: 'S&P 500', y: '^GSPC', range: '10y' },   // 2020 crash + 2022 bear
  { sym: 'Nasdaq', y: '^IXIC', range: '10y' },
  { sym: 'BTC', y: 'BTC-USD', range: '8y' },      // 2018 & 2022 crypto winters
  { sym: 'ETH', y: 'ETH-USD', range: '8y' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDaily(ySym, range, attempt = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d&range=${range}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0];
    if (!res) throw new Error('no result');
    const ts = res.timestamp || [], q = res.indicators.quote[0], out = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close[i], h = q.high[i], l = q.low[i];
      if (c == null || h == null || l == null) continue;
      out.push({ t: ts[i] * 1000, c, h, l });
    }
    return out.length > 260 ? out : null;
  } catch (e) {
    if (attempt < 3) { await sleep(2500 * (attempt + 1)); return fetchDaily(ySym, range, attempt + 1); }
    console.log(`   (fetch failed for ${ySym}: ${e.message})`);
    return null;
  }
}

// Symmetric trend-follower. dir: 'long' (uptrends only), 'short' (downtrends only), 'both'.
// Entry: price vs 200SMA + 50SMA sloping the trade's way. Exit: 3xATR ratcheting trail from
// the peak (long) / trough (short), close at the daily close. maxHold long.
function simTrend(candles, dir) {
  const closes = candles.map((x) => x.c);
  const s200 = sma(closes, 200), s50 = sma(closes, 50), atrArr = atr(candles, 14);
  const closed = []; let pos = null;
  for (let i = 210; i < candles.length; i++) {
    const price = closes[i], a = atrArr[i];
    if (pos) {
      pos.peak = Math.max(pos.peak, price); pos.trough = Math.min(pos.trough, price);
      const long = pos.side > 0;
      const trail = long ? pos.peak - 3 * a : pos.trough + 3 * a;
      const stopLvl = long ? Math.max(pos.stop, trail) : Math.min(pos.stop, trail);
      const hit = long ? price <= stopLvl : price >= stopLvl;
      const tooOld = candles[i].t - pos.openedAt > 120 * 24 * 60 * 60000;
      if (hit || tooOld) {
        const resultR = (pos.side * (price - pos.entry)) / pos.risk;
        closed.push({ resultR, pnl: Math.round(resultR * RISK - COST), closedAt: candles[i].t });
        pos = null;
      }
    }
    if (!pos && a > 0 && s200[i] != null && s50[i] != null && s50[i - 5] != null) {
      const rising = s50[i] > s50[i - 5], falling = s50[i] < s50[i - 5];
      const up = price > s200[i] && price > s50[i] && rising;
      const down = price < s200[i] && price < s50[i] && falling;
      let side = 0;
      if ((dir === 'long' || dir === 'both') && up) side = 1;
      else if ((dir === 'short' || dir === 'both') && down) side = -1;
      if (side) { const risk = Math.max(a * 3, price * 0.004); pos = { side, entry: price, stop: side > 0 ? price - risk : price + risk, risk, peak: price, trough: price, openedAt: candles[i].t }; }
    }
  }
  return closed;
}

function stats(trades) {
  if (!trades.length) return { n: 0, winRate: 0, pf: 0, pnl: 0, avgR: 0, maxDD: 0 };
  const w = trades.filter((t) => t.pnl > 0), l = trades.filter((t) => t.pnl < 0);
  const gw = w.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
  let eq = 0, peak = 0, dd = 0;
  for (const t of [...trades].sort((a, b) => a.closedAt - b.closedAt)) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  return { n: trades.length, winRate: Math.round((w.length / trades.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(trades.reduce((s, t) => s + t.pnl, 0)), avgR: +(trades.reduce((s, t) => s + t.resultR, 0) / trades.length).toFixed(3), maxDD: Math.round(dd) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% pf=${String(s.pf).padStart(5)} avgR=${String(s.avgR).padStart(7)} net=$${String(s.pnl).padStart(7)} maxDD=$${String(s.maxDD).padStart(6)}` : '(no trades)';

console.log('\nSYMMETRIC TREND-FOLLOW over FULL history (bull AND bear cycles)\n');
const pooled = { long: [], short: [], both: [] };
for (const m of MARKETS) {
  await sleep(1500); // space out requests so Yahoo doesn't rate-limit
  const candles = await fetchDaily(m.y, m.range);
  if (!candles) { console.log(`  ${m.sym}: no data`); continue; }
  const yrs = ((candles[candles.length - 1].t - candles[0].t) / (365.25 * 864e5)).toFixed(1);
  console.log(`${m.sym}  (${candles.length} days, ${yrs}y: ${new Date(candles[0].t).getFullYear()}–${new Date(candles[candles.length - 1].t).getFullYear()})`);
  for (const dir of ['long', 'short', 'both']) {
    const tr = simTrend(candles, dir);
    pooled[dir].push(...tr);
    console.log(`   ${dir.padEnd(6)} ${fmt(stats(tr))}`);
  }
}
console.log('\nPOOLED (all markets):');
for (const dir of ['long', 'short', 'both']) console.log(`   ${dir.padEnd(6)} ${fmt(stats(pooled[dir]))}`);
console.log('\nREAD: if BOTH beats LONG (higher net / better maxDD) once real bear markets are in the');
console.log('sample, the short side earns its place in the TREND engine. If SHORT is still a net');
console.log('loser even across full cycles, long-only is genuinely right, not just sample bias.\n');
