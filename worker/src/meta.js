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
  approach: 'An adaptive ensemble of proven edges: it buys markets stretched oversold within a healthy uptrend (fading the dip) and rides markets in established uptrends (following the trend), exiting each as its setup completes, capped by a volatility-based stop. Long-only, and it evolves from its own real record.',
};

// Multi-asset foundation (Phase 0): recipe config per (assetClass × style) CELL.
// STRATEGY is the index/swing cell; Phase-1 cells (forex/swing, etf/swing…) add
// their own entries here once lab-validated. The Day experiment keeps its recipe
// in daytrade.js (isolated, unproven) — it isn't a proven cell, so it's not listed.
// See classes.js + docs/phase-0-multi-asset.md.
export const STRATEGIES = {
  'index/swing': STRATEGY,
};

// The recipe for a cell, falling back to the proven index/swing default so callers
// that don't (yet) pass a class/style keep working unchanged.
export function strategyFor(classKey = 'index', styleKey = 'swing') {
  return STRATEGIES[`${classKey}/${styleKey}`] || STRATEGY;
}

// The public view of a cell's strategy — safe to send to clients. Excludes the exact
// indicator/threshold/stop dials (the proprietary recipe). class/style default to
// index/swing so existing callers (`publicStrategy(a)`) are unaffected.
export function publicStrategy(adaptive, classKey = 'index', styleKey = 'swing') {
  const s = strategyFor(classKey, styleKey);
  const a = adaptive || null;
  return {
    key: s.key, name: s.name, label: s.publicLabel || 'Momentum mean-reversion · daily',
    approach: s.approach, direction: s.direction, proven: s.proven,
    adaptive: s.adaptive, version: s.version,
    // Generalized adaptive state — no raw recipe dials, but the portfolio-level
    // per-engine weights are fine to surface (they aren't the recipe).
    adaptiveState: a ? { learning: !!a.learning, trades: a.trades || 0, winRate: a.winRate ?? null, retunedAt: (a.adopted && a.adopted.at) || null, nextRetune: a.nextRetune || null, engines: a.engines || null } : null,
  };
}
