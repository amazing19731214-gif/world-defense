#!/usr/bin/env node
import { installJobBookTestFixtures } from "./job-book-test-utils.mjs";
import { openInfoEntry } from './ui-test-utils.mjs';
// 秘伝錬成・装備・スキルの書の動作確認：重複武将カードの消費（最初の1枚は保護・★と二重に使わない）、
// レア度別の抽選確率、外れの欠片と交換、武将の傾向、装備（3枠・1つの装備は1人だけ・職業の制限）、
// 装備の戦闘効果（防衛戦・攻城戦・修練場）、転職・戦死・解散で倉庫へ戻る、スキルの書、保存と再読み込み、画面
//   node tools/test-forge.mjs
//   SCREENSHOTS=dir node tools/test-forge.mjs … 画面写真も保存
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
  WKEY = "worldDefense.warlords.v1";
// 以前の形式の武将の保存データ（錬成の項目なし）：信長1枚・幸村3枚（★3）・官兵衛7枚（★5＋2枚）・忠勝2枚
const oldWarlords = {
  version: 1,
  owned: { nobunaga: 1, yukimura: 3, kanbei: 7, tadakatsu: 2 },
  tickets: 2,
  history: [],
  lastHero: null,
  injured: {},
};
// 以前の形式の兵士：第一 槍兵10（#1 は Lv30 の主人公）、第二 弓兵10
const oldSoldiers = {
  version: 1,
  seq: 20,
  squadSeq: 2,
  squads: [
    { id: 1, type: "spearman", slot: 0 },
    { id: 2, type: "archer", slot: 1 },
  ],
  soldiers: [],
  fallen: [],
  heroId: 1,
};
for (let k = 0; k < 10; k++)
  oldSoldiers.soldiers.push({
    id: k + 1,
    type: "spearman",
    squadId: 1,
    level: k === 0 ? 30 : 8,
    xp: 0,
    name: k === 0 ? "鬼若" : null,
    skills: [],
  });
for (let k = 0; k < 10; k++)
  oldSoldiers.soldiers.push({ id: 11 + k, type: "archer", squadId: 2, level: 8, xp: 0, skills: [] });

async function newPage(warlords, soldiersSave, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await installJobBookTestFixtures(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate(
    ([a, b, c, d]) => {
      localStorage.clear();
      localStorage.setItem(a, b);
      localStorage.setItem(c, d);
    },
    [WKEY, JSON.stringify(warlords), SKEY, JSON.stringify(soldiersSave)],
  );
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const wsave = (page) => ev(page, (k) => JSON.parse(localStorage.getItem(k)), WKEY);
const ssave = (page) => ev(page, (k) => JSON.parse(localStorage.getItem(k)), SKEY);
async function reload(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
}
// 錬成で決まった等級・アイテムを出す（試験用の乱数）
//   tier：0 外れ … 4 大当たり（R の確率で区切りの中ほど）、pick：同じ等級の中の位置（0〜1）
const RNG = `(tier, pick) => {
  const R = WD_DEBUG.forgeApi.FORGE.rates.R, order = ["miss", "small", "normal", "hit", "jackpot"];
  let a = 0;
  for (let i = 0; i < tier; i++) a += R[order[i]];
  const vals = [(a + R[order[tier]] / 2) / 100, pick];
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
}`;

let { page, errors, context } = await newPage(oldWarlords, oldSoldiers);

console.log("■ 以前の保存データ");
let r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi;
  return {
    owned: F.owned(),
    save: F.save(),
    able: ["nobunaga", "yukimura", "kanbei", "tadakatsu", "shingen"].map(F.forgeable),
  };
});
check(
  "錬成の項目がない保存データ：所持枚数はそのまま、欠片・装備・書は空",
  JSON.stringify(r.owned) === JSON.stringify(oldWarlords.owned) &&
    r.save.shards === 0 &&
    r.save.items.length === 0 &&
    Object.keys(r.save.books).length === 0,
  JSON.stringify(r),
);
check("使える重複カード＝所持枚数−1（最初の1枚は保護）", r.able.join() === "0,2,6,1,0", r.able.join());

console.log("■ 重複カードの消費");
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi;
  return {
    first: F.forgeError("nobunaga", "gear"),
    none: F.forgeError("shingen", "gear"),
    kind: F.forgeError("yukimura", "weapon"),
    res: F.forge("nobunaga", "gear"),
    owned: F.owned().nobunaga,
  };
});
check(
  "最初の1枚しかない武将は錬成できない",
  /最初の1枚/.test(r.first || "") && r.res.error && r.owned === 1,
  JSON.stringify(r),
);
check("持っていない武将は錬成できない", /持っていません/.test(r.none || ""));
check("錬成の種類が違うと錬成できない", /種類/.test(r.kind || ""));
r = await ev(
  page,
  (RNG) => {
    const F = WD_DEBUG.forgeApi,
      rng = eval(RNG);
    const st0 = F.stars("yukimura");
    const a = F.forge("yukimura", "gear", rng(1, 0));
    const b = F.forge("yukimura", "book", rng(2, 0));
    const c = F.forge("yukimura", "gear", rng(1, 0));
    return {
      st0,
      a,
      b,
      c,
      owned: F.owned().yukimura,
      stars: F.stars("yukimura"),
      used: F.save().used.yukimura,
      items: F.save().items.length,
      books: F.save().books,
    };
  },
  RNG,
);
check(
  "重複カードを1枚ずつ使い、★もその分下がる（★3 → ★2 → ★1）",
  r.st0 === 3 &&
    r.a.starsBefore === 3 &&
    r.a.stars === 2 &&
    r.b.stars === 1 &&
    r.owned === 1 &&
    r.stars === 1,
  JSON.stringify({ a: r.a, b: r.b }),
);
check("重複がなくなると錬成できない（最初の1枚は残る）", !!r.c.error && r.owned === 1, JSON.stringify(r.c));
check("錬成で使った枚数を記録", r.used === 2);
check(
  "装備錬成で装備、秘伝書錬成でスキルの書",
  r.items === 1 && Object.values(r.books)[0] === 1,
  JSON.stringify(r),
);
let w = await wsave(page);
check(
  "消費と獲得を一緒に保存（同じ保存データ）",
  w.owned.yukimura === 1 &&
    w.forge.items.length === 1 &&
    Object.keys(w.forge.books).length === 1 &&
    w.forge.history.length === 2,
  JSON.stringify(w.forge),
);
r = await ev(
  page,
  (RNG) => {
    const F = WD_DEBUG.forgeApi,
      rng = eval(RNG);
    const before = F.stars("kanbei");
    const a = F.forge("kanbei", "gear", rng(1, 0));
    const b = F.forge("kanbei", "gear", rng(1, 0));
    const c = F.forge("kanbei", "gear", rng(1, 0));
    return { before, a: a.stars, b: b.stars, c: c.stars, owned: F.owned().kanbei };
  },
  RNG,
);
check(
  "★上限（★5）を超えた分は★を下げずに使える（7枚 → 6・5枚は★5のまま、4枚で★4）",
  r.before === 5 && r.a === 5 && r.b === 5 && r.c === 4 && r.owned === 4,
  JSON.stringify(r),
);
await reload(page);
r = await ev(page, () => ({ owned: WD_DEBUG.forgeApi.owned(), n: WD_DEBUG.forgeApi.save().items.length }));
check(
  "再読み込みしても使ったカードは戻らず、アイテムも残る",
  r.owned.yukimura === 1 && r.owned.kanbei === 4 && r.n === 4,
  JSON.stringify(r),
);
r = await ev(page, () => {
  // ガチャで同じ武将を引けば、また錬成できる（★も上がる）
  const H = WD_DEBUG.heroApi,
    F = WD_DEBUG.forgeApi;
  H.grantTickets(1, "試験");
  let n = 0;
  const res = H.pullGacha(() => (n++ === 0 ? 0.5 : 0)); // SR の先頭（幸村）
  return { id: res.id, owned: F.owned()[res.id], able: F.forgeable(res.id), stars: F.stars(res.id) };
});
check(
  "ガチャで重複を引くと★が上がり、また錬成できる",
  r.owned >= 2 && r.able === r.owned - 1 && r.stars === Math.min(5, r.owned),
  JSON.stringify(r),
);

