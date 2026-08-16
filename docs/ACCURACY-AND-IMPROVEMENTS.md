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
- 2026-08-14 — News frozen: `news.js` missing `cache:'no-store'` and tried the dead `allorigins` proxy first → added no-store + corsproxy-first + timeout.
- 2026-08-14 — Landing page + showcase still said "long-only" after Active went both-ways → corrected (long-only now scoped only to Proven daily).
- 2026-08-07 — SIM/no-feed markets fabricated confident BUY/SELL → now read "No trade".
- 2026-08 — Removed fabricated landing stats (68% win, fake trades/testimonials).

## Launch / marketing (2026-08-14)
- Public landing page (`index.html`) is now the showcase design: hero, phone mockups, "Open the app free" CTA → `/app/`, and an email **waitlist** form. Chosen model (per user): open app + email waitlist now; real accounts (Cognito/Clerk + serverless backend) later when they sync data or gate a paywall.
- [ ] **Wire the waitlist endpoint** — `index.html` script has `WAITLIST_ENDPOINT=''`; until set, sign-ups only save to the visitor's localStorage (not collected). Paste a Formspree form ID (2-min) OR scaffold an API Gateway→Lambda→DynamoDB(+SES) endpoint.
- [ ] **Add social preview image** — `assets/img/og-cover.png` (1200×630) referenced by OG/Twitter tags but not yet created; links currently share with no image.

## Improvement backlog (honest, evidence-gated)
- [ ] **Validate Active over more time** — only ~60 days of 15m history from the free feed. The live paper record is the true forward test; revisit thresholds once it accumulates.
- [ ] **Trim weak cells** — DAX-short, S&P-short, BTC-long were near break-even. Consider per-market/direction gating once live data confirms (avoid overfitting to 60 days).
- [ ] **Conviction position sizing for Active** — opt-in 1.5× exists for daily; extend if the RSI2+Bollinger high-conviction tier (PF ~1.4–1.5) proves out live.
- [ ] **Data feed reliability** — free CORS proxies rate-limit / go stale; a licensed/robust feed matters if the app goes commercial.
- [x] **Signal quality vs. frequency** (2026-08-14) — Active is ~100+ signals/day. Home "Top setups now" sorts high-conviction setups (deepest RSI2 + Bollinger extreme) to the top with a gold "High conviction" badge; the Markets screen has a **Conviction** filter chip to see them all. No PF is claimed on the badge — deliberately: the conviction tier is too rare to measure reliably on a 60-day backtest (very few trades), so its edge must be proven by the LIVE record, not a small-sample number. That validation is genuinely live-data-gated.

## Pending review
- **Live-tracker check** — evaluate Active mode's real profit factor, expectancy, and trade count from the in-app paper record (see [[ajent-signals-strategy]]).
