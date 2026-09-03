import { fmtPrice, fmtPct, verdictColorVar, verdictChipClass, stateColorVar, countryFlag } from './format.js';
import { isInWatchlist } from './state.js';
import { marketSession } from './marketHours.js';
import { getOpenPositions } from './paperTrading.js';

// Star toggle for a market row — filled when the market is in the watchlist.
// The click is handled by a delegated listener (see markets.js) which stops it
// from bubbling to the row's navigation.
function starToggle(symbol) {
  const on = isInWatchlist(symbol);
  return `<button class="mkt-star ${on ? 'on' : ''}" data-star="${symbol}" title="${on ? 'In watchlist — tap to remove' : 'Add to watchlist'}"><i class="${on ? 'ph-fill' : 'ph'} ph-star"></i></button>`;
}

// Catmull-Rom smoothing shared by the sparkline (kept tiny/local).
function sparkSmooth(pts) {
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

export function sparklineSvg(history, color, w = 56, h = 28) {
  const series = history.slice(-24);
  if (series.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min || 1;
  const padY = 3.5; // keep the smoothed curve from clipping at the edges
  const yFor = (v) => padY + (h - 2 * padY) - ((v - min) / range) * (h - 2 * padY);
  const step = w / (series.length - 1);
  const pts = series.map((p, i) => [i * step, yFor(p)]);
  const d = sparkSmooth(pts);
  const uid = 's' + Math.random().toString(36).slice(2, 6);
  const last = pts[pts.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible;display:block">
    <defs><linearGradient id="sp${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.25"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#sp${uid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.7" fill="${color}"/>
  </svg>`;
}

export function confidenceRing(confidence, color, size = 132, r = 52) {
  const c = 2 * Math.PI * r;
  const offset = c * (1 - confidence / 100);
  const cx = size / 2;
  return `
  <div class="ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--neutral-900)" stroke-width="11"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
        style="transition:stroke-dashoffset .6s ease"/>
    </svg>
    <div class="ring-center">
      <div class="ring-num" style="color:${color}">${confidence}</div>
      <div class="ring-label">Confidence</div>
    </div>
  </div>`;
}

export function symTile(symbol, size = 42) {
  const base = size <= 36 ? 11 : 13;
  const shrink = symbol.length >= 6 ? 4 : symbol.length === 5 ? 2.5 : symbol.length === 4 ? 1.5 : 0;
  const fontSize = Math.max(7, base - shrink);
  const tracking = symbol.length >= 5 ? '-0.03em' : 'normal';
  return `<div class="sym-tile" style="width:${size}px;height:${size}px;font-size:${fontSize}px;letter-spacing:${tracking};overflow:hidden">${symbol}</div>`;
}

export function verdictChip(verdict) {
  const label = verdict === 'NO_TRADE' ? 'NO TRADE' : verdict;
  return `<span class="${verdictChipClass(verdict)}">${label}</span>`;
}

export function verdictIcon(verdict) {
  if (verdict === 'BUY') return '<i class="ph-fill ph-arrow-up-right"></i>';
  if (verdict === 'SELL') return '<i class="ph-fill ph-arrow-down-right"></i>';
  return '<i class="ph-bold ph-minus"></i>';
}

// Reflects whether THIS signal is real (indicators computed from real 1h/5d
// candles) vs. the simulator fallback — the more important trust signal than
// price alone, since price is now live for nearly every symbol regardless.
export function dataTag(market) {
  const closed = marketSession(market) === 'closed'
    ? ' <span class="data-tag closed" title="Exchange is closed — price is the last traded value and won\'t move until it reopens">CLOSED</span>'
    : '';
  return (market.signalIsReal
    ? '<span class="data-tag live" title="Indicators computed from real price history">REAL</span>'
    : '<span class="data-tag sim" title="No live data for this market right now — it is hidden until a real feed returns">NO DATA</span>') + closed;
}

// Live-status pill. Session (open/closed) is CLOCK-based, so it's correct the
// instant the app opens — e.g. "Market open" the moment US equities open at 9:30
// ET, without waiting for a quote. Freshness (live vs delayed vs connecting) is
// then layered on from the real feed.
export function liveTag(market) {
  const dot = (on) => `<span class="live-dot${on ? '' : ' off'}"></span>`;
  const sess = marketSession(market);
  const age = market.quoteAgeSec;
  const live = market.isLiveFresh;
  const delayed = live && age != null && age > 180;
  const mins = age != null ? Math.max(1, Math.round(age / 60)) : 0;
  // The delayed future's near-real-time price is estimated from its tracking ETF.
  const px = market.proxySource ? ` · ~real-time via ${market.proxySource}` : '';

  if (sess === 'closed') return `${dot(false)}Market closed`;
  if (sess === 'open') {
    if (delayed) return `${dot(false)}Market open · delayed ~${mins}m`;
    if (live) return `${dot(true)}Market open${px}`;
    return `${dot(false)}Market open · connecting…`;
  }
  // Untracked exchange (unknown session) — fall back to raw feed freshness.
  if (delayed) return `${dot(false)}Delayed ~${mins}m`;
  if (live) return `${dot(true)}${market.proxySource ? `~Real-time via ${market.proxySource}` : 'Live'}`;
  return `${dot(false)}No live data`;
}

export function heroCard(market, verdict) {
  const color = verdictColorVar(verdict);
  const s = market.signal;
  const subline = verdict === 'NO_TRADE'
    ? 'Waiting for a high-probability setup'
    : (verdict === 'BUY' ? 'Long setup confirmed' : 'Short setup confirmed');
  // If the paper account already holds this market, say so — otherwise the hero's
  // fresh signal entry looks like it conflicts with the (earlier) position entry.
  const pos = getOpenPositions().find((p) => p.symbol === market.symbol);
  const posLong = pos && (pos.side || 'LONG') === 'LONG';
  const posLine = pos ? `
      <div class="hero-inposition" style="display:flex;align-items:center;gap:7px;margin-top:10px;font-size:12px;font-weight:600;color:${posLong ? 'var(--buy)' : 'var(--sell)'};background:${posLong ? 'var(--buy-dim)' : 'var(--sell-dim)'};padding:7px 11px;border-radius:8px">
        <i class="ph-fill ph-check-circle"></i><span>You're already in this trade — ${posLong ? 'long' : 'short'} from ${fmtPrice(pos.entry, market.decimals)}. The levels above are the current signal.</span>
      </div>` : '';
  return `
  <div class="hero-card" data-nav="#/signal/${market.symbol}" data-sym="${market.symbol}" data-verdict="${verdict}" data-createdat="${s.createdAt || 0}" data-pos="${pos ? (posLong ? 'L' : 'S') : ''}" style="--vc:${color}">
    <div class="hero-inner">
      <div class="hero-eyebrow"><i class="ph-fill ph-chart-bar"></i>Top signal</div>
      <div class="hero-top">
        <div class="hero-symbol">
          ${symTile(market.symbol)}
          <div>
            <div class="sym-name">${market.name}</div>
            <div class="sym-sub">${countryFlag(market.country)} ${market.exchange} · ${market.signal.timeframe} · ${dataTag(market)}</div>
          </div>
        </div>
        <div class="hero-price">
          <div class="px tabular" data-f="price">${fmtPrice(market.price, market.decimals)}</div>
          <div class="chg tabular" data-f="chg" style="color:${market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)'}">${fmtPct(market.changePct)}</div>
        </div>
      </div>
      <div class="hero-verdict-row">
        <div class="hero-verdict" style="color:${color}">${verdictIcon(verdict)}${verdict === 'NO_TRADE' ? 'NO TRADE' : verdict}</div>
        <div class="hero-conf">
          <div class="hero-conf-top"><span class="text-muted">Confidence</span><span style="font-weight:600;color:${color}">${s.confidence}%</span></div>
          <div class="hero-conf-bar-track"><div class="hero-conf-bar-fill" style="width:${s.confidence}%;background:${color}"></div></div>
        </div>
      </div>
      <div class="hero-subline"><span data-f="subline">${s.trend} · ${s.volatility} volatility</span> · <span class="hero-live" data-f="live">${liveTag(market)}</span></div>
      ${verdict === 'NO_TRADE' ? `
      <div class="hero-no-setup">No active setup — entry, stop &amp; target appear once a signal fires.</div>` : `
      <div class="hero-quad">
        <div class="hero-quad-cell"><div class="k">Entry</div><div class="v tabular">${fmtPrice(s.plan.entry, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">Stop</div><div class="v tabular" style="color:var(--sell)">${fmtPrice(s.plan.stop, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">Target</div><div class="v tabular" style="color:var(--buy)">${fmtPrice(s.plan.target1, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">R : R</div><div class="v tabular" style="color:var(--accent-200)">${s.plan.riskReward.toFixed(1)} : 1</div></div>
      </div>`}
      ${posLine}
    </div>
  </div>`;
}

export function watchlistRow(market, verdict) {
  const chgColor = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `
  <div class="wl-row" data-nav="#/signal/${market.symbol}" data-sym="${market.symbol}" data-verdict="${verdict}" data-real="${market.signalIsReal ? '1' : '0'}">
    ${symTile(market.symbol, 36)}
    <div class="wl-name-block">
      <div class="wl-name">${market.name} <span data-f="tag">${dataTag(market)}</span></div>
      <div class="wl-price tabular" data-f="price">${fmtPrice(market.price, market.decimals)}</div>
    </div>
    <div class="wl-spark" data-f="spark">${sparklineSvg(market.history, chgColor)}</div>
    <div class="wl-chg tabular" data-f="chg" style="color:${chgColor}">${fmtPct(market.changePct)}</div>
    <div class="wl-verdict" data-f="verdict">${verdictChip(verdict)}</div>
  </div>`;
}

export function marketRow(market, verdict) {
  const chgColor = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `
  <div class="mkt-row" data-nav="#/signal/${market.symbol}" data-sym="${market.symbol}" data-verdict="${verdict}" data-real="${market.signalIsReal ? '1' : '0'}">
    ${symTile(market.symbol, 36)}
    <div class="mkt-body">
      <div class="mkt-name">${market.name}</div>
      <div class="mkt-ex">${countryFlag(market.country)} ${market.exchange} · <span data-f="tag">${dataTag(market)}</span></div>
    </div>
    <div class="mkt-price">
      <div class="px tabular" data-f="price">${fmtPrice(market.price, market.decimals)}</div>
      <div class="chg tabular" data-f="chg" style="color:${chgColor}">${fmtPct(market.changePct)}</div>
    </div>
    <span class="mkt-verdict" data-f="verdict">${verdictChip(verdict)}</span>
    ${starToggle(market.symbol)}
  </div>`;
}

// Briefly flash a price cell green/red when it ticks, so a live update is
// visible even when the number barely moves. The reflow (offsetWidth) restarts
// the CSS animation if it's already mid-flash.
function flashPrice(px, oldText, newText) {
  const o = parseFloat(String(oldText).replace(/,/g, ''));
  const n = parseFloat(String(newText).replace(/,/g, ''));
  if (!Number.isFinite(o) || !Number.isFinite(n) || o === n) return;
  px.classList.remove('flash-up', 'flash-down');
  void px.offsetWidth;
  px.classList.add(n > o ? 'flash-up' : 'flash-down');
}

// Patch the hero card's volatile fields (price/change/subline) in place.
// Returns false when the signal itself changed (new verdict or recompute), so
// the caller knows to rebuild the whole card; true when patched cleanly.
export function patchHero(el, market, verdict) {
  const s = market.signal;
  const pos = getOpenPositions().find((p) => p.symbol === market.symbol);
  const posTag = pos ? ((pos.side || 'LONG') === 'LONG' ? 'L' : 'S') : '';
  if (el.dataset.verdict !== verdict || String(s.createdAt || 0) !== el.dataset.createdat || el.dataset.sym !== market.symbol || (el.dataset.pos || '') !== posTag) {
    return false;
  }
  const priceStr = fmtPrice(market.price, market.decimals);
  const px = el.querySelector('[data-f="price"]');
  if (px && px.textContent !== priceStr) { flashPrice(px, px.textContent, priceStr); px.textContent = priceStr; }
  const chg = el.querySelector('[data-f="chg"]');
  if (chg) {
    const t = fmtPct(market.changePct);
    if (chg.textContent !== t) chg.textContent = t;
    chg.style.color = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  }
  const sub = el.querySelector('[data-f="subline"]');
  if (sub) {
    const t = `${s.trend} · ${s.volatility} volatility`;
    if (sub.textContent !== t) sub.textContent = t;
  }
  const live = el.querySelector('[data-f="live"]');
  if (live) live.innerHTML = liveTag(market);
  return true;
}

// In-place patch of a market/watchlist row — updates only the values that
// actually changed, so the DOM never rebuilds and nothing flickers.
export function patchRow(el, market, verdict) {
  const chgColor = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  const priceStr = fmtPrice(market.price, market.decimals);
  const px = el.querySelector('[data-f="price"]');
  if (px && px.textContent !== priceStr) { flashPrice(px, px.textContent, priceStr); px.textContent = priceStr; }
  const chgStr = fmtPct(market.changePct);
  const chg = el.querySelector('[data-f="chg"]');
  if (chg) { if (chg.textContent !== chgStr) chg.textContent = chgStr; chg.style.color = chgColor; }
  if (el.dataset.verdict !== verdict) {
    const v = el.querySelector('[data-f="verdict"]');
    if (v) v.innerHTML = verdictChip(verdict);
    el.dataset.verdict = verdict;
  }
  const realStr = market.signalIsReal ? '1' : '0';
  if (el.dataset.real !== realStr) {
    const tag = el.querySelector('[data-f="tag"]');
    if (tag) tag.innerHTML = dataTag(market);
    const spark = el.querySelector('[data-f="spark"]');
    if (spark) spark.innerHTML = sparklineSvg(market.history, chgColor);
    el.dataset.real = realStr;
  }
}

export function indicatorRow(ind) {
  const color = stateColorVar(ind.state);
  const dim = ind.state === 'bull' ? 'var(--buy-dim)' : ind.state === 'bear' ? 'var(--sell-dim)' : 'var(--neutral-900)';
  const icon = ind.state === 'bull' ? 'ph-trend-up' : ind.state === 'bear' ? 'ph-trend-down' : 'ph-minus';
  return `
  <div class="ind-row">
    <div class="ind-tile" style="background:${dim};color:${color}"><i class="ph-bold ${icon}"></i></div>
    <div class="ind-body">
      <div class="ind-name">${ind.name}</div>
      <div class="ind-detail">${ind.detail}</div>
    </div>
    <div class="ind-tag" style="background:${dim};color:${color}">${ind.state.toUpperCase()}</div>
  </div>`;
}

export function planRow(label, value, color) {
  return `
  <div class="plan-row">
    <div class="lbl"><span class="dot" style="background:${color || 'var(--neutral-500)'}"></span>${label}</div>
    <div class="val tabular" style="${color ? `color:${color}` : ''}">${value}</div>
  </div>`;
}
