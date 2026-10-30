// 部隊内の並べ替え（v105.4）：編成画面の ☰ と部隊の兵士の札をドラッグで並べ替え。先頭が敵の攻撃を最初に受ける。ウェーブ中はできない
//   node tools/test-squad-reorder.mjs
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
const SKEY = "worldDefense.soldiers.v1";
const save = { seq: 20, squadSeq: 2, squads: [{ id: 1, type: "spearman", slot: 0 }, { id: 2, type: "archer", slot: 1 }], soldiers: [], fallen: [] };
for (let i = 1; i <= 5; i++) save.soldiers.push({ id: i, type: "spearman", squadId: 1, level: 10 + i });
for (let i = 6; i <= 8; i++) save.soldiers.push({ id: i, type: "archer", squadId: 2, level: 10 });
save.soldiers[2].named = "magoichi";
save.soldiers[2].type = "gunner";
save.soldiers[2].name = "雑賀孫市";
async function open(width, height, query) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600 });
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
  return { c, p };
}
const order = (p, sq = 1) => p.evaluate((sq) => WD_DEBUG.squadApi.members(WD_DEBUG.state().squads.find((q) => q.id === sq)).map((s) => s.id), sq);
// 要素の中心から別の要素の中心へ、指（またはマウス）で少しずつ動かす
async function dragTo(p, from, to) {
  await p.locator(to).scrollIntoViewIfNeeded();
  await p.locator(from).scrollIntoViewIfNeeded();
  const a = await p.locator(from).boundingBox(), b = await p.locator(to).boundingBox();
  const sx = a.x + a.width / 2, sy = a.y + a.height / 2, ex = b.x + b.width / 2, ey = b.y + b.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(sx + ((ex - sx) * i) / 8, sy + ((ey - sy) * i) / 8);
  await p.mouse.up();
}
try {
  let { c, p } = await open(1280, 900, "?debug&layout=classic");
  check((await order(p)).join() === "1,2,3,4,5", "最初は雇った順（名簿の順）", await order(p));
  // 1. 編成画面：☰ をドラッグ
  await p.click("#organize");
  let r = await p.evaluate(() => ({
    handles: document.querySelectorAll('#squadList [data-formation-row] .drag-handle').length,
    front: [...document.querySelectorAll("#squadList .squad-card")].map((c) => c.querySelector(".front-tag")?.closest("[data-formation-row]")?.dataset.formationRow),
    hint: document.getElementById("squadHint").textContent,
  }));
  check(r.handles === 8 && r.front.slice(0, 2).join() === "1,6" && /ドラッグで並べ替え/.test(r.hint), "編成画面に並べ替えのつまみ（☰）と先頭の印、説明がある", r);
  await dragTo(p, '[data-formation-row="3"] .drag-handle', '[data-formation-row="1"]');
  check((await order(p)).join() === "3,1,2,4,5", "ネームド（雑賀孫市）を先頭へドラッグ", await order(p));
  r = await p.evaluate(() => document.querySelector("#squadList .squad-card .front-tag").closest("[data-formation-row]").dataset.formationRow);
  check(r === "3", "先頭の印が移る", r);
  await dragTo(p, '[data-formation-row="3"] .drag-handle', '[data-formation-row="5"]');
  check((await order(p)).join() === "1,2,4,5,3", "後ろへドラッグすると相手の後ろに入る", await order(p));
  await dragTo(p, '[data-formation-row="1"] .drag-handle', '[data-formation-row="7"]');
  check((await order(p)).join() === "1,2,4,5,3" && (await order(p, 2)).join() === "6,7,8", "別の部隊の兵士の上で離しても何も変わらない（移籍は従来の操作）", [await order(p), await order(p, 2)]);
  // 2. 先頭が敵の攻撃を最初に受ける
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state(), q = S.squads.find((q) => q.id === 1), list = WD_DEBUG.squadApi.members(q);
    const hp = list.map((s) => s.hp);
    WD_DEBUG.squadApi.damageSquad ? WD_DEBUG.squadApi.damageSquad(q, 30, false, "goblin") : null;
    return { has: !!WD_DEBUG.squadApi.damageSquad, changed: list.map((s, i) => s.hp !== hp[i]) };
  });
  if (r.has) check(r.changed[0] && !r.changed.slice(1).some(Boolean), "敵の攻撃は先頭の兵士が受ける", r);
  // 3. 保存：ウェーブクリアの保存で名簿の順番が残り、読み込み直しても同じ
  await p.evaluate(() => WD_DEBUG.squadApi.saveRoster ? WD_DEBUG.squadApi.saveRoster() : document.getElementById("checkpointSave").click());
  r = await p.evaluate((k) => JSON.parse(localStorage.getItem(k)).soldiers.filter((s) => s.squadId === 1).map((s) => s.id), SKEY);
  check(r.join() === "1,2,4,5,3", "並べ替えた順番で保存される（保存データの形は変わらない）", r);
  await p.reload();
  await p.waitForFunction(() => window.WD_DEBUG);
  check((await order(p)).join() === "1,2,4,5,3", "読み込み直しても並び順が残る", await order(p));
  await c.close();
  // 4. スマホ：部隊の兵士の札をドラッグ（指で）。タップは従来どおり兵士の選択
  ({ c, p } = await open(390, 844, "?debug&layout=compact"));
  await p.evaluate(() => {
    const S = WD_DEBUG.state();
    WD_DEBUG.squadApi.deployReserve(S.squads[0], 300, 165);
  });
  r = await p.evaluate(() => {
    const q = WD_DEBUG.state().squads[0];
    return WD_DEBUG.squadApi.members(q).map((s) => s.id);
  });
  // 部隊を選んで兵士の詳細を開く
  await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    window.__sel = A.selectSquad ? A.selectSquad(WD_DEBUG.state().squads[0]) : null;
  });
  const opened = await p.evaluate(() => !!document.querySelector('#sqMembers [data-soldier]'));
  if (!opened) {
    // 戦場の部隊をタップして選ぶ
    const pt = await p.evaluate(() => {
      const g = document.getElementById("game"), rr = g.getBoundingClientRect(), q = WD_DEBUG.state().squads[0];
      return { x: rr.left + (q.x * rr.width) / 960, y: rr.top + ((q.y - 12) * rr.height) / 600 };
    });
    await p.touchscreen.tap(pt.x, pt.y);
  }
  if (!(await p.isVisible("#sqMembers [data-soldier]"))) await p.tap("#sqMore");
  r = await p.evaluate(() => ({ chips: document.querySelectorAll("#sqMembers [data-drag-soldier]").length, first: document.querySelector("#sqMembers [data-soldier]").textContent }));
  check(r.chips === 5 && r.first.startsWith("🛡"), "部隊の兵士の札もドラッグでき、先頭に🛡の印", r);
  await dragTo(p, '#sqMembers [data-soldier="4"]', '#sqMembers [data-soldier="1"]');
  check((await order(p)).join() === "4,1,2,3,5", "部隊の兵士の札をドラッグで先頭へ", await order(p));
  await p.tap('#sqMembers [data-soldier="2"]');
  r = await p.evaluate(() => WD_DEBUG.state().selectedSoldierId ?? document.querySelector("#sqMembers .chip.sel")?.dataset.soldier);
  check(String(r) === "2", "タップは従来どおり兵士の選択", r);
  // 5. ウェーブ中は並べ替えられない
  r = await p.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.step(0.05);
    const err = WD_DEBUG.reorderSoldier(5, 4);
    WD_DEBUG.heroApi.draw();
    return { err, drag: document.querySelectorAll("#sqMembers [data-drag-soldier]").length };
  });
  check(/ウェーブ中/.test(r.err) && (await order(p)).join() === "4,1,2,3,5", "ウェーブ中は並べ替えられない", r);
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
