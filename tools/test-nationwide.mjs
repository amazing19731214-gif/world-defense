#!/usr/bin/env node
// 全国制覇・隠しルートの動作確認：旧国68か国のデータ（隣接・航路・五畿七道）、三河からの進軍（隣の国だけ・航路）、
// 勝敗による制圧、城の強さと特色、以前の保存データの移行、領土の効果の上限、反撃、秘境の発見（1回だけ・失っても残る）、
// 天下統一（1回だけ）、全国の画面（375×667・390×844）
//   node tools/test-nationwide.mjs
//   SCREENSHOTS=dir node tools/test-nationwide.mjs … 画面写真も保存
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href + "?debug";
const shots = process.env.SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

let failures = 0,
  passes = 0;
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const SKEY = "worldDefense.soldiers.v1",
  FKEY = "worldDefense.siege.v1",
  WKEY = "worldDefense.warlords.v1",
  CKEY = "worldDefense.conquest.v1";
const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
for (let q = 1; q <= 4; q++) {
  save.squads.push({ id: q, type: "spearman", slot: q - 1 });
  for (let k = 0; k < 10; k++)
    save.soldiers.push({ id: (q - 1) * 10 + k + 1, type: "spearman", squadId: q, level: 10 });
}
const units = [0, 1, 2, 3].map((u) => ({
  soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
  hero: null,
}));
async function newContext(extra = {}, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  const seeds = Object.assign(
    {
      [SKEY]: JSON.stringify(save),
      [FKEY]: JSON.stringify({ version: 1, units }),
      [WKEY]: JSON.stringify({ version: 1, owned: {}, tickets: 0, history: [] }),
    },
    extra,
  );
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
async function reload(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
}
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const owned = (page) =>
  page.evaluate(() => WD_DEBUG.squadApi.PROVINCE_ORDER.filter((p) => WD_DEBUG.squadApi.ownsProvince(p)));
const open = (page) =>
  page.evaluate(() => WD_DEBUG.squadApi.PROVINCE_ORDER.filter((p) => WD_DEBUG.squadApi.canAttackProvince(p)));
// 国を攻める（result：win / lose。戦闘はすぐ終える）
const fight = (page, province, result = "win", counter = 0.99) =>
  page.evaluate(
    ([province, result, counter]) => {
      const a = WD_DEBUG.squadApi;
      a.setCounterRng(() => counter);
      const err = a.setTarget(a.PROVINCES[province].castle);
      if (err) return { err };
      const e = a.startBattle();
      if (e) return { err: e };
      a.endBattle(result);
      return {
        body: document.getElementById("battleBody").textContent,
        tickets: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).tickets,
        owns: a.ownsProvince(province),
      };
    },
    [province, result, counter],
  );
// 全国の城を、指定した国以外すべて占領した保存データ
const allBut = async (page, except = [], extra = {}) => {
  const castles = await page.evaluate((except) => {
    const a = WD_DEBUG.squadApi,
      out = {};
    for (const p of a.PROVINCE_ORDER) {
      const c = a.PROVINCES[p].castle;
      if (c) out[c] = { captured: !except.includes(p), attempts: 1, wins: 1 };
    }
    return out;
  }, except);
  return JSON.stringify(Object.assign({ version: 2, castles, unified: true }, extra));
};

let { page, errors, context } = await newContext();

