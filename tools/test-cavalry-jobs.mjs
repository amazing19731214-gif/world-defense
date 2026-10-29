#!/usr/bin/env node
// 騎馬の上級職（騎馬鉄砲・槍騎兵・弓騎兵・赤備え）の確認：
// データと役割の違い（上位互換にならない）・Lv29/30の転職・戦い方（止まって撃つ・騎射砲撃・流鏑馬・突撃・猛攻・遠距離に弱い）・
// 防衛戦・攻城戦・修練場・ネームド兵士の転職・保存と再読み込み・図鑑・装備・転職画面（375×667）
//   node tools/test-cavalry-jobs.mjs
//   SCREENSHOTS=dir node tools/test-cavalry-jobs.mjs … 画面写真も保存
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
  FKEY = "worldDefense.siege.v1",
  ZKEY = "worldDefense.zukan.v1";
const NEW = ["kibateppo", "yarikiba", "yumikiba", "akazonae"];
// 4部隊×10人（Lv35）：それぞれ騎馬の上級職に転職ずみ（騎兵から）。保存データからそのまま読めることも確かめる
function jobSave() {
  const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
  NEW.forEach((j, q) => {
    save.squads.push({ id: q + 1, type: "cavalry", slot: q });
    for (let k = 0; k < 10; k++)
      save.soldiers.push({
        id: q * 10 + k + 1,
        type: "cavalry",
        job: j,
        jobs: ["cavalry", j],
        jobHist: [{ from: "cavalry", to: j, lv: 30 }],
        squadId: q + 1,
        level: 35,
        skills: [],
        learned: [],
      });
  });
  return save;
}
const formation = {
  version: 1,
  units: [0, 1, 2, 3].map((u) => ({
    soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
    hero: null,
  })),
};
async function newContext(seeds = {}, width = 390, height = 844) {
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
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate(() => WD_DEBUG.setGold(99999));
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

let { page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(jobSave()),
  [FKEY]: JSON.stringify(formation),
});

