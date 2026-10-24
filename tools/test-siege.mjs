#!/usr/bin/env node
// 敵兵による防衛塔の攻撃・破壊、敵兵の画像、部隊パネルの「＋補充」の動作確認
//   node tools/test-siege.mjs
//   SCREENSHOTS=dir node tools/test-siege.mjs … 画面写真も保存
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
// 雇用ボタンは「＋ 雇う」の中（畳まれていれば開いてから押す）
async function tapHire(page, type) {
  if (!(await page.isVisible(`[data-u="${type}"]`))) await page.tap("#hireToggle");
  await page.tap(`[data-u="${type}"]`);
}
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
async function newPage() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() =>
    localStorage.setItem(
      "worldDefense.warlords.v1",
      JSON.stringify({ owned: { nobunaga: 1 }, tickets: 0, history: [] }),
    ),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.waitForTimeout(300);
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
const step = (page, sec) => page.evaluate((s) => WD_DEBUG.step(s), sec);
// ウェーブを始め、自動の出現を止め、射程外に止まる敵（holder）でウェーブを続ける
const startHeld = (page) =>
  page.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  });
const clear = (page) =>
  page.evaluate(() => {
    const s = WD_DEBUG.state();
    for (let i = s.enemies.length - 1; i >= 0; i--) if (!s.enemies[i].holder) s.enemies.splice(i, 1);
  });
const T = (page) =>
  page.evaluate(() =>
    WD_DEBUG.state().towers.map((t) => ({
      id: t.id,
      type: t.type,
      hp: WD_DEBUG.towerApi.towerHp(t),
      max: WD_DEBUG.towerApi.towerMaxHp(t),
      destroyed: !!t.destroyed,
      cd: t.cd,
    })),
  );

let { page, errors, context } = await newPage();
await page.evaluate(() => WD_DEBUG.setGold(20000));

console.log("■ 塔の耐久");
// 道（合流後 y=300）から 75 の塔 A と、道から離れた塔 B（中央の島の真ん中、道まで約135）
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225); // #1 弓：道から75
await page.tap('[data-t="cannon"]');
await tapMap(page, 330, 300); // #2 大砲：上下の道から約135
await page.tap('[data-t="magic"]');
await tapMap(page, 700, 380); // #3 鉄砲：道から80
await page.tap('[data-t="ice"]');
await tapMap(page, 560, 520); // #4 水攻め：下の道から離れた位置
// タップ位置は画面の1px単位に丸められる（マップの約2.6）。距離の境目を試すので、塔を狙った位置にそろえる
await page.evaluate(() => {
  const at = [
    [650, 228], // 道（y=300）から72。騎兵が届く距離（74）の内側
    [330, 300],
    [700, 380],
    [560, 520],
  ];
  WD_DEBUG.state().towers.forEach((t, i) => at[i] && ([t.x, t.y] = at[i]));
});
let t = await T(page);
check(
  "4種類の塔に耐久（弓220・大砲300・鉄砲260・水攻め240）",
  t.map((x) => x.max).join() === "220,300,260,240",
  JSON.stringify(t),
);
await tapMap(page, 650, 225);
check("塔パネルに耐久を表示", /耐久 220\/220/.test(await page.textContent("#tpStats")));
await page.tap("#upgrade");
t = await T(page);
check(
  "強化で最大耐久と耐久が上がる（Lv2 = +35%）",
  t[0].max === 297 && t[0].hp === 297,
  JSON.stringify(t[0]),
);
await page.tap("#tpClose");

