// SINGLE SOURCE OF TRUTH for the strategy's parameters. The worker computes signals
// from these, and serves them to the client (GET /signals → `strategy`), so every
// number the app shows ("RSI2 below 15", "RSI2 above 65", "2× ATR", "RSI-2") and the
// client's book-profit / stop logic derive from HERE — change the strategy in one
// place and the whole app follows. Never hardcode these values elsewhere.
export const STRATEGY = {
  key: 'swing',
  name: 'Ajent Strategy',     // the proven, branded "secret recipe" (validated default)
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
};
