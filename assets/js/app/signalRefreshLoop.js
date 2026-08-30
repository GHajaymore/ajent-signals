// Periodically fetches real candles and recomputes real signals for every
// market. Runs on a slower cadence than live quotes since it's a heavier
// payload — indicators on 1h bars don't need second-by-second refresh anyway.
import { state } from './state.js';
import { YAHOO_SYMBOL, fetchYahooQuote } from './liveData.js';
import { fetchCandles } from './candles.js';
import { fetchNews } from './news.js';
import { computeRealSignal } from './signalEngine.js';
import { COUNTRY_DEFAULTS } from './geo.js';

const SIGNAL_STALE_MS = 20 * 60 * 1000;

// Index markets sourced from the real-time cash index, paired with the front-
// month future whose price we actually want to display. We measure the basis
// (future − cash at the same instant) and add it to the cash feed so the market
// shows the future's level in real time. Micros share their parent's basis.
const FUTURE_FOR_BASIS = { ES: 'ES=F', MES: 'ES=F', NQ: 'NQ=F', MNQ: 'NQ=F', YM: 'YM=F', RTY: 'RTY=F' };

// future − cash, measured at the future quote's (delayed) timestamp by looking
// up the cash candle nearest that time. Basis is a slow-moving carry premium,
// so a ~5-min refresh is plenty. Returns null if it can't be measured.
async function measureBasis(futureSym, candles) {
  try {
    const { price: futPrice, quoteTime } = await fetchYahooQuote(futureSym);
    if (!Number.isFinite(futPrice) || !quoteTime || !candles.length) return null;
    let nearest = candles[candles.length - 1];
    let best = Infinity;
    for (const c of candles) {
      const d = Math.abs(c.t - quoteTime);
      if (d < best) { best = d; nearest = c; }
    }
    // Guard against a wild reading (e.g. a bad tick): a real index basis is a
    // small fraction of price. Ignore anything beyond ~3%.
    const basis = futPrice - nearest.c;
    if (Math.abs(basis) > nearest.c * 0.03) return null;
    return basis;
  } catch (e) {
    return null;
  }
}

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
    if (market.hasServerSignal) continue; // backend-driven — server signal wins
    const ySym = YAHOO_SYMBOL[market.symbol];
    if (!ySym) continue;
    const delay = i++ * stagger;
    setTimeout(async () => {
      if (market.hasServerSignal) return; // became backend-driven since scheduling
      try {
        // Daily swing strategy needs daily candles (2y for the 200-day trend);
        // intraday uses 15-minute bars over a month.
        const daily = state.settings.strategyMode === 'daily';
        const candles = await fetchCandles(ySym, daily ? { interval: '1d', range: '2y', minCandles: 210 } : {});
        // For cash-index-sourced markets, refresh the basis so the displayed
        // price tracks the real future, and shift the plan levels to match.
        const futureSym = FUTURE_FOR_BASIS[market.symbol];
        if (futureSym) {
          const basis = await measureBasis(futureSym, candles);
          if (basis != null) market.basis = basis;
        }
        const news = await fetchNews(ySym).catch(() => []); // news is optional — never blocks a signal
        const signal = computeRealSignal(candles, market, market.rng, news, { targetRatio: state.settings.targetRatio, mode: state.settings.strategyMode });
        if (market.basis) {
          const p = signal.plan;
          for (const k of ['entry', 'stop', 'target1', 'target2', 'target3']) p[k] += market.basis;
        }
        if (!market.hasServerSignal) market.applyRealSignal(signal);
      } catch (e) {
        if (!market.hasServerSignal) market.markSignalUnavailable(SIGNAL_STALE_MS);
      }
    }, delay);
  }
}

export function startSignalRefreshLoop(engine, { intervalMs = 5 * 60 * 1000, stagger = 1800 } = {}) {
  refreshAll(engine, stagger);
  return setInterval(() => refreshAll(engine, stagger), intervalMs);
}
