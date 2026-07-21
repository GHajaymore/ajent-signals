import { state } from '../state.js';
import { fmtPrice } from '../format.js';

function fmtHoldMin(min) {
  if (min < 60) return `${min} min`;
  return `${(min / 60).toFixed(1)} hrs`;
}

export function render(container) {
  const perf = state.engine.performance();
  const maxAbs = Math.max(...perf.monthlyR.map((m) => Math.abs(m.value)), 1);

  container.innerHTML = `
  <div class="fade-in">
    <h1 class="h-title">Performance</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 18px">Model track record · last 90 days</p>

    <div class="stat2-grid">
      <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value" style="color:var(--buy)">${perf.winRate}%</div><div class="stat-sub">${perf.wins}W / ${perf.losses}L</div></div>
      <div class="stat-card"><div class="stat-label">Avg R:R</div><div class="stat-value">${perf.avgRR}</div><div class="stat-sub">realized</div></div>
      <div class="stat-card"><div class="stat-label">Max drawdown</div><div class="stat-value" style="color:var(--sell)">${perf.maxDrawdownPct}%</div><div class="stat-sub">peak to trough</div></div>
      <div class="stat-card"><div class="stat-label">Avg hold</div><div class="stat-value">${perf.avgHold}</div><div class="stat-sub">per signal</div></div>
    </div>

    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="panel-title" style="margin-bottom:0">Monthly R multiple</div>
        <span class="text-muted" style="font-size:12px">${perf.totalR >= 0 ? '+' : ''}${perf.totalR.toFixed(1)}R total</span>
      </div>
      <div class="bar-chart">
        ${perf.monthlyR.map((m) => {
          const color = m.value >= 0 ? 'var(--buy)' : 'var(--sell)';
          const h = Math.max(6, (Math.abs(m.value) / maxAbs) * 100);
          return `<div class="bar-col">
            <span class="bv" style="color:${color}">${m.value >= 0 ? '+' : ''}${m.value.toFixed(1)}R</span>
            <div class="b" style="height:${h}%;background:${color}"></div>
            <span class="bl">${m.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="section-label">Recent closed signals</div>
    <div class="card" style="padding:2px 12px">
      ${state.engine.closedSignals.map((c) => {
        const color = c.resultR >= 0 ? 'var(--buy)' : 'var(--sell)';
        const dateStr = c.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div class="closed-row">
          <div class="closed-sym">${c.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${c.side === 'LONG' ? 'Long' : 'Short'} · ${c.symbol}</div>
            <div class="closed-sub">${dateStr} · held ${fmtHoldMin(c.holdMin)}</div>
          </div>
          <div class="closed-result">
            <div class="r" style="color:${color}">${c.resultR >= 0 ? '+' : ''}${c.resultR.toFixed(1)}R</div>
            <div class="o">${c.outcome}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}
