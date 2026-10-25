#!/usr/bin/env node
// 修練場の動作確認：4つの難易度・敵レベル・中ボスと大将・無限・経験値（攻撃・撃破・治療・防御・生存・クリア）・
// 重複取得の防止・主人公と一般兵の戦死・撤退・通常の防衛戦の状態が元に戻ること・保存・画面
//   node tools/test-training.mjs
//   SCREENSHOTS=dir node tools/test-training.mjs … 画面写真も保存
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
  TKEY = "worldDefense.training.v1",
  WKEY = "worldDefense.warlords.v1";
// 第一 槍兵10（#1 が主人公）・第二 弓兵8＋衛生兵2・Lv40
function makeSave(level = 40) {
  const save = {
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
    save.soldiers.push({ id: k + 1, type: "spearman", squadId: 1, level, name: k === 0 ? "鬼若" : null });
  for (let k = 0; k < 10; k++)
    save.soldiers.push({ id: 11 + k, type: k < 8 ? "archer" : "medic", squadId: 2, level });
  return save;
}
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
    ([k, v, w]) => {
      localStorage.clear();
      localStorage.setItem(k, v);
      localStorage.setItem("worldDefense.warlords.v1", w);
    },
    [SKEY, JSON.stringify(seed), JSON.stringify({ version: 1, owned: {}, tickets: 0, history: [] })],
  );
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);

let { page, errors, context } = await newPage(makeSave());

console.log("■ 敵レベル（4つの難易度）");
let r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    lv = (key, w) => T.trainLevel({ D: T.TRAINING.diffs[key] }, w);
  const range = (key) => Array.from({ length: 10 }, (_, i) => lv(key, i + 1));
  return {
    beginner: range("beginner"),
    advanced: range("advanced"),
    super: range("super"),
    endless: [1, 5, 10, 11, 20, 40].map((w) => lv("endless", w)),
  };
});
check("初級：Lv1〜30", r.beginner[0] === 1 && r.beginner[9] === 30, r.beginner.join());
check(
  "上級：Lv30〜100（すべて範囲内・ウェーブごとに上がる）",
  r.advanced[0] === 30 &&
    r.advanced[9] === 100 &&
    r.advanced.every((v, i, a) => v >= 30 && v <= 100 && (!i || v > a[i - 1])),
  r.advanced.join(),
);
check("超級：Lv100〜500", r.super[0] === 100 && r.super[9] === 500, r.super.join());
check(
  "無限：ウェーブが進むと上がり続ける",
  r.endless.every((v, i, a) => !i || v > a[i - 1]) && r.endless[5] > 500,
  r.endless.join(),
);
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi.TRAINING;
  return {
    hp: [30, 100].map(T.hp),
    atk: [30, 100].map(T.atk),
    armor: [30, 100].map(T.armor),
    speed: [30, 100].map(T.speed),
    count: [1, 10].map((w) => T.count(w, 60)),
  };
});
check(
  "敵レベルでHP・攻撃・防御・速さ・数がすべて上がる",
  r.hp[1] > r.hp[0] &&
    r.atk[1] > r.atk[0] &&
    r.armor[1] > r.armor[0] &&
    r.speed[1] > r.speed[0] &&
    r.count[1] > r.count[0],
  JSON.stringify(r),
);

