#!/usr/bin/env node
// 乱入する特別な敵：ラッキー足軽（倒すと出撃中の兵士に大量の経験値）・黄金足軽（倒すと小判）。
// 出る条件と確率・硬さ（1回で 1）・足止めされない／攻撃しない・逃げる（ハートは減らない）・報酬・修練場・保存・画面
//   node tools/test-rare-monsters.mjs
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
// http で開く（file:// では読み込み直しのときにまれに保存データが見えなくなることがあった）
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
await context.addInitScript(() => {
  if (location.protocol !== "http:" || window.name === "seeded") return;
  window.name = "seeded";
  localStorage.clear();
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const ev = (fn, arg) => page.evaluate(fn, arg);
// ウェーブを1つ進める（敵を消してクリア）
const clearWave = () =>
  ev(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.2);
    return WD_DEBUG.state().wave;
  });

console.log("■ 設定");
let r = await ev(() => {
  const R = WD_DEBUG.rareApi.RARE;
  return {
    l: R.lucky.chance,
    g: R.gold.chance,
    min: R.minWave,
    hit: R.hitDamage,
    k1: R.gold.koban(1),
    k999: R.gold.koban(999),
  };
});
check(
  "ラッキー足軽 4%・黄金足軽 3%・ウェーブ3から・1回の攻撃で 1",
  r.l === 0.04 && r.g === 0.03 && r.min === 3 && r.hit === 1,
  JSON.stringify(r),
);
check(
  "黄金足軽の小判はウェーブで増え、上限 5,000両（ウェーブ1000でも）",
  r.k1 === 305 && r.k999 === 5000,
  JSON.stringify(r),
);

console.log("■ 出るかどうかの抽選");
r = await ev(() => {
  WD_DEBUG.setGold(99999);
  WD_DEBUG.squadApi.hireSquad("spearman", 650, 300);
  WD_DEBUG.rareApi.setRng(() => 0);
  return null;
});
const plans = [];
for (let w = 1; w <= 3; w++) {
  plans.push(
    await ev(() => {
      document.getElementById("start").click();
      const p = WD_DEBUG.rareApi.plan();
      WD_DEBUG.stopSpawning();
      WD_DEBUG.state().enemies.length = 0;
      WD_DEBUG.step(0.2);
      return p && p.kind;
    }),
  );
}
check(
  "ウェーブ1・2では出ない、ウェーブ3から出る",
  plans[0] === undefined || (plans[0] === null && plans[1] === null),
  JSON.stringify(plans),
);
check("（ウェーブ3：抽選に当たるとラッキー足軽）", plans[2] === "lucky", JSON.stringify(plans));
r = await ev(() => {
  const out = [];
  for (const v of [0.039, 0.05, 0.069, 0.07, 0.5]) {
    WD_DEBUG.rareApi.setRng(() => v);
    document.getElementById("start").click();
    const p = WD_DEBUG.rareApi.plan();
    out.push(p ? p.kind : "none");
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.2);
  }
  WD_DEBUG.rareApi.setRng(() => 1);
  return out.join();
});
check("4%未満はラッキー・4〜7%は黄金・それ以上は出ない", r === "lucky,gold,gold,none,none", r);

console.log("■ ウェーブの途中に1体だけ現れる");
r = await ev(() => {
  WD_DEBUG.rareApi.setRng(() => 0);
  document.getElementById("start").click();
  const p = WD_DEBUG.rareApi.plan();
  WD_DEBUG.step(12);
  const rare = WD_DEBUG.state().enemies.filter((e) => e.rare);
  const out = {
    at: p && p.at,
    n: rare.length,
    msg: document.getElementById("msg").textContent,
    toast: document.getElementById("toast").textContent,
  };
  WD_DEBUG.rareApi.setRng(() => 1);
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.2);
  return out;
});
check(
  "決めた順番の敵のあとに1体だけ現れる・知らせる",
  r.n === 1 && /ラッキー足軽が現れた/.test(r.toast),
  JSON.stringify(r),
);

console.log("■ とても硬い・足止めされない・攻撃しない・逃げる");
r = await ev(() => {
  const S = WD_DEBUG.state;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const hp0 = S().hp;
  const e = WD_DEBUG.rareApi.spawnRare("lucky");
  const dealt = WD_DEBUG.rareApi.hit(e, 99999);
  const after = e.hp;
  const q = S().squads[0];
  const hpSquad = WD_DEBUG.squadApi.roster(q).reduce((n, s) => n + s.hp, 0);
  // 部隊の前を通っても足止めされず、攻撃もしない
  let blocked = false;
  for (let i = 0; i < 60 && !e.gone; i++) {
    WD_DEBUG.step(0.1);
    if (e.blockedBy) blocked = true;
  }
  return {
    after,
    max: e.max,
    blocked,
    hpSquadSame: WD_DEBUG.squadApi.roster(q).reduce((n, s) => n + s.hp, 0) >= hpSquad - 1e-6,
    gone: e.gone,
    left: e.rareLeft,
    hp: S().hp - hp0,
  };
});
check("どんなに強い攻撃でも 1 しか減らない（12 → 11）", r.after === 11 && r.max === 12, JSON.stringify(r));
check("部隊に足止めされない・兵士を攻撃しない", !r.blocked && r.hpSquadSame, JSON.stringify(r));
r = await ev(() => {
  const S = WD_DEBUG.state;
  let e = S().enemies.find((x) => x.rare);
  if (!e) e = WD_DEBUG.rareApi.spawnRare("lucky");
  const hp0 = S().hp;
  e.stun = 99; // 止めていても時間切れで逃げる
  WD_DEBUG.step(10);
  const out = {
    gone: !S().enemies.includes(e),
    hp: S().hp - hp0,
    msg: document.getElementById("toast").textContent,
    playing: S().playing,
  };
  return out;
});
check(
  "時間切れで逃げる（止めていても）・城のハートは減らない",
  r.gone && r.hp === 0 && /逃げてしまった/.test(r.msg),
  JSON.stringify(r),
);
check("逃げたらウェーブは終わる（特別な敵を待ってから）", !r.playing, JSON.stringify(r));
r = await ev(() => {
  const S = WD_DEBUG.state;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const hp0 = S().hp;
  const e = WD_DEBUG.rareApi.spawnRare("gold");
  e.rareLeft = 999;
  e.d = 99999; // 城まで走り抜けた
  WD_DEBUG.step(0.2);
  return { gone: !S().enemies.includes(e), hp: S().hp - hp0, playing: S().playing };
});
check(
  "城まで走り抜けても逃げるだけ（ハートは減らない）",
  r.gone && r.hp === 0 && !r.playing,
  JSON.stringify(r),
);

