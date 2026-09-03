import { state, saveSettings, perTradeRisk, planConfigFor, setPlanConfig, activeStyleLabel } from '../state.js';
import { fmtMoney } from '../format.js';
import { resetPaperTrades } from '../paperTrading.js';
import { wireSignalExport, signalExportHtml } from './signalExport.js';
import { isPaid, trialDaysLeft } from '../backendApi.js';
import { isStandalone, isIOS, installAvailable, promptInstall } from '../install.js';
import { pushSupported, pushPermission, enablePush, disablePush } from '../pushClient.js';
import { isEntitled } from '../backendApi.js';

// Trading styles (industry-standard, by holding period). Only 'swing' is live and
// validated; the others are shown honestly with their real status so the picker
// never implies a capability we don't have. 'day'/'position' are being built as
// clearly-labelled experiments; 'scalping' needs sub-minute data the free feed
// can't provide. `status`: 'live' (selectable/active) | 'soon' | 'na'.
const TRADING_STYLES = [
  { key: 'scalping', name: 'Scalping', icon: 'ph-lightning', hold: 'Seconds–minutes', freq: 'dozens+/day', status: 'na',
    note: 'Needs tick / sub-minute data — the free feed only serves 15-minute bars. Possible only with a paid market-data feed.' },
  { key: 'day', name: 'Day trading', icon: 'ph-sun-horizon', hold: 'Intraday · flat by close', freq: '~5–50/day', status: 'soon',
    note: 'Intraday mean reversion on 15-minute bars, no overnight risk. In development — an earlier version lost money live, so it will ship as a clearly-labelled experiment tracked on a real record, never with advertised returns.' },
  { key: 'swing', name: 'Swing', icon: 'ph-calendar-check', hold: '~1–5 days', freq: '~1–5/week', status: 'live',
    note: 'The validated strategy running now — daily Connors RSI-2, long-only. Buys deeply oversold dips in an uptrend, holds until RSI2 recovers. This is what auto-trades your paper account.' },
  { key: 'position', name: 'Position', icon: 'ph-mountains', hold: 'Weeks–months', freq: 'a few/month', status: 'soon',
    note: 'Longer-hold trend/mean-reversion for multi-week moves. Planned — not yet separately validated, so it will also arrive labelled experimental.' },
];
const STYLE_BADGE = {
  live: '<span class="style-badge live">Live</span>',
  soon: '<span class="style-badge soon">In development</span>',
  na: '<span class="style-badge na">Unavailable</span>',
};
function activeStyle() {
  const s = state.settings.tradingStyle || 'swing';
  // Only 'live' styles can actually be active; anything else falls back to swing.
  return TRADING_STYLES.some((x) => x.key === s && x.status === 'live') ? s : 'swing';
}
function styleRow(s) {
  const active = s.key === activeStyle();
  const selectable = s.status === 'live';
  return `<button class="style-row${active ? ' active' : ''}${selectable ? '' : ' locked'}" data-style="${s.key}" ${selectable ? '' : 'aria-disabled="true"'}>
    <i class="ph-fill ${s.icon} style-ico"></i>
    <div class="style-body">
      <div class="style-name">${s.name}${active ? ' <span class="style-active-tag">Active</span>' : ''} ${STYLE_BADGE[s.status]}</div>
      <div class="style-meta">${s.hold} · ${s.freq}</div>
      <div class="style-note">${s.note}</div>
    </div>
    ${selectable ? `<span class="style-check">${active ? '<i class="ph-bold ph-check-circle"></i>' : ''}</span>` : '<i class="ph-bold ph-lock-simple style-lock"></i>'}
  </button>`;
}

