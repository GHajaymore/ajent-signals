import { fmtMoney } from '../currency.js';
import { getRoleSession, getRole, isOwner, clearRole, unlockRole, fetchConsoleOverview } from '../role.js';

const money = (n) => fmtMoney(n); // display currency (local by default, USD toggle) — matches other screens

// The OPERATOR CONSOLE — owner/admin seats. Hidden from members (reached at #/console; a shortcut
// appears in Settings once unlocked). Access is proven by a secret key exchanged for a role token
// (role.js → worker/src/roles.js). Analytics are AGGREGATE and honest — no per-user P/L exists yet.

const card = (inner, style = '') => `<div class="card" style="padding:14px 16px;${style}">${inner}</div>`;
const metric = (label, value, sub, color) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value"${color ? ` style="color:${color}"` : ''}>${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
const sectionLabel = (t) => `<div class="section-label" style="margin-top:20px">${t}</div>`;

function unlockView() {
  return `
  <div class="fade-in glow-wrap" style="max-width:440px;margin:0 auto">
    <div class="dash-glow"></div>
    <h1 class="h-title" style="margin-top:8px">Operator console</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 20px">Restricted — owner &amp; admin only. Enter your access key.</p>
    ${card(`
      <label class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Access key</label>
      <input id="ck-key" type="password" autocomplete="off" inputmode="text" placeholder="Enter your key" style="width:100%;margin-top:6px;padding:12px 14px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface-2,var(--surface));color:var(--text);font-size:15px;font-family:var(--font-mono,monospace)">
      <button id="ck-unlock" class="btn btn-primary btn-block" style="margin-top:12px;height:46px">Unlock</button>
      <div id="ck-err" class="text-faint" style="font-size:12px;margin-top:10px;color:var(--sell);min-height:16px"></div>
    `)}
    <p class="text-faint" style="font-size:11px;line-height:1.5;margin-top:14px;text-align:center">Owner sees all levers, analytics and reach. Admin manages user-facing config; the Ajent strategy stays read-only. Members never see this.</p>
    <div style="text-align:center;margin-top:16px"><a data-nav="#/home" class="text-muted" style="font-size:12px">&lsaquo; Back to app</a></div>
  </div>`;
}

function roleBadge(role) {
  const map = { owner: ['Owner', 'var(--accent-200)'], admin: ['Admin', 'var(--buy)'] };
  const [label, col] = map[role] || ['Member', 'var(--text-muted)'];
  return `<span style="font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${col};border:1px solid color-mix(in srgb,${col} 40%,transparent);background:color-mix(in srgb,${col} 12%,transparent);border-radius:20px;padding:3px 10px">${label}</span>`;
}

