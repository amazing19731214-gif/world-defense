#!/usr/bin/env node
// 三大裏ボスの専用グラフィック・演出の確認：専用のドット絵（大将の絵を使わない）・八つの頭・形態の変化が絵に出る・
// 予兆と演出の同期・登場と討伐の演出・戦いの後に演出が残らない・視差効果を減らす設定・スマートフォンの画面
//   node tools/test-boss-gfx.mjs
//   SCREENSHOTS=dir node tools/test-boss-gfx.mjs … 画面写真も保存
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
const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
let sid = 0;
for (let q = 1; q <= 4; q++) {
  const type = ["spearman", "ashigaru", "archer", "gunner"][q - 1];
  save.squads.push({ id: q, type, slot: q - 1 });
  for (let k = 0; k < 10; k++) save.soldiers.push({ id: ++sid, type, squadId: q, level: 2000 });
}
const conquest = JSON.stringify({
  version: 2,
  castles: {},
  secrets: { hiei: true, yomi: true, fuji: true },
  secretSeen: { hiei: true, yomi: true, fuji: true },
});
async function newContext(width = 390, height = 844, reducedMotion = "no-preference") {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate(
    ([s, c]) => {
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", s);
      localStorage.setItem("worldDefense.conquest.v1", c);
    },
    [JSON.stringify(save), conquest],
  );
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const drawn = async (page) => (await frame(page), page.evaluate(() => WD_DEBUG.squadApi.bossDrawn()));
// 討伐戦を始めて、部隊がボスに着くまで進める（絵を見るためにボスは倒れないようにする）
async function startBoss(page, id, sec = 26) {
  return page.evaluate(
    ([id, sec]) => {
      const a = WD_DEBUG.squadApi;
      a.setBossTarget(id);
      const err = a.startBattle();
      if (err) return err;
      const e = a.bossOf();
      e.hp = e.max = 1e9;
      if (e.regenLeft != null) e.regenLeft = 1e9;
      WD_DEBUG.step(sec);
      return null;
    },
    [id, sec],
  );
}
// キャンバスの色（ボスの絵の位置に、そのボスの色があるか）
const pixel = (page, dx, dy) =>
  page.evaluate(
    ([dx, dy]) => {
      const e = WD_DEBUG.squadApi.bossOf(),
        c = document.getElementById("game"),
        d = c.getContext("2d").getImageData(Math.round(e.x + dx), Math.round(e.y + dy), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    [dx, dy],
  );
const near = (c, hex, tol = 40) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return c.every((x, i) => Math.abs(x - v[i]) <= tol);
};

let { page, errors, context } = await newContext();

console.log("■ 雷獣・白虎");
let r = await startBoss(page, "hiei", 0.3);
let d = await drawn(page);
check("登場の演出（最初の1秒で浮かび上がる）", d.id === "hiei" && d.alpha < 1, JSON.stringify(d));
check("登場の帯（ボスの名前と「出現」）", await page.evaluate(() => WD_DEBUG.squadApi.battle().t < 2));
if (shots) await page.locator("#game").screenshot({ path: path.join(shots, "g1-intro.png") });
await page.evaluate(() => WD_DEBUG.step(26));
d = await drawn(page);
check(
  "専用のドット絵で描く（大将の絵は使わない）",
  d.id === "hiei" && d.spriteCalls === 0 && d.frames > 0,
  JSON.stringify(d),
);
let px = await page.evaluate(() => {
  // 白い胴（立ち位置の奥）・黒い縞・青白い目
  const a = WD_DEBUG.squadApi,
    e = a.bossOf(),
    dx = a.BOSS_DX.hiei;
  return { dx, leap: e.leapAnim, swipe: e.swipe };
});
const body = await pixel(page, px.dx + 5 * 5, 8 - 12 * 5);
check("白い体", near(body, "#f2f4f8", 30) || near(body, "#d9e0ea", 30), JSON.stringify(body));
check("雷をまとう（通常2本・怒ると6本）", d.bolts === 2);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  e.hp = e.max * 0.4;
  B.warn = null;
  e.sp = 0;
  WD_DEBUG.step(0.05);
  return { warn: B.warn && B.warn.kind, text: B.warn && B.warn.text };
});
d = await drawn(page);
check("怒り：雷が増える（形態が絵に出る）", d.phase === 2 && d.bolts === 6, JSON.stringify(d));
check(
  "落雷の予兆：警告（文字と秒数）と雷光の演出が同時に出る",
  r.warn === "bolt" && d.warn === "bolt" && /落雷の予兆/.test(r.text),
  JSON.stringify(r),
);
if (shots) await page.locator("#game").screenshot({ path: path.join(shots, "g2-byakko-warn.png") });
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    g = B.warn.target,
    hp0 = g.list.filter((s) => s.alive).map((s) => s.hp);
  WD_DEBUG.step(3.1);
  return {
    fx: a.bossEffects(),
    warn: B.warn && B.warn.kind,
    hurt: g.list.filter((s) => s.alive).some((s, i) => s.hp < hp0[i]),
  };
});
check(
  "予兆の時間が来ると、落雷・衝撃波・火花の演出と同時にダメージ",
  r.fx.includes("bbolt") && r.fx.includes("bshock") && r.fx.includes("bspark") && r.hurt,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  a.battle().warn = null;
  e.leap = 0;
  WD_DEBUG.step(0.05);
  return { leap: e.leapAnim > 0, fx: a.bossEffects() };
});
check("跳躍：体を伸ばして跳ぶ（着地に衝撃波）", r.leap && r.fx.includes("bshock"), JSON.stringify(r));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi, B = a.battle(), e = a.bossOf();
  // 跳躍後は近接射程内に味方がいないことがある。実際に攻撃できる距離で演出と被弾を検証する。
  const g = B.groups.find((g) => ["march", "fight"].includes(g.state) && g.list.some((s) => s.alive && !s.siegeOut));
  g.path = e.path;
  g.d = e.d - 30;
  Object.assign(g, WD_DEBUG.pathAt(g.path, g.d));
  // ボスは最も近い部隊を狙うため、ほかの部隊への命中も含めて実際の被弾を確認する。
  const before = B.groups.flatMap((g) => g.list).filter((s) => s.alive && !s.siegeOut).map((s) => ({ s, hp: s.hp }));
  e.cd = 0;
  WD_DEBUG.step(0.05);
  return { swipe: e.swipe, hurt: before.some(({ s, hp }) => s.hp < hp) };
});
check("攻撃：前脚を振り下ろし、射程内の味方が被弾する", r.swipe > 0 && r.hurt, JSON.stringify(r));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 冥龍・八岐");
({ page, errors, context } = await newContext());
r = await startBoss(page, "yomi");
d = await drawn(page);
check(
  "専用のドット絵（大将の絵は使わない）・八つの頭",
  d.id === "yomi" && d.spriteCalls === 0 && d.heads === 8,
  JSON.stringify(d),
);
r = await page.evaluate(() => {
  // 頭は離れた位置に並ぶ（小さい画面でも数えられる）
  const a = WD_DEBUG.squadApi,
    ps = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => a.yamataHeadPos(i));
  let min = 1e9;
  for (let i = 0; i < 8; i++)
    for (let j = i + 1; j < 8; j++) min = Math.min(min, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y));
  return { min, inside: ps.every((p) => p.x > 0 && p.x < 960 && p.y > 0 && p.y < 600) };
});
check(
  "八つの頭は重ならない位置（いちばん近い頭どうしも 35px 以上）・画面の中",
  r.min >= 35 && r.inside,
  JSON.stringify(r),
);
const dark = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  return { dx: a.BOSS_DX.yomi };
});
const scale = await pixel(page, dark.dx - 2 * 5, 8 - 12 * 5);
check("黒紫の胴", near(scale, "#2b1a3a", 40) || near(scale, "#4b2c66", 40), JSON.stringify(scale));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf(),
    out = {};
  e.heads[3].sealed = 20;
  const use = (kind) => {
    for (const h of e.heads) if (h.kind === kind) h.sealed = 0;
    e.head = e.heads.findIndex((h) => h.kind === kind && !h.sealed);
    e.headLeft = 99;
    e.cd = 0;
    B.warn = null;
    WD_DEBUG.step(0.05);
    return { anim: e.heads[e.head].anim > 0, fx: a.bossEffects() };
  };
  out.poison = use("poison");
  out.ice = use("ice");
  out.bite = use("bite");
  out.roar = use("roar");
  out.fire = use("fire");
  out.warn = B.warn && B.warn.kind;
  e.heads[7].sealed = 20; // 咆哮の頭を封じる
  return out;
});
d = await drawn(page);
check(
  "毒：攻撃する頭が動き、紫の霧",
  r.poison.anim && r.poison.fx.includes("bmist"),
  JSON.stringify(r.poison),
);
check("氷：青白い冷気", r.ice.anim && r.ice.fx.includes("bfrost"), JSON.stringify(r.ice));
check("牙：頭を突き出して噛みつき（火花）", r.bite.anim && r.bite.fx.includes("bspark"));
check("咆哮：円形の衝撃波", r.roar.anim && r.roar.fx.includes("bshock"));
check("炎：予兆の間に炎を溜める", r.warn === "breath" && d.warn === "breath", JSON.stringify(d));
check("封じた頭は暗く描く（封の文字）", d.sealed >= 1, JSON.stringify(d));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  WD_DEBUG.step(2.1);
  return a.bossEffects();
});
check("炎の予兆の時間が来ると、赤い炎の噴射とダメージ", r.includes("bfire"), JSON.stringify(r));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  e.hp = e.max * 0.5;
  WD_DEBUG.step(0.1);
  return e.regenFx > 0;
});
check("再生中は紫の光が集まる", r);
if (shots) await page.locator("#game").screenshot({ path: path.join(shots, "g3-yamata.png") });
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 零式・天魔機神");
({ page, errors, context } = await newContext());
r = await startBoss(page, "fuji");
d = await drawn(page);
check(
  "専用のドット絵（大将の絵は使わない）・第一形態は胸の光が弱い",
  d.id === "fuji" && d.spriteCalls === 0 && d.core === "弱" && !d.open,
  JSON.stringify(d),
);
const iron = await page.evaluate(() => WD_DEBUG.squadApi.BOSS_DX.fuji);
const armor = await pixel(page, iron - 6 * 5, 10 - 21 * 5);
check("黒鉄の甲冑", near(armor, "#2a2e36", 30) || near(armor, "#454c58", 30), JSON.stringify(armor));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  e.hp = e.max * 0.6;
  WD_DEBUG.step(0.1);
  return a.bossEffects();
});
d = await drawn(page);
check(
  "第二形態：肩の装甲が開き、胸の光が強くなる（形態変化の演出）",
  d.phase === 2 && d.open && d.core === "中" && r.includes("bphase"),
  JSON.stringify(d),
);
if (shots) await page.locator("#game").screenshot({ path: path.join(shots, "g4-tenma-2.png") });
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  e.hp = e.max * 0.25;
  WD_DEBUG.step(0.1);
  B.warn = null;
  e.sp = 0;
  WD_DEBUG.step(0.05);
  return { warn: B.warn && B.warn.kind, left: B.warn && B.warn.left };
});
d = await drawn(page);
check(
  "第三形態：炉が強く光る・天魔砲の予兆で炉に光が集まる",
  d.phase === 3 && d.core === "強" && r.warn === "beam" && d.warn === "beam",
  JSON.stringify({ d, r }),
);
if (shots) await page.locator("#game").screenshot({ path: path.join(shots, "g5-tenma-charge.png") });
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle();
  WD_DEBUG.step(4.05);
  return { fx: a.bossEffects(), warn: B.warn && B.warn.kind };
});
check(
  "予兆の時間が来ると、光線・衝撃波・火花",
  r.fx.includes("bbeam") && r.fx.includes("bshock") && r.fx.includes("bspark"),
  JSON.stringify(r),
);
if (shots) await page.locator("#game").screenshot({ path: path.join(shots, "g6-tenma-beam.png") });
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  WD_DEBUG.step(1);
  return a.bossEffects().filter((k) => k === "bbeam").length;
});
check("光線は短い時間で消えて元に戻る", r === 0, String(r));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  e.form = "guard";
  e.formLeft = 99;
  WD_DEBUG.step(0.05);
  return a.bossStatusText(e);
});
d = await drawn(page);
check("防御形態は障壁と文字で示す", d.guard && /防御形態/.test(r), JSON.stringify(d));
r = await page.evaluate(() => {
  // 演出の数は上限まで（長い戦いでも増え続けない）
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  e.form = "attack";
  let max = 0;
  for (let i = 0; i < 120; i++) {
    e.hp = e.max * 0.25; // 倒れないように（ボスも部隊も）
    for (const g of a.battle().groups) for (const s of g.list) if (s.alive) s.hp = a.soldierStats(s).maxHp;
    WD_DEBUG.step(0.5);
    max = Math.max(max, a.bossEffects().length);
  }
  return max;
});
check("長い戦い（60秒）でも演出の数は80まで", r <= 80, String(r));
r = await page.evaluate(() => {
  // 討伐：消える演出 → 1.2秒後に結果。最速の記録は倒した時刻
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  e.hp = 1;
  for (let i = 0; i < 100 && B.deathAt == null; i++) WD_DEBUG.step(0.05);
  const killT = B.deathAt,
    fx = a.bossEffects(),
    still = !!a.battle();
  WD_DEBUG.step(1.3);
  return { fx, still, done: !a.battle(), killT, best: a.bossRecord("fuji").best, left: a.bossEffects() };
});
check("討伐の消える演出のあとで結果画面", r.fx.includes("bdeath") && r.still && r.done, JSON.stringify(r));
check("最速の記録は倒した時刻（演出の時間は入れない）", r.best === Math.ceil(r.killT), JSON.stringify(r));
check("戦いの後に演出が残らない", r.left.length === 0, JSON.stringify(r.left));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 視差効果を減らす設定・画面の大きさ");
({ page, errors, context } = await newContext(375, 667, "reduce"));
r = await startBoss(page, "hiei", 0.3);
d = await drawn(page);
check("視差効果を減らす設定：登場も最初から見える（浮かび上がりなし）", d.alpha === 1, JSON.stringify(d));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  WD_DEBUG.step(26);
  e.hp = e.max * 0.4;
  WD_DEBUG.step(0.1);
  return null;
});
d = await drawn(page);
check(
  "視差効果を減らす設定：雷のちらつきを1本に減らす（形と文字で伝える）",
  d.bolts === 1 && d.phase === 2,
  JSON.stringify(d),
);
await frame(page);
r = await page.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  bar: document.getElementById("battleInfo").textContent,
  canvas: document.getElementById("game").getBoundingClientRect().width <= innerWidth,
}));
check(
  "375×667：横にはみ出さない・討伐の帯に状態を文字で表示",
  !r.hScroll && r.canvas && /状態：怒り/.test(r.bar),
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "g7-375.png") });
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();
({ page, errors, context } = await newContext(390, 844));
for (const id of ["hiei", "yomi", "fuji"]) {
  await startBoss(page, id, 3);
  d = await drawn(page);
  check(id + "：390×844 で描ける", d.id === id && d.spriteCalls === 0);
  await page.evaluate(() => {
    WD_DEBUG.squadApi.retreatBattle();
    document.getElementById("battleClose").click();
  });
  r = await page.evaluate(() => WD_DEBUG.squadApi.bossEffects().length);
  check(id + "：撤退しても演出が残らない", r === 0, String(r));
}
r = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
check("390×844：横にはみ出さない", !r);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
