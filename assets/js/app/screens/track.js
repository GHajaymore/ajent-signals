import { getClosedTrades, getPerformanceSummary, getOpenPositions, tradePnl } from '../paperTrading.js';
import { fmtPrice } from '../format.js';
import { state, getEnabledPaperMarkets, setPaperMarketEnabled, setAllPaperMarkets, setPaperMarkets, FREE_MARKET_LIMIT } from '../state.js';
import { isEntitled } from '../backendApi.js';
import { CATEGORY_ORDER } from '../mockEngine.js';

// Coarse region grouping for the quick paper-trade presets, from each market's
// country code. Anything unmapped falls into "Other".
const REGION_BY_COUNTRY = {
  US: 'US',
  IN: 'India',
  GB: 'Europe', DE: 'Europe', FR: 'Europe', EU: 'Europe', CH: 'Europe',
  JP: 'Asia', HK: 'Asia', CN: 'Asia', SG: 'Asia', AU: 'Asia', NZ: 'Asia',
  CA: 'Other', BR: 'Other',
};
const REGION_ORDER = ['US', 'Europe', 'Asia', 'India', 'Other'];
const regionOf = (country) => REGION_BY_COUNTRY[country] || 'Other';
const symbolsInRegion = (region) => state.engine.markets.filter((m) => regionOf(m.country) === region).map((m) => m.symbol);

// Compact current-signal indicator per market, so you can pick markets that are
// actually trending. Reflects the same BUY/SELL/NO_TRADE verdict as everywhere.
function verdictBits(verdict) {
  if (verdict === 'BUY') return { cls: 'buy', inner: '<i class="ph-fill ph-caret-up"></i>Buy' };
  if (verdict === 'SELL') return { cls: 'sell', inner: '<i class="ph-fill ph-caret-down"></i>Sell' };
  return { cls: 'flat', inner: 'Flat' };
}
function pmVerdictTag(verdict, symbol) {
  const b = verdictBits(verdict);
  return `<span class="pm-trend ${b.cls}" data-pm-trend="${symbol}">${b.inner}</span>`;
}

