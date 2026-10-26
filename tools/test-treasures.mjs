#!/usr/bin/env node
// 三種の神器：八玉を8種類1つずつ使って1つ作る（草薙の剣・八咫鏡・八尺瓊勾玉）。ずっと持つ宝物（1つずつ・保存）・画面
//   node tools/test-treasures.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(root, "index.html")));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = "http://127.0.0.1:" + server.address().port + "/index.html?debug";

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
const all = (n) => ({ jin: n, gi: n, rei: n, chi: n, chu: n, shin: n, ko: n, tei: n });
const forge = { version: 1, owned: {}, tickets: 0, history: [], forge: { items: [], seq: 0, gems: all(2) } };
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript((b) => {
  if (location.protocol !== "http:" || window.name === "seeded") return;
  window.name = "seeded";
  localStorage.clear();
  localStorage.setItem("worldDefense.warlords.v1", b);
}, JSON.stringify(forge));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const ev = (fn, arg) => page.evaluate(fn, arg);

console.log("■ 三種の神器を作る");
let r = await ev(() => {
  const G = WD_DEBUG.gemApi;
  return {
    names: Object.values(G.TREASURES)
      .map((t) => t.name)
      .join(),
    have: G.treasures(),
  };
});
check(
  "草薙の剣・八咫鏡・八尺瓊勾玉・以前の保存データは0個から",
  r.names === "草薙の剣,八咫鏡,八尺瓊勾玉" && JSON.stringify(r.have) === "{}",
  JSON.stringify(r),
);
r = await ev(() => {
  const G = WD_DEBUG.gemApi;
  const e1 = G.craftTreasure("kusanagi");
  const gems = WD_DEBUG.intruderApi.gems();
  const e2 = G.craftTreasure("kusanagi");
  const e3 = G.craftTreasure("yata");
  const e4 = G.craftTreasure("magatama"); // 八玉が足りない
  return {
    e1,
    gems,
    e2,
    e3,
    e4,
    have: G.treasures(),
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge,
  };
});
check(
  "八玉を8種類1つずつ使って作れる",
  r.e1 === null &&
    JSON.stringify(r.gems) ===
      JSON.stringify({ jin: 1, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 }),
  JSON.stringify(r),
);
check(
  "同じ神器は1つだけ（2つ目は作れない・八玉は減らない）",
  /もう持っています/.test(r.e2 || "") && r.e3 === null,
  JSON.stringify(r),
);
check("八玉が足りなければ作れない", /そろっていません（0\/8）/.test(r.e4 || ""), r.e4);
check(
  "作った神器と残りの八玉は保存される",
  JSON.stringify(r.saved.treasures) === '{"kusanagi":true,"yata":true}' &&
    JSON.stringify(r.saved.gems) === "{}",
  JSON.stringify(r.saved),
);
await page.reload();
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(() => WD_DEBUG.gemApi.treasures());
check(
  "読み込み直してもずっと持っている",
  JSON.stringify(r) === '{"kusanagi":true,"yata":true}',
  JSON.stringify(r),
);

console.log("■ 画面（375×667）");
await ev(() => WD_DEBUG.gemApi.setGems({ jin: 1, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 }));
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="gems"]');
let text = await page.textContent("#gearBody");
r = await ev(() => ({
  btn: [...document.querySelectorAll("[data-treasure-craft]")].map((b) => b.dataset.treasureCraft),
  h: document.documentElement.scrollWidth > innerWidth,
}));
check(
  "📿 八玉タブに「三種の神器 2/3」・作ったものは「所持」・残り1つに「作る」",
  /三種の神器 2\/3/.test(text) && r.btn.join() === "magatama" && !r.h,
  JSON.stringify(r),
);
await page.tap('[data-treasure-craft="magatama"]');
text = await page.textContent("#gearBody");
check(
  "画面から作れる・3つそろうと知らせる",
  /三種の神器 3\/3/.test(text) && /三種の神器がそろった/.test(text),
  text.slice(0, 200),
);
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
