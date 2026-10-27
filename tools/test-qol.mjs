#!/usr/bin/env node
import { togglePause } from './ui-test-utils.mjs';
// 操作性の改善の確認：ウェーブの自動開始（AUTO）・装備倉庫の並び替えと絞り込み・装備のロック・売却（個別・まとめて）
//   node tools/test-qol.mjs
//   SCREENSHOTS=dir node tools/test-qol.mjs … 画面写真も保存
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
const SKEY = "worldDefense.soldiers.v1",
  WKEY = "worldDefense.warlords.v1",
  SETKEY = "worldDefense.settings.v1";
// 兵士：槍兵10（#1）・弓兵10（#11）
const soldiersSave = { version: 1, seq: 20, squadSeq: 2, squads: [], soldiers: [], fallen: [] };
for (let q = 1; q <= 2; q++) {
  const type = q === 1 ? "spearman" : "archer";
  soldiersSave.squads.push({ id: q, type, slot: q - 1 });
  for (let k = 0; k < 10; k++)
    soldiersSave.soldiers.push({ id: (q - 1) * 10 + k + 1, type, squadId: q, level: 10 });
}
// 装備：以前の保存データ（ロックの項目なし）。伝説（蜻蛉切・村正）・裏ボス（白虎の雷鎧）・名品・良・並
const items = [
  { uid: 1, id: "suyari", owner: null }, // 並・槍・攻撃6%
  { uid: 2, id: "domaru", owner: null }, // 並・鎧・防御8%
  { uid: 3, id: "tonbokiri", owner: 1 }, // 伝説・槍（装備中）
  { uid: 4, id: "tachi", owner: null }, // 良・刀・攻撃12%
  { uid: 5, id: "haramaki", owner: null }, // 良・鎧・防御12%
  { uid: 6, id: "bushin", owner: null }, // 名品・装飾品・攻撃12%
  { uid: 7, id: "tosei", owner: null }, // 名品・鎧・防御18%
  { uid: 8, id: "muramasa", owner: null }, // 伝説・刀
  { uid: 9, id: "byakkoArmor", owner: null }, // 裏ボス
  { uid: 10, id: "omamori", owner: null }, // 並・装飾品
  { uid: 11, id: "uchigatana", owner: null }, // 並・刀
  { uid: 12, id: "nagayari", owner: 2 }, // 良・槍（装備中）
];
const warlords = {
  version: 1,
  owned: { yukimura: 3 },
  tickets: 0,
  history: [],
  forge: { items, seq: 12, shards: 5, books: { goriki: 1 }, bossRewards: { hiei: true } },
};
async function newContext(extra = {}, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
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
  const seeds = Object.assign(
    { [SKEY]: JSON.stringify(soldiersSave), [WKEY]: JSON.stringify(warlords) },
    extra,
  );
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
async function reload(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
}
const st = (page) =>
  page.evaluate(() => ({
    wave: WD_DEBUG.state().wave,
    playing: WD_DEBUG.state().playing,
    over: WD_DEBUG.state().over,
  }));
// ウェーブを始めてすぐクリアする（敵を消す）
const clearWave = (page) =>
  page.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
const step = (page, sec) => page.evaluate((sec) => WD_DEBUG.step(sec), sec);
const startText = (page) => page.textContent("#start");

let { page, errors, context } = await newContext();

console.log("■ ウェーブの自動開始（AUTO）");
check(
  "最初は AUTO OFF",
  /AUTO\s*OFF/.test(await page.textContent("#autoWave")) &&
    !(await page.evaluate(() => WD_DEBUG.forgeApi.settings().auto)),
);
await clearWave(page);
await step(page, 8);
let r = await st(page);
check("AUTO OFF：ウェーブが終わっても自動では始まらない", r.wave === 1 && !r.playing, JSON.stringify(r));
await page.tap("#autoWave");
check(
  "AUTO ON に切り替え・ウェーブの合間なら数え始める",
  /AUTO\s*ON/.test(await page.textContent("#autoWave")) && /次のWAVEまで\s*5秒/.test(await startText(page)),
  await startText(page),
);
check("設定を保存", (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).auto, SETKEY)) === true);
await step(page, 4.8);
r = await st(page);
check(
  "5秒たつまでは始まらない（残りを表示）",
  r.wave === 1 && !r.playing && /次のWAVEまで\s*1秒/.test(await startText(page)),
  JSON.stringify(r) + (await startText(page)),
);
await step(page, 0.3);
r = await st(page);
check("5秒後に次のウェーブが始まる", r.wave === 2 && r.playing, JSON.stringify(r));
check("始まると「ウェーブ開始」の表示に戻る", (await startText(page)) === "▶ ウェーブ開始");
await page.evaluate(() => {
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
});
r = await st(page);
check(
  "ウェーブが終わると、また数える（ウェーブ2クリア）",
  r.wave === 2 && !r.playing && /5秒/.test(await startText(page)),
  JSON.stringify(r),
);
await step(page, 2);
await page.tap("#start");
r = await st(page);
check("数えている途中に手動で開始できる", r.wave === 3 && r.playing, JSON.stringify(r));
await page.evaluate(() => {
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
});
await step(page, 2);
r = await page.evaluate(() => {
  // 数えている途中に手動で始めても、数え終わりでもう一度は始まらない
  document.getElementById("start").click();
  const w = WD_DEBUG.state().wave;
  WD_DEBUG.step(6);
  return { w, after: WD_DEBUG.state().wave };
});
check("手動開始と自動開始が二重にならない", r.w === 4 && r.after === 4, JSON.stringify(r));
await page.evaluate(() => {
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
});
await togglePause(page);
await step(page, 10);
r = await st(page);
check(
  "一時停止中は数えない",
  r.wave === 4 && !r.playing && /5秒/.test(await startText(page)),
  JSON.stringify(r) + (await startText(page)),
);
await togglePause(page);
await page.tap("#gearOpen");
await step(page, 10);
r = await st(page);
check("ほかの画面（装備倉庫）を開いている間は数えない", r.wave === 4 && !r.playing, JSON.stringify(r));
await page.tap("#gearClose");
await step(page, 2);
await page.tap("#autoWave");
await step(page, 8);
r = await st(page);
check(
  "数えている途中に AUTO OFF にすると中止",
  r.wave === 4 &&
    !r.playing &&
    (await startText(page)) === "▶ ウェーブ開始" &&
    /AUTO\s*OFF/.test(await page.textContent("#autoWave")),
  JSON.stringify(r),
);
await reload(page);
check(
  "AUTO OFF も保存される（読み込み直しても OFF）",
  /AUTO\s*OFF/.test(await page.textContent("#autoWave")),
);
await page.tap("#autoWave");
await reload(page);
check("AUTO ON は次に起動しても ON", /AUTO\s*ON/.test(await page.textContent("#autoWave")));
const resumedWave = await page.evaluate(() => WD_DEBUG.state().wave);
r = await page.evaluate(() => {
  // 起動・途中保存からの再開後は自動では始めない
  WD_DEBUG.step(8);
  return WD_DEBUG.state().wave;
});
check("起動・再開直後は自動では始めない（次のウェーブは自分で）", r === resumedWave && !(await page.evaluate(() => WD_DEBUG.state().playing)));
r = await page.evaluate(() => {
  // ウェーブ20まで進める（AUTO ON のまま）
  for (let w = 0; w < 20; w++) {
    if (!WD_DEBUG.state().playing) document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  }
  const s0 = WD_DEBUG.state();
  WD_DEBUG.step(8);
  const s1 = WD_DEBUG.state();
  return {
    w0: s0.wave,
    over: s0.over,
    w1: s1.wave,
    playing: s1.playing,
    text: document.getElementById("start").textContent,
  };
});
check(
  "ウェーブ20のクリア後は自動で始めない",
  r.w0 === 20 && r.over && r.w1 === 20 && !r.playing && !/次のWAVE/.test(r.text),
  JSON.stringify(r),
);
await page.evaluate(() => document.getElementById("reset").click());
r = await page.evaluate(() => {
  // ゲームオーバー
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  for (let i = 0; i < 25; i++) WD_DEBUG.addEnemy({ kind: "wolf", d: 1000 + i, hp: 1e9, speed: 400 });
  WD_DEBUG.step(5);
  const s0 = WD_DEBUG.state();
  WD_DEBUG.step(8);
  return { over: s0.over, w0: s0.wave, w1: WD_DEBUG.state().wave, playing: WD_DEBUG.state().playing };
});
check("ゲームオーバー後は自動で始めない", r.over && r.w0 === r.w1 && !r.playing, JSON.stringify(r));
await page.evaluate(() => document.getElementById("reset").click());
r = await page.evaluate(() => {
  // 修練場でも使える：ウェーブをクリアすると5秒後に次のウェーブ。修練場が終わったら始めない
  const T = WD_DEBUG.trainingApi,
    clear = () => {
      WD_DEBUG.stopSpawning();
      WD_DEBUG.state().enemies.length = 0;
      WD_DEBUG.step(0.1);
    };
  T.startTraining("beginner");
  document.getElementById("start").click();
  clear();
  const w0 = WD_DEBUG.state().wave,
    counting = document.getElementById("start").textContent;
  WD_DEBUG.step(3);
  const w3 = WD_DEBUG.state().wave;
  WD_DEBUG.step(3);
  const w1 = WD_DEBUG.state().wave,
    playing1 = WD_DEBUG.state().playing,
    disabled = document.getElementById("autoWave").disabled;
  // 最後のウェーブまでクリアすると修練場は終わり、次は始めない
  for (let i = 0; i < 40 && T.training() && !T.training().done; i++) {
    clear();
    WD_DEBUG.step(6);
  }
  const done = !T.training() || T.training().done,
    wd = WD_DEBUG.state().wave;
  WD_DEBUG.step(8);
  const out = { w0, w3, w1, playing1, disabled, counting, done, wd, wEnd: WD_DEBUG.state().wave, playingEnd: WD_DEBUG.state().playing };
  if (T.training() && !T.training().done) T.endTraining("retreat");
  return out;
});
check(
  "修練場でもAUTOが使える（ボタンを押せる・クリアの5秒後に次のウェーブ）",
  !r.disabled && /次のWAVEまで\s*5秒/.test(r.counting) && r.w3 === r.w0 && r.w1 === r.w0 + 1 && r.playing1,
  JSON.stringify(r),
);
check("修練場が終わったら（最後のウェーブのクリア）、次のウェーブは始めない", r.done && r.wEnd === r.wd && !r.playingEnd, JSON.stringify(r));
r = await page.evaluate(() => {
  // 攻城戦の最中も押せない・攻城戦の後に勝手に始まらない
  const a = WD_DEBUG.squadApi;
  a.setTarget("kiyosu");
  a.startBattle();
  const disabled = document.getElementById("autoWave").disabled;
  a.retreatBattle();
  document.getElementById("battleClose").click();
  const w0 = WD_DEBUG.state().wave;
  WD_DEBUG.step(8);
  return { disabled, w0, w1: WD_DEBUG.state().wave };
});
check("攻城戦（討伐戦も同じ）では使わない", r.disabled && r.w0 === r.w1, JSON.stringify(r));
r = await page.evaluate(() => {
  const s = document.getElementById("start").getBoundingClientRect(),
    a = document.getElementById("autoWave").getBoundingClientRect();
  return {
    sw: s.width,
    aw: a.width,
    ah: a.height,
    overlap: !(a.left >= s.right || a.right <= s.left || a.top >= s.bottom || a.bottom <= s.top),
  };
});
check(
  "AUTO ボタンは「ウェーブ開始」と重ならず、押しやすい大きさ",
  !r.overlap && r.sw > r.aw && r.ah >= 44,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 装備のロック（以前の保存データ）");
({ page, errors, context } = await newContext());
r = await page.evaluate(() =>
  WD_DEBUG.forgeApi
    .save()
    .items.map((it) => it.id + ":" + it.lock)
    .join(","),
);
check(
  "以前の保存データの伝説・裏ボスの装備はロックして守る（ほかはロックなし）",
  /tonbokiri:true/.test(r) &&
    /muramasa:true/.test(r) &&
    /byakkoArmor:true/.test(r) &&
    /suyari:false/.test(r) &&
    /tosei:false/.test(r),
  r,
);
r = await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0],
    st0 = a.soldierStats(s, true).atk,
    e1 = F.toggleLock(1),
    lock1 = F.save().items.find((it) => it.uid === 1).lock,
    e3 = F.toggleLock(3),
    st1 = a.soldierStats(s, true).atk;
  return {
    e1,
    lock1,
    e3,
    owner: F.save().items.find((it) => it.uid === 3).owner,
    same: st0 === st1,
    n: F.save().items.length,
  };
});
check(
  "ロックできる・外せる（装備の効果・持ち主・数は変わらない）",
  r.e1 === null && r.lock1 === true && r.e3 === null && r.owner === 1 && r.same && r.n === 12,
  JSON.stringify(r),
);
await reload(page);
r = await page.evaluate(() =>
  WD_DEBUG.forgeApi
    .save()
    .items.filter((it) => [1, 3].includes(it.uid))
    .map((it) => it.lock),
);
check("ロックを保存（読み込み直しても同じ）", r.join() === "true,false", r.join());
r = await page.evaluate(() => {
  // 新しく手に入れた伝説はロック、それ以外はロックなし
  const F = WD_DEBUG.forgeApi,
    mk = (t) => {
      let n = 0;
      return () => (n++ === 0 ? t : 0.5);
    };
  const a = F.forge("yukimura", "gear", mk(0.999)),
    b = F.forge("yukimura", "gear", mk(0.5));
  const S = F.save();
  return [a, b]
    .map((x) => F.GEAR[x.gear].grade + ":" + S.items.find((it) => it.uid === x.uid).lock)
    .join(",");
});
check("錬成で手に入れた伝説は最初からロック・ほかはロックなし", /^4:true,[123]:false$/.test(r), r);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 並び替え・絞り込み");
({ page, errors, context } = await newContext());
r = await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi,
    v = (o) =>
      F.gearView(Object.assign({ sort: "grade-desc", type: "all", state: "all", grade: 0 }, o))
        .map((it) => it.uid)
        .join(",");
  return {
    gradeDesc: v({}),
    gradeAsc: v({ sort: "grade-asc" }),
    atk: v({ sort: "atk" }),
    def: v({ sort: "def" }),
    newest: v({ sort: "new" }),
    oldest: v({ sort: "old" }),
    name: v({ sort: "name" })
      .split(",")
      .map((u) => F.GEAR[F.save().items.find((it) => it.uid === +u).id].name)
      .join(","),
    weapon: v({ type: "weapon", sort: "old" }),
    armor: v({ type: "armor", sort: "old" }),
    acc: v({ type: "accessory", sort: "old" }),
    worn: v({ state: "worn", sort: "old" }),
    free: v({ state: "free", sort: "old" }),
    locked: v({ state: "locked", sort: "old" }),
    g2: v({ grade: 2, sort: "old" }),
    combo: v({ type: "armor", state: "free", sort: "def" }),
    combo2: v({ type: "weapon", grade: 1, sort: "new" }),
  };
});
check(
  "レアリティの高い順（同じなら手に入れた順）",
  r.gradeDesc === "3,8,9,6,7,4,5,12,1,2,10,11",
  r.gradeDesc,
);
check("レアリティの低い順", r.gradeAsc === "1,2,10,11,4,5,12,6,7,3,8,9", r.gradeAsc);
check("攻撃の高い順（装備の攻撃 +％。同じなら手に入れた順）", r.atk === "3,8,4,6,12,1,11,2,5,7,9,10", r.atk);
check("防御の高い順（同じなら手に入れた順）", r.def === "7,9,5,2,1,3,4,6,8,10,11,12", r.def);
check(
  "新しい順・古い順",
  r.newest === "12,11,10,9,8,7,6,5,4,3,2,1" && r.oldest === "1,2,3,4,5,6,7,8,9,10,11,12",
);
check(
  "名前順",
  r.name.split(",").length === 12 &&
    r.name === [...r.name.split(",")].sort((a, b) => a.localeCompare(b, "ja")).join(","),
  r.name,
);
check(
  "種類：武器・鎧・装飾品",
  r.weapon === "1,3,4,8,11,12" && r.armor === "2,5,7,9" && r.acc === "6,10",
  JSON.stringify(r),
);
check(
  "状態：装備中・未装備・ロック中",
  r.worn === "3,12" && r.free === "1,2,4,5,6,7,8,9,10,11" && r.locked === "3,8,9",
  JSON.stringify(r),
);
check("品質：良だけ", r.g2 === "4,5,12", r.g2);
check("並び替えと絞り込みを組み合わせる（未装備の鎧を防御の高い順）", r.combo === "7,9,5,2", r.combo);
check("組み合わせ（並の武器を新しい順）", r.combo2 === "11,1", r.combo2);

