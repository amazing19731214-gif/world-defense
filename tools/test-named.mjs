#!/usr/bin/env node
import { installJobBookTestFixtures } from "./job-book-test-utils.mjs";
// ネームド兵士（戦国の有名人物）の確認：データ（武将との重複なし・兵種）、抽選の確率、対応する兵種で登場、同時に重複しない、
// 費用は通常どおり、固有スキル、戦死・再登場（Lv1）、保存と以前の保存データ、戦国図鑑（発見・戦死しても残る・再読み込み）、画面
//   node tools/test-named.mjs
//   SCREENSHOTS=dir node tools/test-named.mjs … 画面写真も保存
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
  WKEY = "worldDefense.warlords.v1",
  ZKEY = "worldDefense.zukan.v1";
const emptySoldiers = { version: 1, seq: 0, squadSeq: 0, squads: [], soldiers: [], fallen: [] };
const emptyWarlords = { version: 1, owned: {}, tickets: 0, history: [] };

async function newContext(seeds = {}, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await installJobBookTestFixtures(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  const all = Object.assign(
    { [SKEY]: JSON.stringify(emptySoldiers), [WKEY]: JSON.stringify(emptyWarlords) },
    seeds,
  );
  await page.evaluate((all) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(all)) localStorage.setItem(k, v);
  }, all);
  await reload(page);
  return { page, errors, context };
}
async function reload(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate(() => WD_DEBUG.setGold(99999));
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const clearWave = (page) =>
  ev(page, () => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });

let { page, errors, context } = await newContext();

console.log("■ 人物のデータ");
let r = await ev(page, () => {
  const N = WD_DEBUG.namedApi,
    a = WD_DEBUG.squadApi;
  const warlordNames = Object.values(WD_DEBUG.config.WARLORDS).map((w) => w.name);
  const list = Object.entries(N.NAMED_SOLDIERS);
  const types = WD_DEBUG.state().unitTypes || null;
  return {
    n: list.length,
    names: list.map(([, p]) => p.name),
    dup: list.filter(([, p]) => warlordNames.includes(p.name)).map(([, p]) => p.name),
    tadakatsu: list.some(([, p]) => p.name === "本多忠勝"),
    badType: list.filter(([, p]) => !WD_DEBUG.unitConfig.SOLDIER_TYPES[p.type]).map(([id]) => id),
    noSkill: list.filter(([, p]) => !p.skill || !p.skill.name || !p.skill.text).map(([id]) => id),
    unique: new Set(list.map(([, p]) => p.name)).size === list.length,
    bonds: N.NAMED_BONDS.every(
      (b) =>
        b.named.every((id) => N.NAMED_SOLDIERS[id]) && b.warlords.every((id) => WD_DEBUG.config.WARLORDS[id]),
    ),
    ryosen: (N.NAMED_BONDS.find((b) => b.name === "毛利両川") || {}).named,
    chance: N.NAMED_RULES.chance,
    weak: list.every(([, p]) =>
      Object.entries(p.skill).every(([k, v]) => typeof v !== "number" || v <= 0.15),
    ),
  };
});
check("18人・名前の重複なし", r.n === 18 && r.unique, JSON.stringify(r.names));
check("武将ガチャの30人と重ならない（本多忠勝も入れない）", r.dup.length === 0 && !r.tadakatsu, r.dup.join());
check("すべて今ある兵種で登場する", r.badType.length === 0, r.badType.join());
check("人物ごとに固有スキルが1つ（控えめな効果）", r.noSkill.length === 0 && r.weak, r.noSkill.join());
check(
  "人物どうしのゆかりをデータで定義（毛利両川＝小早川隆景・吉川元春）",
  r.bonds && JSON.stringify(r.ryosen) === '["takakage","motoharu"]',
  JSON.stringify(r.ryosen),
);
check("出現確率の設定は2%", r.chance === 0.02);

