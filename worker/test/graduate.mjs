// GRADUATION MONITOR — the honest, mechanical decision of when an EXPERIMENT cell has
// earned "proven / live" status. The promotion gate (promote.mjs) validates a cell on
// BACKTEST before it ships as an experiment; this reads the cell's LIVE FORWARD record
// (real paper trades gathered since it shipped — genuinely out-of-sample) and says
// whether it's ready to graduate, keep gathering, or be reviewed for removal.
//
// Graduation is a strong claim, so the bar is conservative: a real forward sample AND
// positive expectancy AND a decent profit factor. A losing experiment is flagged for
// REVIEW, never quietly left running. Read-only — it recommends; a human promotes by
// flipping the cell's status in classes.js + dropping it from EXPERIMENT_CLASSES.
//   node test/graduate.mjs
//   AJENT_API=https://ajent-api.ajailabs.app node test/graduate.mjs
import { MARKETS } from '../src/markets.js';

const API = (process.env.AJENT_API || 'https://ajent-signals-worker.golferajay.workers.dev').replace(/\/+$/, '');

// Graduation thresholds on the LIVE forward record.
const READY_N = 40;     // enough real forward trades to trust
const READY_AVGR = 0.05; // positive per-trade expectancy (R)
const READY_PF = 1.3;    // gross win / gross loss
const REVIEW_N = 20;     // enough to call a losing experiment a real problem

// Which classes are experiments today (mirror assetClass.js / classes.js).
const EXPERIMENT = { crypto: 'Crypto', fx: 'Forex', commodity: 'Commodities' };
const PROVEN = { index: 'Index Futures', etf: 'Sector ETFs' };

const get = async (path) => { try { const r = await fetch(API + path, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } };

function stats(closed) {
  const R = closed.map((c) => c.resultR ?? 0);
  const w = closed.filter((c) => (c.pnl ?? 0) > 0), l = closed.filter((c) => (c.pnl ?? 0) < 0);
  const gw = w.reduce((a, c) => a + (c.pnl || 0), 0), gl = Math.abs(l.reduce((a, c) => a + (c.pnl || 0), 0));
  const shorts = closed.filter((c) => c.side === 'SHORT');
  return {
    n: closed.length,
    win: closed.length ? Math.round((w.length / closed.length) * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    avgR: closed.length ? +(R.reduce((a, r) => a + r, 0) / closed.length).toFixed(3) : 0,
    net: Math.round(closed.reduce((a, c) => a + (c.pnl || 0), 0)),
    shortN: shorts.length,
  };
}

function verdict(s) {
  if (s.n >= READY_N && s.avgR > READY_AVGR && s.pf >= READY_PF) return ['✅ GRADUATE', 'forward edge confirmed — promote to live'];
  if (s.n >= REVIEW_N && (s.avgR <= 0 || s.pf < 1)) return ['⚠️ REVIEW', 'losing on live data — rework or retire, do not keep running'];
  return ['· WATCH', `gathering (${s.n}/${READY_N} trades)`];
}

// ---- run ----
const trades = await get('/trades');
const day = await get('/day');
if (!trades) { console.log(`\nCannot reach ${API}/trades — is the worker up / gated?\n`); process.exit(0); }

// Group the shared record's closed trades by asset class (via the server registry).
const byClass = {};
for (const c of (trades.closed || [])) {
  const cls = (MARKETS[c.symbol] && MARKETS[c.symbol].assetClass) || 'other';
  (byClass[cls] ||= []).push(c);
}

console.log(`\nGRADUATION MONITOR — live forward records @ ${API}`);
console.log(`Bar to graduate: n≥${READY_N} · avgR>${READY_AVGR} · pf≥${READY_PF}\n`);

// FORWARD ACTIVATION — the both-ways/FX capability was built but is low-frequency, so
// the live record may show zero of it for weeks (see test/fx-rsi-compare.mjs: FX fires
// ~5x/pair/yr, and that rarity is the robust edge, not a bug). This block makes the
// first real short and the first real FX trade impossible to miss — the moment either
// starts closing trades, it prints here instead of hiding as a 0 in a per-cell row.
const allClosed = [...(trades.closed || []), ...((day && day.closed) || [])];
const clsOf = (c) => (MARKETS[c.symbol] && MARKETS[c.symbol].assetClass) || 'other';
const shortsAll = allClosed.filter((c) => c.side === 'SHORT');
const fxAll = (trades.closed || []).filter((c) => clsOf(c) === 'fx');
const etfAll = (trades.closed || []).filter((c) => clsOf(c) === 'etf');
const activation = (label, arr, expl) => {
  if (!arr.length) { console.log(`  ○ ${label.padEnd(22)} not yet — ${expl}`); return; }
  const s = stats(arr);
  const flag = s.avgR > 0 ? '●' : '◍';
  console.log(`  ${flag} ${label.padEnd(22)} LIVE: n=${s.n} · win ${s.win}% · pf ${s.pf} · avgR ${s.avgR} · net ${s.net}`);
};
console.log('FORWARD ACTIVATION (capabilities built but not yet seen live):');
activation('Short side (any cell)', shortsAll, 'no short has closed — both-ways is low-frequency, expected');
activation('FX (both-ways cell)', fxAll, 'no FX trade has closed — RSI14 extremes are rare, ~5x/pair/yr');
activation('Sector ETFs', etfAll, 'lab-proven but 0 forward trades — US-RTH only, awaiting first oversold dip');
console.log('');

console.log('EXPERIMENT cells (candidates to graduate):');
for (const [key, name] of Object.entries(EXPERIMENT)) {
  const s = stats(byClass[key] || []);
  const [tag, why] = verdict(s);
  console.log(`  ${tag.padEnd(11)} ${name.padEnd(15)} n=${String(s.n).padStart(3)} · win ${String(s.win).padStart(3)}% · pf ${String(s.pf).padStart(5)} · avgR ${String(s.avgR).padStart(6)} · shorts ${String(s.shortN).padStart(3)} · net ${s.net} — ${why}`);
}

// The intraday day cell — its own isolated record.
if (day && Array.isArray(day.closed)) {
  const s = stats(day.closed);
  const [tag, why] = verdict(s);
  console.log(`  ${tag.padEnd(11)} ${'Day (intraday)'.padEnd(15)} n=${String(s.n).padStart(3)} · win ${String(s.win).padStart(3)}% · pf ${String(s.pf).padStart(5)} · avgR ${String(s.avgR).padStart(6)} · shorts ${String(s.shortN).padStart(3)} · net ${s.net} — ${why}`);
}

console.log('\nPROVEN cells (live record, for reference):');
for (const [key, name] of Object.entries(PROVEN)) {
  const s = stats(byClass[key] || []);
  console.log(`  · LIVE       ${name.padEnd(15)} n=${String(s.n).padStart(3)} · win ${String(s.win).padStart(3)}% · pf ${String(s.pf).padStart(5)} · avgR ${String(s.avgR).padStart(6)} · net ${s.net}`);
}

console.log('\nTo graduate a ✅ cell: set its style status to \'live\' in worker/src/classes.js and');
console.log('remove it from EXPERIMENT_CLASSES in assets/js/app/assetClass.js, then redeploy.\n');
