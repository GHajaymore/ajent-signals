// Tests for the "next cash open" label logic (Node's built-in runner — zero dependencies).
//   node --test test/
// nextCashOpenFrom is the pure core (given an exchange-local date + minute-of-day), so it's
// deterministic and testable without mocking the clock. It must skip weekends and US holidays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCashOpenFrom } from '../assets/js/app/marketHours.js';

const D = (year, month, day) => ({ year, month, day });

test('Labor Day (Mon) afternoon → reopens tomorrow', () => {
  // 2026-09-07 is Labor Day; the next open is Tue 2026-09-08.
  assert.equal(nextCashOpenFrom('US', D(2026, 9, 7), 14 * 60), 'tomorrow 9:30 AM ET');
});

test('Friday evening → reopens Monday (skips the weekend)', () => {
  assert.equal(nextCashOpenFrom('US', D(2026, 9, 11), 18 * 60), 'Mon 9:30 AM ET');
});

test('Weekday pre-market → opens later today (no day prefix)', () => {
  assert.equal(nextCashOpenFrom('US', D(2026, 9, 9), 8 * 60), '9:30 AM ET');
});

test('Day before Thanksgiving, after the close → skips the holiday to Friday', () => {
  // Thanksgiving 2026 = Thu Nov 26; Wed Nov 25 evening → next open is Fri Nov 27.
  assert.equal(nextCashOpenFrom('US', D(2026, 11, 25), 17 * 60), 'Fri 9:30 AM ET');
});

test('Christmas Eve evening → skips Christmas + weekend to Monday', () => {
  // Christmas 2026 = Fri Dec 25; Thu Dec 24 evening → Mon Dec 28.
  assert.equal(nextCashOpenFrom('US', D(2026, 12, 24), 18 * 60), 'Mon 9:30 AM ET');
});

test('non-US country falls back to weekend-only (no holiday calendar)', () => {
  // India cash session opens 09:15 IST; Sunday → Monday. No IN holiday calendar, so it
  // never skips a holiday — weekend logic only.
  assert.equal(nextCashOpenFrom('IN', D(2026, 9, 6), 12 * 60), 'tomorrow 9:15 AM IST'); // Sun → Mon
});

test('unknown country → null', () => {
  assert.equal(nextCashOpenFrom('ZZ', D(2026, 9, 7), 600), null);
});
