// v80の確定済み定義との互換・死亡/復活・CD保存・80人の制御負荷と対照比較。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"),
  fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/v80-evolution-baseline.json", import.meta.url)));
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
async function setup() {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await c.addInitScript((jobs) => {
    requestAnimationFrame = () => 0;
    Math.random = () => 0.5;
    if (sessionStorage.getItem("seed")) return;
    sessionStorage.setItem("seed", "1");
    localStorage.setItem(
      "worldDefense.soldiers.v1",
      JSON.stringify({
        seq: 80,
        squadSeq: 8,
        squads: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, type: "ashigaru", slot: i })),
        soldiers: Array.from({ length: 80 }, (_, i) => ({
          id: i + 1,
          type: "ashigaru",
          squadId: Math.floor(i / 10) + 1,
          level: 100,
          bestLevel: 100,
          name: "兵" + (i + 1),
          job: "ashigaru",
          jobs: ["ashigaru"],
          prof: Object.fromEntries(jobs.map((j) => [j, 12375])),
          skills: [],
          learned: [],
          insight: { seed: i + 1, evaluatedMaxLevel: 100, known: ["in_ashigaru", "in_medic"], equipped: [] },
        })),
        fallen: [],
      }),
    );
    localStorage.setItem("worldDefense.settings.v1", JSON.stringify({ auto: false, waveGoal: 1000 }));
  }, Object.keys(fixture.jobs));
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:" + server.address().port + "/?debug");
  return { p, c };
}
try {
  {
    const { p, c } = await setup();
    const r = await p.evaluate(() =>
      JSON.parse(
        JSON.stringify({
          jobs: WD_DEBUG.jobApi.JOBS,
          skills: WD_DEBUG.squadApi.SOLDIER_SKILLS,
          legend: WD_DEBUG.legendApi.LEGEND,
          xpToLevel: Object.fromEntries(
            [1, 5, 10, 30, 100, 200, 500, 1000].map((l) => [l, WD_DEBUG.unitConfig.SQUAD_RULES.xpToLevel(l)]),
          ),
        }),
      ),
    );
    for (const [id, j] of Object.entries(fixture.jobs))
      check(JSON.stringify(r.jobs[id]) === JSON.stringify(j), "v80の職業定義を維持：" + id);
    check(
      JSON.stringify(r.skills) === JSON.stringify(fixture.skills),
      "既存56スキルのID・効果・習得条件をすべて維持",
    );
    check(JSON.stringify(r.legend) === JSON.stringify(fixture.legend), "伝説の確率・能力・4冊・上限を維持");
    check(JSON.stringify(r.xpToLevel) === JSON.stringify(fixture.xpToLevel), "既存の経験値曲線を維持");
    let v = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0],
        q = D.state().squads[0];
      D.squadApi.setHeroSoldier(s.id);
      D.squadApi.killSoldier(s, q);
      return { level: s.level, known: s.insight.known, trial: s.insight.evaluatedMaxLevel };
    });
    check(
      v.level === 1 && v.known.length === 2 && v.trial === 100,
      "主人公の死亡でも閃きと評価済み最高Lvを保持",
    );
    v = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[1],
        q = D.state().squads[0],
        seed = s.insight.seed;
      D.squadApi.killSoldier(s, q);
      D.gemApi.setGems({ jin: 1, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 });
      const made = D.gemApi.craftScroll("revive"),
        err = D.gemApi.reviveFallen(s.id, q);
      const born = D.state().soldiers.at(-1);
      return {
        made,
        err,
        known: born.insight.known,
        seed: born.insight.seed,
        oldSeed: seed,
        trial: born.insight.evaluatedMaxLevel,
      };
    });
    check(
      v.made === null && v.err === null && v.seed === v.oldSeed && v.known.length === 2 && v.trial === 100,
      "戦死の控えと復活の書で同じ閃き・seed・評価位置を引き継ぐ",
    );
    v = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers.find((s) => s.alive && s.level === 100),
        q = D.state().squads.find((q) => q.id === s.squadId);
      q.state = "deployed";
      const e = D.addEnemy({ kind: "goblin" });
      Object.assign(e, { x: q.x + 12, y: q.y, hp: 1e6, max: 1e6, armor: 0 });
      s.prof.ashigaru = 8250;
      s.evolution = null;
      D.insightApi.defenseEvolution(s, q, e);
      D.defenseApi.save();
      return { ready: s.evolution.ready["job:ashigaru"], id: s.id };
    });
    await p.reload();
    check(
      await p.evaluate(
        (v) =>
          WD_DEBUG.state().soldiers.find((s) => s.id === v.id).evolution.ready["job:ashigaru"] === v.ready,
        v,
      ),
      "防衛の職業技の待ち時間を途中保存と再読込で維持",
    );
    const cross = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers.find((s) => s.alive && s.level === 100);
      D.squadApi.startBattle();
      const B = D.squadApi.battle();
      B.t = 30;
      D.insightApi.evolutionShield(s, D.squadApi.soldierStats(s).maxHp, 0.1, B.t, 4);
      const had = !!s.evolutionShield;
      D.squadApi.retreatBattle();
      return { had, damage: D.insightApi.evolutionAbsorb(s, 10, false, null, 0), left: s.evolutionShield };
    });
    check(
      cross.had && cross.damage === 10 && cross.left === null,
      "攻城から防衛へ戻ると別時計の盾を持ち越さない",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const rows = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      Object.assign(s, {
        job: "healing_master",
        type: "medic",
        level: 200,
        prof: { healing_master: 8250 },
        skills: [],
        insight: {
          ...s.insight,
          known: ["in_medic", "in_healing_master"],
          equipped: ["in_medic", "in_healing_master"],
        },
      });
      const q = { x: 600, y: 300 },
        friends = D.state()
          .soldiers.slice(1, 4)
          .map((m) => ({ s: m, team: 1, x: 600, y: 300, max: D.squadApi.soldierStats(m).maxHp })),
        st = D.squadApi.soldierStats(s),
        rows = [];
      for (const enabled of [false, true]) {
        D.insightApi.setEffectsEnabled(enabled);
        s.evolution = null;
        let base = 0,
          extra = 0;
        const ctx = {
          pos: q,
          team: 1,
          friends,
          enemies: [],
          stats: st,
          blocked: () => false,
          hit: () => 0,
          heal: (m, amount) => {
            const old = m.s.hp;
            m.s.hp = Math.min(m.max, m.s.hp + amount);
            return m.s.hp - old;
          },
        };
        for (let t = 0; t < 200; t += st.rate) {
          for (const m of friends) {
            m.s.hp = m.max * 0.05;
            m.s.evolutionShield = null;
          }
          const m = friends[0];
          m.beforeRatio = 0.05;
          const h = Math.min(st.heal, m.max - m.s.hp);
          m.s.hp += h;
          base += h;
          const before = friends.reduce((v, m) => v + m.s.hp, 0);
          ctx.now = t;
          ctx.target = m;
          D.insightApi.evolutionAction(s, ctx, "heal");
          extra += friends.reduce((v, m) => v + m.s.hp, 0) - before;
        }
        rows.push({ enabled, base, extra, ratio: (base + extra) / base });
      }
      return rows;
    });
    console.log("治療の制御測定 " + JSON.stringify(rows));
    check(
      rows[1].ratio <= 1.25 && rows[1].ratio > 1,
      "医王の上位技・閃き2枠の追加回復量を通常治療の25%以内へ調整",
    );
    await c.close();
  }

  const samples = [];
  for (const enabled of [false, true]) {
    const { p, c } = await setup();
    const r = await p.evaluate(
      ({ enabled, jobs }) => {
        const D = WD_DEBUG;
        D.insightApi.setEffectsEnabled(enabled);
        const S = D.state();
        S.soldiers.forEach((s, i) => {
          const j = jobs[i % jobs.length];
          s.job = j;
          s.type = D.jobApi.JOBS[j].base;
          s.skills = Object.entries(D.squadApi.SOLDIER_SKILLS)
            .filter(([id, k]) => k.job)
            .map(([id]) => id);
          s.learned = s.skills.slice();
          s.insight.known = Object.keys(D.insightApi.INSIGHT_SKILLS);
          s.insight.equipped = ["in_ashigaru", "in_kensei"];
          s.hp = D.squadApi.soldierStats(s).maxHp * 0.3;
        });
        S.enemies.length = 0;
        const es = Array.from({ length: 40 }, (_, i) => {
          const e = D.addEnemy({ kind: "goblin", d: 500 + (i % 4) });
          e.hp = 2e11;
          e.max = 1e12;
          e.speed = 0;
          e.atkMul = 0.001;
          return e;
        });
        S.squads.forEach((q, i) => {
          q.state = "deployed";
          q.x = es[0].x + 10 + i * 3;
          q.y = es[0].y + (i % 2) * 8;
        });
        S.towers.push(
          ...Array.from({ length: 6 }, (_, i) => ({
            id: 100 + i,
            type: ["arrow", "cannon", "magic", "ice"][i % 4],
            x: es[0].x + 30 + i * 5,
            y: es[0].y - 30,
            level: 1,
            spent: 100,
            hp: 250,
            cd: 0,
          })),
        );
        document.getElementById("start").click();
        D.stopSpawning();
        const before = es.reduce((v, e) => v + e.hp, 0),
          t = performance.now();
        D.step(10);
        const ms = performance.now() - t,
          after = es.reduce((v, e) => v + Math.max(0, e.hp), 0);
        D.heroApi.draw();
        return {
          enabled,
          ms,
          damage: before - after,
          alive: S.soldiers.filter((s) => s.alive).length,
          finite: S.soldiers.every((s) => Number.isFinite(s.hp)),
          effects: D.legendApi.effects().filter((e) => e.kind === "evolution").length,
          allEffects: D.legendApi.effects().length,
        };
      },
      { enabled, jobs: Object.keys(fixture.jobs) },
    );
    check(r.ms < 10000 && r.alive === 80 && r.finite, "80兵士・6塔・40敵の制御測定：" + JSON.stringify(r));
    check(
      r.effects <= 24 && r.allEffects <= 80,
      "戦闘中の描画上限を維持：" + (enabled ? "新効果あり" : "対照"),
    );
    samples.push(r);
    if (enabled && process.env.SCREENSHOTS) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/evolution-80-soldiers.png" });
    }
    await c.close();
  }
  const ratio = samples[1].damage / samples[0].damage;
  check(
    ratio >= 1 && ratio < 1.25,
    "同一条件で新技が旧能力を弱めず極端な全軍火力増加を起こさない：倍率" + ratio.toFixed(3),
  );
  console.log("制御測定 " + JSON.stringify({ samples, damageRatio: ratio }));
  if (process.env.REPORT)
    fs.writeFileSync(process.env.REPORT, JSON.stringify({ samples, damageRatio: ratio }, null, 2));
  check(errors.length === 0, "JavaScriptエラーなし：" + errors.join(";"));
  console.log(`\n${n} passed, 0 failed`);
} finally {
  await browser.close();
  server.close();
}
