// 縦向きの戦場（試作・v104）。入口が上・城が下。ゲームの座標と処理は同じで、描き方とタップの座標だけ入れ替える。
// 実際のタップ・ドラッグ（スマホ）で、建設・配置・選択・移動・戦闘が従来どおりできることを確かめる。
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
  let r = await p.evaluate(() => {
    const g = document.getElementById("game"),
      b = g.getBoundingClientRect();
    return { w: g.width, h: g.height, cw: Math.round(b.width), ch: Math.round(b.height), over: document.documentElement.scrollWidth - innerWidth, dock: document.getElementById("dockBar").getBoundingClientRect().bottom, compact: document.body.classList.contains("compact-ui") };
  });
  check(r.w === 600 && r.h === 960 && r.cw === 390 && r.ch === 624, "戦場は縦長 600×960、390px幅の画面で 390×624 に表示", r);
  check(r.over <= 0 && r.dock <= 844 && r.compact, "横にはみ出さず、戦場と操作の列が1画面に収まる（コンパクト表示と一緒）", r);
  check(
    await p.evaluate(() => {
      const A = WD_DEBUG.squadApi;
      return A.PROVINCES && WD_DEBUG.state().wave === 0;
    }),
    "ゲームの状態は従来どおり読み込む",
  );
  // 建設：草地（ゲーム座標 330,300）を画面でタップ
  await p.locator("#dockBuild").tap();
  await p.locator('[data-t="arrow"]').tap();
  await tap(p, 330, 300);
  r = await p.evaluate(() => WD_DEBUG.state().towers.map((t) => [Math.round(t.x), Math.round(t.y)]));
  check(r.length === 1 && Math.abs(r[0][0] - 330) < 3 && Math.abs(r[0][1] - 300) < 3, "画面の位置からゲームの座標へ正しく直して塔を建設", r);
  await tap(p, 650, 300);
  check((await p.evaluate(() => WD_DEBUG.state().towers.length)) === 1 && /建設できません/.test(await p.locator("#msg").innerText()), "道の上には建てられない（配置の決まりは同じ）");
  // 部隊の配置と選択
  await p.locator("#dockUnits").tap();
  await p.locator("#squadChips button >> nth=0").tap();
  await tap(p, 700, 300);
  r = await p.evaluate(() => WD_DEBUG.state().squads[0]);
  check(r.state === "deployed" && Math.abs(r.x - 700) < 10 && Math.abs(r.y - 300) < 5, "部隊を道へ配置", { state: r.state, x: r.x, y: r.y });
  await tap(p, 700, 288);
  check(await p.locator("#squadPanel").isVisible(), "立てて描いた部隊をタップすると選べる");
  await p.locator("#sqClose").tap();
  // ドラッグで塔を移動（CDPのタッチ）
  const cdp = await c.newCDPSession(p);
  const a = await at(p, 330, 300),
    b = await at(p, 700, 190);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  r = await p.evaluate(() => WD_DEBUG.state().towers.map((t) => [Math.round(t.x), Math.round(t.y)]));
  check(Math.abs(r[0][0] - 700) < 4 && Math.abs(r[0][1] - 190) < 4, "塔をドラッグして移動（準備中）", r);
  // 防衛のウェーブ
  r = await p.evaluate(() => {
    document.getElementById("start").click();
    for (let i = 0; i < 400; i++) {
      WD_DEBUG.step(0.05);
      if (i % 10 === 0) WD_DEBUG.heroApi.draw();
    }
    return { wave: WD_DEBUG.state().wave, enemies: WD_DEBUG.state().enemies.length };
  });
  check(r.wave === 1 && !errors.length, "ウェーブ中も描画を続けて例外なし", { r, errors });
  // 攻城戦と裏ボス
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
    A.setTarget(A.PROVINCES.owari.castle);
    const err = A.startBattle();
    for (let i = 0; i < 600 && A.battle(); i++) {
      WD_DEBUG.step(0.05);
      if (i % 10 === 0) WD_DEBUG.heroApi.draw();
    }
    const b = A.battle();
    if (b) A.endBattle("retreat");
    return { err };
  });
  check(!r.err && !errors.length, "攻城戦を描画しながら進めて例外なし", { r, errors });
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    const err = A.setBossTarget("orochi") || A.startBattle();
    for (let i = 0; i < 600 && A.battle(); i++) {
      WD_DEBUG.step(0.05);
      if (i % 5 === 0) WD_DEBUG.heroApi.draw();
    }
    if (A.battle()) A.endBattle("retreat");
    return { err };
  });
  check(!r.err && !errors.length, "真・八岐大蛇の討伐戦を描画しながら30秒進めて例外なし", { r, errors });
  // 切り替え（撤退の結果画面を閉じてから）
  await p.evaluate(() => document.querySelectorAll(".sheet-back:not([hidden]) .icon-btn").forEach((b) => b.click()));
  await p.locator("#dockMenu").tap();
  check(/戦場：縦/.test(await p.locator("#fieldToggle").innerText()), "メニューに戦場の向きの切り替え");
  await p.locator("#fieldToggle").tap();
  r = await p.evaluate(() => ({ w: document.getElementById("game").width, v: document.body.classList.contains("vertical-field"), saved: JSON.parse(localStorage.getItem("worldDefense.ui.v1")).layout }));
  check(r.w === 960 && !r.v && r.saved === "compact", "横向きの戦場へその場で戻せる（保存される）", r);
  await tap(p, 420, 300);
  check(
    (await p.evaluate(() => WD_DEBUG.state().towers.some((t) => Math.abs(t.x - 420) < 3 && Math.abs(t.y - 300) < 3))) || /建設|塔|資金|選択/.test(await p.locator("#msg").innerText()),
    "横向きに戻すとタップの座標も元どおり",
  );
  await p.locator("#dockMenu").tap();
  await p.locator("#fieldToggle").tap();
  await p.reload();
  check(await p.evaluate(() => document.body.classList.contains("vertical-field") && document.getElementById("game").height === 960), "縦向きの設定を再読み込み後も保持");
  await c.close();
  // 既定は従来どおり
  ({ c, p } = await open("?debug&layout=compact"));
  check(await p.evaluate(() => document.getElementById("game").width === 960), "縦向きは試作のため、選ばない限り横向きのまま");
  await c.close();
  // iPhone Safari：アドレスバー・下のツールバーで見える高さが減っても、ウェーブ開始と部隊の列が見える
  for (const [w, h] of [[375, 553], [390, 664], [390, 740], [430, 780]]) {
    ({ c, p } = await open("?debug&layout=vertical", w, h));
    r = await p.evaluate(() => {
      const g = document.getElementById("game").getBoundingClientRect();
      return { ratio: g.width / g.height, start: document.getElementById("start").getBoundingClientRect().bottom, dock: document.getElementById("dockBar").getBoundingClientRect().bottom, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth };
    });
    check(r.dock <= r.vh && r.start <= r.vh && Math.abs(r.ratio - 0.625) < 0.01 && r.over <= 0, w + "×" + h + "：戦場を縦横比のまま縮め、ウェーブ開始と部隊の列まで画面内", r);
    await c.close();
  }
  // PC
  ({ c, p } = await open("?debug&layout=vertical", 1280, 900));
  r = await p.evaluate(() => {
    const b = document.getElementById("game").getBoundingClientRect();
    return { w: b.width, h: b.height, dock: document.getElementById("dockBar").getBoundingClientRect().bottom };
  });
  check(r.dock <= 900 && Math.abs(r.w / r.h - 0.625) < 0.02, "PCでも縦長の戦場と操作の列が1画面に収まる", r);
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
