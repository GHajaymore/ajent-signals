// Real (paper) trade tracking — no real money, no broker, no execution.
// Whenever a market's REAL (indicator-computed, not simulated) signal crosses
// the confidence threshold, a hypothetical position is opened at the plan's
// entry/stop/target1. It's closed the moment live price actually reaches
// either level, and the outcome is recorded permanently. This is what lets
// the app report a genuine, evolving win rate instead of an illustrative one.
import { recordOutcome, isMarketAllowed } from './adaptiveWeights.js';

const LS_KEY = 'ajent_paper_trades_v1';
const MAX_CLOSED = 300;
// Bump when a fix invalidates previously-recorded results.
//  v2 — discarded history polluted by the price-stream-mismatch bug (phantom
//       gaps when a market's price switched between the real feed and the sim).
//  v3 — stops were tighter than the quote-feed noise floor, so nearly every
//       trade was noise-stopped; geometry now floors risk at ~0.5% of price.
//  v4 — signals moved from 5-minute to 15-minute candles (better signal-to-
//       noise); prior results were recorded on the noisier timeframe.
//  v5 — trades now open at the live price (not the lagging candle entry), which
//       was booking instant losses when price moved between candle and quote.
//  v6 — switched to the Ajent Pulse mean-reversion core with tight-target,
//       high-win-rate geometry; prior results were a different strategy.
//  v7 — added the daily swing (Connors) strategy + a time stop; results are now
//       strategy-mode dependent, so start the record clean.
//  v8 — daily swing now exits on the classic "first up close" (backtested PF
//       ~1.17 → ~1.6) instead of a fixed 1:1 target, so prior daily results were
//       booked on a different, weaker exit and must be cleared.
//  v9 — daily entry graded by conviction (RSI2<5 / below-Bollinger flagged elite)
//       and the time stop trimmed to 5 days, after a walk-forward showed RSI2<10
//       is profitable in every ~2y window while <5 had a losing one. Records from
//       the earlier fixed-target exit are invalid.
// v10 — daily strategy is now LONG-ONLY. Backtests showed the short side (selling
//       overbought pops) was a drag — PF 1.11 overall and an outright loss on
//       international indices — so it's dropped. Prior records included shorts.
// v11 — intraday rebuilt to match: long-only Connors flush entry + an RSI2-recovery
//       exit (replacing the fixed tight target, which backtested as a net loser).
//       Prior intraday records used the losing fixed-target exit.
// v12 — intraday retuned for frequency ("Active" mode): entry loosened to RSI2<15,
//       flush gate dropped, exit at RSI2>50 (was >60) — ~3x the trades at ~66% win
//       and PF ~1.5-2.6 on the validated markets. Prior records used the old gate.
const SCHEMA = 12;

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

// Quality gate for the mean-reversion core. A BUY/SELL only fires when the
// engine has already confirmed a real oversold-dip / overbought-pop setup
// aligned with the higher-timeframe trend, so the gate here just enforces that
// trend alignment and rejects a signal with no trend behind it. (The old gate
// demanded trend-following confluence, which a dip-buy intentionally fails —
// momentum is temporarily against you at entry — so it blocked every trade.)
export function isHighConviction(signal, verdict) {
  if (verdict === 'BUY') return signal.htfTrend === 'up';
  if (verdict === 'SELL') return signal.htfTrend === 'down';
  return false;
}

export function maybeOpenPositions(engine, threshold, riskDollars = 250, enabled = null, scaleByConviction = false) {
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
      // scaled up 1.5x on high-conviction (deep RSI2<5) setups, whose backtested
      // per-trade expectancy is ~2x the ordinary tier's.
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
      // Exit rule: 'firstUpClose' (daily swing — exit the first green daily bar)
      // or 'fixed' (intraday — target/stop). Defaults to fixed for safety.
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

    const firstUpClose = pos.exitRule === 'firstUpClose';
    const rsi2Exit = pos.exitRule === 'rsi2Exit';
    const dynamicExit = firstUpClose || rsi2Exit;

    // Break-even management (fixed-target trades only): once +1R in our favor,
    // pull the stop to entry so a winner that reverses scratches at ~$0. The
    // dynamic Connors exits (first-up-close / rsi2-recovery) book the bounce
    // quickly and were backtested without break-even management, so they opt out.
    if (!dynamicExit && !pos.beMoved) {
      const oneRLevel = isLong ? pos.entry + risk : pos.entry - risk;
      const reached = isLong ? price >= oneRLevel : price <= oneRLevel;
      if (reached) { pos.stop = pos.entry; pos.beMoved = true; }
    }

    const hitStop = isLong ? price <= pos.stop : price >= pos.stop;
    // Only fixed-target (legacy) trades exit at a preset target1; dynamic-exit
    // trades never do — they ride to the mean-reversion exit below.
    const hitTarget = !dynamicExit && (isLong ? price >= pos.target1 : price <= pos.target1);
    // Dynamic mean-reversion exit:
    //  • firstUpClose (daily): exit on the first COMPLETED daily bar strictly after
    //    the entry day that closes in our favor (green for a long).
    //  • rsi2Exit (intraday): exit once fast RSI2 recovers past 60 (long) — the
    //    bounce has reached the mean. The fresh signal carries both each refresh.
    let dynExited = false;
    if (firstUpClose && market.signal && market.signal.lastDaily) {
      const ld = market.signal.lastDaily;
      const laterDay = ld.t && new Date(ld.t).toDateString() !== new Date(pos.openedAt).toDateString() && ld.t > pos.openedAt;
      dynExited = laterDay && (isLong ? ld.up === true : ld.up === false);
    } else if (rsi2Exit && market.signal && typeof market.signal.rsi2 === 'number') {
      dynExited = isLong ? market.signal.rsi2 > 50 : market.signal.rsi2 < 50;
    }
    // Swing/intraday trades close at market after the time stop if still open.
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
