// Recipe-lock regression guard. The Ajent Pulse recipe (the exact indicators,
// thresholds, stop/ATR multiples, MA lengths and entry/exit triggers) is the
// product's edge and must NEVER reach the browser — not in the shipped client
// bundle, and not in any API payload. See memory: ajent-signals-recipe-lock.
//
// This test fails if a recipe token reappears anywhere it can leak. Run it before
// every deploy / in CI:
//   node worker/test/no-recipe-leak.mjs                 # static bundle scan only
//   AJENT_API=https://ajent-api.ajailabs.app node worker/test/no-recipe-leak.mjs   # + live payloads
//
// NOTE ON SCOPE: the user's OWN custom-strategy sliders (entryBelow / exitAbove /
// trendSma / rsiPeriod) are their settings, NOT the recipe, and are intentionally
// visible — so they are deliberately absent from the banned set below.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..'); // repo root (…/ajent-signals)

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } };

// Each banned token uniquely identifies the proprietary recipe. Names describe the
// leak. Patterns are matched case-insensitively against source text and payload JSON.
const BANNED = [
  [/\brsi-?2\b/i, 'RSI-2 (the fast-RSI reading the recipe keys off)'],
  [/\bpctB\b/i, 'Bollinger %B field (pctB)'],
  [/\bconnors\b/i, 'Connors (the strategy namesake)'],
  [/first[ -]?up[ -]?close/i, 'the "first up close" exit rule'],
  [/\brsi2Exit\b/i, 'the rsi2Exit exit rule'],
  [/flush (entry|below)/i, 'the "flush" entry trigger'],
  [/prior day'?s low/i, 'the "prior day\'s low" entry trigger'],
  [/\d(?:\.\d)?\s*[×x]\s*atr\b/i, 'a literal ATR stop multiple (e.g. "2× ATR")'],
  [/\brsi\s?[<>≥≤]\s?\d/i, 'a literal RSI threshold (e.g. "RSI < 15")'],
  [/below[- ]bollinger/i, 'the "below Bollinger band" entry condition'],
  [/\bstopAtrMult\b/i, 'the stopAtrMult recipe dial'],
  [/\bsizeMult\b/i, 'the sizeMult recipe dial'],
  [/\bdeepBelow\b/i, 'the deepBelow conviction threshold'],
];

const scanText = (text, label) => {
  for (const [re, name] of BANNED) {
    const m = text.match(re);
    ok(!m, `${label}: leaks ${name} — found "${(m && m[0]) || ''}"`);
  }
};

// ── 1. Static scan of everything shipped to the browser ─────────────────────────
// The app ships raw ES modules (no minification), so source comments and dead code
// are readable in devtools too — scan the lot.
const CLIENT_ROOTS = ['assets/js', 'index.html', 'app/index.html', 'sw.js'];
const EXT = /\.(js|html)$/;
function walk(p, out) {
  const s = statSync(p);
  if (s.isDirectory()) { for (const e of readdirSync(p)) walk(join(p, e), out); }
  else if (EXT.test(p)) out.push(p);
}
const files = [];
for (const r of CLIENT_ROOTS) { try { walk(join(ROOT, r), files); } catch { /* optional path */ } }
ok(files.length > 0, 'found client source files to scan');
let scanned = 0;
for (const f of files) {
  scanText(readFileSync(f, 'utf8'), relative(ROOT, f).replace(/\\/g, '/'));
  scanned++;
}
console.log(`  · scanned ${scanned} client files for recipe tokens`);

// ── 2. Live payload scan (only when AJENT_API is provided) ──────────────────────
const API = process.env.AJENT_API && process.env.AJENT_API.replace(/\/+$/, '');
if (!API) {
  console.log('  · live-payload scan SKIPPED (set AJENT_API=https://… to enable)');
} else {
  const endpoints = ['/signals', '/trades', '/day', '/stocks', '/history?symbol=ES', '/history?symbol=BTC'];
  for (const ep of endpoints) {
    try {
      const r = await fetch(API + ep, { cache: 'no-store' });
      // /day + /history are ungated; /signals + /trades may 402 without a Pro token
      // (that's fine — a gated-off payload can't leak). Only scan a 200 body.
      if (!r.ok) { console.log(`  · ${ep} → HTTP ${r.status} (not scanned)`); continue; }
      const text = await r.text();
      scanText(text, `payload ${ep}`);
    } catch (e) {
      ok(false, `payload ${ep}: fetch failed — ${String((e && e.message) || e).slice(0, 80)}`);
    }
  }
}

console.log(`\nno-recipe-leak.mjs — ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
