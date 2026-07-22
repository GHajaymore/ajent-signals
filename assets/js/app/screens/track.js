import { getClosedTrades, getPerformanceSummary, getOpenPositions, tradePnl } from '../paperTrading.js';
import { fmtPrice } from '../format.js';

// Plain-dollar formatter, e.g. +$1,240 / -$250
function money(n) {
  const sign = n >= 0 ? '+$' : '-$';
  return sign + Math.abs(Math.round(n)).toLocaleString('en-US');
}

function fmtHoldMin(min) {
  if (min < 60) return `${min} min`;
  return `${(min / 60).toFixed(1)} hrs`;
}

function intro() {
  return `
    <h1 class="h-title">Paper Trading</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 16px">Ajent auto-trades its own signals with virtual money so you can see how they perform — no real funds, no broker.</p>`;
}

function openList() {
  const open = getOpenPositions();
  if (!open.length) return '';
  return `
    <div class="section-label">Open positions · ${open.length}</div>
    <div class="card" style="padding:2px 12px">
      ${open.map((p) => `
        <div class="closed-row">
          <div class="closed-sym">${p.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${p.side === 'LONG' ? 'Long' : 'Short'} · ${p.name}</div>
            <div class="closed-sub">Entry ${fmtPrice(p.entry, p.decimals)} · target ${fmtPrice(p.target1, p.decimals)} · $${(p.riskDollars || 0).toLocaleString('en-US')} staked</div>
          </div>
          <div class="closed-result"><div class="o" style="color:var(--accent-300)">Live</div></div>
        </div>`).join('')}
    </div>`;
}

function emptyState() {
  const open = getOpenPositions();
  return `
  <div class="fade-in">
    ${intro()}
    ${openList()}
    <div class="panel" style="text-align:center;padding:38px 20px;margin-top:12px">
      <i class="ph ph-chart-line-up" style="font-size:32px;color:var(--text-muted)"></i>
      <div style="font:600 15px var(--font-heading);margin-top:14px">No completed trades yet</div>
      <p class="text-muted" style="font-size:13px;line-height:1.6;margin-top:8px;max-width:40ch;margin-left:auto;margin-right:auto">
        A virtual trade opens automatically whenever a real signal clears your confidence threshold, then runs until it hits its target or stop.
        ${open.length ? `${open.length} ${open.length === 1 ? 'trade is' : 'trades are'} open right now — results will appear here once they close.` : 'None are open yet — check back once a real signal fires.'}
      </p>
    </div>
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">Educational only · past results don't guarantee future performance.</p>
  </div>`;
}

export function render(container) {
  const perf = getPerformanceSummary();
  if (!perf) { container.innerHTML = emptyState(); return; }

  const closed = getClosedTrades();
  const maxAbs = Math.max(...perf.monthlyPnl.map((m) => Math.abs(m.value)), 1);
  const pnlColor = perf.totalPnl >= 0 ? 'var(--buy)' : 'var(--sell)';

  container.innerHTML = `
  <div class="fade-in">
    ${intro()}

    <div class="panel" style="text-align:center;padding:20px 16px 18px">
      <div class="stat-label">Net virtual profit &amp; loss</div>
      <div style="font:800 40px var(--font-heading);color:${pnlColor};margin-top:2px;letter-spacing:-1px">${money(perf.totalPnl)}</div>
      <div class="text-muted" style="font-size:12px;margin-top:2px">across ${closed.length} completed trade${closed.length === 1 ? '' : 's'}</div>
    </div>

    <div class="stat2-grid">
      <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value" style="color:var(--buy)">${perf.winRate}%</div><div class="stat-sub">${perf.wins}W / ${perf.losses}L</div></div>
      <div class="stat-card"><div class="stat-label">Avg win</div><div class="stat-value" style="color:var(--buy)">${money(perf.avgWin)}</div><div class="stat-sub">per winning trade</div></div>
      <div class="stat-card"><div class="stat-label">Avg loss</div><div class="stat-value" style="color:var(--sell)">${money(-perf.avgLoss)}</div><div class="stat-sub">per losing trade</div></div>
      <div class="stat-card"><div class="stat-label">Avg hold</div><div class="stat-value">${perf.avgHold}</div><div class="stat-sub">per trade</div></div>
    </div>

    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="panel-title" style="margin-bottom:0">Monthly profit &amp; loss</div>
        <span class="text-muted" style="font-size:12px">virtual $</span>
      </div>
      <div class="bar-chart">
        ${perf.monthlyPnl.map((m) => {
          const color = m.value >= 0 ? 'var(--buy)' : 'var(--sell)';
          const h = Math.max(6, (Math.abs(m.value) / maxAbs) * 100);
          return `<div class="bar-col">
            <span class="bv" style="color:${color}">${money(m.value)}</span>
            <div class="b" style="height:${h}%;background:${color}"></div>
            <span class="bl">${m.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    ${openList()}

    <div class="section-label">Recent trades</div>
    <div class="card" style="padding:2px 12px">
      ${closed.slice(0, 30).map((c) => {
        const pnl = tradePnl(c);
        const color = pnl >= 0 ? 'var(--buy)' : 'var(--sell)';
        const dateStr = new Date(c.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="closed-row">
          <div class="closed-sym">${c.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${c.side === 'LONG' ? 'Long' : 'Short'} · ${c.symbol}</div>
            <div class="closed-sub">${dateStr} · held ${fmtHoldMin(c.holdMin)}</div>
          </div>
          <div class="closed-result">
            <div class="r" style="color:${color}">${money(pnl)}</div>
            <div class="o">${c.outcome}</div>
          </div>
        </div>`;
      }).join('')}
    </div>

    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">Virtual money only · educational · past results don't guarantee future performance.</p>
  </div>`;
}
