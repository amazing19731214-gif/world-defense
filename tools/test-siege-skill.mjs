#!/usr/bin/env node
// 攻城戦の武将の必殺技（一撃・範囲攻撃・鼓舞・守りの陣・手当て）の動作確認
//   node tools/test-siege-skill.mjs
//   SCREENSHOTS=dir node tools/test-siege-skill.mjs … 画面写真も保存
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
  WKEY = "worldDefense.warlords.v1";
// 40人（8部隊×5人・Lv8）。攻城の4部隊に10人ずつ
const types = ["spearman", "ashigaru", "archer", "gunner", "cavalry", "medic", "spearman", "ashigaru"];
const save = { version: 1, seq: 40, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
for (let q = 1; q <= 8; q++) {
  save.squads.push({ id: q, type: types[q - 1] });
  for (let k = 0; k < 5; k++)
    save.soldiers.push({ id: (q - 1) * 5 + k + 1, type: types[q - 1], squadId: q, level: 8 });
}
const formation = (heroes) => ({
  version: 1,
  units: [0, 1, 2, 3].map((u) => ({
    soldiers: Array.from({ length: 10 }, (_, i) => u * 10 + i + 1),
    hero: heroes[u] || null,
  })),
});
const owned = { nobunaga: 1, kenshin: 1, shingen: 1, motoyasu: 1, kanetsugu: 1 };
async function newContext(heroes) {
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
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate(
    (seeds) => {
      localStorage.clear();
      for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
    },
    {
      [SKEY]: JSON.stringify(save),
      [FKEY]: JSON.stringify(formation(heroes)),
      [WKEY]: JSON.stringify({ version: 1, owned, tickets: 0, history: [] }),
    },
  );
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
// 実時間で戦闘が進まないよう、必要なときだけ debug の step で進める
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const skillBtn = (i) => `#battleSkills [data-bskill="${i}"]`;

console.log("■ 30人の武将の攻城の型");
let { page, errors, context } = await newContext(["nobunaga", "kenshin", "shingen", "motoyasu"]);
let r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    W = WD_DEBUG.config.WARLORDS,
    count = {};
  for (const id of Object.keys(W)) count[a.siegeSkillType(id)] = (count[a.siegeSkillType(id)] || 0) + 1;
  return { n: Object.keys(W).length, count, types: Object.keys(a.SIEGE_SKILL) };
});
check(
  "30人すべてが5つの型のどれかになる（一撃9・範囲6・鼓舞4・守り6・手当て5）",
  r.n === 30 &&
    r.count.strike === 9 &&
    r.count.area === 6 &&
    r.count.rally === 4 &&
    r.count.guard === 6 &&
    r.count.heal === 5,
  JSON.stringify(r),
);

console.log("■ 必殺技のボタン");
await ev(page, () => WD_DEBUG.squadApi.startBattle());
await page.waitForTimeout(50);
r = await ev(page, () =>
  [...document.querySelectorAll("#battleSkills [data-bskill]")].map((b) => ({
    i: b.dataset.bskill,
    text: b.textContent,
    title: b.title,
    disabled: b.disabled,
  })),
);
check("武将のいる4部隊にボタン", r.length === 4, JSON.stringify(r));
check(
  "技の名前と部隊を表示し、型と効果はボタンの説明（title）に（第一・一撃）",
  /三段撃ち/.test(r[0].text) && /第一・/.test(r[0].text) && /一撃：前方の敵1体/.test(r[0].title),
  JSON.stringify(r[0]),
);
check(
  "出撃した部隊はすぐ使える／出撃前の部隊は使えない",
  !r[0].disabled && /使える！/.test(r[0].text) && r[1].disabled && /出撃前/.test(r[1].text),
  JSON.stringify(r.slice(0, 2)),
);
r = await ev(page, () => WD_DEBUG.squadApi.useSiegeSkill(1));
check("出撃前の部隊の技は使えない（理由を返す）", /まだ出撃していません/.test(r || ""), r);

