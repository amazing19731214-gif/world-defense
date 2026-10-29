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
  const r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      A = D.chronicleApi,
      Q = D.squadApi;
    Q.saveRoster();
    A.title(s, "kills100");
    s.insight.known = ["in_medic"];
    s.insight.equipped = ["in_medic"];
    Q.saveRoster();
    const before = JSON.stringify(Q.soldierStats(s)),
      order = D.state()
        .soldiers.map((x) => x.id)
        .join();
    A.open();
    document.getElementById("soldierSheet").hidden = true;
    document.getElementById("organize").click();
    return {
      summary: A.summary(s),
      goals: A.goals(s),
      same:
        before === JSON.stringify(Q.soldierStats(s)) &&
        order ===
          D.state()
            .soldiers.map((x) => x.id)
            .join(),
    };
  });
  check(r.summary.includes("🌱") && r.summary.includes("百人斬り"), "編成用の要約に適性と選択称号を表示");
  check(r.summary.includes("職業・Lv条件外"), "現在使えない閃きを有効と誤表示しない");
  check(
    r.goals.includes("<progress") && r.goals.includes("aria-label"),
    "次の戦歴目標を進捗バーと読み上げ名で表示",
  );
  check(r.same, "表示で能力値・兵士順を変更しない");
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 900 });
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "編成の横はみ出しなし " + width,
    );
  }
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[0].chronicle.selected === "kills100"),
    "選択した称号を再読込後も表示",
  );
  check(H.errors.length === 0, "JavaScript例外なし");
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
