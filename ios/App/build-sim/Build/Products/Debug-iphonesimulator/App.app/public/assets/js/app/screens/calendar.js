import { state } from '../state.js';

export function render(container) {
  const events = state.engine.calendar;

  container.innerHTML = `
  <div class="fade-in">
    <div class="detail-header">
      <button class="back-btn" data-back><i class="ph-bold ph-arrow-left"></i></button>
      <div class="detail-title-block">
        <div class="detail-title">Economic calendar</div>
        <div class="detail-sub">High-impact US events</div>
      </div>
    </div>

    <div class="guard-note">
      <i class="ph-fill ph-shield-check"></i>
      <span>New signals are paused 15 min around high-impact releases unless you enable them in Settings.</span>
    </div>

    <div class="card" style="padding:2px 14px">
      ${events.map((e) => {
        const isHigh = e.impact === 'HIGH';
        const barColor = isHigh ? 'var(--sell)' : 'var(--flat)';
        return `<div class="evt-row">
          <div class="evt-time"><div class="t">${e.time}</div><div class="d">${e.day}</div></div>
          <div class="evt-bar" style="background:${barColor}"></div>
          <div class="evt-body">
            <div class="evt-title">${e.title}</div>
            <div class="evt-sub">Fcst ${e.forecast} · Prev ${e.previous}</div>
          </div>
          <div class="evt-impact" style="background:${isHigh ? 'var(--sell-dim)' : 'var(--flat-dim)'};color:${barColor}">${e.impact}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}
