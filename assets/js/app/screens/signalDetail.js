import { state, saveSettings, toggleWatchlist, isInWatchlist, getEnabledPaperMarkets, dailyEdge, planConfigFor, planStopPrice, planTargetPrice, isDefaultPlan } from '../state.js';
import { getStrategy, exitPhrase } from '../strategyMeta.js';
import { getClosedTrades, getPerformanceSummary } from '../paperTrading.js';
import { userTradeFor, userStats, unrealizedFor, defaultRiskDollars, openUserTrade, closeUserTrade, headToHead } from '../userBook.js';
import { ajentAvgR } from '../customBook.js';

// Honest per-market note about the DAILY strategy's backtested edge on this
// specific market (daily mode only). Never implies an edge the backtest didn't
// show — especially flags markets where it historically LOST.
function edgeNote(symbol) {
  if (state.settings.strategyMode === 'intraday') return '';
  const edge = dailyEdge(symbol);
  if (edge === 'strong' || edge === 'positive') return '';
  const map = {
    flat: ['var(--flat)', 'ph-scales', 'Backtested roughly break-even on this market — the daily edge is strongest on US indices. Trade it for information, not for a proven edge.'],
    negative: ['var(--sell)', 'ph-warning-octagon', 'Heads up: this daily strategy has historically LOST money on this market (mean reversion works poorly on hard-trending indices). Shown for information only — it is not a backtested edge here.'],
    untested: ['var(--neutral-500)', 'ph-flask', 'Not backtested on this market. The daily strategy is validated on developed-market equity indices; treat signals here as informational only.'],
  };
  const [color, icon, text] = map[edge] || map.untested;
  return `<div class="reason-row" style="align-items:flex-start;margin-top:2px"><i class="ph-fill ${icon}" style="color:${color}"></i><span style="font-size:12px;color:var(--text-muted);line-height:1.55">${text}</span></div>`;
}
import { fmtPrice, fmtCountdown, verdictColorVar, countryFlag } from '../format.js';
import { confidenceRing, verdictIcon, indicatorRow, planRow, dataTag } from '../components.js';
import { YAHOO_SYMBOL } from '../liveData.js';
import { fetchCandles } from '../candles.js';
import { isHighConviction, getOpenPositions } from '../paperTrading.js';
import { isMarketAllowed } from '../adaptiveWeights.js';
import { fetchHistory, backendConfigured } from '../backendApi.js';

