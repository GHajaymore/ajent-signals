export function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  const points = [...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...points);
}

export function fmtPrice(value, decimals) {
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(value, withSign = true) {
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function fmtCompact(n) {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

export function fmtMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

export function fmtAgo(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.floor(seconds))}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function fmtCountdown(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtHold(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return `${h.toFixed(h < 10 ? 1 : 0)} hrs`;
}

export function verdictColorVar(verdict) {
  if (verdict === 'BUY') return 'var(--buy)';
  if (verdict === 'SELL') return 'var(--sell)';
  return 'var(--flat)';
}

export function verdictChipClass(verdict) {
  if (verdict === 'BUY') return 'chip chip-buy';
  if (verdict === 'SELL') return 'chip chip-sell';
  return 'chip chip-flat';
}

export function stateColorVar(state) {
  if (state === 'bull') return 'var(--buy)';
  if (state === 'bear') return 'var(--sell)';
  return 'var(--neutral-500)';
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
