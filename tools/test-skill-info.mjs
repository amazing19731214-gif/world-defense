#!/usr/bin/env node
// 兵士名簿のスキルの札を押すと、そのスキルの説明（分類・効果・習得のしかた）を開く
//   node tools/test-skill-info.mjs
//   SCREENSHOTS=dir node tools/test-skill-info.mjs … 画面写真も保存
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
const skills = ["preciseShot", "volley", "pierceShot", "shingan"]; // 通常・固有・職業（鉄砲兵）・秘伝
const save = {
  version: 1,
  seq: 2,
  squadSeq: 1,
  squads: [{ id: 1, type: "gunner", slot: 0 }],
  soldiers: [
    { id: 1, type: "gunner", squadId: 1, level: 40, skills, learned: skills },
    { id: 2, type: "gunner", squadId: 1, level: 12, skills: ["longShot"], learned: ["longShot"] },
  ],
  fallen: [],
};
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
const infos = () =>
  page.evaluate(() => [...document.querySelectorAll("#soldierList .skill-info")].map((e) => e.textContent));

console.log("■ スキルの札を押して説明を出す");
await page.tap("#soldiers");
let r = await page.evaluate(() => ({
  tags: [...document.querySelectorAll("#soldierList [data-skill-info]")].map((b) => b.dataset.skillInfo),
  info: document.querySelectorAll("#soldierList .skill-info").length,
}));
check(
  "スキルの札は押せるボタン（5つ）・最初は説明を出さない",
  r.tags.length === 5 && r.info === 0,
  JSON.stringify(r),
);
await page.tap('#soldierList [data-skill-info="preciseShot"]');
let t = await infos();
check(
  "通常のスキル：名前・分類・効果・習得のしかた",
  t.length === 1 &&
    /「精密射撃」/.test(t[0]) &&
    /兵士のスキル/.test(t[0]) &&
    /攻撃力 \+15%/.test(t[0]) &&
    /レベルアップで習得（鉄砲兵）/.test(t[0]),
  JSON.stringify(t),
);
check(
  "押した札を目立たせる",
  (await page.getAttribute('#soldierList [data-skill-info="preciseShot"]', "aria-expanded")) === "true",
);
if (shots) await page.screenshot({ path: path.join(shots, "i1-info.png") });
await page.tap('#soldierList [data-skill-info="volley"]');
t = await infos();
check(
  "別の札を押すと切り替え（固有スキル：Lv30〜）",
  t.length === 1 && /「三段撃ち」/.test(t[0]) && /固有スキル（Lv30〜）/.test(t[0]),
  JSON.stringify(t),
);
check(
  "前の札の選択は外れる",
  (await page.getAttribute('#soldierList [data-skill-info="preciseShot"]', "aria-expanded")) === "false",
);
await page.tap('#soldierList [data-skill-info="pierceShot"]');
t = await infos();
check(
  "職業スキル：職業と熟練度",
  /職業スキル（鉄砲兵）/.test(t[0]) && /熟練度 3 で習得/.test(t[0]),
  JSON.stringify(t),
);
await page.tap('#soldierList [data-skill-info="shingan"]');
t = await infos();
check(
  "秘伝スキル：スキルの書",
  /秘伝スキル（並の書）/.test(t[0]) && /スキルの書/.test(t[0]),
  JSON.stringify(t),
);
await page.tap('#soldierList [data-skill-info="longShot"]');
t = await infos();
check(
  "ほかの兵士の札は、その兵士の下に別に出す",
  t.length === 2 && t.some((x) => /「遠矢」/.test(x)),
  JSON.stringify(t),
);
await page.tap('#soldierList [data-skill-info="shingan"]');
t = await infos();
check("同じ札をもう一度押すと閉じる", t.length === 1 && /「遠矢」/.test(t[0]), JSON.stringify(t));
r = await page.evaluate(() => {
  const bs = [...document.querySelectorAll("#soldierList [data-skill-info]")].map((b) =>
    b.getBoundingClientRect(),
  );
  return {
    minH: Math.min(...bs.map((b) => b.height)),
    fit: bs.every((b) => b.right <= innerWidth + 0.5),
    hScroll: document.documentElement.scrollWidth > innerWidth,
    open: !document.getElementById("soldierSheet").hidden,
  };
});
check(
  "375×667：札は押しやすい高さ（32px以上）・横にはみ出さない・名簿は開いたまま",
  r.minH >= 32 && r.fit && !r.hScroll && r.open,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
