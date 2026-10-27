#!/usr/bin/env node
// W3: 中国20拠点・旧版互換・章解放・霧・報酬・保存障害・敵役割の実ダメージ。
// 進行は勝敗指定、敵役割はtickで実測。全体の攻略難度は別の模擬戦で確認する。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.execPath,'../../lib/node_modules/playwright')));}
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/world-v68.json',import.meta.url),'utf8'));
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/?debug`,CKEY='worldDefense.conquest.v1',WKEY='worldDefense.warlords.v1',SKEY='worldDefense.soldiers.v1',TKEY='worldDefense.bookTransaction.v1';
let passes=0,failures=0;const errors=[];
function check(name,ok,detail){ok?passes++:failures++;console.log((ok?'✓ ':'✗ ')+name+(!ok&&detail!==undefined?' '+JSON.stringify(detail):''));}
async function setup(width=390){const c=await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});await c.addInitScript(()=>{requestAnimationFrame=()=>0;Math.random=()=>0.5;});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);return {c,p};}
async function seed(p,o={}){
 await p.evaluate(({o,CKEY,WKEY,SKEY})=>{
  const a=WD_DEBUG.squadApi;localStorage.clear();const castles={};
  for(const id of a.PROVINCE_ORDER){const k=a.PROVINCES[id].castle;if(!k)continue;const chapter=a.PROVINCES[id].chapter,owned=(chapter==='japan'&&o.japan)||(chapter==='korea'&&o.korea)||(chapter==='china'&&(o.china||[]).includes(id));castles[k]={captured:!!owned,wins:owned?1:0,attempts:owned?1:0};}
  for(const id of o.lost||[]){const k=a.PROVINCES[id].castle;castles[k].captured=false;}
  localStorage.setItem(CKEY,JSON.stringify({version:2,castles,tenka:!!o.japan,unified:!!o.japan,world:o.world}));
  localStorage.setItem(WKEY,JSON.stringify({version:1,owned:{},tickets:o.tickets||0,history:[]}));
  const types=['spearman','cavalry','archer','medic'],save={seq:40,squadSeq:4,squads:[],soldiers:[],fallen:[]};
  for(let q=1;q<=4;q++){save.squads.push({id:q,type:types[q-1],slot:q-1});for(let k=0;k<10;k++)save.soldiers.push({id:(q-1)*10+k+1,type:types[q-1],squadId:q,level:1100});}
  localStorage.setItem(SKEY,JSON.stringify(save));
 },{o,CKEY,WKEY,SKEY});await p.reload();
}
async function fight(p,id,result='win'){
 return p.evaluate(({id,result})=>{const a=WD_DEBUG.squadApi;a.setCounterRng(()=>1);const err=a.setTarget(a.PROVINCES[id].castle)||a.startBattle();if(err)return {err};const B=a.battle();a.endBattle(result);return {lv:B.enemyLevel,body:document.getElementById('battleBody').textContent,tickets:WD_DEBUG.heroApi.save().tickets,owned:a.ownsProvince(id),attempts:a.conquest()[a.PROVINCES[id].castle].attempts};},{id,result});
}
const tickets=p=>p.evaluate(()=>WD_DEBUG.heroApi.save().tickets);
const route=['liaodong','liaoxi','yan','jizhou','qilu','zhongyuan','guanzhong','longxi','jianghuai','jiangnan','wuyue','min','hanzhong','bashu','qian','yunnan','jingchu','gan','lingnan','nanhai'].map(id=>'cn_'+id);
try{
 const {c,p}=await setup();
 let r=await p.evaluate(b=>{const a=WD_DEBUG.squadApi,changed=[];for(const id of b.PROVINCE_ORDER){const old=b.PROVINCES[id],now=a.PROVINCES[id];for(const k of Object.keys(old)){let v=now[k];if(k==='adj')v=v.filter(x=>b.PROVINCES[x]);if(k==='routes')v=Object.fromEntries(Object.entries(v).filter(([x])=>b.PROVINCES[x]));if(JSON.stringify(v)!==JSON.stringify(old[k]))changed.push(id+'.'+k);}}return {changed,castles:JSON.stringify(a.NPC_CASTLES)===JSON.stringify(b.NPC_CASTLES),castleChanged:Object.keys(b.NPC_CASTLES).filter(id=>JSON.stringify(a.NPC_CASTLES[id])!==JSON.stringify(b.NPC_CASTLES[id])),defense:JSON.stringify(WD_DEBUG.unitConfig.ENEMY_VS_UNIT)===JSON.stringify(b.ENEMY_VS_UNIT)};},baseline);
 check('v68の日本・朝鮮半島76拠点の設定と既存城を維持',r.changed.length===0&&r.castleChanged.length===0,r);
 check('通常防衛戦・修練場の敵設定を変更しない',r.defense,r);
 await p.locator('#mapOpen').tap();
 check('世界に4章、中国は？？？と正しい解放条件',await p.locator('[data-map-chapter]').count()===4&&await p.locator('[data-map-chapter="china"]').isDisabled()&&/？？？.*朝鮮半島を制覇/s.test(await p.locator('[data-map-chapter="china"]').innerText()));
 check('未解放の中国はAPIでも出陣不可',/朝鮮半島.*解放/.test(await p.evaluate(()=>WD_DEBUG.squadApi.setTarget('cn_fort_liaodong'))));
 await seed(p,{japan:true});
 check('天下統一だけでは中国を解放しない',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('korea')&&!WD_DEBUG.squadApi.chapterUnlocked('china')));
 await seed(p,{japan:true,korea:true,lost:['kr_hamgyeong']});
 // 過去に勝利した7拠点でも、全章制覇の印がなければ未解放。
 check('朝鮮半島に未制圧拠点があれば中国は未解放',await p.evaluate(()=>!WD_DEBUG.squadApi.chapterUnlocked('china')));
 r=await fight(p,'kr_hamgyeong');
 check('朝鮮半島の最後の勝利で中国を即時解放',!r.err&&await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('china')),r);
 check('朝鮮半島制覇の結果画面から次の中国編へ案内する',/世界から次の章「中国」へ進めます/.test(r.body),r.body);
 await p.reload();check('新しい章の解放を再読み込み後も維持',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('china')));
 await seed(p,{japan:true,korea:true});
 check('world項目のない旧v68の朝鮮制覇セーブからも中国を解放',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('china')));
 check('旧セーブ移行・画面表示だけで報酬を付与しない',await tickets(p)===0);
 const korea=await p.evaluate(()=>WD_DEBUG.squadApi.chapterProvinces('korea'));
 await seed(p,{world:{cleared:{korea:true}},lost:korea});
 check('過去の朝鮮制覇なら領土を失っても解放を維持',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('china')));
 check('解放済みでも航路元の領土がなければ出陣不可',await p.evaluate(()=>!WD_DEBUG.squadApi.canAttackProvince('cn_liaodong')));
 await seed(p,{japan:true,korea:true});
 await p.locator('#mapOpen').tap();
 check('章カードが中国の推奨Lv625〜1100を表示',/推奨Lv625〜1100/.test(await p.locator('[data-map-chapter="china"]').innerText()));
 await p.locator('[data-map-chapter="china"]').tap();
 check('中国0/20と5つの地域が表示される',/中国 0\/20/.test(await p.locator('#mapTitle').innerText())&&await p.locator('[data-map-road]').count()===5);
 check('朝鮮専用の説明や報酬が中国に混ざらない',/平安から遼東航路/.test(await p.locator('#mapBody').innerText())&&/20拠点の初回制覇.*10枚/.test(await p.locator('#mapBody').innerText())&&!/釜山航路|8拠点の初回制覇/.test(await p.locator('#mapBody').innerText()));
 await p.locator('[data-map-road="cn_south"]').tap();
 check('未発見の国名と城名を隠す',!/南海|天海の都城|嶺南/.test(await p.locator('#mapBody').innerText())&&/？？？/.test(await p.locator('#mapBody').innerText()));
 check('未発見拠点はAPIからも目標にできない',/発見/.test(await p.evaluate(()=>WD_DEBUG.squadApi.setTarget('cn_fort_nanhai'))));
 await p.locator('[data-map-road="cn_north"]').tap();await p.locator('[data-map-prov="cn_liaodong"]').tap();
 check('入口に敵Lvと弩兵の特色・対策を表示',/敵Lv625/.test(await p.locator('#mapBody').innerText())&&/弩兵：射程210/.test(await p.locator('#mapBody').innerText()));
 check('390pxの中国拠点詳細が横にはみ出さない',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 r=await p.evaluate(route=>{const a=WD_DEBUG.squadApi;return {count:a.PROVINCE_ORDER.length,levels:route.map(p=>a.NPC_CASTLES[a.PROVINCES[p].castle].enemyLevel),regions:Object.keys(a.CHAPTERS.china.roads).map(k=>a.chapterProvinces('china').filter(p=>a.PROVINCES[p].road===k).length),seen:a.chapterProvinces('china').filter(a.provinceDiscovered)};},route);
 check('全108拠点、中国は4拠点ずつの5地域',r.count===108&&r.regions.every(n=>n===4),r);
 check('中国の敵Lvは625から25刻みで1100まで',r.levels.every((lv,i)=>lv===625+i*25),r.levels);
 check('最初に発見する中国拠点は入口だけ',r.seen.join()==='cn_liaodong',r.seen);
 for(const result of ['lose','retreat','timeup']){r=await fight(p,'cn_liaodong',result);check(result+'では占領・報酬なしで挑戦回数だけ増える',!r.err&&!r.owned&&r.tickets===0&&r.attempts>0,r);}
 r=await fight(p,'cn_liaodong');
 check('遼東勝利で隣の遼西を発見・初回券1枚',!r.err&&r.tickets===1&&await p.evaluate(()=>WD_DEBUG.squadApi.provinceDiscovered('cn_liaoxi')),r);
 // 実戦を1tick進めて長射程を確認。遠距離210の役割がない弓兵は同じ位置から撃てない。
 await seed(p,{japan:true,korea:true});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setTarget('cn_fort_liaodong');const err=a.startBattle();if(err)return {err};const B=a.battle(),e=B.garrison.find(e=>e.siegeRole==='crossbow'),g=B.groups[0],s=g.list[0];B.garrison=[e];B.towers=[];B.nextUnit=4;for(const h of B.groups)h.state='empty';g.state='march';g.list=[s];g.d=e.d-180;Object.assign(g,WD_DEBUG.pathAt(g.path,g.d));s.cd=10000;e.cd=0;const hp=s.hp;WD_DEBUG.step(0.05);const shot=hp-s.hp,distance=Math.hypot(e.x-g.x,e.y-g.y);s.hp=hp;e.cd=0;e.siegeRole=null;WD_DEBUG.step(0.05);return {shot,normal:hp-s.hp,distance,roleAttack:a.siegeGuardAttack({...e,siegeRole:'crossbow'}),baseAttack:a.siegeGuardAttack(e)};});
 check('弩兵は通常弓兵の射程外から実際に攻撃する',r.distance>130&&r.distance<210&&r.shot>0&&r.normal===0,r);
 check('弩兵の実攻撃設定は射程210・間隔2.2秒の遠距離攻撃',r.roleAttack.range===210&&r.roleAttack.rate===2.2&&r.roleAttack.ranged,r);
 await seed(p,{japan:true,korea:true,china:['cn_liaodong']});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setTarget('cn_fort_liaoxi');a.startBattle();const B=a.battle(),e=B.garrison.find(e=>e.siegeRole==='heavyCavalry'),before=e.hp;const normal=a.siegeEnemyStats(e.kind,e.lv);a.battleHitGarrison(e,100);return {actual:before-e.hp,expected:100*30/(30+e.armor),normal:100*30/(30+normal.armor),hp:e.max,baseHp:normal.max,armor:e.armor,role:a.siegeGuardAttack(e)};});
 check('重装騎兵の高HPと装甲が実際の被ダメージに反映',r.hp>r.baseHp&&r.actual<r.normal&&Math.abs(r.actual-r.expected)<1e-6,r);
 check('重装騎兵の攻撃間隔は1.1秒、装甲上限42',r.role.rate===1.1&&r.armor<=42&&await p.evaluate(()=>WD_DEBUG.squadApi.siegeEnemyStats('wolf',1000000,'heavyCavalry').armor===42),r);
 check('他兵種に重装役割を誤って適用しない',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return JSON.stringify(a.siegeEnemyStats('goblin',625,'heavyCavalry'))===JSON.stringify(a.siegeEnemyStats('goblin',625));}));
 // 既存画像の色替えと弩・重ラベルを実際に描画する（描画APIが例外を出さないことも確認）。
 await p.waitForFunction(()=>[...document.images].every(im=>im.complete));
 await p.evaluate(()=>{WD_DEBUG.step(1);WD_DEBUG.heroApi.draw();});
 check('中国の戦闘描画でJavaScriptエラーがない',errors.length===0,errors);
 await seed(p,{japan:true,korea:true});
 const before=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return [a.territoryBonus('waveGold'),a.territoryBonus('hire'),a.territoryBonus('repair'),a.startGold()];});
 for(const id of route){r=await fight(p,id);check(id+'へ進軍・占領できる',!r.err&&r.owned,r);}
 check('中国20拠点の初回報酬21枚＋章制覇10枚＝31枚',r.tickets===31&&/中国を制覇/.test(r.body)&&/領土 20\/20拠点/.test(r.body),r);
 check('中国制覇で天下統一や世界征服を重ねて表示しない',!/天下統一！|7か国を統一|世界征服達成/.test(r.body),r.body);
 check('中国章の達成と報酬受領を保存',await p.evaluate(()=>{const w=WD_DEBUG.squadApi.conquestMeta().world;return w.cleared.china&&w.rewards.china;}));
 check('中国の占領で日本の領土ボーナスを増やさない',JSON.stringify(before)===JSON.stringify(await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return [a.territoryBonus('waveGold'),a.territoryBonus('hire'),a.territoryBonus('repair'),a.startGold()];})));
 await p.reload();check('再読み込みで報酬は増えない',await tickets(p)===31);
 r=await fight(p,'cn_nanhai');check('中国の演習で初回報酬を再取得しない',r.tickets===31,r);
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquest().cn_fort_nanhai.captured=false;a.persistConquest();});r=await fight(p,'cn_nanhai');check('失地後の再占領でも報酬を再取得しない',r.tickets===31,r);
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;for(const p of a.chapterProvinces('china'))a.conquest()[a.PROVINCES[p].castle].captured=p==='cn_liaodong';a.conquestMeta().counter=null;a.setCounterRng(()=>0);});
 r=await p.evaluate(()=>WD_DEBUG.squadApi.maybeCounter('china'));
 check('中国の反撃は中国の領土だけを狙う',r?.province.startsWith('cn_')&&r?.from.startsWith('cn_'),r);
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquestMeta().counter={province:'kr_pyeongan',from:'cn_liaodong'};});
 check('章をまたぐ不正な反撃を有効にしない',await p.evaluate(()=>!WD_DEBUG.squadApi.activeCounter()));
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;for(const p of a.PROVINCE_ORDER){const k=a.PROVINCES[p].castle;if(k)a.conquest()[k].captured=false;}a.syncWorldProgress();a.persistConquest();});await p.reload();
 check('全領土を失っても中国の解放・制覇・発見を維持',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return a.chapterUnlocked('china')&&a.provinceDiscovered('cn_nanhai')&&a.conquestMeta().world.cleared.china;}));
 // 中国の反撃を防衛戦の勝敗まで通す（ウェーブ進行は試験用に短縮）。
 await seed(p,{japan:true,korea:true,china:['cn_liaodong']});
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquestMeta().counter={province:'cn_liaodong',from:'cn_liaoxi'};a.persistConquest();});await p.reload();
 check('中国の反撃を再読み込み後も保持',await p.evaluate(()=>WD_DEBUG.squadApi.activeCounter()?.province==='cn_liaodong'));
 r=await p.evaluate(()=>{for(let i=0;i<10;i++){document.getElementById('start').click();WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;WD_DEBUG.step(0.1);}const a=WD_DEBUG.squadApi;return {counter:a.activeCounter(),owned:a.ownsProvince('cn_liaodong'),tickets:WD_DEBUG.heroApi.save().tickets};});
 check('防衛10ウェーブで中国の反撃を撃退・領土維持',!r.counter&&r.owned,r);
 check('中国反撃の撃退券1枚と通常の5枚を保存',r.tickets===6,r);
 await seed(p,{japan:true,korea:true,china:['cn_liaodong']});
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquestMeta().counter={province:'cn_liaodong',from:'cn_liaoxi'};a.persistConquest();});await p.reload();
 r=await p.evaluate(()=>{document.getElementById('start').click();WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;for(let i=0;i<25;i++)WD_DEBUG.addEnemy({kind:'wolf',d:1000+i,hp:1e9,speed:400});WD_DEBUG.step(5);const a=WD_DEBUG.squadApi;return {over:WD_DEBUG.state().over,owned:a.ownsProvince('cn_liaodong'),counter:a.activeCounter()};});
 check('防衛で負けると中国の領土を失い反撃を終了',r.over&&!r.owned&&!r.counter,r);
 await p.reload();check('中国の失地を保存し章解放・発見は失わない',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return !a.ownsProvince('cn_liaodong')&&a.chapterUnlocked('china')&&a.provinceDiscovered('cn_liaodong');}));
 for(const failKey of [TKEY,CKEY,WKEY,SKEY]){
  await seed(p,{japan:true,korea:true,china:route.slice(0,-1),tickets:19});
  r=await p.evaluate(failKey=>{const a=WD_DEBUG.squadApi;a.setCounterRng(()=>1);a.setTarget('cn_fort_nanhai');a.startBattle();const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===failKey)throw Error('W3 simulated storage failure');return original.call(this,k,v);};try{a.endBattle('win');return document.getElementById('battleBody').textContent;}finally{Storage.prototype.setItem=original;}},failKey);
  if(failKey===TKEY)check('中国の章報酬を確定できなければ未保存を表示',/未保存/.test(r));
  await p.reload();
  const after=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {owned:a.ownsProvince('cn_nanhai'),reward:!!a.conquestMeta().world.rewards.china,tickets:WD_DEBUG.heroApi.save().tickets};});
  check('章制覇の保存障害後に領土・受領印・券が整合：'+failKey,failKey===TKEY?!after.owned&&!after.reward&&after.tickets===19:after.owned&&after.reward&&after.tickets===31,after);
  if(failKey!==TKEY){await p.reload();check('復旧後の再読込で中国章報酬が増えない：'+failKey,await tickets(p)===31);}
 }
 await seed(p,{world:{unlocked:{china:'yes'},cleared:{korea:'yes',china:1},discovered:{cn_nanhai:1},rewards:{china:'yes'}}});
 check('壊れた章フラグは中国解放や発見として扱わない',await p.evaluate(()=>!WD_DEBUG.squadApi.chapterUnlocked('china')&&!WD_DEBUG.squadApi.provinceDiscovered('cn_nanhai')));
 // 推奨Lvの実戦回帰。攻防へ均等配分、装備・武将なしの40人で時間切れ前に勝てる一方、低Lvでは敗北する。
 for(const lv of [600,1100]){
  await seed(p,{japan:true,korea:true,china:route});
  await p.evaluate(lv=>{const save=JSON.parse(localStorage.getItem('worldDefense.soldiers.v1'));for(const s of save.soldiers){s.level=lv;s.pts={atk:Math.floor((lv-1)*1.5),def:Math.ceil((lv-1)*1.5),spd:0,rng:0};}localStorage.setItem('worldDefense.soldiers.v1',JSON.stringify(save));},lv);await p.reload();
  r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setTarget('cn_fort_nanhai');const err=a.startBattle();if(err)return {err};const B=a.battle();for(let i=0;i<4000&&a.battle();i++)WD_DEBUG.step(0.05);return {result:B.result,time:B.t,alive:WD_DEBUG.state().soldiers.filter(s=>s.alive).length};});
  check('南海の実戦Lv'+lv,lv===600?r.result==='lose'&&r.alive===0:r.result==='win'&&r.time<180&&r.alive>0&&r.alive<30,r);
 }
 check('全操作でJavaScriptエラーなし',errors.length===0,errors);await c.close();
 for(const width of [375,390,430,1280]){
  const {c,p}=await setup(width);await seed(p,{japan:true,korea:true});
  const click=async sel=>width<600?p.locator(sel).tap():p.locator(sel).click();await click('#mapOpen');await click('[data-map-chapter="china"]');await click('[data-map-road="cn_north"]');await click('[data-map-prov="cn_liaodong"]');
  check(width+'pxで世界・中国の地域・拠点が画面内に収まりボタン44px以上',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('#mapBody button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)));
  if(process.env.SCREENSHOTS&&width===390){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.waitForTimeout(2000);await p.screenshot({path:path.join(process.env.SCREENSHOTS,'w3-china-entry-390.png')});}
  await c.close();
 }
}finally{await browser.close();server.close();}
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);process.exitCode=failures?1:0;
