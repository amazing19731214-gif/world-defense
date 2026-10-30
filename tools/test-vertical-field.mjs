// 縦向きの戦場（試作）。設定「攻めは縦」：攻城戦・裏ボスの討伐戦は縦向き（入口が上・城が下）、防衛戦は横向き（v104.3）。
// ゲームの座標と処理は同じで、描き方とタップの座標だけ入れ替える。実際の操作と戦闘の描画で確かめる。
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
const types = ["spearman", "cavalry", "archer", "medic", "gunner", "spearman", "cavalry", "archer"],
  save = { seq: 80, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
let sid = 0;
types.forEach((t, i) => {
  save.squads.push({ id: i + 1, type: t, slot: i });
  for (let k = 0; k < 10; k++) save.soldiers.push({ id: ++sid, type: t, squadId: i + 1, level: 200, pts: { atk: 300, def: 300, spd: 0, rng: 0 } });
});
async function open(query = "?debug&layout=vertical", width = 390, height = 844) {
  const c = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  await c.addInitScript((save) => {
    requestAnimationFrame = () => 0;
    if (location.protocol !== "http:" || sessionStorage.s) return;
    sessionStorage.s = 1;
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
    localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ owned: { nobunaga: 1 }, tickets: 2, forge: { items: [], seq: 0, treasures: { kusanagi: true, yata: true, magatama: true } } }));
  }, save);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  await p.evaluate(() => WD_DEBUG.setGold(5000));
  return { c, p };
}
// ゲームの座標 → 縦向きの戦場の画面の座標（画面の x はゲームの y、画面の y はゲームの x）
const at = (p, x, y) =>
  p.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect(),
        v = document.body.classList.contains("vertical-field");
      return v
        ? { x: r.left + c.clientLeft + (y * c.clientWidth) / 600, y: r.top + c.clientTop + (x * c.clientHeight) / 960 }
        : { x: r.left + c.clientLeft + (x * c.clientWidth) / 960, y: r.top + c.clientTop + (y * c.clientHeight) / 600 };
    },
    [x, y],
  );
