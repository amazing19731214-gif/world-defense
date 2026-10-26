#!/usr/bin/env node
// 小判の商店：能力の実（攻撃・防御・体力・射程。1個5,000両・使うとその兵士の能力がずっと +1（最大HPは +10））と、書の売却
// （スキルの書150両・伝承の秘伝書500両・🌟超秘伝書3,000両・装備中は売れない）・保存（失敗したら取り消す）・画面
//   node tools/test-shop.mjs
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// file:// で開くと、読み込み直しのときにまれに保存データ（localStorage）が全部見えなくなることがあった（テストのブラウザだけ）。
// 公開版と同じく http で開く（小さなサーバーで index.html を返す）
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
const SKEY = "worldDefense.soldiers.v1",
  WKEY = "worldDefense.warlords.v1";
const save = {
  version: 1,
  seq: 20,
  squadSeq: 1,
  squads: [{ id: 1, type: "archer", slot: 0 }],
  soldiers: [],
  fallen: [],
};
for (let k = 0; k < 10; k++)
  save.soldiers.push({ id: k + 1, type: "archer", squadId: 1, level: 40, skills: [], learned: [] });
const forge = {
  version: 1,
  owned: {},
  tickets: 0,
  history: [],
  forge: {
    items: [],
    seq: 0,
    koban: 22000,
    books: { shingan: 2 },
    legendBooks: [
      { uid: 1, type: "stat", k: "atkFlat", v: 2, from: "騎兵 #200" },
      { uid: 2, type: "abil", k: "beam", v: 0.86, from: "騎兵 #200", super: true },
      { uid: 3, type: "stat", k: "hpPct", v: 7, from: "老兵", owner: 2 },
    ],
    lseq: 3,
  },
};
// 保存データは最初の読み込みの前に入れる
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(
  ([a, b, c, d]) => {
    // 最初の読み込みのときだけ入れる（印は読み込み直しでも残る window.name に置く）
    if (location.protocol !== "http:" || window.name === "seeded") return; // 最初の about:blank では何もしない
    window.name = "seeded";
    localStorage.clear();
    localStorage.setItem(a, b);
    localStorage.setItem(c, d);
  },
  [SKEY, JSON.stringify(save), WKEY, JSON.stringify(forge)],
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
// 読み込み直しは同じページの reload で（別の URL へ移ると、まれに直前の保存が見えないことがあった）
const reload = async () => {
  await page.reload();
  await page.waitForFunction(() => window.WD_DEBUG);
};
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const ev = (fn, arg) => page.evaluate(fn, arg);
const failSave = (on) =>
  ev((on) => {
    if (on) {
      window.__set = window.__set || Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith("worldDefense.")) throw new Error("QuotaExceededError");
        return window.__set.call(this, k, v);
      };
    } else if (window.__set) Storage.prototype.setItem = window.__set;
  }, on);

console.log("■ 能力の実を買う");
let r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi;
  const e = [L.buyFruit("atk"), L.buyFruit("hp"), L.buyFruit("def"), L.buyFruit("rng")];
  return {
    price: L.SHOP.fruitPrice,
    e,
    koban: F.koban(),
    stock: F.save().fruits,
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge.fruits,
  };
});
check("1個5,000両", r.price === 5000);
check(
  "小判で買える（22,000 → 4個で2,000両）・倉庫に入る・保存される",
  r.e.every((e) => e === null) &&
    r.koban === 2000 &&
    JSON.stringify(r.stock) === '{"atk":1,"hp":1,"def":1,"rng":1}' &&
    JSON.stringify(r.saved) === JSON.stringify(r.stock),
  JSON.stringify(r),
);
r = await ev(() => WD_DEBUG.legendApi.buyFruit("atk"));
check("小判が足りなければ買えない", /小判が足りません/.test(r || ""), r);

console.log("■ 能力の実を使う");
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 1),
    before = a.soldierStats(s);
  const e = ["atk", "def", "hp", "rng"].map((k) => L.useFruit(s, k));
  const after = a.soldierStats(s);
  return {
    e,
    atk: after.atk - before.atk,
    def: after.def - before.def,
    hp: after.maxHp - before.maxHp,
    range: after.range - before.range,
    fruit: s.fruit,
    stock: WD_DEBUG.forgeApi.save().fruits,
    again: L.useFruit(s, "atk"),
  };
});
check(
  "4種類とも使える",
  r.e.every((e) => e === null),
  JSON.stringify(r.e),
);
check(
  "その兵士の攻撃・防御・射程は +1、最大HPは +10",
  Math.abs(r.atk - 1) < 1e-6 && Math.abs(r.def - 1) < 1e-6 && r.hp === 10 && Math.abs(r.range - 1) < 1e-6,
  JSON.stringify(r),
);
check(
  "使った実はなくなる・持っていなければ使えない",
  JSON.stringify(r.stock) === "{}" && /持っていません/.test(r.again || ""),
  JSON.stringify(r),
);
await reload();
r = await ev(() => ({
  fruit: WD_DEBUG.state().soldiers.find((x) => x.id === 1).fruit,
  saved: JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.find((x) => x.id === 1).fruit,
  stock: WD_DEBUG.forgeApi.save().fruits,
}));
check(
  "再読み込みしても、食べた実は残る（実はなくなったまま）",
  JSON.stringify(r.fruit) === '{"atk":1,"def":1,"hp":1,"rng":1}' &&
    JSON.stringify(r.saved) === JSON.stringify(r.fruit) &&
    JSON.stringify(r.stock) === "{}",
  JSON.stringify(r),
);

