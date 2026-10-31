// テストプレイ版（test-build/index.html）：本番と保存領域を分ける・テスト用兵士・本番の版には何も足さない・iPhone縦で戦場試練を操作できる
//   node tools/test-test-env.mjs（はじめにテスト版 test-build/index.html を作り直す）
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");
// テスト版をいまのソースから作る（本番の index.html は書き換えない）
execFileSync(process.execPath, [new URL("./build.mjs", import.meta.url).pathname, "--test"], { stdio: "ignore" });
const PROD = new URL("../index.html", import.meta.url),
  TEST = new URL("../test-build/index.html", import.meta.url);
// 同じオリジンで本番とテストを開く（いちばん混ざりやすい条件で確かめる）
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  // /blank：何もしない同じオリジンのページ（本番のページを離れるときの保存が済んでから、保存データを写し取る）
  r.end(q.url.startsWith("/blank") ? "<!doctype html><title>blank</title>" : fs.readFileSync(q.url.startsWith("/test") ? TEST : PROD));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port;
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
// 本番の保存データ（名前つきの兵士・武将・奥義書）
const prodSave = {
  "worldDefense.soldiers.v1": JSON.stringify({ version: 1, seq: 2, squadSeq: 1, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }], soldiers: [{ id: 1, type: "ashigaru", squadId: 1, level: 77, name: "本番太郎" }, { id: 2, type: "medic", squadId: 1, level: 12, name: "本番花子" }] }),
  "worldDefense.warlords.v1": JSON.stringify({ version: 1, owned: { nobunaga: 2 }, tickets: 9, history: [] }),
  "worldDefense.ougi.v1": JSON.stringify({ version: 1, seq: 1, books: [{ uid: 1, k: "happouTenshou", from: "本番の剣聖", job: "sword_saint", level: 300, at: 1 }], known: {}, rolls: {}, fails: {}, heir: null, run: null }),
  "worldDefense.ui.v1": JSON.stringify({ version: 1, all: true, seen: {}, fresh: {} }),
};
// 本当の保存領域をそのまま読む（テスト版のページでは getItem が「wdtest:」の領域へ向くので、元の読み方を使う）
const rawAll = (p) =>
  p.evaluate(() => {
    const get = window.WD_TEST_STORAGE ? (k) => window.WD_TEST_STORAGE.raw.get.call(localStorage, k) : (k) => localStorage.getItem(k);
    return Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, get(k)]));
  });
