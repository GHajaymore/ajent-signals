// Clock-based exchange sessions. This makes "Market open / closed" instant and
// reliable — derived from the current time in the exchange's own timezone (DST is
// handled by the IANA zone), NOT from a fetched quote's marketState (which lags
// behind the proxy and can't tell us anything until a quote arrives).
import { usMarketHoliday } from './marketHolidays.js';

const TZ = {
  US: 'America/New_York', CA: 'America/Toronto', IN: 'Asia/Kolkata', GB: 'Europe/London',
  DE: 'Europe/Berlin', EU: 'Europe/Berlin', JP: 'Asia/Tokyo', HK: 'Asia/Hong_Kong',
  CN: 'Asia/Shanghai', AU: 'Australia/Sydney', BR: 'America/Sao_Paulo', SG: 'Asia/Singapore',
  KR: 'Asia/Seoul', FR: 'Europe/Paris',
};

// Regular cash-session [openMinute, closeMinute] in local exchange time, Mon–Fri.
const SESSION = {
  US: [570, 960],   // 09:30–16:00 ET
  CA: [570, 960],   // 09:30–16:00 ET
  IN: [555, 930],   // 09:15–15:30 IST
  GB: [480, 990],   // 08:00–16:30 London
  DE: [540, 1050], EU: [540, 1050], // 09:00–17:30 CET
  JP: [540, 900],   // 09:00–15:00 JST
  HK: [570, 960],   // 09:30–16:00 HKT
  CN: [570, 900],   // 09:30–15:00 CST
  KR: [540, 930],   // 09:00–15:30 KST
  FR: [540, 1050],  // 09:00–17:30 CET
  AU: [600, 960],   // 10:00–16:00 AEST
  BR: [600, 1020],  // 10:00–17:00 BRT
  SG: [540, 1020],  // 09:00–17:00 SGT
};

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { day: 0–6, min: minutes-since-local-midnight } for a given IANA timezone.
function localNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return { day: WD[get('weekday')] ?? 1, min: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
  } catch (e) {
    return null;
  }
}

// The calendar date { year, month, day } (month 1-12) in a given IANA timezone.
function localDate(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => parseInt(parts.find((p) => p.type === t)?.value, 10);
    return { year: get('year'), month: get('month'), day: get('day') };
  } catch (e) {
    return null;
  }
}

// The market holiday closing a country's CASH exchange today — name, or null. US-only for
// now (the app's only cash-equity country); other countries have no calendar yet, so null.
export function marketHolidayToday(country) {
  if (country !== 'US') return null;
  const d = localDate(TZ.US);
  return d ? usMarketHoliday(d) : null;
}

// Categories sourced from real =F futures (CL=F, SI=F, ZN=F…) — these trade
// nearly 24h on CME Globex/NYMEX/COMEX, unlike the index markets which we source
// from cash indices (only live during the cash session).
const FUTURES_24H = new Set(['Index', 'Energy', 'Metals', 'Rates', 'Ags']);

// Returns 'open' | 'closed' | 'unknown'. Crypto is always open; FX is 24/5.
export function marketSession(market) {
  const cat = market.category;
  if (cat === 'Crypto') return 'open';
  if (cat === 'Currencies') {
    const n = localNow('America/New_York'); if (!n) return 'unknown';
    if (n.day === 6) return 'closed';                       // Saturday
    if (n.day === 5 && n.min >= 17 * 60) return 'closed';   // after Fri 5pm ET
    if (n.day === 0 && n.min < 17 * 60) return 'closed';    // before Sun 5pm ET
    return 'open';
  }
  // CME Globex futures: Sun 18:00 ET → Fri 17:00 ET, with a daily 17:00–18:00 ET
  // maintenance halt. (These carry a live =F feed, so "open" here means real data.)
  if (FUTURES_24H.has(cat)) {
    const n = localNow('America/New_York'); if (!n) return 'unknown';
    if (n.day === 6) return 'closed';                       // Saturday
    if (n.day === 5 && n.min >= 17 * 60) return 'closed';   // after Fri 5pm ET
    if (n.day === 0 && n.min < 18 * 60) return 'closed';    // before Sun 6pm ET
    if (n.min >= 17 * 60 && n.min < 18 * 60) return 'closed'; // daily maintenance break
    return 'open';
  }
  const tz = TZ[market.country], sess = SESSION[market.country];
  if (!tz || !sess) return 'unknown';
  const n = localNow(tz); if (!n) return 'unknown';
  if (n.day === 0 || n.day === 6) return 'closed';          // weekend
  if (marketHolidayToday(market.country)) return 'closed';  // market holiday (US cash)
  return (n.min >= sess[0] && n.min < sess[1]) ? 'open' : 'closed';
}

