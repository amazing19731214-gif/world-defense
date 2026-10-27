#!/usr/bin/env node
// W1: 日本の難易度固定、対馬の初回条件と旧セーブ互換、敵Lv・装甲・装甲無視の実ダメージ。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.execPath,'../../lib/node_modules/playwright')));}
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/japan-v66.json',import.meta.url)));
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/?debug`;
const CKEY='worldDefense.conquest.v1',SKEY='worldDefense.soldiers.v1';
let passes=0,failures=0;const errors=[];
function check(name,ok,detail){ok?passes++:failures++;console.log((ok?'✓ ':'✗ ')+name+(!ok&&detail!==undefined?' '+JSON.stringify(detail):''));}
async function setup(width=390){
 const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true});
 await context.addInitScript(()=>{requestAnimationFrame=()=>0;Math.random=()=>0.5;});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);
 return {context,p};
}
async function seed(p,options={}){
 await p.evaluate(({options,CKEY,SKEY})=>{
  const a=WD_DEBUG.squadApi,captured=options.allExcept?a.JAPAN.filter(k=>!options.allExcept.includes(k)):(options.only||[]);
  const castles=Object.fromEntries(a.JAPAN.filter(k=>a.PROVINCES[k].castle).map(k=>[a.PROVINCES[k].castle,{captured:captured.includes(k),attempts:captured.includes(k)?2:0,wins:captured.includes(k)?1:0}]));
  if(options.wonTsushima)castles.kaneishi={captured:false,attempts:5,wins:2};
  localStorage.clear();
  localStorage.setItem(CKEY,JSON.stringify({version:options.version||2,castles,tenka:!!options.tenka,unified:true,target:options.target||null}));
  const types=['spearman','cavalry','archer','medic'];const save={seq:40,squadSeq:4,squads:[],soldiers:[],fallen:[]};
  for(let i=0;i<4;i++){
   save.squads.push({id:i+1,type:types[i],slot:i});
   for(let k=0;k<10;k++)save.soldiers.push({id:i*10+k+1,squadId:i+1,type:types[i],level:100});
  }
  localStorage.setItem(SKEY,JSON.stringify(save));
 },{options,CKEY,SKEY});await p.reload();
}
try{
 const {context,p}=await setup();
 const rows=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return a.JAPAN.filter(k=>a.PROVINCES[k].castle).map(k=>{const C=a.NPC_CASTLES[a.PROVINCES[k].castle];return {p:k,castle:a.PROVINCES[k].castle,level:a.recLevel(C),hp:C.hp,power:C.power};});});
 check('67城のID・推奨Lv・城HP・powerがv66と一致',JSON.stringify(rows)===JSON.stringify(baseline.rows));
 check('清洲城Lv5から金石城Lv335まで5刻み',rows.length===67&&rows.every((r,i)=>r.level===(i+1)*5));
 await seed(p,{only:['iki'],target:'kaneishi'});
 let r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {ready:a.tsushimaReady(),open:a.canAttackProvince('tsushima'),err:a.setTarget('kaneishi'),target:a.targetCastleId()};});
 check('壱岐だけの制圧では対馬を攻略できない',!r.ready&&!r.open&&/67か国/.test(r.err),r);
 check('保存済み目標を使っても対馬の条件を迂回しない',r.target!=='kaneishi',r);
 await p.locator('#mapOpen').tap();await p.locator('[data-map-chapter="japan"]').tap();await p.locator('[data-map-road="saikaido"]').tap();await p.locator('[data-map-prov="tsushima"]').tap();
 check('対馬の出陣ボタンは無効・解放条件を表示',await p.locator('[data-map-go="kaneishi"]').isDisabled()&&/対馬以外の日本67か国/.test(await p.locator('#mapBody').innerText()));
 check('条件を満たさない旧目標に攻略目標の印を表示しない',!((await p.locator('[data-map-prov="tsushima"]').innerText()).includes('🎯')));
 check('390pxで地図の横はみ出しなし',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.SCREENSHOTS,'w1-tsushima-locked.png')});}
 await seed(p,{allExcept:['tsushima','owari']});
 check('ほかに1か国でも未制圧なら対馬は開かない',await p.evaluate(()=>!WD_DEBUG.squadApi.canAttackProvince('tsushima')));
 await seed(p,{allExcept:['tsushima']});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {ready:a.tsushimaReady(),open:a.canAttackProvince('tsushima'),err:a.setTarget('kaneishi'),owned:a.JAPAN.filter(a.ownsProvince).length};});
 check('対馬以外67か国を制圧すると初回攻略が開く',r.owned===67&&r.ready&&r.open&&r.err===null,r);
 await p.evaluate(()=>WD_DEBUG.squadApi.startBattle());
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi,B=a.battle(),C=a.NPC_CASTLES.kaneishi;return {lv:B.enemyLevel,guards:B.garrison.map(e=>({kind:e.kind,lv:e.lv,hp:e.max,attack:e.attack,armor:e.armor})),tower:B.towers[0].damage,expectedTower:C.towers[0].damage*C.power};});
 check('敵Lv335をすべての守備兵に設定し、HP・攻撃・装甲が有効',r.lv===335&&r.guards.every(e=>e.lv===335&&e.hp>0&&e.attack>0&&e.armor>0),r);
 check('NPC塔の攻撃もレベルから算出した強さを反映',r.tower===r.expectedTower,r);
 const byKind=Object.fromEntries(r.guards.map(e=>[e.kind,e.armor]));
 check('槍兵は足軽・弓兵より装甲が高い',byKind.knight>byKind.goblin&&byKind.knight>byKind.dragon,byKind);
 r=await p.evaluate(()=>{
  const a=WD_DEBUG.squadApi,B=a.battle(),e=B.garrison.find(e=>e.kind==='knight'),s=B.groups[0].list[0];
  const hit=()=>{const before=e.hp;a.battleHitGarrison(e,100,s);return before-e.hp;};
  s.skills=[];const normal=hit(),armor=e.armor;
  const id=Object.keys(a.SOLDIER_SKILLS).find(id=>a.SOLDIER_SKILLS[id].armorPierce>0);s.skills=[id];const skill=hit();s.skills=[];
  const F=WD_DEBUG.forgeApi;F.save().items.push({uid:'w1-pierce',id:'tonbokiri',owner:s.id,lock:true});F.refreshGear();const gear=hit();
  s.skills=[id];const both=hit();
  return {normal,skill,gear,both,expected:100*30/(30+armor)};
 });
 check('通常攻撃の実ダメージへ装甲が1回だけ反映',r.normal<100&&Math.abs(r.normal-r.expected)<1e-8,r);
 check('貫通スキル・蜻蛉切の装甲無視が実ダメージを増やす',r.skill>r.normal&&r.gear>r.normal&&r.both>r.skill&&r.both>r.gear,r);
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;const kinds=['goblin','knight','dragon','wolf','boss'];return {base:kinds.map(k=>a.siegeEnemyStats(k,5)),high:kinds.map(k=>a.siegeEnemyStats(k,8000))};});
 check('清洲城Lv5の装甲は全兵種0で初戦の難度を維持',r.base.every(e=>e.armor===0));
 check('高レベルでも装甲は上限30・ダメージが0にならない',r.high.every(e=>Number.isFinite(e.max)&&e.attack>0&&e.armor<=30));
 // 単体の近接攻撃を1回だけ起こし、実際のtickBattleでも軽減されることを確認。
 await seed(p,{allExcept:[]});
 r=await p.evaluate(()=>{
  const a=WD_DEBUG.squadApi;a.setTarget('kaneishi');a.startBattle();const B=a.battle(),g=B.groups[0],e=B.garrison.find(e=>e.kind==='knight');
  B.nextUnit=4;B.towers=[];B.garrison=[e];for(const o of B.groups)o.state='wait';g.state='fight';g.d=e.d;g.x=e.x;g.y=e.y;
  for(const o of g.list)o.cd=999;const s=g.list[0];s.cd=0;e.cd=999;const raw=a.soldierStats(s,true).atk,before=e.hp;
  WD_DEBUG.step(0.05);return {raw,damage:before-e.hp,armor:e.armor};
 });
 check('実際の戦闘進行でも装甲による軽減を確認',r.damage>0&&r.damage<r.raw,r);
 await seed(p,{only:['iki'],wonTsushima:true});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {open:a.canAttackProvince('tsushima'),record:a.conquest().kaneishi};});
 check('過去に制圧した対馬は失地後も再攻略でき、勝利記録を維持',r.open&&r.record.wins===2&&r.record.attempts===5,r);
 await seed(p,{only:['tsushima'],version:1});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {own:a.ownsProvince('tsushima'),err:a.setTarget('kaneishi')};});
 check('旧version1で対馬だけ制圧済みでも取り消さず演習可能',r.own&&r.err===null,r);
 await seed(p,{only:['iki'],tenka:true});
 check('天下統一達成済みの旧セーブは追加条件で締め出さない',await p.evaluate(()=>WD_DEBUG.squadApi.canAttackProvince('tsushima')));
 await seed(p,{allExcept:[],tenka:true});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.setTarget('kaneishi');return {n:a.JAPAN.filter(a.ownsProvince).length,tenka:a.isTenka(),stored:JSON.parse(localStorage.getItem('worldDefense.conquest.v1')),levels:a.JAPAN.filter(k=>a.PROVINCES[k].castle).map(k=>a.recLevel(a.NPC_CASTLES[a.PROVINCES[k].castle]))};});
 check('全68か国制圧・天下統一・保存形式version2を維持',r.n===68&&r.tenka&&r.stored.version===2&&r.stored.tenka,r);
 await p.reload();check('再読み込みでも推奨Lvと制圧が変わらない',JSON.stringify(r.levels)===JSON.stringify(await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return a.JAPAN.filter(k=>a.PROVINCES[k].castle).map(k=>a.recLevel(a.NPC_CASTLES[a.PROVINCES[k].castle]));})));
 await p.locator('#siege').tap();check('攻城編成に敵Lv335を表示',/敵Lv335/.test(await p.locator('#siegeTarget').innerText()));
 check('JavaScriptエラーなし',errors.length===0,errors);
 await context.close();
}finally{await browser.close();server.close();}
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);process.exitCode=failures?1:0;
