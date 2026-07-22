import { state } from '../state.js';
import { isNative, isPro, purchase, restore, priceString, hasTrial } from '../iap.js';

const FEATURES = [
  { icon: 'ph-infinity', text: 'Unlimited real-time signals across all markets' },
  { icon: 'ph-chart-line-up', text: 'Full indicator breakdown & confluence scoring' },
  { icon: 'ph-bell-ringing', text: 'Instant push alerts for entries, stops & targets' },
  { icon: 'ph-calendar-check', text: 'Economic-calendar signal guarding' },
  { icon: 'ph-crosshair-simple', text: 'Position-size & risk calculator' },
];

function ctaLabel(billing) {
  // Use real StoreKit data when running natively; fall back to static copy on web.
  if (isNative()) {
    const price = priceString(billing);
    if (hasTrial(billing)) return 'Start 7-day free trial';
    if (price) return `Subscribe · ${price}${billing === 'annual' ? '/yr' : '/mo'}`;
    return 'Subscribe';
  }
  return 'Start 7-day free trial';
}

export function render(container) {
  const billing = state.billing;

  if (isPro()) {
    container.innerHTML = `
    <div class="fade-in" style="position:relative;padding-top:6px">
      <button class="paywall-close" data-back><i class="ph-bold ph-x"></i></button>
      <div class="paywall-hero">
        <div class="paywall-crown"><i class="ph-fill ph-crown-simple"></i></div>
        <div class="paywall-title">You're on Ajent Pro</div>
        <div class="paywall-sub">Every signal, alert and tool is unlocked. Thank you.</div>
      </div>
      <div class="panel" style="margin-top:18px">
        ${FEATURES.map((f) => `<div class="pw-feature"><span class="i"><i class="ph-bold ${f.icon}"></i></span>${f.text}</div>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" style="height:52px;font-size:15px;margin-top:8px" data-back>Back to signals</button>
    </div>`;
    wireNav(container);
    return;
  }

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

    <button class="btn btn-primary btn-block" id="pw-cta" style="height:52px;font-size:15px;margin-top:8px">${ctaLabel(billing)}</button>
    <button class="btn btn-ghost btn-block" id="pw-restore" style="height:44px;font-size:13px;margin-top:8px">Restore purchases</button>
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:12px">Auto-renews · cancel anytime · Terms apply</p>
    ${isNative() ? '' : '<p class="text-faint" style="text-align:center;font-size:11px;margin-top:4px">Subscriptions are available in the App Store version.</p>'}
  </div>`;

  container.querySelectorAll('.plan-option').forEach((el) => {
    el.addEventListener('click', () => {
      state.billing = el.dataset.plan;
      render(container);
    });
  });

  const cta = container.querySelector('#pw-cta');
  if (cta) {
    cta.addEventListener('click', async () => {
      if (!isNative()) return; // web demo: no purchase
      cta.disabled = true;
      const prev = cta.textContent;
      cta.textContent = 'Processing…';
      const res = await purchase(state.billing);
      if (isPro()) { render(container); return; }
      cta.disabled = false;
      cta.textContent = prev;
      if (!res.ok && res.reason && res.reason !== 'cancelled') {
        alert('Purchase could not be completed. Please try again.');
      }
    });
  }

  const rst = container.querySelector('#pw-restore');
  if (rst) {
    rst.addEventListener('click', async () => {
      if (!isNative()) return;
      rst.disabled = true;
      rst.textContent = 'Restoring…';
      await restore();
      if (isPro()) { render(container); return; }
      rst.disabled = false;
      rst.textContent = 'Restore purchases';
      alert('No previous Ajent Pro subscription was found on this Apple ID.');
    });
  }

  wireNav(container);
}

function wireNav(container) {
  container.querySelectorAll('[data-back]').forEach((el) => {
    if (el.dataset.navWired) return;
    el.dataset.navWired = '1';
    el.addEventListener('click', () => { history.back(); });
  });
}
