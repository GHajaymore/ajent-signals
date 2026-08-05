import { fmtPrice, fmtPct, verdictColorVar, verdictChipClass, stateColorVar, countryFlag } from './format.js';
import { isInWatchlist } from './state.js';

// Star toggle for a market row — filled when the market is in the watchlist.
// The click is handled by a delegated listener (see markets.js) which stops it
// from bubbling to the row's navigation.
function starToggle(symbol) {
  const on = isInWatchlist(symbol);
  return `<button class="mkt-star ${on ? 'on' : ''}" data-star="${symbol}" title="${on ? 'In watchlist — tap to remove' : 'Add to watchlist'}"><i class="${on ? 'ph-fill' : 'ph'} ph-star"></i></button>`;
}

export function sparklineSvg(history, color, w = 56, h = 28) {
  const pts = history.slice(-24);
  if (pts.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const step = w / (pts.length - 1);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p - min) / range) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
  const closed = market.isClosed
    ? ' <span class="data-tag closed" title="Exchange is closed — price is the last traded value and won\'t move until it reopens">CLOSED</span>'
    : '';
  return (market.signalIsReal
    ? '<span class="data-tag live" title="Indicators computed from real price history">REAL</span>'
    : '<span class="data-tag sim" title="Simulated — real analysis unavailable right now">SIM</span>') + closed;
}

export function heroCard(market, verdict) {
  const color = verdictColorVar(verdict);
  const s = market.signal;
  const subline = verdict === 'NO_TRADE'
    ? 'Waiting for a high-probability setup'
    : (verdict === 'BUY' ? 'Long setup confirmed' : 'Short setup confirmed');
  return `
  <div class="hero-card" data-nav="#/signal/${market.symbol}" data-sym="${market.symbol}" data-verdict="${verdict}" data-createdat="${s.createdAt || 0}" style="background:linear-gradient(150deg, ${color}, transparent 65%); box-shadow:0 12px 34px -18px ${color}">
    <div class="hero-inner">
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
      <div class="hero-subline" data-f="subline">${s.trend} · ${s.volatility} volatility · updated ${Math.max(1, Math.floor(s.createdAt ? (Date.now() - s.createdAt) / 1000 : 0))}s ago</div>
      ${verdict === 'NO_TRADE' ? `
      <div class="hero-no-setup">No active setup — entry, stop &amp; target appear once a BUY or SELL fires.</div>` : `
      <div class="hero-quad">
        <div class="hero-quad-cell"><div class="k">Entry</div><div class="v tabular">${fmtPrice(s.plan.entry, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">Stop</div><div class="v tabular" style="color:var(--sell)">${fmtPrice(s.plan.stop, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">Target</div><div class="v tabular" style="color:var(--buy)">${fmtPrice(s.plan.target1, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">R : R</div><div class="v tabular" style="color:var(--accent-200)">${s.plan.riskReward.toFixed(1)} : 1</div></div>
      </div>`}
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
    <span data-f="verdict">${verdictChip(verdict)}</span>
    ${starToggle(market.symbol)}
  </div>`;
}

// Patch the hero card's volatile fields (price/change/subline) in place.
// Returns false when the signal itself changed (new verdict or recompute), so
// the caller knows to rebuild the whole card; true when patched cleanly.
export function patchHero(el, market, verdict) {
  const s = market.signal;
  if (el.dataset.verdict !== verdict || String(s.createdAt || 0) !== el.dataset.createdat || el.dataset.sym !== market.symbol) {
    return false;
  }
  const priceStr = fmtPrice(market.price, market.decimals);
  const px = el.querySelector('[data-f="price"]');
  if (px && px.textContent !== priceStr) px.textContent = priceStr;
  const chg = el.querySelector('[data-f="chg"]');
  if (chg) {
    const t = fmtPct(market.changePct);
    if (chg.textContent !== t) chg.textContent = t;
    chg.style.color = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  }
  const sub = el.querySelector('[data-f="subline"]');
  if (sub) {
    const t = `${s.trend} · ${s.volatility} volatility · updated ${Math.max(1, Math.floor(s.createdAt ? (Date.now() - s.createdAt) / 1000 : 0))}s ago`;
    if (sub.textContent !== t) sub.textContent = t;
  }
  return true;
}

// In-place patch of a market/watchlist row — updates only the values that
// actually changed, so the DOM never rebuilds and nothing flickers.
export function patchRow(el, market, verdict) {
  const chgColor = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  const priceStr = fmtPrice(market.price, market.decimals);
  const px = el.querySelector('[data-f="price"]');
  if (px && px.textContent !== priceStr) px.textContent = priceStr;
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
