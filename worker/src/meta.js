// SINGLE SOURCE OF TRUTH for the strategy's parameters. The worker computes signals
// from these, and serves them to the client (GET /signals → `strategy`), so every
// number the app shows ("RSI2 below 15", "RSI2 above 65", "2× ATR", "RSI-2") and the
// client's book-profit / stop logic derive from HERE — change the strategy in one
// place and the whole app follows. Never hardcode these values elsewhere.
export const STRATEGY = {
  key: 'swing',
  name: 'Ajent Pulse',        // the proven, branded "secret recipe" (validated default)
  proven: true,               // decade-backtested; the tracked record runs THIS
  adaptive: true,             // evolves in market-selection / sizing / regime filters
  version: 1,                 // core recipe bumps only on re-validation, not weekly tuning
  label: 'Swing · daily Connors RSI-2',
  indicator: 'RSI-2',        // the momentum oscillator the setup keys off
  indicatorPeriod: 2,
  direction: 'long',         // long-only (short mirror backtested as a loss)
  entryBelow: 15,            // enter when the indicator is below this (oversold flush)
  exitAbove: 65,             // book profit when it recovers above this (mean reached)
  deepBelow: 5,              // deepest / high-conviction tier
  stopAtrMult: 2,            // hard stop = this × ATR (base; the dial adapts within bounds)
  trendSma: 200,             // only trade with price above this SMA (trend filter)
  // Public, GENERALIZED description — what the strategy does, without the recipe.
  // The exact indicators/thresholds/stop above are the proprietary edge and are
  // NEVER sent to clients (see index.js /signals) or shown in the UI copy.
  approach: 'A momentum mean-reversion strategy: it buys markets stretched oversold within a healthy uptrend and exits as they revert toward the mean, capped by a volatility-based stop. Long-only, and it evolves from its own real record.',
};

// The public view of the strategy — safe to send to clients. Excludes the exact
// indicator/threshold/stop dials (the proprietary recipe).
export function publicStrategy(adaptive) {
  const s = STRATEGY;
  const a = adaptive || null;
  return {
    key: s.key, name: s.name, label: 'Momentum mean-reversion · daily',
    approach: s.approach, direction: s.direction, proven: s.proven,
    adaptive: s.adaptive, version: s.version,
    // Generalized adaptive state only — no raw dial values.
    adaptiveState: a ? { learning: !!a.learning, trades: a.trades || 0, winRate: a.winRate ?? null, retunedAt: (a.adopted && a.adopted.at) || null, nextRetune: a.nextRetune || null } : null,
  };
}
