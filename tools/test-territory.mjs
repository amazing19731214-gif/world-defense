#!/usr/bin/env node
import { openSiegeFormation } from './ui-test-utils.mjs';
// 領土（7か国）の動作確認：隣の国だけ攻められる・目標の選択・占領で領土が広がる・城の強さ・統一の報酬・保存
//   node tools/test-territory.mjs
//   SCREENSHOTS=dir node tools/test-territory.mjs … 画面写真も保存
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
const api = (page, fn, ...args) => page.evaluate(([fn, args]) => WD_DEBUG.squadApi[fn](...args), [fn, args]);
// 目標の城を攻め落とす（戦闘はすぐ勝利で終える）
const capture = (page, castle) =>
  page.evaluate((castle) => {
    const a = WD_DEBUG.squadApi;
    a.setCounterRng(() => 0.99); // 反撃（奪い返し）は起こさない（test-counter で確認）
    const err = castle ? a.setTarget(castle) : null;
    if (err) return { err };
    const e = a.startBattle();
    if (e) return { err: e };
    const id = a.battle().castleId;
    a.endBattle("win");
    return {
      id,
      body: document.getElementById("battleBody").textContent,
      tickets: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).tickets,
    };
  }, castle);
const owned = (page) =>
  page.evaluate(() =>
    Object.keys(WD_DEBUG.squadApi.PROVINCES).filter((p) => WD_DEBUG.squadApi.ownsProvince(p)),
  );
const open = (page) =>
  page.evaluate(() =>
    Object.keys(WD_DEBUG.squadApi.PROVINCES).filter((p) => WD_DEBUG.squadApi.canAttackProvince(p)),
  );

let { page, errors, context } = await newContext();

console.log("■ 最初の領土");
check("最初の領土は三河（自国・岡崎城）だけ", (await owned(page)).join() === "mikawa");
check(
  "攻められるのは三河の隣（尾張・遠江・美濃・信濃）",
  (await open(page)).sort().join() === "mino,owari,shinano,totomi",
  (await open(page)).join(),
);
await openSiegeFormation(page);
let text = await page.textContent("#siegeTarget");
check(
  "最初の攻略目標は清洲城（尾張）・領土 1/68（全国）",
  /攻略目標：清洲城（尾張）/.test(text) && /領土 1\/68/.test(text),
  text,
);
await page.tap("#siegeTarget [data-provinces]");
text = await page.textContent("#siegePick");
check(
  "領土の一覧：7か国・自国・攻略できる国・まだ攻められない国",
  /三河（岡崎城）🏠 自国/.test(text) &&
    /美濃（稲葉山城）⚔️ 攻略できる/.test(text) &&
    /甲斐（躑躅ヶ崎館）🔒/.test(text) &&
    /駿河（駿府城）🔒/.test(text),
  text.slice(0, 300),
);
check(
  "隣でない国（駿河・甲斐）は目標にできない（ボタンは押せない）",
  (await page.$$('#siegePick [data-target="sunpu"], #siegePick [data-target="tsutsujigasaki"]')).length === 0,
);
let r = await api(page, "setTarget", "sunpu");
check("処理でも隣でない国は断る", /隣ではない/.test(r || ""), r);
const lay = await page.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  minBtn: Math.min(
    ...[...document.querySelectorAll("#siegePick .pick-row button")].map(
      (b) => b.getBoundingClientRect().height,
    ),
  ),
}));
check("390px で横スクロールなし・ボタンは押しやすい", !lay.hScroll && lay.minBtn >= 44, JSON.stringify(lay));
if (shots) await page.screenshot({ path: path.join(shots, "t1-provinces.png") });
await page.tap('#siegePick [data-target="inabayama"]');
check(
  "美濃（稲葉山城）を攻略目標に選べる",
  /出陣（稲葉山城を攻める）/.test(await page.textContent("#siegeGo")) &&
    /攻略目標を 稲葉山城/.test(await page.textContent("#siegeSaved")),
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check("選んだ目標は保存される", (await api(page, "targetCastleId")) === "inabayama");

console.log("■ 城の強さ");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    measure = (id) => {
      a.setTarget(id);
      a.startBattle();
      const b = a.battle(),
        g = b.garrison.find((e) => e.kind === "goblin"),
        out = { max: b.castleMax, goblin: g.max, tower: b.towers[0].damage, n: b.garrison.length };
      a.retreatBattle();
      return out;
    };
  return { owari: measure("kiyosu"), mino: measure("inabayama") };
});
check(
  "奥の国ほど城が強い（耐久・守備兵の体力・塔の攻撃）",
  r.mino.max > r.owari.max &&
    r.mino.goblin > r.owari.goblin &&
    r.mino.tower > r.owari.tower &&
    r.mino.n > r.owari.n,
  JSON.stringify(r),
);

