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
  const { p } = await H.setup();
  const rows = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      rows = [];
    for (const [id, r] of Object.entries(A.GEAR_GROWTH)) {
      const g = D.forgeApi.GEAR[id];
      for (const [progress, rank] of [
        [0, 0],
        [r.thresholds[1] - 1, 0],
        [r.thresholds[1], 1],
        [r.thresholds[2] - 1, 1],
        [r.thresholds[2], 2],
        [1e12, 2],
      ]) {
        s.chronicle[r.counter] = progress;
        Q.saveRoster();
        const found = A.gearRank(s, g),
          bonuses = Object.entries(r.bonus).every(([key, values]) => A.gearBonus(s, g, key) === values[rank]);
        rows.push({ id, progress, ok: found === rank && bonuses });
      }
    }
    return rows;
  });
  for (const row of rows) check(row.ok, row.id + " 戦歴 " + row.progress + " の段階・上限");
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      F = D.forgeApi,
      s = D.state().soldiers[0];
    s.insight.equipped = [];
    Object.assign(s.chronicle, { kills: 0, revivals: 0, survivedSingle: 0, healed: 0 });
    Q.saveRoster();
    s.insight.equipped = [];
    const bare = Q.soldierStats(s).atk;
    const item = { uid: ++F.save().seq, id: "chronicleBlade", owner: null, lock: true };
    F.save().items.push(item);
    const err = F.equipItem(s, item.uid),
      first = Q.soldierStats(s).atk;
    s.chronicle.kills = 1000;
    Q.saveRoster();
    s.insight.equipped = [];
    const last = Q.soldierStats(s).atk;
    return { err, bare, first, last, ratio: (last - first) / (first - bare) };
  });
  check(!r.err && Math.abs(r.ratio - 1 / 3) < 1e-8, "実装備の刀が攻撃12%から16%へ成長する");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      F = D.forgeApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0];
    s.chronicle.revivals = 10;
    Q.saveRoster();
    s.insight.equipped = [];
    const item = { uid: ++F.save().seq, id: "chronicleRevivalCharm", owner: null, lock: true };
    F.save().items.push(item);
    const err = F.equipItem(s, item.uid),
      st = Q.soldierStats(s);
    s.hp = st.maxHp;
    const before = s.hp;
    Q.damageSquad(q, 20, false, "goblin");
    return { err, actual: before - s.hp, expected: ((20 * 30) / (30 + st.def)) * 0.95, uid: item.uid };
  });
  check(!r.err && Math.abs(r.actual - r.expected) < 1e-8, "黄泉の守り最終段階の5%軽減を実被弾へ反映");
  const uid = r.uid;
  r = await p.evaluate((uid) => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      F = D.forgeApi,
      [s, t] = D.state().soldiers;
    const a = F.unequipItem(uid),
      b = F.equipItem(t, uid);
    Q.saveRoster();
    return {
      a,
      b,
      rank: A.gearRank(t, F.GEAR.chronicleRevivalCharm),
      bonus: A.gearBonus(t, F.GEAR.chronicleRevivalCharm, "guard"),
      growthState: Object.keys(F.save().items.find((it) => it.uid === uid)).filter((k) =>
        /rank|progress|chronicle/i.test(k),
      ),
    };
  }, uid);
  check(
    !r.a && !r.b && r.rank === 0 && r.bonus === 0 && r.growthState.length === 0,
    "別兵士への受渡しで段階・実績を持ち運ばない",
  );
  await p.reload();
  check(
    await p.evaluate(
      (uid) =>
        WD_DEBUG.forgeApi.save().items.find((it) => it.uid === uid)?.owner === 2 &&
        WD_DEBUG.chronicleApi.gearRank(
          WD_DEBUG.state().soldiers[1],
          WD_DEBUG.forgeApi.GEAR.chronicleRevivalCharm,
        ) === 0,
      uid,
    ),
    "再読込で装備者を保持し本人の戦歴から再計算",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      F = D.forgeApi,
      s = D.state().soldiers[0];
    s.chronicle.survivedSingle = 0;
    Q.saveRoster();
    const item = { uid: ++F.save().seq, id: "chronicleLifeCharm", owner: null, lock: true };
    F.save().items.push(item);
    F.equipItem(s, item.uid);
    const first = Q.soldierStats(s).maxHp,
      hp = s.hp;
    s.chronicle.survivedSingle = 10;
    Q.saveRoster();
    return { first, last: Q.soldierStats(s).maxHp, hpSame: hp === s.hp };
  });
  check(r.last > r.first && r.hpSame, "生還の護符が成長しても現在HPを無料回復しない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      F = D.forgeApi,
      s = D.state().soldiers[0];
    D.jobApi.changeJob(s, "medic");
    s.insight.equipped = [];
    s.chronicle.healed = 0;
    Q.saveRoster();
    const item = { uid: ++F.save().seq, id: "chronicleMedicCharm", owner: null, lock: true };
    F.save().items.push(item);
    F.equipItem(s, item.uid);
    const first = Q.soldierStats(s).heal;
    s.chronicle.healed = 100000;
    Q.saveRoster();
    s.insight.equipped = [];
    return { ratio: Q.soldierStats(s).heal / first };
  });
  check(Math.abs(r.ratio - 1.15 / 1.1) < 1e-8, "救命の数珠の回復量10%から15%を実能力に反映");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      F = D.forgeApi,
      s = D.state().soldiers[0];
    s.chronicle.kills = 0;
    Q.saveRoster();
    s.insight.equipped = [];
    const bare = Q.soldierStats(s).def,
      item = { uid: ++F.save().seq, id: "chronicleWarCharm", owner: null, lock: true };
    F.save().items.push(item);
    F.equipItem(s, item.uid);
    const first = Q.soldierStats(s).def;
    s.chronicle.kills = 5000;
    Q.saveRoster();
    s.insight.equipped = [];
    return (Q.soldierStats(s).def - first) / (first - bare);
  });
  check(Math.abs(r - 1 / 3) < 1e-8, "千軍の武功章の防御6%から8%を実能力へ反映");
  const fail = await H.setup();
  r = await fail.p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      F = D.forgeApi,
      s = D.state().soldiers[0];
    Q.saveRoster();
    s.chronicle.revivals = 10;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw Error("fault");
    };
    Q.saveRoster();
    Storage.prototype.setItem = set;
    return A.gearRank(s, F.GEAR.chronicleRevivalCharm);
  });
  check(r === 0, "保存失敗・未確定戦歴では追加効果を解放しない");
  await p.evaluate(() => WD_DEBUG.chronicleApi.open());
  await p.locator(".chronicle-equipment summary").first().click();
  fs.mkdirSync("/workspace/chronicle-results/s10/screenshots", { recursive: true });
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 900 });
    check(
      await p.evaluate(() => {
        const e = document.querySelector(".chronicle-equipment");
        return (
          e &&
          e.innerText.includes("戦歴成長") &&
          e.innerText.includes("装備者本人") &&
          document.documentElement.scrollWidth <= innerWidth &&
          e.scrollWidth <= e.clientWidth + 1
        );
      }),
      "装備段階と条件が横にはみ出さない " + width,
    );
    if ([375, 1280].includes(width))
      await p.screenshot({
        path: "/workspace/chronicle-results/s10/screenshots/equipment-" + width + ".png",
      });
  }
  check(H.errors.length === 0, "JavaScript例外なし");
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
