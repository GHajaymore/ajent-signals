// Self-tuning layer for the Ajent confluence formula.
//
// After every completed paper trade, each indicator that took the trade's side
// is credited (if the trade won) or blamed (if it lost). Over time this builds
// a real hit-rate per indicator, and the confluence weights are nudged toward
// the factors that have actually been predicting correctly on THIS user's data.
//
// This is honest optimisation: it improves the formula from measured outcomes
// rather than hand-tuning or fabricating. It never guarantees profit — it just
// leans the score toward whatever has been working and away from what hasn't.
// Guardrails keep any single factor from dominating and require a minimum
// sample before it influences anything.

const LS_KEY = 'ajent_adaptive_v1';
const MIN_SAMPLE = 20;     // trades an indicator must have taken a side on first
const MIN_MULT = 0.6;      // a weak factor can be cut to 60% of its base weight
const MAX_MULT = 1.4;      // a strong factor can be boosted to 140%

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY));
    if (raw && raw.ind && typeof raw.ind === 'object') return raw;
  } catch (e) { /* ignore */ }
  return { ind: {} };
}

const store = load();

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
}

// indicators: [{ name, state }], side: 'LONG' | 'SHORT', won: boolean
export function recordOutcome(indicators, side, won) {
  const wantState = side === 'LONG' ? 'bull' : 'bear';
  for (const i of indicators || []) {
    if (i.state !== wantState) continue; // only judge factors that took this side
    const s = store.ind[i.name] || (store.ind[i.name] = { agreed: 0, wins: 0 });
    s.agreed += 1;
    if (won) s.wins += 1;
  }
  save();
}

// Per-indicator weight multiplier derived from its measured hit rate. Applied
// only once an indicator has enough samples; otherwise it stays at 1.0.
export function getMultipliers() {
  const out = {};
  for (const [name, s] of Object.entries(store.ind)) {
    if (!s || s.agreed < MIN_SAMPLE) { out[name] = 1; continue; }
    const acc = s.wins / s.agreed;               // hit rate when it took a side
    const m = 0.6 + acc * 0.9;                    // 50% -> 1.05, 70% -> 1.23, 30% -> 0.87
    out[name] = Math.max(MIN_MULT, Math.min(MAX_MULT, m));
  }
  return out;
}

export function getAdaptiveStats() {
  return Object.entries(store.ind).map(([name, s]) => ({
    name,
    samples: s.agreed,
    accuracy: s.agreed ? Math.round((s.wins / s.agreed) * 100) : null,
    calibrated: s.agreed >= MIN_SAMPLE,
  })).sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
}

export function resetAdaptive() {
  store.ind = {};
  save();
}