console.log("■ 修練場を始める（画面）");
await ev(page, () => WD_DEBUG.setGold(777));
await page.tap('[data-t="arrow"]');
const p = await ev(page, () => {
  const c = document.getElementById("game"),
    r = c.getBoundingClientRect();
  return {
    x: r.left + c.clientLeft + (330 * c.clientWidth) / 960,
    y: r.top + c.clientTop + (300 * c.clientHeight) / 600,
  };
});
await page.touchscreen.tap(p.x, p.y); // 通常の防衛戦で塔を1基（100G）
const before = await ev(page, () => ({
  wave: WD_DEBUG.state().wave,
  hp: WD_DEBUG.state().hp,
  gold: WD_DEBUG.state().gold,
  towers: WD_DEBUG.state()
    .towers.map((t) => t.id + ":" + t.level)
    .join(),
}));
await page.tap("#trainingOpen");
let text = await page.textContent("#trBody");
check(
  "メニューの「⚔️ 修練場」で難易度を選ぶ画面",
  /初級/.test(text) && /上級/.test(text) && /超級/.test(text) && /無限/.test(text),
);
check(
  "上級が最初から選ばれている",
  await ev(page, () => document.querySelector('[data-tr-diff="advanced"]').classList.contains("active")),
);
check("難易度ごとに敵Lvを表示", /敵Lv 30〜100/.test(text) && /敵Lv 100〜500/.test(text), text.slice(0, 200));
if (shots) await page.screenshot({ path: path.join(shots, "t1-select.png") });
await page.tap("#trStart");
r = await ev(page, () => ({
  on: !!WD_DEBUG.trainingApi.training(),
  key: WD_DEBUG.trainingApi.training().key,
  bar: !document.getElementById("trainBar").hidden,
  wave: document.getElementById("wave").textContent,
  hp: WD_DEBUG.state().hp,
}));
check(
  "上級で始まる（上の帯は「修練 0/10」・城は修練場のHP）",
  r.on && r.key === "advanced" && r.bar && /修練 0\/10/.test(r.wave) && r.hp === 20,
  JSON.stringify(r),
);
check(
  "挑戦中の帯に敵Lv・獲得経験値・撤退ボタン",
  /敵Lv 30/.test(await page.textContent("#trainInfo")) &&
    /獲得経験値/.test(await page.textContent("#trainInfo")) &&
    (await page.isVisible("#trainRetreat")),
);
check(
  "挑戦中は攻城戦に出陣できない",
  /修練場/.test((await ev(page, () => WD_DEBUG.squadApi.startBattle())) || ""),
);
// 修練場で塔を強化・新しく建てる（終わると元に戻る）
await ev(page, () => {
  const s = WD_DEBUG.state();
  s.towers[0].level = 4;
  s.towers.push({ id: 99, type: "cannon", x: 420, y: 300, level: 1, cd: 0, spent: 180 });
});

console.log("■ ウェーブ・中ボス・大将");
await ev(page, () => document.getElementById("start").click()); // ウェーブ1
r = await ev(page, () => {
  WD_DEBUG.step(1);
  return WD_DEBUG.state().enemies.map((e) => e.lv); // state() は呼ぶたびに今の敵の一覧を返す
});
check("修練場の敵には敵レベル（ウェーブ1はLv30）", r.length > 0 && r.every((v) => v === 30), r.join());
await ev(page, () => {
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1); // 1ウェーブ目を終える
});
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi;
  return { wave: WD_DEBUG.state().wave, cleared: T.training() && T.training().cleared };
});
check(
  "ウェーブをクリアすると修練場のまま次へ（通常のゲームオーバー・勝利にならない）",
  r.cleared === 1 && !!r.wave,
  JSON.stringify(r),
);
// 敵の出現：ウェーブ5と10の最後の1体
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    T = WD_DEBUG.trainingApi,
    out = {};
  for (const w of [2, 5, 10]) {
    const t = T.training();
    t.wave = w;
    const total = T.TRAINING.count(w, T.trainLevel(t, w));
    const list = WD_DEBUG.trainingEnemies(w, total);
    out[w] = {
      total,
      roles: list.map((e) => e.role).filter(Boolean),
      lastRole: list[list.length - 1].role,
      lv: [...new Set(list.map((e) => e.lv))],
      kinds: [...new Set(list.map((e) => e.kind))],
      bossHp: list[list.length - 1].max,
      normalHp: list.find((e) => e.kind === "goblin")?.max,
      stats: Object.fromEntries(
        list.map((e) => [e.kind, [Math.round(e.max), Math.round(e.speed), Math.round(e.armor)]]),
      ),
    };
  }
  T.training().wave = 1;
  return out;
});
check("ウェーブ2には中ボス・大将は出ない", r[2].roles.length === 0, JSON.stringify(r[2]));
check(
  "ウェーブ5の最後に中ボス",
  r[5].lastRole === "mid" && r[5].roles.length === 1,
  JSON.stringify(r[5].roles),
);
check(
  "ウェーブ10の最後に大将",
  r[10].lastRole === "boss" && r[10].roles.length === 1,
  JSON.stringify(r[10].roles),
);
check(
  "同じウェーブの敵は同じ敵Lv（上級のウェーブ10はLv100）",
  r[10].lv.length === 1 && r[10].lv[0] === 100,
  JSON.stringify(r[10].lv),
);
check("大将は普通の敵よりずっと硬い", r[10].bossHp > r[10].normalHp * 10, JSON.stringify(r[10]));
check(
  "敵の種類でHP・速さ・防御が違う（槍兵は硬く遅い、騎兵は速い）",
  !r[10].stats.knight ||
    !r[10].stats.wolf ||
    (r[10].stats.knight[0] > r[10].stats.wolf[0] && r[10].stats.wolf[1] > r[10].stats.knight[1]),
  JSON.stringify(r[10].stats),
);

