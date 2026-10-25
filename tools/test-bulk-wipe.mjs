#!/usr/bin/env node
// 編成画面の「まとめて移籍」と、メニューの「データ消去」（保存データをすべて消す）の確認
//   node tools/test-bulk-wipe.mjs
//   SCREENSHOTS=dir node tools/test-bulk-wipe.mjs … 画面写真も保存
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
  WKEY = "worldDefense.warlords.v1";
// 第一部隊：槍兵10人（満員）、第二部隊：弓兵4人
const save = { version: 1, seq: 14, squadSeq: 2, squads: [], soldiers: [], fallen: [] };
save.squads.push({ id: 1, type: "spearman", slot: 0 }, { id: 2, type: "archer", slot: 1 });
for (let k = 0; k < 10; k++)
  save.soldiers.push({ id: k + 1, type: "spearman", squadId: 1, level: 3, skills: [] });
for (let k = 0; k < 4; k++)
  save.soldiers.push({ id: 11 + k, type: "archer", squadId: 2, level: 3, skills: [] });

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
const answers = []; // 確認ダイアログへの答え（なければ OK）
const asked = [];
page.on("dialog", (d) => {
  asked.push(d.message());
  const a = answers.length ? answers.shift() : true;
  a ? d.accept() : d.dismiss();
});
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
await page.evaluate(
  ([SKEY, WKEY, save]) => {
    localStorage.clear();
    localStorage.setItem(SKEY, JSON.stringify(save));
    localStorage.setItem(
      WKEY,
      JSON.stringify({ version: 1, owned: { nobunaga: 2 }, tickets: 7, history: [] }),
    );
    localStorage.setItem(
      "worldDefense.settings.v1",
      JSON.stringify({ version: 1, auto: true, waveGoal: 30 }),
    );
    localStorage.setItem("otherGame.save", "keep"); // ほかのゲームの保存データ（消さない）
  },
  [SKEY, WKEY, save],
);
const reload = async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
};
await reload();
const sizes = () =>
  page.evaluate(() =>
    WD_DEBUG.state()
      .squads.map((q) => WD_DEBUG.squadApi.members(q).length + (q.locked ? "" : ""))
      .join(","),
  );
const rosterSizes = () =>
  page.evaluate(() =>
    WD_DEBUG.state()
      .squads.map((q) => WD_DEBUG.state().soldiers.filter((s) => s.alive && s.squadId === q.id).length)
      .join(","),
  );

console.log("■ まとめて移籍");
await page.tap("#organize");
check("編成画面に「☑ まとめて移籍」", (await page.$$("[data-bulk-start]")).length === 1);
check("今までの1人ずつの「移籍」もある", (await page.$$("[data-move]")).length === 14);
await page.tap("[data-bulk-start]");
let r = await page.evaluate(() => ({
  picks: document.querySelectorAll("[data-bulk-pick]").length,
  all: document.querySelectorAll("[data-bulk-all]").length,
  moves: document.querySelectorAll("[data-move]").length,
  dests: [...document.querySelectorAll("[data-bulk-to]")].map((b) => b.textContent + (b.disabled ? "x" : "")),
  hint: document.getElementById("squadHint").textContent,
}));
check(
  "選ぶモード：兵士ごとに「選ぶ」・部隊ごとに「全員を選ぶ」・移す先（まだ選んでいないので押せない）",
  r.picks === 14 &&
    r.all === 2 &&
    r.moves === 0 &&
    r.dests.every((t) => t.endsWith("x")) &&
    /選択中 0人/.test(r.hint),
  JSON.stringify(r),
);
for (const id of [1, 2, 3]) await page.tap(`[data-bulk-pick="${id}"]`);
r = await page.evaluate(() => ({
  on: document.querySelectorAll('[data-bulk-pick][aria-pressed="true"]').length,
  dests: [...document.querySelectorAll("[data-bulk-to]")].map((b) => b.textContent),
}));
check("3人を選ぶと「選択中」になる", r.on === 3, JSON.stringify(r));
check(
  "移す先：空きのある第二部隊と新しい部隊（満員の第一部隊は出ない）",
  r.dests.length === 2 && /第二部隊.*空き6/.test(r.dests[0]) && r.dests[1] === "新しい部隊へ",
  JSON.stringify(r.dests),
);
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
if (shots) await page.screenshot({ path: path.join(shots, "b1-pick.png") });
await page.tap("[data-bulk-to]");
r = await page.evaluate(() => ({
  msg: document.getElementById("msg").textContent,
  mode: document.querySelectorAll("[data-bulk-pick]").length,
}));
check(
  "3人を第二部隊へ移籍（10・4 → 7・7）",
  (await rosterSizes()) === "7,7" && /3人を 第二部隊/.test(r.msg),
  (await rosterSizes()) + " " + r.msg,
);
check("移籍が終わると選ぶモードを終える", r.mode === 0);