console.log("■ 抽選の確率");
r = await ev(page, () => {
  const N = WD_DEBUG.namedApi;
  let x = 12345;
  const lcg = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  N.setRng(lcg);
  const rate = (type, n) => {
    let hit = 0;
    for (let i = 0; i < n; i++) if (N.rollNamed(type)) hit++;
    return hit / n;
  };
  const out = { spear: rate("spearman", 40000), medic: rate("medic", 40000) };
  N.NAMED_RULES.chance = 0.1;
  out.ten = rate("cavalry", 20000);
  N.NAMED_RULES.chance = 0.02;
  const who = {};
  for (let i = 0; i < 40000; i++) {
    const id = N.rollNamed("cavalry");
    if (id) who[id] = (who[id] || 0) + 1;
  }
  out.cav = Object.keys(who).sort().join();
  const ash = {};
  for (let i = 0; i < 40000; i++) {
    const id = N.rollNamed("ashigaru");
    if (id) ash[id] = 1;
  }
  out.ash = Object.keys(ash).sort().join();
  const med = {};
  for (let i = 0; i < 40000; i++) {
    const id = N.rollNamed("medic");
    if (id) med[id] = 1;
  }
  out.med = Object.keys(med).sort().join();
  N.setRng(() => 1);
  return out;
});
check("設定確率（2%）に従って抽選される", r.spear > 0.017 && r.spear < 0.023, String(r.spear));
check("確率は後から変えられる（10%にすると約10%）", r.ten > 0.09 && r.ten < 0.11, String(r.ten));
check("衛生兵でも約2%で出る", r.medic > 0.017 && r.medic < 0.023, String(r.medic));
check("衛生兵では衛生兵の人物（細川藤孝・曲直瀬玄朔・田代三喜）だけが選ばれる", r.med === "fujitaka,gensaku,sanki", r.med);
check("騎兵では騎兵の人物（馬場信春・山県昌景）だけが選ばれる", r.cav === "masakage,nobuharu", r.cav);
check(
  "足軽では足軽の人物（服部半蔵・風魔小太郎・猿飛佐助・吉川元春）だけが選ばれる",
  r.ash === "hanzo,kotaro,motoharu,sasuke",
  r.ash,
);

console.log("■ 通常の雇用（ネームド兵士が出ないとき）");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    g0 = WD_DEBUG.state().gold;
  const q = a.hireSquad("spearman", 650, 300);
  const m = a.members(q);
  return {
    n: m.length,
    cost: g0 - WD_DEBUG.state().gold,
    named: m.filter((s) => s.named).length,
    names: m.filter((s) => s.name).length,
  };
});
check(
  "通常の雇用は今までどおり（10人・名前なし・ネームドなし）",
  r.n === 10 && r.named === 0 && r.names === 0,
  JSON.stringify(r),
);
const normalCost = r.cost;

console.log("■ ネームド兵士の雇用");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    N = WD_DEBUG.namedApi;
  N.setRng(() => 0); // 毎回当たり
  const g0 = WD_DEBUG.state().gold;
  const q = a.hireSquad("spearman", 400, 165);
  const cost = g0 - WD_DEBUG.state().gold;
  const m = a.members(q);
  const named = m.filter((s) => s.named);
  const msgText = document.getElementById("msg").textContent;
  // 鉄砲兵の人物は2人：10人を雇うと2人が人物、残り8人は通常（同じ人物は同時に1人まで）
  const q2 = a.hireSquad("gunner", 790, 300);
  const g = a.members(q2);
  const q3 = a.hireSquad("gunner", 520, 300);
  const g3 = q3 ? a.members(q3).filter((s) => s.named).length : -1;
  N.setRng(() => 1);
  return {
    cost,
    named: named.map((s) => s.named + ":" + s.type + ":" + s.name + ":" + s.level),
    sameType: named.every((s) => N.NAMED_SOLDIERS[s.named].type === "spearman" && s.type === "spearman"),
    gun: g
      .filter((s) => s.named)
      .map((s) => s.named)
      .sort()
      .join(),
    gunNormal: g.filter((s) => !s.named).length,
    g3,
    allNamed: WD_DEBUG.state()
      .soldiers.filter((s) => s.named)
      .map((s) => s.named),
    msg: msgText,
  };
});
check("雇用費は通常の兵士と同じ", r.cost === normalCost, r.cost + " / " + normalCost);
check(
  "対応する兵種（槍兵）で、Lv1・人物の名前で登場",
  r.named.length === 6 && r.sameType && r.named.every((x) => x.endsWith(":1")),
  JSON.stringify(r.named),
);
check(
  "鉄砲兵を10人雇うと人物は2人（雑賀孫市・佐々成政）、残りは通常の兵士",
  r.gun === "magoichi,narimasa" && r.gunNormal === 8,
  JSON.stringify(r),
);
check(
  "同じ人物が同時に複数いない（もう一度鉄砲兵を雇っても人物は出ない）",
  r.g3 === 0 && new Set(r.allNamed).size === r.allNamed.length,
  JSON.stringify(r.allNamed),
);
check("仕官したことを短く知らせる", /⭐.*が仕官した！/.test(r.msg), r.msg);

