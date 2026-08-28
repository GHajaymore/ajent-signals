// Local end-to-end simulation of the backend's paper-trading loop — NO AWS.
// Runs the REAL scheduler state machine (processPosition) + REAL strategy over ~2
// years of real daily data, stepping day by day, using an in-memory DB. Proves the
// 24/7 loop opens and closes trades correctly, and prints an honest strategy readout.
//   node test/sim.js
const { MARKETS } = require('../src/markets');
const { fetchDailyCandles } = require('../src/data');
const { computeSignal } = require('../src/strategy');
const { processPosition } = require('../src/scheduler');

function memDb() {
  const store = new Map();
  const key = (pk, sk) => `${pk}|${sk}`;
  return {
    put: async (item) => { store.set(key(item.pk, item.sk), item); },
    get: async (pk, sk) => store.get(key(pk, sk)) || null,
    del: async (pk, sk) => { store.delete(key(pk, sk)); },
    all: (pk) => [...store.values()].filter((v) => v.pk === pk),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function simMarket(symbol) {
  const meta = MARKETS[symbol];
  const { candles } = await fetchDailyCandles(meta, { range: '2y' });
  const db = memDb();
  // Step through history. At each day i, the "live" price is that day's close and
  // the signal is computed on data up to and including day i (open=true: the daily
  // bar means the market traded that day).
  for (let i = 210; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const sig = computeSignal(slice, candles[i].c);
    await processPosition({ symbol, meta, sig, live: candles[i].c, open: true, db, now: candles[i].t });
  }
  return db.all('TRADE');
}

function stats(trades) {
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const dec = wins.length + losses.length;
  return {
    trades: trades.length,
    win: dec ? Math.round((wins.length / dec) * 100) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : (gw > 0 ? 99 : 0),
    totalPnl: trades.reduce((s, t) => s + (t.pnl || 0), 0),
  };
}

(async () => {
  const all = [];
  for (const sym of Object.keys(MARKETS)) {
    try {
      const trades = await simMarket(sym);
      all.push(...trades);
      const s = stats(trades);
      console.log(`${sym.padEnd(5)} trades:${String(s.trades).padStart(3)}  win:${String(s.win).padStart(3)}%  PF:${String(s.pf).padStart(5)}  P&L:$${s.totalPnl}`);
    } catch (e) {
      console.log(`${sym.padEnd(5)} ERR: ${e.message}`);
    }
    await sleep(250);
  }
  const agg = stats(all);
  console.log('-----------------------------------------------------------');
  console.log(`POOLED trades:${agg.trades}  win:${agg.win}%  PF:${agg.pf}  P&L:$${agg.totalPnl}`);
  console.log('(2y daily · Proven long-only · backend loop · tick/close-granularity stops)');
})();