console.log("■ 敵兵が道の上から塔を攻撃する");
await startHeld(page);
// 足軽（goblin）を合流点の少し先に止めて置く：塔#1 まで約75
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 90, hp: 1e9, speed: 0 }));
await step(page, 3);
t = await T(page);
check("近接の敵兵（足軽）は届く塔の耐久を減らす", t[0].hp < 297, String(t[0].hp));
check("届かない塔（道から離れた大砲）は攻撃されない", t[1].hp === 300);
const onRoad = await page.evaluate(() => {
  const e = WD_DEBUG.state().enemies.find((e) => !e.holder);
  const p = WD_DEBUG.projectToRoad(e.x, e.y);
  return p.off;
});
check("攻撃中も敵兵は道の上（道から外れない）", onRoad < 1, String(onRoad));
await clear(page);
// 騎兵は塔への攻撃が弱く、足止めされない
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "wolf", d: 694 + 90, hp: 1e9, speed: 0 }));
let h0 = (await T(page))[0].hp;
await step(page, 3);
let h1 = (await T(page))[0].hp;
const cavDmg = h0 - h1;
await clear(page);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 90, hp: 1e9, speed: 0 }));
h0 = (await T(page))[0].hp;
await step(page, 3);
h1 = (await T(page))[0].hp;
const yariDmg = h0 - h1;
check(
  "騎兵の塔への攻撃は弱い（槍兵より小さい）",
  cavDmg > 0 && cavDmg < yariDmg,
  `騎兵 ${cavDmg} / 槍兵 ${yariDmg}`,
);
await clear(page);
// 弓兵（遠距離）は遠くの塔も射る
// 合流後の道（620,300）から鉄砲の塔#3（700,380・距離約113）を狙う。足軽の届く距離（76）より遠い
await page.evaluate(() => {
  const t = WD_DEBUG.state().towers[0];
  t.hp = 1e9; // 近い塔#1は対象から外さず、耐久だけ大きくして見分ける
});
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "dragon", d: 694 + 60, hp: 1e9, speed: 0 }));
const w0 = (await T(page)).reduce((n, x) => n + x.hp, 0);
await step(page, 3);
check("弓兵は射程内の塔を遠距離から攻撃", (await T(page)).reduce((n, x) => n + x.hp, 0) < w0);
await page.evaluate(() => {
  const t = WD_DEBUG.state().towers[0];
  t.hp = WD_DEBUG.towerApi.towerMaxHp(t);
});
await clear(page);

console.log("■ 大将：大きな損害・塔の前で立ち止まる（最長5秒）");
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "boss", d: 694 + 60, hp: 1e9, speed: 32, r: 27 }));
const b0 = await page.evaluate(() => {
  const e = WD_DEBUG.state().enemies.find((e) => e.kind === "boss");
  return { d: e.d, hp: WD_DEBUG.towerApi.towerHp(WD_DEBUG.state().towers[0]) };
});
await step(page, 2);
const b1 = await page.evaluate(() => {
  const e = WD_DEBUG.state().enemies.find((e) => e.kind === "boss");
  return { d: e.d, siege: !!e.siege, hp: WD_DEBUG.towerApi.towerHp(WD_DEBUG.state().towers[0]) };
});
check("大将は塔に大きな損害を与える", b0.hp - b1.hp >= 26, `${b0.hp} → ${b1.hp}`);
check("大将は塔の前で立ち止まって攻撃する", b1.siege);
await step(page, 5);
const b2 = await page.evaluate(() => {
  const e = WD_DEBUG.state().enemies.find((e) => e.kind === "boss");
  return { d: e.d, siege: !!e.siege };
});
check("5秒たつと再び城へ進む（永久には止まらない）", !b2.siege && b2.d > b1.d, JSON.stringify([b1, b2]));
await clear(page);

console.log("■ 味方の部隊が塔を守る");
await page.evaluate(() => {
  const t = WD_DEBUG.state().towers[0];
  t.hp = WD_DEBUG.towerApi.towerMaxHp(t);
});
await tapHire(page, "spearman");
await tapMap(page, 640, 300);
await page.evaluate(() => WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 40, hp: 1e9, speed: 60 }));
const g0 = (await T(page))[0].hp;
await step(page, 3);
const blocked = await page.evaluate(
  () => !!WD_DEBUG.state().enemies.find((e) => e.kind === "goblin" && !e.holder).blockedBy,
);
check("足止めされた敵兵は部隊と戦い、塔は攻撃しない", blocked && (await T(page))[0].hp === g0);
await clear(page);

