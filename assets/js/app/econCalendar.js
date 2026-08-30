// Computes the next real date for each recurring US economic release, so the
// calendar advances with the clock instead of showing a frozen day-of-week.
// Rules encode the true cadence (weekly, 1st Friday, last Tuesday, …). Exact
// dates still shift a day or two in practice — the UI keeps the "illustrative,
// verify the official calendar" note. Events with no clean rule (e.g. FOMC,
// which is 8 scheduled meetings a year) return no date and read "scheduled".

function atTime(date, hhmm) {
  const [h, m] = String(hhmm || '08:30').split(':').map(Number);
  const d = new Date(date); d.setHours(h, m, 0, 0); return d;
}
function nextWeekdayOnOrAfter(from, wd) {
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7)); return d;
}
function nthWeekdayOfMonth(y, m, n, wd) {
  const d = new Date(y, m, 1);
  d.setDate(1 + ((wd - d.getDay() + 7) % 7) + (n - 1) * 7); return d;
}
function lastWeekdayOfMonth(y, m, wd) {
  const d = new Date(y, m + 1, 0);
  d.setDate(d.getDate() - ((d.getDay() - wd + 7) % 7)); return d;
}
function firstBusinessDay(y, m) {
  const d = new Date(y, m, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return d;
}
function lastBusinessDay(y, m) {
  const d = new Date(y, m + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); return d;
}

// Next Date at/after `now` for the event's rule, or null if not computable.
export function nextEventDate(ev, now = new Date()) {
  const r = ev.rule;
  if (!r) return null;
  if (r.type === 'weekly') {
    let d = atTime(nextWeekdayOnOrAfter(now, r.wd), ev.time);
    if (d < now) d = atTime(nextWeekdayOnOrAfter(new Date(now.getTime() + 7 * 864e5), r.wd), ev.time);
    return d;
  }
  const y = now.getFullYear(), mo = now.getMonth();
  for (const [yy, mm] of [[y, mo], [mo === 11 ? y + 1 : y, (mo + 1) % 12], [mo >= 10 ? y + 1 : y, (mo + 2) % 12]]) {
    let base = null;
    if (r.type === 'nth-weekday') base = nthWeekdayOfMonth(yy, mm, r.n, r.wd);
    else if (r.type === 'last-weekday') base = lastWeekdayOfMonth(yy, mm, r.wd);
    else if (r.type === 'first-biz') base = firstBusinessDay(yy, mm);
    else if (r.type === 'last-biz') base = lastBusinessDay(yy, mm);
    if (base) { const d = atTime(base, ev.time); if (d >= now) return d; }
  }
  return null;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Events decorated with a computed next date + label, soonest first. Undated
// events (FOMC) sort to the end.
export function upcomingEvents(events, now = new Date()) {
  return events
    .map((e) => {
      const date = nextEventDate(e, now);
      return { ...e, date, label: date ? `${DOW[date.getDay()]}, ${MON[date.getMonth()]} ${date.getDate()}` : 'Scheduled' };
    })
    .sort((a, b) => (a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity));
}

export function daysUntil(date, now = new Date()) {
  if (!date) return null;
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(date); b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 864e5);
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}
