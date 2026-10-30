// 共通編成の実操作と、世界からの直接出陣・取消・旧セーブ・スマホ/PCを検証。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/`,W='worldDefense.warlords.v1',S='worldDefense.soldiers.v1',F='worldDefense.siege.v1';
let count=0;const errors=[];
const check=(ok,label)=>{assert.ok(ok,label);count++;console.log('✓ '+label);};
async function setup(width=390,seed=true,debug=true){
 const c=await browser.newContext({viewport:{width,height:width===375?560:844},isMobile:width<700,hasTouch:width<700});
 await c.addInitScript(({seed,W,S,F})=>{
  window.requestAnimationFrame=()=>0;
  if(location.protocol==='http:'&&!localStorage.getItem('worldDefense.ui.v1'))localStorage.setItem('worldDefense.ui.v1','{"all":true}');
  if(!seed||sessionStorage.getItem('seed'))return;sessionStorage.setItem('seed','1');
  localStorage.setItem(W,JSON.stringify({owned:{nobunaga:2,yukimura:1,kenshin:1},tickets:3,injured:{kenshin:2}}));
  localStorage.setItem(S,JSON.stringify({seq:8,squadSeq:8,squads:Array.from({length:8},(_,i)=>({id:i+1,type:'spearman',slot:i})),soldiers:Array.from({length:8},(_,i)=>({id:i+1,type:'spearman',squadId:i+1,level:30,name:'旧兵'+i})),fallen:[]}));
  localStorage.setItem(F,JSON.stringify({version:1,units:[{hero:'yukimura'}]}));
 },{seed,W,S,F});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+(debug?'?debug':'?layout=classic'));
 if(debug)await p.waitForFunction(()=>window.WD_DEBUG);return{c,p};
}
const openJapan=async p=>{await p.locator('#mapOpen').click();await p.locator('[data-map-chapter="japan"]').click();await p.locator('[data-map-tab="open"]').click();};
try{
 {
  const{p,c}=await setup();const before=await p.evaluate(()=>JSON.stringify(WD_DEBUG.squadApi.siege()));
  check(await p.locator('main #siege').count()===0,'メイン画面の攻城編成ボタンを削除');
  await p.locator('#organize').click();check(await p.locator('#squadSheet').isVisible()&&await p.locator('#formationSoldierPanel').isVisible(),'編成の入口は共通で兵士・部隊を表示');
  await p.locator('#siege').click();check(await p.locator('#siegeSheet').isVisible()&&await p.locator('#formationSoldierPanel').isHidden()&&await p.locator('.sheet-back:not([hidden])').count()===1,'攻城用武将も同じダイアログ内のタブ');
  check(await p.locator('#siegeTabs button').count()===8&&await p.evaluate(b=>JSON.stringify(WD_DEBUG.squadApi.siege())===b,before),'旧8部隊と武将配属を閲覧だけでは変更しない');
  await p.locator('[data-hero-pick]').click();check(await p.locator('#siegePick button:has-text("負傷中")').isDisabled(),'負傷武将の配属制限を維持');
  await p.locator('[data-hero="nobunaga"]').click();check(await p.evaluate(()=>WD_DEBUG.squadApi.siege()[0].hero==='nobunaga'),'共通編成から攻城用武将を配属');
  await p.locator('[data-unit="7"]').click();await p.locator('[data-hero-pick]').click();await p.locator('[data-hero-move="nobunaga"]').click();check(await p.evaluate(()=>WD_DEBUG.squadApi.siege()[7].hero==='nobunaga'&&WD_DEBUG.squadApi.siege()[0].hero===null),'第八部隊への武将移動と重複禁止');
  await p.locator('#formationSoldiers').click();check(await p.locator('#formationSoldierPanel').isVisible()&&await p.locator('[data-move]').count()===8,'兵士の編成へ戻って移籍操作を維持');
  await p.locator('#formationSoldiers').focus();await p.keyboard.press('ArrowRight');check(await p.locator('#siege').getAttribute('aria-selected')==='true','キーボードでも編成タブを切替');
  await p.keyboard.press('Escape');check(await p.locator('#squadSheet').isHidden(),'Escapeで共通編成を閉じる');
  await p.reload();check(await p.evaluate(()=>WD_DEBUG.squadApi.siege()[7].hero==='nobunaga'&&WD_DEBUG.state().soldiers.length===8&&WD_DEBUG.heroApi.save().tickets===3),'再読込でも武将配属・旧兵士・通貨を保持');
  await openJapan(p);await p.locator('[data-map-prov="owari"]').click();await p.locator('[data-map-formation]').click();check(await p.locator('#siegeSheet').isVisible()&&await p.locator('#mapSheet').isHidden()&&/世界/.test(await p.locator('#squadClose').innerText()),'世界から同じ編成へ移動し戻り先を案内');
  await p.locator('#squadClose').click();check(await p.locator('[data-map-go="kiyosu"]').isVisible()&&await p.locator('#squadSheet').isHidden(),'世界へ戻っても章・国詳細を維持');
  let dialog='';p.once('dialog',async d=>{dialog=d.message();await d.dismiss();});await p.locator('[data-map-go="kiyosu"]').click();check(/清洲城/.test(dialog)&&/第八部隊 1人（織田信長）/.test(dialog)&&/永久戦死/.test(dialog),'世界からの確認に城名・部隊・武将・永久戦死を表示');
  check(await p.evaluate(()=>!WD_DEBUG.squadApi.battle()&&WD_DEBUG.state().soldiers.length===8)&&await p.locator('#mapSheet').isVisible(),'出陣取消で戦闘を始めず世界画面を維持');
  await p.evaluate(()=>WD_DEBUG.playbackApi.setMode('paused'));
  p.once('dialog',d=>d.accept());await p.locator('[data-map-go="kiyosu"]').click();check(await p.evaluate(()=>WD_DEBUG.squadApi.battle()?.castleId==='kiyosu'&&WD_DEBUG.squadApi.battle().groups.length===8&&!WD_DEBUG.state().paused)&&await p.locator('#squadSheet').isHidden()&&await p.locator('#mapSheet').isHidden(),'世界の出陣確認だけで実際に8部隊の攻城戦を開始・進行再開');await c.close();
 }
 {
  const{p,c}=await setup(390,false);await openJapan(p);await p.locator('[data-map-prov="owari"]').click();let dialogs=0;p.on('dialog',d=>{dialogs++;d.accept();});await p.locator('[data-map-go="kiyosu"]').click();check(dialogs===0&&await p.locator('#mapSheet').isVisible()&&/出撃できる兵士がいません/.test(await p.locator('#mapBody').innerText())&&await p.evaluate(()=>!WD_DEBUG.squadApi.battle()),'兵士なしでは出陣させず世界画面に解決方法を表示');await c.close();
 }
 {
  const{p,c}=await setup();await p.locator('#mapOpen').click();await p.locator('[data-map-chapter="japan"]').click();await p.locator('[data-map-tab="secret"]').click();p.once('dialog',d=>d.accept());await p.locator('[data-boss-go="orochi"]').click();check(await p.evaluate(()=>WD_DEBUG.squadApi.battle()?.boss==='orochi')&&await p.locator('#mapSheet').isHidden(),'秘境も世界から直接討伐を開始');await c.close();
 }
 for(const mode of ['wave','training']){
  const{p,c}=await setup();await p.evaluate(mode=>{if(mode==='training')WD_DEBUG.trainingApi.startTraining('beginner');else {document.getElementById('start').click();WD_DEBUG.stopSpawning();}},mode);
  await openJapan(p);await p.locator('[data-map-prov="owari"]').click();let dialogs=0;p.on('dialog',d=>{dialogs++;d.accept();});await p.locator('[data-map-go="kiyosu"]').click();
  check(dialogs===0&&await p.locator('#mapSheet').isVisible()&&await p.evaluate(()=>!WD_DEBUG.squadApi.battle())&&/修練場|ウェーブ中/.test(await p.locator('#mapBody').innerText()),mode+': 別モードの途中は世界から出陣させない');await c.close();
 }
 for(const width of [375,390,430,1280]){
  const{p,c}=await setup(width,true,false);await p.locator('#organize').click();await p.locator('#siege').click();await p.locator('[data-unit="7"]').click();await p.locator('[data-hero-pick]').click();const layout=await p.evaluate(()=>{const sh=document.querySelector('#squadSheet .sheet'),r=sh.getBoundingClientRect(),close=document.querySelector('#squadClose').getBoundingClientRect();return{inside:r.top>=0&&r.bottom<=innerHeight+.5,overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('#formationTabs button,#siegeTabs button')].every(b=>b.getBoundingClientRect().height>=32&&b.getBoundingClientRect().width>=44),close:close.top>=0&&close.bottom<=innerHeight,dialogs:document.querySelectorAll('.sheet-back:not([hidden])').length};});
  check(layout.inside&&!layout.overflow&&layout.buttons&&layout.close&&layout.dialogs===1,width+'px通常URL：タブ・第八部隊・武将選択が画面内に収まる');
  if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:process.env.SCREENSHOTS+'/formation-'+width+'.png',fullPage:true});}await c.close();
 }
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log(`結果: ${count} 件成功 / 0 件失敗`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
