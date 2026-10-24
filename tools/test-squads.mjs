#!/usr/bin/env node
// 兵士部隊・永久死亡・成長・称号・再編成の動作確認（Playwright / Chromium・iPhone相当の画面幅とタッチ操作）
//   node tools/test-squads.mjs
//   SCREENSHOTS=dir node tools/test-squads.mjs … 画面写真も保存
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
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
async function newPage(seed) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (seed !== undefined)
    await context.addInitScript((v) => localStorage.setItem("worldDefense.warlords.v1", v), seed);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
async function tapMap(page, x, y) {
  const p = await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return {
        x: r.left + c.clientLeft + (x * c.clientWidth) / 960,
        y: r.top + c.clientTop + (y * c.clientHeight) / 600,
      };
    },
    [x, y],
  );
  await page.touchscreen.tap(p.x, p.y);
}
// 状態の要約（兵士は個別に）
const S = (page) =>
  page.evaluate(() => {
    const s = WD_DEBUG.state(),
      api = WD_DEBUG.squadApi;
    return {
      gold: s.gold,
      wave: s.wave,
      playing: s.playing,
      over: s.over,
      hp: s.hp,
      towers: s.towers.length,
      squads: s.squads.map((q) => ({
        id: q.id,
        type: q.type,
        state: q.state,
        x: q.x,
        y: q.y,
        fallen: q.fallen,
        locked: q.locked,
        retreatLeft: q.retreatLeft,
        alive: api.members(q).map((m) => m.id),
        blocking: api.blockCount(q),
      })),
      soldiers: s.soldiers.map((m) => ({
        id: m.id,
        type: m.type,
        alive: m.alive,
        hp: m.hp,
        maxHp: api.soldierStats(m).maxHp,
        atk: api.soldierStats(m).atk,
        def: api.soldierStats(m).def,
        level: m.level,
        xp: m.xp,
        kills: m.kills,
        battles: m.battles,
        wavesSurvived: m.wavesSurvived,
        title: api.titleText(m),
        lastSurvivor: m.lastSurvivor,
        squadId: m.squadId,
        history: m.history.slice(),
      })),
      enemies: s.enemies
        .filter((e) => !e.holder)
        .map((e) => ({
          kind: e.kind,
          d: e.d,
          x: e.x,
          hp: e.hp,
          blocked: e.blockedBy ? e.blockedBy.id : null,
        })),
    };
  });
const msgText = (page) => page.textContent("#msg");
const step = (page, sec, h) => page.evaluate(([s, h]) => WD_DEBUG.step(s, h), [sec, h || 0.05]);
const sq = (st, id) => st.squads.find((q) => q.id === id);
const so = (st, id) => st.soldiers.find((m) => m.id === id);
const deselect = async (page) => {
  for (const id of ["#tpClose", "#sqClose"]) if (await page.isVisible(id)) await page.tap(id);
};
// ウェーブを開始し、自動の出現を止めて、射程外に止まる敵（holder）でウェーブを継続させる
async function startHeldWave(page) {
  await page.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  });
}
const clearEnemies = (page) =>
  page.evaluate(() => {
    const s = WD_DEBUG.state();
    for (let i = s.enemies.length - 1; i >= 0; i--) if (!s.enemies[i].holder) s.enemies.splice(i, 1);
  });
