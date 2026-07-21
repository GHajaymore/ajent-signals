import { state } from '../state.js';
import { fmtAgo } from '../format.js';

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

  container.innerHTML = `
  <div class="fade-in">
    <h1 class="h-title">Alerts</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 18px">Real-time signal &amp; market notifications.</p>

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
  </div>`;
}