console.log("■ 売却");
r = await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi,
    it = (u) => F.save().items.find((x) => x.uid === u),
    e = (u) => F.sellError(it(u));
  F.toggleLock(8); // 村正のロックを外しても
  return {
    worn: e(12),
    locked: (F.toggleLock(1), e(1)),
    legend: e(8),
    boss: (F.toggleLock(9), e(9)),
    ok: [2, 4, 6].map(e),
    prices: [2, 4, 6].map((u) => F.sellPrice(it(u))),
    table: F.SELL_PRICE,
  };
});
check("装備中の品は売れない", /装備中/.test(r.worn || ""), r.worn);
check("ロック中の品は売れない", /ロック中/.test(r.locked || ""), r.locked);
check(
  "伝説の装備はロックを外しても売れない",
  /伝説/.test(r.legend || "") && /伝説/.test(r.boss || ""),
  JSON.stringify(r),
);
check(
  "名品以下は売れる",
  r.ok.every((x) => x === null),
  JSON.stringify(r.ok),
);
check(
  "売値：並 50両・良 150両・名品 500両",
  r.prices.join() === "50,150,500" && JSON.stringify(r.table) === JSON.stringify({ 1: 50, 2: 150, 3: 500 }),
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi,
    gold0 = WD_DEBUG.state().gold,
    g0 = F.koban(),
    res = F.sellItems([2, 4, 6, 4]), // 同じ装備を二度選んでも1回だけ
    g1 = F.koban(),
    again = F.sellItems([2]),
    g2 = F.koban(),
    mixed = F.sellItems([10, 12]), // 装備中が混ざっていたら何も売らない
    g3 = F.koban();
  return {
    res,
    gain: g1 - g0,
    goldSame: WD_DEBUG.state().gold === gold0,
    savedKoban: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge.koban,
    again: again.error,
    same: g2 === g1,
    mixed: mixed.error,
    same2: g3 === g1,
    left: F.save()
      .items.map((it) => it.uid)
      .join(","),
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1"))
      .forge.items.map((it) => it.uid)
      .join(","),
  };
});
check(
  "まとめて売ると合計の小判（50+150+500=700両）・軍資金Gは増えない",
  r.res.n === 3 && r.res.total === 700 && r.gain === 700 && r.goldSame && r.savedKoban === 700,
  JSON.stringify(r),
);
check(
  "売った装備は倉庫から消え、すぐ保存",
  r.left === "1,3,5,7,8,9,10,11,12" && r.saved === r.left,
  JSON.stringify(r),
);
check(
  "同じ装備は二度売れない（小判も増えない）",
  /もう売った/.test(r.again || "") && r.same,
  JSON.stringify(r),
);
check(
  "売れない品が混ざっていたら何も売らない",
  /装備中/.test(r.mixed || "") && r.same2 && r.left.includes("10"),
  JSON.stringify(r),
);
await reload(page);
r = await page.evaluate(() => ({
  items: WD_DEBUG.forgeApi
    .save()
    .items.map((it) => it.uid)
    .join(","),
  books: WD_DEBUG.forgeApi.save().books,
  shards: WD_DEBUG.forgeApi.save().shards,
  boss: WD_DEBUG.forgeApi.save().bossRewards,
}));
check(
  "読み込み直しても売った装備は戻らない（書・欠片・裏ボスの記録はそのまま）",
  r.items === "1,3,5,7,8,9,10,11,12" && r.books.goriki === 1 && r.shards === 5 && r.boss.hiei === true,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  document.getElementById("start").click();
  const e = WD_DEBUG.forgeApi.sellItems([10]).error;
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  return e;
});
check("戦闘中は売れない", /戦闘中/.test(r || ""), r);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 小判（永続の通貨）");
({ page, errors, context } = await newContext());
r = await page.evaluate(() => ({ koban: WD_DEBUG.forgeApi.koban(), gold: WD_DEBUG.state().gold }));
check("以前の保存データ（小判の項目なし）は 0両 から", r.koban === 0, JSON.stringify(r));
r = await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi;
  return { res: F.sellItems([1, 2]), koban: F.koban(), gold: WD_DEBUG.state().gold };
});
check(
  "売ると小判が増える（並2つ = 100両）・軍資金Gはそのまま",
  r.res.total === 100 && r.koban === 100 && r.gold === 500,
  JSON.stringify(r),
);
await reload(page);
r = await page.evaluate(() => ({
  koban: WD_DEBUG.forgeApi.koban(),
  gold: WD_DEBUG.state().gold,
  n: WD_DEBUG.forgeApi.save().items.length,
}));
check(
  "読み込み直しても小判は残る（軍資金Gは今までどおり開始の額）",
  r.koban === 100 && r.gold === 500 && r.n === 10,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  const g1 = WD_DEBUG.state().gold;
  document.getElementById("reset").click();
  return { g1, koban: WD_DEBUG.forgeApi.koban(), gold: WD_DEBUG.state().gold, wave: WD_DEBUG.state().wave };
});
check(
  "「最初から」でも小判は残る（軍資金Gとウェーブは元に戻る）",
  r.koban === 100 && r.gold === 500 && r.wave === 0 && r.g1 > 500,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  // 保存に失敗したら売らない（装備も小判も元のまま）
  const F = WD_DEBUG.forgeApi,
    set = Storage.prototype.setItem,
    before = {
      n: F.save().items.length,
      koban: F.koban(),
      saved: localStorage.getItem("worldDefense.warlords.v1"),
    };
  Storage.prototype.setItem = function () {
    throw new Error("quota");
  };
  const res = F.sellItems([4, 5]);
  Storage.prototype.setItem = set;
  return {
    error: res.error,
    n: F.save().items.length,
    koban: F.koban(),
    has4: F.save().items.some((it) => it.uid === 4),
    before,
    savedSame: localStorage.getItem("worldDefense.warlords.v1") === before.saved,
  };
});
check(
  "保存に失敗したら売却をやめる（エラー・装備も小判も元のまま）",
  /保存できなかった/.test(r.error || "") &&
    r.n === r.before.n &&
    r.koban === r.before.koban &&
    r.has4 &&
    r.savedSame,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const F = WD_DEBUG.forgeApi;
  const res = F.sellItems([4, 5]);
  return { res, koban: F.koban() };
});
check(
  "保存できるようになれば、同じ装備を売れる（二重にはならない）",
  r.res.total === 300 && r.koban === 400,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();
({ page, errors, context } = await newContext({
  [WKEY]: JSON.stringify(
    Object.assign({}, warlords, { forge: Object.assign({}, warlords.forge, { koban: -50 }) }),
  ),
}));
check("壊れた小判の値は 0 に直す", (await page.evaluate(() => WD_DEBUG.forgeApi.koban())) === 0);
await context.close();

console.log("■ 画面（375×667）");
({ page, errors, context } = await newContext({}, 375, 667));
await page.tap("#gearOpen");
let text = await page.textContent("#gearBody");
check(
  "並び・種類・状態・品質の選択と売却モード",
  (await page.$$("#gearBody [data-gear-opt]")).length === 4 &&
    /売却モード/.test(text) &&
    /表示 12 \/ 全 12個/.test(text),
  text.slice(0, 200),
);
r = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#gearBody [data-gear-row]")];
  return { rows: rows.length, locked: rows.filter((b) => /🔒/.test(b.textContent)).length };
});
await page.tap('[data-gear-row="s:domaru"]');
check(
  "一覧は1行ずつ（同じ装備はまとめる）・ロック中の🔒・行を開くとロックのボタン",
  r.rows === 12 && r.locked === 3 && (await page.$$("[data-gear-lock-stack]")).length === 1,
  JSON.stringify(r),
);
await page.tap('[data-gear-row="s:domaru"]'); // 閉じる
await page.selectOption('[data-gear-opt="type"]', "armor");
await page.selectOption('[data-gear-opt="sort"]', "def");
r = await page.evaluate(() =>
  [...document.querySelectorAll("#gearBody [data-gear-row]")].map((c) => c.dataset.gearRow).join(","),
);
check(
  "画面で絞り込み（鎧）と並び替え（防御の高い順）",
  r === "s:tosei,s:byakkoArmor:L,s:haramaki,s:domaru",
  r,
);
r = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).gear, SETKEY);
check("並び替え・絞り込みの設定を保存", r.type === "armor" && r.sort === "def", JSON.stringify(r));
await page.selectOption('[data-gear-opt="type"]', "all");
await page.tap('[data-gear-row="s:domaru"]');
await page.tap('[data-sell-one="2"]');
text = await page.textContent(".sell-confirm");
check(
  "個別の売却も確認画面（数・一覧・合計・元に戻せない）",
  /1個の装備を売却/.test(text) && /胴丸/.test(text) && /合計 50両/.test(text) && /元に戻せません/.test(text),
  text,
);
await page.tap("[data-sell-cancel]");
check("キャンセルすると売らない", (await page.evaluate(() => WD_DEBUG.forgeApi.save().items.length)) === 12);
await page.tap("[data-sell-mode]");
await page.tap("[data-sell-all]");
text = await page.textContent(".sell-bar");
check(
  "売却モード：表示中の売れる装備をすべて選ぶ（並4・良2・名品2 = 50×4+150×2+500×2）",
  /選択 8個・合計 1500両/.test(text),
  text,
);
r = await page.evaluate(() =>
  [...document.querySelectorAll("#gearBody .gear-line button[disabled]")].map((b) => b.textContent).join("|"),
);
check("装備中・ロック中・伝説は選べない（理由を表示）", /装備中/.test(r) && /伝説/.test(r), r);
await page.tap("[data-sell-none]");
await page.tap('[data-sell-grade="1"]');
check("品質ごとに選ぶ（並をすべて：50×4）", /選択 4個・合計 200両/.test(await page.textContent(".sell-bar")));
await page.tap('[data-sell-stack="s:domaru"]');
check("1つずつ選択を外せる", /選択 3個・合計 150両/.test(await page.textContent(".sell-bar")));
const g0 = await page.evaluate(() => ({ koban: WD_DEBUG.forgeApi.koban(), gold: WD_DEBUG.state().gold }));
await page.tap("[data-sell-ask]");
text = await page.textContent(".sell-confirm");
check(
  "まとめて売る確認：数・装備名の一覧・合計",
  /3個の装備を売却/.test(text) &&
    /素槍/.test(text) &&
    /お守り/.test(text) &&
    /打刀/.test(text) &&
    /合計 150両/.test(text),
  text,
);
r = await page.evaluate(() => {
  const el = document.querySelector(".sell-confirm"),
    rr = el.getBoundingClientRect(),
    btns = [...el.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
  return {
    right: rr.right <= innerWidth + 0.5,
    left: rr.left >= 0,
    h: Math.min(...btns.map((b) => b.height)),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check(
  "確認画面は画面からはみ出さない・ボタンは44px以上",
  r.right && r.left && r.h >= 44 && !r.hScroll,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "q1-confirm.png") });
await page.tap("[data-sell-go]");
r = await page.evaluate(() => ({
  gold: WD_DEBUG.state().gold,
  koban: WD_DEBUG.forgeApi.koban(),
  n: WD_DEBUG.forgeApi.save().items.length,
  note: document.getElementById("gearBody").textContent,
}));
check(
  "売却：装備が消えて小判が増える（軍資金Gはそのまま）・残高を表示",
  r.n === 9 &&
    r.koban - g0.koban === 150 &&
    r.gold === g0.gold &&
    /3個の装備を売却して 小判 150両/.test(r.note) &&
    new RegExp("🪙 小判 " + r.koban.toLocaleString("ja-JP") + "両").test(r.note),
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const sh = document.querySelector("#gearSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    btns = [...sh.querySelectorAll("button, select")].filter((b) => b.getClientRects().length);
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minBtn: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    wide: btns.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
  };
});
check(
  "375×667：画面に収まる・横にはみ出さない・ボタンと選択は44px以上",
  r.inView && !r.hScroll && r.minBtn >= 44 && r.wide,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "q2-sell.png") });
await page.tap("#gearClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 画面（390×844）");
({ page, errors, context } = await newContext({}, 390, 844));
await page.tap("#gearOpen");
await page.tap("[data-sell-mode]");
r = await page.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  names: [...document.querySelectorAll("[data-sell-stack]")].every(
    (b) => /\d+両/.test(b.textContent) && /\S/.test(b.closest(".gear-line").querySelector(".gr-name").textContent),
  ),
}));
check("390×844：横にはみ出さない・選ぶボタンに装備名と売値", !r.hScroll && r.names, JSON.stringify(r));
await page.tap("#gearClose");
r = await page.evaluate(() => {
  const s = document.getElementById("start").getBoundingClientRect(),
    a = document.getElementById("autoWave").getBoundingClientRect();
  return {
    overlap: !(a.left >= s.right || a.right <= s.left || a.top >= s.bottom || a.bottom <= s.top),
    ah: a.height,
  };
});
check("390×844：AUTO ボタンは「ウェーブ開始」と重ならない", !r.overlap && r.ah >= 44, JSON.stringify(r));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
