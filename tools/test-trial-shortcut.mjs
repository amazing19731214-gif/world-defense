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
  for (const width of [320, 375, 390, 430, 1280]) {
    const { p, c } = await H.setup();
    p.on("dialog", (d) => d.accept());
    await p.setViewportSize({ width, height: 844 });
    await p.goto(p.url() + "&layout=compact");
    const layout = await p.evaluate(() => {
      const buttons = [...document.querySelectorAll("#dockBar > button")];
      return {
        n: buttons.length,
        fit: document.documentElement.scrollWidth <= innerWidth,
        row: buttons.every(
          (b) => Math.abs(b.getBoundingClientRect().y - buttons[0].getBoundingClientRect().y) < 1,
        ),
        touch: buttons.every(
          (b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44,
        ),
        labels: buttons.every((b) => b.scrollWidth <= b.clientWidth + 1),
        trial: document.getElementById("dockTrial").getBoundingClientRect().bottom <= innerHeight,
      };
    });
    check(layout.n === 5 && layout.row, width + "pxで部隊・建設・編成・戦場試練・メニューを1列に表示");
    check(
      layout.touch && layout.fit && layout.labels,
      width + "pxで44px以上のボタン、文字・画面の横はみ出しなし " + JSON.stringify(layout),
    );
    check(layout.trial, width + "pxで戦場試練をスクロールせずに押せる");
    await p.locator("#dockTrial").click();
    check(
      (await p.locator("#trialSheet").isVisible()) &&
        !(await p.locator("#menuTools").evaluate((e) => e.classList.contains("open"))),
      width + "pxでメニューを経由せず戦場試練を開く",
    );
    const text = await p.locator("#trialBody").innerText();
    check(text.includes("全額") && !text.includes("10％"), width + "pxの探索説明にEXP全額を表示");
    await p.locator("#trialClose").click();
    await p.locator("#dockMenu").click();
    await p.locator("#trialOpen").click();
    check(
      (await p.locator("#trialSheet").isVisible()) &&
        !(await p.locator("#menuTools").evaluate((e) => e.classList.contains("open"))),
      width + "pxで従来のメニューの入口も動作",
    );
    await p.locator("#trialClose").click();
    await c.close();
  }
  let { p, c } = await H.setup();
  p.on("dialog", (d) => d.accept());
  await p.goto(p.url() + "&layout=compact");
  await p.locator("#dockTrial").click();
  await p.locator('[data-trial-pick="1"]').click();
  await p.locator("[data-trial-go]").click();
  check(await p.evaluate(() => !!WD_DEBUG.trial.live()?.explore), "メイン画面の入口から実際に探索を開始");
  check(!(await p.locator("#dockTrial").isVisible()), "戦場試練のプレイ中は重複した開始ボタンを隠す");
  await p.locator("#trialRetreat").click();
  await p.locator("#trialClose").click();
  check(await p.locator("#dockTrial").isVisible(), "撤退後はメイン画面の入口を再表示");
  await p.locator("#dockTrial").click();
  await p.locator('[data-trial-mode="survival"]').click();
  check((await p.locator("#trialBody").innerText()).includes("全額"), "サバイバルの入口も全額と説明");
  await c.close();
  ({ p, c } = await H.setup());
  await p.goto(p.url() + "&layout=classic");
  check(
    !(await p.locator("#dockTrial").isVisible()) && (await p.locator("#trialOpen").isVisible()),
    "従来表示では既存の戦場試練ボタンを利用できる",
  );
  await p.locator("#trialOpen").click();
  check(await p.locator("#trialSheet").isVisible(), "PC向け従来表示でも入口が動作");
  await c.close();
  ({ p, c } = await H.setup());
  await p.goto(p.url() + "&layout=compact");
  await p.evaluate(() => {
    const D = WD_DEBUG;
    D.defenseApi.save();
    const save = D.heroApi.save();
    save.defense.wave = 20;
    save.defense.waveGoal = 20;
    save.defense.over = true;
    D.heroApi.persistHeroes();
  });
  await p.reload();
  check((await p.locator("#wave").innerText()).includes("20/20"), "画像と同じWAVE20/20の終了状態を復元");
  check(
    (await p.locator("#dockTrial").isVisible()) && !(await p.locator("#dockTrial").isDisabled()),
    "目標達成後のメイン画面にも戦場試練を表示",
  );
  if (process.env.SCREENSHOTS) {
    fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await p.screenshot({ path: process.env.SCREENSHOTS + "/trial-shortcut-390.png" });
  }
  await p.locator("#dockTrial").click();
  check(await p.locator("#trialSheet").isVisible(), "WAVE20終了後も戦場試練へ進める");
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
