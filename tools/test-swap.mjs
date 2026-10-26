#!/usr/bin/env node
// 編成画面の「⇄ 入れ替え」：満員の部隊どうしでも、別の部隊の兵士2人の所属を交換できる
//   node tools/test-swap.mjs
//   SCREENSHOTS=dir node tools/test-swap.mjs … 画面写真も保存
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
// 4部隊（上限）すべて満員：槍兵・弓兵・騎兵・鉄砲兵 各10人
const types = ["spearman", "archer", "cavalry", "gunner"];
const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
types.forEach((t, i) => {
  save.squads.push({ id: i + 1, type: t, slot: i });
  for (let k = 0; k < 10; k++)
    save.soldiers.push({ id: i * 10 + k + 1, type: t, squadId: i + 1, level: 5 + k, skills: [] });
});
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
await page.evaluate(
  ([k, v]) => {
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify(v));
  },
  [SKEY, save],
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const where = (id) => page.evaluate((id) => WD_DEBUG.state().soldiers.find((s) => s.id === id).squadId, id);
const sizes = () =>
  page.evaluate(() =>
    WD_DEBUG.state()
      .squads.map((q) => WD_DEBUG.state().soldiers.filter((s) => s.alive && s.squadId === q.id).length)
      .join(","),
  );

console.log("■ 満員の部隊どうしで入れ替え");
await page.tap("#organize");
await page.tap('[data-move="1"]');
let r = await page.evaluate(() => ({
  hint: document.getElementById("squadHint").textContent,
  newBtn: document.querySelectorAll('[data-move-to="new"]').length,
  moveTo: document.querySelectorAll("[data-move-to]").length,
  swaps: [...document.querySelectorAll("[data-swap]")].map((b) => +b.dataset.swap),
  moving: document.querySelectorAll(".soldier-row.moving").length,
  tag: /移籍中/.test(document.querySelector(".soldier-row.moving").textContent),
}));
check("移籍先の案内に「⇄ 入れ替え」の説明", /入れ替え/.test(r.hint), r.hint);
check(
  "部隊が上限（4つ）なら「新しい部隊へ」を出さない・満員なので「ここへ編入」もない",
  r.newBtn === 0 && r.moveTo === 0,
  JSON.stringify(r),
);
check(
  "ほかの部隊の兵士30人に「⇄ 入れ替え」（同じ部隊の兵士には出さない）",
  r.swaps.length === 30 && r.swaps.every((id) => id > 10),
  JSON.stringify(r.swaps),
);
check("移籍中の兵士を目立たせる", r.moving === 1 && r.tag);
const box = await page.evaluate(() => {
  const bs = [...document.querySelectorAll("#squadSheet button")].filter((b) => b.getClientRects().length);
  return {
    minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
    fit: bs.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check(
  "375×667：ボタンは44px以上・横にはみ出さない",
  box.minH >= 44 && box.fit && !box.hScroll,
  JSON.stringify(box),
);
if (shots) {
  await page.evaluate(() => document.querySelector('[data-swap="11"]').scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(shots, "w1-swap.png") });
}
await page.tap('[data-swap="11"]');
r = await page.evaluate(() => ({
  msg: document.getElementById("msg").textContent,
  names: WD_DEBUG.state().squads.map((q) => WD_DEBUG.squadApi.squadName(q)),
  h1: WD_DEBUG.state()
    .soldiers.find((s) => s.id === 1)
    .history.at(-1),
  h11: WD_DEBUG.state()
    .soldiers.find((s) => s.id === 11)
    .history.at(-1),
  swaps: document.querySelectorAll("[data-swap]").length,
}));
check("槍兵#1 は第二部隊へ、弓兵#11 は第一部隊へ", (await where(1)) === 2 && (await where(11)) === 1);
check("人数は変わらない（10人ずつのまま）", (await sizes()) === "10,10,10,10", await sizes());
check("入れ替えたと知らせる・移籍の選択を終える", /と .*を入れ替えた/.test(r.msg) && r.swaps === 0, r.msg);
check(
  "両方の部隊は混成部隊になる",
  /混成/.test(r.names[0]) && /混成/.test(r.names[1]),
  JSON.stringify(r.names),
);
check("戦歴に入れ替えを記録", /入れ替え/.test(r.h1) && /入れ替え/.test(r.h11), r.h1 + " / " + r.h11);
await page.tap('[data-move="1"]');
await page.tap('[data-swap="11"]');
check("もう一度入れ替えると元に戻る", (await where(1)) === 1 && (await where(11)) === 2);
r = await page.evaluate(() =>
  WD_DEBUG.state()
    .squads.map((q) => WD_DEBUG.squadApi.squadName(q))
    .join(","),
);
check("元に戻すと部隊の名前も元どおり", /槍兵/.test(r) && /弓兵/.test(r) && !/混成/.test(r), r);
await page.tap('[data-move="1"]');
await page.tap("[data-cancel-move]");
check("取消で何も変えずに戻る", (await where(1)) === 1 && (await page.$$("[data-swap]")).length === 0);
await page.tap("#squadClose");

console.log("■ 保存");
await page.evaluate(() => {
  document.getElementById("organize").click();
  document.querySelector('[data-move="21"]').click();
  document.querySelector('[data-swap="31"]').click();
  document.getElementById("squadClose").click();
  // 雇用・移籍はウェーブのクリアで保存（今までどおり）
  const S = WD_DEBUG.state();
  for (const q of S.squads) WD_DEBUG.squadApi.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
});
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check("入れ替えは保存され、読み込み直しても残る", (await where(21)) === 4 && (await where(31)) === 3);

console.log("■ ウェーブ中・同じ部隊");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    same = a.swapSoldiers(1, 2);
  const S = WD_DEBUG.state();
  for (const q of S.squads) a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  return { same, wave: a.swapSoldiers(1, 11) };
});
check("同じ部隊の兵士どうしは入れ替えない", /同じ部隊/.test(r.same || ""), r.same);
check("ウェーブ中は入れ替えできない", /ウェーブ中/.test(r.wave || ""), r.wave);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
