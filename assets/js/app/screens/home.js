import { state, saveSettings, setFocusClass } from '../state.js';
import { heroCard, watchlistRow, patchRow, patchHero, symTile, dataTag, sparklineSvg } from '../components.js';
import { getPerformanceSummary, getOpenCount, getOpenPositions, getClosedTrades } from '../paperTrading.js';
import { marketSession } from '../marketHours.js';
import { backendConfigured, isEntitled, fetchNews, fetchStocks, fetchDayExperiment } from '../backendApi.js';
import { groupForSymbol, ASSET_GROUPS, labelForKey } from '../assetClass.js';

// --- Home focus mode --------------------------------------------------------
// Scope the whole Home dashboard (P&L, signals, positions) to ONE asset class, so a
// user can watch just Stocks, or just FX, etc. Board classes slice the shared record;
// Stocks + Day have their own records, fetched and cached here.
const focusRecords = { stocks: null, day: null };
// Asset class (focusClass) and trading style (tradingStyle) are SEPARATE axes. Day is
// a STYLE, not a class — it exists only for Index Futures, on its own record. When the
// Day style is active for a class that supports it, the dashboard shows the day record;
// otherwise it shows the swing slice for the class.
function dayActive() {
  return activeStyleKey() === 'day' && stylesForClass(state.focusClass).includes('day');
}
function focusClosed() {
  if (dayActive()) return (focusRecords.day && focusRecords.day.closed) || [];
  const f = state.focusClass;
  if (f === 'all') return getClosedTrades();
  if (f === 'stocks') return (focusRecords.stocks && focusRecords.stocks.closed) || [];
  return getClosedTrades().filter((c) => groupForSymbol(c.symbol) === f);
}
function focusOpen() {
  if (dayActive()) return (focusRecords.day && focusRecords.day.open) || [];
  const f = state.focusClass;
  if (f === 'all') return getOpenPositions();
  if (f === 'stocks') return (focusRecords.stocks && focusRecords.stocks.open) || [];
  return getOpenPositions().filter((p) => groupForSymbol(p.symbol) === f);
}
function focusMarketList() {
  if (dayActive()) return []; // day is an own-record cell — no board markets
  const f = state.focusClass;
  // The region lens composes with the asset-class focus: show only markets in BOTH.
  const inRegion = state.engine.markets.filter(inActiveRegion);
  if (f === 'all') return inRegion;
  if (f === 'stocks') return []; // own-record cell
  return inRegion.filter((m) => groupForSymbol(m.symbol) === f);
}
// Honest label for a focus key. labelForKey only knows board classes and returns
// 'Other' for anything else (a truthy value), so stocks/day must be checked FIRST or
// the greeting reads "· Other".
function focusClassLabel(k) {
  if (k === 'stocks') return 'Stocks';
  if (k === 'day') return 'Day-trading';
  return labelForKey(k) || k;
}
// Is an asset class actually available in the active region? (Used to reset the focus
// when the region changes and the focused class has no markets there.)
function classAvailable(cls) {
  if (cls === 'all') return true;
  if (cls === 'stocks') return activeRegion() === 'americas'; // US large-cap screener
  return state.engine.markets.some((m) => (m.hasServerSignal || m.signalIsReal) && inActiveRegion(m) && groupForSymbol(m.symbol) === cls);
}
// The focus-class chip row slices the SWING board: All + each board class present +
// Stocks. 'Day' is NOT here — swing-vs-day is the Trading style switcher's job, so a
// single control owns that axis (they'd otherwise be two switches for the same state).
function focusSelectorHtml() {
  // Only offer classes that actually have markets in the active region (global classes —
  // FX/Futures/Crypto — always qualify). So AMER shows US indices/ETFs, EUR shows Euro
  // indices, etc. — the asset classes each region can actually trade.
  const present = new Set(state.engine.markets.filter((m) => (m.hasServerSignal || m.signalIsReal) && inActiveRegion(m)).map((m) => groupForSymbol(m.symbol)));
  const chips = [{ key: 'all', label: 'All' }, ...ASSET_GROUPS.filter((g) => present.has(g.key)).map((g) => ({ key: g.key, label: g.label }))];
  // Stocks is a US large-cap screener, so it belongs to the Americas view.
  if (activeRegion() === 'americas') chips.push({ key: 'stocks', label: 'Stocks' }); // US screener
  return `<div class="focus-scroll"><div class="focus-row">${chips.map((c) => `<button class="focus-chip${state.focusClass === c.key ? ' on' : ''}" data-focus="${c.key}">${c.label}</button>`).join('')}</div></div>`;
}
import { isRealMarket } from './markets.js';
import { inActiveRegion, regionChipsHtml, regionBarHtml, activeRegion } from '../regions.js';
import { upcomingEvents, daysUntil } from '../econCalendar.js';
import { fmtPrice } from '../format.js';
import { positionCallPill, updateCallPill } from '../tradeGuidance.js';

