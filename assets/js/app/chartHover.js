// Shared chart hover: a crosshair + value tooltip, used by the signal price charts and
// the Paper equity curves. The chart stashes its series + scale on the <svg> (hoverAttrs)
// and includes a hidden crosshair layer (hoverLayerSvg); wireChartHover maps a cursor X
// to the nearest point and shows its value (Y). `fmt` picks price vs dollar formatting.

function fmtTick(ms, spanMs) {
  const d = new Date(ms);
  if (spanMs < 3 * 86400000) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Stash the data the hover needs on the <svg>. `fmt`: 'price' (default) or 'usd'.
// `opts.entry`/`opts.stop` (price charts with a live setup) let the tooltip also show the
// risk-multiple at the hovered price: 0R at entry, -1R at the stop, +1R at the 1:1 target.
export function hoverAttrs(series, times, lo, hi, h, w, dec, fmt, opts = {}) {
  const enc = (o) => encodeURIComponent(JSON.stringify(o));
  const e = opts.entry, s = opts.stop;
  const rAttr = (typeof e === 'number' && isFinite(e) && typeof s === 'number' && isFinite(s) && Math.abs(e - s) > 1e-9)
    ? ` data-entry="${e}" data-stop="${s}"` : '';
  return `class="pchart" data-lo="${lo}" data-hi="${hi}" data-h="${h}" data-w="${w}" data-dec="${dec}" data-fmt="${fmt || 'price'}"${rAttr} data-series="${enc(series)}"${times && times.length ? ` data-times="${enc(times)}"` : ''}`;
}

// Hidden crosshair + chip. A transparent hit rect captures the pointer across the plot.
export function hoverLayerSvg(w, h) {
  return `<rect class="hv-hit" x="0" y="0" width="${w}" height="${h}" fill="transparent" style="cursor:crosshair"/>
  <g class="hv" style="display:none;pointer-events:none">
    <line class="hv-x" y1="0" y2="${h}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>
    <circle class="hv-dot" r="3.4" fill="var(--text)" stroke="var(--bg)" stroke-width="1.5"/>
    <g class="hv-tip"><rect class="hv-bg" rx="4" height="16" fill="var(--surface-2)" stroke="var(--hairline)"/><text class="hv-tx" font-size="9.5" font-weight="700" fill="var(--text)" dominant-baseline="middle" font-family="var(--font-mono)"></text></g>
  </g>`;
}

export function wireChartHover(root) {
  (root || document).querySelectorAll('svg.pchart').forEach((svg) => {
    if (svg.dataset.hvWired) return;
    svg.dataset.hvWired = '1';
    let series = [], times = null;
    try { series = JSON.parse(decodeURIComponent(svg.dataset.series || '[]')); } catch (e) { /* ignore */ }
    try { times = svg.dataset.times ? JSON.parse(decodeURIComponent(svg.dataset.times)) : null; } catch (e) { /* ignore */ }
    if (!Array.isArray(series) || series.length < 2) return;
    const lo = +svg.dataset.lo, hi = +svg.dataset.hi, h = +svg.dataset.h, w = +svg.dataset.w, dec = +svg.dataset.dec;
    const fmt = svg.dataset.fmt || 'price';
    const entry = svg.dataset.entry !== undefined ? +svg.dataset.entry : null;
    const stop = svg.dataset.stop !== undefined ? +svg.dataset.stop : null;
    const hasR = entry !== null && stop !== null && isFinite(entry) && isFinite(stop) && Math.abs(entry - stop) > 1e-9;
    const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
    const step = w / (series.length - 1);
    const g = svg.querySelector('.hv'), lineEl = svg.querySelector('.hv-x'), dot = svg.querySelector('.hv-dot');
    const bg = svg.querySelector('.hv-bg'), tx = svg.querySelector('.hv-tx');
    if (!g || !lineEl || !dot || !bg || !tx) return;
    const spanMs = times ? (times[times.length - 1] - times[0]) || 1 : 0;
    const move = (clientX) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      let idx = Math.round(((clientX - rect.left) / rect.width * w) / step);
      idx = Math.max(0, Math.min(series.length - 1, idx));
      const v = series[idx];
      if (typeof v !== 'number' || !isFinite(v)) return;
      const x = idx * step, y = yFor(v);
      lineEl.setAttribute('x1', x.toFixed(1)); lineEl.setAttribute('x2', x.toFixed(1));
      dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1));
      const valStr = fmt === 'usd'
        ? `${v >= 0 ? '+$' : '−$'}${Math.abs(Math.round(v)).toLocaleString('en-US')}`
        : v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      // Risk-multiple at this price (long or short): 0R at entry, -1R at the stop.
      const rStr = hasR ? `  ·  ${(v - entry) / (entry - stop) >= 0 ? '+' : ''}${((v - entry) / (entry - stop)).toFixed(1)}R` : '';
      const ctx = times ? '  ·  ' + fmtTick(times[idx], spanMs) : '';
      const label = valStr + rStr + ctx;
      tx.textContent = label;
      const tw = label.length * 5.7 + 12;
      const tipX = Math.max(2, Math.min(w - tw - 2, x - tw / 2));
      const tipY = y - 22 < 2 ? Math.min(h - 18, y + 8) : y - 22;
      bg.setAttribute('x', tipX.toFixed(1)); bg.setAttribute('y', tipY.toFixed(1)); bg.setAttribute('width', tw.toFixed(1));
      tx.setAttribute('x', (tipX + 6).toFixed(1)); tx.setAttribute('y', (tipY + 8).toFixed(1));
      g.style.display = '';
    };
    const hide = () => { g.style.display = 'none'; };
    svg.addEventListener('mousemove', (e) => move(e.clientX));
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchstart', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchend', hide);
  });
}
