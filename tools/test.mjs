#!/usr/bin/env node
// 動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test.mjs              … index.html を検査
//   SCREENSHOTS=dir node tools/test.mjs … 画面写真も保存
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

const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launch);

// 武将はガチャで獲得するため、テストでは「ガチャで3人獲得済み」の保存データから始める
// （黒田官兵衛＝射程・攻撃速度、上杉謙信＝攻撃・範囲攻撃、武田信玄＝支援）
const DEFAULT_SAVE = JSON.stringify({
  version: 1,
  owned: { kanbei: 1, kenshin: 1, shingen: 1 },
  tickets: 0,
  history: [],
});
async function newPage(storage = DEFAULT_SAVE) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (storage !== null)
    await context.addInitScript((v) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("worldDefense.warlords.v1", v);
        sessionStorage.setItem("seeded", "1");
      }
    }, storage);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
// キャンバス座標（960x600）をタップ
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
      paused: s.paused,
      over: s.over,
      hp: s.hp,
      towers: s.towers.map((t) => ({ id: t.id, type: t.type, level: t.level, st: WD_DEBUG.towerStats(t) })),
      heroes: Object.fromEntries(
        Object.values(s.heroState).map((h) => [
          h.id,
          { tower: h.tower && h.tower.id, active: h.active, cd: h.cd },
        ]),
      ),
      selected: s.selectedTower && s.selectedTower.id,
      enemies: s.enemies.length,
    };
  });
const tid = (st, id) => st.towers.find((t) => t.id === id);
async function assignVia(page, towerXY, heroId) {
  await tapMap(page, ...towerXY);
  await page.tap("#assign");
  await page.tap(`[data-assign="${heroId}"]`);
}
async function deselect(page) {
  if (await page.isVisible("#towerPanel")) await page.tap("#tpClose");
}

// 建設できる草地（道から58以上・塔同士65以上）
const A = [330, 300],
  B = [420, 300],
  Cc = [330, 80],
  D = [700, 420],
  E = [700, 190];

console.log("■ 起動・建設・塔パネル");
let { page, errors } = await newPage();
let st = await S(page);
check("初期状態 500G / WAVE 0 / HP20", st.gold === 500 && st.wave === 0 && st.hp === 20);
check("ガチャで獲得済みの武将3人を所持", Object.keys(st.heroes).sort().join() === "kanbei,kenshin,shingen");
await page.evaluate(() => WD_DEBUG.setGold(5000));
for (const [type, xy] of [
  ["arrow", A],
  ["arrow", B],
  ["cannon", Cc],
  ["magic", D],
  ["ice", E],
]) {
  await page.tap(`[data-t="${type}"]`);
  await tapMap(page, ...xy);
}
st = await S(page);
check("4種類の塔を5基建設", st.towers.length === 5, JSON.stringify(st.towers.map((t) => t.type)));
check("建設費が引かれる", st.gold === 5000 - 100 - 100 - 180 - 220 - 150, String(st.gold));
await tapMap(page, ...A);
check("塔タップでパネル表示", await page.isVisible("#towerPanel"));
check(
  "パネルに強化・売却・武将配属",
  (await page.isVisible("#upgrade")) && (await page.isVisible("#sell")) && (await page.isVisible("#assign")),
);
check("武将なしでは必殺技ボタン非表示", !(await page.isVisible("#skill")));
await tapMap(page, 600, 560);
st = await S(page);
check("選択中に草地タップ → 選択解除のみ（誤建設しない）", st.towers.length === 5 && !st.selected);

