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
  const exitSection = `
    <div class="section-label">3 · The exit — ride the snap-back</div>
    <div class="panel">
      <p class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:0"><b style="color:var(--text)">Long-only.</b> The entry waits for a market that has stretched <b style="color:var(--text)">deeply oversold</b> and flushed below its recent low inside a healthy uptrend. Once in, the trade holds until the move <b style="color:var(--text)">reverts to the mean</b> — letting the bounce run rather than bailing early — with a <b>volatility-based stop</b> underneath and a time stop as a backstop. The most stretched setups are graded as higher conviction. (The short side backtested as a drag on these markets, so it's dropped.)</p>
      <div class="text-muted" style="font-size:12px;line-height:1.65;margin-top:10px">
        Validated over a <b>decade</b> on major global indices: it stayed <b style="color:var(--buy)">profitable across every one</b> of several sequential walk-forward windows — not one lucky stretch — and held up out-of-sample on most additional indices. The few markets where mean reversion doesn't fit are excluded. Holds run a few days. The exact recipe is proprietary; the edge is drawn from the past and is <b>never a promise</b> — judge it by the live record.
      </div>
    </div>`;

  const catchNote = 'A high win rate is <b>not</b> the same as profit — a real edge needs both, and this one is validated across a decade and every walk-forward window. That edge is drawn from the past; it is never a promise. The Paper Trading tab tracks the real, live profit factor and expectancy so you always see the truth, not a backtest.';

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
      <div style="font:800 20px var(--font-heading);margin-top:8px">Two proven edges, one long-only ensemble</div>
      <p class="text-muted" style="font-size:13px;line-height:1.65;margin-top:8px">Ajent Pulse's core edge is <b style="color:var(--text)">mean reversion</b> — it doesn't chase breakouts; it waits for price to stretch <b style="color:var(--text)">against</b> a healthy uptrend (a deep oversold dip) and bets it snaps back. Paired with it is a <b style="color:var(--text)">trend-following</b> engine that rides <b style="color:var(--text)">established uptrends</b>. Both are <b style="color:var(--text)">long-only</b> — when neither is set up, it stands aside.</p>
    </div>

    <div class="section-label">1 · The setup</div>
    <div class="panel">
      <div class="reason-row"><i class="ph-bold ph-trend-up" style="color:var(--buy)"></i><span><b style="color:var(--text)">Trend is your friend.</b> Only trade with the higher-timeframe trend (price vs a long EMA). Fighting the bigger trend is where accuracy collapses.</span></div>
      <div class="reason-row"><i class="ph-bold ph-arrow-bend-down-right" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">Buy fear, not strength.</b> Enter only on a genuine counter-move — when momentum is at a fast extreme and price has stretched unusually far from its recent average. Shallow noise is ignored.</span></div>
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

    <div class="section-label">4 · The second edge — riding established trends</div>
    <div class="panel">
      <p class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:0">Mean reversion is only half of it. When a market is instead in a <b style="color:var(--text)">firmly established uptrend</b> — price riding above a rising long-term average with momentum behind it — Ajent goes long to <b style="color:var(--text)">ride the continuation</b>. No oversold dip required. Instead of a fixed target it holds via a <b style="color:var(--text)">ratcheting trailing stop</b> that follows price up and only exits when the trend actually breaks — so winners are allowed to run.</p>
      <div class="reason-row" style="margin-top:6px"><i class="ph-bold ph-arrows-split" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">Why both.</b> The two edges fire on <b>different days</b> — dips in choppy pullbacks, continuations in strong trends — so together they stay active across more market conditions than either alone. That's diversification, not a bigger bet.</span></div>
      <div class="reason-row"><i class="ph-bold ph-gauge" style="color:var(--flat)"></i><span><b style="color:var(--text)">Honest tier.</b> A continuation entry is <b>lower-conviction</b> than the deepest-oversold snap and reads that way in the app — a more moderate confidence — because it earns its place by firing when mean reversion is quiet, not by being the single strongest setup.</span></div>
      <div class="text-muted" style="font-size:12px;line-height:1.65;margin-top:10px">Lab-validated as a robustly <b style="color:var(--buy)">positive, diversifying</b> edge before it was switched on — it need not beat mean reversion, only add to it on different days. As always, the exact rule is proprietary and the edge is <b>never a promise</b>; judge it by the live record.</div>
    </div>

    <div class="panel" style="border:1px solid var(--hairline)">
      <div class="reason-row" style="align-items:flex-start"><i class="ph-fill ph-warning-circle" style="color:var(--accent-300)"></i><span><b style="color:var(--text)">The honest catch.</b> ${catchNote}</span></div>
    </div>

    <div class="section-label">5 · Data &amp; limits</div>
    <div class="panel">
      <div class="text-muted" style="font-size:12.5px;line-height:1.65">
        Signals compute from ${daily ? '<b style="color:var(--text)">real daily candles</b> over the last two years' : '<b style="color:var(--text)">real 15-minute candles</b> over the trailing month'} via a free, unofficial price feed (best-effort, not a licensed data source). Index signals use the real-time cash index; some futures are ~15–25 min delayed on the free tier and are labelled <b>Delayed</b>. When live data is unavailable a market falls back to a labelled <b>SIM</b> placeholder and is not paper-traded.
        <br><br>
        Ajent Signals is for <b style="color:var(--text)">education only</b> — it does not execute trades, is not investment advice, and past results (including paper trading) do not guarantee future performance.
      </div>
    </div>
  </div>`;
}
