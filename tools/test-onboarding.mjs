// 初心者向け：機能の段階開放と「次の目標」。保存データのない起動から実際の操作で進め、既存セーブは全機能のまま。
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
const URL_ = "http://127.0.0.1:" + server.address().port + "/?debug";
const UKEY = "worldDefense.ui.v1",
  CKEY = "worldDefense.conquest.v1";
const LOCKABLE = ["mapOpen", "gacha", "zukanOpen", "heroGrowth", "gearOpen", "trainingOpen", "forgeOpen"];
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
// seed：最初の読み込みの前だけ保存データを置く（再読み込みでは置き直さない）
async function open(width = 390, seed = null) {
  const c = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 600, hasTouch: width < 600 });
  await c.addInitScript((seed) => {
    if (location.protocol !== "http:" || sessionStorage.seeded) return;
    sessionStorage.seeded = "1";
    if (seed) for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, seed);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(URL_);
  return { c, p };
}
const visible = (p) =>
  p.evaluate((ids) => ids.filter((id) => !document.getElementById(id).hidden), LOCKABLE);
const goal = (p) => p.locator("#nextGoal").innerText();
async function tapMap(p, x, y) {
  const pt = await p.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return { x: r.left + c.clientLeft + (x * c.clientWidth) / 960, y: r.top + c.clientTop + (y * c.clientHeight) / 600 };
    },
    [x, y],
  );
  await p.touchscreen.tap(pt.x, pt.y);
}
async function clearWave(p) {
  await p.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
}
// 日本・海外の領土を保存データとして作る。owned：領土にする条件
function conquestSeed(owned, extra = {}) {
  return async (p) =>
    p.evaluate(
      ({ owned, extra, CKEY }) => {
        const A = WD_DEBUG.squadApi,
          castles = {},
          f = new Function("P", "id", "return " + owned);
        for (const id of A.PROVINCE_ORDER) {
          const P = A.PROVINCES[id];
          if (!P.castle) continue;
          const o = !!f(P, id);
          castles[P.castle] = { captured: o, wins: +o, attempts: +o };
        }
        localStorage.setItem(CKEY, JSON.stringify({ version: 2, castles, ...extra }));
      },
      { owned, extra, CKEY },
    );
}
try {
  // ===== 保存データのない最初の起動 =====
  let { c, p } = await open();
  check(
    (await visible(p)).join() === "gacha" &&
      (await p.locator("#reset").isVisible()) &&
      (await p.locator("#wipeData").isVisible()) &&
      (await p.locator("#checkpointSave").isVisible()),
    "最初は開始時の券があるガチャと、最初から・データ消去・途中保存だけ表示",
    await visible(p),
  );
  check(/全機能を表示（あと6）/.test(await p.locator("#showAllFeatures").innerText()), "隠した機能の数を「全機能を表示」に表示");
  check(/次の目標：塔のボタンを選び、草地をタップして建設しよう/.test(await goal(p)), "最初の目標は塔の建設");
  check(!(await p.locator("#toast").isVisible()), "起動時には解放のお知らせを出さない");
  check(
    await p.evaluate((k) => JSON.parse(localStorage.getItem(k)).all === false, UKEY),
    "最初の起動を初心者として記録",
  );
  await p.locator('[data-t="arrow"]').tap();
  await tapMap(p, 330, 300);
  check(
    (await p.evaluate(() => WD_DEBUG.state().towers.length)) === 1 && /「＋ 雇う」で兵士を雇おう/.test(await goal(p)),
    "塔を建てると、次は兵士の雇用を案内",
  );
  await p.locator("#hireToggle").tap();
  check(/部隊のボタンを押し、道をタップして配置しよう/.test(await goal(p)), "雇うと部隊の配置を案内");
  await p.locator("#squadChips button").first().tap();
  await tapMap(p, 650, 300);
  check(
    (await p.evaluate(() => WD_DEBUG.state().squads.some((q) => q.state === "deployed"))) &&
      /ウェーブ開始」で敵を迎え撃とう/.test(await goal(p)),
    "配置するとウェーブ開始を案内",
  );
  await p.reload();
  check(
    (await visible(p)).join() === "gacha" && (await p.evaluate(() => WD_DEBUG.state().wave)) === 0,
    "ほかの保存データができても、再読み込み後も初心者の表示を維持",
  );
  await clearWave(p);
  check(/ガチャ券で武将を仲間にしよう/.test(await goal(p)), "1ウェーブ後、開始時の券でガチャを案内");
  await p.locator("#nextGoal [data-goal-act]").tap();
  check(await p.locator("#gachaSheet").isVisible(), "目標の「開く」でガチャ画面を開く");
  await p.evaluate(() => {
    for (let i = 0; i < 3; i++) document.getElementById("gachaPull").click();
    document.getElementById("gachaClose").click();
  });
  check(
    !(await p.locator("#gacha").evaluate((b) => b.classList.contains("feature-new"))),
    "一度押した機能は「新しい」印を外す",
  );
  check(
    (await visible(p)).includes("zukanOpen") && /WAVE 3まで守り抜こう/.test(await goal(p)),
    "武将を得ると図鑑が開き、次はWAVE 3を案内",
  );
  await clearWave(p);
  check(!(await visible(p)).includes("mapOpen"), "WAVE 2では世界はまだ隠す");
  await clearWave(p);
  check(
    (await visible(p)).includes("mapOpen") &&
      (await p.locator("#mapOpen").evaluate((b) => b.classList.contains("feature-new"))) &&
      /世界 が使えるようになりました/.test(await p.locator("#toast").innerText()),
    "WAVE 3で「世界」を開き、お知らせと印を付ける",
  );
  check(/日本から尾張の.*を攻めよう/.test(await goal(p)), "次は最初の城攻めを案内");
  await p.locator("#nextGoal [data-goal-act]").tap();
  check(await p.locator("#mapSheet").isVisible(), "目標の「開く」で世界地図を開く");
  check(
    !(await p.locator("#mapOpen").evaluate((b) => b.classList.contains("feature-new"))),
    "世界を開くと印を外す",
  );
  await p.evaluate(() => document.getElementById("mapClose")?.click());
  {
    const r = await p.evaluate(() => {
      const A = WD_DEBUG.squadApi;
      A.setCounterRng(() => 1);
      const err = A.setTarget(A.PROVINCES.owari.castle) || A.startBattle();
      const during = document.getElementById("nextGoal").hidden;
      A.endBattle("win");
      return { err, during };
    });
    check(!r.err && r.during, "攻城戦の間は目標を隠す", r);
  }
  check(
    ["heroGrowth", "gearOpen", "trainingOpen"].every((id) => LOCKABLE.includes(id)) &&
      (await visible(p)).filter((id) => ["heroGrowth", "gearOpen", "trainingOpen"].includes(id)).length === 3,
    "最初の城を取ると主人公・装備倉庫・修練場を開く",
  );
  check(/最初の7か国を統一しよう（2\/7）/.test(await goal(p)), "次は7か国の統一を進捗つきで案内");
  await p.evaluate(() => document.getElementById("reset").click()).catch(() => {});
  await p.reload();
  check((await visible(p)).includes("heroGrowth"), "最初から・再読み込みでも開いた機能は隠さない");
  await p.locator("#showAllFeatures").tap();
  check(
    (await visible(p)).length === LOCKABLE.length && (await p.locator("#showAllFeatures").isHidden()),
    "「全機能を表示」で全部表示し、ボタンを消す",
  );
  await p.reload();
  check((await visible(p)).length === LOCKABLE.length, "全機能の表示を再読み込み後も保持");
  p.on("dialog", (d) => d.accept());
  await p.locator("#wipeData").click();
  await p.waitForLoadState("load");
  await p.waitForFunction(() => window.WD_DEBUG);
  check((await visible(p)).join() === "gacha", "データ消去で初心者の表示に戻る");
  await c.close();

  // ===== 既存のセーブ（表示の記録なし）=====
  ({ c, p } = await open(390, { "worldDefense.settings.v1": JSON.stringify({ auto: false }) }));
  check(
    (await visible(p)).length === LOCKABLE.length && (await p.locator("#showAllFeatures").isHidden()),
    "表示の記録がない既存セーブは最初から全機能を表示",
  );
  for (const [owned, extra, re, text] of [
    ['P.chapter === "japan"', { tenka: true, unified: true }, /第2章「朝鮮半島」を制覇しよう（0\/8）/, "天下統一後は次の章を案内"],
    ['P.chapter === "japan" && id !== "tsushima"', { unified: true }, /天下統一を目指そう（67\/68）/, "天下統一前は68か国の進捗を案内"],
    ['P.chapter !== "russia" || id !== "ru_moskva"', { tenka: true, unified: true }, /第7章「ロシア」を制覇しよう（7\/8）/, "最終章の進捗を案内"],
    ["true", { tenka: true, unified: true }, /世界征服達成！/, "世界征服後はやり込みを案内"],
  ]) {
    await conquestSeed(owned, extra)(p);
    await p.reload();
    check(re.test(await goal(p)), text, await goal(p));
  }
  await p.evaluate((k) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, v) {
      if (key === k) throw Error("ui save fault");
      return set.call(this, key, v);
    };
  }, UKEY);
  await p.locator("#showAllFeatures").evaluate((b) => b.click());
  await clearWave(p);
  check(!errors.length, "表示の記録を保存できなくても遊び続けられる", errors);
  await c.close();

  // ===== スマホ・PCの表示 =====
  for (const width of [375, 390, 430, 1280]) {
    ({ c, p } = await open(width));
    await clearWave(p);
    const ok = await p.evaluate(() => {
      const g = document.getElementById("nextGoal"),
        b = g.querySelector("button");
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        g.getBoundingClientRect().right <= innerWidth &&
        (!b || b.getBoundingClientRect().height >= 44) &&
        document.getElementById("showAllFeatures").getBoundingClientRect().height >= 44
      );
    });
    check(ok, width + "pxで目標の行が画面内、ボタン44px以上");
    if (process.env.SCREENSHOTS && width === 390) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/onboarding-390.png" });
    }
    await c.close();
  }
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
