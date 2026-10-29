// 21職・通常/上位42技・閃き21技の実際の戦闘アダプタ、進化・保存・モード互換・画面。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html; charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
let n = 0;
const errors = [],
  check = (v, t) => {
    assert.ok(v, t);
    n++;
    console.log("✓ " + t);
  };
const jobs = [
  "ashigaru",
  "spearman",
  "archer",
  "gunner",
  "cavalry",
  "medic",
  "samurai",
  "ninja",
  "kensei",
  "sohei",
  "kibateppo",
  "yarikiba",
  "yumikiba",
  "akazonae",
  "sword_saint",
  "shinobi_head",
  "spear_commander",
  "bow_saint",
  "gun_commander",
  "iron_cavalry",
  "healing_master",
];
async function setup(width = 390, debug = true) {
  const c = await browser.newContext({
    viewport: { width, height: width < 700 ? 844 : 900 },
    isMobile: width < 700,
    hasTouch: width < 700,
  });
  await c.addInitScript((jobs) => {
    window.__raf = requestAnimationFrame;
    requestAnimationFrame = (f) => {
      window.__frame = f;
      return 0;
    };
    if (sessionStorage.getItem("seed")) return;
    sessionStorage.setItem("seed", "1");
    localStorage.setItem(
      "worldDefense.soldiers.v1",
      JSON.stringify({
        seq: 2,
        squadSeq: 1,
        squads: [{ id: 1, type: "ashigaru", slot: 0 }],
        soldiers: [1, 2].map((id) => ({
          id,
          type: "ashigaru",
          squadId: 1,
          level: 200,
          bestLevel: 200,
          job: "ashigaru",
          jobs: ["ashigaru"],
          prof: Object.fromEntries(jobs.map((j) => [j, 12375])),
          skills: [],
          learned: [],
          insight: { seed: id, evaluatedMaxLevel: 200, known: ["in_ashigaru", "in_medic"], equipped: [] },
        })),
        fallen: [],
      }),
    );
    localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({forge:{jobBooks:Object.fromEntries(jobs.slice(6).map(j=>[j,100]))}}));
    localStorage.setItem("worldDefense.settings.v1", JSON.stringify({ auto: false, waveGoal: 1000 }));
  }, jobs);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:" + server.address().port + "/" + (debug ? "?debug" : ""));
  return { p, c };
}
try {
  const { p, c } = await setup();
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      a = D.insightApi;
    return {
      jobs: Object.keys(D.jobApi.JOBS).length,
      actions: Object.keys(a.JOB_ACTIONS).length,
      insight: Object.keys(a.INSIGHT_SKILLS).length,
      old: s.learned,
    };
  });
  check(
    r.jobs === 21 && r.actions === 21 && r.insight === 30,
    "基本6・上級8・最上級7と42段階の職業技・職業21＋戦歴8の閃き技を定義",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      res = [];
    for (const j of Object.keys(D.insightApi.EVOLUTION_JOBS)) {
      s.level = 99;
      res.push(!!D.jobApi.jobChangeError(s, j));
      s.level = 200;
      res.push(D.jobApi.changeJob(s, j) === null);
      res.push(D.jobApi.jobOf(s) === j);
    }
    return res;
  });
  check(r.every(Boolean), "最上級7職はLv99で拒否し必要熟練・職業の書・Lv100以上で進化できる");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    D.jobApi.changeJob(s, "ashigaru");
    s.jobs = s.jobs.filter((j) => j !== "sword_saint");
    s.prof.samurai = 0;
    return D.jobApi.jobChangeError(s, "sword_saint");
  });
  check(/侍熟練8/.test(r), "進化に不足する熟練度を具体的に表示");
  const results = await p.evaluate((jobs) => {
    const D = WD_DEBUG,
      api = D.insightApi,
      s = D.state().soldiers[0],
      ally = D.state().soldiers[1],
      q = D.state().squads[0];
    q.state = "deployed";
    q.x = 600;
    q.y = 300;
    const out = [];
    for (const j of jobs)
      for (const stage of [0, 1]) {
        Object.assign(s, {
          job: j,
          type: D.jobApi.JOBS[j].base,
          level: 200,
          prof: { [j]: D.jobApi.profNeed(j, stage ? 8 : D.jobApi.JOBS[j].advanced ? 3 : 2) },
          insight: { ...s.insight, equipped: [] },
          evolution: null,
          evolutionShield: null,
          evolutionGuard: null,
        });
        s.hp = D.squadApi.soldierStats(s).maxHp * 0.2;
        ally.hp = D.squadApi.soldierStats(ally).maxHp * 0.2;
        ally.evolutionShield = null;
        D.state().enemies.length = 0;
        const es = [0, 1, 2].map((i) => {
          const e = D.addEnemy({ kind: "goblin" });
          Object.assign(e, {
            x: 612 + i * 8,
            y: 300,
            d: 500 - i * 10,
            hp: 1e5,
            max: 5e5,
            armor: 0,
            blockedBy: q,
            unitCd: 0,
          });
          return e;
        });
        const st = api.evolutionState(s);
        Object.assign(st, {
          hurt: true,
          target: es[0],
          hits: 3,
          targetSince: -10,
          killed: true,
          killedAt: -1,
          rangedEnemy: es[0],
        });
        D.legendApi.effects().length = 0;
        const before = es.map((e) => e.hp);
        api.defenseEvolution(
          s,
          q,
          D.jobApi.unitOf(s).heal ? ally : es[0],
          D.jobApi.unitOf(s).heal ? "heal" : "attack",
        );
        const ready = st.ready["job:" + j];
        const after = es.map((e) => e.hp);
        const healed = ally.hp > D.squadApi.soldierStats(ally).maxHp * 0.2,
          shield = !!(s.evolutionShield?.amount || ally.evolutionShield?.amount);
        api.defenseEvolution(
          s,
          q,
          D.jobApi.unitOf(s).heal ? ally : es[0],
          D.jobApi.unitOf(s).heal ? "heal" : "attack",
        );
        out.push({
          j,
          stage,
          selected: api.jobActionStage(s),
          cast: ready > 0,
          effect: D.legendApi.effects().some((e) => e.kind === "evolution"),
          real: after.some((hp, i) => hp < before[i]) || healed || shield,
          noDouble: es.every((e, i) => e.hp === after[i]),
        });
      }
    return out;
  }, jobs);
  for (const x of results)
    check(
      x.selected === x.stage && x.cast && x.effect && x.real && x.noDouble,
      `${x.j}：${x.stage ? "上位" : "通常"}技が発動し実効果・演出・待ち時間を持つ`,
    );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      q = D.state().squads[0],
      e = D.state().enemies[0];
    Object.assign(s, {
      job: "ashigaru",
      type: "ashigaru",
      level: 200,
      prof: { ashigaru: 8250 },
      insight: { ...s.insight, equipped: [] },
      evolution: null,
    });
    e.hp = 1e5;
    e.armor = 0;
    e.x = q.x + 12;
    e.y = q.y;
    const A = D.squadApi.soldierStats(s).atk;
    D.insightApi.defenseEvolution(s, q, e);
    return { A, damage: 1e5 - e.hp };
  });
  check(
    Math.abs(r.damage - r.A * 0.3) < 1e-6,
    "足軽上位技の追加部分は基準攻撃の30%・既存の初撃倍率を再適用しない",
  );
  const flashes = await p.evaluate((jobs) => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0],
      ally = D.state().soldiers[1],
      q = D.state().squads[0],
      out = [];
    for (const j of jobs) {
      const id = "in_" + j;
      Object.assign(s, {
        job: j,
        type: D.jobApi.JOBS[j].base,
        level: 200,
        prof: {},
        insight: { ...s.insight, known: [id], equipped: [id] },
        evolution: null,
        evolutionShield: null,
      });
      s.hp = D.squadApi.soldierStats(s).maxHp * 0.2;
      ally.hp = D.squadApi.soldierStats(ally).maxHp * 0.2;
      ally.evolutionShield = null;
      D.state().enemies.length = 0;
      const es = [0, 1, 2].map((i) => {
        const e = D.addEnemy({ kind: "goblin" });
        Object.assign(e, {
          x: 612 + i * 8,
          y: 300,
          d: 500 - i * 10,
          hp: 1e5,
          max: 5e5,
          armor: 12,
          blockedBy: q,
          unitCd: 0,
        });
        return e;
      });
      const st = D.insightApi.evolutionState(s);
      Object.assign(st, {
        hurt: true,
        target: es[0],
        hits: 3,
        targetSince: -10,
        killed: true,
        killedAt: -1,
        rangedEnemy: es[0],
      });
      D.legendApi.effects().length = 0;
      D.insightApi.defenseEvolution(
        s,
        q,
        D.jobApi.unitOf(s).heal ? ally : es[0],
        D.jobApi.unitOf(s).heal ? "heal" : "attack",
      );
      out.push({ j, cast: st.ready[id] > 0, fx: D.legendApi.effects().some((e) => e.insight) });
    }
    return out;
  }, jobs);
  for (const x of flashes) check(x.cast && x.fx, x.j + "：閃き技が適性・条件を満たすと自動発動");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    s.insight.known = ["in_ashigaru", "in_medic"];
    s.insight.equipped = [];
    s.prof = {};
    D.jobApi.changeJob(s, "ashigaru");
    const err = D.squadApi.startBattle("okazaki");
    const B = D.squadApi.battle(),
      g = B.groups[0];
    g.state = "fight";
    g.x = 600;
    g.y = 300;
    const e = B.garrison[0];
    Object.assign(e, { x: 612, y: 300, hp: 1e6, armor: 0 });
    s.prof = { ashigaru: 8250 };
    s.evolution = null;
    const st = D.squadApi.battleStats(g, s),
      hp = e.hp;
    D.insightApi.battleEvolution(s, g, e, null, st);
    return { err, damage: hp - e.hp, A: st.atk };
  });
  check(
    r.err === null && Math.abs(r.damage - r.A * 0.3) < 1e-6,
    "攻城戦の実アダプタでも同じ足軽上位技の30%追加ダメージ",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      B = D.squadApi.battle(),
      g = B.groups[0],
      s = g.list[0];
    s.job = "medic";
    s.type = "medic";
    s.prof = { medic: 8250 };
    s.evolution = null;
    const ally = g.list[1],
      st = D.squadApi.battleStats(g, s);
    ally.hp = 10;
    B.soulEat = true;
    D.insightApi.battleEvolution(s, g, ally, null, st, "heal", 0.1);
    return { hp: ally.hp, shield: ally.evolutionShield?.amount || 0 };
  });
  check(r.hp === 10, "魂喰い中は新しい治療技でもHPを回復しない");
  const siegeCases = await p.evaluate((jobs) => {
    const D = WD_DEBUG,
      B = D.squadApi.battle(),
      g = B.groups[0],
      s = g.list[0],
      ally = g.list[1],
      out = [];
    B.soulEat = false;
    g.state = "fight";
    g.x = 600;
    g.y = 300;
    for (const j of jobs)
      for (const variant of [0, 1, 2]) {
        const id = "in_" + j;
        Object.assign(s, {
          job: j,
          type: D.jobApi.JOBS[j].base,
          level: 200,
          prof: { [j]: D.jobApi.profNeed(j, variant === 1 ? 8 : D.jobApi.JOBS[j].advanced ? 3 : 2) },
          insight: { ...s.insight, known: [id], equipped: variant === 2 ? [id] : [] },
          evolution: null,
          evolutionShield: null,
          evolutionGuard: null,
        });
        s.hp = D.squadApi.battleStats(g, s).maxHp * 0.2;
        ally.hp = D.squadApi.battleStats(g, ally).maxHp * 0.2;
        ally.evolutionShield = null;
        const es = [0, 1, 2].map((i) => ({
          kind: "goblin",
          x: 612 + i * 8,
          y: 300,
          d: 500 - i * 10,
          hp: 1e6,
          max: 5e6,
          armor: 12,
          reward: 10,
          cd: 0,
        }));
        B.garrison = es;
        const state = D.insightApi.evolutionState(s);
        Object.assign(state, {
          hurt: true,
          target: es[0],
          hits: 3,
          targetSince: -10,
          killed: true,
          killedAt: -1,
          rangedEnemy: es[0],
        });
        const st = D.squadApi.battleStats(g, s);
        D.legendApi.effects().length = 0;
        D.insightApi.battleEvolution(
          s,
          g,
          D.jobApi.unitOf(s).heal ? ally : es[0],
          null,
          st,
          D.jobApi.unitOf(s).heal ? "heal" : "attack",
        );
        out.push({
          j,
          variant,
          cast: state.ready[variant === 2 ? id : "job:" + j] > B.t,
          fx: D.legendApi.effects().some((e) => e.kind === "evolution"),
        });
      }
    return out;
  }, jobs);
  for (const x of siegeCases)
    check(x.cast && x.fx, x.j + "：攻城アダプタで" + ["通常", "上位", "閃き"][x.variant] + "が発動");
  r = await p.evaluate(() => {
    const D = WD_DEBUG;
    D.squadApi.retreatBattle();
    const s = D.state().soldiers[0],
      ally = D.state().soldiers[1],
      q = D.state().squads[0];
    Object.assign(s, {
      job: "ashigaru",
      type: "ashigaru",
      level: 200,
      prof: { ashigaru: 8250 },
      insight: { ...s.insight, equipped: [] },
      evolution: null,
      cd: 0,
    });
    q.state = "deployed";
    D.state().enemies.length = 0;
    const e = D.addEnemy({ kind: "goblin", d: 500, hp: 1e6 });
    e.hp = e.max = 1e6;
    e.speed = 0;
    q.x = e.x + 10;
    q.y = e.y;
    document.getElementById("start").click();
    D.step(0.1);
    const attack = !!s.evolution?.ready["job:ashigaru"];
    Object.assign(s, { job: "medic", type: "medic", prof: { medic: 8250 }, evolution: null, cd: 0 });
    ally.hp = 10;
    const old = ally.hp;
    D.step(0.1);
    return { attack, heal: s.evolution?.ready["job:medic"] > 0, healed: ally.hp > old };
  });
  check(r.attack && r.heal && r.healed, "通常防衛の実tickから近接職業技・治療技を自動発動");

  await p.evaluate(() => {
    const D = WD_DEBUG;
    const kinds = [
        ...Object.values(D.insightApi.JOB_ACTIONS).map((k) => k.fx),
        ...Object.values(D.insightApi.INSIGHT_FX),
      ],
      effects = D.legendApi.effects();
    effects.length = 0;
    for (const [i, fx] of kinds.entries())
      effects.push({
        kind: "evolution",
        x: 100 + (i % 7) * 110,
        y: 90 + Math.floor(i / 7) * 80,
        points: [{ x: 125 + (i % 7) * 110, y: 105 + Math.floor(i / 7) * 80 }],
        fx,
        variant: i % 3,
        insight: i % 2 === 0,
        age: 0.1,
        duration: 0.55,
      });
    __raf.call(window, __frame);
  });
  await p.waitForTimeout(150);
  if (process.env.SCREENSHOTS)
    await p.screenshot({ path: process.env.SCREENSHOTS + "/evolution-effects.png" });
  check(errors.length === 0, "42種類の職業・閃きの軌跡を実Canvasで描画して例外なし");
  await c.close();
  for (const width of [375, 390, 430, 1280]) {
    const { p, c } = await setup(width, false);
    await p.locator("#organize").click();
    await p.locator('[data-formation-soldier="1"]').click();
    check(
      (await p.locator(".insight-box").isVisible()) &&
        /職業固有技/.test(await p.locator("#soldierList").innerText()),
      "通常URLで職業技と独立した閃き欄を表示：" + width,
    );
    await p.locator('[data-job-open="1"]').click();
    check((await p.locator(".job-card").count()) === 21, "転職画面に21職を表示：" + width);
    await p.locator('[data-job-detail="sword_saint"]').click();
    check(
      /侍熟練8/.test(await p.locator("#jobBody").innerText()) &&
        (await p.locator('[data-job-to="sword_saint"]').isEnabled()),
      "進化条件を表示し条件達成時に転職可能：" + width,
    );
    check(
      await p.evaluate(() => {
        const a = document.getElementById("jobSheet");
        return a.scrollWidth <= a.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
      }),
      "画面の横はみ出しなし：" + width,
    );
    await p.locator('[data-job-to="sword_saint"]').click();
    check(
      (await p.locator('[data-job="sword_saint"].cur').count()) === 1,
      "通常URLの転職ボタンで剣聖へ進化：" + width,
    );
    if (process.env.SCREENSHOTS) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/evolution-" + width + ".png" });
    }
    await c.close();
  }
  check(errors.length === 0, "ブラウザのJavaScriptエラーなし：" + errors.join(";"));
  console.log(`\n${n} passed, 0 failed`);
} finally {
  await browser.close();
  server.close();
}