export function isMarketOpen(market) { return marketSession(market) === 'open'; }
export function isMarketClosed(market) { return marketSession(market) === 'closed'; }

// Is a country's cash exchange open right now? true/false, or null if we don't have
// that country's session. Weekends closed; DST handled by the IANA zone.
export function countryOpen(country) {
  const tz = TZ[country], sess = SESSION[country];
  if (!tz || !sess) return null;
  const n = localNow(tz); if (!n) return null;
  if (n.day === 0 || n.day === 6) return false;
  if (marketHolidayToday(country)) return false;            // market holiday (US cash)
  return n.min >= sess[0] && n.min < sess[1];
}

const DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Short, friendly timezone label per exchange for the "reopens …" note.
const TZ_ABBR = {
  US: 'ET', CA: 'ET', IN: 'IST', GB: 'UK', DE: 'CET', EU: 'CET', FR: 'CET',
  JP: 'JST', HK: 'HKT', CN: 'CST', KR: 'KST', AU: 'AEST', BR: 'BRT', SG: 'SGT',
};
function fmtClock(min) {
  let h = Math.floor(min / 60); const mm = min % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  h %= 12; if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
}

// Pure core (testable): the next cash-open label given the exchange-local date + minute now.
// Walks forward day by day, skipping weekends and — for the US — market holidays.
export function nextCashOpenFrom(country, today, nowMin) {
  const sess = SESSION[country]; if (!sess || !today) return null;
  const openMin = sess[0];
  const isHol = (y, m, d) => (country === 'US' ? !!usMarketHoliday({ year: y, month: m, day: d }) : false);
  for (let off = 0; off <= 9; off++) {
    const dt = new Date(Date.UTC(today.year, today.month - 1, today.day + off));
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate(), dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) continue;         // weekend
    if (isHol(y, m, d)) continue;                 // market holiday (US)
    if (off === 0 && nowMin >= openMin) continue; // today's open already passed
    const when = off === 0 ? '' : off === 1 ? 'tomorrow ' : `${DOW_NAME[dow]} `;
    return `${when}${fmtClock(openMin)}${TZ_ABBR[country] ? ` ${TZ_ABBR[country]}` : ''}`;
  }
  return null;
}
// The next time a country's CASH exchange opens, as a short label ("tomorrow 9:30 AM ET").
export function nextCashOpen(country) {
  const tz = TZ[country]; if (!tz || !SESSION[country]) return null;
  const today = localDate(tz), n = localNow(tz);
  return today && n ? nextCashOpenFrom(country, today, n.min) : null;
}

// A note for when a country's CASH market is closed for a NON-obvious reason (weekend or
// holiday) — with when it reopens. null during normal hours and routine weekday overnight
// (those are obvious, no note needed). US holidays are known by name; other countries fall
// back to weekend detection only.
export function cashClosureNote(country) {
  const tz = TZ[country]; if (!tz || !SESSION[country]) return null;
  const n = localNow(tz); if (!n) return null;
  const hol = country === 'US' ? usMarketHoliday(localDate(tz)) : null;
  const weekend = n.day === 0 || n.day === 6;
  if (!hol && !weekend) return null;
  return { reason: hol ? 'holiday' : 'weekend', name: hol || null, reopen: nextCashOpen(country) };
}

// The major world exchanges, west→east, with their live open/closed state — for the
// "markets open now" strip at the top of the board. Local exchange clocks, real DST.
const MAJOR_SESSIONS = [
  { c: 'US', flag: '🇺🇸', label: 'New York' },
  { c: 'BR', flag: '🇧🇷', label: 'São Paulo' },
  { c: 'GB', flag: '🇬🇧', label: 'London' },
  { c: 'EU', flag: '🇪🇺', label: 'Frankfurt' },
  { c: 'IN', flag: '🇮🇳', label: 'Mumbai' },
  { c: 'HK', flag: '🇭🇰', label: 'Hong Kong' },
  { c: 'JP', flag: '🇯🇵', label: 'Tokyo' },
  { c: 'AU', flag: '🇦🇺', label: 'Sydney' },
];
export function openSessions() {
  return MAJOR_SESSIONS.map((s) => ({ ...s, open: !!countryOpen(s.c) }));
}
