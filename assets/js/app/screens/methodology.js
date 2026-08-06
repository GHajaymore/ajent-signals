import { state } from '../state.js';

// Small diagram of the asymmetric exit geometry: a tight target above entry, a
// wider stop below — the reason the win rate is high.
function geometryDiagram(ratio) {
  const w = 320, h = 150;
  const entryY = 58, tgtY = entryY - 34, stopY = entryY + (34 / ratio);
  const line = (y, color, dash) => `<line x1="46" y1="${y}" x2="${w - 8}" y2="${y}" stroke="${color}" stroke-width="1.5" ${dash ? 'stroke-dasharray="4 4"' : ''}/>`;
  const label = (y, txt, color) => `<text x="42" y="${y + 3.5}" text-anchor="end" font-size="10" font-weight="700" fill="${color}">${txt}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="height:auto;display:block;max-width:340px;margin:6px auto 0">
    <rect x="46" y="${tgtY}" width="${w - 54}" height="${entryY - tgtY}" fill="var(--buy)" opacity="0.08"/>
    <rect x="46" y="${entryY}" width="${w - 54}" height="${stopY - entryY}" fill="var(--sell)" opacity="0.07"/>
    ${line(tgtY, 'var(--buy)', false)} ${label(tgtY, 'TARGET', 'var(--buy)')}
    ${line(entryY, 'var(--accent-300)', false)} ${label(entryY, 'ENTRY', 'var(--accent-300)')}
    ${line(stopY, 'var(--sell)', true)} ${label(stopY, 'STOP', 'var(--sell)')}
    <text x="${w - 10}" y="${(tgtY + entryY) / 2 + 3}" text-anchor="end" font-size="9.5" fill="var(--buy)">reward · small</text>
    <text x="${w - 10}" y="${(entryY + stopY) / 2 + 3}" text-anchor="end" font-size="9.5" fill="var(--sell)">risk · wider</text>
  </svg>`;
}

export function render(container) {
  const rr = Number.isFinite(state.settings.targetRatio) ? state.settings.targetRatio : 0.35;
  const estWin = Math.round(100 / (1 + rr));

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <div class="detail-head" style="margin-bottom:14px">
      <button class="icon-btn" data-back><i class="ph-bold ph-arrow-left"></i></button>
      <div>
        <div class="detail-title">How Ajent Pulse works</div>
        <div class="detail-sub">The strategy behind every signal</div>
      </div>
    </div>

    <div class="panel" style="text-align:center;padding:20px 16px">
      <i class="ph-fill ph-pulse" style="font-size:30px;color:var(--buy)"></i>
      <div style="font:800 20px var(--font-heading);margin-top:8px">Mean reversion, in the direction of the trend</div>
      <p class="text-muted" style="font-size:13px;line-height:1.65;margin-top:8px">Ajent Pulse doesn't chase breakouts. It waits for price to stretch <b style="color:var(--text)">against</b> a healthy trend — then bets the trend resumes. Buy the dip in an uptrend; sell the pop in a downtrend.</p>
    </div>

    <div class="section-label">1 · The setup</div>
    <div class="panel">
      <div class="reason-row"><i class="ph-bold ph-trend-up" style="color:var(--buy)"></i><span><b style="color:var(--text)">Trend is your friend.</b> Only trade with the higher-timeframe trend (price vs a long EMA). Fighting the bigger trend is where accuracy collapses.</span></div>
      <div class="reason-row"><i class="ph-bold ph-arrow-bend-down-right" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">Buy fear, not strength.</b> Enter only on a genuine counter-move — a fast <b>RSI(2)</b> extreme, a <b>Bollinger</b> band touch, a stretched <b>RSI(14)</b>/<b>CCI</b>. Shallow noise is ignored.</span></div>
      <div class="reason-row"><i class="ph-bold ph-funnel" style="color:var(--flat)"></i><span><b style="color:var(--text)">Be selective.</b> A signal fires only when the dip/pop is deep enough to clear your confidence threshold — so it waits rather than trading constantly.</span></div>
    </div>

    <div class="section-label">2 · The discipline (what pros actually do)</div>
    <div class="panel">
      <div class="reason-row"><i class="ph-bold ph-hand-palm" style="color:var(--sell)"></i><span><b style="color:var(--text)">Never catch a falling knife.</b> Wait for the bar to turn back in the trade's direction before buying a dip — an unconfirmed reversal is down-weighted until it proves itself.</span></div>
      <div class="reason-row"><i class="ph-bold ph-warning-octagon" style="color:var(--sell)"></i><span><b style="color:var(--text)">Know a breakdown from a pullback.</b> A violent multi-bar collapse against the trend is a trend <b>break</b>, not a dip — fading those is how accounts blow up, so the engine stands aside.</span></div>
      <div class="reason-row"><i class="ph-bold ph-lightning" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">Don't trade the chaos.</b> When volatility spikes vs its recent norm (usually a news shock), there's no edge and slippage is worse — the engine steps back.</span></div>
      <div class="reason-row"><i class="ph-bold ph-scales" style="color:var(--buy)"></i><span><b style="color:var(--text)">Risk a fixed, small fraction.</b> Every position risks the same set % of the account (yours, in Settings), so no single trade can do outsized damage.</span></div>
    </div>

    <div class="section-label">3 · The exit — why the win rate is high</div>
    <div class="panel">
      <p class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:0">A pullback inside a trend usually resumes, so the trade uses a <b style="color:var(--text)">tight target and a wider stop</b>. The small target gets reached far more often than the distant stop — that asymmetry is the win rate.</p>
      ${geometryDiagram(rr)}
      <div class="text-muted" style="font-size:12px;line-height:1.6;margin-top:10px;text-align:center">At your current <b style="color:var(--accent-200)">${rr.toFixed(1)} : 1</b> reward:risk, the geometry alone wins about <b style="color:var(--buy)">${estWin}%</b> of the time. Adjust it any time in Settings.</div>
    </div>

    <div class="panel" style="border:1px solid var(--hairline)">
      <div class="reason-row" style="align-items:flex-start"><i class="ph-fill ph-warning-circle" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">The honest catch.</b> A high win rate is <b>not</b> the same as profit. Because wins are small and the occasional loss is larger, the strategy aims to protect capital and hover around break-even — the mean-reversion edge is what can tip it positive. The Paper Trading tab shows the real profit factor and expectancy so you always see the truth, not just the win rate.</span></div>
    </div>

    <div class="section-label">4 · Data &amp; limits</div>
    <div class="panel">
      <div class="text-muted" style="font-size:12.5px;line-height:1.65">
        Signals compute from <b style="color:var(--text)">real 15-minute candles</b> over the trailing month via a free, unofficial price feed (best-effort, not a licensed data source). Index signals use the real-time cash index; some futures are ~15–25 min delayed on the free tier and are labelled <b>Delayed</b>. When live data is unavailable a market falls back to a labelled <b>SIM</b> placeholder and is not paper-traded.
        <br><br>
        Ajent Signals is for <b style="color:var(--text)">education only</b> — it does not execute trades, is not investment advice, and past results (including paper trading) do not guarantee future performance.
      </div>
    </div>
  </div>`;
}
