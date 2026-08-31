// Best-effort real quotes from a public, unofficial market-data endpoint, reached through
// free CORS proxies (no backend on this static site). NOT a licensed feed — see README note.
// Every symbol falls back to the existing simulator automatically if this is unavailable.
import { COUNTRY_DEFAULTS } from './geo.js';

// corsproxy first — it's the reliable one; allorigins is a fallback that is
// frequently unreachable. Order matters: the first that succeeds wins, so a
// dead proxy up front just adds a failed round-trip to every poll.
const PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

const YAHOO_SYMBOL = {
  // US index "futures" are sourced from their REAL-TIME cash index instead of
  // the =F future, which Yahoo delays ~15-25 min on the free tier. The cash
  // index tracks the front-month future within the fair-value basis (~0.2-0.5%),
  // so the signal is effectively real-time and free. Both the quote and the
  // candles come from this one stream, so there's no scale-mixing.
  ES: '^GSPC', MES: '^GSPC', NQ: '^NDX', MNQ: '^NDX', YM: '^DJI', RTY: '^RUT',
  CL: 'CL=F', NG: 'NG=F',
  GC: 'GC=F', SI: 'SI=F', HG: 'HG=F',
  ZN: 'ZN=F', ZB: 'ZB=F',
  BTC: 'BTC-USD', ETH: 'ETH-USD',
  VIX: '^VIX',
  ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F', KC: 'KC=F', SB: 'SB=F', CT: 'CT=F',
  EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X', USDCHF: 'USDCHF=X',
  AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', NZDUSD: 'NZDUSD=X', USDINR: 'USDINR=X',
  NIFTY: '^NSEI', BNF: '^NSEBANK', SENSEX: '^BSESN',
  FTSE: '^FTSE', DAX: '^GDAXI', N225: '^N225', HSI: '^HSI', SSE: '000001.SS',
  XJO: '^AXJO', TSX: '^GSPTSE', BVSP: '^BVSP', STI: '^STI', SX5E: '^STOXX50E',
};

const LIVE_STALE_MS = 5 * 60 * 1000;

async function fetchYahooQuote(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      // no-store is essential: without it the browser serves a cached response
      // and the price appears frozen (every poll returns the same quote).
      const res = await fetch(wrap(url), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('no quote in response');
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
      // regularMarketTime is the exchange timestamp of the quote. For free CME
      // futures data it's typically 15–25 min behind — we surface that as a
      // "Delayed" label rather than pretending it's live.
      return { price: meta.regularMarketPrice, prevClose, marketState: meta.marketState, quoteTime: meta.regularMarketTime };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all proxies failed');
}

// Markets that appear on someone's default Home watchlist get their real quote
// fetched first, so the screens a user actually sees turn real within ~1s
// instead of waiting behind all ~35 staggered requests.
const PRIORITY_SYMBOLS = new Set(Object.values(COUNTRY_DEFAULTS).flatMap((d) => d.watchlist || []));

function orderedMarkets(engine) {
  const priority = [], rest = [];
  for (const m of engine.markets) (PRIORITY_SYMBOLS.has(m.symbol) ? priority : rest).push(m);
  return [...priority, ...rest];
}

// Should the client fetch a live quote for this market?
//  - Non-server markets: yes, the client is the only price source.
//  - Server-driven crypto: yes — its feed has NO exchange delay, so a fresh
//    client quote makes the price truly real-time between server ticks.
//  - Server-driven futures/indices: no — those are exchange-delayed; leave them
//    to the Worker so we never imply a live quote we don't have.
function wantsClientQuote(market) {
  if (!market) return false;
  if (market.hasServerSignal) return market.category === 'Crypto';
  return true;
}

// Apply a fetched quote: a price-only overlay for server-driven crypto (keeps the
// Worker's signal), or a full client quote for non-server markets.
function applyQuote(market, price, prevClose, marketState, quoteTime) {
  if (market.hasServerSignal) {
    if (market.category === 'Crypto') market.applyServerPriceOverlay(price, prevClose, quoteTime);
  } else {
    market.applyLiveQuote(price, prevClose, marketState, quoteTime);
  }
}

function refreshAll(engine, stagger) {
  let i = 0;
  for (const market of orderedMarkets(engine)) {
    if (!wantsClientQuote(market)) continue; // leave delayed server markets to the Worker
    const ySym = YAHOO_SYMBOL[market.symbol];
    if (!ySym) continue;
    const delay = i++ * stagger;
    setTimeout(async () => {
      if (!wantsClientQuote(market)) return; // state changed since scheduling
      try {
        const { price, prevClose, marketState, quoteTime } = await fetchYahooQuote(ySym);
        if (wantsClientQuote(market)) applyQuote(market, price, prevClose, marketState, quoteTime);
      } catch (e) {
        if (!market.hasServerSignal) market.markLiveUnavailable(LIVE_STALE_MS);
      }
    }, delay);
  }
}

export function startLiveDataLoop(engine, { intervalMs = 15000, stagger = 120 } = {}) {
  refreshAll(engine, stagger);
  return setInterval(() => refreshAll(engine, stagger), intervalMs);
}

// Targeted refresh for just the symbols the user is currently looking at (the
// open detail chart, or the Home watchlist). Runs on ~15s — matched to how often
// the free feed actually refreshes a quote, so we don't spam the proxies with
// requests that return the same value. getFocusSymbols() is a callback so the
// caller can return whatever the current route is showing.
export function startFocusDataLoop(engine, getFocusSymbols, { intervalMs = 15000 } = {}) {
  const pump = () => {
    const syms = getFocusSymbols() || [];
    for (const sym of syms) {
      const fm = engine.get(sym);
      if (!wantsClientQuote(fm)) continue; // delayed server market — leave to the Worker
      const ySym = YAHOO_SYMBOL[sym];
      if (!ySym) continue;
      fetchYahooQuote(ySym)
        .then(({ price, prevClose, marketState, quoteTime }) => { const m = engine.get(sym); if (wantsClientQuote(m)) applyQuote(m, price, prevClose, marketState, quoteTime); })
        .catch(() => { /* slow sweep will retry / mark unavailable */ });
    }
  };
  pump();
  return setInterval(pump, intervalMs);
}

export { LIVE_STALE_MS, YAHOO_SYMBOL, fetchYahooQuote };