console.log("■ 配属・解除・再配属");
await tapMap(page, ...A);
await page.tap("#assign");
check("配属画面が開く", await page.isVisible("#heroSheet"));
const sheetText = await page.textContent("#heroList");
check("能力と配属先が表示される", sheetText.includes("射程 +20%") && sheetText.includes("未配属"));
await page.tap('[data-assign="kanbei"]');
st = await S(page);
check("黒田官兵衛を塔#1に配属", st.heroes.kanbei.tower === 1);
check("射程 155 → 186", near(tid(st, 1).st.range, 186), String(tid(st, 1).st.range));
check("塔パネルに武将名", (await page.textContent("#tpHero")).includes("黒田官兵衛"));
await page.tap("#upgrade");
st = await S(page);
check(
  "強化後 Lv2 攻撃 18×1.55、射程は186のまま",
  tid(st, 1).level === 2 && near(tid(st, 1).st.damage, 27.9) && near(tid(st, 1).st.range, 186),
);
for (let i = 0; i < 4; i++) {
  await deselect(page);
  await assignVia(page, B, "kanbei");
  await deselect(page);
  await assignVia(page, A, "kanbei");
}
st = await S(page);
check(
  "再配属を繰り返しても効果が積み上がらない",
  near(tid(st, 1).st.range, 186) && near(tid(st, 2).st.range, 155),
);
await deselect(page);
await assignVia(page, B, "kanbei");
st = await S(page);
check(
  "同じ武将は1か所だけ（移動元は武将なし）",
  st.heroes.kanbei.tower === 2 && near(tid(st, 1).st.range, 155),
);
await deselect(page);
await assignVia(page, B, "kenshin");
st = await S(page);
check(
  "1基1人：別の武将を配属すると前の武将は未配属",
  st.heroes.kenshin.tower === 2 && st.heroes.kanbei.tower === null,
);
await page.tap("#assign");
await page.tap('[data-unassign="kenshin"]');
await page.tap("#sheetClose");
st = await S(page);
check("解除できる", st.heroes.kenshin.tower === null && near(tid(st, 2).st.damage, 18));

console.log("■ 上杉謙信・武田信玄・重複");
await deselect(page);
await assignVia(page, Cc, "kenshin");
st = await S(page);
check(
  "上杉謙信：大砲の攻撃 ×1.3・爆発 65→91",
  near(tid(st, 3).st.damage, 62.4) && near(tid(st, 3).st.splash, 91),
);
await deselect(page);
await assignVia(page, A, "shingen");
st = await S(page);
check(
  "武田信玄：近く(90)の塔#2 間隔 0.45→0.375",
  near(tid(st, 2).st.rate, 0.375),
  String(tid(st, 2).st.rate),
);
check("武田信玄：配属先の塔自身は対象外（設定）", near(tid(st, 1).st.rate, 0.45));
check("武田信玄：遠い塔#4(魔法)は対象外", near(tid(st, 4).st.rate, 0.8));
check("武田信玄：塔#3(距離220)は対象外", near(tid(st, 3).st.rate, 1.6));
await deselect(page);
await assignVia(page, B, "kanbei");
st = await S(page);
check(
  "黒田官兵衛＋武田信玄の支援は別々に1回ずつ適用",
  near(tid(st, 2).st.range, 186) && near(tid(st, 2).st.rate, 0.375),
);
if (shots) await page.screenshot({ path: path.join(shots, "1-assigned.png"), fullPage: true });

console.log("■ 必殺技・停止・速度");
await deselect(page);
await tapMap(page, ...B);
check("ウェーブ前は必殺技を使えない", await page.isDisabled("#skill"));
await page.tap("#start");
// ウェーブが途中で終わらないよう、どの塔の射程にも入らない停止した敵を置く
await page.evaluate(() =>
  WD_DEBUG.state().enemies.push({
    path: [
      [0, 300],
      [1, 300],
    ],
    d: 0,
    x: 0,
    y: 300,
    kind: "knight",
    hp: 1e9,
    max: 1e9,
    speed: 0,
    reward: 0,
    color: "#677b9b",
    r: 15,
    slow: 0,
  }),
);
await page.waitForTimeout(100);
check("ウェーブ中は使える", !(await page.isDisabled("#skill")));
await page.tap("#skill");
st = await S(page);
check(
  "黒田官兵衛 必殺技：効果8秒・再使用40秒",
  near(st.heroes.kanbei.active, 8, 0.2) && near(st.heroes.kanbei.cd, 40, 0.2),
);
check(
  "必殺技 ×1.8 と武田信玄の支援 ×1.2 は掛け算（×2.16）",
  near(tid(st, 2).st.speedMul, 2.16),
  String(tid(st, 2).st.speedMul),
);
check("必殺技の表示（残り秒数）", (await page.textContent("#skillLabel")).includes("発動中"));
if (shots) await page.screenshot({ path: path.join(shots, "2-skill.png"), fullPage: true });
await page.tap("#pause");
const p0 = (await S(page)).heroes.kanbei;
await page.waitForTimeout(1200);
const p1 = (await S(page)).heroes.kanbei;
check("停止中は効果時間・再使用待ちが止まる", p0.active === p1.active && p0.cd === p1.cd);
await page.tap("#pause");
let t0 = Date.now(),
  a0 = (await S(page)).heroes.kanbei.active;
