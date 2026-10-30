// 部隊・塔のドラッグ＆ドロップ移動（v101）。準備中だけ・塔は無料・配置のルールを守る。
// マウスは実際のドラッグ、スマホは CDP のタッチイベント（スクロールの抑止も含む）で確かめる。
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
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const save = {
  seq: 20,
  squadSeq: 2,
  squads: [
    { id: 1, type: "spearman", slot: 0 },
    { id: 2, type: "archer", slot: 1 },
  ],
  soldiers: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, type: i < 10 ? "spearman" : "archer", squadId: i < 10 ? 1 : 2, level: 50 })),
  fallen: [],
};
async function open(mobile) {
  const c = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } },
  );
  await c.addInitScript((save) => {
    if (location.protocol !== "http:" || sessionStorage.seeded) return;
    sessionStorage.seeded = "1";
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
    localStorage.setItem("worldDefense.ui.v1", JSON.stringify({ all: true }));
  }, save);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto("http://127.0.0.1:" + server.address().port + "/?debug");
  await p.waitForFunction(() => window.WD_DEBUG);
  await p.evaluate(() => WD_DEBUG.setGold(5000));
  return { c, p };
}
// マップの座標 → 画面の座標
const at = (p, x, y) =>
  p.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game");
      let r = c.getBoundingClientRect();
      const py = r.top + c.clientTop + (y * c.clientHeight) / 600;
      if (py < 0 || py > innerHeight) c.scrollIntoView({ block: "center" }); // ボタン操作で画面が流れたときだけ地図を見える位置へ
      r = c.getBoundingClientRect();
      return { x: r.left + c.clientLeft + (x * c.clientWidth) / 960, y: r.top + c.clientTop + (y * c.clientHeight) / 600 };
    },
    [x, y],
  );
