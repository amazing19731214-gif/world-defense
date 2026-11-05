// サバイバル専用の大ボス。兵士・秘境ボス・保存データには状態を持たせない。
const SURVIVAL_BOSS_RULES = { every: 3, maxTypes: 10, finalRecommendedLevel: 1000 };
const SURVIVAL_BOSSES = [
  {
    id: "oniCharge",
    name: "赤備えの鬼将",
    move: "赤鬼の突進",
    recLevel: 40,
    enemyLevel: 40,
    color: "#ff6256",
    shape: "mountedOni",
    icon: "👹",
    crest: "突",
    hpMul: 1.6,
    atkMul: 1.05,
    rMul: 1.65,
    speedMul: 1.05,
    interval: 8,
  },
  {
    id: "owlVolley",
    name: "百矢の梟将",
    move: "百矢の雨",
    recLevel: 80,
    enemyLevel: 80,
    color: "#d9bb71",
    shape: "owl",
    icon: "🦉",
    crest: "矢",
    hpMul: 1.6,
    atkMul: 1.15,
    rMul: 1.7,
    speedMul: 0.95,
    interval: 8.5,
  },
  {
    id: "ironGuard",
    name: "鉄壁の玄将",
    move: "玄武の守り・震撃",
    recLevel: 140,
    enemyLevel: 140,
    color: "#80c6a4",
    shape: "shell",
    icon: "🛡️",
    crest: "盾",
    hpMul: 1.55,
    atkMul: 1.35,
    rMul: 1.8,
    speedMul: 0.8,
    interval: 10,
  },
  {
    id: "thunderSpear",
    name: "雷槍の轟将",
    move: "交差する雷槍",
    recLevel: 220,
    enemyLevel: 220,
    color: "#fff080",
    shape: "tiger",
    icon: "⚡",
    crest: "雷",
    hpMul: 1.55,
    atkMul: 1.7,
    rMul: 1.75,
    speedMul: 1.1,
    interval: 8,
  },
  {
    id: "shadowBlink",
    name: "影討ちの忍王",
    move: "影渡りの刃",
    recLevel: 320,
    enemyLevel: 320,
    color: "#bf9dff",
    shape: "ninja",
    icon: "🥷",
    crest: "影",
    hpMul: 1.5,
    atkMul: 2.5,
    rMul: 1.65,
    speedMul: 1.15,
    interval: 8,
  },
  {
    id: "flameDemon",
    name: "業炎の魔将",
    move: "三連の業火",
    recLevel: 450,
    enemyLevel: 450,
    color: "#ff9c47",
    shape: "flame",
    icon: "🔥",
    crest: "炎",
    hpMul: 1.5,
    atkMul: 4,
    rMul: 1.85,
    speedMul: 0.95,
    interval: 9,
  },
  {
    id: "boneKing",
    name: "不死の骸王",
    move: "骸の再生・死の輪",
    recLevel: 600,
    enemyLevel: 600,
    color: "#d4e8ba",
    shape: "skeleton",
    icon: "💀",
    crest: "骸",
    hpMul: 1.5,
    atkMul: 5,
    rMul: 1.8,
    speedMul: 0.85,
    interval: 11,
  },
  {
    id: "frostLord",
    name: "氷嵐の覇将",
    move: "氷嵐の封陣",
    recLevel: 780,
    enemyLevel: 780,
    color: "#8ce5ff",
    shape: "iceWings",
    icon: "❄️",
    crest: "氷",
    hpMul: 1.5,
    atkMul: 8,
    rMul: 1.9,
    speedMul: 1,
    interval: 9,
  },
  {
    id: "tenmaBarrage",
    name: "天魔の軍神",
    move: "三門の天魔砲",
    recLevel: 900,
    enemyLevel: 1000,
    color: "#94bfff",
    shape: "machine",
    icon: "🤖",
    crest: "砲",
    hpMul: 1.5,
    atkMul: 11,
    rMul: 2,
    speedMul: 0.85,
    interval: 9,
  },
  {
    id: "endLord",
    name: "終焉の覇王",
    move: "終焉三式",
    recLevel: 1000,
    enemyLevel: 1200,
    color: "#ff75b0",
    shape: "hydraCrown",
    icon: "👑",
    crest: "終",
    hpMul: 1.4,
    atkMul: 12,
    rMul: 2.05,
    speedMul: 1,
    interval: 8,
  },
].map((d, index) => ({
  ...d,
  index,
  size: index + 1,
  visualHeight: [150, 175, 200, 225, 250, 280, 310, 340, 370, 400][index],
  collisionRadius: [55, 61, 67, 73, 79, 85, 91, 97, 103, 110][index],
  // 本体のローカル座標の上下端。専用絵の内側の倍率も含め、足元を0へそろえる。
  intrinsicHeight: [160, 150, 158, 149, 124, 160, 162, 144, 147.5, 185.2][index],
  intrinsicBottom: [12, 28, 12, 10, 10, 13, 13, 7, 8, 8.2][index],
}));

