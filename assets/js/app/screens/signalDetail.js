import { state, saveSettings } from '../state.js';
import { fmtPrice, fmtCountdown, verdictColorVar, countryFlag } from '../format.js';
import { confidenceRing, verdictIcon, indicatorRow, planRow, dataTag } from '../components.js';
import { YAHOO_SYMBOL } from '../liveData.js';
import { fetchCandles } from '../candles.js';

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
  fetchCandles(ySym, { interval, range, minCandles: 8 })
    .then((candles) => candleCache.set(key, { candles, ts: Date.now() }))
    .catch(() => candleCache.set(key, { candles: null, ts: Date.now(), failed: true }))
    .finally(() => {
      inflight.delete(key);
      // Patch the chart in place if the user is still looking at it.
      if (state.selectedSymbol === symbol && state.detailTab === 'chart' && activeRange === rangeKey) {
        const el = document.getElementById('chart-canvas');
        if (el) el.innerHTML = chartCanvasHtml(symbol, rangeKey);
      }
    });
}

function areaChart(market, candles, color, showLevels) {
  const w = 500, h = 172;
  const closes = candles.map((c) => c.c);
  const s = market.signal;
  let vals = [...closes];
  if (showLevels) vals = vals.concat([s.plan.stop, s.plan.target1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const pad = span * 0.1;
  const lo = min - pad, hi = max + pad;
  const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
  const step = w / (closes.length - 1);
  const lineD = 'M' + closes.map((p, i) => `${(i * step).toFixed(1)},${yFor(p).toFixed(1)}`).join(' L');
  const areaD = `${lineD} L${w},${h} L0,${h} Z`;
  const level = (v, stroke) => `<line x1="0" y1="${yFor(v).toFixed(1)}" x2="${w}" y2="${yFor(v).toFixed(1)}" stroke="${stroke}" stroke-width="1" stroke-dasharray="4 4" opacity="0.75"/>`;
  return `
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <defs><linearGradient id="acFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${showLevels ? level(s.plan.stop, 'var(--sell)') + level(s.plan.entry, 'var(--accent)') + level(s.plan.target1, 'var(--buy)') : ''}
    <path d="${areaD}" fill="url(#acFill)"/>
    <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function chartCanvasHtml(symbol, rangeKey) {
  const market = state.engine.get(symbol);
  if (!market) return '';
  const color = verdictColorVar(market.verdict(state.settings.threshold));
  const ySym = YAHOO_SYMBOL[symbol];
  if (!ySym) {
    return `${chartSvg(market, color)}<div class="text-muted" style="font-size:11px;margin-top:6px;text-align:center">Historical chart isn't available for this market.</div>`;
  }
  const cached = candleCache.get(`${symbol}|${rangeKey}`);
  const showLevels = rangeKey === '1D';
  if (cached && cached.candles && cached.candles.length > 1) {
    const closes = cached.candles.map((c) => c.c);
    const first = closes[0], last = closes[closes.length - 1];
    const chgPct = ((last - first) / first) * 100;
    const chgColor = chgPct >= 0 ? 'var(--buy)' : 'var(--sell)';
    return `
      ${areaChart(market, cached.candles, color, showLevels)}
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:6px">
        <span class="text-muted">${cached.candles.length} candles · ${RANGES[rangeKey].label}</span>
        <span style="color:${chgColor}">${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}% over ${RANGES[rangeKey].label}</span>
      </div>`;
  }
  if (cached && cached.failed) {
    return `${chartSvg(market, color)}<div class="text-muted" style="font-size:11px;margin-top:6px;text-align:center">Live ${RANGES[rangeKey].label} history is unavailable right now — showing recent price action.</div>`;
  }
  return `<div style="height:172px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12.5px"><i class="ph ph-hourglass-medium" style="font-size:18px;margin-right:8px"></i>Loading ${RANGES[rangeKey].label} chart…</div>`;
}

function wireChartRange(container, market, verdict, color) {
  container.querySelectorAll('.chart-range-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeRange = btn.dataset.range;
      state.settings.chartRange = activeRange;
      saveSettings();
      const wrap = container.querySelector('#signal-tab-content');
      if (wrap) {
        wrap.innerHTML = renderChartTab(market, color);
        wireChartRange(container, market, verdict, color);
      }
    });
  });
}

