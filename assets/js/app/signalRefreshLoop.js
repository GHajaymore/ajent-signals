// Periodically fetches real candles and recomputes real signals for every
// market. Runs on a slower cadence than live quotes since it's a heavier
// payload — indicators on 1h bars don't need second-by-second refresh anyway.
import { YAHOO_SYMBOL } from './liveData.js';
import { fetchCandles } from './candles.js';
import { fetchNews } from './news.js';
import { computeRealSignal } from './signalEngine.js';
import { COUNTRY_DEFAULTS } from './geo.js';

const SIGNAL_STALE_MS = 20 * 60 * 1000;

// Symbols that show up in some country's featured watchlist get computed
// first, so a first-time visitor's Home screen fills in with real signals
// quickly instead of waiting on ~35 symbols' worth of staggered fetches.
const PRIORITY_SYMBOLS = new Set(Object.values(COUNTRY_DEFAULTS).flatMap((d) => d.watchlist));

function orderedMarkets(engine) {
  const priority = [], rest = [];
  for (const m of engine.markets) (PRIORITY_SYMBOLS.has(m.symbol) ? priority : rest).push(m);
  return [...priority, ...rest];
}

function refreshAll(engine, stagger) {
  let i = 0;
  for (const market of orderedMarkets(engine)) {
    const ySym = YAHOO_SYMBOL[market.symbol];
    if (!ySym) continue;
    const delay = i++ * stagger;
    setTimeout(async () => {
      try {
        const candles = await fetchCandles(ySym);
        const news = await fetchNews(ySym).catch(() => []); // news is optional — never blocks a signal
        const signal = computeRealSignal(candles, market, market.rng, news);
        market.applyRealSignal(signal);
      } catch (e) {
        market.markSignalUnavailable(SIGNAL_STALE_MS);
      }
    }, delay);
  }
}

export function startSignalRefreshLoop(engine, { intervalMs = 5 * 60 * 1000, stagger = 1800 } = {}) {
  refreshAll(engine, stagger);
  return setInterval(() => refreshAll(engine, stagger), intervalMs);
}
