// 統合した進行操作と有料の一括回復：実際のクリック、金額、確定ログの障害を確認。
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(new URL('../index.html',import.meta.url)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),url=`http://127.0.0.1:${server.address().port}/?debug`,W='worldDefense.warlords.v1',S='worldDefense.soldiers.v1',TX='worldDefense.bookTransaction.v1';
let n=0;const errors=[];function check(ok,name){assert.ok(ok,name);n++;console.log('✓ '+name);}
async function setup(width=390,height=844){
 const c=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700});await c.addInitScript(()=>window.requestAnimationFrame=()=>0);
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);
 await p.evaluate(({W,S})=>{localStorage.clear();localStorage.setItem(W,JSON.stringify({owned:{terumoto:1},tickets:0}));localStorage.setItem(S,JSON.stringify({seq:20,squadSeq:2,squads:[{id:1,type:'spearman',slot:0},{id:2,type:'archer',slot:1}],soldiers:Array.from({length:20},(_,i)=>({id:i+1,type:i<10?'spearman':'archer',squadId:i<10?1:2,level:10})),fallen:[]}));},{W,S});await p.reload();
 await p.evaluate(()=>{const D=WD_DEBUG;for(const s of D.state().soldiers)s.hp=D.squadApi.soldierStats(s).maxHp*.25;for(let i=0;i<4;i++){const t={id:100+i,type:['arrow','cannon','magic','ice'][i],level:1,x:250+i*120,y:210,spent:100,hp:20,cd:0};D.state().towers.push(t);}D.state().towers[3].destroyed=true;D.state().towers[3].hp=0;D.setGold(10000);D.defenseApi.save();});return{p,c};
}
try{
 {
  const{p,c}=await setup();check(await p.locator('#pace').count()===1&&await p.locator('#speed, #pause').count()===0,'速度と停止を1つのボタンへ統合');
  for(const mode of ['x2','paused','x1','x2','paused','x1']){await p.locator('#pace').click();check(await p.locator('#pace').getAttribute('data-mode')===mode,'1クリックで進行を切り替え：'+mode);}
  const before=await p.evaluate(()=>WD_DEBUG.state().speed);await p.locator('#infoOpen').click();await p.locator('#infoClose').click();check(await p.evaluate(()=>!WD_DEBUG.state().paused&&WD_DEBUG.state().speed)===before,'情報を閉じると統合ボタンの状態も復元');await c.close();
 }
 {
  const{p,c}=await setup();let r=await p.evaluate(()=>{const D=WD_DEBUG,P=D.recoveryApi.plan();const cost=D.state().squads.reduce((n,q)=>n+D.squadApi.healCost(q),0)+D.state().towers.reduce((n,t)=>n+D.squadApi.repairCost(t),0);return{cost,quote:P.total,services:P.services.length,gold:D.state().gold,hearts:D.state().hp};});
  check(r.quote===r.cost&&r.services===5,'費用は全部隊の治療と全壊していない塔の修理の合計');check((await p.locator('#recoverAll').innerText()).includes(r.cost.toLocaleString('ja-JP')),'クリック前に合計費用を表示');
  await p.locator('#recoverAll').click();let after=await p.evaluate(()=>{const D=WD_DEBUG;return{gold:D.state().gold,hearts:D.state().hp,units:D.state().soldiers.every(s=>s.hp===D.squadApi.soldierStats(s).maxHp),towers:D.state().towers.filter(t=>!t.destroyed).every(t=>t.hp===D.towerApi.towerMaxHp(t)),broken:D.state().towers[3].hp};});
  check(after.gold===r.gold-r.cost&&after.units&&after.towers,'1クリックで待機中を含む生存兵士と塔を全回復して支払う');check(after.hearts===r.hearts&&after.broken===0,'城のハートと全壊した塔は回復しない');check(await p.locator('#recoverAll').isDisabled(),'全員満タンならボタン無効・二重購入しない');
  await p.reload();after=await p.evaluate(()=>{const D=WD_DEBUG;return{gold:D.state().gold,units:D.state().soldiers.every(s=>s.hp===D.squadApi.soldierStats(s).maxHp),towers:D.state().towers.every(t=>t.hp===D.towerApi.towerMaxHp(t))};});check(after.gold===r.gold-r.cost&&after.units&&after.towers,'再読み込み後も支払いと回復結果が一致');await c.close();
 }
 {
  const{p,c}=await setup();const r=await p.evaluate(()=>{const D=WD_DEBUG;D.heroApi.heroState().terumoto.couponWave=D.state().wave;const A=D.recoveryApi.plan();const base=A.services.map(s=>s.kind==='heal'?D.squadApi.healCost(s.q,1):D.squadApi.repairCost(s.t,1));const discounted=A.services.filter((s,i)=>s.cost<base[i]).length;D.recoveryApi.recover();return{discounted,spent:10000-D.state().gold,total:A.total,coupon:D.heroApi.heroState().terumoto.couponWave};});check(r.discounted===1&&r.spent===r.total&&r.coupon===-1,'割引券は治療・修理の最大1件だけに適用して消費');await c.close();
 }
 for(const key of [TX,W,S]){
  const{p,c}=await setup();const r=await p.evaluate(key=>{const D=WD_DEBUG,old=Storage.prototype.setItem,before={g:D.state().gold,h:D.state().soldiers[0].hp,t:D.state().towers[0].hp};Storage.prototype.setItem=function(k,v){if(k===key)throw Error('injected failure');return old.call(this,k,v);};let error;try{error=D.recoveryApi.recover();}finally{Storage.prototype.setItem=old;}return{error,before,g:D.state().gold,h:D.state().soldiers[0].hp,t:D.state().towers[0].hp};},key);
  check(key===TX?!!r.error&&r.g===r.before.g&&r.h===r.before.h&&r.t===r.before.t:!r.error&&r.g<r.before.g,'保存の確定前・確定後を区別して一括回復：'+key);
  await p.reload();const after=await p.evaluate(()=>({g:WD_DEBUG.state().gold,h:WD_DEBUG.state().soldiers[0].hp,t:WD_DEBUG.state().towers[0].hp}));check(after.g===r.g&&Math.abs(after.h-r.h)<1e-7&&Math.abs(after.t-r.t)<1e-7,'保存障害後も支払いとHPが一致：'+key);await c.close();
 }
 {
  const{p,c}=await setup();let r=await p.evaluate(()=>{const D=WD_DEBUG;D.setGold(0);const before=D.state().soldiers[0].hp;return{error:D.recoveryApi.recover(),hp:D.state().soldiers[0].hp,before};});check(!!r.error&&r.hp===r.before&&await p.locator('#recoverAll').isDisabled(),'資金不足では部分回復・部分支払いをしない');
  await p.evaluate(()=>WD_DEBUG.setGold(10000));await p.locator('#start').click();await p.locator('#pace').click();await p.locator('#pace').click();check(await p.evaluate(()=>WD_DEBUG.state().paused)&&await p.locator('#recoverAll').isDisabled(),'戦闘を停止しても一括回復は使えない');await c.close();
 }
 {
  const{p,c}=await setup();const r=await p.evaluate(()=>{const D=WD_DEBUG,m=D.state().soldiers[0];m.alive=false;m.hp=0;D.defenseApi.save();const error=D.recoveryApi.recover();return{error,dead:m.hp===0&&!m.alive,alive:D.state().soldiers.filter(s=>s.alive).every(s=>s.hp===D.squadApi.soldierStats(s).maxHp)};});check(!r.error&&r.dead&&r.alive,'全回復でも戦死者を復活させない');await c.close();
 }
 {
  const{p,c}=await setup();await p.evaluate(W=>{const d=JSON.parse(localStorage.getItem(W));d.defense.hp=12;localStorage.setItem(W,JSON.stringify(d));},W);await p.reload();await p.locator('#recoverAll').click();check(await p.evaluate(()=>WD_DEBUG.state().hp===12),'兵士と塔の全回復で城のハートは増えない');await c.close();
 }
 {
  const{p,c}=await setup();const r=await p.evaluate(()=>{const D=WD_DEBUG;D.trainingApi.startTraining('beginner');return{inTraining:!!D.trainingApi.training(),error:D.recoveryApi.recover(),gold:D.state().gold};});check(r.inTraining&&!!r.error&&await p.locator('#recoverAll').isDisabled(),'修練場の仮の軍資金では一括回復を購入できない');await c.close();
 }
 {
  const{p,c}=await setup();const r=await p.evaluate(()=>{const D=WD_DEBUG;const error=D.squadApi.startBattle();if(error)throw Error(error);return{inBattle:!!D.squadApi.battle(),recovery:D.recoveryApi.recover()};});check(r.inBattle&&!!r.recovery&&await p.locator('#recoverAll').isDisabled(),'攻城戦では一括回復を購入できない');await c.close();
 }
 {
  const{p,c}=await setup();await p.locator('#start').click();await p.evaluate(()=>{const D=WD_DEBUG;D.stopSpawning();D.state().enemies.length=0;window.E=D.addEnemy({hp:1e9,speed:10,d:0,unitCd:1e9});});
  const a=await p.evaluate(()=>{WD_DEBUG.step(1);return E.d;});await p.locator('#pace').click();const b=await p.evaluate(()=>{const d=E.d;WD_DEBUG.step(1);return E.d-d;});await p.locator('#pace').click();const z=await p.evaluate(()=>{const d=E.d;WD_DEBUG.step(1);return E.d-d;});check(Math.abs(a-10)<1e-7&&Math.abs(b-20)<1e-7&&z===0,'統合ボタンで戦闘時間が×1・×2・停止に正しく切り替わる');await c.close();
 }
 for(const [w,h] of [[375,560],[390,844],[430,932],[1280,800]]){const{p,c}=await setup(w,h);let r=await p.evaluate(()=>{const b=[...document.querySelectorAll('.play-tools button')].map(x=>x.getBoundingClientRect());return{count:b.length,fit:b.every(x=>x.width>=44&&x.height>=44&&x.right<=innerWidth),row:b.every(x=>Math.abs(x.top-b[0].top)<1),over:document.documentElement.scrollWidth>innerWidth};});check(r.count===4&&r.fit&&r.row&&!r.over,w+'px：ウェーブ・進行・全回復・AUTOの4ボタンが同じ1行に収まる');if(process.env.SCREENSHOTS){mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.evaluate(()=>WD_DEBUG.heroApi.draw());await p.screenshot({path:process.env.SCREENSHOTS+'/pace-recovery-'+w+'.png',fullPage:true});}await c.close();}
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log('結果: '+n+' 件成功 / 0 件失敗');
}finally{await browser.close();await new Promise(r=>server.close(r));}
