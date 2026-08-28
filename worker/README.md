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

## Connect the app
Set the Worker URL + the user's Pro token in the app:
```js
window.__AJENT_API = 'https://ajent-signals-worker.<you>.workers.dev';
// after a successful Pro purchase, the app also stores the token; backendApi.js
// sends it as the Authorization header.
```

## Cost
Cloudflare Workers free tier: 100k requests/day + cron included; KV free tier
100k reads + 1k writes/day. This workload sits inside it — effectively **$0** at
launch scale. Data feed: Yahoo $0, or Twelve Data free tier.

## Data provider
`src/data.js` — `DATA_PROVIDER=yahoo` (default) or `twelvedata` (+ `DATA_API_KEY`).
US index `td:` symbols are mapped in `src/markets.js`; add the internationals from
your Twelve Data dashboard. Add Alpaca/Polygon by writing one fetch function.
