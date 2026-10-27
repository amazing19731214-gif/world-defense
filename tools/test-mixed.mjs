#!/usr/bin/env node
// 異なる兵種が同じ部隊に在籍する動作確認：ランダム雇用・移籍・個別戦闘・撤退・保存・攻城戦
//   node tools/test-mixed.mjs
//   SCREENSHOTS=dir node tools/test-mixed.mjs … 画面写真も保存
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href + "?debug";
const shots = process.env.SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

let failures = 0,
  passes = 0;
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const SKEY = "worldDefense.soldiers.v1";
// 第一部隊：槍兵5人（Lv5）
const save = {
  version: 1,
  seq: 5,
  squadSeq: 1,
  squads: [{ id: 1, type: "spearman", slot: 0 }],
  soldiers: [1, 2, 3, 4, 5].map((id) => ({ id, type: "spearman", squadId: 1, level: 5 })),
  fallen: [],
};
async function newContext(seed) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate((seed) => {
    localStorage.clear();
    localStorage.setItem("worldDefense.soldiers.v1", seed);
  }, seed);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
// 第一部隊の様子
const squad = (page) =>
  ev(page, () => {
    const a = WD_DEBUG.squadApi,
      q = WD_DEBUG.state().squads[0];
    return {
      type: q.type,
      name: a.squadName(q),
      mixed: a.isMixed(q),
      types: a.roster(q).map((s) => s.type),
    };
  });

let { page, errors, context } = await newContext(JSON.stringify(save));

console.log("■ ランダム雇用と兵士ごとの兵種");
await ev(page, () => WD_DEBUG.setGold(9999));
await page.tap("#organize");
check("雇用・補充の兵種選択は無い",await page.locator('[data-u], [data-recruit-type]').count()===0);
async function addType(type){return ev(page,type=>{const pool=Object.keys(WD_DEBUG.unitConfig.SOLDIER_TYPES).filter(t=>WD_DEBUG.unitConfig.SOLDIER_TYPES[t].enabled);let n=0;WD_DEBUG.recruitApi.setRng(()=>n++%2===0?(pool.indexOf(type)+.5)/pool.length:0);return WD_DEBUG.recruitApi.recruit().error||null;},type);}
await addType('archer');
let q = await squad(page);
check("ランダム抽選の弓兵が既存の空き部隊へ入る",q.mixed&&q.types.filter(t=>t==='archer').length===1);
check("部隊名には兵種や混成の接尾辞を付けない",q.name==='第一部隊');
check("戦闘用の主な兵種は一番多い槍兵",q.type==='spearman');
check("雇用費は固定24G",await ev(page,()=>WD_DEBUG.state().gold)===9999-24);
for(const type of ['medic','ashigaru','cavalry'])await addType(type);
q=await squad(page);
check("槍兵5・弓兵・衛生兵・足軽・騎兵の9人",q.types.length===9&&['archer','medic','ashigaru','cavalry'].every(t=>q.types.includes(t)));
check("画面上に混成と表示しない",!(await page.locator('#squadSheet').innerText()).includes('混成'));
const lay = await ev(page, () => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
}));
check("390px で横スクロールなし", !lay.hScroll);
await page.tap("#squadClose");

console.log("■ 足止め・敵の騎兵・撤退");
let r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0];
  a.deployReserve(q, 650, 300);
  const cap = a.blockCap(q),
    retreat = a.retreatTimeOf(q);
  // 槍兵が全員倒れると、残った兵種（足軽2）の足止めになる
  for (const m of a.roster(q)) if (m.type === "spearman") m.alive = false;
  return { cap, retreat, capAfter: a.blockCap(q) };
});
check("足止めは一番多い兵種に合わせる（槍兵3）", r.cap === 3, JSON.stringify(r));
check("槍兵が全員倒れると足軽の足止め（2）に下がる", r.capAfter === 2, JSON.stringify(r));
check("撤退は一番遅い兵士に合わせる（3秒）", r.retreat === 3, JSON.stringify(r));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0];
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const e = WD_DEBUG.addEnemy({ kind: "wolf", d: 0, hp: 1e9, speed: 0 });
  Object.assign(e, { x: q.x, y: q.y });
  a.assignBlocks();
  const withCav = e.blockedBy === q;
  e.blockedBy = null;
  for (const m of a.roster(q)) if (m.type === "cavalry") m.alive = false;
  a.assignBlocks();
  const without = e.blockedBy === q;
  s.enemies.splice(s.enemies.indexOf(e), 1);
  return { withCav, without };
});
check("騎兵がいれば敵の騎兵も止められる", r.withCav && !r.without, JSON.stringify(r));

