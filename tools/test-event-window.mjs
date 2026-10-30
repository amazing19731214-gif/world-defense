// イベントウィンドウ（v105.4）：戦闘を止めずに中央の手前へ1枚ずつ。同じ種類はまとめる・約3秒で閉じる・タップで閉じる・大事なものは記録
//   node tools/test-event-window.mjs
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
const save = { seq: 10, squadSeq: 1, squads: [{ id: 1, type: "spearman", slot: 0 }], soldiers: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, type: "spearman", squadId: 1, level: 50 })), fallen: [] };
async function open(width = 390, height = 844, query = "?debug&layout=compact") {
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
const win = (p) =>
  p.evaluate(() => {
    const el = document.getElementById("eventWin"),
      r = el.getBoundingClientRect(),
      g = document.getElementById("game").getBoundingClientRect();
    return { hidden: el.hidden, title: el.querySelector(".event-title").textContent, lines: [...el.querySelectorAll(".event-lines div")].map((d) => d.textContent), kind: el.dataset.kind, top: r.top - g.top, bottom: g.bottom - r.bottom, left: r.left, right: innerWidth - r.right, gh: g.height, ...WD_DEBUG.events.state() };
  });
try {
  let { c, p } = await open();
  // 1. 1件：中央の手前に出て、上と下（城の耐久・戦場の上部）を隠さない
  await p.evaluate(() => WD_DEBUG.events.push("insight", "槍兵一郎：見切り"));
  let r = await win(p);
  check(!r.hidden && r.title === "閃き！" && r.lines[0] === "槍兵一郎：見切り", "閃きのイベントウィンドウが出る", r);
  check(r.top > r.gh * 0.15 && r.bottom > 20 && r.left > 5 && r.right > 5, "戦場の上部と端を隠さない位置（中央の手前）", r);
  // 2. 同じ種類が続いたら1枚にまとめる
  await p.evaluate(() => {
    WD_DEBUG.events.push("insight", "槍兵二郎：連撃");
    WD_DEBUG.events.push("insight", "槍兵三郎：鉄壁");
    WD_DEBUG.events.push("insight", "槍兵四郎：反撃");
  });
  r = await win(p);
  check(r.title === "4人が閃いた！" && r.lines.length === 4 && r.lines[3] === "ほか1件" && !r.queue.length, "同じ種類はまとめて「4人が閃いた！」（3人まで名前、ほかは件数）", r);
  // 3. 約3秒で自動で閉じ、次の種類が出る
  await p.evaluate(() => WD_DEBUG.events.push("honor", "槍兵一郎：百人斬り"));
  r = await win(p);
  check(r.kind === "insight" && r.queue.join() === "honor", "違う種類は待ちの列に入り、同時に出るのは1枚だけ", r);
  await p.evaluate(() => { for (let i = 0; i < 25; i++) WD_DEBUG.events.animate(0.1); });
  r = await win(p);
  check(r.kind === "insight" && !r.hidden, "2.5秒ではまだ出ている", r);
  await p.evaluate(() => { for (let i = 0; i < 6; i++) WD_DEBUG.events.animate(0.1); });
  r = await win(p);
  check(r.kind === "honor" && r.title === "称号を得た！" && !r.hidden, "約3秒で閉じて、次の出来事（称号）が出る", r);
  // 4. タップですぐ閉じる（押した点は下の戦場にも届き、操作を邪魔しない）
  const tapWin = async () => {
    const b = await p.evaluate(() => { const r = document.getElementById("eventWin").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.touchscreen.tap(b.x, b.y);
  };
  r = await p.evaluate(() => {
    const el = document.getElementById("eventWin"), r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).id;
  });
  check(r === "game", "ウィンドウの下の戦場を押せる（戦闘の操作を邪魔しない）", r);
  await tapWin();
  r = await win(p);
  check(r.hidden && !r.cur, "ウィンドウの上をタップするとすぐ閉じる", r);
  // 5. 戦闘を止めない：表示中もウェーブが進む
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state;
    WD_DEBUG.squadApi.deployReserve(S().squads[0], 300, 165);
    document.getElementById("start").click();
    WD_DEBUG.events.push("book", "侍の書（敵将）");
    const before = S().enemies.length + ":" + S().gold;
    for (let i = 0; i < 60; i++) WD_DEBUG.step(0.05);
    const st = S();
    return { playing: st.playing, paused: st.paused, enemies: st.enemies.length, moved: st.enemies.some((e) => e.d > 0), before, shown: !document.getElementById("eventWin").hidden };
  });
  check(r.playing && !r.paused && r.moved && r.shown, "表示中も戦闘は止まらない（一時停止しない）", r);
  await tapWin();
  // 6. 大事な出来事は記録に残り、メニューの「📜 出来事」で見られる
  await p.evaluate(() => {
    WD_DEBUG.events.push("boss", "雷獣・白虎を初めて討伐した");
    WD_DEBUG.events.push("named", "真田の赤鬼（槍兵）が仕官した");
    WD_DEBUG.events.push("insight", "槍兵五郎：見切り");
  });
  r = await win(p);
  check(r.history.join() === "named:真田の赤鬼（槍兵）が仕官した,boss:雷獣・白虎を初めて討伐した" && r.kind === "boss", "裏ボスの初撃破・ネームドの仕官は記録に残る（閃きは残さない）", r);
  r = await p.evaluate(() => {
    document.getElementById("eventLogOpen").click();
    const items = [...document.querySelectorAll("#eventLogList li")].map((li) => li.textContent);
    const sheet = !document.getElementById("eventLogSheet").hidden;
    WD_DEBUG.events.animate(1); // 画面を開いている間は時間を進めない（次のコマで隠す）
    const st = WD_DEBUG.events.state(), winHidden = document.getElementById("eventWin").hidden;
    document.getElementById("eventLogClose").click();
    return { items, sheet, winHidden, age: st.cur && st.cur.age, closed: document.getElementById("eventLogSheet").hidden };
  });
  check(r.sheet && r.items.length === 2 && /👹 雷獣・白虎/.test(r.items[1]) && r.closed, "「📜 出来事」で記録を新しい順に見られ、閉じられる", r);
  check(r.winHidden && r.age === 0, "ほかの画面を開いている間は隠し、時間も進めない（読み逃さない）", r);
  r = await p.evaluate(() => { WD_DEBUG.events.animate(0.1); return !document.getElementById("eventWin").hidden; });
  check(r, "画面を閉じると、また表示する");
  // 7. ネームド兵士の戦死（防衛戦の実際の処理）
  r = await p.evaluate(() => {
    while (WD_DEBUG.events.state().cur) WD_DEBUG.events.animate(5);
    const S = WD_DEBUG.state(), A = WD_DEBUG.squadApi, q = S.squads[0], s = A.members(q)[1];
    s.named = "magoichi";
    A.killSoldier(s, q);
    const st = WD_DEBUG.events.state(), el = document.getElementById("eventWin");
    return { st, title: el.querySelector(".event-title").textContent, kind: el.dataset.kind, alive: s.alive };
  });
  check(!r.alive && r.kind === "namedFall" && r.title === "ネームド兵士が戦死…" && /雑賀孫市（鉄砲兵）が第.*で戦死した/.test(r.st.cur.lines[0]) && r.st.history[0].startsWith("namedFall:"), "ネームド兵士が戦死すると、イベントウィンドウに出て記録にも残る", r);
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state(), A = WD_DEBUG.squadApi, q = S.squads[0], s = A.members(q)[2];
    const before = WD_DEBUG.events.state().history.length;
    A.killSoldier(s, q); // ネームドでない兵士
    return { before, after: WD_DEBUG.events.state().history.length };
  });
  check(r.before === r.after, "ネームドでない兵士の戦死では出さない", r);
  // 8. 375px・PC で横にはみ出さない
  await c.close();
  for (const [w, h, q] of [[375, 667, "?debug&layout=compact"], [1280, 900, "?debug&layout=classic"]]) {
    ({ c, p } = await open(w, h, q));
    await p.evaluate(() => WD_DEBUG.events.push("boss", "真・八岐大蛇を初めて討伐した（とても長い名前でも折り返さず省略される確認のための文章）"));
    r = await win(p);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(!r.hidden && r.left > 0 && r.right > 0 && sw <= 0, w + "px でも戦場の中に収まり、横にはみ出さない", { ...r, sw });
    await c.close();
  }
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
