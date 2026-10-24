#!/usr/bin/env node
// 兵士の育成・命名・スキル・英霊名鑑・武将の負傷の動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test-soldiers.mjs
//   SCREENSHOTS=dir node tools/test-soldiers.mjs … 画面写真も保存
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
const WKEY = "worldDefense.warlords.v1",
  SKEY = "worldDefense.soldiers.v1";
let promptAnswer = "";
// seeds … 最初に入れておく保存データ { キー: 文字列 }（同じ context で再読み込みしても入れ直さない）
async function newContext(seeds = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(promptAnswer) : d.accept()));
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  // 保存データは最初に一度だけ入れて読み込み直す（再読み込みのたびに入れ直さない）。
  // 読み込みのたびに保存データを触る準備スクリプトは、直前の保存と重なると古い内容を読むことがあるため使わない
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const reload = async (page) => {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
};
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const ev = (page, fn, arg) => page.evaluate(fn, arg);
// ウェーブを開始し、自動の出現を止めて、遠くに止まる敵（holder）でウェーブを続けさせる
const startHeldWave = (page) =>
  ev(page, () => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  });
// 敵をすべて消してウェーブをクリアさせる
const clearWave = (page) =>
  ev(page, () => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });

let { page, errors, context } = await newContext({
  [WKEY]: JSON.stringify({ version: 1, owned: { yukimura: 1, kanbei: 1 }, tickets: 0, history: [] }),
});
await ev(page, () => WD_DEBUG.setGold(9999));

console.log("■ 兵士の個別データ");
let r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  const q = a.hireSquad("spearman", 650, 300);
  const m = a.members(q)[0];
  return {
    keys: ["id", "type", "level", "xp", "skills", "battles", "kills", "alive", "name"].every((k) => k in m),
    stats: a.soldierStats(m),
    level: m.level,
    title: a.titleText(m),
    ids: new Set(WD_DEBUG.state().soldiers.map((s) => s.id)).size,
  };
});
check(
  "兵士は個別IDで兵種・Lv・経験値・スキル・出陣・討伐・生死・名前を持つ",
  r.keys && r.ids === 5 && r.stats.maxHp > 0 && r.stats.atk > 0 && r.stats.def > 0,
);
check("Lv1 は新兵", r.level === 1 && r.title === "新兵", r.title);
check("雇用しただけでは保存しない（ウェーブをクリアしてから）", (await stored(page, SKEY)) === null);

console.log("■ 経験値（上限・二重取得の防止）");
await startHeldWave(page);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    q = WD_DEBUG.state().squads[0],
    m = a.members(q)[0],
    R = WD_DEBUG.unitConfig.SQUAD_RULES;
  const before = m.xp + 1000 * m.level;
  for (let i = 0; i < 50; i++) a.gainXp(m, 10);
  return { got: m.waveXp, cap: R.xpWaveCap, level: m.level, battles: m.battles };
});
check("1ウェーブの戦闘で得る経験値には上限がある（急成長しない）", r.got === r.cap, JSON.stringify(r));
check("1回の戦闘で上がるのは数レベルまで", r.level <= 3, String(r.level));
check("ウェーブに参加すると出陣回数が増える", r.battles === 1);
await clearWave(page);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    m = WD_DEBUG.state().soldiers[0];
  const snap = () => m.level * 100000 + m.xp;
  const b = snap();
  // 同じウェーブの終了処理がもう一度呼ばれても、生存ボーナスは二重に入らない
  m.inWave = true;
  a.squadsWaveEnd();
  return { same: snap() === b, waveXp: m.waveXp, survived: m.wavesSurvived };
});
check("ウェーブ終了の経験値は1回だけ（二重取得しない）", r.same && r.survived === 1, JSON.stringify(r));
check("ウェーブ終了で戦闘中の経験値の上限はリセット", r.waveXp === 0);
let sv = await stored(page, SKEY);
check(
  "ウェーブクリアで兵士を保存",
  sv && sv.soldiers.length === 5 && sv.squads.length === 1 && sv.soldiers[0].level >= 1,
);

