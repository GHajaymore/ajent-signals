import { state, toggleWatchlist } from '../state.js';
import { backendConfigured } from '../backendApi.js';
import { CATEGORY_ORDER } from '../mockEngine.js';

// A market shows only when we have REAL data for it (server signal or a real
// client fetch). When the backend is connected we never display SIM markets —
// no fabricated data, ever.
export function isRealMarket(m) { return !!(m && (m.hasServerSignal || m.signalIsReal)); }
import { marketRow, patchRow, symTile } from '../components.js';
import { escapeHtml } from '../format.js';

// Markets nearest a setup (by the server proximity score), ranked — used by the
// "Watching" filter so you can scan what's brewing across the whole board.
function watchMarkets(threshold, q) {
  return state.engine.markets
    .filter((m) => isRealMarket(m) && m.signal && (m.signal.proximity || 0) > 0 && m.verdict(threshold) === 'NO_TRADE'
      && (!q || m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q)))
    .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0));
}
function watchRow(m) {
  const s = m.signal;
  const prox = Math.max(0, Math.min(100, s.proximity || 0));
  const trig = s.htfTrend === 'up' ? `RSI2 ${s.rsi2} · long fires under 15`
    : s.htfTrend === 'down' ? `RSI2 ${s.rsi2} · short fires over 85` : `RSI2 ${s.rsi2}`;
  return `<div class="closed-row" data-nav="#/signal/${m.symbol}" data-sym="${m.symbol}" style="cursor:pointer">
    ${symTile(m.symbol, 34)}
    <div class="closed-body">
      <div class="closed-title">${m.name}</div>
      <div class="closed-sub"><i class="ph-fill ph-eye" style="font-size:11px;color:var(--text-muted)"></i> ${trig}</div>
    </div>
    <div style="text-align:right;flex:none;width:60px">
      <div class="text-muted tabular" style="font-size:12.5px;font-weight:700">${prox}%</div>
      <div style="height:4px;background:var(--neutral-900);border-radius:2px;margin-top:4px"><div style="width:${prox}%;height:100%;background:var(--flat);border-radius:2px"></div></div>
    </div>
  </div>`;
}

// Wire the per-row star toggles. stopPropagation keeps the tap from bubbling to
// the row's navigation, so starring never opens the signal detail.
function wireStars(wrap) {
  wrap.querySelectorAll('.mkt-star').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const on = toggleWatchlist(btn.dataset.star);
      btn.classList.toggle('on', on);
      const icon = btn.querySelector('i');
      if (icon) icon.className = `${on ? 'ph-fill' : 'ph'} ph-star`;
      btn.title = on ? 'In watchlist — tap to remove' : 'Add to watchlist';
    });
  });
}

const CAT_COLOR = {
  Index: 'var(--accent-300)',
  'Global Index': '#9b8afb',
  Currencies: '#4fd1c5',
  Energy: 'var(--flat)',
  Metals: 'var(--accent-200)',
  Rates: 'var(--neutral-300)',
  Crypto: 'var(--buy)',
  Volatility: 'var(--sell)',
  Ags: 'var(--accent-400)',
};

let query = '';
let filter = 'all'; // all | buy | watch | conv | fav

// A fired, real signal the engine flags as its strongest tier (deepest RSI2 +
// Bollinger extreme). Only meaningful for markets currently printing a signal.
function isHiConv(m, threshold) {
  return m.signalIsReal && m.verdict(threshold) !== 'NO_TRADE'
    && m.signal && m.signal.plan && m.signal.plan.conviction === 'high';
}

// Live market-breadth bar — how the whole board is leaning right now.
// Subtitle count — recomputed live (real-market count is 0 at first render, before
// server signals sync in).
function subtitleText() {
  const engine = state.engine;
  if (!backendConfigured()) return `${engine.markets.length} global markets — futures, indexes, FX &amp; crypto`;
  const n = engine.markets.filter(isRealMarket).length;
  return n ? `${n} markets with live data — real signals only` : 'Loading live market data…';
}

