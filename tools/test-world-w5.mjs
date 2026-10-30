// W5: 旧108拠点を維持。進行は勝敗指定、地形は実際の時間進行で検証する。
import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/world-v94.json", import.meta.url)));
const CKEY = "worldDefense.conquest.v1",
  WKEY = "worldDefense.warlords.v1";
const route = [
  "malabar",
  "deccan",
  "gujarat",
  "sindh",
  "makran",
  "hormuz",
  "oman",
  "arabia",
  "mesopotamia",
  "levant",
  "anatolia",
  "nile",
].map((x) => "me_" + x);
let n = 0;
const check = (ok, text) => {
  assert.ok(ok, text);
  n++;
  console.log("✓ " + text);
};
async function seed(p, { southeast = true, middleeast = [], lost = [], world, tickets = 0 } = {}) {
  await p.evaluate(
    ({ southeast, middleeast, lost, world, tickets, CKEY, WKEY }) => {
      const A = WD_DEBUG.squadApi,
        castles = {};
      localStorage.clear();
      for (const id of A.PROVINCE_ORDER) {
        const P = A.PROVINCES[id];
        if (!P.castle) continue;
        const owned =
          !lost.includes(id) &&
          (P.chapter === "japan" ||
            P.chapter === "korea" ||
            P.chapter === "china" ||
            (P.chapter === "southeast" && southeast) ||
            middleeast.includes(id));
        castles[P.castle] = { captured: owned, wins: owned ? 1 : 0, attempts: owned ? 1 : 0 };
      }
      localStorage.setItem(CKEY, JSON.stringify({ version: 2, castles, tenka: true, unified: true, world }));
      localStorage.setItem(WKEY, JSON.stringify({ owned: {}, tickets }));
      const types = ["spearman", "cavalry", "archer", "medic"],
        save = { seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
      for (let q = 1; q <= 4; q++) {
        save.squads.push({ id: q, type: types[q - 1], slot: q - 1 });
        for (let k = 0; k < 10; k++)
          save.soldiers.push({
            id: (q - 1) * 10 + k + 1,
            type: types[q - 1],
            squadId: q,
            level: 2300,
            pts: { atk: 3448, def: 3449, spd: 0, rng: 0 },
          });
      }
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
    },
    { southeast, middleeast, lost, world, tickets, CKEY, WKEY },
  );
  await p.reload();
}
async function fight(p, id, result = "win") {
  return p.evaluate(
    ({ id, result }) => {
      const A = WD_DEBUG.squadApi;
      A.setCounterRng(() => 1);
      const err = A.setTarget(A.PROVINCES[id].castle) || A.startBattle();
      if (err) return { err };
      const B = A.battle();
      A.endBattle(result);
      return {
        owned: A.ownsProvince(id),
        tickets: WD_DEBUG.heroApi.save().tickets,
        text: document.getElementById("battleBody").textContent,
        result: B.result,
      };
    },
    { id, result },
  );
}
async function terrain(p, id = "me_deccan", d = 300) {
  await seed(p, { middleeast: ["me_malabar", "me_deccan"] });
  return p.evaluate(
    ({ id, d }) => {
      const A = WD_DEBUG.squadApi;
      A.setTarget(A.PROVINCES[id].castle);
      const err = A.startBattle();
      if (err) throw Error(err);
      const B = A.battle();
      B.garrison = [];
      B.towers = [];
      B.nextUnit = 4;
      for (const g of B.groups) g.state = "empty";
      const g = B.groups[0];
      g.state = "march";
      g.d = d;
      Object.assign(g, WD_DEBUG.pathAt(g.path, d));
    },
    { id, d },
  );
}
try {
  const { p, c } = await H.setup();
  let r = await p.evaluate((b) => {
    const A = WD_DEBUG.squadApi,
      changes = [];
    for (const id of b.PROVINCE_ORDER)
      for (const k of Object.keys(b.PROVINCES[id])) {
        let v = A.PROVINCES[id][k];
        if (k === "adj") v = v.filter((id) => b.PROVINCES[id]);
        if (k === "routes") v = Object.fromEntries(Object.entries(v).filter(([id]) => b.PROVINCES[id]));
        if (JSON.stringify(v) !== JSON.stringify(b.PROVINCES[id][k])) changes.push(id + "." + k);
      }
    return {
      changes,
      castles: Object.keys(b.NPC_CASTLES).filter(
        (id) => JSON.stringify(A.NPC_CASTLES[id]) !== JSON.stringify(b.NPC_CASTLES[id]),
      ),
      defense: JSON.stringify(WD_DEBUG.unitConfig.ENEMY_VS_UNIT) === JSON.stringify(b.ENEMY_VS_UNIT),
    };
  }, baseline);
  check(!r.changes.length && !r.castles.length, "v94の既存108拠点のID・接続・レベル・城・守備隊・報酬を維持");
  check(r.defense, "通常防衛・修練場の敵設定は変更しない");
  await seed(p, { southeast: false });
  await p.locator("#mapOpen").click();
  check(
    (await p.locator("[data-map-chapter]").count()) === 7 &&
      (await p.locator('[data-map-chapter="middleeast"]').isDisabled()),
    "世界の第五章は東南アジア制覇まで閉じる",
  );
  check(
    /？？？.*東南アジアを制覇/s.test(await p.locator('[data-map-chapter="middleeast"]').innerText()),
    "未解放カードに名前を隠し解放条件を表示",
  );
  check(
    /東南アジア.*解放/.test(await p.evaluate(() => WD_DEBUG.squadApi.setTarget("me_fort_malabar"))),
    "未解放ならAPIからも出陣不可",
  );
  await seed(p, { lost: ["se_molucca"] });
  check(
    await p.evaluate(() => !WD_DEBUG.squadApi.chapterUnlocked("middleeast")),
    "東南アジアに未制圧拠点があれば開かない",
  );
  r = await fight(p, "se_molucca");
  check(!r.err && /次の章「中東・インド」/.test(r.text), "東南アジア最後の勝利で第五章へ案内");
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.squadApi.chapterUnlocked("middleeast")),
    "新章解放を再読み込み後も保持",
  );
  await seed(p);
  check(
    await p.evaluate(
      () => WD_DEBUG.squadApi.chapterUnlocked("middleeast") && WD_DEBUG.heroApi.save().tickets === 0,
    ),
    "world項目のない旧制覇セーブから解放し、移行だけでは報酬を配らない",
  );
  await seed(p, { southeast: false, world: { cleared: { southeast: true } } });
  check(
    await p.evaluate(
      () =>
        WD_DEBUG.squadApi.chapterUnlocked("middleeast") && !WD_DEBUG.squadApi.canAttackProvince("me_malabar"),
    ),
    "過去に制覇済みなら失地後も解放、航路元の領土は必要",
  );
  await seed(p);
  await p.locator("#mapOpen").click();
  check(
    /推奨Lv1750〜2300/.test(await p.locator('[data-map-chapter="middleeast"]').innerText()),
    "章カードに連続する推奨Lv1750〜2300を表示",
  );
  await p.locator('[data-map-chapter="middleeast"]').click();
  check(
    /中東・インド 0\/12/.test(await p.locator("#mapTitle").innerText()) &&
      (await p.locator("[data-map-road]").count()) === 4,
    "12拠点を4地域にまとめる",
  );
  check(
    /砂漠.*85%.*攻撃・回復間隔.*12拠点.*12枚/s.test(await p.locator("#mapBody").innerText()),
    "砂漠の効果と初回制覇報酬を明示",
  );
  await p.locator('[data-map-road="me_west"]').click();
  check(
    /？？？/.test(await p.locator("#mapBody").innerText()) &&
      !/双陽の都城|天穹の砦/.test(await p.locator("#mapBody").innerText()),
    "未発見の拠点名・城名を隠す",
  );
  check(
    /発見/.test(await p.evaluate(() => WD_DEBUG.squadApi.setTarget("me_fort_nile"))),
    "未発見拠点への直接出陣を拒否",
  );
  r = await p.evaluate((route) => {
    const A = WD_DEBUG.squadApi;
    return {
      total: A.PROVINCE_ORDER.length,
      levels: route.map((id) => A.NPC_CASTLES[A.PROVINCES[id].castle].enemyLevel),
      regions: Object.keys(A.CHAPTERS.middleeast.roads).map(
        (r) => A.chapterProvinces("middleeast").filter((id) => A.PROVINCES[id].road === r).length,
      ),
      discovered: A.chapterProvinces("middleeast").filter(A.provinceDiscovered),
      link: A.PROVINCES.se_straits.routes.me_malabar,
      boss: A.NPC_CASTLES.me_fort_nile.garrison.some((g) => g.kind === "boss"),
    };
  }, route);
  check(r.total === 140 && r.regions.every((n) => n === 3), "全140拠点、中東は3拠点ずつの4地域");
  check(
    r.levels.every((lv, i) => lv === 1750 + i * 50),
    "12拠点の敵Lvと推奨Lvを50刻みで設定",
  );
  check(
    r.discovered.join() === "me_malabar" && r.link === "西洋航路",
    "最初は西洋航路の入口だけが発見される",
  );
  check(r.boss, "最終拠点に名将の守備隊を配置");
  for (const result of ["lose", "timeup", "retreat"]) {
    await seed(p);
    r = await fight(p, "me_malabar", result);
    check(!r.err && !r.owned && r.tickets === 0, result + "では占領も初回報酬も得ない");
  }
  await terrain(p);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      g = B.groups[0],
      start = g.d;
    WD_DEBUG.step(1);
    const desert = g.d - start;
    B.terrain = [];
    g.d = start;
    WD_DEBUG.step(1);
    return { ratio: desert / (g.d - start), rate: A.battleStats(g, g.list[0]).rate };
  });
  check(Math.abs(r.ratio - 0.85) < 1e-8, "実戦の砂漠では進軍距離だけが平地の85%");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      g = B.groups[0],
      before = A.battleStats(g, g.list[0]);
    B.terrain = ["desert"];
    g.d = 470;
    WD_DEBUG.step(1);
    return {
      distance: g.d - 470,
      same: JSON.stringify(A.battleStats(g, g.list[0])) === JSON.stringify(before),
    };
  });
  check(Math.abs(r.distance - 38) < 1e-8 && r.same, "砂漠を抜ければ通常速度、攻撃・防御・間隔は変わらない");
  r = await p.evaluate(() => {
    const B = WD_DEBUG.squadApi.battle(),
      g = B.groups[0];
    g.d = 300;
    WD_DEBUG.playbackApi.setMode("paused");
    WD_DEBUG.step(1);
    const stopped = g.d;
    WD_DEBUG.playbackApi.setMode("x2");
    WD_DEBUG.step(0.5);
    return { stopped, distance: g.d - stopped };
  });
  check(r.stopped === 300 && Math.abs(r.distance - 38 * 0.85) < 1e-8, "停止中は進軍停止、倍速は砂漠にも適用");
  await terrain(p);
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.squadApi,
      B = A.battle(),
      g = B.groups[0],
      s = g.list[0];
    g.list = [s];
    s.cd = 0;
    const point = D.pathAt(g.path, 330),
      stats = A.siegeEnemyStats("goblin", 1750);
    const e = {
      ...stats,
      ...point,
      kind: "goblin",
      path: g.path,
      d: 330,
      hp: 1e8,
      max: 1e8,
      attack: 1000,
      cd: 0,
      r: 13,
      reward: 10,
    };
    B.garrison = [e];
    const hp = s.hp;
    D.step(0.05);
    return { attack: e.hp < 1e8, hurt: s.hp < hp, d: g.d };
  });
  check(r.attack && r.hurt && r.d === 300, "砂漠の交戦中も味方の攻撃と敵の攻撃が継続");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.squadApi,
      B = A.battle(),
      g = B.groups[0],
      med = B.groups[3];
    B.garrison = [];
    med.state = "fight";
    med.path = g.path;
    med.d = g.d;
    Object.assign(med, D.pathAt(med.path, med.d));
    med.list = [med.list[0]];
    med.list[0].cd = 0;
    const s = g.list[0];
    s.hp = A.soldierStats(s).maxHp * 0.4;
    const hp = s.hp;
    D.step(0.05);
    return s.hp > hp;
  });
  check(r, "砂漠の区間でも衛生兵の実際の回復が働く");
  const positions = [];
  for (const frame of [0.05, 1 / 60]) {
    await terrain(p, "me_deccan", 250);
    positions.push(
      await p.evaluate((frame) => {
        WD_DEBUG.step(10, frame);
        return WD_DEBUG.squadApi.battle().groups[0].d;
      }, frame),
    );
  }
  check(Math.abs(positions[0] - positions[1]) < 1e-6, "砂漠の出入りで20fpsと60fpsの進軍距離が一致");
  await seed(p, { middleeast: route.slice(0, 8) });
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setTarget("me_fort_mesopotamia");
    A.startBattle();
    WD_DEBUG.heroApi.draw();
    return { terrain: A.battle().terrain, text: document.getElementById("battleInfo").textContent };
  });
  check(
    r.terrain.join() === "desert,river" && /地形：砂漠・渡河/.test(r.text),
    "砂漠と川の併用を実際の戦闘画面へ反映",
  );
  await seed(p);
  const before = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    return [
      A.startGold(),
      A.territoryBonus("waveGold"),
      A.territoryBonus("hire"),
      A.territoryBonus("repair"),
    ];
  });
  for (const id of route) {
    r = await fight(p, id);
    check(!r.err && r.owned, id + "の隣接進軍・占領に成功");
  }
  check(
    r.tickets === 25 && /中東・インドを制覇/.test(r.text) && /領土 12\/12拠点/.test(r.text),
    "初回12城の13枚＋章制覇12枚を付与",
  );
  check(
    !/世界征服達成|完全クリア！|天下統一！/.test(r.text),
    "章制覇を世界征服・裏ボス完全クリア・天下統一と混同しない",
  );
  check(
    await p.evaluate(() => {
      const w = WD_DEBUG.squadApi.conquestMeta().world;
      return w.cleared.middleeast && w.rewards.middleeast;
    }),
    "制覇と報酬受領印を保存",
  );
  check(
    JSON.stringify(before) ===
      JSON.stringify(
        await p.evaluate(() => {
          const A = WD_DEBUG.squadApi;
          return [
            A.startGold(),
            A.territoryBonus("waveGold"),
            A.territoryBonus("hire"),
            A.territoryBonus("repair"),
          ];
        }),
      ),
    "海外占領で既存の国内経済ボーナスを変えない",
  );
  await p.reload();
  r = await fight(p, "me_nile");
  check(r.tickets === 25, "再読み込み・演習で初回報酬を繰り返さない");
  await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.conquest().me_fort_nile.captured = false;
    A.persistConquest();
  });
  r = await fight(p, "me_nile");
  check(r.tickets === 25, "再占領でも章報酬・城報酬を二重取得しない");
  await seed(p, { middleeast: ["me_malabar"] });
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setCounterRng(() => 0);
    return A.maybeCounter("middleeast");
  });
  check(r?.province === "me_malabar" && r?.from === "me_deccan", "反撃は同じ章の隣の拠点から来る");
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.squadApi.activeCounter()?.province === "me_malabar"),
    "反撃を再読み込み後も維持",
  );
  r = await p.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      document.getElementById("start").click();
      WD_DEBUG.stopSpawning();
      WD_DEBUG.state().enemies.length = 0;
      WD_DEBUG.step(0.1);
    }
    const A = WD_DEBUG.squadApi;
    return !A.activeCounter() && A.ownsProvince("me_malabar");
  });
  check(r, "防衛10ウェーブで反撃を退け領土を維持");
  await seed(p, { middleeast: ["me_malabar"] });
  await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.conquestMeta().counter = { province: "me_malabar", from: "me_deccan" };
    A.persistConquest();
  });
  await p.reload();
  r = await p.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    for (let i = 0; i < 25; i++) WD_DEBUG.addEnemy({ kind: "wolf", d: 1000 + i, hp: 1e9, speed: 400 });
    WD_DEBUG.step(5);
    const A = WD_DEBUG.squadApi;
    return WD_DEBUG.state().over && !A.ownsProvince("me_malabar") && !A.activeCounter();
  });
  check(r, "反撃の防衛敗北では領土を失う");
  await p.reload();
  check(
    await p.evaluate(() => {
      const A = WD_DEBUG.squadApi;
      return A.chapterUnlocked("middleeast") && A.provinceDiscovered("me_deccan");
    }),
    "失地後も解放・発見履歴を保持",
  );
  for (const failKey of ["worldDefense.bookTransaction.v1", CKEY, WKEY, "worldDefense.soldiers.v1"]) {
    await seed(p, { middleeast: route.slice(0, -1), tickets: 11 });
    await p.evaluate((failKey) => {
      const A = WD_DEBUG.squadApi;
      A.setCounterRng(() => 1);
      A.setTarget("me_fort_nile");
      A.startBattle();
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === failKey) throw Error("W5 save fault");
        return set.call(this, k, v);
      };
      try {
        A.endBattle("win");
      } finally {
        Storage.prototype.setItem = set;
      }
    }, failKey);
    await p.reload();
    r = await p.evaluate(() => {
      const A = WD_DEBUG.squadApi;
      return {
        owned: A.ownsProvince("me_nile"),
        reward: !!A.conquestMeta().world.rewards.middleeast,
        tickets: WD_DEBUG.heroApi.save().tickets,
      };
    });
    check(
      failKey.endsWith("bookTransaction.v1")
        ? !r.owned && !r.reward && r.tickets === 11
        : r.owned && r.reward && r.tickets === 25,
      "保存障害後の領土・受領印・券が整合：" + failKey,
    );
    await p.reload();
    check(
      (await p.evaluate(() => WD_DEBUG.heroApi.save().tickets)) === r.tickets,
      "保存復旧後も二重配布しない：" + failKey,
    );
  }
  await seed(p, {
    southeast: false,
    world: { unlocked: { middleeast: "yes" }, cleared: { southeast: "yes" }, discovered: { me_nile: 1 } },
  });
  check(
    await p.evaluate(
      () =>
        !WD_DEBUG.squadApi.chapterUnlocked("middleeast") && !WD_DEBUG.squadApi.provinceDiscovered("me_nile"),
    ),
    "壊れたフラグから不正に解放しない",
  );
  await c.close();
  for (const width of [375, 390, 430, 1280]) {
    const { p, c } = await H.setup();
    await p.setViewportSize({ width, height: 844 });
    await seed(p, { middleeast: ["me_malabar"] });
    await p.locator("#mapOpen").click();
    await p.locator('[data-map-chapter="middleeast"]').click();
    await p.locator('[data-map-road="me_india"]').click();
    await p.locator('[data-map-prov="me_deccan"]').click();
    check(
      await p.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          [...document.querySelectorAll("#mapBody button")]
            .filter((e) => e.getClientRects().length)
            .every((e) => e.getBoundingClientRect().height >= 44),
      ),
      width + "pxで地図・拠点詳細が画面内、ボタン44px以上",
    );
    if (process.env.SCREENSHOTS && width === 390) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/w5-entry-390.png" });
    }
    await c.close();
  }
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  if (H.errors.length) console.log(H.errors);
  await H.close();
}
