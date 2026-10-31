// 戦場試練 v108.3：サバイバルの伝説の奥義（右下のボタン）・職業技と閃きの演出・レベルアップの回数
//   node tools/test-trial-ougi.mjs
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
// 剣聖（兵1）が奥義継承者。奥義書3冊（八方天翔斬・無明一閃・天剣乱舞）。k は継承する奥義
const ougiSave = (k) => {
  const books = ["happouTenshou", "mumyouIssen", "tenkenRanbu"].map((x, i) => ({ uid: i + 1, k: x, from: "試験", job: "sword_saint", level: 300, at: 1 }));
  return { version: 1, seq: 3, books, known: {}, rolls: {}, fails: {}, heir: { sid: 1, k, book: books.findIndex((b) => b.k === k) + 1 }, run: null };
};
// 主人公（兵1）の近くに敵を集める（奥義の対象を作る）
const gather = (p, n = 6, boss = false) =>
  p.evaluate(
    ([n, boss]) => {
      const T = WD_DEBUG.trial,
        L = T.live(),
        h = L.units[0];
      for (let i = 0; i < 1500 && L.enemies.filter((e) => !e.gone).length < n; i++) {
        if (L.choice) T.choose(0);
        WD_DEBUG.step(0.1);
      }
      if (boss && !L.boss) {
        L.t = Math.max(L.t, 149.95);
        for (let i = 0; i < 30 && !L.boss; i++) {
          if (L.choice) T.choose(0);
          WD_DEBUG.step(0.1);
        }
      }
      const es = L.enemies.filter((e) => !e.gone);
      es.forEach((e, i) => {
        const a = (i / es.length) * Math.PI * 2;
        e.x = h.x + Math.cos(a) * (60 + (i % 3) * 30);
        e.y = h.y + Math.sin(a) * (60 + (i % 3) * 30);
      });
      if (L.choice) T.choose(0);
      return es.length;
    },
    [n, boss],
  );