async function mouseDrag(p, from, to) {
  const a = await at(p, ...from),
    b = await at(p, ...to);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await p.mouse.up();
}
async function touchDrag(p, cdp, from, to, steps = 8) {
  const a = await at(p, ...from),
    b = await at(p, ...to);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= steps; i++)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(50);
}
const towers = (p) => p.evaluate(() => WD_DEBUG.state().towers.map((t) => ({ id: t.id, x: Math.round(t.x), y: Math.round(t.y), level: t.level, type: t.type })));
const squadsOf = (p) => p.evaluate(() => WD_DEBUG.state().squads.map((q) => ({ id: q.id, state: q.state, x: Math.round(q.x), y: Math.round(q.y) })));
const gold = (p) => p.evaluate(() => WD_DEBUG.state().gold);
try {
  // ===== PC（マウス）=====
  let { c, p } = await open(false);
  await p.locator('[data-t="arrow"]').click();
  let pt = await at(p, 330, 300);
  await p.mouse.click(pt.x, pt.y);
  await p.mouse.click(pt.x, pt.y); // 建てた塔を選ぶ
  await p.locator("#upgrade").click();
  let t0 = (await towers(p))[0];
  const g0 = await gold(p);
  check(t0 && t0.level === 2, "準備：塔を建てて強化", t0);
  await mouseDrag(p, [330, 300], [700, 190]);
  let t1 = await towers(p);
  check(t1.length === 1 && t1[0].x === 700 && t1[0].y === 190 && t1[0].level === 2 && t1[0].id === t0.id, "マウスで塔を草地へドラッグすると移動（強化Lvはそのまま）", t1);
  check((await gold(p)) === g0, "塔の移動は無料、ドラッグの後のクリックで新しい塔を建てない");
  check(/を移動した/.test(await p.locator("#msg").innerText()) && (await p.locator("#towerPanel").isVisible()), "移動した塔を選んだ状態にする");
  await mouseDrag(p, [700, 190], [650, 300]);
  check((await towers(p))[0].x === 700, "道の上へは塔を動かせない");
  check(/そこには塔を置けません/.test(await p.locator("#msg").innerText()), "置けない理由を表示");
  await p.locator('[data-t="cannon"]').click();
  pt = await at(p, 330, 300);
  await p.mouse.click(pt.x, pt.y);
  await mouseDrag(p, [330, 300], [720, 200]);
  check((await towers(p)).find((t) => t.type === "cannon").x === 330, "ほかの塔に近すぎる場所へは動かせない");
  await p.evaluate(() => WD_DEBUG.squadApi.deployReserve(WD_DEBUG.state().squads[0], 650, 300));
  let q0 = (await squadsOf(p))[0];
  check(q0.state === "deployed", "準備：部隊を道に配置", q0);
  await mouseDrag(p, [q0.x, q0.y - 12], [300, 445]);
  let q1 = (await squadsOf(p))[0];
  check(q1.state === "deployed" && Math.abs(q1.y - 440) < 3 && Math.abs(q1.x - 300) < 8, "マウスで部隊を別の道へドラッグすると道の上へ移動", q1);
  await mouseDrag(p, [q1.x, q1.y - 12], [330, 300]);
  check(JSON.stringify((await squadsOf(p))[0]) === JSON.stringify(q1), "草地（道の外）へは部隊を動かせない");
  await mouseDrag(p, [q1.x, q1.y - 12], [40, 300]);
  check(JSON.stringify((await squadsOf(p))[0]) === JSON.stringify(q1) && /入口の近く/.test(await p.locator("#msg").innerText()), "入口の近くへは動かせない（配置と同じルール）");
  await p.evaluate(() => WD_DEBUG.squadApi.deployReserve(WD_DEBUG.state().squads[1], 650, 300));
  const q2 = (await squadsOf(p))[1];
  await mouseDrag(p, [q2.x, q2.y - 12], [q1.x + 10, q1.y]);
  check(JSON.stringify((await squadsOf(p))[1]) === JSON.stringify(q2) && /近すぎます/.test(await p.locator("#msg").innerText()), "ほかの部隊に近すぎる場所へは動かせない");
  await mouseDrag(p, [q2.x, q2.y - 12], [q2.x + 5, q2.y - 10]);
  check(JSON.stringify((await squadsOf(p))[1]) === JSON.stringify(q2) && (await p.locator("#squadPanel").isVisible()), "わずかな動きはタップとして部隊を選ぶ");
  await p.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "wolf", d: 5, hp: 1e12, speed: 0 }); // ウェーブを続けるための動かない敵
  });
  check(await p.evaluate(() => WD_DEBUG.state().playing), "準備：ウェーブ中にする");
  const before = { t: await towers(p), q: await squadsOf(p) };
  await mouseDrag(p, [700, 190], [700, 520]);
  await mouseDrag(p, [q2.x, q2.y - 12], [300, 160]);
  check(JSON.stringify(await towers(p)) === JSON.stringify(before.t) && JSON.stringify(await squadsOf(p)) === JSON.stringify(before.q), "ウェーブ中はドラッグしても動かない");
  await p.evaluate(() => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
  await mouseDrag(p, [700, 190], [700, 520]);
  check((await towers(p)).find((t) => t.type === "arrow").y === 520, "ウェーブが終われば再び動かせる");
  await c.close();

  // ===== スマホ（タッチ）=====
  ({ c, p } = await open(true));
  const cdp = await c.newCDPSession(p);
  await p.evaluate(() => WD_DEBUG.squadApi.deployReserve(WD_DEBUG.state().squads[0], 650, 300));
  await p.locator('[data-t="arrow"]').tap();
  pt = await at(p, 330, 300);
  await p.touchscreen.tap(pt.x, pt.y);
  check((await towers(p)).length === 1, "タッチ：草地のタップでいつも通り塔を建てる");
  await p.evaluate(() => window.scrollTo(0, 30)); // 少しスクロールした状態（部隊は固定ヘッダーの下に見えている）
  const scroll0 = await p.evaluate(() => scrollY);
  q0 = (await squadsOf(p))[0];
  await touchDrag(p, cdp, [q0.x, q0.y - 12], [300, 445]);
  q1 = (await squadsOf(p))[0];
  check(Math.abs(q1.y - 440) < 3 && Math.abs(q1.x - 300) < 8, "タッチで部隊をドラッグして移動", q1);
  check((await p.evaluate(() => scrollY)) === scroll0, "部隊をドラッグしてもページはスクロールしない");
  await touchDrag(p, cdp, [330, 300], [700, 190]);
  t1 = await towers(p);
  check(t1[0].x === 700 && t1[0].y === 190 && (await p.evaluate(() => scrollY)) === scroll0, "タッチで塔をドラッグして移動、スクロールしない", t1);
  await touchDrag(p, cdp, [q1.x, q1.y - 12], [q1.x, q1.y - 12], 1);
  check(await p.locator("#squadPanel").isVisible(), "タッチ：部隊のタップは今まで通り部隊を選ぶ");
  await p.evaluate(() => window.scrollTo(0, 0)); // 上部の固定ヘッダーに塔が隠れないように
  await touchDrag(p, cdp, [700, 190], [700, 190], 1);
  check(await p.locator("#towerPanel").isVisible(), "タッチ：塔のタップは今まで通り塔を選ぶ");
  await p.evaluate(() => window.scrollTo(0, 0));
  await touchDrag(p, cdp, [480, 560], [480, 60]);
  check((await p.evaluate(() => scrollY)) > 0 || (await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight)), "部隊・塔のない草地からのスワイプはページをスクロールする");
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
