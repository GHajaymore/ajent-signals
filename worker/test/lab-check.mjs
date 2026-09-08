// Verify the lab engine: circular import resolves, candidates produce distinct sensible records.
import { MARKETS } from '../src/markets.js';
import { labStep, labSummary } from '../src/lab.js';
import { DATA } from './bt.mjs';
const RISK=250, COST=6;
const lab = { startedAt: DATA.ES[210].t, cand: {} };
for (const sym of Object.keys(DATA)) {
  const c = DATA[sym], meta = MARKETS[sym];
  for (let i=210;i<c.length;i++) labStep(lab, sym, c.slice(0,i+1), c[i].c, meta, c[i].t, RISK, COST);
}
const s = labSummary(lab);
console.log('\nLAB CHECK — candidates forward-tested on backtest data:\n');
for (const cand of s.candidates) console.log(`  ${cand.label.padEnd(28)} trades=${String(cand.trades).padStart(4)} net=$${String(cand.net).padStart(6)} win=${String(cand.winRate).padStart(3)}% PF=${String(cand.profitFactor).padStart(5)} DD=$${String(cand.maxDrawdown).padStart(6)}`);
const distinct = new Set(s.candidates.map(c=>c.trades)).size>1;
console.log('\n  Candidates produce DISTINCT records (not all identical):', distinct ? 'YES ✓' : 'NO ✗ (bug)');
