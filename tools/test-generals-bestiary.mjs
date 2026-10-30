// 名将の専用行動・章ごとの特別な敵・強敵図鑑（v99）。実際の戦闘の時間を進めて確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
const baseline = JSON.parse(fs.readFileSync(new URL("./fixtures/world-v95.json", import.meta.url)));
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
// target の章より前をすべて領土に（同じ章は target 以外）。captured=true なら target も領土にする
// only を渡すと、同じ章ではその拠点だけを領土にする
async function seed(p, target, { captured = false, level = 3000, zukan = null, only = null } = {}) {
  await p.evaluate(
    ({ target, captured, level, zukan, only }) => {
      const A = WD_DEBUG.squadApi,
        c0 = A.CHAPTER_ORDER.indexOf(A.PROVINCES[target].chapter),
        castles = {};
      localStorage.clear();
      for (const id of A.PROVINCE_ORDER) {
        const P = A.PROVINCES[id];
        if (!P.castle) continue;
        const ci = A.CHAPTER_ORDER.indexOf(P.chapter),
          o = ci < c0 || (ci === c0 && (only ? only.includes(id) : id !== target || captured));
        castles[P.castle] = { captured: o, wins: +o, attempts: +o };
      }
      localStorage.setItem("worldDefense.conquest.v1", JSON.stringify({ version: 2, castles, tenka: true, unified: true }));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ owned: {}, tickets: 0 }));
      if (zukan) localStorage.setItem("worldDefense.zukan.v1", JSON.stringify(zukan));
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
    { target, captured, level, zukan, only },
  );
  await p.reload();
}
// 名将の城へ出陣。名将以外の守備兵・塔を外し、全部隊を d に止める（渡河待ちの扱い）
async function general(p, target, d) {
  await seed(p, target);
  return p.evaluate(
    ({ target, d }) => {
      const A = WD_DEBUG.squadApi;
      A.setCounterRng(() => 1);
      const err = A.setTarget(A.PROVINCES[target].castle) || A.startBattle();
      if (err) throw Error(err);
      const B = A.battle();
      B.towers = [];
      B.garrison = B.garrison.filter((e) => e.kind === "boss");
      for (const e of B.garrison) e.hp = e.max = 1e15;
      B.castleHp = B.castleMax = 1e15;
      B.hazards = {};
      B.nextUnit = 4;
      for (const g of B.groups) {
        g.state = "fight";
        g.terrainWait = 1e9;
        g.d = d;
        Object.assign(g, WD_DEBUG.pathAt(g.path, d));
      }
      return { boss: B.garrison.length, d: B.garrison[0].d };
    },
    { target, d },
  );
}
const info = (p) =>
  p.evaluate(() => {
    WD_DEBUG.heroApi.draw();
    return document.getElementById("battleInfo").textContent;
  });
