// STOCK SCREENER (Phase 2). The swing edge generalizes to stocks in AGGREGATE
// (test/phase2.mjs: pooled +0.11R / 67% win / 424 trades) but is noisy per-name, so
// the honest vehicle is a SCREENER: scan a diversified liquid universe and surface
// the names FIRING a signal right now, plus the ones closest. Signals ONLY — these
// are NOT auto-traded into the tracked record (single-name / earnings-gap risk needs
// guardrails first). Recipe is stripped before serving, same as /signals.
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';
import { STRATEGY } from './meta.js';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const HOLD_DAYS = 5; // swing time cap — the same as the validated backtest

// Risk-profile metrics for the user-facing risk screener (NOT the Ajent Pulse signal
// recipe — these are generic public measures anyone computes). Per stock: annualized
// volatility %, 3-month momentum %, 6-month momentum %, and whether it's in a long-
// term uptrend. The client ranks by these per the user's chosen profile.
function riskMetrics(candles) {
  const cl = candles.map((c) => c.c);
  const n = cl.length, price = cl[n - 1];
  // Annualized volatility from ~126 daily returns.
  const W = Math.min(126, n - 1);
  let mean = 0; const rets = [];
  for (let i = n - W; i < n; i++) { const r = cl[i] / cl[i - 1] - 1; rets.push(r); mean += r; }
  mean /= rets.length || 1;
  let v = 0; for (const r of rets) v += (r - mean) ** 2;
  const vol = Math.sqrt(v / (rets.length || 1)) * Math.sqrt(252) * 100;
  // Momentum over ~3 and ~6 months.
  const b3 = Math.min(63, n - 1), b6 = Math.min(126, n - 1);
  const mom3 = (price / cl[n - 1 - b3] - 1) * 100;
  const mom6 = (price / cl[n - 1 - b6] - 1) * 100;
  // Long-term trend: price vs the 200-day average.
  let s = 0; const p = Math.min(200, n); for (let i = n - p; i < n; i++) s += cl[i];
  const trendUp = price > s / p;
  return { vol: Math.round(vol * 10) / 10, mom3: Math.round(mom3 * 10) / 10, mom6: Math.round(mom6 * 10) / 10, trendUp };
}

// Manage ONE stock's paper position on the daily scan (open a fresh BUY, or exit an
// open one on the recovery / stop / time cap). Mutates the shared record. Signals are
// computed once/day, so this evaluates on daily closes — exactly like the backtest.
function manageStock(record, sym, sig, price, now, risk, cost) {
  const pos = record.open[sym];
  if (pos) {
    let exit = null;
    if (price <= pos.stop) exit = 'stop';
    else if (sig.rsi2 != null && sig.rsi2 > STRATEGY.exitAbove) exit = 'rsiRecover';
    else if (now - pos.openedAt >= HOLD_DAYS * 86400000) exit = 'timeStop';
    if (exit) {
      const r = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
      const resultR = (price - pos.entry) / r;
      const pnl = Math.round(resultR * (pos.riskDollars || risk) - cost);
      record.closed.unshift({ symbol: sym, name: sym, side: 'LONG', entry: pos.entry, exit: price, resultR: +resultR.toFixed(3), pnl, cost, riskDollars: pos.riskDollars || risk, outcome: pnl > 0 ? 'Win' : pnl < 0 ? 'Loss' : 'Break-even', exitReason: exit, openedAt: pos.openedAt, closedAt: now, experiment: true });
      if (record.closed.length > 300) record.closed.length = 300;
      delete record.open[sym];
      record.lastClose[sym] = { signalDay: dayKey(now) };
      return;
    }
  } else if (sig.verdict === 'BUY' && sig.plan) {
    const last = record.lastClose[sym];
    if (last && last.signalDay === dayKey(now)) return; // one entry per name per day
    const r = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop) || 1e-9;
    record.open[sym] = { symbol: sym, name: sym, side: 'LONG', entry: price, stop: price - r, target1: price + r, risk: r, riskDollars: risk, conviction: sig.plan.conviction, openedAt: now, experiment: true };
  }
}

// Diverse, liquid large caps across every sector (~45 names). Sized to fit the daily
// stock-scan tick's 50-subrequest free-tier budget (it runs on its OWN cron so it
// isn't starved by the 5-min loop). Yahoo tickers == symbols.
export const STOCK_UNIVERSE = [
  // Tech & semis
  'AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD', 'ORCL', 'CRM', 'ADBE', 'QCOM', 'MU', 'AMAT',
  // Comms & internet
  'GOOGL', 'META', 'NFLX', 'DIS', 'T',
  // Consumer
  'AMZN', 'TSLA', 'WMT', 'COST', 'HD', 'PG', 'KO', 'MCD', 'NKE',
  // Financials
  'JPM', 'BAC', 'WFC', 'GS', 'V', 'MA', 'AXP',
  // Health care
  'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO',
  // Industrials & energy
  'CAT', 'GE', 'BA', 'HON', 'XOM', 'CVX',
];

