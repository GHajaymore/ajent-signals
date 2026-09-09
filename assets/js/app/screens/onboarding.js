import { completeOnboarding } from '../state.js';
import { isSignedUp, trialActive, isPaid } from '../backendApi.js';

const SLIDES = [
  {
    icon: 'ph-chart-bar', color: 'var(--buy)',
    title: 'Welcome to Ajent Signals',
    body: 'Educational trading signals across global markets — stock-index futures, sector ETFs, FX, commodities, crypto, and a large-cap stock screener. Virtual money only, no broker, no real funds ever.',
  },
  {
    icon: 'ph-trend-up', color: 'var(--accent-300)',
    title: 'Meet Ajent Pulse',
    body: 'A proven ensemble of edges — it fades oversold dips and rides established trends, <b>long-only where markets drift up, both ways where they don’t</b> (FX, commodities) — with the discipline seasoned traders live by, and it keeps learning from its own real record.',
  },
  {
    icon: 'ph-shield-check', color: 'var(--buy)',
    title: 'Honest by design',
    body: 'A high win rate is <b>not</b> the same as profit. We show the real, unedited paper-trading record — profit factor, expectancy, drawdown — and never fabricate a number.',
  },
  {
    icon: 'ph-flask', color: 'var(--accent-200)',
    title: 'Learn by paper trading',
    body: 'Ajent auto-trades its own signals with virtual money so you can see how they actually perform. Choose your markets, risk and reward:risk any time in Settings.',
  },
  {
    icon: 'ph-flag-checkered', color: 'var(--flat)',
    title: 'Bring your best',
    body: 'Here’s the challenge: take every signal your own way — or build your own strategy — and go head-to-head against Ajent on a live record. If you can beat it, keep your edge. If you can’t, you’ll know exactly why it’s worth it. Free to start, no card.',
    cta: 'Get started',
  },
];

let step = 0;

// After the walkthrough, offer sign-up (starts the trial) — unless the user already
// has a trial/Pro (e.g. grandfathered from the old auto-trial), then go straight home.
function finish() { completeOnboarding(); location.hash = (isSignedUp() || trialActive() || isPaid()) ? '#/home' : '#/signup'; }

export function render(container) {
  // Build the shell ONCE, then paint the changing parts on navigation — so the swipe/keyboard
  // listeners bound to the wrap stay alive across slides (no per-step rebind, no document leak).
  step = 0;
  container.innerHTML = `
  <div class="fade-in onboard-wrap" id="ob-wrap" tabindex="0">
    <div class="dash-glow"></div>
    <div class="onboard-nav">
      <button class="onboard-back" id="ob-back" aria-label="Previous" hidden><i class="ph-bold ph-arrow-left"></i></button>
      <button class="onboard-skip" id="ob-skip">Skip</button>
    </div>
    <div class="onboard-center">
      <div class="onboard-icon" id="ob-icon"></div>
      <h1 class="onboard-title" id="ob-title"></h1>
      <p class="onboard-body" id="ob-body"></p>
    </div>
    <div class="onboard-footer">
      <div class="onboard-dots" id="ob-dots" role="tablist" aria-label="Walkthrough steps"></div>
      <button class="btn btn-primary btn-block" id="ob-next" style="height:50px"></button>
    </div>
  </div>`;

  const wrap = container.querySelector('#ob-wrap');
  const icon = container.querySelector('#ob-icon');
  const title = container.querySelector('#ob-title');
  const body = container.querySelector('#ob-body');
  const dots = container.querySelector('#ob-dots');
  const next = container.querySelector('#ob-next');
  const back = container.querySelector('#ob-back');

  const paint = (dir = 0) => {
    const s = SLIDES[step];
    const isLast = step === SLIDES.length - 1;
    // Re-trigger a small directional slide-in each step for a native carousel feel (respecting
    // the user's reduced-motion preference).
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const center = container.querySelector('.onboard-center');
    if (center && dir !== 0 && !reduce) { center.style.animation = 'none'; void center.offsetWidth; center.style.animation = `obSlide${dir < 0 ? 'Back' : ''} 0.28s ease`; }
    icon.style.color = s.color;
    icon.style.background = `color-mix(in srgb, ${s.color} 15%, transparent)`;
    icon.innerHTML = `<i class="ph-fill ${s.icon}"></i>`;
    title.textContent = s.title;
    body.innerHTML = s.body;
    dots.innerHTML = SLIDES.map((_, i) => `<span class="${i === step ? 'on' : ''}" data-dot="${i}" role="tab" aria-selected="${i === step}" aria-label="Step ${i + 1}"></span>`).join('');
    next.textContent = isLast ? (s.cta || 'Get started') : 'Next';
    back.hidden = step === 0;
  };
  const go = (n, dir) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, n));
    if (clamped === step) return;
    step = clamped;
    paint(dir);
  };

  container.querySelector('#ob-skip').addEventListener('click', finish);
  back.addEventListener('click', () => go(step - 1, -1));
  next.addEventListener('click', () => { if (step === SLIDES.length - 1) finish(); else go(step + 1, 1); });
  dots.addEventListener('click', (e) => { const d = e.target.closest('[data-dot]'); if (d) go(+d.dataset.dot, +d.dataset.dot > step ? 1 : -1); });

  // Keyboard: arrows to move, Enter/Space to advance/finish. Bound to the wrap (focusable),
  // so it dies with the screen — no document-level leak when the user navigates away.
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(step + 1, 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(step - 1, -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (step === SLIDES.length - 1) finish(); else go(step + 1, 1); }
  });

  // Swipe: the expected gesture for a mobile carousel. Horizontal drag past a threshold pages.
  let x0 = null, y0 = null;
  wrap.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) go(step + 1, 1); else go(step - 1, -1); }
    x0 = y0 = null;
  }, { passive: true });

  paint(0);
  // Focus the wrap so arrow keys work immediately (without stealing scroll on mobile).
  try { wrap.focus({ preventScroll: true }); } catch { /* older browsers */ }
}
