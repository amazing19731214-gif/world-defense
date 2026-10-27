#!/usr/bin/env node
// 全国67城の5刻み難易度、保存互換、WAVEと独立した実戦の被ダメージを確認。
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(readFileSync(new URL('../index.html', import.meta.url)));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const url = `http://127.0.0.1:${server.address().port}/?debug`;
let passes = 0, failures = 0;
const errors = [];
function check(name, ok, detail) {
  ok ? passes++ : failures++;
  console.log((ok ? '✓ ' : '✗ ') + name + (!ok && detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
}
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(() => { requestAnimationFrame = () => 0; Math.random = () => 0.5; });
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
try {
  await page.goto(url);
  const rows = await page.evaluate(() => {
    const a = WD_DEBUG.squadApi;
    return a.JAPAN.filter(p => a.PROVINCES[p].castle).map(p => {
      const C = a.NPC_CASTLES[a.PROVINCES[p].castle];
      return { p, castle: a.PROVINCES[p].castle, name: C.name, lv: a.recLevel(C), power: C.power, hp: C.hp };
    });
  });
  check('日本は自国＋67城、全城の推奨Lvが5刻みで重複しない', rows.length === 67 && rows.every((r, i) => r.lv === (i + 1) * 5));
  check('最初は清洲城Lv5、最後は金石城Lv335', rows[0].castle === 'kiyosu' && rows[0].lv === 5 && rows.at(-1).castle === 'kaneishi' && rows.at(-1).lv === 335);
  check('各城の敵の強さも順に増え、城の耐久は正の整数', rows.every((r, i) => Number.isInteger(r.hp) && r.hp > 0 && (!i || r.power > rows[i - 1].power)));
  // 更新前と同じ保存形式。全城制圧の記録を入れて、どの城も演習できるようにする。
  await page.evaluate(rows => {
    const types = ['spearman', 'cavalry', 'archer', 'medic'];
    const save = { seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
    for (let q = 1; q <= 4; q++) {
      save.squads.push({ id: q, type: types[q - 1], slot: q - 1 });
      for (let k = 0; k < 10; k++) save.soldiers.push({ id: (q - 1) * 10 + k + 1, type: types[q - 1], squadId: q, level: 80 });
    }
    localStorage.setItem('worldDefense.soldiers.v1', JSON.stringify(save));
    localStorage.setItem('worldDefense.conquest.v1', JSON.stringify({ version: 2, castles: Object.fromEntries(rows.map(r => [r.castle, { captured: true, attempts: 3, wins: 2 }])), unified: true, tenka: true }));
    localStorage.setItem('worldDefense.settings.v1', JSON.stringify({ waveGoal: 1000 }));
  }, rows);
  await page.reload();
  let r = await page.evaluate(() => {
    const a = WD_DEBUG.squadApi;
    return { owned: a.JAPAN.filter(a.ownsProvince).length, tenka: a.isTenka(), record: a.conquest().kiyosu };
  });
  check('既存の制圧・勝利・天下統一記録を引き継ぐ', r.owned === 68 && r.tenka && r.record.attempts === 3 && r.record.wins === 2, r);
  await page.locator('#mapOpen').tap(); await page.locator('[data-map-chapter="japan"]').tap();
  await page.locator('[data-map-road="saikaido"]').tap();
  check('全国画面に最後の城の推奨Lv335を表示', /推奨Lv335/.test(await page.locator('#mapBody').innerText()));
  check('iPhone幅で横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.SCREENSHOTS) {
    mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: process.env.SCREENSHOTS + '/japan-levels-390.png' });
  }
  await page.locator('#mapClose').tap();
  await page.evaluate(() => WD_DEBUG.defenseApi.save());
  const checkpoint = await page.evaluate(() => JSON.parse(localStorage.getItem('worldDefense.warlords.v1')));
  async function measure(wave, castle, source) {
    await page.evaluate(({ checkpoint, wave }) => {
      const data = structuredClone(checkpoint);
      data.defense.wave = wave;
      localStorage.setItem('worldDefense.warlords.v1', JSON.stringify(data));
    }, { checkpoint, wave });
    await page.reload();
    return page.evaluate(({ castle, source }) => {
      const D = WD_DEBUG, a = D.squadApi;
      a.setTarget(castle);
      const err = a.startBattle();
      if (err) return { err };
      if (D.state().paused) WD_DEBUG.playbackApi.setMode(WD_DEBUG.state().paused ? 'x1' : 'paused');
      const B = a.battle(), g = B.groups[0], s = g.list[0], e = B.garrison[0], t = B.towers[0];
      const initial = { wave: D.state().wave, max: B.castleMax, guardHp: e.max, towerDamage: t.damage };
      B.nextUnit = 4;
      g.state = 'fight';
      if (source === 'tower') Object.assign(t, D.pathAt(g.path, 500));
      g.d = source === 'guard' ? e.d : 500;
      g.x = source === 'guard' ? e.x : t.x;
      g.y = source === 'guard' ? e.y : t.y;
      for (const s of g.list) s.cd = 999;
      if (source === 'guard') { B.towers = []; B.garrison = [e]; e.cd = 0; }
      else { B.garrison = []; B.towers = [t]; t.cd = 0; }
      const before = s.hp;
      D.step(0.05);
      return { ...initial, damage: before - s.hp };
    }, { castle, source });
  }
  for (const source of ['guard', 'tower']) {
    const first = await measure(1, 'kiyosu', source), late = await measure(1000, 'kiyosu', source), last = await measure(1, 'kaneishi', source);
    check(`${source}: WAVE1と1000で同じ城のHP・攻撃・実被ダメージが一致`, first.wave === 1 && late.wave === 1000 && first.damage > 0 && first.damage === late.damage && first.guardHp === late.guardHp && first.max === late.max && first.towerDamage === late.towerDamage, { first, late });
    check(`${source}: 最後の城は最初の城より実被ダメージ・守備兵HPが大きい`, last.damage > first.damage && last.guardHp > first.guardHp, { first, last });
  }
  check('JavaScriptエラーなし', errors.length === 0, errors);
} finally {
  await browser.close(); server.close();
}
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exitCode = failures ? 1 : 0;
