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
  const { p, c } = await H.setup();
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    Object.assign(A.of(s), {
      kills: 1000,
      healed: 100000,
      rescues: 10,
      survived30: 3,
      survived10: 3,
      bossKills: 10,
      meleePoints: 150,
      rangedPoints: 150,
    });
    A.evaluate(s);
    const inactive = Object.keys(A.SKILLS).every((id) => !A.has(s, id));
    Q.saveRoster();
    return {
      inactive,
      known: s.insight.known.filter((id) => A.SKILLS[id]),
      slots: s.insight.equipped.length,
    };
  });
  check(
    r.inactive && r.known.length === 8 && r.slots === 2,
    "戦歴8技を習得し未保存時は効果なし・有効枠は2つ",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    s.insight.equipped = ["in_history_veteran", "in_history_bossHunter"];
    Q.saveRoster();
    const base = Q.soldierStats({ ...s, insight: { ...s.insight, equipped: [] } }).atk;
    return {
      ratio: Q.soldierStats(s).atk / base,
      guard: A.guard(s, false, "goblin"),
      special: A.guard(s, true, "thunder"),
      caps: [0, 10, 50, 150, 1e12].map(A.resistance),
    };
  });
  check(Math.abs(r.ratio - 1.1) < 1e-9, "確定討伐の攻撃補正は最大10%");
  check(r.guard === 0.9 && r.special === 1, "近接・遠距離熟達は最大10%、特殊攻撃は対象外");
  check(r.caps.join() === "0,0.03,0.06,0.1,0.1", "耐性は上位置換で無限加算しない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0];
    q.state = "deployed";
    const st = Q.soldierStats(s);
    s.hp = st.maxHp;
    const before = s.hp;
    Q.damageSquad(q, 100, false, "goblin", { kind: "goblin" });
    return { actual: before - s.hp, expected: ((100 * 30) / (30 + st.def)) * 0.9 };
  });
  check(Math.abs(r.actual - r.expected) < 1e-8, "実際の防衛ダメージ計算へ耐性を適用");
  await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    s.insight.equipped = ["in_history_brace", "in_history_tenacity"];
    Q.saveRoster();
  });
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      max = Q.soldierStats(s).maxHp;
    s.hp = max * 0.2;
    A.damage(s, max * 0.8, max, false, "goblin");
    const first = A.guard(s, false, "goblin");
    const state = D.insightApi.evolutionState(s);
    state.chronicleBraceUntil = 0;
    s.hp = max * 0.2;
    A.damage(s, max * 0.8, max, false, "goblin");
    return { first, again: A.guard(s, false, "goblin") };
  });
  check(Math.abs(r.first - 0.81) < 1e-9 && r.again === 0.9, "踏ん張りは耐性と乗算し30秒待ちを守る");
  await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    s.insight.equipped = ["in_history_veteran", "in_history_bossHunter"];
    Q.saveRoster();
    Q.refreshSiege();
    Q.setTarget("mikawa_okazaki");
    Q.startBattle();
  });
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      B = Q.battle(),
      g = B.groups[0],
      s = g.list[0],
      e = B.garrison[0];
    const stats = Q.battleStats(g, s),
      base = Q.battleStats(g, { ...s, insight: { ...s.insight, equipped: [] } });
    e.kind = "boss";
    e.hp = 1e6;
    e.armor = 0;
    const before = e.hp;
    Q.battleHitGarrison(e, 100, s);
    const delta = before - e.hp;
    Q.endBattle("retreat");
    return { ratio: stats.atk / base.atk, delta };
  });
  check(
    Math.abs(r.ratio - 1.1) < 1e-9 && Math.abs(r.delta - 105) < 1e-8,
    "攻城の攻撃補正・対ボス5%を実際の計算に反映",
  );
  await p.reload();
  check(
    await p.evaluate(
      () =>
        WD_DEBUG.state().soldiers[0].insight.known.filter((id) => WD_DEBUG.chronicleApi.SKILLS[id]).length ===
        8,
    ),
    "8技の習得を再読込後も保持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      L = D.legendApi,
      s = D.state().soldiers[0],
      to = D.state().soldiers[1],
      idx = L.inheritables(s).findIndex((x) => x.type === "insight" && x.id === "in_history_veteran");
    const error = L.retireSoldier(s.id, idx),
      b = D.forgeApi.save().insightBooks.find((x) => x.id === "in_history_veteran");
    return { error, id: to.id, uid: b?.uid, first: b ? D.insightApi.useBook(to, b.uid) : "missing" };
  });
  check(!r.error && !r.first, "指導員から戦歴閃き1つを秘伝書として継承");
  await p.waitForTimeout(10);
  r = await p.evaluate(({ id, uid }) => {
    const D = WD_DEBUG,
      s = D.state().soldiers.find((x) => x.id === id),
      Q = D.squadApi;
    return {
      repeat: D.insightApi.useBook(s, uid),
      kills: s.chronicle.kills,
      ratio: Q.soldierStats(s).atk / Q.soldierStats({ ...s, insight: { ...s.insight, equipped: [] } }).atk,
    };
  }, r);
  check(r.repeat && r.kills === 0 && r.ratio === 1, "同じ秘伝書の二重使用を拒否し討伐実績は継承しない");
  await c.close();
  const heal = await H.setup();
  r = await heal.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [s, t] = D.state().soldiers;
    const error = D.jobApi.changeJob(s, "medic");
    s.chronicle.healed = 100000;
    s.chronicle.rescues = 10;
    t.chronicle.survived10 = 3;
    Q.saveRoster();
    return { error };
  });
  check(!r.error, "回復役への転職を維持");
  await heal.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [s, t] = D.state().soldiers;
    s.insight.equipped = ["in_history_healing", "in_history_rescue"];
    t.insight.equipped = ["in_history_tenacity"];
    Q.saveRoster();
    D.state().squads[0].state = "deployed";
  });
  r = await heal.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      [s, t] = D.state().soldiers,
      q = D.state().squads[0],
      st = Q.soldierStats(s),
      max = Q.soldierStats(t).maxHp;
    const base = Q.soldierStats({ ...s, insight: { ...s.insight, equipped: [] } }).heal;
    t.hp = max * 0.2;
    const before = t.hp;
    D.insightApi.defenseEvolution(s, q, t, "heal", 0.2, st);
    const first = t.hp - before;
    D.insightApi.defenseEvolution(s, q, t, "heal", 0.2, st);
    return {
      ratio: st.heal / base,
      first,
      expected: st.heal * 0.2 * 1.15,
      second: t.hp - before - first,
      record: s.chronicle.healed,
    };
  });
  check(Math.abs(r.ratio - 1.1) < 1e-9, "回復熟達は実回復量に応じ最大10%");
  check(
    Math.abs(r.first - r.expected) < 1e-8 && r.second === 0,
    "実戦アダプターで緊急救命と受ける回復15%を適用し連続発動を防止",
  );
  check(r.record > 100000, "追加回復も回復者の実回復量へ加算");
  await heal.c.close();
  const f = await H.setup();
  r = await f.p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    s.chronicle.kills = 1000;
    A.evaluate(s);
    s.insight.equipped = ["in_history_veteran"];
    Storage.prototype.setItem = function () {
      throw Error("fault");
    };
    Q.saveRoster();
    return {
      active: A.has(s, "in_history_veteran"),
      ratio: Q.soldierStats(s).atk / Q.soldierStats({ ...s, insight: { ...s.insight, equipped: [] } }).atk,
    };
  });
  check(!r.active && r.ratio === 1, "保存失敗で未確定の攻撃補正を使用できない");
  await f.c.close();
  check(H.errors.length === 0, "ブラウザJavaScriptエラーなし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
