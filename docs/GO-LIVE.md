# Ajent Signals — Go-Live Checklist

Everything in code is built + tested. Going live is config + secrets only — no more building.
Do **Part D in Stripe TEST mode first**, then flip to live keys. All `wrangler` commands run from `worker/`.

Prerequisites: a Cloudflare account (same one as your other apps is fine), a Stripe account, Node installed.

---

## Part A — Deploy the Worker (the Pro backend)

```bash
cd worker
npm install
npx wrangler login
```

Create the KV store, then paste the printed id into `worker/wrangler.toml` (`id = "..."`):

```bash
npx wrangler kv namespace create AJENT_KV
```

Deploy and note the printed Worker URL (e.g. `https://ajent-signals-worker.<you>.workers.dev`):

```bash
npx wrangler deploy
```

Sanity check (should print `{"ok":true}`):

```bash
curl https://ajent-signals-worker.<you>.workers.dev/health
```

Data feed: default is Yahoo ($0) — nothing to do. To use Twelve Data instead, set
`DATA_PROVIDER = "twelvedata"` in `wrangler.toml` and `npx wrangler secret put DATA_API_KEY`.

---

## Part B — Stripe products & prices

1. Stripe Dashboard → **Products** → create **"Ajent Pro"** with two recurring **Prices**: Monthly and Annual.
2. Copy both price IDs (`price_…`) into `worker/wrangler.toml` `[vars]`:
   - `STRIPE_PRICE_MONTHLY = "price_…"`
   - `STRIPE_PRICE_ANNUAL  = "price_…"`

---

## Part C — Secrets (this turns the Pro gate ON)

```bash
npx wrangler secret put STRIPE_SECRET_KEY      # sk_test_… while testing, sk_live_… for real
npx wrangler secret put PRO_SECRET             # any long random string — signs Pro tokens
```

Then create the webhook so payments issue tokens:

3. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
   - URL: `https://ajent-signals-worker.<you>.workers.dev/billing/webhook`
   - Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`, `customer.subscription.deleted`
4. Copy the endpoint's **Signing secret** (`whsec_…`):

```bash
npx wrangler secret put STRIPE_WEBHOOK_SECRET  # whsec_…
npx wrangler deploy                            # re-deploy so vars + secrets take effect
```

> Until `PRO_SECRET` is set the backend is **open to everyone** — set it before real launch.

---

## Part D — Point the app at the backend & test

1. In [`app/index.html`](../app/index.html), set:
   ```html
   <script>window.__AJENT_API = 'https://ajent-signals-worker.<you>.workers.dev';</script>
   ```
2. Commit + push (GitHub Pages redeploys the app).

**Test the whole loop in Stripe TEST mode:**

3. Open the app → **Settings → Upgrade** → pick a plan → pay with test card `4242 4242 4242 4242` (any future expiry/CVC).
4. You should land on **"You're Ajent Pro"**, the Paper tab market cap lifts to all markets, and **Settings → Signal export API** goes active.
5. Verify the gate from a terminal:
   ```bash
   curl https://ajent-signals-worker.<you>.workers.dev/signals            # -> 402 (no token)
   curl -H "Authorization: Bearer <token>" https://…/signals              # -> signals JSON
   ```
   (Grab `<token>` from the app: DevTools → Application → Local Storage → `ajent_pro_token`.)

**Flip to live** when satisfied: swap `sk_live_…`, the live price IDs, and a live-mode webhook secret; re-run the `secret put` commands; `npx wrangler deploy`.

---

## Still on your plate (not blocking web launch)

- **Apple / Google IAP** — `validateApple` / `validateGoogle` are honest 501 stubs. Building real receipt validation is required only for paid unlock **inside the native store apps**; web Stripe works without it.
- **Legal** — have a lawyer review `terms/` and `privacy/` before charging real money.
- **Waitlist endpoint** — landing `index.html` `WAITLIST_ENDPOINT` is still empty (sign-ups save to localStorage only).

## Appendix — test the payment loop with the Stripe CLI (before going live)

Do this in **Stripe test mode** (`sk_test_…`, test price IDs). Two ways:

### Option 1 — against the deployed Worker (simplest)
1. Install the Stripe CLI, then `stripe login`.
2. Forward Stripe's webhooks to your Worker and copy the printed `whsec_…`:
   ```bash
   stripe listen --forward-to https://ajent-signals-worker.<you>.workers.dev/billing/webhook
   ```
3. Set that CLI signing secret + test key as the Worker's secrets, and re-deploy:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET   # paste the whsec_ from `stripe listen`
   npx wrangler secret put STRIPE_SECRET_KEY       # sk_test_…
   npx wrangler secret put PRO_SECRET              # any long random string
   npx wrangler deploy
   ```
4. In the app (with `window.__AJENT_API` pointed at the Worker), go **Settings → Upgrade → pick a plan** and pay with test card `4242 4242 4242 4242` (any future expiry, any CVC/ZIP).
5. Watch the `stripe listen` terminal: you should see `checkout.session.completed` → `200`. The app returns to **"You're Ajent Pro"**, the market cap lifts, and Signal export goes active.

### Option 2 — fully local with `wrangler dev`
1. `cd worker && npx wrangler dev` (serves the Worker at `http://localhost:8787`; KV is local).
2. `stripe listen --forward-to localhost:8787/billing/webhook` and put the printed `whsec_…` in a local `.dev.vars` file (`STRIPE_WEBHOOK_SECRET=…`, `STRIPE_SECRET_KEY=sk_test_…`, `PRO_SECRET=…`).
3. Set `window.__AJENT_API = 'http://localhost:8787'` and run the app locally; test the same 4242 checkout.

### Quick checks
- Webhook handler responds (synthetic event; won't mint a redeemable token, just verifies 200 + signature):
  ```bash
  stripe trigger checkout.session.completed
  ```
- Gate works: `curl https://…/signals` → **402**; with `-H "Authorization: Bearer <token>"` → signals JSON.
- Entitlement purge: put a junk value in localStorage `ajent_pro_token`, reload — with the backend live it should clear and revert to Free (that's `/billing/status` + `confirmEntitlement` doing its job).

> The authoritative end-to-end test is a **real checkout from the app** (Option 1/2 step 4) — `stripe trigger` uses synthetic IDs not tied to a session the app started, so the token-by-session redemption won't line up. Use `trigger` only to confirm the handler + signature verification respond.

## Costs
- **Cloudflare**: Worker + KV stay in the free tier (writes are batched — see `worker/README.md`). Effectively $0 at launch scale.
- **Stripe**: ~2.9% + 30¢ per charge, no monthly fee. You never handle card data.
- **Data**: Yahoo $0 (or Twelve Data free tier).
