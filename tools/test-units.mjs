#!/usr/bin/env node
import { openInfoEntry } from './ui-test-utils.mjs';
// 鉄砲兵・衛生兵（陣中医）の動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test-units.mjs
//   SCREENSHOTS=dir node tools/test-units.mjs … 画面写真も保存
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
// 雇用ボタンは「＋ 雇う」の中（畳まれていれば開いてから押す）
async function tapHire(page, type) {
  if (!(await page.isVisible(`[data-u="${type}"]`))) await page.tap("#hireToggle");
  await page.tap(`[data-u="${type}"]`);
}
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
async function newContext(seeds = {}) {
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
async function tapMap(page, x, y) {
  const p = await ev(
    page,
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return {
        x: r.left + c.clientLeft + (x * c.clientWidth) / 960,
        y: r.top + c.clientTop + (y * c.clientHeight) / 600,
      };
    },
    [x, y],
  );
  await page.touchscreen.tap(p.x, p.y);
}
// ウェーブを始め、自動の出現を止めて、遠くに止まる敵（holder）でウェーブを続けさせる
const startHeldWave = (page) =>
  ev(page, () => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  });
const clearWave = (page) =>
  ev(page, () => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });

let { page, errors, context } = await newContext();
await ev(page, () => WD_DEBUG.setGold(9999));

console.log("■ 雇用メニューと能力値");
let text = await page.textContent("#unitTools");
check(
  "雇用メニューに鉄砲兵（10人 300G）・衛生兵（10人 240G）",
  /鉄砲兵 300G/.test(text) && /衛生兵 240G/.test(text),
  text,
);
check(
  "ボタンに兵士の絵",
  (
    await page.$$eval('[data-u="gunner"] img, [data-u="medic"] img', (ims) =>
      ims.map((i) => i.naturalWidth > 0),
    )
  ).join() === "true,true",
);
let r = await ev(page, () => {
  const F = WD_DEBUG.unitConfig.UNIT_FRAMES,
    btn = document.querySelector('[data-u="medic"] img').src;
  return {
    frames: Object.fromEntries(Object.entries(F).map(([k, v]) => [k, Object.keys(v).join()])),
    btn: btn.slice(0, 15),
  };
});
check(
  "鉄砲兵（待機・攻撃・戦死）と衛生兵（待機・戦死）のコマを埋め込み",
  r.frames.gunner === "idle,attack,death" && r.frames.medic === "idle,death",
  JSON.stringify(r.frames),
);
check("衛生兵のボタンは素材の絵（仮画像ではない）", r.btn === "data:image/webp", r.btn);
r = await ev(page, () => {
  const T = WD_DEBUG.unitConfig.SOLDIER_TYPES;
  return { g: T.gunner, a: T.archer, s: T.ashigaru, m: T.medic };
});
check("鉄砲兵は弓兵より攻撃力が高く、攻撃間隔が長い", r.g.atk > r.a.atk && r.g.rate > r.a.rate);
check(
  "鉄砲兵のHPは足軽より低い・遠距離・足止めしない",
  r.g.hp < r.s.hp && r.g.range >= r.a.range && r.g.block === 0,
);
check(
  "衛生兵は攻撃力なし・回復は3秒に1回・控えめ",
  r.m.atk === 0 && r.m.rate === 3 && r.m.heal > 0 && r.m.heal <= 8 && r.m.block === 0,
);
check(
  "防衛塔の「鉄砲」とは別の兵種（塔の名前は鉄砲の塔のまま）",
  (await page.textContent('[data-t="magic"]')).includes("鉄砲") && r.g.name === "鉄砲兵",
);
await tapHire(page, "gunner");
check("鉄砲兵を選ぶと説明を表示", /鉄砲隊（10人・300G）/.test(await page.textContent("#msg")));
await tapMap(page, 760, 300);
await tapHire(page, "medic");
await tapMap(page, 690, 300);
r = await ev(page, () =>
  WD_DEBUG.state().squads.map((q) => q.type + ":" + WD_DEBUG.squadApi.members(q).length),
);
check("道をタップして鉄砲隊・陣中医隊を雇用（部隊は10人）", r.join() === "gunner:10,medic:10", r.join());
check("ゴールドは部隊の費用だけ減る", (await ev(page, () => WD_DEBUG.state().gold)) === 9999 - 300 - 240);

