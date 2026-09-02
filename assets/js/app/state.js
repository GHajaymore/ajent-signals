import { createEngine } from './mockEngine.js';
import { isEntitled } from './backendApi.js';

// Free tier auto-trades ONE market at a time; Pro unlocks all. Enforced at read
// time (getEnabledPaperMarkets) so it holds regardless of what's stored.
export const FREE_MARKET_LIMIT = 1;

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
    if (!Number.isFinite(parsed.targetRatio)) delete parsed.targetRatio;
    // The intraday ("Active") strategy was retired — only the validated daily
    // strategy runs. Coerce any legacy stored mode so returning users aren't
    // pinned to a mode that no longer exists (and whose toggle is gone).
    if (parsed.strategyMode && parsed.strategyMode !== 'daily') delete parsed.strategyMode;
    return parsed;
  } catch (e) { /* ignore malformed local storage */ }
  return null;
}

// The daily strategy is LONG-ONLY (buys deeply oversold dips in uptrends; the
// short side backtested as a drag — it lost money on international indices — so
// it's dropped). Its edge is strongest on US large-cap indices (S&P, Nasdaq, Dow,
// Russell). Clean 10y test — RSI2<10 flush entry + "first up close" exit, longs
// only: profit factor ~1.6, win rate ~74%, ~1.6-day avg hold, profitable in every
// one of five sequential ~2y walk-forward windows AND out-of-sample on four more
// global indices (ASX 1.6, Euro Stoxx 1.6, Nikkei, TSX). It LOST on India's Nifty
// 50. Daily mode auto-trades that validated set by default (US indices carry the
// deepest edge; the internationals add session diversification).
export const US_INDEX_MARKETS = ['ES', 'MES', 'NQ', 'MNQ', 'YM', 'RTY'];

// Per-market backtested edge for the DAILY strategy, from 10-year out-of-sample
// tests. 'strong' = clearly profitable (US indices, ASX); 'positive' = profitable
// (Euro Stoxx, Nikkei, TSX); 'flat' = ~break-even (FTSE, DAX); 'negative' = LOST
// money — mean reversion works poorly there, so never imply an edge (Indian
// indices trend hard); anything unlisted is 'untested' (commodities, crypto, FX,
// and indices we haven't validated — the strategy was designed for equity indices).
export const DAILY_EDGE = {
  ES: 'strong', MES: 'strong', NQ: 'strong', MNQ: 'strong', YM: 'strong', RTY: 'strong',
  XJO: 'strong', SX5E: 'positive', N225: 'positive', TSX: 'positive',
  FTSE: 'flat', DAX: 'flat',
  NIFTY: 'negative', BNF: 'negative', SENSEX: 'negative',
};
export function dailyEdge(symbol) { return DAILY_EDGE[symbol] || 'untested'; }

// Default daily auto-trade set = one contract per DISTINCT underlying with a
// validated positive out-of-sample edge. US big-four (micros excluded so ES/MES
// don't double-count the same S&P signal and inflate the record) plus the four
// internationals that held up out-of-sample (ASX, Euro Stoxx, Nikkei, TSX). This
// diversifies across trading sessions too — US, European, and Asia-Pacific
// indices don't all dip on the same day, which smooths the correlated-cluster
// risk of trading only US indices.
export const DAILY_AUTOTRADE_MARKETS = ['ES', 'NQ', 'YM', 'RTY', 'XJO', 'SX5E', 'N225', 'TSX'];

// Intraday ("Active" mode) auto-trade set = every DISTINCT market where the
// 15-minute strategy backtested profitably (PF ≥ 1.2 on ~60 days). US indices
// (S&P/Nasdaq/Russell) + European (Euro Stoxx, DAX) + Asian (Hang Seng) + Canada
// (TSX), plus crypto (BTC/ETH) and metals/energy futures (Silver, Crude) — many of
// which trade nearly 24/7, for round-the-clock signals. Excluded because they lost
// or broke even intraday: Dow, ASX, Nikkei, Nifty, Gold. Provisional (60d sample).
export const INTRADAY_AUTOTRADE_MARKETS = ['ES', 'NQ', 'RTY', 'SX5E', 'DAX', 'TSX', 'HSI', 'BTC', 'ETH', 'SI', 'CL'];

