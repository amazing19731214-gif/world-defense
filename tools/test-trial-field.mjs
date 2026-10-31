// 戦場試練 v108：広い戦場（カメラ）・兵士の直接操作（仮想スティック・切り替え・全員自動）・地形（川・橋・木と岩）
//   node tools/test-trial-field.mjs
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
const P = 1e15;
// 剣聖・槍将・弓聖・銃将・医王（Lv300・最上級職・閃き・装備）
const U = [
  ["ashigaru", "sword_saint", { sword_saint: P, samurai: P, kensei: P }, "osafune", "in_sword_saint"],
  ["spearman", "spear_commander", { spear_commander: P, spearman: P }, "nagayari", "in_spear_commander"],
  ["archer", "bow_saint", { bow_saint: P, archer: P }, "raijodo", "in_bow_saint"],
  ["gunner", "gun_commander", { gun_commander: P, gunner: P }, "sakaizutsu", "in_gun_commander"],
  ["medic", "healing_master", { healing_master: P, medic: P }, "tosei", "in_healing_master"],
];
const items = [];
const soldiers = U.map(([type, job, prof, gear, ins], i) => {
  items.push({ uid: i + 1, id: gear, owner: i + 1, lock: true });
  // 兵2（槍将）だけ、ステータスポイント「速さ」を100（+25%）
  return { id: i + 1, type, squadId: 1, level: 300, name: "兵" + (i + 1), job, jobs: [type, job], prof, insight: { known: [ins], equipped: [ins] }, ...(i === 1 ? { pts: { atk: 0, def: 0, spd: 100, rng: 0 } } : {}) };
});
const save = { version: 1, seq: 5, squadSeq: 1, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }], soldiers };
async function open({ width = 390, height = 844, query = "?debug" } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(
    ([save, items]) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [], forge: { items } }));
    },
    [save, items],
  );
  const p = await c.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
const begin = (p) =>
  p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialSheet").hidden = true;
    T.start([1, 2, 3, 4, 5]);
    T.auto();
    T.begin();
    T.snap();
  });
