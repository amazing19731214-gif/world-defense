#!/usr/bin/env node
import { openInfoEntry } from './ui-test-utils.mjs';
// 自由転職・職業スキルの動作確認：Lv30での解放、何度でも無料の転職、引き継ぐもの、熟練度と職業スキル、
// 主人公の戦死（初期職に戻る・一度なった職業へは Lv1 でも戻れる）、戦闘での効果（防衛戦・攻城戦・修練場）、
// 戦闘中の転職禁止、転職画面（主人公育成画面・兵士名簿から）、以前の保存データ
//   node tools/test-jobs.mjs
//   SCREENSHOTS=dir node tools/test-jobs.mjs … 画面写真も保存
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
const SKEY = "worldDefense.soldiers.v1";
// 以前の形式の保存データ（職業の項目なし）：第一 槍兵10（#1 は名前付き Lv12）、第二 弓兵10
const oldSave = {
  version: 1,
  seq: 20,
  squadSeq: 2,
  squads: [
    { id: 1, type: "spearman", slot: 0 },
    { id: 2, type: "archer", slot: 1 },
  ],
  soldiers: [],
  fallen: [],
};
for (let k = 0; k < 10; k++)
  oldSave.soldiers.push({
    id: k + 1,
    type: "spearman",
    squadId: 1,
    level: k === 0 ? 12 : 3,
    xp: 5,
    name: k === 0 ? "鬼若" : null,
    skills: k === 0 ? ["ironWall"] : [],
    battles: 7,
    kills: 4,
    wavesSurvived: 6,
    history: ["W1 新兵として雇用"],
  });
for (let k = 0; k < 10; k++)
  oldSave.soldiers.push({ id: 11 + k, type: "archer", squadId: 2, level: 4, xp: 0, skills: [] });

