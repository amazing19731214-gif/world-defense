#!/usr/bin/env node
// 主人公・無限育成の動作確認：主人公の選択・変更、Lv30を超える成長、ステータスポイント、スキル20枠、
// 主人公の戦死とLv1からの再出発（防衛戦・攻城戦）、育成画面、以前の保存データ
//   node tools/test-hero.mjs
//   SCREENSHOTS=dir node tools/test-hero.mjs … 画面写真も保存
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
// 以前の形式の保存データ（新しい項目なし）：第一 槍兵10（#1 は名前付き Lv12・スキル2つ）、第二 弓兵10
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
    skills: k === 0 ? ["ironWall", "combo"] : [],
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

let { page, errors, context } = await newPage(oldSave);

console.log("■ 以前の保存データ");
let s1 = await soldier(page, 1);
check(
  "新しい項目がない保存データも読める（習得スキル＝装備・ポイント0・最高Lv＝今のLv）",
  s1.learned.join() === "ironWall,combo" &&
    s1.skills.join() === "ironWall,combo" &&
    s1.pts.atk === 0 &&
    s1.bestLevel === 12 &&
    s1.deaths === 0 &&
    s1.name === "鬼若",
  JSON.stringify(s1),
);
check(
  "過去のレベルの分のポイントがある（Lv12 → (12-1)×3 = 33）",
  (await ev(page, () => WD_DEBUG.squadApi.pointsFree(WD_DEBUG.state().soldiers[0]))) === 33,
);
check("主人公はまだいない", (await ev(page, () => WD_DEBUG.squadApi.heroSoldier())) === null);

console.log("■ 主人公を選ぶ・変える");
await page.tap("#soldiers");
await page.tap('[data-make-hero="1"]');
check("兵士名簿から主人公にする", (await saved(page)).heroId === 1);
check("名簿で主人公に 👑", /👑🎖鬼若/.test(await page.textContent("#soldierList")));
check("主人公は名簿の先頭", /^👑/.test((await page.textContent("#soldierList .s-card h3")).trim()));
await page.tap("#soldierClose");
check(
  "主人公を別のデータとして複製しない（兵士の数は同じ）",
  (await ev(page, () => WD_DEBUG.state().soldiers.length)) === 20,
);
await page.tap("#heroGrowth");
check("「👑 主人公」で育成画面", /👑🎖鬼若/.test(await page.textContent("#hgBody")));
await page.tap("[data-hg-change]");
await page.tap('[data-hg-pick="11"]');
check("主人公を変える（同時に一人だけ）", (await saved(page)).heroId === 11);
check(
  "前の主人公は普通の兵士に戻る（名前・レベルはそのまま）",
  await ev(page, () => {
    const a = WD_DEBUG.squadApi,
      s = WD_DEBUG.state().soldiers[0];
    return !a.isHeroSoldier(s) && s.level === 12 && s.name === "鬼若";
  }),
);
await page.tap("[data-hg-change]");
await page.tap('[data-hg-pick="1"]');
await page.tap("#hgClose");

console.log("■ レベルの上限なし");
let r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    R = WD_DEBUG.unitConfig.SQUAD_RULES,
    s = WD_DEBUG.state().soldiers[1];
  const old = (lv) => 15 + lv * 15 + Math.max(0, lv - 10) * 10;
  const same = [1, 10, 29, 30].every((lv) => R.xpToLevel(lv) === old(lv));
  for (let i = 0; i < 4000 && s.level < 120; i++) a.gainXp(s, 1e5, true);
  const lv120 = s.level,
    st = a.soldierStats(s, true);
  return {
    same,
    more: R.xpToLevel(31) > old(31) && R.xpToLevel(500) > R.xpToLevel(100),
    lv120,
    hist: s.history.some((h) => /Lv120 に上がった/.test(h)),
    finite: Number.isFinite(st.atk) && Number.isFinite(st.maxHp),
    g: [1, 10, 30, 100, 1000, 100000].map((lv) => a.growthLv(lv)),
    pts: a.pointsFree(s),
  };
});
check("Lv30までの必要経験値はこれまでと同じ", r.same);
check("Lv30を超えるほど必要経験値が増える", r.more);
check("Lv30を超えて成長できる（Lv120）", r.lv120 >= 120 && r.hist, JSON.stringify(r));
check(
  "能力の伸び：Lv30まではこれまでと同じ、その先はゆっくり（Lv1000でも有限）",
  r.g[0] === 0 &&
    r.g[1] === 9 &&
    r.g[2] === 19 &&
    r.g[3] === 36.5 &&
    r.g[4] < 100 &&
    r.g[5] < 700 &&
    r.finite,
  JSON.stringify(r.g),
);
check("レベルが上がるとポイント（Lvごとに3）", r.pts === (r.lv120 - 1) * 3, JSON.stringify(r));

