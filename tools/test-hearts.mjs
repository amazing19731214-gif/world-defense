#!/usr/bin/env node
// Gold heart recovery: normal defense intermissions, run pricing, durable checkpoints, and mobile HUD.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
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
const W = 'worldDefense.warlords.v1', S = 'worldDefense.soldiers.v1', T = 'worldDefense.bookTransaction.v1';
const url = `http://127.0.0.1:${server.address().port}/?debug`;
let passes = 0, failures = 0;
const errors = [];
function check(name, condition, detail) {
  if (condition) passes++; else failures++;
  console.log((condition ? '✓ ' : '✗ ') + name + (condition || detail === undefined ? '' : ' ' + JSON.stringify(detail)));
}
async function setup() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(url);
  await page.evaluate(({ W, S }) => {
    localStorage.clear();
    localStorage.setItem(W, JSON.stringify({ owned: {}, tickets: 3 }));
    localStorage.setItem(S, JSON.stringify({ seq: 10, squadSeq: 1, squads: [{ id: 1, type: 'spearman', slot: 0 }], soldiers: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, type: 'spearman', squadId: 1, level: 30 })), fallen: [] }));
  }, { W, S });
  await page.reload();
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, context };
}
async function state(page) {
  return page.evaluate(() => {
    const D = WD_DEBUG, s = D.state(), h = D.heartApi.state();
    return { hp: s.hp, gold: s.gold, purchases: h.purchases, price: D.heartApi.price(), maxHp: h.maxHp };
  });
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
async function damage(page, n = 5) {
  await page.evaluate(n => {
    const D = WD_DEBUG;
    document.getElementById('start').click(); D.stopSpawning(); D.state().enemies.length = 0;
    for (let i = 0; i < n; i++) D.addEnemy({ d: 1e6, hp: 100 });
    D.step(0.1); D.setGold(100000);
  }, n);
}
async function buy(page) { return page.evaluate(() => WD_DEBUG.heartApi.buy()); }
async function rejected(page) {
  const before = await state(page), error = await buy(page), after = await state(page);
  return { before, after, error, ok: typeof error === 'string' && !!error && same(before, after) };
}
async function reload(page) { await page.reload(); await page.waitForFunction(() => window.WD_DEBUG); }
try {
  {
    const { page, context } = await setup();
    let r = await state(page);
    check('Fresh run and legacy empty hero save begin at 20 HP, zero purchases, 1000G', r.hp === 20 && r.maxHp === 20 && r.purchases === 0 && r.price === 1000 && await page.locator('#wave').textContent() === 'WAVE 0/20', r);
    r = await rejected(page);
    check('Full castle rejects recovery without changing resources or price', r.ok, r);
    await damage(page);
    r = await page.evaluate(() => ({ hp: WD_DEBUG.state().hp, playing: WD_DEBUG.state().playing, wave: WD_DEBUG.state().wave }));
    check('Damage fixture reaches a normal defense intermission with 15 HP', r.hp === 15 && !r.playing && r.wave === 1, r);
    for (const [i, gold, price] of [[1, 99000, 2000], [2, 97000, 4000], [3, 93000, 8000]]) {
      const error = await buy(page); r = await state(page);
      check(`Purchase ${i} heals exactly one HP and doubles the next price`, error === null && r.hp === 15 + i && r.gold === gold && r.purchases === i && r.price === price, { error, ...r });
    }
    await page.evaluate(() => WD_DEBUG.setGold(7999));
    r = await rejected(page);
    check('Insufficient gold rejects the 8000G purchase atomically', r.ok, r);
    await page.evaluate(() => { WD_DEBUG.setGold(93000); WD_DEBUG.defenseApi.save(); });
    const checkpoint = await page.evaluate(W => JSON.parse(localStorage.getItem(W)).defense, W);
    check('Defense checkpoint stores the run purchase count', checkpoint.heartPurchases === 3, checkpoint.heartPurchases);
    await reload(page); r = await state(page);
    check('Reload retains HP, gold, purchases, and the next price', r.hp === 18 && r.gold === 93000 && r.purchases === 3 && r.price === 8000, r);
    const error = await buy(page); r = await state(page);
    check('First purchase after reload uses the retained 8000G price', error === null && r.hp === 19 && r.gold === 85000 && r.purchases === 4 && r.price === 16000, { error, ...r });
    await buy(page); const full = await rejected(page);
    check('Recovery caps at 20 HP and the following purchase is rejected', full.ok && full.after.hp === 20 && full.after.gold === 69000 && full.after.purchases === 5 && full.after.price === 32000, full);
    await page.evaluate(() => document.getElementById('reset').click()); await reload(page); r = await state(page);
    check('Starting over resets HP and purchase pricing across reload', r.hp === 20 && r.purchases === 0 && r.price === 1000, r);
    await damage(page); await buy(page);
    await page.evaluate(W => { const data = JSON.parse(localStorage.getItem(W)); delete data.defense.heartPurchases; localStorage.setItem(W, JSON.stringify(data)); }, W);
    await reload(page); r = await state(page);
    check('Legacy checkpoint without heartPurchases loads with count zero', r.hp === 16 && r.purchases === 0 && r.price === 1000, r);
    await context.close();
  }
  for (const mode of ['playing', 'training', 'battle', 'defeat']) {
    const { page, context } = await setup(); await damage(page);
    const active = await page.evaluate(mode => {
      const D = WD_DEBUG;
      if (mode === 'playing') { document.getElementById('start').click(); return D.state().playing; }
      if (mode === 'training') { D.trainingApi.startTraining('beginner'); return !!D.trainingApi.training(); }
      if (mode === 'battle') { D.squadApi.setTarget('kiyosu'); D.squadApi.startBattle(); return !!D.squadApi.battle(); }
      document.getElementById('start').click(); D.stopSpawning(); D.state().enemies.length = 0;
      for (let i = 0; i < 20; i++) D.addEnemy({ d: 1e6, hp: 100 });
      D.step(0.1); D.setGold(100000); return D.state().hp <= 0 && D.state().over;
    }, mode);
    const r = await rejected(page);
    check(`Recovery is rejected during ${mode} without changing state`, active && r.ok, { active, ...r });
    await context.close();
  }
  for (const failKey of [W, S]) {
    const { page, context } = await setup(); await damage(page);
    await page.evaluate(() => WD_DEBUG.defenseApi.save());
    const error = await page.evaluate(failKey => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) { if (k === failKey) throw Error('heart test: staged save failure'); return original.call(this, k, v); };
      try { return WD_DEBUG.heartApi.buy(); } finally { Storage.prototype.setItem = original; }
    }, failKey);
    let r = await state(page);
    check(`Durable WAL counts purchase as success when staging ${failKey} fails`, error === null && r.hp === 16 && r.gold === 99000 && r.purchases === 1 && r.price === 2000, { error, ...r });
    await reload(page); r = await state(page);
    check(`Reload recovers the complete committed purchase after ${failKey} failure`, r.hp === 16 && r.gold === 99000 && r.purchases === 1 && r.price === 2000, r);
    await context.close();
  }
  {
    const { page, context } = await setup(); await damage(page);
    await page.evaluate(() => WD_DEBUG.defenseApi.save());
    const before = await state(page);
    const error = await page.evaluate(T => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v) { if (k === T) throw Error('heart test: WAL write failure'); return original.call(this, k, v); };
      try { return WD_DEBUG.heartApi.buy(); } finally { Storage.prototype.setItem = original; }
    }, T);
    const immediate = await state(page);
    await page.evaluate(() => WD_DEBUG.defenseApi.save()); await reload(page);
    const after = await state(page);
    check('WAL failure rolls back HP, gold, count and cannot leak into a later save', typeof error === 'string' && !!error && same(before, immediate) && same(before, after), { error, before, immediate, after });
    await context.close();
  }
  {
    const { page, context } = await setup(); await damage(page);
    await page.tap('#hp');
    const modal = await page.evaluate(() => {
      const sheet = document.getElementById('heartSheet'), button = document.getElementById('heartBuy'), hp = document.getElementById('hp');
      const rect = button.getBoundingClientRect();
      return { open: !sheet.hidden, buttonRole: hp.getAttribute('role'), modal: sheet.getAttribute('aria-modal') || sheet.querySelector('[aria-modal]')?.getAttribute('aria-modal'), fit: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, disabled: button.disabled, text: sheet.textContent };
    });
    await page.tap('#heartBuy');
    const r = await state(page);
    if (process.env.SCREENSHOTS) { mkdirSync(process.env.SCREENSHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOTS, 'hearts-390.png') }); }
    await page.evaluate(() => { const close = document.getElementById('heartClose'); if (!document.getElementById('heartSheet').hidden) close.click(); });
    check('390px touch HUD opens an accessible, fitting modal and buys one heart', modal.open && modal.buttonRole === 'button' && modal.modal === 'true' && modal.fit && !modal.disabled && /1[,.]?000/.test(modal.text) && r.hp === 16 && r.gold === 99000 && r.purchases === 1 && await page.locator('#heartSheet').isHidden(), { modal, ...r });
    await context.close();
  }
  check('No JavaScript exceptions across recovery scenarios', errors.length === 0, errors);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`Result: ${passes} passed / ${failures} failed`);
process.exitCode = failures ? 1 : 0;
