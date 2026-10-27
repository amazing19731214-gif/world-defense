// 保存途中の失敗・倉庫上限・混成部隊の回帰テスト。通常プレイとは別の独立コンテキストを使用。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = http.createServer((req, res) => {res.setHeader('Content-Type', 'text/html');res.end(readFileSync(new URL('../index.html', import.meta.url)));});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const W = 'worldDefense.warlords.v1', S = 'worldDefense.soldiers.v1', T = 'worldDefense.bookTransaction.v1';
const url = `http://127.0.0.1:${server.address().port}/?debug`;
let checks = 0;
function check(condition, message) {assert.ok(condition, message);checks++;console.log('✓ ' + message);}
async function setup(count = 0) {
  const context = await browser.newContext({ viewport: {width:390,height:844}, isMobile:true, hasTouch:true });
  await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await context.newPage();await page.goto(url);
  await page.evaluate(({W,S,count}) => {
    localStorage.clear();
    localStorage.setItem(W,JSON.stringify({owned:{shingen:1,kanetsugu:1},tickets:0,forge:{items:Array.from({length:count},(_,i)=>({uid:i+1,id:'uchigatana',owner:null})),seq:count,books:{goriki:1}}}));
    localStorage.setItem(S,JSON.stringify({seq:10,squadSeq:1,squads:[{id:1,type:'spearman',slot:0}],soldiers:Array.from({length:10},(_,i)=>({id:i+1,type:'spearman',squadId:1,level:30})),fallen:[]}));
  },{W,S,count});await page.reload();await page.waitForFunction(()=>window.WD_DEBUG);return {page,context};
}
try {
  for (const key of [W,S,T]) {
    const {page,context} = await setup();
    const result = await page.evaluate(({key,T})=>{
      const D=WD_DEBUG, s=D.state().soldiers[0], original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k===key)throw Error('injected write failure');return original.call(this,k,v);};
      let error;try{error=D.forgeApi.useBook(s,'goriki');}finally{Storage.prototype.setItem=original;}
      return {error,learned:s.learned.includes('goriki'),pending:!!localStorage.getItem(T)};
    },{key,T});
    check(key===T ? !!result.error&&!result.learned : result.error===null&&result.learned&&result.pending, '書の確定前/確定後の失敗を区別: '+key);
    await page.reload();
    const state = await page.evaluate(()=>{const D=WD_DEBUG;return {learned:D.state().soldiers[0].learned.includes('goriki'),books:D.forgeApi.save().books.goriki||0,error:D.forgeApi.useBook(D.state().soldiers[1],'goriki')};});
    check(key===T ? !state.learned&&state.books===1 : state.learned&&state.books===0&&!!state.error, '再読み込み後も書の消費と習得が一致: '+key);
    await context.close();
  }
  {
    const {page,context}=await setup(300);
    await page.evaluate(()=>{const A=WD_DEBUG.squadApi;A.conquestMeta().secrets.hiei=true;assertStart();function assertStart(){const a=A.setBossTarget('hiei'),b=A.startBattle();if(a||b)throw Error(a||b);}A.endBattle('win');});
    for(let i=0;i<2;i++){
      await page.reload();
      const result=await page.evaluate(()=>{const F=WD_DEBUG.forgeApi.save();return {n:F.items.length,reward:F.items.filter(x=>x.id==='byakkoArmor').length,flag:F.bossRewards.hiei};});
      check(result.n===301&&result.reward===1&&result.flag,'満杯でも限定報酬を保持（再読み込み '+(i+1)+'）');
    }
    await page.evaluate(({W})=>{const d=JSON.parse(localStorage.getItem(W));d.forge.items=d.forge.items.filter(x=>x.id!=='byakkoArmor');localStorage.setItem(W,JSON.stringify(d));},{W});
    await page.reload();
    check(await page.evaluate(()=>WD_DEBUG.forgeApi.save().items.some(x=>x.id==='byakkoArmor')), '旧版で消失済みの受領済み限定報酬を復元');
    await context.close();
  }
  {
    const {page,context}=await setup();
    const r=await page.evaluate(()=>{
      const D=WD_DEBUG,A=D.squadApi,H=D.heroApi,q=D.state().squads[0];D.setGold(99999);A.deployReserve(q,650,300);H.assignHero('shingen',q);
      const s=A.members(q)[0],ratio=A.soldierStats(s).def/A.soldierStats(s,true).def;
      H.unassignHero('shingen');s.type='archer';const m=A.members(q)[1];m.type='medic';q.type='archer';
      H.assignHero('kanetsugu',q);const rate=A.soldierStats(s).rate/A.soldierStats(s,true).rate,medicRate=A.soldierStats(m).rate/A.soldierStats(m,true).rate;
      const t={id:1,x:650,y:220,type:'arrow',level:1,hp:220,spent:100};D.state().towers.push(t);H.assignHero('kanetsugu',t);
      return {ratio,rate,medicRate,range:A.soldierStats(s).range/A.soldierStats(s,true).range,medicRange:A.soldierStats(m).range/A.soldierStats(m,true).range};
    });
    check(Math.abs(r.ratio-1.3)<1e-9,'信玄は10人でも最大5人分');
    check(r.rate===1&&r.range===1,'混成部隊の弓兵に回復支援が漏れない');
    check(r.medicRate===1&&r.medicRange===1,'兼続の自然回復化後、混成部隊の衛生兵にも旧支援倍率が残らない');await context.close();
  }
  console.log(`結果: ${checks} 件成功 / 0 件失敗`);
} finally {await browser.close();await new Promise(r=>server.close(r));}
