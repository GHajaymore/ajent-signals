import { fmtPrice, fmtPct, verdictColorVar, verdictChipClass, stateColorVar, countryFlag } from './format.js';

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

export function dataTag(market) {
  return market.isLiveFresh
    ? '<span class="data-tag live">LIVE</span>'
    : '<span class="data-tag sim">SIM</span>';
}

export function heroCard(market, verdict) {
  const color = verdictColorVar(verdict);
  const s = market.signal;
  const subline = verdict === 'NO_TRADE'
    ? 'Waiting for a high-probability setup'
    : (verdict === 'BUY' ? 'Long setup confirmed' : 'Short setup confirmed');
  return `
  <div class="hero-card" data-nav="#/signal/${market.symbol}" style="background:linear-gradient(150deg, ${color}, transparent 65%); box-shadow:0 12px 34px -18px ${color}">
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
          <div class="px tabular">${fmtPrice(market.price, market.decimals)}</div>
          <div class="chg tabular" style="color:${market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)'}">${fmtPct(market.changePct)}</div>
        </div>
      </div>
      <div class="hero-verdict-row">
        <div class="hero-verdict" style="color:${color}">${verdictIcon(verdict)}${verdict === 'NO_TRADE' ? 'NO TRADE' : verdict}</div>
        <div class="hero-conf">
          <div class="hero-conf-top"><span class="text-muted">Confidence</span><span style="font-weight:600;color:${color}">${s.confidence}%</span></div>
          <div class="hero-conf-bar-track"><div class="hero-conf-bar-fill" style="width:${s.confidence}%;background:${color}"></div></div>
        </div>
      </div>
      <div class="hero-subline">${s.trend} · ${s.volatility} volatility · updated ${Math.max(1, Math.floor(s.createdAt ? (Date.now() - s.createdAt) / 1000 : 0))}s ago</div>
      <div class="hero-quad">
        <div class="hero-quad-cell"><div class="k">Entry</div><div class="v tabular">${fmtPrice(s.plan.entry, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">Stop</div><div class="v tabular" style="color:var(--sell)">${fmtPrice(s.plan.stop, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">Target</div><div class="v tabular" style="color:var(--buy)">${fmtPrice(s.plan.target1, market.decimals)}</div></div>
        <div class="hero-quad-cell"><div class="k">R:R</div><div class="v tabular" style="color:var(--accent-200)">${s.plan.riskReward.toFixed(1)}:1</div></div>
      </div>
    </div>
  </div>`;
}

export function watchlistRow(market, verdict) {
  const chgColor = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `
  <div class="wl-row" data-nav="#/signal/${market.symbol}">
    ${symTile(market.symbol, 36)}
    <div class="wl-name-block">
      <div class="wl-name">${market.name} ${dataTag(market)}</div>
      <div class="wl-price tabular">${fmtPrice(market.price, market.decimals)}</div>
    </div>
    <div class="wl-spark">${sparklineSvg(market.history, chgColor)}</div>
    <div class="wl-chg tabular" style="color:${chgColor}">${fmtPct(market.changePct)}</div>
    <div class="wl-verdict">${verdictChip(verdict)}</div>
  </div>`;
}

export function marketRow(market, verdict) {
  const chgColor = market.changePct >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `
  <div class="mkt-row" data-nav="#/signal/${market.symbol}">
    ${symTile(market.symbol, 36)}
    <div class="mkt-body">
      <div class="mkt-name">${market.name}</div>
      <div class="mkt-ex">${countryFlag(market.country)} ${market.exchange} · ${dataTag(market)}</div>
    </div>
    <div class="mkt-price">
      <div class="px tabular">${fmtPrice(market.price, market.decimals)}</div>
      <div class="chg tabular" style="color:${chgColor}">${fmtPct(market.changePct)}</div>
    </div>
    ${verdictChip(verdict)}
  </div>`;
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
