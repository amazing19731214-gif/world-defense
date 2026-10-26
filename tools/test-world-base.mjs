#!/usr/bin/env node
// 世界の章（地域）の土台：今は「日本」だけ。海外の章を足すときに守る決まり（IDが重ならない・つながりが両向き・
// すべての国に行ける・城と地方がそろっている）と、天下統一は日本の68か国のまま・反撃は同じ章の中だけ
//   node tools/test-world-base.mjs
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
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const api = "Object.values(WD_DEBUG).find((v) => v && v.CHAPTERS && v.PROVINCES)";

console.log("■ 章の表");
let r = await page.evaluate((api) => {
  const c = eval(api);
  return {
    order: c.CHAPTER_ORDER,
    japan: c.JAPAN.length,
    all: c.PROVINCE_ORDER.length,
    chapters: [...new Set(c.PROVINCE_ORDER.map((p) => c.PROVINCES[p].chapter))],
  };
}, api);
check(
  "今は「日本」の章だけ・日本は68か国",
  r.order.join() === "japan" && r.japan === 68 && r.all === 68 && r.chapters.join() === "japan",
  JSON.stringify(r),
);

console.log("■ 海外の章を足すときに守る決まり（すべての章で確かめる）");
r = await page.evaluate((api) => {
  const c = eval(api),
    P = c.PROVINCES,
    ids = c.PROVINCE_ORDER,
    out = { dupProv: [], dupCastle: [], asym: [], unreach: [], noCastle: [], badRoad: [], dupRoad: [] };
  const seen = new Set(),
    castles = new Set(),
    roads = new Map();
  for (const cid of c.CHAPTER_ORDER)
    for (const r of Object.keys(c.CHAPTERS[cid].roads)) {
      if (roads.has(r)) out.dupRoad.push(r);
      roads.set(r, cid);
    }
  for (const p of ids) {
    if (seen.has(p)) out.dupProv.push(p);
    seen.add(p);
    const x = P[p];
    if (x.castle) {
      if (castles.has(x.castle)) out.dupCastle.push(x.castle);
      castles.add(x.castle);
      if (!c.NPC_CASTLES[x.castle]) out.noCastle.push(p);
    }
    for (const a of x.adj) if (!P[a] || !P[a].adj.includes(p)) out.asym.push(p + "-" + a);
    if (roads.get(x.road) !== x.chapter) out.badRoad.push(p);
    if (!Number.isFinite(x.dist)) out.unreach.push(p);
  }
  return out;
}, api);
check(
  "国ID・城ID・地方IDが重ならない",
  !r.dupProv.length && !r.dupCastle.length && !r.dupRoad.length,
  JSON.stringify(r),
);
check("国のつながりは両向き", !r.asym.length, JSON.stringify(r.asym));
check("三河からすべての国へ行ける（陸か航路で）", !r.unreach.length, JSON.stringify(r.unreach));
check(
  "自国以外のすべての国に城がある・地方はその章のもの",
  !r.noCastle.length && !r.badRoad.length,
  JSON.stringify(r),
);

console.log("■ 今までと同じ");
r = await page.evaluate((api) => {
  const c = eval(api);
  return {
    tenka: c.isTenka(),
    first: c.PROVINCE_ORDER.slice(0, 7).join(),
    kiyosu: c.NPC_CASTLES.kiyosu.power,
    tsushima: c.NPC_CASTLES[c.PROVINCES.tsushima.castle].power,
  };
}, api);
check(
  "最初の7か国の並び・清洲城の強さ（1）は今までどおり",
  r.first === "mikawa,owari,totomi,mino,suruga,shinano,kai" && r.kiyosu === 1,
  JSON.stringify(r),
);
check("天下統一の判定は日本の国で（まだ取っていない）", r.tenka === false, JSON.stringify(r));
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
