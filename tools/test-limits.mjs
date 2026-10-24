#!/usr/bin/env node
// 部隊の保有上限（待機中の部隊がいっぱいのとき）・画面上部の案内・解散の動作確認
//   node tools/test-limits.mjs
//   SCREENSHOTS=dir node tools/test-limits.mjs … 画面写真も保存
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
// 何度も遊んで、待機中の部隊が上限（8部隊）まで貯まった保存データ
const save = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
for (let q = 1; q <= 8; q++) {
  const type = q <= 6 ? "ashigaru" : "spearman";
  save.squads.push({ id: q, type });
  for (let k = 0; k < 5; k++) {
    const id = (q - 1) * 5 + k + 1;
    save.soldiers.push({ id, type, squadId: q, level: id === 36 ? 12 : 2, name: id === 36 ? "権六" : null });
  }
}
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript((v) => {
  if (sessionStorage.getItem("seeded")) return;
  sessionStorage.setItem("seeded", "1");
  localStorage.setItem("worldDefense.soldiers.v1", v);
  localStorage.setItem(
    "worldDefense.siege.v1",
    JSON.stringify({ version: 1, units: [{ soldiers: [36, 1], hero: null }] }),
  );
}, JSON.stringify(save));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let confirmText = "";
page.on("dialog", (d) => {
  confirmText = d.message();
  d.accept();
});
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const ev = (fn, arg) => page.evaluate(fn, arg);
async function tapMap(x, y) {
  const p = await ev(
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
const counts = () =>
  ev(() => {
    const s = WD_DEBUG.state();
    return { all: s.squads.length, out: s.squads.filter((q) => q.state === "deployed").length };
  });

console.log("■ 保有数の表示");
let text = await page.textContent("#unitCount");
check("配置中の部隊数と保有数（待機中を含む）を表示", /配置 0\/4/.test(text) && /保有 8\/8/.test(text), text);

console.log("■ 上限のときに道をタップ");
await page.tap('[data-u="medic"]');
await tapMap(650, 300);
let r = await counts();
const toast = await ev(() => {
  const el = document.getElementById("toast"),
    b = el.getBoundingClientRect();
  return { shown: !el.hidden, text: el.textContent, top: b.top, bottom: b.bottom };
});
check("待機中に同じ兵種が無ければ雇えない（部隊は増えない）", r.all === 8 && r.out === 0);
check(
  "置けない理由を画面の上に表示（スクロールしなくても見える）",
  toast.shown &&
    /8 部隊まで/.test(toast.text) &&
    /解散/.test(toast.text) &&
    toast.top >= 0 &&
    toast.bottom < 200,
  JSON.stringify(toast),
);
if (shots) await page.screenshot({ path: path.join(shots, "l1-toast.png") });
await page.tap('[data-u="ashigaru"]');
await tapMap(650, 300);
r = await counts();
check(
  "同じ兵種の待機中の部隊があれば、その部隊をタップした場所に配置",
  r.all === 8 && r.out === 1,
  JSON.stringify(r),
);
check("配置したことも上に表示", /を配置した/.test(await page.textContent("#toast")));
check("ゴールドは減らない（雇用ではなく配置）", (await ev(() => WD_DEBUG.state().gold)) === 500);
text = await page.textContent("#unitCount");
check("表示が「配置 1/4・保有 8/8」になる", /配置 1\/4/.test(text) && /保有 8\/8/.test(text), text);

console.log("■ 解散");
await page.tap("#organize");
const disbandBtns = await page.$$eval("[data-disband]", (bs) => bs.map((b) => +b.dataset.disband));
check(
  "待機中の部隊にだけ「解散」ボタン（配置中の部隊には出ない）",
  disbandBtns.length === 7,
  disbandBtns.join(),
);
await page.tap('[data-disband="8"]');
check(
  "解散の前に確認（名前付きの兵士の名前も表示）",
  /槍兵隊 #8/.test(confirmText) && /権六/.test(confirmText),
  confirmText,
);
r = await ev(() => {
  const s = WD_DEBUG.state(),
    sv = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")),
    sg = JSON.parse(localStorage.getItem("worldDefense.siege.v1"));
  return {
    squads: s.squads.length,
    soldiers: s.soldiers.filter((x) => x.squadId === 8).length,
    saved: sv.soldiers.filter((v) => v.squadId === 8).length,
    savedSquad: sv.squads.some((q) => q.id === 8),
    fallen: sv.fallen.length,
    siege: sg.units[0].soldiers,
  };
});
check(
  "解散すると部隊と兵士が消え、保存データからも外れる",
  r.squads === 7 && r.soldiers === 0 && r.saved === 0 && !r.savedSquad,
  JSON.stringify(r),
);
check("解散は戦死ではない（英霊名鑑に載らない）", r.fallen === 0);
check("攻城編成からも外れる", r.siege.join() === "1", r.siege.join());
await page.tap("#squadClose");
await page.tap('[data-u="medic"]');
await tapMap(740, 300);
r = await counts();
check("枠が空けば新しい部隊を雇える", r.all === 8 && r.out === 2, JSON.stringify(r));
r = await ev(() => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  const deployed = a.disbandSquad(s.squads.find((q) => q.state === "deployed"));
  document.getElementById("start").click();
  const during = a.disbandSquad(s.squads.find((q) => q.state === "reserve"));
  return { deployed, during };
});
check(
  "道に出ている部隊・ウェーブ中は解散できない",
  /撤退/.test(r.deployed) && /ウェーブ中/.test(r.during),
  JSON.stringify(r),
);
const lay = await ev(() => document.documentElement.scrollWidth > innerWidth);
check("390px で横スクロールなし", !lay);
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
