// STOCK SCREENER (Phase 2). The swing edge generalizes to stocks in AGGREGATE
// (test/phase2.mjs: pooled +0.11R / 67% win / 424 trades) but is noisy per-name, so
// the honest vehicle is a SCREENER: scan a diversified liquid universe and surface
// the names FIRING a signal right now, plus the ones closest. Signals ONLY — these
// are NOT auto-traded into the tracked record (single-name / earnings-gap risk needs
// guardrails first). Recipe is stripped before serving, same as /signals.
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';

// Diverse, liquid large caps across every sector (~60 names). A wider net = more
// setups firing on any given day, so the screener is useful more often. Yahoo tickers
// == symbols. The daily-only scan keeps the extra names cheap (one pass per calendar day).
export const STOCK_UNIVERSE = [
  // Tech & semis
  'AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD', 'CSCO', 'ORCL', 'CRM', 'ADBE', 'INTU', 'QCOM', 'TXN', 'IBM', 'NOW', 'MU', 'LRCX', 'AMAT',
  // Comms & internet
  'GOOGL', 'META', 'NFLX', 'DIS', 'CMCSA', 'T', 'VZ',
  // Consumer
  'AMZN', 'TSLA', 'WMT', 'COST', 'HD', 'LOW', 'PG', 'KO', 'PEP', 'MCD', 'SBUX', 'NKE', 'TGT', 'TJX',
  // Financials
  'JPM', 'BAC', 'WFC', 'MS', 'GS', 'V', 'MA', 'AXP', 'BLK', 'SCHW',
  // Health care
  'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'BMY',
  // Industrials & energy
  'CAT', 'GE', 'BA', 'HON', 'UNP', 'DE', 'LMT', 'RTX', 'XOM', 'CVX', 'COP',
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
          // proximity + a coarse conviction flag are display-safe; the raw RSI reading
          // (rsi2) is the recipe and is NEVER sent (guarded by test/no-recipe-leak).
          proximity: sig.proximity, htfTrend: sig.htfTrend, price,
          conviction: sig.plan && sig.plan.conviction === 'high' ? 'high' : 'normal',
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