console.log("■ 一撃（織田信長）");
r = await ev(page, () => WD_DEBUG.squadApi.useSiegeSkill(0));
check("敵が遠いと使えず、再使用の時間も減らない", /届く敵がいません/.test(r || ""), r);
check("ボタンは使えるまま", !(await page.isDisabled(skillBtn(0))));
// 第一部隊を最初の守備兵の手前まで進める
await ev(page, () => WD_DEBUG.step(7));
r = await ev(page, () => {
  const B = WD_DEBUG.squadApi.battle(),
    g = B.groups[0];
  const near = B.garrison
    .filter((e) => Math.hypot(e.x - g.x, e.y - g.y) <= 200)
    .sort((a, b) => Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y))[0];
  const before = near && near.hp,
    err = WD_DEBUG.squadApi.useSiegeSkill(0);
  return {
    err,
    before,
    after: near && near.hp,
    cd: g.skillCd,
    msg: document.getElementById("msg").textContent,
  };
});
check("一番近い守備兵に大きなダメージ", r.err === null && r.before - r.after > 200, JSON.stringify(r));
check("再使用まで40秒（防衛戦と同じ）", r.cd === 40, String(r.cd));
check("発動を知らせる", /織田信長「三段撃ち」（一撃）/.test(r.msg), r.msg);
await page.waitForTimeout(50);
check(
  "使ったあとはボタンが押せない（あと40秒）",
  (await page.isDisabled(skillBtn(0))) && /あと40秒/.test(await page.textContent(skillBtn(0))),
);
r = await ev(page, () => WD_DEBUG.squadApi.useSiegeSkill(0));
check("待ち時間中は使えない", /秒で使えます/.test(r || ""), r);

console.log("■ 範囲攻撃（上杉謙信）");
// 第二部隊（弓兵・鉄砲兵）のすぐ前に守備兵3体と塔1基を置く
await ev(page, () => {
  WD_DEBUG.step(3.5);
  const B = WD_DEBUG.squadApi.battle(),
    g = B.groups[1];
  B.garrison.slice(0, 3).forEach((e, i) => Object.assign(e, { x: g.x + 60, y: g.y + i * 20 - 20, hp: 1e6 }));
  Object.assign(B.towers[0], { x: g.x + 80, y: g.y + 40 });
});
r = await ev(page, () => {
  const B = WD_DEBUG.squadApi.battle(),
    g = B.groups[1];
  const hp = () => B.garrison.reduce((n, e) => n + Math.max(0, e.hp), 0),
    tw = () => B.towers.reduce((n, t) => n + t.hp, 0),
    before = hp() + tw(),
    err = WD_DEBUG.squadApi.useSiegeSkill(1);
  return { err, state: g.state, hit: before - hp() - tw(), msg: document.getElementById("msg").textContent };
});
check(
  "近くの守備兵・塔すべてにダメージ",
  r.err === null && r.hit > 0 && /体に威力/.test(r.msg),
  JSON.stringify(r),
);

console.log("■ 鼓舞（武田信玄）");
await ev(page, () => WD_DEBUG.step(10));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    B = a.battle(),
    g = B.groups[2],
    s = g.list.find((s) => s.alive && s.type !== "medic"),
    err = a.useSiegeSkill(2);
  return { err, rally: g.rally, others: B.groups.map((o) => o.rally) };
});
check("自分の部隊の攻撃 +40%（10秒）", r.err === null && r.rally === 10, JSON.stringify(r));
await ev(page, () => WD_DEBUG.step(10.5));
r = await ev(page, () => WD_DEBUG.squadApi.battle().groups[2].rally);
check("10秒で切れる", r === 0, String(r));

console.log("■ 守りの陣（徳川家康）");
await ev(page, () => WD_DEBUG.step(1));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi,
    g = a.battle().groups[3],
    err = a.useSiegeSkill(3);
  return { err, guard: g.guard, state: g.state };
});
check("守りの陣が10秒かかる", r.err === null && r.guard === 10, JSON.stringify(r));
if (shots) await page.screenshot({ path: path.join(shots, "s1-battle.png"), fullPage: true });