console.log("■ ステータスポイント");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0];
  const base = a.soldierStats(s, true);
  const e1 = a.addPoint(s, "atk", 100);
  const e2 = a.addPoint(s, "atk", 1);
  const free0 = a.pointsFree(s);
  const after = a.soldierStats(s, true);
  return { base, after, e1, e2, free0, pts: s.pts };
});
check(
  "残りより多く振ろうとすると残りの分だけ（33）、なくなると振れない",
  r.e1 === null && r.pts.atk === 33 && /ありません/.test(r.e2 || "") && r.free0 === 0,
  JSON.stringify(r),
);
check(
  "攻撃：33ポイントで ×(1 + 33/133)",
  Math.abs(r.after.atk / r.base.atk - (1 + 33 / 133)) < 1e-9,
  String(r.after.atk / r.base.atk),
);
check("HPはポイントでは変わらない", r.after.maxHp === r.base.maxHp);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[1]; // Lv120 の槍兵
  const base = a.soldierStats(s, true);
  a.addPoint(s, "def", 100);
  a.addPoint(s, "spd", 100);
  a.addPoint(s, "rng", 100);
  const st = a.soldierStats(s, true);
  return {
    def: st.def / base.def,
    rate: base.rate / st.rate,
    range: st.range / base.range,
  };
});
check("防御：100ポイントで ×1.5", Math.abs(r.def - 1.5) < 1e-9, JSON.stringify(r));
check("速さ：100ポイントで攻撃間隔 ÷1.25", Math.abs(r.rate - 1.25) < 1e-9, JSON.stringify(r));
check("距離：100ポイントで射程 ×1.15（上限30%）", Math.abs(r.range - 1.15) < 1e-9, JSON.stringify(r));
r = await ev(page, () => {
  // 効果には上限がある（どれだけ振っても攻撃は2倍まで）
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[1];
  return [1e6, 1e8].map((p) => {
    s.pts.atk = p;
    return a.pointBonus(s, "atk");
  });
});
check("どれだけ振っても効果は上限まで（攻撃 +100% 未満）", r.every((v) => v < 1) && r[1] > 0.99);
await ev(page, () => (WD_DEBUG.state().soldiers[1].pts.atk = 0));
r = await ev(page, () => {
  // 防衛戦で：攻撃に振った兵士の一撃は大きい
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[2]; // 槍兵 Lv3（6ポイント）
  const hit = () => a.soldierStats(s).atk;
  const before = hit();
  a.addPoint(s, "atk", 6);
  return { before, after: hit() };
});
check("戦闘の攻撃力に反映（部隊の武将の効果も含めた値）", r.after > r.before, JSON.stringify(r));
await ev(page, () => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブをクリアして保存
});
let sv = await saved(page);
check(
  "振ったポイントを保存",
  sv.soldiers.find((v) => v.id === 1).pts.atk === 33 && sv.soldiers.find((v) => v.id === 3).pts.atk === 6,
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0];
  return { free: a.pointsFree(s), atk: s.pts.atk, earned: a.pointsEarned(s) };
});
check(
  "再読み込みしてもポイントは増えない（二重取得なし）",
  r.free === 0 && r.atk === 33 && r.earned === 33,
  JSON.stringify(r),
);

