# SEO, Compliance & Marketing — bake into the redesign

**Status:** guidance / checklist (design-time). Apply while doing Phase 0 (class registry) and the
Accounts tracks — retrofitting SEO and compliance later is expensive, so decide these now.

Companion docs: `phase-0-multi-asset.md`, `track-a-accounts.md`, and the two design-brief artifacts.

---

## 1. The core SEO insight — split the marketing surface from the app

Ajent is a **hash-router SPA** (`#/home`, `#/markets`…). Hash routes and client-rendered content are
effectively **invisible to search engines**, and the app sits behind a disclaimer gate anyway. So
don't try to SEO the app. Split cleanly:

| Surface | Routing | SEO | Notes |
|---|---|---|---|
| **Marketing site** (landing, content, track record, legal) | **Real URLs** (`/methodology`, `/transparency`, `/education/rsi-2`) | **Yes — the whole point** | Static HTML, server-served by Cloudflare Pages. Each page its own `<title>`, meta, JSON-LD. |
| **The app** | Hash SPA (`#/…`), gated | **No — and that's fine** | `robots.txt` disallows it; it's behind signup/gate. |

This one decision makes everything else possible: the marketing surface is a set of fast static HTML
pages you fully control, and the app stays a lightweight SPA.

---

## 2. SEO checklist (low-cost, tailored)

**Per-page fundamentals** (every marketing page):
- Unique `<title>` (≤60 chars) and `<meta name="description">` (≤155).
- **Open Graph + Twitter cards** (`og:title/description/image`, `twitter:card`) — drives how links look
  when shared. This is reachability, not just SEO.
- **JSON-LD structured data:** `Organization` + `SoftwareApplication` on the landing; **`FAQPage`** on
  the FAQ (eligible for rich snippets); `Article` on education posts.
- Semantic HTML, one `<h1>`, ordered headings, descriptive `alt` text.
- Canonical `<link rel="canonical">`.

**Site-level:**
- `sitemap.xml` (marketing pages only) + `robots.txt` (allow marketing, disallow `/app`).
- **Core Web Vitals** — target Lighthouse ≥ 90. The app is vanilla JS (light), so this is winnable:
  preconnect/preload the Google Font, size images, no layout shift. Fast pages rank *and* convert.
- HTTPS/HTTP3/CDN — already free via Cloudflare.
- Mobile-friendly — already responsive; keep it.

**The standout page — a public track record.** The honest "we show every loss" record is both the
product moat and the best SEO/PR asset. Make `/transparency` (or `/record`) a **real, indexable,
shareable** page with an auto-generated OG image of the live stats. Nothing else in this category is as
honest; that earns links and attention.

**Measure:** Google Search Console (free) + **Cloudflare Web Analytics** (free, **cookieless** — see
§3). Skip anything that needs a cookie banner.

---

## 3. Compliance checklist

**Legal pages (required for app stores, accounts, and the EU):**
- **Terms of Service**, **Privacy Policy**, **Risk Disclosure** (financial), and a short **cookie
  notice**. Real URLs, linked in the footer and the signup flow.

**Financial / advice framing (the existing disclaimers are strong — keep them, and one new rule):**
- Educational / **not investment advice**, not an RIA or broker, **simulated** money, **hypothetical
  performance has limitations** — all already present; keep verbatim.
- **New with accounts:** keep signals **generic**, never personalised to a user's situation. Per-user
  *config* (position sizing math for display) is fine; per-user *recommendations* would edge toward
  regulated advice. Hold the line: same signals for everyone, personalised only in presentation.
- If/when you charge and auto-renew: **clear renewal terms + easy cancel** (FTC negative-option /
  "click-to-cancel"). Store IAP handles cancellation; web Stripe needs a self-serve cancel path.

