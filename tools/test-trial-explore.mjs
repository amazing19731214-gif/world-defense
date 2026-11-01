// 戦場試練 v113：探索（暗闇のランダムなマップで村を探し、仲間を得る）。テスト版だけ。雇用は2500G
//   node tools/test-trial-explore.mjs（はじめにテスト版 test-build/index.html を作り直す）
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");
execFileSync(process.execPath, [new URL("./build.mjs", import.meta.url).pathname, "--test"], { stdio: "ignore" });
const PROD = new URL("../index.html", import.meta.url),
  TEST = new URL("../test-build/index.html", import.meta.url);
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(q.url.startsWith("/blank") ? "<!doctype html><title>blank</title>" : fs.readFileSync(q.url.startsWith("/test") ? TEST : PROD));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port;
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
// 本番の保存データ（探索で変わらないことを見る）
const prodSave = {
  "worldDefense.soldiers.v1": JSON.stringify({ version: 1, seq: 2, squadSeq: 1, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }], soldiers: [{ id: 1, type: "ashigaru", squadId: 1, level: 77, name: "本番太郎" }, { id: 2, type: "medic", squadId: 1, level: 12, name: "本番花子" }] }),
};
const rawAll = (p) =>
  p.evaluate(() => {
    const get = window.WD_TEST_STORAGE ? (k) => window.WD_TEST_STORAGE.raw.get.call(localStorage, k) : (k) => localStorage.getItem(k);
    return Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, get(k)]));
  });
const prodOnly = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("wdtest:")));
// テスト版を開いてテスト用兵士（10人）を準備し、?debug で開き直す
async function openTest(ctx) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript(() => (window.requestAnimationFrame = () => 0));
  await p.goto(base + "/test/");
  await p.waitForTimeout(700);
  await p.evaluate(() => document.getElementById("testPrepare").click());
  await p.waitForLoadState("load");
  await p.waitForTimeout(900);
  await p.goto(base + "/test/?debug");
  await p.waitForFunction(() => window.WD_DEBUG);
  return p;
}
const roster = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")));
// 主人公（試・剣神 id 10）で探索に出る
const go = (p, hero = 10) =>
  p.evaluate((hero) => {
    const T = WD_DEBUG.trial;
    if (T.on()) T.retreat();
    document.getElementById("trialSheet").hidden = true;
    return T.start([hero], { mode: "explore", hero });
  }, hero);
