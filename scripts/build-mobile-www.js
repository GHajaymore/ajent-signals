// Builds mobile-www/ — the native app's bundled web content — from the same
// app/index.html + assets/ that power the website, so there is one source of truth.
// Runs in CI (Node preinstalled on GitHub's macOS runners) via `npm run build:www`.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'mobile-www');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let html = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
html = html
  .replace(/\.\.\/assets\//g, 'assets/')
  .replace(/\.\.\/manifest\.webmanifest/g, 'manifest.webmanifest');
fs.writeFileSync(path.join(outDir, 'index.html'), html);

copyRecursive(path.join(root, 'assets'), path.join(outDir, 'assets'));

const manifestPath = path.join(root, 'manifest.webmanifest');
if (fs.existsSync(manifestPath)) {
  fs.copyFileSync(manifestPath, path.join(outDir, 'manifest.webmanifest'));
}

console.log('mobile-www built at', outDir);
