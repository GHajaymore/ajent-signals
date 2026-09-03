# Phase 0 — Generalise "futures-only" into an asset-class registry

**Status:** planned (design only — not started).
**Prerequisite:** the Day Trading build must land first. Phase 0 touches the same core files
(`markets.js`, `meta.js`, `scheduler.js`, `index.js`, client `state.js`, `settings.js`) and — more
importantly — must **absorb** the day-trading style into a general abstraction rather than fight the
hand-rolled version. Start Phase 0 only after Day Trade merges to `main`.

Companion design brief: the multi-asset artifact (asset × style matrix, two operating models,
feasibility, roadmap). This doc is the execution spec for the **foundation** phase of that brief.

---

## 1. Objective & non-goals

**Objective.** Make **asset class** and **trading style** real dimensions of the system, so a signal
surface is one *cell* — `(assetClass × style)` — with its own universe, validation status, and paper
record. Everything routes through one **class registry** instead of hardcoded futures assumptions.

**Non-goals (hard boundaries — keep this phase small and safe):**
- **No new markets.** No forex, no ETFs, no stocks yet. Only re-classify the existing 10 symbols.
- **No new strategy/recipe.** The proven Swing recipe and the Day experiment stay exactly as-is.
- **No behaviour change** for the default path. After Phase 0 the app must look and behave
  **identically** for `index × swing` — this is a pure refactor + scaffolding pass.

**Definition of done:** adding forex in Phase 1 is *a registry entry plus a validated cell* — zero
plumbing changes. The Day style is one registry cell. Honest-numbers + non-disclosure intact. Unit
tests green. The live paper record is preserved (no blob-key data loss).

---

## 2. The core abstraction — the class registry

One source of truth on the worker, served to the client (same pattern as `STRATEGY` today). Shape:

```js
// worker/src/classes.js  (NEW — the registry)
export const ASSET_CLASSES = {
  index: {
    key: 'index',
    name: 'Index futures',
    model: 'tracked',                 // 'tracked' (curated set) | 'screener' (scan+rank)
    universe: ['ES','NQ','YM','RTY','XJO','SX5E','N225','TSX'],
    styles: { swing: 'live', day: 'dev' },   // 'live' | 'dev' | 'planned' | 'blocked'
  },
  crypto: {
    key: 'crypto',
    name: 'Crypto',
    model: 'tracked',
    universe: ['BTC','ETH'],
    styles: { swing: 'tracked-unproven', day: 'planned' }, // edge not validated on crypto
  },
  // Phase 1 stubs (declared 'planned', NOT wired to a live cell):
  // forex:  { model:'tracked',  universe:[...], styles:{ swing:'planned', day:'planned' } },
  // etf:    { model:'tracked',  universe:[...], styles:{ swing:'planned' } },
  // stocks: { model:'screener', scan:{...},     styles:{ swing:'planned' } },  // Phase 2
};
```

Two axes, two lookups:
- `blobKey(classKey, styleKey)` → the KV key for that cell's `SIGNALS`/`RECORD` blobs.
- `strategyFor(classKey, styleKey)` → the recipe config for that cell (from the generalised `meta.js`).

**Cell status vocabulary** (drives the UI honestly): `live` shows real signals; `dev` shows an
ungated, clearly-labelled experiment (exactly how Day is presented today); `planned` shows a "coming"
state with no signals; `blocked` is greyed out (e.g. scalp — no tick data). Never advertise a
non-`live` cell with returns.

---

## 3. Worker changes

### 3.1 `markets.js` — tag each market with its class
Add `assetClass` to every entry (no other change). Keep the flat `MARKETS` dict for lookups.
```js
ES:  { yahoo:'ES=F',  assetClass:'index', country:'US', futures:true, name:'E-mini S&P 500' },
BTC: { yahoo:'BTC-USD', assetClass:'crypto', country:'US', crypto:true, name:'Bitcoin' },
```
`isOpen(meta)` already keys off `futures`/`crypto`/`country` — leave it; class is orthogonal to
session. (Later classes add their own session rules here.)

