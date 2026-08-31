// Honest FAQ — the hard questions answered straight, including "just buy VOO".
// Trust comes from telling users when NOT to use the app, not only when to.

const FAQ = [
  {
    q: 'Does this beat the stock market — VOO or QQQ?',
    a: 'Honestly: <b>not on raw return in a bull market.</b> In our backtest, buying and holding the index returned roughly <b>~26%/yr</b> while the strategy did <b>~17%/yr net of costs</b> — it <b>trailed</b>. If your goal is maximum growth in a rising market, index funds win, and we won’t pretend otherwise. Where the strategy wins is <b>risk-adjusted</b> (see below) and in markets that aren’t a straight bull run. (Backtest is hypothetical; past results don’t guarantee future ones.)',
  },
  {
    q: 'Then why use this instead of just buying VOO/QQQ?',
    a: 'Only for reasons other than raw bull-market return:<br>• <b>Drawdown.</b> The strategy’s worst drop was ~−2% vs VOO ~−25% (2022) and QQQ ~−35%. Most people sell at the bottom of a big drawdown — a mostly-in-cash strategy avoids that.<br>• <b>Bear/choppy markets.</b> Buy-and-hold bleeds when the market falls or chops; this sits in cash and buys dips.<br>• <b>Capital efficiency.</b> It’s in the market only ~8% of the time — the rest your cash is free.<br>• <b>Diversification.</b> Uncorrelated to being long stocks.<br><b>If none of those matter to you, buy VOO/QQQ — it’s simpler, cheaper and made more.</b>',
  },
  {
    q: 'What’s the strategy’s real edge, then?',
    a: 'A high win rate (~80%+) with a very small drawdown, by being in cash most of the time and only entering on genuine oversold extremes. It aims to earn a good <b>risk-adjusted</b> return, not to out-gain a rising index.',
  },
  {
    q: 'Are the numbers you show real, or simulated?',
    a: '<b>Real. Simulation was removed entirely.</b> Every price and signal comes from real market data. When there’s no real data for a market, we show “no live data” and hide it — never a fabricated price or a fake signal.',
  },
  {
    q: 'Is the data real-time?',
    a: 'It’s <b>real but delayed ~15–25 minutes</b> on the free data feed, and labelled “delayed” so you always know. Delayed means <i>real, just late</i> — not fabricated. A licensed real-time feed would remove the lag.',
  },
  {
    q: 'Are the results net of fees?',
    a: 'Yes. Every P&L is shown <b>net of a round-turn cost</b> (commission + slippage). Gross numbers flatter a strategy — especially a high-frequency one, where fees can turn a “winner” into a net loss. We always show after-cost.',
  },
  {
    q: 'Does it trade long only, or both ways?',
    a: 'The daily strategy is <b>long</b> (the decade-validated edge) plus a <b>provisional short side</b> — the mirror, <b>not yet proven</b> (on equity indices shorts rarely fire and the backtest is weak, since indices drift up). The live record is the judge. Active mode trades both ways intraday.',
  },
  {
    q: 'Is this investment advice?',
    a: 'No. Ajent Signals is an <b>educational tool</b>. All trading is <b>simulated with virtual money</b> — it places no real orders and holds no funds. It is not investment advice, not a recommendation, and not a registered investment adviser or broker. You are solely responsible for your own decisions.',
  },
];

export function render(container) {
  container.innerHTML = `
  <div class="fade-in">
    <div class="detail-header">
      <button class="back-btn" data-back><i class="ph-bold ph-arrow-left"></i></button>
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
