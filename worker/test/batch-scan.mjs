// Verify the batched split-scan (scheduler.js): each tick scans a rotating window of
// the market universe (not all of it), carries every other market's signal forward, and
// always scans open-position markets so exits aren't delayed. This keeps the per-tick
// subrequest count under Cloudflare's free-tier cap while letting the universe grow.
//   node test/batch-scan.mjs
import { MARKETS } from '../src/markets.js';
import { runTick } from '../src/scheduler.js';

function memStore() {
  const m = new Map(); const k = (pk, sk) => `${pk}|${sk}`;
  return {
    put: async (i) => { m.set(k(i.pk, i.sk), i); },
    get: async (pk, sk) => m.get(k(pk, sk)) || null,
    del: async (pk, sk) => { m.delete(k(pk, sk)); },
    list: async () => [], // no legacy migration in the test
    all: (pk) => [...m.values()].filter((v) => v.pk === pk),
    _map: m,
  };
}

const env = { DATA_PROVIDER: 'yahoo', RISK_DOLLARS: 250, COST_PER_TRADE: 6 };
const total = Object.keys(MARKETS).length;
const store = memStore();

// Seed an OPEN position on a market that will be OUTSIDE the first batch, to prove open
// positions are always scanned. Last symbol in the list is well past batch size (20).
const outsideSym = Object.keys(MARKETS)[total - 1];
await store.put({ pk: 'RECORD', sk: 'ALL', open: { [outsideSym]: { symbol: outsideSym, side: 'LONG', strat: 'mr', entry: 1, stop: 0.5, target1: 2, risk: 0.5, riskDollars: 250, openedAt: Date.now() - 86400000, peak: 1 } }, closed: [], lastClose: {}, migrated: true });

function signalsFresh(blob, sinceMs) {
  const sigs = (blob && blob.signals) || [];
  return sigs.filter((s) => (s.updatedAt || 0) >= sinceMs).map((s) => s.symbol);
}

let pass = true;
const check = (name, cond, detail) => { console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) pass = false; };

console.log(`Universe: ${total} markets · batch ${20} · open seed: ${outsideSym} (index ${total - 1})\n`);

// --- Tick 1 ---
const t1 = Date.now();
await runTick(env, store);
const rec1 = await store.get('RECORD', 'ALL');
const sig1 = await store.get('SIGNALS', 'ALL');
const fresh1 = signalsFresh(sig1, t1);
check('Tick 1 scans a batch, not the whole universe', fresh1.length <= 22 && fresh1.length < total, `${fresh1.length} scanned of ${total}`);
check('Tick 1 always scans the open-position market', fresh1.includes(outsideSym), `${outsideSym} ${fresh1.includes(outsideSym) ? 'scanned' : 'MISSED'}`);
check('Tick 1 advances the scan cursor', rec1.scanCursor === 20 % total, `cursor=${rec1.scanCursor}`);

// --- Tick 2 ---
const t2 = Date.now();
await runTick(env, store);
const rec2 = await store.get('RECORD', 'ALL');
const sig2 = await store.get('SIGNALS', 'ALL');
const fresh2 = signalsFresh(sig2, t2);
check('Tick 2 scans a DIFFERENT batch (cursor moved)', rec2.scanCursor === (20 + 20) % total, `cursor=${rec2.scanCursor}`);
check('Tick 2 still scans the open-position market', fresh2.includes(outsideSym));

// --- Coverage: after enough ticks every market has a signal ---
const ticksToCover = Math.ceil(total / 20) + 1;
for (let i = 0; i < ticksToCover; i++) await runTick(env, store);
const sigN = await store.get('SIGNALS', 'ALL');
const covered = new Set((sigN.signals || []).map((s) => s.symbol));
const missing = Object.keys(MARKETS).filter((s) => !covered.has(s));
check('All markets covered after a full rotation', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `${covered.size}/${total}`);

console.log(`\nbatch-scan.mjs — ${pass ? 'all checks passed ✅' : 'FAILURES ❌'}`);
process.exit(pass ? 0 : 1);
