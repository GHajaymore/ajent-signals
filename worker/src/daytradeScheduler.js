// The EXPERIMENT's own 24/7-safe loop. It runs the intraday day-trading engine on
// 15-minute bars and tracks it on a SEPARATE paper record (RECORD_DAY / SIGNALS_DAY
// KV blobs), completely isolated from the proven Swing record. That isolation is the
// whole point: the Swing record stays the honest, proven track record; this one is a
// clearly-labelled experiment whose live results are gathered without contaminating
// it. No adaptive up-sizing here — an unproven edge is never auto-scaled.
import { fetchIntradayCandles } from './data.js';
import { computeDaySignal, dayShouldExit, DAYTRADE } from './daytrade.js';
import { isOpen } from './markets.js';

// Only the intraday-liquid US index futures that the lab found net-POSITIVE. RTY is
// excluded — the 60-day lab showed it loses intraday (PF 0.69), same discipline that
// dropped XJO from Swing. Crypto is intentionally absent: it never "closes", so the
// flat-by-close rule that removes overnight risk doesn't apply to it.
export const DAY_MARKETS = {
  ES: { yahoo: 'ES=F', country: 'US', futures: true, name: 'E-mini S&P 500' },
  NQ: { yahoo: 'NQ=F', country: 'US', futures: true, name: 'E-mini Nasdaq-100' },
  YM: { yahoo: 'YM=F', country: 'US', futures: true, name: 'E-mini Dow' },
};

const BAR_MS = 15 * 60 * 1000;
const nyDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// One tick of the experiment. Mirrors runTick's structure (1 KV get + 1 KV put for
// the record — never KV list()), but on its own keys. Returns a small status object.
export async function runDayTick(env, store) {
  const risk = Number(env.RISK_DOLLARS || 250);
  const cost = Number(env.COST_PER_TRADE || 6); // round-turn commission + slippage
  const now = Date.now();

  const prevBlob = await store.get('SIGNALS_DAY', 'ALL');
  const bySym = {};
  if (prevBlob && Array.isArray(prevBlob.signals)) for (const s of prevBlob.signals) bySym[s.symbol] = s;

  const stored = await store.get('RECORD_DAY', 'ALL');
  const record = {
    open: (stored && stored.open) || {},
    closed: (stored && stored.closed) || [],
    lastClose: (stored && stored.lastClose) || {},
  };

  const events = [];
  for (const symbol of Object.keys(DAY_MARKETS)) {
    try {
      const meta = DAY_MARKETS[symbol];
      const { candles, live, liveTime } = await fetchIntradayCandles(meta, env, { interval: '15m', range: '1mo' });
      if (!candles || candles.length < DAYTRADE.trendSma + 20) { bySym[symbol] = bySym[symbol] || { symbol, name: meta.name, verdict: 'NO_TRADE', experiment: true }; continue; }
      const sig = computeDaySignal(candles, live);
      const open = isOpen(meta);
      const pos = record.open[symbol];

      if (pos) {
        // FLAT BY CLOSE: force the position out when the session is closed (Globex
        // halt / weekend) or the NY calendar day has rolled since it opened — so
        // nothing is ever carried overnight. Otherwise the normal intraday exits.
        const price = live ?? sig.price;
        const barsHeld = Math.floor((now - pos.openedAt) / BAR_MS);
        const endOfSession = !open || nyDay(now) !== nyDay(pos.openedAt);
        const exit = dayShouldExit(sig, pos, price, now, { endOfSession, barsHeld });
        if (exit) {
          const r = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
          const resultR = (price - pos.entry) / r;
          const pnl = Math.round(resultR * (pos.riskDollars || risk) - cost);
          const outcome = pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even';
          record.closed.unshift({ symbol, name: meta.name, side: 'LONG', strat: 'day', entry: pos.entry, exit: price, resultR: +resultR.toFixed(3), pnl, cost, riskDollars: pos.riskDollars || risk, outcome, exitReason: exit, openedAt: pos.openedAt, closedAt: now, experiment: true });
          if (record.closed.length > 300) record.closed.length = 300;
          delete record.open[symbol];
          record.lastClose[symbol] = { at: now };
          events.push({ type: 'position.close', event: exit, symbol, name: meta.name, price, at: now, experiment: true });
        }
      } else if (sig.verdict === 'BUY' && sig.plan && open) {
        // Fixed risk — the experiment is NEVER auto-sized up (that's reserved for
        // proven engines). One position per market at a time.
        const entry = live ?? sig.plan.entry;
        const r = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
        record.open[symbol] = { symbol, name: meta.name, side: 'LONG', strat: 'day', entry, stop: entry - r, target1: entry + r, risk: r, riskDollars: risk, conviction: sig.conviction, maxHoldBars: sig.plan.maxHoldBars, exitAbove: sig.plan.exitAbove, openedAt: now, experiment: true };
        events.push({ type: 'position.open', event: 'open', symbol, name: meta.name, price: entry, at: now, experiment: true });
      }

      bySym[symbol] = { symbol, name: meta.name, updatedAt: now, ...sig, live, liveTime, open, strat: 'day', experiment: true };
    } catch (e) { /* skip this market this tick — last-known signal carries forward */ }
  }

  const summary = summarize(record.closed);
  try { await store.put({ pk: 'RECORD_DAY', sk: 'ALL', updatedAt: now, open: record.open, closed: record.closed, lastClose: record.lastClose }); } catch (e) { /* retried next tick */ }
  try { await store.put({ pk: 'SIGNALS_DAY', sk: 'ALL', updatedAt: now, signals: Object.values(bySym), summary }); } catch (e) { /* retried next tick */ }
  const openBuy = events.some((e) => e.type === 'position.open');
  return { events: events.length, openBuy, summary };
}

function summarize(closed) {
  const wins = closed.filter((c) => c.pnl > 0), losses = closed.filter((c) => c.pnl < 0);
  const gw = wins.reduce((s, c) => s + c.pnl, 0), gl = Math.abs(losses.reduce((s, c) => s + c.pnl, 0));
  const dec = wins.length + losses.length;
  return { trades: closed.length, winRate: dec ? Math.round((wins.length / dec) * 100) : 0, profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? null : 0), totalPnl: closed.reduce((s, c) => s + (c.pnl || 0), 0) };
}