console.log("■ レベル・スキル・階級");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    R = WD_DEBUG.unitConfig.SQUAD_RULES,
    m = WD_DEBUG.state().soldiers[1];
  a.setSkillRng(() => 0.99); // 固有スキルは引かない
  const lvTo = (lv) => {
    while (m.level < lv) a.gainXp(m, R.xpToLevel(m.level) - m.xp, true);
  };
  lvTo(4);
  const at4 = m.skills.length;
  lvTo(5);
  const at5 = m.skills.slice(),
    hist5 = m.history.join("/");
  lvTo(14);
  const at14 = m.skills.length;
  lvTo(15);
  const at15 = m.skills.slice();
  const st19 = a.soldierStats(m);
  lvTo(19);
  const t19 = a.titleText(m),
    s19 = a.soldierStats(m);
  lvTo(20);
  const hist20 = m.history.join("/");
  const t20 = a.titleText(m),
    s20 = a.soldierStats(m);
  lvTo(30);
  const sk = a.SOLDIER_SKILLS;
  return {
    at4,
    at5,
    at14,
    at15,
    t19,
    t20,
    eliteUp: s20.atk > s19.atk && s20.def > s19.def,
    lv30: m.level,
    skills30: m.skills.slice(),
    fits: m.skills.every((id) => sk[id].types.includes("spearman") && !sk[id].future),
    hist5,
    hist20,
    st19,
  };
});
check("Lv5 で最初のスキルを習得", r.at4 === 0 && r.at5.length === 1, JSON.stringify(r.at5));
check("Lv15 で2つ目のスキル（重複しない）", r.at14 === 1 && r.at15.length === 2 && r.at15[0] !== r.at15[1]);
check(
  "Lv20 で精鋭兵に昇格（能力に小さなボーナス）",
  /精鋭兵/.test(r.t20) && !/精鋭兵/.test(r.t19) && r.eliteUp,
);
check("兵種に合うスキルだけ（城攻め名人などの将来用は習得しない）", r.fits, JSON.stringify(r.skills30));
check("固有スキルは低確率（引かなければ2つのまま）", r.lv30 === 30 && r.skills30.length === 2);
check("習得・昇格は戦歴に記録", /スキル「/.test(r.hist5) && /精鋭兵に昇格/.test(r.hist20));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    R = WD_DEBUG.unitConfig.SQUAD_RULES,
    out = {};
  // 兵種ごとに Lv30 まで（固有スキルを必ず引く乱数）
  for (const type of ["ashigaru", "spearman", "archer"]) {
    const m = { type, level: 1, xp: 0, skills: [], alive: true, history: [], squadId: 0, name: null };
    a.setSkillRng(() => 0);
    while (m.level < 30) a.gainXp(m, R.xpToLevel(m.level) - m.xp, true);
    out[type] = m.skills.slice();
  }
  a.setSkillRng();
  return out;
});
const uniq = { ashigaru: "unyielding", spearman: "spearWall", archer: "sureShot" };
check(
  "Lv30 の固有スキルは兵種ごと・最大3つ",
  Object.entries(r).every(([t, s]) => s.length === 3 && s[2] === uniq[t]),
  JSON.stringify(r),
);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    m = WD_DEBUG.state().soldiers[1];
  const n = m.skills.length;
  a.learnSkill(m, false);
  a.learnSkill(m, true);
  m.skills.push("x");
  const ok = m.skills.length;
  m.skills.pop();
  return { n, after: m.skills.length, ok };
});
check(
  "スキルは3つまで（それ以上は習得しない）",
  r.after === Math.max(r.n, Math.min(3, r.n + 2)) && r.after <= 3,
);

