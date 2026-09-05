// Region lens — shared between Home and Markets. A VIEW filter only: it never
// changes what the engine trades (the tracked record stays globally diversified);
// it just scopes what the user sees. Crypto is 24/7 and global, so it shows in
// every region view. Defaults to the user's geo region.
import { state } from './state.js';
import { marketSession } from './marketHours.js';

const isReal = (m) => !!(m && (m.hasServerSignal || m.signalIsReal)); // inlined to avoid a cycle

export const REGION_OF_COUNTRY = { US: 'americas', CA: 'americas', BR: 'americas', EU: 'europe', DE: 'europe', FR: 'europe', GB: 'europe', JP: 'asia', AU: 'asia', HK: 'asia', CN: 'asia', SG: 'asia', IN: 'asia' };
export const REGIONS = [
  { key: 'americas', short: 'AMER', name: 'Americas' },
  { key: 'europe', short: 'EUR', name: 'Europe' },
  { key: 'asia', short: 'APAC', name: 'Asia-Pacific' },
];

// Global, non-regional markets — they trade 24h and aren't tied to one exchange's
// region, so they show in every region view (like crypto). A EUR/USD pair isn't
// "European" and Gold isn't American; only equity indices/ETFs are regional.
const GLOBAL_CATS = new Set(['Crypto', 'Currencies', 'Energy', 'Metals', 'Rates', 'Ags', 'Volatility']);
export function isGlobalMarket(m) { return !!(m && GLOBAL_CATS.has(m.category)); }
export function regionOfMarket(m) { return isGlobalMarket(m) ? 'global' : (REGION_OF_COUNTRY[m && m.country] || 'americas'); }

// The active region: the user views exactly ONE region at a time — their explicit pick,
// else their geo region, else Americas. There is no 'all' view; global markets (crypto,
// FX, commodities) show inside every region since they aren't tied to one exchange.
export function activeRegion() {
  const set = state.settings.region;
  if (REGIONS.some((r) => r.key === set)) return set;
  return REGION_OF_COUNTRY[state.geoCountry] || 'americas';
}

export function inActiveRegion(m) {
  const r = activeRegion();
  return regionOfMarket(m) === r || isGlobalMarket(m); // global markets always show
}

// The region-pulse chips: each region's live breadth + open/closed status; the
// active one highlighted. Returns just the chips (the caller wraps + wires clicks).
export function regionChipsHtml(engine) {
  const real = engine.markets.filter(isReal);
  if (real.length < 2) return '';
  const active = activeRegion();
  const stat = (pred) => { const ms = real.filter(pred); return { n: ms.length, up: ms.filter((m) => (m.changePct || 0) > 0).length, open: ms.some((m) => marketSession(m) === 'open') }; };
  const chip = (key, label, s, on) => {
    if (!s.n) return '';
    const lead = s.up >= s.n - s.up;
    return `<button class="rgn-chip${on ? ' on' : ''}" data-region="${key}" title="${label}: ${s.up} of ${s.n} up · ${s.open ? 'open' : 'closed'}">
      <span class="rgn-dot${s.open ? ' open' : ''}"></span><span class="rgn-lab">${label}</span>
      <span class="rgn-brd" style="color:${lead ? 'var(--buy)' : 'var(--sell)'}">${lead ? '▲' : '▼'}${s.up}/${s.n}</span>
    </button>`;
  };
  // One region at a time — no 'All' view. Global markets (crypto/FX/commodities) appear
  // inside whichever region is active, so nothing is hidden by dropping the overview.
  return REGIONS.map((r) => chip(r.key, r.short, stat((m) => regionOfMarket(m) === r.key), active === r.key)).join('');
}

// Standard wrapper + delegated click wiring, reused by both screens. `onChange` is
// called after the region setting is updated so the caller can re-render.
export function regionBarHtml(engine) {
  const chips = regionChipsHtml(engine);
  return `<div class="region-bar${chips ? '' : ' empty'}" id="region-bar">${chips}</div>`;
}
