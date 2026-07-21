import { state } from '../state.js';
import { CATEGORY_ORDER } from '../mockEngine.js';
import { marketRow } from '../components.js';

const CAT_COLOR = {
  Index: 'var(--accent-300)',
  Energy: 'var(--flat)',
  Metals: 'var(--accent-200)',
  Rates: 'var(--neutral-300)',
  Crypto: 'var(--buy)',
  Volatility: 'var(--sell)',
  Ags: 'var(--accent-400)',
};

let query = '';

export function render(container) {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const q = query.trim().toUpperCase();

  const filtered = engine.markets.filter((m) => !q || m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q));
  const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, list: filtered.filter((m) => m.category === cat) })).filter((g) => g.list.length);

  container.innerHTML = `
  <div class="fade-in">
    <h1 class="h-title">Markets</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 16px">${engine.markets.length} US futures contracts</p>

    <div class="search-input-wrap">
      <i class="ph ph-magnifying-glass"></i>
      <input id="mkt-search" class="search-input" placeholder="Search CME, CBOT, NYMEX, COMEX..." value="${query}">
    </div>

    ${byCategory.map((g) => `
      <div class="cat-label" style="color:${CAT_COLOR[g.cat]}">${g.cat.toUpperCase()}<span class="cat-count">${g.list.length}</span></div>
      <div class="card" style="padding:2px 12px">
        ${g.list.map((m) => marketRow(m, m.verdict(threshold))).join('')}
      </div>
    `).join('') || '<p class="text-muted" style="text-align:center;margin-top:40px">No contracts match your search.</p>'}
  </div>`;

  const input = document.getElementById('mkt-search');
  input.addEventListener('input', () => {
    query = input.value;
    const pos = input.selectionStart;
    render(container);
    const newInput = document.getElementById('mkt-search');
    newInput.focus();
    newInput.setSelectionRange(pos, pos);
  });
}
