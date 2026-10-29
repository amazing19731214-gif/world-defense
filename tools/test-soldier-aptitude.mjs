import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const baseline = JSON.parse(
    fs.readFileSync(new URL("fixtures/v86-chronicle-growth-baseline.json", import.meta.url)),
  ),
  H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
try {
  const legacy = await H.setup(baseline.seed);
  const stats = await legacy.p.evaluate(() =>
    WD_DEBUG.state().soldiers.map((s) => ({
      id: s.id,
      stats: WD_DEBUG.squadApi.soldierStats(s),
      anchor: s.chronicle.aptitude.startAt,
      level: s.level,
    })),
  );
  for (const row of baseline.stats) {
    const current = stats.find((x) => x.id === row.id);
    check(
      JSON.stringify(current.stats) === JSON.stringify(row.stats),
      "v86旧セーブの兵士" + row.id + "の全能力を移行時に維持",
    );
  }
  check(
    stats.every((x) => x.anchor === x.level),
    "既存兵の適性は現在レベルを起点にする",
  );
  await legacy.c.close();
  const { p, c } = await H.setup();
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      [s, t] = D.state().soldiers;
    A.aptitude(s).type = "mighty";
    A.aptitude(t).type = "stout";
    const b = [A.base(s, "atk"), A.base(t, "atk")],
      hp = s.hp,
      g = Q.growthLv(s.level);
    Q.gainXp(s, 1e5, true);
    Q.gainXp(t, 1e5, true);
    const unit = D.jobApi.unitOf(s),
      diff = Q.growthLv(s.level) - g;
    return {
      first: A.base(s, "atk") - b[0],
      second: A.base(t, "atk") - b[1],
      expected: unit.grow.atk * diff,
      level: s.level,
      sameLevel: s.level === t.level,
      hpSame: hp === s.hp,
      types: [A.aptitude(s).type, A.aptitude(t).type],
    };
  });
  check(
    r.sameLevel &&
      Math.abs(r.first / r.expected - 1.1) < 1e-8 &&
      Math.abs(r.second / r.expected - 0.95) < 1e-8,
    "同じ職・同じLvでも豪腕と頑健の攻撃成長が異なる",
  );
  check(r.hpSame, "レベルアップしても現在HPを回復しない");
  await p.evaluate(() => WD_DEBUG.squadApi.saveRoster());
  await p.reload();
  check(
    await p.evaluate(() => {
      const A = WD_DEBUG.chronicleApi,
        [s, t] = WD_DEBUG.state().soldiers;
      return (
        A.aptitude(s).type === "mighty" &&
        A.aptitude(t).type === "stout" &&
        A.aptitude(s).delta.atk > 0 &&
        A.aptitude(t).delta.atk < 0
      );
    }),
    "適性と蓄積した成長差を再読込後も維持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      before = structuredClone(A.aptitude(s)),
      error = D.jobApi.changeJob(s, "medic"),
      delta = JSON.stringify(A.aptitude(s).delta);
    const old = A.base(s, "heal");
    Q.gainXp(s, 1e5, true);
    return {
      error,
      type: A.aptitude(s).type,
      before: JSON.stringify(before.delta) === delta,
      healGrowth: A.base(s, "heal") > old,
    };
  });
  check(
    !r.error && r.type === "mighty" && r.before && r.healGrowth,
    "転職で適性を再抽選せず過去の差分を維持し新職で成長する",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0],
      before = A.aptitude(s).type;
    Q.setHeroSoldier(s.id);
    s.hp = 0;
    Q.killSoldier(s, q);
    return {
      alive: s.alive,
      level: s.level,
      type: A.aptitude(s).type,
      old: before,
      zero: Object.values(A.aptitude(s).delta).every((x) => x === 0),
      anchor: A.aptitude(s).startAt,
    };
  });
  check(
    r.alive && r.level === 1 && r.type === r.old && r.zero && r.anchor === 1,
    "実際の主人公再出発で適性を維持しレベル分の差分だけリセット",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers.find((x) => x.id === 2),
      q = D.state().squads[0];
    Q.saveRoster();
    const old = JSON.stringify(A.aptitude(s)),
      life = s.chronicle.life;
    s.hp = 0;
    Q.killSoldier(s, q);
    const error = D.gemApi.reviveFallen(s.id, q),
      back = D.state().soldiers.find((x) => x.alive && x.chronicle.life === life);
    return { error, same: JSON.stringify(A.aptitude(back)) === old };
  });
  check(!r.error && r.same, "実際の復活の書で適性・起点・成長差を保持");
  const stress = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    return [1, 30, 100, 1000, 9999, 1000000].map((level) => {
      const x = { ...s, level: 1, chronicle: structuredClone(s.chronicle) };
      A.resetGrowth(x);
      x.level = level;
      A.grow(x, 1);
      const first = JSON.stringify(A.aptitude(x));
      A.grow(x, 1);
      const a = A.aptitude(x),
        values = Object.values(Q.soldierStats(x));
      return {
        level,
        finite: values.every((v) => Number.isFinite(v) && v >= 0),
        cap: Object.keys(a.delta).every((k) => Math.abs(a.delta[k]) <= a.earned[k] * 0.1 + 1e-8),
        once: JSON.stringify(a) === first,
      };
    });
  });
  for (const x of stress)
    check(x.finite && x.cap && x.once, "Lv" + x.level + "で有限値・成長差10%以内・二重加算なし");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi;
    const a = A.clean(
      {
        aptitude: { version: 1, type: "mighty", level: NaN, delta: { atk: Infinity }, earned: { atk: 1e30 } },
      },
      { id: 1 },
    ).aptitude;
    return a.level === 1 && a.delta.atk === 0 && a.earned.atk === 1e10;
  });
  check(r, "不正な適性の数値を補正");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers[0],
      a = A.aptitude(s),
      u = D.jobApi.unitOf(s),
      lv = D.squadApi.growthLv(s.level);
    a.delta.hp = 1e8;
    a.earned.hp = 1e9;
    const difference = A.base(s, "hp") - u.hp - u.grow.hp * lv;
    return Math.abs(difference) <= u.grow.hp * lv * 0.1 + 1e-8;
  });
  check(r, "職業変更後も現在の基礎成長に対する補正を10%以内へ制限");
  await p.evaluate(() => WD_DEBUG.chronicleApi.open("live"));
  check((await p.locator(".chronicle-aptitude").count()) === 2, "詳細画面に4種類の成長適性を表示");
  check(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "スマホの適性表示が横にはみ出さない",
  );
  await c.close();
  check(H.errors.length === 0, "ブラウザJavaScriptエラーなし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
