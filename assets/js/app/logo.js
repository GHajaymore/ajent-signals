// The Ajent "A" monogram — an upward peak (bullish) with a tick apex, matching
// the iOS app icon, splash, and favicon. Rendered inline so it scales crisply.
export function logoMark(size = 40) {
  const s = size;
  const uid = `lg${Math.random().toString(36).slice(2, 8)}`;
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 64 64" style="flex:none">
    <defs>
      <linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1c1f2e"/>
        <stop offset="100%" stop-color="#0d0e15"/>
      </linearGradient>
      <linearGradient id="${uid}a" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#2bbf8d"/>
        <stop offset="100%" stop-color="#45e6b0"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill="url(#${uid}b)"/>
    <path d="M 19 47 L 32 19 L 45 47" fill="none" stroke="url(#${uid}a)" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="25" y="35.5" width="14" height="4.6" rx="2.3" fill="url(#${uid}a)"/>
    <path d="M 29.4 19 L 32 16.4 L 34.6 19" fill="none" stroke="#7bf0c8" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
