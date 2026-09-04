// STOCK SCREENER (Phase 2). The swing edge generalizes to stocks in AGGREGATE
// (test/phase2.mjs: pooled +0.11R / 67% win / 424 trades) but is noisy per-name, so
// the honest vehicle is a SCREENER: scan a diversified liquid universe and surface
// the names FIRING a signal right now, plus the ones closest. Signals ONLY — these
// are NOT auto-traded into the tracked record (single-name / earnings-gap risk needs
// guardrails first). Recipe is stripped before serving, same as /signals.
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';

// Diverse, liquid large caps (one+ per sector). Yahoo tickers == symbols.
export const STOCK_UNIVERSE = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'AVGO', 'AMD', 'CSCO', 'ORCL', 'CRM', 'ADBE',
  'JPM', 'BAC', 'V', 'MA', 'GS',
  'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'TMO',
  'XOM', 'CVX',
  'WMT', 'COST', 'HD', 'PG', 'KO', 'PEP', 'MCD', 'NKE',
  'CAT', 'GE', 'BA', 'DIS', 'NFLX',
];

// Scan the universe: compute the production swing signal for each name on its daily
// candles. Returns a compact row per name (recipe-free levels only).
export async function scanStocks(env) {
  const out = [];
  const BATCH = 6; // small parallel batches to stay within subrequest/time budgets
  for (let i = 0; i < STOCK_UNIVERSE.length; i += BATCH) {
    const chunk = STOCK_UNIVERSE.slice(i, i + BATCH);
    const rows = await Promise.all(chunk.map(async (sym) => {
      try {
        const { candles } = await fetchDailyCandles({ yahoo: sym, country: 'US' }, env);
        if (!candles || candles.length < 210) return null;
        const price = candles[candles.length - 1].c;
        const sig = computeSignal(candles, price);
        return {
          symbol: sym, name: sym, verdict: sig.verdict, confidence: sig.confidence,
          proximity: sig.proximity, rsi2: sig.rsi2, htfTrend: sig.htfTrend, price,
          // Levels only — exitAbove/stopMult are the proprietary recipe, never sent.
          plan: sig.plan ? { entry: sig.plan.entry, stop: sig.plan.stop, target1: sig.plan.target1, riskReward: sig.plan.riskReward } : null,
        };
      } catch (e) { return null; }
    }));
    out.push(...rows.filter(Boolean));
  }
  // Firing BUYs first, then closest-to-firing by proximity.
  out.sort((a, b) => ((b.verdict === 'BUY') - (a.verdict === 'BUY')) || (b.proximity - a.proximity));
  return out;
}
