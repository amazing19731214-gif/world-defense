#!/usr/bin/env node
// 戦国の防衛塔（弓・大砲・鉄砲・水攻め）の動作確認（Playwright / Chromium・iPhone幅390px・タッチ操作）
//   node tools/test-towers.mjs
//   SCREENSHOTS=dir node tools/test-towers.mjs … 画面写真も保存
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
async function newPage(seeds = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript((seeds) => {
    if (sessionStorage.getItem("seeded")) return;
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
    sessionStorage.setItem("seeded", "1");
  }, seeds);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.waitForTimeout(200);
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
const visibleText = (page) => page.evaluate(() => document.body.innerText);
const allText = (page) =>
  page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("script").forEach((s) => s.remove());
    return clone.textContent;
  });

// 以前の版の保存データ（武将の所持・旧形式の武将データ）がある状態で起動
let { page, errors, context } = await newPage({
  "worldDefense.warlords.v1": JSON.stringify({ owned: { nobunaga: 1, kanbei: 1 }, tickets: 2, history: [] }),
  "worldDefense.heroes.v1": JSON.stringify({
    version: 1,
    owned: ["archer", "gunner", "strategist"],
    lastHero: "archer",
  }),
});

console.log("■ 塔の名称・価格");
const btns = await page.$$eval("[data-t]", (bs) =>
  bs.map((b) => [b.dataset.t, b.innerText.replace(/\s+/g, " ").trim()]),
);
check(
  "塔は4種類：弓100G・大砲180G・鉄砲220G・水攻め150G",
  JSON.stringify(btns) ===
    JSON.stringify([
      ["arrow", "弓 100G"],
      ["cannon", "大砲 180G"],
      ["magic", "鉄砲 220G"],
      ["ice", "水攻め 150G"],
    ]),
  JSON.stringify(btns),
);
await page.evaluate(() => WD_DEBUG.setGold(5000));
let text = await allText(page);
check("画面（隠れている画面も含む）に「魔法」「氷」が残っていない", !/魔法|氷|🔮|❄/.test(text));

console.log("■ ボタンの配置（iPhone縦 390px）");
const lay = await page.evaluate(() => {
  const bs = [...document.querySelectorAll("[data-t]")];
  return bs.map((b) => {
    const r = b.getBoundingClientRect(),
      img = b.querySelector("img").getBoundingClientRect(),
      t = b.querySelector(".t-text").getBoundingClientRect();
    return {
      top: Math.round(r.top),
      h: Math.round(r.height),
      overflow: b.scrollWidth > b.clientWidth + 1,
      imgOk: b.querySelector("img").naturalWidth > 0,
      imgMid: img.top + img.height / 2 - (r.top + r.height / 2),
      textMid: t.top + t.height / 2 - (r.top + r.height / 2),
      contentMid: (Math.min(img.left, t.left) + Math.max(img.right, t.right)) / 2 - (r.left + r.width / 2),
      lines: Math.round(t.height / parseFloat(getComputedStyle(b.querySelector(".t-text")).lineHeight)),
      font: parseFloat(getComputedStyle(b.querySelector(".t-text")).fontSize),
    };
  });
});
check(
  "4つのボタンが同じ行・同じ高さ",
  new Set(lay.map((l) => l.top)).size === 1 && new Set(lay.map((l) => l.h)).size === 1,
  JSON.stringify(lay),
);
check(
  "ボタンの高さ 44px 以上",
  lay.every((l) => l.h >= 44),
);
check(
  "文字やアイコンがはみ出さない",
  lay.every((l) => !l.overflow),
);
check(
  "アイコンと文字が縦方向の中央",
  lay.every((l) => Math.abs(l.imgMid) <= 2 && Math.abs(l.textMid) <= 2),
  JSON.stringify(lay),
);
check(
  "アイコンと文字のまとまりが横方向の中央",
  lay.every((l) => Math.abs(l.contentMid) <= 2),
  JSON.stringify(lay.map((l) => l.contentMid)),
);
check(
  "名前と価格は2行（折り返しでずれない）",
  lay.every((l) => l.lines === 2),
  JSON.stringify(lay.map((l) => l.lines)),
);
check(
  "ボタンに塔の画像",
  lay.every((l) => l.imgOk),
);
check(
  "文字 14px 以上",
  lay.every((l) => l.font >= 14),
);
check("横スクロールが出ない", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

console.log("■ 建設・パネル・ゲームバランス");
await page.tap('[data-t="magic"]');
check("鉄砲を選択したメッセージ", /💥 を選択/.test(await page.textContent("#msg")));
await tapMap(page, 330, 300);
await page.tap('[data-t="ice"]');
await tapMap(page, 420, 300);
let st = await page.evaluate(() => {
  const s = WD_DEBUG.state();
  return { gold: s.gold, towers: s.towers.map((t) => ({ type: t.type, ...WD_DEBUG.towerStats(t) })) };
});
check("鉄砲220G・水攻め150Gで建設", st.towers.length === 2 && st.gold === 5000 - 220 - 150);
const gun = st.towers[0],
  water = st.towers[1];
check(
  "鉄砲の能力は以前の魔法と同じ（攻撃32・射程170・間隔0.8秒）",
  gun.damage === 32 && gun.range === 170 && near(gun.rate, 0.8),
);
check(
  "水攻めの能力は以前の氷と同じ（攻撃9・射程145・間隔0.95秒）",
  water.damage === 9 && water.range === 145 && near(water.rate, 0.95),
);
await tapMap(page, 330, 300);
check("塔パネルの名称「鉄砲の塔」", /鉄砲の塔/.test(await page.textContent("#tpTitle")));
await page.tap("#tpClose");
await tapMap(page, 420, 300);
check("塔パネルの名称「水攻めの塔」", /水攻めの塔/.test(await page.textContent("#tpTitle")));
await page.tap("#tpClose");

console.log("■ 攻撃と演出");
await page.evaluate(() => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  // 上の道の、両方の塔の射程に入る位置
  WD_DEBUG.addEnemy({ kind: "goblin", d: 390, hp: 1e6, speed: 60 });
});
const fx = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    e = s.enemies[1],
    seen = {};
  const d0 = e.d;
  for (let i = 0; i < 40; i++) {
    WD_DEBUG.step(0.05);
  }
  return { ...seen, slow: e.slow, hpLost: 1e6 - e.hp, moved: e.d - d0 };
});
check("鉄砲・水攻めが敵を攻撃する", fx.hpLost > 32 + 9, String(fx.hpLost));
check("水攻めで敵が減速する（効果は維持）", fx.slow > 0 && fx.moved < 60 * 2 * 0.75, JSON.stringify(fx));
if (shots) {
  await page.evaluate(() => WD_DEBUG.step(0.15));
  await page.screenshot({ path: path.join(shots, "t1-battle.png"), fullPage: true });
}
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 以前の保存データ");
const save = await page.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.warlords.v1")));
check("以前の武将所持データをそのまま読み込める", save.owned.nobunaga === 1 && save.owned.kanbei === 1);
check(
  "塔の種類の内部ID（magic / ice）は互換のため変更なし",
  btns.map((b) => b[0]).join() === "arrow,cannon,magic,ice",
);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