console.log("■ 全国のデータ（旧国68か国）");
let r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    P = a.PROVINCES,
    ids = Object.keys(P),
    roads = {};
  for (const id of ids) roads[P[id].road] = (roads[P[id].road] || 0) + 1;
  const names = new Set(ids.map((id) => P[id].name)),
    castles = ids.filter((id) => P[id].castle).map((id) => P[id].castle);
  // 隣は左右どちらからも
  const sym = ids.every((id) => P[id].adj.every((q) => P[q] && P[q].adj.includes(id)));
  // 航路：陸続きでない2国を結び、両方の国に名前がある
  const routes = a.SEA_ROUTES.every(
    ([x, y, n]) =>
      P[x].routes[y] === n && P[y].routes[x] === n && !P[x].adj.filter((q) => !P[x].routes[q]).includes(y),
  );
  // 三河から全部の国へ行ける
  const seen = new Set(["mikawa"]),
    queue = ["mikawa"];
  while (queue.length) for (const q of P[queue.shift()].adj) if (!seen.has(q)) (seen.add(q), queue.push(q));
  return {
    n: ids.length,
    order: a.PROVINCE_ORDER.length,
    names: names.size,
    roads,
    castles: castles.length,
    uniqueCastles: new Set(castles).size,
    allCastles: castles.every((c) => a.NPC_CASTLES[c]),
    sym,
    routes,
    nRoutes: a.SEA_ROUTES.length,
    reach: seen.size,
    islands: ["sado", "oki", "awaji", "iki", "tsushima"].every(
      (p) => Object.keys(P[p].routes).length && P[p].adj.every((q) => P[p].routes[q]),
    ),
    legacy: JSON.stringify(a.LEGACY_PROVINCE_IDS),
    first: a.PROVINCE_ORDER.slice(0, 7).join(),
    old: ["kiyosu", "hikuma", "inabayama", "sunpu", "fukashi", "tsutsujigasaki"]
      .map((c) => [a.NPC_CASTLES[c].hp, a.NPC_CASTLES[c].power].join("/"))
      .join(),
    mikawaAdj: P.mikawa.adj.slice().sort().join(),
    lords: ids.every((id) => P[id].lord),
  };
});
check("旧国68か国（国名の重複なし）", r.n === 68 && r.order === 68 && r.names === 68, JSON.stringify(r));
check(
  "五畿七道で分ける（畿内5・東海道15・東山道8・北陸道7・山陰道8・山陽道8・南海道6・西海道11）",
  JSON.stringify(Object.fromEntries(Object.entries(r.roads).sort())) ===
    JSON.stringify({
      hokurikudo: 7,
      kinai: 5,
      nankaido: 6,
      saikaido: 11,
      san_indo: 8,
      sanyodo: 8,
      tokaido: 15,
      tosando: 8,
    }),
  JSON.stringify(r.roads),
);
check(
  "自国（三河）以外の67か国に城（城IDの重複なし）",
  r.castles === 67 && r.uniqueCastles === 67 && r.allCastles,
);
check("隣の国は左右どちらからも隣（データの食い違いなし）", r.sym);
check(
  "航路は陸続きでない国を結び、名前がある（佐渡・隠岐・淡路・四国・九州・壱岐・対馬など）",
  r.routes && r.nRoutes >= 15,
  String(r.nRoutes),
);
check("島の国（佐渡・隠岐・淡路・壱岐・対馬）へは航路だけで行ける", r.islands);
check("三河から全部の国へ行ける", r.reach === 68, String(r.reach));
check("国ごとに勢力（敵の大名など）", r.lords);
check(
  "以前の7か国のIDはそのまま（旧ID → 新ID の対応表）",
  r.legacy ===
    JSON.stringify({
      mikawa: "mikawa",
      owari: "owari",
      totomi: "totomi",
      mino: "mino",
      suruga: "suruga",
      shinano: "shinano",
      kai: "kai",
    }) && r.first === "mikawa,owari,totomi,mino,suruga,shinano,kai",
  r.legacy,
);
check(
  "以前の6つの城の耐久・強さはそのまま",
  r.old === "1600/1,1800/1.1,2200/1.25,2400/1.35,2600/1.45,3000/1.6",
  r.old,
);
check(
  "三河の隣は今までどおり（尾張・遠江・美濃・信濃）",
  r.mikawaAdj === "mino,owari,shinano,totomi",
  r.mikawaAdj,
);

