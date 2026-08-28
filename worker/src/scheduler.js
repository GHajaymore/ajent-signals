// The 24/7 paper-trading loop (ESM). Runs on the cron trigger.
import { MARKETS, isOpen } from './markets.js';
import { fetchDailyCandles } from './data.js';
import { computeSignal } from './strategy.js';

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Open/close the paper position for one market given its computed signal.
export async function processPosition({ symbol, meta, sig, live, open, store, now, risk }) {
  const pos = await store.get('POS#OPEN', symbol);
  if (pos) {
    const price = live ?? sig.price;
    let exit = null;
    if (price <= pos.stop) exit = 'stop';
    else if (sig.lastDaily && sig.lastDaily.up && dayKey(sig.lastDaily.t) !== dayKey(pos.openedAt) && sig.lastDaily.t > pos.openedAt) exit = 'firstUpClose';
    else if (now - pos.openedAt > pos.maxHoldMin * 60000) exit = 'timeStop';
    if (!exit) return 'hold';
    const r = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
    const resultR = (price - pos.entry) / r;
    const pnl = Math.round(resultR * (pos.riskDollars || risk));
    const outcome = exit === 'stop' ? 'Loss' : resultR >= 0.05 ? 'Win' : resultR <= -0.05 ? 'Loss' : 'Break-even';
    await store.put({ pk: 'TRADE', sk: `${String(now).padStart(16, '0')}#${symbol}`, symbol, name: meta.name, side: 'LONG', entry: pos.entry, exit: price, resultR: +resultR.toFixed(3), pnl, riskDollars: pos.riskDollars || risk, outcome, exitReason: exit, openedAt: pos.openedAt, closedAt: now });
    await store.del('POS#OPEN', symbol);
    await store.put({ pk: 'LASTCLOSE', sk: symbol, signalDay: dayKey(now), at: now });
    return `exit:${exit}`;
  }
  if (sig.verdict === 'BUY' && sig.plan && open) {
    const lastClose = await store.get('LASTCLOSE', symbol);
    if (lastClose && lastClose.signalDay === dayKey(now)) return 'skip:tradedToday';
    const entry = live ?? sig.plan.entry;
    const r = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
    await store.put({ pk: 'POS#OPEN', sk: symbol, symbol, name: meta.name, side: 'LONG', entry, stop: entry - r, target1: entry + r, risk: r, riskDollars: risk, conviction: sig.conviction, maxHoldMin: sig.plan.maxHoldMin, exitRule: 'firstUpClose', openedAt: now });
    return 'open';
  }
  return 'none';
}

export async function runTick(env, store) {
  const risk = Number(env.RISK_DOLLARS || 250);
  for (const symbol of Object.keys(MARKETS)) {
    try {
      const meta = MARKETS[symbol];
      const { candles, live } = await fetchDailyCandles(meta, env);
      const sig = computeSignal(candles, live);
      const now = Date.now();
      await store.put({ pk: 'SIGNAL', sk: symbol, symbol, name: meta.name, updatedAt: now, ...sig, live });
      await processPosition({ symbol, meta, sig, live, open: isOpen(meta.country), store, now, risk });
    } catch (e) { /* skip this market this tick */ }
  }
}