console.log("■ 固有スキル・表示");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state().soldiers,
    mago = S.find((s) => s.named === "magoichi"),
    normal = S.find((s) => s.type === "gunner" && !s.named);
  const sm = a.soldierStats(mago),
    sn = a.soldierStats(normal);
  return {
    ratio: sm.atk / sn.atk,
    hp: sm.maxHp === sn.maxHp,
    name: WD_DEBUG.namedApi.soldierName(mago),
    rename: WD_DEBUG.squadApi.nameSoldier ? WD_DEBUG.squadApi.nameSoldier(mago.id, "別の名") : "n/a",
    still: mago.name,
  };
});
check(
  "固有スキル「雑賀撃ち」：攻撃力 +6%（ほかは通常と同じ）",
  Math.abs(r.ratio - 1.06) < 0.001 && r.hp,
  JSON.stringify(r),
);
check("名前の前に⭐を付けて表示", r.name === "⭐雑賀孫市", String(r.name));
check("ネームド兵士の名前は変えられない", r.still === "雑賀孫市" && r.rename !== null, String(r.rename));

console.log("■ 戦国図鑑");
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi;
  return {
    z: Object.keys(F.zukan().named || {})
      .sort()
      .join(),
    c: F.zukanCount("named"),
  };
});
check(
  "初めて雇ったら図鑑に登録（槍兵の6人と鉄砲兵の2人）",
  r.z === "danemon,dosetsu,magoichi,nagayoshi,narimasa,saizo,sakon,ujitsuna",
  r.z,
);
check("ネームド兵士図鑑：8/18", r.c.found === 8 && r.c.total === 18, JSON.stringify(r.c));
const zSaved = await ev(page, (k) => JSON.parse(localStorage.getItem(k)).named, ZKEY);
check("発見の記録を保存", Object.keys(zSaved || {}).length === 8, JSON.stringify(zSaved));

console.log("■ 保存と再読み込み");
// 雇った兵士はウェーブのクリアで保存される（今までどおり）
await ev(page, () => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
});
await clearWave(page);
let saved = await ev(
  page,
  (k) =>
    JSON.parse(localStorage.getItem(k))
      .soldiers.filter((s) => s.named)
      .map((s) => s.named)
      .sort()
      .join(),
  SKEY,
);
check("保存データにネームド兵士の人物を記録", saved.split(",").length === 8, saved);
await reload(page);
r = await ev(page, () =>
  WD_DEBUG.state()
    .soldiers.filter((s) => s.named)
    .map((s) => s.named + ":" + s.name)
    .sort(),
);
check(
  "再読み込みしても人物・名前が残る",
  r.length === 8 && r.includes("magoichi:雑賀孫市"),
  JSON.stringify(r),
);

