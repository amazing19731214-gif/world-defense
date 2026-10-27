// 武将の永続育成・30人の成長・自然回復・保存の統合試験。戦闘条件は独立したテスト用セーブ。
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), {chromium} = require('playwright');
const server = http.createServer((req,res) => { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(readFileSync(new URL('../index.html',import.meta.url))); });
await new Promise(r => server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
const url=`http://127.0.0.1:${server.address().port}/?debug`, W='worldDefense.warlords.v1', S='worldDefense.soldiers.v1';
let checks=0; const errors=[];
function check(ok,message){assert.ok(ok,message); checks++; console.log('✓ '+message);}
async function setup(width=390){
 const ctx=await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});
 await ctx.addInitScript(()=>window.requestAnimationFrame=()=>0);
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await page.waitForFunction(()=>window.WD_DEBUG);
 await page.evaluate(({W,S})=>{
  const ids=Object.keys(WD_DEBUG.config.WARLORDS);localStorage.clear();
  localStorage.setItem(W,JSON.stringify({owned:Object.fromEntries(ids.map(id=>[id,1])),tickets:9}));
  localStorage.setItem(S,JSON.stringify({seq:30,squadSeq:3,squads:['ashigaru','archer','medic'].map((type,i)=>({id:i+1,type,slot:i})),soldiers:Array.from({length:30},(_,i)=>({id:i+1,type:['ashigaru','archer','medic'][Math.floor(i/10)],squadId:Math.floor(i/10)+1,level:10})),fallen:[]}));
 },{W,S});await page.reload();
 await page.evaluate(()=>{const D=WD_DEBUG;D.setGold(999999);for(const [i,q] of D.state().squads.entries())D.squadApi.deployReserve(q,570+i*90,300);window.F={D,A:D.heroApi,Q:D.squadApi};});
 return {ctx,page};
}
try {
 const {ctx,page}=await setup();
 let r=await page.evaluate(()=>{const {A}=F;return Object.keys(WD_DEBUG.config.WARLORDS).map(id=>({id,lv:A.warlordLevel(id).level,g:A.warlordGrowth(id)}));});
 check(r.length===30&&r.every(x=>x.lv===1&&Object.values(x.g).every(v=>v===0)),'旧セーブの全30人がLv1・成長補正0から起動');
 r=await page.evaluate(()=>{const {D,A,Q}=F;const q=D.state().squads[0],m=Q.members(q)[0];const t={id:77,type:'arrow',level:1,x:600,y:210,spent:100};D.state().towers.push(t);t.hp=D.towerApi.towerMaxHp(t);window.T=t;return Object.keys(D.config.WARLORDS).map(id=>{A.assignHero(id,q);const base=Q.soldierStats(m);const old=A.warlordCooldown(id);A.gainWarlordXp(id,A.WARLORD_XP_TOTAL[9999]);const high=Q.soldierStats(m),growth=A.warlordGrowth(id);const lv=A.warlordLevel(id);A.assignHero(id,t);const tower=D.towerStats?D.towerStats(t):null;A.unassignHero(id);return {id,base,high,growth,level:lv.level,need:lv.need,cd:A.warlordCooldown(id),old};});});
 for(const v of r)check(v.level===9999&&v.need===0&&v.cd>=v.old*.899&&v.cd<v.old&&v.high.maxHp>=v.base.maxHp&&v.high.range>=v.base.range&&v.high.atk>=v.base.atk&&Object.values(v.growth).every(Number.isFinite),v.id+'：上限・個別成長・必殺技短縮は有限で上限内');
 r=await page.evaluate(()=>{const {D,A,Q}=F,q=D.state().squads[0],m=Q.members(q)[0];A.assignHero('yukimura',q);m.hp=7;const a=m.hp;A.unassignHero('yukimura');A.assignHero('yukimura',q);return {a,hp:m.hp,max:Q.soldierStats(m).maxHp,base:Q.soldierStats(m,true).maxHp};});
 check(r.a===r.hp&&r.max>r.base,'高Lvタンクの再配属で現在HPは回復しない');
 r=await page.evaluate(()=>{const {D,A,Q}=F,q=D.state().squads[0],m=Q.members(q)[0];A.save().warlordProgress.yukimura=0;m.hp=Q.soldierStats(m).maxHp/2;A.gainWarlordXp('yukimura',A.WARLORD_XP_TOTAL[100]);return m.hp/Q.soldierStats(m).maxHp;});
 check(Math.abs(r-.5)<1e-9,'Lv上昇による最大HP増加は現在HP割合を維持');
 r=await page.evaluate(()=>{const {D,A,Q}=F,[q,other]=D.state().squads;for(const id of Object.keys(D.config.WARLORDS)){A.unassignHero(id);A.save().warlordProgress[id]=0;}A.assignHero('kanetsugu',q);const m=Q.members(q)[0],o=Q.members(other)[0],dead=Q.members(q)[1];dead.alive=false;dead.hp=0;m.hp=10;o.hp=10;T.hp=10;const max=Q.soldierStats(m).maxHp;A.tickWarlordRegen(1);return {heal:m.hp-10,max,other:o.hp,dead:dead.hp,tower:T.hp,medic:Q.soldierStats(D.state().soldiers[20]).heal,base:Q.soldierStats(D.state().soldiers[20],true).heal};});
 check(Math.abs(r.heal-r.max*.01)<1e-8&&r.other===10&&r.dead===0&&r.tower===10,'兼続：配属した部隊だけ毎秒1%自然回復・戦死者は復活しない');
 check(r.medic===r.base,'兼続は衛生兵の回復量を増幅しない');
 r=await page.evaluate(()=>{const {D,A,Q}=F,q=D.state().squads[0];A.assignHero('kanetsugu',T);T.hp=10;const max=D.towerApi.towerMaxHp(T);A.tickWarlordRegen(1);A.assignHero('hideyoshi',q);const m=Q.members(q)[0];m.hp=10;T.hp=10;const tm=D.towerApi.towerMaxHp(T),max2=Q.soldierStats(m).maxHp;A.tickWarlordRegen(1);return {max,alone:max*.01,healedTower:T.hp-10,tm,heal:m.hp-10,max2};});
 check(Math.abs(r.healedTower-r.tm*.015)<1e-8&&Math.abs(r.heal-r.max2*.005)<1e-8,'秀吉：配属先を中心に兵士と塔を回復、兼続の塔回復と合算');
 r=await page.evaluate(()=>{const {D,A,Q}=F,q=D.state().squads[0];A.assignHero('kanetsugu',q);A.assignHero('hideyoshi',T);A.save().warlordProgress.kanetsugu=A.WARLORD_XP_TOTAL[9999];A.save().warlordProgress.hideyoshi=A.WARLORD_XP_TOTAL[9999];const m=Q.members(q)[0];m.hp=10;A.tickWarlordRegen(1);return {heal:m.hp-10,max:Q.soldierStats(m).maxHp};});
 check(Math.abs(r.heal-r.max*.025)<1e-8,'最大Lvの自然回復の重複は毎秒2.5%で頭打ち');
 r=await page.evaluate(()=>{const {D,A,Q}=F,q=D.state().squads[0];const m=Q.members(q)[0];A.assignHero('kenshin',q);A.save().warlordProgress.kenshin=A.WARLORD_XP_TOTAL[9999];m.hp=50;const rand=Math.random;Math.random=()=>.01;Q.damageSquad(q,10,false);Math.random=rand;const unit=m.hp===50;A.assignHero('kenshin',T);T.hp=50;Math.random=()=>.01;D.towerApi.damageTower(T,10);Math.random=rand;return {unit,tower:T.hp===50};});
 check(r.unit&&r.tower,'謙信のLv回避は部隊と塔の被弾計算に反映');
 r=await page.evaluate(()=>{const {D,A,Q}=F,q=D.state().squads[0];for(const h of Object.values(A.heroState())){h.waveSeconds=0;A.unassignHero(h.id);}A.save().warlordProgress.nobunaga=0;A.assignHero('nobunaga',q);A.tickHeroes(10);A.awardWarlordWaveXp();const first=A.warlordLevel('nobunaga').total;A.awardWarlordWaveXp();A.tickHeroes(10);A.awardWarlordWaveXp();A.persistHeroes();return {first,second:A.warlordLevel('nobunaga').total,lv:A.warlordLevel('nobunaga').level,unassigned:A.warlordLevel('masanori').total};});
 check(r.first===20&&r.second===40&&r.lv===2&&r.unassigned===0,'配属して戦った武将のみ経験値・二重配布なし・2ウェーブでLv2');
 await page.reload();
 check(await page.evaluate(()=>WD_DEBUG.heroApi.warlordLevel('nobunaga').level===2),'Lvと経験値を再読み込み後も保持');
 r=await page.evaluate(()=>{const D=WD_DEBUG,A=D.heroApi;A.injureHero(A.heroState().nobunaga);return {level:A.warlordLevel('nobunaga').level,inj:!!A.injuryOf('nobunaga')};});
 check(r.level===2&&r.inj,'負傷しても武将Lvはリセットしない');
 await ctx.close();
 // Siege: separate hero allocation; regeneration and growth use the siege group.
 const siege=await setup();
 r=await siege.page.evaluate(()=>{const {D,A,Q}=F;Q.siegeSetHero(0,'kanetsugu');Q.siegeSetHero(1,'hideyoshi');const error=Q.startBattle();if(error)throw Error(error);const b=Q.battle();b.groups.forEach((g,i)=>{g.state='fight';g.x=600+i*20;g.y=300;});const g=b.groups[0],m=g.list[0],max=Q.battleStats(g,m).maxHp;m.hp=10;A.tickWarlordRegen(1,true);const healed=m.hp-10;b.soulEat=true;A.tickWarlordRegen(1,true);const stopped=m.hp-10===healed;b.soulEat=false;A.save().warlordProgress.kanetsugu=A.WARLORD_XP_TOTAL[100];g.warlordSeconds=30;Q.endBattle('win');const total=A.warlordLevel('kanetsugu').total;Q.endBattle('win');return {healed,max,stopped,total,again:A.warlordLevel('kanetsugu').total};});
 check(Math.abs(r.healed-r.max*.015)<1e-8&&r.stopped,'攻城戦でも兼続・秀吉の自然回復が働き、魂喰いでは停止');
 check(r.total===r.again,'攻城戦の結果を再度処理しても武将経験値を二重配布しない');
 await siege.page.reload();
 check(await siege.page.evaluate(()=>WD_DEBUG.heroApi.warlordLevel('kanetsugu').level>=100),'攻城戦で得た武将経験値を保存');
 // UI: actual touch interaction with seeded hero roster (no hidden UI bypass).
 await siege.page.locator('#roster').click();
 check(await siege.page.locator('[data-warlord-level]').count()===30,'武将一覧に全30人のLv・経験値・成長内容を表示');
 check(await siege.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'iPhone相当390pxで横はみ出しなし');
 if(process.env.SCREENSHOTS){mkdirSync(process.env.SCREENSHOTS,{recursive:true});await siege.page.screenshot({path:process.env.SCREENSHOTS+'/warlord-levels-390.png'});}
 await siege.ctx.close();
 for(const width of [375,1280]){const v=await setup(width);await v.page.locator('#roster').click();check(await v.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'幅'+width+'pxで一覧が画面内に収まる');await v.ctx.close();}
 // War loans are never granted for an unfinished checkpoint or a failed precommit write.
 for(const failure of ['worldDefense.bookTransaction.v1',W,S]){
  const v=await setup();
  const before=await v.page.evaluate(()=>{const {D,A}=F;A.save().warlordProgress.nobunaga=20;A.assignHero('nobunaga',D.state().squads[0]);D.defenseApi.save();return D.state().wave;});
  await v.page.evaluate(failure=>{const {D,A}=F;document.getElementById('start').click();D.stopSpawning();A.tickHeroes(10);const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,val){if(k===failure)throw Error('injected save failure');return set.call(this,k,val);};D.step(.1);Storage.prototype.setItem=set;},failure);
  await v.page.reload();
  const r=await v.page.evaluate(()=>({xp:WD_DEBUG.heroApi.warlordLevel('nobunaga').total,wave:WD_DEBUG.state().wave}));
  check(failure==='worldDefense.bookTransaction.v1'?r.xp===20&&r.wave===before:r.xp===40&&r.wave===before+1,'武将XPとウェーブが保存障害でも一致：'+failure);
  await v.ctx.close();
 }
 {
  const v=await setup();await v.page.evaluate(W=>{const save=JSON.parse(localStorage.getItem(W));save.warlordProgress={nobunaga:1e99,shingen:-1,kenshin:'40',unknown:999};localStorage.setItem(W,JSON.stringify(save));},W);await v.page.reload();
  check(await v.page.evaluate(()=>{const A=WD_DEBUG.heroApi;return A.warlordLevel('nobunaga').level===9999&&A.warlordLevel('shingen').level===1&&A.warlordLevel('kenshin').level===1&&!('unknown' in A.save().warlordProgress);}), '不正な武将経験値・未知IDを補正し、他の所持データを維持');
  await v.ctx.close();
 }
 check(errors.length===0,'JavaScriptエラーなし：'+errors.join(','));
 console.log('結果: '+checks+' 件成功 / 0 件失敗');
} finally {await browser.close();await new Promise(r=>server.close(r));}
