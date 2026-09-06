// "Your book" — the user's OWN paper account, side by side with Ajent's record.
// The user takes a signal their own way (custom entry / stop / target / risk) and
// it's tracked here — a "how good are we vs how you'd trade it" comparison. Kept
// completely separate from Ajent's canonical record; never blended into it.
//
// Anonymous + per-browser for now (localStorage). When accounts land (Track B) this
// same shape moves server-side, keyed by user, so it syncs across devices. Still
// 100% simulated — no real orders, educational only.
import { perTradeRisk, maxPortfolioRiskUsd, maxPortfolioRiskPct, maxDrawdownPct, state } from './state.js';

const LS = 'ajent_userbook_v1';

function load() {
  try { const b = JSON.parse(localStorage.getItem(LS)); if (b && b.open && Array.isArray(b.closed)) return b; } catch (e) { /* ignore */ }
  return { open: {}, closed: [] };
}
let book = load();
function save() { try { localStorage.setItem(LS, JSON.stringify(book)); } catch (e) { /* storage may be blocked */ } }

export function getUserBook() { return book; }
export function userTradeFor(symbol) { return book.open[symbol] || null; }
// A book entry is 'pending' (working order, not yet filled) or 'open' (filled position).
// Older entries saved before pending orders existed have no status → treat as 'open'.
export function isPending(p) { return p && p.status === 'pending'; }
export function pendingOrders() { return Object.values(book.open).filter(isPending); }
export function openPositions() { return Object.values(book.open).filter((p) => !isPending(p)); }

// Default the risk-per-trade to the user's own setting (account × risk%) so the
// comparison against Ajent is apples-to-apples (both size a trade by 1R = risk $).
export function defaultRiskDollars() { return perTradeRisk(); }

