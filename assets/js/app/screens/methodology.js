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
  const daily = state.settings.strategyMode !== 'intraday';

  // The exit section differs by strategy: daily swing uses the Connors "first up
  // close" exit (backtested ~72% win / PF ~1.6 on US indices); intraday uses the
  // fixed tight-target geometry whose win rate comes from the reward:risk ratio.
  const exitSection = daily ? `
    <div class="section-label">3 · The exit — first green close</div>
    <div class="panel">
      <p class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:0"><b style="color:var(--text)">Long-only.</b> The entry waits for a <b style="color:var(--text)">deeply oversold day (RSI2 below 10)</b> that flushes below yesterday's low inside an uptrend. Once in, the trade closes on the <b style="color:var(--text)">first day that finishes green</b> — the classic Connors mean-reversion exit — grabbing the bounce instead of waiting for a fixed target, with a hard <b>2× ATR</b> stop underneath and a 5-day time stop as a backstop. The deepest setups (RSI2 below 5, below the lower Bollinger band) are flagged as higher conviction. (Shorting overbought pops backtested as a drag — indices drift up — so it's dropped.)</p>
      <div class="text-muted" style="font-size:12px;line-height:1.65;margin-top:10px">
        Clean 10-year backtest on US indices (S&amp;P, Nasdaq, Dow, Russell): <b style="color:var(--buy)">profit factor ~1.6</b>, <b style="color:var(--buy)">win rate ~72%</b>, ~1.6-day average hold — and it stayed <b>profitable in every one</b> of five sequential ~2-year windows rather than riding one lucky stretch. Tested out-of-sample on five more global indices it held up on four (ASX ~1.8, Euro Stoxx ~1.5, Nikkei ~1.2, TSX ~1.1) but <b>lost on India&rsquo;s Nifty 50</b>, where mean reversion works poorly. Daily mode auto-trades that validated set (US indices plus ASX, Euro Stoxx, Nikkei &amp; TSX) — the internationals also trade in different sessions, which spreads risk instead of piling into four US indices that dip together.
      </div>
    </div>` : `
    <div class="section-label">3 · The exit — ride the bounce to the mean</div>
    <div class="panel">
      <p class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:0"><b style="color:var(--text)">Both directions, 15-minute.</b> Buy an oversold dip (RSI2 below 10) or short an overbought pop (RSI2 above 90) — in any condition, no trend filter — then <b style="color:var(--text)">exit when RSI2 reverts to 50</b> (the move has reached the mean), with a <b>2× ATR</b> stop and a ~1-session time stop as backstops. On 15-minute bars there's no overnight drift, so shorting works here where it doesn't on the daily swing.</p>
      <div class="text-muted" style="font-size:12px;line-height:1.65;margin-top:10px">
        On ~60 days of 15-minute US-index data this backtested at <b style="color:var(--buy)">profit factor ~1.6</b>, positive on all four indices. The earlier version used a fixed tight target and <b>lost money</b> (PF ~0.86) — it capped winners while stops ran full-size. <b>Important:</b> 60 days is a small sample (the free feed's limit for 15-minute history), so intraday is <b>provisional</b> — trust the live paper record over the backtest here.
      </div>
    </div>`;

  const catchNote = daily
    ? 'A high win rate is <b>not</b> the same as profit — but here the two agree: the ~72% win rate <b>and</b> a profit factor around 1.6 both come from the same backtest, which held up in every ~2-year window. That edge is strongest on US indices and drawn from the past; it is never a promise. The Paper Trading tab tracks the real, live profit factor and expectancy so you always see the truth.'
    : 'A high win rate is <b>not</b> the same as profit. The intraday edge here rests on ~60 days of data — promising, but a small sample. Trust the live paper record, which the Paper Trading tab tracks (profit factor and expectancy), over any backtest number until it has built up.';

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
      <i class="ph-fill ph-chart-bar" style="font-size:30px;color:var(--buy)"></i>
      <div style="font:800 20px var(--font-heading);margin-top:8px">Mean reversion, in the direction of the trend</div>
      <p class="text-muted" style="font-size:13px;line-height:1.65;margin-top:8px">Ajent Pulse doesn't chase breakouts. It waits for price to stretch <b style="color:var(--text)">against</b> a healthy uptrend — a deep oversold dip — then bets it snaps back. ${daily ? 'The daily swing is <b style="color:var(--text)">long-only</b> — buy the dip in an uptrend, stand aside otherwise.' : 'Active mode trades <b style="color:var(--text)">both ways</b> — buy oversold dips and short overbought pops.'}</p>
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

    ${exitSection}

    <div class="panel" style="border:1px solid var(--hairline)">
      <div class="reason-row" style="align-items:flex-start"><i class="ph-fill ph-warning-circle" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">The honest catch.</b> ${catchNote}</span></div>
    </div>

    <div class="section-label">4 · Data &amp; limits</div>
    <div class="panel">
      <div class="text-muted" style="font-size:12.5px;line-height:1.65">
        Signals compute from ${daily ? '<b style="color:var(--text)">real daily candles</b> over the last two years' : '<b style="color:var(--text)">real 15-minute candles</b> over the trailing month'} via a free, unofficial price feed (best-effort, not a licensed data source). Index signals use the real-time cash index; some futures are ~15–25 min delayed on the free tier and are labelled <b>Delayed</b>. When live data is unavailable a market falls back to a labelled <b>SIM</b> placeholder and is not paper-traded.
        <br><br>
        Ajent Signals is for <b style="color:var(--text)">education only</b> — it does not execute trades, is not investment advice, and past results (including paper trading) do not guarantee future performance.
      </div>
    </div>
  </div>`;
}