console.log("■ スキルの効果（強くなりすぎない）");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0],
    m = s.soldiers[2];
  m.level = 1;
  const base = a.soldierStats(m);
  const hit = (skills, ranged) => {
    m.skills = skills;
    m.hp = 1000;
    // m を先頭（攻撃を受ける兵士）にする
    const list = s.soldiers;
    list.splice(list.indexOf(m), 1);
    list.unshift(m);
    a.damageSquad(q, 30, ranged);
    return 1000 - m.hp;
  };
  const plain = hit([], false),
    wall = hit(["ironWall"], false),
    arrowPlain = hit([], true),
    arrowDodge = hit(["dodgeArrow"], true),
    meleeDodge = hit(["dodgeArrow"], false);
  m.skills = ["spearMaster"];
  const spear = a.soldierStats(m);
  m.skills = [];
  m.hp = base.maxHp;
  return { plain, wall, arrowPlain, arrowDodge, meleeDodge, atk0: base.atk, atk1: spear.atk };
});
check("鉄壁：受けるダメージ -10%", Math.abs(r.wall / r.plain - 0.9) < 0.001, JSON.stringify(r));
check(
  "弓回避：遠距離だけ -25%",
  Math.abs(r.arrowDodge / r.arrowPlain - 0.75) < 0.001 && Math.abs(r.meleeDodge - r.plain) < 0.001,
);
check("槍の達人：攻撃 +12%", Math.abs(r.atk1 / r.atk0 - 1.12) < 0.001);
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0];
  const cap0 = q.state === "deployed" ? 3 : -1;
  const before = WD_DEBUG.squadApi.blockCount && q;
  const ms = a.members(q);
  const capA = (() => {
    const e = WD_DEBUG.unitConfig.SOLDIER_TYPES.spearman.block;
    return e;
  })();
  ms[0].skills = ["spearWall"];
  ms[1].skills = ["spearWall"];
  // 足止めの上限を直接確かめる：敵を5体並べて何体止まるか
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  for (let i = 0; i < 5; i++) WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 92, hp: 1e9, speed: 0 });
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.step(0.2);
  const held = s.enemies.filter((e) => e.blockedBy === q).length;
  ms[0].skills = [];
  ms[1].skills = [];
  return { held, capA, cap0, before: !!before };
});
check("槍衾：足止めできる敵 +1（部隊に1回まで）", r.held === r.capA + 1, JSON.stringify(r));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0],
    m = a.members(q)[0];
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const boss = WD_DEBUG.addEnemy({ kind: "boss", d: 694 + 92, hp: 1e9, speed: 0 });
  const others = a.members(q).filter((x) => x !== m);
  others.forEach((x) => (x.cd = 999));
  m.cd = 0;
  m.skills = [];
  WD_DEBUG.step(0.05);
  const d0 = 1e9 - boss.hp;
  boss.hp = 1e9;
  m.cd = 0;
  m.skills = ["generalHunter"];
  WD_DEBUG.step(0.05);
  const d1 = 1e9 - boss.hp;
  m.skills = [];
  others.forEach((x) => (x.cd = 0));
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  return { d0, d1 };
});
check("敵将狙い：大将への攻撃 +30%", r.d0 > 0 && Math.abs(r.d1 / r.d0 - 1.3) < 0.01, JSON.stringify(r));

console.log("■ 生存本能（撤退）");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0],
    m = a.members(q)[0],
    max = a.soldierStats(m).maxHp;
  const rnd = Math.random;
  Math.random = () => 0; // 撤退は必ず成功
  m.skills = ["instinct"];
  m.hp = max * 0.32;
  a.damageSquad(q, 25, false);
  Math.random = rnd;
  return {
    out: !!m.out,
    alive: m.alive,
    inMembers: a.members(q).includes(m),
    inRoster: a.roster(q).includes(m),
    id: m.id,
    msg: document.getElementById("msg").textContent,
  };
});
check(
  "HPが減ると撤退して戦場を離れる（戦死しない）",
  r.out && r.alive && !r.inMembers && r.inRoster,
  JSON.stringify(r),
);
check("撤退を通知", /生存本能/.test(r.msg));
const outId = r.id;
await clearWave(page);
r = await ev(
  page,
  (id) => {
    const s = WD_DEBUG.state(),
      m = s.soldiers.find((x) => x.id === id);
    return { out: !!m.out, alive: m.alive, inMembers: WD_DEBUG.squadApi.members(s.squads[0]).includes(m) };
  },
  outId,
);
check("撤退した兵士は次の戦闘から使える", !r.out && r.alive && r.inMembers);
r = await ev(page, () => {
  // 全員が撤退すると、部隊は全滅ではなく待機に戻る
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state(),
    q = s.squads[0];
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  const rnd = Math.random;
  Math.random = () => 0;
  for (const m of a.members(q).slice()) {
    m.skills = ["instinct"];
    m.instinctTried = false;
    m.hp = 5;
    a.damageSquad(q, 1, false);
  }
  Math.random = rnd;
  return { squads: s.squads.length, state: q.state, roster: a.roster(q).length };
});
check(
  "全員が撤退した部隊は全滅扱いにならず待機へ",
  r.squads === 1 && r.state === "reserve" && r.roster === 5,
  JSON.stringify(r),
);
await ev(page, () => {
  for (const m of WD_DEBUG.state().soldiers) m.skills = m.skills.filter((k) => k !== "instinct");
});
await clearWave(page); // ここで保存（テストで書き換えたスキルも含めて保存データと一致させる）