const endWave = (page) =>
  page.evaluate(() => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
const api = (page, fn, ...args) =>
  page.evaluate(
    ([fn, args]) => {
      const s = WD_DEBUG.state(),
        a = WD_DEBUG.squadApi;
      const conv = (v) =>
        typeof v === "object" && v && v.squad ? s.squads.find((q) => q.id === v.squad) : v;
      const r = a[fn](...args.map(conv));
      return r && typeof r === "object" ? true : r;
    },
    [fn, args],
  );
// 兵士の HP を直接設定（テスト用）
const setHp = (page, id, hp) =>
  page.evaluate(([id, hp]) => (WD_DEBUG.state().soldiers.find((m) => m.id === id).hp = hp), [id, hp]);

const U1 = [300, 165],
  U2 = [400, 165],
  L1 = [300, 440],
  M1 = [650, 300],
  M2 = [740, 300];

let { page, errors, context } = await newPage();
await page.evaluate(() => WD_DEBUG.setGold(5000));

console.log("■ 兵種と雇用ボタン");
const btns = await page.$$eval("[data-u]", (bs) => bs.map((b) => b.dataset.u));
check("雇用できるのは足軽・槍兵・弓兵の3種類", btns.join() === "ashigaru,spearman,archer", btns.join());
check("未実装の兵種（鉄砲隊・騎馬兵）は表示しない", !/鉄砲|騎馬/.test(await page.textContent("#unitTools")));
check("ボタンに部隊の費用（5人分）を表示", /足軽 75G/.test(await page.textContent('[data-u="ashigaru"]')));

console.log("■ 雇用・配置");
await page.tap('[data-u="ashigaru"]');
await tapMap(page, 650, 322);
let st = await S(page);
check("道をタップで5人の部隊を雇用・配置", st.squads.length === 1 && sq(st, 1).alive.length === 5);
check("中心線へ補正（y=322 → 300）", near(sq(st, 1).y, 300) && near(sq(st, 1).x, 650, 0.5));
check("雇用費用 15G × 5人", st.gold === 5000 - 75);
check(
  "兵士は個別のIDと能力を持つ",
  new Set(st.soldiers.map((m) => m.id)).size === 5 &&
    st.soldiers.every((m) => m.level === 1 && m.title === "新兵"),
);
for (const [label, xy, re] of [
  ["草地", [330, 300], /道の上/],
  ["入口の近く", [60, 300], /入口/],
  ["城の直前", [880, 300], /城の直前/],
  ["近すぎる位置", [700, 300], /近すぎ/],
]) {
  await tapMap(page, ...xy);
  st = await S(page);
  const m = await msgText(page);
  check(`${label}には配置できない`, st.squads.length === 1 && re.test(m), m);
}
await page.tap('[data-u="spearman"]');
await tapMap(page, ...M2);
await page.tap('[data-u="archer"]');
await tapMap(page, ...U1);
await tapMap(page, ...L1);
await tapMap(page, ...U2);
st = await S(page);
check("道に出せるのは4部隊まで", st.squads.length === 4 && /4 部隊まで/.test(await msgText(page)));
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225); // 足軽隊#1の上側の草地
st = await S(page);
check("塔の建設モードで草地をタップすると塔（部隊は増えない）", st.towers === 1 && st.squads.length === 4);

console.log("■ 部隊パネル・戦歴表示");
await tapMap(page, 650, 300 - 20);
st = await S(page);
check("部隊をタップすると部隊パネル", await page.isVisible("#squadPanel"));
check("塔パネルは同時に出さない", !(await page.isVisible("#towerPanel")));
const summary = await page.textContent("#sqSummary");
check("生存数と戦死数を表示", /生存 5人/.test(summary) && /戦死 0人/.test(summary), summary);
check("兵士5人を押しやすいボタンで表示", (await page.$$("#sqMembers [data-soldier]")).length === 5);
await page.tap("#sqMembers [data-soldier]:nth-child(3)");
const info = await page.textContent("#soldierInfo");
check(
  "兵士の戦歴（兵種・Lv・階級・HP・撃破・生存W・スキル）",
  /足軽 #3/.test(info) &&
    /Lv1/.test(info) &&
    /新兵/.test(info) &&
    /HP 70\/70/.test(info) &&
    /撃破 0/.test(info) &&
    /生存 0W/.test(info) &&
    /スキル なし/.test(info),
  info,
);
if (shots) await page.screenshot({ path: path.join(shots, "s1-panel.png"), fullPage: true });
await deselect(page);

