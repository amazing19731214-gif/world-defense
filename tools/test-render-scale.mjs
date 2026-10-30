// 高精細の描画（v104.4）：表示の大きさ×画素密度で描き（1〜2倍）、拡大でぼやけない。ゲームの座標・タップの位置は変わらない。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const save = { seq: 10, squadSeq: 1, squads: [{ id: 1, type: "spearman", slot: 0 }], soldiers: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, type: "spearman", squadId: 1, level: 200 })), fallen: [] };
async function open({ width, height, dpr, query = "?debug&layout=vertical" }) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: width < 600, hasTouch: width < 600 });
  await c.addInitScript((save) => {
    requestAnimationFrame = () => 0;
    if (location.protocol !== "http:" || sessionStorage.s) return;
    sessionStorage.s = 1;
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
  }, save);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  await p.evaluate(() => WD_DEBUG.setGold(5000));
  return { c, p };
}
const canvas = (p) =>
  p.evaluate(() => {
    const g = document.getElementById("game"),
      b = g.getBoundingClientRect();
    return { w: g.width, h: g.height, cssW: b.width, cssH: b.height, dpr: devicePixelRatio };
  });
// ゲームの座標を画面の座標へ（向きに合わせる）
const at = (p, x, y) =>
  p.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect(),
        v = document.body.classList.contains("vertical-field");
      return v ? { x: r.left + c.clientLeft + (y * c.clientWidth) / 600, y: r.top + c.clientTop + (x * c.clientHeight) / 960 } : { x: r.left + c.clientLeft + (x * c.clientWidth) / 960, y: r.top + c.clientTop + (y * c.clientHeight) / 600 };
    },
    [x, y],
  );
try {
  // iPhone（画素密度3）・防衛戦は横向き
  let { c, p } = await open({ width: 390, height: 664, dpr: 3 });
  let r = await canvas(p);
  const k = r.w / 960;
  check(Math.abs(k - Math.min(2, (3 * r.cssW) / 960)) < 0.01 && k > 1.1, "画素密度3のスマホでは、表示の大きさ×密度で描く（横向き）", r);
  check(Math.abs(r.w / r.h - 1.6) < 0.01, "縦横比は従来どおり", r);
  await p.evaluate(() => {
    document.querySelector('[data-t="arrow"]').click();
  });
  const pt = await at(p, 330, 300);
  await p.touchscreen.tap(pt.x, pt.y);
  r = await p.evaluate(() => WD_DEBUG.state().towers.map((t) => [Math.round(t.x), Math.round(t.y)]));
  check(r.length === 1 && Math.abs(r[0][0] - 330) < 3 && Math.abs(r[0][1] - 300) < 3, "解像度を上げてもタップの位置はゲームの座標どおり", r);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setTarget(A.PROVINCES.owari.castle);
    A.startBattle();
    WD_DEBUG.heroApi.draw();
    for (let i = 0; i < 200; i++) WD_DEBUG.step(0.05);
    WD_DEBUG.heroApi.draw();
    const g = document.getElementById("game"),
      b = g.getBoundingClientRect();
    return { w: g.width, h: g.height, cssW: b.width };
  });
  // 表示の大きさは戦闘バーが出てから決まり、解像度は次の描画で合わせ直す（試験では描画の繰り返しを止めているので範囲で確認）
  check(r.w / 600 > 1.3 && r.w / 600 <= 2 && Math.abs(r.w / r.h - 0.625) < 0.01, "攻城戦の縦向きも高精細で描く", r);
  // 描いた絵の位置が座標どおり：城の耐久の棒（赤）が城の上に出ている
  const px = await p.evaluate(() => {
    const g = document.getElementById("game"),
      k = g.width / 600,
      c = WD_DEBUG.squadApi.SIEGE_BATTLE.castle, // 縦向きでは城の画面の位置は (c.y, c.x)、耐久の棒はその 134 上
      d = g.getContext("2d").getImageData(Math.round(c.y * k), Math.round((c.x - 134) * k), 1, 1).data;
    return [...d];
  });
  check(px[0] > 150 && px[1] < 140, "縦向き・高精細でも城の耐久の棒が城の上に描かれる", px);
  check(!errors.length, "高精細の描画で例外なし", errors);
  await c.close();
  // PC（画素密度2）は上限2倍
  ({ c, p } = await open({ width: 1280, height: 900, dpr: 2, query: "?debug&layout=compact" }));
  r = await canvas(p);
  check(Math.abs(r.w / 960 - 2) < 0.01, "画素密度2・大きな画面では2倍で頭打ち（重くしすぎない）", r);
  await c.close();
  // 画素密度1：従来と同じ大きさ（試験・PCの標準）
  ({ c, p } = await open({ width: 390, height: 844, dpr: 1, query: "?debug" }));
  r = await canvas(p);
  check(r.w === 960 && r.h === 600, "画素密度1で表示が小さいときは従来の 960×600 のまま", r);
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
