// LIVE STRATEGY LAB — forward-tests candidate strategies on the SAME live signals as the
// proven engine, each into its OWN isolated shadow paper record, so we compare real forward
// performance before adopting anything (the honest way — see honest-numbers-constraint).
//
// Safety: fully ISOLATED (its own RECORD_LAB blob — NEVER touches the live RECORD), DEFENSIVE
// (every step is try/caught in the caller so a lab bug can't affect live trading), BATCHED
// (one KV write/tick), and it REUSES the candles the scheduler already fetched (no extra
// fetches). Candidates reuse the exact production maths (computeSignal/computeTrend +
// processPosition) at FIXED defaults (no adaptive dials) so the comparison is clean/reproducible.
import { computeSignal } from './strategy.js';
import { computeTrend, trendShouldExit } from './trend.js';
import { mrShouldExit, processPosition } from './scheduler.js';
import { volSizeMult } from './indicators.js';

const PB30 = 0.30, PB20 = 0.20;
// The forward-test slate. Each answers a real question:
//   full      — MR + trend (the CURRENT live config) → the reference.
//   mrOnly    — MR dip-buyer only → does the trend leg earn its lower win rate?
//   mrTightPb — MR with a tighter %B<0.20 → is quality-over-quantity better live?
//   mrSupport — MR + support-proximity filter → does the strong-but-unadopted filter add value?
//   volScaled — full ensemble but position size scaled INVERSELY to volatility (small in high-vol
//               crash regimes, full when calm), scoped to non-FX. Backtest validated it beats flat
//               sizing on equities+commodities over a full cycle (defends 2018/2020/2022 crashes)
//               while the current adaptive dial is procyclical. This forward-tests it live before
//               any recipe change. See [[ajent-strategy-filter-candidates]] / honest-numbers.
//   trendPartial — full ensemble but the TREND leg books HALF the position at the 1R target and
//               rides the other half on the trailing stop (a "scale-out"). Answers: does locking in
//               a partial at target beat letting the whole trend position ride? Tests the classic
//               take-some-off-the-table tradeoff live (locks gains earlier vs. gives up runner
//               upside). Modelled as two half-size trend slots so it reuses the production maths.
export const LAB_CANDIDATES = [
  { key: 'full', label: 'Full ensemble (MR + trend)', pb: PB30, support: false, trend: true },
  { key: 'mrOnly', label: 'MR-only', pb: PB30, support: false, trend: false },
  { key: 'mrTightPb', label: 'MR · %B < 0.20', pb: PB20, support: false, trend: false },
  { key: 'mrSupport', label: 'MR · at support', pb: PB30, support: true, trend: false },
  { key: 'volScaled', label: 'Full · vol-scaled size', pb: PB30, support: false, trend: true, volScale: true },
  { key: 'trendPartial', label: 'Full · book ½ at target', pb: PB30, support: false, trend: true, partial: true },
  // Mirrors the CURRENT LIVE config (trend leg paused 2026-10-06 + vol-scaled sizing): MR dip-buyer
  // only, non-FX positions vol-scaled. This is the live A/B anchor — compare vs `mrOnly` (does
  // vol-scaling still help the MR engine forward?) and vs `full` (confirm dropping trend was right).
  { key: 'mrOnlyVol', label: 'MR-only · vol-scaled (LIVE)', pb: PB30, support: false, trend: false, volScale: true },
];

// Defensive vol-scaled size dial (0.4–1.0) is now shared from indicators.js (volSizeMult) — the
// SAME function the live scheduler adopted, so the lab's `volScaled` candidate stays a faithful
// A/B of the live sizing.

// Apply a candidate's entry gate to the shared MR signal. Crypto keeps the full recipe (edge
// reverses there), exactly like the live engine.
function gateMr(sig, meta, c) {
  if (sig.verdict !== 'BUY') return sig;
  const veto = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
  if (!meta.crypto && typeof sig.pctB === 'number' && sig.pctB >= c.pb) return veto;
  if (c.support && sig.plan && sig.plan.nearSupport === false) return veto;
  return sig;
}

// Scale-out exit for the trendPartial "scalp" half: take profit the moment price reaches the 1R
// target, otherwise fall back to the normal trend exit (trailing/hard/time stop) so the downside
// is protected exactly like the runner half. Trend is long-only in production, but kept side-aware.
function scalpTrendExit(sig, pos, price, now) {
  const long = pos.side !== 'SHORT';
  if (pos.target1 != null && (long ? price >= pos.target1 : price <= pos.target1)) return 'target';
  return trendShouldExit(sig, pos, price, now);
}