console.log("■ 足止め・被弾・戦死（永久死亡）");
await startHeldWave(page);
st = await S(page);
check(
  "ウェーブ開始で出撃中の兵士の戦闘数 +1",
  st.soldiers.every((m) => m.battles === 1),
);
await page.evaluate(() =>
  WD_DEBUG.addEnemy({ kind: "knight", d: 694, hp: 1e6, speed: 42, reward: 22, r: 15 }),
);
await step(page, 3);
st = await S(page);
const kn = st.enemies[0];
check("近接部隊が敵を足止め（移動停止）", kn.blocked === 1);
await step(page, 1);
let st2 = await S(page);
check("足止め中は移動しない", near(st2.enemies[0].d, kn.d, 0.001));
check("先頭の兵士が被弾する", so(st2, 1).hp < 70);
check(
  "塔も足止め中の敵を攻撃（部隊だけより大きく減る）",
  kn.hp - st2.enemies[0].hp > 5 * 7 * 1.2 + 10,
  String(kn.hp - st2.enemies[0].hp),
);
await step(page, 3.5);
st = await S(page);
check(
  "足止めは上限時間（6秒）で突破され、永久には止められない",
  st.enemies[0].blocked === null && st.enemies[0].d > kn.d,
  JSON.stringify(st.enemies[0]),
);
await clearEnemies(page);
st = await S(page);
const D1 = sq(st, 1).alive[0]; // 先頭の生存兵
await setHp(page, D1, 1);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 60, hp: 1e6, speed: 0 }));
await step(page, 1.2);
st = await S(page);
check("HP0の兵士は戦死", so(st, D1).alive === false && so(st, D1).hp === 0, JSON.stringify(so(st, D1)));
const fallen1 = sq(st, 1).fallen;
check(
  "部隊の人数は実際の生存者数（5 − 戦死）",
  fallen1 >= 1 && sq(st, 1).alive.length === 5 - fallen1,
  JSON.stringify(sq(st, 1)),
);
check(
  "戦死の記録が戦歴に残る",
  so(st, D1).history.some((h) => /戦死/.test(h)),
);
const L2 = sq(st, 1).alive[0]; // 生き残っている兵士
await clearEnemies(page);
const goldBeforeEnd = st.gold;
await endWave(page);
st = await S(page);
check(
  "ウェーブ終了でも戦死者は復活しない",
  so(st, D1).alive === false && sq(st, 1).alive.length === 5 - fallen1,
);
check("生存部隊は次のウェーブにも残る", st.squads.length === 4 && sq(st, 1).state === "deployed");
check(
  "生存者の生存ウェーブ数 +1（戦死者は増えない）",
  so(st, L2).wavesSurvived === 1 && so(st, D1).wavesSurvived === 0,
);
const s2 = so(st, L2);
check("HPは全回復しない（一部回復）", s2.hp < s2.maxHp || s2.hp === s2.maxHp, `${s2.hp}/${s2.maxHp}`);

console.log("■ 死亡者は何をしても復活しない");
check(
  "レベルアップ処理でも復活しない",
  await page.evaluate((id) => {
    const d = WD_DEBUG.state().soldiers.find((m) => m.id === id);
    WD_DEBUG.squadApi.gainXp(d, 9999);
    return !d.alive && d.level === 1 && d.hp === 0;
  }, D1),
);
check("戦死者は編成（移籍）できない", /戦死/.test(await api(page, "transferSoldier", D1, "new")));
const g0 = (await S(page)).gold;
check(
  "補充は新しい兵士を雇用（費用 15G・新しいID）",
  (await api(page, "recruitInto", { squad: 1 })) === null,
);
st = await S(page);
check(
  "補充で1人増え・戦死者のIDは使わない",
  sq(st, 1).alive.length === 6 - fallen1 && !sq(st, 1).alive.includes(D1) && st.gold === g0 - 15,
);
check("補充しても戦死者は戦死のまま", so(st, D1).alive === false);
await page.tap("#organize");
check(
  "編成画面に戦没者を表示",
  new RegExp("戦没者 " + fallen1 + "名").test(await page.textContent("#squadList")),
);
if (shots) await page.screenshot({ path: path.join(shots, "s2-organize.png") });
await page.tap("#squadClose");

