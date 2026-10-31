// 戦場試練 v108.1〜v108.2：サバイバル（主人公1人から始まり、レベルアップで仲間を加入）。主人公の選び方・操作・仲間の AI・敵の出現・強敵・勝敗・撤退・地形・iPhone・保存データ
//   node tools/test-trial-survival.mjs
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
async function open({ width = 390, height = 844, query = "?debug" } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(
    ([save, items]) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [], forge: { items } }));
    },
    [save, items],
  );
  const p = await c.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  // v108.2：レベルアップの選択は、この試験では「仲間を加入」を優先して自動で選ぶ（選択そのものは test-trial-recruit で確かめる）
  await p.evaluate(() => {
    const step0 = WD_DEBUG.step;
    WD_DEBUG.step = (sec) => {
      for (let i = 0; i < Math.max(1, Math.round(sec / 0.1)); i++) {
        const s = WD_DEBUG.trial.state();
        if (s && s.choice) {
          const k = s.choice.findIndex((c) => c.startsWith("recruit"));
          WD_DEBUG.trial.choose(k >= 0 ? k : 0);
        }
        step0(Math.min(0.1, sec));
      }
    };
  });
  return { c, p };
}
const storage = (p) => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))));
// 戦闘を進めながら、地形（川・木と岩）に埋まっていないか・新しい敵が画面の外から出たかを調べる
const runWatch = (p, sec, stickFn) =>
  p.evaluate(
    ([sec, stickSrc]) => {
      const T = WD_DEBUG.trial,
        M = T.map(),
        seen = new Set(),
        stick = stickSrc ? new Function("i", "L", stickSrc) : null;
      let bad = [],
        inView = [],
        spawns = 0,
        maxE = 0;
      const inRiver = (x, y) => x > M.river.x0 && x < M.river.x1 && !M.bridges.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      for (const e of T.live().enemies) seen.add(e.id);
      for (let i = 0; i < sec * 10 && T.on(); i++) {
        const L = T.live();
        if (stick) stick(i, L);
        const h = L.units.find((u) => u.id === L.hero),
          vw = 960,
          vh = 600,
          ox = Math.max(0, Math.min(M.size.w - vw, h.x - vw / 2)),
          oy = Math.max(0, Math.min(M.size.h - vh, h.y - 20 - vh / 2));
        WD_DEBUG.step(0.1);
        if (!T.on()) break;
        for (const e of L.enemies)
          if (!seen.has(e.id)) {
            seen.add(e.id);
            spawns++;
            if (e.x > ox && e.x < ox + vw && e.y > oy && e.y < oy + vh) inView.push([Math.round(e.x), Math.round(e.y), Math.round(ox), Math.round(oy)]);
          }
        maxE = Math.max(maxE, L.enemies.filter((e) => !e.gone).length);
        for (const o of [...L.units.filter((u) => !u.dead), ...L.enemies.filter((e) => !e.gone)]) {
          if (inRiver(o.x, o.y)) bad.push(["川", o.id, Math.round(o.x), Math.round(o.y)]);
          for (const b of M.obstacles) if (Math.hypot(o.x - b.x, o.y - b.y) < b.r + 4) bad.push(["木・岩", o.id, Math.round(o.x), Math.round(o.y)]);
        }
      }
      return { bad: bad.slice(0, 5), nBad: bad.length, inView, spawns, maxE };
    },
    [sec, stickFn || null],
  );
