#!/usr/bin/env node
// Selectable training goals: persistence, mobile controls, finite completion, and isolation.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.execPath, '../../lib/node_modules/playwright'))); }
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(readFileSync(new URL('../index.html', import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const url = `http://127.0.0.1:${server.address().port}/?debug`;
const S = 'worldDefense.soldiers.v1', W = 'worldDefense.warlords.v1', T = 'worldDefense.training.v1';
let passes = 0, failures = 0;
const errors = [];
function check(name, condition, detail) {
  if (condition) passes++; else failures++;
  console.log((condition ? '✓ ' : '✗ ') + name + (condition || detail === undefined ? '' : ' ' + JSON.stringify(detail)));
}
async function setup(training = { best: { beginner: { waves: 3, level: 6 } }, clears: { beginner: 2 } }) {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(url);
  await page.evaluate(({ S, W, T, training }) => {
    localStorage.clear();
    localStorage.setItem(W, JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [] }));
    localStorage.setItem(T, JSON.stringify(training));
    localStorage.setItem(S, JSON.stringify({ version: 1, seq: 10, squadSeq: 1,
      squads: [{ id: 1, type: 'spearman', slot: 0 }], fallen: [],
      soldiers: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, type: 'spearman', squadId: 1, level: 60 })) }));
  }, { S, W, T, training });
  await page.reload(); await page.waitForFunction(() => window.WD_DEBUG);
  return { page, context };
}
async function advance(page, count) {
  return page.evaluate(count => {
    for (let i = 0; i < count; i++) {
      document.getElementById('start').click();
      WD_DEBUG.stopSpawning(); WD_DEBUG.state().enemies.length = 0; WD_DEBUG.step(0.1);
    }
    const a = WD_DEBUG.trainingApi, t = a.training();
    return { active: !!t, wave: WD_DEBUG.state().wave, cleared: t?.cleared,
      clearXp: t && Object.values(t.rec).reduce((n, r) => n + r.clear, 0) };
  }, count);
}
async function start(page, key, waves) {
  return page.evaluate(({ key, waves }) => {
    const a = WD_DEBUG.trainingApi, error = waves === undefined ? a.startTraining(key) : a.startTraining(key, waves);
    if (!error) { window.goalRun = a.training(); WD_DEBUG.squadApi.deployReserve(WD_DEBUG.state().squads[0], 650, 300); }
    return error;
  }, { key, waves });
}
try {
  {
    const { page, context } = await setup();
    let r = await page.evaluate(() => WD_DEBUG.trainingApi.trainingSave());
    check('Legacy training save defaults to ten waves and retains records', r.waves === 10 && r.best.beginner.waves === 3 && r.clears.beginner === 2, r);
    r = await page.evaluate(() => ({ goals: WD_DEBUG.trainingApi.TRAINING.waveGoals, legacy: WD_DEBUG.trainingApi.TRAINING.waves }));
    check('Allowed goals are 10, 20, 30, 50, 100; legacy default remains ten', JSON.stringify(r.goals) === '[10,20,30,50,100]' && r.legacy === 10, r);
    await page.tap('#trainingOpen');
    r = await page.evaluate(() => { const s = document.getElementById('trainingWaves'), b = document.getElementById('trStart');
      return { options: [...s.options].map(o => Number(o.value)), value: s.value, before: !!(s.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
    check('Goal dropdown precedes Start and initially selects ten', JSON.stringify(r.options) === '[10,20,30,50,100]' && r.value === '10' && r.before, r);
    await page.locator('#trainingWaves').scrollIntoViewIfNeeded();
    r = await page.evaluate(() => { const s = document.getElementById('trainingWaves'), b = s.getBoundingClientRect();
      return { fit: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, height: b.height, overflow: document.documentElement.scrollWidth > innerWidth }; });
    check('375px touch goal selector fits the viewport with a 44px target', r.fit && r.height >= 44 && !r.overflow, r);
    await page.tap('#trainingWaves'); await page.selectOption('#trainingWaves', '20');
    await page.reload(); await page.waitForFunction(() => window.WD_DEBUG); await page.tap('#trainingOpen');
    r = await page.evaluate(T => ({ ui: document.getElementById('trainingWaves').value, memory: WD_DEBUG.trainingApi.trainingSave().waves, saved: JSON.parse(localStorage.getItem(T)).waves }), T);
    check('Touch selection of twenty persists immediately across reload', r.ui === '20' && r.memory === 20 && r.saved === 20, r);
    r = await page.evaluate(() => { const a = WD_DEBUG.trainingApi; return ['beginner', 'advanced', 'super'].every(key => {
      const D = a.TRAINING.diffs[key]; return [20, 100].every(waves => {
        const levels = Array.from({ length: waves }, (_, i) => a.trainLevel({ D, waves }, i + 1));
        return levels[0] === D.from && levels.at(-1) === D.to && levels.every((v, i) => v >= D.from && v <= D.to && (!i || v >= levels[i - 1]));
      }) && a.trainLevel({ D }, 10) === D.to;
    }); });
    check('All finite difficulties scale from their first to last level over 20/100 waves, with legacy fallback', r);
    await page.tap('#trClose');
    await page.evaluate(() => {
      document.getElementById('start').click(); WD_DEBUG.stopSpawning(); WD_DEBUG.state().enemies.length = 0;
      for (let i = 0; i < 5; i++) WD_DEBUG.addEnemy({ d: 1e6, hp: 100 }); WD_DEBUG.step(0.1); WD_DEBUG.setGold(777);
      WD_DEBUG.state().towers.push({ id: 44, type: 'arrow', x: 330, y: 300, level: 2, spent: 170, hp: 80, cd: 0 });
      WD_DEBUG.defenseApi.save();
      window.goalTowerSnapshot = () => JSON.stringify(WD_DEBUG.state().towers.map(t => [t.id, t.type, t.x, t.y, t.level, t.spent, t.hp, t.destroyed, t.cd]));
      const s = WD_DEBUG.state(); window.normalBefore = { wave: s.wave, hp: s.hp, gold: s.gold, towers: goalTowerSnapshot() };
    });
    const checkpoint = await page.evaluate(W => localStorage.getItem(W) && JSON.parse(localStorage.getItem(W)).defense, W);
    await page.tap('#trainingOpen'); await page.tap('#trStart');
    r = await page.evaluate(() => { const a = WD_DEBUG.trainingApi, s = WD_DEBUG.state(); window.goalRun = a.training();
      WD_DEBUG.squadApi.deployReserve(s.squads[0], 650, 300);
      s.towers[0].level = 5; s.towers[0].hp = 1; s.towers.push({ id: 99, type: 'cannon', x: 420, y: 300, level: 1, spent: 180 });
      return { waves: a.training().waves, text: document.getElementById('wave').textContent, info: document.getElementById('trainInfo').textContent }; });
    check('UI starts the persisted twenty-wave goal and displays its progress and bonus threshold', r.waves === 20 && /0\/20/.test(r.text) && /20ウェーブ後/.test(r.info), r);
    r = await page.evaluate(() => { const a = WD_DEBUG.trainingApi, old = a.training(), error = a.startTraining('beginner', 100); return { error, same: old === a.training(), waves: a.training().waves, saved: a.trainingSave().waves }; });
    check('An active run rejects goal changes without changing its saved selection', typeof r.error === 'string' && r.same && r.waves === 20 && r.saved === 20, r);
    await page.tap('#trainingOpen');
    check('Active training sheet has no editable goal selector or Start button', await page.locator('#trainingWaves').count() === 0 && await page.locator('#trStart').count() === 0);
    await page.tap('#trClose'); r = await advance(page, 10);
    check('Ten cleared waves do not finish a selected twenty-wave run or award clear XP', r.active && r.cleared === 10 && r.clearXp === 0, r);
    r = await advance(page, 9);
    check('Wave nineteen still has no completion bonus', r.active && r.cleared === 19 && r.clearXp === 0, r);
    await advance(page, 1);
    r = await page.evaluate(() => { const a = WD_DEBUG.trainingApi, s = WD_DEBUG.state(), t = window.goalRun;
      return { active: !!a.training(), result: t.result, cleared: t.cleared, reward: t.reward, lastLv: t.lastLv,
        bonus: Object.values(t.rec).reduce((n, v) => n + v.clear, 0), clears: a.trainingSave().clears.advanced,
        normal: s.wave === normalBefore.wave && s.hp === normalBefore.hp && goalTowerSnapshot() === normalBefore.towers,
        gold: s.gold, beforeGold: normalBefore.gold, body: document.getElementById('battleBody').textContent }; });
    check('Exactly twenty waves finish once with unchanged gold and clear-XP formulas', !r.active && r.result === 'clear' && r.cleared === 20 && r.lastLv === 100 && r.reward === 500 && r.bonus === 12360 && r.clears === 1 && /20\/20/.test(r.body), r);
    check('Completion restores the normal defense wave, HP, and towers, adding only earned gold', r.normal && r.gold === r.beforeGold + 500, r);
    r = await page.evaluate(W => ({ checkpoint: JSON.parse(localStorage.getItem(W)).defense, tickets: JSON.parse(localStorage.getItem(W)).tickets }), W);
    check('Training leaves the normal defense checkpoint and gacha tickets unchanged', JSON.stringify(r.checkpoint) === JSON.stringify(checkpoint) && r.tickets === 3, r);
    r = await page.evaluate(() => { const snapshot = () => JSON.stringify({ gold: WD_DEBUG.state().gold, soldiers: WD_DEBUG.state().soldiers.map(s => [s.level, s.xp]), clears: WD_DEBUG.trainingApi.trainingSave().clears });
      const before = snapshot(); WD_DEBUG.trainingApi.endTraining('clear'); return before === snapshot(); });
    check('Repeated completion cannot duplicate gold, XP, or clear records', r);
    await context.close();
  }
  {
    const { page, context } = await setup({ waves: 20, best: {}, clears: {} });
    const invalid = await page.evaluate(() => { const a = WD_DEBUG.trainingApi; return [0, 1, 11, 25, 101, -10, 20.5, NaN, Infinity, '20', null].every(w => {
      const error = a.startTraining('beginner', w); return typeof error === 'string' && !!error && !a.training() && a.trainingSave().waves === 20;
    }); });
    check('Unsupported, fractional, nonfinite, and nonnumeric goals are rejected without state changes', invalid);
    await start(page, 'beginner', 20); await advance(page, 9);
    let r = await page.evaluate(() => { const a = WD_DEBUG.trainingApi, t = a.training(), before = t.keep.gold; a.endTraining('retreat');
      return { result: t.result, reward: t.reward, bonus: Object.values(t.rec).reduce((n, v) => n + v.clear, 0), gold: WD_DEBUG.state().gold - before, clears: a.trainingSave().clears.beginner }; });
    check('Retreat before the chosen goal pays only nine wave rewards and no completion bonus', r.result === 'retreat' && r.reward === 90 && r.gold === 90 && r.bonus === 0 && !r.clears, r);
    await start(page, 'beginner', 100);
    r = await page.evaluate(T => ({ active: WD_DEBUG.trainingApi.training().waves, memory: WD_DEBUG.trainingApi.trainingSave().waves, saved: JSON.parse(localStorage.getItem(T)).waves }), T);
    check('Explicit API start also persists the chosen hundred-wave goal', r.active === 100 && r.memory === 100 && r.saved === 100, r);
    r = await advance(page, 99);
    check('A hundred-wave run continues through ninety-nine without clear XP', r.active && r.cleared === 99 && r.clearXp === 0, r);
    await advance(page, 1);
    r = await page.evaluate(() => ({ active: !!WD_DEBUG.trainingApi.training(), result: goalRun.result, reward: goalRun.reward, level: goalRun.lastLv, clears: WD_DEBUG.trainingApi.trainingSave().clears.beginner }));
    check('A hundred-wave run clears at one hundred with the final enemy level and expected gold', !r.active && r.result === 'clear' && r.reward === 1050 && r.level === 30 && r.clears === 1, r);
    await context.close();
  }
  {
    const { page, context } = await setup({ best: {}, clears: {} });
    await start(page, 'beginner'); await advance(page, 10);
    const r = await page.evaluate(() => ({ active: !!WD_DEBUG.trainingApi.training(), waves: goalRun.waves, reward: goalRun.reward, result: goalRun.result }));
    check('Legacy/default ten-wave run still completes at ten with 150G', !r.active && r.waves === 10 && r.result === 'clear' && r.reward === 150, r);
    await context.close();
  }
  {
    const { page, context } = await setup({ waves: 20, best: {}, clears: {} });
    await page.tap('#trainingOpen'); await page.tap('[data-tr-diff="endless"]');
    check('Endless disables the finite goal selector while retaining its choice', await page.locator('#trainingWaves').isDisabled() && await page.locator('#trainingWaves').inputValue() === '20');
    await page.tap('#trStart'); await advance(page, 21);
    const r = await page.evaluate(() => { const a = WD_DEBUG.trainingApi, t = a.training(); return { active: !!t, cleared: t?.cleared, label: document.getElementById('wave').textContent,
      growing: t && a.trainLevel(t, 21) > a.trainLevel(t, 20), bonus: t && Object.values(t.rec).reduce((n, v) => n + v.clear, 0) }; });
    check('Endless passes the selected twenty-wave count and keeps growing without a clear bonus', r.active && r.cleared === 21 && /修練 21$/.test(r.label) && r.growing && r.bonus === 0, r);
    await context.close();
  }
  check('No JavaScript exceptions across training-goal scenarios', errors.length === 0, errors);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
console.log(`Result: ${passes} passed / ${failures} failed`);
process.exitCode = failures ? 1 : 0;
