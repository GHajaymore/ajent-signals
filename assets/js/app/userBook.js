// "Your book" — the user's OWN paper account, side by side with Ajent's record.
// The user takes a signal their own way (custom entry / stop / target / risk) and
// it's tracked here — a "how good are we vs how you'd trade it" comparison. Kept
// completely separate from Ajent's canonical record; never blended into it.
//
// Anonymous + per-browser for now (localStorage). When accounts land (Track B) this
// same shape moves server-side, keyed by user, so it syncs across devices. Still
// 100% simulated — no real orders, educational only.
import { perTradeRisk } from './state.js';

const LS = 'ajent_userbook_v1';

function load() {
  try { const b = JSON.parse(localStorage.getItem(LS)); if (b && b.open && Array.isArray(b.closed)) return b; } catch (e) { /* ignore */ }
  return { open: {}, closed: [] };
}
let book = load();
function save() { try { localStorage.setItem(LS, JSON.stringify(book)); } catch (e) { /* storage may be blocked */ } }

export function getUserBook() { return book; }
export function userTradeFor(symbol) { return book.open[symbol] || null; }

// Default the risk-per-trade to the user's own setting (account × risk%) so the
// comparison against Ajent is apples-to-apples (both size a trade by 1R = risk $).
export function defaultRiskDollars() { return perTradeRisk(); }

export function openUserTrade({ symbol, name, side = 'LONG', entry, stop, target, riskDollars, decimals = 2 }) {
  if (!(entry > 0) || !(stop > 0) || !(riskDollars > 0)) return false;
  const risk = Math.abs(entry - stop) || (entry * 0.004);
  book.open[symbol] = { symbol, name, side, entry, stop, target: target || null, risk, riskDollars: Math.round(riskDollars), decimals, openedAt: Date.now() };
  save();
  return true;
}

export function closeUserTrade(symbol, exitPrice, reason) {
  const p = book.open[symbol];
  if (!p || !(exitPrice > 0)) return;
  const long = p.side !== 'SHORT';
  const resultR = (long ? (exitPrice - p.entry) : (p.entry - exitPrice)) / (p.risk || 1e-9);
  const pnl = Math.round(resultR * p.riskDollars);
  book.closed.unshift({ symbol, name: p.name, side: p.side, entry: p.entry, exit: exitPrice, resultR: +resultR.toFixed(3), pnl, riskDollars: p.riskDollars, outcome: pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even', reason, decimals: p.decimals, openedAt: p.openedAt, closedAt: Date.now() });
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
    const long = p.side !== 'SHORT';
    if (long ? price <= p.stop : price >= p.stop) { closeUserTrade(p.symbol, p.stop, 'stop'); changed = true; }
    else if (p.target && (long ? price >= p.target : price <= p.target)) { closeUserTrade(p.symbol, p.target, 'target'); changed = true; }
  }
  return changed;
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
