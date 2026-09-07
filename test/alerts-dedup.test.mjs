// Regression test for the duplicate-alerts fix. A held signal can re-enter BUY when its feed
// goes briefly stale then refreshes, re-firing the SAME alert; dedupeAlerts collapses those.
// Keyed on TITLE within 12h, so it must NOT conflate a signal alert with a fill or a close,
// and must still let a genuine re-fire show after the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeAlerts } from '../assets/js/app/mockEngine.js';

const H = 60 * 60 * 1000;
const t0 = 1_700_000_000_000; // fixed base (no Date.now — deterministic)

test('collapses identical titles within 12h to one (newest kept)', () => {
  const out = dedupeAlerts([
    { title: 'BUY · YM', ts: t0 },
    { title: 'BUY · YM', ts: t0 - 5 * 60 * 1000 },   // 5 min earlier — dup
    { title: 'BUY · SX5E', ts: t0 - 3 * H },
    { title: 'BUY · SX5E', ts: t0 - 3 * H - 60 * 1000 }, // dup
    { title: 'BUY · SX5E', ts: t0 - 4 * H },              // still within 12h of the others — dup
  ]);
  assert.deepEqual(out.map((a) => a.title), ['BUY · YM', 'BUY · SX5E']);
});

test('allows a genuine re-fire after the 12h window', () => {
  const out = dedupeAlerts([
    { title: 'BUY · YM', ts: t0 },
    { title: 'BUY · YM', ts: t0 - 13 * H }, // >12h earlier — a separate fire, keep it
  ]);
  assert.equal(out.length, 2);
});

test('does not conflate different event types for the same symbol', () => {
  const out = dedupeAlerts([
    { title: 'BUY · YM', ts: t0 },
    { title: 'Filled · YM', ts: t0 },
    { title: 'Win · YM', ts: t0 },
  ]);
  assert.equal(out.length, 3); // signal, fill, close are distinct titles
});

test('different symbols are independent', () => {
  const out = dedupeAlerts([
    { title: 'BUY · YM', ts: t0 },
    { title: 'BUY · NQ', ts: t0 },
  ]);
  assert.equal(out.length, 2);
});

test('alerts without a title are never dropped', () => {
  const out = dedupeAlerts([{ ts: t0 }, { ts: t0 }, { title: 'BUY · YM', ts: t0 }]);
  assert.equal(out.length, 3);
});