### 3.2 `meta.js` — one strategy → a `(class,style)` map
Today `STRATEGY` is a single global object. Generalise to a keyed map, preserving the current object
as the `index/swing` entry verbatim:
```js
export const STRATEGIES = {
  'index/swing': { /* the current STRATEGY object, unchanged */ },
  'index/day':   { /* the Day build's recipe (fold in from its meta changes) */ },
};
export function strategyFor(classKey, styleKey) {
  return STRATEGIES[`${classKey}/${styleKey}`] || STRATEGIES['index/swing'];
}
export function publicStrategy(classKey, styleKey, adaptive) { /* strip recipe, as today, per cell */ }
```
**Reconcile with Day:** the Day session likely added its intraday recipe somewhere in `meta.js`/its
scheduler. Phase 0 moves that into `STRATEGIES['index/day']` so both styles live in one map. Keep
`STRATEGY` as a back-compat alias (`= STRATEGIES['index/swing']`) until all call-sites migrate.

### 3.3 Blob keys — generalise `SIGNALS`/`RECORD`
Day already created `SIGNALS_DAY`/`RECORD_DAY` by hand — that IS the per-cell pattern, un-generalised.
Introduce a deriver and **map the existing keys onto it so no live data is lost:**
```js
function blobKey(kind, classKey, styleKey) {           // kind: 'SIGNALS' | 'RECORD'
  if (classKey === 'index' && styleKey === 'swing') return kind;         // preserve current record
  if (classKey === 'index' && styleKey === 'day')   return `${kind}_DAY`; // preserve Day's record
  return `${kind}__${classKey}__${styleKey}`;          // new cells
}
```
> **Migration caution:** the `index/swing` record is the real, months-old tracked record. It MUST keep
> mapping to the bare `SIGNALS`/`RECORD` keys. Do not "clean up" into a uniform scheme that renames
> those keys — that would orphan the live record (see the KV-limits/RTY-loss note in memory).

