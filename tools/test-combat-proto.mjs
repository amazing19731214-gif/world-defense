// 戦闘の試作（v106試作・v106.1で奥義ゲージを廃止）：修練場の「新しい戦い（試作）」だけで、新しい敵（鉄砲足軽・盾兵の連携）と3つの技（三方撃ち・貫通弾・八方斬撃）・奥義の演出を使う
//   node tools/test-combat-proto.mjs
//   通常の防衛戦・修練場（試作なし）の戦闘の処理が変わらないこと、当たる範囲・盾の守り・止まって撃つ動き・演出の数の上限を確かめる
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
const SKEY = "worldDefense.soldiers.v1",
  UI = "worldDefense.ui.v1";
// 槍兵・弓兵・鉄砲兵・足軽の部隊
const types = ["spearman", "archer", "gunner", "ashigaru"];
const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
let sid = 0;
types.forEach((t, i) => {
  save.squads.push({ id: i + 1, type: t, slot: i });
  for (let k = 0; k < 8; k++) save.soldiers.push({ id: ++sid, type: t, squadId: i + 1, level: 40 });
});
async function open({ query = "?debug", seed = null, ui = null, width = 375, height = 667 } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(
    ([save, seed, ui]) => {
      requestAnimationFrame = () => 0;
      if (seed != null) {
        // 戦闘の処理を見比べるため、乱数を同じ並びにする
        let x = seed;
        Math.random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      }
      if (location.protocol !== "http:" || sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [] }));
      localStorage.setItem("worldDefense.training.v1", JSON.stringify({ best: { beginner: { waves: 3, level: 6 } }, clears: { beginner: 2 } }));
      if (ui) localStorage.setItem("worldDefense.ui.v1", JSON.stringify(ui));
    },
    [save, seed, ui],
  );
  const p = await c.newPage();
  p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
// 防衛戦（または修練場）を同じ手順で動かし、戦闘の結果をまとめる
const play = (p, { steps = 200, train = false } = {}) =>
  p.evaluate(
    ({ steps, train }) => {
      const S = WD_DEBUG.state,
        A = WD_DEBUG.squadApi;
      WD_DEBUG.setGold(99999);
      if (train) WD_DEBUG.trainingApi.startTraining("beginner");
      let tid = 900;
      if (!train)
        for (const [t, x, y] of [["arrow", 330, 90], ["cannon", 640, 200], ["magic", 660, 420]]) S().towers.push({ id: ++tid, x, y, type: t, level: 2, cd: 0, spent: 100, hp: 400 });
      [[620, 300], [400, 440], [400, 165], [300, 440]].forEach((pt, i) => A.deployReserve(S().squads[i], ...pt));
      document.getElementById("start").click();
      const behaviors = new Set();
      for (let i = 0; i < steps; i++) {
        WD_DEBUG.step(0.05);
        if (train && !S().enemies.length && WD_DEBUG.trainingApi.training()) document.getElementById("start").click(); // 修練場は次のウェーブへ
        for (const e of S().enemies) if (e.behavior) behaviors.add(e.behavior);
      }
      const st = S();
      return {
        behaviors: [...behaviors],
        stats: WD_DEBUG.combat.stats(),
        sim: {
          gold: st.gold,
          hp: st.hp,
          wave: st.wave,
          enemies: st.enemies.map((e) => [e.kind, Math.round(e.x), Math.round(e.y), Math.round(e.hp)]),
          towers: st.towers.map((t) => [t.type, Math.round(t.hp), t.level]),
          soldiers: st.soldiers.map((s) => [s.id, s.alive, Math.round(s.hp || 0), s.level, Math.round(s.xp || 0)]),
        },
      };
    },
    { steps, train },
  );