console.log("■ 経験値：攻撃・撃破");
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    T = WD_DEBUG.trainingApi,
    H = WD_DEBUG.heroApi,
    s = S.soldiers.find((x) => x.id === 2),
    q = S.squads[0];
  WD_DEBUG.squadApi.deployReserve(q, 650, 300); // 第一部隊を道に出してからウェーブ2
  document.getElementById("start").click(); // ウェーブ2
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true }); // ウェーブを終わらせない（入口に止まる）
  const e = WD_DEBUG.addEnemy({ kind: "goblin", d: 100, hp: 100, speed: 0 });
  Object.assign(e, { max: 100, lv: 40, xpWorth: 50 });
  s.waveXp = 0;
  const xp = () => s.xp;
  const a0 = xp();
  H.dealEnemyDamage(e, 30, { s, q });
  const a1 = xp();
  H.dealEnemyDamage(e, 1000, { s, q });
  const a2 = xp();
  H.dealEnemyDamage(e, 1000, { s, q });
  const a3 = xp();
  WD_DEBUG.step(0.05); // 撃破の処理（1コマ）
  const a4 = xp();
  WD_DEBUG.step(0.05);
  return { d1: a1 - a0, d2: a2 - a1, d3: a3 - a2, kill: a4 - a3, again: xp() - a4, lv: s.level };
});
check(
  "与えたダメージの割合で経験値（30/100 × 50 × 0.7 = 10.5）",
  Math.abs(r.d1 - 10.5) < 1e-6,
  JSON.stringify(r),
);
check(
  "残りHPを超えたダメージは数えない（70/100 × 50 × 0.7 = 24.5）",
  Math.abs(r.d2 - 24.5) < 1e-6,
  JSON.stringify(r),
);
check("倒れた敵をさらに攻撃しても増えない", r.d3 === 0, JSON.stringify(r));
check(
  "撃破の経験値は1回だけ（50 × 0.3 = 15）",
  Math.abs(r.kill - 15) < 1e-6 && r.again === 0,
  JSON.stringify(r),
);

