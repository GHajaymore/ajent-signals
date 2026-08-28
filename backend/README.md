# Ajent Signals — Backend (24/7 signals + paper trading)

The web app is client-only: when it's closed, nothing runs, and in the browser it
depends on flaky free CORS proxies for **delayed** data. This backend fixes both.

**What it does:** a scheduled Lambda pulls market data **server-side** (no CORS),
computes signals, and runs the paper-trading account **24/7 in DynamoDB** — whether
or not anyone's app is open. A tiny HTTP API lets the app (and anything else) read
the current signals and the paper record. The app becomes a thin, fast client.

```
EventBridge (every 15 min)
      │
      ▼
  Scheduler Lambda ── fetch data ── compute signals ── open/close paper trades
      │                                                        │
      └──────────────────────► DynamoDB ◄─────────────────────┘
                                   ▲
                     HTTP API ─────┘  GET /signals · GET /trades
                        ▲
                     the app
```

## Why this fixes the live complaints
- **Trades when the app is closed** — the schedule runs server-side, always.
- **Reliable + real-time data** — swap the Yahoo fetch in `src/data.js` for a real
  API (Alpaca / Twelve Data / Polygon — all have free tiers) with your key; no more
  browser proxies, no CORS, no 15–25 min futures delay.
- **Consistent signals & fresh news** — computed once, server-side, on a schedule.
- **No mispriced fills** — the server only trades markets that are actually open
  on current data (`src/markets.js` hours), the same fix now in the client.

## Deploy (SAM)
```bash
cd backend
npm install
sam build
sam deploy --guided        # first time: pick a stack name + region
```
The output `ApiUrl` is what the app calls. Point the app at it by setting
`window.__AJENT_API` (see `docs/` note) or a build-time constant.

## Cost
PAY_PER_REQUEST DynamoDB + a 15-min Lambda + HTTP API ≈ **a few dollars/month** at
launch scale — comfortably inside the AWS free tier / Activate credits.

## Data source
`src/data.js` currently fetches daily candles from Yahoo's public chart endpoint
**server-side** (reliable enough to start, no CORS). For production, replace
`fetchDailyCandles` with a licensed feed and set the API key as a Lambda env var.

## Strategy
`src/strategy.js` implements the **Proven daily** long-only Connors mean-reversion
(the app's validated default): RSI2<10 flush below the prior day's low in a 200-day
uptrend, exit on the first green close, 2×ATR stop, 5-day cap. Keep it in sync with
`assets/js/app/signalEngine.js` (daily branch).