try {
  // 1. 通常の防衛戦：試作の設定がオンでも、戦闘の処理は同じ。新しい敵・技は出ない
  let { c, p } = await open({ seed: 7 });
  const normal = await play(p, { steps: 400 });
  await c.close();
  ({ c, p } = await open({ seed: 7, query: "?debug&proto=combat" }));
  check(await p.evaluate(() => WD_DEBUG.combat.pick() === true && !WD_DEBUG.combat.on()), "?proto=combat は修練場の試作を選ぶだけ（防衛戦ではオフ）");
  const normalPick = await play(p, { steps: 400 });
  check(JSON.stringify(normal.sim) === JSON.stringify(normalPick.sim), "通常の防衛戦の戦闘（敵・塔・兵士・資金）は試作の設定に関係なく同じ", { normal: normal.sim, pick: normalPick.sim });
  check(normalPick.behaviors.length === 0 && Object.keys(normalPick.stats.patterns).length === 0 && normalPick.stats.ougi === 0, "通常の防衛戦には新しい敵・技が出ない", normalPick);
  await c.close();

  // 2. 修練場（試作なし）：今までと同じ。同じ乱数なら結果も同じ
  ({ c, p } = await open({ seed: 11 }));
  const trainOff = await play(p, { steps: 500, train: true });
  check(trainOff.behaviors.length === 0 && Object.keys(trainOff.stats.patterns).length === 0, "試作をオンにしない修練場には新しい敵・技が出ない", trainOff);
  await c.close();
  ({ c, p } = await open({ seed: 11 }));
  const trainOff2 = await play(p, { steps: 500, train: true });
  check(JSON.stringify(trainOff.sim) === JSON.stringify(trainOff2.sim), "試作なしの修練場は同じ乱数で同じ結果（試験の前提）");

  // 3. 修練場の画面：「🧪 新しい戦い（試作）」の切り替え。表示の記録だけに保存し、兵士の保存データは変えない
  await c.close();
  ({ c, p } = await open());
  const soldiersBefore = await p.evaluate((k) => localStorage.getItem(k), SKEY);
  await p.tap("#trainingOpen");
  let r = await p.evaluate(() => {
    const b = document.getElementById("trProto");
    return { has: !!b, checked: b && b.checked, label: b && b.closest("label") && b.closest("label").textContent, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  check(r.has && !r.checked && r.label.includes("新しい戦い（試作）"), "修練場の画面に「🧪 新しい戦い（試作）」（初めはオフ）", r);
  check(r.overflow <= 0, "iPhone縦（375px）で修練場の画面が横にはみ出さない", r);
  await p.evaluate(() => {
    const b = document.getElementById("trProto");
    b.checked = true;
    b.dispatchEvent(new Event("change", { bubbles: true }));
  });
  r = await p.evaluate(([k, s]) => ({ ui: JSON.parse(localStorage.getItem(k) || "{}"), pick: WD_DEBUG.combat.pick(), checked: document.getElementById("trProto").checked, same: localStorage.getItem(s) }), [UI, SKEY]);
  check(r.pick && r.checked && r.ui.combatProto === true, "オンにすると選んだ記録を表示の記録（combatProto）に保存", r.ui);
  check(r.same === soldiersBefore, "切り替えても兵士の保存データは変わらない");
  await c.close();
  ({ c, p } = await open({ ui: { combatProto: true } }));
  check(await p.evaluate(() => WD_DEBUG.combat.pick()), "次に開いたときも試作の選択が残る");
  await p.evaluate(() => {
    WD_DEBUG.combat.pick(false);
  });
  await c.close();

  // 4. 修練場（試作）：盾兵が前・鉄砲足軽が後ろの連携部隊と、ひとりの鉄砲足軽が出る
  ({ c, p } = await open({ seed: 5, query: "?debug&proto=combat" }));
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state;
    WD_DEBUG.trainingApi.startTraining("beginner");
    document.getElementById("start").click();
    let found = null;
    for (let i = 0; i < 400 && !found; i++) {
      WD_DEBUG.step(0.05);
      const lead = S().enemies.find((e) => e.behavior === "tate");
      const fol = lead && S().enemies.filter((e) => e.leader === lead);
      if (lead && fol.length === 2) found = { lead: [lead.d, lead.kind, lead.armor], fol: fol.map((f) => [f.behavior, f.path === lead.path, lead.d - f.d, f.followGap, f.kind]) };
    }
    return { on: WD_DEBUG.combat.on(), proto: WD_DEBUG.trainingApi.training().proto, found };
  });
  check(r.on && r.proto, "試作を選んで始めた修練場では試作の戦闘がオン", r);
  check(r.found && r.found.fol.every((f) => f[0] === "teppo" && f[1] && f[2] > 0), "盾兵1体の後ろに鉄砲足軽2体（同じ道・盾兵より後ろ）", r.found);
  // 4-1. 鉄砲足軽：部隊が射程に入ると止まって撃つ。一定時間撃つと少し前へ出る
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state;
    WD_DEBUG.stopSpawning();
    S().enemies.length = 0;
    const q = S().squads[0];
    WD_DEBUG.squadApi.deployReserve(q, 620, 300);
    const B = WD_DEBUG.combat.behaviors.teppo;
    const e = WD_DEBUG.addEnemy({ d: 200, hp: 99999, speed: 40, kind: "dragon", behavior: "teppo" });
    const hpSum = () => S().soldiers.filter((s) => s.squadId === q.id && s.alive).reduce((a, s) => a + s.hp, 0);
    let t = 0;
    while (t < 30 && !(Math.hypot(e.x - q.x, e.y - q.y) <= B.stopRange)) {
      WD_DEBUG.step(0.05);
      t += 0.05;
    }
    const d0 = e.d,
      dist0 = Math.hypot(e.x - q.x, e.y - q.y),
      hp0 = hpSum();
    WD_DEBUG.step(B.hold * 0.8);
    const d1 = e.d,
      hp1 = hpSum();
    WD_DEBUG.step(B.hold * 0.3 + 0.6);
    return { dist0, stop: B.stopRange, moved: d1 - d0, hurt: hp0 - hp1, advanced: e.d - d1, blocked: !!e.blockedBy };
  });
  check(r.dist0 <= r.stop && r.dist0 > 60 && Math.abs(r.moved) < 3, "鉄砲足軽は部隊が射程に入ると止まる（足止めの距離より遠く）", r);
  check(r.hurt > 0, "止まった鉄砲足軽は離れた所から部隊を撃つ", r);
  check(r.advanced > 5, "しばらく撃つと少し前へ出る（射程の外で止まり続けない）", r);
  // 4-2. 盾の守り：盾兵の近くの後衛は受けるダメージが減る。貫通弾・八方斬撃（cover）は抜ける。盾兵が倒れると守りは消える
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state,
      K = WD_DEBUG.combat;
    S().enemies.length = 0;
    const lead = WD_DEBUG.addEnemy({ d: 300, hp: 9999, kind: "knight", behavior: "tate", armor: 0 });
    const mk = () => WD_DEBUG.addEnemy({ d: 270, hp: 9999, kind: "dragon", behavior: "teppo", armor: 0, leader: lead, followGap: 30 });
    const a = mk(),
      b = mk(),
      solo = WD_DEBUG.addEnemy({ d: 270, hp: 9999, kind: "dragon", behavior: "teppo", armor: 0 });
    const hit = (e, o) => {
      const h = e.hp;
      K.damage(e, 100, o);
      return h - e.hp;
    };
    const plain = hit(solo, {}),
      covered = hit(a, {}),
      pierced = hit(b, { pierceCover: true });
    lead.hp = 0;
    const after = hit(a, {});
    return { plain, covered, pierced, after, mul: K.behaviors.tate.cover.mul };
  });
  check(Math.abs(r.covered / r.plain - r.mul) < 1e-6, "盾兵に守られた鉄砲足軽は受けるダメージが減る（×0.4）", r);
  check(Math.abs(r.pierced - r.plain) < 1e-6, "貫通弾・八方斬撃（盾を抜ける型）は守りを無視する", r);
  check(Math.abs(r.after - r.plain) < 1e-6, "盾兵が倒れると守りは消える", r);
  // 4-3. 後衛は盾兵を追い越さない：盾兵が足止めされている間、後ろで待つ
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state;
    S().enemies.length = 0;
    const lead = WD_DEBUG.addEnemy({ d: 300, hp: 9999, kind: "knight", behavior: "tate", speed: 0 });
    const f = WD_DEBUG.addEnemy({ d: 200, hp: 9999, kind: "dragon", behavior: "teppo", speed: 80, leader: lead, followGap: 34 });
    for (let i = 0; i < 60; i++) WD_DEBUG.step(0.05);
    const gap1 = lead.d - f.d;
    lead.hp = 0;
    lead.gone = true;
    const d = f.d;
    for (let i = 0; i < 20; i++) WD_DEBUG.step(0.05);
    return { gap1, gap: 34, freed: f.d - d };
  });
  check(r.gap1 >= r.gap - 2 && r.gap1 <= r.gap + 4, "鉄砲足軽は盾兵の後ろ（間隔34）で待つ", r);
  check(r.freed > 10, "盾兵が倒れると後衛が前へ出る", r);

  // 5. 3つの技の当たる範囲
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat,
      E = (x, y) => ({ x, y, r: 12, hp: 1 }),
      ids = (rays, list) => rays.map((ray) => ray.hits.map((e) => list.indexOf(e)));
    const o = { x: 0, y: 0 };
    const L1 = [E(100, 0), E(100, 40), E(100, -40), E(100, 200), E(-100, 0)];
    const L2 = Array.from({ length: 8 }, (_, i) => E(50 + i * 50, 0)).concat([E(100, 80)]);
    const L3 = Array.from({ length: 8 }, (_, i) => E(Math.cos((i * Math.PI) / 4) * 80, Math.sin((i * Math.PI) / 4) * 80)).concat([E(300, 0)]);
    return {
      three: ids(K.resolve(o, 0, "threeWay", L1, 150), L1),
      pierce: ids(K.resolve(o, 0, "pierce", L2), L2),
      eight: ids(K.resolve(o, 0, "eightSlash", L3), L3),
      eightOugi: ids(K.resolve(o, 0, "eightSlashOugi", L3), L3),
      threeOugi: K.resolve(o, 0, "threeWayOugi", L1, 150).length,
    };
  });
  check(JSON.stringify(r.three.map((h) => h.sort())) === JSON.stringify([[2], [0], [1]]), "三方撃ち：前方3方向に1体ずつ（後ろ・遠くには当たらない）", r.three);
  check(r.pierce[0].length === 6 && r.pierce[0].every((i, k) => i === k), "貫通弾：1本の直線で近い順に6体まで貫く（直線から外れた敵には当たらない）", r.pierce);
  check(r.eight.length === 8 && r.eight.every((h, i) => h.length === 1 && h[0] === i), "八方斬撃：8方向すべてに当たる（遠くには届かない）", r.eight);
  check(r.eightOugi.flat().includes(8) && r.threeOugi === 9, "奥義は同じ型をもっと遠く・多く（八方天翔斬は遠くまで、千本桜は9方向）", r);

  // 6. 演出：通常の技は小さく、奥義は技名の帯・閃光・画面の振動・衝撃波。複数を倒すと連続撃破。演出の数には上限
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state,
      K = WD_DEBUG.combat;
    S().enemies.length = 0;
    const q = S().squads[0],
      from = { x: q.x, y: q.y };
    const ring = Array.from({ length: 8 }, (_, i) => WD_DEBUG.addEnemy({ d: 0, hp: 5, kind: "goblin" }));
    ring.forEach((e, i) => Object.assign(e, { x: q.x + Math.cos((i * Math.PI) / 4) * 70, y: q.y - 18 + Math.sin((i * Math.PI) / 4) * 70 }));
    const before = K.stats().multiKill;
    const res = K.apply("eightSlash", from, ring[0], 999);
    const normalFx = K.fx();
    WD_DEBUG.step(1.5);
    K.ougiFx("奥義・八方天翔斬", "槍兵#1");
    WD_DEBUG.addEnemy({ d: 600, hp: 9999 });
    K.apply("eightSlashOugi", from, { x: q.x + 50, y: q.y }, 1);
    const ougiFx = K.fx();
    WD_DEBUG.heroApi.draw();
    K.apply("pierce", from, { x: q.x - 100, y: q.y }, 1);
    const trails = K.fx().trails;
    for (let i = 0; i < 80; i++) K.apply(i % 2 ? "eightSlashOugi" : "threeWayOugi", from, { x: q.x - 100, y: q.y }, 1);
    WD_DEBUG.heroApi.draw();
    const cap = { effects: S().effects ? S().effects.length : K.fx().kinds.length, shots: S().shots ? S().shots.length : -1 };
    WD_DEBUG.step(3);
    return { killed: res.killed.length, multi: K.stats().multiKill - before, normalFx, ougiFx, trails, cap, end: K.fx() };
  });
  check(r.killed === 8 && r.multi === 1 && r.normalFx.kinds.includes("cboom") && r.normalFx.kinds.includes("ctext"), "複数を倒すと順に爆発し「N体撃破！」", r);
  check(r.normalFx.kinds.includes("cwave") && !r.normalFx.kinds.includes("cshock") && !r.normalFx.banner, "通常の八方斬撃：斬撃波（技名の帯・衝撃波は出ない）", r.normalFx);
  check(r.ougiFx.banner && r.ougiFx.banner.name === "奥義・八方天翔斬" && r.ougiFx.flash > 0 && r.ougiFx.shake > 0 && r.ougiFx.kinds.includes("cshock"), "奥義：技名の帯・白い閃光・画面の振動・衝撃波", r.ougiFx);
  check(r.trails >= 1, "貫通弾は光の軌跡を残す", r);
  check(r.cap.effects <= 80 && r.cap.shots <= 160, "技を続けて使っても演出の数は上限まで（effects 80・shots 160）", r.cap);
  check(!r.end.banner && r.end.shake === 0 && (await p.evaluate(() => document.getElementById("game").style.transform)) === "", "演出は時間で消え、画面の振動も元に戻る", r.end);

  // 7. 実際の戦い：兵士が技と奥義を使う（戦闘は止まらない）
  await c.close();
  ({ c, p } = await open({ seed: 3, query: "?debug&proto=combat" }));
  const trainOn = await play(p, { steps: 2400, train: true });
  const pat = trainOn.stats.patterns;
  check(trainOn.behaviors.includes("tate") && trainOn.behaviors.includes("teppo"), "修練場（試作）に盾兵・鉄砲足軽が出る", trainOn.behaviors);
  check(pat.eightSlash > 0 && pat.threeWay > 0 && pat.pierce > 0, "槍兵・足軽は八方斬撃、弓兵は三方撃ち、鉄砲兵は貫通弾を使う", pat);
  check(trainOn.stats.ougi === 0 && !Object.keys(pat).some((k) => k.endsWith("Ougi")), "奥義ゲージは廃止：長く戦っても奥義は自動で出ない（v106.1）", trainOn.stats);
  r = await p.evaluate((k) => {
    const raw = localStorage.getItem(k) || "";
    return { proto: /proto/i.test(raw), on: WD_DEBUG.combat.on() };
  }, SKEY);
  check(!r.proto, "試作の技の回数などは兵士の保存データに入れない", r);
  await p.evaluate(() => WD_DEBUG.trainingApi.endTraining("retreat"));
  check(!(await p.evaluate(() => WD_DEBUG.combat.on())), "修練場を終えると試作の戦闘はオフ");
  await c.close();

  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
