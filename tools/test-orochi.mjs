#!/usr/bin/env node
// 最終ボス「真・八岐大蛇」：最初からいつでも挑める・三種の神器で特殊な攻撃を1つずつ封じる
// （草薙の剣＝再生・八咫鏡＝幻惑・八尺瓊勾玉＝魂喰い）・倒すと完全クリア・三大裏ボス（終盤の解放）には数えない・画面
//   node tools/test-orochi.mjs
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
// 4部隊×10人（Lv3000）。攻城編成も4部隊
function makeSave(level) {
  const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [], heroId: 1 };
  const types = [["spearman"], ["ashigaru"], ["archer", "medic"], ["gunner"]];
  let id = 0;
  types.forEach((t, i) => {
    save.squads.push({ id: i + 1, type: t[0], slot: i });
    for (let k = 0; k < 10; k++)
      save.soldiers.push({
        id: ++id,
        type: t[1] && k >= 7 ? t[1] : t[0],
        squadId: i + 1,
        level,
        name: id === 1 ? "鬼若" : null,
      });
  });
  return save;
}
const units = [0, 1, 2, 3].map((u) => ({
  soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
  hero: null,
}));
async function newPage(treasures, conquest) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const seeds = {
    "worldDefense.soldiers.v1": JSON.stringify(makeSave(3000)),
    "worldDefense.siege.v1": JSON.stringify({ version: 1, units }),
    "worldDefense.warlords.v1": JSON.stringify({
      version: 1,
      owned: {},
      tickets: 0,
      history: [],
      forge: { items: [], seq: 0, treasures },
    }),
    "worldDefense.conquest.v1": JSON.stringify(conquest || { version: 2, castles: {} }),
  };
  await context.addInitScript((seeds) => {
    if (location.protocol !== "http:" || window.name === "seeded") return;
    window.name = "seeded";
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const start = (page) =>
  page.evaluate(() => {
    const a = WD_DEBUG.squadApi;
    return a.setBossTarget("orochi") || a.startBattle();
  });

console.log("■ 神器なし：いつでも挑めるが、とても強い");
let { page, errors, context } = await newPage({});
let r = await start(page);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  return { boss: B && B.boss, heads: e && e.heads.length, hp: e && e.max, name: B && B.castleName };
});
check(
  "秘境を見つけていなくても、最初から挑める（八つの頭・HP 300万）",
  r.boss === "orochi" && r.heads === 8 && r.hp === 3000000,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  e.hp = e.max * 0.5;
  e.cd = 99; // 頭の攻撃は止めておく
  const h0 = e.hp;
  WD_DEBUG.step(1);
  return { up: e.hp - h0, soulEat: a.battle().soulEat };
});
check("草薙の剣がないと、強く再生する（1秒で数万）", r.up > 10000, JSON.stringify(r));
check("八尺瓊勾玉がないと、魂喰い（回復が効かない）", r.soulEat === true, JSON.stringify(r));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  e.illusionLeft = 0.05;
  B.warn = null;
  WD_DEBUG.step(0.2);
  const warn = B.warn && B.warn.text;
  WD_DEBUG.step(2.2);
  return { warn, confused: B.groups.filter((g) => g.confused > 0).length };
});
check(
  "八咫鏡がないと、予兆のあと部隊が幻惑される（攻撃が当たらない）",
  /幻惑の予兆/.test(r.warn || "") && r.confused >= 1,
  JSON.stringify(r),
);
r = await page
  .evaluate(() => {
    const a = WD_DEBUG.squadApi,
      B = a.battle(),
      e = a.bossOf();
      const hp0 = B.groups.map((g) => g.list.reduce((n, s) => n + s.hp, 0));
    e.soulLeft = 0.05;
    WD_DEBUG.step(0.1);
    const hp1 = B.groups.map((g) => g.list.reduce((n, s) => n + s.hp, 0));
    return { lost: hp0.map((v, i) => v - hp1[i]) };
  })
  .catch((err) => ({ err: String(err) }));