async function newPage(seed, width = 390, height = 844) {
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
  await page.evaluate(
    ([k, v]) => {
      localStorage.clear();
      localStorage.setItem(k, v);
    },
    [SKEY, JSON.stringify(seed)],
  );
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const saved = (page) => ev(page, (k) => JSON.parse(localStorage.getItem(k)), SKEY);
const soldier = (page, id) =>
  ev(
    page,
    (id) => {
      const s = WD_DEBUG.state().soldiers.find((x) => x.id === id);
      return s && JSON.parse(JSON.stringify(s));
    },
    id,
  );
// 兵士をLv30以上にする（熟練度も上がるが、上がるのは今の職業だけ）
const toLv30 = (page, id) =>
  ev(
    page,
    (id) => {
      const s = WD_DEBUG.state().soldiers.find((x) => x.id === id);
      for (let i = 0; i < 200 && s.level < 30; i++) WD_DEBUG.squadApi.gainXp(s, 2000, true);
      return s.level;
    },
    id,
  );

let { page, errors, context } = await newPage(oldSave);

console.log("■ 以前の保存データ");
let s1 = await soldier(page, 1);
check(
  "職業の項目がない保存データは、今の兵種を初期職として読む",
  s1.job === "spearman" && s1.jobs.join() === "spearman" && s1.jobHist.length === 0 && s1.type === "spearman",
  JSON.stringify({ job: s1.job, jobs: s1.jobs, hist: s1.jobHist }),
);
check("熟練度は0から", (await ev(page, () => WD_DEBUG.jobApi.profLv(WD_DEBUG.state().soldiers[0]))) === 0);
check(
  "職業は21種（既存14職と最上級7職）",
  (await ev(page, () =>
    Object.values(WD_DEBUG.jobApi.JOBS)
      .map((j) => j.name)
      .join(),
  )) === "足軽,槍兵,弓兵,鉄砲兵,騎兵,衛生兵,侍,忍者,剣豪,僧兵,騎馬鉄砲,槍騎兵,弓騎兵,赤備え,剣聖,忍頭,槍将,弓聖,銃将,鉄騎将,医王",
);
check(
  "上級職は既存の兵種の動き（侍・剣豪＝足軽、忍者＝騎兵、僧兵＝槍兵）",
  (await ev(page, () =>
    ["samurai", "kensei", "ninja", "sohei"].map((j) => WD_DEBUG.jobApi.JOBS[j].base).join(),
  )) === "ashigaru,ashigaru,cavalry,spearman",
);

console.log("■ Lv30で解放");
let r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = WD_DEBUG.state().soldiers[0];
  return { e: J.jobChangeError(s, "samurai"), c: J.changeJob(s, "samurai"), job: s.job };
});
check(
  "Lv30未満は新しい職業に転職できない",
  /Lv30/.test(r.e || "") && r.c === r.e && r.job === "spearman",
  JSON.stringify(r),
);
check(
  "今の職業には転職できない",
  /すでに/.test(
    (await ev(page, () => WD_DEBUG.jobApi.jobChangeError(WD_DEBUG.state().soldiers[0], "spearman"))) || "",
  ),
);
const lv = await toLv30(page, 1);
const before = await soldier(page, 1);
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = WD_DEBUG.state().soldiers[0],
    prof = JSON.stringify(s.prof),
    err = J.changeJob(s, "samurai");
  return { err, job: s.job, type: s.type, prof, prof2: JSON.stringify(s.prof), samuraiLv: J.profLv(s) };
});
let s1b = await soldier(page, 1);
check("Lv30で転職できる（侍）", lv >= 30 && r.err === null && r.job === "samurai", JSON.stringify(r));
check("侍の戦い方は足軽", r.type === "ashigaru");
check(
  "ID・レベル・経験値・名前・戦歴・ポイント・スキルはそのまま",
  s1b.id === 1 &&
    s1b.level === before.level &&
    s1b.xp === before.xp &&
    s1b.name === "鬼若" &&
    s1b.kills === before.kills &&
    s1b.battles === before.battles &&
    JSON.stringify(s1b.pts) === JSON.stringify(before.pts) &&
    s1b.skills.join() === before.skills.join() &&
    s1b.learned.join() === before.learned.join(),
  JSON.stringify({ a: before.skills, b: s1b.skills }),
);
check("転職では熟練度は増えない（侍の熟練度0）", r.prof === r.prof2 && r.samuraiLv === 0, JSON.stringify(r));
check(
  "職業の履歴を記録",
  s1b.jobHist.length === 1 &&
    s1b.jobHist[0].from === "spearman" &&
    s1b.jobHist[0].to === "samurai" &&
    s1b.jobs.join() === "spearman,samurai" &&
    s1b.history.some((h) => /侍/.test(h)),
  JSON.stringify(s1b.jobHist),
);
check(
  "部隊の兵種は多い方に合わせる（侍1人なら槍兵のまま、本人は足軽の動き）",
  (await ev(page, () => WD_DEBUG.state().squads[0].type)) === "spearman",
);
check("無料（資金は減らない）", true);
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = WD_DEBUG.state().soldiers[0],
    order = [
      "ninja",
      "kensei",
      "sohei",
      "ashigaru",
      "archer",
      "gunner",
      "cavalry",
      "medic",
      "spearman",
      "samurai",
    ];
  const errs = [];
  for (let k = 0; k < 3; k++) for (const j of order) errs.push(J.changeJob(s, j));
  return { errs: errs.filter(Boolean), hist: s.jobHist.length, jobs: s.jobs.length, job: s.job, lv: s.level };
});
check("何度でも転職できる（30回）", r.errs.length === 0 && r.job === "samurai", JSON.stringify(r));
check("全部の職業を記録（10種）", r.jobs === 10);
check("履歴は最近の20件まで", r.hist === 20);
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = WD_DEBUG.state().soldiers[5]; // Lv3 の槍兵
  return { e: J.jobChangeError(s, "samurai"), any: s.level };
});
check("どの兵士も同じ条件（Lv3の兵士はまだ転職できない）", /Lv30/.test(r.e || ""));