const defaultSettings = {
  // Default = 'daily' ("Proven"): the decade-validated Connors swing (10y +
  // walk-forward + out-of-sample). Reverted from 'intraday' after two weeks of
  // live losses on the Active mode — its ~60-day edge hasn't held up live, so the
  // safer, more-validated strategy is the honest default. Active stays one tap
  // away in Settings for users who want the higher-frequency, both-directions run.
  strategyMode: 'daily',
  // Trading style the user has picked (industry-standard, by holding period). Only
  // 'swing' is validated and live today; 'day'/'position' are in development and
  // 'scalping' needs a paid sub-minute feed — the Settings picker shows each one's
  // real status. Non-'swing' values fall back to swing for the actual engine.
  tradingStyle: 'swing',
  // Default auto-trade set matches the default (daily) mode's validated markets.
  paperMarkets: [...DAILY_AUTOTRADE_MARKETS],
  threshold: 75,
  riskPct: 1,
  // Reward:Risk for the first target (target distance ÷ stop distance). Lower =
  // higher win rate / smaller wins; higher = bigger wins / lower win rate.
  // Default 0.35 → ~74% geometric win rate (a buffer above the 70% target).
  targetRatio: 0.35,
  accountBalance: 25000,
  // Optional: risk 1.5x on high-conviction (deep RSI2<5) daily setups. Backtested
  // to improve return-per-unit-risk and Sharpe, but it deepens drawdowns too — a
  // genuine, double-edged tradeoff — so it's off by default.
  scaleByConviction: false,
  chartRange: '1D',
  chartType: 'candles',
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
  let set = !Array.isArray(pm) ? new Set(allSymbols) : new Set(pm.filter((s) => allSymbols.includes(s)));
  // Free tier: cap to one market. Pro (entitled) unlocks all.
  if (!isEntitled() && set.size > FREE_MARKET_LIMIT) set = new Set([...set].slice(0, FREE_MARKET_LIMIT));
  return set;
}

export function setPaperMarketEnabled(symbol, on, allSymbols) {
  // Free: one market at a time — enabling a market makes it THE one.
  if (on && !isEntitled()) { state.settings.paperMarkets = [symbol]; saveSettings(); return; }
  const cur = getEnabledPaperMarkets(allSymbols);
  if (on) cur.add(symbol); else cur.delete(symbol);
  state.settings.paperMarkets = [...cur];
  saveSettings();
}

export function setAllPaperMarkets(on, allSymbols) {
  if (on && !isEntitled()) { state.settings.paperMarkets = allSymbols.slice(0, FREE_MARKET_LIMIT); saveSettings(); return; }
  state.settings.paperMarkets = on ? [...allSymbols] : [];
  saveSettings();
}

// Replace the auto-trade set with an explicit list (used by the region presets).
export function setPaperMarkets(symbols) {
  state.settings.paperMarkets = isEntitled() ? [...symbols] : symbols.slice(0, FREE_MARKET_LIMIT);
  saveSettings();
}

export const state = {
  engine: createEngine(),
  accepted: localStorage.getItem(LS_ACCEPT) === '1',
  onboarded: localStorage.getItem('ajent_onboarded_v1') === '1',
  acks: { read: false, risk: false, terms: false, age: false },
  selectedSymbol: 'ES',
  homeSymbol: 'ES',
  homeWatchlist: ['ES', 'NQ', 'CL', 'GC', 'BTC', 'RTY'],
  watchlistCustomized: false,
  geoCountry: null,
  detailTab: 'signal',
  billing: 'annual',
  lastTab: 'home',
  settings: { ...defaultSettings, ...(loadSettings() || {}) },
  hasUnreadAlerts: true,
};

// The star = the Home watchlist. Starring a market adds it to the watchlist;
// un-starring removes it. Persisted so the user's list survives reloads, and
// once customised it takes precedence over the geo-based default list.
const LS_WATCHLIST = 'ajent_watchlist_v1';
try {
  const wl = JSON.parse(localStorage.getItem(LS_WATCHLIST));
  if (Array.isArray(wl)) {
    const valid = wl.filter((s) => state.engine.get(s));
    if (valid.length) { state.homeWatchlist = valid; state.watchlistCustomized = true; }
  }
} catch (e) { /* ignore */ }

export function isInWatchlist(symbol) {
  return state.homeWatchlist.includes(symbol);
}

export function toggleWatchlist(symbol) {
  if (!state.engine.get(symbol)) return false;
  const i = state.homeWatchlist.indexOf(symbol);
  const nowIn = i < 0;
  if (nowIn) state.homeWatchlist.push(symbol);
  else state.homeWatchlist.splice(i, 1);
  state.watchlistCustomized = true;
  try { localStorage.setItem(LS_WATCHLIST, JSON.stringify(state.homeWatchlist)); } catch (e) { /* ignore */ }
  return nowIn;
}

export function acceptDisclaimer() {
  state.accepted = true;
  localStorage.setItem(LS_ACCEPT, '1');
}

const LS_ONBOARD = 'ajent_onboarded_v1';
export function completeOnboarding() {
  state.onboarded = true;
  localStorage.setItem(LS_ONBOARD, '1');
}

export function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}
