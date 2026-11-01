// 伝説の奥義（v106.1試作・v106.2で継承者を保存）：修練場の「新しい戦い（試作）」だけ。継承者1人・手動・1回の挑戦で全軍1回。奥義ゲージは廃止
//   node tools/test-legend-ougi.mjs
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
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const KEYS = ["worldDefense.soldiers.v1", "worldDefense.warlords.v1", "worldDefense.training.v1", "worldDefense.ui.v1"];
// 足軽4人（1人目・2人目を剣聖にする）と槍兵4人
const save = { version: 1, seq: 8, squadSeq: 2, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }, { id: 2, type: "spearman", slot: 1 }], soldiers: [] };
for (let k = 0; k < 8; k++)
  save.soldiers.push({ id: k + 1, type: k < 4 ? "ashigaru" : "spearman", squadId: k < 4 ? 1 : 2, level: 200, ...(k < 2 ? { job: "sword_saint", jobs: ["ashigaru", "samurai", "kensei", "sword_saint"] } : {}) });
async function open({ query = "?debug&proto=combat", width = 375, height = 667, warlord = null } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(
    ([save, warlord]) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify(warlord ? { owned: { [warlord]: 1 }, tickets: 3, history: [] } : { version: 1, owned: {}, tickets: 3, history: [] }));
      localStorage.setItem("worldDefense.training.v1", JSON.stringify({ best: { beginner: { waves: 3, level: 6 } }, clears: { beginner: 2 } }));
    },
    [save, warlord],
  );
  const p = await c.newPage();
  p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  // 剣聖（試験用：職業だけ変える）
  await p.evaluate(() => {
    const S = WD_DEBUG.state().soldiers;
    S[0].job = "sword_saint";
    S[1].job = "sword_saint";
  });
  return { c, p };
}
const saves = (p) => p.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), KEYS);
// 修練場（試作）を継承者つきで始め、部隊を道に出して、ウェーブを始める（敵は自分で置く）
const begin = (p, { heir = 1, key = "happouTenshou", deploy = true } = {}) =>
  p.evaluate(
    ({ heir, key, deploy }) => {
      const K = WD_DEBUG.combat.ougi,
        S = WD_DEBUG.state;
      // 継承者：その奥義を閃いたことにして指定する（保存される。v106.2）
      if (heir != null) {
        K.grant(heir, key);
        const e = K.setHeir(heir, { k: key });
        if (e) return e;
      }
      const err = WD_DEBUG.trainingApi.startTraining("beginner");
      if (deploy) WD_DEBUG.squadApi.deployReserve(S().squads[0], 620, 300);
      WD_DEBUG.squadApi.deployReserve(S().squads[1], 400, 165);
      for (const s of S().soldiers) s.cd = 1e9; // 普通の攻撃をさせない（奥義だけを確かめる）
      WD_DEBUG.step(0.05); // 1フレーム進めてボタンの表示を更新
      return err;
    },
    { heir, key, deploy },
  );
const wave = (p) =>
  p.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
  });
// 継承者の部隊（620,300）のまわりに敵を置く
const foes = (p, list) =>
  p.evaluate((list) => list.map(([d, hp, extra]) => WD_DEBUG.addEnemy({ d, hp, speed: 0, unitCd: 1e9, ...(extra || {}) })).length, list);
