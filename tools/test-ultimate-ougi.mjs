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
const jobs = {
  shinobi_head: ["cavalry", "hyakkiYagyou"],
  spear_commander: ["spearman", "senbonYari"],
  bow_saint: ["archer", "ryuuseiu"],
  gun_commander: ["gunner", "kunikuzushi"],
  iron_cavalry: ["cavalry", "shugoKijin"],
  healing_master: ["medic", "saiseiSeiiki"],
};
const seed = (j) => {
  const d = autoSeed();
  d.heroId = 3;
  for (const s of d.soldiers) {
    s.type = jobs[j][0];
    s.job = j;
    s.jobs = [s.type, j];
    s.prof = { [j]: 1e7 };
    Object.assign(s.chronicle, {
      healed: 50000,
      ougiRescues: 10,
      ougiControlKills: 10,
      ougiBlockWins: 10,
      ougiGuardWins: 10,
      ougiBossContrib: 10,
    });
  }
  return d;
};
try {
  for (const [j, [type, k]] of Object.entries(jobs)) {
    const { p, c } = await H.setup(seed(j));
    const r = await p.evaluate((j) => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0],
        K = D.combat.ougi;
      const ok = K.eligible(1);
      s.level = 149;
      const level = K.eligible(1);
      s.level = 200;
      s.prof[j] = D.jobApi.profNeed(j, 9);
      const prof = K.eligible(1);
      s.prof[j] = D.jobApi.profNeed(j, 10);
      const fields = {
          shinobi_head: "ougiControlKills",
          spear_commander: "ougiBlockWins",
          bow_saint: "ougiBossContrib",
          gun_commander: "ougiBossContrib",
          iron_cavalry: "ougiGuardWins",
          healing_master: "ougiRescues",
        },
        key = fields[j];
      s.chronicle[key] = 9;
      const history = K.eligible(1);
      s.chronicle[key] = 10;
      let healing = true;
      if (j === "healing_master") {
        s.chronicle.healed = 49999.9;
        healing = !K.eligible(1);
        s.chronicle.healed = 50000;
      }
      return { ok, level, prof, history, healing };
    }, j);
    check(r.ok && !r.level && !r.prof && !r.history && r.healing, j + "のLv150・熟練10・職業別実績の境界");
    await p.evaluate((k) => WD_DEBUG.combat.ougi.open(1), k);
    check(
      (await p.locator("#ougiBody").innerText()).includes("奥義の習得条件"),
      j + "の奥義画面に条件・進捗を表示",
    );
    await c.close();
  }
  for (const mode of [
    "defense",
    "training",
    "training-proto",
    "battle",
    "secret",
    "explore",
    "survival",
    "field",
  ])
    for (const [j, [type, k]] of Object.entries(jobs)) {
      const { p, c } = await H.setup(seed(j));
      const begin = await beginAutoFight(p, mode, k);
      check(!begin.err && begin.ready && begin.choice?.k === k, mode + "で" + j + "の奥義を設定");
      const r = await p.evaluate((j) => {
        const D = WD_DEBUG,
          A = D.autoOugiApi,
          mode = window.autoTestMode,
          ctx = A.context(mode),
          a = ctx.actors[0];
        for (const m of ctx.friends) {
          const body = m.unit?.sh || m.s;
          body.hp = (m.unit?.max || m.stats().maxHp) * 0.4;
        }
        const before = ctx.friends.map((m) => (m.unit?.sh || m.s).hp),
          targets = ctx.targets().map((e) => ({ e, hp: e.hp }));
        A.timer(a.s).left = 0;
        A.tick(mode, 0.01);
        const delta = targets.reduce((v, t) => v + Math.max(0, t.hp - t.e.hp), 0),
          heal = ctx.friends.reduce((v, m, i) => v + Math.max(0, (m.unit?.sh || m.s).hp - before[i]), 0);
        let ward = false;
        if (["iron_cavalry", "spear_commander", "healing_master"].includes(j)) {
          const m = j === "iron_cavalry" ? (ctx.friends[1] || a) : a,
            body = m.unit?.sh || m.s;
          const shield = body.ultimateWard?.shield || 0;
          const hurt = D.insightApi.evolutionAbsorb(body, 50, false, window.autoTestEnemy, ctx.now);
          ward = shield > 0 && hurt < 50 && body.ultimateWard.shield < shield;
        }
        const stun = window.autoTestEnemy.ultimateStunUntil > ctx.now;
        const weaken = window.autoTestEnemy.evolutionWeaken?.value === 0.15;
        return { delta, heal, ward, stun, weaken, casts: A.stats.casts, rolls: A.timer(a.s).rolls };
      }, j);
      check(
        r.casts === 1 &&
          r.rolls === 1 &&
          (j === "healing_master"
            ? r.heal > 0 && r.delta === 0 && r.ward
            : j === "iron_cavalry"
              ? r.ward && r.delta === 0
              : r.delta > 0 &&
                (j !== "shinobi_head" || (mode === "secret" ? r.weaken && !r.stun : r.stun)) &&
                (j !== "spear_commander" || r.ward)),
        mode + "の" + j + "で実ダメージ／回復／盾を確認 " + JSON.stringify(r),
      );
      await c.close();
    }
  for (const [j, [type, k]] of Object.entries(jobs)) {
    const { p, c } = await H.setup(seed(j));
    const r = await p.evaluate((k) => {
      const D = WD_DEBUG,
        K = D.combat.ougi;
      K.grant(1, k);
      D.squadApi.saveRoster();
      const e = K.retire(1, 0, k),
        book = K.save().books.find((b) => b.k === k && !b.pending);
      const inherit = book && K.setHeir(2, { book: book.uid }),
        duplicate = book && K.setHeir(3, { book: book.uid }),
        again = K.retire(1, 0, k);
      return {
        e,
        book,
        inherit,
        duplicate,
        again,
        count: K.save().books.length,
        choice: D.autoOugiApi.choice(D.state().soldiers.find((s) => s.id === 2)),
      };
    }, k);
    check(
      r.e === null &&
        r.book &&
        r.inherit === null &&
        !!r.duplicate &&
        !!r.again &&
        r.count === 1 &&
        r.choice?.k === k,
      j + "の引退で1冊だけ残し、1冊1人制限で継承",
    );
    await p.reload();
    check(
      await p.evaluate(
        (k) =>
          WD_DEBUG.combat.ougi.save().books.length === 1 &&
          WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers.find((s) => s.id === 2))?.k === k,
        k,
      ),
      j + "の奥義書・継承を再読込で維持",
    );
    await c.close();
  }
  // 回復の実績は実回復だけ。救命は同じ相手につき区間1回、双方の勝利生還が必要。
  {
    const { p, c } = await H.setup(seed("healing_master"));
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        U = D.ultimateOugiApi,
        A = D.chronicleApi,
        [s, t, dead] = D.state().soldiers;
      s.chronicle.healed = 0;
      s.chronicle.ougiRescues = 0;
      for (const x of [s, t, dead]) x.inWave = true;
      const max = D.squadApi.soldierStats(t).maxHp;
      t.hp = max;
      A.heal(s, t, max, max);
      const none = s.chronicle.healed;
      for (let i = 0; i < 3; i++) {
        const before = max * 0.2;
        t.hp = max * 0.5;
        A.heal(s, t, before, max);
      }
      const beforeDead = max * 0.1;
      dead.hp = max * 0.5;
      A.heal(s, dead, beforeDead, max);
      dead.alive = false;
      U.finish([s, t, dead], true);
      const once = s.chronicle.ougiRescues;
      U.finish([s, t, dead], true);
      return { none, healed: s.chronicle.healed, once, twice: s.chronicle.ougiRescues };
    });
    check(
      r.none === 0 && r.healed > 0 && r.once === 1 && r.twice === 1,
      "空振り回復・同じ味方への繰り返し・戦死者・二重終了で救命数を増殖しない",
    );
    await c.close();
  }
  // 勝利確定前には抽選しない。奥義保存失敗後も同じ抽選を一度だけ再試行。
  {
    const { p, c } = await H.setup(seed("healing_master"));
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        U = D.ultimateOugiApi,
        A = D.chronicleApi,
        K = D.combat.ougi,
        [s, t] = D.state().soldiers;
      K.setRoll(() => 0);
      s.inWave = t.inWave = true;
      const max = D.squadApi.soldierStats(t).maxHp;
      t.hp = max * 0.5;
      A.heal(s, t, max * 0.2, max);
      U.finish([s, t], true);
      A.finish(s, true);
      A.finish(t, true);
      U.flush();
      const before = K.known(1).length;
      window.savedSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "worldDefense.ougi.v1") throw Error("quota");
        return window.savedSet.call(this, k, v);
      };
      D.squadApi.saveRoster();
      return { before };
    });
    await p.waitForTimeout(30);
    check(
      r.before === 0 &&
        (await p.evaluate(
          () =>
            WD_DEBUG.combat.ougi.known(1).length === 0 &&
            Object.keys(WD_DEBUG.combat.ougi.save().claims).length === 0,
        )),
      "兵士の勝利保存前と奥義保存失敗時には習得・抽選済み印が増えない",
    );
    await p.evaluate(() => {
      Storage.prototype.setItem = window.savedSet;
      WD_DEBUG.ultimateOugiApi.flush();
    });
    check(
      await p.evaluate(() => {
        const K = WD_DEBUG.combat.ougi,
          s = WD_DEBUG.state().soldiers[0],
          v = K.save();
        return (
          K.known(1)[0] === "saiseiSeiiki" && v.rolls[s.chronicle.life] === 1 && !!v.claims[s.chronicle.life]
        );
      }),
      "医王は討伐0でも保存済みの回復・救命生還条件で閃く",
    );
    await p.reload();
    await p.evaluate(() => WD_DEBUG.ultimateOugiApi.flush());
    check(
      await p.evaluate(() => {
        const K = WD_DEBUG.combat.ougi,
          s = WD_DEBUG.state().soldiers[0];
        return K.known(1).length === 1 && K.save().rolls[s.chronicle.life] === 1;
      }),
      "再読込・同じ勝利の再処理で二重抽選・二重習得しない",
    );
    await c.close();
  }
  {
    const { p, c } = await H.setup(seed("shinobi_head"));
    await beginAutoFight(p, "defense", "hyakkiYagyou");
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        e = window.autoTestEnemy,
        s = D.state().soldiers[0];
      e.boss = true;
      D.autoOugiApi.timer(s).left = 0;
      D.autoOugiApi.tick("defense", 0.01);
      return { stun: e.ultimateStunUntil || 0, weak: e.evolutionWeaken?.value };
    });
    check(!r.stun && r.weak === 0.15, "ボスには完全停止を付けず、攻撃低下に置き換える");
    await c.close();
  }
  {
    const { p, c } = await H.setup(seed("healing_master"));
    await beginAutoFight(p, "defense", "saiseiSeiiki");
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      D.autoOugiApi.timer(s).left = 0;
      D.autoOugiApi.tick("defense", 60);
      return D.autoOugiApi.stats.attempts;
    });
    check(r === 0, "味方が全員満タンなら回復奥義の抽選を待つ");
    await c.close();
  }
  check(!H.errors.length, "JavaScriptエラーなし：" + H.errors.join(","));
  console.log("結果: " + n + " 件成功 / 0 件失敗");
} finally {
  await H.close();
}