// Trade-plan profile — the user's preferred stop distance and reward:risk for the
// SUGGESTED plan shown on a signal. The app's own book-profit / stop suggestion is
// indicator-driven (RSI2), separate from this; the tracked record uses 2× ATR.
const STOP_RANGE = { atr: { min: 1, max: 4, step: 0.5, unit: '× ATR', dflt: 2 }, pct: { min: 0.25, max: 5, step: 0.25, unit: '%', dflt: 1.5 } };
function stopValLabel(cfg) {
  const r = STOP_RANGE[cfg.stopMode] || STOP_RANGE.atr;
  return cfg.stopMode === 'pct' ? `${cfg.stopValue}%` : `${cfg.stopValue}× ATR`;
}
function tradePlanPanel() {
  const cfg = planConfigFor();
  const r = STOP_RANGE[cfg.stopMode] || STOP_RANGE.atr;
  const sv = Math.min(r.max, Math.max(r.min, cfg.stopValue));
  return `<div class="panel setting-block">
    <div class="panel-title" style="margin-bottom:4px">Trade-plan profile <span style="font-weight:400;color:var(--text-muted);font-size:12px">· ${activeStyleLabel()}</span></div>
    <div class="setting-help" style="margin:0 0 12px">Your preferred stop and reward:risk for the plan shown on a signal. The app's own "book profit / stop now" call is driven by the indicators (RSI2); this just frames the levels you'd trade. The 24/7 tracked record uses the validated 2× ATR stop + RSI2 exit.</div>
    <div class="eyebrow" style="margin-bottom:6px">Stop loss</div>
    <div class="seg-toggle" id="stop-mode">
      <button class="seg-opt ${cfg.stopMode === 'atr' ? 'on' : ''}" data-stopmode="atr">ATR ×</button>
      <button class="seg-opt ${cfg.stopMode === 'pct' ? 'on' : ''}" data-stopmode="pct">Percent</button>
    </div>
    <div class="setting-row-top" style="margin-top:12px"><span class="t">Stop distance</span><span class="v" id="stop-val">${stopValLabel(cfg)}</span></div>
    <input id="stop-range" class="range" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${sv}">
    <div class="eyebrow" style="margin:16px 0 6px">Reward : risk (gain : loss)</div>
    <div class="setting-row-top"><span class="t">Reference target vs the stop</span><span class="v" id="rr-val">${cfg.rr}:1</span></div>
    <input id="rr-range" class="range" type="range" min="0.5" max="3" step="0.25" value="${cfg.rr}">
    <div class="setting-help" style="margin-top:8px">Lower = smaller targets hit more often; higher = bigger targets, hit less often. The 1:1 mark is a reference — the strategy's real exit is the RSI2 recovery, not a fixed target. Position size is set by your risk-per-trade below.</div>
  </div>`;
}

// Push signal alerts — a Pro/trial perk. Get a notification when a BUY/SELL fires,
// even with the app closed.
function pushCardHtml() {
  if (!pushSupported()) return '';
  if (!isEntitled()) {
    return `<div class="panel setting-block" data-nav="#/paywall" style="display:flex;align-items:center;gap:12px;cursor:pointer">
      <i class="ph-fill ph-bell-ringing" style="font-size:22px;color:var(--accent-300);flex:none"></i>
      <div style="flex:1"><div style="font:600 13.5px var(--font-heading)">Push signal alerts</div><div class="text-muted" style="font-size:12px">Get pinged when a setup fires — <span style="color:var(--accent-200)">Pro</span></div></div>
      <span class="chip-upgrade">Go Pro</span></div>`;
  }
  const denied = pushPermission() === 'denied';
  return `<div class="panel setting-block" style="display:flex;align-items:center;gap:12px">
    <i class="ph-fill ph-bell-ringing" style="font-size:22px;color:var(--accent-300);flex:none"></i>
    <div style="flex:1;min-width:0"><div style="font:600 13.5px var(--font-heading)">Push signal alerts</div><div class="text-muted" style="font-size:12px;line-height:1.45" id="push-sub">${denied ? 'Blocked in your browser settings — re-allow notifications to enable.' : 'A notification the moment a BUY/SELL fires — even with the app closed.'}</div></div>
    ${denied ? '' : `<button class="btn btn-ghost" id="push-btn" style="height:34px;padding:0 16px;font-size:13px;flex:none">Enable</button>`}
  </div>`;
}