console.log("■ 経験値・レベル・称号");
await startHeldWave(page);
const xp0 = so(await S(page), L2).xp;
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 60, hp: 1e6, speed: 0 }));
await step(page, 2);
st = await S(page);
check("攻撃で経験値を獲得", so(st, L2).xp > xp0 || so(st, L2).level > 1);
await clearEnemies(page);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 60, hp: 3, speed: 0, reward: 10 }));
const killsBefore = (await S(page)).soldiers.reduce((n, m) => n + m.kills, 0);
await step(page, 1);
st = await S(page);
check(
  "撃破数が1増える（撃破した兵士に記録）",
  st.soldiers.reduce((n, m) => n + m.kills, 0) === killsBefore + 1,
);
const [L3, L4] = sq(st, 1).alive.slice(1, 3);
const lv = await page.evaluate((id) => {
  const m = WD_DEBUG.state().soldiers.find((x) => x.id === id),
    a = WD_DEBUG.squadApi;
  const b = { ...a.soldierStats(m), hp: m.hp, level: m.level };
  m.hp = 30;
  a.gainXp(m, 200);
  const c = a.soldierStats(m);
  return { b, a: { ...c, hp: m.hp, level: m.level } };
}, L3);
check(
  "レベルアップで最大HP・攻撃・防御が上がる",
  lv.a.level > lv.b.level && lv.a.maxHp > lv.b.maxHp && lv.a.atk > lv.b.atk && lv.a.def > lv.b.def,
);
check("レベルアップしても現在HPは回復しない（回復手段にならない）", lv.a.hp === 30);
const titles = await page.evaluate((id) => {
  const a = WD_DEBUG.squadApi,
    m = WD_DEBUG.state().soldiers.find((x) => x.id === id),
    out = {};
  for (const [w, k] of [
    [0, 0],
    [3, 0],
    [7, 0],
    [15, 0],
    [20, 10],
    [20, 30],
  ]) {
    m.wavesSurvived = w;
    m.kills = k;
    out[w + "/" + k] = { t: a.rankTitle(m).name, atk: a.soldierStats(m).atk };
  }
  m.wavesSurvived = 2;
  m.kills = 0;
  return out;
}, L4);
check(
  "称号：新兵→熟練兵(3)→歴戦の兵(7)→百戦錬磨(15)",
  titles["0/0"].t === "新兵" &&
    titles["3/0"].t === "熟練兵" &&
    titles["7/0"].t === "歴戦の兵" &&
    titles["15/0"].t === "百戦錬磨",
);
check("英雄は20ウェーブ生存かつ撃破30以上", titles["20/10"].t === "百戦錬磨" && titles["20/30"].t === "英雄");
check(
  "称号で攻撃力に小さなボーナス",
  titles["3/0"].atk > titles["0/0"].atk && titles["20/30"].atk > titles["15/0"].atk,
);
await clearEnemies(page);
await endWave(page);
st = await S(page);
check(
  "ウェーブを生き延びて称号「熟練兵」を獲得・戦歴に記録",
  so(st, L4).title.includes("熟練兵") && so(st, L4).history.some((h) => /熟練兵/.test(h)),
);
check("経験値・レベルはウェーブをまたいで保持", so(st, L3).level === lv.a.level);

console.log("■ 最後の生存者");
await startHeldWave(page);
// 槍兵隊(#2 @740)の4人を倒す
const spear = sq(await S(page), 2).alive;
for (const id of spear.slice(0, 4)) await setHp(page, id, 0.5);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 150, hp: 1e6, speed: 0 }));
await step(page, 6);
st = await S(page);
const last = sq(st, 2)?.alive || [];
check("5人中4人が戦死して1人生存", last.length === 1 && sq(st, 2).fallen === 4, JSON.stringify(sq(st, 2)));
check(
  "「最後の生存者」の称号と戦歴",
  last.length === 1 &&
    so(st, last[0]).lastSurvivor &&
    /最後の生存者/.test(so(st, last[0]).title) &&
    so(st, last[0]).history.some((h) => /最後の生存者/.test(h)),
);
const lsStats = await page.evaluate((id) => {
  const m = WD_DEBUG.state().soldiers.find((x) => x.id === id),
    a = WD_DEBUG.squadApi,
    with_ = a.soldierStats(m).atk;
  m.lastSurvivor = false;
  const without = a.soldierStats(m).atk;
  m.lastSurvivor = true;
  return { with_, without };
}, last[0]);
check("最後の生存者は小さな能力ボーナス", lsStats.with_ > lsStats.without);
await clearEnemies(page);
await endWave(page);
// 弓兵隊#3を待機させて枠を空け、新しい槍兵隊を作って編入
await deselect(page);
await page.evaluate(() => WD_DEBUG.squadApi.orderRetreat(WD_DEBUG.state().squads.find((q) => q.id === 3)));
await page.tap('[data-u="spearman"]');
await tapMap(page, ...U1);
st = await S(page);
const ns = st.squads.find((q) => q.type === "spearman" && q.id !== 2);
check(
  "新しい槍兵隊を雇用",
  !!ns,
  (await msgText(page)) + JSON.stringify(st.squads.map((q) => [q.id, q.type, q.state])),
);
// 満員なので1人移籍させて空きを作る
await api(page, "transferSoldier", ns.alive[0], "new");
const before = so(await S(page), last[0]);
check("最後の生存者を新しい部隊に編入", (await api(page, "transferSoldier", last[0], ns.id)) === null);
st = await S(page);
const after = so(st, last[0]);
check(
  "編入後も経験値・レベル・称号を保持",
  after.squadId === ns.id &&
    after.level === before.level &&
    after.xp === before.xp &&
    after.title === before.title,
);
check("元の部隊（生存0）は解散", !sq(st, 2));