check("魂喰い：出陣中の全部隊の魂が吸われる", r.lost && r.lost.filter((d) => d > 0).length >= 1, JSON.stringify(r));
check("（エラーなし）", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 三種の神器がそろうと");
({ page, errors, context } = await newPage({ kusanagi: true, yata: true, magatama: true }));
await start(page);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  e.hp = e.max * 0.5;
  e.cd = 99;
  const h0 = e.hp;
  for (const g of B.groups) g.x = -9999; // 部隊は攻撃しない（再生だけを見る）
  WD_DEBUG.step(0.5);
  const regen = e.hp - h0;
  e.illusionLeft = 0.05;
  B.warn = null;
  WD_DEBUG.step(2.5);
  return {
    regen,
    soulEat: B.soulEat,
    confused: B.groups.filter((g) => g.confused > 0).length,
    msg: document.getElementById("msg").textContent,
  };
});
check("草薙の剣：再生しない", r.regen <= 0, JSON.stringify(r));
check(
  "八咫鏡：幻惑を映し返す（部隊は惑わない）",
  r.confused === 0 && /八咫鏡が幻惑を映し返した/.test(r.msg),
  JSON.stringify(r),
);
check("八尺瓊勾玉：魂喰いが効かない", r.soulEat === false, JSON.stringify(r));

console.log("■ 倒すと完全クリア");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    H = WD_DEBUG.heroApi;
  const t0 = H.save().tickets;
  a.bossOf().hp = 1;
  for (const g of a.battle().groups) g.x = a.bossOf().x - 60;
  for (let i = 0; i < 800 && a.battle(); i++) WD_DEBUG.step(0.05);
  return {
    done: !a.battle(),
    title: document.getElementById("battleTitle").textContent,
    body: document.getElementById("battleBody").textContent,
    tickets: H.save().tickets - t0,
    reward: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge.bossRewards,
    wins: JSON.parse(localStorage.getItem("worldDefense.conquest.v1")).bosses.orochi.wins,
  };
});
check(
  "倒すと勝利・結果画面に「完全クリア」と称号",
  r.done && /真・八岐大蛇/.test(r.title) && /完全クリア/.test(r.body) && /大蛇討伐者/.test(r.body),
  r.body.slice(0, 200),
);
check(
  "初めて倒すとガチャ券 +10・討伐の記録を保存",
  r.tickets === 10 && r.reward && r.reward.orochi === true && r.wins === 1,
  JSON.stringify(r),
);
r = await page.evaluate(() => WD_DEBUG.legendApi.endgameOn());
check("真・八岐大蛇は三大裏ボスに数えない（倒しただけでは終盤は解放されない）", r === false, String(r));
await page.evaluate(() => (document.getElementById("battleSheet").hidden = true));
await page.tap("#mapOpen");
await page.tap('[data-map-chapter="japan"]');
await page.tap('[data-map-tab="secret"]');
const text = await page.textContent("#mapBody");
r = await page.evaluate(() => ({ h: document.documentElement.scrollWidth > innerWidth }));
check(
  "🗻 秘境タブの一番上に真・八岐大蛇（神器の有無・完全クリア・討伐の記録）",
  /黄泉の最深部：真・八岐大蛇/.test(text) &&
    /✅草薙の剣/.test(text) &&
    /完全クリア/.test(text) &&
    /討伐 1回/.test(text) &&
    !r.h,
  text.slice(0, 300),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 三大裏ボスを倒すと終盤の解放（真・八岐大蛇は要らない）");
const won = { attempts: 1, wins: 1, first: 1, best: 60 };
({ page, errors, context } = await newPage(
  {},
  { version: 2, castles: {}, tenka: true, bosses: { hiei: won, yomi: won, fuji: won } },
));
r = await page.evaluate(() => WD_DEBUG.legendApi.endgameOn());
check("天下統一＋三大裏ボスで終盤の解放（今までどおり）", r === true, String(r));
await context.close();

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
