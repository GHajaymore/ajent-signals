// PROBE: the both-ways cells (FX/commodity) exit when RSI reverts through the MEAN (50).
// The equity engine's big win was holding PAST the mean (exit at 65, not 50). Untested for
// both-ways: does holding past 50 help here too? Sweeps the exit mid, checks IS/OOS AND the
// long/short legs separately (a both-ways change must stay symmetric). Fetches live Yahoo data.
//   node test/bothways-exit-sweep.mjs
import { computeBothMR, BOTH_CELLS } from '../src/bothways.js';
import { processPosition } from '../src/scheduler.js';

const RISK = 250, COST = 6;
const MIDS = [50, 55, 60, 65]; // 50 = current (exit at the mean); higher = hold past it
const CELLS = {
  fx: { EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X', NZDUSD: 'NZDUSD=X' },
  commodity: { GC: 'GC=F', SI: 'SI=F', HG: 'HG=F', CL: 'CL=F', NG: 'NG=F', ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchDaily(y, a = 0) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=1d&range=10y`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ajent-signals-worker/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const res = (await r.json())?.chart?.result?.[0]; if (!res) throw new Error('no result');
    const ts = res.timestamp || [], q = res.indicators.quote[0], out = [];
    for (let i = 0; i < ts.length; i++) { const c = q.close[i], h = q.high[i], l = q.low[i]; if (c == null || h == null || l == null) continue; out.push({ t: ts[i] * 1000, o: q.open[i] ?? c, h, l, c }); }
    return out.length > 300 ? out : null;
  } catch (e) { if (a < 3) { await sleep(2500 * (a + 1)); return fetchDaily(y, a + 1); } return null; }
}
const DATA = {}, CELLOF = {};
for (const [cell, syms] of Object.entries(CELLS)) for (const [sym, y] of Object.entries(syms)) {
  await sleep(1400); const c = await fetchDaily(y);
  if (!c) { console.log(`  (no data: ${sym})`); continue; }
  DATA[sym] = c; CELLOF[sym] = cell;
}
const SYMS = Object.keys(DATA);

// Exit at a configurable mid (mid=50 reproduces the live bothMRShouldExit).
const exitAt = (mid) => (sig, pos, price, now) => {
  const short = pos.side === 'SHORT';
  if (short ? price >= pos.stop : price <= pos.stop) return 'stop';
  const r = sig && typeof sig.rsiMR === 'number' ? sig.rsiMR : null;
  if (r != null && (short ? r < (100 - mid) : r > mid)) return 'rsiRecover';
  if (now - pos.openedAt > (pos.maxHoldMin || 1) * 60000) return 'timeStop';
  return null;
};
function run(mid) {
  const closed = [];
  for (const sym of SYMS) {
    const candles = DATA[sym], cell = CELLOF[sym], meta = { name: sym, symbol: sym };
    const record = { open: {}, closed: [], lastClose: {} };
    for (let i = 210; i < candles.length; i++) {
      const sig = computeBothMR(candles.slice(0, i + 1), candles[i].c, cell);
      processPosition({ symbol: sym, meta, sig, live: candles[i].c, open: true, record, now: candles[i].t, risk: RISK, cost: COST, strat: 'mrBoth', shouldExit: exitAt(mid) });
    }
    for (const t of record.closed) { t.sym = sym; t.cell = cell; closed.push(t); }
  }
  return closed.sort((a, b) => a.closedAt - b.closedAt);
}
function st(t) {
  if (!t.length) return { n: 0 };
  const w = t.filter((x) => x.pnl > 0), gw = w.reduce((s, x) => s + x.pnl, 0), gl = Math.abs(t.filter((x) => x.pnl < 0).reduce((s, x) => s + x.pnl, 0));
  return { n: t.length, win: Math.round(100 * w.length / t.length), avgR: +(t.reduce((s, x) => s + (x.resultR || 0), 0) / t.length).toFixed(3), pf: +(gw / (gl || 1)).toFixed(2), pnl: Math.round(t.reduce((s, x) => s + x.pnl, 0)) };
}
const fmt = (s) => s.n ? `n=${String(s.n).padStart(3)} win=${String(s.win).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)}` : '(none)';

let tMin = Infinity, tMax = -Infinity;
const b = run(50);
for (const t of b) { tMin = Math.min(tMin, t.closedAt); tMax = Math.max(tMax, t.closedAt); }
const mid = tMin + (tMax - tMin) * 0.6;
console.log(`\nBOTH-WAYS EXIT-MID SWEEP — ${SYMS.length} FX/commodity symbols. 50=current (exit at mean).\n`);
const rows = {};
for (const m of MIDS) { const c = run(m); rows[m] = c; }
for (const label of ['FULL', 'LONG leg', 'SHORT leg', 'IN-SAMPLE', 'OUT-OF-SAMPLE']) {
  console.log(`${label}:`);
  for (const m of MIDS) {
    const c = rows[m];
    const sub = label === 'LONG leg' ? c.filter((t) => t.side === 'LONG') : label === 'SHORT leg' ? c.filter((t) => t.side === 'SHORT')
      : label === 'IN-SAMPLE' ? c.filter((t) => t.closedAt < mid) : label === 'OUT-OF-SAMPLE' ? c.filter((t) => t.closedAt >= mid) : c;
    console.log(`  exit>${m}${m === 50 ? '*' : ' '} ${fmt(st(sub))}`);
  }
  console.log('');
}
const base = st(rows[50]), baseOOS = st(rows[50].filter((t) => t.closedAt >= mid)), baseIS = st(rows[50].filter((t) => t.closedAt < mid));
console.log('VERDICT (beat exit>50 on full pf AND OOS net AND both legs positive, robust plateau):');
const cands = MIDS.filter((m) => {
  if (m === 50) return false;
  const f = st(rows[m]), oos = st(rows[m].filter((t) => t.closedAt >= mid)), lo = st(rows[m].filter((t) => t.side === 'LONG')), sh = st(rows[m].filter((t) => t.side === 'SHORT'));
  return f.pf > base.pf && oos.pnl > baseOOS.pnl && lo.avgR > 0 && sh.avgR > 0;
});
if (!cands.length) console.log('  None. Exit at the mean (50) holds up — both-ways does NOT benefit from holding past the mean (unlike equity). Keep 50.');
else cands.forEach((m) => console.log(`  CANDIDATE exit>${m}: full pf ${st(rows[m]).pf} vs ${base.pf}; check plateau + n before adopting.`));
console.log('');
