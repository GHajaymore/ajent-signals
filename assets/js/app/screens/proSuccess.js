// Shown after a successful Stripe checkout + token redemption. The token is
// already stored (backendApi.redeemSession), so the app is Pro from here.
import { hasProToken } from '../backendApi.js';

export function render(container) {
  const unlocked = hasProToken();
  container.innerHTML = `
  <div class="fade-in glow-wrap" style="min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px">
    <div class="dash-glow"></div>
    <div style="width:72px;height:72px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:var(--accent-900);color:#ffca4d;font-size:34px;margin-bottom:18px">
      <i class="ph-fill ${unlocked ? 'ph-crown-simple' : 'ph-hourglass-medium'}"></i>
    </div>
    <h1 class="h-title" style="margin-bottom:8px">${unlocked ? 'You’re Ajent Pro' : 'Finishing up…'}</h1>
    <p class="text-muted" style="font-size:14px;max-width:340px;margin-bottom:22px">
      ${unlocked
        ? 'Thanks for subscribing. All markets, 24/7 signals, alerts and the signal-export API are unlocked.'
        : 'Your payment went through. If Pro isn’t active in a moment, reopen the app — your subscription will sync.'}
    </p>
    <a href="#/home" class="btn btn-primary" style="height:46px;padding:0 24px;font-size:14px;text-decoration:none;display:flex;align-items:center;justify-content:center">Go to the app</a>
    <div class="footer-note" style="margin-top:20px;max-width:340px">Educational tool — trading is on virtual money and Ajent places no orders. Manage or cancel your subscription anytime through your payment provider.</div>
  </div>`;
}
