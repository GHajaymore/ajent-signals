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

const PB30 = 0.30, PB20 = 0.20;
// The forward-test slate. Each answers a real question:
//   full      — MR + trend (the CURRENT live config) → the reference.
//   mrOnly    — MR dip-buyer only → does the trend leg earn its lower win rate?
//   mrTightPb — MR with a tighter %B<0.20 → is quality-over-quantity better live?
//   mrSupport — MR + support-proximity filter → does the strong-but-unadopted filter add value?
export const LAB_CANDIDATES = [
  { key: 'full', label: 'Full ensemble (MR + trend)', pb: PB30, support: false, trend: true },
  { key: 'mrOnly', label: 'MR-only', pb: PB30, support: false, trend: false },
  { key: 'mrTightPb', label: 'MR · %B < 0.20', pb: PB20, support: false, trend: false },
  { key: 'mrSupport', label: 'MR · at support', pb: PB30, support: true, trend: false },
];

// Apply a candidate's entry gate to the shared MR signal. Crypto keeps the full recipe (edge
// reverses there), exactly like the live engine.
function gateMr(sig, meta, c) {
  if (sig.verdict !== 'BUY') return sig;
  const veto = { ...sig, verdict: 'NO_TRADE', direction: 0, plan: null };
  if (!meta.crypto && typeof sig.pctB === 'number' && sig.pctB >= c.pb) return veto;
  if (c.support && sig.plan && sig.plan.nearSupport === false) return veto;
  return sig;
}

// Fresh per-candidate shadow record.
function blankRec() { return { open: {}, openTrend: {}, closed: [], lastClose: {}, lastCloseTrend: {} }; }

// Run ONE market through EVERY candidate. `candles` are the scheduler's already-fetched daily
// bars; `live` the fresh quote; `meta` the market. Mutates `lab.cand`.
export function labStep(lab, symbol, candles, live, meta, now, risk, cost) {
  if (!candles || candles.length < 210) return;
  const mrSig = computeSignal(candles, live);
  const trendSig = computeTrend(candles, live);
  for (const c of LAB_CANDIDATES) {
    const rec = lab.cand[c.key] || (lab.cand[c.key] = blankRec());
    processPosition({ symbol, meta, sig: gateMr(mrSig, meta, c), live, open: true, record: rec, now, risk, cost, strat: 'mr', shouldExit: mrShouldExit });
    if (c.trend) processPosition({ symbol, meta, sig: trendSig, live, open: true, record: rec, now, risk, cost, strat: 'trend', shouldExit: trendShouldExit, openMap: rec.openTrend, lastCloseMap: rec.lastCloseTrend });
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
      const positions = [...Object.values(rec.open), ...Object.values(rec.openTrend || {})]
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
