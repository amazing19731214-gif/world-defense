#!/usr/bin/env node
// 目標ウェーブ（20〜100）の確認：既定は20（今までどおり）、WAVE の表示から選ぶ、保存・「最初から」でも残る、
// 今より前は選べない、勝利のあとに延ばして続ける、AUTO は目標で止まる、21ウェーブ以降の敵、100の敵・報酬・勝利、画面
//   node tools/test-wave-goal.mjs
//   SCREENSHOTS=dir node tools/test-wave-goal.mjs … 画面写真も保存
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href + "?debug";
const shots = process.env.SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const GOALS = [20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100];
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
const SETKEY = "worldDefense.settings.v1";
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
// 以前の設定（目標ウェーブなし・AUTO ON）
await page.evaluate((k) => {
  localStorage.clear();
  localStorage.setItem(k, JSON.stringify({ version: 1, auto: true }));
}, SETKEY);
const reload = async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
};
await reload();
const waveText = () => page.textContent("#wave");
// 敵を出さずに n ウェーブ進める（AUTO ON でも OFF でも同じ）
const advance = (n) =>
  page.evaluate((n) => {
    for (let w = 0; w < n; w++) {
      if (!WD_DEBUG.state().playing) document.getElementById("start").click();
      WD_DEBUG.stopSpawning();
      WD_DEBUG.state().enemies.length = 0;
      WD_DEBUG.step(0.1);
    }
    const s = WD_DEBUG.state();
    return {
      wave: s.wave,
      over: s.over,
      playing: s.playing,
      msg: document.getElementById("msg").textContent,
    };
  }, n);

console.log("■ 既定は今までどおり20");
check("以前の設定でも目標は20（WAVE 0/20）", (await waveText()) === "WAVE 0/20", await waveText());
check("AUTO の設定はそのまま", /AUTO\s*ON/.test(await page.textContent("#autoWave")));

console.log("■ WAVE の表示から選ぶ");
await page.tap("#wave");
let r = await page.evaluate(() => ({
  open: !document.getElementById("goalSheet").hidden,
  goals: [...document.querySelectorAll("[data-goal]")].map((b) => b.dataset.goal + (b.disabled ? "x" : "")),
  pressed: document.querySelector('[data-goal][aria-pressed="true"]').dataset.goal,
  text: document.getElementById("goalBody").textContent,
}));
check("WAVE を押すと目標ウェーブの画面が開く", r.open && /何ウェーブまで戦うか/.test(r.text), r.text);
check(
  "従来の20〜40と50〜100から選べる（今は20）",
  r.goals.join() === GOALS.join() && r.pressed === "20",
  JSON.stringify(r),
);
const box = await page.evaluate(() => {
  const sh = document.querySelector("#goalSheet .sheet").getBoundingClientRect(),
    bs = [...document.querySelectorAll("#goalSheet button")].map((b) => b.getBoundingClientRect());
  return {
    inView: sh.top >= 0 && sh.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    fit: bs.every((b) => b.right <= innerWidth + 0.5),
    minH: Math.min(...bs.map((b) => b.height)),
  };
});
check(
  "375×667：画面に収まる・横にはみ出さない・ボタンは44px以上",
  box.inView && !box.hScroll && box.fit && box.minH >= 44,
  JSON.stringify(box),
);
if (shots) await page.screenshot({ path: path.join(shots, "g1-sheet.png") });
await page.tap('[data-goal="30"]');
check(
  "30を選ぶと WAVE 0/30・画面は閉じる",
  (await waveText()) === "WAVE 0/30" && (await page.isHidden("#goalSheet")),
  await waveText(),
);
check(
  "設定に保存",
  (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).waveGoal, SETKEY)) === 30,
);
await reload();
check("読み込み直しても目標は30", (await waveText()) === "WAVE 0/30", await waveText());
await page.keyboard.press("Tab").catch(() => {});

