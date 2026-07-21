import { state } from '../state.js';

const FEATURES = [
  { icon: 'ph-infinity', text: 'Unlimited real-time signals across all markets' },
  { icon: 'ph-chart-line-up', text: 'Full indicator breakdown & confluence scoring' },
  { icon: 'ph-bell-ringing', text: 'Instant push alerts for entries, stops & targets' },
  { icon: 'ph-calendar-check', text: 'Economic-calendar signal guarding' },
  { icon: 'ph-crosshair-simple', text: 'Position-size & risk calculator' },
];

export function render(container) {
  const billing = state.billing;

  container.innerHTML = `
  <div class="fade-in" style="position:relative;padding-top:6px">
    <button class="paywall-close" data-back><i class="ph-bold ph-x"></i></button>

    <div class="paywall-hero">
      <div class="paywall-crown"><i class="ph-fill ph-crown-simple"></i></div>
      <div class="paywall-title">Ajent Pro</div>
      <div class="paywall-sub">Trade the full edge, every session.</div>
    </div>

    <div class="panel" style="margin-top:18px">
      ${FEATURES.map((f) => `<div class="pw-feature"><span class="i"><i class="ph-bold ${f.icon}"></i></span>${f.text}</div>`).join('')}
    </div>

    <div class="plan-option ${billing === 'monthly' ? 'selected' : ''}" data-plan="monthly">
      <div><div class="t">Monthly</div><div class="s">Billed monthly</div></div>
      <div class="price">$39.90<div class="per">/mo</div></div>
    </div>
    <div class="plan-option ${billing === 'annual' ? 'selected' : ''}" data-plan="annual">
      <div><div class="t">Annual · 2 months free</div><div class="s">Billed $399.00 yearly ($33.25/mo)</div></div>
      <div class="price">$399.00<div class="per">/yr</div></div>
    </div>

    <button class="btn btn-primary btn-block" style="height:52px;font-size:15px;margin-top:8px">Start 7-day free trial</button>
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:12px">Auto-renews · cancel anytime · Terms apply</p>
  </div>`;

  container.querySelectorAll('.plan-option').forEach((el) => {
    el.addEventListener('click', () => {
      state.billing = el.dataset.plan;
      render(container);
    });
  });
}
