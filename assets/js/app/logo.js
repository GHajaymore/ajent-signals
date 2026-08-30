// The Ajent mark — two candlesticks (down/up) with a hollow projected next bar
// and a signal node, matching the favicon, app icon, and home-screen icon.
// Inline so it scales and needs no network fetch on the first (gate) screen.
export function logoMark(size = 40) {
  const s = size;
  const uid = `lg${Math.random().toString(36).slice(2, 8)}`;
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 64 64" style="flex:none">
    <defs>
      <linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1c1f2e"/><stop offset="100%" stop-color="#0d0e15"/>
      </linearGradient>
      <linearGradient id="${uid}p" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#66f2c8"/><stop offset="100%" stop-color="#2bbf8d"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#${uid}b)"/>
    <line x1="18" y1="27" x2="18" y2="47" stroke="#ff5c7c" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="14.6" y="32" width="6.8" height="11.5" rx="2" fill="#ff5c7c"/>
    <line x1="32" y1="20" x2="32" y2="45" stroke="url(#${uid}p)" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="28.6" y="24.5" width="6.8" height="16" rx="2" fill="url(#${uid}p)"/>
    <line x1="46" y1="15" x2="46" y2="39" stroke="#66f2c8" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="42.4" y="19.5" width="7.2" height="14.5" rx="2" fill="none" stroke="#66f2c8" stroke-width="2.2"/>
    <circle cx="46" cy="10.5" r="3.3" fill="#0d0e15"/>
    <circle cx="46" cy="10.5" r="2.4" fill="#4d9bff"/>
  </svg>`;
}
