import { state } from '../state.js';
import { isRealMarket } from './markets.js';
import { INDICATORS, INDICATOR_KEYS, defaultCondition, evalCustom, getCustomConfig, setCustomConfig, resetCustomConfig } from '../customStrategy.js';
import { customStats, customEquity, ajentAvgR } from '../customBook.js';
import { getPerformanceSummary, getClosedTrades } from '../paperTrading.js';
import { sparklineSvg } from '../components.js';

// "Your strategy" — a multi-indicator builder. Pick from a palette of popular
// indicators, combine them (all must agree), long / short / both, and see YOUR
// signals across the board scored against the proven Ajent Pulse. Your rule is your
// experiment; Ajent Pulse's recipe stays proprietary and untouched.

const DIRS = [['long', 'Long only'], ['short', 'Short only'], ['both', 'Both ways']];

// One tunable param control — segmented buttons for option params, a slider otherwise.
function paramCtrl(idx, cond, p) {
  const val = cond[p.k] ?? p.def;
  if (p.options) {
    return `<div class="cs-p"><span class="cs-p-l">${p.label}</span><div class="cs-seg">${p.options.map((o) =>
      `<button class="cs-seg-b${val === o ? ' on' : ''}" data-cond-opt="${idx}:${p.k}:${o}">${String(o).toUpperCase()}</button>`).join('')}</div></div>`;
  }
  return `<label class="cs-p"><span class="cs-p-l">${p.label}</span>
    <input type="range" class="range" data-cond-rng="${idx}:${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">
    <span class="cs-p-v" data-cond-v="${idx}:${p.k}">${val}</span></label>`;
}

function condCard(cond, idx, direction) {
  const meta = INDICATORS[cond.key]; if (!meta) return '';
  const rule = direction === 'short' ? meta.short(cond) : direction === 'both'
    ? `${meta.long(cond)} <span class="cs-or">/ short:</span> ${meta.short(cond)}` : meta.long(cond);
  return `<div class="cs-cond">
    <div class="cs-cond-head">
      <div><div class="cs-cond-name">${meta.label}</div><div class="cs-cond-rule">${rule}</div></div>
      <button class="cs-cond-del" data-cond-del="${idx}" title="Remove" aria-label="Remove ${meta.label}"><i class="ph-bold ph-x"></i></button>
    </div>
    <div class="cs-cond-params">${meta.params.map((p) => paramCtrl(idx, cond, p)).join('')}</div>
  </div>`;
}

