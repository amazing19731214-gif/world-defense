import { installJobBookTestFixtures } from "./job-book-test-utils.mjs";
// 共通編成から対象1人の育成へ：実際の装備・転職・命名・引退と旧経路・保存・スマホを確認。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/`,S='worldDefense.soldiers.v1',W='worldDefense.warlords.v1';
let n=0;const errors=[];const check=(ok,label)=>{assert.ok(ok,label);n++;console.log('✓ '+label);};
async function setup(width=390,debug=true){
 const c=await browser.newContext({viewport:{width,height:width===375?560:844},isMobile:width<700,hasTouch:width<700});
 await c.addInitScript(({S,W})=>{requestAnimationFrame=()=>0;if(sessionStorage.getItem('seed'))return;sessionStorage.setItem('seed','1');
  const save={seq:80,squadSeq:8,heroId:1,squads:Array.from({length:8},(_,i)=>({id:i+1,type:'spearman',slot:i})),soldiers:Array.from({length:80},(_,i)=>({id:i+1,type:i===12?'gunner':'spearman',squadId:Math.floor(i/10)+1,level:i===11?5:120,xp:0,name:i===12?'雑賀孫市':i===10?'老兵':null,named:i===12?'magoichi':null,skills:[],learned:[]})),fallen:[]};
  localStorage.setItem(S,JSON.stringify(save));localStorage.setItem(W,JSON.stringify({owned:{nobunaga:2},tickets:7,forge:{seq:1,items:[{uid:1,id:'nanbando',owner:null,lock:false}],shards:0,books:{},koban:800}}));
 },{S,W});
 await installJobBookTestFixtures(c);
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+(debug?'?debug':''));if(debug)await p.waitForFunction(()=>window.WD_DEBUG);return{p,c};
}
const open=async(p,id)=>{if(!await p.locator('#squadSheet').isVisible())await p.locator('#organize').click();await p.locator(`[data-formation-soldier="${id}"]`).click();};
try{
 {
  const{p,c}=await setup();await p.locator('#organize').click();check(await p.locator('[data-formation-soldier]').count()===80&&await p.locator('[data-move]').count()===80,'全80兵士へ詳細・育成を追加し移籍を残す');
  await p.locator('[data-formation-soldier="11"]').scrollIntoViewIfNeeded();const scroll=await p.locator('#squadSheet .sheet').evaluate(e=>e.scrollTop);
  await p.locator('[data-formation-soldier="11"]').click();check(await p.locator('#squadSheet').isHidden()&&await p.locator('#soldierSheet').isVisible()&&await p.locator('#soldierList .s-card').count()===1&&/老兵/.test(await p.locator('#soldierList').innerText()),'編成で選んだ兵士1人の既存詳細画面を表示');
  check(await p.locator('[data-name="11"]').isVisible()&&await p.locator('[data-gear-open="11"]').isVisible()&&await p.locator('[data-job-open="11"]').isVisible()&&await p.locator('[data-retire="11"]').isVisible(),'対象の命名・装備・転職・指導員ボタンを表示');
  p.once('dialog',d=>d.accept('編成で命名'));await p.locator('[data-name="11"]').click();check(await p.evaluate(()=>WD_DEBUG.state().soldiers.find(s=>s.id===11).name==='編成で命名'),'編成の育成画面から実際に名前を変更');
  await p.locator('[data-gear-open="11"]').click();await p.locator('[data-gear-on="1"]').click();check(await p.evaluate(()=>WD_DEBUG.forgeApi.save().items[0].owner===11),'編成で選んだ兵士へ防具を装着');
  await p.keyboard.press('Escape');check(await p.locator('#gearSheet').isHidden()&&await p.locator('#soldierSheet').isVisible()&&/南蛮胴/.test(await p.locator('#soldierList').innerText()),'装備を閉じると更新済みの対象詳細へ戻る');
  await p.evaluate(() => seedJobEntry(WD_DEBUG.state().soldiers.find(s => s.id === 11), ["samurai"]));
  await p.locator('[data-job-open="11"]').click();await p.locator('[data-job-to="samurai"]').click();await p.locator('#jobClose').click();check(await p.evaluate(()=>WD_DEBUG.state().soldiers.find(s=>s.id===11).job==='samurai')&&/侍/.test(await p.locator('#soldierList').innerText()),'転職を実行し詳細へ反映');
  await p.locator('#soldierClose').click();check(await p.locator('#squadSheet').isVisible()&&/編成で命名/.test(await p.locator('#squadList').innerText())&&Math.abs(await p.locator('#squadSheet .sheet').evaluate(e=>e.scrollTop)-scroll)<5,'編成へ戻り名前・職業・元のスクロール位置を維持');
  await p.locator('#squadClose').click();await p.reload();check(await p.evaluate(()=>{const s=WD_DEBUG.state().soldiers.find(s=>s.id===11);return s.name==='編成で命名'&&s.job==='samurai'&&WD_DEBUG.forgeApi.save().items[0].owner===11&&WD_DEBUG.heroApi.save().tickets===7;}),'再読込でも命名・転職・装備・通貨を保持');
  await open(p,12);check(await p.locator('[data-name]').count()===0&&await p.locator('.retire-locked').isDisabled(),'Lv5の命名・指導員条件を維持');await p.keyboard.press('Escape');check(await p.locator('#squadSheet').isVisible()&&await p.locator('#soldierSheet').isHidden(),'Escapeは詳細だけを閉じ編成を残す');
  await open(p,13);check(await p.locator('[data-name]').count()===0&&/ネームド兵士/.test(await p.locator('#soldierList').innerText()),'ネームド兵士は名前変更できない');await p.locator('#soldierClose').click();
  await open(p,1);check(await p.locator('[data-retire], .retire-locked').count()===0,'主人公を指導員として引退させない');await p.locator('#soldierClose').click();
  await open(p,11);await p.locator('[data-retire="11"]').click();await p.locator('[data-retire-pick="0"]').click();check(/戻せません/.test(await p.locator('#retireBody').innerText()),'引退は既存の確認と継承選択を必須にする');await p.locator('#retireClose').click();check(await p.locator('#soldierSheet').isVisible()&&await p.evaluate(()=>WD_DEBUG.state().soldiers.some(s=>s.id===11)),'引退画面を閉じるだけなら兵士を残す');
  await p.locator('[data-retire="11"]').click();await p.locator('[data-retire-pick="0"]').click();await p.locator('[data-retire-go]').click();check(await p.locator('#squadSheet').isVisible()&&await p.locator('#soldierSheet').isHidden()&&await p.locator('[data-formation-soldier="11"]').count()===0,'引退完了後は最新の編成へ戻り対象を除外');
  check(await p.evaluate(()=>WD_DEBUG.forgeApi.save().items[0].owner===null&&WD_DEBUG.forgeApi.save().mentors.length===1),'引退時の装備返却と指導員の記録を維持');
  await p.locator('#squadClose').click();await p.locator('#infoOpen').click();await p.locator('#soldiers').click();check(await p.locator('#soldierList .s-card').count()===79&&await p.locator('#soldierSheet .tabs').isVisible()&&/兵士名簿/.test(await p.locator('#soldierTitle').innerText()),'情報から開く通常の全兵士名簿を維持');await c.close();
 }
 {
  const{p,c}=await setup();await p.locator('#mapOpen').click();await p.locator('[data-map-formation]').click();await p.locator('#formationSoldiers').click();await open(p,2);await p.locator('#soldierClose').click();check(/世界/.test(await p.locator('#squadClose').innerText()),'育成後も編成の世界への戻り先を維持');await p.locator('#squadClose').click();check(await p.locator('#mapSheet').isVisible(),'世界から編成・育成を経由して世界へ戻れる');await c.close();
 }
 {
  const{p,c}=await setup();await p.locator('#start').click();await p.evaluate(()=>WD_DEBUG.stopSpawning());await open(p,11);await p.locator('[data-job-open="11"]').click();check(await p.locator('[data-job-to="samurai"]').isDisabled()&&/戦闘中/.test(await p.locator('#jobBody').innerText()),'戦闘中の転職制限を新しい入口でも維持');await c.close();
 }
 for(const width of [375,390,430,1280]){
  const{p,c}=await setup(width,false);await open(p,80);await p.locator('[data-gear-open="80"]').scrollIntoViewIfNeeded();const r=await p.evaluate(()=>{const sh=document.querySelector('#soldierSheet .sheet'),r=sh.getBoundingClientRect(),b=document.querySelector('#soldierClose').getBoundingClientRect();return{fit:r.top>=0&&r.bottom<=innerHeight+.5,close:b.top>=0&&b.bottom<=innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,actions:[...document.querySelectorAll('#soldierList .card-actions button')].every(b=>b.getBoundingClientRect().height>=44)};});check(r.fit&&r.close&&!r.overflow&&r.actions,width+'px通常URL：80人目を開いても育成操作・戻るボタンが使える');if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:process.env.SCREENSHOTS+'/formation-growth-'+width+'.png',fullPage:true});}await c.close();
 }
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log(`結果: ${n} 件成功 / 0 件失敗`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