console.log("■ 破壊");
// 塔#1 に武将を配属してから壊す
await page.evaluate(() => WD_DEBUG.heroApi.assignHero("nobunaga", WD_DEBUG.state().towers[0]));
await page.evaluate(() => {
  const t = WD_DEBUG.state().towers[0];
  WD_DEBUG.towerApi.damageTower(t, 1e6);
});
t = await T(page);
check("耐久0で破壊される", t[0].destroyed && t[0].hp === 0);
check(
  "破壊された塔の武将は死なず未配属に戻る",
  await page.evaluate(() => WD_DEBUG.heroApi.heroState().nobunaga.tower === null),
);
await page.evaluate(() => {
  WD_DEBUG.state().towers[0].aim = 123; // 攻撃すると向きが変わる
  WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 90, hp: 1e9, speed: 0 });
});
await step(page, 2);
check("破壊された塔は攻撃しない", await page.evaluate(() => WD_DEBUG.state().towers[0].aim === 123));
await tapMap(page, 650, 225);
check(
  "破壊された塔は強化・売却・武将配属できない",
  (await page.isDisabled("#upgrade")) &&
    (await page.isDisabled("#sell")) &&
    (await page.isDisabled("#assign")),
);
check("塔パネルに（破壊）と表示", /破壊/.test(await page.textContent("#tpTitle")));
if (shots) await page.screenshot({ path: path.join(shots, "s1-ruin.png"), fullPage: true });
await page.tap("#tpClose");
await page.evaluate(() => {
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
});
t = await T(page);
check("ウェーブ終了でがれきを片付け（建て直せる）", !t.some((x) => x.destroyed) && t.length === 3);
check("片付けの通知", /がれきを片付けた/.test(await page.textContent("#msg")));

console.log("■ 修理");
await page.evaluate(() => {
  const t = WD_DEBUG.state().towers.find((t) => t.type === "magic");
  t.hp = WD_DEBUG.towerApi.towerMaxHp(t) / 2;
});
await tapMap(page, 700, 380);
check("ウェーブの合間は修理ボタンを表示", await page.isVisible("#repair"));
const g1 = await page.evaluate(() => WD_DEBUG.state().gold);
const rtext = await page.textContent("#repair");
await page.tap("#repair");
const after = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    t = s.towers.find((t) => t.type === "magic");
  return { gold: s.gold, hp: WD_DEBUG.towerApi.towerHp(t), max: WD_DEBUG.towerApi.towerMaxHp(t) };
});
check(
  "修理で耐久が全回復し、費用（建設費×50%×減った割合）を払う",
  after.hp === after.max && g1 - after.gold === 55,
  `${rtext} / ${g1 - after.gold}G`,
);
check("満タンなら修理ボタンを出さない", !(await page.isVisible("#repair")));
await page.evaluate(() => {
  const t = WD_DEBUG.state().towers.find((t) => t.type === "magic");
  t.hp = 10;
});
await page.tap("#tpClose");
await startHeld(page);
await tapMap(page, 700, 380);
check("ウェーブ中は修理できない", await page.isDisabled("#repair"));
await page.tap("#tpClose");

console.log("■ 敵兵の画像");
const sprites = await page.evaluate(() => {
  return {
    names: Object.fromEntries(Object.entries(WD_DEBUG.unitConfig.ENEMY_VS_UNIT).map(([k, v]) => [k, v.name])),
  };
});
check(
  "敵兵は戦国の兵5種（足軽・槍兵・騎兵・弓兵・大将）",
  Object.values(sprites.names).join() === "足軽,足軽,槍兵,騎兵,弓兵,大将",
  JSON.stringify(sprites.names),
);
await page.evaluate(() => {
  for (const [i, k] of ["goblin", "knight", "wolf", "dragon", "boss"].entries())
    WD_DEBUG.addEnemy({ kind: k, d: 330 + i * 70, hp: 1e9, speed: 0 });
});
await step(page, 0.4);
if (shots) await page.screenshot({ path: path.join(shots, "s2-enemies.png"), fullPage: true });
check("敵兵を描画してもエラーなし", errors.length === 0, errors.join(" / "));
await page.evaluate(() => {
  for (const e of WD_DEBUG.state().enemies) if (!e.holder) e.hp = 0;
});
await step(page, 0.3);
if (shots)
  await page.screenshot({
    path: path.join(shots, "s3-death.png"),
    clip: { x: 0, y: 150, width: 390, height: 260 },
  });
