#!/usr/bin/env node
// 終盤（試作）：伝説の兵士の確認
// 解放の条件（天下統一＋三大裏ボス）・解放前は使えない・レベルアップで伝説の能力（数値は抽選して固定・能力値は1つだけ有効）・
// 特殊能力（貫通ビームサーベル・連鎖雷撃・爆炎斬・影分身）の効果と演出・重ね掛け・無限に連鎖しない・防衛戦/攻城戦/修練場・
// 終盤の特殊装備・指導員の引退と伝承の秘伝書（数値のまま継承）・保存の失敗で消えない/二重にならない・再読み込み・以前の保存データ・画面
//   node tools/test-legend.mjs
//   SCREENSHOTS=dir node tools/test-legend.mjs … 画面写真も保存
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
const base = pathToFileURL(path.join(root, "index.html")).href;
const url = base + "?debug";
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
  CKEY = "worldDefense.conquest.v1",
  FKEY = "worldDefense.siege.v1";
const ABIL = { beam: 1, chain: 0.7, blast: 0.6, shadow: 0.3 };
// 4部隊×10人（Lv60）
function roster(types = ["ashigaru", "spearman", "archer", "gunner"]) {
  const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
  types.forEach((t, q) => {
    save.squads.push({ id: q + 1, type: t, slot: q });
    for (let k = 0; k < 10; k++)
      save.soldiers.push({ id: q * 10 + k + 1, type: t, squadId: q + 1, level: 60, skills: [], learned: [] });
  });
  return save;
}
async function newContext(seeds = {}, width = 390, height = 844, u = url) {
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
  await page.goto(u);
  await page.waitForFunction(() => window.WD_DEBUG || document.getElementById("start"));
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(u);
  await page.waitForFunction(() => window.WD_DEBUG || document.getElementById("start"));
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const reload = async (page) => {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
};

console.log("■ 解放の前（通常のプレイ）");
let { page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster()) });
let r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state();
  L.setRng(() => 0); // 抽選は必ず当たる
  const s = S.soldiers[0];
  for (let i = 0; i < 30; i++) a.gainXp(s, 99999, true);
  L.setRng();
  return {
    on: L.endgameOn(),
    legend: s.legend || null,
    craft: L.craftEndgame("lightMuramasa"),
    level: s.level,
    preview: document.getElementById("previewOpen").hidden,
  };
});
check("解放前は endgameOn = false", r.on === false);
check("解放前はレベルアップしても伝説の能力を習得しない", r.legend === null, JSON.stringify(r.legend));
check("解放前は終盤の装備を作れない", /終盤/.test(r.craft) && r.level >= 100, JSON.stringify(r));
check("公開版（試作版でない）には試作のボタンを出さない（?debug でも）", r.preview === true);
await page.tap("#soldiers");
r = await ev(page, () => ({
  retire: document.querySelectorAll("[data-retire]").length,
  legend: document.querySelectorAll(".legend-box").length,
}));
check(
  "解放前は伝説の能力の欄を出さない（指導員はLv100の兵士だけ押せる：解放とは関係なし）",
  r.retire === 1 && r.legend === 0,
  JSON.stringify(r),
);
await page.tap("#soldierClose");
await page.tap("#gearOpen");
check("解放前は装備倉庫に終盤の装備の欄を出さない", (await page.$$("[data-endgame-craft]")).length === 0);
await page.tap("#gearClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 解放の条件：天下統一と三大裏ボスの討伐");
const won = { attempts: 1, wins: 1, first: 1, best: 60 };
for (const [label, cq, want] of [
  ["天下統一だけ（裏ボスなし）", { version: 2, tenka: true }, false],
  ["天下統一＋裏ボス2体", { version: 2, tenka: true, bosses: { hiei: won, yomi: won } }, false],
  [
    "裏ボス3体だけ（天下統一なし）",
    { version: 2, tenka: false, bosses: { hiei: won, yomi: won, fuji: won } },
    false,
  ],
  [
    "天下統一＋三大裏ボスすべて",
    { version: 2, tenka: true, bosses: { hiei: won, yomi: won, fuji: won } },
    true,
  ],
]) {
  ({ page, errors, context } = await newContext({
    [SKEY]: JSON.stringify(roster()),
    [CKEY]: JSON.stringify(cq),
  }));
  r = await ev(page, () => WD_DEBUG.legendApi.endgameOn());
  check(label + " → " + (want ? "解放" : "まだ"), r === want, String(r));
  await context.close();
}