console.log("■ 城の強さと特色");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    P = a.PROVINCES,
    C = (p) => a.NPC_CASTLES[P[p].castle],
    count = (c, kind) => c.garrison.filter((g) => g.kind === kind).reduce((n, g) => n + g.n, 0),
    newOnes = a.PROVINCE_ORDER.slice(7);
  const byDist = newOnes.every((p) =>
    newOnes.every(
      (q) =>
        P[p].dist >= P[q].dist ||
        C(p).power <= C(q).power * 1.09 ||
        P[p].styles.includes("warlord") !== P[q].styles.includes("warlord"),
    ),
  );
  return {
    byDist,
    satsuma: C("satsuma").power,
    tsushima: C("tsushima").power,
    rec: {
      kai: a.recLevel(C("kai")),
      tsushima: a.recLevel(C("tsushima")),
      satsuma: a.recLevel(C("satsuma")),
    },
    kii: {
      magic: C("kii").towers.filter((t) => t.type === "magic").length,
      dragon: count(C("kii"), "dragon"),
    },
    echigo: {
      boss: count(C("echigo"), "boss"),
      wolf: count(C("echigo"), "wolf"),
      towerLevel: C("echigo").towerLevel,
    },
    dewa: { wolf: count(C("dewa"), "wolf"), dragon: count(C("dewa"), "dragon") },
    sado: { ice: C("sado").towers.filter((t) => t.type === "ice").length },
    // 同じ距離の国でも、守備兵の組み合わせが違う（体力だけではない）
    sameDist: new Set(
      newOnes
        .filter((p) => P[p].dist === 3)
        .map((p) => JSON.stringify(C(p).garrison.map((g) => g.kind + g.n))),
    ).size,
    recUp: newOnes.every((p) =>
      newOnes.every((q) => C(p).power <= C(q).power || a.recLevel(C(p)) >= a.recLevel(C(q))),
    ),
  };
});
check("三河から遠い国ほど城が強い（名将の国は少し強い）", r.byDist);
check(
  "最後の国の推奨は Lv100 くらい（対馬・薩摩）",
  r.rec.tsushima >= 85 && r.rec.tsushima <= 105 && r.rec.satsuma >= 70 && r.rec.kai <= 12,
  JSON.stringify(r.rec),
);
check("推奨レベルは城の強さの順", r.recUp);
check("紀伊（雑賀衆）：鉄砲の塔と鉄砲隊", r.kii.magic === 2 && r.kii.dragon >= 2, JSON.stringify(r.kii));
check(
  "越後（上杉家）：名将（大将が2人）・騎馬隊・堅城（塔の強化）",
  r.echigo.boss === 2 && r.echigo.wolf >= 6 && r.echigo.towerLevel === 3,
  JSON.stringify(r.echigo),
);
check("出羽：騎馬隊と弓隊", r.dewa.wolf >= 6 && r.dewa.dragon >= 6, JSON.stringify(r.dewa));
check("佐渡：水軍（水攻めの塔）", r.sado.ice === 1);
check("同じ距離の国でも守備兵の組み合わせが違う", r.sameDist >= 4, String(r.sameDist));
r = await page.evaluate(() => {
  // 攻城戦で城のデータどおりの塔・守備兵が出る
  const a = WD_DEBUG.squadApi;
  return a.NPC_CASTLES.saika.towers.length;
});
check("城ごとの塔の数（雑賀城 6基）", r === 6, String(r));

console.log("■ 三河からの進軍");
check("最初は三河だけ", (await owned(page)).join() === "mikawa");
check("攻められるのは三河の隣の4か国", (await open(page)).sort().join() === "mino,owari,shinano,totomi");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  return { satsuma: a.setTarget("uchijo"), omi: a.setTarget("kannonji"), t: a.targetCastleId() };
});
check(
  "隣でない国（薩摩・近江）は攻められない",
  /隣ではない/.test(r.satsuma || "") && /隣ではない/.test(r.omi || "") && r.t === "kiyosu",
  JSON.stringify(r),
);
r = await fight(page, "mino", "lose");
check("負けると制圧できない", !r.err && !r.owns, JSON.stringify(r));
r = await fight(page, "mino", "win");
check("勝つと制圧（領土 2/68）", r.owns && /領土 2\/68/.test(r.body), r.body && r.body.slice(0, 120));
const opened = await open(page);
check(
  "美濃の隣の近江・伊勢・飛騨・越前が攻められるようになる",
  ["omi", "ise", "hida", "echizen"].every((p) => opened.includes(p)),
  opened.join(),
);
r = await fight(page, "shinano");
r = await fight(page, "echigo");
check("信濃 → 越後と進める", r.owns, JSON.stringify(r).slice(0, 100));
check("越後を取ると、佐渡航路で佐渡へ渡れる", (await open(page)).includes("sado"));
r = await fight(page, "sado");
check("佐渡（島）を制圧", r.owns, JSON.stringify(r).slice(0, 120));
r = await page.evaluate(() => WD_DEBUG.squadApi.setTarget("kofuo"));
check("隠岐は出雲・伯耆からの航路でしか行けない（まだ攻められない）", /隣ではない/.test(r || ""), r);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));