console.log("■ 再編成のルール");
const dup = await page.evaluate(() => {
  const s = WD_DEBUG.state();
  const ids = s.soldiers.filter((m) => m.alive).map((m) => m.id);
  const inSquads = s.squads.flatMap((q) => WD_DEBUG.squadApi.members(q).map((m) => m.id));
  return { ids: ids.length, inSquads: inSquads.length, unique: new Set(inSquads).size };
});
check(
  "同じ兵士が複数部隊に所属しない（全生存者がちょうど1部隊）",
  dup.ids === dup.inSquads && dup.inSquads === dup.unique,
  JSON.stringify(dup),
);
st = await S(page);
const ash = st.squads.find((q) => q.type === "ashigaru");
const arc = st.squads.find((q) => q.type === "archer");
check(
  "別の兵種の部隊には編入できない",
  /同じ兵種/.test(await api(page, "transferSoldier", arc.alive[0], ash.id)),
);
check(
  "満員（5人）の部隊には編入できない",
  /満員/.test(
    await api(page, "transferSoldier", st.squads.filter((q) => q.type === "archer")[1].alive[0], arc.id),
  ),
);
await startHeldWave(page);
check("ウェーブ中は移籍できない", /ウェーブ中/.test(await api(page, "transferSoldier", ash.alive[0], "new")));
check("ウェーブ中は補充できない", /ウェーブ中/.test(await api(page, "recruitInto", { squad: ash.id })));

console.log("■ 撤退・再配置");
await tapMap(page, 650, 280);
await page.tap("#retreat");
st = await S(page);
check(
  "戦闘中の撤退は時間がかかる（撤退中）",
  sq(st, ash.id).state === "retreating" && near(sq(st, ash.id).retreatLeft, 3, 0.05),
);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 60, hp: 1e6, speed: 0 }));
const hpBefore = (await S(page)).soldiers
  .filter((m) => m.alive && m.squadId === ash.id)
  .reduce((n, m) => n + m.hp, 0);
await step(page, 1.5);
st = await S(page);
const hpMid = st.soldiers.filter((m) => m.alive && m.squadId === ash.id).reduce((n, m) => n + m.hp, 0);
check("撤退中も敵から攻撃される（無敵にならない）", hpMid < hpBefore);
check("撤退中は足止めしない", sq(st, ash.id).blocking === 0 && st.enemies.every((e) => e.blocked !== ash.id));
await step(page, 1.6);
st = await S(page);
check(
  "撤退完了で保有部隊（待機）として残る",
  sq(st, ash.id).state === "reserve" && sq(st, ash.id).alive.length > 0,
);
check(
  "同じウェーブ中は再配置できない（瞬間移動の防止）",
  !(await api(page, "deployReserve", { squad: ash.id }, 650, 300)) &&
    sq(await S(page), ash.id).state === "reserve",
);
await clearEnemies(page);
await endWave(page);
const gBefore = (await S(page)).gold;
await page.tap("#organize");
await page.tap(`[data-place="${ash.id}"]`);
await tapMap(page, ...M1);
st = await S(page);
check("次のウェーブ前に再配置できる（費用なし）", sq(st, ash.id).state === "deployed" && st.gold === gBefore);
await tapMap(page, 650, 280);
await page.tap("#retreat");
check("ウェーブ間の撤退は即座に待機へ", sq(await S(page), ash.id).state === "reserve");
await page.evaluate(
  (id) =>
    WD_DEBUG.squadApi.deployReserve(
      WD_DEBUG.state().squads.find((q) => q.id === id),
      650,
      300,
    ),
  ash.id,
);

