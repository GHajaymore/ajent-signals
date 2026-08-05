// Real (paper) trade tracking — no real money, no broker, no execution.
// Whenever a market's REAL (indicator-computed, not simulated) signal crosses
// the confidence threshold, a hypothetical position is opened at the plan's
// entry/stop/target1. It's closed the moment live price actually reaches
// either level, and the outcome is recorded permanently. This is what lets
// the app report a genuine, evolving win rate instead of an illustrative one.
const LS_KEY = 'ajent_paper_trades_v1';
const MAX_CLOSED = 300;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          open: parsed.open || {},
          closed: Array.isArray(parsed.closed) ? parsed.closed : [],
          lastClosedSignalAt: parsed.lastClosedSignalAt || {},
        };
      }
    }
  } catch (e) { /* ignore malformed storage */ }
  return { open: {}, closed: [], lastClosedSignalAt: {} };
}

const store = load();

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* storage full/unavailable — keep running in-memory */ }
}

// A trade is "high conviction" when a strong majority of the eight indicators
// line up with the direction (>=5 of 8) — not just a bare threshold clear.
function isHighConviction(signal, verdict) {
  const c = signal.confluence || {};
  const total = (c.bull || 0) + (c.bear || 0) + (c.neutral || 0) || 1;
  const agree = verdict === 'BUY' ? (c.bull || 0) : (c.bear || 0);
  return agree / total >= 0.6;
}

export function maybeOpenPositions(engine, threshold, riskDollars = 250, enabled = null) {
  for (const market of engine.markets) {
    // Only auto-trade markets the user opted into (null = all markets).
    if (enabled && !enabled.has(market.symbol)) continue;
    if (!market.signalIsReal) continue;
    if (store.open[market.symbol]) continue;
    const verdict = market.verdict(threshold);
    if (verdict === 'NO_TRADE') continue;
    const s = market.signal;
    // Selectivity: only take high-conviction setups where a strong majority of
    // the indicators agree with the trade direction. This isn't a guarantee of
    // profit — no signal is — it just avoids paper-trading marginal, conflicted
    // setups that barely cleared the threshold.
    if (!isHighConviction(s, verdict)) continue;
    // A position can only be opened once per signal generation — otherwise a
    // stale signal (unchanged for up to 5 min between real recomputes) whose
    // price has already reached its target/stop would reopen and immediately
    // re-close on every single tick, spamming alerts and fabricating wins.
    if (store.lastClosedSignalAt[market.symbol] === s.createdAt) continue;
    store.open[market.symbol] = {
      symbol: market.symbol,
      name: market.name,
      side: verdict === 'BUY' ? 'LONG' : 'SHORT',
      entry: s.plan.entry,
      stop: s.plan.stop,
      target1: s.plan.target1,
      riskReward: s.plan.riskReward,
      // Initial risk distance and a break-even flag drive stop management below.
      risk: Math.abs(s.plan.entry - s.plan.stop),
      beMoved: false,
      confidence: s.confidence,
      decimals: market.decimals,
      // Virtual dollars staked on this trade — captured at open so the recorded
      // outcome is a real dollar figure, not an abstract multiple.
      riskDollars: Math.max(1, Math.round(riskDollars)),
      openedAt: Date.now(),
      signalCreatedAt: s.createdAt,
    };
  }
  save();
}

