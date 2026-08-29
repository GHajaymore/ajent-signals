// Generates PWA / home-screen icons from the brand mark (the predictive-candles logo).
// iOS ignores SVG icons, so we ship PNGs: a full-bleed apple-touch icon (iOS
// rounds it itself), "any" icons for browsers/Android, and a maskable icon with
// a safe center zone for adaptive shapes.
//   node scripts/build-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets', 'img');

// Shared defs + the pulse mark, so every variant is identical artwork.
const DEFS = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1c1f2e"/><stop offset="100%" stop-color="#0d0e15"/></linearGradient>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#66f2c8"/><stop offset="100%" stop-color="#2bbf8d"/></linearGradient>
  </defs>`;
const MARK = `
  <line x1="18" y1="27" x2="18" y2="47" stroke="#ff5c7c" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="14.6" y="32" width="6.8" height="11.5" rx="2" fill="#ff5c7c"/>
  <line x1="32" y1="20" x2="32" y2="45" stroke="url(#p)" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="28.6" y="24.5" width="6.8" height="16" rx="2" fill="url(#p)"/>
  <line x1="46" y1="15" x2="46" y2="39" stroke="#66f2c8" stroke-width="2.2" stroke-linecap="round"/>
  <rect x="42.4" y="19.5" width="7.2" height="14.5" rx="2" fill="none" stroke="#66f2c8" stroke-width="2.2"/>
  <circle cx="46" cy="10.5" r="3.3" fill="#0d0e15"/><circle cx="46" cy="10.5" r="2.4" fill="#4d9bff"/>`;

// Rounded tile (browser/Android "any").
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${DEFS}<rect width="64" height="64" rx="16" fill="url(#bg)"/>${MARK}</svg>`;
// Full-bleed square — iOS applies its own corner mask, so no transparent corners.
const fullbleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${DEFS}<rect width="64" height="64" fill="url(#bg)"/>${MARK}</svg>`;
// Maskable — full bleed, mark scaled into the center safe zone (~72%).
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${DEFS}<rect width="64" height="64" fill="url(#bg)"/><g transform="translate(32,32) scale(0.72) translate(-32,-32)">${MARK}</g></svg>`;

const JOBS = [
  { svg: fullbleed, size: 180, file: 'apple-touch-icon.png' },
  { svg: rounded, size: 192, file: 'icon-192.png' },
  { svg: rounded, size: 512, file: 'icon-512.png' },
  { svg: maskable, size: 512, file: 'icon-512-maskable.png' },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const j of JOBS) {
    await sharp(Buffer.from(j.svg), { density: 384 }).resize(j.size, j.size).png().toFile(path.join(OUT, j.file));
    console.log(`wrote ${j.file} (${j.size}x${j.size})`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
