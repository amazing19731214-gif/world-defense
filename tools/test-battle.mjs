#!/usr/bin/env node
// 攻城戦（Phase 4：基本システム）の動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test-battle.mjs
//   SCREENSHOTS=dir node tools/test-battle.mjs … 画面写真も保存
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
const SKEY = "worldDefense.soldiers.v1",
  FKEY = "worldDefense.siege.v1",
  WKEY = "worldDefense.warlords.v1";
// 保存済みの兵士 40人（8部隊×5人・兵種いろいろ・Lv5）。#1 は名前付き
const types = ["spearman", "ashigaru", "archer", "gunner", "cavalry", "medic", "spearman", "ashigaru"];
function makeSave(level) {
  const save = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
  for (let q = 1; q <= 8; q++) {
    save.squads.push({ id: q, type: types[q - 1] });
    for (let k = 0; k < 5; k++) {
      const id = (q - 1) * 5 + k + 1;
      save.soldiers.push({
        id,
        type: types[q - 1],
        squadId: q,
        level: id === 1 ? 12 : level,
        name: id === 1 ? "鬼若" : null,
      });
    }
  }
  return save;
}
// 第一部隊：槍兵・足軽、第二部隊：騎兵だけ、第三部隊：弓兵・鉄砲兵・衛生兵、第四部隊：残り
const formation = {
  version: 1,
  units: [
    { soldiers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], hero: "yukimura" },
    { soldiers: [21, 22, 23, 24, 25], hero: null },
    { soldiers: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 26, 27], hero: null },
    { soldiers: [31, 32, 33, 34, 35, 36, 37, 38, 39, 40], hero: "kanbei" },
  ],
};
const heroes = { version: 1, owned: { yukimura: 1, kanbei: 1 }, tickets: 0, history: [] };
async function newContext(seeds) {
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
  // 保存データは最初に一度だけ入れて読み込み直す（再読み込みのたびに入れ直さない）。
  // 読み込みのたびに保存データを触る準備スクリプトは、直前の保存と重なると古い内容を読むことがあるため使わない
  if (seeds && Object.keys(seeds).length) {
    await page.evaluate((seeds) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
    }, seeds);
    await page.goto(url);
    await page.waitForFunction(() => window.WD_DEBUG);
  }
  return { page, errors, context };
}
const seeds = (level = 5) => ({
  [SKEY]: JSON.stringify(makeSave(level)),
  [FKEY]: JSON.stringify(formation),
  [WKEY]: JSON.stringify(heroes),
});
const B = (page) =>
  page.evaluate(() => {
    const b = WD_DEBUG.squadApi.battle();
    if (!b) return null;
    return {
      t: b.t,
      castle: b.castleHp,
      kills: b.kills,
      garrison: b.garrison.length,
      towers: b.towers.filter((t) => !t.destroyed).length,
      groups: b.groups.map((g) => ({
        state: g.state,
        d: g.d,
        alive: g.list.filter((s) => s.alive && !s.siegeOut).length,
      })),
    };
  });

let { page, errors, context } = await newContext(seeds());

console.log("■ 出陣");
await page.tap("#siege");
check(
  "攻城編成の画面に「出陣」ボタン",
  (await page.isVisible("#siegeGo")) && !(await page.isDisabled("#siegeGo")),
);
let r = await page.evaluate(() => {
  document.getElementById("start").click(); // 防衛のウェーブ中
  const e = WD_DEBUG.squadApi.startBattle();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.stopSpawning();
  WD_DEBUG.step(0.1); // ウェーブ終了
  return e;
});
check("防衛のウェーブ中は出陣できない", /ウェーブ中/.test(r || ""), r);
await page.tap("#siegeClose");
await page.tap("#siege");
await page.tap("#siegeGo");
r = await B(page);
check(
  "出陣すると攻城戦が始まる（第一部隊から）",
  r && r.groups[0].state === "march" && r.groups[1].state === "wait",
  JSON.stringify(r && r.groups),
);
check(
  "攻城戦の状況（時間・城・各部隊）を表示",
  (await page.isVisible("#battleBar")) && /清洲城/.test(await page.textContent("#battleInfo")),
);
check("出陣中は防衛のウェーブ開始ボタンを押せない", await page.isDisabled("#start"));
r = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  return {
    transfer: a.transferSoldier(s.soldiers[1].id, "new"),
    edit: a.siegeRemove(0, 1),
    disband: a.disbandSquad(s.squads[7]),
  };
});
check(
  "出陣中は編成・移籍・解散ができない",
  /攻城戦/.test(r.transfer) && /攻城戦/.test(r.edit) && /攻城戦/.test(r.disband),
  JSON.stringify(r),
);
await page.evaluate(() => WD_DEBUG.step(10.5));
r = await B(page);
check(
  "10秒ごとに次の部隊が出撃",
  r.groups[1].state !== "wait" && r.groups[2].state === "wait",
  JSON.stringify(r.groups),
);
check("騎兵だけの部隊は速く進む（10秒遅れて出ても距離を詰める）", r.groups[1].d > 0);
await page.waitForTimeout(100); // 画面の状況欄は描画のたびに更新される
const info = await page.textContent("#battleInfo");
check(
  "状況欄が進行に合わせて更新される（時間・出撃した部隊の人数）",
  /\b1[0-9]\/180秒/.test(info) && /第一 \d+人/.test(info),
  info,
);
const d0 = r.groups[0].d,
  d1 = r.groups[1].d;
