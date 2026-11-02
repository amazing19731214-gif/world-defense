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
import { autoSeed as seed, beginAutoFight as begin } from "./auto-ougi-test-utils.mjs";
const tick = (p, dt) => p.evaluate((dt) => WD_DEBUG.autoOugiApi.tick(window.autoTestMode, dt), dt);
try {
  for (const mode of [
    "defense",
    "training",
    "training-proto",
    "battle",
    "secret",
    "explore",
    "survival",
    "field",
  ])
    for (const k of ["happouTenshou", "mumyouIssen", "tenkenRanbu"]) {
      const { p, c } = await H.setup(seed()),
        r = await begin(p, mode, k);
      check(!r.err && r.ready && r.choice?.k === k, mode + "で習得した" + k + "が個人の自動奥義として有効");
      const actual = await p.evaluate(() => {
        const A = WD_DEBUG.autoOugiApi,
          s = WD_DEBUG.state().soldiers[0],
          e = window.autoTestEnemy,
          targets = A.context(window.autoTestMode)
            .targets()
            .map((e) => ({ e, hp: e.hp }));
        A.timer(s).left = 0;
        A.tick(window.autoTestMode, 0.01);
        for (let i = 0; i < 6; i++) A.tick(window.autoTestMode, 0.2);
        return {
          damage: targets.reduce((n, x) => n + Math.max(0, x.hp - x.e.hp), 0),
          casts: A.stats.casts,
          hits: A.stats.hits,
          rolls: A.timer(s).rolls,
          left: A.timer(s).left,
        };
      });
      check(
        actual.damage > 0 &&
          actual.casts === 1 &&
          actual.rolls === 1 &&
          actual.hits >= (k === "tenkenRanbu" ? 6 : 1) &&
          actual.left > 58,
        mode + "の" + k + "が実際にダメージを与え、1回だけ抽選する " + JSON.stringify(actual),
      );
      await c.close();
    }
  let { p, c } = await H.setup(seed());
  await begin(p);
  await tick(p, 59);
  check(await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.attempts === 0), "最初の59秒では抽選しない");
  await tick(p, 1);
  check(
    await p.evaluate(
      () => WD_DEBUG.autoOugiApi.stats.casts === 1 && WD_DEBUG.autoOugiApi.stats.attempts === 1,
    ),
    "60秒で初めて抽選・自動発動",
  );
  await p.evaluate(() => WD_DEBUG.autoOugiApi.setRoll(() => 0.3));
  await tick(p, 60);
  check(
    await p.evaluate(
      () => WD_DEBUG.autoOugiApi.stats.attempts === 2 && WD_DEBUG.autoOugiApi.stats.casts === 1,
    ),
    "30%の境界は外れとして数え、1分待ちに戻す",
  );
  await tick(p, 59);
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.attempts === 2),
    "外れた後も60秒未満では再抽選しない",
  );
  await p.evaluate(() => WD_DEBUG.autoOugiApi.setRoll(() => 0.299999));
  await tick(p, 1);
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.casts === 2),
    "30%未満なら再発動でき、挑戦中1回の制限はない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await p.evaluate(() => {
    const D = WD_DEBUG;
    D.state().enemies.length = 0;
    D.autoOugiApi.timer(D.state().soldiers[0]).left = 0;
  });
  await tick(p, 1);
  check(
    await p.evaluate(
      () =>
        WD_DEBUG.autoOugiApi.stats.attempts === 0 &&
        WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === 0,
    ),
    "対象がいなければ抽選を消費せず準備完了で待つ",
  );
  await p.evaluate(() => WD_DEBUG.state().enemies.push(window.autoTestEnemy));
  await tick(p, 0.01);
  check(await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.casts === 1), "範囲内に敵が来たら自動抽選");
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await tick(p, 12);
  let left = await p.evaluate(() => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left);
  await p.evaluate(() => WD_DEBUG.playbackApi.setMode("paused"));
  await tick(p, 60);
  check(
    await p.evaluate((left) => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === left, left),
    "停止中は時計を進めない",
  );
  await p.evaluate(() => {
    WD_DEBUG.playbackApi.setMode("x1");
    document.getElementById("infoOpen").click();
  });
  await tick(p, 60);
  check(
    await p.evaluate((left) => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === left, left),
    "メニュー中は時計を進めない",
  );
  await p.locator("#infoClose").click();
  await p.evaluate(() => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.stopSpawning();
    WD_DEBUG.step(0.1);
  });
  left = await p.evaluate(() => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left);
  await p.evaluate(() => document.getElementById("start").click());
  check(
    await p.evaluate((left) => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === left, left),
    "WAVE切替で待ち時間をリセットしない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    D.autoOugiApi.timer(s).left = 10;
    D.playbackApi.setMode("x2");
    Q.saveRoster();
    D.state().soldiers.forEach((s) => (s.cd = 1e9));
  });
  await p.evaluate(() => WD_DEBUG.step(1));
  check(
    await p.evaluate(
      () => Math.abs(WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left - 8) < 0.05,
    ),
    "倍速ではゲーム内2秒分の待ち時間が進む",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await tick(p, 20);
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === 40),
    "再読み込みでも保存済みの待ち時間を保持",
  );
  await begin(p, "survival");
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left === 40),
    "モードを切り替えても兵士の待ち時間を保持",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await p.evaluate(() => {
    const A = WD_DEBUG.autoOugiApi,
      s = WD_DEBUG.state().soldiers[0];
    A.timer(s).left = 0;
    window.autoOldSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw Error("fault");
    };
  });
  await tick(p, 0.1);
  check(
    await p.evaluate(
      () =>
        WD_DEBUG.autoOugiApi.stats.attempts === 0 &&
        WD_DEBUG.autoOugiApi.stats.casts === 0 &&
        window.autoTestEnemy.hp === 1e9,
    ),
    "抽選を保存できなければダメージを与えない",
  );
  await p.evaluate(() => (Storage.prototype.setItem = window.autoOldSet));
  await tick(p, 5);
  check(
    await p.evaluate(
      () =>
        WD_DEBUG.autoOugiApi.stats.casts === 1 &&
        WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).rolls === 1,
    ),
    "保存復旧後も同じ抽選番号を一度だけ使う",
  );
  await p.reload();
  check(
    await p.evaluate(() => {
      const A = WD_DEBUG.autoOugiApi,
        s = WD_DEBUG.state().soldiers[0];
      return A.timer(s).rolls === 1 && A.timer(s).left === 60;
    }),
    "発動後の再読込で抽選番号とクールダウンを戻さない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  const legacy = await p.evaluate(() => {
    const D = WD_DEBUG,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    Q.saveRoster();
    const raw = {
      version: 1,
      seq: 1,
      books: [{ uid: 1, k: "mumyouIssen", from: "旧剣聖", job: "sword_saint", level: 200, at: 1 }],
      known: { [s.chronicle.life]: { name: s.name, list: [{ k: "tenkenRanbu", at: 1 }] } },
      rolls: { [s.chronicle.life]: 7 },
      fails: { [s.chronicle.life]: 3 },
      heir: { sid: 1, k: "mumyouIssen", book: 1 },
      run: { id: "old-run", used: true },
    };
    localStorage.setItem("worldDefense.ougi.v1", JSON.stringify(raw));
    return raw;
  });
  await p.reload();
  check(
    await p.evaluate(() => {
      const D = WD_DEBUG,
        K = D.combat.ougi,
        s = D.state().soldiers[0],
        save = K.save();
      return (
        D.autoOugiApi.choice(s).book === 1 &&
        save.books.length === 1 &&
        K.known(1).includes("tenkenRanbu") &&
        save.rolls[s.chronicle.life] === 7 &&
        save.fails[s.chronicle.life] === 3
      );
    }),
    "旧セーブの奥義書・習得・閃き抽選記録と継承設定を引き継ぐ",
  );
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      K = D.combat.ougi;
    K.grant(2, "happouTenshou");
    const err = K.setHeir(2, { k: "happouTenshou" });
    return { err, choices: D.state().soldiers.map((s) => D.autoOugiApi.choice(s)) };
  });
  check(
    !r.err && r.choices[0]?.k === "mumyouIssen" && r.choices[1]?.k === "happouTenshou",
    "全軍1人の制限を外し、兵士ごとに別の奥義を有効化",
  );
  check(
    await p.evaluate(() => !!WD_DEBUG.combat.ougi.setHeir(2, { book: 1 })),
    "同じ奥義書を同時に2人へ重複継承しない",
  );
  await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
  await p.locator('[data-ougi-clear="1"]').first().click();
  check(
    await p.evaluate(
      () =>
        !WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers[0]) &&
        !!WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers[1]),
    ),
    "UIで1人だけ解除しても他の兵士の設定を変えない",
  );
  await p.reload();
  check(
    await p.evaluate(() => !WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers[0])),
    "解除設定を保存し、リロードで勝手に再有効化しない",
  );
  check(
    await p.evaluate(
      () =>
        !WD_DEBUG.combat.ougi.setHeir(2, { book: 1 }) &&
        WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers[1]).book === 1,
    ),
    "解除した奥義書は別の剣聖へ継承できる",
  );
  await p.evaluate(() => {
    const s = WD_DEBUG.state().soldiers[1];
    s.job = "ashigaru";
  });
  check(
    await p.evaluate(() => !WD_DEBUG.autoOugiApi.choice(WD_DEBUG.state().soldiers[1])),
    "職業条件を満たさない兵士は奥義を発動しない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await p.evaluate(() => {
    const D = WD_DEBUG,
      K = D.combat.ougi,
      A = D.autoOugiApi;
    K.grant(2, "mumyouIssen");
    for (const s of D.state().soldiers.slice(0, 2)) A.timer(s).left = 0;
  });
  await tick(p, 0.01);
  check(await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.casts === 1), "複数人の奥義を同じ瞬間に重ねない");
  await tick(p, 1);
  check(await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.casts === 2), "待機した別の兵士も少し遅れて発動");
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p, "defense", "tenkenRanbu");
  await p.evaluate(() => (WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left = 0));
  await tick(p, 0.01);
  await tick(p, 0.01);
  const hits = await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.hits);
  await p.evaluate(() => (WD_DEBUG.state().soldiers[0].alive = false));
  await tick(p, 1);
  check(
    await p.evaluate((hits) => WD_DEBUG.autoOugiApi.stats.hits === hits, hits),
    "発動者が倒れた後に連続斬撃を続けない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await begin(p);
  await p.evaluate(() => (WD_DEBUG.autoOugiApi.timer(WD_DEBUG.state().soldiers[0]).left = 0));
  const other = await c.newPage();
  await other.goto(p.url());
  await other.evaluate(() => WD_DEBUG.combat.ougi.grant(2, "tenkenRanbu"));
  await tick(p, 0.01);
  check(
    await p.evaluate(() => WD_DEBUG.autoOugiApi.stats.casts === 0),
    "別タブで変更された奥義記録を上書きせず、自動発動を止める",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await p.evaluate(() => {
    WD_DEBUG.combat.ougi.grant(1, "mumyouIssen");
    WD_DEBUG.combat.ougi.open(1);
  });
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      width + "pxで自動奥義設定が横にはみ出さない",
    );
  }
  if (process.env.SCREENSHOTS) {
    fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: process.env.SCREENSHOTS + "/auto-ougi-390.png" });
  }
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
