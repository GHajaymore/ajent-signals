# Ajent Signals — App Store & Google Play Listing Package

Copy-paste source for both consoles. Fill in every `[bracket]` before submitting.
This is copy prep only — it does not create accounts, upload builds, or submit anything.
See "What you still have to do yourself" at the bottom.

---

## App identity

| Field | Value |
|---|---|
| App name | **Ajent Signals** |
| Subtitle (Apple, 30 char max) | **Global Futures Signals** (22) |
| Short description (Google, 80 char max) | **Educational confluence signals for 35 global futures & index markets.** (68) |
| Category | Finance (primary) · Business (secondary, optional) |
| Age rating | Likely 4+ / Everyone via questionnaire — flag to counsel given CFTC-adjacent content (see note below) |
| Price | Free download, in-app subscription |
| Bundle ID / Package name | `[com.yourcompany.ajentsignals]` |
| Copyright | © 2026 [Your Company Legal Name] |
| Support URL | `[https://yourdomain.com/support]` |
| Marketing URL | `[https://yourdomain.com]` |
| Privacy Policy URL | `[https://yourdomain.com/privacy.html]` |

---

## Promotional text (Apple only — 170 char max, editable anytime without review)

> 7-day free trial. Confluence-scored BUY/SELL signals across 35 global futures & index markets — entry, stop, targets and R:R included. Educational only, never executes trades.

## Full description (Apple + Google, 4000 char max — same copy works for both)

```
Ajent Signals delivers educational buy/sell signals for 35 global futures & index markets — defaulting to a popular index for your region (E-mini S&P 500 in the US, Nifty 50 in India, FTSE 100 in the UK, and more), across US index, energy, metals, rates, crypto and ags futures plus major global indices.

HOW IT WORKS
Ajent scores 40+ trusted technical indicators — EMAs, VWAP, RSI, MACD, Supertrend, Ichimoku, order flow and smart-money concepts — into one weighted confluence score, confirmed across multiple timeframes. A BUY or SELL only appears once confidence clears your threshold (default 75%, adjustable). Below that, Ajent tells you plainly: "No trade — waiting for a high-probability setup."

EVERY SIGNAL INCLUDES
• Suggested entry, stop loss, and ATR-based trailing stop
• Three price targets with risk:reward
• A plain-language "why this signal" reasoning summary
• A full indicator-by-indicator confluence breakdown
• An interactive chart with entry/stop/target levels plotted

BUILT-IN RISK MANAGEMENT
A position-size calculator sizes contracts to your account balance and risk tolerance — so every trade idea comes with a risk-managed plan, not just a price.

STAY AHEAD OF THE TAPE
Opt-in push alerts for buy/sell signals, stops hit, targets reached, trend reversals, and high-volatility warnings. Signals automatically pause around high-impact CPI, FOMC, and jobs-report releases unless you choose to trade through them.

TRACK RECORD, NOT MARKETING
Win rate, average reward:risk, drawdown, and every closed signal — wins and losses — logged in your performance dashboard.

Free for 7 days, then continue with Ajent Pro ($39.90/mo or $39.90/yr).

IMPORTANT: Ajent Signals is an educational and informational tool only. It does not provide investment, financial, legal, or tax advice, and it does not execute trades or connect to any brokerage account. Trading futures involves substantial risk of loss and is not suitable for every investor. Past performance and any hypothetical results do not guarantee future returns. You are solely responsible for your own trading decisions. Not affiliated with CME Group, CBOT, NYMEX, COMEX, NSE, BSE, LSE, or any other exchange referenced in-app. CFTC Rule 4.41.
```

## Keywords (Apple, 100 char max, comma-separated, no spaces needed)

```
futures,trading signals,ES,S&P 500,day trading,technical analysis,confluence,risk management,alerts,charts
```

---

## Screenshots

Starting point: the 12 PNGs in `design_handoff_ajent/screens/` (390×812 reference frames). Both stores require **exact** device-frame sizes — these need to be re-exported at the sizes below (a design tool or simulator screenshot, not a resize of the existing PNGs, to avoid blurring):

- **Apple:** iPhone 6.9" (1320×2868) required; iPad 13" (2064×2752) if you support tablet.
- **Google:** Phone screenshots min 320px, recommend 1080×1920+; feature graphic 1024×500; icon 512×512 (Apple icon: 1024×1024, no alpha channel).

Recommended shots, in order: Home dashboard → Signal detail → Breakdown → Chart → Markets → Performance → Paywall.

---

## Apple App Review notes (paste into "Notes for Review")

```
Ajent Signals is an educational app that surfaces algorithmically-generated technical-analysis signals for global futures and index markets (US, India, UK, Europe, Asia-Pacific, and more). It does NOT execute trades, does NOT connect to any brokerage or exchange account, and does NOT hold funds — it is informational only.

A mandatory disclaimer + 4-point risk acknowledgement gate blocks all access until accepted (first screen after launch). Full risk disclosure and no-liability copy is in Settings and at [yourdomain.com/terms.html].

Market data and signals shown are illustrative pending our licensed real-time data vendor integration — this is disclosed in-app ("Market data delayed for demo") and will be replaced before this build is promoted from review/TestFlight to full release.

Subscription: 7-day free trial via StoreKit, then $39.90/mo or $39.90/yr, cancel anytime in App Store settings.
```

## Data safety / privacy questionnaire answers (Google Play "Data safety" section)

| Data type | Collected? | Shared? | Purpose |
|---|---|---|---|
| Email address | Yes | No | Account creation |
| User IDs | Yes | No | Account management |
| App activity / interactions | Yes | No | Analytics, app functionality |
| Crash logs, diagnostics | Yes | No | App functionality |
| Financial info (bank/card) | **No** — billing handled entirely by Apple/Google | — | — |
| Approximate location (country, from IP) | Yes — via a third-party IP-geolocation lookup | Yes, to that lookup provider | Sets the default featured market/watchlist to a popular index for your country |
| Precise (GPS) location | No | — | — |

All data encrypted in transit. Users can request account deletion (list the in-app or email path).

---

## What you still have to do yourself

I can't create accounts or submit apps — this package only prepares the copy. You'll need to:

1. Enroll in the **Apple Developer Program** ($99/yr) and **Google Play Console** ($25 one-time) — Apple recommends an Organization/Business account (DUNS number) for finance-category apps.
2. Fill in every `[bracket]` above — legal entity name, domain, support email, bundle ID.
3. Have a securities/CFTC-aware attorney review `terms.html`, `privacy.html`, and the review notes above — this is explicitly called out as required in the original product brief.
4. Re-export screenshots at exact device sizes (see above).
5. Complete each store's content-rating and data-safety questionnaires yourself (answers above are a starting point, not a submission).
6. Replace mock market data with a licensed CME-authorized feed before public release — App Review will reject (or later pull) a finance app that never graduates from illustrative data.
7. Upload the build via Xcode/Transporter (Apple) or Play Console (Google) once the native app exists — this web build is the design/spec reference; PRD.md/BUILD_GUIDE.md in the design handoff describe the React Native rebuild.
