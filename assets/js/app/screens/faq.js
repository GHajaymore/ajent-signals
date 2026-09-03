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
    a: 'A solid win rate (~<b>75%</b>) with a small drawdown: in cash most of the time, entering only on genuine oversold extremes, and now <b>holding winners until they mean-revert</b> rather than exiting early. The aim is a strong <b>risk-adjusted</b> return while staying competitive with buy-and-hold — not to out-gain a rising index every year.',
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
    q: 'Does it trade long only, or short too?',
    a: 'It is <b>long-only</b>. We backtested the mirror short side (short overbought pops in downtrends) and it <b>lost money</b> — indices structurally drift up, so shorting mean-reversion fights that drift, the setup rarely fires, and bear-market rallies stop it out. Rather than ship something the record says loses, we dropped it. The validated edge is buying deeply oversold dips in uptrends.',
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
