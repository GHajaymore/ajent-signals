// Mock signal-engine — mirrors the shapes in design_handoff_ajent/API_AND_DATA_MODEL.md.
// Illustrative only: replace with a licensed real-time feed + real confluence engine in production.

export const CATEGORY_ORDER = ['Index', 'Global Index', 'Currencies', 'Energy', 'Metals', 'Rates', 'Crypto', 'Volatility', 'Ags'];

// The label to show for a SIM placeholder's timeframe, matching the active
// strategy (Proven daily = 1D, Active intraday = 15m). Read straight from the
// persisted settings so mockEngine needs no import of state (which imports it).
function currentTimeframe() {
  try { return JSON.parse(localStorage.getItem('ajent_settings_v1') || '{}').strategyMode === 'intraday' ? '15m' : '1D'; }
  catch (e) { return '1D'; }
}

// Honest, human reasons derived from the real server signal drivers (RSI2 + trend).
function serverReasons(sig, trend) {
  const r = Math.round(sig.rsi2 ?? 50);
  const tl = trend.toLowerCase();
  if (sig.verdict === 'BUY') return [
    `Oversold dip — RSI2 at ${r} (below 15) inside a ${tl} uptrend.`,
    'This is a <b>buy-the-dip</b> (mean-reversion): we go LONG expecting the pullback to bounce back up — we do <b>not</b> short a falling market.',
    'It profits only if price recovers; it closes when RSI2 snaps back above 65, or on its stop.',
  ];
  if (sig.verdict === 'SELL') return [
    `Overbought pop — RSI2 at ${r} (above 85) inside a ${tl} downtrend.`,
    'The mirror of the buy: we go SHORT expecting an over-extended rally to fade back down.',
    'Provisional side — the short is weaker on stock indices (they drift up over time).',
  ];
  return ['No setup right now — the market isn\'t stretched enough to trade.', `Trend is ${tl}; waiting for a genuine oversold dip in an uptrend before entering.`];
}

