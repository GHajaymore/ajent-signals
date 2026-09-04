import { state } from '../state.js';
import { fmtAgo } from '../format.js';
import { backendConfigured } from '../backendApi.js';
import { isRealMarket } from './markets.js';

// The markets nearest a BUY setup right now (real proximity score), so the Alerts
// tab is useful even before anything fires — it shows what may alert next. Honest:
// proximity is the server's real "how close is this market to a setup" measure.
function brewingMarkets() {
  const threshold = state.settings.threshold;
  const realOnly = backendConfigured();
  return state.engine.markets
    .filter((m) => (!realOnly || isRealMarket(m)) && m.signal && (m.signal.proximity || 0) > 0 && m.verdict(threshold) === 'NO_TRADE')
    .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0))
    .slice(0, 6);
}
function brewingRow(m) {
  const prox = Math.max(0, Math.min(100, Math.round(m.signal.proximity || 0)));
  return `<div class="closed-row" data-nav="#/signal/${m.symbol}" style="cursor:pointer">
    <div class="closed-sym">${m.symbol}</div>
    <div class="closed-body">
      <div class="closed-title">${m.name}</div>
      <div class="closed-sub">${prox}% of the way to a setup</div>
      <div style="height:5px;border-radius:3px;background:var(--neutral-900);margin-top:6px;overflow:hidden"><div style="height:100%;width:${prox}%;background:linear-gradient(90deg,var(--accent-700),var(--accent-300))"></div></div>
    </div>
  </div>`;
}

const ALERT_META = {
  BUY: { color: 'var(--buy)', dim: 'var(--buy-dim)', icon: 'ph-arrow-up-right' },
  TARGET: { color: 'var(--buy)', dim: 'var(--buy-dim)', icon: 'ph-target' },
  SELL: { color: 'var(--sell)', dim: 'var(--sell-dim)', icon: 'ph-arrow-down-right' },
  STOP: { color: 'var(--sell)', dim: 'var(--sell-dim)', icon: 'ph-hand-palm' },
  REVERSAL: { color: 'var(--flat)', dim: 'var(--flat-dim)', icon: 'ph-arrows-clockwise' },
  VOLATILITY: { color: 'var(--flat)', dim: 'var(--flat-dim)', icon: 'ph-lightning' },
  NEWS: { color: 'var(--accent-300)', dim: 'var(--accent-900)', icon: 'ph-newspaper' },
};

export function render(container) {
  const alerts = state.engine.alerts;
  const brewing = brewingMarkets();

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Alerts</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 18px">Real-time signal &amp; market notifications.</p>

    ${alerts.length === 0 ? `
    <div class="panel" style="text-align:center;padding:40px 20px">
      <i class="ph ph-bell-simple" style="font-size:32px;color:var(--text-muted)"></i>
      <div style="font:600 15px var(--font-heading);margin-top:14px">No alerts yet</div>
      <p class="text-muted" style="font-size:13px;line-height:1.6;margin-top:8px;max-width:40ch;margin-left:auto;margin-right:auto">You'll be notified here the moment a market fires a BUY, or when one of your paper trades closes on the bounce, its stop, or its time exit.</p>
    </div>` : ''}
    ${alerts.map((a) => {
      const meta = ALERT_META[a.type] || ALERT_META.NEWS;
      const secAgo = (Date.now() - a.ts) / 1000;
      return `<div class="alert-card" style="border-left-color:${meta.color}">
        <div class="alert-tile" style="background:${meta.dim};color:${meta.color}"><i class="ph-fill ${meta.icon}"></i></div>
        <div class="alert-body">
          <div class="alert-top"><span class="alert-title">${a.title}</span><span class="alert-time">${fmtAgo(secAgo)}</span></div>
          <div class="alert-text">${a.body}</div>
        </div>
      </div>`;
    }).join('')}

    ${brewing.length ? `
    <div class="section-label" style="margin-top:22px">Closest to firing<a data-nav="#/markets">All markets &rsaquo;</a></div>
    <div class="sub-hint">No alert yet — these markets are nearest a BUY setup. You'll be notified the moment one triggers.</div>
    <div class="card" style="padding:2px 12px">${brewing.map(brewingRow).join('')}</div>
    <div class="text-faint" style="font-size:11px;text-align:center;margin-top:10px">Get pushed the instant a setup fires — turn on alerts in <a data-nav="#/settings" style="color:var(--accent-300)">Settings</a>.</div>
    ` : ''}
  </div>`;
}
