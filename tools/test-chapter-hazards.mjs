// 後半の章の戦い方の違い：中東の砂嵐・ヨーロッパの援軍・ロシアの寒さ。実際の戦闘の時間を進めて確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
// target の章より前をすべて領土にし、同じ章は target 以外を領土にする
async function seed(p, target, level = 3000) {
  await p.evaluate(
    ({ target, level }) => {
      const A = WD_DEBUG.squadApi,
        c0 = A.CHAPTER_ORDER.indexOf(A.PROVINCES[target].chapter),
        castles = {};
      localStorage.clear();
      for (const id of A.PROVINCE_ORDER) {
        const P = A.PROVINCES[id];
        if (!P.castle) continue;
        const ci = A.CHAPTER_ORDER.indexOf(P.chapter),
          o = ci < c0 || (ci === c0 && id !== target);
        castles[P.castle] = { captured: o, wins: +o, attempts: +o };
      }
      localStorage.setItem("worldDefense.conquest.v1", JSON.stringify({ version: 2, castles, tenka: true, unified: true }));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ owned: {}, tickets: 0 }));
      const types = ["spearman", "cavalry", "archer", "medic"],
        save = { seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
      for (let q = 1; q <= 4; q++) {
        save.squads.push({ id: q, type: types[q - 1], slot: q - 1 });
        for (let k = 0; k < 10; k++)
          save.soldiers.push({
            id: (q - 1) * 10 + k + 1,
            type: types[q - 1],
            squadId: q,
            level,
            pts: { atk: Math.floor((level - 1) * 1.5), def: Math.ceil((level - 1) * 1.5), spd: 0, rng: 0 },
          });
      }
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
    },
    { target, level },
  );
  await p.reload();
}
// 出陣し、守備隊・塔を外して全部隊を道の d に置く
async function start(p, target, d = 300) {
  await seed(p, target);
  return p.evaluate(
    ({ target, d }) => {
      const A = WD_DEBUG.squadApi;
      A.setCounterRng(() => 1);
      const err = A.setTarget(A.PROVINCES[target].castle) || A.startBattle();
      if (err) throw Error(err);
      const B = A.battle();
      B.towers = [];
      B.garrison = [];
      B.nextUnit = 4;
      for (const g of B.groups) {
        g.state = "fight";
        g.terrainWait = 1e9; // 渡河待ちの扱いで道の d に止めたまま、攻撃・回復・被弾は続ける
        g.d = d;
        Object.assign(g, WD_DEBUG.pathAt(g.path, d));
      }
      return B.hazards;
    },
    { target, d },
  );
}
try {
  const { p, c } = await H.setup();
  await seed(p, "me_deccan");
  let r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      out = {};
    for (const id of A.PROVINCE_ORDER) {
      const P = A.PROVINCES[id];
      if (P.castle && A.NPC_CASTLES[P.castle]) out[id] = A.siegeHazardsOf(P.castle);
    }
    return out;
  });
  const ids = Object.keys(r),
    on = (k) => ids.filter((id) => r[id][k]).sort();
  check(
    on("storm").every((id) => /^me_/.test(id)) &&
      on("storm").join() === "me_arabia,me_deccan,me_levant,me_makran,me_mesopotamia,me_nile,me_oman",
    "砂嵐は中東の砂漠の7拠点だけ",
    on("storm"),
  );
  check(
    on("reinforce").length === 12 && on("reinforce").every((id) => /^eu_/.test(id)),
    "援軍はヨーロッパの全12拠点だけ",
  );
  check(
    on("cold").join() === "ru_arkhangelsk,ru_moskva,ru_novgorod,ru_siberia,ru_vologda",
    "寒さはロシアの雪原の5拠点だけ",
    on("cold"),
  );
  check(
    ids.filter((id) => !/^(me|eu|ru)_/.test(id)).every((id) => !r[id].storm && !r[id].reinforce && !r[id].cold),
    "日本・朝鮮・中国・東南アジアには新しい仕掛けがない",
  );

  // ===== 砂嵐 =====
  r = await start(p, "me_deccan");
  check(r.storm && !r.reinforce && !r.cold, "デカンの攻城戦で砂嵐が有効");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      byType = (t) => B.groups.find((g) => g.list[0]?.type === t),
      range = () => ["spearman", "cavalry", "archer", "medic"].map((t) => A.battleStats(byType(t), byType(t).list[0]).range),
      guard = { kind: "dragon", siegeRole: "crossbow" };
    B.t = 3;
    const calm = range(),
      calmGuard = A.siegeGuardAttack(guard).range;
    B.t = 16;
    const storm = range(),
      stormGuard = A.siegeGuardAttack(guard).range;
    WD_DEBUG.heroApi.draw();
    return { calm, storm, calmGuard, stormGuard, info: document.getElementById("battleInfo").textContent };
  });
  check(
    Math.abs(r.storm[2] - Math.max(60, r.calm[2] * 0.6)) < 1e-9 && r.storm[2] < r.calm[2],
    "砂嵐の間（20秒ごとの5秒）は弓兵の射程が60%",
    r,
  );
  check(r.storm[0] === r.calm[0] && r.storm[1] === r.calm[1], "槍・騎兵の射程は変わらない");
  check(r.storm[3] === r.calm[3], "衛生兵の回復範囲は変わらない");
  check(Math.abs(r.stormGuard - r.calmGuard * 0.6) < 1e-9, "敵の弩兵の射程も同じく60%");
  check(/砂嵐 射程60%/.test(r.info), "戦闘画面に砂嵐中を表示", r.info);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle();
    B.t = 0;
    WD_DEBUG.step(14.9);
    const g = B.groups.find((g) => g.list[0]?.type === "archer"),
      before = A.battleStats(g, g.list[0]).range;
    WD_DEBUG.step(0.2);
    return { before, after: A.battleStats(g, g.list[0]).range, info: document.getElementById("battleInfo").textContent };
  });
  check(r.after < r.before && /砂嵐/.test(r.info), "実際に時間を進めると15秒から砂嵐が始まる", r);

  // ===== 援軍 =====
  r = await start(p, "eu_italia", 200);
  check(r.reinforce && !r.storm && !r.cold, "イタリアの攻城戦で援軍が有効");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      counts = [];
    // 部隊は手前に止めたまま（start）、援軍とは交戦させずに時間だけ進める
    for (const t of [29.5, 1, 30, 30, 30]) {
      WD_DEBUG.step(t);
      counts.push(B.garrison.filter((e) => e.reinforcement && e.hp > 0).length);
    }
    const e = B.garrison.find((e) => e.reinforcement),
      ref = A.siegeEnemyStats("goblin", B.enemyLevel, null, A.NPC_CASTLES[B.castleId].guardPower);
    WD_DEBUG.heroApi.draw();
    return { counts, e: { kind: e.kind, max: e.max, attack: e.attack, armor: e.armor }, ref, info: document.getElementById("battleInfo").textContent };
  });
  check(r.counts.join() === "0,4,8,12,12", "30秒ごとに上下の道へ2人ずつ、最大3回の援軍", r.counts);
  check(
    r.e.kind === "goblin" && r.e.max === r.ref.max && r.e.attack === r.ref.attack && r.e.armor === r.ref.armor,
    "援軍の能力は同じ城の守備兵の計算どおり",
    r,
  );
  check(/援軍は打ち止め/.test(r.info), "戦闘画面に援軍の残りを表示", r.info);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      g = B.groups.find((g) => g.list[0]?.type === "archer"),
      e = B.garrison.find((e) => e.reinforcement && e.path === g.path); // 合流する手前の自分の道の援軍へ近づける
    g.state = "fight";
    g.terrainWait = 0;
    g.list = [g.list[0]];
    g.list[0].cd = 0;
    g.d = e.d - 60;
    Object.assign(g, WD_DEBUG.pathAt(g.path, g.d));
    const near = B.garrison.filter((x) => x.reinforcement),
      before = near.map((x) => x.hp);
    WD_DEBUG.step(3);
    return near.some((x, i) => x.hp < before[i]) || near.some((x) => !B.garrison.includes(x));
  });
  check(r, "援軍の守備兵も実際に攻撃を受けて倒せる");

  // ===== 寒さ =====
  r = await start(p, "ru_novgorod", 300);
  check(r.cold && !r.storm && !r.reinforce, "ノヴゴロドの攻城戦で寒さが有効");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      g = B.groups.find((o) => o.list[0]?.type === "spearman"),
      s = g.list[0],
      max = A.battleStats(g, s).maxHp,
      out = B.groups.find((o) => o.list[0]?.type === "cavalry");
    for (const o of B.groups) if (o !== g && o !== out) o.state = "empty";
    out.d = 520;
    Object.assign(out, WD_DEBUG.pathAt(out.path, 520));
    const so = out.list[0];
    s.hp = max;
    so.hp = A.battleStats(out, so).maxHp;
    WD_DEBUG.step(10);
    const after10 = s.hp / max,
      outside = so.hp / A.battleStats(out, so).maxHp;
    WD_DEBUG.step(300);
    return { after10, outside, floor: s.hp / max, alive: g.list.every((x) => x.hp > 0) };
  });
  check(Math.abs(r.after10 - 0.96) < 1e-6, "雪原にいる兵士は毎秒最大HPの0.4%を失う", r);
  check(r.outside === 1, "雪原の外ではHPが減らない", r);
  check(Math.abs(r.floor - 0.3) < 1e-6 && r.alive, "寒さは最大HPの30%で止まり、戦死しない", r);
  const heal = async (d) => {
    await start(p, "ru_novgorod", d);
    return p.evaluate(() => {
      const A = WD_DEBUG.squadApi,
        B = A.battle(),
        g = B.groups.find((o) => o.list[0]?.type === "spearman"),
        med = B.groups.find((o) => o.list[0]?.type === "medic");
      for (const o of B.groups) if (o !== g && o !== med) o.state = "empty";
      med.path = g.path;
      Object.assign(med, WD_DEBUG.pathAt(med.path, med.d));
      g.list = [g.list[0]];
      med.list = [med.list[0]];
      med.list[0].cd = 0;
      const s = g.list[0],
        max = A.battleStats(g, s).maxHp;
      s.hp = max * 0.3;
      const before = s.hp;
      WD_DEBUG.step(0.05);
      return s.hp - before;
    });
  };
  const inSnow = await heal(300),
    outSnow = await heal(520);
  check(inSnow > 0 && Math.abs(inSnow / outSnow - 0.8) < 0.02, "雪原では衛生兵の回復が80%", { inSnow, outSnow });
  await start(p, "ru_novgorod", 300);
  r = await p.evaluate(() => {
    WD_DEBUG.heroApi.draw();
    return document.getElementById("battleInfo").textContent;
  });
  check(/寒さ/.test(r), "戦闘画面に寒さを表示");

  // ===== 地図の説明・ほかの戦いへ持ち込まない =====
  await seed(p, "eu_balkan");
  await p.locator("#mapOpen").click();
  await p.locator('[data-map-chapter="europe"]').click();
  await p.locator('[data-map-road="eu_south"]').click();
  await p.locator('[data-map-prov="eu_balkan"]').click();
  check(/騎士団の援軍：30秒ごと/.test(await p.locator("#mapBody").innerText()), "拠点詳細に新しい仕掛けを説明");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setTarget("eu_fort_balkan");
    A.startBattle();
    A.endBattle("retreat");
    document.getElementById("start").click();
    WD_DEBUG.step(40);
    return { training: typeof WD_DEBUG.state().enemies.length === "number", battle: A.battle() };
  });
  check(r.battle === null, "攻城戦が終われば仕掛けは残らない（通常防衛戦は変更なし）");
  await c.close();
  for (const width of [375, 390]) {
    const { p, c } = await H.setup();
    await p.setViewportSize({ width, height: 844 });
    await start(p, "eu_britannia", 200);
    await p.evaluate(() => {
      const B = WD_DEBUG.squadApi.battle();
      B.t = 16;
      WD_DEBUG.heroApi.draw();
    });
    check(
      await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      width + "pxで援軍の表示が画面内",
    );
    if (process.env.SCREENSHOTS && width === 390) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/hazard-390.png" });
    }
    await c.close();
  }
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  if (H.errors.length) console.log(H.errors);
  await H.close();
}
