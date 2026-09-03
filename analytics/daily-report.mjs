// Independent DAILY ANALYTICS for the Ajent Strategy. It only READS the deployed
// worker (the live paper record + the strategy's proposed dials) and prints a
// markdown report — it changes NOTHING and cannot interfere with live trading.
// Any change the learning loop proposes is surfaced here for a human to approve;
// it is never applied automatically.
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

  const a = signals.strategy && signals.strategy.adaptive;

  p(`# Ajent Strategy — Daily Report · ${today}`);
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
  p('## Ajent Strategy (evolving)');
  if (!a) {
    p('- Adaptive state not yet reported (awaiting a cron tick).');
  } else if (a.learning) {
    p(`- **Learning** — ${a.trades}/20 pooled trades before the dials adapt. Trading: proven defaults (stop 2× ATR, size 100%).`);
  } else {
    const ad = a.adopted || {};
    p(`- **Trading now (adopted):** stop ${(+(ad.stopMult ?? 2)).toFixed(1)}× ATR · size ${Math.round((ad.sizeMult ?? 1) * 100)}% — adopted ${ad.at ? new Date(ad.at).toISOString().slice(0, 10) : '—'} from ${ad.fromTrades ?? '?'} trades.`);
    p(`- **Latest learned read:** stop ${(+a.stopMult).toFixed(1)}× ATR · size ${Math.round((a.sizeMult || 1) * 100)}% (win rate ${a.winRate}%, ${a.trades} trades).`);
    if (a.nextRetune) p(`- **Next scheduled re-tune:** ${new Date(a.nextRetune).toISOString().slice(0, 10)} — it adopts the learned read then (weekly cadence, within hard bounds). Automatic; no action needed.`);
  }
  p();
  p('## Notes');
  p('- ASX 200 (XJO) is excluded from auto-trading (the robustness sweep found the recipe does not fit it).');
  p('- Run `node worker/test/sweep.mjs` for the full parameter/market robustness check.');
} catch (e) {
  p(`# Ajent Strategy — Daily Report · ${today}`);
  p();
  p(`⚠️ Could not build the report: ${e.message}`);
  p(`(API: ${API})`);
}

console.log(out.join('\n'));
