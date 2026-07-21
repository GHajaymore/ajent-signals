// Best-effort market-moving news sentiment — real headlines, no insider or
// non-public information. Uses the same unofficial public feed + CORS-proxy
// chain as candles.js/liveData.js. Sentiment is a simple keyword scan over
// real headline text, not a licensed NLP/sentiment service.

const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

const NEWS_STALE_MS = 48 * 60 * 60 * 1000; // ignore headlines older than 2 days

const BULLISH_WORDS = [
  'surge', 'soar', 'rally', 'jump', 'jumps', 'beat', 'beats', 'strong', 'stronger',
  'record high', 'rate cut', 'cuts rates', 'stimulus', 'upgrade', 'upgraded',
  'bullish', 'gain', 'gains', 'rebound', 'boost', 'robust', 'expansion', 'easing',
];
const BEARISH_WORDS = [
  'plunge', 'plummet', 'slump', 'tumble', 'crash', 'miss', 'misses', 'weak', 'weaker',
  'recession', 'sanction', 'tariff', 'rate hike', 'hikes rates', 'downgrade', 'downgraded',
  'bearish', 'sell-off', 'selloff', 'fears', 'default', 'shutdown', 'conflict', 'war',
  'stagflation', 'layoffs',
];

function scoreHeadline(title) {
  const t = title.toLowerCase();
  let score = 0;
  for (const w of BULLISH_WORDS) if (t.includes(w)) score += 1;
  for (const w of BEARISH_WORDS) if (t.includes(w)) score -= 1;
  return score;
}

export async function fetchNews(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&newsCount=8&quotesCount=0`;
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const res = await fetch(wrap(url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.news) ? data.news : [];
      const now = Date.now();
      return items
        .map((n) => ({
          title: n.title || '',
          publisher: n.publisher || '',
          publishedAt: (n.providerPublishTime || 0) * 1000,
          score: scoreHeadline(n.title || ''),
        }))
        .filter((n) => n.publishedAt > 0 && now - n.publishedAt < NEWS_STALE_MS);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('all proxies failed');
}

// Reduces scored headlines to a single -N..+N sentiment average plus the
// most relevant (highest |score|) headlines to cite as reasons.
export function summarizeNews(scored) {
  if (!scored || scored.length === 0) return { avg: 0, headlines: [] };
  const avg = scored.reduce((s, n) => s + n.score, 0) / scored.length;
  const headlines = [...scored].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 3);
  return { avg, headlines };
}