console.log("■ 鉄砲兵の攻撃");
await startHeldWave(page);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    g = s.squads[0];
  const e = WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 90, hp: 1e6, speed: 0 });
  WD_DEBUG.step(0.05);
  const dmg1 = 1e6 - e.hp;
  const atk = a.soldierStats(a.members(g)[0]).atk;
  WD_DEBUG.step(2.4);
  return {
    dist: Math.hypot(g.x - e.x, g.y - e.y),
    dmg1,
    atk,
    after: 1e6 - e.hp,
    xp: a.members(g)[0].waveXp,
    hit: e.lastHitBy,
  };
});
check("射程内の敵を自動で撃つ（遠距離）", r.dmg1 > 0 && r.dist > 60, JSON.stringify(r));
check("1発の威力は鉄砲兵の攻撃力（10人で一斉射撃）", Math.abs(r.dmg1 - r.atk * 10) < 0.01, JSON.stringify(r));
check("装填の間隔は約2.4秒（次の一斉射撃まで撃たない）", Math.abs(r.after - r.dmg1 * 2) < 0.01);
check("攻撃で経験値を得る", r.xp > 0);
r = await ev(page, () => {
  const s = WD_DEBUG.state();
  WD_DEBUG.squadApi.members(s.squads[0]).forEach((m) => (m.cd = 0));
  WD_DEBUG.step(0.05);
  return WD_DEBUG.fx();
});
check(
  "発砲時に閃光と煙・銃弾の演出",
  r.effects.includes("gunsmoke") && r.shots.includes("magic"),
  JSON.stringify(r),
);
await ev(page, () => WD_DEBUG.step(0.01));
if (shots) await page.screenshot({ path: path.join(shots, "u1-battle.png") });

