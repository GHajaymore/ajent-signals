import { state, toggleWatchlist } from '../state.js';
import { CATEGORY_ORDER } from '../mockEngine.js';
import { marketRow, patchRow } from '../components.js';
import { escapeHtml } from '../format.js';

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
let filter = 'all'; // all | buy | sell | conv | fav

// A fired, real signal the engine flags as its strongest tier (deepest RSI2 +
// Bollinger extreme). Only meaningful for markets currently printing a signal.
function isHiConv(m, threshold) {
  return m.signalIsReal && m.verdict(threshold) !== 'NO_TRADE'
    && m.signal && m.signal.plan && m.signal.plan.conviction === 'high';
}

// Live market-breadth bar — how the whole board is leaning right now.
function breadthHtml() {
  const threshold = state.settings.threshold;
  let buy = 0, sell = 0, flat = 0;
  for (const m of state.engine.markets) {
    const v = m.verdict(threshold);
    if (v === 'BUY') buy++; else if (v === 'SELL') sell++; else flat++;
  }
  const total = buy + sell + flat || 1;
  return `<div class="breadth" data-counts="${buy},${sell}">
    <div class="breadth-row">
      <span class="breadth-stat"><b style="color:var(--buy)">${buy}</b> Buy</span>
      <span class="breadth-stat"><b style="color:var(--sell)">${sell}</b> Sell</span>
      <span class="breadth-stat"><b>${flat}</b> No-trade</span>
    </div>
    <div class="breadth-bar">
      <span style="width:${(buy / total) * 100}%;background:var(--buy)"></span>
      <span style="width:${(flat / total) * 100}%;background:var(--neutral-700)"></span>
      <span style="width:${(sell / total) * 100}%;background:var(--sell)"></span>
    </div>
  </div>`;
}

function filterChips() {
  const c = (id, label, icon) => `<button class="fchip ${filter === id ? 'on' : ''}" data-filter="${id}">${icon}${label}</button>`;
  return `<div class="mkt-filters">
    ${c('all', 'All', '')}
    ${c('buy', 'Buy', '<i class="ph-fill ph-caret-up" style="color:var(--buy);font-size:11px"></i>')}
    ${c('sell', 'Sell', '<i class="ph-fill ph-caret-down" style="color:var(--sell);font-size:11px"></i>')}
    ${c('conv', 'Conviction', '<i class="ph-fill ph-star" style="color:var(--flat);font-size:11px"></i>')}
    ${c('fav', 'Watchlist', '<i class="ph-fill ph-star" style="color:var(--accent-200);font-size:11px"></i>')}
  </div>`;
}

function listHtml() {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const q = query.trim().toUpperCase();

  const filtered = engine.markets.filter((m) => {
    if (q && !(m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q))) return false;
    const v = m.verdict(threshold);
    if (filter === 'buy' && v !== 'BUY') return false;
    if (filter === 'sell' && v !== 'SELL') return false;
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
    filter === 'conv' ? 'No high-conviction setups right now — the deepest oversold/overbought extremes are rare. Check back, or browse All.'
    : filter === 'buy' || filter === 'sell' ? `No ${filter.toUpperCase()} signals firing right now.`
    : 'No contracts match your search.'}</p>`;
}

export function render(container) {
  const engine = state.engine;

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Markets</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 14px">${engine.markets.length} global markets — futures, indexes, FX &amp; crypto</p>

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

  // Breadth bar: rebuild only when the buy/sell counts actually change.
  const bWrap = container.querySelector('#breadth-wrap');
  if (bWrap) {
    let buy = 0, sell = 0;
    for (const m of state.engine.markets) { const v = m.verdict(threshold); if (v === 'BUY') buy++; else if (v === 'SELL') sell++; }
    if (bWrap.querySelector('.breadth')?.dataset.counts !== `${buy},${sell}`) bWrap.innerHTML = breadthHtml();
  }

  // With a verdict filter active, the visible set changes as verdicts flip —
  // rebuild only when membership actually differs (otherwise patch in place).
  if (filter === 'buy' || filter === 'sell' || filter === 'conv') {
    const q = query.trim().toUpperCase();
    const want = state.engine.markets.filter((m) => {
      if (q && !(m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q))) return false;
      const v = m.verdict(threshold);
      if (filter === 'conv') return isHiConv(m, threshold);
      return filter === 'buy' ? v === 'BUY' : v === 'SELL';
    }).map((m) => m.symbol).join(',');
    const have = [...wrap.querySelectorAll('.mkt-row[data-sym]')].map((el) => el.dataset.sym).join(',');
    if (want !== have) { wrap.innerHTML = listHtml(); wireStars(wrap); return; }
  }

  // Patch every existing row in place — no innerHTML rebuild, so no flicker.
  const rows = wrap.querySelectorAll('.mkt-row[data-sym]');
  if (!rows.length) return;
  rows.forEach((el) => {
    const m = state.engine.get(el.dataset.sym);
    if (m) patchRow(el, m, m.verdict(threshold));
  });
}
