import { state, toggleWatchlist, saveSettings, setFocusClass } from '../state.js';
import { backendConfigured } from '../backendApi.js';
import { inActiveRegion, regionBarHtml, regionChipsHtml } from '../regions.js';
import { CATEGORY_ORDER } from '../mockEngine.js';
import { ASSET_GROUPS, ASSET_BY_KEY } from '../assetClass.js';

// A market shows only when we have REAL data for it (server signal or a real
// client fetch). When the backend is connected we never display SIM markets —
// no fabricated data, ever.
export function isRealMarket(m) { return !!(m && (m.hasServerSignal || m.signalIsReal)); }
import { marketRow, patchRow, symTile, sparklineSvg } from '../components.js';
import { escapeHtml, fmtPct } from '../format.js';
import { marketSession, openSessions } from '../marketHours.js';

// "Markets open now" strip — the major world exchanges with a live open/closed dot,
// so you can see at a glance which sessions are trading. Global markets (crypto 24/7,
// FX 24/5) are always live and aren't gated by these cash hours.
function sessionStripHtml() {
  const sess = openSessions();
  const openCount = sess.filter((s) => s.open).length;
  return `<div class="sess-strip">
    <span class="sess-lead"><b class="mono">${openCount}</b> open</span>
    <div class="sess-scroll"><div class="sess-row">
      ${sess.map((s) => `<span class="sess-chip${s.open ? ' on' : ''}" title="${s.label} — ${s.open ? 'open' : 'closed'}"><i class="sess-dot"></i>${s.flag} ${s.c}</span>`).join('')}
    </div></div>
  </div>`;
}

