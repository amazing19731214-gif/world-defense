#!/usr/bin/env node
// 部隊チップ（保有している部隊をすぐ配置）と、畳める雇用ボタンの動作確認
//   node tools/test-quickdeploy.mjs
//   SCREENSHOTS=dir node tools/test-quickdeploy.mjs … 画面写真も保存
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
const TYPES = ["ashigaru", "spearman", "archer", "gunner"]; // 第一〜第四部隊
const save = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
TYPES.forEach((type, i) => {
  save.squads.push({ id: i + 1, type, slot: i });
  for (let k = 0; k < 5; k++)
    save.soldiers.push({ id: i * 5 + k + 1, type, squadId: i + 1, level: i + 2 + (k % 2) });
});
// 保存データは最初に一度だけ入れて読み込み直す
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
    if (seed) localStorage.setItem("worldDefense.soldiers.v1", seed);
  }, seed);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
async function tapMap(page, x, y) {
  const p = await page.evaluate(
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
const chips = (page) =>
  page.$$eval("[data-chip]", (bs) =>
    bs.map((b) => ({
      id: +b.dataset.chip,
      text: b.textContent,
      label: b.getAttribute("aria-label"),
      cls: b.className,
    })),
  );
const squadState = (page, id) =>
  page.evaluate((id) => {
    const q = WD_DEBUG.state().squads.find((q) => q.id === id);
    return q && { state: q.state, locked: !!q.locked };
  }, id);

console.log("■ 部隊がまだ無いとき");
let { page, errors, context } = await newContext(null);
check("部隊チップは無い", (await chips(page)).length === 0);
check("兵種の選択ボタンなし", await page.locator('[data-u]').count()===0);
check("「＋ 雇う」は1クリックで購入できる", await page.isEnabled('#hireToggle'));
await page.tap('#hireToggle');
let c=await chips(page);
check("雇うと待機中の部隊チップが現れる",c.length===1&&/1人·待機/.test(c[0].text),JSON.stringify(c));
await page.tap('[data-chip="1"]');await tapMap(page,650,300);
c=await chips(page);
check("チップと道の2タップで出陣",/出陣中/.test(c[0].text));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 保有している部隊のチップ");
({ page, errors, context } = await newContext(JSON.stringify(save)));
const order = await page.evaluate(() => {
  const top = (sel) => document.querySelector(sel).getBoundingClientRect(),
    map = top("#game"),
    start = top("#start");
  return {
    startTop: start.top,
    startLeft: start.left,
    startH: start.height,
    mapBottom: map.bottom,
    mapLeft: map.left,
    fits: start.bottom <= innerHeight,
    units: top("#unitTools").top,
    towers: top(".tower-tools").top,
    menu: top("#gacha").top,
  };
});
check(
  "「ウェーブ開始」はマップのすぐ下の左端に大きく（スクロールしなくても見える）",
  order.startTop > order.mapBottom &&
    order.startTop - order.mapBottom < 40 &&
    Math.abs(order.startLeft - order.mapLeft) < 4 &&
    order.startH >= 52 &&
    order.fits,
  JSON.stringify(order),
);
check(
  "並び順：ウェーブ開始 → 部隊 → 塔 → その他の画面",
  order.startTop < order.units && order.units < order.towers && order.towers < order.menu,
  JSON.stringify(order),
);
c = await chips(page);
check(
  "第一〜第四部隊をチップで表示",
  c.length === 4 && c.map((x) => x.id).join() === "1,2,3,4" && /第一/.test(c[0].text),
  JSON.stringify(c.map((x) => x.text)),
);
check(
  "チップに人数と状態（平均Lvは読み上げ用の説明に。第一部隊：Lv2・3・2・3・2 → 5人・Lv2）",
  /5人·待機/.test(c[0].text) && /第一部隊・待機中・5人・平均Lv2/.test(c[0].label),
  JSON.stringify(c[0]),
);
check("チップに兵種の絵", (await page.$$('[data-chip="1"] img')).length === 1);
check("部隊があっても兵種選択を出さない",await page.locator('[data-u]').count()===0);
check("「＋ 雇う」に費用を表示",/24G/.test(await page.textContent('#hireToggle')));

console.log("■ チップ → 道をタップで配置（2タップ）");
await page.tap('[data-chip="2"]');
let r = await page.evaluate(() => ({
  place: WD_DEBUG.state().placeSquadId,
  toast: document.getElementById("toast").textContent,
}));
check("チップを押すと配置する部隊に選ばれる", r.place === 2, JSON.stringify(r));
check(
  "道をタップするよう画面の上に表示",
  /第二部隊：道をタップして配置しよう/.test(r.toast),
  r.toast,
);
check("選んだチップが目立つ", /active/.test((await chips(page))[1].cls));
if (shots) await page.screenshot({ path: path.join(shots, "q1-select.png") });
await tapMap(page, 650, 300);
check("道をタップすると配置される", (await squadState(page, 2)).state === "deployed");
c = await chips(page);
check(
  "チップが「出陣中」に変わる",
  /出陣中/.test(c[1].text) && /\bout\b/.test(c[1].cls),
  JSON.stringify(c[1]),
);
check("配置 1/8 になる", /配置 1\/8/.test(await page.textContent("#unitCount")));
check("ゴールドは減らない", (await page.evaluate(() => WD_DEBUG.state().gold)) === 500);

console.log("■ 選び直し・取り消し");
await page.tap('[data-chip="3"]');
await page.tap('[data-chip="3"]');
check(
  "同じチップをもう一度押すと取り消し",
  (await page.evaluate(() => WD_DEBUG.state().placeSquadId)) === null &&
    /配置をやめた/.test(await page.textContent("#msg")),
);
await page.evaluate(()=>WD_DEBUG.squadApi.selectUnitForFixture("ashigaru"));
await page.tap('[data-chip="3"]');
r = await page.evaluate(() => ({
  place: WD_DEBUG.state().placeSquadId,
  unit: WD_DEBUG.state().selectedUnitType,
}));
check("兵種を選んでいてもチップを押せば部隊の配置に切り替わる", r.place === 3 && !r.unit, JSON.stringify(r));

console.log("■ 出陣中の部隊のチップ");
await page.tap('[data-chip="2"]');
r = await page.evaluate(() => ({
  panel: !document.getElementById("squadPanel").hidden,
  title: document.getElementById("sqTitle").textContent,
  place: WD_DEBUG.state().placeSquadId,
}));
check(
  "出陣中のチップを押すと部隊パネルが開く（撤退・治療）",
  r.panel && /第二部隊/.test(r.title),
  JSON.stringify(r),
);
check("配置の選択は解除", r.place === null);

console.log("■ ウェーブ中の変化");
await page.evaluate(() => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "wolf", d: 0, hp: 1e9, speed: 0 }); // ウェーブを終わらせない
});
await page.tap("#retreat");
r = await squadState(page, 2);
check("撤退を始めると状態が変わる", r.state === "retreating", JSON.stringify(r));
check("チップが「撤退中」になる", /撤退中/.test((await chips(page))[1].text));
await page.evaluate(() => {
  WD_DEBUG.step(20);
});
await page.waitForTimeout(200);
c = await chips(page);
check(
  "撤退が終わると、戦闘中でもチップが自動で待機に戻る（撤退直後は薄く）",
  /5人/.test(c[1].text) && /\bwait\b/.test(c[1].cls),
  JSON.stringify(c[1]),
);
await page.tap('[data-chip="2"]');
check(
  "撤退直後の部隊は配置できないと知らせる",
  /撤退したばかり/.test(await page.textContent("#toast")) &&
    (await page.evaluate(() => WD_DEBUG.state().placeSquadId)) === null,
);
await page.tap('[data-chip="4"]');
await tapMap(page, 650, 300);
check("ウェーブ中でもチップから配置できる", (await squadState(page, 4)).state === "deployed");

