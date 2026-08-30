import { state } from '../state.js';
import { upcomingEvents, daysUntil } from '../econCalendar.js';

export function render(container) {
  const events = upcomingEvents(state.engine.calendar);

  container.innerHTML = `
  <div class="fade-in">
    <div class="detail-header">
      <button class="back-btn" data-back><i class="ph-bold ph-arrow-left"></i></button>
      <div class="detail-title-block">
        <div class="detail-title">Events that move markets</div>
        <div class="detail-sub">Key recurring US releases to watch</div>
      </div>
    </div>

    <div class="guard-note">
      <i class="ph-fill ph-info"></i>
      <span>Volatility spikes around these releases, so Ajent Pulse stands aside during a volatility shock. Consider avoiding fresh entries right around them too.</span>
    </div>

    <div class="card" style="padding:2px 14px">
      ${events.map((e) => {
        const isHigh = e.impact === 'HIGH';
        const barColor = isHigh ? 'var(--sell)' : 'var(--flat)';
        const when = e.date ? daysUntil(e.date) : '8×/year';
        return `<div class="evt-row">
          <div class="evt-time"><div class="t">${e.time}</div><div class="d">${e.label}</div></div>
          <div class="evt-bar" style="background:${barColor}"></div>
          <div class="evt-body">
            <div class="evt-title">${e.title}</div>
            <div class="evt-sub">${when} · ${isHigh ? 'High' : 'Medium'} impact</div>
          </div>
          <div class="evt-impact" style="background:${isHigh ? 'var(--sell-dim)' : 'var(--flat-dim)'};color:${barColor}">${e.impact}</div>
        </div>`;
      }).join('')}
    </div>

    <p class="text-faint" style="text-align:center;font-size:11px;line-height:1.6;margin-top:14px;padding:0 8px">Illustrative reference of recurring events and their typical release times (ET) — not a live feed. Check an official economic calendar for exact dates and figures.</p>
  </div>`;
}