**Privacy (you'll store email once accounts land):**
- **GDPR** (EU) + **CCPA/CPRA** (California): privacy policy with lawful basis, a **data
  export/delete** path (Track A's `/auth/delete` covers delete), minimal PII (email only).
- **Cookies/consent:** use **cookieless analytics** (Cloudflare Web Analytics or Plausible) and only
  essential storage → you likely **avoid a consent banner** entirely. Adding any tracking cookie flips
  this and forces an EU banner — don't, unless there's a real reason.

**Email (transactional + optional marketing):**
- Transactional (login codes, receipts) is fine. **Marketing** (newsletter) needs **explicit opt-in**
  (unchecked by default in the EU), sender identity, and a working **unsubscribe** — CAN-SPAM (US),
  CASL (Canada), GDPR. Keep the newsletter checkbox separate from signup.

**Accessibility (compliance *and* an SEO signal):**
- **WCAG 2.1 AA** + the **European Accessibility Act** (in force 2025 for many consumer products). The
  a11y pass already done (visible focus, reduced-motion, contrast) is the foundation — keep Lighthouse
  a11y ≥ 90 and run `axe` on new screens.

**Age:** 18+ financial gate — already in the disclaimer acks.

---

## 4. Marketing & reachability (low-cost, honesty-led)

- **The honest record IS the marketing.** "We show every loss" is a genuine differentiator in a space
  full of fabricated win-rates. Lean into it: the public `/transparency` page, and it's a natural PR /
  launch angle (Product Hunt, r/algotrading, indie-fintech communities).
- **A small content/education engine.** Short, honest explainers ("what RSI-2 is", "why we're
  long-only", "why 90% of the time the answer is *no trade*") → organic search + trust, written once.
  Doubles as onboarding material.
- **Share cards.** Auto-generated OG images for the track record (and later, per-signal) so shared
  links look credible — cheap reach.
- **App Store Optimisation (ASO):** keyword-rich title/subtitle, honest screenshots, respond to
  reviews. This is discovery on iOS/Play, separate from web SEO.
- **Email list = the signup moment.** The trial captures an opt-in list; a light weekly **honest
  recap** newsletter is retention + reachability (compliant, opt-in per §3).
- **Re-engagement you already have:** PWA install + web push — use them for genuine events (a real BUY
  fired, a trade closed), never spam.
- **Referral / invite** (post-accounts): word-of-mouth is the cheapest channel; add once identity
  exists.

---

## 5. What to bake into the redesign now

1. **Separate the marketing surface** (real-URL static pages) from the gated SPA — the foundational
   split (§1). Decide the page list up front: landing, methodology, transparency/record, FAQ,
   education index, ToS, Privacy, Risk.
2. **Meta + OG + JSON-LD templating** for those static pages from day one (not a retrofit).
3. **Cookieless analytics** (Cloudflare Web Analytics) wired at launch → measurement with no banner.
4. **Legal pages + data-deletion** land with Accounts Track A (they're store- and EU-required anyway).
5. **Keep signals generic** even as per-user config arrives (the advice-line rule, §3).
6. **Public track-record page** — treat it as a first-class marketing+SEO asset, not an afterthought.

---

## 6. Low/no-cost tool picks

| Need | Pick | Cost |
|---|---|---|
| Analytics (cookieless) | Cloudflare Web Analytics (or Plausible) | Free |
| Search indexing insight | Google Search Console | Free |
| Transactional + marketing email | Resend (already chosen for Track A) | Free ~3k/mo |
| Bot defense on forms | Turnstile | Free |
| Perf / a11y / SEO audit | Lighthouse (built into Chrome) + `axe` | Free |
| Structured-data test | Google Rich Results Test | Free |
| OG image generation | Static per-page images, or a small Worker route | ~Free on CF |

---

## 7. Guardrail

None of this softens the honest-numbers or non-disclosure rules. Marketing amplifies the *honest*
record — never a dressed-up one — and the strategy recipe stays out of every public page and meta tag
just as it stays out of the app and API. SEO copy describes the *approach* (the generalised
`publicStrategy` language), never the dials.
