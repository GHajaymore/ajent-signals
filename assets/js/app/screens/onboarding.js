import { completeOnboarding } from '../state.js';

const SLIDES = [
  {
    icon: 'ph-chart-bar', color: 'var(--buy)',
    title: 'Welcome to Ajent Signals',
    body: 'Educational trading signals across global markets — stock-index futures, sector ETFs, crypto, and a large-cap stock screener. Virtual money only, no broker, no real funds ever.',
  },
  {
    icon: 'ph-trend-up', color: 'var(--accent-300)',
    title: 'Meet Ajent Pulse',
    body: 'A proven ensemble of edges — it buys deeply oversold dips in uptrends <b>and</b> rides established uptrends — with the discipline seasoned traders live by, and it keeps learning from its own real record.',
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

function finish() { completeOnboarding(); location.hash = '#/home'; }

export function render(container) {
  const s = SLIDES[step];
  const isLast = step === SLIDES.length - 1;
  container.innerHTML = `
  <div class="fade-in onboard-wrap">
    <div class="dash-glow"></div>
    <button class="onboard-skip" id="ob-skip">Skip</button>
    <div class="onboard-center">
      <div class="onboard-icon" style="color:${s.color};background:color-mix(in srgb, ${s.color} 15%, transparent)"><i class="ph-fill ${s.icon}"></i></div>
      <h1 class="onboard-title">${s.title}</h1>
      <p class="onboard-body">${s.body}</p>
    </div>
    <div class="onboard-footer">
      <div class="onboard-dots">${SLIDES.map((_, i) => `<span class="${i === step ? 'on' : ''}"></span>`).join('')}</div>
      <button class="btn btn-primary btn-block" id="ob-next" style="height:50px">${isLast ? (s.cta || 'Get started') : 'Next'}</button>
    </div>
  </div>`;

  container.querySelector('#ob-skip').addEventListener('click', finish);
  container.querySelector('#ob-next').addEventListener('click', () => {
    if (isLast) { finish(); return; }
    step += 1;
    render(container);
  });
}