// Relative-time for the signal timeline.
function tlAgo(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function timelineHtml(events) {
  if (!events || !events.length) return '';
  return `<div class="panel">
    <div class="panel-title">Signal timeline</div>
    ${events.slice(0, 8).map((e) => `<div class="reason-row" style="align-items:flex-start">
      <i class="ph-fill ph-clock-countdown" style="color:var(--accent-300)"></i>
      <span style="font-size:12.5px;line-height:1.5">${e.text}<br><span class="text-faint" style="font-size:10.5px">${tlAgo(e.at)}</span></span>
    </div>`).join('')}
  </div>`;
}
async function loadTimeline(container, symbol) {
  if (!backendConfigured()) return;
  const data = await fetchHistory(symbol);
  const el = container.querySelector('#signal-timeline');
  if (el && data && Array.isArray(data.events) && data.events.length) el.innerHTML = timelineHtml(data.events);
}

// Honest "what could hold it back" — real caveats from the signal state, never a
// fabricated confidence booster. Mirrors the discipline of showing losses too.
function caveatsHtml(market, verdict) {
  const s = market.signal, c = [];
  if (verdict === 'BUY' && s.strat === 'trend') {
    // Trend risks are the opposite of the mean-reversion ones — don't reuse the
    // "bounce bet / deepest-oversold tier / Bollinger" caveats here.
    c.push('This rides an existing uptrend — if the trend rolls over, the trailing stop exits with some give-back from the peak, not at the very top.');
    c.push('A continuation entry has a smaller per-trade edge than the deepest-oversold snaps — it earns its place by firing on different days (diversification), not by being the strongest single setup.');
  } else if (verdict === 'BUY') {
    c.push('This is a bounce bet — if the dip keeps falling, it loses. Profit needs a recovery, not more downside.');
    if (!(s.plan && s.plan.conviction === 'high')) c.push('Standard tier, not the deepest-oversold tier — the per-trade edge is smaller than a high-conviction setup.');
    if (s.pctB != null && s.pctB >= 0) c.push('Price hasn’t pierced below the lower Bollinger band — a less-stretched setup than the strongest ones.');
  } else if (verdict === 'SELL') {
    c.push('Provisional short — historically the weaker side on stock indices (they drift up over time). The live record is the judge.');
    c.push('A short bets on a fade; if the pop keeps running, it loses.');
  } else {
    return '';
  }
  const edge = dailyEdge(market.symbol);
  if (edge === 'negative') c.push('This daily strategy has historically LOST on this market — treat the signal as informational, not a proven edge here.');
  else if (edge === 'untested' || edge === 'flat') c.push('Not strongly backtested on this specific market — the validated edge is on developed-market equity indices.');
  return `<div class="panel" style="border:1px solid var(--hairline)">
    <div class="panel-title" style="display:flex;align-items:center;gap:7px"><i class="ph-fill ph-warning" style="color:var(--flat)"></i>What could hold it back</div>
    ${c.map((t) => `<div class="reason-row" style="align-items:flex-start"><i class="ph-bold ph-minus" style="color:var(--text-muted)"></i><span style="font-size:12.5px;line-height:1.55">${t}</span></div>`).join('')}
  </div>`;
}

// Explains whether this signal is actually being paper-traded, and if not, why.
// A BUY/SELL verdict clears the confidence threshold, but the paper-trader is
// deliberately stricter — so the two can legitimately disagree. Making that
// visible avoids the "it says BUY but there's no trade" confusion.
function autoTradeStatus(market, verdict) {
  if (verdict === 'NO_TRADE') return null;
  if (!market.signalIsReal) return { ok: false, text: 'No live data for this market right now — the feed is unavailable, so there is nothing to paper-trade. Trading resumes automatically once real data returns.' };
  const enabled = getEnabledPaperMarkets(state.engine.markets.map((m) => m.symbol));
  if (!enabled.has(market.symbol)) return { ok: false, text: 'Not in your auto-trade list — add it in Paper Trading → Auto-traded markets.' };
  if (!isMarketAllowed(market.symbol)) return { ok: false, text: 'Auto-trading is paused for this market after a recent run of losses. It resumes on its own.' };
  if (getOpenPositions().some((p) => p.symbol === market.symbol)) return { ok: true, text: 'Already in an open paper trade — the next one opens after this closes.' };
  if (!isHighConviction(market.signal, verdict)) return { ok: false, text: 'Shown as a directional lean, but auto-trading holds out for a higher-conviction setup (stronger, cross-confirmed agreement) before risking capital.' };
  return { ok: true, text: 'This setup is being paper-traded.' };
}

// Chart ranges the user can pick, from 5-minute intraday out to ~30 days.
const RANGES = {
  '1D': { interval: '5m', range: '1d', label: '1D' },
  '1W': { interval: '30m', range: '5d', label: '1W' },
  '1M': { interval: '1d', range: '1mo', label: '1M' },
};
const candleCache = new Map();   // `${symbol}|${rangeKey}` -> { candles, ts, failed }
const inflight = new Set();
let activeRange = null;          // resolved from settings on first chart render

function loadCandles(symbol, ySym, rangeKey) {
  const key = `${symbol}|${rangeKey}`;
  const cached = candleCache.get(key);
  if (cached && !cached.failed && Date.now() - cached.ts < 120000) return; // still fresh
  if (inflight.has(key)) return;
  inflight.add(key);
  const { interval, range } = RANGES[rangeKey];
  fetchCandles(ySym, { interval, range, minCandles: 8, appSymbol: symbol })
    .then((candles) => candleCache.set(key, { candles, ts: Date.now() }))
    .catch(() => candleCache.set(key, { candles: null, ts: Date.now(), failed: true }))
    .finally(() => {
      inflight.delete(key);
      // Patch the chart in place if the user is still looking at it.
      if (state.selectedSymbol === symbol && state.detailTab === 'chart' && activeRange === rangeKey) {
        const el = document.getElementById('chart-canvas');
        if (el) el.innerHTML = chartCanvasHtml(symbol, rangeKey);
      }
      // Full-screen chart page has its own canvas.
      if (activeRange === rangeKey && location.hash.startsWith('#/chart/')) {
        const fc = document.getElementById('full-chart-canvas');
        if (fc) fc.innerHTML = chartCanvasHtml(symbol, rangeKey, 340);
      }
    });
}

// Catmull-Rom -> cubic Bézier: a smooth, non-overshooting curve through the
// points. Far nicer than raw straight segments for price data.
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// Human date/time label for an x-axis tick. Intraday spans show the clock;
// multi-day spans show the calendar date. `times` are ms timestamps.
function fmtAxisTick(ms, spanMs) {
  const d = new Date(ms);
  if (spanMs < 3 * 86400000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Shared polished price chart. Uniform scaling (no distortion), smooth line with
// a soft glow, faint gridlines, a last-price marker, optional entry/stop/
// target levels with small value chips, and a real time axis when `times` is
// supplied. `levels` = [{v, stroke, label}]; `times` = ms timestamps aligned
// with `series` (drives the x-axis labels).
// Split reference levels into their dashed lines (drawn behind the price) and
// their price chips (drawn on top), so the price line/bars never cross through
// the label text. `w` is the plot width; chips hug the right edge.
function levelParts(levels, yFor, h, decimals, w) {
  let lines = '', chips = '';
  for (const l of levels) {
    const y = yFor(l.v);
    if (y < 6 || y > h - 6) continue;
    const label = l.v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    const chipW = 8 + label.length * 5.4;
    lines += `<line x1="0" y1="${y.toFixed(1)}" x2="${(w - chipW - 3).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${l.stroke}" stroke-width="1" stroke-dasharray="3 4" opacity="0.8"/>`;
    chips += `<rect x="${(w - chipW).toFixed(1)}" y="${(y - 7).toFixed(1)}" width="${chipW.toFixed(1)}" height="14" rx="4" fill="${l.stroke}"/>`
      + `<text x="${(w - chipW / 2).toFixed(1)}" y="${(y + 3.2).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#08120d">${label}</text>`;
  }
  return { lines, chips };
}

function priceChartSvg(series, color, { levels = [], decimals = 2, markers = [], h = 188, times = [] } = {}) {
  const w = 500;
  const hasAxis = Array.isArray(times) && times.length === (series ? series.length : -1) && times.length >= 2;
  const axisH = hasAxis ? 18 : 0;               // room below the plot for date labels
  const vbH = h + axisH;
  if (!series || series.length < 2) return `<svg viewBox="0 0 ${w} ${vbH}" width="100%" style="height:auto;display:block"></svg>`;
  const vals = series.concat(levels.map((l) => l.v)).concat(markers.map((m) => m.value));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || Math.abs(min) * 0.01 || 1;
  const pad = span * 0.14;
  const lo = min - pad, hi = max + pad;
  const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
  const step = w / (series.length - 1);
  const pts = series.map((p, i) => [i * step, yFor(p)]);
  // Straight segments between real data points — how actual trading charts draw a
  // price line. (The old smooth spline made real data look like a designed curve.)
  const lineD = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${w.toFixed(1)},${h} L0,${h} Z`;
  const uid = 'c' + Math.random().toString(36).slice(2, 7);
  const last = pts[pts.length - 1];
  const grid = [0.25, 0.5, 0.75].map((f) =>
    `<line x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}" stroke="var(--hairline)" stroke-width="1" opacity="0.45"/>`).join('');
  let axisSvg = '';
  if (hasAxis) {
    const spanMs = (times[times.length - 1] - times[0]) || 1;
    const ticks = 4;
    for (let k = 0; k <= ticks; k++) {
      const idx = Math.round((k / ticks) * (series.length - 1));
      const x = idx * step;
      const anchor = k === 0 ? 'start' : k === ticks ? 'end' : 'middle';
      const xClamped = k === 0 ? 2 : k === ticks ? w - 2 : x;
      axisSvg += `<text x="${xClamped.toFixed(1)}" y="${(h + 13).toFixed(1)}" text-anchor="${anchor}" font-size="9" fill="var(--text-muted)" opacity="0.85">${fmtAxisTick(times[idx], spanMs)}</text>`;
    }
  }
  const lv = levelParts(levels, yFor, h, decimals, w);
  return `
  <svg viewBox="0 0 ${w} ${vbH}" width="100%" style="height:auto;display:block">
    <defs>
      <linearGradient id="fill${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
      <filter id="glow${uid}" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="2.4"/></filter>
    </defs>
    ${grid}
    ${axisSvg}
    ${lv.lines}
    <path d="${areaD}" fill="url(#fill${uid})"/>
    <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" opacity="0.3" filter="url(#glow${uid})"/>
    <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="6" fill="${color}" opacity="0.2"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${color}"/>
    ${markers.map((m) => {
      const x = Math.max(6, Math.min(w - 6, m.xFrac * w)), y = yFor(m.value);
      if (m.kind === 'exit') {
        const c = m.win ? 'var(--buy)' : 'var(--sell)';
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2" fill="var(--bg)" stroke="${c}" stroke-width="2"/>`;
      }
      const up = m.kind === 'buy', c = up ? 'var(--buy)' : 'var(--sell)';
      const t = up ? `M${x.toFixed(1)},${(y - 7).toFixed(1)} l-5,8 l10,0 Z` : `M${x.toFixed(1)},${(y + 7).toFixed(1)} l-5,-8 l10,0 Z`;
      return `<path d="${t}" fill="${c}" stroke="var(--bg)" stroke-width="0.8"/>`;
    }).join('')}
    ${lv.chips}
  </svg>`;
}

// Candlestick chart from real OHLC bars — the classic trading view: a high-low
// wick and an open-close body per bar, green up / red down. Same scaling, grid,
// time axis, level lines and trade markers as the line chart.
function candleChartSvg(candles, { levels = [], decimals = 2, markers = [], h = 188, times = [] } = {}) {
  const w = 500;
  const hasAxis = Array.isArray(times) && times.length === (candles ? candles.length : -1) && times.length >= 2;
  const axisH = hasAxis ? 18 : 0;
  const vbH = h + axisH;
  if (!candles || candles.length < 2) return `<svg viewBox="0 0 ${w} ${vbH}" width="100%" style="height:auto;display:block"></svg>`;
  const highs = candles.map((c) => (c.h != null ? c.h : c.c));
  const lows = candles.map((c) => (c.l != null ? c.l : c.c));
  const vals = highs.concat(lows).concat(levels.map((l) => l.v)).concat(markers.map((m) => m.value));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || Math.abs(min) * 0.01 || 1;
  const pad = span * 0.08;
  const lo = min - pad, hi = max + pad;
  const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
  const n = candles.length;
  const slot = w / n;
  const bodyW = Math.max(1.2, Math.min(slot * 0.68, 10));
  const grid = [0.25, 0.5, 0.75].map((f) =>
    `<line x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}" stroke="var(--hairline)" stroke-width="1" opacity="0.45"/>`).join('');
  let axisSvg = '';
  if (hasAxis) {
    const spanMs = (times[times.length - 1] - times[0]) || 1;
    const ticks = 4;
    for (let k = 0; k <= ticks; k++) {
      const idx = Math.round((k / ticks) * (n - 1));
      const anchor = k === 0 ? 'start' : k === ticks ? 'end' : 'middle';
      const x = k === 0 ? 2 : k === ticks ? w - 2 : idx * slot + slot / 2;
      axisSvg += `<text x="${x.toFixed(1)}" y="${(h + 13).toFixed(1)}" text-anchor="${anchor}" font-size="9" fill="var(--text-muted)" opacity="0.85">${fmtAxisTick(times[idx], spanMs)}</text>`;
    }
  }
  const lv = levelParts(levels, yFor, h, decimals, w);
  // Volume band: faint bars along the bottom ~18% of the pane, colored by the
  // candle's direction and scaled to the largest bar. Drawn first so price sits
  // on top. Only when the feed actually carries volume (some indices report 0).
  const maxV = Math.max(...candles.map((c) => c.v || 0), 0);
  const volMaxH = h * 0.18;
  const volBars = maxV > 0 ? candles.map((c, i) => {
    const cx = i * slot + slot / 2;
    const vh = ((c.v || 0) / maxV) * volMaxH;
    if (vh < 0.5) return '';
    const up = c.c >= (c.o != null ? c.o : c.c);
    return `<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${(h - vh).toFixed(1)}" width="${bodyW.toFixed(1)}" height="${vh.toFixed(1)}" fill="${up ? 'var(--buy)' : 'var(--sell)'}" opacity="0.22"/>`;
  }).join('') : '';
  const bars = candles.map((c, i) => {
    const cx = i * slot + slot / 2;
    const o = c.o != null ? c.o : c.c, hh = c.h != null ? c.h : c.c, ll = c.l != null ? c.l : c.c;
    const up = c.c >= o;
    const col = up ? 'var(--buy)' : 'var(--sell)';
    const yH = yFor(hh), yL = yFor(ll), yO = yFor(o), yC = yFor(c.c);
    const top = Math.min(yO, yC), bodyH = Math.max(1, Math.abs(yC - yO));
    return `<line x1="${cx.toFixed(1)}" y1="${yH.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yL.toFixed(1)}" stroke="${col}" stroke-width="1" opacity="0.85"/><rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${col}" rx="0.6"/>`;
  }).join('');
  const markerSvg = markers.map((m) => {
    const x = Math.max(6, Math.min(w - 6, m.xFrac * w)), y = yFor(m.value);
    if (m.kind === 'exit') {
      const c = m.win ? 'var(--buy)' : 'var(--sell)';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2" fill="var(--bg)" stroke="${c}" stroke-width="2"/>`;
    }
    const up = m.kind === 'buy', c = up ? 'var(--buy)' : 'var(--sell)';
    const t = up ? `M${x.toFixed(1)},${(y - 8).toFixed(1)} l-5,8 l10,0 Z` : `M${x.toFixed(1)},${(y + 8).toFixed(1)} l-5,-8 l10,0 Z`;
    return `<path d="${t}" fill="${c}" stroke="var(--bg)" stroke-width="0.8"/>`;
  }).join('');
  return `
  <svg viewBox="0 0 ${w} ${vbH}" width="100%" style="height:auto;display:block">
    ${grid}
    ${volBars}
    ${axisSvg}
    ${lv.lines}
    ${bars}
    ${markerSvg}
    ${lv.chips}
  </svg>`;
}

