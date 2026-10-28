// コンパクトな編成表示と、2部隊の同数交代・永続保存・保存障害の取り消しを検証。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/`,S='worldDefense.soldiers.v1',W='worldDefense.warlords.v1',TX='worldDefense.bookTransaction.v1';
let n=0;const errors=[];const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('✓ '+label);};
async function setup(width=390,debug=true){
 const c=await browser.newContext({viewport:{width,height:width===375?560:844},isMobile:width<700,hasTouch:width<700});
 await c.addInitScript(({S,W})=>{requestAnimationFrame=()=>0;if(sessionStorage.getItem('seed'))return;sessionStorage.setItem('seed','1');
  const types=['spearman','archer','cavalry','medic','gunner','ashigaru','spearman','archer'];
  localStorage.setItem(S,JSON.stringify({seq:80,squadSeq:8,heroId:1,squads:types.map((type,i)=>({id:i+1,type,slot:i})),soldiers:Array.from({length:80},(_,i)=>({id:i+1,type:types[Math.floor(i/10)],squadId:Math.floor(i/10)+1,level:120+i,name:'兵'+(i+1),skills:[],learned:[]})),fallen:[]}));
  localStorage.setItem(W,JSON.stringify({owned:{nobunaga:2,yukimura:2},tickets:7,forge:{seq:1,items:[{uid:1,id:'nanbando',owner:1,lock:false}],shards:0,books:{},koban:800}}));
 },{S,W});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+(debug?'?debug':''));if(debug)await p.waitForFunction(()=>window.WD_DEBUG);return{p,c};
}
const choose=(p,i)=>p.locator(`[data-squad-filter="${i}"]`).click();
const state=p=>p.evaluate(()=>({positions:WD_DEBUG.state().soldiers.map(s=>[s.id,s.squadId]),counts:WD_DEBUG.state().squads.map(q=>WD_DEBUG.squadApi.roster(q).length),gear:WD_DEBUG.forgeApi.save().items[0].owner,tickets:WD_DEBUG.heroApi.save().tickets,gold:WD_DEBUG.state().gold}));
try{
 {
  const{p,c}=await setup();await p.locator('#organize').click();await choose(p,0);await p.locator('[data-bulk-swap-start]').click();check(await p.locator('#bulkSwapControls').isVisible()&&await p.locator('[data-bulk-swap-go]').isDisabled(),'交代モードは未選択では確定できない');
  await p.locator('[data-bulk-pick="1"]').click();await p.locator('[data-bulk-pick="2"]').click();await choose(p,1);await p.locator('[data-bulk-pick="11"]').click();check(await p.locator('[data-bulk-swap-go]').isDisabled(),'両部隊の人数が異なる間は確定できない');
  await p.locator('[data-bulk-pick="12"]').click();check(await p.locator('[data-bulk-swap-go]').isEnabled()&&/2人ずつ交代/.test(await p.locator('[data-bulk-swap-go]').innerText()),'タブを変えても選択を維持し同数で確定可能');
  await choose(p,2);check(await p.locator('[data-bulk-pick="21"]').isDisabled(),'3つ目の部隊は選択させない');await choose(p,1);await p.locator('[data-bulk-swap-go]').click();
  let r=await state(p);check(r.positions[0][1]===2&&r.positions[1][1]===2&&r.positions[10][1]===1&&r.positions[11][1]===1&&r.counts.every(n=>n===10),'満員10人同士でも選んだ2人ずつを交換');check(r.gear===1&&r.tickets===7&&r.gold===500,'装備の所有者・ガチャ券・軍資金を変更しない');
  await p.reload();check(JSON.stringify(await state(p))===JSON.stringify(r),'交代直後の再読込でも所属・人数・装備を保持');
  await p.locator('#organize').click();await choose(p,0);await p.locator('[data-bulk-swap-start]').click();await p.locator('[data-bulk-all="1"]').click();await choose(p,1);await p.locator('[data-bulk-all="2"]').click();const before=await state(p);await p.locator('[data-bulk-swap-go]').click();r=await state(p);check(r.positions.every(([id,q],i)=>before.positions[i][1]<=2?q===3-before.positions[i][1]:q===before.positions[i][1])&&r.counts.every(n=>n===10),'全員を選ぶと満員の2部隊を10人ずつ一括交代');
  await p.locator('[data-bulk-swap-start]').click();await p.locator('[data-bulk-all="2"]').click();await p.locator('[data-bulk-swap-cancel]').click();check(await p.locator('#bulkSwapControls').isHidden()&&JSON.stringify(await state(p))===JSON.stringify(r),'取消なら所属を変えず選択を解除');
  await p.locator('[data-bulk-swap-start]').click();await choose(p,'candidates');check(await p.locator('#bulkSwapControls').isHidden(),'指導員候補へ切り替えると交代モードを終了');await c.close();
 }
 {
  const{p,c}=await setup();const before=await state(p);const r=await p.evaluate(()=>[[1],[1,1,11,12],[1,11,21],[1,2,11],[1,999]].map(ids=>WD_DEBUG.squadApi.swapMany(ids)));check(r.every(r=>r.error&&r.swapped===0)&&JSON.stringify(await state(p))===JSON.stringify(before),'片側だけ・重複・3部隊・人数違い・不正IDは全件取り消し');
  const roles=await p.evaluate(()=>{const D=WD_DEBUG;D.heroApi.assignHero('yukimura',D.state().squads[0]);for(const s of D.state().soldiers)s.hp=D.squadApi.soldierStats(s).maxHp*.4;const before=D.state().soldiers.map(s=>({id:s.id,level:s.level,name:s.name}));const r=D.squadApi.swapMany([1,2,11,12]);return{r,hero:D.heroApi.heroOnSquad(D.state().squads[0])?.id,ratios:D.state().soldiers.filter(s=>[1,2].includes(s.squadId)).map(s=>s.hp/D.squadApi.soldierStats(s).maxHp),same:JSON.stringify(before)===JSON.stringify(D.state().soldiers.map(s=>({id:s.id,level:s.level,name:s.name})))};});
  check(roles.r.swapped===2&&roles.hero==='yukimura'&&roles.same&&roles.ratios.every(r=>Math.abs(r-.4)<1e-8),'武将は部隊に残し、兵士の育成・名前・HP割合を保持');await c.close();
 }
 for(const key of [TX,W,S]){
  const{p,c}=await setup();await p.evaluate(()=>WD_DEBUG.defenseApi.save());const before=await state(p);const result=await p.evaluate(key=>{const old=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw Error('injected failure');return old.call(this,k,v);};let r;try{r=WD_DEBUG.squadApi.swapMany([1,2,11,12]);}finally{Storage.prototype.setItem=old;}return r;},key);const after=await state(p);
  check(key===TX?!!result.error&&JSON.stringify(after)===JSON.stringify(before):result.swapped===2&&!result.error,'保存確定前は全取消・確定後の転記失敗は成功扱い：'+key);await p.reload();check(JSON.stringify(await state(p))===JSON.stringify(after),'障害後の再読込でも所属・装備・通貨が一致：'+key);await c.close();
 }
 for(const mode of ['wave','training']){
  const{p,c}=await setup();await p.evaluate(mode=>{if(mode==='training')WD_DEBUG.trainingApi.startTraining('beginner');else {document.getElementById('start').click();WD_DEBUG.stopSpawning();}},mode);const r=await p.evaluate(()=>WD_DEBUG.squadApi.swapMany([1,2,11,12]));check(!!r.error&&r.swapped===0,mode+'の途中はまとめて交代できない');await c.close();
 }
 for(const width of [375,390,430,1280]){
  const{p,c}=await setup(width,false);await p.locator('#organize').click();await choose(p,3);const r=await p.evaluate(()=>{const header=document.querySelector('#squadSheet .formation-head').getBoundingClientRect(),buttons=[...document.querySelectorAll('#formationTabs button,#squadRosterTabs button,#squadList .formation-soldier-actions button')].filter(b=>b.getClientRects().length);return{header:header.height,fit:document.documentElement.scrollWidth<=innerWidth,compact:buttons.every(b=>{const r=b.getBoundingClientRect();return r.height>=32&&r.height<=36&&r.width>=44&&b.scrollWidth<=b.clientWidth+1;}),main:document.getElementById('pace').getBoundingClientRect().height};});check(r.header<=200&&r.fit&&r.compact&&r.main>=44,width+'px通常URL：編成は32〜34px・見出し200px以下、本体ボタンは維持');if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:process.env.SCREENSHOTS+'/compact-formation-'+width+'.png',fullPage:true});}await c.close();
 }
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log(`結果: ${n} 件成功 / 0 件失敗`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
