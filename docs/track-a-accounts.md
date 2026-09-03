# Accounts · Track A — Identity + 30-day trial gate

**Status:** planned (design only — not started).
**Companion:** the "Ajent Accounts" design brief (old-vs-new, recommended stack, cost, store rules).
This doc is the execution spec for **Track A only** — the identity layer and trial gate. Tracks B
(per-user data / server-synced settings) and C (passkeys, refresh rotation) are out of scope here.

**Sequencing:** independent of the multi-asset work, but if both are planned do **Phase 0 → Track A**.
Track A does **not** change the shared paper record — it only adds *who is signed in* and the trial
clock. Per-user data is Track B.

---

## 1. Objective & non-goals

**Objective.** Let someone create a free account (email code, or Google/Apple), receive a **30-day
trial**, and gate access on **trial-active OR paid** — reusing the signed-token + billing systems that
already exist (`worker/src/auth.js`, `billing.js`).

**Non-goals for Track A (hard boundaries):**
- **No server-side settings** and **no per-user paper accounts** — the app keeps running on the one
  shared record. (Track B.)
- **No passkeys, no refresh-token rotation.** (Track C.)
- **No forced migration** — anonymous browsing still works; existing users aren't logged out.

**Done when:** a new user signs up → 30-day trial → full access; trial lapses → existing Free tier
(never a hard lockout); a purchase (web Stripe / mobile IAP) reconciles to the account as Pro;
in-app account deletion wipes PII; and no gated request does a per-request DB read (tier is carried
in the token, refreshed periodically).

---

## 2. What already exists (reuse, don't rebuild)

- `auth.js` — HMAC-signed tokens: `issueProToken(sub, ttlDays, secret)`, `readProToken(token, secret,
  {ignoreExp})`, `requirePro(request, env)` → `{ok, sub}`. `sub` is the user id.
- `billing.js` — `createCheckoutSession`, `handleStripeEvent`, `tokenForSession`, `refreshToken`,
  **`validateApple({receipt, sub})`**, **`validateGoogle({purchaseToken, productId, sub})`**,
  `PLAN_TTL_DAYS`. Every purchase path already takes a `sub`.
- `db.js` — KV wrapper (`get`/`put` by `pk`/`sk`). Keep for signals/record + short-lived OTP codes.
- Client `backendApi.js` — `base()`, `backendConfigured()`, `hasProToken()`, `refreshProToken()`,
  `confirmEntitlement()`, `redeemSession()`, `isEntitled()`.

**The shift:** today the token *is* the entitlement (a Pro token = access). Track A makes the token
prove **identity** (`sub`) and carry an entitlement **snapshot** (`tier` + `exp`); the durable truth
lives in the D1 `users` row and is re-stamped into the token on refresh. This keeps hot paths
stateless (no DB read per request) while entitlement stays fresh within hours.

---

## 3. Data model

### 3.1 Durable user records → Cloudflare D1 (new)
```sql
-- migrations/0001_users.sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,        -- uuid; this is the token `sub`
  email         TEXT UNIQUE,             -- nullable (social-only), lowercased
  provider      TEXT NOT NULL,           -- 'email' | 'google' | 'apple'
  provider_sub  TEXT,                    -- google/apple subject id (unique per provider)
  created_at    INTEGER NOT NULL,        -- ms
  trial_ends    INTEGER NOT NULL,        -- ms; created_at + 30d
  pro_until     INTEGER,                 -- ms; null until a purchase
  pro_source    TEXT,                    -- 'stripe' | 'apple' | 'google' | null
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'deleted'
  deleted_at    INTEGER
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_provider ON users(provider, provider_sub);
```
Provision: `wrangler d1 create ajent-users` → bind as `env.DB` in `wrangler.toml` → apply the
migration. Add `worker/src/d1.js` with `getUserById`, `getUserByEmail`, `getUserByProvider`,
`createUser`, `setPro(sub, until, source)`, `softDelete(sub)`.

