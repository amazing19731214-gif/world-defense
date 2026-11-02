// v117：探索・サバイバル・三方の関の実際のtick、主人公以外の仲間の自動奥義。
import assert from "node:assert/strict";
import { harness } from "./chronicle-test-utils.mjs";
import { autoSeed, beginAutoFight } from "./auto-ougi-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
try {
  for (const mode of ["explore", "survival", "field"]) {
    const { p, c } = await H.setup(autoSeed());
    check(!(await beginAutoFight(p, mode)).err, mode + "を開始");
    const actual = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.autoOugiApi,
        T = D.trial.live();
      // 敵の生成から実際の処理を使う。固定用の簡易敵を外してから出す。
      T.enemies = [];
      T.next = 0;
      if (T.queue?.length) T.queue[0].t = 0;
      D.step(0.1);
      const e = T.enemies[0],
        h = T.units[0];
      if (!e) return { error: "no enemy" };
      Object.assign(e, {
        x: h.x + 60,
        y: h.y,
        hp: 1e9,
        max: 1e9,
        speed: 0,
        atk: 0,
        cd: 1e9,
        joined: true,
        stun: 0,
      });
      T.enemies = [e];
      T.queue = [];
      T.next = 1e9;
      T.lvUps = 0;
      T.choice = null;
      T.units.forEach((u) => (u.cd = 1e9));
      const old = e.hp;
      A.timer(h.src).left = 0;
      A.setRoll(() => 0);
      D.step(0.1);
      return {
        casts: A.stats.casts,
        damage: old - e.hp,
        button: !!document.getElementById("trialOugiBtn"),
        hud: document.getElementById("trialAction").textContent,
        record: T.ougiUsed,
      };
    });
    check(
      actual.casts === 1 && actual.damage > 0,
      mode + "の実際の更新から自動奥義が命中 " + JSON.stringify(actual),
    );
    check(!actual.button && actual.hud.includes("自動奥義"), mode + "で操作不要の自動表示を出す");
    check(actual.record?.hits === 1, mode + "の結果用記録に奥義の命中を記録");
    await c.close();
  }
  const { p, c } = await H.setup(autoSeed());
  await beginAutoFight(p, "survival");
  const r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.autoOugiApi,
      T = D.trial.live();
    D.combat.ougi.grant(2, "mumyouIssen");
    T.choice = [{ kind: "recruit", unit: T.reserve[0] }];
    T.lvUps = 1;
    D.trial.choose(0);
    const mate = T.units[1];
    T.enemies = [];
    T.next = 0;
    D.step(0.1);
    const e = T.enemies[0];
    Object.assign(e, {
      x: mate.x + 50,
      y: mate.y,
      hp: 1e9,
      max: 1e9,
      speed: 0,
      atk: 0,
      cd: 1e9,
      joined: true,
    });
    T.enemies = [e];
    T.next = 1e9;
    T.choice = null;
    T.lvUps = 0;
    T.units.forEach((u) => (u.cd = 1e9));
    A.timer(T.units[0].src).left = 60;
    A.timer(mate.src).left = 0;
    const old = e.hp;
    D.step(0.1);
    const active = A.stats.casts,
      hp = e.hp;
    T.paused = true;
    A.timer(mate.src).left = 2;
    D.step(5);
    return {
      active,
      damage: old - hp,
      heroRolls: A.timer(T.units[0].src).rolls,
      mateRolls: A.timer(mate.src).rolls,
      pausedLeft: A.timer(mate.src).left,
    };
  });
  check(
    r.active === 1 && r.damage > 0 && r.heroRolls === 0 && r.mateRolls === 1,
    "主人公以外の加入した仲間も自分の時計で自動発動する",
  );
  check(r.pausedLeft === 2, "サバイバルの停止中は仲間の待ち時間も進まない");
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
