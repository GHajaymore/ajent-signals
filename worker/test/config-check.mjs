// Guards the admin market-control config (config.js): default is "trade everything", saves are
// validated against the real market set (+ deduped), and the disabled set reflects writes. The
// scheduler ANDs this into canOpen, so a bug here could silently halt live trading — keep green.
//   node test/config-check.mjs
import { loadDisabledSet, loadAutoTradeConfig, saveAutoTradeConfig } from '../src/config.js';

const mem = new Map();
const store = { put: (i) => { mem.set(i.pk + '|' + i.sk, i); }, get: async (pk, sk) => mem.get(pk + '|' + sk) || null };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗', m); } };

ok((await loadDisabledSet(store)).size === 0, 'default: nothing disabled (trade all)');
ok((await loadAutoTradeConfig(store)).disabled.length === 0, 'default config empty');

const valid = new Set(['ES', 'NQ', 'BTC']);
const saved = await saveAutoTradeConfig(store, ['ES', 'BOGUS', 'NQ', 'NQ'], valid, 'admin');
ok(saved.disabled.length === 2 && saved.disabled.includes('ES') && saved.disabled.includes('NQ'), 'save validates + dedupes');
ok(!saved.disabled.includes('BOGUS'), 'invalid symbol dropped');

const set = await loadDisabledSet(store);
ok(set.has('ES') && set.has('NQ') && !set.has('BTC'), 'disabled set reflects the save');
const cfg = await loadAutoTradeConfig(store);
ok(cfg.by === 'admin' && cfg.updatedAt > 0, 'config carries by + updatedAt');
ok((await saveAutoTradeConfig(store, [], valid, 'owner')).disabled.length === 0, 'can clear all (re-enable everything)');

console.log(`\nconfig-check.mjs — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