console.log("■ スキル20枠");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    K = a.SOLDIER_SKILLS,
    s = WD_DEBUG.state().soldiers[0];
  // 試験用のスキルを22個用意して習得させる（効果なし）
  for (let i = 0; i < 22; i++) K["test" + i] = { name: "試験" + i, types: ["spearman"], text: "試験用" };
  for (let i = 0; i < 22; i++) s.learned.push("test" + i);
  const errs = [];
  for (let i = 0; i < 22; i++) errs.push(a.equipSkill(s, "test" + i));
  const n = s.skills.length,
    dup = a.equipSkill(s, "test0"),
    after = s.skills.length,
    notLearned = a.equipSkill(s, "spearWall");
  // 片付け：試験用スキルを外して、元の2つだけにする
  for (let i = 0; i < 22; i++) a.unequipSkill(s, "test" + i);
  s.learned = s.learned.filter((id) => !/^test/.test(id));
  for (let i = 0; i < 22; i++) delete K["test" + i];
  return { n, dup, after, notLearned, full: errs.filter(Boolean)[0], skills: s.skills };
});
check(
  "装備は20個まで（21個目は装備できない）",
  r.n === 20 && /20 個まで/.test(r.full || ""),
  JSON.stringify(r),
);
check("同じスキルは二重に装備しない", r.dup === null && r.after === 20);
check("習得していないスキルは装備できない", /習得していません/.test(r.notLearned || ""));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0];
  a.unequipSkill(s, "combo");
  const off = s.skills.slice();
  a.equipSkill(s, "combo");
  return { off, on: s.skills.slice(), learned: s.learned.slice() };
});
check(
  "外しても習得したまま、付け直せる",
  r.off.join() === "ironWall" && r.on.join() === "ironWall,combo" && r.learned.includes("combo"),
  JSON.stringify(r),
);
r = await ev(page, () => {
  // 装備したスキルだけが効く（槍の達人：攻撃 +12%）
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers[0];
  s.learned.push("spearMaster");
  const off = a.soldierStats(s, true).atk;
  a.equipSkill(s, "spearMaster");
  const on = a.soldierStats(s, true).atk;
  a.unequipSkill(s, "spearMaster");
  const again = a.soldierStats(s, true).atk;
  s.learned = s.learned.filter((id) => id !== "spearMaster");
  return { off, on, again };
});
check(
  // 攻撃の％の上乗せ（称号・精鋭など）と足し合わせるので、ちょうど ×1.12 にはならない
  "装備したスキルだけが効く（槍の達人を付けると攻撃が上がり、外すと元どおり）",
  r.on > r.off * 1.1 && r.again === r.off,
  JSON.stringify(r),
);
sv = await saved(page);
check("スキルの装備をすぐ保存", sv.soldiers.find((v) => v.id === 1).skills.join() === "ironWall,combo");

