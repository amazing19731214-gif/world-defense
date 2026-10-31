// 戦場試練 v108.8：サバイバルの攻撃スキル（8種類・Lv1〜5・6枠・3択・進化・引き継ぎ・リセット・重さ）
//   node tools/test-trial-skills.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const P = 1e15;
// 剣聖・槍将・弓聖・銃将・医王（Lv300・最上級職・閃き・装備）
const U = [
  ["ashigaru", "sword_saint", { sword_saint: P, samurai: P, kensei: P }, "osafune", "in_sword_saint"],
  ["spearman", "spear_commander", { spear_commander: P, spearman: P }, "nagayari", "in_spear_commander"],
  ["archer", "bow_saint", { bow_saint: P, archer: P }, "raijodo", "in_bow_saint"],
  ["gunner", "gun_commander", { gun_commander: P, gunner: P }, "sakaizutsu", "in_gun_commander"],
  ["medic", "healing_master", { healing_master: P, medic: P }, "tosei", "in_healing_master"],
];
const items = [];
const soldiers = U.map(([type, job, prof, gear, ins], i) => {
  items.push({ uid: i + 1, id: gear, owner: i + 1, lock: true });
  return { id: i + 1, type, squadId: 1, level: 300, name: "兵" + (i + 1), job, jobs: [type, job], prof, insight: { known: [ins], equipped: [ins] } };
});
const save = { version: 1, seq: 5, squadSeq: 1, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }], soldiers };
async function open({ width = 390, height = 844, query = "?debug", ougi = null } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(
    ([save, items, ougi]) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [], forge: { items } }));
      if (ougi) localStorage.setItem("worldDefense.ougi.v1", JSON.stringify(ougi));
    },
    [save, items, ougi],
  );
  const p = await c.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
const storage = (p) => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))));
const KEYS = ["thunder", "fireRing", "shuriken", "vacuum", "spear", "musket", "whirl", "heal"];
// 主人公1人・敵を出さない状態で始める
const quiet = (p, hero = 1, ids = [1, 2, 3, 4, 5]) =>
  p.evaluate(
    ([hero, ids]) => {
      const T = WD_DEBUG.trial;
      if (T.on()) T.retreat(); // 前の挑戦を終える
      document.getElementById("trialSheet").hidden = true;
      T.start(ids, { mode: "survival", hero });
      const L = T.live();
      L.next = 1e9;
      L.st = 20; // 面の始まりの守り（3秒）を過ぎた所
      L.units[0].x = 1000;
      L.units[0].y = 600;
      return T.state().skills;
    },
    [hero, ids],
  );
// 主人公のまわりに敵を並べる（倒されにくい体力）。1回の発動で何体に当たるかを数える
const castCount = (p, key, lv, ring = [60, 110, 170, 240, 320]) =>
  p.evaluate(
    ([key, lv, ring]) => {
      const T = WD_DEBUG.trial,
        L = T.live(),
        h = L.units[0];
      L.skills = { [key]: lv };
      L.skillCd = { [key]: 0 };
      L.skillUse = {};
      L.enemies = [];
      L.next = 0;
      for (let i = 0; i < 4; i++) WD_DEBUG.step(0.05); // 1体ずつ出す
      L.next = 1e9;
      const tmpl = L.enemies[0];
      L.enemies = [];
      let n = 0;
      for (const r of ring)
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2 + r * 0.01;
          L.enemies.push(Object.assign({}, tmpl, { id: "x" + n++, x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r * 0.8, hp: 1e9, max: 1e9, gone: false, target: null, cd: 99, burn: null }));
        }
      const hp0 = L.enemies.map((e) => e.hp);
      L.skillCd = { [key]: 0 };
      h.hp = h.max * 0.5;
      const hh0 = h.hp;
      h.cd = 99; // 通常攻撃は止める（スキルだけを数える）
      for (let i = 0; i < 8; i++) {
        WD_DEBUG.step(0.05);
        if (L.skillUse[key]) L.skillCd[key] = 99; // 1回だけ
      }
      return { hit: L.enemies.filter((e, i) => e.hp < hp0[i]).length, used: L.skillUse[key] || 0, heal: h.hp - hh0 };
    },
    [key, lv, ring],
  );