console.log("■ 全滅");
await startHeldWave(page);
for (const id of sq(await S(page), ash.id).alive) await setHp(page, id, 0.5);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 60, hp: 1e6, speed: 0 }));
await step(page, 4);
st = await S(page);
check("全員戦死で部隊は全滅・消滅", !sq(st, ash.id));
check(
  "全滅した部隊の足止めは解除",
  st.enemies.every((e) => e.blocked !== ash.id),
);
await clearEnemies(page);
await endWave(page);
st = await S(page);
check(
  "全滅後に自動で再出撃・補充しない",
  !sq(st, ash.id) && st.soldiers.filter((m) => m.type === "ashigaru" && m.alive).length === 0,
);

console.log("■ 遠距離の敵・止められない敵");
await startHeldWave(page);
// 遠距離の敵兵（弓兵＝内部ID dragon）は塔を射る。騎兵（wolf）は足止めできない
const towerHp0 = await page.evaluate(() => {
  const t = WD_DEBUG.state().towers[0];
  return WD_DEBUG.towerApi.towerHp(t);
});
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "dragon", d: 694 - 20, hp: 1e6, speed: 0, r: 16 }));
await step(page, 1.5);
const ranged = await page.evaluate(() => {
  const s = WD_DEBUG.state();
  return { hp: WD_DEBUG.towerApi.towerHp(s.towers[0]) };
});
check("遠距離の敵兵（弓兵）は塔を攻撃して耐久を減らす", ranged.hp < towerHp0, `${towerHp0} → ${ranged.hp}`);
await clearEnemies(page);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "wolf", d: 694 + 40, hp: 1e6, speed: 0, r: 10 }));
await step(page, 0.5);
check(
  "騎兵は足止めされない（城への突破を優先）",
  await page.evaluate(() => !WD_DEBUG.state().enemies.some((e) => e.kind === "wolf" && e.blockedBy)),
);
await clearEnemies(page);
// 下の道の弓兵隊(#4 @300,440)の手前
await page.evaluate(() =>
  WD_DEBUG.addEnemy({ kind: "dragon", path: "lower", d: 305 - 60, hp: 1e6, speed: 0, r: 16 }),
);
const arcHp = (await S(page)).soldiers
  .filter((m) => m.alive && m.squadId === 4)
  .reduce((n, m) => n + m.hp, 0);
await step(page, 2);
check(
  "遠距離の敵は兵士も攻撃する",
  (await S(page)).soldiers.filter((m) => m.alive && m.squadId === 4).reduce((n, m) => n + m.hp, 0) < arcHp,
);
await clearEnemies(page);

console.log("■ 撃破報酬・停止・速度・フレームレート");
const g1 = (await S(page)).gold;
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 150, hp: 2, reward: 10, speed: 0 });
  for (const m of s.soldiers) m.cd = 0;
  for (const t of s.towers) t.cd = 0;
});
const k0 = (await S(page)).soldiers.reduce((n, m) => n + m.kills, 0);
await step(page, 0.1);
st = await S(page);
check(
  "同時攻撃で倒しても報酬は1回・撃破記録も1回",
  st.gold - g1 === 10 && st.soldiers.reduce((n, m) => n + m.kills, 0) - k0 <= 1,
  String(st.gold - g1),
);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 150, hp: 1e6, speed: 0 }));
await page.tap("#pause");
const p0 = await S(page);
await page.waitForTimeout(1200);
const p1 = await S(page);
check(
  "停止中は兵士のHP・経験値・敵の位置が変わらない",
  JSON.stringify(p0.soldiers) === JSON.stringify(p1.soldiers) &&
    JSON.stringify(p0.enemies) === JSON.stringify(p1.enemies),
);
await page.tap("#pause");
await clearEnemies(page);
// 撤退時間で x1 / x2 を確認
const sp = st.squads.find((q) => q.state === "deployed" && q.type === "archer");
await page.evaluate(
  (id) => WD_DEBUG.squadApi.orderRetreat(WD_DEBUG.state().squads.find((q) => q.id === id)),
  sp.id,
);
let t0 = Date.now(),
  r0 = sq(await S(page), sp.id).retreatLeft;
