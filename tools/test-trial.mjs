// 戦場試練（v107試作）：少人数の個人戦。専用の戦闘処理・三方の関・安全な試作（本番の兵士・保存データは変えない）
//   node tools/test-trial.mjs
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
// 足軽・槍兵・弓兵・鉄砲兵・衛生兵・騎兵・足軽（7人。名前つき＝戦死すると英霊名鑑に載る兵士）
const types = ["ashigaru", "spearman", "archer", "gunner", "medic", "cavalry", "ashigaru"];
const save = {
  version: 1,
  seq: 7,
  squadSeq: 2,
  fallen: [],
  squads: [
    { id: 1, type: "ashigaru", slot: 0 },
    { id: 2, type: "archer", slot: 1 },
  ],
  soldiers: types.map((t, i) => ({ id: i + 1, type: t, squadId: i < 4 ? 1 : 2, level: 120, name: "兵" + (i + 1) })),
};
async function open({ query = "?debug", width = 375, height = 667 } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript((save) => {
    requestAnimationFrame = () => 0;
    if (sessionStorage.s) return;
    sessionStorage.s = 1;
    localStorage.clear();
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
    localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [] }));
    localStorage.setItem("worldDefense.ougi.v1", JSON.stringify({ version: 1, seq: 1, books: [{ uid: 1, k: "happouTenshou", from: "初代", job: "sword_saint", level: 300, at: 1 }], known: {}, rolls: {}, fails: {}, heir: null, run: null }));
  }, save);
  const p = await c.newPage();
  p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
