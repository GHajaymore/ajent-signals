// The call for an OPEN position (Book profit / Cut / Hold / Ride the trend). The
// book-profit decision depends on the proprietary recipe, so the SERVER computes it and
// sends a derived `call` — the client never sees the raw indicator threshold. Until that
// arrives the client falls back to PUBLIC levels only (price vs the position's own stop).
// Paper positions are managed by the server (they close automatically on the next scan),
// so the pills describe what the RECORD will do, not an action the user takes. `tip` is
// an honest tooltip; the stop/target tips spell out the fill model (closes at the next
// scan's price, which can differ from the level — see the exit-fill note).
const CALL_MAP = {
  stopHit: { status: 'cut', label: 'Stop hit · closing', tone: 'var(--sell)', icon: 'ph-hand-palm', tip: 'Live price crossed the stop — the record closes this on the next scan (~5 min), at the price then (which can be past the stop).' },
  targetHit: { status: 'profit', label: 'Target hit · closing', tone: 'var(--buy)', icon: 'ph-flag-checkered', tip: 'Live price reached the target — the record books it on the next scan (~5 min), at the price then.' },
  profit: { status: 'profit', label: 'Book profit', tone: 'var(--buy)', icon: 'ph-flag-checkered', tip: 'The move has reverted — the strategy is likely to book this profit on the next scan.' },
  cut: { status: 'cut', label: 'Cut · stop', tone: 'var(--sell)', icon: 'ph-hand-palm', tip: 'Near the stop.' },
  trend: { status: 'hold', label: 'Ride the trend', tone: 'var(--flat)', icon: 'ph-trend-up', tip: 'Trend position — held with a trailing stop until the trend breaks.' },
  hold: { status: 'hold', label: 'Hold', tone: 'var(--flat)', icon: 'ph-hourglass-medium', tip: 'Open and holding — no exit condition met yet.' },
};

export function positionCall(market, pos) {
  const long = (pos.side || 'LONG') === 'LONG';
  const price = market ? (market.price ?? (market.signal && market.signal.price)) : null;
  // The client's live price (fast-polled every ~12s) is FRESHER than the server's last
  // scan, so a level crossed on the live price is the thing to surface — it overrides a
  // stale server 'call'. The position will close at the next server scan (≤5 min).
  if (price != null && pos.stop != null && (long ? price <= pos.stop : price >= pos.stop)) return CALL_MAP.stopHit;
  if (price != null && pos.target1 != null && (long ? price >= pos.target1 : price <= pos.target1)) return CALL_MAP.targetHit;
  // Otherwise show the server's book-profit / trend / hold guidance from the last scan.
  if (pos && pos.call && CALL_MAP[pos.call]) return CALL_MAP[pos.call];
  if (pos && pos.strat === 'trend') return CALL_MAP.trend;
  return CALL_MAP.hold;
}

function callInner(c) { return `<i class="ph-fill ${c.icon}"></i>${c.label}`; }
// Compact pill markup for a position row (keyed by symbol so it can be live-patched).
// Plain-language progress toward the target or stop for an open position — a jargon-free
// stand-in for the "R multiple" (target = 100% to target, stop = 100% to stop). This is
// what tells a user WHY a big price move can be a small $: a wide stop means the price is
// only a few % of the way there.
export function exitProgressText(p, price) {
  if (!p || typeof price !== 'number' || p.entry == null) return '';
  const long = (p.side || 'LONG') === 'LONG';
  const diff = long ? (price - p.entry) : (p.entry - price); // > 0 = winning
  if (Math.abs(diff) < Math.abs(p.entry) * 1e-6) return 'at entry';
  const span = diff > 0
    ? (p.target1 != null ? Math.abs(p.target1 - p.entry) : Math.abs(p.risk || 0))
    : (p.stop != null ? Math.abs(p.stop - p.entry) : Math.abs(p.risk || 0));
  if (!span) return '';
  const pct = Math.min(100, (Math.abs(price - p.entry) / span) * 100);
  const shown = pct < 1 ? '<1' : Math.round(pct);
  return `${shown}% to ${diff > 0 ? 'target' : 'stop'}`;
}

export function positionCallPill(market, pos) {
  const c = positionCall(market, pos);
  return `<span class="call-pill ${c.status}" data-call="${pos.symbol}"${c.tip ? ` title="${c.tip.replace(/"/g, '&quot;')}"` : ''}>${callInner(c)}</span>`;
}
// Re-evaluate and update an already-rendered pill in place (prices move → call moves).
export function updateCallPill(el, market, pos) {
  if (!el) return;
  const c = positionCall(market, pos);
  el.className = `call-pill ${c.status}`;
  if (c.tip) el.title = c.tip; else el.removeAttribute('title');
  el.innerHTML = callInner(c);
}