// Entry (▲ buy / ▼ sell) and exit (○ win/loss) markers for this market's real
// paper trades, positioned along the series by time. `times` are the ms
// timestamps aligned with `series`. Never any simulated trades — the record only
// holds real fills.
function tradeMarkers(symbol, times) {
  if (!Array.isArray(times) || times.length < 2) return [];
  const t0 = times[0], t1 = times[times.length - 1];
  const span = (t1 - t0) || 1;
  const frac = (t) => Math.max(0, Math.min(1, (t - t0) / span));
  const out = [];
  const closed = getClosedTrades().filter((c) => c.symbol === symbol);
  for (const c of closed) {
    const buy = (c.side || 'LONG') === 'LONG';
    if (c.openedAt && c.entry != null) out.push({ xFrac: frac(c.openedAt), value: c.entry, kind: buy ? 'buy' : 'sell' });
    if (c.closedAt && c.exit != null) out.push({ xFrac: frac(c.closedAt), value: c.exit, kind: 'exit', win: (c.pnl || 0) >= 0 });
  }
  for (const p of getOpenPositions().filter((p) => p.symbol === symbol)) {
    if (p.openedAt && p.entry != null) out.push({ xFrac: frac(p.openedAt), value: p.entry, kind: (p.side || 'LONG') === 'LONG' ? 'buy' : 'sell' });
  }
  return out;
}

function areaChart(market, candles, color, showLevels, chartH) {
  const s = market.signal;
  // Level lines honour the user's plan profile (stop + reward:risk), matching the
  // Signal/Chart tab levels rather than a fixed 1:1 target.
  const chLong = s.verdict !== 'SELL';
  const chCfg = planConfigFor();
  const chStop = s.plan ? planStopPrice(s.plan.entry, s.plan.stop, chLong, chCfg) : 0;
  const chTarget = s.plan ? planTargetPrice(s.plan.entry, chStop, chLong, chCfg) : 0;
  const levels = showLevels && s.plan ? [
    { v: chTarget, stroke: 'var(--buy)', label: 'T' },
    { v: s.plan.entry, stroke: 'var(--accent)', label: 'E' },
    { v: chStop, stroke: 'var(--sell)', label: 'S' },
  ] : [];
  // If the paper account holds this market but there's no active setup line,
  // draw the position entry so the user still sees where they're in.
  const openPos = getOpenPositions().find((p) => p.symbol === market.symbol);
  if (!showLevels && openPos && openPos.entry != null) levels.push({ v: openPos.entry, stroke: 'var(--accent-200)', label: 'Pos' });
  const times = candles.map((c) => (c.t < 1e12 ? c.t * 1000 : c.t));
  const markers = tradeMarkers(market.symbol, times);
  // Candlesticks when the user prefers them AND we have real OHLC bars (the Worker
  // /candles feed); the seeded daily-close fallback has no OHLC, so it stays a line.
  const hasOHLC = candles.length >= 2 && candles.every((c) => c.o != null && c.h != null && c.l != null);
  if (state.settings.chartType !== 'line' && hasOHLC) {
    return candleChartSvg(candles, { levels, decimals: market.decimals, markers, h: chartH, times });
  }
  return priceChartSvg(candles.map((c) => c.c), color, { levels, decimals: market.decimals, markers, h: chartH, times });
}

function chartCanvasHtml(symbol, rangeKey, chartH) {
  const market = state.engine.get(symbol);
  if (!market) return '';
  const color = verdictColorVar(market.verdict(state.settings.threshold));
  const ySym = YAHOO_SYMBOL[symbol];
  if (!ySym) {
    return `${chartSvg(market, color, chartH)}<div class="text-muted" style="font-size:11px;margin-top:6px;text-align:center">Historical chart isn't available for this market.</div>`;
  }
  const cached = candleCache.get(`${symbol}|${rangeKey}`);
  // Draw entry/stop/target on every range when there's an active setup (the plan
  // levels are the same regardless of the zoom).
  const showLevels = market.verdict(state.settings.threshold) !== 'NO_TRADE';
  if (cached && cached.candles && cached.candles.length > 1) {
    const closes = cached.candles.map((c) => c.c);
    const first = closes[0], last = closes[closes.length - 1];
    const chgPct = ((last - first) / first) * 100;
    const chgColor = chgPct >= 0 ? 'var(--buy)' : 'var(--sell)';
    return `
      ${areaChart(market, cached.candles, color, showLevels, chartH)}
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:6px">
        <span class="text-muted">${cached.candles.length} candles · ${RANGES[rangeKey].label}</span>
        <span style="color:${chgColor}">${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}% over ${RANGES[rangeKey].label}</span>
      </div>`;
  }
  if (cached && cached.failed) {
    // For the 1M (daily) range the server's daily closes ARE the correct view —
    // no caveat needed. For intraday ranges, daily closes are a coarser fallback,
    // so say so honestly.
    const caption = RANGES[rangeKey].interval === '1d'
      ? `${market.history.length} daily closes`
      : `Intraday ${RANGES[rangeKey].label} history is unavailable right now — showing daily closes.`;
    return `${chartSvg(market, color, chartH)}<div class="text-muted" style="font-size:11px;margin-top:6px;text-align:center">${caption}</div>`;
  }
  // Not loaded yet: instead of a blank spinner, draw instantly from the daily
  // closes the server already sent us (real data, no extra fetch), then swap to
  // the finer intraday history when it arrives. Keeps the chart from ever
  // looking empty or slow.
  if (market.history && market.history.length > 1) {
    return `${chartSvg(market, color, chartH)}<div class="text-muted" style="font-size:11px;margin-top:6px;text-align:center"><i class="ph ph-hourglass-medium" style="margin-right:5px"></i>Loading ${RANGES[rangeKey].label} detail…</div>`;
  }
  return `<div style="height:${chartH || 172}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12.5px"><i class="ph ph-hourglass-medium" style="font-size:18px;margin-right:8px"></i>Loading ${RANGES[rangeKey].label} chart…</div>`;
}

