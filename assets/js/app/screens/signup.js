// Passwordless sign-up → starts the 30-day free trial. Email only — NO password is
// collected or stored. The user can also skip and use the Free plan (1 market).
import { signup } from '../backendApi.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function render(container) {
  container.innerHTML = `
  <div class="fade-in onboard-wrap">
    <div class="onboard-center">
      <div class="onboard-icon" style="color:var(--accent-300);background:color-mix(in srgb, var(--accent-300) 15%, transparent)"><i class="ph-fill ph-rocket-launch"></i></div>
      <h1 class="onboard-title">Start your 30-day free trial</h1>
      <p class="onboard-body">Every market, real-time signals, alerts and export — free for 30 days. No card. No password. Just your email.</p>
      <div class="signup-form">
        <input id="su-email" class="signup-input" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@email.com" aria-label="Email address" />
        <div id="su-err" class="signup-err" role="alert"></div>
        <button id="su-go" class="btn btn-primary btn-block" style="height:50px">Start free trial</button>
      </div>
      <div class="signup-fine">Passwordless — we use your email only to run your trial and, if you subscribe later, your account. Never sold. <a href="../privacy/">Privacy</a></div>
      <button id="su-skip" class="signup-skip">Continue with the free plan (1 market)</button>
    </div>
  </div>`;

  const emailEl = container.querySelector('#su-email');
  const errEl = container.querySelector('#su-err');
  const goEl = container.querySelector('#su-go');

  const submit = async () => {
    const email = (emailEl.value || '').trim();
    errEl.textContent = '';
    if (!EMAIL_RE.test(email)) { errEl.textContent = 'Please enter a valid email address.'; emailEl.focus(); return; }
    goEl.disabled = true; goEl.textContent = 'Starting…';
    const r = await signup(email);
    if (r && r.error) { errEl.textContent = r.error; goEl.disabled = false; goEl.textContent = 'Start free trial'; return; }
    location.hash = '#/home';
  };

  goEl.addEventListener('click', submit);
  emailEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  container.querySelector('#su-skip').addEventListener('click', () => { location.hash = '#/home'; });
  setTimeout(() => { try { emailEl.focus(); } catch (e) { /* ignore */ } }, 120);
}