console.log("■ 衛生兵の回復");
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    [g, m] = s.squads;
  // 敵を消して、回復だけを見る
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const gs = a.members(g),
    ms = a.members(m),
    max = a.soldierStats(gs[0]).maxHp;
  ms.forEach((x, i) => (x.cd = i === 0 ? 0 : 999)); // 1人だけ回復させる
  gs[0].hp = max - 20;
  gs[1].hp = max - 2;
  const before = gs.map((x) => x.hp),
    enemyHp = s.enemies[0].hp;
  WD_DEBUG.step(0.05);
  const after1 = gs.map((x) => x.hp);
  WD_DEBUG.step(2.8);
  const after2 = gs.map((x) => x.hp);
  WD_DEBUG.step(0.3);
  const after3 = gs.map((x) => x.hp);
  return {
    before,
    after1,
    after2,
    after3,
    max,
    heal: a.soldierStats(ms[0]).heal,
    xp: ms[0].waveXp,
    heals: ms[0].heals,
    enemyHp: s.enemies[0].hp === enemyHp,
    healFx: WD_DEBUG.fx().effects.includes("heal"),
  };
});
check(
  "HPが減っている味方1人（最も減っている兵士）を回復",
  r.after1[0] - r.before[0] === r.heal && r.after1[1] === r.before[1],
  JSON.stringify(r),
);
check("回復は3秒に1回（3秒たつまで次は治さない）", r.after2[0] === r.after1[0] && r.after3[0] > r.after2[0]);
check(
  "HPが満タンの兵士は回復しない",
  r.after1.slice(2).every((h) => h === r.max),
);
check("治療で経験値と治療回数が増える", r.xp > 0 && r.heals === 2);
check("衛生兵は敵を攻撃しない", r.enemyHp);
check("回復時に緑の回復エフェクト", r.healFx);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    [g, m] = s.squads,
    gs = a.members(g),
    ms = a.members(m),
    max = a.soldierStats(gs[0]).maxHp;
  gs.forEach((x) => (x.hp = max));
  gs[2].hp = max - 1; // 回復量より少ない減り
  ms.forEach((x) => (x.cd = 0));
  WD_DEBUG.step(0.05);
  return { hp: gs[2].hp, max };
});
check("最大HPを超えて回復しない", r.hp === r.max, JSON.stringify(r));
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    m = s.squads[1],
    ms = a.members(m);
  ms.forEach((x) => (x.cd = 0));
  WD_DEBUG.step(0.05);
  return { cds: ms.map((x) => x.cd) };
});
check(
  "けが人がいなければ待機（回復しない）",
  r.cds.every((c) => c <= 0),
);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    m = s.squads[1],
    ms = a.members(m),
    max = a.soldierStats(ms[0]).maxHp;
  // 陣中医隊を1人だけにして、その衛生兵自身がけがをしている
  for (const x of ms.slice(1)) {
    x.skills = [];
    x.hp = 0.1;
  }
  const lone = ms[0];
  // ms[1..4] を戦死させる（先頭が攻撃を受けるので並びを入れ替える）
  for (const x of ms.slice(1)) {
    s.soldiers.splice(s.soldiers.indexOf(x), 1);
    s.soldiers.unshift(x);
    a.damageSquad(m, 999, false);
  }
  lone.hp = max - 20;
  lone.cd = 0;
  // ほかの部隊は全員満タン
  for (const x of a.members(s.squads[0])) x.hp = a.soldierStats(x).maxHp;
  WD_DEBUG.step(3.5);
  return { hp: lone.hp, max, alive: a.members(m).length, dead: ms.slice(1).map((x) => x.alive) };
});
check("自分自身は回復できない", r.alive === 1 && r.hp === r.max - 20, JSON.stringify(r));
check(
  "戦死した衛生兵は通常の兵士と同じく戦死扱い",
  r.dead.every((x) => x === false),
);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    g = s.squads[0],
    dead = s.soldiers.filter((x) => !x.alive);
  // 鉄砲隊の1人も戦死させ、衛生兵の範囲に置いたまま回復させる
  const gs = a.members(g);
  const victim = gs[0];
  victim.hp = 0.1;
  a.damageSquad(g, 999, false);
  // 新しく衛生兵を雇って回復させる
  WD_DEBUG.state().playing = WD_DEBUG.state().playing;
  for (const x of s.soldiers) x.cd = 0;
  WD_DEBUG.step(6.5);
  return { victimHp: victim.hp, alive: victim.alive, others: dead.every((x) => !x.alive && x.hp === 0) };
});
check("戦死者は蘇生しない（HP0のまま）", !r.alive && r.victimHp === 0 && r.others, JSON.stringify(r));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 経験値・スキル");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    R = WD_DEBUG.unitConfig.SQUAD_RULES,
    out = {};
  a.setSkillRng(() => 0);
  for (const type of ["gunner", "medic"]) {
    const m = { type, level: 1, xp: 0, skills: [], alive: true, history: [], squadId: 0, name: null };
    const at = {};
    while (m.level < 30) {
      a.gainXp(m, R.xpToLevel(m.level) - m.xp, true);
      at[m.level] = m.skills.filter((id) => !a.SOLDIER_SKILLS[id].job); // 熟練度で覚える職業スキルは別
    }
    out[type] = { at5: at[5], at15: at[15], at30: at[30] };
  }
  a.setSkillRng();
  const sk = a.SOLDIER_SKILLS;
  return { out, types: Object.fromEntries(Object.entries(sk).map(([k, v]) => [k, v.types])) };
});
check(
  "Lv5・Lv15・Lv30でスキルを習得（鉄砲兵・衛生兵とも最大3つ）",
  ["gunner", "medic"].every(
    (t) => r.out[t].at5.length === 1 && r.out[t].at15.length === 2 && r.out[t].at30.length === 3,
  ),
  JSON.stringify(r.out),
);
check(
  "Lv30の固有スキル：鉄砲兵「三段撃ち」・衛生兵「名医」",
  r.out.gunner.at30[2] === "volley" && r.out.medic.at30[2] === "masterHealer",
);
check(
  "鉄砲兵は速射・精密射撃、衛生兵は治療上手・早手当を習得できる",
  r.types.rapidFire.includes("gunner") &&
    r.types.preciseShot.includes("gunner") &&
    r.types.goodHealer.includes("medic") &&
    r.types.quickAid.includes("medic"),
);
check(
  "衛生兵は攻撃系のスキル（連続攻撃・敵将狙いなど）を習得しない",
  !r.types.combo.includes("medic") &&
    !r.types.generalHunter.includes("medic") &&
    !r.types.spearMaster.includes("medic"),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    m = s.soldiers.find((x) => x.type === "medic" && x.alive),
    g = s.soldiers.find((x) => x.type === "gunner" && x.alive);
  const st = (x, sk) => {
    const keep = x.skills;
    x.skills = sk;
    const v = a.soldierStats(x);
    x.skills = keep;
    return v;
  };
  return {
    heal: st(m, ["goodHealer"]).heal / st(m, []).heal,
    rate: st(m, ["quickAid"]).rate / st(m, []).rate,
    atk: st(g, ["preciseShot"]).atk / st(g, []).atk,
    rapid: st(g, ["rapidFire"]).rate / st(g, []).rate,
  };
});
check(
  "治療上手：回復量 +25%／早手当：回復間隔 -15%",
  Math.abs(r.heal - 1.25) < 1e-9 && Math.abs(r.rate - 0.85) < 1e-9,
  JSON.stringify(r),
);
check(
  "精密射撃：攻撃力 +15%／速射：攻撃間隔 -10%",
  Math.abs(r.atk - 1.15) < 1e-9 && Math.abs(r.rapid - 0.9) < 1e-9,
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    R = WD_DEBUG.unitConfig.SQUAD_RULES,
    m = s.soldiers.find((x) => x.type === "medic" && x.alive),
    g = a.members(s.squads[0])[0],
    max = a.soldierStats(g).maxHp;
  // 治療を何度くり返しても、1ウェーブの経験値は上限まで
  for (let i = 0; i < 200; i++) {
    g.hp = 1;
    m.cd = 0;
    WD_DEBUG.step(0.05);
  }
  g.hp = max;
  return { waveXp: m.waveXp, cap: R.xpWaveCap };
});
check(
  "治療をくり返しても1ウェーブの経験値は上限まで（無限に稼げない）",
  r.waveXp === r.cap,
  JSON.stringify(r),
);

