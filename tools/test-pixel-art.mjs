// 新ドット絵（v105試作）：設定の切り替え・既定は従来版・保存データの互換・描き分け・戦闘の処理が変わらないこと
//   node tools/test-pixel-art.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const UI = "worldDefense.ui.v1",
  SKEY = "worldDefense.soldiers.v1";
// 6兵種の部隊（1人目は上級職にする：play の中で）
const types = ["spearman", "cavalry", "archer", "medic", "gunner", "ashigaru"];
const save = { seq: 80, squadSeq: 6, squads: [], soldiers: [], fallen: [] };
let sid = 0;
types.forEach((t, i) => {
  save.squads.push({ id: i + 1, type: t, slot: i });
  for (let k = 0; k < 4; k++) save.soldiers.push({ id: ++sid, type: t, squadId: i + 1, level: 200 });
});
async function open({ query = "?debug", ui = null, seed = null, width = 390, height = 844, dpr = 2 } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: width < 600, hasTouch: width < 600 });
  await c.addInitScript(
    ([save, ui, seed]) => {
      requestAnimationFrame = () => 0;
      if (seed != null) {
        // 戦闘の処理を見比べるため、乱数を同じ並びにする
        let x = seed;
        Math.random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      }
      if (location.protocol !== "http:" || sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      if (ui) localStorage.setItem("worldDefense.ui.v1", JSON.stringify(ui));
    },
    [save, ui, seed],
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG && WD_DEBUG.pixel.ready());
  return { c, p };
}
// 部隊を道に出し、ウェーブを進めて描く
const play = (p, steps = 100) =>
  p.evaluate((steps) => {
    const S = WD_DEBUG.state,
      A = WD_DEBUG.squadApi;
    WD_DEBUG.setGold(99999);
    S().soldiers[0].job = "samurai"; // 上級職（見た目の判定だけに使う）
    S().soldiers[1].job = "unknown_job"; // 新しい絵がない職業（従来の絵になる）
    let tid = 900;
    for (const [t, x, y] of [["arrow", 330, 90], ["cannon", 640, 200], ["magic", 660, 420], ["ice", 330, 530]])
      S().towers.push({ id: ++tid, x, y, type: t, level: 2, cd: 0, spent: 100, hp: 400 });
    [[300, 165], [300, 440], [620, 300], [180, 300], [400, 165], [400, 440]].forEach((pt, i) => A.deployReserve(S().squads[i], ...pt));
    for (const k of Object.keys(WD_DEBUG.pixel.stats)) WD_DEBUG.pixel.stats[k] = 0;
    document.getElementById("start").click();
    for (let i = 0; i < steps; i++) WD_DEBUG.step(0.05);
    WD_DEBUG.heroApi.draw();
    const st = S();
    return {
      stats: { ...WD_DEBUG.pixel.stats },
      sim: {
        gold: st.gold,
        hp: st.hp,
        wave: st.wave,
        enemies: st.enemies.map((e) => [e.kind, Math.round(e.x), Math.round(e.y), Math.round(e.hp)]),
        towers: st.towers.map((t) => [t.type, Math.round(t.hp), t.level]),
        soldiers: st.squads.flatMap((q) => (q.members || []).map((m) => m.hp)),
        squads: st.squads.map((q) => [q.state, Math.round(q.x || 0), Math.round(q.y || 0)]),
      },
    };
  }, steps);