console.log("■ 指導員の引退はLv100から（天下統一・裏ボスの前でも）");
{
  const lv = roster();
  const set = (id, o) => Object.assign(lv.soldiers[id - 1], o);
  set(1, { level: 99, learned: ["spearMaster"], skills: ["spearMaster"], name: "九十九" });
  set(2, { level: 100, learned: ["spearMaster"], skills: ["spearMaster"], name: "百" });
  set(3, { level: 250, learned: ["shingan"], skills: ["shingan"], name: "二百五十" }); // 秘伝スキル（スキルの書で覚える）
  set(4, { level: 300, learned: ["ironWall"], skills: ["ironWall"], name: "主人公" });
  set(5, {
    level: 1000,
    learned: [],
    skills: [],
    name: "千",
    legend: { stats: [{ k: "atkFlat", v: 40 }], on: 0, abil: [{ k: "chain", v: 0.6 }] },
  });
  lv.heroId = 4;
  ({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(lv) }, 375, 667));
}
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    find = (id) => WD_DEBUG.state().soldiers.find((s) => s.id === id);
  return {
    on: L.endgameOn(),
    e99: L.retireSoldier(1, 0),
    hero: L.retireSoldier(4, 0),
    e100: L.retireSoldier(2, 0),
    e250: L.retireSoldier(3, 0),
    alive: [1, 2, 3, 4].map((id) => !!find(id)),
    books: WD_DEBUG.forgeApi.save().legendBooks.map((b) => b.type + ":" + b.id),
    oldBooks: WD_DEBUG.forgeApi.save().books,
    mentors: WD_DEBUG.forgeApi.save().mentors.map((m) => m.name + ":Lv" + m.level),
  };
});
check("（まだ解放していない）", r.on === false);
check("Lv99では引退できない（Lv100から）", /Lv100から/.test(r.e99 || "") && r.alive[0], JSON.stringify(r));
check("主人公は引退できない", /主人公/.test(r.hero || "") && r.alive[3], r.hero);
check("Lv100で引退できる（天下統一の前でも）", r.e100 === null && !r.alive[1], JSON.stringify(r));
check("Lv250でも引退できる（上限なし）", r.e250 === null && !r.alive[2], JSON.stringify(r));
check("通常のスキルは伝承の秘伝書に（槍の達人）", r.books.join() === "skill:spearMaster", r.books.join());
check(
  "秘伝スキルは今までの「スキルの書」として残る（心眼の書 +1）",
  r.oldBooks.shingan === 1,
  JSON.stringify(r.oldBooks),
);
check("指導員名簿に引退レベル", r.mentors.join() === "🎖二百五十:Lv250,🎖百:Lv100", r.mentors.join());
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi,
    find = (id) => WD_DEBUG.state().soldiers.find((s) => s.id === id),
    to = find(11),
    uid = F.save().legendBooks[0].uid;
  const e1 = L.useLegendBook(to, uid),
    e2 = F.useBook(find(12), "shingan");
  return {
    e1,
    e2,
    l11: find(11).learned,
    l12: find(12).learned,
    books: F.save().legendBooks.length,
    old: F.save().books.shingan || 0,
  };
});
check(
  "通常スキルの秘伝書を別の兵士に渡せる（1冊なくなる）",
  r.e1 === null && r.l11.includes("spearMaster") && r.books === 0,
  JSON.stringify(r),
);
check(
  "秘伝スキルの書は、今までどおりの使い方で別の兵士に使える",
  r.e2 === null && r.l12.includes("shingan") && r.old === 0,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    a = WD_DEBUG.squadApi,
    find = (id) => WD_DEBUG.state().soldiers.find((s) => s.id === id),
    s = find(5),
    locked = a.soldierStats(s).atk;
  const hits = [];
  L.legendStrike(
    s,
    { x: 0, y: 18 },
    { x: 50, y: 0 },
    100,
    [
      { x: 50, y: 0 },
      { x: 120, y: 0 },
    ],
    (e, d) => hits.push(d),
  );
  const e = L.retireSoldier(5, 1); // 連鎖雷撃（伝説の能力）を書に
  const book = WD_DEBUG.forgeApi.save().legendBooks.find((b) => b.type === "abil");
  const use = book ? L.useLegendBook(find(13), book.uid) : "no book";
  L.setForce(true);
  const s6 = find(6);
  L.addLegend(s6, { type: "stat", k: "atkFlat", v: 40 });
  const unlocked = a.soldierStats(s6).atk - a.soldierStats(Object.assign({}, s6, { legend: null })).atk;
  L.setForce(false);
  return {
    lockedDiff: locked - a.soldierStats(Object.assign({}, s, { legend: null })).atk,
    hits: hits.length,
    e,
    use,
    unlocked,
  };
});
check(
  "伝説の能力は解放前は働かない（攻撃 +40 も連鎖雷撃も効かない）",
  r.lockedDiff === 0 && r.hits === 0,
  JSON.stringify(r),
);
check(
  "伝説の能力を書に残すことはできるが、解放前は使えない",
  r.e === null && /終盤/.test(r.use || ""),
  JSON.stringify(r),
);
check("解放すると伝説の能力が働く（攻撃 +40）", Math.abs(r.unlocked - 40) < 1e-6, JSON.stringify(r));
await page.tap("#soldiers");
r = await ev(page, () => {
  const card = [...document.querySelectorAll(".s-card")].find((c) => /九十九/.test(c.textContent)),
    lock = card.querySelector(".retire-locked"),
    hero = [...document.querySelectorAll(".s-card")].find((c) =>
      /主人公/.test(c.querySelector("h3").textContent),
    ),
    bs = [...document.querySelectorAll("#soldierList .card-actions button")].filter((b) => b.getClientRects().length);
  return {
    lock: lock && lock.disabled && lock.textContent,
    heroBtn: hero ? hero.querySelectorAll("[data-retire], .retire-locked").length : -1,
    minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
    fit: bs.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check("Lv99の兵士は「🎓 指導員に（Lv100〜）」を押せない", /Lv100〜/.test(r.lock || ""), JSON.stringify(r));
check("主人公には引退のボタンを出さない", r.heroBtn === 0, JSON.stringify(r));
check(
  "375×667：名簿のボタンは44px以上・はみ出さない",
  r.minH >= 44 && r.fit && !r.hScroll,
  JSON.stringify(r),
);
if (shots) {
  await page.evaluate(() =>
    [...document.querySelectorAll(".s-card")].find((c) => /九十九/.test(c.textContent)).scrollIntoView(),
  );
  await page.screenshot({ path: path.join(shots, "l0-locked.png") });
}
await page.tap("#soldierClose");
await reload(page);
r = await ev(page, () => ({
  mentors: WD_DEBUG.forgeApi.save().mentors.length,
  gone: [2, 3, 5].every((id) => !WD_DEBUG.state().soldiers.some((s) => s.id === id)),
  l11: WD_DEBUG.state().soldiers.find((s) => s.id === 11).learned,
  books: WD_DEBUG.forgeApi.save().legendBooks.map((b) => b.type),
}));
check(
  "再読み込みしても：指導員名簿・引退・受け継いだスキル・残った書",
  r.mentors === 3 && r.gone && r.l11.includes("spearMaster") && r.books.join() === "abil",
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ レベルアップで伝説の能力");
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(roster()) }));
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state();
  L.setForce(true);
  // 抽選：毎回当たり。能力値と特殊能力が交互に出るように並べ、数値は兵士ごとに違う乱数
  let x = 7;
  const lcg = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  for (const s of S.soldiers.slice(0, 6)) {
    let n = 0;
    L.setRng(() => (n++ === 0 ? 0 : lcg())); // 1回目（習得するか）は必ず当たり、あとは乱数
    a.gainXp(s, a.SQUAD_RULES ? 0 : 0, true);
    const lv = s.level;
    a.gainXp(s, 999999, true);
    out.push({ lv0: lv, lv1: s.level, legend: s.legend });
  }
  L.setRng();
  return out;
});
const all = r.flatMap((x) => [
  ...(x.legend ? x.legend.stats.map((s) => s.k + ":" + s.v) : []),
  ...(x.legend ? x.legend.abil.map((a) => a.k + ":" + a.v) : []),
]);
check(
  "解放後、レベルアップで伝説の能力を習得する",
  r.every((x) => x.legend && x.legend.stats.length + x.legend.abil.length >= 1),
  JSON.stringify(r.map((x) => x.legend)),
);
check(
  "数値は兵士ごとに抽選（同じ値ばかりにならない）",
  new Set(all).size >= Math.min(6, all.length) * 0.8,
  JSON.stringify(all),
);
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    out = {};
  for (const [k, c] of Object.entries(L.LEGEND.stats)) out[k] = [c.min, c.max];
  // 範囲：1000回の抽選がすべて範囲内
  let bad = 0;
  for (let i = 0; i < 1000; i++) {
    const g = L.rollLegend(),
      c = g.type === "stat" ? L.LEGEND.stats[g.k] : L.LEGEND.abil[g.k];
    if (!(g.v >= c.min && g.v <= c.max)) bad++;
  }
  return { out, bad };
});
check(
  "能力値の範囲：攻撃+1〜100・+1〜15%、防御+1〜100・+1〜20%、HP+10〜500・+1〜25%、射程+1〜30・+1〜15%",
  JSON.stringify(r.out) ===
    JSON.stringify({
      atkFlat: [1, 100],
      atkPct: [1, 15],
      defFlat: [1, 100],
      defPct: [1, 20],
      hpFlat: [10, 500],
      hpPct: [1, 25],
      rngFlat: [1, 30],
      rngPct: [1, 15],
    }) && r.bad === 0,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[20];
  const base = a.soldierStats(s);
  L.addLegend(s, { type: "stat", k: "atkFlat", v: 50 });
  const afterAtk = a.soldierStats(s);
  L.addLegend(s, { type: "stat", k: "hpPct", v: 20 });
  const stillAtk = a.soldierStats(s); // 2つ目は有効にならない（1つだけ）
  L.setLegendStat(s, 1);
  const hp = a.soldierStats(s);
  L.setLegendStat(s, 0);
  return { base, afterAtk, stillAtk, hp, on: s.legend.on };
});
check(
  "能力値「攻撃 +50」：攻撃がちょうど +50",
  Math.abs(r.afterAtk.atk - r.base.atk - 50) < 1e-6,
  JSON.stringify([r.base.atk, r.afterAtk.atk]),
);
check(
  "能力値は1つだけ有効（2つ目を覚えても前のまま）",
  Math.abs(r.stillAtk.atk - r.afterAtk.atk) < 1e-6 && r.stillAtk.maxHp === r.base.maxHp,
);
check(
  "有効にする能力値を切り替えられる（最大HP +20%）",
  r.hp.maxHp === Math.round(r.base.maxHp * 1.2) && Math.abs(r.hp.atk - r.base.atk) < 1e-6 && r.on === 0,
  JSON.stringify([r.base.maxHp, r.hp.maxHp]),
);

