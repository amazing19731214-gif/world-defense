#!/usr/bin/env node
// 攻城部隊編成（第一〜第四部隊・兵士10人・武将1人・保存）の動作確認（Playwright / Chromium・iPhone相当の画面幅）
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

// 保存済みの兵士 40人（8部隊×5人）。名前付き・高レベルの兵士も混ぜる
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
  await context.addInitScript((seeds) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
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
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const stored = (page, key) => ev(page, (k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const units = (page) => ev(page, () => JSON.parse(JSON.stringify(WD_DEBUG.squadApi.siege())));

let { page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster), [WKEY]: heroes });

console.log("■ 攻城編成の画面");
check("メニューに「⚔️ 攻城編成」", /攻城編成/.test(await page.textContent("#siege")));
await page.tap("#siege");
check("攻城編成の画面を開く", await page.isVisible("#siegeSheet"));
let tabs = await page.$$eval("#siegeTabs button", (bs) => bs.map((b) => b.textContent));
check(
  "第一〜第四部隊を切り替えるタブ",
  tabs.length === 4 && /^第一/.test(tabs[0]) && /^第四/.test(tabs[3]),
  tabs.join(),
);
let text = await page.textContent("#siegePick");
const rows = await page.$$eval("#siegePick .pick-row", (rs) => rs.map((r) => r.textContent));
check("保存済みの生存兵が一覧に出る", rows.length === 40, String(rows.length));
check(
  "名前付きの兵士が先頭（見つけやすい）",
  /^🎖(鬼若|与一)/.test(rows[0]) && /^🎖(鬼若|与一)/.test(rows[1]),
  rows[0],
);
check(
  "名前付き以外はレベルの高い順",
  rows
    .slice(2)
    .map((r) => +r.match(/Lv(\d+)/)[1])
    .every((lv, i, a) => !i || a[i - 1] >= lv),
);
check(
  "兵種・Lv・スキル・現在の所属を表示",
  /足軽|槍兵|弓兵/.test(text) &&
    /Lv\d+/.test(text) &&
    /連続攻撃|スキルなし/.test(text) &&
    /攻城 未所属・防衛 /.test(text),
);
let filters = await page.$$eval("#siegePick .filters button", (bs) => bs.map((b) => b.textContent));
check(
  "兵種で絞り込み（存在する兵種から自動で作る）",
  filters.length === 4 && filters[0] === "すべて",
  filters.join(),
);

console.log("■ 兵士の追加・解除");
await page.tap("#siegePick [data-add]");
let u = await units(page);
check("タップで第一部隊に追加", u[0].soldiers.length === 1);
check("保存したことを表示", /保存しました/.test(await page.textContent("#siegeSaved")));
const firstId = u[0].soldiers[0];
check("保存データに反映", (await stored(page, FKEY)).units[0].soldiers[0] === firstId);
await page.tap(`#siegeUnit [data-remove="${firstId}"]`);
check("「外す」で部隊から外す", (await units(page))[0].soldiers.length === 0);
if (shots) await page.screenshot({ path: path.join(shots, "f1-empty.png") });

let r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    ids = WD_DEBUG.state()
      .soldiers.filter((s) => s.alive)
      .map((s) => s.id);
  const errs = [];
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 10; k++) {
      const e = a.siegeAdd(i, ids[i * 10 + k], false);
      if (e) errs.push(e);
    }
  return { errs, sizes: a.siege().map((x) => x.soldiers.length) };
});
check(
  "4部隊それぞれに10人まで配置できる",
  r.errs.length === 0 && r.sizes.join() === "10,10,10,10",
  JSON.stringify(r),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    u = a.siege();
  const moved = u[1].soldiers[0];
  a.siegeRemove(0, u[0].soldiers[9]);
  const full = a.siegeAdd(1, u[0].soldiers[0], true); // 第二部隊は満員
  const dup = a.siegeAdd(0, moved, false); // 第二部隊の兵士を第一部隊へ（移動なし）
  const mv = a.siegeAdd(0, moved, true);
  const all = u.flatMap((x) => x.soldiers);
  return {
    full,
    dup,
    mv,
    inA: u[0].soldiers.includes(moved),
    inB: u[1].soldiers.includes(moved),
    uniq: new Set(all).size === all.length,
  };
});
check("11人目は追加できない（満員）", /満員/.test(r.full), r.full);
check("同じ兵士を複数部隊に登録できない", /第二部隊 にいます/.test(r.dup) && r.uniq, r.dup);
check("「移す」で別の部隊へ移動（元の部隊から外れる）", !r.mv && r.inA && !r.inB);
await page.tap('#siegeTabs [data-unit="1"]');
text = await page.textContent("#siegeUnit");
check(
  "部隊を切り替えて兵士数・兵種・平均Lv・武将を表示",
  /第二部隊/.test(text) &&
    /兵士 9\/10/.test(text) &&
    /平均 Lv\d/.test(text) &&
    /兵種 /.test(text) &&
    /武将 なし/.test(text),
  text.slice(0, 120),
);
check("満員でない部隊には「移す」ボタン", (await page.$$("#siegePick [data-move]")).length > 0);
await page.tap('#siegeTabs [data-unit="2"]');
check(
  "満員の部隊では追加ボタンが「満員」",
  (await page.$$("#siegePick [data-add]")).length === 0 && /満員/.test(await page.textContent("#siegePick")),
);

