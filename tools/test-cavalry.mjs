#!/usr/bin/env node
// 騎兵（騎馬隊）の動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test-cavalry.mjs
//   SCREENSHOTS=dir node tools/test-cavalry.mjs … 画面写真も保存
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
// 雇用ボタンは「＋ 雇う」の中（畳まれていれば開いてから押す）
async function tapHire(page, type) {
  if (!(await page.isVisible(`[data-u="${type}"]`))) await page.tap("#hireToggle");
  await page.tap(`[data-u="${type}"]`);
}
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
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
const ev = (fn, arg) => page.evaluate(fn, arg);
async function tapMap(x, y) {
  const p = await ev(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return {
        x: r.left + c.clientLeft + (x * c.clientWidth) / 960,
        y: r.top + c.clientTop + (y * c.clientHeight) / 600,
      };
    },
    [x, y],
  );
  await page.touchscreen.tap(p.x, p.y);
}
// ウェーブを始め、自動の出現を止めて、遠くに止まる敵（holder）でウェーブを続けさせる
const startHeldWave = () =>
  ev(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  });
const clearWave = () =>
  ev(() => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
await ev(() => WD_DEBUG.setGold(9999));

console.log("■ 雇用と能力値");
let text = await page.textContent('[data-u="cavalry"]');
check("雇用メニューに騎兵（5人 140G）", /騎兵 140G/.test(text), text);
check(
  "ボタンに騎兵の絵",
  await page.$eval(
    '[data-u="cavalry"] img',
    (i) => i.naturalWidth > 0 && i.src.startsWith("data:image/webp"),
  ),
);
let r = await ev(() => {
  const T = WD_DEBUG.unitConfig.SOLDIER_TYPES,
    F = WD_DEBUG.unitConfig.UNIT_FRAMES;
  return { c: T.cavalry, s: T.spearman, a: T.ashigaru, frames: Object.keys(F.cavalry || {}).join() };
});
check(
  "騎兵は足軽より強く、槍兵よりHP・防御は低い",
  r.c.atk > r.a.atk && r.c.hp > r.a.hp && r.c.hp < r.s.hp && r.c.def < r.s.def,
);
check("騎兵の撤退は速い（1.5秒）・進軍の速さを持つ（攻城戦用）", r.c.retreatTime === 1.5 && r.c.march > 1);
check("騎兵のコマ（待機・攻撃・戦死）を埋め込み", r.frames === "idle,attack,death", r.frames);
await tapHire(page, "cavalry");
check("騎兵を選ぶと説明を表示", /騎馬隊（5人・140G）/.test(await page.textContent("#msg")));
await tapMap(650, 300);
await tapHire(page, "ashigaru");
await tapMap(400, 165);
r = await ev(() => WD_DEBUG.state().squads.map((q) => q.type + ":" + WD_DEBUG.squadApi.members(q).length));
check("道をタップして騎馬隊を雇用（5人）", r.join() === "cavalry:5,ashigaru:5", r.join());

console.log("■ 敵の騎兵を止められる");
await startHeldWave();
r = await ev(() => {
  const s = WD_DEBUG.state(),
    [cav, ash] = s.squads;
  // 足軽隊の前に敵の騎兵、騎馬隊の前にも敵の騎兵
  const atAsh = WD_DEBUG.addEnemy({ kind: "wolf", d: 270, hp: 1e9, speed: 0 });
  const atCav = WD_DEBUG.addEnemy({ kind: "wolf", d: 694 + 90, hp: 1e9, speed: 0 });
  Object.assign(atAsh, { x: ash.x, y: ash.y });
  Object.assign(atCav, { x: cav.x, y: cav.y });
  WD_DEBUG.step(0.05);
  return { ash: atAsh.blockedBy === ash, cav: atCav.blockedBy === cav };
});
check("足軽隊は敵の騎兵を止められない（これまでどおり）", !r.ash);
check("騎馬隊は敵の騎兵を足止めできる", r.cav);

console.log("■ 突撃（最初の一撃が強い）");
r = await ev(() => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    cav = s.squads[0],
    m = a.members(cav)[0];
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const e1 = WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 90, hp: 1e6, speed: 0 }),
    e2 = WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 92, hp: 1e6, speed: 0 });
  a.members(cav).forEach((x) => {
    x.cd = 999;
    x.skills = [];
  });
  const atk = a.soldierStats(m).atk;
  const hit = (target) => {
    const before = target.hp;
    m.cd = 0;
    WD_DEBUG.step(0.05);
    return before - target.hp;
  };
  // e1 だけが届くように e2 を一時的に遠くへ
  const keep = { x: e2.x, y: e2.y };
  Object.assign(e2, { x: 2000, y: 2000 });
  const first = hit(e1),
    second = hit(e1);
  Object.assign(e1, { x: 3000, y: 3000 });
  Object.assign(e2, keep);
  e1.blockedBy = null;
  const other = hit(e2);
  m.skills = ["chargeMaster"];
  m.chargeTarget = null;
  const master = hit(e2);
  m.skills = [];
  return { atk, first, second, other, master };
});
check("突撃：新しい敵への最初の一撃は2倍", Math.abs(r.first - r.atk * 2) < 1e-6, JSON.stringify(r));
check("同じ敵への2撃目からは通常の威力", Math.abs(r.second - r.atk) < 1e-6);
check("別の敵に替わると、また突撃の一撃", Math.abs(r.other - r.atk * 2) < 1e-6);
check("突撃上手：突撃の一撃が2.5倍", Math.abs(r.master - r.atk * 2.5) < 1e-6);