const hpOf = (p) => p.evaluate(() => WD_DEBUG.state().enemies.map((e) => Math.round(e.hp)));
try {
  // 1. 修練場の画面：試作をオンにすると、今の奥義継承者と「⚔ 奥義書・継承者」のボタン。iPhone縦ではみ出さない
  let { c, p } = await open();
  await p.tap("#trainingOpen");
  let r = await p.evaluate(() => {
    const box = document.querySelector(".tr-ougi");
    return { text: box && box.textContent, btn: !!document.querySelector("[data-ougi-open]"), overflow: document.documentElement.scrollWidth - innerWidth, defs: Object.values(WD_DEBUG.combat.ougi.defs).map((O) => O.name + ":" + O.job) };
  });
  check(r.text && r.text.includes("奥義継承者：なし") && r.btn, "修練場の画面に今の奥義継承者（なし）と奥義の画面へのボタン", r);
  check(r.defs.join() === "八方天翔斬:sword_saint,無明一閃:sword_saint,天剣乱舞:sword_saint", "奥義は剣聖の八方天翔斬・無明一閃・天剣乱舞の3つ", r.defs);
  check(r.overflow <= 0, "iPhone縦（375px）で修練場の画面がはみ出さない", r);
  await c.close();

  // 2. ボタンは1つ。ウェーブ前は押せず理由を出す。対象がいなければ回数を減らさない。使うと全軍で1回だけ
  ({ c, p } = await open());
  check((await begin(p)) === null, "修練場（試作）を継承者つきで始める");
  r = await p.evaluate(() => ({ n: document.querySelectorAll("#ougiBtn").length, hidden: document.getElementById("ougiBtn").hidden, disabled: document.getElementById("ougiBtn").disabled, why: document.getElementById("ougiWhy").textContent, name: document.getElementById("ougiName").textContent }));
  check(r.n === 1 && !r.hidden && r.name.includes("八方天翔斬"), "奥義のボタンは1つだけ（技名つき）", r);
  check(r.disabled && r.why.includes("ウェーブ中"), "ウェーブ前は押せず、理由を出す", r);
  await wave(p);
  r = await p.evaluate(() => {
    const used = WD_DEBUG.combat.ougi.use();
    return { used, state: WD_DEBUG.combat.ougi.state(), err: WD_DEBUG.combat.ougi.error() };
  });
  check(!r.used && !r.state.used && r.err === null, "対象がいないときは使えず、使用回数は減らない", r);
  await foes(p, [[600, 9e5], [620, 9e5], [640, 9e5], [700, 9e5, { path: "lower" }]]);
  const hp0 = await hpOf(p);
  await p.evaluate(() => document.getElementById("ougiBtn").click());
  r = await p.evaluate(() => ({ state: WD_DEBUG.combat.ougi.state(), fx: WD_DEBUG.combat.fx(), stats: WD_DEBUG.combat.stats(), btn: { disabled: document.getElementById("ougiBtn").disabled, why: document.getElementById("ougiWhy").textContent, name: document.getElementById("ougiName").textContent }, paused: WD_DEBUG.state().paused }));
  const hp1 = await hpOf(p);
  check(r.state.used && r.stats.ougi === 1 && r.state.usedBy, "ボタンで奥義を使う（全軍の使用回数1）", r.state);
  check(hp1.filter((v, i) => v < hp0[i]).length >= 3, "八方天翔斬は周りの複数の敵に当たる", { hp0, hp1 });
  check(r.fx.banner && r.fx.banner.name === "奥義・八方天翔斬" && r.fx.banner.who.includes("奥義継承者") && r.fx.kinds.includes("cwave") && r.fx.kinds.includes("cshock"), "技名と発動者の名前を大きく出し、画面いっぱいの斬撃波", r.fx);
  check(!r.paused, "奥義で戦闘は止まらない", r);
  check(r.btn.disabled && r.btn.why.includes("もう使いました") && r.btn.name.includes("使用済み"), "使ったあとはボタンが押せず、使用済みと理由を出す", r.btn);
  r = await p.evaluate(() => {
    const before = WD_DEBUG.state().enemies.map((e) => e.hp);
    const again = WD_DEBUG.combat.ougi.use();
    WD_DEBUG.step(1);
    // 次のウェーブでも使えない（1回の挑戦で1回）
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.5);
    return { again, stats: WD_DEBUG.combat.stats(), err: WD_DEBUG.combat.ougi.error() };
  });
  check(!r.again && r.stats.ougi === 1, "同じ挑戦では再発動できない", r);
  // 長く戦っても奥義は自動で出ない（ゲージなし）
  r = await p.evaluate(() => {
    const S = WD_DEBUG.state;
    for (const s of S().soldiers) s.cd = 0;
    for (let w = 0; w < 3 && WD_DEBUG.trainingApi.training(); w++) {
      if (!S().enemies.length) document.getElementById("start").click();
      for (let i = 0; i < 400; i++) WD_DEBUG.step(0.05);
    }
    return { stats: WD_DEBUG.combat.stats(), fx: WD_DEBUG.combat.fx() };
  });
  check(r.stats.ougi === 1 && !Object.keys(r.stats.patterns).some((k) => k.endsWith("Ougi") && k !== "eightSlashOugi"), "攻撃を続けても奥義は自動で出ない（奥義ゲージは廃止）", r.stats);
  // 新しい挑戦ではまた使える
  r = await p.evaluate(() => {
    const a = WD_DEBUG.trainingApi;
    if (a.training()) a.endTraining("retreat");
    a.startTraining("beginner");
    return WD_DEBUG.combat.ougi.state();
  });
  check(r && r.used === false && r.heirId === 1, "次の挑戦を始めると、また1回使える", r);
  await c.close();

  // 3. 使えない理由：継承者なし・戦場にいない・戦死・剣聖でない
  ({ c, p } = await open());
  await begin(p, { heir: null });
  await wave(p);
  await foes(p, [[600, 9e5]]);
  r = await p.evaluate(() => ({ err: WD_DEBUG.combat.ougi.error(), used: WD_DEBUG.combat.ougi.use(), disabled: (WD_DEBUG.heroApi.draw(), document.getElementById("ougiBtn").disabled) }));
  check(!r.used && r.err.includes("継承者がいません"), "継承者を指定しないと使えない", r);
  await c.close();
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    WD_DEBUG.combat.ougi.grant(3, "happouTenshou");
    return WD_DEBUG.combat.ougi.setHeir(3, { k: "happouTenshou" });
  }); // 剣聖ではない兵士は継承者にならない
  check(typeof r === "string" && r.includes("剣聖だけ"), "剣聖でない兵士は継承者に指定できない", r);
  await c.close();
  ({ c, p } = await open());
  await begin(p, { deploy: false });
  await wave(p);
  await foes(p, [[600, 9e5]]);
  r = await p.evaluate(() => ({ err: WD_DEBUG.combat.ougi.error(), used: WD_DEBUG.combat.ougi.use(), state: WD_DEBUG.combat.ougi.state() }));
  check(!r.used && r.err.includes("戦場にいません") && !r.state.used, "継承者が戦場にいないと使えない（回数は減らない）", r);
  r = await p.evaluate(() => {
    const s = WD_DEBUG.state().soldiers.find((x) => x.id === 1);
    s.job = "samurai";
    const e1 = WD_DEBUG.combat.ougi.error();
    s.job = "sword_saint";
    s.alive = false;
    const e2 = WD_DEBUG.combat.ougi.error();
    s.alive = true;
    return { e1, e2 };
  });
  check(r.e1.includes("剣聖ではありません") && r.e2.includes("戦死"), "継承者が剣聖でなくなった・戦死したときも理由を出す", r);
  await c.close();

  // 4. 無明一閃：強敵1体だけに強烈な一撃
  ({ c, p } = await open());
  await begin(p, { key: "mumyouIssen" });
  await wave(p);
  await foes(p, [[600, 5000], [640, 80000, { role: "mid", lv: 10 }], [700, 5000, { path: "lower" }]]);
  const m0 = await hpOf(p);
  r = await p.evaluate(() => ({ used: WD_DEBUG.combat.ougi.use(), fx: WD_DEBUG.combat.fx() }));
  const m1 = await hpOf(p);
  check(r.used && m1[1] < m0[1] && m1[0] === m0[0] && m1[2] === m0[2], "無明一閃は強敵（中ボス）1体だけに当たる", { m0, m1 });
  check(m0[1] - m1[1] > 1000 && r.fx.banner.name === "奥義・無明一閃" && r.fx.kinds.includes("cline"), "強烈な一撃と、画面を横切る一閃の演出", { dmg: m0[1] - m1[1], fx: r.fx });
  await c.close();

  // 5. 天剣乱舞：戦闘を止めずに、広い範囲へ6回の連続斬撃
  ({ c, p } = await open());
  await begin(p, { key: "tenkenRanbu" });
  await wave(p);
  await foes(p, [[600, 9e5], [620, 9e5], [650, 9e5], [700, 9e5, { path: "lower" }], [300, 9e5]]);
  const t0 = await hpOf(p);
  r = await p.evaluate(() => {
    const used = WD_DEBUG.combat.ougi.use(),
      left0 = WD_DEBUG.combat.ougi.flurry();
    const hits = [];
    for (let i = 0; i < 40; i++) {
      WD_DEBUG.step(0.05);
      hits.push(WD_DEBUG.combat.ougi.flurry());
    }
    return { used, left0, hits, left: WD_DEBUG.combat.ougi.flurry(), fx: WD_DEBUG.combat.fx(), paused: WD_DEBUG.state().paused };
  });
  const t1 = await hpOf(p);
  const dropped = t1.map((v, i) => t0[i] - v);
  check(r.used && r.left0 === 6 && r.left === 0, "天剣乱舞は6回の斬撃を時間をずらして当てる", r);
  check(dropped.slice(0, 4).every((d) => d > 0) && dropped[4] === 0, "範囲内の複数の敵に当たり、遠くの敵には当たらない", dropped);
  check(!r.paused && r.hits.filter((v, i) => i && v < r.hits[i - 1]).length >= 5, "連続斬撃は戦闘を止めずに進む（1回ずつ減る）", r.hits);
  await c.close();

  // 6. 武将の必殺技は今までどおり使える（試作の修練場でも）
  const W = await (async () => {
    const t = await open();
    const id = await t.p.evaluate(() => Object.keys(WD_DEBUG.config.WARLORDS).find((k) => WD_DEBUG.config.WARLORDS[k].skill.target === "enemy"));
    await t.c.close();
    return id;
  })();
  ({ c, p } = await open({ warlord: W }));
  await begin(p);
  await wave(p);
  await foes(p, [[600, 9e5]]);
  r = await p.evaluate((id) => {
    const A = WD_DEBUG.heroApi,
      h = A.heroState()[id];
    A.assignHero(id, WD_DEBUG.state().squads[0]);
    const skill = A.useSkillFrom(h),
      dock = document.querySelectorAll("#skillDockList button, #battleSkills button").length;
    const ougi = WD_DEBUG.combat.ougi.use();
    return { skill, ougi, cd: h.cd > 0, dock };
  }, W);
  check(r.skill && r.cd && r.ougi, "武将の必殺技と奥義はどちらも使える（別々のボタン）", { W, ...r });
  await c.close();

  // 7. 試作をオフにした修練場・通常の防衛戦にはボタンが出ず、奥義も使えない
  ({ c, p } = await open({ query: "?debug" }));
  r = await p.evaluate(() => {
    const hidden0 = document.getElementById("ougiBtn").hidden;
    WD_DEBUG.trainingApi.startTraining("beginner");
    WD_DEBUG.heroApi.draw();
    return { hidden0, hidden1: document.getElementById("ougiBtn").hidden, state: WD_DEBUG.combat.ougi.state(), err: WD_DEBUG.combat.ougi.error(), used: WD_DEBUG.combat.ougi.use() };
  });
  check(r.hidden0 && r.hidden1 && r.state === null && !r.used && r.err.includes("試作"), "試作なしの修練場・通常の防衛戦では奥義のボタンが出ず使えない", r);
  await c.close();

  // 8. 保存データ：奥義・継承者の記録を入れない。挑戦の途中・後も、兵士の保存データは読める
  ({ c, p } = await open());
  await begin(p);
  await wave(p);
  await foes(p, [[600, 50]]);
  await p.evaluate(() => {
    WD_DEBUG.combat.ougi.use();
    for (let i = 0; i < 200; i++) WD_DEBUG.step(0.05);
    if (!WD_DEBUG.state().enemies.length) WD_DEBUG.trainingApi.endTraining("retreat");
  });
  r = await saves(p);
  const text = Object.values(r).join("");
  check(!/ougi|heir|Ougi|protoGauge|protoHits/.test(text), "既存の保存データ（兵士・武将・修練場・表示）に奥義・継承者・試作の数値を入れない（奥義は専用の保存キー）");
  const sv = JSON.parse(r["worldDefense.soldiers.v1"]);
  check(Array.isArray(sv.soldiers) && sv.soldiers.length === 8 && sv.squads.length === 2, "兵士の保存データは壊れていない（人数・部隊）", { soldiers: sv.soldiers.length, squads: sv.squads.length });
  await p.reload();
  await p.waitForFunction(() => window.WD_DEBUG);
  r = await p.evaluate(() => ({ n: WD_DEBUG.state().soldiers.length, st: WD_DEBUG.combat.ougi.state(), heir: WD_DEBUG.combat.ougi.heir() }));
  check(r.n === 8 && r.st === null && r.heir && r.heir.sid === 1 && r.heir.valid, "開き直しても兵士と奥義継承者はそのまま（v106.2で継承者を保存）", r);
  await c.close();

  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
