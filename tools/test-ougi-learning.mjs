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
const seed = (job = "gun_commander", level = 200, prof = 8250) => ({
  seq: 1,
  squadSeq: 1,
  heroId: 1,
  squads: [{ id: 1, type: job === "sword_saint" ? "ashigaru" : "gunner", slot: 0 }],
  soldiers: [
    {
      id: 1,
      type: job === "sword_saint" ? "ashigaru" : "gunner",
      job,
      jobs: [job === "sword_saint" ? "ashigaru" : "gunner", job],
      prof: { [job]: prof },
      squadId: 1,
      level,
      name: "確認兵",
      skills: [],
      learned: [],
      chronicle: { life: "learning:" + job, bossKills: 26, bossAssists: 113, ougiBossContrib: 139 },
    },
  ],
  fallen: [],
});
async function setup(fails = 0, options = {}) {
  const result = await H.setup(seed(options.job, options.level, options.prof));
  await result.p.evaluate((fails) => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      life = s.chronicle.life;
    localStorage.setItem(
      "worldDefense.ougi.v1",
      JSON.stringify({
        version: 1,
        seq: 0,
        books: [],
        known: {},
        rolls: { [life]: fails },
        fails: { [life]: fails },
      }),
    );
  }, fails);
  await result.p.reload();
  return result;
}
async function complete(p, proto = false) {
  await p.evaluate((proto) => {
    const D = WD_DEBUG,
      Q = D.squadApi;
    D.combat.ougi.setRoll(() => 1);
    if (proto) {
      D.combat.pick(true);
      const err = D.trainingApi.startTraining("beginner");
      if (typeof err === "string") throw Error(err);
    }
    const q = D.state().squads[0];
    if (q.state !== "deployed") {
      const err = Q.deployReserve(q, 620, 300);
      if (typeof err === "string") throw Error(err);
    }
    document.getElementById("start").click();
    D.stopSpawning();
    D.addEnemy({ hp: 1, d: 0, speed: 0, unitCd: 1e9, holder: true });
    const ctx = D.autoOugiApi.context("defense"),
      e = D.state().enemies.at(-1);
    Object.assign(e, { x: q.x + 40, y: q.y, hp: 1, max: 1, kind: proto ? "boss" : "goblin" });
    for (const s of D.state().soldiers) s.cd = 1e9;
    ctx.hit(ctx.friends[0], e, 1e6);
    D.step(0.2);
  }, proto);
  await p.waitForTimeout(20);
}
const state = (p) =>
  p.evaluate(() => {
    const D = WD_DEBUG,
      K = D.combat.ougi,
      s = D.state().soldiers[0],
      v = K.save(),
      life = s.chronicle.life;
    return {
      rolls: v.rolls[life] || 0,
      fails: v.fails[life] || 0,
      known: K.known(1),
      rate: K.rate(1),
      eligible: K.eligible(1),
    };
  });
