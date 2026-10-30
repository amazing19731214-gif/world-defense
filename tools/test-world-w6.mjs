// W6・W7: 旧120拠点を維持。ヨーロッパ・ロシアの進行・地形・報酬・世界征服を検証する。
import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/world-v95.json", import.meta.url)));
const CKEY = "worldDefense.conquest.v1",
  WKEY = "worldDefense.warlords.v1";
const europe = [
  "balkan",
  "hellas",
  "italia",
  "pannonia",
  "bohemia",
  "alps",
  "gallia",
  "iberia",
  "flanders",
  "germania",
  "baltic",
  "britannia",
].map((x) => "eu_" + x);
const russia = ["novgorod", "smolensk", "arkhangelsk", "vologda", "ural", "siberia", "volga", "moskva"].map(
  (x) => "ru_" + x,
);
let n = 0;
const check = (ok, text) => {
  assert.ok(ok, text);
  n++;
  console.log("✓ " + text);
};
// upto：この章より前の章をすべて領土にする。extra：追加で領土にする拠点。
async function seed(p, { upto = "europe", extra = [], lost = [], world, tickets = 0, tenka = true } = {}) {
  await p.evaluate(
    ({ upto, extra, lost, world, tickets, tenka, CKEY, WKEY }) => {
      const A = WD_DEBUG.squadApi,
        castles = {},
        limit = A.CHAPTER_ORDER.indexOf(upto);
      localStorage.clear();
      for (const id of A.PROVINCE_ORDER) {
        const P = A.PROVINCES[id];
        if (!P.castle) continue;
        const owned = !lost.includes(id) && (A.CHAPTER_ORDER.indexOf(P.chapter) < limit || extra.includes(id));
        castles[P.castle] = { captured: owned, wins: owned ? 1 : 0, attempts: owned ? 1 : 0 };
      }
      localStorage.setItem(CKEY, JSON.stringify({ version: 2, castles, tenka, unified: true, world }));
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
            level: 3300,
            pts: { atk: 4948, def: 4949, spd: 0, rng: 0 },
          });
      }
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
    },
    { upto, extra, lost, world, tickets, tenka, CKEY, WKEY },
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
// 守備隊・塔を外して1部隊だけ進軍させ、地形の速度を測る。
async function marchRatio(p, id, d) {
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
      const terrain = B.terrain.slice();
      WD_DEBUG.step(1);
      const slow = g.d - d;
      B.terrain = [];
      g.d = d;
      WD_DEBUG.step(1);
      const plain = g.d - d;
      B.terrain = terrain;
      WD_DEBUG.heroApi.draw();
      return { terrain, ratio: slow / plain, text: document.getElementById("battleInfo").textContent };
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
      order: A.PROVINCE_ORDER.slice(0, b.PROVINCE_ORDER.length).join() === b.PROVINCE_ORDER.join(),
      castles: Object.keys(b.NPC_CASTLES).filter(
        (id) => JSON.stringify(A.NPC_CASTLES[id]) !== JSON.stringify(b.NPC_CASTLES[id]),
      ),
      defense: JSON.stringify(WD_DEBUG.unitConfig.ENEMY_VS_UNIT) === JSON.stringify(b.ENEMY_VS_UNIT),
    };
  }, baseline);
  check(
    !r.changes.length && !r.castles.length && r.order,
    "v95の既存120拠点のID・並び・接続・レベル・城・守備隊・報酬を維持",
  );
  check(r.defense, "通常防衛・修練場の敵設定は変更しない");

  // ===== 第六章：ヨーロッパ =====
  await seed(p, { upto: "middleeast", extra: [] });
  await p.locator("#mapOpen").click();
  check(
    (await p.locator("[data-map-chapter]").count()) === 7 &&
      (await p.locator('[data-map-chapter="europe"]').isDisabled()) &&
      (await p.locator('[data-map-chapter="russia"]').isDisabled()),
    "世界は7章、ヨーロッパ・ロシアは閉じている",
  );
  check(
    /第6章 🔒 ？？？.*中東・インドを制覇/s.test(await p.locator('[data-map-chapter="europe"]').innerText()) &&
      /第7章 🔒 ？？？.*ヨーロッパを制覇/s.test(await p.locator('[data-map-chapter="russia"]').innerText()),
    "未解放カードは名前を隠し解放条件を表示",
  );
  check(
    /中東・インド.*解放/.test(await p.evaluate(() => WD_DEBUG.squadApi.setTarget("eu_fort_balkan"))) &&
      /ヨーロッパ.*解放/.test(await p.evaluate(() => WD_DEBUG.squadApi.setTarget("ru_fort_novgorod"))),
    "未解放ならAPIからも出陣不可",
  );
  await seed(p, { upto: "europe", lost: ["me_nile"] });
  check(
    await p.evaluate(() => !WD_DEBUG.squadApi.chapterUnlocked("europe")),
    "中東に未制圧拠点があればヨーロッパは開かない",
  );
  r = await fight(p, "me_nile");
  check(!r.err && /次の章「ヨーロッパ」/.test(r.text), "中東最後の勝利で第六章へ案内");
  await p.reload();
  check(await p.evaluate(() => WD_DEBUG.squadApi.chapterUnlocked("europe")), "新章解放を再読み込み後も保持");
  await seed(p);
  check(
    await p.evaluate(
      () => WD_DEBUG.squadApi.chapterUnlocked("europe") && WD_DEBUG.heroApi.save().tickets === 0,
    ),
    "world項目のない旧制覇セーブから解放し、移行だけでは報酬を配らない",
  );
  await seed(p, { upto: "middleeast", world: { cleared: { middleeast: true } } });
  check(
    await p.evaluate(
      () => WD_DEBUG.squadApi.chapterUnlocked("europe") && !WD_DEBUG.squadApi.canAttackProvince("eu_balkan"),
    ),
    "過去に制覇済みなら失地後も解放、航路元のアナトリアは必要",
  );
  await seed(p);
  await p.locator("#mapOpen").click();
  check(
    /推奨Lv2350〜2900/.test(await p.locator('[data-map-chapter="europe"]').innerText()),
    "章カードに中東から続く推奨Lv2350〜2900を表示",
  );
  await p.locator('[data-map-chapter="europe"]').click();
  check(
    /ヨーロッパ 0\/12/.test(await p.locator("#mapTitle").innerText()) &&
      (await p.locator("[data-map-road]").count()) === 4,
    "ヨーロッパ12拠点を4地域にまとめる",
  );
  check(
    /山岳.*80%.*砲兵陣地.*12拠点.*15枚/s.test(await p.locator("#mapBody").innerText()),
    "山岳と砲兵陣地の効果、初回制覇報酬を明示",
  );
  await p.locator('[data-map-road="eu_north"]').click();
  check(
    /？？？/.test(await p.locator("#mapBody").innerText()) &&
      !/霧島の王城|琥珀海の城/.test(await p.locator("#mapBody").innerText()),
    "未発見の拠点名・城名を隠す",
  );
  check(
    /発見/.test(await p.evaluate(() => WD_DEBUG.squadApi.setTarget("eu_fort_britannia"))),
    "未発見拠点への直接出陣を拒否",
  );
  r = await p.evaluate(
    ({ europe, russia }) => {
      const A = WD_DEBUG.squadApi,
        castle = (id) => A.NPC_CASTLES[A.PROVINCES[id].castle];
      return {
        total: A.PROVINCE_ORDER.length,
        eu: europe.map((id) => castle(id).enemyLevel),
        ru: russia.map((id) => castle(id).enemyLevel),
        euRegions: Object.keys(A.CHAPTERS.europe.roads).map(
          (r) => A.chapterProvinces("europe").filter((id) => A.PROVINCES[id].road === r).length,
        ),
        ruRegions: Object.keys(A.CHAPTERS.russia.roads).map(
          (r) => A.chapterProvinces("russia").filter((id) => A.PROVINCES[id].road === r).length,
        ),
        discovered: A.chapterProvinces("europe").filter(A.provinceDiscovered),
        links: [
          A.PROVINCES.me_anatolia.routes.eu_balkan,
          A.PROVINCES.eu_flanders.routes.eu_britannia,
          A.PROVINCES.eu_baltic.routes.ru_novgorod,
        ],
        boss: ["eu_britannia", "ru_moskva"].every((id) => castle(id).garrison.some((g) => g.kind === "boss")),
        artillery: castle("eu_bohemia").towers.filter((t) => t.type === "cannon").length,
        plain: castle("eu_hellas").towers.filter((t) => t.type === "cannon").length,
        hpUp: europe.every((id, i) => !i || castle(id).hp >= castle(europe[i - 1]).hp * 0.8),
        tickets: [...europe, ...russia].map((id) => castle(id).reward.tickets),
      };
    },
    { europe, russia },
  );
  check(
    r.total === 140 && r.euRegions.every((n) => n === 3) && r.ruRegions.every((n) => n === 2),
    "全140拠点、ヨーロッパ3拠点×4地域・ロシア2拠点×4地域",
  );
  check(
    r.eu.every((lv, i) => lv === 2350 + i * 50) && r.ru.every((lv, i) => lv === 2950 + i * 50),
    "敵Lvをヨーロッパ2350〜2900・ロシア2950〜3300の50刻みで設定",
  );
  check(
    r.discovered.join() === "eu_balkan" && r.links.join() === "ボスポラス航路,ドーバー航路,氷海航路",
    "最初は入口だけ発見、ボスポラス・ドーバー・氷海の航路",
  );
  check(r.boss, "両章の最終拠点に名将の守備隊を配置");
  check(r.artillery === r.plain + 2, "砲兵陣地は大砲の塔を2基追加");
  check(
    r.tickets.filter((t) => t === 2).length === 2 && r.tickets.reduce((a, b) => a + b) === 22,
    "各城1枚、両章の最終拠点だけ2枚",
  );
  for (const result of ["lose", "timeup", "retreat"]) {
    await seed(p);
    r = await fight(p, "eu_balkan", result);
    check(!r.err && !r.owned && r.tickets === 0, "ヨーロッパの" + result + "では占領も初回報酬も得ない");
  }
  await seed(p);
  r = await marchRatio(p, "eu_balkan", 320);
  check(
    r.terrain.join() === "mountain" && Math.abs(r.ratio - 0.8) < 1e-8 && /地形：山岳/.test(r.text),
    "実戦の山岳では進軍距離が平地の80%、戦闘画面に表示",
  );
  await seed(p);
  r = await marchRatio(p, "eu_balkan", 480);
  check(Math.abs(r.ratio - 1) < 1e-8, "山岳の区間を抜ければ通常速度");
  const positions = [];
  for (const frame of [0.05, 1 / 60]) {
    await seed(p);
    positions.push(
      await p.evaluate((frame) => {
        const A = WD_DEBUG.squadApi;
        A.setTarget("eu_fort_balkan");
        A.startBattle();
        const B = A.battle();
        B.garrison = [];
        B.towers = [];
        B.nextUnit = 4;
        for (const g of B.groups) g.state = "empty";
        const g = B.groups[0];
        g.state = "march";
        g.d = 260;
        Object.assign(g, WD_DEBUG.pathAt(g.path, 260));
        WD_DEBUG.step(5, frame);
        return g.d;
      }, frame),
    );
  }
  check(Math.abs(positions[0] - positions[1]) < 1e-6, "山岳の出入りで20fpsと60fpsの進軍距離が一致");
  await seed(p);
  const before = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    return [A.startGold(), A.territoryBonus("waveGold"), A.territoryBonus("hire"), A.territoryBonus("repair")];
  });
  for (const id of europe) {
    r = await fight(p, id);
    check(!r.err && r.owned, id + "の隣接進軍・占領に成功");
  }
  check(
    r.tickets === 28 && /ヨーロッパを制覇/.test(r.text) && /領土 12\/12拠点/.test(r.text),
    "ヨーロッパ初回12城の13枚＋章制覇15枚を付与",
  );
  check(
    /次の章「ロシア」/.test(r.text) && !/世界征服達成|完全クリア！|天下統一！/.test(r.text),
    "ロシアへ案内し、世界征服・完全クリア・天下統一と混同しない",
  );
  check(
    JSON.stringify(before) ===
      JSON.stringify(
        await p.evaluate(() => {
          const A = WD_DEBUG.squadApi;
          return [A.startGold(), A.territoryBonus("waveGold"), A.territoryBonus("hire"), A.territoryBonus("repair")];
        }),
      ),
    "海外占領で既存の国内経済ボーナスを変えない",
  );
  await p.reload();
  r = await fight(p, "eu_britannia");
  check(r.tickets === 28, "再読み込み・演習で初回報酬を繰り返さない");
  await seed(p, { upto: "europe", extra: ["eu_balkan"] });
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setCounterRng(() => 0);
    return A.maybeCounter("europe");
  });
  check(
    r?.province === "eu_balkan" && ["eu_hellas", "eu_pannonia"].includes(r?.from),
    "反撃は同じ章の隣の拠点から来る（中東・ロシアからは来ない）",
  );

  // ===== 第七章：ロシアと世界征服 =====
  await seed(p, { upto: "europe", extra: europe.slice(0, -1) });
  check(
    await p.evaluate(() => !WD_DEBUG.squadApi.chapterUnlocked("russia")),
    "ヨーロッパに未制圧拠点があればロシアは開かない",
  );
  await seed(p, { upto: "russia" });
  await p.locator("#mapOpen").click();
  check(
    /推奨Lv2950〜3300.*20枚/s.test(await p.locator('[data-map-chapter="russia"]').innerText()) &&
      !/世界征服達成/.test(await p.locator("#mapBody").innerText()),
    "ロシアの章カードに推奨Lv2950〜3300と報酬20枚、征服前は記録なし",
  );
  await p.locator('[data-map-chapter="russia"]').click();
  check(
    /ロシア 0\/8/.test(await p.locator("#mapTitle").innerText()) &&
      /雪原.*70%.*最後の章.*世界征服/s.test(await p.locator("#mapBody").innerText()),
    "ロシア8拠点と雪原・世界征服の条件を表示",
  );
  r = await marchRatio(p, "ru_novgorod", 300);
  check(
    r.terrain.join() === "snow" && Math.abs(r.ratio - 0.7) < 1e-8 && /地形：雪原/.test(r.text),
    "実戦の雪原では進軍距離が平地の70%",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.squadApi,
      B = A.battle(),
      g = B.groups[0],
      s = g.list[0];
    B.terrain = ["snow"];
    g.list = [s];
    s.cd = 0;
    g.d = 300;
    Object.assign(g, D.pathAt(g.path, 300));
    const before = JSON.stringify(A.battleStats(g, s)),
      e = { ...A.siegeEnemyStats("goblin", 2950), ...D.pathAt(g.path, 330), kind: "goblin", path: g.path, d: 330, hp: 1e9, max: 1e9, attack: 1000, cd: 0, r: 13, reward: 10 };
    B.garrison = [e];
    const hp = s.hp;
    D.step(0.05);
    return { attack: e.hp < 1e9, hurt: s.hp < hp, same: JSON.stringify(A.battleStats(g, s)) === before };
  });
  check(r.attack && r.hurt && r.same, "雪原でも攻撃・被弾は継続し、攻撃・防御・間隔は変わらない");
  await seed(p, { upto: "russia" });
  for (const id of russia) {
    r = await fight(p, id);
    check(!r.err && r.owned, id + "の隣接進軍・占領に成功");
  }
  check(
    r.tickets === 29 && /ロシアを制覇/.test(r.text) && /領土 8\/8拠点/.test(r.text),
    "ロシア初回8城の9枚＋章制覇20枚を付与",
  );
  check(
    /世界征服達成！.*全7章を制覇.*世界の覇者/s.test(r.text),
    "ロシア制覇で世界征服達成と称号を表示",
  );
  check(
    await p.evaluate(() => {
      const A = WD_DEBUG.squadApi,
        w = A.conquestMeta().world;
      return A.worldConquered() && w.cleared.russia && w.rewards.russia && w.cleared.europe;
    }),
    "制覇・報酬受領印・世界征服を保存",
  );
  await p.reload();
  await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    for (const id of ["ru_fort_moskva", "eu_fort_britannia"]) A.conquest()[id].captured = false;
    A.persistConquest();
  });
  await p.reload();
  await p.locator("#mapOpen").click();
  check(
    /世界征服達成.*世界の覇者/.test(await p.locator("#mapBody").innerText()) &&
      (await p.evaluate(() => WD_DEBUG.squadApi.worldConquered())),
    "失地・再読み込み後も世界征服の記録を世界画面に残す",
  );
  r = await fight(p, "ru_moskva");
  check(
    r.owned && r.tickets === 29 && !/世界征服達成！/.test(r.text),
    "再占領で章報酬・城報酬・世界征服を重ねて得ない",
  );
  await seed(p, { upto: "russia", tenka: false, lost: ["owari"], world: { cleared: { russia: true } } });
  check(
    await p.evaluate(() => !WD_DEBUG.squadApi.worldConquered()),
    "天下統一の記録がなければ世界征服にならない",
  );
  for (const failKey of ["worldDefense.bookTransaction.v1", CKEY, WKEY, "worldDefense.soldiers.v1"]) {
    await seed(p, { upto: "russia", extra: russia.slice(0, -1), tickets: 8 });
    await p.evaluate((failKey) => {
      const A = WD_DEBUG.squadApi;
      A.setCounterRng(() => 1);
      A.setTarget("ru_fort_moskva");
      A.startBattle();
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === failKey) throw Error("W7 save fault");
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
        owned: A.ownsProvince("ru_moskva"),
        reward: !!A.conquestMeta().world.rewards.russia,
        world: A.worldConquered(),
        tickets: WD_DEBUG.heroApi.save().tickets,
      };
    });
    check(
      failKey.endsWith("bookTransaction.v1")
        ? !r.owned && !r.reward && !r.world && r.tickets === 8
        : r.owned && r.reward && r.world && r.tickets === 30,
      "保存障害後の領土・受領印・世界征服・券が整合：" + failKey,
    );
    await p.reload();
    check(
      (await p.evaluate(() => WD_DEBUG.heroApi.save().tickets)) === r.tickets,
      "保存復旧後も二重配布しない：" + failKey,
    );
  }
  await seed(p, {
    upto: "europe",
    lost: ["me_nile"],
    world: { unlocked: { europe: "yes", russia: 1 }, cleared: { middleeast: "yes", europe: 1 }, discovered: { eu_britannia: 1 } },
  });
  check(
    await p.evaluate(() => {
      const A = WD_DEBUG.squadApi;
      return !A.chapterUnlocked("europe") && !A.chapterUnlocked("russia") && !A.provinceDiscovered("eu_britannia") && !A.worldConquered();
    }),
    "壊れたフラグから不正に解放・世界征服しない",
  );
  await c.close();
  for (const width of [375, 390, 430, 1280]) {
    const { p, c } = await H.setup();
    await p.setViewportSize({ width, height: 844 });
    await seed(p, { upto: "russia", extra: ["ru_novgorod"] });
    const fit = () =>
      p.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          [...document.querySelectorAll("#mapBody button")]
            .filter((e) => e.getClientRects().length)
            .every((e) => e.getBoundingClientRect().height >= 44),
      );
    await p.locator("#mapOpen").click();
    await p.locator('[data-map-chapter="europe"]').click();
    await p.locator('[data-map-road="eu_central"]').click();
    await p.locator('[data-map-prov="eu_alps"]').click();
    const eu = await fit();
    await p.locator("[data-world-home]").first().click();
    await p.locator('[data-map-chapter="russia"]').click();
    await p.locator('[data-map-road="ru_west"]').click();
    await p.locator('[data-map-prov="ru_smolensk"]').click();
    check(eu && (await fit()), width + "pxでヨーロッパ・ロシアの地図と拠点詳細が画面内、ボタン44px以上");
    if (process.env.SCREENSHOTS && width === 390) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/w7-russia-390.png" });
    }
    await c.close();
  }
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  if (H.errors.length) console.log(H.errors);
  await H.close();
}
