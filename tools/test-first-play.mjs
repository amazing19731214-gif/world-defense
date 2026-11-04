// 実際の初回起動から、案内と画面操作だけで最初の防衛を開始する。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((_q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const errors = [];
let n = 0;
const check = (ok, label) => {
  assert.ok(ok, label);
  console.log("✓ " + label);
  n++;
};
async function open({ width = 390, layout = "compact", seed = null } = {}) {
  const c = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: width < 600,
    hasTouch: width < 600,
  });
  await c.addInitScript((seed) => {
    requestAnimationFrame = () => 0;
    if (location.protocol !== "http:" || sessionStorage.seeded) return;
    sessionStorage.seeded = "1";
    if (seed) for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
  }, seed);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(`http://127.0.0.1:${server.address().port}/?debug&layout=${layout}`);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { p, c };
}
const state = (p) =>
  p.evaluate(() => {
    const s = WD_DEBUG.state();
    return {
      gold: s.gold,
      towers: s.towers.length,
      soldiers: s.soldiers.filter((s) => s.alive).length,
      deployed: s.squads.filter((q) => q.state === "deployed").length,
      playing: s.playing,
    };
  });
async function mapClick(p, x, y) {
  await p.locator("#game").scrollIntoViewIfNeeded();
  const pt = await p.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return {
        x: r.left + c.clientLeft + (x * c.clientWidth) / 960,
        y: r.top + c.clientTop + (y * c.clientHeight) / 600,
      };
    },
    [x, y],
  );
  await p.mouse.click(pt.x, pt.y);
}
async function reopen(p) {
  await p.locator("#infoOpen").click();
  if (!(await p.locator("#firstGuideOpen").isVisible())) await p.locator("#firstPlayHelp > summary").click();
  await p.locator("#firstGuideOpen").click();
}
try {
  let { p, c } = await open();
  check(
    await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play")),
    "保存データのないコンパクト画面に最初の操作ガイド",
  );
  check(
    await p.locator("#dockBuild").evaluate((el) => el.classList.contains("guide-target")),
    "次に押す建設ボタンを強調",
  );
  check(!(await p.locator('[data-t="arrow"]').isVisible()), "最初はコンパクトの建設引き出しが閉じている");
  const initial = await state(p);
  await p.locator('[data-goal-act="build"]').click();
  check(
    (await p.locator('[data-t="arrow"]').isVisible()) &&
      (await p.locator('[data-t="arrow"]').evaluate((el) => el.classList.contains("guide-target"))),
    "ガイドから建設を開き、弓の塔の場所が分かる",
  );
  check(
    JSON.stringify(await state(p)) === JSON.stringify(initial),
    "建設案内を開くだけでは建設・支払いしない",
  );
  await p.locator('[data-t="arrow"]').click();
  await mapClick(p, 650, 300);
  check(
    (await state(p)).towers === 0 && (await state(p)).gold === initial.gold,
    "道への誤タップでは塔を建てず資金も消費しない",
  );
  await mapClick(p, 330, 300);
  check(
    (await state(p)).towers === 1 && (await state(p)).gold === initial.gold - 100,
    "実際に草地をタップして弓の塔を100Gで建設",
  );
  check(await p.locator('[data-goal-act="hire"]').isVisible(), "建設したら兵士雇用の案内に進む");
  const beforeHire = await state(p);
  await p.locator('[data-goal-act="hire"]').click();
  check(await p.locator("#hireToggle").isVisible(), "雇用案内から部隊の引き出しを開く");
  check(
    JSON.stringify(await state(p)) === JSON.stringify(beforeHire),
    "雇用案内を開くだけでは兵士を購入しない",
  );
  check(
    /無料/.test(await p.locator("#hireToggle").innerText()),
    "最初の1人が無料であることを既存の雇用ボタンに表示",
  );
  await p.locator("#hireToggle").click();
  check(
    (await state(p)).soldiers === 1 && (await state(p)).gold === beforeHire.gold,
    "既存の雇用ボタンから最初の兵士を無料で雇える",
  );
  check(await p.locator('[data-goal-act="deploy"]').isVisible(), "雇用後は配置の案内へ進む");
  await p.locator('[data-goal-act="deploy"]').click();
  check(
    await p.evaluate(() => !!WD_DEBUG.state().placeSquadId),
    "配置案内で待機中の部隊を選び、配置状態を維持",
  );
  check(!(await p.locator("#unitTools").isVisible()), "配置時は引き出しを閉じ、マップを操作できる");
  await mapClick(p, 500, 300);
  check((await state(p)).deployed === 0, "草地への誤タップで部隊を配置しない");
  await mapClick(p, 650, 300);
  check((await state(p)).deployed === 1, "実際の道へのタップで部隊を配置");
  check(
    (await p.locator('[data-goal-act="start"]').isVisible()) &&
      (await p.locator("#start").evaluate((el) => el.classList.contains("guide-target"))),
    "配置後はウェーブ開始ボタンを強調",
  );
  for (const width of [320, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      width + "pxでガイドと操作ボタンが横にはみ出さない",
    );
  }
  if (process.env.SCREENSHOTS) {
    fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => WD_DEBUG.heroApi.draw());
    await p.locator("#nextGoal").scrollIntoViewIfNeeded();
    await p.screenshot({ path: process.env.SCREENSHOTS + "/first-play-ready-390.png" });
  }
  await p.locator('[data-goal-act="start"]').click();
  check(
    (await state(p)).playing && !(await p.locator('[data-goal-act="start"]').count()),
    "案内から本物の戦闘を開始し、戦闘中は開始案内を重ねない",
  );
  await p.evaluate(() => {
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
  check(
    !(await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play"))),
    "最初の勝利後は初回操作ガイドを完了",
  );
  check(
    /ガチャ券/.test(await p.locator("#nextGoal").innerText()),
    "勝利後は既存の武将・世界への目標に引き継ぐ",
  );
  await p.reload();
  check(
    !(await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play"))) &&
      (await state(p)).soldiers === 1,
    "初勝利後の再読込で案内を再開せず兵士を保持",
  );
  await c.close();

  ({ p, c } = await open());
  await p.locator('[data-goal-act="build"]').click();
  await p.locator('[data-t="arrow"]').click();
  await mapClick(p, 330, 300);
  await p.evaluate(() => document.getElementById("checkpointSave").click());
  const midpoint = await state(p);
  await p.locator("#firstGuideDismiss").click();
  check(
    !(await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play"))),
    "案内を終了して通常表示へ戻れる",
  );
  check(
    await p.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.ui.v1")).firstGuideHidden === true),
    "案内を終了した設定を保存",
  );
  await p.reload();
  check(
    !(await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play"))) &&
      JSON.stringify(await state(p)) === JSON.stringify(midpoint),
    "途中保存後の再読込で終了設定・塔・資金を維持",
  );
  await reopen(p);
  check(
    !(await p.locator("#infoSheet").isVisible()) && (await p.locator('[data-goal-act="hire"]').isVisible()),
    "情報の遊び方から現在の段階でガイドを再表示",
  );
  check(
    JSON.stringify(await state(p)) === JSON.stringify(midpoint),
    "ガイドの再表示でゲーム進行や資金を変更しない",
  );
  await p.evaluate(() => document.getElementById("showAllFeatures").click());
  await p.reload();
  check(
    await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play")),
    "全機能表示に切り替えても、明示して再表示したガイドを再読込後に維持",
  );
  await c.close();

  ({ p, c } = await open({ width: 1280, layout: "classic" }));
  await p.locator('[data-goal-act="build"]').click();
  check(await p.locator('[data-t="arrow"]').isVisible(), "PCの従来表示でも建設案内の入口が使える");
  await c.close();

  ({ p, c } = await open({
    seed: {
      "worldDefense.soldiers.v1": {
        seq: 1,
        squadSeq: 1,
        squads: [{ id: 1, type: "ashigaru", slot: 0 }],
        soldiers: [{ id: 1, type: "ashigaru", squadId: 1, level: 20 }],
        fallen: [],
      },
    },
  }));
  check(
    !(await p.locator("#nextGoal").evaluate((el) => el.classList.contains("first-play"))),
    "既存セーブのプレイヤーへ初回ガイドを自動表示しない",
  );
  check((await state(p)).soldiers === 1, "既存兵士を保持");
  await p.locator("#infoOpen").click();
  await p.locator("#firstPlayHelp > summary").click();
  const help = await p.locator("#firstPlayHelp").innerText();
  check(
    /2[,，]?500|2500|2,500/.test(help) &&
      /探索/.test(help) &&
      /保存/.test(help) &&
      /最初から/.test(help) &&
      /データ消去/.test(help),
    "いつでも読める遊び方に実際の雇用・探索・保存・再開始の違いを説明",
  );
  await c.close();
  check(errors.length === 0, "初回起動・ガイド操作・保存復帰でブラウザ実行エラーなし");
  console.log(n + " checks passed");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
