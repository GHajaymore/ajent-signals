// Real StoreKit in-app purchases via cordova-plugin-purchase (window.CdvPurchase).
// This is only active inside the native iOS app, where Capacitor injects the
// plugin. In a plain browser or the PWA (e.g. GitHub Pages) window.CdvPurchase
// does not exist, so everything here stays inert and the app runs as a free
// demo with the paywall shown for illustration only — no purchase is attempted.
//
// Entitlement is tracked from StoreKit's own ownership state. For a client-only
// app this is acceptable to unlock in-app content (all content is on-device);
// server-side receipt validation would be the hardening step for a backend.

export const PRODUCTS = {
  monthly: 'com.AjMore.ajentsignals.pro.monthly',
  annual: 'com.AjMore.ajentsignals.pro.annual',
};

const LS_PRO = 'ajent_pro_entitled_v1';

let store = null;
let ready = false;
let onChange = () => {};

export function isNative() {
  return typeof window !== 'undefined' && !!window.CdvPurchase;
}

export function isPro() {
  try { return localStorage.getItem(LS_PRO) === '1'; } catch (e) { return false; }
}

function setPro(v) {
  try { localStorage.setItem(LS_PRO, v ? '1' : '0'); } catch (e) { /* ignore */ }
  try { onChange(!!v); } catch (e) { /* ignore */ }
}

export function initIap(changeCb) {
  if (changeCb) onChange = changeCb;
  if (!isNative()) return; // web demo — nothing to initialise
  // Capacitor fires 'deviceready' once cordova plugins are ready; also try now
  // in case it already fired before this module ran.
  document.addEventListener('deviceready', setup, false);
  if (window.CdvPurchase && window.CdvPurchase.store) setup();
}

function setup() {
  if (ready || !window.CdvPurchase) return;
  ready = true;
  const { CdvPurchase } = window;
  const { ProductType, Platform } = CdvPurchase;
  store = CdvPurchase.store;

  store.register([
    { id: PRODUCTS.monthly, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.APPLE_APPSTORE },
    { id: PRODUCTS.annual, type: ProductType.PAID_SUBSCRIPTION, platform: Platform.APPLE_APPSTORE },
  ]);

  store
    .when()
    .approved((t) => t.verify())
    .verified((receipt) => receipt.finish())
    .receiptUpdated(() => refreshEntitlement())
    .productUpdated(() => refreshEntitlement());

  store.error((err) => { try { console.warn('[IAP]', err && err.code, err && err.message); } catch (e) {} });

  store.initialize([{ platform: CdvPurchase.Platform.APPLE_APPSTORE }])
    .then(() => refreshEntitlement())
    .catch(() => {});
}

function refreshEntitlement() {
  if (!store) return;
  const owned = store.owned(PRODUCTS.monthly) || store.owned(PRODUCTS.annual);
  setPro(!!owned);
}

// which: 'monthly' | 'annual' (or a full product id)
export async function purchase(which) {
  if (!isNative() || !store) return { ok: false, reason: 'not-native' };
  const id = PRODUCTS[which] || which;
  const product = store.get(id, window.CdvPurchase.Platform.APPLE_APPSTORE);
  const offer = product && product.getOffer();
  if (!offer) return { ok: false, reason: 'no-offer' };
  try {
    const err = await store.order(offer);
    if (err) return { ok: false, reason: err.message || 'order-failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'order-failed' };
  }
}

export async function restore() {
  if (!isNative() || !store) return { ok: false, reason: 'not-native' };
  try {
    await store.restorePurchases();
    refreshEntitlement();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'restore-failed' };
  }
}

// Returns the localized StoreKit price string for a plan, or null if unavailable.
export function priceString(which) {
  if (!store) return null;
  const id = PRODUCTS[which] || which;
  const product = store.get(id, window.CdvPurchase.Platform.APPLE_APPSTORE);
  const offer = product && product.getOffer();
  const phases = offer && offer.pricingPhases;
  if (!phases || !phases.length) return null;
  return phases[phases.length - 1].price || null;
}

// True if the plan's StoreKit offer includes a free/intro trial phase.
export function hasTrial(which) {
  if (!store) return false;
  const id = PRODUCTS[which] || which;
  const product = store.get(id, window.CdvPurchase.Platform.APPLE_APPSTORE);
  const offer = product && product.getOffer();
  const phases = (offer && offer.pricingPhases) || [];
  return phases.some((p) => Number(String(p.priceMicros)) === 0 || p.price === 'Free' || p.paymentMode === 'FreeTrial');
}
