// ===== 戦場試練（v107試作・v107.1で戦闘を進化）：少人数の個人戦 =====
// tools/build.mjs が本体スクリプトへ埋め込む。防衛戦（tick）・攻城戦（tickBattle）とは別の戦闘処理。
//   ・マップ（TRIAL_MAPS）と戦闘処理（tickTrial）を分ける。ほかのステージ・洞窟は、マップのデータを足して同じ処理で動かす
//   ・兵士は1人ずつの「試練の兵」（trial.units）。本番の兵士は読むだけ。戦闘中の値（HP・技の待ち・盾など）は
//     本番の兵士を元にした「写し」（Object.create）に書くので、本番の兵士・保存データは変わらない
//   ・職業技・閃きは、防衛戦・攻城戦と同じ evolutionAction を、戦場試練用のつなぎ（trialEvolution）で使う（技の中身・待ち時間は既存のまま）
//   ・試作：戦死は仮（本番の兵士・英霊名鑑・保存データは変えない）。報酬・経験値・熟練度もなし。伝説の奥義・3回ごとの技は使わない
//   将来の本番：endTrial の結果（trial.units の dead）を、本番の戦死処理（recordDeath）へ渡す入口を1か所に置く（TRIAL_RULES.real）
const TRIAL_RULES = {
  maxUnits: 5, // 出撃できる人数
  real: false, // 本番モード（永久死亡・英霊名鑑）にするか。試作では false（変えない）
  timeLimit: 420, // 時間切れ（秒）。衛生兵だけの出撃などで終わらなくならないように（v108：戦場が広いので長め）
  march: 46, // 兵士の歩く速さ（px/秒）。兵種の march（騎兵など）・ステータス「速さ」を掛ける
  ctlSpeed: 1.25, // v108.4 スティックで操作している兵士は、この倍だけ速く歩く（三方の関。AI の兵士は変えない）
  sep: 24, // 兵士・敵どうしが重なり続けない距離
  meleeReach: 34, // 近接の攻撃が届く距離（体の大きさを足す）
  kite: 0.45, // 遠距離の兵士は、敵が射程のこの割合より近いと下がる
  aggro: 190, // 敵が兵士に気づく距離（道の合流点を過ぎると、どこにいても狙う）
  crowd: 3, // 1人の兵士を同時に狙う敵の目安（これより多いと、ほかの兵士を狙いやすくなる）
  // 敵の強さ（v107.1）：出撃した兵士の Lv と、実際の能力（職業・装備・スキル）から決める
  levelMul: 0.7, // 平均Lv のこの倍率が敵Lv の基本
  highFrom: 150, // この Lv より上は、敵Lv の伸びをゆるめる（高Lv の兵士の育成が報われるように）
  highExp: 0.82,
  powerExp: 0.3, // 職業・装備で強くなった分は、敵Lv にこの指数だけ反映する（強くなった分の大半は兵士の有利になる）
  powerCap: 3, // 反映する強さの上限（同じLvの素の兵士の何倍まで）
  sizeBase: 0.4, // 出撃人数が少ないと敵の体力・攻撃を下げる：sizeBase + sizeStep × 人数（5人で 1.0）
  sizeStep: 0.12,
  countBase: 0.4, // 出撃人数が少ないと、ふつうの敵の数も減らす：countBase + countStep × 人数（5人で全員。盾の部隊・中ボスは減らさない）
  countStep: 0.12,
  lowBase: 0.55, // 低Lv（育て始め）の兵士でも挑戦できるよう、敵の体力・攻撃を下げる：lowBase + (1 - lowBase) × min(1, 平均Lv / lowUntil)
  lowUntil: 40,
  hpMul: 1, // 敵の体力の倍率（個人戦向け）
  atkMul: 0.55, // 敵の攻撃の倍率（5人で囲まれても一瞬で倒れないように）
  bossHp: 1, // 中ボスの体力の倍率（大将の表はもともと硬い）
  bossAtk: 1, // 中ボスの攻撃の倍率
  // v108：広い戦場とカメラ・操作
  camZoom: 1, // 操作している兵士を追うときの拡大（1 = ゲームの 960×600 の広さを映す）
  camEase: 6, // カメラの追い方（大きいほど早く追いつく。急に飛ばないように少しずつ）
  stickDead: 0.15, // 仮想スティックの遊び（これより小さい傾きは止まる）
  leash: 380, // AI の兵士は、配置した所からこの距離までの敵を狙う（広い戦場でばらばらに追いかけて各個に倒されないように）
};
// v108.1 サバイバル（試作）：主人公1人（スティックで操作）＋仲間4人（AI）。敵は主人公の周りの画面の外から、時間とともに増えて出る
//   三方の関（道を進む敵・配置）とは別のルール。戦場（地形・カメラ）と戦闘の処理（攻撃・技・敵の行動）は同じものを使う
const TRIAL_SURVIVAL = {
  duration: 180, // 1回の戦闘の目安（秒）。残り時間はここまで数える
  bossAt: 150, // 強敵が出る時刻（残り30秒）。強敵を倒せば勝ち
  timeLimit: 300, // 強敵を倒せないまま、ここまで来たら時間切れ（敗北）
  start: { x: 1150, y: 600 }, // 出撃の位置（川の東・中央の道）
  slots: [[-48, -44], [-48, 44], [48, -44], [48, 44]], // 仲間の持ち場（主人公からのずれ）
  follow: 230, // 仲間は、持ち場からこの距離までの敵を狙う
  regroup: 300, // 持ち場からこれより離れたら、敵より主人公の近くへ戻るのを優先
  catchUp: 1.3, // 主人公を追いかけるときの速さ（倍）
  rejoin: 8, // 持ち場から離れたまま戻れない時間（秒）がこれを超えたら、主人公の近くへ合流させる
  heroSpeed: 1.3, // 主人公の歩く速さ（倍。敵の群れから逃げ回れるように）
  enemySpeed: 0.75, // 敵の歩く速さ（倍。主人公より少し遅い。狼は速い）
  maxAlive: 36, // 同時にいる敵の上限（iPhone の重さ）
  interval0: 2.6, // 出現の間隔（秒）：最初
  intervalEnd: 2.0, // 強敵が出る頃の間隔
  batchEvery: 60, // この秒数ごとに、1回に出る数が1体増える（1体→2体→3体）
  afterBoss: 3, // 強敵が出たあとの間隔（1体ずつ）
  margin: 70, // 画面の外のどれだけ先から出すか
  far: 1100, // 主人公からこれより遠い敵は、主人公の近くの画面の外へ移す（遠くに溜まらない）
  hp: 0.12, // 敵の体力（倍。群れで来るので1体は弱く、たくさん倒せる）
  hpGrow: 0.6, // 強敵が出る頃に、体力が (1 + hpGrow) 倍になるまで少しずつ強くなる（v108.3：レベルアップが減った分 0.8→0.6）
  atk: 0.6, // 敵の攻撃（倍）
  atkGrow: 0.6,
  bossHp: 0.6, // 強敵の体力（倍。大将の表に掛ける。5人で20〜30秒ほど）
  bossAtk: 1,
  // v108.2 主人公1人から始まる。敵を倒すと、この戦闘だけの経験値（本番の兵士の経験値・Lv には入らない）
  xp: { goblin: 1, wolf: 1, knight: 2, dragon: 2, boss: 0 }, // 敵1体の経験値
  need: (lv) => 4 + 5 * (lv - 1), // サバイバルLv lv から次へ上がるのに要る経験値（4・9・14・19…。v108.3：3分で5〜7回）
  recruitMax: 4, // 加入できる仲間（出撃の前に選んだ候補）の数
  // レベルアップの強化（この戦闘の主人公だけ。終わったら消える）。step は1回の上がり幅
  boons: {
    atk: { icon: "⚔️", name: "攻撃力アップ", text: "与えるダメージ・回復 +25%", step: 0.25 },
    rate: { icon: "⚡", name: "攻撃速度アップ", text: "攻撃の間隔 −15%", step: 0.15 },
    move: { icon: "👟", name: "移動速度アップ", text: "歩く速さ +15%", step: 0.15 },
    hp: { icon: "❤️", name: "最大HPアップ", text: "最大HP +25%（増えた分を回復）", step: 0.25 },
    def: { icon: "🛡️", name: "防御力アップ", text: "受けるダメージ −15%", step: 0.15 },
    range: { icon: "🎯", name: "攻撃範囲アップ", text: "射程・間合い +20%", step: 0.2 },
  },
  // 出てくる敵の種類（時刻ごと）
  pools: [
    [0, ["goblin"]],
    [25, ["goblin", "goblin", "wolf"]],
    [55, ["goblin", "wolf", "knight"]],
    [85, ["goblin", "wolf", "knight", "dragon"]],
    [115, ["goblin", "wolf", "knight", "knight", "dragon", "dragon"]],
  ],
};
// マップ：道（敵の進む線）・合流点・味方の配置場所・砦・地形・出現の順番。座標は戦場（world）の座標
//   v108：三方の関を 1920×1200（以前の 960×600 の4倍の広さ）に広げ、カメラで動かして見る
//   river：川（通れない帯）。bridges：橋（川を渡れる所。道が川を渡る所に1本ずつ）
//   rocks・forests：木と岩（通れない丸）。避けて歩く（押し出される）だけの簡単なしくみ
const trialForest = (cx, cy, n, spread, seed) => {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(),
      d = spread * Math.sqrt(rnd());
    return { x: Math.round(cx + Math.cos(a) * d), y: Math.round(cy + Math.sin(a) * d * 0.8), r: 18, kind: ["pine0", "pine1", "round0", "round1", "sakura0"][i % 5] };
  });
};
const TRIAL_MAPS = {
  sanpou: {
    name: "三方の関",
    text: "広い原野。北・中央・南の3つの道から敵が攻めてくる。川は橋でしか渡れない。道は関の手前で合流する",
    size: { w: 1920, h: 1200 },
    lanes: {
      top: [[-30, 170], [560, 170], [830, 170], [1080, 360], [1260, 600]],
      mid: [[-30, 600], [1260, 600]],
      bot: [[-30, 1030], [560, 1030], [830, 1030], [1080, 840], [1260, 600]],
    },
    join: [1260, 600], // 合流点：ここを過ぎた敵は、どこにいる兵士でも狙う
    road: [[1260, 600], [1860, 600]], // 合流点から関（砦）までの道
    fort: { x: 1800, y: 600 },
    gate: { x: 1300, y0: 360, y1: 840 }, // 関所の土塁（見た目だけ。道の所は門）
    deploy: { x: 1340, y: 440, w: 300, h: 320 }, // 味方の配置場所
    river: { x0: 680, x1: 750 },
    bridges: [
      { x0: 668, x1: 762, y0: 136, y1: 204 },
      { x0: 668, x1: 762, y0: 566, y1: 634 },
      { x0: 668, x1: 762, y0: 996, y1: 1064 },
    ],
    obstacles: [
      ...trialForest(400, 390, 9, 120, 11),
      ...trialForest(400, 810, 9, 120, 23),
      ...trialForest(1080, 150, 6, 80, 37),
      ...trialForest(1080, 1050, 6, 80, 41),
      ...trialForest(1560, 230, 6, 90, 53),
      ...trialForest(1560, 970, 6, 90, 59),
      { x: 960, y: 520, r: 16, kind: "rock" },
      { x: 990, y: 690, r: 16, kind: "rock" },
      { x: 250, y: 600 - 110, r: 16, kind: "rock" },
      { x: 1180, y: 470, r: 16, kind: "rock" },
    ],
    labels: { top: "北の道", mid: "中央の道", bot: "南の道" },
    // 出現：t 秒に lane から kind を n 体（role mid は中ボス。formation tate は盾兵が前・鉄砲足軽2体が後ろ）
    waves: [
      { t: 1, lane: "top", kind: "goblin", n: 2 },
      { t: 1, lane: "mid", kind: "goblin", n: 2 },
      { t: 1, lane: "bot", kind: "goblin", n: 2 },
      { t: 13, lane: "top", kind: "knight", n: 1 },
      { t: 13, lane: "mid", kind: "wolf", n: 2 },
      { t: 14, lane: "bot", kind: "dragon", n: 2 },
      { t: 27, lane: "mid", formation: "tate", n: 3 },
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
  trialMode = "field", // 出撃の画面で選ぶ遊び方：field（三方の関）・survival（サバイバル）。保存しない
  trialHero = null, // サバイバルの主人公（選んだ兵士の中の1人。保存しない）
  trialScenery = null,
  trialSceneryKey = "",
  trialResultView = null, // 直前の結果（結果の画面用）
  trialHud = ""; // 帯の文字（変わったときだけ書き換える）
const trialDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const T_now = () => (trial ? trial.t : 0);
// 出撃できる兵士：保存済みで生存している兵士（主人公も可）
const trialEligible = (s) => !!(s && s.alive && !s.out && savedSoldier(s.id));
function trialBusyError() {
  if (trial) return "戦場試練の最中です。";
  if (battle) return "攻城戦の最中は始められません。";
  if (training) return "修練場で挑戦中は始められません。";
  if (playing) return "防衛のウェーブ中は始められません。ウェーブの合間に始めよう。";
  return null;
}
// 試練の写し：本番の兵士を読み、戦闘中の値だけを自分に持つ（本番の兵士へは書き込まない）。経験値も入らない（trialShadow）
function trialShadow(s, hp) {
  const sh = Object.create(s);
  Object.assign(sh, { trialShadow: true, alive: true, out: false, siegeOut: false, hp, evolution: null, evolutionShield: null, evolutionGuard: null });
  return sh;
}
// 兵士の強さ（比べるための目安）：1秒あたりの攻撃（回復）× 耐久（HP と防御）。武将の配属は戦場試練では使わない
function trialPower(st) {
  const dps = Math.max(st.atk, st.heal * 0.8) / Math.max(0.3, st.rate);
  return Math.sqrt(dps * st.maxHp * (1 + st.def / SQUAD_RULES.defenseScale));
}
// 同じ Lv の素の兵士（職業・装備・スキル・能力の書なし）の強さ
function trialBasePower(s) {
  const c = SOLDIER_TYPES[s.type],
    k = (key) => chronicleGrowthBase(s, key);
  return trialPower({ atk: k("atk"), heal: k("heal"), rate: c.rate, maxHp: k("hp"), def: k("def") });
}
function trialUnit(s, i) {
  const st0 = soldierStats(s, true),
    sh = trialShadow(s, st0.maxHp),
    ct = unitOf(s);
  const u = {
    id: s.id,
    src: s, // 読むだけ（書き込まない）
    sh, // 戦闘中の写し（HP・技の待ち・盾）
    name: soldierName(s),
    type: s.type,
    job: upperJob(s),
    jobKey: jobOf(s),
    role: ct.heal ? "heal" : ct.range > 60 ? "ranged" : "melee",
    shot: ct.shot || null,
    range: st0.range,
    // v108.4 歩く速さ：攻城戦の進軍と同じ式（兵種の march × ステータス「速さ」× スキルの march）。本編の式は変えない
    speed: TRIAL_RULES.march * (ct.march || 1) * (1 + pointBonus(s, "spd")) * Math.max(0.3, 1 + skillSum(s, "march")),
    max: st0.maxHp,
    power: trialPower(st0),
    basePower: trialBasePower(s),
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
    skills: {}, // 使った職業技・閃き { 技名: 回数 }
    dead: false,
    walk: 0,
    seed: i,
  };
  Object.defineProperty(u, "hp", { get: () => sh.hp, set: (v) => (sh.hp = v), enumerable: true });
  return u;
}
// 敵Lv：平均Lv（高Lv はゆるめる）× 職業・装備の強さ（指数を小さく・上限つき）
function trialEnemyLevel(units) {
  const R = TRIAL_RULES,
    avg = units.reduce((n, u) => n + u.src.level, 0) / units.length,
    lv = avg <= R.highFrom ? avg : R.highFrom + Math.pow(avg - R.highFrom, R.highExp),
    ratio = units.reduce((n, u) => n + Math.min(R.powerCap, Math.max(1, u.power / Math.max(1, u.basePower))), 0) / units.length;
  const low = R.lowBase + (1 - R.lowBase) * Math.min(1, avg / R.lowUntil);
  return { level: Math.max(1, Math.round(lv * R.levelMul * Math.pow(ratio, R.powerExp))), avg, ratio, size: (R.sizeBase + R.sizeStep * units.length) * low, low };
}
// 敵：修練場と同じ強さの表（TRAINING）を、敵Lv で使う。behavior は PR #127 の盾兵・鉄砲足軽
function trialEnemy(spec, T, n) {
  const B = spec.behavior && ENEMY_BEHAVIORS[spec.behavior],
    kind = B ? B.base : spec.kind,
    L = T.level,
    role = spec.role || null,
    c = TRAINING.base[kind],
    path = spec.at ? [[spec.at.x, spec.at.y]] : T.map.lanes[spec.lane],
    max = c[0] * TRAINING.hp(L) * TRIAL_RULES.hpMul * T.size * (role === "mid" ? TRIAL_RULES.bossHp : 1) * (B ? B.hp : 1) * (spec.hpMul || 1);
  return {
    id: "te" + n,
    kind,
    behavior: spec.behavior || null,
    role,
    lv: L,
    hp: max,
    max,
    armor: (WARLORD_RULES.enemyArmor[kind] || 0) + TRAINING.armor(L) + ((B && B.armor) || 0),
    speed: c[1] * TRAINING.speed(L) * 0.8 * ((B && B.speed) || 1) * (spec.speedMul || 1),
    color: c[3],
    r: c[4] * (role ? 1.25 : 1),
    atkMul: TRAINING.atk(L) * TRIAL_RULES.atkMul * T.size * (role ? TRIAL_RULES.bossAtk : 1) * (spec.atkMul || 1),
    attackConf: B && B.attack ? { ...(ENEMY_VS_UNIT[kind] || {}), ...B.attack } : ENEMY_VS_UNIT[kind] || ENEMY_VS_UNIT.goblin,
    lane: spec.lane,
    lanePath: path, // 道（path という名前は防衛戦の道の処理が使うので避ける）
    wp: 1,
    x: path[0][0] - (spec.back || 0),
    y: path[0][1] + ((n % 3) - 1) * 12,
    d: 0,
    cd: 0.8,
    atkAnim: 0,
    hit: 0,
    face: 1,
    joined: !!spec.at, // サバイバルの敵は道を通らず、はじめから兵士を追う
    target: null,
    retarget: 0,
    gone: false,
    stuck: 0,
    lastX: path[0][0],
    lastY: path[0][1],
  };
}
// 出撃の準備：選んだ兵士で、配置の段階を始める
function startTrial(ids, stageId = "sanpou", opts = {}) {
  const busy = trialBusyError();
  if (busy) return busy;
  const list = [...new Set(ids)].map((id) => soldierById(id)).filter(trialEligible);
  if (!list.length) return "出撃する兵士を選んでください（保存済みで生存している兵士）。";
  if (list.length > TRIAL_RULES.maxUnits) return "出撃できるのは" + TRIAL_RULES.maxUnits + "人までです。";
  const M = trialStage(stageId),
    units = list.map(trialUnit),
    D = trialEnemyLevel(units);
  if (opts.mode === "survival") return startSurvival(list, units, M, D, stageId, opts.hero);
  const queue = [],
    keep = Math.min(1, TRIAL_RULES.countBase + TRIAL_RULES.countStep * units.length);
  let acc = 1 - keep; // 最初の敵は必ず出す
  M.waves.forEach((w) => {
    if (w.formation === "tate") {
      // 盾兵1体が前、鉄砲足軽2体が後ろ（同じ時刻に、少し後ろから）
      queue.push({ t: w.t, lane: w.lane, behavior: "tate", lead: true });
      queue.push({ t: w.t, lane: w.lane, behavior: "teppo", follow: true, back: 40 });
      queue.push({ t: w.t, lane: w.lane, behavior: "teppo", follow: true, back: 80 });
    } else
      for (let k = 0; k < w.n; k++) {
        if (!w.role && (acc += keep) < 1) continue; // 人数が少ないときは、ふつうの敵を一定の割合で減らす（どの道からも出る）
        if (!w.role) acc -= 1;
        queue.push({ t: w.t + k * 0.9, lane: w.lane, kind: w.kind, role: w.role || null });
      }
  });
  queue.sort((a, b) => a.t - b.t);
  queue.forEach((q, i) => (q.n = i));
  trial = {
    id: "trial:" + Date.now().toString(36),
    stage: stageId,
    map: M,
    phase: "deploy", // deploy（配置）→ fight（戦闘）→ end
    t: 0,
    units,
    enemies: [],
    queue,
    spawned: 0,
    total: queue.length,
    level: D.level,
    power: D,
    size: D.size,
    kills: 0,
    result: null,
    mode: "field", // field（三方の関：道を進む敵）・survival（サバイバル）
    control: null, // 操作している兵士の ID（null は全員自動）
    view: null, // カメラ { x, y, z }
    fxMax: 0,
  };
  shots = [];
  effects.length = 0;
  trialSyncUI();
  return null;
}
// サバイバルの出撃：配置はなし。主人公を出撃の位置に、仲間をその周りに置いて、すぐ始める
//   主人公はスティックで操作（戦闘中は変えない）。主人公が倒れたら敗北。仲間は主人公の近くの持ち場を守る
function startSurvival(list, units, M, D, stageId, heroId) {
  const S = TRIAL_SURVIVAL,
    hero = units.find((u) => u.id === heroId) || units[0];
  units.sort((a, b) => (a === hero ? -1 : b === hero ? 1 : 0));
  // v108.2：戦場に出るのは主人公1人。ほかの兵士は「仲間候補」（reserve）として待ち、レベルアップで1人ずつ加入する
  const reserve = units.slice(1, 1 + S.recruitMax);
  Object.assign(hero, { x: S.start.x, y: S.start.y, placed: true, slot: [0, 0], home: { x: S.start.x, y: S.start.y } });
  trialBoonInit(hero);
  let seed = units.reduce((n, u) => (n * 31 + u.id) % 2147483647, 7) || 7;
  trial = {
    id: "trial:" + Date.now().toString(36),
    stage: stageId,
    map: M,
    mode: "survival",
    phase: "fight",
    t: 0,
    units: [hero],
    reserve, // 仲間候補（まだ戦場にいない。選んだ順に加入）
    joined: [], // 加入した順（結果の画面用）
    enemies: [],
    queue: [],
    spawned: 0,
    total: 0,
    slv: 1, // サバイバルLv（この戦闘だけ）
    xp: 0,
    lvUps: 0, // まだ選んでいないレベルアップの数
    choice: null, // レベルアップの選択肢（表示している間は戦闘が止まる）
    boons: {}, // 取った強化 { atk: 回数 }
    level: D.level,
    power: D,
    size: D.size,
    kills: 0,
    result: null,
    hero: hero.id,
    control: hero.id,
    view: null,
    fxMax: 0,
    boss: null,
    next: 1, // 最初の敵が出るまで（秒）
    farCheck: 2,
    rng: () => ((seed = (seed * 16807) % 2147483647) / 2147483647), // 出現の位置・種類（同じ顔ぶれなら同じ流れ）
  };
  shots = [];
  effects.length = 0;
  trialStick = { x: 0, y: 0 };
  trialSyncUI();
  msg("🔥 サバイバル開始！ 主人公「" + hero.name + "」がたった1人で戦場へ。敵を倒して経験値を集め、レベルアップで強化するか仲間を呼ぼう。" + Math.round((S.bossAt / 60) * 10) / 10 + "分後に大将が来る。");
  return null;
}
// ===== v108.2 この戦闘だけの成長（サバイバルLv・強化・仲間の加入）。本番の兵士・保存データには書かない =====
function trialBoonInit(u) {
  Object.assign(u, { atkMul: 1, rateMul: 1, defMul: 1, reachMul: 1 });
}
// 経験値：だれが倒しても入る（部隊の経験値）。必要な量に届いたらレベルアップ（選ぶまで戦闘を止める）
function trialGainXp(T, e) {
  const S = TRIAL_SURVIVAL;
  T.xp += S.xp[e.kind] || 1;
  while (T.xp >= S.need(T.slv)) {
    T.xp -= S.need(T.slv);
    T.slv++;
    T.lvUps++;
  }
}
// レベルアップの選択肢：仲間候補が残っていれば「👥 仲間を1人加入」＋強化2つ。いなければ強化3つ
function trialChoices(T) {
  const keys = Object.keys(TRIAL_SURVIVAL.boons),
    out = [];
  if (T.reserve.length) out.push({ kind: "recruit", unit: T.reserve[0] });
  while (out.length < 3 && keys.length) out.push({ kind: "boon", key: keys.splice(Math.floor(T.rng() * keys.length), 1)[0] });
  return out;
}
function trialOpenChoice(T) {
  if (T.choice || !T.lvUps) return;
  T.choice = trialChoices(T);
  trialStick = { x: 0, y: 0 };
  trialKeys.clear();
  trialLevelSync();
}
// 選ぶ：強化は主人公に足す。仲間は候補の次の1人を主人公の近くに呼ぶ。選んだら戦闘を再開
function trialChoose(i) {
  const T = trial;
  if (!T || !T.choice) return "いまは選べません。";
  const c = T.choice[i];
  if (!c) return "その選択肢はありません。";
  const S = TRIAL_SURVIVAL,
    hero = T.units.find((u) => u.id === T.hero);
  if (c.kind === "recruit") trialRecruit(T, hero);
  else {
    const B = S.boons[c.key];
    T.boons[c.key] = (T.boons[c.key] || 0) + 1;
    if (c.key === "atk") hero.atkMul += B.step;
    else if (c.key === "rate") hero.rateMul *= 1 - B.step;
    else if (c.key === "move") hero.speed *= 1 + B.step;
    else if (c.key === "def") hero.defMul *= 1 - B.step;
    else if (c.key === "range") (hero.range *= 1 + B.step), (hero.reachMul *= 1 + B.step);
    else if (c.key === "hp") {
      const add = hero.max * B.step;
      hero.max += add;
      hero.hp = Math.min(hero.max, hero.hp + add);
    }
    if (effects.length < 60) effects.push({ kind: "ctext", x: hero.x, y: hero.y - 96, text: B.icon + B.name, ougi: false, age: 0, duration: 1.1 });
  }
  T.lvUps--;
  T.choice = null;
  if (T.lvUps) trialOpenChoice(T);
  trialLevelSync();
  trialSyncUI();
  return null;
}
// 仲間の加入：候補の次の1人を、主人公の近くの空いた持ち場に出す（光と名前の演出）
function trialRecruit(T, hero) {
  const u = T.reserve.shift();
  if (!u) return;
  const S = TRIAL_SURVIVAL,
    o = S.slots[T.joined.length % S.slots.length],
    Z = T.map.size,
    x = Math.max(20, Math.min(Z.w - 20, hero.x + o[0])),
    y = Math.max(40, Math.min(Z.h - 20, hero.y + o[1]));
  Object.assign(u, { x, y, px: x, py: y, placed: true, slot: o, home: { x, y }, cd: 0.4, joinedAt: T.t });
  T.units.push(u);
  T.joined.push(u.id);
  trialCollide(u);
  burst(u.x, u.y - 16, "#ffe27a", "heal");
  if (effects.length < 60) effects.push({ kind: "ctext", x: u.x, y: u.y - 84, text: "👥 " + u.name.replace(/^🎖/, "") + " 加入！", ougi: true, age: 0, duration: 1.6 });
  msg("👥 " + u.name + " が加入した！（" + T.units.length + "/" + (T.units.length + T.reserve.length) + "人）");
}
// レベルアップの選択画面（戦場の上に出す。大きいボタン3つ）
let trialLevelKey = "";
function trialLevelSync() {
  const T = trial,
    box = $("trialLevelUp");
  if (!box) return;
  const key = T && T.choice ? T.slv + "|" + T.choice.map((c) => c.kind + (c.key || c.unit.id)).join(",") : "";
  if (key === trialLevelKey) return;
  trialLevelKey = key;
  box.hidden = !key;
  if (!key) return (box.innerHTML = "");
  const S = TRIAL_SURVIVAL;
  box.innerHTML =
    '<div class="trial-levelup-card" role="dialog" aria-label="レベルアップ"><p class="trial-levelup-title">⬆ サバイバル Lv' + T.slv + "<small>（戦闘は止まっています。1つ選ぶ）</small></p>" +
    T.choice
      .map((c, i) => {
        if (c.kind === "recruit") {
          const u = c.unit;
          return '<button type="button" data-trial-choose="' + i + '" class="recruit">👥 <b>仲間を1人加入</b><small>' + esc(u.name.replace(/^🎖/, "")) + "（" + (JOBS[u.jobKey] ? JOBS[u.jobKey].icon + JOBS[u.jobKey].name : "") + "・Lv" + u.src.level + "）が主人公の近くに来る</small></button>";
        }
        const B = S.boons[c.key];
        return '<button type="button" data-trial-choose="' + i + '">' + B.icon + " <b>" + B.name + "</b>" + (T.boons[c.key] ? "（" + (T.boons[c.key] + 1) + "回目）" : "") + "<small>" + B.text + "・主人公だけ・この戦闘の間だけ</small></button>";
      })
      .join("") +
    "</div>";
}
// サバイバルの敵の出る所：主人公から見て画面の外（少し先）。戦場の中・川と木や岩の外。見つからなければ null（次の機会に）
function trialSpawnPoint(T, hero) {
  const S = TRIAL_SURVIVAL,
    M = T.map,
    Z = M.size,
    vw = W / TRIAL_RULES.camZoom,
    vh = H / TRIAL_RULES.camZoom,
    ox = Math.max(0, Math.min(Z.w - vw, hero.x - vw / 2)), // カメラと同じく、見える範囲は戦場の中に収まる
    oy = Math.max(0, Math.min(Z.h - vh, hero.y - 20 - vh / 2)),
    rr = Math.hypot(vw / 2, vh / 2) + S.margin;
  const side = (x) => (!M.river ? 0 : x < M.river.x0 ? -1 : x > M.river.x1 ? 1 : 0),
    mine = side(hero.x);
  for (let i = 0; i < 16; i++) {
    const a = T.rng() * Math.PI * 2,
      d = rr + T.rng() * 120,
      x = Math.max(24, Math.min(Z.w - 24, hero.x + Math.cos(a) * d)),
      y = Math.max(44, Math.min(Z.h - 24, hero.y + Math.sin(a) * d));
    if (x > ox - 30 && x < ox + vw + 30 && y > oy - 30 && y < oy + vh + 30) continue; // 見えている所（の近く）には出さない
    if (trialInRiver(M, x, y) || (M.river && x >= M.river.x0 - 12 && x <= M.river.x1 + 12)) continue;
    if (mine && side(x) !== mine && i < 12) continue; // できるだけ主人公と同じ川の側に出す（橋を回る遠回りで遠くに溜まらない）
    if (M.obstacles.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + 16)) continue;
    return { x, y };
  }
  return null;
}
// サバイバルの敵の出現：時間とともに間隔が短く、数が多く、強くなる。上限あり。遠くに離れた敵は近くへ移す。最後に強敵
function trialSurvivalTick(T, dt) {
  const S = TRIAL_SURVIVAL,
    hero = T.units.find((u) => u.id === T.hero);
  if (!hero || hero.dead) return;
  const alive = T.enemies.filter((e) => !e.gone),
    f = Math.min(1, T.t / S.bossAt),
    spec = (kind, at, boss) => ({ kind, at, role: boss ? "boss" : null, hpMul: boss ? S.bossHp : S.hp * (1 + S.hpGrow * f), atkMul: (boss ? S.bossAtk : S.atk) * (1 + S.atkGrow * f), speedMul: S.enemySpeed * (boss ? 1.2 : 1) });
  const add = (q) => {
    const e = trialEnemy(q, T, T.spawned);
    e.surv = true;
    T.enemies.push(e);
    T.spawned++;
    return e;
  };
  if ((T.farCheck -= dt) <= 0) {
    T.farCheck = 2;
    for (const e of alive)
      if (e !== T.boss && trialDist(e, hero) > S.far) {
        const p = trialSpawnPoint(T, hero);
        if (p) Object.assign(e, { x: p.x, y: p.y, px: p.x, py: p.y, lastX: p.x, lastY: p.y, target: null, moved: (e.moved || 0) + 1 });
      }
  }
  if (!T.boss && T.t >= S.bossAt) {
    const p = trialSpawnPoint(T, hero);
    if (p) {
      T.boss = add(spec("boss", p, true));
      msg("⚠️ 大将が現れた！ 倒せば勝利！（画面の端の赤い矢印の方向）");
      if (effects.length < 60) effects.push({ kind: "ctext", x: hero.x, y: hero.y - 110, text: "⚠ 大将 出現！", ougi: true, age: 0, duration: 1.6 });
    }
  }
  if ((T.next -= dt) > 0) return;
  // 強敵が出たあとは、ふつうの敵を少なくする（強敵に集中できるように）
  //   出撃の人数が少ないときは、三方の関と同じ割合（countBase + countStep × 人数）で出現の間隔をのばす
  //   v108.2：主人公1人から始まるので、いま戦場にいる人数で決める（仲間が増えると敵も増える）
  const keep = Math.min(1, TRIAL_RULES.countBase + TRIAL_RULES.countStep * T.units.length);
  T.next = (T.boss ? S.afterBoss : S.interval0 + (S.intervalEnd - S.interval0) * f) / keep;
  const pool = S.pools.filter((p) => p[0] <= T.t).pop()[1],
    n = Math.min(S.maxAlive - alive.length, T.boss ? 1 : 1 + Math.floor(T.t / S.batchEvery)),
    p = n > 0 && trialSpawnPoint(T, hero);
  if (!p) return;
  for (let k = 0; k < n; k++) {
    const kind = pool[Math.floor(T.rng() * pool.length)];
    add(spec(kind, { x: p.x + (T.rng() - 0.5) * 50, y: p.y + (T.rng() - 0.5) * 50 }, false));
  }
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
  rest.forEach((u) => {
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
  msg("⚔️ 戦場試練「" + T.map.name + "」開始！ 兵士はそれぞれ自分で戦います。下の名前か戦場の兵士を押すと、その兵士をスティックで動かせます。");
  trialSyncUI();
  return null;
}
// ===== 戦闘処理（毎フレーム。gameStep の時間で進む） =====
function tickTrial(dt) {
  const T = trial;
  if (!T || T.phase !== "fight" || T.result) return;
  if (T.choice) return; // レベルアップの選択中は止まる
  T.t += dt;
  const surv = T.mode === "survival";
  if (surv) {
    trialSurvivalTick(T, dt);
    if (T.flurry) trialFlurryTick(T, dt);
    // 仲間の持ち場：主人公のまわり（主人公が動くと持ち場も動く）
    const hero = T.units.find((u) => u.id === T.hero),
      Z = T.map.size;
    if (hero && !hero.dead) for (const u of T.units) if (u !== hero && u.slot) u.home = { x: Math.max(20, Math.min(Z.w - 20, hero.x + u.slot[0])), y: Math.max(40, Math.min(Z.h - 20, hero.y + u.slot[1])) };
  }
  while (T.queue.length && T.queue[0].t <= T.t) {
    const q = T.queue.shift(),
      e = trialEnemy(q, T, q.n);
    if (q.lead) T.lead = e;
    if (q.follow && T.lead) e.leader = T.lead;
    T.enemies.push(e);
    T.spawned++;
  }
  const live = T.units.filter((u) => !u.dead),
    foes = T.enemies.filter((e) => !e.gone);
  for (const o of [...live, ...foes]) (o.px = o.x), (o.py = o.y);
  for (const u of live) if (!u.dead) trialUnitAct(u, foes, live, dt);
  for (const e of foes) if (!e.gone) trialEnemyAct(e, T.units.filter((u) => !u.dead), dt);
  trialSeparate(T.units.filter((u) => !u.dead), 1);
  trialSeparate(T.enemies.filter((e) => !e.gone), 0.8);
  trialSeparateBetween(T.units.filter((u) => !u.dead), T.enemies.filter((e) => !e.gone));
  for (const o of [...T.units.filter((u) => !u.dead), ...T.enemies.filter((e) => !e.gone)]) trialCollide(o);
  for (const u of T.units) {
    u.atk = Math.max(0, u.atk - dt);
    u.hit = Math.max(0, u.hit - dt);
  }
  for (const e of T.enemies) {
    e.atkAnim = Math.max(0, e.atkAnim - dt);
    e.hit = Math.max(0, e.hit - dt);
  }
  T.fxMax = Math.max(T.fxMax, effects.length);
  if (surv) {
    // サバイバル：主人公が倒れたら敗北（仲間が倒れても続く）。強敵を倒したら勝利
    if (T.units.find((u) => u.id === T.hero).dead) return endTrial("lose");
    if (T.boss && T.boss.gone) return endTrial("win");
    if (T.t >= TRIAL_SURVIVAL.timeLimit) return endTrial("timeout");
    // 奥義の直後は、演出を見せてから選択画面を出す（1.5秒。天剣乱舞の連続斬撃の間も待つ）
    if (T.lvUps && !T.flurry && !(T.ougiUsed && T.t - T.ougiUsed.at < 1.5)) trialOpenChoice(T);
    return;
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
  const Z = trial ? trial.map.size : { w: W, h: H };
  o.x = Math.max(10, Math.min(Z.w - 10, o.x));
  o.y = Math.max(30, Math.min(Z.h - 10, o.y));
}
// 川：橋の上でなければ通れない
const trialInRiver = (M, x, y) => !!M.river && x > M.river.x0 && x < M.river.x1 && !M.bridges.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
// 行き先へ向かう（AI の移動）。川の向こうへ行くときは、近い橋を通る
function trialGo(o, tx, ty, speed, dt) {
  const M = trial.map,
    R = M.river;
  if (R) {
    const side = (x) => (x < R.x0 ? -1 : x > R.x1 ? 1 : 0),
      s0 = side(o.x),
      s1 = side(tx);
    if (s0 !== s1) {
      // 橋の上（川の帯の中）にいる：そのまま行き先の側へ渡る。まだ岸にいる：一番近い橋のたもとへ
      if (s0 === 0) {
        const b = M.bridges.find((v) => o.y >= v.y0 - 2 && o.y <= v.y1 + 2) || M.bridges[0];
        return trialMove(o, s1 < 0 ? R.x0 - 14 : R.x1 + 14, Math.max(b.y0 + 10, Math.min(b.y1 - 10, o.y)), speed, dt);
      }
      const cost = (b) => Math.hypot((b.x0 + b.x1) / 2 - o.x, (b.y0 + b.y1) / 2 - o.y) + Math.hypot((b.x0 + b.x1) / 2 - tx, (b.y0 + b.y1) / 2 - ty),
        b = M.bridges.reduce((a, c) => (cost(c) < cost(a) ? c : a)),
        by = (b.y0 + b.y1) / 2,
        ex = s0 < 0 ? R.x0 - 6 : R.x1 + 6;
      if (Math.abs(o.y - by) > 16 || Math.abs(o.x - ex) > 30) return trialMove(o, ex, by, speed, dt);
      return trialMove(o, s0 < 0 ? R.x1 + 14 : R.x0 - 14, by, speed, dt);
    }
  }
  const p = trialSteer(o, tx, ty);
  trialMove(o, p[0], p[1], speed, dt);
}
// v108.1 木・岩をよける：進む向きのすぐ先に木・岩があれば、横へまわる向きにずらす（まわる側は少しの間変えない）
function trialSteer(o, tx, ty) {
  const dx = tx - o.x,
    dy = ty - o.y,
    d = Math.hypot(dx, dy);
  if (d < 1) return [tx, ty];
  const ux = dx / d,
    uy = dy / d,
    look = Math.min(d, 64);
  let hit = null,
    ht = Infinity;
  for (const b of trial.map.obstacles) {
    const bx = b.x - o.x,
      by = b.y - o.y,
      t = bx * ux + by * uy;
    if (t < -4 || t > look + b.r) continue;
    const side = ux * by - uy * bx; // 正：進む向きの左（画面では右回り）に木がある
    if (Math.abs(side) < b.r + 14 && t < ht) (ht = t), (hit = side);
  }
  if (hit == null) return [tx, ty];
  const T = trial.t;
  if (!(o.steerUntil > T)) (o.steerSide = hit > 0 ? -1 : 1), (o.steerUntil = T + 0.8);
  const k = o.steerSide, // 左の法線 (-uy, ux) の向きへ k だけ曲げる
    nx = ux * 0.3 - uy * k,
    ny = uy * 0.3 + ux * k;
  return [o.x + nx * 60, o.y + ny * 60];
}
// 地形に重ならないようにする：木・岩からは押し出し、川（橋の外）に入ったら元の位置へ戻す
function trialCollide(o) {
  const M = trial.map;
  for (const b of M.obstacles) {
    const dx = o.x - b.x,
      dy = o.y - b.y,
      d = Math.hypot(dx, dy) || 0.01,
      R = b.r + 10;
    if (d < R) {
      o.x = b.x + (dx / d) * R;
      o.y = b.y + (dy / d) * R;
    }
  }
  if (trialInRiver(M, o.x, o.y) && o.px != null) {
    // 横から入ったなら x を、縦から入ったなら y を戻す（岸に沿って滑る）
    if (!trialInRiver(M, o.px, o.y)) o.x = o.px;
    else if (!trialInRiver(M, o.x, o.py)) o.y = o.py;
    else (o.x = o.px), (o.y = o.py);
  }
}
// ===== 職業技・閃き：既存の evolutionAction を戦場試練でも使う（技の条件・待ち時間・効果は既存のまま） =====
//   c.friends は出撃した全員（同じ隊として扱う）。blocked は「その敵が自分を狙って近くにいる」（足止めの代わり）
//   技を使ったかは、待ち時間（common）が新しく付いたかで見て、技名ごとに数える（結果の画面用）
function trialEvolution(u, target, event = "attack", beforeRatio = null) {
  const s = u.sh;
  if (!s.alive || (jobActionStage(s) < 0 && !insightOf(s).equipped.length)) return;
  const T = trial,
    st = soldierStats(s, true),
    friends = T.units.filter((v) => !v.dead).map((v) => ({ s: v.sh, team: "trial", x: v.x, y: v.y, max: v.max, unit: v }));
  const c = {
    now: T.t,
    pos: u,
    team: "trial",
    friends,
    enemies: T.enemies,
    stats: st,
    target,
    blocked: (e) => !!e && !e.gone && e.target === u && trialDist(e, u) <= Math.max(st.range, TRIAL_RULES.meleeReach) + 30,
    hit: (e, raw, pierce = 0) => trialHitEnemy(u, e, raw, pierce),
    heal: (m, amount) => {
      const before = m.s.hp;
      m.s.hp = Math.min(m.max, m.s.hp + amount * healTakenMul(m.s));
      const got = Math.max(0, m.s.hp - before);
      u.healed += got;
      return got;
    },
  };
  if (event === "heal") {
    c.target = friends.find((m) => m.unit === target);
    if (c.target) c.target.beforeRatio = beforeRatio;
  }
  const before = s.evolution ? { common: s.evolution.common, ready: { ...s.evolution.ready } } : { common: 0, ready: {} };
  evolutionAction(s, c, event);
  const E = s.evolution;
  if (E && E.common !== before.common)
    for (const [key, at] of Object.entries(E.ready))
      if (at !== before.ready[key]) {
        const job = key.startsWith("job:"),
          name = job ? JOB_ACTIONS[key.slice(4)].names[Math.max(0, jobActionStage(s))] : INSIGHT_SKILLS[key] ? INSIGHT_SKILLS[key].name : key === "chronicleRescue" ? "緊急救命" : key;
        u.skills[name] = (u.skills[name] || 0) + 1;
        trialSkillFx(u, target, job ? JOB_ACTIONS[key.slice(4)].fx : "insight", event);
        // 強い技（上位の職業技・閃き）だけ、兵士の上に技名を出す（ふつうの職業技は光だけ）。同じ兵士は2.5秒に1回まで・数の上限つき
        if ((!job || jobActionStage(s) >= 1) && effects.length < 60 && !(u.nameUntil > T.t)) {
          u.nameUntil = T.t + 2.5;
          effects.push({ kind: "ctext", x: u.x, y: u.y - 78, text: (job ? "" : "💡") + name, ougi: false, age: 0, duration: 1.1 });
        }
      }
}
// v108.3 職業技・閃きの演出（見た目だけ。技の効果・発動の条件は evolutionAction のまま）
//   斬撃は軌跡、槍は突きの光、弓は光る矢、鉄砲は閃光と火花、回復は緑の光、範囲の技は広がる輪。数の上限つき（iPhone の重さ）
const TRIAL_FX_AREA = new Set(["moon", "shell", "ring", "pulse", "fan", "caltrop", "net", "wall", "flag", "iron"]);
function trialSkillFx(u, target, fx, event) {
  if (effects.length >= 64) return;
  const t = target && target.x != null ? target : null,
    heal = event === "heal",
    a = t ? Math.atan2(t.y - u.y, t.x - u.x) : 0;
  if (heal) {
    // 回復：相手（と自分）に緑の光
    burst((t || u).x, (t || u).y - 16, "#7be08a", "heal");
    if (TRIAL_FX_AREA.has(fx)) for (const v of trial.units) if (!v.dead && v !== t && trialDist(v, u) < 160) burst(v.x, v.y - 16, "#7be08a", "heal");
  } else if (t && u.role === "melee") {
    if (u.type === "spearman" || fx === "spear" || fx === "wall" || fx === "fan") {
      // 槍：自分から相手へ突きの光
      if (shots.length >= 160) shots.shift();
      shots.push({ x: u.x, y: u.y - 18, tx: t.x + Math.cos(a) * 16, ty: t.y - 10 + Math.sin(a) * 16, type: "arrow", age: 0, duration: 0.14, col: "#fff6c8", trail: 2, glow: "#fff1a0", quiet: true });
    }
    effects.push({ kind: "cslash", x: t.x, y: t.y - 12, a: a + 0.4, ougi: false, age: 0, duration: 0.36 });
  } else if (t) {
    const gun = u.shot === "musket";
    if (shots.length >= 160) shots.shift();
    shots.push({ x: u.x, y: u.y - 22, tx: t.x, ty: t.y - 10, type: gun ? "magic" : "arrow", age: 0, duration: gun ? 0.12 : 0.24, col: "#a56b35", trail: 2, glow: gun ? "#ffd27a" : "#9fe6ff", quiet: true });
    if (gun) burst(u.x + u.face * 16, u.y - 22, "#fff0b0", "gunsmoke");
    effects.push({ kind: "cspark", x: t.x, y: t.y - 12, ougi: false, seed: u.seed, age: 0, duration: 0.32 });
  }
  // 範囲の技・閃き：効果の範囲が分かる輪
  if (TRIAL_FX_AREA.has(fx) || fx === "insight") effects.push({ kind: "cshock", x: (t && !heal ? t : u).x, y: (t && !heal ? t : u).y + 6, ougi: fx === "insight", age: 0, duration: 0.5 });
}
// ===== v108.3 伝説の奥義（サバイバル）：既存の奥義（LEGEND_OUGI）・奥義継承者・1回の挑戦で1回の決まりをそのまま使う =====
//   使えるのは、主人公が奥義継承者（兵士名簿の剣聖の「⚔ 奥義」で指定）のときだけ。サバイバル1回の戦闘を「1回の挑戦」として1回。
//   使った記録は戦闘の中だけに持ち、本編の使用記録（ougiSave.run）・奥義書・閃きには書かない。対象がいなければ使った回数にしない
function trialOugiInfo(T) {
  if (!T || T.mode !== "survival") return null;
  const H = typeof ougiHeirNow === "function" ? ougiHeirNow() : null;
  if (!H || H.why || !H.s || H.s.id !== T.hero) return { key: null, why: H && !H.why ? "奥義継承者（" + soldierName(H.s) + "）が主人公ではありません" : "主人公は奥義を習得していません（奥義継承者だけ）" };
  return { key: H.h.k, O: LEGEND_OUGI[H.h.k], why: T.ougiUsed ? "この戦闘ではもう使いました" : null };
}
function trialUseOugi() {
  const T = trial;
  if (!T || T.mode !== "survival" || T.phase !== "fight" || T.result) return "サバイバルの戦闘中に使えます。";
  if (T.choice) return "レベルアップの選択のあとに使えます。";
  const I = trialOugiInfo(T);
  if (!I.key) return I.why;
  if (I.why) return I.why;
  const O = I.O,
    h = T.units.find((u) => u.id === T.hero),
    atk = soldierStats(h.sh, true).atk,
    list = T.enemies.filter((e) => !e.gone),
    origin = { x: h.x, y: h.y - 18 };
  let target = null,
    rays = null;
  if (O.kind === "pattern") {
    const near = trialNearest(h, list);
    if (near) {
      rays = resolvePattern(origin, Math.atan2(near.y - origin.y, near.x - origin.x), ATTACK_PATTERNS[O.pattern], list);
      if (rays.some((r) => r.hits.length)) target = near;
    }
  } else if (O.kind === "single") {
    // 強敵を優先：大将 → 中ボス → 体力の多い敵
    const rank = (e) => (e.kind === "boss" || e.role === "boss" ? 2e9 : e.role === "mid" ? 1e9 : 0) + e.hp;
    target = list.filter((e) => trialDist(e, h) <= O.reach).sort((a, b) => rank(b) - rank(a))[0] || null;
  } else target = list.find((e) => trialDist(e, h) <= O.radius) || null;
  if (!target) return "範囲内に敵がいません。奥義の使用回数は減っていません。";
  T.ougiUsed = { key: I.key, at: T.t, hits: 0, kills: 0 };
  combatFx.ougi("奥義・" + O.name, "👑 " + h.name);
  const before = T.kills;
  if (O.kind === "pattern") {
    const P = ATTACK_PATTERNS[O.pattern],
      killed = [];
    for (const r of rays)
      for (const e of r.hits) {
        const alive = !e.gone;
        trialHitEnemy(h, e, atk * P.mul, 0, !!P.cover);
        T.ougiUsed.hits++;
        if (alive && e.gone) killed.push(e);
      }
    combatFx.pattern(P, origin, rays);
    if (killed.length >= 2) combatFx.multiKill(killed, true);
  } else if (O.kind === "single") {
    trialHitEnemy(h, target, atk * O.mul, 0, true);
    T.ougiUsed.hits = 1;
    combatFx.issen(origin, target);
  } else {
    combatFx.push({ kind: "cshock", x: h.x, y: h.y + 6, ougi: true, age: 0, duration: 0.7 });
    T.flurry = { left: O.hits, wait: 0 };
  }
  T.ougiUsed.kills = T.kills - before;
  msg("⚔ 奥義「" + O.name + "」！ " + h.name + "（この戦闘で1回。本編の使用記録・奥義書は変わらない）");
  trialOugiSync(true);
  return null;
}
// 天剣乱舞：gap 秒ごとに1回、主人公のまわりの敵へ斬撃（主人公が倒れたら止める。レベルアップの選択中は止まる）
function trialFlurryTick(T, dt) {
  const F = T.flurry;
  if (!F || (F.wait -= dt) > 0) return;
  const h = T.units.find((u) => u.id === T.hero),
    O = LEGEND_OUGI[T.ougiUsed.key];
  if (!h || h.dead || F.left <= 0) return (T.flurry = null);
  F.wait += O.gap;
  F.left--;
  const atk = soldierStats(h.sh, true).atk,
    killed = [];
  T.enemies
    .filter((e) => !e.gone && trialDist(e, h) <= O.radius)
    .sort((a, b) => trialDist(a, h) - trialDist(b, h))
    .slice(0, O.perHit)
    .forEach((e, i) => {
      trialHitEnemy(h, e, atk * O.mul, 0, true);
      T.ougiUsed.hits++;
      if (e.gone) killed.push(e), T.ougiUsed.kills++;
      combatFx.push({ kind: "cslash", x: e.x, y: e.y - 14, a: Math.random() * Math.PI, ougi: true, age: -i * 0.03, duration: 0.42 });
    });
  combatFx.push({ kind: "cwave", x: h.x, y: h.y - 10, rays: [0, 1, 2, 3].map((k) => (k * Math.PI) / 2 + F.left * 0.4), len: O.radius, width: 30, ougi: true, age: 0, duration: 0.5 });
  if (killed.length >= 2) combatFx.multiKill(killed, true);
}
// 奥義のボタン（右下）：使える奥義の名前。使えないときは理由（未習得・使用済み）を小さく
let trialOugiKey = "";
function trialOugiSync(force) {
  const T = trial,
    box = $("trialAction");
  if (!box) return;
  const I = T && T.phase === "fight" ? trialOugiInfo(T) : null,
    key = I ? (I.key || "") + "|" + (I.why || "") : "";
  if (!force && key === trialOugiKey) return;
  trialOugiKey = key;
  box.hidden = !I;
  if (!I) return (box.innerHTML = "");
  box.innerHTML =
    '<button type="button" id="trialOugiBtn" class="trial-ougi' + (I.key && !I.why ? " ready" : "") + '"' + (I.key && !I.why ? "" : " disabled") + ">⚔️ 奥義<b>" + (I.key ? esc(I.O.name) : "未習得") + "</b><small>" + esc(I.why || "1回だけ・押すと発動") + "</small></button>";
}
// 兵士1人の行動：衛生兵は傷ついた味方を回復、近接は近づいて斬る、遠距離は射程を保って撃つ
// v108：操作している兵士（trial.control）は、スティックの向きにだけ動く（AI は動かさない）。攻撃・回復・職業技は自動のまま
//   操作していない兵士は、これまでどおり AI で動く。操作を外すと（全員自動・切り替え）、次のコマから AI に戻る
let trialStick = { x: 0, y: 0 }, // 仮想スティック・キーボードの向き（-1〜1）
  trialKeys = new Set();
function trialInput() {
  let x = trialStick.x,
    y = trialStick.y;
  if (trialKeys.size) {
    x = (trialKeys.has("right") ? 1 : 0) - (trialKeys.has("left") ? 1 : 0);
    y = (trialKeys.has("down") ? 1 : 0) - (trialKeys.has("up") ? 1 : 0);
  }
  const m = Math.hypot(x, y);
  if (m < TRIAL_RULES.stickDead) return { x: 0, y: 0, m: 0 };
  return m > 1 ? { x: x / m, y: y / m, m: 1 } : { x, y, m };
}
function trialUnitAct(u, foes, live, dt) {
  const s = u.sh,
    ctl = trial.control === u.id,
    surv = trial.mode === "survival",
    SV = TRIAL_SURVIVAL,
    leash = surv ? SV.follow : TRIAL_RULES.leash,
    go = ctl ? () => {} : (tx, ty, sp) => trialGo(u, tx, ty, sp, dt);
  u.cd -= dt;
  if (ctl) {
    // スティックの向きへ歩く（指を離すと止まる）
    const v = trialInput();
    u.moving = v.m > 0;
    if (u.moving) {
      trialMove(u, u.x + v.x * 200, u.y + v.y * 200, u.speed * v.m * (surv ? SV.heroSpeed : TRIAL_RULES.ctlSpeed), dt);
      u.face = v.x < -0.05 ? -1 : v.x > 0.05 ? 1 : u.face;
    }
  } else if (surv && u.home && trialDist(u, u.home) > SV.regroup) {
    // サバイバルの仲間：主人公から離れすぎたら、敵より主人公の近くへ戻るのを優先（孤立しない）
    u.target = null;
    u.lost = (u.lost || 0) + dt;
    if (u.lost > SV.rejoin) {
      // 引っかかって戻れないまま時間がたったら、主人公の近くへ合流（試作の安全策）
      u.lost = 0;
      Object.assign(u, { x: u.home.x, y: u.home.y, px: u.home.x, py: u.home.y });
      burst(u.x, u.y - 10, "#bfe8ff", "heal");
      return;
    }
    return go(u.home.x, u.home.y, u.speed * SV.catchUp);
  } else if (surv) u.lost = 0;
  // v108.2 サバイバルの主人公が衛生兵：回復する相手がいないときは、届く敵を自分で攻撃する（1人でも戦える）
  const fighter = u.role === "heal" && surv && ctl && !live.some((v) => v !== u && !v.dead && v.hp < v.max * 0.97 && trialDist(u, v) <= u.range) && u.hp >= u.max * 0.4;
  if (u.role === "heal" && !fighter) {
    let best = null,
      ratio = 0.97;
    for (const v of live) {
      const r = v.hp / v.max;
      if (v !== u && !v.dead && r < ratio && (!ctl || trialDist(u, v) <= u.range)) (ratio = r), (best = v);
    }
    if (!best && u.hp < u.max * 0.97) best = u; // 自分しか傷ついていなければ自分
    if (!best && surv) {
      // サバイバル：けが人がいなければ、持ち場（主人公の近く）へ
      if (u.home && trialDist(u, u.home) > 12) go(u.home.x, u.home.y, u.speed * (trialDist(u, u.home) > 60 ? SV.catchUp : 0.8));
      return;
    }
    if (!best) {
      // けが人がいない：一番前で戦っている味方の少し後ろへ
      const front = live.filter((v) => v !== u && !v.dead && v.role !== "heal").sort((a, b) => a.x - b.x)[0];
      if (front) {
        const tx = front.x + 60,
          ty = front.y;
        if (trialDist(u, { x: tx, y: ty }) > 20) go(tx, ty, u.speed * 0.8);
      }
      return;
    }
    const d = trialDist(u, best);
    if (d > u.range * 0.8 && best !== u) return go(best.x, best.y, u.speed);
    if (u.cd > 0) return;
    const st = soldierStats(s, true),
      beforeRatio = best.hp / best.max,
      amount = Math.min(st.heal * (u.atkMul || 1), best.max - best.hp);
    u.cd = st.rate * (u.rateMul || 1);
    if (amount <= 0) return;
    const hp0 = best.hp;
    best.hp = Math.min(best.max, best.hp + amount * healTakenMul(best.sh));
    u.healed += best.hp - hp0;
    u.atk = 0.18;
    trialHealFx(best);
    trialEvolution(u, best, "heal", beforeRatio);
    return;
  }
  // 狙う敵：いまの相手が生きていれば続ける（少し遠くなっても）。いなければ一番近い敵
  if (ctl) {
    const reach0 = (e) => (u.role === "melee" ? Math.max(u.range, TRIAL_RULES.meleeReach * (u.reachMul || 1)) + (e.r || 12) : u.range);
    if (!u.target || u.target.gone || trialDist(u, u.target) > reach0(u.target)) u.target = trialNearest(u, foes.filter((e) => !e.gone && trialDist(u, e) <= reach0(e)));
  } else if (!u.target || u.target.gone || trialDist(u, u.target) > u.range + 260 || (u.home && trialDist(u.home, u.target) > leash + 80 && trialDist(u, u.target) > u.range + 20)) {
    // AI：配置した所（サバイバルは主人公の近くの持ち場）の近く（leash）か、もう届く所の敵だけを狙う。操作から戻った兵士も、遠ければ持ち場へ戻る
    const near = (e) => !e.gone && (!u.home || trialDist(u.home, e) <= leash || trialDist(u, e) <= u.range + 20);
    u.target = trialNearest(u, foes.filter(near));
    // 敵が出そろったあと、持ち場の近くに敵が来ないまま8秒たったら、残っている敵を探しに行く（止まったまま終わらない。サバイバルは敵が来るので探さない）
    u.idle = u.target ? 0 : (u.idle || 0) + dt;
    if (!surv && !u.target && u.idle > 8 && !trial.queue.length) u.target = trialNearest(u, foes.filter((e) => !e.gone));
  }
  const e = u.target;
  if (!e) {
    // 敵がいない：配置した場所（サバイバルは主人公の近くの持ち場）へ戻る
    if (u.home && trialDist(u, u.home) > 6) go(u.home.x, u.home.y, u.speed * (surv && trialDist(u, u.home) > 60 ? SV.catchUp : 0.7));
    return;
  }
  const d = trialDist(u, e),
    reach = u.role === "melee" ? Math.max(u.range, TRIAL_RULES.meleeReach * (u.reachMul || 1)) + (e.r || 12) : u.range;
  if (u.role === "ranged" && d < u.range * TRIAL_RULES.kite && !(e.attackConf && e.attackConf.ranged)) {
    // 近づかれたら少し下がる（関の方へ）
    const bx = u.x + ((u.x - e.x) / (d || 1)) * 40,
      by = u.y + ((u.y - e.y) / (d || 1)) * 40;
    go(bx, by, u.speed * 0.7);
  } else if (d > reach) return go(e.x, e.y, u.speed);
  u.face = e.x < u.x ? -1 : 1;
  if (u.cd > 0 || d > reach) return;
  const st = soldierStats(s, true),
    ct = unitOf(s);
  u.cd = st.rate * (u.rateMul || 1);
  u.atk = 0.18;
  // 一撃：防衛戦と同じ倍率（大将狙い・居合・一閃・装備の会心など・騎馬の上級職）
  let raw = (fighter ? Math.max(st.atk, st.heal * 0.6) : st.atk) * (e.kind === "boss" ? 1 + skillSum(s, "vsBoss") : 1) * skillHitMul(s, e) * gearHitMul(s, T_now()) * jobHitMul(s, T_now());
  if (ct.charge && u.charged !== e) {
    // 突撃（騎兵）：新しい敵への最初の一撃だけ強い
    u.charged = e;
    raw *= ct.charge + skillSum(s, "chargeAdd");
  }
  trialHitEnemy(u, e, raw, 0);
  // v108.4 通常攻撃の見え方：近接は斬撃の軌跡（槍は突きの光）、弓は光る矢、鉄砲は銃口の閃光・光る弾・命中の火花（数の上限つき）
  const ang = Math.atan2(e.y - u.y, e.x - u.x),
    roomy = effects.length < 56;
  if (shots.length >= 160) shots.shift();
  if (u.role === "melee") {
    burst(e.x, e.y - 10, "#fff1c4", "slash");
    if (u.type === "spearman") shots.push({ x: u.x, y: u.y - 18, tx: e.x - Math.cos(ang) * 6, ty: e.y - 12, type: "arrow", age: 0, duration: 0.12, col: "#fff6c8", trail: 1, glow: "#fff1a0", quiet: true });
    else if (roomy) effects.push({ kind: "cslash", x: e.x, y: e.y - 12, a: ang + (u.seed % 2 ? 0.5 : -0.5), ougi: false, age: 0, duration: 0.26 });
  } else {
    const musket = u.shot === "musket";
    if (musket) burst(u.x + u.face * 16, u.y - 22, "#fff0b0", "gunsmoke");
    shots.push({ x: u.x + (musket ? u.face * 16 : 0), y: u.y - 22, tx: e.x, ty: e.y - 8, type: musket ? "magic" : "arrow", age: 0, duration: musket ? 0.12 : 0.22, col: "#a56b35", trail: 1, glow: musket ? "#ffd27a" : "#bfeaff", quiet: true });
    if (musket && roomy) effects.push({ kind: "cspark", x: e.x, y: e.y - 10, ougi: false, seed: u.seed, age: -0.1, duration: 0.28 });
  }
  trialEvolution(u, e, "attack");
}
// 兵士の攻撃のダメージ：敵の防御で減る（防衛戦と同じ式。防御無視・職業技の防御低下も効く）。盾兵に守られた敵は減る（技の貫通は無視）
function trialHitEnemy(u, e, raw, pierce = 0, cover = false) {
  if (!e || e.gone || e.hp <= 0 || raw <= 0) return 0;
  raw *= u.atkMul || 1; // v108.2 サバイバルの強化（この戦闘だけ。職業技・閃きにも効く）
  const ignore = Math.min(0.8, skillSum(u.sh, "armorPierce") + pierce),
    armor = evolutionArmor(e, e.armor || 0, T_now());
  let dmg = (raw * 30) / (30 + armor * (1 - ignore));
  if (e.leader && !pierce && !cover && !e.leader.gone && trialDist(e.leader, e) <= ENEMY_BEHAVIORS.tate.cover.radius) dmg *= ENEMY_BEHAVIORS.tate.cover.mul;
  const hp0 = e.hp;
  e.hp -= dmg;
  e.hit = 0.18;
  u.dealt += Math.min(dmg, Math.max(0, hp0));
  if (e.hp <= 0 && !e.gone) {
    e.gone = true;
    u.kills++;
    trial.kills++;
    if (trial.mode === "survival") trialGainXp(trial, e);
    trialKillFx(e);
  }
  return dmg;
}
// 敵1体の行動：道を進み、兵士に気づいたら狙う。1人に集まりすぎない。遠距離の敵は射程を保つ。鉄砲足軽は盾兵の後ろ
function trialEnemyAct(e, live, dt) {
  e.cd -= dt;
  e.retarget -= dt;
  const a = e.attackConf,
    range = a.ranged || 0,
    slow = e.evolutionSlow && e.evolutionSlow.until > T_now() ? 1 - e.evolutionSlow.value : 1,
    speed = e.speed * slow;
  if (e.target && (e.target.dead || (!e.joined && trialDist(e, e.target) > TRIAL_RULES.aggro + 80))) e.target = null;
  if (!e.target || e.retarget <= 0) {
    // 狙う兵士：近さに、すでに狙われている数を足して選ぶ（衛生兵を最優先にはしない。少しだけ後回し）
    e.retarget = 1.5;
    let best = null,
      score = Infinity;
    for (const u of live) {
      const d = trialDist(e, u);
      if (!e.joined && d > TRIAL_RULES.aggro) continue;
      const crowd = trial.enemies.filter((o) => o !== e && !o.gone && o.target === u).length,
        sc = d + Math.max(0, crowd - TRIAL_RULES.crowd + 1) * 70 + (u.role === "heal" ? 40 : 0) - (u === e.target ? 30 : 0);
      if (sc < score) (score = sc), (best = u);
    }
    e.target = best;
  }
  const u = e.target,
    covered = e.leader && !e.leader.gone;
  if (!u) {
    // 道を進む（合流点を過ぎたら関へ）。進めなくなったら次の目印へ（引っかかって止まらない）
    const goal = covered ? { x: e.leader.x - 46, y: e.leader.y } : null,
      p = e.lanePath[e.wp] || trial.map.road[1];
    trialGo(e, goal ? goal.x : p[0], goal ? goal.y : p[1], speed, dt);
    if (!goal && Math.hypot(p[0] - e.x, p[1] - e.y) < 10) {
      if (e.wp < e.lanePath.length) e.wp++;
      if (e.wp >= e.lanePath.length) e.joined = true;
    }
    trialUnstick(e, dt);
    return;
  }
  const d = trialDist(e, u),
    reach = range || TRIAL_RULES.meleeReach + 10;
  if (covered) {
    // 盾兵の後ろの鉄砲足軽：盾兵の少し後ろ（狙う兵士から見て）にいて、射程に入れば撃つ
    const L = e.leader,
      dl = trialDist(L, u) || 1,
      bx = L.x - ((u.x - L.x) / dl) * 46,
      by = L.y - ((u.y - L.y) / dl) * 46 + (e.id.charCodeAt(e.id.length - 1) % 2 ? 22 : -22);
    if (trialDist(e, { x: bx, y: by }) > 12) trialGo(e, bx, by, speed, dt);
    if (d > reach) return;
  } else if (range && d < range * 0.45) {
    // 遠距離の敵：近づかれたら少し下がる
    trialGo(e, e.x + ((e.x - u.x) / (d || 1)) * 30, e.y + ((e.y - u.y) / (d || 1)) * 30, speed * 0.6, dt);
  } else if (d > reach) {
    trialGo(e, u.x, u.y, speed, dt);
    trialUnstick(e, dt);
    return;
  }
  e.face = u.x < e.x ? -1 : 1;
  if (e.cd > 0) return;
  e.cd = a.rate;
  e.atkAnim = 0.35;
  trialHitUnit(u, a.damage * (e.atkMul || 1), !!range, e);
  if (range) {
    const gun = e.behavior === "teppo";
    if (gun) burst(e.x + e.face * 12, e.y - 18, "#ffe6a0", "gunsmoke");
    if (shots.length >= 160) shots.shift();
    shots.push({ x: e.x, y: e.y - 18, tx: u.x, ty: u.y - 10, type: gun ? "magic" : "arrow", age: 0, duration: gun ? 0.12 : 0.25, col: "#5a3420", trail: 1, glow: "#ff8a6a", quiet: true }); // 敵の矢・弾は赤く光る（味方と見分ける）
  } else burst(u.x, u.y - 8, "#ffb0a0", "slash");
}
// 引っかかり対策：動こうとしているのに3秒ほとんど進まなければ、次の目印へ（合流点を過ぎたことにする）
function trialUnstick(e, dt) {
  const moved = Math.hypot(e.x - e.lastX, e.y - e.lastY);
  e.lastX = e.x;
  e.lastY = e.y;
  e.stuck = moved < e.speed * dt * 0.2 ? e.stuck + dt : 0;
  if (e.stuck > 3) {
    e.stuck = 0;
    e.unstuck = (e.unstuck || 0) + 1;
    e.wp = Math.min(e.lanePath.length, e.wp + 1);
    e.joined = true;
    e.x += (Math.random() - 0.5) * 16;
    e.y += (Math.random() - 0.5) * 16;
  }
}
// 敵の攻撃のダメージ：兵士の防御・受けるダメージ軽減のスキル・職業技の盾（防衛戦と同じ式）。一撃は最大HPの6割まで
function trialHitUnit(u, raw, ranged, e) {
  const s = u.sh,
    st = soldierStats(s, true),
    weak = unitOf(s).spearWeak,
    spear = weak && e.kind === "knight" ? 1 + (weak - 1) * (1 - skillSum(s, "spearGuard")) : 1,
    guard = (1 - skillSum(s, "guard")) * (ranged ? (1 - skillSum(s, "rangedGuard")) * (unitOf(s).rangedWeak || 1) : 1) * spear;
  let dmg = Math.min(((raw * SQUAD_RULES.defenseScale) / (SQUAD_RULES.defenseScale + st.def)) * guard * (u.defMul || 1), u.max * TRAINING.maxHit);
  dmg = evolutionAbsorb(s, dmg, ranged, e, T_now()); // 職業技・閃きの盾と受け流し（写しの値だけ変わる）
  u.hp -= dmg;
  u.hit = 0.2;
  if (u.hp <= 0 && !u.dead) {
    // 試作：仮の戦死（本番の兵士・英霊名鑑には反映しない）
    u.hp = 0;
    u.dead = true;
    s.alive = false;
    u.diedAt = trial.t;
    u.killedBy = e.kind;
    if (trial.control === u.id && trial.mode !== "survival") {
      const next = trial.units.find((v) => !v.dead);
      trial.control = next ? next.id : null;
      if (next) msg("🎮 操作を " + next.name + " に切り替えた");
      trialSyncUI();
    }
    msg("☠ " + u.name + " が倒れた（戦場試練・試作のため本番の兵士は無事）");
  }
}
// ===== 演出（控えめ。技名は職業技・閃きの演出が出す。数の上限つき） =====
function trialHealFx(v) {
  burst(v.x, v.y - 16, "#7be08a", "heal");
}
function trialKillFx(e) {
  if (effects.length >= 60) return;
  effects.push({ kind: "cboom", x: e.x, y: e.y - 8, ougi: !!e.role, age: 0, duration: e.role ? 0.7 : 0.45 });
  if (e.role) combatFx.push({ kind: "ctext", x: e.x, y: e.y - 50, text: e.role === "boss" ? "大将撃破！" : "中ボス撃破！", ougi: true, age: 0, duration: 1.2 });
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
  const units = T.units.map((u) => ({
    id: u.id,
    name: u.name,
    job: JOBS[u.jobKey] ? JOBS[u.jobKey].icon + JOBS[u.jobKey].name : "",
    lv: u.src.level,
    role: u.role,
    dead: u.dead,
    hp: Math.ceil(u.hp),
    max: Math.round(u.max),
    kills: u.kills,
    dealt: Math.round(u.dealt),
    healed: Math.round(u.healed),
    skills: { ...u.skills },
    power: Math.round((u.power / Math.max(1, u.basePower)) * 100) / 100,
    hero: T.mode === "survival" && u.id === T.hero,
  }));
  // 活躍：与えたダメージ＋回復量＋撃破。いちばん大きい兵士に 🏅
  const score = (x) => x.dealt + x.healed * 1.2 + x.kills * T.level * 3;
  const best = units.reduce((b, x) => (!b || score(x) > score(b) ? x : b), null);
  if (best && score(best) > 0) best.mvp = true;
  trialStick = { x: 0, y: 0 };
  trialKeys.clear();
  trialResultView = { stage: T.map.name, mode: T.mode, result, time: T.t, level: T.level, power: T.power, kills: T.kills, total: T.total, units, real: TRIAL_RULES.real, fxMax: T.fxMax, ougi: T.ougiUsed ? { name: LEGEND_OUGI[T.ougiUsed.key].name, hits: T.ougiUsed.hits, kills: T.ougiUsed.kills } : null, boss: T.mode === "survival" ? (T.boss ? (T.boss.gone ? "撃破" : "健在") : "未出現") : null, spawned: T.spawned, slv: T.slv || null, boons: T.boons ? { ...T.boons } : null, waiting: (T.reserve || []).map((u) => u.name), roster: T.mode === "survival" ? T.units.length + (T.reserve || []).length : null };
  trial = null;
  shots = [];
  effects.length = 0;
  combatFx.banner = null;
  trialSyncUI();
  trialLevelSync();
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
  // 広い戦場の背景は1枚の画像にして使い回す（大きすぎないよう、細かさは最大1.5倍）
  const Z = M.size,
    k = Math.min(RS, 1.5),
    key = (pixelOn() ? "p" : "c") + k + M.name;
  if (trialScenery && trialSceneryKey === key) return trialScenery;
  trialSceneryKey = key;
  const cv = document.createElement("canvas");
  cv.width = Math.round(Z.w * k);
  cv.height = Math.round(Z.h * k);
  cv.k = k;
  const g = cv.getContext("2d");
  g.setTransform(k, 0, 0, k, 0, 0);
  // 草地（少しまだら）
  g.fillStyle = "#5f9a4c";
  g.fillRect(0, 0, Z.w, Z.h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1100; i++) {
    g.fillStyle = rnd() < 0.5 ? "#6aa756" : "#558c43";
    g.fillRect(Math.floor(rnd() * Z.w), Math.floor(rnd() * Z.h), 6, 4);
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
  for (const p of all) road(p, 52, "#7a5a36");
  for (const p of all) road(p, 42, "#d4b07a");
  for (const p of all) road(p, 3, "#c49c62");
  // 川：岸の色 → 水 → 細い波。橋は板と欄干
  if (M.river) {
    const R = M.river;
    g.fillStyle = "#7d6a44";
    g.fillRect(R.x0 - 6, 0, R.x1 - R.x0 + 12, Z.h);
    g.fillStyle = "#3f86b8";
    g.fillRect(R.x0, 0, R.x1 - R.x0, Z.h);
    g.strokeStyle = "#8fc7ea88";
    g.lineWidth = 2;
    for (let y = 20; y < Z.h; y += 46) {
      g.beginPath();
      g.moveTo(R.x0 + 12, y);
      g.quadraticCurveTo((R.x0 + R.x1) / 2, y + 10, R.x1 - 12, y);
      g.stroke();
    }
    for (const b of M.bridges) {
      g.fillStyle = "#6b4a2a";
      g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      g.fillStyle = "#a87a48";
      for (let x = b.x0 + 2; x < b.x1 - 2; x += 10) g.fillRect(x, b.y0 + 6, 7, b.y1 - b.y0 - 12);
      g.fillStyle = "#4a3018";
      g.fillRect(b.x0, b.y0, b.x1 - b.x0, 5);
      g.fillRect(b.x0, b.y1 - 5, b.x1 - b.x0, 5);
    }
  }
  // 配置場所の地面（石畳の広場）
  const D = M.deploy;
  g.fillStyle = "#b9a27c";
  g.fillRect(D.x - 6, D.y - 6, D.w + 12, D.h + 12);
  g.fillStyle = "#cdb88f";
  for (let x = D.x; x < D.x + D.w; x += 30) for (let y = D.y; y < D.y + D.h; y += 26) g.fillRect(x + ((y / 26) % 2) * 15, y, 26, 22);
  // 関所の土塁（道の所は門として空ける）
  if (M.gate) {
    g.fillStyle = "#6b5233";
    g.fillRect(M.gate.x - 9, M.gate.y0, 18, 600 - 40 - M.gate.y0);
    g.fillRect(M.gate.x - 9, 600 + 40, 18, M.gate.y1 - 640);
    g.fillStyle = "#8a6a40";
    g.fillRect(M.gate.x - 14, 600 - 52, 28, 12);
    g.fillRect(M.gate.x - 14, 600 + 40, 28, 12);
  }
  // 木と岩（ドット絵のときは素材。木は tree_ の名前）。通れない所
  const pix = (name, x, bottom, s) => {
    const f = PIX.frames[name];
    if (!f || !PIX.atlas) return false;
    const [sx, sy, w, h, ax, ay] = f;
    g.imageSmoothingEnabled = false;
    g.drawImage(PIX.atlas, sx, sy, w, h, x - ax * s, bottom - ay * s, w * s, h * s);
    return true;
  };
  for (const o of [...M.obstacles].sort((a, b) => a.y - b.y)) {
    if (pixelOn() && PIX.atlas && pix(PIX.frames[o.kind] ? o.kind : "tree_" + o.kind, o.x, o.y + 10, PIX_SCALE.tree)) continue;
    if (o.kind === "rock") {
      g.fillStyle = "#8a8a8a";
      g.beginPath();
      g.ellipse(o.x, o.y, 16, 11, 0, 0, 7);
      g.fill();
    } else {
      g.fillStyle = "#2f6b33";
      g.beginPath();
      g.arc(o.x, o.y - 14, 18, 0, 7);
      g.fill();
      g.fillStyle = "#6b4a2a";
      g.fillRect(o.x - 3, o.y - 2, 6, 12);
    }
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
  // 道の名前と、敵が出てくる所の印
  g.font = "bold 18px system-ui";
  g.fillStyle = "#fff4d0";
  g.strokeStyle = "#3a2a16";
  g.lineWidth = 4;
  for (const [k2, p] of Object.entries(M.lanes)) {
    g.strokeText("⚑ " + M.labels[k2], 14, p[0][1] - 34);
    g.fillText("⚑ " + M.labels[k2], 14, p[0][1] - 34);
  }
  trialScenery = cv;
  return cv;
}
// カメラ：操作している兵士を追う（少しずつ動いて急に飛ばない）。操作していないときは戦場の全体。配置の間は配置場所
//   見える範囲はいつも戦場の中に収める。cam = { x, y, z }（見ている所の中心と拡大）
function trialCamGoal(T) {
  const Z = T.map.size,
    fit = Math.max(W / Z.w, H / Z.h),
    u = T.control != null ? T.units.find((v) => v.id === T.control && !v.dead) : null;
  if (T.phase === "deploy") {
    const D = T.map.deploy;
    return { x: D.x + D.w / 2, y: D.y + D.h / 2, z: TRIAL_RULES.camZoom };
  }
  if (u) return { x: u.x, y: u.y - 20, z: TRIAL_RULES.camZoom };
  return { x: Z.w / 2, y: Z.h / 2, z: fit };
}
function trialCamStep(T, snap) {
  const goal = trialCamGoal(T),
    now = performance.now(),
    dt = Math.min(0.1, Math.max(0, ((T.camAt ? now - T.camAt : 1e9) || 0) / 1000));
  T.camAt = now;
  if (!T.view || snap) T.view = { ...goal };
  else {
    const a = 1 - Math.exp(-TRIAL_RULES.camEase * dt);
    T.view.x += (goal.x - T.view.x) * a;
    T.view.y += (goal.y - T.view.y) * a;
    T.view.z += (goal.z - T.view.z) * a;
  }
}
function trialView() {
  const T = trial;
  if (!T) return { z: 1, ox: 0, oy: 0 };
  if (!T.view) trialCamStep(T, true);
  const Z = T.map.size,
    v = T.view,
    vw = W / v.z,
    vh = H / v.z,
    ox = Math.max(0, Math.min(Z.w - vw, v.x - vw / 2)),
    oy = Math.max(0, Math.min(Z.h - vh, v.y - vh / 2)),
    u = T.control != null ? T.units.find((x) => x.id === T.control && !x.dead) : null;
  return { z: v.z, ox, oy, u };
}
// サバイバルの残り時間（強敵が出たあと、時間を過ぎたら「強敵を倒せ」）
function trialClock(T) {
  const left = Math.max(0, Math.ceil(TRIAL_SURVIVAL.duration - T.t));
  if (T.boss && !T.boss.gone && !left) return "⚠ 大将を倒せ！";
  return "残り " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0") + (T.boss && !T.boss.gone ? " ⚠大将" : "");
}
function drawTrial() {
  const T = trial;
  trialCamStep(T, false);
  const V = trialView(),
    bg = trialBackground(T.map),
    k = bg.k;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctxRaw.drawImage(bg, V.ox * k, V.oy * k, (W / V.z) * k, (H / V.z) * k, 0, 0, C.width, C.height);
  ctx.restore();
  ctx.save();
  ctx.setTransform(RS * V.z, 0, 0, RS * V.z, -V.ox * RS * V.z, -V.oy * RS * V.z);
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
  if (V.u) {
    // 操作している兵士の足元に金の輪と、頭の上に ▼
    ctx.save();
    ctx.strokeStyle = "#ffe27a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(V.u.x, V.u.y + 12, 24, 8, 0, 0, 7);
    ctx.stroke();
    ctx.fillStyle = "#ffe27a";
    ctx.beginPath();
    const ty = V.u.y - 104 + (reduced ? 0 : Math.sin(visualTime * 5) * 3);
    ctx.moveTo(V.u.x - 9, ty);
    ctx.lineTo(V.u.x + 9, ty);
    ctx.lineTo(V.u.x, ty + 11);
    ctx.fill();
    ctx.restore();
  }
  const actors = [];
  for (const u of T.units) if (u.placed) actors.push({ y: u.y, draw: () => trialDrawUnit(u) });
  for (const e of T.enemies) if (!e.gone) actors.push({ y: e.y, draw: () => trialDrawEnemy(e) });
  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) a.draw();
  for (const s of shots) projectile(s);
  for (const e of effects) effect(e);
  ctx.restore();
  screenSpace((SW, SH) => {
    // 画面の外の敵の向きを、端に赤い印で出す（見失わない）
    for (const e of T.enemies) {
      if (e.gone) continue;
      const sx = (e.x - V.ox) * V.z,
        sy = (e.y - V.oy) * V.z;
      if (sx >= 0 && sx <= SW && sy >= 0 && sy <= SH) continue;
      if (e === T.boss) {
        // 大将：画面の端に、向きを指す大きい矢印と「大将」
        const cx = SW / 2,
          cy = SH / 2,
          a = Math.atan2(sy - cy, sx - cx),
          k = Math.min((SW / 2 - 34) / Math.abs(Math.cos(a) || 1e-6), (SH / 2 - 40) / Math.abs(Math.sin(a) || 1e-6)),
          ax = cx + Math.cos(a) * k,
          ay = Math.max(ax > SW - 190 ? 140 : 128, cy + Math.sin(a) * k);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(a);
        ctx.fillStyle = "#ff2a1a";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(24, 0);
        ctx.lineTo(-12, -16);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-12, 16);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
        ctx.font = "bold 16px system-ui";
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#1a120c";
        ctx.strokeText("大将", ax - Math.cos(a) * 34, ay - Math.sin(a) * 28 + 6);
        ctx.fillStyle = "#ffd0c8";
        ctx.fillText("大将", ax - Math.cos(a) * 34, ay - Math.sin(a) * 28 + 6);
        continue;
      }
      ctx.fillStyle = e.role ? "#ff2a1acc" : "#ff5a4acc";
      ctx.beginPath();
      ctx.arc(Math.max(9, Math.min(SW - 9, sx)), Math.max(48, Math.min(SH - 9, sy)), e.role ? 9 : 6, 0, 7);
      ctx.fill();
    }
    trialMiniMap(T, V, SW);
    // 上の帯：ステージ・敵の残り・生き残り・時間
    const left = T.queue.length + T.enemies.filter((e) => !e.gone).length,
      alive = T.units.filter((u) => !u.dead).length,
      text =
        T.mode === "survival"
          ? "Lv" + T.slv + "　" + trialClock(T) + "　撃破 " + T.kills + "　👥" + T.units.filter((u) => !u.dead).length + "/" + (T.units.length + T.reserve.length)
          : "⚔ " + T.map.name + "　敵 " + left + "/" + T.total + "　味方 " + alive + "/" + T.units.length + (T.phase === "fight" ? "　" + Math.floor(T.t) + "秒" : "　配置中");
    ctx.font = "bold " + (T.mode === "survival" ? 25 : 22) + "px system-ui";
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = "#1a120ccc";
    ctx.fillRect(Math.max(4, (SW - 170) / 2 - w / 2), 6, w, 32);
    ctx.fillStyle = "#ffe9b0";
    ctx.textAlign = "center";
    ctx.fillText(text, Math.max(4 + w / 2, (SW - 170) / 2), 30);
    if (T.mode === "survival") {
      // 主人公のHP と経験値（左上・iPhone の縦でも読める大きさ。HP はここ1か所だけ）
      const h = T.units.find((u) => u.id === T.hero),
        r = Math.max(0, h.hp / h.max),
        bw = 300,
        need = TRIAL_SURVIVAL.need(T.slv),
        xr = Math.min(1, T.xp / need);
      ctx.fillStyle = "#1a120ccc";
      ctx.fillRect(6, 44, bw + 12, 66);
      ctx.fillStyle = "#3a2a22";
      ctx.fillRect(12, 50, bw, 30);
      ctx.fillStyle = r > 0.5 ? "#5fd36b" : r > 0.25 ? "#ffc14d" : "#ff5a4a";
      ctx.fillRect(12, 50, bw * r, 30);
      ctx.fillStyle = "#2a2440";
      ctx.fillRect(12, 84, bw, 20);
      ctx.fillStyle = "#7fc8ff";
      ctx.fillRect(12, 84, bw * xr, 20);
      ctx.textAlign = "left";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#10202a";
      ctx.font = "bold 24px system-ui";
      ctx.strokeText("HP " + Math.ceil(h.hp) + "/" + Math.round(h.max), 18, 74);
      ctx.fillStyle = "#fff";
      ctx.fillText("HP " + Math.ceil(h.hp) + "/" + Math.round(h.max), 18, 74);
      ctx.font = "bold 18px system-ui";
      ctx.strokeText("Lv" + T.slv + "  EXP " + T.xp + "/" + need, 18, 101);
      ctx.fillStyle = "#e8f3ff";
      ctx.fillText("Lv" + T.slv + "  EXP " + T.xp + "/" + need, 18, 101);
    }
  });
  screenSpace(drawCombatOverlay);
  trialHudSync();
  trialUnitsSync(false);
}
// 小さな全体マップ（右上）：道・川・配置場所・味方（青、操作中は金）・敵（赤）・いま見えている範囲
function trialMiniMap(T, V, SW) {
  const Z = T.map.size,
    mw = 150,
    s = mw / Z.w,
    mh = Z.h * s,
    x0 = SW - mw - 8,
    y0 = 8;
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = "#1f3a22";
  ctx.fillRect(x0 - 2, y0 - 2, mw + 4, mh + 4);
  ctx.fillStyle = "#4f8a40";
  ctx.fillRect(x0, y0, mw, mh);
  ctx.strokeStyle = "#d4b07a";
  ctx.lineWidth = 2;
  for (const p of [...Object.values(T.map.lanes), T.map.road]) {
    ctx.beginPath();
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x0 + x * s, y0 + y * s) : ctx.moveTo(x0 + Math.max(0, x) * s, y0 + y * s)));
    ctx.stroke();
  }
  if (T.map.river) {
    ctx.fillStyle = "#3f86b8";
    ctx.fillRect(x0 + T.map.river.x0 * s, y0, (T.map.river.x1 - T.map.river.x0) * s, mh);
  }
  ctx.globalAlpha = 1;
  for (const e of T.enemies)
    if (!e.gone) {
      ctx.fillStyle = "#ff4a3a";
      ctx.fillRect(x0 + e.x * s - 1.5, y0 + e.y * s - 1.5, e.role ? 5 : 3, e.role ? 5 : 3);
    }
  for (const u of T.units)
    if (u.placed && !u.dead) {
      ctx.fillStyle = u.id === T.control ? "#ffe27a" : "#7fd0ff";
      ctx.fillRect(x0 + u.x * s - 2, y0 + u.y * s - 2, 4, 4);
    }
  ctx.strokeStyle = "#ffffffcc";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + V.ox * s, y0 + V.oy * s, (W / V.z) * s, (H / V.z) * s);
  ctx.restore();
}
function trialDrawUnit(u) {
  const alpha = u.dead ? 0.35 : 1;
  ellipse(u.x + 2, u.y + 12, 16, 5, "#22352655");
  ctx.save();
  ctx.globalAlpha = alpha;
  unitFigure(u.type, u.x, u.y + 12, { scale: 1.4, face: u.face, job: u.job, pose: u.dead ? "death" : u.atk > 0 ? "attack" : null, walk: !u.dead && u.atk <= 0 && trial && trial.phase === "fight" && u.walkPrev !== u.walk, seed: u.seed });
  u.walkPrev = u.walk;
  ctx.restore();
  if (u.dead) return;
  if (u.hit > 0) {
    ctx.globalAlpha = u.hit * 2;
    ellipse(u.x, u.y - 8, 14, 16, "#ff7b6b");
    ctx.globalAlpha = 1;
  }
  // 職業技・閃きの盾
  if (u.sh.evolutionShield && u.sh.evolutionShield.until > T_now() && u.sh.evolutionShield.amount > 0) {
    ctx.save();
    ctx.strokeStyle = "#9fe6ffaa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(u.x, u.y - 10, 18, 24, 0, 0, 7);
    ctx.stroke();
    ctx.restore();
  }
  // HPの棒（大きめ）と名前
  const r = Math.max(0, u.hp / u.max),
    bw = 54,
    top = u.y - 70;
  ctx.fillStyle = "#1a1a1acc";
  ctx.fillRect(u.x - bw / 2 - 2, top - 2, bw + 4, 13);
  ctx.fillStyle = r > 0.5 ? "#5fd36b" : r > 0.25 ? "#ffc14d" : "#ff5a4a";
  ctx.fillRect(u.x - bw / 2, top, bw * r, 9);
  ctx.font = "bold 17px system-ui";
  ctx.textAlign = "center";
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
  if (e.behavior === "tate") drawTateShield(e);
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
    const sv = R.mode === "survival";
    $("trialTitle").textContent = sv ? "🔥 サバイバル（" + R.stage + "）" : "⚔️ 戦場試練「" + R.stage + "」";
    $("trialBody").innerHTML =
      '<p class="trial-result"><b>' + (sv ? { win: "🏆 勝利！ 大将を倒した", lose: "敗北…（主人公が倒れた）", retreat: "↩ 撤退", timeout: "⌛ 時間切れ（大将を倒せなかった）" }[R.result] : title) + "</b></p>" +
      (sv
        ? "<p>撃破 <b>" + R.kills + "</b>・大将 " + R.boss + "・敵Lv " + R.level + "・" + Math.floor(R.time / 60) + "分" + (Math.floor(R.time) % 60) + "秒</p>" +
          "<p>サバイバル <b>Lv" + R.slv + "</b>・仲間 " + (R.units.length - 1) + "/" + (R.roster - 1) + "人が加入" +
          (R.boons && Object.keys(R.boons).length ? "<br><small>強化：" + Object.entries(R.boons).map(([k, n]) => TRIAL_SURVIVAL.boons[k].icon + TRIAL_SURVIVAL.boons[k].name + "×" + n).join("・") + "</small>" : "") +
          (R.ougi ? "<br>⚔️ 奥義「" + esc(R.ougi.name) + "」：" + R.ougi.hits + "回命中・" + R.ougi.kills + "体撃破" : "") +
          (R.waiting.length ? '<br><small class="muted">加入しなかった候補：' + R.waiting.map(esc).join("・") + "</small>" : "") +
          '<br><small class="muted">サバイバルLv・強化・加入は、この戦闘だけのものです（兵士のLv・経験値には入りません）。</small></p>'
        : "<p>撃破 <b>" + R.kills + "/" + R.total + "</b>・敵Lv " + R.level + "・" + Math.floor(R.time) + "秒</p>") +
      "<p>生存 " + alive.length + "人・戦死 " + dead.length + "人" + (dead.length && !R.real ? '<br><small class="muted">試作のため戦死は仮です。本番の兵士は失われず、英霊名鑑にも載りません。</small>' : "") + "</p>" +
      '<div class="trial-units">' +
      R.units
        .map((u) => {
          const skills = Object.entries(u.skills);
          return (
            '<div class="trial-unit' + (u.dead ? " dead" : "") + (u.mvp ? " mvp" : "") + '" data-trial-unit="' + u.id + '">' +
            (u.mvp ? '<span class="trial-mvp">🏅 活躍</span> ' : "") +
            (u.hero ? "👑 " : "") +
            "<b>" + esc(u.name) + "</b> <small>" + esc(u.job) + "・Lv" + u.lv + "</small><br><small>" +
            (u.dead ? "☠ 戦死（仮）" : "生存 HP " + u.hp + "/" + u.max) +
            "・撃破 " + u.kills + "・与ダメージ " + u.dealt.toLocaleString("ja-JP") + (u.healed ? "・回復 " + u.healed.toLocaleString("ja-JP") : "") +
            "<br>技：" + (skills.length ? skills.map(([k, n]) => esc(k) + "×" + n).join("・") : "なし") +
            "</small></div>"
          );
        })
        .join("") +
      "</div>" +
      '<p class="muted"><small>試作のため、報酬・経験値・熟練度・戦歴はありません。</small></p>' +
      '<div class="card-actions"><button data-trial-again>もう一度（兵士を選ぶ）</button><button data-trial-close>閉じる</button></div>';
    return;
  }
  $("trialTitle").textContent = "⚔️ 戦場試練（試作）";
  const list = soldiers.filter((s) => s.alive).sort((a, b) => b.level - a.level),
    n = trialPick.length,
    busy = trialBusyError(),
    sv = trialMode === "survival";
  if (!trialPick.includes(trialHero)) trialHero = trialPick[0] ?? null;
  $("trialBody").innerHTML =
    '<div class="trial-modes" role="group" aria-label="遊び方">' +
    '<button type="button" data-trial-mode="field" aria-pressed="' + !sv + '">⚔️ 三方の関<small>配置して守る</small></button>' +
    '<button type="button" data-trial-mode="survival" aria-pressed="' + sv + '">🔥 サバイバル<small>主人公を操作</small></button></div>' +
    (sv
      ? '<p class="muted"><small>選んだ兵士の中から<b>主人公</b>を1人決めます（どの職業でも）。<b>戦場に出るのは主人公1人だけ</b>。ほかの兵士（最大4人）は<b>仲間候補</b>で、敵を倒してレベルアップしたときに「👥 仲間を1人加入」を選ぶと、選んだ順に1人ずつ駆けつけます。主人公はスティックで動かし、攻撃と技は自動。約' + Math.round((TRIAL_SURVIVAL.bossAt / 60) * 10) / 10 + "分で大将が現れ、倒せば勝利。<b>主人公が倒れたら敗北</b>。サバイバルLv・強化・加入は、その戦闘だけのものです。<br>"
      : "<p><b>ステージ：" + M.name + "</b><br><small>" + esc(M.text) + "</small></p>" +
        '<p class="muted"><small>育てた兵士を最大' + TRIAL_RULES.maxUnits + "人まで選び、1人ずつ配置します。戦闘が始まると、兵士はそれぞれ自分で敵を探して戦い、職業技・閃きも使います（衛生兵は味方を回復）。敵の強さは、出撃する兵士のLv・職業・装備から決まります。<br>") +
    "<b>試作のため、戦死は仮です（本番の兵士は失われません）。報酬・経験値もありません。</b>修練場はこれまでどおり育成の場所です。</small></p>" +
    (sv && n
      ? '<p>👑 主人公：</p><div class="trial-heroes">' +
        trialPick
          .map((id) => soldierById(id))
          .filter(Boolean)
          .map((s) => '<button type="button" data-trial-hero="' + s.id + '" aria-pressed="' + (trialHero === s.id) + '">' + (trialHero === s.id ? "👑 " : "") + "<b>" + esc(soldierName(s).replace(/^🎖/, "")) + "</b><small>" + JOBS[jobOf(s)].icon + jobName(s) + "</small></button>")
          .join("") +
        "</div>" +
        (n > 1 ? "<p><small>👥 仲間候補（加入する順）：" + trialPick.filter((id) => id !== trialHero).map((id) => esc(soldierName(soldierById(id)).replace(/^🎖/, ""))).join(" → ") + "</small></p>" : '<p class="muted"><small>仲間候補を選ばないと、主人公1人で最後まで戦います（レベルアップは強化だけ）。</small></p>')
      : "") +
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
    '<div class="card-actions"><button data-trial-go' + (n && !busy ? "" : " disabled") + ">" + (sv ? "🔥 主人公1人でサバイバル開始" + (n > 1 ? "（候補" + (n - 1) + "人）" : "") : "⚔️ " + n + "人で出撃（配置へ）") + "</button></div>";
}
// 戦闘中の帯：ステージ・味方・敵の残り・時間（変わったときだけ書き換える）
function trialHudSync() {
  const T = trial;
  if (!T) return;
  const rest = T.units.filter((u) => !u.placed).length,
    left = T.queue.length + T.enemies.filter((e) => !e.gone).length,
    alive = T.units.filter((u) => !u.dead).length;
  if (T.mode === "survival") {
    const h = T.units.find((u) => u.id === T.hero),
      mates = T.units.filter((u) => u.id !== T.hero),
      html2 =
        "<b>🔥 サバイバル</b>　👑 <b>" + esc(h.name) + "</b>　👥 仲間 <b>" + mates.filter((u) => !u.dead).length + "/" + (mates.length + T.reserve.length) + "</b><br><small>スティックで移動（攻撃と技は自動）。レベルアップで強化か仲間を選ぶ</small>";
    if (html2 !== trialHud) (trialHud = html2), ($("trialInfo").innerHTML = html2);
    trialOugiSync(false);
    return;
  }
  const html =
    "<b>⚔️ " + T.map.name + "</b>（試作）　味方 <b>" + alive + "/" + T.units.length + "</b>　敵 <b>" + left + "</b>" + (T.phase === "fight" ? "　" + Math.floor(T.t) + "秒" : "") + "<br>" +
    (T.phase === "deploy"
      ? rest
        ? "配置：あと <b>" + rest + "人</b>（光っている場所をタップ）次は " + esc(T.units.find((u) => !u.placed).name)
        : "全員を配置しました。「⚔ 戦闘開始」で始まります。"
      : T.control != null
        ? "🎮 操作中：<b>" + esc((T.units.find((u) => u.id === T.control) || {}).name || "") + "</b>（スティックで移動・攻撃と技は自動）"
        : "🤖 全員自動。下の名前（または戦場の兵士）を押すと、その兵士を操作できます。");
  if (html !== trialHud) {
    trialHud = html;
    $("trialInfo").innerHTML = html;
  }
}
function trialSyncUI() {
  const T = trial,
    bar = $("trialBar");
  document.body.classList.toggle("trial-on", !!T);
  bar.hidden = !T;
  trialHud = "";
  if (!T) {
    trialOugiSync(true);
    if (typeof updateUI === "function") updateUI();
    return;
  }
  trialHudSync();
  trialUnitsSync(true);
  $("trialCtl").hidden = T.phase !== "fight";
  // サバイバル：主人公は変えないので、兵士の札と「全員自動」は出さない（主人公の周りを広く見せる）
  $("trialUnits").hidden = T.mode === "survival";
  $("trialAutoAll").hidden = T.mode === "survival";
  trialOugiSync(true);
  const rest = T.units.filter((u) => !u.placed).length;
  $("trialAuto").hidden = T.phase !== "deploy" || !rest;
  $("trialGo").hidden = T.phase !== "deploy";
  $("trialGo").disabled = !!rest;
  $("trialRetreat").textContent = T.phase === "deploy" ? "↩ 出撃をやめる" : "↩ 撤退";
}
// 画面の点（ゲームの 960×600）→ 戦場の点（カメラの位置と拡大を戻す）
function trialToWorld(x, y) {
  const V = trialView();
  return { x: V.ox + x / V.z, y: V.oy + y / V.z };
}
function trialToScreen(x, y) {
  const V = trialView();
  return { x: (x - V.ox) * V.z, y: (y - V.oy) * V.z };
}
// タップ：配置の段階は兵士を置く。戦闘中は兵士をタップすると、その兵士を操作する
function trialTap(x, y) {
  const T = trial;
  if (!T) return null;
  const p = trialToWorld(x, y);
  if (T.phase === "deploy") return trialPlace(p.x, p.y);
  if (T.mode === "survival") return null;
  const V = trialView(),
    hit = T.units.filter((u) => !u.dead).sort((a, b) => Math.hypot(a.x - p.x, a.y - 20 - p.y) - Math.hypot(b.x - p.x, b.y - 20 - p.y))[0];
  if (hit && Math.hypot(hit.x - p.x, hit.y - 20 - p.y) < 34 + 26 / V.z) trialControl(hit.id);
  return null;
}
// 操作する兵士を決める（null で全員自動）。技の待ち時間・狙いはそのまま（写しに残る）
function trialControl(id) {
  const T = trial;
  if (!T || T.phase !== "fight") return "戦闘中に切り替えられます。";
  if (T.mode === "survival") return id === T.hero ? null : "サバイバルでは主人公だけを操作します。";
  const u = id == null ? null : T.units.find((v) => v.id === id && !v.dead);
  if (id != null && !u) return "その兵士は操作できません。";
  T.control = u ? u.id : null;
  trialStick = { x: 0, y: 0 };
  for (const v of T.units) v.moving = false;
  trialHud = "";
  trialHudSync();
  trialUnitsSync(true);
  return null;
}
// 兵士の切り替えの札（名前・HP）：変わったときだけ書き換える
let trialUnitsKey = "";
function trialUnitsSync(force) {
  const T = trial,
    box = $("trialUnits");
  if (!T || T.phase !== "fight" || T.mode === "survival") return (box.innerHTML = ""), (trialUnitsKey = "");
  const key = T.control + "|" + T.units.map((u) => (u.dead ? "x" : Math.ceil((u.hp / u.max) * 10))).join(",");
  if (!force && key === trialUnitsKey) return;
  trialUnitsKey = key;
  box.innerHTML = T.units
    .map(
      (u) =>
        '<button type="button" data-trial-ctl="' + u.id + '" aria-pressed="' + (T.control === u.id) + '"' + (u.dead ? " disabled" : "") + ">" +
        "<b>" + esc(u.name.replace(/^🎖/, "").slice(0, 4)) + "</b><small>" + (JOBS[u.jobKey] ? JOBS[u.jobKey].icon : "") + (u.dead ? "☠" : "") + "</small>" +
        '<i style="width:' + Math.max(0, Math.round((u.hp / u.max) * 100)) + '%"></i></button>',
    )
    .join("");
}
$("trialUnits").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-trial-ctl]");
  if (!b || b.disabled || !trial) return;
  const id = +b.dataset.trialCtl;
  trialControl(trial.control === id ? null : id); // 操作中の兵士をもう一度押すと全員自動
});
$("trialAutoAll").onclick = () => trialControl(null);
// v108.3 奥義のボタン（右下）。PC は Space キー
$("trialAction").addEventListener("click", (ev) => {
  if (!ev.target.closest("#trialOugiBtn")) return;
  const err = trialUseOugi();
  if (err) toast(err), msg(err);
});
// v108.2 レベルアップの選択（画面のボタン・PC は 1〜3 のキー）
$("trialLevelUp").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-trial-choose]");
  if (!b) return;
  const err = trialChoose(+b.dataset.trialChoose);
  if (err) toast(err);
});
// 仮想スティック：押した所から指を動かした向きと大きさ。指を離すと止まる。画面はスクロールしない
(() => {
  const pad = $("trialPad"),
    knob = pad.querySelector(".trial-knob");
  let id = null;
  const set = (ev) => {
    const r = pad.getBoundingClientRect(),
      R = r.width / 2,
      dx = ev.clientX - (r.left + R),
      dy = ev.clientY - (r.top + R),
      m = Math.hypot(dx, dy),
      k = m > R * 0.8 ? (R * 0.8) / m : 1;
    trialStick = { x: (dx * k) / (R * 0.8), y: (dy * k) / (R * 0.8) };
    knob.style.transform = "translate(" + Math.round(dx * k) + "px," + Math.round(dy * k) + "px)";
  };
  const end = () => {
    id = null;
    trialStick = { x: 0, y: 0 };
    knob.style.transform = "";
    pad.classList.remove("on");
  };
  pad.addEventListener("pointerdown", (ev) => {
    if (!trial || trial.control == null) {
      if (trial && trial.phase === "fight") toast("名前を押して、操作する兵士を選んでください。");
      return;
    }
    ev.preventDefault();
    id = ev.pointerId;
    try {
      pad.setPointerCapture(id);
    } catch (err) {
      /* 取れなくても動く */
    }
    pad.classList.add("on");
    set(ev);
  });
  pad.addEventListener("pointermove", (ev) => {
    if (ev.pointerId !== id) return;
    ev.preventDefault();
    set(ev);
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(t, (ev) => ev.pointerId === id && end());
  pad.addEventListener("touchmove", (ev) => ev.preventDefault(), { passive: false }); // スティック操作中に画面をスクロールさせない
})();
// PC：WASD・矢印キーで操作している兵士を動かす（戦場試練の戦闘中だけ）
const TRIAL_KEYS = { w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right" };
window.addEventListener("keydown", (ev) => {
  if (trial && trial.choice && /^[1-3]$/.test(ev.key)) return trialChoose(+ev.key - 1), ev.preventDefault();
  if (trial && trial.mode === "survival" && ev.key === " " && !/input|select|textarea|button/i.test(ev.target.tagName)) {
    ev.preventDefault();
    const err = trialUseOugi();
    return err && toast(err);
  }
  const k = TRIAL_KEYS[ev.key.toLowerCase()];
  if (!k || !trial || trial.phase !== "fight" || trial.control == null || /input|select|textarea/i.test(ev.target.tagName)) return;
  trialKeys.add(k);
  ev.preventDefault();
});
window.addEventListener("keyup", (ev) => {
  const k = TRIAL_KEYS[ev.key.toLowerCase()];
  if (k) trialKeys.delete(k);
});
window.addEventListener("blur", () => trialKeys.clear());
$("trialOpen").onclick = () => openTrialSheet("pick");
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
  } else if (d.trialMode) {
    trialMode = d.trialMode === "survival" ? "survival" : "field";
    renderTrialSheet();
  } else if (d.trialHero) {
    trialHero = +d.trialHero;
    renderTrialSheet();
  } else if (d.trialGo !== undefined) {
    const err = startTrial(trialPick, "sanpou", { mode: trialMode, hero: trialHero });
    if (err) return toast(err);
    closeTrialSheet();
    if (trialMode !== "survival") msg("⚔️ 光っている場所をタップして、兵士を1人ずつ配置しよう（「自動で並べる」も使えます）。");
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
// タップ（戦場試練の間だけ。防衛戦のタップ・ドラッグより先に受け取り、防衛戦へは渡さない）
for (const type of ["pointerdown", "pointermove", "pointerup", "click"])
  C.addEventListener(
    type,
    (ev) => {
      if (!trial) return;
      ev.stopImmediatePropagation();
      if (type !== "click") return;
      const p = mapPoint(ev),
        err = trialTap(p.x, p.y);
      if (err) toast(err);
    },
    true,
  );
