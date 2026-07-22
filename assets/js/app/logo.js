// The Ajent "market pulse" mark — an EKG-style signal spike ending in a live
// node, matching the iOS app icon, splash, and favicon. Inline so it scales.
export function logoMark(size = 40) {
  const s = size;
  const uid = `lg${Math.random().toString(36).slice(2, 8)}`;
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 64 64" style="flex:none">
    <defs>
      <linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1c1f2e"/><stop offset="100%" stop-color="#0d0e15"/>
      </linearGradient>
      <linearGradient id="${uid}p" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#2bbf8d"/><stop offset="100%" stop-color="#66f2c8"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#${uid}b)"/>
    <path d="M 12 34 L 23 34 L 29 20 L 38 47 L 44 30 L 51 30" fill="none" stroke="url(#${uid}p)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="51" cy="30" r="3.4" fill="#0d0e15"/>
    <circle cx="51" cy="30" r="2.7" fill="#66f2c8"/>
    <circle cx="51" cy="30" r="1.1" fill="#0d0e15"/>
  </svg>`;
}
