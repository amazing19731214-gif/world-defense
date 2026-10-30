import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (ok, text) => {
  assert.ok(ok, text);
  n++;
  console.log("✓ " + text);
};
async function shown(p) {
  return p.locator(".soldier-combat-status").first().innerText();
}
async function refresh(p) {
  await p.evaluate(() => WD_DEBUG.chronicleApi.open("live"));
}
try {
  const { p, c } = await H.setup();
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      a = D.chronicleApi.aptitude(s);
    a.type = "balanced";
    s.skills = [];
    D.squadApi.saveRoster();
    return D.jobApi.unitOf(s).rate;
  });
  await p.locator("#organize").click();
  await p.locator('[data-formation-soldier="1"]').click();
  check(
    (await shown(p)).includes("攻撃間隔：" + r.toFixed(2) + "秒／回避率：0.0%"),
    "編成から開く兵士詳細の上部に攻撃間隔と合計回避率を常時表示",
  );
  check(await p.locator(".soldier-combat-status").first().isVisible(), "折りたたみを開かず確認できる");
  check(/ゲーム内時間.*回避後2秒/s.test(await shown(p)), "秒数の基準と回避後の制限を説明");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      A = D.chronicleApi,
      F = D.forgeApi.save();
    s.skills = ["evasion", "shadowRun"];
    const a = A.aptitude(s);
    a.type = "agile";
    a.secondary = 10;
    a.startAt = 1;
    F.seq = 2;
    F.items = [
      { uid: 1, id: "kokuyoroi", owner: s.id, lock: false },
      { uid: 2, id: "magatama", owner: s.id, lock: false },
    ];
    D.forgeApi.refreshGear();
    D.forgeApi.persist();
    s.chronicle.survivedSingle = 100;
    s.chronicle.bossAssists = 1000;
    D.squadApi.saveRoster();
    const f = A.finesse(s);
    const expectedRate = (D.jobApi.unitOf(s).rate * (1 - 0.12) * (1 - f.haste)) / 1.01;
    const expectedEvade = (0.15 + 0.1) * 1.3 + f.evade + 0.001;
    const old = Math.random;
    s.evadeUntil = 0;
    Math.random = () => expectedEvade - 1e-8;
    const hit = D.jobApi.evadeHit(s, 10),
      cooldown = D.jobApi.evadeHit(s, 11);
    Math.random = () => expectedEvade + 1e-8;
    const miss = D.jobApi.evadeHit(s, 13);
    Math.random = old;
    return {
      rate: expectedRate,
      evade: expectedEvade,
      hit,
      cooldown,
      miss,
      actualRate: D.squadApi.soldierStats(s).rate,
    };
  });
  await refresh(p);
  check(
    Math.abs(r.actualRate - r.rate) < 1e-8 &&
      (await shown(p)).includes("攻撃間隔：" + r.rate.toFixed(2) + "秒"),
    "スキル・俊敏適性・戦歴速度を含む実際の攻撃間隔を表示",
  );
  check(
    (await shown(p)).includes("回避率：" + (r.evade * 100).toFixed(1) + "%"),
    "スキル・装備・勾玉・俊敏適性・戦歴を含む合計回避率を表示",
  );
  check(r.hit && !r.cooldown && !r.miss, "表示と同じ確率境界で実際に回避し、2秒の制限も維持");
  const before = await shown(p);
  await p.evaluate(() => WD_DEBUG.playbackApi.setMode("x2"));
  await refresh(p);
  check((await shown(p)) === before, "倍速に切り替えてもゲーム内の秒数は変えない");
  await p.reload();
  await refresh(p);
  check(
    (await shown(p)).includes("回避率：" + (r.evade * 100).toFixed(1) + "%"),
    "再読み込み後も保存された能力から同じ合計を表示",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      Q = D.squadApi;
    s.skills = ["evasion", "shadowRun", "evasion", "evasion"];
    s.chronicle.survivedSingle = 1e12;
    Q.saveRoster();
    return Q.soldierStats(s).rate;
  });
  await refresh(p);
  check((await shown(p)).includes("回避率：40.0%"), "重ねた回避効果は実判定と同じ40%上限で表示");
  const medic = await H.setup();
  r = await medic.p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    const error = D.jobApi.changeJob(s, "medic");
    if (error) throw Error(error);
    s.skills = ["quickAid"];
    D.squadApi.saveRoster();
    return D.squadApi.soldierStats(s).rate;
  });
  await refresh(medic.p);
  check(
    (await shown(medic.p)).includes("回復間隔：" + r.toFixed(2) + "秒") &&
      !(await shown(medic.p)).includes("攻撃間隔"),
    "衛生兵は攻撃の代わりに回復間隔を表示",
  );
  await medic.c.close();
  const siege = await H.setup();
  r = await siege.p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi;
    D.heroApi.save().owned.kenshin = 1;
    D.forgeApi.persist();
    Q.setTarget(Q.PROVINCES.owari.castle);
    const error = Q.startBattle();
    if (error) throw Error(error);
    const g = Q.battle().groups[0],
      s = g.list[0];
    g.hero = "kenshin";
    const expected = Q.battleStats(g, s).rate;
    g.frozen = 2;
    return { rate: expected * 2 };
  });
  await refresh(siege.p);
  check(
    (await shown(siege.p)).includes("攻撃間隔：" + r.rate.toFixed(2) + "秒"),
    "攻城中は攻城用の配属武将と氷結を含む行動間隔を表示",
  );
  await siege.c.close();
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    check(
      await p.evaluate(() => {
        const e = document.querySelector(".soldier-combat-status");
        return document.documentElement.scrollWidth <= innerWidth && e.scrollWidth <= e.clientWidth + 1;
      }),
      width + "pxで能力表示が横にはみ出さない",
    );
  }
  if (process.env.SCREENSHOTS) {
    fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: process.env.SCREENSHOTS + "/soldier-combat-390.png" });
  }
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  if (H.errors.length) console.log(H.errors);
  await H.close();
}