console.log("■ 戦死と再登場");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    N = WD_DEBUG.namedApi,
    S = WD_DEBUG.state();
  const mago = S.soldiers.find((s) => s.named === "magoichi"),
    q = S.squads.find((x) => x.id === mago.squadId);
  mago.level = 12;
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  q.frontId = mago.id;
  mago.skills = mago.skills.filter((x) => x !== "unyielding");
  mago.hp = 0.1;
  a.damageSquad(q, 99999, false);
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  const out = { alive: mago.alive, zukan: !!WD_DEBUG.forgeApi.zukan().named.magoichi };
  const fallen = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).fallen;
  out.fallen = fallen.some((f) => f.named === "magoichi" && f.name === "雑賀孫市");
  out.inSave = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.some(
    (s) => s.named === "magoichi",
  );
  // 戦死後の雇用：もう一度現れる（Lv1から）。佐々成政は生きているので、鉄砲兵の候補は雑賀孫市だけ
  N.setRng(() => 0);
  const gq = S.squads.find((x) => a.members(x).some((s) => s.named === "narimasa")) || q;
  let err = a.recruitInto(q, "gunner");
  if (err) {
    a.transferSoldier(a.roster(q).find((s) => s.alive && !s.named).id, "new");
    err = a.recruitInto(q, "gunner");
  }
  N.setRng(() => 1);
  const again = S.soldiers.filter((s) => s.alive && s.named === "magoichi");
  out.err = err;
  out.again = again.map((s) => s.level + ":" + s.name + ":" + (s.id !== mago.id));
  return out;
});
check(
  "ネームド兵士も通常どおり戦死して失われる（特別な保護なし）",
  r.alive === false && !r.inSave,
  JSON.stringify(r),
);
check("戦死すると英霊名鑑に人物として残る", r.fallen, JSON.stringify(r));
check("戦死しても図鑑の発見は残る", r.zukan);
check(
  "戦死後、のちの雇用で再登場できる（Lv1から・別の兵士として）",
  r.again.length === 1 && r.again[0] === "1:雑賀孫市:true",
  JSON.stringify(r),
);
await reload(page);
r = await ev(page, () => !!WD_DEBUG.forgeApi.zukan().named.magoichi);
check("再読み込み後も発見の記録が残る", r);
await ev(page, () => document.getElementById("reset").click());
r = await ev(page, () => WD_DEBUG.forgeApi.zukanCount("named"));
check("「最初から」でも発見の記録が残る", r.found === 8, JSON.stringify(r));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ・不正なデータ");
const oldSave = {
  version: 1,
  seq: 30,
  squadSeq: 2,
  squads: [
    { id: 1, type: "spearman", slot: 0 },
    { id: 2, type: "gunner", slot: 1 },
  ],
  soldiers: [],
  fallen: [],
};
for (let k = 0; k < 5; k++)
  oldSave.soldiers.push({ id: k + 1, type: "spearman", squadId: 1, level: 3, skills: [] });