console.log("■ 特殊能力の効果");
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    fx = L.effects();
  const mk = (abil) => ({ id: 999, type: "archer", skills: [], legend: { stats: [], on: -1, abil } });
  const run = (abil, list, target, rng = 0) => {
    const hits = new Map();
    L.setRng(() => rng);
    fx.length = 0;
    L.legendStrike(mk(abil), { x: 0, y: 18 }, target, 100, list, (e, d) =>
      hits.set(e.n, (hits.get(e.n) || 0) + d),
    );
    L.setRng();
    return { hits: Object.fromEntries(hits), fx: fx.map((f) => f.kind) };
  };
  // 一直線に並んだ敵（x=40,80,…,400）と、線から外れた敵
  const line = [];
  for (let i = 1; i <= 10; i++) line.push({ n: "L" + i, x: i * 40, y: 0, r: 12 });
  const off = { n: "off", x: 120, y: 120, r: 12 };
  const beam = run([{ k: "beam", v: 1 }], [...line, off], line[1]);
  const chainList = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ n: "C" + i, x: 300 + i * 90, y: 0, r: 12 }));
  const chain = run([{ k: "chain", v: 0.5 }], chainList, chainList[0]);
  const blastList = [
    { n: "T", x: 300, y: 0 },
    { n: "near", x: 340, y: 20 },
    { n: "far", x: 420, y: 0 },
  ];
  const blast = run([{ k: "blast", v: 0.5 }], blastList, blastList[0]);
  const sh0 = run([{ k: "shadow", v: 0.3 }], blastList, blastList[0], 0);
  const sh1 = run([{ k: "shadow", v: 0.3 }], blastList, blastList[0], 0.99);
  const four = run(
    Object.entries({ beam: 1, chain: 0.7, blast: 0.6, shadow: 0.3 }).map(([k, v]) => ({ k, v })),
    [...line, ...blastList],
    line[1],
    0,
  );
  // 重ね掛け：ビームを2つ持てば威力は足し算
  const dbl = run(
    [
      { k: "beam", v: 1 },
      { k: "beam", v: 0.5 },
    ],
    line,
    line[1],
  );
  // 無限に連鎖しない：ダメージを与える関数の中からもう一度呼んでも何も起きない
  let calls = 0;
  const s = mk([{ k: "chain", v: 0.5 }]);
  const hitter = (e) => {
    calls++;
    if (calls < 50) L.legendStrike(s, { x: 0, y: 18 }, e, 100, chainList, hitter);
  };
  L.legendStrike(s, { x: 0, y: 18 }, chainList[0], 100, chainList, hitter);
  return { beam, chain, blast, sh0, sh1, four, dbl, calls };
});
const bk = Object.keys(r.beam.hits);
check(
  "貫通ビームサーベル：一直線上の敵すべて（長さ260まで）に当たり、線から外れた敵には当たらない",
  bk.length === 6 && !bk.includes("off") && !bk.includes("L7") && r.beam.hits.L1 === 100,
  JSON.stringify(r.beam),
);
check("ビームの演出（lbeam）", r.beam.fx.join() === "lbeam");
check(
  "連鎖雷撃：近い敵へ4回まで連鎖し、だんだん弱まる",
  JSON.stringify(Object.keys(r.chain.hits)) === JSON.stringify(["C1", "C2", "C3", "C4"]) &&
    r.chain.hits.C1 === 50 &&
    r.chain.hits.C4 < r.chain.hits.C1 &&
    r.chain.fx.join() === "lchain",
  JSON.stringify(r.chain),
);
check(
  "爆炎斬：相手のまわり（半径70）の敵に範囲ダメージ・爆発の演出",
  JSON.stringify(r.blast.hits) === '{"near":50}' && r.blast.fx.join() === "lblast",
  JSON.stringify(r.blast),
);
check(
  "影分身：確率で同じ威力の追加攻撃・分身の演出（外れたら何もしない）",
  r.sh0.hits.T === 100 && r.sh0.fx.join() === "lshadow" && Object.keys(r.sh1.hits).length === 0,
  JSON.stringify([r.sh0, r.sh1]),
);
check(
  "4つの特殊能力を組み合わせられる（演出も4種類）",
  ["lbeam", "lchain", "lblast", "lshadow"].every((k) => r.four.fx.includes(k)),
  JSON.stringify(r.four.fx),
);
check(
  "同じ特殊能力の重ね掛けは足し算（ビーム 1.0＋0.5 → 150%）",
  r.dbl.hits.L2 === 150,
  JSON.stringify(r.dbl.hits),
);
check("追加攻撃から特殊能力をもう一度発動しない（無限に連鎖しない）", r.calls === 4, String(r.calls));

