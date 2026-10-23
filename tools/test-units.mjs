#!/usr/bin/env node
// 路上配置の兵士（足軽・弓兵）の動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test-units.mjs
//   SCREENSHOTS=dir node tools/test-units.mjs … 画面写真も保存
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
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
async function newPage() {
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
const S = (page) =>
  page.evaluate(() => {
    const s = WD_DEBUG.state();
    return {
      gold: s.gold,
      wave: s.wave,
      playing: s.playing,
      over: s.over,
      hp: s.hp,
      towers: s.towers.length,
      units: s.units.map((u) => ({ id: u.id, type: u.type, x: u.x, y: u.y, hp: u.hp, max: u.max })),
      redeploy: { ...s.unitRedeploy },
      selectedUnit: s.selectedUnit && s.selectedUnit.id,
      selectedTower: s.selectedTower && s.selectedTower.id,
      enemies: s.enemies
        .filter((e) => !e.holder)
        .map((e) => ({
          kind: e.kind,
          d: e.d,
          x: e.x,
          hp: e.hp,
          blocked: e.blockedBy ? e.blockedBy.id : null,
        })),
    };
  });
const msgText = (page) => page.textContent("#msg");
const step = (page, sec) => page.evaluate((s) => WD_DEBUG.step(s), sec);
const deselect = async (page) => {
  if (await page.isVisible("#tpClose")) await page.tap("#tpClose");
  if (await page.isVisible("#upClose")) await page.tap("#upClose");
};
const unitById = (st, id) => st.units.find((u) => u.id === id);

// 道の上の地点（上の道 y=165、下の道 y=440、合流後 y=300）
const U1 = [300, 165],
  U2 = [400, 165],
  L1 = [300, 440],
  M1 = [650, 300],
  M2 = [740, 300];

let { page, errors } = await newPage();
await page.evaluate(() => WD_DEBUG.setGold(3000));

console.log("■ 兵種の選択");
const btns = await page.$$eval("[data-u]", (bs) => bs.map((b) => b.dataset.u));
check("選択できるのは足軽と弓兵の2種類", btns.join() === "ashigaru,archer", btns.join());
const toolsText = await page.textContent("#unitTools");
check("未実装の兵種（槍兵・鉄砲隊・騎馬兵）は表示しない", !/槍兵|鉄砲|騎馬/.test(toolsText));
const imgs = await page.$$eval("[data-u] img", (ims) => ims.map((i) => i.complete && i.naturalWidth > 0));
check("ボタンに兵士画像を表示", imgs.length === 2 && imgs.every(Boolean));
const cfg = await page.evaluate(() => WD_DEBUG.unitConfig);
check(
  "全5兵種の設定と画像を保持（未実装は enabled:false）",
  Object.keys(cfg.UNIT_CONFIG).length === 5 &&
    ["spearman", "gunner", "cavalry"].every((k) => cfg.UNIT_CONFIG[k].enabled === false),
);

console.log("■ 路上配置");
await page.tap('[data-u="ashigaru"]');
await tapMap(page, 650, 322);
let st = await S(page);
check(
  "道をタップで配置・中心線に補正（y=322 → 300）",
  st.units.length === 1 && near(st.units[0].x, 650, 0.5) && near(st.units[0].y, 300, 0.01),
  JSON.stringify(st.units),
);
check("配置費用 60G", st.gold === 3000 - 60);
for (const [label, xy, re] of [
  ["草地", [330, 300], /道の上/],
  ["入口の近く", [60, 300], /入口/],
  ["城の直前", [880, 300], /城の直前/],
  ["近すぎる位置", [692, 300], /近すぎ/],
]) {
  await tapMap(page, ...xy);
  const m = await msgText(page);
  st = await S(page);
  check(`${label}には配置できない`, st.units.length === 1 && re.test(m), m);
}
await page.tap('[data-t="arrow"]');
await tapMap(page, ...U2);
st = await S(page);
check("塔の建設モードで道をタップしても兵士・塔は置かれない", st.units.length === 1 && st.towers === 0);
await page.tap('[data-u="archer"]');
await tapMap(page, ...U1);
await tapMap(page, ...L1);
await page.tap('[data-u="ashigaru"]');
await tapMap(page, ...M2);
st = await S(page);
check("4人まで配置できる", st.units.length === 4, JSON.stringify(st.units.map((u) => u.type)));
await page.tap('[data-u="archer"]');
await tapMap(page, ...U2);
st = await S(page);
check("5人目は配置できない（最大4人）", st.units.length === 4 && /4 人まで/.test(await msgText(page)));
if (shots) await page.screenshot({ path: path.join(shots, "u1-deployed.png"), fullPage: true });

console.log("■ 選択・パネル");
await tapMap(page, 650, 300 + 12 - 44); // 頭のあたり
st = await S(page);
check("兵士の頭をタップしても選択できる", st.selectedUnit === 1);
check(
  "兵士パネルにHPと撤退",
  (await page.isVisible("#unitPanel")) &&
    /HP 260 \/ 260/.test(await page.textContent("#upHpText")) &&
    (await page.isVisible("#retreat")),
);
check("兵士選択中は塔パネルを出さない", !(await page.isVisible("#towerPanel")));
await tapMap(page, 600, 560);
st = await S(page);
check("選択中に空き地をタップ → 選択解除のみ（配置しない）", !st.selectedUnit && st.units.length === 4);
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225); // 足軽 #1 の上側の草地
st = await S(page);
check("塔を建設できる（兵士モード解除後）", st.towers === 1);
await tapMap(page, 650, 225);
check(
  "塔をタップ → 塔パネル、兵士パネルは閉じる",
  (await page.isVisible("#towerPanel")) && !(await page.isVisible("#unitPanel")),
);
await tapMap(page, ...M1);
check(
  "塔選択中に兵士をタップ → 兵士パネルに切替",
  (await page.isVisible("#unitPanel")) && !(await page.isVisible("#towerPanel")),
);
if (shots) await page.screenshot({ path: path.join(shots, "u2-unit-panel.png"), fullPage: true });
await deselect(page);