const tap = async (p, x, y) => {
  const pt = await at(p, x, y);
  await p.touchscreen.tap(pt.x, pt.y);
};
try {
  let { c, p } = await open();
  const field = () =>
    p.evaluate(() => {
      const g = document.getElementById("game"),
        b = g.getBoundingClientRect();
      return { w: g.width, h: g.height, cw: Math.round(b.width), ch: Math.round(b.height), v: document.body.classList.contains("vertical-field"), over: document.documentElement.scrollWidth - innerWidth };
    });
  let r = await field();
  check(r.w === 960 && r.h === 600 && !r.v, "設定「攻めは縦」でも、防衛戦（守り）は横向き", r);
  check(await p.evaluate(() => document.body.classList.contains("compact-ui")), "コンパクト表示と一緒に使う");
  // 防衛戦の操作は横向きのまま
  await p.locator("#dockBuild").tap();
  await p.locator('[data-t="arrow"]').tap();
  await tap(p, 330, 300);
  r = await p.evaluate(() => WD_DEBUG.state().towers.map((t) => [Math.round(t.x), Math.round(t.y)]));
  check(r.length === 1 && Math.abs(r[0][0] - 330) < 3 && Math.abs(r[0][1] - 300) < 3, "防衛戦：横向きの戦場で塔を建設", r);
  await p.locator("#dockUnits").tap();
  await p.locator("#squadChips button >> nth=0").tap();
  await tap(p, 700, 300);
  r = await p.evaluate(() => WD_DEBUG.state().squads[0]);
  check(r.state === "deployed" && Math.abs(r.x - 700) < 10, "防衛戦：部隊を道へ配置", { state: r.state, x: r.x });
  r = await p.evaluate(() => {
    document.getElementById("start").click();
    for (let i = 0; i < 200; i++) {
      WD_DEBUG.step(0.05);
      if (i % 10 === 0) WD_DEBUG.heroApi.draw();
    }
    return { wave: WD_DEBUG.state().wave, w: document.getElementById("game").width };
  });
  check(r.wave === 1 && r.w === 960 && !errors.length, "防衛のウェーブ中も横向き", r);
  // 攻城戦（攻め）は縦向き
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
    A.setTarget(A.PROVINCES.owari.castle);
    const err = A.startBattle();
    WD_DEBUG.heroApi.draw();
    return { err };
  });
  r = { ...r, ...(await field()) };
  check(!r.err && r.w === 600 && r.h === 960 && r.v && r.over <= 0, "攻城戦が始まると縦向き（600×960）に切り替わる", r);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    for (let i = 0; i < 600 && A.battle(); i++) {
      WD_DEBUG.step(0.05);
      if (i % 10 === 0) WD_DEBUG.heroApi.draw();
    }
    if (A.battle()) A.endBattle("retreat");
    WD_DEBUG.heroApi.draw();
    return { w: document.getElementById("game").width };
  });
  check(r.w === 960 && !errors.length, "攻城戦を縦向きで描き続けて例外なし、終われば横向きに戻る", { r, errors });
  await p.evaluate(() => document.querySelectorAll(".sheet-back:not([hidden]) .icon-btn").forEach((b) => b.click()));
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    const err = A.setBossTarget("orochi") || A.startBattle();
    WD_DEBUG.heroApi.draw();
    const during = document.getElementById("game").width;
    for (let i = 0; i < 600 && A.battle(); i++) {
      WD_DEBUG.step(0.05);
      if (i % 5 === 0) WD_DEBUG.heroApi.draw();
    }
    if (A.battle()) A.endBattle("retreat");
    WD_DEBUG.heroApi.draw();
    return { err, during, after: document.getElementById("game").width };
  });
  check(!r.err && r.during === 600 && r.after === 960 && !errors.length, "真・八岐大蛇の討伐戦も縦向き、終われば横向き", { r, errors });
  await p.evaluate(() => document.querySelectorAll(".sheet-back:not([hidden]) .icon-btn").forEach((b) => b.click()));
  // 防衛戦の操作が横向きの座標に戻っている
  await p.locator("#dockBuild").tap();
  await p.locator('[data-t="arrow"]').tap();
  await tap(p, 420, 300);
  check(await p.evaluate(() => WD_DEBUG.state().towers.some((t) => Math.abs(t.x - 420) < 3 && Math.abs(t.y - 300) < 3)), "攻めのあとの防衛戦でもタップの座標は横向きのまま正しい");
  // 縦向きのタップの座標の変換（画面の縦がゲームの横）
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setTarget(A.PROVINCES.owari.castle);
    A.startBattle();
    WD_DEBUG.heroApi.draw();
    const c = document.getElementById("game"),
      b = c.getBoundingClientRect(),
      ev = { clientX: b.left + c.clientLeft + (300 * c.clientWidth) / 600, clientY: b.top + c.clientTop + (700 * c.clientHeight) / 960 },
      pt = WD_DEBUG.squadApi.mapPoint ? WD_DEBUG.squadApi.mapPoint(ev) : null;
    A.endBattle("retreat");
    return pt;
  });
  if (r) check(Math.abs(r.x - 700) < 2 && Math.abs(r.y - 300) < 2, "縦向きでは画面の位置をゲームの座標へ入れ替えて読む", r);
  await p.evaluate(() => document.querySelectorAll(".sheet-back:not([hidden]) .icon-btn").forEach((b) => b.click()));
  // 切り替えと保存
  await p.locator("#dockMenu").tap();
  check(/戦場：攻めは縦/.test(await p.locator("#fieldToggle").innerText()), "メニューの表示は「戦場：攻めは縦」");
  await p.locator("#fieldToggle").tap();
  check(await p.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.ui.v1")).layout === "compact"), "「戦場：横」に切り替えて保存");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setTarget(A.PROVINCES.owari.castle);
    A.startBattle();
    WD_DEBUG.heroApi.draw();
    const w = document.getElementById("game").width;
    A.endBattle("retreat");
    return w;
  });
  check(r === 960, "「戦場：横」なら攻城戦も横向き");
  await p.evaluate(() => document.querySelectorAll(".sheet-back:not([hidden]) .icon-btn").forEach((b) => b.click()));
  await p.locator("#dockMenu").tap();
  await p.locator("#fieldToggle").tap();
  await p.reload();
  await p.waitForFunction(() => window.WD_DEBUG);
  r = await p.evaluate(() => ({ layout: JSON.parse(localStorage.getItem("worldDefense.ui.v1")).layout, w: document.getElementById("game").width, label: document.getElementById("fieldToggle").textContent }));
  check(r.layout === "vertical" && r.w === 960, "「攻めは縦」を再読み込み後も保持（防衛戦は横向き）", r);
  await p.goto(base + "?debug"); // URLで指定せず、保存した設定だけで開く
  await p.waitForFunction(() => window.WD_DEBUG);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setTarget(A.PROVINCES.owari.castle);
    A.startBattle();
    WD_DEBUG.heroApi.draw();
    return { w: document.getElementById("game").width, label: document.getElementById("fieldToggle").textContent, compact: document.body.classList.contains("compact-ui") };
  });
  check(r.w === 600 && /攻めは縦/.test(r.label) && r.compact, "保存した「攻めは縦」だけで開いても、攻城戦は縦向き", r);
  await c.close();
  // iPhone Safari：攻城戦の縦向きでも戦場は縦横比のまま、戦況と必殺技の1段目が見える
  for (const [w, h] of [[375, 553], [390, 664], [390, 844]]) {
    ({ c, p } = await open("?debug&layout=vertical", w, h));
    r = await p.evaluate(() => {
      const A = WD_DEBUG.squadApi;
      A.setTarget(A.PROVINCES.owari.castle);
      A.startBattle();
      WD_DEBUG.step(0.1);
      WD_DEBUG.heroApi.draw();
      return new Promise((ok) =>
        setTimeout(() => {
          const g = document.getElementById("game").getBoundingClientRect();
          ok({ ratio: g.width / g.height, info: document.getElementById("battleInfo").getBoundingClientRect().bottom, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth });
        }, 50),
      );
    });
    check(Math.abs(r.ratio - 0.625) < 0.01 && r.info <= r.vh && r.over <= 0, w + "×" + h + "：攻城戦の縦向きでも戦況の表示まで画面内", r);
    await c.close();
  }
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