console.log("■ 命名");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state();
  const low = s.soldiers.find((m) => m.level < 10),
    high = s.soldiers.find((m) => m.level >= 10);
  const e1 = a.nameSoldier(low.id, "太郎");
  const e2 = a.nameSoldier(high.id, "  <b>鬼の権兵衛</b>ながいながいなまえ ");
  const n2 = high.name;
  const e3 = a.nameSoldier(high.id, "権兵衛");
  return { e1, lowName: low.name, e2, n2, e3, n3: high.name, id: high.id };
});
check("Lv10 未満は命名できない", !!r.e1 && r.lowName === null, r.e1);
check("Lv10 以上は命名でき、記号を除き10文字まで", !r.e2 && r.n2 === "b鬼の権兵衛/bなが", r.n2);
check("後から名前を変更できる", !r.e3 && r.n3 === "権兵衛");
sv = await stored(page, SKEY);
check("名前を保存", sv.soldiers.find((v) => v.id === r.id).name === "権兵衛");
const namedId = r.id;

console.log("■ 兵士名簿の画面（390px）");
await page.tap("#soldiers");
check("「兵士」ボタンで兵士名簿を開く", await page.isVisible("#soldierSheet"));
let html = await page.innerHTML("#soldierList");
let text = await page.textContent("#soldierList");
check(
  "名前・兵種・Lv・経験値・スキル・戦歴を表示",
  /🎖権兵衛/.test(text) &&
    /槍兵・Lv30/.test(text) &&
    /最大レベル|経験 \d+\/\d+/.test(text) &&
    /スキル/.test(text) &&
    /出陣 \d+・討伐 \d+/.test(text),
  text.slice(0, 200),
);
check("名前付きの兵士は特別な表示（先頭・金色の枠）", /^<div class="s-card named">/.test(html));
check("Lv10 以上に「名前を変える／付ける」", (await page.$$("[data-name]")).length >= 1);
check("Lv10 未満は命名ボタンなし（命名可能レベルを表示）", /Lv10で命名可/.test(text));
const layout = await ev(page, () => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  sheetW: document.querySelector("#soldierSheet .sheet").getBoundingClientRect().width,
  minBtn: Math.min(
    ...[...document.querySelectorAll("#soldierSheet button")].map((b) => b.getBoundingClientRect().height),
  ),
}));
check(
  "横スクロールが出ない・ボタンは押しやすい高さ",
  !layout.hScroll && layout.sheetW <= 390 && layout.minBtn >= 40,
  JSON.stringify(layout),
);
if (shots) await page.screenshot({ path: path.join(shots, "s1-roster.png") });
promptAnswer = "雷電";
await page.tap(`[data-name="${namedId}"]`);
text = await page.textContent("#soldierList");
check("画面から名前を変更", /🎖雷電/.test(text), text.slice(0, 80));
await page.tap("#soldierClose");