await page.waitForTimeout(1000);
let a1 = (await S(page)).heroes.kanbei.active,
  real = (Date.now() - t0) / 1000;
check(
  "x1：実時間とほぼ同じ速さで減る",
  near(a0 - a1, real, 0.35),
  `${(a0 - a1).toFixed(2)} vs ${real.toFixed(2)}`,
);
await page.tap("#speed");
t0 = Date.now();
a0 = (await S(page)).heroes.kanbei.active;
await page.waitForTimeout(1000);
a1 = (await S(page)).heroes.kanbei.active;
real = (Date.now() - t0) / 1000;
check(
  "x2：2倍の速さで減る（敵・塔と同じ時間）",
  near(a0 - a1, real * 2, 0.6),
  `${(a0 - a1).toFixed(2)} vs ${(real * 2).toFixed(2)}`,
);
await page.tap("#speed");
await page.evaluate(() => WD_DEBUG.step(10));
st = await S(page);
check(
  "効果時間が終わると終了・再使用待ちは継続",
  st.heroes.kanbei.active === 0 && st.heroes.kanbei.cd > 0 && st.heroes.kanbei.cd < 40,
);
check("効果終了後は攻撃速度が支援分だけに戻る", near(tid(st, 2).st.rate, 0.375));
const cdBefore = st.heroes.kanbei.cd;
await deselect(page);
await assignVia(page, E, "kanbei");
await deselect(page);
await assignVia(page, B, "kanbei");
st = await S(page);
check(
  "再配属しても再使用待ちはリセットされない",
  near(st.heroes.kanbei.cd, cdBefore, 1.5) && st.heroes.kanbei.cd > 20,
  `${cdBefore} → ${st.heroes.kanbei.cd}`,
);
check("再使用待ち中は発動できない", await page.isDisabled("#skill"));
// 武田信玄の必殺技
await deselect(page);
await page.tap('[data-t="magic"]');
await tapMap(page, 330, 505); // 塔#6：武田信玄から距離205（通常170の外・強化212.5の内）
st = await S(page);
check("塔#6 は通常の支援範囲外", near(tid(st, 6).st.rate, 0.8));
await tapMap(page, ...A);
await page.tap("#skill");
st = await S(page);
check("武田信玄 必殺技：支援 +45%（塔#2 は上限内で ×1.45）", near(tid(st, 2).st.speedMul, 1.45));
check(
  "武田信玄 必殺技：範囲 ×1.25 で塔#6(距離205)にも届く",
  near(tid(st, 6).st.rate, 0.8 / 1.45) && near(tid(st, 3).st.rate, 1.6),
);
await page.evaluate(() => (WD_DEBUG.state().heroState.kanbei.cd = 0)); // テスト用に再使用待ちを省略
await deselect(page);
await tapMap(page, ...B);
await page.tap("#skill");
st = await S(page);
check(
  "弓の必殺技 ×1.8 ＋ 武田信玄の必殺技 ×1.45 → 上限 ×2.5 で頭打ち",
  near(tid(st, 2).st.speedMul, 2.5),
  String(tid(st, 2).st.speedMul),
);
await page.evaluate(() => WD_DEBUG.step(10.5));
st = await S(page);
check(
  "武田信玄 必殺技終了で元の支援に戻る",
  near(tid(st, 2).st.speedMul, 1.2) && near(tid(st, 6).st.rate, 0.8),
);
// 上杉謙信の必殺技（敵を射程内に置いて確認）
await deselect(page);
await tapMap(page, ...Cc);
const hpDrop = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    t = s.towers.find((t) => t.id === 3);
  s.enemies.push({
    path: [
      [t.x, t.y + 60],
      [t.x + 1, t.y + 60],
    ],
    d: 0,
    x: t.x,
    y: t.y + 60,
    kind: "knight",
    hp: 99999,
    max: 99999,
    speed: 0,
    reward: 0,
    color: "#677b9b",
    r: 15,
    slow: 0,
  });
  return s.enemies[0];
});
await page.tap("#skill");
await page.evaluate(() => WD_DEBUG.step(2));
const enemyHp = await page.evaluate(() => WD_DEBUG.state().enemies.find((e) => e.max === 99999)?.hp);
st = await S(page);
check(
  "上杉謙信 必殺技：射程内の敵に範囲砲撃（3回分以上の追加ダメージ）",
  enemyHp !== undefined && 99999 - enemyHp >= 62.4 * 1.5 * 3,
  String(99999 - enemyHp),
);
check(
  "上杉謙信 必殺技：1.5秒で終了・再使用待ち35秒",
  st.heroes.kenshin.active === 0 && st.heroes.kenshin.cd > 32,
);

