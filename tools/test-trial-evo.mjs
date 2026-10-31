// 戦場試練の戦闘進化（v107.1試作）：職業技・閃き・敵の強さ（戦力）・敵の行動・演出の上限・結果の画面・画面の改善
//   node tools/test-trial-evo.mjs
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
// 編成：[兵種, 職業, 熟練度, 装備, 閃き]
const COMPS = {
  low: { lv: 5, units: [["ashigaru"], ["spearman"], ["archer"], ["gunner"], ["medic"]] },
  mid: {
    lv: 60,
    units: [
      ["ashigaru", "samurai", { samurai: P, ashigaru: P }, "tachi"],
      ["spearman", "sohei", { sohei: P, spearman: P, medic: P }, "nagayari"],
      ["archer", "archer", { archer: P }, "shigeto"],
      ["gunner", "gunner", { gunner: P }, "sakaizutsu"],
      ["medic", "medic", { medic: P }, "haramaki"],
    ],
  },
  midBare: { lv: 60, units: [["ashigaru"], ["spearman"], ["archer"], ["gunner"], ["medic"]] },
  high: {
    lv: 300,
    units: [
      ["ashigaru", "sword_saint", { sword_saint: P, samurai: P, kensei: P }, "osafune", "in_sword_saint"],
      ["spearman", "spear_commander", { spear_commander: P, spearman: P }, "nagayari", "in_spear_commander"],
      ["archer", "bow_saint", { bow_saint: P, archer: P }, "raijodo", "in_bow_saint"],
      ["gunner", "gun_commander", { gun_commander: P, gunner: P }, "sakaizutsu", "in_gun_commander"],
      ["medic", "healing_master", { healing_master: P, medic: P }, "tosei", "in_healing_master"],
    ],
  },
  // 剣聖だけど閃き（一刀・水鏡）を覚えていない
  noInsight: { lv: 300, units: [["ashigaru", "sword_saint", { sword_saint: P, samurai: P, kensei: P }, "osafune"], ["archer"], ["medic"]] },
};
async function open(comp, { width = 375, height = 667, query = "?debug" } = {}) {
  const C = COMPS[comp],
    items = [];
  const soldiers = C.units.map(([type, job, prof, gear, ins], i) => {
    if (gear) items.push({ uid: i + 1, id: gear, owner: i + 1, lock: true });
    return { id: i + 1, type, squadId: 1, level: C.lv, name: "兵" + (i + 1), ...(job ? { job, jobs: [type, job], prof } : {}), ...(ins ? { insight: { known: [ins], equipped: [ins] } } : {}) };
  });
  const save = { version: 1, seq: 9, squadSeq: 1, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }], soldiers };
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
  return { c, p, ids: soldiers.map((s) => s.id) };
}
// 戦闘を最後まで（1秒ずつ）。途中の様子も集める
const fight = (p, ids) =>
  p.evaluate((ids) => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start(ids);
    const power = T.power();
    T.auto();
    T.begin();
    const seen = { fx: 0, shots: 0, cover: [], stuckMax: 0, still: 0 };
    const last = new Map();
    for (let i = 0; i < 400 && T.on(); i++) {
      WD_DEBUG.step(1);
      const s = T.state();
      if (!s) break;
      seen.fx = Math.max(seen.fx, s.fx);
      seen.shots = Math.max(seen.shots, s.shots);
      for (const e of s.enemies) {
        if (e.gone) continue;
        seen.stuckMax = Math.max(seen.stuckMax, e.unstuck);
        // 狙う兵士がいないのに5秒以上同じ所にいる敵（止まってしまった）
        const p0 = last.get(e.id);
        if (!e.target && p0 && Math.hypot(e.x - p0.x, e.y - p0.y) < 1) p0.n++;
        else last.set(e.id, { x: e.x, y: e.y, n: 0 });
        if (p0 && p0.n >= 5) seen.still++;
      }
      const L = T.live();
      for (const e of L.enemies)
        if (!e.gone && e.leader && !e.leader.gone && e.target) seen.cover.push(Math.hypot(e.x - e.target.x, e.y - e.target.y) - Math.hypot(e.leader.x - e.target.x, e.leader.y - e.target.y));
    }
    return { res: T.result(), power, seen };
  }, ids);
