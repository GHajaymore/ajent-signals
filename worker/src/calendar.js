// News / event regime filter. Mean reversion is unreliable into a scheduled
// binary event, so on a high-impact event day the strategy STANDS ASIDE for that
// region's markets (it won't open a new position; existing ones are managed
// normally). This is a FILTER, not a predictor — it never guesses direction.
//
// Honesty note: we only encode events we can compute or verify. The monthly US
// jobs report (first Friday) is reliably computable. FOMC / CPI dates are irregular
// and need real dates — add verified ones to MANUAL_EVENTS (never fabricate them);
// a proper economic-calendar feed would make this complete.

// Verified specific high-impact dates: { date:'YYYY-MM-DD', region, name }.
// Left empty deliberately — populate with real, checked dates (or a feed) so the
// filter never stands aside on a guessed day.
export const MANUAL_EVENTS = [];

function firstFridayDate(y, m) {
  const d = new Date(Date.UTC(y, m, 1));
  return 1 + ((5 - d.getUTCDay() + 7) % 7); // day-of-month of the first Friday
}

// The region a market's events come from (crypto reacts to US macro too).
function regionOf(country) { return country === 'CA' ? 'US' : country; } // TSX tracks US macro closely

// The high-impact event today for a market's region, or null.
export function highImpactToday(country, now = new Date()) {
  const region = regionOf(country);
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), day = now.getUTCDate();
  const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const manual = MANUAL_EVENTS.find((e) => e.date === iso && e.region === region);
  if (manual) return { name: manual.name, region };
  if (region === 'US' && day === firstFridayDate(y, m)) return { name: 'US jobs report (NFP)', region };
  return null;
}