check("やられの演出でもエラーなし", errors.length === 0, errors.join(" / "));
await clear(page);
await page.evaluate(() => {
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1);
});

console.log("■ 部隊パネルの「＋補充」");
await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    q = s.squads[0];
  const m = WD_DEBUG.squadApi.members(q);
  m[0].alive = false;
  m[0].hp = 0;
});
await tapMap(page, 640, 285);
check(
  "部隊パネルの「＋ 補充」ボタンに費用（槍兵 24G）",
  (await page.isVisible("#sqRecruit")) && /24G/.test(await page.textContent("#sqRecruit")),
);
if (!(await page.isVisible("#sqMembers"))) await page.tap("#sqMore"); // 兵士の詳細を開く
check("空き枠があれば「＋補充」を表示", await page.isVisible("[data-recruit-chip]"));
check("「＋補充」に費用（槍兵 24G）", /24G/.test(await page.textContent("[data-recruit-chip]")));
const r0 = await page.evaluate(() => ({
  gold: WD_DEBUG.state().gold,
  n: WD_DEBUG.squadApi.members(WD_DEBUG.state().squads[0]).length,
}));
await page.tap("[data-recruit-chip]");
const r1 = await page.evaluate(() => ({
  gold: WD_DEBUG.state().gold,
  n: WD_DEBUG.squadApi.members(WD_DEBUG.state().squads[0]).length,
}));
check("タップで新兵を1人雇って補充（戦死者は戻らない）", r1.n === r0.n + 1 && r0.gold - r1.gold === 24);
await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    q = WD_DEBUG.state().squads[0];
  WD_DEBUG.setGold(9999);
  while (a.roster(q).length < 10) if (a.recruitInto(q)) break;
});
await page.tap("#sqMore"); // 画面を描き直す（部隊の選択はそのまま。兵士の詳細を閉じて開く）
await page.tap("#sqMore");
check(
  "10人そろうと「＋補充」は消える",
  (await page.isVisible("#squadPanel")) && !(await page.isVisible("[data-recruit-chip]")),
);
const chipH = await page.evaluate(() =>
  Math.min(
    ...[...document.querySelectorAll("#sqMembers button")].map((b) => b.getBoundingClientRect().height),
  ),
);
check("部隊パネルのボタン 44px 以上", chipH >= 44, String(chipH));
await page.evaluate(() => {
  const m = WD_DEBUG.squadApi.members(WD_DEBUG.state().squads[0]);
  m[0].alive = false;
});
await page.tap("#sqClose");
await startHeld(page);
await tapMap(page, 640, 285);
check(
  "ウェーブ中の「＋補充」は押せない（戦闘後）",
  (await page.isDisabled("[data-recruit-chip]")) &&
    /戦闘後/.test(await page.textContent("[data-recruit-chip]")),
);
if (shots) await page.screenshot({ path: path.join(shots, "s4-recruit.png"), fullPage: true });
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ リセット");
({ page, errors, context } = await newPage());
await page.evaluate(() => WD_DEBUG.setGold(5000));
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225);
await page.evaluate(() => WD_DEBUG.towerApi.damageTower(WD_DEBUG.state().towers[0], 1e6));
await page.tap("#reset");
check("リセットで塔とがれきを初期化", (await T(page)).length === 0);
check("リセットでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
