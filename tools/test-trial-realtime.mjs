// 戦場試練を本物の時間（ゲームの毎コマの処理）で動かす：防衛戦が「停止」のままでも戦場試練は進む
//   （読み込み直した直後は防衛戦が停止のまま。以前は戦場試練まで止まっていた）。情報の画面を開いている間・戦場試練の「⏸ 停止」では止まる
//   node tools/test-trial-realtime.mjs
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
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const save = { version: 1, seq: 2, squadSeq: 1, fallen: [], squads: [{ id: 1, type: "archer", slot: 0 }], soldiers: [{ id: 1, type: "archer", squadId: 1, level: 30, name: "試し弓" }, { id: 2, type: "ashigaru", squadId: 1, level: 20 }] };
try {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c.addInitScript((s) => {
    if (sessionStorage.s) return;
    sessionStorage.s = 1;
    localStorage.clear();
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(s));
    localStorage.setItem("worldDefense.ui.v1", JSON.stringify({ version: 1, all: true, seen: {}, fresh: {} }));
  }, save);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "?debug");
  await p.waitForFunction(() => window.WD_DEBUG);
  await p.waitForTimeout(800);
  // 防衛戦を「停止」にする（読み込み直した直後と同じ状態）
  const mode = await p.evaluate(() => {
    const b = document.getElementById("pace");
    for (let i = 0; i < 4 && b.dataset.mode !== "paused"; i++) b.click();
    return b.dataset.mode;
  });
  await p.evaluate(() => {
    document.getElementById("trialOpen").click();
    document.querySelector('[data-trial-mode="survival"]').click();
    document.querySelector('[data-trial-pick="1"]').click();
    document.querySelector("[data-trial-go]").click();
  });
  const st = () => p.evaluate(() => WD_DEBUG.trial.live().st);
  const s0 = await st();
  await p.waitForTimeout(2500);
  const s1 = await st();
  check(mode === "paused" && s1 - s0 > 1.5, "防衛戦が「停止」のままでも、戦場試練は本物の時間で進む（面の時計 " + s0.toFixed(1) + " → " + s1.toFixed(1) + " 秒）", { mode, s0, s1 });
  // 情報の画面を開いている間は止まる。閉じると進む
  await p.evaluate(() => document.getElementById("infoOpen") && document.getElementById("infoOpen").click());
  const opened = await p.evaluate(() => !document.getElementById("infoSheet").hidden);
  const a0 = await st();
  await p.waitForTimeout(1200);
  const a1 = await st();
  await p.evaluate(() => document.getElementById("infoClose") && document.getElementById("infoClose").click());
  await p.waitForTimeout(1200);
  const a2 = await st();
  if (opened) check(a1 - a0 < 0.1 && a2 - a1 > 0.5, "情報の画面を開いている間は止まり、閉じると進む", { a0, a1, a2 });
  // 戦場試練の「⏸ 停止」で止まる。「▶ 再開」で進む
  await p.evaluate(() => document.getElementById("trialPause").click());
  const b0 = await st();
  await p.waitForTimeout(1200);
  const b1 = await st();
  await p.evaluate(() => document.getElementById("trialPause").click());
  await p.waitForTimeout(1200);
  const b2 = await st();
  check(b1 - b0 < 0.1 && b2 - b1 > 0.5, "戦場試練の「⏸ 停止」で止まり、「▶ 再開」で進む", { b0, b1, b2 });
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
