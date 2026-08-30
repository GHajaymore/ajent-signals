# Ajent Signals — Legal & Data-Protection Checklist

We publish market data and trading signals. This tracks how we protect ourselves,
what's done, and what MUST happen before commercialising (charging / scaling).

## Two exposures
1. **Financial-advice / liability** — publishing signals could be read as advice.
2. **Market-data licensing** — we re-serve Yahoo-derived prices; Yahoo's ToS
   prohibits redistribution/commercial use.

---

## ✅ Done (in code)
- **Disclaimers** on the gate, landing footer, methodology, and every signal-export
  webhook payload: educational, **simulated/virtual money**, no real orders, holds
  no funds, "not a registered investment adviser or broker," hypothetical/past
  performance ≠ future results, quantitative models may be wrong/delayed.
- **Inline API NOTICE** (2026-08-30) — every `/signals` and `/trades` response
  carries `notice.disclaimer` + `notice.data` (educational, simulated, not advice,
  **delayed**, **not for redistribution**), so published data is never presented as
  licensed real-time data or advice. Source: `worker/src/index.js` `NOTICE`.

## ⚠️ MUST do before charging / scaling (needs you — legal/business)
Do these three IN ORDER before flipping payments on:

1. **Gate the data endpoints.** `/signals` + `/trades` are currently OPEN (no
   `PRO_SECRET`). Set it (`wrangler secret put PRO_SECRET`) so market data isn't
   publicly redistributed — this is also the paywall. Trade-off: hides the live
   record from free app users, so decide with the launch model.
2. **License a redistributable data feed.** Replace Yahoo for anything published:
   Databento, Polygon.io, or CME direct (their licences permit redistribution).
   `worker/src/data.js` already abstracts the provider (`DATA_PROVIDER`), so this
   is a config + one fetch function, not a rewrite.
3. **Lawyer review of Terms + Privacy + entity.** The `terms/` and `privacy/` pages
   are DRAFTS. Required clauses: limitation of liability, as-is / no warranty, user
   assumes all risk, no advice, delayed/educational data, no redistribution,
   governing law / dispute resolution.

## Also confirm (with counsel)
- **Entity** — an **LLC** for a liability shield; consider E&O insurance for a real product.
- **Registration** — whether publishing futures "signals" triggers **CFTC/NFA**
  (futures) or **SEC / state RIA** (securities) registration in your target markets.
  The educational / no-advice framing is the defence; have counsel confirm per
  jurisdiction before charging.
- **App stores** — Apple/Google both require accurate risk disclosure for finance
  apps; keep the simulated/educational framing prominent in the listing.

## Posture summary
Pre-revenue educational (current): disclaimers + inline notice = reasonable.
Commercial (charging): NOT ready until items 1–3 above are done.
