#!/usr/bin/env node
// 秘境の討伐戦（三大裏ボス）の動作確認：発見した秘境だけ出陣できる・討伐の画面・予兆・形態の変化・
// 白虎（落雷・跳躍・怒り）・八岐（頭の封印・再生と上限・毒・氷・炎）・天魔機神（装甲・3形態・天魔砲・防御形態）、
// 勝敗・撤退・時間切れ、戦死のルール、初回報酬は1回だけ・再討伐、専用装備の効果、保存と再読み込み、画面（375×667）
//   node tools/test-bosses.mjs
//   SCREENSHOTS=dir node tools/test-bosses.mjs … 画面写真も保存
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
// 4部隊×10人（槍兵・足軽・弓兵＋衛生兵・鉄砲兵）。#1 は主人公
function makeSave(level) {
  const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [], heroId: 1 };
  const types = [["spearman"], ["ashigaru"], ["archer", "medic"], ["gunner"]];
  let id = 0;
  types.forEach((t, i) => {
    save.squads.push({ id: i + 1, type: t[0], slot: i });
    for (let k = 0; k < 10; k++)
      save.soldiers.push({
        id: ++id,
        type: t[1] && k >= 7 ? t[1] : t[0],
        squadId: i + 1,
        level,
        name: id === 1 ? "鬼若" : null,
      });
  });
  return save;
}
const units = [0, 1, 2, 3].map((u) => ({
  soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
  hero: ["tadakatsu", null, "hideyoshi", null][u],
}));
const warlords = { version: 1, owned: { tadakatsu: 1, hideyoshi: 1 }, tickets: 0, history: [] };
const conquered = (secrets) =>
  JSON.stringify({
    version: 2,
    castles: {},
    secrets: Object.fromEntries(secrets.map((s) => [s, true])),
    secretSeen: Object.fromEntries(secrets.map((s) => [s, true])),
  });
async function newContext(extra = {}, level = 500, width = 390, height = 844) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [],
    dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.accept();
  });
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  const seeds = Object.assign(
    {
      [SKEY]: JSON.stringify(makeSave(level)),
      [FKEY]: JSON.stringify({ version: 1, units }),
      [WKEY]: JSON.stringify(warlords),
      [CKEY]: conquered(["hiei", "yomi", "fuji"]),
    },
    extra,
  );
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context, dialogs };
}
async function reload(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
}
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
// 討伐戦を始める
const startBoss = (page, id) =>
  page.evaluate((id) => {
    const a = WD_DEBUG.squadApi;
    const e1 = a.setBossTarget(id);
    if (e1) return e1;
    return a.startBattle();
  }, id);
// 画面（討伐の帯）は次の描画で書き換わるので、1フレーム待ってから読む
const frame = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const barText = async (page) => (await frame(page), page.textContent("#battleInfo"));
// 部隊が全員出撃してボスの前に着くまで進める
const advance = (page, sec) => page.evaluate((sec) => WD_DEBUG.step(sec), sec);

