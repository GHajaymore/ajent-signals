// Real (paper) trade tracking — no real money, no broker, no execution.
// Whenever a market's REAL (indicator-computed, not simulated) signal crosses
// the confidence threshold, a hypothetical position is opened at the plan's
// entry/stop/target1. It's closed the moment live price actually reaches
// either level, and the outcome is recorded permanently. This is what lets
// the app report a genuine, evolving win rate instead of an illustrative one.
import { recordOutcome, isMarketAllowed } from './adaptiveWeights.js';
import { isMarketOpen } from './marketHours.js';

const LS_KEY = 'ajent_paper_trades_v1';
const MAX_CLOSED = 300;
// Bump SCHEMA whenever a fix or strategy change invalidates previously-recorded
// results, so stale local records are cleared instead of mixing with the new ones.
// (The exact strategy dials that drove each bump are server-side only — the recipe
// never lives in this client file. See memory: ajent-signals-recipe-lock.)
const SCHEMA = 13;

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

// Quality gate for auto-trading. Intraday ("Active", 15m) is deliberately
// ungated and BOTH directions — buy oversold dips and short overbought pops in
// any condition — so any fired BUY/SELL qualifies. Daily is long-only and
// trend-aligned, so it still requires the uptrend behind a BUY.
export function isHighConviction(signal, verdict) {
  if (verdict === 'NO_TRADE') return false;
  if (signal.timeframe === '15m') return true; // intraday: both ways, no trend gate
  if (verdict === 'BUY') return signal.htfTrend === 'up';
  return false; // daily is long-only
}