function chartSvg(market, color) {
  const w = 500, h = 160;
  const pts = market.history.slice(-40);
  const s = market.signal;
  const allVals = [...pts, s.plan.stop, s.plan.target1];
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = (max - min) || 1;
  const pad = range * 0.12;
  const lo = min - pad, hi = max + pad;
  const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
  const step = w / (pts.length - 1);
  const linePts = pts.map((p, i) => `${(i * step).toFixed(1)},${yFor(p).toFixed(1)}`);
  const lineD = 'M' + linePts.join(' L');
  const areaD = `${lineD} L${w},${h} L0,${h} Z`;

  function levelLine(v, stroke) {
    const y = yFor(v).toFixed(1);
    return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${stroke}" stroke-width="1" stroke-dasharray="4 4" opacity="0.8"/>`;
  }

  return `
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${levelLine(s.plan.stop, 'var(--sell)')}
    ${levelLine(s.plan.entry, 'var(--accent)')}
    ${levelLine(s.plan.target1, 'var(--buy)')}
    <path d="${areaD}" fill="url(#areaFill)"/>
    <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function renderSignalTab(market, verdict, color) {
  const s = market.signal;
  const subline = verdict === 'NO_TRADE' ? 'Waiting for a high-probability setup' : (verdict === 'BUY' ? 'Long setup confirmed' : 'Short setup confirmed');
  return `
  <div class="verdict-frame" style="border-color:${color}">
    <div class="verdict-big" style="color:${color}">${verdictIcon(verdict)}${verdict === 'NO_TRADE' ? 'NO TRADE' : verdict}</div>
    <div class="verdict-sub">${subline}</div>
    ${confidenceRing(s.confidence, color)}
  </div>

  <div class="stat3-row">
    <div class="stat3-cell"><div class="k">Trend</div><div class="v" style="color:${s.trend === 'Bullish' ? 'var(--buy)' : s.trend === 'Bearish' ? 'var(--sell)' : 'var(--flat)'}">${s.trend}</div></div>
    <div class="stat3-cell"><div class="k">Volatility</div><div class="v">${s.volatility}</div></div>
    <div class="stat3-cell"><div class="k">Hold</div><div class="v">${s.expectedHold}</div></div>
  </div>

  <div class="panel">
    <div class="panel-title">Trade plan</div>
    ${planRow('Suggested entry', fmtPrice(s.plan.entry, market.decimals), 'var(--accent)')}
    ${planRow('Stop loss', fmtPrice(s.plan.stop, market.decimals), 'var(--sell)')}
    ${planRow('Trailing stop', `${s.plan.trailingStopPts.toFixed(2)} pts`, 'var(--neutral-500)')}
    ${planRow('Target 1', fmtPrice(s.plan.target1, market.decimals), 'var(--buy)')}
    ${planRow('Target 2', fmtPrice(s.plan.target2, market.decimals), 'var(--buy)')}
    ${planRow('Target 3', fmtPrice(s.plan.target3, market.decimals), 'var(--buy)')}
    ${planRow('Risk : Reward', `${s.plan.riskReward.toFixed(1)}:1`, 'var(--accent-200)')}
    ${planRow('Timeframe', s.timeframe, 'var(--neutral-500)')}
  </div>

  <div class="panel">
    <div class="panel-title">Why this signal</div>
    ${s.reasons.map((r) => `<div class="reason-row"><i class="ph-bold ph-check-circle" style="color:${color}"></i><span>${r}</span></div>`).join('')}
  </div>

  <div class="countdown-note"><i class="ph ph-arrows-clockwise"></i>Next model update in ${fmtCountdown(market.nextUpdateSec)}</div>
  `;
}

function renderBreakdownTab(market, color) {
  const { bull, bear, neutral } = market.signal.confluence;
  const total = bull + bear + neutral;
  const pct = market.signal.confidence;
  return `
  <div class="panel">
    <div class="confluence-head">
      <div>
        <div class="panel-title" style="margin-bottom:2px">Confluence score</div>
        <div class="text-muted" style="font-size:12px">${bull} bullish · ${bear} bearish · ${neutral} neutral</div>
      </div>
      <div class="confluence-pct" style="color:${color}">${pct}%</div>
    </div>
    <div class="confluence-bar">
      <span style="width:${(bull / total) * 100}%;background:var(--buy)"></span>
      <span style="width:${(neutral / total) * 100}%;background:var(--neutral-700)"></span>
      <span style="width:${(bear / total) * 100}%;background:var(--sell)"></span>
    </div>
  </div>

  <div class="section-label">Indicators · weighted</div>
  ${market.signal.indicators.map((ind) => indicatorRow(ind)).join('')}

  <div class="text-muted" style="font-size:11.5px;line-height:1.6;margin-top:8px;padding:0 4px">
    A BUY/SELL only fires once the weighted score clears your confidence threshold (currently ${state.settings.threshold}%, adjustable in Settings).
    ${market.signalIsReal
      ? 'These indicators are computed from real 5-minute price candles over the trailing 5 days, plus a keyword scan of recent real headlines (no insider or non-public information). This is a fixed rule-based weighting, not a statistically calibrated probability — no indicator combination guarantees a given win rate.'
      : 'A real-data computation for this market is temporarily unavailable, so this breakdown is a simulated placeholder — not based on current price action.'}
  </div>`;
}

function renderChartTab(market, color) {
  const s = market.signal;
  if (!activeRange) activeRange = RANGES[state.settings.chartRange] ? state.settings.chartRange : '1D';
  const ySym = YAHOO_SYMBOL[market.symbol];
  if (ySym) queueMicrotask(() => loadCandles(market.symbol, ySym, activeRange));
  return `
  <div class="chart-box">
    <div class="chart-box-head">
      <div style="font:600 13px var(--font-heading)">${market.symbol} price</div>
      <div style="display:flex;gap:3px;background:var(--neutral-900);border-radius:8px;padding:3px">
        ${Object.keys(RANGES).map((k) => `<button class="chart-range-btn" data-range="${k}" style="border:none;cursor:pointer;font:600 12px var(--font-heading);padding:5px 13px;border-radius:6px;background:${k === activeRange ? 'var(--accent-800)' : 'transparent'};color:${k === activeRange ? 'var(--accent-100)' : 'var(--text-muted)'}">${RANGES[k].label}</button>`).join('')}
      </div>
    </div>
    <div id="chart-canvas">${chartCanvasHtml(market.symbol, activeRange)}</div>
    <div class="overlay-tags" style="margin-top:8px">
      <span class="overlay-tag"><span class="dot" style="background:var(--accent)"></span>Entry</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--buy)"></span>Target</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--sell)"></span>Stop</span>
      <span class="overlay-tag text-muted">Levels shown on 1D</span>
    </div>
  </div>

  <div class="panel">
    <div class="panel-title">Key levels</div>
    <div class="level-row"><span class="text-muted">Target 3</span><span style="color:var(--buy);font-weight:600" class="tabular">${fmtPrice(s.plan.target3, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Target 2</span><span style="color:var(--buy);font-weight:600" class="tabular">${fmtPrice(s.plan.target2, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Target 1</span><span style="color:var(--buy);font-weight:600" class="tabular">${fmtPrice(s.plan.target1, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Entry</span><span style="font-weight:600" class="tabular">${fmtPrice(s.plan.entry, market.decimals)}</span></div>
    <div class="level-row"><span class="text-muted">Stop loss</span><span style="color:var(--sell);font-weight:600" class="tabular">${fmtPrice(s.plan.stop, market.decimals)}</span></div>
  </div>`;
}

function tabContentHtml(market, verdict, color, tab) {
  return tab === 'breakdown' ? renderBreakdownTab(market, color)
    : tab === 'chart' ? renderChartTab(market, color)
    : renderSignalTab(market, verdict, color);
}

export function render(container) {
  const market = state.engine.get(state.selectedSymbol);
  if (!market) { location.hash = '#/home'; return; }
  const verdict = market.verdict(state.settings.threshold);
  const color = verdictColorVar(verdict);
  const tab = state.detailTab;

  container.innerHTML = `
  <div class="fade-in">
    <div class="detail-header">
      <button class="back-btn" data-back><i class="ph-bold ph-arrow-left"></i></button>
      <div class="detail-title-block">
        <div class="detail-title">${market.symbol} · ${market.name}</div>
        <div class="detail-sub" id="signal-detail-sub">${countryFlag(market.country)} ${market.exchange} · ${market.signal.timeframe} · ${dataTag(market)}</div>
      </div>
      <button class="star-btn" id="fav-btn"><i class="${market.favorite ? 'ph-fill' : 'ph'} ph-star"></i></button>
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
    market.favorite = !market.favorite;
    render(container);
  });
  if (tab === 'chart') wireChartRange(container, market, verdict, color);
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
  if (subEl) subEl.innerHTML = `${countryFlag(market.country)} ${market.exchange} · ${market.signal.timeframe} · ${dataTag(market)}`;

  // The chart tab holds historical candles and interactive range tabs — don't
  // rebuild it on every tick (that would wipe the selection and re-fetch).
  if (tab === 'chart') return;

  wrap.innerHTML = tabContentHtml(market, verdict, color, tab);
}
