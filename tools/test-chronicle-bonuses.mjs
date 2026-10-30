import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
const seed = {
  seq: 2,
  squadSeq: 1,
  squads: [{ id: 1, type: "ashigaru", slot: 0 }],
  soldiers: [1, 2].map((id) => ({
    id,
    type: "ashigaru",
    job: "ashigaru",
    jobs: ["ashigaru"],
    squadId: 1,
    level: 100,
    bestLevel: 100,
    name: "兵" + id,
    kills: 0,
    wavesSurvived: 0,
    skills: [],
    learned: [],
  })),
  fallen: [],
};
try {
  const { p } = await H.setup(seed);
  for (const [key, every, stat, amount] of [
    ["waves", 1, "hp", 1],
    ["kills", 100, "atk", 1],
    ["bossKills", 10, "atk", 1],
    ["bossAssists", 100, "speed", 0.001],
    ["meleeHits", 1000, "def", 1],
    ["rangedHits", 2000, "def", 1],
    ["survived30", 100, "def", 1],
    ["survived10", 50, "def", 1],
    ["survivedSingle", 100, "evade", 0.001],
  ]) {
    const r = await p.evaluate(
      ({ key, every, stat }) => {
        const D = WD_DEBUG,
          Q = D.squadApi,
          A = D.chronicleApi,
          s = D.state().soldiers[0],
          values = [];
        for (const count of [every - 1, every, every * 2]) {
          s.kills = s.wavesSurvived = 0;
          for (const k of [
            "bossKills",
            "bossAssists",
            "meleeHits",
            "rangedHits",
            "survived30",
            "survived10",
            "survivedSingle",
          ])
            s.chronicle[k] = 0;
          if (key === "waves") s.wavesSurvived = count;
          else if (key === "kills") s.kills = count;
          else s.chronicle[key] = count;
          Q.saveRoster();
          values.push(A.warBonus(s)[stat]);
        }
        return values;
      },
      { key, every, stat },
    );
    check(r[0] === 0, key + " 条件直前は補正0");
    check(Math.abs(r[1] - amount) < 1e-12, key + " 条件達成で指定量");
    check(Math.abs(r[2] - 2 * amount) < 1e-12, key + " 累計の区切りごとに加算");
  }
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      s = D.state().soldiers[0];
    s.kills = 19700;
    s.wavesSurvived = 1640;
    Object.assign(s.chronicle, {
      bossKills: 14,
      bossAssists: 38,
      meleeHits: 619,
      rangedHits: 1128,
      survived30: 0,
      survived10: 0,
      survivedSingle: 0,
    });
    Q.saveRoster();
    return A.warBonus(s);
  });
  check(
    r.hp === 1640 && r.atk === 198 && r.def === 0 && r.speed === 0 && r.evade === 0,
    "提示された実績例：HP1640・攻撃198、端数の切上げなし",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      s = D.state().soldiers[0];
    s.kills = 10000;
    s.wavesSurvived = 1000;
    Object.assign(s.chronicle, {
      bossKills: 100,
      bossAssists: 1000,
      meleeHits: 10000,
      rangedHits: 20000,
      survived30: 100,
      survived10: 50,
      survivedSingle: 100,
    });
    Q.saveRoster();
    s.insight.equipped = [];
    Q.saveRoster();
    const b = A.warBonus(s),
      clone = { ...s, chronicle: { ...s.chronicle, life: "control:unconfirmed" } },
      base = Q.soldierStats(clone),
      actual = Q.soldierStats(s);
    return {
      b,
      hp: actual.maxHp - base.maxHp,
      atk: actual.atk - base.atk,
      def: actual.def - base.def,
      rate: actual.rate / base.rate,
      range: actual.range === base.range,
    };
  });
  check(
    r.b.atk === 110 &&
      r.b.def === 22 &&
      r.hp === 1000 &&
      Math.abs(r.atk - 110) < 1e-8 &&
      Math.abs(r.def - 22) < 1e-8,
    "実際の能力計算へHP・攻撃・防御を固定加算",
  );
  check(Math.abs(r.rate - 1 / 1.01) < 1e-9 && r.range, "支援速度＋1%は間隔÷1.01、射程は変えない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      base = (x) => Q.soldierStats({ ...x, chronicle: { ...x.chronicle, life: "control:unconfirmed" } });
    s.legend = { stats: [{ k: "hpPct", v: 25 }], on: 0, abil: [] };
    Q.saveRoster();
    const hp = Q.soldierStats(s).maxHp - base(s).maxHp;
    s.legend = { stats: [{ k: "atkPct", v: 15 }], on: 0, abil: [] };
    Q.saveRoster();
    return { hp, atk: Q.soldierStats(s).atk - base(s).atk };
  });
  check(r.hp === 1000 && Math.abs(r.atk - 110) < 1e-8, "伝説の割合能力で戦歴のHP・攻撃固定値を増幅しない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      s = D.state().soldiers[0],
      hp = s.hp;
    s.wavesSurvived++;
    Q.saveRoster();
    return { hp: s.hp === hp, before: A.warBonus(s).hp, shown: A.warBlock(s) };
  });
  check(
    r.hp && r.before === 1001 && r.shown.includes("＋10%"),
    "最大HP増加で現在HPを回復せず、詳細に上限を表示",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    s.chronicle.bossAssists = 1e12;
    s.chronicle.survivedSingle = 1e12;
    Q.saveRoster();
    s.insight.equipped = [];
    const b = A.warBonus(s),
      random = Math.random;
    Math.random = () => 0.049;
    const first = D.jobApi.evadeHit(s, 10),
      again = D.jobApi.evadeHit(s, 11);
    Math.random = () => 0.051;
    const over = D.jobApi.evadeHit(s, 13);
    Math.random = random;
    return { b, first, again, over };
  });
  check(r.b.speed === 0.1 && r.b.evade === 0.05, "速度10%・戦歴回避5ポイントを上限とする");
  check(r.first && !r.again && !r.over, "戦歴回避は発動確率5%として実判定し2秒の制限を維持");
  await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    s.chronicle.bossAssists = 1000;
    s.chronicle.survivedSingle = 100;
    D.squadApi.saveRoster();
  });
  const stable = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    const before = JSON.stringify(A.warBonus(s));
    const err = D.jobApi.changeJob(s, "medic");
    return { err, same: JSON.stringify(A.warBonus(s)) === before };
  });
  check(!stable.err && stable.same, "転職で戦歴を再加算・消失しない");
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.chronicleApi.warBonus(WD_DEBUG.state().soldiers[0]).hp === 1001),
    "再読込でも生存Wと補正を保持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0],
      life = s.chronicle.life,
      before = A.warBonus(s);
    s.hp = 0;
    Q.killSoldier(s, q);
    const snap = Q.soldierSave().fallen.find((f) => f.id === s.id)?.snap,
      err = D.gemApi.reviveFallen(s.id, q),
      back = D.state().soldiers.find((x) => x.alive && x.chronicle.life === life);
    return {
      err,
      snap: snap?.wavesSurvived,
      waves: back?.wavesSurvived,
      same: JSON.stringify(A.warBonus(back)) === JSON.stringify(before),
      full: back?.hp === Q.soldierStats(back).maxHp,
    };
  });
  check(
    !r.err && r.snap === 1001 && r.waves === 1001 && r.same && r.full,
    "実際の戦死・復活で生存Wと戦歴補正を引継ぎ、正式な復活は全回復",
  );
  const failure = await H.setup(seed);
  r = await failure.p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    const set = Storage.prototype.setItem;
    s.kills = 100;
    s.wavesSurvived = 50;
    s.chronicle.meleeHits = 1000;
    Storage.prototype.setItem = function () {
      throw Error("fault");
    };
    Q.saveRoster();
    const failed = A.warBonus(s);
    Storage.prototype.setItem = set;
    Q.saveRoster();
    return { failed, retry: A.warBonus(s) };
  });
  check(
    r.failed.hp === 0 &&
      r.failed.atk === 0 &&
      r.failed.def === 0 &&
      r.retry.hp === 50 &&
      r.retry.atk === 1 &&
      r.retry.def === 1,
    "保存失敗では補正なし・保存再試行成功後に一度だけ反映",
  );
  await failure.p.reload();
  check(
    await failure.p.evaluate(() => WD_DEBUG.chronicleApi.warBonus(WD_DEBUG.state().soldiers[0]).hp === 50),
    "保存再試行後の再読込でボーナスを保持",
  );

  const wal = await H.setup(seed);
  r = await wal.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      s = D.state().soldiers[0],
      set = Storage.prototype.setItem;
    s.wavesSurvived = 80;
    s.kills = 500;
    Storage.prototype.setItem = function (k, v) {
      if (k === "worldDefense.soldiers.v1") throw Error("leaf fault");
      return set.call(this, k, v);
    };
    const saved = D.defenseApi.save(),
      b = A.warBonus(s),
      hasLog = !!localStorage.getItem("worldDefense.bookTransaction.v1");
    Storage.prototype.setItem = set;
    return { saved, hp: b.hp, atk: b.atk, hasLog };
  });
  check(
    r.saved && r.hp === 80 && r.atk === 5 && r.hasLog,
    "確定ログ成功・兵士ファイル転記失敗でも保存済み補正として反映",
  );
  await wal.p.reload();
  check(
    await wal.p.evaluate(() => WD_DEBUG.chronicleApi.warBonus(WD_DEBUG.state().soldiers[0]).hp === 80),
    "確定ログから復旧しボーナスを二重加算しない",
  );
  const win = await H.setup(seed);
  r = await win.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0];
    q.state = "deployed";
    q.x = 620;
    q.y = 390;
    document.getElementById("start").click();
    D.stopSpawning();
    D.state().enemies.length = 0;
    D.step(0.1);
    const first = A.warBonus(s).hp;
    Q.squadsWaveEnd();
    Q.saveRoster();
    return { first, again: A.warBonus(s).hp };
  });
  check(r.first === 1 && r.again === 1, "実際のWAVE勝利でHP+1・終了処理の再実行で増殖しない");
  for (const mode of ["training", "siege", "secret"]) {
    const f = await H.setup(seed);
    r = await f.p.evaluate((mode) => {
      const D = WD_DEBUG,
        Q = D.squadApi,
        A = D.chronicleApi,
        s = D.state().soldiers[0],
        q = D.state().squads[0];
      s.kills = 1000;
      s.wavesSurvived = 100;
      s.chronicle.meleeHits = 1000;
      Q.saveRoster();
      s.insight.equipped = [];
      const b = A.warBonus(s);
      let err, actual, base;
      if (mode === "training") {
        q.state = "deployed";
        q.x = 620;
        q.y = 390;
        err = D.trainingApi.startTraining("beginner");
        document.getElementById("start").click();
        actual = Q.soldierStats(s);
        base = Q.soldierStats({ ...s, chronicle: { ...s.chronicle, life: "no:bonus" } });
      } else {
        Q.refreshSiege();
        err = mode === "secret" ? Q.setBossTarget("orochi") : Q.setTarget(Q.PROVINCES.owari.castle);
        if (!err) err = Q.startBattle();
        const B = Q.battle();
        if (!B) return { err: "no battle " + err };
        const g = B.groups[0];
        g.hero = "shingen";
        g.rally = 1;
        actual = Q.battleStats(g, s);
        base = Q.battleStats(g, { ...s, chronicle: { ...s.chronicle, life: "no:bonus" } });
      }
      return {
        err,
        hp: actual.maxHp - base.maxHp,
        atk: actual.atk - base.atk,
        def: actual.def - base.def,
        b,
      };
    }, mode);
    if (r.err) console.log("MODE ERROR", mode, r.err);
    check(
      !r.err &&
        Math.abs(r.hp - 100) < 1e-8 &&
        Math.abs(r.atk - r.b.atk) < 1e-8 &&
        Math.abs(r.def - r.b.def) < 1e-8,
      mode + " 実戦の能力計算で同じ固定値、武将・鼓舞で増幅しない",
    );
    await f.c.close();
  }
  const hero = await H.setup(seed);
  r = await hero.p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0];
    s.kills = 1000;
    s.wavesSurvived = 100;
    Q.saveRoster();
    Q.setHeroSoldier(s.id);
    const b = JSON.stringify(A.warBonus(s));
    s.hp = 0;
    Q.killSoldier(s, q);
    return { level: s.level, same: JSON.stringify(A.warBonus(s)) === b };
  });
  check(r.level === 1 && r.same, "主人公のLv1再出発でも生涯の戦歴補正を維持");
  await p.locator("#organize").click();
  await p.locator('[data-squad-filter="all"]').click();
  const grownId = await p.evaluate(
    () => WD_DEBUG.state().soldiers.find((s) => s.alive && WD_DEBUG.chronicleApi.warBonus(s).hp === 1001).id,
  );
  await p.locator('[data-formation-soldier="' + grownId + '"]').click();
  await p.locator(".chronicle-war-bonus summary").first().click();
  check(
    (await p.locator(".chronicle-war-bonus").innerText()).includes("最大HP＋1,001"),
    "編成の実操作から開いた詳細に保存済みの戦歴補正を表示",
  );
  fs.mkdirSync("/workspace/chronicle-results/s11/screenshots", { recursive: true });
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 900 });
    check(
      await p.evaluate(() => {
        const el = document.querySelector(".chronicle-war-bonus");
        return (
          document.documentElement.scrollWidth <= innerWidth &&
          el.scrollWidth <= el.clientWidth + 1 &&
          el.innerText.includes("討伐数（従来分を含む累計）")
        );
      }),
      "戦歴ボーナスの説明が横にはみ出さない " + width,
    );
    if ([375, 1280].includes(width))
      await p.screenshot({ path: "/workspace/chronicle-results/s11/screenshots/bonus-" + width + ".png" });
  }
  check(H.errors.length === 0, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