export function maybeOpenPositions(engine, threshold, riskDollars = 250, enabled = null, scaleByConviction = false) {
  for (const market of engine.markets) {
    // Only auto-trade markets the user opted into (null = all markets).
    if (enabled && !enabled.has(market.symbol)) continue;
    if (!market.signalIsReal) continue;
    // Only paper-trade on the real feed, so entry/stop/target and the price we
    // later judge them against come from the same stream (never the simulator).
    if (!market.isLiveFresh) continue;
    // Never open on a CLOSED market or a heavily-DELAYED quote. Both mis-price the
    // fill — e.g. buying an "oversold dip" that actually reversed 15-25 min ago in
    // real time on the free delayed feed — a systematic source of paper losses
    // that has nothing to do with the strategy's edge.
    if (!isMarketOpen(market)) continue;
    if (market.quoteAgeSec != null && market.quoteAgeSec > 300) continue;
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
    // A position can only be opened once per signal generation — otherwise a
    // stale signal (unchanged for up to 5 min between real recomputes) whose
    // price has already reached its target/stop would reopen and immediately
    // re-close on every single tick, spamming alerts and fabricating wins.
    if (store.lastClosedSignalAt[market.symbol] === s.createdAt) continue;
    // Anchor the trade to the CURRENT live price, not the signal's plan entry.
    // The plan entry comes from the last 15-min candle close, which can lag the
    // live quote during a fast move — opening at that stale entry would put the
    // trade at/through its stop before it even starts. Keep the signal's risk
    // and target DISTANCES, but measure them from the price we actually monitor.
    const dir = verdict === 'BUY' ? 1 : -1;
    const risk = Math.abs(s.plan.entry - s.plan.stop) || market.price * 0.005;
    const targetDist = Math.abs(s.plan.target1 - s.plan.entry) || risk * 1.3;
    const entry = market.price;
    const stop = entry - dir * risk;
    const target1 = entry + dir * targetDist;
    store.open[market.symbol] = {
      symbol: market.symbol,
      name: market.name,
      side: verdict === 'BUY' ? 'LONG' : 'SHORT',
      entry,
      stop,
      target1,
      riskReward: s.plan.riskReward,
      // Initial risk distance and a break-even flag drive stop management below.
      risk,
      beMoved: false,
      confidence: s.confidence,
      decimals: market.decimals,
      // Virtual dollars staked on this trade — captured at open so the recorded
      // outcome is a real dollar figure, not an abstract multiple. Optionally
      // scaled up on high-conviction setups, whose backtested per-trade
      // expectancy runs richer than the ordinary tier's.
      riskDollars: Math.max(1, Math.round(riskDollars * ((scaleByConviction && s.plan.conviction === 'high') ? 1.5 : 1))),
      conviction: s.plan.conviction || 'normal',
      // Snapshot each factor's stance at entry so the adaptive layer can credit
      // or blame it when this trade eventually closes.
      indicatorSnapshot: (s.indicators || []).map((i) => ({ name: i.name, state: i.state })),
      openedAt: Date.now(),
      signalCreatedAt: s.createdAt,
      // Time stop for swing (daily) trades — close at market after N minutes if
      // neither target nor stop is hit. null = no time stop (intraday).
      maxHoldMin: s.plan.maxHoldMin || null,
      // Exit style for this local record: 'fixed' (target/stop) by default. Any
      // dynamic exit is set by the plan; the server keeps its own exit logic on
      // its record and never sends it here.
      exitRule: s.plan.exitRule || 'fixed',
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

    // A plan may flag a dynamic exit; today all client-tracked trades use a fixed
    // target/stop (the server runs its own dynamic exits on its own record and
    // never sends the rule here), so this is normally false.
    const dynamicExit = !!pos.exitRule && pos.exitRule !== 'fixed';

    // Break-even management (fixed-target trades only): once +1R in our favor,
    // pull the stop to entry so a winner that reverses scratches at ~$0. Dynamic
    // exits book the move on their own signal, so they opt out.
    if (!dynamicExit && !pos.beMoved) {
      const oneRLevel = isLong ? pos.entry + risk : pos.entry - risk;
      const reached = isLong ? price >= oneRLevel : price <= oneRLevel;
      if (reached) { pos.stop = pos.entry; pos.beMoved = true; }
    }

    const hitStop = isLong ? price <= pos.stop : price >= pos.stop;
    // Only fixed-target trades exit at a preset target1; a dynamic-exit trade
    // rides to its own exit signal below instead.
    const hitTarget = !dynamicExit && (isLong ? price >= pos.target1 : price <= pos.target1);
    // Optional dynamic exit: close on the first completed daily bar after entry
    // that finishes in our favor, when the plan supplies that daily signal.
    let dynExited = false;
    if (dynamicExit && market.signal && market.signal.lastDaily) {
      const ld = market.signal.lastDaily;
      const laterDay = ld.t && new Date(ld.t).toDateString() !== new Date(pos.openedAt).toDateString() && ld.t > pos.openedAt;
      dynExited = laterDay && (isLong ? ld.up === true : ld.up === false);
    }
    // Trades close at market after the time stop if still open.
    const timedOut = pos.maxHoldMin && (Date.now() - pos.openedAt) > pos.maxHoldMin * 60000;
    if (!hitTarget && !hitStop && !dynExited && !timedOut) continue;

    let outcome, resultR;
    if (hitTarget) { outcome = 'Win'; resultR = pos.riskReward; }
    else if (hitStop && pos.beMoved) { outcome = 'Break-even'; resultR = 0; }
    else if (hitStop) { outcome = 'Loss'; resultR = -1; }
    else { // dynamic mean-reversion exit OR timed out — exit at the current price
      resultR = ((isLong ? 1 : -1) * (price - pos.entry)) / risk;
      outcome = resultR >= 0.05 ? 'Win' : resultR <= -0.05 ? 'Loss' : 'Break-even';
    }

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
      const isWin = outcome === 'Win';
      const title = hitTarget ? 'Target hit'
        : dynExited ? (isWin ? 'Closed on the bounce' : 'Exited on reversal')
        : (hitStop && pos.beMoved) ? 'Closed at break-even'
        : hitStop ? 'Stopped out'
        : isWin ? 'Time exit (win)' : 'Time exit';
      onAlert({
        type: (hitTarget || (dynExited && isWin)) ? 'TARGET' : 'STOP',
        symbol,
        title: `${title} · ${symbol}`,
        body: `${pos.name} paper ${pos.side.toLowerCase()} closed for ${money} (virtual). No real money involved.`,
        ts: Date.now(),
      });
    }
  }
  save();
}