console.log("■ 抽選の確率");
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    out = {};
  for (const rar of ["R", "SR", "SSR"]) {
    const R = F.FORGE.rates[rar],
      sum = Object.values(R).reduce((a, b) => a + b, 0),
      count = { miss: 0, small: 0, normal: 0, hit: 0, jackpot: 0 },
      N = 40000;
    for (let i = 0; i < N; i++) count[F.rollTier(rar, Math.random)]++;
    const freq = Object.fromEntries(Object.entries(count).map(([k, v]) => [k, (v / N) * 100]));
    out[rar] = { R, sum, freq, ok: Object.keys(R).every((k) => Math.abs(freq[k] - R[k]) < 0.8) };
  }
  return out;
});
check(
  "確率の合計は100%（R・SR・SSR）",
  ["R", "SR", "SSR"].every((k) => r[k].sum === 100),
  JSON.stringify(r.R.R),
);
check(
  "R の基本確率：大当たり3%・当たり12%・普通35%・小当たり35%・外れ15%",
  JSON.stringify(r.R.R) === JSON.stringify({ jackpot: 3, hit: 12, normal: 35, small: 35, miss: 15 }),
);
check(
  "抽選は設定どおりの確率で出る（各4万回・±0.8%）",
  r.R.ok && r.SR.ok && r.SSR.ok,
  JSON.stringify({ R: r.R.freq, SR: r.SR.freq, SSR: r.SSR.freq }),
);
check(
  "SR・SSR は当たり・大当たりが出やすい（R < SR < SSR）",
  r.R.R.jackpot < r.SR.R.jackpot &&
    r.SR.R.jackpot < r.SSR.R.jackpot &&
    r.R.R.hit < r.SR.R.hit &&
    r.SR.R.hit < r.SSR.R.hit,
);
check("R からも大当たり（伝説）が出る", r.R.R.jackpot > 0 && r.R.freq.jackpot > 2);
r = await ev(
  page,
  (RNG) => {
    const F = WD_DEBUG.forgeApi,
      rng = eval(RNG),
      grades = [1, 2, 3, 4].map((t) => F.rollForge("kanbei", "gear", rng(t, 0.5)).gear),
      books = [1, 2, 3, 4].map((t) => F.rollForge("kanbei", "book", rng(t, 0.5)).book);
    return {
      g: grades.map((id) => F.GEAR[id].grade),
      b: books.map((id) => WD_DEBUG.squadApi.SOLDIER_SKILLS[id].book),
      miss: F.rollForge("kanbei", "gear", rng(0, 0)),
    };
  },
  RNG,
);
check("小当たり＝並・普通＝良・当たり＝名品・大当たり＝伝説（装備）", r.g.join() === "1,2,3,4", r.g.join());
check("同じく、スキルの書の品質も等級どおり", r.b.join() === "1,2,3,4", r.b.join());
check("外れは欠片だけ", r.miss.tier === "miss" && r.miss.shard === 1 && !r.miss.gear && !r.miss.book);
r = await ev(page, () => {
  // 武将の傾向：同じ等級（伝説）の中で、傾向に合うものが出やすい。どの武将からでも全部出る
  const F = WD_DEBUG.forgeApi,
    N = 6000,
    legend = Object.keys(F.GEAR).filter((id) => F.GEAR[id].grade === 4 && !F.GEAR[id].boss && !F.GEAR[id].endgame); // 裏ボス・終盤の装備は錬成では出ない
  const run = (wid) => {
    const seen = {};
    for (let i = 0; i < N; i++) {
      let k = 0;
      const id = F.rollForge(wid, "gear", () => (k++ === 0 ? 0.9999 : Math.random())).gear;
      seen[id] = (seen[id] || 0) + 1;
    }
    return seen;
  };
  const tada = run("tadakatsu"),
    kan = run("kanbei");
  const share = (seen, ids) => ids.reduce((a, id) => a + (seen[id] || 0), 0) / N;
  const yariArmor = legend.filter((id) => F.GEAR[id].wtype === "yari" || F.GEAR[id].slot === "armor");
  // 竹中半兵衛：策略・支援のスキルの書が出やすい
  let sup = 0,
    sup0 = 0;
  for (let i = 0; i < N; i++) {
    let k = 0,
      k2 = 0;
    const a = F.rollForge("hanbei", "book", () => (k++ === 0 ? 0.5 : Math.random())).book,
      b = F.rollForge("nobunaga", "book", () => (k2++ === 0 ? 0.5 : Math.random())).book;
    const L = WD_DEBUG.squadApi.SOLDIER_SKILLS;
    if (["strategy", "support"].includes(L[a].line)) sup++;
    if (["strategy", "support"].includes(L[b].line)) sup0++;
  }
  return {
    tada: share(tada, yariArmor),
    kan: share(kan, yariArmor),
    allTada: legend.every((id) => tada[id] > 0),
    allKan: legend.every((id) => kan[id] > 0),
    sup: sup / N,
    sup0: sup0 / N,
  };
});
check("本多忠勝は槍・鎧の伝説装備が出やすい", r.tada > r.kan + 0.1, JSON.stringify(r));
check("竹中半兵衛は策略・支援のスキルの書が出やすい", r.sup > r.sup0 + 0.15, JSON.stringify(r));
check("特定の武将でなくても、全部の伝説装備が出る", r.allTada && r.allKan);
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    seen = new Set();
  for (let i = 0; i < 3000; i++) {
    let k = 0;
    seen.add(F.rollForge("nobunaga", "gear", () => (k++ === 0 ? 0.9999 : Math.random())).gear);
  }
  return ["byakkoArmor", "yamataBlade", "tenmaArmor"].some((id) => seen.has(id));
});
check("裏ボスの専用装備は錬成では出ない", r === false);

