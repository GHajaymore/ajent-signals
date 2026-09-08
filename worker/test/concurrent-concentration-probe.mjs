// Does a concentration cap now HELP, given concurrent slots stack MR+trend and grew DD to ~12%?
// (The MR-only concentration probe found caps useless; concurrent is a different portfolio.)
// Replays the concurrent trade set (MR ∪ trend, post-%B) under caps; return/DD is the judge.
import { MARKETS } from '../src/markets.js';
import { fetchDailyCandles } from '../src/data.js';
import { computeSignal } from '../src/strategy.js';
import { computeTrend, trendShouldExit } from '../src/trend.js';
import { mrShouldExit, processPosition } from '../src/scheduler.js';
const RISK=250,COST=6,PB=0.30;
const BUCKET={}; for(const s of ['ES','NQ','YM','RTY','SPY','QQQ','IWM','SMH','XLK','XLF','XLE','XLV','XLY'])BUCKET[s]='us';
for(const s of ['SX5E','N225','TSX','FTSE','DAX'])BUCKET[s]='intl'; for(const s of ['BTC','ETH'])BUCKET[s]='crypto';
const CRYPTO=new Set(['BTC','ETH']); const SYMS=Object.keys(BUCKET); const DATA={};
for(const s of SYMS){if(!MARKETS[s])continue;try{const{candles}=await fetchDailyCandles(MARKETS[s],{DATA_PROVIDER:'yahoo'});if(candles&&candles.length>260)DATA[s]=candles;}catch(e){}}
const gate=(sym,sig)=>(!CRYPTO.has(sym)&&sig.verdict==='BUY'&&typeof sig.pctB==='number'&&sig.pctB>=PB)?{...sig,verdict:'NO_TRADE',direction:0,plan:null}:sig;
function eng(sym,which){const c=DATA[sym],meta=MARKETS[sym],rec={open:{},closed:[],lastClose:{}};for(let i=210;i<c.length;i++){const sig=which==='mr'?gate(sym,computeSignal(c.slice(0,i+1),c[i].c)):computeTrend(c.slice(0,i+1),c[i].c);processPosition({symbol:sym,meta,sig,live:c[i].c,open:true,record:rec,now:c[i].t,risk:RISK,cost:COST,strat:which,shouldExit:which==='mr'?mrShouldExit:trendShouldExit});}return rec.closed.map(t=>({...t,sym,bucket:BUCKET[sym]}));}
const trades=[];for(const s of Object.keys(DATA)){trades.push(...eng(s,'mr'),...eng(s,'trend'));}
trades.sort((a,b)=>a.openedAt-b.openedAt);
function replay({globalMax=Infinity,bucketMax=Infinity}){const open=[],acc=[];for(const t of trades){for(let k=open.length-1;k>=0;k--)if(open[k].closedAt<=t.openedAt)open.splice(k,1);const g=open.length,b=open.filter(o=>o.bucket===t.bucket).length;if(g>=globalMax||b>=bucketMax)continue;open.push({closedAt:t.closedAt,bucket:t.bucket});acc.push(t);}acc.sort((a,b)=>a.closedAt-b.closedAt);let eq=0,pk=0,dd=0;const w=acc.filter(x=>x.pnl>0),gw=w.reduce((s,x)=>s+x.pnl,0),gl=Math.abs(acc.filter(x=>x.pnl<0).reduce((s,x)=>s+x.pnl,0));for(const x of acc){eq+=x.pnl;pk=Math.max(pk,eq);dd=Math.min(dd,eq-pk);}return{n:acc.length,net:Math.round(eq),maxDD:Math.round(dd),pf:+(gw/(gl||1)).toFixed(2),retDD:+(eq/-(dd||1)).toFixed(2)};}
const f=p=>`n=${String(p.n).padStart(3)} net=$${String(p.net).padStart(6)} maxDD=$${String(p.maxDD).padStart(6)} pf=${String(p.pf).padStart(5)} return/DD=${p.retDD}`;
let peak=0;{const open=[];for(const t of trades){for(let k=open.length-1;k>=0;k--)if(open[k].closedAt<=t.openedAt)open.splice(k,1);open.push({closedAt:t.closedAt,bucket:t.bucket});peak=Math.max(peak,open.length);}}
console.log(`\nCONCURRENT-SLOTS CONCENTRATION — ${Object.keys(DATA).length} markets. Peak concurrent (no cap): ${peak}.\n`);
console.log('  no cap (shipped)  ',f(replay({})));
for(const g of [8,10,12,15])console.log(`  global max ${String(g).padStart(2)}     `,f(replay({globalMax:g})));
for(const b of [3,4,5])console.log(`  bucket max ${b}       `,f(replay({bucketMax:b})));