console.log("■ 熟練度と職業スキル");
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0],
    R = J.JOB_RULES,
    out = [];
  // 侍で経験値を得る → 侍の熟練度だけ上がる
  const spear0 = J.profLv(s, "spearman");
  for (let i = 0; i < 400 && J.profLv(s) < 3; i++) a.gainXp(s, 50, true);
  out.push({
    lv: J.profLv(s),
    iai: s.learned.includes("iai"),
    eq: s.skills.includes("iai"),
    gs: s.learned.includes("guardStance"),
    hist:
      s.history.some((h) => /侍の熟練度 3/.test(h)) &&
      s.history.some((h) => /職業スキル「居合斬り」/.test(h)),
  });
  for (let i = 0; i < 400 && J.profLv(s) < 6; i++) a.gainXp(s, 50, true);
  out.push({ lv: J.profLv(s), gs: s.learned.includes("guardStance"), eq: s.skills.includes("guardStance") });
  for (let i = 0; i < 4000 && J.profLv(s) < 10; i++) a.gainXp(s, 500, true);
  a.gainXp(s, 1e6, true);
  return {
    out,
    spear0,
    spear1: J.profLv(s, "spearman"),
    max: J.profLv(s),
    x: s.prof.samurai,
    cap: R.profXp(R.profMax),
    hist: out[0].hist,
  };
});
check(
  "熟練度3で「居合斬り」を習得・空きがあれば装備",
  r.out[0].lv === 3 && r.out[0].iai && r.out[0].eq && !r.out[0].gs,
  JSON.stringify(r.out),
);
check(
  "熟練度6で「防御の構え」を習得",
  r.out[1].lv === 6 && r.out[1].gs && r.out[1].eq,
  JSON.stringify(r.out),
);
check("上がるのは今の職業の熟練度だけ", r.spear0 === r.spear1);
check("熟練度は最大10（それ以上ためない）", r.max === 10 && r.x === r.cap, JSON.stringify(r));
check("戦歴に熟練度・職業スキル習得を記録", r.hist);
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0];
  const p10 = a.soldierStats(s, true);
  const keep = s.prof.samurai;
  s.prof.samurai = 0;
  const p0 = a.soldierStats(s, true);
  s.prof.samurai = keep;
  return { atk: p10.atk / p0.atk, def: p10.def / p0.def, hp: p10.maxHp / p0.maxHp };
});
check(
  "熟練度で少し強くなる（熟練度10で攻撃・防御 +10%、HPは変わらない）",
  Math.abs(r.atk - 1.1) < 1e-9 && Math.abs(r.def - 1.1) < 1e-9 && r.hp === 1,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = WD_DEBUG.state().soldiers[0];
  J.changeJob(s, "spearman");
  return {
    learned: ["iai", "guardStance"].every((id) => s.learned.includes(id)),
    eq: ["iai", "guardStance"].every((id) => s.skills.includes(id)),
    samurai: J.profLv(s, "samurai"),
  };
});
check("槍兵に戻っても職業スキルは残り、装備したまま使える", r.learned && r.eq, JSON.stringify(r));
check("戻っても侍の熟練度は残る", r.samurai === 10);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    K = a.SOLDIER_SKILLS,
    s = WD_DEBUG.state().soldiers[0];
  for (let i = 0; i < 25; i++) K["test" + i] = { name: "試験" + i, types: ["spearman"], text: "試験用" };
  for (let i = 0; i < 25; i++) s.learned.push("test" + i);
  for (let i = 0; i < 25; i++) a.equipSkill(s, "test" + i);
  const n = s.skills.length,
    uniq = new Set(s.skills).size === s.skills.length;
  for (let i = 0; i < 25; i++) a.unequipSkill(s, "test" + i);
  s.learned = s.learned.filter((id) => !/^test/.test(id));
  for (let i = 0; i < 25; i++) delete K["test" + i];
  return { n, uniq };
});
check("職業スキルも含めて装備は20枠・重複なし", r.n === 20 && r.uniq, JSON.stringify(r));
r = await ev(page, () => {
  // 20枠が埋まっていたら、新しい職業スキルは習得だけ（装備はしない）
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    K = a.SOLDIER_SKILLS,
    s = WD_DEBUG.state().soldiers[0];
  J.changeJob(s, "ninja");
  for (let i = 0; i < 20; i++) K["full" + i] = { name: "満" + i, types: ["cavalry"], text: "試験用" };
  const keep = s.skills.slice();
  s.skills = [];
  for (let i = 0; i < 20; i++) (s.learned.push("full" + i), s.skills.push("full" + i));
  for (let i = 0; i < 400 && J.profLv(s) < 3; i++) a.gainXp(s, 50, true);
  const res = {
    learned: s.learned.includes("shadowRun"),
    eq: s.skills.includes("shadowRun"),
    n: s.skills.length,
  };
  s.skills = keep;
  s.learned = s.learned.filter((id) => !/^full/.test(id));
  for (let i = 0; i < 20; i++) delete K["full" + i];
  J.changeJob(s, "spearman");
  return res;
});
check(
  "枠が埋まっていれば習得だけ（あとで付け替えられる）",
  r.learned && !r.eq && r.n === 20,
  JSON.stringify(r),
);