console.log("■ 武将の配置");
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
await page.tap("#siegeUnit [data-hero-pick]");
await page.tap('#siegePick [data-hero-move="kanbei"]').catch(() => {});
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
  WD_DEBUG.setGold(9999);
  const q = s.squads[0];
  a.deployReserve(q, 650, 300);
  WD_DEBUG.heroApi.assignHero("yukimura", q);
  const e = a.siegeSetHero(2, "yukimura", false);
  return { e, def: !!WD_DEBUG.heroApi.heroOnSquad(q), siege: a.siege()[2].hero };
});
check("防衛で配属中の武将も攻城に配置でき、防衛の配属はそのまま", !r.e && r.def && r.siege === "yukimura");
if (shots) {
  await page.tap('#siegeTabs [data-unit="0"]');
  await page.screenshot({ path: path.join(shots, "f2-unit.png") });
}

console.log("■ 戦死・保存前の兵士");
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    q = s.squads[0],
    m = a.members(q)[0],
    unit = a.siege().findIndex((x) => x.soldiers.includes(m.id));
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  m.skills = [];
  m.hp = 0.1;
  a.damageSquad(q, 999, false);
  return {
    id: m.id,
    unit,
    alive: m.alive,
    still: a.siege().some((x) => x.soldiers.includes(m.id)),
    again: a.siegeAdd(3, m.id, true),
  };
});
check("戦死した兵士は編成から自動で外れる", r.unit >= 0 && !r.alive && !r.still, JSON.stringify(r));
check("戦死した兵士は編成できない", /戦死/.test(r.again), r.again);
check("戦死の除外も保存", !(await stored(page, FKEY)).units.some((x) => x.soldiers.includes(r.id)));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  s.enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブ終了
  // 満員でない部隊を作ってから、まだ保存されていない新兵を試す
  a.siegeRemove(3, a.siege()[3].soldiers[0]);
  const q = s.squads.find((x) => a.roster(x).length < 5) || s.squads[1];
  a.recruitInto(q);
  const fresh = s.soldiers[s.soldiers.length - 1];
  return { e: a.siegeAdd(3, fresh.id, false), ok: a.siegeEligible(fresh.id) };
});
check("ウェーブをクリアして保存される前の新兵は選べない", !!r.e && !r.ok, r.e);