console.log("■ 売却・リセット");
await deselect(page);
await tapMap(page, ...B);
const goldBefore = (await S(page)).gold;
await page.tap("#sell");
st = await S(page);
check("武将付きの塔を売却 → 武将は未配属", st.heroes.kanbei.tower === null && st.towers.length === 5);
check("売却額は従来どおり（投資の70%）", st.gold - goldBefore === Math.floor(100 * 0.7));
check("売却した塔の支援は消える／再使用待ちは保持", st.heroes.kanbei.cd > 0);
await page.tap("#roster");
check("武将一覧で配属先を確認", (await page.textContent("#heroList")).includes("配属先："));
if (shots) await page.screenshot({ path: path.join(shots, "3-roster.png"), fullPage: true });
await page.tap("#sheetClose");
await page.tap("#reset");
st = await S(page);
check(
  "リセットで塔・武将配属・必殺技の時間が初期化",
  st.towers.length === 0 &&
    Object.values(st.heroes).every((h) => h.tower === null && h.cd === 0 && h.active === 0) &&
    st.gold === 500 &&
    st.wave === 0,
);
check("リセット後はパネル非表示", !(await page.isVisible("#towerPanel")));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 保存データ");
let saved = await page.evaluate(() => localStorage.getItem("worldDefense.warlords.v1"));
check("選択設定（最後に配属した武将）を保存", JSON.parse(saved).lastHero === "kanbei", saved);
check("リセットしても所持武将は残る", Object.keys(JSON.parse(saved).owned).length === 3);
for (const [label, raw] of [
  ["壊れたJSON", "{{{"],
  ["型違い", '"hello"'],
  ["null", "null"],
]) {
  const r = await newPage(raw);
  const s2 = await S(r.page);
  check(
    `${label}でも起動（武将なし・配属なし）`,
    r.errors.length === 0 && Object.keys(s2.heroes).length === 0,
    r.errors.join(" / "),
  );
  await r.context.close();
}
{
  const r = await newPage(
    JSON.stringify({
      owned: { ghost: 2, kanbei: 1, kenshin: "x" },
      tickets: -5,
      lastHero: "ghost",
      assignments: { kanbei: 99 },
    }),
  );
  const s2 = await S(r.page);
  check(
    "不明な武将・不正な値・存在しない塔への配属は読み込まない",
    r.errors.length === 0 && Object.keys(s2.heroes).join() === "kanbei" && s2.heroes.kanbei.tower === null,
    JSON.stringify(s2.heroes),
  );
  await r.context.close();
}
{
  const r = await newPage(
    JSON.stringify({
      version: 1,
      owned: { kanbei: 1, kenshin: 1, shingen: 1 },
      tickets: 0,
      lastHero: "shingen",
    }),
  );
  await r.page.tap("#roster");
  const first = await r.page.textContent(".hero-card h3");
  check("保存した選択設定を復元（一覧の先頭）", first.includes("武田信玄"), first);
  await r.context.close();
}
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("denied");
      },
    });
  });
  const p2 = await ctx2.newPage();
  const errs = [];
  p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto(url);
  await p2.waitForFunction(() => window.WD_DEBUG);
  check("localStorage が使えない環境でも起動", errs.length === 0, errs.join(" / "));
  await ctx2.close();
}

