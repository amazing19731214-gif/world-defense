#!/usr/bin/env node
import { openSiegeFormation } from './ui-test-utils.mjs';
// 防衛戦と攻城戦で同じ第一〜第八部隊（10人まで）を使う動作確認。古い保存データ（5人×8部隊）の引き継ぎ・攻城編成（武将）・保存
//   node tools/test-formation.mjs
//   SCREENSHOTS=dir node tools/test-formation.mjs … 画面写真も保存
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
const WKEY = "worldDefense.warlords.v1",
  SKEY = "worldDefense.soldiers.v1",
  FKEY = "worldDefense.siege.v1";

// 以前の形式の保存データ：兵士 40人（8部隊×5人・部隊の枠なし）。名前付き・高レベルの兵士も混ぜる
// 兵種：#1 槍兵・#2 弓兵・#3 足軽・#4 槍兵・#5 弓兵・#6 足軽・#7 槍兵・#8 弓兵
const types = ["ashigaru", "spearman", "archer"];
const roster = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
for (let q = 1; q <= 8; q++) {
  const type = types[q % 3];
  roster.squads.push({ id: q, type });
  for (let k = 0; k < 5; k++) {
    const id = (q - 1) * 5 + k + 1;
    roster.soldiers.push({
      id,
      type,
      squadId: q,
      level: 1 + ((id * 7) % 25),
      xp: 0,
      skills: id % 4 === 0 ? ["combo"] : [],
      name: id === 17 ? "鬼若" : id === 33 ? "与一" : null,
      battles: id,
      kills: id % 9,
      wavesSurvived: id,
      lastSurvivor: false,
      history: [],
    });
  }
}
// 名前は Lv10 以上だけ有効
for (const v of roster.soldiers) if (v.name) v.level = Math.max(v.level, 12);
const heroes = JSON.stringify({
  version: 1,
  owned: { yukimura: 1, kanbei: 1, kenshin: 1 },
  tickets: 0,
  history: [],
  injured: { kenshin: 2 },
});

async function newContext(seeds) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  // 保存データは最初に一度だけ入れて読み込み直す（再読み込みのたびに入れ直さない）。
  // 読み込みのたびに保存データを触る準備スクリプトは、直前の保存と重なると古い内容を読むことがあるため使わない
  if (seeds && Object.keys(seeds).length) {
    await page.evaluate((seeds) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
    }, seeds);
    await page.goto(url);
    await page.waitForFunction(() => window.WD_DEBUG);
  }
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const stored = (page, key) => ev(page, (k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const units = (page) => ev(page, () => JSON.parse(JSON.stringify(WD_DEBUG.squadApi.siege())));

const squadsNow = (page) =>
  ev(page, () =>
    WD_DEBUG.state().squads.map((q) => ({
      id: q.id,
      type: q.type,
      slot: q.slot,
      n: WD_DEBUG.squadApi.roster(q).length,
      name: WD_DEBUG.squadApi.squadName(q),
    })),
  );

let { page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster), [WKEY]: heroes });

console.log("■ 以前の保存データ（5人×8部隊）を10人の部隊にまとめる");
let q = await squadsNow(page);
check(
  "同じ兵種の部隊を前から10人ずつ詰める（槍兵15人 → 10人＋5人）",
  q.map((x) => x.id + ":" + x.n).join() === "1:10,2:10,3:10,4:5,5:5",
  JSON.stringify(q),
);
check(
  "兵士は1人も失わない（40人・名前付きも残る）",
  (await ev(page, () => WD_DEBUG.state().soldiers.filter((s) => s.alive).length)) === 40 &&
    (await ev(page, () =>
      ["鬼若", "与一"].every((n) => WD_DEBUG.state().soldiers.some((s) => s.name === n)),
    )),
);
check(
  "第一〜第八部隊の枠を前から割り当てる",
  q.map((x) => x.slot).join() === "0,1,2,3,4" &&
    q[0].name === "第一部隊" &&
    q[3].name === "第四部隊",
  JSON.stringify(q.map((x) => x.name)),
);
check("第五部隊の兵士も通常の枠に残る", q[4].name === "第五部隊", q[4].name);
let r = await ev(page, () => {
  WD_DEBUG.setGold(9999);
  return WD_DEBUG.squadApi.hireSquad("ashigaru", 650, 300);
});
check("8枠までは部隊を追加できる（戦闘用fixture）", r !== null);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check("再読み込みしても同じまとめ方になる", JSON.stringify(await squadsNow(page)) === JSON.stringify(q));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  const err = a.disbandSquad(s.squads.find((x) => x.id === 4)),
    now = WD_DEBUG.state().squads; // 解散すると部隊の配列が作り直される
  return { err, list: now.map((x) => x.id + ":" + x.slot), name: a.squadName(now[3]) };
});
check(
  "部隊を解散すると、第五部隊の保存済み枠を維持する",
  !r.err && r.list.join() === "1:0,2:1,3:2,5:4" && r.name === "第五部隊",
  JSON.stringify(r),
);
check(
  "枠を保存",
  (await stored(page, SKEY)).squads.map((x) => x.id + ":" + x.slot).join() === "1:0,2:1,3:2,5:4",
  JSON.stringify((await stored(page, SKEY)).squads),
);