// --- Personal risk limits (YOUR book only; Ajent's shared record is untouched) -----
// Total $ currently at risk across open trades.
export function openRiskTotal() {
  return Object.values(book.open).reduce((s, p) => s + (Number(p.riskDollars) || 0), 0);
}
// Realized equity curve of your book: start at the account balance, apply each closed
// trade oldest→newest, and track the peak — so we can measure drawdown from that peak.
export function bookEquity() {
  const bal = Number(state.settings.accountBalance) || 0;
  const chron = [...book.closed].reverse(); // stored newest-first → oldest-first
  let eq = bal, peak = bal, trough = bal;
  for (const t of chron) { eq += (Number(t.pnl) || 0); if (eq > peak) peak = eq; if (eq < trough) trough = eq; }
  const ddPct = peak > 0 ? +(((eq - peak) / peak) * 100).toFixed(2) : 0; // ≤ 0
  return { equity: Math.round(eq), peak: Math.round(peak), ddPct };
}
// Decide whether a new copied trade of `newRisk` dollars is allowed under the user's
// limits. Returns { ok } or { ok:false, reason }. Off (0) limits never block.
export function riskGate(newRisk) {
  const dd = maxDrawdownPct();
  if (dd > 0) {
    const { ddPct } = bookEquity();
    if (ddPct <= -dd) return { ok: false, reason: `Your book is down ${Math.abs(ddPct).toFixed(1)}% — at your ${dd}% max-drawdown limit. New copied trades are paused until it recovers.`, kind: 'drawdown' };
  }
  const cap = maxPortfolioRiskUsd();
  if (cap > 0) {
    const after = openRiskTotal() + (Number(newRisk) || 0);
    if (after > cap) return { ok: false, reason: `That would put ${fmtUsd(after)} at risk across your open trades, over your ${maxPortfolioRiskPct()}% portfolio cap (${fmtUsd(cap)}).`, kind: 'portfolio' };
  }
  return { ok: true };
}
function fmtUsd(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

// Snapshot for the Paper-screen risk meter.
export function riskLimitsStatus() {
  const cap = maxPortfolioRiskUsd(), openRisk = openRiskTotal();
  const { equity, peak, ddPct } = bookEquity();
  const ddLimit = maxDrawdownPct();
  return {
    active: cap > 0 || ddLimit > 0,
    openRisk, cap, capPct: maxPortfolioRiskPct(),
    portfolioBreached: cap > 0 && openRisk > cap,
    ddPct, ddLimit, equity, peak,
    drawdownBreached: ddLimit > 0 && ddPct <= -ddLimit,
  };
}

export function openUserTrade({ symbol, name, side = 'LONG', entry, stop, target, riskDollars, decimals = 2, ajPlan = null, currentPrice = null }) {
  if (!(entry > 0) || !(stop > 0) || !(riskDollars > 0)) return false;
  const gate = riskGate(riskDollars);
  if (!gate.ok) return gate; // blocked by a personal risk limit — caller shows gate.reason
  const risk = Math.abs(entry - stop) || (entry * 0.004);
  const now = Date.now();
  // Fill-now vs PENDING (a working/limit order). If the entry is at the current market
  // (within a whisker) we fill immediately; otherwise the order WAITS and fills only when
  // price touches the entry from the side it's on now — like a real limit/stop order.
  const px = currentPrice > 0 ? currentPrice : entry;
  const atMarket = Math.abs(px - entry) <= entry * 0.0005;
  // ajPlan = Ajent's OWN suggested entry/stop/target for this signal, captured at placement
  // — a "shadow" trade we track alongside, so we can compare your levels vs Ajent's on the
  // exact same setup (head-to-head, selection held constant).
  const base = { symbol, name, side, entry, stop, target: target || null, risk, riskDollars: Math.round(riskDollars), decimals, placedAt: now, ajPlan: ajPlan && ajPlan.entry > 0 && ajPlan.stop > 0 ? ajPlan : null, ajResultR: null };
  book.open[symbol] = atMarket
    ? { ...base, status: 'open', openedAt: now }
    : { ...base, status: 'pending', fillDir: px > entry ? 'down' : 'up', openedAt: null };
  save();
  return true;
}

// Cancel a working (unfilled) order. Only pending orders can be cancelled; a filled
// position is closed with closeUserTrade instead.
export function cancelUserOrder(symbol) {
  const p = book.open[symbol];
  if (p && p.status === 'pending') { delete book.open[symbol]; save(); return true; }
  return false;
}
// Cancel every working (pending) order at once. Filled positions are untouched.
export function cancelAllPending() {
  let n = 0;
  for (const symbol of Object.keys(book.open)) if (book.open[symbol].status === 'pending') { delete book.open[symbol]; n++; }
  if (n) save();
  return n;
}

// Result-in-R of Ajent's shadow plan at a given price (its stop/target define its R).
function ajShadowR(ap, price, long) {
  const r = Math.abs(ap.entry - ap.stop) || 1e-9;
  return +(((long ? (price - ap.entry) : (ap.entry - price)) / r)).toFixed(3);
}

export function closeUserTrade(symbol, exitPrice, reason) {
  const p = book.open[symbol];
  if (!p || !(exitPrice > 0)) return;
  const long = p.side !== 'SHORT';
  const resultR = (long ? (exitPrice - p.entry) : (p.entry - exitPrice)) / (p.risk || 1e-9);
  const pnl = Math.round(resultR * p.riskDollars);
  // Ajent's shadow: use its resolved outcome if its own stop/target already hit,
  // else mark it to market at the same exit price (same-setup, head-to-head).
  let ajResultR = null;
  if (p.ajPlan) ajResultR = p.ajResultR != null ? p.ajResultR : ajShadowR(p.ajPlan, exitPrice, long);
  book.closed.unshift({ symbol, name: p.name, side: p.side, entry: p.entry, exit: exitPrice, resultR: +resultR.toFixed(3), pnl, riskDollars: p.riskDollars, outcome: pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even', reason, decimals: p.decimals, ajResultR, openedAt: p.openedAt, closedAt: Date.now() });
  if (book.closed.length > 200) book.closed.length = 200;
  delete book.open[symbol];
  save();
}

// Evaluate open user trades against live prices — auto-close on a stop or target hit,
// the same way Ajent's own record closes. Returns true if anything changed.
export function checkUserPositions(engine) {
  let changed = false;
  for (const p of Object.values(book.open)) {
    const m = engine.get ? engine.get(p.symbol) : null;
    const price = m && m.price;
    if (!(price > 0)) continue;
    // Pending (working) order: fills only when price TOUCHES the entry from the side it
    // was placed on. Until then it just waits — no stop/target management yet.
    if (p.status === 'pending') {
      const filled = p.fillDir === 'down' ? price <= p.entry : price >= p.entry;
      if (filled) { p.status = 'open'; p.openedAt = Date.now(); changed = true; }
      continue;
    }
    const long = p.side !== 'SHORT';
    // Resolve Ajent's shadow first if ITS stop/target hits (its outcome locks in even
    // if your own leg is still open) — so the head-to-head is true to each plan's path.
    if (p.ajPlan && p.ajResultR == null) {
      const ap = p.ajPlan;
      if (long ? price <= ap.stop : price >= ap.stop) { p.ajResultR = ajShadowR(ap, ap.stop, long); changed = true; }
      else if (ap.target && (long ? price >= ap.target : price <= ap.target)) { p.ajResultR = ajShadowR(ap, ap.target, long); changed = true; }
    }
    if (long ? price <= p.stop : price >= p.stop) { closeUserTrade(p.symbol, p.stop, 'stop'); changed = true; }
    else if (p.target && (long ? price >= p.target : price <= p.target)) { closeUserTrade(p.symbol, p.target, 'target'); changed = true; }
  }
  if (changed) save();
  return changed;
}

// Same-trade head-to-head: over closed trades where we have Ajent's shadow outcome,
// compare YOUR levels vs AJENT'S plan on the identical signal (selection held fixed).
export function headToHead() {
  const paired = book.closed.filter((t) => t.ajResultR != null && t.resultR != null);
  if (!paired.length) return null;
  const youR = paired.reduce((s, t) => s + t.resultR, 0) / paired.length;
  const ajR = paired.reduce((s, t) => s + t.ajResultR, 0) / paired.length;
  const youWon = paired.filter((t) => t.resultR > t.ajResultR).length;
  return { n: paired.length, youAvgR: +youR.toFixed(2), ajAvgR: +ajR.toFixed(2), youWon, trades: paired.slice(0, 6) };
}

// Unrealized P&L on an open user trade at the current price (for display).
export function unrealizedFor(p, price) {
  if (!p || !(price > 0)) return 0;
  const long = p.side !== 'SHORT';
  const resultR = (long ? (price - p.entry) : (p.entry - price)) / (p.risk || 1e-9);
  return Math.round(resultR * p.riskDollars);
}

export function userStats() {
  const c = book.closed;
  const wins = c.filter((t) => t.pnl > 0), losses = c.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const dec = wins.length + losses.length;
  return {
    net: c.reduce((s, t) => s + (t.pnl || 0), 0),
    trades: c.length, open: Object.keys(book.open).length,
    winRate: dec ? Math.round((wins.length / dec) * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? null : 0),
    // Expectancy: average result in R (per-trade, size- AND count-independent) — the
    // fair number at any scale, including a small account trading a few positions.
    avgR: c.length ? +(c.reduce((s, t) => s + (t.resultR || 0), 0) / c.length).toFixed(2) : null,
  };
}

export function resetUserBook() { book = { open: {}, closed: [] }; save(); }
