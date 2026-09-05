// Clock-based exchange sessions. This makes "Market open / closed" instant and
// reliable — derived from the current time in the exchange's own timezone (DST is
// handled by the IANA zone), NOT from a fetched quote's marketState (which lags
// behind the proxy and can't tell us anything until a quote arrives).

const TZ = {
  US: 'America/New_York', CA: 'America/Toronto', IN: 'Asia/Kolkata', GB: 'Europe/London',
  DE: 'Europe/Berlin', EU: 'Europe/Berlin', JP: 'Asia/Tokyo', HK: 'Asia/Hong_Kong',
  CN: 'Asia/Shanghai', AU: 'Australia/Sydney', BR: 'America/Sao_Paulo', SG: 'Asia/Singapore',
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
  return n.min >= sess[0] && n.min < sess[1];
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