### 3.2 Ephemeral login codes → KV with TTL (reuse `db.js`)
OTP codes are short-lived — KV's `expirationTtl` auto-cleans them, and volume is low.
```
key:  LOGIN#<sha256(email)>   value: { codeHash, expires, attempts }   TTL: 600s (10 min)
```

### 3.3 The `tier` derivation (single source of truth)
```js
function tierFor(user, now = Date.now()) {
  if (!user || user.status === 'deleted') return 'anon';
  if (user.pro_until && user.pro_until > now) return 'pro';
  if (user.trial_ends > now) return 'trial';
  return 'free';                       // lapsed trial → existing Free tier, NOT locked out
}
```

---

## 4. Token changes (`auth.js`)

Generalise the existing signed token to carry identity + entitlement snapshot:
```js
// payload: { sub, tier, iat, exp }   (exp short-ish, e.g. 12h; refreshed by the client)
export async function issueIdentityToken(sub, tier, ttlHours, secret) { /* like issueProToken */ }

// verify signature + not expired; return identity + snapshot. No DB read.
export async function requireAccess(request, env) {
  const t = bearer(request);
  const claims = await readProToken(t, env.PRO_SECRET);      // reuse verifier
  if (!claims) return { ok: false, reason: 'signed-out' };
  const tier = claims.tier || 'anon';
  return { ok: tier === 'trial' || tier === 'pro', sub: String(claims.sub), tier };
}
```
Keep `requirePro` for strictly-Pro endpoints (webhooks export, etc.); use `requireAccess` for
trial-or-Pro features. Anonymous (no token) endpoints — shared `/signals`, `/live` — stay ungated.

---

## 5. Endpoints (new — a `worker/src/authRoutes.js`, dispatched from `index.js`)

All POST bodies JSON. All responses `no-store`. Rate-limit by IP + email; require a **Turnstile**
token on `request-code`.

| Route | Body | Does |
|---|---|---|
| `POST /auth/request-code` | `{ email, turnstile }` | Verify Turnstile; make a 6-digit code; store `sha256(code)` in KV (TTL 10 min); email it via Resend. Always return `{ ok: true }` — **never reveal if the email exists.** |
| `POST /auth/verify-code` | `{ email, code }` | Check KV (max 5 attempts, then burn); upsert `users` (create → 30-day trial); issue identity token. Return `{ token, tier, trialEnds }`. |
| `POST /auth/oauth/google` | `{ idToken }` | **Verify** the Google ID token against Google's certs (never trust client claims); extract `sub`/`email`; upsert; issue token. |
| `POST /auth/oauth/apple` | `{ identityToken }` | **Verify** the Apple JWT against Apple's public keys; upsert; issue token. |
| `POST /auth/refresh` | Bearer (grace on exp) | Reuse `readProToken(..., {ignoreExp:true})` for ownership; load `users`; recompute `tierFor`; re-issue token. Return `{ token, tier, trialEnds, proUntil }`. |
| `GET  /auth/me` | Bearer | `{ sub, email, tier, trialEnds, proUntil }`. |
| `POST /auth/delete` | Bearer | `softDelete`: `status='deleted'`, null `email`/`provider_sub`, set `deleted_at`. Client drops the token. **Store-mandated.** |

