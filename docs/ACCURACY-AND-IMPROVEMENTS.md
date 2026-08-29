# Ajent Signals — Accuracy & Improvements Tracker

Living doc. Keep it current whenever the strategy or copy changes. The golden
rule is **honesty**: never show a fabricated win rate, P&L, profit factor, or
testimonial. Every number is a real backtest or the live paper record.

## Accuracy invariants — these must stay TRUE and IN SYNC across all three surfaces
Surfaces that describe the strategy and must always agree:
1. **The app** — `screens/settings.js` (mode help), `screens/methodology.js`, `screens/home.js` (strategy chip), `signalEngine.js` comments
2. **The landing page** — `index.html`
3. **The design showcase Artifact** — `scratchpad/ajent-showcase.html` (URL: claude.ai/code/artifact/5e9ffd37…)

Current truth (as of 2026-08-14):
- **Active mode (intraday, DEFAULT):** long **and** short, no trend gate. Long RSI2<10, short RSI2>90, exit at RSI2=50, 2×ATR stop. Backtest (~60d, 8–11 markets): **~65% win, PF ~1.25 pooled**. Auto-trades 11 markets: ES, NQ, RTY, SX5E, DAX, TSX, HSI, BTC, ETH, SI, CL. **Provisional** — small sample; the live record is the real test.
- **Proven mode (daily):** **long-only**, RSI2<10 flush below prior day's low, "first up close" exit. **PF ~1.6, ~72% win**, profitable in 5/5 walk-forward windows + 4/5 out-of-sample indices — the decade-validated credential. Auto-trades 8 index markets.
- Rejected on data (do not re-add without new evidence): trend-following (MACD/EMA cross, ~30% win); daily shorts (lost on intl indices); intraday markets that lost — Dow, ASX, Nikkei, Nifty, Gold.

## Fixed (accuracy issues caught & corrected)
- 2026-08-14 — Disclaimers made precise & accurate for public launch: landing footer + app gate now state the app is **simulated/virtual money (no real orders, holds no funds)**, cover all instrument types (not just "futures"), note "not a registered investment adviser/broker", and that hypothetical/past performance does not guarantee future results. NOTE: `terms/` and `privacy/` pages (linked from the gate) are separate legal docs — have a lawyer review before a serious public launch.
- 2026-08-14 — News frozen: `news.js` missing `cache:'no-store'` and tried the dead `allorigins` proxy first → added no-store + corsproxy-first + timeout.
- 2026-08-14 — Landing page + showcase still said "long-only" after Active went both-ways → corrected (long-only now scoped only to Proven daily).
- 2026-08-07 — SIM/no-feed markets fabricated confident BUY/SELL → now read "No trade".
- 2026-08 — Removed fabricated landing stats (68% win, fake trades/testimonials).

## Launch / marketing (2026-08-14)
- Public landing page (`index.html`) is now the showcase design: hero, phone mockups, "Open the app free" CTA → `/app/`, and an email **waitlist** form. Chosen model (per user): open app + email waitlist now; real accounts (Cognito/Clerk + serverless backend) later when they sync data or gate a paywall.
- [ ] **Wire the waitlist endpoint** — `index.html` script has `WAITLIST_ENDPOINT=''`; until set, sign-ups only save to the visitor's localStorage (not collected). Paste a Formspree form ID (2-min) OR scaffold an API Gateway→Lambda→DynamoDB(+SES) endpoint.
- [x] **Social preview image** (2026-08-14) — `assets/img/og-cover.png` (1200×630) built from `scripts/build-og.js` (SVG → sharp → PNG; source `og-cover.svg`). On-brand, no performance claims. Re-run `node scripts/build-og.js` to regenerate if the tagline/brand changes.

## Monetization — THE BACKEND IS PRO (2026-08-14, updated)
Chosen design: **Free = client-side** (in-browser, delayed data, app-open-only, core US, Proven daily — $0 to serve). **Pro = the backend** (`worker/`, Cloudflare: 24/7 server-side trading, real-time reliable data, all markets, Active, alerts). The gate on the Worker's `/signals` + `/trades` endpoints IS the paywall — Free users never hit it. Aligns cost with revenue (the Worker + data feed only serves payers).
- Pro gate: HMAC bearer token (`worker/src/auth.js`), issued by the payment flow after verifying a purchase; open until `PRO_SECRET` is set. App sends it (`window.__AJENT_PRO_TOKEN` / localStorage `ajent_pro_token`).
- [ ] **Deploy the Worker** — `cd worker && npm i && npx wrangler login && wrangler kv namespace create AJENT_KV` (paste id) `&& npx wrangler deploy`. Set `window.__AJENT_API` to the Worker URL.
- [ ] **Payment → token flow** — Stripe (web) and/or App Store/Play receipt validation → call `issueProToken()` → return to app. THIS is the real remaining build for monetization.
- Two AWS + Cloudflare backends now exist (`backend/` SAM, `worker/` CF) — pick ONE; Cloudflare is the recommendation.

