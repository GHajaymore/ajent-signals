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

## 2. Add the custom domain
Pages project → **Custom domains → Set up a custom domain** → `ajent.<yourdomain>`.
Because the domain's DNS is on Cloudflare, it adds the CNAME for you and issues the
cert. Wait for **Active**. Existing subdomains are untouched.

## 3. (Optional) Give the Worker a branded API domain
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
