// The intraday day-trading EXPERIMENT panel — shared by the Paper screen (its primary
// home) and Settings. It surfaces the experiment's OWN live paper record (never a
// backtest headline, never an advertised return) plus the current intraday watch,
// wrapped in an unmissable "experimental / not proven" frame. Populated async from
// GET /day. The record is fully isolated from the proven Swing account.
import { fetchDayExperiment } from './backendApi.js';
import { fmtMoney } from './format.js';

export function dayExperimentPanelHtml() {
  return `<div class="panel setting-block" id="day-exp" style="border:1px solid var(--accent-900)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <i class="ph-fill ph-sun-horizon" style="font-size:20px;color:var(--accent-300)"></i>
      <span class="panel-title" style="margin:0">Day-trading experiment</span>
      <span class="style-badge experiment">Experiment</span>
    </div>
    <div class="setting-help" style="margin:0 0 12px;padding:9px 11px;border-radius:9px;background:color-mix(in srgb, var(--flat) 12%, transparent);border:1px solid color-mix(in srgb, var(--flat) 30%, transparent);color:var(--text)">
      <b>Not proven.</b> Intraday mean-reversion on 15-minute bars, <b>both directions</b> (long dips, short pops), flat by the close. It runs on its own real paper record — separate from your Swing account. The figures below are that <b>live record</b>, not a backtest and not a promise. No returns are advertised.
    </div>
    <div id="day-exp-body"><div class="setting-help" style="margin:0">Loading the live record…</div></div>
  </div>`;
}

function dayStat(label, value, color) {
  return `<div class="risk-result-cell"><div class="v" style="${color ? `color:${color}` : ''}">${value}</div><div class="k">${label}</div></div>`;
}

export async function wireDayExperiment(container) {
  const body = (container || document).querySelector('#day-exp-body');
  if (!body) return;
  let data = null;
  try { data = await fetchDayExperiment(); } catch (e) { /* handled below */ }
  if (!data) {
    body.innerHTML = `<div class="setting-help" style="margin:0">The live experiment record isn't reachable right now (it runs on the server). It'll appear here once connected — nothing is fabricated in the meantime.</div>`;
    return;
  }
  const s = data.summary || { trades: 0, winRate: 0, totalPnl: 0, profitFactor: 0 };
  const open = Array.isArray(data.open) ? data.open : [];
  const closed = Array.isArray(data.closed) ? data.closed : [];
  const signals = Array.isArray(data.signals) ? data.signals : [];
  const pnlColor = s.totalPnl > 0 ? 'var(--buy)' : s.totalPnl < 0 ? 'var(--sell)' : 'var(--text)';
  const recordHtml = s.trades > 0
    ? `<div class="risk-result-grid" style="grid-template-columns:repeat(3,1fr)">
        ${dayStat('closed trades', s.trades)}
        ${dayStat('win rate', `${s.winRate}%`)}
        ${dayStat('net P&L (paper)', fmtMoney(s.totalPnl), pnlColor)}
      </div>
      <div class="setting-help" style="margin-top:6px">Live paper result to date${s.profitFactor != null ? ` · profit factor ${s.profitFactor}` : ''}. Provisional — a short, real record, not a guarantee.</div>`
    : `<div class="setting-help" style="margin:0"><b style="color:var(--text)">No closed trades yet.</b> The experiment only opens when a genuine intraday setup fires on ES, NQ, YM or RTY during the session — <b>long or short</b>, nothing invented to fill the record.</div>`;

  const watchHtml = signals.length
    ? `<div class="eyebrow" style="margin:16px 0 6px">Intraday watch (15-min · both ways)</div>` + signals.map((m) => {
        const v = m.verdict === 'BUY' ? '<span style="color:var(--buy);font-weight:600">BUY</span>'
          : m.verdict === 'SELL' ? '<span style="color:var(--sell);font-weight:600">SELL</span>'
          : `<span class="text-muted">watching${typeof m.proximity === 'number' ? ` · ${m.proximity}%` : ''}</span>`;
        const held = open.find((p) => p.symbol === m.symbol);
        return `<div class="notif-row" style="padding:8px 0"><div class="notif-label" style="flex:1">${m.name}${held ? ` <span style="color:var(--accent-200);font-size:11px">· in a ${held.side === 'SHORT' ? 'short' : 'long'}</span>` : ''}</div><div>${v}</div></div>`;
      }).join('')
    : '';

  const closedHtml = closed.length
    ? `<div class="eyebrow" style="margin:16px 0 6px">Recent closes</div>` + closed.slice(0, 5).map((t) => {
        const c = (t.pnl || 0) > 0 ? 'var(--buy)' : (t.pnl || 0) < 0 ? 'var(--sell)' : 'var(--text)';
        const side = t.side === 'SHORT' ? 'Short' : 'Long';
        return `<div class="notif-row" style="padding:7px 0"><div class="notif-label" style="flex:1">${t.name} <span class="text-muted" style="font-size:11px">· ${side} · ${t.exitReason || 'closed'}</span></div><div style="color:${c};font-weight:600">${fmtMoney(t.pnl || 0)}</div></div>`;
      }).join('')
    : '';

  body.innerHTML = recordHtml + watchHtml + closedHtml;
}
