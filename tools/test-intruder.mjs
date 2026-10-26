#!/usr/bin/env node
// 乱入する裏ボスと八玉：ウェーブ50から・ごく低い確率・倒すと八玉（持っていない種類が出やすい）・
// 城にたどり着くとハート -3・怨念の波動・読み込み直しても戦いは避けられない・修練場では出ない・画面
//   node tools/test-intruder.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(root, "index.html")));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = "http://127.0.0.1:" + server.address().port + "/index.html?debug";

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
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
// 目標ウェーブ100・以前の保存データ（八玉なし）から始める
await context.addInitScript(() => {
  if (location.protocol !== "http:" || window.name === "seeded") return;
  window.name = "seeded";
  localStorage.clear();
  localStorage.setItem(
    "worldDefense.settings.v1",
    JSON.stringify({ version: 1, auto: false, waveGoal: 100 }),
  );
  localStorage.setItem(
    "worldDefense.warlords.v1",
    JSON.stringify({
      version: 1,
      owned: {},
      tickets: 0,
      history: [],
      forge: { items: [], seq: 0, koban: 100 },
    }),
  );
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const ev = (fn, arg) => page.evaluate(fn, arg);
const reload = async () => {
  await page.reload();
  await page.waitForFunction(() => window.WD_DEBUG);
};

console.log("■ 設定");
let r = await ev(() => {
  const I = WD_DEBUG.intruderApi;
  return {
    min: I.INTRUDER.minWave,
    chance: I.INTRUDER.chance,
    heart: I.INTRUDER.heart,
    gems: I.GEMS.map((g) => g.name).join(""),
    have: I.gems(),
  };
});
check(
  "ウェーブ50から・1ウェーブ2%・城にたどり着くとハート -3",
  r.min === 50 && r.chance === 0.02 && r.heart === 3,
  JSON.stringify(r),
);
check(
  "八玉は仁義礼智忠信孝悌の8種類・以前の保存データは0個から",
  r.gems === "仁義礼智忠信孝悌" && JSON.stringify(r.have) === "{}",
  JSON.stringify(r),
);

console.log("■ ウェーブ49までは乱入しない");
r = await ev(() => {
  WD_DEBUG.setGold(999999);
  WD_DEBUG.squadApi.hireSquad("spearman", 650, 300);
  WD_DEBUG.intruderApi.setRng(() => 0);
  const plans = [];
  for (let w = 1; w <= 49; w++) {
    document.getElementById("start").click();
    if (WD_DEBUG.intruderApi.plan()) plans.push(WD_DEBUG.state().wave);
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  }
  return { plans, wave: WD_DEBUG.state().wave };
});
check("抽選に当たってもウェーブ49までは乱入しない", r.plans.length === 0 && r.wave === 49, JSON.stringify(r));

console.log("■ ウェーブ50：乱入して、すぐ保存");
r = await ev(() => {
  const S = WD_DEBUG.state;
  WD_DEBUG.intruderApi.setRng(() => 0.019); // 2% 未満
  WD_DEBUG.rareApi.setRng(() => 1);
  document.getElementById("start").click();
  const plan = WD_DEBUG.intruderApi.plan();
  WD_DEBUG.intruderApi.setRng(() => 0.5);
  for (let i = 0; i < 400 && !S().enemies.some((e) => e.intruder); i++) {
    WD_DEBUG.step(0.1);
    const E = S().enemies; // ふつうの敵は消しておく（城まで来てゲームオーバーにならないように）
    for (let j = E.length - 1; j >= 0; j--) if (!E[j].intruder) E.splice(j, 1);
  }
  const e = S().enemies.find((x) => x.intruder);
  return {
    plan: plan && plan.wave,
    e: !!e,
    boss: e && e.kind,
    hpRatio: e && e.max,
    toast: document.getElementById("toast").textContent,
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).defense.intruder,
  };
});
check(
  "ウェーブ50で抽選に当たると、ウェーブの途中に乱入する・知らせる",
  r.plan === 50 && r.e && /裏ボス「怨霊・玉梓」が乱入/.test(r.toast),
  JSON.stringify(r),
);
check("乱入したことを、すぐに保存する", r.saved && r.saved.wave === 50, JSON.stringify(r.saved));

console.log("■ 読み込み直しても、戦いは避けられない");
await reload();
r = await ev(() => ({
  wave: WD_DEBUG.state().wave,
  pending: WD_DEBUG.intruderApi.pending(),
  status: document.getElementById("checkpointStatus").textContent,
}));
check(
  "読み込み直すとウェーブ49の準備に戻り、次のウェーブで必ず乱入すると知らせる",
  r.wave === 49 && r.pending === 50 && /必ず乱入/.test(r.status),
  JSON.stringify(r),
);
r = await ev(() => {
  const S = WD_DEBUG.state;
  WD_DEBUG.intruderApi.setRng(() => 1); // 抽選では乱入しない値でも
  WD_DEBUG.rareApi.setRng(() => 1);
  document.getElementById("start").click();
  const plan = WD_DEBUG.intruderApi.plan();
  for (let i = 0; i < 400 && !S().enemies.some((e) => e.intruder); i++) {
    WD_DEBUG.step(0.1);
    const E = S().enemies; // ふつうの敵は消しておく（城まで来てゲームオーバーにならないように）
    for (let j = E.length - 1; j >= 0; j--) if (!E[j].intruder) E.splice(j, 1);
  }
  return { plan: plan && plan.forced, e: S().enemies.some((x) => x.intruder) };
});
check("同じウェーブ50で、必ず同じ裏ボスが乱入する", r.plan === true && r.e, JSON.stringify(r));

console.log("■ 怨念の波動");
r = await ev(() => {
  const S = WD_DEBUG.state,
    e = S().enemies.find((x) => x.intruder),
    q = S().squads[0],
    roster = () => WD_DEBUG.squadApi.roster(q);
  e.x = q.x;
  e.y = q.y;
  e.speed = 0;
  e.pulseClock = 6.6; // 予兆の時間
  WD_DEBUG.step(0.1);
  const warn = e.pulseWarn;
  for (const s of roster()) s.hp = 1e9; // 倒れないように
  const before = roster().reduce((n, s) => n + s.hp, 0);
  e.pulseClock = 7.95;
  WD_DEBUG.step(0.1);
  return { warn, hit: before - roster().reduce((n, s) => n + s.hp, 0) > 0, after: e.pulseClock };
});
check("8秒ごとに、予兆の輪のあと周りの部隊を攻撃する", r.warn && r.hit && r.after < 1, JSON.stringify(r));

console.log("■ 倒すと八玉");
r = await ev(() => {
  const S = WD_DEBUG.state,
    H = WD_DEBUG.heroApi,
    e = S().enemies.find((x) => x.intruder);
  const tickets = H.save().tickets;
  WD_DEBUG.intruderApi.setRng(() => 0);
  e.hp = 0;
  e.armor = 0;
  WD_DEBUG.step(0.1);
  WD_DEBUG.intruderApi.setRng(() => 1);
  const out = {
    gone: !S().enemies.includes(e),
    gems: WD_DEBUG.intruderApi.gems(),
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")),
    tickets: H.save().tickets - tickets,
    toast: document.getElementById("toast").textContent,
  };
  out.savedGems = out.saved.forge.gems;
  out.savedIntruder = out.saved.defense.intruder;
  delete out.saved;
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  WD_DEBUG.step(0.2);
  return out;
});
check(
  "倒すと八玉を1つ（保存される）・知らせる",
  r.gone &&
    JSON.stringify(r.gems) === '{"jin":1}' &&
    JSON.stringify(r.savedGems) === '{"jin":1}' &&
    /八玉「仁」/.test(r.toast),
  JSON.stringify(r),
);
check(
  "決着がつくと、乱入の印は消える・大将のガチャ券はもらえない（報酬は八玉だけ）",
  r.savedIntruder === null && r.tickets === 0,
  JSON.stringify(r),
);

console.log("■ 持っていない種類の玉が出やすい");
r = await ev(() => {
  const I = WD_DEBUG.intruderApi,
    n = {};
  I.setRng(Math.random);
  for (let i = 0; i < 22000; i++) {
    const g = I.rollGem();
    n[g.k] = (n[g.k] || 0) + 1;
  }
  I.setRng(() => 1);
  return n;
});
check(
  "「仁」を持っているとき、「仁」は約 1/22・ほかの種類は約 3/22 ずつ",
  r.jin > 600 &&
    r.jin < 1400 &&
    ["gi", "rei", "chi", "chu", "shin", "ko", "tei"].every((k) => r[k] > 2600 && r[k] < 3400),
  JSON.stringify(r),
);

console.log("■ 城にたどり着かれると");
r = await ev(() => {
  const S = WD_DEBUG.state;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const hp0 = S().hp;
  const e = WD_DEBUG.intruderApi.spawnIntruder();
  e.d = 99999;
  WD_DEBUG.step(0.2);
  return {
    hp: hp0 - S().hp,
    gone: !S().enemies.includes(e),
    intruder: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).defense.intruder,
    gems: WD_DEBUG.intruderApi.gems(),
  };
});
check(
  "ハートが3減る・玉はもらえない・乱入の印は消える",
  r.hp === 3 && r.gone && r.intruder === null && JSON.stringify(r.gems) === '{"jin":1}',
  JSON.stringify(r),
);
await reload();
r = await ev(() => WD_DEBUG.intruderApi.pending());
check("決着がついたあとは、読み込み直しても乱入しない", r === null, String(r));

