// 商店の裏ボスの呼び札：購入・使用・予約・乱入・報酬・保存障害・モード制限・画面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/`,W='worldDefense.warlords.v1',S='worldDefense.soldiers.v1',TX='worldDefense.bookTransaction.v1';
const errors=[];let n=0;
const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('✓ '+label);};
async function setup({count,width=390,debug=true,goal=100}={}){
 const c=await browser.newContext({viewport:{width,height:width<700?844:900},isMobile:width<700,hasTouch:width<700});
 await c.addInitScript(({count,goal,W,S})=>{
  requestAnimationFrame=()=>0;if(sessionStorage.getItem('seed'))return;sessionStorage.setItem('seed','1');
  localStorage.setItem(W,JSON.stringify({owned:{},tickets:2,forge:{bossLures:count,koban:50000,items:[],seq:0}}));
  localStorage.setItem('worldDefense.settings.v1',JSON.stringify({auto:false,waveGoal:goal}));
  localStorage.setItem(S,JSON.stringify({seq:1,squadSeq:1,squads:[{id:1,type:'spearman',slot:0}],soldiers:[{id:1,type:'spearman',squadId:1,level:30}],fallen:[]}));
 },{count,goal,W,S});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+(debug?'?debug':''));return{p,c};
}
const snapshot=p=>p.evaluate(()=>({gold:WD_DEBUG.state().gold,count:WD_DEBUG.intruderApi.bossLureCount(),pending:WD_DEBUG.intruderApi.pending(),wave:WD_DEBUG.state().wave,koban:WD_DEBUG.forgeApi.koban()}));
const finish=p=>p.evaluate(()=>{WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;WD_DEBUG.step(.1);});
const reload=p=>p.reload();
const openShop=async p=>{await p.locator('#gearOpen').click();await p.locator('[data-gear-tab="shop"]').click();};
async function fault(p,key){await p.evaluate(key=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw Error('injected');return window.realSet.call(this,k,v);};},key);}
async function spawn(p){return p.evaluate(()=>{const D=WD_DEBUG;for(let i=0;i<800&&!D.state().enemies.some(e=>e.intruder);i++){D.step(.1);const a=D.state().enemies;for(let j=a.length-1;j>=0;j--)if(!a[j].intruder)a.splice(j,1);}return D.state().enemies.filter(e=>e.intruder).length;});}
try{
 {
  const{p,c}=await setup();check((await snapshot(p)).count===0,'旧セーブは呼び札0枚で互換性を維持');
  let r=await p.evaluate(()=>({buy:WD_DEBUG.intruderApi.buyBossLure(),use:WD_DEBUG.intruderApi.useBossLure(),gold:WD_DEBUG.state().gold}));check(/軍資金/.test(r.buy)&&/持っていません/.test(r.use)&&r.gold===500,'小判があっても軍資金不足では購入不可・未所持では使用不可');
  await p.evaluate(()=>WD_DEBUG.setGold(29999));check(!!await p.evaluate(()=>WD_DEBUG.intruderApi.buyBossLure())&&(await snapshot(p)).count===0,'29,999Gでは購入不可');
  await p.evaluate(()=>WD_DEBUG.setGold(60000));await openShop(p);await p.locator('[data-boss-lure-buy]').click();await p.locator('[data-boss-lure-buy]').click();r=await snapshot(p);
  check(r.gold===0&&r.count===2&&r.pending===null&&r.koban===50000,'実際の購入ボタンで1枚30,000G・小判を使わず・購入だけでは予約しない');
  await reload(p);r=await snapshot(p);check(r.gold===0&&r.count===2,'購入直後の再読込で軍資金と所持数を復元');
  await p.evaluate(()=>document.getElementById('start').click());check(await p.evaluate(()=>WD_DEBUG.intruderApi.plan()===null),'購入のみでは次WAVEに強制乱入しない');await finish(p);
  await openShop(p);p.once('dialog',d=>d.dismiss());await p.locator('[data-boss-lure-use]').click();check((await snapshot(p)).count===2&&(await snapshot(p)).pending===null,'使用確認を取り消すと消費も予約もしない');
  const useGold=(await snapshot(p)).gold;p.once('dialog',d=>d.accept());await p.locator('[data-boss-lure-use]').click();r=await snapshot(p);check(r.count===1&&r.pending===2&&r.gold===useGold,'使用ボタンで1枚だけ消費し次WAVEを予約：'+JSON.stringify(r));
  check(await p.locator('[data-boss-lure-use]').isDisabled()&&/WAVE 2/.test(await p.locator('[data-lure-status]').innerText()),'予約済み表示・追加使用ボタンを無効化');
  check(await p.evaluate(()=>!!WD_DEBUG.intruderApi.useBossLure()&&WD_DEBUG.intruderApi.bossLureCount()===1),'直接の重複使用も消費しない');
  await reload(p);r=await snapshot(p);check(r.count===1&&r.pending===2&&r.wave===1,'出現前の再読込で使用数と予約を保持');
  await p.evaluate(()=>WD_DEBUG.defenseApi.save());await reload(p);check((await snapshot(p)).pending===2,'途中保存を繰り返しても出現予約を保持');
  r=await p.evaluate(()=>{const D=WD_DEBUG,e=D.trainingApi.startTraining('advanced');document.getElementById('start').click();const no=D.intruderApi.plan()===null;const blocked=!!D.intruderApi.useBossLure()&&!!D.intruderApi.buyBossLure();D.trainingApi.endTraining('retreat');return{e,no,blocked,pending:D.intruderApi.pending(),wave:D.state().wave,count:D.intruderApi.bossLureCount()};});
  check(r.e===null&&r.no&&r.blocked&&r.pending===2&&r.wave===1&&r.count===1,'修練場では購入・使用・出現せず通常防衛の予約を温存');
  r=await p.evaluate(()=>{const D=WD_DEBUG,e=D.squadApi.startBattle('okazaki');const blocked=!!D.intruderApi.useBossLure()&&!!D.intruderApi.buyBossLure();D.squadApi.retreatBattle();return{e,blocked,pending:D.intruderApi.pending(),count:D.intruderApi.bossLureCount()};});
  check(r.e===null&&r.blocked&&r.pending===2&&r.count===1,'攻城戦でも購入・使用を拒否し予約を温存');
  await p.evaluate(()=>{WD_DEBUG.intruderApi.setRng(()=>1);document.getElementById('start').click();});
  check(await p.evaluate(()=>WD_DEBUG.intruderApi.plan()?.forced&&WD_DEBUG.intruderApi.plan().wave===2),'自然乱入の抽選が外れてもWAVE50未満で予約どおり乱入');
  check(await p.evaluate(()=>!!WD_DEBUG.intruderApi.buyBossLure()&&!!WD_DEBUG.intruderApi.useBossLure()),'戦闘中は購入・使用を拒否');
  check(await spawn(p)===1,'次のWAVEの途中に裏ボスが1体だけ出現');
  await reload(p);check((await snapshot(p)).pending===2&&(await snapshot(p)).count===1,'乱入中の再読込でも予約と消費を引き継ぐ');
  await p.evaluate(()=>document.getElementById('start').click());check(await spawn(p)===1,'再開した同じWAVEに追加消費なしで再出現');
  r=await p.evaluate(()=>{const D=WD_DEBUG,e=D.state().enemies.find(e=>e.intruder);D.rareApi.hit(e,1e12);D.step(.1);return{gems:D.intruderApi.gems(),mark:D.heroApi.save().defense.intruder};});
  check(Object.values(r.gems).reduce((a,b)=>a+b,0)===1&&r.mark===null,'倒すと八玉1個を獲得し出現予約を解除');
  await finish(p);await reload(p);check((await snapshot(p)).pending===null&&(await snapshot(p)).count===1,'討伐してクリア後は予約解除と残り札を保存');
  await p.evaluate(()=>document.getElementById('start').click());check(await p.evaluate(()=>WD_DEBUG.intruderApi.plan()===null),'札1枚の使用で次々のWAVEまで出現し続けない');await c.close();
 }
 for(const use of [false,true])for(const key of [TX,W,S]){
  const{p,c}=await setup({count:2});await p.evaluate(()=>{WD_DEBUG.setGold(60000);WD_DEBUG.defenseApi.save();});const before=await snapshot(p);await fault(p,key);
  const err=await p.evaluate(use=>use?WD_DEBUG.intruderApi.useBossLure():WD_DEBUG.intruderApi.buyBossLure(),use);let r=await snapshot(p);
  if(key===TX)check(!!err&&JSON.stringify(r)===JSON.stringify(before),'確定保存失敗時に'+(use?'使用・予約':'購入・G')+'を完全に取り消す');
  else check(err===null&&r.gold===before.gold-(use?0:30000)&&r.count===before.count+(use?-1:1)&&r.pending===(use?1:null),'転記失敗でも確定ログに'+(use?'使用予約':'購入')+'を保持：'+key);
  await p.evaluate(()=>Storage.prototype.setItem=window.realSet);await reload(p);check(JSON.stringify(await snapshot(p))===JSON.stringify(r),'保存障害後の再読込でも増殖・消失なし：'+(use?'使用':'購入')+'/'+key);await c.close();
 }
 for(const count of [999,-5,'oops']){const{p,c}=await setup({count});const r=await snapshot(p);check(r.count===(count===999?99:0),'不正な所持数を安全に読み込み：'+count);if(count===999){await p.evaluate(()=>WD_DEBUG.setGold(1e6));check(!!await p.evaluate(()=>WD_DEBUG.intruderApi.buyBossLure())&&(await snapshot(p)).gold===1e6,'所持上限99枚では課金しない');}await c.close();}
 {
  const{p,c}=await setup({count:2,goal:20});await p.evaluate(()=>{WD_DEBUG.setGold(60000);WD_DEBUG.intruderApi.useBossLure();});
  p.once('dialog',d=>d.accept());await p.evaluate(()=>document.getElementById('reset').click());let r=await snapshot(p);check(r.pending===null&&r.count===1,'最初からで予約だけ解除し未使用の札を保持');
  await p.evaluate(()=>{for(let i=0;i<20;i++){document.getElementById('start').click();WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;WD_DEBUG.step(.1);}WD_DEBUG.setGold(60000);});
  check(await p.evaluate(()=>WD_DEBUG.state().over&&!!WD_DEBUG.intruderApi.useBossLure()&&!!WD_DEBUG.intruderApi.buyBossLure()&&WD_DEBUG.intruderApi.bossLureCount()===1),'目標達成後に存在しない次WAVEを予約・消費しない');await c.close();
 }
 {
  const{p,c}=await setup({count:2,goal:1000});await p.evaluate(W=>{WD_DEBUG.defenseApi.save();const d=JSON.parse(localStorage.getItem(W));d.defense.wave=999;d.defense.gold=60000;localStorage.setItem(W,JSON.stringify(d));},W);await reload(p);
  const r=await p.evaluate(()=>{const D=WD_DEBUG,e=D.intruderApi.useBossLure();document.getElementById('start').click();return{e,plan:D.intruderApi.plan(),wave:D.state().wave,count:D.intruderApi.bossLureCount()};});
  check(r.e===null&&r.wave===1000&&r.plan?.forced&&r.count===1,'WAVE999で使うと最終WAVE1000にも出現予約できる');
  await finish(p);check(await p.evaluate(()=>WD_DEBUG.state().over&&!!WD_DEBUG.intruderApi.useBossLure()&&WD_DEBUG.intruderApi.bossLureCount()===1),'WAVE1000達成後はWAVE1001を予約しない');await c.close();
 }
 for(const width of [375,390,430,1280]){
  const{p,c}=await setup({count:1,width,debug:false});await openShop(p);
  check(await p.locator('#bossLureCard').isVisible()&&/30,000G/.test(await p.locator('#bossLureCard').innerText())&&await p.locator('[data-boss-lure-use]').isEnabled(),'通常URLで呼び札・価格・使用ボタンを表示：'+width);
  check(await p.evaluate(()=>{const c=document.getElementById('gearSheet'),card=document.getElementById('bossLureCard'),b=card.getBoundingClientRect();return c.scrollWidth<=c.clientWidth+1&&b.left>=0&&b.right<=innerWidth+1&&Array.from(card.querySelectorAll('button')).every(x=>{const r=x.getBoundingClientRect();return r.height>=44&&r.width>=44;});}),'スマホ・PCで横はみ出しなし・操作サイズを維持：'+width);
  if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:process.env.SCREENSHOTS+'/boss-lure-'+width+'.png'});}await c.close();
 }
 check(errors.length===0,'ブラウザのJavaScriptエラーなし：'+errors.join(';'));
 console.log(`\n${n} passed, 0 failed`);
}finally{await browser.close();server.close();}
