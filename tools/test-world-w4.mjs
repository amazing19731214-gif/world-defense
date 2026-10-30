#!/usr/bin/env node
import { togglePause, toggleSpeed } from './ui-test-utils.mjs';
// W4: 東南アジア12拠点・旧版互換・霧・報酬・保存障害・森と川の実戦。
// 進行は勝敗指定。地形は実際のtickで移動・攻撃・回復・被弾を検証する。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.execPath,'../../lib/node_modules/playwright')));}
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/world-v69.json',import.meta.url),'utf8'));
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
  for(const id of a.PROVINCE_ORDER){const k=a.PROVINCES[id].castle;if(!k)continue;const chapter=a.PROVINCES[id].chapter,owned=(chapter==='japan'&&o.japan)||(chapter==='korea'&&o.korea)||(chapter==='china'&&(o.china===true||(o.china||[]).includes(id)))||(chapter==='southeast'&&(o.southeast||[]).includes(id));castles[k]={captured:!!owned,wins:owned?1:0,attempts:owned?1:0};}
  for(const id of o.lost||[]){const k=a.PROVINCES[id].castle;castles[k].captured=false;}
  localStorage.setItem(CKEY,JSON.stringify({version:2,castles,tenka:!!o.japan,unified:!!o.japan,world:o.world}));
  localStorage.setItem(WKEY,JSON.stringify({version:1,owned:{},tickets:o.tickets||0,history:[]}));
  const types=['spearman','cavalry','archer','medic'],save={seq:40,squadSeq:4,squads:[],soldiers:[],fallen:[]};
  for(let q=1;q<=4;q++){save.squads.push({id:q,type:types[q-1],slot:q-1});for(let k=0;k<10;k++)save.soldiers.push({id:(q-1)*10+k+1,type:types[q-1],squadId:q,level:1700,pts:{atk:2548,def:2549,spd:0,rng:0}});}
  localStorage.setItem(SKEY,JSON.stringify(save));
 },{o,CKEY,WKEY,SKEY});await p.reload();
}
async function fight(p,id,result='win'){
 return p.evaluate(({id,result})=>{const a=WD_DEBUG.squadApi;a.setCounterRng(()=>1);const err=a.setTarget(a.PROVINCES[id].castle)||a.startBattle();if(err)return {err};const B=a.battle();a.endBattle(result);return {lv:B.enemyLevel,body:document.getElementById('battleBody').textContent,tickets:WD_DEBUG.heroApi.save().tickets,owned:a.ownsProvince(id),attempts:a.conquest()[a.PROVINCES[id].castle].attempts};},{id,result});
}
const tickets=p=>p.evaluate(()=>WD_DEBUG.heroApi.save().tickets);
const route=['redriver','mekong','irrawaddy','salween','chaophraya','angkor','malay','sumatra','straits','java','borneo','molucca'].map(id=>'se_'+id);
// 地形を実際の攻城戦に載せる。戦闘を隔離する場合だけ守備隊・塔を除き、第一部隊を進軍させる。
async function terrainBattle(p,terrain,d=270){
 await seed(p,{japan:true,korea:true,china:true});
 return p.evaluate(({terrain,d})=>{const a=WD_DEBUG.squadApi;a.setTarget('se_fort_redriver');const err=a.startBattle();if(err)return {err};const B=a.battle();B.terrain=terrain;B.garrison=[];B.towers=[];B.nextUnit=4;for(const g of B.groups)g.state='empty';const g=B.groups[0];g.state='march';g.d=d;Object.assign(g,WD_DEBUG.pathAt(g.path,g.d));return null;},{terrain,d});
}
try{
 const {c,p}=await setup();
 let r=await p.evaluate(b=>{const a=WD_DEBUG.squadApi,changes=[];for(const id of b.PROVINCE_ORDER){const old=b.PROVINCES[id],now=a.PROVINCES[id];for(const k of Object.keys(old)){let v=now[k];if(k==='adj')v=v.filter(id=>b.PROVINCES[id]);if(k==='routes')v=Object.fromEntries(Object.entries(v).filter(([id])=>b.PROVINCES[id]));if(JSON.stringify(v)!==JSON.stringify(old[k]))changes.push(id+'.'+k);}}return {changes,castles:Object.keys(b.NPC_CASTLES).filter(id=>JSON.stringify(a.NPC_CASTLES[id])!==JSON.stringify(b.NPC_CASTLES[id])),defense:JSON.stringify(WD_DEBUG.unitConfig.ENEMY_VS_UNIT)===JSON.stringify(b.ENEMY_VS_UNIT)};},baseline);
 check('v69の既存96拠点の国・城・難易度・守備隊・報酬を維持',r.changes.length===0&&r.castles.length===0,r);
 check('通常防衛戦・修練場の敵設定を維持',r.defense,r);
 await p.locator('#mapOpen').tap();
 check('世界に5章、東南アジアは？？？と中国制覇の条件',await p.locator('[data-map-chapter]').count()===5&&await p.locator('[data-map-chapter="southeast"]').isDisabled()&&/？？？.*中国を制覇/s.test(await p.locator('[data-map-chapter="southeast"]').innerText()));
 check('未解放の章はAPIからも出陣不可',/中国.*解放/.test(await p.evaluate(()=>WD_DEBUG.squadApi.setTarget('se_fort_redriver'))));
 await seed(p,{japan:true,korea:true});check('朝鮮半島制覇だけでは東南アジアを解放しない',await p.evaluate(()=>!WD_DEBUG.squadApi.chapterUnlocked('southeast')));
 await seed(p,{japan:true,korea:true,china:true,lost:['cn_nanhai']});
 check('中国に未制圧拠点があれば東南アジアは未解放',await p.evaluate(()=>!WD_DEBUG.squadApi.chapterUnlocked('southeast')));
 r=await fight(p,'cn_nanhai');
 check('中国最後の勝利で東南アジアを解放し結果画面から案内',!r.err&&await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('southeast'))&&/世界から次の章「東南アジア」へ進めます/.test(r.body),r);
 await p.reload();check('章解放を再読み込み後も維持',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('southeast')));
 await seed(p,{japan:true,korea:true,china:true});
 check('world項目のない旧v69の中国制覇セーブからも解放',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('southeast')));
 check('移行・画面表示だけで報酬を付与しない',await tickets(p)===0);
 await seed(p,{world:{cleared:{china:true}}});
 check('過去の中国制覇なら失地後も解放を維持',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('southeast')));
 check('章が開いても航路元の領土がないと出陣できない',await p.evaluate(()=>!WD_DEBUG.squadApi.canAttackProvince('se_redriver')));
 await seed(p,{japan:true,korea:true,china:true});await p.locator('#mapOpen').tap();
 check('章カードの推奨Lvは1150〜1700',/推奨Lv1150〜1700/.test(await p.locator('[data-map-chapter="southeast"]').innerText()));
 await p.locator('[data-map-chapter="southeast"]').tap();
 check('東南アジア0/12と4地域を表示',/東南アジア 0\/12/.test(await p.locator('#mapTitle').innerText())&&await p.locator('[data-map-road]').count()===4);
 check('章の案内に森・川・継続する戦闘と初回制覇報酬を表示',/進軍速度75%.*渡河待ち1.5秒.*攻撃・回復・被弾.*12拠点の初回制覇.*10枚/s.test(await p.locator('#mapBody').innerText()));
 await p.locator('[data-map-road="se_islands"]').tap();
 check('未発見拠点の名前・城名を隠す',/？？？/.test(await p.locator('#mapBody').innerText())&&!/天香の都城|香料諸島|翡翠の砦/.test(await p.locator('#mapBody').innerText()));
 check('未発見の拠点はAPIからも目標にできない',/発見/.test(await p.evaluate(()=>WD_DEBUG.squadApi.setTarget('se_fort_molucca'))));
 await p.locator('[data-map-road="se_north"]').tap();await p.locator('[data-map-prov="se_redriver"]').tap();
 check('入口の詳細に敵Lv1150・地形・渡河待ちを表示',/敵Lv1150/.test(await p.locator('#mapBody').innerText())&&/地形：.*渡河待ち1.5秒/.test(await p.locator('#mapBody').innerText()));
 r=await p.evaluate(route=>{const a=WD_DEBUG.squadApi;return {count:a.PROVINCE_ORDER.length,regions:Object.keys(a.CHAPTERS.southeast.roads).map(k=>a.chapterProvinces('southeast').filter(p=>a.PROVINCES[p].road===k).length),levels:route.map(id=>a.NPC_CASTLES[a.PROVINCES[id].castle].enemyLevel),seen:a.chapterProvinces('southeast').filter(a.provinceDiscovered),terrain:route.every(id=>a.NPC_CASTLES[a.PROVINCES[id].castle].terrain.every(t=>a.SIEGE_TERRAIN[t]))};},route);
 check('全120拠点、東南アジアは各3拠点の4地域',r.count===120&&r.regions.every(n=>n===3),r);
 check('敵Lvは1150から50刻み、すべての地形IDが有効',r.levels.every((lv,i)=>lv===1150+i*50)&&r.terrain,r);
 check('入口だけを発見し、内陸や島は未発見',r.seen.join()==='se_redriver',r.seen);
 for(const result of ['lose','retreat','timeup']){r=await fight(p,'se_redriver',result);check(result+'では占領・報酬なし',!r.err&&!r.owned&&r.tickets===0,r);}
 r=await fight(p,'se_redriver');check('入口制圧で次のメコン上流を発見・券1枚',r.tickets===1&&await p.evaluate(()=>WD_DEBUG.squadApi.provinceDiscovered('se_mekong')),r);
 await terrainBattle(p,['forest']);
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi,B=a.battle(),g=B.groups[0],start=g.d;WD_DEBUG.step(2);const forest=g.d-start;B.terrain=[];g.d=start;Object.assign(g,WD_DEBUG.pathAt(g.path,g.d));WD_DEBUG.step(2);return {forest,plain:g.d-start};});
 check('実戦の森では同じ兵の進軍距離が平地の75%',Math.abs(r.forest/r.plain-0.75)<1e-8,r);
 r=await p.evaluate(()=>{const B=WD_DEBUG.squadApi.battle(),g=B.groups[0];B.terrain=['forest'];g.d=450;Object.assign(g,WD_DEBUG.pathAt(g.path,g.d));WD_DEBUG.step(1);return g.d-450;});
 check('森を抜けると進軍速度が元に戻る',Math.abs(r-38)<1e-8,r);
 await terrainBattle(p,['river'],480);
 r=await p.evaluate(()=>{const B=WD_DEBUG.squadApi.battle(),g=B.groups[0];WD_DEBUG.step(0.5);return {d:g.d,wait:g.terrainWait,state:g.state};});
 check('川に着いた部隊はその場で渡河待ちする',r.d===480&&Math.abs(r.wait-1)<1e-8&&r.state==='fight',r);
 r=await p.evaluate(()=>{const g=WD_DEBUG.squadApi.battle().groups[0];WD_DEBUG.step(1);const d=g.d;WD_DEBUG.step(0.5);return {atEnd:d,after:g.d,wait:g.terrainWait,crossed:g.crossedTerrain.river};});
 check('1.5秒経つと再進軍し、同じ川で繰り返し止まらない',r.atEnd===480&&Math.abs(r.after-499)<1e-8&&r.wait===0&&r.crossed,r);
 r=await p.evaluate(()=>{const B=WD_DEBUG.squadApi.battle(),g=B.groups[1];g.state='march';g.d=480;Object.assign(g,WD_DEBUG.pathAt(g.path,g.d));WD_DEBUG.step(0.5);return {first:B.groups[0].terrainWait,second:g.terrainWait,d:g.d};});
 check('別の部隊は独立して渡河する',r.first===0&&Math.abs(r.second-1)<1e-8&&r.d===480,r);
 await terrainBattle(p,['river'],480);
 await togglePause(p);r=await p.evaluate(()=>{WD_DEBUG.step(0.5);return WD_DEBUG.squadApi.battle().groups[0].d;});
 check('停止中は地形の進行も止まる',r===480,r);
 await togglePause(p);await p.evaluate(()=>WD_DEBUG.step(0.5));await toggleSpeed(p);
 r=await p.evaluate(()=>{WD_DEBUG.step(0.25);return WD_DEBUG.squadApi.battle().groups[0].terrainWait;});
 check('x2では渡河待ちも2倍の速さで進む',Math.abs(r-0.5)<1e-8,r);
 await terrainBattle(p,['river'],480);
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi,B=a.battle(),g=B.groups[0],s=g.list[0];g.list=[s];g.terrainWait=1.5;g.crossedTerrain.river=true;g.skillCd=3;s.cd=0;const base=a.siegeEnemyStats('goblin',1150),point=WD_DEBUG.pathAt(g.path,510),e={...base,kind:'goblin',path:g.path,d:510,...point,hp:1e8,max:1e8,attack:100,cd:0,r:13,reward:10};B.garrison=[e];const hp=s.hp,enemyHp=e.hp;WD_DEBUG.step(0.05);WD_DEBUG.heroApi.draw();return {d:g.d,wait:g.terrainWait,enemyHit:e.hp<enemyHp,ownHit:s.hp<hp,cd:g.skillCd,text:document.getElementById('battleInfo').textContent};});
 check('渡河中も味方は攻撃し、敵からの攻撃を受ける',r.enemyHit&&r.ownHit&&r.d===480,r);
 check('交戦中でも渡河時間と必殺技待ちが進み、バーに渡河を表示',Math.abs(r.wait-1.45)<1e-8&&r.cd<3&&/渡河/.test(r.text),r);
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi,B=a.battle(),g=B.groups[0],med=B.groups[3];B.garrison=[];med.state='fight';med.path=g.path;med.d=480;med.terrainWait=1.5;med.crossedTerrain.river=true;Object.assign(med,WD_DEBUG.pathAt(med.path,med.d));const m=med.list[0];med.list=[m];m.cd=0;const s=g.list[0];s.hp=a.soldierStats(s).maxHp*0.4;const hp=s.hp;WD_DEBUG.step(0.05);return {healed:s.hp>hp,d:med.d,wait:med.terrainWait};});
 check('衛生兵は渡河待ちの間も治療する',r.healed&&r.d===480&&r.wait>0,r);
 const distances=[];
 for(const h of [0.05,1/60]){await terrainBattle(p,['forest','river'],250);distances.push(await p.evaluate(h=>{WD_DEBUG.step(15,h);const g=WD_DEBUG.squadApi.battle().groups[0];return {d:g.d,wait:g.terrainWait};},h));}
 check('地形の移動・待ち時間は20fpsと60fpsで一致',Math.abs(distances[0].d-distances[1].d)<1e-6&&Math.abs(distances[0].wait-distances[1].wait)<1e-6,distances);
 await seed(p,{japan:true,korea:true,china:true});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setTarget('cn_fort_liaodong');a.startBattle();const B=a.battle();B.garrison=[];B.towers=[];B.nextUnit=4;for(const g of B.groups)g.state='empty';const g=B.groups[0];g.state='march';g.d=480;Object.assign(g,WD_DEBUG.pathAt(g.path,g.d));WD_DEBUG.step(1);return {terrain:B.terrain,d:g.d,wait:g.terrainWait};});
 check('中国など旧章では地形による減速・渡河待ちは起きない',r.terrain.length===0&&Math.abs(r.d-518)<1e-8&&r.wait===0,r);
 await seed(p,{japan:true,korea:true,china:true,southeast:['se_redriver']});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setTarget('se_fort_mekong');a.startBattle();WD_DEBUG.heroApi.draw();return {terrain:a.battle().terrain,text:document.getElementById('battleInfo').textContent};});
 check('拠点に指定した森と川を戦闘に載せて描画する',r.terrain.join()==='forest,river'&&/地形：密林・渡河/.test(r.text),r);
 await seed(p,{japan:true,korea:true,china:true});
 const bonus=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return [a.startGold(),a.territoryBonus('waveGold'),a.territoryBonus('hire'),a.territoryBonus('repair')];});
 for(const id of route){r=await fight(p,id);check(id+'へ進軍・占領できる',!r.err&&r.owned,r);}
 check('12拠点の城報酬13＋章制覇10＝券23枚',r.tickets===23&&/東南アジアを制覇/.test(r.body)&&/領土 12\/12拠点/.test(r.body),r);
 check('天下統一・完全クリア・世界征服を重ねて表示しない',!/天下統一！|7か国を統一|世界征服達成|完全クリア！/.test(r.body),r.body);
 check('章の制覇と報酬受領を保存',await p.evaluate(()=>{const w=WD_DEBUG.squadApi.conquestMeta().world;return w.cleared.southeast&&w.rewards.southeast;}));
 check('旧領土のボーナスを変えない',JSON.stringify(bonus)===JSON.stringify(await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return [a.startGold(),a.territoryBonus('waveGold'),a.territoryBonus('hire'),a.territoryBonus('repair')];})));
 await p.reload();check('再読み込みで券が増えない',await tickets(p)===23);
 r=await fight(p,'se_molucca');check('演習で初回報酬を繰り返さない',r.tickets===23,r);
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquest().se_fort_molucca.captured=false;a.persistConquest();});r=await fight(p,'se_molucca');check('再占領で初回報酬を繰り返さない',r.tickets===23,r);
 await seed(p,{japan:true,korea:true,china:true,southeast:['se_redriver']});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setCounterRng(()=>0);return a.maybeCounter('southeast');});
 check('東南アジアの反撃は同章内だけ',r?.province.startsWith('se_')&&r?.from.startsWith('se_'),r);
 await p.reload();check('反撃を再読み込み後も維持',await p.evaluate(()=>WD_DEBUG.squadApi.activeCounter()?.province==='se_redriver'));
 r=await p.evaluate(()=>{for(let i=0;i<10;i++){document.getElementById('start').click();WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;WD_DEBUG.step(0.1);}const a=WD_DEBUG.squadApi;return {counter:a.activeCounter(),owned:a.ownsProvince('se_redriver'),tickets:WD_DEBUG.heroApi.save().tickets};});
 check('防衛10ウェーブで反撃を撃退し券1＋通常5枚を保存',!r.counter&&r.owned&&r.tickets===6,r);
 await seed(p,{japan:true,korea:true,china:true,southeast:['se_redriver']});
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquestMeta().counter={province:'se_redriver',from:'se_mekong'};a.persistConquest();});await p.reload();
 r=await p.evaluate(()=>{document.getElementById('start').click();WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;for(let i=0;i<25;i++)WD_DEBUG.addEnemy({kind:'wolf',d:1000+i,hp:1e9,speed:400});WD_DEBUG.step(5);const a=WD_DEBUG.squadApi;return {over:WD_DEBUG.state().over,owned:a.ownsProvince('se_redriver'),counter:a.activeCounter()};});
 check('防衛に負けると領土を失い反撃を終了',r.over&&!r.owned&&!r.counter,r);
 await p.reload();check('失地後も章解放・発見を維持',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return !a.ownsProvince('se_redriver')&&a.chapterUnlocked('southeast')&&a.provinceDiscovered('se_redriver');}));
 await seed(p,{japan:true,korea:true,china:true,southeast:route});
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;for(const p of a.PROVINCE_ORDER){const id=a.PROVINCES[p].castle;if(id)a.conquest()[id].captured=false;}a.syncWorldProgress();a.persistConquest();});await p.reload();
 check('全領土を失っても章の制覇と遠方の発見は残る',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return a.conquestMeta().world.cleared.southeast&&a.provinceDiscovered('se_molucca');}));
 for(const failKey of [TKEY,CKEY,WKEY,SKEY]){
  await seed(p,{japan:true,korea:true,china:true,southeast:route.slice(0,-1),tickets:11});
  r=await p.evaluate(failKey=>{const a=WD_DEBUG.squadApi;a.setCounterRng(()=>1);a.setTarget('se_fort_molucca');a.startBattle();const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===failKey)throw Error('W4 simulated storage failure');return original.call(this,k,v);};try{a.endBattle('win');return document.getElementById('battleBody').textContent;}finally{Storage.prototype.setItem=original;}},failKey);
  if(failKey===TKEY)check('確定ログが書けないと未保存を表示',/未保存/.test(r));
  await p.reload();const after=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {owned:a.ownsProvince('se_molucca'),reward:!!a.conquestMeta().world.rewards.southeast,tickets:WD_DEBUG.heroApi.save().tickets};});
  check('章報酬の保存障害後に領土・受領印・券が整合：'+failKey,failKey===TKEY?!after.owned&&!after.reward&&after.tickets===11:after.owned&&after.reward&&after.tickets===23,after);
  if(failKey!==TKEY){await p.reload();check('復旧後も再取得しない：'+failKey,await tickets(p)===23);}
 }
 await seed(p,{world:{unlocked:{southeast:'yes'},cleared:{china:'yes'},discovered:{se_molucca:1}}});
 check('壊れたフラグで章や拠点を解放しない',await p.evaluate(()=>!WD_DEBUG.squadApi.chapterUnlocked('southeast')&&!WD_DEBUG.squadApi.provinceDiscovered('se_molucca')));
 check('ここまでJavaScriptエラーなし',errors.length===0,errors);await c.close();
 for(const width of [375,390,430,1280]){
  const {c,p}=await setup(width);await seed(p,{japan:true,korea:true,china:true});const click=sel=>width<600?p.locator(sel).tap():p.locator(sel).click();
  await click('#mapOpen');await click('[data-map-chapter="southeast"]');await click('[data-map-road="se_north"]');await click('[data-map-prov="se_redriver"]');
  check(width+'pxで世界・地域・拠点が画面内、ボタン44px以上',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('#mapBody button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)));
  if(process.env.SCREENSHOTS&&width===390){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.SCREENSHOTS,'w4-southeast-entry-390.png')});}await c.close();
 }
}finally{await browser.close();server.close();}
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);process.exitCode=failures?1:0;