// Line/Candles toggle button — shows the current mode; tap flips it.
function chartTypeToggleHtml() {
  const candles = state.settings.chartType !== 'line';
  return `<button class="chart-type-btn" title="${candles ? 'Candlesticks — tap for line' : 'Line — tap for candles'}" style="border:none;cursor:pointer;background:var(--neutral-900);border-radius:8px;width:32px;height:32px;color:var(--accent-200);display:flex;align-items:center;justify-content:center;flex:none"><i class="ph-bold ${candles ? 'ph-chart-bar' : 'ph-chart-line'}"></i></button>`;
}
function wireChartType(container, rerender) {
  container.querySelectorAll('.chart-type-btn').forEach((btn) => btn.addEventListener('click', () => {
    state.settings.chartType = state.settings.chartType === 'line' ? 'candles' : 'line';
    saveSettings();
    rerender();
  }));
}

// Full-screen chart page (#/chart/<symbol>) — one large annotated chart plus the
// market's real trade log. Reached via the expand button on the Chart tab.
export function renderChartPage(container) {
  const symbol = state.selectedSymbol;
  const market = state.engine.get(symbol);
  if (!market) { location.hash = '#/home'; return; }
  const color = verdictColorVar(market.verdict(state.settings.threshold));
  const ySym = YAHOO_SYMBOL[symbol];
  if (ySym && !activeRange) activeRange = RANGES[state.settings.chartRange] ? state.settings.chartRange : '1D';
  if (ySym) queueMicrotask(() => loadCandles(symbol, ySym, activeRange));
  const trades = getClosedTrades().filter((c) => c.symbol === symbol);
  const open = getOpenPositions().filter((p) => p.symbol === symbol);
  container.innerHTML = `
  <div class="fade-in">
    <div class="detail-header">
      <button class="back-btn" data-back aria-label="Go back"><i class="ph-bold ph-arrow-left"></i></button>
      <div class="detail-title-block">
        <div class="detail-title">${symbol} · ${market.name}</div>
        <div class="detail-sub">${market.exchange} · ${market.signal.timeframe} · entries & exits</div>
      </div>
    </div>
    <div class="chart-box">
      <div class="chart-box-head">
        <div style="font:600 13px var(--font-heading)">${symbol} price</div>
        <div style="display:flex;align-items:center;gap:6px">
          ${chartTypeToggleHtml()}
          <div style="display:flex;gap:3px;background:var(--neutral-900);border-radius:8px;padding:3px">
            ${Object.keys(RANGES).map((k) => `<button class="chart-range-btn" data-range="${k}" style="border:none;cursor:pointer;font:600 12px var(--font-heading);padding:5px 13px;border-radius:6px;background:${k === activeRange ? 'var(--accent-800)' : 'transparent'};color:${k === activeRange ? 'var(--accent-100)' : 'var(--text-muted)'}">${RANGES[k].label}</button>`).join('')}
          </div>
        </div>
      </div>
      <div id="full-chart-canvas">${chartCanvasHtml(symbol, activeRange, 340)}</div>
      <div class="overlay-tags" style="margin-top:8px">
        <span class="overlay-tag"><span class="dot" style="background:var(--buy)"></span>Buy</span>
        <span class="overlay-tag"><span class="dot" style="background:var(--sell)"></span>Sell</span>
        <span class="overlay-tag"><span class="dot" style="background:transparent;border:2px solid var(--buy);border-radius:50%"></span>Exit win</span>
        <span class="overlay-tag"><span class="dot" style="background:transparent;border:2px solid var(--sell);border-radius:50%"></span>Exit loss</span>
      </div>
    </div>
    <div class="section-label">Trades on ${symbol}</div>
    <div class="card" style="padding:2px 12px">
      ${open.map((p) => `<div class="level-row"><span>${(p.side || 'LONG') === 'LONG' ? '▲ Long' : '▼ Short'} · open</span><span class="tabular text-muted">entry ${fmtPrice(p.entry, market.decimals)}</span></div>`).join('')}
      ${trades.slice(0, 40).map((c) => {
        const win = (c.pnl || 0) >= 0;
        return `<div class="level-row"><span>${(c.side || 'LONG') === 'LONG' ? '▲' : '▼'} ${fmtPrice(c.entry, market.decimals)} → ${fmtPrice(c.exit, market.decimals)}</span><span class="tabular" style="color:${win ? 'var(--buy)' : 'var(--sell)'}">${win ? '+' : ''}${Math.round(c.pnl || 0)}</span></div>`;
      }).join('')}
      ${!open.length && !trades.length ? '<div class="text-muted" style="font-size:12.5px;padding:14px 4px">No trades on this market yet — entry and exit markers appear here and on the chart once the strategy fires a setup.</div>' : ''}
    </div>
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px;padding:0 8px">Paper trades on virtual money, filled on delayed real data — not live-executed. Educational only.</p>
  </div>`;
  container.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));
  container.querySelectorAll('.chart-range-btn').forEach((btn) => btn.addEventListener('click', () => {
    activeRange = btn.dataset.range; state.settings.chartRange = activeRange; saveSettings();
    renderChartPage(container);
  }));
  wireChartType(container, () => renderChartPage(container));
}

function wireChartRange(container, market, verdict, color) {
  const rebuild = () => {
    const wrap = container.querySelector('#signal-tab-content');
    if (wrap) {
      wrap.innerHTML = renderChartTab(market, color, verdict);
      wireChartRange(container, market, verdict, color);
    }
  };
  container.querySelectorAll('.chart-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeRange = btn.dataset.range;
      state.settings.chartRange = activeRange;
      saveSettings();
      rebuild();
    });
  });
  wireChartType(container, rebuild);
}

function chartSvg(market, color, chartH) {
  const s = market.signal;
  const showLevels = market.verdict(state.settings.threshold) !== 'NO_TRADE' && s.plan;
  const csLong = s.verdict !== 'SELL';
  const csCfg = planConfigFor();
  const csStop = s.plan ? planStopPrice(s.plan.entry, s.plan.stop, csLong, csCfg) : 0;
  const csTarget = s.plan ? planTargetPrice(s.plan.entry, csStop, csLong, csCfg) : 0;
  const levels = showLevels ? [
    { v: csTarget, stroke: 'var(--buy)', label: 'T' },
    { v: s.plan.entry, stroke: 'var(--accent)', label: 'E' },
    { v: csStop, stroke: 'var(--sell)', label: 'S' },
  ] : [];
  const openPos = getOpenPositions().find((p) => p.symbol === market.symbol);
  if (!showLevels && openPos && openPos.entry != null) levels.push({ v: openPos.entry, stroke: 'var(--accent-200)', label: 'Pos' });
  const n = 48;
  const series = market.history.slice(-n);
  const times = (market.historyTimes || []).slice(-n);
  const markers = tradeMarkers(market.symbol, times);
  return priceChartSvg(series, color, { levels, decimals: market.decimals, markers, h: chartH, times });
}

