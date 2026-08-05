// Real (paper) trade tracking — no real money, no broker, no execution.
// Whenever a market's REAL (indicator-computed, not simulated) signal crosses
// the confidence threshold, a hypothetical position is opened at the plan's
// entry/stop/target1. It's closed the moment live price actually reaches
// either level, and the outcome is recorded permanently. This is what lets
// the app report a genuine, evolving win rate instead of an illustrative one.
import { recordOutcome, isMarketAllowed } from './adaptiveWeights.js';

const LS_KEY = 'ajent_paper_trades_v1';
const MAX_CLOSED = 300;
// Bump when a fix invalidates previously-recorded results. v2 discards history
// polluted by the price-stream-mismatch bug (positions stopped out by phantom
// gaps when a market's price switched between the real feed and the simulator).
const SCHEMA = 2;

function fresh() { return { v: SCHEMA, open: {}, closed: [], lastClosedSignalAt: {} }; }

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.v !== SCHEMA) return fresh(); // stale/corrupt schema — start clean
        return {
          v: SCHEMA,
          open: parsed.open || {},
          closed: Array.isArray(parsed.closed) ? parsed.closed : [],
          lastClosedSignalAt: parsed.lastClosedSignalAt || {},
        };
      }
    }
  } catch (e) { /* ignore malformed storage */ }
  return fresh();
}

const store = load();

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* storage full/unavailable — keep running in-memory */ }
}

// Each indicator's independent information group. Agreement concentrated in a
// single group (e.g. three trend indicators that always move together) is weak
// confluence; real confluence spans multiple groups.
const FACTOR_GROUP = {
  'EMA Stack': 'trend', Supertrend: 'trend', ADX: 'trend', Ichimoku: 'trend',
  MACD: 'momentum', 'RSI (14)': 'momentum', CCI: 'momentum',
  'Market Structure': 'structure',
  'Bollinger Bands': 'volatility', VWAP: 'volatility',
  Volume: 'volume',
  'News Sentiment': 'catalyst',
};

// A trade is "high conviction" only when (a) a strong majority of indicators
// agree, (b) that agreement spans at least two independent factor groups,
// (c) it's with the higher-timeframe trend, and (d) ADX confirms a real trend.
// Chop and one-dimensional agreement — where tight stops bleed — are filtered.
// A quality gate, not a profit guarantee.
function isHighConviction(signal, verdict) {
  const c = signal.confluence || {};
  const total = (c.bull || 0) + (c.bear || 0) + (c.neutral || 0) || 1;
  const agree = verdict === 'BUY' ? (c.bull || 0) : (c.bear || 0);
  if (agree / total < 0.65) return false;
  // Don't trade against the higher-timeframe trend (flat is allowed).
  if (signal.htfTrend === 'up' && verdict === 'SELL') return false;
  if (signal.htfTrend === 'down' && verdict === 'BUY') return false;
  const wantState = verdict === 'BUY' ? 'bull' : 'bear';
  // Require the trend-strength gauge (ADX) to confirm the direction, not range.
  const adxInd = (signal.indicators || []).find((i) => i.name === 'ADX');
  if (!adxInd || adxInd.state !== wantState) return false;
  // Cross-group confluence: the agreeing factors must span >=2 groups.
  const groups = new Set();
  for (const i of signal.indicators || []) {
    if (i.state === wantState && FACTOR_GROUP[i.name]) groups.add(FACTOR_GROUP[i.name]);
  }
  return groups.size >= 2;
}

export function maybeOpenPositions(engine, threshold, riskDollars = 250, enabled = null) {
  for (const market of engine.markets) {
    // Only auto-trade markets the user opted into (null = all markets).
    if (enabled && !enabled.has(market.symbol)) continue;
    if (!market.signalIsReal) continue;
    // Only paper-trade on the real feed, so entry/stop/target and the price we
    // later judge them against come from the same stream (never the simulator).
    if (!market.isLiveFresh) continue;
    if (store.open[market.symbol]) continue;
    // Skip markets the adaptive layer has benched for poor recent performance.
    if (!isMarketAllowed(market.symbol)) continue;
    const verdict = market.verdict(threshold);
    if (verdict === 'NO_TRADE') continue;
    const s = market.signal;
    // Selectivity: only take high-conviction setups where a strong majority of
    // the indicators agree with the trade direction. This isn't a guarantee of
    // profit — no signal is — it just avoids paper-trading marginal, conflicted
    // setups that barely cleared the threshold.
    if (!isHighConviction(s, verdict)) continue;
    // The plan's entry must match the price we'll monitor. If they've drifted
    // apart (a stale signal, or the price stream moved), skip — opening here
    // would book an instant, artificial win or loss.
    const openRisk = Math.abs(s.plan.entry - s.plan.stop) || 1e-9;
    if (Math.abs(market.price - s.plan.entry) > openRisk * 3) continue;
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
      // Snapshot each factor's stance at entry so the adaptive layer can credit
      // or blame it when this trade eventually closes.
      indicatorSnapshot: (s.indicators || []).map((i) => ({ name: i.name, state: i.state })),
      openedAt: Date.now(),
      signalCreatedAt: s.createdAt,
      // Whether this fill was on the real feed. A position must be judged on the
      // same price stream it opened on — never against the simulator's
      // basePrice-anchored series, which sits at a different scale.
      openedLive: !!market.isLiveFresh,
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

    // A position opened on the real feed must not be judged against the
    // simulator: when the live quote goes stale the price snaps to a
    // basePrice-anchored series at a completely different level, which would gap
    // the trade through its stop. Pause evaluation until the real feed returns.
    if (pos.openedLive && !market.isLiveFresh) continue;

    // Guard against any price-scale jump (feed switch, bad tick): a legitimate
    // fill closes within ~1.4x risk of entry, so a price many multiples of risk
    // away is not a real touch of the stop/target. Void the position without
    // recording a phantom win/loss so the win rate stays honest.
    if (!Number.isFinite(price) || Math.abs(price - pos.entry) > risk * 12) {
      delete store.open[symbol];
      continue;
    }

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
    // Feed the result back into the self-tuning weights (skip break-even scratches).
    if (outcome === 'Win') recordOutcome(pos.indicatorSnapshot, pos.side, true, symbol);
    else if (outcome === 'Loss') recordOutcome(pos.indicatorSnapshot, pos.side, false, symbol);
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
