import { state, saveSettings, perTradeRisk, planConfigFor, setPlanConfig, activeStyleLabel, maxStopUsd } from '../state.js';
import { fmtMoney } from '../format.js';
import { resetPaperTrades } from '../paperTrading.js';
import { wireSignalExport, signalExportHtml } from './signalExport.js';
import { isPaid, trialDaysLeft, fetchDayExperiment } from '../backendApi.js';
import { isStandalone, isIOS, installAvailable, promptInstall } from '../install.js';
import { pushSupported, pushPermission, enablePush, disablePush } from '../pushClient.js';
import { isEntitled } from '../backendApi.js';

// Trading styles (industry-standard, by holding period). 'swing' is live and
// validated; 'day' is a SELECTABLE but clearly-labelled EXPERIMENT (intraday, not
// proven — an earlier intraday version lost money live, so it is tracked on its own
// real record with no advertised returns); the others are shown honestly with their
// real status so the picker never implies a capability we don't have. 'scalping'
// needs sub-minute data the free feed can't provide.
// `status`: 'live' (selectable/active/proven) | 'experiment' (selectable, unproven) | 'soon' | 'na'.
const TRADING_STYLES = [
  { key: 'scalping', name: 'Scalping', icon: 'ph-lightning', hold: 'Seconds–minutes', freq: 'dozens+/day', status: 'na',
    note: 'Needs tick / sub-minute data — the free feed only serves 15-minute bars. Possible only with a paid market-data feed.' },
  { key: 'day', name: 'Day trading', icon: 'ph-sun-horizon', hold: 'Intraday · flat by close', freq: '~2–8/day', status: 'experiment',
    note: 'Long-only intraday mean-reversion on 15-minute bars — buys an oversold flush in an intraday uptrend and is always flat by the close, so there is no overnight risk. NOT proven: an earlier intraday version lost money live, so this runs as an experiment tracked on its OWN real paper record, kept separate from Swing, with no advertised returns. Select it to watch the live record — it only graduates if that record holds up.' },
  { key: 'swing', name: 'Swing', icon: 'ph-calendar-check', hold: '~1–5 days', freq: '~1–5/week', status: 'live',
    note: 'The validated strategy running now — a long-only daily ensemble: it buys deeply oversold dips in an uptrend (mean reversion) and rides established uptrends (trend-following), holding each until its own setup completes. This is what auto-trades your paper account.' },
  { key: 'position', name: 'Position', icon: 'ph-mountains', hold: 'Weeks–months', freq: 'a few/month', status: 'soon',
    note: 'Longer-hold trend/mean-reversion for multi-week moves. Planned — not yet separately validated, so it will also arrive labelled experimental.' },
];
const STYLE_BADGE = {
  live: '<span class="style-badge live">Live</span>',
  experiment: '<span class="style-badge experiment">Experiment</span>',
  soon: '<span class="style-badge soon">In development</span>',
  na: '<span class="style-badge na">Unavailable</span>',
};
const SELECTABLE = { live: true, experiment: true };
function activeStyle() {
  const s = state.settings.tradingStyle || 'swing';
  // Only selectable styles can actually be active; anything else falls back to swing.
  return TRADING_STYLES.some((x) => x.key === s && SELECTABLE[x.status]) ? s : 'swing';
}
function styleRow(s) {
  const active = s.key === activeStyle();
  const selectable = !!SELECTABLE[s.status];
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

// The Day-trading EXPERIMENT panel. Shown only while the experiment style is
// selected. It surfaces the experiment's OWN live paper record (never a backtest
// headline, never an advertised return) plus the current intraday watch, wrapped in
// an unmissable "experimental / not proven" frame. Populated async from GET /day.
function dayExperimentPanel() {
  return `<div class="panel setting-block" id="day-exp" style="border:1px solid var(--accent-900)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <i class="ph-fill ph-sun-horizon" style="font-size:20px;color:var(--accent-300)"></i>
      <span class="panel-title" style="margin:0">Day trading</span>
      <span class="style-badge experiment">Experiment</span>
    </div>
    <div class="setting-help" style="margin:0 0 12px;padding:9px 11px;border-radius:9px;background:color-mix(in srgb, var(--flat) 12%, transparent);border:1px solid color-mix(in srgb, var(--flat) 30%, transparent);color:var(--text)">
      <b>Not proven.</b> Intraday mean-reversion on 15-minute bars, long-only, flat by the close. An earlier intraday version lost money live, so this runs as an experiment on its own real paper record — separate from your Swing account. The figures below are that <b>live record</b>, not a backtest and not a promise. No returns are advertised.
    </div>
    <div id="day-exp-body"><div class="setting-help" style="margin:0">Loading the live record…</div></div>
  </div>`;
}

function dayStat(label, value, color) {
  return `<div class="risk-result-cell"><div class="v" style="${color ? `color:${color}` : ''}">${value}</div><div class="k">${label}</div></div>`;
}

async function wireDayExperiment(container) {
  const body = container.querySelector('#day-exp-body');
  if (!body) return;
  let data = null;
  try { data = await fetchDayExperiment(); } catch (e) { /* handled below */ }
  if (!data) {
    body.innerHTML = `<div class="setting-help" style="margin:0">The live experiment record isn't reachable right now (it runs on the server). It'll appear here once connected — nothing is fabricated in the meantime.</div>`;
    return;
  }
  const s = data.summary || { trades: 0, winRate: 0, totalPnl: 0, profitFactor: 0 };
  const open = Array.isArray(data.open) ? data.open : [];
  const closed = Array.isArray(data.closed) ? data.closed : [];
  const signals = Array.isArray(data.signals) ? data.signals : [];
  const pnlColor = s.totalPnl > 0 ? 'var(--buy)' : s.totalPnl < 0 ? 'var(--sell)' : 'var(--text)';
  const recordHtml = s.trades > 0
    ? `<div class="risk-result-grid" style="grid-template-columns:repeat(3,1fr)">
        ${dayStat('closed trades', s.trades)}
        ${dayStat('win rate', `${s.winRate}%`)}
        ${dayStat('net P&L (paper)', fmtMoney(s.totalPnl), pnlColor)}
      </div>
      <div class="setting-help" style="margin-top:6px">Live paper result to date${s.profitFactor != null ? ` · profit factor ${s.profitFactor}` : ''}. Provisional — a short, real record, not a guarantee.</div>`
    : `<div class="setting-help" style="margin:0"><b style="color:var(--text)">No closed trades yet.</b> The experiment only opens when a genuine intraday setup fires on ES, NQ or YM during the session — nothing is invented to fill the record.</div>`;

  const watchHtml = signals.length
    ? `<div class="eyebrow" style="margin:16px 0 6px">Intraday watch (15-min)</div>` + signals.map((m) => {
        const v = m.verdict === 'BUY' ? '<span style="color:var(--buy);font-weight:600">BUY</span>' : `<span class="text-muted">watching${typeof m.proximity === 'number' ? ` · ${m.proximity}%` : ''}</span>`;
        const held = open.find((p) => p.symbol === m.symbol);
        return `<div class="notif-row" style="padding:8px 0"><div class="notif-label" style="flex:1">${m.name}${held ? ' <span style="color:var(--accent-200);font-size:11px">· in a trade</span>' : ''}</div><div>${v}</div></div>`;
      }).join('')
    : '';

  const closedHtml = closed.length
    ? `<div class="eyebrow" style="margin:16px 0 6px">Recent closes</div>` + closed.slice(0, 5).map((t) => {
        const c = (t.pnl || 0) > 0 ? 'var(--buy)' : (t.pnl || 0) < 0 ? 'var(--sell)' : 'var(--text)';
        return `<div class="notif-row" style="padding:7px 0"><div class="notif-label" style="flex:1">${t.name} <span class="text-muted" style="font-size:11px">· ${t.exitReason || 'closed'}</span></div><div style="color:${c};font-weight:600">${fmtMoney(t.pnl || 0)}</div></div>`;
      }).join('')
    : '';

  body.innerHTML = recordHtml + watchHtml + closedHtml;
}

// Trade-plan profile — the user's preferred stop distance and reward:risk for the
// SUGGESTED plan shown on a signal. The app's own book-profit / stop suggestion is
// indicator-driven (RSI2), separate from this; the tracked record uses 2× ATR.
const STOP_RANGE = { atr: { min: 1, max: 4, step: 0.5, unit: '× vol', dflt: 2 }, pct: { min: 0.25, max: 5, step: 0.25, unit: '%', dflt: 1.5 } };
function stopValLabel(cfg) {
  return cfg.stopMode === 'pct' ? `${cfg.stopValue}%` : `${cfg.stopValue}× volatility`;
}
function tradePlanPanel() {
  const cfg = planConfigFor();
  const r = STOP_RANGE[cfg.stopMode] || STOP_RANGE.atr;
  const sv = Math.min(r.max, Math.max(r.min, cfg.stopValue));
  return `<div class="panel setting-block">
    <div class="panel-title" style="margin-bottom:4px">Trade-plan profile <span style="font-weight:400;color:var(--text-muted);font-size:12px">· ${activeStyleLabel()}</span></div>
    <div class="setting-help" style="margin:0 0 12px">Your preferred stop and reward:risk for the plan shown on a signal. The app's own "book profit / stop now" call is driven by the strategy's indicators; this just frames the levels you'd trade. The 24/7 tracked record uses the strategy's own validated stop and exit.</div>
    <div class="eyebrow" style="margin-bottom:6px">Stop loss</div>
    <div class="seg-toggle" id="stop-mode">
      <button class="seg-opt ${cfg.stopMode === 'atr' ? 'on' : ''}" data-stopmode="atr">Volatility</button>
      <button class="seg-opt ${cfg.stopMode === 'pct' ? 'on' : ''}" data-stopmode="pct">Percent</button>
    </div>
    <div class="setting-row-top" style="margin-top:12px"><span class="t">Stop distance</span><span class="v" id="stop-val">${stopValLabel(cfg)}</span></div>
    <input id="stop-range" class="range" type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${sv}">
    <div class="eyebrow" style="margin:16px 0 6px">Reward : risk (gain : loss)</div>
    <div class="setting-row-top"><span class="t">Reference target vs the stop</span><span class="v" id="rr-val">${cfg.rr}:1</span></div>
    <input id="rr-range" class="range" type="range" min="0.5" max="3" step="0.25" value="${cfg.rr}">
    <div class="setting-help" style="margin-top:8px">Lower = smaller targets hit more often; higher = bigger targets, hit less often. The 1:1 mark is a reference — the strategy's real exit is the mean-reversion, not a fixed target. Position size is set by your risk-per-trade below.</div>
    <div class="eyebrow" style="margin:18px 0 6px">Max risk per contract <span style="font-weight:400;color:var(--text-muted);font-size:11px;text-transform:none;letter-spacing:0">· futures</span></div>
    <div class="setting-row-top"><span class="t">Cap one contract's dollar risk</span><span class="v" id="maxstop-val">${maxStopUsd() ? '$' + maxStopUsd().toLocaleString('en-US') : 'Off'}</span></div>
    <input id="maxstop-range" class="range" type="range" min="0" max="12000" step="500" value="${maxStopUsd()}">
    <div class="setting-help" style="margin-top:8px"><b>Off</b> = use the signal's full volatility stop. Set a cap and any wider stop is tightened so one contract risks no more than this — the reference target moves in with it. A tighter-than-volatility stop can get hit more often, and the 24/7 tracked record still runs the strategy's own validated stop.</div>
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
      <div class="setting-help" style="margin-top:12px"><b style="color:var(--text)">Swing</b> is the only decade-validated style (long-only daily mean-reversion) — it auto-trades your paper account. <b style="color:var(--text)">Day trading</b> is a selectable but unproven <b style="color:var(--accent-200)">experiment</b>, tracked on its own separate record with no advertised returns. Position is planned; Scalping needs a paid sub-minute feed. <a href="#/methodology">How it works →</a></div>
    </div>

    ${activeStyle() === 'day' ? dayExperimentPanel() : ''}

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
        <div class="notif-label" style="flex:1">Scale up on high-conviction<div class="setting-help" style="margin-top:2px">Risk 1.5&times; on the deepest-oversold setups. Backtested to lift return-per-risk &mdash; but it deepens drawdowns too. Double-edged, so it&rsquo;s off by default.</div></div>
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

    <div class="footer-note">Ajent Signals is an educational tool and does not execute trades.<br>Markets tagged REAL compute indicators from a free public price feed (unofficial, best-effort, delayed). Markets without a live feed show no signal and are hidden — never a fabricated one · v1.0.0<br><a href="../privacy/">Privacy</a> · <a href="../terms/">Terms</a> · <a href="#/methodology">How it works</a></div>
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
      if (!def || !SELECTABLE[def.status]) {
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

  const maxStopRange = document.getElementById('maxstop-range');
  if (maxStopRange) maxStopRange.addEventListener('input', () => {
    const v = Number(maxStopRange.value) || 0;
    state.settings.maxStopUsd = v;
    saveSettings();
    document.getElementById('maxstop-val').textContent = v ? `$${v.toLocaleString('en-US')}` : 'Off';
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
  // Day-trading experiment: populate its live record when that style is selected.
  if (activeStyle() === 'day') wireDayExperiment(container);
}