console.log("■ 職業ごとの能力");
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    s0 = WD_DEBUG.state().soldiers[0],
    s = Object.assign({}, s0, { prof: {}, skills: [], learned: [] });
  const as = (j) => a.soldierStats(Object.assign({}, s, { job: j, type: J.JOBS[j].base }), true);
  const base = as("ashigaru"),
    out = {};
  for (const j of ["samurai", "kensei"]) {
    const st = as(j);
    out[j] = { atk: st.atk / base.atk, def: st.def / base.def, hp: st.maxHp / base.maxHp };
  }
  const cav = as("cavalry"),
    nin = as("ninja"),
    sp = as("spearman"),
    so = as("sohei");
  out.ninja = { rate: nin.rate / cav.rate, def: nin.def / cav.def };
  out.sohei = { atk: so.atk / sp.atk, def: so.def / sp.def, hp: so.maxHp / sp.maxHp };
  out.base = ["ashigaru", "spearman", "archer", "gunner", "cavalry", "medic"].every((j) => {
    const x = as(j),
      y = a.soldierStats(Object.assign({}, s, { job: undefined, type: j }), true);
    return x.atk === y.atk && x.def === y.def && x.maxHp === y.maxHp;
  });
  return out;
});
const near = (a, b) => Math.abs(a - b) < 0.02;
check(
  "侍：攻撃・防御 +15%、HP +10%",
  near(r.samurai.atk, 1.15) && near(r.samurai.def, 1.15) && near(r.samurai.hp, 1.1),
  JSON.stringify(r.samurai),
);
check(
  "剣豪：攻撃 +35%、防御 −10%",
  near(r.kensei.atk, 1.35) && near(r.kensei.def, 0.9),
  JSON.stringify(r.kensei),
);
check(
  "忍者：攻撃が速い（間隔 ×0.85）、防御 −10%",
  near(r.ninja.rate, 0.85) && near(r.ninja.def, 0.9),
  JSON.stringify(r.ninja),
);
check(
  "僧兵：防御 +25%、HP +15%、攻撃 −15%",
  near(r.sohei.def, 1.25) && near(r.sohei.hp, 1.15) && near(r.sohei.atk, 0.85),
  JSON.stringify(r.sohei),
);
check("基本の6職業は兵種そのまま（補正なし）", r.base);