console.log("■ 保存・再読み込み");
const before = await units(page);
const raw = await stored(page, FKEY);
check(
  "保存するのはIDと順番だけ（能力・経験値のコピーはしない）",
  raw.units.length === 4 &&
    raw.units.every(
      (x) => Object.keys(x).sort().join() === "hero,soldiers" && x.soldiers.every(Number.isInteger),
    ),
  JSON.stringify(raw.units[0]),
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
check(
  "再読み込みしても編成が残る（順番も同じ）",
  JSON.stringify(await units(page)) === JSON.stringify(before),
);
await page.tap("#siege");
text = await page.textContent("#siegeUnit");
check("再読み込み後の画面にも表示", /兵士 9\/10/.test(text) || /兵士 10\/10/.test(text), text.slice(0, 60));
const layout = await ev(page, () => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  width: document.querySelector("#siegeSheet .sheet").getBoundingClientRect().width,
  minBtn: Math.min(
    ...[
      ...document.querySelectorAll(
        "#siegeSheet .pick-row button, #siegeTabs button, #siegeSheet .card-actions button",
      ),
    ].map((b) => b.getBoundingClientRect().height),
  ),
}));
check(
  "390px で横スクロールなし・ボタンは押しやすい",
  !layout.hScroll && layout.width <= 390 && layout.minBtn >= 40,
  JSON.stringify(layout),
);
await page.tap("#siegeClose");
const toolsH = await ev(page, () => document.documentElement.scrollWidth > innerWidth);
check("メニューにボタンを足しても横スクロールなし", !toolsH);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 将来の兵種");
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster), [WKEY]: heroes }));
r = await ev(page, () => {
  // 例：鉄砲兵を追加したとき（兵種の設定と保存済みの兵士があれば、そのまま編成画面に出る）
  const T = WD_DEBUG.unitConfig.SOLDIER_TYPES,
    s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  T.musket = {
    enabled: true,
    name: "鉄砲兵",
    icon: "🔫",
    cost: 30,
    hp: 50,
    atk: 12,
    def: 2,
    rate: 1.5,
    range: 140,
    block: 0,
    grow: { hp: 5, atk: 1.5, def: 0.5 },
  };
  const m = Object.assign({}, s.soldiers[0], {
    id: 999,
    type: "musket",
    skills: [],
    name: null,
    squadId: s.soldiers[0].squadId,
  });
  s.soldiers.push(m);
  a.soldierSave().soldiers.push({ id: 999, type: "musket" });
  return a.siegeAdd(0, 999, false);
});
check("新しい兵種の兵士も編成できる（兵種を決め打ちしない）", r === null, r);
await page.tap("#siege");
filters = await page.$$eval("#siegePick .filters button", (bs) => bs.map((b) => b.textContent));
check(
  "絞り込みに新しい兵種が出る",
  filters.some((f) => /鉄砲兵/.test(f)),
  filters.join(),
);
text = await page.textContent("#siegeUnit");
check("部隊の兵種の内訳にも出る", /鉄砲兵1/.test(text), text.slice(0, 100));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ・不正な保存データ");
({ page, errors, context } = await newContext({
  [WKEY]: JSON.stringify({ version: 1, owned: { kanbei: 1 }, tickets: 2, history: [] }),
}));
r = await units(page);
check(
  "攻城編成の保存が無い以前のデータでも起動（4部隊とも空）",
  r.length === 4 && r.every((x) => !x.soldiers.length && !x.hero) && errors.length === 0,
);
await page.tap("#siege");
check("兵士がいないときは案内を表示", /ウェーブをクリアすると/.test(await page.textContent("#siegePick")));
await context.close();
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster),
  [WKEY]: heroes,
  [FKEY]: JSON.stringify({
    version: 1,
    units: [
      { soldiers: [1, 1, 2, 999, "3", 4.5], hero: "yukimura" },
      { soldiers: [2, 5], hero: "yukimura" },
      { soldiers: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18], hero: "nobunaga" },
      null,
      { soldiers: [20], hero: "kanbei" },
    ],
  }),
}));
r = await units(page);
check(
  "不正な値・重複・存在しない兵士や武将を除いて読み込む",
  r.length === 4 &&
    r[0].soldiers.join() === "1,2" &&
    r[0].hero === "yukimura" &&
    r[1].soldiers.join() === "5" &&
    r[1].hero === null &&
    r[2].soldiers.length === 10 &&
    r[2].hero === null &&
    r[3].soldiers.length === 0,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster), [FKEY]: "{broken" }));
r = await units(page);
check(
  "壊れた保存データでも起動（空の編成）",
  r.length === 4 && r.every((x) => !x.soldiers.length) && errors.length === 0,
  errors.join(),
);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