try {
  let { c, p } = await open();
  let r;
  const save0 = await storage(p);
  // 1. 最初のスキルは職業に合わせて1つ（剣聖：真空斬・槍将：槍衾・弓聖：手裏剣・銃将：火縄銃・医王：雷撃）
  const starts = [];
  for (const id of [1, 2, 3, 4, 5]) starts.push(Object.keys(await quiet(p, id)).join() + ":" + Object.values(await p.evaluate(() => WD_DEBUG.trial.state().skills)).join());
  check(starts.join() === "vacuum:1,spear:1,shuriken:1,musket:1,thunder:1", "最初の攻撃スキルは主人公の職業に合わせて1つ（Lv1）", starts);
  // 1b. 遠くを狙いすぎない：立っているだけでも、スキルで倒した敵のコインが吸い寄せの範囲に落ちる（弓・鉄砲の主人公）
  const stand = [];
  for (const hero of [3, 4]) {
    await p.evaluate(() => WD_DEBUG.trial.on() && WD_DEBUG.trial.retreat());
    stand.push(
      await p.evaluate((hero) => {
        const T = WD_DEBUG.trial;
        document.getElementById("trialSheet").hidden = true;
        T.start([1, 2, 3, 4, 5], { mode: "survival", hero });
        const L = T.live(),
          h = L.units[0],
          far = [];
        let n0 = 0;
        for (let i = 0; i < 600 && !L.choice; i++) {
          WD_DEBUG.step(0.1);
          for (; n0 < L.coins.length; n0++) far.push(Math.round(Math.hypot(L.coins[n0].x - h.x, L.coins[n0].y - h.y)));
          n0 = L.coins.length;
        }
        return { hero, t: Math.round(L.st), lvUp: !!L.choice, xp: T.state().xpTotal, magnet: T.survival.magnet, far: far.slice(0, 8) };
      }, hero),
    );
  }
  check(stand.every((r) => r.lvUp && r.xp > 0 && r.t < 50), "弓・鉄砲の主人公が立っているだけでも、コインを拾ってレベルアップする（スキルは吸い寄せの範囲の敵から狙う）", stand);
  // 2. 8種類それぞれ：発動して敵に当たる・Lv が上がると当たる数・回復の量が増える
  await quiet(p, 1);
  const rows = {};
  for (const k of KEYS) {
    const a = await castCount(p, k, 1),
      b = await castCount(p, k, 5);
    rows[k] = [a.used, a.hit, b.used, b.hit, Math.round(a.heal), Math.round(b.heal)];
  }
  console.log("   1回の発動で当たった敵（Lv1→Lv5）：" + KEYS.map((k) => k + " " + rows[k][1] + "→" + rows[k][3]).join("・"));
  check(KEYS.filter((k) => k !== "heal").every((k) => (rows[k][0] > 0 || k === "fireRing") && rows[k][1] > 0 && rows[k][3] > rows[k][1]), "攻撃スキル7種類が発動して敵に当たり、Lv5 では当たる数が増える（連鎖・本数・範囲・貫通）", rows);
  check(rows.heal[0] > 0 && rows.heal[4] > 0 && rows.heal[5] > rows.heal[4], "癒やしの陣が発動して回復し、Lv5 では回復の量が増える", rows.heal);
  // 3. Lv1〜5：同じスキルを選ぶと Lv が上がり、Lv5 は候補から消える。6種類まで（6種類そろうと新しい習得は出ない）
  r = await p.evaluate((KEYS) => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.skills = { thunder: 1 };
    L.skillCd = {};
    const lv = [];
    for (let i = 0; i < 6; i++) T.learn("thunder"), lv.push(L.skills.thunder);
    const o5 = T.skillOptions();
    for (const k of ["fireRing", "shuriken", "vacuum", "spear", "musket"]) T.learn(k);
    const o6 = T.skillOptions();
    for (const k of Object.keys(L.skills)) while (L.skills[k] < 5) T.learn(k);
    const oAll = T.skillOptions();
    return { lv, up5: o5.up.map((x) => x.key), learn5: o5.learn.length, kinds: Object.keys(L.skills).length, learn6: o6.learn.length, up6: o6.up.length, all: oAll.up.length + oAll.learn.length };
  }, KEYS);
  check(r.lv.join() === "2,3,4,5,5,5" && !r.up5.includes("thunder") && r.learn5 === 7, "同じスキルを選ぶと Lv1→2→3→4→5。Lv5 になると候補から消える", r);
  check(r.kinds === 6 && r.learn6 === 0 && r.up6 === 5 && r.all === 0, "攻撃スキルは6種類まで。6種類そろうと新しい習得は出ず、強化だけが出る", r);
  // 4. 3択：仲間の加入・スキルの強化・新しい習得。重複しない。全部 Lv5 なら能力の強化で埋まる
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.retreat();
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live(),
      seen = [],
      bad = [];
    for (let n = 0; n < 60; n++) {
      L.lvUps = 1;
      L.lvAt = null;
      L.next = 1e9;
      WD_DEBUG.step(0.05);
      const ch = L.choice;
      if (!ch) continue;
      const ids = ch.map((c) => c.kind + ":" + (c.key || c.unit.id));
      if (new Set(ids).size !== ids.length) bad.push("重複 " + ids);
      for (const c of ch) {
        if (c.kind !== "skill") continue;
        const cur = L.skills[c.key] || 0;
        if (c.from !== cur || c.to !== cur + 1 || c.to > 5) bad.push("Lv " + c.key);
        if (!cur && Object.keys(L.skills).length >= 6) bad.push("枠 " + c.key);
      }
      seen.push(ch.map((c) => c.kind).join("/"));
      // 仲間は最初の4回だけ加入、あとはスキルを選ぶ
      const k = ch.findIndex((c) => c.kind === "recruit");
      T.choose(k >= 0 ? k : ch.findIndex((c) => c.kind === "skill") >= 0 ? ch.findIndex((c) => c.kind === "skill") : 0);
    }
    return { bad, first: seen.slice(0, 3), last: seen.slice(-3), skills: { ...L.skills }, units: L.units.length };
  });
  console.log("   3択の例：" + r.first.join(" ｜ ") + " … " + r.last.join(" ｜ "));
  check(r.bad.length === 0 && r.first.every((s) => s.includes("recruit") && s.includes("skill")), "3択は「仲間の加入」と攻撃スキル（強化・新しい習得）。重複や取れない候補は出ない", r);
  check(r.last.every((s) => s === "boon/boon/boon") && Object.values(r.skills).every((v) => v === 5) && Object.keys(r.skills).length === 6 && r.units === 5, "6種類が全部 Lv5 になると、3択は能力の強化だけになる", r);
  // 5. 通常攻撃と攻撃スキルが同時に動く。6つのスキルが同時に動く
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.skillUse = {};
    L.st = 60;
    L.next = 0;
    let normal = 0;
    h.cd = 0;
    for (let i = 0; i < 600; i++) {
      for (const u of L.units) u.hp = Math.max(u.hp, u.max * 0.5);
      if (L.choice) T.choose(0);
      L.next = Math.min(L.next, 0.5);
      // 体力の多い敵を1体、主人公の隣に置く（スキルが遠くの敵を先に倒すので、近くの攻撃も見る）
      const tank = L.enemies.find((e) => !e.gone && e.tank) || L.enemies.find((e) => !e.gone);
      if (tank) Object.assign(tank, { tank: true, x: h.x + 26, y: h.y, hp: 1e9, max: 1e9, cd: 99 });
      WD_DEBUG.step(0.05);
      if (h.atk > 0.1) normal++; // 通常攻撃の構え（0.18秒）
    }
    return { use: { ...L.skillUse }, normal, kinds: Object.keys(L.skills), orbs: !!(L.orbs && L.orbs.fireRing) };
  });
  check(r.normal > 0 && r.orbs && r.kinds.every((k) => k === "fireRing" || r.use[k] > 0), "通常攻撃（" + r.normal + "回）と、6つの攻撃スキルが同時に動く", r);
  await c.close();

  // 6. 進化：雷撃Lv5＋真空斬Lv5 → 雷神剣、火炎輪Lv5＋旋風斬Lv5 → 紅蓮旋風（大将の宝箱）。元の2つは1つにまとまり、枠が空く
  ({ c, p } = await open());
  await quiet(p, 1);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.skills = { thunder: 5, vacuum: 5, fireRing: 5, whirl: 5, shuriken: 5, spear: 5 };
    const r1 = T.roll(false);
    L.cleared = { stage: 1, great: false };
    L.chest = { state: "open", reward: r1 };
    T.chestTake();
    while (L.choice) T.choose(0);
    const after1 = { ...L.skills };
    const r2 = T.roll(false);
    L.chest = { state: "open", reward: r2 };
    T.chestTake();
    while (L.choice) T.choose(0);
    const after2 = { ...L.skills },
      learn = T.skillOptions().learn.map((x) => x.key);
    // 影刃乱舞・鉄壁の弾幕はデータだけ（出さない）
    L.skills = { shuriken: 5, vacuum: 5, spear: 5, musket: 5 };
    const r3 = T.roll(false);
    return { r1, r2, after1, after2, learn, r3 };
  });
  check(r.r1.evo && r.r1.key === "raijinken" && !r.after1.thunder && !r.after1.vacuum && r.after1.raijinken === 5, "雷撃Lv5＋真空斬Lv5 → 宝箱が「雷神剣」に。元の2つは1つにまとまる", r.after1);
  check(r.r2.evo && r.r2.key === "guren" && r.after2.guren === 5 && !r.after2.fireRing && !r.after2.whirl && Object.keys(r.after2).length === 4 && r.learn.length > 0, "火炎輪Lv5＋旋風斬Lv5 → 「紅蓮旋風」。枠が空いて、新しいスキルをまた習得できる", { after2: r.after2, learn: r.learn });
  check(!r.r3.evo, "影刃乱舞・鉄壁の弾幕は、まだ準備中（条件がそろっても出さない）", r.r3);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.cleared = null; // 宝箱の試験のあと（止まったまま）を戻す
    L.chest = null;
    L.skills = { raijinken: 5, guren: 5 };
    L.skillCd = { raijinken: 0, guren: 0 };
    L.skillUse = {};
    L.st = 60;
    L.next = 0;
    for (let i = 0; i < 200; i++) {
      h.hp = Math.max(h.hp, h.max * 0.5);
      if (L.choice) T.choose(0);
      L.next = Math.min(L.next, 0.5);
      const tank = L.enemies.find((e) => !e.gone && e.tank) || L.enemies.find((e) => !e.gone);
      if (tank) Object.assign(tank, { tank: true, x: h.x + 120, y: h.y, hp: 1e9, max: 1e9, cd: 99 });
      WD_DEBUG.step(0.05);
    }
    return { use: { ...L.skillUse }, orbs: L.orbs && L.orbs.guren ? L.orbs.guren.pos.length : 0 };
  });
  check(r.use.raijinken > 0 && r.use.guren > 0 && r.orbs === 4, "雷神剣（十字の斬撃と雷の連鎖）・紅蓮旋風（4つの炎と炎の旋風）が動く", r);
  // 6b. スキル欄のアイコンが文字化けしない（進化スキルの絵文字2つ＝サロゲートペアを途中で切らない）
  r = await p.evaluate(() => {
    const L = WD_DEBUG.trial.live();
    L.skills = { raijinken: 5, guren: 5, shuriken: 3, spear: 2 };
    const C = [...document.querySelectorAll("canvas")].map((c) => c.getContext("2d")).find((c) => c && Object.prototype.hasOwnProperty.call(c, "fillText")),
      orig = C.fillText,
      texts = [];
    C.fillText = function (t, ...a) {
      texts.push(String(t));
      return orig.call(this, t, ...a);
    };
    try {
      WD_DEBUG.heroApi.draw();
    } finally {
      C.fillText = orig;
    }
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    return { bad: texts.filter((t) => lone.test(t)), icons: texts.filter((t) => /⚡🌪|🔥🌀/.test(t)) };
  });
  check(r.bad.length === 0 && r.icons.length === 2, "スキル欄の進化アイコン（⚡🌪・🔥🌀）が文字化けせずに出る", r);
  // 7. 面をまたいでスキルと Lv を引き継ぐ。挑戦が終わるとリセット（次の挑戦は最初のスキルだけ）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.skills = { vacuum: 3, thunder: 2, heal: 1 };
    L.boss = { gone: true, great: false };
    L.cleared = null;
    WD_DEBUG.step(0.05);
    if (L.chest) (L.chest.state = "open"), T.chestTake();
    while (L.choice) T.choose(0);
    const before = JSON.stringify(L.skills);
    T.nextStage();
    const after = JSON.stringify(L.skills),
      stage = L.floor;
    T.retreat();
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2], { mode: "survival", hero: 1 });
    return { before, after, stage, fresh: T.state().skills, text: "" };
  });
  check(r.stage === 2 && r.before === r.after, "次の面へ進んでも、攻撃スキルと Lv はそのまま（" + r.after + "）", r);
  check(JSON.stringify(r.fresh) === '{"vacuum":1}', "挑戦が終わると攻撃スキルはリセット（次の挑戦は最初のスキル Lv1 だけ）", r.fresh);
  await c.close();

  // 8. 重さ：攻撃スキル6つ（Lv5）・敵36体でも、1コマの処理と描画が軽い。演出・矢弾・飛んでいる弾が溜まらない。ふつうの敵は36体まで（大将は別）
  ({ c, p } = await open({ width: 390, height: 844 }));
  await quiet(p, 1);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.skills = { thunder: 5, fireRing: 5, shuriken: 5, vacuum: 5, musket: 5, whirl: 5 };
    L.skillCd = {};
    L.st = 120;
    let maxN = 0,
      maxFx = 0,
      maxShots = 0,
      maxProj = 0,
      tick = 0,
      draw = 0,
      frames = 0;
    for (let i = 0; i < 900; i++) {
      for (const u of L.units) u.hp = Math.max(u.hp, u.max * 0.5);
      if (L.choice) T.choose(0);
      if (L.cleared) {
        if (L.chest && L.chest.state === "closed") (L.chest.state = "open"), T.chestTake();
        while (L.choice) T.choose(0);
        T.nextStage();
      }
      L.next = Math.min(L.next, 0.2); // 敵をどんどん出す（上限まで）
      const a = performance.now();
      WD_DEBUG.step(0.05);
      const b = performance.now();
      if (i % 5 === 0) {
        WD_DEBUG.heroApi.draw();
        draw += performance.now() - b;
        frames++;
      }
      tick += b - a;
      const s = T.state();
      maxN = Math.max(maxN, L.enemies.filter((e) => !e.gone && e !== L.boss).length);
      maxFx = Math.max(maxFx, s.fx);
      maxShots = Math.max(maxShots, s.shots);
      maxProj = Math.max(maxProj, s.proj);
    }
    return { maxN, maxFx, maxShots, maxProj, tick: Math.round((tick / 900) * 100) / 100, draw: Math.round((draw / frames) * 10) / 10 };
  });
  check(r.maxN <= 36 && r.maxFx <= 80 && r.maxShots <= 160 && r.maxProj < 60, "ふつうの敵は36体まで（大将は別に数える）。演出・矢弾・飛んでいる弾は溜まらない（敵 " + r.maxN + "・演出 " + r.maxFx + "・矢弾 " + r.maxShots + "）", r);
  check(r.tick + r.draw < 16, "攻撃スキル6つ（Lv5）でも軽い（1コマの処理 " + r.tick + "ms・描画 " + r.draw + "ms）", r);
  await c.close();

  // 9. iPhone縦（375px・390px）：スキルの3択がはみ出さない（名前・Lv・説明・新規か強化か）
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812 }));
    await quiet(p, 1, [1]);
    r = await p.evaluate(async () => {
      const T = WD_DEBUG.trial,
        L = T.live();
      L.skills = { vacuum: 2, thunder: 1 };
      L.lvUps = 1;
      L.lvAt = null;
      WD_DEBUG.step(0.05);
      WD_DEBUG.heroApi.draw();
      await new Promise((r) => setTimeout(r, 500));
      const k = document.querySelector("#trialLevelUp .trial-levelup-card").getBoundingClientRect(),
        btns = [...document.querySelectorAll("[data-trial-choose]")].map((b) => b.textContent);
      return { ok: k.left >= 8 && k.right <= innerWidth - 8 && k.top >= 0 && k.bottom <= innerHeight, btns, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check(r.ok && r.overflow <= 0 && r.btns.length === 3 && r.btns.some((t) => /強化/.test(t) && /Lv\d → Lv\d/.test(t)) && r.btns.some((t) => /新しい攻撃スキル/.test(t)), "iPhone縦（" + width + "px）：スキルの3択（新しい習得・Lv○→Lv○の強化・説明）がはみ出さない", r.btns);
    await p.locator('[data-trial-choose="0"]').tap();
    r = await p.evaluate(() => !WD_DEBUG.trial.state().choice);
    check(r, "指でスキルを選べる（" + width + "px）", r);
    await c.close();
  }
  ({ c, p } = await open());
  const s1 = await storage(p);
  await quiet(p, 1);
  await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    for (const k of ["thunder", "fireRing", "shuriken", "vacuum", "spear"]) T.learn(k);
    for (let i = 0; i < 100; i++) WD_DEBUG.step(0.1);
    T.retreat();
  });
  r = await p.evaluate(() => document.getElementById("trialBody").textContent);
  check(/攻撃スキル：/.test(r) && /雷撃/.test(r), "結果の画面に、使った攻撃スキルと Lv が出る", r.slice(0, 120));
  check((await storage(p)) === s1, "攻撃スキル・進化は保存データに入らない（本番の兵士・閃き・奥義・装備は変わらない）");
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
