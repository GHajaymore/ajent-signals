// Mock signal-engine — mirrors the shapes in design_handoff_ajent/API_AND_DATA_MODEL.md.
// Illustrative only: replace with a licensed real-time feed + real confluence engine in production.

export const CATEGORY_ORDER = ['Index', 'Energy', 'Metals', 'Rates', 'Crypto', 'Volatility', 'Ags'];

const MARKET_DEFS = [
  { symbol: 'ES', name: 'E-mini S&P 500', category: 'Index', exchange: 'CME', decimals: 2, pointValue: 50, basePrice: 5921.75, atrPct: 0.006 },
  { symbol: 'MES', name: 'Micro E-mini S&P 500', category: 'Index', exchange: 'CME', decimals: 2, pointValue: 5, basePrice: 5921.75, atrPct: 0.006 },
  { symbol: 'NQ', name: 'E-mini Nasdaq-100', category: 'Index', exchange: 'CME', decimals: 2, pointValue: 20, basePrice: 21072.46, atrPct: 0.008 },
  { symbol: 'MNQ', name: 'Micro E-mini Nasdaq-100', category: 'Index', exchange: 'CME', decimals: 2, pointValue: 2, basePrice: 21033.93, atrPct: 0.008 },
  { symbol: 'YM', name: 'E-mini Dow', category: 'Index', exchange: 'CBOT', decimals: 0, pointValue: 5, basePrice: 43686, atrPct: 0.006 },
  { symbol: 'RTY', name: 'E-mini Russell 2000', category: 'Index', exchange: 'CME', decimals: 1, pointValue: 50, basePrice: 2277.7, atrPct: 0.009 },
  { symbol: 'CL', name: 'Crude Oil', category: 'Energy', exchange: 'NYMEX', decimals: 2, pointValue: 1000, basePrice: 71.89, atrPct: 0.018 },
  { symbol: 'NG', name: 'Natural Gas', category: 'Energy', exchange: 'NYMEX', decimals: 3, pointValue: 10000, basePrice: 3.142, atrPct: 0.03 },
  { symbol: 'GC', name: 'Gold', category: 'Metals', exchange: 'COMEX', decimals: 1, pointValue: 100, basePrice: 2648.4, atrPct: 0.009 },
  { symbol: 'SI', name: 'Silver', category: 'Metals', exchange: 'COMEX', decimals: 3, pointValue: 5000, basePrice: 31.42, atrPct: 0.016 },
  { symbol: 'HG', name: 'Copper', category: 'Metals', exchange: 'COMEX', decimals: 4, pointValue: 25000, basePrice: 4.352, atrPct: 0.014 },
  { symbol: 'ZN', name: '10-Year T-Note', category: 'Rates', exchange: 'CBOT', decimals: 3, pointValue: 1000, basePrice: 109.516, atrPct: 0.003 },
  { symbol: 'ZB', name: '30-Year T-Bond', category: 'Rates', exchange: 'CBOT', decimals: 3, pointValue: 1000, basePrice: 118.25, atrPct: 0.005 },
  { symbol: 'BTC', name: 'Bitcoin', category: 'Crypto', exchange: 'CME', decimals: 0, pointValue: 5, basePrice: 68210, atrPct: 0.022 },
  { symbol: 'ETH', name: 'Ether', category: 'Crypto', exchange: 'CME', decimals: 1, pointValue: 50, basePrice: 3384.2, atrPct: 0.026 },
  { symbol: 'VIX', name: 'Cboe Volatility Index', category: 'Volatility', exchange: 'CFE', decimals: 2, pointValue: 1000, basePrice: 14.22, atrPct: 0.05 },
  { symbol: 'ZC', name: 'Corn', category: 'Ags', exchange: 'CBOT', decimals: 2, pointValue: 50, basePrice: 445.25, atrPct: 0.012 },
  { symbol: 'ZS', name: 'Soybeans', category: 'Ags', exchange: 'CBOT', decimals: 2, pointValue: 50, basePrice: 1151.5, atrPct: 0.012 },
  { symbol: 'ZW', name: 'Wheat', category: 'Ags', exchange: 'CBOT', decimals: 2, pointValue: 50, basePrice: 579.75, atrPct: 0.016 },
  { symbol: 'KC', name: 'Coffee', category: 'Ags', exchange: 'ICE', decimals: 2, pointValue: 375, basePrice: 245.3, atrPct: 0.02 },
  { symbol: 'SB', name: 'Sugar', category: 'Ags', exchange: 'ICE', decimals: 2, pointValue: 1120, basePrice: 19.48, atrPct: 0.017 },
  { symbol: 'CT', name: 'Cotton', category: 'Ags', exchange: 'ICE', decimals: 2, pointValue: 500, basePrice: 72.15, atrPct: 0.015 },
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

const MTF_REASON = 'Confirmed across the 15m, 1H and 4H timeframes before firing.';

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
    this.favorite = def.symbol === 'ES';
    this.liveSource = 'sim';
    this.lastLiveAt = 0;
    this._genSignal();
  }

  applyLiveQuote(price, prevClose) {
    this.price = price;
    if (prevClose) this.openPrice = prevClose;
    this.changePct = ((this.price - this.openPrice) / this.openPrice) * 100;
    this.history.push(this.price);
    if (this.history.length > 96) this.history.shift();
    this.liveSource = 'live';
    this.lastLiveAt = Date.now();
  }

  markLiveUnavailable(staleMs) {
    if (!this.lastLiveAt || Date.now() - this.lastLiveAt > staleMs) {
      this.liveSource = 'sim';
    }
  }

  get isLiveFresh() {
    return this.liveSource === 'live' && this.lastLiveAt && (Date.now() - this.lastLiveAt < 6 * 60 * 1000);
  }

  _seedHistory(n) {
    const pts = [];
    let p = this.basePrice * (1 - this.atrPct * 1.4);
    const drift = (this.rng() - 0.42) * this.atrPct * 0.06;
    for (let i = 0; i < n; i++) {
      p = p * (1 + drift + (this.rng() - 0.5) * this.atrPct * 0.09);
      pts.push(p);
    }
    pts[pts.length - 1] = this.basePrice;
    return pts;
  }

  get atr() { return this.price * this.atrPct; }

  _genSignal() {
    const rng = this.rng;
    const direction = rng() > 0.46 ? 1 : -1;
    const confidence = Math.round(38 + rng() * 58);
    const agreeState = direction > 0 ? 'bull' : 'bear';
    const disagreeState = direction > 0 ? 'bear' : 'bull';

    const majority = Math.max(3, Math.min(10, Math.round(3 + (confidence / 100) * 7)));
    const remaining = INDICATORS.length - majority;
    const minority = Math.max(0, Math.min(remaining, Math.round(remaining * 0.45)));
    const neutralCount = INDICATORS.length - majority - minority;

    const order = shuffle(INDICATORS, rng);
    const indicators = order.map((ind, i) => {
      const state = i < majority ? agreeState : i < majority + minority ? disagreeState : 'neutral';
      return { name: ind.name, weight: ind.weight, state, detail: indicatorDetail(ind.name, state, rng) };
    });
    indicators.sort((a, b) => INDICATORS.findIndex((x) => x.name === a.name) - INDICATORS.findIndex((x) => x.name === b.name));

    const bull = indicators.filter((i) => i.state === 'bull').length;
    const bear = indicators.filter((i) => i.state === 'bear').length;
    const neutral = indicators.filter((i) => i.state === 'neutral').length;

    const entry = this.price;
    const atr = this.atr;
    const stop = entry - direction * atr * 1.0;
    const trailingStopPts = atr * 1.2;
    const target1 = entry + direction * atr * 2.0;
    const target2 = entry + direction * atr * 3.2;
    const target3 = entry + direction * atr * 4.5;
    const riskReward = Math.abs(target1 - entry) / Math.abs(entry - stop);

    const agreeing = indicators.filter((i) => i.state === agreeState).sort((a, b) => b.weight - a.weight);
    let reasons;
    const trend = confidence >= 70 ? (direction > 0 ? 'Bullish' : 'Bearish') : rng() > 0.5 ? (direction > 0 ? 'Bullish' : 'Bearish') : 'Neutral';
    const volLevel = this.atrPct >= 0.02 ? 'High' : this.atrPct >= 0.01 ? 'Medium' : 'Low';

    if (confidence >= 75) {
      reasons = agreeing.slice(0, 3).map((i) => REASONS[i.name]?.[agreeState]).filter(Boolean);
      reasons.push(MTF_REASON);
    } else {
      reasons = [
        `Confidence of ${confidence}% falls short of the confidence threshold.`,
        `Indicators are split — ${bull} bullish vs ${bear} bearish, ${neutral} neutral.`,
        'Waiting for stronger multi-timeframe alignment before risking capital.',
      ];
    }

    this.signal = {
      symbol: this.symbol,
      timeframe: '15m',
      direction,
      confidence,
      trend,
      volatility: volLevel,
      expectedHold: HOLD_OPTIONS[Math.floor(rng() * HOLD_OPTIONS.length)],
      plan: { entry, stop, trailingStopPts, target1, target2, target3, riskReward },
      reasons,
      indicators,
      confluence: { bull, bear, neutral },
      createdAt: Date.now(),
    };
    this.age = 0;
    this.nextUpdateSec = Math.round(45 + rng() * 75);
  }

  verdict(threshold) {
    if (this.signal.confidence >= threshold) return this.signal.direction > 0 ? 'BUY' : 'SELL';
    return 'NO_TRADE';
  }

  tick(threshold, onAlert) {
    const rng = this.rng;
    if (!this.isLiveFresh) {
      const jitter = (rng() - 0.5) * this.atrPct * 0.045;
      this.price = Math.max(this.price * (1 + jitter), this.price * 0.5);
      this.changePct = ((this.price - this.openPrice) / this.openPrice) * 100;

      if (rng() > 0.55) {
        this.history.push(this.price);
        if (this.history.length > 96) this.history.shift();
      }
    }

    this.age += 1;
    this.nextUpdateSec -= 1;
    if (this.nextUpdateSec <= 0) {
      const prevVerdict = this.verdict(threshold);
      this._genSignal();
      const newVerdict = this.verdict(threshold);
      if (onAlert && newVerdict !== 'NO_TRADE' && newVerdict !== prevVerdict) {
        onAlert({
          type: newVerdict,
          symbol: this.symbol,
          title: `${newVerdict === 'BUY' ? 'BUY' : 'SELL'} · ${this.symbol}`,
          body: `${this.name} triggered a ${newVerdict === 'BUY' ? 'long' : 'short'} — ${this.signal.confidence}% confidence, entry ${fmtNum(this.signal.plan.entry, this.decimals)}, stop ${fmtNum(this.signal.plan.stop, this.decimals)}.`,
          ts: Date.now(),
        });
      }
    }
  }
}

