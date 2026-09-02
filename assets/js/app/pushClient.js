// Web-push subscription flow (client side). Subscribes the browser to the Worker's
// VAPID push so signal alerts arrive even when the app is closed.
import { backendConfigured } from './backendApi.js';

function base() {
  try { return ((typeof window !== 'undefined' && window.__AJENT_API) || localStorage.getItem('ajent_api') || '').replace(/\/+$/, ''); } catch (e) { return ''; }
}
function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return backendConfigured() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function pushPermission() { try { return Notification.permission; } catch (e) { return 'default'; } }

export async function isPushEnabled() {
  try { const reg = await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); } catch (e) { return false; }
}

export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  let perm;
  try { perm = await Notification.requestPermission(); } catch (e) { perm = Notification.permission; }
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  const cfg = await fetch(base() + '/push/config').then((r) => r.json()).catch(() => null);
  if (!cfg || !cfg.key) return { ok: false, reason: 'no-key' };
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.key) });
    const res = await fetch(base() + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub }) });
    return { ok: res.ok };
  } catch (e) { return { ok: false, reason: String(e && e.message || e).slice(0, 80) }; }
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(base() + '/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch (e) { /* ignore */ }
  return { ok: true };
}
