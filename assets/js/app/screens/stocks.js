import { fetchStocks } from '../backendApi.js';
import { fmtPrice, fmtMoney } from '../format.js';

// Stock screener + tracked EXPERIMENT — the proven swing strategy scanned daily across
// a diversified large-cap universe, and auto-paper-traded on its OWN isolated record.
// Validated through the gate (test/promote-stocks.mjs: pf 1.47, OOS +0.11) but long-
// only and single names gap on earnings, so it's diversified and clearly unproven.
let cache = null;

// The stocks paper record — its own isolated account, framed as an experiment.
function stocksRecordHtml(data) {
  const s = data.summary || { trades: 0, winRate: 0, totalPnl: 0, profitFactor: null };
  const open = Array.isArray(data.open) ? data.open : [];
  const closed = Array.isArray(data.closed) ? data.closed : [];
  const pnlColor = s.totalPnl > 0 ? 'var(--buy)' : s.totalPnl < 0 ? 'var(--sell)' : 'var(--text)';
  const recentHtml = closed.length
    ? `<div class="eyebrow" style="margin:14px 0 4px">Recent closes</div>` + closed.slice(0, 5).map((t) => {
        const c = (t.pnl || 0) > 0 ? 'var(--buy)' : (t.pnl || 0) < 0 ? 'var(--sell)' : 'var(--text)';
        return `<div class="notif-row" style="padding:7px 0"><div class="notif-label" style="flex:1">${t.symbol} <span class="text-muted" style="font-size:11px">· ${t.exitReason || 'closed'}</span></div><div style="color:${c};font-weight:600">${fmtMoney(t.pnl || 0)}</div></div>`;
      }).join('')
    : '';
  const body = s.trades > 0
    ? `<div class="stk-summary" style="margin:2px 0 4px"><span><b class="mono">${s.trades}</b> trades</span><span><b class="mono">${s.winRate}%</b> win</span><span style="color:${pnlColor}"><b class="mono">${fmtMoney(s.totalPnl)}</b> net</span>${s.profitFactor != null ? `<span class="text-faint">PF ${s.profitFactor}</span>` : ''}</div>${recentHtml}`
    : `<div class="text-muted" style="font-size:12.5px;line-height:1.55;padding:2px 0">No closed trades yet — it opens paper positions on the daily scan as names fire, across the whole universe (never one name), and books them on this record. Check back as it runs.</div>`;
  return `<div class="panel" id="stk-record" style="border:1px solid var(--accent-900);margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><i class="ph-fill ph-flask" style="font-size:19px;color:var(--accent-300)"></i><span class="panel-title" style="margin:0">Tracked paper record</span><span class="style-badge experiment">Experiment</span></div>
    <div class="setting-help" style="margin:0 0 8px;font-size:11.5px">Auto-paper-traded on its own account (${open.length} open), separate from the Swing record. Diversified &amp; long-only; single names can gap on earnings. Live figures, not a backtest, not a promise.</div>
    ${body}
  </div>`;
}

function buyCard(s) {
  const conv = s.conviction === 'high';
  return `<div class="stk-card buy">
    <div class="stk-top"><span class="stk-sym">${s.symbol}</span><span class="stk-verdict">↗ BUY</span></div>
    <div class="stk-row2"><span class="stk-px">${fmtPrice(s.price, 2)}</span><span class="stk-conf">${s.confidence}% conf${conv ? ' <span class="stk-badge">DEEP</span>' : ''}</span></div>
    ${s.plan ? `<div class="stk-plan"><span>Entry <b>${fmtPrice(s.plan.entry, 2)}</b></span><span>Stop <b style="color:var(--sell)">${fmtPrice(s.plan.stop, 2)}</b></span><span>Target <b style="color:var(--buy)">${fmtPrice(s.plan.target1, 2)}</b></span></div>` : ''}
  </div>`;
}

function watchRow(s) {
  const prox = Math.max(0, Math.min(100, s.proximity || 0));
  return `<div class="stk-watch" data-nav="#/signal/${s.symbol}" style="cursor:pointer">
    <span class="stk-sym">${s.symbol}</span>
    <span class="stk-w-meta">${prox}% of the way to a setup</span>
    <div class="stk-prox"><div class="stk-prox-bar"><i style="width:${Math.max(2, prox)}%"></i></div><span>${prox}%</span></div>
  </div>`;
}

function content(data) {
  const stocks = (data && data.stocks) || [];
  if (!stocks.length) {
    return `<div class="panel"><div class="text-muted" style="font-size:13px;line-height:1.6;padding:6px 2px">The screener runs once a day after the US close. Signals will appear here after the next scan.</div></div>`;
  }
  const buys = stocks.filter((s) => s.verdict === 'BUY');
  const upN = stocks.filter((s) => s.htfTrend === 'up').length;
  // "Closest to firing" only lists names in an uptrend — a downtrend name can't fire a
  // long, so it isn't honestly "close" to this long-only setup.
  const watch = stocks.filter((s) => s.verdict !== 'BUY' && s.htfTrend === 'up' && (s.proximity || 0) > 0).sort((a, b) => (b.proximity || 0) - (a.proximity || 0)).slice(0, 12);
  const when = data.day ? `Scanned ${data.day}` : '';
  const total = stocks.length || 1;
  return `
    ${stocksRecordHtml(data)}
    <div class="stk-summary"><span><b class="mono" style="color:var(--buy)">${buys.length}</b> firing</span><span><b class="mono" style="color:var(--buy)">${upN}</b>/${stocks.length} in an uptrend</span><span class="text-faint">${when}</span></div>
    <div class="stk-breadth"><span style="width:${Math.round((upN / total) * 100)}%"></span></div>
    ${buys.length ? `<div class="section-label">Firing now</div><div class="stk-grid">${buys.map(buyCard).join('')}</div>` : '<div class="panel"><div class="text-muted" style="font-size:13px;padding:6px 2px">No stock is firing a BUY right now — most of the time the honest answer is "no trade". The uptrend names closest to a setup are below.</div></div>'}
    ${watch.length ? `<div class="section-label">Closest to firing</div><div class="panel" style="padding:2px 12px">${watch.map(watchRow).join('')}</div>` : ''}
  `;
}

export function render(container) {
  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Stocks</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 6px;line-height:1.55">The proven <b style="color:var(--text)">Ajent Pulse</b> swing strategy, scanned daily across a diversified large-cap universe — and <b style="color:var(--text)">auto-paper-traded on its own experiment record</b>, separate from the Swing account.</p>
    <div class="stk-note"><b>Why a screener?</b> The edge is validated across stocks <b>in aggregate</b>, but any single name can gap on earnings — so trade a diversified handful of what's firing, never one name on conviction. Educational, not advice.</div>
    <div id="stk-wrap">${cache ? content(cache) : '<div class="panel"><div class="text-muted" style="text-align:center;padding:24px 0;font-size:13px">Loading the screener…</div></div>'}</div>
  </div>`;

  fetchStocks().then((d) => {
    cache = d;
    const w = container.querySelector('#stk-wrap');
    if (w) w.innerHTML = content(d);
  }).catch(() => {
    const w = container.querySelector('#stk-wrap');
    if (w && !cache) w.innerHTML = `<div class="panel"><div class="text-muted" style="font-size:13px;padding:6px 2px">Couldn't load the screener right now. Try again shortly.</div></div>`;
  });
}