console.log("■ 攻城編成の画面（兵士は防衛の部隊のまま）");
check("メインに攻城編成は置かず、共通編成に攻城用武将タブ", await page.locator("main #siege").count()===0 && /攻城用武将/.test(await page.textContent("#siege")));
await openSiegeFormation(page);
check("攻城編成の画面を開く", await page.isVisible("#siegeSheet"));
let tabs = await page.$$eval("#siegeTabs button", (bs) => bs.map((b) => b.textContent));
check(
  "第一〜第八部隊のタブ（人数）",
  tabs.length === 8 && /^第一10\/10/.test(tabs[0]) && /^第五5\/10/.test(tabs[4]),
  tabs.join(),
);
let u = await units(page);
r = await ev(page, () =>
  Array.from({length:8}, (_,i) => { const q=WD_DEBUG.state().squads.find(q=>q.slot===i);return q?WD_DEBUG.squadApi.roster(q).map(s=>s.id).join():""; }),
);
check(
  "攻城の第一〜第八部隊の兵士は、防衛の第一〜第八部隊の兵士と同じ",
  u.every((x, i) => x.soldiers.join() === (r[i] || "")),
  JSON.stringify(u.map((x) => x.soldiers.length)),
);
let text = await page.textContent("#siegeUnit");
check(
  "部隊の兵種・兵士数・平均Lv・兵士の一覧を表示",
  /第一部隊/.test(text) && /兵士 10\/10/.test(text) && /平均 Lv\d/.test(text) && /Lv\d+/.test(text),
  text.slice(0, 120),
);
check("攻城編成では兵士を外せない（ボタンなし）", (await page.$$("#siegeUnit [data-remove]")).length === 0);
text = await page.textContent("#siegePick");
check(
  "兵士の入れ替えは「編成」で行うと案内",
  /防衛戦の部隊と同じ/.test(text) && /兵士・部隊へ/.test(text),
  text,
);
await page.tap("#siegePick [data-organize]");
check(
  "「兵士・部隊へ」で同じ画面の兵士タブへ",
  (await page.isVisible("#squadSheet")) && !(await page.isVisible("#siegeSheet")),
);
await page.tap("#squadClose");
await openSiegeFormation(page);
if (shots) await page.screenshot({ path: path.join(shots, "f1-unit.png") });

console.log("■ 武将の配置（防衛の配属とは別）");
await page.tap('#siegeTabs [data-unit="0"]');
await page.tap("#siegeUnit [data-hero-pick]");
text = await page.textContent("#siegePick");
check(
  "所持武将の一覧（負傷中を表示）",
  /真田幸村/.test(text) && /黒田官兵衛/.test(text) && /負傷中：あと2ウェーブで復帰/.test(text),
  text.slice(0, 160),
);
check("負傷中の武将は選べない", await page.isDisabled('#siegePick button:has-text("負傷中")'));
await page.tap('#siegePick [data-hero="yukimura"]');
u = await units(page);
check(
  "武将を配置（1部隊に1人）",
  u[0].hero === "yukimura" && /真田幸村/.test(await page.textContent("#siegeUnit")),
);
check("保存したことを表示", /保存しました/.test(await page.textContent("#siegeSaved")));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  return {
    dup: a.siegeSetHero(1, "yukimura", false),
    injured: a.siegeSetHero(1, "kenshin", true),
    notOwned: a.siegeSetHero(1, "nobunaga", true),
    change: a.siegeSetHero(0, "kanbei", false),
    after: a.siege().map((x) => x.hero),
  };
});
check("同じ武将を複数部隊に配置できない", /第一部隊 にいます/.test(r.dup), r.dup);
check("負傷中の武将は配置できない", /負傷中/.test(r.injured), r.injured);
check("所持していない武将は配置できない", /所持していません/.test(r.notOwned));
check("武将を変更できる", !r.change && r.after[0] === "kanbei");
await page.tap('#siegeTabs [data-unit="3"]');
await page.tap("#siegeUnit [data-hero-pick]");
await page.tap('#siegePick [data-hero-move="kanbei"]');
u = await units(page);
check("「移す」で武将を別の部隊へ", u[3].hero === "kanbei" && u[0].hero === null);
await page.tap("#siegeUnit [data-hero-off]");
check("武将を外せる", (await units(page))[3].hero === null);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  const q = s.squads[0];
  a.deployReserve(q, 650, 300);
  WD_DEBUG.heroApi.assignHero("yukimura", q);
  const e = a.siegeSetHero(2, "yukimura", false);
  return { e, def: !!WD_DEBUG.heroApi.heroOnSquad(q), siege: a.siege()[2].hero };
});
check("防衛で配属中の武将も攻城に配置でき、防衛の配属はそのまま", !r.e && r.def && r.siege === "yukimura");
await page.tap("#squadClose");

