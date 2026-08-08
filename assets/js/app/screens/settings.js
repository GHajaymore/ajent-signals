import { state, saveSettings, perTradeRisk, setPaperMarkets, setAllPaperMarkets, DAILY_AUTOTRADE_MARKETS, INTRADAY_AUTOTRADE_MARKETS } from '../state.js';
import { fmtMoney } from '../format.js';
import { resetPaperTrades } from '../paperTrading.js';

const NOTIF_ROWS = [
  { key: 'buy', label: 'Buy signals', icon: 'ph-arrow-up-right', color: 'var(--buy)' },
  { key: 'sell', label: 'Sell signals', icon: 'ph-arrow-down-right', color: 'var(--sell)' },
  { key: 'stop', label: 'Stop hit', icon: 'ph-hand-palm', color: 'var(--sell)' },
  { key: 'target', label: 'Target reached', icon: 'ph-target', color: 'var(--buy)' },
  { key: 'reversal', label: 'Trend reversal', icon: 'ph-arrows-clockwise', color: 'var(--flat)' },
  { key: 'volatility', label: 'High-volatility warning', icon: 'ph-lightning', color: 'var(--flat)' },
  { key: 'news', label: 'Economic-event warning', icon: 'ph-newspaper', color: 'var(--accent-300)' },
];

function computeRisk(market, balance, riskPct) {
  const { entry, stop } = market.signal.plan;
  const riskPerContract = Math.abs(entry - stop) * market.pointValue;
  const dollarsAtRisk = balance * (riskPct / 100);
  const contracts = Math.floor(dollarsAtRisk / riskPerContract);
  return { contracts, riskPerContract, dollarsAtRisk };
}

function patchRiskCalc() {
  const market = state.engine.get(state.selectedSymbol);
  const { riskPct, accountBalance } = state.settings;
  const { contracts, riskPerContract } = computeRisk(market, accountBalance, riskPct);
  document.getElementById('calc-stake').textContent = fmtMoney(perTradeRisk());
  document.getElementById('calc-contracts').textContent = String(Math.max(0, contracts));
  document.getElementById('calc-contracts-label').textContent = `${market.symbol} contracts`;
  const warnEl = document.getElementById('risk-warning');
  if (contracts < 1) {
    warnEl.style.display = 'block';
    warnEl.textContent = `One ${market.symbol} contract risks ${fmtMoney(riskPerContract)} — above your ${fmtMoney(accountBalance * riskPct / 100)} budget. Use micros or raise risk.`;
  } else {
    warnEl.style.display = 'none';
  }
}

