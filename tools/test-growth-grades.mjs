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
try {
  const baseline = JSON.parse(
    fs.readFileSync(new URL("./fixtures/v114-growth-grade-baseline.json", import.meta.url)),
  );
  const old = await H.setup(baseline.seed);
  let result = await old.p.evaluate(() =>
    WD_DEBUG.state().soldiers.map((s) => ({
      id: s.id,
      stats: WD_DEBUG.squadApi.soldierStats(s),
      ranks: WD_DEBUG.chronicleApi.growthRanks(s),
    })),
  );
  for (const row of baseline.stats) {
    const now = result.find((x) => x.id === row.id);
    check(
      Object.keys(row.stats).every((k) => Math.abs(row.stats[k] - now.stats[k]) < 1e-8),
      "v114の旧兵" + row.id + "のHP・攻防・回復・速度・射程を維持",
    );
    check(
      now.ranks.startAt === baseline.seed.soldiers.find((s) => s.id === row.id).level,
      "旧兵" + row.id + "は現在Lvから将来の成長へ適用",
    );
  }
  await old.c.close();
  const { p, c } = await H.setup();
  result = await p.evaluate(() => {
    const A = WD_DEBUG.chronicleApi;
    const first = { level: 1, chronicle: { life: "rank-test-life" } },
      second = { level: 1, chronicle: { life: "rank-test-life" } };
    const ranks = A.growthRanks(first),
      again = A.growthRanks(second);
    const profiles = Array.from({ length: 200 }, (_, i) => {
      const s = { level: 1, chronicle: { life: "rank-test-" + i } };
      return A.growthRanks(s).values;
    });
    return {
      fixed: JSON.stringify(ranks) === JSON.stringify(again),
      independent: profiles.some((r) => new Set(Object.values(r)).size === 4),
      coverage: ["hp", "atk", "def", "heal"].every((k) => new Set(profiles.map((r) => r[k])).size === 10),
    };
  });
  check(
    result.fixed && result.independent && result.coverage,
    "新規適性は生涯IDで固定、四能力は別々に抽選し全10段階が出現",
  );
  result = await p.evaluate(() => {
    const A = WD_DEBUG.chronicleApi;
    const s = { level: 50, chronicle: { life: "malformed-rank-test" } };
    const a = structuredClone(A.aptitude(s));
    a.level = 1000;
    a.ranks = {
      version: 1,
      startAt: -5,
      level: 9999999,
      values: { hp: Infinity, atk: 0, def: 11, heal: 2 },
      gains: { hp: Infinity, atk: -1, def: 1e99, heal: 1e99 },
    };
    s.chronicle = A.clean({ life: s.chronicle.life, aptitude: a }, s);
    const r = A.growthRanks(s);
    return (
      r.level === 50 &&
      r.startAt === 1 &&
      Object.values(r.values).every((v) => Number.isInteger(v) && v >= 1 && v <= 10) &&
      Object.keys(r.gains).every(
        (k) => Number.isFinite(r.gains[k]) && r.gains[k] >= 0 && r.gains[k] <= r.values[k] * 49,
      )
    );
  });
  check(result, "不正な保存値は有限範囲に補正、未到達レベルの成長を持ち込まない");
  for (let value = 1; value <= 10; value++) {
    result = await p.evaluate((value) => {
      const D = WD_DEBUG,
        A = D.chronicleApi,
        source = D.state().soldiers[0],
        s = { ...source, chronicle: structuredClone(source.chronicle) };
      const a = A.aptitude(s),
        r = A.growthRanks(s);
      r.startAt = r.level = s.level;
      r.gains.hp = 0;
      r.values.hp = value;
      const before = A.base(s, "hp"),
        lv = s.level;
      s.level += 3;
      A.grow(s, lv);
      const once = A.base(s, "hp");
      A.grow(s, lv);
      return { growth: once - before, grade: A.grade(value), same: A.base(s, "hp") === once };
    }, value);
    check(
      result.growth === value * 3 &&
        result.same &&
        result.grade === ["I", "H", "G", "F", "E", "D", "C", "B", "A", "S"][value - 1],
      "成長値" + value + "は3Lvで正確に加算・二重処理せず正しいランク",
    );
  }
  result = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      r = A.growthRanks(s);
    r.values = { hp: 10, atk: 7, def: 4, heal: 2 };
    const before = Object.fromEntries(["hp", "atk", "def", "heal"].map((k) => [k, A.base(s, k)])),
      lv = s.level,
      hp = s.hp;
    Q.gainXp(s, 100000, true);
    return {
      steps: s.level - lv,
      growth: Object.fromEntries(["hp", "atk", "def", "heal"].map((k) => [k, A.base(s, k) - before[k]])),
      sameHp: s.hp === hp,
    };
  });
  check(
    result.steps > 0 &&
      result.growth.hp === 10 * result.steps &&
      result.growth.atk === 7 * result.steps &&
      result.growth.def === 4 * result.steps,
    "実際の経験値・連続Lv上昇で4項目の固定成長を適用",
  );
  check(result.growth.heal === 0, "回復を使わない職業では回復成長を得ない");
  check(result.sameHp, "最大HPの成長で現在HPを回復しない");
  const snapshot = await p.evaluate(() => {
    const D = WD_DEBUG;
    D.squadApi.saveRoster();
    const s = D.state().soldiers[0];
    return { level: s.level, ranks: JSON.stringify(D.chronicleApi.growthRanks(s)) };
  });
  await p.reload();
  check(
    await p.evaluate((x) => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      return s.level === x.level && JSON.stringify(D.chronicleApi.growthRanks(s)) === x.ranks;
    }, snapshot),
    "再読み込みで抽選値・累積成長・適用開始Lvを保持",
  );
  result = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      before = JSON.stringify(A.growthRanks(s));
    const err = D.jobApi.changeJob(s, "medic"),
      same = JSON.stringify(A.growthRanks(s)) === before;
    const r = A.growthRanks(s),
      heal = A.base(s, "heal"),
      atk = r.gains.atk,
      lv = s.level;
    Q.gainXp(s, 100000, true);
    return {
      err,
      same,
      growth: A.base(s, "heal") - heal,
      steps: s.level - lv,
      atkSame: r.gains.atk === atk,
      values: r.values,
    };
  });
  check(
    !result.err && result.same && result.growth === 2 * result.steps && result.atkSame,
    "転職で抽選・蓄積を維持し、衛生兵では回復のランクで成長",
  );
  result = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0],
      values = JSON.stringify(A.growthRanks(s).values);
    Q.saveRoster();
    Q.setHeroSoldier(s.id);
    s.hp = 0;
    Q.killSoldier(s, q);
    const r = A.growthRanks(s);
    return {
      level: s.level,
      same: JSON.stringify(r.values) === values,
      zero: Object.values(r.gains).every((x) => x === 0),
      anchor: r.startAt,
    };
  });
  check(
    result.level === 1 && result.same && result.zero && result.anchor === 1,
    "主人公の再出発は適性を残し、今生の成長だけリセット",
  );
  result = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[1],
      q = D.state().squads[0];
    Q.gainXp(s, 10000, true);
    Q.saveRoster();
    const old = JSON.stringify(A.growthRanks(s)),
      life = s.chronicle.life;
    s.hp = 0;
    Q.killSoldier(s, q);
    const err = D.gemApi.reviveFallen(s.id, q),
      back = D.state().soldiers.find((s) => s.alive && s.chronicle.life === life);
    return { err, same: !!back && JSON.stringify(A.growthRanks(back)) === old };
  });
  check(!result.err && result.same, "一般兵の戦死・復活で適性と育てた値を保持し、重複加算しない");
  await p.evaluate(() => WD_DEBUG.chronicleApi.open("live"));
  await p.locator(".chronicle-aptitude summary").first().click();
  const text = await p.locator(".chronicle-aptitude").first().innerText();
  check(
    /HPの伸び：[SABCDEFGHI]/.test(text) &&
      /攻撃の伸び：[SABCDEFGHI]/.test(text) &&
      /防御の伸び：[SABCDEFGHI]/.test(text) &&
      /回復の伸び：[SABCDEFGHI]/.test(text),
    "詳細にHP・攻撃・防御・回復のランクを表示",
  );
  check(
    !/[0-9０-９%％+＋]/.test(text) && !/(万能型|豪腕型|頑健型|救護型)/.test(text),
    "成長適性欄に内部値・増加量・割合・旧タイプ名を表示しない",
  );
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      width + "pxで適性表示が画面内",
    );
  }
  if (process.env.SCREENSHOTS) {
    fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: process.env.SCREENSHOTS + "/growth-grades-390.png" });
  }
  result = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers[0];
    return [1000, 9999, 1000000].map((lv) => {
      const x = { ...s, level: 1, chronicle: structuredClone(s.chronicle) };
      A.resetGrowth(x);
      x.level = lv;
      A.grow(x, 1);
      const r = A.growthRanks(x),
        first = JSON.stringify(r);
      A.grow(x, 1);
      return (
        Object.values(D.squadApi.soldierStats(x)).every(Number.isFinite) &&
        Object.values(r.gains).every((v) => v <= 10 * (lv - 1)) &&
        JSON.stringify(r) === first
      );
    });
  });
  check(result.every(Boolean), "高Lv・Lv上限でも有限値、成長を二重加算しない");
  const failure = await H.setup();
  const durable = await failure.p.evaluate(() => {
    const D = WD_DEBUG;
    D.squadApi.saveRoster();
    const s = D.state().soldiers[0];
    return { level: s.level, r: JSON.stringify(D.chronicleApi.growthRanks(s)) };
  });
  await failure.p.evaluate(() => {
    const D = WD_DEBUG;
    D.squadApi.gainXp(D.state().soldiers[0], 100000, true);
    Storage.prototype.setItem = function () {
      throw Error("save fault");
    };
    D.squadApi.saveRoster();
  });
  await failure.p.reload();
  check(
    await failure.p.evaluate((x) => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      return s.level === x.level && JSON.stringify(D.chronicleApi.growthRanks(s)) === x.r;
    }, durable),
    "保存失敗後の再読込で未確定のLv・成長を持ち越さず、適性も再抽選しない",
  );
  await failure.c.close();
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  if (H.errors.length) console.log(H.errors);
  await H.close();
}
