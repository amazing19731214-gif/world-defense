// 戦場試練 v108.2：サバイバルの成長（主人公1人で開始・この戦闘だけの経験値とサバイバルLv・レベルアップの選択・一時強化・仲間の加入）
//   node tools/test-trial-recruit.mjs
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
  return { c, p };
}
const storage = (p) => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))));
// 選択が出るまで進める（出たら止まる）
const untilChoice = (p, max = 1200) =>
  p.evaluate((max) => {
    const T = WD_DEBUG.trial;
    for (let i = 0; i < max && T.on() && !T.state().choice; i++) WD_DEBUG.step(0.1);
    return T.state();
  }, max);
try {
  let { c, p } = await open();
  const save0 = await storage(p);
  // 1. 出撃の画面：主人公＋仲間候補（加入する順）。開始すると戦場には主人公1人だけ
  await p.evaluate(() => WD_DEBUG.trial.open("pick"));
  await p.locator('[data-trial-mode="survival"]').tap();
  for (const id of [1, 2, 3, 4, 5]) await p.locator('[data-trial-pick="' + id + '"]').tap();
  await p.locator('[data-trial-hero="1"]').tap();
  let r = await p.evaluate(() => ({ text: document.getElementById("trialBody").textContent, go: document.querySelector("[data-trial-go]").textContent }));
  check(/仲間候補（加入する順）：兵2 → 兵3 → 兵4 → 兵5/.test(r.text) && r.go.includes("主人公1人") && r.go.includes("候補4人"), "出撃の画面：主人公と、仲間候補（加入する順）が出る", r.go);
  await p.locator("[data-trial-go]").tap();
  r = await p.evaluate(() => {
    const s = WD_DEBUG.trial.state();
    WD_DEBUG.heroApi.draw();
    return { units: s.units.map((u) => u.id), reserve: s.reserve, slv: s.slv, xp: s.xp, need: s.need, info: document.getElementById("trialInfo").textContent };
  });
  check(r.units.join() === "1" && r.reserve.join() === "2,3,4,5" && r.slv === 1 && r.xp === 0, "開始時、戦場に出るのは主人公1人だけ（候補4人は待機）", r);
  check(/仲間 0\/4/.test(r.info) && !/HP/.test(r.info), "下の欄は主人公の名前と仲間の人数だけ（HP は戦場の上に1か所）", r.info);
  // 2. 敵を倒すと経験値が入り、必要量でサバイバルLv が上がる → 戦闘が止まり、選択画面
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    let xp = [];
    for (let i = 0; i < 1500 && T.on() && !T.state().choice; i++) {
      const k0 = T.state().kills;
      WD_DEBUG.step(0.1);
      const s = T.state();
      if (s.kills > k0 && !s.choice) xp.push(s.xp);
    }
    const s = T.state();
    return { xpSeen: xp, kills: s.kills, slv: s.slv, choice: s.choice, t: s.t };
  });
  check(r.xpSeen.length >= 1 && Math.max(...r.xpSeen) > 0, "敵を倒してコインを拾うと経験値が入る（" + r.xpSeen.join("→") + "）", r);
  check(r.slv === 2 && r.choice && r.choice.length === 3 && r.choice[0] === "recruit:2", "経験値がたまるとサバイバルLv2 になり、3つの選択肢（仲間の加入＋強化2つ）が出る", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      t0 = L.t,
      pos = L.enemies.filter((e) => !e.gone).map((e) => e.x + "," + e.y).join(";"),
      h = L.units[0],
      hx = h.x;
    T.stick(1, 0);
    for (let i = 0; i < 30; i++) WD_DEBUG.step(0.1);
    T.stick(0, 0);
    const box = document.getElementById("trialLevelUp"),
      btns = [...box.querySelectorAll("[data-trial-choose]")].map((b) => Math.round(b.getBoundingClientRect().height));
    return { same: L.t === t0 && pos === L.enemies.filter((e) => !e.gone).map((e) => e.x + "," + e.y).join(";") && h.x === hx, shown: !box.hidden, btns, text: box.textContent };
  });
  check(r.same, "レベルアップの選択中は戦闘が止まる（時間・敵・主人公が動かない）", r);
  check(r.shown && r.btns.length === 3 && r.btns.every((h) => h >= 56) && /仲間を1人加入/.test(r.text) && /兵2/.test(r.text), "選択画面は大きいボタン3つ（仲間の加入には名前・職業）", r);
  // 3. 仲間を加入：候補の次の1人が主人公の近くに現れる（演出）。戦闘が再開する
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      t0 = L.t;
    T.choose(0);
    const u = L.units.find((v) => v.id === 2),
      h = L.units[0],
      fx = WD_DEBUG.trial.state().fx;
    const texts = [];
    WD_DEBUG.step(0.1);
    return { n: L.units.length, reserve: T.state().reserve, d: u && Math.round(Math.hypot(u.x - h.x, u.y - h.y)), choice: T.state().choice, moved: L.t > t0, fx, box: document.getElementById("trialLevelUp").hidden };
  });
  check(r.n === 2 && r.reserve.join() === "3,4,5" && r.d < 90, "「仲間を1人加入」で候補の次の1人（兵2）が主人公の近くに現れる", r);
  check(r.fx > 0 && r.choice === null && r.moved && r.box, "加入の演出が出て、選択画面が閉じ、戦闘が再開する", r);
  // 4. 強化：選ぶと主人公の能力が上がる（6種類）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      out = {};
    for (const key of ["atk", "rate", "move", "hp", "def", "range"]) {
      const b = { atk: h.atkMul, rate: h.rateMul, move: h.speed, hp: h.max, def: h.defMul, range: h.range, reach: h.reachMul };
      L.lvUps = 1;
      L.choice = [{ kind: "boon", key }];
      T.choose(0);
      const a = { atk: h.atkMul, rate: h.rateMul, move: h.speed, hp: h.max, def: h.defMul, range: h.range, reach: h.reachMul };
      out[key] = key === "range" ? [b.range, a.range, b.reach, a.reach] : [b[key], a[key]];
    }
    return { out, boons: T.state().boons, choice: T.state().choice };
  });
  const up = (k, f) => f(r.out[k][0], r.out[k][1]);
  check(up("atk", (a, b) => b > a) && up("rate", (a, b) => b < a) && up("move", (a, b) => b > a) && up("hp", (a, b) => b > a) && up("def", (a, b) => b < a) && r.out.range[1] > r.out.range[0] && r.out.range[3] > r.out.range[2], "強化を選ぶと主人公の能力が上がる（攻撃・攻撃速度・移動速度・最大HP・防御・攻撃範囲）", r.out);
  check(Object.values(r.boons).every((n) => n === 1) && Object.keys(r.boons).length === 6 && r.choice === null, "取った強化は記録され、選び終わると戦闘に戻る", r.boons);
  // 攻撃力アップで、実際のダメージが増える
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    const before = h.dealt;
    for (let i = 0; i < 900 && h.dealt === before; i++) {
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    return { dealt: h.dealt - before, mul: h.atkMul };
  });
  check(r.mul === 1.25 && r.dealt > 0, "攻撃力アップは主人公のダメージに掛かる（×" + r.mul + "）", r);
  // 5. 仲間は最大4人まで（主人公と合わせて5人）。候補がいなくなると加入の選択肢は出ない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      seen = [];
    for (let k = 0; k < 8; k++) {
      L.lvUps = 1;
      L.choice = null;
      T.live().choice = null;
      // 次のレベルアップの選択を作る（ふつうの流れと同じ関数）
      WD_DEBUG.step(0.1);
      const s = T.state();
      if (!s.choice) continue;
      seen.push(s.choice.join("|"));
      const ri = s.choice.findIndex((c) => c.startsWith("recruit"));
      T.choose(ri >= 0 ? ri : 0);
    }
    return { n: L.units.length, reserve: T.state().reserve.length, seen, ids: L.units.map((u) => u.id) };
  });
  check(r.n === 5 && r.ids.join() === "1,2,3,4,5" && r.reserve === 0, "仲間は選んだ順に加入し、主人公と合わせて5人まで", r);
  check(r.seen.slice(-3).every((c) => !c.includes("recruit") && c.split("|").length === 3), "候補がいなくなると、選択肢は強化3つだけ（6人目は出ない）", r.seen);
  // PC：1〜3 のキーでも選べる
  await p.evaluate(() => {
    const L = WD_DEBUG.trial.live();
    L.lvUps = 1;
    WD_DEBUG.step(0.1);
  });
  await p.keyboard.press("2");
  r = await p.evaluate(() => WD_DEBUG.trial.state());
  check(r.choice === null && r.lvUps === 0, "PC では 1〜3 のキーでも選べる", { choice: r.choice, lvUps: r.lvUps });
  // 6. 最後まで（選択は加入を優先）：大将を倒して勝利。結果の画面にサバイバルLv・加入・強化
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    for (let i = 0; i < 2500 && T.on(); i++) {
      const s = T.state();
      if (s.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    const res = T.result();
    return { result: res.result, slv: res.slv, units: res.units.length, boons: res.boons, time: Math.round(res.time), kills: res.kills, text: document.getElementById("trialBody").textContent };
  });
  check(r.result === "win" && r.units === 5 && r.slv >= 5, "大将を倒すと勝利（サバイバルLv" + r.slv + "・" + r.time + "秒・撃破 " + r.kills + "）", { result: r.result, slv: r.slv, time: r.time });
  check(/サバイバル Lv\d+/.test(r.text) && /4\/4人が加入/.test(r.text) && /強化：/.test(r.text) && /この戦闘だけ/.test(r.text), "結果の画面：サバイバルLv・加入した仲間の数・取った強化（この戦闘だけと明記）", r.text.slice(0, 120));
  check((await storage(p)) === save0, "サバイバルLv・強化・加入は保存データに入らない（経験値・Lv・熟練度も変わらない）");
  // 7. 次の戦闘では、強化もサバイバルLv も元に戻る（その戦闘だけ）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1], { mode: "survival", hero: 1 }); // 候補なし：主人公1人
    const L = T.live(),
      h = L.units[0];
    const a = { slv: L.slv, atk: h.atkMul, rate: h.rateMul, def: h.defMul, reach: h.reachMul, boons: Object.keys(L.boons).length };
    for (let i = 0; i < 1500 && T.on() && !T.state().choice; i++) WD_DEBUG.step(0.1);
    return { a, choice: T.state() && T.state().choice };
  });
  check(r.a.slv === 1 && r.a.atk === 1 && r.a.rate === 1 && r.a.def === 1 && r.a.reach === 1 && r.a.boons === 0, "次の戦闘では、サバイバルLv・強化は最初から（持ち越さない）", r.a);
  check(r.choice && r.choice.length === 3 && r.choice.every((c) => !c.startsWith("recruit")), "仲間候補がいないときは、加入の選択肢を出さない（強化3つ）", r.choice);
  // 主人公が倒れたら敗北（選択中でも撤退できる）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialRetreat").click();
    return { on: T.on(), res: T.result().result, box: document.getElementById("trialLevelUp").hidden };
  });
  check(!r.on && r.res === "retreat" && r.box, "レベルアップの選択中でも撤退できる（選択画面も閉じる）", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3], { mode: "survival", hero: 2 });
    const h = T.live().units[0];
    let k = 0;
    while (T.on() && k++ < 2000) {
      const s = T.state();
      if (s.choice) T.choose(0);
      h.hp = Math.min(h.hp, 0.0001);
      WD_DEBUG.step(0.1);
    }
    return T.result().result;
  });
  check(r === "lose", "主人公が倒れたら敗北", r);
  check((await storage(p)) === save0, "敗北・撤退のあとも保存データは変わらない");
  // 大将が画面の外にいるとき：矢印を描く（エラーにならない）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live();
    L.t = 149.9;
    for (let i = 0; i < 20 && !L.boss; i++) {
      if (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    L.boss.x = 1850;
    L.boss.y = 80;
    L.units[0].x = 400;
    L.units[0].y = 1000;
    T.snap();
    WD_DEBUG.heroApi.draw();
    const s = T.toScreen(L.boss.x, L.boss.y);
    return { boss: !!L.boss, off: s.x > 960 || s.y < 0 || s.x < 0 || s.y > 600 };
  });
  check(r.boss && r.off, "大将が画面の外にいるときも描画できる（端に赤い矢印と「大将」）", r);
  await c.close();

  // 8. iPhone縦（375px・390px）：選択画面がはみ出さず、指で押せる
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812 }));
    await p.evaluate(() => {
      const T = WD_DEBUG.trial;
      document.getElementById("trialSheet").hidden = true;
      T.start([3, 1, 2], { mode: "survival", hero: 3 });
    });
    await untilChoice(p);
    r = await p.evaluate(() => {
      const box = document.getElementById("trialLevelUp"),
        card = box.querySelector(".trial-levelup-card").getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - innerWidth, left: Math.round(card.left), right: Math.round(card.right), top: Math.round(card.top), bottom: Math.round(card.bottom), w: innerWidth, h: innerHeight };
    });
    check(r.overflow <= 0 && r.left >= 8 && r.right <= r.w - 8 && r.top >= 0 && r.bottom <= r.h, "iPhone縦（" + width + "px）：レベルアップの選択画面が画面に収まる", r);
    await p.locator('[data-trial-choose="0"]').tap();
    r = await p.evaluate(() => ({ s: WD_DEBUG.trial.state(), overflow: document.documentElement.scrollWidth - innerWidth }));
    check(r.s.choice === null && r.s.units.length === 2 && r.overflow <= 0, "指で「仲間を1人加入」を押すと加入して再開（" + width + "px）", { n: r.s.units.length });
    await c.close();
  }
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
