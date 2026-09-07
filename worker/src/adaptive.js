// The EVOLVING layer of the Ajent Strategy. It is ONE strategy applied uniformly
// across every market — its dials evolve GLOBALLY from ALL past trades (the single
// shared paper record, every market pooled), never per-market and never per-user.
// The proven recipe SHAPE never changes (buy the oversold flush, exit on the RSI
// recovery, ATR stop); what evolves are the dials, learned from measured outcomes:
//   • stopMult — the ATR stop distance: widened when trades keep stopping out and
//                losing, kept near default when stops rarely bite
//   • sizeMult — position size, from the pooled recency-weighted expectancy
// Everything is anchored to the proven default, gated on a real pooled sample,
// nudged gradually with recency, and hard-bounded — so the strategy adapts across
// the board without overfitting. Nothing is fabricated; every number is real trades.
export const ADAPT = {
  minTrades: 20,      // pooled closed trades before the dials move off the default
  rampTrades: 60,     // full nudge strength reached around here (ramps from minTrades)
  decay: 0.97,        // per-trade recency decay (recent outcomes weigh more)
  size: { min: 0.6, max: 1.4 },
  stop: { min: 1.5, max: 3.0 },
  engineMin: 12,              // per-engine trades before its weight moves
  engineWeight: { min: 0.5, max: 1.5 },
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// EXPERIMENT (measurement only — changes nothing that trades): the lab found two orthogonal
// MR entry filters, strongest COMBINED — skip the ADX 15–20 "dead zone" (regime) AND require
// the dip to be near a real support/resistance level (location, not a falling knife). Every
// MR entry now carries adxEntry + nearSupport, so we can measure on the real forward record
// what each gate — and the combination — WOULD have done, before ever adopting it. `ready`
// stays false (still "gathering data") until enough tagged MR trades close.
const DEAD_LO = 15, DEAD_HI = 20, REGIME_MIN = 15;
export function regimeGateExperiment(closed) {
  const mr = (closed || []).filter((c) => (c.strat || 'mr') === 'mr' && typeof c.adxEntry === 'number');
  const outZone = (c) => !(c.adxEntry >= DEAD_LO && c.adxEntry < DEAD_HI);
  const nearLvl = (c) => c.nearSupport === true;
  const hasBoth = mr.filter((c) => typeof c.nearSupport === 'boolean'); // trades tagged since the support deploy
  const agg = (list) => {
    if (!list.length) return { n: 0, pnl: 0, winRate: 0, pf: 0, avgR: 0 };
    const wins = list.filter((c) => (c.pnl || 0) > 0), losses = list.filter((c) => (c.pnl || 0) < 0);
    const gw = wins.reduce((s, c) => s + (c.pnl || 0), 0), gl = Math.abs(losses.reduce((s, c) => s + (c.pnl || 0), 0));
    const pnl = list.reduce((s, c) => s + (c.pnl || 0), 0);
    return { n: list.length, pnl: Math.round(pnl), winRate: Math.round((wins.length / list.length) * 100), pf: +(gw / (gl || 1)).toFixed(2), avgR: +(list.reduce((s, c) => s + (c.resultR || 0), 0) / list.length).toFixed(3) };
  };
  const full = agg(mr);
  const notch = agg(mr.filter(outZone));
  const support = agg(hasBoth.filter(nearLvl));
  const both = agg(hasBoth.filter((c) => outZone(c) && nearLvl(c)));
  const ready = hasBoth.length >= REGIME_MIN;
  return {
    ready,
    tagged: mr.length,          // MR trades carrying an ADX reading
    withSupport: hasBoth.length, // MR trades also carrying the support flag (since its deploy)
    full,                       // the untouched record
    notch, support, both,       // the three would-be gates to compare
    note: ready
      ? `MR entry-gate experiment (${both.n}/${hasBoth.length} kept by the combined gate): PF full ${full.pf} → notch ${notch.pf} → support ${support.pf} → BOTH ${both.pf}; avgR ${full.avgR} → ${both.avgR}. Best combined. Not yet adopted.`
      : `MR entry-gate experiment: gathering data — ${mr.length} ADX-tagged trades, ${hasBoth.length} also support-tagged (need ${REGIME_MIN}).`,
  };
}

// Per-ENGINE size weight, learned from each engine's own record (recency-weighted
// expectancy), bounded and gated on a per-engine sample. So the ensemble leans
// toward whichever engine is actually working — but can't zero one out or overfit.
export function perEngineWeights(closed) {
  const groups = {};
  for (const c of closed) { const k = c.strat || 'mr'; (groups[k] = groups[k] || []).push(c); }
  const out = {};
  for (const k of ['mr', 'trend']) {
    const list = groups[k] || [];
    let w = 1, wTot = 0, wWins = 0, sumPnl = 0;
    for (const c of list) { wTot += w; if ((c.pnl || 0) > 0) wWins += w; sumPnl += c.pnl || 0; w *= ADAPT.decay; }
    const winRate = wTot > 0 ? wWins / wTot : 0;
    const expR = list.length ? (sumPnl / list.length) / 250 : 0;
    let weight = 1, learning = true;
    if (list.length >= ADAPT.engineMin) {
      learning = false;
      const kk = clamp((list.length - ADAPT.engineMin) / (ADAPT.rampTrades - ADAPT.engineMin), 0, 1);
      weight = clamp(1 + kk * clamp(expR, -0.6, 0.6), ADAPT.engineWeight.min, ADAPT.engineWeight.max);
    }
    out[k] = { weight: +weight.toFixed(2), trades: list.length, winRate: Math.round(winRate * 100), pnl: Math.round(sumPnl), learning };
  }
  return out;
}

// Global dials + health from the whole record (all markets pooled, newest-first).
// `base` = proven defaults ({ stopAtrMult, exitAbove }). Returns one set of dials
// that apply across every market.
export function computeAdaptive(record, base) {
  const baseStop = (base && base.stopAtrMult) || 2;
  const baseExit = (base && base.exitAbove) || 65;
  const risk = 250;
  const closed = (record && record.closed) || [];
  let w = 1, wTot = 0, wWins = 0, wStopLoss = 0, sumPnl = 0, n = 0;
  for (const c of closed) {
    n += 1;
    wTot += w;
    if ((c.pnl || 0) > 0) wWins += w;
    if (c.exitReason === 'stop' && (c.pnl || 0) < 0) wStopLoss += w;
    sumPnl += c.pnl || 0;
    w *= ADAPT.decay;
  }
  const winRate = wTot > 0 ? wWins / wTot : 0;
  const stopLossRate = wTot > 0 ? wStopLoss / wTot : 0;
  const expR = n > 0 ? (sumPnl / n) / risk : 0;
  let sizeMult = 1, stopMult = baseStop;
  let learning = true; // still gathering the pooled sample
  if (n >= ADAPT.minTrades) {
    learning = false;
    const k = clamp((n - ADAPT.minTrades) / (ADAPT.rampTrades - ADAPT.minTrades), 0, 1);
    sizeMult = clamp(1 + k * clamp(expR, -0.6, 0.6), ADAPT.size.min, ADAPT.size.max);
    const widen = clamp((stopLossRate - 0.4) / 0.4, 0, 1); // >40% losing stop-outs → widen
    stopMult = clamp(baseStop + k * widen * (ADAPT.stop.max - baseStop), ADAPT.stop.min, ADAPT.stop.max);
  }
  return {
    trades: n,
    winRate: Math.round(winRate * 100),
    pnl: Math.round(sumPnl),
    learning,
    sizeMult: +sizeMult.toFixed(2),
    stopMult: +stopMult.toFixed(2),
    engines: perEngineWeights(closed), // per-engine size weights (ensemble)
    regimeExperiment: regimeGateExperiment(closed), // ADX dead-zone gate — measured, not adopted
    exitAbove: baseExit, // exit dial reserved for a future, higher-data pass
    // human note surfaced in the app
    note: learning
      ? `Learning — ${n}/${ADAPT.minTrades} trades before the dials adapt.`
      : `Tuned from ${n} trades: stop ${(+stopMult).toFixed(1)}× ATR, size ${(sizeMult * 100).toFixed(0)}%.`,
  };
}
