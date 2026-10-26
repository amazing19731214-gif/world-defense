#!/usr/bin/env node
// 装備倉庫の一覧：同じ装備を1行に「×個数」でまとめる・行を開いて操作（装備・ロック・1個売却・まとめて売却）・
// 売却モードは行ごと・スキルの書の一覧・兵士の装備画面もまとめる・画面
//   node tools/test-gear-stack.mjs
//   SCREENSHOTS=dir node tools/test-gear-stack.mjs … 画面写真も保存
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
// 南蛮胴：倉庫に5個・ロック中1個・装備中1個。当世具足：倉庫に2個。素槍1個
const items = [];
let uid = 0;
for (let k = 0; k < 5; k++) items.push({ uid: ++uid, id: "nanbando", owner: null, lock: false });
items.push({ uid: ++uid, id: "nanbando", owner: null, lock: true }); // 6
items.push({ uid: ++uid, id: "nanbando", owner: 1, lock: false }); // 7
items.push({ uid: ++uid, id: "tosei", owner: null, lock: false }); // 8
items.push({ uid: ++uid, id: "tosei", owner: null, lock: false }); // 9
items.push({ uid: ++uid, id: "suyari", owner: null, lock: false }); // 10
const warlords = {
  version: 1,
  owned: {},
  tickets: 0,
  history: [],
  forge: { items, seq: uid, shards: 0, books: { goriki: 3, mikiri: 1 }, koban: 0 },
};
const soldiers = {
  version: 1,
  seq: 3,
  squadSeq: 1,
  squads: [{ id: 1, type: "ashigaru", slot: 0 }],
  soldiers: [],
};
for (let k = 1; k <= 3; k++)
  soldiers.soldiers.push({ id: k, type: "ashigaru", squadId: 1, level: 5, skills: [] });
soldiers.fallen = [];

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
  ([SKEY, WKEY, s, w]) => {
    localStorage.clear();
    localStorage.setItem(SKEY, JSON.stringify(s));
    localStorage.setItem(WKEY, JSON.stringify(w));
  },
  [SKEY, WKEY, soldiers, warlords],
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#gearBody [data-gear-row]")].map((b) => {
      const c = b.querySelector(".gr-count");
      return b.dataset.gearRow + (c ? c.textContent : "");
    }),
  );
const items_ = () => page.evaluate(() => WD_DEBUG.forgeApi.save().items.map((it) => ({ ...it })));