function marketSelector() {
  const engine = state.engine;
  const all = engine.markets.map((m) => m.symbol);
  const enabled = getEnabledPaperMarkets(all);
  const threshold = state.settings.threshold;
  const byCat = {};
  for (const m of engine.markets) (byCat[m.category] = byCat[m.category] || []).push(m);
  const cats = CATEGORY_ORDER.filter((c) => byCat[c]);
  return `
  <div class="panel" style="padding:14px 16px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div class="panel-title" style="margin-bottom:2px">Auto-traded markets</div>
        <div class="text-muted" style="font-size:12px" id="pm-count">${enabled.size} of ${all.length} · only these auto-trade signals</div>
        ${isEntitled() ? '' : `<div style="font-size:11.5px;color:var(--accent-200);margin-top:3px;display:flex;align-items:center;gap:5px"><i class="ph-fill ph-crown-simple" style="font-size:12px;color:#ffca4d"></i> Free: ${FREE_MARKET_LIMIT} market at a time · <a href="#/paywall" style="color:var(--accent-100);text-decoration:underline">Go Pro for all ${all.length}</a></div>`}
      </div>
      <button class="btn btn-ghost" id="pm-toggle" style="height:34px;padding:0 16px;font-size:13px;flex:none">Edit</button>
    </div>
    <div id="pm-list" style="display:none;margin-top:14px">
      <div class="eyebrow" style="margin-bottom:6px">Limit to a region</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${REGION_ORDER.map((r) => `<button class="chip region-chip" data-region="${r}" style="cursor:pointer;background:var(--neutral-900);color:var(--text-muted)">${r}</button>`).join('')}
      </div>
      <div class="eyebrow" style="margin-bottom:6px">Or pick individually</div>
      <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <button class="chip" id="pm-all" style="cursor:pointer;background:var(--accent-800);color:var(--accent-100)">Select all</button>
        <button class="chip" id="pm-none" style="cursor:pointer;background:var(--neutral-900);color:var(--text-muted)">Clear all</button>
        <button class="chip" id="pm-signalling" style="cursor:pointer;background:var(--neutral-900);color:var(--buy)"><i class="ph-fill ph-lightning" style="font-size:11px"></i> Signalling now</button>
      </div>
      ${cats.map((cat) => {
        const list = byCat[cat];
        const on = list.filter((m) => enabled.has(m.symbol)).length;
        return `
        <details class="pm-group" data-cat="${cat}">
          <summary>
            <span class="pm-cat-name">${cat}</span>
            <span class="pm-cat-count">${on}/${list.length}</span>
            <i class="ph ph-caret-down"></i>
          </summary>
          ${list.map((m) => `
            <div class="notif-row">
              <div class="notif-label" style="display:flex;align-items:center;gap:10px;min-width:0">
                <span style="font:700 11px var(--font-heading)">${m.symbol}</span>
                <span class="text-muted" style="font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.name}</span>
              </div>
              ${pmVerdictTag(m.verdict(threshold), m.symbol)}
              <div class="switch ${enabled.has(m.symbol) ? 'on' : ''}" data-pm-sym="${m.symbol}"></div>
            </div>`).join('')}
        </details>`;
      }).join('')}
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
  // Re-paint every switch from the ACTUAL enabled set (which the state layer
  // caps to FREE_MARKET_LIMIT for Free users) so the UI never lies — e.g. on
  // Free, enabling one market visibly turns the others off.
  const syncSwitches = () => {
    const enabledNow = getEnabledPaperMarkets(all);
    container.querySelectorAll('[data-pm-sym]').forEach((sw) => sw.classList.toggle('on', enabledNow.has(sw.dataset.pmSym)));
  };
  const updateCount = () => {
    syncSwitches();
    const el = container.querySelector('#pm-count');
    if (el) el.textContent = `${getEnabledPaperMarkets(all).size} of ${all.length} · only these auto-trade signals`;
    // Keep each collapsible group's "on/total" badge in sync.
    container.querySelectorAll('.pm-group[data-cat]').forEach((g) => {
      const sw = [...g.querySelectorAll('[data-pm-sym]')];
      const badge = g.querySelector('.pm-cat-count');
      if (badge) badge.textContent = `${sw.filter((s) => s.classList.contains('on')).length}/${sw.length}`;
    });
  };
  container.querySelectorAll('[data-pm-sym]').forEach((sw) => {
    sw.addEventListener('click', () => {
      const on = !sw.classList.contains('on');
      setPaperMarketEnabled(sw.dataset.pmSym, on, all);
      updateCount();
    });
  });
  const allBtn = container.querySelector('#pm-all');
  const noneBtn = container.querySelector('#pm-none');
  if (allBtn) allBtn.addEventListener('click', () => {
    // Free tier can't select all — send them to the paywall instead.
    if (!isEntitled()) { window.location.hash = '#/paywall'; return; }
    setAllPaperMarkets(true, all);
    updateCount();
  });
  if (noneBtn) noneBtn.addEventListener('click', () => {
    setAllPaperMarkets(false, all);
    updateCount();
  });
  // Quick-select every market currently printing a BUY or SELL signal.
  const sigBtn = container.querySelector('#pm-signalling');
  if (sigBtn) sigBtn.addEventListener('click', () => {
    const threshold = state.settings.threshold;
    const syms = new Set(state.engine.markets.filter((m) => m.verdict(threshold) !== 'NO_TRADE').map((m) => m.symbol));
    setPaperMarkets([...syms]);
    updateCount();
  });
  // Region presets: limit auto-trading to one region in a tap. The individual
  // switches below still work, so you can fine-tune from there.
  container.querySelectorAll('[data-region]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const syms = new Set(symbolsInRegion(chip.dataset.region));
      setPaperMarkets([...syms]);
      updateCount();
    });
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

// Realized P&L grouped by the (local) day each trade closed — the day-by-day trend.
function dailyPnlHtml(closed) {
  if (!closed || closed.length < 2) return '';
  const byDay = new Map();
  for (const c of closed) {
    const key = new Date(c.closedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    byDay.set(key, (byDay.get(key) || 0) + tradePnl(c));
  }
  // closed is newest-first, so take the newest 14 days then flip to chronological.
  const days = [...byDay.entries()].slice(0, 14).reverse();
  if (days.length < 2) return '';
  const maxAbs = Math.max(...days.map(([, v]) => Math.abs(v)), 1);
  return `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="panel-title" style="margin-bottom:0">Daily P&amp;L</div>
        <span class="text-muted" style="font-size:12px">last ${days.length} days traded</span>
      </div>
      <div class="bar-chart">
        ${days.map(([label, value]) => {
          const color = value >= 0 ? 'var(--buy)' : 'var(--sell)';
          const h = Math.max(6, (Math.abs(value) / maxAbs) * 100);
          return `<div class="bar-col"><span class="bv" style="color:${color}">${money(value)}</span><div class="b" style="height:${h}%;background:${color}"></div><span class="bl">${label}</span></div>`;
        }).join('')}
      </div>
    </div>`;
}

// Group real closed trades by market → net P&L, win rate, count. Sorted best→worst.
function byMarketStats(closed) {
  const map = new Map();
  for (const c of closed) {
    const p = tradePnl(c);
    const e = map.get(c.symbol) || { symbol: c.symbol, name: c.name || c.symbol, trades: 0, wins: 0, losses: 0, pnl: 0 };
    e.trades += 1; e.pnl += p;
    if (p > 0) e.wins += 1; else if (p < 0) e.losses += 1;
    map.set(c.symbol, e);
  }
  return [...map.values()].sort((a, b) => b.pnl - a.pnl);
}

function byMarketHtml(closed) {
  const rows = byMarketStats(closed);
  if (rows.length < 2) return '';
  return `
    <div class="section-label">Performance by market</div>
    <div class="card" style="padding:2px 12px">
      ${rows.map((m) => {
        const decisive = m.wins + m.losses;
        const wr = decisive ? Math.round((m.wins / decisive) * 100) : 0;
        const color = m.pnl >= 0 ? 'var(--buy)' : 'var(--sell)';
        return `<div class="closed-row" data-nav="#/signal/${m.symbol}" style="cursor:pointer">
          <div class="closed-sym">${m.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${m.name}</div>
            <div class="closed-sub">${m.trades} trade${m.trades === 1 ? '' : 's'} · ${wr}% win</div>
          </div>
          <div class="closed-result"><div class="r" style="color:${color}">${money(m.pnl)}</div></div>
        </div>`;
      }).join('')}
    </div>`;
}

// Smooth cumulative-P&L equity curve, drawn entirely from real closed trades.
function eqSmooth(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function equityChart(equity) {
  const w = 500, h = 132;
  if (!equity || equity.length < 2) return '';
  const min = Math.min(...equity, 0), max = Math.max(...equity, 0);
  const span = (max - min) || 1;
  const pad = span * 0.14;
  const lo = min - pad, hi = max + pad;
  const yFor = (v) => h - ((v - lo) / (hi - lo)) * h;
  const step = w / (equity.length - 1);
  const pts = equity.map((v, i) => [i * step, yFor(v)]);
  const d = eqSmooth(pts);
  const last = equity[equity.length - 1];
  const color = last >= 0 ? 'var(--buy)' : 'var(--sell)';
  const zeroY = yFor(0).toFixed(1);
  const uid = 'eq' + Math.random().toString(36).slice(2, 6);
  const end = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="height:auto;display:block">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.24"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="4 4"/>
    <path d="${d} L${w},${h} L0,${h} Z" fill="url(#${uid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="3" fill="${color}"/>
  </svg>`;
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

// Live unrealized mark-to-market for an open position, in R and dollars, using the
// market's current price and the same maths the closed record uses.
function posLivePnl(p) {
  const m = state.engine.get(p.symbol);
  const px = m && m.price;
  const riskPer = Math.abs(p.risk || (p.entry != null && p.stop != null ? p.entry - p.stop : 0));
  if (!px || p.entry == null || !riskPer) return null;
  const long = (p.side || 'LONG') === 'LONG';
  const r = (long ? (px - p.entry) : (p.entry - px)) / riskPer;
  return { r, dollars: r * (p.riskDollars || 250), px };
}

// A thin risk bar: stop (−1R, left) · entry (0, centre) · target (+1R, right),
// with a marker at the live price and the entry→price move filled in.
function riskBar(r) {
  const pos = Math.max(2, Math.min(98, ((Math.max(-1, Math.min(1, r)) + 1) / 2) * 100));
  const from = Math.min(pos, 50), w = Math.abs(pos - 50);
  const col = r >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `<div style="position:relative;height:6px;background:var(--neutral-900);border-radius:3px;margin-top:8px">
      <div style="position:absolute;left:50%;top:-1px;bottom:-1px;width:1px;background:var(--text-faint);opacity:.6"></div>
      <div style="position:absolute;left:${from}%;width:${w}%;top:0;bottom:0;background:${col};opacity:.85;border-radius:3px"></div>
      <div style="position:absolute;left:calc(${pos}% - 1.5px);top:-2px;bottom:-2px;width:3px;border-radius:2px;background:${col}"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:9.5px;margin-top:3px;color:var(--text-faint)"><span style="color:var(--sell)">Stop</span><span>Entry</span><span style="color:var(--buy)">Target</span></div>`;
}

function openRow(p) {
  const pnl = posLivePnl(p);
  const dec = state.engine.get(p.symbol)?.decimals ?? p.decimals ?? 2;
  const col = pnl ? (pnl.dollars >= 0 ? 'var(--buy)' : 'var(--sell)') : 'var(--text-muted)';
  const pnlStr = pnl ? `${money(pnl.dollars)} · ${pnl.r >= 0 ? '+' : ''}${pnl.r.toFixed(2)}R` : 'live…';
  return `<div class="closed-row" data-open-row="${p.symbol}" data-nav="#/chart/${p.symbol}" style="cursor:pointer;display:block;padding:11px 4px">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="closed-sym">${p.symbol}</div>
        <div class="closed-body" style="flex:1;min-width:0">
          <div class="closed-title">${(p.side || 'LONG') === 'LONG' ? 'Long' : 'Short'} · ${p.name}</div>
          <div class="closed-sub">Entry ${fmtPrice(p.entry, dec)} · stop ${fmtPrice(p.stop, dec)} · target ${fmtPrice(p.target1, dec)}</div>
        </div>
        <div style="text-align:right;flex:none">
          <div class="tabular" data-open-pnl="${p.symbol}" style="color:${col};font-weight:700;font-size:13.5px">${pnlStr}</div>
          <div class="text-muted" style="font-size:10px;margin-top:1px">unrealized</div>
        </div>
      </div>
      <div data-open-bar="${p.symbol}">${pnl ? riskBar(pnl.r) : ''}</div>
    </div>`;
}

function openSig() {
  return getOpenPositions().map((p) => { const q = posLivePnl(p); return `${p.symbol}:${q ? q.r.toFixed(3) : '?'}`; }).join(',');
}

function openList() {
  const open = getOpenPositions();
  if (!open.length) return '';
  return `
    <div class="section-label">Open positions · ${open.length}</div>
    <div class="card" style="padding:2px 12px">
      ${open.map(openRow).join('')}
    </div>`;
}

// Markets nearest a setup, ranked by proximity (used by both the render and the
// live-patch signature so the empty state can update once data arrives).
function watchMarkets() {
  const threshold = state.settings.threshold;
  const held = new Set(getOpenPositions().map((p) => p.symbol));
  return state.engine.markets
    .filter((m) => m.signalIsReal && m.signal && (m.signal.proximity || 0) > 0 && m.verdict(threshold) === 'NO_TRADE' && !held.has(m.symbol))
    .sort((a, b) => (b.signal.proximity || 0) - (a.signal.proximity || 0))
    .slice(0, 5);
}
function watchSig() { return watchMarkets().map((m) => `${m.symbol}:${m.signal.proximity}:${m.signal.rsi2}`).join(','); }

// What's nearest to triggering a trade, by the server's proximity score — so an
// empty record still tells you what to watch. Not signals, just "closest".
function watchingList() {
  const markets = watchMarkets();
  if (!markets.length) return '';
  return `
    <div class="section-label">Closest to a setup</div>
    <div class="card" style="padding:2px 12px">
      ${markets.map((m) => {
        const prox = Math.max(0, Math.min(100, m.signal.proximity || 0));
        const up = m.signal.htfTrend === 'up';
        const trig = up ? `RSI2 ${m.signal.rsi2} · long fires under 15`
          : m.signal.htfTrend === 'down' ? `RSI2 ${m.signal.rsi2} · short fires over 85`
          : `RSI2 ${m.signal.rsi2} · no clear trend`;
        return `<div class="closed-row" data-nav="#/signal/${m.symbol}" style="cursor:pointer">
          <div class="closed-sym">${m.symbol}</div>
          <div class="closed-body">
            <div class="closed-title">${m.name}</div>
            <div class="closed-sub">${trig}</div>
          </div>
          <div class="closed-result"><div class="r" style="color:var(--text-muted)">${prox}%</div><div class="o">to setup</div></div>
        </div>`;
      }).join('')}
    </div>`;
}

function emptyState() {
  const open = getOpenPositions();
  return `
  <div class="fade-in glow-wrap">
    ${intro()}
    ${honestBanner()}
    <div class="panel" style="text-align:center;padding:32px 20px">
      <i class="ph ph-chart-line-up" style="font-size:32px;color:var(--text-muted)"></i>
      <div style="font:600 15px var(--font-heading);margin-top:14px">No completed trades yet</div>
      <p class="text-muted" style="font-size:13px;line-height:1.6;margin-top:8px;max-width:40ch;margin-left:auto;margin-right:auto">
        A virtual trade opens automatically whenever a real signal clears your confidence threshold, then runs until it hits its target or stop.
        ${open.length ? `${open.length} ${open.length === 1 ? 'trade is' : 'trades are'} open right now — results will appear here once they close.` : 'The strategy is in cash right now — that’s normal ~90% of the time.'}
      </p>
    </div>
    <div id="watch-wrap" data-sig="${watchSig()}">${watchingList()}</div>
    <div id="open-wrap" data-sig="${openSig()}">${openList()}</div>
    ${marketSelector()}
    ${pnlHelp()}
    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">Educational only · past results don't guarantee future performance.</p>
  </div>`;
}

export function render(container) {
  const perf = getPerformanceSummary();
  if (!perf) { container.innerHTML = emptyState(); wireSelector(container); return; }

  const closed = getClosedTrades();
  const maxAbs = Math.max(...perf.monthlyPnl.map((m) => Math.abs(m.value)), 1);
  const pnlColor = perf.totalPnl >= 0 ? 'var(--buy)' : 'var(--sell)';
  const up = perf.totalPnl >= 0;
  const pfStr = perf.profitFactor === Infinity ? '∞' : perf.profitFactor.toFixed(2);

  container.innerHTML = `
  <div class="fade-in glow-wrap">
    ${intro()}

    <div class="pf-hero ${up ? 'up' : 'down'}">
      <div class="pf-hero-label">Net virtual P&amp;L · ${closed.length} trade${closed.length === 1 ? '' : 's'}</div>
      <div class="pf-hero-value" style="color:${pnlColor}">${money(perf.totalPnl)}</div>
      <div class="pf-hero-meta"><span style="color:var(--buy)">${perf.winRate}% win</span> · PF ${pfStr} · ${perf.wins}W / ${perf.losses}L</div>
      ${closed.length >= 2 ? `<div class="pf-hero-chart">${equityChart(perf.equity)}</div>` : ''}
    </div>

    ${honestBanner()}

    <div class="stat2-grid">
      <div class="stat-card"><div class="stat-label">Win rate</div><div class="stat-value" style="color:var(--buy)">${perf.winRate}%</div><div class="stat-sub">${perf.wins}W / ${perf.losses}L</div></div>
      <div class="stat-card"><div class="stat-label">Avg win</div><div class="stat-value" style="color:var(--buy)">${money(perf.avgWin)}</div><div class="stat-sub">per winning trade</div></div>
      <div class="stat-card"><div class="stat-label">Avg loss</div><div class="stat-value" style="color:var(--sell)">${money(-perf.avgLoss)}</div><div class="stat-sub">per losing trade</div></div>
      <div class="stat-card"><div class="stat-label">Avg hold</div><div class="stat-value">${perf.avgHold}</div><div class="stat-sub">per trade</div></div>
    </div>

    <div class="stat2-grid">
      <div class="stat-card"><div class="stat-label">Profit factor</div><div class="stat-value">${perf.profitFactor === Infinity ? '∞' : perf.profitFactor.toFixed(2)}</div><div class="stat-sub">gross win ÷ loss</div></div>
      <div class="stat-card"><div class="stat-label">Expectancy</div><div class="stat-value" style="color:${perf.expectancy >= 0 ? 'var(--buy)' : 'var(--sell)'}">${money(perf.expectancy)}</div><div class="stat-sub">avg per trade</div></div>
      <div class="stat-card"><div class="stat-label">Best streak</div><div class="stat-value" style="color:var(--buy)">${perf.bestWinStreak}W</div><div class="stat-sub">consecutive wins</div></div>
      <div class="stat-card"><div class="stat-label">Max drawdown</div><div class="stat-value" style="color:var(--sell)">${money(perf.maxDrawdown)}</div><div class="stat-sub">peak-to-trough</div></div>
    </div>

    ${dailyPnlHtml(closed)}

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

    <div id="open-wrap" data-sig="${openSig()}">${openList()}</div>

    ${byMarketHtml(closed)}

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

    <div class="section-label" style="margin-top:20px">Setup</div>
    ${marketSelector()}
    ${pnlHelp()}

    <p class="text-faint" style="text-align:center;font-size:11px;margin-top:14px">Virtual money only · educational · past results don't guarantee future performance.</p>
  </div>`;

  wireSelector(container);
}

// Live, in-place refresh: only re-paint the per-market Buy/Sell/Flat tags in the
// selector while it's open. Never rebuilds the panel, so the open/closed groups
// and any in-progress editing stay put.
export function refresh(container) {
  // Empty state: if a trade has now closed, switch to the full record; otherwise
  // live-patch the "closest to a setup" list when proximity data changes (it
  // usually isn't loaded yet at first render). Patch only #watch-wrap so the
  // market selector's open/editing state is never disturbed.
  const watchWrap = container.querySelector('#watch-wrap');
  if (watchWrap) {
    if (getPerformanceSummary()) { render(container); return; }
    const sig = watchSig();
    if (watchWrap.dataset.sig !== sig) { watchWrap.innerHTML = watchingList(); watchWrap.dataset.sig = sig; }
  }

  // Open positions: patch each row's live P&L + risk bar as prices tick (works in
  // both the empty state and the full record view).
  const openWrap = container.querySelector('#open-wrap');
  if (openWrap) {
    const sig = openSig();
    if (openWrap.dataset.sig !== sig) {
      getOpenPositions().forEach((p) => {
        const pnl = posLivePnl(p);
        const pEl = openWrap.querySelector(`[data-open-pnl="${p.symbol}"]`);
        const bEl = openWrap.querySelector(`[data-open-bar="${p.symbol}"]`);
        if (pEl && pnl) {
          pEl.textContent = `${money(pnl.dollars)} · ${pnl.r >= 0 ? '+' : ''}${pnl.r.toFixed(2)}R`;
          pEl.style.color = pnl.dollars >= 0 ? 'var(--buy)' : 'var(--sell)';
        }
        if (bEl && pnl) bEl.innerHTML = riskBar(pnl.r);
      });
      // If the set of open positions changed (a trade opened/closed), rebuild.
      const cur = [...openWrap.querySelectorAll('[data-open-row]')].map((el) => el.dataset.openRow).join(',');
      const now = getOpenPositions().map((p) => p.symbol).join(',');
      if (cur !== now) openWrap.innerHTML = openList();
      openWrap.dataset.sig = sig;
    }
  }

  const list = container.querySelector('#pm-list');
  if (!list || list.style.display === 'none') return;
  const threshold = state.settings.threshold;
  list.querySelectorAll('[data-pm-trend]').forEach((el) => {
    const m = state.engine.get(el.dataset.pmTrend);
    if (!m) return;
    const b = verdictBits(m.verdict(threshold));
    const cls = `pm-trend ${b.cls}`;
    if (el.className !== cls) el.className = cls;
    if (el.innerHTML !== b.inner) el.innerHTML = b.inner;
  });
}
