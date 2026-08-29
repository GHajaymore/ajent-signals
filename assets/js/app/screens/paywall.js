import { state } from '../state.js';
import { isNative, isPro, purchase, restore, priceString, hasTrial } from '../iap.js';
import { backendConfigured, startCheckout, hasProToken, checkoutAvailable } from '../backendApi.js';
import { getPerformanceSummary } from '../paperTrading.js';
import { fmtMoney } from '../format.js';

// The REAL paper-trading record — never fabricated. Let the honest track record
// make the case for Pro. Shows the user's own virtual results (or the backend's
// 24/7 record when connected); an empty/small sample is stated plainly.
function realRecordPanel() {
  const p = getPerformanceSummary();
  if (!p) {
    return `
    <div class="panel" style="margin-top:16px;padding:16px">
      <div class="eyebrow" style="margin-bottom:6px">Your paper-trading record</div>
      <div class="text-muted" style="font-size:13px;line-height:1.55">No closed paper trades yet. Ajent trades a <b>virtual</b> account for you — open the app, let it run, and judge Pro by a <b>real, unedited</b> record before you pay a cent.</div>
      <div class="text-faint" style="font-size:10.5px;line-height:1.5;margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        All performance is hypothetical and simulated on <b>virtual money</b> — Ajent places no real orders and holds no funds. Past and simulated results <b>do not guarantee</b> future performance. Educational tool, not investment advice.
      </div>
    </div>`;
  }
  const net = Math.round(p.totalPnl);
  const netCol = net >= 0 ? 'var(--buy)' : 'var(--sell)';
  const pf = p.profitFactor === Infinity ? 'all wins' : p.profitFactor.toFixed(2);
  const small = p.decisive < 20; // too few trades to imply a stable edge
  return `
    <div class="panel" style="margin-top:16px;padding:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span class="eyebrow">Your paper-trading record</span>
        <span class="text-muted" style="font-size:11px">${p.decisive} decisive trade${p.decisive === 1 ? '' : 's'}</span>
      </div>
      <div style="font:800 30px var(--font-heading);color:${netCol};letter-spacing:-1px">${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))}</div>
      <div class="text-muted" style="font-size:11.5px;margin-top:2px">net on virtual money${state.settings && state.settings.accountBalance ? ` · ${fmtMoney(state.settings.accountBalance)} account` : ''}</div>
      <div style="display:flex;gap:18px;margin-top:14px">
        <div><div style="font:800 18px var(--font-heading);color:var(--text)">${p.winRate}%</div><div class="text-muted" style="font-size:11px">win rate</div></div>
        <div><div style="font:800 18px var(--font-heading);color:var(--text)">${pf}</div><div class="text-muted" style="font-size:11px">profit factor</div></div>
        <div><div style="font:800 18px var(--font-heading);color:var(--text)">${p.wins}W / ${p.losses}L</div><div class="text-muted" style="font-size:11px">record</div></div>
      </div>
      ${small ? `<div style="font-size:11.5px;color:var(--accent-200);margin-top:12px;line-height:1.5"><i class="ph-fill ph-info" style="font-size:12px"></i> Small sample — too few trades to prove a stable edge yet. Let it keep running.</div>` : ''}
      <div class="text-faint" style="font-size:10.5px;line-height:1.5;margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        Hypothetical, simulated performance on <b>virtual money</b> — Ajent places no real orders and holds no funds. Past and simulated results <b>do not guarantee</b> future performance. Educational tool, not investment advice.
      </div>
    </div>`;
}