console.log("■ 保存・再読み込み");
await clearWave(page);
const before = await ev(page, () =>
  WD_DEBUG.state()
    .soldiers.filter((x) => x.alive)
    .map((x) => [x.id, x.type, x.level, x.xp, x.heals || 0].join("|"))
    .sort()
    .join(","),
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
r = await ev(page, () =>
  WD_DEBUG.state()
    .soldiers.map((x) => [x.id, x.type, x.level, x.xp, x.heals || 0].join("|"))
    .sort()
    .join(","),
);
check(
  "鉄砲兵・衛生兵の兵種・Lv・経験値・治療回数を保存して復元",
  r === before && /gunner/.test(r) && /medic/.test(r),
  r + " vs " + before,
);
await openInfoEntry(page, '#soldiers');
text = await page.textContent("#soldierList");
check(
  "兵士名簿に鉄砲兵・衛生兵（衛生兵は回復量と治療回数）",
  /鉄砲兵・Lv/.test(text) && /衛生兵・Lv/.test(text) && /回復\d/.test(text) && /治療 \d+回/.test(text),
  text.slice(0, 200),
);
await page.tap("#soldierClose");

console.log("■ 攻城編成（防衛の部隊と同じ）");
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    type = (id) => s.soldiers.find((x) => x.id === id).type;
  return WD_DEBUG.squadApi.siege().map((u) => [...new Set(u.soldiers.map(type))].join("+"));
});
check(
  "鉄砲兵・衛生兵の部隊がそのまま攻城の部隊になる（1部隊1兵種）",
  r.includes("gunner") && r.includes("medic"),
  JSON.stringify(r),
);
await page.tap("#siege");
const tab = r.indexOf("gunner");
await page.tap(`#siegeTabs [data-unit="${tab}"]`);
text = await page.textContent("#siegeUnit");
check(
  "攻城編成の画面に部隊の兵種（鉄砲兵）",
  /（鉄砲兵）/.test(text) && /兵種 鉄砲兵\d/.test(text),
  text.slice(0, 100),
);
if (shots) await page.screenshot({ path: path.join(shots, "u2-siege.png") });
await page.tap("#siegeClose");

console.log("■ 画面（390px）");
if (!(await page.isVisible("[data-u]"))) await page.tap("#hireToggle"); // 雇用ボタンを開いて測る
const lay = await ev(page, () => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  minBtn: Math.min(
    ...[...document.querySelectorAll("[data-u]")].map((b) => b.getBoundingClientRect().height),
  ),
  minW: Math.min(...[...document.querySelectorAll("[data-u]")].map((b) => b.getBoundingClientRect().width)),
}));
check(
  "雇用ボタン5つでも横スクロールなし・押しやすい大きさ",
  !lay.hScroll && lay.minBtn >= 44 && lay.minW >= 80,
  JSON.stringify(lay),
);
if (shots) await page.screenshot({ path: path.join(shots, "u3-menu.png"), fullPage: true });
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ");
({ page, errors, context } = await newContext({
  "worldDefense.soldiers.v1": JSON.stringify({
    version: 1,
    seq: 2,
    squadSeq: 1,
    squads: [{ id: 1, type: "archer" }],
    soldiers: [
      {
        id: 1,
        type: "archer",
        squadId: 1,
        level: 6,
        xp: 3,
        skills: ["rapidFire"],
        battles: 4,
        kills: 2,
        wavesSurvived: 4,
        history: [],
      },
      {
        id: 2,
        type: "archer",
        squadId: 1,
        level: 2,
        xp: 0,
        skills: [],
        battles: 1,
        kills: 0,
        wavesSurvived: 1,
        history: [],
      },
    ],
    fallen: [],
  }),
}));
r = await ev(page, () =>
  WD_DEBUG.state().soldiers.map((x) => [x.type, x.level, x.skills.join(), x.heals || 0].join("|")),
);
check(
  "新兵種の前の保存データもそのまま読み込める",
  r.join() === "archer|6|rapidFire|0,archer|2||0" && errors.length === 0,
  r.join(),
);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
