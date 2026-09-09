// OPERATOR-EDITABLE CONFIG (admin console). Currently: which markets Ajent AUTO-TRADES. Stored in
// KV under CONFIG|AUTOTRADE as { disabled: [symbols], updatedAt, by }. Absent/empty ⇒ NOTHING is
// disabled ⇒ every market auto-trades, i.e. the historical default. Disabling a market only stops
// NEW entries — any open position on it is still managed to its normal exit (see scheduler canOpen).
// Deploying this change is a no-op until an admin actually disables something, so it's safe to ship.
const PK = 'CONFIG', SK = 'AUTOTRADE';

// Set of disabled symbols for the scheduler. Defensive: any read error ⇒ empty set (trade all),
// so a config glitch can never silently halt the live record.
export async function loadDisabledSet(store) {
  try {
    const cfg = await store.get(PK, SK);
    const list = cfg && Array.isArray(cfg.disabled) ? cfg.disabled : [];
    return new Set(list.map(String));
  } catch (e) { return new Set(); }
}

// Full config object for the admin endpoint (never throws).
export async function loadAutoTradeConfig(store) {
  try {
    const cfg = await store.get(PK, SK);
    return { disabled: (cfg && Array.isArray(cfg.disabled)) ? cfg.disabled.map(String) : [], updatedAt: (cfg && cfg.updatedAt) || null, by: (cfg && cfg.by) || null };
  } catch (e) { return { disabled: [], updatedAt: null, by: null }; }
}

// Persist the disabled set. `valid` is the set of real market symbols — anything outside it is
// dropped so a stale/garbage symbol can't be stored. Returns the saved config.
export async function saveAutoTradeConfig(store, disabled, valid, by) {
  const clean = [...new Set((Array.isArray(disabled) ? disabled : []).map(String).filter((s) => valid.has(s)))];
  const cfg = { pk: PK, sk: SK, disabled: clean, updatedAt: Date.now(), by: by || 'admin' };
  await store.put(cfg);
  return { disabled: clean, updatedAt: cfg.updatedAt, by: cfg.by };
}