const storage = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
const roster = (p) => p.evaluate(() => JSON.stringify(WD_DEBUG.state().soldiers.map((s) => [s.id, s.alive, s.hp, s.level, s.xp, s.kills, s.battles, s.chronicle && s.chronicle.kills, s.squadId])));
try {
  // 1. 入口と出撃する兵士の選択：最大5人。保存済みで生存している兵士だけ
  let { c, p } = await open();
  const before = { s: await storage(p), r: await roster(p) };
  await p.evaluate(() => document.getElementById("trialOpen").click());
  let r = await p.evaluate(() => ({
    open: !document.getElementById("trialSheet").hidden,
    title: document.getElementById("trialTitle").textContent,
    rows: document.querySelectorAll("[data-trial-pick]").length,
    text: document.getElementById("trialBody").textContent,
  }));
  check(r.open && r.title.includes("戦場試練") && r.rows === 7 && r.text.includes("三方の関"), "メニューの「⚔️ 戦場試練」から、ステージ「三方の関」と兵士の一覧を開く", r);
  for (const id of [1, 2, 3, 4, 5, 6]) await p.evaluate((id) => document.querySelector('[data-trial-pick="' + id + '"]').click(), id);
  r = await p.evaluate(() => ({
    picked: [...document.querySelectorAll('[data-trial-pick][aria-pressed="true"]')].map((b) => +b.dataset.trialPick),
    sixth: document.querySelector('[data-trial-pick="6"]').disabled,
    go: document.querySelector("[data-trial-go]").textContent,
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  check(r.picked.join() === "1,2,3,4,5" && r.sixth && r.go.includes("5人"), "出撃は5人まで（6人目は選べない）", r);
  check(r.overflow <= 0, "iPhone縦（375px）で選ぶ画面がはみ出さない", r);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    return { six: T.start([1, 2, 3, 4, 5, 6]), none: T.start([]) };
  });
  check(r.six.includes("5人まで") && r.none.includes("選んで"), "6人以上・0人では出撃できない", r);
  // 雇ったばかり（未保存）の兵士は選べない
  r = await p.evaluate(() => {
    const q = WD_DEBUG.squadApi.hireSquad("ashigaru", 650, 300);
    const s = WD_DEBUG.squadApi.members(q)[0];
    WD_DEBUG.trial.open("pick");
    const b = document.querySelector('[data-trial-pick="' + s.id + '"]');
    return { id: s.id, disabled: b && b.disabled, err: WD_DEBUG.trial.start([s.id]) };
  });
  check(r.disabled && r.err.includes("選んで"), "保存されていない兵士（雇ったばかり）は出撃できない", r);
  await c.close();

  // 2. 配置：光っている場所をタップして1人ずつ。全員を置くまで始まらない。防衛戦のタップには渡さない
  ({ c, p } = await open());
  const save0 = await storage(p);
  await p.evaluate(() => {
    document.getElementById("trialOpen").click();
    for (const id of [1, 2, 3, 4, 5]) document.querySelector('[data-trial-pick="' + id + '"]').click();
    document.querySelector("[data-trial-go]").click();
  });
  r = await p.evaluate(() => ({ st: WD_DEBUG.trial.state(), bar: !document.getElementById("trialBar").hidden, go: document.getElementById("trialGo").disabled, sheet: document.getElementById("trialSheet").hidden, play: getComputedStyle(document.querySelector(".play-tools")).display }));
  check(r.st.phase === "deploy" && r.bar && r.go && r.sheet && r.play === "none", "出撃すると配置の段階（戦闘開始は全員を置くまで押せない。ウェーブ開始などは隠す）", r);
  const box = await p.locator("#game").boundingBox();
  const tap = (x, y) => p.mouse.click(box.x + (x / 960) * box.width, box.y + (y / 600) * box.height);
  await tap(200, 300); // 配置場所の外
  await tap(690, 250);
  await tap(700, 350);
  r = await p.evaluate(() => ({ st: WD_DEBUG.trial.state(), squads: WD_DEBUG.state().squads.map((q) => q.state), towers: WD_DEBUG.state().towers.length, early: WD_DEBUG.trial.begin() }));
  const placed = r.st.units.filter((u) => u.placed);
  check(placed.length === 2 && Math.abs(placed[0].x - 690) < 3 && Math.abs(placed[1].y - 350) < 3, "タップした所（配置場所の中）に1人ずつ配置する。外は置けない", placed);
  check(r.squads.every((s) => s !== "deployed") && r.towers === 0, "配置のタップは防衛戦（部隊・塔）に渡らない", r);
  check(typeof r.early === "string" && r.early.includes("全員"), "全員を置くまで戦闘は始まらない", r.early);
  r = await p.evaluate(() => {
    WD_DEBUG.trial.auto();
    return { placed: WD_DEBUG.trial.state().units.filter((u) => u.placed).length, begin: WD_DEBUG.trial.begin(), phase: WD_DEBUG.trial.state().phase };
  });
  check(r.placed === 5 && r.begin === null && r.phase === "fight", "「自動で並べる」で残りを置き、戦闘を始める", r);
  // ほかのモードは始まらない
  r = await p.evaluate(() => {
    document.getElementById("start").click();
    return { playing: WD_DEBUG.state().playing, training: WD_DEBUG.trainingApi.startTraining("beginner"), wave: WD_DEBUG.state().wave };
  });
  check(!r.playing && r.wave === 0 && typeof r.training === "string" && r.training.includes("戦場試練"), "戦場試練の間は防衛戦のウェーブ・修練場を始めない", r);

  // 3. 戦闘：兵士はそれぞれ自分で動く。近接は近づき、遠距離は射程を保つ。衛生兵は回復。三方向から敵
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      start = T.state().units.map((u) => [u.x, u.y]);
    const lanes = new Set(),
      targets = new Set(),
      gap = { melee: [], ranged: [] };
    let healed = 0;
    for (let i = 0; i < 40 * 20; i++) {
      WD_DEBUG.step(0.05);
      const s = T.state();
      if (!s) break;
      for (const e of s.enemies) {
        lanes.add(e.lane);
        if (e.target) targets.add(e.target);
      }
      const live = T.live();
      for (const u of live.units)
        if (!u.dead && u.target && !u.target.gone && u.role !== "heal") gap[u.role].push(Math.hypot(u.x - u.target.x, u.y - u.target.y));
      healed = s.units.reduce((n, u) => n + u.healed, 0);
    }
    const s = T.state(),
      moved = s.units.map((u, i) => Math.round(Math.hypot(u.x - start[i][0], u.y - start[i][1]))),
      med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)] || 0;
    return { lanes: [...lanes].sort(), targets: targets.size, moved, healed, melee: med(gap.melee), ranged: med(gap.ranged), kills: s.kills, spawned: s.spawned };
  });
  check(r.lanes.join() === "bot,mid,top", "敵は上・中央・下の3方向から順に出る", r.lanes);
  check(r.moved.filter((d) => d > 20).length >= 4 && new Set(r.moved).size >= 4, "兵士はそれぞれ独立して動く（動いた距離がばらばら）", r.moved);
  check(r.kills > 0 && r.targets >= 2, "兵士が敵を探して倒し、敵は兵士を1人ずつ狙う（狙われた兵士が2人以上）", r);
  check(r.melee < 70 && r.ranged > r.melee + 40, "近接は敵に近づいて戦い、弓・鉄砲は離れて撃つ（敵との距離の中央値）", { melee: r.melee, ranged: r.ranged });
  check(r.healed > 0, "衛生兵が傷ついた味方を回復する", r.healed);
  r = await p.evaluate(() => {
    const live = WD_DEBUG.trial.live().units.filter((u) => !u.dead);
    let min = Infinity;
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) min = Math.min(min, Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y));
    return min;
  });
  check(r > 8, "兵士どうしは完全に重なり続けない（いちばん近い2人の距離）", r);
  // 4. 勝利：敵を全滅させる（試験では敵の体力を減らす）
  r = await p.evaluate(() => {
    const L = WD_DEBUG.trial.live();
    L.queue.forEach((q) => (q.t = 0));
    for (let i = 0; i < 2000 && WD_DEBUG.trial.on(); i++) {
      for (const e of L.enemies) if (!e.gone) e.hp = Math.min(e.hp, 1);
      WD_DEBUG.step(0.05);
    }
    return { res: WD_DEBUG.trial.result(), sheet: !document.getElementById("trialSheet").hidden, text: document.getElementById("trialBody").textContent, bar: document.getElementById("trialBar").hidden };
  });
  check(r.res.result === "win" && r.res.kills === r.res.total && r.sheet && r.text.includes("勝利") && r.text.includes("撃破") && r.text.includes("生存") && r.bar, "敵を全滅させると勝利。結果の画面に勝敗・生存者・戦死者・撃破数", { res: r.res.result, kills: r.res.kills, text: r.text.slice(0, 80) });
  check(JSON.stringify(await storage(p)) === JSON.stringify(save0), "戦場試練のあとも保存データは1つも変わらない（報酬・経験値なし）");
  r = await p.evaluate(() => {
    document.getElementById("trialClose").click();
    document.getElementById("start").click();
    return { playing: WD_DEBUG.state().playing, trial: WD_DEBUG.trial.on() };
  });
  check(r.playing && !r.trial, "終わると防衛戦にそのまま戻れる（ウェーブを始められる）", r);
  await c.close();

  // 5. 敗北・仮の戦死：本番の兵士は失われない・英霊名鑑に載らない・保存データは変わらない
  ({ c, p } = await open());
  const s1 = await storage(p),
    r1 = await roster(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    const L = T.live();
    L.queue.forEach((q) => (q.t = 0));
    for (let i = 0; i < 4000 && T.on(); i++) {
      for (const u of L.units) if (!u.dead) u.hp = Math.min(u.hp, 1);
      WD_DEBUG.step(0.05);
    }
    const S = WD_DEBUG.state();
    return { res: T.result(), alive: S.soldiers.filter((s) => s.alive).length, fallen: WD_DEBUG.squadApi.soldierSave().fallen.length, text: document.getElementById("trialBody").textContent };
  });
  check(r.res.result === "lose" && r.res.units.every((u) => u.dead), "味方が全滅すると敗北", r.res.result);
  check(r.alive === 7 && r.fallen === 0 && r.text.includes("仮"), "試作の戦死は仮：本番の兵士は全員生きていて、英霊名鑑にも載らない", r);
  check((await roster(p)) === r1 && JSON.stringify(await storage(p)) === JSON.stringify(s1), "兵士（HP・Lv・経験・戦歴）と、兵士・武将・奥義書の保存データは変わらない");
  await p.reload();
  await p.waitForFunction(() => window.WD_DEBUG);
  r = await p.evaluate(() => ({ alive: WD_DEBUG.state().soldiers.filter((s) => s.alive).length, fallen: WD_DEBUG.squadApi.soldierSave().fallen.length, trial: WD_DEBUG.trial.on() }));
  check(r.alive === 7 && r.fallen === 0 && !r.trial, "再読み込みしても兵士は全員いる（戦場試練は続かない）", r);
  // 6. 撤退
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    T.start([6, 7]);
    T.retreat(); // 配置の段階でやめる
    const a = { on: T.on(), res: T.result() };
    T.start([6, 7]);
    T.auto();
    T.begin();
    WD_DEBUG.step(3);
    document.getElementById("trialRetreat").click();
    return { a, res: T.result(), on: T.on() };
  });
  check(!r.a.on && r.res.result === "retreat" && !r.on, "配置の段階は「出撃をやめる」、戦闘中は「撤退」で終わる", r);
  check(JSON.stringify(await storage(p)) === JSON.stringify(s1), "撤退しても保存データは変わらない");
  // 7. iPhone縦：戦闘中・結果の画面がはみ出さない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    WD_DEBUG.step(10);
    WD_DEBUG.heroApi.draw();
    const a = document.documentElement.scrollWidth - innerWidth;
    T.retreat();
    return { fight: a, result: document.documentElement.scrollWidth - innerWidth };
  });
  check(r.fight <= 0 && r.result <= 0, "iPhone縦（375px）で戦闘中・結果の画面がはみ出さない", r);
  await c.close();

  // 8. 奥義・3回ごとの技は戦場試練では使わない（奥義のボタンも出ない）
  ({ c, p } = await open({ query: "?debug&proto=combat" }));
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    WD_DEBUG.step(20);
    return { stats: WD_DEBUG.combat.stats(), btn: document.getElementById("ougiBtn").hidden, ougi: WD_DEBUG.combat.ougi.error() };
  });
  check(Object.keys(r.stats.patterns).length === 0 && r.stats.ougi === 0 && r.btn && r.ougi.includes("試作"), "戦場試練では伝説の奥義・3回ごとの技を使わない", r);
  await c.close();

  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
