// Best-effort "what market is popular where you are" personalization via free IP
// geolocation APIs (no login/account exists — this infers country from IP only).

const GEO_APIS = [
  { url: 'https://ipapi.co/json/', pick: (d) => d.country_code || d.country },
  { url: 'https://ipwho.is/', pick: (d) => d.country_code },
  { url: 'https://get.geojs.io/v1/ip/geo.json', pick: (d) => d.country_code },
];

// symbol = featured "top signal" market; watchlist = Home screen's 6-symbol list.
export const COUNTRY_DEFAULTS = {
  IN: { symbol: 'NIFTY', watchlist: ['NIFTY', 'BNF', 'SENSEX', 'GC', 'BTC', 'ES'] },
  GB: { symbol: 'FTSE', watchlist: ['FTSE', 'ES', 'GC', 'CL', 'BTC', 'DAX'] },
  DE: { symbol: 'DAX', watchlist: ['DAX', 'ES', 'GC', 'CL', 'BTC', 'SX5E'] },
  FR: { symbol: 'SX5E', watchlist: ['SX5E', 'DAX', 'ES', 'GC', 'BTC', 'CL'] },
  JP: { symbol: 'N225', watchlist: ['N225', 'ES', 'BTC', 'GC', 'CL', 'HSI'] },
  HK: { symbol: 'HSI', watchlist: ['HSI', 'SSE', 'ES', 'GC', 'BTC', 'CL'] },
  CN: { symbol: 'SSE', watchlist: ['SSE', 'HSI', 'ES', 'GC', 'BTC', 'CL'] },
  AU: { symbol: 'XJO', watchlist: ['XJO', 'ES', 'GC', 'CL', 'BTC', 'NQ'] },
  CA: { symbol: 'TSX', watchlist: ['TSX', 'ES', 'CL', 'GC', 'BTC', 'NQ'] },
  BR: { symbol: 'BVSP', watchlist: ['BVSP', 'ES', 'GC', 'CL', 'BTC', 'NQ'] },
  SG: { symbol: 'STI', watchlist: ['STI', 'HSI', 'ES', 'GC', 'BTC', 'CL'] },
  US: { symbol: 'ES', watchlist: ['ES', 'NQ', 'CL', 'GC', 'BTC', 'RTY'] },
};

const EUROZONE = new Set(['FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR']);

export function defaultsFor(countryCode) {
  if (!countryCode) return COUNTRY_DEFAULTS.US;
  const cc = countryCode.toUpperCase();
  if (COUNTRY_DEFAULTS[cc]) return COUNTRY_DEFAULTS[cc];
  if (EUROZONE.has(cc)) return COUNTRY_DEFAULTS.DE;
  return COUNTRY_DEFAULTS.US;
}

async function detectCountry() {
  for (const api of GEO_APIS) {
    try {
      const res = await fetch(api.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const code = api.pick(data);
      if (code) return code;
    } catch (e) { /* try next provider */ }
  }
  return null;
}

export async function applyGeoDefaults(state) {
  const code = await detectCountry();
  const { symbol, watchlist } = defaultsFor(code);
  state.homeSymbol = symbol;
  state.homeWatchlist = watchlist;
  state.selectedSymbol = symbol;
  state.geoCountry = code || 'US';
}
