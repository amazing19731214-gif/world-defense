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
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi;
    const types = D.state().soldiers.map((s) => A.aptitude(s).type);
    D.recruitApi.setRng(() => 0.99);
    const ids = [];
    for (const type of ["agile", "sniper"]) {
      let key;
      for (let i = 0; i < 100; i++) {
        const candidate = "test-" + type + "-" + i;
        if (A.aptitude({ level: 1, chronicle: { life: "soldier:" + candidate } }, 1, true).type === type) {
          key = candidate;
          break;
        }
      }
      const old = crypto.randomUUID;
      crypto.randomUUID = () => key;
      const error = D.recruitApi.recruit();
      crypto.randomUUID = old;
      if (error.error) throw Error(error.error);
      const s = D.state().soldiers.at(-1);
      ids.push(s.id);
    }
    Q.saveRoster();
    return {
      types,
      ids,
      newTypes: ids.map((id) => A.aptitude(D.state().soldiers.find((s) => s.id === id)).type),
      zero: ids.every((id) =>
        Object.values(A.finesse(D.state().soldiers.find((s) => s.id === id))).every((x) => x === 0),
      ),
    };
  });
  check(
    r.types.every((x) => ["mighty", "stout", "healer", "balanced"].includes(x)),
    "適性未設定の旧兵士を既存4タイプで移行",
  );
  check(r.newTypes.join() === "agile,sniper" && r.zero, "実際の新規雇用で俊敏・狙撃を割当てLv1では補正0");
  const ids = r.ids;
  r = await p.evaluate((ids) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      [s, t] = ids.map((id) => D.state().soldiers.find((s) => s.id === id));
    Q.gainXp(s, 1e5, true);
    Q.gainXp(t, 1e5, true);
    const err = D.jobApi.changeJob(t, "archer"),
      a = A.finesse(s),
      b = A.finesse(t),
      base = (x) =>
        Q.soldierStats({
          ...x,
          chronicle: { ...x.chronicle, aptitude: { ...A.aptitude(x), type: "mighty" } },
        });
    return {
      err,
      a,
      b,
      rate: Q.soldierStats(s).rate / base(s).rate,
      range: Q.soldierStats(t).range - base(t).range,
      expected: D.jobApi.unitOf(t).range * b.range,
    };
  }, ids);
  check(
    !r.err && r.a.haste > 0 && r.a.haste < 0.03 && Math.abs(r.rate - (1 - r.a.haste)) < 1e-9,
    "俊敏の成長が実際の行動間隔に反映・3%未満",
  );
  check(
    r.b.range > 0 && r.b.range < 0.05 && Math.abs(r.range - r.expected) < 1e-8,
    "遠距離職の狙撃成長が基本射程の5%未満を加算",
  );
  r = await p.evaluate((ids) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      t = D.state().soldiers.find((s) => s.id === ids[1]);
    t.fruit = { rng: 100 };
    const a = Q.soldierStats(t).range;
    t.fruit = null;
    const b = Q.soldierStats(t).range;
    const err = D.jobApi.changeJob(t, "ashigaru");
    return { delta: a - b, err, zero: A.finesse(t).range };
  }, ids);
  check(r.delta === 100 && !r.err && r.zero === 0, "果実射程を増幅せず近接への転職で狙撃射程を適用しない");
  r = await p.evaluate((ids) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers.find((s) => s.id === ids[0]);
    s.skills = [];
    const old = Math.random;
    Math.random = () => 0;
    const first = D.jobApi.evadeHit(s, 0),
      second = D.jobApi.evadeHit(s, 1);
    Math.random = old;
    Q.saveRoster();
    return { first, second, secondary: A.aptitude(s).secondary };
  }, ids);
  check(r.first && !r.second && r.secondary > 0, "俊敏の回避を実際の判定へ反映し2秒制限を維持");
  await p.reload();
  r = await p.evaluate(
    (ids) =>
      ids.map((id) => {
        const s = WD_DEBUG.state().soldiers.find((s) => s.id === id);
        return {
          type: WD_DEBUG.chronicleApi.aptitude(s).type,
          earned: WD_DEBUG.chronicleApi.aptitude(s).secondary,
        };
      }),
    ids,
  );
  check(
    r.map((x) => x.type).join() === "agile,sniper" && r.every((x) => x.earned > 0),
    "新適性と成長量を再読込で保持",
  );
  r = await p.evaluate((ids) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers.find((s) => s.id === ids[0]);
    Q.setHeroSoldier(s.id);
    s.hp = 0;
    Q.killSoldier(
      s,
      D.state().squads.find((q) => q.id === s.squadId),
    );
    return {
      type: A.aptitude(s).type,
      level: s.level,
      zero: Object.values(A.finesse(s)).every((x) => x === 0),
    };
  }, ids);
  check(r.type === "agile" && r.level === 1 && r.zero, "主人公再出発では適性を維持し二次成長だけリセット");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.chronicleApi,
      s = WD_DEBUG.state().soldiers[0];
    s.level = 1e6;
    const a = A.aptitude(s);
    a.startAt = 1;
    a.secondary = 1e6;
    a.type = "agile";
    const agile = A.finesse(s);
    a.type = "sniper";
    s.type = "archer";
    s.job = "archer";
    const sniper = A.finesse(s);
    return agile.haste <= 0.03 && agile.evade <= 0.02 && sniper.range <= 0.05;
  });
  check(r, "Lv100万でも射程・速度・回避の追加補正に上限");
  check(H.errors.length === 0, "JavaScript例外なし");
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
