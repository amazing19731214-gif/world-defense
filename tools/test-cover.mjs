import assert from "node:assert/strict";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
try {
  const { p } = await H.setup();
  await p.evaluate(() => {
    const D = WD_DEBUG,
      [t, s] = D.state().soldiers;
    s.chronicle.meleePoints = 10;
    D.squadApi.saveRoster();
    s.insight.equipped = ["in_history_cover"];
    D.squadApi.saveRoster();
    D.state().squads[0].state = "deployed";
  });
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0],
      ts = Q.soldierStats(t),
      ss = Q.soldierStats(s);
    t.hp = ts.maxHp * 0.29;
    s.hp = ss.maxHp;
    const a = t.hp,
      b = s.hp;
    Q.damageSquad(q, 20, false, "goblin");
    return {
      t: a - t.hp,
      s: b - s.hp,
      te: (14 * 30) / (30 + ts.def),
      se: ((6 * 30) / (30 + ss.def)) * 0.97,
      c: s.chronicle.covered,
      cd: D.insightApi.evolutionState(s).ready.chronicleCover,
    };
  });
  check(
    Math.abs(r.t - r.te) < 1e-8 && Math.abs(r.s - r.se) < 1e-8 && r.c === 1,
    "実際の防衛で通常攻撃30%を前衛の防御で引き受ける",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0];
    const before = s.hp;
    Q.damageSquad(q, 20, true, "arrow");
    return { same: s.hp === before, c: s.chronicle.covered };
  });
  check(r.same && r.c === 1, "12秒の再使用待ちで連続発動しない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0];
    D.insightApi.evolutionState(s).ready.chronicleCover = 0;
    const before = s.hp;
    Q.damageSquad(q, 20, true, "blast");
    return s.hp === before;
  });
  check(r, "範囲・特殊攻撃をかばわない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      [t, s] = D.state().soldiers;
    A.finish(s, true);
    const first = s.chronicle.coverWins;
    A.finish(s, true);
    Q.saveRoster();
    return { first, again: s.chronicle.coverWins };
  });
  check(r.first === 1 && r.again === 1, "かばって勝利生還した戦闘を1回だけ記録");
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[1].chronicle.coverWins === 1),
    "かばうの実績を再読込で保持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[1];
    s.chronicle.coverWins = 3;
    Q.saveRoster();
    return s.chronicle.honors.includes("cover");
  });
  check(r, "3戦のかばう勝利生還で仲間の盾を獲得");
  await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi;
    Q.refreshSiege();
    Q.setTarget("mikawa_okazaki");
    Q.startBattle();
  });
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      B = Q.battle(),
      g = B.groups[0],
      [t, s] = g.list;
    s.insight.equipped = ["in_history_cover"];
    t.hp = Q.battleStats(g, t).maxHp * 0.2;
    s.hp = Q.battleStats(g, s).maxHp;
    const before = s.hp,
      old = s.chronicle.covered;
    Q.battleHurt(g, 20, false, "goblin", t);
    return { hit: s.hp < before, c: s.chronicle.covered === old + 1 };
  });
  check(r.hit && r.c, "実際の攻城の被弾でもかばうが発動");
  await p.evaluate(() => WD_DEBUG.squadApi.endBattle("retreat"));
  const f = await H.setup();
  r = await f.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0];
    s.chronicle.meleePoints = 10;
    A.evaluate(s);
    s.insight.equipped = ["in_history_cover"];
    t.hp = Q.soldierStats(t).maxHp * 0.2;
    const before = s.hp;
    Q.damageSquad(q, 20, false, "goblin");
    return { same: s.hp === before, c: s.chronicle.covered };
  });
  check(r.same && r.c === 0, "未保存のかばう習得は戦闘効果を出さない");
  const low = await H.setup();
  r = await low.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0];
    s.chronicle.meleePoints = 10;
    Q.saveRoster();
    s.insight.equipped = ["in_history_cover"];
    Q.saveRoster();
    s.hp = Q.soldierStats(s).maxHp * 0.49;
    t.hp = Q.soldierStats(t).maxHp * 0.2;
    const before = s.hp;
    Q.damageSquad(q, 20, false, "goblin");
    return s.hp === before;
  });
  check(r, "自身HP50%未満ではかばわない");
  const death = await H.setup();
  r = await death.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0];
    s.chronicle.meleePoints = 10;
    Q.saveRoster();
    s.insight.equipped = ["in_history_cover"];
    Q.saveRoster();
    s.hp = Q.soldierStats(s).maxHp;
    t.hp = Q.soldierStats(t).maxHp * 0.2;
    Q.damageSquad(q, 1e9, false, "goblin");
    return !s.alive && !t.alive;
  });
  check(r, "引き受けた兵士も致命傷で戦死し無敵にならない");

  const chain = await H.setup({
    seq: 3,
    squadSeq: 1,
    squads: [{ id: 1, type: "ashigaru", slot: 0 }],
    soldiers: [1, 2, 3].map((id) => ({
      id,
      type: "ashigaru",
      job: "ashigaru",
      jobs: ["ashigaru"],
      squadId: 1,
      level: 100,
      bestLevel: 100,
      skills: [],
      learned: [],
    })),
    fallen: [],
  });
  r = await chain.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, a, b] = D.state().soldiers,
      q = D.state().squads[0];
    for (const s of [a, b]) {
      s.chronicle.meleePoints = 10;
    }
    Q.saveRoster();
    for (const s of [a, b]) s.insight.equipped = ["in_history_cover"];
    Q.saveRoster();
    t.hp = Q.soldierStats(t).maxHp * 0.2;
    const before = b.hp;
    Q.damageSquad(q, 1e9, false, "goblin");
    return !a.alive && b.alive && b.hp === before && b.chronicle.covered === 0;
  });
  check(r, "複数のかばう持ちでも1人だけ・再転送しない");
  const train = await H.setup();
  r = await train.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [t, s] = D.state().soldiers,
      q = D.state().squads[0];
    s.chronicle.meleePoints = 10;
    Q.saveRoster();
    s.insight.equipped = ["in_history_cover"];
    Q.saveRoster();
    q.state = "deployed";
    q.x = 620;
    q.y = 390;
    const err = D.trainingApi.startTraining("beginner");
    document.getElementById("start").click();
    t.hp = Q.soldierStats(t).maxHp * 0.2;
    const before = s.hp;
    Q.damageSquad(q, 20, false, "goblin", { kind: "goblin", lv: 10 });
    return !err && s.hp < before && s.chronicle.covered === 1;
  });
  check(r, "修練場の実出撃と敵レベル付き被弾でもかばう");
  check(H.errors.length === 0, "JavaScript例外なし");
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
