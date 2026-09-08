// Should the adopted %B<0.30 gate extend to the STOCK SCREENER (currently ungated)?
// Individual large-caps are the same equity long-only MR edge, but noisier (single-name gaps).
// Validate on the real stock universe before extending: sweep %B, IS/OOS.
import { STOCK_UNIVERSE } from '../src/stocks.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { processPosition, mrShouldExit } from '../src/scheduler.js';
const RISK=250,COST=6;
const DATA={};
for(const sym of STOCK_UNIVERSE){ try{ const {candles}=await fetchDailyCandles({yahoo:sym,country:'US'},{DATA_PROVIDER:'yahoo'}); if(candles&&candles.length>260)DATA[sym]=candles; }catch(e){} }
const SYMS=Object.keys(DATA);
function run(thr){const closed=[];for(const sym of SYMS){const c=DATA[sym],meta={symbol:sym,name:sym,country:'US'},rec={open:{},closed:[],lastClose:{}};for(let i=210;i<c.length;i++){let sig=computeSignal(c.slice(0,i+1),c[i].c);if(thr!=null&&sig.verdict==='BUY'&&typeof sig.pctB==='number'&&sig.pctB>=thr)sig={...sig,verdict:'NO_TRADE',direction:0,plan:null};processPosition({symbol:sym,meta,sig,live:c[i].c,open:true,record:rec,now:c[i].t,risk:RISK,cost:COST,strat:'mr',shouldExit:mrShouldExit});}for(const t of rec.closed){t.closedAt=t.closedAt;closed.push(t);}}return closed.sort((a,b)=>a.closedAt-b.closedAt);}
function st(t){if(!t.length)return{n:0};const w=t.filter(x=>x.pnl>0),gw=w.reduce((s,x)=>s+x.pnl,0),gl=Math.abs(t.filter(x=>x.pnl<0).reduce((s,x)=>s+x.pnl,0));let eq=0,pk=0,dd=0;for(const x of t){eq+=x.pnl;pk=Math.max(pk,eq);dd=Math.min(dd,eq-pk);}return{n:t.length,win:Math.round(100*w.length/t.length),avgR:+(t.reduce((s,x)=>s+(x.resultR||0),0)/t.length).toFixed(3),pf:+(gw/(gl||1)).toFixed(2),pnl:Math.round(t.reduce((s,x)=>s+x.pnl,0)),maxDD:Math.round(dd)};}
const f=s=>s.n?`n=${String(s.n).padStart(4)} win=${String(s.win).padStart(3)}% avgR=${String(s.avgR).padStart(6)} pf=${String(s.pf).padStart(5)} net=$${String(s.pnl).padStart(6)} DD=$${String(s.maxDD).padStart(6)}`:'(none)';
let tMin=Infinity,tMax=-Infinity;const b=run(0.30);for(const t of b){tMin=Math.min(tMin,t.closedAt);tMax=Math.max(tMax,t.closedAt);}const mid=tMin+(tMax-tMin)*0.6;
console.log(`\nSTOCK SCREENER %B CHECK — ${SYMS.length} stocks. Currently UNGATED.\n`);
console.log('FULL:');console.log('  no gate   ',f(st(run(null))));for(const thr of [0.10,0.15,0.20,0.25,0.30])console.log(`  %B<${thr.toFixed(2)}  `,f(st(run(thr))));
console.log('OOS (40%):');console.log('  no gate   ',f(st(run(null).filter(t=>t.closedAt>=mid))));for(const thr of [0.10,0.15,0.20,0.25])console.log(`  %B<${thr.toFixed(2)}  `,f(st(run(thr).filter(t=>t.closedAt>=mid))));
