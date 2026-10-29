// 戦歴は既存の兵士保存・戦闘確定点と一緒に保存する。未確定XPだけを先に保存しない。
const CHRONICLE_RULES = Object.freeze({ version: 1, cap: 1e12, logs: 24 });
const CHRONICLE_COUNTERS = [
  "kills",
  "bossKills",
  "bossAssists",
  "healed",
  "rescues",
  "meleeHits",
  "rangedHits",
  "specialHits",
  "meleeLoss",
  "rangedLoss",
  "specialLoss",
  "meleePoints",
  "rangedPoints",
  "survived30",
  "survived10",
  "survivedSingle",
  "revivals",
];
function cleanChronicle(v, s = {}) {
  const o = v && typeof v === "object" ? v : {};
  const out = {
    version: 1,
    life:
      typeof o.life === "string" && /^[\w:-]{1,100}$/.test(o.life)
        ? o.life
        : "legacy:" + (s.id || 0) + ":" + insightHash(s.insight?.seed ?? s.type ?? "soldier"),
    baselineKills: intIn(o.baselineKills, 0, CHRONICLE_RULES.cap, Math.max(0, s.kills || 0)),
    log: (Array.isArray(o.log) ? o.log : [])
      .filter((x) => typeof x === "string")
      .map((x) => x.slice(0, 100))
      .slice(-CHRONICLE_RULES.logs),
  };
  for (const k of CHRONICLE_COUNTERS)
    out[k] = Number.isFinite(o[k]) ? Math.max(0, Math.min(CHRONICLE_RULES.cap, o[k])) : 0;
  out.segment =
    o.segment && typeof o.segment.key === "string" && o.segment.key.length <= 160
      ? {
          key: o.segment.key,
          low: intIn(o.segment.low, 0, 7, 0),
          dead: !!o.segment.dead,
          finished: !!o.segment.finished,
          melee: Math.min(5, Math.max(0, Number(o.segment.melee) || 0)),
          ranged: Math.min(5, Math.max(0, Number(o.segment.ranged) || 0)),
        }
      : null;
  const honorIds = Object.keys(CHRONICLE_HONORS);
  out.honors = [...new Set(Array.isArray(o.honors) ? o.honors : [])].filter((id) => honorIds.includes(id));
  out.pending = [...new Set(Array.isArray(o.pending) ? o.pending : [])].filter(
    (id) => out.honors.includes(id) && CHRONICLE_HONORS[id].reward,
  );
  out.claimed = [...new Set(Array.isArray(o.claimed) ? o.claimed : [])].filter(
    (id) => out.honors.includes(id) && CHRONICLE_HONORS[id].reward,
  );
  out.pending = out.pending.filter((id) => !out.claimed.includes(id));
  out.selected = out.honors.includes(o.selected) ? o.selected : null;
  return out;
}
function chronicleOf(s) {
  return s.chronicle || (s.chronicle = cleanChronicle(null, s));
}
function chronicleNew(s) {
  const c = cleanChronicle(null, s);
  c.life =
    "soldier:" +
    (globalThis.crypto?.randomUUID?.() ||
      Date.now().toString(36) + ":" + Math.random().toString(36).slice(2));
  c.baselineKills = 0;
  return c;
}
function chronicleAdd(c, k, n = 1) {
  if (Number.isFinite(n) && n > 0) c[k] = Math.min(CHRONICLE_RULES.cap, (c[k] || 0) + n);
}
function chronicleLog(s, text) {
  const c = chronicleOf(s);
  c.log.push("W" + wave + " " + String(text).slice(0, 85));
  c.log = c.log.slice(-CHRONICLE_RULES.logs);
}
function chronicleKey() {
  if (battle) return "battle:" + (battle.jobDropRunId ||= newJobDropRunId());
  if (training) return "training:" + (training.jobDropRunId ||= newJobDropRunId()) + ":" + wave;
  return "defense:" + runId + ":" + wave;
}
function chronicleTouch(s) {
  const c = chronicleOf(s),
    key = chronicleKey();
  if (c.segment?.key !== key) c.segment = { key, low: 0, dead: false, finished: false, melee: 0, ranged: 0 };
  return c.segment;
}
function chronicleDamage(s, before, max, ranged, kind) {
  const loss = Math.max(0, Math.min(before, before - Math.max(0, s.hp)));
  if (!loss || !(max > 0)) return;
  const c = chronicleOf(s),
    segment = chronicleTouch(s);
  const special = [
    "poison",
    "thunder",
    "breath",
    "beam",
    "fire",
    "blast",
    "wide",
    "cannon",
    "magic",
  ].includes(kind);
  const type = special ? "special" : ranged ? "ranged" : "melee";
  chronicleAdd(c, type + "Hits");
  chronicleAdd(c, type + "Loss", loss);
  if (!special) segment[type] = Math.min(5, segment[type] + loss / max);
  chronicleLow(s, before, max);
  if (s.hp > 0) {
    if (s.hp <= max * 0.3) segment.low |= 1;
    if (s.hp <= max * 0.1) segment.low |= 2;
    if (max >= 100 && s.hp <= 9) segment.low |= 4;
  }
}
function chronicleHeal(s, target, before, max) {
  const amount = Math.max(0, Math.min(max, target.hp) - Math.max(0, before));
  if (!s?.alive || !target.alive || !amount || !(max > 0)) return;
  const c = chronicleOf(s);
  chronicleTouch(s);
  chronicleAdd(c, "healed", amount);
  if (before / max < 0.3) target._chronicleRescueReady = true;
  if (target._chronicleRescueReady && target.hp / max >= 0.5) {
    chronicleAdd(c, "rescues");
    target._chronicleRescueReady = false;
  }
}
function chronicleKill(s, e) {
  if (e._chronicleCredited) return;
  e._chronicleCredited = true;
  const c = s?.alive ? chronicleOf(s) : null;
  if (c) {
    chronicleTouch(s);
    chronicleAdd(c, "kills");
    chronicleKillBuff(s);
  }
  if (e.kind === "boss" || e.boss) {
    if (c) {
      chronicleAdd(c, "bossKills");
      chronicleLog(s, "強敵に最後の一撃");
    }
    const key = chronicleKey();
    for (const m of soldiers)
      if (m !== s && m.alive && m.chronicle?.segment?.key === key && !m.chronicle.segment.dead)
        chronicleAdd(m.chronicle, "bossAssists");
  }
}
function chronicleDeath(s) {
  chronicleTouch(s).dead = true;
}
function chronicleFinish(s, win) {
  const c = chronicleOf(s),
    seg = c.segment;
  if (!seg || seg.key !== chronicleKey() || seg.finished) return;
  seg.finished = true;
  if (!win || !s.alive || seg.dead || s.heroFell) return;
  chronicleAdd(c, "meleePoints", seg.melee);
  chronicleAdd(c, "rangedPoints", seg.ranged);
  for (const [bit, key] of [
    [1, "survived30"],
    [2, "survived10"],
    [4, "survivedSingle"],
  ])
    if (seg.low & bit) chronicleAdd(c, key);
  if (seg.low)
    chronicleLog(
      s,
      "死線から生還（" + (seg.low & 4 ? "HP一桁" : seg.low & 2 ? "HP10%以下" : "HP30%以下") + "）",
    );
}
function chronicleBlock(s) {
  const c = chronicleOf(s);
  return (
    '<details class="chronicle-box"><summary>📖 戦歴帳</summary><p><small>導入後の記録・保存は戦闘進行と共通</small></p><p>討伐 ' +
    fmt(c.kills) +
    "・強敵 " +
    fmt(c.bossKills) +
    "・支援参加 " +
    fmt(c.bossAssists) +
    "<br>実回復 " +
    fmt(c.healed) +
    "・救命 " +
    fmt(c.rescues) +
    "<br>近接被弾 " +
    fmt(c.meleeHits) +
    "・遠距離被弾 " +
    fmt(c.rangedHits) +
    "<br>生還：HP30%以下 " +
    c.survived30 +
    "回／10%以下 " +
    c.survived10 +
    "回／一桁 " +
    c.survivedSingle +
    "回<br>復活 " +
    c.revivals +
    "回</p>" +
    c.log.map((x) => "<p><small>" + esc(x) + "</small></p>").join("") +
    "</details>"
  );
}
// 称号は既存の階級補正と別。条件達成と受取を兵士保存の正本へ記録する。
const CHRONICLE_HONORS = Object.fromEntries(
  [
    ["kills100", "百人斬り", "kills", 100, "chronicleBlade"],
    ["kills500", "五百の武功", "kills", 500, null],
    ["kills1000", "千軍の猛者", "kills", 1000, "chronicleWarCharm"],
    ["kills5000", "万軍への道", "kills", 5000, null],
    ["heal1000", "命をつなぐ者", "healed", 1000, null],
    ["heal10000", "戦場の救護者", "healed", 10000, "chronicleMedicCharm"],
    ["heal100000", "万人の癒やし手", "healed", 100000, null],
    ["rescue10", "命の守り手", "rescues", 10, "chronicleMedicCharm"],
    ["rescue50", "救命の達人", "rescues", 50, null],
    ["rescue100", "命脈を守りし者", "rescues", 100, null],
    ["low30", "土壇場の兵", "survived30", 1, null],
    ["low10", "死線を越えし者", "survived10", 1, null],
    ["single", "九死に一生", "survivedSingle", 1, "chronicleLifeCharm"],
    ["revived", "黄泉帰り", "revivals", 1, "chronicleRevivalCharm"],
    ["melee", "傷だらけの古強者", "meleePoints", 10, null],
    ["ranged", "矢雨を歩く者", "rangedPoints", 10, null],
    ["boss", "大将討ち", "bossKills", 1, null],
    ["support", "強敵を支えし者", "bossAssists", 1, null],
  ].map(([id, name, counter, need, reward]) => [id, { name, counter, need, reward }]),
);
Object.assign(GEAR, {
  chronicleBlade: {
    name: "百人斬りの刀",
    slot: "weapon",
    wtype: "katana",
    grade: 2,
    chronicle: true,
    fx: { atk: 0.12 },
    text: "戦歴報酬：攻撃+12%。刀を扱う職業用",
  },
  chronicleWarCharm: {
    name: "千軍の武功章",
    slot: "accessory",
    grade: 2,
    chronicle: true,
    fx: { atk: 0.06, def: 0.06 },
    text: "戦歴報酬：攻撃・防御+6%",
  },
  chronicleMedicCharm: {
    name: "救命の数珠",
    slot: "accessory",
    grade: 2,
    chronicle: true,
    fx: { healMul: 0.1 },
    text: "戦歴報酬：回復量+10%",
  },
  chronicleLifeCharm: {
    name: "生還の護符",
    slot: "accessory",
    grade: 2,
    chronicle: true,
    fx: { hp: 0.05 },
    text: "戦歴報酬：最大HP+5%",
  },
  chronicleRevivalCharm: {
    name: "黄泉の守り",
    slot: "accessory",
    grade: 2,
    chronicle: true,
    fx: { guard: 0.03 },
    text: "戦歴報酬：被ダメージ-3%",
  },
});
function chronicleEvaluate(s) {
  const c = chronicleOf(s);
  c.honors ||= [];
  c.claimed ||= [];
  c.pending ||= [];
  for (const [id, h] of Object.entries(CHRONICLE_HONORS)) {
    const earned = (c[h.counter] || 0) >= h.need;
    const retro = h.counter === "kills" && c.baselineKills + c.kills >= h.need;
    if ((earned || retro) && !c.honors.includes(id)) {
      c.honors.push(id);
      chronicleLog(s, "🏅 " + h.name);
    }
    if (earned && h.reward && !c.pending.includes(id) && !c.claimed.includes(id)) c.pending.push(id);
  }
  chronicleLearn(s);
  return c;
}
function chronicleHonorBlock(s) {
  const c = chronicleOf(s),
    earned = c.honors || [],
    pending = c.pending || [];
  return (
    '<details class="chronicle-honors"><summary>🏅 称号・記念報酬（' +
    earned.length +
    '）</summary><p><small>称号は表示のみ。既存の階級による能力補正とは別です。過去の討伐は称号だけ遡及します。</small></p><div class="card-actions"><button data-chronicle-title="' +
    s.id +
    ':">表示なし</button>' +
    earned
      .map(
        (id) =>
          '<button data-chronicle-title="' +
          s.id +
          ":" +
          id +
          '" aria-pressed="' +
          (c.selected === id) +
          '">' +
          esc(CHRONICLE_HONORS[id].name) +
          "</button>",
      )
      .join("") +
    "</div>" +
    pending
      .map(
        (id) =>
          "<p>" +
          esc(CHRONICLE_HONORS[id].name) +
          "：" +
          esc(GEAR[CHRONICLE_HONORS[id].reward].name) +
          ' <button data-chronicle-reward="' +
          s.id +
          ":" +
          id +
          '">受け取る</button></p>',
      )
      .join("") +
    (pending.length ? "" : "<p><small>受取待ちの報酬はありません。</small></p>") +
    "</details>"
  );
}
function chronicleSavedAction(s, action) {
  const error = legendBusyError();
  if (error) return error;
  const saved = savedSoldier(s?.id);
  if (!saved || !s.alive) return "兵士を途中保存してから操作してください。";
  const before = {
    live: JSON.parse(JSON.stringify(chronicleOf(s))),
    saved: JSON.parse(JSON.stringify(saved)),
    forge: JSON.parse(JSON.stringify(forgeSave())),
    batch: gameSaveBatch,
    active: gameSaveBatchActive,
  };
  const err = action(chronicleOf(s));
  if (err) return err;
  saved.chronicle = JSON.parse(JSON.stringify(s.chronicle));
  if (!commitLegend()) {
    s.chronicle = before.live;
    Object.assign(saved, before.saved);
    heroSave.forge = before.forge;
    gearMap = bookMap = null;
    gameSaveBatch = before.batch;
    gameSaveBatchActive = before.active;
    return "保存できなかったため変更しませんでした。報酬は受取待ちに残っています。";
  }
  return null;
}
function chronicleClaim(s, id) {
  const h = CHRONICLE_HONORS[id];
  if (!h?.reward) return "その報酬はありません。";
  return chronicleSavedAction(s, (c) => {
    if (!c.pending?.includes(id) || c.claimed?.includes(id)) return "受取待ちの報酬ではありません。";
    const durable = JSON.parse(currentGameSave(SOLDIER_SAVE_KEY) || "{}").soldiers?.find(
      (x) => x.id === s.id,
    )?.chronicle;
    if (!durable?.pending?.includes(id) || durable.claimed?.includes(id) || durable.life !== c.life)
      return "戦歴の保存が完了していません。先に途中保存してください。";
    const F = forgeSave();
    if (F.items.filter((it) => !GEAR[it.id].boss).length >= FORGE.maxItems)
      return "倉庫がいっぱいです。報酬は受取待ちに残っています。";
    if (F.seq >= 999999998) return "装備の発行上限です。報酬は受取待ちに残っています。";
    F.items.push({ uid: ++F.seq, id: h.reward, owner: null, lock: true });
    gearMap = null;
    c.pending = c.pending.filter((x) => x !== id);
    c.claimed.push(id);
    return null;
  });
}
function chronicleSelectTitle(s, id) {
  return chronicleSavedAction(s, (c) => {
    if (id && !c.honors?.includes(id)) return "未獲得の称号です。";
    c.selected = id || null;
    return null;
  });
}
let chronicleNoticeQueued = false;
const chronicleAnnounced = new Set();
function chronicleBoot() {
  chronicleSyncCommitted();
  for (const s of soldierSave.soldiers)
    for (const id of s.insight?.known || []) chronicleAnnounced.add(s.chronicle.life + ":" + id);
  for (const s of soldierSave.soldiers)
    for (const id of s.chronicle?.honors || []) chronicleAnnounced.add(s.chronicle.life + ":" + id);
}
function scheduleChronicleNotices() {
  if (chronicleNoticeQueued) return;
  chronicleNoticeQueued = true;
  queueMicrotask(() => {
    chronicleNoticeQueued = false;
    let d;
    try {
      d = JSON.parse(currentGameSave(SOLDIER_SAVE_KEY) || "{}");
    } catch {
      return;
    }
    chronicleSyncCommitted();
    const notes = [];
    for (const s of d.soldiers || [])
      for (const id of s.insight?.known || []) {
        if (!CHRONICLE_SKILLS[id]) continue;
        const key = s.chronicle.life + ":" + id;
        if (!chronicleAnnounced.has(key)) {
          chronicleAnnounced.add(key);
          notes.push("💡 " + (s.name || SOLDIER_TYPES[s.type].name) + "：" + CHRONICLE_SKILLS[id].name);
        }
      }
    for (const s of d.soldiers || [])
      for (const id of s.chronicle?.honors || []) {
        const key = s.chronicle.life + ":" + id;
        if (!chronicleAnnounced.has(key)) {
          chronicleAnnounced.add(key);
          notes.push("🏅 " + (s.name || SOLDIER_TYPES[s.type].name) + "：" + CHRONICLE_HONORS[id].name);
        }
      }
    zukanSync();
    if (notes.length)
      mapToast(notes.slice(0, 2).join("／") + (notes.length > 2 ? " ほか" + (notes.length - 2) + "件" : ""));
  });
}
document.addEventListener("click", (ev) => {
  const button = ev.target.closest("[data-chronicle-title],[data-chronicle-reward]");
  if (!button) return;
  const reward = button.dataset.chronicleReward,
    [sid, id] = (reward ?? button.dataset.chronicleTitle).split(":");
  const s = soldierById(+sid);
  if (!s) return;
  const err = reward ? chronicleClaim(s, id) : chronicleSelectTitle(s, id);
  if (err) mapToast(err);
  renderSoldierSheet();
  updateUI();
});