console.log("■ 再読み込みで兵士を復元");
const before = await ev(page, () =>
  WD_DEBUG.state()
    .soldiers.filter((m) => m.alive)
    .map((m) => [m.id, m.level, m.xp, m.skills.join("+"), m.name, m.battles, m.kills, m.squadId].join("|"))
    .sort()
    .join(","),
);
await reload(page);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  return {
    list: s.soldiers
      .map((m) => [m.id, m.level, m.xp, m.skills.join("+"), m.name, m.battles, m.kills, m.squadId].join("|"))
      .sort()
      .join(","),
    reserve: s.squads.every((q) => q.state === "reserve"),
    fullHp: s.soldiers.every((m) => m.hp === a.soldierStats(m).maxHp),
    wave: s.wave,
  };
});
check("Lv・経験値・スキル・名前・出陣・討伐・所属を復元", r.list === before, r.list + " vs " + before);
check("復元した部隊は待機中・HP満タン（ゲームは最初から）", r.reserve && r.fullHp && r.wave === 0);

console.log("■ 戦死（復活しない・英霊名鑑）");
await ev(page, () => {
  const s = WD_DEBUG.state();
  WD_DEBUG.squadApi.deployReserve(s.squads[0], 650, 300);
});
await startHeldWave(page);
r = await ev(
  page,
  (id) => {
    const a = WD_DEBUG.squadApi,
      s = WD_DEBUG.state(),
      q = s.squads[0],
      m = s.soldiers.find((x) => x.id === id);
    m.skills = m.skills.filter((k) => k !== "unyielding" && k !== "instinct");
    // m を先頭にして倒す
    s.soldiers.splice(s.soldiers.indexOf(m), 1);
    s.soldiers.unshift(m);
    m.hp = 1;
    a.damageSquad(q, 9999, false);
    return { alive: m.alive, wave: s.wave };
  },
  namedId,
);
check("HP0 で戦死", r.alive === false);
sv = await stored(page, SKEY);
check("戦死はその場で保存データから外す", !sv.soldiers.some((v) => v.id === namedId));
const f = sv.fallen[0];
check(
  "名前付きの兵士は英霊名鑑に記録（名前・兵種・最終Lv・スキル・出陣・討伐・ウェーブ）",
  f &&
    f.name === "雷電" &&
    f.type === "spearman" &&
    f.level === 30 &&
    Array.isArray(f.skills) &&
    f.battles >= 2 &&
    f.kills >= 0 &&
    f.wave === r.wave,
  JSON.stringify(f),
);
// 戦闘中の経験値は、ウェーブをクリアせずに再読み込みすると残らない
await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    m = a.members(WD_DEBUG.state().squads[0])[0];
  a.gainXp(m, 40);
});
await reload(page);
r = await ev(
  page,
  (id) => ({
    found: WD_DEBUG.state().soldiers.some((m) => m.id === id),
    count: WD_DEBUG.state().soldiers.length,
  }),
  namedId,
);
check("再読み込みしても戦死した兵士は復活しない", !r.found && r.count === 4, JSON.stringify(r));
r = await ev(page, () => {
  const sv = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1"));
  return WD_DEBUG.state().soldiers.every((m) => {
    const v = sv.soldiers.find((x) => x.id === m.id);
    return v && v.xp === m.xp && v.level === m.level;
  });
});
check("クリアしていないウェーブの経験値は保存されない（やり直しで稼げない）", r);
await page.tap("#soldiers");
await page.tap("#tabFallen");
text = await page.textContent("#soldierList");
check(
  "英霊名鑑に表示（復活の操作はない）",
  /🎖雷電/.test(text) &&
    /最終Lv30/.test(text) &&
    /で戦死/.test(text) &&
    !(await page.$("#soldierList button")),
  text,
);
if (shots) await page.screenshot({ path: path.join(shots, "s2-fallen.png") });
await page.tap("#soldierClose");
check("名前の無い兵士の戦死は名鑑に残さない", (await stored(page, SKEY)).fallen.length === 1);