function overviewView(d) {
  const role = d.role || getRole();
  const a = d.ajent || {};
  const pf = a.profitFactor == null ? '—' : a.profitFactor;
  const reach = d.reach || {};
  const cfg = d.config || {};
  const own = d.ownerOnly;

  let html = `
  <div class="fade-in">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <h1 class="h-title">Operator console</h1>
      <div style="display:flex;align-items:center;gap:10px">${roleBadge(role)}<button id="ck-lock" class="btn" style="height:32px;padding:0 12px;font-size:12px">Lock</button></div>
    </div>
    <p class="text-muted" style="font-size:12px;margin:4px 0 4px">Aggregate analytics · virtual money only · updated ${d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}</p>

    ${sectionLabel('Reach')}
    <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
      ${metric('Engaged devices', String(reach.devices ?? 0), 'push enabled', 'var(--accent-200)')}
      ${metric('Pro accounts', String(reach.proAccounts ?? 0), 'using signal export')}
    </div>

    ${sectionLabel('Ajent live record')}
    <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
      ${metric('Net P/L', money(a.totalPnl || 0), 'virtual money', (a.totalPnl || 0) >= 0 ? 'var(--buy)' : 'var(--sell)')}
      ${metric('Win rate', `${a.winRate ?? 0}%`, `${a.trades ?? 0} closed`, 'var(--buy)')}
      ${metric('Profit factor', `${pf}`, 'gross win ÷ loss')}
      ${metric('Open now', String(a.open ?? 0), 'live positions')}
    </div>
    ${d.stocks ? `${sectionLabel('Stock screener record')}
    <div class="stat-row" style="grid-template-columns:repeat(2,1fr)">
      ${metric('Net P/L', money(d.stocks.totalPnl || 0), 'virtual money', (d.stocks.totalPnl || 0) >= 0 ? 'var(--buy)' : 'var(--sell)')}
      ${metric('Win rate', `${d.stocks.winRate ?? 0}%`, `${d.stocks.trades ?? 0} closed`)}
    </div>` : ''}

    ${sectionLabel('Configuration')}
    ${card(`
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font:600 13px var(--font-heading)">Markets</div><div class="text-muted" style="font-size:11.5px;margin-top:1px">${cfg.marketsTotal ?? '—'} tracked${cfg.byClass ? ` · ${Object.entries(cfg.byClass).map(([k, n]) => `${n} ${k}`).join(' · ')}` : ''}</div></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--divider)">
        <div><div style="font:600 13px var(--font-heading)">Strategy · ${cfg.strategy || 'Ajent Pulse'}</div><div class="text-muted" style="font-size:11.5px;margin-top:1px">The proven recipe${role === 'admin' ? '' : ' + adaptive dials'}</div></div>
        <span style="font-size:10px;font-weight:700;color:var(--text-muted);border:1px solid var(--hairline);border-radius:6px;padding:3px 8px">READ ONLY</span>
      </div>
    `)}
  `;

  if (role === 'admin') {
    html += `${sectionLabel('User management')}
    ${card(`<div class="text-muted" style="font-size:12px;line-height:1.55">Per-user management (view accounts, tier, suspend) arrives with the user-accounts phase. Today the app has no server-side accounts — books are per-device. You can manage user-facing configuration (markets, alerts) and reach from here.</div>`)}`;
  }

  if (role === 'owner' && own) {
    const pfr = own.paidFree || {};
    html += `${sectionLabel('Paid vs free')}
    ${card(`
      <div class="stat-row" style="grid-template-columns:repeat(2,1fr);margin:0">
        ${metric('Pro-engaged', String(pfr.proEngaged ?? 0), 'export webhooks')}
        ${metric('Engaged devices', String(pfr.engagedDevices ?? 0), 'push enabled')}
      </div>
      <div class="text-faint" style="font-size:11px;line-height:1.5;margin-top:10px">${pfr.note || 'Reach proxies only until user accounts land.'}</div>
    `)}`;

    const lab = own.lab || {};
    if (lab.candidates && lab.candidates.length) {
      html += `${sectionLabel('Strategy lab')}
      ${card(lab.candidates.map((c) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--divider)">
        <div style="min-width:0"><div style="font:600 12.5px var(--font-heading)">${c.label || c.key}</div><div class="text-muted" style="font-size:11px">${c.trades || 0} closed · ${c.winRate || 0}% · PF ${c.profitFactor ?? '—'}${c.open ? ` · ${c.open} open` : ''}</div></div>
        <div style="font:800 14px var(--font-heading);color:${(c.net || 0) >= 0 ? 'var(--buy)' : 'var(--sell)'}">${money(c.net || 0)}</div>
      </div>`).join('') + `<div class="text-faint" style="font-size:10.5px;margin-top:8px">${lab.days != null ? `Forward-testing ${lab.days}d. ` : ''}Isolated shadow records — not adopted.</div>`)}`;
    }

    const exp = own.experiments || {};
    const notes = [exp.equity?.note, exp.bollinger?.note].filter(Boolean);
    if (notes.length) {
      html += `${sectionLabel('Live experiments')}
      ${card(notes.map((n) => `<div class="text-muted" style="font-size:11.5px;line-height:1.5;padding:5px 0">${n}</div>`).join(''))}`;
    }

    html += `${sectionLabel('All levers')}
    ${card(`<div class="text-muted" style="font-size:12px;line-height:1.6">The internal engine breakdown and lab scoreboard are unlocked for you across the app while you're signed in as owner. Open <a data-nav="#/track" style="color:var(--accent-300)">Paper</a> to see per-engine performance and the live lab.</div>`)}`;
  }

  html += `<p class="text-faint" style="font-size:11px;text-align:center;margin:18px 0 8px;line-height:1.5">Aggregate analytics only. No per-user P/L is collected. Virtual money — educational.</p></div>`;
  return html;
}

export function render(container) {
  const session = getRoleSession();
  if (!session) {
    container.innerHTML = unlockView();
    const keyEl = container.querySelector('#ck-key');
    const errEl = container.querySelector('#ck-err');
    const submit = async () => {
      const btn = container.querySelector('#ck-unlock');
      const key = (keyEl.value || '').trim();
      if (!key) { errEl.textContent = 'Enter your access key.'; return; }
      btn.disabled = true; btn.textContent = 'Unlocking…'; errEl.textContent = '';
      const res = await unlockRole(key);
      if (res.ok) { render(container); return; }
      btn.disabled = false; btn.textContent = 'Unlock';
      errEl.textContent = res.error || 'Unlock failed.';
      keyEl.value = '';
    };
    container.querySelector('#ck-unlock').addEventListener('click', submit);
    keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    keyEl.focus();
    return;
  }

  // Authed: show a header immediately, then fill from the server.
  container.innerHTML = `<div class="fade-in"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><h1 class="h-title">Operator console</h1>${roleBadge(session.role)}</div><div class="card" style="padding:22px;text-align:center;margin-top:14px"><span class="text-muted" style="font-size:13px">Loading analytics…</span></div></div>`;
  fetchConsoleOverview().then((d) => {
    if (!d) { container.innerHTML = unlockView(); render(container); return; }
    if (d.error) {
      container.innerHTML = `<div class="fade-in"><h1 class="h-title">Operator console</h1><div class="card" style="padding:20px;margin-top:14px"><div class="text-muted" style="font-size:13px;line-height:1.6">${d.error}</div><button id="ck-relock" class="btn btn-block" style="margin-top:14px;height:42px">Unlock again</button></div></div>`;
      const rb = container.querySelector('#ck-relock');
      if (rb) rb.addEventListener('click', () => { clearRole(); render(container); });
      return;
    }
    container.innerHTML = overviewView(d);
    const lock = container.querySelector('#ck-lock');
    if (lock) lock.addEventListener('click', () => { clearRole(); render(container); });
  });
}
