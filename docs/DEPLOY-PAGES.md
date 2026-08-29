# Move the app to your domain — `ajent.<yourdomain>` on Cloudflare Pages

The app is already path-portable (all relative URLs), so it runs at a domain root
with **no code changes**. Only `window.__AJENT_API` changes, and only if you also
move the Worker to a custom domain.

> **Isolation — won't touch your other subdomains.** Adding `ajent.<yourdomain>`
> is purely additive: it's a new DNS record + its own Pages project, completely
> separate from `wikifoodia.<yourdomain>` or any other subdomain you already run.
> Just pick a label (`ajent`) that isn't already in use. Nothing existing is
> modified or overwritten.

## 1. Create the Pages project (Git-connected → auto-deploys on every push)
Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git** →
pick the `ajent-signals` repo. Build settings:

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Build command | *(leave empty)* |
| Build output directory | `/` (repo root) |

Save & Deploy → it publishes to `ajent-signals.pages.dev`. Open that and confirm the
app + `/app/` both load (they will — paths are relative). `_headers` in the repo
is applied automatically.

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