function survivalBossForFloor(floor) {
  if (!Number.isInteger(floor) || floor < SURVIVAL_BOSS_RULES.every || floor % SURVIVAL_BOSS_RULES.every)
    return null;
  return SURVIVAL_BOSSES[Math.min(SURVIVAL_BOSSES.length - 1, floor / SURVIVAL_BOSS_RULES.every - 1)];
}
function survivalBossEnabled(T, e) {
  return !!(T && T.mode === "survival" && !T.explore && e && e.survivalBossId && e.survivalBoss && !e.gone);
}
function survivalBossApply(T, e, def) {
  if (!T || T.mode !== "survival" || T.explore || !e || !def) return e;
  Object.assign(e, {
    survivalBossId: def.id,
    great: true,
    name: def.name,
    color: def.color,
    r: def.collisionRadius,
  });
  e.survivalBoss = {
    id: def.id,
    index: def.index,
    size: def.size,
    visualHeight: def.visualHeight,
    visualScale: def.visualHeight / def.intrinsicHeight,
    visualBottom: def.intrinsicBottom,
    cooldown: 3,
    warning: null,
    dash: null,
    hazard: null,
    guardUntil: 0,
    regenCount: 0,
    phase: 1,
    turn: 0,
    attacks: 0,
    hits: 0,
  };
  return e;
}
function survivalBossDamageMul(e) {
  const T = typeof trial === "undefined" ? null : trial;
  return survivalBossEnabled(T, e) && e.survivalBoss.guardUntil > T.t ? 0.45 : 1;
}
function survivalBossMoveMul(u) {
  const T = typeof trial === "undefined" ? null : trial;
  if (!T || T.mode !== "survival" || T.explore || !u || !u.survivalBossSlow) return 1;
  if (T.cleared || u.survivalBossSlow.until <= T.t) {
    delete u.survivalBossSlow;
    return 1;
  }
  return u.survivalBossSlow.mul;
}
function survivalBossFx(o) {
  if (effects.length < 60) effects.push(o);
}
function survivalBossPoint(T, x, y, fallback) {
  const Z = T.map.size,
    p = { x: Math.max(35, Math.min(Z.w - 35, x)), y: Math.max(45, Math.min(Z.h - 35, y)) };
  return trialInRiver(T.map, p.x, p.y) ? { x: fallback.x, y: fallback.y } : p;
}
function survivalBossSegmentDistance(u, z) {
  const dx = z.x2 - z.x,
    dy = z.y2 - z.y,
    n = dx * dx + dy * dy;
  const t = n ? Math.max(0, Math.min(1, ((u.x - z.x) * dx + (u.y - z.y) * dy) / n)) : 0;
  return Math.hypot(u.x - z.x - t * dx, u.y - z.y - t * dy);
}
function survivalBossZoneHit(u, z) {
  if (z.shape === "line") return survivalBossSegmentDistance(u, z) <= z.width / 2;
  const d = Math.hypot(u.x - z.x, u.y - z.y);
  return z.shape === "ring" ? Math.abs(d - z.r) <= z.width / 2 : d <= z.r;
}
function survivalBossStrike(T, e, live, attack) {
  const S = e.survivalBoss;
  for (const u of live) {
    if (u.dead || attack.hit.has(u.id) || !attack.zones.some((z) => survivalBossZoneHit(u, z))) continue;
    attack.hit.add(u.id);
    trialHitUnit(u, (e.attackConf.damage || 10) * (e.atkMul || 1) * attack.mul, attack.ranged !== false, e);
    if (attack.frost && !u.dead) u.survivalBossSlow = { until: T.t + 2.5, mul: 0.65 };
    S.hits++;
  }
}
function survivalBossWarn(T, e, kind, zones, delay, mul, extra = {}) {
  const S = e.survivalBoss,
    def = SURVIVAL_BOSSES[S.index];
  // 初心者の移動速度でも、予告を見て範囲外へ歩いて逃げられる猶予を確保する。
  const hero = T.units.find((u) => u.id === T.hero && !u.dead);
  if (hero) {
    const speed = Math.max(10, hero.speed * TRIAL_SURVIVAL.heroSpeed * survivalBossMoveMul(hero));
    for (const z of zones) {
      const distance = Math.hypot(hero.x - z.x, hero.y - z.y);
      const escape =
        z.shape === "circle"
          ? z.r - distance
          : z.shape === "ring"
            ? z.width / 2 - Math.abs(distance - z.r)
            : z.width / 2 - survivalBossSegmentDistance(hero, z);
      if (escape > 0) delay = Math.max(delay, (escape + 10) / speed + 0.35);
    }
  }
  S.warning = {
    kind,
    zones,
    at: T.t + Math.max(0.9, delay),
    duration: Math.max(0.9, delay),
    mul,
    ranged: true,
    hit: new Set(),
    ...extra,
  };
  S.attacks++;
  e.cd = Math.max(e.cd, 0.6);
  trialSfx("warn");
  survivalBossFx({
    kind: "ctext",
    x: e.x,
    y: e.y - 125,
    text: def.icon + " " + (extra.label || def.move),
    ougi: true,
    age: 0,
    duration: 1.2,
  });
}
function survivalBossBegin(T, e, live) {
  const S = e.survivalBoss,
    def = SURVIVAL_BOSSES[S.index];
  const hero = live.find((u) => u.id === T.hero) || live[0];
  if (!hero) return;
  const circle = (x, y, r) => ({ shape: "circle", x, y, r });
  const line = (x, y, x2, y2, width) => ({ shape: "line", x, y, x2, y2, width });
  const targets = [hero, ...live.filter((u) => u !== hero)].slice(0, 3);
  const a = Math.atan2(hero.y - e.y, hero.x - e.x),
    dx = Math.cos(a),
    dy = Math.sin(a);
  S.turn++;
  S.cooldown = def.interval * (S.phase === 2 && def.id === "endLord" ? 0.75 : 1);
  if (def.id === "oniCharge") {
    const reach = Math.min(440, Math.max(180, Math.hypot(hero.x - e.x, hero.y - e.y) + 90));
    const p = survivalBossPoint(T, e.x + dx * reach, e.y + dy * reach, hero);
    survivalBossWarn(T, e, "charge", [line(e.x, e.y, p.x, p.y, 66)], 1.15, 1.15, {
      endpoint: p,
      ranged: false,
    });
  } else if (def.id === "owlVolley") {
    survivalBossWarn(
      T,
      e,
      "volley",
      targets.map((u) => circle(u.x, u.y, 78)),
      1.15,
      0.9,
    );
  } else if (def.id === "ironGuard") {
    survivalBossWarn(T, e, "guard", [circle(e.x, e.y, 155)], 2.4, 1.15, { ranged: false });
    S.guardUntil = S.warning.at;
  } else if (def.id === "thunderSpear") {
    survivalBossWarn(
      T,
      e,
      "thunder",
      [
        line(hero.x - 200, hero.y, hero.x + 200, hero.y, 55),
        line(hero.x, hero.y - 200, hero.x, hero.y + 200, 55),
      ],
      1.15,
      1.05,
    );
  } else if (def.id === "shadowBlink") {
    const p = survivalBossPoint(T, hero.x + dx * 70, hero.y + dy * 70, e);
    survivalBossWarn(T, e, "blink", [circle(p.x, p.y, 110)], 1, 1.1, { endpoint: p, ranged: false });
  } else if (def.id === "flameDemon") {
    survivalBossWarn(
      T,
      e,
      "flame",
      [0, 1, 2].map((i) => circle(hero.x + dx * (i - 1) * 95, hero.y + dy * (i - 1) * 95, 80)),
      1.2,
      1.05,
      { lingering: 2.2 },
    );
  } else if (def.id === "boneKing") {
    if (S.regenCount < 3) {
      e.hp = Math.min(e.max, e.hp + e.max * 0.04);
      S.regenCount++;
      survivalBossFx({
        kind: "ctext",
        x: e.x,
        y: e.y - 150,
        text: "骨の再生 " + S.regenCount + "/3",
        ougi: true,
        age: 0,
        duration: 1.3,
      });
    }
    survivalBossWarn(T, e, "bone", [{ shape: "ring", x: e.x, y: e.y, r: 150, width: 90 }], 1.2, 1.05);
  } else if (def.id === "frostLord") {
    survivalBossWarn(T, e, "frost", [circle(hero.x, hero.y, 145)], 1.25, 0.9, { frost: true });
  } else if (def.id === "tenmaBarrage") {
    const ox = -dy * 88,
      oy = dx * 88;
    survivalBossWarn(
      T,
      e,
      "barrage",
      [-1, 0, 1].map((k) =>
        line(e.x + ox * k, e.y + oy * k, e.x + dx * 620 + ox * k, e.y + dy * 620 + oy * k, 47),
      ),
      1.35,
      1.1,
    );
  } else {
    const turn = (S.turn - 1) % 3;
    const zones =
      turn === 0
        ? targets.map((u) => circle(u.x, u.y, 95))
        : turn === 1
          ? [
              line(hero.x - 235, hero.y, hero.x + 235, hero.y, 68),
              line(hero.x, hero.y - 235, hero.x, hero.y + 235, 68),
            ]
          : [{ shape: "ring", x: e.x, y: e.y, r: 170, width: 100 }];
    if (S.phase === 2) {
      if (turn !== 0) zones.push(circle(hero.x, hero.y, 85));
      if (turn !== 2) zones.push({ shape: "ring", x: e.x, y: e.y, r: 200, width: 55 });
    }
    survivalBossWarn(T, e, "apocalypse", zones, S.phase === 2 ? 1.1 : 1.35, S.phase === 2 ? 2.2 : 1.65, {
      label: "終焉" + ["・天落", "・十字", "・崩輪"][turn],
    });
  }
}
function survivalBossTick(T, e, live, dt) {
  if (!survivalBossEnabled(T, e) || T.cleared || !live.length) return false;
  const S = e.survivalBoss;
  if (S.id === "endLord" && S.phase === 1 && e.hp <= e.max * 0.5) {
    S.phase = 2;
    S.cooldown = Math.min(S.cooldown, 2);
    survivalBossFx({
      kind: "ctext",
      x: e.x,
      y: e.y - 165,
      text: "👑 終焉の覇王・覚醒",
      ougi: true,
      age: 0,
      duration: 1.6,
    });
    trialSfx("bossGreat");
  }
  if (e.ultimateStunUntil > T_now()) return true;
  if (S.hazard) {
    if (S.hazard.until <= T.t) S.hazard = null;
    else survivalBossStrike(T, e, live, S.hazard);
  }
  if (S.dash) {
    const d = S.dash,
      before = { x: e.x, y: e.y };
    const slow = e.evolutionSlow && e.evolutionSlow.until > T_now() ? 1 - e.evolutionSlow.value : 1;
    trialMove(e, d.x, d.y, d.speed * slow, dt);
    survivalBossStrike(T, e, live, {
      ...d,
      zones: [{ shape: "line", x: before.x, y: before.y, x2: e.x, y2: e.y, width: 66 }],
    });
    if (T.t >= d.until || Math.hypot(e.x - d.x, e.y - d.y) < 8) S.dash = null;
    return true;
  }
  if (S.warning) {
    const w = S.warning;
    if (T.t < w.at) return true;
    S.warning = null;
    e.atkAnim = 0.35;
    if (w.kind === "charge") {
      const distance = Math.hypot(w.endpoint.x - e.x, w.endpoint.y - e.y);
      S.dash = {
        x: w.endpoint.x,
        y: w.endpoint.y,
        speed: Math.max(180, distance / 0.7),
        until: T.t + 0.85,
        hit: w.hit,
        mul: w.mul,
        ranged: false,
      };
    } else {
      if (w.kind === "blink")
        Object.assign(e, {
          x: w.endpoint.x,
          y: w.endpoint.y,
          px: w.endpoint.x,
          py: w.endpoint.y,
          lastX: w.endpoint.x,
          lastY: w.endpoint.y,
        });
      survivalBossStrike(T, e, live, w);
      if (w.lingering) S.hazard = { ...w, until: T.t + w.lingering };
      for (const z of w.zones)
        survivalBossFx({ kind: "cshock", x: z.x, y: z.y + 5, ougi: true, age: 0, duration: 0.55 });
      trialSfx(w.kind === "thunder" ? "thunder" : "thrust");
    }
    return true;
  }
  S.cooldown -= dt;
  if (S.cooldown <= 0) {
    survivalBossBegin(T, e, live);
    return true;
  }
  return false;
}

