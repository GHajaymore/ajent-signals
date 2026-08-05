import { getClosedTrades, getPerformanceSummary, getOpenPositions, tradePnl } from '../paperTrading.js';
import { fmtPrice } from '../format.js';
import { state, getEnabledPaperMarkets, setPaperMarketEnabled, setAllPaperMarkets } from '../state.js';
import { CATEGORY_ORDER } from '../mockEngine.js';

function marketSelector() {
  const engine = state.engine;
  const all = engine.markets.map((m) => m.symbol);
  const enabled = getEnabledPaperMarkets(all);
  const byCat = {};
  for (const m of engine.markets) (byCat[m.category] = byCat[m.category] || []).push(m);
  const cats = CATEGORY_ORDER.filter((c) => byCat[c]);
  return `
  <div class="panel" style="padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div class="panel-title" style="margin-bottom:2px">Auto-traded markets</div>
        <div class="text-muted" style="font-size:12px" id="pm-count">${enabled.size} of ${all.length} · only these auto-trade signals</div>
      </div>
      <button class="btn btn-ghost" id="pm-toggle" style="height:34px;padding:0 16px;font-size:13px;flex:none">Edit</button>
    </div>
    <div id="pm-list" style="display:none;margin-top:14px">
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <button class="chip" id="pm-all" style="cursor:pointer;background:var(--accent-800);color:var(--accent-100)">Select all</button>
        <button class="chip" id="pm-none" style="cursor:pointer;background:var(--neutral-900);color:var(--text-muted)">Clear all</button>
      </div>
      ${cats.map((cat) => `
        <div class="eyebrow" style="margin:12px 0 2px">${cat}</div>
        ${byCat[cat].map((m) => `
          <div class="notif-row">
            <div class="notif-label" style="display:flex;align-items:center;gap:10px">
              <span style="font:700 11px var(--font-heading)">${m.symbol}</span>
              <span class="text-muted" style="font-size:12.5px">${m.name}</span>
            </div>
            <div class="switch ${enabled.has(m.symbol) ? 'on' : ''}" data-pm-sym="${m.symbol}"></div>
          </div>`).join('')}
      `).join('')}
    </div>
  </div>`;
}

function wireSelector(container) {
  const toggleBtn = container.querySelector('#pm-toggle');
  const list = container.querySelector('#pm-list');
  if (toggleBtn && list) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = list.style.display !== 'none';
      list.style.display = isOpen ? 'none' : 'block';
      toggleBtn.textContent = isOpen ? 'Edit' : 'Done';
    });
  }
  const all = state.engine.markets.map((m) => m.symbol);
  const updateCount = () => {
    const el = container.querySelector('#pm-count');
    if (el) el.textContent = `${getEnabledPaperMarkets(all).size} of ${all.length} · only these auto-trade signals`;
  };
  container.querySelectorAll('[data-pm-sym]').forEach((sw) => {
    sw.addEventListener('click', () => {
      const on = !sw.classList.contains('on');
      sw.classList.toggle('on', on);
      setPaperMarketEnabled(sw.dataset.pmSym, on, all);
      updateCount();
    });
  });
  const allBtn = container.querySelector('#pm-all');
  const noneBtn = container.querySelector('#pm-none');
  if (allBtn) allBtn.addEventListener('click', () => {
    setAllPaperMarkets(true, all);
    container.querySelectorAll('[data-pm-sym]').forEach((sw) => sw.classList.add('on'));
    updateCount();
  });
  if (noneBtn) noneBtn.addEventListener('click', () => {
    setAllPaperMarkets(false, all);
    container.querySelectorAll('[data-pm-sym]').forEach((sw) => sw.classList.remove('on'));
    updateCount();
  });
}

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
    <div class="dash-glow"></div>
    <h1 class="h-title">Paper Trading</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 16px">An honest, unedited track record: Ajent auto-trades <b style="color:var(--text)">every</b> signal with virtual money — winners and losers — so you see exactly how they perform. No real funds, no broker, nothing hidden.</p>`;
}

// Sets honest expectations before the numbers. This is a transparency feature,
// not a sales pitch — we deliberately do NOT promise profit.
function honestBanner() {
  return `
  <div class="panel" style="padding:13px 15px;border:1px solid var(--hairline);display:flex;gap:11px;align-items:flex-start;margin-bottom:12px">
    <i class="ph-fill ph-shield-check" style="color:var(--accent-300);font-size:19px;flex:none;margin-top:1px"></i>
    <div class="text-muted" style="font-size:12.5px;line-height:1.6">
      <b style="color:var(--text)">Why we show every result — even the losses.</b>
      Most signal apps hide their misses and advertise fake win rates. We don't. This is the real, complete record of the algorithm.
      Short-term markets are close to random, so an honest strategy realistically aims to <b style="color:var(--text)">protect capital and hover near break-even</b>, not to print money. The engine also keeps learning from every trade. Judge it on the full history below, not any single week.
    </div>
  </div>`;
}

// User-facing explainer of how the dollar P&L is computed — especially for
// non-US markets quoted in other currencies. Native <details> = no JS wiring.
function pnlHelp() {
  return `
  <details class="panel" style="padding:14px 16px">
    <summary style="cursor:pointer;font:600 14px var(--font-heading);display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>How is profit &amp; loss calculated?</span>
      <i class="ph ph-caret-down" style="color:var(--text-muted);flex:none"></i>
    </summary>
    <div class="text-muted" style="font-size:12.5px;line-height:1.65;margin-top:10px">
      Every paper trade risks the <b style="color:var(--text)">same amount</b> — your account size × your risk-per-trade % (both set in Settings). A win adds your reward-to-risk ratio times that stake; a loss subtracts the stake. So a $250 stake at 2:1 makes <span style="color:var(--buy)">+$500</span> on a win or <span style="color:var(--sell)">−$250</span> on a loss.
      <br><br>
      Because the result is measured in <b style="color:var(--text)">your account currency</b>, it works identically for every market — including non-US futures and indexes quoted in euros, yen, pounds or any other currency. <b style="color:var(--text)">No currency conversion is needed:</b> Ajent tracks the dollars you put at risk, not the instrument's local-currency ticks.
    </div>
  </details>`;
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
  <div class="fade-in glow-wrap">
    ${intro()}
    ${honestBanner()}
    ${pnlHelp()}
    ${marketSelector()}
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
  if (!perf) { container.innerHTML = emptyState(); wireSelector(container); return; }

  const closed = getClosedTrades();
  const maxAbs = Math.max(...perf.monthlyPnl.map((m) => Math.abs(m.value)), 1);
  const pnlColor = perf.totalPnl >= 0 ? 'var(--buy)' : 'var(--sell)';

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    ${intro()}
    ${honestBanner()}
    ${pnlHelp()}
    ${marketSelector()}

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

  wireSelector(container);
}
