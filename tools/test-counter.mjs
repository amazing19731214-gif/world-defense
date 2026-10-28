#!/usr/bin/env node
import { openSiegeFormation } from './ui-test-utils.mjs';
// 奪い返し（NPCの反撃）の動作確認：国を取ると隣の敵国が反撃・防衛戦で守る／奪われる・保存
//   node tools/test-counter.mjs
//   SCREENSHOTS=dir node tools/test-counter.mjs … 画面写真も保存
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
  WKEY = "worldDefense.warlords.v1",
  CKEY = "worldDefense.conquest.v1";
const save = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
for (let q = 1; q <= 8; q++) {
  save.squads.push({ id: q, type: "spearman" });
  for (let k = 0; k < 5; k++)
    save.soldiers.push({ id: (q - 1) * 5 + k + 1, type: "spearman", squadId: q, level: 10 });
}
const units = [0, 1, 2, 3].map((u) => ({
  soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
  hero: null,
}));
// 尾張（清洲城）と遠江（曳馬城）を取った状態
const conquered = (extra = {}) =>
  JSON.stringify(
    Object.assign({ version: 1, castles: { kiyosu: { captured: true }, hikuma: { captured: true } } }, extra),
  );
// 保存データは最初に一度だけ入れて読み込み直す（再読み込みのたびに入れ直さない）
async function newContext(extra = {}) {
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
  const seeds = Object.assign(
    {
      [SKEY]: JSON.stringify(save),
      [FKEY]: JSON.stringify({ version: 1, units }),
      [WKEY]: JSON.stringify({ version: 1, owned: {}, tickets: 0, history: [] }),
      [CKEY]: conquered(),
    },
    extra,
  );
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
// 防衛戦のウェーブを n 回クリアする（敵は出さずにすぐ終える）
const clearWaves = (page, n) =>
  page.evaluate((n) => {
    for (let i = 0; i < n; i++) {
      document.getElementById("start").click();
      WD_DEBUG.stopSpawning();
      WD_DEBUG.state().enemies.length = 0;
      WD_DEBUG.step(0.1);
    }
    return WD_DEBUG.state().wave;
  }, n);
// 防衛戦でゲームオーバーにする（城の手前に足の速い敵を並べる）
const loseDefense = (page) =>
  page.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    for (let i = 0; i < 25; i++) WD_DEBUG.addEnemy({ kind: "wolf", d: 1000 + i, hp: 1e9, speed: 400 });
    WD_DEBUG.step(5);
    return {
      over: WD_DEBUG.state().over,
      wave: WD_DEBUG.state().wave,
      msg: document.getElementById("msg").textContent,
    };
  });

let { page, errors, context } = await newContext();

console.log("■ 反撃が起きる");
check("反撃がなければお知らせは出ない", !(await page.isVisible("#mapNotice")));
let r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.setCounterRng(() => 0); // 必ず反撃が起きる
  a.setTarget("inabayama");
  a.startBattle();
  a.endBattle("win");
  return {
    body: document.getElementById("battleBody").textContent,
    counter: a.activeCounter(),
    border: a.borderProvinces(),
  };
});
check(
  "国を取ると隣の敵国が反撃してくる（境目の領土へ）",
  r.counter && r.border.includes(r.counter.province),
  JSON.stringify(r.counter),
);
check(
  "狙われるのは境目の国：尾張に伊勢の軍勢（全国の国から）",
  r.counter.province === "owari" && r.counter.from === "ise",
  JSON.stringify(r.counter),
);
check(
  "結果画面で反撃を知らせる",
  /伊勢の軍勢が尾張（清洲城）に攻めてきた/.test(r.body) && /ウェーブ10まで守り抜こう/.test(r.body),
  r.body.slice(0, 160),
);
await page.tap("#battleClose");
check(
  "マップ内に反撃通知（あと何ウェーブ）",
  (await page.isVisible("#mapNotice")) && /あと10ウェーブ/.test(await page.textContent("#mapNotice")),
);
check("反撃を保存", (await stored(page, CKEY)).counter.province === "owari");
if (shots) await page.screenshot({ path: path.join(shots, "k1-banner.png") });

console.log("■ 反撃中の攻城戦");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.setTarget("fukashi");
  const blocked = a.startBattle();
  a.setTarget("kiyosu");
  const practice = a.startBattle();
  a.retreatBattle();
  return { blocked, practice };
});
check("反撃を退けるまで新しい国は攻められない", /反撃を退けるまで/.test(r.blocked || ""), r.blocked);
check("演習（領土の城）はできる", r.practice === null, r.practice);
await page.tap("#battleClose");
await openSiegeFormation(page);
check("攻城編成の画面にも反撃を表示", /攻めてきた/.test(await page.textContent("#siegeTarget")));
await page.tap("#siegeTarget [data-provinces]");
check(
  "領土の一覧で狙われた国に表示",
  /尾張（清洲城）⚠ 反撃を受けている/.test(await page.textContent("#siegePick")),
);
await page.tap("#squadClose");

