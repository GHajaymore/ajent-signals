// iOS home-screen "web clip" apps (and GitHub Pages' 10-min CDN cache) can hold onto a
// stale build with no reload button available in standalone mode. This polls a small
// version file (always cache-busted) and surfaces a tap-to-refresh banner when it changes.

const VERSION_URL_BASE = new URL('../../../version.json', import.meta.url).pathname;

async function fetchVersion() {
  const url = `${VERSION_URL_BASE}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.v;
}

function hardReload() {
  const url = new URL(location.href);
  url.searchParams.set('_r', Date.now());
  location.href = url.toString();
}

function showBanner() {
  if (document.getElementById('update-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.setAttribute('role', 'button');
  banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:999;background:var(--accent);color:#0b0c15;font:600 13.5px -apple-system,system-ui,sans-serif;padding:12px 16px;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;max-width:560px;margin:0 auto;';
  banner.innerHTML = '<i class="ph-bold ph-arrows-clockwise"></i> New version available — tap to refresh';
  banner.addEventListener('click', hardReload);
  document.body.appendChild(banner);
}

export function startUpdateWatcher({ intervalMs = 60000 } = {}) {
  let currentVersion = null;

  fetchVersion().then((v) => { currentVersion = v; }).catch(() => {});

  async function check() {
    try {
      const v = await fetchVersion();
      if (currentVersion && v !== currentVersion) showBanner();
    } catch (e) { /* offline or blocked — ignore, try again later */ }
  }

  setInterval(check, intervalMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}
