// Does VOLUME help the MR entry? Hypothesis: an oversold dip on a volume SPIKE (capitulation
// / panic selling) bounces harder than a quiet drift down. Tests a volume-ratio gate on the
// production MR engine. Volume is unreliable for cash indices (often 0), so the gate only
// applies where volume exists; those markets are kept untouched and reported separately.
//   node test/volume-probe.mjs
import { MARKETS } from '../src/markets.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6;
const TICKERS = { ES: 'ES=F', NQ: 'NQ=F', YM: 'YM=F', RTY: 'RTY=F', XJO: '^AXJO', SX5E: '^STOXX50E', N225: '^N225', TSX: '^GSPTSE', BTC: 'BTC-USD', ETH: 'ETH-USD' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDaily(y, a = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=10y`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error('no result');
    const ts = res.timestamp || [], q = res.indicators.quote[0], out = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close[i], h = q.high[i], l = q.low[i]; if (c == null || h == null || l == null) continue;
      out.push({ t: ts[i] * 1000, o: q.open[i] ?? c, h, l, c, v: q.volume[i] ?? 0 });
    }
    return out.length > 300 ? out : null;
  } catch (e) { if (a < 3) { await sleep(2500 * (a + 1)); return fetchDaily(y, a + 1); } return null; }
}

const DATA = {}, VOLR = {}, HASVOL = {};
for (const [sym, y] of Object.entries(TICKERS)) {
  await sleep(1400); const c = await fetchDaily(y);
  if (!c) { console.log(`  (no data: ${sym})`); continue; }
  DATA[sym] = c;
  // 20-day avg volume, and each bar's ratio to it. Mark markets whose volume is basically zero.
  const nonZero = c.filter((x) => x.v > 0).length;
  HASVOL[sym] = nonZero > c.length * 0.5;
  const ratio = new Array(c.length).fill(null);
  for (let i = 20; i < c.length; i++) {
    let s = 0; for (let j = i - 20; j < i; j++) s += c[j].v; const avg = s / 20;
    ratio[i] = avg > 0 ? c[i].v / avg : null;
  }
  VOLR[sym] = ratio;
}
const SYMS = Object.keys(DATA);

// Gate: keep a BUY only when the entry bar's volume is a spike (> thr x its 20d average).
// Markets without usable volume are kept as-is (we don't gate what we can't measure).
const volGate = (thr) => (sym, i) => (!HASVOL[sym] ? true : (VOLR[sym][i] != null && VOLR[sym][i] > thr));

function run(keep) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], meta = MARKETS[sym] || { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      let sig = computeSignal(candles.slice(0, i + 1), candles[i].c);
      if (keep && sig.verdict === 'BUY' && !keep(sym, i)) sig = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST });
    }
    for (const t of record.closed) { t.sym = sym; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0, winRate: 0, pf: 0, avgR: 0, pnl: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, winRate: Math.round((w.length / t.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.winRate).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)}` : '(none)';

console.log(`\nVOLUME-SPIKE PROBE — ${SYMS.length} MR markets\nwith usable volume: ${SYMS.filter((s) => HASVOL[s]).join(', ') || '(none)'}\nno/zero volume (kept untouched): ${SYMS.filter((s) => !HASVOL[s]).join(', ') || '(none)'}\n`);
const baseline = run(null);
const tMin = Math.min(...baseline.map((t) => t.closedAt)), tMax = Math.max(...baseline.map((t) => t.closedAt)), mid = tMin + (tMax - tMin) * 0.6;
const b = st(baseline);
console.log(`baseline: ${fmt(b)}\n`);
console.log('VOLUME-SPIKE GATE (keep BUY only on a volume spike; plateau + OOS):');
for (const thr of [1.0, 1.2, 1.5, 2.0]) {
  const c = run(volGate(thr)), full = st(c), test = st(c.filter((t) => t.closedAt >= mid));
  const kept = b.n ? Math.round((full.n / b.n) * 100) : 0;
  console.log(`  vol>${thr.toFixed(1)}x  keeps ${String(kept).padStart(3)}%   FULL ${fmt(full)}`);
  console.log(`               OOS  ${fmt(test)}`);
}
// per-market on the volume-having markets only (thr 1.5)
console.log('\nPER-MARKET (volume markets, vol>1.5x vs baseline):');
const g = run(volGate(1.5));
for (const sym of SYMS.filter((s) => HASVOL[s])) {
  const bs = st(baseline.filter((t) => t.sym === sym)), gs = st(g.filter((t) => t.sym === sym));
  console.log(`   ${sym.padEnd(5)} base avgR=${String(bs.avgR).padStart(6)} n=${String(bs.n).padStart(2)}  ->  avgR=${String(gs.avgR).padStart(6)} n=${String(gs.n).padStart(2)}`);
}
console.log('\nREAD: volume earns interest only if it lifts pf AND avgR on the volume markets, holds OOS, and keeps a workable count. Otherwise capitulation-volume is not a usable edge here.\n');