// Fresh per-candidate shadow record. openTrendScalp/lastCloseTrendScalp hold the trendPartial
// scale-out half (a second trend slot); harmless/empty for every other candidate.
function blankRec() { return { open: {}, openTrend: {}, openTrendScalp: {}, closed: [], lastClose: {}, lastCloseTrend: {}, lastCloseTrendScalp: {} }; }

// Run ONE market through EVERY candidate. `candles` are the scheduler's already-fetched daily
// bars; `live` the fresh quote; `meta` the market. Mutates `lab.cand`.
export function labStep(lab, symbol, candles, live, meta, now, risk, cost) {
  if (!candles || candles.length < 210) return;
  const mrSig = computeSignal(candles, live);
  const trendSig = computeTrend(candles, live);
  // Vol-scaled dial for the volScaled candidate, scoped to NON-FX (equities/commodities/crypto),
  // where the backtest validated it. FX excluded — vol-scaling hurt it there. Computed once/market.
  const volMult = (meta.cell === 'fx') ? 1 : volSizeMult(candles);
  for (const c of LAB_CANDIDATES) {
    const rec = lab.cand[c.key] || (lab.cand[c.key] = blankRec());
    if (!rec.openTrendScalp) { rec.openTrendScalp = {}; rec.lastCloseTrendScalp = {}; } // upgrade older blobs
    const dials = c.volScale ? { sizeMult: volMult } : null;
    processPosition({ symbol, meta, sig: gateMr(mrSig, meta, c), live, open: true, record: rec, now, risk, cost, dials, strat: 'mr', shouldExit: mrShouldExit });
    if (c.trend && c.partial) {
      // Two half-size trend slots: runner rides the trailing stop; scalp books at the 1R target.
      const half = { sizeMult: 0.5 };
      processPosition({ symbol, meta, sig: trendSig, live, open: true, record: rec, now, risk, cost, dials: half, strat: 'trend', shouldExit: trendShouldExit, openMap: rec.openTrend, lastCloseMap: rec.lastCloseTrend });
      processPosition({ symbol, meta, sig: trendSig, live, open: true, record: rec, now, risk, cost, dials: half, strat: 'trend', shouldExit: scalpTrendExit, openMap: rec.openTrendScalp, lastCloseMap: rec.lastCloseTrendScalp });
    } else if (c.trend) {
      processPosition({ symbol, meta, sig: trendSig, live, open: true, record: rec, now, risk, cost, dials, strat: 'trend', shouldExit: trendShouldExit, openMap: rec.openTrend, lastCloseMap: rec.lastCloseTrend });
    }
    if (rec.closed.length > 200) rec.closed.length = 200; // keep the blob bounded
  }
}

// Public forward-performance summary per candidate (recipe-free — only outcomes).
export function labSummary(lab) {
  const days = lab.startedAt ? Math.max(0, (Date.now() - lab.startedAt) / 86400000) : 0;
  return {
    startedAt: lab.startedAt || null,
    days: +days.toFixed(1),
    note: 'Live forward-test — each candidate paper-trades the same signals into its own shadow record. Not adopted; the forward record decides. Hypothetical, virtual money.',
    candidates: LAB_CANDIDATES.map((c) => {
      const rec = lab.cand[c.key] || blankRec();
      const closed = rec.closed || [];
      const wins = closed.filter((t) => t.pnl > 0);
      const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
      let eq = 0, pk = 0, dd = 0;
      for (const t of closed.slice().sort((a, b) => (a.closedAt || 0) - (b.closedAt || 0))) { eq += t.pnl; pk = Math.max(pk, eq); dd = Math.min(dd, eq - pk); }
      // Open positions, recipe-STRIPPED (only levels the client already sees for the live
      // record) so the client can mark them to its own fresh prices for a live unrealized read.
      const positions = [...Object.values(rec.open), ...Object.values(rec.openTrend || {}), ...Object.values(rec.openTrendScalp || {})]
        .map((p) => ({ symbol: p.symbol, side: p.side, entry: p.entry, risk: p.risk, riskDollars: p.riskDollars, strat: p.strat }));
      return {
        key: c.key, label: c.label,
        trades: closed.length,
        open: positions.length,
        net: Math.round(eq),
        winRate: closed.length ? Math.round((wins.length / closed.length) * 100) : 0,
        profitFactor: +(gw / (gl || 1)).toFixed(2),
        maxDrawdown: Math.round(dd),
        positions,
      };
    }),
  };
}