// Sector per name — lets the risk screener diversify the picks (never a one-sector
// basket) and show what a name is. Generic classification, not the recipe.
export const SECTOR = {
  AAPL: 'Tech', MSFT: 'Tech', NVDA: 'Tech', AVGO: 'Tech', AMD: 'Tech', ORCL: 'Tech', CRM: 'Tech', ADBE: 'Tech', QCOM: 'Tech', MU: 'Tech', AMAT: 'Tech',
  GOOGL: 'Comms', META: 'Comms', NFLX: 'Comms', DIS: 'Comms', T: 'Comms',
  AMZN: 'Consumer', TSLA: 'Consumer', WMT: 'Consumer', COST: 'Consumer', HD: 'Consumer', PG: 'Consumer', KO: 'Consumer', MCD: 'Consumer', NKE: 'Consumer',
  JPM: 'Financials', BAC: 'Financials', WFC: 'Financials', GS: 'Financials', V: 'Financials', MA: 'Financials', AXP: 'Financials',
  UNH: 'Health', LLY: 'Health', JNJ: 'Health', ABBV: 'Health', MRK: 'Health', PFE: 'Health', TMO: 'Health',
  CAT: 'Industrials', GE: 'Industrials', BA: 'Industrials', HON: 'Industrials', XOM: 'Energy', CVX: 'Energy',
};

// Scan the universe: compute the production swing signal for each name on its daily
// candles. Returns a compact row per name (recipe-free levels only). When `store` is
// passed, it ALSO auto-paper-trades those signals into an isolated RECORD_STOCKS blob
// (the tracked EXPERIMENT cell) — validated in test/promote-stocks.mjs. Long-only.
export async function scanStocks(env, store) {
  const risk = Number(env.RISK_DOLLARS || 250), cost = Number(env.COST_PER_TRADE || 6);
  const now = Date.now();
  let record = null;
  if (store) {
    const rec = await store.get('RECORD_STOCKS', 'ALL');
    record = { open: (rec && rec.open) || {}, closed: (rec && rec.closed) || [], lastClose: (rec && rec.lastClose) || {} };
  }
  const out = [];
  const BATCH = 6; // small parallel batches to stay within subrequest/time budgets
  for (let i = 0; i < STOCK_UNIVERSE.length; i += BATCH) {
    const chunk = STOCK_UNIVERSE.slice(i, i + BATCH);
    const rows = await Promise.all(chunk.map(async (sym) => {
      try {
        const { candles } = await fetchDailyCandles({ yahoo: sym, country: 'US' }, env);
        if (!candles || candles.length < 210) return null;
        const price = candles[candles.length - 1].c;
        const sig = computeSignal(candles, price);
        if (record) manageStock(record, sym, sig, price, now, risk, cost); // paper-trade it
        const rm = riskMetrics(candles); // generic risk metrics for the risk screener
        return {
          symbol: sym, name: sym, verdict: sig.verdict, confidence: sig.confidence,
          // proximity + a coarse conviction flag are display-safe; the raw RSI reading
          // (rsi2) is the recipe and is NEVER sent (guarded by test/no-recipe-leak).
          proximity: sig.proximity, htfTrend: sig.htfTrend, price,
          conviction: sig.plan && sig.plan.conviction === 'high' ? 'high' : 'normal',
          // Generic risk metrics (volatility / momentum / trend) + sector — NOT the recipe.
          vol: rm.vol, mom3: rm.mom3, mom6: rm.mom6, trendUp: rm.trendUp, sector: SECTOR[sym] || 'Other',
          // Levels only — exitAbove/stopMult are the proprietary recipe, never sent.
          plan: sig.plan ? { entry: sig.plan.entry, stop: sig.plan.stop, target1: sig.plan.target1, riskReward: sig.plan.riskReward } : null,
        };
      } catch (e) { return null; }
    }));
    out.push(...rows.filter(Boolean));
  }
  // Firing BUYs first, then closest-to-firing by proximity.
  out.sort((a, b) => ((b.verdict === 'BUY') - (a.verdict === 'BUY')) || (b.proximity - a.proximity));
  if (store && record) { try { await store.put({ pk: 'RECORD_STOCKS', sk: 'ALL', updatedAt: now, open: record.open, closed: record.closed, lastClose: record.lastClose }); } catch (e) { /* retried next scan */ } }
  return out;
}

// Summarize the stocks paper record (win rate / PF / net) for the /stocks payload.
export function summarizeStocks(closed) {
  const wins = closed.filter((c) => (c.pnl || 0) > 0), losses = closed.filter((c) => (c.pnl || 0) < 0);
  const gw = wins.reduce((s, c) => s + (c.pnl || 0), 0), gl = Math.abs(losses.reduce((s, c) => s + (c.pnl || 0), 0));
  const dec = wins.length + losses.length;
  return { trades: closed.length, winRate: dec ? Math.round((wins.length / dec) * 100) : 0, profitFactor: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? null : 0), totalPnl: closed.reduce((s, c) => s + (c.pnl || 0), 0) };
}
