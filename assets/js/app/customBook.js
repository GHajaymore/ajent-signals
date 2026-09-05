// Auto-paper-trades the user's OWN configured strategy over time, so "Your strategy"
// builds a real record (equity curve) to compare against Ajent — not just a live
// snapshot of which markets fire now. Long-only, RSI entry/exit per the user's
// config, with a simple protective stop. Virtual money, on this device; clearly the
// user's experiment, never presented as validated.
import { evalCustom, getCustomConfig } from './customStrategy.js';
import { perTradeRisk } from './state.js';

const LS = 'ajent_custombook_v1';
const STOP_FRAC = 0.04; // 4% protective stop (1R); keeps P&L apples-to-apples with a risk-$ size
const isReal = (m) => !!(m && (m.hasServerSignal || m.signalIsReal));

function load() {
  try { const b = JSON.parse(localStorage.getItem(LS)); if (b && b.open && Array.isArray(b.closed)) return b; } catch (e) { /* ignore */ }
  return { open: {}, closed: [] };
}
let book = load();
function save() { try { localStorage.setItem(LS, JSON.stringify(book)); } catch (e) { /* ignore */ } }

function closePos(m, price, reason) {
  const p = book.open[m.symbol];
  if (!p) return;
  const dir = p.dir || 1; // +1 long, -1 short
  const riskPerUnit = Math.abs(p.entry - p.stop) || 1e-9;
  const resultR = (dir * (price - p.entry)) / riskPerUnit;
  const pnl = Math.round(resultR * p.riskDollars);
  book.closed.unshift({ symbol: p.symbol, name: p.name, side: dir < 0 ? 'SHORT' : 'LONG', entry: p.entry, exit: price, resultR: +resultR.toFixed(3), pnl, riskDollars: p.riskDollars, outcome: pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even', reason, decimals: p.decimals, openedAt: p.openedAt, closedAt: Date.now() });
  if (book.closed.length > 300) book.closed.length = 300;
  delete book.open[m.symbol];
}

// Run one tick of the user's strategy across the board. Opens when the rule fires
// and there's no open position; exits on the user's RSI-recovery threshold or the
// protective stop. Returns true if anything changed.
export function runCustomStrategy(engine) {
  // Opt-in: only auto-trade once the user has actually configured a strategy, so we
  // never build a record for someone who never opened the builder.
  let hasConfig = false;
  try { hasConfig = !!localStorage.getItem('ajent_customstrat_v1'); } catch (e) { /* ignore */ }
  if (!hasConfig) return false;
  const cfg = getCustomConfig();
  let changed = false;
  for (const m of engine.markets) {
    if (!isReal(m)) continue;
    const e = evalCustom(m, cfg);
    if (!e.ready) continue;
    const price = m.price;
    if (!(price > 0)) continue;
    const pos = book.open[m.symbol];
    if (pos) {
      const long = (pos.dir || 1) > 0;
      // Exit on the protective stop, or when the user's own setup no longer holds in
      // this position's direction (a generic, indicator-agnostic exit).
      if (long ? price <= pos.stop : price >= pos.stop) { closePos(m, pos.stop, 'stop'); changed = true; }
      else if (long ? !e.longFires : !e.shortFires) { closePos(m, price, 'setupEnded'); changed = true; }
    } else if (e.fires) {
      const long = e.dir > 0;
      book.open[m.symbol] = { symbol: m.symbol, name: m.name, dir: e.dir, entry: price, stop: long ? price * (1 - STOP_FRAC) : price * (1 + STOP_FRAC), riskDollars: perTradeRisk(), decimals: m.decimals, openedAt: Date.now() };
      changed = true;
    }
  }
  if (changed) save();
  return changed;
}

export function customStats() {
  const c = book.closed;
  const wins = c.filter((t) => t.pnl > 0), losses = c.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const dec = wins.length + losses.length;
  return {
    net: c.reduce((s, t) => s + (t.pnl || 0), 0),
    trades: c.length, open: Object.keys(book.open).length,
    winRate: dec ? Math.round((wins.length / dec) * 100) : 0,
    pf: gl ? +(gw / gl).toFixed(2) : (gw > 0 ? null : 0),
    avgR: c.length ? +(c.reduce((s, t) => s + (t.resultR || 0), 0) / c.length).toFixed(2) : null,
  };
}

// Ajent's expectancy (avg R per closed trade) — the scale-independent fair metric to
// compare against the user's avgR.
export function ajentAvgR(closed) {
  if (!Array.isArray(closed) || !closed.length) return null;
  return +(closed.reduce((s, t) => s + (t.resultR || 0), 0) / closed.length).toFixed(2);
}

// Cumulative-P&L series (oldest→newest) for an equity sparkline.
export function customEquity() {
  const c = book.closed.slice().sort((a, b) => a.closedAt - b.closedAt);
  let eq = 0; const out = [0];
  for (const t of c) { eq += (t.pnl || 0); out.push(eq); }
  return out;
}

export function getCustomBook() { return book; }
export function resetCustomBook() { book = { open: {}, closed: [] }; save(); }