// One-tap install (or iOS/desktop instructions). Hidden once running as an app.
function installCardHtml() {
  if (isStandalone()) return '';
  const ios = isIOS();
  const sub = ios ? 'Tap the Share icon, then “Add to Home Screen”.'
    : installAvailable() ? 'One tap — get the app on your home screen for instant access.'
    : 'In your browser menu, choose “Install app” / “Add to Home Screen”.';
  return `<div class="panel setting-block" style="display:flex;align-items:center;gap:12px">
    <i class="ph-fill ph-device-mobile-camera" style="font-size:22px;color:var(--accent-300);flex:none"></i>
    <div style="flex:1;min-width:0"><div style="font:600 13.5px var(--font-heading)">Install Ajent Signals</div><div class="text-muted" style="font-size:12px;line-height:1.45">${sub}</div></div>
    ${!ios && installAvailable() ? `<button class="btn btn-ghost" id="install-btn" style="height:34px;padding:0 16px;font-size:13px;flex:none">Install</button>` : ''}
  </div>`;
}

// Plan status card — reflects trial countdown / Pro / post-trial Free.
function planCard() {
  if (isPaid()) {
    return `<div class="pro-card" data-nav="#/paywall">
      <div class="pro-icon"><i class="ph-fill ph-crown-simple"></i></div>
      <div class="pro-body"><div class="pro-title">Ajent Pro</div><div class="pro-sub">All markets · real-time · alerts · export</div></div>
      <span class="chip-upgrade">Manage</span></div>`;
  }
  const days = trialDaysLeft();
  if (days > 0) {
    return `<div class="pro-card" data-nav="#/paywall">
      <div class="pro-icon"><i class="ph-fill ph-crown-simple"></i></div>
      <div class="pro-body"><div class="pro-title">Free trial · ${days} day${days === 1 ? '' : 's'} left</div><div class="pro-sub">Everything unlocked — real-time, all markets, alerts, export</div></div>
      <span class="chip-upgrade">Go Pro</span></div>`;
  }
  return `<div class="pro-card" data-nav="#/paywall">
    <div class="pro-icon"><i class="ph-fill ph-crown-simple"></i></div>
    <div class="pro-body"><div class="pro-title">Free plan</div><div class="pro-sub">1 market · delayed signals — Go Pro for real-time &amp; all markets</div></div>
    <span class="chip-upgrade">Upgrade</span></div>`;
}

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
  // NO_TRADE / no-data markets have no plan — estimate risk from a ~2xATR stop
  // (the strategy's own stop distance) so the position-size calculator still works.
  const plan = market.signal && market.signal.plan;
  const atr = market.atr || market.price * 0.01;
  const entry = plan ? plan.entry : market.price;
  const stop = plan ? plan.stop : market.price - 2 * atr;
  const riskPerContract = (Math.abs(entry - stop) || atr) * market.pointValue;
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

    ${planCard()}

    ${pushCardHtml()}

    ${installCardHtml()}

    <div class="panel setting-block">
      <div class="panel-title" style="margin-bottom:4px">Trading style</div>
      <div class="setting-help" style="margin:0 0 12px">Pick how you like to trade. Only styles we can run honestly on real, validated data are selectable — the rest show why not.</div>
      <div class="style-list">${TRADING_STYLES.map(styleRow).join('')}</div>
      <div class="setting-help" style="margin-top:12px">You're trading <b style="color:var(--text)">Swing</b> — the only decade-validated style (daily Connors RSI-2, long-only: PF ~1.6, ~74% win). Day trading &amp; Position are in development and will arrive labelled experimental with a real tracked record; Scalping needs a paid sub-minute data feed. <a href="#/methodology">How it works →</a></div>
    </div>

    ${tradePlanPanel()}

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
      <div class="pro-icon" style="background:var(--buy-dim);color:var(--buy)"><i class="ph-fill ph-chart-bar"></i></div>
      <div class="pro-body">
        <div class="pro-title">How Ajent Pulse works</div>
        <div class="pro-sub">The strategy, the math, and the honest caveats</div>
      </div>
      <i class="ph-bold ph-caret-right" style="color:var(--text-muted)"></i>
    </div>

    <div class="pro-card" data-nav="#/faq" style="cursor:pointer">
      <div class="pro-icon" style="background:var(--accent-900);color:var(--accent-200)"><i class="ph-fill ph-question"></i></div>
      <div class="pro-body">
        <div class="pro-title">Straight answers</div>
        <div class="pro-sub">Does it beat VOO/QQQ? Is it real-time? The honest FAQ</div>
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

    ${signalExportHtml()}

    <div class="footer-note">Ajent Signals is an educational tool and does not execute trades.<br>Markets tagged REAL compute indicators from a free public price feed (unofficial, best-effort, delayed). Markets without a live feed show no signal and are hidden — never a fabricated one · v1.0.0</div>
  </div>`;

  const pushBtn = container.querySelector('#push-btn');
  if (pushBtn) {
    // Reflect current state, then toggle on click.
    import('../pushClient.js').then((m) => m.isPushEnabled()).then((on) => { if (on) pushBtn.textContent = 'On ✓'; }).catch(() => {});
    pushBtn.addEventListener('click', async () => {
      const sub = container.querySelector('#push-sub');
      if (pushBtn.textContent.includes('On')) {
        pushBtn.disabled = true; await disablePush(); pushBtn.disabled = false; pushBtn.textContent = 'Enable';
        if (sub) sub.textContent = 'A notification the moment a BUY/SELL fires — even with the app closed.';
        return;
      }
      pushBtn.disabled = true; pushBtn.textContent = 'Enabling…';
      const r = await enablePush();
      pushBtn.disabled = false;
      if (r.ok) { pushBtn.textContent = 'On ✓'; if (sub) sub.textContent = 'On — you’ll be notified when a setup fires.'; }
      else { pushBtn.textContent = 'Enable'; if (sub) sub.textContent = r.reason === 'denied' ? 'Notifications were blocked — allow them in your browser to enable.' : 'Could not enable right now — try again.'; }
    });
  }

  const installBtn = container.querySelector('#install-btn');
  if (installBtn) installBtn.addEventListener('click', async () => {
    installBtn.disabled = true; installBtn.textContent = 'Installing…';
    const outcome = await promptInstall();
    if (outcome !== 'accepted') { installBtn.disabled = false; installBtn.textContent = 'Install'; }
  });


  // Trading-style picker. Only 'live' styles can be activated; tapping an
  // in-development / unavailable one briefly flags why (it stays on its note).
  container.querySelectorAll('.style-row[data-style]').forEach((row) => {
    row.addEventListener('click', () => {
      const key = row.dataset.style;
      const def = TRADING_STYLES.find((s) => s.key === key);
      if (!def || def.status !== 'live') {
        row.classList.remove('nudge'); void row.offsetWidth; row.classList.add('nudge');
        return;
      }
      if (state.settings.tradingStyle === key) return;
      state.settings.tradingStyle = key;
      saveSettings();
      container.querySelector('.style-list').innerHTML = TRADING_STYLES.map(styleRow).join('');
      // re-wire the freshly-rendered rows
      render(container);
    });
  });

  // Trade-plan profile: stop mode / distance and reward:risk.
  const activeStyleKey = () => state.settings.tradingStyle || 'swing';
  container.querySelectorAll('#stop-mode .seg-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.stopmode;
      const cfg = planConfigFor();
      if (cfg.stopMode === mode) return;
      setPlanConfig(activeStyleKey(), { stopMode: mode, stopValue: (STOP_RANGE[mode] || STOP_RANGE.atr).dflt });
      render(container); // re-render so the slider range/labels match the new mode
    });
  });
  const stopRange = document.getElementById('stop-range');
  if (stopRange) stopRange.addEventListener('input', () => {
    setPlanConfig(activeStyleKey(), { stopValue: Number(stopRange.value) });
    document.getElementById('stop-val').textContent = stopValLabel(planConfigFor());
  });
  const rrRange = document.getElementById('rr-range');
  if (rrRange) rrRange.addEventListener('input', () => {
    setPlanConfig(activeStyleKey(), { rr: Number(rrRange.value) });
    document.getElementById('rr-val').textContent = `${rrRange.value}:1`;
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
  // Signal export API (Pro) — async: loads webhooks from the backend when connected.
  wireSignalExport(container);
}
