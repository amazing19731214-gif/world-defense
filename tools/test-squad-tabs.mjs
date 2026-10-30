// 部隊1〜8の表示、指導員候補の昇順・直接引退・既存編成との往復を実操作で確認。
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
async function setup(width=390,debug=true,empty=false){
 const c=await browser.newContext({viewport:{width,height:width===375?560:844},isMobile:width<700,hasTouch:width<700});
 await c.addInitScript(({S,W,empty})=>{requestAnimationFrame=()=>0;if(sessionStorage.getItem('seed'))return;sessionStorage.setItem('seed','1');
  const levels=[500,99,100,100,101,200,50,1,100,120,90,2,105,300,250,30];
  localStorage.setItem(S,JSON.stringify({seq:16,squadSeq:8,heroId:empty?null:1,squads:empty?[]:Array.from({length:8},(_,i)=>({id:i+1,type:'spearman',slot:i})),soldiers:empty?[]:levels.map((level,i)=>({id:i+1,type:i===2?'ashigaru':'spearman',squadId:Math.floor(i/2)+1,level,name:i===2?'吉川元春':'兵'+(i+1),named:i===2?'motoharu':null,skills:[],learned:[]})),fallen:[]}));
  localStorage.setItem(W,JSON.stringify({owned:{nobunaga:2},tickets:7,forge:{seq:1,items:[{uid:1,id:'nanbando',owner:empty?null:4,lock:false}],shards:0,books:{},koban:800}}));
 },{S,W,empty});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+(debug?'?debug':'?layout=classic'));if(debug)await p.waitForFunction(()=>window.WD_DEBUG);await p.locator('#organize').click();return{p,c};
}
const choose=(p,value)=>p.locator(`[data-squad-filter="${value}"]`).click();
const candidateIds=p=>p.locator('[data-mentor-candidate]').evaluateAll(es=>es.map(e=>+e.dataset.mentorCandidate));
try{
 {
  const{p,c}=await setup();const stored=await p.evaluate(S=>localStorage.getItem(S),S);
  check(await p.locator('#squadRosterTabs [data-squad-filter]').count()===10,'第一〜第八部隊・全隊・指導員候補の切替を表示');
  for(let i=0;i<8;i++){
   await choose(p,String(i));const ids=await p.locator('[data-formation-soldier]').evaluateAll(bs=>bs.map(b=>+b.dataset.formationSoldier));
   check(ids.join()===`${i*2+1},${i*2+2}`&&await p.locator('#squadList .squad-card').count()===1,`第${i+1}部隊には所属兵士だけ表示`);
  }
  await choose(p,'all');check(await p.locator('[data-formation-soldier]').count()===16,'全隊に戻すと全兵士を表示');
  await choose(p,'candidates');check((await candidateIds(p)).join()==='3,4,9,5,13,10,6,15,14','Lv100以上だけをレベル昇順・同LvはID順で表示');
  check(await p.locator('[data-formation-retire="1"], [data-formation-retire="2"]').count()===0&&await p.locator('[data-formation-retire="3"]').isEnabled(),'主人公とLv99以下を除外しネームドの候補は残す');
  check(await p.evaluate(({S,stored})=>localStorage.getItem(S)===stored,{S,stored}),'表示切替だけで旧セーブを変更しない');
  await p.locator('[data-formation-soldier="3"]').click();await p.locator('#soldierClose').click();check(await p.locator('#squadFilter-candidates').getAttribute('aria-selected')==='true'&&(await candidateIds(p))[0]===3,'詳細・育成から元の候補一覧へ戻る');
  await p.locator('[data-formation-retire="4"]').click();check(await p.locator('#retireSheet').isVisible()&&await p.locator('[data-retire-go]').count()===0,'候補から既存の引退確認へ直接進み、書を選ぶ前は確定できない');
  await p.locator('#retireClose').click();check((await candidateIds(p)).includes(4)&&await p.evaluate(()=>WD_DEBUG.state().soldiers.length===16),'取消なら候補と兵士を残す');
  await p.locator('[data-formation-retire="4"]').click();await p.locator('[data-retire-pick="0"]').click();check(/戻せません/.test(await p.locator('#retireBody').innerText()),'直接引退でも不可逆の確認を維持');await p.locator('[data-retire-go]').click();
  check(await p.locator('#retireSheet').isHidden()&&await p.locator('#squadSheet').isVisible()&&(await candidateIds(p)).join()==='3,9,5,13,10,6,15,14','引退後は候補を除き昇順を維持して同じ一覧へ戻る');
  check(await p.evaluate(()=>WD_DEBUG.forgeApi.save().items[0].owner===null&&WD_DEBUG.forgeApi.save().mentors.length===1&&WD_DEBUG.heroApi.save().tickets===7),'装備返却・指導員記録・通貨を維持');
  await p.locator('#squadClose').click();await p.reload();await p.locator('#organize').click();await choose(p,'candidates');check(!(await candidateIds(p)).includes(4)&&await p.evaluate(()=>WD_DEBUG.state().soldiers.length===15),'再読込後も引退した兵士を復活させない');
  await choose(p,'1');await p.locator('[data-move="3"]').click();check(await p.locator('#squadFilter-all').getAttribute('aria-selected')==='true'&&await p.locator('[data-move-to="1"]').isVisible(),'部隊タブから移籍を始めると全隊で移籍先を選べる');await p.locator('[data-cancel-move]').click();
  await choose(p,'7');await p.keyboard.press('ArrowLeft');check(await p.locator('#squadFilter-6').getAttribute('aria-selected')==='true','キーボードでも部隊を切替');
  await p.locator('#siege').click();check(await p.locator('#squadRosterTabs').isHidden()&&await p.locator('#siegeSheet').isVisible(),'攻城用武将タブの表示を維持');await c.close();
 }
 {
  const{p,c}=await setup(390,true,true);await choose(p,'7');check(/第八部隊にはまだ兵士がいません/.test(await p.locator('#squadList').innerText()),'未作成の部隊も空き枠として表示');await choose(p,'candidates');check(/候補はいません/.test(await p.locator('#squadList').innerText()),'候補0人の説明を表示');await c.close();
 }
 {
  const{p,c}=await setup();await p.locator('#squadClose').click();await p.locator('#start').click();await p.evaluate(()=>WD_DEBUG.stopSpawning());await p.locator('#organize').click();await choose(p,'candidates');check(await p.locator('[data-formation-retire="4"]').isDisabled()&&/ウェーブ中/.test(await p.locator('#squadList').innerText()),'ウェーブ中は候補を見ても引退できず理由を表示');await c.close();
 }
 for(const width of [375,390,430,1280]){
  const{p,c}=await setup(width,false);await choose(p,'7');await choose(p,'candidates');const r=await p.evaluate(()=>{const sh=document.querySelector('#squadSheet .sheet'),r=sh.getBoundingClientRect(),head=document.querySelector('#squadRosterTabs').getBoundingClientRect();return{fit:r.top>=0&&r.bottom<=innerHeight+.5,overflow:document.documentElement.scrollWidth>innerWidth,room:r.bottom-head.bottom,buttons:[...document.querySelectorAll('#squadRosterTabs button,#squadList .formation-soldier-actions button')].every(b=>{const r=b.getBoundingClientRect();return r.height>=32&&r.width>=44;})};});check(r.fit&&!r.overflow&&r.room>100&&r.buttons,width+'px通常URL：8部隊タブと候補・引退操作が収まる');if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:process.env.SCREENSHOTS+'/squad-tabs-'+width+'.png',fullPage:true});}await c.close();
 }
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));console.log(`結果: ${n} 件成功 / 0 件失敗`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