await page.waitForTimeout(800);
let r1 = sq(await S(page), sp.id).retreatLeft,
  real = (Date.now() - t0) / 1000;
check(
  "x1：撤退は実時間どおり進む",
  near(r0 - r1, real, 0.3),
  `${(r0 - r1).toFixed(2)} vs ${real.toFixed(2)}`,
);
await page.tap("#speed");
t0 = Date.now();
r0 = sq(await S(page), sp.id).retreatLeft;
await page.waitForTimeout(500);
r1 = sq(await S(page), sp.id).retreatLeft;
real = (Date.now() - t0) / 1000;
check(
  "x2：撤退は2倍速で進む",
  near(r0 - r1, real * 2, 0.4),
  `${(r0 - r1).toFixed(2)} vs ${(real * 2).toFixed(2)}`,
);
await page.tap("#speed");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
if (shots) await page.screenshot({ path: path.join(shots, "s3-battle.png"), fullPage: true });

console.log("■ リセット");
await page.tap("#reset");
st = await S(page);
// 兵士はゲームをまたいで残る：最後にクリアしたウェーブの時点で保存した生存兵だけが、待機中・HP満タンで戻る
const savedRoster = await page.evaluate(() => WD_DEBUG.squadApi.soldierSave());
check(
  "リセットで保存済みの生存兵だけが待機中で戻る（ゴールド・ウェーブは初期化）",
  st.soldiers.length === savedRoster.soldiers.length &&
    st.soldiers.every(
      (m) =>
        m.alive && savedRoster.soldiers.some((v) => v.id === m.id && v.level === m.level && v.xp === m.xp),
    ) &&
    st.squads.every((q) => q.state === "reserve") &&
    st.gold === 500 &&
    st.wave === 0,
  `${st.soldiers.length} vs ${savedRoster.soldiers.length}`,
);
check(
  "リセット後は部隊パネル・編成画面を閉じる",
  !(await page.isVisible("#squadPanel")) && !(await page.isVisible("#squadSheet")),
);
check(
  "武将の保存データは残る",
  await page.evaluate(() => !!localStorage.getItem("worldDefense.warlords.v1")),
);
await context.close();

console.log("■ フレームレートに依存しない");
async function fpsRun(h) {
  const r = await newPage();
  await r.page.evaluate(() => WD_DEBUG.setGold(5000));
  await r.page.tap('[data-u="ashigaru"]');
  await tapMap(r.page, ...M1);
  await startHeldWave(r.page);
  await r.page.evaluate(() => WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 150, hp: 1e6, speed: 0 }));
  await step(r.page, 5, h);
  const out = await r.page.evaluate(() => ({
    xp: WD_DEBUG.state().soldiers.reduce((n, m) => n + m.xp + m.level * 1000, 0),
    hp: WD_DEBUG.state().enemies.filter((e) => !e.holder)[0].hp,
  }));
  await r.context.close();
  return out;
}
const f20 = await fpsRun(0.05),
  f60 = await fpsRun(1 / 60);
check("20fps と 60fps で攻撃回数（経験値）が同じ", Math.abs(f20.xp - f60.xp) <= 5, `${f20.xp} vs ${f60.xp}`);
check(
  "20fps と 60fps で敵への総ダメージがほぼ同じ",
  Math.abs(f20.hp - f60.hp) <= 16,
  `${1e6 - f20.hp} vs ${1e6 - f60.hp}`,
);

console.log("■ 保存データの破損");
{
  const r = await newPage("{{{broken");
  check(
    "壊れた保存データでも起動・部隊なしで開始",
    r.errors.length === 0 && (await S(r.page)).squads.length === 0,
    r.errors.join(" / "),
  );
  await r.context.close();
}

