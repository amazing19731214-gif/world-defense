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
  timeLimit: 360, // 強敵を倒せないまま、ここまで来たら時間切れ（敗北）。v108.8：300→360
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
  // v108.5 経験値コイン：敵を倒すとその場に落ちる。主人公が近づくと吸い寄せられて、拾ったときに経験値が入る（仲間は拾わない）
  magnet: 190, // 主人公からこの距離に入ったコインは吸い寄せられる
  pick: 18, // この距離まで来たら拾う
  pull0: 240, // 吸い寄せの速さ（px/秒）：はじめ
  pullAcc: 900, // 吸い寄せの加速（px/秒²。主人公より必ず速くなる）
  coinMax: 50, // 戦場に置くコインの上限。超えたら、落ちた所に一番近いコインへ合体（経験値の合計はそのまま）
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
    coins: [], // v108.5 経験値コイン { x, y, xp, pull }（この戦闘だけ）
    floor: 1, // v108.7 いまの面（trial.stage はマップの名前なので別の名前）
    st: 0, // その面の経過時間（秒。大将・敵の出方はこれで決まる）
    bosses: 0, // 倒した大将の数
    rewards: [], // 宝箱の報酬
    skills: {}, // v108.8 攻撃スキル { key: Lv }（この挑戦の間だけ）
    skillCd: {},
    skillUse: {}, // 発動した回数（結果・試験用）
    proj: [], // 飛んでいる手裏剣・弾（届いた時に当たる）
    cleared: null, // 大将を倒した直後（宝箱・次の面へ）
    chest: null,
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
  trialStartSkill(trial, hero); // v108.8 職業に合わせた最初の攻撃スキル
  shots = [];
  effects.length = 0;
  trialStick = { x: 0, y: 0 };
  trialSyncUI();
  msg("🔥 サバイバル開始！ 主人公「" + hero.name + "」がたった1人で戦場へ。敵を倒して経験値を集め、レベルアップで強化するか仲間を呼ぼう。" + Math.round((S.bossAt / 60) * 10) / 10 + "分後に大将が来る。倒すと宝箱が出て、次の面へ進める。");
  return null;
}
// ===== v108.7 無限の面：大将を倒すと宝箱 → 次の面へ。全滅（主人公が倒れる）まで続く =====
//   面ごとに敵が少しずつ強くなる（体力・攻撃・種類）。5面ごとに「鬼大将」。敵の数の上限（36体）は変えない
const TRIAL_STAGES = {
  // v108.8 攻撃スキルで強くなる分に合わせて、面ごとに掛け算で強くする（第1面が1倍。第5面で体力 ×2.9・攻撃 ×1.7、第10面で体力 ×10.6・攻撃 ×3.5）
  hpStep: 0.3, // 面ごとに敵の体力 ×1.3
  atkStep: 0.15, // 面ごとに敵の攻撃 ×1.15
  bossExp: 0.8, // 大将の体力の伸びは、ふつうの敵より少しゆるく（第10面で ×6.6。時間切れで終わりにくく）
  poolShift: 20, // 面ごとに、強い種類の敵が20秒ずつ早く混ざる（最大90秒）
  greatEvery: 5, // この面ごとに鬼大将
  great: { hp: 2.6, atk: 1.35, r: 1.3, name: "鬼大将" },
  bossName: "大将",
  grace: 3, // 面の始まりの、攻撃を受けない秒数（理不尽な即死を防ぐ）
  minHp: 0.35, // 面の始まりに、生きている兵士の HP がこれより少なければここまで戻す（全回復はしない）
  bestKey: "worldDefense.trialBest.v1", // 最高到達面（テスト版の保存の領域にだけ保存）
};
// 宝箱の報酬（その挑戦の間だけ）。weight は出やすさ。special は低い確率（鬼大将の宝箱は高い）
const TRIAL_REWARDS = {
  specialChance: 0.08,
  specialChanceGreat: 0.5,
  common: {
    atk: { icon: "⚔️", name: "攻撃力アップ", text: "与えるダメージ・回復 +25%", weight: 1 },
    rate: { icon: "⚡", name: "攻撃速度アップ", text: "攻撃の間隔 −15%", weight: 1 },
    hp: { icon: "❤️", name: "最大HPアップ", text: "最大HP +25%（増えた分を回復）", weight: 1 },
    heal: { icon: "💚", name: "HP回復", text: "主人公と仲間の HP を最大の60%回復", weight: 1.2, amount: 0.6 },
    move: { icon: "👟", name: "移動速度アップ", text: "歩く速さ +15%", weight: 0.8 },
    range: { icon: "🎯", name: "攻撃範囲アップ", text: "射程・間合い +20%", weight: 0.8 },
    scroll: { icon: "📜", name: "技の巻物", text: "攻撃スキルを1つ強化（強化できるものがなければ、新しく習得）", weight: 1.5, needSkill: true },
  },
  special: {
    raijin: { icon: "⚡", name: "雷神の勾玉", text: "4秒ごとに、主人公のまわりの敵3体へ雷（攻撃力×1.2）", weight: 1, every: 4, n: 3, radius: 260, mul: 1.2 },
    phoenix: { icon: "🔥", name: "不死鳥の羽", text: "主人公が倒れるとき、一度だけ HP 半分で立ち上がる", weight: 1, revive: 0.5 },
    hiden: { icon: "📜", name: "奥義の秘伝書", text: "この挑戦の間、奥義の威力 ×1.5（奥義継承者の主人公だけ）", weight: 1, mul: 1.5, needOugi: true },
  },
};
// 報酬を引く（戦闘の乱数）。奥義の秘伝書は、主人公が奥義を使えるときだけ
function trialRollReward(T, great) {
  // v108.8 進化の条件（元の2つが Lv5）がそろっていれば、宝箱はスキル進化
  const evo = trialEvolveReady(T);
  if (evo.length) return { key: evo[0], special: true, evo: true };
  const opt = trialSkillOptions(T),
    canSkill = opt.up.length + opt.learn.length > 0;
  const R = TRIAL_REWARDS,
    hasOugi = !!(trialOugiInfo(T) || {}).key,
    special = T.rng() < (great ? R.specialChanceGreat : R.specialChance),
    table = special ? R.special : R.common,
    keys = Object.keys(table).filter((k) => (!table[k].needOugi || hasOugi) && (!table[k].needSkill || canSkill)),
    total = keys.reduce((n, k) => n + table[k].weight, 0);
  let x = T.rng() * total;
  for (const k of keys) if ((x -= table[k].weight) <= 0) return { key: k, special };
  return { key: keys[keys.length - 1], special };
}
const trialRewardDef = (r) => (r.evo ? TRIAL_EVOLVES : r.special ? TRIAL_REWARDS.special : TRIAL_REWARDS.common)[r.key];
// 強化を主人公に足す（レベルアップの強化と宝箱の報酬で同じ処理）
function trialApplyBoon(T, hero, key, step) {
  if (key === "atk") hero.atkMul += step;
  else if (key === "rate") hero.rateMul *= 1 - step;
  else if (key === "move") hero.speed *= 1 + step;
  else if (key === "def") hero.defMul *= 1 - step;
  else if (key === "range") (hero.range *= 1 + step), (hero.reachMul *= 1 + step);
  else if (key === "hp") {
    const add = hero.max * step;
    hero.max += add;
    hero.hp = Math.min(hero.max, hero.hp + add);
  }
}
function trialApplyReward(T, r) {
  const hero = T.units.find((u) => u.id === T.hero),
    D = trialRewardDef(r);
  T.rewards.push({ key: r.key, special: r.special, name: D.name, icon: D.icon, stage: T.floor });
  if (r.evo) trialEvolve(T, r.key);
  else if (!r.special && r.key === "scroll") {
    const o = trialSkillOptions(T),
      c = o.up.length ? o.up[Math.floor(T.rng() * o.up.length)] : o.learn[Math.floor(T.rng() * o.learn.length)];
    if (c) trialSkillLearn(T, c.key), (T.rewards[T.rewards.length - 1].name += "（" + TRIAL_SKILLS[c.key].name + " Lv" + T.skills[c.key] + "）");
  } else if (!r.special) {
    if (r.key === "heal") {
      for (const u of T.units) if (!u.dead) (u.hp = Math.min(u.max, u.hp + u.max * D.amount)), trialHealFx(u);
    } else trialApplyBoon(T, hero, r.key, TRIAL_SURVIVAL.boons[r.key].step);
  } else if (r.key === "raijin") T.raijin = T.raijin ? { ...T.raijin, n: T.raijin.n + 2 } : { wait: D.every, n: D.n };
  else if (r.key === "phoenix") T.phoenix = (T.phoenix || 0) + 1;
  else if (r.key === "hiden") T.ougiMul = (T.ougiMul || 1) * D.mul;
  if (effects.length < 64) effects.push({ kind: "ctext", x: hero.x, y: hero.y - 100, text: D.icon + D.name, ougi: !!r.special, age: 0, duration: 1.4 });
}
// 雷神の勾玉：一定の間隔で、主人公のまわりの近い敵へ雷
function trialRaijinTick(T, dt) {
  const R = T.raijin,
    D = TRIAL_REWARDS.special.raijin,
    h = T.units.find((u) => u.id === T.hero);
  if (!R || !h || h.dead || (R.wait -= dt) > 0) return;
  R.wait = D.every;
  const atk = soldierStats(h.sh, true).atk,
    list = T.enemies.filter((e) => !e.gone && trialDist(e, h) <= D.radius).sort((a, b) => trialDist(a, h) - trialDist(b, h)).slice(0, R.n);
  if (!list.length) return (R.wait = 0.5);
  for (const e of list) {
    trialHitEnemy(h, e, atk * D.mul, 0.3, true);
    if (effects.length < 64) effects.push({ kind: "cline", x: e.x, y: e.y - 20, a: -Math.PI / 2 + 0.15, ougi: true, age: 0, duration: 0.35 });
    if (effects.length < 64) effects.push({ kind: "cspark", x: e.x, y: e.y - 12, ougi: true, seed: e.x, age: 0, duration: 0.3 });
  }
  T.raijinHits = (T.raijinHits || 0) + list.length;
  trialSfx("thunder");
}
// 大将を倒した：敵と時間を止め、残りのコインは全部経験値に。宝箱を出す
function trialStageClear(T) {
  const great = !!T.boss.great,
    h = T.units.find((u) => u.id === T.hero);
  T.bosses++;
  T.cleared = { stage: T.floor, great, at: T.t };
  let n = 0;
  for (const e of T.enemies)
    if (!e.gone) {
      e.gone = true;
      if (n++ < 12 && effects.length < 64) effects.push({ kind: "cboom", x: e.x, y: e.y - 8, ougi: false, age: -n * 0.04, duration: 0.5 });
    }
  T.enemies = [];
  T.proj = [];
  const left = T.coins.reduce((a, c) => a + c.xp, 0);
  T.picked = (T.picked || 0) + T.coins.length;
  T.coins = [];
  if (left) trialGainXp(T, left);
  T.flurry = null;
  trialStick = { x: 0, y: 0 };
  trialKeys.clear();
  T.chest = { state: "closed", reward: trialRollReward(T, great), great };
  combatFx.flash = reduced ? 0 : 0.3;
  if (effects.length < 64) effects.push({ kind: "cshock", x: h.x, y: h.y + 6, ougi: true, age: 0, duration: 0.8 });
  if (effects.length < 64) effects.push({ kind: "ctext", x: h.x, y: h.y - 110, text: "第" + T.floor + "面 クリア！", ougi: true, age: 0, duration: 1.8 });
  trialSfx("victory");
  msg("🏆 第" + T.floor + "面クリア！ " + (great ? TRIAL_STAGES.great.name : TRIAL_STAGES.bossName) + "を倒した。宝箱が現れた！");
  trialBest(T);
  trialLevelSync();
  trialSyncUI();
}
// 宝箱を開ける → ドラムロール → 報酬（珍しいものは特別な光と音）→ 受け取る → レベルアップの選択（あれば）→ 次の面へ
function trialChestOpen() {
  const T = trial;
  if (!T || !T.chest || T.chest.state !== "closed") return "いまは開けられません。";
  T.chest.state = "opening";
  trialSfx("roll");
  trialLevelSync();
  setTimeout(() => {
    if (trial !== T || !T.chest || T.chest.state !== "opening") return;
    T.chest.state = "open";
    trialSfx(T.chest.reward.special ? "rare" : "chest");
    trialLevelSync();
  }, reduced ? 0 : 500);
  return null;
}
function trialChestTake() {
  const T = trial;
  if (!T || !T.chest || T.chest.state !== "open") return "いまは受け取れません。";
  trialApplyReward(T, T.chest.reward);
  trialSfx("pick");
  T.chest = null;
  trialAfterChest(T);
  return null;
}
function trialAfterChest(T) {
  if (T.lvUps) {
    T.choiceReadyAt = 0;
    trialOpenChoice(T);
  } else T.chest = { state: "next" };
  trialLevelSync();
  trialSyncUI();
}
// 次の面：敵・コイン・大将を新しくする。主人公・仲間・サバイバルLv・強化・報酬・残りの HP はそのまま（少ない HP だけ少し戻す）
function trialNextStage() {
  const T = trial;
  if (!T || !T.cleared || (T.chest && T.chest.state !== "next") || T.choice) return "いまは進めません。";
  const S = TRIAL_STAGES,
    h = T.units.find((u) => u.id === T.hero),
    Z = T.map.size;
  T.floor++;
  T.st = 0;
  T.boss = null;
  T.bossAt = null;
  T.enemies = [];
  T.coins = [];
  T.next = 1.5;
  T.farCheck = 2;
  T.cleared = null;
  T.chest = null;
  T.flurry = null;
  for (const u of T.units)
    if (!u.dead) {
      if (u.hp < u.max * S.minHp) u.hp = u.max * S.minHp;
      if (u !== h && u.slot) Object.assign(u, { x: Math.max(20, Math.min(Z.w - 20, h.x + u.slot[0])), y: Math.max(40, Math.min(Z.h - 20, h.y + u.slot[1])), target: null });
      u.danger = false;
    }
  const great = T.floor % S.greatEvery === 0;
  if (effects.length < 64) effects.push({ kind: "ctext", x: h.x, y: h.y - 110, text: "第" + T.floor + "面" + (great ? " ⚠ 鬼大将" : ""), ougi: true, age: 0, duration: 1.8 });
  trialSfx("levelup");
  msg("⚔️ 第" + T.floor + "面 開始！" + (great ? "この面の終わりには鬼大将が待つ。" : "") + "（敵が少し強くなった）");
  trialLevelSync();
  trialSyncUI();
  return null;
}
// 最高到達面：テスト版の保存の領域にだけ保存（本番の版では保存しない）
function trialBestRead() {
  if (!window.WD_TEST_STORAGE) return trialBestMem;
  try {
    const v = JSON.parse(localStorage.getItem(TRIAL_STAGES.bestKey) || "null");
    return v && Number.isInteger(v.stage) ? v.stage : 0;
  } catch (err) {
    return 0;
  }
}
let trialBestMem = 0;
function trialBest(T) {
  const reached = T.cleared ? T.floor : T.floor - 1, // 倒した面（クリアした一番先の面）
    best = Math.max(trialBestRead(), reached);
  trialBestMem = best;
  if (window.WD_TEST_STORAGE && best > 0)
    try {
      localStorage.setItem(TRIAL_STAGES.bestKey, JSON.stringify({ stage: best }));
    } catch (err) {
      /* 保存できなくても続ける */
    }
  return best;
}
// ===== v108.8 サバイバルの攻撃スキル（この挑戦の間だけ。本番の兵士には保存しない） =====
//   レベルアップ・宝箱で習得し、同じスキルを選ぶと Lv が上がる（Lv1〜5）。最大6種類。自動で発動し、通常攻撃・職業技・閃き・奥義とは別に動く
//   威力（mul）は主人公の攻撃力の何倍か（サバイバルの攻撃力の強化も効く）。cd は発動の間隔（秒）。数値は表のまま調整できる
//   既存の職業技・閃き・奥義・永久のスキルはこの6枠に入らない
const TRIAL_SKILL_RULES = { maxKinds: 6, maxLv: 5, fx: 64 };
const TRIAL_SKILLS = {
  thunder: {
    icon: "⚡",
    name: "雷撃",
    cd: [2.6, 2.6, 2.6, 1.8, 1.6],
    mul: [1.2, 1.8, 1.8, 1.9, 2.2],
    chain: [1, 1, 3, 3, 5],
    range: 320,
    text: ["近くの敵1体に落雷", "雷の威力が上がる", "雷が3体へ連鎖する！", "雷が速く落ちる", "雷が5体へ連鎖し、敵をしびれさせる！"],
  },
  fireRing: {
    icon: "🔥",
    name: "火炎輪",
    orbs: [1, 2, 3, 3, 3],
    radius: [70, 75, 80, 95, 100],
    mul: [0.5, 0.55, 0.6, 0.8, 0.9],
    gap: 0.6, // 同じ敵に当たる間隔
    spin: 2.6,
    burn: [0, 0, 0, 0, 0.3], // Lv5：燃える（1秒ごとに攻撃力×0.3・2秒）
    text: ["炎の玉が1つ、主人公のまわりを回る", "炎の玉が2つになる！", "炎の玉が3つになる！", "炎の輪が広く・強くなる", "大きな炎が回り、敵を燃やし続ける！"],
  },
  shuriken: {
    icon: "✴️",
    name: "手裏剣乱舞",
    cd: [1.6, 1.6, 1.6, 1.1, 1.0],
    n: [1, 2, 3, 3, 3],
    mul: [0.9, 0.9, 0.9, 1.0, 1.4],
    range: 380,
    pierce: [false, false, false, false, true],
    text: ["近くの敵へ手裏剣を1枚投げる", "手裏剣が2枚になる！", "手裏剣が3枚になる！", "手裏剣を速く投げる", "大きな手裏剣が敵を貫く！"],
  },
  vacuum: {
    icon: "🌪️",
    name: "真空斬",
    cd: [2.2, 2.2, 2.2, 2.0, 1.8],
    len: [260, 340, 340, 360, 380],
    width: [26, 26, 26, 40, 48],
    lines: [1, 1, 2, 2, 4],
    mul: [1.4, 1.4, 1.4, 1.8, 2.0],
    text: ["敵の方へ斬撃を飛ばす", "斬撃が遠くまで届く", "斬撃が2本になる！", "斬撃が太く・強くなる", "十字の斬撃が四方を切り裂く！"],
  },
  spear: {
    icon: "🔱",
    name: "槍衾",
    cd: [1.8, 1.8, 1.8, 1.8, 1.6],
    n: [1, 1, 3, 3, 5],
    len: [120, 120, 130, 170, 200],
    mul: [1.2, 1.6, 1.6, 1.7, 1.9],
    push: [0, 0, 0, 0, 50],
    text: ["敵の方へ槍で突く", "突きが強くなる", "槍が3本になる！", "突きが遠くまで届く", "5本の槍衾が敵を押し返す！"],
  },
  musket: {
    icon: "💥",
    name: "火縄銃連射",
    cd: [2.0, 2.0, 2.0, 2.0, 2.4],
    shots: [1, 1, 2, 2, 8],
    mul: [1.8, 2.4, 2.4, 2.6, 2.2],
    pierce: [1, 1, 1, 3, 3], // 1発で当たる敵の数
    range: 420,
    text: ["近くの敵を自動で撃つ", "弾が強くなる", "2連射になる！", "弾が敵を貫く（3体まで）", "八方へ一斉射撃！"],
  },
  whirl: {
    icon: "🌀",
    name: "旋風斬",
    cd: [2.4, 2.4, 1.8, 1.8, 1.6],
    radius: [90, 115, 115, 120, 170],
    mul: [0.9, 0.9, 0.9, 1.3, 1.5],
    max: 14,
    text: ["主人公のまわりに回転斬り", "回転斬りが広くなる", "回転斬りが速くなる", "回転斬りが強くなる", "大きな旋風がまとめて斬る！"],
  },
  heal: {
    icon: "💚",
    name: "癒やしの陣",
    cd: [6, 6, 6, 4.5, 4],
    pct: [0.05, 0.08, 0.08, 0.09, 0.1],
    allies: [0, 0, 160, 160, 420],
    text: ["主人公を少しずつ回復する", "回復の量が増える", "近くの仲間も回復する！", "回復が速くなる", "広い範囲の味方を回復する！"],
  },
};
// 進化スキル（大将の宝箱で、元の2つがどちらも Lv5 のとき）。元の2つは1つにまとまる（枠が1つ空く）。威力は2つを合わせたより少し強い程度
const TRIAL_EVOLVES = {
  raijinken: { icon: "⚡🌪️", name: "雷神剣", from: ["thunder", "vacuum"], text: "雷をまとった十字の斬撃。当たった敵から雷が連鎖する", cd: 1.6, len: 420, width: 50, mul: 2.4, chain: 2, chainMul: 1.6, ready: true },
  guren: { icon: "🔥🌀", name: "紅蓮旋風", from: ["fireRing", "whirl"], text: "4つの大きな炎が回り、炎の旋風が周りを焼き払う", orbs: 4, radius: 110, orbMul: 1.0, gap: 0.5, cd: 1.6, whirl: 190, mul: 1.8, burn: 0.4, ready: true },
  kagejin: { icon: "✴️🌪️", name: "影刃乱舞", from: ["shuriken", "vacuum"], text: "（準備中：データだけ）", ready: false },
  teppeki: { icon: "🔱💥", name: "鉄壁の弾幕", from: ["spear", "musket"], text: "（準備中：データだけ）", ready: false },
};
const trialSkillDef = (k) => TRIAL_SKILLS[k] || TRIAL_EVOLVES[k];
const trialSkillKinds = (T) => Object.keys(T.skills).length;
// 最初のスキル：主人公の職業に合わせて1つ（近接は真空斬・槍は槍衾・弓は手裏剣・鉄砲は火縄銃・衛生兵は雷撃）
function trialStartSkill(T, h) {
  const k = h.role === "heal" ? "thunder" : h.role === "melee" ? (h.type === "spearman" ? "spear" : "vacuum") : h.shot === "musket" ? "musket" : "shuriken";
  T.skills = { [k]: 1 };
  T.skillCd = { [k]: 1 };
}
// レベルアップ・宝箱で取れるスキル：まだ Lv5 でない持っているスキル（強化）と、枠が空いていれば持っていないスキル（習得）。進化した元のスキルは出さない
function trialSkillOptions(T) {
  const used = new Set(Object.keys(TRIAL_EVOLVES).filter((k) => T.skills[k]).flatMap((k) => TRIAL_EVOLVES[k].from)),
    up = [],
    learn = [];
  for (const k of Object.keys(TRIAL_SKILLS)) {
    if (used.has(k)) continue;
    const lv = T.skills[k] || 0;
    if (lv && lv < TRIAL_SKILL_RULES.maxLv) up.push({ kind: "skill", key: k, from: lv, to: lv + 1 });
    else if (!lv && trialSkillKinds(T) < TRIAL_SKILL_RULES.maxKinds) learn.push({ kind: "skill", key: k, from: 0, to: 1 });
  }
  return { up, learn };
}
function trialSkillLearn(T, key) {
  const lv = (T.skills[key] || 0) + 1;
  T.skills[key] = Math.min(TRIAL_SKILL_RULES.maxLv, lv);
  if (!T.skillCd[key]) T.skillCd[key] = 0.5;
  const h = T.units.find((u) => u.id === T.hero),
    D = TRIAL_SKILLS[key];
  if (effects.length < TRIAL_SKILL_RULES.fx) effects.push({ kind: "ctext", x: h.x, y: h.y - 100, text: D.icon + D.name + (lv > 1 ? " Lv" + lv : " 習得！"), ougi: lv >= 5, age: 0, duration: 1.3 });
}
// 進化：元の2つが Lv5 で、その進化をまだ持っていない（用意できている進化だけ）
function trialEvolveReady(T) {
  return Object.keys(TRIAL_EVOLVES).filter((k) => TRIAL_EVOLVES[k].ready && !T.skills[k] && TRIAL_EVOLVES[k].from.every((f) => T.skills[f] >= TRIAL_SKILL_RULES.maxLv));
}
function trialEvolve(T, key) {
  const E = TRIAL_EVOLVES[key];
  for (const f of E.from) delete T.skills[f], delete T.skillCd[f];
  T.skills[key] = TRIAL_SKILL_RULES.maxLv;
  T.skillCd[key] = 0.3;
  T.evolved = (T.evolved || 0) + 1;
}
// ===== 発動（毎コマ。主人公が生きている間） =====
function trialSkillTick(T, dt) {
  const h = T.units.find((u) => u.id === T.hero);
  if (!h || h.dead || !T.skills) return;
  const atk = soldierStats(h.sh, true).atk,
    foes = T.enemies.filter((e) => !e.gone);
  // 燃えている敵（火炎輪 Lv5・紅蓮旋風）
  for (const e of foes)
    if (e.burn && e.burn.until > T.t && (e.burn.tick -= dt) <= 0) {
      e.burn.tick = 1;
      trialHitEnemy(h, e, e.burn.dmg, 0.2, true);
    }
  // 飛んでいる手裏剣・弾：届いた時に当てる（見た目と当たりをそろえる）
  if (T.proj.length) {
    for (const P of T.proj) P.t -= dt;
    for (const P of T.proj.filter((P) => P.t <= 0)) for (const e of P.hits) if (!e.gone) trialHitEnemy(h, e, P.dmg, P.pierce || 0, true);
    T.proj = T.proj.filter((P) => P.t > 0);
  }
  for (const k of Object.keys(T.skills)) {
    const lv = T.skills[k],
      i = lv - 1;
    if (k === "fireRing" || k === "guren") trialOrbs(T, h, k, i, atk, foes);
    if ((T.skillCd[k] = (T.skillCd[k] || 0) - dt) > 0) continue;
    const D = trialSkillDef(k),
      fire = TRIAL_SKILL_CAST[k];
    if (!fire) continue;
    T.skillCd[k] = Array.isArray(D.cd) ? D.cd[i] : D.cd || 1;
    const used = fire(T, h, D, i, atk, foes);
    if (used === false) T.skillCd[k] = 0.3; // 当てる相手がいなければ、すぐにもう一度ためす
    else T.skillUse[k] = (T.skillUse[k] || 0) + 1;
  }
}
const trialNearestN = (h, foes, n, range) =>
  foes
    .filter((e) => !e.gone && trialDist(e, h) <= range)
    .sort((a, b) => trialDist(a, h) - trialDist(b, h))
    .slice(0, n);
