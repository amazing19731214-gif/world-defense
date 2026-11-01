// 戦場試練 v111：戦国ライバル武将（面の途中に乱入・倒すと珍しい報酬・10% で固有の技）
//   node tools/test-trial-rivals.mjs
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
// 主人公1人で始め、敵が来ないようにする（コインの動きだけを見る）
const quiet = (p, ids = [1, 2, 3, 4, 5]) =>
  p.evaluate((ids) => {
    const T = WD_DEBUG.trial;
    if (T.on()) T.retreat(); // 前の挑戦を終える（続けて試すとき）
    document.getElementById("trialSheet").hidden = true;
    T.start(ids, { mode: "survival", hero: 1 });
    const L = T.live();
    L.next = 1e9; // 敵を出さない
    L.units[0].x = 1000;
    L.units[0].y = 600;
    return L.units[0].id;
  }, ids);
// 第2面の面の時計を進めて、ライバル武将を乱入させる（主人公は倒れないように）
const toFloor2 = (p) =>
  p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.floor = 2;
    L.rivalChecked = false;
    return L.floor;
  });
try {
  let { c, p } = await open();
  const save0 = await storage(p);
  // 1. 3人のライバル武将：既存の武将と重ならない（山県昌景・馬場信春は出さない）
  let r = await p.evaluate(() => {
    const R = WD_DEBUG.trial.rivals,
      names = Object.values(R.list).map((x) => x.name),
      warlords = Object.values(WD_DEBUG.config.WARLORDS).map((w) => w.name);
    return { names, dup: names.filter((n) => warlords.some((w) => w && w.includes(n))), banned: names.filter((n) => /山県昌景|馬場信春/.test(n)), uniq: Object.keys(WD_DEBUG.trial.unique) };
  });
  check(r.names.join() === "真田昌幸,高橋紹運,加藤段蔵" && r.dup.length === 0 && r.banned.length === 0, "ライバル武将は3人（真田昌幸・高橋紹運・加藤段蔵）。既存の武将と重ならず、山県昌景・馬場信春は出さない", r);
  check(r.uniq.join() === "rokuren,fukutsu,tobikato", "固有の技は3つ（六連の計・不屈の陣・飛び加藤）", r.uniq);
  // 2. 乱入の時刻：第1面は出ない。第2面から、面の時計 75秒で1回だけ決める（確率 60%）
  await quiet(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      R = T.rivals,
      h = L.units[0],
      c0 = R.chance;
    R.chance = 1; // 必ず出る
    L.st = 70;
    for (let i = 0; i < 80; i++) (h.hp = h.max), WD_DEBUG.step(0.1);
    const f1 = { checked: !!L.rivalChecked, rival: T.state().rival };
    L.floor = 2;
    L.st = 70;
    L.rivalChecked = false;
    let at = null;
    for (let i = 0; i < 80 && !at; i++) {
      h.hp = h.max;
      WD_DEBUG.step(0.1);
      if (T.state().rival) at = Math.round(L.st);
    }
    R.chance = c0;
    return { f1, at, rival: T.state().rival, met: T.state().rivalsMet, banner: !!document.body };
  });
  check(!r.f1.checked && !r.f1.rival, "第1面ではライバル武将は出ない", r.f1);
  check(r.at >= 75 && r.at <= 77 && r.rival && r.met === 1, "第2面の面の時計 75秒で「" + (r.rival && r.rival.name) + "」が乱入する（1回だけ）", r);
  // 3. 出る確率：第2面を40回ためすと、だいたい6割（戦闘の乱数）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    let n = 0;
    for (let k = 0; k < 40; k++) {
      L.rival && (L.rival.gone = true);
      L.rival = null;
      L.rivalChecked = false;
      L.st = 74.95;
      const m0 = L.rivalsMet || 0;
      WD_DEBUG.step(0.05);
      WD_DEBUG.step(0.05);
      if ((L.rivalsMet || 0) > m0) n++;
    }
    return n;
  });
  check(r >= 14 && r <= 34, "乱入の確率は約60%（40回のうち " + r + " 回）", r);
  await c.close();

  // 4. それぞれの動き：真田昌幸は伏兵（主人公のまわり四方に4体）、高橋紹運は守りの構え（受けるダメージ 30%）、加藤段蔵は主人公の背後へ瞬間移動
  ({ c, p } = await open());
  await quiet(p);
  await toFloor2(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      out = {};
    const clear = () => {
      for (const e of L.enemies) e.gone = true;
      L.rival = null;
    };
    // 真田昌幸
    clear();
    T.rivalSpawn("masayuki");
    let e = L.rival;
    e.skillT = 0.05;
    const n0 = L.enemies.filter((x) => !x.gone && !x.rival).length;
    WD_DEBUG.step(0.1);
    const near = L.enemies.filter((x) => !x.gone && !x.rival && Math.hypot(x.x - h.x, x.y - h.y) < 300).length;
    out.masayuki = { added: L.enemies.filter((x) => !x.gone && !x.rival).length - n0, near };
    // 高橋紹運：構えの間に与えるダメージ
    clear();
    T.rivalSpawn("jouun");
    e = L.rival;
    Object.assign(e, { cd: 99, hp: 1e9, max: 1e9 });
    const hit = () => {
      const a = e.hp;
      h.dealt = h.dealt || 0;
      WD_DEBUG.trial.hitEnemy ? WD_DEBUG.trial.hitEnemy(e, 1000) : null;
      return a - e.hp;
    };
    e.guardUntil = 0;
    const plain = hit();
    e.guardUntil = L.t + 5;
    const guarded = hit();
    out.jouun = { plain: Math.round(plain), guarded: Math.round(guarded) };
    // 加藤段蔵：遠くから主人公の背後へ
    clear();
    T.rivalSpawn("danzo");
    e = L.rival;
    Object.assign(e, { x: h.x + 600, y: h.y, px: h.x + 600, py: h.y });
    const d0 = Math.round(Math.hypot(e.x - h.x, e.y - h.y));
    e.skillT = 0.05;
    WD_DEBUG.step(0.1);
    out.danzo = { d0, d1: Math.round(Math.hypot(e.x - h.x, e.y - h.y)) };
    return out;
  });
  check(r.masayuki.added >= 3 && r.masayuki.near >= 3, "真田昌幸：伏兵が主人公のまわり四方に出る（" + r.masayuki.added + "体）", r.masayuki);
  if (r.jouun.plain) check(r.jouun.guarded > 0 && r.jouun.guarded < r.jouun.plain * 0.4, "高橋紹運：守りの構えの間は、受けるダメージが約3割（" + r.jouun.plain + " → " + r.jouun.guarded + "）", r.jouun);
  check(r.danzo.d0 >= 500 && r.danzo.d1 < 120, "加藤段蔵：遠く（" + r.danzo.d0 + "）から主人公の背後（" + r.danzo.d1 + "）へ瞬間移動", r.danzo);
  // 5. 倒す：珍しい報酬が入る。固有の技は 10%（ここでは確率を 1 と 0 にして見る）。この挑戦の間だけ
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      R = T.rivals,
      l0 = R.learn,
      out = [];
    for (const [key, learn] of [["masayuki", 1], ["jouun", 0], ["danzo", 1]]) {
      for (const e of L.enemies) e.gone = true;
      L.rival = null;
      R.learn = learn;
      T.rivalSpawn(key);
      const e = L.rival,
        rw0 = L.rewards.length;
      Object.assign(e, { x: h.x + 60, y: h.y, hp: 1, cd: 99 });
      for (let i = 0; i < 40 && !e.gone; i++) WD_DEBUG.step(0.05);
      out.push({ key, gone: e.gone, rival: !!L.rival, reward: L.rewards.length > rw0 ? L.rewards[L.rewards.length - 1].special : null, skills: Object.keys(L.skills) });
    }
    R.learn = l0;
    return { out, down: T.state().rivalsDown, kinds: Object.keys(L.skills).length, learn: R.learn };
  });
  check(r.out.every((x) => x.gone && !x.rival && x.reward === true), "ライバル武将を倒すと、珍しい報酬（雷神の勾玉・不死鳥の羽・奥義の秘伝書など）が1つ入る", r.out);
  check(r.out[0].skills.includes("rokuren") && !r.out[1].skills.includes("fukutsu") && r.out[2].skills.includes("tobikato") && r.down.length === 3 && r.learn === 0.1, "倒したとき 10% で固有の技（六連の計・飛び加藤）を覚える（この挑戦の間だけ）", r.down);
  // 6. 固有の技が動く。攻撃スキルの6枠を使わず、レベルアップの候補にも出ない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.skills = { thunder: 1, fireRing: 1, shuriken: 1, vacuum: 1, spear: 1, musket: 1, rokuren: 1, fukutsu: 1, tobikato: 1 };
    L.skillCd = { rokuren: 0, fukutsu: 0, tobikato: 0 };
    L.skillUse = {};
    const o = T.skillOptions(),
      opts = o.up.concat(o.learn).map((x) => x.key);
    L.next = 0;
    let guard = 0;
    for (let i = 0; i < 120; i++) {
      h.hp = Math.max(h.hp, h.max * 0.6);
      L.next = Math.min(L.next, 0.3);
      if (L.choice) T.choose(0);
      const tank = L.enemies.find((e) => !e.gone && e.tank) || L.enemies.find((e) => !e.gone && !e.rival);
      if (tank) Object.assign(tank, { tank: true, x: h.x + 120, y: h.y, hp: 1e9, max: 1e9, cd: 99 });
      WD_DEBUG.step(0.05);
      if (h.guardUntil > L.t) guard++;
    }
    return { use: { ...L.skillUse }, opts, guard };
  });
  check(r.use.rokuren > 0 && r.use.fukutsu > 0 && r.use.tobikato > 0 && r.guard > 0, "固有の技（六連の計・不屈の陣・飛び加藤）が動く。不屈の陣の間は主人公の受けるダメージが半分", r);
  check(!r.opts.some((k) => ["rokuren", "fukutsu", "tobikato"].includes(k)) && r.opts.includes("magnet"), "固有の技は攻撃スキルの枠を使わず、レベルアップの候補にも出ない", r.opts);
  // 7. 倒せないまま 70秒で退く。次の面ではまた乱入があるかもしれない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    for (const e of L.enemies) e.gone = true;
    L.rival = null;
    T.rivalSpawn("jouun");
    const e = L.rival;
    Object.assign(e, { hp: 1e12, max: 1e12, cd: 99, x: h.x + 500, y: h.y });
    L.skills = {};
    e.leaveAt = L.st + 1;
    for (let i = 0; i < 20; i++) (h.hp = h.max), WD_DEBUG.step(0.1);
    return { gone: e.gone, rival: T.state().rival, stay: T.rivals.stay };
  });
  check(r.gone && !r.rival && r.stay === 70, "倒せないまま70秒たつと、ライバル武将は退く", r);
  // 8. 画面：大将とライバル武将の HP の棒（2段）・名前・結果の画面
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.st = 151; // 大将が出る時刻のあと（ライバル武将の退く時刻は、乱入した時刻から70秒）
    T.rivalSpawn("masayuki");
    for (let i = 0; i < 5; i++) WD_DEBUG.step(0.1);
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
    const bars = texts.filter((t) => /  \d+\/\d+$/.test(t)); // HP の棒の文字（「名前  残り/最大」）
    L.skills = { ...L.skills, rokuren: 1 }; // 前の試験（退く）で空にしたので、覚えた固有の技を戻す
    T.retreat();
    return { bars, boss: !!L.boss, result: document.getElementById("trialBody").textContent };
  });
  check(r.bars.length === 2 && r.bars.some((t) => /真田昌幸/.test(t)), "大将とライバル武将が同時にいると、HP の棒が2段（" + r.bars.join(" ｜ ") + "）", r.bars);
  check(/討ち取ったライバル武将：真田昌幸（第2面・✨六連の計）/.test(r.result) && /六連の計（固有）/.test(r.result), "結果の画面に、討ち取ったライバル武将と固有の技が出る", r.result.slice(0, 200));
  check((await storage(p)) === save0, "ライバル武将・固有の技は保存データに入らない（本番の兵士・武将・奥義は変わらない）");
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