try {
  // 1. 主人公が奥義継承者でない：右下のボタンは「未習得」で押せない
  let { c, p } = await open();
  const save0 = await storage(p);
  let r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    WD_DEBUG.heroApi.draw();
    const b = document.getElementById("trialOugiBtn");
    return { box: !document.getElementById("trialAction").hidden, text: b && b.textContent, disabled: b && b.disabled, err: T.useOugi(), info: T.ougi(), used: T.state().ougiUsed };
  });
  check(r.box && r.disabled && /未習得/.test(r.text) && /習得していません/.test(r.text) && r.err && !r.used, "主人公が奥義を習得していない（奥義継承者でない）ときは「未習得」と出て押せない", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    T.retreat();
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2], { mode: "field" });
    const a = document.getElementById("trialAction").hidden;
    T.retreat();
    return a;
  });
  check(r, "三方の関では奥義のボタンを出さない（いままでどおり）", r);
  await c.close();

  // 2. 八方天翔斬：主人公（剣聖）が奥義継承者。対象がいなければ回数を減らさない。使うと周りの敵へ8方向の斬撃波
  ({ c, p } = await open({ ougi: ougiSave("happouTenshou") }));
  const saveO = await storage(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    WD_DEBUG.heroApi.draw();
    const b = document.getElementById("trialOugiBtn");
    return { text: b.textContent, disabled: b.disabled, ready: b.classList.contains("ready"), err: T.useOugi(), used: T.state().ougiUsed };
  });
  check(!r.disabled && r.ready && /八方天翔斬/.test(r.text), "主人公が奥義継承者なら、右下に「⚔️ 奥義 八方天翔斬」のボタンが光る", r.text);
  check(/範囲内に敵がいません/.test(r.err) && !r.used, "敵がいないときに押しても、使った回数にならない", r.err);
  const gathered = await gather(p, 6);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      hp0 = L.enemies.filter((e) => !e.gone).reduce((a, e) => a + e.hp, 0),
      k0 = L.kills;
    document.getElementById("trialOugiBtn").click();
    const s = T.state(),
      kinds = WD_DEBUG.combat.fx().kinds;
    WD_DEBUG.heroApi.draw();
    const b = document.getElementById("trialOugiBtn");
    return { used: s.ougiUsed, kills: L.kills - k0, banner: WD_DEBUG.combat.fx().banner, kinds: [...new Set(kinds)], again: T.useOugi(), text: b.textContent, disabled: b.disabled };
  });
  check(r.used && r.used.key === "happouTenshou" && r.used.hits >= 3, "八方天翔斬：周りの敵（" + gathered + "体）に当たる（" + r.used.hits + "体に命中・" + r.kills + "体撃破）", r.used);
  check(r.banner && /奥義・八方天翔斬/.test(r.banner.name) && r.kinds.includes("cwave") && r.kinds.includes("cshock"), "奥義名の表示と、斬撃波・衝撃の演出が出る", { banner: r.banner && r.banner.name, kinds: r.kinds });
  check(/もう使いました/.test(r.again) && r.disabled && /もう使いました/.test(r.text), "1回の戦闘で1回だけ（2回目は押せない・連打しても重ならない）", r.again);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      out = [];
    if (!L.lvUps) L.lvUps = 1; // 奥義で倒した分のレベルアップ
    for (let i = 0; i < 20; i++) {
      WD_DEBUG.step(0.1);
      out.push([Math.round((L.t - L.ougiUsed.at) * 10) / 10, !!L.choice]);
    }
    const first = out.find((x) => x[1]);
    if (L.choice) T.choose(0);
    return { first };
  });
  check(r.first && r.first[0] >= 1.5, "奥義の直後は、演出を見せてからレベルアップの選択画面を出す（" + (r.first && r.first[0]) + "秒後）", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      t0 = L.t,
      d0 = L.units.filter((u) => u.id !== 1).reduce((a, u) => a + u.dealt + u.healed, 0);
    for (let i = 0; i < 100; i++) {
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    return { t: L.t - t0, mates: L.units.length - 1, d: L.units.filter((u) => u.id !== 1).reduce((a, u) => a + u.dealt + u.healed, 0) - d0, on: T.on() };
  });
  check(r.on && r.t > 9 && (r.mates === 0 || r.d > 0), "奥義のあとも戦闘は止まらず、仲間も戦い続ける", r);
  check((await storage(p)) === saveO, "奥義を使っても、本編の奥義の使用記録・奥義書・継承者は変わらない（保存データが同じ）");
  await c.close();

  // 3. 無明一閃：大将を優先して狙う
  ({ c, p } = await open({ ougi: ougiSave("mumyouIssen") }));
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    return document.getElementById("trialOugiBtn") ? 1 : 0;
  });
  await gather(p, 4, true);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      B = L.boss,
      hp0 = B.hp;
    const err = T.useOugi();
    return { err, boss: Math.round(hp0 - B.hp), max: Math.round(B.max), used: T.state().ougiUsed, kinds: [...new Set(WD_DEBUG.combat.fx().kinds)] };
  });
  check(!r.err && r.boss > 0 && r.used.hits === 1 && r.kinds.includes("cline"), "無明一閃：大将を優先して一閃（大将に " + r.boss + "/" + r.max + " のダメージ・画面を横切る斬撃の線）", r);
  await c.close();

  // 4. 天剣乱舞：時間をずらして6回の連続斬撃（戦闘は止めない）
  ({ c, p } = await open({ ougi: ougiSave("tenkenRanbu") }));
  await p.evaluate(() => {
    document.getElementById("trialSheet").hidden = true;
    WD_DEBUG.trial.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
  });
  await gather(p, 6);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      t0 = L.t;
    const err = T.useOugi(),
      a = T.state().flurry;
    const seq = [];
    for (let i = 0; i < 20; i++) {
      if (L.choice) T.choose(0); // レベルアップの選択中は連続斬撃も止まる。選んで続ける
      WD_DEBUG.step(0.1);
      seq.push(T.state() ? T.state().flurry : "end");
    }
    return { err, a, seq: seq.join(","), hits: T.state().ougiUsed.hits, t: L.t - t0 };
  });
  check(!r.err && r.a === 6 && /0|null/.test(r.seq) && r.hits >= 6 && r.t > 1.9, "天剣乱舞：0.2秒ごとに6回の連続斬撃（" + r.hits + "回命中）。その間も戦闘は進む", r);
  await c.close();

  // 5. 職業技・閃きの演出：斬撃の軌跡・矢と弾の光・閃光・回復の光・範囲の輪。技名は同じ兵士で2.5秒に1回まで
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live(),
      kinds = new Set(),
      glow = new Set(),
      names = [];
    let maxFx = 0,
      lv = 0;
    for (let i = 0; i < 2400 && T.on(); i++) {
      if (L.choice) {
        lv++;
        const k = L.choice.findIndex((x) => x.kind === "recruit");
        T.choose(k >= 0 ? k : 0);
      }
      WD_DEBUG.step(0.1);
      const s = T.state();
      if (!s) break;
      for (const k of WD_DEBUG.combat.fx().kinds) kinds.add(k);
      maxFx = Math.max(maxFx, s.fx);
      const live = T.live();
      if (live)
        for (const u of live.units) if (u.nameUntil && !names.some((x) => x[0] === u.id && x[1] === u.nameUntil)) names.push([u.id, u.nameUntil]);
    }
    const res = T.result();
    // 同じ兵士の技名の間隔
    const gaps = [];
    for (const id of new Set(names.map((x) => x[0]))) {
      const t = names.filter((x) => x[0] === id).map((x) => x[1]);
      for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
    }
    return { kinds: [...kinds], maxFx, minGap: gaps.length ? Math.min(...gaps) : null, lv, result: res.result, slv: res.slv, time: Math.round(res.time), units: res.units.length, skills: res.units.map((u) => Object.keys(u.skills).length) };
  });
  check(["cslash", "cspark", "cshock"].every((k) => r.kinds.includes(k)), "職業技・閃きが出ると、斬撃の軌跡・命中の火花・範囲の輪が出る", r.kinds);
  check(r.maxFx <= 80 && (r.minGap == null || r.minGap >= 2.49), "演出の数には上限（最大 " + r.maxFx + "）。技名は同じ兵士で2.5秒に1回まで（文字だらけにならない）", { maxFx: r.maxFx, minGap: r.minGap });
  check(r.lv >= 5 && r.lv <= 7 && r.units === 5, "3分の戦闘でレベルアップは " + r.lv + " 回（5〜7回）。仲間は4人とも加入できる", r);
  check(r.result === "win" && r.skills.filter((n) => n > 0).length >= 4, "5人で戦い、大将を倒して勝利（" + r.time + "秒・サバイバルLv" + r.slv + "）。仲間も職業技・閃きを使う", r);
  check((await storage(p)) === save0, "保存データは変わらない");
  await c.close();

  // 6. iPhone縦（375px・390px）：スティックと奥義のボタンが重ならず、指で押せる
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812, ougi: ougiSave("happouTenshou") }));
    await p.evaluate(() => {
      document.getElementById("trialSheet").hidden = true;
      WD_DEBUG.trial.start([1, 2, 3], { mode: "survival", hero: 1 });
      WD_DEBUG.heroApi.draw();
      document.getElementById("trialPad").scrollIntoView({ block: "center" });
    });
    r = await p.evaluate(() => {
      const a = document.getElementById("trialPad").getBoundingClientRect(),
        b = document.getElementById("trialOugiBtn").getBoundingClientRect(),
        overlap = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      return { overlap, pad: [Math.round(a.left), Math.round(a.right)], btn: [Math.round(b.left), Math.round(b.right), Math.round(b.height)], w: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    check(!r.overlap && r.btn[1] <= r.w && r.btn[2] >= 80 && r.pad[0] >= 0 && r.overflow <= 0, "iPhone縦（" + width + "px）：左にスティック、右に奥義のボタン（重ならない・はみ出さない）", r);
    await gather(p, 4);
    await p.evaluate(() => document.getElementById("trialOugiBtn").scrollIntoView({ block: "center" }));
    await p.locator("#trialOugiBtn").tap();
    r = await p.evaluate(() => WD_DEBUG.trial.state().ougiUsed);
    check(r && r.hits > 0, "指で奥義のボタンを押すと発動する（" + width + "px）", r);
    await c.close();
  }
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
