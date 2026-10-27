#!/usr/bin/env node
// W2: 世界→章→地域→拠点、霧、旧セーブ、海外8拠点、初回報酬と保存障害。
// 進行テストではendBattleで勝敗を指定する。攻略難度は別の模擬戦で検証する。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.execPath,'../../lib/node_modules/playwright')));}
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/?debug`,CKEY='worldDefense.conquest.v1',WKEY='worldDefense.warlords.v1',SKEY='worldDefense.soldiers.v1',TKEY='worldDefense.bookTransaction.v1';
let passes=0,failures=0;const errors=[];
function check(n,ok,d){ok?passes++:failures++;console.log((ok?'✓ ':'✗ ')+n+(!ok&&d!==undefined?' '+JSON.stringify(d):''));}
async function setup(width=390){const c=await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});await c.addInitScript(()=>{requestAnimationFrame=()=>0;Math.random=()=>0.5;});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(url);return {c,p};}
async function seed(p,o={}){
 await p.evaluate(({o,CKEY,WKEY,SKEY})=>{
  const a=WD_DEBUG.squadApi;localStorage.clear();
  const castles={};for(const id of a.JAPAN){const k=a.PROVINCES[id].castle;if(k)castles[k]={captured:!!o.japan,wins:o.japan?1:0,attempts:o.japan?1:0};}
  localStorage.setItem(CKEY,JSON.stringify({version:2,castles,unified:!!o.japan,tenka:!!o.tenka,world:o.world,bosses:o.bosses||{}}));
  localStorage.setItem(WKEY,JSON.stringify({version:1,owned:{},tickets:0,history:[]}));
  const types=['spearman','cavalry','archer','medic'],save={seq:40,squadSeq:4,squads:[],soldiers:[],fallen:[]};
  for(let q=1;q<=4;q++){save.squads.push({id:q,type:types[q-1],slot:q-1});for(let k=0;k<10;k++)save.soldiers.push({id:(q-1)*10+k+1,type:types[q-1],squadId:q,level:600});}
  localStorage.setItem(SKEY,JSON.stringify(save));
 },{o,CKEY,WKEY,SKEY});await p.reload();
}
const tickets=p=>p.evaluate(()=>WD_DEBUG.heroApi.save().tickets);
async function fight(p,id,result='win'){
 return p.evaluate(({id,result})=>{const a=WD_DEBUG.squadApi;a.setCounterRng(()=>1);const e=a.setTarget(a.PROVINCES[id].castle);if(e)return {error:e};const s=a.startBattle();if(s)return {error:s};const B=a.battle(),lv=B.enemyLevel;a.endBattle(result);return {lv,body:document.getElementById('battleBody').textContent,tickets:WD_DEBUG.heroApi.save().tickets,owned:a.ownsProvince(id)};},{id,result});
}
try{
 const {c,p}=await setup();
 await p.locator('#mapOpen').tap();
 check('メニューから世界の3章カードが開く',/世界/.test(await p.locator('#mapTitle').innerText())&&await p.locator('[data-map-chapter]').count()===3);
 check('最初の海外章は？？？・解放条件付きで無効',await p.locator('[data-map-chapter="korea"]').isDisabled()&&/？？？/.test(await p.locator('[data-map-chapter="korea"]').innerText()));
 let r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return {n:a.PROVINCE_ORDER.length,japan:a.JAPAN.length,korea:a.chapterProvinces('korea').length,error:a.setTarget('kr_busan')};});
 check('日本68＋朝鮮8＋中国20＝96拠点、未解放の章はAPIからも出陣不可',r.n===96&&r.japan===68&&r.korea===8&&/解放/.test(r.error),r);
 await p.locator('[data-map-chapter="japan"]').tap();
 check('日本の全国画面と秘境への導線を維持',/全国 1\/68/.test(await p.locator('#mapTitle').innerText())&&await p.locator('[data-map-tab="secret"]').isVisible());
 await seed(p,{japan:true,tenka:true});
 check('旧版の天下統一セーブから海外章を解放',await p.evaluate(()=>WD_DEBUG.squadApi.chapterUnlocked('korea')));
 check('世界画面を開くだけで報酬は付かない',await tickets(p)===0);
 await p.locator('#mapOpen').tap();await p.locator('[data-map-chapter="korea"]').tap();
 check('朝鮮半島の地域画面が開く',/朝鮮半島 0\/8/.test(await p.locator('#mapTitle').innerText()));
 check('海外の地域選択に日本地図用の空白行を残さない',(await p.locator('.foreign-road-map').boundingBox()).height<=100);
 await p.locator('[data-map-road="kr_north"]').tap();
 let text=await p.locator('#mapBody').innerText();
 check('未発見の拠点は名前・城名を隠す',/？？？/.test(text)&&!/暁の北城|咸鏡|金波城/.test(text),text);
 check('未発見拠点はAPIからも選べない',/発見/.test(await p.evaluate(()=>WD_DEBUG.squadApi.setTarget('kr_dawn'))));
 await p.locator('[data-map-road="kr_south"]').tap();await p.locator('[data-map-prov="kr_gyeongsang"]').tap();
 check('入口は発見済み、敵Lv350と出陣ボタンを表示',/敵Lv350/.test(await p.locator('#mapBody').innerText())&&!await p.locator('[data-map-go="kr_busan"]').isDisabled());
 check('390pxで世界・地域・詳細が横にはみ出さない',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.waitForTimeout(2500);await p.screenshot({path:path.join(process.env.SCREENSHOTS,'w2-korea-entry-390.png')});}
 r=await fight(p,'kr_gyeongsang');
 check('入口の攻略で海外領土1/8と初回券1枚',!r.error&&r.owned&&r.lv===350&&r.tickets===1&&/領土 1\/8拠点/.test(r.body),r);
 check('海外攻略で日本の統一報酬を再取得しない',!/7か国を統一|天下統一！/.test(r.body),r.body);
 check('入口制圧で隣の拠点を発見',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return a.provinceDiscovered('kr_jeolla')&&a.provinceDiscovered('kr_chungcheong')&&a.provinceDiscovered('kr_gangwon')&&!a.provinceDiscovered('kr_hamgyeong');}));
 await fight(p,'kr_gangwon');
 check('進軍すると北側の新しい拠点を発見',await p.evaluate(()=>WD_DEBUG.squadApi.provinceDiscovered('kr_hamgyeong')));
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;for(const id of a.PROVINCE_ORDER){const k=a.PROVINCES[id].castle;if(k)a.conquest()[k].captured=false;}a.syncWorldProgress();a.persistConquest();});
 await p.reload();
 check('全領土を失っても解放章・発見履歴は残る',await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return a.chapterUnlocked('korea')&&a.provinceDiscovered('kr_hamgyeong');}));
 check('領土を失えば隣接条件を満たすまで攻略できない',await p.evaluate(()=>!WD_DEBUG.squadApi.canAttackProvince('kr_gyeongsang')));
 await seed(p,{japan:true,tenka:true});
 const bonusBefore=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return [a.startGold(),a.territoryBonus('waveGold'),a.territoryBonus('hire'),a.territoryBonus('repair')];});
 const route=['kr_gyeongsang','kr_jeolla','kr_chungcheong','kr_gyeonggi','kr_gangwon','kr_hwanghae','kr_pyeongan','kr_hamgyeong'];
 for(const id of route){r=await fight(p,id);check(id+'へ順に進軍できる',!r.error&&r.owned,r);}
 check('8拠点制覇で初回城報酬9＋章報酬5枚を付与',r.tickets===14&&/朝鮮半島を制覇/.test(r.body),r);
 check('章制覇と報酬受領を保存',await p.evaluate(()=>{const w=WD_DEBUG.squadApi.conquestMeta().world;return w.cleared.korea&&w.rewards.korea;}));
 await p.reload();check('再読み込みで章報酬が増えない',await tickets(p)===14);
 r=await fight(p,'kr_gyeongsang');check('演習では初回報酬を繰り返さない',r.tickets===14,r);
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.conquest().kr_busan.captured=false;a.persistConquest();});
 r=await fight(p,'kr_gyeongsang');check('失地後の再制圧でも初回報酬を繰り返さない',r.tickets===14,r);
 check('海外制圧で日本の領土ボーナスを増やさない',JSON.stringify(bonusBefore)===JSON.stringify(await p.evaluate(()=>{const a=WD_DEBUG.squadApi;return [a.startGold(),a.territoryBonus('waveGold'),a.territoryBonus('hire'),a.territoryBonus('repair')];})));
 await p.evaluate(()=>{const a=WD_DEBUG.squadApi;for(const p of a.chapterProvinces('korea'))a.conquest()[a.PROVINCES[p].castle].captured=p==='kr_gyeongsang';a.conquestMeta().counter=null;a.setCounterRng(()=>0);});
 r=await p.evaluate(()=>WD_DEBUG.squadApi.maybeCounter('korea'));
 check('海外の反撃は同じ章内だけ',!!r&&r.from.startsWith('kr_')&&r.province.startsWith('kr_'),r);
 await seed(p,{japan:true,tenka:true,bosses:{hiei:{wins:2},yomi:{wins:2},fuji:{wins:2},orochi:{wins:3,attempts:4,first:100,best:50}}});
 r=await p.evaluate(()=>{const a=WD_DEBUG.squadApi;a.persistConquest();return {boss:a.conquestMeta().bosses.orochi,stored:JSON.parse(localStorage.getItem('worldDefense.conquest.v1')).bosses.orochi,unlocked:WD_DEBUG.legendApi.endgameOn()};});
 check('最終ボス討伐記録と終盤解放を世界保存後も維持',r.boss?.wins===3&&r.stored?.wins===3&&r.unlocked,r);
 await seed(p,{world:{unlocked:{korea:'yes'},discovered:{kr_hamgyeong:7},cleared:{korea:'yes'},rewards:{korea:'yes'}}});
 check('壊れた世界フラグを解放・発見として扱わない',await p.evaluate(()=>!WD_DEBUG.squadApi.chapterUnlocked('korea')&&!WD_DEBUG.squadApi.provinceDiscovered('kr_hamgyeong')));
 for(const failKey of [TKEY,CKEY,WKEY,SKEY]){
  await seed(p,{japan:true,tenka:true});
  r=await p.evaluate(failKey=>{
   const a=WD_DEBUG.squadApi;a.setCounterRng(()=>1);a.setTarget('kr_busan');a.startBattle();
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(k===failKey)throw Error('W2 simulated save failure');return original.call(this,k,v);};
   try{a.endBattle('win');return {body:document.getElementById('battleBody').textContent};}finally{Storage.prototype.setItem=original;}
  },failKey);
  if(failKey===TKEY)check('確定ログを保存できないと未保存を表示',/未保存/.test(r.body),r);
  await p.reload();
  const after=await p.evaluate(()=>({owned:WD_DEBUG.squadApi.ownsProvince('kr_gyeongsang'),tickets:WD_DEBUG.heroApi.save().tickets}));
  check('保存失敗後に進捗・報酬が整合: '+failKey,failKey===TKEY?!after.owned&&after.tickets===0:after.owned&&after.tickets===1,after);
 }
 check('JavaScriptエラーなし',errors.length===0,errors);await c.close();
 for(const width of [375,430,1280]){
  const {c,p}=await setup(width);await seed(p,{japan:true,tenka:true});
  if(width<600){await p.locator('#mapOpen').tap();await p.locator('[data-map-chapter="korea"]').tap();}
  else{await p.locator('#mapOpen').click();await p.locator('[data-map-chapter="korea"]').click();}
  check(width+'pxで章カードと地域ボタンが収まる',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('#mapBody button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)));
  await c.close();
 }
}finally{await browser.close();server.close();}
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);process.exitCode=failures?1:0;