// Long-only board, so there is no "Sell". Breadth = Buy (firing) / Watching
// (no trade yet but a setup is brewing — proximity > 0) / No-trade (nothing near).
export function breadthCounts() {
  const threshold = state.settings.threshold;
  let buy = 0, watching = 0, flat = 0;
  for (const m of state.engine.markets) {
    const v = m.verdict(threshold);
    if (v === 'BUY') buy++;
    else if ((m.signal && m.signal.proximity) > 0) watching++;
    else flat++;
  }
  return { buy, watching, flat };
}
function breadthHtml() {
  const { buy, watching, flat } = breadthCounts();
  const total = buy + watching + flat || 1;
  return `<div class="breadth" data-counts="${buy},${watching}">
    <div class="breadth-row">
      <span class="breadth-stat"><b style="color:var(--buy)">${buy}</b> Buy</span>
      <span class="breadth-stat"><b style="color:var(--flat)">${watching}</b> Watching</span>
      <span class="breadth-stat"><b>${flat}</b> No-trade</span>
    </div>
    <div class="breadth-bar">
      <span style="width:${(buy / total) * 100}%;background:var(--buy)"></span>
      <span style="width:${(watching / total) * 100}%;background:var(--flat)"></span>
      <span style="width:${(flat / total) * 100}%;background:var(--neutral-700)"></span>
    </div>
  </div>`;
}

function filterChips() {
  const c = (id, label, icon) => `<button class="fchip ${filter === id ? 'on' : ''}" data-filter="${id}">${icon}${label}</button>`;
  return `<div class="mkt-filters">
    ${c('all', 'All', '')}
    ${c('buy', 'Buy', '<i class="ph-fill ph-caret-up" style="color:var(--buy);font-size:11px"></i>')}
    ${c('watch', 'Watching', '<i class="ph-fill ph-eye" style="color:var(--accent-300);font-size:11px"></i>')}
    ${c('conv', 'Conviction', '<i class="ph-fill ph-star" style="color:var(--flat);font-size:11px"></i>')}
    ${c('fav', 'Watchlist', '<i class="ph-fill ph-star" style="color:var(--accent-200);font-size:11px"></i>')}
  </div>`;
}

function listHtml() {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const q = query.trim().toUpperCase();

  // "Watching": a flat, proximity-ranked view (not grouped) so the closest-to-
  // firing markets sit at the top.
  if (filter === 'watch') {
    const watching = watchMarkets(threshold, q);
    if (!watching.length) return `<p class="text-muted" style="text-align:center;margin-top:40px">Nothing close to a setup right now — the board isn't stretched. The strategy waits for a genuine oversold dip in an uptrend.</p>`;
    return `<div class="card" style="padding:2px 12px">${watching.map(watchRow).join('')}</div>`;
  }

  const realOnly = backendConfigured();
  const filtered = engine.markets.filter((m) => {
    if (realOnly && !isRealMarket(m)) return false; // hide SIM/no-data markets
    if (q && !(m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q))) return false;
    const v = m.verdict(threshold);
    if (filter === 'buy' && v !== 'BUY') return false;
    if (filter === 'conv' && !isHiConv(m, threshold)) return false;
    if (filter === 'fav' && !state.homeWatchlist.includes(m.symbol)) return false;
    return true;
  });
  const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, list: filtered.filter((m) => m.category === cat) })).filter((g) => g.list.length);

  return byCategory.map((g) => `
    <details class="mkt-group" open>
      <summary class="cat-label" style="color:${CAT_COLOR[g.cat]};cursor:pointer">
        <span>${g.cat.toUpperCase()}<span class="cat-count">${g.list.length}</span></span>
        <i class="ph ph-caret-down" style="margin-left:auto;font-size:14px;color:var(--text-muted)"></i>
      </summary>
      <div class="card" style="padding:2px 12px">
        ${g.list.map((m) => marketRow(m, m.verdict(threshold))).join('')}
      </div>
    </details>
  `).join('') || `<p class="text-muted" style="text-align:center;margin-top:40px">${
    filter === 'conv' ? 'No high-conviction setups right now — the deepest oversold extremes are rare. Check back, or browse All.'
    : filter === 'buy' ? 'No BUY signals firing right now.'
    : 'No contracts match your search.'}</p>`;
}