console.log("■ 経験値：治療・防御・上限");
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    T = WD_DEBUG.trainingApi,
    a = WD_DEBUG.squadApi,
    q2 = S.squads[1],
    medic = S.soldiers.find((x) => x.type === "medic"),
    archer = S.soldiers.find((x) => x.id === 11);
  a.deployReserve(q2, 300, 165);
  for (const q of S.squads) for (const m of a.roster(q)) m.hp = a.soldierStats(m).maxHp;
  medic.waveXp = 0;
  medic.cd = 0;
  const m0 = medic.xp;
  WD_DEBUG.step(0.5); // 全員満タン：治療しない
  const full = medic.xp - m0;
  archer.hp = a.soldierStats(archer).maxHp - 10; // 10だけ減らす
  medic.cd = 0;
  const m1 = medic.xp;
  WD_DEBUG.step(0.05);
  const healed = medic.xp - m1;
  const unit = T.TRAINING.xpUnit(T.trainLevel(T.training(), T.training().wave));
  return {
    full,
    healed,
    expect: (10 / a.soldierStats(archer).maxHp) * unit * T.TRAINING.healXp,
    hp: archer.hp,
    max: a.soldierStats(archer).maxHp,
  };
});
check("満タンの味方は治療しない（経験値なし）", r.full === 0, JSON.stringify(r));
check(
  "実際に回復したHPだけ経験値（10回復）",
  Math.abs(r.healed - r.expect) < 1e-6 && r.hp === r.max,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    q = S.squads[0],
    front = a.members(q)[0];
  front.waveXp = 0;
  const x0 = front.xp,
    hp0 = front.hp;
  a.damageSquad(q, 20, false, "goblin", { kind: "goblin", lv: 40 });
  return { gained: front.xp - x0, lost: hp0 - front.hp };
});
check("敵の攻撃を受け止めると防御の経験値", r.gained > 0 && r.lost > 0, JSON.stringify(r));
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    q = S.squads[0],
    front = a.members(q)[0],
    max = a.soldierStats(front).maxHp;
  front.hp = max;
  a.damageSquad(q, 1e6, false, "boss", { kind: "boss", lv: 500 });
  return { left: front.hp / max, alive: front.alive };
});
check(
  "強い敵の一撃でもHPの6割まで（一撃で倒れ続けない）",
  r.alive && Math.abs(r.left - 0.4) < 1e-6,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    T = WD_DEBUG.trainingApi,
    s = S.soldiers.find((x) => x.id === 3);
  s.waveXp = 0;
  for (let i = 0; i < 100; i++) a.gainXp(s, 1e4);
  return { waveXp: s.waveXp, cap: T.TRAINING.waveCap(T.trainLevel(T.training(), T.training().wave)) };
});
check("1ウェーブの戦闘の経験値には上限（敵レベルに応じる）", r.waveXp === r.cap, JSON.stringify(r));

console.log("■ ウェーブの生存・重複なし");
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    T = WD_DEBUG.trainingApi,
    s = S.soldiers.find((x) => x.id === 4);
  const rec0 = T.training().rec[4].battle;
  S.enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブ2を終える
  const rec1 = T.training().rec[4].battle;
  WD_DEBUG.step(0.1);
  WD_DEBUG.squadApi.squadsWaveEnd(); // もう一度終わりの処理を呼んでも
  const rec2 = T.training().rec[4].battle;
  return {
    wave: rec1 - rec0,
    again: rec2 - rec1,
    unit: T.TRAINING.xpUnit(T.trainLevel(T.training(), 2)) * T.TRAINING.waveXp,
  };
});
check("ウェーブを生き延びると生存の経験値（単位 × 1.5）", r.wave >= r.unit - 1e-6, JSON.stringify(r));
check("生存の経験値は1ウェーブ1回だけ", r.again === 0, JSON.stringify(r));

console.log("■ 主人公と一般兵の戦死");
r = await ev(page, () => {
  const S = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    q = S.squads[0];
  document.getElementById("start").click(); // ウェーブ3
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const hero = S.soldiers[0];
  q.frontId = hero.id;
  hero.skills = [];
  hero.hp = 0.1;
  a.damageSquad(q, 999, false);
  const plain = a.members(q)[0];
  plain.skills = [];
  plain.hp = 0.1;
  a.damageSquad(q, 999, false);
  return {
    hero: { lv: hero.level, alive: hero.alive, out: hero.out, deaths: hero.deaths },
    plain: { alive: plain.alive, id: plain.id },
  };
});
check(
  "主人公は修練場でもLv1から再出発（消えない・この戦いからは外れる）",
  r.hero.lv === 1 && r.hero.alive && r.hero.out && r.hero.deaths === 1,
  JSON.stringify(r),
);
check("一般の兵士は修練場でも永久に戦死", !r.plain.alive, JSON.stringify(r));
const deadId = r.plain.id;