await page.evaluate(() => WD_DEBUG.step(2));
r = await B(page);
check(
  "騎兵の部隊は普通の部隊より速い",
  r.groups[1].d - d1 > (r.groups[0].state === "march" ? r.groups[0].d - d0 : 0) ||
    r.groups[0].state === "fight",
  JSON.stringify([d0, d1, r.groups[0], r.groups[1]]),
);
if (shots) await page.screenshot({ path: path.join(shots, "b1-march.png"), fullPage: true });

console.log("■ 戦闘");
await page.evaluate(() => {
  for (let i = 0; i < 300 && WD_DEBUG.squadApi.battle(); i++) {
    WD_DEBUG.step(0.1);
    const b = WD_DEBUG.squadApi.battle();
    if (b && b.groups.some((g) => g.state === "fight")) break;
  }
});
r = await B(page);
check(
  "守備隊の前で止まって戦う",
  r && r.groups.some((g) => g.state === "fight"),
  JSON.stringify(r && r.groups),
);
await page.evaluate(() => WD_DEBUG.step(8));
r = await B(page);
check("守備隊を倒す（撃破数が増える）", r && r.kills > 0, JSON.stringify(r));
const xpNow = await page.evaluate(() => WD_DEBUG.state().soldiers.reduce((n, s) => n + (s.waveXp || 0), 0));
check("戦闘で経験値を得る", xpNow > 0);
if (shots) await page.screenshot({ path: path.join(shots, "b2-fight.png"), fullPage: true });
// 決着まで進める
await page.evaluate(() => {
  for (let i = 0; i < 3000 && WD_DEBUG.squadApi.battle(); i++) WD_DEBUG.step(0.1);
});
r = await page.evaluate(() => ({
  battle: !!WD_DEBUG.squadApi.battle(),
  sheet: !document.getElementById("battleSheet").hidden,
  title: document.getElementById("battleTitle").textContent,
  body: document.getElementById("battleBody").textContent,
}));
check("Lv5の4部隊でNPCの城を攻め落とせる（勝利）", !r.battle && r.sheet && /勝利/.test(r.title), r.title);
check(
  "結果画面に経過時間・城の耐久・各部隊の生還数",
  /経過 \d+秒/.test(r.body) && /城の耐久 0\//.test(r.body) && /生還 \d+\/\d+/.test(r.body),
  r.body.slice(0, 120),
);
const elapsed = +r.body.match(/経過 (\d+)秒/)[1];
check("1戦はおよそ1分（30〜120秒）", elapsed >= 30 && elapsed <= 120, String(elapsed));
if (shots) await page.screenshot({ path: path.join(shots, "b3-result.png") });
r = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    sv = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1"));
  const alive = s.soldiers.filter((x) => x.alive && x.battles > 0);
  return {
    alive: alive.length,
    synced: alive.every((x) => {
      const v = sv.soldiers.find((y) => y.id === x.id);
      return v && v.level === x.level && v.xp === x.xp && v.battles === x.battles && v.kills === x.kills;
    }),
    deadSaved: s.soldiers.filter((x) => !x.alive).every((x) => !sv.soldiers.some((y) => y.id === x.id)),
    battles: alive.map((x) => x.battles),
    dead: s.soldiers.filter((x) => !x.alive).length,
  };
});
check(
  "生還した兵士の経験値・出陣数・討伐数を保存",
  r.alive > 0 && r.synced && r.battles.every((n) => n === 1),
  JSON.stringify(r),
);
check("戦死した兵士は保存データから外れる（復活しない）", r.deadSaved);
r = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    snap = () => s.soldiers.map((x) => x.level * 1e5 + x.xp).join();
  const before = snap();
  WD_DEBUG.squadApi.endBattle("win"); // 終わった攻城戦をもう一度終わらせても
  return before === snap();
});
check("結果の経験値は1回だけ（二重に入らない）", r);
await page.tap("#battleClose");
check(
  "防衛のウェーブを始められる状態に戻る",
  !(await page.isDisabled("#start")) && !(await page.isVisible("#battleBar")),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 敗北・全滅・武将の負傷");
({ page, errors, context } = await newContext(seeds(1)));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  // 第一部隊を全滅させる（武将：真田幸村）
  const b = a.battle(),
    g = b.groups[0];
  for (const s of g.list) {
    s.skills = [];
    s.hp = 0.1;
  }
  for (let i = 0; i < 12 && g.state !== "lost"; i++) {
    const front = g.list.find((s) => s.alive);
    if (!front) break;
    front.hp = 0.1;
    WD_DEBUG.step(0.05);
    // 守備隊の攻撃を待たずに、ダメージを直接与える
    if (g.state !== "lost") {
      const e = b.garrison[0];
      e.x = g.x;
      e.y = g.y;
      e.cd = 0;
    }
  }
  return {
    state: g.state,
    inj: WD_DEBUG.heroApi.injuryOf("yukimura"),
    named: JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).fallen.map((f) => f.name),
  };
});
check(
  "部隊が全滅すると武将は負傷（戦死しない）",
  r.state === "lost" && r.inj && r.inj.left === 3,
  JSON.stringify(r),
);
check("名前付きの兵士の戦死は英霊名鑑へ", r.named.includes("鬼若"), r.named.join());
await page.evaluate(() => {
  const b = WD_DEBUG.squadApi.battle();
  for (const g of b.groups) for (const s of g.list) s.hp = 0.1;
  for (let i = 0; i < 4000 && WD_DEBUG.squadApi.battle(); i++) WD_DEBUG.step(0.1);
});
r = await page.evaluate(() => document.getElementById("battleTitle").textContent);
check("全部隊が倒れると敗北", /敗北/.test(r), r);
r = await page.evaluate(() => ({
  squads: WD_DEBUG.state().squads.length,
  empty: WD_DEBUG.state().squads.filter((q) => !WD_DEBUG.squadApi.roster(q).length).length,
}));
check("戦死で空になった防衛の部隊は片付く", r.empty === 0, JSON.stringify(r));
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
r = await page.evaluate(() => WD_DEBUG.state().soldiers.some((s) => s.id === 1));
check("再読み込みしても戦死した兵士は復活しない", !r);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 撤退");
({ page, errors, context } = await newContext(seeds(5)));
await page.tap("#siege");
await page.tap("#siegeGo");
await page.evaluate(() => WD_DEBUG.step(3));
const xpBefore = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.map(
    (v) => v.level * 1e5 + (v.xp || 0),
  ),
);
await page.tap("#battleRetreat");
r = await page.evaluate(() => ({
  battle: !!WD_DEBUG.squadApi.battle(),
  title: document.getElementById("battleTitle").textContent,
  dead: WD_DEBUG.state().soldiers.filter((s) => !s.alive).length,
}));
check(
  "全軍撤退で攻城戦を終える（敗北・兵士は生き残る）",
  !r.battle && /撤退/.test(r.title) && r.dead === 0,
  JSON.stringify(r),
);
const xpAfter = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.map(
    (v) => v.level * 1e5 + (v.xp || 0),
  ),
);
check(
  "撤退では生存ボーナスなし（戦闘中に得た分だけ）",
  xpAfter.every((x, i) => x - xpBefore[i] <= 70),
  JSON.stringify(xpAfter.map((x, i) => x - xpBefore[i])),
);
const lay = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check("390px で横スクロールなし", !lay);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 編成が無いとき");
({ page, errors, context } = await newContext({}));
await page.tap("#siege");
check("攻城編成に兵士がいなければ出陣ボタンは押せない", await page.isDisabled("#siegeGo"));
r = await page.evaluate(() => WD_DEBUG.squadApi.startBattle());
check("出陣の処理も断る", /兵士がいません/.test(r || ""), r);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