try {
  const { p, c } = await H.setup();
  // ===== 特別な敵の配置と能力 =====
  await seed(p, "eu_pannonia");
  let r = await p.evaluate((b) => {
    const A = WD_DEBUG.squadApi,
      roles = (id) => [...new Set(A.NPC_CASTLES[A.PROVINCES[id].castle].garrison.map((g) => g.role).filter(Boolean))].sort().join();
    const where = {};
    for (const id of A.PROVINCE_ORDER) {
      const P = A.PROVINCES[id];
      if (!P.castle || !A.NPC_CASTLES[P.castle]) continue;
      for (const g of A.NPC_CASTLES[P.castle].garrison) if (g.role === "heavyKnight" || g.role === "cossack") (where[g.role] ||= new Set()).add(id);
    }
    const knight = A.siegeEnemyStats("knight", 2500, "heavyKnight", 40),
      plainK = A.siegeEnemyStats("knight", 2500, null, 40),
      cossack = A.siegeGuardAttack({ kind: "wolf", siegeRole: "cossack" }),
      wolf = A.siegeGuardAttack({ kind: "wolf" });
    return {
      knights: [...where.heavyKnight].sort().join(),
      cossacks: [...where.cossack].sort().join(),
      old: Object.keys(b.NPC_CASTLES).every((id) => JSON.stringify(A.NPC_CASTLES[id]) === JSON.stringify(b.NPC_CASTLES[id])),
      hp: knight.max / plainK.max,
      atk: knight.attack / plainK.attack,
      armor: [knight.armor, plainK.armor],
      rate: [cossack.rate, wolf.rate],
      pannonia: roles("eu_pannonia"),
    };
  }, baseline);
  check(r.knights === "eu_gallia,eu_pannonia" && r.cossacks === "ru_siberia,ru_vologda", "重装騎士はヨーロッパ2城、コサック騎兵はロシア2城だけ", r);
  check(r.old, "v95の既存120拠点の城・守備隊は変えない");
  check(Math.abs(r.hp - 1.3) < 1e-9 && Math.abs(r.atk - 1.05) < 1e-9 && r.armor[0] <= 44 && r.armor[0] > r.armor[1], "重装騎士はHP1.3倍・攻撃1.05倍・装甲上乗せ（上限44）", r);
  check(r.rate[0] === 0.7 && r.rate[1] !== 0.7, "コサック騎兵の攻撃間隔は0.7秒", r.rate);
  await p.locator("#mapOpen").click();
  await p.locator('[data-map-chapter="europe"]').click();
  await p.locator('[data-map-road="eu_central"]').click();
  await p.locator('[data-map-prov="eu_pannonia"]').click();
  check(/重装騎士：高HP・装甲（上限44）/.test(await p.locator("#mapBody").innerText()), "拠点詳細に特別な敵の説明を表示");

  // ===== 名将の専用行動 =====
  r = await general(p, "me_nile", 300);
  check(r.boss >= 1 && r.d >= 900, "ナイルの名将は城の前に立つ", r);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle();
    WD_DEBUG.step(30);
    return { cd: B.generalCd ?? null, uses: B.generalUses || 0 };
  });
  check(r.cd === null && r.uses === 0, "部隊が近づくまで名将は専用行動を使わない", r);
  check(/近づくと「砂塵の号令」/.test(await info(p)), "近づく前は行動名を予告");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      boss = B.garrison[0];
    for (const g of B.groups) {
      g.d = boss.d - 100;
      Object.assign(g, WD_DEBUG.pathAt(g.path, g.d));
    }
    WD_DEBUG.step(0.05);
    const cd = B.generalCd;
    WD_DEBUG.step(4.9);
    const before = { uses: B.generalUses || 0, storm: A.stormActive(B) };
    WD_DEBUG.step(0.2);
    return { cd, before, uses: B.generalUses, storm: A.stormActive(B), until: B.stormUntil - B.t };
  });
  check(Math.abs(r.cd - 4.95) < 0.06 && r.before.uses === 0 && !r.before.storm, "近づくと5秒の予告", r);
  check(r.uses === 1 && r.storm && r.until > 4.7 && r.until <= 5, "砂塵の号令でその場で5秒間の砂嵐", r);
  check(/砂海の覇王「砂塵の号令」まで/.test(await info(p)), "戦闘画面に次の号令までの秒数");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle();
    WD_DEBUG.step(20);
    return B.generalUses;
  });
  check(r === 2, "以後20秒ごとに使う");

  r = await general(p, "eu_britannia", 300);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      boss = B.garrison[0],
      g = B.groups.find((o) => o.list[0]?.type === "spearman");
    for (const o of B.groups) if (o !== g) o.state = "empty";
    g.d = boss.d - 60;
    Object.assign(g, WD_DEBUG.pathAt(g.path, g.d));
    for (const e of B.garrison) (e.attack = 0), (e.cd = 1e9);
    for (const s of g.list) s.hp = A.battleStats(g, s).maxHp;
    const s0 = g.list[0],
      max = A.battleStats(g, s0).maxHp;
    WD_DEBUG.step(5.1);
    const once = s0.hp / max;
    for (const s of g.list) s.hp = 1.5;
    WD_DEBUG.step(20);
    return { once, uses: B.generalUses, alive: g.list.every((s) => s.hp >= 1) };
  });
  check(r.uses === 2 && Math.abs(r.once - 0.94) < 0.01, "騎士王の突撃は近くの部隊の兵士全員へ最大HPの6%", r);
  check(r.alive, "突撃だけでは戦死しない（HP1で止まる）", r);

  r = await general(p, "ru_moskva", 300);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle(),
      boss = B.garrison[0];
    for (const g of B.groups) {
      g.d = boss.d - 100;
      Object.assign(g, WD_DEBUG.pathAt(g.path, g.d));
    }
    WD_DEBUG.step(5.1);
    const frozen = B.groups.filter((g) => g.list.length).map((g) => g.frozen);
    WD_DEBUG.step(2.1);
    return { frozen, after: B.groups.map((g) => g.frozen || 0), uses: B.generalUses };
  });
  check(r.uses === 1 && r.frozen.every((f) => f > 1.8 && f <= 2), "吹雪の号令で全部隊が2秒間凍える（攻撃間隔2倍）", r);
  check(r.after.every((f) => f === 0), "凍えは2秒で解ける", r);
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi,
      B = A.battle();
    for (const e of B.garrison) e.hp = 0;
    WD_DEBUG.step(60);
    return B.generalUses;
  });
  check(r === 1, "名将を討ち取ると号令は止まる");
  check(/雪冠の大公を討ち取った/.test(await info(p)), "討ち取ったことを戦闘画面に表示");
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.endBattle("retreat");
    A.setTarget("eu_fort_italia");
    A.startBattle();
    const B = A.battle();
    WD_DEBUG.step(60);
    return { uses: B.generalUses || 0 };
  }).catch((e) => ({ err: e.message }));
  check(r.uses === 0 || r.err, "名将のいない城では専用行動なし", r);

  // ===== 強敵図鑑 =====
  await seed(p, "eu_pannonia", { only: ["eu_balkan"] });
  r = await p.evaluate(() => {
    document.getElementById("zukanOpen").click();
    document.querySelector('[data-zk-tab="foes"]').click();
    return document.getElementById("zukanBody").textContent.replace(/\s/g, "");
  });
  check(/強敵図鑑3\/7/.test(r) && /弩兵/.test(r) && /重装騎兵/.test(r) && /砂海の覇王/.test(r) && !/重装騎士/.test(r), "旧セーブの城攻めの記録から弩兵・重装騎兵・攻め落とした名将を登録", r.slice(0, 160));
  await p.evaluate(() => document.getElementById("zukanClose").click());
  await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    A.setCounterRng(() => 1);
    A.setTarget("eu_fort_pannonia");
    A.startBattle();
    A.endBattle("retreat");
  });
  r = await p.evaluate(() => {
    document.getElementById("zukanOpen").click();
    document.querySelector('[data-zk-tab="foes"]').click();
    return document.getElementById("zukanBody").textContent.replace(/\s/g, "");
  });
  check(/強敵図鑑4\/7/.test(r) && /重装騎士/.test(r), "撤退でも戦った特別な敵を登録", r.slice(0, 160));
  r = await p.evaluate(() => {
    const tile = [...document.querySelectorAll("[data-zk-no]")].find((b) => /重装騎士/.test(b.textContent));
    tile.click();
    return document.getElementById("zkDetail").textContent;
  });
  check(/ヨーロッパから登場/.test(r) && /HP×1.3/.test(r), "詳細に登場する章と能力を表示", r);
  await seed(p, "ru_moskva", { captured: true });
  r = await p.evaluate(() => {
    document.getElementById("zukanOpen").click();
    document.querySelector('[data-zk-tab="foes"]').click();
    const text = document.getElementById("zukanBody").textContent.replace(/\s/g, "");
    const tile = [...document.querySelectorAll("[data-zk-no]")].find((b) => /雪冠の大公/.test(b.textContent));
    tile?.click();
    return { text, detail: document.getElementById("zkDetail")?.textContent || "" };
  });
  check(/強敵図鑑7\/7/.test(r.text), "全章を攻め落としたセーブは特別な敵4種・名将3人をすべて登録", r.text.slice(0, 120));
  check(/吹雪の号令/.test(r.detail) && /モスクワ/.test(r.detail), "名将の詳細に専用行動と城を表示", r.detail);
  await p.reload();
  check(
    await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("worldDefense.zukan.v1")).foes).length === 7),
    "強敵の記録を保存（増えるだけ）",
  );
  await seed(p, "ru_moskva", { captured: false, zukan: { version: 1, foes: { "gen:ru_moskva": true, "role:fake": true, "role:cossack": "yes" } } });
  r = await p.evaluate(() => {
    document.getElementById("zukanOpen").click();
    document.querySelector('[data-zk-tab="foes"]').click();
    return document.getElementById("zukanBody").textContent.replace(/\s/g, "");
  });
  check(/雪冠の大公/.test(r) && !/fake/.test(r), "一度記録した名将は残し、壊れた記録は無視", r.slice(0, 160));
  await c.close();
  for (const width of [375, 390]) {
    const { p, c } = await H.setup();
    await p.setViewportSize({ width, height: 700 });
    await seed(p, "ru_moskva", { captured: true });
    await p.evaluate(() => {
      document.getElementById("zukanOpen").click();
      document.querySelector('[data-zk-tab="foes"]').click();
    });
    check(
      await p.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth &&
          [...document.querySelectorAll(".zk-tabs button")].every((b) => b.getBoundingClientRect().right <= innerWidth && b.scrollWidth <= b.clientWidth + 1),
      ),
      width + "pxで7つのタブが画面内に収まる",
    );
    if (process.env.SCREENSHOTS && width === 390) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/bestiary-390.png" });
    }
    await c.close();
  }
  check(!H.errors.length, "JavaScript例外なし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  if (H.errors.length) console.log(H.errors);
  await H.close();
}