console.log("■ 足止め・反撃・塔との連携");
await page.tap("#start");
// ウェーブが途中で終わらないよう、どの射程にも入らない停止した敵（holder）を入口に置く
const clearEnemies = () =>
  page.evaluate(() => {
    const s = WD_DEBUG.state();
    for (let i = s.enemies.length - 1; i >= 0; i--) if (!s.enemies[i].holder) s.enemies.splice(i, 1);
  });
await page.evaluate(() => {
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
});
// 合流点(560,300)の手前から足軽#1(650,300)へ向かう騎士
await page.evaluate(() =>
  WD_DEBUG.addEnemy({ kind: "knight", d: 694, hp: 1e6, speed: 42, reward: 22, r: 15 }),
);
await step(page, 3);
st = await S(page);
const knight = st.enemies[0];
check("足軽に触れた敵は足止めされる", knight.blocked === 1 && knight.x < 650, JSON.stringify(knight));
await step(page, 2);
let st2 = await S(page);
check("足止め中は移動しない（移動処理に反映）", near(st2.enemies[0].d, knight.d, 0.001));
check("足止めした敵から反撃を受ける", unitById(st2, 1).hp < 260);
check(
  "塔の攻撃も足止め中の敵に命中（足軽単独より大きく減る）",
  knight.hp - st2.enemies[0].hp > 16 * 3 + 12,
  String(knight.hp - st2.enemies[0].hp),
);
// 2体目（足止め上限1）は通過
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 720, hp: 1e6, speed: 65 }));
await step(page, 1.5);
st = await S(page);
const gob = st.enemies.find((e) => e.kind === "goblin");
check("足止め上限を超えた敵は足軽#1を通過する", gob.blocked !== 1 && gob.x > 660, JSON.stringify(gob));
// ドラゴンは止められない
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  s.enemies.splice(
    s.enemies.findIndex((e) => e.kind === "goblin"),
    1,
  );
  WD_DEBUG.addEnemy({ kind: "dragon", d: 700, hp: 1e6, speed: 85, r: 16 });
});
await step(page, 0.3);
st = await S(page);
check(
  "止められない敵（ドラゴン）は足止めされない",
  st.enemies.find((e) => e.kind === "dragon").blocked === null,
);
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  s.enemies.splice(
    s.enemies.findIndex((e) => e.kind === "dragon"),
    1,
  );
});

