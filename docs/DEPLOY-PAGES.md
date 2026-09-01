# Ajent on Cloudflare Pages → `ajent.<yourdomain>`

**Status: the app is already LIVE on Cloudflare Pages** at
**https://ajent-signals.pages.dev** (project `ajent-signals`, deployed 2026-08-29,
verified: `/app/` loads and calls the Worker cross-origin, 200, no CORS issues).
The app is path-portable (all relative URLs), so it runs at a domain root with **no
code changes**. Only `window.__AJENT_API` changes, and only if you also move the
Worker to a custom domain.

> **Isolation — won't touch your other subdomains.** `ajent.<yourdomain>` is purely
> additive: a new DNS record on an isolated Pages project, separate from
> `wikifoodia.<yourdomain>` or anything else you run. Pick a label not already in
> use. Nothing existing is modified.

## 1. Auto-deploy on every push (add ONE secret)
The project is **direct-upload**, so pushes deploy via the GitHub Action
`.github/workflows/deploy-pages.yml` (already in the repo). Enable it by adding one
repo secret:
- GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
- Name `CLOUDFLARE_API_TOKEN`; value = a token from Cloudflare → **My Profile → API
  Tokens → Create Token → "Edit Cloudflare Pages"**.

After that, every `git push` to `main` redeploys `ajent-signals.pages.dev`
automatically. (The account ID is inlined in the workflow; it isn't secret.)

## 2. Add the custom domain — **DONE 2026-09-01**

Live at **https://ajent.ajailabs.app** (`/` and `/app/` both 200, certificate issued
in under two minutes, http redirects to https).

> **Correction.** This section previously said the custom domain was "BLOCKED until
> DNS cutover finishes", and cited `wikifoodia.ajailabs.app` as evidence that "parts
> of the zone are migrated". **Both were wrong**, and acting on either would have
> triggered an unnecessary nameserver move.
>
> `ajailabs.app` nameservers are `ns59`/`ns60.domaincontrol.com` — GoDaddy. They
> always have been; no cutover was ever started or needed. Wikifoodia resolves
> because **Cloudflare Pages custom domains work fine on external DNS**, not because
> any part of the zone moved.

**The method that actually works, with DNS anywhere:**

1. Pages project → **Custom domains → Set up a custom domain** → `ajent.ajailabs.app`
2. When asked to choose a setup method, pick **"My DNS provider" → Begin CNAME
   setup**. **Do not** pick "Cloudflare DNS / Begin DNS transfer" — that starts a
   nameserver move you do not need.
3. Cloudflare shows a CNAME target. Add it at GoDaddy:

       CNAME   ajent   →   ajent-signals.pages.dev   (TTL 600)

4. Click **Check DNS records**. Activation and the certificate follow on their own.

Purely additive: `ajailabs.app`'s MX, SPF, both DKIM selectors, `autodiscover`,
`www` and `wikifoodia` records were all verified unchanged before and after.

## 3. (Optional) Give the Worker a branded API domain

> **This one genuinely does require the zone on Cloudflare.** Unlike Pages, Workers
> custom domains and routes only work when the domain's nameservers point at
> Cloudflare — Cloudflare has to control DNS in order to route. `ajailabs.app` is on
> GoDaddy, so this step is **not** available today. That is the real constraint the
> old section 2 was confusing itself with.
>
> The Worker is therefore still at `ajent-signals-worker.golferajay.workers.dev`.
> Three ways out, none taken yet:
>
> 1. **Rename the account's `workers.dev` subdomain** `golferajay` → `ajailabs`.
>    Free and instant, but it breaks *every* `*.golferajay.workers.dev` URL at once
>    — including the Stripe webhook — and the old subdomain may not be reclaimable.
>    The only genuinely one-way step of the three.
> 2. **Move `ajailabs.app` DNS to Cloudflare**, then do this section properly. The
>    zone carries live Microsoft 365 mail, so it needs care; the escape hatch is
>    that GoDaddy remains the registrar and can always point the nameservers back.
> 3. **Leave it.** Nothing is broken; only the personal handle is visible.
>
> Note the Worker **cannot** be folded into Pages Functions: `worker/wrangler.toml`
> declares `[triggers] crons = ["*/5 * * * *"]`, and cron triggers are Workers-only.
> That 5-minute loop is the product's core behaviour.

Worker (`ajent-signals-worker`) → **Settings → Domains & Routes → Add → Custom domain**
→ e.g. `api.ajent.<yourdomain>`. Then update the app:
```html
<!-- app/index.html -->
<script>window.__AJENT_API = 'https://api.ajent.<yourdomain>';</script>
```
and `git push`. The Worker already sends `Access-Control-Allow-Origin: *`, so no CORS
change is needed. (Skip this and the app keeps using the `…workers.dev` URL — that
works fine too.)

## 4. Retire GitHub Pages (optional, recommended)
Once the custom domain is live, either disable GitHub Pages for the repo or add a
canonical/redirect, so there aren't two public copies of the app. Point marketing and
the store listings at `ajent.<yourdomain>`.

## Notes
- No `_redirects` needed — `/` serves the landing, `/app/` serves the app, and routing
  inside the app is hash-based (client-side).
- If you ever add a build step with content-hashed filenames, revisit `_headers` to
  long-cache the hashed assets.