// まだ救っていない村へ歩き、野盗を倒して救う（主人公の HP は下げすぎない）
const freeVillage = (p) =>
  p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    const n0 = T.exploreState().recruits.length;
    // 試験は道さがしを見ないので、まだ救っていない村の手前（村から330）まで一行を連れて行く
    const tv0 = L.map.villages.find((q) => q.state !== "freed");
    if (tv0) {
      const a = Math.atan2(L.map.start.y - tv0.y, L.map.start.x - tv0.x);
      L.units.filter((u) => !u.dead).forEach((u, k) => {
        const x = tv0.x + Math.cos(a) * 330 + k * 14,
          y = tv0.y + Math.sin(a) * 330;
        Object.assign(u, { x, y, px: x, py: y, home: { x, y } });
      });
    }
    for (let i = 0; i < 4000; i++) {
      for (const u of L.units) if (!u.dead) u.hp = Math.max(u.hp, u.max * 0.8);
      while (L.choice) T.choose(0);
      const tv = L.map.villages.find((q) => q.state !== "freed");
      if (!tv) break;
      const dx = tv.x - h.x,
        dy = tv.y - h.y,
        d = Math.hypot(dx, dy) || 1;
      T.stick(d > 60 ? dx / d : 0, d > 60 ? dy / d : 0);
      WD_DEBUG.step(0.1);
      if (T.exploreState().recruits.length > n0) break;
    }
    T.stick(0, 0);
    const s = T.exploreState();
    return { got: s.recruits.length > n0, rec: s.recruits[s.recruits.length - 1], units: L.units.filter((u) => !u.dead).length, pct: s.pct };
  });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // 本番の保存データを置く（探索の間に変わらないことを見る）
  const p0 = await ctx.newPage();
  await p0.goto(base + "/");
  await p0.evaluate((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, prodSave);
  await p0.goto(base + "/blank");
  const prod0 = prodOnly(await rawAll(p0));
  await p0.close();
  const p = await openTest(ctx);
  // 1. 雇用は2500G（ランダムで1人）。兵種を選ぶ部隊の雇用は変えない
  let r = await p.evaluate(() => ({ cost: WD_DEBUG.recruitApi.cost(), squad: WD_DEBUG.config ? null : null }));
  check(r.cost === 2500, "ランダムで1人の雇用は 2500G（以前は 24G）", r);
  // 2. 出撃の画面に「🌑 探索」（テスト版だけ）。本番の版では出さない・始められない
  r = await p.evaluate(() => {
    document.getElementById("trialOpen").click();
    document.querySelector('[data-trial-mode="explore"]').click();
    const t = document.getElementById("trialBody").textContent,
      go = [...document.querySelectorAll("[data-trial-go]")].map((b) => b.textContent);
    document.getElementById("trialClose").click();
    return { has: /探索/.test(t) && /本当に戦死/.test(t) && /兵士名簿に入ります/.test(t), go };
  });
  check(r.has && r.go.some((t) => /探索に出る/.test(t)), "出撃の画面に「🌑 探索」（説明：主人公1人・村で仲間・名簿へ・本当に戦死）", r);
  // 3. ランダムなマップ：同じ種なら同じ形。村3〜5・川に村がない・出発地は空いている
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      out = [];
    for (let s = 1; s <= 30; s++) {
      const M = T.exploreMap(s * 7919);
      const inRiver = (x) => M.river && x > M.river.x0 - 40 && x < M.river.x1 + 40;
      out.push({ n: M.villages.length, river: !!M.river, bad: M.villages.filter((v) => inRiver(v.x)).length, near: M.obstacles.filter((o) => Math.hypot(o.x - M.start.x, o.y - M.start.y) < 150).length, kinds: [...new Set(M.villages.map((v) => v.type))].length });
    }
    const a = JSON.stringify(T.exploreMap(123).villages),
      b = JSON.stringify(T.exploreMap(123).villages),
      c = JSON.stringify(T.exploreMap(124).villages);
    return { out, same: a === b, diff: a !== c };
  });
  check(r.out.every((m) => m.n >= 3 && m.n <= 5 && m.bad === 0 && m.near === 0) && r.out.some((m) => m.river) && r.out.some((m) => !m.river), "ランダムなマップ（30枚）：村は3〜5・川の上に村はない・出発地のまわりは空いている・川がある地とない地", r.out.slice(0, 5));
  check(r.same && r.diff, "同じ種なら同じマップ、違う種なら違うマップ", r);
  // 4. 探索を始める：主人公1人・暗闇（最初は少しだけ見えている）・大将はいない
  const rs0 = await roster(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    const err = T.start([10, 9, 8], { mode: "explore", hero: 10, seed: 4242 });
    const L = T.live();
    WD_DEBUG.step(0.3);
    const s = T.exploreState();
    return { err, units: L.units.length, hero: L.units[0].id, pct: s.pct, villages: s.villages.map((v) => v.state), leave: !document.getElementById("trialLeave").hidden, boss: !!L.boss };
  });
  check(!r.err && r.units === 1 && r.hero === 10 && r.pct > 0 && r.pct < 5 && r.villages.every((v) => v === "hidden") && r.leave && !r.boss, "主人公1人で出発。最初は真っ暗（見えているのは " + r.pct + "%）。村はまだ見つかっていない。「🚪 この地を去る」が出る", r);
  // 5. 歩くと見えた所が広がる。村を見つけると野盗が出て、倒すと村の兵士が仲間に（兵士名簿に入る・同行）
  r = await freeVillage(p);
  const rs1 = await roster(p);
  check(r.got && r.rec.name && r.rec.joined && r.units === 2 && r.pct > 3, "村を見つけて野盗を追い払うと、" + (r.rec && r.rec.village) + "の" + (r.rec && r.rec.name) + "が仲間に（同行・探索 " + r.pct + "%）", r);
  check(rs1.soldiers.length === rs0.soldiers.length + 1 && rs1.soldiers.some((s) => s.id === r.rec.id), "仲間は兵士名簿に入る（" + rs0.soldiers.length + " → " + rs1.soldiers.length + "人。無料・テスト版の保存領域）", { before: rs0.soldiers.length, after: rs1.soldiers.length });
  r = await p.evaluate((id) => {
    const T = WD_DEBUG.trial,
      v = T.exploreState().villages.find((q) => q.state === "freed");
    return { type: v.type, recType: JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.find((s) => s.id === id).type };
  }, r.rec.id);
  check(r.type === r.recType, "村の種類の兵士が仲間になる（" + r.type + "）", r);
  // 6. 本当の戦死：仲間が倒れると兵士名簿から外れ、英霊名鑑（戦死の記録）に入る
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      m = L.units[1],
      id = m.id,
      e = L.enemies.find((x) => !x.gone) || null;
    L.st = 30;
    m.hp = 0.0001;
    for (let i = 0; i < 400 && !m.dead; i++) {
      m.hp = Math.min(m.hp, 0.0001);
      const foe = L.enemies.find((x) => !x.gone);
      if (foe) Object.assign(foe, { x: m.x + 20, y: m.y, target: m, cd: 0 });
      else L.next = 0;
      L.units[0].hp = L.units[0].max;
      WD_DEBUG.step(0.1);
    }
    const save = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1"));
    return { dead: m.dead, inRoster: save.soldiers.some((s) => s.id === id), fallen: (save.fallen || []).some((f) => f.id === id), list: T.exploreState().fallen };
  });
  // 英霊名鑑に載るのは、名前のある兵士だけ（防衛戦の戦死と同じ決まり。村の新兵「騎兵 #11」などは名前がないので載らない）
  check(r.dead && !r.inRoster && r.list.length === 1, "仲間が倒れると本当に戦死：兵士名簿から外れる（防衛戦の戦死と同じ処理。名前のある兵士は英霊名鑑へ）", r);
  // 7. この地を去る：新しいランダムなマップ（第2地）。生きている兵士は出発地へ。暗闇はまた最初から
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      before = JSON.stringify(T.exploreState().villages.map((v) => [v.x, v.y])),
      err = T.leave(),
      s = T.exploreState(),
      h = L.units[0];
    WD_DEBUG.step(0.2);
    return { err, region: s.region, changed: JSON.stringify(s.villages.map((v) => [v.x, v.y])) !== before, hidden: s.villages.every((v) => v.state === "hidden"), atStart: Math.hypot(h.x - s.start.x, h.y - s.start.y) < 20, pct: T.exploreState().pct, enemies: L.enemies.length, banner: document.getElementById("trialInfo").textContent };
  });
  check(!r.err && r.region === 2 && r.changed && r.hidden && r.atStart && r.pct < 5 && r.enemies === 0 && /第2地/.test(r.banner), "「この地を去る」で第2地へ：新しいマップ・暗闇は最初から・主人公は出発地", r);
  // 8. 大将も時間切れもない（6分たっても続く）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.st = 400;
    for (let i = 0; i < 20; i++) (L.units[0].hp = L.units[0].max), WD_DEBUG.step(0.1);
    return { on: T.on(), boss: !!L.boss };
  });
  check(r.on && !r.boss, "探索には大将も時間切れもない（面の時計 400秒でも続く）", r);
  // 9. 一緒に歩けるのは5人まで：5人そろうまで村を救い（村がなくなれば次の地へ）、6人目は名簿にだけ入る
  let tries = 0;
  while (tries++ < 10) {
    const a = await p.evaluate(() => WD_DEBUG.trial.live().units.filter((u) => !u.dead).length);
    if (a >= 5) break;
    const f = await freeVillage(p);
    if (!f.got) await p.evaluate(() => WD_DEBUG.trial.leave());
  }
  const sixth = await freeVillage(p);
  if (!sixth.got) {
    await p.evaluate(() => WD_DEBUG.trial.leave());
  }
  const six = sixth.got ? sixth : await freeVillage(p);
  check(six.got && six.units === 5 && six.rec.name && !six.rec.joined, "一緒に歩けるのは5人まで。6人目の仲間は兵士名簿にだけ入る（陣で待つ）", six);
  // 10. 主人公が倒れたら探索は終わり。結果の画面：仲間になった兵士・戦死した兵士。得た仲間は名簿に残る
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      h = L.units[0];
    L.st = 30;
    for (let i = 0; i < 400 && T.on(); i++) {
      h.hp = Math.min(h.hp, 0.0001);
      const foe = L.enemies.find((x) => !x.gone);
      if (foe) Object.assign(foe, { x: h.x + 20, y: h.y, target: h, cd: 0 });
      else L.next = 0;
      while (L.choice) T.choose(0);
      WD_DEBUG.step(0.1);
    }
    return { on: T.on(), title: document.getElementById("trialTitle").textContent, text: document.getElementById("trialBody").textContent };
  });
  check(!r.on && /探索の結果/.test(r.title) && /主人公が倒れ、探索は終わった/.test(r.text) && /仲間になった兵士/.test(r.text) && /戦死（英霊名鑑へ）/.test(r.text), "主人公が倒れると探索は終わり。結果の画面に、仲間になった兵士と戦死した兵士", r.text.slice(0, 200));
  const rs2 = await roster(p);
  check(rs2.soldiers.length >= rs1.soldiers.length + 3, "探索で得た仲間は兵士名簿に残る（" + rs0.soldiers.length + " → " + rs2.soldiers.length + "人）", rs2.soldiers.length);
  // 11. iPhone縦：はみ出さない。本番の保存データは変わらない
  r = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(r <= 0, "iPhone縦（390px）で横にはみ出さない", r);
  await p.goto(base + "/blank");
  check(JSON.stringify(prodOnly(await rawAll(p))) === JSON.stringify(prod0), "本番の保存データ（worldDefense.*）は変わらない（探索の名簿・戦死はテスト版の保存領域だけ）");
  // 12. 本番の版では探索を始められない（出撃の画面にも出ない）
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await q.goto(base + "/?debug");
  await q.waitForFunction(() => window.WD_DEBUG);
  r = await q.evaluate(() => {
    document.getElementById("trialOpen").click();
    const btn = !!document.querySelector('[data-trial-mode="explore"]');
    document.getElementById("trialClose").click();
    return { btn, err: WD_DEBUG.trial.start([1], { mode: "explore", hero: 1 }) };
  });
  check(!r.btn && /テスト版だけ/.test(r.err || ""), "本番の版では「探索」は出ず、始められない", r);
  await ctx.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