console.log("■ 槍兵に弱い");
r = await ev(() => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    [cav, ash] = s.squads;
  const hurt = (q, kind, skills) => {
    const m = a.members(q)[0];
    m.skills = skills || [];
    m.hp = 1000;
    a.damageSquad(q, 30, false, kind);
    const d = 1000 - m.hp;
    m.hp = a.soldierStats(m).maxHp;
    m.skills = [];
    return d;
  };
  return {
    cavSpear: hurt(cav, "knight"),
    cavGob: hurt(cav, "goblin"),
    cavHorse: hurt(cav, "knight", ["horsemanship"]),
    ashSpear: hurt(ash, "knight"),
    ashGob: hurt(ash, "goblin"),
  };
});
check("敵の槍兵から受けるダメージは1.5倍", Math.abs(r.cavSpear / r.cavGob - 1.5) < 1e-9, JSON.stringify(r));
check("人馬一体：槍兵からの追加分が半分（1.25倍）", Math.abs(r.cavHorse / r.cavGob - 1.25) < 1e-9);
check("ほかの兵種は槍兵に弱くない", Math.abs(r.ashSpear - r.ashGob) < 1e-9);
r = await ev(() => {
  // 実際の戦闘：敵の槍兵が騎馬隊を攻撃したときも1.5倍
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    cav = s.squads[0];
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const k = WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 90, hp: 1e9, speed: 0, unitCd: 0 });
  a.members(cav).forEach((x) => (x.hp = 1000));
  const m = a.members(cav)[0],
    st = a.soldierStats(m);
  WD_DEBUG.step(0.05);
  const got = 1000 - m.hp,
    raw = WD_DEBUG.unitConfig.ENEMY_VS_UNIT.knight.damage * (1 + (s.wave - 1) * 0.05);
  a.members(cav).forEach((x) => (x.hp = a.soldierStats(x).maxHp));
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  return { got, expect: ((raw * 30) / (30 + st.def)) * 1.5 };
});
check("戦闘中の敵の槍兵の攻撃にも反映", Math.abs(r.got - r.expect) < 1e-6, JSON.stringify(r));

console.log("■ 撤退が速い");
r = await ev(() => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    [cav, ash] = s.squads;
  a.orderRetreat(cav);
  a.orderRetreat(ash);
  const left = [cav.retreatLeft, ash.retreatLeft];
  WD_DEBUG.step(1.6);
  return { left, cav: cav.state, ash: ash.state, msg: document.getElementById("msg").textContent };
});
check(
  "騎馬隊の撤退は1.5秒（足軽隊は3秒）",
  r.left.join() === "1.5,3" && r.cav === "reserve" && r.ash === "retreating",
  JSON.stringify(r),
);

console.log("■ 経験値・スキル・保存");
r = await ev(() => {
  const a = WD_DEBUG.squadApi,
    R = WD_DEBUG.unitConfig.SQUAD_RULES;
  a.setSkillRng(() => 0);
  const m = {
    type: "cavalry",
    level: 1,
    xp: 0,
    skills: [],
    alive: true,
    history: [],
    squadId: 0,
    name: null,
  };
  while (m.level < 30) a.gainXp(m, R.xpToLevel(m.level) - m.xp, true);
  a.setSkillRng();
  const sk = a.SOLDIER_SKILLS;
  return {
    skills: m.skills.filter((id) => !sk[id].job), // 熟練度で覚える職業スキルは別
    pool: Object.keys(sk).filter((k) => sk[k].types.includes("cavalry") && !sk[k].unique && !sk[k].future),
  };
});
check(
  "Lv5・15・30でスキル（固有は一騎当千）",
  r.skills.length === 3 && r.skills[2] === "ikkiTousen",
  JSON.stringify(r.skills),
);
check(
  "騎兵のスキル：突撃上手・人馬一体のほか、鉄壁・連続攻撃・敵将狙いなど",
  ["chargeMaster", "horsemanship", "ironWall", "combo", "generalHunter"].every((k) => r.pool.includes(k)),
  r.pool.join(),
);
await clearWave();
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(() => WD_DEBUG.state().soldiers.filter((x) => x.type === "cavalry").length);
check("騎兵を保存して再読み込みで復元", r === 5, String(r));
r = await ev(() => {
  const s = WD_DEBUG.state(),
    q = s.squads.find((x) => x.type === "cavalry");
  return { slot: q.slot, siege: WD_DEBUG.squadApi.siege()[q.slot].soldiers.length };
});
check("騎兵の部隊がそのまま攻城の部隊になる（5人）", r.slot >= 0 && r.siege === 5, JSON.stringify(r));

console.log("■ 画面（390px）");
await tapHire(page, "cavalry");
const lay = await ev(() => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  minBtn: Math.min(
    ...[...document.querySelectorAll("[data-u]")].map((b) => b.getBoundingClientRect().height),
  ),
  minW: Math.min(...[...document.querySelectorAll("[data-u]")].map((b) => b.getBoundingClientRect().width)),
}));
check(
  "雇用ボタン6つでも横スクロールなし・押しやすい大きさ",
  !lay.hScroll && lay.minBtn >= 44 && lay.minW >= 80,
  JSON.stringify(lay),
);
if (shots) {
  await ev(() => {
    const s = WD_DEBUG.state(),
      a = WD_DEBUG.squadApi;
    a.deployReserve(
      s.squads.find((q) => q.type === "cavalry"),
      650,
      300,
    );
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    s.enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "wolf", d: 694 + 60, hp: 1e9, speed: 0 });
    WD_DEBUG.step(0.3);
  });
  await page.screenshot({ path: path.join(shots, "c1-cavalry.png"), fullPage: true });
}
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