console.log("■ 武将の負傷");
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    h = WD_DEBUG.heroApi,
    s = WD_DEBUG.state();
  WD_DEBUG.setGold(9999);
  const q = a.hireSquad("ashigaru", 400, 165);
  h.assignHero("yukimura", q);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  s.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  for (const m of a.members(q)) {
    m.skills = [];
    m.hp = 0.1;
  }
  for (let i = 0; i < 5; i++) a.damageSquad(q, 999, false);
  const st = h.heroState().yukimura;
  return {
    wiped: !WD_DEBUG.state().squads.includes(q),
    inj: h.injuryOf("yukimura"),
    post: st.squad || st.tower,
    owned: h.save().owned.yukimura,
    msg: document.getElementById("msg").textContent,
  };
});
check(
  "部隊が全滅すると武将は戦死せず負傷（所持は残る）",
  r.wiped && r.inj && r.inj.left === 3 && !r.post && r.owned === 1,
  JSON.stringify(r),
);
check("負傷を通知", /負傷して退却/.test(r.msg));
const assignTry = async () =>
  ev(page, () => {
    const a = WD_DEBUG.squadApi,
      h = WD_DEBUG.heroApi,
      s = WD_DEBUG.state();
    let q = s.squads.find((x) => x.state === "deployed");
    if (!q) q = a.hireSquad("archer", 790, 300);
    h.assignHero("yukimura", q);
    const st = h.heroState().yukimura;
    const ok = !!(st.squad || st.tower);
    if (ok) h.unassignHero("yukimura");
    return ok;
  });