// 直線に当たる敵（幅 width・長さ len・max 体まで。近い順）
function trialLineHits(o, a, len, width, foes, max = 99) {
  const ux = Math.cos(a),
    uy = Math.sin(a),
    out = [];
  for (const e of foes) {
    if (e.gone) continue;
    const px = e.x - o.x,
      py = e.y - o.y,
      along = px * ux + py * uy;
    if (along > 0 && along <= len && Math.abs(px * uy - py * ux) <= width + (e.r || 12)) out.push([along, e]);
  }
  return out
    .sort((p, q) => p[0] - q[0])
    .slice(0, max)
    .map((p) => p[1]);
}
const trialFx = (e) => effects.length < TRIAL_SKILL_RULES.fx && effects.push(e);
const trialShot = (s) => {
  if (shots.length >= 160) shots.shift();
  shots.push({ age: 0, quiet: true, col: "#a56b35", ...s });
};
// 雷の連鎖（雷撃・雷神剣）：最初の敵から近い敵へ順に
function trialChainBolt(T, h, first, n, dmg, foes, stun) {
  let cur = first;
  const hit = new Set();
  for (let c = 0; c < n && cur; c++) {
    hit.add(cur);
    trialHitEnemy(h, cur, dmg, 0.3, true);
    if (stun && !cur.gone) (cur.evolutionSlow = { value: 0.5, until: T.t + 1.2 }), (cur.cd = Math.max(cur.cd, 0.6));
    trialFx({ kind: "cline", x: cur.x, y: cur.y - 18, a: -Math.PI / 2 + 0.12, ougi: true, age: 0, duration: 0.3 });
    const next = foes.filter((e) => !e.gone && !hit.has(e) && trialDist(e, cur) < 170).sort((a, b) => trialDist(a, cur) - trialDist(b, cur))[0];
    if (next) trialShot({ x: cur.x, y: cur.y - 16, tx: next.x, ty: next.y - 16, type: "magic", duration: 0.09, trail: 2, glow: "#cfefff" });
    cur = next;
  }
}
const TRIAL_SKILL_CAST = {
  thunder: (T, h, D, i, atk, foes) => {
    const t = trialNearestN(h, foes, 1, D.range)[0];
    if (!t) return false;
    trialChainBolt(T, h, t, D.chain[i], atk * D.mul[i], foes, i >= 4);
    trialSfx("thunder", { vol: 0.7 });
  },
  shuriken: (T, h, D, i, atk, foes) => {
    const list = trialNearestN(h, foes, D.n[i], D.range);
    if (!list.length) return false;
    for (const e of list) {
      const a = Math.atan2(e.y - h.y, e.x - h.x),
        dur = Math.min(0.28, trialDist(e, h) / 900),
        hits = D.pierce[i] ? trialLineHits(h, a, D.range, 22, foes, 8) : [e];
      T.proj.push({ t: dur, hits, dmg: atk * D.mul[i] });
      trialShot({ x: h.x, y: h.y - 20, tx: D.pierce[i] ? h.x + Math.cos(a) * D.range : e.x, ty: D.pierce[i] ? h.y - 20 + Math.sin(a) * D.range : e.y - 10, type: "arrow", duration: D.pierce[i] ? 0.35 : dur, trail: 2, glow: i >= 4 ? "#e0e0ff" : "#c8c8d8", col: "#6b7080" });
    }
    trialSfx("bow", { vol: 0.6 });
  },
  vacuum: (T, h, D, i, atk, foes) => {
    const t = trialNearestN(h, foes, 1, D.len[i] + 60)[0];
    if (!t) return false;
    const a0 = Math.atan2(t.y - h.y, t.x - h.x),
      dirs = D.lines[i] === 4 ? [0, 1, 2, 3].map((k) => a0 + (k * Math.PI) / 2) : D.lines[i] === 2 ? [a0 - 0.22, a0 + 0.22] : [a0],
      o = { x: h.x, y: h.y - 10 },
      seen = new Set();
    for (const a of dirs) for (const e of trialLineHits(o, a, D.len[i], D.width[i], foes)) if (!seen.has(e)) seen.add(e), trialHitEnemy(h, e, atk * D.mul[i], 0.1, true);
    trialFx({ kind: "cwave", x: o.x, y: o.y, rays: dirs, len: D.len[i], width: D.width[i], ougi: i >= 4, age: 0, duration: 0.42 });
    trialSfx("slash", { vol: 0.8 });
  },
  spear: (T, h, D, i, atk, foes) => {
    const t = trialNearestN(h, foes, 1, D.len[i] + 40)[0];
    if (!t) return false;
    const a0 = Math.atan2(t.y - h.y, t.x - h.x),
      n = D.n[i],
      dirs = Array.from({ length: n }, (_, k) => a0 + (k - (n - 1) / 2) * 0.32),
      seen = new Set();
    for (const a of dirs) {
      for (const e of trialLineHits(h, a, D.len[i], 18, foes))
        if (!seen.has(e)) {
          seen.add(e);
          trialHitEnemy(h, e, atk * D.mul[i], 0.1, true);
          if (D.push[i] && !e.gone && e !== T.boss) (e.x += Math.cos(a) * D.push[i]), (e.y += Math.sin(a) * D.push[i]), trialCollide(e);
        }
      trialShot({ x: h.x, y: h.y - 16, tx: h.x + Math.cos(a) * D.len[i], ty: h.y - 16 + Math.sin(a) * D.len[i], type: "arrow", duration: 0.12, trail: 2, glow: "#fff1a0", col: "#fff6c8" });
    }
    trialSfx("thrust", { vol: 0.8 });
  },
  musket: (T, h, D, i, atk, foes) => {
    const t = trialNearestN(h, foes, 1, D.range)[0];
    if (!t && i < 4) return false;
    const n = D.shots[i],
      a0 = t ? Math.atan2(t.y - h.y, t.x - h.x) : 0,
      dirs = n >= 8 ? Array.from({ length: 8 }, (_, k) => a0 + (k * Math.PI) / 4) : n === 2 ? [a0 - 0.08, a0 + 0.08] : [a0];
    if (!t && !foes.some((e) => trialDist(e, h) < D.range)) return false;
    for (const a of dirs) {
      const hits = trialLineHits(h, a, D.range, 14, foes, D.pierce[i]),
        end = hits.length ? hits[hits.length - 1] : null,
        far = end ? trialDist(end, h) : D.range,
        dur = Math.min(0.16, far / 1800);
      T.proj.push({ t: dur, hits, dmg: atk * D.mul[i], pierce: 0.2 });
      trialShot({ x: h.x + Math.cos(a) * 16, y: h.y - 22, tx: h.x + Math.cos(a) * far, ty: h.y - 22 + Math.sin(a) * far, type: "magic", duration: dur || 0.1, trail: 1, glow: "#ffd27a" });
    }
    burst(h.x + Math.cos(a0) * 18, h.y - 22, "#fff0b0", "gunsmoke");
    trialSfx("gun", { vol: 0.8 });
  },
  whirl: (T, h, D, i, atk, foes) => {
    const list = trialNearestN(h, foes, D.max, D.radius[i]);
    if (!list.length) return false;
    for (const e of list) trialHitEnemy(h, e, atk * D.mul[i], 0.1, true);
    trialFx({ kind: "cwave", x: h.x, y: h.y - 10, rays: [0, 1, 2, 3, 4, 5].map((k) => (k * Math.PI) / 3 + T.t * 3), len: D.radius[i], width: 18, ougi: i >= 4, age: 0, duration: 0.4 });
    trialSfx("slash", { vol: 0.7 });
  },
  heal: (T, h, D, i) => {
    const R = D.allies[i],
      list = T.units.filter((u) => !u.dead && (u === h || (R && trialDist(u, h) <= R)) && u.hp < u.max);
    if (!list.length) return;
    for (const u of list) (u.hp = Math.min(u.max, u.hp + u.max * D.pct[i])), burst(u.x, u.y - 16, "#7be08a", "heal");
    trialFx({ kind: "cshock", x: h.x, y: h.y + 6, ougi: false, age: 0, duration: 0.5 });
    trialSfx("heal", { vol: 0.8 });
  },
  // 進化：雷神剣（十字の斬撃＋当たった敵から雷の連鎖）
  raijinken: (T, h, D, i, atk, foes) => {
    const t = trialNearestN(h, foes, 1, D.len + 60)[0];
    if (!t) return false;
    const a0 = Math.atan2(t.y - h.y, t.x - h.x),
      dirs = [0, 1, 2, 3].map((k) => a0 + (k * Math.PI) / 2),
      o = { x: h.x, y: h.y - 10 },
      seen = new Set();
    for (const a of dirs) for (const e of trialLineHits(o, a, D.len, D.width, foes)) if (!seen.has(e)) seen.add(e), trialHitEnemy(h, e, atk * D.mul, 0.2, true);
    let n = 0;
    for (const e of seen) if (n++ < 6) trialChainBolt(T, h, e, D.chain, atk * D.chainMul, foes.filter((x) => !seen.has(x) || x === e), true);
    trialFx({ kind: "cwave", x: o.x, y: o.y, rays: dirs, len: D.len, width: D.width, ougi: true, age: 0, duration: 0.5 });
    trialSfx("thunder");
    trialSfx("slash");
  },
  // 進化：紅蓮旋風（炎の旋風。回る炎は trialOrbs）
  guren: (T, h, D, i, atk, foes) => {
    const list = trialNearestN(h, foes, 18, D.whirl);
    if (!list.length) return false;
    for (const e of list) {
      trialHitEnemy(h, e, atk * D.mul, 0.2, true);
      if (!e.gone) e.burn = { dmg: atk * D.burn, until: T.t + 2.2, tick: 1 };
    }
    trialFx({ kind: "cwave", x: h.x, y: h.y - 10, rays: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (k * Math.PI) / 4 + T.t * 4), len: D.whirl, width: 24, ougi: true, age: 0, duration: 0.45 });
    burst(h.x, h.y - 10, "#ff8a3a", "gunsmoke");
    trialSfx("slash");
  },
};
// 回る炎（火炎輪・紅蓮旋風）：炎の位置に近い敵へ、同じ敵には gap 秒ごとに当てる
function trialOrbs(T, h, k, i, atk, foes) {
  const D = trialSkillDef(k),
    n = k === "guren" ? D.orbs : D.orbs[i],
    R = k === "guren" ? D.radius : D.radius[i],
    mul = k === "guren" ? D.orbMul : D.mul[i],
    burn = k === "guren" ? D.burn : D.burn[i],
    size = k === "guren" ? 22 : i >= 4 ? 18 : 13,
    gap = D.gap;
  T.orbs = T.orbs || {};
  const pos = [];
  for (let j = 0; j < n; j++) {
    const a = T.t * D.spin * (k === "guren" ? 1.2 : 1) + (j * Math.PI * 2) / n;
    pos.push({ x: h.x + Math.cos(a) * R, y: h.y - 14 + Math.sin(a) * R * 0.7 });
  }
  T.orbs[k] = { pos, size, big: k === "guren" || i >= 4 };
  for (const p of pos)
    for (const e of foes) {
      if (e.gone || Math.hypot(e.x - p.x, e.y - 8 - p.y) > size + (e.r || 12)) continue;
      const key = "orb_" + k;
      if (e[key] > T.t) continue;
      e[key] = T.t + gap;
      trialHitEnemy(h, e, atk * mul, 0.1, true);
      if (burn && !e.gone) e.burn = { dmg: atk * burn, until: T.t + 2, tick: 1 };
      trialFx({ kind: "cspark", x: e.x, y: e.y - 10, ougi: false, seed: e.x, age: 0, duration: 0.25 });
    }
}
// 炎の玉を描く（見えている所だけ・数は多くても4つ×2）
function trialDrawSkills(T) {
  if (!T.orbs) return;
  ctx.save();
  for (const k of Object.keys(T.orbs)) {
    if (!T.skills[k]) continue;
    const O = T.orbs[k];
    for (const p of O.pos) {
      const fl = reduced ? 1 : 0.85 + 0.15 * Math.sin(visualTime * 20 + p.x);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = O.big ? "#ff6a1a" : "#ff9a3a";
      ctx.beginPath();
      ctx.arc(p.x, p.y, O.size * 1.7 * fl, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.arc(p.x, p.y, O.size * fl, 0, 7);
      ctx.fill();
      ctx.fillStyle = "#fff3c4";
      ctx.beginPath();
      ctx.arc(p.x, p.y - O.size * 0.2, O.size * 0.45, 0, 7);
      ctx.fill();
    }
  }
  ctx.restore();
}
// 持っているスキルの表示（戦場の左、HP の棒の下）：アイコンと Lv（Lv5 は★、進化は✨）
function trialDrawSkillBar(T, SW) {
  const keys = Object.keys(T.skills || {});
  if (!keys.length) return;
  ctx.save();
  ctx.textAlign = "center";
  keys.forEach((k, j) => {
    const D = trialSkillDef(k),
      lv = T.skills[k],
      evo = !!TRIAL_EVOLVES[k],
      x = 26 + j * 54,
      y = 136;
    ctx.fillStyle = evo ? "#5a2a7acc" : lv >= 5 ? "#5a4a1ecc" : "#10182acc";
    ctx.fillRect(x - 24, y - 20, 48, 46);
    ctx.strokeStyle = evo ? "#c06bff" : lv >= 5 ? "#ffe27a" : "#9fd8ff88";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 24, y - 20, 48, 46);
    ctx.font = "22px system-ui";
    ctx.fillStyle = "#fff";
    ctx.fillText(D.icon.slice(0, 2), x, y + 4);
    ctx.font = "bold 15px system-ui";
    ctx.fillStyle = evo ? "#f0d0ff" : lv >= 5 ? "#ffe27a" : "#e8f3ff";
    ctx.fillText(evo ? "進化" : lv >= 5 ? "★MAX" : "Lv" + lv, x, y + 22);
  });
  ctx.restore();
}
// ===== v108.2 この戦闘だけの成長（サバイバルLv・強化・仲間の加入）。本番の兵士・保存データには書かない =====
function trialBoonInit(u) {
  Object.assign(u, { atkMul: 1, rateMul: 1, defMul: 1, reachMul: 1 });
}
// 経験値：だれが倒しても入る（部隊の経験値）。必要な量に届いたらレベルアップ（選ぶまで戦闘を止める）
function trialGainXp(T, amount) {
  const S = TRIAL_SURVIVAL;
  T.xp += amount;
  T.xpTotal = (T.xpTotal || 0) + amount;
  while (T.xp >= S.need(T.slv)) {
    T.xp -= S.need(T.slv);
    T.slv++;
    T.lvUps++;
    T.lvAt = T.t; // v108.5 ゲージが満タンで光るのを見せてから選択画面（0.5秒）
    trialSfx("levelup");
  }
}
// ===== v108.5 経験値コイン（この戦闘だけ。保存しない） =====
// 落とす：倒した敵の所（川・木・岩の上なら、倒した敵が少し前にいた所＝必ず歩ける所）。上限を超えたら一番近いコインに足す
function trialDropCoin(T, e) {
  const S = TRIAL_SURVIVAL,
    v = S.xp[e.kind] || 1;
  if (!v) return;
  const M = T.map,
    ok = (x, y) => !trialInRiver(M, x, y) && !M.obstacles.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + 8),
    jx = e.x + (T.rng() - 0.5) * 16,
    jy = e.y + (T.rng() - 0.5) * 16,
    [x, y] = ok(jx, jy) ? [jx, jy] : ok(e.x, e.y) ? [e.x, e.y] : [e.px != null ? e.px : e.x, e.py != null ? e.py : e.y];
  T.dropped = (T.dropped || 0) + v;
  if (T.coins.length >= S.coinMax) {
    let best = T.coins[0];
    for (const c of T.coins) if (Math.hypot(c.x - x, c.y - y) < Math.hypot(best.x - x, best.y - y)) best = c;
    best.xp += v;
    best.merged = (best.merged || 1) + 1;
    T.merges = (T.merges || 0) + 1;
    return;
  }
  T.coins.push({ x, y, xp: v, pull: false, pt: 0, seed: T.rng() * 6.28 });
}
// 吸い寄せと回収：主人公だけ。近づいたコインは加速して主人公へ。拾った分をまとめて経験値に（何枚でも合計がそのまま入る）
function trialCoinTick(T, dt) {
  const S = TRIAL_SURVIVAL,
    h = T.units.find((u) => u.id === T.hero);
  if (!h || h.dead || !T.coins.length) return;
  let got = 0,
    n = 0;
  for (let i = T.coins.length - 1; i >= 0; i--) {
    const c = T.coins[i],
      dx = h.x - c.x,
      dy = h.y - 10 - c.y,
      d = Math.hypot(dx, dy);
    if (!c.pull) {
      if (d > S.magnet) continue; // 遠いコインは動かさない（数が増えても軽い）
      c.pull = true;
    }
    c.pt += dt;
    const step = Math.min(d, (S.pull0 + S.pullAcc * c.pt) * dt);
    c.x += (dx / (d || 1)) * step;
    c.y += (dy / (d || 1)) * step;
    if (d - step <= S.pick) {
      got += c.xp;
      n++;
      T.coins.splice(i, 1);
    }
  }
  if (!got) return;
  T.picked = (T.picked || 0) + n;
  trialGainXp(T, got);
  // 拾った光（まとめて1つ）と、たくさん拾ったときは「+N」の文字。音は短く小さく（間をあける）
  if (effects.length < 60) effects.push({ kind: "cspark", x: h.x, y: h.y - 22, ougi: false, seed: T.t, age: 0, duration: 0.25 });
  T.burst = (T.burst || 0) + got;
  if (!(T.burstAt > T.t)) {
    T.burstAt = T.t + 0.6;
    if (T.burst >= 6 && effects.length < 60) effects.push({ kind: "ctext", x: h.x, y: h.y - 96, text: "+" + T.burst + " EXP", ougi: false, age: 0, duration: 0.9 });
    T.burst = 0;
  }
  trialCoinSound(n);
}
// ===== v108.6 効果音（戦場試練だけ）：Web Audio で音を作る（音声ファイルは使わない）=====
//   ・iPhone の Safari は、画面に触れたあとでないと音を出せない → 触れたとき（戦場試練の間）に準備する
//   ・音が出せない環境（AudioContext がない・作れない）でも、ゲームはそのまま動く（鳴らさないだけ）
//   ・同じ音は間をあける（種類ごとの最短の間隔）。同時に鳴る音は8つまで。通常攻撃は小さく、閃き・奥義・警告は大きく
//   ・音量（大・中・小・消音）は、テスト版（テスト用の保存の領域）にだけ保存する。本番の版では保存しない（開くたびに「中」）
const TRIAL_SFX = {
  key: "worldDefense.trialSfx.v1",
  levels: [
    { v: 0.9, label: "🔊 大" },
    { v: 0.55, label: "🔉 中" },
    { v: 0.25, label: "🔈 小" },
    { v: 0, label: "🔇 消音" },
  ],
  voices: 8, // 同時に鳴らす音の上限
  // 種類：gap（同じ音の最短の間隔・秒）と vol（大きさの目安）
  kinds: {
    slash: { gap: 0.09, vol: 0.22 },
    thrust: { gap: 0.1, vol: 0.22 },
    bow: { gap: 0.1, vol: 0.18 },
    hit: { gap: 0.08, vol: 0.14 },
    gun: { gap: 0.14, vol: 0.32 },
    heal: { gap: 0.3, vol: 0.2 },
    hurt: { gap: 0.15, vol: 0.18 },
    insight: { gap: 0.25, vol: 0.4 },
    ougi: { gap: 0.5, vol: 0.7 },
    warn: { gap: 1.0, vol: 0.35 },
    coin: { gap: 0.06, vol: 0.22 },
    levelup: { gap: 0.3, vol: 0.45 },
    roll: { gap: 0.3, vol: 0.3 },
    card: { gap: 0.05, vol: 0.2 },
    pick: { gap: 0.2, vol: 0.45 },
    boss: { gap: 1, vol: 0.55 },
    bossGreat: { gap: 1, vol: 0.7 },
    victory: { gap: 1, vol: 0.55 },
    chest: { gap: 0.3, vol: 0.45 },
    rare: { gap: 0.3, vol: 0.6 },
    thunder: { gap: 0.3, vol: 0.35 },
  },
};
// 音の雑音は、音だけの乱数で作る（Math.random を使うと、戦闘の乱数（職業技の発動など）の順番が変わってしまうため）
let trialSfxSeed = 12345;
const trialSfxRnd = () => ((trialSfxSeed = (trialSfxSeed * 16807) % 2147483647) / 2147483647);
let trialAudio = null,
  trialNoise = null,
  trialMaster = null,
  trialVoices = [], // 鳴っている音の終わる時刻
  trialSfxLast = {},
  trialSfxStats = { played: {}, skipped: 0, unlocked: false, failed: false },
  trialSfxLevel = (() => {
    // テスト版だけ、保存した音量を読む（本番の版では読まない・書かない）
    if (!window.WD_TEST_STORAGE) return 1;
    try {
      const v = JSON.parse(localStorage.getItem(TRIAL_SFX.key) || "null");
      return v && Number.isInteger(v.level) && TRIAL_SFX.levels[v.level] ? v.level : 1;
    } catch (err) {
      return 1;
    }
  })();