console.log("■ 書を売る");
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi,
    k0 = F.koban();
  const e1 = L.sellBook("legend", 1); // 攻撃 +2 の書：500両
  const k1 = F.koban();
  const e2 = L.sellBook("legend", 2); // 超秘伝書：3,000両
  const k2 = F.koban();
  const e3 = L.sellBook("skill", "shingan"); // スキルの書：150両
  const k3 = F.koban();
  const e4 = L.sellBook("legend", 3); // 装備中は売れない
  const e5 = L.sellBook("legend", 1); // もうない
  return {
    d: [k1 - k0, k2 - k1, k3 - k2],
    e: [e1, e2, e3],
    e4,
    e5,
    books: F.save().legendBooks.map((b) => b.uid),
    skill: F.save().books.shingan,
  };
});
check(
  "伝承の秘伝書は500両・🌟超秘伝書は3,000両・スキルの書は150両",
  r.d.join() === "500,3000,150" && r.e.every((e) => e === null),
  JSON.stringify(r),
);
check(
  "装備中の書は売れない・売った書はもうない",
  /装備中/.test(r.e4 || "") && /ありません/.test(r.e5 || "") && r.books.join() === "3",
  JSON.stringify(r),
);
check("スキルの書は1冊ずつ売れる（2冊 → 1冊）", r.skill === 1, String(r.skill));

console.log("■ 保存に失敗したとき");
await ev(() => WD_DEBUG.forgeApi.save().koban);
await failSave(true);
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi,
    k0 = F.koban();
  const buy = L.buyFruit("atk");
  const sell = L.sellBook("skill", "shingan");
  return { buy, sell, koban: F.koban() - k0, stock: F.save().fruits.atk || 0, skill: F.save().books.shingan };
});
check(
  "保存できなければ、買わない・売らない（小判も品も元のまま）",
  /保存できなかった/.test(r.buy || "") &&
    /保存できなかった/.test(r.sell || "") &&
    r.koban === 0 &&
    r.stock === 0 &&
    r.skill === 1,
  JSON.stringify(r),
);
await failSave(false);
r = await ev(() => WD_DEBUG.legendApi.buyFruit("atk"));
await failSave(true);
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 3);
  const e = L.useFruit(s, "atk");
  return { e, fruit: s.fruit || null, stock: WD_DEBUG.forgeApi.save().fruits.atk };
});
check(
  "保存できなければ、実を使わない（兵士は変わらず、実は残る）",
  /保存できなかった/.test(r.e || "") && !r.fruit && r.stock === 1,
  JSON.stringify(r),
);
await failSave(false);

console.log("■ 画面（375×667）");
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="shop"]');
let text = await page.textContent("#gearBody");
check(
  "🏪 商店に4種類の実・値段・持っている数・書の売値",
  /攻撃の実/.test(text) &&
    /防御の実/.test(text) &&
    /体力の実/.test(text) &&
    /射程の実/.test(text) &&
    /5,000両/.test(text) &&
    /書の売値/.test(text),
  text.slice(0, 300),
);
await page.tap('[data-fruit-pick="atk"]');
await page.tap('[data-fruit-to="atk"][data-to="4"]');
r = await ev(() => ({
  fruit: WD_DEBUG.state().soldiers.find((x) => x.id === 4).fruit,
  note: document.querySelector("#gearBody .saved").textContent,
  h: document.documentElement.scrollWidth > innerWidth,
}));
check(
  "画面から兵士に使える",
  r.fruit && r.fruit.atk === 1 && /攻撃の実を食べた/.test(r.note) && !r.h,
  JSON.stringify(r),
);
await page.tap('[data-gear-tab="books"]');
const k0 = await ev(() => WD_DEBUG.forgeApi.koban());
await page.tap('[data-book-sell="shingan"]');
r = await ev(() => ({
  k: WD_DEBUG.forgeApi.koban(),
  note: document.querySelector("#gearBody .saved").textContent,
  off: document.querySelectorAll("[data-lbook-sell]").length,
}));
check(
  "📜 スキルの書から売れる（確認のあと +150両）・装備中の書には売るボタンを出さない",
  r.k - k0 === 150 && /売りました/.test(r.note) && r.off === 0,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
