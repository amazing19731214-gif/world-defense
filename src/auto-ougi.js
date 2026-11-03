// 自動奥義：時計は兵士の一生ごと。戦場の写し・WAVE・モードを切り替えても再抽選しない。
const AUTO_OUGI_RULES = Object.freeze({ interval: 60, rate: 0.3, saveEvery: 5, fxGap: 0.9 });
function cleanAutoOugi(value) {
  const o = value && typeof value === "object" ? value : {},
    picks = {},
    timers = {};
  const lifeOk = (life) => typeof life === "string" && /^[\w:-]{1,100}$/.test(life);
  for (const [life, p] of Object.entries(o.picks || {}).slice(0, 1024)) {
    if (!lifeOk(life) || !p || typeof p !== "object") continue;
    if (p.off) picks[life] = { off: true };
    else if (LEGEND_OUGI[p.k])
      picks[life] = { k: p.k, book: Number.isInteger(p.book) && p.book > 0 ? p.book : null };
  }
  for (const [life, t] of Object.entries(o.timers || {}).slice(0, 1024)) {
    if (!lifeOk(life) || !t || typeof t !== "object") continue;
    timers[life] = {
      left: Number.isFinite(t.left) ? Math.max(0, Math.min(60, t.left)) : 60,
      rolls: Number.isInteger(t.rolls) ? Math.max(0, Math.min(1e9, t.rolls)) : 0,
    };
  }
  return { version: 1, picks, timers };
}
function autoOugiChoice(s) {
  if (!s?.alive) return null;
  const life = ougiLife(s),
    pick = ougiSave.auto.picks[life];
  if (pick?.off) return null;
  const p = pick ||
    (ougiSave.heir?.sid === s.id ? ougiSave.heir : null) || {
      k: ougiKnownOf(s).find((k) => LEGEND_OUGI[k].job === jobOf(s)),
      book: null,
    };
  if (!LEGEND_OUGI[p.k] || jobOf(s) !== LEGEND_OUGI[p.k].job) return null;
  if (p.book != null ? ougiBook(p.book)?.k !== p.k : !ougiKnownOf(s).includes(p.k)) return null;
  return { k: p.k, book: p.book ?? null };
}
function autoOugiBookOwner(uid) {
  return (
    soldiers.find(
      (s) =>
        s.alive &&
        (ougiSave.auto.picks[ougiLife(s)]?.book === uid ||
          (!Object.hasOwn(ougiSave.auto.picks, ougiLife(s)) &&
            ougiSave.heir?.sid === s.id &&
            ougiSave.heir.book === uid)),
    ) || null
  );
}
function autoOugiTimer(s) {
  const life = ougiLife(s);
  return (ougiSave.auto.timers[life] ||= { left: 60, rolls: 0 });
}
let autoOugiQueue = [],
  autoOugiFlurries = [],
  autoOugiContext = null,
  autoOugiGap = 0,
  autoOugiDirty = false,
  autoOugiSaveClock = 0,
  autoOugiRetry = 0,
  autoOugiWarned = false,
  autoOugiRollOverride = null;
const autoOugiStats = { attempts: 0, casts: 0, hits: 0 };
const sameAutoOugiContext = (a, b) =>
  !!a && !!b && a.mode === b.mode && a.session === b.session && a.segment === b.segment;