const MARKET_DEFS = [
  { symbol: 'ES', name: 'E-mini S&P 500', category: 'Index', exchange: 'CME', country: 'US', decimals: 2, pointValue: 50, basePrice: 5921.75, atrPct: 0.006 },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', category: 'Index', exchange: 'CME', country: 'US', decimals: 2, pointValue: 5, basePrice: 5921.75, atrPct: 0.006 },
  { symbol: 'NQ', name: 'E-mini Nasdaq-100', category: 'Index', exchange: 'CME', country: 'US', decimals: 2, pointValue: 20, basePrice: 21072.46, atrPct: 0.008 },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', category: 'Index', exchange: 'CME', country: 'US', decimals: 2, pointValue: 2, basePrice: 21033.93, atrPct: 0.008 },
  { symbol: 'YM', name: 'E-mini Dow', category: 'Index', exchange: 'CBOT', country: 'US', decimals: 0, pointValue: 5, basePrice: 43686, atrPct: 0.006 },
  { symbol: 'RTY', name: 'E-mini Russell 2000', category: 'Index', exchange: 'CME', country: 'US', decimals: 1, pointValue: 50, basePrice: 2277.7, atrPct: 0.009 },
  { symbol: 'NIFTY', name: 'Nifty 50', category: 'Global Index', exchange: 'NSE', country: 'IN', decimals: 2, pointValue: 75, basePrice: 24800, atrPct: 0.009 },
  { symbol: 'BNF', name: 'Bank Nifty', category: 'Global Index', exchange: 'NSE', country: 'IN', decimals: 2, pointValue: 35, basePrice: 53500, atrPct: 0.011 },
  { symbol: 'SENSEX', name: 'BSE Sensex', category: 'Global Index', exchange: 'BSE', country: 'IN', decimals: 0, pointValue: 10, basePrice: 81200, atrPct: 0.009 },
  { symbol: 'FTSE', name: 'FTSE 100', category: 'Global Index', exchange: 'LSE', country: 'GB', decimals: 1, pointValue: 10, basePrice: 8250, atrPct: 0.007 },
  { symbol: 'DAX', name: 'DAX 40', category: 'Global Index', exchange: 'XETRA', country: 'DE', decimals: 1, pointValue: 25, basePrice: 18700, atrPct: 0.008 },
  { symbol: 'N225', name: 'Nikkei 225', category: 'Global Index', exchange: 'TSE', country: 'JP', decimals: 0, pointValue: 5, basePrice: 39800, atrPct: 0.009 },
  { symbol: 'HSI', name: 'Hang Seng Index', category: 'Global Index', exchange: 'HKEX', country: 'HK', decimals: 0, pointValue: 50, basePrice: 17600, atrPct: 0.013 },
  { symbol: 'SSE', name: 'Shanghai Composite', category: 'Global Index', exchange: 'SSE', country: 'CN', decimals: 2, pointValue: 300, basePrice: 3050, atrPct: 0.011 },
  { symbol: 'XJO', name: 'ASX 200', category: 'Global Index', exchange: 'ASX', country: 'AU', decimals: 1, pointValue: 25, basePrice: 7950, atrPct: 0.007 },
  { symbol: 'TSX', name: 'S&P/TSX Composite', category: 'Global Index', exchange: 'TSX', country: 'CA', decimals: 0, pointValue: 5, basePrice: 23400, atrPct: 0.007 },
  { symbol: 'BVSP', name: 'Bovespa', category: 'Global Index', exchange: 'B3', country: 'BR', decimals: 0, pointValue: 1, basePrice: 128000, atrPct: 0.014 },
  { symbol: 'STI', name: 'Straits Times Index', category: 'Global Index', exchange: 'SGX', country: 'SG', decimals: 2, pointValue: 10, basePrice: 3350, atrPct: 0.007 },
  { symbol: 'SX5E', name: 'Euro Stoxx 50', category: 'Global Index', exchange: 'Eurex', country: 'EU', decimals: 1, pointValue: 10, basePrice: 4950, atrPct: 0.009 },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'Currencies', exchange: 'FX', country: 'EU', decimals: 4, pointValue: 10000, basePrice: 1.085, atrPct: 0.005 },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', category: 'Currencies', exchange: 'FX', country: 'GB', decimals: 4, pointValue: 10000, basePrice: 1.268, atrPct: 0.006 },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', category: 'Currencies', exchange: 'FX', country: 'JP', decimals: 3, pointValue: 100, basePrice: 150.25, atrPct: 0.005 },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', category: 'Currencies', exchange: 'FX', country: 'CH', decimals: 4, pointValue: 10000, basePrice: 0.882, atrPct: 0.005 },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', category: 'Currencies', exchange: 'FX', country: 'AU', decimals: 4, pointValue: 10000, basePrice: 0.655, atrPct: 0.006 },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', category: 'Currencies', exchange: 'FX', country: 'CA', decimals: 4, pointValue: 10000, basePrice: 1.398, atrPct: 0.005 },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', category: 'Currencies', exchange: 'FX', country: 'NZ', decimals: 4, pointValue: 10000, basePrice: 0.592, atrPct: 0.006 },
  { symbol: 'USDINR', name: 'US Dollar / Indian Rupee', category: 'Currencies', exchange: 'FX', country: 'IN', decimals: 3, pointValue: 100, basePrice: 84.45, atrPct: 0.003 },
  { symbol: 'CL', name: 'Crude Oil', category: 'Energy', exchange: 'NYMEX', country: 'US', decimals: 2, pointValue: 1000, basePrice: 71.89, atrPct: 0.018 },
  { symbol: 'NG', name: 'Natural Gas', category: 'Energy', exchange: 'NYMEX', country: 'US', decimals: 3, pointValue: 10000, basePrice: 3.142, atrPct: 0.03 },
  { symbol: 'GC', name: 'Gold', category: 'Metals', exchange: 'COMEX', country: 'US', decimals: 1, pointValue: 100, basePrice: 2648.4, atrPct: 0.009 },
  { symbol: 'SI', name: 'Silver', category: 'Metals', exchange: 'COMEX', country: 'US', decimals: 3, pointValue: 5000, basePrice: 31.42, atrPct: 0.016 },
  { symbol: 'HG', name: 'Copper', category: 'Metals', exchange: 'COMEX', country: 'US', decimals: 4, pointValue: 25000, basePrice: 4.352, atrPct: 0.014 },
  { symbol: 'ZN', name: '10-Year T-Note', category: 'Rates', exchange: 'CBOT', country: 'US', decimals: 3, pointValue: 1000, basePrice: 109.516, atrPct: 0.003 },
  { symbol: 'ZB', name: '30-Year T-Bond', category: 'Rates', exchange: 'CBOT', country: 'US', decimals: 3, pointValue: 1000, basePrice: 118.25, atrPct: 0.005 },
  { symbol: 'BTC', name: 'Bitcoin', category: 'Crypto', exchange: 'CME', country: 'US', decimals: 0, pointValue: 5, basePrice: 68210, atrPct: 0.022 },
  { symbol: 'ETH', name: 'Ether', category: 'Crypto', exchange: 'CME', country: 'US', decimals: 1, pointValue: 50, basePrice: 3384.2, atrPct: 0.026 },
  { symbol: 'VIX', name: 'Cboe Volatility Index', category: 'Volatility', exchange: 'CFE', country: 'US', decimals: 2, pointValue: 1000, basePrice: 14.22, atrPct: 0.05 },
  { symbol: 'ZC', name: 'Corn', category: 'Ags', exchange: 'CBOT', country: 'US', decimals: 2, pointValue: 50, basePrice: 445.25, atrPct: 0.012 },
  { symbol: 'ZS', name: 'Soybeans', category: 'Ags', exchange: 'CBOT', country: 'US', decimals: 2, pointValue: 50, basePrice: 1151.5, atrPct: 0.012 },
  { symbol: 'ZW', name: 'Wheat', category: 'Ags', exchange: 'CBOT', country: 'US', decimals: 2, pointValue: 50, basePrice: 579.75, atrPct: 0.016 },
  { symbol: 'KC', name: 'Coffee', category: 'Ags', exchange: 'ICE', country: 'US', decimals: 2, pointValue: 375, basePrice: 245.3, atrPct: 0.02 },
  { symbol: 'SB', name: 'Sugar', category: 'Ags', exchange: 'ICE', country: 'US', decimals: 2, pointValue: 1120, basePrice: 19.48, atrPct: 0.017 },
  { symbol: 'CT', name: 'Cotton', category: 'Ags', exchange: 'ICE', country: 'US', decimals: 2, pointValue: 500, basePrice: 72.15, atrPct: 0.015 },
];