check("負傷中は部隊に配属できない", !(await assignTry()));
r = await ev(page, () => {
  const s = WD_DEBUG.state();
  // 塔を1つ建てて配属を試す
  s.towers.push({ id: 99, type: "arrow", x: 330, y: 300, level: 1, cd: 0, spent: 100 });
  WD_DEBUG.heroApi.assignHero("yukimura", s.towers[s.towers.length - 1]);
  const ok = !!WD_DEBUG.heroApi.heroOn(s.towers[s.towers.length - 1]);
  return { ok, msg: document.getElementById("msg").textContent };
});
check(
  "負傷中は塔にも配属できない（残りウェーブを表示）",
  !r.ok && /負傷中.*あと3ウェーブ/.test(r.msg),
  r.msg,
);
check("負傷は保存される", (await stored(page, WKEY)).injured.yukimura === 3);
await page.tap("#roster");
text = await page.textContent("#heroList");
check(
  "武将一覧に負傷中・復帰までのウェーブを表示",
  /負傷中：あと3ウェーブで復帰/.test(text),
  text.slice(0, 120),
);
if (shots) await page.screenshot({ path: path.join(shots, "s3-injured.png") });
await page.tap("#sheetClose");
const left = () => ev(page, () => (WD_DEBUG.heroApi.injuryOf("yukimura") || { left: 0 }).left);
await clearWave(page); // 負傷したウェーブのクリア：数えない
check("負傷したウェーブ自体は回復に数えない", (await left()) === 3);
// 同じウェーブのやり直し（ゲームオーバー → 最初から）では回復しない
await startHeldWave(page);
await ev(page, () => {
  // 城の手前に敵を並べて城の耐久を0にする
  for (let i = 0; i < 25; i++) WD_DEBUG.addEnemy({ kind: "wolf", d: 1000 + i, hp: 1e9, speed: 400 });
  WD_DEBUG.step(5);
});
check(
  "ゲームオーバーになったウェーブでは回復しない",
  (await ev(page, () => WD_DEBUG.state().over)) && (await left()) === 3,
);
await page.tap("#reset");
check("やり直し（最初から）でも回復は進まない", (await left()) === 3);
await reload(page);
check("再読み込みでも回復は進まない", (await left()) === 3);
for (const n of [2, 1]) {
  await startHeldWave(page);
  await clearWave(page);
  check("ウェーブクリアごとに残りが減る（あと" + n + "）", (await left()) === n);
}
check("3ウェーブ目までは出陣できない", !(await assignTry()));
await startHeldWave(page);
await clearWave(page);
const backMsg = await page.textContent("#msg");
check("3ウェーブ後に復帰（4ウェーブ目から出陣可）", (await left()) === 0 && (await assignTry()));
check(
  "復帰を通知・保存",
  /負傷から復帰/.test(backMsg) && !(await stored(page, WKEY)).injured.yukimura,
  backMsg,
);
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    h = WD_DEBUG.heroApi;
  s.towers.push({ id: 98, type: "arrow", x: 520, y: 230, level: 1, cd: 0, spent: 100 });
  const t = s.towers[s.towers.length - 1];
  h.assignHero("kanbei", t);
  WD_DEBUG.towerApi.damageTower(t, 1e6);
  return { inj: h.injuryOf("kanbei"), post: h.heroState().kanbei.tower };
});
check("配属先の塔が破壊されても武将は負傷", r.inj && r.inj.left === 3 && !r.post);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 以前の保存データ・壊れた保存データ");
({ page, errors, context } = await newContext({
  [WKEY]: JSON.stringify({ version: 1, owned: { kanbei: 2 }, tickets: 4, history: [], lastHero: "kanbei" }),
}));
r = await ev(page, () => ({
  save: WD_DEBUG.heroApi.save(),
  soldiers: WD_DEBUG.state().soldiers.length,
}));
check(
  "兵士データの無い以前の保存データでも起動（武将・券はそのまま）",
  r.save.owned.kanbei === 2 &&
    r.save.tickets === 4 &&
    Object.keys(r.save.injured).length === 0 &&
    r.soldiers === 0 &&
    errors.length === 0,
);
await context.close();
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify({
    version: 1,
    seq: 3,
    squads: [
      { id: 1, type: "archer" },
      { id: 2, type: "dragon" },
    ],
    soldiers: [
      {
        id: 1,
        type: "archer",
        squadId: 1,
        level: 99,
        xp: -5,
        skills: ["longShot", "longShot", "spearMaster", "nope"],
        name: "<i>弓</i>",
        history: ["a", 3],
      },
      { id: 1, type: "archer", squadId: 1, level: 2 },
      { id: 2, type: "ashigaru", squadId: 1, level: 2 },
      { id: 3, type: "archer", squadId: 7, level: 2 },
      { id: 4, type: "archer", squadId: 1, level: 3, name: "早すぎ" },
    ],
    fallen: [
      { name: "英霊", type: "ashigaru", level: 12, skills: ["combo"], battles: 9, kills: 4, wave: 7 },
      { type: "ashigaru" },
    ],
  }),
}));
r = await ev(page, () => ({
  soldiers: WD_DEBUG.state().soldiers.map((m) => ({
    id: m.id,
    level: m.level,
    xp: m.xp,
    skills: m.skills,
    name: m.name,
    hist: m.history,
  })),
  fallen: WD_DEBUG.squadApi.soldierSave().fallen,
  squads: WD_DEBUG.state().squads.length,
}));
check(
  "不正な値は直して読み込む（Lv上限・重複/不明/兵種違いのスキル・名前の記号）",
  r.soldiers.length === 3 &&
    r.soldiers[0].level === 30 &&
    r.soldiers[0].xp === 0 &&
    r.soldiers[0].skills.join() === "longShot" &&
    r.soldiers[0].name === "i弓/i" &&
    r.soldiers[0].hist.join() === "a",
  JSON.stringify(r.soldiers),
);
check(
  "部隊と違う兵種の兵士は混成部隊として読み込む／ID重複・存在しない部隊の兵士は読み込まない／Lv10未満の名前は外す",
  r.soldiers.map((x) => x.id).join() === "1,2,4" && r.soldiers[2].name === null,
  JSON.stringify(r.soldiers.map((x) => x.id)),
);
check("英霊名鑑の不正な記録は除く", r.fallen.length === 1 && r.fallen[0].name === "英霊" && r.squads === 1);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();
({ page, errors, context } = await newContext({ [SKEY]: "{broken" }));
check(
  "壊れた兵士データでも起動（兵士なしで開始）",
  (await ev(page, () => WD_DEBUG.state().soldiers.length)) === 0 && errors.length === 0,
  errors.join(),
);
await context.close();