// --- Market news (Pro/trial) ------------------------------------------------
let newsCache = null, newsCacheAt = 0;
function newsRelTime(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function esc(t) { return String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
// Collapsible header for the news section (persisted in settings). Kept distinct
// from the "Market-moving events" banner above it — events are scheduled and
// forward-looking; news is published headlines about what already happened.
function newsHeader() {
  const collapsed = !!state.settings.newsCollapsed;
  return `<div class="section-label news-head" id="news-head" role="button" tabindex="0" aria-expanded="${!collapsed}">
      <span>Market news</span>
      <i class="ph-bold ph-caret-${collapsed ? 'down' : 'up'}" id="news-caret" style="font-size:14px;color:var(--text-muted)"></i>
    </div>`;
}
function newsCardHtml() {
  if (!backendConfigured()) return '';
  const collapsed = !!state.settings.newsCollapsed;
  if (collapsed) return newsHeader();
  const hint = `<div class="sub-hint">Latest published headlines — what already happened.</div>`;
  if (!isEntitled()) {
    return `${newsHeader()}${hint}
      <div class="card" data-nav="#/paywall" style="padding:16px;display:flex;align-items:center;gap:12px;cursor:pointer">
        <i class="ph-fill ph-newspaper" style="font-size:22px;color:var(--accent-300)"></i>
        <div style="flex:1"><div style="font:600 13.5px var(--font-heading)">Real-time market news</div><div class="text-muted" style="font-size:12px">Live headlines from the wire — <span style="color:var(--accent-200)">Pro</span></div></div>
        <span class="chip-upgrade">Go Pro</span>
      </div>`;
  }
  const items = newsCache && newsCache.news ? newsCache.news : null;
  const body = !items ? `<div class="text-muted" style="font-size:12.5px;padding:14px 4px"><i class="ph ph-hourglass-medium" style="margin-right:6px"></i>Loading headlines…</div>`
    : !items.length ? `<div class="text-muted" style="font-size:12.5px;padding:14px 4px">No market headlines right now.</div>`
    : items.slice(0, 6).map((n) => `<a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer" class="news-row" style="display:block;padding:10px 2px;border-bottom:1px solid var(--hairline);text-decoration:none;color:inherit">
        <div style="font:600 13px var(--font-heading);line-height:1.35">${esc(n.title)}</div>
        <div class="text-muted" style="font-size:11px;margin-top:3px">${esc(n.publisher || 'News')} · ${newsRelTime(n.time)}</div>
      </a>`).join('') + `<div class="text-faint" style="font-size:10.5px;padding:9px 2px 4px">Headlines via Yahoo Finance — tap to read at the source. Delayed, informational only.</div>`;
  return `${newsHeader()}${hint}<div class="card" style="padding:2px 12px" id="news-card">${body}</div>`;
}
// Toggle + persist the news collapse state; re-render just the news section.
function wireNews(scope) {
  const head = scope.querySelector('#news-head');
  if (!head || head.dataset.wired) return;
  head.dataset.wired = '1';
  const toggle = () => {
    state.settings.newsCollapsed = !state.settings.newsCollapsed;
    saveSettings();
    const wrap = document.getElementById('news-wrap');
    if (wrap) { wrap.innerHTML = newsCardHtml(); wireGlobalNavLocal(wrap); wireNews(wrap); }
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
}
async function loadNews(container) {
  if (!backendConfigured() || !isEntitled()) return;
  if (!newsCache || Date.now() - newsCacheAt > 300000) {
    const data = await fetchNews();
    if (data) { newsCache = data; newsCacheAt = Date.now(); }
  }
  const wrap = container.querySelector('#news-wrap');
  if (wrap) { wrap.innerHTML = newsCardHtml(); wireGlobalNavLocal(wrap); wireNews(wrap); }
}
function wireGlobalNavLocal(el) {
  el.querySelectorAll('[data-nav]').forEach((n) => { if (n.dataset.navWired) return; n.dataset.navWired = '1'; n.addEventListener('click', () => { location.hash = n.dataset.nav; }); });
}

function pfLabel(perf) { return perf.profitFactor === Infinity ? '∞' : perf.profitFactor.toFixed(2); }

// Rich hero: the honest paper portfolio — P&L, a live equity sparkline, and the
// headline stats. This is the app's centrepiece and its credibility.
function portfolioCard(perf) {
  if (!perf) {
    // No closed trades yet. If a position is already open, say so honestly
    // rather than "no trades yet" — realized P&L only starts once it closes.
    const openN = focusOpen().length;
    const meta = openN
      ? `${openN} open position${openN > 1 ? 's' : ''} · realized P&L appears when ${openN > 1 ? 'they close' : 'it closes'}`
      : 'No trades yet — signals paper-trade automatically';
    return `<div class="pf-card empty" data-nav="#/track">
      <div class="pf-main">
        <div class="pf-label">Paper portfolio · realized</div>
        <div class="pf-value">$0<span class="pf-cur">.00</span></div>
        <div class="pf-meta">${meta}</div>
      </div>
      <i class="ph-bold ph-arrow-up-right pf-go"></i>
    </div>`;
  }
  const up = perf.totalPnl >= 0;
  const col = up ? 'var(--buy)' : 'var(--sell)';
  const spark = perf.equity && perf.equity.length > 1 ? sparklineSvg(perf.equity, col, 128, 46) : '';
  const bal = Number(state.settings.accountBalance) || 25000;
  const retPct = (perf.totalPnl / bal) * 100;
  return `<div class="pf-card ${up ? 'up' : 'down'}" data-nav="#/track">
    <div class="pf-main">
      <div class="pf-label">Paper return · net of costs</div>
      <div class="pf-value" id="hp-pnl" style="color:${col}">${retPct >= 0 ? '+' : ''}${retPct.toFixed(1)}<span class="pf-cur">%</span></div>
      <div class="pf-meta" id="hp-meta"><span style="color:${col}">${money(perf.totalPnl)}</span> on ${money(bal)} · ${perf.winRate}% win · PF ${pfLabel(perf)}</div>
    </div>
    <div class="pf-chart">${spark}<div class="pf-go-sm"><i class="ph-bold ph-caret-right"></i></div></div>
  </div>`;
}

// The two SELECTABLE styles (mirrors settings.js). Swing = the proven board; Day = the
// intraday both-ways EXPERIMENT on its own record. The chip is a live switcher so the
// user can change style from Home, not only from Settings — and picking one actually
// rescopes Home (Swing → the board, Day → the day-trading record) via the focus mode.
// All four industry-standard styles (mirrors settings.js). Trading style is a SEPARATE
// axis from asset class. `order` is the chip-row order (fastest → slowest hold).
const STYLE_META = {
  scalping: { label: 'Scalping', icon: 'ph-lightning', sub: 'seconds–minutes' },
  day: { label: 'Day', icon: 'ph-sun-horizon', sub: 'intraday · flat by close' },
  swing: { label: 'Swing', icon: 'ph-calendar-check', sub: 'dips + trends · holds days' },
  position: { label: 'Position', icon: 'ph-mountains', sub: 'weeks–months' },
};
const STYLE_ORDER = ['scalping', 'day', 'swing', 'position'];
// Which styles an asset class actually SUPPORTS (has a live engine + data for). Swing
// runs on the whole board + stocks. Day exists only for Index Futures (ES/NQ/YM/RTY —
// the day experiment's universe). Scalping needs a paid sub-minute feed the free data
// can't provide; Position isn't validated yet — so neither is live for any class.
export function stylesForClass(cls) {
  return (cls === 'all' || cls === 'index') ? ['swing', 'day'] : ['swing'];
}
// Honest reason a style is unavailable for the current class (for the disabled tooltip).
function styleDisabledReason(k, cls) {
  if (k === 'scalping') return 'Needs a paid sub-minute data feed — not available on the free data';
  if (k === 'position') return 'In development — not yet separately validated';
  if (k === 'day') return 'Day-trading is only available for Index Futures right now';
  return '';
}
export function activeStyleKey() {
  const s = state.settings.tradingStyle || 'swing';
  // Never report a style the current class doesn't support.
  if (STYLE_META[s] && stylesForClass(state.focusClass).includes(s)) return s;
  return 'swing';
}
// The trading-style chip row — a separate axis, gated by the selected asset class.
// Unsupported styles render disabled with an honest reason (per the honest-numbers rule
// we never present Scalping/Position as working when they aren't).
function styleSelectorHtml() {
  const active = activeStyleKey();
  const supported = stylesForClass(state.focusClass);
  const chips = STYLE_ORDER.map((k) => {
    const on = k === active, ok = supported.includes(k);
    const title = ok ? STYLE_META[k].label : styleDisabledReason(k, state.focusClass);
    return `<button class="focus-chip style-chip${on ? ' on' : ''}${ok ? '' : ' off'}" data-set-style="${k}"${ok ? '' : ' disabled aria-disabled="true"'} aria-pressed="${on}" title="${title}"><i class="ph-fill ${STYLE_META[k].icon}"></i> ${STYLE_META[k].label}</button>`;
  }).join('');
  return `<div class="focus-scroll"><div class="focus-row">${chips}</div></div>`;
}
// Read-only active-style readout in the stat grid (the control is the chip row above).
function strategyChip() {
  const active = activeStyleKey();
  return `<div class="stat-card strat-card">
    <div class="stat-label">Trading style</div>
    <div class="stat-value" style="font-size:14px;display:flex;align-items:center;gap:5px"><i class="ph-fill ${STYLE_META[active].icon}" style="color:var(--accent-300);font-size:14px"></i>${STYLE_META[active].label}</div>
    <div class="stat-sub">${STYLE_META[active].sub}${active === 'day' ? ' · <span style="color:var(--flat)">experiment</span>' : ''}</div>
  </div>`;
}

function money(n) {
  const sign = n >= 0 ? '+$' : '-$';
  return sign + Math.abs(Math.round(n)).toLocaleString('en-US');
}

// One ranked "best opportunity" row — the strongest current dip-buy / pop-sell
// setups the engine sees, ordered by confidence.
function isHiConv(m) { return !!(m.signal && m.signal.plan && m.signal.plan.conviction === 'high'); }

function setupRow(m, v) {
  const isBuy = v === 'BUY';
  const isTrend = m.signal && m.signal.strat === 'trend';
  const color = isBuy ? 'var(--buy)' : 'var(--sell)';
  const conf = m.signal.confidence;
  const hi = isHiConv(m);
  // A trend BUY is a continuation, not a dip — don't mislabel it "Buy the dip".
  const typeIcon = isBuy ? (isTrend ? 'ph-trend-up' : 'ph-caret-up') : 'ph-caret-down';
  const typeLabel = isBuy ? (isTrend ? 'Ride the trend' : 'Buy the dip') : 'Sell the pop';
  return `<div class="setup-row${hi ? ' hi-conv' : ''}" data-nav="#/signal/${m.symbol}" data-sym="${m.symbol}">
    ${symTile(m.symbol, 34)}
    <div class="setup-body">
      <div class="setup-name">${m.name} <span style="vertical-align:middle">${dataTag(m)}</span>${hi ? ' <span class="conv-badge"><i class="ph-fill ph-star"></i>High conviction</span>' : ''}</div>
      <div class="setup-type" style="color:${color}"><i class="ph-fill ${typeIcon}"></i>${typeLabel}</div>
    </div>
    <div class="setup-conf">
      <span class="setup-conf-val" style="color:${color}">${conf}%</span>
      <div class="setup-conf-bar"><span style="width:${conf}%;background:${color}"></span></div>
    </div>
  </div>`;
}

// When nothing has fired, show the markets closest to a setup so the screen is
// informative in cash — ranked by the server's proximity score (how near the
// market is to a setup, given the trend). Honest: these are NOT signals, just "watching".
function watchingRow(m) {
  const s = m.signal;
  const prox = Math.max(0, Math.min(100, s.proximity || 0));
  const long = s.htfTrend === 'up';
  const trig = long ? `${prox}% of the way to a buy setup` : s.htfTrend === 'down' ? 'Downtrend — no long setup' : 'No clear trend';
  return `<div class="setup-row" data-nav="#/signal/${m.symbol}" data-sym="${m.symbol}">
    ${symTile(m.symbol, 34)}
    <div class="setup-body">
      <div class="setup-name">${m.name} <span style="vertical-align:middle">${dataTag(m)}</span></div>
      <div class="setup-type" style="color:var(--text-muted)"><i class="ph-fill ph-eye"></i>${trig}</div>
    </div>
    <div class="setup-conf">
      <span class="setup-conf-val text-muted">${prox}%</span>
      <div class="setup-conf-bar"><span style="width:${prox}%;background:var(--flat)"></span></div>
    </div>
  </div>`;
}

function topSetupsHtml(engine, threshold) {
  // Only REAL signals qualify — simulated placeholders never surface as setups.
  // High-conviction setups (the deepest, strongest tier) sort to the top, so
  // the strongest opportunities stand out from the wider stream. Scoped to the focus class.
  const scope = focusMarketList();
  const setups = scope
    .map((m) => ({ m, v: m.verdict(threshold) }))
    .filter((x) => x.v !== 'NO_TRADE' && x.m.signalIsReal)
    .sort((a, b) => (isHiConv(b.m) - isHiConv(a.m)) || (b.m.signal.confidence - a.m.signal.confidence))
    .slice(0, 4);
  if (!setups.length) {
    const held = new Set(focusOpen().map((p) => p.symbol));
    const watching = scope
      .filter((m) => m.signalIsReal && m.signal && (m.signal.proximity || 0) > 0 && m.verdict(threshold) === 'NO_TRADE' && !held.has(m.symbol))
      .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0))
      .slice(0, 4);
    if (watching.length) {
      return `<div class="card" style="padding:12px 12px 2px">
        <div class="text-muted" style="font-size:11.5px;line-height:1.55;padding:0 2px 6px">No setup has fired — the strategy is in cash (that's normal ~90% of the time). Here's what's <b style="color:var(--text)">closest to firing</b>:</div>
        ${watching.map(watchingRow).join('')}
      </div>`;
    }
    return `<div class="card" style="padding:22px 16px;text-align:center">
      <div class="text-muted" style="font-size:12.5px;line-height:1.6">No live setups right now — Ajent is waiting for a genuine oversold dip in an uptrend on a market with a live feed. Most of the time the honest answer is &ldquo;no trade&rdquo;; a setup appears here the moment one fires.</div>
    </div>`;
  }
  return `<div class="card" style="padding:2px 12px">${setups.map((x) => setupRow(x.m, x.v)).join('')}</div>`;
}

// Relative "opened" time for an open position.
function relTime(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Live (unrealized) mark-to-market for an open paper position, using the market's
// current price and the same R-multiple maths the closed record uses. Honest:
// it's the real running P&L of a real open position, not a projection.
function livePnl(p) {
  const market = state.engine.get(p.symbol);
  const px = market && market.price;
  const riskPerUnit = Math.abs(p.risk || (p.entry != null && p.stop != null ? p.entry - p.stop : 0));
  if (!px || p.entry == null || !riskPerUnit) return null;
  const long = (p.side || 'LONG') === 'LONG';
  const r = (long ? (px - p.entry) : (p.entry - px)) / riskPerUnit;
  return { r, dollars: r * (p.riskDollars || 250), px, decimals: market.decimals };
}

// Today's P&L: realized from trades that closed since local midnight, plus the
// live unrealized on everything still open. Honest — separates the two.
function todayPnl() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const closedToday = focusClosed().filter((c) => (c.closedAt || 0) >= t0.getTime());
  const realized = closedToday.reduce((s, c) => s + (c.pnl || 0), 0);
  const open = focusOpen();
  let unreal = 0, marked = 0;
  for (const p of open) { const q = livePnl(p); if (q) { unreal += q.dollars; marked++; } }
  return { realized, closedCount: closedToday.length, unreal, openCount: open.length, marked };
}
function todayCardHtml() {
  const t = todayPnl();
  if (!t.closedCount && !t.openCount) return '';
  const net = t.realized + t.unreal;
  const col = (v) => (v >= 0 ? 'var(--buy)' : 'var(--sell)');
  // Swing trades hold ~1-3 days, so a day with open positions but nothing closed
  // shows unrealized-only — that's expected, not a stuck app. Say so once.
  const swingHint = (t.openCount && !t.closedCount)
    ? `<div class="text-faint" style="font-size:10.5px;margin-top:4px">Swing style — positions hold a few days, so today may show unrealized only until one closes.</div>`
    : '';
  return `<div class="card" data-nav="#/track" style="cursor:pointer;display:flex;align-items:center;gap:14px;padding:13px 16px;margin-top:10px">
      <div style="flex:1">
        <div class="text-muted" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase">Today</div>
        <div id="today-net" style="font:800 22px var(--font-heading);color:${col(net)};line-height:1.1;margin-top:1px">${money(net)}</div>
        <div class="text-muted" style="font-size:11px;margin-top:2px" id="today-sub">
          <span style="color:${col(t.realized)}">${money(t.realized)}</span> realized${t.closedCount ? ` · ${t.closedCount} closed` : ''} · <span style="color:${col(t.unreal)}">${money(t.unreal)}</span> unrealized${t.openCount ? ` · ${t.openCount} open` : ''}
        </div>
        ${swingHint}
      </div>
      <i class="ph-bold ph-caret-right" style="color:var(--text-muted)"></i>
    </div>`;
}

function positionRow(p) {
  const market = state.engine.get(p.symbol);
  const long = (p.side || 'LONG') === 'LONG';
  const pnl = livePnl(p);
  const col = pnl ? (pnl.dollars >= 0 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-muted)';
  const pnlStr = pnl ? `${money(pnl.dollars)} · ${pnl.r >= 0 ? '+' : ''}${pnl.r.toFixed(2)}R` : '· · ·';
  const dec = market ? market.decimals : 2;
  return `<div class="setup-row" data-nav="#/chart/${p.symbol}" data-pos="${p.symbol}">
    ${symTile(p.symbol, 34)}
    <div class="setup-body">
      <div class="setup-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${p.name || p.symbol} ${positionCallPill(market, p)}${p.conviction === 'high' ? ' <span class="conv-badge"><i class="ph-fill ph-star"></i>High conviction</span>' : ''}</div>
      <div class="setup-type" style="color:${long ? 'var(--buy)' : 'var(--sell)'}"><i class="ph-fill ${long ? 'ph-caret-up' : 'ph-caret-down'}"></i>${long ? 'Long' : 'Short'} · entry ${fmtPrice(p.entry, dec)} · ${relTime(p.openedAt)}</div>
    </div>
    <div style="text-align:right;flex:none">
      <div style="color:${col};font-weight:700;font-size:13.5px" class="tabular" data-pos-pnl="${p.symbol}">${pnlStr}</div>
      <div class="text-muted" style="font-size:10.5px;margin-top:2px">unrealized</div>
    </div>
  </div>`;
}

function openPositionsHtml() {
  const open = focusOpen();
  if (!open.length) return '';
  return `<div class="section-label">Live paper positions</div>
    <div class="card" style="padding:2px 12px">${open.map(positionRow).join('')}</div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Clock-based session status, LABELLED with the market it describes so the pill
// is never an ambiguous "Market closed". Anchored to the user's local/primary
// market (set from their region) so it reads as "is MY market open?" — correct
// the instant the app opens, without waiting on a quote.
// Friendly name for the pill — the user's *market by country* ("US market",
// "India market") rather than a bare ticker, since the pill answers "is MY
// market open?". Crypto is 24/7; commodities keep their own name.
const REGION_NAME = {
  US: 'US market', IN: 'India market', GB: 'UK market', DE: 'Germany market',
  FR: 'Europe market', EU: 'Europe market', JP: 'Japan market', HK: 'Hong Kong market',
  CN: 'China market', AU: 'Australia market', CA: 'Canada market', BR: 'Brazil market',
  SG: 'Singapore market',
};
function marketRegion(m) {
  if (!m) return 'Market';
  if (m.category === 'Crypto') return 'Crypto';
  if (/Index/.test(m.category || '')) return REGION_NAME[m.country] || (m.country ? `${m.country} market` : m.name);
  return m.name; // commodities/FX etc. — their own name is clearest
}
function marketStatus(m) {
  if (!m) return { label: 'Loading…', color: 'var(--text-muted)', pulse: false };
  const tag = marketRegion(m); // the user's market by country; hero shows the instrument
  const sess = marketSession(m);
  if (sess === 'closed') return { label: `${tag} · closed`, color: 'var(--text-muted)', pulse: false };
  const age = m.quoteAgeSec;
  const delayed = m.isLiveFresh && age != null && age > 180;
  // When the fresh price is an ETF-proxy estimate (e.g. SPY for delayed ES), say so.
  const px = m.proxySource ? ` · ~RT ${m.proxySource}` : '';
  if (sess === 'open') {
    if (delayed) return { label: `${tag} open · delayed ~${Math.max(1, Math.round(age / 60))}m`, color: '#f5b35a', pulse: false };
    if (m.isLiveFresh) return { label: `${tag} · open${px}`, color: 'var(--buy)', pulse: true };
    return { label: `${tag} · open`, color: 'var(--text-muted)', pulse: false };
  }
  // Untracked exchange — fall back to feed freshness.
  if (delayed) return { label: `${tag} · delayed ~${Math.max(1, Math.round(age / 60))}m`, color: '#f5b35a', pulse: false };
  if (m.isLiveFresh) return { label: `${tag} · ${m.proxySource ? `~RT ${m.proxySource}` : 'live'}`, color: 'var(--buy)', pulse: true };
  return { label: `${tag} · no data`, color: 'var(--text-muted)', pulse: false };
}
// The market the header status describes: the user's local/primary market (from
// their region), which is stable — not the hero's dynamically-featured setup.
function statusMarket(engine) {
  return engine.get(state.homeSymbol) || engine.markets.find(isRealMarket) || engine.get('ES');
}
function statusPillInner(st) {
  return `<span class="dot ${st.pulse ? 'dot-pulse' : ''}" style="background:${st.color}"></span>${st.label}`;
}

function computeDerived() {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const markets = focusMarketList(); // scoped to the Home focus class

  const openSignals = markets.map((m) => ({ m, v: m.verdict(threshold) })).filter((x) => x.v !== 'NO_TRADE');
  const avgConf = openSignals.length
    ? Math.round(openSignals.reduce((s, x) => s + x.m.signal.confidence, 0) / openSignals.length)
    : 0;
  // "Daily trend" = market breadth today (how many markets are up vs down),
  // scoped to markets with live data so stale/no-feed ones don't skew it. NOTE:
  // this reflects price direction, NOT how many BUY signals fired — the strategy
  // is in cash most of the time, so signal-count would read "Down" almost always.
  // Daily-trend breadth respects the region lens (crypto always counts).
  const liveMkts = markets.filter((m) => m.signalIsReal).filter(inActiveRegion);
  const trendScope = liveMkts.length ? liveMkts : markets.filter(inActiveRegion);
  const upToday = trendScope.filter((m) => (m.changePct || 0) > 0).length;
  const downToday = trendScope.filter((m) => (m.changePct || 0) < 0).length;
  const riskOn = upToday >= downToday;
  // Feature the strongest LIVE setup if one has fired — the hero should showcase
  // the actionable signal, not a default NO_TRADE market. Prefer a market whose
  // session is OPEN (you can act on it now) over a closed one; then high-conviction,
  // then confidence. A closed-market signal is still valid at the next open, so it's
  // not excluded — just ranked below anything actionable right now.
  const isOpenNow = (m) => (marketSession(m) === 'open' ? 1 : 0);
  const topSetup = openSignals
    .filter((x) => x.m.signalIsReal)
    .sort((a, b) => (isOpenNow(b.m) - isOpenNow(a.m)) || (isHiConv(b.m) - isHiConv(a.m)) || (b.m.signal.confidence - a.m.signal.confidence))[0];
  let featured = (topSetup && topSetup.m) || engine.get(state.homeSymbol) || engine.get('ES');
  if (backendConfigured() && !isRealMarket(featured)) featured = engine.get('ES') || engine.markets.find(isRealMarket) || featured;
  const featuredVerdict = featured.verdict(threshold);
  const nextEvent = upcomingEvents(engine.calendar)[0] || engine.calendar[0];

  return { engine, threshold, openSignals, avgConf, riskOn, upToday, trendCount: trendScope.length, featured, featuredVerdict, nextEvent };
}

// A live market-board ticker — the "living terminal" signature. A seamless marquee
// of the real markets (mono, coloured by today's move, BUYs flagged) that pauses on
// hover and stills under reduced-motion. Data is live at render; refreshes with Home.
function homeTickerTrack(engine, threshold) {
  const mkts = engine.markets.filter(isRealMarket).filter(inActiveRegion);
  if (mkts.length < 3) return '';
  const item = (m) => {
    const chg = m.changePct || 0, up = chg >= 0;
    const buy = m.verdict(threshold) === 'BUY';
    return `<span class="tk-item${buy ? ' buy' : ''}"><b>${m.symbol}</b><span class="tk-chg" style="color:${up ? 'var(--buy)' : 'var(--sell)'}">${up ? '+' : ''}${(chg).toFixed(2)}%</span>${buy ? '<span class="tk-b">BUY</span>' : ''}</span>`;
  };
  const items = mkts.map(item).join('');
  return `<div class="tk-track">${items}${items}</div>`; // duplicated for a seamless loop
}
// Always render the container (empty until markets turn real); the Home update loop
// refills it each poll so the prices tick live — the "living board" signature.
function homeTickerHtml(engine, threshold) {
  const track = homeTickerTrack(engine, threshold);
  return `<div class="home-ticker${track ? '' : ' empty'}" id="home-ticker" aria-hidden="true">${track}</div>`;
}

export function render(container) {
  const { engine, threshold, openSignals, avgConf, riskOn, upToday, trendCount, featured, featuredVerdict, nextEvent } = computeDerived();
  const perf = getPerformanceSummary(focusClosed());
  const focusOpenN = focusOpen().length;

  container.innerHTML = `
  <div class="fade-in home-wrap">
    <div class="dash-glow"></div>
    <div class="home-topbar">
      <div class="home-brand">
        <span class="brand-mark"><img src="../assets/img/favicon.svg" alt="Ajent Signals" width="40" height="40"></span>
        <div class="brand-name">Ajent Signals</div>
      </div>
      <div class="header-actions">
        <span class="pill" id="market-status">${statusPillInner(marketStatus(statusMarket(engine)))}</span>
        <button class="icon-btn" data-nav="#/alerts" aria-label="Notifications">
          <i class="ph-fill ph-bell"></i>
          ${state.hasUnreadAlerts ? '<span class="unread-dot"></span>' : ''}
        </button>
      </div>
    </div>

    ${homeTickerHtml(engine, threshold)}

    ${regionBarHtml(engine)}

    <div class="home-greeting">${greeting()}${state.focusClass !== 'all' ? ` · <span style="color:var(--accent-200);font-size:13px;font-weight:600">${focusClassLabel(state.focusClass)}</span>` : ''}</div>

    <div class="axis-label">Asset class</div>
    <div id="focus-wrap">${focusSelectorHtml()}</div>
    <div class="axis-label">Trading style</div>
    <div id="style-wrap">${styleSelectorHtml()}</div>

    <div id="portfolio-wrap">${portfolioCard(perf)}</div>

    <div id="today-wrap">${todayCardHtml()}</div>

    <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat-card">
        <div class="stat-label">Open signals</div>
        <div class="stat-value" id="stat-open-signals">${openSignals.length}</div>
        <div class="stat-sub" id="stat-avg-conf">avg ${avgConf}%</div>
      </div>
      <div class="stat-card" data-nav="#/track">
        <div class="stat-label">Open trades</div>
        <div class="stat-value" id="stat-open-trades" style="color:${focusOpenN ? 'var(--buy)' : 'var(--text)'}">${focusOpenN}</div>
        <div class="stat-sub">live paper positions</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Daily trend</div>
        <div class="stat-value" id="stat-daily-trend" style="font-size:15px;color:${riskOn ? 'var(--buy)' : 'var(--sell)'};display:flex;align-items:center;gap:5px">
          <i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Up' : 'Down'}
        </div>
        <div class="stat-sub" id="stat-daily-trend-sub">${upToday} of ${trendCount} markets up</div>
      </div>
      ${strategyChip()}
    </div>

    <div id="hero-wrap" style="margin-top:6px">${heroCard(featured, featuredVerdict)}</div>

    <div id="positions-wrap">${openPositionsHtml()}</div>

    <div class="section-label">Top setups now</div>
    <div id="setups-wrap">${topSetupsHtml(engine, threshold)}</div>

    <div class="section-label">Watchlist<a data-nav="#/markets">All markets &rsaquo;</a></div>
    <div class="card" style="padding:4px 12px">
      <div id="watchlist-wrap">${state.homeWatchlist
        .map((sym) => engine.get(sym))
        .filter((m) => m && (!backendConfigured() || isRealMarket(m)))
        .map((m) => watchlistRow(m, m.verdict(threshold)))
        .join('') || '<div class="text-muted" style="font-size:12.5px;padding:14px 4px">Live data is loading — your watchlist markets will appear as their feeds come in.</div>'}</div>
    </div>

    <div class="section-label">Market-moving events<a data-nav="#/calendar">Calendar &rsaquo;</a></div>
    <div class="sub-hint">Scheduled releases that can move prices. Ajent Pulse stands aside on high-impact days — it won't fade a scheduled event.</div>
    <div class="calendar-banner" data-nav="#/calendar">
      <i class="ph-fill ph-calendar-check"></i>
      <div>
        <div class="t">${nextEvent.title}</div>
        <div class="s">${nextEvent.label || 'Recurring'} · ${nextEvent.time} ET${nextEvent.date ? ` · ${daysUntil(nextEvent.date)}` : ''} · ${nextEvent.impact === 'HIGH' ? 'High' : 'Medium'} impact</div>
      </div>
      <i class="ph-bold ph-caret-right arrow"></i>
    </div>

    <div id="news-wrap">${newsCardHtml()}</div>
  </div>`;

  wireNews(container);
  loadNews(container);

  // Region lens: delegated so it survives the update loop refilling the chips.
  const regionBar = container.querySelector('#region-bar');
  if (regionBar) regionBar.addEventListener('click', (e) => {
    const c = e.target.closest('.rgn-chip');
    if (!c) return;
    state.settings.region = c.dataset.region;
    saveSettings();
    // If the focused class has no markets in the new region, fall back to All.
    if (!classAvailable(state.focusClass)) setFocusClass('all');
    render(container);
  });

  // Focus-class chips: scope the whole dashboard to one asset class.
  const focusWrap = container.querySelector('#focus-wrap');
  if (focusWrap) focusWrap.addEventListener('click', (e) => {
    const c = e.target.closest('.focus-chip');
    if (!c || c.dataset.focus === state.focusClass) return;
    setFocusClass(c.dataset.focus);
    // Trading style is a SEPARATE axis, but keep it valid: if the newly-selected class
    // doesn't support the stored style, fall back to that class's default (Swing).
    if (!stylesForClass(c.dataset.focus).includes(state.settings.tradingStyle || 'swing')) {
      state.settings.tradingStyle = 'swing'; saveSettings();
    }
    ensureFocusRecord(() => render(container)); // fetch stocks/day record if needed, then re-render
    render(container);
  });
  // Trading-style chip row — a SEPARATE axis from asset class. Picking a style only
  // persists the style; it does NOT change the asset class. Disabled styles no-op.
  const styleWrap = container.querySelector('#style-wrap');
  if (styleWrap) styleWrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-style]');
    if (!b || b.disabled || b.dataset.setStyle === activeStyleKey()) return;
    state.settings.tradingStyle = b.dataset.setStyle;
    saveSettings();
    ensureFocusRecord(() => render(container)); // day style may need the /day record
    render(container);
  });
  // On load, if focused on an own-record cell, make sure its record is fetched.
  ensureFocusRecord(() => render(container));
}

// Fetch the /stocks or /day record for the current focus (once), then run `after`.
function ensureFocusRecord(after) {
  if (state.focusClass === 'stocks' && !focusRecords.stocks) {
    fetchStocks().then((d) => { if (d) { focusRecords.stocks = d; after && after(); } }).catch(() => {});
  } else if (dayActive() && !focusRecords.day) {
    fetchDayExperiment().then((d) => { if (d) { focusRecords.day = d; after && after(); } }).catch(() => {});
  }
}

export function refresh(container) {
  const heroWrap = container.querySelector('#hero-wrap');
  const watchlistWrap = container.querySelector('#watchlist-wrap');
  if (!heroWrap || !watchlistWrap) return;

  const { engine, threshold, openSignals, avgConf, riskOn, upToday, trendCount, featured, featuredVerdict } = computeDerived();

  // Focus-class chips: rebuild once markets turn real (the initial paint runs before
  // signals sync, so the board classes appear only after). Delegated click survives.
  const focusWrap = container.querySelector('#focus-wrap');
  if (focusWrap) {
    const present = activeRegion() + '|' + [...new Set(state.engine.markets.filter((m) => (m.hasServerSignal || m.signalIsReal) && inActiveRegion(m)).map((m) => groupForSymbol(m.symbol)))].sort().join(',');
    if (focusWrap.dataset.present !== present) { focusWrap.innerHTML = focusSelectorHtml(); focusWrap.dataset.present = present; }
  }

  const statusEl = container.querySelector('#market-status');
  if (statusEl) statusEl.innerHTML = statusPillInner(marketStatus(statusMarket(engine)));

  // Refresh the living-board ticker so its prices tick with every live poll (and it
  // fills in once markets turn real after the initial paint).
  // Keep the region-pulse bar's breadth/status fresh (delegated click survives this).
  const regionBarEl = container.querySelector('#region-bar');
  if (regionBarEl) { const chips = regionChipsHtml(engine); regionBarEl.classList.toggle('empty', !chips); regionBarEl.innerHTML = chips; }

  const tickerEl = container.querySelector('#home-ticker');
  if (tickerEl) {
    const track = homeTickerTrack(engine, threshold);
    tickerEl.classList.toggle('empty', !track);
    if (track && !tickerEl.querySelector('.tk-track')) tickerEl.innerHTML = track;
    else if (track) {
      // Patch only the change cells in place so the marquee scroll position isn't reset.
      const cells = tickerEl.querySelectorAll('.tk-chg');
      const mkts = engine.markets.filter(isRealMarket).filter(inActiveRegion);
      const vals = mkts.concat(mkts).map((m) => { const c = m.changePct || 0; return { t: `${c >= 0 ? '+' : ''}${c.toFixed(2)}%`, up: c >= 0 }; });
      cells.forEach((el, i) => {
        if (!vals[i]) return;
        if (el.textContent !== vals[i].t) { el.classList.remove('tk-flash'); void el.offsetWidth; el.classList.add('tk-flash'); }
        el.textContent = vals[i].t;
        el.style.color = vals[i].up ? 'var(--buy)' : 'var(--sell)';
      });
    }
  }

  // Portfolio card: rebuild only when the P&L actually changes (a trade closed),
  // so the equity sparkline stays current without per-tick flicker.
  const pfWrap = container.querySelector('#portfolio-wrap');
  if (pfWrap) {
    const perf = getPerformanceSummary(focusClosed());
    const shown = container.querySelector('#hp-pnl')?.textContent ?? null;
    const bal = Number(state.settings.accountBalance) || 25000;
    const rp = perf ? (perf.totalPnl / bal * 100) : 0;
    const next = perf ? `${rp >= 0 ? '+' : ''}${rp.toFixed(1)}%` : null;
    if (shown !== next) pfWrap.innerHTML = portfolioCard(perf);
  }

  const openSignalsEl = container.querySelector('#stat-open-signals');
  const avgConfEl = container.querySelector('#stat-avg-conf');
  const trendEl = container.querySelector('#stat-daily-trend');
  const openTradesEl = container.querySelector('#stat-open-trades');
  if (openSignalsEl) openSignalsEl.textContent = String(openSignals.length);
  if (avgConfEl) avgConfEl.textContent = `avg ${avgConf}%`;
  if (openTradesEl) {
    const oc = focusOpen().length;
    openTradesEl.textContent = String(oc);
    openTradesEl.style.color = oc ? 'var(--buy)' : 'var(--text)';
  }
  if (trendEl) {
    trendEl.style.color = riskOn ? 'var(--buy)' : 'var(--sell)';
    trendEl.innerHTML = `<i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Up' : 'Down'}`;
  }
  const trendSubEl = container.querySelector('#stat-daily-trend-sub');
  if (trendSubEl) trendSubEl.textContent = `${upToday} of ${trendCount} markets up`;

  // Hero: patch in place; only rebuild the whole card if the signal changed.
  const heroEl = heroWrap.querySelector('.hero-card');
  if (!heroEl || !patchHero(heroEl, featured, featuredVerdict)) {
    heroWrap.innerHTML = heroCard(featured, featuredVerdict);
  }

  // Live paper positions: rebuild the section only when the set of open trades
  // changes; otherwise just patch each position's running P&L so it ticks live.
  const posWrap = container.querySelector('#positions-wrap');
  if (posWrap) {
    const open = focusOpen();
    const cur = [...posWrap.querySelectorAll('[data-pos]')].map((el) => el.dataset.pos).join(',');
    const next = open.map((p) => p.symbol).join(',');
    if (cur !== next) {
      posWrap.innerHTML = openPositionsHtml();
    } else {
      open.forEach((p) => {
        const el = posWrap.querySelector(`[data-pos-pnl="${p.symbol}"]`);
        if (!el) return;
        const pnl = livePnl(p);
        if (!pnl) return;
        el.textContent = `${money(pnl.dollars)} · ${pnl.r >= 0 ? '+' : ''}${pnl.r.toFixed(2)}R`;
        el.style.color = pnl.dollars >= 0 ? 'var(--buy)' : 'var(--sell)';
        updateCallPill(posWrap.querySelector(`[data-call="${p.symbol}"]`), state.engine.get(p.symbol), p);
      });
    }
  }

  // Today's P&L: rebuild the card when its content changes (prices tick, a trade
  // opens/closes) so realized + unrealized stay live.
  const todayWrap = container.querySelector('#today-wrap');
  if (todayWrap) {
    const t = todayPnl();
    const sig = `${Math.round(t.realized)}|${Math.round(t.unreal)}|${t.closedCount}|${t.openCount}`;
    if (todayWrap.dataset.sig !== sig) { todayWrap.innerHTML = todayCardHtml(); todayWrap.dataset.sig = sig; }
  }

  // Top setups / watching: rebuild only when the content signature changes, so it
  // doesn't flicker every tick. Signature covers the fired setups AND (when in
  // cash) the "closest to firing" list and its proximity values.
  const setupsWrap = container.querySelector('#setups-wrap');
  if (setupsWrap) {
    const fired = engine.markets
      .map((m) => ({ m, v: m.verdict(threshold) }))
      .filter((x) => x.v !== 'NO_TRADE' && x.m.signalIsReal)
      .sort((a, b) => (isHiConv(b.m) - isHiConv(a.m)) || (b.m.signal.confidence - a.m.signal.confidence))
      .slice(0, 4)
      .map((x) => `${x.m.symbol}:${x.v}`).join(',');
    let sig = fired;
    if (!fired) {
      sig = 'W|' + engine.markets
        .filter((m) => m.signalIsReal && m.signal && (m.signal.proximity || 0) > 0)
        .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0))
        .slice(0, 4)
        .map((m) => `${m.symbol}:${m.signal.proximity}:${m.signal.verdict}`).join(',');
    }
    if (setupsWrap.dataset.sig !== sig) {
      setupsWrap.innerHTML = topSetupsHtml(engine, threshold);
      setupsWrap.dataset.sig = sig;
    }
  }

  // Watchlist: patch each existing row; rebuild only if the row set changed.
  // Same real-only filter as the initial render — never show SIM/no-data markets.
  const visibleWatch = state.homeWatchlist
    .map((sym) => engine.get(sym))
    .filter((m) => m && (!backendConfigured() || isRealMarket(m)));
  const rows = watchlistWrap.querySelectorAll('.wl-row[data-sym]');
  const sameSet = rows.length === visibleWatch.length &&
    [...rows].every((el, i) => el.dataset.sym === (visibleWatch[i] && visibleWatch[i].symbol));
  if (sameSet) {
    rows.forEach((el) => {
      const m = engine.get(el.dataset.sym);
      if (m) patchRow(el, m, m.verdict(threshold));
    });
  } else {
    watchlistWrap.innerHTML = visibleWatch.map((m) => watchlistRow(m, m.verdict(threshold))).join('')
      || '<div class="text-muted" style="font-size:12.5px;padding:14px 4px">Live data is loading — your watchlist markets will appear as their feeds come in.</div>';
  }
}