try {
  // 1. 敵の強さ：Lv と実際の能力（職業・装備）から。低・中・高Lv で戦闘が成り立つ
  const out = {};
  for (const k of ["low", "mid", "midBare", "high"]) {
    const { c, p, ids } = await open(k);
    out[k] = await fight(p, ids);
    await c.close();
  }
  const sum = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { res: v.res.result, lv: v.res.level, ratio: Math.round(v.power.ratio * 100) / 100, alive: v.res.units.filter((u) => !u.dead).length, t: Math.round(v.res.time) }]));
  console.log("  編成ごとの結果", JSON.stringify(sum));
  check(Object.values(out).every((v) => v.res.result !== "timeout"), "低・中・高Lv のどの編成でも、戦闘が時間切れにならずに終わる", sum);
  check(out.low.res.result === "win", "育て始め（Lv5・基本職・装備なし）の5人でも勝てる", sum.low);
  check(out.mid.res.result === "win" && out.high.res.result === "win", "中Lv（上級職・装備）・高Lv（最上級職・装備・閃き）の5人は勝てる", sum);
  check(out.mid.power.ratio > out.midBare.power.ratio && out.mid.res.level > out.midBare.res.level && out.mid.res.level < out.midBare.res.level * 1.15, "職業・装備で強い兵士は敵も少し強くなる（上限つき・強くなった分の大半は兵士の有利）", { mid: sum.mid, bare: sum.midBare });
  check(out.mid.res.units.filter((u) => !u.dead).length > out.midBare.res.units.filter((u) => !u.dead).length, "同じLv なら、職業・装備を育てた編成のほうが生き残る（育成が勝敗に効く）", sum);
  check(out.high.res.level < 300 * 0.7, "高Lv の敵Lv は伸びをゆるめる（際限なく強くならない）", sum.high);
  // 2. 職業技・閃き：既存の条件と待ち時間で発動する。覚えていない閃きは出ない。無限に出ない
  const hi = out.high.res.units,
    mid = out.mid.res.units,
    time = out.high.res.time;
  check(hi.every((u) => Object.keys(u.skills).length > 0) && mid.every((u) => Object.keys(u.skills).length > 0), "近接・弓・鉄砲・衛生兵、どの職業も職業技を使う", { hi: hi.map((u) => u.skills), mid: mid.map((u) => u.skills) });
  check(hi.find((u) => u.job.includes("剣聖")).skills["一刀・水鏡"] > 0 && hi.find((u) => u.job.includes("弓聖")).skills["星標の射"] > 0, "覚えて装備している閃き（一刀・水鏡・星標の射）は発動する", hi.map((u) => u.skills));
  check(mid.find((u) => u.job.includes("弓兵")).skills["分かれ矢"] > 0 && mid.find((u) => u.job.includes("衛生兵")).skills["救急包帯"] > 0, "弓兵系は射程の技（分かれ矢）、衛生兵は回復の技（救急包帯）", mid.map((u) => [u.job, u.skills]));
  const perUnit = hi.map((u) => Object.values(u.skills).reduce((a, b) => a + b, 0));
  check(perUnit.every((k) => k <= time / 3 + 1), "技は共通の待ち（3秒）より多くは出ない（無限・二重に発動しない）", { perUnit, time });
  {
    const { c, p, ids } = await open("noInsight");
    const r = await fight(p, ids);
    const saint = r.res.units.find((u) => u.job.includes("剣聖"));
    check(!saint.skills["一刀・水鏡"] && saint.skills["円月断ち"] > 0, "覚えていない閃きは発動しない（職業技は使う）", saint.skills);
    await c.close();
  }
  // 3. 敵の行動：止まらない・ループしない。鉄砲足軽は盾兵の後ろ
  const seen = out.high.seen;
  check(seen.still === 0, "狙う兵士がいない敵が5秒以上止まり続けない", seen);
  check(seen.cover.length > 0 && seen.cover.filter((d) => d > 0).length / seen.cover.length > 0.6, "鉄砲足軽は盾兵の後ろ（狙う兵士から見て盾兵より遠く）にいる", { n: seen.cover.length });
  // 4. 演出の数は上限まで
  check(Object.values(out).every((v) => v.seen.fx <= 80 && v.seen.shots <= 160 && v.res.fxMax <= 80), "演出の数は上限まで（effects 80・shots 160）", Object.values(out).map((v) => [v.seen.fx, v.seen.shots]));

  // 5. 結果の画面：兵士ごとの名前・職業・撃破・与えたダメージ・回復・技・生存／仮の戦死、活躍した兵士に 🏅
  {
    const { c, p, ids } = await open("high");
    const before = await p.evaluate(() => ({ s: Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])), r: JSON.stringify(WD_DEBUG.state().soldiers.map((s) => [s.id, s.alive, s.hp, s.level, s.xp, s.kills, s.battles, s.job, s.prof, s.evolution, s.evolutionShield, s.insight, s.chronicle, s.skills, s.learned])) }));
    await fight(p, ids);
    let r = await p.evaluate(() => {
      const body = document.getElementById("trialBody");
      return {
        rows: [...body.querySelectorAll(".trial-unit")].map((x) => x.textContent),
        mvp: body.querySelectorAll(".trial-unit.mvp").length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    check(r.rows.length === 5 && r.rows.every((t) => /撃破 \d+/.test(t) && t.includes("与ダメージ") && t.includes("技：") && (t.includes("生存") || t.includes("戦死"))), "結果に兵士ごとの職業・撃破・与えたダメージ・技・生存（仮の戦死）", r.rows);
    check(r.rows.some((t) => t.includes("回復")) && r.mvp === 1 && r.rows.some((t) => t.includes("🏅 活躍")), "回復量と、いちばん活躍した兵士の 🏅", { mvp: r.mvp });
    check(r.overflow <= 0, "iPhone縦（375px）で結果の画面がはみ出さない", r.overflow);
    // 6. 本番の兵士・保存データは変わらない（技を使っても：写しに書く・経験値なし）
    r = await p.evaluate(() => ({ s: Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])), r: JSON.stringify(WD_DEBUG.state().soldiers.map((s) => [s.id, s.alive, s.hp, s.level, s.xp, s.kills, s.battles, s.job, s.prof, s.evolution, s.evolutionShield, s.insight, s.chronicle, s.skills, s.learned])), pending: WD_DEBUG.state().soldiers.some((s) => Object.prototype.hasOwnProperty.call(s, "trialShadow")) }));
    check(r.r === before.r && JSON.stringify(r.s) === JSON.stringify(before.s) && !r.pending, "職業技・閃きを使っても、本番の兵士（経験・技の待ち・HP）と保存データは変わらない");
    await c.close();
  }

  // 7. 画面：城HP・ゴールド・ウェーブの表示を隠し、ステージ・味方・敵・時間を出す。兵士のタップで操作（v108）
  for (const width of [375, 390]) {
    const { c, p, ids } = await open("mid", { width, height: 844 });
    let r = await p.evaluate((ids) => {
      const T = WD_DEBUG.trial,
        shown = (id) => !!document.getElementById(id) && getComputedStyle(document.getElementById(id)).display !== "none" && document.getElementById(id).offsetParent !== null;
      const before = { hp: shown("hp"), gold: shown("gold"), wave: shown("wave") };
      document.getElementById("trialSheet").hidden = true;
      T.start(ids);
      T.auto();
      T.begin();
      WD_DEBUG.step(8);
      WD_DEBUG.heroApi.draw();
      return {
        before,
        during: { hp: shown("hp"), gold: shown("gold"), wave: shown("wave") },
        info: document.getElementById("trialInfo").textContent,
        retreat: shown("trialRetreat"),
        buttons: [...document.querySelectorAll("#trialBar button")].filter((b) => b.offsetParent !== null).length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    }, ids);
    check(r.before.hp && !r.during.hp && !r.during.gold && !r.during.wave, "戦場試練の間は城HP・ゴールド・ウェーブの表示を隠す（" + width + "px）", r);
    check(r.info.includes("三方の関") && /味方 \d\/5/.test(r.info) && /敵 \d+/.test(r.info) && /\d+秒/.test(r.info) && r.retreat && r.buttons <= 7, "ステージ名・生存兵士数・残り敵数・経過時間と、撤退ボタンだけ（" + width + "px）", r.info);
    check(r.overflow <= 0, "iPhone縦（" + width + "px）で戦闘中の画面がはみ出さない", r.overflow);
    r = await p.evaluate(() => {
      const T = WD_DEBUG.trial,
        u = T.live().units.find((x) => !x.dead);
      T.snap();
      const q = T.toScreen(u.x, u.y - 20);
      T.tap(q.x, q.y); // 戦場の兵士をタップ → その兵士を操作
      const a = { control: T.state().control, info: document.getElementById("trialInfo").textContent };
      WD_DEBUG.step(2);
      WD_DEBUG.heroApi.draw();
      T.snap();
      const v = T.view(),
        uu = T.live().units.find((x) => x.id === a.control);
      const inView = uu.x >= v.ox && uu.x <= v.ox + 960 / v.z && uu.y >= v.oy && uu.y <= v.oy + 600 / v.z;
      T.control(null);
      return { a, inView, back: T.state().control, z: T.view().z, id: u.id };
    });
    check(r.a.control === r.id && r.inView && r.back === null && r.a.info.includes("操作中"), "戦場の兵士をタップすると、その兵士を操作してカメラが追う（全員自動で戻る）", r);
    await c.close();
  }

  // 8. 伝説の奥義は使えないまま（ボタンも出ない）
  {
    const { c, p, ids } = await open("high", { query: "?debug&proto=combat" });
    const r = await p.evaluate((ids) => {
      const T = WD_DEBUG.trial;
      T.start(ids);
      T.auto();
      T.begin();
      WD_DEBUG.step(10);
      return { btn: document.getElementById("ougiBtn").hidden, err: WD_DEBUG.combat.ougi.error(), stats: WD_DEBUG.combat.stats().ougi };
    }, ids);
    check(r.btn && r.err.includes("試作") && r.stats === 0, "戦場試練では伝説の奥義を使えない（ボタンも出ない）", r);
    await c.close();
  }
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