console.log("■ 兵士ごとの戦い方");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0],
    list = a.members(q),
    archer = list.find((m) => m.type === "archer"),
    medic = list.find((m) => m.type === "medic"),
    ash = list.find((m) => m.type === "ashigaru");
  // 足軽には届かず、弓兵には届く距離の敵
  // 敵の位置は道の上の距離 d で決まるので、部隊から 90〜120 離れた手前の地点を探す（近接兵の射程は60まで）
  const e = WD_DEBUG.addEnemy({ kind: "goblin", d: 0, hp: 1e6, speed: 0 });
  for (let d = 0; d < 1500; d += 2) {
    const p = WD_DEBUG.pathAt(e.path, d);
    const dd = Math.hypot(p.x - q.x, p.y - q.y);
    if (p.x < q.x && dd >= 90 && dd <= 120) {
      Object.assign(e, { d }, p);
      break;
    }
  }
  ash.hp = 5;
  for (const m of list) m.cd = 0;
  WD_DEBUG.step(1);
  return {
    dmg: 1e6 - e.hp,
    healed: ash.hp > 5,
    archerXp: archer.waveXp > 0,
    medicHeals: medic.heals || 0,
  };
});
check("弓兵は遠くの敵を射る（足軽が届かない敵にもダメージ）", r.dmg > 0 && r.archerXp, JSON.stringify(r));
check("衛生兵は同じ部隊の仲間を回復する", r.healed && r.medicHeals > 0, JSON.stringify(r));
await ev(page, () => {
  const s = WD_DEBUG.state();
  s.enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブ終了（保存）
});

console.log("■ 主な兵種・保存・再読み込み");
q = await squad(page);
check(
  "槍兵が倒れると、一番多い兵種が主な兵種になる",
  q.type !== "spearman" && q.types.includes(q.type),
  JSON.stringify(q),
);
const savedTypes = await ev(page, () =>
  JSON.parse(localStorage.getItem("worldDefense.soldiers.v1"))
    .soldiers.map((v) => v.type)
    .sort()
    .join(),
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const after = await squad(page);
check(
  "混成部隊を保存し、再読み込みしてもそのまま",
  after.mixed && after.types.slice().sort().join() === savedTypes && after.type === q.type,
  JSON.stringify(after),
);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  return [...new Set(a.siege()[0].soldiers.map((id) => s.soldiers.find((x) => x.id === id).type))].length;
});
check("攻城戦の第一部隊も同じ混成部隊", r >= 3, String(r));
await page.tap("#siege");
check("攻城編成も接尾辞のない部隊名", /第一部隊/.test(await page.textContent("#siegeUnit")) && !/混成/.test(await page.textContent("#siegeUnit")));
await page.tap("#siegeClose");
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 移籍");
const two = {
  version: 1,
  seq: 10,
  squadSeq: 2,
  squads: [
    { id: 1, type: "spearman", slot: 0 },
    { id: 2, type: "archer", slot: 1 },
  ],
  soldiers: [
    ...[1, 2, 3, 4, 5].map((id) => ({ id, type: "spearman", squadId: 1, level: 3 })),
    ...[6, 7, 8, 9, 10].map((id) => ({ id, type: "archer", squadId: 2, level: 3 })),
  ],
  fallen: [],
};
({ page, errors, context } = await newContext(JSON.stringify(two)));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  const errs = [6, 7, 8].map((id) => a.transferSoldier(id, 1));
  const q1 = s.squads.find((q) => q.id === 1),
    q2 = s.squads.find((q) => q.id === 2);
  return { errs, n1: a.roster(q1).length, n2: a.roster(q2).length, name: a.squadName(q1), type: q1.type };
});
check(
  "別の兵種の部隊へ移籍できる（混成部隊になる）",
  r.errs.every((e) => e === null) && r.n1 === 8 && r.n2 === 2 && r.name === "第一部隊",
  JSON.stringify(r),
);
await page.tap("#organize");
await page.tap('[data-move="9"]').catch(() => {});
r = await ev(page, () =>
  [...document.querySelectorAll("[data-move-to]")].map((b) => b.dataset.moveTo).join(),
);
check("移籍先に兵種の違う部隊も出る", /1/.test(r), r);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