console.log("■ 画面（390px）");

const lay = await page.evaluate(() => {
  const els = [
    ...document.querySelectorAll(
      "[data-chip], [data-u], #hireToggle, #organize, #start, #pace, #recoverAll, .menu-tools button, [data-t]",
    ),
  ].filter((b) => b.getClientRects().length); // 出していないボタン（試作版だけのボタンなど）は数えない
  return {
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minH: Math.min(...els.map((b) => b.getBoundingClientRect().height)),
    minW: Math.min(...els.map((b) => b.getBoundingClientRect().width)),
    minFont: Math.min(
      ...[...document.querySelectorAll("[data-chip] *, [data-chip], #unitCount, #unitCount *")]
        .filter((e) => e.textContent.trim() && e.tagName !== "IMG")
        .map((e) => parseFloat(getComputedStyle(e).fontSize)),
    ),
    overflow: [...document.querySelectorAll("[data-chip], .menu-tools button, .play-tools button")].some(
      (b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().height > 60,
    ),
  };
});
check("横スクロールなし", !lay.hScroll);
check("ボタンは押しやすい大きさ（高さ44px以上）", lay.minH >= 44 && lay.minW >= 60, JSON.stringify(lay));
check("文字は14px以上", lay.minFont >= 14, JSON.stringify(lay));
check("ボタンの文字がはみ出さない・折り返さない", !lay.overflow);
if (shots) await page.screenshot({ path: path.join(shots, "q2-open.png"), fullPage: true });
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