try {
  {
    const { p, c } = await setup(48);
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    let text = await p.locator("#ougiBody").innerText();
    check(
      text.includes("現在Lv200") &&
        text.includes("熟練度 10/10") &&
        text.includes("抽選：48回") &&
        text.includes("連続不発：48回") &&
        text.includes("6%") &&
        text.includes("あと2回"),
      "実際のLv・熟練・抽選回数・次回6%・天井まで2回を表示",
    );
    check(
      text.includes("139/10") && text.includes("討伐・支援回数") && text.includes("全職業合計"),
      "討伐139と抽選48を区別して表示",
    );
    const before = await state(p);
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    check(
      JSON.stringify(await state(p)) === JSON.stringify(before),
      "画面を開くだけでは抽選・習得・回数を変更しない",
    );
    await p.locator("#ougiClose").click();
    await complete(p);
    let r = await state(p);
    check(
      !r.known.length && r.fails === 49 && r.rolls === 49,
      "49回目は外れを保存し、50回目より前に天井で習得させない",
    );
    await p.reload();
    r = await state(p);
    check(!r.known.length && r.fails === 49 && r.rolls === 49, "再読込後も連続49回の不発を維持");
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    check(
      (await p.locator("#ougiBody").innerText()).includes("次の対象抽選で確定習得"),
      "50回目の対象抽選が確定であると表示",
    );
    await p.locator("#ougiClose").click();
    await complete(p);
    r = await state(p);
    check(
      r.known[0] === "kunikuzushi" && r.rolls === 50 && r.fails === 0 && r.rate === 0.02,
      "乱数が外れでも、実際のWAVE終了で50回目は確定習得。不発と率をリセット",
    );
    await p.reload();
    await p.evaluate(() => WD_DEBUG.ultimateOugiApi.flush());
    r = await state(p);
    check(r.known.length === 1 && r.rolls === 50, "再読込・再処理で天井の習得・抽選回数を増殖しない");
    await c.close();
  }
  {
    const { p, c } = await setup(139);
    check((await state(p)).known.length === 0, "旧版で139回不発でも、起動だけでは奥義を自動付与しない");
    await complete(p);
    const r = await state(p);
    check(
      r.known.length === 1 && r.fails === 0 && r.rolls === 140,
      "旧版の不発139回を引き継ぎ、次の対象抽選で確定習得",
    );
    await c.close();
  }
  {
    const { p, c } = await setup(49);
    await p.evaluate(() => {
      window.savedSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "worldDefense.ougi.v1") throw Error("quota");
        return window.savedSet.call(this, k, v);
      };
    });
    await complete(p);
    let r = await state(p);
    check(
      !r.known.length && r.fails === 49 && r.rolls === 49,
      "50回目の保存失敗では、習得・不発数・抽選回数を戻す",
    );
    await p.evaluate(() => {
      Storage.prototype.setItem = window.savedSet;
      WD_DEBUG.ultimateOugiApi.flush();
      WD_DEBUG.ultimateOugiApi.flush();
    });
    r = await state(p);
    check(r.known.length === 1 && r.fails === 0 && r.rolls === 50, "保存復旧後は同じ天井を1回だけ確定する");
    await c.close();
  }
  {
    const { p, c } = await setup(100, { level: 149, prof: 6750 });
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    const text = await p.locator("#ougiBody").innerText();
    check(
      text.includes("現在Lv149") &&
        text.includes("熟練度 9/10") &&
        text.includes("抽選条件未達成") &&
        text.includes("Lv150未満"),
      "必要条件と実際の未達成Lv149・熟練9を分けて表示",
    );
    await p.locator("#ougiClose").click();
    await complete(p);
    const r = await state(p);
    check(
      !r.known.length && r.rolls === 100 && r.fails === 100,
      "不発が天井を超えていても、資格不足のWAVEでは抽選しない",
    );
    await c.close();
  }
  {
    const { p, c } = await setup(0, { job: "sword_saint" });
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    const text = await p.locator("#ougiBody").innerText();
    check(
      text.includes("通常防衛やサバイバルでは習得抽選しません") && text.includes("新しい戦い（試作）"),
      "剣聖の習得場所の制限を奥義画面へ明記",
    );
    await p.locator("#ougiClose").click();
    await complete(p);
    check((await state(p)).rolls === 0, "剣聖は通常TDの勝利で習得抽選しない");
    await complete(p, true);
    const r = await state(p);
    check(r.rolls >= 1 && r.fails >= 1, "剣聖は修練場の試作で強敵を倒すと実際に習得抽選する");
    await c.close();
  }
  {
    const { p, c } = await setup(49);
    await p.evaluate(() => WD_DEBUG.combat.ougi.open(1));
    for (const width of [375, 390, 430, 1280]) {
      await p.setViewportSize({ width, height: 844 });
      await p.locator(".ougi-learning-status").scrollIntoViewIfNeeded();
      check(
        await p.evaluate(() => {
          const sh = document.querySelector("#ougiSheet .sheet"),
            b = document.querySelector("#ougiClose").getBoundingClientRect();
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            sh.scrollWidth <= sh.clientWidth + 1 &&
            b.top >= 0 &&
            b.bottom <= innerHeight
          );
        }),
        "抽選状況" + width + "px：横はみ出しなし・スクロール後も閉じるボタンを表示",
      );
      if (process.env.SCREENSHOTS) {
        fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
        await p.screenshot({ path: process.env.SCREENSHOTS + "/ougi-learning-" + width + ".png" });
      }
    }
    await c.close();
  }
  check(!H.errors.length, "JavaScriptエラーなし：" + H.errors.join(","));
  console.log("結果: " + n + " 件成功 / 0 件失敗");
} finally {
  await H.close();
}
