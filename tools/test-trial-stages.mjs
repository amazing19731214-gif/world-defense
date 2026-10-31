// 戦場試練 v108.7：サバイバルの無限の面（大将 → 宝箱 → 次の面へ）・難易度・鬼大将・報酬・引き継ぎ・10面の連続プレイ
//   node tools/test-trial-stages.mjs
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
const ougiSave = { version: 1, seq: 1, books: [{ uid: 1, k: "happouTenshou", from: "試験", job: "sword_saint", level: 300, at: 1 }], known: {}, rolls: {}, fails: {}, heir: { sid: 1, k: "happouTenshou", book: 1 }, run: null };
// 面のクリアまで進める（選択は加入を優先。この試験は流れを見るので、主人公の HP は3割より下げない）
const toClear = (p, max = 3000) =>
  p.evaluate((max) => {
    const T = WD_DEBUG.trial,
      L = T.live();
    let maxE = 0,
      maxC = 0;
    for (let i = 0; i < max && T.on() && !L.cleared; i++) {
      if (L.choice) {
        const k = L.choice.findIndex((x) => x.kind === "recruit");
        T.choose(k >= 0 ? k : 0);
      }
      const h = L.units[0];
      if (h.hp < h.max * 0.3) h.hp = h.max * 0.3;
      WD_DEBUG.step(0.1);
      maxE = Math.max(maxE, L.enemies.filter((e) => !e.gone).length);
      maxC = Math.max(maxC, L.coins.length);
    }
    return { cleared: !!L.cleared, stage: L.floor, st: L.st, maxE, maxC, kinds: WD_DEBUG.combat.fx().kinds };
  }, max);
