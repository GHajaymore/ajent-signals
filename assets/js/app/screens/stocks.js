import { fetchStocks } from '../backendApi.js';
import { fmtPrice } from '../format.js';

// Stock screener — the proven swing strategy scanned daily across a diversified
// large-cap universe. Signals ONLY (not auto-traded; single-name risk). Validated in
// AGGREGATE (test/phase2.mjs), so the honest read is "consider the ones firing across
// many names", never "this one stock will win".
let cache = null;

function buyCard(s) {
  return `<div class="stk-card buy">
    <div class="stk-top"><span class="stk-sym">${s.symbol}</span><span class="stk-verdict">↗ BUY</span></div>
    <div class="stk-row2"><span class="stk-px">${fmtPrice(s.price, 2)}</span><span class="stk-conf">${s.confidence}% conf</span></div>
    ${s.plan ? `<div class="stk-plan"><span>Entry <b>${fmtPrice(s.plan.entry, 2)}</b></span><span>Stop <b style="color:var(--sell)">${fmtPrice(s.plan.stop, 2)}</b></span><span>Target <b style="color:var(--buy)">${fmtPrice(s.plan.target1, 2)}</b></span></div>` : ''}
  </div>`;
}

function watchRow(s) {
  return `<div class="stk-watch">
    <span class="stk-sym">${s.symbol}</span>
    <span class="stk-w-meta">${s.htfTrend === 'up' ? 'uptrend' : 'downtrend'}</span>
    <div class="stk-prox"><div class="stk-prox-bar"><i style="width:${Math.max(2, s.proximity || 0)}%"></i></div><span>${s.proximity || 0}%</span></div>
  </div>`;
}

function content(data) {
  const stocks = (data && data.stocks) || [];
  if (!stocks.length) {
    return `<div class="panel"><div class="text-muted" style="font-size:13px;line-height:1.6;padding:6px 2px">The screener runs once a day after the US close. Signals will appear here after the next scan.</div></div>`;
  }
  const buys = stocks.filter((s) => s.verdict === 'BUY');
  const watch = stocks.filter((s) => s.verdict !== 'BUY' && (s.proximity || 0) > 0).sort((a, b) => (b.proximity || 0) - (a.proximity || 0)).slice(0, 10);
  const when = data.day ? `Scanned ${data.day}` : '';
  return `
    <div class="stk-summary"><span><b class="mono" style="color:var(--buy)">${buys.length}</b> firing</span><span><b class="mono">${stocks.length}</b> scanned</span><span class="text-faint">${when}</span></div>
    ${buys.length ? `<div class="section-label">Firing now</div><div class="stk-grid">${buys.map(buyCard).join('')}</div>` : '<div class="panel"><div class="text-muted" style="font-size:13px;padding:6px 2px">No stock is firing a BUY right now — most of the time the honest answer is "no trade". The closest are below.</div></div>'}
    ${watch.length ? `<div class="section-label">Closest to firing</div><div class="panel" style="padding:2px 12px">${watch.map(watchRow).join('')}</div>` : ''}
  `;
}

export function render(container) {
  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Stocks</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 6px;line-height:1.55">The proven <b style="color:var(--text)">Ajent Pulse</b> swing strategy, scanned daily across a diversified large-cap universe. <b style="color:var(--text)">Signals to consider</b> — not auto-traded into the tracked record.</p>
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