console.log("■ 同じ装備を1行にまとめる");
await page.tap("#gearOpen");
let r = await rows();
check(
  "南蛮胴×5（倉庫）・ロック中の南蛮胴・装備中の南蛮胴・当世具足×2・素槍が別々の行",
  r.length === 5 &&
    r.includes("s:nanbando×5") &&
    r.includes("s:nanbando:L") &&
    r.includes("u7") &&
    r.includes("s:tosei×2") &&
    r.includes("s:suyari"),
  JSON.stringify(r),
);
let text = await page.textContent("#gearBody");
check("全10個を5行にまとめたと表示", /表示 10 \/ 全 10個（5行にまとめて表示/.test(text), text.slice(0, 260));
check("装備中の行には装備者を表示", /👤/.test(await page.textContent('[data-gear-row="u7"]')));
const lay = await page.evaluate(() => {
  const bs = [...document.querySelectorAll("#gearSheet button, #gearSheet select")].filter(
    (b) => b.getClientRects().length,
  );
  return {
    minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
    fit: bs.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check(
  "375×667：行・ボタンは44px以上・横にはみ出さない",
  lay.minH >= 44 && lay.fit && !lay.hScroll,
  JSON.stringify(lay),
);
if (shots) await page.screenshot({ path: path.join(shots, "s1-list.png") });

console.log("■ 行を開いて操作");
await page.tap('[data-gear-row="s:nanbando"]');
text = await page.textContent(".gear-line.open");
check(
  "行を押すと開く：装備できる職業・倉庫の個数・装備させる（1個）・ロック（5個）・1個売却・まとめて売却",
  /装備できる職業/.test(text) &&
    /倉庫に 5個/.test(text) &&
    /装備させる…（1個）/.test(text) &&
    /ロックする（5個）/.test(text) &&
    /1個売却 500両/.test(text) &&
    /5個まとめて売却 2500両/.test(text),
  text,
);
if (shots) await page.screenshot({ path: path.join(shots, "s2-open.png") });
await page.tap("[data-gear-pick]");
// 南蛮胴を着ていない兵士（#1 は着ている）に装備させる
const to = await page.$$eval("[data-gear-to]", (bs) => +bs.find((b) => b.dataset.to !== "1").dataset.to);
await page.tap(`[data-gear-to][data-to="${to}"]`);
r = await items_();
check(
  "装備させると1個だけが兵士へ（倉庫の南蛮胴は4個に）",
  r.filter((it) => it.id === "nanbando" && it.owner === to).length === 1 &&
    (await rows()).includes("s:nanbando×4"),
  JSON.stringify(await rows()),
);
check(
  "装備した1個の行が開いて、装備者と「外す」を出す",
  (await page.$$(".gear-line.open [data-gear-off]")).length === 1,
);
await page.tap(".gear-line.open [data-gear-off]");
check(
  "外すと倉庫のまとまりに戻る（×5）",
  (await rows()).includes("s:nanbando×5"),
  JSON.stringify(await rows()),
);

await page.tap('[data-gear-row="s:tosei"]');
await page.tap("[data-gear-lock-stack]");
r = await items_();
check(
  "ロックはまとまりごと（当世具足2個ともロック）・ロック中の行として開いたまま",
  r.filter((it) => it.id === "tosei").every((it) => it.lock) &&
    (await rows()).includes("s:tosei:L×2") &&
    (await page.$$('.gear-line.open [data-gear-row="s:tosei:L"]')).length === 1,
  JSON.stringify(await rows()),
);
check("ロック中は売却のボタンを出さない", (await page.$$(".gear-line.open [data-sell-one]")).length === 0);
await page.tap("[data-gear-lock-stack]");

await page.tap('[data-gear-row="s:nanbando"]');
await page.tap("[data-sell-stack-all]");
text = await page.textContent(".sell-confirm");
check(
  "まとめて売却は確認画面（5個・合計2500両・元に戻せない）",
  /5個の装備を売却/.test(text) && /合計 2500両/.test(text) && /元に戻せません/.test(text),
  text,
);
await page.tap("[data-sell-go]");
r = await page.evaluate(() => ({
  n: WD_DEBUG.forgeApi.save().items.filter((it) => it.id === "nanbando").length,
  koban: WD_DEBUG.forgeApi.koban(),
}));
check(
  "5個を売却：南蛮胴はロック中と装備中の2個が残る・小判 +2500",
  r.n === 2 && r.koban === 2500,
  JSON.stringify(r),
);

console.log("■ 売却モードは行ごと");
await page.tap("[data-sell-mode]");
await page.tap('[data-sell-stack="s:tosei"]');
text = await page.textContent(".sell-bar");
check("当世具足の行を選ぶと2個まとめて選択（合計1000両）", /選択 2個・合計 1000両/.test(text), text);
r = await page.evaluate(() => document.querySelector('[data-sell-stack="s:tosei"]').textContent);
check("選ぶボタンに個数と合計", /☑ 選択中 ×2・1000両/.test(r), r);
await page.tap('[data-sell-stack="s:tosei"]');
check("もう一度押すと外す", /選択 0個/.test(await page.textContent(".sell-bar")));
r = await page.evaluate(() =>
  [...document.querySelectorAll("#gearBody .gear-line button[disabled]")].map((b) => b.textContent).join("|"),
);
check("ロック中・装備中の行は選べない（理由）", /ロック/.test(r) && /装備中/.test(r), r);
await page.tap("[data-sell-mode]");

console.log("■ スキルの書の一覧");
await page.tap('[data-gear-tab="books"]');
r = await page.evaluate(() =>
  [...document.querySelectorAll("#gearBody .gear-row")].map(
    (b) =>
      b.querySelector(".gr-name").textContent +
      (b.querySelector(".gr-count") || { textContent: "" }).textContent,
  ),
);
check(
  "書も1行ずつ（剛力の書 ×3・見切りの書）",
  r.length === 2 && r.some((t) => /剛力の書×3/.test(t)) && r.some((t) => /見切りの書$/.test(t)),
  JSON.stringify(r),
);
check("それぞれ「使う…」", (await page.$$("[data-book-pick]")).length === 2);
if (shots) await page.screenshot({ path: path.join(shots, "s3-books.png") });
await page.tap("#gearClose");

console.log("■ 兵士の装備画面もまとめる");
await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi;
  for (let k = 0; k < 3; k++) F.save().items.push({ uid: 100 + k, id: "nanbando", owner: null, lock: false });
  F.persist();
});
await page.tap("#soldiers");
await page.evaluate(() => document.querySelector('[data-gear-open="2"]').click());
r = await page.evaluate(() => {
  const body = document.getElementById("gearBody");
  return {
    rows: [...body.querySelectorAll(".gear-free .gear-row")].map((b) => b.textContent.replace(/\s/g, "")),
    on: body.querySelectorAll(".gear-free [data-gear-on]").length,
  };
});
check(
  "倉庫の鎧：南蛮胴は1行（×4）にまとめ、「装備する」は行ごとに1つ",
  r.rows.some((t) => /南蛮胴.*×4/.test(t)) && r.on === r.rows.length,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