export function render(container) {
  const { threshold, riskPct, accountBalance, notifications, targetRatio } = state.settings;
  const rr = Number.isFinite(targetRatio) ? targetRatio : 0.4;
  const estWin = Math.round(100 / (1 + rr));
  const market = state.engine.get(state.selectedSymbol);
  const { contracts, riskPerContract } = computeRisk(market, accountBalance, riskPct);

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title" style="margin-bottom:18px">Settings</h1>

    <div class="pro-card" data-nav="#/paywall">
      <div class="pro-icon"><i class="ph-fill ph-crown-simple"></i></div>
      <div class="pro-body">
        <div class="pro-title">Ajent Pro</div>
        <div class="pro-sub">Unlimited signals, all markets, alerts</div>
      </div>
      <span class="chip-upgrade">Upgrade</span>
    </div>

    <div class="panel setting-block">
      <div class="panel-title" style="margin-bottom:8px">Strategy</div>
      <div class="seg-toggle" id="mode-toggle">
        <button class="seg-opt ${state.settings.strategyMode === 'intraday' ? 'on' : ''}" data-mode="intraday">Active · 15m</button>
        <button class="seg-opt ${state.settings.strategyMode !== 'intraday' ? 'on' : ''}" data-mode="daily">Proven · daily</button>
      </div>
      <div class="setting-help" id="mode-help" style="margin-top:10px">${state.settings.strategyMode === 'intraday'
        ? 'Active mode — 15-minute Connors mean reversion, long-only. Buys oversold dips (RSI2 below 15) in an intraday uptrend and exits when RSI2 recovers past 50. Tuned for frequency: ~20+ setups a day across S&P, Nasdaq, Russell, Euro Stoxx and crypto (BTC/ETH, which run 24/7). Backtested ~66% win, profit factor ~1.5–2.6 on indices and ~1.2 on crypto — but on ~60 days of data only, so treat it as provisional until the live paper record confirms it.'
        : 'Proven mode — daily Connors mean reversion, long-only (fewer signals, but decade-validated). Buys deeply oversold days that flush below the prior day\'s low in an uptrend, then exits on the first day that closes green ("first up close"). (Shorting overbought pops backtested as a drag, so it\'s dropped.) Backtested over 10 years on US indices: profit factor ~1.6, win rate ~74%, ~1.6-day average hold — profitable in every one of five ~2-year walk-forward windows and out-of-sample on four more global indices. The deepest setups (RSI2 below 5, below the lower Bollinger band) are flagged as higher conviction. Daily mode auto-trades the validated set — US indices (deepest edge) plus ASX, Euro Stoxx, Nikkei &amp; TSX for session diversification (adjust in Paper Trading). Past results never guarantee future performance.'}</div>
    </div>

    <div class="panel setting-block">
      <div class="setting-row-top"><span class="t">Signal confidence threshold</span><span class="v" id="threshold-val">${threshold}%</span></div>
      <input id="threshold-range" class="range" type="range" min="60" max="90" step="1" value="${threshold}">
      <div class="setting-help">Below this, markets show &ldquo;No Trade &mdash; waiting for a high-probability setup&rdquo;.</div>
    </div>


    <div class="panel setting-block">
      <div class="panel-title">Account &amp; risk</div>
      <div class="risk-grid">
        <div>
          <div class="risk-label">Account size ($)</div>
          <input id="balance-input" class="text-input" type="number" min="0" step="500" value="${accountBalance}">
        </div>
        <div>
          <div class="risk-label">Risk per trade <span id="risk-val" style="color:var(--accent-300)">${riskPct}%</span></div>
          <input id="risk-range" class="range" type="range" min="0.25" max="3" step="0.25" value="${riskPct}" style="margin-top:12px">
        </div>
      </div>
      <div class="risk-result-grid">
        <div class="risk-result-cell"><div class="v" id="calc-stake">${fmtMoney(perTradeRisk())}</div><div class="k">staked per trade</div></div>
        <div class="risk-result-cell"><div class="v" id="calc-contracts">${Math.max(0, contracts)}</div><div class="k" id="calc-contracts-label">${market.symbol} contracts</div></div>
      </div>
      <div class="setting-help">This is what each paper trade risks, and sizes the position calculator on every signal.</div>
      <div class="risk-warning" id="risk-warning" style="display:${contracts < 1 ? 'block' : 'none'}"></div>
      ${state.settings.strategyMode !== 'intraday' ? `
      <div class="notif-row" style="padding:12px 0 4px;border-top:1px solid var(--hairline);margin-top:12px">
        <div class="notif-icon" style="background:var(--buy-dim);color:var(--buy)"><i class="ph-bold ph-arrow-fat-lines-up"></i></div>
        <div class="notif-label" style="flex:1">Scale up on high-conviction<div class="setting-help" style="margin-top:2px">Risk 1.5&times; on the deepest (RSI2&lt;5) setups. Backtested to lift return-per-risk &mdash; but it deepens drawdowns too. Double-edged, so it&rsquo;s off by default.</div></div>
        <div class="switch ${state.settings.scaleByConviction ? 'on' : ''}" id="conviction-switch"></div>
      </div>` : ''}
    </div>

    <div class="pro-card" data-nav="#/methodology" style="cursor:pointer">
      <div class="pro-icon" style="background:var(--buy-dim);color:var(--buy)"><i class="ph-fill ph-pulse"></i></div>
      <div class="pro-body">
        <div class="pro-title">How Ajent Pulse works</div>
        <div class="pro-sub">The strategy, the math, and the honest caveats</div>
      </div>
      <i class="ph-bold ph-caret-right" style="color:var(--text-muted)"></i>
    </div>

    <div class="panel setting-block">
      <div class="panel-title">Paper trading</div>
      <div class="setting-help" style="margin-top:0">Ajent tests its signals with virtual money on the Paper tab. Clearing history starts your track record fresh.</div>
      <button class="btn btn-ghost btn-block" id="reset-paper" style="height:44px;font-size:13px;margin-top:10px;color:var(--sell)">Reset paper-trading history</button>
    </div>

    <div class="setting-block">
      <div class="eyebrow" style="margin-bottom:8px">Push notifications</div>
      <div class="panel" style="padding:4px 16px">
        ${NOTIF_ROWS.map((r) => `
          <div class="notif-row">
            <div class="notif-icon" style="background:color-mix(in srgb, ${r.color} 18%, transparent);color:${r.color}"><i class="ph-bold ${r.icon}"></i></div>
            <div class="notif-label">${r.label}</div>
            <div class="switch ${notifications[r.key] ? 'on' : ''}" data-key="${r.key}"></div>
          </div>`).join('')}
      </div>
    </div>

    <div class="footer-note">Ajent Signals is an educational tool and does not execute trades.<br>Markets tagged REAL compute indicators from a free public price feed (unofficial, best-effort); SIM markets are simulated placeholders when real data is unavailable · v1.0.0</div>
  </div>`;

  container.querySelectorAll('#mode-toggle .seg-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (state.settings.strategyMode === mode) return;
      state.settings.strategyMode = mode;
      saveSettings();
      // Point the auto-trade set at each strategy's validated markets: the
      // decade-tested indices for daily, the six frequency-tuned markets
      // (S&P/Nasdaq/Russell/Euro Stoxx + BTC/ETH) for intraday.
      const all = state.engine.markets.map((m) => m.symbol);
      const set = mode === 'daily' ? DAILY_AUTOTRADE_MARKETS : INTRADAY_AUTOTRADE_MARKETS;
      setPaperMarkets(set.filter((s) => all.includes(s)));
      container.querySelectorAll('#mode-toggle .seg-opt').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      document.getElementById('mode-help').textContent = mode === 'intraday'
        ? 'Active mode — 15-minute Connors mean reversion, long-only. Buys oversold dips (RSI2 below 15) in an intraday uptrend and exits when RSI2 recovers past 50. Tuned for frequency: ~20+ setups a day across S&P, Nasdaq, Russell, Euro Stoxx and crypto (BTC/ETH, which run 24/7). Backtested ~66% win, profit factor ~1.5–2.6 on indices and ~1.2 on crypto — but on ~60 days of data only, so treat it as provisional until the live paper record confirms it.'
        : 'Proven mode — daily Connors mean reversion, long-only (fewer signals, but decade-validated). Buys deeply oversold days that flush below the prior day\'s low in an uptrend, then exits on the first day that closes green ("first up close"). Backtested over 10 years on US indices: profit factor ~1.6, win rate ~74%, and profitable in every one of five ~2-year walk-forward windows. The deepest setups (RSI2 below 5) are flagged as higher conviction. Daily mode auto-trades the validated set — US indices plus ASX, Euro Stoxx, Nikkei & TSX. Past results never guarantee future performance.';
      // Re-render so the conviction toggle (daily-only) appears/disappears with the mode.
      render(container);
    });
  });

  const thresholdRange = document.getElementById('threshold-range');
  thresholdRange.addEventListener('input', () => {
    state.settings.threshold = Number(thresholdRange.value);
    document.getElementById('threshold-val').textContent = `${state.settings.threshold}%`;
    saveSettings();
  });

  const riskRange = document.getElementById('risk-range');
  riskRange.addEventListener('input', () => {
    state.settings.riskPct = Number(riskRange.value);
    document.getElementById('risk-val').textContent = `${state.settings.riskPct}%`;
    patchRiskCalc();
    saveSettings();
  });

  const balanceInput = document.getElementById('balance-input');
  balanceInput.addEventListener('input', () => {
    state.settings.accountBalance = Number(balanceInput.value) || 0;
    patchRiskCalc();
    saveSettings();
  });

  container.querySelectorAll('.switch[data-key]').forEach((sw) => {
    sw.addEventListener('click', () => {
      const key = sw.dataset.key;
      state.settings.notifications[key] = !state.settings.notifications[key];
      sw.classList.toggle('on', state.settings.notifications[key]);
      saveSettings();
    });
  });

  const convSwitch = document.getElementById('conviction-switch');
  if (convSwitch) {
    convSwitch.addEventListener('click', () => {
      state.settings.scaleByConviction = !state.settings.scaleByConviction;
      convSwitch.classList.toggle('on', state.settings.scaleByConviction);
      saveSettings();
    });
  }

  const resetBtn = document.getElementById('reset-paper');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Clear all paper-trading history and open positions? This cannot be undone.')) {
        resetPaperTrades();
        resetBtn.textContent = 'History cleared';
        resetBtn.disabled = true;
      }
    });
  }

  patchRiskCalc();
}