console.log("■ 進行と勝利");
r = await advance(20);
check(
  "目標30なら20ウェーブクリアで終わらない（AUTO で次へ進める）",
  r.wave === 20 && !r.over && /ウェーブ 20 クリア/.test(r.msg),
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  WD_DEBUG.step(6); // AUTO ON：5秒後に次のウェーブ
  return WD_DEBUG.state().wave;
});
check("21ウェーブ目に進む", r === 21, String(r));
// 21ウェーブ目以降の敵：今までの式のまま（体力 ×(1 + (ウェーブ−1)×0.19)）。同じ種類の敵の体力を比べる
const enemyMax = () =>
  page.evaluate(() => {
    for (let i = 0; i < 60 && !WD_DEBUG.state().enemies.some((e) => e.kind === "goblin"); i++)
      WD_DEBUG.step(0.25);
    const e = WD_DEBUG.state().enemies.find((e) => e.kind === "goblin");
    return e ? e.max : null;
  });
const hp21 = await enemyMax();
check("21ウェーブ目にも敵が出る", hp21 > 0, String(hp21));
await page.tap("#wave");
r = await page.evaluate(() =>
  [...document.querySelectorAll("[data-goal]")].map((b) => b.dataset.goal + (b.disabled ? "x" : "")).join(),
);
check("今より前の目標（20）は選べない", r === GOALS.map(n => n === 20 ? "20x" : n).join(), r);
await page.tap("#goalClose");
r = await advance(10);
check(
  "30ウェーブクリアで勝利（AUTO は止まる）",
  r.wave === 30 && r.over && /30ウェーブクリア！ 勝利！/.test(r.msg) && /目標を延ばす/.test(r.msg),
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  WD_DEBUG.step(8);
  return WD_DEBUG.state().wave;
});
check("勝利のあとは自動で始めない", r === 30, String(r));

console.log("■ 勝利のあとに目標を延ばして続ける");
await page.tap("#wave");
r = await page.evaluate(() => ({
  goals: [...document.querySelectorAll("[data-goal]")]
    .map((b) => b.dataset.goal + (b.disabled ? "x" : ""))
    .join(),
  text: document.getElementById("goalBody").textContent,
}));
check(
  "勝利のあと：35・40を選べて、続けて戦えると案内",
  r.goals === GOALS.map(n => n < 30 ? n + "x" : n).join() && /続けて戦えます/.test(r.text),
  JSON.stringify(r),
);
await page.tap('[data-goal="40"]');
r = await page.evaluate(() => ({
  over: WD_DEBUG.state().over,
  start: document.getElementById("start").disabled,
  msg: document.getElementById("msg").textContent,
}));
check(
  "40に延ばすと、そのまま続けられる（ウェーブ開始を押せる）",
  !r.over && !r.start && /続けて戦おう/.test(r.msg) && (await waveText()) === "WAVE 30/40",
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  document.getElementById("start").click();
  const S = WD_DEBUG.state();
  return { wave: S.wave, playing: S.playing };
});
check("WAVE 31 が始まる", r.wave === 31 && r.playing, JSON.stringify(r));
r = await advance(9); // 31〜39
await page.evaluate(() => document.getElementById("start").click()); // 40ウェーブ目は敵を出して確かめる
const hp40 = await enemyMax();
check(
  "40ウェーブ目の敵は今までの式どおり強くなる（21ウェーブ目の約1.75倍）",
  hp40 && Math.abs(hp40 / hp21 - (1 + 39 * 0.19) / (1 + 20 * 0.19)) < 0.001,
  hp21 + " → " + hp40,
);
r = await advance(1);
check(
  "40ウェーブクリアで勝利",
  r.wave === 40 && r.over && /40ウェーブクリア！ 勝利！/.test(r.msg),
  JSON.stringify(r),
);
check("40クリア後にも目標を延ばせる案内", /目標を延ばす/.test(r.msg), r.msg);