console.log("■ 再読み込み・最初から");
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check(
  "再読み込みしても反撃は続く",
  (await page.isVisible("#mapNotice")) &&
    !!(await page.evaluate(() => WD_DEBUG.squadApi.activeCounter())),
);
await clearWaves(page, 3);
check(
  "ウェーブが進むと残りが減る（あと7ウェーブ）",
  /あと7ウェーブ/.test(await page.textContent("#mapNotice")),
);
await page.tap("#reset");
check(
  "「最初から」でやり直しても反撃は続く（奪われない・撃退にもならない）",
  !!(await page.evaluate(() => WD_DEBUG.squadApi.activeCounter())) &&
    /あと10ウェーブ/.test(await page.textContent("#mapNotice")),
);

console.log("■ 守り抜く");
const t0 = (await stored(page, WKEY)).tickets;
await clearWaves(page, 9);
check("ウェーブ9まででは、まだ反撃中", !!(await page.evaluate(() => WD_DEBUG.squadApi.activeCounter())));
await clearWaves(page, 1);
r = await page.evaluate(() => ({
  counter: WD_DEBUG.squadApi.activeCounter(),
  msg: document.getElementById("msg").textContent,
  owned: WD_DEBUG.squadApi.ownsProvince("owari"),
}));
check(
  "ウェーブ10までクリアすると撃退（尾張は守られる）",
  !r.counter && r.owned && /伊勢の反撃を退け、尾張を守り抜いた/.test(r.msg),
  r.msg,
);
const t1 = (await stored(page, WKEY)).tickets;
// ウェーブ10のクリアでは、2ウェーブごとのガチャ券も入る
check("撃退の報酬：ガチャ券 +1", t1 - t0 === 1 + 5, String(t1 - t0));
check("撃退を保存（反撃は消える）", (await stored(page, CKEY)).counter === null);
check("お知らせが消える", !(await page.isVisible("#mapNotice")));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 守れずに奪われる");
({ page, errors, context } = await newContext({
  [CKEY]: conquered({ counter: { province: "totomi", from: "suruga" } }),
}));
r = await page.evaluate(() => ({ gold: WD_DEBUG.state().gold, start: WD_DEBUG.squadApi.startGold() }));
check("保存した反撃を読み込む（遠江は東海道で開始ゴールド +100）", r.start === 600, JSON.stringify(r));
await clearWaves(page, 3);
r = await loseDefense(page);
check(
  "ウェーブ10の前に負けると国を奪われる",
  r.over && r.wave === 4 && /遠江（曳馬城）を駿河の軍勢に奪われた/.test(r.msg),
  r.msg,
);
r = await page.evaluate(() => ({
  owned: WD_DEBUG.squadApi.ownsProvince("totomi"),
  counter: WD_DEBUG.squadApi.activeCounter(),
  start: WD_DEBUG.squadApi.startGold(),
  canAttack: WD_DEBUG.squadApi.canAttackProvince("totomi"),
}));
check(
  "奪われた国の特産の効果は消える（開始ゴールドが元に戻る）",
  !r.owned && r.start === 500,
  JSON.stringify(r),
);
check("奪われた国は、また攻略できる国に戻る", r.canAttack && !r.counter);
r = await stored(page, CKEY);
check("奪われたことを保存", r.castles.hikuma.captured === false && r.counter === null);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 反撃が起きないとき");
({ page, errors, context } = await newContext());
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.setCounterRng(() => 0.99); // 確率に外れる
  a.setTarget("inabayama");
  a.startBattle();
  a.endBattle("win");
  return a.activeCounter();
});
check("確率に外れれば反撃はない", r === null);
await context.close();
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({ version: 1, castles: {}, counter: { province: "owari", from: "mino" } }),
}));
r = await page.evaluate(() => WD_DEBUG.squadApi.activeCounter());
check(
  "領土でない国への反撃（不正な保存データ）は無視する",
  r === null && !(await page.isVisible("#mapNotice")) && errors.length === 0,
);
await context.close();
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({
    version: 1,
    castles: { kiyosu: { captured: true } },
    counter: { province: "edo", from: 3 },
  }),
}));
r = await page.evaluate(() => WD_DEBUG.squadApi.activeCounter());
check("知らない国・壊れた値の反撃は無視する", r === null && errors.length === 0);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
