// 情報メニューとコンパクトな配置表示の実際のブラウザ操作（戦闘計算は変更しない）。
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),base=`http://127.0.0.1:${server.address().port}/`;
let checks=0;const errors=[];
function check(ok,name){assert.ok(ok,name);checks++;console.log('✓ '+name);}
const click=async(p,s)=>{await p.locator(s).click();};
async function setup(width,height=844,seed=true){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(base+'?debug');await p.waitForFunction(()=>window.WD_DEBUG);
 if(seed){await p.evaluate(()=>{
  localStorage.clear();localStorage.setItem('worldDefense.warlords.v1',JSON.stringify({owned:{nobunaga:1,kanetsugu:1,yukimura:1},tickets:5}));
  localStorage.setItem('worldDefense.soldiers.v1',JSON.stringify({seq:40,squadSeq:4,squads:['spearman','gunner','ashigaru','medic'].map((type,i)=>({id:i+1,type,slot:i})),soldiers:Array.from({length:40},(_,i)=>({id:i+1,type:['spearman','gunner','ashigaru','medic'][Math.floor(i/10)],squadId:Math.floor(i/10)+1,level:10})),fallen:[]}));
 });await p.reload();await p.waitForFunction(()=>window.WD_DEBUG);await p.evaluate(()=>{const D=WD_DEBUG;for(const [i,type] of ['arrow','cannon','magic','ice','arrow'].entries())D.state().towers.push({id:100+i,type,level:1,x:280+i*100,y:220,spent:100,cd:0,hp:100});D.setGold(15550);});}
 return{p,context};
}
try{
 for(const [width,height] of [[375,560],[390,844],[430,932],[1280,800]]){
  const {p,context}=await setup(width,height);const tag=width+'×'+height;
  let r=await p.evaluate(()=>{const tower=document.getElementById('towerCount'),unit=document.getElementById('unitCount'),head=unit.closest('.unit-head');return{combined:head.contains(tower)&&unit.parentElement===tower.parentElement,counts:tower.textContent,oldRow:!!document.querySelector('.tower-status'),next:document.querySelector('.tower-tools').nextElementSibling.classList.contains('menu-tools'),hidden:['roster','soldiers','towerGrowthOpen'].every(id=>!document.getElementById(id).getClientRects().length),over:document.documentElement.scrollWidth>innerWidth,info:document.getElementById('infoOpen').getBoundingClientRect().height,top:head.getBoundingClientRect().height,label:unit.parentElement.getBoundingClientRect().height};});
  check(r.combined&&r.counts.includes('5/6')&&!r.oldRow&&r.next,tag+'：塔5/6を配置・保有欄へ統合し、塔育成の独立行を削除');
  check(r.hidden&&!r.over&&r.info>=44&&r.top>=r.label,tag+'：入口を情報へ集約し、横はみ出し・カウンターの重なりなし');
  const saved=await p.evaluate(()=>JSON.stringify(localStorage));
  await click(p,'#infoOpen');
  check(await p.locator('#infoSheet').isVisible()&&await p.evaluate(()=>WD_DEBUG.state().paused),tag+'：情報ボタンで開いて一時停止');
  check((await p.locator('#infoHeroSummary').innerText()).includes('3人')&&(await p.locator('#infoSoldierSummary').innerText()).includes('40人')&&(await p.locator('#infoTowerSummary').innerText()).includes('5/6'),tag+'：武将・兵士・塔の現在の育成概要を表示');
  for(const [entry,sheet,expect] of [['roster','heroSheet','[data-warlord-level]'],['soldiers','soldierSheet','.s-card'],['towerGrowthOpen','towerGrowthSheet','[data-growth]'],['skillGuideOpen','skillGuideSheet','[data-guide-hero]']]){
   await click(p,'#'+entry);
   check(await p.locator('#'+sheet).isVisible()&&await p.locator('#infoSheet').isHidden()&&(await p.locator('#'+sheet+' '+expect).count())>0,tag+'：情報から'+entry+'の詳細を確認');
   check(await p.evaluate(()=>WD_DEBUG.state().paused),tag+'：詳細を読んでいる間も停止');
   await click(p,'#'+sheet+' [data-info-back]');
   check(await p.locator('#infoSheet').isVisible()&&await p.evaluate(()=>WD_DEBUG.state().paused),tag+'：「情報へ戻る」で別カテゴリへ移動できる');
  }
  await p.keyboard.press('Shift+Tab');await p.keyboard.press('Tab');
  check(await p.evaluate(()=>document.getElementById('infoSheet').contains(document.activeElement)),tag+'：情報内にキーボードフォーカスを保持');
  await p.keyboard.press('Escape');
  check(await p.locator('#infoSheet').isHidden()&&await p.evaluate(()=>!WD_DEBUG.state().paused&&document.activeElement.id==='infoOpen'),tag+'：Escapeでゲームの停止状態とフォーカスを復元');
  check(await p.evaluate(()=>JSON.stringify(localStorage))===saved,tag+'：情報の閲覧でセーブ内容を変更しない');
  if(process.env.SCREENSHOTS){mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:process.env.SCREENSHOTS+'/compact-'+width+'.png',fullPage:true});await click(p,'#infoOpen');await p.screenshot({path:process.env.SCREENSHOTS+'/info-'+width+'.png'});await click(p,'#infoClose');}
  await context.close();
 }
 {
  const{p,context}=await setup(390);await click(p,'#speed');await click(p,'#start');await p.waitForTimeout(200);await click(p,'#infoOpen');
  const before=await p.evaluate(()=>{const s=WD_DEBUG.state();return JSON.stringify({hp:s.hp,gold:s.gold,wave:s.wave,enemies:s.enemies.map(e=>({hp:e.hp,d:e.d})),speed:s.speed});});
  await p.evaluate(()=>WD_DEBUG.step(3));const after=await p.evaluate(()=>{const s=WD_DEBUG.state();return JSON.stringify({hp:s.hp,gold:s.gold,wave:s.wave,enemies:s.enemies.map(e=>({hp:e.hp,d:e.d})),speed:s.speed});});
  check(before===after,'情報閲覧中は戦闘時間・敵・HP・ゴールド・速度が変化しない');
  await click(p,'#towerGrowthOpen');await click(p,'#towerGrowthClose');
  check(await p.evaluate(()=>!WD_DEBUG.state().paused&&WD_DEBUG.state().speed===2&&document.activeElement.id==='infoOpen')&&await p.locator('#infoSheet').isHidden(),'詳細の閉じるボタンはゲームへ戻り、倍速を維持して再開');
  await click(p,'#pause');await click(p,'#infoOpen');await click(p,'#infoClose');check(await p.evaluate(()=>WD_DEBUG.state().paused),'元から停止中なら情報を閉じても停止を維持');await context.close();
 }
 {
  const{p,context}=await setup(390,844,false);await click(p,'#infoOpen');check((await p.locator('#infoHeroSummary').innerText()).includes('0人')&&(await p.locator('#infoSoldierSummary').innerText()).includes('0人'),'未所持・兵士なしでも情報を表示');await click(p,'#infoClose');await p.goto(base);await click(p,'#infoOpen');await click(p,'#towerGrowthOpen');check(await p.locator('[data-growth]').count()===4&&!await p.evaluate(()=>!!window.WD_DEBUG),'通常URLでも情報メニューと塔育成を操作できる');await context.close();
 }
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log('結果: '+checks+' 件成功 / 0 件失敗');
}finally{await browser.close();await new Promise(r=>server.close(r));}