console.log("■ 100まで続ける");
await page.tap("#wave");
await page.tap('[data-goal="100"]');
check("40勝利から100へ延長できる", (await waveText()) === "WAVE 40/100" && !(await page.evaluate(() => WD_DEBUG.state().over)));
r = await advance(59);
check("99クリアでも勝利せず継続", r.wave === 99 && !r.over, JSON.stringify(r));
// 進行判定の試験用に途中の敵を除去する。実際の戦力による100ウェーブ攻略テストではない。
r = await page.evaluate(() => {
  WD_DEBUG.step(6);
  return { wave: WD_DEBUG.state().wave, playing: WD_DEBUG.state().playing };
});
check("AUTOで99から100へ進む", r.wave === 100 && r.playing, JSON.stringify(r));
r = await page.evaluate(() => {
  const D = WD_DEBUG, enemies = [], paths = new Set();
  // AUTO開始時に実際に出た敵も含め、100の全出現を記録する。
  const capture = () => {
    for (const e of D.state().enemies) {
      enemies.push({kind:e.kind, hp:e.max, speed:e.speed});
      paths.add(JSON.stringify(e.path));
    }
    D.state().enemies.length = 0;
  };
  const gold = D.state().gold, tickets = D.heroApi.save().tickets;
  capture();
  const random = Math.random;
  let seq = 0;
  Math.random = () => (++seq % 7) / 7;
  try {
    for (let i = 0; i < 1200 && D.state().playing; i++) {
      D.step(0.1);
      capture();
    }
  } finally { Math.random = random; }
  const s = D.state();
  return { count:enemies.length, paths:paths.size,
    bosses:enemies.filter(e => e.kind === "boss").length, last:enemies.at(-1),
    finite:enemies.every(e => Number.isFinite(e.hp) && e.hp > 0 && Number.isFinite(e.speed)),
    goblin:enemies.find(e => e.kind === "goblin"), gold:s.gold-gold,
    tickets:D.heroApi.save().tickets-tickets, wave:s.wave, over:s.over,
    msg:document.getElementById("msg").textContent };
});
check("100では308体が両分岐に出現し、最後の1体が大将", r.count === 308 && r.paths === 2 && r.bosses === 1 && r.last.kind === "boss", JSON.stringify(r));
check("100のHPは既存の式どおりで有限", r.finite && r.goblin && Math.abs(r.goblin.hp - 45 * (1 + 99 * 0.19)) < 0.001, JSON.stringify(r));
check("100クリアの基本軍資金850Gとガチャ券1枚", r.gold === 850 && r.tickets === 1, JSON.stringify(r));
check("100で勝利し、延長案内は出さない", r.wave === 100 && r.over && /100ウェーブクリア！ 勝利！/.test(r.msg) && !/目標を延ばす/.test(r.msg), JSON.stringify(r));
await page.evaluate(() => { WD_DEBUG.step(10); document.getElementById("start").click(); });
check("AUTOでも手動でも101へ進まない", (await waveText()) === "WAVE 100/100" && !(await page.evaluate(() => WD_DEBUG.state().playing)));
if (shots) await page.screenshot({ path: path.join(shots, "g2-victory100.png") });

console.log("■ 保存・最初から・敗北");
await page.evaluate(() => document.getElementById("reset").click());
check("最初からでも目標100を保持", (await waveText()) === "WAVE 0/100");
await reload();
check("読み込み直しでも目標100を保持", (await waveText()) === "WAVE 0/100");
await page.tap("#wave");
await page.tap('[data-goal="20"]');
check("従来の目標20に戻せる", (await waveText()) === "WAVE 0/20");
await page.evaluate(() => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  for(let i=0;i<20;i++) WD_DEBUG.addEnemy({d:1e6,hp:100});
  WD_DEBUG.step(0.1);
});
await page.tap("#wave");
check("敗北後は目標100に変えて続行できない", await page.locator('[data-goal="100"]').isDisabled());
await page.tap("#goalClose");

check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
