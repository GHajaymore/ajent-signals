import { state, perTradeRisk } from './state.js';
import * as gate from './screens/gate.js';
import * as home from './screens/home.js';
import * as signalDetail from './screens/signalDetail.js';
import * as marketsScreen from './screens/markets.js';
import * as track from './screens/track.js';
import * as calendarScreen from './screens/calendar.js';
import * as alertsScreen from './screens/alerts.js';
import * as settingsScreen from './screens/settings.js';
import * as paywall from './screens/paywall.js';
import { startLiveDataLoop } from './liveData.js';
import { applyGeoDefaults } from './geo.js';
import { startUpdateWatcher } from './updateCheck.js';
import { startSignalRefreshLoop } from './signalRefreshLoop.js';
import { maybeOpenPositions, checkOpenPositions } from './paperTrading.js';
import { initIap } from './iap.js';

const TABS = [
  { key: 'home', label: 'Home', icon: 'ph-house' },
  { key: 'markets', label: 'Markets', icon: 'ph-chart-bar' },
  { key: 'track', label: 'Paper', icon: 'ph-flask' },
  { key: 'alerts', label: 'Alerts', icon: 'ph-bell' },
  { key: 'settings', label: 'Settings', icon: 'ph-gear' },
];

const LIVE_SCREENS = new Set(['home', 'markets', 'signal']);
const NO_TABBAR = new Set(['gate', 'paywall']);

const contentEl = document.getElementById('app-content');
const tabbarEl = document.getElementById('tabbar');

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  return h.split('/').filter(Boolean);
}

function tabKeyFor(route) {
  if (route[0] === 'signal' || route[0] === 'calendar') return state.lastTab;
  if (['home', 'markets', 'track', 'alerts', 'settings'].includes(route[0])) return route[0];
  return state.lastTab;
}

function renderTabbar(route) {
  const activeKey = tabKeyFor(route);
  tabbarEl.innerHTML = TABS.map((t) => `
    <button class="tab-btn ${t.key === activeKey ? 'active' : ''}" data-tab="${t.key}">
      <span class="i" style="position:relative">
        <i class="${activeKey === t.key ? 'ph-fill' : 'ph'} ${t.icon}"></i>
        ${t.key === 'alerts' && state.hasUnreadAlerts ? '<span style="position:absolute;top:-1px;right:-3px;width:6px;height:6px;border-radius:50%;background:var(--sell)"></span>' : ''}
      </span>
      ${t.label}
    </button>`).join('');
  tabbarEl.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.tab}`; });
  });
}

function renderRoute() {
  const route = parseHash();

  if (!state.accepted && route[0] !== 'gate') { location.hash = '#/gate'; return; }
  if (state.accepted && route[0] === 'gate') { location.hash = '#/home'; return; }

  const showTabbar = !NO_TABBAR.has(route[0]);
  tabbarEl.style.display = showTabbar ? 'flex' : 'none';
  contentEl.classList.toggle('no-tabbar', !showTabbar);
  contentEl.scrollTop = 0;

  switch (route[0]) {
    case 'gate':
      gate.render(contentEl);
      break;
    case 'home':
      state.lastTab = 'home';
      home.render(contentEl);
      break;
    case 'markets':
      state.lastTab = 'markets';
      marketsScreen.render(contentEl);
      break;
    case 'track':
      state.lastTab = 'track';
      track.render(contentEl);
      break;
    case 'alerts':
      state.lastTab = 'alerts';
      state.hasUnreadAlerts = false;
      alertsScreen.render(contentEl);
      break;
    case 'settings':
      state.lastTab = 'settings';
      settingsScreen.render(contentEl);
      break;
    case 'signal':
      state.selectedSymbol = route[1] || state.selectedSymbol;
      state.detailTab = route[2] || 'signal';
      signalDetail.render(contentEl);
      break;
    case 'calendar':
      calendarScreen.render(contentEl);
      break;
    case 'paywall':
      paywall.render(contentEl);
      break;
    default:
      home.render(contentEl);
  }
  renderTabbar(route);
  wireGlobalNav();
}

function wireGlobalNav() {
  contentEl.querySelectorAll('[data-nav]').forEach((el) => {
    if (el.dataset.navWired) return;
    el.dataset.navWired = '1';
    el.addEventListener('click', () => { location.hash = el.dataset.nav; });
  });
  contentEl.querySelectorAll('[data-back]').forEach((el) => {
    if (el.dataset.navWired) return;
    el.dataset.navWired = '1';
    el.addEventListener('click', () => { history.back(); });
  });
}

// Lightweight, in-place update for the currently visible screen — driven by the 1s
// tick and by live-quote refreshes. Never touches scroll position or replays the
// screen's entrance animation (unlike renderRoute, which is only for navigation).
function refreshRoute() {
  const route = parseHash();
  switch (route[0]) {
    case 'home': home.refresh?.(contentEl); break;
    case 'markets': marketsScreen.refresh?.(contentEl); break;
    case 'signal': signalDetail.refresh?.(contentEl); break;
    default: return;
  }
  wireGlobalNav();
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
startLiveDataLoop(state.engine);
startSignalRefreshLoop(state.engine);
applyGeoDefaults(state);
startUpdateWatcher();
// Native in-app purchases (inert on web/PWA). Re-render the paywall if the
// entitlement changes so a completed purchase/restore reflects immediately.
initIap(() => {
  if (parseHash()[0] === 'paywall') renderRoute();
});

setInterval(() => {
  const beforeAlerts = state.engine.alerts.length;
  state.engine.tick(state.settings.threshold);
  maybeOpenPositions(state.engine, state.settings.threshold, perTradeRisk());
  checkOpenPositions(state.engine, (alert) => {
    state.engine.alerts.unshift(alert);
    if (state.engine.alerts.length > 40) state.engine.alerts.pop();
  });
  if (state.engine.alerts.length > beforeAlerts && state.lastTab !== 'alerts' && parseHash()[0] !== 'alerts') {
    state.hasUnreadAlerts = true;
  }
  const route = parseHash();
  renderTabbar(route);
  if (LIVE_SCREENS.has(route[0])) {
    refreshRoute();
  }
}, 1000);
