import { createEngine } from './mockEngine.js';

const LS_ACCEPT = 'ajent_disclaimer_accepted_v1';
const LS_SETTINGS = 'ajent_settings_v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed.accountBalance)) delete parsed.accountBalance;
    if (!Number.isFinite(parsed.threshold)) delete parsed.threshold;
    if (!Number.isFinite(parsed.riskPct)) delete parsed.riskPct;
    return parsed;
  } catch (e) { /* ignore malformed local storage */ }
  return null;
}

const defaultSettings = {
  threshold: 75,
  riskPct: 1,
  accountBalance: 25000,
  chartRange: '1D',
  notifications: { buy: true, sell: true, stop: true, target: true, reversal: true, volatility: true, news: true },
  subscription: { tier: 'trial' },
};

// Dollars risked on each paper trade — the user's account balance times their
// chosen risk-per-trade %. This is what turns a signal outcome into a plain
// dollar gain/loss instead of an abstract "R" multiple.
export function perTradeRisk() {
  const bal = Number(state.settings.accountBalance) || 0;
  const pct = Number(state.settings.riskPct) || 0;
  return Math.max(1, Math.round(bal * (pct / 100)));
}

// Which markets the user has opted into for auto paper-trading. When the
// setting is absent (default), every market is eligible.
export function getEnabledPaperMarkets(allSymbols) {
  const pm = state.settings.paperMarkets;
  if (!Array.isArray(pm)) return new Set(allSymbols);
  return new Set(pm.filter((s) => allSymbols.includes(s)));
}

export function setPaperMarketEnabled(symbol, on, allSymbols) {
  const cur = getEnabledPaperMarkets(allSymbols);
  if (on) cur.add(symbol); else cur.delete(symbol);
  state.settings.paperMarkets = [...cur];
  saveSettings();
}

export function setAllPaperMarkets(on, allSymbols) {
  state.settings.paperMarkets = on ? [...allSymbols] : [];
  saveSettings();
}

export const state = {
  engine: createEngine(),
  accepted: localStorage.getItem(LS_ACCEPT) === '1',
  acks: { read: false, risk: false, terms: false, age: false },
  selectedSymbol: 'ES',
  homeSymbol: 'ES',
  homeWatchlist: ['ES', 'NQ', 'CL', 'GC', 'BTC', 'RTY'],
  geoCountry: null,
  detailTab: 'signal',
  billing: 'annual',
  lastTab: 'home',
  settings: { ...defaultSettings, ...(loadSettings() || {}) },
  hasUnreadAlerts: true,
};

// Favorites (the star) — persisted so a user's starred markets survive reloads.
const LS_FAV = 'ajent_favorites_v1';
try {
  const favs = JSON.parse(localStorage.getItem(LS_FAV));
  if (Array.isArray(favs)) favs.forEach((sym) => { const m = state.engine.get(sym); if (m) m.favorite = true; });
} catch (e) { /* ignore */ }

export function toggleFavorite(symbol) {
  const m = state.engine.get(symbol);
  if (!m) return false;
  m.favorite = !m.favorite;
  try {
    const favs = state.engine.markets.filter((x) => x.favorite).map((x) => x.symbol);
    localStorage.setItem(LS_FAV, JSON.stringify(favs));
  } catch (e) { /* ignore */ }
  return m.favorite;
}

export function acceptDisclaimer() {
  state.accepted = true;
  localStorage.setItem(LS_ACCEPT, '1');
}

export function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}
