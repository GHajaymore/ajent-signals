import { createEngine } from './mockEngine.js';

const LS_ACCEPT = 'ajent_disclaimer_accepted_v1';
const LS_SETTINGS = 'ajent_settings_v1';

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore malformed local storage */ }
  return null;
}

const defaultSettings = {
  threshold: 75,
  riskPct: 1,
  accountBalance: 25000,
  notifications: { buy: true, sell: true, stop: true, target: true, reversal: true, volatility: true, news: true },
  subscription: { tier: 'trial' },
};

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
