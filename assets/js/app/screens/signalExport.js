// Signal Export API (Pro) — UI for the "signal → your own bot/TradingView" webhooks.
// Educational only: Ajent hands you the signal over HTTP; it never places an order.
//
// States:
//   • backend not configured  → feature preview (what it is), locked.
//   • configured, not Pro      → upgrade prompt → paywall.
//   • configured + Pro         → add/list/delete webhooks + send a test event.
import { isEntitled, backendConfigured, listWebhooks, createWebhook, deleteWebhook, testWebhooks } from '../backendApi.js';

export function signalExportHtml() {
  return `
    <div class="setting-block">
      <div class="eyebrow" style="margin-bottom:8px;display:flex;align-items:center;gap:6px">
        <i class="ph-fill ph-webhooks-logo" style="color:var(--accent-300)"></i> Signal export API
        <span class="chip" style="background:var(--accent-900);color:var(--accent-100);font-size:10px;padding:2px 7px">PRO</span>
      </div>
      <div class="panel" id="sx-panel" style="padding:14px 16px">
        <div class="setting-help" style="margin-top:0">
          Send each fresh signal to your own tools — a trading bot, a TradingView alert relay,
          Zapier, or a Discord channel — as a signed webhook. <b>Educational only:</b> Ajent posts
          the signal; it never places an order or connects to a broker. You decide what to do with it.
        </div>
        <div id="sx-body" style="margin-top:12px"></div>
      </div>
    </div>`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function lockedPreview(reason) {
  return `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="text-muted" style="font-size:12.5px">${reason}</div>
      <a href="#/paywall" class="btn btn-primary btn-block" style="height:42px;font-size:13px;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px">
        <i class="ph-fill ph-crown-simple"></i> Unlock with Ajent Pro
      </a>
    </div>`;
}

function hookRow(h) {
  const status = h.active === false ? '<span style="color:var(--sell)">paused</span>' : '<span style="color:var(--buy)">active</span>';
  return `
    <div class="notif-row" data-hook="${escapeHtml(h.id)}">
      <div class="notif-label" style="min-width:0">
        <div style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.url)}</div>
        <div class="text-muted" style="font-size:11px">${(h.events || []).join(', ')} · ${status}</div>
      </div>
      <button class="btn btn-ghost sx-del" data-id="${escapeHtml(h.id)}" style="height:30px;padding:0 10px;font-size:12px;color:var(--sell);flex:none">Remove</button>
    </div>`;
}

function manager(hooks, secretJustCreated) {
  const list = hooks.length
    ? `<div class="panel" style="padding:2px 12px;margin-bottom:10px">${hooks.map(hookRow).join('')}</div>`
    : '<div class="text-muted" style="font-size:12.5px;margin-bottom:10px">No webhooks yet. Add your endpoint URL below.</div>';
  const secretNote = secretJustCreated
    ? `<div class="panel" style="padding:10px 12px;margin-bottom:10px;border:1px solid var(--accent-800)">
         <div class="eyebrow" style="margin-bottom:4px">Signing secret — copy it now</div>
         <code style="font-size:11px;word-break:break-all;color:var(--accent-100)">${escapeHtml(secretJustCreated)}</code>
         <div class="text-muted" style="font-size:11px;margin-top:6px">Verify <code>X-Ajent-Signature</code> = <code>sha256=HMAC-SHA256(rawBody, secret)</code>. Shown once.</div>
       </div>`
    : '';
  return `
    ${secretNote}
    ${list}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="sx-url" type="url" inputmode="url" placeholder="https://your-endpoint.com/hook"
        style="flex:1;min-width:180px;height:40px;background:var(--neutral-900);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:0 12px;font-size:13px" />
      <button id="sx-add" class="btn btn-primary" style="height:40px;padding:0 16px;font-size:13px;flex:none">Add</button>
    </div>
    <div id="sx-msg" class="text-muted" style="font-size:11.5px;margin-top:8px;min-height:14px"></div>
    <button id="sx-test" class="btn btn-ghost btn-block" style="height:38px;font-size:12.5px;margin-top:4px">Send a test event to all webhooks</button>`;
}

export async function wireSignalExport(container) {
  const body = container.querySelector('#sx-body');
  if (!body) return;

  if (!backendConfigured()) {
    body.innerHTML = lockedPreview('Available once your Ajent Pro backend is connected. It powers 24/7 signals and this export API.');
    return;
  }
  if (!isEntitled()) {
    body.innerHTML = lockedPreview('The signal export API is an Ajent Pro feature.');
    return;
  }

  body.innerHTML = '<div class="text-muted" style="font-size:12.5px">Loading your webhooks…</div>';
  const render = (hooks, newSecret) => {
    body.innerHTML = manager(hooks || [], newSecret);
    wireManager(container, body);
  };

  const data = await listWebhooks();
  if (!data) { body.innerHTML = lockedPreview('Could not reach the backend. Check the connection and try again.'); return; }
  render(data.webhooks || []);

  function wireManager(root, bodyEl) {
    const msg = bodyEl.querySelector('#sx-msg');
    const setMsg = (t, err) => { if (msg) { msg.textContent = t; msg.style.color = err ? 'var(--sell)' : 'var(--text-muted)'; } };

    const addBtn = bodyEl.querySelector('#sx-add');
    const urlInput = bodyEl.querySelector('#sx-url');
    if (addBtn && urlInput) addBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) { setMsg('Enter an https:// endpoint URL.', true); return; }
      addBtn.disabled = true; setMsg('Adding…');
      const r = await createWebhook(url);
      addBtn.disabled = false;
      if (!r || r.error) { setMsg(r && r.error ? `Rejected: ${r.error}` : 'Failed — check the URL (must be public https).', true); return; }
      const fresh = await listWebhooks();
      render(fresh ? fresh.webhooks : [], r.webhook && r.webhook.secret);
    });

    bodyEl.querySelectorAll('.sx-del').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      await deleteWebhook(btn.dataset.id);
      const fresh = await listWebhooks();
      render(fresh ? fresh.webhooks : []);
    }));

    const testBtn = bodyEl.querySelector('#sx-test');
    if (testBtn) testBtn.addEventListener('click', async () => {
      testBtn.disabled = true; setMsg('Sending test event…');
      const r = await testWebhooks();
      testBtn.disabled = false;
      if (!r || r.error) { setMsg('Test failed — is a webhook added and reachable?', true); return; }
      setMsg(`Test event delivered to ${r.delivered || 0} endpoint(s).`);
    });
  }
}
