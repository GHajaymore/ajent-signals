// The call for an OPEN position (Book profit / Cut / Hold / Ride the trend). The
// book-profit decision depends on the proprietary recipe, so the SERVER computes it and
// sends a derived `call` — the client never sees the raw indicator threshold. Until that
// arrives the client falls back to PUBLIC levels only (price vs the position's own stop).
const CALL_MAP = {
  profit: { status: 'profit', label: 'Book profit', tone: 'var(--buy)', icon: 'ph-flag-checkered' },
  cut: { status: 'cut', label: 'Cut · stop', tone: 'var(--sell)', icon: 'ph-hand-palm' },
  trend: { status: 'hold', label: 'Ride the trend', tone: 'var(--flat)', icon: 'ph-trend-up' },
  hold: { status: 'hold', label: 'Hold', tone: 'var(--flat)', icon: 'ph-hourglass-medium' },
};

export function positionCall(market, pos) {
  if (pos && pos.call && CALL_MAP[pos.call]) return CALL_MAP[pos.call];
  const long = (pos.side || 'LONG') === 'LONG';
  const price = market ? (market.price ?? (market.signal && market.signal.price)) : null;
  if (price != null && (long ? price <= pos.stop : price >= pos.stop)) return CALL_MAP.cut;
  if (pos && pos.strat === 'trend') return CALL_MAP.trend;
  return CALL_MAP.hold;
}

function callInner(c) { return `<i class="ph-fill ${c.icon}"></i>${c.label}`; }
// Compact pill markup for a position row (keyed by symbol so it can be live-patched).
export function positionCallPill(market, pos) {
  const c = positionCall(market, pos);
  return `<span class="call-pill ${c.status}" data-call="${pos.symbol}">${callInner(c)}</span>`;
}
// Re-evaluate and update an already-rendered pill in place (prices move → call moves).
export function updateCallPill(el, market, pos) {
  if (!el) return;
  const c = positionCall(market, pos);
  el.className = `call-pill ${c.status}`;
  el.innerHTML = callInner(c);
}