function configPanel(cfg) {
  const used = new Set(cfg.conditions.map((c) => c.key));
  const addable = INDICATOR_KEYS; // duplicates allowed (e.g. two MAs)
  return `<div class="panel cs-config">
    <div class="cs-dir-row">
      <span class="cs-l">Direction</span>
      <div class="cs-seg">${DIRS.map(([k, l]) => `<button class="cs-seg-b${cfg.direction === k ? ' on' : ''}" data-cs-dir="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="cs-cond-list">
      ${cfg.conditions.length ? cfg.conditions.map((c, i) => condCard(c, i, cfg.direction)).join('')
        : '<div class="text-muted" style="font-size:12.5px;padding:8px 2px">No indicators yet — add one below. Your rule fires only when <b>all</b> your indicators agree.</div>'}
    </div>
    <div class="cs-add">
      <span class="cs-add-l">Add indicator</span>
      <div class="cs-add-chips">${addable.map((k) => `<button class="cs-add-chip${used.has(k) ? ' dim' : ''}" data-cond-add="${k}">+ ${INDICATORS[k].label}</button>`).join('')}</div>
    </div>
    <div class="cs-hint"><i class="ph-bold ph-info"></i> All conditions must agree to fire. On <b>Both ways</b>, a long fires when every indicator is bullish, a short when every one is bearish.</div>
    <button class="cs-reset" data-cs-reset>Reset to the classic dip-buy</button>
  </div>`;
}

function boardHtml(cfg) {
  const threshold = state.settings.threshold;
  const markets = state.engine.markets.filter(isRealMarket);
  const rows = markets.map((m) => ({ m, c: evalCustom(m, cfg), aj: m.verdict(threshold) === 'BUY' })).filter((x) => x.c.ready);
  const yours = rows.filter((x) => x.c.fires);
  const ajent = rows.filter((x) => x.aj);
  const common = yours.filter((x) => x.aj).length;

  const cmp = `<div class="cs-cmp">
    <div class="cs-cmp-col"><div class="cs-cmp-n">${yours.length}</div><div class="cs-cmp-l">your signals</div></div>
    <div class="cs-cmp-col mid"><div class="cs-cmp-n" style="color:var(--accent)">${common}</div><div class="cs-cmp-l">in common</div></div>
    <div class="cs-cmp-col"><div class="cs-cmp-n">${ajent.length}</div><div class="cs-cmp-l">Ajent BUYs</div></div>
  </div>`;

  // Fires first, then by how many conditions are met (closest to firing).
  const ranked = rows.slice().sort((a, b) => (b.c.fires - a.c.fires) || (b.c.proximity - a.c.proximity));
  const list = ranked.slice(0, 12).map(({ m, c, aj }) => {
    const dirTag = c.fires ? (c.dir < 0 ? '<span class="cs-tag you sh">SHORT</span>' : '<span class="cs-tag you">LONG</span>') : '';
    const meta = c.fires ? `<span class="cs-conf">${c.confidence}%</span>` : `<span class="cs-prox">${c.met}/${c.total} met</span>`;
    return `<div class="cs-row" data-nav="#/signal/${m.symbol}">
      <span class="cs-sym">${m.symbol}</span>
      <span class="cs-rsi">${meta}</span>
      <span class="cs-tags">${dirTag}${aj ? '<span class="cs-tag aj">AJENT</span>' : ''}</span>
    </div>`;
  }).join('');

  return `${cmp}<div class="cs-board">${list || '<p class="text-muted" style="text-align:center;padding:20px 0;font-size:13px">Live data is loading…</p>'}</div>`;
}

function recordPanel() {
  const you = customStats();
  const aj = getPerformanceSummary() || { totalPnl: 0, winRate: 0, profitFactor: null };
  const money = (n) => `${n >= 0 ? '+$' : '−$'}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const pf = (v) => (v == null ? '∞' : (+v).toFixed(2));
  if (!you.trades && !you.open) {
    return `<div class="panel">
      <div class="panel-title">Your strategy's record</div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.55;padding:4px 0">Your strategy hasn't taken a trade yet — it <b style="color:var(--text)">trades automatically in the background</b> as your rule fires, building a real record to compare against Ajent. Check back as it runs.</div>
    </div>`;
  }
  const eq = customEquity();
  const spark = eq.length > 2 ? sparklineSvg(eq, you.net >= 0 ? 'var(--buy)' : 'var(--sell)', 240, 40) : '';
  const ajR = ajentAvgR(getClosedTrades());
  const rr = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`);
  return `<div class="panel">
    <div class="panel-title">Your strategy's record</div>
    <div class="vs-grid">
      <div class="vs-col"><div class="vs-who">AJENT</div><div class="vs-exp" style="color:${(ajR || 0) >= 0 ? 'var(--buy)' : 'var(--sell)'}">${rr(ajR)}<span class="vs-exp-l">avg/trade</span></div><div class="vs-sub">${money(aj.totalPnl || 0)} · ${aj.winRate || 0}% · PF ${pf(aj.profitFactor)}</div></div>
      <div class="vs-mid">vs</div>
      <div class="vs-col"><div class="vs-who">YOURS</div><div class="vs-exp" style="color:${(you.avgR || 0) >= 0 ? 'var(--buy)' : 'var(--sell)'}">${rr(you.avgR)}<span class="vs-exp-l">avg/trade</span></div><div class="vs-sub">${money(you.net)} · ${you.winRate}% · ${you.trades}T · ${you.open} open</div></div>
    </div>
    ${spark ? `<div style="margin-top:6px">${spark}</div>` : ''}
    <div class="fair-note"><b>Avg/trade (expectancy) is the fair number</b> — it's true at any scale. Net $ mostly reflects <b>how many trades</b> each took: Ajent trades the whole board, yours only what your rule picks.</div>
  </div>`;
}

export function render(container) {
  const draw = () => {
    const cfg = getCustomConfig();
    container.innerHTML = `
    <div class="fade-in glow-wrap">
      <div class="dash-glow"></div>
      <h1 class="h-title">Your strategy</h1>
      <p class="text-muted" style="font-size:13px;margin:4px 0 14px;line-height:1.5">Build your own rule from the indicator palette and see your signals across the board — scored against the proven <b style="color:var(--text)">Ajent Pulse</b>. This is <b style="color:var(--text)">your experiment</b>, not a validated edge.</p>
      ${configPanel(cfg)}
      ${recordPanel()}
      <div class="panel">
        <div class="panel-title">Your signals vs Ajent · right now</div>
        <div id="cs-board-wrap">${boardHtml(cfg)}</div>
      </div>
      <div class="text-faint" style="font-size:11px;line-height:1.5;margin-top:12px">These are <b>your</b> rule's signals on real daily data — a live snapshot, not a backtest or a guarantee. The palette is standard public indicators; Ajent Pulse's exact recipe stays proprietary and your settings never change it or the tracked record. Educational only.</div>
    </div>`;
    wire();
  };

  const refreshBoard = () => { const w = container.querySelector('#cs-board-wrap'); if (w) w.innerHTML = boardHtml(getCustomConfig()); };

  function wire() {
    // Direction
    container.querySelectorAll('[data-cs-dir]').forEach((b) => b.addEventListener('click', () => {
      const c = getCustomConfig(); c.direction = b.dataset.csDir; setCustomConfig(c); draw();
    }));
    // Add indicator
    container.querySelectorAll('[data-cond-add]').forEach((b) => b.addEventListener('click', () => {
      const c = getCustomConfig(); c.conditions.push(defaultCondition(b.dataset.condAdd)); setCustomConfig(c); draw();
    }));
    // Remove indicator
    container.querySelectorAll('[data-cond-del]').forEach((b) => b.addEventListener('click', () => {
      const c = getCustomConfig(); c.conditions.splice(Number(b.dataset.condDel), 1); setCustomConfig(c); draw();
    }));
    // Option params (re-render so the rule text updates)
    container.querySelectorAll('[data-cond-opt]').forEach((b) => b.addEventListener('click', () => {
      const [i, k, o] = b.dataset.condOpt.split(':'); const c = getCustomConfig();
      c.conditions[Number(i)][k] = o; setCustomConfig(c); draw();
    }));
    // Slider params (live: update value + rule text + board, no full re-render)
    container.querySelectorAll('[data-cond-rng]').forEach((el) => el.addEventListener('input', () => {
      const [i, k] = el.dataset.condRng.split(':'); const c = getCustomConfig();
      c.conditions[Number(i)][k] = Number(el.value); setCustomConfig(c);
      const v = container.querySelector(`[data-cond-v="${i}:${k}"]`); if (v) v.textContent = el.value;
      const card = el.closest('.cs-cond'); const meta = INDICATORS[c.conditions[Number(i)].key];
      const ruleEl = card && card.querySelector('.cs-cond-rule');
      if (ruleEl && meta) { const cc = c.conditions[Number(i)]; ruleEl.innerHTML = c.direction === 'short' ? meta.short(cc) : c.direction === 'both' ? `${meta.long(cc)} <span class="cs-or">/ short:</span> ${meta.short(cc)}` : meta.long(cc); }
      refreshBoard();
    }));
    const reset = container.querySelector('[data-cs-reset]');
    if (reset) reset.addEventListener('click', () => { resetCustomConfig(); draw(); });
  }

  draw();
}
