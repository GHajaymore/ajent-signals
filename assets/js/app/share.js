// Shared share/copy helpers. Native share sheet where available (mobile), else copy the
// link with a graceful fallback + toast. User-initiated only; callers frame all text as
// educational — never a recommendation, never fabricated numbers.

// Brief bottom toast. Self-removing; the CSS transition respects reduced motion.
export function flashToast(msg) {
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2200);
}

// Robust copy: async Clipboard API where allowed, else a temp-textarea execCommand
// fallback (older browsers / contexts that block navigator.clipboard).
async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); return true; } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = url; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, url.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

// Try the native share sheet; on decline/absence, copy the link and toast.
export async function shareOrCopy({ title, text, url }) {
  try {
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; /* fall through to copy */ }
  flashToast((await copyLink(url)) ? 'Link copied' : 'Couldn’t copy — long-press the address bar to share');
}
