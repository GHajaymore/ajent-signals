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

export function maybeOpenPositions(engine, threshold) {
  for (const market of engine.markets) {
    if (!market.signalIsReal) continue;
    if (store.open[market.symbol]) continue;
    const verdict = market.verdict(threshold);
    if (verdict === 'NO_TRADE') continue;
    const s = market.signal;
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
      confidence: s.confidence,
      decimals: market.decimals,
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
    const hitTarget = isLong ? price >= pos.target1 : price <= pos.target1;
    const hitStop = isLong ? price <= pos.stop : price >= pos.stop;
    if (!hitTarget && !hitStop) continue;

    const outcome = hitTarget ? 'Target 1' : 'Stopped';
    const resultR = hitTarget ? pos.riskReward : -1;
    const holdMin = Math.max(1, Math.round((Date.now() - pos.openedAt) / 60000));

    store.closed.unshift({
      symbol, name: pos.name, side: pos.side, entry: pos.entry, exit: price,
      resultR, outcome, holdMin, decimals: pos.decimals, closedAt: Date.now(),
    });
    if (store.closed.length > MAX_CLOSED) store.closed.length = MAX_CLOSED;
    store.lastClosedSignalAt[symbol] = pos.signalCreatedAt;
    delete store.open[symbol];

    if (onAlert) {
      onAlert({
        type: hitTarget ? 'TARGET' : 'STOP',
        symbol,
        title: `${hitTarget ? 'Target 1 hit' : 'Stop hit'} · ${symbol}`,
        body: `${pos.name} paper ${pos.side.toLowerCase()} closed ${hitTarget ? 'at target' : 'at stop'} (${resultR >= 0 ? '+' : ''}${resultR.toFixed(1)}R). No real money involved.`,
        ts: Date.now(),
      });
    }
  }
  save();
}

export function getClosedTrades() { return store.closed; }
export function getOpenPositions() { return Object.values(store.open); }
export function getOpenCount() { return Object.keys(store.open).length; }

export function getPerformanceSummary() {
  const closed = store.closed;
  if (closed.length === 0) return null;

  const wins = closed.filter((c) => c.resultR > 0).length;
  const losses = closed.length - wins;
  const winRate = Math.round((wins / closed.length) * 100);
  const avgWinR = wins ? closed.filter((c) => c.resultR > 0).reduce((s, c) => s + c.resultR, 0) / wins : 0;
  const avgLossR = losses ? Math.abs(closed.filter((c) => c.resultR < 0).reduce((s, c) => s + c.resultR, 0) / losses) : 0;
  const avgHold = closed.reduce((s, c) => s + c.holdMin, 0) / closed.length;
  const totalR = closed.reduce((s, c) => s + c.resultR, 0);

  const byMonth = new Map();
  for (const c of closed) {
    const label = new Date(c.closedAt).toLocaleString('en-US', { month: 'short' });
    byMonth.set(label, (byMonth.get(label) || 0) + c.resultR);
  }

  return {
    winRate, wins, losses,
    avgRR: `${avgLossR ? (avgWinR / avgLossR).toFixed(1) : avgWinR.toFixed(1)}:1`,
    avgHold: avgHold >= 60 ? `${(avgHold / 60).toFixed(1)} hrs` : `${Math.round(avgHold)} min`,
    totalR,
    monthlyR: [...byMonth.entries()].map(([label, value]) => ({ label, value })),
  };
}
