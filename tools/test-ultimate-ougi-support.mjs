import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
import { autoSeed, beginAutoFight } from "./auto-ougi-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
function seed(job, type) {
  const d = autoSeed();
  d.heroId = 3;
  for (const s of d.soldiers) {
    s.type = type;
    s.job = job;
    s.jobs = [type, job];
    s.prof = { [job]: 1e7 };
    s.chronicle.healed = 50000;
    s.chronicle.ougiRescues = 10;
    s.chronicle.ougiGuardWins = 10;
  }
  return d;
}
try {
  for (const mode of ["defense", "battle", "field"]) {
    const { p, c } = await H.setup(seed("iron_cavalry", "cavalry"));
    await beginAutoFight(p, mode, "shugoKijin");
    const r = await p.evaluate((mode) => {
      const D = WD_DEBUG,
        A = D.autoOugiApi,
        ctx = A.context(window.autoTestMode),
        a = ctx.actors[0],
        target = ctx.friends[1],
        owner = a.unit?.sh || a.s,
        body = target.unit?.sh || target.s;
      body.hp = (target.unit?.max || target.stats().maxHp) * 0.4;
      A.timer(a.s).left = 0;
      A.tick(window.autoTestMode, 0.01);
      const beforeOwner = owner.ultimateWard.shield,
        beforeTarget = body.ultimateWard.shield;
      if (mode === "defense") D.squadApi.damageSquad(a.pos, 100, false, "goblin", window.autoTestEnemy, body);
      else if (mode === "battle")
        D.squadApi.battleHurt(a.pos, 100, false, "goblin", body, window.autoTestEnemy);
      else D.trial.hitUnit(target.unit, 100, false, window.autoTestEnemy);
      let redirected = 0;
      const left = D.ultimateOugiApi.cover(
        body,
        ctx.friends.map((m) => m.unit?.sh || m.s),
        100,
        (s, part) => {
          if (s === owner) redirected += part;
        },
      );
      const ownerUsed = owner.ultimateWard.shield < beforeOwner,
        targetUsed = body.ultimateWard.shield < beforeTarget;
      owner.alive = false;
      let afterDeath = 0;
      const unchanged = D.ultimateOugiApi.cover(body, [body, owner], 100, () => afterDeath++),
        absorb = D.ultimateOugiApi.absorb(body, 100);
      return { ownerUsed, targetUsed, left, redirected, unchanged, afterDeath, absorb };
    }, mode);
    check(r.ownerUsed && r.targetUsed, mode + "の実際の被弾処理で、鉄騎将と保護対象の盾がダメージを吸収");
    check(r.left === 70 && r.redirected === 30, mode + "で肩代わりは30%だけ、保護者へ1回渡す");
    check(
      r.unchanged === 100 && !r.afterDeath && r.absorb === 100,
      mode + "で発動者の戦死後は肩代わり・盾が終了",
    );
    await c.close();
  }
  {
    const { p, c } = await H.setup(seed("healing_master", "medic"));
    await beginAutoFight(p, "defense", "saiseiSeiiki");
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.autoOugiApi,
        ctx = A.context("defense"),
        a = ctx.actors[0],
        t = ctx.friends[1].s;
      t.hp = ctx.friends[1].stats().maxHp * 0.2;
      A.timer(a.s).left = 0;
      A.tick("defense", 0.01);
      const instant = t.hp,
        before = a.s.chronicle.healed;
      D.step(2);
      const later = t.hp;
      const recorded = a.s.chronicle.healed - before;
      const ward = t.ultimateWard;
      t.ultimateWard.until = -1;
      const expired = D.ultimateOugiApi.absorb(t, 100);
      return { instant, later, recorded, expired };
    });
    check(r.later > r.instant && r.recorded > 0, "医王は発動後もゲーム時間で継続回復し、実回復を記録");
    check(r.expired === 100, "効果時間が過ぎた医王の盾はダメージを軽減しない");
    await c.close();
  }
  {
    const { p, c } = await H.setup(seed("healing_master", "medic"));
    const before = await p.evaluate(() => {
      const D = WD_DEBUG;
      D.combat.ougi.setRoll(() => 0);
      const source = D.state().soldiers[0];
      D.combat.ougi.grant(1, "mumyouIssen");
      source.job = "sword_saint";
      D.combat.ougi.setHeir(1, { k: "mumyouIssen" });
      source.job = "healing_master";
      D.squadApi.saveRoster();
      const err = D.trial.start([1, 2, 3], { mode: "field", hero: 3, seed: 4242 });
      if (err) throw Error(err);
      D.trial.auto();
      D.trial.begin();
      const T = D.trial.live(),
        [s, t] = T.units;
      for (const u of T.units) u.cd = 1e9;
      t.hp = t.max * 0.5;
      D.chronicleApi.heal(s.sh, t.sh, t.max * 0.2, t.max);
      const isolated = s.src.chronicle.healed === 50000 && s.sh.chronicle.healed > 50000;
      window.finishedUltimateTrial = T;
      T.enemies = [];
      T.queue = [];
      D.step(0.05);
      return { isolated, known: D.combat.ougi.known(1), healed: s.src.chronicle.healed };
    });
    check(before.isolated, "戦場試練の戦闘中は本物の兵士の回復戦歴を変更しない");
    await p.waitForFunction(() => WD_DEBUG.combat.ougi.known(1).includes("saiseiSeiiki"));
    check(
      await p.evaluate(
        () =>
          WD_DEBUG.state().soldiers[0].chronicle.healed > 50000 &&
          WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers[0])?.k === "saiseiSeiiki",
      ),
      "試練の勝利で回復戦歴を確定し、医王が奥義を習得できる",
    );
    const after = await p.evaluate(() => {
      const D = WD_DEBUG,
        T = window.finishedUltimateTrial,
        s = D.state().soldiers[0],
        before = s.chronicle.healed,
        rolls = D.combat.ougi.save().rolls[s.chronicle.life];
      D.ultimateOugiApi.trialFinish(T, true);
      return s.chronicle.healed === before && D.combat.ougi.save().rolls[s.chronicle.life] === rolls;
    });
    check(after, "同じ試練の結果を処理し直しても回復実績・閃きを増殖しない");
    await c.close();
  }
  {
    const { p, c } = await H.setup(seed("healing_master", "medic"));
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    for (const width of [375, 390, 430, 1280]) {
      await p.setViewportSize({ width, height: 844 });
      check(
        await p.evaluate(() => {
          const sh = document.querySelector("#ougiSheet .sheet");
          return document.documentElement.scrollWidth <= innerWidth && sh.scrollWidth <= sh.clientWidth + 1;
        }),
        "医王の奥義条件・進捗 " + width + "pxで横にはみ出さない",
      );
      if (process.env.SCREENSHOTS) {
        fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
        await p.screenshot({ path: process.env.SCREENSHOTS + "/ultimate-ougi-" + width + ".png" });
      }
    }
    await c.close();
  }
  for (const [job, type, k] of [
    ["sword_saint", "ashigaru", "mumyouIssen"],
    ["gun_commander", "gunner", "kunikuzushi"],
  ]) {
    const { p, c } = await H.setup(seed(job, type));
    await beginAutoFight(p, "field", k);
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.autoOugiApi,
        T = D.trial.live(),
        u = T.units[0],
        e = window.autoTestEnemy;
      u.atkMul = 1;
      A.timer(u.src).left = 0;
      A.tick("trial", 0.01);
      const first = 1e9 - e.hp;
      e.hp = 1e9;
      u.atkMul = 2;
      A.timer(u.src).left = 0;
      A.tick("trial", 1);
      return { first, second: 1e9 - e.hp };
    });
    check(
      r.first > 0 && Math.abs(r.second / r.first - 2) < 1e-6,
      job + "の試練攻撃倍率2倍は奥義へ1回だけ反映され、4倍にならない",
    );
    await c.close();
  }
  check(!H.errors.length, "JavaScriptエラーなし：" + H.errors.join(","));
  console.log("結果: " + n + " 件成功 / 0 件失敗");
} finally {
  await H.close();
}