console.log("■ 戦闘不能・足止め解除・再配置待ち");
await page.evaluate(() => (WD_DEBUG.state().units.find((u) => u.id === 1).hp = 1));
await step(page, 1.5);
st = await S(page);
check("HP0で退場", !unitById(st, 1));
check("倒れた足軽の足止めは解除", st.enemies[0].blocked === null);
const dBefore = st.enemies[0].d;
await step(page, 0.5);
st = await S(page);
check("解除後は敵が再び進む", st.enemies[0].d > dBefore);
check(
  "戦闘不能の再配置待ち 15秒（足軽）",
  st.redeploy.ashigaru > 12 && st.redeploy.ashigaru <= 15,
  String(st.redeploy.ashigaru),
);
await deselect(page);
await page.tap('[data-u="ashigaru"]');
await tapMap(page, ...M1);
st = await S(page);
check("ウェーブ中である（holder）", st.playing);
check(
  "再配置待ち中は同じ兵種を配置できない",
  st.units.length === 3 && /再配置まで/.test(await msgText(page)),
);
check("ボタンに待ち時間を表示", /⌛/.test(await page.textContent('[data-u="ashigaru"]')));
await clearEnemies();

console.log("■ 撤退");
await tapMap(page, ...U1);
const archer = (await S(page)).units.find((u) => u.x === 300 && u.y === 165);
const g0 = (await S(page)).gold;
await page.tap("#retreat");
st = await S(page);
check("撤退できる", !unitById(st, archer.id) && !(await page.isVisible("#unitPanel")));
check(
  "撤退の返金（費用×50%×残りHP割合）",
  st.gold - g0 === Math.floor(80 * 0.5 * (archer.hp / archer.max)),
  String(st.gold - g0),
);
check("撤退後の再配置待ち 8秒", near(st.redeploy.archer, 8, 0.1));
await page.tap('[data-u="archer"]');
await tapMap(page, ...U1);
st = await S(page);
check("撤退直後の再配置はできない（連続配置で回避不可）", !st.units.some((u) => u.x === 300 && u.y === 165));
await page.tap("#pause");
const w0 = (await S(page)).redeploy.archer;
await page.waitForTimeout(1000);
check("停止中は再配置待ちが進まない", (await S(page)).redeploy.archer === w0);
await page.tap("#pause");
await page.tap("#speed");
let t0 = Date.now(),
  r0 = (await S(page)).redeploy.archer;
await page.waitForTimeout(1000);
let r1 = (await S(page)).redeploy.archer,
  real = (Date.now() - t0) / 1000;
check(
  "x2では2倍速で進む",
  near(r0 - r1, real * 2, 0.6),
  `${(r0 - r1).toFixed(2)} vs ${(real * 2).toFixed(2)}`,
);
await page.tap("#speed");
await step(page, 8);
await tapMap(page, ...U1);
st = await S(page);
check(
  "待ち時間の後は再配置できる",
  st.units.some((u) => u.x === 300 && u.y === 165),
);

console.log("■ 弓兵・撃破処理");
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 330, hp: 1e6, speed: 65 }));
const archer2 = (await S(page)).units.find((u) => u.x === 300 && u.y === 165);
await step(page, 0.5);
st = await S(page);
check("弓兵は射程内の敵を攻撃する", st.enemies[0].hp < 1e6);
check("弓兵は足止めしない", st.enemies[0].blocked === null);
await step(page, 2);
st = await S(page);
check("近くを通る敵から攻撃を受ける", unitById(st, archer2.id).hp < unitById(st, archer2.id).max);
await clearEnemies();
// 足軽(#4 @740)に止められ、塔の射程外の敵を、兵士と同時に倒す
const g1 = (await S(page)).gold;
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 150, hp: 3, reward: 10, speed: 0 });
  for (const u of s.units) u.cd = 0;
  for (const t of s.towers) t.cd = 0;
});
await step(page, 0.1);
st = await S(page);
check(
  "同時攻撃で倒しても報酬は1回だけ",
  st.gold - g1 === 10 && st.enemies.length === 0,
  String(st.gold - g1),
);
// 城に到達した敵は報酬なし・二重に減らない
const before = await S(page);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 1090, hp: 5, speed: 300 }));
await step(page, 0.2);
st = await S(page);
check("城に到達した敵は HP-1 のみ・報酬なし", st.hp === before.hp - 1 && st.gold === before.gold);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ ウェーブ終了・リセット");
await page.evaluate(() => {
  WD_DEBUG.state().unitRedeploy.archer = 5;
  WD_DEBUG.state().enemies.length = 0; // holder も消してウェーブを終える
});
await step(page, 0.1);
st = await S(page);
check("ウェーブクリアで再配置待ちを解除（設定）", !st.playing && st.redeploy.archer === 0);
check("兵士はウェーブをまたいで残る（倒れた1人を除く3人）", st.units.length === 3, String(st.units.length));
await page.tap("#reset");
st = await S(page);
check(
  "リセットで兵士・待ち時間を初期化",
  st.units.length === 0 &&
    Object.values(st.redeploy).every((v) => v === 0) &&
    !(await page.isVisible("#unitPanel")),
);
check("リセット後の人数表示", (await page.textContent("#unitCount")).includes("0/4"));
await context_close(page);

