// Indicator-driven call for an OPEN position: what the strategy says to do now,
// read from the live indicators — Book profit (the oversold stretch has reverted:
// RSI2 back above 65 for a long), Cut (price at the risk level), or Hold. Honest:
// every call is a real indicator state, never a fabricated target. Long-only today,
// but the short mirror is handled for safety if it ever returns.
export function positionCall(market, pos) {
  const long = (pos.side || 'LONG') === 'LONG';
  const price = market ? (market.price ?? (market.signal && market.signal.price)) : null;
  const rsi = market && market.signal ? market.signal.rsi2 : null;
  if (price != null && (long ? price <= pos.stop : price >= pos.stop)) {
    return { status: 'cut', label: 'Cut · stop', tone: 'var(--sell)', icon: 'ph-hand-palm' };
  }
  if (typeof rsi === 'number' && (long ? rsi >= 65 : rsi <= 35)) {
    return { status: 'profit', label: 'Book profit', tone: 'var(--buy)', icon: 'ph-flag-checkered' };
  }
  return { status: 'hold', label: 'Hold', tone: 'var(--flat)', icon: 'ph-hourglass-medium' };
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
