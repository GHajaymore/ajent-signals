# Ajent Signals — Cloudflare Worker (the Pro backend)

The 24/7 server-side signals + paper trading, on Cloudflare. Cheaper and simpler
than AWS for this (no cold starts, generous free tier). **This backend IS the Pro
tier** — Free users run entirely client-side (in their browser, on delayed data,
only while the app is open); Pro users get this Worker (24/7 trading, real-time
reliable data, all markets, alerts). The gate on these endpoints is the paywall.

```
Cron (every 15 min) ──► runTick ──► fetch data ──► signals ──► open/close paper trades ──► KV
                                                                                            ▲
                              GET /signals · GET /trades  (Pro-gated) ◄──── the app ────────┘
```

## Deploy
```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create AJENT_KV      # paste the id into wrangler.toml
npx wrangler deploy
```
Optional:
```bash
npx wrangler secret put DATA_API_KEY   # if you set DATA_PROVIDER=twelvedata
npx wrangler secret put PRO_SECRET     # turns the Pro gate ON (see below)
```
The deploy prints the Worker URL — that's what the app calls.

## Tiers (Free vs Pro)
| | Free (client-side) | Pro (this Worker) |
|---|---|---|
| Trades when app closed | no | **yes, 24/7** |
| Data | delayed (free proxies) | **real-time, reliable** |
| Markets | core US | **all** |
| Strategy | Proven daily | **+ Active** |
| Alerts / conviction filter | no | **yes** |
| Cost to you | $0 | Worker + data feed |

## The Pro gate
`/signals` and `/trades` require `Authorization: Bearer <token>`. The token is a
signed bearer (`src/auth.js`, HMAC of `{sub, exp}` with `PRO_SECRET`) that **your
payment flow issues after verifying the purchase server-side**:
- **Web:** a Stripe subscription → your webhook verifies it → call `issueProToken(userId, 31, PRO_SECRET)` → return it to the app.
- **iOS/Android:** validate the App Store / Play receipt server-side → issue the same token.

The app stores the token and sends it on every backend call. **Until you set
`PRO_SECRET`, the gate is open** (so you can wire things up first).

## Signal export API (the Pro "API into your own tooling")
Pro's headline feature — **without any broker obligation**. A Pro user registers a
webhook URL (their own bot, a TradingView alert relay, Zapier, a Discord relay…);
when a fresh signal fires, the Worker POSTs a **signed, educational** payload there.
**We never place an order or touch a broker** — we hand over the signal; the user
decides what to do with it. This keeps Ajent squarely educational.

Endpoints (all Pro-gated, scoped to the token's `sub`):
| Method | Path | Purpose |
|---|---|---|
| GET | `/webhooks` | list your webhooks |
| POST | `/webhooks` `{url, events?}` | register (returns a one-time signing `secret`) |
| DELETE | `/webhooks/<id>` | remove one |
| POST | `/webhooks/test` | send a sample event to your webhooks |

`events` ⊆ `["signal","position.open","position.close"]` (default: all). Max 5 per user.
Only **public https** URLs are accepted (localhost/private ranges rejected).

**Payload** (educational — no order fields ever):
```json
{ "type":"signal", "event":"BUY", "symbol":"ES", "price":5123.5,
  "strategy":"Proven daily (RSI2 mean-reversion)", "conviction":"high",
  "plan":{"entry":5123.5,"stop":5108,"target1":5139}, "rsi2":7.8,
  "mode":"educational-simulated", "disclaimer":"Educational signal only…" }
```
**Verify it's really us:** each POST carries `X-Ajent-Signature: sha256=<hex>` =
HMAC-SHA256 of the raw body with your webhook's `secret`. Recompute and compare.

A dead endpoint is retried best-effort and auto-paused after repeated failures;
delivery never blocks the trading loop. Local test: `npm run test:webhooks`.

## Connect the app
Set the Worker URL + the user's Pro token in the app:
```js
window.__AJENT_API = 'https://ajent-signals-worker.<you>.workers.dev';
// after a successful Pro purchase, the app also stores the token; backendApi.js
// sends it as the Authorization header.
```

## Cost & shared-account fit
Cloudflare Workers free tier: 100k requests/day + cron included; KV free tier
100k reads + **1k writes/day** — and **KV writes are account-wide**, shared with
any other apps on the same Cloudflare account. To stay well inside that (and not
starve your other apps), each cron tick writes **one batched `SIGNALS` blob**
instead of one key per market: **~96 signal writes/day** (96 ticks) rather than
96×8≈768. Position/trade writes only happen on real open/close events (a handful
/day). So the whole Worker sits comfortably in the free tier alongside other
apps — effectively **$0** at launch scale. Data feed: Yahoo $0, or Twelve Data
free tier. (If Ajent later has paying users, the $5/mo Workers Paid plan lifts
KV writes to 1M/day and removes the shared-quota concern entirely.)

## Data provider
`src/data.js` — `DATA_PROVIDER=yahoo` (default) or `twelvedata` (+ `DATA_API_KEY`).
US index `td:` symbols are mapped in `src/markets.js`; add the internationals from
your Twelve Data dashboard. Add Alpaca/Polygon by writing one fetch function.
