// Invariants for the asset-class registry (Phase 0). Descriptive scaffolding must
// stay consistent with markets.js so later phases can safely route through it.
//   node worker/test/classes.mjs
import { MARKETS } from '../src/markets.js';
import { ASSET_CLASSES, CELL_STATUS, STYLES, classFor, assetClassOf, cellStatus, cellMarkets, allCells } from '../src/classes.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } };

// 1. Every market is tagged with a class that the registry declares.
for (const [sym, m] of Object.entries(MARKETS)) {
  ok(m.assetClass, `${sym} has an assetClass`);
  ok(ASSET_CLASSES[m.assetClass], `${sym}'s class "${m.assetClass}" exists in the registry`);
}

// 2. Every universe symbol exists in MARKETS and is tagged to THAT class.
for (const c of Object.values(ASSET_CLASSES)) {
  for (const sym of c.universe) {
    ok(MARKETS[sym], `${c.key}: universe symbol ${sym} exists in MARKETS`);
    ok(MARKETS[sym] && MARKETS[sym].assetClass === c.key, `${sym} is tagged assetClass="${c.key}"`);
  }
}

// 3. Every cell is well-formed: valid status; traded markets ⊆ universe & exist; a
//    live/experiment cell trades at least one market.
for (const c of Object.values(ASSET_CLASSES)) {
  for (const [styleKey, cell] of Object.entries(c.styles || {})) {
    ok(CELL_STATUS.includes(cell.status), `${c.key}/${styleKey}: status "${cell.status}" is valid`);
    const mkts = cellMarkets(c.key, styleKey);
    for (const sym of mkts) {
      ok(MARKETS[sym], `${c.key}/${styleKey}: traded ${sym} exists in MARKETS`);
      ok(c.universe.includes(sym), `${c.key}/${styleKey}: traded ${sym} is within the class universe`);
    }
    if (cell.status === 'live' || cell.status === 'experiment') {
      ok(mkts.length > 0, `${c.key}/${styleKey}: an active cell trades at least one market`);
    }
  }
}

// 4. Helpers behave.
ok(assetClassOf('ES') === 'index', 'assetClassOf(ES) = index');
ok(assetClassOf('BTC') === 'crypto', 'assetClassOf(BTC) = crypto');
ok(assetClassOf('NOPE') === null, 'assetClassOf(unknown) = null');
ok(cellStatus('index', 'swing') === 'live', 'index/swing is live');
ok(cellStatus('crypto', 'swing') === 'experiment', 'crypto/swing is experiment (edge unproven)');
ok(cellStatus('index', 'nope') === null, 'unknown cell = null');
ok(classFor('index') && classFor('index').model === 'tracked', 'index is a tracked class');
ok(!cellMarkets('index', 'swing').includes('XJO'), 'XJO is not in the swing traded set (noTrade)');
ok(!cellMarkets('index', 'day').includes('RTY'), 'RTY is not in the day traded set (net loser intraday)');
ok(STYLES.includes('swing') && STYLES.includes('day'), 'STYLES lists swing + day');
ok(allCells().some((c) => c.classKey === 'index' && c.styleKey === 'day' && c.status === 'experiment'), 'allCells surfaces index/day experiment');

console.log(`\nclasses.mjs — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