const prodOnly = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("wdtest:")));
try {
  if (!fs.existsSync(TEST)) throw new Error("test-build/index.html がありません。node tools/build.mjs --test を実行してください。");
  // 1. 本番の版には、テスト用の道具・札・ボタンが入っていない
  const prodHtml = fs.readFileSync(PROD, "utf8"),
    testHtml = fs.readFileSync(TEST, "utf8");
  check(!/WD_TEST_BUILD|testPrepare|テスト用兵士を準備|wdtest:/.test(prodHtml), "本番の index.html にはテスト用の道具が入っていない");
  check(testHtml.includes("WD_TEST_BUILD") && testHtml.includes("【テスト】WORLD DEFENSE"), "テストプレイ版にはテスト用の道具と【テスト】の題名がある");

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + "/");
  await p.evaluate((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, prodSave);
  await p.reload();
  await p.waitForTimeout(600);
  r0: {
    const r = await p.evaluate(() => ({ badge: !!document.getElementById("testBadge"), btn: !!document.getElementById("testPrepare"), flag: window.WD_TEST_BUILD === true }));
    check(!r.badge && !r.btn && !r.flag, "本番の画面には「テスト用兵士を準備」もテストの札も出ない", r);
  }
  await p.goto(base + "/blank");
  const prod0 = prodOnly(await rawAll(p));
  // 2. テスト版を同じブラウザ・同じオリジンで開く：本番のデータを読まない・写さない
  await p.goto(base + "/test/");
  await p.waitForTimeout(800);
  let r = await p.evaluate(() => ({ badge: document.getElementById("testBadge")?.textContent, btn: !!document.getElementById("testPrepare"), soldiers: localStorage.getItem("worldDefense.soldiers.v1"), keys: WD_TEST_STORAGE.keys() }));
  check(r.badge.includes("テスト環境") && r.btn, "テスト版は左下に「🧪 テスト環境」、メニューに「🧪 テスト用兵士を準備」", r);
  check(r.soldiers === null || !r.soldiers.includes("本番太郎"), "テスト版は本番の兵士を読まない（自動で写さない）", r.soldiers && r.soldiers.slice(0, 80));
  check(JSON.stringify(prodOnly(await rawAll(p))) === JSON.stringify(prod0), "テスト版を開いても本番の保存データは変わらない");
  // 3. テスト用兵士を準備（確認つき）
  await p.evaluate(() => document.getElementById("testPrepare").click());
  await p.waitForLoadState("load");
  await p.waitForTimeout(900);
  r = await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")),
      w = JSON.parse(localStorage.getItem("worldDefense.warlords.v1"));
    return { list: s.soldiers.map((x) => [x.name, x.type, x.level, x.job || x.type, (x.insight && x.insight.equipped) || []]), items: (w.forge && w.forge.items) || [], backup: !!localStorage.getItem("testBackup") };
  });
  const L = Object.fromEntries(r.list.map((x) => [x[0], x]));
  check(r.list.length === 10 && L["試・新兵"][2] === 30 && L["試・弓兵"][2] === 60 && L["試・鉄砲"][2] === 60 && L["試・衛生"][2] === 100 && L["試・剣聖"][3] === "sword_saint" && L["試・剣聖"][2] === 150 && L["試・剣神"][2] === 1500 && L["試・弓聖"][3] === "bow_saint", "テスト用兵士10人（Lv30足軽・Lv60弓兵・Lv60鉄砲兵・Lv100衛生兵・Lv150剣聖・Lv300最上級職・Lv1500剣聖）", r.list);
  check(r.items.length > 0 && r.backup, "装備も用意し、準備の前のテスト用データの控えを残す", { items: r.items.length });
  check(JSON.stringify(prodOnly(await rawAll(p))) === JSON.stringify(prod0), "テスト用兵士を準備しても本番の保存データは変わらない（上書きしない）");
  // 4. iPhone縦（390）で戦場試練を最後まで操作する（画面のボタンとタップだけ）
  const tap = async (sel) => {
    await p.locator(sel).first().scrollIntoViewIfNeeded();
    await p.locator(sel).first().tap();
  };
  await tap("#dockMenu");
  await tap("#trialOpen");
  r = await p.evaluate(() => ({ rows: [...document.querySelectorAll("[data-trial-pick]")].map((b) => b.textContent), small: [...document.querySelectorAll("#trialBody button")].filter((b) => b.getBoundingClientRect().height < 40).length }));
  check(r.rows.length === 10 && r.small === 0, "戦場試練に10人が並び、ボタンは押しやすい高さ（40px以上）", r);
  for (const name of ["試・剣神", "試・槍将", "試・弓聖", "試・銃将", "試・医王"]) await p.locator("[data-trial-pick]", { hasText: name }).tap();
  await tap("[data-trial-go]");
  const box = await p.locator("#game").boundingBox();
  const tapMap = (x, y) => p.touchscreen.tap(box.x + (x / 960) * box.width, box.y + (y / 600) * box.height);
  // v108：配置の間は、カメラが関の手前の広場（光っている所）を映す。広場の中を2か所タップ
  await p.waitForTimeout(1500);
  await tapMap(430, 260);
  await tapMap(520, 360);
  r = await p.evaluate(() => document.getElementById("trialInfo").textContent);
  check(/あと\s*3人/.test(r), "戦場を指でタップして1人ずつ配置できる", r);
  await tap("#trialAuto");
  await tap("#trialGo");
  // 本物の時間で動かす（重くならないか：1コマの間隔を測る）
  const perf = await p.evaluate(
    () =>
      new Promise((res) => {
        const t = [];
        const f = (now) => {
          t.push(now);
          if (t.length < 150) requestAnimationFrame(f);
          else {
            const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
            res({ median: d[Math.floor(d.length / 2)], p90: d[Math.floor(d.length * 0.9)] });
          }
        };
        requestAnimationFrame(f);
      }),
  );
  check(perf.median < 34, "戦闘中の描画が極端に重くない（1コマの間隔の中央値 " + Math.round(perf.median) + "ms）", perf);
  r = await p.evaluate(() => ({ info: document.getElementById("trialInfo").textContent, stats: getComputedStyle(document.querySelector("header .stats")).display, overflow: document.documentElement.scrollWidth - innerWidth }));
  check(/\d+秒/.test(r.info) && r.stats === "none" && r.overflow <= 0, "戦闘が進み、城HPなどの表示は隠れ、横にはみ出さない", r);
  // v108：兵士の札を押して操作 → スティックを指で倒して動かす → 「全員自動」に戻す
  await p.waitForTimeout(1000);
  await p.locator("#trialUnits [data-trial-ctl]").first().tap();
  r = await p.evaluate(() => ({ info: document.getElementById("trialInfo").textContent, pad: document.getElementById("trialPad").offsetParent !== null }));
  check(r.info.includes("操作中") && r.pad, "兵士の札を押すと、その兵士を操作できる（スティックが出る）", r);
  const pad = await p.locator("#trialPad").boundingBox();
  const scroll0 = await p.evaluate(() => scrollY);
  await p.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await p.mouse.down();
  await p.mouse.move(pad.x + pad.width / 2 - 50, pad.y + pad.height / 2, { steps: 4 });
  await p.waitForTimeout(600);
  r = await p.evaluate(() => getComputedStyle(document.querySelector("#trialPad .trial-knob")).transform);
  await p.mouse.up();
  const scroll1 = await p.evaluate(() => scrollY);
  check(r !== "none" && scroll1 === scroll0, "スティックを指で倒せる（画面はスクロールしない）", { knob: r, scroll0, scroll1 });
  await tap("#trialAutoAll");
  r = await p.evaluate(() => document.getElementById("trialInfo").textContent);
  check(r.includes("全員自動"), "「🤖 全員自動」で操作を外せる", r);
  // 画面を横にして戻しても操作できる
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(500);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(500);
  r = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, bar: !document.getElementById("trialBar").hidden, retreat: document.getElementById("trialRetreat").offsetParent !== null }));
  check(r.overflow <= 0 && r.bar && r.retreat, "画面を回転して戻しても、はみ出さず撤退ボタンを押せる", r);
  // 撤退 → 結果
  await tap("#trialRetreat");
  await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ open: !document.getElementById("trialSheet").hidden, text: document.getElementById("trialBody").textContent, rows: document.querySelectorAll(".trial-unit").length }));
  check(r.open && r.text.includes("撤退") && r.rows === 5, "撤退すると結果の画面に兵士ごとの活躍が出る", r.text.slice(0, 60));
  // もう一度：勝つまで（時間を早送りできないので、本物の時間で最後まで待つのはしない。ここでは結果の画面から次へ進めること）
  await tap("[data-trial-again]");
  r = await p.evaluate(() => !document.getElementById("trialSheet").hidden && document.querySelectorAll("[data-trial-pick]").length === 10);
  check(r, "結果の画面から、もう一度兵士を選び直せる（進行不能にならない）");
  // v108.1 サバイバル：遊び方を切り替え、主人公（試・弓聖）を選んで始める → スティック → 撤退
  await tap('[data-trial-mode="survival"]');
  await p.locator("[data-trial-hero]", { hasText: "試・弓聖" }).tap();
  await tap("[data-trial-go]");
  await p.waitForTimeout(4000);
  r = await p.evaluate(() => ({ info: document.getElementById("trialInfo").textContent, units: document.getElementById("trialUnits").hidden, overflow: document.documentElement.scrollWidth - innerWidth }));
  check(/サバイバル/.test(r.info) && /試・弓聖/.test(r.info) && /仲間 \d\/4/.test(r.info) && r.units && r.overflow <= 0, "サバイバル：主人公（試・弓聖）1人で始められ、主人公の名前と仲間の人数が出る（HP・経験値・残り時間は戦場の上）", r);
  // レベルアップの選択画面が出ていたら、1つ目（仲間の加入）を指で押す
  if (await p.locator("#trialLevelUp:not([hidden])").count()) await tap('[data-trial-choose="0"]');
  const pad2 = await p.locator("#trialPad").boundingBox();
  await p.mouse.move(pad2.x + pad2.width / 2, pad2.y + pad2.height / 2);
  await p.mouse.down();
  await p.mouse.move(pad2.x + pad2.width / 2 + 50, pad2.y + pad2.height / 2, { steps: 4 });
  await p.waitForTimeout(500);
  r = await p.evaluate(() => getComputedStyle(document.querySelector("#trialPad .trial-knob")).transform);
  await p.mouse.up();
  check(r !== "none", "サバイバル：主人公をスティックで動かせる", r);
  if (await p.locator("#trialLevelUp:not([hidden])").count()) await tap('[data-trial-choose="0"]');
  await tap("#trialRetreat");
  await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ open: !document.getElementById("trialSheet").hidden, text: document.getElementById("trialTitle").textContent + document.getElementById("trialBody").textContent }));
  check(r.open && r.text.includes("サバイバル") && r.text.includes("撤退") && r.text.includes("👑"), "サバイバル：撤退すると結果の画面（主人公に👑）", r.text.slice(0, 60));
  await tap("#trialClose");
  // 5. 再読み込みしても本番のデータは壊れない
  await p.reload();
  await p.waitForTimeout(800);
  check(JSON.stringify(prodOnly(await rawAll(p))) === JSON.stringify(prod0), "テスト版を再読み込みしても本番の保存データは変わらない");
  // 6. テストデータを初期化：テストのキーだけ消える
  await p.evaluate(() => document.getElementById("testReset").click());
  await p.waitForLoadState("load");
  await p.waitForTimeout(800);
  const all = await rawAll(p);
  r = { prod: JSON.stringify(prodOnly(all)) === JSON.stringify(prod0), testSoldiers: all["wdtest:worldDefense.soldiers.v1"] || null };
  check(r.prod && (!r.testSoldiers || !r.testSoldiers.includes("試・")), "「テストデータを初期化」はテストのデータだけを消し、本番のデータは消さない", r);
  // 7. 本番の版に戻る：本番の兵士はそのまま
  await p.goto(base + "/");
  await p.waitForTimeout(800);
  r = await p.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.map((s) => s.name + ":" + s.level));
  check(r.join() === "本番太郎:77,本番花子:12", "本番の版では、本番の兵士がそのまま（テスト用兵士は混ざらない）", r);
  await ctx.close();

  // 8. テスト版の戦場試練で勝利・敗北（?debug で時間を早送り）。本番のデータは変わらない
  const c2 = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await c2.addInitScript(() => {
    requestAnimationFrame = () => 0;
  });
  const q = await c2.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  q.on("dialog", (d) => d.accept());
  await q.goto(base + "/test/?debug");
  await q.waitForFunction(() => window.WD_DEBUG && window.WD_TEST_TOOLS);
  await q.evaluate(() => {
    const S = WD_TEST_TOOLS.testSave();
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(S.soldiers));
    localStorage.setItem("worldDefense.warlords.v1", JSON.stringify(S.warlords));
  });
  await q.reload();
  await q.waitForFunction(() => window.WD_DEBUG);
  r = await q.evaluate(() => {
    const T = WD_DEBUG.trial,
      out = {};
    T.start([10, 9, 6, 7, 8]);
    T.auto();
    T.begin();
    for (let i = 0; i < 400 && T.on(); i++) WD_DEBUG.step(1);
    out.win = T.result();
    document.getElementById("trialSheet").hidden = true;
    T.start([1]);
    T.auto();
    T.begin();
    const L = T.live();
    for (let i = 0; i < 4000 && T.on(); i++) {
      for (const u of L.units) if (!u.dead) u.hp = Math.min(u.hp, 1);
      WD_DEBUG.step(0.05);
    }
    out.lose = T.result();
    out.alive = WD_DEBUG.state().soldiers.filter((s) => s.alive).length;
    out.fallen = WD_DEBUG.squadApi.soldierSave().fallen.length;
    return { win: out.win.result, skills: out.win.units.map((u) => Object.keys(u.skills).length), lose: out.lose.result, alive: out.alive, fallen: out.fallen };
  });
  check(r.win === "win" && r.skills.every((k) => k > 0) && r.lose === "lose" && r.alive === 10 && r.fallen === 0, "テスト用兵士で勝利・敗北を確かめられる（職業技・閃きも使う。仮の戦死で兵士は減らない）", r);
  await c2.close();

  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
