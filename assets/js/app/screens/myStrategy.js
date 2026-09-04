import { state } from '../state.js';
import { isRealMarket } from './markets.js';
import { evalCustom, getCustomConfig, setCustomConfig, resetCustomConfig, CUSTOM_BOUNDS, CUSTOM_DEFAULT } from '../customStrategy.js';
import { customStats, customEquity, ajentAvgR } from '../customBook.js';
import { getPerformanceSummary, getClosedTrades } from '../paperTrading.js';
import { sparklineSvg } from '../components.js';

// "Your strategy" — configure your own indicators, see YOUR signals across the
// board, scored against the proven Ajent Pulse. Your rule is your experiment;
// Ajent Pulse's recipe stays proprietary.

function slider(key, label, val, b) {
  return `<label class="cs-slider">
    <span class="cs-l">${label}</span>
    <input type="range" class="range" data-cs="${key}" min="${b.min}" max="${b.max}" step="${b.step}" value="${val}">
    <span class="cs-v" data-csv="${key}">${val}</span>
  </label>`;
}

function configPanel(cfg) {
  return `<div class="panel cs-config">
    <div class="panel-title">Your indicators</div>
    ${slider('rsiPeriod', 'RSI period', cfg.rsiPeriod, CUSTOM_BOUNDS.rsiPeriod)}
    ${slider('entryBelow', 'Buy when RSI below', cfg.entryBelow, CUSTOM_BOUNDS.entryBelow)}
    ${slider('exitAbove', 'Exit when RSI above', cfg.exitAbove, CUSTOM_BOUNDS.exitAbove)}
    <label class="cs-toggle-row">
      <span class="cs-l">Only in an uptrend</span>
      <span class="switch${cfg.useTrend ? ' on' : ''}" data-cs-toggle="useTrend"></span>
    </label>
    <div class="cs-sma-row${cfg.useTrend ? '' : ' off'}">
      <span class="cs-l">Trend filter</span>
      <div class="cs-sma">${CUSTOM_BOUNDS.trendSma.options.map((n) => `<button class="cs-sma-btn${cfg.trendSma === n ? ' on' : ''}" data-cs-sma="${n}">${n}-day</button>`).join('')}</div>
    </div>
    <button class="cs-reset" data-cs-reset>Reset to Ajent-like defaults</button>
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
    <div class="cs-cmp-col"><div class="cs-cmp-n">${yours.length}</div><div class="cs-cmp-l">your BUYs</div></div>
    <div class="cs-cmp-col mid"><div class="cs-cmp-n" style="color:var(--accent)">${common}</div><div class="cs-cmp-l">in common</div></div>
    <div class="cs-cmp-col"><div class="cs-cmp-n">${ajent.length}</div><div class="cs-cmp-l">Ajent BUYs</div></div>
  </div>`;

  // Rank: your fires first (with agreement), then the rest by RSI ascending (closest).
  const ranked = rows.slice().sort((a, b) => (b.c.fires - a.c.fires) || (a.c.rsi - b.c.rsi));
  const list = ranked.slice(0, 12).map(({ m, c, aj }) => `
    <div class="cs-row" data-nav="#/signal/${m.symbol}">
      <span class="cs-sym">${m.symbol}</span>
      <span class="cs-rsi">RSI ${c.rsi}${c.trendOk ? '' : ' <span class="cs-dn">· downtrend</span>'}${c.fires ? ` <span class="cs-conf">· ${c.confidence}%</span>` : ''}</span>
      <span class="cs-tags">
        ${c.fires ? '<span class="cs-tag you">YOU</span>' : ''}
        ${aj ? '<span class="cs-tag aj">AJENT</span>' : ''}
      </span>
    </div>`).join('');

  return `${cmp}
    <div class="cs-board">${list || '<p class="text-muted" style="text-align:center;padding:20px 0;font-size:13px">Live data is loading…</p>'}</div>`;
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
    <div class="fair-note"><b>Avg/trade (expectancy) is the fair number</b> — it's true at any scale, even a small account trading a few positions. Win rate &amp; PF are fair too. Net $ mostly reflects <b>how many trades</b> each took: Ajent trades the whole board, yours only what your rule picks.</div>
  </div>`;
}

export function render(container) {
  const cfg = getCustomConfig();
  container.innerHTML = `
  <div class="fade-in glow-wrap">
    <div class="dash-glow"></div>
    <h1 class="h-title">Your strategy</h1>
    <p class="text-muted" style="font-size:13px;margin:4px 0 14px;line-height:1.5">Configure your own indicators and see your signals across the board — scored against the proven <b style="color:var(--text)">Ajent Pulse</b>. This is <b style="color:var(--text)">your experiment</b>, not a validated edge.</p>

    ${configPanel(cfg)}

    ${recordPanel()}

    <div class="panel">
      <div class="panel-title">Your signals vs Ajent · right now</div>
      <div id="cs-board-wrap">${boardHtml(cfg)}</div>
    </div>

    <div class="text-faint" style="font-size:11px;line-height:1.5;margin-top:12px">These are <b>your</b> rule's signals on real daily data — a live snapshot, not a backtest or a guarantee. Ajent Pulse's exact recipe stays proprietary; your settings never change it or the tracked record. Educational only.</div>
  </div>`;

  const boardWrap = container.querySelector('#cs-board-wrap');
  const save = (c) => { setCustomConfig(c); boardWrap.innerHTML = boardHtml(c); };

  container.querySelectorAll('[data-cs]').forEach((el) => el.addEventListener('input', () => {
    const c = getCustomConfig();
    c[el.dataset.cs] = Number(el.value);
    container.querySelector(`[data-csv="${el.dataset.cs}"]`).textContent = el.value;
    save(c);
  }));
  const toggle = container.querySelector('[data-cs-toggle]');
  if (toggle) toggle.addEventListener('click', () => {
    const c = getCustomConfig(); c.useTrend = !c.useTrend;
    toggle.classList.toggle('on', c.useTrend);
    container.querySelector('.cs-sma-row').classList.toggle('off', !c.useTrend);
    save(c);
  });
  container.querySelectorAll('[data-cs-sma]').forEach((b) => b.addEventListener('click', () => {
    const c = getCustomConfig(); c.trendSma = Number(b.dataset.csSma);
    container.querySelectorAll('[data-cs-sma]').forEach((x) => x.classList.toggle('on', x === b));
    save(c);
  }));
  const reset = container.querySelector('[data-cs-reset]');
  if (reset) reset.addEventListener('click', () => { resetCustomConfig(); render(container); });
}
