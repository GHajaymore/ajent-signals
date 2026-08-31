import { state } from '../state.js';
import { heroCard, watchlistRow, patchRow, patchHero, symTile, dataTag, sparklineSvg } from '../components.js';
import { getPerformanceSummary, getOpenCount } from '../paperTrading.js';
import { marketSession } from '../marketHours.js';
import { backendConfigured } from '../backendApi.js';
import { isRealMarket } from './markets.js';
import { upcomingEvents, daysUntil } from '../econCalendar.js';

function pfLabel(perf) { return perf.profitFactor === Infinity ? '∞' : perf.profitFactor.toFixed(2); }

// Rich hero: the honest paper portfolio — P&L, a live equity sparkline, and the
// headline stats. This is the app's centrepiece and its credibility.
function portfolioCard(perf) {
  if (!perf) {
    return `<div class="pf-card empty" data-nav="#/track">
      <div class="pf-main">
        <div class="pf-label">Paper portfolio</div>
        <div class="pf-value">$0<span class="pf-cur">.00</span></div>
        <div class="pf-meta">No trades yet — signals paper-trade automatically</div>
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

function strategyChip() {
  const daily = state.settings.strategyMode !== 'intraday';
  return `<div class="stat-card strat-card" data-nav="#/settings">
    <div class="stat-label">Strategy</div>
    <div class="stat-value" style="font-size:14px;display:flex;align-items:center;gap:5px"><i class="ph-fill ${daily ? 'ph-calendar-check' : 'ph-lightning'}" style="color:var(--accent-300);font-size:14px"></i>${daily ? 'Proven' : 'Active'}</div>
    <div class="stat-sub">${daily ? 'daily · long-only' : '15-min · long &amp; short'}</div>
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
  const color = isBuy ? 'var(--buy)' : 'var(--sell)';
  const conf = m.signal.confidence;
  const hi = isHiConv(m);
  return `<div class="setup-row${hi ? ' hi-conv' : ''}" data-nav="#/signal/${m.symbol}" data-sym="${m.symbol}">
    ${symTile(m.symbol, 34)}
    <div class="setup-body">
      <div class="setup-name">${m.name} <span style="vertical-align:middle">${dataTag(m)}</span>${hi ? ' <span class="conv-badge"><i class="ph-fill ph-star"></i>High conviction</span>' : ''}</div>
      <div class="setup-type" style="color:${color}"><i class="ph-fill ${isBuy ? 'ph-caret-up' : 'ph-caret-down'}"></i>${isBuy ? 'Buy the dip' : 'Sell the pop'}</div>
    </div>
    <div class="setup-conf">
      <span class="setup-conf-val" style="color:${color}">${conf}%</span>
      <div class="setup-conf-bar"><span style="width:${conf}%;background:${color}"></span></div>
    </div>
  </div>`;
}

function topSetupsHtml(engine, threshold) {
  // Only REAL signals qualify — simulated placeholders never surface as setups.
  // High-conviction setups (deepest RSI2 + Bollinger extreme) sort to the top, so
  // the strongest opportunities stand out from the wider stream.
  const setups = engine.markets
    .map((m) => ({ m, v: m.verdict(threshold) }))
    .filter((x) => x.v !== 'NO_TRADE' && x.m.signalIsReal)
    .sort((a, b) => (isHiConv(b.m) - isHiConv(a.m)) || (b.m.signal.confidence - a.m.signal.confidence))
    .slice(0, 4);
  if (!setups.length) {
    return `<div class="card" style="padding:22px 16px;text-align:center">
      <div class="text-muted" style="font-size:12.5px;line-height:1.6">No live setups right now — Ajent Pulse is waiting for a genuine oversold dip or overbought pop on a market with a live feed. Most of the time the honest answer is &ldquo;no trade&rdquo;; a setup appears here the moment one fires.</div>
    </div>`;
  }
  return `<div class="card" style="padding:2px 12px">${setups.map((x) => setupRow(x.m, x.v)).join('')}</div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Clock-based session status for the featured market — correct the instant the
// app opens (e.g. "Market open" at 9:30 ET) without waiting on a quote.
function marketStatus(m) {
  if (!m) return { label: 'Loading', color: 'var(--text-muted)', pulse: false };
  const sess = marketSession(m);
  if (sess === 'closed') return { label: 'Market closed', color: 'var(--text-muted)', pulse: false };
  const age = m.quoteAgeSec;
  const delayed = m.isLiveFresh && age != null && age > 180;
  if (sess === 'open') {
    if (delayed) return { label: `Open · delayed ~${Math.max(1, Math.round(age / 60))}m`, color: '#f5b35a', pulse: false };
    if (m.isLiveFresh) return { label: 'Market open', color: 'var(--buy)', pulse: true };
    return { label: 'Market open · connecting…', color: 'var(--text-muted)', pulse: false };
  }
  // Untracked exchange — fall back to feed freshness.
  if (delayed) return { label: `Delayed ~${Math.max(1, Math.round(age / 60))}m`, color: '#f5b35a', pulse: false };
  if (m.isLiveFresh) return { label: 'Live', color: 'var(--buy)', pulse: true };
  return { label: 'Simulated', color: 'var(--text-muted)', pulse: false };
}
function statusPillInner(st) {
  return `<span class="dot ${st.pulse ? 'dot-pulse' : ''}" style="background:${st.color}"></span>${st.label}`;
}

function computeDerived() {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const markets = engine.markets;

  const openSignals = markets.map((m) => ({ m, v: m.verdict(threshold) })).filter((x) => x.v !== 'NO_TRADE');
  const avgConf = openSignals.length
    ? Math.round(openSignals.reduce((s, x) => s + x.m.signal.confidence, 0) / openSignals.length)
    : 0;
  const bullish = markets.filter((m) => m.signal.direction > 0).length;
  const riskOn = bullish >= markets.length / 2;
  let featured = engine.get(state.homeSymbol) || engine.get('ES');
  if (backendConfigured() && !isRealMarket(featured)) featured = engine.get('ES') || engine.markets.find(isRealMarket) || featured;
  const featuredVerdict = featured.verdict(threshold);
  const nextEvent = upcomingEvents(engine.calendar)[0] || engine.calendar[0];

  return { engine, threshold, openSignals, avgConf, riskOn, featured, featuredVerdict, nextEvent };
}

export function render(container) {
  const { engine, threshold, openSignals, avgConf, riskOn, featured, featuredVerdict, nextEvent } = computeDerived();
  const perf = getPerformanceSummary();

  container.innerHTML = `
  <div class="fade-in home-wrap">
    <div class="dash-glow"></div>
    <div class="home-topbar">
      <div class="home-brand">
        <span class="brand-mark"><img src="../assets/img/favicon.svg" alt="Ajent Signals" width="40" height="40"></span>
        <div class="brand-name">Ajent Signals</div>
      </div>
      <div class="header-actions">
        <span class="pill" id="market-status">${statusPillInner(marketStatus(featured))}</span>
        <button class="icon-btn" data-nav="#/alerts">
          <i class="ph-fill ph-bell"></i>
          ${state.hasUnreadAlerts ? '<span class="unread-dot"></span>' : ''}
        </button>
      </div>
    </div>

    <div class="home-greeting">${greeting()}</div>

    <div id="portfolio-wrap">${portfolioCard(perf)}</div>

    <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat-card">
        <div class="stat-label">Open signals</div>
        <div class="stat-value" id="stat-open-signals">${openSignals.length}</div>
        <div class="stat-sub" id="stat-avg-conf">avg ${avgConf}%</div>
      </div>
      <div class="stat-card" data-nav="#/track">
        <div class="stat-label">Open trades</div>
        <div class="stat-value" id="stat-open-trades" style="color:${getOpenCount() ? 'var(--buy)' : 'var(--text)'}">${getOpenCount()}</div>
        <div class="stat-sub">live paper positions</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Daily trend</div>
        <div class="stat-value" id="stat-daily-trend" style="font-size:15px;color:${riskOn ? 'var(--buy)' : 'var(--sell)'};display:flex;align-items:center;gap:5px">
          <i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Up' : 'Down'}
        </div>
      </div>
      ${strategyChip()}
    </div>

    <div id="hero-wrap" style="margin-top:6px">${heroCard(featured, featuredVerdict)}</div>

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

    <div class="calendar-banner" data-nav="#/calendar">
      <i class="ph-fill ph-calendar-check"></i>
      <div>
        <div class="t">${nextEvent.title}</div>
        <div class="s">${nextEvent.label || 'Recurring'} · ${nextEvent.time} ET${nextEvent.date ? ` · ${daysUntil(nextEvent.date)}` : ''} · ${nextEvent.impact === 'HIGH' ? 'High' : 'Medium'} impact</div>
      </div>
      <i class="ph-bold ph-caret-right arrow"></i>
    </div>
  </div>`;
}

export function refresh(container) {
  const heroWrap = container.querySelector('#hero-wrap');
  const watchlistWrap = container.querySelector('#watchlist-wrap');
  if (!heroWrap || !watchlistWrap) return;

  const { engine, threshold, openSignals, avgConf, riskOn, featured, featuredVerdict } = computeDerived();

  const statusEl = container.querySelector('#market-status');
  if (statusEl) statusEl.innerHTML = statusPillInner(marketStatus(featured));

  // Portfolio card: rebuild only when the P&L actually changes (a trade closed),
  // so the equity sparkline stays current without per-tick flicker.
  const pfWrap = container.querySelector('#portfolio-wrap');
  if (pfWrap) {
    const perf = getPerformanceSummary();
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
    const oc = getOpenCount();
    openTradesEl.textContent = String(oc);
    openTradesEl.style.color = oc ? 'var(--buy)' : 'var(--text)';
  }
  if (trendEl) {
    trendEl.style.color = riskOn ? 'var(--buy)' : 'var(--sell)';
    trendEl.innerHTML = `<i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Up' : 'Down'}`;
  }

  // Hero: patch in place; only rebuild the whole card if the signal changed.
  const heroEl = heroWrap.querySelector('.hero-card');
  if (!heroEl || !patchHero(heroEl, featured, featuredVerdict)) {
    heroWrap.innerHTML = heroCard(featured, featuredVerdict);
  }

  // Top setups: rebuild only when the ranked set changes (avoids per-tick flicker).
  const setupsWrap = container.querySelector('#setups-wrap');
  if (setupsWrap) {
    const cur = [...setupsWrap.querySelectorAll('.setup-row[data-sym]')].map((el) => el.dataset.sym).join(',');
    const next = engine.markets
      .map((m) => ({ m, v: m.verdict(threshold) }))
      .filter((x) => x.v !== 'NO_TRADE')
      .sort((a, b) => b.m.signal.confidence - a.m.signal.confidence)
      .slice(0, 4)
      .map((x) => x.m.symbol).join(',');
    if (cur !== next) setupsWrap.innerHTML = topSetupsHtml(engine, threshold);
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