console.log("■ 外れの欠片と交換");
r = await ev(
  page,
  (RNG) => {
    const F = WD_DEBUG.forgeApi,
      rng = eval(RNG);
    const s0 = F.save().shards,
      res = F.forge("kanbei", "gear", rng(0, 0));
    return { s0, s1: F.save().shards, res };
  },
  RNG,
);
check("外れでも錬成の欠片を1個獲得", r.res.tier === "miss" && r.s1 === r.s0 + 1, JSON.stringify(r));
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    S = F.save(),
    out = { need: F.FORGE.shardTrade };
  S.shards = 19;
  out.e19 = F.tradeShards("kongo");
  out.s19 = S.shards;
  out.b19 = S.books.kongo || 0;
  S.shards = 20;
  out.e20 = F.tradeShards("kongo");
  out.s20 = S.shards;
  S.shards = 21;
  out.e21 = F.tradeShards("kongo");
  out.s21 = S.shards;
  S.shards = 40;
  out.e40 = [F.tradeShards("kongo"), F.tradeShards("saihai"), F.tradeShards("kongo")];
  out.s40 = S.shards;
  S.shards = 50;
  out.eNot = F.tradeShards("goriki"); // 上級ではない
  out.sNot = S.shards;
  S.shards = 45;
  out.e45 = F.tradeShards("jinjutsu");
  out.books = Object.assign({}, S.books);
  out.shards = S.shards;
  return out;
});
check("交換に必要な欠片は20個（定数 FORGE.shardTrade）", r.need === 20, String(r.need));
check(
  "欠片19個では交換できない（欠片・書は変わらない）",
  /足りません（19\/20）/.test(r.e19 || "") && r.s19 === 19 && r.b19 === 0,
  JSON.stringify(r),
);
check("欠片20個で交換できる（0個になる）", r.e20 === null && r.s20 === 0, JSON.stringify(r));
check("欠片21個で交換すると1個残る", r.e21 === null && r.s21 === 1, JSON.stringify(r));
check(
  "欠片40個なら2回交換できる（3回目はできない）",
  r.e40[0] === null && r.e40[1] === null && /足りません/.test(r.e40[2] || "") && r.s40 === 0,
  JSON.stringify(r.e40),
);
check(
  "交換できるのは上級（名品）のスキルの書だけ（欠片は減らない）",
  /上級/.test(r.eNot || "") && r.sNot === 50,
);
check(
  "交換した書を受け取る（金剛3冊・采配1冊・仁術1冊、欠片45 → 25）",
  r.e45 === null && r.books.kongo === 3 && r.books.saihai === 1 && r.books.jinjutsu === 1 && r.shards === 25,
  JSON.stringify(r),
);
await reload(page);
r = await ev(page, () => WD_DEBUG.forgeApi.save());
check(
  "交換後に再読み込みしても欠片の数と書が正しい",
  r.shards === 25 && r.books.kongo === 3 && r.books.saihai === 1 && r.books.jinjutsu === 1,
  JSON.stringify({ s: r.shards, b: r.books }),
);
check("エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 装備");
// 装備を用意：蜻蛉切・妖刀村正・赤備え・白銀・不死鳥・打刀・素槍・胴丸
const give = (page, ids) =>
  ev(
    page,
    (ids) => {
      const S = WD_DEBUG.forgeApi.save();
      const uids = ids.map((id) => {
        const uid = ++S.seq;
        S.items.push({ uid, id, owner: null, lock: false }); // 試験では売却・ロックは関係ないのでロックなし
        return uid;
      });
      WD_DEBUG.forgeApi.persist();
      return uids;
    },
    ids,
  );