console.log("■ 戦死・新兵");
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    q = s.squads[0],
    m = a.members(q)[0];
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  m.skills = [];
  m.hp = 0.1;
  a.damageSquad(q, 999, false);
  return { id: m.id, alive: m.alive, still: a.siege().some((x) => x.soldiers.includes(m.id)) };
});
check("戦死した兵士は攻城の部隊からも外れる", !r.alive && !r.still, JSON.stringify(r));
check("戦死の除外も保存", !(await stored(page, FKEY)).units.some((x) => x.soldiers.includes(r.id)));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  s.enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブ終了
  const q = s.squads[3]; // 第四部隊（5人）
  a.recruitInto(q);
  const fresh = s.soldiers[s.soldiers.length - 1];
  return { id: fresh.id, before: a.siege()[4].soldiers.includes(fresh.id) };
});
check("保存される前の新兵は、まだ攻城に出ない", !r.before, JSON.stringify(r));
await openSiegeFormation(page);
check(
  "攻城編成の画面で、ウェーブをクリアすると出撃できると案内",
  await ev(page, () => {
    document.querySelector('#siegeTabs [data-unit="4"]').click();
    return /雇ったばかりの兵士 1 人/.test(document.getElementById("siegePick").textContent);
  }),
);
await page.tap("#squadClose");
r = await ev(
  page,
  (id) => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1); // ウェーブをクリアして保存
    WD_DEBUG.squadApi.refreshSiege();
    return WD_DEBUG.squadApi.siege()[4].soldiers.includes(id);
  },
  r.id,
);
check("ウェーブをクリアして保存されると攻城にも出る", r);

console.log("■ 保存・再読み込み");
const before = await units(page);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check("再読み込みしても編成が残る", JSON.stringify(await units(page)) === JSON.stringify(before));
await openSiegeFormation(page);
const layout = await ev(page, () => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  width: document.querySelector("#squadSheet .sheet").getBoundingClientRect().width,
  minBtn: Math.min(
    ...[...document.querySelectorAll("#siegeTabs button, #siegeSheet .card-actions button")].map(
      (b) => b.getBoundingClientRect().height,
    ),
  ),
}));
check(
  "390px で横スクロールなし・ボタンは押しやすい",
  !layout.hScroll && layout.width <= 390 && layout.minBtn >= 32,
  JSON.stringify(layout),
);
await page.tap("#squadClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 保存が無いとき・不正な保存データ");
({ page, errors, context } = await newContext({
  [WKEY]: JSON.stringify({ version: 1, owned: { kanbei: 1 }, tickets: 2, history: [] }),
}));
r = await units(page);
check(
  "部隊が無ければ8部隊とも空",
  r.length === 8 && r.every((x) => !x.soldiers.length && !x.hero) && errors.length === 0,
);
await openSiegeFormation(page);
check(
  "部隊が無いときは雇うよう案内",
  /雇うと、空いている枠に入ります/.test(await page.textContent("#siegePick")),
);
check("出陣ボタンは押せない", await page.isDisabled("#siegeGo"));
await context.close();
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster),
  [WKEY]: heroes,
  [FKEY]: JSON.stringify({
    version: 1,
    units: [
      { soldiers: [1, 1, 2, 999, "3", 4.5], hero: "yukimura" },
      { soldiers: [2, 5], hero: "yukimura" },
      { soldiers: [6, 7], hero: "nobunaga" },
      null,
      { soldiers: [20], hero: "kanbei" },
    ],
  }),
}));
r = await units(page);
check(
  "古い攻城編成の兵士の選び方は使わず、武将だけ読み込む（重複・未所持は除く）",
  r.length === 8 &&
    r.map((x) => x.soldiers.length).join() === "10,10,10,5,5,0,0,0" &&
    r[0].hero === "yukimura" &&
    r[1].hero === null &&
    r[2].hero === null &&
    r[3].hero === null && r[4].hero === "kanbei",
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster), [FKEY]: "{broken" }));
r = await units(page);
check(
  "壊れた保存データでも起動（武将なし）",
  r.length === 8 && r.every((x) => !x.hero) && errors.length === 0,
  errors.join(),
);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
