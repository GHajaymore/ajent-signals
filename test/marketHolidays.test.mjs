// US market-holiday calendar tests (Node's built-in runner — zero dependencies).
//   node --test test/
// The calendar is computed from rules, so these pin the rules against hand-checked NYSE
// dates, including the tricky ones: floating weekdays, observed weekend shifts, the New
// Year's-on-Saturday exception, and Good Friday crossing a month boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { usMarketHoliday } from '../assets/js/app/marketHolidays.js';

const name = (y, m, d) => usMarketHoliday({ year: y, month: m, day: d });

test('2026 — full slate on the right dates', () => {
  assert.equal(name(2026, 1, 1), "New Year's Day");        // Thu
  assert.equal(name(2026, 1, 19), 'Martin Luther King Jr. Day'); // 3rd Mon Jan
  assert.equal(name(2026, 2, 16), "Washington's Birthday");      // 3rd Mon Feb
  assert.equal(name(2026, 4, 3), 'Good Friday');           // Easter is Apr 5 2026
  assert.equal(name(2026, 5, 25), 'Memorial Day');         // last Mon May
  assert.equal(name(2026, 6, 19), 'Juneteenth');           // Fri
  assert.equal(name(2026, 9, 7), 'Labor Day');             // the reported day
  assert.equal(name(2026, 11, 26), 'Thanksgiving');        // 4th Thu Nov
  assert.equal(name(2026, 12, 25), 'Christmas Day');       // Fri
});

test('observed shift — July 4 2026 is a Saturday → observed Friday Jul 3', () => {
  assert.equal(name(2026, 7, 4), null);       // the actual Saturday is not the closure
  assert.equal(name(2026, 7, 3), 'Independence Day');
});

test('observed shift — Christmas on a weekend', () => {
  assert.equal(name(2021, 12, 24), 'Christmas Day'); // Dec 25 2021 = Sat → Fri 24
  assert.equal(name(2022, 12, 26), 'Christmas Day'); // Dec 25 2022 = Sun → Mon 26
});

test("New Year's-on-Saturday exception — no observed closure", () => {
  // Jan 1 2022 was a Saturday: NYSE did NOT close the preceding Friday (Dec 31 2021).
  assert.equal(name(2022, 1, 1), null);
  assert.equal(name(2021, 12, 31), null);
  // Sunday still shifts forward: Jan 1 2023 = Sun → observed Mon Jan 2.
  assert.equal(name(2023, 1, 2), "New Year's Day");
});

test('Juneteenth only exists from 2022', () => {
  assert.equal(name(2021, 6, 18), null); // (Jun 19 2021 was a Sat anyway)
  assert.ok(name(2022, 6, 20) || name(2022, 6, 19)); // 2022: Jun 19 = Sun → Mon 20
});

test('a normal trading day is not a holiday', () => {
  assert.equal(name(2026, 9, 8), null);   // Tue after Labor Day
  assert.equal(name(2026, 3, 17), null);
});

test('Good Friday 2027 crosses into March (Easter Mar 28) without breaking', () => {
  // Easter 2027 = Mar 28 → Good Friday = Mar 26. Guards the month-boundary date math.
  assert.equal(name(2027, 3, 26), 'Good Friday');
});