oldSave.soldiers.push({ id: 6, type: "gunner", squadId: 2, level: 3, skills: [] });
// 図鑑の前の形（named なし）
const oldZukan = { version: 1, warlords: {}, skills: {}, items: {}, jobs: { spearman: true } };
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(oldSave),
  [ZKEY]: JSON.stringify(oldZukan),
}));
r = await ev(page, () => ({
  n: WD_DEBUG.state().soldiers.length,
  named: WD_DEBUG.state().soldiers.filter((s) => s.named).length,
  c: WD_DEBUG.forgeApi.zukanCount("named"),
  jobs: !!WD_DEBUG.forgeApi.zukan().jobs.spearman,
}));
check("ネームド兵士のない以前の保存データをそのまま読める", r.n === 6 && r.named === 0, JSON.stringify(r));
check(
  "以前の図鑑の記録もそのまま（ネームド兵士は 0/18 から）",
  r.jobs && r.c.found === 0 && r.c.total === 18,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

const bad = JSON.parse(JSON.stringify(oldSave));
bad.soldiers[0].named = "sakon";
bad.soldiers[0].name = "島左近";
bad.soldiers[1].named = "sakon"; // 同じ人物が2人
bad.soldiers[2].named = "magoichi"; // 兵種が合わない（槍兵の雑賀孫市）
bad.soldiers[3].named = "nobunaga"; // いない人物
bad.soldiers[3].name = "偽名";
({ page, errors, context } = await newContext({ [SKEY]: JSON.stringify(bad) }));
r = await ev(page, () =>
  WD_DEBUG.state()
    .soldiers.filter((s) => s.id <= 4)
    .map((s) => s.id + ":" + s.named + ":" + s.name),
);
check(
  "不正なネームド兵士（重複・兵種違い・いない人物）は通常の兵士として読む",
  JSON.stringify(r) === JSON.stringify(["1:sakon:島左近", "2:null:null", "3:null:null", "4:null:null"]),
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 忍びの3人：足軽で雇い、Lv30で忍者に転職");
({ page, errors, context } = await newContext());
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    N = WD_DEBUG.namedApi,
    J = WD_DEBUG.jobApi,
    S = WD_DEBUG.state();
  N.setRng(() => 0);
  const q = a.hireSquad("ashigaru", 650, 300);
  N.setRng(() => 1);
  const m = a.members(q),
    hanzo = m.find((s) => s.named === "hanzo"),
    kotaro = m.find((s) => s.named === "kotaro"),
    normal = m.find((s) => !s.named);
  const out = {
    hired: m.filter((s) => s.named).map((s) => s.named + ":" + s.type + ":" + s.job + ":" + s.level),
  };
  hanzo.level = 29;
  out.lv29 = J.changeJob(hanzo, "ninja");
  for (const s of [hanzo, kotaro, normal]) { s.level = 30; seedJobEntry(s, ["ninja"]); }
  a.saveRoster();
  out.ok = [J.changeJob(hanzo, "ninja"), J.changeJob(kotaro, "ninja"), J.changeJob(normal, "ninja")];
  out.after = [hanzo, kotaro].map((s) => s.named + ":" + s.name + ":" + s.type + ":" + s.job);
  out.rate = a.soldierStats(kotaro).rate / a.soldierStats(normal).rate;
  out.name = N.soldierName(hanzo);
  out.zukan = !!WD_DEBUG.forgeApi.zukan().named.hanzo && !!WD_DEBUG.forgeApi.zukan().jobs.ninja;
  return out;
});
check(
  "服部半蔵・風魔小太郎・猿飛佐助は足軽（初期職も足軽）・Lv1で雇われる",
  JSON.stringify(r.hired) ===
    JSON.stringify([
      "hanzo:ashigaru:ashigaru:1",
      "kotaro:ashigaru:ashigaru:1",
      "sasuke:ashigaru:ashigaru:1",
      "motoharu:ashigaru:ashigaru:1",
    ]),
  JSON.stringify(r.hired),
);
check("転職の条件は今までどおり（Lv29では忍者になれない）", /Lv30から/.test(r.lv29 || ""), String(r.lv29));
check(
  "Lv30で忍者に転職できる",
  r.ok.every((e) => e === null),
  JSON.stringify(r.ok),
);
check(
  "転職後も人物と名前はそのまま（動きは忍者＝騎兵）",
  JSON.stringify(r.after) ===
    JSON.stringify(["hanzo:服部半蔵:cavalry:ninja", "kotaro:風魔小太郎:cavalry:ninja"]) &&
    r.name === "⭐服部半蔵",
  JSON.stringify(r),
);
check(
  "転職後も固有スキルが効く（風魔の夜襲：攻撃の間隔 -6%）",
  Math.abs(r.rate - 0.94) < 0.001,
  String(r.rate),
);
check("転職後も図鑑の記録が残る（忍者も職業図鑑に登録）", r.zukan);
await ev(page, () => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
});
await clearWave(page);
await reload(page);
r = await ev(page, () =>
  WD_DEBUG.state()
    .soldiers.filter((s) => s.named)
    .map((s) => s.named + ":" + s.name + ":" + s.type + ":" + s.job)
    .sort(),
);
check(
  "忍者に転職したネームド兵士も、再読み込み後に人物・名前・職業が残る",
  r.includes("hanzo:服部半蔵:cavalry:ninja") &&
    r.includes("kotaro:風魔小太郎:cavalry:ninja") &&
    r.length === 4,
  JSON.stringify(r),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    N = WD_DEBUG.namedApi,
    S = WD_DEBUG.state();
  const k = S.soldiers.find((s) => s.named === "kotaro"),
    q = S.squads.find((x) => x.id === k.squadId);
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  q.frontId = k.id;
  k.skills = k.skills.filter((x) => x !== "unyielding");
  k.hp = 0.1;
  a.damageSquad(q, 99999, false);
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  const dead = !k.alive;
  N.setRng(() => 0);
  const err = a.recruitInto(q, "ashigaru");
  N.setRng(() => 1);
  const again = S.soldiers.filter((s) => s.alive && s.named === "kotaro");
  return {
    dead,
    err,
    again: again.map((s) => s.type + ":" + s.job + ":" + s.level + ":" + s.jobs.join("/")),
    zukan: !!WD_DEBUG.forgeApi.zukan().named.kotaro,
  };
});
check(
  "忍者の風魔小太郎が戦死 → 再登場はLv1の足軽から育て直し",
  r.dead && !r.err && JSON.stringify(r.again) === JSON.stringify(["ashigaru:ashigaru:1:ashigaru"]) && r.zukan,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 画面（375×667）");
({ page, errors, context } = await newContext({}, 375, 667));
await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    N = WD_DEBUG.namedApi;
  N.setRng(() => 0);
  a.hireSquad("ashigaru", 650, 300);
  N.setRng(() => 1);
  a.hireSquad("archer", 400, 165);
  WD_DEBUG.step(0.2);
});
if (shots) await page.screenshot({ path: path.join(shots, "n1-field.png") });
await page.tap("#zukanOpen");
await page.tap('[data-zk-tab="named"]');
r = await ev(page, () => {
  const body = document.getElementById("zukanBody"),
    tabs = [...body.querySelectorAll("[data-zk-tab]")];
  return {
    text: body.textContent.replace(/\s/g, ""),
    tiles: body.querySelectorAll(".zk-tile").length,
    locked: body.querySelectorAll(".zk-tile.lock").length,
    lockText: [...body.querySelectorAll(".zk-tile.lock")].map((b) => b.textContent.replace(/\s/g, "")),
    gotText: [...body.querySelectorAll(".zk-tile:not(.lock)")].map((b) => b.textContent.replace(/\s/g, "")),
    secret: /雑賀撃ち|智将の采配|鬼左近/.test(body.innerHTML),
    hScroll: document.documentElement.scrollWidth > innerWidth,
    tabsFit: tabs.every(
      (b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= innerWidth,
    ),
    tabH: Math.min(...tabs.map((b) => b.getBoundingClientRect().height)),
  };
});
check(
  "図鑑に「ネームド兵士」の分類：4/18・総合は292（強敵7を含む）",
  /ネームド兵士図鑑4\/18/.test(r.text) && /総合[0-9]+\/292/.test(r.text),
  r.text.slice(0, 160),
);
check(
  "未発見の人物も名前と兵種を出し「未習得」・発見済みは「習得済」（固有スキルは出さない）",
  r.tiles === 18 &&
    r.locked === 14 &&
    r.lockText.includes("No.001💥雑賀孫市鉄砲兵・未習得") &&
    r.lockText.includes("No.018🩹田代三喜衛生兵・未習得") &&
    r.gotText.includes("No.011🗡服部半蔵足軽・習得済") &&
    !r.secret,
  JSON.stringify(r),
);
check(
  "375×667：タブ5つが収まる・横にはみ出さない・押しやすい高さ",
  !r.hScroll && r.tabsFit && r.tabH >= 44,
  JSON.stringify(r),
);
const hNo = await ev(
  page,
  () => [...document.querySelectorAll(".zk-tile")].find((t) => /服部半蔵/.test(t.textContent)).dataset.zkNo,
);
await page.tap(`[data-zk-no="${hNo}"]`);
let text = await page.textContent("#zkDetail");
check(
  "詳細：名前・兵種・在籍中・固有スキル・出会い方・ゆかり（未発見の相手は???）",
  /服部半蔵/.test(text) &&
    /兵種：足軽/.test(text) &&
    /在籍中・Lv1/.test(text) &&
    /伊賀の頭領/.test(text) &&
    /足軽を雇うと/.test(text) &&
    /ゆかり「忍びの者」：風魔小太郎・猿飛佐助/.test(text),
  text,
);
if (shots) await page.screenshot({ path: path.join(shots, "n2-zukan.png") });
await page.keyboard.press("Escape");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