console.log("■ 防衛戦で使う");
const fight = (withAbil) =>
  ev(
    page,
    ([withAbil, ABIL]) => {
      const L = WD_DEBUG.legendApi,
        a = WD_DEBUG.squadApi,
        S = () => WD_DEBUG.state(),
        q = S().squads[2]; // 弓兵
      for (const s of a.members(q)) {
        s.legend = null;
        if (withAbil) for (const [k, v] of Object.entries(ABIL)) L.addLegend(s, { type: "abil", k, v });
      }
      for (const o of S().squads) if (o.state !== "reserve") a.orderRetreat(o);
      a.deployReserve(q, 650, 300);
      document.getElementById("start").click();
      WD_DEBUG.stopSpawning();
      S().enemies.length = 0;
      WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
      const es = [];
      for (let i = 0; i < 8; i++)
        es.push(WD_DEBUG.addEnemy({ kind: "goblin", d: 560 + i * 22, hp: 1e6, speed: 0 }));
      L.effects().length = 0;
      const kinds = new Set();
      for (let i = 0; i < 30; i++) {
        WD_DEBUG.step(0.1);
        for (const f of L.effects()) kinds.add(f.kind);
      }
      const hit = es.filter((e) => e.hp < 1e6).length,
        total = es.reduce((n, e) => n + (1e6 - e.hp), 0);
      S().enemies.length = 0;
      WD_DEBUG.step(0.1);
      a.orderRetreat(q);
      return { hit, total, kinds: [...kinds].filter((k) => k[0] === "l") };
    },
    [withAbil, ABIL],
  );