function fmtNum(v, d) { return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }

const CLOSED_SEED = [
  { symbol: 'GC', side: 'LONG', dateOffsetDays: -2, resultR: 2.8, outcome: 'Target 2', holdMin: 186 },
  { symbol: 'NQ', side: 'LONG', dateOffsetDays: -2, resultR: 1.9, outcome: 'Target 1', holdMin: 46 },
  { symbol: 'CL', side: 'SHORT', dateOffsetDays: -3, resultR: -1.0, outcome: 'Stopped', holdMin: 28 },
  { symbol: 'ES', side: 'LONG', dateOffsetDays: -3, resultR: 3.2, outcome: 'Target 3', holdMin: 224 },
  { symbol: 'RTY', side: 'SHORT', dateOffsetDays: -4, resultR: 1.5, outcome: 'Target 1', holdMin: 62 },
  { symbol: 'MNQ', side: 'SHORT', dateOffsetDays: -4, resultR: -1.0, outcome: 'Stopped', holdMin: 19 },
  { symbol: 'SI', side: 'LONG', dateOffsetDays: -5, resultR: 2.1, outcome: 'Target 2', holdMin: 138 },
  { symbol: 'ZN', side: 'SHORT', dateOffsetDays: -6, resultR: 1.2, outcome: 'Target 1', holdMin: 51 },
  { symbol: 'BTC', side: 'LONG', dateOffsetDays: -7, resultR: 2.4, outcome: 'Target 2', holdMin: 97 },
  { symbol: 'YM', side: 'LONG', dateOffsetDays: -8, resultR: -1.0, outcome: 'Stopped', holdMin: 33 },
];