console.log("■ データと役割の違い");
let r = await ev(
  page,
  (NEW) => {
    const J = WD_DEBUG.jobApi,
      a = WD_DEBUG.squadApi;
    const at = (j) =>
      a.soldierStats(
        {
          id: 9999,
          type: J.JOBS[j].base,
          job: j,
          jobs: [j],
          level: 30,
          skills: [],
          learned: [],
          pts: {},
          prof: {},
          wavesSurvived: 0,
          kills: 0,
        },
        true,
      );
    const st = {};
    for (const j of [...NEW, "gunner", "archer", "cavalry"]) st[j] = at(j);
    return {
      names: NEW.map((j) => J.JOBS[j].name),
      adv: NEW.every((j) => J.JOBS[j].advanced && J.JOBS[j].base === "cavalry"),
      march: NEW.map((j) => J.JOB_UNITS[j].march),
      skills: NEW.map((j) =>
        J.JOBS[j].skills.map(([id]) => WD_DEBUG.squadApi.SOLDIER_SKILLS[id].name).join(),
      ),
      style: Object.fromEntries(NEW.map((j) => [j, J.jobStyle(j).attack])),
      st,
      old: [
        "ashigaru",
        "spearman",
        "archer",
        "gunner",
        "cavalry",
        "medic",
        "samurai",
        "ninja",
        "kensei",
        "sohei",
      ].every((j) => !J.JOBS[j].unit),
    };
  },
  NEW,
);
check(
  "4職：騎馬鉄砲・槍騎兵・弓騎兵・赤備え（上級職・騎兵の動き）",
  r.names.join() === "騎馬鉄砲,槍騎兵,弓騎兵,赤備え" && r.adv && r.march.every((m) => m === 1.8),
  JSON.stringify(r.names),
);
check(
  "固有スキル：騎射砲撃・槍騎突撃・流鏑馬・赤備えの猛攻",
  r.skills.join() === "騎射砲撃,槍騎突撃,流鏑馬,赤備えの猛攻",
  r.skills.join(),
);
check(
  "戦い方：騎馬鉄砲は鉄砲・弓騎兵は弓（遠距離）、槍騎兵・赤備えは近接",
  r.style.kibateppo === "鉄砲（遠距離）" &&
    r.style.yumikiba === "弓（遠距離）" &&
    r.style.yarikiba === "近接" &&
    r.style.akazonae === "近接",
  JSON.stringify(r.style),
);
check("既存の職業は変えていない（戦い方の上書きなし）", r.old);
const S = r.st;
check(
  "騎馬鉄砲：鉄砲兵より攻撃間隔が長い・一発は強い（高火力・遅い）",
  S.kibateppo.rate > S.gunner.rate && S.kibateppo.atk > S.gunner.atk,
  JSON.stringify([S.kibateppo, S.gunner]),
);
check(
  "弓騎兵：騎馬鉄砲より攻撃間隔が短い・4職でいちばん防御が低い",
  S.yumikiba.rate < S.kibateppo.rate && NEW.every((j) => j === "yumikiba" || S[j].def > S.yumikiba.def),
  JSON.stringify(S.yumikiba),
);
check(
  "槍騎兵：騎兵より攻撃が高く防御が低い（攻撃重視）",
  S.yarikiba.atk > S.cavalry.atk && S.yarikiba.def < S.cavalry.def,
);
check(
  "赤備え：騎兵より攻撃も防御も高い近接（遠距離は届かない）",
  S.akazonae.atk > S.cavalry.atk && S.akazonae.def > S.cavalry.def && S.akazonae.range <= 60,
);
// 上位互換にならない：どの2職でも、どちらにも相手より劣る能力がある（攻撃・防御・HP・速さ・射程）
const keys = [
  ["atk", 1],
  ["def", 1],
  ["maxHp", 1],
  ["rate", -1],
  ["range", 1],
];
let dominated = [];
for (const x of NEW)
  for (const y of NEW)
    if (x !== y && keys.every(([k, d]) => (S[x][k] - S[y][k]) * d >= 0)) dominated.push(x + ">" + y);
check("4職はどれも上位互換にならない", dominated.length === 0, dominated.join());

console.log("■ 転職：Lv29はできず、Lv30でできる");
r = await ev(
  page,
  (NEW) => {
    const a = WD_DEBUG.squadApi,
      J = WD_DEBUG.jobApi;
    WD_DEBUG.setGold(99999);
    const out = {};
    const s = WD_DEBUG.state().soldiers.find((x) => x.id === 10); // 騎馬鉄砲の部隊の1人を騎兵に戻してから試す
    J.changeJob(s, "cavalry");
    for (const j of NEW) {
      if (j === "kibateppo") continue;
      s.level = 29;
      out[j + "29"] = J.changeJob(s, j);
      s.level = 30;
      out[j] = J.changeJob(s, j);
      J.changeJob(s, "cavalry");
    }
    J.changeJob(s, "kibateppo"); // 元の職業に戻す（一度なった職業にはいつでも戻れる）
    return out;
  },
  NEW,
);
check(
  "Lv29では「Lv30から」と断られ、Lv30で転職できる",
  ["yarikiba", "yumikiba", "akazonae"].every((j) => /Lv30から/.test(r[j + "29"] || "") && r[j] === null),
  JSON.stringify(r),
);

