#!/usr/bin/env node
// v17: role-based passives, actual combat effects, targeting, economy and lifecycle.
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs';
const require=createRequire(import.meta.url);let chromium;
try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.execPath,'../../lib/node_modules/playwright')));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
let passed=0,failed=0;const errorLog=[];
function check(name,ok,detail=''){console.log((ok?'✓ ':'✗ ')+name+(ok?'':' '+JSON.stringify(detail)));if(ok)passed++;else failed++;}
const ids=['nobunaga','shingen','kenshin','motoyasu','hideyoshi','yukimura','kanetsugu','masamune','tadakatsu','mitsuhide','mitsunari','yoshihiro','motochika','kiyomasa','hanbei','muneshige','kanbei','motonari','keiji','ujiyasu','masanori','kansuke','yoshiaki','yoshikage','dosan','yoshikata','haruhisa','sorin','takanobu','terumoto'];
let context,page;
async function setup(id,mode='squad',type=null){
 if(context)await context.close();
 context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 await context.addInitScript((ids)=>{localStorage.setItem('worldDefense.warlords.v1',JSON.stringify({owned:Object.fromEntries(ids.map(id=>[id,1])),tickets:3,history:[]}));window.requestAnimationFrame=()=>0;},ids);
 page=await context.newPage();page.on('pageerror',e=>errorLog.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(pathToFileURL(path.join(root,'index.html')).href+'?debug');
 await page.waitForFunction(()=>window.WD_DEBUG);
 await page.evaluate(({id,mode,type})=>{
  const D=WD_DEBUG,A=D.heroApi,S=D.squadApi,W=D.config.WARLORDS;
  D.setGold(99999);document.getElementById('start').click();D.stopSpawning();D.addEnemy({hp:1e9,speed:0,unitCd:1e9});
  const q=S.hireSquad(type||W[id].favorite||'ashigaru',650,300),other=S.hireSquad('ashigaru',740,300);
  const t={id:1,x:650,y:220,type:'arrow',level:1,cd:1e9,spent:100};D.state().towers.push(t);t.hp=D.towerApi.towerMaxHp(t);
  const e=D.addEnemy({d:834,hp:100000,speed:0,unitCd:1e9}),h=A.heroState()[id];
  A.assignHero(id,mode==='squad'?q:t);
  for(const m of D.state().soldiers)m.cd=1e9;
  window.F={D,A,S,W,q,other,t,e,h};
 },{id,mode,type});
}
async function run(id,fn,mode='squad',type=null){await setup(id,mode,type);return await page.evaluate(fn);}
try{
 // Every configured skill requires a legal target and must work at both postings.
 for(const mode of ['squad','tower'])for(const id of ids){
  const r=await run(id,()=>{const {A,W,h,e,q,other,t,S}=F;S.members(q)[0].hp*=.5;const target=W[h.id].skill.target;const input=target==='enemy'?{enemy:e}:target==='ally'?{ally:other}:target==='heal'?{heal:S.members(q)[0]}:target==='road'?{point:{x:620,y:300}}:undefined;const ok=A.useSkill(h,input);return {ok,cd:h.cd,expect:W[h.id].skill.cooldown};},mode);
  check(id+' / '+mode+'で合法対象に必殺技を発動',r.ok&&r.cd===r.expect,r);
 }
 let r=await run('nobunaga',()=>{const {A,S,q,h,e,D}=F;const rate=S.soldierStats(S.members(q)[0]).rate;A.useSkill(h,{enemy:e});D.step(1.2);return {rate,damage:100000-e.hp,pulses:h.pulses};});
 check('信長：鉄砲兵の装填短縮と3回の集中射撃',r.rate<2.1&&r.damage>100&&r.pulses===3,r);
 r=await run('nobunaga',()=>{const {A,h,t,e}=F;for(let i=0;i<4;i++)A.afterTowerFire(t,e,100);return 100000-e.hp;},'tower');check('信長：塔の4回目だけ追加射撃',r===60,r);
 r=await run('shingen',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0],def=S.soldierStats(m).def,atk=S.soldierStats(m).atk;A.useSkill(h);const attack=S.soldierStats(m).atk;D.step(4.1);const guard=A.heroGuard(m,false);for(const n of S.members(q))n.hp=10;D.step(4.2);const hp=S.members(q)[0].hp;return {def,atk,attack,guard,hp};});check('信玄：人数防御、攻撃→防御→回復の三段階',r.def>12&&r.attack>r.atk&&r.guard<1&&r.hp>10,r);
 r=await run('kenshin',()=>{const {A,S,q,h,D}=F;const first=S.members(q)[0];first.hp=1;D.step(4.1);const rotated=S.members(q)[0].id!==first.id;A.useSkill(h);D.step(.5);return {rotated,damage:100000-F.e.hp,debuff:F.e.attackDebuff};});check('謙信：先頭交代と敵の攻撃力低下',r.rotated&&r.damage>0&&r.debuff===.2,r);
 r=await run('kenshin',()=>{const {A,h,t,D}=F;D.step(8.1);return [A.heroGuard(t,false),A.heroGuard(t,false)];},'tower');check('謙信：守りは被弾1回で消費',r[0]===.5&&r[1]===1,r);
 r=await run('motoyasu',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0];A.useSkill(h);S.damageSquad(q,1e6,false);const once=m.alive&&m.hp===1;A.unassignHero(h.id);A.assignHero(h.id,q);S.damageSquad(q,1e6,false);return {once,dead:!m.alive,cd:h.cd};});check('元康：致命傷を1回だけ耐え、再配属で復活・再付与しない',r.once&&r.dead&&r.cd>0,r);
 r=await run('hideyoshi',()=>{const {A,S,q,h,other,D}=F;const m=S.members(other)[0];m.hp=10;const max=S.soldierStats(m).maxHp;A.useSkill(h);return {hp:m.hp,max,state:other.state,cd:h.cd};});check('秀吉：周囲の生存兵を即時25%回復し部隊を撤退させない',Math.abs(r.hp-Math.min(r.max,10+r.max*.25))<.001&&r.state==='deployed'&&r.cd===45,r);
 r=await run('yukimura',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0],st=S.soldierStats(m),base=S.soldierStats(m,true);m.hp=10;A.useSkill(h);const guard=A.heroGuard(m,false);D.step(1);return {max:st.maxHp,base:base.maxHp,def:st.def,baseDef:base.def,hp:m.hp,guard};});check('幸村：HP+30%・防御+20%、必殺技で軽減と継続回復',r.max===Math.round(r.base*1.3)&&Math.abs(r.def/r.baseDef-1.2)<1e-8&&r.hp>10&&r.guard===.5,r);
 r=await run('yukimura',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0];m.hp=10;A.unassignHero('yukimura');A.assignHero('yukimura',q);const first=m.hp;m.hp=S.soldierStats(m).maxHp;A.unassignHero('yukimura');const clamped=m.hp;A.assignHero('yukimura',q);A.useSkill(h);D.step(9);return {first,clamped,base:S.soldierStats(m,true).maxHp,hp:m.hp,max:S.soldierStats(m).maxHp,guard:A.heroGuard(m,false)};});check('幸村：再配属で無料回復せず、解除でHP上限を守り必殺技は終了',r.first===10&&r.clamped===r.base&&r.hp<=r.max&&r.guard===1,r);
 r=await run('yukimura',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0],dead=S.members(q)[1];m.hp=10;dead.alive=false;dead.hp=0;A.useSkill(h);document.getElementById('pause').click();D.step(1);const paused=m.hp;document.getElementById('pause').click();D.step(1);return {paused,hp:m.hp,dead:dead.hp,alive:dead.alive};});check('幸村：停止中は回復せず、戦死者を復活させない',r.paused===10&&r.hp>10&&r.dead===0&&!r.alive,r);
 r=await run('kanetsugu',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0],patient=S.members(F.other)[0];patient.hp=20;S.members(q).forEach(s=>s.hp=20);A.useSkill(h,{point:{x:650,y:300}});D.step(2);return {hp:patient.hp,field:h.field,dead:D.state().soldiers.filter(s=>!s.alive).length};});check('兼続：救護陣は毎秒、生存兵を回復',r.hp>20&&r.field&&r.dead===0,r);
 r=await run('masamune',()=>{const {A,q,h,e}=F;const before=q.x;A.useSkill(h,{point:{x:620,y:300}});return {before,after:q.x,cd:h.cd};});check('政宗：騎兵部隊が安全な道へ移動',r.after!==r.before&&r.cd>0,r);
 r=await run('tadakatsu',()=>{const {A,S,q,h,other,D}=F;const m=S.members(q)[0],patient=S.members(other)[0],st=S.soldierStats(m),base=S.soldierStats(m,true);const guard=A.heroGuard(m,false);A.useSkill(h);return {max:st.maxHp,base:base.maxHp,guard,active:A.heroGuard(m,false),other:A.heroGuard(patient,false),tower:A.heroGuard(F.t,false)};});check('忠勝：HP+30%、槍兵は25%軽減、必殺技で周囲も40%軽減',r.max===Math.round(r.base*1.3)&&r.guard===.75&&Math.abs(r.active-.45)<.001&&r.other===.6&&r.tower===.6,r);
 r=await run('mitsuhide',()=>{const {A,h,e}=F;A.useSkill(h,{enemy:e});return {damage:100000-e.hp,silence:e.silence};});check('光秀：狙撃で敵の攻撃だけを封じる',r.damage>100&&r.silence===1.5,r);
 r=await run('mitsunari',()=>{const {A,S,q,h,t,D}=F;const otherHero=A.heroState().nobunaga;otherHero.cd=20;t.cd=99;for(const m of S.members(q))m.cd=99;A.useSkill(h);return {tc:t.cd,sc:S.members(q)[0].cd,hero:otherHero.cd};});check('三成：通常攻撃待ちだけ即完了、必殺技待ちは維持',r.tc===0&&r.sc===0&&r.hero===20,r);
 r=await run('yoshihiro',()=>{const {A,h,e,D}=F;A.useSkill(h,{point:{x:700,y:300}});D.step(.05);const hp=e.hp;D.step(.1);return {damage:100000-hp,again:hp-e.hp,trigger:h.triggered};});check('義弘：伏兵は敵の接近で一度だけ起爆',r.damage>0&&r.again===0&&r.trigger,r);
 r=await run('motochika',()=>{const {A,h,e,D}=F;A.useSkill(h,{point:{x:700,y:300}});D.step(.1);return {slow:e.heroSlow,rate:e.attackSlow};});check('元親：制圧陣が移動と攻撃を両方遅らせる',r.slow===.55&&r.rate===1.4,r);
 r=await run('kiyomasa',()=>{const {A,h,t,D}=F;const before=t.hp,max=D.towerApi.towerMaxHp(t);A.unassignHero(h.id);A.assignHero(h.id,t);return {max,hp:t.hp,before};},'tower');check('清正：最大耐久は増えるが配属で現在HPを回復しない',r.max===253&&r.hp<=r.before,r);
 r=await run('hanbei',()=>{const {A,S,q,h}=F;const m=S.members(q)[0];m.hp=1;const before=m.hp;A.useSkill(h,{heal:m});return {hp:m.hp,before,max:S.soldierStats(m).maxHp};});check('半兵衛：指定兵1人を大回復',r.hp>r.before&&r.hp<=r.max,r);
 r=await run('muneshige',()=>{const {A,h,q,other}=F;const p={x:q.x,y:q.y};A.useSkill(h,{ally:other});return {moved:q.x!==p.x||q.y!==p.y,gap:Math.hypot(q.x-other.x,q.y-other.y)};});check('宗茂：騎兵の救援移動は部隊間隔を保つ',r.moved&&r.gap>=60,r);
 r=await run('kanbei',()=>{const {A,h,e,q,S}=F;A.useSkill(h,{enemy:e});const base=e.hp;A.dealEnemyDamage(e,100,{s:S.members(q)[0],q},{normal:false});return base-e.hp;});check('官兵衛：集中標的への味方ダメージを増やす',Math.abs(r-120)<.001,r);
 r=await run('motonari',()=>{const {A,S,q,h,e,D}=F;for(const m of S.members(q).slice(0,3))A.dealEnemyDamage(e,100,{h,q,s:m});return 100000-e.hp;});check('元就：異なる兵3人の連携で追加ダメージ',Math.abs(r-335)<.001,r);
 r=await run('keiji',()=>{const {A,h,e}=F;A.useSkill(h,{enemy:e});return {taunt:e.taunt===h,guard:A.heroGuard(F.S.members(F.q)[0],false)};});check('慶次：挑発と配属先の防御強化',r.taunt&&r.guard<1,r);
 r=await run('ujiyasu',()=>{const {A,S,q,h}=F;const m=S.members(q)[0];const st=S.soldierStats(m),base=S.soldierStats(m,true);A.useSkill(h);const before=m.hp;S.damageSquad(q,10,false);return {damage:before-m.hp,def:st.def,base:base.def};});check('氏康：防御+25%、盾が近接ダメージを吸収',r.damage===0&&Math.abs(r.def-r.base*1.25)<.001,r);
 r=await run('masanori',()=>{const {A,S,q,h,e}=F;const src={h,q,s:S.members(q)[0]};A.dealEnemyDamage(e,100,src);const first=100000-e.hp;A.unassignHero(h.id);A.assignHero(h.id,q);A.dealEnemyDamage(e,100,src);return {first,second:100000-e.hp-first};});check('正則：再配属しても同じ敵への初撃を取り直せない',r.first===135&&r.second===100,r);
 r=await run('kansuke',()=>{const {A,h,e,D}=F;A.useSkill(h,{point:{x:700,y:300}});D.step(.05);return e.stun;});check('勘助：道の罠で最初の敵を停止',r>1.8,r);
 r=await run('yoshiaki',()=>{const {A,h,e}=F;A.useSkill(h);return {damage:100000-e.hp,slow:e.heroSlow};});check('義光：城に近い敵への狙撃と強い減速',r.damage>0&&r.slow===.4,r);
 r=await run('yoshikage',()=>{const {A,S,q,h,D}=F;const m=S.members(q)[0];m.hp=10;A.useSkill(h);const cd=m.cd;D.step(1);return {hp:m.hp,cd:m.cd,before:cd};});check('義景：休息中は回復し攻撃・治療の待ちも進めない',r.hp>10&&r.cd===r.before,r);
 r=await run('dosan',()=>{const {A,h,e,D}=F;A.useSkill(h,{point:{x:700,y:300}});const dps=e.poisonDps;D.step(1);return {damage:100000-e.hp,dps};});check('道三：毒は継続ダメージとして進む',r.damage>0&&r.dps>0,r);
 r=await run('yoshikata',()=>{const {A,S,q,h}=F;const m=S.members(q)[0];A.useSkill(h,{point:{x:650,y:300}});const before=m.hp;S.damageSquad(q,10,true);return {damage:before-m.hp,shield:m.heroShield.amount};});check('義賢：遠距離盾が実ダメージを吸収',r.damage===0&&r.shield>0,r);
 r=await run('haruhisa',()=>{const {A,h,e,q,D}=F;e.x=q.x;e.y=q.y;e.d=784;e.breakthrough=3;A.useSkill(h,{point:{x:650,y:300}});return {protection:e.breakthrough,held:e.blockedBy===q};});check('晴久：突破保護を解除して再足止め',r.protection===0&&r.held,r);
 r=await run('sorin',()=>{const {A,h,e,D}=F;e.d=800;e.x=666;const e2=D.addEnemy({d:834,hp:100000,speed:0,unitCd:1e9});A.useSkill(h,{point:{x:720,y:300}});return {first:100000-e.hp,next:100000-e2.hp};});check('宗麟：直線貫通で先頭と後続へ異なる威力',r.first>r.next&&r.next>0,r);
 r=await run('takanobu',()=>{const {A,h,e}=F;A.useSkill(h);return {stun:e.stun,weak:e.attackDebuff};});check('隆信：ひるみと攻撃力低下',r.stun>0&&r.weak===.25,r);
 r=await run('terumoto',()=>{const {A,h,D,S,q}=F;A.useSkill(h);D.state().enemies.length=0;D.step(.1);S.members(q)[0].hp=1;const before=S.healCost(q);S.healSquad(q);S.members(q)[0].hp=1;const after=S.healCost(q);return {before,after,coupon:h.couponWave};});check('輝元：準備時間の割引は1回使うと消える',r.before<r.after&&r.coupon===-1,r);
 // Independent checks for every newly split passive, including tower equivalents.
 const passives = [
  ['shingen','tower',()=>F.A.heroGuard(F.t,false)===.8],
  ['motoyasu','tower',()=>{const {t,A,D}=F;const max=D.towerApi.towerMaxHp(t);t.hp=max*.51;const above=A.heroGuard(t,false);t.hp=max*.5;return above===1&&A.heroGuard(t,false)===.7;}],
  ['hideyoshi','tower',()=>{const m=F.S.members(F.q)[0];m.hp=10;const max=F.S.soldierStats(m).maxHp;F.A.tickHeroes(1);return Math.abs(m.hp-10-max*.01)<.001;}],
  ['yukimura','tower',()=>{const {D,t,A,h}=F;A.unassignHero('yukimura');const base=D.towerApi.towerMaxHp(t);A.assignHero('yukimura',t);t.hp=22;const max=D.towerApi.towerMaxHp(t),guard=A.heroGuard(t,false);A.useSkill(h);const active=A.heroGuard(t,false);D.step(1);return max===Math.round(base*1.3)&&guard===.85&&active===.425&&t.hp>22;}],
  ['kanetsugu','squad',()=>{const m=F.S.members(F.q)[0],st=F.S.soldierStats(m),base=F.S.soldierStats(m,true);return Math.abs(st.heal-base.heal*1.3)<.001&&Math.abs(st.rate-base.rate*.8)<.001;}],
  ['kanetsugu','tower',()=>{const m=F.S.members(F.q)[0],st=F.S.soldierStats(m),base=F.S.soldierStats(m,true);return Math.abs(st.range-base.range*1.2)<.001&&st.heal===base.heal;}],
  ['masamune','squad',()=>{const m=F.S.members(F.q)[0];m.cd=1;const src={q:F.q,s:m,h:F.h};F.A.dealEnemyDamage(F.e,10,src);const first=m.cd;F.A.unassignHero(F.h.id);F.A.assignHero(F.h.id,F.q);m.cd=1;F.A.dealEnemyDamage(F.e,10,src);return first===.55&&m.cd===1;}],
  ['masamune','tower',()=>{F.A.dealEnemyDamage(F.e,10,{t:F.t,h:F.h});return F.t.nextRateMul===.65;}],
  ['tadakatsu','tower',()=>{const {A,D,t}=F;const max=D.towerApi.towerMaxHp(t),hp=t.hp;A.unassignHero('tadakatsu');return max===Math.round(D.towerApi.towerMaxHp(t)*1.35)&&t.hp<=hp;}],
  ['mitsuhide','squad',()=>{const m=F.S.members(F.q)[0];F.A.dealEnemyDamage(F.e,100,{q:F.q,s:m,h:F.h});return Math.abs(100000-F.e.hp-150)<.01;}],
  ['mitsuhide','tower',()=>{const boss=F.D.addEnemy({kind:'boss',d:824,hp:1e5,speed:0,unitCd:1e9});return F.A.targetPriority(F.t,155,F.h)===boss;}],
  ['mitsunari','squad',()=>F.S.soldierStats(F.S.members(F.q)[0]).atk>7],
  ['mitsunari','tower',()=>{F.D.state().towers.push({id:2,x:730,y:220,type:'ice',level:1,cd:1e9});return F.D.towerStats(F.t).range===155*1.15;}],
  ['yoshihiro','squad',()=>{F.A.dealEnemyDamage(F.e,100,{q:F.q,s:F.S.members(F.q)[0],h:F.h});return Math.abs(100000-F.e.hp-135)<.01;}],
  ['yoshihiro','tower',()=>{F.A.dealEnemyDamage(F.e,100,{t:F.t,h:F.h});return 100000-F.e.hp>105;}],
  ['motochika','squad',()=>{F.A.dealEnemyDamage(F.e,10,{q:F.q,s:F.S.members(F.q)[0],h:F.h});return F.e.heroSlow===.85&&F.e.heroSlowLeft===1;}],
  ['motochika','tower',()=>{F.A.dealEnemyDamage(F.e,10,{t:F.t,h:F.h});return F.e.attackDebuff===.12;}],
  ['kiyomasa','squad',()=>{const other=F.D.addEnemy({d:844,hp:1000,speed:0,unitCd:1e9});F.A.dealEnemyDamage(F.e,100,{q:F.q,s:F.S.members(F.q)[0],h:F.h});return other.hp===965;}],
  ['hanbei','squad',()=>{const m=F.S.members(F.q)[0];m.hp=1;return F.A.heroGuard(m,false)===.8;}],
  ['hanbei','tower',()=>{const m=F.S.members(F.other)[0];m.hp=1;return F.A.heroGuard(m,false)===.85;}],
  ['muneshige','squad',()=>{F.e.blockedBy=F.other;return F.S.soldierStats(F.S.members(F.q)[0]).atk>11;}],
  ['muneshige','tower',()=>{F.e.blockedBy=F.q;F.A.dealEnemyDamage(F.e,100,{t:F.t,h:F.h});return F.e.hp===99875;}],
  ['kanbei','squad',()=>{const src={q:F.q,s:F.S.members(F.q)[0],h:F.h};F.A.dealEnemyDamage(F.e,100,src);const hp=F.e.hp;F.A.dealEnemyDamage(F.e,100,src);return Math.abs(hp-F.e.hp-108)<.01;}],
  ['kanbei','tower',()=>{const src={t:F.t,h:F.h};F.A.dealEnemyDamage(F.e,100,src);const hp=F.e.hp;F.A.dealEnemyDamage(F.e,100,src);return Math.abs(hp-F.e.hp-106)<.01;}],
  ['motonari','tower',()=>{F.e.lastTowerId=99;F.e.lastTowerAt=F.A.clock();F.A.dealEnemyDamage(F.e,100,{t:F.t,h:F.h});return F.e.hp===99880;}],
  ['keiji','squad',()=>{const m=F.S.members(F.q)[0],before=F.S.soldierStats(m).atk;F.D.state().squads.splice(F.D.state().squads.indexOf(F.other),1);return F.S.soldierStats(m).atk>before*1.2;}],
  ['keiji','tower',()=>F.D.towerStats(F.t).damage===18*1.2],
  ['ujiyasu','tower',()=>{const {A,D,t}=F;const max=D.towerApi.towerMaxHp(t),guard=A.heroGuard(t,false);A.unassignHero('ujiyasu');return max===Math.round(D.towerApi.towerMaxHp(t)*1.2)&&guard===.85;}],
  ['masanori','tower',()=>{const src={t:F.t,h:F.h};F.A.dealEnemyDamage(F.e,100,src);const hp=F.e.hp;F.A.dealEnemyDamage(F.e,100,src);return 100000-hp===130&&hp-F.e.hp===100;}],
  ['kansuke','squad',()=>{F.q.x=560;F.q.y=300;return F.S.soldierStats(F.S.members(F.q)[0]).def>4;}],
  ['kansuke','tower',()=>{F.t.x=560;F.t.y=240;return F.D.towerStats(F.t).range>155;}],
  ['yoshiaki','squad',()=>{F.A.dealEnemyDamage(F.e,100,{q:F.q,s:F.S.members(F.q)[0],h:F.h});return 100000-F.e.hp>120;}],
  ['yoshiaki','tower',()=>{F.t.x=800;return Math.abs(F.D.towerStats(F.t).rate-.3825)<.001;}],
  ['yoshikage','squad',()=>{const m=F.S.members(F.q)[0];m.hp=10;F.D.step(4);return m.hp>10;}],
  ['yoshikage','tower',()=>{F.t.hp=100;F.D.step(4);return F.t.hp>100;}],
  ['dosan','tower',()=>{F.A.dealEnemyDamage(F.e,100,{t:F.t,h:F.h});const hp=F.e.hp;F.A.tickHeroes(1);return Math.abs(hp-F.e.hp-6)<.01;}],
  ['yoshikata','squad',()=>F.A.heroGuard(F.S.members(F.q)[0],true)===.8],
  ['yoshikata','tower',()=>{const archer=F.D.addEnemy({kind:'dragon',d:824,hp:1e5,speed:0,unitCd:1e9});return F.A.targetPriority(F.t,155,F.h)===archer;}],
  ['haruhisa','squad',()=>{F.e.x=F.q.x;F.e.y=F.q.y;F.e.d=784;F.e.blockedBy=F.q;F.e.blockTime=6.1;F.D.step(.05);return !F.e.blockedBy&&F.e.breakthrough<=1.5;}],
  ['haruhisa','tower',()=>{F.e.recentBreak=3;F.A.dealEnemyDamage(F.e,100,{t:F.t,h:F.h});return F.e.hp===99870;}],
  ['sorin','squad',()=>{F.e.armor=100;F.A.dealEnemyDamage(F.e,100,{q:F.q,s:F.S.members(F.q)[0],h:F.h});return Math.abs(100000-F.e.hp-100/3)<.01;}],
  ['sorin','tower',()=>{const other=F.D.addEnemy({d:834,hp:1000,speed:0,unitCd:1e9});other.x=725;other.y=340;for(let i=0;i<4;i++)F.A.afterTowerFire(F.t,F.e,100);return other.hp===950;}],
  ['takanobu','squad',()=>{F.e.blockedBy=F.q;return F.A.heroGuard(F.S.members(F.q)[0],false,F.e)===.85;}],
  ['takanobu','tower',()=>F.A.heroGuard(F.t,false,F.e)===.85],
  ['terumoto','tower',()=>{const gold=F.D.state().gold;Math.random=()=>0;for(let i=0;i<12;i++){const e=F.D.addEnemy({d:834,hp:1,max:1,speed:0,unitCd:1e9});F.A.dealEnemyDamage(e,100,{t:F.t,h:F.h});}F.D.step(.05);return F.D.state().gold-gold===130&&F.h.economyGold===10;}],
 ];
 for(const [id,mode,fn] of passives)check(id+' / '+mode+' の個別パッシブが実際に働く',await run(id,fn,mode));
 // Healing an empty map location must not silently spend the skill on the caster.
 r=await run('hanbei',()=>{const before=F.h.cd;const used=F.A.useSkill(F.h,{x:400,y:10});return {used,cd:F.h.cd,before};});
 check('対象のない治療タップは未消費で拒否',!r.used&&r.cd===r.before,r);

 r=await run('muneshige',()=>{const {A,h,q,other}=F;other.x=500;other.y=440-(50*140/110);const before={x:q.x,y:q.y};const used=A.useSkill(h,{ally:other});return {used,moved:q.x!==before.x||q.y!==before.y,off:F.D.projectToRoad(q.x,q.y).off,gap:Math.hypot(q.x-other.x,q.y-other.y)};});
 check('救援は別の分岐ルートにも移動し、道と部隊間隔を守る',r.used&&r.moved&&r.off<1&&r.gap>=60,r);
 r=await run('motoyasu',()=>{const {A,h,S}=F;A.useSkill(h);const late=S.hireSquad('ashigaru',570,300),m=S.members(late)[0];S.damageSquad(late,1e6,false);return !m.alive;});
 check('致命傷防止は発動後に雇った兵へ追加付与しない',r);
 r=await run('dosan',()=>{const {A,h,e,D}=F;A.useSkill(h,{point:{x:700,y:300}});const before=h.cd;document.getElementById('speed').click();D.step(1);return {elapsed:before-h.cd,left:e.poisonLeft};});
 check('2倍速は再使用待ち・毒の時間へ一度だけ反映',Math.abs(r.elapsed-2)<.001&&Math.abs(r.left-4)<.001,r);
 // Range checks and invalid/cancelled targeting do not consume a skill.
 r=await run('masamune',()=>{const {A,h,q,other}=F;const before=h.cd;const used=A.useSkill(h,{point:{x:740,y:300}});return {used,cd:h.cd,before,x:q.x};});check('重複配置になる突撃は消費せず拒否',!r.used&&r.cd===r.before&&r.x===650,r);
 await setup('hideyoshi');
 check('秀吉のヒーラー化後も領土の補充割引は維持',await page.evaluate(()=>{const {S,A,q}=F;S.conquest()[S.PROVINCES.shinano.castle].captured=true;return A.recruitCost(q)===S.unitCost(q.type);}));
 check('秀吉のヒーラー化後も領土の修理割引は維持',await page.evaluate(()=>{const {S,A,t}=F;S.conquest()[S.PROVINCES.mino.castle].captured=true;A.assignHero('hideyoshi',t);t.hp=WD_DEBUG.towerApi.towerMaxHp(t)/2;return S.repairCost(t)===Math.ceil(100*WD_DEBUG.towerApi.TOWER_HP.repairRate*.5*.7);}));
 // Tank and healer integration checks.
 r=await run('tadakatsu',()=>{const {A,S,q,h,other}=F;const m=S.members(q)[0];const ordinary=A.heroGuard(m,false);other.x=900;other.y=300;A.useSkill(h);return {ordinary,far:A.heroGuard(S.members(other)[0],false)};},'squad','ashigaru');check('忠勝：槍兵以外は15%軽減、範囲外への支援なし',r.ordinary===.85&&r.far===1,r);
 r=await run('tadakatsu',()=>{const {A,S,q,h,other,D}=F;A.useSkill(h);const m=S.members(other)[0];const active=A.heroGuard(m,false);D.step(9);return {active,ended:A.heroGuard(m,false)};});check('忠勝：範囲軽減は8秒で終了',r.active===.6&&r.ended===1,r);
 for(const id of ['motoyasu','tadakatsu']) {r=await run(id,()=>{const {A,S,q,h}=F;const m=S.members(q)[0],base=S.soldierStats(m,true).maxHp;const max=S.soldierStats(m).maxHp;m.hp=7;A.unassignHero(h.id);A.assignHero(h.id,q);const low=m.hp;m.hp=max;A.unassignHero(h.id);return {base,max,low,hp:m.hp};});check(id+'：HP増加は現在HPを増やさず解除時は上限で制限',r.max>r.base&&r.low===7&&r.hp===r.base,r);}
 r=await run('motoyasu',()=>{const {S,A,q}=F;const m=S.members(q)[0],max=S.soldierStats(m).maxHp,base=S.soldierStats(m,true).maxHp;m.hp=max*.51;const above=A.heroGuard(m,false);m.hp=max*.5;return {max,base,above,below:A.heroGuard(m,false)};});check('元康：HP+20%、HP50%を境に25%軽減',r.max===Math.round(r.base*1.2)&&r.above===1&&r.below===.75,r);
 r=await run('ujiyasu',()=>{const {A,S,q,h,D}=F;const base=D.unitConfig.SOLDIER_TYPES[q.type].block;const es=[];for(let i=0;i<base+2;i++)es.push(D.addEnemy({d:784,hp:1e5,speed:0,unitCd:1e9}));D.step(.1);return {base,count:S.blockCount(q)};});check('氏康：足止め上限は常時+1',r.count===r.base+1,r);
 for(const ranged of [false,true]){r=await run('ujiyasu',()=>{const {A,S,q,h}=F;const m=S.members(q)[0];A.useSkill(h);return {max:S.soldierStats(m).maxHp,guard:A.heroGuard(m,false),id:m.id};});const absorbed=await page.evaluate((ranged)=>{const {A,S,q}=F;const m=S.members(q)[0];const first=A.absorbShield(m,5,ranged),second=A.absorbShield(m,1e4,ranged);return {first,second,max:S.soldierStats(m).maxHp};},ranged);check('氏康：'+(ranged?'遠距離':'近接')+'盾を消費し超過分は通す',absorbed.first===0&&Math.abs(absorbed.second-(1e4-(absorbed.max*.3-5)))<.001,absorbed);}
 r=await run('ujiyasu',()=>{const {A,S,q,h,D}=F;A.useSkill(h);const m=S.members(q)[0],late=S.hireSquad('ashigaru',570,300);const noLate=A.absorbShield(S.members(late)[0],5,false);A.unassignHero(h.id);return {noLate,after:A.absorbShield(m,5,false)};});check('氏康：新規雇用には盾を付けず、配属解除で盾終了',r.noLate===5&&r.after===5,r);
 r=await run('ujiyasu',()=>{const {A,S,q,h,D}=F;A.useSkill(h);const m=S.members(q)[0];D.step(9);return A.absorbShield(m,5,false);});check('氏康：盾は8秒で消える',r===5,r);
 r=await run('kanetsugu',()=>{const {S,A,q,h,other,D}=F;const m=S.members(other)[0],dead=S.members(other)[1];m.hp=1;dead.alive=false;dead.hp=0;const max=S.soldierStats(m).maxHp;A.useSkill(h,{point:{x:650,y:300}});const instant=m.hp;D.step(1);return {max,instant,hp:m.hp,dead:dead.hp,alive:dead.alive};});check('兼続：即時20%+毎秒3%、戦死者は復活しない',Math.abs(r.instant-(1+r.max*.2))<.001&&Math.abs(r.hp-(1+r.max*.23))<.001&&r.dead===0&&!r.alive,r);
 r=await run('hideyoshi',()=>{const {A,S,q,h,other}=F;const medic=S.hireSquad('medic',570,300),m=S.members(medic)[0];const base=S.soldierStats(m,true);const passive=S.soldierStats(m);A.useSkill(h);const active=S.soldierStats(m);medic.x=900;return {base,passive,active,far:S.soldierStats(m)};});check('秀吉：範囲内は回復量+20%・必殺技中は間隔30%短縮、範囲外は解除',Math.abs(r.passive.heal-r.base.heal*1.2)<.001&&Math.abs(r.active.rate-r.base.rate*.7)<.001&&r.far.heal===r.base.heal&&r.far.rate===r.base.rate,r);
 r=await run('kanetsugu',()=>{const {A,S,q,h,other,D}=F;const m=S.members(q)[0],base=S.soldierStats(m,true);A.assignHero('hideyoshi',other);const passive=S.soldierStats(m);A.useSkill(A.heroState().hideyoshi);const active=S.soldierStats(m);A.unassignHero('hideyoshi');return {base,passive,active,after:S.soldierStats(m)};});check('兼続と秀吉：回復量は1.3×1.2、間隔は0.8×0.7、解除で重複を残さない',Math.abs(r.passive.heal-r.base.heal*1.56)<.001&&Math.abs(r.active.rate-r.base.rate*.56)<.001&&Math.abs(r.after.heal-r.base.heal*1.3)<.001&&Math.abs(r.after.rate-r.base.rate*.8)<.001,r);
 r=await run('kanetsugu',()=>{const {A,S,q,other,D}=F;const m=S.members(q)[0],base=S.soldierStats(m,true);A.assignHero('hideyoshi',other);return {siege:S.soldierStats(m,true),base};});check('攻城戦用の基礎能力に防衛戦の回復支援を混入しない',r.siege.heal===r.base.heal&&r.siege.rate===r.base.rate,r);
 r=await run('hideyoshi',()=>{const {A,S,q,other,D}=F;const m=S.members(q)[0],far=S.members(other)[0],dead=S.members(q)[1];m.hp=10;far.hp=10;other.x=900;dead.hp=0;dead.alive=false;A.tickHeroes(1);return {hp:m.hp,far:far.hp,dead:dead.hp};},'tower');check('秀吉塔：生存兵だけ毎秒1%回復、範囲外には届かない',r.hp>10&&r.far===10&&r.dead===0,r);
 await setup('mitsuhide');
 await page.evaluate(()=>{F.A.beginHeroTarget(F.h);F.A.draw();});
 check('対象選択中は停止し案内を表示',await page.locator('#heroTargetBar').isVisible()&&await page.evaluate(()=>WD_DEBUG.state().paused));
 await page.tap('#skillGuideOpen');await page.keyboard.press('Escape');
 check('対象選択中の説明画面を閉じても選択中の停止を保つ',await page.evaluate(()=>WD_DEBUG.state().paused)&&await page.locator('#heroTargetBar').isVisible());
 await page.tap('#heroTargetCancel');check('キャンセルで再開し必殺技は未消費',await page.evaluate(()=>!WD_DEBUG.state().paused&&F.h.cd===0));
 await page.evaluate(()=>{F.A.beginHeroTarget(F.h);F.A.draw();});
 const xy=await page.evaluate(()=>{const c=document.getElementById('game'),r=c.getBoundingClientRect();return {x:r.left+c.clientLeft+700*c.clientWidth/960,y:r.top+c.clientTop+300*c.clientHeight/600};});
 await page.touchscreen.tap(xy.x,xy.y);
 check('マップの敵タップで発動して再開',await page.evaluate(()=>!WD_DEBUG.state().paused&&F.h.cd>0&&F.e.silence>0));
 await page.tap('#skillGuideOpen');check('一覧が部隊用・塔用を分けて説明',(await page.locator('#skillGuidePanel').innerText()).includes('部隊：')&&(await page.locator('#skillGuidePanel').innerText()).includes('塔：'));
 if(process.env.SCREENSHOTS){fs.mkdirSync(process.env.SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.SCREENSHOTS,'warlords-v17-guide.png')});}
 await page.tap('#skillGuideClose');
 await page.tap('#pause');const before=await page.evaluate(()=>F.h.cd);await page.evaluate(()=>WD_DEBUG.step(2));check('停止中は新しいスキルの待ちも進まない',await page.evaluate(()=>F.h.cd)===before);
 check('390pxで横スクロールなし',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check('全ケースでJavaScript例外なし',errorLog.length===0,errorLog);
}finally{await browser.close();}
console.log(`結果: ${passed} 件成功 / ${failed} 件失敗`);process.exit(failed?1:0);