console.log("■ 占領で領土が広がる");
r = await capture(page, "hikuma");
check(
  "遠江（曳馬城）を占領すると領土 2/68",
  r.id === "hikuma" && /曳馬城（遠江）を占領した/.test(r.body) && /領土 2\/68/.test(r.body),
  r.err || r.body.slice(0, 80),
);
check("遠江を取ると隣の駿河が攻められるようになる", (await open(page)).includes("suruga"));
check("占領した城を選んでいた場合、目標は次の国へ", (await api(page, "targetCastleId")) !== "hikuma");
await page.tap("#battleClose");
for (const c of ["kiyosu", "inabayama", "sunpu", "fukashi"]) await capture(page, c);
check(
  "甲斐（躑躅ヶ崎館）は駿河か信濃を取ると攻められる（ほかに最初の7か国の外の隣国も）",
  (await open(page)).includes("kai") &&
    (await open(page)).sort().join() ===
      "echigo,echizen,etchu,hida,ise,izu,kai,kozuke,musashi,omi,sagami",
  (await open(page)).join(),
);
const before = await page.evaluate(
  () => JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).tickets,
);
r = await capture(page, "tsutsujigasaki");
check(
  "7か国を統一（結果画面に表示）",
  /7か国を統一した/.test(r.body) && (await owned(page)).length === 7,
  r.body.slice(0, 120),
);
check(
  "統一の報酬：ガチャ券 +10（甲斐の攻略 +5 とは別）",
  r.tickets - before === 15,
  String(r.tickets - before),
);
if (shots) await page.screenshot({ path: path.join(shots, "t2-unified.png") });
await page.tap("#battleClose");
r = await capture(page, "kiyosu");
check(
  "統一後は演習だけ（報酬は増えない）",
  !/統一した/.test(r.body) && !/占領した/.test(r.body) && r.tickets === before + 15,
);
r = await page.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.conquest.v1")));
check(
  "占領・統一（最初の7か国）を保存",
  r.unified === true &&
    ["kiyosu", "hikuma", "inabayama", "sunpu", "fukashi", "tsutsujigasaki"].every((c) => r.castles[c].captured) &&
    !r.castles.kannonji.captured,
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check("再読み込みしても7か国のまま", (await owned(page)).length === 7);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ");
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({ version: 1, castles: { kiyosu: { captured: true, attempts: 2, wins: 1 } } }),
}));
check(
  "清洲城だけ占領した以前のデータ：領土 2/7（三河・尾張）",
  (await owned(page)).sort().join() === "mikawa,owari",
);
check(
  "次の目標は攻められる国の城",
  ["hikuma", "inabayama", "fukashi"].includes(await api(page, "targetCastleId")),
  await api(page, "targetCastleId"),
);
await context.close();
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({ version: 1, castles: {}, target: "tsutsujigasaki", unified: "yes" }),
}));
r = await page.evaluate(() => ({
  t: WD_DEBUG.squadApi.targetCastleId(),
  u: WD_DEBUG.squadApi.conquestMeta().unified,
}));
check(
  "攻められない目標や不正な値は使わない（清洲城から）",
  r.t === "kiyosu" && r.u === false && errors.length === 0,
  JSON.stringify(r),
);
await context.close();

console.log("■ 領土の効果");
({ page, errors, context } = await newContext());
r = await page.evaluate(() => ({
  gold: WD_DEBUG.state().gold,
  label: document.querySelector("#hireToggle").textContent,
}));
check(
  "領土が三河だけなら効果なし（開始ゴールド500・ランダム雇用24G）",
  r.gold === 500 && /24G/.test(r.label),
  JSON.stringify(r),
);
// 尾張（ウェーブの報酬）・遠江と駿河（開始ゴールド）・美濃（修理費）・信濃（雇用費）を領土にした保存データ
await context.close();
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({
    version: 1,
    castles: Object.fromEntries(
      ["kiyosu", "hikuma", "inabayama", "sunpu"].map((c) => [c, { captured: true }]),
    ),
  }),
}));
r = await page.evaluate(() => ({ gold: WD_DEBUG.state().gold, start: WD_DEBUG.squadApi.startGold() }));
check("遠江・駿河で開始ゴールド +200（起動時から）", r.gold === 700 && r.start === 700, JSON.stringify(r));
r = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    g0 = s.gold;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  return WD_DEBUG.state().gold - g0;
});
check("尾張でウェーブクリアのゴールド +20%（58G → 70G）", r === Math.round(58 * 1.2), String(r));
r = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  s.towers.push({ id: 77, type: "arrow", x: 330, y: 300, level: 1, cd: 0, spent: 100 });
  const t = s.towers[s.towers.length - 1];
  t.hp = WD_DEBUG.towerApi.towerMaxHp(t) / 2;
  return { cost: a.repairCost(t), base: Math.ceil(100 * 0.5 * 0.5) };
});
check("美濃で塔の修理費 -30%", r.cost === Math.ceil(100 * 0.5 * 0.7 * 0.5), JSON.stringify(r));
r = await capture(page, "fukashi");
r = await page.evaluate(() => ({
  label: document.querySelector("#hireToggle").textContent,
  cost: WD_DEBUG.squadApi.unitCost("ashigaru"),
}));
check(
  "信濃を取ると、すぐ雇用費 -15%（ランダム雇用20G）",
  r.cost === 13 && /20G/.test(r.label),
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.disbandSquad(WD_DEBUG.state().squads.find((q) => q.state === "reserve")); // 部隊の枠を1つ空ける
  const g0 = WD_DEBUG.state().gold;
  const q = a.hireSquad("ashigaru", 650, 300);
  return { paid: g0 - WD_DEBUG.state().gold, ok: !!q };
});
check("雇用では割引後の費用を払う", r.ok && r.paid === 130, JSON.stringify(r));
await page.tap("#battleClose").catch(() => {});
await openSiegeFormation(page);
await page.tap("#siegeTarget [data-provinces]");
const list = await page.textContent("#siegePick");
check(
  "領土の一覧に各国の効果と、いま効いている効果を表示",
  /✅ 楽市楽座：ウェーブクリアのゴールド \+20%/.test(list) &&
    /取ると 甲州金/.test(list) &&
    /領土の効果：楽市楽座/.test(list),
  list.slice(0, 200),
);
await page.tap("#squadClose");
await page.tap("#reset");
check("最初からやり直しても開始ゴールドに効果", (await page.evaluate(() => WD_DEBUG.state().gold)) === 700);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
