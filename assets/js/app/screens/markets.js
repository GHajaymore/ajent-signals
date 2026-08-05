import { state } from '../state.js';
import { CATEGORY_ORDER } from '../mockEngine.js';
import { marketRow, patchRow } from '../components.js';
import { escapeHtml } from '../format.js';

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

function listHtml() {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const q = query.trim().toUpperCase();

  const filtered = engine.markets.filter((m) => !q || m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q));
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
  `).join('') || '<p class="text-muted" style="text-align:center;margin-top:40px">No contracts match your search.</p>';
}

export function render(container) {
  const engine = state.engine;

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Markets</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 16px">${engine.markets.length} global markets — futures, indexes, FX &amp; crypto</p>

    <div class="search-input-wrap">
      <i class="ph ph-magnifying-glass"></i>
      <input id="mkt-search" class="search-input" placeholder="Search CME, NSE, LSE, ASX..." value="${escapeHtml(query)}">
    </div>

    <div id="market-list-wrap">${listHtml()}</div>
  </div>`;

  const input = document.getElementById('mkt-search');
  input.addEventListener('input', () => {
    query = input.value;
    document.getElementById('market-list-wrap').innerHTML = listHtml();
  });
}

export function refresh(container) {
  const wrap = container.querySelector('#market-list-wrap');
  if (!wrap) return;
  const threshold = state.settings.threshold;
  // Patch every existing row in place — no innerHTML rebuild, so no flicker.
  const rows = wrap.querySelectorAll('.mkt-row[data-sym]');
  if (!rows.length) return;
  rows.forEach((el) => {
    const m = state.engine.get(el.dataset.sym);
    if (m) patchRow(el, m, m.verdict(threshold));
  });
}
