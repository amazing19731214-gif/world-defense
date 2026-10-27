#!/usr/bin/env node
import { openInfoEntry } from './ui-test-utils.mjs';
// Six-tower cap, persistent type research, combat integration and save failures.
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(new URL('../index.html',import.meta.url)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{});
const url=`http://127.0.0.1:${server.address().port}/?debug`,W='worldDefense.warlords.v1',S='worldDefense.soldiers.v1',TX='worldDefense.bookTransaction.v1';
let passes=0,failures=0;const errors=[];
function check(name,ok,detail){ok?passes++:failures++;console.log((ok?'✓ ':'✗ ')+name+(!ok&&detail!==undefined?' '+JSON.stringify(detail):''));}
const near=(a,b,eps=1e-7)=>Math.abs(a-b)<eps;
const spots=[[330,300],[420,300],[330,80],[700,420],[700,190],[330,520],[420,520],[650,60],[650,540]];
async function setup(seed={},width=390,height=844){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<700,hasTouch:width<700});
 await context.addInitScript(({seed,W})=>{requestAnimationFrame=()=>0;Math.random=()=>0.5;if(!sessionStorage.getItem('seeded')){localStorage.setItem(W,JSON.stringify({owned:{},tickets:3,...seed}));sessionStorage.setItem('seeded','1');}},{seed,W});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);await page.waitForFunction(()=>window.WD_DEBUG);return {page,context};
}
async function reload(p){await p.reload();await p.waitForFunction(()=>window.WD_DEBUG);}
async function clickMap(p,xy){return p.evaluate(([x,y])=>{const c=document.getElementById('game'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{clientX:r.left+c.clientLeft+x*c.clientWidth/960,clientY:r.top+c.clientTop+y*c.clientHeight/600,bubbles:true}));},xy);}
async function build(p,type='arrow',xy=spots[0]){await p.evaluate(type=>document.querySelector(`[data-t="${type}"]`).click(),type);await clickMap(p,xy);}
async function seedLevels(p,levels){await p.evaluate(({levels,W})=>{const h=WD_DEBUG.heroApi.save();h.towerResearch=Object.fromEntries(Object.entries(levels).map(([k,lv])=>[k,WD_DEBUG.towerGrowthApi.TOWER_XP_TOTAL[lv]]));WD_DEBUG.forgeApi.persist();},{levels,W});await reload(p);}
async function finish(p,types=['arrow'],failKey=null){return p.evaluate(({types,failKey})=>{
 const D=WD_DEBUG;document.getElementById('start').click();D.stopSpawning();D.state().enemies.length=0;
 const e=D.addEnemy({d:400,hp:1e6,max:1e6,speed:0});
 for(const t of D.state().towers)if(types.includes(t.type)&&!t.destroyed)D.towerGrowthApi.fire(t,e);
 D.state().enemies.length=0;const set=Storage.prototype.setItem;
 if(failKey)Storage.prototype.setItem=function(k,v){if(k===failKey)throw Error('test save failure');return set.call(this,k,v);};
 try{D.step(.05);}finally{Storage.prototype.setItem=set;}
 return {xp:D.towerGrowthApi.research(),wave:D.state().wave,playing:D.state().playing};
 },{types,failKey});}
