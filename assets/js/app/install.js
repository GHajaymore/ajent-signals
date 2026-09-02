// PWA install helper. Captures the browser's install prompt (Chrome/Edge/Android)
// so we can offer a one-tap install, and detects iOS (where install is manual via
// the Share sheet) and the already-installed standalone state.
let deferredPrompt = null;
let onChange = null;

export function initInstall(cb) {
  onChange = cb;
  try {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; onChange && onChange(); });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; onChange && onChange(); });
  } catch (e) { /* ignore */ }
}

export function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
}
export function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ''); }
export function installAvailable() { return !!deferredPrompt; }

export async function promptInstall() {
  if (!deferredPrompt) return null;
  try {
    deferredPrompt.prompt();
    const res = await deferredPrompt.userChoice;
    deferredPrompt = null; onChange && onChange();
    return res && res.outcome;
  } catch (e) { deferredPrompt = null; return null; }
}
