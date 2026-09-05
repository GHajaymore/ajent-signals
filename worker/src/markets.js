// Auto-traded markets (Proven daily set) + clock-based sessions, ESM.
// US index markets source the real =F futures (24h Globex, real but ~15-25m
// delayed on free Yahoo) so the record is live off-hours, not frozen at the cash
// close. Global indices stay on their cash symbol / local session.
// `assetClass` (added 2026-09-03, Phase 0) groups each market for the multi-asset
// registry in classes.js. It's descriptive scaffolding — the schedulers still own
// trading — so tagging changes no behaviour. Equity indices (US futures + global
// cash indices) are the proven domain; crypto is a separate, edge-unproven class.
export const MARKETS = {
  ES: { yahoo: 'ES=F', td: 'SPX', country: 'US', futures: true, assetClass: 'index', name: 'E-mini S&P 500' },
  NQ: { yahoo: 'NQ=F', td: 'NDX', country: 'US', futures: true, assetClass: 'index', name: 'E-mini Nasdaq-100' },
  YM: { yahoo: 'YM=F', td: 'DJI', country: 'US', futures: true, assetClass: 'index', name: 'E-mini Dow' },
  RTY: { yahoo: 'RTY=F', td: 'RUT', country: 'US', futures: true, assetClass: 'index', name: 'E-mini Russell 2000' },
  // ASX 200: the robustness sweep found the recipe does NOT fit it (PF ~0.75, a
  // net loser over ~2y), so it's excluded from auto-trading — its signal still
  // shows, but it's not opened into the tracked record. (2026-09-02, sweep.mjs.)
  XJO: { yahoo: '^AXJO', country: 'AU', assetClass: 'index', name: 'ASX 200', noTrade: true },
  SX5E: { yahoo: '^STOXX50E', country: 'EU', assetClass: 'index', name: 'Euro Stoxx 50' },
  N225: { yahoo: '^N225', country: 'JP', assetClass: 'index', name: 'Nikkei 225' },
  TSX: { yahoo: '^GSPTSE', country: 'CA', assetClass: 'index', name: 'S&P/TSX Composite' },
  // Most-traded EUROPE + ASIA cash indices — same validated equity mean-reversion recipe
  // as the other indices; they classify to their region by country (GB/DE→Europe, HK/IN→Asia).
  FTSE: { yahoo: '^FTSE', country: 'GB', assetClass: 'index', name: 'FTSE 100' },
  DAX: { yahoo: '^GDAXI', country: 'DE', assetClass: 'index', name: 'DAX 40' },
  HSI: { yahoo: '^HSI', country: 'HK', assetClass: 'index', name: 'Hang Seng' },
  NIFTY: { yahoo: '^NSEI', country: 'IN', assetClass: 'index', name: 'Nifty 50' },
  // Crypto trades 24/7 — a natural fit for the always-on server loop. Same
  // RSI-2 mean-reversion strategy applied to real BTC-USD / ETH-USD daily candles.
  BTC: { yahoo: 'BTC-USD', country: 'US', crypto: true, assetClass: 'crypto', name: 'Bitcoin' },
  ETH: { yahoo: 'ETH-USD', country: 'US', crypto: true, assetClass: 'crypto', name: 'Ether' },
  // Sector ETFs — Phase 1 (2026-09-04). Lab-validated (test/phase1.mjs): the swing
  // mean-reversion edge holds on these new underlyings (8/8 sectors positive; SMH
  // PF 6.25, XLK 3.14, XLF 2.45). US cash session. Traded into the swing record.
  SMH: { yahoo: 'SMH', country: 'US', assetClass: 'etf', name: 'Semiconductors' },
  XLK: { yahoo: 'XLK', country: 'US', assetClass: 'etf', name: 'Technology' },
  XLF: { yahoo: 'XLF', country: 'US', assetClass: 'etf', name: 'Financials' },
  XLE: { yahoo: 'XLE', country: 'US', assetClass: 'etf', name: 'Energy' },
  XLV: { yahoo: 'XLV', country: 'US', assetClass: 'etf', name: 'Health Care' },
  XLY: { yahoo: 'XLY', country: 'US', assetClass: 'etf', name: 'Consumer Disc.' },
  // The three most-traded broad-market ETFs — what most retail traders actually hold.
  SPY: { yahoo: 'SPY', country: 'US', assetClass: 'etf', name: 'S&P 500' },
  QQQ: { yahoo: 'QQQ', country: 'US', assetClass: 'etf', name: 'Nasdaq 100' },
  IWM: { yahoo: 'IWM', country: 'US', assetClass: 'etf', name: 'Russell 2000' },
  // FX majors — BOTH-WAYS symmetric mean-reversion (engine 'mrBoth', src/bothways.js).
  // EXPERIMENT cell: validated through the promotion gate (test/promote.mjs, 5/5) but
  // modest backtest n, so tracked + clearly unproven, not 'live'. FX has no up-drift,
  // so the edge trades long AND short. 24/5 session (treated like futures).
  EURUSD: { yahoo: 'EURUSD=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'Euro / US Dollar' },
  GBPUSD: { yahoo: 'GBPUSD=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'British Pound / US Dollar' },
  USDJPY: { yahoo: 'USDJPY=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'US Dollar / Japanese Yen' },
  AUDUSD: { yahoo: 'AUDUSD=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'Australian Dollar / US Dollar' },
  USDCAD: { yahoo: 'USDCAD=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'US Dollar / Canadian Dollar' },
  USDCHF: { yahoo: 'USDCHF=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'US Dollar / Swiss Franc' },
  NZDUSD: { yahoo: 'NZDUSD=X', country: 'US', fx: true, assetClass: 'fx', engine: 'mrBoth', cell: 'fx', name: 'New Zealand Dollar / US Dollar' },
  // Commodity futures — BOTH-WAYS (RSI2 dip/pop + SMA50 trend side + momentum). Same
  // EXPERIMENT status. 24h Globex session.
  GC: { yahoo: 'GC=F', country: 'US', futures: true, assetClass: 'commodity', engine: 'mrBoth', cell: 'commodity', name: 'Gold' },
  SI: { yahoo: 'SI=F', country: 'US', futures: true, assetClass: 'commodity', engine: 'mrBoth', cell: 'commodity', name: 'Silver' },
  HG: { yahoo: 'HG=F', country: 'US', futures: true, assetClass: 'commodity', engine: 'mrBoth', cell: 'commodity', name: 'Copper' },
  CL: { yahoo: 'CL=F', country: 'US', futures: true, assetClass: 'commodity', engine: 'mrBoth', cell: 'commodity', name: 'Crude Oil' },
  NG: { yahoo: 'NG=F', country: 'US', futures: true, assetClass: 'commodity', engine: 'mrBoth', cell: 'commodity', name: 'Natural Gas' },
};

const TZ = { US: 'America/New_York', CA: 'America/Toronto', AU: 'Australia/Sydney', EU: 'Europe/Berlin', JP: 'Asia/Tokyo', GB: 'Europe/London', DE: 'Europe/Berlin', HK: 'Asia/Hong_Kong', IN: 'Asia/Kolkata' };
const SESSION = { US: [570, 960], CA: [570, 960], AU: [600, 960], EU: [540, 1050], JP: [540, 900], GB: [480, 990], DE: [540, 1050], HK: [570, 960], IN: [555, 930] };
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
  if (meta && (meta.futures || meta.fx)) {               // FX ≈ 24/5, like Globex
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