console.log("■ 回帰：20ウェーブ・分岐ルート");
({ page, errors } = await newPage());
await page.evaluate(() => WD_DEBUG.setGold(99999));
const spots = [
  A,
  B,
  Cc,
  D,
  E,
  [180, 180],
  [180, 420],
  [520, 230],
  [520, 370],
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
st = await S(page);
check("多数の塔を建設", st.towers.length >= 10, String(st.towers.length));
for (const t of st.towers) {
  await page.evaluate((id) => {
    const t = WD_DEBUG.state().towers.find((t) => t.id === id);
    while (t.level < 5) t.level++;
  }, t.id);
}
await deselect(page);
await assignVia(page, A, "shingen");
const routes = new Set();
let waveOk = true;
for (let w = 1; w <= 20; w++) {
  await page.evaluate(() => document.getElementById("start").click());
  for (let k = 0; k < 400; k++) {
    const r = await page.evaluate(() => {
      WD_DEBUG.step(1);
      const s = WD_DEBUG.state();
      return { playing: s.playing, over: s.over, ys: s.enemies.map((e) => e.y) };
    });
    r.ys.forEach((y) => (y < 250 ? routes.add("north") : y > 350 ? routes.add("south") : 0));
    if (!r.playing) break;
  }
  st = await S(page);
  if (st.wave !== w || st.playing) waveOk = false;
  if (st.over) break;
}
st = await S(page);
check("20ウェーブを最後まで進行できる", waveOk && st.wave === 20 && st.over, `wave=${st.wave} hp=${st.hp}`);
check("勝利メッセージ", (await page.textContent("#msg")).includes("20ウェーブクリア"));
check("上下の分岐ルートの両方を敵が通る", routes.has("north") && routes.has("south"));
check("回帰テスト中エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ モバイル表示");
({ page, errors } = await newPage());
await page.tap('[data-t="arrow"]');
await tapMap(page, ...A);
await tapMap(page, ...A);
await page.tap("#assign");
await page.tap('[data-assign="kanbei"]');
const layout = await page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null;
  const btns = [...document.querySelectorAll("#towerPanel button, .tools button")].filter(vis);
  const texts = [...document.querySelectorAll("#towerPanel, #towerPanel *")].filter(vis);
  const panel = document.getElementById("towerPanel").getBoundingClientRect(),
    canvas = document.getElementById("game").getBoundingClientRect();
  return {
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minBtnH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    minPanelFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))),
    overlap: panel.top < canvas.bottom - 1,
  };
});
check("横スクロールが出ない (390px)", !layout.hScroll);
check("ボタンの高さ 44px 以上", layout.minBtnH >= 44, String(layout.minBtnH));
check("塔パネルの文字 14px 以上", layout.minPanelFont >= 14, String(layout.minPanelFont));
check("塔パネルがマップに重ならない", !layout.overlap);
await page.tap("#assign");
const sheet = await page.evaluate(() => {
  const r = document.querySelector("#heroSheet .sheet").getBoundingClientRect();
  return {
    h: r.height / innerHeight,
    minBtn: Math.min(
      ...[...document.querySelectorAll("#heroSheet .sheet button")].map(
        (b) => b.getBoundingClientRect().height,
      ),
    ),
  };
});
check("配属画面は画面の72%以下", sheet.h <= 0.73, sheet.h.toFixed(2));
check("配属画面のボタン 44px 以上", sheet.minBtn >= 44, String(sheet.minBtn));
if (shots) await page.screenshot({ path: path.join(shots, "4-sheet.png") });
await page.tap("#heroSheet", { position: { x: 20, y: 20 } });
check("背景タップで配属画面を閉じる", !(await page.isVisible("#heroSheet")));
check("モバイル表示でエラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