console.log("■ ラッキー足軽を倒す：出撃中の兵士みんなに大量の経験値");
r = await ev(() => {
  const S = WD_DEBUG.state,
    a = WD_DEBUG.squadApi,
    C = WD_DEBUG.unitConfig.SQUAD_RULES;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const list = a.roster(S().squads[0]);
  for (const s of list) {
    s.level = 40;
    s.xp = 0;
  }
  const need = C.xpToLevel(40);
  const e = WD_DEBUG.rareApi.spawnRare("lucky");
  for (let i = 0; i < 12; i++) WD_DEBUG.rareApi.hit(e, 50);
  WD_DEBUG.step(0.1);
  const got = list.map((s) => (s.level - 40) * need + s.xp);
  const out = {
    need,
    got,
    toast: document.getElementById("toast").textContent,
    gone: !S().enemies.includes(e),
  };
  WD_DEBUG.step(0.3);
  return out;
});
check(
  "12回で倒せて、出撃中の兵士それぞれが「次のレベルまでの経験値」の半分以上をもらう（ウェーブの上限の対象外）",
  r.gone && r.got.length === 10 && r.got.every((x) => x >= Math.round(r.need * 0.5)),
  JSON.stringify(r),
);
check("倒したことを知らせる", /ラッキー足軽を倒した/.test(r.toast), r.toast);

console.log("■ 黄金足軽を倒す：小判（保存される）");
r = await ev(() => {
  const S = WD_DEBUG.state,
    F = WD_DEBUG.forgeApi;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const k0 = F.koban(),
    w = S().wave;
  WD_DEBUG.rareApi.setRng(() => 0.5); // ±20% の真ん中
  const e = WD_DEBUG.rareApi.spawnRare("gold");
  for (let i = 0; i < 20; i++) WD_DEBUG.rareApi.hit(e, 50);
  WD_DEBUG.step(0.1);
  WD_DEBUG.rareApi.setRng(() => 1);
  const out = {
    d: F.koban() - k0,
    want: WD_DEBUG.rareApi.RARE.gold.koban(w),
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge.koban,
    koban: F.koban(),
    toast: document.getElementById("toast").textContent,
  };
  WD_DEBUG.step(0.3);
  return out;
});
check(
  "20回で倒せて、小判が増える・すぐ保存される",
  r.d === r.want && r.saved === r.koban && /小判 \+/.test(r.toast),
  JSON.stringify(r),
);

console.log("■ 修練場でも出る");
r = await ev(() => {
  const T = WD_DEBUG.trainingApi;
  T.startTraining("beginner");
  WD_DEBUG.rareApi.setRng(() => 0.05);
  document.getElementById("start").click();
  const p = WD_DEBUG.rareApi.plan();
  WD_DEBUG.rareApi.setRng(() => 1);
  T.endTraining("retreat");
  return p && p.kind;
});
check("修練場の1ウェーブ目から出る（黄金足軽）", r === "gold", String(r));

console.log("■ 再読み込み・画面");
r = await ev(() => {
  const S = WD_DEBUG.state;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const e = WD_DEBUG.rareApi.spawnRare("gold");
  WD_DEBUG.step(0.5);
  return S().wave;
});
await page.screenshot({ path: "/dev/null" }).catch(() => {});
const midWave = r;
await page.reload();
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(() => ({
  wave: WD_DEBUG.state().wave,
  rare: WD_DEBUG.state().enemies.some((e) => e.rare),
  playing: WD_DEBUG.state().playing,
}));
check(
  "ウェーブの途中で読み込み直すと、ウェーブの始めに戻る（特別な敵は残らない）",
  r.wave === midWave - 1 && !r.rare && !r.playing,
  JSON.stringify(r),
);
r = await ev(() => {
  WD_DEBUG.rareApi.setRng(() => 1);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  const e = WD_DEBUG.rareApi.spawnRare("lucky");
  WD_DEBUG.step(1);
  return { h: document.documentElement.scrollWidth > innerWidth };
});
check("描いてもエラーにならない・375×667で横にはみ出さない", !r.h && errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
