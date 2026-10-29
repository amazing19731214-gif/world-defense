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
      s = D.state().soldiers[1],
      q = D.state().squads[0];
    Q.saveRoster();
    const life = s.chronicle.life;
    s.hp = 0;
    Q.killSoldier(s, q);
    const err = D.gemApi.reviveFallen(s.id, q),
      back = D.state().soldiers.find((x) => x.alive && x.chronicle.life === life);
    return {
      err,
      id: back?.id,
      life,
      learned: back?.insight.known.includes("in_history_revival"),
      charge: back?.chronicle.revivalCharge,
    };
  });
  check(!r.err && r.learned && r.charge, "実際の復活の書で黄泉返りと出撃1回分の使用権を獲得");
  const id = r.id;
  r = await p.evaluate((id) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers.find((x) => x.id === id);
    s.insight.equipped = [];
    Q.saveRoster();
    const none = A.deploy(s);
    s.insight.equipped = ["in_history_revival"];
    Q.saveRoster();
    const q = D.state().squads[0];
    q.state = "deployed";
    q.x = 620;
    q.y = 390;
    document.getElementById("start").click();
    return {
      none,
      playing: D.state().playing,
      guard: A.guard(s, false, "goblin"),
      charge: s.chronicle.revivalCharge,
      saved: Q.soldierSave().soldiers.find((x) => x.id === id).chronicle.revivalCharge,
    };
  }, id);
  check(
    !r.none && r.playing && r.guard === 0.85 && !r.charge && !r.saved,
    "有効にした実際の出撃でだけ使用権を先に保存し15%軽減",
  );
  r = await p.evaluate((id) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers.find((x) => x.id === id);
    D.step(7.9);
    const first = A.guard(s, false, "goblin");
    D.step(0.2);
    return { first, after: A.guard(s, false, "goblin"), again: A.deploy(s) };
  }, id);
  check(r.first === 0.85 && r.after === 1 && !r.again, "8秒で終了し同じ復活から再発動しない");
  await p.reload();
  check(
    await p.evaluate((id) => {
      const D = WD_DEBUG,
        s = D.state().soldiers.find((x) => x.id === id);
      return (
        !s.chronicle.revivalCharge &&
        !D.chronicleApi.deploy(s) &&
        D.chronicleApi.guard(s, false, "goblin") === 1
      );
    }, id),
    "チェックポイントへの巻き戻しでも黄泉返りを再使用しない",
  );
  r = await p.evaluate((id) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers.find((x) => x.id === id),
      q = D.state().squads[0],
      life = s.chronicle.life;
    s.hp = 0;
    Q.killSoldier(s, q);
    const err = D.gemApi.reviveFallen(s.id, q),
      back = D.state().soldiers.find((x) => x.alive && x.chronicle.life === life);
    return { err, id: back?.id, revivals: back?.chronicle.revivals, charge: back?.chronicle.revivalCharge };
  }, id);
  check(!r.err && r.revivals === 2 && r.charge, "もう一度正式に復活すると使用権を1回分だけ再取得");
  const secondId = r.id;
  r = await p.evaluate((id) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers.find((x) => x.id === id);
    s.insight.equipped = ["in_history_revival"];
    D.squadApi.saveRoster();
    window.oldSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "worldDefense.bookTransaction.v1") throw Error("fault");
      return oldSet.call(this, k, v);
    };
    const active = A.deploy(s),
      charge = s.chronicle.revivalCharge,
      guard = A.guard(s, false, "goblin");
    Storage.prototype.setItem = oldSet;
    return { active, charge, guard, retry: A.deploy(s) };
  }, secondId);
  check(
    !r.active && r.charge && r.guard === 1 && r.retry,
    "使用権の保存失敗では軽減を発動せず取り消して再試行できる",
  );
  r = await p.evaluate((id) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      L = D.legendApi,
      s = D.state().soldiers.find((x) => x.id === id),
      to = D.state().soldiers.find((x) => x.alive && x !== s),
      pick = L.inheritables(s).findIndex((x) => x.type === "insight" && x.id === "in_history_revival");
    const err = L.retireSoldier(s.id, pick),
      book = D.forgeApi.save().insightBooks.find((x) => x.id === "in_history_revival"),
      use = book ? D.insightApi.useBook(to, book.uid) : "missing";
    return { err, use, id: to.id, revivals: to.chronicle.revivals, active: A.deploy(to) };
  }, secondId);
  check(
    !r.err && !r.use && r.revivals === 0 && !r.active,
    "継承は技だけで受取兵に復活実績や使用権を複製しない",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers.find((x) => x.alive);
    const old = A.goals(s),
      err = D.jobApi.changeJob(s, "medic"),
      heal = A.goals(s);
    return { old, err, heal };
  });
  check(
    !r.err && /討伐/.test(r.old) && /実回復量/.test(r.heal) && /救命/.test(r.heal),
    "職業に合わせて次の戦歴目標を表示",
  );
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    await p.evaluate(() => WD_DEBUG.chronicleApi.open("live"));
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      "幅" + width + "で戦歴・適性・称号が横にはみ出さない",
    );
  }
  await c.close();
  for (const mode of ["siege", "training"]) {
    const f = await H.setup();
    r = await f.p.evaluate((mode) => {
      const D = WD_DEBUG,
        A = D.chronicleApi,
        Q = D.squadApi,
        s = D.state().soldiers[1],
        q = D.state().squads[0],
        life = s.chronicle.life;
      Q.saveRoster();
      s.hp = 0;
      Q.killSoldier(s, q);
      D.gemApi.reviveFallen(s.id, q);
      const back = D.state().soldiers.find((x) => x.alive && x.chronicle.life === life);
      back.insight.equipped = ["in_history_revival"];
      Q.saveRoster();
      let error;
      if (mode === "siege") {
        Q.refreshSiege();
        Q.setTarget("mikawa_okazaki");
        error = Q.startBattle();
        D.step(0.1);
        const B = Q.battle(),
          g = B.groups[0],
          before = back.hp,
          st = Q.battleStats(g, back);
        Q.bossBlast(g, 100, "thunder");
        return {
          error,
          charge: back.chronicle.revivalCharge,
          guard: A.guard(back, true, "thunder"),
          actual: before - back.hp,
          expected: ((100 * 30) / (30 + st.def)) * 0.85,
        };
      }
      q.state = "deployed";
      q.x = 620;
      q.y = 390;
      error = D.trainingApi.startTraining("beginner");
      document.getElementById("start").click();
      return { error, charge: back.chronicle.revivalCharge, guard: A.guard(back, false, "goblin") };
    }, mode);
    check(
      !r.error &&
        !r.charge &&
        r.guard === 0.85 &&
        (mode !== "siege" || Math.abs(r.actual - r.expected) < 1e-8),
      mode === "siege"
        ? "攻城の実出撃・秘境共通の被弾経路で15%軽減"
        : "修練場の実出撃でも使用権を消費して軽減",
    );
    await f.c.close();
  }
  const seed = {
    seq: 80,
    squadSeq: 8,
    squads: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, type: "ashigaru", slot: i })),
    soldiers: Array.from({ length: 80 }, (_, i) => ({
      id: i + 1,
      type: "ashigaru",
      job: "ashigaru",
      jobs: ["ashigaru"],
      squadId: 1 + Math.floor(i / 10),
      level: 100,
      bestLevel: 100,
      skills: [],
      learned: [],
      chronicle: { life: "mass:" + i, revivals: 1, revivalCharge: true },
      insight: {
        seed: i + 1,
        evaluatedMaxLevel: 100,
        known: ["in_history_revival"],
        equipped: ["in_history_revival"],
      },
    })),
    fallen: [],
  };
  const mass = await H.setup(seed);
  r = await mass.p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      old = Storage.prototype.setItem;
    let wal = 0,
      writes = 0;
    Storage.prototype.setItem = function (k, v) {
      if (k === "worldDefense.bookTransaction.v1") wal++;
      if (k === "worldDefense.soldiers.v1") writes++;
      return old.call(this, k, v);
    };
    const start = performance.now(),
      ok = A.deployMany(D.state().soldiers),
      ms = performance.now() - start;
    Storage.prototype.setItem = old;
    return {
      ok,
      ms,
      wal,
      writes,
      count: D.state().soldiers.filter((s) => !s.chronicle.revivalCharge).length,
      fx: D.legendApi.effects().filter((e) => e.kind === "evolution").length,
    };
  });
  check(
    r.ok && r.count === 80 && r.wal === 1 && r.writes === 1,
    "80人同時出撃でも使用権を1トランザクションで保存",
  );
  check(r.fx <= 24 && r.ms < 3000, "80人の演出数と処理時間を制限（" + Math.round(r.ms) + "ms）");
  await mass.c.close();
  check(H.errors.length === 0, "ブラウザJavaScriptエラーなし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
