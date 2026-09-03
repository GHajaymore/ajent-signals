// Independent DAILY ANALYTICS for Ajent Pulse. It only READS the deployed worker
// (the live paper record + the strategy's adopted/learned dials) and prints a
// markdown report — it changes NOTHING and cannot interfere with live trading.
// The strategy auto-adapts on a weekly cadence within hard bounds; this report
// just shows what it did.
//   node analytics/daily-report.mjs           → prints the report
//   (CI writes it to the job summary + an artifact — see daily-analytics.yml)
const API = process.env.AJENT_API || 'https://ajent-signals-worker.golferajay.workers.dev';
const money = (n) => `${n >= 0 ? '+$' : '-$'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const day0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

async function getJson(path) {
  const r = await fetch(API + path, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

const out = [];
const p = (s = '') => out.push(s);
const today = new Date().toISOString().slice(0, 10);

try {
  const [trades, signals] = await Promise.all([getJson('/trades'), getJson('/signals')]);
  const closed = trades.closed || [];
  const open = trades.open || [];
  const s = closed.length;
  const wins = closed.filter((c) => (c.pnl || 0) > 0).length;
  const losses = closed.filter((c) => (c.pnl || 0) < 0).length;
  const gw = closed.filter((c) => c.pnl > 0).reduce((a, c) => a + c.pnl, 0);
  const gl = Math.abs(closed.filter((c) => c.pnl < 0).reduce((a, c) => a + c.pnl, 0));
  const net = closed.reduce((a, c) => a + (c.pnl || 0), 0);
  const pf = gl ? (gw / gl).toFixed(2) : '∞';
  const winRate = wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0;

  const t0 = day0();
  const closedToday = closed.filter((c) => (c.closedAt || 0) >= t0);
  const netToday = closedToday.reduce((a, c) => a + (c.pnl || 0), 0);

  const a = signals.strategy && signals.strategy.adaptiveState;

  p(`# Ajent Pulse — Daily Report · ${today}`);
  p();
  p('_Independent, read-only report. The strategy auto-adapts within hard safety bounds; this shows what it did — no action needed._');
  p();
  p('## Live paper record');
  p(`- **Net P&L:** ${money(net)} over ${s} trade${s === 1 ? '' : 's'}`);
  p(`- **Profit factor:** ${pf} · **win rate:** ${winRate}% (${wins}W / ${losses}L)`);
  p(`- **Open positions:** ${open.length}`);
  p();
  p('## Today');
  p(`- Closed today: **${closedToday.length}** (${money(netToday)})`);
  if (closedToday.length) for (const c of closedToday) p(`  - ${c.symbol} ${c.side} · ${c.outcome} · ${money(c.pnl || 0)} · exit ${c.exitReason}`);
  p();
  // Per-engine breakdown (mean-reversion vs trend) — so each edge's real
  // contribution is visible. Trades before the ensemble default to mean-reversion.
  const engines = { mr: 'Mean-reversion', trend: 'Trend-follow' };
  const byEngine = {};
  for (const c of closed) { const k = c.strat || 'mr'; (byEngine[k] = byEngine[k] || []).push(c); }
  p('## By engine');
  if (!closed.length) p('- No closed trades yet.');
  for (const k of Object.keys(engines)) {
    const list = byEngine[k] || [];
    if (!list.length) { p(`- **${engines[k]}:** no closed trades yet.`); continue; }
    const w = list.filter((c) => (c.pnl || 0) > 0).length;
    const l = list.filter((c) => (c.pnl || 0) < 0).length;
    const net = list.reduce((a, c) => a + (c.pnl || 0), 0);
    const gwn = list.filter((c) => c.pnl > 0).reduce((a, c) => a + c.pnl, 0);
    const gln = Math.abs(list.filter((c) => c.pnl < 0).reduce((a, c) => a + c.pnl, 0));
    const ew = a && a.engines && a.engines[k];
    const wStr = ew ? (ew.learning ? ` · weight 1.0× (learning ${ew.trades}/12)` : ` · weight ${(+ew.weight).toFixed(2)}×`) : '';
    p(`- **${engines[k]}:** ${money(net)} over ${list.length} trade${list.length === 1 ? '' : 's'} · ${w + l ? Math.round((w / (w + l)) * 100) : 0}% win · PF ${gln ? (gwn / gln).toFixed(2) : '∞'}${wStr}`);
  }
  p();
  p('## Ajent Pulse (evolving)');
  if (!a) {
    p('- Adaptive state not yet reported (awaiting a cron tick).');
  } else if (a.learning) {
    p(`- **Learning** — ${a.trades}/20 pooled trades before the strategy re-tunes. Trading its proven defaults.`);
  } else {
    p(`- **Adapting automatically** on a weekly cadence, within hard safety bounds (${a.trades} trades pooled, ${a.winRate}% win). No action needed.`);
    if (a.retunedAt) p(`- Last re-tuned: ${new Date(a.retunedAt).toISOString().slice(0, 10)}.`);
    if (a.nextRetune) p(`- Next scheduled re-tune: ${new Date(a.nextRetune).toISOString().slice(0, 10)}.`);
  }
  p();
  p('## Notes');
  p('- ASX 200 (XJO) is excluded from auto-trading (the robustness sweep found the recipe does not fit it).');
  p('- Robustness is auto-checked weekly (`.github/workflows/lab-benchmark.yml`); run `node analytics/lab-benchmark.mjs` on demand for the full parameter/market sweep + drift check.');
} catch (e) {
  p(`# Ajent Pulse — Daily Report · ${today}`);
  p();
  p(`⚠️ Could not build the report: ${e.message}`);
  p(`(API: ${API})`);
}

console.log(out.join('\n'));