console.log("■ 戦い方の効果");
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = { id: 1, skills: ["kishaHou"], aimFresh: true },
    m = [];
  for (let i = 0; i < 7; i++) m.push(J.jobHitMul(s, 0));
  const y = { id: 2, skills: ["yabusame"] },
    extra = [];
  for (let i = 0; i < 8; i++) extra.push(J.yabusameExtra(y));
  const f = { id: 3, skills: ["akaMoko"] },
    before = J.jobHitMul(f, 100);
  J.jobOnKill(f, 100);
  const during = J.jobHitMul(f, 102),
    after = J.jobHitMul(f, 106);
  const none = { id: 4, skills: [] };
  return { m, extra, before, during, after, none: [J.jobHitMul(none, 0), J.yabusameExtra(none)] };
});
check("騎射砲撃：止まってからの最初の一発と、その後5発ごとが ×2", r.m.join() === "2,1,1,1,1,2,1", r.m.join());
check("流鏑馬：4回に1回、もう1本続けて射る", r.extra.join() === "0,0,0,1,0,0,0,1", r.extra.join());
check(
  "赤備えの猛攻：敵を倒すと5秒間 攻撃 +30%",
  r.before === 1 && Math.abs(r.during - 1.3) < 1e-9 && r.after === 1,
  JSON.stringify(r),
);
check("スキルがなければ効果なし", r.none.join() === "1,0");

console.log("■ 防衛戦");
// 1部隊ずつ（650,300）に置いてウェーブを始め、止まった敵を攻撃させる（ウェーブの合間に撤退＝待機へ）
const fightOne = (page, i) =>
  ev(
    page,
    (i) => {
      const a = WD_DEBUG.squadApi,
        S = () => WD_DEBUG.state(),
        q = S().squads[i];
      for (const o of S().squads) if (o.state !== "reserve") a.orderRetreat(o);
      const placed = a.deployReserve(q, 650, 300);
      document.getElementById("start").click();
      WD_DEBUG.stopSpawning();
      S().enemies.length = 0;
      WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
      const e = WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 40, hp: 1e7, speed: 0 });
      const xp0 = a.members(q).reduce((n, s) => n + (s.waveXp || 0), 0);
      WD_DEBUG.step(0.5);
      const early = 1e7 - e.hp;
      WD_DEBUG.step(3.5);
      const out = {
        job: a.members(q)[0].job,
        placed,
        playing: S().playing,
        early,
        dmg: 1e7 - e.hp,
        xp: a.members(q).reduce((n, s) => n + (s.waveXp || 0), 0) - xp0,
      };
      S().enemies.length = 0;
      WD_DEBUG.step(0.1);
      out.cleared = !S().playing;
      a.orderRetreat(q);
      return out;
    },
    i,
  );