console.log("■ 育成画面");
await page.tap("#heroGrowth");
let text = await page.textContent("#hgBody");
check(
  "名前・兵種・Lv・経験・HP・攻撃・防御・速さ・距離・ポイント・スキル・戦歴を表示",
  /鬼若/.test(text) &&
    /槍兵/.test(text) &&
    /Lv12/.test(text) &&
    /経験/.test(text) &&
    /HP/.test(text) &&
    /攻撃/.test(text) &&
    /防御/.test(text) &&
    /速さ/.test(text) &&
    /距離/.test(text) &&
    /未使用のステータスポイント 0/.test(text) &&
    /装備 2\/20/.test(text) &&
    /出陣 \d+/.test(text) &&
    /撃破 \d+/.test(text) &&
    /戦死 0回/.test(text) &&
    /過去最高 Lv12/.test(text),
  text.slice(0, 300),
);
check("主人公の画像", (await page.$$("#hgBody .hg-img")).length === 1);
check("ポイントが無いときは「＋」を押せない", await page.isDisabled('[data-hg-add="def"]'));
await ev(page, () => WD_DEBUG.squadApi.gainXp(WD_DEBUG.state().soldiers[0], 2000, true));
await page.tap("[data-hg-change]");
await page.tap("[data-hg-cancel]");
await page.tap('[data-hg-add="def"]');
r = await soldier(page, 1);
check("「＋」で1ポイント振る", r.pts.def === 1, JSON.stringify(r.pts));
await page.tap('[data-hg-add10="spd"]');
r = await soldier(page, 1);
check("「＋10」で10ポイント振る", r.pts.spd === 10, JSON.stringify(r.pts));
await page.tap('[data-hg-off="combo"]');
check("画面からスキルを外す", !(await soldier(page, 1)).skills.includes("combo"));
await page.tap('[data-hg-on="combo"]');
check("画面からスキルを装備", (await soldier(page, 1)).skills.includes("combo"));
if (shots) await page.screenshot({ path: path.join(shots, "h1-growth.png") });
await page.tap("#hgClose");
check("エラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 主人公の戦死（防衛戦）");
await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  a.deployReserve(s.squads[0], 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
});
const before = await soldier(page, 1);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0],
    h = s.soldiers[0];
  // 主人公を部隊の先頭にして倒す
  q.frontId = h.id;
  h.skills = h.skills.filter((x) => x !== "unyielding");
  h.hp = 0.1;
  a.damageSquad(q, 999, false);
  return {
    alive: h.alive,
    out: !!h.out,
    level: h.level,
    xp: h.xp,
    pts: h.pts,
    deaths: h.deaths,
    best: h.bestLevel,
    skills: h.skills.slice(),
    learned: h.learned.slice(),
    name: h.name,
    hist: h.history.slice(),
    battles: h.battles,
    kills: h.kills,
    inField: a.members(q).some((m) => m.id === h.id),
    count: s.soldiers.filter((m) => m.id === h.id).length,
    hero: a.isHeroSoldier(h),
    toast: document.getElementById("toast").textContent,
  };
});
check(
  "主人公は戦死しても消えない（生存のまま・同じID）",
  r.alive && r.count === 1 && r.hero,
  JSON.stringify(r),
);
check(
  "Lv1・経験0・ポイント初期化",
  r.level === 1 && r.xp === 0 && r.pts.atk + r.pts.def + r.pts.spd + r.pts.rng === 0,
);
check(
  "スキル・装備・名前・戦歴は残る",
  r.skills.join() === before.skills.join() &&
    r.learned.join() === before.learned.join() &&
    r.name === "鬼若" &&
    r.battles === before.battles &&
    r.kills === before.kills,
);
check("戦死回数 +1・過去最高レベルを記録", r.deaths === 1 && r.best === before.level, JSON.stringify(r));
check(
  "戦歴に再出発を記録",
  r.hist.some((h) => /Lv1から再出発（1回目）/.test(h)),
);
check("このウェーブは戦場を離れる（同じ兵士が二重に戦わない）", r.out && !r.inField);
check(
  "画面の上に「主人公が戦死しました。Lv1から再出発します」",
  /主人公.*戦死しました。Lv1から再出発します/.test(r.toast),
  r.toast,
);
sv = await saved(page);
check(
  "すぐ保存（負けて読み込み直しても元のレベルに戻らない）",
  sv.soldiers.find((v) => v.id === 1).level === 1 && sv.soldiers.find((v) => v.id === 1).deaths === 1,
);
check("英霊名鑑には載らない", !sv.fallen.some((f) => f.id === 1));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0],
    m = a.members(q)[0];
  m.skills = [];
  m.hp = 0.1;
  a.damageSquad(q, 999, false);
  return { alive: m.alive, id: m.id };
});
sv = await saved(page);
check(
  "一般の兵士はこれまでどおり永久に戦死",
  !r.alive && !sv.soldiers.some((v) => v.id === r.id),
  JSON.stringify(r),
);
const ws = (await soldier(page, 1)).wavesSurvived;
await ev(page, () => {
  const s = WD_DEBUG.state();
  s.enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブ終了
});
r = await soldier(page, 1);
check(
  "戦死したウェーブの生存ボーナスは受け取らない（経験値0のまま）",
  r.xp === 0 && r.level === 1 && r.wavesSurvived === ws,
  JSON.stringify(r),
);
check("次の戦闘から復帰（離脱が解ける）", !r.out);
await ev(page, () => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
});
r = await ev(page, () => WD_DEBUG.squadApi.members(WD_DEBUG.state().squads[0]).some((m) => m.id === 1));
check("次のウェーブでは同じ部隊で戦う", r);
await ev(page, () => {
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
});
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(page, () => {
  const s = WD_DEBUG.state().soldiers.find((x) => x.id === 1);
  return {
    lv: s.level,
    name: s.name,
    deaths: s.deaths,
    best: s.bestLevel,
    hero: WD_DEBUG.squadApi.isHeroSoldier(s),
  };
});
check(
  "再読み込みしても主人公のまま（Lv1から・名前・戦死回数・最高Lv）",
  r.hero && r.name === "鬼若" && r.deaths === 1 && r.best >= 12,
  JSON.stringify(r),
);
await page.tap("#soldiers");
check(
  "兵士名簿に残る（戦死回数・過去最高Lvを表示）",
  /👑🎖鬼若/.test(await page.textContent("#soldierList")) &&
    /戦死 1回/.test(await page.textContent("#soldierList")),
);
await page.tap("#soldierClose");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 1);
  const learned = s.learned.length;
  for (let i = 0; i < 400 && s.level < 15; i++) a.gainXp(s, 50, true);
  return { lv: s.level, learned: s.learned.length, before: learned };
});
check(
  "再出発後、前に到達したレベルではスキルを二重に習得しない",
  r.lv >= 15 && r.learned === r.before,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 主人公の戦死（攻城戦）");
({ page, errors, context } = await newPage(Object.assign({}, oldSave, { heroId: 1 })));
check("保存した主人公を読み込む", (await ev(page, () => WD_DEBUG.squadApi.heroSoldier().id)) === 1);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  const B = a.battle(),
    g = B.groups[0],
    h = g.list.find((s) => s.id === 1);
  WD_DEBUG.step(0.1);
  // 守備兵を主人公の部隊の前に置き、主人公を先頭（最初に攻撃を受ける）にする
  g.list.sort((a, b) => (b.id === 1) - (a.id === 1));
  h.hp = 0.1;
  h.skills = h.skills.filter((x) => x !== "unyielding");
  const e = B.garrison[0];
  Object.assign(e, { x: g.x + 10, y: g.y, cd: 0 });
  for (let i = 0; i < 40 && h.level !== 1; i++) WD_DEBUG.step(0.05);
  return {
    level: h.level,
    alive: h.alive,
    out: !!h.siegeOut,
    inGroup: g.list.filter((s) => s.alive && !s.siegeOut).some((s) => s.id === 1),
    deaths: h.deaths,
  };
});
check(
  "攻城戦でも主人公はLv1から再出発（消えない）",
  r.level === 1 && r.alive && r.deaths === 1,
  JSON.stringify(r),
);
check("その攻城戦からは外れる（二重に戦わない）", r.out && !r.inGroup);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.endBattle("win");
  const s = WD_DEBUG.state().soldiers.find((x) => x.id === 1);
  return {
    body: document.getElementById("battleBody").textContent,
    xp: s.xp,
    level: s.level,
    out: s.siegeOut,
  };
});
check(
  "結果画面に「主人公が戦死しました。Lv1から再出発します」",
  /主人公が戦死しました。Lv1から再出発します/.test(r.body),
  r.body.slice(0, 200),
);
check("戦死した攻城戦の生還・勝利の経験値は受け取らない", r.xp === 0 && r.level === 1, JSON.stringify(r));
r = await ev(page, () => WD_DEBUG.squadApi.siege()[0].soldiers.includes(1));
check("攻城編成に残る（次の攻城戦にも出る）", r);
sv = await saved(page);
check("攻城戦の戦死もすぐ保存", sv.soldiers.find((v) => v.id === 1).level === 1 && sv.heroId === 1);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 画面（375×667）");
({ page, errors, context } = await newPage(Object.assign({}, oldSave, { heroId: 1 }), 375, 667));
await ev(page, () => WD_DEBUG.squadApi.gainXp(WD_DEBUG.state().soldiers[0], 1e5, true));
await page.tap("#heroGrowth");
r = await ev(page, () => {
  const sh = document.querySelector("#heroGrowthSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    close = document.getElementById("hgClose").getBoundingClientRect();
  sh.scrollTop = sh.scrollHeight;
  const last = [...sh.querySelectorAll("button")].pop().getBoundingClientRect(),
    close2 = document.getElementById("hgClose").getBoundingClientRect();
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    close: close.top >= 0 && close.bottom <= innerHeight,
    closeAfterScroll: close2.top >= rr.top - 1 && close2.bottom <= innerHeight,
    last: last.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minBtn: Math.min(...[...sh.querySelectorAll("button")].map((b) => b.getBoundingClientRect().height)),
  };
});
check("育成画面は画面の中に収まり、下のボタンにも届く", r.inView && r.last, JSON.stringify(r));
check("「閉じる」はスクロールしても見える", r.close && r.closeAfterScroll, JSON.stringify(r));
check("横にはみ出さない・ボタンは44px以上", !r.hScroll && r.minBtn >= 44, JSON.stringify(r));
if (shots) await page.screenshot({ path: path.join(shots, "h2-375.png") });
await page.tap("#hgClose");
check("メニューに「👑 主人公」", /主人公/.test(await page.textContent("#heroGrowth")));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 主人公がいないとき");
({ page, errors, context } = await newPage({
  version: 1,
  seq: 0,
  squadSeq: 0,
  squads: [],
  soldiers: [],
  fallen: [],
}));
await page.tap("#heroGrowth");
check("兵士がいなければ案内を表示", /部隊を雇うと/.test(await page.textContent("#hgBody")));
await page.tap("#hgClose");
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
