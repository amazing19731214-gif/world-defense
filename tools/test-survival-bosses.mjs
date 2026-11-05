// サバイバル：3面ごとの巨大ボス10種。実際の出現・予告攻撃・宝箱・モバイル表示。
// 先に node tools/build.mjs を実行し、node tools/test-survival-bosses.mjs で確認する。
import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
import { trialAssetsPreserved } from "./trial-save-test-utils.mjs";

const H = await harness();
const shots = process.env.SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });
const screenshot = async (p, name) => {
  if (shots) await p.screenshot({ path: shots + "/survival-bosses-" + name + ".png", fullPage: true });
};
let n = 0;
const check = (ok, message, detail) => {
  assert.ok(ok, message + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  console.log("✓ " + message);
  n++;
};
const seed = {
  version: 1,
  seq: 2,
  squadSeq: 1,
  heroId: 1,
  squads: [{ id: 1, type: "ashigaru", slot: 0 }],
  soldiers: [1, 2].map((id) => ({
    id,
    type: "ashigaru",
    job: "ashigaru",
    jobs: ["ashigaru"],
    squadId: 1,
    level: 300,
    bestLevel: 300,
    xp: 0,
    name: "巨敵試験" + id,
    skills: [],
    learned: [],
  })),
  fallen: [],
};
async function open() {
  const ctx = await H.setup(seed);
  await ctx.p.waitForFunction(() => window.WD_DEBUG?.survivalBossApi);
  // 読み込み時の旧形式変換を、比較する基準に含める。
  await ctx.p.evaluate(() => WD_DEBUG.squadApi.saveRoster());
  return ctx;
}
const storage = (p) =>
  p.evaluate(() =>
    JSON.stringify(
      Object.fromEntries(
        Object.keys(localStorage)
          .sort()
          .map((key) => [key, localStorage.getItem(key)]),
      ),
    ),
  );
async function start(p, floor = 1, mode = "survival") {
  return p.evaluate(
    ({ floor, mode }) => {
      const T = WD_DEBUG.trial;
      if (T.on()) T.retreat();
      document.getElementById("trialSheet").hidden = true;
      const error = T.start([1, 2], { mode, hero: 1, seed: 4242 });
      if (error) throw new Error(error);
      const L = T.live();
      L.floor = floor;
      L.next = 1e9;
      L.rivalChecked = true;
      return { phase: L.phase, units: L.units.length };
    },
    { floor, mode },
  );
}
async function spawn(p, floor) {
  await start(p, floor);
  return p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.st = T.survival.bossAt;
    WD_DEBUG.step(0.05);
    WD_DEBUG.heroApi.draw();
    const b = L.boss;
    return (
      b && {
        name: b.name,
        great: !!b.great,
        id: b.survivalBoss?.id,
        index: b.survivalBoss?.index,
        hp: b.hp,
        max: b.max,
        armor: b.armor,
        speed: b.speed,
        atkMul: b.atkMul,
        lv: b.lv,
        r: b.r,
        visualHeight: b.survivalBoss?.visualHeight,
        visualScale: b.survivalBoss?.visualScale,
        count: L.enemies.filter((e) => !e.gone && e.role === "boss").length,
        enemies: L.enemies.filter((e) => !e.gone).length,
      }
    );
  });
}
// キャンバスの HUD も含め、実際に描画した文字を採る。
const display = (p) =>
  p.evaluate(() => {
    const texts = [],
      contexts = [...document.querySelectorAll("canvas")]
        .map((canvas) => canvas.getContext("2d"))
        .filter(Boolean),
      originals = contexts.map((context) => context.fillText);
    contexts.forEach((context, i) => {
      context.fillText = function (text, ...args) {
        texts.push(String(text));
        return originals[i].call(this, text, ...args);
      };
    });
    try {
      WD_DEBUG.heroApi.draw();
    } finally {
      contexts.forEach((context, i) => {
        context.fillText = originals[i];
      });
    }
    const banner = WD_DEBUG.combat.fx().banner;
    return {
      text: [document.getElementById("trialInfo").textContent, banner?.name, banner?.who, ...texts].join(" "),
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });

try {
  let { p, c } = await open();
  let r = await p.evaluate(() => {
    const A = WD_DEBUG.survivalBossApi;
    return {
      count: Object.values(A.list).length,
      methods: ["forFloor", "apply", "tick", "damageMul", "moveMul", "stageMul"].every(
        (k) => typeof A[k] === "function",
      ),
      ordinary: [1, 2, 4, 5, 7, 8].map((floor) => A.forFloor(floor)),
      profiles: Array.from({ length: 10 }, (_, i) => A.forFloor((i + 1) * 3)),
    };
  });
  check(r.count === 10 && r.methods, "巨大ボス10種と戦闘用のデバッグAPIがある", r);
  check(
    r.ordinary.every((profile) => profile === null),
    "3の倍数以外の面は巨大ボスの対象にしない",
    r.ordinary,
  );
  const profiles = r.profiles;
  check(
    profiles.every((b, i) => b && b.index === i) &&
      new Set(profiles.map((b) => b.id)).size === 10 &&
      new Set(profiles.map((b) => b.name)).size === 10,
    "第3〜30面で、名前とIDが異なる10種を順番に選ぶ",
    profiles.map((b) => b && [b.index, b.id, b.name]),
  );
  check(
    profiles.every((b) => b.move && b.color && b.shape) &&
      new Set(profiles.map((b) => b.move)).size === 10 &&
      new Set(profiles.map((b) => b.color + "/" + b.shape)).size === 10,
    "10種には別々の行動と見分けられる外見がある",
    profiles.map((b) => [b.move, b.color, b.shape]),
  );
  check(
    profiles.every(
      (b, i) =>
        Number.isFinite(b.recLevel) &&
        Number.isFinite(b.enemyLevel) &&
        b.enemyLevel > 0 &&
        (i === 0 || b.recLevel > profiles[i - 1].recLevel),
    ) && profiles[9].recLevel >= 1000,
    "推奨Lvは順に上がり、最後の巨大ボスはLv1000以上を勧める",
    profiles.map((b) => [b.recLevel, b.enemyLevel]),
  );

  await p.evaluate(() => {
    document.getElementById("trialOpen").click();
    document.querySelector('[data-trial-mode="survival"]').click();
  });
  r = await p.locator("#trialBody").textContent();
  check(
    /3\s*面/.test(r) && /10\s*(種類|種|体)/.test(r) && /1,?000/.test(r),
    "出撃前に3面ごと・10種・最終推奨Lv1000を案内する",
    r,
  );

  for (const floor of [1, 2, 4, 5]) {
    const b = await spawn(p, floor);
    check(
      b && !b.great && !b.id && b.count === 1 && Number.isFinite(b.max) && b.max > 0,
      "第" + floor + "面は従来の通常大将が1体出る",
      b,
    );
  }
  const bosses = [];
  for (let i = 0; i < 10; i++) {
    const floor = (i + 1) * 3,
      b = await spawn(p, floor);
    bosses.push(b);
    check(
      b &&
        b.great &&
        b.index === i &&
        b.id === profiles[i].id &&
        b.name === profiles[i].name &&
        b.count === 1 &&
        [b.hp, b.max, b.armor, b.speed, b.atkMul, b.lv, b.r].every(Number.isFinite) &&
        b.hp > 0 &&
        b.max > 0 &&
        b.atkMul > 0,
      "第" + floor + "面で「" + profiles[i].name + "」が実際に1体出現する",
      b,
    );
  }
  check(
    profiles.every(
      (b, i) =>
        Number.isFinite(b.visualHeight) &&
        b.visualHeight > 0 &&
        (i === 0 || b.visualHeight > profiles[i - 1].visualHeight),
    ) &&
      bosses.every(
        (b, i) =>
          Number.isFinite(b.visualHeight || b.visualScale) &&
          (i === 0 ||
            (b.visualHeight || b.visualScale) > (bosses[i - 1].visualHeight || bosses[i - 1].visualScale)) &&
          b.r > 0 &&
          b.r <= 115 &&
          (i === 0 || b.r > bosses[i - 1].r),
      ),
    "巨大ボスは1〜10体目まで絵の大きさと実際の半径が順番に増す",
    bosses.map((b) => [b.r, b.visualHeight, b.visualScale]),
  );
  r = await display(p);
  check(
    r.text.includes(profiles[9].name) && /1,?000/.test(r.text),
    "最終巨大ボスの戦闘中に名前と推奨Lv1000を表示する",
    r,
  );
  const later = await spawn(p, 33);
  check(
    later.id === profiles[9].id &&
      later.max > bosses[9].max &&
      later.atkMul > bosses[9].atkMul &&
      later.r === bosses[9].r &&
      later.visualHeight === bosses[9].visualHeight &&
      later.visualScale === bosses[9].visualScale,
    "第33面以降も最終型が強くなって再登場し、10体目の大きさを維持する",
    { final: bosses[9], later },
  );
  r = await spawn(p, 30000);
  check(
    r &&
      r.id === profiles[9].id &&
      [r.hp, r.max, r.armor, r.speed, r.atkMul, r.lv, r.r].every(Number.isFinite) &&
      r.max > 0 &&
      r.atkMul > 0 &&
      r.r === bosses[9].r &&
      r.visualHeight === bosses[9].visualHeight &&
      r.visualScale === bosses[9].visualScale,
    "非常に先の面でも巨大ボスの能力が有限で、NaNやInfinityにならない",
    r,
  );
  await start(p, 1);
  const rivalBase = await p.evaluate(() => {
    WD_DEBUG.trial.rivalSpawn("masayuki");
    return WD_DEBUG.trial.live().rival.atkMul;
  });
  for (const floor of [3, 5, 30]) {
    await start(p, floor);
    r = await p.evaluate((rivalBase) => {
      const T = WD_DEBUG.trial,
        L = T.live(),
        G = T.stages;
      T.rivalSpawn("masayuki");
      const e = L.rival,
        expectedAtk =
          rivalBase *
          (L.floor % 5 === 0 ? G.great.atk : 1) *
          WD_DEBUG.survivalBossApi.stageMul(G.atkStep, L.floor);
      return {
        rival: !!e?.rival,
        lv: e?.lv,
        expectedLv: L.level,
        atk: e?.atkMul,
        expectedAtk,
        giant: !!e?.survivalBossId,
      };
    }, rivalBase);
    check(
      r.rival && !r.giant && r.lv === r.expectedLv && Math.abs(r.atk - r.expectedAtk) < 1e-8,
      "第" + floor + "面の乱入武将は従来の強さを保ち、巨大ボスの専用補正を受けない",
      r,
    );
  }
  await c.close();

  // 実際に倒す → 宝箱を開ける → 一度だけ受け取る → 次の面。
  ({ p, c } = await open());
  const baseline = await storage(p);
  await spawn(p, 3);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      blocked = T.nextStage();
    L.boss.hp = 1;
    L.units[0].survivalBossSlow = { until: L.t + 100, mul: 0.65 };
    T.hitEnemy(L.boss, 1e12);
    WD_DEBUG.step(0.05);
    const at = L.st,
      ch = JSON.stringify(L.chest),
      blockedChest = T.nextStage();
    WD_DEBUG.step(2);
    return {
      blocked,
      blockedChest,
      floor: L.floor,
      cleared: L.cleared?.stage,
      bosses: L.bosses,
      chest: L.chest?.state,
      rewards: L.rewards.length,
      stopped: at === L.st && ch === JSON.stringify(L.chest),
      slowCleared: !L.units[0].survivalBossSlow,
    };
  });
  check(
    typeof r.blocked === "string" && typeof r.blockedChest === "string" && r.floor === 3,
    "撃破前と未受取の宝箱がある間は、次の面へ飛ばせない",
    r,
  );
  check(
    r.cleared === 3 &&
      r.bosses === 1 &&
      r.chest === "closed" &&
      r.rewards === 0 &&
      r.stopped &&
      r.slowCleared,
    "巨大ボスを倒すと一度だけクリアし、戦闘を止めて既存の宝箱を出す",
    r,
  );
  await p.evaluate(() => WD_DEBUG.trial.chestOpen());
  await p.waitForFunction(() => WD_DEBUG.trial.live().chest?.state === "open", null, { polling: 50 });
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      take = T.chestTake(),
      duplicateTake = T.chestTake();
    while (L.choice) T.choose(0);
    const rewardCount = L.rewards.length,
      next = T.nextStage(),
      duplicateNext = T.nextStage();
    return {
      take,
      duplicateTake,
      rewardCount,
      next,
      duplicateNext,
      floor: L.floor,
      boss: !!L.boss,
      chest: L.chest,
      cleared: L.cleared,
      bosses: L.bosses,
    };
  });
  check(
    r.take === null && typeof r.duplicateTake === "string" && r.rewardCount === 1,
    "巨大ボスの宝箱報酬を一度だけ受け取り、重複付与しない",
    r,
  );
  check(
    r.next === null &&
      typeof r.duplicateNext === "string" &&
      r.floor === 4 &&
      !r.boss &&
      !r.chest &&
      !r.cleared &&
      r.bosses === 1,
    "次の面へ一度だけ進み、巨大ボスと宝箱の一時状態を消す",
    r,
  );
  await p.evaluate(() => WD_DEBUG.trial.retreat());
  check(
    await trialAssetsPreserved(p, baseline),
    "巨大ボスの撃破・報酬・撤退で本来の兵士や装備などを変更しない（既存の持ち帰り規則を除く）",
  );
  await c.close();

  ({ p, c } = await open());
  await start(p, 3);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.st = T.survival.bossAt - 0.05;
    T.pause(true);
    const at = L.st;
    WD_DEBUG.step(2);
    const paused = { same: L.st === at, boss: !!L.boss };
    T.pause(false);
    WD_DEBUG.step(0.1);
    const b = L.boss;
    b.survivalBoss.cooldown = 0;
    WD_DEBUG.step(0.05);
    T.pause(true);
    const before = JSON.stringify({ t: L.t, hp: L.units[0].hp, state: b.survivalBoss });
    WD_DEBUG.step(2);
    return {
      paused,
      resumed: !!b.survivalBoss,
      frozen: before === JSON.stringify({ t: L.t, hp: L.units[0].hp, state: b.survivalBoss }),
    };
  });
  check(
    r.paused.same && !r.paused.boss && r.resumed && r.frozen,
    "停止中は巨大ボスの出現も予告攻撃も進まず、再開後に出現する",
    r,
  );
  await start(p, 3, "explore");
  r = await p.evaluate(() => {
    const L = WD_DEBUG.trial.live();
    L.st = 151;
    WD_DEBUG.step(0.1);
    return {
      mode: L.mode,
      explore: !!L.explore,
      floor: L.floor,
      boss: !!L.boss,
      specials: L.enemies.filter((e) => e.survivalBoss).length,
    };
  });
  check(
    r.explore && r.floor === 3 && !r.boss && r.specials === 0,
    "探索は第3地・150秒を超えても巨大ボスを出さない",
    r,
  );
  await c.close();

  // 通常攻撃を止め、実戦のコマ処理で予告された範囲攻撃だけを受ける／歩いて避ける。
  ({ p, c } = await open());
  const volley = async (dodge) => {
    await spawn(p, 6);
    return p.evaluate((dodge) => {
      const T = WD_DEBUG.trial,
        L = T.live(),
        h = L.units[0],
        e = L.boss,
        S = e.survivalBoss;
      L.skills = {};
      h.cd = 1e9;
      Object.assign(e, { x: h.x + 400, y: h.y, speed: 0, cd: 1e9 });
      S.cooldown = 0;
      const hp = h.hp;
      WD_DEBUG.step(0.05);
      const w = S.warning,
        zone = w && { ...w.zones[0] },
        warned = !!(
          w &&
          w.kind === "volley" &&
          w.at - L.t >= 0.9 &&
          w.zones.some((z) => z.shape === "circle" && Math.hypot(h.x - z.x, h.y - z.y) <= z.r)
        ),
        noEarlyDamage = hp === h.hp;
      if (!w) return { warned, noEarlyDamage };
      const from = { x: h.x, y: h.y };
      if (dodge) T.stick(1, 0);
      for (let i = 0; i < 60 && S.warning; i++) WD_DEBUG.step(0.05);
      T.stick(0, 0);
      const after = h.hp,
        hits = S.hits;
      WD_DEBUG.step(0.5);
      return {
        warned,
        noEarlyDamage,
        damage: hp - after,
        hits,
        attacks: S.attacks,
        settled: !S.warning,
        once: h.hp === after && S.hits === hits,
        moved: Math.hypot(h.x - from.x, h.y - from.y),
        radius: zone.r,
      };
    }, dodge);
  };
  const stood = await volley(false);
  check(
    stood.warned && stood.noEarlyDamage,
    "百矢の雨は足もとに0.9秒以上の予告を出し、予告中は傷つけない",
    stood,
  );
  check(
    stood.settled && stood.damage > 0 && stood.hits === 1 && stood.attacks === 1 && stood.once,
    "予告の円に残ると実際にダメージを受け、同じ一撃を重複して受けない",
    stood,
  );
  const dodged = await volley(true);
  check(
    dodged.settled && dodged.moved > dodged.radius && dodged.damage === 0 && dodged.hits === 0,
    "スティックで予告の円から歩いて出ると百矢の雨を避けられる",
    dodged,
  );
  await spawn(p, 9);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      e = L.boss;
    L.skills = {};
    L.units[0].cd = 1e9;
    e.cd = 1e9;
    e.speed = 0;
    const before = e.hp;
    T.hitEnemy(e, 1000);
    const plain = before - e.hp;
    e.survivalBoss.cooldown = 0;
    WD_DEBUG.step(0.05);
    const guardedHp = e.hp;
    T.hitEnemy(e, 1000);
    return { plain, guarded: guardedHp - e.hp, until: e.survivalBoss.guardUntil, t: L.t };
  });
  check(
    r.plain > 0 && r.guarded > 0 && r.guarded < r.plain * 0.6 && r.until > r.t,
    "鉄壁の玄将は守りの構え中に受ける実ダメージを減らす",
    r,
  );
  await spawn(p, 30);
  r = await p.evaluate(() => {
    const L = WD_DEBUG.trial.live(),
      e = L.boss;
    L.skills = {};
    e.hp = e.max * 0.49;
    WD_DEBUG.step(0.05);
    e.survivalBoss.cooldown = 0;
    WD_DEBUG.step(0.05);
    return { phase: e.survivalBoss.phase, zones: e.survivalBoss.warning?.zones.map((z) => z.shape) };
  });
  check(
    r.phase === 2 && r.zones?.includes("circle") && r.zones.includes("ring"),
    "最終巨大ボスはHP半分で覚醒し、複数の予告範囲を組み合わせる",
    r,
  );
  await c.close();

  // 第30面の小さなエンディングから続ける。以後の巨大ボスでは繰り返さない。
  ({ p, c } = await open());
  for (const width of [320, 390, 1280]) {
    await p.setViewportSize({ width, height: 844 });
    await spawn(p, 30);
    await p.evaluate(() => {
      const L = WD_DEBUG.trial.live(),
        h = L.units[0],
        b = L.boss;
      Object.assign(b, { x: h.x + 170, y: h.y + 60, px: h.x + 170, py: h.y + 60 });
      WD_DEBUG.heroApi.draw();
    });
    const fight = await display(p);
    await screenshot(p, "final-fight-" + width);
    const ending = await p.evaluate(() => {
      const T = WD_DEBUG.trial,
        L = T.live();
      L.boss.hp = 1;
      T.hitEnemy(L.boss, 1e12);
      WD_DEBUG.step(0.05);
      const box = document.getElementById("trialMiniEnding"),
        notice = !!(box && !box.hidden && box.getClientRects().length),
        before = JSON.stringify({ floor: L.floor, rewards: L.rewards, chest: L.chest, t: L.t }),
        blockedNext = T.nextStage(),
        blockedChest = T.chestOpen();
      WD_DEBUG.step(2);
      return {
        notice,
        text: box?.textContent,
        miniEnding: !!L.miniEnding && !L.miniEnding.dismissed,
        seen: L.miniEndingSeen,
        continue: !!box?.querySelector('[data-trial-chest="ending"]'),
        end: !!box?.querySelector('[data-trial-chest="end"]'),
        blocked: typeof blockedNext === "string" && typeof blockedChest === "string",
        stopped: before === JSON.stringify({ floor: L.floor, rewards: L.rewards, chest: L.chest, t: L.t }),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    await screenshot(p, "mini-ending-" + width);
    check(
      fight.overflow <= 1 &&
        fight.text.includes(profiles[9].name) &&
        ending.overflow <= 1 &&
        ending.notice &&
        /ここから先|これから先/.test(ending.text) &&
        /おまけ/.test(ending.text) &&
        /高難度/.test(ending.text) &&
        ending.continue &&
        ending.end &&
        ending.miniEnding &&
        ending.seen &&
        ending.blocked &&
        ending.stopped,
      "幅" + width + "pxで最終巨大ボスと一度目のクリア案内が収まり、終了か続行を選ぶまで止まる",
      { fight, ending },
    );
    await p.locator('#trialMiniEnding [data-trial-chest="ending"]').click();
    const chest = await p.evaluate(() => {
      const L = WD_DEBUG.trial.live(),
        box = document.getElementById("trialMiniEnding");
      return {
        dismissed: !L.miniEnding || L.miniEnding.dismissed,
        notice: !!(box && !box.hidden && box.getClientRects().length),
        dialog: !!document.querySelector('[data-trial-chest="open"]'),
        state: L.chest?.state,
        rewards: L.rewards.length,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    await screenshot(p, "final-chest-" + width);
    check(
      chest.dismissed &&
        !chest.notice &&
        chest.dialog &&
        chest.state === "closed" &&
        chest.rewards === 0 &&
        chest.overflow <= 1,
      "幅" + width + "pxで続行を選ぶと未受取の宝箱をそのまま開けられる",
      chest,
    );
    await p.evaluate(() => WD_DEBUG.trial.chestOpen());
    await p.waitForFunction(() => WD_DEBUG.trial.live().chest?.state === "open", null, { polling: 50 });
    r = await p.evaluate(() => {
      const T = WD_DEBUG.trial,
        L = T.live();
      T.chestTake();
      while (L.choice) T.choose(0);
      const next = T.nextStage(),
        floor = L.floor,
        rewards = L.rewards.length;
      // 第31〜32面の経過だけ短縮し、同じ挑戦のまま第33面の再戦を倒す。
      L.floor = 33;
      L.st = T.survival.bossAt;
      L.next = 1e9;
      L.rivalChecked = true;
      WD_DEBUG.step(0.05);
      L.boss.hp = 1;
      T.hitEnemy(L.boss, 1e12);
      WD_DEBUG.step(0.05);
      const box = document.getElementById("trialMiniEnding");
      return {
        next,
        floor,
        rewards,
        seen: L.miniEndingSeen,
        active: !!L.miniEnding && !L.miniEnding.dismissed,
        notice: !!(box && !box.hidden && box.getClientRects().length),
        chest: L.chest?.state,
        totalRewards: L.rewards.length,
      };
    });
    check(
      r.next === null &&
        r.floor === 31 &&
        r.rewards === 1 &&
        r.seen &&
        !r.active &&
        !r.notice &&
        r.chest === "closed" &&
        r.totalRewards === 1,
      "幅" + width + "pxで第31面へ続行し、第33面の再撃破ではエンディングや報酬を重複しない",
      r,
    );
  }
  await c.close();

  // 「ここで終える」は未開封の宝箱を使わず、獲得済みEXPだけを一度持ち帰る。
  // 手動で拾う3EXPに、撃破した大ボスが落とす1EXPもクリア時に加わる。
  ({ p, c } = await open());
  await p.evaluate(() => localStorage.setItem("worldDefense.trialBest.v1", '{"stage":12}'));
  const endingBaseline = await storage(p);
  await spawn(p, 30);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    for (let i = 0; i < 3; i++) T.drop(h.x, h.y);
    WD_DEBUG.step(0.1);
    L.boss.hp = 1;
    T.hitEnemy(L.boss, 1e12);
    WD_DEBUG.step(0.05);
    return {
      coins: h.carryCoins,
      rewards: L.rewards.length,
      chest: L.chest?.state,
      notice: !!document.querySelector('#trialMiniEnding [data-trial-chest="end"]'),
    };
  });
  check(
    r.coins === 4 && r.rewards === 0 && r.chest === "closed" && r.notice,
    "第30面の終了案内でも拾ったEXPと未開封の宝箱を区別する",
    r,
  );
  await p.locator('#trialMiniEnding [data-trial-chest="end"]').click();
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      result = T.result(),
      xp = () => WD_DEBUG.state().soldiers.map((s) => s.xp),
      once = xp();
    T.retreat();
    T.saveCarryXp(result.carryXp);
    return {
      on: T.on(),
      result: result.result,
      endingCleared: result.endingCleared,
      awards: result.carryXp.awards.map((a) => a.amount),
      saved: result.carryXp.saved,
      rewards: result.rewardList.length,
      once,
      twice: xp(),
      best: localStorage.getItem("worldDefense.trialBest.v1"),
    };
  });
  check(
    !r.on &&
      r.result === "win" &&
      r.endingCleared &&
      r.saved &&
      r.awards.join() === "4" &&
      r.once.join() === "4,0" &&
      r.twice.join() === "4,0" &&
      r.rewards === 0 &&
      r.best === '{"stage":12}',
    "終了を選ぶと獲得済みEXPだけ一度保存し、未開封報酬と既存の最高記録を変更しない",
    r,
  );
  check(
    await trialAssetsPreserved(p, endingBaseline),
    "エンディングで終えても兵士・装備などの恒久資産を失わない",
  );
  await p.reload();
  await p.waitForFunction(() => window.WD_DEBUG, null, { polling: 50 });
  r = await p.evaluate(() => ({ xp: WD_DEBUG.state().soldiers.map((s) => s.xp), on: WD_DEBUG.trial.on() }));
  check(r.xp.join() === "4,0" && !r.on, "エンディング終了後に読み直してもEXPの一度だけの保存を維持する", r);
  await c.close();
  check(H.errors.length === 0, "ページのエラーなし", H.errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await H.close();
}
