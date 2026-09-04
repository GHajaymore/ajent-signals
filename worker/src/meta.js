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

// The public, display-safe view of ONE signal — an explicit ALLOWLIST, so a recipe
// field added to the internal signal later can never silently leak to the browser.
// Drops the raw indicator readings (rsi2, pctB), the trend-MA value, and the plan's
// hidden dials (exit threshold, stop/size multiples, hold cap, trail). Keeps only
// what the UI renders: verdict, price, confidence, a coarse conviction label, the
// trend direction, ATR (a generic public volatility measure the user's own custom
// strategy also uses), and the tradeable plan levels (entry / stop / target / risk).
const SIGNAL_PUBLIC = ['symbol', 'name', 'updatedAt', 'verdict', 'direction', 'price', 'confidence', 'conviction', 'htfTrend', 'atr', 'live', 'liveTime', 'prevClose', 'history', 'newsHold', 'strat'];
const PLAN_PUBLIC = ['entry', 'stop', 'target1', 'risk', 'riskReward'];
export function publicSignal(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const k of SIGNAL_PUBLIC) if (s[k] !== undefined) out[k] = s[k];
  if (s.plan && typeof s.plan === 'object') {
    const plan = {};
    for (const k of PLAN_PUBLIC) if (s.plan[k] !== undefined) plan[k] = s.plan[k];
    out.plan = plan;
  }
  return out;
}

// Strip recipe-revealing fields from a paper-trade position (open OR closed) before
// it leaves the server. A blocklist (positions carry many legit display fields —
// entry, stop, outcome, pnl…); these named fields are the only recipe leaks.
const POSITION_SECRET = ['exitAbove', 'exitRule', 'maxHoldMin', 'maxHoldBars', 'stopMult', 'sizeMult', 'rsi2', 'pctB', 'trendMA'];
// The exit-reason codes are also a display field, but some internal codes name the
// recipe ('rsiRecover', 'firstUpClose', 'rsi2Exit'). Collapse everything to a small
// PUBLIC vocabulary — anything that isn't a generic technique becomes 'exit' (booked
// on the strategy's own exit signal). This is the only value the client ever sees.
const EXIT_REASON_PUBLIC = { stop: 'stop', target: 'target', target1: 'target', timeStop: 'timeStop', time: 'timeStop', trailStop: 'trailStop', trail: 'trailStop' };
export function publicExitReason(code) { return EXIT_REASON_PUBLIC[code] || 'exit'; }
export function publicPosition(p) {
  if (!p || typeof p !== 'object') return p;
  const out = {};
  for (const k of Object.keys(p)) if (!POSITION_SECRET.includes(k)) out[k] = p[k];
  if (p.exitReason !== undefined) out.exitReason = publicExitReason(p.exitReason);
  return out;
}

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
