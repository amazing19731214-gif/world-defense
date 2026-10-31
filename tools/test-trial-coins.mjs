// 戦場試練 v108.5：サバイバルの経験値コイン（落ちる・吸い寄せ・回収・合体）と経験値ゲージ
//   node tools/test-trial-coins.mjs
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
    document.getElementById("trialSheet").hidden = true;
    T.start(ids, { mode: "survival", hero: 1 });
    const L = T.live();
    L.next = 1e9; // 敵を出さない
    L.units[0].x = 1000;
    L.units[0].y = 600;
    return L.units[0].id;
  }, ids);
try {
  let { c, p } = await open();
  const save0 = await storage(p);
  // 1. 敵を倒すとコインが落ちる（経験値は拾うまで入らない）
  let r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live();
    for (let i = 0; i < 900 && !L.dropped; i++) WD_DEBUG.step(0.1);
    const s = T.state();
    return { kills: s.kills, dropped: s.dropped, coins: s.coins, coinXp: s.coinXp, xpTotal: s.xpTotal, picked: s.picked };
  });
  check(r.kills >= 1 && r.dropped >= 1 && r.dropped === r.coinXp + r.xpTotal, "敵を倒すと経験値コインが落ちる（落ちた経験値 " + r.dropped + " ＝ 拾った分 " + r.xpTotal + " ＋ 落ちている分 " + r.coinXp + "）", r);
  await c.close();

  ({ c, p } = await open());
  await quiet(p);
  // 2. 拾うまで経験値は増えない（遠いコインは動かない）。仲間はコインを拾わない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      R = T.survival;
    T.drop(1500, 600, "knight"); // 主人公から500：届かない
    const c0 = T.coinList()[0];
    for (let i = 0; i < 30; i++) WD_DEBUG.step(0.1);
    const c1 = T.coinList()[0];
    return { xp: T.state().xp, xpTotal: T.state().xpTotal, moved: Math.hypot(c1.x - c0.x, c1.y - c0.y), v: c1.xp, magnet: R.magnet };
  });
  check(r.xp === 0 && r.xpTotal === 0 && r.moved === 0 && r.v === 2, "コインを拾うまで経験値は増えない（遠いコインは動かない。槍兵のコインは経験値2）", r);
  // 3. 主人公が近づくと吸い寄せられて拾う（光と音）。経験値が入る
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    h.x = 1500 - T.survival.magnet + 20; // 吸い寄せの距離の内側へ
    const out = [];
    let sfx0 = T.state().sfx;
    for (let i = 0; i < 20 && T.state().coins; i++) {
      WD_DEBUG.step(0.05);
      const c = T.coinList()[0];
      out.push(c ? Math.round(Math.hypot(c.x - h.x, c.y - h.y + 10)) : "拾った");
    }
    const s = T.state();
    return { out: out.join(","), xp: s.xp, xpTotal: s.xpTotal, picked: s.picked, sfx: s.sfx - sfx0, fx: WD_DEBUG.combat.fx().kinds };
  });
  check(r.xpTotal === 2 && r.picked === 1 && /拾った/.test(r.out), "主人公が近づくと、コインが吸い寄せられて拾える（距離 " + r.out.split(",").slice(0, 6).join("→") + "…）", r);
  check(r.sfx >= 1 && r.fx.includes("cspark"), "拾うと小さな光と音（画面に触れたあとに鳴る）", { sfx: r.sfx, fx: r.fx });
  // 仲間はコインを拾わない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.lvUps = 0;
    L.choice = null;
    // 仲間を1人呼ぶ
    L.lvUps = 1;
    WD_DEBUG.step(0.1);
    if (L.choice) T.choose(L.choice.findIndex((c) => c.kind === "recruit"));
    const m = L.units[1];
    L.units[0].x = 400;
    L.units[0].y = 300;
    m.x = 1700;
    m.y = 900;
    T.drop(1700, 900);
    const x0 = T.state().xpTotal;
    for (let i = 0; i < 5; i++) {
      m.x = 1700;
      m.y = 900;
      WD_DEBUG.step(0.1);
    }
    return { coins: T.state().coins, xp: T.state().xpTotal - x0, mate: !!m };
  });
  check(r.mate && r.coins === 1 && r.xp === 0, "仲間がコインの上にいても拾わない（主人公だけが拾う）", r);
  await c.close();

  // 4. 大量回収：まわりの40枚を一度に拾っても、経験値は1つも失われない（レベルアップをまたいでも合計が同じ）
  ({ c, p } = await open());
  await quiet(p, [1]);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    let sum = 0;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2,
        k = i % 3 ? "goblin" : "knight";
      T.drop(h.x + Math.cos(a) * 90, h.y + Math.sin(a) * 70, k);
      sum += k === "knight" ? 2 : 1;
    }
    const ups = [];
    for (let i = 0; i < 40 && T.state().coins; i++) {
      if (L.choice) {
        ups.push(L.slv);
        T.choose(0);
      }
      WD_DEBUG.step(0.05);
    }
    // 合計：これまでの Lv の必要量の和＋今の経験値
    let total = L.xp;
    for (let lv = 1; lv < L.slv; lv++) total += T.survival.need(lv);
    return { sum, xpTotal: L.xpTotal, total, slv: L.slv, coins: L.coins.length };
  });
  check(r.coins === 0 && r.xpTotal === r.sum && r.total === r.sum, "40枚を一度に拾っても、経験値は失われない（合計 " + r.sum + "・サバイバルLv" + r.slv + "）", r);
  // 6. レベルアップ：必要量に届いた分だけ上がり、戦闘が止まって選択画面
  check(r.slv >= 3, "まとめて拾うと、Lv が続けて上がる（Lv" + r.slv + "）", r.slv);
  // 経験値ゲージ：滑らかに伸び、Lv が上がると満タン → 光 → 次の Lv へ
  r = await p.evaluate(async () => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      seq = [];
    if (L.choice) T.choose(0);
    L.lvUps = 0;
    L.gauge = { lv: L.slv, v: L.xp, flash: 0 };
    for (let i = 0; i < 20; i++) T.drop(h.x + 40, h.y + (i % 5) * 4, "knight"); // 40
    for (let i = 0; i < 10; i++) {
      WD_DEBUG.step(0.05);
      if (L.choice) T.choose(0);
    }
    for (let k = 0; k < 40; k++) {
      WD_DEBUG.heroApi.draw();
      seq.push([L.gauge.lv, Math.round(L.gauge.v), Math.round(L.gauge.flash * 10)]);
      await new Promise((r) => setTimeout(r, 40));
    }
    return { seq, slv: L.slv, xp: L.xp };
  });
  const firstLv = r.seq[0][0],
    lastLv = r.seq[r.seq.length - 1];
  check(r.seq.some((x) => x[2] > 0) && lastLv[0] === r.slv && lastLv[1] === r.xp && r.seq.length > 5 && r.seq[0][1] !== r.xp, "経験値ゲージは滑らかに伸び、満タンで光って次の Lv に切り替わる（Lv" + firstLv + "→Lv" + lastLv[0] + "）", r.seq.filter((_, i) => i % 4 === 0));
  await c.close();

  // 5. 合体：コインが50枚を超えたら、近くのコインに合体（経験値の合計は同じ）
  ({ c, p } = await open());
  await quiet(p, [1]);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    for (let i = 0; i < 80; i++) T.drop(1500 + (i % 10) * 25, 300 + Math.floor(i / 10) * 25, i % 2 ? "goblin" : "knight");
    const s = T.state();
    return { coins: s.coins, coinXp: s.coinXp, merges: s.merges, dropped: s.dropped, max: T.survival.coinMax };
  });
  check(r.coins === r.max && r.merges === 30 && r.coinXp === r.dropped && r.dropped === 120, "コインは50枚まで。超えた30枚は近くのコインに合体し、経験値の合計（120）はそのまま", r);
  // 合体したコインを拾っても、全部入る
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    for (let i = 0; i < 400 && L.coins.length; i++) {
      if (L.choice) T.choose(0);
      const c = L.coins[0];
      h.x = c.x;
      h.y = c.y + 10;
      WD_DEBUG.step(0.05);
    }
    return { left: L.coins.length, xpTotal: L.xpTotal };
  });
  check(r.left === 0 && r.xpTotal === 120, "合体したコインを拾っても、経験値は全部入る（120）", r);
  // 7. レベルアップの選択中は止まる：コインも動かず、経験値も増えない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    T.drop(h.x + 60, h.y);
    L.lvUps = 1;
    L.lvAt = null;
    L.choice = null;
    WD_DEBUG.step(0.05); // 選択画面が開く
    const opened = !!L.choice,
      c0 = { ...L.coins[0] },
      x0 = L.xpTotal,
      t0 = L.t;
    for (let i = 0; i < 20; i++) WD_DEBUG.step(0.1);
    const c1 = L.coins[0];
    const still = c1 && c1.x === c0.x && c1.y === c0.y && L.xpTotal === x0 && L.t === t0;
    T.choose(0);
    for (let i = 0; i < 20; i++) WD_DEBUG.step(0.1);
    return { opened, still, after: L.xpTotal - x0 };
  });
  check(r.opened && r.still && r.after === 1, "レベルアップの選択中は、コインも経験値も時間も止まる（選んだあとで拾う）", r);
  await c.close();

  // 8. iPhone縦：コイン50枚・敵36体でも重くならない（1コマの描画と処理の時間）。地形に埋まらない
  ({ c, p } = await open({ width: 390, height: 844 }));
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live(),
      M = T.map(),
      inRiver = (x, y) => x > M.river.x0 && x < M.river.x1 && !M.bridges.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    let bad = 0,
      maxC = 0,
      lv = 0;
    for (let i = 0; i < 2400 && T.on() && !L.cleared; i++) {
      if (L.choice) {
        lv++;
        const k = L.choice.findIndex((x) => x.kind === "recruit");
        T.choose(k >= 0 ? k : 0);
      }
      WD_DEBUG.step(0.1);
      if (!T.on()) break;
      maxC = Math.max(maxC, L.coins.length);
      for (const c of L.coins) if (!c.pull && (inRiver(c.x, c.y) || M.obstacles.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < b.r))) bad++; // 落ちて止まっているコイン（吸い寄せ中は空中を飛ぶ）
    }
    const cleared = !!L.cleared; // v108.7：大将を倒すと面のクリア。ここで終えて結果を見る
    T.retreat();
    const res = T.result();
    return { bad, maxC, lv, result: cleared ? "win" : res.result, slv: res.slv, coins: res.coins, time: Math.round(res.time) };
  });
  check(r.bad === 0 && r.maxC <= 50, "コインは川・木・岩に埋まらず、50枚を超えない（最大 " + r.maxC + "枚）", r);
  check(r.lv >= 5 && r.lv <= 7 && r.result === "win", "3分の戦闘でレベルアップは " + r.lv + " 回（5〜7回）。大将を倒して第1面クリア（" + r.time + "秒）", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live(),
      h = L.units[0];
    for (let i = 0; i < 4; i++) {
      L.lvUps = 1;
      WD_DEBUG.step(0.05);
      if (L.choice) T.choose(L.choice.findIndex((x) => x.kind === "recruit"));
    }
    L.next = 1e9;
    // 敵36体・コイン50枚を画面の中に
    for (let i = 0; i < 36; i++) L.enemies.push(Object.assign({}, L.enemies[0] || {}));
    L.enemies.length = 0;
    L.st = 100; // v108.7：敵の出方はその面の時間で決まる
    L.next = 0;
    for (let i = 0; i < 600 && L.enemies.filter((e) => !e.gone).length < 36; i++) {
      L.next = 0;
      for (const u of L.units) u.hp = u.max;
      WD_DEBUG.step(0.1);
      if (L.choice) T.choose(0);
    }
    for (let i = 0; i < 60; i++) T.drop(h.x + ((i % 10) - 5) * 30, h.y + 220 + Math.floor(i / 10) * 20);
    T.snap();
    let tick = 0,
      draw = 0;
    for (let k = 0; k < 30; k++) {
      const a = performance.now();
      WD_DEBUG.step(0.05);
      const b = performance.now();
      WD_DEBUG.heroApi.draw();
      tick += b - a;
      draw += performance.now() - b;
      if (L.choice) T.choose(0);
    }
    return { enemies: L.enemies.filter((e) => !e.gone).length, coins: L.coins.length, tick: Math.round((tick / 30) * 10) / 10, draw: Math.round((draw / 30) * 10) / 10 };
  });
  check(r.enemies >= 30 && r.coins >= 40 && r.tick + r.draw < 16, "敵 " + r.enemies + "体・コイン " + r.coins + "枚でも、1コマの処理 " + r.tick + "ms・描画 " + r.draw + "ms（重くならない）", r);
  await c.close();

  // 9. 三方の関はコインを落とさない（いままでどおり）
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    for (let i = 0; i < 400 && T.on(); i++) WD_DEBUG.step(0.1);
    const s = T.state() || {};
    return { kills: s.kills, coins: s.coins, gauge: s.gauge };
  });
  check(r.kills > 0 && r.coins == null && r.gauge == null, "三方の関ではコインも経験値ゲージも出ない（撃破 " + r.kills + "）", r);
  // 10. 保存データは変わらない
  check((await storage(p)) === save0, "コイン・サバイバルLv・強化は保存データに入らない（本番の兵士の経験値・Lv も変わらない）");
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