console.log("■ 未発見の秘境");
let { page, errors, context, dialogs } = await newContext({ [CKEY]: conquered(["hiei"]) });
let r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  return { yomi: a.setBossTarget("yomi"), none: a.setBossTarget("nope"), t: a.bossTarget() };
});
check(
  "見つけていない秘境（黄泉の洞窟）には出陣できない",
  /まだ見つけていない/.test(r.yomi || "") && r.t === null,
  JSON.stringify(r),
);
await page.tap("#mapOpen");
await page.tap('[data-map-chapter="japan"]');
await page.tap('[data-map-tab="secret"]');
r = await page.evaluate(() => ({
  btns: [...document.querySelectorAll("[data-boss-go]")].map((b) => b.dataset.bossGo + ":" + b.disabled),
  q: (document.getElementById("mapBody").textContent.match(/？？？/g) || []).length,
}));
check(
  "見つけた秘境（比叡山）と、最初から場所のわかる真・八岐大蛇だけ「討伐に出陣」ボタン、未発見は ？？？",
  r.btns.join() === "orochi:false,hiei:false" && r.q === 2,
  JSON.stringify(r),
);
await page.tap('[data-boss-go="hiei"]');
let text = dialogs.join(" / ");
check("世界から秘境討伐へ直接出陣",(await page.isHidden("#squadSheet"))&&(await page.isHidden("#mapSheet"))&&await page.evaluate(()=>WD_DEBUG.squadApi.battle()?.boss==="hiei"));
check("出陣確認に目標・推奨Lv・永久戦死・主人公の再出発",/雷獣・白虎/.test(text)&&/推奨Lv200/.test(text)&&/永久戦死/.test(text)&&/主人公はLv1から再出発/.test(text),text);
if (shots) await page.screenshot({path:path.join(shots,"b1-target.png")});
check(
  "出陣の確認でも永久戦死を知らせる",
  dialogs.some((d) => /雷獣・白虎/.test(d) && /永久戦死/.test(d)),
  dialogs.join(" / "),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  return {
    boss: B && B.boss,
    towers: B && B.towers.length,
    n: B && B.garrison.length,
    max: e && e.max,
    time: B && B.timeLimit,
  };
});
check(
  "討伐戦が始まる（塔はなく、ボス1体だけ・制限時間300秒）",
  r.boss === "hiei" && r.towers === 0 && r.n === 1 && r.max === 110000 && r.time === 300,
  JSON.stringify(r),
);
await page.evaluate(() => WD_DEBUG.squadApi.retreatBattle());
check("撤退できる（結果画面）", /全軍撤退/.test(await page.textContent("#battleTitle")));
await page.tap("#battleClose");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  return { t: a.bossTarget(), rec: a.bossRecord("hiei") };
});
check(
  "撤退も挑戦の回数に入る・討伐の目標は残る（何度でも挑める）",
  r.t === "hiei" && r.rec.attempts === 1 && r.rec.wins === 0,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.setTarget("kiyosu");
  return a.bossTarget();
});
check("城を目標にすると討伐は外れる（通常の攻城戦に戻る）", r === null);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 雷獣・白虎");
({ page, errors, context } = await newContext({}, 200));
r = await startBoss(page, "hiei");
check("出陣できる", r === null, r);
await advance(page, 35);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf();
  B.warn = null;
  e.sp = 0; // 落雷の時間にする
  WD_DEBUG.step(0.05);
  const w = B.warn;
  return { text: w && w.text, left: w && w.left, target: w && w.target && w.target.name };
});
r.bar = await barText(page);
check(
  "落雷の前に予兆（文字・狙われた部隊・秒数）",
  /落雷の予兆：3秒後に 第.部隊 へ落雷/.test(r.text || "") && r.left > 2.5 && /⚠ 落雷の予兆/.test(r.bar),
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "b2-warn.png") });
r = await page.evaluate(() => {
  // 守りの陣（被ダメージ -50%）で落雷が半分になる
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    w = B.warn,
    g = w.target,
    list = g.list.filter((s) => s.alive && !s.siegeOut);
  const hp = (l) => l.map((s) => s.hp);
  for (const s of list) s.hp = 1e6; // 落雷の分だけを測る
  const rnd = Math.random;
  Math.random = () => 0.99; // 回避なし
  const b0 = hp(list);
  w.fire();
  const d1 = list.map((s, i) => b0[i] - s.hp);
  for (const s of list) s.hp = 1e6;
  g.guard = 10;
  w.fire();
  const d2 = list.map((s) => 1e6 - s.hp);
  g.guard = 0;
  Math.random = rnd;
  for (const s of list) s.hp = a.soldierStats(s).maxHp;
  return { all: d1.every((d) => d > 0), n: list.length, ratio: d2[0] / d1[0] };
});
check("落雷は狙われた部隊の全員に当たる", r.all && r.n > 1, JSON.stringify(r));
check("守りの陣で落雷のダメージが半分", Math.abs(r.ratio - 0.5) < 1e-9, JSON.stringify(r));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  // 端で外向きに跳ぶと境界へ補正され、同じ位置に留まる。どちらの方向にも跳べる中央から確認する。
  e.d = 720;
  Object.assign(e, WD_DEBUG.pathAt(e.path, e.d));
  const d0 = e.d;
  a.battle().warn = null;
  e.leap = 0;
  WD_DEBUG.step(0.05);
  const moved = e.d !== d0;
  e.hp = e.max * 0.45;
  WD_DEBUG.step(0.05);
  return { moved, phase: e.phase, state: a.bossStatusText(e) };
});
r.bar = await barText(page);
check("高速移動：跳んで位置を変える", r.moved);
check(
  "HP50%以下で怒り（雷撃が激しくなる）・状態を表示",
  r.phase === 2 && /怒り/.test(r.state) && /状態：怒り/.test(r.bar),
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  // 白虎の雷鎧：雷撃のダメージ -60%
  const a = WD_DEBUG.squadApi,
    F = WD_DEBUG.forgeApi,
    B = a.battle(),
    g = B.groups[0],
    s = g.list.find((x) => x.alive && !x.siegeOut);
  const rnd = Math.random;
  Math.random = () => 0.99;
  s.hp = 1e6;
  a.bossBlast(g, 1000, "thunder");
  const d1 = 1e6 - s.hp;
  const S = F.save();
  S.items.push({ uid: ++S.seq, id: "byakkoArmor", owner: s.id });
  F.refreshGear();
  s.hp = 1e6;
  a.bossBlast(g, 1000, "thunder");
  const d2 = 1e6 - s.hp;
  s.hp = 1e6;
  a.bossBlast(g, 1000, "boss");
  const d3 = 1e6 - s.hp;
  S.items = S.items.filter((it) => it.id !== "byakkoArmor");
  F.refreshGear();
  Math.random = rnd;
  s.hp = a.soldierStats(s).maxHp;
  return { d1, d2, d3 };
});
check(
  "白虎の雷鎧：雷撃のダメージが減る（雷以外は防御の分だけ）",
  r.d2 < r.d1 * 0.5 && r.d3 > r.d2,
  JSON.stringify(r),
);
const t0 = (await stored(page, WKEY)).tickets;
const s0 = (await stored(page, WKEY)).forge.shards;
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.bossOf().hp = 1;
  for (let i = 0; i < 400 && a.battle(); i++) WD_DEBUG.step(0.05); // 倒れてから消える演出（1.2秒）のあとで結果
  return {
    result: !a.battle(),
    title: document.getElementById("battleTitle").textContent,
    body: document.getElementById("battleBody").textContent,
  };
});
check("ボスを倒すと勝利（討伐！）", r.result && /討伐！ 雷獣・白虎を倒した/.test(r.title), r.title);
check(
  "初討伐：専用の伝説装備「白虎の雷鎧」",
  /初討伐！/.test(r.body) && /白虎の雷鎧/.test(r.body),
  r.body.slice(0, 200),
);
let w = await stored(page, WKEY);
check(
  "白虎の雷鎧が装備倉庫に入る・初回報酬の受け取りを保存",
  w.forge.items.filter((it) => it.id === "byakkoArmor").length === 1 && w.forge.bossRewards.hiei === true,
  JSON.stringify(w.forge.bossRewards),
);
check(
  "欠片 +6・ガチャ券 +3",
  w.forge.shards - s0 === 6 && w.tickets - t0 === 3,
  JSON.stringify({ s: w.forge.shards - s0, t: w.tickets - t0 }),
);
let c = await stored(page, CKEY);
check(
  "討伐の記録（回数・初討伐の時刻・最速）を保存",
  c.bosses.hiei.wins === 1 && c.bosses.hiei.first > 0 && c.bosses.hiei.best > 0,
  JSON.stringify(c.bosses),
);
await page.tap("#battleClose");
r = await startBoss(page, "hiei");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  WD_DEBUG.step(1);
  a.bossOf().hp = 1;
  WD_DEBUG.step(30);
  return { done: !a.battle(), body: document.getElementById("battleBody").textContent };
});
w = await stored(page, WKEY);
check(
  "2回目も討伐できる：専用装備は増えない（欠片 +6・ガチャ券 +1）",
  r.done &&
    !/初討伐/.test(r.body) &&
    w.forge.items.filter((it) => it.id === "byakkoArmor").length === 1 &&
    w.forge.shards - s0 === 12 &&
    w.tickets - t0 === 4,
  JSON.stringify({ s: w.forge.shards - s0, t: w.tickets - t0 }),
);
c = await stored(page, CKEY);
check("2回目も記録（討伐2回）", c.bosses.hiei.wins === 2 && c.bosses.hiei.attempts === 2);
await page.tap("#battleClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 冥龍・八岐");
({ page, errors, context } = await newContext({}, 500));
r = await startBoss(page, "yomi");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  return { heads: e.heads.length, kinds: [...new Set(e.heads.map((h) => h.kind))].sort().join(), max: e.max };
});
check(
  "八つの頭（毒・炎・氷・牙・咆哮）",
  r.heads === 8 && r.kinds === "bite,fire,ice,poison,roar",
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  // 再生（まだ部隊が着く前）：HP50%から5秒で増える
  const a = WD_DEBUG.squadApi,
    e = a.bossOf();
  e.hp = e.max * 0.5;
  const h0 = e.hp;
  WD_DEBUG.step(5);
  const r1 = e.hp - h0;
  e.hp = e.max * 0.25;
  WD_DEBUG.step(0.05);
  const h1 = e.hp;
  WD_DEBUG.step(5);
  const r2 = e.hp - h1;
  // 上限：残りの再生を少しにすると、それ以上は回復しない
  e.regenLeft = 1000;
  const h2 = e.hp;
  WD_DEBUG.step(5);
  return {
    r1,
    r2,
    phase: e.phase,
    capped: e.hp - h2 <= 1000 + 1e-6,
    left: e.regenLeft,
    state: a.bossStatusText(e),
  };
});
check("HPを再生する", r.r1 > 0, JSON.stringify(r));
check(
  "HP30%以下で再生が強まる",
  r.phase === 2 && r.r2 > r.r1 * 1.5 && /再生強化/.test(r.state),
  JSON.stringify(r),
);
check("再生には上限がある（無限には回復しない）", r.capped && r.left <= 1e-6, JSON.stringify(r));
r = await page.evaluate(() => {
  // 攻撃中の頭を叩くと封じる（再生も弱まる・次の頭へ）
  const a = WD_DEBUG.squadApi,
    e = a.bossOf(),
    head = e.head,
    h = e.heads[head];
  a.bossTakeDamage(e, h.max + 1, null);
  return {
    sealed: h.sealed,
    next: e.head !== head,
    state: a.bossStatusText(e),
    msg: document.getElementById("msg").textContent,
  };
});
check(
  "攻撃中の頭を叩くと封じる（25秒）・次の頭に代わる",
  r.sealed === 25 && r.next && /封じた頭 1\/8/.test(r.state) && /封じた/.test(r.msg),
  JSON.stringify(r),
);
await advance(page, 30);
r = await page.evaluate(() => {
  // 毒・氷・炎の頭の攻撃
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf(),
    out = {};
  for (const h of e.heads) h.sealed = 0;
  const g = B.groups.find((g) => ["march", "fight"].includes(g.state));
  const use = (kind) => {
    e.head = e.heads.findIndex((h) => h.kind === kind);
    e.headLeft = 99;
    e.cd = 0;
    B.warn = null;
    WD_DEBUG.step(0.05);
  };
  use("poison");
  out.poison = B.groups.some((o) => o.poison > 0);
  use("ice");
  out.ice = B.groups.some((o) => o.frozen > 0);
  use("fire");
  out.fire = B.warn && B.warn.text;
  return out;
});
r.bar = await barText(page);
check("毒の頭：部隊に毒（時間でダメージ）", r.poison, JSON.stringify(r));
check("氷の頭：部隊を凍らせる（攻撃が遅くなる）", r.ice);
check("炎の頭：炎の息の予兆", /炎の息の予兆/.test(r.fire || ""), r.fire);
check(
  "画面に攻撃中の頭・毒・凍結を表示",
  /攻撃中：/.test(r.bar) && (/☠毒/.test(r.bar) || /❄凍/.test(r.bar)),
  r.bar,
);
r = await page.evaluate(() => {
  // 八岐の妖刀：追加ダメージ +25%・確率でHPを回復
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    s = { id: 9300, type: "ashigaru", job: "ashigaru", level: 10, skills: [], hp: 10, alive: true },
    S = F.save();
  S.items.push({ uid: ++S.seq, id: "yamataBlade", owner: 9300 });
  F.refreshGear();
  const rnd = Math.random;
  Math.random = () => 0.99;
  const m = F.gearHitMul(s, 100);
  Math.random = () => 0;
  const hp0 = s.hp;
  F.gearHitMul(s, 200);
  const healed = s.hp - hp0;
  Math.random = rnd;
  S.items = S.items.filter((it) => it.owner !== 9300);
  F.refreshGear();
  return { m, healed, max: a.soldierStats(s).maxHp };
});
check("八岐の妖刀：攻撃のたびに追加ダメージ +25%", Math.abs(r.m - 1.25) < 1e-9, JSON.stringify(r));
check("八岐の妖刀：確率で最大HPの4%を回復", r.healed > 0, JSON.stringify(r));
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.bossOf().hp = 1;
  a.bossOf().regenLeft = 0;
  for (let i = 0; i < 400 && a.battle(); i++) WD_DEBUG.step(0.05); // 倒れてから消える演出（1.2秒）のあとで結果
  return document.getElementById("battleBody").textContent;
});
check("八岐を討伐：八岐の妖刀", /初討伐/.test(r) && /八岐の妖刀/.test(r), r.slice(0, 120));
await page.tap("#battleClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 零式・天魔機神");
({ page, errors, context } = await newContext({}, 1000));
r = await startBoss(page, "fuji");
r = await page.evaluate(() => {
  // 装甲：第一形態は半分、装甲無視（蜻蛉切 35%）で減らせる
  const a = WD_DEBUG.squadApi,
    e = a.bossOf(),
    s = { id: 9400, skills: [], type: "spearman" },
    F = WD_DEBUG.forgeApi,
    S = F.save();
  const plain = a.bossTakeDamage(e, 100, null);
  S.items.push({ uid: ++S.seq, id: "tonbokiri", owner: 9400 });
  F.refreshGear();
  const pierce = a.bossTakeDamage(e, 100, s);
  S.items = S.items.filter((it) => it.owner !== 9400);
  F.refreshGear();
  return { plain, pierce, state: a.bossStatusText(e) };
});
check("厚い装甲（第一形態はダメージ半分）", r.plain === 50 && /第一形態/.test(r.state), JSON.stringify(r));
check("装甲無視が効く（蜻蛉切で 50 → 67.5）", Math.abs(r.pierce - 67.5) < 1e-9, JSON.stringify(r));
await advance(page, 30);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    e = a.bossOf(),
    out = {};
  e.sp = 0;
  B.warn = null;
  WD_DEBUG.step(0.05);
  out.p1 = B.warn && B.warn.text;
  B.warn = null;
  e.hp = e.max * 0.6;
  WD_DEBUG.step(0.05);
  out.phase2 = e.phase;
  out.msg2 = document.getElementById("msg").textContent;
  e.sp = 0;
  B.warn = null;
  WD_DEBUG.step(0.05);
  out.p2 = B.warn && B.warn.text;
  out.all2 = B.warn && B.warn.target;
  B.warn = null;
  e.hp = e.max * 0.25;
  WD_DEBUG.step(0.05);
  out.phase3 = e.phase;
  e.sp = 0;
  B.warn = null;
  WD_DEBUG.step(0.05);
  out.p3 = B.warn && B.warn.text;
  out.left3 = B.warn && B.warn.left;
  return out;
});
r.bar = await barText(page);
r = Object.assign(
  r,
  await page.evaluate(() => {
    const a = WD_DEBUG.squadApi,
      e = a.bossOf(),
      out = {};
    // 防御形態の切り替え
    const f0 = e.form;
    e.formLeft = 0;
    WD_DEBUG.step(0.05);
    out.form = [f0, e.form];
    e.form = "guard";
    out.guardDmg = a.bossTakeDamage(e, 100, null);
    e.form = "attack";
    out.attackDmg = a.bossTakeDamage(e, 100, null);
    out.state = a.bossStatusText(e);
    return out;
  }),
);
check("第一形態：砲撃（予兆あり）", /砲撃の予兆：2秒後に 第.部隊/.test(r.p1 || ""), r.p1);
check(
  "HP70%以下で第二形態：広範囲砲撃（全部隊・予兆あり）",
  r.phase2 === 2 && /第二形態/.test(r.msg2) && /広範囲砲撃の予兆/.test(r.p2 || "") && r.all2 === "all",
  JSON.stringify(r),
);
check(
  "HP30%以下で第三形態：必殺「天魔砲」（予兆4秒・画面に文字）",
  r.phase3 === 3 && /天魔砲」の予兆/.test(r.p3 || "") && r.left3 > 3.9 && /⚠ 必殺「天魔砲」/.test(r.bar),
  JSON.stringify(r),
);
check("第三形態は防御形態と攻撃形態を切り替える", r.form[0] !== r.form[1], JSON.stringify(r.form));
check(
  "防御形態は攻撃が通りにくく、攻撃形態は通りやすい",
  Math.abs(r.guardDmg - 15) < 1e-9 && Math.abs(r.attackDmg - 70) < 1e-9,
  JSON.stringify(r),
);
if (shots) await page.screenshot({ path: path.join(shots, "b3-tenma.png") });
r = await page.evaluate(() => {
  // 天魔機神の神鎧：攻撃・防御・最大HPが上がる。受けるダメージの軽減は上限のまま
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    s = {
      id: 9500,
      type: "spearman",
      job: "spearman",
      level: 100,
      skills: ["kongo", "fudoMyoo", "ironWall", "saihai"],
      alive: true,
    },
    base = a.soldierStats(Object.assign({}, s, { id: 9501 }), true),
    S = F.save();
  S.items.push({ uid: ++S.seq, id: "tenmaArmor", owner: 9500 }, { uid: ++S.seq, id: "omamori", owner: 9500 });
  F.refreshGear();
  const st = a.soldierStats(s, true);
  const res = { atk: st.atk / base.atk, def: st.def / base.def, hp: st.maxHp / base.maxHp };
  S.items = S.items.filter((it) => it.owner !== 9500);
  F.refreshGear();
  return res;
});
check(
  "天魔機神の神鎧：攻撃・防御・最大HPが上がる",
  r.atk > 1.05 && r.def > 1.1 && r.hp > 1.15,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.bossOf().hp = 1;
  for (let i = 0; i < 400 && a.battle(); i++) WD_DEBUG.step(0.05); // 倒れてから消える演出（1.2秒）のあとで結果
  return document.getElementById("battleBody").textContent;
});
check("天魔機神を討伐：天魔機神の神鎧", /初討伐/.test(r) && /天魔機神の神鎧/.test(r), r.slice(0, 120));
await page.tap("#battleClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 敗北・時間切れ・戦死のルール");
({ page, errors, context } = await newContext({}, 200));
r = await startBoss(page, "hiei");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle();
  WD_DEBUG.step(25);
  // 一般兵と主人公をボスの攻撃で倒す
  const g = B.groups[0],
    hero = g.list.find((s) => s.id === 1),
    s2 = g.list.find((s) => s.id === 2);
  g.list.sort((x, y) => (y.id === 2) - (x.id === 2));
  s2.hp = 1;
  const rnd = Math.random;
  Math.random = () => 0.99;
  a.bossBlast(g, 1e6, "boss");
  Math.random = rnd;
  return {
    s2: s2.alive,
    saved2: a.soldierSave().soldiers.some((v) => v.id === 2),
    hero: hero.alive,
    heroLv: hero.level,
    heroOut: !!hero.siegeOut,
    savedHero: a.soldierSave().soldiers.some((v) => v.id === 1),
  };
});
check("一般兵は戦死すると永久（保存データから消える）", !r.s2 && !r.saved2, JSON.stringify(r));
check(
  "主人公は戦死してもLv1から再出発（その戦いからは外れる）",
  r.hero && r.heroLv === 1 && r.heroOut && r.savedHero,
  JSON.stringify(r),
);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle();
  B.t = B.timeLimit;
  WD_DEBUG.step(0.05);
  return {
    done: !a.battle(),
    title: document.getElementById("battleTitle").textContent,
    rec: a.bossRecord("hiei"),
  };
});
check(
  "制限時間を過ぎると時間切れ（敗北）",
  r.done && /時間切れ/.test(r.title) && r.rec.wins === 0 && r.rec.attempts === 1,
  JSON.stringify(r),
);
await page.tap("#battleClose");
r = await startBoss(page, "hiei");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    B = a.battle();
  // 全部隊が倒れる
  for (const g of B.groups) for (const s of g.list) if (s.id !== 1) s.siegeOut = true;
  for (const g of B.groups) if (g.state === "wait") g.state = "empty";
  B.nextUnit = 4;
  for (const g of B.groups) if (g.state !== "empty") g.state = "lost";
  WD_DEBUG.step(0.05);
  return {
    done: !a.battle(),
    title: document.getElementById("battleTitle").textContent,
    w: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge,
  };
});
check(
  "全部隊が倒れると敗北（報酬なし）",
  r.done && /敗北/.test(r.title) && !(r.w.bossRewards || {}).hiei,
  JSON.stringify(r.title),
);
await page.tap("#battleClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 戦闘中の再読み込み・保存の互換");
({ page, errors, context } = await newContext({}, 300));
r = await startBoss(page, "hiei");
await advance(page, 5);
await reload(page);
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  return {
    battle: !!a.battle(),
    rec: a.bossRecord("hiei"),
    rew: (WD_DEBUG.forgeApi.save().bossRewards || {}).hiei,
  };
});
check(
  "戦闘中に読み込み直すと、その戦いはなかったことになる（報酬なし・勝利の記録なし）",
  !r.battle && r.rec.wins === 0 && !r.rew,
  JSON.stringify(r),
);
await context.close();
({ page, errors, context } = await newContext({
  [CKEY]: JSON.stringify({
    version: 2,
    castles: { kiyosu: { captured: true } },
    secrets: { hiei: true },
    bosses: { hiei: { wins: 2, attempts: 5, first: 123, best: 90 }, nope: { wins: 9 }, fuji: "bad" },
  }),
  [WKEY]: JSON.stringify(
    Object.assign({}, warlords, {
      forge: {
        shards: 7,
        items: [{ uid: 1, id: "byakkoArmor", owner: null }],
        seq: 1,
        bossRewards: { hiei: true, x: true },
      },
    }),
  ),
}));
r = await page.evaluate(() => ({
  b: WD_DEBUG.squadApi.conquestMeta().bosses,
  rew: WD_DEBUG.forgeApi.save().bossRewards,
  owned: WD_DEBUG.squadApi.ownsProvince("owari"),
  shards: WD_DEBUG.forgeApi.save().shards,
}));
check(
  "保存した討伐の記録・初回報酬の受け取りを読み込む（壊れた値は捨てる）",
  JSON.stringify(r.b) === JSON.stringify({ hiei: { attempts: 5, wins: 2, first: 123, best: 90 } }) &&
    JSON.stringify(r.rew) === JSON.stringify({ hiei: true }) &&
    r.owned &&
    r.shards === 7,
  JSON.stringify(r),
);
r = await startBoss(page, "hiei");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  WD_DEBUG.step(1);
  a.bossOf().hp = 1;
  WD_DEBUG.step(30);
  return WD_DEBUG.forgeApi.save().items.filter((it) => it.id === "byakkoArmor").length;
});
check("受け取り済みなら、勝っても専用装備は増えない（二重取得なし）", r === 1, String(r));
await context.close();
({ page, errors, context } = await newContext({
  // v32 の保存データ（討伐の項目なし）
  [CKEY]: JSON.stringify({
    version: 2,
    castles: { kiyosu: { captured: true } },
    secrets: { yomi: true },
    secretSeen: { yomi: true },
  }),
  [WKEY]: JSON.stringify(Object.assign({}, warlords, { forge: { shards: 3, items: [], seq: 0 } })),
}));
r = await page.evaluate(() => ({
  b: WD_DEBUG.squadApi.conquestMeta().bosses,
  rew: WD_DEBUG.forgeApi.save().bossRewards,
  owned: WD_DEBUG.squadApi.ownsProvince("owari"),
  secret: WD_DEBUG.squadApi.conquestMeta().secrets.yomi,
  shards: WD_DEBUG.forgeApi.save().shards,
}));
check(
  "v32 の保存データをそのまま読める（領土・秘境・欠片はそのまま）",
  JSON.stringify(r.b) === "{}" && JSON.stringify(r.rew) === "{}" && r.owned && r.secret && r.shards === 3,
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 討伐の画面（375×667）・通常の戦い");
({ page, errors, context } = await newContext({}, 500, 375, 667));
r = await startBoss(page, "fuji");
await advance(page, 8);
await page.evaluate(() => {
  const a = WD_DEBUG.squadApi;
  a.battle().warn = null;
  a.bossOf().sp = 0;
  WD_DEBUG.step(0.05);
});
await frame(page);
r = await page.evaluate(() => {
  const bar = document.getElementById("battleBar"),
    rr = bar.getBoundingClientRect(),
    retreat = document.getElementById("battleRetreat").getBoundingClientRect();
  return {
    text: bar.textContent,
    hp: !!bar.querySelector(".boss-hp i"),
    warn: !!bar.querySelector(".boss-warn"),
    hScroll: document.documentElement.scrollWidth > innerWidth,
    retreat: retreat.height >= 44 && retreat.right <= innerWidth,
    inView: rr.left >= 0 && rr.right <= innerWidth + 0.5,
  };
});
check(
  "ボス名・HPバー・形態・予兆（文字）・部隊の状況・撤退ボタン",
  /零式・天魔機神/.test(r.text) &&
    r.hp &&
    /状態：第一形態/.test(r.text) &&
    r.warn &&
    /⚠ 砲撃の予兆/.test(r.text) &&
    /第一 \d+人/.test(r.text) &&
    r.retreat,
  r.text.slice(0, 200),
);
check("375px で横にはみ出さない", !r.hScroll && r.inView, JSON.stringify(r));
if (shots) await page.screenshot({ path: path.join(shots, "b4-bar.png") });
await page.tap("#battleRetreat");
check("撤退ボタンで撤退できる", /全軍撤退/.test(await page.textContent("#battleTitle")));
await page.tap("#battleClose");
r = await page.evaluate(() => {
  // 通常の攻城戦・防衛戦は今までどおり
  const a = WD_DEBUG.squadApi;
  a.setTarget("kiyosu");
  const e = a.startBattle(),
    B = a.battle(),
    out = { e, towers: B.towers.length, boss: B.boss, castle: B.castleName };
  a.retreatBattle();
  document.getElementById("battleClose").click();
  document.getElementById("start").click();
  out.playing = WD_DEBUG.state().playing;
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
  out.wave = WD_DEBUG.state().wave;
  out.after = WD_DEBUG.state().playing;
  return out;
});
check(
  "城を目標に戻すと通常の攻城戦（塔あり・ボスなし）",
  r.e === null && r.towers === 4 && !r.boss && r.castle === "清洲城",
  JSON.stringify(r),
);
check("防衛戦のウェーブも今までどおり", r.playing && r.wave === 1 && !r.after, JSON.stringify(r));
r = await page.evaluate(() => {
  const T = WD_DEBUG.trainingApi,
    e = T.startTraining("beginner"),
    blocked = (() => {
      WD_DEBUG.squadApi.setBossTarget("hiei");
      return WD_DEBUG.squadApi.startBattle();
    })();
  T.endTraining("retreat");
  return { e, blocked };
});
check(
  "修練場の挑戦中は討伐に出陣できない",
  r.e === null && /修練場/.test(r.blocked || ""),
  JSON.stringify(r),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