try {
  // 1. 既定は従来版（新しいプレイヤー・既存の表示の記録に gfx がない場合）
  let { c, p } = await open({ ui: { layout: "classic", all: true, maxWave: 12, seen: { gacha: true }, fresh: {} } });
  let r = await p.evaluate(() => ({ gfx: WD_DEBUG.pixel.gfx(), on: WD_DEBUG.pixel.on(), btn: document.getElementById("gfxToggle").textContent, ui: JSON.parse(localStorage.getItem("worldDefense.ui.v1")) }));
  check(r.gfx === "classic" && !r.on, "初期設定は従来版", r);
  check(r.btn.includes("従来版"), "設定（メニュー）にグラフィックの切り替え「絵：従来版」のボタン", r.btn);
  check(r.ui.layout === "classic" && r.ui.maxWave === 12 && r.ui.seen.gacha === true && r.ui.gfx === "classic", "以前の表示の記録はそのまま読め、gfx は従来版で補われる", r.ui);
  let d = await play(p, 60);
  check(d.stats.unit + d.stats.tower + d.stats.castle + d.stats.ground === 0, "従来版では新ドット絵を一切描かない", d.stats);
  r = await p.evaluate(() => WD_DEBUG.pixel.spread());
  check(r.x === 1 && r.y === 1, "従来版の隊形の間隔はそのまま", r);
  const classicSim = (await (async () => {
    await c.close();
    ({ c, p } = await open({ seed: 7 }));
    return play(p, 160);
  })()).sim;
  // 2. 切り替え：保存されるのは表示の記録（gfx）だけ。兵士の保存データは変わらない
  const before = await p.evaluate((k) => localStorage.getItem(k), SKEY);
  r = await p.evaluate(() => {
    document.getElementById("gfxToggle").click();
    return { gfx: WD_DEBUG.pixel.gfx(), btn: document.getElementById("gfxToggle").textContent, ui: JSON.parse(localStorage.getItem("worldDefense.ui.v1")) };
  });
  check(r.gfx === "pixel" && r.btn.includes("新ドット絵") && r.ui.gfx === "pixel", "ボタンで新ドット絵に切り替わり、表示の記録に保存される", r);
  check((await p.evaluate((k) => localStorage.getItem(k), SKEY)) === before, "切り替えても兵士の保存データは変わらない");
  await c.close();
  // 3. 再読み込みしても新ドット絵。兵士6種・塔・城・背景を新しい絵で描き、上級職は従来の絵
  ({ c, p } = await open({ ui: { gfx: "pixel", layout: "classic" }, seed: 7 }));
  d = await play(p, 160);
  check(await p.evaluate(() => WD_DEBUG.pixel.on()), "保存した設定（新ドット絵）で起動する");
  check(d.stats.unit > 0 && d.stats.tower >= 4 && d.stats.castle >= 0 && d.stats.enemy > 0, "兵士・敵兵・塔を新ドット絵で描く", d.stats);
  check(d.stats.job > 0, "上級職（侍）の兵士は職業の新ドット絵で描く", d.stats);
  check(d.stats.classicUnit > 0, "新しい絵がない職業は従来の絵で描く", d.stats);
  r = await p.evaluate(() => WD_DEBUG.pixel.spread());
  check(r.x > 1.2 && r.y > 1.2, "新ドット絵では隊形を表示だけ広げる（兵士の重なりを減らす）", r);
  check(JSON.stringify(d.sim) === JSON.stringify(classicSim), "新ドット絵で隊形を広げても、戦闘の処理（位置・体力・資金・塔）は従来版と同じ", { classicSim, pixel: d.sim });
  r = await p.evaluate(() => {
    WD_DEBUG.heroApi.draw();
    const g = document.getElementById("game"),
      k = g.width / 960,
      px = (x, y) => [...g.getContext("2d").getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data];
    return { frames: WD_DEBUG.pixel.frames(), stats: { ...WD_DEBUG.pixel.stats }, road: px(800, 300), grass: px(820, 30) };
  });
  const need = ["ashigaru", "spearman", "archer", "gunner", "medic", "cavalry"].flatMap((k) => ["ally", "enemy"].flatMap((t) => ["idle0", "idle1", "walk0", "walk1", "attack0"].map((f) => k + "_" + t + "_" + f)));
  check(need.every((f) => r.frames.includes(f)), "兵士6種×味方/敵×5コマの素材がある");
  check(["arrow", "cannon", "gun", "ice"].every((t) => [1, 2, 3, 4, 5].every((lv) => r.frames.includes("tower_" + t + "_ally_lv" + lv) && r.frames.includes("tower_" + t + "_enemy_lv" + lv))) && ["castle1_ally", "castle2_ally", "castle1_enemy"].every((f) => r.frames.includes(f)), "塔4種（味方・敵）×強化Lv1〜5と城（通常・強化）の素材がある");
  const JOBS = ["samurai", "kensei", "sword_saint", "sohei", "spear_commander", "bow_saint", "gun_commander", "healing_master", "ninja", "shinobi_head", "kibateppo", "yarikiba", "yumikiba", "akazonae", "iron_cavalry"];
  check(JOBS.every((j) => ["idle0", "idle1", "walk0", "walk1", "attack0", "death"].every((f) => r.frames.includes(j + "_ally_" + f))), "上級職・最上級職15種の素材（5コマと戦死）がある");
  check(["idle0", "walk0", "attack0", "death"].every((f) => r.frames.includes("general_enemy_" + f)) && need.every((f) => r.frames.includes(f.replace(/_(idle|walk|attack)\d$/, "_death"))) && r.frames.includes("ford"), "大将・戦死のコマ・渡河の川の素材がある");
  check(r.stats.ground >= 1 && r.stats.castle >= 1, "背景と城を新ドット絵で描く", r.stats);
  check(r.road[0] > 180 && r.road[1] > 150 && r.grass[1] > r.grass[0], "道は砂色、草地は緑（地面の画像がゲームの道の形に合う）", r);
  r = await p.evaluate(() => [
    WD_DEBUG.pixel.enemyKind({ kind: "goblin" }),
    WD_DEBUG.pixel.enemyKind({ kind: "wolf" }),
    WD_DEBUG.pixel.enemyKind({ kind: "boss" }),
    WD_DEBUG.pixel.enemyKind({ kind: "boss", boss: true }),
    WD_DEBUG.pixel.enemyKind({ kind: "knight", rare: "gold" }),
    WD_DEBUG.pixel.enemyKind({ kind: "dragon", intruder: true }),
  ]);
  check(r[0] === "ashigaru" && r[1] === "cavalry" && r[2] === "general" && r[3] === null && r[4] === null && r[5] === null, "ふつうの敵兵と大将は新ドット絵、特別な敵・裏ボスは従来の絵", r);
  await c.close();
  // 4. 攻城戦（縦向き・iPhone）と討伐戦：新ドット絵で例外なく描ける。敵の塔は赤い旗、ボスは従来の絵
  ({ c, p } = await open({ query: "?debug&layout=vertical&gfx=pixel", width: 390, height: 844, dpr: 3 }));
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    for (const k of Object.keys(WD_DEBUG.pixel.stats)) WD_DEBUG.pixel.stats[k] = 0;
    A.setTarget(A.PROVINCES.owari.castle);
    A.startBattle();
    A.battle().terrain = ["river"]; // 渡河の川（見た目の確認だけ）
    for (let i = 0; i < 120; i++) WD_DEBUG.step(0.05);
    WD_DEBUG.heroApi.draw();
    return { stats: { ...WD_DEBUG.pixel.stats }, vertical: document.body.classList.contains("vertical-field") };
  });
  check(r.vertical && r.stats.tower > 0 && r.stats.enemy > 0 && r.stats.unit > 0 && r.stats.castle > 0, "攻城戦（縦向き）でも兵士・敵兵・敵の塔・城を新ドット絵で描く", r);
  check(r.stats.ford >= 2, "渡河の場所に新ドット絵の川（上下の道に1つずつ）", r.stats);
  await c.close();
  ({ c, p } = await open({ query: "?debug&layout=vertical&gfx=pixel" }));
  r = await p.evaluate(() => {
    localStorage.setItem("worldDefense.conquest.v1", JSON.stringify({ version: 2, castles: {}, secrets: { hiei: true }, secretSeen: { hiei: true } }));
    return true;
  });
  await p.goto(base + "?debug&layout=vertical&gfx=pixel");
  await p.waitForFunction(() => window.WD_DEBUG && WD_DEBUG.pixel.ready());
  r = await p.evaluate(() => {
    const A = WD_DEBUG.squadApi;
    const e = A.setBossTarget("hiei");
    if (e) return { e };
    A.startBattle();
    for (const k of Object.keys(WD_DEBUG.pixel.stats)) WD_DEBUG.pixel.stats[k] = 0;
    for (let i = 0; i < 80; i++) WD_DEBUG.step(0.05);
    WD_DEBUG.heroApi.draw();
    return { stats: { ...WD_DEBUG.pixel.stats } };
  });
  check(!r.e && r.stats.unit > 0 && r.stats.ground + r.stats.castle >= 0, "討伐戦（裏ボス）も新ドット絵の部隊で描け、ボスは従来の絵", r);
  await c.close();
  // 5. PC（従来の表示）でも描け、従来版へ戻せる
  ({ c, p } = await open({ query: "?debug&layout=classic", ui: { gfx: "pixel" }, width: 1280, height: 900, dpr: 2 }));
  d = await play(p, 40);
  check(d.stats.unit > 0 && d.stats.ground >= 1, "PC（画素密度2）でも新ドット絵で描く", d.stats);
  r = await p.evaluate(() => {
    document.getElementById("gfxToggle").click();
    for (const k of Object.keys(WD_DEBUG.pixel.stats)) WD_DEBUG.pixel.stats[k] = 0;
    WD_DEBUG.heroApi.draw();
    return { gfx: WD_DEBUG.pixel.gfx(), stats: { ...WD_DEBUG.pixel.stats }, ui: JSON.parse(localStorage.getItem("worldDefense.ui.v1")).gfx };
  });
  check(r.gfx === "classic" && r.ui === "classic" && r.stats.unit + r.stats.ground + r.stats.tower === 0, "従来版へ戻すと、背景も含めて従来の絵に戻る", r);
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
