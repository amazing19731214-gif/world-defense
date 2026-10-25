#!/usr/bin/env node
// 防衛戦の途中保存・再開。進行判定の試験では敵を除去し、実際の攻略難度とは区別する。
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.execPath, '../../lib/node_modules/playwright'))); }
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(new URL('../index.html', import.meta.url))); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const W = 'worldDefense.warlords.v1', S = 'worldDefense.soldiers.v1', T = 'worldDefense.bookTransaction.v1';
const url = `http://127.0.0.1:${server.address().port}/?debug`;
let passes = 0, failures = 0;
const errors = [];
function check(name, condition, detail) { if (condition) passes++; else failures++; console.log((condition ? '✓ ' : '✗ ') + name + (condition || detail === undefined ? '' : ' ' + JSON.stringify(detail))); }
async function setup() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
  await page.goto(url);
  await page.evaluate(({ W, S }) => {
    localStorage.clear();
    localStorage.setItem(W, JSON.stringify({ owned: { shingen: 1, kanetsugu: 1 }, tickets: 3 }));
    localStorage.setItem(S, JSON.stringify({ seq: 10, squadSeq: 1, squads: [{ id: 1, type: 'spearman', slot: 0 }], soldiers: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, type: 'spearman', squadId: 1, level: 30 })), fallen: [] }));
    localStorage.setItem('worldDefense.settings.v1', JSON.stringify({ auto: true, waveGoal: 100 }));
  }, { W, S });
  await page.reload(); await page.waitForFunction(() => window.WD_DEBUG);
  return { context, page };
}
async function advance(page, n) {
  return page.evaluate(n => {
    const D = WD_DEBUG;
    for (let i = 0; i < n; i++) {
      if (!D.state().playing) document.getElementById('start').click();
      D.stopSpawning(); D.state().enemies.length = 0; D.step(0.1);
    }
    return { wave: D.state().wave, over: D.state().over };
  }, n);
}
async function saved(page) { return page.evaluate(W => JSON.parse(localStorage.getItem(W)).defense, W); }
try {
  {
    const { page, context } = await setup();
    check('旧形式のセーブはWAVE0から起動', (await page.locator('#wave').textContent()) === 'WAVE 0/100');
    await advance(page, 2);
    let r = await page.evaluate(() => {
      const D = WD_DEBUG, q = D.state().squads[0];
      D.setGold(4321); D.squadApi.deployReserve(q, 650, 300);
      const t = { id: 50, type: 'arrow', level: 3, x: 650, y: 220, spent: 600, hp: 111, cd: 0.7 };
      D.state().towers.push(t); D.heroApi.assignHero('shingen', q); D.heroApi.assignHero('kanetsugu', t);
      D.heroApi.heroState().shingen.cd = 17;
      D.state().soldiers[0].hp = 50;
      document.getElementById('speed').click();
      return { ok: D.defenseApi.save(), wave: D.state().wave, hp: D.state().hp, gold: D.state().gold, tickets: D.heroApi.save().tickets, soldier: D.state().soldiers[0].id };
    });
    check('準備中の保存が成功', r.ok === true, r);
    const expected = r;
    check('通常ウェーブクリアで自動保存済み', !!(await saved(page)));
    await page.reload();
    r = await page.evaluate(() => {
      const D = WD_DEBUG, s = D.state(), q = s.squads[0], t = s.towers[0];
      return { wave: s.wave, hp: s.hp, gold: s.gold, speed: s.speed, playing: s.playing, paused: s.paused,
        tower: t && { id:t.id,level:t.level,hp:t.hp,x:t.x,y:t.y,spent:t.spent },
        squad: { state:q.state,x:q.x,y:q.y }, soldierHp:s.soldiers[0].hp,
        heroTower:D.heroApi.heroState().kanetsugu.tower?.id, heroSquad:D.heroApi.heroState().shingen.squad?.id,
        cd:D.heroApi.heroState().shingen.cd, tickets:D.heroApi.save().tickets };
    });
    check('再読み込みでWAVE・城HP・軍資金・速度を復元', r.wave === 2 && r.hp === expected.hp && r.gold === expected.gold && r.speed === 2, r);
    check('塔のレベル・耐久・位置・建設費を復元', r.tower?.id === 50 && r.tower.level === 3 && r.tower.hp === 111 && r.tower.x === 650 && r.tower.y === 220 && r.tower.spent === 600, r);
    check('部隊配置と生存兵HPを復元', r.squad.state === 'deployed' && r.squad.x === 650 && r.squad.y === 300 && r.soldierHp === 50, r);
    check('武将配属・再使用待ちを復元', r.heroTower === 50 && r.heroSquad === 1 && r.cd === 17, r);
    check('再開時は停止して操作を待つ', !r.playing && r.paused, r);
    check('再開だけではクリア報酬を再取得しない', r.tickets === expected.tickets && r.gold === expected.gold, r);
    await page.evaluate(() => WD_DEBUG.step(10));
    check('AUTO ONでも再開直後に勝手に次へ進まない', (await page.locator('#wave').textContent()) === 'WAVE 2/100');
    if (process.env.SCREENSHOTS) { mkdirSync(process.env.SCREENSHOTS, { recursive: true }); await page.screenshot({ path:path.join(process.env.SCREENSHOTS,'checkpoint-resumed-390.png') }); }
    await page.evaluate(() => { WD_DEBUG.setGold(3210); document.getElementById('start').click(); });
    await page.reload();
    check('次ウェーブ開始前の準備も保存される', await page.evaluate(() => WD_DEBUG.state().wave === 2 && WD_DEBUG.state().gold === 3210 && !WD_DEBUG.state().playing));
    await page.evaluate(() => WD_DEBUG.squadApi.killSoldier(WD_DEBUG.state().soldiers[0], WD_DEBUG.state().squads[0]));
    await page.reload();
    check('チェックポイントより後の戦死者を復活させない', await page.evaluate(id => WD_DEBUG.state().soldiers.every(s => s.id !== id), expected.soldier));
    await page.evaluate(() => document.getElementById('reset').click()); await page.reload();
    check('最初からの後に古い途中保存へ戻らない', (await page.locator('#wave').textContent()) === 'WAVE 0/100');
    await context.close();
  }
  for (const failKey of [W, S, T]) {
    const { page, context } = await setup(); await advance(page, 1);
    const before = await page.evaluate(() => WD_DEBUG.state().gold);
    const r = await page.evaluate(failKey => {
      WD_DEBUG.setGold(8765);
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k,v) { if (k === failKey) throw Error('checkpoint test: save failed'); return original.call(this,k,v); };
      let ok; try { ok = WD_DEBUG.defenseApi.save(); } finally { Storage.prototype.setItem = original; }
      return { ok };
    }, failKey);
    await page.reload();
    const after = await page.evaluate(() => ({ wave:WD_DEBUG.state().wave,gold:WD_DEBUG.state().gold, soldiers:WD_DEBUG.state().soldiers.length }));
    check('保存失敗でも旧/新の整合した状態で再開: ' + failKey, after.wave === 1 && after.soldiers === 10 && after.gold === (failKey === T ? before : 8765), { r, after, before });
    await context.close();
  }
  {
    const { page, context } = await setup(); await advance(page, 1);
    const before = JSON.stringify(await saved(page));
    const r = await page.evaluate(() => { const D=WD_DEBUG; const error=D.trainingApi.startTraining('beginner');return { error, ok:D.defenseApi.save() }; });
    check('修練場の状態を防衛戦の保存に使わない', r.ok === false && JSON.stringify(await saved(page)) === before, r);
    await context.close();
  }
  {
    const { page, context } = await setup(); await advance(page, 1);
    const before = JSON.stringify(await saved(page));
    const r = await page.evaluate(() => { const D=WD_DEBUG;const error=D.squadApi.startBattle();return {error,battle:!!D.squadApi.battle(),ok:D.defenseApi.save()}; });
    check('攻城戦の状態を防衛戦の保存に使わない', r.battle && r.ok === false && JSON.stringify(await saved(page)) === before, r);
    await context.close();
  }
  {
    const { page, context } = await setup();
    await advance(page, 100); await page.reload();
    check('WAVE100勝利状態も復元して101へ進まない', await page.evaluate(() => { WD_DEBUG.step(10);return WD_DEBUG.state().wave === 100 && WD_DEBUG.state().over && !WD_DEBUG.state().playing; }));
    await context.close();
  }
  {
    const { page, context } = await setup(); await advance(page, 1);
    await page.evaluate(W => { const d=JSON.parse(localStorage.getItem(W));d.defense={version:1,wave:999999,gold:'bad',towers:[{id:1,type:'nonexistent'}]};localStorage.setItem(W,JSON.stringify(d)); },W);
    await page.reload();
    check('壊れた途中保存を安全に無視し兵士は保持', await page.evaluate(() => WD_DEBUG.state().wave === 0 && WD_DEBUG.state().soldiers.length === 10));
    await context.close();
  }
  {
    const { page, context } = await setup(); await advance(page, 1);
    await page.evaluate(() => { document.getElementById('start').click();WD_DEBUG.stopSpawning();for(let i=0;i<20;i++) WD_DEBUG.addEnemy({d:1e6,hp:100});WD_DEBUG.step(0.1); });
    await page.reload();
    check('敗北後に直前の生存城へ巻き戻らない', await page.evaluate(() => WD_DEBUG.state().wave === 0 || WD_DEBUG.state().over));
    await context.close();
  }
  {
    const { page, context } = await setup(); await advance(page, 4);
    const before = await page.evaluate(() => WD_DEBUG.heroApi.save().tickets);
    const killBoss = async () => page.evaluate(() => {
      const D = WD_DEBUG;
      document.getElementById('start').click(); D.stopSpawning();
      D.addEnemy({hp:1e6,speed:0});
      D.addEnemy({kind:'boss',hp:0,reward:0,speed:0}); D.step(0.1);
      return {wave:D.state().wave,playing:D.state().playing,tickets:D.heroApi.save().tickets,bonus:D.config.GACHA.ticketsPerBoss};
    });
    const first = await killBoss();
    check('大将撃破の券を通常どおり獲得', first.playing && first.wave === 5 && first.tickets === before + first.bonus, first);
    await page.reload();
    const retry = await killBoss();
    check('中断した同じウェーブの大将券は二重に受け取らない', retry.tickets === first.tickets, retry);
    await context.close();
  }
  for (const failKey of [W, S, T]) {
    const { page, context } = await setup(); await advance(page, 1);
    const before = await page.evaluate(() => ({gold:WD_DEBUG.state().gold,tickets:WD_DEBUG.heroApi.save().tickets}));
    await page.evaluate(failKey => {
      document.getElementById('start').click(); WD_DEBUG.stopSpawning(); WD_DEBUG.state().enemies.length=0;
      const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k===failKey)throw Error('injected clear-save failure');return original.call(this,k,v);};
      try{WD_DEBUG.step(0.1);}finally{Storage.prototype.setItem=original;}
    },failKey);
    await page.reload();
    const after=await page.evaluate(()=>({wave:WD_DEBUG.state().wave,gold:WD_DEBUG.state().gold,tickets:WD_DEBUG.heroApi.save().tickets}));
    const committed=failKey!==T;
    check('終了報酬と進行がまとめて旧/新状態になる: '+failKey, after.wave===(committed?2:1) && after.gold===before.gold+(committed?66:0) && after.tickets===before.tickets+(committed?1:0),{before,after});
    await context.close();
  }
  check('全ケースでJavaScript例外なし', errors.length === 0, errors);
} finally { await browser.close(); await new Promise(r => server.close(r)); }
console.log(`結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exitCode = failures ? 1 : 0;