const CALENDAR_SEED = [
  { day: 'Today', time: '08:30', title: 'Initial Jobless Claims', forecast: '221K', previous: '219K', impact: 'MED' },
  { day: 'Today', time: '10:00', title: 'ISM Manufacturing PMI', forecast: '48.4', previous: '48.4', impact: 'MED' },
  { day: 'Wed', time: '08:30', title: 'CPI (MoM)', forecast: '0.3%', previous: '0.2%', impact: 'HIGH' },
  { day: 'Wed', time: '14:00', title: 'FOMC Rate Decision', forecast: '4.50%', previous: '4.75%', impact: 'HIGH' },
  { day: 'Fri', time: '08:30', title: 'Nonfarm Payrolls', forecast: '180K', previous: '227K', impact: 'HIGH' },
  { day: 'Fri', time: '08:30', title: 'PCE Price Index', forecast: '0.2%', previous: '0.2%', impact: 'HIGH' },
  { day: 'Fri', time: '10:00', title: 'Consumer Confidence', forecast: '111.7', previous: '111.7', impact: 'MED' },
];

const ALERTS_SEED = [
  { type: 'BUY', symbol: 'GC', title: 'BUY · GC', body: 'Gold triggered a long — 88% confidence, entry 2,648.4, stop 2,621.4.', ageSec: 120 },
  { type: 'TARGET', symbol: 'ES', title: 'Target 1 hit · ES', body: 'E-mini S&P reached Target 1 at 5,940.75 (+1.0R). Trailing stop active.', ageSec: 840 },
  { type: 'SELL', symbol: 'CL', title: 'SELL · CL', body: 'Crude Oil short — 82% confidence, entry 71.84, stop 73.19.', ageSec: 1980 },
  { type: 'STOP', symbol: 'MNQ', title: 'Stop hit · MNQ', body: 'Micro Nasdaq short stopped out at 21,168 (-1.0R).', ageSec: 3120 },
  { type: 'REVERSAL', symbol: 'NQ', title: 'Trend reversal · NQ', body: 'Nasdaq 15m structure shifted bullish — watch for a long setup.', ageSec: 3600 },
  { type: 'VOLATILITY', symbol: 'VIX', title: 'High volatility · VIX', body: 'VIX ATR expanding — position sizes trimmed automatically.', ageSec: 7200 },
  { type: 'NEWS', symbol: 'CPI', title: 'Event warning · CPI', body: 'CPI releases Wed 08:30. New signals paused 15 min around the print.', ageSec: 10800 },
];