// Replace the local record with the backend's 24/7 server record. Maps the
// server item shapes into the local store so every existing reader
// (getPerformanceSummary, getClosedTrades, getOpenPositions, getOpenCount) keeps
// working unchanged. Called only when the backend is connected.
export function applyServerRecord(data) {
  if (!data || typeof data !== 'object') return;
  const closed = Array.isArray(data.closed) ? data.closed : [];
  const open = Array.isArray(data.open) ? data.open : [];
  store.closed = closed.map((c) => ({
    symbol: c.symbol, name: c.name, side: c.side || 'LONG', entry: c.entry, exit: c.exit,
    resultR: c.resultR, pnl: c.pnl, riskDollars: c.riskDollars, outcome: c.outcome, exitReason: c.exitReason,
    holdMin: (c.openedAt && c.closedAt) ? Math.max(1, Math.round((c.closedAt - c.openedAt) / 60000)) : 1,
    decimals: c.decimals ?? 2, closedAt: c.closedAt || Date.now(),
  })).sort((a, b) => b.closedAt - a.closedAt);
  if (store.closed.length > MAX_CLOSED) store.closed.length = MAX_CLOSED;
  store.open = {};
  for (const p of open) {
    if (!p || !p.symbol) continue;
    store.open[p.symbol] = {
      symbol: p.symbol, name: p.name, side: p.side || 'LONG', entry: p.entry, stop: p.stop,
      target1: p.target1, risk: p.risk, riskDollars: p.riskDollars, conviction: p.conviction,
      // strat (mr/trend) + the server-derived `call` drive the position guidance without
      // the recipe. maxHoldMin/exitRule are stripped server-side; keep only what's here.
      strat: p.strat, call: p.call, maxHoldMin: p.maxHoldMin, openedAt: p.openedAt, openedLive: true,
    };
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

// Optional `closedInput` scopes the summary to a subset (e.g. one asset class); with
// no argument it uses the whole record (unchanged for existing callers).
export function getPerformanceSummary(closedInput) {
  const closed = closedInput || store.closed;
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

  // Chronological pass for the equity curve and streaks (store is newest-first).
  const chrono = [...closed].reverse();
  const equity = [0];
  let run = 0, curStreak = 0, bestWinStreak = 0, worstLossStreak = 0;
  for (const c of chrono) {
    const p = tradePnl(c);
    run += p;
    equity.push(run);
    if (p > 0) { curStreak = curStreak > 0 ? curStreak + 1 : 1; bestWinStreak = Math.max(bestWinStreak, curStreak); }
    else if (p < 0) { curStreak = curStreak < 0 ? curStreak - 1 : -1; worstLossStreak = Math.min(worstLossStreak, curStreak); }
  }
  const grossWin = winTrades.reduce((s, c) => s + tradePnl(c), 0);
  const grossLoss = Math.abs(lossTrades.reduce((s, c) => s + tradePnl(c), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const expectancy = decisive ? Math.round(totalPnl / decisive) : 0;
  const peak = Math.max(...equity);
  let maxDrawdown = 0, hi = equity[0];
  for (const e of equity) { hi = Math.max(hi, e); maxDrawdown = Math.min(maxDrawdown, e - hi); }

  return {
    winRate, wins, losses, decisive,
    totalPnl, avgWin, avgLoss, bestPnl,
    avgHold: avgHold >= 60 ? `${(avgHold / 60).toFixed(1)} hrs` : `${Math.round(avgHold)} min`,
    monthlyPnl: [...byMonth.entries()].map(([label, value]) => ({ label, value })),
    equity,
    profitFactor,
    expectancy,
    peak,
    maxDrawdown,
    bestWinStreak,
    worstLossStreak: Math.abs(worstLossStreak),
    currentStreak: curStreak,
  };
}

export { tradePnl };