// The two tiers (single source of truth for the split). Enforcement is currently
// OFF for the free early-access launch — everything below is unlocked for all
// users. When subscriptions go live, gate the PRO items behind isPro().
const FREE_FEATURES = [
  { icon: 'ph-swap', text: 'Both strategies — Active (long &amp; short) &amp; Proven (daily)' },
  { icon: 'ph-target', text: 'Auto-trade <b>one</b> market at a time' },
  { icon: 'ph-notebook', text: 'The full, honest paper-trading record' },
  { icon: 'ph-book-open-text', text: 'In-app signals, breakdown &amp; methodology' },
];
const PRO_FEATURES = [
  { icon: 'ph-squares-four', text: 'Auto-trade <b>all</b> markets at once — not one at a time' },
  { icon: 'ph-globe-hemisphere-west', text: 'All 43 markets — crypto, commodities &amp; global indices' },
  { icon: 'ph-clock-countdown', text: 'Trades 24/7 — even when the app is closed' },
  { icon: 'ph-lightning', text: 'Real-time data (Free is delayed)' },
  { icon: 'ph-bell-ringing', text: 'Instant push alerts — entries, stops &amp; targets' },
  { icon: 'ph-star', text: 'High-conviction filter &amp; alerts' },
  { icon: 'ph-crosshair-simple', text: 'Position-size &amp; risk calculator' },
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

  if (isPro() || hasProToken()) {
    container.innerHTML = `
    <div class="fade-in" style="position:relative;padding-top:6px">
      <button class="paywall-close" data-back><i class="ph-bold ph-x"></i></button>
      <div class="paywall-hero">
        <div class="paywall-crown"><i class="ph-fill ph-crown-simple"></i></div>
        <div class="paywall-title">You're on Ajent Pro</div>
        <div class="paywall-sub">Every signal, alert and tool is unlocked. Thank you.</div>
      </div>
      <div class="panel" style="margin-top:18px">
        ${PRO_FEATURES.map((f) => `<div class="pw-feature"><span class="i"><i class="ph-bold ${f.icon}"></i></span>${f.text}</div>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" style="height:52px;font-size:15px;margin-top:8px" data-back>Back to signals</button>
    </div>`;
    wireNav(container);
    return;
  }

  // Payments are "live" only when there's a real purchase path: the native
  // StoreKit build, or the web build with the backend (Stripe) connected. Until
  // then Pro isn't buyable, so the CTA collects waitlist interest instead of
  // dead-ending on the market cap.
  const canBuy = isNative() || checkoutAvailable();

  container.innerHTML = `
  <div class="fade-in" style="position:relative;padding-top:6px">
    <button class="paywall-close" data-back><i class="ph-bold ph-x"></i></button>

    <div class="paywall-hero">
      <div class="paywall-crown"><i class="ph-fill ph-crown-simple"></i></div>
      <div class="paywall-title">Free &amp; Pro</div>
      <div class="paywall-sub">See the real record first. Then decide.</div>
    </div>

    ${realRecordPanel()}

    <div style="background:var(--buy-dim);border:1px solid color-mix(in srgb,var(--buy) 30%,transparent);border-radius:12px;padding:11px 14px;margin-top:16px;font-size:12.5px;line-height:1.5;color:var(--buy)">
      ${canBuy
        ? '<b>Free stays free.</b> <span style="color:var(--text)">Pro adds the extras below — no card for Free, ever.</span>'
        : '<b>Pro isn’t open yet.</b> <span style="color:var(--text)">Free is fully usable now (one market at a time). Join the waitlist and we’ll email you the moment Pro launches — pricing below is a preview.</span>'}
    </div>

    <div class="panel" style="margin-top:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font:700 14px var(--font-heading)">Free</span>
        <span style="font-size:11px;color:var(--text-muted);background:var(--neutral-900);padding:3px 9px;border-radius:20px">no card, ever</span>
      </div>
      ${FREE_FEATURES.map((f) => `<div class="pw-feature"><span class="i" style="background:var(--buy-dim);color:var(--buy)"><i class="ph-bold ${f.icon}"></i></span>${f.text}</div>`).join('')}
    </div>

    <div class="panel" style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font:700 14px var(--font-heading);color:var(--accent-200)"><i class="ph-fill ph-crown-simple" style="font-size:13px;margin-right:4px"></i>Pro adds</span>
        <span style="font-size:11px;color:var(--text-muted)">everything in Free, plus&hellip;</span>
      </div>
      ${PRO_FEATURES.map((f) => `<div class="pw-feature"><span class="i"><i class="ph-bold ${f.icon}"></i></span>${f.text}</div>`).join('')}
    </div>

    <div class="plan-option ${billing === 'monthly' ? 'selected' : ''}" data-plan="monthly">
      <div><div class="t">Monthly</div><div class="s">Billed monthly</div></div>
      <div class="price">$39.90<div class="per">/mo</div></div>
    </div>
    <div class="plan-option ${billing === 'annual' ? 'selected' : ''}" data-plan="annual">
      <div><div class="t">Annual · 2 months free</div><div class="s">Billed $399.00 yearly ($33.25/mo)</div></div>
      <div class="price">$399.00<div class="per">/yr</div></div>
    </div>

    <button class="btn btn-primary btn-block" id="pw-cta" style="height:52px;font-size:15px;margin-top:8px">${canBuy ? ctaLabel(billing) : 'Join the waitlist'}</button>
    ${canBuy && isNative() ? '<button class="btn btn-ghost btn-block" id="pw-restore" style="height:44px;font-size:13px;margin-top:8px">Restore purchases</button>' : ''}
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:12px">${canBuy ? 'Auto-renews · cancel anytime · Terms apply' : 'No card needed to join the list · we’ll only email about Ajent Pro'}</p>
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
      // Native: StoreKit purchase.
      if (isNative()) {
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
        return;
      }
      // Web: Stripe Checkout, once a real purchase path exists (Stripe configured).
      if (checkoutAvailable()) {
        cta.disabled = true;
        const prev = cta.textContent;
        cta.textContent = 'Redirecting to checkout…';
        const appUrl = location.origin + location.pathname; // /app/ base (no hash)
        const r = await startCheckout(state.billing, { successUrl: appUrl, cancelUrl: appUrl + '#/paywall' });
        if (r && r.url) { location.href = r.url; return; }
        // Checkout not actually reachable — fall back to the waitlist, never dead-end.
        location.href = '../#waitlist';
        return;
      }
      // Pre-launch (no purchase path yet): collect waitlist interest instead of
      // dead-ending. Send them to the landing page's waitlist section.
      location.href = '../#waitlist';
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