const plain = await fight(false),
  strong = await fight(true);
check(
  "防衛戦：特殊能力なしでは届く敵だけ",
  plain.hit >= 1 && plain.kinds.length === 0,
  JSON.stringify(plain),
);
check(
  "防衛戦：特殊能力ありでは、より多くの敵に・より大きなダメージ（ビーム・雷・爆発・分身の演出が出る）",
  strong.hit > plain.hit &&
    strong.total > plain.total * 2 &&
    ["lbeam", "lchain", "lblast", "lshadow"].every((k) => strong.kinds.includes(k)),
  JSON.stringify(strong),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 攻城戦・修練場で使う");
await context.close();
const formation = {
  version: 1,
  units: [0, 1, 2, 3].map((u) => ({
    soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
    hero: null,
  })),
};
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster()),
  [FKEY]: JSON.stringify(formation),
}));
r = await ev(
  page,
  (ABIL) => {
    const L = WD_DEBUG.legendApi,
      a = WD_DEBUG.squadApi;
    L.setForce(true);
    for (const s of WD_DEBUG.state().soldiers)
      for (const [k, v] of Object.entries(ABIL)) L.addLegend(s, { type: "abil", k, v });
    const err = a.startBattle();
    const B = a.battle(),
      castle0 = B.castleHp,
      garrison0 = B.garrison.length;
    L.effects().length = 0;
    const kinds = new Set();
    for (let i = 0; i < 160 && a.battle(); i++) {
      WD_DEBUG.step(0.25);
      for (const f of L.effects()) kinds.add(f.kind);
    }
    const res = {
      err,
      kinds: [...kinds].filter((k) => k[0] === "l"),
      garrison0,
      castle0,
      castle1: B.castleHp,
      captured: !!B.captured,
    };
    if (a.battle()) a.retreatBattle();
    return res;
  },
  ABIL,
);
check(
  "攻城戦：特殊能力が発動して攻め進む（城にダメージ・演出つき）",
  r.err == null && r.garrison0 > 0 && (r.castle1 < r.castle0 || r.captured) && r.kinds.length >= 3,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    S = () => WD_DEBUG.state(),
    q = S().squads[2];
  WD_DEBUG.trainingApi.startTraining("beginner");
  for (const o of S().squads) if (o.state !== "reserve") a.orderRetreat(o);
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  const es = [];
  for (let i = 0; i < 6; i++)
    es.push(WD_DEBUG.addEnemy({ kind: "goblin", d: 560 + i * 22, hp: 1e6, speed: 0 }));
  WD_DEBUG.step(3);
  const hit = es.filter((e) => e.hp < 1e6).length;
  S().enemies.length = 0;
  WD_DEBUG.step(0.1);
  return { on: !!WD_DEBUG.trainingApi.training(), hit };
});
check("修練場：特殊能力で複数の敵に当たる", r.on && r.hit >= 3, JSON.stringify(r));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 終盤の特殊装備");
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster()),
  [WKEY]: JSON.stringify({
    version: 1,
    owned: {},
    tickets: 0,
    history: [],
    forge: { items: [], seq: 0, koban: 7000 },
  }),
}));
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi;
  L.setForce(true);
  const ids = ["lightMuramasa", "raijinSpear", "phantomRing"];
  const errs = ids.map((id) => L.craftEndgame(id));
  const gun = L.craftEndgame("blastGun"); // 爆炎の鉄砲は天下統一の報酬だけ
  const poor = L.craftEndgame("lightMuramasa"); // 7000 − 2000×3 = 1000 では足りない
  const items = F.save().items.map((it) => it.id + ":" + it.lock);
  const s = WD_DEBUG.state().soldiers[0];
  const it = F.save().items.find((x) => x.id === "lightMuramasa");
  const eq = F.equipItem ? F.equipItem(s, it.uid) : "n/a";
  return {
    errs,
    gun,
    poor,
    items,
    koban: F.koban(),
    beam: WD_DEBUG.squadApi.skillSum ? WD_DEBUG.squadApi.skillSum(s, "beam") : null,
    eq,
    zukanItems: F.zukanCount("items").total,
    wear: [
      F.canWear("ashigaru", "lightMuramasa"),
      F.canWear("spearman", "raijinSpear"),
      F.canWear("gunner", "blastGun"),
      F.canWear("archer", "phantomRing"),
    ],
  };
});
check(
  "解放後は小判で3つの特殊装備を作れる（ロック済み）",
  r.errs.every((e) => e === null) &&
    r.items.length === 3 &&
    r.items.every((x) => x.endsWith(":true")) &&
    r.koban === 1000,
  JSON.stringify(r),
);
check("爆炎の鉄砲は小判では作れない（天下統一の報酬）", /作れません/.test(r.gun || ""), r.gun);
check("小判が足りなければ作れない", /小判が足りません/.test(r.poor || ""), r.poor);
check(
  "光刃・村正は刀、雷神の槍は槍、爆炎の鉄砲は鉄砲、幻影の指輪は装飾品",
  r.wear.every(Boolean),
  JSON.stringify(r.wear),
);
check("図鑑のアイテムの数は変えていない（35）", r.zukanItems === 35, String(r.zukanItems));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 指導員の引退と伝承の秘伝書（375×667）");
const sv = roster();
sv.soldiers[0].level = 120;
sv.soldiers[0].learned = ["spearMaster", "ironWall"];
sv.soldiers[0].skills = ["spearMaster", "ironWall"];
sv.soldiers[0].name = "老兵";
sv.soldiers[0].legend = { stats: [{ k: "atkFlat", v: 77 }], on: 0, abil: [{ k: "beam", v: 0.93 }] };
sv.soldiers[1].named = "motoharu";
sv.soldiers[1].name = "吉川元春";
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(sv) }, 375, 667));
await ev(page, () => {
  WD_DEBUG.legendApi.setForce(true);
});
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    S = WD_DEBUG.state();
  return {
    a: L.inheritables(S.soldiers.find((x) => x.id === 1)).map(
      (b) => b.type + ":" + (b.id || b.k + "=" + b.v),
    ),
    named: L.inheritables(S.soldiers.find((x) => x.id === 2)).length,
  };
});
check(
  "残せるスキル：習得したスキルと伝説の能力（数値つき）",
  r.a.join() === "skill:spearMaster,skill:ironWall,stat:atkFlat=77,abil:beam=0.93",
  r.a.join(),
);
check("ネームド兵士の固有能力は残せない（吉川元春は残せるものがない）", r.named === 0, String(r.named));
await page.tap("#soldiers");
r = await ev(page, () => ({
  box: document.querySelector(".s-card .legend-box")
    ? document.querySelector(".s-card .legend-box").textContent
    : "",
  retire: document.querySelectorAll("[data-retire]").length,
}));
check(
  "名簿に伝説の能力（有効な能力値・特殊能力）と「🎓 指導員に」",
  /攻撃 \+77/.test(r.box) && /貫通ビームサーベル（93%）/.test(r.box) && r.retire > 0,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "l1-card.png") });
