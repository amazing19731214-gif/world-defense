// 修練場の高難度（v102）：極級 Lv500〜1000・天級 Lv1000〜2000・神級 Lv2000〜3500。
// 敵Lvの上がり方・HPの補正・報酬・記録・画面と、極級の実際の挑戦（クリア）を確かめる。
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
function soldiers(lv) {
  const types = ["spearman", "cavalry", "archer", "medic"],
    save = { seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
  for (let q = 1; q <= 4; q++) {
    save.squads.push({ id: q, type: types[q - 1], slot: q - 1 });
    for (let k = 0; k < 10; k++)
      save.soldiers.push({ id: (q - 1) * 10 + k + 1, type: types[q - 1], squadId: q, level: lv, pts: { atk: Math.floor((lv - 1) * 1.5), def: Math.ceil((lv - 1) * 1.5), spd: 0, rng: 0 } });
  }
  return save;
}
async function open(width, lv, rafOff = true) {
  const c = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 600, hasTouch: width < 600 });
  await c.addInitScript(
    ({ save, rafOff }) => {
      if (rafOff) requestAnimationFrame = () => 0;
      if (location.protocol !== "http:" || sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.ui.v1", '{"all":true}');
    },
    { save: soldiers(lv), rafOff },
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:" + server.address().port + "/?debug");
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
try {
  let { c, p } = await open(390, 500);
  let r = await p.evaluate(() => {
    const T = WD_DEBUG.trainingApi,
      X = T.TRAINING,
      range = (key, waves) => [1, waves].map((w) => T.trainLevel({ D: X.diffs[key], waves }, w));
    return {
      order: X.order.join(),
      kyoku: [range("kyoku", 10), range("kyoku", 100)],
      ten: [range("ten", 10), range("ten", 50)],
      shin: [range("shin", 10), range("shin", 20)],
      gold: ["super", "kyoku", "ten", "shin"].map((k) => X.diffs[k].gold),
      hpMul: ["beginner", "advanced", "super", "kyoku", "ten", "shin", "endless"].map((k) => X.diffs[k].hpMul || 1),
    };
  });
  check(r.order === "beginner,advanced,super,kyoku,ten,shin,endless", "超級と無限の間に極級・天級・神級", r.order);
  check(
    r.kyoku.every((x) => x.join() === "500,1000") && r.ten.every((x) => x.join() === "1000,2000") && r.shin.every((x) => x.join() === "2000,3500"),
    "敵Lvは選んだウェーブ数で 500→1000・1000→2000・2000→3500",
    r,
  );
  check(r.gold.join() === "3,4,5,6", "報酬の倍率は超級3・極級4・天級5・神級6", r.gold);
  check(r.hpMul.join() === "1,1,1,1,0.8,0.5,1", "天級0.8倍・神級0.5倍の敵HP補正、既存の難易度と無限は変えない", r.hpMul);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trainingApi,
      X = T.TRAINING,
      rnd = Math.random,
      out = {};
    Math.random = () => 0.99; // 同じ兵種（足軽）で比べる
    for (const key of ["super", "kyoku", "ten", "shin", "endless"]) {
      const e = T.trainingEnemy({ D: X.diffs[key], waves: 10, wave: 3 }, 0, 30);
      out[key] = +(e.max / (X.base[e.kind][0] * X.hp(e.lv))).toFixed(6);
    }
    Math.random = rnd;
    return out;
  });
  check(r.super === 1 && r.kyoku === 1 && r.ten === 0.8 && r.shin === 0.5 && r.endless === 1, "実際に出る敵のHP：天級0.8倍・神級0.5倍、ほかは今まで通り", r);
  await p.evaluate(() => document.getElementById("trainingOpen").click());
  const labels = await p.locator("[data-tr-diff]").allInnerTexts();
  check(
    labels.length === 7 && /極級.*500〜1000.*Lv500〜/s.test(labels[3]) && /天級.*1000〜2000/s.test(labels[4]) && /神級.*2000〜3500/s.test(labels[5]),
    "修練場の画面に7つの難易度と敵Lv・おすすめを表示",
    labels,
  );
  await p.locator('[data-tr-diff="shin"]').tap();
  check(/神級・10ウェーブに挑戦する/.test(await p.locator("#trStart").innerText()), "神級を選ぶと挑戦ボタンも神級");
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "390pxで横にはみ出さない");
  await c.close();
  ({ c, p } = await open(375, 500));
  await p.evaluate(() => document.getElementById("trainingOpen").click());
  check(
    await p.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        [...document.querySelectorAll("[data-tr-diff]")].every((b) => b.getBoundingClientRect().right <= innerWidth && b.getBoundingClientRect().height >= 44),
    ),
    "375pxでも7つのボタンが画面内・44px以上",
  );
  await c.close();

  // ===== 極級の実際の挑戦：推奨Lv500の40人で10ウェーブをクリア =====
  ({ c, p } = await open(390, 500));
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state,
      A = WD_DEBUG.squadApi,
      T = WD_DEBUG.trainingApi,
      pts = [[300, 165], [300, 440], [620, 300], [780, 300]];
    S().squads.forEach((q, i) => A.deployReserve(q, ...pts[i]));
    const gold0 = S().gold,
      err = T.startTraining("kyoku", 10);
    if (err) return { err };
    for (let i = 0; i < 200000 && T.training(); i++) {
      if (!S().playing) document.getElementById("start").click();
      WD_DEBUG.step(0.1);
    }
    return { msg: document.getElementById("msg").textContent, gold: S().gold - gold0, rec: T.trainingSave().clears.kyoku, best: T.trainingSave().best.kyoku };
  });
  check(/修練場クリア！（極級）/.test(r.msg) && r.gold === 10 * 10 * 4 + 50 * 4, "推奨Lv500の40人で極級10ウェーブをクリア、報酬は倍率4（600G）", r);
  check(r.rec === 1 && r.best && r.best.level === 1000, "極級のクリア回数と最高到達Lvを記録", r);
  await p.reload();
  check((await p.evaluate(() => WD_DEBUG.trainingApi.trainingSave().clears.kyoku)) === 1, "再読み込み後も極級の記録を保持");
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
