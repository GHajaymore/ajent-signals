// US stock-market (NYSE / Nasdaq) full-closure holidays, computed from the rules rather
// than a hard-coded list — so it stays correct every year with no maintenance. The wall
// clock alone can't tell a holiday from a normal weekday (Labor Day looks like any Monday),
// which made the app report "US market open" on holidays; this closes that gap.
//
// Scope: US CASH equities only (the exchange the "US market" pill and world strip describe).
// CME Globex index futures still trade most of these days on their own schedule, so this is
// deliberately not applied to the futures session. Early-close half-days (the market is still
// open until 1pm ET) are intentionally omitted — only full closures live here. Extendable to
// other countries later; today it is US-only and callers pass the country through.

const dowOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat

// Date of the Nth given weekday in a month, e.g. 3rd Monday. weekday: 0=Sun … 6=Sat.
function nthWeekday(y, m, weekday, n) {
  const first = dowOf(y, m, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
// Date of the LAST given weekday in a month (e.g. last Monday of May).
function lastWeekday(y, m, weekday) {
  const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDate - ((dowOf(y, m, lastDate) - weekday + 7) % 7);
}
// Easter Sunday (Gregorian / Anonymous computus) → { m, d }.
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, mth = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mth + 114) / 31);
  return { m: month, d: ((h + l - 7 * mth + 114) % 31) + 1 };
}
// NYSE observed-date rule: a holiday on Saturday is observed the preceding Friday; on Sunday,
// the following Monday. (New Year's Day is handled separately — its Saturday case is skipped.)
function observed(y, m, d) {
  const dow = dowOf(y, m, d);
  const shift = dow === 6 ? -1 : dow === 0 ? 1 : 0;
  if (!shift) return { m, d };
  const t = new Date(Date.UTC(y, m - 1, d + shift));
  return { m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const cache = new Map(); // year → Map<"m-d", name>

// The full-closure holidays for a given year, keyed by observed "month-day".
function holidaysForYear(y) {
  if (cache.has(y)) return cache.get(y);
  const map = new Map();
  const add = ({ m, d }, name) => map.set(`${m}-${d}`, name);

  // New Year's Day — the one exception to the Saturday rule: when Jan 1 is a Saturday there
  // is no observed closure; Sunday shifts to Monday; a weekday stays put.
  if (dowOf(y, 1, 1) !== 6) add(observed(y, 1, 1), "New Year's Day");
  add({ m: 1, d: nthWeekday(y, 1, 1, 3) }, 'Martin Luther King Jr. Day');   // 3rd Mon Jan
  add({ m: 2, d: nthWeekday(y, 2, 1, 3) }, "Washington's Birthday");        // 3rd Mon Feb
  const es = easter(y);                                                      // Good Friday = Easter − 2
  const gf = new Date(Date.UTC(y, es.m - 1, es.d - 2));                      // date math crosses month ends
  add({ m: gf.getUTCMonth() + 1, d: gf.getUTCDate() }, 'Good Friday');
  add({ m: 5, d: lastWeekday(y, 5, 1) }, 'Memorial Day');                    // last Mon May
  if (y >= 2022) add(observed(y, 6, 19), 'Juneteenth');                      // Jun 19 (from 2022)
  add(observed(y, 7, 4), 'Independence Day');                                // Jul 4
  add({ m: 9, d: nthWeekday(y, 9, 1, 1) }, 'Labor Day');                     // 1st Mon Sep
  add({ m: 11, d: nthWeekday(y, 11, 4, 4) }, 'Thanksgiving');                // 4th Thu Nov
  add(observed(y, 12, 25), 'Christmas Day');                                 // Dec 25

  cache.set(y, map);
  return map;
}

// Name of the US market holiday on the given calendar date, or null. Takes a plain
// { year, month, day } (month 1-12) already resolved to the exchange's timezone.
export function usMarketHoliday({ year, month, day }) {
  if (year == null || month == null || day == null) return null;
  return holidaysForYear(year).get(`${month}-${day}`) || null;
}