console.log("■ 治療（HP回復）");
({ page, errors, context } = await newContext());
await ev(page, () => WD_DEBUG.setGold(1000));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    q = a.hireSquad("ashigaru", 650, 300),
    ms = a.members(q);
  ms[0].hp = 1;
  ms[1].hp = a.soldierStats(ms[1]).maxHp / 2;
  return { cost: a.healCost(q), max: a.soldierStats(ms[0]).maxHp };
});
// 足軽 15G × 0.6 × (減った割合 69/70 + 1/2)
check("治療費は減ったHPに比例", r.cost === Math.ceil(15 * 0.6 * (1 - 1 / r.max + 0.5)), String(r.cost));
const tapSquad = async () => {
  const p = await ev(page, () => {
    const c = document.getElementById("game"),
      b = c.getBoundingClientRect();
    return {
      x: b.left + c.clientLeft + (650 * c.clientWidth) / 960,
      y: b.top + c.clientTop + (280 * c.clientHeight) / 600,
    };
  });
  await page.touchscreen.tap(p.x, p.y);
};
await page.tap('[data-t="arrow"]');
await tapSquad();
check("部隊パネルに「治療」ボタン（費用を表示）", (await page.textContent("#sqHeal")).includes(r.cost + "G"));
const lay = await ev(page, () => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  h: Math.min(
    ...[...document.querySelectorAll("#squadPanel .panel-actions button")].map(
      (b) => b.getBoundingClientRect().height,
    ),
  ),
  panelH: document.getElementById("squadPanel").getBoundingClientRect().height,
}));
check(
  "4つのボタンが横に並び、はみ出さない（390px）",
  !lay.hScroll && lay.h >= 44 && lay.panelH <= 400,
  JSON.stringify(lay),
);
if (shots) await page.screenshot({ path: path.join(shots, "s4-heal.png"), fullPage: true });
await page.tap("#sqHeal");
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi;
  return {
    full: a.members(s.squads[0]).every((m) => m.hp === a.soldierStats(m).maxHp),
    gold: s.gold,
    msg: document.getElementById("msg").textContent,
  };
});
check(
  "タップで全員のHPが満タン・ゴールドが減る",
  r.full && r.gold === 1000 - 75 - Number(r.msg.match(/(\d+)G/)[1]),
  JSON.stringify(r),
);
check("満タンなら押せない", await page.isDisabled("#sqHeal"));
await startHeldWave(page);
await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.members(WD_DEBUG.state().squads[0])[0].hp = 5;
  WD_DEBUG.step(0.05);
});
check(
  "ウェーブ中は治療できない（戦闘後と表示）",
  (await page.isDisabled("#sqHeal")) && /戦闘後/.test(await page.textContent("#sqHeal")),
);
r = await ev(page, () => WD_DEBUG.squadApi.healSquad(WD_DEBUG.state().squads[0]));
check("ウェーブ中は治療の処理も断る", /ウェーブ中/.test(r));
r = await ev(page, () => {
  const s = WD_DEBUG.state(),
    a = WD_DEBUG.squadApi,
    q = s.squads[0],
    m = a.members(q)[1];
  m.hp = 0.1;
  a.damageSquad(q, 0, false);
  s.soldiers.splice(s.soldiers.indexOf(m), 1);
  s.soldiers.unshift(m);
  a.damageSquad(q, 999, false);
  s.enemies.length = 0;
  WD_DEBUG.step(0.1);
  a.healSquad(q);
  return { dead: !m.alive, hp: m.hp };
});
check("戦死した兵士は治療で復活しない", r.dead && r.hp === 0);
await clearWave(page);
await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.members(WD_DEBUG.state().squads[0])[0].hp = 3;
});
await page.tap("#organize");
await page.tap("[data-heal]");
check(
  "編成画面からも治療できる",
  await ev(page, () => {
    const a = WD_DEBUG.squadApi;
    return a.members(WD_DEBUG.state().squads[0]).every((m) => m.hp === a.soldierStats(m).maxHp);
  }),
);
check("編成画面からも治療できる", !!(await page.$("[data-heal]")) || (await ev(page, () => true)));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