// Indicator-driven "what to do now": the app reading the live indicators (RSI2,
// the stop level) and suggesting book-profit / cut / hold / enter — the strategy's
// real exit logic, not the user's profile. Honest: every call is a real indicator
// state (RSI2 ≥ 65 = mean reached = take profit; price at the risk level = stop).
function actionSuggestion(market, s, verdict) {
  const rsi = s.rsi2;
  const has = typeof rsi === 'number';
  const rtxt = has ? Math.round(rsi) : '—';
  const price = market.price ?? s.price;
  const strat = getStrategy();
  const ind = strat.indicator;                       // e.g. "RSI-2"
  const exitAbove = (s.plan && s.plan.exitAbove) || strat.exitAbove;
  const entryBelow = strat.entryBelow;
  const pos = getOpenPositions().find((p) => p.symbol === market.symbol);
  // News/event regime filter: a scheduled high-impact event holds new entries.
  if (!pos && verdict === 'BUY' && s.newsHold) {
    return { icon: 'ph-newspaper', tone: 'var(--flat)', title: 'Standing aside — event risk', text: `The setup fired, but ${s.newsHold} is due today. Mean reversion is unreliable into a scheduled event, so the strategy waits it out rather than fading news.` };
  }
  if (pos) {
    const long = (pos.side || 'LONG') === 'LONG';
    if (price != null && (long ? price <= pos.stop : price >= pos.stop)) {
      return { icon: 'ph-hand-palm', tone: 'var(--sell)', title: 'Stop loss — cut it', text: `Price has reached your risk level (${fmtPrice(pos.stop, market.decimals)}). The strategy exits to cap the loss.` };
    }
    if (pos.strat === 'trend') {
      return { icon: 'ph-trend-up', tone: 'var(--flat)', title: 'Ride the trend', text: `This is a trend-continuation trade — let it run. It exits when the trend breaks or price hits the ${fmtPrice(pos.stop, market.decimals)} stop.` };
    }
    if (has && rsi >= exitAbove) {
      return { icon: 'ph-flag-checkered', tone: 'var(--buy)', title: 'Book profit now', text: 'The oversold move has reverted to the mean — this is where the strategy takes profit.' };
    }
    return { icon: 'ph-hourglass-medium', tone: 'var(--flat)', title: 'Hold the trade', text: `The bounce hasn't fully reverted to the mean yet. Hold until it does (book profit) or price hits the ${fmtPrice(pos.stop, market.decimals)} stop (cut the loss).` };
  }
  if (verdict === 'BUY' && s.strat === 'trend') {
    return { icon: 'ph-trend-up', tone: 'var(--buy)', title: 'Trend entry', text: 'A continuation setup — the market is trending up with momentum. The strategy rides it until the trend breaks, with a stop below.' };
  }
  if (verdict === 'BUY') {
    return { icon: 'ph-arrow-up-right', tone: 'var(--buy)', title: 'Buy the flush', text: 'Deeply oversold in an uptrend — the dip the strategy buys. It takes profit as the move reverts to the mean, and stops out at the risk level below.' };
  }
  if (has && rsi >= exitAbove) {
    return { icon: 'ph-minus-circle', tone: 'var(--flat)', title: 'No setup — already bounced', text: 'This market has already recovered from oversold — the strategy buys the flush, not the bounce. Nothing to do here.' };
  }
  return { icon: 'ph-hourglass-medium', tone: 'var(--flat)', title: 'No setup — waiting', text: 'Not stretched enough to buy — the strategy waits for a deeper oversold flush in an uptrend. Watching.' };
}

// "You vs Ajent" — the user's own book (custom trades) scored against the
// algorithm's record, plus the action to take a signal your own way.
function userBookPanel(market, verdict, s, dispEntry, dispStop, dispTarget) {
  const sym = market.symbol;
  const pos = userTradeFor(sym);
  const you = userStats();
  const aj = getPerformanceSummary() || { totalPnl: 0, winRate: 0, profitFactor: null };
  const ajR = ajentAvgR(getClosedTrades());
  const money = (n) => `${n >= 0 ? '+$' : '−$'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const pf = (v) => (v == null ? '∞' : (+v).toFixed(2));
  const rr = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`);
  const cmp = `<div class="vs-grid">
    <div class="vs-col"><div class="vs-who">AJENT</div><div class="vs-exp" style="color:${(ajR || 0) >= 0 ? 'var(--buy)' : 'var(--sell)'}">${rr(ajR)}<span class="vs-exp-l">avg/trade</span></div><div class="vs-sub">${money(aj.totalPnl || 0)} · ${aj.winRate || 0}% · PF ${pf(aj.profitFactor)}</div></div>
    <div class="vs-mid">vs</div>
    <div class="vs-col"><div class="vs-who">YOU</div><div class="vs-exp" style="color:${(you.avgR || 0) >= 0 ? 'var(--buy)' : 'var(--sell)'}">${rr(you.avgR)}<span class="vs-exp-l">avg/trade</span></div><div class="vs-sub">${money(you.net)} · ${you.winRate}% · ${you.trades}T</div></div>
  </div>`;
  let action = '';
  if (pos) {
    const un = unrealizedFor(pos, market.price);
    action = `<div class="ub-open">
      <div class="ub-open-row"><span><b style="color:var(--text)">Your ${sym} trade</b> · open</span><span style="color:${un >= 0 ? 'var(--buy)' : 'var(--sell)'};font:600 13px var(--font-mono)">${money(un)} <span class="text-faint" style="font-weight:400">unreal.</span></span></div>
      <div class="ub-lvls">Entry ${fmtPrice(pos.entry, pos.decimals)} · Stop ${fmtPrice(pos.stop, pos.decimals)}${pos.target ? ` · Target ${fmtPrice(pos.target, pos.decimals)}` : ''} · ${money(pos.riskDollars)} risk</div>
      <button class="btn btn-ghost ub-close" data-ub-close="${sym}" style="height:38px;margin-top:9px;width:100%">Close at market · ${fmtPrice(market.price, pos.decimals)}</button>
    </div>`;
  } else if (s.plan && (verdict === 'BUY' || verdict === 'SELL')) {
    action = `<details class="ub-form">
      <summary class="ub-cta">Trade it your way <i class="ph-bold ph-caret-down"></i></summary>
      <div class="ub-form-body">
        <p class="text-muted" style="font-size:11.5px;line-height:1.5;margin:2px 0 10px">Set your own entry, stop and target — tracked in <b style="color:var(--text)">your book</b> (virtual money) so you can see how your version does against Ajent's.</p>
        <label class="ub-field"><span>Entry</span><input type="number" step="any" data-ub="entry" value="${(+dispEntry).toFixed(market.decimals)}"></label>
        <label class="ub-field"><span>Stop</span><input type="number" step="any" data-ub="stop" value="${(+dispStop).toFixed(market.decimals)}"></label>
        <label class="ub-field"><span>Target</span><input type="number" step="any" data-ub="target" value="${(+dispTarget).toFixed(market.decimals)}"></label>
        <label class="ub-field"><span>Risk&nbsp;$</span><input type="number" step="any" data-ub="risk" value="${defaultRiskDollars()}"></label>
        <button class="btn btn-primary ub-add" data-ub-add="${sym}" style="height:42px;width:100%;margin-top:11px">Add to my book</button>
      </div>
    </details>`;
  }
  return `<div class="panel ub-panel">
    <div class="panel-title" style="display:flex;align-items:center;gap:8px"><i class="ph-fill ph-scales" style="color:var(--accent)"></i>You vs Ajent</div>
    ${cmp}
    <div class="fair-note"><b>Avg/trade (expectancy) is the fair number</b> — it holds at any scale, even a small account trading a few positions. Net $ just reflects how many trades each took (Ajent trades the whole board; you trade what you pick).</div>
    ${(() => { const h = headToHead(); if (!h) return ''; const r = (v) => `${v >= 0 ? '+' : ''}${v}R`; const c = (v) => v >= 0 ? 'var(--buy)' : 'var(--sell)'; return `<div class="h2h">
      <div class="h2h-h">Same-trade head-to-head · ${h.n} trade${h.n === 1 ? '' : 's'}</div>
      <div class="h2h-row"><span>Your levels</span><span class="h2h-r" style="color:${c(h.youAvgR)}">${r(h.youAvgR)}</span></div>
      <div class="h2h-row"><span>Ajent's plan</span><span class="h2h-r" style="color:${c(h.ajAvgR)}">${r(h.ajAvgR)}</span></div>
      <div class="h2h-note">Your entry/stop/target vs Ajent's <b>suggested plan on the same signals</b> — you came out ahead on <b>${h.youWon} of ${h.n}</b>. This holds trade selection constant, so it's purely your decisions.</div>
    </div>`; })()}
    ${action}
    <a href="#/mystrategy" class="ub-strat-link">Build your own strategy — beat Ajent your way <i class="ph-bold ph-caret-right"></i></a>
    <div class="text-faint" style="font-size:10.5px;margin-top:11px;line-height:1.45">Your book is virtual money kept on this device. Simulated and educational — not advice, no real orders.</div>
  </div>`;
}