## Pre-revenue polish + anti-freeloading (2026-08-28)
- **No dead-end on the Free cap**: paywall CTA is `canBuy = isNative() || backendConfigured()`. When payments aren't live it reads **"Join the waitlist"** and routes to the landing `../#waitlist`; the banner no longer falsely says "everything unlocked" (it now says "Pro isn't open yet · Free is usable now"). Pricing stays visible as a preview.
- **Two-layer gate — a free user can't run away with Pro:**
  1. **Client cap is a soft nudge** — the 1-market limit (`isEntitled()`) is client-side, so a determined user could unlock it locally, but there's nothing costly behind it: it only runs more *simulated* markets on *delayed* data in their own browser.
  2. **The valuable stuff is hard-gated server-side** — 24/7 backend trading, real-time data, and the signal-export API require a valid **HMAC Pro token** the client can't forge without `PRO_SECRET`. `/signals`, `/trades`, `/webhooks*` return 402 without it.
  3. **Server-confirmed entitlement** — new ungated `GET /billing/status` returns `{entitled}`. On launch the app calls `refreshProToken()` then `confirmEntitlement()`; a **faked/expired local token is purged** (`clearProToken`) and the UI reverts to Free, so editing localStorage can't keep Pro unlocked while online.
- Dev-only `window.__AJENT_UNLOCK_ALL` remains for testing — non-persistent (window var, resets on reload) and only affects the client cap, never the crypto-gated backend.

