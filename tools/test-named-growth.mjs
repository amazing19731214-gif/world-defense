import assert from "node:assert/strict";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, label) => {
  assert.ok(v, label);
  console.log("✓ " + label);
  n++;
};
try {
  const first = await H.setup();
  const catalog = await first.p.evaluate(() => WD_DEBUG.namedApi.NAMED_SOLDIERS);
  await first.c.close();
  const entries = Object.entries(catalog);
  const seed = {
    seq: entries.length + 1,
    squadSeq: Math.ceil((entries.length + 1) / 10),
    squads: Array.from({ length: Math.ceil((entries.length + 1) / 10) }, (_, i) => ({
      id: i + 1,
      type: "ashigaru",
      slot: i,
    })),
    soldiers: [
      ...entries.map(([named, row], i) => ({
        id: i + 1,
        named,
        name: row.name,
        type: row.type,
        job: row.type,
        jobs: [row.type],
        squadId: Math.floor(i / 10) + 1,
        level: 40,
        bestLevel: 40,
        chronicle: {
          life: "named-floor:" + i,
          aptitude: {
            version: 1,
            type: "balanced",
            level: 40,
            startAt: 30,
            ranks: {
              version: 1,
              level: 40,
              startAt: 30,
              values: { hp: 1, atk: 7, def: 9, heal: 10 },
              gains: { hp: 10, atk: 70, def: 90, heal: 100 },
            },
          },
        },
      })),
      {
        id: entries.length + 1,
        type: "ashigaru",
        job: "ashigaru",
        level: 40,
        bestLevel: 40,
        name: entries[0][1].name,
        squadId: Math.floor(entries.length / 10) + 1,
        chronicle: {
          life: "ordinary-floor",
          aptitude: {
            version: 1,
            type: "balanced",
            level: 40,
            startAt: 40,
            ranks: {
              version: 1,
              level: 40,
              startAt: 40,
              values: { hp: 1, atk: 2, def: 3, heal: 4 },
              gains: {},
            },
          },
        },
      },
    ],
    fallen: [],
  };
  const { p, c } = await H.setup(seed);
  let rows = await p.evaluate(() =>
    WD_DEBUG.squadApi
      .soldierSave()
      .soldiers.map((s) => ({ named: s.named, ranks: s.chronicle.aptitude.ranks })),
  );
  check(rows.filter((s) => s.named).length === entries.length, "既存セーブの全ネームドを読み込める");
  for (const [id, row] of entries) {
    const r = rows.find((s) => s.named === id)?.ranks;
    check(
      r && r.values.hp === 8 && r.values.atk === 8 && r.values.def === 9 && r.values.heal === 10,
      row.name + "：C以下だけBへ補正、A・Sは維持",
    );
  }
  check(
    rows
      .filter((s) => s.named)
      .every(
        (s) =>
          JSON.stringify(s.ranks.gains) === JSON.stringify({ hp: 10, atk: 70, def: 90, heal: 100 }) &&
          s.ranks.startAt === 30,
      ),
    "過去の成長分・適用開始Lvは増減しない",
  );
  check(
    JSON.stringify(rows.find((s) => !s.named).ranks.values) ===
      JSON.stringify({ hp: 1, atk: 2, def: 3, heal: 4 }),
    "同じ名前を付けた一般兵の適性は変更しない",
  );
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi;
    return Object.entries(D.namedApi.NAMED_SOLDIERS).every(([named, row]) => {
      const s = { level: 1, named, type: row.type, chronicle: { life: "fresh:" + named } };
      const values = A.growthRanks(s).values;
      return (
        Object.values(values).every((v) => v >= 8 && v <= 10) &&
        JSON.stringify(A.growthRanks(s).values) === JSON.stringify(values)
      );
    });
  });
  check(r, "全人物の新規適性はB以上、再アクセスで再抽選しない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers.find((s) => s.named && s.type === "medic");
    const rank = A.growthRanks(s),
      before = { ...rank.gains },
      lv = s.level;
    s.level += 2;
    A.grow(s, lv);
    A.grow(s, lv);
    return {
      delta: Object.fromEntries(Object.keys(before).map((k) => [k, rank.gains[k] - before[k]])),
      values: rank.values,
    };
  });
  check(
    r.delta.hp === 16 && r.delta.def === 18 && r.delta.heal === 20 && r.delta.atk === 0,
    "次のLvからB以上の成長を職業に応じて適用、二重加算しない",
  );
  await p.evaluate(() => WD_DEBUG.squadApi.saveRoster());
  const saved = await p.evaluate(() =>
    WD_DEBUG.state().soldiers.map((s) => JSON.stringify(s.chronicle.aptitude.ranks)),
  );
  await p.reload();
  check(
    await p.evaluate(
      (saved) =>
        WD_DEBUG.state().soldiers.every((s, i) => JSON.stringify(s.chronicle.aptitude.ranks) === saved[i]),
      saved,
    ),
    "保存・再読込でB以上の適性と過去・新規成長分を保持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers.find((s) => s.named && s.type !== "medic");
    const before = JSON.stringify(A.growthRanks(s));
    const err = D.jobApi.changeJob(s, "medic");
    const changed = JSON.stringify(A.growthRanks(s)) === before;
    Q.saveRoster();
    const q = D.state().squads.find((q) => q.id === s.squadId),
      life = s.chronicle.life;
    s.hp = 0;
    Q.killSoldier(s, q);
    // 更新前に戦死済みだった英霊の低ランクを再現する。
    const old = Q.soldierSave().fallen.find((f) => f.id === s.id).snap.chronicle.aptitude.ranks;
    old.values.hp = 1;
    old.values.atk = 7;
    const revive = D.gemApi.reviveFallen(s.id, q);
    const back = D.state().soldiers.find((s) => s.alive && s.chronicle.life === life);
    return { err, changed, revive, restored: back && JSON.stringify(A.growthRanks(back)) === before };
  });
  check(!r.err && r.changed, "転職後も四能力の適性と累積成長を維持");
  check(!r.revive && r.restored, "更新前に戦死したネームドも復活時にB以上、累積成長は維持");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers.find((s) => s.alive && s.named);
    const r = D.chronicleApi.growthRanks(s),
      gains = JSON.stringify(r.gains);
    D.forgeApi.save().fruits.hp = 3;
    const first = D.legendApi.useFruit(s, "hp"),
      a = r.values.hp;
    const second = D.legendApi.useFruit(s, "hp"),
      top = r.values.hp;
    const third = D.legendApi.useFruit(s, "hp");
    return (
      !first &&
      a === 9 &&
      !second &&
      top === 10 &&
      !!third &&
      D.forgeApi.save().fruits.hp === 1 &&
      JSON.stringify(r.gains) === gains
    );
  });
  check(r, "ネームドも成長の実でB→A→S、Sでは消費せず過去の能力を再計算しない");
  await c.close();
  const fresh = await H.setup();
  r = await fresh.p.evaluate(() => {
    const D = WD_DEBUG;
    D.namedApi.setRng(() => 0);
    D.setGold(100000);
    const q = D.squadApi.hireSquad("spearman", 400, 165);
    const named = D.squadApi.members(q).filter((s) => s.named);
    return (
      named.length > 0 &&
      named.every((s) => Object.values(D.chronicleApi.growthRanks(s).values).every((v) => v >= 8))
    );
  });
  check(r, "実際の新規雇用でネームド全員B以上");
  await fresh.p.evaluate(() => {
    const key = "worldDefense.warlords.v1",
      data = JSON.parse(localStorage.getItem(key));
    data.forge.scrolls.summon = 1;
    localStorage.setItem(key, JSON.stringify(data));
  });
  await fresh.p.reload();
  r = await fresh.p.evaluate(() => {
    const D = WD_DEBUG,
      err = D.gemApi.summonNamed("magoichi", D.state().squads[0]);
    const s = D.state().soldiers.find((s) => s.named === "magoichi");
    return !err && s && Object.values(D.chronicleApi.growthRanks(s).values).every((v) => v >= 8);
  });
  check(r, "召喚の書で加入したネームドも四能力B以上");
  check(H.errors.length === 0, "ブラウザ実行エラーなし");
  console.log(n + " checks passed");
} finally {
  await H.close();
}