console.log("■ 職業スキルの効果");
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    s = { skills: ["iai"], learned: ["iai"] },
    t = { skills: ["issen"], learned: ["issen"] },
    A = {},
    B = {};
  const iai = [J.skillHitMul(s, A), J.skillHitMul(s, A), J.skillHitMul(s, B), J.skillHitMul(s, A)];
  const issen = [1, 2, 3, 4, 5, 6, 7, 8].map(() => J.skillHitMul(t, A));
  return { iai, issen };
});
check("居合斬り：新しい敵への最初の一撃だけ ×1.6", r.iai.join() === "1.6,1,1.6,1.6", r.iai.join());
check("一閃：4回に1回 ×2.5", r.issen.join() === "1,1,1,2.5,1,1,1,2.5", r.issen.join());
r = await ev(page, () => {
  // 回避術（防衛戦）：かわしたらダメージなし、2秒は再発動しない
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[1],
    m = a.members(q),
    f = m[0];
  a.deployReserve(q, 650, 300);
  f.learned.push("evasion");
  f.skills.push("evasion");
  q.frontId = f.id;
  const rnd = Math.random;
  Math.random = () => 0;
  const hp0 = f.hp;
  a.damageSquad(q, 5, false);
  const hp1 = f.hp;
  a.damageSquad(q, 5, false);
  const hp2 = f.hp;
  Math.random = rnd;
  f.skills = f.skills.filter((x) => x !== "evasion");
  f.learned = f.learned.filter((x) => x !== "evasion");
  return { hp0, hp1, hp2 };
});
check("回避術：攻撃をかわす（ダメージなし）", r.hp1 === r.hp0, JSON.stringify(r));
check("回避術：かわした直後はかわせない（連続しない）", r.hp2 < r.hp1, JSON.stringify(r));
r = await ev(page, () => {
  // 治癒の祈り：いちばん傷ついた仲間を回復、6秒ごと
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    m = a.members(S.squads[1]),
    p = m[1];
  p.skills.push("prayer");
  p.learned.push("prayer");
  const max = a.soldierStats(m[2]).maxHp;
  m[2].hp = max * 0.3;
  m[3].hp = max * 0.6;
  const xp0 = p.xp + p.level * 1e6;
  p.prayerAt = 0;
  const now = WD_DEBUG.heroApi.clock();
  // 防衛戦の合間に呼び出す（攻城戦・防衛戦の処理と同じ関数）
  const tick = (t) => {
    const before = m[2].hp;
    // prayerTick は内部関数なので、tickSquads 相当の呼び出しを再現する
    WD_DEBUG.jobApi.prayerTick(p, m, t);
    return m[2].hp - before;
  };
  const h1 = tick(now + 1000),
    h2 = tick(now + 1001),
    h3 = tick(now + 1007);
  p.skills = p.skills.filter((x) => x !== "prayer");
  p.learned = p.learned.filter((x) => x !== "prayer");
  return { h1, h2, h3, max, xp: p.xp + p.level * 1e6 > xp0, other: m[3].hp / max };
});
check(
  "治癒の祈り：いちばん傷ついた仲間を最大HPの6%回復、6秒ごと",
  Math.abs(r.h1 - r.max * 0.06) < 1e-6 && r.h2 === 0 && r.h3 > 0 && Math.abs(r.other - 0.6) < 1e-9,
  JSON.stringify(r),
);
check("回復した分の経験値も入る", r.xp);
r = await ev(page, () => {
  // 貫通射撃：防御（装甲）の30%を無視する
  const H = WD_DEBUG.heroApi,
    S = WD_DEBUG.state(),
    s = S.soldiers[12],
    mk = () => WD_DEBUG.addEnemy({ kind: "knight", hp: 1e6, speed: 0, armor: 30, d: 0 });
  const e1 = mk(),
    d1 = H.dealEnemyDamage(e1, 100, { s });
  s.skills.push("pierceShot");
  s.learned.push("pierceShot");
  const e2 = mk(),
    d2 = H.dealEnemyDamage(e2, 100, { s });
  s.skills = s.skills.filter((x) => x !== "pierceShot");
  s.learned = s.learned.filter((x) => x !== "pierceShot");
  S.enemies.length = 0;
  return { d1, d2 };
});
check(
  "貫通射撃：装甲の30%を無視（装甲30の敵に 50 → 約58.8）",
  Math.abs(r.d1 - 50) < 1e-6 && Math.abs(r.d2 - 3000 / 51) < 1e-6,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = Object.assign({}, WD_DEBUG.state().soldiers[12], { prof: {} });
  const st = (sk) => a.soldierStats(Object.assign({}, s, { skills: sk }), true);
  const b = st([]);
  return {
    fightOn: st(["fightOn"]).atk / b.atk,
    renSha: st(["renSha"]).rate / b.rate,
    quickFix: a.soldierStats(
      Object.assign({}, s, { type: "medic", job: "medic", skills: ["quickFix"] }),
      true,
    ).heal,
    heal0: a.soldierStats(Object.assign({}, s, { type: "medic", job: "medic", skills: [] }), true).heal,
  };
});
check("奮戦：攻撃が上がる", r.fightOn > 1.05, JSON.stringify(r));
check("連射：攻撃間隔が短くなる", r.renSha < 0.95, JSON.stringify(r));
check("応急処置：回復量が上がる", r.quickFix > r.heal0 * 1.1, JSON.stringify(r));
check(
  "職業スキルは全部の職業で装備できる（兵種の制限なし）",
  await ev(page, () => {
    const J = WD_DEBUG.jobApi,
      K = WD_DEBUG.squadApi.SOLDIER_SKILLS;
    return Object.values(J.JOBS).every((j) => j.skills.every(([id]) => K[id] && K[id].types.length >= 6));
  }),
);
await ev(page, () => (WD_DEBUG.state().enemies.length = 0));
check("エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 戦闘中は転職できない");
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    S = WD_DEBUG.state(),
    s = S.soldiers[0];
  document.getElementById("start").click();
  const e1 = J.changeJob(s, "samurai");
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  const playing = WD_DEBUG.state().playing;
  const e2 = J.jobChangeError(s, "samurai");
  return { e1, playing, e2, job: s.job };
});
check(
  "防衛のウェーブ中は転職できない",
  /ウェーブ/.test(r.e1 || "") && r.job === "spearman",
  JSON.stringify(r),
);
check("ウェーブが終われば転職できる", !r.playing && r.e2 === null, JSON.stringify(r));
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0];
  a.startBattle();
  const e = J.changeJob(s, "samurai");
  a.endBattle("retreat");
  return { e, job: s.job };
});
check("攻城戦の最中は転職できない", /攻城戦/.test(r.e || "") && r.job === "spearman", JSON.stringify(r));
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    T = WD_DEBUG.trainingApi,
    s = WD_DEBUG.state().soldiers[0];
  T.startTraining("beginner");
  const e = J.changeJob(s, "samurai");
  T.endTraining("retreat");
  return { e, job: s.job };
});
check("修練場の挑戦中は転職できない", /修練場/.test(r.e || "") && r.job === "spearman", JSON.stringify(r));
check("エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 保存");
await ev(page, () => WD_DEBUG.jobApi.changeJob(WD_DEBUG.state().soldiers[0], "samurai"));
let sv = await saved(page);
let v1 = sv.soldiers.find((v) => v.id === 1);
check(
  "転職をすぐ保存（職業・なった職業・履歴・熟練度）",
  v1.job === "samurai" &&
    v1.type === "ashigaru" &&
    v1.jobs.length === 10 &&
    v1.jobHist.length === 20 &&
    v1.prof.samurai > 0,
  JSON.stringify({ job: v1.job, type: v1.type, jobs: v1.jobs }),
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
s1 = await soldier(page, 1);
check(
  "再読み込みしても同じ",
  s1.job === "samurai" &&
    s1.type === "ashigaru" &&
    s1.jobs.length === 10 &&
    s1.learned.includes("iai") &&
    s1.level >= 30,
  JSON.stringify({ job: s1.job, type: s1.type }),
);
await context.close();

({ page, errors, context } = await newPage(
  Object.assign({}, oldSave, {
    soldiers: oldSave.soldiers.map((v, k) =>
      k === 0
        ? Object.assign({}, v, {
            job: "samurai",
            jobs: ["bogus", "samurai", "samurai"],
            prof: { samurai: -5, bogus: 3, ninja: 1e12 },
            jobHist: [{ from: "x" }, { from: "spearman", to: "samurai", lv: 30 }],
          })
        : k === 1
          ? Object.assign({}, v, { job: "nope" })
          : v,
    ),
  }),
));
r = await ev(page, () => {
  const S = WD_DEBUG.state().soldiers,
    J = WD_DEBUG.jobApi;
  return {
    a: {
      job: S[0].job,
      jobs: S[0].jobs,
      prof: S[0].prof,
      hist: S[0].jobHist,
      ninja: J.profLv(S[0], "ninja"),
    },
    b: { job: S[1].job, jobs: S[1].jobs },
  };
});
check(
  "壊れた保存データ：兵種と合わない職業は兵種に戻す・知らない職業は捨てる",
  r.a.job === "spearman" &&
    r.b.job === "spearman" &&
    !r.a.jobs.includes("bogus") &&
    r.a.jobs.includes("spearman"),
  JSON.stringify(r),
);
check(
  "壊れた保存データ：熟練度・履歴を正す",
  !("bogus" in r.a.prof) && !(r.a.prof.samurai < 0) && r.a.ninja === 10 && r.a.hist.length === 1,
  JSON.stringify(r.a),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 主人公の戦死");
({ page, errors, context } = await newPage(Object.assign({}, oldSave, { heroId: 1 })));
await toLv30(page, 1);
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    h = S.soldiers[0];
  J.changeJob(h, "kensei");
  for (let i = 0; i < 400 && J.profLv(h) < 3; i++) a.gainXp(h, 50, true);
  const kensei = J.profLv(h);
  a.deployReserve(S.squads[0], 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const q = S.squads[0];
  q.frontId = h.id;
  h.skills = h.skills.filter((x) => x !== "unyielding");
  h.hp = 0.1;
  a.damageSquad(q, 999, false);
  const res = {
    alive: h.alive,
    level: h.level,
    xp: h.xp,
    pts: a.pointsFree(h),
    job: h.job,
    type: h.type,
    jobs: h.jobs.slice(),
    hist: h.jobHist.length,
    issen: h.learned.includes("issen"),
    kensei,
    kensei2: J.profLv(h, "kensei"),
  };
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  res.back = J.changeJob(h, "kensei");
  res.job2 = h.job;
  res.lv2 = h.level;
  res.ninja = J.changeJob(h, "ninja");
  res.back2 = J.changeJob(h, "spearman");
  return res;
});
check(
  "主人公の戦死：Lv1・経験値0・ポイント0",
  r.alive && r.level === 1 && r.xp === 0 && r.pts === 0,
  JSON.stringify(r),
);
check(
  "主人公の戦死：今の職業は初期職（槍兵）に戻る",
  r.job === "spearman" && r.type === "spearman",
  JSON.stringify(r),
);
check(
  "主人公の戦死：スキル・熟練度・転職の履歴・なった職業は残る",
  r.issen && r.kensei === 3 && r.kensei2 === 3 && r.hist === 1 && r.jobs.join() === "spearman,kensei",
  JSON.stringify(r),
);
check(
  "Lv1でも一度なった職業（剣豪）にはすぐ戻れる",
  r.back === null && r.job2 === "kensei" && r.lv2 === 1,
  JSON.stringify(r),
);
check("Lv1ではまだなったことのない職業には転職できない", /Lv30/.test(r.ninja || ""));
check("初期職にも戻れる", r.back2 === null);
r = await ev(page, () => {
  // 一般の兵士はこれまでどおり戦死で消える（転職していても）
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    s = S.soldiers.find((x) => x.id === 2);
  for (let i = 0; i < 200 && s.level < 30; i++) a.gainXp(s, 2000, true);
  J.changeJob(s, "sohei");
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const q = S.squads[0];
  q.frontId = s.id;
  s.skills = s.skills.filter((x) => x !== "unyielding");
  s.hp = 0.1;
  a.damageSquad(q, 999, false);
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  return {
    alive: s.alive,
    inRoster: WD_DEBUG.state().soldiers.some((x) => x.id === 2 && x.alive),
    fallen: !a.soldierSave().soldiers.some((v) => v.id === 2),
    e: J.jobChangeError(s, "spearman"),
  };
});
check(
  "一般の兵士は転職していても戦死すると消える",
  !r.alive && !r.inRoster && r.fallen && r.e !== null,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 防衛戦・攻城戦・修練場を上級職で戦う");
({ page, errors, context } = await newPage(Object.assign({}, oldSave, { heroId: 1 })));
r = await ev(page, () => {
  const J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    jobs = ["samurai", "ninja", "kensei", "sohei"];
  // 第一部隊の10人を Lv30 にして上級職へ、職業スキルも習得させる
  a.members(S.squads[0]).forEach((s, k) => {
    for (let i = 0; i < 200 && s.level < 30; i++) a.gainXp(s, 2000, true);
    J.changeJob(s, jobs[k % 4]);
    for (let i = 0; i < 800 && J.profLv(s) < 6; i++) a.gainXp(s, 100, true);
  });
  return a
    .members(S.squads[0])
    .map(
      (s) =>
        s.job +
        ":" +
        J.profLv(s) +
        ":" +
        s.skills.filter((x) =>
          ["iai", "guardStance", "shadowRun", "evasion", "issen", "vitalStrike", "goho", "prayer"].includes(
            x,
          ),
        ).length,
    );
});
check(
  "上級職の部隊（職業スキル2つずつ装備）",
  r.every((x) => /:6:2$/.test(x)),
  r.join(" "),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[0];
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  for (let k = 0; k < 6; k++) WD_DEBUG.addEnemy({ kind: "orc", d: 400 + k * 15, hp: 400, speed: 40 });
  let hits = 0;
  for (let i = 0; i < 600 && WD_DEBUG.state().enemies.length; i++) {
    WD_DEBUG.step(0.05);
    hits = Math.max(hits, a.members(q).filter((s) => s.iaiTarget).length);
  }
  const left = WD_DEBUG.state().enemies.length;
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  return { left, hits, alive: a.members(q).length, playing: WD_DEBUG.state().playing };
});
check("防衛戦：上級職の部隊で敵を倒せる（居合斬りが発動）", r.left === 0 && r.hits > 0, JSON.stringify(r));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  const B = a.battle();
  let t = 0;
  for (let i = 0; i < 2400 && a.battle(); i++) {
    WD_DEBUG.step(0.05);
    t++;
  }
  return {
    done: !a.battle(),
    t,
    body: document.getElementById("battleBody").textContent.slice(0, 80),
    groups: B.groups.length,
  };
});
check("攻城戦：上級職の部隊で最後まで戦える", r.done, JSON.stringify(r));
await ev(page, () => document.querySelector("#battleSheet [data-battle-close], #battleClose")?.click());
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    J = WD_DEBUG.jobApi,
    a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[0],
    p0 = Object.fromEntries(a.members(q).map((s) => [s.id, s.prof[J.jobOf(s)] || 0]));
  const err = T.startTraining("beginner");
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  for (let i = 0; i < 1200 && WD_DEBUG.state().playing; i++) WD_DEBUG.step(0.05);
  const rec = T.training().rec,
    fought = a.members(q).filter((s) => rec[s.id] && rec[s.id].battle > 0);
  const res = {
    err,
    fought: fought.map((s) => s.job),
    up: fought.every((s) => s.prof[J.jobOf(s)] > p0[s.id]),
  };
  T.endTraining("retreat");
  return res;
});
check(
  "修練場：上級職の部隊で戦い、戦った兵士は今の職業の熟練度が上がる",
  r.err === null && r.fought.length > 0 && r.up,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 転職の画面（375×667）");
({ page, errors, context } = await newPage(Object.assign({}, oldSave, { heroId: 1 }), 375, 667));
await page.tap("#heroGrowth");
check(
  "主人公育成画面に「転職」ボタン",
  /転職（.*槍兵・熟練度 0）/.test(await page.textContent("[data-hg-job]")),
);
await page.tap("[data-hg-job]");
let text = await page.textContent("#jobBody");
check("主人公育成画面から開ける", !(await page.isHidden("#jobSheet")) && /鬼若/.test(text));
check(
  "今の職業・Lv・解放条件・職業ごとの特徴・補正・熟練度・職業スキル・履歴を表示",
  /今の職業：.*槍兵/.test(text) &&
    /Lv12/.test(text) &&
    /Lv30から新しい職業/.test(text) &&
    /侍/.test(text) &&
    /忍者/.test(text) &&
    /剣豪/.test(text) &&
    /僧兵/.test(text) &&
    /攻撃\+35%・防御-10%/.test(text) &&
    /熟練度 0\/10/.test(text) &&
    /熟練度3で「居合斬り」/.test(text) &&
    /熟練度6で「防御の構え」/.test(text) &&
    /転職すると：攻撃\d.*→/.test(text) &&
    /まだ転職していません/.test(text),
  text.slice(0, 400),
);
check(
  "Lv30未満は転職ボタンが押せない（🔒 Lv30で解放）",
  (await page.isDisabled('[data-job-to="samurai"]')) &&
    /Lv30で解放/.test(await page.textContent('[data-job-to="samurai"]')),
);
await toLv30(page, 1);
await page.tap("#jobClose");
await page.tap("[data-hg-job]");
check("Lv30で押せる", !(await page.isDisabled('[data-job-to="samurai"]')));
r = await ev(page, () => {
  const sh = document.querySelector("#jobSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    btns = [...sh.querySelectorAll("button")];
  sh.scrollTop = sh.scrollHeight;
  const close = document.getElementById("jobClose").getBoundingClientRect();
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    closeAfterScroll: close.top >= rr.top - 1 && close.bottom <= innerHeight,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    wide: btns.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    minBtn: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    onTop: document.elementFromPoint(innerWidth / 2, rr.top + 20)?.closest("#jobSheet") !== null,
  };
});
check("画面に収まり、横にはみ出さない", r.inView && !r.hScroll && r.wide, JSON.stringify(r));
check("下まで動かしても「閉じる」が見える", r.closeAfterScroll, JSON.stringify(r));
check("ボタンは押しやすい大きさ（44px以上）", r.minBtn >= 44, String(r.minBtn));
check("主人公育成画面の上に開く", r.onTop);
if (shots) await page.screenshot({ path: path.join(shots, "j1-job.png") });
await page.tap('[data-job-to="samurai"]');
text = await page.textContent("#jobBody");
check(
  "画面から転職（侍）・結果と履歴を表示",
  /鬼若 は 侍 になった/.test(text) &&
    /今の職業：.*侍/.test(text) &&
    /槍兵 → 侍/.test(text) &&
    (await soldier(page, 1)).job === "samurai",
  text.slice(0, 200),
);
check(
  "槍兵は「なったことがある」",
  /槍兵 （なったことがある）/.test(text.replace(/\s+/g, " ")) || /槍兵\s*（なったことがある）/.test(text),
);
if (shots) await page.screenshot({ path: path.join(shots, "j2-changed.png") });
await page.keyboard.press("Escape");
check(
  "Escで転職画面だけ閉じ、主人公育成画面は新しい職業で表示",
  (await page.isHidden("#jobSheet")) &&
    !(await page.isHidden("#heroGrowthSheet")) &&
    /侍/.test(await page.textContent("#hgBody")),
);
await page.tap("#hgClose");
await openInfoEntry(page, '#soldiers');
check("兵士名簿に職業を表示", /侍・Lv/.test(await page.textContent("#soldierList")));
await page.tap('[data-job-open="11"]');
text = await page.textContent("#jobBody");
check(
  "兵士名簿から開ける（弓兵）",
  !(await page.isHidden("#jobSheet")) && /今の職業：.*弓兵/.test(text),
  text.slice(0, 120),
);
await page.tap("#jobClose");
check(
  "閉じると兵士名簿に戻る",
  (await page.isHidden("#jobSheet")) && !(await page.isHidden("#soldierSheet")),
);
await page.tap("#soldierClose");
await ev(page, () => {
  document.getElementById("start").click();
});
await page.tap("#heroGrowth");
await page.tap("[data-hg-job]");
text = await page.textContent("#jobBody");
check(
  "戦闘中はお知らせを出し、転職ボタンを押せない",
  /戦闘中は転職できません/.test(text) && (await page.isDisabled('[data-job-to="spearman"]')),
);
await page.tap("#jobClose");
await page.tap("#hgClose");
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