const storage = (p) => p.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))));
try {
  // 1. 広い戦場：以前（960×600）の4倍の広さ。北・中央・南の道・川と3本の橋・木と岩・配置場所・関
  let { c, p } = await open();
  const save0 = await storage(p);
  await begin(p);
  let r = await p.evaluate(() => {
    const M = WD_DEBUG.trial.map();
    return { size: M.size, lanes: Object.keys(M.lanes), bridges: M.bridges.length, obstacles: M.obstacles.length, river: !!M.river, deploy: M.deploy, fort: M.fort };
  });
  check((r.size.w * r.size.h) / (960 * 600) >= 3 && (r.size.w * r.size.h) / (960 * 600) <= 5, "戦場は以前の約4倍の広さ（" + r.size.w + "×" + r.size.h + "）", r.size);
  check(r.lanes.join() === "top,mid,bot" && r.river && r.bridges === 3 && r.obstacles >= 30, "北・中央・南の道、川と3本の橋、木と岩がある", r);
  // 2. 全員自動のときは全体を映す。兵士を操作するとカメラがその兵士を追う（戦場の外は映さない）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      M = T.map(),
      v0 = T.view();
    T.control(1);
    T.snap();
    const v1 = T.view(),
      u = T.live().units.find((x) => x.id === 1);
    return { v0, v1, u: { x: u.x, y: u.y }, M: M.size };
  });
  check(Math.abs(r.v0.z - 0.5) < 0.01 && r.v0.ox === 0 && r.v0.oy === 0, "全員自動のときは戦場の全体を映す", r.v0);
  const cx = r.v1.ox + 960 / r.v1.z / 2,
    cy = r.v1.oy + 600 / r.v1.z / 2;
  check(r.v1.z === 1 && Math.abs(cx - r.u.x) < 320 && r.v1.ox >= 0 && r.v1.oy >= 0 && r.v1.ox + 960 / r.v1.z <= r.M.w + 0.5 && r.v1.oy + 600 / r.v1.z <= r.M.h + 0.5, "操作する兵士をカメラが追い、戦場の外は映さない", { v: r.v1, u: r.u, cx, cy });
  // カメラは急に飛ばない（1コマで少しずつ近づく）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    T.control(null);
    WD_DEBUG.heroApi.draw();
    const a = T.view().z;
    return { a };
  });
  check(r.a > 0.5 && r.a <= 1, "カメラは急に飛ばず、少しずつ全体へ戻る（1コマ目 z=" + r.a.toFixed(2) + "）", r);
  // 3. スティック：8方向に動く。指を離すと止まる
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    L.queue.length = 0;
    L.queue.push({ t: 1e9, lane: "mid" }); // 敵が来ない間（戦闘は終わらない）
    L.enemies.length = 0;
    T.control(1);
    const u = L.units.find((x) => x.id === 1),
      out = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      u.x = 1000;
      u.y = 600;
      T.stick(Math.cos(a), Math.sin(a));
      for (let i = 0; i < 15; i++) WD_DEBUG.step(0.1);
      const da = Math.atan2(u.y - 600, u.x - 1000),
        err = Math.abs(((da - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      out.push({ k, d: Math.round(Math.hypot(u.x - 1000, u.y - 600)), err: Math.round((err * 180) / Math.PI) });
    }
    T.stick(0, 0);
    const x0 = u.x,
      y0 = u.y;
    WD_DEBUG.step(1);
    return { out, still: Math.hypot(u.x - x0, u.y - y0) };
  });
  check(r.out.every((o) => o.d > 15 && o.err < 30), "スティックで上下左右・斜めの8方向に動く", r.out);
  check(r.still < 2, "指を離すと止まる（AI が勝手に動かさない）", r.still);
  // 川：橋の外からは渡れない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      M = T.map(),
      u = T.live().units.find((x) => x.id === 1);
    u.x = M.river.x1 + 30;
    u.y = 400; // 橋のない所
    T.stick(-1, 0);
    WD_DEBUG.step(3);
    const blocked = u.x >= M.river.x1 - 1;
    u.x = M.river.x1 + 30;
    u.y = 600; // 中央の橋
    WD_DEBUG.step(3);
    T.stick(0, 0);
    return { blocked, crossed: u.x < M.river.x0, x: u.x };
  });
  check(r.blocked && r.crossed, "川は橋の外からは渡れず、橋の上なら渡れる", r);
  // 木：重ならない
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      M = T.map(),
      o = M.obstacles[0],
      u = T.live().units.find((x) => x.id === 1);
    u.x = o.x + 60;
    u.y = o.y;
    T.stick(-1, 0);
    WD_DEBUG.step(2);
    T.stick(0, 0);
    return { d: Math.hypot(u.x - o.x, u.y - o.y), r: o.r };
  });
  check(r.d >= r.r + 8, "木や岩には重ならない（押し出される）", r);
  await c.close();

  // 4. 操作しながら戦う：ほかの兵士は AI で戦う。切り替え・全員自動・技の待ち時間はそのまま・倒れたら切り替わる
  ({ c, p } = await open());
  await begin(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    T.control(3); // 弓聖を操作：前（西）へ歩いてから、その場で撃つ
    T.stick(-1, 0);
    for (let i = 0; i < 40; i++) WD_DEBUG.step(0.1);
    T.stick(0, 0);
    for (let i = 0; i < 90; i++) WD_DEBUG.step(0.5);
    const s = T.state();
    return { control: s.control, others: s.units.filter((u) => u.id !== 3).reduce((a, u) => a + u.kills, 0), me: s.units.find((u) => u.id === 3), skills: s.units.find((u) => u.id === 3).skills };
  });
  check(r.control === 3 && r.others > 0, "操作していない兵士は AI で戦う（撃破あり）", r);
  check(r.me.kills > 0 || r.me.dealt > 0, "操作している兵士も、届く敵へ自動で攻撃する", r.me);
  // 切り替え：兵士の札を押す。前の兵士の技の待ち時間はそのまま（写しに残る）
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      archer = L.units.find((u) => u.id === 3),
      before = JSON.stringify(archer.sh.evolution && archer.sh.evolution.ready);
    document.querySelector('#trialUnits [data-trial-ctl="1"]').click();
    const a = T.state().control,
      after = JSON.stringify(archer.sh.evolution && archer.sh.evolution.ready);
    document.getElementById("trialAutoAll").click();
    return { a, same: before === after, before, auto: T.state().control, chips: document.querySelectorAll("#trialUnits [data-trial-ctl]").length };
  });
  check(r.a === 1 && r.chips === 5, "兵士の札（5人）を押すと操作する兵士が切り替わる", r);
  check(r.same && r.before !== "null", "切り替えても職業技の待ち時間はリセットされない", r.before);
  check(r.auto === null, "「🤖 全員自動」で手動の操作を外す", r);
  // 操作していた兵士が倒れたら、生きている兵士へ切り替わる
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live();
    T.control(2);
    const u = L.units.find((x) => x.id === 2);
    u.hp = 1;
    const e = L.enemies.find((x) => !x.gone) || WD_DEBUG.trial.live().enemies[0];
    // 敵の一撃で倒す
    for (let i = 0; i < 200 && !u.dead; i++) {
      u.hp = Math.min(u.hp, 1);
      WD_DEBUG.step(0.1);
    }
    return { dead: u.dead, control: T.state().control };
  });
  check(r.dead && r.control !== null && r.control !== 2, "操作していた兵士が倒れると、生きている兵士へ切り替わる", r);
  // 最後まで：勝つ。技は従来どおり発動する
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial;
    document.getElementById("trialAutoAll").click(); // 全員自動に戻して最後まで
    for (let i = 0; i < 600 && T.on(); i++) WD_DEBUG.step(1);
    const res = T.result();
    return { result: res.result, skills: res.units.map((u) => Object.keys(u.skills).length), kills: res.kills, total: res.total };
  });
  check(r.result === "win" && r.kills === r.total && r.skills.filter((k) => k > 0).length >= 4, "広い戦場で最後まで戦って勝てる（職業技・閃きも発動）", r);
  check((await storage(p)) === save0, "戦場試練の前後で保存データは変わらない");
  await c.close();

  // 5. iPhone縦：スティックを指で動かす・離すと止まる・画面はスクロールしない・WASD
  for (const width of [375, 390]) {
    ({ c, p } = await open({ width, height: 812 }));
    await begin(p);
    r = await p.evaluate(() => {
      const L = WD_DEBUG.trial.live();
      L.queue.length = 0;
      L.queue.push({ t: 1e9, lane: "mid" }); // 敵が来ない間（戦闘は終わらない）
      L.enemies.length = 0;
      document.querySelector('#trialUnits [data-trial-ctl="1"]').click();
      const pad = document.getElementById("trialPad"),
        b = pad.getBoundingClientRect();
      pad.scrollIntoView({ block: "center" });
      return {
        pad: [Math.round(b.width), Math.round(b.height)],
        visible: pad.offsetParent !== null,
        overflow: document.documentElement.scrollWidth - innerWidth,
        chips: [...document.querySelectorAll("#trialUnits button")].map((x) => Math.round(x.getBoundingClientRect().height)),
      };
    });
    check(r.visible && r.pad[0] >= 120 && r.chips.length === 5 && r.chips.every((h) => h >= 44) && r.overflow <= 0, "iPhone縦（" + width + "px）：スティック・兵士の札が押しやすく、はみ出さない", r);
    const pad = await p.locator("#trialPad").boundingBox();
    const scroll0 = await p.evaluate(() => scrollY);
    const x0 = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).x);
    await p.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await p.mouse.down();
    await p.mouse.move(pad.x + pad.width / 2 + 55, pad.y + pad.height / 2, { steps: 5 }); // 右へ倒す
    await p.evaluate(() => WD_DEBUG.step(1));
    const x1 = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).x);
    await p.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2 - 55, { steps: 5 }); // 指を滑らせて上へ
    const y0 = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).y);
    await p.evaluate(() => WD_DEBUG.step(1));
    const y1 = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).y);
    await p.mouse.up();
    const xr = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).x);
    await p.evaluate(() => WD_DEBUG.step(1));
    const xs = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).x);
    const scroll1 = await p.evaluate(() => scrollY);
    check(x1 - x0 > 20 && y0 - y1 > 20 && Math.abs(xs - xr) < 2 && scroll1 === scroll0, "指でスティックを倒すと動き、滑らせると向きが変わり、離すと止まる（画面はスクロールしない）（" + width + "px）", { x0, x1, y0, y1, xr, xs, scroll0, scroll1 });
    // 画面を回転しても操作できる
    await p.setViewportSize({ width: 812, height: width });
    await p.setViewportSize({ width, height: 812 });
    r = await p.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, pad: document.getElementById("trialPad").offsetParent !== null }));
    check(r.overflow <= 0 && r.pad, "画面を回転して戻しても、はみ出さずスティックが使える（" + width + "px）", r);
    await c.close();
  }
  // PC：WASD・矢印キー
  ({ c, p } = await open({ width: 1200, height: 900 }));
  await begin(p);
  await p.evaluate(() => {
    const L = WD_DEBUG.trial.live();
    L.queue.length = 0;
    L.queue.push({ t: 1e9, lane: "mid" }); // 敵が来ない間（戦闘は終わらない）
    L.enemies.length = 0;
    WD_DEBUG.trial.control(1);
  });
  const k0 = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).x);
  await p.keyboard.down("a");
  await p.evaluate(() => WD_DEBUG.step(1));
  await p.keyboard.up("a");
  await p.keyboard.down("ArrowDown");
  const ky0 = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1).y);
  await p.evaluate(() => WD_DEBUG.step(1));
  await p.keyboard.up("ArrowDown");
  r = await p.evaluate(() => WD_DEBUG.trial.live().units.find((u) => u.id === 1));
  check(k0 - r.x > 20 && r.y - ky0 > 20, "PC では WASD・矢印キーで動かせる", { k0, x: r.x, ky0, y: r.y });
  await c.close();

  // v108.4 歩く速さ：ステータス「速さ」を反映（攻城戦の進軍と同じ式）。操作している兵士は 1.25 倍
  ({ c, p } = await open());
  await begin(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      L = T.live(),
      q0 = (L.queue.length = 0, L.queue.push({ t: 1e9, lane: "mid" }), (L.enemies.length = 0)),
      R = T.rules,
      u1 = L.units.find((u) => u.id === 1),
      u2 = L.units.find((u) => u.id === 2),
      base = (u) => T.walkBase(u.id);
    T.control(2);
    u2.x = 1000;
    u2.y = 600;
    T.stick(1, 0);
    WD_DEBUG.step(1);
    T.stick(0, 0);
    const walked = u2.x - 1000;
    return { s1: u1.speed / base(u1), s2: u2.speed / base(u2), walked, expect: u2.speed * R.ctlSpeed };
  });
  check(Math.abs(r.s1 - 1) < 0.001 && Math.abs(r.s2 - 1.25) < 0.001, "歩く速さにステータス「速さ」が入る（速さ100 で ×" + r.s2.toFixed(2) + "。振っていない兵士は ×1）", r);
  check(Math.abs(r.walked - r.expect) < 3, "スティックで操作している兵士は、さらに 1.25 倍で歩く（1秒で " + Math.round(r.walked) + "）", r);
  await c.close();
  // v108.4 通常攻撃の見え方：近接は斬撃の軌跡、弓・鉄砲は光る軌跡（敵の矢・弾は赤く光る）。兵士の絵は大きめ
  ({ c, p } = await open());
  await begin(p);
  r = await p.evaluate(() => {
    const T = WD_DEBUG.trial,
      kinds = new Set(),
      glows = new Set();
    for (let i = 0; i < 900 && T.on(); i++) {
      WD_DEBUG.step(0.1);
      for (const k of WD_DEBUG.combat.fx().kinds) kinds.add(k);
      const st = T.state();
      if (st) for (const g of st.glows) glows.add(g);
    }
    return { kinds: [...kinds], glows: [...glows] };
  });
  check(r.kinds.includes("cslash") && r.kinds.includes("cspark") && r.glows.includes("#bfeaff") && r.glows.includes("#ffd27a") && r.glows.includes("#ff8a6a"), "通常攻撃：近接の斬撃の軌跡・弓の光る矢・鉄砲の光る弾と火花・敵の赤い矢と弾", r);
  // 6. 防衛戦には何も出ない（戦場試練の外ではスティック・兵士の札を出さない）
  ({ c, p } = await open());
  r = await p.evaluate(() => ({ bar: document.getElementById("trialBar").hidden, ctl: document.getElementById("trialCtl").hidden }));
  check(r.bar && r.ctl, "戦場試練の外ではスティック・兵士の札を出さない", r);
  await c.close();
  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
