// 戦場試練 v108.6：効果音（Web Audio・間隔と同時の数の制限・音量とミュート・鳴らせない環境）とレベルアップの演出
//   node tools/test-trial-sfx.mjs
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
async function open({ width = 390, height = 844, query = "?debug", ougi = null, noAudio = false } = {}) {
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
  if (noAudio) await c.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
  const p = await c.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
const storage = (p) => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))));
const ougiSave = { version: 1, seq: 1, books: [{ uid: 1, k: "happouTenshou", from: "試験", job: "sword_saint", level: 300, at: 1 }], known: {}, rolls: {}, fails: {}, heir: { sid: 1, k: "happouTenshou", book: 1 }, run: null };
try {
  // 1. 画面に触れる前は音を出さない（iPhone の決まり）。触れると準備できる
  let { c, p } = await open({ ougi: ougiSave });
  const save0 = await storage(p);
  let r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    return T.sfx.stats();
  });
  check(!r.unlocked, "画面に触れる前は、音の準備をしない（iPhone Safari の決まり）", r);
  await p.locator("#trialSound").scrollIntoViewIfNeeded();
  await p.touchscreen.tap(10, 10);
  r = await p.evaluate(() => WD_DEBUG.trial.sfx.stats());
  check(r.unlocked && !r.failed, "画面に触れると、音の準備ができる（Web Audio）", r);
  // 2. 三方の関：刀・槍・弓（発射と命中）・鉄砲・回復・被弾の音
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    T.sfx.reset();
    for (let i = 0; i < 900 && T.on(); i++) WD_DEBUG.step(0.1);
    return T.sfx.stats();
  });
  check(["slash", "thrust", "bow", "hit", "gun", "heal", "hurt"].every((k) => r.played[k] > 0), "三方の関：刀・槍・弓（発射・命中）・鉄砲・回復・被弾の音が、攻撃に合わせて鳴る", r.played);
  check(r.skipped > 0, "5人の通常攻撃が重なっても、同じ音は間をあけて鳴らす（間引いた数 " + r.skipped + "）", r.skipped);
  // 3. 同じ音は間をあける・同時に鳴る音は8つまで
  r = await p.evaluate(() => {
    const S = WD_DEBUG.trial.sfx;
    S.reset();
    let n = 0;
    for (let i = 0; i < 50; i++) if (S.play("slash")) n++;
    const kinds = ["slash", "thrust", "bow", "gun", "heal", "hurt", "insight", "coin", "levelup", "roll", "card", "pick", "hit"];
    S.reset();
    let v = 0;
    for (const k of kinds) S.play(k), (v = Math.max(v, S.voices()));
    return { n, v };
  });
  check(r.n <= 1 && r.v <= 8, "同じ音を一度に50回鳴らしても1回だけ。いろいろな音を一度に鳴らしても同時は8つまで（" + r.v + "）", r);
  // 4. 音量：大・中・小・消音（押すたびに変わる）。消音のときは鳴らない（ゲームはそのまま）
  r = await p.evaluate(() => {
    const S = WD_DEBUG.trial.sfx,
      b = document.getElementById("trialSound"),
      labels = [];
    for (let i = 0; i < 4; i++) {
      b.click();
      labels.push(b.textContent);
    }
    S.level(3);
    S.reset();
    const muted = S.play("ougi");
    S.level(1);
    S.reset();
    return { labels, muted, label: b.textContent, key: localStorage.getItem("worldDefense.trialSfx.v1") };
  });
  check(r.labels.join() === "🔈 小,🔇 消音,🔊 大,🔉 中" && r.muted === false && r.label === "🔉 中", "音量のボタン：押すたびに 大→中→小→消音。消音のときは鳴らない", r);
  check(r.key === null, "本番の版では、音量の設定を保存しない（テスト版の保存の領域にだけ保存）", r.key);
  await c.close();

  // 5. サバイバル：経験値コイン（続けて拾うと音程が上がる）・閃き・レベルアップ・ドラムロール・決定・奥義・警告
  ({ c, p } = await open({ ougi: ougiSave }));
  await p.evaluate(() => {
    document.getElementById("trialSheet").hidden = true;
    WD_DEBUG.trial.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
  });
  await p.touchscreen.tap(10, 10);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    T.sfx.reset();
    let lv = 0;
    for (let i = 0; i < 1500 && T.on(); i++) {
      if (L.choice) {
        lv++;
        const k = L.choice.findIndex((x) => x.kind === "recruit");
        T.choose(k >= 0 ? k : 0);
      }
      WD_DEBUG.step(0.1);
    }
    return { played: T.sfx.stats().played, lv };
  });
  check(["coin", "levelup", "roll", "pick", "insight"].every((k) => r.played[k] > 0), "サバイバル：コインを拾う音・レベルアップ・ドラムロール・決定・閃きの音（レベルアップ " + r.lv + " 回）", r.played);
  // コインの音程：0.6秒の間に続けて拾うと上がる
  r = await p.evaluate(async () => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      steps = [];
    L.next = 1e9;
    for (let k = 0; k < 4; k++) {
      T.drop(h.x + 30, h.y);
      for (let i = 0; i < 4; i++) WD_DEBUG.step(0.05);
      if (L.choice) T.choose(0);
      await new Promise((r) => setTimeout(r, 90));
    }
    return T.sfx.stats().played.coin;
  });
  check(r >= 4, "コインを続けて拾うと、拾うたびに短い電子音（音程が上がる）", r);
  // 奥義の音
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.next = 0;
    for (let i = 0; i < 400 && !L.enemies.some((e) => !e.gone && Math.hypot(e.x - h.x, e.y - h.y) < 600); i++) {
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    T.sfx.reset();
    const err = T.useOugi();
    return { err, ougi: T.sfx.stats().played.ougi };
  });
  check(!r.err && r.ougi === 1, "奥義を使うと、強い発動音", r);
  // 警告：仲間の HP が3割を切ると1回だけ（下がったままでは鳴り続けない）。5割より回復して8秒たてば、また鳴る
  r = await p.evaluate(async () => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      m = L.units.find((u) => u.id !== L.hero && !u.dead);
    if (!m) return { none: true };
    T.sfx.reset();
    const warns = [];
    for (let i = 0; i < 80; i++) {
      if (m.hp > m.max * 0.25) m.hp = m.max * 0.25;
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
      warns.push(T.sfx.stats().played.warn || 0);
    }
    const low = Math.max(...warns),
      danger = m.danger;
    m.hp = m.max; // 回復
    await new Promise((r) => setTimeout(r, 1100)); // 同じ音の最短の間隔（本物の時間で1秒）
    for (let i = 0; i < 90; i++) {
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    for (let i = 0; i < 150 && (T.sfx.stats().played.warn || 0) < 2; i++) {
      if (m.hp > m.max * 0.25) m.hp = m.max * 0.25;
      // 敵を1体、仲間のすぐ横に置く（攻撃されるように）
      const e = L.enemies.find((x) => !x.gone);
      if (e && Math.hypot(e.x - m.x, e.y - m.y) > 40) (e.x = m.x + 30), (e.y = m.y), (e.target = m);
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    return { low, danger, again: T.sfx.stats().played.warn || 0, hit: m.hit };
  });
  check(r.low === 1 && r.danger, "仲間の HP が3割を切ると警告音が1回（下がったままでも鳴り続けない）", r);
  check(r.again === 2, "回復したあと、また3割を切ると、もう一度だけ鳴る", r);
  await c.close();

  // 6. レベルアップの演出：満タン → 音 → 選択画面 → カードが順に出る → ドラムロール → 押せる合図 → 決定音と光 → 再開
  ({ c, p } = await open());
  await p.evaluate(() => {
    document.getElementById("trialSheet").hidden = true;
    WD_DEBUG.trial.start([1, 2, 3], { mode: "survival", hero: 1 });
  });
  await p.touchscreen.tap(10, 10);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.next = 1e9;
    T.sfx.reset();
    for (let i = 0; i < 4; i++) T.drop(h.x + 30, h.y); // 4：Lv2 の分
    const seq = [];
    for (let i = 0; i < 30 && !L.choice; i++) {
      WD_DEBUG.step(0.05);
      seq.push(L.choice ? "選択" : L.slv > 1 ? "Lv2" : "-");
    }
    const box = document.getElementById("trialLevelUp"),
      card = box.querySelector(".trial-levelup-card"),
      btns = [...box.querySelectorAll("[data-trial-choose]")];
    return {
      seq: seq.join(","),
      played: T.sfx.stats().played,
      arming: card.classList.contains("arming"),
      disabled: btns.map((b) => b.disabled),
      delays: btns.map((b) => b.style.animationDelay),
      t: L.t,
    };
  });
  check(r.played.levelup === 1 && /Lv2.*選択/.test(r.seq), "Lv が上がると音が鳴り、ゲージの光を見せてから選択画面が出る（" + r.seq.replace(/,?-/g, "").slice(0, 40) + "）", r);
  check(r.arming && r.disabled.every(Boolean) && r.delays.join() === "0s,0.08s,0.16s" && r.played.roll === 1, "3枚のカードが0.08秒ずつ順に出て、ドラムロール風の音。出そろうまでは押せない（押し間違いを防ぐ）", r);
  await p.waitForTimeout(550);
  r = await p.evaluate(() => {
    const card = document.querySelector("#trialLevelUp .trial-levelup-card");
    return { ready: card.classList.contains("ready"), enabled: [...card.querySelectorAll("[data-trial-choose]")].every((b) => !b.disabled) };
  });
  check(r.ready && r.enabled, "出そろうと、カードが光って押せるようになる", r);
  await p.locator('[data-trial-choose="0"]').tap();
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      t0 = L.t;
    const kinds = WD_DEBUG.combat.fx().kinds;
    WD_DEBUG.step(0.5);
    return { pick: T.sfx.stats().played.pick, kinds, choice: L.choice, resumed: L.t > t0, units: L.units.length };
  });
  check(r.pick === 1 && r.kinds.includes("cshock") && r.choice === null && r.resumed && r.units === 2, "選ぶと決定音と光が出て、戦闘が再開する（仲間が加入）", r);
  // 3択はそのまま（ランダムに決めない）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.lvUps = 1;
    L.lvAt = null;
    WD_DEBUG.step(0.05);
    const n = L.choice && L.choice.length;
    WD_DEBUG.step(2);
    return { n, still: !!L.choice, lvUps: L.lvUps };
  });
  check(r.n === 3 && r.still && r.lvUps === 1, "3択はそのまま。選ぶまで何も決まらない（ドラムロールは演出だけ）", r);
  await c.close();

  // 7. 音を出せない環境（AudioContext がない）でも、ゲームはそのまま動く
  ({ c, p } = await open({ noAudio: true }));
  await p.evaluate(() => {
    document.getElementById("trialSheet").hidden = true;
    WD_DEBUG.trial.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
  });
  await p.touchscreen.tap(10, 10);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    for (let i = 0; i < 600 && T.on(); i++) {
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    return { stats: T.sfx.stats(), on: T.on(), kills: T.state() && T.state().kills };
  });
  check(r.stats.failed && !r.stats.unlocked && r.on && r.kills > 0, "音を出せない環境でも、ゲームはそのまま動く（エラーにならない）", r);
  await c.close();

  // 8. iPhone縦（375px・390px）：音量のボタンはスティック・奥義のボタンと重ならない。選択画面ははみ出さない。危険な兵士の札は赤く点滅
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812, ougi: ougiSave }));
    r = await p.evaluate(() => {
      document.getElementById("trialSheet").hidden = true;
      WD_DEBUG.trial.start([1, 2, 3], { mode: "survival", hero: 1 });
      WD_DEBUG.heroApi.draw();
      document.getElementById("trialPad").scrollIntoView({ block: "center" });
      const box = (id) => document.getElementById(id).getBoundingClientRect(),
        a = box("trialSound"),
        others = ["trialPad", "trialOugiBtn"].map(box),
        overlap = others.some((b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
      return { overlap, h: Math.round(a.height), right: Math.round(a.right), w: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check(!r.overlap && r.h >= 44 && r.right <= r.w && r.overflow <= 0, "iPhone縦（" + width + "px）：音量のボタンは、スティック・奥義のボタンと重ならない", r);
    r = await p.evaluate(async () => {
      const T = WD_DEBUG.trial,
        L = T.live();
      L.lvUps = 1;
      L.lvAt = null;
      WD_DEBUG.step(0.05);
      await new Promise((r) => setTimeout(r, 500));
      const k = document.querySelector("#trialLevelUp .trial-levelup-card").getBoundingClientRect();
      return { left: Math.round(k.left), right: Math.round(k.right), top: Math.round(k.top), bottom: Math.round(k.bottom), w: innerWidth, h: innerHeight };
    });
    check(r.left >= 8 && r.right <= r.w - 8 && r.top >= 0 && r.bottom <= r.h, "iPhone縦（" + width + "px）：レベルアップの選択画面がはみ出さない", r);
    await c.close();
  }
  ({ c, p } = await open());
  const save1 = await storage(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    const u = T.live().units[1];
    u.hp = u.max * 0.2;
    WD_DEBUG.heroApi.draw();
    return document.querySelector('#trialUnits [data-trial-ctl="' + u.id + '"]').classList.contains("danger");
  });
  check(r, "三方の関：HP が3割を切った兵士の札は赤く点滅し、足元に赤い輪（音を消していても危険が分かる）", r);
  await p.evaluate(() => document.getElementById("trialSound").click());
  check((await storage(p)) === save1, "保存データは変わらない（本番の版は音量も保存しない）");
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
