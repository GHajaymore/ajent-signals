import { state, acceptDisclaimer } from '../state.js';
import { logoMark } from '../logo.js';

const CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ROWS = [
  { key: 'read', label: 'I have read the full disclaimer above' },
  { key: 'risk', label: 'I understand trading real markets carries substantial risk of loss, and that this app is simulated (virtual money)' },
  { key: 'terms', label: 'I accept the <a href="../terms/" target="_blank" rel="noopener" style="color:var(--accent-300)">Terms of Use</a> and <a href="../privacy/" target="_blank" rel="noopener" style="color:var(--accent-300)">Privacy Policy</a>' },
  { key: 'age', label: 'I am at least 18 years old (or the age of majority where I live)' },
];

export function render(container) {
  const acks = state.acks;
  const allChecked = Object.values(acks).every(Boolean);

  container.innerHTML = `
  <div class="fade-in" style="padding-top:8px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
      ${logoMark(46)}
      <div>
        <div style="font:700 18px var(--font-heading)"><span style="color:var(--buy)">Aj</span><span style="color:var(--neutral-300)">ent</span> Signals</div>
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted)">Global Markets Intelligence</div>
      </div>
    </div>
    <h1 style="font-size:24px;margin-bottom:8px">Before you begin</h1>
    <p class="text-muted" style="font-size:13.5px;margin-bottom:16px">Read and accept the following. Access is denied until every box is checked.</p>

    <div style="max-height:210px;overflow-y:auto;background:var(--neutral-900);border:1px solid var(--neutral-800);border-radius:var(--radius-md);padding:14px 16px;font-size:12.5px;line-height:1.6;color:var(--text-muted);margin-bottom:6px">
      <p style="margin:0 0 12px">This application is provided solely for educational and informational purposes. It does not provide investment, financial, legal, or tax advice, and it is not a recommendation, endorsement, or solicitation to buy or sell any security, futures contract, cryptocurrency, or other instrument. It is not a registered investment adviser or broker. <b style="color:var(--text)">All trading in this app is simulated with virtual money</b> — it executes no real orders and holds no funds. Trading and investing in real markets involve substantial risk of loss and are not suitable for every investor; you could lose some or all of your capital. Hypothetical and past performance do not indicate or guarantee future results. Signals are based on quantitative models and technical analysis and may be incorrect, delayed, or incomplete. You are solely responsible for your own decisions and assume all risks. By tapping &lsquo;I Agree&rsquo;, you acknowledge these risks and release the developers, owners, affiliates, and contributors from any liability for losses or damages arising from your use of the application.</p>
      <p style="margin:0">Ajent, its developers, owners, and affiliates are not responsible or liable for any financial negligence, trading losses, or damages of any kind incurred through the use of, or reliance on, this application or its signals.</p>
    </div>

    <div style="margin-bottom:20px">
      ${ROWS.map((r) => `
        <div class="checkrow" data-key="${r.key}" role="checkbox" aria-checked="${acks[r.key] ? 'true' : 'false'}" tabindex="0">
          <span class="checkbox ${acks[r.key] ? 'checked' : ''}" aria-hidden="true">${CHECK_SVG}</span>
          <span style="font-size:13.5px;line-height:1.4">${r.label}</span>
        </div>`).join('')}
    </div>

    <button id="gate-submit" class="btn btn-primary btn-block" style="height:52px;font-size:15px" ${allChecked ? '' : 'disabled'}>I Agree &amp; Continue</button>
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">CFTC Rule 4.41 · Not affiliated with any exchange listed in-app</p>
  </div>`;

  // Toggle in place (no full re-render) so keyboard focus stays on the row the user
  // just acted on — a full re-render would drop focus to the top each time.
  const toggle = (row) => {
    const key = row.dataset.key;
    state.acks[key] = !state.acks[key];
    const on = state.acks[key];
    row.setAttribute('aria-checked', on ? 'true' : 'false');
    row.querySelector('.checkbox').classList.toggle('checked', on);
    const btn = document.getElementById('gate-submit');
    if (btn) btn.disabled = !Object.values(state.acks).every(Boolean);
  };
  container.querySelectorAll('.checkrow').forEach((row) => {
    row.addEventListener('click', (e) => { if (e.target.closest('a')) return; toggle(row); });
    row.addEventListener('keydown', (e) => {
      if (e.target.closest('a')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row); }
    });
  });

  const submit = document.getElementById('gate-submit');
  submit.addEventListener('click', () => {
    if (!Object.values(state.acks).every(Boolean)) return;
    acceptDisclaimer();
    location.hash = '#/home';
  });
}
