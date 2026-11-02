// 自動奥義のテスト用：固定した兵士・戦場を用意する。
export const autoSeed = () => ({
  seq: 3,
  squadSeq: 1,
  squads: [{ id: 1, type: "ashigaru", slot: 0 }],
  soldiers: [1, 2, 3].map((id) => ({
    id,
    type: "ashigaru",
    job: "sword_saint",
    jobs: ["ashigaru", "samurai", "kensei", "sword_saint"],
    prof: { sword_saint: 1e7 },
    squadId: 1,
    level: 200,
    bestLevel: 200,
    name: "剣聖" + id,
    skills: [],
    learned: [],
    chronicle: { version: 1, life: "soldier:auto-" + id },
  })),
  fallen: [],
});
export async function beginAutoFight(p, mode = "defense", k = "mumyouIssen") {
  return p.evaluate(
    ({ mode, k }) => {
      const D = WD_DEBUG,
        Q = D.squadApi,
        A = D.autoOugiApi,
        K = D.combat.ougi;
      K.grant(1, k);
      Q.saveRoster();
      A.setRoll(() => 0);
      let err = null,
        e;
      if (mode === "battle" || mode === "secret") {
        Q.refreshSiege();
        err = mode === "secret" ? Q.setBossTarget("orochi") : Q.setTarget(Q.PROVINCES.owari.castle);
        if (!err) err = Q.startBattle();
        if (err) return { err };
        const B = Q.battle(),
          g = B.groups[0];
        g.state = "fight";
        g.d = 500;
        Object.assign(g, D.pathAt(g.path, g.d));
        e = B.garrison[0];
        Object.assign(e, { x: g.x + 80, y: g.y, hp: 1e9, max: 1e9, dead: false });
      } else if (["explore", "survival", "field"].includes(mode)) {
        err = D.trial.start([1, 2, 3], { mode, hero: 1, seed: 4242 });
        if (err) return { err };
        if (mode === "field") {
          D.trial.auto();
          D.trial.begin();
        }
        const T = D.trial.live(),
          h = T.units[0];
        e = {
          x: h.x + 80,
          y: h.y,
          hp: 1e9,
          max: 1e9,
          r: 12,
          kind: "goblin",
          gone: false,
          def: 0,
          armor: 0,
          hit: 0,
          slow: 0,
          stun: 0,
        };
        T.enemies = [e];
      } else {
        if (mode.startsWith("training")) {
          D.combat.pick(mode === "training-proto");
          err = D.trainingApi.startTraining("beginner");
        }
        const q = D.state().squads[0];
        Q.deployReserve(q, 620, 300);
        document.getElementById("start").click();
        D.stopSpawning();
        D.addEnemy({ hp: 1e9, d: 0, speed: 0, unitCd: 1e9, holder: true });
        e = D.state().enemies.at(-1);
        Object.assign(e, { x: q.x + 80, y: q.y, hp: 1e9, max: 1e9 });
      }
      window.autoTestEnemy = e;
      window.autoTestMode =
        mode === "battle" || mode === "secret"
          ? "battle"
          : ["explore", "survival", "field"].includes(mode)
            ? "trial"
            : "defense";
      for (const s of D.state().soldiers) s.cd = 1e9;
      return {
        err,
        choice: A.choice(D.state().soldiers[0]),
        ready: !!A.context(window.autoTestMode)?.actors.length,
      };
    },
    { mode, k },
  );
}