console.log("■ 秘境（隠しルート）");
r = await fight(page, "omi");
check(
  "近江を制圧すると「比叡山の封印」を発見（結果画面で知らせる）",
  r.owns &&
    /秘境を発見：比叡山の封印/.test(r.body) &&
    /雷獣・白虎/.test(r.body) &&
    /推奨 Lv200/.test(r.body) &&
    /次の更新/.test(r.body),
  r.body && r.body.slice(0, 300),
);
r = await page.evaluate(() => {
  const m = WD_DEBUG.squadApi.conquestMeta();
  return { s: m.secrets, seen: m.secretSeen };
});
check("発見・お知らせ済みを保存", r.s.hiei === true && r.seen.hiei === true, JSON.stringify(r));
r = await fight(page, "omi");
check("演習でもう一度勝っても、お知らせは出ない（1回だけ）", !/秘境を発見/.test(r.body), r.body.slice(0, 80));
r = await fight(page, "totomi");
r = await fight(page, "suruga");
r = await fight(page, "kai");
let st = await page.evaluate(() => WD_DEBUG.squadApi.conquestMeta().secrets);
check("甲斐・駿河だけでは富士地下遺跡は見つからない（相模も必要）", !st.fuji, JSON.stringify(st));
r = await fight(page, "sagami");
check(
  "甲斐・駿河・相模を制圧すると「富士地下遺跡」を発見",
  r.owns && /秘境を発見：富士地下遺跡/.test(r.body) && /零式・天魔機神/.test(r.body) && /Lv1000/.test(r.body),
  r.body.slice(0, 200),
);
st = await stored(page, CKEY);
check(
  "保存データは version 2（秘境の発見・お知らせ済みを別に保存）",
  st.version === 2 && st.secrets.fuji && st.secretSeen.fuji,
);
r = await page.evaluate(() => {
  // 反撃で近江を奪われても、発見した秘境は残る
  const a = WD_DEBUG.squadApi,
    m = a.conquestMeta();
  a.conquest().kannonji.captured = false;
  a.checkSecrets();
  return { own: a.ownsProvince("omi"), hiei: m.secrets.hiei };
});
check("近江を失っても比叡山の封印は残る", !r.own && r.hiei, JSON.stringify(r));
await page.evaluate(() => (WD_DEBUG.squadApi.conquest().kannonji.captured = true));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 出雲・八岐、天下統一");
({ page, errors, context } = await newContext());
let seed = await allBut(page, ["izumo"], {
  secrets: { hiei: true, fuji: true },
  secretSeen: { hiei: true, fuji: true },
});
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CKEY, seed]);
await reload(page);
r = await page.evaluate(() => ({
  n: WD_DEBUG.squadApi.PROVINCE_ORDER.filter(WD_DEBUG.squadApi.ownsProvince).length,
  tenka: WD_DEBUG.squadApi.isTenka(),
  open: WD_DEBUG.squadApi.PROVINCE_ORDER.filter(WD_DEBUG.squadApi.canAttackProvince),
}));
check(
  "出雲以外の67か国を制圧した状態",
  r.n === 67 && !r.tenka && r.open.join() === "izumo",
  JSON.stringify(r),
);
const t0 = (await stored(page, WKEY)).tickets;
r = await fight(page, "izumo");
const t1 = (await stored(page, WKEY)).tickets;
check(
  "最後の国（出雲）で天下統一：結果画面に表示",
  r.owns && /天下統一！/.test(r.body) && /全国68か国を制覇した/.test(r.body),
  r.body.slice(0, 200),
);
check(
  "出雲を制圧すると「黄泉の洞窟」（冥龍・八岐・Lv500）を発見",
  /秘境を発見：黄泉の洞窟/.test(r.body) && /冥龍・八岐/.test(r.body) && /Lv500/.test(r.body),
);
check(
  "天下統一の報酬 🎴 ガチャ券 +30（出雲の攻略の報酬とは別）",
  t1 - t0 === 30 + (await page.evaluate(() => WD_DEBUG.squadApi.NPC_CASTLES.gassantoda.reward.tickets)),
  String(t1 - t0),
);
check("全国制覇中", await page.evaluate(() => WD_DEBUG.squadApi.isTenka()));
r = await fight(page, "izumo");
const t2 = (await stored(page, WKEY)).tickets;
check(
  "もう一度勝っても天下統一のお祝い・報酬は1回だけ",
  !/天下統一/.test(r.body) && t2 === t1,
  r.body.slice(0, 80),
);
r = await page.evaluate(() => {
  // 反撃で国を失うと全国制覇から外れる。取り返してもお祝いは出ない
  const a = WD_DEBUG.squadApi;
  a.conquest().gassantoda.captured = false;
  return { tenka: a.isTenka(), flag: a.conquestMeta().tenka };
});
check("国を失うと全国制覇から外れる（お祝い済みの記録は残る）", !r.tenka && r.flag, JSON.stringify(r));
r = await fight(page, "izumo");
check(
  // 取り返した城の報酬（今までどおり）は入るが、天下統一の +30 は入らない
  "取り返すと全国制覇に戻るが、天下統一のお祝い・報酬は出ない",
  r.owns &&
    !/天下統一/.test(r.body) &&
    (await page.evaluate(() => WD_DEBUG.squadApi.isTenka())) &&
    (await stored(page, WKEY)).tickets ===
      t2 + (await page.evaluate(() => WD_DEBUG.squadApi.NPC_CASTLES.gassantoda.reward.tickets)),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データの移行");
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({
    version: 1,
    castles: {
      kiyosu: { captured: true, attempts: 3, wins: 2 },
      hikuma: { captured: true, attempts: 1, wins: 1 },
      inabayama: { captured: true, attempts: 1, wins: 1 },
      sunpu: { captured: true, attempts: 1, wins: 1 },
      fukashi: { captured: true, attempts: 1, wins: 1 },
      tsutsujigasaki: { captured: true, attempts: 4, wins: 1 },
      edo: { captured: true }, // 知らない城
    },
    target: "kiyosu",
    unified: true,
  }),
}));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  return {
    owned: a.PROVINCE_ORDER.filter(a.ownsProvince).join(),
    kiyosu: a.conquest().kiyosu,
    unified: a.conquestMeta().unified,
    tenka: a.conquestMeta().tenka,
    edo: "edo" in a.conquest(),
    secrets: a.conquestMeta().secrets,
  };
});
check(
  "7か国を統一した以前のデータ：そのまま7か国（攻めた回数なども同じ・統一済み）",
  r.owned === "mikawa,owari,totomi,mino,suruga,shinano,kai" &&
    r.kiyosu.attempts === 3 &&
    r.kiyosu.wins === 2 &&
    r.unified &&
    !r.tenka,
  JSON.stringify(r),
);
check("知らない城は読み込まない・秘境はまだない", !r.edo && Object.keys(r.secrets).length === 0);
await reload(page);
await reload(page);
r = await page.evaluate(() => WD_DEBUG.squadApi.PROVINCE_ORDER.filter(WD_DEBUG.squadApi.ownsProvince).length);
check("何度読み込み直しても同じ（二重の制圧・消失なし）", r === 7, String(r));
await context.close();
({ page, errors, context } = await newContext({
  // 近江を取ったが、秘境の項目がない保存データ（領土から計算し直す）
  [CKEY]: JSON.stringify({
    version: 2,
    castles: { inabayama: { captured: true }, kannonji: { captured: true } },
    secrets: { nope: true },
  }),
}));
r = await page.evaluate(() => ({
  s: WD_DEBUG.squadApi.conquestMeta().secrets,
  seen: WD_DEBUG.squadApi.conquestMeta().secretSeen,
}));
check(
  "秘境は領土から計算し直す（知らない秘境は無視）",
  JSON.stringify(r.s) === JSON.stringify({ hiei: true }) && !r.seen.hiei,
  JSON.stringify(r),
);
await page.tap("#mapOpen");
let text = await page.textContent("#mapBody");
check(
  "まだ知らせていない発見は、全国の画面を開いたときに1回だけ知らせる",
  /秘境を発見：比叡山の封印/.test(text),
  text.slice(0, 120),
);
await page.tap("#mapClose");
await page.tap("#mapOpen");
check("2回目は知らせない", !/秘境を発見/.test(await page.textContent("#mapBody")));
await page.tap("#mapClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 領土の効果・反撃");
({ page, errors, context } = await newContext());
seed = await allBut(page, []);
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CKEY, seed]);
await reload(page);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  return {
    hire: a.territoryBonus("hire"),
    repair: a.territoryBonus("repair"),
    waveGold: a.territoryBonus("waveGold"),
    start: a.startGold(),
  };
});
check(
  "全国の領土の効果は上限まで（雇用 -50%・修理 -60%・ウェーブのゴールド +150%）",
  r.hire <= 0.5 && r.repair <= 0.6 && r.waveGold <= 1.5 && r.start > 500,
  JSON.stringify(r),
);
await context.close();
({ page, errors, context } = await newContext());
seed = await allBut(
  page,
  ["oki", "tsushima"].concat([
    "iki",
    "hizen",
    "chikuzen",
    "chikugo",
    "buzen",
    "bungo",
    "higo",
    "hyuga",
    "osumi",
    "satsuma",
  ]),
);
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CKEY, seed]);
await reload(page);
r = await fight(page, "oki", "win", 0); // 必ず反撃
r = await page.evaluate(() => WD_DEBUG.squadApi.activeCounter());
check(
  "新しい国でも反撃がある（境目の国へ、まだ取っていない隣国から）",
  !!r &&
    (await page.evaluate(
      (c) =>
        WD_DEBUG.squadApi.borderProvinces().includes(c.province) && !WD_DEBUG.squadApi.ownsProvince(c.from),
      r,
    )),
  JSON.stringify(r),
);
await context.close();

