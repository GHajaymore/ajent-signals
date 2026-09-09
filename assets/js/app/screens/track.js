import { getClosedTrades, getPerformanceSummary, getOpenPositions, tradePnl } from '../paperTrading.js';
import { userStats, getUserBook, closeUserTrade, cancelUserOrder, cancelAllPending, userTradeFor, riskLimitsStatus } from '../userBook.js';
import { customStats, ajentAvgR, getCustomBook, closeCustomPosition, closeAllCustom } from '../customBook.js';
import { positionCallPill, updateCallPill, exitProgressText, posDomKey } from '../tradeGuidance.js';
import { getStrategy, getAdaptive } from '../strategyMeta.js';
import { fmtPrice } from '../format.js';
import { state, getEnabledPaperMarkets, setPaperMarketEnabled, setAllPaperMarkets, setPaperMarkets, FREE_MARKET_LIMIT } from '../state.js';
import { isEntitled, fetchLab } from '../backendApi.js';
import { CATEGORY_ORDER } from '../mockEngine.js';
import { groupForSymbol, labelForKey, EXPERIMENT_CLASSES, ASSET_GROUPS } from '../assetClass.js';
import { fmtMoney as fmtMoneyCcy } from '../currency.js';
import { hoverAttrs, hoverLayerSvg, wireChartHover } from '../chartHover.js';
import { isOwner } from '../role.js';
import { shareOrCopy } from '../share.js';

