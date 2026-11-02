// v117：TD・修練場・攻城・秘境で、実際のゲームtickから奥義が自動発動する。
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
  for (const mode of ["defense", "training", "training-proto", "battle", "secret"]) {
    const { p, c } = await H.setup(autoSeed());
    const r = await beginAutoFight(p, mode);
    check(!r.err && r.ready, mode + "の戦場を準備");
    const actual = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.autoOugiApi,
        s = D.state().soldiers[0];
      if (window.autoTestMode === "defense") {
        const q = D.state().squads[0],
          e = window.autoTestEnemy,
          road = D.projectToRoad(q.x - 80, q.y);
        e.path = road.path;
        e.d = road.d;
        Object.assign(e, D.pathAt(road.path, road.d));
      }
      const ctx = A.context(window.autoTestMode),
        before = ctx
          .targets()
          .map((e) => ({ e, hp: e.hp, heads: e.heads?.map((h) => ({ hp: h.hp, sealed: h.sealed })) }));
      A.timer(s).left = 0;
      A.setRoll(() => 0);
      D.step(0.05);
      return {
        casts: A.stats.casts,
        damage: before.reduce(
          (sum, x) =>
            sum +
            Math.max(0, x.hp - x.e.hp) +
            (x.heads
              ? x.heads.reduce(
                  (n, h, i) =>
                    n + Math.max(0, h.hp - x.e.heads[i].hp) + (x.e.heads[i].sealed > h.sealed ? 1 : 0),
                  0,
                )
              : 0),
          0,
        ),
        hidden: document.getElementById("ougiBtn").hidden,
      };
    });
    check(
      actual.casts === 1 && actual.damage > 0,
      mode + "の実際の戦闘更新で自動奥義が命中" + JSON.stringify(actual),
    );
    check(actual.hidden, mode + "で手動発動ボタンを出さない");
    await c.close();
  }
  const { p, c } = await H.setup(autoSeed());
  await beginAutoFight(p);
  await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.autoOugiApi,
      s = D.state().soldiers[0];
    A.timer(s).left = 7;
    D.playbackApi.setMode("paused");
    D.step(2);
  });
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === 7),
    "実際の停止操作中はゲームtickでも時計が進まない",
  );
  await p.evaluate(() => {
    WD_DEBUG.playbackApi.setMode("x1");
    document.getElementById("infoOpen").click();
    WD_DEBUG.step(2);
  });
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === 7),
    "情報画面の表示中はゲームtickでも時計が進まない",
  );
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
