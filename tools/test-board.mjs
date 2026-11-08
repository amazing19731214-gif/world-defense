// 💬 掲示板の試験。本物の Firebase にはつながず、作り物の置き場（window.WD_BOARD_BACKEND）で動かす
//   node tools/test-board.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const page = fs.readFileSync(new URL("../index.html", import.meta.url));
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(page);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [], outside = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
// 作り物の置き場：書きこみはこのページの中だけ。他の人の書きこみ2件を最初から入れておく
const mock = () => {
  const store = { posts: [], seq: 0, listeners: [] };
  const now = Date.now();
  store.posts.push({ id: "a1", name: "槍の権兵衛", text: "第10波を越えた！", uid: "other1", at: now - 120000, reportedBy: [] });
  store.posts.push({ id: "a2", name: "荒らし", text: "いやな書きこみ", uid: "other2", at: now - 60000, reportedBy: ["x", "y"] });
  const emit = () => {
    const list = store.posts.slice().sort((a, b) => b.at - a.at).map((p) => ({ ...p, reports: p.reportedBy.length, reportedByMe: p.reportedBy.includes("me") }));
    store.listeners.forEach((f) => f(list));
  };
  window.__board = store;
  window.WD_BOARD_BACKEND = {
    init: async () => "me",
    listen(cb) { store.listeners.push(cb); emit(); return () => {}; },
    async post(name, text) { store.posts.push({ id: "p" + ++store.seq, name, text, uid: "me", at: Date.now(), reportedBy: [] }); emit(); },
    async remove(id) { store.posts = store.posts.filter((p) => p.id !== id); emit(); },
    async report(id) { const p = store.posts.find((q) => q.id === id); if (!p.reportedBy.includes("me")) p.reportedBy.push("me"); emit(); },
  };
};
try {
  // ■ 本番の版で Firebase の部品が読みこめないとき（通信できない等）：エラーにならず「つながりませんでした」と出る。
  //   掲示板を開くまでは Firebase へ通信しない
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c.route(/gstatic\.com|googleapis\.com|firebaseapp\.com/, (r) => r.abort());
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => { if (!r.url().startsWith(base) && !r.url().startsWith("data:")) outside.push(r.url()); });
    await p.goto(base);
    await p.waitForTimeout(500);
    check(!outside.some((u) => /firebase|gstatic|googleapis/.test(u)), "掲示板を開くまでは Firebase へ通信しない", outside);
    await p.evaluate(() => document.getElementById("boardOpen").click());
    await p.waitForTimeout(300);
    check(await p.locator("#boardSheet").isVisible(), "メニューの「💬 掲示板」で掲示板が開く");
    await p.waitForFunction(() => /つながりませんでした/.test(document.getElementById("boardStatus").textContent), null, { timeout: 15000 });
    check(!(await p.locator("#boardForm").isVisible()), "つながらないときは「つながりませんでした」と出て、書きこみ欄は出ない");
    await c.close();
  }
  // ■ 作り物の置き場で、書く・読む・消す・通報
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await c.addInitScript(mock);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base);
  await p.evaluate(() => document.getElementById("boardOpen").click());
  await p.waitForSelector("#boardForm:not([hidden])");
  const items = () => p.locator("#boardList li").allTextContents();
  let list = await items();
  check(list.length === 2 && /槍の権兵衛/.test(list[1]) && /第10波を越えた/.test(list[1]), "書きこみが新しい順に並ぶ（名前・本文・時刻）", list);
  check(/2分前/.test(list[1]), "時刻は「○分前」で出る", list[1]);
  // 通報2人の書きこみ → 自分が通報して3人で隠れる
  await p.locator('[data-board-report="a2"]').click();
  await p.waitForTimeout(200);
  list = await items();
  check(/通報が多いため表示していません/.test(list[0]) && !/いやな書きこみ/.test(list[0]) && /通報ずみ/.test(list[0]), "3人に通報された書きこみは隠れる", list[0]);
  // 書きこめないもの
  const tryPost = async (name, text) => {
    await p.fill("#boardName", name);
    await p.fill("#boardText", text);
    await p.locator("#boardSend").click();
    await p.waitForTimeout(150);
    return p.locator("#boardMsg").textContent();
  };
  check(/本文を書いて/.test(await tryPost("", "   ")), "空の本文は書きこめない");
  check(/140文字まで/.test(await tryPost("", "あ".repeat(141))), "本文は140文字まで");
  check(/URL/.test(await tryPost("", "ここ見て https://example.com")), "URLは書きこめない");
  check(/使えないことば/.test(await tryPost("", "お前は死 ね")), "NGことば（空白をはさんでも）は書きこめない");
  check(/使えないことば/.test(await tryPost("", "キモい")), "NGことば（カタカナでも）は書きこめない");
  // 書きこむ
  const before = (await items()).length;
  await tryPost("信長ファン", "はじめまして！\nもうかえろうかな、負けてばかりですしね");
  list = await items();
  check(list.length === before + 1 && /信長ファン/.test(list[0]) && /負けてばかりですしね/.test(list[0]), "書きこむと一番上に出る（ふつうの文「かえろう・ばかり・ですしね」は止めない）", list[0]);
  check(await p.evaluate(() => localStorage.getItem("worldDefense.boardName.v1")) === "信長ファン", "名前を覚えておく");
  check(/あと\d+秒/.test(await p.locator("#boardSend").textContent()) && (await p.locator("#boardSend").isDisabled()), "続けては書きこめない（ボタンに残り秒数）");
  await p.fill("#boardText", "もう一回");
  await p.evaluate(() => document.getElementById("boardForm").requestSubmit());
  await p.waitForTimeout(150);
  check(/連続では書きこめません/.test(await p.locator("#boardMsg").textContent()) && (await items()).length === before + 1, "30秒たつまでは連続で書きこめない");
  // HTMLを書いてもそのまま文字で出る
  await p.evaluate(() => localStorage.removeItem("worldDefense.boardLast.v1"));
  await tryPost("", "<img src=x onerror=alert(1)>テスト");
  list = await items();
  check(/<img src=x/.test(list[0]) && (await p.locator("#boardList img").count()) === 0, "HTMLのタグは文字のまま出る（仕掛けは動かない）");
  check(/名無しの足軽/.test(list[0]), "名前が空なら「名無しの足軽」");
  // 自分の書きこみは消せる・他人のは消せない
  check((await p.locator('[data-board-del="a1"]').count()) === 0 && (await p.locator("[data-board-del]").count()) === 2, "自分の書きこみにだけ「消す」が出る");
  await p.locator("[data-board-del]").first().click();
  await p.waitForTimeout(200);
  check((await items()).length === before + 1, "自分の書きこみを消せる");
  await p.screenshot({ path: process.env.BOARD_SHOT || "/tmp/board.png" });
  check(errors.length === 0, "エラーなし", errors);
  await c.close();
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
