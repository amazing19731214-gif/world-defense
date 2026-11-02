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
const seed = (level = 100) => ({
  seq: 3,
  squadSeq: 1,
  heroId: 1,
  squads: [{ id: 1, type: "ashigaru", slot: 0 }],
  soldiers: [1, 2, 3].map((id) => ({
    id,
    type: "ashigaru",
    job: "ashigaru",
    jobs: ["ashigaru"],
    squadId: 1,
    level,
    bestLevel: level,
    xp: 0,
    name: "同行" + id,
    skills: [],
    learned: [],
  })),
  fallen: [],
});
const start = async (p, mode = "survival") => {
  assert.equal(
    await p.evaluate((mode) => WD_DEBUG.trial.start([1, 2, 3], { mode, hero: 1, seed: 4242 }), mode),
    null,
  );
};
const gain = (p, xp) => p.evaluate((xp) => WD_DEBUG.trial.gainXp(WD_DEBUG.trial.live(), xp), xp);
const retire = (p) =>
  p.evaluate(() => {
    WD_DEBUG.trial.retreat();
    return WD_DEBUG.trial.result();
  });
const xp = (p) => p.evaluate(() => WD_DEBUG.state().soldiers.map((s) => s.xp));
const join = (p) =>
  p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.choice = [{ kind: "recruit", unit: L.reserve[0] }];
    L.lvUps = 1;
    return T.choose(0);
  });