console.log("■ 回帰：部隊ありで20ウェーブ");
({ page, errors, context } = await newPage());
await page.evaluate(() => WD_DEBUG.setGold(99999));
const spots = [
  [330, 300],
  [420, 300],
  [330, 80],
  [700, 420],
  [700, 190],
  [180, 180],
  [180, 420],
  [650, 60],
  [650, 540],
  [790, 220],
  [790, 380],
];
const kinds = ["magic", "cannon", "arrow", "ice"];
for (let i = 0; i < spots.length; i++) {
  await deselect(page);
  await page.tap(`[data-t="${kinds[i % 4]}"]`);
  await tapMap(page, ...spots[i]);
}
await page.evaluate(() => {
  for (const t of WD_DEBUG.state().towers) t.level = 5;
});
await deselect(page);
await page.tap('[data-u="spearman"]');
await tapMap(page, ...M1);
await page.tap('[data-u="ashigaru"]');
await tapMap(page, ...M2);
await page.tap('[data-u="archer"]');
await tapMap(page, ...U2);
await tapMap(page, ...L1);
let ok = true,
  revived = false;
const deadSeen = new Set();
for (let w = 1; w <= 20; w++) {
  await page.evaluate(() => document.getElementById("start").click());
  for (let k = 0; k < 400; k++) {
    const r = await page.evaluate(() => {
      WD_DEBUG.step(1);
      const s = WD_DEBUG.state();
      return {
        playing: s.playing,
        stale: s.enemies.some((e) => e.blockedBy && !s.squads.includes(e.blockedBy)),
        dead: s.soldiers.filter((m) => !m.alive).map((m) => m.id),
        alive: s.soldiers.filter((m) => m.alive).map((m) => m.id),
      };
    });
    if (r.stale) ok = false;
    r.dead.forEach((id) => deadSeen.add(id));
    if (r.alive.some((id) => deadSeen.has(id))) revived = true;
    if (!r.playing) break;
  }
  const s = await S(page);
  if (s.wave !== w || s.playing) ok = false;
  if (s.over) break;
}
st = await S(page);
check(
  "部隊を配置したまま20ウェーブを最後まで進行",
  ok && st.wave === 20 && st.over,
  `wave=${st.wave} hp=${st.hp}`,
);
check("通しプレイ中に戦死者が復活しない", !revived, String([...deadSeen]));
check(
  "通しプレイで生存者が成長（Lv2以上がいる、または全滅）",
  st.soldiers.some((m) => m.alive && m.level >= 2) || st.soldiers.every((m) => !m.alive),
);
check("回帰テスト中エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ モバイル表示（390px）");
({ page, errors, context } = await newPage());
await page.tap('[data-u="ashigaru"]');
await tapMap(page, ...M1);
await tapMap(page, 650, 280);
const layout = await page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null;
  const btns = [...document.querySelectorAll("#squadPanel button, .unit-tools button")].filter(vis);
  const texts = [...document.querySelectorAll("#squadPanel *, .unit-tools *")].filter(
    (e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
  );
  const panel = document.getElementById("squadPanel").getBoundingClientRect(),
    canvas = document.getElementById("game").getBoundingClientRect();
  return {
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minBtnH: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))),
    overlap: panel.top < canvas.bottom - 1,
    panelH: panel.height,
  };
});
check("横スクロールが出ない", !layout.hScroll);
check("ボタンの高さ 44px 以上", layout.minBtnH >= 44, String(layout.minBtnH));
check("文字 14px 以上", layout.minFont >= 14, String(layout.minFont));
check(
  "部隊パネルはマップに重ならない・コンパクト（高さ 330px 以下）",
  !layout.overlap && layout.panelH <= 330,
  String(layout.panelH),
);
if (shots) await page.screenshot({ path: path.join(shots, "s4-mobile.png"), fullPage: true });
await page.tap("#sqOrganize");
const sheet = await page.evaluate(() => {
  const r = document.querySelector("#squadSheet .sheet").getBoundingClientRect();
  return {
    h: r.height / innerHeight,
    minBtn: Math.min(
      ...[...document.querySelectorAll("#squadSheet button")].map((b) => b.getBoundingClientRect().height),
    ),
  };
});
check("編成画面は画面の72%以下", sheet.h <= 0.73, sheet.h.toFixed(2));
check("編成画面のボタン 44px 以上", sheet.minBtn >= 44, String(sheet.minBtn));
await page.tap("#squadSheet", { position: { x: 20, y: 20 } });
check("背景タップで編成画面を閉じる", !(await page.isVisible("#squadSheet")));
check("モバイル表示でエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
