// The auto-traded markets (Proven daily set) + clock-based session check, mirrored
// from the client so the server never trades a closed market on a stale price.

// symbol -> { yahoo, country, name }
const MARKETS = {
  ES: { yahoo: '^GSPC', country: 'US', name: 'E-mini S&P 500' },
  NQ: { yahoo: '^NDX', country: 'US', name: 'E-mini Nasdaq-100' },
  YM: { yahoo: '^DJI', country: 'US', name: 'E-mini Dow' },
  RTY: { yahoo: '^RUT', country: 'US', name: 'E-mini Russell 2000' },
  XJO: { yahoo: '^AXJO', country: 'AU', name: 'ASX 200' },
  SX5E: { yahoo: '^STOXX50E', country: 'EU', name: 'Euro Stoxx 50' },
  N225: { yahoo: '^N225', country: 'JP', name: 'Nikkei 225' },
  TSX: { yahoo: '^GSPTSE', country: 'CA', name: 'S&P/TSX Composite' },
};

const TZ = { US: 'America/New_York', CA: 'America/Toronto', AU: 'Australia/Sydney', EU: 'Europe/Berlin', JP: 'Asia/Tokyo' };
const SESSION = { US: [570, 960], CA: [570, 960], AU: [600, 960], EU: [540, 1050], JP: [540, 900] };
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return { day: WD[g('weekday')] ?? 1, min: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10) };
}
function isOpen(country) {
  const tz = TZ[country], sess = SESSION[country];
  if (!tz || !sess) return false;
  const n = localNow(tz);
  if (n.day === 0 || n.day === 6) return false;
  return n.min >= sess[0] && n.min < sess[1];
}

module.exports = { MARKETS, isOpen };