console.log("■ 修練場・最初から");
r = await ev(() => {
  const T = WD_DEBUG.trainingApi;
  WD_DEBUG.intruderApi.setRng(() => 0);
  T.startTraining("beginner");
  document.getElementById("start").click();
  const p = WD_DEBUG.intruderApi.plan();
  T.endTraining("retreat");
  WD_DEBUG.intruderApi.setRng(() => 1);
  document.getElementById("battleSheet").hidden = true; // 修練場の結果画面を閉じる
  return p;
});
check("修練場では乱入しない", r === null, JSON.stringify(r));

console.log("■ 画面（375×667）");
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="gems"]');
const text = await page.textContent("#gearBody");
r = await ev(() => ({
  gems: [...document.querySelectorAll(".gem")].map((g) => g.textContent.replace(/\s/g, "")),
  h: document.documentElement.scrollWidth > innerWidth,
  tabs: [...document.querySelectorAll("[data-gear-tab]")].every(
    (b) => b.getBoundingClientRect().right <= innerWidth + 0.5,
  ),
}));
check(
  "📿 八玉タブ：集めた種類（1/8）・8つの玉（持っている数／未所持）・入手の説明",
  /集めた種類 1\/8/.test(text) &&
    r.gems.length === 8 &&
    r.gems[0] === "仁×1" &&
    r.gems[1] === "義未所持" &&
    /乱入する裏ボス/.test(text),
  JSON.stringify(r),
);
check("4つのタブが収まる・横にはみ出さない", r.tabs && !r.h, JSON.stringify(r));
await page.tap("#gearClose");
await page.evaluate(() => {
  WD_DEBUG.state().enemies.length = 0;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.intruderApi.spawnIntruder();
  WD_DEBUG.step(1);
});
check("裏ボスを描いてもエラーにならない", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