## Payment → Pro-token flow — SCAFFOLDED (2026-08-28)
The build that turns Pro into revenue. The Pro token is only ever minted **after** a processor confirms real payment — we never see card data.
- **Worker** (`worker/src/billing.js`): Stripe Checkout (`/billing/checkout` → hosted checkout URL), signed webhook (`/billing/webhook`, `verifyStripeSignature` = constant-time HMAC over raw body + 5-min tolerance) → `handleStripeEvent` mints the token via `auth.issueProToken`. One-time redemption `/billing/token?session_id=`; launch refresh `/billing/refresh` (an expired-but-authentic token still proves ownership — `readProToken(...,{ignoreExp})`). `invoice.paid` renews, `customer.subscription.deleted` revokes. Prices come from env (`STRIPE_PRICE_MONTHLY/ANNUAL`), secrets via `wrangler secret` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Routes are UNGATED (they're how you become Pro).
- **Apple/Play**: `validateApple`/`validateGoogle` are explicit 501 stubs (real receipt validation TODO — App Store Server API + Play Developer API; then reuse `grant()`). Nothing silently passes.
- **App**: `backendApi.js` `startCheckout/redeemSession/refreshProToken/setProToken`; paywall CTA starts Stripe checkout on web when `backendConfigured()` (else stays early-access); `main.js` redeems `?session_id=` on return → `screens/proSuccess.js`; `paywall` treats `hasProToken()` as Pro.
- **Tests**: `worker/test/billing.mjs` — 16/16 (sig valid/wrong-secret/tampered/stale/missing, grant→redeem, minted-token-verifies, expired-refresh, forged-token rejected, renew, revoke). `npm run test:billing` (add script) or `node test/billing.mjs`.
- **Remaining to go live**: create Stripe products/prices + set secrets; register the webhook endpoint; deploy the Worker + set `window.__AJENT_API`; (later) real Apple/Play validation; legal review of terms/privacy.

## Signal export API — BUILT (2026-08-28) — the Pro moat, zero broker obligation
Decision (per user): the compelling Pro feature is **exporting signals to the user's OWN tools**, NOT real-money auto-execution. We stay strictly **educational** — Ajent posts the signal over a signed webhook; it never places an order, connects to a broker, or holds funds. Execution + risk stay entirely on the user's side.
- **Worker** (`worker/src/webhooks.js`): per-user (token `sub`) webhooks. Register/list/delete + `/webhooks/test`. Endpoints Pro-gated in `src/index.js`. `src/auth.js` gained `readProToken()` (returns `{sub,exp}`) so hooks scope per user.
- **Delivery**: `scheduler.js` `runTick` detects verdict flips INTO BUY/SELL + position open/close, and `deliverEvents()` POSTs each to matching hooks. Signed `X-Ajent-Signature: sha256=HMAC(rawBody, per-hook secret)` (GitHub/Stripe style). Only public https URLs (SSRF guard rejects localhost/private IPs). Auto-pauses a dead endpoint after 20 fails; never blocks trading.
- **Payload is educational-only**: `mode:'educational-simulated'` + `disclaimer`; carries signal/plan levels, **no order/execute/broker fields** (asserted in tests).
- **App** (`screens/signalExport.js`, shown in Settings): locked preview when no backend / not Pro → paywall; full add/list/delete + test when Pro+connected. Client methods in `backendApi.js` (`listWebhooks/createWebhook/deleteWebhook/testWebhooks`).
- **Tests**: `worker/test/webhooks.mjs` — 17/17 pass (URL guard, per-user limit/scoping, signed end-to-end delivery, educational payload, no-order-fields, inactive-skip). `npm run test:webhooks`.
- **Regulatory line held**: real-money auto-execution deliberately NOT built — would risk CTA/CPO (futures) or RIA (securities) registration + liability on an unproven-live strategy. Gate any future real-money path behind a proven live record + legal review.

## Free-tier market limit — ENFORCED (2026-08-28)
Per user: **Free auto-trades ONE market at a time; Pro unlocks all.** This is the first real gate turned on (ahead of store launch) as a conversion lever.
- Enforced in `state.js`: `FREE_MARKET_LIMIT = 1`, capped at **read time** in `getEnabledPaperMarkets()` (so it holds no matter what's stored) plus the setters (`setPaperMarketEnabled` = one-at-a-time swap; `setAllPaperMarkets`/`setPaperMarkets` = slice to 1). Gate = `isEntitled()` from `backendApi.js` (native purchase OR Pro token OR `window.__AJENT_UNLOCK_ALL`).
- UI (`screens/track.js`): "Auto-traded markets" shows a crown nudge "Free: 1 market at a time · Go Pro for all 43"; switches re-sync from real state after each action (enabling one visibly turns others off); "Select all" routes Free users to `#/paywall`.
- Paywall copy (`screens/paywall.js`) updated: Free = "Auto-trade one market at a time"; Pro = "Auto-trade all markets at once", "Trades 24/7".
- Verified in browser: default 8 → capped to 1; one-at-a-time swap works; Select-all→paywall; unlock override lifts cap to 43. 0 JS errors (only the known flaky-proxy network errors).
- Other conversion levers recommended (not yet built): see the levers list in the session notes — 24/7 trading, real-time data, Active-mode gating, push alerts, conviction filter, 7-day trial, show-locked-with-crown.

## Monetization — two tiers (2026-08-14)
- Simplified to **Free** and **Pro** (the phantom "Plus" never existed in code). Single source of truth: `FREE_FEATURES` / `PRO_FEATURES` in `screens/paywall.js`.
  - **Free:** both strategies (Active + Proven), core US index markets, full paper record, in-app signals/methodology. No card.
  - **Pro:** all 43 markets (crypto/commodities/global), real-time data, push alerts, high-conviction filter/alerts, position-size calculator.
- **Enforcement is OFF** for the free early-access launch — everything is unlocked for all users; the paywall shows the split + an "early access, all unlocked" note. On web, `isPro()` is always false (real IAP only in the native App Store build), so enforcing now would lock out every web user.
- **DECISION (2026-08-14):** keep everything unlocked & free for the web launch. Turn Pro gating ON only when publishing to the **Apple App Store + Google Play**. Until then Free = Pro in practice.
- [ ] **Turn on gating at store launch** — gate `PRO_FEATURES` behind `isPro()` (market lock in Markets/Home, push alerts, conviction filter, calculator). Reconcile pricing with the "Free" landing before flipping.
- [ ] **Android IAP gap** — `iap.js` currently registers **Apple App Store only** (cordova-plugin-purchase, `Platform.APPLE_APPSTORE`). Google Play billing must be added for Pro entitlement on Android, or Android stays free while iOS gates.

## AUDIT — post 2-week live feedback (2026-08-14)
Live result: **paper record losing most of the time.** Functional + navigational test: all 11 screens render, navigation works, **0 JS errors** after fixes.

Fixed this pass:
- **Market status** was quote-driven (couldn't say "Market open" until a proxy quote arrived; showed "Delayed" on any >2-min timestamp) → now **clock-based** (`marketHours.js`), instant + DST-safe.
- **Paper-trading closed/stale markets** → now only opens on a market that is **actually open** with a quote **<5 min old**. Trading closed markets on stale prices (buying a dip that reversed 15-25 min ago on the delayed feed) was a systematic loss source *independent of strategy*. Likely a big chunk of the live losses.
- **App icons**: iOS ignored the SVG icon (wrong home-screen logo) → real PNG apple-touch + maskable icons.
- **signalDetail crash** when a signal lacked `confluence` → guarded.

ROOT CAUSE (the honest core): the app is **client-only and depends on flaky free CORS proxies for delayed data**. That single fact drives most complaints — stale news, unreliable Buy/Sell, can't-trade-when-closed, and mispriced paper fills → losses. **These need a backend**, not more client tweaks.

Key findings still open:
- [ ] **Signal breakdown is stale/misleading** — the detail/breakdown screen still presents the OLD multi-indicator "confluence" model (EMA Stack, Supertrend, MACD, Ichimoku…) as if it drives the signal, but the real engine is pure **RSI2 mean-reversion + Bollinger**. The "why" shown to users does not match the actual logic. Rewrite the breakdown to reflect RSI2/Bollinger/trend honestly.
- [ ] **Strategy edge unproven live** — 2 weeks losing. Re-backtesting the same ~60-day free data would overfit. The honest options: (a) revert the default to the decade-validated **Proven daily** mode while Active is unproven; (b) rebuild on a **reliable data feed** (backend) before trusting any backtest. No indicator set can be *guaranteed* profitable.
- [ ] **Trade when app is closed** — impossible client-side; needs the backend below.

## Backend SCAFFOLDED (2026-08-14) — `backend/`
Deployable AWS SAM app: EventBridge (15 min) → Scheduler Lambda (server-side data
fetch → Proven daily signals → 24/7 paper trading) → DynamoDB; HTTP API (`/signals`,
`/trades`) for the app to read. Core logic verified against live data locally.
- [ ] **Deploy** — `cd backend && npm install && sam build && sam deploy --guided` (needs the user's AWS account). Then swap `src/data.js` for a licensed feed (Alpaca/Twelve Data/Polygon) for real-time reliability.
- [ ] **Connect the app** — point the app at the API `ApiUrl` (read signals/trades from the backend instead of computing client-side). This is what makes the app show the 24/7 server record.

## Recommended backend (the real fix — AWS serverless)
EventBridge Scheduler (cron, market hours) → **Lambda** (fetch real data from a proper API — Alpaca/Twelve Data/Polygon free tiers — compute signals, open/close paper trades) → **DynamoDB** (signals, positions, trades). **API Gateway** read endpoint the app calls instead of browser proxies. Solves: 24/7 trading, reliable + real-time data, fresh news, consistent signals. Cost ~a few $/mo at launch scale (free tier / Activate credits). Deploy needs the user's AWS account; the code/IaC can be scaffolded here.

## Improvement backlog (honest, evidence-gated)
- [ ] **Validate Active over more time** — only ~60 days of 15m history from the free feed. The live paper record is the true forward test; revisit thresholds once it accumulates.
- [ ] **Trim weak cells** — DAX-short, S&P-short, BTC-long were near break-even. Consider per-market/direction gating once live data confirms (avoid overfitting to 60 days).
- [ ] **Conviction position sizing for Active** — opt-in 1.5× exists for daily; extend if the RSI2+Bollinger high-conviction tier (PF ~1.4–1.5) proves out live.
- [ ] **Data feed reliability** — free CORS proxies rate-limit / go stale; a licensed/robust feed matters if the app goes commercial.
- [x] **Signal quality vs. frequency** (2026-08-14) — Active is ~100+ signals/day. Home "Top setups now" sorts high-conviction setups (deepest RSI2 + Bollinger extreme) to the top with a gold "High conviction" badge; the Markets screen has a **Conviction** filter chip to see them all. No PF is claimed on the badge — deliberately: the conviction tier is too rare to measure reliably on a 60-day backtest (very few trades), so its edge must be proven by the LIVE record, not a small-sample number. That validation is genuinely live-data-gated.

## Pending review
- **Live-tracker check** — evaluate Active mode's real profit factor, expectancy, and trade count from the in-app paper record (see [[ajent-signals-strategy]]).
