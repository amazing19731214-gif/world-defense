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
async function win(p, goal = 25) {
  await p.locator("#wave").click();
  await p.locator('[data-goal="' + goal + '"]').click();
  await p.evaluate((goal) => {
    const D = WD_DEBUG;
    for (let i = 0; i < goal; i++) {
      document.getElementById("start").click();
      D.stopSpawning();
      D.state().enemies.length = 0;
      D.step(0.1);
    }
  }, goal);
}
try {
  let { p, c } = await H.setup();
  await p.goto(p.url() + "&layout=compact");
  check(
    !(await p.locator("#wave").evaluate((e) => e.classList.contains("goal-ready"))),
    "開始前のWAVE表示は目標達成の案内を出さない",
  );
  await win(p);
  let r = await p.locator("#wave").evaluate((e) => ({
    text: e.textContent,
    ready: e.classList.contains("goal-ready"),
    animation: getComputedStyle(e).animationName,
    hint: getComputedStyle(e, "::after").content,
    label: e.getAttribute("aria-label"),
  }));
  check(
    r.ready && r.animation === "wave-goal-glow" && r.text.includes("25/25"),
    "25/25達成時にWAVE表示を光らせる",
  );
  check(
    r.hint.includes("押して続ける") && r.label.includes("目標達成"),
    "画面表示と読み上げの両方で押す場所を案内",
  );
  await p.emulateMedia({ reducedMotion: "reduce" });
  check(
    await p
      .locator("#wave")
      .evaluate((e) => getComputedStyle(e).animationName === "none" && e.classList.contains("goal-ready")),
    "動きを減らす設定では点滅せず点灯で案内",
  );
  await p.locator("#wave").focus();
  await p.keyboard.press("Enter");
  check(
    (await p.locator("#goalSheet").isVisible()) && (await p.locator("#goalRestart").isVisible()),
    "WAVEをEnterで開き、最初からボタンも表示",
  );
  const before = await p.evaluate(() => {
    const D = WD_DEBUG;
    return {
      wave: D.state().wave,
      gold: D.state().gold,
      hp: D.state().hp,
      live: D.state().soldiers.map((s) => ({ id: s.id, level: s.level, xp: s.xp })),
      saved: localStorage.getItem("worldDefense.warlords.v1"),
    };
  });
  p.once("dialog", (d) => d.dismiss());
  await p.locator("#goalRestart").click();
  check(
    await p.evaluate(
      (before) =>
        WD_DEBUG.state().wave === before.wave &&
        WD_DEBUG.state().gold === before.gold &&
        localStorage.getItem("worldDefense.warlords.v1") === before.saved,
      before,
    ),
    "最初からの確認を取り消しても進行・保存は変わらない",
  );
  check(await p.locator("#goalSheet").isVisible(), "確認を取り消した場合は目標画面に残る");
  await p.evaluate(() => {
    window.oldGoalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw Error("fault");
    };
  });
  p.once("dialog", (d) => d.accept());
  await p.locator("#goalRestart").click();
  check(
    (await p.evaluate(() => WD_DEBUG.state().wave === 25 && WD_DEBUG.state().over)) &&
      (await p.locator("#goalSheet").isVisible()),
    "保存を更新できないときはリセットを中止",
  );
  await p.evaluate(() => {
    Storage.prototype.setItem = window.oldGoalSet;
    WD_DEBUG.heroApi.persistHeroes();
  });
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().wave === 25 && WD_DEBUG.state().over),
    "保存失敗後の別の保存・再読込でも進行が失われない",
  );
  await p.locator("#wave").click();
  p.once("dialog", (d) => d.accept());
  await p.locator("#goalRestart").click();
  check(
    await p.evaluate(() => {
      const s = WD_DEBUG.state();
      return s.wave === 0 && s.hp === 20 && s.gold === 500 && !s.over && !s.playing && s.towers.length === 0;
    }),
    "確認後は従来の最初からと同じ防衛初期状態に戻す",
  );
  check(
    await p.evaluate(
      (before) =>
        JSON.stringify(WD_DEBUG.state().soldiers.map((s) => ({ id: s.id, level: s.level, xp: s.xp }))) ===
        JSON.stringify(before.live),
      before,
    ),
    "最初からでも保存済みの兵士・レベル・経験値を維持",
  );
  check(
    !(await p.locator("#goalSheet").isVisible()) &&
      !(await p.locator("#wave").evaluate((e) => e.classList.contains("goal-ready"))),
    "リセット成功後は目標画面を閉じ、達成案内も消す",
  );
  await c.close();
  ({ p, c } = await H.setup());
  await p.goto(p.url() + "&layout=compact");
  await win(p);
  await p.locator("#wave").click();
  await p.locator('[data-goal="30"]').click();
  check(
    await p.evaluate(
      () => !WD_DEBUG.state().over && !document.getElementById("wave").classList.contains("goal-ready"),
    ),
    "次の目標へ延ばすと光る案内を消して再開可能にする",
  );
  await p.locator("#start").click();
  check(
    await p.evaluate(() => WD_DEBUG.state().playing && WD_DEBUG.state().wave === 26),
    "目標を延ばして実際にWAVE26へ進める",
  );
  await c.close();
  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [390, 844],
    [430, 932],
    [1280, 800],
  ]) {
    ({ p, c } = await H.setup());
    await p.setViewportSize({ width, height });
    await p.goto(p.url() + "&layout=compact");
    await p.evaluate(() => {
      const D = WD_DEBUG;
      D.defenseApi.save();
      const h = D.heroApi.save();
      h.defense.wave = 25;
      h.defense.waveGoal = 25;
      h.defense.over = true;
      D.heroApi.persistHeroes();
    });
    await p.reload();
    check(
      await p.locator("#wave").evaluate((e) => e.classList.contains("goal-ready")),
      width + "pxで再読込後も達成を案内",
    );
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      width + "pxで光るWAVE表示が横にはみ出さない",
    );
    await p.locator("#wave").click();
    r = await p.evaluate(() => {
      const b = document.getElementById("goalRestart"),
        r = b.getBoundingClientRect(),
        body = document.getElementById("goalBody");
      return {
        visible: r.bottom <= innerHeight && r.top >= 0,
        touch: r.height >= 44 && r.width >= 44,
        fit: document.documentElement.scrollWidth <= innerWidth,
        scroll: body.scrollHeight > body.clientHeight,
      };
    });
    check(
      r.visible && r.touch && r.fit,
      width + "pxで最初からボタンを画面内に表示・44px以上 " + JSON.stringify(r),
    );
    await p.locator('[data-goal="1000"]').scrollIntoViewIfNeeded();
    check(
      await p.locator("#goalRestart").evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight),
      width + "pxで目標をスクロールしても最初からボタンが見える",
    );
    if (process.env.SCREENSHOTS && width === 390) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/goal-restart-390.png" });
      await p.locator("#goalClose").click();
      await p.screenshot({ path: process.env.SCREENSHOTS + "/goal-ready-390.png" });
    }
    await c.close();
  }
  ({ p, c } = await H.setup());
  await p.locator("#wave").click();
  await p.locator('[data-goal="25"]').click();
  await p.evaluate(() => {
    const D = WD_DEBUG;
    for (let i = 0; i < 24; i++) {
      document.getElementById("start").click();
      D.stopSpawning();
      D.state().enemies.length = 0;
      D.step(0.1);
    }
    document.getElementById("start").click();
    D.stopSpawning();
    for (let i = 0; i < 20; i++) D.addEnemy({ d: 1e6, hp: 1000, speed: 0 });
    D.step(0.1);
  });
  check(
    await p.evaluate(() => WD_DEBUG.state().over && WD_DEBUG.state().hp <= 0 && WD_DEBUG.state().wave === 25),
    "目標25の最終WAVEで実際に敗北した状態を確認",
  );
  check(
    !(await p.locator("#wave").evaluate((e) => e.classList.contains("goal-ready"))),
    "敗北では勝利・続行の案内を出さない",
  );
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
