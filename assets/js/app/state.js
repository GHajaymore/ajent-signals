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

export function acceptDisclaimer() {
  state.accepted = true;
  localStorage.setItem(LS_ACCEPT, '1');
}

export function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}
