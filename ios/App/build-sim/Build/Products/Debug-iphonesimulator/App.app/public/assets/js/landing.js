import { startUpdateWatcher } from './app/updateCheck.js';

const BUY = 'var(--buy)', SELL = 'var(--sell)';

const months = [
  ['Jan', 4.1], ['Feb', 2.1], ['Mar', -0.8], ['Apr', 4.2], ['May', 3.1], ['Jun', 5.4], ['Jul', 3.6],
];
const mmax = 6;

const monthsChart = document.getElementById('months-chart');
monthsChart.innerHTML = months.map(([label, val]) => {
  const color = val >= 0 ? BUY : SELL;
  const h = Math.max(6, Math.abs(val) / mmax * 100);
  return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;justify-content:flex-end">
    <span style="font-size:11px;font-weight:600;color:${color}">${val >= 0 ? '+' : ''}${val.toFixed(1)}R</span>
    <div style="width:100%;border-radius:6px 6px 0 0;background:${color};height:${h}%;transform-origin:bottom;animation:ajRise .7s ease"></div>
    <span class="text-muted" style="font-size:11px">${label}</span>
  </div>`;
}).join('');

const trades = [
  { date: 'Jul 18', market: 'GC · Gold', side: 'LONG', entry: '2,648.4', exit: '2,706.0', result: '+2.8R', win: true },
  { date: 'Jul 18', market: 'NQ · Nasdaq-100', side: 'LONG', entry: '21,045', exit: '21,169', result: '+1.9R', win: true },
  { date: 'Jul 17', market: 'CL · Crude Oil', side: 'SHORT', entry: '71.84', exit: '70.40', result: '+1.6R', win: true },
  { date: 'Jul 17', market: 'ES · E-mini S&P', side: 'LONG', entry: '5,890.5', exit: '5,951.3', result: '+3.2R', win: true },
  { date: 'Jul 16', market: 'RTY · Russell 2000', side: 'SHORT', entry: '2,298.1', exit: '2,277.5', result: '+1.5R', win: true },
  { date: 'Jul 16', market: 'MNQ · Micro Nasdaq', side: 'SHORT', entry: '21,168', exit: '21,230', result: '-1.0R', win: false },
];

document.getElementById('trades-body').innerHTML = trades.map((t) => {
  const sideColor = t.side === 'LONG' ? BUY : SELL;
  const resultColor = t.win ? BUY : SELL;
  return `<div class="trades-row">
    <span class="text-muted">${t.date}</span>
    <span style="font-weight:500">${t.market}</span>
    <span style="color:${sideColor};font-weight:600">${t.side}</span>
    <span style="font-family:var(--font-heading)">${t.entry}</span>
    <span style="font-family:var(--font-heading)">${t.exit}</span>
    <span style="text-align:right;font-weight:600;color:${resultColor}">${t.result}</span>
  </div>`;
}).join('');

const btnMonthly = document.getElementById('btn-monthly');
const btnAnnual = document.getElementById('btn-annual');
const priceNum = document.getElementById('price-num');
const pricePer = document.getElementById('price-per');
const priceSub = document.getElementById('price-sub');

function setBilling(annual) {
  btnMonthly.classList.toggle('active', !annual);
  btnAnnual.classList.toggle('active', annual);
  priceNum.textContent = '$39.90';
  pricePer.textContent = annual ? '/ yr' : '/ mo';
  priceSub.textContent = annual ? 'Billed $39.90 yearly · best value' : 'Billed monthly · cancel anytime';
}

btnMonthly.addEventListener('click', () => setBilling(false));
btnAnnual.addEventListener('click', () => setBilling(true));

startUpdateWatcher();
