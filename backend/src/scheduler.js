// Runs every 15 min. For each market: fetch data, compute the signal, persist it,
// and manage the paper position — opening only when the market is open, exiting on
// the first green close / a 2xATR stop / the 5-day time stop. This is what makes
// the paper account trade whether or not anyone's app is open.
const { MARKETS, isOpen } = require('./markets');
const { fetchDailyCandles } = require('./data');
const { computeSignal } = require('./strategy');
const { put, get, del, queryPk } = require('./db');

const RISK = Number(process.env.RISK_DOLLARS || 250);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

async function handleMarket(symbol) {
  const meta = MARKETS[symbol];
  const { candles, live } = await fetchDailyCandles(meta);
  const sig = computeSignal(candles, live);
  const now = Date.now();

  // Persist the latest signal for the API/app to read.
  await put({ pk: 'SIGNAL', sk: symbol, symbol, name: meta.name, updatedAt: now, ...sig, live });

  const pos = await get('POS#OPEN', symbol);

  if (pos) {
    const price = live ?? sig.price;
    let exit = null;
    if (price <= pos.stop) exit = 'stop';
    else if (sig.lastDaily && sig.lastDaily.up && dayKey(sig.lastDaily.t) !== dayKey(pos.openedAt) && sig.lastDaily.t > pos.openedAt) exit = 'firstUpClose';
    else if (now - pos.openedAt > pos.maxHoldMin * 60000) exit = 'timeStop';

    if (exit) {
      const risk = pos.risk || Math.abs(pos.entry - pos.stop) || 1e-9;
      const resultR = (price - pos.entry) / risk;
      const pnl = Math.round(resultR * (pos.riskDollars || RISK));
      const outcome = exit === 'stop' ? 'Loss' : resultR >= 0.05 ? 'Win' : resultR <= -0.05 ? 'Loss' : 'Break-even';
      const closedAt = now;
      await put({
        pk: 'TRADE', sk: `${String(closedAt).padStart(16, '0')}#${symbol}`,
        symbol, name: meta.name, side: 'LONG', entry: pos.entry, exit: price,
        resultR: +resultR.toFixed(3), pnl, riskDollars: pos.riskDollars || RISK, outcome, exitReason: exit,
        openedAt: pos.openedAt, closedAt,
      });
      await del('POS#OPEN', symbol);
      // Remember the signal we just closed so we don't instantly reopen it.
      await put({ pk: 'LASTCLOSE', sk: symbol, signalDay: dayKey(now), at: now });
      return;
    }
    return; // still open, no exit
  }

  // No open position — consider opening. Only when the market is genuinely open.
  if (sig.verdict === 'BUY' && sig.plan && isOpen(meta.country)) {
    const lastClose = await get('LASTCLOSE', symbol);
    if (lastClose && lastClose.signalDay === dayKey(now)) return; // already traded this market today
    const entry = live ?? sig.plan.entry;
    const risk = sig.plan.risk || Math.abs(sig.plan.entry - sig.plan.stop);
    await put({
      pk: 'POS#OPEN', sk: symbol,
      symbol, name: meta.name, side: 'LONG', entry, stop: entry - risk, target1: entry + risk,
      risk, riskDollars: RISK, conviction: sig.conviction, maxHoldMin: sig.plan.maxHoldMin, exitRule: 'firstUpClose',
      openedAt: now,
    });
  }
}

exports.handler = async () => {
  const symbols = Object.keys(MARKETS);
  const results = await Promise.allSettled(symbols.map(handleMarket));
  const failed = results.filter((r) => r.status === 'rejected').map((r, i) => `${symbols[i]}: ${r.reason?.message || r.reason}`);
  return { ok: true, processed: symbols.length, failed };
};
