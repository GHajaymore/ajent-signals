import { state } from '../state.js';
import { fmtPrice, fmtCountdown, verdictColorVar, countryFlag } from '../format.js';
import { confidenceRing, verdictIcon, indicatorRow, planRow, dataTag } from '../components.js';

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
    A BUY/SELL only fires once the weighted score clears your confidence threshold (currently ${state.settings.threshold}%, adjustable in Settings). Weights adapt from historical performance without overfitting to any single indicator.
  </div>`;
}

function renderChartTab(market, color) {
  const s = market.signal;
  return `
  <div class="chart-box">
    <div class="chart-box-head">
      <div style="font:600 13px var(--font-heading)">${market.symbol} · ${s.timeframe}</div>
      <span class="chip" style="background:var(--accent-800);color:var(--accent-100)">Overlays</span>
    </div>
    ${chartSvg(market, color)}
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:6px">
      <span style="color:var(--sell)">Stop ${fmtPrice(s.plan.stop, market.decimals)}</span>
      <span class="text-muted">Entry ${fmtPrice(s.plan.entry, market.decimals)}</span>
      <span style="color:var(--buy)">T1 ${fmtPrice(s.plan.target1, market.decimals)}</span>
    </div>
    <div class="overlay-tags">
      <span class="overlay-tag"><span class="dot" style="background:var(--accent-300)"></span>EMA 20/50</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--accent-300)"></span>VWAP</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--buy)"></span>Targets</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--sell)"></span>Stop</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--flat)"></span>S/R</span>
      <span class="overlay-tag"><span class="dot" style="background:var(--neutral-500)"></span>FVG</span>
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

  wrap.innerHTML = tabContentHtml(market, verdict, color, tab);
}
