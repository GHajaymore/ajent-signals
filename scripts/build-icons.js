// Generates PWA / home-screen icons from the brand mark (the pulse logo).
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
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#2bbf8d"/><stop offset="100%" stop-color="#66f2c8"/></linearGradient>
  </defs>`;
const MARK = `
  <path d="M 12 34 L 23 34 L 29 20 L 38 47 L 44 30 L 51 30" fill="none" stroke="url(#p)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="51" cy="30" r="3.4" fill="#0d0e15"/><circle cx="51" cy="30" r="2.7" fill="#66f2c8"/><circle cx="51" cy="30" r="1.1" fill="#0d0e15"/>`;

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
