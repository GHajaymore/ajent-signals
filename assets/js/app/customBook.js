// Auto-paper-trades the user's OWN configured strategy over time, so "Your strategy"
// builds a real record (equity curve) to compare against Ajent — not just a live
// snapshot of which markets fire now. Long or short per the user's configured
// direction, with a simple protective stop. Virtual money, on this device; clearly the
// user's experiment, never presented as validated.
import { evalCustom, getCustomConfig, customTradesMarket } from './customStrategy.js';
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

// Run one tick of the user's strategy across the board. Behaviour depends on the
// configured MODE:
//  • 'auto'   — opens/closes positions automatically (builds a clean, unbiased edge
//               record to compare against Ajent). Existing positions are always managed.
//  • 'manual' — never auto-opens; on a FRESH fire it returns an alert so Ajent prompts
//               the user, who adds the trade their own way (with their own exit) into the
//               risk-gated "trade it your way" book. Existing auto-positions still exit.
// Market selection (cfg.markets) gates which markets it acts on. Returns { changed, fires }.
export function runCustomStrategy(engine) {
  // Opt-in: only run once the user has actually configured a strategy.
  let hasConfig = false;
  try { hasConfig = !!localStorage.getItem('ajent_customstrat_v1'); } catch (e) { /* ignore */ }
  if (!hasConfig) return { changed: false, fires: [] };
  const cfg = getCustomConfig();
  const manual = cfg.mode === 'manual';
  // Alerting behaviour: 'manual' = actionable prompts (you add the trade); 'fyi' = auto
  // trades AND sends an informational heads-up; 'none' = silent auto (no alerts).
  const alertMode = manual ? 'manual' : (cfg.notify ? 'fyi' : 'none');
  if (!book.fired) book.fired = {}; // per-symbol last-fired direction, for manual-mode dedup
  // On the tick the alerting behaviour is (re)enabled, suppress the alert for markets that
  // are ALREADY firing/opening — so the user isn't flooded for setups active before they
  // turned alerts on. Positions still open in auto; only the alert burst is held back.
  const seedTick = alertMode !== 'none' && book.lastAlertMode !== alertMode;
  let changed = false;
  const fires = [];
  for (const m of engine.markets) {
    if (!isReal(m)) continue;
    const e = evalCustom(m, cfg);
    if (!e.ready) continue;
    const price = m.price;
    if (!(price > 0)) continue;
    const pos = book.open[m.symbol];
    if (pos) {
      // Manage an existing position ALWAYS (even in manual mode or if the market was
      // later deselected) — never strand an open trade. Exit on the protective stop or
      // when the user's setup no longer holds in this position's direction.
      const long = (pos.dir || 1) > 0;
      if (long ? price <= pos.stop : price >= pos.stop) { closePos(m, pos.stop, 'stop'); changed = true; }
      else if (long ? !e.longFires : !e.shortFires) { closePos(m, price, 'setupEnded'); changed = true; }
      continue;
    }
    if (!customTradesMarket(cfg, m.symbol)) continue; // opening/alerting only on selected markets
    if (manual) {
      // Alert on a fresh fire (transition into firing), then remember it so we don't
      // re-alert every tick; reset once the setup stops firing. On the seed tick we
      // record the fire but skip the alert. Manual alerts are ACTIONABLE (fyi:false).
      const prevDir = book.fired[m.symbol] || 0;
      if (e.fires && e.dir !== prevDir) {
        if (!seedTick) fires.push({ symbol: m.symbol, name: m.name, dir: e.dir, price, decimals: m.decimals, confidence: e.confidence, fyi: false });
        book.fired[m.symbol] = e.dir; changed = true;
      } else if (!e.fires && prevDir) { book.fired[m.symbol] = 0; changed = true; }
    } else if (e.fires) {
      // AUTO: open the position (the record stays automatic). If notify is on, also emit
      // an INFORMATIONAL fire (fyi:true) — a heads-up, not a prompt to add anything.
      const long = e.dir > 0;
      book.open[m.symbol] = { symbol: m.symbol, name: m.name, dir: e.dir, entry: price, stop: long ? price * (1 - STOP_FRAC) : price * (1 + STOP_FRAC), riskDollars: perTradeRisk(), decimals: m.decimals, openedAt: Date.now() };
      changed = true;
      if (alertMode === 'fyi' && !seedTick) fires.push({ symbol: m.symbol, name: m.name, dir: e.dir, price, decimals: m.decimals, confidence: e.confidence, fyi: true });
    }
  }
  // Persist the alerting behaviour we just ran so the NEXT tick can tell when it was
  // (re)enabled (and seed silently then).
  if (book.lastAlertMode !== alertMode) { book.lastAlertMode = alertMode; changed = true; }
  if (changed) save();
  return { changed, fires };
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
