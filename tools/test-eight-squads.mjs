// 8部隊・ランダム1人雇用の統合検証。旧セーブ、実際の配置、課金と保存、型選択廃止を確認。
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(new URL('../index.html',import.meta.url)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),url=`http://127.0.0.1:${server.address().port}/?debug`,W='worldDefense.warlords.v1',S='worldDefense.soldiers.v1',TX='worldDefense.bookTransaction.v1';
let checks=0;const errors=[];function check(ok,name){assert.ok(ok,name);checks++;console.log('✓ '+name);}
async function setup(width=390,height=844){const c=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700});await c.addInitScript(()=>window.requestAnimationFrame=()=>0);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);await p.waitForFunction(()=>window.WD_DEBUG);return{p,c};}
async function fill(p,n=80){return p.evaluate(n=>{const D=WD_DEBUG;D.setGold(10000);let call=0;D.recruitApi.setRng(()=>{const i=call++;return i%2===0?((i/2)%6+.5)/6:.999999;});let last;for(let i=0;i<n;i++){last=D.recruitApi.recruit();if(last.error)throw Error(last.error);}return{gold:D.state().gold,squads:D.state().squads.map(q=>({id:q.id,slot:q.slot,type:q.type,n:D.squadApi.roster(q).length})),soldiers:D.state().soldiers.map(s=>({id:s.id,level:s.level,type:s.type}))};},n);}
const points=[[260,165],[340,165],[420,165],[510,239],[260,440],[340,440],[420,440],[510,364]];
try{
 {
  const{p,c}=await setup();check(await p.locator('[data-u], [data-recruit-type]').count()===0,'兵種を選択する雇用・補充ボタンは表示しない');
  await p.locator('#hireToggle').click();let r=await p.evaluate(()=>({count:WD_DEBUG.state().soldiers.length,gold:WD_DEBUG.state().gold,price:WD_DEBUG.recruitApi.cost(),state:WD_DEBUG.state().squads[0].state}));check(r.count===1&&r.gold===500-r.price&&r.state==='reserve','雇う1クリックでランダムな兵士1人を自動配属して支払う');
  await p.reload();check(await p.evaluate(()=>WD_DEBUG.state().soldiers.length===1&&WD_DEBUG.state().gold===476),'初回購入直後に再読み込みしても兵士とGが一致');
  await p.locator('[data-chip]').click();check(await p.locator('[data-recruit-chip]').count()===0&&await p.locator('#sqRecruit').count()===0,'部隊パネルにも兵種や配属先を指定する雇用操作を残さない');await c.close();
 }
 {
  const{p,c}=await setup();const r=await fill(p);check(r.squads.length===8&&r.squads.every(q=>q.n===10)&&new Set(r.soldiers.map(s=>s.id)).size===80,'8部隊×10人まで重複なく自動配属できる');check(new Set(r.soldiers.map(s=>s.type)).size===6,'有効な6兵種がランダム抽選の対象');
  check(r.gold===10000-80*24,'80回の雇用で80人分だけ課金');check(await p.locator('#hireToggle').isDisabled(),'全8部隊が満員なら雇用を無効化');
  check(await p.evaluate(()=>{const D=WD_DEBUG,g=D.state().gold,n=D.state().soldiers.length;const r=D.recruitApi.recruit();return!!r.error&&D.state().gold===g&&D.state().soldiers.length===n;}),'満員時に9部隊目や追加課金を作らない');
  const positions=await p.evaluate(points=>{const D=WD_DEBUG;const results=D.state().squads.map((q,i)=>D.squadApi.deployReserve(q,...points[i]));D.setGold(D.state().gold);return results;},points);check(positions.every(Boolean),'実際の道路上へ8部隊すべてを配置できる');check((await p.locator('#unitCount').innerText()).includes('配置 8/8｜保有 8/8'),'配置・保有の上限を8と表示');
  await p.evaluate(()=>WD_DEBUG.defenseApi.save());await p.reload();check(await p.evaluate(()=>WD_DEBUG.state().squads.filter(q=>q.state==='deployed').length===8&&WD_DEBUG.state().soldiers.length===80),'8部隊の配置と兵士80人を途中保存から復元');
  await p.locator('#organize').click();check(!(await p.locator('#squadSheet').innerText()).includes('混成')&&await p.locator('[data-recruit-type]').count()===0,'編成画面に混成表記と兵種選択を残さない');await p.locator('#squadClose').click();
  await p.evaluate(()=>WD_DEBUG.squadApi.startBattle());let b=await p.evaluate(()=>{const b=WD_DEBUG.squadApi.battle();return b&&{n:b.groups.length,names:b.groups.map(g=>g.name),all:b.groups.every(g=>g.list.length===10)};});check(b?.n===8&&b.all&&b.names[7]==='第八部隊','攻城戦も第一〜第八部隊の80人を編成する');
  check(await p.evaluate(()=>!!WD_DEBUG.recruitApi.recruit().error),'攻城戦中は雇用しない');
  b=await p.evaluate(()=>{WD_DEBUG.playbackApi.setMode("x1");WD_DEBUG.squadApi.battle().castleHp=1e9;WD_DEBUG.step(71);const b=WD_DEBUG.squadApi.battle();return {launched:b.nextUnit,states:b.groups.map(g=>g.state),finite:b.groups.every(g=>Number.isFinite(g.x)&&Number.isFinite(g.y))};});
  check(b.launched===8&&b.finite&&b.states.every(s=>s!=='wait'&&s!=='empty'),'8部隊すべてが実際に進軍・戦闘処理へ入る');await c.close();
 }
 {
  const{p,c}=await setup();await p.evaluate(({W,S})=>{localStorage.clear();localStorage.setItem(W,JSON.stringify({owned:{nobunaga:2},warlordProgress:{nobunaga:123},towerResearch:{arrow:35},tickets:7}));localStorage.setItem(S,JSON.stringify({seq:40,squadSeq:4,squads:[0,1,2,3].map(i=>({id:i+1,type:'spearman',slot:i})),soldiers:Array.from({length:40},(_,i)=>({id:i+1,type:'spearman',squadId:Math.floor(i/10)+1,level:30,xp:10,name:i===0?'旧兵':null})),fallen:[]}));},{W,S});await p.reload();const before=await p.evaluate(()=>WD_DEBUG.state().soldiers.map(s=>({id:s.id,level:s.level,xp:s.xp,name:s.name})));await p.evaluate(()=>{WD_DEBUG.setGold(1000);WD_DEBUG.recruitApi.setRng(()=>.999);WD_DEBUG.recruitApi.recruit();});const after=await p.evaluate(()=>WD_DEBUG.state().soldiers.slice(0,40).map(s=>({id:s.id,level:s.level,xp:s.xp,name:s.name})));check(JSON.stringify(before)===JSON.stringify(after),'旧4部隊の兵士・名前・Lv・EXPを変更しない');check(await p.evaluate(()=>WD_DEBUG.state().squads.length===5&&WD_DEBUG.heroApi.save().tickets===7&&WD_DEBUG.heroApi.save().warlordProgress.nobunaga===123),'旧セーブから第五部隊を追加して武将・塔・通貨を保持');await c.close();
 }
 for(const key of [TX,W,S]){
  const{p,c}=await setup();await p.evaluate(()=>WD_DEBUG.defenseApi.save());const r=await p.evaluate(key=>{const D=WD_DEBUG,old=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw Error('injected failure');return old.call(this,k,v);};let result;try{result=D.recruitApi.recruit();}finally{Storage.prototype.setItem=old;}return{error:!!result.error,n:D.state().soldiers.length,q:D.state().squads.length,g:D.state().gold};},key);check(key===TX?r.error&&r.n===0&&r.q===0&&r.g===500:!r.error&&r.n===1&&r.g===476,'保存確定前と確定後の障害を区別：'+key);await p.reload();check(await p.evaluate(r=>WD_DEBUG.state().soldiers.length===r.n&&WD_DEBUG.state().squads.length===r.q&&WD_DEBUG.state().gold===r.g,r),'障害後の再読込でも雇用と支払いが一致：'+key);await c.close();
 }
 {
  const{p,c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(0));check(await p.locator('#hireToggle').isDisabled()&&await p.evaluate(()=>!!WD_DEBUG.recruitApi.recruit().error&&WD_DEBUG.state().soldiers.length===0),'資金不足では雇用も抽選による追加も行わない');await c.close();
 }
 {
  const{p,c}=await setup();await fill(p);const r=await p.evaluate(()=>{const D=WD_DEBUG,q=D.state().squads[7],dead=D.squadApi.roster(q)[0];D.squadApi.killSoldier(dead,q);D.setGold(1000);D.recruitApi.setRng(()=>.1);const g=D.state().gold,r=D.recruitApi.recruit();return{ok:!r.error,target:r.squad?.id,n:D.squadApi.roster(q).length,deadAlive:dead.alive,deadId:dead.id,newId:r.soldier?.id,gold:D.state().gold,paid:g-D.state().gold};});
  check(r.ok&&r.target===8&&r.n===10&&!r.deadAlive&&r.newId!==r.deadId&&r.paid===24,'戦死で空いた第八部隊へ新兵を配属し、戦死者を復活させない');
  await p.evaluate(()=>{document.getElementById('start').click();WD_DEBUG.stopSpawning();});check(await p.locator('#hireToggle').isDisabled()&&await p.evaluate(()=>!!WD_DEBUG.recruitApi.recruit().error),'通常防衛のウェーブ中は雇用不可');await c.close();
 }
 {
  const{p,c}=await setup();await p.evaluate(S=>{localStorage.clear();localStorage.setItem(S,JSON.stringify({seq:9,squadSeq:9,squads:Array.from({length:9},(_,i)=>({id:i+1,type:'spearman',slot:i<8?i:-1})),soldiers:Array.from({length:9},(_,i)=>({id:i+1,type:'spearman',squadId:i+1,level:9,name:'旧'+i})),fallen:[]}));},S);await p.reload();
  check(await p.evaluate(()=>WD_DEBUG.state().squads.length===9&&WD_DEBUG.state().soldiers.length===9&&WD_DEBUG.state().squads[8].slot===-1),'旧セーブの枠外予備隊は削除しない');await c.close();
 }
 for(const [w,h] of [[375,560],[390,844],[430,932],[1280,800]]){const{p,c}=await setup(w,h);await fill(p,16);let r=await p.evaluate(()=>{const all=[...document.querySelectorAll('[data-chip]')].map(e=>e.getBoundingClientRect());return{count:all.length,rows:new Set(all.map(r=>Math.round(r.top))).size,inside:all.every(r=>r.right<=innerWidth&&r.width>=44&&r.height>=44),overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText.includes('混成')};});check(r.count===8&&r.rows===2&&r.inside&&!r.overflow&&!r.text,w+'px：8部隊は4列2段で収まり、混成表記なし');if(process.env.SCREENSHOTS){mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.evaluate(()=>WD_DEBUG.heroApi.draw());await p.screenshot({path:process.env.SCREENSHOTS+'/eight-squads-'+w+'.png',fullPage:true});}await c.close();}
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log('結果: '+checks+' 件成功 / 0 件失敗');
}finally{await browser.close();await new Promise(r=>server.close(r));}
