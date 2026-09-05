// Asset-class taxonomy — groups the fine-grained market categories into the broad
// classes a trader thinks in (Indices / ETFs / FX / Futures / Crypto). Shared by the
// Markets filter chips and the Track per-class performance breakdown so both agree.
import { state } from './state.js';

export const ASSET_GROUPS = [
  // 'index' covers the tradeable index contracts (US + global) — these are index
  // FUTURES here, so the label says so, distinct from the commodity/rate 'futures'
  // class and from cash ETFs. Only the label differs from a plain "Indices".
  { key: 'index', label: 'Index Futures', cats: ['Index', 'Global Index'] },
  { key: 'etf', label: 'ETFs', cats: ['Sector ETFs'] },
  { key: 'fx', label: 'FX', cats: ['Currencies'] },
  { key: 'futures', label: 'Futures', cats: ['Energy', 'Metals', 'Rates', 'Ags', 'Volatility'] },
  { key: 'crypto', label: 'Crypto', cats: ['Crypto'] },
];
export const ASSET_BY_KEY = Object.fromEntries(ASSET_GROUPS.map((g) => [g.key, g]));

// Which classes are validated/live vs. still an unproven experiment — drives the
// honest labelling on the per-class record. FX + the commodity 'futures' group are
// new both-ways MR cells (2026-09-04): validated in backtest but modest n, so they
// ship as EXPERIMENT until the forward record confirms. Never present them as proven.
export const PROVEN_CLASSES = new Set(['index', 'etf']);
export const EXPERIMENT_CLASSES = new Set(['crypto', 'fx', 'futures']);

const CAT_TO_GROUP = {};
for (const g of ASSET_GROUPS) for (const c of g.cats) CAT_TO_GROUP[c] = g.key;

// Asset-class key for a category name (e.g. 'Sector ETFs' → 'etf'), or null.
export function groupForCategory(cat) { return CAT_TO_GROUP[cat] || null; }

// Asset-class key for a market symbol, resolved via the engine's category. Returns
// null when the symbol isn't in the current universe (e.g. a delisted contract).
export function groupForSymbol(sym) {
  const m = state.engine && typeof state.engine.get === 'function' ? state.engine.get(sym) : null;
  return m ? groupForCategory(m.category) : null;
}

export function labelForKey(key) { return (ASSET_BY_KEY[key] && ASSET_BY_KEY[key].label) || 'Other'; }
