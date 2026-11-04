function cleanUltimateOugiClaims(value) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {}).filter(
      ([life, k]) => /^[\w:-]{1,100}$/.test(life) && typeof k === "string" && k.length <= 300,
    ),
  );
}
// 最上級職6種の奥義。戦歴は兵士保存、閃き結果と抽選済みの印は既存の奥義保存へ。
const ULTIMATE_OUGI_RULES = Object.freeze({
  healed: 50000,
  rescues: 10,
  control: 10,
  block: 10,
  guard: 10,
  bosses: 10,
});
const ULTIMATE_OUGI_JOBS = Object.freeze([
  "shinobi_head",
  "spear_commander",
  "bow_saint",
  "gun_commander",
  "iron_cavalry",
  "healing_master",
]);
const ULTIMATE_OUGI_COUNTERS = Object.freeze([
  "ougiRescues",
  "ougiControlKills",
  "ougiBlockWins",
  "ougiGuardWins",
  "ougiBossContrib",
]);
function ultimateOugiMembers() {
  if (trial) return trial.units.filter((u) => u.placed).map((u) => u.sh);
  if (battle)
    return battle.groups.filter((g) => g.state !== "wait" && g.state !== "empty").flatMap((g) => g.list);
  return soldiers.filter((s) => s.inWave);
}
function ultimateOugiSegment(s) {
  const seg = chronicleTouch(s);
  return (seg.ougi ||= {
    active: false,
    healed: 0,
    blocked: false,
    guarded: false,
    rescuers: [],
    done: false,
    rollJob: null,
  });
}
function ultimateOugiHeal(s, target, before, max) {
  const amount = Math.max(0, Math.min(max, target.hp) - Math.max(0, before));
  if (!amount || !s?.alive || !target?.alive) return;
  const seg = ultimateOugiSegment(s);
  seg.active = true;
  seg.healed += amount;
  if (before <= max * 0.3 && s !== target) {
    const to = ultimateOugiSegment(target),
      life = ougiLife(s);
    if (!to.rescuers.includes(life) && to.rescuers.length < 80) to.rescuers.push(life);
  }
}
function ultimateOugiActivity(s, c, event) {
  if (event !== "attack" || !c.target) return;
  const seg = ultimateOugiSegment(s);
  seg.active = true;
  if (jobOf(s) === "spear_commander" && c.blocked(c.target)) seg.blocked = true;
}
function ultimateOugiControl(s, e) {
  if (!s || !["ninja", "shinobi_head"].includes(jobOf(s))) return;
  ultimateOugiSegment(s).active = true;
  const key = chronicleKey(),
    life = ougiLife(s);
  if (e._ougiControlKey !== key) {
    e._ougiControlKey = key;
    e._ougiControllers = [];
  }
  if (!e._ougiControllers.includes(life)) e._ougiControllers.push(life);
}
function ultimateOugiKill(s, e) {
  const list = ultimateOugiMembers(),
    key = chronicleKey();
  if (e._ougiControlKey === key)
    for (const m of list)
      if (m.alive && !m.heroFell && e._ougiControllers.includes(ougiLife(m)))
        chronicleAdd(chronicleOf(m), "ougiControlKills");
  if (e.boss || e.intruder || e.kind === "boss" || e.role === "boss" || e.role === "mid")
    for (const m of list)
      if (
        m.alive &&
        !m.heroFell &&
        (m === s || (m.chronicle?.segment?.key === key && m.chronicle.segment.ougi?.active))
      )
        chronicleAdd(chronicleOf(m), "ougiBossContrib");
}
function ultimateOugiProtected(life, target) {
  if (!life || ougiLife(target) === life) return;
  const source = ultimateOugiMembers().find((s) => s.alive && !s.heroFell && ougiLife(s) === life);
  if (source) {
    const seg = ultimateOugiSegment(source);
    seg.guarded = true;
    seg.active = true;
  }
}
function ultimateOugiFinish(list, win) {
  const key = chronicleKey(),
    live = list.filter(
      (s) =>
        s.alive && !s.heroFell && s.hp > 0 && s.chronicle?.segment?.key === key && !s.chronicle.segment.dead,
    );
  for (const target of live) {
    const seg = target.chronicle.segment.ougi;
    if (!win || !seg || seg.done) continue;
    for (const life of seg.rescuers) {
      const healer = live.find((s) => ougiLife(s) === life);
      if (healer) chronicleAdd(chronicleOf(healer), "ougiRescues");
    }
  }
  for (const s of list) {
    const seg = s.chronicle?.segment;
    if (!seg || seg.key !== key) continue;
    const o = seg.ougi;
    if (!o || o.done) continue;
    o.done = true;
    if (!win || !live.includes(s)) continue;
    if (o.blocked) chronicleAdd(chronicleOf(s), "ougiBlockWins");
    if (o.guarded) chronicleAdd(chronicleOf(s), "ougiGuardWins");
    if (o.active && ULTIMATE_OUGI_JOBS.includes(jobOf(s))) o.rollJob = jobOf(s);
  }
}
function ultimateOugiEligible(s) {
  const c = chronicleOf(s),
    j = jobOf(s);
  if (j === "healing_master")
    return c.healed >= ULTIMATE_OUGI_RULES.healed && c.ougiRescues >= ULTIMATE_OUGI_RULES.rescues;
  if (j === "shinobi_head") return c.ougiControlKills >= ULTIMATE_OUGI_RULES.control;
  if (j === "spear_commander") return c.ougiBlockWins >= ULTIMATE_OUGI_RULES.block;
  if (j === "iron_cavalry") return Math.max(c.coverWins, c.ougiGuardWins) >= ULTIMATE_OUGI_RULES.guard;
  return (
    ["bow_saint", "gun_commander"].includes(j) &&
    Math.max(c.bossKills + c.bossAssists, c.ougiBossContrib) >= ULTIMATE_OUGI_RULES.bosses
  );
}
let ultimateOugiFlushQueued = false,
  ultimateOugiRetryTimer = null;