// Markets nearest a setup (by the server proximity score), ranked — used by the
// "Watching" filter so you can scan what's brewing across the whole board.
function watchMarkets(threshold, q) {
  return state.engine.markets
    .filter((m) => isRealMarket(m) && inAssetClass(m) && m.signal && (m.signal.proximity || 0) > 0 && m.verdict(threshold) === 'NO_TRADE'
      && (!q || m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q)))
    .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0));
}
function watchRow(m) {
  const s = m.signal;
  const prox = Math.max(0, Math.min(100, s.proximity || 0));
  const trig = s.htfTrend === 'up' ? `${prox}% of the way to a buy setup`
    : s.htfTrend === 'down' ? 'Downtrend — no long setup' : 'No clear trend';
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

// Asset-class lens — chips are built DYNAMICALLY from the classes that actually have
// live markets right now (see availableAssetGroups), so a class the app doesn't
// cover — e.g. FX or commodity futures today — never shows an empty board. If that
// coverage is added later, its chip appears on its own. The taxonomy is shared with
// the Track per-class breakdown via assetClass.js.

let query = '';
let filter = 'all'; // all | buy | watch | conv | fav
let view = 'list';  // list | heat
let assetClass = 'all'; // all | index | etf | fx | futures | crypto

// True when market m belongs to the selected asset class ('all' matches everything).
function inAssetClass(m) {
  const g = ASSET_BY_KEY[assetClass];
  return !g || g.cats.includes(m.category);
}

// The asset-class groups that have at least one currently-browsable market (real
// data + in the active region). Drives which chips render, so none is ever a dead end.
function availableAssetGroups() {
  const realOnly = backendConfigured();
  const cats = new Set();
  for (const m of state.engine.markets) {
    if (realOnly && !isRealMarket(m)) continue;
    if (!inActiveRegion(m)) continue;
    cats.add(m.category);
  }
  return ASSET_GROUPS.filter((g) => g.cats.some((c) => cats.has(c)));
}

// Chip row: "All" + one chip per available class. Hidden entirely if only one class
// exists (nothing to switch between). Resets a now-unavailable selection to 'all'.
function assetChipsHtml() {
  const groups = availableAssetGroups();
  // Don't reset the filter here (markets may just not be loaded yet — that would
  // clobber a focus carried in from Home). Only render nothing until there's a choice.
  if (groups.length < 2) return '';
  if (assetClass !== 'all' && !groups.some((g) => g.key === assetClass)) assetClass = 'all';
  const chip = (key, label) => `<button class="aclass-chip ${assetClass === key ? 'on' : ''}" data-aclass="${key}">${label}</button>`;
  // "Stocks" is a nav chip (the screener is its own scan-and-rank screen), sitting in
  // the same row users scan for an asset class, with an ↗ to signal it opens a screen.
  const stocksChip = '<button class="aclass-chip nav" data-aclass="stocks">Stocks <i class="ph-bold ph-arrow-up-right" style="font-size:11px;vertical-align:-1px"></i></button>';
  return `<div class="aclass-scroll"><div class="aclass">${chip('all', 'All')}${groups.map((g) => chip(g.key, g.label)).join('')}${stocksChip}</div></div>`;
}

// A fired, real signal the engine flags as its strongest tier (the deepest,
// highest-conviction setups). Only meaningful for markets currently printing a signal.
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

// Board-lean breadth: Firing (a live BUY or SELL) / Watching (no trade yet but a
// setup is brewing — proximity > 0) / No-trade (nothing near). Both-ways markets can
// fire a SELL, so a short counts as "firing" too, not as no-trade.
export function breadthCounts(filter) {
  const threshold = state.settings.threshold;
  let buy = 0, watching = 0, flat = 0;
  for (const m of state.engine.markets) {
    if (filter && !filter(m)) continue;
    const v = m.verdict(threshold);
    if (v === 'BUY' || v === 'SELL') buy++;
    else if ((m.signal && m.signal.proximity) > 0) watching++;
    else flat++;
  }
  return { buy, watching, flat };
}
// Breadth is scoped to exactly what the list shows: real (when a backend is on) +
// in-region + in the selected asset class — so the bar's counts match the rows below.
function inBoard(m) { return (!backendConfigured() || isRealMarket(m)) && inActiveRegion(m) && inAssetClass(m); }
function breadthHtml() {
  const { buy, watching, flat } = breadthCounts(inBoard);
  const total = buy + watching + flat || 1;
  return `<div class="breadth" data-counts="${buy},${watching}">
    <div class="breadth-row">
      <span class="breadth-stat"><b style="color:var(--buy)">${buy}</b> Firing</span>
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

// List / Heatmap view switch.
function viewToggle() {
  const v = (id, label, icon) => `<button class="vchip ${view === id ? 'on' : ''}" data-view="${id}"><i class="ph-bold ${icon}"></i>${label}</button>`;
  return `<div class="mkt-view">${v('list', 'List', 'ph-list')}${v('heat', 'Heatmap', 'ph-grid-four')}</div>`;
}

// --- Heatmap ---------------------------------------------------------------
// A Finviz-style board: one tile per market, background coloured by the REAL
// daily % change (green up / red down), grouped by category. A BUY setup gets an
// accent ring; closed markets are dimmed. No fabricated values — colour == change.
// A subtle directional wash — a hint of green/red scaled by the day's move, over
// the dark surface. Kept restrained so the sparkline and the figure carry the eye.
function heatColor(pct) {
  const p = Math.max(-2, Math.min(2, pct || 0)) / 2; // clamp ±2% → -1..1
  const mag = Math.round((0.05 + Math.abs(p) * 0.2) * 100); // 5%..25% tint
  const hue = p >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `linear-gradient(158deg, color-mix(in srgb, ${hue} ${mag}%, var(--surface-2, #12141f)) 0%, var(--surface-2, #12141f) 76%)`;
}
function heatTile(m, threshold) {
  const buy = m.verdict(threshold) === 'BUY';
  const closed = marketSession(m) === 'closed';
  const chg = m.changePct || 0;
  const up = chg >= 0;
  const dir = up ? 'var(--buy)' : 'var(--sell)';
  const isTrend = m.signal && m.signal.strat === 'trend';
  const badge = buy ? (isTrend ? 'TREND' : 'DIP') : '';
  const spark = (m.history && m.history.length > 1) ? sparklineSvg(m.history, dir, 96, 26) : '';
  return `<button class="heat-tile${buy ? ' buy' : ''}${closed ? ' closed' : ''}" style="background:${heatColor(chg)}" data-nav="#/signal/${m.symbol}" data-heat="${m.symbol}" title="${escapeHtml(m.name)}">
    <div class="ht-head">
      <span class="ht-sym">${m.symbol}</span>
      ${buy ? `<span class="ht-badge ${isTrend ? 'trend' : 'dip'}">${badge}</span>` : ''}
    </div>
    <div class="ht-spark" aria-hidden="true">${spark}</div>
    <div class="ht-chg" style="color:${dir}"><i class="ph-bold ${up ? 'ph-caret-up' : 'ph-caret-down'}"></i>${fmtPct(chg)}</div>
  </button>`;
}
function heatmapHtml() {
  const threshold = state.settings.threshold;
  const q = query.trim().toUpperCase();
  const realOnly = backendConfigured();
  const markets = state.engine.markets.filter((m) => {
    if (realOnly && !isRealMarket(m)) return false;
    if (!inActiveRegion(m)) return false; // region lens (crypto always shows)
    if (!inAssetClass(m)) return false; // asset-class lens
    if (q && !(m.symbol.includes(q) || m.name.toUpperCase().includes(q) || m.exchange.includes(q))) return false;
    return true;
  });
  if (!markets.length) return `<p class="text-muted" style="text-align:center;margin-top:40px">Live data is loading — the heatmap will fill in as feeds arrive.</p>`;
  const byCategory = CATEGORY_ORDER.map((cat) => ({ cat, list: markets.filter((m) => m.category === cat) })).filter((g) => g.list.length);
  return `<div class="heat-legend"><span><i class="dot" style="background:var(--sell)"></i>Down</span><span><i class="dot" style="background:var(--neutral-700)"></i>Flat</span><span><i class="dot" style="background:var(--buy)"></i>Up</span><span style="margin-left:auto">Tile colour = today's % change</span></div>
  ${byCategory.map((g) => `
    <div class="cat-label" style="color:${CAT_COLOR[g.cat]}"><span>${g.cat.toUpperCase()}<span class="cat-count">${g.list.length}</span></span></div>
    <div class="heat-grid">${g.list.map((m) => heatTile(m, threshold)).join('')}</div>
  `).join('')}`;
}
function contentHtml() { return view === 'heat' ? heatmapHtml() : listHtml(); }

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
    if (!inActiveRegion(m)) return false; // region lens (crypto always shows)
    if (!inAssetClass(m)) return false; // asset-class lens
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

// Board asset classes the Markets filter understands (Stocks/Day live on their own
// screens, so a global focus on those falls back to showing the whole board here).
const BOARD_CLASSES = new Set(['index', 'etf', 'fx', 'futures', 'crypto']);

export function render(container) {
  const engine = state.engine;
  // Sync the board filter with the app-wide focus class (set on Home or here), so the
  // whole app follows one asset class. Non-board focuses (stocks/day) show all here.
  assetClass = BOARD_CLASSES.has(state.focusClass) ? state.focusClass : 'all';

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Markets</h1>
    <p class="text-muted" id="mkt-subtitle" style="font-size:13px;margin:4px 0 10px">${subtitleText()}</p>

    <div id="sess-wrap">${sessionStripHtml()}</div>

    <div id="breadth-wrap">${breadthHtml()}</div>

    <div class="search-input-wrap">
      <i class="ph ph-magnifying-glass"></i>
      <input id="mkt-search" class="search-input" placeholder="Search CME, NSE, LSE, ASX..." value="${escapeHtml(query)}">
    </div>

    ${regionBarHtml(engine)}

    <div id="aclass-wrap">${assetChipsHtml()}</div>

    <div id="mkt-view-wrap">${viewToggle()}</div>

    <div id="mkt-filters-wrap"${view === 'heat' ? ' hidden' : ''}>${filterChips()}</div>

    <div id="market-list-wrap">${contentHtml()}</div>
  </div>`;

  const listWrap = document.getElementById('market-list-wrap');
  wireStars(listWrap);

  const rebuild = () => { listWrap.innerHTML = contentHtml(); wireStars(listWrap); };

  const input = document.getElementById('mkt-search');
  input.addEventListener('input', () => { query = input.value; rebuild(); });

  // Asset-class lens — delegated so it survives the chip row being re-rendered when
  // the region (and thus the available classes) changes.
  const aclassWrap = container.querySelector('#aclass-wrap');
  if (aclassWrap) aclassWrap.addEventListener('click', (e) => {
    const c = e.target.closest('.aclass-chip');
    if (!c) return;
    if (c.dataset.aclass === 'stocks') { location.hash = '#/stocks'; return; } // nav, not a filter
    if (c.dataset.aclass === assetClass) return;
    assetClass = c.dataset.aclass;
    setFocusClass(assetClass); // sync the app-wide focus so Home follows too
    aclassWrap.querySelectorAll('.aclass-chip').forEach((b) => b.classList.toggle('on', b.dataset.aclass === assetClass));
    const bw = container.querySelector('#breadth-wrap'); if (bw) bw.innerHTML = breadthHtml();
    rebuild();
  });

  // Region lens — scope the board to a region; refresh its chips, the asset-class
  // chips (available classes can change), the breadth, and the list.
  const regionBar = container.querySelector('#region-bar');
  if (regionBar) regionBar.addEventListener('click', (e) => {
    const c = e.target.closest('.rgn-chip');
    if (!c) return;
    state.settings.region = c.dataset.region;
    saveSettings();
    regionBar.innerHTML = regionChipsHtml(engine);
    if (aclassWrap) aclassWrap.innerHTML = assetChipsHtml(); // may reset assetClass to 'all'
    const bw = container.querySelector('#breadth-wrap'); if (bw) bw.innerHTML = breadthHtml();
    rebuild();
  });

  container.querySelectorAll('#mkt-filters-wrap .fchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      container.querySelectorAll('#mkt-filters-wrap .fchip').forEach((c) => c.classList.toggle('on', c.dataset.filter === filter));
      rebuild();
    });
  });

  container.querySelectorAll('#mkt-view-wrap .vchip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (view === chip.dataset.view) return;
      view = chip.dataset.view;
      container.querySelectorAll('#mkt-view-wrap .vchip').forEach((c) => c.classList.toggle('on', c.dataset.view === view));
      const fw = document.getElementById('mkt-filters-wrap');
      if (fw) fw.hidden = (view === 'heat');
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

  // Sessions strip: repaint only when an exchange actually flips open/closed.
  const sessWrap = container.querySelector('#sess-wrap');
  if (sessWrap) { const sig = openSessions().map((s) => (s.open ? 1 : 0)).join(''); if (sessWrap.dataset.sig !== sig) { sessWrap.innerHTML = sessionStripHtml(); sessWrap.dataset.sig = sig; } }

  // Asset-class chips: on cold load the board starts empty, so populate/patch the
  // chip row once the set of available classes changes (e.g. first feed arrives).
  const aclassWrap = container.querySelector('#aclass-wrap');
  if (aclassWrap) {
    const want = availableAssetGroups().map((g) => g.key).join(',');
    if (aclassWrap.dataset.groups !== want) { aclassWrap.innerHTML = assetChipsHtml(); aclassWrap.dataset.groups = want; }
  }

  // Breadth bar: rebuild only when the buy/watching counts actually change.
  const bWrap = container.querySelector('#breadth-wrap');
  if (bWrap) {
    const { buy, watching } = breadthCounts(inBoard);
    if (bWrap.querySelector('.breadth')?.dataset.counts !== `${buy},${watching}`) bWrap.innerHTML = breadthHtml();
  }

  // Heatmap view: rebuild the grid only when a tile's colour/verdict/membership
  // actually shifts (change% bucketed) — wireGlobalNav (post-refresh) re-wires taps.
  if (view === 'heat') {
    const realOnly = backendConfigured();
    const sig = state.engine.markets
      .filter((m) => (!realOnly || isRealMarket(m)) && inAssetClass(m))
      .map((m) => `${m.symbol}:${Math.round((m.changePct || 0) * 20)}:${m.verdict(threshold)}:${(m.signal && m.signal.strat) || ''}`).join(',');
    if (wrap.dataset.heatSig !== sig) { wrap.innerHTML = heatmapHtml(); wrap.dataset.heatSig = sig; }
    return;
  }

  // "Watching" is a custom proximity-ranked list (not .mkt-row), so patch it by
  // rebuilding when the ranking/proximity changes; never fall through to patchRow.
  if (filter === 'watch') {
    const sig = watchMarkets(threshold, query.trim().toUpperCase()).map((m) => `${m.symbol}:${m.signal.proximity}:${m.signal.htfTrend}`).join(',');
    if (wrap.dataset.watchSig !== sig) { wrap.innerHTML = listHtml(); wireStars(wrap); wrap.dataset.watchSig = sig; }
    return;
  }

  // With a verdict filter active, the visible set changes as verdicts flip —
  // rebuild only when membership actually differs (otherwise patch in place).
  if (filter === 'buy' || filter === 'conv') {
    const q = query.trim().toUpperCase();
    const want = state.engine.markets.filter((m) => {
      if (!inAssetClass(m)) return false;
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