const [tonbo, mura, akaz, shiro, phoe, uchi, suya, doma] = await give(page, [
  "tonbokiri",
  "muramasa",
  "akazonae",
  "shirogane",
  "phoenix",
  "uchigatana",
  "suyari",
  "domaru",
]);
r = await ev(
  page,
  ([tonbo, uchi, akaz, phoe, suya]) => {
    const F = WD_DEBUG.forgeApi,
      a = WD_DEBUG.squadApi,
      S = WD_DEBUG.state().soldiers,
      h = S[0],
      s2 = S[1],
      base = a.soldierStats(h, true);
    const e1 = F.equipItem(h, tonbo),
      after = a.soldierStats(h, true);
    const e2 = F.equipItem(s2, tonbo); // 主人公が装備中
    const e3 = F.equipItem(h, uchi); // 槍兵は刀を使えない
    const e4 = F.equipItem(h, akaz);
    const e5 = F.equipItem(h, phoe);
    const slots = F.itemsOf(h).length;
    const e6 = F.equipItem(h, suya); // 同じ武器の枠：蜻蛉切は倉庫へ戻る
    const back = F.save().items.find((it) => it.uid === tonbo).owner;
    F.unequipItem(suya);
    F.equipItem(h, tonbo);
    return {
      e1,
      e2,
      e3,
      e4,
      e5,
      e6,
      slots,
      back,
      atk: after.atk / base.atk,
      range: after.range / base.range,
    };
  },
  [tonbo, uchi, akaz, phoe, suya],
);
check(
  "兵士に装備できる（武器・鎧・装飾品の3枠）",
  r.e1 === null && r.e4 === null && r.e5 === null && r.slots === 3,
  JSON.stringify(r),
);
check("同じ装備を別の兵士が同時に使えない", /装備中/.test(r.e2 || ""), r.e2);
check("職業で使えない武器は装備できない（槍兵に刀）", /刀を使えません/.test(r.e3 || ""), r.e3);
check("同じ枠に装備すると、前の装備は倉庫へ戻る", r.e6 === null && r.back === null);
check(
  // 攻撃の％は称号・精鋭などと足し合わせるので、ちょうど ×1.22 にはならない
  "装備で能力が上がる（蜻蛉切：攻撃 +22%・射程 +15%）",
  r.atk > 1.18 && r.atk < 1.22 + 1e-9 && Math.abs(r.range - 1.15) < 1e-9,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi;
  return {
    katana: ["ashigaru", "samurai", "ninja", "kensei"].every((j) => F.canWear(j, "uchigatana")),
    katanaNo: ["spearman", "archer", "gunner", "medic", "cavalry", "sohei"].every(
      (j) => !F.canWear(j, "uchigatana"),
    ),
    yari: ["spearman", "sohei", "cavalry"].every((j) => F.canWear(j, "suyari")),
    yumi: F.canWear("archer", "hankyu") && !F.canWear("gunner", "hankyu"),
    teppo: F.canWear("gunner", "hinawa") && !F.canWear("archer", "hinawa"),
    armor: ["ashigaru", "medic", "archer", "ninja"].every(
      (j) => F.canWear(j, "fudo") && F.canWear(j, "phoenix"),
    ),
  };
});
check("刀：足軽・侍・忍者・剣豪", r.katana && r.katanaNo);
check("槍：槍兵・僧兵・騎兵、弓：弓兵、鉄砲：鉄砲兵", r.yari && r.yumi && r.teppo);
check("鎧・装飾品はすべての職業", r.armor);
w = await wsave(page);
check(
  "装備者を保存（倉庫の装備に持ち主の兵士ID）",
  w.forge.items.filter((it) => it.owner === 1).length === 3,
  JSON.stringify(w.forge.items),
);
r = await ev(
  page,
  (uid) => {
    const F = WD_DEBUG.forgeApi,
      S = WD_DEBUG.state();
    document.getElementById("start").click();
    const e = F.equipItem(S.soldiers[2], uid),
      u = F.unequipItem(uid);
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
    return { e, u };
  },
  doma,
);
check("戦闘中は装備を変更できない", /戦闘中/.test(r.e || "") && /戦闘中/.test(r.u || ""), JSON.stringify(r));

