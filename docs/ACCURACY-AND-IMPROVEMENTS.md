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