await page.tap('[data-retire="1"]');
r = await ev(page, () => ({
  open: !document.getElementById("retireSheet").hidden,
  picks: document.querySelectorAll("[data-retire-pick]").length,
  go: document.querySelectorAll("[data-retire-go]").length,
}));
check(
  "引退の画面：残すスキルを選ぶ（まだ引退のボタンは出ない）",
  r.open && r.picks === 4 && r.go === 0,
  JSON.stringify(r),
);
await page.tap('[data-retire-pick="3"]');
let text = await page.textContent("#retireBody");
check(
  "選ぶと確認：残すスキルと「戻せません」",
  /老兵 を指導員として引退させますか/.test(text) &&
    /貫通ビームサーベル（93%）/.test(text) &&
    /戻せません/.test(text),
  text,
);
const lay = await ev(page, () => {
  const bs = [...document.querySelectorAll("#retireSheet button")].filter((b) => b.getClientRects().length);
  return {
    minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
    fit: bs.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check(
  "375×667：引退の画面のボタンは44px以上・はみ出さない",
  lay.minH >= 44 && lay.fit && !lay.hScroll,
  JSON.stringify(lay),
);
if (shots) await page.screenshot({ path: path.join(shots, "l2-retire.png") });
await page.tap("[data-retire-go]");
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi.save(),
    sv = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")),
    wv = JSON.parse(localStorage.getItem("worldDefense.warlords.v1"));
  return {
    alive: WD_DEBUG.state().soldiers.some((s) => s.id === 1),
    saved: sv.soldiers.some((s) => s.id === 1),
    books: F.legendBooks,
    savedBooks: wv.forge.legendBooks,
    mentors: F.mentors.map((m) => m.name + ":" + m.level + ":" + m.skill),
    tab: document.getElementById("tabMentor").classList.contains("active"),
    list: document.getElementById("soldierList").textContent,
  };
});
check("引退：兵士は部隊・保存データから外れる", !r.alive && !r.saved, JSON.stringify(r));
check(
  "選んだ特殊能力を、数値のまま伝承の秘伝書に（保存済み）",
  r.books.length === 1 &&
    r.books[0].k === "beam" &&
    r.books[0].v === 0.93 &&
    JSON.stringify(r.savedBooks) === JSON.stringify(r.books),
  JSON.stringify(r.books),
);
check(
  "指導員名簿に名前・到達レベル・残したスキル",
  r.tab && /老兵/.test(r.list) && /引退Lv120/.test(r.list) && /貫通ビームサーベル（93%）/.test(r.list),
  r.list,
);
await page.tap("#soldierClose");
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="books"]');
await page.tap("[data-lbook-pick]");
const target = await ev(page, () => +document.querySelector("[data-lbook-to]").dataset.to);
await page.tap(`[data-lbook-to][data-to="${target}"]`);
r = await ev(
  page,
  (id) => {
    const s = WD_DEBUG.state().soldiers.find((x) => x.id === id);
    return {
      legend: s.legend,
      books: WD_DEBUG.forgeApi.save().legendBooks.length,
      note: document.getElementById("gearBody").textContent,
    };
  },
  target,
);
check(
  "伝承の秘伝書を別の兵士に使う：同じ数値で習得し、書は1冊なくなる",
  r.legend &&
    r.legend.abil.some((a) => a.k === "beam" && a.v === 0.93) &&
    r.books === 0 &&
    /受け継ぎました/.test(r.note),
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "l3-book.png") });
await page.tap("#gearClose");
await reload(page);
r = await ev(
  page,
  (id) => {
    const s = WD_DEBUG.state().soldiers.find((x) => x.id === id);
    return {
      legend: s.legend,
      books: WD_DEBUG.forgeApi.save().legendBooks.length,
      mentors: WD_DEBUG.forgeApi.save().mentors.length,
      old: WD_DEBUG.state().soldiers.some((x) => x.id === 1),
    };
  },
  target,
);
check(
  "再読み込み後も：受け継いだ能力・書の消費・指導員名簿・引退が残る",
  r.legend &&
    r.legend.abil.some((a) => a.k === "beam" && a.v === 0.93) &&
    r.books === 0 &&
    r.mentors === 1 &&
    !r.old,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 保存に失敗したとき（消えない・二重にならない）");
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(sv) }));
const failSave = (on) =>
  ev(
    page,
    (on) => {
      if (on) {
        window.__set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (String(k).startsWith("worldDefense.")) throw new Error("QuotaExceededError");
          return window.__set.call(this, k, v);
        };
      } else if (window.__set) Storage.prototype.setItem = window.__set;
    },
    on,
  );