console.log("■ 装備の戦闘効果");
r = await ev(page, () => {
  // 蜻蛉切：装甲35%無視
  const H = WD_DEBUG.heroApi,
    S = WD_DEBUG.state(),
    h = S.soldiers[0],
    o = S.soldiers[1];
  const mk = () => WD_DEBUG.addEnemy({ kind: "knight", hp: 1e6, speed: 0, armor: 30, d: 0 });
  const d1 = H.dealEnemyDamage(mk(), 100, { s: o }),
    d2 = H.dealEnemyDamage(mk(), 100, { s: h });
  S.enemies.length = 0;
  return { d1, d2 };
});
check(
  "蜻蛉切：敵の装甲を35%無視（装甲30の敵に 50 → 約60.6）",
  Math.abs(r.d1 - 50) < 1e-6 && Math.abs(r.d2 - 3000 / 49.5) < 1e-6,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    G = F.GEAR;
  // 試験用の兵士（装備の効果だけを見る）
  const mk = (ids, type = "ashigaru") => {
    const s = {
      id: 9000 + Math.floor(Math.random() * 1e6),
      type,
      job: type,
      level: 10,
      skills: [],
      hp: 1,
      alive: true,
    };
    const S = F.save();
    for (const id of ids) S.items.push({ uid: ++S.seq, id, owner: s.id });
    F.refreshGear();
    return s;
  };
  const clean = () => {
    const S = F.save();
    S.items = S.items.filter((it) => !(it.owner >= 9000));
    F.refreshGear();
  };
  const rnd = Math.random;
  const out = {};
  // 会心（備前長船：会心率6%）
  let s = mk(["osafune"]);
  F.refreshGear();
  Math.random = () => 0;
  out.crit = F.gearHitMul(s, 0);
  Math.random = () => 0.99;
  out.noCrit = F.gearHitMul(s, 0);
  // 雷切：15%で +60%、1.5秒は再発動しない
  s = mk(["raikiri"]);
  F.refreshGear();
  Math.random = () => 0;
  out.thunder = [F.gearHitMul(s, 10), F.gearHitMul(s, 11), F.gearHitMul(s, 11.6)];
  // 妖刀・政宗：HP半分以上で 30% → HP5%を使って +80%（3秒に1回）
  s = mk(["masamuneBlade"]);
  F.refreshGear();
  const max = a.soldierStats(s).maxHp;
  s.hp = max;
  out.renzan = [F.gearHitMul(s, 20), s.hp / max, F.gearHitMul(s, 21)];
  s.hp = max * 0.4;
  out.renzanLow = F.gearHitMul(s, 30);
  // 勾玉：発動率 ×1.3（独眼竜の黒鎧の回避 10% → 13%）
  Math.random = () => 0.12;
  s = mk(["kokuyoroi"]);
  F.refreshGear();
  const ev1 = WD_DEBUG.jobApi.evadeHit(s, 100);
  const s2 = mk(["kokuyoroi", "magatama"]);
  F.refreshGear();
  const ev2 = WD_DEBUG.jobApi.evadeHit(s2, 100);
  out.magatama = [ev1, ev2];
  Math.random = rnd;
  // 鎧
  const base = a.soldierStats(mk([]), true);
  const st = (ids) => a.soldierStats(mk(ids), true);
  F.refreshGear();
  out.fudo = st(["fudo"]).def / base.def;
  out.shiro = st(["shirogane"]).maxHp / base.maxHp;
  out.kishin = { atk: st(["kishin"]).atk / base.atk, heal: F.healTakenMul(mk(["kishin"])) };
  out.bushin = st(["bushin"]).atk / base.atk;
  out.shippu = st(["shippu"]).rate / base.rate;
  out.doujigiri = (() => {
    const x = mk(["doujigiri"]);
    F.refreshGear();
    return a.soldierStats(x, true).atk / base.atk;
  })();
  clean();
  return out;
});
check("会心：一撃 ×1.5（発動しなければ ×1）", r.crit === 1.5 && r.noCrit === 1, JSON.stringify(r));
check("雷切：雷撃 +60%、1.5秒は再発動しない", r.thunder.join() === "1.6,1,1.6", r.thunder.join());
check(
  "妖刀・政宗：HPを5%使って連撃 +80%、3秒は再発動しない、HPが半分未満なら使わない",
  r.renzan[0] === 1.8 && Math.abs(r.renzan[1] - 0.95) < 1e-9 && r.renzan[2] === 1 && r.renzanLow === 1,
  JSON.stringify(r.renzan),
);
check(
  "勾玉：確率で発動する効果の発動率 ×1.3（回避10% → 13%）",
  r.magatama[0] === false && r.magatama[1] === true,
  JSON.stringify(r.magatama),
);
check("不動の大鎧：防御 +45%", Math.abs(r.fudo - 1.45) < 1e-9, String(r.fudo));
check("白銀の神鎧：最大HP +25%", Math.abs(r.shiro - 1.25) < 0.01, String(r.shiro));
check(
  "鬼神の鎧：攻撃 +18%・受ける回復 -35%",
  Math.abs(r.kishin.atk - 1.18) < 1e-9 && Math.abs(r.kishin.heal - 0.65) < 1e-9,
  JSON.stringify(r.kishin),
);
check(
  "武神の指輪：攻撃 +12%、疾風の護符：攻撃間隔 -8%",
  Math.abs(r.bushin - 1.12) < 1e-9 && Math.abs(r.shippu - 0.92) < 1e-9,
);
check("童子切安綱：攻撃 +20%", Math.abs(r.doujigiri - 1.2) < 1e-9);
r = await ev(page, () => {
  // 上限：会心率は40%まで（試験用の会心率 +50% のスキルを付けても40%）
  const F = WD_DEBUG.forgeApi,
    K = WD_DEBUG.squadApi.SOLDIER_SKILLS,
    s = { id: 9100, type: "ashigaru", job: "ashigaru", level: 10, skills: ["tcrit"], hp: 1, alive: true };
  K.tcrit = { name: "試験", types: ["ashigaru"], crit: 0.5, text: "" };
  const rnd = Math.random;
  Math.random = () => 0.39;
  const a = F.gearHitMul(s, 0);
  Math.random = () => 0.41;
  const b = F.gearHitMul(s, 0);
  Math.random = rnd;
  delete K.tcrit;
  return { a, b };
});
check("会心率には上限（40%）がある", r.a === 1.5 && r.b === 1, JSON.stringify(r));
r = await ev(page, () => {
  // 不死鳥の護符：致命傷を1回だけ耐える。もう一度倒れれば戦死し、装備は倉庫へ戻る
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[1],
    s = a.members(q)[0],
    uid = F.save().items.find((it) => it.id === "phoenix").uid;
  F.unequipItem(uid);
  const e = F.equipItem(s, uid);
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  q.frontId = s.id;
  s.hp = 1;
  a.damageSquad(q, 9999, false);
  const first = { alive: s.alive, hp: s.hp, max: a.soldierStats(s).maxHp };
  s.hp = 1;
  a.damageSquad(q, 9999, false);
  const owner = F.save().items.find((it) => it.uid === uid).owner;
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  return {
    e,
    first,
    alive: s.alive,
    owner,
    saved: WD_DEBUG.squadApi.soldierSave().soldiers.some((v) => v.id === s.id),
    uid,
  };
});
check(
  "不死鳥の護符：致命傷を HP30% で耐える",
  r.e === null && r.first.alive && Math.abs(r.first.hp - Math.round(r.first.max * 0.3)) <= 1,
  JSON.stringify(r),
);
check("2回目の致命傷では一般兵は戦死（永久）", !r.alive && !r.saved, JSON.stringify(r));
check("戦死した兵士の装備は倉庫へ戻る（消えない・複製されない）", r.owner === null, JSON.stringify(r));
w = await wsave(page);
check(
  "倉庫に戻ったことも保存",
  w.forge.items.filter((it) => it.id === "phoenix").length === 1 &&
    w.forge.items.find((it) => it.id === "phoenix").owner === null,
);
r = await ev(page, () => {
  // 妖刀・村正：倒すと次の攻撃がすぐ出る（1秒に1回まで）
  const F = WD_DEBUG.forgeApi,
    s = { id: 9200, type: "ashigaru", job: "ashigaru", level: 10, skills: [], hp: 1, alive: true, cd: 5 },
    S = F.save();
  S.items.push({ uid: ++S.seq, id: "muramasa", owner: 9200 });
  F.refreshGear();
  const st = { rate: 1 };
  F.gearOnKill(s, st, 50);
  const a = s.cd;
  s.cd = 5;
  F.gearOnKill(s, st, 50.5);
  const b = s.cd;
  s.cd = 5;
  F.gearOnKill(s, st, 51.2);
  const c = s.cd;
  S.items = S.items.filter((it) => it.owner !== 9200);
  F.refreshGear();
  return { a, b, c };
});
check(
  "妖刀・村正：倒すと次の攻撃がすぐ出る（1秒に1回まで）",
  r.a === 0.4 && r.b === 5 && r.c === 0.4,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 転職・主人公の戦死・解散");
r = await ev(
  page,
  (akaz) => {
    const F = WD_DEBUG.forgeApi,
      J = WD_DEBUG.jobApi,
      h = WD_DEBUG.state().soldiers[0];
    seedJobEntry(h, ["samurai"]);
    const before = F.itemsOf(h)
      .map((it) => it.id)
      .sort();
    const err = J.changeJob(h, "samurai");
    const after = F.itemsOf(h)
      .map((it) => it.id)
      .sort();
    const tonbo = F.save().items.find((it) => it.id === "tonbokiri");
    const total = F.save().items.length;
    return {
      before,
      err,
      after,
      tonboOwner: tonbo.owner,
      total,
      msg: document.getElementById("msg").textContent,
    };
  },
  akaz,
);
check(
  "転職で使えなくなった武器（槍兵 → 侍で蜻蛉切）は倉庫へ戻る・鎧と装飾品はそのまま",
  r.err === null &&
    r.before.includes("tonbokiri") &&
    !r.after.includes("tonbokiri") &&
    r.after.includes("akazonae") &&
    r.tonboOwner === null,
  JSON.stringify(r),
);
check("お知らせを出す", /蜻蛉切は使えなくなったので装備倉庫に戻しました/.test(r.msg), r.msg);
r = await ev(
  page,
  (mura) => {
    const F = WD_DEBUG.forgeApi,
      a = WD_DEBUG.squadApi,
      S = WD_DEBUG.state(),
      h = S.soldiers[0],
      e = F.equipItem(h, mura);
    const n0 = F.save().items.length;
    // 主人公を戦死させる（防衛戦）
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    S.enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
    const q = S.squads[0];
    a.deployReserve(q, 650, 300);
    q.frontId = h.id;
    h.hp = 0.1;
    a.damageSquad(q, 99999, false);
    const res = {
      e,
      level: h.level,
      job: h.job,
      alive: h.alive,
      items: F.itemsOf(h)
        .map((it) => it.id)
        .sort(),
      mura: F.save().items.find((it) => it.uid === mura).owner,
      n: F.save().items.length === n0,
    };
    S.enemies.length = 0;
    WD_DEBUG.step(0.1);
    return res;
  },
  mura,
);
check(
  "主人公の戦死：Lv1・初期職（槍兵）に戻る",
  r.alive && r.level === 1 && r.job === "spearman",
  JSON.stringify(r),
);
check(
  "主人公の戦死：使えなくなった刀（村正）は倉庫へ、鎧・装飾品は残る（装備は失わない）",
  r.mura === null && r.items.includes("akazonae") && r.n,
  JSON.stringify(r),
);
r = await ev(page, () => {
  // 一般兵の解散：装備は倉庫へ
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[1],
    s = a.members(q)[0] || WD_DEBUG.squadApi.roster(q)[0],
    uid = F.save().items.find((it) => it.id === "domaru").uid;
  const e = F.equipItem(s, uid);
  a.orderRetreat && q.state === "deployed" && (q.state = "reserve");
  const d = a.disbandSquad(q);
  return { e, d, owner: F.save().items.find((it) => it.uid === uid).owner };
});
check(
  "部隊を解散すると装備は倉庫へ戻る",
  r.e === null && r.d === null && r.owner === null,
  JSON.stringify(r),
);

console.log("■ スキルの書");
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    J = WD_DEBUG.jobApi,
    h = WD_DEBUG.state().soldiers[0],
    S = F.save();
  S.books.goriki = 2;
  const n0 = S.books.goriki,
    e1 = F.useBook(h, "goriki"),
    n1 = S.books.goriki,
    e2 = F.useBook(h, "goriki"),
    n2 = S.books.goriki,
    e3 = F.useBook(h, "shinsoku"); // 持っていない
  return { n0, e1, n1, e2, n2, e3, learned: h.learned.includes("goriki"), eq: h.skills.includes("goriki") };
});
check(
  "スキルの書を使うと習得・装備（書は1冊減る）",
  r.e1 === null && r.n1 === 1 && r.learned && r.eq,
  JSON.stringify(r),
);
check(
  "習得済みのスキルには書を使わない（減らない）",
  /もう習得/.test(r.e2 || "") && r.n2 === 1,
  JSON.stringify(r),
);
check("持っていない書は使えない", /持っていません/.test(r.e3 || ""));
let sv = await ssave(page);
check("習得をすぐ保存", sv.soldiers.find((v) => v.id === 1).learned.includes("goriki"));
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    h = WD_DEBUG.state().soldiers[0];
  for (let i = 0; i < 200 && h.level < 30; i++) a.gainXp(h, 2000, true);
  seedJobEntry(h, ["samurai"]);
  J.changeJob(h, "samurai");
  const kept = h.learned.includes("goriki") && h.skills.includes("goriki");
  J.changeJob(h, "spearman");
  return { kept, k: a.SOLDIER_SKILLS.goriki };
});
check("転職しても秘伝スキルは残る", r.kept);
check("秘伝スキルは職業スキルと区別（book・職業なし）", r.k.book === 2 && !r.k.job);
r = await ev(page, () => {
  // 装備が20個埋まっていると、習得だけ（装備はしない）
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    K = a.SOLDIER_SKILLS,
    s = WD_DEBUG.state().soldiers[3],
    S = F.save();
  for (let i = 0; i < 20; i++) K["t" + i] = { name: "試" + i, types: ["spearman"], text: "" };
  const keep = s.skills.slice();
  s.skills = [];
  for (let i = 0; i < 20; i++) (s.learned.push("t" + i), s.skills.push("t" + i));
  S.books.kongo = (S.books.kongo || 0) + 1;
  const e = F.useBook(s, "kongo"),
    res = { e, learned: s.learned.includes("kongo"), eq: s.skills.includes("kongo"), n: s.skills.length };
  s.skills = keep;
  s.learned = s.learned.filter((id) => !/^t\d+$/.test(id));
  for (let i = 0; i < 20; i++) delete K["t" + i];
  return res;
});
check(
  "スキル装備は20個まで（埋まっていれば習得だけ）",
  r.e === null && r.learned && !r.eq && r.n === 20,
  JSON.stringify(r),
);
r = await ev(page, () => {
  // 主人公の戦死でも習得したスキルは残る
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    h = S.soldiers[0];
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const q = S.squads[0];
  a.deployReserve(q, 650, 300);
  q.frontId = h.id;
  h.hp = 0.1;
  a.damageSquad(q, 99999, false);
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  return { level: h.level, kept: h.learned.includes("goriki") };
});
check("主人公の戦死後も秘伝スキルは残る", r.level === 1 && r.kept, JSON.stringify(r));
check("エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 保存・再読み込み");
const before = await ev(page, () => JSON.stringify(WD_DEBUG.forgeApi.save()));
await reload(page);
r = await ev(page, () => ({
  save: JSON.stringify(WD_DEBUG.forgeApi.save()),
  owned: WD_DEBUG.forgeApi.owned(),
}));
check("再読み込みしても装備・装備者・書・欠片・履歴が同じ", r.save === before, r.save.slice(0, 200));
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    h = WD_DEBUG.state().soldiers[0];
  return F.itemsOf(h)
    .map((it) => it.id)
    .sort()
    .join();
});
check("主人公の装備も読み込める", /akazonae/.test(r), r);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 壊れた保存データ");
({ page, errors, context } = await newPage(
  Object.assign({}, oldWarlords, {
    forge: {
      shards: -5,
      seq: 2,
      items: [
        { uid: 1, id: "tonbokiri", owner: 1 },
        { uid: 1, id: "nihongo", owner: null }, // 同じ uid
        { uid: 3, id: "nope", owner: null }, // 知らない装備
        { uid: 4, id: "uchigatana", owner: 1 }, // 槍兵に刀
        { uid: 5, id: "suyari", owner: 1 }, // 同じ兵士の同じ枠
        { uid: 6, id: "domaru", owner: 999 }, // いない兵士
        { uid: 7, id: "fudo", owner: 2 },
      ],
      books: { goriki: 3, ironWall: 2, bad: 1, kongo: -1 },
      history: [{ w: "nope" }, { w: "kanbei", kind: "gear", tier: "hit", got: "tosei" }],
    },
  }),
  oldSoldiers,
));
r = await ev(page, () => {
  const S = WD_DEBUG.forgeApi.save();
  return { S, seq: S.seq };
});
check(
  "壊れた装備・書・履歴を正す（重複ID・知らない装備・書でないスキルを捨てる）",
  r.S.items.length === 5 &&
    r.S.shards === 0 &&
    JSON.stringify(r.S.books) === JSON.stringify({ goriki: 3 }) &&
    r.S.history.length === 1 &&
    r.seq >= 7,
  JSON.stringify(r.S),
);
check(
  "使えない・持ち主がいない・同じ枠の2つ目の装備は倉庫へ",
  JSON.stringify(r.S.items.map((it) => [it.id, it.owner])) ===
    JSON.stringify([
      ["tonbokiri", 1],
      ["uchigatana", null],
      ["suyari", null],
      ["domaru", null],
      ["fudo", 2],
    ]),
  JSON.stringify(r.S.items),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 防衛戦・攻城戦・修練場を装備で戦う");
({ page, errors, context } = await newPage(oldWarlords, oldSoldiers));
await give(page, [
  "tonbokiri",
  "nihongo",
  "akazonae",
  "kokuyoroi",
  "shirogane",
  "kishin",
  "fudo",
  "phoenix",
  "magatama",
  "shippu",
  "bushin",
  "omamori",
]);
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    ms = a.members(S.squads[0]),
    items = F.save().items.slice();
  const errs = [];
  for (const it of items) {
    const s = ms.find((m) => !F.slotItem(m, F.GEAR[it.id].slot) && F.canWear(m.job || m.type, it.id));
    if (s) errs.push(F.equipItem(s, it.uid));
  }
  return { errs: errs.filter(Boolean), worn: items.filter((it) => it.owner != null).length };
});
check("第一部隊に装備を配る", r.errs.length === 0 && r.worn === 12, JSON.stringify(r));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[0];
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  for (let k = 0; k < 6; k++) WD_DEBUG.addEnemy({ kind: "orc", d: 400 + k * 15, hp: 300, speed: 40 });
  for (let i = 0; i < 800 && WD_DEBUG.state().enemies.length; i++) WD_DEBUG.step(0.05);
  const left = WD_DEBUG.state().enemies.length;
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  return { left, playing: WD_DEBUG.state().playing, retreat: a.retreatTimeOf(q) };
});
check("防衛戦：装備した部隊で敵を倒せる", r.left === 0 && !r.playing, JSON.stringify(r));
check(
  "不動の大鎧の兵士がいると撤退に時間がかかる（3秒 → 3.9秒）",
  Math.abs(r.retreat - 3.9) < 1e-9,
  String(r.retreat),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  for (let i = 0; i < 2400 && a.battle(); i++) WD_DEBUG.step(0.05);
  return { done: !a.battle() };
});
check("攻城戦：装備した部隊で最後まで戦える", r.done, JSON.stringify(r));
await ev(page, () => document.getElementById("battleClose")?.click());
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[0];
  const err = T.startTraining("beginner");
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  for (let i = 0; i < 1200 && WD_DEBUG.state().playing; i++) WD_DEBUG.step(0.05);
  const res = { err, playing: WD_DEBUG.state().playing, wave: WD_DEBUG.state().wave };
  T.endTraining("retreat");
  return res;
});
check("修練場：装備した部隊で戦える", r.err === null && !r.playing && r.wave === 1, JSON.stringify(r));
r = await ev(page, () => WD_DEBUG.forgeApi.save().items.filter((it) => it.owner != null).length);
check("戦いの後も装備は残る（生存兵）", r > 0, String(r));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 画面（375×667）");
({ page, errors, context } = await newPage(oldWarlords, oldSoldiers, 375, 667));
check(
  "メニューに「🔥 秘伝錬成」「🎒 装備倉庫」",
  (await page.isVisible("#forgeOpen")) && (await page.isVisible("#gearOpen")),
);
await page.tap("#forgeOpen");
let text = await page.textContent("#forgeBody");
check(
  "錬成画面：種類・重複カードのある武将・確率表・欠片・履歴",
  /秘伝書錬成/.test(text) &&
    /装備錬成/.test(text) &&
    /真田幸村/.test(text) &&
    /所持 3枚・使える 2枚/.test(text) &&
    !/織田信長/.test(text) &&
    /大当たり/.test(text) &&
    /錬成の欠片 0\/20/.test(text),
  text.slice(0, 300),
);
check(
  "交換ボタンに必要な欠片（20）を表示・足りないと押せない",
  /交換（欠片20）/.test(await page.textContent('[data-forge-trade="kongo"]')) &&
    (await page.isDisabled('[data-forge-trade="kongo"]')) &&
    /欠片20個で/.test(text),
);
r = await ev(page, () =>
  [...document.querySelectorAll(".forge-rates tr")].map((tr) => tr.textContent).join("|"),
);
check(
  "レア度別の確率を表示",
  /R3%12%35%35%15%/.test(r) && /SR5%17%35%31%12%/.test(r) && /SSR8%22%34%27%9%/.test(r),
  r,
);
await page.tap('[data-forge-kind="gear"]');
await page.tap('[data-forge-pick="yukimura"]');
text = await page.textContent(".forge-confirm");
check(
  "消費前の確認：武将・レア度・枚数と★の変化",
  /真田幸村/.test(text) &&
    /SR/.test(text) &&
    /所持 3枚 → 2枚/.test(text) &&
    /★3 → ★2/.test(text) &&
    /最初の1枚は残ります/.test(text),
  text,
);
await page.tap("[data-forge-cancel]");
check("「やめる」で消費しない", (await wsave(page)).owned.yukimura === 3);
// 大当たりを出す（乱数を固定）
await ev(page, () => {
  crypto.getRandomValues = (a) => {
    a[0] = Math.floor(0.9999 * 4294967296);
    return a;
  };
});
await page.tap('[data-forge-pick="yukimura"]');
await page.tap("[data-forge-go]");
r = await ev(page, () => {
  const el = document.querySelector(".forge-result");
  return {
    cls: el && el.className,
    text: el && el.textContent,
    anim: el && getComputedStyle(el).animationName,
    color: el && getComputedStyle(el.querySelector(".forge-tier")).color,
  };
});
check(
  "大当たり：金色・光の演出・文字",
  /t-jackpot/.test(r.cls) &&
    /大当たり！/.test(r.text) &&
    r.anim === "jackpot" &&
    r.color === "rgb(240, 194, 79)",
  JSON.stringify(r),
);
check("伝説の品を獲得", /伝説/.test(r.text), r.text);
if (shots) await page.screenshot({ path: path.join(shots, "f1-jackpot.png") });
check("錬成するとカードが1枚減る", (await wsave(page)).owned.yukimura === 2);
await ev(page, () => {
  crypto.getRandomValues = (a) => {
    a[0] = 0;
    return a;
  };
});
await page.tap('[data-forge-pick="yukimura"]');
await page.tap("[data-forge-go]");
r = await ev(page, () => {
  const el = document.querySelector(".forge-result");
  return {
    cls: el.className,
    text: el.textContent,
    color: getComputedStyle(el.querySelector(".forge-tier")).color,
  };
});
check(
  "外れ：灰色・欠片 +1",
  /t-miss/.test(r.cls) && /錬成の欠片 \+1/.test(r.text) && r.color === "rgb(154, 163, 159)",
  JSON.stringify(r),
);
check(
  "重複がなくなった武将は一覧から消える",
  !/真田幸村/.test(
    (await page.textContent("#forgeBody")).split("重複カードのある武将")[1].split("抽選の確率")[0],
  ),
);
r = await ev(page, () => {
  const sh = document.querySelector("#forgeSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    btns = [...sh.querySelectorAll("button")];
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    wide: btns.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    minBtn: Math.min(
      ...btns.filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect().height),
    ),
  };
});
check(
  "錬成画面は画面に収まり、ボタンは44px以上",
  r.inView && !r.hScroll && r.wide && r.minBtn >= 44,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "f2-forge.png") });