try {
  // 1. 出撃の画面（iPhone縦 390px）：遊び方を「サバイバル」にして、選んだ兵士の中から主人公を選ぶ（どの職業でも）
  let { c, p } = await open();
  const save0 = await storage(p);
  await p.evaluate(() => WD_DEBUG.trial.open("pick"));
  await p.locator('[data-trial-mode="survival"]').tap();
  for (const id of [1, 2, 3, 4, 5]) await p.locator('[data-trial-pick="' + id + '"]').tap();
  let r = await p.evaluate(() => ({
    mode: document.querySelector('[data-trial-mode="survival"]').getAttribute("aria-pressed"),
    heroes: [...document.querySelectorAll("[data-trial-hero]")].map((b) => [+b.dataset.trialHero, b.getAttribute("aria-pressed"), Math.round(b.getBoundingClientRect().height)]),
    go: document.querySelector("[data-trial-go]").textContent,
    small: [...document.querySelectorAll("#trialBody button")].filter((b) => b.getBoundingClientRect().height < 40).length,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  check(r.mode === "true" && r.heroes.length === 5 && r.heroes[0][1] === "true" && r.go.includes("サバイバル") && r.small === 0 && r.overflow <= 0, "出撃の画面で「🔥 サバイバル」を選び、選んだ5人が主人公の候補に並ぶ（押しやすい・はみ出さない）", r);
  await p.locator('[data-trial-hero="3"]').tap(); // 弓聖を主人公に（戦闘の前なら変えられる）
  r = await p.evaluate(() => [...document.querySelectorAll("[data-trial-hero]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => +b.dataset.trialHero));
  check(r.join() === "3", "主人公を戦闘の前に変えられる（弓聖にした）", r);
  await p.locator("[data-trial-go]").tap();
  r = await p.evaluate(() => {
    const s = WD_DEBUG.trial.state();
    return {
      mode: s.mode,
      phase: s.phase,
      hero: s.hero,
      control: s.control,
      units: document.getElementById("trialUnits").hidden,
      auto: document.getElementById("trialAutoAll").hidden,
      pad: document.getElementById("trialPad").offsetParent !== null,
      info: document.getElementById("trialInfo").textContent,
    };
  });
  check(r.mode === "survival" && r.phase === "fight" && r.hero === 3 && r.control === 3, "サバイバルは配置なしですぐ始まり、主人公（弓聖）を操作する", r);
  check(r.units && r.auto && r.pad && /👑/.test(r.info) && /仲間 0\/4/.test(r.info), "画面：主人公の名前・仲間の人数とスティック（兵士の札・全員自動は出さない。HP・経験値・残り時間は戦場の上）", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      e1 = T.control(1);
    T.tap(480, 300);
    return { e1, control: T.state().control };
  });
  check(r.e1 && r.control === 3, "戦闘中は主人公を変えない（ほかの兵士は選べない）", r);
  // 2. スティックで主人公が動く。仲間はついてくる
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units.find((u) => u.id === 3),
      x0 = h.x;
    T.stick(1, 0);
    for (let i = 0; i < 40; i++) WD_DEBUG.step(0.1);
    const x1 = h.x;
    T.stick(0, 0);
    for (let i = 0; i < 20; i++) WD_DEBUG.step(0.1);
    return { moved: x1 - x0, stopped: Math.abs(h.x - x1) };
  });
  check(r.moved > 150 && r.stopped < 2, "主人公はスティックで動き、指を離すと止まる", r);
  // 3. 戦う：敵は画面の外から出る。主人公が止まっていても自動で攻撃し、戦闘が続く。地形に埋まらない
  // v108.8：手裏剣などの攻撃スキルは遠くの敵も倒すので、主人公は近くに敵がいないとき、落ちたコインの方へ歩く（コインを拾うのも遊び方）
  r = await runWatch(
    p,
    60,
    "const h = L.units.find((u) => u.id === L.hero), near = L.enemies.some((e) => !e.gone && Math.hypot(e.x - h.x, e.y - h.y) < 140), c = L.coins.slice().sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0]; if (!near && c) { const d = Math.hypot(c.x - h.x, c.y - h.y) || 1; WD_DEBUG.trial.stick((c.x - h.x) / d, (c.y - h.y) / d); } else WD_DEBUG.trial.stick(0, 0);",
  );
  await p.evaluate(() => WD_DEBUG.trial.stick(0, 0));
  const s60 = await p.evaluate(() => WD_DEBUG.trial.state());
  check(r.spawns >= 10 && r.inView.length === 0, "敵は主人公の画面の外から出てくる（目の前に急に出ない）（" + r.spawns + "体）", r.inView.slice(0, 3));
  const hero60 = s60.units.find((u) => u.id === 3);
  check(hero60.dealt > 0 && s60.kills >= 5, "主人公が止まっていても、攻撃は自動で続く（主人公の与ダメージ " + Math.round(hero60.dealt) + "・撃破 " + s60.kills + "）", hero60);
  check(r.nBad === 0, "兵士も敵も、川や木・岩に埋まらない", r.bad);
  // 加入した仲間は主人公についてくる
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units.find((u) => u.id === 3);
    T.stick(-1, 0.3);
    for (let i = 0; i < 50; i++) WD_DEBUG.step(0.1);
    T.stick(0, 0);
    for (let i = 0; i < 40; i++) WD_DEBUG.step(0.1);
    return { n: L.units.length, mates: L.units.filter((u) => u !== h && !u.dead).map((u) => Math.round(Math.hypot(u.x - h.x, u.y - h.y))) };
  });
  check(r.n >= 3 && r.mates.every((d) => d < 260), "加入した仲間は、主人公が動くとついてくる（" + (r.n - 1) + "人）", r);
  // 4. 仲間は職業に応じて戦う（遠距離は撃つ・近接は斬る・衛生兵は回復）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    for (let i = 0; i < 900 && L.units.length < 5; i++) WD_DEBUG.step(0.1); // v108.5：コインを拾って全員が加入するまで
    for (const u of L.units) if (u.id !== 5) u.hp = Math.max(1, u.hp * 0.6); // けがをさせて、衛生兵の回復を見る
    for (let i = 0; i < 300; i++) WD_DEBUG.step(0.1);
    return T.state().units.map((u) => ({ id: u.id, role: u.role, kills: u.kills, dealt: Math.round(u.dealt), healed: Math.round(u.healed), skills: Object.keys(u.skills).length }));
  });
  const by = (id) => r.find((u) => u.id === id);
  check(by(1).dealt > 0 && by(2).dealt > 0 && by(4).dealt > 0 && by(5).healed > 0, "仲間は職業に応じて戦う（剣聖・槍将は斬り、銃将は撃ち、医王は回復）", r);
  check(r.filter((u) => u.skills > 0).length >= 3, "主人公・仲間とも、職業技・閃きを自動で使う", r);
  // 5. 時間とともに敵が増え、最後に強敵が出る。強敵を倒すと勝利（Lv300の5人）
  //    v108.5：主人公は、近くに敵がいないときは落ちている経験値コインの方へ歩く（コインを拾うのが遊び方の一部）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      out = { early: 0, late: 0 };
    let last = T.state().t,
      bossAt = null;
    for (let i = 0; i < 2400 && T.on() && !T.live().cleared; i++) {
      {
        const L = T.live(),
          h = L.units.find((u) => u.id === L.hero),
          near = L.enemies.some((e) => !e.gone && Math.hypot(e.x - h.x, e.y - h.y) < 140),
          c = L.coins.filter((c) => Math.hypot(c.x - h.x, c.y - h.y) < 500).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
        if (!near && c) {
          const d = Math.hypot(c.x - h.x, c.y - h.y) || 1;
          T.stick((c.x - h.x) / d, (c.y - h.y) / d);
        } else T.stick(0, 0);
        // この試験は「大将を倒すと勝利になる流れ」を見る（難易度は test-trial-coins とシミュレーションで見る）。
        // 職業技の確率しだいで主人公が倒れて結果が揺れないよう、主人公の HP は3割より下げない
        if (h.hp < h.max * 0.3) h.hp = h.max * 0.3;
      }
      const s0 = T.live().spawned;
      WD_DEBUG.step(0.1);
      if (!T.on()) break;
      const L = T.live(),
        d = L.spawned - s0;
      if (L.t < 120) out.early += 0;
      if (L.boss && bossAt == null) bossAt = L.bossAt;
    }
    // v108.7：大将を倒すと面のクリア（宝箱）。ここで終えて結果を見る
    const cleared = T.state().cleared,
      st = T.state();
    T.retreat();
    return { bossAt, cleared, time: st.t, kills: st.kills, res: T.result() };
  });
  check(r.bossAt != null && Math.abs(r.bossAt - 150) < 1, "約2分30秒で強敵（大将）が出る", r.bossAt);
  check(r.cleared && r.cleared.stage === 1 && r.res.bosses === 1 && r.res.mode === "survival" && r.time > 150 && r.time < 240, "強敵を倒すと第1面クリア（" + Math.floor(r.time) + "秒・撃破 " + r.kills + "）", { cleared: r.cleared, bosses: r.res.bosses, time: r.time });
  const hero = r.res.units.find((u) => u.hero);
  check(hero && hero.id === 3 && r.res.kills >= 60, "結果の画面に主人公（👑）と撃破数が出る", { hero: hero && hero.name, kills: r.res.kills });
  r = await p.evaluate(() => ({ open: !document.getElementById("trialSheet").hidden, text: document.getElementById("trialBody").textContent }));
  check(r.open && /大将を倒した数 1/.test(r.text) && r.text.includes("👑"), "結果の画面（大将を倒した数・主人公の👑）", r.text.slice(0, 80));
  check((await storage(p)) === save0, "サバイバルの前後で保存データは変わらない（経験値・熟練度・閃き・装備・戦死）");
  await c.close();

  // 6. 時間とともに敵が増える（最初の30秒と、強敵の前の30秒の出現数）・上限を超えない・遠くに溜まらない
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      S = T.survival;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live(),
      h = L.units[0];
    let early = 0,
      late = 0,
      maxE = 0,
      far = 0;
    for (let i = 0; i < 1500 && T.on(); i++) {
      const n0 = L.spawned;
      // 主人公はゆっくり円を描いて歩く
      T.stick(Math.cos(i * 0.01), Math.sin(i * 0.01) * 0.6);
      WD_DEBUG.step(0.1);
      if (!T.on()) break;
      const d = L.spawned - n0;
      if (L.t <= 30) early += d;
      else if (L.t > 120 && L.t <= 150) late += d;
      const es = L.enemies.filter((e) => !e.gone);
      maxE = Math.max(maxE, es.length);
      if (L.t > 20) far = Math.max(far, ...es.filter((e) => e !== L.boss).map((e) => Math.hypot(e.x - h.x, e.y - h.y)));
    }
    return { early, late, maxE, max: S.maxAlive, far: Math.round(far), farRule: S.far };
  });
  check(r.late >= r.early * 2.5, "時間とともに敵が増える（最初の30秒 " + r.early + "体 → 強敵の前の30秒 " + r.late + "体）", r);
  check(r.maxE <= r.max + 1, "同時に出る敵は上限（" + r.max + "体＋強敵）まで", r);
  check(r.far < r.farRule + 300, "敵が主人公から遠くに溜まらない（いちばん遠くて " + r.far + "）", r);
  await c.close();

  // 7. 主人公が倒れたら敗北（仲間が生きていても）。仲間が倒れても主人公が生きていれば続く。撤退
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 5 }); // 衛生兵（医王）でも主人公になれる
    let L = T.live();
    // 回復の様子を見るための試験：主人公（医王）は倒れないようにして、仲間が加入するまで進める（v108.5：仲間の加入はコインしだい）
    for (let i = 0; i < 1200 && L.units.length < 3; i++) {
      L.units[0].hp = L.units[0].max;
      WD_DEBUG.step(0.1);
    }
    for (const u of L.units) if (u.id !== 5) u.hp *= 0.5;
    for (let i = 0; i < 200; i++) WD_DEBUG.step(0.1);
    const healerHero = { control: T.state().control, healed: Math.round(L.units[0].healed) };
    T.retreat();
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4], { mode: "survival", hero: 1 });
    L = T.live();
    // v108.8：攻撃スキルで遠くの敵も倒すので、近くに敵がいないときは落ちたコインの方へ歩く（仲間を呼ぶため）
    for (let i = 0; i < 1500 && !L.units.some((u) => u.id === 3); i++) {
      const h = L.units[0],
        near = L.enemies.some((e) => !e.gone && Math.hypot(e.x - h.x, e.y - h.y) < 140),
        c = L.coins.slice().sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
      if (!near && c) {
        const d = Math.hypot(c.x - h.x, c.y - h.y) || 1;
        T.stick((c.x - h.x) / d, (c.y - h.y) / d);
      } else T.stick(0, 0);
      WD_DEBUG.step(0.1);
    }
    T.stick(0, 0);
    const mate = L.units.find((u) => u.id === 3);
    for (let i = 0; i < 100; i++) WD_DEBUG.step(0.1);
    // 仲間（弓聖）が倒れる：続く
    mate.hp = 0.0001;
    let k = 0;
    while (!mate.dead && k++ < 1800) {
      mate.hp = Math.min(mate.hp, 0.0001);
      WD_DEBUG.step(0.1);
    }
    WD_DEBUG.heroApi.draw();
    const afterMate = { mateDead: mate.dead, on: T.on(), info: document.getElementById("trialInfo").textContent };
    // 主人公が倒れる：敗北
    const h = L.units.find((u) => u.id === 1);
    k = 0;
    while (T.on() && k++ < 1200) {
      h.hp = Math.min(h.hp, 0.0001);
      WD_DEBUG.step(0.1);
    }
    const res = T.result();
    return { healerHero, afterMate, res: res.result, heroDead: res.units.find((u) => u.hero).dead, matesAlive: res.units.filter((u) => !u.hero && !u.dead).length };
  });
  check(r.healerHero.control === 5 && r.healerHero.healed > 0, "衛生兵（医王）も主人公にでき、近くの仲間を自動で回復する", r.healerHero);
  check(r.afterMate.mateDead && r.afterMate.on && /仲間 2\/3/.test(r.afterMate.info), "仲間が倒れても、主人公が生きていれば戦闘は続く", r.afterMate);
  check(r.res === "lose" && r.heroDead && r.matesAlive > 0, "主人公が倒れたら敗北（仲間が生きていても）", r);
  check((await p.evaluate(() => document.getElementById("trialBody").textContent)).includes("主人公が倒れた"), "敗北の結果の画面に「主人公が倒れた」と出る");
  // 撤退
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2], { mode: "survival", hero: 2 });
    for (let i = 0; i < 100; i++) WD_DEBUG.step(0.1);
    document.getElementById("trialRetreat").click();
    return { on: T.on(), res: T.result().result, sheet: !document.getElementById("trialSheet").hidden };
  });
  check(!r.on && r.res === "retreat" && r.sheet, "撤退すると戦闘が終わり、結果の画面が出る", r);
  r = await p.evaluate(() => {
    // 三方の関（いままでの遊び方）も、配置から始まる
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3]);
    const s = T.state();
    T.retreat();
    return { mode: s.mode, phase: s.phase };
  });
  check(r.mode === "field" && r.phase === "deploy", "三方の関（いままでの遊び方）はそのまま（配置から始まる）", r);
  check((await storage(p)) === save0, "敗北・撤退でも保存データは変わらない（仮の戦死だけ）");
  await c.close();

  // 8. iPhone縦（375px・390px）：画面のタップと指のスティックだけで遊ぶ
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812 }));
    await p.evaluate(() => WD_DEBUG.trial.open("pick"));
    await p.locator('[data-trial-mode="survival"]').tap();
    for (const id of [1, 2, 3, 4, 5]) await p.locator('[data-trial-pick="' + id + '"]').tap();
    await p.locator('[data-trial-hero="4"]').tap(); // 銃将を主人公に
    await p.locator("[data-trial-go]").tap();
    await p.evaluate(() => {
      WD_DEBUG.heroApi.draw();
      document.getElementById("trialPad").scrollIntoView({ block: "center" });
    });
    const pad = await p.locator("#trialPad").boundingBox();
    const s0 = await p.evaluate(() => ({ y: scrollY, h: WD_DEBUG.trial.live().units[0] }));
    const x0 = await p.evaluate(() => WD_DEBUG.trial.live().units[0].x);
    await p.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await p.mouse.down();
    await p.mouse.move(pad.x + pad.width / 2 - 55, pad.y + pad.height / 2, { steps: 5 });
    await p.evaluate(() => WD_DEBUG.step(1));
    await p.mouse.up();
    r = await p.evaluate(() => {
      WD_DEBUG.heroApi.draw();
      return {
        x: WD_DEBUG.trial.live().units[0].x,
        hero: WD_DEBUG.trial.state().hero,
        y: scrollY,
        overflow: document.documentElement.scrollWidth - innerWidth,
        bar: Math.round(document.getElementById("trialBar").getBoundingClientRect().height),
        game: Math.round(document.getElementById("game").getBoundingClientRect().height),
      };
    });
    check(r.hero === 4 && x0 - r.x > 20 && r.overflow <= 0, "iPhone縦（" + width + "px）：主人公（銃将）を指のスティックで動かせて、はみ出さない", { x0, ...r });
    await p.setViewportSize({ width: 812, height: width });
    await p.setViewportSize({ width, height: 812 });
    r = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, pad: document.getElementById("trialPad").offsetParent !== null, retreat: document.getElementById("trialRetreat").offsetParent !== null }));
    check(r.overflow <= 0 && r.pad && r.retreat, "画面を回転して戻しても、スティックと撤退ボタンが使える（" + width + "px）", r);
    await c.close();
  }
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