r = await ev(page, () => WD_DEBUG.legendApi.setForce(true));
await failSave(true);
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    err = L.retireSoldier(1, 2);
  return {
    err,
    alive: WD_DEBUG.state().soldiers.some((s) => s.id === 1),
    books: WD_DEBUG.forgeApi.save().legendBooks.length,
    mentors: WD_DEBUG.forgeApi.save().mentors.length,
  };
});
check(
  "保存に失敗したら引退しない（兵士は残り、書も名簿も増えない）",
  /保存できなかった/.test(r.err || "") && r.alive && r.books === 0 && r.mentors === 0,
  JSON.stringify(r),
);
await failSave(false);
r = await ev(page, () => WD_DEBUG.legendApi.retireSoldier(1, 2));
check("保存できるようになれば引退できる（攻撃 +77 の書）", r === null, String(r));
const uid = await ev(page, () => WD_DEBUG.forgeApi.save().legendBooks[0].uid);
await failSave(true);
r = await ev(
  page,
  (uid) => {
    const L = WD_DEBUG.legendApi,
      s = WD_DEBUG.state().soldiers.find((x) => x.id === 11);
    const err = L.useLegendBook(s, uid);
    return { err, legend: s.legend, books: WD_DEBUG.forgeApi.save().legendBooks.length };
  },
  uid,
);
check(
  "保存に失敗したら秘伝書を使わない（能力も増えず、書も残る）",
  /保存できなかった/.test(r.err || "") && !r.legend && r.books === 1,
  JSON.stringify(r),
);
await failSave(false);
await reload(page);
r = await ev(page, () => ({
  books: WD_DEBUG.forgeApi.save().legendBooks.map((b) => b.k + "=" + b.v),
  s11: WD_DEBUG.state().soldiers.find((x) => x.id === 11).legend,
  s1: WD_DEBUG.state().soldiers.some((x) => x.id === 1),
}));
check(
  "読み込み直すと、引退は確定・秘伝書は1冊のまま（二重にならない）・使えなかった能力は付いていない",
  r.books.join() === "atkFlat=77" && !r.s11 && !r.s1,
  JSON.stringify(r),
);
r = await ev(page, () => {
  WD_DEBUG.legendApi.setForce(true);
  const L = WD_DEBUG.legendApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 11),
    uid = WD_DEBUG.forgeApi.save().legendBooks[0].uid;
  const e1 = L.useLegendBook(s, uid),
    e2 = L.useLegendBook(
      WD_DEBUG.state().soldiers.find((x) => x.id === 12),
      uid,
    );
  return { e1, e2, legend: s.legend };
});
check(
  "同じ秘伝書は二度使えない",
  r.e1 === null && /ありません/.test(r.e2 || "") && r.legend.stats[0].v === 77,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ・壊れた値");
const old = roster();
old.soldiers[0].legend = {
  stats: [
    { k: "atkFlat", v: 999 },
    { k: "defPct", v: 10 },
    { k: "nope", v: 1 },
  ],
  on: 0,
  abil: [
    { k: "beam", v: 5 },
    { k: "chain", v: 0.5 },
  ],
};
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(old) }));
r = await ev(page, () => ({
  s0: WD_DEBUG.state().soldiers[0].legend,
  s1: WD_DEBUG.state().soldiers[1].legend,
  books: WD_DEBUG.forgeApi.save().legendBooks.length,
}));
check("伝説の能力のない以前の保存データはそのまま読める", r.s1 === null && r.books === 0, JSON.stringify(r));
check(
  "範囲外・知らない能力は捨てる（防御 +10% と連鎖雷撃だけ残る）",
  JSON.stringify(r.s0) ===
    JSON.stringify({ stats: [{ k: "defPct", v: 10 }], on: 0, abil: [{ k: "chain", v: 0.5 }] }),
  JSON.stringify(r.s0),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 試作版（WD_PREVIEW）の確認ボタン");
const previewHtml = path.join(root, "tools", ".preview-test.html");
fs.writeFileSync(
  previewHtml,
  fs
    .readFileSync(path.join(root, "index.html"), "utf8")
    .replace("<head>", "<head><script>window.WD_PREVIEW=true</script>"),
);
({ page, errors, context } = await newContext(
  { [SKEY]: JSON.stringify(roster()) },
  375,
  667,
  pathToFileURL(previewHtml).href,
));
r = await ev(page, () => !document.getElementById("previewOpen").hidden);
check("試作版だけ「🧪 試作：終盤」ボタンが出る", r);
await page.tap("#previewOpen");
await page.tap('[data-pv="toggle"]');
await page.tap('[data-pv="all4"]');
await page.tap("#previewClose");
await page.tap("#soldiers");
r = await ev(
  page,
  () => document.querySelector(".legend-box") && document.querySelector(".legend-box").textContent,
);
check(
  "試作：終盤を解放して、全員に特殊能力4種",
  /貫通ビームサーベル/.test(r || "") &&
    /連鎖雷撃/.test(r || "") &&
    /爆炎斬/.test(r || "") &&
    /影分身/.test(r || ""),
  r,
);
await page.goto(pathToFileURL(previewHtml).href);
r = await page.evaluate(
  () => document.getElementById("checkpointStatus") && !document.getElementById("previewOpen").hidden,
);
check("試作版を読み込み直しても開ける", r);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();
fs.unlinkSync(previewHtml);

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