const INDICATORS = [
  { name: 'EMA Stack', weight: 11 },
  { name: 'VWAP', weight: 8 },
  { name: 'RSI (14)', weight: 8 },
  { name: 'MACD', weight: 8 },
  { name: 'ADX', weight: 7 },
  { name: 'Supertrend', weight: 10 },
  { name: 'Ichimoku', weight: 8 },
  { name: 'Bollinger Bands', weight: 7 },
  { name: 'Volume Delta', weight: 9 },
  { name: 'Cumulative Delta', weight: 8 },
  { name: 'Stoch RSI', weight: 6 },
  { name: 'Market Structure', weight: 9 },
];

const REASONS = {
  'EMA Stack': { bull: 'Price is trading above a rising EMA stack, confirming an established uptrend.', bear: 'Price is trading below a falling EMA stack, confirming an established downtrend.' },
  VWAP: { bull: 'Price is holding above session VWAP, favoring continuation higher.', bear: 'Price is being rejected below session VWAP, favoring continuation lower.' },
  'RSI (14)': { bull: 'RSI is firmly bullish without being overbought, leaving room to run.', bear: 'RSI is firmly bearish without being oversold, leaving room to fall.' },
  MACD: { bull: 'MACD histogram is expanding to the upside on rising momentum.', bear: 'MACD histogram is expanding to the downside on falling momentum.' },
  Supertrend: { bull: 'Supertrend has flipped bullish, adding trend confirmation.', bear: 'Supertrend has flipped bearish, adding trend confirmation.' },
  Ichimoku: { bull: 'Price is trading above the Ichimoku cloud, a bullish structural signal.', bear: 'Price is trading below the Ichimoku cloud, a bearish structural signal.' },
  'Volume Delta': { bull: 'Order flow shows buyers consistently absorbing offers on dips.', bear: 'Order flow shows sellers consistently absorbing bids on rallies.' },
  'Cumulative Delta': { bull: 'Cumulative delta is rising, confirming net buying pressure.', bear: 'Cumulative delta is falling, confirming net selling pressure.' },
  'Market Structure': { bull: 'Market structure shows higher highs and higher lows — a bullish break of structure.', bear: 'Market structure shows lower highs and lower lows — a bearish break of structure.' },
  ADX: { bull: 'ADX confirms a strengthening trend rather than a range.', bear: 'ADX confirms a strengthening downtrend rather than a range.' },
  'Bollinger Bands': { bull: 'Price is riding the upper Bollinger Band on expanding volatility.', bear: 'Price is riding the lower Bollinger Band on expanding volatility.' },
  'Stoch RSI': { bull: 'Stochastic RSI is turning up out of oversold territory.', bear: 'Stochastic RSI is turning down out of overbought territory.' },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function indicatorDetail(name, state, rng) {
  switch (name) {
    case 'EMA Stack':
      return state === 'bull' ? '9 > 20 > 50 aligned up' : state === 'bear' ? '9 < 20 < 50 aligned down' : 'EMAs compressed, no clear stack';
    case 'VWAP':
      return state === 'bull' ? 'Price holding above VWAP' : state === 'bear' ? 'Price rejected below VWAP' : 'Hugging VWAP';
    case 'RSI (14)': {
      const v = state === 'bull' ? 54 + Math.floor(rng() * 20) : state === 'bear' ? 24 + Math.floor(rng() * 20) : 44 + Math.floor(rng() * 10);
      return state === 'bull' ? `${v} — bullish, not overbought` : state === 'bear' ? `${v} — bearish, not oversold` : `${v} — neutral range`;
    }
    case 'MACD':
      return state === 'bull' ? 'Bullish histogram expanding' : state === 'bear' ? 'Bearish histogram expanding' : 'Flat histogram';
    case 'ADX': {
      const v = state === 'neutral' ? 12 + Math.floor(rng() * 8) : 24 + Math.floor(rng() * 20);
      return state === 'neutral' ? `${v} — weak trend` : `${v} — strong trend`;
    }
    case 'Supertrend':
      return state === 'bull' ? 'Green — long bias' : state === 'bear' ? 'Red — short bias' : 'Flipping — indecisive';
    case 'Ichimoku':
      return state === 'bull' ? 'Price above the cloud' : state === 'bear' ? 'Price below the cloud' : 'Price inside the cloud';
    case 'Bollinger Bands':
      return state === 'bull' ? 'Riding the upper band' : state === 'bear' ? 'Riding the lower band' : 'Mid-band chop';
    case 'Volume Delta':
      return state === 'bull' ? 'Buyers absorbing offers' : state === 'bear' ? 'Sellers absorbing bids' : 'Balanced flow';
    case 'Cumulative Delta':
      return state === 'bull' ? 'Rising — net buying pressure' : state === 'bear' ? 'Falling — net selling pressure' : 'Flat — no clear pressure';
    case 'Stoch RSI': {
      const v = Math.floor(rng() * 100);
      return state === 'bull' ? `${v} — turning up from oversold` : state === 'bear' ? `${v} — turning down from overbought` : `${v} — mid-range`;
    }
    case 'Market Structure':
      return state === 'bull' ? 'Higher highs, higher lows (BOS up)' : state === 'bear' ? 'Lower highs, lower lows (BOS down)' : 'Ranging, no clear structure';
    default:
      return '—';
  }
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const HOLD_OPTIONS = ['20 min', '25 min', '35 min', '45 min', '1.2 hrs', '1.8 hrs', '2.4 hrs'];

class MarketModel {
  constructor(def) {
    Object.assign(this, def);
    this.rng = mulberry32(hashStr(def.symbol) ^ 0x9e3779b9);
    this.history = this._seedHistory(96);
    this.price = this.history[this.history.length - 1];
    this.openPrice = this.history[0];
    this.changePct = ((this.price - this.openPrice) / this.openPrice) * 100;
    this.age = Math.floor(this.rng() * 40);
    this.liveSource = 'sim';
    this.lastLiveAt = 0;
    this.basis = 0; // cash-index -> future price offset (set for index markets)
    this.signalIsReal = false;
    this.lastRealSignalAt = 0;
    this._noDataSignal();
  }

  applyRealSignal(signal) {
    this.signal = signal;
    this.signalIsReal = true;
    this.lastRealSignalAt = Date.now();
    this.age = 0;
    this.nextUpdateSec = 90;
  }

  markSignalUnavailable(staleMs) {
    if (!this.lastRealSignalAt || Date.now() - this.lastRealSignalAt > staleMs) {
      this.signalIsReal = false;
    }
  }

  applyLiveQuote(price, prevClose, marketState, quoteTime) {
    // `basis` (default 0) shifts a real-time cash-index quote up to its
    // front-month future level (fair-value carry), so an index market sourced
    // from the cash feed still displays the future's price. Change % is taken
    // from the raw cash move (basis is a near-constant offset).
    const b = this.basis || 0;
    if (prevClose) this.openPrice = prevClose;
    this.changePct = ((price - this.openPrice) / this.openPrice) * 100;
    this.price = price + b;
    this.history.push(this.price);
    if (this.history.length > 96) this.history.shift();
    this.liveSource = 'live';
    this.lastLiveAt = Date.now();
    if (marketState) this.marketState = marketState;
    // Exchange timestamp of the quote (seconds). Lets the UI tell a truly live
    // quote from a delayed one (free CME futures data lags ~15-25 min).
    if (quoteTime) this.quoteTime = quoteTime;
  }

  // Real-time price overlay for a server-driven market whose feed has NO exchange
  // delay (crypto). The Worker still owns the trading signal/verdict/plan — this
  // only refreshes the DISPLAYED price + timestamp so the quote ticks live and
  // reads "live" instead of "delayed", and keeps the aligned chart history in
  // step (replaces today's bar, never grows the daily series with intraday noise).
  applyServerPriceOverlay(price, prevClose, quoteTime) {
    if (typeof price !== 'number' || !(price > 0)) return;
    if (typeof prevClose === 'number' && prevClose > 0) this.openPrice = prevClose;
    this.changePct = ((price - this.openPrice) / this.openPrice) * 100;
    this.price = price;
    if (this.history && this.history.length) {
      this.history[this.history.length - 1] = price;
      if (this.historyTimes && this.historyTimes.length === this.history.length) {
        this.historyTimes[this.historyTimes.length - 1] = Date.now();
      }
    }
    this.liveSource = 'live';
    this.lastLiveAt = Date.now();
    this.quoteTime = quoteTime || Math.floor(Date.now() / 1000);
  }

  // Age of the latest real quote, in seconds, or null if we have no real quote.
  get quoteAgeSec() {
    return this.quoteTime ? Math.max(0, Math.floor(Date.now() / 1000 - this.quoteTime)) : null;
  }

  // True when the exchange is shut (weekend / overnight for cash indexes). The
  // price is genuinely static then — this lets the UI say "Closed" instead of
  // looking like a frozen app. Pre/post sessions still count as trading.
  get isClosed() {
    return this.isLiveFresh && (this.marketState === 'CLOSED' || this.marketState === 'PREPRE' || this.marketState === 'POSTPOST');
  }

  markLiveUnavailable(staleMs) {
    if (!this.lastLiveAt || Date.now() - this.lastLiveAt > staleMs) {
      this.liveSource = 'sim';
    }
  }

  // Drive this market entirely from an authoritative server signal (the Worker),
  // replacing the client SIM/proxy path. The quote is marked real (the UI still
  // shows it as delayed via quoteTime) and the verdict comes straight from the
  // server — no fabricated data.
  applyServerSignal(sig) {
    if (!sig) return;
    this.hasServerSignal = true;
    // Anchor the day's change to the real prior close, not the stale SIM base.
    if (typeof sig.prevClose === 'number' && sig.prevClose > 0) this.openPrice = sig.prevClose;
    // Seed the chart from the server's real daily closes (replaces stale SIM
    // history) and keep aligned timestamps so trade markers land by time.
    if (Array.isArray(sig.history) && sig.history.length && typeof sig.history[0] === 'object') {
      this.history = sig.history.map((h) => h.c).slice(-96);
      this.historyTimes = sig.history.map((h) => (h.t < 1e12 ? h.t * 1000 : h.t)).slice(-96);
    }
    const px = typeof sig.live === 'number' ? sig.live : (typeof sig.price === 'number' ? sig.price : this.price);
    if (typeof px === 'number' && px > 0) {
      this.changePct = ((px - this.openPrice) / this.openPrice) * 100;
      this.price = px;
      if (this.history[this.history.length - 1] !== px) { this.history.push(px); if (this.historyTimes) this.historyTimes.push(Date.now()); }
      if (this.history.length > 96) { this.history.shift(); if (this.historyTimes) this.historyTimes.shift(); }
    }
    this.liveSource = 'live';
    this.signalIsReal = true; // real backend analysis — never tag it SIM
    this.lastLiveAt = Date.now();
    // Honest quote age. Prefer the REAL exchange timestamp of the underlying quote
    // (sig.liveTime) so `now - quoteTime` is the true feed delay — for free CME
    // futures that's ~10-15m, for crypto it's ~0 (reads "live"). Only if the server
    // didn't provide it do we fall back to a conservative estimate (15m floor for
    // delayed feeds; updatedAt for crypto).
    this.quoteTime = (typeof sig.liveTime === 'number' && sig.liveTime > 0)
      ? Math.floor(sig.liveTime / 1000)
      : (this.category === 'Crypto'
        ? Math.floor((sig.updatedAt || Date.now()) / 1000)
        : Math.floor(((sig.updatedAt || Date.now()) - 15 * 60 * 1000) / 1000));
    const dir = sig.direction || (sig.verdict === 'BUY' ? 1 : sig.verdict === 'SELL' ? -1 : 0);
    const trend = sig.htfTrend === 'up' ? 'Bullish' : sig.htfTrend === 'down' ? 'Bearish' : 'Neutral';
    const volLevel = this.atrPct >= 0.02 ? 'High' : this.atrPct >= 0.01 ? 'Medium' : 'Low';
    let plan = null;
    if (sig.plan && typeof sig.plan.entry === 'number') {
      const entry = sig.plan.entry;
      const stop = typeof sig.plan.stop === 'number' ? sig.plan.stop : entry - (dir || 1) * this.atr;
      const r = Math.abs(entry - stop) || this.atr || 1;
      const s = dir >= 0 ? 1 : -1;
      const t1 = typeof sig.plan.target1 === 'number' ? sig.plan.target1 : entry + s * r * 2;
      plan = { entry, stop, target1: t1, target2: entry + s * r * 3.2, target3: entry + s * r * 4.5, trailingStopPts: r * 1.2, riskReward: +Math.abs((t1 - entry) / r).toFixed(2), conviction: sig.conviction === 'high' ? 'high' : 'normal' };
    }
    this.signal = {
      symbol: this.symbol,
      timeframe: sig.timeframe || currentTimeframe(),
      direction: dir,
      confidence: typeof sig.confidence === 'number' ? sig.confidence : 50,
      provisional: !!sig.provisional,
      trend,
      volatility: volLevel,
      expectedHold: sig.timeframe === '1D' ? '1–3 days' : '1–4 hours',
      plan,
      reasons: serverReasons(sig, trend),
      indicators: [],
      confluence: { bull: 0, bear: 0, neutral: 0 },
      rsi2: sig.rsi2, pctB: sig.pctB, htfTrend: sig.htfTrend, conviction: sig.conviction,
      proximity: typeof sig.proximity === 'number' ? sig.proximity : 0,
      createdAt: sig.updatedAt || Date.now(),
      source: 'server',
    };
    this.displayVerdict = (sig.verdict === 'BUY' || sig.verdict === 'SELL') ? sig.verdict : 'NO_TRADE';
    this.displayVerdictAt = Date.now();
  }

  get isLiveFresh() {
    return this.liveSource === 'live' && this.lastLiveAt && (Date.now() - this.lastLiveAt < 6 * 60 * 1000);
  }

  _seedHistory(n) {
    // No fabricated price walk. A flat placeholder at the reference price until
    // real data arrives — and these markets stay hidden until it does.
    return new Array(n).fill(this.basePrice || 100);
  }

  get atr() { return this.price * this.atrPct; }

  // No live data yet — an honest empty state, NEVER fabricated. A real signal
  // arrives only from the backend or a successful live fetch (applyServerSignal /
  // applyRealSignal). Markets in this state are hidden from the UI.
  _noDataSignal() {
    this.signal = {
      symbol: this.symbol,
      timeframe: currentTimeframe(),
      direction: 0,
      confidence: 0,
      trend: 'Neutral',
      volatility: this.atrPct >= 0.02 ? 'High' : this.atrPct >= 0.01 ? 'Medium' : 'Low',
      expectedHold: '—',
      plan: null,
      reasons: ['No live data for this market yet — Ajent shows only real signals, never simulated ones.'],
      indicators: [],
      confluence: { bull: 0, bear: 0, neutral: 0 },
      createdAt: Date.now(),
      source: 'none',
    };
    this.displayVerdict = 'NO_TRADE';
    this.displayVerdictAt = Date.now();
    this.nextUpdateSec = 60;
  }

  _rawVerdict(threshold) {
    if (this.signal.confidence >= threshold) return this.signal.direction > 0 ? 'BUY' : 'SELL';
    return 'NO_TRADE';
  }

  // The verdict shown/traded is STABILISED: it holds for a minimum time and
  // uses a hysteresis buffer around the threshold, so it can't rapidly flip
  // between BUY / NO TRADE / SELL. Real signals don't reverse second-to-second,
  // and neither should ours.
  verdict() {
    if (this.displayVerdict === undefined) {
      this.displayVerdict = this.signal.confidence >= 75 ? (this.signal.direction > 0 ? 'BUY' : 'SELL') : 'NO_TRADE';
      this.displayVerdictAt = Date.now();
    }
    return this.displayVerdict;
  }

  _stabilizeVerdict(threshold) {
    if (this.displayVerdict === undefined) { this.verdict(); return null; }
    const HOLD_MS = 180000; // a signal stands for at least 3 minutes
    if (Date.now() - this.displayVerdictAt < HOLD_MS) return null;
    const s = this.signal;
    const rawSide = s.direction > 0 ? 'BUY' : 'SELL';
    let candidate;
    if (s.confidence >= threshold + 3) candidate = rawSide;          // clearly clears -> fire
    else if (s.confidence < threshold - 6) candidate = 'NO_TRADE';   // clearly fails -> stand down
    else candidate = this.displayVerdict;                            // in the buffer -> hold
    // Never flip straight from BUY to SELL (or back) — cool down via NO TRADE.
    if ((this.displayVerdict === 'BUY' && candidate === 'SELL') || (this.displayVerdict === 'SELL' && candidate === 'BUY')) {
      candidate = 'NO_TRADE';
    }
    if (candidate !== this.displayVerdict) {
      this.displayVerdict = candidate;
      this.displayVerdictAt = Date.now();
      return candidate;
    }
    return null;
  }

  tick(threshold, onAlert) {
    // No fabricated price movement. A market without real data stays static and
    // hidden until a real signal (backend or live fetch) arrives.
    this.age += 1;

    // Stabilise the shown/traded verdict every tick (min-hold + hysteresis).
    // Only a genuine, held change fires a BUY/SELL alert — no more churn.
    // Server-driven markets keep the backend's authoritative verdict verbatim.
    const changedTo = this.hasServerSignal ? null : this._stabilizeVerdict(threshold);
    if (onAlert && (changedTo === 'BUY' || changedTo === 'SELL')) {
      onAlert({
        type: changedTo,
        symbol: this.symbol,
        title: `${changedTo} · ${this.symbol}`,
        body: `${this.name} triggered a ${changedTo === 'BUY' ? 'long' : 'short'} — ${this.signal.confidence}% confidence, entry ${fmtNum(this.signal.plan.entry, this.decimals)}, stop ${fmtNum(this.signal.plan.stop, this.decimals)}.`,
        ts: Date.now(),
      });
    }
  }
}

function fmtNum(v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

// Illustrative reference of the recurring US releases that reliably move markets,
// with their typical release day/time (ET). Not a live feed and not forecast
// figures — the UI frames it as a reference to verify against a live calendar.
// `rule` drives the computed next date (see econCalendar.js). FOMC has no simple
// recurrence (8 scheduled meetings/year), so it carries no rule and reads "Scheduled".
const CALENDAR_SEED = [
  { time: '08:30', title: 'Initial Jobless Claims', impact: 'MED', rule: { type: 'weekly', wd: 4 } },
  { time: '10:00', title: 'ISM Manufacturing PMI', impact: 'MED', rule: { type: 'first-biz' } },
  { time: '08:30', title: 'CPI (Consumer Prices)', impact: 'HIGH', rule: { type: 'nth-weekday', n: 2, wd: 3 } },
  { time: '14:00', title: 'FOMC Rate Decision', impact: 'HIGH' },
  { time: '08:30', title: 'Nonfarm Payrolls', impact: 'HIGH', rule: { type: 'nth-weekday', n: 1, wd: 5 } },
  { time: '08:30', title: 'PCE Price Index', impact: 'HIGH', rule: { type: 'last-biz' } },
  { time: '10:00', title: 'Consumer Confidence', impact: 'MED', rule: { type: 'last-weekday', wd: 2 } },
];

// No seeded/demo alerts — the feed fills with REAL notifications as signals fire
// and paper trades close, so nothing shown here is fabricated.
const ALERTS_SEED = [];

export function createEngine() {
  const markets = MARKET_DEFS.map((d) => new MarketModel(d));
  const bySymbol = new Map(markets.map((m) => [m.symbol, m]));
  const now = Date.now();
  const alerts = ALERTS_SEED.map((a) => ({ ...a, ts: now - a.ageSec * 1000 }));

  function tick(threshold) {
    for (const m of markets) {
      m.tick(threshold, (alert) => {
        alerts.unshift(alert);
        if (alerts.length > 40) alerts.pop();
      });
    }
  }

  return {
    markets, bySymbol, alerts,
    calendar: CALENDAR_SEED,
    tick,
    get: (symbol) => bySymbol.get(symbol),
  };
}