const trialSfxVolume = () => TRIAL_SFX.levels[trialSfxLevel].v;
function trialSfxSetLevel(level) {
  trialSfxLevel = TRIAL_SFX.levels[level] ? level : 1;
  if (trialMaster) trialMaster.gain.value = trialSfxVolume();
  if (window.WD_TEST_STORAGE)
    try {
      localStorage.setItem(TRIAL_SFX.key, JSON.stringify({ level: trialSfxLevel }));
    } catch (err) {
      /* 保存できなくても続ける */
    }
  trialSfxButton();
}
function trialAudioUnlock() {
  if (trialAudio || trialSfxStats.failed) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (typeof AC !== "function") return (trialSfxStats.failed = true);
  try {
    trialAudio = new AC();
    trialMaster = trialAudio.createGain();
    trialMaster.gain.value = trialSfxVolume();
    trialMaster.connect(trialAudio.destination);
    // 斬撃・発砲・ドラムロール用の雑音（0.5秒を1つだけ作って使い回す）
    const n = Math.floor(trialAudio.sampleRate * 0.5);
    trialNoise = trialAudio.createBuffer(1, n, trialAudio.sampleRate);
    const d = trialNoise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = trialSfxRnd() * 2 - 1;
    trialSfxStats.unlocked = true;
  } catch (err) {
    trialAudio = null;
    trialSfxStats.failed = true;
  }
}
// 鳴らす：種類ごとの間隔・同時の数を見てから、build(A, out, t) で音を組み立てる。鳴らさなかったら false
function trialSfx(kind, opt = {}) {
  const K = TRIAL_SFX.kinds[kind];
  if (!K) return false;
  const now = performance.now() / 1000;
  if (now - (trialSfxLast[kind] || -9) < K.gap) return (trialSfxStats.skipped++, false);
  trialSfxLast[kind] = now;
  trialSfxStats.played[kind] = (trialSfxStats.played[kind] || 0) + 1; // 試験用の記録（鳴らせない環境でも数える）
  const A = trialAudio;
  if (!A || !trialSfxVolume()) return false;
  const t = A.currentTime;
  trialVoices = trialVoices.filter((x) => x > t);
  if (trialVoices.length >= TRIAL_SFX.voices && kind !== "ougi" && kind !== "warn") return (trialSfxStats.skipped++, false);
  try {
    if (A.state === "suspended") A.resume();
    const out = A.createGain();
    out.gain.value = K.vol * (opt.vol || 1);
    out.connect(trialMaster);
    const end = TRIAL_SFX_BUILD[kind](A, out, t + (opt.delay || 0), opt);
    trialVoices.push(end);
    return true;
  } catch (err) {
    return false;
  }
}
// 音の部品：音程のある音（osc）と雑音（noise）。どちらも短く、最後は小さくして消す
function trialTone(A, out, t, type, f0, f1, dur, peak = 1, attack = 0.005) {
  const o = A.createOscillator(),
    g = A.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return t + dur;
}
function trialHiss(A, out, t, dur, filter, f0, f1, peak = 1, q = 1) {
  const s = A.createBufferSource(),
    bq = A.createBiquadFilter(),
    g = A.createGain();
  s.buffer = trialNoise;
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bq).connect(g).connect(out);
  s.start(t, trialSfxRnd() * 0.3);
  s.stop(t + dur + 0.02);
  return t + dur;
}
const TRIAL_SFX_BUILD = {
  // 刀：高い所から下がる鋭い風切り
  slash: (A, o, t) => Math.max(trialHiss(A, o, t, 0.09, "bandpass", 5200, 1800, 1, 2.5), trialTone(A, o, t, "triangle", 1400, 600, 0.05, 0.25)),
  // 槍：短く低い突き（ドスッ）
  thrust: (A, o, t) => Math.max(trialTone(A, o, t, "sine", 260, 90, 0.09, 1), trialHiss(A, o, t, 0.05, "lowpass", 1800, 600, 0.5)),
  // 弓：弦の音（ビュン）
  bow: (A, o, t) => Math.max(trialTone(A, o, t, "triangle", 520, 180, 0.12, 0.8), trialHiss(A, o, t, 0.08, "highpass", 2500, 4000, 0.25)),
  // 命中：小さなコツッ
  hit: (A, o, t) => trialTone(A, o, t, "square", 900, 500, 0.035, 0.5),
  // 鉄砲：低い爆発と雑音（ドン）
  gun: (A, o, t) => Math.max(trialHiss(A, o, t, 0.22, "lowpass", 3000, 300, 1), trialTone(A, o, t, "sine", 120, 45, 0.2, 1)),
  // 回復：明るい2つの音（上がる）
  heal: (A, o, t) => Math.max(trialTone(A, o, t, "sine", 880, 880, 0.12, 0.7, 0.01), trialTone(A, o, t + 0.07, "sine", 1318, 1318, 0.16, 0.7, 0.01)),
  // 被弾：短い低い音
  hurt: (A, o, t) => trialTone(A, o, t, "square", 230, 110, 0.07, 0.6),
  // 閃き：きらめく3つの高い音（通常攻撃と違う）
  insight: (A, o, t) => [1568, 2093, 2637].reduce((e, f, i) => Math.max(e, trialTone(A, o, t + i * 0.05, "sine", f, f, 0.18, 0.6, 0.004)), 0),
  // 奥義：低い衝撃・上がる風・和音
  ougi: (A, o, t) =>
    Math.max(
      trialTone(A, o, t, "sine", 90, 35, 0.6, 1, 0.005),
      trialHiss(A, o, t, 0.5, "bandpass", 400, 4000, 0.7, 1.2),
      ...[523, 659, 784].map((f) => trialTone(A, o, t + 0.12, "sawtooth", f, f, 0.45, 0.18, 0.02)),
    ),
  // 警告：2つの短い音（ピッピッ）
  warn: (A, o, t) => Math.max(trialTone(A, o, t, "square", 988, 988, 0.08, 0.5), trialTone(A, o, t + 0.13, "square", 740, 740, 0.08, 0.5)),
  // コイン：短い電子音。続けて拾うと音程が上がる（opt.step）
  coin: (A, o, t, opt) => {
    const f = Math.min(2400, 1046 * Math.pow(2, (opt.step || 0) / 12));
    return trialTone(A, o, t, "triangle", f, f * 1.5, 0.08, 0.8);
  },
  // レベルアップ：上がる4つの音
  levelup: (A, o, t) => [523, 659, 784, 1046].reduce((e, f, i) => Math.max(e, trialTone(A, o, t + i * 0.07, "square", f, f, 0.12, 0.35, 0.004)), 0),
  // ドラムロール風：短い雑音を速く刻んで、だんだん強く（0.45秒）
  roll: (A, o, t) => {
    let e = t;
    for (let i = 0; i < 12; i++) e = Math.max(e, trialHiss(A, o, t + i * 0.035, 0.03, "bandpass", 900 + i * 40, 700, 0.3 + i * 0.05, 1));
    return Math.max(e, trialTone(A, o, t + 0.42, "sine", 130, 70, 0.12, 0.9));
  },
  // カードが出る：小さなシュッ
  card: (A, o, t) => trialHiss(A, o, t, 0.06, "highpass", 3000, 6000, 0.6),
  // 決定：明るい和音ときらめき
  // v108.7 大将の出現：低い2つの角笛のような音。鬼大将は太鼓を足して重く
  boss: (A, o, t) => Math.max(trialTone(A, o, t, "sawtooth", 147, 140, 0.35, 0.45, 0.04), trialTone(A, o, t + 0.38, "sawtooth", 131, 123, 0.5, 0.45, 0.04)),
  bossGreat: (A, o, t) =>
    Math.max(
      trialTone(A, o, t, "sawtooth", 110, 104, 0.4, 0.5, 0.04),
      trialTone(A, o, t + 0.42, "sawtooth", 98, 92, 0.6, 0.5, 0.04),
      ...[0, 0.21, 0.42, 0.63].map((d) => trialTone(A, o, t + d, "sine", 70, 40, 0.18, 1)),
    ),
  // 勝利：明るく上がる短いファンファーレ
  victory: (A, o, t) => [523, 659, 784, 1046, 1318].reduce((e, f, i) => Math.max(e, trialTone(A, o, t + i * 0.09, "triangle", f, f, i === 4 ? 0.45 : 0.14, 0.5, 0.005)), 0),
  // 宝箱の報酬：きらっと2音。珍しい報酬は高く長い和音ときらめき
  chest: (A, o, t) => Math.max(trialTone(A, o, t, "triangle", 988, 988, 0.12, 0.5), trialTone(A, o, t + 0.09, "triangle", 1318, 1318, 0.2, 0.5)),
  rare: (A, o, t) =>
    Math.max(
      ...[784, 988, 1175, 1568].map((f, i) => trialTone(A, o, t + i * 0.06, "triangle", f, f, 0.5, 0.35, 0.005)),
      ...[2093, 2637, 3136].map((f, i) => trialTone(A, o, t + 0.3 + i * 0.05, "sine", f, f, 0.2, 0.25)),
    ),
  // 雷：鋭い雑音と低い響き
  thunder: (A, o, t) => Math.max(trialHiss(A, o, t, 0.18, "highpass", 2000, 600, 1), trialTone(A, o, t + 0.02, "sine", 90, 40, 0.25, 0.6)),
  pick: (A, o, t) => Math.max(...[784, 988, 1175].map((f) => trialTone(A, o, t, "triangle", f, f, 0.3, 0.45, 0.005)), trialTone(A, o, t + 0.08, "sine", 2349, 2349, 0.2, 0.3)),
};
// コインの音：0.6秒の間に続けて拾うと、半音ずつ上がる（12段まで）
let trialCoinChain = { at: 0, step: 0 };
function trialCoinSound(n) {
  if (trial) trial.sfx = (trial.sfx || 0) + 1;
  const now = performance.now();
  trialCoinChain.step = now - trialCoinChain.at < 600 ? Math.min(12, trialCoinChain.step + Math.min(3, n)) : 0;
  trialCoinChain.at = now;
  trialSfx("coin", { step: trialCoinChain.step });
}
// 画面に触れたとき（戦場試練の間）に音を準備する。戦場のタップは先で止められる（stopImmediatePropagation）ので、window の capture で先に受け取る。
//   iPhone は止まった音（suspended）を、触れたときにしか再開できないので、触れるたびに再開もする
for (const type of ["pointerdown", "touchend", "keydown", "click"])
  window.addEventListener(
    type,
    () => {
      if (!trial) return;
      trialAudioUnlock();
      if (trialAudio && trialAudio.state === "suspended") trialAudio.resume().catch(() => {});
    },
    { passive: true, capture: true },
  );
