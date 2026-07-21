import { state } from '../state.js';
import { heroCard, watchlistRow } from '../components.js';

const WATCHLIST = ['ES', 'NQ', 'CL', 'GC', 'BTC', 'RTY'];
const TODAY_WINS = 5;
const TODAY_LOSSES = 2;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function render(container) {
  const engine = state.engine;
  const threshold = state.settings.threshold;
  const markets = engine.markets;

  const openSignals = markets.map((m) => ({ m, v: m.verdict(threshold) })).filter((x) => x.v !== 'NO_TRADE');
  const avgConf = openSignals.length
    ? Math.round(openSignals.reduce((s, x) => s + x.m.signal.confidence, 0) / openSignals.length)
    : 0;
  const bullish = markets.filter((m) => m.signal.direction > 0).length;
  const riskOn = bullish >= markets.length / 2;

  const featured = engine.get('ES');
  const featuredVerdict = featured.verdict(threshold);
  const nextEvent = engine.calendar.find((e) => e.impact === 'HIGH') || engine.calendar[0];

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
      <div class="stat-card">
        <div class="stat-label">Win rate today</div>
        <div class="stat-value" style="color:var(--buy)">${Math.round((TODAY_WINS / (TODAY_WINS + TODAY_LOSSES)) * 100)}%</div>
        <div class="stat-sub">${TODAY_WINS}W / ${TODAY_LOSSES}L</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Open signals</div>
        <div class="stat-value">${openSignals.length}</div>
        <div class="stat-sub">avg ${avgConf}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Daily trend</div>
        <div class="stat-value" style="font-size:15px;color:${riskOn ? 'var(--buy)' : 'var(--sell)'};display:flex;align-items:center;gap:5px">
          <i class="ph-bold ${riskOn ? 'ph-trend-up' : 'ph-trend-down'}"></i>${riskOn ? 'Risk-on' : 'Risk-off'}
        </div>
      </div>
    </div>

    <div class="section-label">Top signal</div>
    ${heroCard(featured, featuredVerdict)}

    <div class="section-label">Watchlist<a data-nav="#/markets">All markets &rsaquo;</a></div>
    <div class="card" style="padding:4px 12px">
      ${WATCHLIST.map((sym) => {
        const m = engine.get(sym);
        return watchlistRow(m, m.verdict(threshold));
      }).join('')}
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
