// Runs every 15 min. For each market: fetch data, compute the signal, persist it,
// and manage the paper position — opening only when the market is open, exiting on
// the first green close / a 2xATR stop / the 5-day time stop. This is what makes
// the paper account trade whether or not anyone's app is open.
//
// The paper-trade state machine (`processPosition`) takes an injected db + clock so
// it can be run over historical data in test/sim.js without AWS.
const { MARKETS, isOpen } = require('./markets');
const { fetchDailyCandles } = require('./data');
const { computeSignal } = require('./strategy');
const realDb = require('./db');

const RISK = Number(process.env.RISK_DOLLARS || 250);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Pure-ish: given a computed signal, current price, whether the market is open,
// a db, and the clock, open/close the paper position. Returns the action taken.
async function processPosition({ symbol, meta, sig, live, open, db, now }) {
  const pos = await db.get('POS#OPEN', symbol);

  if (pos) {
    const price = live ?? sig.price;
    let exit = null;
    if (price <= pos.stop) exit = 'stop';
    else if (sig.lastDaily && sig.lastDaily.up && dayKey(sig.lastDaily.t) !== dayKey(pos.openedAt) && sig.lastDaily.t > pos.openedAt) exit = 'firstUpClose';
    else if (now - pos.openedAt > pos.maxHoldMin * 60000) exit = 'timeStop';
    if (!exit) return 'hold';

    const risk = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
    const resultR = (price - pos.entry) / risk;
    const pnl = Math.round(resultR * (pos.riskDollars || RISK));
    const outcome = exit === 'stop' ? 'Loss' : resultR >= 0.05 ? 'Win' : resultR <= -0.05 ? 'Loss' : 'Break-even';
    await db.put({
      pk: 'TRADE', sk: `${String(now).padStart(16, '0')}#${symbol}`,
      symbol, name: meta.name, side: 'LONG', entry: pos.entry, exit: price,
      resultR: +resultR.toFixed(3), pnl, riskDollars: pos.riskDollars || RISK, outcome, exitReason: exit,
      openedAt: pos.openedAt, closedAt: now,
    });
    await db.del('POS#OPEN', symbol);
    await db.put({ pk: 'LASTCLOSE', sk: symbol, signalDay: dayKey(now), at: now });
    return `exit:${exit}`;
  }

  if (sig.verdict === 'BUY' && sig.plan && open) {
    const lastClose = await db.get('LASTCLOSE', symbol);
    if (lastClose && lastClose.signalDay === dayKey(now)) return 'skip:tradedToday';
    const entry = live ?? sig.plan.entry;
    const risk = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
    await db.put({
      pk: 'POS#OPEN', sk: symbol,
      symbol, name: meta.name, side: 'LONG', entry, stop: entry - risk, target1: entry + risk,
      risk, riskDollars: RISK, conviction: sig.conviction, maxHoldMin: sig.plan.maxHoldMin, exitRule: 'firstUpClose',
      openedAt: now,
    });
    return 'open';
  }
  return 'none';
}

async function handleMarket(symbol, db = realDb) {
  const meta = MARKETS[symbol];
  const { candles, live } = await fetchDailyCandles(meta);
  const sig = computeSignal(candles, live);
  const now = Date.now();
  await db.put({ pk: 'SIGNAL', sk: symbol, symbol, name: meta.name, updatedAt: now, ...sig, live });
  await processPosition({ symbol, meta, sig, live, open: isOpen(meta.country), db, now });
}

exports.handler = async () => {
  const symbols = Object.keys(MARKETS);
  const results = await Promise.allSettled(symbols.map((s) => handleMarket(s)));
  const failed = results.map((r, i) => (r.status === 'rejected' ? `${symbols[i]}: ${r.reason?.message || r.reason}` : null)).filter(Boolean);
  return { ok: true, processed: symbols.length, failed };
};

// Exported for the local simulation / tests.
exports.processPosition = processPosition;
exports.handleMarket = handleMarket;