console.log("■ 画面（390px）");
r = await ev(page, () => {
  const bs = [...document.querySelectorAll("#battleSkills button")];
  return {
    hScroll: document.documentElement.scrollWidth > innerWidth,
    minH: Math.min(...bs.map((b) => b.getBoundingClientRect().height)),
    font: Math.min(...bs.map((b) => parseFloat(getComputedStyle(b.querySelector("small")).fontSize))),
  };
});
check(
  "横スクロールなし・ボタン44px以上・文字14px以上",
  !r.hScroll && r.minH >= 44 && r.font >= 14,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await ev(page, () => WD_DEBUG.squadApi.retreatBattle());
await context.close();

console.log("■ 手当て（直江兼続）");
({ page, errors, context } = await newContext(["kanetsugu"]));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  const g = a.battle().groups[0];
  WD_DEBUG.step(0.1);
  const s = g.list.find((s) => s.alive);
  s.hp = 10;
  const err = a.useSiegeSkill(0);
  return { err, hp: s.hp, cd: g.skillCd };
});
check("兵士のHPを最大HPの35%回復", r.err === null && r.hp > 25, JSON.stringify(r));
check("再使用まで48秒", r.cd === 48, String(r.cd));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 守りの陣でダメージが半分");
r = [];
for (const guard of [false, true]) {
  ({ page, errors, context } = await newContext(["motoyasu"]));
  r.push(
    await ev(
      page,
      (guard) => {
        const a = WD_DEBUG.squadApi;
        a.startBattle();
        const B = a.battle(),
          g = B.groups[0];
        WD_DEBUG.step(0.1);
        // 塔と守備兵を1体の弓兵だけにして、同じ時間だけ攻撃を受ける
        B.towers.length = 0;
        B.garrison.splice(1);
        Object.assign(B.garrison[0], { kind: "dragon", x: g.x + 120, y: g.y, d: g.d + 500, hp: 1e9, cd: 0 });
        if (guard) a.useSiegeSkill(0);
        for (const s of g.list) s.cd = 999; // 反撃しない
        const hp = () => g.list.reduce((n, s) => n + s.hp, 0),
          before = hp();
        g.state = "fight";
        WD_DEBUG.step(3);
        return before - hp();
      },
      guard,
    ),
  );
  await context.close();
}
check(
  "同じ攻撃を受けても、守りの陣ありは被ダメージが半分",
  r[0] > 0 && Math.abs(r[1] / r[0] - 0.5) < 0.05,
  JSON.stringify(r),
);

console.log("■ 一撃で城を落とす");
({ page, errors, context } = await newContext(["nobunaga"]));
r = await ev(page, () => {
  const a = WD_DEBUG.squadApi;
  a.startBattle();
  const B = a.battle(),
    g = B.groups[0];
  WD_DEBUG.step(0.1);
  B.garrison.length = 0;
  for (const t of B.towers) {
    t.destroyed = true;
    t.hp = 0;
  }
  Object.assign(g, { d: 2000, x: 860, y: 300 }); // 城の前
  B.castleHp = 1;
  const err = a.useSiegeSkill(0);
  return {
    err,
    battle: !!a.battle(),
    result: B.result,
    title: document.getElementById("battleTitle").textContent,
  };
});
check(
  "城の耐久が尽きれば、その場で勝利",
  r.err === null && r.result === "win" && !r.battle,
  JSON.stringify(r),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ スキル一覧・攻城編成に攻城の効果");
({ page, errors, context } = await newContext(["nobunaga"]));
await page.tap("#skillGuideOpen");
r = await page.textContent('[data-guide-hero="kanetsugu"]');
check(
  "スキル一覧に攻城戦の効果（直江兼続：手当て）",
  /攻城戦：/.test(r) && /必殺技は手当て：/.test(r),
  r.slice(0, 200),
);
check(
  "説明文から「従来の補正を維持」を外す",
  !/従来の攻撃・防御補正を維持/.test(await page.textContent("#skillGuideHint")),
);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