await page.tap("#forgeClose");
await page.tap("#gearOpen");
await page.tap("[data-gear-row]"); // 一覧の行を押して開く
text = await page.textContent("#gearBody");
check(
  "装備倉庫：伝説の品・品質・効果・装備できる職業・倉庫の個数",
  /伝説/.test(text) && /装備できる職業/.test(text) && /倉庫に 1個/.test(text),
  text.slice(0, 300),
);
const uid = await ev(page, () => WD_DEBUG.forgeApi.save().items[0].uid);
const gid = await ev(page, () => WD_DEBUG.forgeApi.save().items[0].id);
await page.tap(`[data-gear-pick="${uid}"]`);
const pickers = await page.$$eval("[data-gear-to]", (bs) => bs.map((b) => +b.dataset.to));
check("「装備させる…」で装備できる兵士だけを選べる", pickers.length > 0, String(pickers));
await page.tap(`[data-gear-to="${uid}"][data-to="${pickers[0]}"]`);
r = await ev(page, (uid) => WD_DEBUG.forgeApi.save().items.find((it) => it.uid === uid).owner, uid);
check("倉庫から兵士に装備", r === pickers[0], String(r));
check("装備者を表示", /装備者：.*（/.test(await page.textContent("#gearBody")));
if (shots) await page.screenshot({ path: path.join(shots, "f3-store.png") });
await page.tap(`[data-gear-off="${uid}"]`);
check(
  "倉庫から外す",
  (await ev(page, (uid) => WD_DEBUG.forgeApi.save().items.find((it) => it.uid === uid).owner, uid)) === null,
);
await page.tap("#gearClose");
// 書を用意して、主人公育成画面から使う
await ev(page, () => {
  WD_DEBUG.forgeApi.save().books.mikiri = 1;
  WD_DEBUG.forgeApi.persist();
});
await page.tap("#heroGrowth");
check("主人公育成画面に装備の表示", /武器：/.test(await page.textContent("#hgBody")));
await page.tap("[data-hg-gear]");
text = await page.textContent("#gearBody");
check(
  "主人公育成画面から装備画面（3枠・倉庫の装備・スキルの書）",
  /武器/.test(text) && /鎧/.test(text) && /装飾品/.test(text) && /見切りの書/.test(text),
  text.slice(0, 200),
);
await page.tap('[data-book-use="mikiri"]');
check(
  "画面からスキルの書を使う",
  (await ev(page, () => WD_DEBUG.state().soldiers[0].learned.includes("mikiri"))) &&
    /習得しました/.test(await page.textContent("#gearBody")),
);
const legendUid = await ev(page, () => {
  const F = WD_DEBUG.forgeApi;
  const it = F.save().items.find((it) => it.owner == null && F.canWear("spearman", it.id));
  return it && it.uid;
});
if (legendUid) {
  await page.tap(`[data-gear-on="${legendUid}"]`);
  check(
    "兵士の画面から装備",
    (await ev(page, (u) => WD_DEBUG.forgeApi.save().items.find((it) => it.uid === u).owner, legendUid)) === 1,
  );
}
r = await ev(page, () => {
  const sh = document.querySelector("#gearSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    btns = [...sh.querySelectorAll("button")].filter((b) => b.getClientRects().length);
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minBtn: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    onTop: document.elementFromPoint(innerWidth / 2, rr.top + 20)?.closest("#gearSheet") !== null,
  };
});
check(
  "装備画面は画面に収まり、ボタンは44px以上、育成画面の上に開く",
  r.inView && !r.hScroll && r.minBtn >= 44 && r.onTop,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "f4-soldier.png") });
await page.keyboard.press("Escape");
check(
  "Escで装備画面だけ閉じる",
  (await page.isHidden("#gearSheet")) && !(await page.isHidden("#heroGrowthSheet")),
);
await page.tap("#hgClose");
await openInfoEntry(page, '#soldiers');
await page.tap('[data-gear-open="11"]');
check(
  "兵士名簿から装備画面を開ける",
  /装備：/.test(await page.textContent("#gearTitle")) && !(await page.isHidden("#gearSheet")),
);
await page.tap("#gearClose");
await page.tap("#soldierClose");
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
