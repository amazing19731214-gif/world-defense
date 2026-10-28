#!/usr/bin/env node
import { openSiegeFormation } from './ui-test-utils.mjs';
// NPC城の攻略（Phase 5：清洲城の占領・報酬・演習・保存）の動作確認（Playwright / Chromium・iPhone相当の画面幅）
//   node tools/test-castle.mjs
//   SCREENSHOTS=dir node tools/test-castle.mjs … 画面写真も保存
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
// 保存済みの兵士 40人（Lv8）と、4部隊の攻城編成
const save = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
const kinds = ["spearman", "ashigaru", "archer", "gunner", "cavalry", "medic", "spearman", "ashigaru"];
for (let q = 1; q <= 8; q++) {
  save.squads.push({ id: q, type: kinds[q - 1] });
  for (let k = 0; k < 5; k++)
    save.soldiers.push({ id: (q - 1) * 5 + k + 1, type: kinds[q - 1], squadId: q, level: 8 });
}
const units = [0, 1, 2, 3].map((u) => ({
  soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
  hero: null,
}));
async function newContext(extra = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const seeds = Object.assign(
    {
      [SKEY]: JSON.stringify(save),
      [FKEY]: JSON.stringify({ version: 1, units }),
      [WKEY]: JSON.stringify({ version: 1, owned: {}, tickets: 0, history: [] }),
    },
    extra,
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  // 保存データは最初に一度だけ入れて読み込み直す（再読み込みのたびに入れ直さない）。
  // 読み込みのたびに保存データを触る準備スクリプトは、直前の保存と重なると古い内容を読むことがあるため使わない
  await page.evaluate((seeds) => {
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
// 攻城戦を決着まで進める（castle を指定するとその耐久から始める）
const fight = (page, castle) =>
  page.evaluate((castle) => {
    const a = WD_DEBUG.squadApi;
    a.setCounterRng(() => 0.99); // 反撃（奪い返し）は起こさない（test-counter で確認）
    if (!a.battle()) a.startBattle();
    if (castle != null) a.battle().castleHp = castle;
    for (let i = 0; i < 4000 && a.battle(); i++) WD_DEBUG.step(0.1);
    return {
      title: document.getElementById("battleTitle").textContent,
      body: document.getElementById("battleBody").textContent,
      conquest: JSON.parse(localStorage.getItem("worldDefense.conquest.v1") || "null"),
      tickets: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).tickets,
    };
  }, castle);

let { page, errors, context } = await newContext();

console.log("■ 攻略目標");
await openSiegeFormation(page);
let text = await page.textContent("#siegeTarget");
check(
  "攻城編成の画面に攻略目標（清洲城・尾張・耐久・塔・守備兵・報酬）",
  /攻略目標：清洲城（尾張）/.test(text) &&
    /推奨Lv5/.test(text) && /城の耐久 1600/.test(text) &&
    /防衛塔 4基/.test(text) &&
    /守備兵 17人/.test(text) &&
    /ガチャ券 \+3/.test(text),
  text,
);
check("出陣ボタンに攻める城の名前", /出陣（清洲城を攻める）/.test(await page.textContent("#siegeGo")));
if (shots) await page.screenshot({ path: path.join(shots, "c1-target.png") });
await page.tap("#siegeGo");
check("攻城戦の状況欄に城の名前", /清洲城/.test(await page.textContent("#battleInfo")));

console.log("■ 初めての攻略（占領・報酬）");
let r = await fight(page);
check(
  "清洲城を攻め落とすと占領",
  /清洲城を攻め落とした/.test(r.title) && /清洲城（尾張）を占領した/.test(r.body),
  r.title + " / " + r.body.slice(0, 80),
);
check(
  "占領を保存（攻略回数・勝利数も）",
  r.conquest &&
    r.conquest.castles.kiyosu.captured === true &&
    r.conquest.castles.kiyosu.attempts === 1 &&
    r.conquest.castles.kiyosu.wins === 1,
  JSON.stringify(r.conquest),
);
check(
  "初めての攻略の報酬：ガチャ券 +3（保存済み）",
  r.tickets === 3 && /ガチャ券 \+3/.test(r.body),
  String(r.tickets),
);
if (shots) await page.screenshot({ path: path.join(shots, "c2-capture.png") });
await page.tap("#battleClose");

console.log("■ 再読み込み・次の目標・演習");
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
await openSiegeFormation(page);
text = await page.textContent("#siegeTarget");
check(
  "清洲城を取ると、次の攻略目標は隣の国の城（曳馬城・遠江）",
  /攻略目標：曳馬城（遠江）/.test(text) && /領土 2\/68/.test(text),
  text,
);
await page.tap("#siegeTarget [data-provinces]");
text = await page.textContent("#siegePick");
check("領土の一覧で尾張（清洲城）は領土", /尾張（清洲城）🏯 領土/.test(text), text.slice(0, 200));
await page.tap('#siegePick [data-target="kiyosu"]');
check(
  "占領済みの清洲城を「演習」の目標にできる",
  /演習（清洲城を攻める）/.test(await page.textContent("#siegeGo")),
);
await page.tap("#siegeGo");
check("状況欄に演習と表示", /清洲城（演習）/.test(await page.textContent("#battleInfo")));
r = await fight(page, 1);
check(
  "演習で勝っても報酬はなし（ガチャ券は増えない）",
  r.tickets === 3 && !/占領した/.test(r.body) && /演習/.test(r.title),
  r.tickets + " / " + r.body,
);
check(
  "演習も記録に残る（勝利数・攻略回数）",
  r.conquest.castles.kiyosu.wins === 2 &&
    r.conquest.castles.kiyosu.attempts === 2 &&
    r.conquest.castles.kiyosu.captured,
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 敗北では占領しない");
({ page, errors, context } = await newContext());
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  a.retreatBattle();
  return {
    conquest: JSON.parse(localStorage.getItem("worldDefense.conquest.v1")),
    tickets: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).tickets,
  };
});
check(
  "撤退・敗北では占領せず報酬もない（挑戦回数だけ増える）",
  !r.conquest.castles.kiyosu.captured && r.conquest.castles.kiyosu.attempts === 1 && r.tickets === 0,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ・壊れた保存データ");
({ page, errors, context } = await newContext({ [CKEY]: "{broken" }));
r = await page.evaluate(() => WD_DEBUG.squadApi.conquest().kiyosu);
check(
  "壊れた占領データでも起動（未攻略から）",
  r.captured === false && r.attempts === 0 && errors.length === 0,
  JSON.stringify(r),
);
await context.close();
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({
    version: 1,
    castles: { kiyosu: { captured: "yes", attempts: -3, wins: 1.7 }, edo: { captured: true } },
  }),
}));
r = await page.evaluate(() => WD_DEBUG.squadApi.conquest());
check(
  "不正な値は直し、知らない城は読み込まない",
  r.kiyosu.captured === false &&
    r.kiyosu.attempts === 0 &&
    r.kiyosu.wins === 1 &&
    !r.edo &&
    errors.length === 0,
  JSON.stringify(r),
);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
