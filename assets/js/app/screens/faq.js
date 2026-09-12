// Honest FAQ — the hard questions answered straight, including "just buy VOO".
// Trust comes from telling users when NOT to use the app, not only when to.

const FAQ = [
  {
    q: 'Does this beat the stock market — VOO or QQQ?',
    a: 'Closer than it used to be. We refined the exit to <b>let winners run</b> — holding until the oversold move reverts to the mean, instead of bailing on the first up-day. In recent backtests the strategy has been <b>competitive with buy-and-hold, and on some windows ahead of it</b>, while keeping drawdown to a fraction of the index’s (~5% vs 25–35%). But backtests are hypothetical and depend on the window; in a relentless bull run, simple index funds can still win on raw return. The <b>live paper record is the real judge</b> — watch it, not our backtest.',
  },
  {
    q: 'Then why use this instead of just buying VOO/QQQ?',
    a: 'The case is risk, not just raw return:<br>• <b>Drawdown.</b> The strategy’s worst drop backtests around ~−5% vs VOO ~−25% (2022) and QQQ ~−35%. Most people sell at the bottom of a big drawdown — a mostly-in-cash strategy avoids that.<br>• <b>Bear/choppy markets.</b> Buy-and-hold bleeds when the market falls or chops; this sits in cash and buys dips.<br>• <b>Capital efficiency.</b> It’s in the market only a small fraction of the time — the rest your cash is free.<br>• <b>Diversification.</b> Uncorrelated to simply being long stocks.<br>If none of those matter to you and the market keeps rising, VOO/QQQ is simpler and cheaper — we won’t pretend otherwise.',
  },
  {
    q: 'What’s the strategy’s real edge, then?',
    a: 'A solid win rate (~<b>75%</b>) with a small drawdown: in cash most of the time, entering only on genuine oversold extremes, and <b>holding winners until they mean-revert</b> rather than exiting early. The aim is a strong <b>risk-adjusted</b> return while staying competitive with buy-and-hold — not to out-gain a rising index every year.<br><br><b>One honest caveat — it’s regime-dependent.</b> This is a mean-reversion edge, so it’s strongest in normal and rising markets and weakest in <b>fast crashes and choppy or bear stretches</b>, where oversold dips can keep falling. Years like 2018 or 2022 can show red — that’s the nature of buying dips, not a malfunction. The headline win rate reflects calmer markets and a young live record; expect <b>losing stretches when markets fall hard or chop</b>. We track the record unedited precisely so you see that honestly when it happens.',
  },
  {
    q: 'Are the numbers you show real, or simulated?',
    a: '<b>Real. Simulation was removed entirely.</b> Every price and signal comes from real market data. When there’s no real data for a market, we show “no live data” and hide it — never a fabricated price or a fake signal.',
  },
  {
    q: 'What do the numbers mean — profit factor, avg R, drawdown?',
    a: 'Plain-English, so nothing is a black box:<br>• <b>Win rate</b> — how often a trade closes in profit. A high one isn’t the whole story: a 90%-win strategy still loses money if the 10% of losses are huge.<br>• <b>Profit factor</b> — dollars won for every $1 lost (gross profit ÷ gross loss). Above 1 is profitable; ~2.5 means it made about $2.50 for each $1 it gave back.<br>• <b>Avg / trade (expectancy)</b> — the average profit or loss per trade. This is the <b>fair</b> number: it holds at any account size, unlike total $, which mostly reflects how many trades were taken.<br>• <b>Avg R</b> — the same idea in “risk units”: +0.30R means the average trade earns 0.30× what it risked. Scale-free, so any two strategies compare fairly.<br>• <b>Max drawdown</b> (“worst drop”) — the biggest peak-to-trough dip the account took. It answers “how bad did it get?” — the number that actually tests your nerve, and the reason the stop only ever risks a fixed, small amount per trade.<br>• <b>Ret/risk</b> (stock screener) — return per unit of volatility: how much a stock climbed versus how choppy it was. Higher means more reward for the risk taken.',
  },
  {
    q: 'Is the data real-time?',
    a: 'It depends on the market, and every price is labelled so you always know. <b>Crypto</b> is real-time. <b>US index futures</b> (ES/NQ/YM/RTY) show a <b>near-real-time estimate</b> derived from their live tracking ETF (SPY/QQQ/DIA/IWM) — labelled “~RT · SPY” — because the free futures feed itself runs ~15 min behind. Other indices are <b>real but delayed ~15–25 minutes</b>, labelled “delayed”. Delayed means <i>real, just late</i> — never fabricated. Signals compute on daily bars, so the small lag doesn’t change which setups fire.',
  },
  {
    q: 'Are the results net of fees?',
    a: 'Yes. Every P&L is shown <b>net of a round-turn cost</b> (commission + slippage). Gross numbers flatter a strategy — especially a high-frequency one, where fees can turn a “winner” into a net loss. We always show after-cost.',
  },
  {
    q: 'Does it trade long only, or short too?',
    a: 'It depends on the market. On <b>stock indices &amp; ETFs it is long-only</b> — those structurally drift up, so we backtested the mirror short side and it <b>lost money</b> (shorting fights the drift, rarely fires, and bear-market rallies stop it out), so we dropped it there. But markets that <b>don’t</b> drift up — <b>FX and commodities</b> — are symmetric, so a down move is a real opportunity the other way. On those the same mean-reversion edge trades <b>both directions</b>, and only after clearing the same validation gate (walk-forward, out-of-sample, a genuinely profitable short side). Those newer both-way markets ship clearly labelled <b>experimental</b> until their live record proves out.',
  },
  {
    q: 'Is this investment advice?',
    a: 'No. Ajent Signals is an <b>educational tool</b>. All trading is <b>simulated with virtual money</b> — it places no real orders and holds no funds. It is not investment advice, not a recommendation, and not a registered investment adviser or broker. You are solely responsible for your own decisions.',
  },
];

export function render(container) {
  container.innerHTML = `
  <div class="fade-in detail-screen">
    <div class="detail-header">
      <button class="back-btn" data-back aria-label="Go back"><i class="ph-bold ph-arrow-left"></i></button>
      <div class="detail-title-block">
        <div class="detail-title">Straight answers</div>
        <div class="detail-sub">The hard questions — answered honestly</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${FAQ.map((f, i) => `
        <details class="panel faq-item" style="padding:0" ${i === 0 ? 'open' : ''}>
          <summary style="cursor:pointer;list-style:none;padding:14px 16px;display:flex;align-items:center;gap:10px;font:600 14.5px var(--font-heading)">
            <span style="flex:1">${f.q}</span>
            <i class="ph-bold ph-caret-down" style="color:var(--text-muted);font-size:14px"></i>
          </summary>
          <div style="padding:0 16px 15px;font-size:13.5px;line-height:1.65;color:var(--text-muted)">${f.a}</div>
        </details>`).join('')}
    </div>
    <p class="text-faint" style="text-align:center;font-size:11px;line-height:1.6;margin-top:16px;padding:0 8px">Figures are hypothetical/simulated on virtual money and reflect a limited backtest and the live paper record. Past and simulated performance do not guarantee future results. Educational only — not investment advice.</p>
  </div>`;
  container.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));
}
