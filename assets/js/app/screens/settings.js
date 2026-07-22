import { state, saveSettings, perTradeRisk } from '../state.js';
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
  const { threshold, riskPct, accountBalance, notifications } = state.settings;
  const market = state.engine.get(state.selectedSymbol);
  const { contracts, riskPerContract } = computeRisk(market, accountBalance, riskPct);

  container.innerHTML = `
  <div class="fade-in">
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