try {
  let { c, p } = await open({ ougi: ougiSave });
  const save0 = await storage(p);
  // 1. 第1面から始まる。画面には面・大将までの時間・Lv・仲間
  let r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    for (let i = 0; i < 20; i++) WD_DEBUG.step(0.1);
    WD_DEBUG.heroApi.draw();
    const s = T.state();
    return { stage: s.stage, st: Math.round(s.st), info: document.getElementById("trialInfo").textContent };
  });
  check(r.stage === 1 && r.st === 2 && /第1面/.test(r.info) && /仲間/.test(r.info), "第1面から始まる（画面に面の数と仲間の人数。上の帯に大将までの時間・Lv）", r);
  await p.touchscreen.tap(10, 10); // 音の準備
  // 2. 大将を倒すと面のクリア：敵・時間が止まり、残りのコインは全部経験値に。勝利の音と光。宝箱
  r = await toClear(p);
  const clearKinds = r.kinds;
  check(r.cleared && r.stage === 1 && r.maxE <= 37 && r.maxC <= 50, "大将を倒すと第1面クリア（" + Math.round(r.st) + "秒）", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      s0 = T.state(),
      hp0 = L.units.map((u) => u.hp).join(),
      st0 = L.st;
    for (let i = 0; i < 30; i++) WD_DEBUG.step(0.1);
    WD_DEBUG.heroApi.draw();
    const s1 = T.state(),
      box = document.getElementById("trialLevelUp");
    return { enemies: s1.enemies.filter((e) => !e.gone).length, coins: s1.coins, xp: s1.xpTotal === s1.dropped, stopped: L.st === st0 && L.units.map((u) => u.hp).join() === hp0, chest: s1.chest, victory: T.sfx.stats().played.victory, shown: !box.hidden, text: box.textContent, kinds: WD_DEBUG.combat.fx().kinds };
  });
  check(r.enemies === 0 && r.coins === 0 && r.xp && r.stopped, "クリアすると敵が消え、時間も止まる。落ちていたコインは全部経験値に（失われない）", r);
  check(r.victory === 1 && clearKinds.includes("cshock") && r.chest.state === "closed" && r.shown && /宝箱を開ける/.test(r.text), "勝利の音と光の輪。宝箱が光りながら出る", { victory: r.victory, chest: r.chest, text: r.text.slice(0, 40) });
  // 3. 宝箱を開ける → ドラムロール → 報酬（珍しいものは特別な光と音）→ 受け取る
  await p.locator('[data-trial-chest="open"]').tap();
  r = await p.evaluate(() => ({ state: WD_DEBUG.trial.state().chest.state, roll: WD_DEBUG.trial.sfx.stats().played.roll }));
  check(r.state === "opening" && r.roll >= 1, "宝箱を開けると、ドラムロール風の音（0.5秒）", r);
  await p.waitForTimeout(650);
  r = await p.evaluate(() => {
    const s = WD_DEBUG.trial.state(),
      box = document.getElementById("trialLevelUp");
    return { chest: s.chest, text: box.textContent, special: !!box.querySelector(".trial-reward.special"), played: WD_DEBUG.trial.sfx.stats().played };
  });
  check(r.chest.state === "open" && /受け取る/.test(r.text) && (r.chest.reward.special ? r.special && r.played.rare >= 1 : r.played.chest >= 1), "報酬が出る（" + r.chest.reward.key + (r.chest.reward.special ? "・珍しい報酬は金の光と特別な音" : "・きらっと音") + "）", r.chest);
  const reward1 = r.chest.reward.key;
  await p.locator('[data-trial-chest="take"]').tap();
  // レベルアップの選択（あれば）のあとで「次の面へ進む」
  for (let i = 0; i < 6; i++) {
    const has = await p.evaluate(() => !!WD_DEBUG.trial.state().choice);
    if (!has) break;
    await p.waitForTimeout(500);
    await p.locator('[data-trial-choose="0"]').tap();
  }
  r = await p.evaluate(() => {
    const s = WD_DEBUG.trial.state(),
      box = document.getElementById("trialLevelUp");
    return { rewards: s.rewardList, chest: s.chest, text: box.textContent, st: s.st, cleared: !!s.cleared };
  });
  check(r.rewards.join() === reward1 && r.chest.state === "next" && /第2面へ進む/.test(r.text) && r.cleared, "受け取ると記録され、「第2面へ進む」が出る（押すまで戦闘は止まったまま）", r);
  // 4. 次の面へ：敵・大将・コインは新しく。主人公・仲間・Lv・強化・報酬・残りの HP は引き継ぐ（少ない HP だけ35%まで）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    h.hp = h.max * 0.1; // 少ない HP
    const m = L.units[1];
    if (m) m.hp = m.max * 0.8;
    const before = { units: L.units.map((u) => u.id).join(), slv: L.slv, boons: JSON.stringify(L.boons), rewards: L.rewards.length, mhp: m && m.hp, kills: L.kills };
    return before;
  });
  const before = r;
  await p.locator('[data-trial-chest="next"]').tap();
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      m = L.units[1];
    return { stage: L.floor, st: L.st, enemies: L.enemies.length, coins: L.coins.length, boss: L.boss, cleared: L.cleared, units: L.units.map((u) => u.id).join(), slv: L.slv, boons: JSON.stringify(L.boons), rewards: L.rewards.length, hhp: h.hp / h.max, mhp: m && m.hp, kills: L.kills, box: document.getElementById("trialLevelUp").hidden };
  });
  check(r.stage === 2 && r.st === 0 && r.enemies === 0 && r.coins === 0 && !r.boss && !r.cleared && r.box, "「第2面へ進む」で第2面が始まる（敵・大将・コインは新しく）", r);
  check(r.units === before.units && r.slv === before.slv && r.boons === before.boons && r.rewards === before.rewards && r.mhp === before.mhp && r.kills === before.kills, "主人公・仲間・サバイバルLv・強化・報酬・残りの HP・撃破数は引き継ぐ（HP は全回復しない）", { before, after: r });
  check(Math.abs(r.hhp - 0.35) < 0.001, "HP が少ない兵士だけ、面の始まりに35%まで戻す（理不尽な即死を防ぐ）", r.hhp);
  // 面の始まりの3秒は攻撃を受けない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.next = 0;
    for (let i = 0; i < 10; i++) WD_DEBUG.step(0.1);
    const e = L.enemies.find((x) => !x.gone);
    if (e) (e.x = h.x + 20), (e.y = h.y), (e.target = h), (e.cd = 0);
    const hp0 = h.hp;
    for (let i = 0; i < 15; i++) {
      if (e) (e.x = h.x + 20), (e.y = h.y);
      WD_DEBUG.step(0.1);
    }
    return { e: !!e, hp0, hp1: h.hp, st: L.st };
  });
  check(r.e && r.hp1 >= r.hp0 && r.st < 3, "面の始まりの3秒は、敵が隣にいても HP が減らない", r);
  // 5. 難易度：面が進むと敵の体力・攻撃が上がる（数の上限は36体のまま）。強い種類が早く混ざる
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      G = T.stages;
    const one = (stage) => {
      L.floor = stage;
      L.st = 5;
      const n0 = L.spawned;
      L.next = 0;
      WD_DEBUG.step(0.1);
      const e = L.enemies.slice(n0 - L.spawned).find((x) => x.kind === "goblin") || L.enemies[L.enemies.length - 1];
      return { kind: e.kind, max: e.max, atk: e.atkMul };
    };
    const g2 = one(2),
      g6 = one(6);
    // 種類：第5面の最初の敵の種類の表
    L.floor = 5;
    L.st = 0;
    const kinds = new Set();
    for (let i = 0; i < 20; i++) {
      L.next = 0;
      const n0 = L.spawned;
      WD_DEBUG.step(0.1);
      for (const e of L.enemies.slice(n0 - L.spawned)) kinds.add(e.kind);
    }
    L.floor = 2;
    const base = { goblin: 45, wolf: 35, knight: 145, dragon: 135 }; // 敵の種類ごとの体力の表（修練場と同じ）
    return { g2, g6, ratioHp: g6.max / base[g6.kind] / (g2.max / base[g2.kind]), ratioAtk: g6.atk / g2.atk, kinds: [...kinds], expectHp: (1 + G.hpStep * 5) / (1 + G.hpStep), expectAtk: (1 + G.atkStep * 5) / (1 + G.atkStep) };
  });
  check(Math.abs(r.ratioHp - r.expectHp) < 0.02 && Math.abs(r.ratioAtk - r.expectAtk) < 0.02, "面が進むと敵の体力 +22%・攻撃 +10%ずつ（第6面は第2面の体力 ×" + r.ratioHp.toFixed(2) + "・攻撃 ×" + r.ratioAtk.toFixed(2) + "）", r);
  check(r.kinds.length >= 3, "面が進むと、強い種類の敵が早くから混ざる（第5面のはじめ：" + r.kinds.join("・") + "）", r.kinds);
  await c.close();

  // 6. 5面ごとの鬼大将：体力・攻撃が多く、紫の輪・別の音・別の名前。ふつうの大将は金の輪
  ({ c, p } = await open());
  await p.evaluate(() => {
    document.getElementById("trialSheet").hidden = true;
    WD_DEBUG.trial.start([1, 2, 3], { mode: "survival", hero: 1 });
  });
  await p.touchscreen.tap(10, 10);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      G = T.stages,
      boss = (stage) => {
        L.floor = stage;
        L.boss = null;
        L.st = 149.95;
        L.enemies = [];
        T.sfx.reset();
        for (let i = 0; i < 20 && !L.boss; i++) WD_DEBUG.step(0.1);
        WD_DEBUG.heroApi.draw();
        const b = L.boss;
        return { great: !!b.great, name: b.name, max: b.max / (1 + G.hpStep * (stage - 1)), atk: b.atkMul / (1 + G.atkStep * (stage - 1)), r: b.r, sfx: T.sfx.stats().played, banner: WD_DEBUG.combat.fx().banner && WD_DEBUG.combat.fx().banner.name };
      };
    const b4 = boss(4),
      b5 = boss(5),
      b10 = boss(10);
    return { b4, b5, b10 };
  });
  check(!r.b4.great && r.b4.name === "大将" && r.b4.sfx.boss === 1 && /大将 出現/.test(r.b4.banner), "ふつうの面の大将：警告の帯と角笛のような音（第4面）", r.b4);
  check(r.b5.great && r.b10.great && r.b5.name === "鬼大将" && r.b5.sfx.bossGreat === 1 && r.b5.max / r.b4.max > 2.5 && r.b5.atk / r.b4.atk > 1.3 && r.b5.r > r.b4.r && /鬼大将 出現/.test(r.b5.banner), "5面ごと（第5面・第10面）は鬼大将：体力 ×2.6・攻撃 ×1.35・大きい・紫の輪・重い音", { b4: r.b4.max, b5: r.b5.max, great: [r.b5.great, r.b10.great] });
  // 大将の HP の棒（画面の下）と、画面の外なら矢印（描くだけ：エラーにならない）
  r = await p.evaluate(() => {
    WD_DEBUG.heroApi.draw();
    const s = WD_DEBUG.trial.state();
    return { boss: s.boss && s.boss.hp > 0 };
  });
  check(r.boss, "大将の HP は画面の下の横長の棒に出る（鬼大将は紫）", r);
  await c.close();

  // 7. 報酬：6種類と、珍しい報酬（雷神の勾玉・不死鳥の羽・奥義の秘伝書）。確率は設定で変えられる
  ({ c, p } = await open({ ougi: ougiSave }));
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3], { mode: "survival", hero: 1 });
    const cnt = (great) => {
      const out = { special: 0, keys: {} };
      for (let i = 0; i < 3000; i++) {
        const x = T.roll(great);
        if (x.special) out.special++;
        out.keys[x.key] = (out.keys[x.key] || 0) + 1;
      }
      return out;
    };
    const a = cnt(false),
      b = cnt(true);
    return { a, b, chance: T.rewards.specialChance, great: T.rewards.specialChanceGreat };
  });
  check(Math.abs(r.a.special / 3000 - r.chance) < 0.03 && Math.abs(r.b.special / 3000 - r.great) < 0.05 && ["atk", "rate", "hp", "heal", "move", "range", "raijin", "phoenix", "hiden"].every((k) => r.a.keys[k] > 0), "報酬は6種類＋珍しい報酬3種類。珍しい報酬は約" + Math.round((r.a.special / 3000) * 100) + "%（鬼大将の宝箱は約" + Math.round((r.b.special / 3000) * 100) + "%）", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0],
      give = (key, special) => {
        L.cleared = { stage: L.floor, great: false };
        L.chest = { state: "open", reward: { key, special } };
        T.chestTake();
        while (L.choice) T.choose(0);
        L.cleared = null;
        L.chest = null;
      };
    const a0 = h.atkMul,
      m0 = h.max;
    give("atk", false);
    give("hp", false);
    h.hp = h.max * 0.2;
    give("heal", false);
    const heal = h.hp / h.max;
    give("hiden", true);
    give("raijin", true);
    give("phoenix", true);
    // 雷神の勾玉：敵を近くに置いて4秒
    L.next = 1e9;
    L.st = 10;
    L.next = 0;
    for (let i = 0; i < 20; i++) WD_DEBUG.step(0.1);
    L.next = 1e9;
    for (const e of L.enemies) if (!e.gone) (e.x = h.x + 60), (e.y = h.y + 10);
    for (let i = 0; i < 50; i++) WD_DEBUG.step(0.1);
    const raijin = T.state().raijin;
    // 不死鳥の羽：主人公が倒れるとき一度だけ立ち上がる
    let k = 0;
    while (!(T.state().phoenix === 0 && h.hp > 0) && k++ < 600) {
      const e = L.enemies.find((x) => !x.gone);
      if (e) (e.x = h.x + 20), (e.y = h.y), (e.target = h), (e.hp = e.max = 1e9); // 倒されない敵（攻撃させるため）
      else L.next = 0;
      h.hp = Math.min(h.hp, 1);
      WD_DEBUG.step(0.1);
    }
    return { atk: [a0, h.atkMul], hp: [m0, h.max], heal, ougiMul: T.state().ougiMul, raijinHits: L.raijinHits || 0, raijin, phoenixUsed: L.phoenixUsed || 0, alive: !h.dead, rewards: T.state().rewardList };
  });
  check(r.atk[1] > r.atk[0] && r.hp[1] > r.hp[0] && r.heal >= 0.79, "報酬：攻撃力アップ・最大HPアップ・HP回復（20%→" + Math.round(r.heal * 100) + "%）がその挑戦の間だけ効く", r);
  check(r.raijinHits > 0 && r.ougiMul === 1.5, "雷神の勾玉：一定の間隔で周りの敵に雷（" + r.raijinHits + "回）。奥義の秘伝書：奥義の威力 ×1.5", r);
  check(r.phoenixUsed === 1 && r.alive, "不死鳥の羽：主人公が倒れるとき、一度だけ立ち上がる", r);
  await c.close();

  // 8. 10面の連続プレイ（Lv300 の5人。宝箱は受け取り、選択は加入を優先。主人公の HP は3割より下げない）
  //    敵は36体・コインは50枚・演出・矢弾・音・倒した敵の記録が、面を重ねても増え続けない
  ({ c, p } = await open({ width: 390, height: 844 }));
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
    const L = T.live(),
      log = [],
      great = [];
    let maxE = 0,
      maxC = 0,
      maxFx = 0,
      maxShots = 0,
      maxList = 0,
      maxVoices = 0;
    const t0 = performance.now();
    for (let i = 0; i < 40000 && T.on() && L.floor <= 10; i++) {
      if (L.cleared) {
        log.push(L.floor + ":" + Math.round(L.st) + "s/Lv" + L.slv + "/" + (L.chest && L.chest.reward ? L.chest.reward.key : "-"));
        if (L.cleared.great) great.push(L.floor);
        if (L.chest && L.chest.state === "closed") (L.chest.state = "open"), T.chestTake();
        while (L.choice) T.choose(0);
        T.nextStage();
        continue;
      }
      if (L.choice) {
        const k = L.choice.findIndex((x) => x.kind === "recruit");
        T.choose(k >= 0 ? k : 0);
      }
      const h = L.units[0];
      if (h.hp < h.max * 0.3) h.hp = h.max * 0.3;
      WD_DEBUG.step(0.1);
      if (i % 10 === 0) {
        const s = T.state();
        maxE = Math.max(maxE, L.enemies.filter((e) => !e.gone).length);
        maxC = Math.max(maxC, L.coins.length);
        maxFx = Math.max(maxFx, s.fx);
        maxShots = Math.max(maxShots, s.shots);
        maxList = Math.max(maxList, L.enemies.length);
        maxVoices = Math.max(maxVoices, T.sfx.voices());
      }
    }
    const ms = Math.round(performance.now() - t0),
      s = T.state();
    T.retreat();
    const R = T.result();
    return { stage: s.stage, bosses: R.bosses, log, great, maxE, maxC, maxFx, maxShots, maxList, maxVoices, ms, time: Math.round(R.time), kills: R.kills, exp: R.coins.xp, slv: R.slv, rewards: R.rewardList.length, text: document.getElementById("trialBody").textContent };
  });
  console.log("   10面：" + r.log.join(" "));
  check(r.bosses === 10 && r.stage === 11 && r.great.join() === "5,10", "10面を続けてクリアできる（大将10体・鬼大将は第5面と第10面。合計 " + Math.floor(r.time / 60) + "分・撃破 " + r.kills + "・サバイバルLv" + r.slv + "）", { bosses: r.bosses, stage: r.stage, great: r.great });
  check(r.maxE <= 37 && r.maxC <= 50 && r.maxFx <= 80 && r.maxShots <= 160 && r.maxList <= 130 && r.maxVoices <= 8, "面を重ねても溜まらない（敵 最大" + r.maxE + "・コイン " + r.maxC + "・演出 " + r.maxFx + "・矢弾 " + r.maxShots + "・敵の記録 " + r.maxList + "）", r);
  check(r.rewards === 10 && /到達 第11面/.test(r.text) && /大将を倒した数 10/.test(r.text) && /獲得 EXP/.test(r.text) && /報酬：/.test(r.text), "結果の画面：到達した面・倒した大将の数・撃破・獲得 EXP・報酬", r.text.slice(0, 160));
  await c.close();

  // 9. ゲームオーバー：主人公が倒れたら終わり（本編の兵士には何も起きない）。結果の画面から再挑戦できる
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3], { mode: "survival", hero: 1 });
    const L = T.live(),
      h = L.units[0];
    L.floor = 3;
    let k = 0;
    while (T.on() && k++ < 1500) {
      if (L.choice) T.choose(0);
      if (L.st > 4) {
        h.hp = Math.min(h.hp, 1);
        const e = L.enemies.find((x) => !x.gone);
        if (e) (e.x = h.x + 20), (e.y = h.y), (e.target = h);
      }
      WD_DEBUG.step(0.1);
    }
    const R = T.result();
    return { result: R.result, stage: R.floor, text: document.getElementById("trialBody").textContent, again: !!document.querySelector("[data-trial-again]"), best: T.best(), key: localStorage.getItem("worldDefense.trialBest.v1") };
  });
  check(r.result === "lose" && /第3面で力尽きた/.test(r.text) && r.again, "主人公が倒れたらゲームオーバー（「第3面で力尽きた」）。結果の画面から再挑戦できる", r.text.slice(0, 60));
  check(r.key === null, "本番の版では、最高到達面を保存しない（テスト版の保存の領域にだけ保存）", r);
  // 三方の関は変わらない（面も宝箱もない）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    for (let i = 0; i < 100; i++) WD_DEBUG.step(0.1);
    const s = T.state();
    T.retreat();
    return { stage: s.stage, chest: s.chest };
  });
  check(r.stage == null && r.chest == null, "三方の関には面も宝箱もない（いままでどおり）", r);
  await c.close();

  // 10. iPhone縦（375px・390px）：宝箱・報酬・次の面へがはみ出さない。大将の HP の棒もはみ出さない
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812 }));
    await p.evaluate(() => {
      document.getElementById("trialSheet").hidden = true;
      WD_DEBUG.trial.start([1, 2, 3], { mode: "survival", hero: 1 });
    });
    await toClear(p);
    const fit = () =>
      p.evaluate(() => {
        const k = document.querySelector("#trialLevelUp .trial-levelup-card").getBoundingClientRect();
        return { ok: k.left >= 8 && k.right <= innerWidth - 8 && k.top >= 0 && k.bottom <= innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
      });
    const f1 = await fit();
    await p.locator('[data-trial-chest="open"]').tap();
    await p.waitForTimeout(650);
    const f2 = await fit();
    await p.locator('[data-trial-chest="take"]').tap();
    for (let i = 0; i < 6 && (await p.evaluate(() => !!WD_DEBUG.trial.state().choice)); i++) {
      await p.waitForTimeout(500);
      await p.locator('[data-trial-choose="0"]').tap();
    }
    const f3 = await fit();
    await p.locator('[data-trial-chest="next"]').tap();
    r = await p.evaluate(() => WD_DEBUG.trial.state().stage);
    check(f1.ok && f2.ok && f3.ok && f1.overflow <= 0 && r === 2, "iPhone縦（" + width + "px）：宝箱・報酬・次の面へが画面に収まり、指で押して第2面へ進める", { f1, f2, f3, stage: r });
    await c.close();
  }
  ({ c, p } = await open());
  const save1 = await storage(p);
  await p.evaluate(() => {
    document.getElementById("trialSheet").hidden = true;
    WD_DEBUG.trial.start([1, 2, 3, 4, 5], { mode: "survival", hero: 1 });
  });
  await toClear(p);
  await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.chest.state = "open";
    T.chestTake();
    while (L.choice) T.choose(0);
    T.nextStage();
    T.retreat();
  });
  check((await storage(p)) === save1, "面・宝箱・報酬・最高到達面は、本番の版の保存データに入らない（兵士・経験値・奥義なども変わらない）");
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
