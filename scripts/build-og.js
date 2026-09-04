// Builds the 1200x630 social-share cover (assets/img/og-cover.png) from an SVG,
// using the app's brand tokens. Honest by design — no performance claims.
//   node scripts/build-og.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'img');
const W = 1200, H = 630;

// Candlestick motif on the right — a gentle uptrend with two dips ("buy the dip").
// Decorative only; no axis, no numbers.
const CANDLES = [
  // [xCenter, openY, closeY, highY, lowY, up?]
  [770, 470, 452, 480, 445, true],
  [812, 452, 462, 470, 452, false], // dip
  [854, 462, 430, 468, 424, true],
  [896, 430, 410, 438, 404, true],
  [938, 410, 420, 428, 404, false], // dip
  [980, 420, 384, 426, 378, true],
  [1022, 384, 360, 392, 354, true],
  [1064, 360, 372, 380, 354, false],
  [1106, 372, 330, 380, 322, true],
];
const candleSvg = CANDLES.map(([x, o, c, hi, lo, up]) => {
  const col = up ? '#2fe0a6' : '#ff5c7c';
  const top = Math.min(o, c), bh = Math.max(6, Math.abs(o - c));
  return `<line x1="${x}" y1="${hi}" x2="${x}" y2="${lo}" stroke="${col}" stroke-width="2.5" opacity="0.85"/>` +
         `<rect x="${x - 12}" y="${top}" width="24" height="${bh}" rx="3" fill="${col}" opacity="0.9"/>`;
}).join('');

const FONT = "Inter, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const chip = (x, label) => `
  <g transform="translate(${x},0)">
    <rect x="0" y="0" width="${label.length * 12.6 + 34}" height="42" rx="21" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.1)"/>
    <circle cx="20" cy="21" r="4" fill="#2fe0a6"/>
    <text x="34" y="28" font-family="${FONT}" font-size="21" font-weight="600" fill="rgba(238,240,247,0.82)">${label}</text>
  </g>`;

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="gG" cx="82%" cy="6%" r="65%">
      <stop offset="0" stop-color="#2fe0a6" stop-opacity="0.22"/><stop offset="1" stop-color="#2fe0a6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gB" cx="4%" cy="-4%" r="60%">
      <stop offset="0" stop-color="#4d9bff" stop-opacity="0.18"/><stop offset="1" stop-color="#4d9bff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0.3">
      <stop offset="0" stop-color="#2fe0a6"/><stop offset="1" stop-color="#4d9bff"/>
    </linearGradient>
    <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2fe0a6"/><stop offset="1" stop-color="#66f2c8"/>
    </linearGradient>
    <!-- Canonical app mark gradients (match favicon / app icon / home-screen icon). -->
    <linearGradient id="icnbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1f2e"/><stop offset="1" stop-color="#0d0e15"/></linearGradient>
    <linearGradient id="icnp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#66f2c8"/><stop offset="1" stop-color="#2bbf8d"/></linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0b0d16"/>
  <rect width="${W}" height="${H}" fill="url(#gG)"/>
  <rect width="${W}" height="${H}" fill="url(#gB)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="0" fill="none" stroke="rgba(255,255,255,0.06)"/>

  <!-- candlestick motif (upper right, clear of the text) -->
  <g transform="translate(26,-132)">${candleSvg}</g>

  <!-- brand: the canonical candlestick mark on the dark tile (matches favicon/app icon) -->
  <g transform="translate(80,74)">
    <rect width="62" height="62" rx="17" fill="url(#icnbg)"/>
    <g transform="scale(0.969)">
      <line x1="18" y1="27" x2="18" y2="47" stroke="#ff5c7c" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="14.6" y="32" width="6.8" height="11.5" rx="2" fill="#ff5c7c"/>
      <line x1="32" y1="20" x2="32" y2="45" stroke="url(#icnp)" stroke-width="2.4" stroke-linecap="round"/>
      <rect x="28.6" y="24.5" width="6.8" height="16" rx="2" fill="url(#icnp)"/>
      <line x1="46" y1="15" x2="46" y2="39" stroke="#66f2c8" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="42.4" y="19.5" width="7.2" height="14.5" rx="2" fill="none" stroke="#66f2c8" stroke-width="2.2"/>
      <circle cx="46" cy="10.5" r="3.3" fill="#0d0e15"/>
      <circle cx="46" cy="10.5" r="2.4" fill="#4d9bff"/>
    </g>
    <text x="82" y="26" font-family="${FONT}" font-size="24" font-weight="800" letter-spacing="0.3" fill="#eef0f7">Ajent Signals</text>
    <text x="82" y="52" font-family="${FONT}" font-size="14.5" font-weight="700" letter-spacing="3.5" fill="#4d9bff">LONG-ONLY · SIGNAL ENSEMBLE</text>
  </g>

  <!-- headline -->
  <text x="78" y="300" font-family="${FONT}" font-size="98" font-weight="800" letter-spacing="-2.5" fill="#eef0f7">Buy the dip.</text>
  <text x="78" y="406" font-family="${FONT}" font-size="98" font-weight="800" letter-spacing="-2.5" fill="url(#acc)">Ride the trend.</text>

  <!-- subtitle -->
  <text x="80" y="470" font-family="${FONT}" font-size="29" font-weight="500" fill="rgba(238,240,247,0.62)">Buys oversold dips and rides established uptrends &#8212; tracked honestly.</text>

  <!-- honest chips (no performance claims) -->
  <g transform="translate(80,510)">
    ${chip(0, 'Global markets')}
    ${chip(232, 'Dips + trends')}
    ${chip(452, '100% virtual money')}
  </g>

  <!-- footer -->
  <text x="80" y="600" font-family="${FONT}" font-size="19" font-weight="500" fill="rgba(238,240,247,0.4)">ajent.ajailabs.app&#8195;&#183;&#8195;Educational tool, not investment advice</text>
</svg>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'og-cover.svg'), svg);
sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, 'og-cover.png'))
  .then((info) => console.log(`og-cover.png written: ${info.width}x${info.height}, ${info.size} bytes`))
  .catch((e) => { console.error('render failed:', e.message); process.exit(1); });
