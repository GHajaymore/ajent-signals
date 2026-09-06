// Display currency for the virtual money (paper account + P&L). Defaults to the user's
// LOCAL currency (from their geo country); a Settings toggle can force USD. Market PRICES
// are NOT touched — they stay in each market's own quote currency (Nifty in ₹, FTSE in £,
// BTC in $), which is how traders read them. Only the "your money" figures convert.
//
// Rates come once/day from a free, no-key endpoint (open.er-api.com), cached in
// localStorage; if unavailable we fall back to USD so nothing ever shows a wrong number.
import { state } from './state.js';

const COUNTRY_CCY = {
  US: 'USD', CA: 'CAD', BR: 'BRL', GB: 'GBP', EU: 'EUR', DE: 'EUR', FR: 'EUR', CH: 'CHF',
  JP: 'JPY', HK: 'HKD', CN: 'CNY', IN: 'INR', KR: 'KRW', AU: 'AUD', SG: 'SGD', NZ: 'NZD',
};
const SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', KRW: '₩', CNY: '¥', HKD: 'HK$', AUD: 'A$', CAD: 'C$', BRL: 'R$', SGD: 'S$', NZD: 'NZ$', CHF: 'CHF ' };
const LOCALE = { INR: 'en-IN' }; // most others read fine as en-US grouping

let rates = null, ratesAt = 0;
try { const c = JSON.parse(localStorage.getItem('ajent_fx_rates') || 'null'); if (c && c.rates) { rates = c.rates; ratesAt = c.at || 0; } } catch (e) { /* ignore */ }

// Refresh USD→* rates at most once a day. Best-effort; silent on failure.
export async function refreshRates() {
  if (rates && Date.now() - ratesAt < 20 * 3600000) return;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
    const d = await r.json();
    if (d && d.result === 'success' && d.rates && d.rates.EUR) {
      rates = d.rates; ratesAt = Date.now();
      try { localStorage.setItem('ajent_fx_rates', JSON.stringify({ rates, at: ratesAt })); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* keep cached / fall back to USD */ }
}

export function localCurrencyCode() { return COUNTRY_CCY[state.geoCountry] || 'USD'; }
export function displayCurrencyCode() {
  const pref = state.settings && state.settings.displayCurrency;
  if (pref === 'usd') return 'USD';
  return localCurrencyCode(); // 'local' (default) — or unset
}
export function currencySymbol(ccy) { const c = ccy || displayCurrencyCode(); return SYMBOL[c] || (c + ' '); }
// True when we're showing a converted (non-USD) figure, so the UI can add a "≈".
export function isConverted() { const c = displayCurrencyCode(); return c !== 'USD' && rates && rates[c] != null; }

function rateFor(ccy) { if (ccy === 'USD') return 1; return (rates && rates[ccy]) || null; }

// Raw USD↔display conversion, for editable inputs (account size). Falls back to 1:1 when
// no rate yet, so a slider is never stuck.
export function displayRate() { const r = rateFor(displayCurrencyCode()); return r == null ? 1 : r; }
export function usdToDisplay(usd) { return usd * displayRate(); }
export function displayToUsd(v) { const r = displayRate(); return r ? v / r : v; }

// Format a USD amount in the display currency. `sign` prefixes +/- (for P&L).
export function fmtMoney(usd, { sign = true } = {}) {
  const want = displayCurrencyCode();
  const rate = rateFor(want);
  const code = (rate == null) ? 'USD' : want;      // fall back to USD if no rate yet
  const val = (rate == null) ? usd : usd * rate;
  const sym = SYMBOL[code] || '$';
  const s = sign ? (val >= 0 ? '+' : '-') : (val < 0 ? '-' : '');
  return `${s}${sym}${Math.abs(Math.round(val)).toLocaleString(LOCALE[code] || 'en-US')}`;
}