console.log("■ 満員になったら残りは元の部隊のまま");
await page.tap("[data-bulk-start]");
await page.tap('[data-bulk-all="1"]');
r = await page.evaluate(() => document.querySelectorAll('[data-bulk-pick][aria-pressed="true"]').length);
check("「全員を選ぶ」で第一部隊の7人を選ぶ", r === 7, String(r));
await page.tap('[data-bulk-all="1"]');
r = await page.evaluate(() => document.querySelectorAll('[data-bulk-pick][aria-pressed="true"]').length);
check("もう一度押すと全員を外す", r === 0, String(r));
await page.tap('[data-bulk-all="1"]');
await page.tap('[data-bulk-to="2"]');
r = await page.evaluate(() => document.getElementById("msg").textContent);
check(
  "空き3の第二部隊へ7人：3人だけ移り、4人は残ると知らせる",
  (await rosterSizes()) === "4,10" && /3人を 第二部隊.*満員のため 4人は元の部隊のまま/.test(r),
  (await rosterSizes()) + " " + r,
);

console.log("■ 新しい部隊へ");
await page.tap("[data-bulk-start]");
for (const id of [11, 12]) await page.tap(`[data-bulk-pick="${id}"]`);
await page.tap('[data-bulk-to="new"]');
r = await page.evaluate(() => ({
  squads: WD_DEBUG.state().squads.length,
  same: new Set(
    WD_DEBUG.state()
      .soldiers.filter((s) => s.id === 11 || s.id === 12)
      .map((s) => s.squadId),
  ).size,
  msg: document.getElementById("msg").textContent,
}));
check(
  "選んだ2人で新しい部隊を1つ作る",
  r.squads === 3 && r.same === 1 && /2人を 第三部隊/.test(r.msg),
  JSON.stringify(r),
);
await page.tap("[data-bulk-start]");
await page.tap('[data-bulk-pick="4"]');
await page.tap("[data-bulk-cancel]");
check(
  "「やめる」で何も変えずに終える",
  (await rosterSizes()) === "4,8,2" && (await page.$$("[data-bulk-pick]")).length === 0,
  await rosterSizes(),
);
await page.tap("#squadClose");

console.log("■ ウェーブ中はできない");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state();
  a.deployReserve(S.squads[0], 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  document.getElementById("organize").click();
  const btn = document.querySelectorAll("[data-bulk-start]").length;
  const api = a.transferMany([4, 5], S.squads[2].id).err;
  document.getElementById("squadClose").click();
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  return { btn, api };
});
check(
  "ウェーブ中は「まとめて移籍」を出さない・移籍できない",
  r.btn === 0 && /ウェーブ中/.test(r.api || ""),
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ データ消去");
r = await page.evaluate(() => {
  const b = document.getElementById("wipeData"),
    reset = document.getElementById("reset"),
    menu = [...document.querySelectorAll(".menu-tools button")];
  return {
    text: b.textContent,
    h: b.getBoundingClientRect().height,
    fit: menu.every(
      (x) => x.getBoundingClientRect().right <= innerWidth + 0.5 && x.scrollWidth <= x.clientWidth + 1,
    ),
    sameRow: Math.abs(b.getBoundingClientRect().top - reset.getBoundingClientRect().top) < 1,
  };
});
check(
  "メニューに「🗑 データ消去」（「最初から」と同じ行・収まる）",
  /データ消去/.test(r.text) && r.h >= 44 && r.fit && r.sameRow,
  JSON.stringify(r),
);
if (shots) {
  await page.evaluate(() => document.getElementById("wipeData").scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(shots, "b2-menu.png") });
}
const keysNow = () => page.evaluate(() => Object.keys(localStorage).sort().join());
const before = await keysNow();
answers.push(false);
await page.tap("#wipeData");
check(
  "1回目の確認でやめると何も消えない",
  (await keysNow()) === before && /すべて消しますか/.test(asked.at(-1)),
  asked.at(-1),
);
answers.push(true, false);
await page.tap("#wipeData");
check(
  "2回目の確認（元に戻せない）でやめても何も消えない",
  (await keysNow()) === before && /元に戻せません/.test(asked.at(-1)),
  asked.at(-1),
);
answers.push(true, true);
await Promise.all([page.waitForEvent("load"), page.tap("#wipeData")]);
await page.waitForFunction(() => window.WD_DEBUG);
r = await page.evaluate(() => ({
  keys: Object.keys(localStorage).filter((k) => k.startsWith("worldDefense.")),
  other: localStorage.getItem("otherGame.save"),
  squads: WD_DEBUG.state().squads.length,
  soldiers: WD_DEBUG.state().soldiers.length,
  owned: Object.keys(WD_DEBUG.forgeApi.owned()).length,
  wave: document.getElementById("wave").textContent,
  auto: document.getElementById("autoWave").textContent.replace(/\s/g, ""),
}));
check(
  "2回とも OK：読み込み直して最初の状態（兵士・武将なし・WAVE 0/20・AUTO OFF）",
  r.squads === 0 && r.soldiers === 0 && r.owned === 0 && r.wave === "WAVE 0/20" && r.auto === "AUTOOFF",
  JSON.stringify(r),
);
check("このゲーム以外の保存データは消さない", r.other === "keep");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