console.log("■ 撤退（報酬は1回だけ・通常の防衛戦は元どおり）");
await page.tap("#trainRetreat");
r = await ev(page, () => {
  const S = WD_DEBUG.state();
  return {
    on: !!WD_DEBUG.trainingApi.training(),
    wave: S.wave,
    hp: S.hp,
    gold: S.gold,
    towers: S.towers.map((t) => t.id + ":" + t.level).join(),
    title: document.getElementById("battleTitle").textContent,
    body: document.getElementById("battleBody").textContent,
    tickets: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).tickets,
  };
});
check("撤退すると修練場を終える", !r.on && /撤退/.test(r.title), r.title);
check(
  "通常の防衛戦のウェーブ・城HP・塔（強化・新しい塔）は元に戻る",
  r.wave === before.wave && r.hp === before.hp && r.towers === before.towers,
  JSON.stringify([r, before]),
);
check(
  "ゴールドは元の額＋報酬（クリアしたウェーブ2つ × 10 × 2 = 40G）",
  r.gold === before.gold + 40,
  `${before.gold} → ${r.gold}`,
);
check("ガチャ券は増えない", r.tickets === 0, String(r.tickets));
check(
  "結果画面：各兵士の獲得経験値（戦闘・クリア）とレベル変化、主人公の戦死",
  /Lv40 → Lv\d+・戦闘 \+\d+・クリア \+0/.test(r.body) &&
    /主人公が戦死しました。Lv1から再出発します/.test(r.body) &&
    /クリアのボーナス経験値はありません/.test(r.body),
  r.body.slice(0, 300),
);
r = await ev(page, () => {
  const g = WD_DEBUG.state().gold;
  WD_DEBUG.trainingApi.endTraining("clear"); // 終わった後にもう一度終わらせても
  return { g, after: WD_DEBUG.state().gold };
});
check("撤退後にもう一度終わらせても報酬は増えない", r.g === r.after);
let sv = await ev(page, (k) => JSON.parse(localStorage.getItem(k)), SKEY);
check(
  "修練場で得た経験値を保存・戦死した一般兵は保存から外れる",
  sv.soldiers.some((v) => v.level > 40 || v.xp > 0) &&
    !sv.soldiers.some((v) => v.id === deadId) &&
    sv.soldiers.find((v) => v.id === 1).level === 1,
);
const ts = await ev(page, (k) => JSON.parse(localStorage.getItem(k)), TKEY);
check("記録を保存（上級：最高2ウェーブ）", ts && ts.best.advanced.waves === 2, JSON.stringify(ts));
await page.tap("#battleClose");
check("通常の防衛戦を続けられる（WAVE表示に戻る）", /^WAVE /.test(await page.textContent("#wave")));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 10ウェーブのクリア");
({ page, errors, context } = await newPage(makeSave(60)));
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    S = WD_DEBUG.state,
    a = WD_DEBUG.squadApi;
  T.startTraining("beginner");
  a.deployReserve(S().squads[0], 650, 300);
  for (let w = 0; w < 10; w++) {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    S().enemies.length = 0;
    WD_DEBUG.step(0.1);
  }
  return {
    on: !!T.training(),
    title: document.getElementById("battleTitle").textContent,
    body: document.getElementById("battleBody").textContent,
    clears: T.trainingSave().clears.beginner,
  };
});
check("10ウェーブで終わり、クリア", !r.on && /クリア/.test(r.title) && r.clears === 1, r.title);
check("クリアのボーナス経験値（戦闘と分けて表示）", /クリア \+[1-9]\d*/.test(r.body), r.body.slice(0, 200));
r = await ev(page, () => WD_DEBUG.trainingApi.startTraining("beginner"));
check("同じ難易度にすぐ再挑戦できる", r === null, r);
await ev(page, () => WD_DEBUG.trainingApi.endTraining("retreat"));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 無限（10ウェーブで終わらない）・敗北");
({ page, errors, context } = await newPage(makeSave(60)));
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    S = WD_DEBUG.state;
  T.startTraining("endless");
  for (let w = 0; w < 12; w++) {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    S().enemies.length = 0;
    WD_DEBUG.step(0.1);
  }
  return { on: !!T.training(), wave: S().wave, label: document.getElementById("wave").textContent };
});
check("無限は12ウェーブ目も続く", r.on && r.wave === 12 && /修練 12$/.test(r.label), JSON.stringify(r));
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    S = WD_DEBUG.state;
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  for (let i = 0; i < 25; i++) WD_DEBUG.addEnemy({ kind: "wolf", d: 1000 + i, hp: 1e9, speed: 400 });
  WD_DEBUG.step(5);
  return {
    on: !!T.training(),
    over: S().over,
    hp: S().hp,
    title: document.getElementById("battleTitle").textContent,
  };
});
check(
  "城HPが0になると修練場の敗北（通常のゲームオーバーにはならない）",
  !r.on && !r.over && r.hp === 20 && /敗北/.test(r.title),
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 画面（375×667）");
({ page, errors, context } = await newPage(makeSave(), 375, 667));
await page.tap("#trainingOpen");
r = await ev(page, () => {
  const sh = document.querySelector("#trainingSheet .sheet").getBoundingClientRect(),
    st = document.getElementById("trStart").getBoundingClientRect(),
    bs = [...document.querySelectorAll("#trainingSheet button")];
  return {
    inView: sh.top >= 0 && sh.bottom <= innerHeight + 0.5,
    start: st.bottom <= innerHeight + 0.5,
    minBtn: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
    h: document.documentElement.scrollWidth <= innerWidth,
  };
});
check(
  "難易度の画面は画面の中・開始ボタンが見える・ボタン44px以上・横にはみ出さない",
  r.inView && r.start && r.minBtn >= 44 && r.h,
  JSON.stringify(r),
);
await page.tap('[data-tr-diff="super"]');
check("難易度を選ぶとボタンの文字も変わる", /超級.*ウェーブに挑戦する/.test(await page.textContent("#trStart")));
await page.tap('[data-tr-diff="advanced"]');
await page.tap("#trStart");
r = await ev(page, () => {
  document.getElementById("trainRetreat").scrollIntoView({ block: "center" });
  const c = document.getElementById("trainRetreat").getBoundingClientRect(),
    hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
  return {
    ok: hit === document.getElementById("trainRetreat"),
    h: document.documentElement.scrollWidth <= innerWidth,
  };
});
check("撤退ボタンに届く（隠れない）", r.ok && r.h, JSON.stringify(r));
if (shots) await page.screenshot({ path: path.join(shots, "t2-bar.png") });
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 通常の防衛戦の経験値（これまでの値のまま。防御だけ追加）");
({ page, errors, context } = await newPage(makeSave(5)));
r = await ev(page, () => {
  const T = WD_DEBUG.trainingApi,
    s = WD_DEBUG.state().soldiers[1],
    g = (fn) => {
      s.waveXp = 0;
      const lv = s.level,
        x = s.xp;
      fn();
      return s.level === lv ? s.xp - x : null;
    };
  return {
    training: !!T.training(),
    hit: g(() => T.earnXp(s, "hit")),
    kill: g(() => T.earnXp(s, "kill", 1, { reward: 10 })),
    heal: g(() => T.earnXp(s, "heal", 5, 100)),
    healFull: g(() => T.earnXp(s, "heal", 0, 100)),
    block: g(() => T.earnXp(s, "block", 5, 100)),
    wave: g(() => T.earnXp(s, "wave")),
  };
});
check(
  "攻撃1・撃破6＋報酬の半分・治療2（回復0なら0）・生存20はこれまでどおり、防御は1",
  !r.training && r.hit === 1 && r.kill === 11 && r.heal === 2 && r.healFull === 0 && r.block === 1 && r.wave === 20,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