try {
  let { p, c } = await H.setup(seed());
  await p.locator("#checkpointSave").click();
  const defenseBefore = await p.evaluate(() =>
    JSON.stringify(JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).defense),
  );
  await start(p);
  // 実際のコイン回収経路。回収しなかったコインは持ち帰りに含めない。
  let r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    for (let i = 0; i < 25; i++) T.drop(h.x, h.y - 10);
    T.drop(h.x + 1000, h.y);
    WD_DEBUG.step(0.1);
    return { coins: h.carryCoins, exp: L.xpTotal };
  });
  check(r.coins === 25 && r.exp === 25, "実コインを拾った分だけ持ち帰り対象へ加算");
  check(
    (await xp(p)).every((v) => v === 0),
    "挑戦中は兵士本来の経験値・能力を変更しない",
  );
  check((await join(p)) === null, "レベルアップ選択から実際に候補を加入");
  await gain(p, 15);
  r = await retire(p);
  check(
    r.carryXp.saved && r.carryXp.awards.map((a) => a.amount).join() === "4,1",
    "主役は全回収分、途中加入は加入後の分の10%・端数切捨て",
  );
  check((await xp(p)).join() === "4,1,0", "同行した2人だけに配布し、未加入の待機候補は対象外");
  check(
    await p.evaluate(
      (expected) =>
        JSON.stringify(JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).defense) === expected,
      defenseBefore,
    ),
    "経験値の持ち帰りで防衛のWAVE・HP・配置・軍資金を変更しない",
  );
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[0].prof.ashigaru === 4),
    "持ち帰りEXPは通常の職業熟練度にも反映",
  );
  await retire(p);
  await p.evaluate(() => WD_DEBUG.trial.saveCarryXp(WD_DEBUG.trial.result().carryXp));
  check((await xp(p)).join() === "4,1,0", "終了の重複呼出し・保存の再試行で二重加算しない");
  await p.reload();
  check((await xp(p)).join() === "4,1,0", "再読み込み後も配布済み経験値を維持");
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await start(p);
  await gain(p, 20);
  await join(p);
  await gain(p, 20);
  await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      u = L.units[1];
    L.st = 10;
    u.hp = 0.001;
    T.hitUnit(u, 1e9, false, { kind: "goblin" });
  });
  await gain(p, 20);
  r = await retire(p);
  check((await xp(p)).join() === "6,2,0", "サバイバルの仮の戦死では倒れるまでの参加分だけ残る");
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers.every((s) => s.alive)),
    "サバイバルでは兵士を実際に戦死させない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await start(p, "explore");
  await gain(p, 40);
  const id = await p.evaluate(() => {
    const L = WD_DEBUG.trial.live(),
      v = L.map.villages[0];
    v.state = "found";
    v.guards = [];
    WD_DEBUG.step(0.1);
    return L.units[1].id;
  });
  await gain(p, 20);
  r = await retire(p);
  check(
    r.carryXp.awards.map((a) => a.amount).join() === "6,2",
    "探索で村から加わった兵士は加入後の回収分だけ受け取る",
  );
  check(
    await p.evaluate((id) => WD_DEBUG.state().soldiers.find((s) => s.id === id).xp === 2, id),
    "探索の仲間の経験値も本番名簿に残る",
  );
  check((await xp(p)).slice(1, 3).join() === "0,0", "探索に選んだだけで連れていない兵士は対象外");
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await start(p, "explore");
  await gain(p, 40);
  const deadId = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      v = L.map.villages[0];
    v.state = "found";
    v.guards = [];
    WD_DEBUG.step(0.1);
    const u = L.units[1];
    T.gainXp(L, 20);
    L.st = 10;
    u.hp = 0.001;
    T.hitUnit(u, 1e9, false, { kind: "goblin" });
    return u.id;
  });
  r = await retire(p);
  check(!r.carryXp.awards.some((a) => a.id === deadId), "探索の実際の戦死者には追加経験値を配布しない");
  check(
    await p.evaluate((id) => !WD_DEBUG.state().soldiers.some((s) => s.id === id && s.alive), deadId),
    "経験値処理で探索の戦死者を復活させない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await start(p, "explore");
  await gain(p, 100);
  await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.st = 10;
    h.hp = 0.001;
    T.hitUnit(h, 1e9, false, { kind: "goblin" });
    WD_DEBUG.step(0.1);
  });
  check(
    await p.evaluate(() => {
      const s = WD_DEBUG.state().soldiers[0];
      return s.level === 1 && s.xp === 0 && WD_DEBUG.trial.result().carryXp.awards.length === 0;
    }),
    "探索で倒れた主人公のLv1再出発に経験値を上乗せしない",
  );
  await c.close();

  ({ p, c } = await H.setup(seed(1)));
  await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    s.xp = 29;
    s.hp = 10;
    D.squadApi.saveRoster();
  });
  await start(p);
  await gain(p, 10);
  r = await retire(p);
  check(
    await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      return s.level === 2 && s.xp === 0 && s.hp === 10 && D.chronicleApi.growthRanks(s).gains.hp > 0;
    }),
    "レベルアップは既存の成長適性で反映し現在HPを回復しない",
  );
  check(
    r.carryXp.awards[0].before === 1 && r.carryXp.awards[0].after === 2,
    "結果に持ち帰りによるレベル上昇も記録",
  );
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[0].level === 2),
    "レベル・成長・経験値をまとめて保存",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await start(p);
  await gain(p, 100);
  await p.evaluate(() => {
    window.oldSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw Error("save fault");
    };
  });
  r = await retire(p);
  check(!r.carryXp.saved && r.carryXp.applied, "ログを保存できなければ保存待ちと表示");
  check(await p.locator("[data-trial-xp-save]").isVisible(), "保存失敗時に結果画面へ再試行ボタンを表示");
  await p.locator("[data-trial-xp-save]").click();
  check((await xp(p))[0] === 10, "連続した保存失敗でも経験値を二重加算しない");
  await p.evaluate(() => (Storage.prototype.setItem = window.oldSet));
  await p.locator("[data-trial-xp-save]").click();
  check(
    await p
      .locator(".trial-carry-xp")
      .innerText()
      .then((t) => t.includes("保存しました")),
    "再試行成功後は保存済みと表示",
  );
  await p.reload();
  check((await xp(p))[0] === 10, "失敗からの再試行・再読込でも正確に一度だけ取得");
  await c.close();

  for (const key of ["worldDefense.soldiers.v1", "worldDefense.warlords.v1"]) {
    ({ p, c } = await H.setup(seed()));
    await start(p);
    await gain(p, 100);
    await p.evaluate((key) => {
      const old = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === key) throw Error("stage fault");
        return old.call(this, k, v);
      };
    }, key);
    r = await retire(p);
    check(r.carryXp.saved, "確定ログ後の転記失敗も保存成功として扱う：" + key);
    await p.reload();
    check((await xp(p))[0] === 10, "確定ログから経験値を一度だけ復旧：" + key);
    await c.close();
  }
  ({ p, c } = await H.setup(seed()));
  await start(p);
  await gain(p, 100);
  await p.reload();
  check((await xp(p))[0] === 0, "終了前に閉じた挑戦の未確定経験値は持ち越さない");
  await c.close();
  ({ p, c } = await H.setup(seed()));
  await start(p);
  await gain(p, 9);
  r = await retire(p);
  check(
    r.carryXp.saved && !r.carryXp.awards.length && (await xp(p))[0] === 0,
    "10EXP未満の端数だけでは持ち帰り経験値なし",
  );
  await c.close();
  ({ p, c } = await H.setup(seed()));
  await start(p);
  await gain(p, 100);
  const other = await c.newPage();
  await other.goto(p.url());
  await other.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    s.name = "別タブ保存";
    D.squadApi.saveRoster();
  });
  r = await retire(p);
  check(!r.carryXp.saved, "別タブ保存を検出した画面から経験値を上書きしない");
  await p.reload();
  check(
    await p.evaluate(
      () => WD_DEBUG.state().soldiers[0].name === "別タブ保存" && WD_DEBUG.state().soldiers[0].xp === 0,
    ),
    "別タブの最新セーブを保持",
  );
  await c.close();

  ({ p, c } = await H.setup(seed()));
  await start(p);
  await gain(p, 100);
  await retire(p);
  for (const width of [375, 390, 430, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      width + "pxで持ち帰り経験値の結果が横にはみ出さない",
    );
  }
  if (process.env.SCREENSHOTS) {
    fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.screenshot({ path: process.env.SCREENSHOTS + "/carry-xp-390.png" });
  }
  await c.close();
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
