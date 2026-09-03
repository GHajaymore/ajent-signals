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

export function regionOfMarket(m) { return (m && m.category === 'Crypto') ? 'crypto' : (REGION_OF_COUNTRY[m && m.country] || 'americas'); }

// The active region: the user's explicit pick, else their geo region, else 'all'.
export function activeRegion() {
  const set = state.settings.region;
  if (set === 'all' || REGIONS.some((r) => r.key === set)) return set;
  return REGION_OF_COUNTRY[state.geoCountry] || 'all';
}

export function inActiveRegion(m) {
  const r = activeRegion();
  if (r === 'all') return true;
  return regionOfMarket(m) === r || (m && m.category === 'Crypto'); // crypto always shows
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
  return REGIONS.map((r) => chip(r.key, r.short, stat((m) => regionOfMarket(m) === r.key), active === r.key)).join('')
    + chip('all', 'ALL', stat(() => true), active === 'all');
}

// Standard wrapper + delegated click wiring, reused by both screens. `onChange` is
// called after the region setting is updated so the caller can re-render.
export function regionBarHtml(engine) {
  const chips = regionChipsHtml(engine);
  return `<div class="region-bar${chips ? '' : ' empty'}" id="region-bar">${chips}</div>`;
}