// Share the honest You-vs-Ajent result — avg R per trade (performance, never the recipe).
// The link points at the app's start so a recipient can run their own trial, not at the
// sharer's private record. User-initiated.
function shareResult(you, cs, ajR) {
  const fmtR = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v}R`);
  const mine = [];
  if (you.trades) mine.push(`my trades ${fmtR(you.avgR)}/trade over ${you.trades}`);
  if (cs.trades) mine.push(`my strategy ${fmtR(cs.avgR)}/trade over ${cs.trades}`);
  const text = `Competing against Ajent on Ajent Signals — ${mine.join(', ')}, vs Ajent ${fmtR(ajR)}/trade. Educational paper trading on a real virtual-money record — avg R/trade is the fair, scale-independent read. Not investment advice.`;
  const url = location.origin + '/';
  return shareOrCopy({ title: 'You vs Ajent · Ajent Signals', text, url });
}

// Coarse region grouping for the quick paper-trade presets, from each market's
// country code. Anything unmapped falls into "Other".
const REGION_BY_COUNTRY = {
  US: 'US',
  IN: 'India',
  GB: 'Europe', DE: 'Europe', FR: 'Europe', EU: 'Europe', CH: 'Europe',
  JP: 'Asia', HK: 'Asia', CN: 'Asia', SG: 'Asia', AU: 'Asia', NZ: 'Asia',
  CA: 'Other', BR: 'Other',
};
const REGION_ORDER = ['US', 'Europe', 'Asia', 'India', 'Other'];
const regionOf = (country) => REGION_BY_COUNTRY[country] || 'Other';
const symbolsInRegion = (region) => state.engine.markets.filter((m) => regionOf(m.country) === region).map((m) => m.symbol);

// Compact current-signal indicator per market, so you can pick markets that are
// actually trending. Reflects the same BUY/SELL/NO_TRADE verdict as everywhere.
function verdictBits(verdict) {
  if (verdict === 'BUY') return { cls: 'buy', inner: '<i class="ph-fill ph-caret-up"></i>Buy' };
  if (verdict === 'SELL') return { cls: 'sell', inner: '<i class="ph-fill ph-caret-down"></i>Sell' };
  return { cls: 'flat', inner: 'Flat' };
}
function pmVerdictTag(verdict, symbol) {
  const b = verdictBits(verdict);
  return `<span class="pm-trend ${b.cls}" data-pm-trend="${symbol}">${b.inner}</span>`;
}

function marketSelector() {
  const engine = state.engine;
  const all = engine.markets.map((m) => m.symbol);
  const enabled = getEnabledPaperMarkets(all);
  const threshold = state.settings.threshold;
  const byCat = {};
  for (const m of engine.markets) (byCat[m.category] = byCat[m.category] || []).push(m);
  const cats = CATEGORY_ORDER.filter((c) => byCat[c]);
  return `
  <div class="panel" style="padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div class="panel-title" style="margin-bottom:2px">Auto-traded markets</div>
        <div class="text-muted" style="font-size:12px" id="pm-count">${enabled.size} of ${all.length} · only these auto-trade signals</div>
        ${isEntitled() ? '' : `<div style="font-size:11.5px;color:var(--accent-200);margin-top:3px;display:flex;align-items:center;gap:5px"><i class="ph-fill ph-crown-simple" style="font-size:12px;color:#ffca4d"></i> Free: ${FREE_MARKET_LIMIT} market at a time · <a href="#/paywall" style="color:var(--accent-100);text-decoration:underline">Go Pro for all ${all.length}</a></div>`}
      </div>
      <button class="btn btn-ghost" id="pm-toggle" style="height:34px;padding:0 16px;font-size:13px;flex:none">Edit</button>
    </div>
    <div id="pm-list" style="display:none;margin-top:14px">
      <div class="eyebrow" style="margin-bottom:6px">Limit to a region</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${REGION_ORDER.map((r) => `<button class="chip region-chip" data-region="${r}" style="cursor:pointer;background:var(--neutral-900);color:var(--text-muted)">${r}</button>`).join('')}
      </div>
      <div class="eyebrow" style="margin-bottom:6px">Or pick individually</div>
      <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <button class="chip" id="pm-all" style="cursor:pointer;background:var(--accent-800);color:var(--accent-100)">Select all</button>
        <button class="chip" id="pm-none" style="cursor:pointer;background:var(--neutral-900);color:var(--text-muted)">Clear all</button>
        <button class="chip" id="pm-signalling" style="cursor:pointer;background:var(--neutral-900);color:var(--buy)"><i class="ph-fill ph-lightning" style="font-size:11px"></i> Signalling now</button>
      </div>
      ${cats.map((cat) => {
        const list = byCat[cat];
        const on = list.filter((m) => enabled.has(m.symbol)).length;
        return `
        <details class="pm-group" data-cat="${cat}">
          <summary>
            <span class="pm-cat-name">${cat}</span>
            <span class="pm-cat-count">${on}/${list.length}</span>
            <i class="ph ph-caret-down"></i>
          </summary>
          ${list.map((m) => `
            <div class="notif-row">
              <div class="notif-label" style="display:flex;align-items:center;gap:10px;min-width:0">
                <span style="font:700 11px var(--font-heading)">${m.symbol}</span>
                <span class="text-muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
              </div>
              ${pmVerdictTag(m.verdict(threshold), m.symbol)}
              <div class="switch ${enabled.has(m.symbol) ? 'on' : ''}" data-pm-sym="${m.symbol}"></div>
            </div>`).join('')}
        </details>`;
      }).join('')}
    </div>
  </div>`;
}

function wireSelector(container) {
  const toggleBtn = container.querySelector('#pm-toggle');
  const list = container.querySelector('#pm-list');
  if (toggleBtn && list) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = list.style.display !== 'none';
      list.style.display = isOpen ? 'none' : 'block';
      toggleBtn.textContent = isOpen ? 'Edit' : 'Done';
    });
  }
  const all = state.engine.markets.map((m) => m.symbol);
  // Re-paint every switch from the ACTUAL enabled set (which the state layer
  // caps to FREE_MARKET_LIMIT for Free users) so the UI never lies — e.g. on
  // Free, enabling one market visibly turns the others off.
  const syncSwitches = () => {
    const enabledNow = getEnabledPaperMarkets(all);
    container.querySelectorAll('[data-pm-sym]').forEach((sw) => sw.classList.toggle('on', enabledNow.has(sw.dataset.pmSym)));
  };
  const updateCount = () => {
    syncSwitches();
    const el = container.querySelector('#pm-count');
    if (el) el.textContent = `${getEnabledPaperMarkets(all).size} of ${all.length} · only these auto-trade signals`;
    // Keep each collapsible group's "on/total" badge in sync.
    container.querySelectorAll('.pm-group[data-cat]').forEach((g) => {
      const sw = [...g.querySelectorAll('[data-pm-sym]')];
      const badge = g.querySelector('.pm-cat-count');
      if (badge) badge.textContent = `${sw.filter((s) => s.classList.contains('on')).length}/${sw.length}`;
    });
  };
  container.querySelectorAll('[data-pm-sym]').forEach((sw) => {
    sw.addEventListener('click', () => {
      const on = !sw.classList.contains('on');
      setPaperMarketEnabled(sw.dataset.pmSym, on, all);
      updateCount();
    });
  });
  const allBtn = container.querySelector('#pm-all');
  const noneBtn = container.querySelector('#pm-none');
  if (allBtn) allBtn.addEventListener('click', () => {
    // Free tier can't select all — send them to the paywall instead.
    if (!isEntitled()) { window.location.hash = '#/paywall'; return; }
    setAllPaperMarkets(true, all);
    updateCount();
  });
  if (noneBtn) noneBtn.addEventListener('click', () => {
    setAllPaperMarkets(false, all);
    updateCount();
  });
  // Quick-select every market currently printing a BUY or SELL signal.
  const sigBtn = container.querySelector('#pm-signalling');
  if (sigBtn) sigBtn.addEventListener('click', () => {
    const threshold = state.settings.threshold;
    const syms = new Set(state.engine.markets.filter((m) => m.verdict(threshold) !== 'NO_TRADE').map((m) => m.symbol));
    setPaperMarkets([...syms]);
    updateCount();
  });
  // Region presets: limit auto-trading to one region in a tap. The individual
  // switches below still work, so you can fine-tune from there.
  container.querySelectorAll('[data-region]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const syms = new Set(symbolsInRegion(chip.dataset.region));
      setPaperMarkets([...syms]);
      updateCount();
    });
  });
}

// Plain-dollar formatter, e.g. +$1,240 / -$250
function money(n) { return fmtMoneyCcy(n); } // display currency (local by default, USD toggle)

function fmtHoldMin(min) {
  if (min < 60) return `${min} min`;
  return `${(min / 60).toFixed(1)} hrs`;
}

// --- Selectable Profit & Loss (Daily / Monthly / Quarterly / YTD / Custom) ---
let pnlPeriod = 'monthly';
let pnlFrom = '', pnlTo = '';
let renderedClosedCount = -1; // so the record view re-renders when a trade closes
function bucketOf(ts, grp) {
  const d = new Date(ts);
  if (grp === 'daily') return { key: d.toDateString(), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), sort: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
  if (grp === 'quarterly') { const q = Math.floor(d.getMonth() / 3) + 1; return { key: `${d.getFullYear()}Q${q}`, label: `Q${q} '${String(d.getFullYear()).slice(2)}`, sort: new Date(d.getFullYear(), (q - 1) * 3, 1).getTime() }; }
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), sort: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
}
// Group realized P&L into buckets for the chosen period. Real closed trades only.
function pnlBuckets(closed, period, from, to) {
  let items = closed.map((c) => ({ t: c.closedAt || Date.now(), v: tradePnl(c) }));
  if (period === 'ytd') { const y = new Date().getFullYear(); items = items.filter((x) => new Date(x.t).getFullYear() === y); }
  if (period === 'custom') {
    const f = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
    const t = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
    items = items.filter((x) => x.t >= f && x.t <= t);
  }
  const grp = period === 'ytd' ? 'monthly' : period === 'custom' ? 'daily' : period;
  const map = new Map();
  for (const x of items) { const b = bucketOf(x.t, grp); const e = map.get(b.key) || { value: 0, sort: b.sort, label: b.label }; e.value += x.v; map.set(b.key, e); }
  const cap = grp === 'daily' ? 14 : grp === 'monthly' ? 12 : 8;
  const bars = [...map.values()].sort((a, b) => a.sort - b.sort).slice(-cap);
  return { bars, total: items.reduce((s, x) => s + x.v, 0), count: items.length };
}
function pnlPanel(closed) {
  const periods = [['daily', 'Daily'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['ytd', 'YTD'], ['custom', 'Custom']];
  const { bars, total, count } = pnlBuckets(closed, pnlPeriod, pnlFrom, pnlTo);
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  const col = total >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `<div class="panel" id="pnl-panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <div class="panel-title" style="margin-bottom:0">Profit &amp; loss</div>
        <div style="text-align:right;white-space:nowrap"><span style="font:800 17px var(--font-heading);color:${col}">${money(total)}</span> <span class="text-muted" style="font-size:11px">· ${count} trade${count === 1 ? '' : 's'}</span></div>
      </div>
      <div class="pnl-periods" id="pnl-period">${periods.map(([id, label]) => `<button class="pchip ${pnlPeriod === id ? 'on' : ''}" data-period="${id}">${label}</button>`).join('')}</div>
      ${pnlPeriod === 'custom' ? `<div class="pnl-custom"><input type="date" id="pnl-from" class="date-input" value="${pnlFrom}"><span class="text-muted" style="font-size:12px">to</span><input type="date" id="pnl-to" class="date-input" value="${pnlTo}"></div>` : ''}
      ${bars.length ? `<div class="bar-chart">${bars.map((b) => {
        const c = b.value >= 0 ? 'var(--buy)' : 'var(--sell)';
        const h = Math.max(6, (Math.abs(b.value) / maxAbs) * 100);
        return `<div class="bar-col"><span class="bv" style="color:${c}">${money(b.value)}</span><div class="b" style="height:${h}%;background:${c}"></div><span class="bl">${b.label}</span></div>`;
      }).join('')}</div>` : `<div class="text-muted" style="font-size:12.5px;padding:18px 2px;text-align:center">No closed trades in this period.</div>`}
    </div>`;
}
function wirePnl(container) {
  const rebuild = () => {
    const closed = getClosedTrades();
    const panel = container.querySelector('#pnl-panel');
    if (!panel) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = pnlPanel(closed);
    panel.replaceWith(tmp.firstElementChild);
    wirePnl(container);
  };
  container.querySelectorAll('#pnl-period .pchip').forEach((chip) => {
    chip.addEventListener('click', () => { if (pnlPeriod === chip.dataset.period) return; pnlPeriod = chip.dataset.period; rebuild(); });
  });
  const from = container.querySelector('#pnl-from');
  const to = container.querySelector('#pnl-to');
  if (from) from.addEventListener('change', () => { pnlFrom = from.value; rebuild(); });
  if (to) to.addEventListener('change', () => { pnlTo = to.value; rebuild(); });
}

// Performance by ENGINE — mean-reversion vs trend-follow — so each edge's real
// contribution shows. Trades logged before engine-tagging existed carry no `strat`;
// we don't credit either engine with them (that would misstate a live engine's
// record) — they sit in their own honest "Earlier signals" bucket.
const ENGINE_NAME = { mr: 'Mean-reversion', trend: 'Trend-follow', legacy: 'Earlier signals' };
function byEngineHtml(closed) {
  const map = new Map();
  for (const c of closed) {
    const k = c.strat || 'legacy';
    const e = map.get(k) || { key: k, trades: 0, wins: 0, losses: 0, pnl: 0 };
    const p = tradePnl(c);
    e.trades += 1; e.pnl += p;
    if (p > 0) e.wins += 1; else if (p < 0) e.losses += 1;
    map.set(k, e);
  }
  const rows = [...map.values()];
  if (rows.length < 2) return ''; // only show once both engines have traded
  return `
    <div class="section-label">Performance by engine</div>
    <div class="card" style="padding:2px 12px">
      ${rows.sort((a, b) => b.pnl - a.pnl).map((e) => {
        const decisive = e.wins + e.losses;
        const wr = decisive ? Math.round((e.wins / decisive) * 100) : 0;
        const color = e.pnl >= 0 ? 'var(--buy)' : 'var(--sell)';
        const icon = e.key === 'trend' ? 'ph-trend-up' : e.key === 'legacy' ? 'ph-clock-counter-clockwise' : 'ph-arrow-bend-down-right';
        return `<div class="closed-row">
          <div class="closed-sym"><i class="ph-fill ${icon}" style="font-size:16px;color:var(--accent-300)"></i></div>
          <div class="closed-body">
            <div class="closed-title">${ENGINE_NAME[e.key] || e.key}</div>
            <div class="closed-sub">${e.trades} trade${e.trades === 1 ? '' : 's'} · ${wr}% win</div>
          </div>
          <div class="closed-result"><div class="r" style="color:${color}">${money(e.pnl)}</div></div>
        </div>`;
      }).join('')}
    </div>`;
}

// Group real closed trades by market → net P&L, win rate, count. Sorted best→worst.
function byMarketStats(closed) {
  const map = new Map();
  for (const c of closed) {
    const p = tradePnl(c);
    const e = map.get(c.symbol) || { symbol: c.symbol, name: c.name || c.symbol, trades: 0, wins: 0, losses: 0, pnl: 0 };
    e.trades += 1; e.pnl += p;
    if (p > 0) e.wins += 1; else if (p < 0) e.losses += 1;
    map.set(c.symbol, e);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl);
}

function byMarketHtml(closed) {
  const rows = byMarketStats(closed);
  if (rows.length < 2) return '';
  return `
    <details class="panel" style="padding:12px 16px;margin-top:12px">
      <summary style="cursor:pointer;font:600 13.5px var(--font-heading);display:flex;align-items:center;justify-content:space-between;gap:10px"><span>Performance by market</span><i class="ph ph-caret-down" style="color:var(--text-muted);flex:none"></i></summary>
      <div style="margin-top:6px">
      ${rows.map((m) => {
        const decisive = m.wins + m.losses;
        const wr = decisive ? Math.round((m.wins / decisive) * 100) : 0;
        const color = m.pnl >= 0 ? 'var(--buy)' : 'var(--sell)';
        return `<div class="closed-row" data-nav="#/signal/${m.symbol}" style="cursor:pointer">
          <div class="closed-sym">${m.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${m.name}</div>
            <div class="closed-sub">${m.trades} trade${m.trades === 1 ? '' : 's'} · ${wr}% win</div>
          </div>
          <div class="closed-result"><div class="r" style="color:${color}">${money(m.pnl)}</div></div>
        </div>`;
      }).join('')}
      </div>
    </details>`;
}

// Group real closed trades by ASSET CLASS → net P&L, win rate, count. Flags which
// class is LEADING the record (best, in profit) and which is LAGGING (worst, in the
// red) — a natural antonym pair — but only once the sample is big enough to be honest,
// and always marks an unproven class (crypto) as EXPERIMENTAL. The overall record above
// is unchanged; this just shows where the money is actually coming from.
const ACLASS_MIN = 5; // don't call a class leading/lagging on a tiny sample
const ACLASS_ICON = { index: 'ph-chart-line-up', etf: 'ph-squares-four', crypto: 'ph-currency-btc', fx: 'ph-currency-dollar', futures: 'ph-scales' };

function byAssetClassStats(closed) {
  const map = new Map();
  for (const c of closed) {
    const k = groupForSymbol(c.symbol) || 'other';
    const p = tradePnl(c);
    const e = map.get(k) || { key: k, trades: 0, wins: 0, losses: 0, pnl: 0 };
    e.trades += 1; e.pnl += p;
    if (p > 0) e.wins += 1; else if (p < 0) e.losses += 1;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl);
}

// Where each market stands — the honest lifecycle at a glance. Lists EVERY asset-class
// cell (even ones with no trade yet), its proven/experiment status, its trade direction,
// and how many live trades it has on the record. Makes the promote→experiment→graduate
// path visible to users, not just something that happens in the lab.
const CELL_DIR = { index: 'Long-only', etf: 'Long-only', crypto: 'Long-only', fx: 'Both ways', futures: 'Both ways' };
function strategyStatusHtml(closed) {
  const count = {};
  for (const c of closed) { const k = groupForSymbol(c.symbol) || 'other'; count[k] = (count[k] || 0) + 1; }
  const cells = ASSET_GROUPS.filter((g) => CELL_DIR[g.key]).sort((a, b) => (EXPERIMENT_CLASSES.has(a.key) - EXPERIMENT_CLASSES.has(b.key)));
  const rows = cells.map((g) => {
    const proven = !EXPERIMENT_CLASSES.has(g.key);
    const n = count[g.key] || 0;
    const badge = proven ? '<span class="cell-badge live">PROVEN</span>' : '<span class="cell-badge exp">EXPERIMENT</span>';
    // A cell with no trades yet isn't broken — its setup just hasn't fired on the live
    // record (FX/commodity extremes are rare; ETFs trade only in US hours). Say so,
    // rather than showing a bare "0" that reads as failure.
    const activity = n > 0
      ? `<b>${n}</b> live trade${n === 1 ? '' : 's'}`
      : '<span class="cell-await">awaiting first setup</span>';
    return `<div class="cell-row">
      <div class="cell-main"><span class="cell-name">${g.label}</span>${badge}</div>
      <div class="cell-meta">${CELL_DIR[g.key]} · ${activity}</div>
    </div>`;
  }).join('');
  // Cells that run on their OWN isolated record (not the board's shared account), so
  // they're listed here for completeness but their trade counts live on their panels.
  const extraRows = [
    { label: 'Stocks screener', dir: 'Long-only' },
  ].map((e) => `<div class="cell-row">
      <div class="cell-main"><span class="cell-name">${e.label}</span><span class="cell-badge exp">EXPERIMENT</span></div>
      <div class="cell-meta">${e.dir} · own record</div>
    </div>`).join('');
  return `
    <div class="section-label">Strategy status</div>
    <div class="card" style="padding:2px 12px">${rows}${extraRows}</div>
    <div class="text-faint" style="font-size:11px;line-height:1.5;margin:6px 2px 14px">Every market clears a validation gate to ship as an <b>experiment</b>, then earns <b>proven</b> only once its own live record confirms the edge. Nothing here is a promise.</div>`;
}

function byAssetClassHtml(closed) {
  const rows = byAssetClassStats(closed);
  if (rows.length < 2) return ''; // need at least two classes to compare
  // Callouts ignore 'other' (unknown symbol) and require a real sample.
  const eligible = rows.filter((r) => r.key !== 'other' && r.trades >= ACLASS_MIN);
  const powering = eligible.length && eligible[0].pnl > 0 ? eligible[0].key : null;
  const laggard = eligible.length > 1 && eligible[eligible.length - 1].pnl < 0 ? eligible[eligible.length - 1].key : null;
  const badge = (txt, bg, fg) => `<span style="font:700 9px var(--font-mono);letter-spacing:.05em;padding:2px 6px;border-radius:5px;background:${bg};color:${fg};margin-left:7px;vertical-align:middle;white-space:nowrap">${txt}</span>`;
  return `
    <div class="section-label">Performance by asset class</div>
    <div class="card" style="padding:2px 12px">
      ${rows.map((e) => {
        const decisive = e.wins + e.losses;
        const wr = decisive ? Math.round((e.wins / decisive) * 100) : 0;
        const color = e.pnl >= 0 ? 'var(--buy)' : 'var(--sell)';
        let tag = '';
        if (e.key === powering) tag += badge('LEADING', 'color-mix(in srgb, var(--buy) 20%, transparent)', 'var(--buy)');
        else if (e.key === laggard) tag += badge('LAGGING', 'color-mix(in srgb, var(--sell) 22%, transparent)', 'var(--sell)');
        if (EXPERIMENT_CLASSES.has(e.key)) tag += badge('EXPERIMENTAL', 'var(--neutral-800)', 'var(--text-muted)');
        return `<div class="closed-row">
          <div class="closed-sym"><i class="ph-fill ${ACLASS_ICON[e.key] || 'ph-stack'}" style="font-size:15px;color:var(--accent-300)"></i></div>
          <div class="closed-body">
            <div class="closed-title">${labelForKey(e.key)}${tag}</div>
            <div class="closed-sub">${e.trades} trade${e.trades === 1 ? '' : 's'} · ${wr}% win</div>
          </div>
          <div class="closed-result"><div class="r" style="color:${color}">${money(e.pnl)}</div></div>
        </div>`;
      }).join('')}
    </div>
    <div class="text-faint" style="font-size:10.5px;margin:6px 2px 0">Net P&amp;L per asset class on the live Swing record. "exp" = unproven experiment cell.</div>`;
}

// Smooth cumulative-P&L equity curve, drawn entirely from real closed trades.
function eqSmooth(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function equityChart(equity) {
  const w = 500, h = 132;
  if (!equity || equity.length < 2) return '';
  const min = Math.min(...equity, 0), max = Math.max(...equity, 0);
  const span = (max - min) || 1;
  const pad = span * 0.14;
  const lo = min - pad, hi = max + pad;
  const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
  const step = w / (equity.length - 1);
  const pts = equity.map((v, i) => [i * step, yFor(v)]);
  const d = eqSmooth(pts);
  const last = equity[equity.length - 1];
  const color = last >= 0 ? 'var(--buy)' : 'var(--sell)';
  const zeroY = yFor(0).toFixed(1);
  const uid = 'eq' + Math.random().toString(36).slice(2, 6);
  const end = pts[pts.length - 1];
  return `<svg ${hoverAttrs(equity, null, lo, hi, h, w, 0, 'usd')} viewBox="0 0 ${w} ${h}" width="100%" style="height:auto;display:block">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.24"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="4 4"/>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#${uid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="3" fill="${color}"/>
    ${hoverLayerSvg(w, h)}
  </svg>`;
}

function intro() {
  return `
    <div class="dash-glow"></div>
    <h1 class="h-title">Paper Trading</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 16px">An honest, unedited track record: Ajent auto-trades <b style="color:var(--text)">every</b> signal with virtual money — winners and losers — so you see exactly how they perform. No real funds, no broker, nothing hidden.</p>`;
}

// Sets honest expectations before the numbers. This is a transparency feature,
// not a sales pitch — we deliberately do NOT promise profit.
function honestBanner() {
  return `
  <div class="panel" style="padding:13px 15px;border:1px solid var(--hairline);display:flex;gap:11px;align-items:flex-start;margin-bottom:12px">
    <i class="ph-fill ph-shield-check" style="color:var(--accent-300);font-size:19px;flex:none;margin-top:1px"></i>
    <div class="text-muted" style="font-size:12.5px;line-height:1.6">
      <b style="color:var(--text)">Why we show every result — even the losses.</b>
      Most signal apps hide their misses and advertise fake win rates. We don't. This is the real, complete record of the algorithm.
      Short-term markets are close to random, so an honest strategy realistically aims to <b style="color:var(--text)">protect capital and hover near break-even</b>, not to print money. The engine also keeps learning from every trade. Judge it on the full history below, not any single week.
    </div>
  </div>`;
}

// The evolving Ajent Pulse — surfaces the adaptation transparently (learning state,
// re-tune cadence, per-engine weights) WITHOUT the proprietary recipe dials.
function strategyCard() {
  const s = getStrategy();
  const a = getAdaptive();
  const learning = a ? a.learning : true;
  const nextRt = a && a.nextRetune ? new Date(a.nextRetune).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const note = !a ? 'Gathering the record before it re-tunes.'
    : learning ? `Learning — ${a.trades}/20 pooled trades before it re-tunes.`
    : `Adapting automatically on a weekly cadence (${a.trades} trades, ${a.winRate}% win).${nextRt ? ` Next re-tune ${nextRt}.` : ''}`;
  const eng = a && a.engines;
  const engChips = eng ? ['mr', 'trend'].map((k) => { const e = eng[k]; if (!e) return ''; const lbl = k === 'trend' ? 'Trend' : 'Mean-rev'; return `<span class="sc-dial">${lbl} ${e.learning ? '1.0×' : `${(+e.weight).toFixed(2)}×`}</span>`; }).join('') : '';
  const chips = learning
    ? `<span class="sc-dial learning">${a ? `learning · ${a.trades}/20 trades` : 'learning'}</span>`
    : (engChips || '<span class="sc-dial">adapting</span>');
  return `<div class="panel" style="padding:13px 15px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px">
      <i class="ph-fill ph-seal-check" style="color:var(--accent-300);font-size:18px"></i>
      <b style="font:700 14px var(--font-heading)">${s.name}</b>
      ${s.proven ? '<span style="font-size:9.5px;font-weight:700;color:#0b2b20;background:var(--buy);padding:2px 6px;border-radius:5px">PROVEN</span>' : ''}
      <span style="font-size:9.5px;font-weight:700;color:var(--accent-100);background:var(--accent-800);padding:2px 6px;border-radius:5px">ADAPTIVE</span>
    </div>
    <div class="text-muted" style="font-size:12px;line-height:1.5;margin-top:7px">A proven ensemble of edges — it fades oversold dips and rides established uptrends — applied across every market. It re-tunes on a set cadence (about weekly) from all trades pooled, automatically and within hard safety bounds. ${note}</div>
    <div class="sc-dials">${chips}</div>
  </div>`;
}

// The candidate scoreboard is an INTERNAL tool (Ajent picks the live strategy from it) — only
// shown in debug/internal mode. Users instead get the advertise-the-lab trust callout below.
function isInternal() { try { return isOwner() || new URLSearchParams(location.search).get('debug') === '1' || !!(typeof window !== 'undefined' && window.__ajentDebug); } catch (e) { return false; } }
// User-facing: advertise that Ajent continuously lab-tests — a credibility feature, not the raw
// candidate scoreboard. Honest (it's how Ajent Pulse actually evolves).
function labAdvertHtml() {
  return `<div class="card" style="padding:13px 15px;margin-bottom:12px;display:flex;gap:11px;align-items:flex-start">
    <i class="ph-fill ph-flask" style="color:var(--accent-300);font-size:19px;flex:none;margin-top:1px"></i>
    <div class="text-muted" style="font-size:12.5px;line-height:1.6"><b style="color:var(--text)">Continuously lab-tested.</b> Every change to the strategy is forward-tested on live signals against the alternatives before it ships — validated by its own record, not guessed. New indicators and variants run in the lab until they prove out.</div>
  </div>`;
}

// One scannable metric strip (win / PF / max DD / expectancy) under the equity curve — the
// TradingView strategy-report pattern. Replaces the old 8-card grid; full stats move to a
// "Full statistics" drill-down. `p` is a performance summary.
function metricStrip(p) {
  const pf = p.profitFactor === Infinity ? '∞' : p.profitFactor.toFixed(2);
  // Plain-language labels (no trader jargon like "Max DD"/"Expectancy"); a tap/hover tip
  // gives the precise meaning and the technical term for anyone who wants it.
  const cell = (k, v, col, tip) => `<div class="m" title="${tip}"><div class="mk">${k}</div><div class="mv"${col ? ` style="color:${col}"` : ''}>${v}</div></div>`;
  return `<div class="pf-strip">
    ${cell('Win rate', `${p.winRate}%`, 'var(--buy)', 'How often a trade closes in profit.')}
    ${cell('$ won per $ lost', pf, '', 'For every $1 lost, this many dollars were won (profit factor). Above 1 is profitable.')}
    ${cell('Worst drop', money(p.maxDrawdown), 'var(--sell)', "The account's biggest peak-to-trough dip — how bad it got at its worst (max drawdown).")}
    ${cell('Avg / trade', money(p.expectancy), p.expectancy >= 0 ? 'var(--buy)' : 'var(--sell)', 'Average profit or loss per trade (expectancy).')}
  </div>`;
}

// The live strategy lab — candidate strategies forward-tested on the same signals, each in
// its own shadow record (worker /lab). Renders a placeholder, then wireLab() fills it async.
function labPanel() {
  return `<div class="panel" id="lab-panel" style="padding:14px 16px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
      <i class="ph-fill ph-flask" style="color:var(--accent-300);font-size:17px"></i>
      <b style="font:700 14px var(--font-heading)">Strategy lab</b>
      <span style="font-size:9.5px;font-weight:700;color:var(--flat);background:var(--flat-dim);padding:2px 6px;border-radius:5px">LIVE FORWARD-TEST</span>
    </div>
    <div class="text-muted" style="font-size:11.5px;line-height:1.5;margin-bottom:10px">Candidate strategies paper-trade the <b style="color:var(--text)">same live signals</b> into their own shadow records — the forward record decides which wins before we change anything.</div>
    <div id="lab-body"><div class="text-faint" style="font-size:12px;padding:6px 0">Loading the lab…</div></div>
  </div>`;
}
async function wireLab(container) {
  const body = container.querySelector('#lab-body');
  if (!body) return;
  let lab = await fetchLab();
  if (!lab || !Array.isArray(lab.candidates)) { const p = container.querySelector('#lab-panel'); if (p) p.style.display = 'none'; return; }
  // Mark each candidate's open positions to the client's fresh live prices → a live unrealized
  // read, so the scoreboard is meaningful from day 0 (before any trade closes). Only mark REAL
  // markets (skip placeholder prices). Returns null while no price is available yet.
  const candUnreal = (c) => {
    let u = 0, marked = 0;
    for (const p of (c.positions || [])) {
      const m = state.engine.get(p.symbol); const px = m && m.price;
      if (!m || !m.signalIsReal || !(px > 0) || p.entry == null || !p.risk) continue;
      const r = ((p.side === 'SHORT') ? (p.entry - px) : (px - p.entry)) / Math.abs(p.risk);
      u += r * (p.riskDollars || 250); marked++;
    }
    return { u: Math.round(u), marked };
  };
  const paint = () => {
    const cands = lab.candidates.map((c) => { const q = candUnreal(c); return { ...c, unreal: q.u, marked: q.marked, total: c.net + q.u }; })
      .sort((a, b) => b.total - a.total);
    const rows = cands.map((c, i) => {
      const live = c.key === 'full';
      const col = c.total >= 0 ? 'var(--buy)' : 'var(--sell)';
      const parts = [];
      if (c.open) parts.push(`${c.open} open`);
      if (c.trades) parts.push(`${c.trades} closed · ${c.winRate}% win`);
      if (c.open && c.marked) parts.push(`<span style="color:${c.unreal >= 0 ? 'var(--buy)' : 'var(--sell)'}">${money(c.unreal)} unreal.</span>`);
      const sub = parts.length ? parts.join(' · ') : 'gathering…';
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;${i ? 'border-top:1px solid var(--divider)' : ''}">
        <div style="flex:1;min-width:0">
          <div style="font:600 13px var(--font-heading);display:flex;align-items:center;gap:6px;flex-wrap:wrap">${c.label}${live ? ' <span style="font-size:9px;font-weight:700;color:var(--buy);background:var(--buy-dim);padding:1px 5px;border-radius:4px">LIVE NOW</span>' : ''}</div>
          <div class="text-muted" style="font-size:11px;margin-top:1px">${sub}</div>
        </div>
        <div style="text-align:right;flex:none;font:800 15px var(--font-heading);color:${col}">${money(c.total)}</div>
      </div>`;
    }).join('');
    const started = lab.startedAt ? new Date(lab.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    body.innerHTML = rows + `<div class="text-faint" style="font-size:10.5px;line-height:1.5;margin-top:10px;border-top:1px solid var(--divider);padding-top:8px">Started ${started}${lab.days != null ? ` · ${lab.days}d` : ''} · total = closed + <b style="color:var(--text-muted)">unrealized</b> (live, moves with price) · hypothetical, virtual money. <b style="color:var(--text-muted)">Full ensemble</b> is the config trading live now; <b style="color:var(--text-muted)">MR-only</b> is the calmer, higher-win alternative.</div>`;
  };
  paint();
  // Keep it live: repaint unrealized from fresh prices every ~8s (also catches the initial
  // price-load race), and re-fetch /lab every ~32s for updated positions/closes. Self-clears
  // when the user navigates away (the panel leaves the DOM).
  let n = 0;
  const iv = setInterval(async () => {
    if (!container.querySelector('#lab-panel')) { clearInterval(iv); return; }
    if (++n % 4 === 0) { const r = await fetchLab(); if (r && Array.isArray(r.candidates)) lab = r; }
    paint();
  }, 8000);
}

// The backtested edge — collapsed by default so it never crowds the live record, which
// stays the headline. Fills the one gap vs honest peers (TradingView/Danelfin/Composer):
// we were hiding a genuinely strong, validated backtest behind a tiny live sample. Figures
// are conservative, scoped, and carry the standard hypothetical disclaimer; no recipe values.
function backtestEdge() {
  return `
  <details class="panel" style="padding:14px 16px;margin-bottom:12px">
    <summary style="cursor:pointer;font:600 14px var(--font-heading);display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>The backtested edge <span style="font-size:10px;font-weight:700;color:var(--flat);background:var(--flat-dim);padding:2px 6px;border-radius:5px;vertical-align:middle">HYPOTHETICAL</span></span>
      <i class="ph ph-caret-down" style="color:var(--text-muted);flex:none"></i>
    </summary>
    <div class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:10px">
      Across <b style="color:var(--text)">~25 global markets over about a decade</b> of daily data — net of estimated trading costs — the mean-reversion core has shown a <b style="color:var(--text)">win rate near 75%</b> with modest drawdowns; a second, independent trend-following edge is layered on top. Each setting was checked out-of-sample and across markets, not fitted to one lucky window.
      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;font:700 10px var(--font-heading);color:var(--text-muted);margin-bottom:6px;font-variant-numeric:tabular-nums"><span>PF 1.0</span><span style="color:var(--accent-200)">likely 2.5–3.5</span><span>PF 5.0</span></div>
        <div style="position:relative;height:11px;border-radius:6px;background:color-mix(in srgb,var(--text-muted) 20%,transparent)">
          <div style="position:absolute;top:0;bottom:0;left:37.5%;right:37.5%;background:linear-gradient(90deg,var(--accent-800),var(--accent));opacity:.6;border-radius:6px"></div>
          <div style="position:absolute;top:-2px;left:50%;width:3px;height:15px;border-radius:2px;background:var(--accent-100)"></div>
        </div>
        <div class="text-faint" style="font-size:10px;margin-top:5px">A range, not a single figure — where the backtested profit factor typically landed. PF &gt; 1 = profitable.</div>
      </div>
      <div style="margin-top:16px">
        <div style="font:600 12.5px var(--font-heading);color:var(--text)">Edge by setup depth</div>
        <div style="font-size:11.5px;margin-top:4px;line-height:1.55">The deeper the dip the engine buys, the more it earns per trade — a real gradient across every tier, not one hero number. That the ranking holds is itself the proof the edge is real.</div>
        <div style="margin-top:11px;display:flex;flex-direction:column;gap:8px">
          <div style="display:grid;grid-template-columns:88px 1fr 38px;gap:9px;font:700 9px var(--font-heading);color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em"><span>Setup depth</span><span>Avg profit / trade</span><span style="text-align:right">Win</span></div>
          ${[
            { d: 'Deepest dip', v: 95, w: 100, o: 1, win: '74%' },
            { d: 'Deep', v: 92, w: 98, o: 0.8, win: '76%' },
            { d: 'Moderate', v: 64, w: 68, o: 0.62, win: '74%' },
            { d: 'Shallowest', v: 63, w: 67, o: 0.48, win: '76%' },
          ].map((t) => `<div style="display:grid;grid-template-columns:88px 1fr 38px;gap:9px;align-items:center">
            <span style="font-size:11.5px;color:var(--text)">${t.d}</span>
            <span style="display:flex;align-items:center;gap:7px"><span style="height:15px;width:${t.w}%;background:var(--buy);opacity:${t.o};border-radius:3px"></span><span style="font:700 11.5px var(--font-heading);color:var(--buy);white-space:nowrap">$${t.v}</span></span>
            <span style="text-align:right;font-size:11px;color:var(--text-muted)">${t.win}</span>
          </div>`).join('')}
        </div>
        <div class="text-faint" style="font-size:10.5px;margin-top:9px;line-height:1.5">Win rate stays ~75% across every tier — it's the <b style="color:var(--text-muted)">size</b> of the edge that scales with depth, not the odds. Equity dip-buyer, 8 index markets · ~2 years of daily data · 84 backtested trades.</div>
      </div>
      <div style="margin-top:12px">
        <b style="color:var(--text)">vs. buying and holding</b> the same markets, the edge isn't bigger raw returns — it's <b style="color:var(--text)">capital preservation</b>: by sitting in cash most of the time and stepping in only on genuine extremes, it held drawdowns to a fraction of the index's own, which can fall 25–35% in a crash.
      </div>
      <div style="font-size:11px;line-height:1.55;margin-top:10px;padding:9px 11px;background:var(--flat-dim);border-radius:8px;color:var(--text-faint)">
        Hypothetical results have inherent limitations: they benefit from hindsight and do not represent real trading. No representation is made that any account will achieve similar results.
      </div>
      <div style="margin-top:10px">
        <b style="color:var(--text)">The live record above is the real judge.</b> It starts at zero, books every loss, and is timestamped trade-by-trade — nothing edited or cherry-picked. If another app advertises 90% win rates or triple-digit returns, be skeptical; ours are deliberately modest and real.
      </div>
    </div>
  </details>`;
}

// User-facing explainer of how the dollar P&L is computed — especially for
// non-US markets quoted in other currencies. Native <details> = no JS wiring.
function pnlHelp() {
  return `
  <details class="panel" style="padding:14px 16px">
    <summary style="cursor:pointer;font:600 14px var(--font-heading);display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>How is profit &amp; loss calculated?</span>
      <i class="ph ph-caret-down" style="color:var(--text-muted);flex:none"></i>
    </summary>
    <div class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:10px">
      Every paper trade risks the <b style="color:var(--text)">same amount</b> — your account size × your risk-per-trade % (both set in Settings). A win adds your reward-to-risk ratio times that stake; a loss subtracts the stake. So a $250 stake at 2:1 makes <span style="color:var(--buy)">+$500</span> on a win or <span style="color:var(--sell)">−$250</span> on a loss.
      <br><br>
      Because the result is measured in <b style="color:var(--text)">your account currency</b>, it works identically for every market — including non-US futures and indexes quoted in euros, yen, pounds or any other currency. <b style="color:var(--text)">No currency conversion is needed:</b> Ajent tracks the dollars you put at risk, not the instrument's local-currency ticks.
    </div>
  </details>`;
}

// Live unrealized mark-to-market for an open position, in R and dollars, using the
// market's current price and the same maths the closed record uses.
function posLivePnl(p) {
  const m = state.engine.get(p.symbol);
  const px = m && m.price;
  const riskPer = Math.abs(p.risk || (p.entry != null && p.stop != null ? p.entry - p.stop : 0));
  // Mark to market only against a REAL price — a placeholder catalog price before the feed
  // loads would show a wildly wrong unrealized figure. Skip until real data arrives.
  if (!m || !m.signalIsReal || !(px > 0) || p.entry == null || !riskPer) return null;
  const long = (p.side || 'LONG') === 'LONG';
  const r = (long ? (px - p.entry) : (p.entry - px)) / riskPer;
  return { r, dollars: r * (p.riskDollars || 250), px };
}

// A thin risk bar: stop (−1R, left) · entry (0, centre) · target (+1R, right),
// with a marker at the live price and the entry→price move filled in.
function riskBar(r) {
  const pos = Math.max(2, Math.min(98, ((Math.max(-1, Math.min(1, r)) + 1) / 2) * 100));
  const from = Math.min(pos, 50), w = Math.abs(pos - 50);
  const col = r >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `<div style="position:relative;height:6px;background:var(--neutral-900);border-radius:3px;margin-top:8px">
      <div style="position:absolute;left:50%;top:-1px;bottom:-1px;width:1px;background:var(--text-faint);opacity:.6"></div>
      <div style="position:absolute;left:${from}%;width:${w}%;top:0;bottom:0;background:${col};opacity:.85;border-radius:3px"></div>
      <div style="position:absolute;left:calc(${pos}% - 1.5px);top:-2px;bottom:-2px;width:3px;border-radius:2px;background:${col}"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:9.5px;margin-top:3px;color:var(--text-faint)"><span style="color:var(--sell)">Stop</span><span>Entry</span><span style="color:var(--buy)">Target</span></div>`;
}

function openRow(p) {
  const market = state.engine.get(p.symbol);
  const pnl = posLivePnl(p);
  const dec = market?.decimals ?? p.decimals ?? 2;
  const col = pnl ? (pnl.dollars >= 0 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-muted)';
  const pnlStr = pnl ? `${money(pnl.dollars)}${exitProgressText(p, pnl.px) ? ` · ${exitProgressText(p, pnl.px)}` : ''}` : 'live…';
  const k = posDomKey(p); // unique per position (a market may hold both an MR and a trend slot)
  return `<div class="closed-row" data-open-row="${k}" data-nav="#/chart/${p.symbol}" style="cursor:pointer;display:block;padding:11px 4px">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="closed-sym">${p.symbol}</div>
        <div class="closed-body" style="flex:1;min-width:0">
          <div class="closed-title" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">${(p.side || 'LONG') === 'LONG' ? 'Long' : 'Short'} · ${p.name} ${positionCallPill(market, p)}</div>
          <div class="closed-sub">Entry ${fmtPrice(p.entry, dec)} · stop ${fmtPrice(p.stop, dec)} · target ${fmtPrice(p.target1, dec)}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div class="tabular" data-open-pnl="${k}" style="color:${col};font-weight:700;font-size:13.5px">${pnlStr}</div>
          <div class="text-muted" style="font-size:10px;margin-top:1px">unrealized</div>
        </div>
      </div>
      <div data-open-bar="${k}">${pnl ? riskBar(pnl.r) : ''}</div>
    </div>`;
}

function openSig() {
  return getOpenPositions().map((p) => { const q = posLivePnl(p); return `${p.symbol}:${q ? q.r.toFixed(3) : '?'}`; }).join(',');
}

// Broad co-movement bucket for a held symbol. Equity indices and sector ETFs are all
// "equity beta" — they largely rise and fall together — so they count as ONE bet, not
// many. Crypto is its own (correlated) bucket. Used only to tell the honest truth about
// concentration; it changes no trading logic.
function corrGroup(symbol) {
  const m = state.engine.get(symbol);
  const cat = m && m.category;
  if (cat === 'Index' || cat === 'Global Index' || cat === 'Sector ETFs') return 'equity';
  if (cat === 'Crypto') return 'crypto';
  return 'other';
}

// When the open book is dominated by one correlated group, say so — otherwise "10 open
// trades" reads as 10 independent edges when it's really one directional bet. Honest
// context for reading the record, not advice.
function concentrationNote(open) {
  if (open.length < 3) return ''; // 1-2 positions: not worth a caveat
  const counts = {};
  for (const p of open) { const g = corrGroup(p.symbol); counts[g] = (counts[g] || 0) + 1; }
  const equity = counts.equity || 0;
  if (equity >= 3 && equity / open.length >= 0.6) {
    const label = equity === open.length ? `All ${open.length}` : `${equity} of ${open.length}`;
    return `<div class="conc-note"><i class="ph-fill ph-warning-circle"></i><span>${label} open trades are <b>equity-market longs</b> — stocks worldwide move largely together, so the record's swing here reflects <b>one broad direction</b> (stocks up or down), not ${open.length} independent bets. Judge the edge over the full history, not a single correlated stretch.</span></div>`;
  }
  return '';
}

function openList() {
  const open = getOpenPositions();
  if (!open.length) return '';
  return `
    <div class="section-label">Open positions · ${open.length}</div>
    ${concentrationNote(open)}
    <div class="card" style="padding:2px 12px">
      ${open.map(openRow).join('')}
    </div>`;
}

// Markets nearest a setup, ranked by proximity (used by both the render and the
// live-patch signature so the empty state can update once data arrives).
function watchMarkets() {
  const threshold = state.settings.threshold;
  const held = new Set(getOpenPositions().map((p) => p.symbol));
  return state.engine.markets
    .filter((m) => m.signalIsReal && m.signal && (m.signal.proximity || 0) > 0 && m.verdict(threshold) === 'NO_TRADE' && !held.has(m.symbol))
    .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0))
    .slice(0, 5);
}
function watchSig() { return watchMarkets().map((m) => `${m.symbol}:${m.signal.proximity}:${m.signal.htfTrend}`).join(','); }

// What's nearest to triggering a trade, by the server's proximity score — so an
// empty record still tells you what to watch. Not signals, just "closest".
function watchingList() {
  const markets = watchMarkets();
  if (!markets.length) return '';
  return `
    <div class="section-label">Closest to a setup</div>
    <div class="card" style="padding:2px 12px">
      ${markets.map((m) => {
        const prox = Math.max(0, Math.min(100, m.signal.proximity || 0));
        const up = m.signal.htfTrend === 'up';
        // Recipe-free: proximity (how close to firing), never the RSI reading or threshold.
        const trig = up ? `${prox}% of the way to a setup`
          : m.signal.htfTrend === 'down' ? 'Downtrend — no long setup'
          : 'No clear trend';
        return `<div class="closed-row" data-nav="#/signal/${m.symbol}" style="cursor:pointer">
          <div class="closed-sym">${m.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${m.name}</div>
            <div class="closed-sub">${trig}</div>
          </div>
          <div class="closed-result"><div class="r" style="color:var(--text-muted)">${prox}%</div><div class="o">to setup</div></div>
        </div>`;
      }).join('')}
    </div>`;
}

function emptyState() {
  const open = getOpenPositions();
  return `
  <div class="fade-in glow-wrap">
    ${intro()}
    ${honestBanner()}
    <div class="panel" style="text-align:center;padding:32px 20px">
      <i class="ph ph-chart-line-up" style="font-size:32px;color:var(--text-muted)"></i>
      <div style="font:600 15px var(--font-heading);margin-top:14px">No completed trades yet</div>
      <p class="text-muted" style="font-size:13px;line-height:1.6;margin-top:8px;max-width:40ch;margin-left:auto;margin-right:auto">
        A virtual trade opens automatically whenever a real signal clears your confidence threshold, then runs until it hits its target or stop.
        ${open.length ? `${open.length} ${open.length === 1 ? 'trade is' : 'trades are'} open right now — results will appear here once they close.` : 'The strategy is in cash right now — that’s normal ~90% of the time.'}
      </p>
    </div>
    ${backtestEdge()}
    <div id="watch-wrap" data-sig="${watchSig()}">${watchingList()}</div>
    <div id="open-wrap" data-sig="${openSig()}">${openList()}</div>
    ${marketSelector()}
    ${pnlHelp()}
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">Educational only · past results don't guarantee future performance.</p>
  </div>`;
}

// Export the real closed-trade record as CSV — the user's own data, for their
// own analysis in a spreadsheet. Nothing fabricated: every row is a real paper
// trade. Runs entirely in the browser (a Blob download; no upload anywhere).
function tradesToCsv(trades) {
  const cols = ['Symbol', 'Name', 'Side', 'Entry', 'Exit', 'Result_R', 'PnL_net_$', 'Cost_$', 'Risk_$', 'Outcome', 'Exit_reason', 'Opened_at', 'Closed_at'];
  const iso = (t) => (t ? new Date(t).toISOString() : '');
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = trades.map((c) => [
    c.symbol, c.name || '', c.side || '', c.entry ?? '', c.exit ?? '',
    c.resultR ?? '', tradePnl(c), c.cost ?? '', c.riskDollars ?? '',
    c.outcome || '', c.exitReason || '', iso(c.openedAt), iso(c.closedAt),
  ].map(esc).join(','));
  return [cols.join(','), ...rows].join('\r\n');
}
function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM → Excel reads UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

// Overlaid cumulative-P&L curves — your combined virtual results vs Ajent's, both
// plotted over real time from a common zero, so you literally watch the two lines
// diverge over the same window.
function dualEquityChart(ajClosed, youClosed) {
  const series = (closed) => {
    const s = closed.slice().filter((t) => t.closedAt).sort((a, b) => a.closedAt - b.closedAt);
    let eq = 0; return s.map((t) => { eq += (t.pnl || 0); return { t: t.closedAt, v: eq }; });
  };
  const aj = series(ajClosed), you = series(youClosed);
  if (aj.length < 2 && you.length < 2) return '';
  const all = aj.concat(you);
  const tMin = Math.min(...all.map((p) => p.t)), tMaxRaw = Math.max(...all.map((p) => p.t));
  const tMax = tMaxRaw > tMin ? tMaxRaw : tMin + 1;
  const vMax = Math.max(0, ...all.map((p) => p.v)), vMin = Math.min(0, ...all.map((p) => p.v));
  const w = 280, h = 92, pad = 6, span = tMax - tMin, vspan = (vMax - vMin) || 1;
  const x = (t) => pad + ((t - tMin) / span) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - vMin) / vspan) * (h - 2 * pad);
  const path = (pts, color, dash) => pts.length ? `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash ? ' stroke-dasharray="4 4"' : ''}/>${pts.length ? `<circle cx="${x(pts[pts.length - 1].t).toFixed(1)}" cy="${y(pts[pts.length - 1].v).toFixed(1)}" r="2.6" fill="${color}"/>` : ''}` : '';
  const youFinal = you.length ? you[you.length - 1].v : 0;
  const youColor = youFinal >= 0 ? 'var(--buy)' : 'var(--sell)';
  const enc = (o) => encodeURIComponent(JSON.stringify(o));
  return `<div class="yva-chart"><svg class="yva-svg" viewBox="0 0 ${w} ${h}" width="100%" style="height:auto;display:block"
      data-aj="${enc(aj)}" data-you="${enc(you)}" data-tmin="${tMin}" data-tmax="${tMax}" data-vmin="${vMin}" data-vmax="${vMax}" data-w="${w}" data-h="${h}" data-pad="${pad}" data-youcolor="${youFinal >= 0 ? 'buy' : 'sell'}">
    <line x1="${pad}" y1="${y(0).toFixed(1)}" x2="${w - pad}" y2="${y(0).toFixed(1)}" stroke="var(--hairline)" stroke-dasharray="3 4"/>
    ${path(aj, 'var(--accent)')}
    ${path(you, youColor)}
    <rect class="dv-hit" x="0" y="0" width="${w}" height="${h}" fill="transparent" style="cursor:crosshair"/>
    <g class="dv" style="display:none;pointer-events:none">
      <line class="dv-x" y1="${pad}" y2="${h - pad}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>
      <circle class="dv-aj" r="3" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5"/>
      <circle class="dv-you" r="3" fill="${youColor}" stroke="var(--bg)" stroke-width="1.5"/>
      <g class="dv-tip"><rect class="dv-bg" rx="4" height="15" fill="var(--surface-2)" stroke="var(--hairline)"/><text class="dv-tx" font-size="8.5" font-weight="700" dominant-baseline="middle" font-family="var(--font-mono)"></text></g>
    </g>
  </svg>
  <div class="yva-legend"><span><i style="background:var(--accent)"></i>Ajent</span><span><i style="background:${youColor}"></i>You</span></div></div>`;
}

// Bespoke hover for the dual (time-based, two-series) equity chart: a crosshair with a
// dot on each line and a tip showing both P&Ls at the hovered time. Equity is a step
// function between trades, so each series' value = the last point at or before the time.
function wireDualHover(container) {
  (container || document).querySelectorAll('svg.yva-svg').forEach((svg) => {
    if (svg.dataset.dvWired) return;
    svg.dataset.dvWired = '1';
    let aj = [], you = [];
    try { aj = JSON.parse(decodeURIComponent(svg.dataset.aj || '[]')); } catch (e) { /* ignore */ }
    try { you = JSON.parse(decodeURIComponent(svg.dataset.you || '[]')); } catch (e) { /* ignore */ }
    const tMin = +svg.dataset.tmin, tMax = +svg.dataset.tmax, vMin = +svg.dataset.vmin, vMax = +svg.dataset.vmax;
    const w = +svg.dataset.w, h = +svg.dataset.h, pad = +svg.dataset.pad;
    const span = (tMax - tMin) || 1, vspan = (vMax - vMin) || 1;
    const yFor = (v) => pad + (1 - (v - vMin) / vspan) * (h - 2 * pad);
    const g = svg.querySelector('.dv'), lineEl = svg.querySelector('.dv-x'), dAj = svg.querySelector('.dv-aj'), dYou = svg.querySelector('.dv-you');
    const bg = svg.querySelector('.dv-bg'), tx = svg.querySelector('.dv-tx');
    if (!g) return;
    const valAt = (arr, t) => { let v = null; for (const p of arr) { if (p.t <= t) v = p.v; else break; } return v; };
    const usd = (n) => `${n >= 0 ? '+$' : '−$'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
    const move = (clientX) => {
      const rect = svg.getBoundingClientRect(); if (!rect.width) return;
      const xvb = (clientX - rect.left) / rect.width * w;
      const t = tMin + Math.max(0, Math.min(1, (xvb - pad) / (w - 2 * pad))) * span;
      const av = valAt(aj, t), yv = valAt(you, t);
      lineEl.setAttribute('x1', xvb.toFixed(1)); lineEl.setAttribute('x2', xvb.toFixed(1));
      if (av != null) { dAj.style.display = ''; dAj.setAttribute('cx', xvb.toFixed(1)); dAj.setAttribute('cy', yFor(av).toFixed(1)); } else dAj.style.display = 'none';
      if (yv != null) { dYou.style.display = ''; dYou.setAttribute('cx', xvb.toFixed(1)); dYou.setAttribute('cy', yFor(yv).toFixed(1)); } else dYou.style.display = 'none';
      const parts = [];
      if (av != null) parts.push(`Ajent ${usd(av)}`);
      if (yv != null) parts.push(`You ${usd(yv)}`);
      const label = parts.join('  ·  ') || '—';
      tx.textContent = label;
      const tw = label.length * 5.1 + 12;
      const tipX = Math.max(2, Math.min(w - tw - 2, xvb - tw / 2));
      bg.setAttribute('x', tipX.toFixed(1)); bg.setAttribute('y', '1'); bg.setAttribute('width', tw.toFixed(1));
      tx.setAttribute('x', (tipX + 6).toFixed(1)); tx.setAttribute('y', '9'); tx.setAttribute('fill', 'var(--text)');
      g.style.display = '';
    };
    const hide = () => { g.style.display = 'none'; };
    svg.addEventListener('mousemove', (e) => move(e.clientX));
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchstart', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchend', hide);
  });
}

// Your OWN open trades (manual book + auto strategy) in one place, with live
// unrealized P&L. Manual ones can be closed at market; strategy ones run on their rules.
function yourOpenTradesHtml() {
  const manual = Object.values(getUserBook().open).map((p) => ({ ...p, src: 'manual' }));
  const auto = Object.values(getCustomBook().open).map((p) => ({ ...p, src: 'strategy' }));
  const all = manual.concat(auto);
  if (!all.length) return '';
  const unreal = (p, price) => {
    const long = p.side !== 'SHORT';
    const r = (long ? (price - p.entry) : (p.entry - price)) / (p.risk || Math.abs(p.entry - p.stop) || 1e-9);
    return Math.round(r * p.riskDollars);
  };
  const rows = all.map((p) => {
    const m = state.engine.get(p.symbol);
    // Only compute unrealized against a REAL live price — before data loads a stale
    // SIM price would show a garbage number.
    const priceReal = !!(m && m.signalIsReal && m.price > 0);
    const pending = p.status === 'pending';
    // Pending (working) order: no unrealized P&L yet — show how far price is from the entry.
    let metricHtml;
    if (pending) {
      // How far the market must move to reach your entry — labelled with direction so it
      // reads as a fill distance, not a loss/risk figure.
      const diff = priceReal ? (p.entry - m.price) / m.price * 100 : null;
      metricHtml = diff == null
        ? '<div class="uot-un" style="color:var(--text-muted);font-size:10.5px">waiting</div>'
        : `<div class="uot-un" style="color:var(--text-muted);font-size:10.5px">${Math.abs(diff).toFixed(1)}% ${diff < 0 ? 'below' : 'above'}</div>`;
    } else {
      const un = priceReal ? unreal(p, m.price) : null;
      metricHtml = un == null
        ? '<span class="uot-un" style="color:var(--text-faint)">…</span>'
        : `<div class="uot-un" style="color:${un >= 0 ? 'var(--buy)' : 'var(--sell)'}">${un >= 0 ? '+$' : '−$'}${Math.abs(un).toLocaleString('en-US')}</div>`;
    }
    const tag = pending ? '<span class="uot-src working">WORKING</span>'
      : p.src === 'manual' ? '<span class="uot-src manual">YOUR TRADE</span>' : '<span class="uot-src strategy">STRATEGY</span>';
    const lvls = pending
      ? `Fills @ ${fmtPrice(p.entry, p.decimals)} · SL ${fmtPrice(p.stop, p.decimals)}${p.target ? ` · TP ${fmtPrice(p.target, p.decimals)}` : ''}`
      : `${fmtPrice(p.entry, p.decimals)} · SL ${fmtPrice(p.stop, p.decimals)}${p.target ? ` · TP ${fmtPrice(p.target, p.decimals)}` : ''}`;
    const btn = p.src === 'manual'
      ? `<button class="uot-close" data-uot-close="${p.symbol}">${pending ? 'Cancel' : 'Close'}</button>`
      : `<button class="uot-close" data-uot-close-strat="${p.symbol}">Close</button>`;
    return `<div class="uot-row">
      <div class="uot-main"><span class="uot-sym">${p.symbol}</span>${tag}</div>
      <div class="uot-lvls">${lvls}</div>
      ${metricHtml}
      ${btn}
    </div>`;
  }).join('');
  const nPending = manual.filter((p) => p.status === 'pending').length;
  const title = nPending ? `Your open trades · ${all.length - nPending} <span class="text-muted" style="font-weight:400">· ${nPending} working</span>` : `Your open trades · ${all.length}`;
  // Close-all controls: one for working orders, one for strategy positions (each records
  // the outcome at the live price — closing never hides a trade from the record).
  const closeAllBtns = [
    nPending > 1 ? '<button class="uot-closeall" data-uot-cancelall>Cancel all working</button>' : '',
    auto.length > 1 ? `<button class="uot-closeall" data-uot-closeallstrat>Close all ${auto.length} strategy</button>` : '',
  ].filter(Boolean).join('');
  return `<div class="panel"><div class="panel-title">${title}</div>${rows}${closeAllBtns ? `<div class="uot-closeall-row">${closeAllBtns}</div>` : ''}<div class="text-faint" style="font-size:10px;margin-top:8px">Virtual money · closes at the live price. Working orders fill when price reaches your entry. Strategy trades run on their own rules.</div></div>`;
}

// "You vs Ajent" on the record's home — the user's own book + strategy scored
// against Ajent by expectancy (the scale-fair metric). Selection stays your own,
// so net $ is secondary; avg R/trade is the headline.
// Personal risk-limit status for YOUR book (only when a limit is set in Settings).
function riskMeterHtml() {
  const s = riskLimitsStatus();
  if (!s.active) return '';
  const rmoney = (n) => fmtMoneyCcy(n, { sign: false }); // risk amounts are not P&L — no +/- sign
  const row = (label, valTxt, pct, breached, sub) => {
    const col = breached ? 'var(--sell)' : pct >= 80 ? 'var(--flat)' : 'var(--buy)';
    return `<div style="margin:10px 0 2px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px">
        <span style="color:var(--text-muted)">${label}</span>
        <span style="font-weight:700;color:${col};font-variant-numeric:tabular-nums">${valTxt}</span>
      </div>
      <div class="setup-conf-bar" style="margin-top:6px"><span style="width:${Math.min(100, Math.max(2, pct))}%;background:${col}"></span></div>
      <div class="setting-help" style="margin-top:5px">${sub}</div>
    </div>`;
  };
  const parts = [];
  if (s.cap > 0) {
    const pct = s.cap ? Math.round((s.openRisk / s.cap) * 100) : 0;
    parts.push(row(`Portfolio risk · cap ${s.capPct}%`, `${rmoney(s.openRisk)} / ${rmoney(s.cap)}`, pct,
      s.portfolioBreached, s.portfolioBreached ? 'At the cap — new copied trades are paused until an open one closes.' : `${rmoney(Math.max(0, s.cap - s.openRisk))} of room left before new trades pause.`));
  }
  if (s.ddLimit > 0) {
    const pct = s.ddLimit ? Math.round((Math.abs(s.ddPct) / s.ddLimit) * 100) : 0;
    parts.push(row(`Drawdown · limit ${s.ddLimit}%`, `${Math.abs(s.ddPct).toFixed(1)}% / ${s.ddLimit}%`, pct,
      s.drawdownBreached, s.drawdownBreached ? 'Limit reached — new copied trades paused until your book recovers.' : `Your book is ${s.ddPct === 0 ? 'at its peak' : Math.abs(s.ddPct).toFixed(1) + '% off peak'}.`));
  }
  const anyBreach = s.portfolioBreached || s.drawdownBreached;
  return `
    <div class="card" style="padding:14px 16px;${anyBreach ? 'border:1px solid color-mix(in srgb, var(--sell) 45%, var(--hairline))' : ''}">
      <div style="display:flex;align-items:center;gap:8px">
        <i class="ph-bold ${anyBreach ? 'ph-hand-palm' : 'ph-shield-check'}" style="color:${anyBreach ? 'var(--sell)' : 'var(--buy)'};font-size:17px"></i>
        <div style="font:700 13.5px var(--font-heading)">Your risk limits ${anyBreach ? '· <span style="color:var(--sell)">paused</span>' : '· <span style="color:var(--buy)">within limits</span>'}</div>
      </div>
      ${parts.join('')}
      <div class="setting-help" style="margin-top:8px;opacity:.85">Applies only to your own book — Ajent's shared record keeps trading every signal. Edit in Settings → Risk limits.</div>
    </div>`;
}

function youVsAjentCard(perf, ajTradeCount) {
  const you = userStats();
  const cs = customStats();
  if (!(you.trades || you.open || cs.trades || cs.open)) {
    return `<div class="panel">
      <div class="panel-title" style="display:flex;align-items:center;gap:8px"><i class="ph-fill ph-scales" style="color:var(--accent)"></i>You vs Ajent</div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.55;padding:2px 0 10px">Go head-to-head with Ajent on a live record, scored by <b style="color:var(--text)">avg R per trade</b> (fair at any scale). Two ways in — take a live signal your own way, or build your own strategy.</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <a href="#/markets" class="ub-strat-link" style="margin-top:0;background:color-mix(in srgb,var(--accent) 14%,transparent)"><i class="ph-bold ph-crosshair"></i>Take a live signal your way <i class="ph-bold ph-caret-right"></i></a>
        <a href="#/mystrategy" class="ub-strat-link" style="margin-top:0"><i class="ph-bold ph-wrench"></i>Build your own strategy <i class="ph-bold ph-caret-right"></i></a>
      </div>
    </div>`;
  }
  const ajR = ajentAvgR(getClosedTrades());
  const rr = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v}R`);
  const col = (who, avgR, net, sub) => `<div class="vs-col"><div class="vs-who">${who}</div><div class="vs-exp" style="color:${(avgR || 0) >= 0 ? 'var(--buy)' : 'var(--sell)'}">${rr(avgR)}<span class="vs-exp-l">avg/trade</span></div><div class="vs-sub">${money(net)} · ${sub}</div></div>`;
  const cols = [col('AJENT', ajR, perf.totalPnl, `${perf.winRate}% · ${ajTradeCount}T`)];
  if (you.trades || you.open) cols.push(col('YOUR TRADES', you.avgR, you.net, `${you.winRate}% · ${you.trades}T`));
  if (cs.trades || cs.open) cols.push(col('YOUR STRATEGY', cs.avgR, cs.net, `${cs.winRate}% · ${cs.trades}T`));
  const grid = cols.length === 2
    ? `<div class="vs-grid">${cols[0]}<div class="vs-mid">vs</div>${cols[1]}</div>`
    : `<div class="yva-3">${cols.join('')}</div>`;
  const youClosed = getUserBook().closed.concat(getCustomBook().closed);
  const chart = dualEquityChart(getClosedTrades(), youClosed);
  return `<div class="panel">
    <div class="panel-title" style="display:flex;align-items:center;gap:8px"><i class="ph-fill ph-scales" style="color:var(--accent)"></i>You vs Ajent<button class="share-btn" id="yva-share" aria-label="Share your result" title="Share your result" style="margin-left:auto"><i class="ph-bold ph-share-network"></i></button></div>
    ${grid}
    ${chart}
    <div class="fair-note"><b>Avg R/trade is the fair read</b> — count- and size-independent, so it's true even at a small account. Net $ just reflects how many trades each took. <a href="#/mystrategy" style="color:var(--accent-300)">Tune your strategy ›</a></div>
  </div>`;
}

const BOARD_FOCUS = new Set(['index', 'etf', 'fx', 'futures', 'crypto']);
function focusClosedTrades() {
  const f = state.focusClass;
  if (!BOARD_FOCUS.has(f)) return getClosedTrades(); // all (stocks/day have own panels)
  return getClosedTrades().filter((c) => groupForSymbol(c.symbol) === f);
}

export function render(container) {
  const allPerf = getPerformanceSummary();
  if (!allPerf) { container.innerHTML = emptyState(); wireSelector(container); return; }

  const closed = getClosedTrades();            // all — the per-class breakdown uses this
  const focused = focusClosedTrades();         // scoped to the focus class — the hero uses this
  const scopedPerf = getPerformanceSummary(focused); // null if the class has no trades yet
  const perf = scopedPerf || allPerf;          // secondary stats/charts fall back to the full record
  const focusLabel = BOARD_FOCUS.has(state.focusClass) ? (labelForKey(state.focusClass) || null) : null;
  renderedClosedCount = closed.length;
  const heroPnl = scopedPerf ? scopedPerf.totalPnl : 0;
  const pnlColor = heroPnl >= 0 ? 'var(--buy)' : 'var(--sell)';
  const up = heroPnl >= 0;
  const pfStr = scopedPerf ? (scopedPerf.profitFactor === Infinity ? '∞' : scopedPerf.profitFactor.toFixed(2)) : '—';

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="paper-split">
    <div class="paper-summary">
    ${intro()}

    <div class="pf-hero ${up ? 'up' : 'down'}">
      <div class="pf-hero-label">Net virtual P&amp;L${focusLabel ? ` · <span style="color:var(--accent-200)">${focusLabel}</span>` : ''} · ${focused.length} trade${focused.length === 1 ? '' : 's'}</div>
      <div class="pf-hero-value" style="color:${pnlColor}">${scopedPerf ? money(scopedPerf.totalPnl) : '$0'}</div>
      <div class="pf-hero-meta">${scopedPerf ? `net on virtual money · ${scopedPerf.wins}W / ${scopedPerf.losses}L` : `No ${focusLabel || ''} trades on the record yet — the full breakdown is below.`}</div>
      ${scopedPerf && focused.length >= 2 ? `<div class="pf-hero-chart">${equityChart(scopedPerf.equity)}</div>` : ''}
      ${scopedPerf ? metricStrip(scopedPerf) : ''}
    </div>
    </div><!-- /paper-summary -->
    <div class="paper-detail">

    ${honestBanner()}

    ${strategyCard()}

    ${labAdvertHtml()}

    ${backtestEdge()}

    ${youVsAjentCard(perf, closed.length)}

    ${yourOpenTradesHtml()}

    ${riskMeterHtml()}

    <details class="panel" style="padding:12px 16px">
      <summary style="cursor:pointer;font:600 13.5px var(--font-heading);display:flex;align-items:center;justify-content:space-between;gap:10px"><span>Full statistics</span><i class="ph ph-caret-down" style="color:var(--text-muted);flex:none"></i></summary>
      <div class="stat2-grid" style="margin-top:12px">
        <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value" style="color:var(--buy)">${perf.winRate}%</div><div class="stat-sub">${perf.wins}W / ${perf.losses}L</div></div>
        <div class="stat-card"><div class="stat-label">Avg win</div><div class="stat-value" style="color:var(--buy)">${money(perf.avgWin)}</div><div class="stat-sub">per winning trade</div></div>
        <div class="stat-card"><div class="stat-label">Avg loss</div><div class="stat-value" style="color:var(--sell)">${money(-perf.avgLoss)}</div><div class="stat-sub">per losing trade</div></div>
        <div class="stat-card"><div class="stat-label">Avg hold</div><div class="stat-value">${perf.avgHold}</div><div class="stat-sub">per trade</div></div>
      </div>
      <div class="stat2-grid" style="margin-top:8px">
        <div class="stat-card"><div class="stat-label">Profit factor</div><div class="stat-value">${perf.profitFactor === Infinity ? '∞' : perf.profitFactor.toFixed(2)}</div><div class="stat-sub">gross win ÷ loss</div></div>
        <div class="stat-card"><div class="stat-label">Expectancy</div><div class="stat-value" style="color:${perf.expectancy >= 0 ? 'var(--buy)' : 'var(--sell)'}">${money(perf.expectancy)}</div><div class="stat-sub">avg per trade</div></div>
        <div class="stat-card"><div class="stat-label">Best streak</div><div class="stat-value" style="color:var(--buy)">${perf.bestWinStreak}W</div><div class="stat-sub">consecutive wins</div></div>
        <div class="stat-card"><div class="stat-label">Max drawdown</div><div class="stat-value" style="color:var(--sell)">${money(perf.maxDrawdown)}</div><div class="stat-sub">peak-to-trough</div></div>
      </div>
    </details>

    ${pnlPanel(closed)}

    <div id="open-wrap" data-sig="${openSig()}">${openList()}</div>

    ${strategyStatusHtml(closed)}

    ${byAssetClassHtml(closed)}

    ${isInternal() ? byEngineHtml(closed) : ''}

    ${byMarketHtml(closed)}

    ${isInternal() ? labPanel() : ''}

    <details class="panel" style="padding:12px 16px;margin-top:20px">
      <summary style="cursor:pointer;font:600 13.5px var(--font-heading);display:flex;align-items:center;justify-content:space-between;gap:10px"><span>Recent trades</span><i class="ph ph-caret-down" style="color:var(--text-muted);flex:none"></i></summary>
      ${closed.length ? `<div style="text-align:right;margin-top:8px"><a id="export-csv" style="cursor:pointer;font-size:12px"><i class="ph-bold ph-download-simple" style="font-size:12px;vertical-align:-1px"></i> Export CSV</a></div>` : ''}
      <div style="margin-top:4px">
      ${closed.slice(0, 30).map((c) => {
        const pnl = tradePnl(c);
        const color = pnl >= 0 ? 'var(--buy)' : 'var(--sell)';
        const dateStr = new Date(c.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="closed-row">
          <div class="closed-sym">${c.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${c.side === 'LONG' ? 'Long' : 'Short'} · ${c.symbol}</div>
            <div class="closed-sub">${dateStr} · held ${fmtHoldMin(c.holdMin)}</div>
          </div>
          <div class="closed-result">
            <div class="r" style="color:${color}">${money(pnl)}</div>
            <div class="o">${c.outcome}</div>
          </div>
        </div>`;
      }).join('')}
      </div>
    </details>

    <div class="section-label" style="margin-top:20px">Setup</div>
    ${marketSelector()}
    ${pnlHelp()}

    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">Virtual money only · educational · past results don't guarantee future performance.</p>
    </div><!-- /paper-detail -->
    </div><!-- /paper-split -->
  </div>`;

  wireSelector(container);
  wirePnl(container);
  wireLab(container); // async — fills the strategy-lab scoreboard from /lab

  const exportBtn = container.querySelector('#export-csv');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const trades = getClosedTrades();
    if (!trades.length) return;
    downloadCsv(`ajent-paper-trades-${new Date().toISOString().slice(0, 10)}.csv`, tradesToCsv(trades));
  });

  // Close a manual "your book" trade at the live price.
  container.querySelectorAll('[data-uot-close]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const sym = b.dataset.uotClose;
    const m = state.engine.get(sym);
    const t = userTradeFor(sym);
    if (t && t.status === 'pending') cancelUserOrder(sym); // working order → cancel
    else closeUserTrade(sym, (m && m.price) || 0, 'manual');
    render(container);
  }));
  // Close ONE strategy (auto) position at the live price.
  container.querySelectorAll('[data-uot-close-strat]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCustomPosition(b.dataset.uotCloseStrat, state.engine);
    render(container);
  }));
  // Cancel ALL working orders / close ALL strategy positions.
  const cancelAllBtn = container.querySelector('[data-uot-cancelall]');
  if (cancelAllBtn) cancelAllBtn.addEventListener('click', () => { cancelAllPending(); render(container); });
  const closeAllStratBtn = container.querySelector('[data-uot-closeallstrat]');
  if (closeAllStratBtn) closeAllStratBtn.addEventListener('click', () => { closeAllCustom(state.engine); render(container); });

  // Crosshair + P&L tooltip on the equity curve and the You-vs-Ajent comparison.
  wireChartHover(container);
  wireDualHover(container);

  const yvaShare = container.querySelector('#yva-share');
  if (yvaShare) yvaShare.addEventListener('click', () => shareResult(userStats(), customStats(), ajentAvgR(getClosedTrades())));
}

// Live, in-place refresh: only re-paint the per-market Buy/Sell/Flat tags in the
// selector while it's open. Never rebuilds the panel, so the open/closed groups
// and any in-progress editing stay put.
export function refresh(container) {
  // Empty state: if a trade has now closed, switch to the full record; otherwise
  // live-patch the "closest to a setup" list when proximity data changes (it
  // usually isn't loaded yet at first render). Patch only #watch-wrap so the
  // market selector's open/editing state is never disturbed.
  const watchWrap = container.querySelector('#watch-wrap');
  if (watchWrap) {
    if (getPerformanceSummary()) { render(container); return; }
    const sig = watchSig();
    if (watchWrap.dataset.sig !== sig) { watchWrap.innerHTML = watchingList(); watchWrap.dataset.sig = sig; }
  }

  // In the full record view, a newly-closed trade changes the P&L, stats and
  // record — re-render so they stay live (the period selector persists via the
  // module-level state). Rare event, so a full rebuild is fine.
  if (!watchWrap && getClosedTrades().length !== renderedClosedCount) { render(container); return; }

  // Open positions: patch each row's live P&L + risk bar as prices tick (works in
  // both the empty state and the full record view).
  const openWrap = container.querySelector('#open-wrap');
  if (openWrap) {
    const sig = openSig();
    if (openWrap.dataset.sig !== sig) {
      getOpenPositions().forEach((p) => {
        const pnl = posLivePnl(p);
        const k = posDomKey(p);
        const pEl = openWrap.querySelector(`[data-open-pnl="${k}"]`);
        const bEl = openWrap.querySelector(`[data-open-bar="${k}"]`);
        if (pEl && pnl) {
          const prog = exitProgressText(p, pnl.px);
          pEl.textContent = `${money(pnl.dollars)}${prog ? ` · ${prog}` : ''}`;
          pEl.style.color = pnl.dollars >= 0 ? 'var(--buy)' : 'var(--sell)';
        }
        if (bEl && pnl) bEl.innerHTML = riskBar(pnl.r);
        updateCallPill(openWrap.querySelector(`[data-call="${k}"]`), state.engine.get(p.symbol), p);
      });
      // If the set of open positions changed (a trade opened/closed), rebuild.
      const cur = [...openWrap.querySelectorAll('[data-open-row]')].map((el) => el.dataset.openRow).join(',');
      const now = getOpenPositions().map((p) => p.symbol).join(',');
      if (cur !== now) openWrap.innerHTML = openList();
      openWrap.dataset.sig = sig;
    }
  }

  const list = container.querySelector('#pm-list');
  if (!list || list.style.display === 'none') return;
  const threshold = state.settings.threshold;
  list.querySelectorAll('[data-pm-trend]').forEach((el) => {
    const m = state.engine.get(el.dataset.pmTrend);
    if (!m) return;
    const b = verdictBits(m.verdict(threshold));
    const cls = `pm-trend ${b.cls}`;
    if (el.className !== cls) el.className = cls;
    if (el.innerHTML !== b.inner) el.innerHTML = b.inner;
  });
}