function scheduleUltimateOugiRolls() {
  if (ultimateOugiFlushQueued) return;
  ultimateOugiFlushQueued = true;
  queueMicrotask(() => {
    ultimateOugiFlushQueued = false;
    flushUltimateOugiRolls();
  });
}
function flushUltimateOugiRolls() {
  let d;
  try {
    d = JSON.parse(currentGameSave(SOLDIER_SAVE_KEY) || "{}");
  } catch {
    return;
  }
  for (const v of d.soldiers || []) {
    const seg = v.chronicle?.segment,
      j = seg?.ougi?.rollJob;
    if (!seg?.finished || !seg.ougi?.done || !ULTIMATE_OUGI_JOBS.includes(j) || j !== jobOf(v)) continue;
    const s = soldierById(v.id),
      evidence = { ...v, alive: true };
    if (!s?.alive || ougiLife(s) !== v.chronicle.life || jobOf(s) !== j || !ougiEligible(evidence)) continue;
    const claim = v.chronicle.life + "|" + seg.key + "|" + j;
    if (ougiSave.claims[v.chronicle.life] === claim) continue;
    ougiInsightRoll(s, "victory", claim, evidence);
    if (ougiSave.claims[v.chronicle.life] !== claim && !ultimateOugiRetryTimer)
      ultimateOugiRetryTimer = setTimeout(() => {
        ultimateOugiRetryTimer = null;
        flushUltimateOugiRolls();
      }, 3000);
  }
}
function ultimateOugiRequirement(s) {
  if (!ougiForJob(jobOf(s)).length)
    return "<p>現在の職業には対応する伝説の奥義がありません。対応する最上級職へ転職すると使えます。</p>";
  const c = chronicleOf(s),
    j = jobOf(s);
  let progress = "";
  if (j === "healing_master")
    progress =
      "実回復 " +
      fmt(c.healed) +
      "/50,000・救命生還 " +
      c.ougiRescues +
      "/10（導入後の記録。HP30%以下の味方へ実回復し、双方が生還。同じ味方は1戦1回）";
  else if (j === "shinobi_head") progress = "妨害した敵の討伐貢献 " + c.ougiControlKills + "/10";
  else if (j === "spear_commander") progress = "足止めして勝利生還 " + c.ougiBlockWins + "/10";
  else if (j === "iron_cavalry")
    progress = "かばう／味方の盾が実際に被弾して勝利生還 " + Math.max(c.coverWins, c.ougiGuardWins) + "/10";
  else if (["bow_saint", "gun_commander"].includes(j))
    progress = "強敵討伐・支援 " + Math.max(c.bossKills + c.bossAssists, c.ougiBossContrib) + "/10";
  else progress = "強敵への最後の一撃 " + c.bossKills + "/10（修練場の新しい戦い・試作で抽選）";
  return (
    "<p><b>奥義の習得条件</b><br>現在職 " +
    esc(JOBS[j].name) +
    "・Lv150以上・熟練10/10<br>" +
    esc(progress) +
    "<br><small>初期2%、連続不発10回ごとに+1ポイント、最大10%。50回目の対象抽選では確定習得。" +
    (j === "sword_saint"
      ? ""
      : "回復・攻撃・防御に貢献して勝利したWAVE／戦闘で1回抽選。戦場試練は勝利・面クリア・探索の正常帰還で確定。") +
    "</small></p>" +
    ougiLearningStatus(s)
  );
}
function ougiLearningStatus(s) {
  const life = ougiLife(s),
    j = jobOf(s),
    rolls = ougiSave.rolls[life] || 0,
    fails = ougiSave.fails[life] || 0,
    prof = profLv(s),
    remaining = Math.max(1, OUGI_RULES.pity - fails),
    complete = ougiCandidates(s).length === 0,
    missing = [];
  if (s.level < OUGI_RULES.level) missing.push("Lv" + OUGI_RULES.level + "未満");
  if (prof < OUGI_RULES.prof) missing.push("現在職の熟練度が10/10未満");
  if (j === "sword_saint" ? chronicleOf(s).bossKills < OUGI_RULES.bossKills : !ultimateOugiEligible(s))
    missing.push("職業別の戦歴条件が未達成");
  const status = complete
    ? "✅ この職業の奥義はすべて習得済み"
    : missing.length
      ? "🔒 抽選条件未達成：" + missing.join("・")
      : "✅ 能力・実績の抽選条件を達成しています";
  const where =
    j === "sword_saint"
      ? "剣聖の習得抽選は、修練場の「新しい戦い（試作）」での強敵撃破・挑戦クリア時のみです。通常防衛やサバイバルでは習得抽選しません。習得した奥義の使用は全モード共通です。"
      : "攻撃・回復・防御に貢献して生還した勝利結果で、1回だけ習得抽選します。";
  const next =
    remaining === 1
      ? "次の対象抽選で確定習得"
      : "次回の習得率：" + Math.round(ougiRateOf(s) * 100) + "%・確定まであと" + remaining + "回以内";
  return (
    '<div class="ougi-learning-status"><p><b>本人の現在値・習得抽選</b><br>現在Lv' +
    s.level +
    "・" +
    esc(JOBS[j].name) +
    "熟練度 " +
    prof +
    "/10<br>" +
    esc(status) +
    "</p><p>実際の習得抽選：" +
    rolls +
    "回<br>連続不発：" +
    fails +
    "回" +
    (complete ? "" : "<br>" + esc(next)) +
    "</p><p><small>回数はこの兵士の全職業合計です。討伐・支援回数や、戦闘中の30%の発動抽選とは別です。習得すると連続不発回数は0に戻ります。</small></p><p><small>" +
    esc(where) +
    "</small></p></div>"
  );
}
// 写しで戦う試練では戦歴も分離する。成功した区間の必要な戦歴だけを本物へ一度だけ持ち帰る。
function ultimateOugiTrialFinish(T, win) {
  if (!T || trial !== T) return;
  const list = T.units.filter((u) => u.placed).map((u) => u.sh);
  ultimateOugiFinish(list, win);
  for (const u of T.units) {
    if (!u.placed) continue;
    const s = u.sh,
      c = chronicleOf(s),
      base = u.ougiBaseline || {},
      src = u.src;
    chronicleFinish(s, win && !u.dead);
    if (!win && src.chronicle?.segment?.key?.startsWith("trial:" + T.ougiRunId + ":")) {
      if (src.chronicle.segment.ougi) src.chronicle.segment.ougi.rollJob = null;
    }
    if (win && !u.dead && src.alive && !src.heroFell) {
      const real = chronicleOf(src);
      for (const k of ["healed", ...ULTIMATE_OUGI_COUNTERS])
        chronicleAdd(real, k, Math.max(0, (c[k] || 0) - (base[k] || 0)));
      if (c.segment?.ougi?.rollJob) real.segment = JSON.parse(JSON.stringify(c.segment));
    }
    u.ougiBaseline = Object.fromEntries(["healed", ...ULTIMATE_OUGI_COUNTERS].map((k) => [k, c[k] || 0]));
  }
  if (win) {
    beginGameSaveBatch();
    saveRoster();
    persistHeroes();
    commitGameSaveBatch();
  }
}
// モードを越えて一時効果を持ち越さない。同じモードの次WAVEでも終了する。
function ultimateOugiWardValid(ward) {
  if (!ward || !ultimateOugiBody(ward.actor)?.alive || !(ultimateOugiBody(ward.actor).hp > 0)) return false;
  const mode = ward.mode,
    T = trial,
    B = battle;
  let session, segment, now;
  if (mode === "trial") {
    if (!T || T.phase !== "fight" || T.result || T.paused || T.choice || T.cleared) return false;
    session = T;
    segment = T.floor + ":" + (T.explore?.region || 0);
    now = T.t;
  } else if (mode === "battle") {
    if (!B || B.result || paused) return false;
    session = B;
    segment = 0;
    now = B.t;
  } else {
    if (!playing || paused || over || B || T) return false;
    session = training || runId;
    segment = wave;
    now = combatClock;
  }
  return (
    session === ward.ctx.session && segment === ward.ctx.segment && ward.until > now && ward.actor.valid()
  );
}
function ultimateOugiAbsorb(s, damage) {
  const w = s.ultimateWard;
  if (!ultimateOugiWardValid(w)) return damage;
  damage *= 1 - (w.cut || 0);
  const n = Math.min(damage, w.shield || 0);
  w.shield = Math.max(0, (w.shield || 0) - n);
  if (n) ultimateOugiProtected(ougiLife(w.actor.s), s);
  return damage - n;
}
function ultimateOugiCover(target, list, raw, receive) {
  const w = target.ultimateWard,
    owner = w?.actor;
  if (!(raw > 0) || !w?.cover || !ultimateOugiWardValid(w) || !owner?.valid()) return raw;
  const body = owner.unit?.sh || owner.s;
  if (body === target || !list.includes(body) || body.hp <= 0) return raw;
  const part = raw * 0.3;
  receive(body, part);
  ultimateOugiProtected(ougiLife(owner.s), target);
  return raw - part;
}
function ultimateOugiBody(a) {
  return a.unit?.sh || a.s;
}
function ultimateOugiMax(a) {
  return a.unit?.max || a.stats().maxHp;
}
function ultimateOugiHealActor(ctx, a, m, amount) {
  const source = ultimateOugiBody(a),
    target = ultimateOugiBody(m),
    max = ultimateOugiMax(m),
    before = target.hp;
  if (!m.valid() || !source.alive || !(amount > 0)) return 0;
  target.hp = Math.min(max, target.hp + amount * healTakenMul(target));
  const got = Math.max(0, target.hp - before);
  if (got) {
    chronicleHeal(source, target, before, max);
    if (a.unit) a.unit.healed += got;
    else earnXp(source, "heal", got, max);
    burst(m.pos.x, m.pos.y - 15, "#7be08a", "heal");
  }
  return got;
}
function ultimateOugiWard(
  ctx,
  a,
  m,
  { shield = 0, cut = 0, cover = false, regen = 0, seconds = 8, block = false } = {},
) {
  const body = ultimateOugiBody(m),
    old = body.ultimateWard,
    valid = ultimateOugiWardValid(old);
  body.ultimateWard = {
    ctx,
    mode: ctx.mode,
    actor: a,
    until: ctx.now + seconds,
    shield: Math.max(valid ? old.shield || 0 : 0, ultimateOugiMax(m) * shield),
    cut: Math.max(valid ? old.cut || 0 : 0, cut),
    cover,
    regen,
    block,
    regenLeft: seconds,
    regenAt: ctx.now,
  };
}
function ultimateOugiTick(ctx, dt) {
  for (const m of ctx.friends) {
    const w = ultimateOugiBody(m).ultimateWard;
    if (!ultimateOugiWardValid(w) || !w.regen) continue;
    const step = Math.min(dt, w.regenLeft, Math.max(0, ctx.now - w.regenAt));
    if (step > 0) {
      ultimateOugiHealActor(ctx, w.actor, m, w.regen * step);
      w.regenLeft -= step;
      w.regenAt = ctx.now;
    }
  }
}
function ultimateOugiAim(ctx, a, k) {
  const O = LEGEND_OUGI[k],
    range = O.reach || a.stats().range;
  if (O.role === "heal" || O.role === "guard") {
    const friends = ctx.friends.filter(
      (m) =>
        m.valid() &&
        Math.hypot(m.pos.x - a.pos.x, m.pos.y - a.pos.y) <= range &&
        (O.role !== "guard" || m.s.squadId === a.s.squadId || ctx.mode === "trial"),
    );
    const wounded = friends.filter((m) => ultimateOugiBody(m).hp < ultimateOugiMax(m));
    if (!wounded.length) return null;
    return {
      friends: (O.role === "guard" ? friends.filter((m) => m.s !== a.s) : wounded)
        .sort(
          (x, y) => ultimateOugiBody(x).hp / ultimateOugiMax(x) - ultimateOugiBody(y).hp / ultimateOugiMax(y),
        )
        .slice(0, 3),
    };
  }
  const targets = ctx.targets().filter((e) => Math.hypot(e.x - a.pos.x, e.y - a.pos.y) <= range);
  if (!targets.length) return null;
  targets.sort(
    (x, y) => (y.boss || y.kind === "boss" ? 1 : 0) - (x.boss || x.kind === "boss" ? 1 : 0) || y.hp - x.hp,
  );
  const target = targets[0];
  let hits = targets;
  if (O.role === "spear") {
    const dx = target.x - a.pos.x,
      dy = target.y - a.pos.y,
      len = Math.hypot(dx, dy) || 1;
    hits = targets.filter((e) => {
      const x = e.x - a.pos.x,
        y = e.y - a.pos.y;
      return (x * dx + y * dy) / len >= 0 && Math.abs(x * dy - y * dx) / len <= 45;
    });
  } else if (O.role === "gun")
    hits = targets.filter((e) => Math.hypot(e.x - target.x, e.y - target.y) <= 100);
  return { target, targets: hits.slice(0, O.maxTargets || 6) };
}
function ultimateOugiCast(ctx, a, k, aim) {
  const O = LEGEND_OUGI[k],
    atk = a.stats().atk * a.mul(),
    source = ultimateOugiBody(a);
  const damage = (e, mul = O.mul) => {
    if (e.hp > 0) {
      ctx.hit(a, e, atk * mul * (e.structure && O.role === "gun" ? 1.3 : 1), O.pierce || 0);
      autoOugiStats.hits++;
    }
  };
  if (O.role === "heal") {
    for (const m of aim.friends) {
      ultimateOugiHealActor(ctx, a, m, a.stats().heal * 2 * a.mul());
      ultimateOugiWard(ctx, a, m, { shield: 0.1, regen: a.stats().heal * 0.2 * a.mul(), seconds: 8 });
    }
  } else if (O.role === "guard") {
    for (const m of aim.friends) ultimateOugiWard(ctx, a, m, { shield: 0.25, cover: true, seconds: 8 });
    ultimateOugiWard(ctx, a, a, { shield: 0.15, cut: 0.2, seconds: 8 });
    ultimateOugiSegment(source).active = true;
  } else {
    for (const e of aim.targets) {
      if (O.role === "ninja" && !e.structure) {
        if (evolutionBoss(e) || e.role === "boss" || e.role === "mid")
          e.evolutionWeaken = { value: 0.15, until: ctx.now + 8 };
        else {
          e.ultimateStunUntil = ctx.now + 3;
          e.evolutionSlow = { value: 1, until: ctx.now + 3 };
          e.cd = Math.max(e.cd || 0, 3);
          e.unitCd = Math.max(e.unitCd || 0, 3);
        }
        ultimateOugiControl(source, e);
      }
      damage(e);
      if (O.role === "bow") for (let i = 0; i < 2; i++) damage(e);
      burst(
        e.x,
        e.y - 12,
        O.role === "gun" ? "#ffb347" : O.role === "ninja" ? "#be9aff" : "#ccecff",
        O.role === "gun" ? "cannon" : "slash",
      );
    }
    if (O.role === "spear") ultimateOugiWard(ctx, a, a, { shield: 0.2, cut: 0.35, seconds: 8, block: true });
  }
  evolutionFx({ pos: a.pos }, O.name, O.fx, aim.friends?.map((m) => m.pos) || aim.targets || [], true);
}