console.log("■ 全国の画面（375×667）");
({ page, errors, context } = await newContext({}, 375, 667));
check("メニューに「🗾 全国」", await page.isVisible("#mapOpen"));
await page.tap("#mapOpen");
text = await page.textContent("#mapBody");
check(
  "制圧数・地方の簡易地図（五畿七道）・攻略可能・秘境",
  /制圧 1\/68か国/.test(text) &&
    /簡略図/.test(text) &&
    (await page.$$(".road-map .road")).length === 8 &&
    /攻略可能 4/.test(text) &&
    /秘境 0\/3/.test(text),
  text.slice(0, 200),
);
check("地方の進み具合（東海道 1/15）", /東海道1\/15/.test(text.replace(/\s/g, "")));
r = await page.evaluate(() =>
  [...document.querySelectorAll(".prov-row")]
    .map((b) => b.className.match(/s-(own|open|lock)/)[1] + ":" + b.dataset.mapProv)
    .join(),
);
check(
  "制圧済み・攻略可能・未攻略を色分け",
  /own:mikawa/.test(r) && /open:owari/.test(r) && /lock:suruga/.test(r),
  r,
);
await page.tap('[data-map-prov="owari"]');
text = await page.textContent(".prov-detail");
check(
  "国をタップ：国名・城・勢力・推奨Lv・報酬・隣の国・出陣",
  /尾張/.test(text) &&
    /清洲城/.test(text) &&
    /織田家/.test(text) &&
    /推奨 Lv/.test(text) &&
    /ガチャ券 \+3/.test(text) &&
    /隣の国：/.test(text) &&
    /出陣/.test(text),
  text,
);
if (shots) await page.screenshot({ path: path.join(shots, "n1-map.png") });
await page.tap('[data-map-road="saikaido"]');
await page.tap('[data-map-prov="tsushima"]');
text = await page.textContent(".prov-detail");
check(
  "対馬：未攻略・航路（⛵対馬海峡）・出陣できない",
  /未攻略/.test(text) && /⛵対馬海峡/.test(text) && (await page.isDisabled('[data-map-go="kaneishi"]')),
  text,
);
await page.tap('[data-map-tab="secret"]');
text = await page.textContent("#mapBody");
check(
  "秘境：まだ見つかっていないものは ？？？",
  (text.match(/？？？/g) || []).length === 3,
  text.slice(0, 200),
);
await page.tap('[data-map-tab="open"]');
await page.tap('[data-map-prov="mino"]');
await page.tap('[data-map-go="inabayama"]');
check(
  "出陣：攻城編成の画面へ（目標が選ばれている）",
  (await page.isHidden("#mapSheet")) &&
    !(await page.isHidden("#siegeSheet")) &&
    /稲葉山城を攻める/.test(await page.textContent("#siegeGo")),
);
await page.tap("#siegeTarget [data-provinces]");
check("攻城編成の領土の一覧から全国の画面を開ける", await page.isVisible("#siegePick [data-map-open]"));
await page.tap("#siegePick [data-map-open]");
check("（開いた）", !(await page.isHidden("#mapSheet")));
r = await page.evaluate(() => {
  const sh = document.querySelector("#mapSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    btns = [...sh.querySelectorAll("button")].filter((b) => b.getClientRects().length);
  sh.scrollTop = sh.scrollHeight;
  const close = document.getElementById("mapClose").getBoundingClientRect();
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    wide: btns.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    minBtn: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    close: close.top >= rr.top - 1 && close.bottom <= innerHeight,
  };
});
check(
  "画面に収まり、横にはみ出さない・ボタンは44px以上・下まで動かしても閉じるが見える",
  r.inView && !r.hScroll && r.wide && r.minBtn >= 44 && r.close,
  JSON.stringify(r),
);
await page.keyboard.press("Escape");
check("Escで閉じる", await page.isHidden("#mapSheet"));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 全国の画面（390×844・秘境あり）");
({ page, errors, context } = await newContext({}, 390, 844));
seed = await allBut(page, ["tsushima"], {
  secrets: { hiei: true, yomi: true, fuji: true },
  secretSeen: { hiei: true, yomi: true, fuji: true },
});
await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CKEY, seed]);
await reload(page);
await page.tap("#mapOpen");
text = await page.textContent("#mapBody");
check("制圧 67/68", /制圧 67\/68か国/.test(text), text.slice(0, 60));
await page.tap('[data-map-tab="secret"]');
text = await page.textContent("#mapBody");
check(
  "秘境3つ：名前・主・推奨Lv・討伐戦は次の更新（押せない）",
  /比叡山の封印/.test(text) &&
    /黄泉の洞窟/.test(text) &&
    /富士地下遺跡/.test(text) &&
    /雷獣・白虎/.test(text) &&
    /冥龍・八岐/.test(text) &&
    /零式・天魔機神/.test(text) &&
    (await page.$$eval(".secret-card button", (bs) => bs.length === 3 && bs.every((b) => b.disabled))),
  text.slice(0, 200),
);
if (shots) await page.screenshot({ path: path.join(shots, "n2-secrets.png") });
r = await page.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  minBtn: Math.min(
    ...[...document.querySelectorAll("#mapSheet button")]
      .filter((b) => b.getClientRects().length)
      .map((b) => b.getBoundingClientRect().height),
  ),
}));
check("390px でも横スクロールなし・ボタン44px以上", !r.hScroll && r.minBtn >= 44, JSON.stringify(r));
await page.tap("#mapClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
