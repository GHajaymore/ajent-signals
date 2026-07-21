// Best-effort real quotes from a public, unofficial market-data endpoint, reached through
// free CORS proxies (no backend on this static site). NOT a licensed feed — see README note.
// Every symbol falls back to the existing simulator automatically if this is unavailable.

const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

const YAHOO_SYMBOL = {
  ES: 'ES=F', MES: 'MES=F', NQ: 'NQ=F', MNQ: 'MNQ=F', YM: 'YM=F', RTY: 'RTY=F',
  CL: 'CL=F', NG: 'NG=F',
  GC: 'GC=F', SI: 'SI=F', HG: 'HG=F',
  ZN: 'ZN=F', ZB: 'ZB=F',
  BTC: 'BTC-USD', ETH: 'ETH-USD',
  VIX: '^VIX',
  ZC: 'ZC=F', ZS: 'ZS=F', ZW: 'ZW=F', KC: 'KC=F', SB: 'SB=F', CT: 'CT=F',
};

const LIVE_STALE_MS = 5 * 60 * 1000;

async function fetchYahooQuote(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const res = await fetch(wrap(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('no quote in response');
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
      return { price: meta.regularMarketPrice, prevClose };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all proxies failed');
}

function refreshAll(engine, stagger) {
  let i = 0;
  for (const market of engine.markets) {
    const ySym = YAHOO_SYMBOL[market.symbol];
    if (!ySym) continue;
    const delay = i++ * stagger;
    setTimeout(async () => {
      try {
        const { price, prevClose } = await fetchYahooQuote(ySym);
        market.applyLiveQuote(price, prevClose);
      } catch (e) {
        market.markLiveUnavailable(LIVE_STALE_MS);
      }
    }, delay);
  }
}

export function startLiveDataLoop(engine, { intervalMs = 15000, stagger = 200 } = {}) {
  refreshAll(engine, stagger);
  return setInterval(() => refreshAll(engine, stagger), intervalMs);
}

export { LIVE_STALE_MS };
