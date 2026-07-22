import { state } from '../state.js';
import { heroCard, watchlistRow } from '../components.js';
import { getPerformanceSummary } from '../paperTrading.js';

function money(n) {
  const sign = n >= 0 ? '+$' : '-$';
  return sign + Math.abs(Math.round(n)).toLocaleString('en-US');
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
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
  const featured = engine.get(state.homeSymbol) || engine.get('ES');
  const featuredVerdict = featured.verdict(threshold);
  const nextEvent = engine.calendar.find((e) => e.impact === 'HIGH') || engine.calendar[0];

  return { engine, threshold, openSignals, avgConf, riskOn, featured, featuredVerdict, nextEvent };
}

export function render(container) {
  const { engine, threshold, openSignals, avgConf, riskOn, featured, featuredVerdict, nextEvent } = computeDerived();
  const perf = getPerformanceSummary();

  container.innerHTML = `
  <div class="fade-in">
    <div class="screen-header">
      <div>
        <div class="eyebrow">${greeting()}</div>
        <h1 class="h-title">Dashboard</h1>
      </div>
      <div class="header-actions">
        <span class="pill"><span class="dot dot-buy dot-pulse"></span>Market open</span>
        <button class="icon-btn" data-nav="#/alerts">
          <i class="ph-fill ph-bell"></i>
          ${state.hasUnreadAlerts ? '<span class="unread-dot"></span>' : ''}
        </button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat-card" data-nav="#/track">
        <div class="stat-label">Paper P&amp;L</div>
        <div class="stat-value" style="color:${perf && perf.totalPnl < 0 ? 'var(--sell)' : 'var(--buy)'};font-size:19px">${perf ? money(perf.totalPnl) : '$0'}</div>
        <div class="stat-sub">${perf ? `${perf.winRate}% win rate` : 'no trades yet'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Open signals</div>
        <div class="stat-value" id="stat-open-signals">${openSignals.length}</div>
        <div class="stat-sub" id="stat-avg-conf">avg ${avgConf}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Daily trend</div>
        <div class="stat-value" id="stat-daily-trend" style="font-size:15px;color:${riskOn ? 'var(--buy)' : 'var(--sell)'};display:flex;align-items:center;gap:5px">
          <i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Risk-on' : 'Risk-off'}
        </div>
      </div>
    </div>

    <div class="section-label">Top signal</div>
    <div id="hero-wrap">${heroCard(featured, featuredVerdict)}</div>

    <div class="section-label">Watchlist<a data-nav="#/markets">All markets &rsaquo;</a></div>
    <div class="card" style="padding:4px 12px">
      <div id="watchlist-wrap">${state.homeWatchlist.map((sym) => {
        const m = engine.get(sym);
        return watchlistRow(m, m.verdict(threshold));
      }).join('')}</div>
    </div>

    <div class="calendar-banner" data-nav="#/calendar">
      <i class="ph-fill ph-calendar-check"></i>
      <div>
        <div class="t">${nextEvent.title}</div>
        <div class="s">${nextEvent.day} · ${nextEvent.time} · ${nextEvent.impact === 'HIGH' ? 'High' : 'Medium'} impact</div>
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

  const openSignalsEl = container.querySelector('#stat-open-signals');
  const avgConfEl = container.querySelector('#stat-avg-conf');
  const trendEl = container.querySelector('#stat-daily-trend');
  if (openSignalsEl) openSignalsEl.textContent = String(openSignals.length);
  if (avgConfEl) avgConfEl.textContent = `avg ${avgConf}%`;
  if (trendEl) {
    trendEl.style.color = riskOn ? 'var(--buy)' : 'var(--sell)';
    trendEl.innerHTML = `<i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Risk-on' : 'Risk-off'}`;
  }

  heroWrap.innerHTML = heroCard(featured, featuredVerdict);
  watchlistWrap.innerHTML = state.homeWatchlist.map((sym) => {
    const m = engine.get(sym);
    return watchlistRow(m, m.verdict(threshold));
  }).join('');
}
