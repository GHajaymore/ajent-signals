// Verify the open-market split-scan + dynamic cadence gate (scheduler.js): each tick
// scans only markets whose exchange is OPEN, always scans open-position markets, bounds
// per-tick fetches, and — via the cadence gate — skips a tick that fires too soon for
// the current activity level.
//   node test/batch-scan.mjs
import { MARKETS, isOpen } from '../src/markets.js';
import { runTick } from '../src/scheduler.js';

function memStore() {
  const m = new Map(); const k = (pk, sk) => `${pk}|${sk}`;
  return {
    put: async (i) => { m.set(k(i.pk, i.sk), i); },
    get: async (pk, sk) => m.get(k(pk, sk)) || null,
    del: async (pk, sk) => { m.delete(k(pk, sk)); },
    list: async () => [],
    all: (pk) => [...m.values()].filter((v) => v.pk === pk),
    _map: m,
  };
}
// Backdate the last scan so the cadence gate lets the next tick through (isolates the
// scan logic from the gate, which is checked separately below).
async function allowNext(store) {
  const s = await store.get('SIGNALS', 'ALL');
  if (s) { s.updatedAt = Date.now() - 3_600_000; await store.put(s); }
}

const env = { DATA_PROVIDER: 'yahoo', RISK_DOLLARS: 250, COST_PER_TRADE: 6 };
const allSymbols = Object.keys(MARKETS);
const openPool = allSymbols.filter((s) => isOpen(MARKETS[s]));
const closedPool = allSymbols.filter((s) => !isOpen(MARKETS[s]));
const store = memStore();
const seedSym = closedPool[0] || allSymbols[allSymbols.length - 1];
await store.put({ pk: 'RECORD', sk: 'ALL', open: { [seedSym]: { symbol: seedSym, side: 'LONG', strat: 'mr', entry: 1, stop: 0.5, target1: 2, risk: 0.5, riskDollars: 250, openedAt: Date.now() - 86400000, peak: 1 } }, closed: [], lastClose: {}, migrated: true });

const freshSince = (blob, ms) => ((blob && blob.signals) || []).filter((s) => (s.updatedAt || 0) >= ms).map((s) => s.symbol);
let pass = true;
const check = (n, c, d) => { console.log(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!c) pass = false; };

console.log(`Universe ${allSymbols.length} · open now: ${openPool.length} · closed: ${closedPool.length} · seed(pos): ${seedSym} (${closedPool.includes(seedSym) ? 'CLOSED' : 'open'})\n`);

const t1 = Date.now();
await runTick(env, store);
const sig1 = await store.get('SIGNALS', 'ALL');
const fresh1 = freshSince(sig1, t1);
const allowed = new Set([...openPool, seedSym]);
check('Only open markets (+ open positions) are scanned', fresh1.every((s) => allowed.has(s)), `${fresh1.length} scanned`);
check('The open-position market is scanned even when its exchange is closed', fresh1.includes(seedSym));
check('Per-tick fetch count stays within budget', fresh1.length <= 34, `${fresh1.length} fetches`);

// The rotation cursor now lives on the SIGNALS blob, not RECORD.
check('Scan cursor persists on the SIGNALS blob (not RECORD)', Number.isInteger(sig1.scanCursor) && (await store.get('RECORD', 'ALL')).scanCursor === undefined, `SIGNALS.scanCursor=${sig1.scanCursor}`);

// Cadence gate: a tick that fires immediately after should be SKIPPED (too soon) and
// write NOTHING — neither blob's updatedAt moves.
const recBefore = (await store.get('RECORD', 'ALL') || {}).updatedAt;
const sigBefore = (await store.get('SIGNALS', 'ALL') || {}).updatedAt;
const r2 = await runTick(env, store);
const recAfter = (await store.get('RECORD', 'ALL') || {}).updatedAt;
const sigAfter = (await store.get('SIGNALS', 'ALL') || {}).updatedAt;
check('Cadence gate skips a too-soon tick', r2 && r2.skipped === true, JSON.stringify(r2));
check('A skipped tick writes nothing', recBefore === recAfter && sigBefore === sigAfter, 'no blob updatedAt advanced');

// Coverage: with the gate satisfied each round, every OPEN market gets a fresh signal.
for (let i = 0; i < 2; i++) { await allowNext(store); await runTick(env, store); }
const sigN = await store.get('SIGNALS', 'ALL');
const covered = new Set((sigN.signals || []).map((s) => s.symbol));
const openMissing = openPool.filter((s) => !covered.has(s));
check('All OPEN markets covered within a rotation', openMissing.length === 0, openMissing.length ? `missing: ${openMissing.join(',')}` : `${openPool.length}/${openPool.length} open covered`);

console.log(`\nbatch-scan.mjs — ${pass ? 'all checks passed ✅' : 'FAILURES ❌'}`);
process.exit(pass ? 0 : 1);
