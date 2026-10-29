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
      s = D.state().soldiers[0],
      A = D.chronicleApi,
      Q = D.squadApi;
    s.chronicle.survivedSingle = 3;
    const early = A.learnUnyielding(s);
    Q.saveRoster();
    const err = A.learnUnyielding(s);
    return {
      early,
      err,
      learned: s.learned.filter((x) => x === "unyielding").length,
      equipped: s.skills.includes("unyielding"),
      again: A.learnUnyielding(s),
    };
  });
  check(
    r.early && !r.err && r.learned === 1 && r.equipped && r.again,
    "保存済み生還3回で既存不屈を1回だけ習得",
  );
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[0].skills.includes("unyielding")),
    "不屈習得は再読込で保持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0];
    q.state = "deployed";
    s.hp = Q.soldierStats(s).maxHp;
    Q.damageSquad(q, 1e9, false, "goblin");
    const first = s.alive && s.hp === 1 && s.unyieldUsed;
    Q.damageSquad(q, 1e9, false, "goblin");
    return { first, second: !s.alive };
  });
  check(r.first && r.second, "実際の防衛計算で1回だけHP1・次の致命傷で戦死");
  const f = await H.setup();
  r = await f.p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      A = D.chronicleApi,
      Q = D.squadApi;
    s.chronicle.survivedSingle = 3;
    Q.saveRoster();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw Error("fault");
    };
    const err = A.learnUnyielding(s);
    Storage.prototype.setItem = original;
    const unchanged = !s.learned.includes("unyielding") && !s.skills.includes("unyielding");
    return { err, unchanged, retry: A.learnUnyielding(s) };
  });
  check(r.err && r.unchanged && !r.retry, "保存失敗で習得を取消し再試行できる");
  const full = await H.setup();
  // 通常20枠を実在スキルで埋め、習得だけできることを確認する。
  r = await full.p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      A = D.chronicleApi,
      Q = D.squadApi;
    s.skills = Object.keys(Q.SOLDIER_SKILLS)
      .filter((id) => id !== "unyielding" && !Q.SOLDIER_SKILLS[id].future)
      .slice(0, 20);
    s.learned = s.skills.slice();
    s.chronicle.survivedSingle = 3;
    Q.saveRoster();
    const before = s.skills.length,
      err = A.learnUnyielding(s);
    return { err, before, after: s.skills.length, learned: s.learned.includes("unyielding") };
  });
  check(!r.err && r.before === 20 && r.after === 20 && r.learned, "通常枠満杯でも習得だけ行い枠を増やさない");
  check(H.errors.length === 0, "JavaScript例外なし");
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