// 音量のボタン（戦場試練の帯）：押すたびに 大 → 中 → 小 → 消音
function trialSfxButton() {
  const b = $("trialSound");
  if (b) {
    b.textContent = TRIAL_SFX.levels[trialSfxLevel].label;
    b.setAttribute("aria-label", "効果音の音量：" + TRIAL_SFX.levels[trialSfxLevel].label.replace(/^\S+ /, "") + "（押すと変わる）");
  }
}
$("trialSound").addEventListener("click", () => {
  trialAudioUnlock();
  trialSfxSetLevel((trialSfxLevel + 1) % TRIAL_SFX.levels.length);
  trialSfx("card");
});
trialSfxButton();
// コインの絵：青く光る丸（見えている所だけ描く）。合体したコインは少し大きい
function trialDrawCoins(T, V) {
  if (!T.coins || !T.coins.length) return;
  const x0 = V.ox - 20,
    y0 = V.oy - 20,
    x1 = V.ox + W / V.z + 20,
    y1 = V.oy + H / V.z + 20;
  ctx.save();
  for (const c of T.coins) {
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    const r = Math.min(17, 8 + Math.sqrt(c.xp) * 2.4), // iPhone の縦でも見える大きさ
      bob = reduced || c.pull ? 0 : Math.sin(visualTime * 4 + c.seed) * 2;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#4fb8ff";
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, r + 7, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#2f8fe0";
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, r, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#dff6ff";
    ctx.beginPath();
    ctx.arc(c.x - r * 0.3, c.y + bob - r * 0.3, r * 0.4, 0, 7);
    ctx.fill();
  }
  ctx.restore();
}
// 経験値ゲージ（画面の上・横長）：拾った分へ滑らかに伸びる。Lv が上がったら満タンまで伸びて光り、次の Lv の 0 から
function trialGaugeStep(T) {
  const S = TRIAL_SURVIVAL,
    now = performance.now(),
    dt = Math.min(0.1, Math.max(0, ((T.gaugeAt ? now - T.gaugeAt : 0) || 0) / 1000)),
    G = T.gauge || (T.gauge = { lv: T.slv, v: T.xp, flash: 0 });
  T.gaugeAt = now;
  G.flash = Math.max(0, G.flash - dt);
  const need = S.need(G.lv),
    target = G.lv < T.slv ? need : T.xp,
    speed = Math.max(need * 1.2, Math.abs(target - G.v) * 6);
  G.v = G.v < target ? Math.min(target, G.v + speed * dt) : target;
  if (G.lv < T.slv && G.v >= need) {
    G.lv++;
    G.v = 0;
    G.flash = 0.6;
  }
  return G;
}
// レベルアップの選択肢：仲間候補が残っていれば「👥 仲間を1人加入」＋強化2つ。いなければ強化3つ
// v108.8 選択肢：仲間候補が残っていれば「仲間を1人加入」。残りは攻撃スキル（新しい習得と、持っているスキルの強化をなるべく両方）。
//   スキルの候補が足りないとき（6種類そろって全部 Lv5 など）は、能力の強化で埋める。同じ候補は2回出さない
function trialChoices(T) {
  const keys = Object.keys(TRIAL_SURVIVAL.boons),
    out = [],
    pick = (arr) => arr.splice(Math.floor(T.rng() * arr.length), 1)[0];
  if (T.reserve.length) out.push({ kind: "recruit", unit: T.reserve[0] });
  const { up, learn } = trialSkillOptions(T);
  if (up.length && out.length < 3) out.push(pick(up));
  if (learn.length && out.length < 3) out.push(pick(learn));
  const rest = [...up, ...learn];
  while (out.length < 3 && rest.length) out.push(pick(rest));
  while (out.length < 3 && keys.length) out.push({ kind: "boon", key: pick(keys) });
  return out;
}
function trialOpenChoice(T) {
  if (T.choice || !T.lvUps) return;
  T.choice = trialChoices(T);
  trialStick = { x: 0, y: 0 };
  trialKeys.clear();
  // v108.6 3枚のカードが順に出て（0.08秒ずつ）、ドラムロール風の音のあと押せるようになる（0.45秒。動きを減らす設定では待たない）
  T.choiceReadyAt = performance.now() + (reduced ? 0 : TRIAL_LEVELUP.ready * 1000);
  trialSfx("roll");
  trialLevelSync();
}
const TRIAL_LEVELUP = { ready: 0.45, stagger: 0.08 };
// 選ぶ：強化は主人公に足す。仲間は候補の次の1人を主人公の近くに呼ぶ。選んだら戦闘を再開
function trialChoose(i, force) {
  const T = trial;
  if (!T || !T.choice) return "いまは選べません。";
  if (!force && T.choiceReadyAt > performance.now()) return null; // カードが出そろうまでは押せない（押し間違いを防ぐ）
  const c = T.choice[i];
  if (!c) return "その選択肢はありません。";
  const S = TRIAL_SURVIVAL,
    hero = T.units.find((u) => u.id === T.hero);
  if (c.kind === "recruit") trialRecruit(T, hero);
  else if (c.kind === "skill") trialSkillLearn(T, c.key);
  else {
    const B = S.boons[c.key];
    T.boons[c.key] = (T.boons[c.key] || 0) + 1;
    trialApplyBoon(T, hero, c.key, B.step);
    if (effects.length < 60) effects.push({ kind: "ctext", x: hero.x, y: hero.y - 96, text: B.icon + B.name, ougi: false, age: 0, duration: 1.1 });
  }
  T.lvUps--;
  T.choice = null;
  // 決定：音と、主人公のまわりの光
  trialSfx("pick");
  if (effects.length < 64) effects.push({ kind: "cshock", x: hero.x, y: hero.y + 6, ougi: true, age: 0, duration: 0.5 });
  burst(hero.x, hero.y - 20, "#fff4b0", "heal");
  if (T.lvUps) trialOpenChoice(T);
  else if (T.cleared) T.chest = { state: "next" }; // v108.7 面のクリアのあとの選択が終わったら「次の面へ」
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
  if (T && !T.choice && T.chest) return trialChestRender(T, box); // v108.7 宝箱・次の面へ
  const key = T && T.choice ? T.slv + "|" + T.choice.map((c) => c.kind + (c.key || c.unit.id) + (c.to || "")).join(",") : "";
  if (key === trialLevelKey) return;
  trialLevelKey = key;
  box.hidden = !key;
  if (!key) return (box.innerHTML = "");
  const S = TRIAL_SURVIVAL,
    wait = Math.max(0, (T.choiceReadyAt || 0) - performance.now()),
    // v108.6 カードは順に出る（animation-delay）。出そろうまでは押せない（disabled）
    attr = (i) => ' style="animation-delay:' + i * TRIAL_LEVELUP.stagger + 's"' + (wait > 0 ? " disabled" : "");
  box.innerHTML =
    '<div class="trial-levelup-card' + (wait > 0 ? " arming" : " ready") + '" role="dialog" aria-label="レベルアップ"><p class="trial-levelup-title">⬆ サバイバル Lv' + T.slv + "<small>（戦闘は止まっています。1つ選ぶ）</small></p>" +
    T.choice
      .map((c, i) => {
        if (c.kind === "recruit") {
          const u = c.unit;
          return '<button type="button" data-trial-choose="' + i + '" class="recruit"' + attr(i) + ">👥 <b>仲間を1人加入</b><small>" + esc(u.name.replace(/^🎖/, "")) + "（" + (JOBS[u.jobKey] ? JOBS[u.jobKey].icon + JOBS[u.jobKey].name : "") + "・Lv" + u.src.level + "）が主人公の近くに来る</small></button>";
        }
        if (c.kind === "skill") {
          const D = TRIAL_SKILLS[c.key];
          return '<button type="button" data-trial-choose="' + i + '" class="skill' + (c.from ? " up" : " new") + (c.to >= 5 ? " max" : "") + '"' + attr(i) + "><span class=\"tag\">" + (c.from ? "強化" : "新しい攻撃スキル") + "</span>" + D.icon + " <b>" + D.name + "</b> " + (c.from ? "Lv" + c.from + " → Lv" + c.to : "Lv1") + "<small>" + esc(D.text[c.to - 1]) + "</small></button>";
        }
        const B = S.boons[c.key];
        return '<button type="button" data-trial-choose="' + i + '"' + attr(i) + ">" + B.icon + " <b>" + B.name + "</b>" + (T.boons[c.key] ? "（" + (T.boons[c.key] + 1) + "回目）" : "") + "<small>" + B.text + "・主人公だけ・この戦闘の間だけ</small></button>";
      })
      .join("") +
    "</div>";
  if (wait > 0)
    setTimeout(() => {
      // 押せるようになった：カードが光る（選べる合図）
      const card = box.querySelector(".trial-levelup-card");
      if (!card || trialLevelKey !== key) return;
      card.classList.replace("arming", "ready");
      for (const b of card.querySelectorAll("[data-trial-choose]")) b.disabled = false;
    }, wait);
}
// v108.7 宝箱の画面：光りながら出る → 開ける → ドラムロール → 報酬（珍しいものは金の光）→ 受け取る。最後に「次の面へ進む」
function trialChestRender(T, box) {
  const C = T.chest,
    key = "chest|" + T.floor + "|" + C.state + "|" + (C.reward ? C.reward.key : "");
  if (key === trialLevelKey) return;
  trialLevelKey = key;
  box.hidden = false;
  const head = '<p class="trial-levelup-title">🏆 第' + T.floor + "面 クリア！<small>" + (T.cleared && T.cleared.great ? TRIAL_STAGES.great.name : TRIAL_STAGES.bossName) + "を倒した（戦闘は止まっています）</small></p>";
  if (C.state === "next") {
    const nextGreat = (T.floor + 1) % TRIAL_STAGES.greatEvery === 0;
    box.innerHTML =
      '<div class="trial-levelup-card ready trial-chest" role="dialog" aria-label="次の面へ">' + head +
      "<p class=\"trial-chest-note\">サバイバル Lv" + T.slv + "・仲間 " + (T.units.length - 1) + "人・報酬 " + T.rewards.length + "個<br><small>次の面は敵が少し強くなります。HP はそのまま（少ない兵士だけ少し戻ります）。" + (nextGreat ? "<b>次は鬼大将の面！</b>" : "") + "</small></p>" +
      '<button type="button" data-trial-chest="next" class="trial-next">⚔️ <b>第' + (T.floor + 1) + "面へ進む</b></button>" +
      '<button type="button" data-trial-chest="end" class="trial-end">↩ ここで終える（結果へ）</button></div>';
    return;
  }
  if (C.state === "closed" || C.state === "opening") {
    box.innerHTML =
      '<div class="trial-levelup-card ready trial-chest" role="dialog" aria-label="宝箱">' + head +
      '<button type="button" data-trial-chest="open" class="trial-chest-box' + (C.great ? " great" : "") + (C.state === "opening" ? " opening" : "") + '"' + (C.state === "opening" ? " disabled" : "") + '><span class="chest-icon">🎁</span><b>' + (C.state === "opening" ? "開けています…" : "宝箱を開ける") + "</b><small>この挑戦の間だけ使える報酬</small></button></div>";
    return;
  }
  const D = trialRewardDef(C.reward);
  box.innerHTML =
    '<div class="trial-levelup-card ready trial-chest" role="dialog" aria-label="報酬">' + head +
    '<div class="trial-reward' + (C.reward.special ? " special" : "") + (C.reward.evo ? " evo" : "") + '"><span class="reward-icon">' + D.icon + "</span><b>" + (C.reward.evo ? "✨ スキル進化 ✨<br>" + D.from.map((f) => TRIAL_SKILLS[f].name).join("＋") + " → " : C.reward.special ? "✨ 珍しい報酬 ✨<br>" : "") + esc(D.name) + "</b><small>" + esc(D.text) + (C.reward.evo ? "（元の2つは1つにまとまり、スキルの枠が1つ空く）" : "") + "・この挑戦の間だけ</small></div>" +
    '<button type="button" data-trial-chest="take" class="trial-take">✅ <b>受け取る</b></button></div>';
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
  if (T.enemies.length > 120) T.enemies = T.enemies.filter((e) => !e.gone); // 倒した敵は溜めない（長く遊んでも軽い）
  const G = TRIAL_STAGES,
    alive = T.enemies.filter((e) => !e.gone),
    f = Math.min(1, T.st / S.bossAt),
    great = T.floor % G.greatEvery === 0,
    sh = Math.pow(1 + G.hpStep, T.floor - 1), // 面が進むほど強い（掛け算）
    sa = Math.pow(1 + G.atkStep, T.floor - 1),
    spec = (kind, at, boss) => ({ kind, at, role: boss ? "boss" : null, hpMul: boss ? S.bossHp * (great ? G.great.hp : 1) * Math.pow(1 + G.hpStep, (T.floor - 1) * G.bossExp) : S.hp * (1 + S.hpGrow * f) * sh, atkMul: (boss ? S.bossAtk * (great ? G.great.atk : 1) : S.atk) * (1 + S.atkGrow * f) * sa, speedMul: S.enemySpeed * (boss ? 1.2 : 1) });
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
  if (!T.boss && T.st >= S.bossAt) {
    const p = trialSpawnPoint(T, hero);
    if (p) {
      T.boss = add(spec("boss", p, true));
      T.bossAt = T.st;
      const name = great ? G.great.name : G.bossName;
      if (great) Object.assign(T.boss, { great: true, r: T.boss.r * G.great.r });
      T.boss.name = name;
      msg("⚠️ 第" + T.floor + "面の" + name + "が現れた！ 倒せば面クリア！（画面の端の赤い矢印の方向）");
      if (effects.length < 60) effects.push({ kind: "ctext", x: hero.x, y: hero.y - 110, text: "⚠ " + name + " 出現！", ougi: true, age: 0, duration: 1.6 });
      combatFx.banner = { name: "⚠ " + name + " 出現", who: "第" + T.floor + "面" + (great ? "・5面ごとの強敵" : ""), age: 0, duration: 1.4 };
      trialSfx(great ? "bossGreat" : "boss");
    }
  }
  if ((T.next -= dt) > 0) return;
  // 強敵が出たあとは、ふつうの敵を少なくする（強敵に集中できるように）
  //   出撃の人数が少ないときは、三方の関と同じ割合（countBase + countStep × 人数）で出現の間隔をのばす
  //   v108.2：主人公1人から始まるので、いま戦場にいる人数で決める（仲間が増えると敵も増える）
  const keep = Math.min(1, TRIAL_RULES.countBase + TRIAL_RULES.countStep * T.units.length);
  T.next = (T.boss ? S.afterBoss : S.interval0 + (S.intervalEnd - S.interval0) * f) / keep;
  const pt = T.st + Math.min(90, G.poolShift * (T.floor - 1)), // 面が進むほど、強い種類が早く混ざる
    pool = S.pools.filter((p) => p[0] <= pt).pop()[1],
    // ふつうの敵は36体まで（大将は別に数える。大将がいても、ふつうの敵は36体を超えない）
    n = Math.min(S.maxAlive - alive.filter((e) => e !== T.boss).length, T.boss ? 1 : 1 + Math.floor(T.st / S.batchEvery)),
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
  if (T.cleared) return; // v108.7 大将を倒したあと（宝箱・次の面へ）は止まる
  T.t += dt;
  const surv = T.mode === "survival";
  if (surv) {
    T.st += dt;
    trialSurvivalTick(T, dt);
    if (T.raijin) trialRaijinTick(T, dt);
    trialSkillTick(T, dt);
    if (T.flurry) trialFlurryTick(T, dt);
    trialCoinTick(T, dt);
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
    if (u.danger && u.hp > u.max * 0.5) u.danger = false; // 回復したら警告を戻す
  }
  for (const e of T.enemies) {
    e.atkAnim = Math.max(0, e.atkAnim - dt);
    e.hit = Math.max(0, e.hit - dt);
  }
  T.fxMax = Math.max(T.fxMax, effects.length);
  if (surv) {
    // サバイバル：主人公が倒れたら敗北（仲間が倒れても続く）。強敵を倒したら勝利
    if (T.units.find((u) => u.id === T.hero).dead) return endTrial("lose");
    if (T.boss && T.boss.gone) return trialStageClear(T); // v108.7 勝利で終わらず、宝箱 → 次の面へ
    if (T.st >= TRIAL_SURVIVAL.timeLimit) return endTrial("timeout");
    // 奥義の直後は、演出を見せてから選択画面を出す（1.5秒。天剣乱舞の連続斬撃の間も待つ）
    if (T.lvUps && !T.flurry && !(T.ougiUsed && T.t - T.ougiUsed.at < 1.5) && !(T.lvAt != null && T.t - T.lvAt < 0.5)) trialOpenChoice(T);
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
        if (!job) trialSfx("insight"); // 閃き：きらめく特別な音
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
    atk = soldierStats(h.sh, true).atk * (T.ougiMul || 1), // v108.7 奥義の秘伝書（この挑戦の間だけ）
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
  trialSfx("ougi");
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
  const atk = soldierStats(h.sh, true).atk * (T.ougiMul || 1),
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
    trialSfx("heal");
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
  // v108.6 攻撃の音（同じ音は間をあける。操作中・主人公の音は少し大きく）
  const loud = trial.control === u.id ? 1 : 0.7;
  if (u.role === "melee") trialSfx(u.type === "spearman" ? "thrust" : "slash", { vol: loud });
  else if (u.shot === "musket") trialSfx("gun", { vol: loud });
  else trialSfx("bow", { vol: loud }) && trialSfx("hit", { delay: 0.2, vol: loud });
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
    if (trial.mode === "survival") trialDropCoin(trial, e);
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
  if (trial.mode === "survival" && trial.st < TRIAL_STAGES.grace) return; // v108.7 面の始まりは攻撃を受けない
  const s = u.sh,
    st = soldierStats(s, true),
    weak = unitOf(s).spearWeak,
    spear = weak && e.kind === "knight" ? 1 + (weak - 1) * (1 - skillSum(s, "spearGuard")) : 1,
    guard = (1 - skillSum(s, "guard")) * (ranged ? (1 - skillSum(s, "rangedGuard")) * (unitOf(s).rangedWeak || 1) : 1) * spear;
  let dmg = Math.min(((raw * SQUAD_RULES.defenseScale) / (SQUAD_RULES.defenseScale + st.def)) * guard * (u.defMul || 1), u.max * TRAINING.maxHit);
  dmg = evolutionAbsorb(s, dmg, ranged, e, T_now()); // 職業技・閃きの盾と受け流し（写しの値だけ変わる）
  u.hp -= dmg;
  u.hit = 0.2;
  // v108.6 被弾の音（小さく・間をあける）。HP が3割を切ったら警告（同じ兵士は8秒に1回まで。5割より回復したら、また鳴る）
  trialSfx("hurt", { vol: trial.control === u.id ? 1 : 0.6 });
  if (u.hp > 0 && u.hp < u.max * 0.3 && !u.danger && !(u.warnAt > trial.t - 8)) {
    u.danger = true;
    u.warnAt = trial.t;
    trialSfx("warn");
    if (effects.length < 60) effects.push({ kind: "ctext", x: u.x, y: u.y - 96, text: "⚠ " + u.name.replace(/^🎖/, "").slice(0, 5) + " 危険", ougi: false, age: 0, duration: 1.2 });
  }
  if (u.hp <= 0 && !u.dead && trial.phoenix && u.id === trial.hero) {
    // v108.7 不死鳥の羽：主人公が倒れるとき、一度だけ HP 半分で立ち上がる
    trial.phoenix--;
    trial.phoenixUsed = (trial.phoenixUsed || 0) + 1;
    u.hp = u.max * TRIAL_REWARDS.special.phoenix.revive;
    burst(u.x, u.y - 20, "#ffb347", "heal");
    if (effects.length < 64) effects.push({ kind: "ctext", x: u.x, y: u.y - 100, text: "🔥 不死鳥の羽！", ougi: true, age: 0, duration: 1.5 });
    if (effects.length < 64) effects.push({ kind: "cshock", x: u.x, y: u.y + 6, ougi: true, age: 0, duration: 0.7 });
    trialSfx("rare");
  }
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
  trialResultView = { stage: T.map.name, mode: T.mode, result, time: T.t, level: T.level, power: T.power, kills: T.kills, total: T.total, units, real: TRIAL_RULES.real, fxMax: T.fxMax, floor: T.mode === "survival" ? T.floor : null, bosses: T.bosses || 0, rewardList: T.rewards ? T.rewards.slice() : [], skillList: T.skills ? Object.keys(T.skills).map((k) => ({ key: k, icon: trialSkillDef(k).icon, name: trialSkillDef(k).name, lv: T.skills[k], evo: !!TRIAL_EVOLVES[k], used: (T.skillUse || {})[k] || 0 })) : [], best: T.mode === "survival" ? trialBest(T) : null, ougi: T.ougiUsed ? { name: LEGEND_OUGI[T.ougiUsed.key].name, hits: T.ougiUsed.hits, kills: T.ougiUsed.kills } : null, boss: T.mode === "survival" ? (T.boss ? (T.boss.gone ? "撃破" : "健在") : "未出現") : null, spawned: T.spawned, coins: T.coins ? { picked: T.picked || 0, xp: T.xpTotal || 0, dropped: T.dropped || 0, left: T.coins.reduce((n, c) => n + c.xp, 0) } : null, slv: T.slv || null, boons: T.boons ? { ...T.boons } : null, waiting: (T.reserve || []).map((u) => u.name), roster: T.mode === "survival" ? T.units.length + (T.reserve || []).length : null };
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
// v108.7 面の時計：大将が出るまでの残り時間。大将が出たら「⚠大将」
function trialClock(T) {
  if (T.cleared) return "🏆 クリア";
  if (T.boss && !T.boss.gone) return "⚠ " + (T.boss.name || "大将") + "を倒せ！";
  const left = Math.max(0, Math.ceil(TRIAL_SURVIVAL.bossAt - T.st));
  return (T.floor % TRIAL_STAGES.greatEvery === 0 ? "鬼大将まで " : "大将まで ") + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
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
  if (T.mode === "survival") trialDrawCoins(T, V), trialDrawSkills(T);
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
          ? "第" + T.floor + "面　" + trialClock(T) + "　撃破 " + T.kills + "　👥" + T.units.filter((u) => !u.dead).length + "/" + (T.units.length + T.reserve.length)
          : "⚔ " + T.map.name + "　敵 " + left + "/" + T.total + "　味方 " + alive + "/" + T.units.length + (T.phase === "fight" ? "　" + Math.floor(T.t) + "秒" : "　配置中");
    ctx.font = "bold " + (T.mode === "survival" ? 25 : 22) + "px system-ui";
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = "#1a120ccc";
    ctx.fillRect(Math.max(4, (SW - 170) / 2 - w / 2), 6, w, 32);
    ctx.fillStyle = "#ffe9b0";
    ctx.textAlign = "center";
    ctx.fillText(text, Math.max(4 + w / 2, (SW - 170) / 2), 30);
    if (T.mode === "survival") {
      // v108.5 経験値ゲージ（上の帯の下・横長）と主人公のHP（その下・左）。HP・残り時間・撃破・人数（上の帯）を隠さない
      const h = T.units.find((u) => u.id === T.hero),
        r = Math.max(0, h.hp / h.max),
        G = trialGaugeStep(T),
        need = TRIAL_SURVIVAL.need(G.lv),
        xr = Math.min(1, G.v / need),
        gw = SW - 186, // 右上の全体図の手前まで
        full = xr >= 0.999 || G.flash > 0;
      ctx.fillStyle = "#10182acc";
      ctx.fillRect(6, 42, gw + 12, 34);
      ctx.fillStyle = "#23304a";
      ctx.fillRect(12, 47, gw, 24);
      const grad = ctx.createLinearGradient(12, 0, 12 + gw, 0);
      grad.addColorStop(0, "#3a8dff");
      grad.addColorStop(1, "#7fe3ff");
      ctx.fillStyle = grad;
      ctx.fillRect(12, 47, gw * xr, 24);
      if (full) {
        // 満タン・レベルアップの光
        ctx.save();
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(visualTime * 18);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.strokeRect(10, 45, gw + 4, 28);
        ctx.fillStyle = "#ffffff55";
        ctx.fillRect(12, 47, gw, 24);
        ctx.restore();
      }
      ctx.textAlign = "left";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#0a1020";
      ctx.font = "bold 22px system-ui";
      const lvText = "Lv" + G.lv + (G.flash > 0 ? " UP!" : "");
      ctx.strokeText(lvText, 18, 67);
      ctx.fillStyle = G.flash > 0 ? "#fff6a8" : "#ffffff";
      ctx.fillText(lvText, 18, 67);
      ctx.textAlign = "right";
      ctx.font = "bold 18px system-ui";
      const xpText = "EXP " + Math.floor(G.v) + "/" + need;
      ctx.strokeText(xpText, 6 + gw, 66);
      ctx.fillStyle = "#e8f3ff";
      ctx.fillText(xpText, 6 + gw, 66);
      // 主人公のHP（ここ1か所）
      ctx.fillStyle = "#1a120ccc";
      ctx.fillRect(6, 80, 252, 32);
      ctx.fillStyle = "#3a2a22";
      ctx.fillRect(12, 85, 240, 22);
      ctx.fillStyle = r > 0.5 ? "#5fd36b" : r > 0.25 ? "#ffc14d" : "#ff5a4a";
      ctx.fillRect(12, 85, 240 * r, 22);
      ctx.textAlign = "left";
      ctx.font = "bold 20px system-ui";
      ctx.strokeText("HP " + Math.ceil(h.hp) + "/" + Math.round(h.max), 18, 103);
      ctx.fillStyle = "#fff";
      ctx.fillText("HP " + Math.ceil(h.hp) + "/" + Math.round(h.max), 18, 103);
      trialDrawSkillBar(T, SW); // v108.8 持っている攻撃スキル
      // v108.7 大将の HP（画面の下・横長。鬼大将は紫）
      const B = T.boss;
      if (B && !B.gone) {
        const bw = SW - 40,
          y = SH - 44,
          br = Math.max(0, B.hp / B.max);
        ctx.fillStyle = "#14080acc";
        ctx.fillRect(14, y - 6, bw + 12, 38);
        ctx.fillStyle = "#3a1416";
        ctx.fillRect(20, y, bw, 26);
        ctx.fillStyle = B.great ? "#b04dff" : "#ff4a3a";
        ctx.fillRect(20, y, bw * br, 26);
        ctx.textAlign = "left";
        ctx.font = "bold 20px system-ui";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#10060a";
        const t = (B.great ? "👹 " : "⚔ ") + (B.name || "大将") + "  " + Math.ceil(B.hp) + "/" + Math.round(B.max);
        ctx.strokeText(t, 28, y + 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(t, 28, y + 20);
      }
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
  // v108.6 HP が3割を切ったら、足元に赤い輪が点滅（音を消していても危険が分かる）
  if (u.hp < u.max * 0.3) {
    ctx.save();
    ctx.globalAlpha = reduced ? 0.8 : 0.45 + 0.4 * Math.abs(Math.sin(visualTime * 6));
    ctx.strokeStyle = "#ff3b2f";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 12, 26, 9, 0, 0, 7);
    ctx.stroke();
    ctx.restore();
  }
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
  if (e.role === "boss" && trial && trial.mode === "survival") {
    // v108.7 大将は金、鬼大将は紫の炎のような輪（ふつうの敵と見分ける）
    ctx.save();
    const p = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(visualTime * (e.great ? 7 : 4));
    ctx.globalAlpha = 0.35 + 0.35 * p;
    ctx.strokeStyle = e.great ? "#c06bff" : "#ffd24a";
    ctx.lineWidth = e.great ? 6 : 4;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 4, e.r + 16 + p * 4, (e.r + 16) * 0.42, 0, 0, 7);
    ctx.stroke();
    if (e.great) {
      ctx.globalAlpha = 0.25 + 0.2 * p;
      ctx.fillStyle = "#8a2be2";
      ctx.beginPath();
      ctx.ellipse(e.x, e.y - e.r * 0.6, e.r + 10, e.r + 18, 0, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }
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
      '<p class="trial-result"><b>' + (sv ? { win: "🏆 勝利！ 大将を倒した", lose: "第" + R.floor + "面で力尽きた（主人公が倒れた）", retreat: "↩ 第" + R.floor + "面で撤退", timeout: "⌛ 第" + R.floor + "面で時間切れ（大将を倒せなかった）" }[R.result] : title) + "</b></p>" +
      (sv
        ? '<p class="trial-stage-sum">🏯 到達 <b>第' + R.floor + "面</b>・👑 大将を倒した数 <b>" + R.bosses + "</b>" + (R.best ? "・🏅 最高 第" + Math.max(R.best, 1) + "面クリア" : "") + "<br>撃破 <b>" + R.kills + "</b>・獲得 EXP <b>" + ((R.coins && R.coins.xp) || 0) + "</b>・敵Lv " + R.level + "・" + Math.floor(R.time / 60) + "分" + (Math.floor(R.time) % 60) + "秒</p>" +
          (R.skillList.length ? "<p><small>🗡 攻撃スキル：" + R.skillList.map((x) => x.icon + esc(x.name) + (x.evo ? "（進化）" : x.lv >= 5 ? "★" : " Lv" + x.lv)).join("・") + "</small></p>" : "") +
          (R.rewardList.length ? "<p><small>🎁 報酬：" + R.rewardList.map((x) => (x.special ? "<b>" : "") + x.icon + esc(x.name) + (x.special ? "</b>" : "")).join("・") + "</small></p>" : "") +
          "<p>サバイバル <b>Lv" + R.slv + "</b>・仲間 " + (R.units.length - 1) + "/" + (R.roster - 1) + "人が加入" +
          (R.coins ? "<br><small>💠 経験値コイン：" + R.coins.picked + "枚・EXP " + R.coins.xp + "（拾わなかった分 " + R.coins.left + "）</small>" : "") +
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
      ? '<p class="muted"><small>選んだ兵士の中から<b>主人公</b>を1人決めます（どの職業でも）。<b>戦場に出るのは主人公1人だけ</b>。ほかの兵士（最大4人）は<b>仲間候補</b>で、敵を倒してレベルアップしたときに「👥 仲間を1人加入」を選ぶと、選んだ順に1人ずつ駆けつけます。主人公はスティックで動かし、攻撃と技は自動。約' + Math.round((TRIAL_SURVIVAL.bossAt / 60) * 10) / 10 + "分で大将が現れ、倒すと宝箱（その挑戦だけの報酬）→ 次の面へ。面が進むほど敵は強くなり、5面ごとに鬼大将。<b>どこまで進めるか挑戦</b>。<b>主人公が倒れたら敗北</b>。サバイバルLv・強化・加入は、その戦闘だけのものです。<br>"
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
        "<b>🔥 第" + T.floor + "面</b>　👑 <b>" + esc(h.name) + "</b>　👥 仲間 <b>" + mates.filter((u) => !u.dead).length + "/" + (mates.length + T.reserve.length) + "</b><br><small>スティックで移動（攻撃と技は自動）。レベルアップで強化か仲間を選ぶ</small>";
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
        '<button type="button" data-trial-ctl="' + u.id + '" aria-pressed="' + (T.control === u.id) + '"' + (u.dead ? " disabled" : "") + (!u.dead && u.hp < u.max * 0.3 ? ' class="danger"' : "") + ">" +
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
  const c = ev.target.closest("[data-trial-chest]");
  if (c && !c.disabled) {
    const a = c.dataset.trialChest,
      err = a === "open" ? trialChestOpen() : a === "take" ? trialChestTake() : a === "next" ? trialNextStage() : (trialBest(trial), endTrial("retreat"), null);
    if (err) toast(err);
    return;
  }
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
