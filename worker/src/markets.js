// Auto-traded markets (Proven daily set) + clock-based sessions, ESM.
// US index markets source the real =F futures (24h Globex, real but ~15-25m
// delayed on free Yahoo) so the record is live off-hours, not frozen at the cash
// close. Global indices stay on their cash symbol / local session.
export const MARKETS = {
  ES: { yahoo: 'ES=F', td: 'SPX', country: 'US', futures: true, name: 'E-mini S&P 500' },
  NQ: { yahoo: 'NQ=F', td: 'NDX', country: 'US', futures: true, name: 'E-mini Nasdaq-100' },
  YM: { yahoo: 'YM=F', td: 'DJI', country: 'US', futures: true, name: 'E-mini Dow' },
  RTY: { yahoo: 'RTY=F', td: 'RUT', country: 'US', futures: true, name: 'E-mini Russell 2000' },
  XJO: { yahoo: '^AXJO', country: 'AU', name: 'ASX 200' },
  SX5E: { yahoo: '^STOXX50E', country: 'EU', name: 'Euro Stoxx 50' },
  N225: { yahoo: '^N225', country: 'JP', name: 'Nikkei 225' },
  TSX: { yahoo: '^GSPTSE', country: 'CA', name: 'S&P/TSX Composite' },
  // Crypto trades 24/7 — a natural fit for the always-on server loop. Same
  // RSI-2 mean-reversion strategy applied to real BTC-USD / ETH-USD daily candles.
  BTC: { yahoo: 'BTC-USD', country: 'US', crypto: true, name: 'Bitcoin' },
  ETH: { yahoo: 'ETH-USD', country: 'US', crypto: true, name: 'Ether' },
};

const TZ = { US: 'America/New_York', CA: 'America/Toronto', AU: 'Australia/Sydney', EU: 'Europe/Berlin', JP: 'Asia/Tokyo' };
const SESSION = { US: [570, 960], CA: [570, 960], AU: [600, 960], EU: [540, 1050], JP: [540, 900] };
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return { day: WD[g('weekday')] ?? 1, min: (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10) };
}
// Pass the whole market meta. Futures markets use the CME Globex 24h session
// (Sun 18:00 ET → Fri 17:00 ET, daily 17:00–18:00 ET maintenance halt); cash
// index markets use their local exchange session.
export function isOpen(meta) {
  if (meta && meta.crypto) return true;                 // 24/7, never closes
  if (meta && meta.futures) {
    const n = localNow('America/New_York');
    if (n.day === 6) return false;                      // Saturday
    if (n.day === 5 && n.min >= 17 * 60) return false;  // after Fri 5pm ET
    if (n.day === 0 && n.min < 18 * 60) return false;   // before Sun 6pm ET
    if (n.min >= 17 * 60 && n.min < 18 * 60) return false; // daily maintenance
    return true;
  }
  const country = meta && meta.country;
  const tz = TZ[country], sess = SESSION[country];
  if (!tz || !sess) return false;
  const n = localNow(tz);
  if (n.day === 0 || n.day === 6) return false;
  return n.min >= sess[0] && n.min < sess[1];
}