const res = [];
for (let i = 0; i < 4; i++) res.push(await fightOne(page, i));
check(
  "騎馬鉄砲：配置した直後（0.5秒）は狙いをつけて撃たない",
  res[0].job === "kibateppo" && res[0].early === 0,
  JSON.stringify(res[0]),
);
check("騎馬鉄砲：止まって狙ったあとは撃つ", res[0].dmg > 0, JSON.stringify(res[0]));
check(
  "弓騎兵はすぐ射る（止まって狙う必要はない）",
  res[2].job === "yumikiba" && res[2].early > 0,
  JSON.stringify(res[2]),
);
check(
  "防衛戦：4職とも敵を攻撃して経験値を得る・ウェーブをクリアできる",
  res.every((x) => x.dmg > 0 && x.xp > 0 && x.cleared),
  JSON.stringify(res),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    S = () => WD_DEBUG.state(),
    q = S().squads[0];
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const e = WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 40, hp: 1e7, speed: 0 });
  WD_DEBUG.step(2);
  // 部隊が動く（必殺技などで位置が変わる）→ もう一度止まって狙う
  q.x += 10;
  const hp0 = e.hp;
  WD_DEBUG.step(0.4);
  const waiting = a.members(q).every((s) => s.aimLeft > 0),
    dmg = hp0 - e.hp;
  WD_DEBUG.step(3);
  const after = hp0 - e.hp;
  S().enemies.length = 0;
  WD_DEBUG.step(0.1);
  a.orderRetreat(q);
  return { waiting, dmg, after };
});
check(
  "騎馬鉄砲：動いたら、また止まって狙うまで撃たない（狙ったあとはまた撃つ）",
  r.waiting && r.dmg === 0 && r.after > 0,
  JSON.stringify(r),
);
r = await ev(page, () => {
  // 遠距離に弱い（槍騎兵）：同じ兵士に遠距離と近接で同じ攻撃を当てて比べる。赤備えは弱点なし
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    hit = (q) => {
      const f = a.members(q)[0];
      f.skills = [];
      const max = a.soldierStats(f).maxHp;
      f.hp = max;
      a.damageSquad(q, 100, false, "goblin");
      const melee = max - f.hp;
      f.hp = max;
      a.damageSquad(q, 100, true, "dragon");
      const ranged = max - f.hp;
      f.hp = max;
      return ranged / melee;
    };
  return { yari: hit(S.squads[1]), aka: hit(S.squads[3]) };
});
check(
  "槍騎兵：遠距離攻撃から受けるダメージ ×1.3（赤備えは弱点なし）",
  Math.abs(r.yari - 1.3) < 0.01 && Math.abs(r.aka - 1) < 0.01,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 攻城戦");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  const err = a.startBattle();
  const B = a.battle();
  if (!B) return { err };
  WD_DEBUG.step(0.3);
  const g0 = B.groups.find((g) => g.list.some((s) => s.job === "kibateppo"));
  const marching = g0.state === "march";
  const waiting = g0.list.every((s) => !s.alive || s.aimLeft > 0);
  const hp0 =
    B.castleHp +
    B.garrison.reduce((n, e) => n + Math.max(0, e.hp), 0) +
    B.towers.reduce((n, t) => n + Math.max(0, t.hp || 0), 0);
  for (let i = 0; i < 120 && a.battle() && a.battle().castleHp > 0; i++) WD_DEBUG.step(0.5);
  const B2 = a.battle() || B;
  const hp1 =
    B2.castleHp +
    B2.garrison.reduce((n, e) => n + Math.max(0, e.hp), 0) +
    B2.towers.reduce((n, t) => n + Math.max(0, t.hp || 0), 0);
  const xp = B.groups.map((g) => g.list.reduce((n, s) => n + (s.xp || 0) + (s.level || 0) * 1000, 0));
  return { err, marching, waiting, dealt: hp0 - hp1, jobs: B.groups.filter((g) => g.list.length).map((g) => g.list[0].job), xp };
});
check(
  "攻城戦を始められる（4職の部隊）",
  r.err == null && r.jobs.join() === "kibateppo,yarikiba,yumikiba,akazonae",
  JSON.stringify(r),
);
check("攻城戦：騎馬鉄砲は進軍中は撃たない（止まってから）", r.marching && r.waiting, JSON.stringify(r));
check("攻城戦：4職の部隊で守備隊・塔・城にダメージを与える", r.dealt > 0, JSON.stringify(r));
await ev(page, () => WD_DEBUG.squadApi.battle() && WD_DEBUG.squadApi.retreatBattle());
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 修練場");
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(jobSave()) }));
r = await ev(page, () => WD_DEBUG.trainingApi.startTraining("beginner"));
const tres = [];
for (let i = 0; i < 4; i++) tres.push(await fightOne(page, i));
const ton = await ev(page, () => !!WD_DEBUG.trainingApi.training());
check(
  "修練場：4職とも敵を攻撃し、ウェーブをクリアできる",
  !r && ton && tres.every((x) => x.dmg > 0 && x.cleared),
  JSON.stringify({ r, tres }),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ ネームド兵士の転職・保存と再読み込み・図鑑・装備");
const named = {
  version: 1,
  seq: 3,
  squadSeq: 1,
  squads: [{ id: 1, type: "ashigaru", slot: 0 }],
  soldiers: [],
  fallen: [],
};
named.soldiers.push({
  id: 1,
  type: "ashigaru",
  squadId: 1,
  level: 30,
  skills: [],
  named: "hanzo",
  name: "服部半蔵",
});
named.soldiers.push({
  id: 2,
  type: "cavalry",
  squadId: 1,
  level: 30,
  skills: [],
  named: "masakage",
  name: "山県昌景",
});
named.soldiers.push({
  id: 3,
  type: "ashigaru",
  squadId: 1,
  level: 29,
  skills: [],
  named: "kotaro",
  name: "風魔小太郎",
});
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(named) }));
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    S = WD_DEBUG.state(),
    find = (id) => S.soldiers.find((s) => s.id === id);
  return {
    init: [1, 3].map((id) => find(id).jobs[0]),
    k29: J.changeJob(find(3), "kibateppo"),
    h: J.changeJob(find(1), "kibateppo"),
    m: J.changeJob(find(2), "akazonae"),
    after: [1, 2].map((id) => {
      const s = find(id);
      return s.named + ":" + s.name + ":" + s.type + ":" + s.job;
    }),
    skill: WD_DEBUG.namedApi.NAMED_SOLDIERS.hanzo.skill.name,
    zukan: WD_DEBUG.forgeApi.zukan().jobs,
  };
});
check(
  "服部半蔵・風魔小太郎の初期職は足軽のまま",
  r.init.join() === "ashigaru,ashigaru",
  JSON.stringify(r.init),
);
check("Lv29の風魔小太郎は騎馬鉄砲になれない", /Lv30から/.test(r.k29 || ""), r.k29);
check(
  "ネームド兵士も転職できる（服部半蔵→騎馬鉄砲・山県昌景→赤備え）、人物と名前はそのまま",
  r.h === null &&
    r.m === null &&
    r.after.join() === "hanzo:服部半蔵:cavalry:kibateppo,masakage:山県昌景:cavalry:akazonae",
  JSON.stringify(r.after),
);
check(
  "転職したら職業図鑑に登録",
  r.zukan.kibateppo === true && r.zukan.akazonae === true,
  JSON.stringify(r.zukan),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 1);
  return a.soldierStats(s).atk;
});
const atkBefore = r;
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    s1 = S.soldiers.find((x) => x.id === 1),
    s2 = S.soldiers.find((x) => x.id === 2);
  return {
    s: [s1, s2].map((s) => s.named + ":" + s.name + ":" + s.type + ":" + s.job + ":" + s.jobs.join("/")),
    atk: a.soldierStats(s1).atk,
    zukan: JSON.parse(localStorage.getItem("worldDefense.zukan.v1")).jobs,
  };
});
check(
  "再読み込みしても職業・人物・名前・転職の記録が残る（初期職は足軽のまま）",
  r.s.join() ===
    "hanzo:服部半蔵:cavalry:kibateppo:ashigaru/kibateppo,masakage:山県昌景:cavalry:akazonae:cavalry/akazonae",
  JSON.stringify(r.s),
);
check(
  "再読み込みしても能力は同じ（騎馬鉄砲の能力）",
  Math.abs(r.atk - atkBefore) < 1e-9,
  r.atk + " / " + atkBefore,
);
check("職業図鑑の記録を保存", r.zukan.kibateppo === true && r.zukan.akazonae === true);
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi;
  return {
    teppo: F.canWear("kibateppo", "hinawa"),
    yumi: F.canWear("yumikiba", "hankyu"),
    yari: F.canWear("yarikiba", "suyari") && F.canWear("akazonae", "suyari"),
    no: !F.canWear("yumikiba", "hinawa") && !F.canWear("akazonae", "hankyu"),
    count: F.zukanCount("jobs").total,
  };
});
check(
  "装備：騎馬鉄砲は鉄砲・弓騎兵は弓・槍騎兵と赤備えは槍",
  r.teppo && r.yumi && r.yari && r.no,
  JSON.stringify(r),
);
check("職業図鑑は21職業", r.count === 21, String(r.count));
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi;
  return { aka: J.profNeed("akazonae", 3), cav: J.profNeed("cavalry", 3) };
});
check("赤備えは熟練度が上がりにくい（必要な経験 ×1.5）", r.aka === r.cav * 1.5, JSON.stringify(r));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 転職画面（375×667）");
const ui = {
  version: 1,
  seq: 1,
  squadSeq: 1,
  heroId: 1,
  squads: [{ id: 1, type: "cavalry", slot: 0 }],
  soldiers: [{ id: 1, type: "cavalry", squadId: 1, level: 30, skills: [], name: "騎馬武者" }],
  fallen: [],
};
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(ui) }, 375, 667));
await page.tap("#heroGrowth");
await page.tap("[data-hg-job]");
r = await ev(page, () => {
  const body = document.getElementById("jobBody"),
    rows = [...body.querySelectorAll(".job-card")],
    vis = [...body.querySelectorAll("button")].filter((b) => b.getClientRects().length);
  return {
    rows: rows.length,
    open: body.querySelectorAll(".job-detail:not([hidden])").length,
    heads: body.querySelectorAll("[data-job-detail]").length,
    to: body.querySelectorAll("[data-job-to]").length,
    minH: Math.min(...vis.map((b) => b.getBoundingClientRect().height)),
    fit: vis.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    hScroll: document.documentElement.scrollWidth > innerWidth,
    rowH: Math.max(...rows.map((c) => c.getBoundingClientRect().height)),
    short: rows.find((c) => c.dataset.job === "kibateppo").querySelector(".js").textContent,
  };
});
check(
  "21職業を1行ずつ（詳しい説明は閉じている）・今の職業以外に転職ボタン",
  r.rows === 21 && r.open === 0 && r.heads === 21 && r.to === 20,
  JSON.stringify(r),
);
check(
  "1行に戦い方・動き・攻撃・射程（騎馬鉄砲：鉄砲・騎兵の動き）",
  /鉄砲・騎兵の動き・攻撃\d+・射程150/.test(r.short),
  r.short,
);
check(
  "375×667：行はコンパクト・ボタン44px以上・横にはみ出さない",
  r.rowH <= 96 && r.minH >= 44 && r.fit && !r.hScroll,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "c1-list.png") });
