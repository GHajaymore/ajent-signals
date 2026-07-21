# Ajent Signals — Product & Engineering Review

**Reviewer role:** Senior quantitative futures trader + product architect + UX designer + full-stack engineer
**Review date:** 2026-07-21
**Scope reviewed:** The `ajent-signals` static web app (HTML/CSS/vanilla-JS, no build step, GitHub Pages) as it exists in the repository today.

---

## ⚠️ Honesty preamble — read this before any other section

This review is deliberately constrained by one rule that overrides every recommendation below:

> **No backtest, win rate, Sharpe ratio, expectancy, or "indicator X is redundant" claim in this document is derived from testing, because no such testing exists in this codebase.** There is no historical OHLCV store, no backtester, and no live signal engine to test. Every quantitative statement about how indicators *behave* is labeled **[TA DOMAIN THEORY — hypothesis to validate empirically]**. Every statement about what the product *does today* is grounded in specific files and functions I read, and is labeled with the file/line.

The single most important finding of this review: **the app is an excellent, polished UI/UX prototype wrapped around a signal engine that produces random numbers.** That is not a criticism of the effort — it is a design prototype and was built as one. It *becomes* a serious problem the moment the product is marketed or sold as if the signals mean something, because several UI strings already assert analytical rigor the code does not perform. Closing that gap — honestly — is the entire job ahead.

---

## Table of contents

