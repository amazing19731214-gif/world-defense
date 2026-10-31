// ===== 戦場試練（v107試作）：少人数の個人戦 =====
// tools/build.mjs が本体スクリプトへ埋め込む。防衛戦（tick）・攻城戦（tickBattle）とは別の戦闘処理。
//   ・マップ（TRIAL_MAPS）と戦闘処理（tickTrial）を分ける。ほかのステージ・洞窟は、マップのデータを足して同じ処理で動かす
//   ・兵士は1人ずつの「試練の兵」（trial.units）。能力は本番の兵士（soldierStats・unitOf・skillSum）から読むだけで、本番の兵士には書き込まない
//   ・試作：戦死は仮（本番の兵士・英霊名鑑・保存データは変えない）。報酬・経験値・熟練度もなし。奥義・3回ごとの技も使わない
//   将来の本番：endTrial の結果（trial.units の dead）を、本番の戦死処理（recordDeath）へ渡す入口を1か所に置く（TRIAL_RULES.real）
const TRIAL_RULES = {
  maxUnits: 5, // 出撃できる人数
  real: false, // 本番モード（永久死亡・英霊名鑑）にするか。試作では false（変えない）
  timeLimit: 300, // 時間切れ（秒）。衛生兵だけの出撃などで終わらなくならないように
  march: 46, // 兵士の歩く速さ（px/秒）。兵種の march（騎兵など）を掛ける
  sep: 24, // 兵士・敵どうしが重なり続けない距離
  meleeReach: 34, // 近接の攻撃が届く距離（体の大きさを足す）
  kite: 0.45, // 遠距離の兵士は、敵が射程のこの割合より近いと下がる
  aggro: 190, // 敵が兵士に気づく距離（道の合流点を過ぎると、どこにいても狙う）
  levelMul: 0.7, // 敵の強さ：出撃した兵士の平均Lvのこの倍率
  hpMul: 1, // 敵の体力の倍率（個人戦向け）
  atkMul: 0.55, // 敵の攻撃の倍率（個人戦向け。5人で囲まれても一瞬で倒れないように）
  bossHp: 1, // 中ボスの体力の倍率（大将の表はもともと硬い）
  bossAtk: 1, // 中ボスの攻撃の倍率
};
// マップ：道（敵の進む線）・合流点・味方の配置場所・砦・出現の順番。座標はゲームの 960×600
const TRIAL_MAPS = {
  sanpou: {
    name: "三方の関",
    text: "上・中央・下の3つの道から敵が攻めてくる。道は関の手前で合流する",
    lanes: {
      top: [[-20, 92], [230, 92], [430, 230], [585, 300]],
      mid: [[-20, 300], [585, 300]],
      bot: [[-20, 508], [230, 508], [430, 370], [585, 300]],
    },
    join: [585, 300], // 合流点：ここを過ぎた敵は、どこにいる兵士でも狙う
    road: [[585, 300], [905, 300]], // 合流点から関（砦）までの道
    fort: { x: 880, y: 300 },
    deploy: { x: 640, y: 170, w: 210, h: 260 }, // 味方の配置場所
    labels: { top: "北の道", mid: "中央の道", bot: "南の道" },
    // 出現：t 秒に lane から kind を n 体（role mid は中ボス）
    waves: [
      { t: 1, lane: "top", kind: "goblin", n: 2 },
      { t: 1, lane: "mid", kind: "goblin", n: 2 },
      { t: 1, lane: "bot", kind: "goblin", n: 2 },
      { t: 13, lane: "top", kind: "knight", n: 1 },
      { t: 13, lane: "mid", kind: "wolf", n: 2 },
      { t: 14, lane: "bot", kind: "dragon", n: 2 },
      { t: 27, lane: "mid", kind: "knight", n: 2 },
      { t: 28, lane: "top", kind: "dragon", n: 1 },
      { t: 28, lane: "bot", kind: "goblin", n: 2 },
      { t: 42, lane: "top", kind: "wolf", n: 2 },
      { t: 42, lane: "bot", kind: "knight", n: 1 },
      { t: 43, lane: "mid", kind: "dragon", n: 2 },
      { t: 58, lane: "mid", kind: "boss", n: 1, role: "mid" },
      { t: 58, lane: "top", kind: "goblin", n: 2 },
      { t: 58, lane: "bot", kind: "goblin", n: 2 },
    ],
  },
};
const trialStage = (id) => TRIAL_MAPS[id] || TRIAL_MAPS.sanpou;
let trial = null, // 戦場試練の状態（防衛戦の間は null）
  trialPick = [], // 出撃に選んだ兵士ID（保存しない）
  trialScenery = null,
  trialSceneryKey = "",
  trialResultView = null; // 直前の結果（結果の画面用）
const trialDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 出撃できる兵士：保存済みで生存している兵士（主人公も可）
const trialEligible = (s) => !!(s && s.alive && !s.out && savedSoldier(s.id));
function trialBusyError() {
  if (trial) return "戦場試練の最中です。";
  if (battle) return "攻城戦の最中は始められません。";
  if (training) return "修練場で挑戦中は始められません。";
  if (playing) return "防衛のウェーブ中は始められません。ウェーブの合間に始めよう。";
  return null;
}
// 試練の兵：本番の兵士を読むだけの写し（HP・位置・攻撃の待ちは試練の中だけ）
function trialUnit(s, i) {
  const st = soldierStats(s),
    ct = unitOf(s);
  return {
    id: s.id,
    src: s, // 読むだけ（書き込まない）
    name: soldierName(s),
    type: s.type,
    job: upperJob(s),
    role: ct.heal ? "heal" : ct.range > 60 ? "ranged" : "melee",
    shot: ct.shot || null,
    range: st.range,
    speed: TRIAL_RULES.march * (ct.march || 1),
    max: st.maxHp,
    hp: st.maxHp,
    x: 0,
    y: 0,
    placed: false,
    cd: 0.3 + i * 0.15,
    atk: 0,
    hit: 0,
    face: 1,
    target: null,
    charged: null,
    kills: 0,
    dealt: 0,
    healed: 0,
    dead: false,
    walk: 0,
    seed: i,
  };
}
// 敵：修練場と同じ強さの表（TRAINING）を、出撃した兵士の平均Lvから決めた敵Lvで使う
function trialEnemy(kind, L, role, lane, path, n) {
  const c = TRAINING.base[kind],
    max = c[0] * TRAINING.hp(L) * TRIAL_RULES.hpMul * (role === "mid" ? TRIAL_RULES.bossHp : 1);
  return {
    id: "te" + n,
    kind,
    role: role || null,
    lv: L,
    hp: max,
    max,
    armor: (WARLORD_RULES.enemyArmor[kind] || 0) + TRAINING.armor(L),
    speed: c[1] * TRAINING.speed(L) * 0.8,
    color: c[3],
    r: c[4] * (role ? 1.25 : 1),
    atkMul: TRAINING.atk(L) * TRIAL_RULES.atkMul * (role ? TRIAL_RULES.bossAtk : 1),
    lane,
    path,
    wp: 1,
    x: path[0][0],
    y: path[0][1] + ((n % 3) - 1) * 12,
    d: 0,
    cd: 0.8,
    atkAnim: 0,
    hit: 0,
    face: 1,
    joined: false,
    target: null,
    gone: false,
  };
}
// 出撃の準備：選んだ兵士で、配置の段階を始める
function startTrial(ids, stageId = "sanpou") {
  const busy = trialBusyError();
  if (busy) return busy;
  const list = [...new Set(ids)].map((id) => soldierById(id)).filter(trialEligible);
  if (!list.length) return "出撃する兵士を選んでください（保存済みで生存している兵士）。";
  if (list.length > TRIAL_RULES.maxUnits) return "出撃できるのは" + TRIAL_RULES.maxUnits + "人までです。";
  const M = trialStage(stageId),
    avg = list.reduce((n, s) => n + s.level, 0) / list.length;
  trial = {
    id: "trial:" + Date.now().toString(36),
    stage: stageId,
    map: M,
    phase: "deploy", // deploy（配置）→ fight（戦闘）→ end
    t: 0,
    units: list.map(trialUnit),
    enemies: [],
    queue: M.waves.flatMap((w) => Array.from({ length: w.n }, (_, k) => ({ t: w.t + k * 0.9, lane: w.lane, kind: w.kind, role: w.role || null }))).sort((a, b) => a.t - b.t),
    spawned: 0,
    total: M.waves.reduce((n, w) => n + w.n, 0),
    level: Math.max(1, Math.round(avg * TRIAL_RULES.levelMul)),
    kills: 0,
    result: null,
  };
  trial.queue.forEach((q, i) => (q.n = i));
  shots = [];
  effects.length = 0;
  trialSyncUI();
  return null;
}
// 配置：タップした所（配置場所の中）に、まだ置いていない兵士を1人ずつ置く
function trialPlace(x, y) {
  const T = trial;
  if (!T || T.phase !== "deploy") return "いまは配置できません。";
  const D = T.map.deploy;
  if (x < D.x || x > D.x + D.w || y < D.y || y > D.y + D.h) return "光っている場所（関の手前）に配置します。";
  const u = T.units.find((v) => !v.placed);
  if (!u) return "全員を配置しました。「⚔ 戦闘開始」を押してください。";
  Object.assign(u, { x, y, placed: true, home: { x, y } });
  trialSyncUI();
  return null;
}
// 自動で並べる（まだ置いていない兵士を、近接は前・遠距離と衛生兵は後ろに）
function trialAutoPlace() {
  const T = trial;
  if (!T || T.phase !== "deploy") return;
  const D = T.map.deploy,
    rest = T.units.filter((u) => !u.placed),
    col = (u) => (u.role === "melee" ? 0 : u.role === "ranged" ? 1 : 2);
  rest.sort((a, b) => col(a) - col(b));
  rest.forEach((u, i) => {
    const c = col(u),
      same = rest.filter((v) => col(v) === c),
      k = same.indexOf(u);
    trialPlace(D.x + 30 + c * 70, D.y + D.h / 2 + (k - (same.length - 1) / 2) * 52);
  });
}
function trialBegin() {
  const T = trial;
  if (!T || T.phase !== "deploy") return "いまは始められません。";
  if (T.units.some((u) => !u.placed)) return "全員を配置してから始めます（「自動で並べる」も使えます）。";
  T.phase = "fight";
  msg("⚔️ 戦場試練「" + T.map.name + "」開始！ 兵士はそれぞれ自分で戦います。");
  trialSyncUI();
  return null;
}
// ===== 戦闘処理（毎フレーム。gameStep の時間で進む） =====
function tickTrial(dt) {
  const T = trial;
  if (!T || T.phase !== "fight" || T.result) return;
  T.t += dt;
  while (T.queue.length && T.queue[0].t <= T.t) {
    const q = T.queue.shift(),
      path = T.map.lanes[q.lane];
    T.enemies.push(trialEnemy(q.kind, T.level, q.role, q.lane, path, q.n));
    T.spawned++;
  }
  const live = T.units.filter((u) => !u.dead),
    foes = T.enemies.filter((e) => !e.gone);
  for (const u of live) trialUnitAct(u, foes, live, dt);
  for (const e of foes) trialEnemyAct(e, live, dt);
  trialSeparate(T.units.filter((u) => !u.dead), 1);
  trialSeparate(T.enemies.filter((e) => !e.gone), 0.6);
  trialSeparateBetween(T.units.filter((u) => !u.dead), T.enemies.filter((e) => !e.gone));
  for (const u of T.units) {
    u.atk = Math.max(0, u.atk - dt);
    u.hit = Math.max(0, u.hit - dt);
  }
  for (const e of T.enemies) {
    e.atkAnim = Math.max(0, e.atkAnim - dt);
    e.hit = Math.max(0, e.hit - dt);
  }
  if (!T.units.some((u) => !u.dead)) return endTrial("lose");
  if (!T.queue.length && !T.enemies.some((e) => !e.gone)) return endTrial("win");
  if (T.t >= TRIAL_RULES.timeLimit) return endTrial("timeout");
}
const trialNearest = (from, list) => {
  let best = null,
    bd = Infinity;
  for (const o of list) {
    const d = trialDist(from, o);
    if (d < bd) (bd = d), (best = o);
  }
  return best;
};
function trialMove(o, tx, ty, speed, dt) {
  const dx = tx - o.x,
    dy = ty - o.y,
    d = Math.hypot(dx, dy);
  if (d < 0.5) return;
  const step = Math.min(d, speed * dt);
  o.x += (dx / d) * step;
  o.y += (dy / d) * step;
  o.face = dx < 0 ? -1 : 1;
  o.walk = (o.walk || 0) + step;
  o.x = Math.max(10, Math.min(950, o.x));
  o.y = Math.max(40, Math.min(580, o.y));
}
// 兵士1人の行動：衛生兵は傷ついた味方を回復、近接は近づいて斬る、遠距離は射程を保って撃つ
function trialUnitAct(u, foes, live, dt) {
  const s = u.src;
  u.cd -= dt;
  if (u.role === "heal") {
    let best = null,
      ratio = 0.97;
    for (const v of live) {
      const r = v.hp / v.max;
      if (v !== u && r < ratio) (ratio = r), (best = v);
    }
    if (!best && u.hp < u.max * 0.97) best = u; // 自分しか傷ついていなければ自分
    if (!best) {
      // けが人がいない：一番前で戦っている味方の少し後ろへ
      const front = live.filter((v) => v !== u && v.role !== "heal").sort((a, b) => a.x - b.x)[0];
      if (front) {
        const tx = front.x + 60,
          ty = front.y;
        if (trialDist(u, { x: tx, y: ty }) > 20) trialMove(u, tx, ty, u.speed * 0.8, dt);
      }
      return;
    }
    const d = trialDist(u, best);
    if (d > u.range * 0.8 && best !== u) return trialMove(u, best.x, best.y, u.speed, dt);
    if (u.cd > 0) return;
    const st = soldierStats(s),
      amount = Math.min(st.heal, best.max - best.hp);
    u.cd = st.rate;
    if (amount <= 0) return;
    best.hp += amount;
    u.healed += amount;
    u.atk = 0.18;
    burst(best.x, best.y - 16, "#7be08a", "heal");
    return;
  }
  // 狙う敵：いまの相手が生きていれば続ける（少し遠くなっても）。いなければ一番近い敵
  if (!u.target || u.target.gone || trialDist(u, u.target) > u.range + 260) u.target = trialNearest(u, foes);
  const e = u.target;
  if (!e) {
    // 敵がいない：配置した場所へ戻る
    if (u.home && trialDist(u, u.home) > 6) trialMove(u, u.home.x, u.home.y, u.speed * 0.7, dt);
    return;
  }
  const d = trialDist(u, e),
    reach = u.role === "melee" ? Math.max(u.range, TRIAL_RULES.meleeReach) + (e.r || 12) : u.range;
  if (u.role === "ranged" && d < u.range * TRIAL_RULES.kite && ENEMY_VS_UNIT[e.kind] && !ENEMY_VS_UNIT[e.kind].ranged) {
    // 近づかれたら少し下がる（関の方へ）
    const bx = u.x + (u.x - e.x) / (d || 1) * 40,
      by = u.y + (u.y - e.y) / (d || 1) * 40;
    trialMove(u, bx, by, u.speed * 0.7, dt);
  } else if (d > reach) return trialMove(u, e.x, e.y, u.speed, dt);
  u.face = e.x < u.x ? -1 : 1;
  if (u.cd > 0 || d > reach) return;
  const st = soldierStats(s),
    ct = unitOf(s);
  u.cd = st.rate;
  u.atk = 0.18;
  let raw = st.atk * (e.kind === "boss" ? 1 + skillSum(s, "vsBoss") : 1);
  if (ct.charge && u.charged !== e) {
    // 突撃（騎兵）：新しい敵への最初の一撃だけ強い
    u.charged = e;
    raw *= ct.charge + skillSum(s, "chargeAdd");
  }
  trialHitEnemy(u, e, raw);
  if (u.role === "melee") burst(e.x, e.y - 10, "#fff1c4", "slash");
  else {
    const musket = u.shot === "musket";
    if (musket) burst(u.x + u.face * 14, u.y - 20, "#ffe6a0", "gunsmoke");
    if (shots.length >= 160) shots.shift();
    shots.push({ x: u.x + (musket ? u.face * 14 : 0), y: u.y - 22, tx: e.x, ty: e.y - 8, type: musket ? "magic" : "arrow", age: 0, duration: musket ? 0.12 : 0.22, col: "#a56b35" });
  }
}
// 兵士の攻撃のダメージ：敵の防御で減る（防衛戦と同じ式。防御無視のスキルも効く）
function trialHitEnemy(u, e, raw) {
  const ignore = Math.min(1, skillSum(u.src, "armorPierce")),
    dmg = (raw * 30) / (30 + (e.armor || 0) * (1 - ignore));
  e.hp -= dmg;
  e.hit = 0.18;
  u.dealt += dmg;
  if (e.hp <= 0 && !e.gone) {
    e.gone = true;
    u.kills++;
    trial.kills++;
    burst(e.x, e.y - 8, "#ffd9a0", "slash");
  }
}
// 敵1体の行動：道を進み、兵士に気づいたら狙って攻撃（遠距離の敵は射程で止まって撃つ）
function trialEnemyAct(e, live, dt) {
  e.cd -= dt;
  const a = ENEMY_VS_UNIT[e.kind] || ENEMY_VS_UNIT.goblin,
    range = a.ranged || 0;
  if (!e.target || e.target.dead || (!e.joined && trialDist(e, e.target) > TRIAL_RULES.aggro + 60)) e.target = null;
  if (!e.target) {
    const n = trialNearest(e, live);
    if (n && (e.joined || trialDist(e, n) <= TRIAL_RULES.aggro)) e.target = n;
  }
  const u = e.target;
  if (!u) {
    // 道を進む（合流点を過ぎたら関へ）
    const p = e.path[e.wp] || trial.map.road[1];
    trialMove(e, p[0], p[1] + (e.lane === "mid" ? 0 : 0), e.speed, dt);
    if (Math.hypot(p[0] - e.x, p[1] - e.y) < 8) {
      if (e.wp < e.path.length) e.wp++;
      if (e.wp >= e.path.length) e.joined = true;
    }
    return;
  }
  const d = trialDist(e, u),
    reach = range || TRIAL_RULES.meleeReach + 10;
  if (d > reach) return trialMove(e, u.x, u.y, e.speed, dt);
  e.face = u.x < e.x ? -1 : 1;
  if (e.cd > 0) return;
  e.cd = a.rate;
  e.atkAnim = 0.35;
  trialHitUnit(u, a.damage * (e.atkMul || 1), !!range, e);
  if (range) {
    if (shots.length >= 160) shots.shift();
    shots.push({ x: e.x, y: e.y - 18, tx: u.x, ty: u.y - 10, type: "arrow", age: 0, duration: 0.25, col: "#5a3420" });
  } else burst(u.x, u.y - 8, "#ffb0a0", "slash");
}
// 敵の攻撃のダメージ：兵士の防御・受けるダメージ軽減のスキル（防衛戦と同じ式）。一撃は最大HPの6割まで
function trialHitUnit(u, raw, ranged, e) {
  const s = u.src,
    st = soldierStats(s),
    weak = unitOf(s).spearWeak,
    spear = weak && e.kind === "knight" ? 1 + (weak - 1) * (1 - skillSum(s, "spearGuard")) : 1,
    guard = (1 - skillSum(s, "guard")) * (ranged ? (1 - skillSum(s, "rangedGuard")) * (unitOf(s).rangedWeak || 1) : 1) * spear,
    dmg = Math.min(((raw * SQUAD_RULES.defenseScale) / (SQUAD_RULES.defenseScale + st.def)) * guard, u.max * TRAINING.maxHit);
  u.hp -= dmg;
  u.hit = 0.2;
  if (u.hp <= 0 && !u.dead) {
    // 試作：仮の戦死（本番の兵士・英霊名鑑には反映しない）
    u.hp = 0;
    u.dead = true;
    u.diedAt = trial.t;
    u.killedBy = e.kind;
    msg("☠ " + u.name + " が倒れた（戦場試練・試作のため本番の兵士は無事）");
  }
}
// 重なり続けないように、近すぎる相手と少し離れる
function trialSeparate(list, k) {
  const R = TRIAL_RULES.sep;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i],
        b = list[j],
        dx = b.x - a.x,
        dy = b.y - a.y,
        d = Math.hypot(dx, dy) || 0.01;
      if (d >= R) continue;
      const push = ((R - d) / 2) * k;
      a.x -= (dx / d) * push;
      a.y -= (dy / d) * push;
      b.x += (dx / d) * push;
      b.y += (dy / d) * push;
    }
}
function trialSeparateBetween(us, es) {
  for (const u of us)
    for (const e of es) {
      const R = 18 + (e.r || 12) * 0.5,
        dx = u.x - e.x,
        dy = u.y - e.y,
        d = Math.hypot(dx, dy) || 0.01;
      if (d >= R) continue;
      const push = (R - d) / 2;
      u.x += (dx / d) * push;
      u.y += (dy / d) * push;
      e.x -= (dx / d) * push;
      e.y -= (dy / d) * push;
    }
}
// 戦闘の終わり：win（全滅させた）・lose（味方が全滅）・retreat（撤退）・timeout（時間切れ）
// 試作では本番の兵士・保存データに何も書かない。本番にするときは、ここで TRIAL_RULES.real を見て recordDeath へ渡す
function endTrial(result) {
  const T = trial;
  if (!T || T.result) return;
  T.result = result;
  T.phase = "end";
  trialResultView = {
    stage: T.map.name,
    result,
    time: T.t,
    level: T.level,
    kills: T.kills,
    total: T.total,
    units: T.units.map((u) => ({ id: u.id, name: u.name, job: JOBS[jobOf(u.src)] ? JOBS[jobOf(u.src)].icon + jobName(u.src) : "", lv: u.src.level, dead: u.dead, hp: Math.ceil(u.hp), max: Math.round(u.max), kills: u.kills, healed: Math.round(u.healed) })),
    real: TRIAL_RULES.real,
  };
  trial = null;
  shots = [];
  effects.length = 0;
  trialSyncUI();
  openTrialSheet("result");
}
function retreatTrial() {
  if (!trial) return;
  if (trial.phase === "deploy") {
    trial = null;
    trialSyncUI();
    return msg("出撃をやめた。");
  }
  endTrial("retreat");
}
// ===== 描画 =====
function trialBackground(M) {
  const key = (pixelOn() ? "p" : "c") + RS + M.name;
  if (trialScenery && trialSceneryKey === key) return trialScenery;
  trialSceneryKey = key;
  const cv = document.createElement("canvas");
  cv.width = C.width;
  cv.height = C.height;
  const g = cv.getContext("2d");
  g.setTransform(RS, 0, 0, RS, 0, 0);
  // 草地（少しまだら）
  g.fillStyle = "#5f9a4c";
  g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() < 0.5 ? "#6aa756" : "#558c43";
    g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 6, 4);
  }
  // 道：縁の濃い色 → 土の色（3本は合流点で1本に）
  const road = (pts, w, col) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  const all = [...Object.values(M.lanes), M.road];
  for (const p of all) road(p, 50, "#7a5a36");
  for (const p of all) road(p, 40, "#d4b07a");
  for (const p of all) road(p, 3, "#c49c62");
  // 配置場所の地面（石畳の広場）
  const D = M.deploy;
  g.fillStyle = "#b9a27c";
  g.fillRect(D.x - 6, D.y - 6, D.w + 12, D.h + 12);
  g.fillStyle = "#cdb88f";
  for (let x = D.x; x < D.x + D.w; x += 30) for (let y = D.y; y < D.y + D.h; y += 26) g.fillRect(x + ((y / 26) % 2) * 15, y, 26, 22);
  // 両側の土塁と柵（関）
  g.fillStyle = "#6b5233";
  g.fillRect(612, 60, 18, 90);
  g.fillRect(612, 450, 18, 90);
  // 木と岩（ドット絵のときは素材を使う）
  const deco = [["pine0", 60, 210], ["pine1", 120, 400], ["round0", 330, 40], ["sakura0", 300, 560], ["pine0", 520, 120], ["round1", 520, 480], ["bamboo0", 700, 70], ["pine1", 780, 560], ["rock", 360, 300], ["bush0", 160, 300], ["rock", 680, 520], ["sakura1", 900, 90], ["round0", 930, 520]];
  // 素材のコマ [sx, sy, w, h, 足元の x, 足元の y]（pixDraw と同じ）を、背景の画像へ描く
  const pix = (name, x, bottom, k) => {
    const f = PIX.frames[name];
    if (!f || !PIX.atlas) return false;
    const [sx, sy, w, h, ax, ay] = f;
    g.imageSmoothingEnabled = false;
    g.drawImage(PIX.atlas, sx, sy, w, h, x - ax * k, bottom - ay * k, w * k, h * k);
    return true;
  };
  if (pixelOn() && PIX.atlas) for (const [f, x, y] of [...deco].sort((a, b) => a[2] - b[2])) pix(PIX.frames[f] ? f : "tree_" + f, x, y, PIX_SCALE.tree); // 木は tree_ の名前
  else
    for (const [, x, y] of deco) {
      g.fillStyle = "#2f6b33";
      g.beginPath();
      g.arc(x, y - 18, 16, 0, 7);
      g.fill();
      g.fillStyle = "#6b4a2a";
      g.fillRect(x - 3, y - 6, 6, 10);
    }
  // 関（砦）：ドット絵の城、なければ簡単な櫓
  const F = M.fort;
  if (!(pixelOn() && pix("castle1_ally", F.x, F.y + 50, PIX_SCALE.castle))) {
    g.fillStyle = "#3b3b46";
    g.fillRect(F.x - 40, F.y - 70, 80, 110);
    g.fillStyle = "#8a2f2a";
    g.beginPath();
    g.moveTo(F.x - 52, F.y - 68);
    g.lineTo(F.x, F.y - 110);
    g.lineTo(F.x + 52, F.y - 68);
    g.fill();
  }
  // 道の名前
  g.font = "bold 15px system-ui";
  g.fillStyle = "#fff4d0";
  g.strokeStyle = "#3a2a16";
  g.lineWidth = 4;
  for (const [k, p] of Object.entries(M.lanes)) {
    g.strokeText(M.labels[k], 14, p[0][1] - 30);
    g.fillText(M.labels[k], 14, p[0][1] - 30);
  }
  trialScenery = cv;
  return cv;
}
function drawTrial() {
  const T = trial;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctxRaw.drawImage(trialBackground(T.map), 0, 0);
  ctx.restore();
  // 配置の段階：配置場所を光らせる
  if (T.phase === "deploy") {
    const D = T.map.deploy;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(visualTime * 4);
    ctx.strokeStyle = "#ffe27a";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(D.x, D.y, D.w, D.h);
    ctx.restore();
  }
  const actors = [];
  for (const u of T.units) if (u.placed) actors.push({ y: u.y, draw: () => trialDrawUnit(u) });
  for (const e of T.enemies) if (!e.gone) actors.push({ y: e.y, draw: () => trialDrawEnemy(e) });
  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) a.draw();
  for (const s of shots) projectile(s);
  for (const e of effects) effect(e);
  screenSpace((SW) => {
    // 上の帯：時間・敵の残り・生き残り
    const left = T.queue.length + T.enemies.filter((e) => !e.gone).length,
      alive = T.units.filter((u) => !u.dead).length,
      text = "⚔ " + T.map.name + "　敵 " + left + "/" + T.total + "　味方 " + alive + "/" + T.units.length + (T.phase === "fight" ? "　" + Math.floor(T.t) + "秒" : "　配置中");
    ctx.font = "bold 18px system-ui";
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = "#1a120ccc";
    ctx.fillRect(SW / 2 - w / 2, 6, w, 28);
    ctx.fillStyle = "#ffe9b0";
    ctx.textAlign = "center";
    ctx.fillText(text, SW / 2, 26);
  });
  drawCutin && screenSpace(drawCutin);
}
function trialDrawUnit(u) {
  const alpha = u.dead ? 0.35 : 1;
  ellipse(u.x + 2, u.y + 12, 13, 4, "#22352655");
  ctx.save();
  ctx.globalAlpha = alpha;
  unitFigure(u.type, u.x, u.y + 12, { scale: 1.15, face: u.face, job: u.job, pose: u.dead ? "death" : u.atk > 0 ? "attack" : null, walk: !u.dead && u.atk <= 0 && trial && trial.phase === "fight" && u.walkPrev !== u.walk, seed: u.seed });
  u.walkPrev = u.walk;
  ctx.restore();
  if (u.dead) return;
  if (u.hit > 0) {
    ctx.globalAlpha = u.hit * 2;
    ellipse(u.x, u.y - 8, 14, 16, "#ff7b6b");
    ctx.globalAlpha = 1;
  }
  // HPの棒（大きめ）と名前
  const r = Math.max(0, u.hp / u.max),
    bw = 54,
    top = u.y - 60;
  ctx.fillStyle = "#1a1a1acc";
  ctx.fillRect(u.x - bw / 2 - 2, top - 2, bw + 4, 13);
  ctx.fillStyle = r > 0.5 ? "#5fd36b" : r > 0.25 ? "#ffc14d" : "#ff5a4a";
  ctx.fillRect(u.x - bw / 2, top, bw * r, 9);
  ctx.font = "bold 17px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10202acc";
  ctx.fillStyle = u.role === "heal" ? "#b8ffc4" : "#e8f3ff";
  const label = u.name.length > 5 ? u.name.slice(0, 5) : u.name;
  ctx.lineWidth = 4;
  ctx.strokeText(label, u.x, top - 6);
  ctx.fillText(label, u.x, top - 6);
}
function trialDrawEnemy(e) {
  ctx.save();
  if (!drawEnemySprite(e)) soldierFallback(e);
  ctx.restore();
  if (!pixelOn()) {
    const bw = Math.max(24, e.r * 2),
      top = e.y - e.r - 22;
    ctx.fillStyle = "#3a463b";
    ctx.fillRect(e.x - bw / 2, top, bw, 5);
    ctx.fillStyle = "#ed6654";
    ctx.fillRect(e.x - bw / 2, top, bw * Math.max(0, e.hp / e.max), 5);
  }
  if (e.hit > 0) {
    ctx.globalAlpha = e.hit * 3;
    ellipse(e.x, e.y, e.r + 3, e.r + 3, "#fff6d6");
    ctx.globalAlpha = 1;
  }
}
// ===== 画面：出撃する兵士を選ぶ・結果 =====
let trialSheetMode = "pick";
function openTrialSheet(mode) {
  trialSheetMode = mode || "pick";
  if (trialSheetMode === "pick") trialPick = trialPick.filter((id) => trialEligible(soldierById(id)));
  renderTrialSheet();
  $("trialSheet").hidden = false;
  $("trialClose").focus();
}
const closeTrialSheet = () => ($("trialSheet").hidden = true);
function renderTrialSheet() {
  const M = trialStage("sanpou");
  if (trialSheetMode === "result" && trialResultView) {
    const R = trialResultView,
      title = { win: "🏆 勝利！", lose: "敗北…", retreat: "↩ 撤退", timeout: "⌛ 時間切れ（敗北）" }[R.result];
    const alive = R.units.filter((u) => !u.dead),
      dead = R.units.filter((u) => u.dead);
    $("trialTitle").textContent = "⚔️ 戦場試練「" + R.stage + "」";
    $("trialBody").innerHTML =
      '<p class="trial-result"><b>' + title + "</b></p>" +
      "<p>撃破 <b>" + R.kills + "/" + R.total + "</b>・敵Lv " + R.level + "・" + Math.floor(R.time) + "秒</p>" +
      "<p>生存 " + alive.length + "人・戦死 " + dead.length + "人" + (dead.length && !R.real ? '<br><small class="muted">試作のため戦死は仮です。本番の兵士は失われず、英霊名鑑にも載りません。</small>' : "") + "</p>" +
      '<div class="trial-units">' +
      R.units
        .map((u) => '<div class="trial-unit' + (u.dead ? " dead" : "") + '"><b>' + esc(u.name) + "</b> <small>" + esc(u.job) + "・Lv" + u.lv + "</small><br><small>" + (u.dead ? "☠ 戦死（仮）" : "生存 HP " + u.hp + "/" + u.max) + "・撃破 " + u.kills + (u.healed ? "・回復 " + u.healed : "") + "</small></div>")
        .join("") +
      "</div>" +
      '<p class="muted"><small>試作のため、報酬・経験値・熟練度はありません。</small></p>' +
      '<div class="card-actions"><button data-trial-again>もう一度（兵士を選ぶ）</button><button data-trial-close>閉じる</button></div>';
    return;
  }
  $("trialTitle").textContent = "⚔️ 戦場試練（試作）";
  const list = soldiers.filter((s) => s.alive).sort((a, b) => b.level - a.level),
    n = trialPick.length,
    busy = trialBusyError();
  $("trialBody").innerHTML =
    "<p><b>ステージ：" + M.name + "</b><br><small>" + esc(M.text) + "</small></p>" +
    '<p class="muted"><small>育てた兵士を最大' + TRIAL_RULES.maxUnits + "人まで選び、1人ずつ配置します。戦闘が始まると、兵士はそれぞれ自分で敵を探して戦います（衛生兵は味方を回復）。敵を全滅させれば勝利、味方が全滅すると敗北です。<br>" +
    "<b>試作のため、戦死は仮です（本番の兵士は失われません）。報酬・経験値もありません。</b>修練場はこれまでどおり育成の場所です。</small></p>" +
    (busy ? '<p class="injured">' + esc(busy) + "</p>" : "") +
    "<p>出撃：<b>" + n + "/" + TRIAL_RULES.maxUnits + "人</b></p>" +
    '<div class="trial-pick">' +
    list
      .map((s) => {
        const ok = trialEligible(s),
          on = trialPick.includes(s.id),
          full = !on && n >= TRIAL_RULES.maxUnits;
        return (
          '<button type="button" data-trial-pick="' + s.id + '" aria-pressed="' + on + '"' + (!ok || (full && !on) ? " disabled" : "") + ">" +
          (on ? "☑ " : "☐ ") + "<b>" + esc(soldierName(s)) + "</b> <small>" + JOBS[jobOf(s)].icon + jobName(s) + "・Lv" + s.level + (ok ? "" : "・未保存") + "</small></button>"
        );
      })
      .join("") +
    "</div>" +
    '<div class="card-actions"><button data-trial-go' + (n && !busy ? "" : " disabled") + ">⚔️ " + n + "人で出撃（配置へ）</button></div>";
}
function trialSyncUI() {
  const T = trial,
    bar = $("trialBar");
  document.body.classList.toggle("trial-on", !!T);
  bar.hidden = !T;
  if (!T) {
    if (typeof updateUI === "function") updateUI();
    return;
  }
  const rest = T.units.filter((u) => !u.placed).length;
  $("trialInfo").innerHTML =
    "<b>⚔️ 戦場試練・" + T.map.name + "</b>（試作）<br>" +
    (T.phase === "deploy"
      ? rest
        ? "配置：あと <b>" + rest + "人</b>（光っている場所をタップ）次は " + esc(T.units.find((u) => !u.placed).name)
        : "全員を配置しました。「⚔ 戦闘開始」で始まります。"
      : "兵士はそれぞれ自分で戦っています。");
  $("trialAuto").hidden = T.phase !== "deploy" || !rest;
  $("trialGo").hidden = T.phase !== "deploy";
  $("trialGo").disabled = !!rest;
  $("trialRetreat").textContent = T.phase === "deploy" ? "↩ 出撃をやめる" : "↩ 撤退";
}
$("trialOpen").onclick = () => openTrialSheet(trial ? "pick" : "pick");
$("trialClose").onclick = closeTrialSheet;
$("trialSheet").addEventListener("click", (ev) => {
  if (ev.target === $("trialSheet")) return closeTrialSheet();
  const b = ev.target.closest("button");
  if (!b || b.disabled || b.id === "trialClose") return;
  const d = b.dataset;
  if (d.trialPick) {
    const id = +d.trialPick;
    trialPick = trialPick.includes(id) ? trialPick.filter((x) => x !== id) : trialPick.length < TRIAL_RULES.maxUnits ? [...trialPick, id] : trialPick;
    renderTrialSheet();
  } else if (d.trialGo !== undefined) {
    const err = startTrial(trialPick);
    if (err) return toast(err);
    closeTrialSheet();
    msg("⚔️ 光っている場所をタップして、兵士を1人ずつ配置しよう（「自動で並べる」も使えます）。");
  } else if (d.trialAgain !== undefined) openTrialSheet("pick");
  else if (d.trialClose !== undefined) closeTrialSheet();
});
$("trialAuto").onclick = () => trialAutoPlace();
$("trialGo").onclick = () => {
  const err = trialBegin();
  if (err) toast(err);
};
$("trialRetreat").onclick = () => {
  if (trial && trial.phase === "fight" && !confirm("戦場試練から撤退しますか？")) return;
  retreatTrial();
};
// 配置のタップ（戦場試練の間だけ。防衛戦のタップ・ドラッグより先に受け取り、防衛戦へは渡さない）
for (const type of ["pointerdown", "pointermove", "pointerup", "click"])
  C.addEventListener(
    type,
    (ev) => {
      if (!trial) return;
      ev.stopImmediatePropagation();
      if (type !== "click" || trial.phase !== "deploy") return;
      const p = mapPoint(ev),
        err = trialPlace(p.x, p.y);
      if (err) toast(err);
    },
    true,
  );
