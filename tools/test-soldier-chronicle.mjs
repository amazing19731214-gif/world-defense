import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" }),
  errors = [];
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
async function setup() {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await c.addInitScript(() => {
    requestAnimationFrame = () => 0;
    if (sessionStorage.seed) return;
    sessionStorage.seed = "1";
    localStorage.setItem(
      "worldDefense.soldiers.v1",
      JSON.stringify({
        seq: 3,
        squadSeq: 1,
        squads: [{ id: 1, type: "ashigaru", slot: 0 }],
        soldiers: [1, 2, 3].map((id) => ({
          id,
          type: id === 3 ? "medic" : "ashigaru",
          squadId: 1,
          level: 100,
          bestLevel: 100,
          name: "兵" + id,
          kills: 100,
          skills: [],
          learned: [],
          job: id === 3 ? "medic" : "ashigaru",
          jobs: [id === 3 ? "medic" : "ashigaru"],
        })),
        fallen: [],
      }),
    );
    localStorage.setItem(
      "worldDefense.warlords.v1",
      JSON.stringify({ owned: {}, forge: { scrolls: { revive: 2 } } }),
    );
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:" + server.address().port + "/?debug");
  return { p, c };
}
try {
  const { p, c } = await setup();
  const results = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      ss = D.state().soldiers,
      [s, t, h] = ss,
      tests = [];
    const ok = (v, t) => tests.push([!!v, t]);
    const stats = Q.soldierStats(s);
    ok(A.of(s).baselineKills === 100 && A.of(s).kills === 0, "旧討伐数は別保存し新戦歴を捏造しない");
    const life = A.of(s).life;
    A.damage(s, s.hp, stats.maxHp, false, "goblin");
    ok(A.of(s).meleeHits === 0, "無傷の被弾は数えない");
    const before = s.hp;
    s.hp = 7;
    A.damage(s, before, stats.maxHp, false, "goblin");
    ok(A.of(s).meleeHits === 1 && A.of(s).meleeLoss === before - 7, "実HP損失を記録");
    A.finish(s, true);
    A.finish(s, true);
    ok(A.of(s).survivedSingle === 1 && A.of(s).survived10 === 1, "一桁生還と二重確定防止");
    const e = { kind: "boss" };
    A.kill(s, e);
    A.kill(s, e);
    ok(A.of(s).kills === 1 && A.of(s).bossKills === 1, "ボスの多段撃破を1回だけ計上");
    const max = Q.soldierStats(t).maxHp;
    t.hp = max;
    A.heal(h, t, max, max);
    ok(A.of(h).healed === 0, "過剰回復は加算しない");
    t.hp = max * 0.55;
    A.heal(h, t, max * 0.2, max);
    ok(A.of(h).rescues === 1 && Math.abs(A.of(h).healed - max * 0.35) < 1e-8, "実回復と瀕死救護を記録");
    A.heal(h, t, max * 0.51, max);
    ok(A.of(h).rescues === 1, "同じ救命を繰り返し加算しない");
    A.of(t).segment = null;
    t.hp = 5;
    A.damage(t, max, max, true, "thunder");
    A.death(t);
    A.finish(t, true);
    ok(
      A.of(t).specialHits === 1 && A.of(t).rangedHits === 0 && A.of(t).survivedSingle === 0,
      "特殊攻撃を区別し戦死した兵は生還扱いにしない",
    );
    Q.saveRoster();
    const saved = Q.soldierSave().soldiers.find((x) => x.id === s.id);
    const savedHits = saved.chronicle.meleeHits;
    A.of(s).meleeHits++;
    ok(saved.chronicle.meleeHits === savedHits, "保存済み戦歴と戦闘中のオブジェクトを分離");
    const clean = A.clean(
      { healed: Infinity, kills: -4, log: Array(100).fill("x"), segment: { key: "x", low: 999, melee: 999 } },
      { id: 2 },
    );
    ok(
      clean.healed === 0 && clean.kills === 0 && clean.log.length === 24 && clean.segment.melee === 5,
      "不正値と履歴サイズを制限",
    );
    ok(JSON.stringify(stats) === JSON.stringify(Q.soldierStats(s)), "S1では戦歴による能力変化なし");
    return { tests, life, healed: A.of(h).healed };
  });
  for (const [v, t] of results.tests) check(v, t);
  await p.reload();
  check(
    await p.evaluate((life) => WD_DEBUG.state().soldiers[0].chronicle.life === life, results.life),
    "リロード後も生涯IDを維持",
  );
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[0].chronicle.meleeHits === 1),
    "未確定の戦闘中加算をリロードへ持ち込まない",
  );
  await p
    .locator("#soldiersOpen")
    .count()
    .then(async (count) => {
      if (count) await p.locator("#soldiersOpen").click();
      else await p.evaluate(() => WD_DEBUG.chronicleApi.open("live"));
    });
  // 攻城戦の実ダメージ経路と確定保存。
  const r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi;
    Q.refreshSiege();
    Q.setTarget("mikawa_okazaki");
    const err = Q.startBattle();
    if (err) return { err };
    const B = Q.battle(),
      s = B.groups[0].list[0],
      e = B.garrison[0];
    Q.battleHitGarrison(e, 1e12, s);
    const value = A.of(s).kills;
    Q.endBattle("win");
    return { value, saved: Q.soldierSave().soldiers.find((x) => x.id === s.id).chronicle.kills };
  });
  check(!r.err && r.value === 2 && r.saved === 2, "攻城の撃破を戦闘確定時に保存");
  const revival = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      A = D.chronicleApi,
      s = D.state().soldiers.find((x) => x.id === 2),
      q = D.state().squads[0],
      life = A.of(s).life;
    Q.saveRoster();
    s.hp = 0;
    Q.killSoldier(s, q);
    const fallen = Q.soldierSave().fallen.find((x) => x.id === 2);
    const error = D.gemApi.reviveFallen(2, q);
    const revived = D.state().soldiers.find((x) => x.alive && x.chronicle?.life === life);
    return {
      error,
      snap: fallen?.snap?.chronicle?.life === life,
      identity: revived?.id !== 2 && revived?.chronicle.life === life,
      revivals: revived?.chronicle.revivals,
    };
  });
  check(
    !revival.error && revival.snap && revival.identity && revival.revivals === 1,
    "実際の戦死・復活の書でID変更後も同じ生涯と復活実績を保持",
  );
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers.some((s) => s.chronicle.revivals === 1)),
    "復活記録をリロード後も保持",
  );
  await c.close();
  const f = await setup();
  const saved = await f.p.evaluate(() => localStorage.getItem("worldDefense.soldiers.v1"));
  await f.p.evaluate(() => {
    window.restoreSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "worldDefense.soldiers.v1") throw Error("fault");
      return restoreSet.call(this, k, v);
    };
    const D = WD_DEBUG;
    D.chronicleApi.of(D.state().soldiers[0]).kills = 77;
    D.squadApi.saveRoster();
  });
  check(
    (await f.p.evaluate(() => localStorage.getItem("worldDefense.soldiers.v1"))) === saved,
    "保存失敗で未確定戦歴を書き込まない",
  );
  await f.p.reload();
  check(
    await f.p.evaluate(() => WD_DEBUG.state().soldiers[0].chronicle.kills === 0),
    "保存失敗後のロードで戦歴を増殖しない",
  );
  // 二つ目の実タブが正本を変えたら古いタブは上書きしない。
  const other = await f.c.newPage();
  await other.goto("http://127.0.0.1:" + server.address().port + "/?debug");
  await other.evaluate(() => {
    const D = WD_DEBUG;
    D.chronicleApi.of(D.state().soldiers[0]).kills = 12;
    D.squadApi.saveRoster();
  });
  await f.p.evaluate(() => {
    const D = WD_DEBUG;
    D.chronicleApi.of(D.state().soldiers[0]).kills = 99;
    D.squadApi.saveRoster();
  });
  check(
    await other.evaluate(
      () => JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers[0].chronicle.kills === 12,
    ),
    "古い実タブの保存で新しい戦歴を上書きしない",
  );
  await f.c.close();
  check(errors.length === 0, "ブラウザJavaScriptエラーなし：" + errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