export function createEngine() {
  const markets = MARKET_DEFS.map((d) => new MarketModel(d));
  const bySymbol = new Map(markets.map((m) => [m.symbol, m]));
  const now = Date.now();
  const alerts = ALERTS_SEED.map((a) => ({ ...a, ts: now - a.ageSec * 1000 }));
  const closedSignals = CLOSED_SEED.map((c) => {
    const def = bySymbol.get(c.symbol);
    const entry = def.basePrice * (1 - (c.resultR > 0 ? 0.004 : -0.003));
    const exit = entry * (1 + (c.side === 'LONG' ? 1 : -1) * (c.resultR > 0 ? 0.006 : -0.002));
    return {
      symbol: c.symbol, name: def.name, side: c.side,
      date: new Date(now + c.dateOffsetDays * 86400000),
      entry, exit, resultR: c.resultR, outcome: c.outcome, holdMin: c.holdMin,
      decimals: def.decimals,
    };
  });

  function tick(threshold) {
    for (const m of markets) {
      m.tick(threshold, (alert) => {
        alerts.unshift(alert);
        if (alerts.length > 40) alerts.pop();
      });
    }
  }

  function performance() {
    const wins = closedSignals.filter((c) => c.resultR > 0).length;
    const losses = closedSignals.length - wins;
    const winRate = Math.round((wins / closedSignals.length) * 100);
    const avgWinR = closedSignals.filter((c) => c.resultR > 0).reduce((s, c) => s + c.resultR, 0) / (wins || 1);
    const avgLossR = Math.abs(closedSignals.filter((c) => c.resultR < 0).reduce((s, c) => s + c.resultR, 0) / (losses || 1));
    const avgHold = closedSignals.reduce((s, c) => s + c.holdMin, 0) / closedSignals.length;
    const totalR = closedSignals.reduce((s, c) => s + c.resultR, 0);
    return {
      winRate, wins, losses,
      avgRR: `${avgLossR ? (avgWinR / avgLossR).toFixed(1) : avgWinR.toFixed(1)}:1`,
      maxDrawdownPct: 8.4,
      avgHold: avgHold >= 60 ? `${(avgHold / 60).toFixed(1)} hrs` : `${Math.round(avgHold)} min`,
      totalR,
      monthlyR: [
        { label: 'Feb', value: 3.4 }, { label: 'Mar', value: -1.6 }, { label: 'Apr', value: 5.1 },
        { label: 'May', value: 4.3 }, { label: 'Jun', value: 6.0 }, { label: 'Jul', value: 4.0 },
      ],
    };
  }

  return {
    markets, bySymbol, alerts, closedSignals,
    calendar: CALENDAR_SEED,
    tick, performance,
    get: (symbol) => bySymbol.get(symbol),
  };
}