export function render(container) {
  const engine = state.engine;

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Markets</h1>
    <p class="text-muted" id="mkt-subtitle" style="font-size:13px;margin:4px 0 14px">${subtitleText()}</p>

    <div id="breadth-wrap">${breadthHtml()}</div>

    <div class="search-input-wrap">
      <i class="ph ph-magnifying-glass"></i>
      <input id="mkt-search" class="search-input" placeholder="Search CME, NSE, LSE, ASX..." value="${escapeHtml(query)}">
    </div>

    <div id="mkt-filters-wrap">${filterChips()}</div>

    <div id="market-list-wrap">${listHtml()}</div>
  </div>`;

  const listWrap = document.getElementById('market-list-wrap');
  wireStars(listWrap);

  const rebuild = () => { listWrap.innerHTML = listHtml(); wireStars(listWrap); };

  const input = document.getElementById('mkt-search');
  input.addEventListener('input', () => { query = input.value; rebuild(); });

  container.querySelectorAll('#mkt-filters-wrap .fchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      container.querySelectorAll('#mkt-filters-wrap .fchip').forEach((c) => c.classList.toggle('on', c.dataset.filter === filter));
      rebuild();
    });
  });
}

export function refresh(container) {
  const wrap = container.querySelector('#market-list-wrap');
  if (!wrap) return;
  const threshold = state.settings.threshold;

  // Subtitle: patch the live-data count once signals have synced.
  const sub = container.querySelector('#mkt-subtitle');
  if (sub) { const t = subtitleText(); if (sub.innerHTML !== t) sub.innerHTML = t; }

  // Breadth bar: rebuild only when the buy/watching counts actually change.
  const bWrap = container.querySelector('#breadth-wrap');
  if (bWrap) {
    const { buy, watching } = breadthCounts();
    if (bWrap.querySelector('.breadth')?.dataset.counts !== `${buy},${watching}`) bWrap.innerHTML = breadthHtml();
  }

  // "Watching" is a custom proximity-ranked list (not .mkt-row), so patch it by
  // rebuilding when the ranking/proximity changes; never fall through to patchRow.
  if (filter === 'watch') {
    const sig = watchMarkets(threshold, query.trim().toUpperCase()).map((m) => `${m.symbol}:${m.signal.proximity}:${m.signal.rsi2}`).join(',');
    if (wrap.dataset.watchSig !== sig) { wrap.innerHTML = listHtml(); wireStars(wrap); wrap.dataset.watchSig = sig; }
    return;
  }

  // With a verdict filter active, the visible set changes as verdicts flip —
  // rebuild only when membership actually differs (otherwise patch in place).
  if (filter === 'buy' || filter === 'conv') {
    const q = query.trim().toUpperCase();
    const want = state.engine.markets.filter((m) => {
      if (q && !(m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q))) return false;
      if (filter === 'conv') return isHiConv(m, threshold);
      return m.verdict(threshold) === 'BUY';
    }).map((m) => m.symbol).join(',');
    const have = [...wrap.querySelectorAll('.mkt-row[data-sym]')].map((el) => el.dataset.sym).join(',');
    if (want !== have) { wrap.innerHTML = listHtml(); wireStars(wrap); return; }
  }

  // Patch every existing row in place — no innerHTML rebuild, so no flicker.
  const rows = wrap.querySelectorAll('.mkt-row[data-sym]');
  if (!rows.length) {
    // Cold load: the screen rendered empty before any feed arrived. Once markets
    // have data, build the list now instead of staying stuck on the empty state.
    const hasData = state.engine.markets.some((m) => !backendConfigured() || isRealMarket(m));
    if (hasData) { wrap.innerHTML = listHtml(); wireStars(wrap); }
    return;
  }
  rows.forEach((el) => {
    const m = state.engine.get(el.dataset.sym);
    if (m) patchRow(el, m, m.verdict(threshold));
  });
}