console.log("■ 回帰：兵士ありで20ウェーブ");
({ page, errors } = await newPage());
await page.evaluate(() => WD_DEBUG.setGold(99999));
const spots = [
  [330, 300],
  [420, 300],
  [330, 80],
  [700, 420],
  [700, 190],
  [180, 180],
  [180, 420],
  [650, 60],
  [650, 540],
  [790, 220],
  [790, 380],
  [330, 520],
];
const kinds = ["magic", "cannon", "arrow", "ice"];
for (let i = 0; i < spots.length; i++) {
  await deselect(page);
  await page.tap(`[data-t="${kinds[i % 4]}"]`);
  await tapMap(page, ...spots[i]);
}
await page.evaluate(() => {
  for (const t of WD_DEBUG.state().towers) t.level = 5;
});
await deselect(page);
await page.tap('[data-u="ashigaru"]');
await tapMap(page, ...M1);
await tapMap(page, ...M2);
await page.tap('[data-u="archer"]');
await tapMap(page, ...U2);
await tapMap(page, ...L1);
let ok = true,
  rewards = true;
for (let w = 1; w <= 20; w++) {
  await page.evaluate(() => document.getElementById("start").click());
  for (let k = 0; k < 400; k++) {
    const r = await page.evaluate(() => {
      WD_DEBUG.step(1);
      const s = WD_DEBUG.state();
      return {
        playing: s.playing,
        stale: s.enemies.some((e) => e.blockedBy && !s.units.includes(e.blockedBy)),
      };
    });
    if (r.stale) ok = false;
    if (!r.playing) break;
  }
  st = await S(page);
  if (st.wave !== w || st.playing) ok = false;
  if (st.over) break;
}
st = await S(page);
check(
  "兵士を配置したまま20ウェーブを最後まで進行",
  ok && st.wave === 20 && st.over,
  `wave=${st.wave} hp=${st.hp}`,
);
check("存在しない兵士による足止めが残らない", ok);
check("回帰テスト中エラーなし", errors.length === 0, errors.join(" / "));
await context_close(page);

console.log("■ モバイル表示");
({ page, errors } = await newPage());
await page.tap('[data-u="ashigaru"]');
await tapMap(page, ...M1);
await tapMap(page, ...M1);
const layout = await page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null;
  const btns = [...document.querySelectorAll("#unitPanel button, .unit-tools button")].filter(vis);
  const texts = [...document.querySelectorAll("#unitPanel, #unitPanel *, .unit-tools, .unit-tools *")].filter(
    (e) =>
      vis(e) &&
      e.childNodes.length &&
      [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
  );
  const panel = document.getElementById("unitPanel").getBoundingClientRect(),
    canvas = document.getElementById("game").getBoundingClientRect();
  return {
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minBtnH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))),
    overlap: panel.top < canvas.bottom - 1,
  };
});
check("横スクロールが出ない (390px)", !layout.hScroll);
check("兵士ボタン・撤退ボタンの高さ 44px 以上", layout.minBtnH >= 44, String(layout.minBtnH));
check("兵士の文字 14px 以上", layout.minFont >= 14, String(layout.minFont));
check("兵士パネルがマップに重ならない", !layout.overlap);
if (shots) await page.screenshot({ path: path.join(shots, "u3-mobile.png"), fullPage: true });
check("モバイル表示でエラーなし", errors.length === 0, errors.join(" / "));

async function context_close(p) {
  await p.context().close();
}
await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