export function checkOpenPositions(engine, onAlert) {
  for (const symbol of Object.keys(store.open)) {
    const pos = store.open[symbol];
    const market = engine.get(symbol);
    if (!market) continue;
    const price = market.price;
    const isLong = pos.side === 'LONG';
    const risk = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;

    // Break-even management: once the trade is +1R in our favor, pull the stop
    // up to entry so a winner that reverses scratches at ~$0 instead of a full
    // loss. Genuine risk management — it lowers the damage of failed trades.
    if (!pos.beMoved) {
      const oneRLevel = isLong ? pos.entry + risk : pos.entry - risk;
      const reached = isLong ? price >= oneRLevel : price <= oneRLevel;
      if (reached) { pos.stop = pos.entry; pos.beMoved = true; }
    }

    const hitTarget = isLong ? price >= pos.target1 : price <= pos.target1;
    const hitStop = isLong ? price <= pos.stop : price >= pos.stop;
    if (!hitTarget && !hitStop) continue;

    let outcome, resultR;
    if (hitTarget) { outcome = 'Win'; resultR = pos.riskReward; }
    else if (pos.beMoved) { outcome = 'Break-even'; resultR = 0; }
    else { outcome = 'Loss'; resultR = -1; }

    const riskDollars = pos.riskDollars || 250;
    const pnl = Math.round(resultR * riskDollars);
    const holdMin = Math.max(1, Math.round((Date.now() - pos.openedAt) / 60000));

    store.closed.unshift({
      symbol, name: pos.name, side: pos.side, entry: pos.entry, exit: price,
      resultR, pnl, riskDollars, outcome, holdMin, decimals: pos.decimals, closedAt: Date.now(),
    });
    if (store.closed.length > MAX_CLOSED) store.closed.length = MAX_CLOSED;
    store.lastClosedSignalAt[symbol] = pos.signalCreatedAt;
    delete store.open[symbol];

    if (onAlert) {
      const money = `${pnl >= 0 ? '+$' : '-$'}${Math.abs(pnl).toLocaleString('en-US')}`;
      const title = hitTarget ? 'Target hit' : (pos.beMoved ? 'Closed at break-even' : 'Stopped out');
      onAlert({
        type: hitTarget ? 'TARGET' : 'STOP',
        symbol,
        title: `${title} · ${symbol}`,
        body: `${pos.name} paper ${pos.side.toLowerCase()} closed for ${money} (virtual). No real money involved.`,
        ts: Date.now(),
      });
    }
  }
  save();
}

export function getClosedTrades() { return store.closed; }
export function getOpenPositions() { return Object.values(store.open); }
export function getOpenCount() { return Object.keys(store.open).length; }

// Wipe all paper-trading history and open positions (a user-facing reset).
export function resetPaperTrades() {
  store.open = {};
  store.closed = [];
  store.lastClosedSignalAt = {};
  save();
}

// Dollar P&L for a closed trade, tolerant of older records saved before we
// tracked dollars (fall back to a nominal $250 stake per unit of risk).
function tradePnl(c) {
  if (Number.isFinite(c.pnl)) return c.pnl;
  return Math.round((c.resultR || 0) * (c.riskDollars || 250));
}

export function getPerformanceSummary() {
  const closed = store.closed;
  if (closed.length === 0) return null;

  const winTrades = closed.filter((c) => tradePnl(c) > 0);
  const lossTrades = closed.filter((c) => tradePnl(c) < 0);
  const wins = winTrades.length;
  const losses = lossTrades.length;
  const decisive = wins + losses; // break-even scratches don't count for/against
  const winRate = decisive ? Math.round((wins / decisive) * 100) : 0;
  const totalPnl = closed.reduce((s, c) => s + tradePnl(c), 0);
  const avgWin = wins ? Math.round(winTrades.reduce((s, c) => s + tradePnl(c), 0) / wins) : 0;
  const avgLoss = losses ? Math.round(Math.abs(lossTrades.reduce((s, c) => s + tradePnl(c), 0)) / losses) : 0;
  const avgHold = closed.reduce((s, c) => s + c.holdMin, 0) / closed.length;
  const bestPnl = Math.max(...closed.map(tradePnl));

  const byMonth = new Map();
  for (const c of closed) {
    const label = new Date(c.closedAt).toLocaleString('en-US', { month: 'short' });
    byMonth.set(label, (byMonth.get(label) || 0) + tradePnl(c));
  }

  return {
    winRate, wins, losses,
    totalPnl, avgWin, avgLoss, bestPnl,
    avgHold: avgHold >= 60 ? `${(avgHold / 60).toFixed(1)} hrs` : `${Math.round(avgHold)} min`,
    monthlyPnl: [...byMonth.entries()].map(([label, value]) => ({ label, value })),
  };
}

export { tradePnl };