function survivalBossDrawZone(z, color, progress, active) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = active ? 0.23 : 0.12 + 0.09 * progress;
  ctx.beginPath();
  if (z.shape === "line") {
    ctx.lineWidth = z.width;
    ctx.lineCap = "round";
    ctx.moveTo(z.x, z.y);
    ctx.lineTo(z.x2, z.y2);
    ctx.stroke();
  } else if (z.shape === "ring") {
    ctx.lineWidth = z.width;
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3;
  ctx.setLineDash(active ? [] : [10, 6]);
  if (z.shape === "line") {
    const a = Math.atan2(z.y2 - z.y, z.x2 - z.x),
      dx = (-Math.sin(a) * z.width) / 2,
      dy = (Math.cos(a) * z.width) / 2;
    ctx.beginPath();
    ctx.moveTo(z.x + dx, z.y + dy);
    ctx.lineTo(z.x2 + dx, z.y2 + dy);
    ctx.arc(z.x2, z.y2, z.width / 2, a + Math.PI / 2, a - Math.PI / 2, true);
    ctx.lineTo(z.x - dx, z.y - dy);
    ctx.arc(z.x, z.y, z.width / 2, a - Math.PI / 2, a + Math.PI / 2, true);
    ctx.closePath();
    ctx.stroke();
  } else {
    for (const r of z.shape === "ring" ? [z.r - z.width / 2, z.r + z.width / 2] : [z.r]) {
      ctx.beginPath();
      ctx.arc(z.x, z.y, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (!active) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(z.x, z.y, Math.max(4, z.r * progress), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
function survivalBossDrawWarnings(T) {
  const e = T && T.boss;
  if (!survivalBossEnabled(T, e) || T.cleared) return;
  const S = e.survivalBoss,
    def = SURVIVAL_BOSSES[S.index];
  if (S.warning) {
    const w = S.warning,
      progress = Math.max(0, Math.min(1, 1 - (w.at - T.t) / w.duration));
    for (const z of w.zones) survivalBossDrawZone(z, def.color, progress, false);
    const z = w.zones[0];
    ctx.save();
    ctx.font = "bold 15px system-ui";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#160b18";
    ctx.fillStyle = "#fff4d8";
    const text = "⚠ " + (w.label || def.move);
    ctx.strokeText(text, z.x, z.y - (z.r || 40) - 12);
    ctx.fillText(text, z.x, z.y - (z.r || 40) - 12);
    ctx.restore();
  }
  if (S.hazard) for (const z of S.hazard.zones) survivalBossDrawZone(z, "#ff7b36", 1, true);
}

// ドットの矩形・専用シルエット。秘境の絵を使う場合も描画用の写しだけを渡す。
function survivalBossDrawBody(e) {
  const T = typeof trial === "undefined" ? null : trial;
  if (!survivalBossEnabled(T, e)) return false;
  const S = e.survivalBoss,
    D = SURVIVAL_BOSSES[S.index],
    c = D.color;
  ctx.save();
  ctx.translate(e.x, e.y);
  ellipse(0, 8, e.r + 7, 13, "#130d2355");
  ctx.strokeStyle = c;
  ctx.lineWidth = S.phase === 2 ? 5 : 3;
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.ellipse(0, 8, e.r + 13, (e.r + 13) * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 当たり判定と足元の輪は拡大せず、本体だけを十段階の高さへ正規化する。
  ctx.save();
  ctx.scale(S.visualScale, S.visualScale);
  ctx.translate(0, -S.visualBottom);
  const P = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const poly = (points, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
  };
  const eyes = (y, width = 17) => {
    P(-width, y, 11, 5, "#fff5ad");
    P(width - 11, y, 11, 5, "#fff5ad");
  };
  if (D.shape === "tiger" && typeof drawByakko === "function") {
    ctx.save();
    ctx.scale(e.face > 0 ? -0.9 : 0.9, 0.9);
    drawByakko({ ...e, x: -BOSS_DX.hiei, y: -8, phase: e.hp < e.max * 0.5 ? 2 : 1, swipe: e.atkAnim }, 1);
    ctx.restore();
    poly(
      [
        [-8, -100],
        [8, -100],
        [20, -135],
        [0, -119],
        [-14, -139],
      ],
      c,
    );
  } else if (D.shape === "machine" && typeof drawTenma === "function") {
    ctx.save();
    ctx.scale(e.face > 0 ? -0.6 : 0.6, 0.6);
    drawTenma({ ...e, x: -BOSS_DX.fuji, y: -10, phase: e.hp < e.max * 0.5 ? 3 : 2, fireAnim: e.atkAnim }, 1, {
      warn: S.warning
        ? { kind: "beam", left: Math.max(0, S.warning.at - T.t), max: S.warning.duration }
        : null,
    });
    ctx.restore();
  } else if (D.shape === "hydraCrown" && typeof drawYamataTinted === "function") {
    ctx.save();
    ctx.scale(e.face > 0 ? -0.63 : 0.63, 0.63);
    const heads = Array.from({ length: 8 }, (_, i) => ({
      kind: ["fire", "poison", "ice", "bite", "roar", "fire", "ice", "bite"][i],
      sealed: 0,
      anim: 0,
    }));
    drawYamataTinted(
      { ...e, boss: "orochi", x: -BOSS_DX.yomi, y: -8, phase: S.phase, heads, head: S.turn % 8 },
      1,
    );
    ctx.restore();
    poly(
      [
        [-28, -139],
        [-30, -164],
        [-12, -153],
        [0, -177],
        [12, -153],
        [30, -164],
        [28, -139],
      ],
      "#ffd46c",
    );
  } else if (D.shape === "mountedOni") {
    P(-49, -39, 87, 31, "#472532");
    P(-45, -13, 13, 25, "#211824");
    P(21, -13, 13, 25, "#211824");
    P(30, -57, 25, 28, "#6f3435");
    poly(
      [
        [35, -55],
        [37, -76],
        [51, -58],
      ],
      c,
    );
    P(-17, -79, 35, 49, "#a52d39");
    P(-15, -103, 31, 28, c);
    eyes(-94, 13);
    poly(
      [
        [-15, -99],
        [-27, -122],
        [-8, -108],
      ],
      "#ffdc9b",
    );
    poly(
      [
        [14, -99],
        [27, -122],
        [7, -108],
      ],
      "#ffdc9b",
    );
    P(-43, -128, 5, 107, "#e5d8ae");
    poly(
      [
        [-49, -130],
        [-40, -148],
        [-31, -130],
      ],
      c,
    );
  } else if (D.shape === "owl") {
    poly(
      [
        [-23, -85],
        [-85, -101],
        [-61, -66],
        [-92, -63],
        [-44, -26],
        [-18, -35],
      ],
      "#806849",
    );
    poly(
      [
        [23, -85],
        [85, -101],
        [61, -66],
        [92, -63],
        [44, -26],
        [18, -35],
      ],
      "#806849",
    );
    P(-28, -90, 56, 75, "#c0a168");
    poly(
      [
        [-30, -84],
        [-28, -122],
        [-8, -108],
        [8, -108],
        [28, -122],
        [30, -84],
      ],
      c,
    );
    P(-24, -101, 21, 22, "#392b31");
    P(3, -101, 21, 22, "#392b31");
    eyes(-95, 18);
    poly(
      [
        [-7, -83],
        [7, -83],
        [0, -70],
      ],
      "#fff0a6",
    );
    for (let i = 0; i < 3; i++) P(-18 + i * 15, -60 + (i % 2) * 8, 6, 24, "#6a513c");
    P(-45, -38, 5, 66, "#e4d2a7");
    poly(
      [
        [-49, -40],
        [-42, -55],
        [-35, -40],
      ],
      "#fff3cf",
    );
  } else if (D.shape === "shell") {
    P(-55, -70, 110, 64, "#263f42");
    P(-45, -87, 90, 72, c);
    P(-32, -78, 64, 57, "#325d52");
    for (let i = -1; i <= 1; i++) P(i * 25 - 2, -75, 5, 47, "#b1d8ac");
    P(-50, -14, 20, 26, "#253333");
    P(30, -14, 20, 26, "#253333");
    P(-20, -119, 40, 34, "#385951");
    eyes(-108);
    P(-28, -125, 56, 10, "#a1d1ad");
    poly(
      [
        [-16, -122],
        [0, -146],
        [16, -122],
      ],
      "#e7df9a",
    );
    P(-61, -75, 12, 73, "#b5c5ad");
  } else if (D.shape === "ninja") {
    poly(
      [
        [-17, -78],
        [-68, -98],
        [-84, -80],
        [-46, -76],
        [-17, -54],
      ],
      c,
    );
    P(-22, -83, 44, 60, "#302c4e");
    P(-21, -111, 42, 33, "#392f57");
    P(-23, -102, 46, 8, c);
    eyes(-100, 17);
    P(-27, -87, 54, 9, "#120f25");
    P(-20, -24, 13, 34, "#211c36");
    P(8, -24, 13, 34, "#211c36");
    poly(
      [
        [35, -84],
        [42, -114],
        [48, -84],
        [74, -78],
        [48, -71],
        [42, -43],
        [35, -71],
        [11, -78],
      ],
      "#ddd9ed",
    );
    P(37, -82, 10, 9, "#554470");
  } else if (D.shape === "flame") {
    poly(
      [
        [-47, -20],
        [-49, -76],
        [-31, -58],
        [-39, -120],
        [-14, -96],
        [0, -147],
        [16, -97],
        [37, -126],
        [32, -66],
        [50, -83],
        [45, -20],
      ],
      "#a63632",
    );
    P(-30, -85, 60, 72, "#752839");
    P(-23, -111, 46, 39, c);
    eyes(-99, 18);
    poly(
      [
        [-14, -32],
        [0, -79],
        [19, -31],
      ],
      "#ffd16c",
    );
    P(-46, -62, 15, 50, c);
    P(31, -62, 15, 50, c);
    P(-23, -14, 15, 27, "#4c2232");
    P(8, -14, 15, 27, "#4c2232");
  } else if (D.shape === "skeleton") {
    P(-24, -117, 48, 38, c);
    P(-28, -107, 56, 20, c);
    P(-19, -103, 13, 13, "#262d35");
    P(6, -103, 13, 13, "#262d35");
    P(-5, -87, 10, 8, "#263038");
    P(-4, -77, 8, 61, "#e0e4c5");
    for (let k = 0; k < 3; k++) {
      P(-25, -70 + k * 15, 50, 6, c);
      P(-27, -70 + k * 15, 7, 14, c);
      P(20, -70 + k * 15, 7, 14, c);
    }
    P(-42, -69, 9, 55, c);
    P(34, -69, 9, 55, c);
    P(-19, -16, 10, 29, c);
    P(9, -16, 10, 29, c);
    P(-39, -128, 78, 8, "#8e648d");
    poly(
      [
        [-29, -128],
        [-22, -149],
        [-7, -128],
        [7, -128],
        [22, -149],
        [29, -128],
      ],
      "#ae80b7",
    );
  } else if (D.shape === "iceWings") {
    poly(
      [
        [-20, -72],
        [-83, -125],
        [-70, -67],
        [-89, -39],
        [-43, -43],
        [-24, -14],
      ],
      "#5eabc8",
    );
    poly(
      [
        [20, -72],
        [83, -125],
        [70, -67],
        [89, -39],
        [43, -43],
        [24, -14],
      ],
      "#5eabc8",
    );
    poly(
      [
        [-17, -100],
        [0, -137],
        [17, -100],
        [26, -36],
        [0, 7],
        [-26, -36],
      ],
      c,
    );
    P(-21, -93, 42, 29, "#377b9b");
    eyes(-84, 17);
    poly(
      [
        [-7, -58],
        [0, -83],
        [7, -58],
        [22, -27],
        [0, -11],
        [-22, -27],
      ],
      "#e0faff",
    );
    P(-65, -113, 5, 64, "#bcf5ff");
    P(60, -113, 5, 64, "#bcf5ff");
  } else {
    P(-35, -102, 70, 105, c);
    eyes(-82);
  }
  ctx.restore();
  // 十体とも紋章と名前を併記。色を見分けにくい場合も識別できる。
  P(-15, -37, 30, 27, "#151325dd");
  ctx.font = "bold 19px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = c;
  ctx.fillText(D.crest, 0, -17);
  if (S.guardUntil > T.t) {
    ctx.strokeStyle = "#c4ffe3";
    ctx.lineWidth = 5;
    ctx.strokeRect(-e.r - 10, -S.visualHeight - 5, e.r * 2 + 20, S.visualHeight + 20);
  }
  ctx.font = "bold 15px system-ui";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#180a1a";
  ctx.fillStyle = "#fff4df";
  const label = D.icon + " " + D.name;
  ctx.strokeText(label, 0, -S.visualHeight - 18);
  ctx.fillText(label, 0, -S.visualHeight - 18);
  ctx.restore();
  return true;
}
