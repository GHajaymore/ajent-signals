import { state, perTradeRisk, getEnabledPaperMarkets } from './state.js';
import * as gate from './screens/gate.js';
import * as home from './screens/home.js';
import * as signalDetail from './screens/signalDetail.js';
import * as marketsScreen from './screens/markets.js';
import * as track from './screens/track.js';
import * as calendarScreen from './screens/calendar.js';
import * as alertsScreen from './screens/alerts.js';
import * as settingsScreen from './screens/settings.js';
import * as paywall from './screens/paywall.js';
import * as methodology from './screens/methodology.js';
import * as faq from './screens/faq.js';
import * as onboarding from './screens/onboarding.js';
import { startLiveDataLoop, startFocusDataLoop } from './liveData.js';
import { applyGeoDefaults } from './geo.js';
import { startUpdateWatcher } from './updateCheck.js';
import { startSignalRefreshLoop } from './signalRefreshLoop.js';
import { maybeOpenPositions, checkOpenPositions, applyServerRecord } from './paperTrading.js';
import { backendConfigured, fetchServerTrades, fetchServerSignals, redeemSession, refreshProToken, confirmEntitlement, initBilling } from './backendApi.js';
import { initIap } from './iap.js';
import * as proSuccess from './screens/proSuccess.js';

const TABS = [
  { key: 'home', label: 'Home', icon: 'ph-house' },
  { key: 'markets', label: 'Markets', icon: 'ph-chart-bar' },
  { key: 'track', label: 'Paper', icon: 'ph-flask' },
  { key: 'alerts', label: 'Alerts', icon: 'ph-bell' },
  { key: 'settings', label: 'Settings', icon: 'ph-gear' },
];

const LIVE_SCREENS = new Set(['home', 'markets', 'signal', 'track']);
const NO_TABBAR = new Set(['gate', 'paywall', 'methodology', 'welcome', 'pro-success', 'chart', 'faq']);

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
  if (state.accepted && route[0] === 'gate') { location.hash = state.onboarded ? '#/home' : '#/welcome'; return; }
  // First run after accepting the disclaimer: show the onboarding walkthrough.
  if (state.accepted && !state.onboarded && route[0] !== 'welcome') { location.hash = '#/welcome'; return; }
  if (state.accepted && state.onboarded && route[0] === 'welcome') { location.hash = '#/home'; return; }

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
    case 'chart':
      state.selectedSymbol = route[1] || state.selectedSymbol;
      signalDetail.renderChartPage(contentEl);
      break;
    case 'calendar':
      calendarScreen.render(contentEl);
      break;
    case 'paywall':
      paywall.render(contentEl);
      break;
    case 'pro-success':
      proSuccess.render(contentEl);
      break;
    case 'methodology':
      methodology.render(contentEl);
      break;
    case 'faq':
      faq.render(contentEl);
      break;
    case 'welcome':
      onboarding.render(contentEl);
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
    case 'track': track.refresh?.(contentEl); break;
    default: return;
  }
  wireGlobalNav();
}

window.addEventListener('hashchange', renderRoute);
renderRoute();
startLiveDataLoop(state.engine);
// Fast-poll only what's on screen so the visible price ticks like a live quote.
startFocusDataLoop(state.engine, () => {
  const route = parseHash();
  if (route[0] === 'signal' && route[1]) return [route[1]];
  if (route[0] === 'home' || !route[0]) return [state.homeSymbol, ...state.homeWatchlist];
  if (route[0] === 'markets') return state.homeWatchlist;
  return [];
});
startSignalRefreshLoop(state.engine);
applyGeoDefaults(state);
startUpdateWatcher();
// Network-first service worker so the latest app code is always fetched when
// online — no more stale cached modules serving an old strategy. Scope is the
// site root so it covers both /app/ and /assets/.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('../sw.js').catch(() => { /* SW optional */ });
}
// Native in-app purchases (inert on web/PWA). Re-render the paywall if the
// entitlement changes so a completed purchase/restore reflects immediately.
initIap(() => {
  if (parseHash()[0] === 'paywall') renderRoute();
});

// When the backend is connected it runs the paper account 24/7, so the client
// stops trading locally and instead syncs the server's record (which keeps
// growing whether or not the app is open). Poll it every 30s + once on load.
async function syncServerRecord() {
  if (!backendConfigured()) return;
  const data = await fetchServerTrades();
  if (data) { applyServerRecord(data); const route = parseHash(); if (route[0] === 'track' || route[0] === 'home') refreshRoute(); }
}
if (backendConfigured()) { syncServerRecord(); setInterval(syncServerRecord, 30000); }

// When the backend is connected, the app is a pure display of the Worker's real
// signals — no client-side SIM/proxy. Pull /signals and drive each market from
// the authoritative server signal; the client live/SIM loops skip these markets.
async function syncServerSignals() {
  if (!backendConfigured()) return;
  const data = await fetchServerSignals();
  if (data && Array.isArray(data.signals)) {
    for (const sig of data.signals) { const m = state.engine.get(sig.symbol); if (m) m.applyServerSignal(sig); }
    if (LIVE_SCREENS.has(parseHash()[0])) refreshRoute();
  }
}
if (backendConfigured()) { syncServerSignals(); setInterval(syncServerSignals, 20000); }

// Probe whether a real purchase path exists (Stripe configured) so the paywall
// shows checkout vs. the waitlist correctly. Re-render if we're on the paywall.
initBilling().then((ready) => { if (ready && parseHash()[0] === 'paywall') renderRoute(); });

// Stripe redirect handling: after checkout, Stripe sends the user back with
// ?session_id=… — redeem it for the Pro token, clean the URL, show a confirmation.
async function handleBillingReturn() {
  if (!backendConfigured()) return;
  try {
    const sid = new URLSearchParams(location.search).get('session_id');
    if (sid) {
      const r = await redeemSession(sid);
      // Drop the query string so a refresh doesn't re-run this.
      history.replaceState(null, '', location.pathname + (location.hash || '#/home'));
      location.hash = r && r.token ? '#/pro-success' : '#/paywall';
    } else {
      // On a normal launch: renew the token (extends active subscriptions), then
      // confirm with the server — a faked/expired token gets purged so a free
      // user can't keep Pro unlocked by editing localStorage. Re-render if the
      // entitlement changed so the UI reflects the true tier.
      await refreshProToken();
      const hadToken = !!localStorage.getItem('ajent_pro_token');
      await confirmEntitlement();
      if (hadToken && !localStorage.getItem('ajent_pro_token')) { renderRoute(); refreshRoute(); }
    }
  } catch (e) { /* non-fatal */ }
}
handleBillingReturn();

setInterval(() => {
  const beforeAlerts = state.engine.alerts.length;
  state.engine.tick(state.settings.threshold);
  // Local paper trading only when there's no backend running it server-side.
  if (!backendConfigured()) {
    const enabledPaper = getEnabledPaperMarkets(state.engine.markets.map((m) => m.symbol));
    maybeOpenPositions(state.engine, state.settings.threshold, perTradeRisk(), enabledPaper, !!state.settings.scaleByConviction);
    checkOpenPositions(state.engine, (alert) => {
      state.engine.alerts.unshift(alert);
      if (state.engine.alerts.length > 40) state.engine.alerts.pop();
    });
  }
  if (state.engine.alerts.length > beforeAlerts && state.lastTab !== 'alerts' && parseHash()[0] !== 'alerts') {
    state.hasUnreadAlerts = true;
  }
  const route = parseHash();
  renderTabbar(route);
  if (LIVE_SCREENS.has(route[0])) {
    refreshRoute();
  }
}, 1000);