await page.tap('[data-job-detail="kibateppo"]');
r = await ev(page, () => {
  const d = document.querySelector('.job-card[data-job="kibateppo"] .job-detail');
  return {
    shown: !d.hidden,
    text: d.textContent,
    others: document.querySelectorAll(".job-detail:not([hidden])").length,
  };
});
check(
  "行を押すと詳しく：戦い方・動き・止まって撃つ・固有スキル・今の職業との比較",
  r.shown &&
    r.others === 1 &&
    /鉄砲（遠距離）/.test(r.text) &&
    /騎兵の動き/.test(r.text) &&
    /止まって/.test(r.text) &&
    /騎射砲撃/.test(r.text) &&
    /転職すると：攻撃[\d.]+→[\d.]+/.test(r.text) &&
    /射程60→150/.test(r.text),
  r.text,
);
if (shots) await page.screenshot({ path: path.join(shots, "c2-detail.png") });
await page.tap('[data-job-detail="akazonae"]');
r = await ev(page, () => ({
  kiba: document.querySelector('.job-card[data-job="kibateppo"] .job-detail').hidden,
  aka: document.querySelector('.job-card[data-job="akazonae"] .job-detail').textContent,
}));
check(
  "別の行を押すと、そちらだけ開く（赤備え：熟練度が上がりにくい）",
  r.kiba && /熟練度が上がりにくい/.test(r.aka) && /赤備えの猛攻/.test(r.aka),
  r.aka,
);
await page.tap('[data-job-to="yumikiba"]');
r = await ev(page, () => ({
  job: WD_DEBUG.state().soldiers[0].job,
  text: document.getElementById("jobBody").textContent,
}));
check(
  "転職ボタンで転職（弓騎兵）・結果を表示",
  r.job === "yumikiba" && /騎馬武者 は 弓騎兵 になった/.test(r.text) && /今の職業：.*弓騎兵/.test(r.text),
  r.text.slice(0, 120),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