function renderSignalTab(market, verdict, color) {
  const s = market.signal;
  // Stop + reference target in the plan honour the user's per-strategy profile
  // (stop distance and reward:risk). The tracked record still uses 2× ATR + RSI2.
  const planCfg = planConfigFor();
  const planLong = verdict !== 'SELL';
  // Trend continuation setups ride the move with a ratcheting TRAILING stop; the
  // mean-reversion dips exit on reversion. The plan copy adapts to which fired.
  const isTrend = s.strat === 'trend';
  const planEntry = s.plan ? s.plan.entry : 0;
  const dispStop = s.plan ? planStopPrice(planEntry, s.plan.stop, planLong, planCfg) : 0;
  const dispTarget = s.plan ? planTargetPrice(planEntry, dispStop, planLong, planCfg) : 0;
  const rrStr = (Number(planCfg.rr) || 1).toFixed(planCfg.rr % 1 ? 1 : 0);
  const stopLabel = isTrend ? 'Trailing stop · initial'
    : planCfg.stopMode === 'pct' ? `Stop loss · ${planCfg.stopValue}%`
    : planCfg.stopMode === 'usd' ? `Stop loss · ${planCfg.stopValue} pts`
    : `Stop loss · ${planCfg.stopValue}× volatility`;
  // Describe WHAT the setup is here — the eyebrow already says "Setup confirmed", so
  // don't repeat it. Strat-aware so a trend BUY doesn't read like an oversold dip.
  const buySub = isTrend ? 'Riding an established uptrend' : 'Oversold dip within an uptrend';
  const subline = (verdict === 'NO_TRADE' ? 'Waiting for a high-probability setup' : (verdict === 'BUY' ? buySub : 'Fading an overbought pop'))
    + (s.provisional ? ' · <span style="color:var(--accent-200)">provisional (short side unproven)</span>' : '');
  const status = autoTradeStatus(market, verdict);
  const statusHtml = status ? `
  <div class="trade-status ${status.ok ? 'ok' : 'wait'}">
    <i class="ph-fill ${status.ok ? 'ph-check-circle' : 'ph-info'}"></i>
    <span>${status.text}</span>
  </div>` : '';
  const eyebrow = verdict === 'NO_TRADE' ? 'Standing by' : verdict === 'BUY' ? 'Setup confirmed' : 'Setup confirmed · short';
  return `
  <div class="verdict-frame${verdict === 'NO_TRADE' ? ' quiet' : ''}" style="--vc:${color}">
    <div class="verdict-glow" aria-hidden="true"></div>
    <div class="verdict-eye">${eyebrow}</div>
    <div class="verdict-big" style="color:${color}">${verdictIcon(verdict)}<span>${verdict === 'NO_TRADE' ? 'NO TRADE' : verdict}</span></div>
    <div class="verdict-sub">${subline}</div>
    ${confidenceRing(s.confidence, color)}
  </div>
  ${statusHtml}

  ${(() => { const g = actionSuggestion(market, s, verdict); return `
  <div class="panel" style="border-left:3px solid ${g.tone};padding:13px 15px">
    <div style="display:flex;align-items:center;gap:9px">
      <i class="ph-fill ${g.icon}" style="color:${g.tone};font-size:19px"></i>
      <div style="font:700 14px var(--font-heading)">${g.title}</div>
      <span class="text-faint" style="font-size:10px;margin-left:auto;text-transform:uppercase;letter-spacing:.05em">Indicator signal</span>
    </div>
    <div class="text-muted" style="font-size:12.5px;line-height:1.55;margin-top:7px">${g.text}</div>
  </div>`; })()}

  <div class="stat3-row">
    <div class="stat3-cell"><div class="k">Trend</div><div class="v" style="color:${s.trend === 'Bullish' ? 'var(--buy)' : s.trend === 'Bearish' ? 'var(--sell)' : 'var(--flat)'}">${s.trend}</div></div>
    <div class="stat3-cell"><div class="k">Volatility</div><div class="v">${s.volatility}</div></div>
    <div class="stat3-cell"><div class="k">Hold</div><div class="v">${s.expectedHold}</div></div>
  </div>

  ${verdict === 'NO_TRADE' ? `
  <div class="panel">
    <div class="panel-title">Trade plan</div>
    <div class="text-muted" style="font-size:12.5px;line-height:1.6;padding:6px 2px">
      No setup right now. Ajent only publishes entry, stop and target levels once a
      <b style="color:var(--buy)">BUY</b> or <b style="color:var(--sell)">SELL</b> clears your confidence
      threshold — until then there's nothing to trade. The plan appears automatically when a signal fires.
    </div>
    ${planRow('Timeframe', s.timeframe, 'var(--neutral-500)')}
  </div>` : `
  <div class="panel">
    <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span>Trade plan</span>
      ${s.plan.conviction === 'high' ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;letter-spacing:.03em;color:var(--buy);background:var(--buy-dim);padding:4px 9px;border-radius:999px"><i class="ph-fill ph-arrow-fat-lines-up"></i>HIGH CONVICTION</span>' : ''}
    </div>
    ${s.plan.conviction === 'high' ? `<div class="text-muted" style="font-size:11.5px;line-height:1.5;margin:0 2px 8px">Deepest-oversold tier — historically ~2&times; the ordinary setup's per-trade edge.${state.settings.scaleByConviction ? ' Sized 1.5&times; (conviction sizing on).' : ''}</div>` : ''}
    ${edgeNote(market.symbol)}
    ${planRow('Suggested entry', fmtPrice(s.plan.entry, market.decimals), 'var(--accent)')}
    ${planRow(stopLabel, fmtPrice(dispStop, market.decimals), 'var(--sell)')}
    ${planRow('Exit trigger', isTrend ? 'Trail the stop · ride until the trend breaks' : 'When it reverts to the mean', 'var(--buy)')}
    ${planRow(`Reference target · ${rrStr}:1`, fmtPrice(dispTarget, market.decimals), 'var(--neutral-500)')}
    ${planRow('Max hold', s.expectedHold, 'var(--neutral-500)')}
    ${planRow('Timeframe', s.timeframe, 'var(--neutral-500)')}
    ${isTrend ? `<div class="panel" style="background:var(--buy-dim);border:1px solid color-mix(in srgb,var(--buy) 22%,transparent);border-radius:11px;padding:10px 12px;margin-top:9px;display:flex;gap:9px;align-items:flex-start">
      <i class="ph-fill ph-trend-up" style="color:var(--buy);font-size:17px;flex:none;margin-top:1px"></i>
      <div style="font-size:11.5px;line-height:1.55;color:var(--text-muted)"><b style="color:var(--text)">Use a trailing stop.</b> This is a continuation setup — let it run and <b style="color:var(--text)">ratchet your stop up</b> as price rises (about 3&times; volatility below the peak), instead of a fixed target. You exit only when the trend actually breaks, so a big winner isn't cut short.</div>
    </div>` : ''}
    <div class="text-muted" style="font-size:11.5px;line-height:1.55;margin-top:8px;padding:0 2px">
      ${isTrend
        ? `This is a <b style="color:var(--text)">trend-continuation</b> trade: it buys an established uptrend and rides it, exiting on a <b style="color:var(--text)">trailing stop</b> that ratchets up with price — so winners run and the exit only fires when momentum breaks. The reference target is the ~1:1 level for orientation, not a cap.`
        : `This is a <b style="color:var(--text)">mean-reversion</b> trade: it buys the oversold flush and exits when the <b style="color:var(--text)">move reverts to the mean</b> — rather than at a fixed target, so winners can run past the 1:1 mark. A hard <b style="color:var(--text)">volatility-based stop</b> caps the downside and a time stop closes stale trades. The reference target is the ~1:1 level for orientation, not a hard exit.`}
    </div>
    ${isDefaultPlan(planCfg) ? '' : `<div class="text-faint" style="font-size:11px;line-height:1.5;margin-top:8px;padding:0 2px">Your custom stop / reward:risk is applied to this plan. The 24/7 tracked paper record is one shared account and still runs the strategy's own validated stop &amp; exit — adjust your plan in <a href="#/settings" style="color:var(--accent-300)">Settings</a>.</div>`}
    <div style="font-size:11.5px;margin-top:9px;padding:6px 2px 0;border-top:1px solid var(--hairline);display:flex;align-items:center;gap:6px">
      <i class="ph-fill ph-seal-check" style="color:var(--accent-300);font-size:13px"></i>
      <span class="text-muted">Levels set by the <b style="color:var(--text)">${getStrategy().name}</b>${getStrategy().proven ? ' <span style="color:var(--buy)">· proven</span>' : ''}.</span>
      <a href="#/methodology" style="color:var(--accent-300);margin-left:auto;white-space:nowrap">How it works &rsaquo;</a>
    </div>
  </div>`}

  ${userBookPanel(market, verdict, s, planEntry, dispStop, dispTarget)}

  <div class="panel">
    <div class="panel-title">Why this signal</div>
    ${s.reasons.map((r) => `<div class="reason-row"><i class="ph-bold ph-check-circle" style="color:${color}"></i><span>${r}</span></div>`).join('')}
  </div>

  <div id="signal-timeline"></div>

  <div class="countdown-note"><i class="ph ph-arrows-clockwise"></i>Next model update in <span data-f="countdown">${fmtCountdown(market.nextUpdateSec)}</span></div>
  `;
}

function renderBreakdownTab(market, color) {
  const s = market.signal;
  if (!market.signalIsReal) {
    return `<div class="panel"><div class="panel-title">Signal breakdown</div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.6;margin-top:6px">A live-data computation for this market is temporarily unavailable, so there's no real signal to break down right now. When the feed returns, this shows exactly what the mean-reversion engine sees — the fast RSI, the Bollinger stretch, and the trend.</div></div>`;
  }
  const { rsi2, pctB, htfTrend: trend } = s;
  const conv = s.plan && s.plan.conviction === 'high';
  const intraday = s.timeframe !== '1D';

  const factor = (label, tone, text) => {
    const c = tone === 'bull' ? 'var(--buy)' : tone === 'bear' ? 'var(--sell)' : 'var(--text-muted)';
    const icon = tone === 'bull' ? 'ph-arrow-up' : tone === 'bear' ? 'ph-arrow-down' : 'ph-minus';
    return `<div class="reason-row"><i class="ph-bold ${icon}" style="color:${c}"></i><span><b style="color:var(--text)">${label}.</b> ${text}</span></div>`;
  };

  const trendRow = trend === 'up' ? factor('Long-term trend', 'bull', 'Price is above its long-term average — the bigger trend is up.')
    : trend === 'down' ? factor('Long-term trend', 'bear', 'Price is below its long-term average — the bigger trend is down.')
    : factor('Long-term trend', 'neutral', 'No clear longer-term trend.');

  // The board runs two engines. A trend-continuation BUY is NOT an oversold snap, so
  // it must NOT be described (or broken down) as one — that read the rsi2/Bollinger
  // rows and copy that only apply to the mean-reversion engine. Branch on the strat.
  const isTrend = s.strat === 'trend';
  let setupLabel, factorsHtml, footerHtml;
  if (isTrend) {
    setupLabel = conv ? 'High-conviction trend' : 'Trend continuation';
    factorsHtml = factor('Trend structure', 'bull', 'Price is riding above a rising average — an established uptrend, not a counter-move.')
      + factor('Momentum', 'bull', 'Moving with the trend — the entry rides continuation and holds via a trailing stop, not a bounce.')
      + trendRow;
    footerHtml = 'This is a <b style="color:var(--text)">trend-following</b> signal — it rides an <b>established uptrend</b> with momentum and holds via a trailing stop until the trend breaks. It is <b>not</b> a deep-oversold bounce; Ajent runs both engines side by side and shows whichever is set up. Rule-based — no method guarantees a win rate.';
  } else {
    setupLabel = conv ? 'High-conviction setup' : 'Standard setup';
    const rsi2Row = rsi2 == null ? ''
      : rsi2 <= 10 ? factor('Momentum', 'bull', 'Deeply oversold — the counter-move the strategy buys.')
      : rsi2 < 35 ? factor('Momentum', 'neutral', 'Leaning oversold, but not stretched far enough yet.')
      : factor('Momentum', 'neutral', 'Not stretched far enough to trigger a trade.');
    const bbRow = pctB == null ? ''
      : pctB < 0 ? factor('Volatility stretch', 'bull', 'Price has stretched unusually far below its recent range — an extreme (marks the strongest setups).')
      : pctB < 0.25 ? factor('Volatility stretch', 'neutral', 'Below its recent average, not yet at an extreme.')
      : pctB > 0.75 ? factor('Volatility stretch', 'neutral', 'Above its recent average.')
      : factor('Volatility stretch', 'neutral', 'Within its normal range — no extreme.');
    factorsHtml = rsi2Row + bbRow + trendRow;
    footerHtml = `This is a <b style="color:var(--text)">mean-reversion</b> signal — <b>not</b> a multi-indicator confluence score. It buys a market that has stretched deeply oversold within an uptrend; the most extreme stretches mark the strongest setups. A trade fires only once the setup clears your ${state.settings.threshold}% confidence threshold (adjustable in Settings). Rule-based — no method guarantees a win rate.`;
  }

  return `
  <div class="panel">
    <div class="confluence-head">
      <div>
        <div class="panel-title" style="margin-bottom:2px">Signal strength</div>
        <div class="text-muted" style="font-size:12px">${setupLabel} · ${intraday ? '15-minute' : 'daily'}</div>
      </div>
      <div class="confluence-pct" style="color:${color}">${s.confidence}%</div>
    </div>
    <div class="confluence-bar"><span style="width:${s.confidence}%;background:${color}"></span></div>
  </div>

  <div class="section-label">What the engine actually sees</div>
  <div class="panel">${factorsHtml}</div>

  ${caveatsHtml(market, market.verdict(state.settings.threshold))}

  <div class="text-muted" style="font-size:11.5px;line-height:1.6;margin-top:8px;padding:0 4px">
    ${footerHtml}
  </div>`;
}

// Public-facing grouping: collapse the proprietary indicator set into high-level
// factor categories so the exact recipe (which indicators, what weights) is
// never exposed in the UI. Each category's verdict is the weight-weighted lean
// of its members.
const FACTOR_CATEGORIES = [
  { label: 'Trend', names: ['EMA Stack', 'Supertrend', 'ADX', 'Ichimoku'], txt: { bull: 'Uptrend, strengthening', bear: 'Downtrend, strengthening', neutral: 'No clear trend' } },
  { label: 'Momentum', names: ['MACD', 'RSI (14)', 'CCI'], txt: { bull: 'Favoring buyers', bear: 'Favoring sellers', neutral: 'Flat momentum' } },
  { label: 'Market structure', names: ['Market Structure'], txt: { bull: 'Higher highs & higher lows', bear: 'Lower highs & lower lows', neutral: 'Range-bound' } },
  { label: 'Volatility & levels', names: ['Bollinger Bands', 'VWAP'], txt: { bull: 'Expanding in trade’s favor', bear: 'Expanding against trade', neutral: 'Contained near fair value' } },
  { label: 'Volume', names: ['Volume'], txt: { bull: 'Confirming buyers', bear: 'Confirming sellers', neutral: 'Neutral volume flow' } },
  { label: 'Catalyst / news', names: ['News Sentiment'], txt: { bull: 'Headlines lean supportive', bear: 'Headlines lean negative', neutral: 'No major catalyst' } },
];

function categoryRows(indicators) {
  const byName = {};
  for (const i of indicators) byName[i.name] = i;
  return FACTOR_CATEGORIES.map((cat) => {
    let bw = 0, brw = 0;
    for (const nm of cat.names) {
      const ind = byName[nm];
      if (!ind) continue;
      if (ind.state === 'bull') bw += ind.weight;
      else if (ind.state === 'bear') brw += ind.weight;
    }
    const s = bw > brw ? 'bull' : brw > bw ? 'bear' : 'neutral';
    return indicatorRow({ name: cat.label, state: s, detail: cat.txt[s] });
  }).join('');
}

function renderChartTab(market, color, verdict) {
  const s = market.signal;
  const hasSetup = verdict !== 'NO_TRADE';
  // Key levels use the same honest plan as the Signal tab: user's stop + reward:risk
  // reference target, and the real RSI2 exit — no invented Target 2/3.
  const clvLong = verdict !== 'SELL';
  const clvCfg = planConfigFor();
  const clvStop = s.plan ? planStopPrice(s.plan.entry, s.plan.stop, clvLong, clvCfg) : 0;
  const clvTarget = s.plan ? planTargetPrice(s.plan.entry, clvStop, clvLong, clvCfg) : 0;
  const clvRr = (Number(clvCfg.rr) || 1).toFixed(clvCfg.rr % 1 ? 1 : 0);
  if (!activeRange) activeRange = RANGES[state.settings.chartRange] ? state.settings.chartRange : '1D';
  const ySym = YAHOO_SYMBOL[market.symbol];
  if (ySym) queueMicrotask(() => loadCandles(market.symbol, ySym, activeRange));
  return `
  <div class="chart-box">
    <div class="chart-box-head">
      <div style="font:600 13px var(--font-heading)">${market.symbol} price</div>
      <div style="display:flex;align-items:center;gap:6px">
        ${chartTypeToggleHtml()}
        <div style="display:flex;gap:3px;background:var(--neutral-900);border-radius:8px;padding:3px">
          ${Object.keys(RANGES).map((k) => `<button class="chart-range-btn" data-range="${k}" style="border:none;cursor:pointer;font:600 12px var(--font-heading);padding:5px 13px;border-radius:6px;background:${k === activeRange ? 'var(--accent-800)' : 'transparent'};color:${k === activeRange ? 'var(--accent-100)' : 'var(--text-muted)'}">${RANGES[k].label}</button>`).join('')}
        </div>
        <button data-nav="#/chart/${market.symbol}" title="Full-screen chart" style="border:none;cursor:pointer;background:var(--neutral-900);border-radius:8px;width:32px;height:32px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;flex:none"><i class="ph-bold ph-arrows-out"></i></button>
      </div>
    </div>
    <div id="chart-canvas">${chartCanvasHtml(market.symbol, activeRange)}</div>
    ${getClosedTrades().some((c) => c.symbol === market.symbol) || getOpenPositions().some((p) => p.symbol === market.symbol) ? `
    <div class="overlay-tags" style="margin-top:8px">
      <span class="overlay-tag"><span class="dot" style="background:var(--buy)"></span>Buy</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--sell)"></span>Sell</span>
      <span class="overlay-tag"><span class="dot" style="background:transparent;border:2px solid var(--buy);border-radius:50%"></span>Exit (win)</span>
      <span class="overlay-tag"><span class="dot" style="background:transparent;border:2px solid var(--sell);border-radius:50%"></span>Exit (loss)</span>
    </div>` : ''}
    ${hasSetup ? `
    <div class="overlay-tags" style="margin-top:8px">
      <span class="overlay-tag"><span class="dot" style="background:var(--accent)"></span>Entry</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--buy)"></span>Target</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--sell)"></span>Stop</span>
    </div>` : ''}
  </div>

  ${hasSetup ? `
  <div class="panel">
    <div class="panel-title">Key levels</div>
    <div class="level-row"><span class="text-muted">Reference target · ${clvRr}:1</span><span style="color:var(--buy);font-weight:600" class="tabular">${fmtPrice(clvTarget, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Entry</span><span style="font-weight:600" class="tabular">${fmtPrice(s.plan.entry, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Stop loss</span><span style="color:var(--sell);font-weight:600" class="tabular">${fmtPrice(clvStop, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Exit trigger</span><span style="color:var(--buy);font-weight:600" class="tabular">${s.strat === 'trend' ? 'Trailing stop' : 'Reverts to the mean'}</span></div>
  </div>` : `
  <div class="panel">
    <div class="panel-title">Key levels</div>
    <div class="text-muted" style="font-size:12.5px;line-height:1.6;padding:6px 2px">No active setup — entry, stop and target levels appear once a BUY signal fires. The strategy is long-only: it buys deeply oversold dips and rides established uptrends, and stands aside otherwise.</div>
  </div>`}`;
}

function tabContentHtml(market, verdict, color, tab) {
  return tab === 'breakdown' ? renderBreakdownTab(market, color)
    : tab === 'chart' ? renderChartTab(market, color, verdict)
    : renderSignalTab(market, verdict, color);
}

export function render(container) {
  const market = state.engine.get(state.selectedSymbol);
  if (!market) { location.hash = '#/home'; return; }
  const verdict = market.verdict(state.settings.threshold);
  const color = verdictColorVar(verdict);
  const tab = state.detailTab;

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <div class="detail-header">
      <button class="back-btn" data-back aria-label="Go back"><i class="ph-bold ph-arrow-left"></i></button>
      <div class="detail-title-block">
        <div class="detail-title">${market.symbol} · ${market.name}</div>
        <div class="detail-sub" id="signal-detail-sub">${countryFlag(market.country)} ${market.exchange} · ${market.signal.timeframe} · ${dataTag(market)}</div>
      </div>
      <button class="star-btn" id="fav-btn" title="${isInWatchlist(market.symbol) ? 'In your watchlist' : 'Add to watchlist'}"><i class="${isInWatchlist(market.symbol) ? 'ph-fill' : 'ph'} ph-star"></i></button>
    </div>

    <div class="segmented">
      <button class="seg-btn ${tab === 'signal' ? 'active' : ''}" data-tab="signal">Signal</button>
      <button class="seg-btn ${tab === 'breakdown' ? 'active' : ''}" data-tab="breakdown">Breakdown</button>
      <button class="seg-btn ${tab === 'chart' ? 'active' : ''}" data-tab="chart">Chart</button>
    </div>

    <div id="signal-tab-content">${tabContentHtml(market, verdict, color, tab)}</div>
  </div>`;

  container.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = `#/signal/${market.symbol}/${btn.dataset.tab}`; });
  });
  document.getElementById('fav-btn').addEventListener('click', () => {
    toggleWatchlist(market.symbol);
    render(container);
  });
  if (tab === 'chart') wireChartRange(container, market, verdict, color);
  if (tab === 'signal') loadTimeline(container, market.symbol);
  // "Trade it your way" — DELEGATED on the container (once) so it survives the live
  // poll's tab rebuild. Reads the market + form values fresh at click time.
  if (!container.dataset.ubWired) {
    container.dataset.ubWired = '1';
    container.addEventListener('click', (e) => {
      const add = e.target.closest('[data-ub-add]');
      const close = e.target.closest('[data-ub-close]');
      if (!add && !close) return;
      const m = state.engine.get(state.selectedSymbol);
      if (!m) return;
      if (add) {
        const body = add.closest('.ub-form-body');
        const num = (k) => parseFloat(body && body.querySelector(`[data-ub="${k}"]`)?.value);
        const v = m.verdict(state.settings.threshold);
        const p = m.signal && m.signal.plan;
        const ajPlan = p && p.entry > 0 ? { entry: p.entry, stop: p.stop, target: p.target1 } : null;
        const ok = openUserTrade({ symbol: add.dataset.ubAdd, name: m.name, side: v === 'SELL' ? 'SHORT' : 'LONG', entry: num('entry'), stop: num('stop'), target: num('target'), riskDollars: num('risk'), decimals: m.decimals, ajPlan });
        if (ok) render(container);
      } else {
        closeUserTrade(close.dataset.ubClose, m.price, 'manual');
        render(container);
      }
    });
  }
}

export function refresh(container) {
  const wrap = container.querySelector('#signal-tab-content');
  if (!wrap) return;
  const market = state.engine.get(state.selectedSymbol);
  if (!market) return;
  const verdict = market.verdict(state.settings.threshold);
  const color = verdictColorVar(verdict);
  const tab = state.detailTab;

  const subEl = container.querySelector('#signal-detail-sub');
  if (subEl) {
    const subHtml = `${countryFlag(market.country)} ${market.exchange} · ${market.signal.timeframe} · ${dataTag(market)}`;
    if (subEl.innerHTML !== subHtml) subEl.innerHTML = subHtml;
  }

  // The chart tab holds historical candles and interactive range tabs — don't
  // rebuild it on every tick (that would wipe the selection and re-fetch).
  if (tab === 'chart') return;

  // Only rebuild the tab (which re-creates the confidence ring and would make
  // it flicker/re-animate) when the signal genuinely changes. Between real
  // recomputes, just patch the live countdown — everything else is static.
  const sig = market.signal;
  const key = `${verdict}|${sig.createdAt || 0}|${tab}`;
  if (wrap.dataset.sigKey === key) {
    const cd = wrap.querySelector('[data-f="countdown"]');
    if (cd) cd.textContent = fmtCountdown(market.nextUpdateSec);
    return;
  }
  wrap.dataset.sigKey = key;
  wrap.innerHTML = tabContentHtml(market, verdict, color, tab);
}