### 3.4 `scheduler.js` — iterate live cells, not one hardcoded set
`runTick` currently walks `MARKETS` for the one strategy. Generalise to walk each **live/dev cell**:
for each `(classKey, styleKey)` whose status is `live` or `dev`, run its markets through `strategyFor`
and read/write `blobKey(...)`. `runDayTick` (Day's isolated loop) collapses into this generalised loop
as the `index/day` cell — keep its isolation guarantee (a `dev` cell's failure must never touch a
`live` cell; wrap each cell in its own try/catch, exactly as `index.js` already wraps `runDayTick`).

### 3.5 `index.js` — class-aware endpoints + serve the registry
- `/signals?class=index&style=swing` (both default to `index`/`swing` → **fully back-compatible** with
  the current no-arg call). Reads the cell's blob via `blobKey`, serves `publicStrategy(class,style)`.
- Fold `/day` into `/signals?class=index&style=day` (keep `/day` as a temporary alias so the Day
  client keeps working during migration).
- Add `/config` (or embed in `/signals`) returning the **public class registry**: for each class its
  name, model, universe, and per-style status — recipe-free. This is what lets the client render the
  switcher and offer only live cells.

---

## 4. Client changes

### 4.1 `state.js` — active class/style + scoped settings
- Add `state.activeClass` (default `'index'`) and `state.activeStyle` (default `'swing'`) →
  **identical default behaviour**.
- Replace the flat universe constants (`DAILY_AUTOTRADE_MARKETS`, etc.) as the *source* — derive them
  from the served registry instead; keep the constants only as an offline fallback.
- `paperMarkets` becomes **per class**: `state.settings.paperMarketsByClass[classKey]`. Migrate the
  existing flat `paperMarkets` → `paperMarketsByClass.index` in `loadSettings` (guard like the existing
  `strategyMode` coercion).
- Keep the Free = 1 market / Pro = all rule, now applied within the active class.

### 4.2 `mockEngine.js` — markets carry their class
Engine builds each `Market` with `assetClass` (from the served registry). Add
`engine.marketsForClass(classKey)`. No change to the signal/overlay logic.

### 4.3 Screens — scope to the active cell
- **Home / Markets / Paper / Alerts** read `activeClass` + `activeStyle` and show only that cell's
  markets and record (they already filter by `isRealMarket`/`backendConfigured`; add the class scope).
- **Header class switcher** (from the design brief): a compact control that flips `activeClass` and
  re-renders. First-run onboarding sets the default class.
- **Style picker** (`screens/settings.js`): offer only styles whose status is `live` for the active
  class; render `dev`/`planned`/`blocked` as labelled, non-selectable states. This generalises the
  existing Scalping/Day/Swing status list — and Day's own settings work should slot in here.
- `strategyMeta.js`: `getStrategy(classKey, styleKey)` / `getAdaptive(classKey, styleKey)` read the
  served per-cell public strategy.

---

## 5. Execution order (incremental, each step independently testable)

1. **`classes.js` registry + `assetClass` on markets.** No behaviour change. Add unit invariants
   (every market's class exists; every `live` cell's universe is non-empty).
2. **Generalise `meta.js`** to `STRATEGIES` + `strategyFor` + per-cell `publicStrategy`; `STRATEGY`
   stays as the `index/swing` alias. Fold Day's recipe into `index/day`.
3. **`blobKey` deriver** with the back-compat mapping (§3.3). Point `runTick`/`runDayTick` at it.
   Verify the live record still reads/writes the bare `SIGNALS`/`RECORD` keys.
4. **Scheduler loop over live/dev cells** (§3.4), each cell isolated.
5. **`/signals?class=&style=` + `/config` registry**; `/day` kept as an alias.
6. **Client `state.activeClass/activeStyle`** + settings migration; consume the served registry.
7. **Engine tags markets by class**; screens scope by active cell; header switcher; style picker by
   status.
8. **Verify no behaviour change** for `index/swing`: unit tests green + a live smoke test (Home shows
   the same signals, the paper record is intact, `~RT SPY` overlay still works).

Land steps 1–4 (worker) as one reviewable change, 5 as another, 6–8 (client) as a third — so each is
small and the default path is verifiable after each.

---

## 6. Invariants to preserve (do not regress)

- **Non-disclosure:** `publicStrategy(class,style)` still strips the recipe dials; `/signals` still
  strips `exitAbove/stopMult/sizeMult` from plans — now per cell.
- **Honest numbers:** a non-`live` cell never emits a signal styled as proven; per-class P&L stays
  **separate** (never blend a proven record with an unproven one in one headline).
- **KV discipline:** get/put on batched blobs only — **never `list()`** on a polled path. The blob
  count grows with live cells, not with markets.
- **Live record continuity:** `index/swing` → bare `SIGNALS`/`RECORD` keys, forever (§3.3 caution).
- **Real-time overlay:** the `/live` ETF-proxy path is class-agnostic; leave it. It naturally serves
  whichever class is active.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Blob-key rename orphans the live record | Hard-map `index/swing`→`SIGNALS`/`RECORD`; never rename (§3.3). |
| Collision with the Day build | Do Phase 0 **after** Day merges; then fold Day into `index/day`. |
| Settings migration breaks returning users | Migrate flat `paperMarkets`→`paperMarketsByClass.index`, guarded, like the `strategyMode` coercion already in `loadSettings`. |
| Scope creep into Phase 1 | Registry declares forex/ETF/stocks as `planned` **stubs only** — no universes wired, no cells live. |
| Client/worker registry drift | Worker is the source; client renders from the served `/config` — the offline constants are fallback only. |

---

## 8. What Phase 0 explicitly leaves for later

- **Phase 1:** wire Forex + ETFs as real `tracked` classes — each cell lab-validated before `live`.
  (ETFs are half-built: the `/live` proxy already fetches SPY/QQQ/DIA/IWM.)
- **Phase 2:** the **screener** model for stocks — scan/rank/cap, single-name guardrails, EOD-cadence
  scan. Phase 0's `model: 'screener'` field reserves the seam; nothing implements it yet.