**Entitlement reconciliation (extend, don't replace).** The existing Stripe webhook /
`validateApple` / `validateGoogle` paths already carry a `sub` — on success they now call
`setPro(sub, until, source)` on the D1 row. Linking the purchase to the identity:
- **Web / Stripe:** pass the signed-in `sub` as `client_reference_id` in `createCheckoutSession`.
- **Mobile / IAP:** pass the signed-in `sub` into `validateApple`/`validateGoogle` (already the arg).
Next `/auth/refresh` re-stamps the token to `tier:'pro'`.

---

## 6. Client changes (`backendApi.js` + a sign-in screen)

- **Token:** store the identity token in `localStorage`; send `Authorization: Bearer` on gated calls.
- **Sign-in UI:** a screen/modal — email field → code entry, plus Google & Apple buttons (native
  sign-in plugins in the Capacitor wrappers; web OAuth on the web). Anonymous browsing still allowed;
  prompt for signup when a user hits a trial/Pro feature.
- **`isEntitled()`** now reads `tier` from the token / `GET /auth/me` (`trial` or `pro`) instead of the
  local `subscription:{tier:'trial'}` default. Lapsed → `free` (the existing limited tier).
- **Refresh:** call `/auth/refresh` on launch and every few hours, so a purchase or trial lapse
  reflects without re-login.
- **Delete account:** a Settings action → `POST /auth/delete` → clear local token → back to anonymous.

---

## 7. Email + secrets

- **Resend** (free ~3k/mo). Sending domain on `ajailabs.app` (Cloudflare DNS already there) — add
  SPF/DKIM. Env: `RESEND_KEY`.
- New secrets: `RESEND_KEY`, `TURNSTILE_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `APPLE_*` (team/key/kid for
  Apple token verification). `PRO_SECRET` already exists (token signing).
- `wrangler.toml`: bind D1 (`env.DB`) and the Turnstile/OAuth vars.

---

## 8. Security checklist

- OTP: 6 digits, 10-min TTL, **max 5 attempts** then burn the code, rate-limit requests per email + IP,
  Turnstile on `request-code`. Codes stored **hashed**, never plaintext.
- Never reveal whether an email is registered (uniform responses).
- OAuth: **verify provider tokens server-side** against Google/Apple public keys — never trust the
  client-supplied identity.
- Tokens HMAC-signed with `PRO_SECRET`; short access TTL + refresh; `sub` is an opaque uuid.
- PII is minimal (email only) and hard-deletable (`/auth/delete`). Add a privacy policy + data-export
  path (GDPR/CCPA basics) — this is also store-required.

---

## 9. Execution order (each step shippable)

1. **D1 provision + `users` schema + `d1.js` helpers.** No behaviour change yet.
2. **`auth.js`:** `issueIdentityToken` + `requireAccess` + `tierFor`. Keep `requirePro`.
3. **Email OTP:** `request-code` / `verify-code` + KV code store + Resend + Turnstile.
4. **OAuth:** `google` / `apple` endpoints with real provider verification.
5. **Reconcile entitlement:** Stripe webhook + `validateApple`/`validateGoogle` → `setPro(sub,…)`;
   pass `sub` through checkout / IAP validation.
6. **`/auth/me`, `/auth/refresh`, `/auth/delete`.**
7. **Client:** token storage, sign-in screen, `isEntitled` from server tier, delete-account UI,
   refresh loop.
8. **Store compliance:** Sign in with Apple (required once Google is offered), the delete-account
   flow, privacy policy.

---

## 10. Invariants & risks

| Item | Rule / mitigation |
|---|---|
| Shared record unchanged | Track A gates access only; the paper record stays one shared account. Per-user = Track B. |
| Anonymous still works | No token → shared signals/record as today; signup only unlocks trial/Pro features. |
| Hot-path cost | Tier lives in the token (stateless verify); DB read only on `refresh` / `me` / auth, not per poll. Keeps D1 well under the 5M-reads/day free tier. |
| Existing Pro buyers | Purchase paths already carry `sub`; link to the account via `client_reference_id` / IAP `sub`. Keep `requirePro` working during rollout. |
| KV vs D1 | Durable users → D1; ephemeral OTP codes → KV TTL. Never `list()` on a hot path (unchanged rule). |
| Trial abuse (many trials per person) | Trial keyed to the account/email; accept some abuse at this scale, tighten later (device signals) if needed — don't over-build now. |

---

## 11. Explicitly deferred

- **Track B:** server-side settings synced per user; optional per-user paper accounts (each user's own
  virtual money + history, distinct from the shared algorithm record).
- **Track C:** passkeys (WebAuthn) as the flagship sign-in with email as recovery; refresh-token
  rotation and session management.