1. [Executive assessment](#1-executive-assessment)
2. [Critical defects](#2-critical-defects)
3. [Signal-engine assessment](#3-signal-engine-assessment)
4. [Recommended strategy architecture](#4-recommended-strategy-architecture)
5. [Feature-gap analysis](#5-feature-gap-analysis)
6. [UX redesign](#6-ux-redesign)
7. [Technical architecture](#7-technical-architecture)
8. [Testing framework](#8-testing-framework)
9. [Security checklist](#9-security-checklist)
10. [Prioritized roadmap](#10-prioritized-roadmap)
11. [Implementation plan](#11-implementation-plan)
12. [Acceptance criteria](#12-acceptance-criteria)

---

## 1. Executive assessment

### What this product actually is today

A static, no-backend web app that renders a professional-grade trading-signals UI. Reading the code top to bottom:

- **The "signal engine" is a mock.** `assets/js/app/mockEngine.js` → `MarketModel._genSignal()` sets `direction = rng() > 0.46 ? 1 : -1` (a biased coin flip) and `confidence = Math.round(38 + rng() * 58)` (a uniform random integer 38–96). The twelve indicator rows (EMA Stack, VWAP, RSI, MACD, ADX, Supertrend, Ichimoku, Bollinger, Volume Delta, Cumulative Delta, Stoch RSI, Market Structure) are **not computed from price data**. They are a fixed list that is shuffled, then assigned `bull`/`bear`/`neutral` states by counting off a `majority`/`minority`/`neutral` split that is itself *derived from the random confidence number* (`mockEngine.js` lines 196–206). Entry/stop/targets are fixed ATR-multiple offsets from the current price (`stop = entry − dir·ATR·1.0`, `target1 = +2.0·ATR`, `target2 = +3.2`, `target3 = +4.5`), where `ATR = price · atrPct` and `atrPct` is a **hardcoded per-symbol constant** in `MARKET_DEFS`, not a real 14-period ATR.
- **Some data is genuinely real.** `assets/js/app/liveData.js` fetches real *latest quotes* (not OHLCV history) for ~35 instruments from Yahoo Finance's unofficial chart endpoint, via public CORS proxies (`allorigins.win`, `corsproxy.io`). This is real price data from an **unlicensed, ToS-fragile, unauthenticated** source — fine for a demo, not viable for a paid product.
- **Persistence is entirely `localStorage`.** `assets/js/app/state.js` stores only a disclaimer-accepted flag and a settings object (threshold, riskPct, accountBalance, notifications, `subscription.tier`). **There is no backend, no database, no accounts, no auth, no server.**
- **"Performance history" is hand-seeded.** `track.js` renders win rate / R-multiples / monthly bars from the 10-row `CLOSED_SEED` array and a literal `monthlyR` array in `mockEngine.js` `performance()`. `maxDrawdownPct: 8.4` is a hardcoded literal.
- **The paywall is UI-only.** `paywall.js` "Start 7-day free trial" has no Stripe/StoreKit/Play Billing behind it. Nothing is charged and no subscription is created.
- **One piece of real, correct math exists.** `settings.js` → `computeRisk()`: `riskPerContract = |entry − stop| · pointValue`, `contracts = floor(balance · riskPct% / riskPerContract)`. This is textbook-correct position sizing — it just operates on mock entry/stop values.

### What is genuinely strong

- **UI/UX and design system.** The dark theme, disclaimer gate with verbatim legal copy, signal-detail Signal/Breakdown/Chart tabs, confidence ring, weighted indicator rows, and geo-personalized featured market are polished and closely match a professional design spec. This is real, transferable value.
- **Clean, dependency-light architecture.** ES modules, no framework, no build step, readable separation (`screens/`, `components.js`, `format.js`, `state.js`). Easy to reason about and to extend.
- **Real position-size calculator** and **real (if fragile) live quotes** show the team can wire real logic when it chooses to.
- **A working iOS pipeline.** `.github/workflows/ios-build.yml` produces a real signed `.ipa` via Capacitor; TestFlight upload is in progress (App Store Connect record created, not yet fully working).

### Overall verdict

| Dimension | Grade | One-line justification |
|---|---|---|
| UI / visual design | A− | Genuinely professional; matches spec. |
| Front-end code quality | B+ | Clean modules; a few UI strings overclaim. |
| Signal quality | **F (as a signal product)** | Signals are random; no TA math exists. |
| Data integrity | D | Real quotes, but unlicensed/ToS-fragile; no OHLCV history. |
| Backend / persistence | F | None exists. |
| Commercial readiness | D− | Paywall with no billing + rigor-claiming copy = legal/ethical risk. |
| Honesty of disclaimers | C+ | Disclaimer gate is good; several in-app strings contradict it. |

**Bottom line:** You have the *front half* of a credible product built to a high standard. The commercial-readiness gap is not "add more indicators" — it is "build a real signal engine, a real data pipeline, a real backend, and real billing, and stop asserting analytical rigor the software does not yet perform." This document lays out how, honestly.

---

## 2. Critical defects

Ordered by severity. Each: **problem → change → benefit → risks/tradeoffs → effort → success measure.**

### CD-1 — In-app copy asserts analytical rigor the engine does not perform

- **Problem.** `signalDetail.js` (Breakdown tab, line ~102) tells users: *"Weights adapt from historical performance without overfitting to any single indicator."* This is false — weights are the hardcoded `weight` fields in `INDICATORS` (`mockEngine.js` 44–57) and never adapt. `track.js` renders *"Model track record · last 90 days"* over 10 hand-seeded trades. The Chart tab lists overlay tags (EMA 20/50, VWAP, S/R, FVG) that are decorative — no overlays are drawn on the seeded line in `chartSvg()`. Combined with a paywall, statements like these can constitute misrepresentation of a financial product.
- **Change.** Immediately remove or rewrite every string that asserts computation/adaptation/track-record that is not actually performed. Until a real engine exists, label the app clearly as a **design preview / simulated demo** in-product (not only in the gate). Gate any "performance" screen behind an unmistakable "Illustrative sample data" banner.
- **Benefit.** Removes the largest legal/ethical exposure; aligns the product with the disclaimer it already ships.
- **Risks/tradeoffs.** Marketing may resist softer copy. The honest framing is non-negotiable while signals are mock.
- **Effort.** Small.
- **Success measure.** Zero in-app strings claim computation, adaptation, or real track record that the code does not perform (verified by a string audit / test — see §8, TEST-7).

### CD-2 — The signal engine is non-deterministic noise presented as analysis

- **Problem.** `_genSignal()` produces direction and confidence from `rng()` with no reference to price, volume, or history. Indicator states are back-derived from the random confidence, so the "confluence" bar and weighted rows are theater. `tick()` further jitters price randomly when live data is stale and regenerates the whole signal on a random 45–120s timer.
- **Change.** Treat the mock as a *fixture*, not a product. Build a real engine behind the same output contract (§4, §11). Keep the mock as an offline/demo fallback, explicitly flagged.
- **Benefit.** Everything downstream (cards, alerts, journal, analytics) becomes meaningful.
- **Risks/tradeoffs.** Large effort; requires real data (CD-3) first.
- **Effort.** Large.
- **Success measure.** A signal's direction, confidence, and every indicator state are reproducible from stored OHLCV inputs by an independent re-run (determinism test, §8).

### CD-3 — Data source is unlicensed, quote-only, and single-point-fragile

- **Problem.** `liveData.js` depends on Yahoo's unofficial endpoint through third-party CORS proxies. No OHLCV history is fetched — only `regularMarketPrice` + `chartPreviousClose`. Any real TA needs bars, not a single last price. Proxies and the endpoint can break or rate-limit at any time, and the ToS does not permit commercial redistribution.
- **Change.** Move data acquisition to a backend with a **licensed** feed (see §7). Fetch and persist OHLCV bars. Keep Yahoo/proxy path only as a clearly-labeled demo fallback.
- **Benefit.** Legally usable, reliable inputs; enables real indicators and backtesting.
- **Risks/tradeoffs.** Cost (market-data licensing) and infra. Non-negotiable for a paid product.
- **Effort.** Large.
- **Success measure.** All production signals computed from licensed OHLCV persisted server-side; zero client calls to unofficial endpoints in production builds.

### CD-4 — Paywall charges/creates nothing; "subscription" is a localStorage string

- **Problem.** `paywall.js` CTA has no billing integration; `state.settings.subscription.tier` is a client-editable localStorage value. Anyone can set themselves to any tier via devtools. Both pricing rows read "$39.90" (monthly and annual) — a copy bug that also undercuts trust.
- **Change.** Integrate real billing (StoreKit/Play Billing for mobile; Stripe for web) with **server-side entitlement checks**. Do not gate value on client state. Fix the pricing copy. **(Do not wire real billing until CD-1 copy is fixed and a real engine or an explicit "educational simulator" positioning is in place.)**
- **Benefit.** Actual revenue; tamper-resistant entitlements; correct pricing.
- **Risks/tradeoffs.** App-store review will scrutinize a signals app; positioning must match reality.
- **Effort.** Large.
- **Success measure.** Entitlements verified server-side; client cannot unlock Pro by editing storage; monthly/annual prices distinct and correct.

### CD-5 — No accounts/auth means no cross-device state, no server entitlements, no journal persistence

- **Problem.** Everything lives in one browser's `localStorage`. No login, so no way to sync watchlists/journal/settings, enforce entitlements, or recover data.
- **Change.** Add authentication (see §7) and a real datastore. Migrate settings/watchlist/journal server-side with local cache.
- **Benefit.** Retention (state follows the user), monetization (server entitlements), analytics.
- **Risks/tradeoffs.** Adds a backend + privacy/compliance surface. Required for production.
- **Effort.** Large.
- **Success measure.** A user logs in on a second device and sees identical watchlist/journal/settings.

### CD-6 — Alerts/notifications are simulated only

- **Problem.** `ALERTS_SEED` and the in-loop `onAlert` are entirely client-side; there are no push notifications when the app is closed (the settings toggles imply otherwise). No real economic-calendar guarding — `CALENDAR_SEED` is static.
- **Change.** Server-side signal evaluation + real push (APNs/FCM). Real calendar feed with a signal-pause window around high-impact prints.
- **Benefit.** The alert value proposition becomes real; core retention driver.
- **Risks/tradeoffs.** Requires backend + device-token management.
- **Effort.** Medium–Large.
- **Success measure.** A physical device receives a push for a qualifying signal with the app backgrounded.

---

## 3. Signal-engine assessment

### 3.1 What the engine does today (grounded in code)

`_genSignal()` in `mockEngine.js`:

```
direction   = rng() > 0.46 ? 1 : -1          // biased coin flip, ignores price
confidence  = round(38 + rng()*58)           // uniform 38..96, ignores price
majority    = clamp(round(3 + confidence/100 * 7), 3, 10)   // # indicators "agreeing"
minority    = round((12 - majority) * 0.45)                 // # "disagreeing"
neutral     = 12 - majority - minority
indicators  = shuffle(INDICATOR_LIST); assign first `majority` = agree, next `minority` = disagree, rest = neutral
plan.stop   = entry - dir*ATR*1.0 ; target1/2/3 = entry + dir*ATR*{2.0,3.2,4.5}
ATR         = price * atrPct   // atrPct hardcoded per symbol
```

**Consequences.** The confluence score is a re-encoding of one random number; indicator states carry **zero independent information** because none are computed. Asking "are these 12 indicators redundant?" is currently unanswerable from data — *by construction they are all perfectly dependent on `confidence`.*

### 3.2 On the user's question: "do the indicators provide independent information or duplicate each other?"

I cannot answer this empirically, and I will not fabricate an answer. What I *can* offer is domain theory to be tested once a real engine and OHLCV history exist.

**[TA DOMAIN THEORY — hypotheses to validate empirically, not results]**

The current 12-indicator list clusters into a few information families. In general TA practice these families tend to co-move, which *suggests* (does not prove) redundancy:

| Family | Indicators in current list | Hypothesis (to test) |
|---|---|---|
| Trend / moving-average state | EMA Stack, Supertrend, Ichimoku (cloud), MACD (sign), ADX (strength) | Highly correlated in trending regimes; likely 1–2 effective degrees of freedom, not 5. |
| Momentum / oscillators | RSI (14), Stoch RSI, MACD (histogram) | RSI and Stoch RSI are transforms of the same momentum; Stoch RSI often redundant with RSI. |
| Volatility / bands | Bollinger Bands, ATR (implicit) | Band width and ATR encode the same volatility state. |
| Order flow | Volume Delta, Cumulative Delta | Cumulative Delta is the running sum of Volume Delta — near-tautological pairing. |
| Structure | Market Structure (BOS), VWAP | Distinct-ish; VWAP is a mean-reversion/anchor reference, structure is discrete. |

**How to actually decide (the honest method), once real indicators exist:**
1. Compute each indicator's numeric output on a long OHLCV history.
2. Measure pairwise correlation and, better, **mutual information** and **variance inflation factor (VIF)** across indicators.
3. Do **feature-importance under walk-forward** (e.g., permutation importance of each indicator's marginal contribution to out-of-sample expectancy), not in-sample fitting.
4. Drop indicators whose marginal out-of-sample contribution is within noise. **Fewer, less-correlated inputs usually generalize better** — this is a general principle, not a result from this app.

**Recommendation (grounded in domain theory, explicitly not testing):** design the real engine to *start small* — one trend filter, one momentum trigger, one volatility/regime gate, one structure/level reference — and *earn* additional indicators only when walk-forward evidence shows independent marginal value. Do **not** ship 12 correlated indicators as if they were 12 independent votes.

### 3.3 Confidence scoring done right

**Problem with today's model.** `confidence` is a raw random 38–96 presented as a probability-like percentage, and the Signal tab pairs it with copy like "Long setup confirmed." A number that looks like a probability but is not calibrated is worse than no number.

**[TA DOMAIN THEORY + standard ML calibration practice]** Confidence should be a **calibrated probability of a defined outcome**, e.g. *P(trade reaches Target 1 before Stop, within the expected hold window)*, estimated from history and then **calibrated** so that "70%" empirically wins ~70% of the time.

- Produce a raw score from the strategy/features.
- Map score → probability with **Platt scaling** or **isotonic regression** fit on out-of-sample folds.
- Validate with a **reliability diagram** and **Brier score**; publish the calibration curve in-app.
- Present as a *probability with an outcome definition and a sample size*, never as "confirmed."

**Change / benefit / risk / effort / measure.**
- **Change:** replace the raw number with a calibrated `P(T1 before stop)` plus the outcome definition and n.
- **Benefit:** the headline number becomes trustworthy and defensible.
- **Risk:** requires real outcome history; must resist marketing pressure to inflate.
- **Effort:** Medium (after real engine + history exist).
- **Measure:** reliability-diagram deviation within tolerance on out-of-sample data (e.g. calibration error < 5% per decile); Brier score beats a naive baseline.

---

## 4. Recommended strategy architecture

Design target for the *real* engine that replaces `_genSignal()`. All performance language below is **[TA DOMAIN THEORY]**, to be validated per §8 before any public claim.

### 4.1 Regime-gated strategy families

No single strategy works in all conditions; the dominant failure mode of retail signal products is running a trend strategy in a range (and vice versa). Gate strategy families behind a **regime classifier** and only emit signals from families suited to the current regime.

| Strategy family | Fires when (regime) | Core logic sketch | Primary risk it addresses |
|---|---|---|---|
| **Trend-following** | Strong directional regime (e.g. high ADX / price extended from anchored VWAP) | Enter pullbacks in direction of higher-timeframe trend | Missing sustained moves |
| **Breakout** | Volatility compression → expansion; consolidation near range edge | Enter on confirmed range/level break with volume | Late entries after the move |
| **Mean-reversion** | Range regime (low ADX, price stretched from mean/band) | Fade extremes back toward VWAP/mean | Overtrading trends |
| **Momentum** | Persistent short-horizon momentum with participation | Continuation entries on momentum + order-flow confirmation | Buying exhaustion |
| **Opening-range / session** | Defined session opens (RTH open, key session) | Trade break/failure of the opening range | Ignoring intraday structure |

**Regime filter (the gate).** A classifier that labels the current environment (trend vs range vs high-vol event) from indicators like ADX, realized/implied volatility, VWAP distance, and time-of-day/session. Only strategies whitelisted for that regime may fire. Around high-impact economic events (real calendar, §5), **suppress new signals** in a configurable window.

- **Problem it solves:** poor entries during unsuitable conditions; overtrading; drawdowns from regime mismatch.
- **Change:** implement a `RegimeClassifier` + per-family `Strategy` modules feeding a `Confluence`/arbitration layer.
- **Benefit (hypothesized):** fewer, higher-quality signals; better behavior across market states.
- **Risks/tradeoffs:** more moving parts; regime classifiers can whipsaw at boundaries — needs hysteresis and validation.
- **Effort:** Large.
- **Measure:** out-of-sample performance **reported per regime** (see metrics table §8), plus reduced trade frequency vs an ungated baseline without loss of expectancy.

### 4.2 Signal lifecycle (replaces one-shot random regen)

Model a signal as a state machine, not a value that randomly re-rolls:

```
FORMING → ACTIVE(entry armed) → TRIGGERED(filled) → MANAGING(T1/T2/T3, trailing) → CLOSED(win/loss/expired) → INVALIDATED
```

Persist transitions server-side; drive alerts and the journal off real transitions rather than the current random timer in `tick()`.

---

## 5. Feature-gap analysis

Each gap: problem → change → benefit → risk → effort → measure. "Present but mock" is called out explicitly.

| # | Feature | Status today | Recommendation |
|---|---|---|---|
| F-1 | Real signal engine | **Mock** (`mockEngine.js`) | Build real engine (§4, §11). **Large.** |
| F-2 | Licensed OHLCV data + history store | **Missing** (quote-only, unlicensed) | Backend + licensed feed (§7). **Large.** |
| F-3 | Accounts / auth | **Missing** | Add auth + datastore. **Large.** |
| F-4 | Real billing / entitlements | **Mock** (`paywall.js`) | StoreKit/Play/Stripe + server entitlements. **Large.** |
| F-5 | Real push alerts | **Mock** (`ALERTS_SEED`) | APNs/FCM off server lifecycle events. **Medium–Large.** |
| F-6 | Trade journal | **Missing** | Log taken signals + outcomes; the retention backbone. **Medium.** |
| F-7 | Paper trading | **Missing** | Simulated fills against real quotes; safe engagement + honest track record. **Medium.** |
| F-8 | Watchlists (persisted) | **Partial** (`state.homeWatchlist`, not persisted server-side) | Persist per-user. **Small–Medium.** |
| F-9 | Real economic-calendar guarding | **Mock** (`CALENDAR_SEED`) | Real feed + signal-pause windows. **Medium.** |
| F-10 | Contract-roll handling | **Missing** | Front-month roll logic + continuous-contract stitching for history. **Medium.** |
| F-11 | WebSocket live updates | **Missing** (15s polling in `liveData.js`) | WS gateway for quotes + signal lifecycle. **Medium.** |
| F-12 | Analytics dashboard (real) | **Mock** (`track.js` seeds) | Compute from real journal/outcomes. **Medium.** |
| F-13 | Risk controls | **Partial** (position calc real; no daily-loss limits, no max-concurrent) | Add daily-loss cap, max concurrent positions, per-symbol exposure. **Medium.** |
| F-14 | Broker integration | **Missing (and gated)** | Keep **read-only / manual** until licensing/compliance cleared; do not auto-execute. **Large + legal.** |

**Signal-card completeness (F-1 adjunct).** A production signal card should carry: instrument + contract month, direction, calibrated probability + outcome definition + sample n, entry zone, stop, targets with R at each, current lifecycle state, time/regime context, invalidation condition, and expected hold. Today's card has most *fields* but mock *values*.

- **Problem it solves (F-6/F-7/F-12 together):** no honest track record, weak retention.
- **Benefit:** journal + paper trading generate the *real* outcome data that later powers calibration (§3.3) and analytics — a virtuous loop.
- **Risk:** must label paper results as paper; never conflate with live.
- **Measure:** % of active users with ≥1 journaled/paper trade; retention lift vs cohort without journal.

---

## 6. UX redesign

The UI is already strong; recommendations are targeted, honesty-first, and retention-oriented.

### UX-1 — Truth-in-labeling throughout (not just the gate)
- **Problem.** The disclaimer gate is good, but interior screens (Breakdown "weights adapt…", track "90-day track record") contradict it.
- **Change.** Persistent, low-friction "Simulated / Illustrative" markers on any screen showing modeled outcomes until real data backs them. Replace "confirmed" with probability + outcome definition.
- **Benefit / risk / effort / measure.** Trust; minor visual cost; **Small**; measured by the CD-1 string audit passing.

### UX-2 — Confidence presented as calibrated probability
- **Change.** Ring shows `P(T1 before stop) = X%` with a tap-through reliability diagram and sample size (§3.3). **Medium.** Measure: users can view calibration; support tickets about "what does confidence mean" drop.

### UX-3 — Signal lifecycle visualization
- **Change.** Show the state machine (§4.2) on the card and detail — FORMING/ACTIVE/TRIGGERED/MANAGING/CLOSED — with live countdown to invalidation. **Medium.** Measure: alert→open conversion.

### UX-4 — Journal & paper-trading as first-class tabs
- **Change.** "Take this signal" → adds to journal / paper account; outcomes auto-close. **Medium.** Measure: journaled-trade rate, D7/D30 retention.

### UX-5 — Real chart with real overlays (remove decorative tags)
- **Problem.** Chart tab overlay chips (EMA/VWAP/S/R/FVG) are decorative; `chartSvg()` draws only the seeded line + 3 level lines.
- **Change.** Render real indicator overlays from real series, or remove the chips until they are real. **Medium.** Measure: chips shown ⇔ overlays actually drawn (test).

### UX-6 — Speed/reliability
- **Change.** Skeleton loaders for live-data latency; graceful "SIM" badges already exist (`dataTag`) — extend to explain staleness; retry/backoff on the data layer. **Small–Medium.** Measure: perceived-load and error-rate telemetry.

### UX-7 — Onboarding that sets honest expectations
- **Change.** First-run flow explaining "educational signals, you place your own trades, past/simulated performance ≠ future results," then straight into paper trading. **Small.** Measure: activation rate.

---

## 7. Technical architecture

### Current (accurate)
- Static SPA, hash routing (`main.js`), ES modules, no build.
- Client polls quotes every 15s via CORS proxies (`liveData.js`).
- State in `localStorage` (`state.js`).
- Capacitor wrapper → iOS `.ipa` via GitHub Actions.

### Target (to support a real product)

```
┌──────────────┐   WSS/HTTPS   ┌──────────────────────┐
│  Client (SPA │◀─────────────▶│   API + WS Gateway    │
│  + Capacitor)│               │  (auth, entitlements) │
└──────────────┘               └──────────┬───────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
            ┌───────────────┐   ┌──────────────────┐   ┌───────────────┐
            │ Signal engine │   │  Market-data svc │   │  Datastore    │
            │ (regime+strat │   │ (LICENSED feed,  │   │ (users, subs, │
            │  +calibration)│   │  OHLCV history)  │   │  journal, TS) │
            └───────────────┘   └──────────────────┘   └───────────────┘
                    ▲
            ┌───────────────┐
            │ Backtester /  │  (offline: walk-forward, Monte Carlo, costs)
            │ research jobs │
            └───────────────┘
```

- **Backend:** an API + WebSocket gateway with auth (JWT/OAuth) and **server-side entitlement checks** (fixes CD-4/CD-5). *Note: an original `API_AND_DATA_MODEL.md` in the design-handoff package sketched a contract like this (Postgres+Timescale, WS gateway, JWT). It was never built — only the frontend consuming a similar shape (via the mock) exists. Treat that doc as aspirational, not as-built.*
- **Market data:** licensed OHLCV feed; persist bars (a time-series store) for indicators + backtesting. Retire the proxy path to demo-only.
- **Signal engine:** regime classifier + strategy modules + calibration layer (§4). Runs server-side; emits lifecycle events over WS.
- **Datastore:** users, subscriptions/entitlements, watchlists, journal, and time-series outcomes.
- **Billing:** StoreKit/Play (mobile), Stripe (web); webhooks → entitlements.
- **Push:** APNs/FCM keyed off signal lifecycle events.
- **Keep the strengths:** the current SPA and design system become the client of this backend with minimal UI rework. The mock engine survives as an offline/demo fixture behind a flag.

- **Effort:** Large (this is the real product build).
- **Measure:** the client renders identical UI driven entirely by server data; no unofficial-endpoint calls in prod; entitlements enforced server-side.

---

## 8. Testing framework

Two tracks: (A) software tests you can add now; (B) **quant validation standards to establish once a real engine exists** — explicitly a *future process*, not something already done.

### 8A. Software tests (add now)
- **TEST-1 Determinism:** given a fixed seed, `createEngine()`/`_genSignal()` output is reproducible (locks current behavior before refactor).
- **TEST-2 Position-sizing math:** unit-test `computeRisk()` against known cases (this is real math — protect it).
- **TEST-3 State hardening:** `loadSettings()` rejects corrupt/malicious `localStorage` (regression for the earlier hardening).
- **TEST-4 Live-data fallback:** proxy failure ⇒ `markLiveUnavailable` ⇒ SIM badge; no uncaught rejections.
- **TEST-5 Routing/render smoke:** each screen renders without throwing.
- **TEST-6 XSS regression:** markets search box stays escaped (prior fix).
- **TEST-7 Honesty audit:** automated scan asserting no in-app string claims computation/adaptation/track-record while the engine is mock (enforces CD-1/UX-1).

### 8B. Quant validation standards — **[FUTURE PROCESS, to establish once a real engine + licensed history exist. None of this has been done; do not present any output as achieved.]**

Required before *any* public performance claim:
- **Walk-forward analysis** (rolling in-sample fit → out-of-sample test); never report in-sample.
- **Out-of-sample / hold-out** on data never touched during design.
- **Monte Carlo** on trade sequence/parameters to bound luck and estimate drawdown distribution.
- **Realistic costs:** commissions, exchange fees, **slippage**, spread, and partial fills — futures results are cost-sensitive.
- **Regime-segmented reporting:** never a single blended number.

**Metrics to report (all out-of-sample, with sample size and date range):**

| Metric | Why it matters |
|---|---|
| Expectancy (avg R per trade) | Core edge measure. |
| Profit factor | Gross win / gross loss. |
| Max drawdown | Survivability. |
| Sharpe / Sortino | Risk-adjusted return (Sortino weights downside). |
| Avg win / avg loss (R) | Reward asymmetry. |
| Win rate | Only meaningful *with* R:R. |
| Trade frequency | Overtrading / practicality. |
| MAE / MFE | Stop/target placement quality. |
| Recovery factor | Net profit / max drawdown. |
| Performance by regime | Where the edge lives (and doesn't). |
| Calibration (Brier, reliability) | Whether "confidence" is honest (§3.3). |

- **Success measure for the framework itself:** a signal cannot be promoted to "live/production" until it clears predefined out-of-sample thresholds on this table, documented and reproducible.

---

## 9. Security checklist

Grounded in the current static app and the target backend.

**Current app**
- [x] **XSS in markets search** — already found and fixed (prior review). Keep TEST-6 as regression.
- [x] **`localStorage` hardening** — `loadSettings()` validates numeric fields / tolerates malformed JSON (prior fix). Keep TEST-3.
- [x] **No secrets in repo** — correct; there is no backend and only public unauthenticated endpoints, so no API keys exist to leak. Re-verify on every change.
- [ ] **Client-trusted entitlements** — `subscription.tier` in `localStorage` is user-editable (CD-4). Must move server-side.
- [ ] **Third-party proxy trust** — `liveData.js` routes data through `allorigins.win`/`corsproxy.io`; these can see/alter responses. Acceptable for demo only; remove in prod.
- [ ] **Output encoding sweep** — audit every `innerHTML` sink (screens build HTML by string concatenation) for untrusted interpolation beyond the fixed search fix.
- [ ] **CSP / SRI** — add a Content-Security-Policy and Subresource Integrity for any external assets (icon font, etc.).
- [ ] **PII/geo** — `geo.js` uses IP geolocation only to pick a default market; document this and avoid storing/transmitting it beyond session need.

**Target backend (when built)**
- [ ] Auth (JWT/OAuth), server-side authorization on every entitlement-gated route.
- [ ] Billing webhooks verified (signature checks); entitlements derived from provider, not client.
- [ ] Rate limiting, input validation, and audit logging on the API.
- [ ] Secrets in a vault/CI secrets store; never in the repo.
- [ ] Privacy policy + data-retention for journal/PII; regional compliance.

---

## 10. Prioritized roadmap

Sequenced so honesty and foundations come before monetization.

### Phase 0 — Honesty & hygiene (days, not weeks) — **do first**
- CD-1 copy fixes; UX-1 labeling; fix paywall pricing bug; add TEST-1..7.
- **Outcome:** the shipped app no longer overclaims. Legally defensible as an educational demo.

### Phase 1 — Real foundations
- Backend + auth + datastore (CD-5); licensed OHLCV + history (CD-3, F-2, F-10); WS gateway (F-11).
- **Outcome:** real, legal data flowing; state persists per user.

### Phase 2 — Real engine (behind existing UI)
- Regime classifier + strategy families (§4); lifecycle state machine (§4.2); calibration (§3.3).
- Stand up the quant-validation framework (§8B) — no public claims until it passes.
- **Outcome:** signals mean something and are validated out-of-sample.

### Phase 3 — Retention loop
- Journal (F-6), paper trading (F-7), real analytics (F-12), real push (F-5), real calendar guarding (F-9), risk controls (F-13).
- **Outcome:** honest track record accrues from real usage.

### Phase 4 — Monetization
- Real billing + server entitlements (CD-4); Pro gating; app-store submission aligned with honest positioning.
- **Outcome:** revenue on a defensible product.

### Later / gated
- Broker integration (F-14) — read-only/manual first; auto-execution only after legal/compliance clearance.

---

## 11. Implementation plan

Concrete modules, file names, and pseudocode. References the **actual** files above. The guiding principle: **keep the output contract of `market.signal` stable** so the polished UI (`signalDetail.js`, `home.js`, `markets.js`, `track.js`) keeps working while the engine behind it becomes real.

### 11.1 Freeze the contract, fixture the mock

`mockEngine.js` `_genSignal()` currently *is* the contract. Extract the shape it produces (`signal = { symbol, timeframe, direction, confidence, trend, volatility, expectedHold, plan{entry,stop,trailingStopPts,target1..3,riskReward}, reasons[], indicators[], confluence{bull,bear,neutral}, createdAt }`) into a documented TypeScript-style JSDoc typedef (e.g. `assets/js/app/signalContract.js`). Rename the mock to a fixture and flag it:

```js
// assets/js/app/engine/index.js
import { createMockEngine } from './mockEngine.js';   // moved, unchanged, flagged demo-only
import { createLiveEngine } from './liveEngine.js';    // new, talks to backend
export function createEngine(cfg) {
  return cfg.mode === 'live' ? createLiveEngine(cfg) : createMockEngine(cfg);
}
```

`state.js` line 28 (`engine: createEngine()`) becomes `createEngine({ mode: FLAGS.liveEngine ? 'live' : 'mock' })`. UI never changes.

### 11.2 Data layer: replace quote-only fetch with backend-served OHLCV

- Keep `liveData.js` as `liveData.demo.js` (unchanged, demo fallback).
- New `assets/js/app/data/marketFeed.js` subscribes to the WS gateway for quotes + bars; exposes the same `applyLiveQuote()`-style hook the UI already understands, plus `applyBars(ohlcv)`.

### 11.3 Real engine (server-side; client consumes results)

Server modules (language-agnostic pseudocode):

```
regimeClassifier(bars) -> { regime: 'trend'|'range'|'event', metrics }
  adx = ADX(bars, 14); vol = realizedVol(bars); vdist = distFromVWAP(bars)
  if calendarGuard.active(now): return 'event'      // F-9 pause window
  if adx > hiN and vdist large: return 'trend'
  if adx < loN: return 'range'
  ...

strategies = [TrendPullback, Breakout, MeanReversion, Momentum, OpeningRange]
eligible = strategies.filter(s => s.regimes.includes(regime))

candidates = eligible.map(s => s.evaluate(bars, features))   // each returns direction, rawScore, entry/stop/targets, invalidation
best = arbitrate(candidates)                                  // pick/merge; no double-counting correlated inputs

confidence = calibrate(best.rawScore)   // Platt/isotonic fit out-of-sample; = P(T1 before stop)
signal = toContract(best, confidence)   // MATCHES the frozen shape §11.1
```

Key replacements vs `mockEngine.js`:
- `direction = rng() > 0.46 ? 1 : -1` → `best.direction` from a regime-eligible strategy.
- `confidence = round(38 + rng()*58)` → `calibrate(rawScore)`.
- Indicator rows: **actually compute** each indicator on `bars`; state = derived from its real value (e.g. RSI>context ⇒ bull), *not* back-derived from confidence. Feed `REASONS`/`indicatorDetail()` from real values.
- `plan.*` ATR offsets: compute **real ATR(14)** from `bars`, not `price*atrPct`; keep the R:R structure the UI expects.

### 11.4 Lifecycle & alerts

- Server `SignalLifecycle` state machine (§4.2) persists transitions; emits WS events.
- Replace the client's random regen in `mockEngine.js` `tick()`/`nextUpdateSec` with server-driven updates.
- Push service (APNs/FCM) fires on transitions; `settings.js` notification toggles become real subscriptions.

### 11.5 Billing & entitlements

- Replace `paywall.js` CTA with real StoreKit/Play/Stripe flow.
- `state.settings.subscription.tier` becomes a **read-only reflection** of a server entitlement fetched after auth; UI gating checks the server, cached locally. Fix the `$39.90/$39.90` copy.

### 11.6 Journal, paper trading, analytics (make `track.js` real)

- New `journal` + `paperAccount` server models; "Take signal" writes an entry.
- `track.js` `performance()` reads **real** aggregates from the journal (win rate, R multiples, drawdown) instead of `CLOSED_SEED`/literal `monthlyR`. Keep the exact render shape so the UI is unchanged.

### 11.7 Backtester / research (offline)

- Standalone service consuming the persisted OHLCV: walk-forward, out-of-sample, Monte Carlo, realistic costs (§8B). Produces the calibration model consumed by §11.3 and the metrics table — **the only source permitted to back any public performance statement.**

### 11.8 Sequencing note
Ship §11.1 + Phase-0 honesty fixes *before* anything else — they are small, self-contained, and remove the biggest risk while the larger backend work proceeds.

---

## 12. Acceptance criteria

A feature is "done" only when its criteria hold. Grouped by phase.

**Phase 0 — Honesty & hygiene**
- [ ] No in-app string claims computation/adaptation/real track record while the engine is mock (TEST-7 passes).
- [ ] Any modeled-outcome screen carries a visible "Simulated / Illustrative" marker.
- [ ] Paywall shows correct, distinct monthly vs annual prices.
- [ ] TEST-1..7 green in CI.

**Phase 1 — Foundations**
- [ ] A user authenticates; watchlist/journal/settings persist and sync across two devices (CD-5).
- [ ] All production signal inputs come from a licensed OHLCV source persisted server-side; no unofficial-endpoint calls in prod builds (CD-3).
- [ ] Contract-roll handled: front-month selection + continuous history for indicators (F-10).

**Phase 2 — Real engine**
- [ ] Every signal's direction, confidence, and indicator states are reproducible from stored OHLCV by an independent re-run (CD-2 determinism).
- [ ] Indicator states are computed from indicator values, never back-derived from confidence.
- [ ] Signals fire only from regime-eligible strategy families; new signals suppressed in the calendar-guard window (§4).
- [ ] Confidence is a calibrated probability with a stated outcome definition and sample n; reliability diagram viewable in-app; calibration error within tolerance out-of-sample (§3.3).
- [ ] Quant-validation framework operational; no public performance claim exists that is not backed by out-of-sample results from it (§8B).

**Phase 3 — Retention loop**
- [ ] Users can journal/paper-trade a signal; outcomes auto-close and feed analytics.
- [ ] `track.js` metrics are computed from real journal data, not seeds (F-12).
- [ ] A backgrounded physical device receives a real push for a qualifying lifecycle event (F-5).
- [ ] Risk controls enforce daily-loss cap and max concurrent positions (F-13).

**Phase 4 — Monetization**
- [ ] Entitlements verified server-side; editing `localStorage` cannot unlock Pro (CD-4).
- [ ] Billing webhooks verified; subscription state derives from the provider.
- [ ] App-store positioning matches reality (educational signals; user places own trades; simulated/past performance ≠ future results).

**Global / non-negotiable**
- [ ] No document, screen, or marketing asset presents a win rate, Sharpe, expectancy, or "indicator X is redundant" claim that is not backed by out-of-sample testing that actually ran.
- [ ] Security checklist (§9) items closed for the shipped surface.

---

*Prepared as an honest engineering/product review. Every "today" statement is grounded in the referenced files; every quantitative statement about indicator behavior is labeled TA domain theory and is a hypothesis to validate empirically, not a result. No backtest, win rate, or performance figure in this document was produced by testing, because no such testing exists in this codebase yet.*