try{
 {
  const {page:p,context:c}=await setup();let r=await p.evaluate(()=>({levels:Object.keys(WD_DEBUG.towerGrowthApi.research()).map(k=>WD_DEBUG.towerGrowthApi.towerResearch(k).level),gold:WD_DEBUG.state().gold}));
  check('Legacy hero save starts all four research types at Lv1 without spending gold',r.levels.join()==='1,1,1,1'&&r.gold===500,r);
  await p.evaluate(()=>WD_DEBUG.setGold(10000));for(let i=0;i<6;i++)await build(p,['arrow','arrow','cannon','magic','ice','arrow'][i],spots[i]);
  r=await p.evaluate(()=>({n:WD_DEBUG.state().towers.length,g:WD_DEBUG.state().gold}));check('Six mixed towers can be built at unchanged prices',r.n===6&&r.g===9150,r);
  const before=r.g;await build(p,'cannon',spots[6]);r=await p.evaluate(()=>({n:WD_DEBUG.state().towers.length,g:WD_DEBUG.state().gold,msg:document.getElementById('msg').textContent,count:document.getElementById('towerCount').textContent}));
  check('Seventh tower is rejected without charging and HUD displays 6/6',r.n===6&&r.g===before&&r.msg.includes('6基')&&r.count.includes('6/6'),r);
  await clickMap(p,spots[0]);await p.evaluate(()=>document.getElementById('sell').click());await build(p,'cannon',spots[6]);
  check('Selling frees a slot for another type',await p.evaluate(()=>WD_DEBUG.state().towers.length===6&&WD_DEBUG.state().towers.some(t=>t.type==='cannon'&&Math.abs(t.x-420)<4&&Math.abs(t.y-520)<4)));
  await p.evaluate(()=>WD_DEBUG.towerApi.damageTower(WD_DEBUG.state().towers[0],1e6));await build(p,'magic',spots[7]);
  r=await p.evaluate(()=>({all:WD_DEBUG.state().towers.length,live:WD_DEBUG.towerGrowthApi.builtTowerCount()}));check('Destroyed tower frees slot immediately while rubble remains',r.all===7&&r.live===6,r);
  check('Cap applies in training too',await p.evaluate(()=>{WD_DEBUG.trainingApi.startTraining('beginner');return !!WD_DEBUG.trainingApi.training();}));await build(p,'ice',spots[8]);
  check('Training rejects a seventh live tower',await p.evaluate(()=>WD_DEBUG.towerGrowthApi.builtTowerCount()===6));await p.evaluate(()=>WD_DEBUG.trainingApi.endTraining('retreat'));await c.close();
 }
 {
  const {page:p,context:c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p,'arrow',spots[0]);await build(p,'arrow',spots[1]);await build(p,'cannon',spots[2]);
  let r=await finish(p);check('Two participating arrows earn one type reward; idle cannon earns zero',r.xp.arrow===13&&r.xp.cannon===0&&!r.playing,r);
  await p.evaluate(()=>WD_DEBUG.defenseApi.save());await reload(p);r=await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research());check('Manual save and reload do not duplicate wave experience',r.arrow===13&&r.cannon===0,r);
  await p.evaluate(()=>WD_DEBUG.state().towers.filter(t=>t.type==='arrow').forEach(t=>t.hp=WD_DEBUG.towerApi.towerMaxHp(t)*.4));r=await finish(p);
  check('Second completed wave reaches shared Lv2 with 27 total XP',r.xp.arrow===27&&await p.evaluate(()=>WD_DEBUG.towerGrowthApi.towerResearch('arrow').level===2),r);
  r=await p.evaluate(()=>WD_DEBUG.state().towers.filter(t=>t.type==='arrow').map(t=>({ratio:t.hp/WD_DEBUG.towerApi.towerMaxHp(t),damage:WD_DEBUG.towerStats(t).damage})));check('All arrows grow together and preserve HP percentage',r.length===2&&r.every(t=>near(t.ratio,.4)&&t.damage>18),r);
  await reload(p);r=await p.evaluate(()=>({xp:WD_DEBUG.towerGrowthApi.research(),ratio:WD_DEBUG.state().towers[0].hp/WD_DEBUG.towerApi.towerMaxHp(WD_DEBUG.state().towers[0])}));check('Research and proportionate HP survive checkpoint reload',r.xp.arrow===27&&near(r.ratio,.4),r);
  await p.evaluate(()=>document.getElementById('reset').click());check('Starting over clears placed towers but preserves type progression',await p.evaluate(()=>WD_DEBUG.state().towers.length===0&&WD_DEBUG.towerGrowthApi.towerResearch('arrow').level===2));
  await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p,'arrow');r=await p.evaluate(()=>({d:WD_DEBUG.towerStats(WD_DEBUG.state().towers[0]).damage,h:WD_DEBUG.towerApi.towerMaxHp(WD_DEBUG.state().towers[0])}));check('Newly constructed arrow inherits its type level',r.d>18&&r.h>220,r);
  await clickMap(p,spots[0]);await p.evaluate(()=>document.getElementById('sell').click());await build(p,'arrow');check('Sale and rebuild preserve type experience',await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research().arrow===27));
  await p.evaluate(()=>{document.getElementById('start').click();WD_DEBUG.stopSpawning();WD_DEBUG.state().enemies.length=0;const e=WD_DEBUG.addEnemy({hp:1e6,d:400,speed:0});WD_DEBUG.towerGrowthApi.fire(WD_DEBUG.state().towers[0],e);});
  await reload(p);check('Reload mid-wave restores previous checkpoint without unfinished XP',await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research().arrow===27));await c.close();
 }
 for(const [lv,atk,hp] of [[1,1,1],[10,1.15,1.12],[100,1.3,1.24],[1000,1.45,1.36],[9999,1.5999934852565777,1.4799947882052622]]){
  const {page:p,context:c}=await setup();await seedLevels(p,{arrow:lv,cannon:lv,magic:lv,ice:lv});
  const r=await p.evaluate(()=>['arrow','cannon','magic','ice'].map(type=>{const t={id:1,type,level:1},npc={...t,npc:true};return {type,g:WD_DEBUG.towerGrowthApi.towerResearch(type),st:WD_DEBUG.towerStats(t),hp:WD_DEBUG.towerApi.towerMaxHp(t),npcHp:WD_DEBUG.towerApi.towerMaxHp(npc),npcDamage:WD_DEBUG.towerStats(npc).damage};}));
  check(`Lv${lv} has bounded attack and HP for all four types`,r.every((v,i)=>v.g.level===lv&&near(v.st.damage,[18,48,32,9][i]*atk)&&v.hp===Math.round([220,300,260,240][i]*hp)),r);
  check(`Lv${lv} preserves range, attack interval, splash and enemy tower stats`,r.every((v,i)=>v.st.range===[155,130,170,145][i]&&v.st.rate===[.45,1.6,.8,.95][i]&&v.st.splash===65&&v.npcHp===[220,300,260,240][i]&&v.npcDamage===[18,48,32,9][i]),r);
  if(lv===9999){await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p);const total=await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research().arrow);await finish(p);check('Maximum level never exceeds 9999 or overflows XP',await p.evaluate(total=>WD_DEBUG.towerGrowthApi.research().arrow===total&&WD_DEBUG.towerGrowthApi.towerResearch('arrow').need===0,total));}
  await c.close();
 }
 {
  const {page:p,context:c}=await setup({towerResearch:{arrow:1e99,cannon:-3,magic:'100',ice:null,unknown:999}});const r=await p.evaluate(()=>({r:WD_DEBUG.towerGrowthApi.research(),lv:WD_DEBUG.towerGrowthApi.towerResearch('arrow').level}));check('Malformed and excessive type XP is sanitized independently',r.lv===9999&&r.r.cannon===0&&r.r.magic===0&&r.r.ice===0&&!('unknown'in r.r),r);await c.close();
 }
 for(const failure of [TX,W,S]){
  const {page:p,context:c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p);await finish(p);await finish(p,['arrow'],failure);await reload(p);
  const r=await p.evaluate(()=>({xp:WD_DEBUG.towerGrowthApi.research().arrow,wave:WD_DEBUG.state().wave}));check(`Save failure at ${failure} restores coherent wave and type XP`,failure===TX?r.xp===13&&r.wave===1:r.xp===27&&r.wave===2,r);await c.close();
 }
 {
  const {page:p,context:c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p);await finish(p);await finish(p,['arrow'],TX);await p.evaluate(()=>WD_DEBUG.defenseApi.save());await reload(p);check('Retry after WAL failure retains earned XP exactly once',await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research().arrow===27&&WD_DEBUG.state().wave===2));await c.close();
 }
 {
  const {page:p,context:c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p);await finish(p);await p.evaluate(()=>{const t=WD_DEBUG.state().towers[0];t.hp=WD_DEBUG.towerApi.towerMaxHp(t)*.4;WD_DEBUG.defenseApi.save();WD_DEBUG.trainingApi.startTraining('beginner');});
  await finish(p);let r=await p.evaluate(()=>({level:WD_DEBUG.towerGrowthApi.towerResearch('arrow').level,training:!!WD_DEBUG.trainingApi.training()}));check('Training victory grants persistent type XP',r.level===2&&r.training,r);
  await p.evaluate(()=>WD_DEBUG.trainingApi.endTraining('retreat'));r=await p.evaluate(()=>{const t=WD_DEBUG.state().towers[0];return {wave:WD_DEBUG.state().wave,ratio:t.hp/WD_DEBUG.towerApi.towerMaxHp(t),level:WD_DEBUG.towerGrowthApi.towerResearch('arrow').level};});check('Training return restores defense tower without undoing growth or healing it',r.wave===1&&r.level===2&&Math.abs(r.ratio-.4)<.003,r);
  await reload(p);r=await p.evaluate(()=>{const t=WD_DEBUG.state().towers[0];return {wave:WD_DEBUG.state().wave,ratio:t.hp/WD_DEBUG.towerApi.towerMaxHp(t),lv:WD_DEBUG.towerGrowthApi.towerResearch('arrow').level};});check('Older defense checkpoint scales HP when training has raised type level',r.wave===1&&r.lv===2&&Math.abs(r.ratio-.4)<.003,r);await c.close();
 }
 {
  const {page:p,context:c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(10000));for(let i=0;i<6;i++)await build(p,'arrow',spots[i]);await p.evaluate(()=>{const D=WD_DEBUG;D.state().towers.push({id:77,type:'cannon',x:420,y:520,level:5,spent:1000,hp:600,cd:0});D.defenseApi.save();});await reload(p);
  check('Old checkpoint with seven towers remains playable and displays legacy count',await p.evaluate(()=>WD_DEBUG.state().towers.length===7&&document.getElementById('towerCount').textContent.includes('7/6')));await build(p,'ice',spots[7]);check('Old excess towers block construction without deleting existing towers',await p.evaluate(()=>WD_DEBUG.state().towers.length===7));await c.close();
 }
 {
  const {page:p,context:c}=await setup({towerResearch:{arrow:27},forge:{books:{goriki:1}}});
  await p.evaluate(S=>localStorage.setItem(S,JSON.stringify({seq:1,squadSeq:1,squads:[{id:1,type:'spearman',slot:0}],soldiers:[{id:1,type:'spearman',squadId:1,level:30}],fallen:[]})),S);await reload(p);
  const error=await p.evaluate(()=>WD_DEBUG.forgeApi.useBook(WD_DEBUG.state().soldiers[0],'goriki'));await reload(p);
  check('Skill-book transaction preserves existing tower research',error===null&&await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research().arrow===27&&WD_DEBUG.state().soldiers[0].learned.includes('goriki')),error);await c.close();
 }
 {
  const {page:p,context:c}=await setup();await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p);await finish(p);
  await p.evaluate(()=>{const D=WD_DEBUG;document.getElementById('start').click();D.stopSpawning();D.state().enemies.length=0;const e=D.addEnemy({hp:1e6,d:400,speed:0});D.towerGrowthApi.fire(D.state().towers[0],e);D.state().enemies.length=0;for(let i=0;i<20;i++)D.addEnemy({d:1e6,hp:100});D.step(.05);});
  check('Losing a wave does not grant unfinished research',await p.evaluate(()=>WD_DEBUG.state().hp===0&&WD_DEBUG.towerGrowthApi.research().arrow===13));
  await Promise.all([p.waitForEvent('load'),p.evaluate(()=>document.getElementById('wipeData').click())]);await p.waitForFunction(()=>window.WD_DEBUG);check('Explicit full data wipe resets type progression too',await p.evaluate(()=>WD_DEBUG.towerGrowthApi.research().arrow===0));await c.close();
 }
 // Real tower targeting, damage and slow in the production tick (not just stat labels).
 {
  const {page:p,context:c}=await setup();await seedLevels(p,{arrow:1000});await p.evaluate(()=>WD_DEBUG.setGold(10000));await build(p);
  const r=await p.evaluate(()=>{const D=WD_DEBUG;document.getElementById('start').click();D.stopSpawning();D.state().enemies.length=0;const e=D.addEnemy({d:400,hp:1000,speed:0,armor:0});D.step(.05);return {damage:1000-e.hp,xp:D.towerGrowthApi.research().arrow};});check('Actual fired arrow applies Lv1000 damage before victory XP is granted',near(r.damage,26.1)&&r.xp>0,r);await c.close();
 }
 for(const [width,height] of [[375,560],[390,844],[430,932],[1280,800]]){
  const {page:p,context:c}=await setup({},width,height);await openInfoEntry(p, '#towerGrowthOpen');
  const r=await p.evaluate(()=>{const sheet=document.querySelector('#towerGrowthSheet .sheet'),b=document.getElementById('towerGrowthClose').getBoundingClientRect();return {visible:!document.getElementById('towerGrowthSheet').hidden,cards:document.querySelectorAll('[data-growth]').length,overflow:document.documentElement.scrollWidth>innerWidth,fit:[...document.querySelectorAll('.tower-growth-card')].every(el=>el.getBoundingClientRect().right<=innerWidth),button:b.height>=44,sheet:sheet.scrollHeight>sheet.clientHeight};});
  check(`${width}×${height} research dialog opens with four readable cards and no horizontal overflow`,r.visible&&r.cards===4&&!r.overflow&&r.fit&&r.button,r);
  if(process.env.SCREENSHOTS){mkdirSync(process.env.SCREENSHOTS,{recursive:true});await p.screenshot({path:`${process.env.SCREENSHOTS}/tower-growth-${width}.png`});}
  await p.keyboard.press('Tab');check(`${width}px keyboard reaches the rules control`,await p.evaluate(()=>document.activeElement.matches('#towerGrowthSheet summary')));
  await p.keyboard.press('Escape');check(`${width}px dialog closes and restores opener focus`,await p.evaluate(()=>document.getElementById('towerGrowthSheet').hidden&&document.activeElement.id==='infoOpen'));await c.close();
 }
 check('No JavaScript errors in all browser cases',errors.length===0,errors);
 console.log(`結果: ${passes} 件成功 / ${failures} 件失敗`);process.exitCode=failures?1:0;
}finally{await browser.close();await new Promise(r=>server.close(r));}