function autoOugiContextFor(mode) {
  let actors = [],
    targets,
    session,
    segment,
    hit;
  if (mode === "trial") {
    const T = trial;
    if (!T || T.phase !== "fight" || T.result || T.paused || T.choice || T.cleared) return null;
    session = T;
    segment = T.floor + ":" + (T.explore?.region || 0);
    actors = T.units
      .filter((u) => !u.dead && u.placed)
      .map((u) => ({
        s: u.src,
        pos: u,
        stats: () => soldierStats(u.sh, true),
        mul: () => (u.atkMul || 1) * (u.id === T.hero ? T.ougiMul || 1 : 1),
        valid: () => trial === T && !u.dead && u.src.alive,
        unit: u,
      }));
    targets = () => T.enemies.filter((e) => !e.gone && e.hp > 0);
    hit = (a, e, raw, pierce = 0) => {
      const before = !e.gone;
      // 発動側で一度掛けた試練の攻撃倍率を、通常の命中処理で二重に掛けない。
      trialHitEnemy(a.unit, e, raw / (a.unit.atkMul || 1), pierce, true);
      if (a.record) {
        a.record.hits++;
        if (before && e.gone) a.record.kills++;
      }
    };
  } else if (mode === "battle") {
    const B = battle;
    if (!B || B.result || paused) return null;
    session = B;
    segment = 0;
    actors = B.groups.filter(groupActive).flatMap((g) =>
      groupAlive(g).map((s) => ({
        s,
        pos: g,
        stats: () => battleStats(g, s),
        mul: () => 1,
        valid: () => battle === B && groupActive(g) && groupAlive(g).includes(s),
      })),
    );
    const structures = B.towers.map((t) => ({
      structure: true,
      tower: t,
      x: t.x,
      y: t.y,
      r: 25,
      get hp() {
        return t.destroyed ? 0 : t.hp;
      },
    }));
    if (!B.boss)
      structures.push({
        structure: true,
        x: SIEGE_BATTLE.castle.x,
        y: SIEGE_BATTLE.castle.y,
        r: 40,
        get hp() {
          return B.castleHp;
        },
      });
    targets = () => [...B.garrison.filter((e) => !e.dead && e.hp > 0), ...structures.filter((e) => e.hp > 0)];
    hit = (a, e, raw, pierce = 0) => {
      if (e.structure) {
        if (e.tower) battleHitTower(e.tower, raw);
        else B.castleHp = Math.max(0, B.castleHp - raw);
        return;
      }
      if (battleHitGarrison(e, raw, a.s, pierce)) {
        a.s.kills++;
        gearOnKill(a.s, a.stats(), B.t);
        jobOnKill(a.s, B.t);
        gainXp(a.s, SQUAD_RULES.xpPerKill + Math.round((e.reward || 0) / 2));
      }
    };
  } else {
    if (!playing || paused || over || battle || trial) return null;
    session = training || runId;
    segment = wave;
    actors = squads
      .filter((q) => q.state === "deployed")
      .flatMap((q) =>
        members(q)
          .filter((s) => s.alive && !s.out && !s.heroFell)
          .map((s) => ({
            s,
            pos: q,
            stats: () => soldierStats(s),
            mul: () => 1,
            valid: () => playing && q.state === "deployed" && s.alive && !s.out && !s.heroFell,
          })),
      );
    targets = aliveEnemies;
    hit = (a, e, raw, pierce = 0) =>
      dealEnemyDamage(
        e,
        raw,
        { s: a.s, q: a.pos, h: heroOnSquad(a.pos) },
        {
          normal: false,
          pierceCover: true,
          ignoreArmor: Math.min(0.8, skillSum(a.s, "armorPierce") + pierce),
        },
      );
  }
  return {
    mode,
    session,
    segment,
    now: mode === "trial" ? trial.t : mode === "battle" ? battle.t : combatClock,
    friends: actors,
    actors: actors.filter((a) => autoOugiChoice(a.s)),
    targets,
    hit,
  };
}
function autoOugiAim(ctx, a, k) {
  if (LEGEND_OUGI[k].kind === "ultimate") return ultimateOugiAim(ctx, a, k);
  const O = LEGEND_OUGI[k],
    list = ctx.targets(),
    origin = { x: a.pos.x, y: a.pos.y - 18 };
  const distance = (e) => Math.hypot(e.x - a.pos.x, e.y - a.pos.y);
  if (O.kind === "pattern") {
    const near = list
      .slice()
      .sort(
        (a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y),
      )[0];
    if (!near) return null;
    const rays = resolvePattern(
      origin,
      Math.atan2(near.y - origin.y, near.x - origin.x),
      ATTACK_PATTERNS[O.pattern],
      list,
    );
    return rays.some((r) => r.hits.length) ? { origin, rays } : null;
  }
  const candidates = list.filter((e) => distance(e) <= (O.reach || O.radius));
  const rank = (e) =>
    (e.boss || e.kind === "boss" || e.role === "boss" ? 2e12 : e.role === "mid" ? 1e12 : 0) + e.hp;
  candidates.sort((a, b) => (O.kind === "single" ? rank(b) - rank(a) : distance(a) - distance(b)));
  return candidates.length ? { origin, target: candidates[0] } : null;
}
function autoOugiCast(ctx, a, k, aim) {
  const O = LEGEND_OUGI[k],
    atk = a.stats().atk * a.mul();
  autoOugiStats.casts++;
  combatFx.ougi("奥義・" + O.name, "⚔ " + soldierName(a.s));
  if (ctx.mode === "trial") {
    trialSfx("ougi");
    a.record = { key: k, at: trial.t, hits: 0, kills: 0 };
    trial.ougiUsed = a.record;
  }
  if (O.kind === "ultimate") {
    ultimateOugiCast(ctx, a, k, aim);
  } else if (O.kind === "pattern") {
    const P = ATTACK_PATTERNS[O.pattern];
    for (const r of aim.rays)
      for (const e of r.hits)
        if (e.hp > 0) {
          ctx.hit(a, e, atk * P.mul);
          autoOugiStats.hits++;
        }
    combatFx.pattern(P, aim.origin, aim.rays);
  } else if (O.kind === "single") {
    ctx.hit(a, aim.target, atk * O.mul);
    autoOugiStats.hits++;
    combatFx.issen(aim.origin, aim.target);
  } else {
    autoOugiFlurries.push({ ctx, a, k, atk, left: O.hits, wait: 0 });
    combatFx.push({ kind: "cshock", x: a.pos.x, y: a.pos.y, ougi: true, age: 0, duration: 0.7 });
  }
}
function tickAutoOugiFlurries(ctx, dt) {
  autoOugiFlurries = autoOugiFlurries.filter(
    (F) => sameAutoOugiContext(F.ctx, ctx) && F.a.valid() && autoOugiChoice(F.a.s)?.k === F.k && F.left > 0,
  );
  for (const F of autoOugiFlurries) {
    F.wait -= dt;
    const O = LEGEND_OUGI[F.k];
    while (F.wait <= 1e-8 && F.left > 0) {
      F.wait += O.gap;
      F.left--;
      ctx
        .targets()
        .filter((e) => Math.hypot(e.x - F.a.pos.x, e.y - F.a.pos.y) <= O.radius)
        .sort(
          (a, b) =>
            Math.hypot(a.x - F.a.pos.x, a.y - F.a.pos.y) - Math.hypot(b.x - F.a.pos.x, b.y - F.a.pos.y),
        )
        .slice(0, O.perHit)
        .forEach((e) => {
          ctx.hit(F.a, e, F.atk * O.mul);
          autoOugiStats.hits++;
          combatFx.push({
            kind: "cslash",
            x: e.x,
            y: e.y - 14,
            a: Math.random() * Math.PI,
            ougi: true,
            age: 0,
            duration: 0.35,
          });
        });
      combatFx.push({
        kind: "cwave",
        x: F.a.pos.x,
        y: F.a.pos.y - 10,
        rays: [0, 1, 2, 3].map((k) => (k * Math.PI) / 2 + F.left * 0.4),
        len: O.radius,
        width: 30,
        ougi: true,
        age: 0,
        duration: 0.5,
      });
    }
  }
}
function tickAutoOugi(mode, dt) {
  if (!(dt > 0) || document.hidden || document.querySelector(".sheet-back:not([hidden])")) return;
  const ctx = autoOugiContextFor(mode);
  if (!ctx) return;
  if (!sameAutoOugiContext(autoOugiContext, ctx)) {
    autoOugiQueue = [];
    autoOugiFlurries = [];
    autoOugiGap = 0;
    autoOugiContext = ctx;
  }
  ultimateOugiTick(ctx, dt);
  tickAutoOugiFlurries(ctx, dt);
  autoOugiGap = Math.max(0, autoOugiGap - dt);
  autoOugiRetry = Math.max(0, autoOugiRetry - dt);
  const seen = new Set();
  for (const a of ctx.actors) {
    const life = ougiLife(a.s);
    if (seen.has(life)) continue;
    seen.add(life);
    const t = autoOugiTimer(a.s);
    t.left = Math.max(0, t.left - dt);
    autoOugiDirty = true;
    if (t.left <= 1e-8 && !autoOugiQueue.some((e) => e.life === life)) autoOugiQueue.push({ life });
  }
  autoOugiQueue = autoOugiQueue.filter((e) => seen.has(e.life));
  if (!autoOugiRetry && autoOugiGap <= 0) {
    const ready = autoOugiQueue.splice(0);
    for (const entry of ready) {
      if (autoOugiGap > 0) {
        autoOugiQueue.push(entry);
        continue;
      }
      const a = ctx.actors.find((a) => ougiLife(a.s) === entry.life),
        choice = a && autoOugiChoice(a.s),
        aim = choice && autoOugiAim(ctx, a, choice.k);
      if (!a?.valid() || !aim) continue; // 対象が来るまで、0秒で待つ。抽選しない。
      const t = autoOugiTimer(a.s),
        roll = autoOugiRollOverride
          ? autoOugiRollOverride(a.s, t.rolls)
          : insightHash(insightOf(a.s).seed + ":auto-ougi:" + t.rolls) / 4294967296;
      const ok = ougiCommit((S) => {
        const saved = S.auto.timers[entry.life];
        saved.left = 60;
        saved.rolls = Math.min(1e9, saved.rolls + 1);
      });
      if (!ok) {
        autoOugiRetry = 5;
        if (!autoOugiWarned) {
          mapToast("⚠ 奥義の抽選を保存できません。保存できるまで自動発動を待ちます。");
          autoOugiWarned = true;
        }
        break;
      }
      autoOugiWarned = false;
      autoOugiStats.attempts++;
      if (roll < AUTO_OUGI_RULES.rate) {
        autoOugiCast(ctx, a, choice.k, aim);
        autoOugiGap = AUTO_OUGI_RULES.fxGap;
      }
    }
  }
  autoOugiSaveClock += dt;
  if (autoOugiDirty && autoOugiSaveClock >= AUTO_OUGI_RULES.saveEvery) {
    autoOugiSaveClock = 0;
    if (persistOugi()) autoOugiDirty = false;
  }
}
function autoOugiPrune(lives, fallen) {
  for (const table of [ougiSave.auto.picks, ougiSave.auto.timers, ougiSave.claims])
    for (const life of Object.keys(table)) if (!lives.has(life) && !fallen.has(life)) delete table[life];
}
window.addEventListener("pagehide", () => {
  if (autoOugiDirty) persistOugi();
});