const CHRONICLE_COUNTER_LABELS = {
  kills: "導入後の討伐数",
  healed: "実回復量",
  rescues: "瀕死の味方の救命",
  survived30: "HP30%以下からの生還",
  survived10: "HP10%以下からの生還",
  survivedSingle: "HP一桁からの生還",
  revivals: "復活の書などでの復活",
  meleePoints: "近接被弾の生還点",
  rangedPoints: "遠距離被弾の生還点",
  bossKills: "強敵への最後の一撃",
  bossAssists: "強敵討伐への支援参加",
};
function chronicleDurableHonors() {
  try {
    return JSON.parse(currentGameSave(SOLDIER_SAVE_KEY) || "{}").honorFound || [];
  } catch {
    return [];
  }
}
const CHRONICLE_SKILLS = Object.fromEntries(
  [
    [
      "brace",
      "踏ん張り",
      "any",
      "survived30",
      3,
      "敵攻撃でHP30%以下になった後、4秒間被ダメージ-10%。再使用30秒",
    ],
    ["tenacity", "生存への執念", "any", "survived10", 3, "HP30%未満のとき受ける回復+15%"],
    ["killRush", "討ち取り上手", "attack", "kills", 100, "撃破後5秒間、攻撃+5%。重複せず、再使用10秒"],
    ["veteran", "歴戦の刃", "attack", "kills", 1000, "導入後の確定討伐100体ごと攻撃+1%、最大+10%"],
    [
      "healing",
      "救護の積み重ね",
      "heal",
      "healed",
      1000,
      "確定した実回復量で回復+3%（1千）/+6%（1万）/+10%（10万）",
    ],
    ["rescue", "緊急救命", "heal", "rescues", 10, "HP30%未満の味方への治療時、追加20%回復。再使用25秒"],
    ["bossHunter", "大物狩り", "attack", "bossKills", 10, "ボスへ与えるダメージ+5%"],
  ].map(([key, name, style, counter, need, text]) => [
    "in_history_" + key,
    {
      name,
      style,
      counter,
      need,
      text,
      grade: 0,
      job: style === "heal" ? "medic" : "ashigaru",
      cd: key === "rescue" ? 25 : key === "brace" ? 30 : 10,
      history: true,
    },
  ]),
);
Object.assign(INSIGHT_SKILLS, CHRONICLE_SKILLS);
Object.assign(INSIGHT_STYLE_NAMES, { any: "全職業", attack: "攻撃する職業" });
const chronicleCommitted = new Map();
const chronicleLearnedConfirmed = new Set();
function chronicleSyncCommitted() {
  let d;
  try {
    d = JSON.parse(currentGameSave(SOLDIER_SAVE_KEY) || "{}");
  } catch {
    return;
  }
  for (const id of d.insightFound || []) chronicleLearnedConfirmed.add(id);
  for (const s of d.soldiers || [])
    for (const id of s.insight?.known || []) chronicleLearnedConfirmed.add(id);
  for (const s of d.soldiers || [])
    if (s.chronicle?.life)
      chronicleCommitted.set(s.chronicle.life, {
        chronicle: cleanChronicle(s.chronicle, s),
        known: new Set(s.insight?.known || []),
      });
}
function chronicleHas(s, id) {
  return !!(
    chronicleCommitted.get(chronicleOf(s).life)?.known.has(id) &&
    insightOf(s).equipped.includes(id) &&
    insightCompatible(s, id)
  );
}
function chronicleLearn(s) {
  const c = chronicleOf(s),
    insight = insightOf(s);
  for (const [id, k] of Object.entries(CHRONICLE_SKILLS))
    if (c[k.counter] >= k.need && !insight.known.includes(id)) {
      insight.known.push(id);
      if (insight.equipped.length < INSIGHT_RULES.slots) insight.equipped.push(id);
      chronicleLog(s, "💡 " + k.name + "を閃いた");
    }
}
function chronicleStats(s, st) {
  const c = chronicleCommitted.get(chronicleOf(s).life)?.chronicle;
  if (!c) return st;
  if (chronicleHas(s, "in_history_veteran")) st.atk *= 1 + Math.min(0.1, Math.floor(c.kills / 100) * 0.01);
  if (chronicleHas(s, "in_history_killRush")) {
    const state = evolutionState(s);
    if (state.chronicleKillUntil > evolutionClock()) st.atk *= 1.05;
  }
  if (chronicleHas(s, "in_history_healing"))
    st.heal *= 1 + (c.healed >= 100000 ? 0.1 : c.healed >= 10000 ? 0.06 : 0.03);
  return st;
}
function chronicleResistance(points) {
  return points >= 150 ? 0.1 : points >= 50 ? 0.06 : points >= 10 ? 0.03 : 0;
}
function chronicleGuard(s, ranged, kind) {
  const c = chronicleCommitted.get(chronicleOf(s).life)?.chronicle;
  const special = [
    "poison",
    "thunder",
    "breath",
    "beam",
    "fire",
    "blast",
    "wide",
    "cannon",
    "magic",
  ].includes(kind);
  const resist = c && !special ? chronicleResistance(c[ranged ? "rangedPoints" : "meleePoints"]) : 0;
  const state = evolutionState(s),
    brace = chronicleHas(s, "in_history_brace") && state.chronicleBraceUntil > evolutionClock() ? 0.1 : 0;
  return (1 - resist) * (1 - brace);
}
function chronicleLow(s, before, max) {
  if (
    !s.alive ||
    s.hp <= 0 ||
    before <= max * 0.3 ||
    s.hp > max * 0.3 ||
    !chronicleHas(s, "in_history_brace")
  )
    return;
  const state = evolutionState(s),
    now = evolutionClock();
  if ((state.ready.chronicleBrace || 0) > now) return;
  state.ready.chronicleBrace = now + 30;
  state.chronicleBraceUntil = now + 4;
  chroniclePulse(s, "踏ん張り", "rampart");
}
function chronicleKillBuff(s) {
  if (!chronicleHas(s, "in_history_killRush")) return;
  const state = evolutionState(s),
    now = evolutionClock();
  if ((state.ready.chronicleRush || 0) > now) return;
  state.ready.chronicleRush = now + 10;
  state.chronicleKillUntil = now + 5;
  chroniclePulse(s, "討ち取り上手", "slash");
}
function chronicleAction(s, c, event) {
  if (event !== "heal" || !chronicleHas(s, "in_history_rescue") || !(c.target?.beforeRatio < 0.3))
    return false;
  const state = evolutionState(s);
  if (state.common > c.now || (state.ready.chronicleRescue || 0) > c.now) return false;
  const amount = c.heal(c.target, c.stats.heal * 0.2);
  if (!(amount > 0)) return false;
  state.ready.chronicleRescue = c.now + 25;
  state.common = c.now + 3;
  earnXp(s, "heal", amount, c.target.max);
  evolutionFx(c, "緊急救命", "bandage", [c.target], true);
  return true;
}

function chroniclePulse(s, name, fx) {
  const pos = battle ? battle.groups.find((g) => g.list.includes(s)) : squadById(s.squadId);
  if (pos) evolutionFx({ pos }, name, fx, [pos], true);
}
