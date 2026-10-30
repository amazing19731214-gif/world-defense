// tools/build.mjs が本体スクリプトへ埋め込む。保存・育成・戦闘で同じ定義を使う。
const INSIGHT_RULES = Object.freeze({
  slots: 2,
  books: 200,
  rates: [0.0025, 0.0008, 0.0002],
  levels: [10, 30, 100],
  prof: [3, 6, 8],
});
const INSIGHT_SKILLS = Object.fromEntries(
  [
    ["ashigaru", "群断ち", 0, "melee", 20, "HP30%以下の敵へ攻撃時、前方60の最大2体へ追加45%攻撃"],
    ["spearman", "返し穂", 0, "spear", 24, "足止め中の敵へ追加50%攻撃、その敵の次の一撃を20%軽減（3秒）"],
    ["archer", "弦鳴り止め", 0, "bow", 24, "攻撃予兆中の敵へ追加35%攻撃と0.2秒中断。ボスは中断しない"],
    ["gunner", "銃床の拒み", 0, "gun", 24, "距離45以内の敵へ追加40%攻撃、通常敵を15押し戻す"],
    ["cavalry", "追い越し突き", 0, "mounted", 22, "射程内で最も進んだ敵への近接攻撃に追加60%攻撃"],
    ["medic", "救命結び", 0, "heal", 24, "HP35%未満の味方へ追加30%治療と最大HP5%の盾（4秒）"],
    ["samurai", "受け流しの環", 1, "melee", 26, "被弾後の近接攻撃で、次の遠距離攻撃1回を25%軽減（4秒）"],
    ["ninja", "煙の目隠し", 1, "melee", 28, "遠距離被弾後、射撃した通常敵の射撃威力を4秒15%低下"],
    ["kensei", "刀気の一点", 1, "melee", 24, "同じ敵への通常攻撃3回後、追加90%攻撃（追加分は防御20%無視）"],
    [
      "sohei",
      "霊鎖の錫杖",
      1,
      "spear",
      28,
      "足止め中の敵へ追加40%攻撃、同部隊の傷ついた1人へ最大HP6%の盾（4秒）",
    ],
    ["kibateppo", "破鎧の鉛", 1, "gun", 28, "照準後の射撃に追加60%攻撃と防御15%低下（ボス5%・4秒）"],
    ["yarikiba", "突破の鉾", 1, "mounted", 26, "同じ敵を2秒以上足止め後、直線100の最大2体へ各追加60%攻撃"],
    ["yumikiba", "風切り誘射", 1, "bow", 26, "射程内の最大3体へ各追加30%攻撃と2秒15%減速"],
    [
      "akazonae",
      "血旗の護衛",
      1,
      "mounted",
      28,
      "撃破後の次の攻撃で、同部隊の傷ついた2人へ最大HP7%の盾（4秒）",
    ],
    ["sword_saint", "一刀・水鏡", 2, "melee", 36, "被弾後に追加120%攻撃、自分へ最大HP5%の盾（4秒）"],
    [
      "shinobi_head",
      "夜渡りの網",
      2,
      "melee",
      36,
      "敵が2体以上いると、半径50の最大3体へ各追加35%攻撃と3秒35%減速",
    ],
    [
      "spear_commander",
      "鎮城の長槍",
      2,
      "spear",
      36,
      "足止め中に被弾後、追加80%攻撃、自分と傷ついた1人へ最大HP8%の盾（4秒）",
    ],
    ["bow_saint", "星標の射", 2, "bow", 36, "対象を6秒標的化。自分の次の通常矢3回に各追加40%攻撃"],
    ["gun_commander", "城砕きの薬莢", 2, "gun", 40, "装甲のある敵へ追加90%攻撃、NPC塔・城へ追加140%攻撃"],
    ["iron_cavalry", "不退の蹄陣", 2, "mounted", 40, "被弾後、同部隊の傷ついた3人へ最大HP8%の盾（5秒）"],
    [
      "healing_master",
      "三脈救護",
      2,
      "heal",
      40,
      "HP35%未満の味方がいる治療時、傷ついた3人へ各追加35%治療と最大HP5%の盾（4秒）",
    ],
  ].map(([job, name, grade, style, cd, text]) => ["in_" + job, { job, name, grade, style, cd, text }]),
);
let evolutionSaving = false,
  insightFlushQueued = false,
  insightRollOverride = null,
  insightSaveWarned = false;
let evolutionEffectsEnabled = true;
const pendingInsights = new Map();
function insightHash(text) {
  let h = 2166136261;
  for (const c of String(text)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
function cleanInsight(v, soldier = {}) {
  const o = v && typeof v === "object" ? v : {};
  const known = [...new Set(Array.isArray(o.known) ? o.known : [])].filter((id) =>
    Object.hasOwn(INSIGHT_SKILLS, id),
  );
  return {
    version: 1,
    seed:
      Number.isInteger(o.seed) && o.seed >= 0 && o.seed <= 0xffffffff
        ? o.seed
        : insightHash("legacy:" + soldier.id + ":" + (soldier.jobs?.[0] || soldier.type)),
    evaluatedMaxLevel: intIn(
      o.evaluatedMaxLevel,
      1,
      SQUAD_RULES.maxLevel,
      Math.max(1, soldier.bestLevel || soldier.level || 1),
    ),
    known,
    equipped: [...new Set(Array.isArray(o.equipped) ? o.equipped : [])]
      .filter((id) => known.includes(id))
      .slice(0, INSIGHT_RULES.slots),
  };
}
function insightOf(s) {
  return s.insight || (s.insight = cleanInsight(null, s));
}
function cleanInsightBooks(list) {
  const ids = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((b) => {
      if (
        !b ||
        !Number.isInteger(b.uid) ||
        b.uid < 1 ||
        b.uid >= 1e9 ||
        ids.has(b.uid) ||
        !Object.hasOwn(INSIGHT_SKILLS, b.id)
      )
        return false;
      ids.add(b.uid);
      return true;
    })
    .slice(0, INSIGHT_RULES.books)
    .map((b) => ({ type: "insight", uid: b.uid, id: b.id, from: String(b.from || "").slice(0, 40) }));
}
function insightEligible(s, id) {
  const k = INSIGHT_SKILLS[id];
  return !!(
    k &&
    s.alive &&
    jobOf(s) === k.job &&
    s.level >= INSIGHT_RULES.levels[k.grade] &&
    profLv(s, k.job) >= INSIGHT_RULES.prof[k.grade]
  );
}
function queueInsight(s, fresh) {
  if (!fresh) return;
  const prev = pendingInsights.get(s.id),
    next = JSON.parse(JSON.stringify(prev?.next || insightOf(s)));
  if (s.level <= next.evaluatedMaxLevel) return;
  next.evaluatedMaxLevel = s.level;
  const id = "in_" + jobOf(s),
    k = INSIGHT_SKILLS[id],
    gained = prev?.gained.slice() || [];
  if (k && insightEligible(s, id) && !next.known.includes(id)) {
    const r = insightRollOverride
      ? insightRollOverride(s, id)
      : insightHash(next.seed + ":level:" + s.level + ":1") / 4294967296;
    if (r < INSIGHT_RULES.rates[k.grade]) {
      next.known.push(id);
      if (next.equipped.length < INSIGHT_RULES.slots) next.equipped.push(id);
      gained.push(id);
    }
  }
  pendingInsights.set(s.id, { s, next, gained });
  scheduleInsightFlush();
}
function scheduleInsightFlush() {
  if (insightFlushQueued || evolutionSaving || !pendingInsights.size) return;
  insightFlushQueued = true;
  queueMicrotask(() => {
    insightFlushQueued = false;
    flushInsights();
  });
}
function flushInsights() {
  if (evolutionSaving || gameSaveBatchActive || !pendingInsights.size) return false;
  if (gameSaveBatch && !commitGameSaveBatch()) return false;
  // 再編成・再読込復元で兵士の実体が変わっても、同じ一生の最新データへ合流する。
  const ready = [];
  for (const [id, x] of pendingInsights) {
    const live = soldierById(id);
    if (!live?.alive || insightOf(live).seed !== x.next.seed) {
      pendingInsights.delete(id);
      continue;
    }
    if (!savedSoldier(id)) continue;
    const current = cleanInsight(insightOf(live), live);
    x.s = live;
    x.gained = x.gained.filter((key) => !current.known.includes(key));
    x.next = {
      ...current,
      evaluatedMaxLevel: Math.max(current.evaluatedMaxLevel, x.next.evaluatedMaxLevel),
      known: [...new Set([...current.known, ...x.next.known])],
    };
    for (const key of x.gained)
      if (!x.next.equipped.includes(key) && x.next.equipped.length < INSIGHT_RULES.slots)
        x.next.equipped.push(key);
    ready.push(x);
  }
  if (!ready.length) return false;
  const before = ready.map((x) => [savedSoldier(x.s.id), savedSoldier(x.s.id).insight]);
  const found = insightFound(),
    oldFound = soldierSave.insightFound;
  for (const x of ready) {
    savedSoldier(x.s.id).insight = x.next;
    for (const id of x.next.known) found.add(id);
  }
  soldierSave.insightFound = [...found];
  const batch = gameSaveBatch,
    active = gameSaveBatchActive;
  evolutionSaving = true;
  let ok = false;
  try {
    beginGameSaveBatch();
    writeSoldierSave();
    ok = commitGameSaveBatch();
  } finally {
    evolutionSaving = false;
  }
  if (!ok) {
    if (!insightSaveWarned) {
      mapToast("💡 閃きの記録は保存待ちです。途中保存で再試行できます。");
      insightSaveWarned = true;
    }
    for (const [v, old] of before) v.insight = old;
    soldierSave.insightFound = oldFound;
    gameSaveBatch = batch;
    gameSaveBatchActive = active;
    return false;
  }
  insightSaveWarned = false;
  const notices = [];
  for (const x of ready) {
    x.s.insight = x.next;
    pendingInsights.delete(x.s.id);
    for (const id of x.gained) {
      logHistory(x.s, "💡「" + INSIGHT_SKILLS[id].name + "」を閃いた");
      notices.push(soldierName(x.s) + "：" + INSIGHT_SKILLS[id].name);
    }
  }
  if (notices.length) {
    for (const x of ready)
      if (x.gained.length) {
        const q = squadById(x.s.squadId);
        if (q) evolutionFx({ pos: q }, "💡", "bulb", [], true);
      }
    for (const line of notices) eventNotice("insight", line); // イベントウィンドウ（同じ種類はまとめる）
  }
  zukanSync();
  return true;
}
function insightFound() {
  const ids = new Set((soldierSave.insightFound || []).filter((id) => INSIGHT_SKILLS[id] && (!INSIGHT_SKILLS[id].history || chronicleLearnedConfirmed.has(id))));
  for (const v of soldierSave.soldiers)
    for (const id of v.insight?.known || []) if (INSIGHT_SKILLS[id] && (!INSIGHT_SKILLS[id].history || chronicleLearnedConfirmed.has(id))) ids.add(id);
  return ids;
}
function insightUseError(s, uid) {
  const b = (forgeSave().insightBooks || []).find((b) => b.uid === uid),
    k = b && INSIGHT_SKILLS[b.id];
  if (!k) return "その閃き秘伝書はありません。";
  if (!s?.alive || !savedSoldier(s.id)) return "保存済みの生存兵を選んでください。";
  if (s.level < INSIGHT_RULES.levels[k.grade])
    return "Lv" + INSIGHT_RULES.levels[k.grade] + "以上で習得できます。";
  if (insightOf(s).known.includes(b.id)) return "その閃き技は習得済みです。書は残しています。";
  return legendBusyError();
}
function saveInsightChoice(s, next, uid = null) {
  const saved = savedSoldier(s.id),
    F = forgeSave();
  if (!saved) return "保存済みの兵士を選んでください。";
  const old = {
    insight: s.insight,
    saved: saved.insight,
    found: soldierSave.insightFound,
    books: F.insightBooks,
    batch: gameSaveBatch,
    active: gameSaveBatchActive,
  };
  const found = insightFound();
  for (const id of next.known) found.add(id);
  saved.insight = next;
  soldierSave.insightFound = [...found];
  if (uid !== null) F.insightBooks = F.insightBooks.filter((b) => b.uid !== uid);
  evolutionSaving = true;
  let ok = false;
  try {
    ok = commitLegend();
  } finally {
    evolutionSaving = false;
  }
  if (!ok) {
    saved.insight = old.saved;
    soldierSave.insightFound = old.found;
    F.insightBooks = old.books;
    gameSaveBatch = old.batch;
    gameSaveBatchActive = old.active;
    return "保存できなかったため取り消しました。兵士と書は元のままです。";
  }
  s.insight = next;
  zukanSync();
  return null;
}
function useInsightBook(s, uid) {
  let err = insightUseError(s, uid);
  if (err) return err;
  if (pendingInsights.size && !flushInsights())
    return "閃きの記録が保存待ちです。先に途中保存をやり直してください。";
  err = insightUseError(s, uid);
  if (err) return err;
  const b = forgeSave().insightBooks.find((b) => b.uid === uid),
    next = cleanInsight(insightOf(s), s);
  next.known.push(b.id);
  if (next.equipped.length < INSIGHT_RULES.slots) next.equipped.push(b.id);
  return saveInsightChoice(s, next, uid);
}
function toggleInsight(s, id) {
  const err = legendBusyError();
  if (err) return err;
  if (pendingInsights.size && !flushInsights())
    return "閃きの記録が保存待ちです。先に途中保存をやり直してください。";
  if (!s?.alive || !insightOf(s).known.includes(id)) return "未習得の技です。";
  const next = cleanInsight(s.insight, s),
    i = next.equipped.indexOf(id);
  if (i >= 0) next.equipped.splice(i, 1);
  else if (next.equipped.length < INSIGHT_RULES.slots) next.equipped.push(id);
  else return "閃き技は2つまで有効にできます。";
  return saveInsightChoice(s, next);
}
const INSIGHT_STYLE_NAMES = {
  melee: "近接職",
  spear: "徒歩の槍系",
  bow: "弓射撃職",
  gun: "銃射撃職",
  mounted: "近接の騎乗職",
  heal: "治療職",
};
function insightCompatible(s, id) {
  const k = INSIGHT_SKILLS[id],
    u = unitOf(s);
  if (!k || s.level < INSIGHT_RULES.levels[k.grade]) return false;
  const heal = !!u.heal,
    range = u.range || 0,
    gun = u.shot === "musket",
    mounted = JOBS[jobOf(s)].base === "cavalry";
  return {
    any: true,
    attack: !heal,
    heal,
    gun: !heal && gun,
    bow: !heal && !gun && range > 60,
    melee: !heal && range <= 60,
    spear: !heal && !mounted && JOBS[jobOf(s)].base === "spearman",
    mounted: !heal && mounted && range <= 60,
  }[k.style];
}
function insightBlock(s) {
  const o = insightOf(s),
    busy = legendBusyError(),
    current = INSIGHT_SKILLS["in_" + jobOf(s)];
  return (
    '<details class="insight-box"><summary>💡 閃き技 ' +
    o.known.length +
    "個・有効 " +
    o.equipped.length +
    '/2</summary><p class="muted"><small>転職後も保持。適性が合う技だけ自動発動。既存の書4冊とは別枠です。</small></p>' +
    (current
      ? '<p class="muted"><small>現在職の閃き条件：Lv' +
        INSIGHT_RULES.levels[current.grade] +
        "・熟練" +
        INSIGHT_RULES.prof[current.grade] +
        "以上。新しい最高Lvへの到達ごとに" +
        (INSIGHT_RULES.rates[current.grade] * 100).toFixed(2) +
        "%。</small></p>"
      : "") +
    (o.known.length
      ? o.known
          .map((id) => {
            const k = INSIGHT_SKILLS[id],
              on = o.equipped.includes(id),
              fit = insightCompatible(s, id);
            return (
              '<p><button data-insight-toggle="' +
              id +
              '" data-soldier-id="' +
              s.id +
              '" aria-pressed="' +
              on +
              '"' +
              (busy ? " disabled" : "") +
              ">" +
              (on ? "✅ " : "") +
              esc(k.name) +
              "</button><br><small>" +
              esc(k.text) +
              (k.history && !k.cd ? "／条件中は常時<br>" : "／再使用"+k.cd+"秒<br>") +
              (fit
                ? "適性あり"
                : "現在使用不可：" +
                  INSIGHT_STYLE_NAMES[k.style] +
                  "・Lv" +
                  INSIGHT_RULES.levels[k.grade] +
                  "が必要") +
              "</small></p>"
            );
          })
          .join("")
      : '<p class="muted">まだ閃いていません。職業・熟練度に応じ、新しい最高レベルへの到達時に低確率で習得します。</p>') +
    "</details>"
  );
}
let insightBookPick = null;
function insightStoreHtml() {
  const list = forgeSave().insightBooks || [];
  return (
    "<h3>💡 閃き秘伝書 <small>" +
    list.length +
    '/200冊</small></h3><p class="muted"><small>1冊を消費して技を習得。既存の装備書4冊を使いません。</small></p>' +
    list
      .map(
        (b) =>
          '<div class="gear-line"><b>' +
          esc(INSIGHT_SKILLS[b.id].name) +
          "</b><small>（" +
          esc(b.from) +
          "より）<br>習得Lv" +
          INSIGHT_RULES.levels[INSIGHT_SKILLS[b.id].grade] +
          "・適性：" +
          INSIGHT_STYLE_NAMES[INSIGHT_SKILLS[b.id].style] +
          '</small> <button data-insight-book-pick="' +
          b.uid +
          '">習得する…</button>' +
          (insightBookPick === b.uid
            ? '<div class="card-actions">' +
              soldiers
                .filter((s) => s.alive && savedSoldier(s.id))
                .map(
                  (s) =>
                    '<button data-insight-book-use="' +
                    b.uid +
                    '" data-soldier-id="' +
                    s.id +
                    '"' +
                    (insightUseError(s, b.uid) ? " disabled" : "") +
                    ">" +
                    esc(soldierName(s)) +
                    " Lv" +
                    s.level +
                    "</button>",
                )
                .join("") +
              "</div>"
            : "") +
          "</div>",
      )
      .join("")
  );
}
document.addEventListener(
  "click",
  (ev) => {
    const b = ev.target.closest("[data-insight-toggle],[data-insight-book-pick],[data-insight-book-use]");
    if (!b) return;
    ev.stopPropagation();
    if (b.disabled) return;
    const d = b.dataset;
    let err = null;
    if (d.insightToggle) err = toggleInsight(soldierById(+d.soldierId), d.insightToggle);
    else if (d.insightBookPick)
      insightBookPick = insightBookPick === +d.insightBookPick ? null : +d.insightBookPick;
    else {
      err = useInsightBook(soldierById(+d.soldierId), +d.insightBookUse);
      if (!err) insightBookPick = null;
    }
    if (err) toast(err);
    renderGear();
    if (!$("soldierSheet").hidden) renderSoldierSheet();
  },
  true,
);

const EVOLUTION_JOBS = {
  sword_saint: {
    name: "剣聖",
    base: "ashigaru",
    icon: "🌙",
    mods: { atk: 1.25, def: 1, hp: 1.05 },
    req: [
      ["samurai", 8],
      ["kensei", 8],
    ],
    text: "近接の範囲攻撃。剣豪より単体火力を抑え、密集した敵を斬る",
  },
  shinobi_head: {
    name: "忍頭",
    base: "cavalry",
    icon: "🕸️",
    mods: { rate: 0.9, def: 0.85, hp: 0.9 },
    req: [["ninja", 10]],
    text: "騎兵の動きで妨害。ボスを拘束できず防御は低い",
  },
  spear_commander: {
    name: "槍将",
    base: "spearman",
    icon: "🛡️",
    mods: { def: 1.3, hp: 1.2, atk: 0.85 },
    req: [["spearman", 6]],
    either: [
      ["sohei", 8],
      ["yarikiba", 8],
    ],
    text: "徒歩の防御・長柄の迎撃。騎乗の移動速度は持たない",
  },
  bow_saint: {
    name: "弓聖",
    base: "archer",
    icon: "🌠",
    mods: { atk: 1.05, rate: 1.1 },
    req: [
      ["archer", 6],
      ["yumikiba", 8],
    ],
    text: "徒歩の高射・複数目標への曲射。騎兵は足止めできない",
  },
  gun_commander: {
    name: "銃将",
    base: "gunner",
    icon: "💣",
    mods: { atk: 1.1, rate: 1.2, def: 0.9 },
    req: [
      ["gunner", 6],
      ["kibateppo", 8],
    ],
    text: "徒歩の砲撃。装甲・密集・構造物を狙い、装填は遅い",
  },
  iron_cavalry: {
    name: "鉄騎将",
    base: "cavalry",
    icon: "🧲",
    mods: { atk: 0.95, def: 1.3, hp: 1.15 },
    req: [
      ["cavalry", 6],
      ["akazonae", 8],
    ],
    text: "騎乗で味方を守る耐久役。槍兵への弱点を持つ",
  },
  healing_master: {
    name: "医王",
    base: "medic",
    icon: "💚",
    mods: { hp: 1.1, def: 1.05, rate: 1.1 },
    req: [
      ["medic", 8],
      ["sohei", 6],
    ],
    text: "傷の深い生存兵への複数治療。攻撃・蘇生・城ハート回復はできない",
  },
};
for (const [id, j] of Object.entries(EVOLUTION_JOBS))
  JOBS[id] = { ...j, advanced: true, ultimate: true, skills: [] };
function evolutionRequirementText(j) {
  const J = EVOLUTION_JOBS[j];
  if (!J) return "";
  return (
    "Lv100・" +
    J.req.map(([id, n]) => JOBS[id].name + "熟練" + n).join("・") +
    (J.either ? "・(" + J.either.map(([id, n]) => JOBS[id].name + "熟練" + n).join(" または ") + ")" : "")
  );
}
function evolutionJobRequirement(s, j) {
  const J = EVOLUTION_JOBS[j];
  if (!J || jobsOf(s).includes(j)) return null;
  return s.level >= 100 &&
    J.req.every(([id, n]) => profLv(s, id) >= n) &&
    (!J.either || J.either.some(([id, n]) => profLv(s, id) >= n))
    ? null
    : "初回進化：" + evolutionRequirementText(j);
}
const JOB_ACTIONS = Object.fromEntries(
  [
    ["ashigaru", "踏み込み斬り", "陣際の薙ぎ払い", 10, 12, 0.25, 0.3, "slash"],
    ["spearman", "穂先払い", "二段穂先", 12, 12, 0.2, 0.3, "spear"],
    ["archer", "追い矢", "分かれ矢", 12, 12, 0.35, 0.3, "arrow"],
    ["gunner", "跳弾装填", "鉄粒散射", 16, 18, 0.35, 0.25, "shot"],
    ["cavalry", "すれ違い斬り", "蹄返し", 10, 12, 0.3, 0.3, "hoof"],
    ["medic", "包帯渡し", "救急包帯", 12, 16, 0.2, 0.25, "bandage"],
    ["samurai", "鞘打ち", "鍔際の崩し", 14, 14, 0.3, 0.45, "scabbard"],
    ["ninja", "足絡み", "撒菱囲い", 14, 18, 0.2, 0.2, "caltrop"],
    ["kensei", "切先返し", "返し太刀", 14, 14, 0.5, 0.7, "cross"],
    ["sohei", "錫杖の輪", "守輪の結び", 16, 16, 0, 0, "ring"],
    ["kibateppo", "鉛玉貫き", "徹甲装填", 18, 18, 0.4, 0.55, "lead"],
    ["yarikiba", "横槍払い", "騎槍の扇", 16, 18, 0.3, 0.35, "fan"],
    ["yumikiba", "牽制矢", "後列への牽制", 14, 16, 0.25, 0.25, "wind"],
    ["akazonae", "旗本の踏み止まり", "紅盾の行進", 18, 18, 0, 0, "flag"],
    ["sword_saint", "円月の構え", "円月断ち", 18, 20, 0.3, 0.45, "moon"],
    ["shinobi_head", "鉤縄縛り", "影縄の封じ", 18, 22, 0.25, 0.25, "net"],
    ["spear_commander", "地留めの槍", "長柄の防陣", 18, 22, 0.3, 0.3, "wall"],
    ["bow_saint", "高射の矢", "天弧三矢", 18, 22, 0.55, 0.4, "highbow"],
    ["gun_commander", "砲煙の一射", "榴弾装填", 22, 26, 0.6, 0.45, "shell"],
    ["iron_cavalry", "鐙の守り", "鉄蹄の庇護", 20, 24, 0, 0, "iron"],
    ["healing_master", "命脈の手当", "命脈の輪", 18, 24, 0.3, 0.2, "pulse"],
  ].map(([job, normal, upper, cd0, cd1, p0, p1, fx]) => [
    job,
    { job, names: [normal, upper], cd: [cd0, cd1], power: [p0, p1], fx },
  ]),
);
function jobActionStage(s) {
  const J = JOBS[jobOf(s)];
  if (!J.advanced && s.level < 10) return -1;
  const p = profLv(s);
  if (p >= 8 && s.level >= (J.ultimate ? 150 : J.advanced ? 60 : 30)) return 1;
  if (p >= (J.advanced ? 3 : 2) && (J.advanced || s.level >= 10)) return 0;
  return -1;
}
function evolutionClock() {
  return battle ? battle.t : combatClock;
}
function evolutionState(s) {
  const mode = battle ? "b:" + battle.id : "d:" + runId;
  if (!s.evolution || s.evolution.mode !== mode) {
    // 防衛の時計と攻城の時計は別。別戦闘の盾を長時間残さない。
    s.evolutionShield = s.evolutionGuard = null;
    s.evolution = { mode, ready: {}, common: 0 };
  }
  return s.evolution;
}
function evolutionShield(s, max, fraction, now, duration) {
  if (!s.alive || s.out || s.siegeOut) return;
  evolutionState(s);
  const old = s.evolutionShield && s.evolutionShield.until > now ? s.evolutionShield.amount : 0;
  s.evolutionShield = { amount: Math.min(max * 0.15, Math.max(old, max * fraction)), until: now + duration };
}
function evolutionAbsorb(s, damage, ranged, enemy, now) {
  const st = evolutionState(s);
  st.hurt = true;
  if (ranged) st.rangedEnemy = enemy;
  if (enemy?.evolutionWeaken?.until > now && (!enemy.evolutionWeaken.ranged || ranged))
    damage *= 1 - enemy.evolutionWeaken.value;
  if (enemy?.evolutionWeaken?.once) enemy.evolutionWeaken = null;
  const guard = s.evolutionGuard;
  if (guard?.until > now && (!guard.ranged || ranged) && (!guard.enemy || guard.enemy === enemy)) {
    const cap = guard.ranged ? 0.8 : 0.75,
      base = skillSum(s, guard.ranged ? "rangedGuard" : "guard"),
      extra = Math.max(0, Math.min(guard.value, (cap - base) / (1 - base)));
    damage *= 1 - extra;
    s.evolutionGuard = null;
  }
  const shield = s.evolutionShield;
  if (shield?.until > now) {
    const n = Math.min(damage, shield.amount);
    damage -= n;
    shield.amount -= n;
  }
  return damage;
}
function evolutionArmor(e, armor, now) {
  return Math.max(0, armor) * (e.evolutionArmor?.until > now ? 1 - e.evolutionArmor.value : 1);
}
function evolutionBoss(e) {
  return !!(e.boss || e.intruder || e.kind === "boss");
}
function evolutionSlow(e, value, seconds, now) {
  if (!e || evolutionBoss(e) || e.structure) return;
  const old = e.evolutionSlow?.until > now ? e.evolutionSlow.value : 0;
  e.evolutionSlow = { value: Math.min(0.35, Math.max(old, value)), until: now + seconds };
}
function evolutionFx(c, name, fx, targets, insight = false) {
  if (effects.filter((e) => e.kind === "evolution").length >= 24 || effects.length >= 80) return;
  effects.push({
    kind: "evolution",
    x: c.pos.x,
    y: c.pos.y - 15,
    points: targets.map((e) => ({ x: e.x, y: e.y - 10 })).slice(0, 3),
    variant: insight ? 2 : Object.values(JOB_ACTIONS).some((k) => k.names[1] === name) ? 1 : 0,
    fx,
    name,
    insight,
    age: 0,
    duration: fx === "bulb" ? 0.7 : 0.55,
  });
}
function evolutionAction(s, c, event = "attack") {
  if (!evolutionEffectsEnabled) return;
  if (!s.alive || s.out || s.siegeOut) return;
  const now = c.now,
    u = unitOf(s),
    state = evolutionState(s),
    a = c.target;
  if (event === "attack") {
    if (state.target === a) state.hits = (state.hits || 0) + 1;
    else {
      state.target = a;
      state.hits = 1;
      state.targetSince = now;
    }
    if (a?.hp <= 0) {
      state.killed = true;
      state.killedAt = now;
    }
    const mark = state.star;
    if (mark && mark.until > now && mark.target === a && mark.left > 0 && a.hp > 0) {
      c.hit(a, c.stats.atk * 0.4);
      mark.left--;
    }
  }
  if (state.common > now) return;
  if(chronicleAction(s,c,event))return;
  const alive = () => c.enemies.filter((e) => !e.gone && !e.dead && e.hp > 0);
  const inRange = () => alive().filter((e) => Math.hypot(e.x - c.pos.x, e.y - c.pos.y) <= c.stats.range);
  const sameTeam = () => c.friends.filter((m) => m.team === c.team && m.s.alive && !m.s.out && !m.s.siegeOut);
  const wounded = (same = false) =>
    (same ? sameTeam() : c.friends)
      .filter(
        (m) =>
          m.s.alive &&
          !m.s.out &&
          !m.s.siegeOut &&
          m.s.hp < m.max &&
          Math.hypot(m.x - c.pos.x, m.y - c.pos.y) <= c.stats.range,
      )
      .sort((a, b) => a.s.hp / a.max - b.s.hp / b.max || a.s.id - b.s.id);
  const self = () => c.friends.find((m) => m.s === s);
  const shields = (ms, p, sec) => {
    for (const m of ms) evolutionShield(m.s, m.max, p, now, sec);
    return ms;
  };
  const near = (t, r, n) =>
    t
      ? alive()
          .filter((e) => Math.hypot(e.x - t.x, e.y - t.y) <= r)
          .sort((x, y) =>
            x === t ? -1 : y === t ? 1 : Math.hypot(x.x - t.x, x.y - t.y) - Math.hypot(y.x - t.x, y.y - t.y),
          )
          .slice(0, n)
      : [];
  const front = (r, n, line = false) => {
    const dx = (a?.x || c.pos.x + 1) - c.pos.x,
      dy = (a?.y || c.pos.y) - c.pos.y,
      len = Math.hypot(dx, dy) || 1,
      ux = dx / len,
      uy = dy / len;
    return alive()
      .filter((e) => {
        const x = e.x - c.pos.x,
          y = e.y - c.pos.y,
          along = x * ux + y * uy,
          cross = Math.abs(x * uy - y * ux);
        return along >= 0 && along <= r && cross <= (line ? 18 : 45);
      })
      .slice(0, n);
  };
  const hit = (ts, p, pierce = 0) => {
    const live = ts.filter((t) => t?.hp > 0);
    for (const t of live) c.hit(t, c.stats.atk * p, pierce);
    return live;
  };
  const healed = (ms, p) => {
    for (const m of ms) {
      const amount = c.heal(m, c.stats.heal * p);
      if (amount > 0) earnXp(s, "heal", amount, m.max);
    }
    return ms;
  };
  const slow = (ts) => {
    for (const t of ts) evolutionSlow(t, 0.2, 2, now);
    return ts;
  };
  const cast = (key, cd, name, fx, fn, insight = false) => {
    if ((state.ready[key] || 0) > now) return false;
    const targets = fn();
    if (!targets || !targets.length) return false;
    state.ready[key] = now + cd;
    state.common = now + 3;
    evolutionFx(c, name, fx, targets, insight);
    return true;
  };
  for (const id of insightOf(s).equipped) {
    const k = INSIGHT_SKILLS[id];
    if (k.history || !insightCompatible(s, id) || event !== (k.style === "heal" ? "heal" : "attack")) continue;
    if (
      cast(
        id,
        k.cd,
        k.name,
        INSIGHT_FX[id],
        () => {
          switch (k.job) {
            case "ashigaru":
              return a && a.hp / a.max < 0.3 ? hit(front(60, 2), 0.45) : null;
            case "spearman":
              if (!c.blocked(a) || a.hp <= 0) return null;
              s.evolutionGuard = { enemy: a, value: 0.2, until: now + 3 };
              return hit([a], 0.5);
            case "archer":
              if (!a || (!evolutionBoss(a) && !((a.unitCd ?? a.cd ?? 1) < 0.5))) return null;
              if (!evolutionBoss(a)) {
                a.unitCd = Math.max(a.unitCd || 0, 0.2);
                a.cd = Math.max(a.cd || 0, 0.2);
              }
              return hit([a], 0.35);
            case "gunner":
              if (!a || Math.hypot(a.x - c.pos.x, a.y - c.pos.y) > 45) return null;
              if (!evolutionBoss(a) && !a.structure && a.path) {
                a.d = Math.max(0, a.d - 15);
                Object.assign(a, pathAt(a.path, a.d));
              }
              return hit([a], 0.4);
            case "cavalry":
              if (a !== inRange().sort((x, y) => (y.d || 0) - (x.d || 0))[0]) return null;
              return hit([a], 0.6);
            case "medic":
              if (!a || (a.beforeRatio ?? a.s.hp / a.max) >= 0.35) return null;
              healed([a], 0.3);
              return shields([a], 0.05, 4);
            case "samurai":
              if (!state.hurt) return null;
              state.hurt = false;
              s.evolutionGuard = { ranged: true, value: 0.25, until: now + 4 };
              return [c.pos];
            case "ninja": {
              const e = state.rangedEnemy;
              if (!e || evolutionBoss(e) || e.structure) return null;
              e.evolutionWeaken = { value: 0.15, ranged: true, until: now + 4 };
              state.rangedEnemy = null;
              return [e];
            }
            case "kensei":
              if (state.hits < 3 || !a || a.hp <= 0) return null;
              state.hits = 0;
              return hit([a], 0.9, 0.2);
            case "sohei":
              if (!c.blocked(a) || a.hp <= 0) return null;
              shields(wounded(true).slice(0, 1), 0.06, 4);
              return hit([a], 0.4);
            case "kibateppo":
              if (!a) return null;
              a.evolutionArmor = { value: evolutionBoss(a) ? 0.05 : 0.15, until: now + 4 };
              return hit([a], 0.6);
            case "yarikiba":
              return c.blocked(a) && now - state.targetSince >= 2 ? hit(front(100, 2, true), 0.6) : null;
            case "yumikiba": {
              const ts = inRange().slice(0, 3);
              return ts.length >= 2 ? slow(hit(ts, 0.3)) : null;
            }
            case "akazonae":
              if (!state.killed || state.killedAt === now) return null;
              state.killed = false;
              return shields(wounded(true).slice(0, 2), 0.07, 4);
            case "sword_saint":
              if (!state.hurt || !a || a.hp <= 0) return null;
              state.hurt = false;
              shields([self()].filter(Boolean), 0.05, 4);
              return hit([a], 1.2);
            case "shinobi_head":
              if (inRange().length < 2) return null;
              {
                const ts = hit(near(a, 50, 3), 0.35);
                for (const t of ts) evolutionSlow(t, 0.35, 3, now);
                return ts;
              }
            case "spear_commander":
              if (!state.hurt || !c.blocked(a) || a.hp <= 0) return null;
              state.hurt = false;
              shields(
                [
                  ...new Set([
                    self(),
                    ...wounded(true)
                      .filter((m) => m.s !== s)
                      .slice(0, 1),
                  ]),
                ].filter(Boolean),
                0.08,
                4,
              );
              return hit([a], 0.8);
            case "bow_saint":
              if (!a?.hp) return null;
              state.star = { target: a, left: 3, until: now + 6 };
              return [a];
            case "gun_commander":
              return a && (a.structure || a.armor > 0 || evolutionBoss(a))
                ? hit([a], a.structure ? 1.4 : 0.9)
                : null;
            case "iron_cavalry":
              if (!state.hurt) return null;
              state.hurt = false;
              return shields(wounded(true).slice(0, 3), 0.08, 5);
            case "healing_master":
              if (!wounded().some((m) => m.s.hp / m.max < 0.35) && !(a && a.beforeRatio < 0.35)) return null;
              {
                const ms = wounded().slice(0, 3);
                healed(ms, 0.35);
                return shields(ms, 0.05, 4);
              }
          }
        },
        true,
      )
    )
      return;
  }
  const j = jobOf(s),
    k = JOB_ACTIONS[j],
    stage = jobActionStage(s);
  if (!k || stage < 0 || event !== (u.heal ? "heal" : "attack")) return;
  const upper = stage === 1,
    p = k.power[stage];
  cast("job:" + j, k.cd[stage], k.names[stage], k.fx, () => {
    switch (j) {
      case "ashigaru":
        return hit(upper ? front(60, 2) : [a], p);
      case "spearman":
        if (!c.blocked(a) || a.hp <= 0) return null;
        {
          const ts = hit(upper ? front(80, 2, true) : [a], p);
          for (const t of ts) evolutionSlow(t, 0.2, 1, now);
          return ts;
        }
      case "archer":
        return hit(
          inRange()
            .filter((e) => e !== a)
            .slice(0, upper ? 2 : 1),
          p,
        );
      case "gunner":
        return hit(
          upper
            ? near(a, 35, 3)
            : alive()
                .filter(
                  (e) =>
                    e !== a &&
                    Math.hypot(e.x - a.x, e.y - a.y) <= 40 &&
                    (e.x - a.x) * (a.x - c.pos.x) + (e.y - a.y) * (a.y - c.pos.y) >= 0,
                )
                .slice(0, 1),
          p,
        );
      case "cavalry":
        return hit(upper ? near(a, 35, 2) : [a], p);
      case "medic":
        if (!a) return null;
        healed([a], p);
        if (upper) shields([a], 0.03, 4);
        return [a];
      case "samurai":
        if (!a?.hp) return null;
        a.evolutionWeaken = { value: upper ? 0.15 : 0.1, once: true, until: now + 3 };
        return hit([a], p);
      case "ninja": {
        const ts = hit(upper ? near(a, 40, 2) : [a], p);
        for (const t of ts) evolutionSlow(t, upper ? 0.25 : 0.2, 2, now);
        return ts;
      }
      case "kensei":
        if (state.hits < 3 || !a || a.hp <= 0) return null;
        state.hits = 0;
        return hit([a], p);
      case "sohei":
        return shields(
          upper
            ? [
                self(),
                ...wounded(true)
                  .filter((m) => m.s !== s)
                  .slice(0, 1),
              ].filter(Boolean)
            : [self()].filter(Boolean),
          upper ? 0.05 : 0.04,
          4,
        );
      case "kibateppo":
        return hit([a], p, upper ? 0.2 : 0);
      case "yarikiba":
        return hit(front(upper ? 80 : 70, upper ? 3 : 2), p);
      case "yumikiba":
        return slow(
          hit(
            inRange()
              .filter((e) => e !== a)
              .slice(0, upper ? 2 : 1),
            p,
          ),
        );
      case "akazonae":
        if (!state.hurt) return null;
        state.hurt = false;
        return shields(upper ? wounded(true).slice(0, 2) : [self()].filter(Boolean), 0.05, 4);
      case "sword_saint":
        return hit(
          alive()
            .filter((e) => Math.hypot(e.x - c.pos.x, e.y - c.pos.y) <= 55)
            .slice(0, 3),
          p,
        );
      case "shinobi_head": {
        const ts = hit(upper ? near(a, 45, 3) : [a], p);
        for (const t of ts) evolutionSlow(t, upper ? 0.3 : 0.25, 3, now);
        return ts;
      }
      case "spear_commander":
        if (!c.blocked(a) || a.hp <= 0) return null;
        if (upper) shields([self()].filter(Boolean), 0.05, 4);
        return hit(front(90, upper ? 3 : 2, true), p);
      case "bow_saint":
        return hit(
          inRange()
            .sort((x, y) => (y.d || 0) - (x.d || 0))
            .slice(0, upper ? 3 : 1),
          p,
        );
      case "gun_commander":
        return hit(upper ? near(a, 45, 3) : [a], p);
      case "iron_cavalry":
        if (!state.hurt) return null;
        state.hurt = false;
        return shields(upper ? wounded(true).slice(0, 3) : [self()].filter(Boolean), upper ? 0.05 : 0.06, 4);
      case "healing_master":
        return healed(upper ? wounded().slice(0, 3) : [a].filter(Boolean), p);
    }
  });
}

function defenseEvolution(s, q, target, event = "attack", beforeRatio = null, stats = null) {
  if (jobActionStage(s) < 0 && !insightOf(s).equipped.length) return;
  let friends;
  const c = {
    now: combatClock,
    pos: q,
    team: q.id,
    get friends() {
      return (
        friends ||
        (friends = fieldSquads().flatMap((o) =>
          members(o).map((m) => ({ s: m, team: o.id, x: o.x, y: o.y, max: soldierStats(m).maxHp })),
        ))
      );
    },
    enemies,
    stats: stats || soldierStats(s),
    target,
    blocked: (e) => e?.blockedBy === q,
    hit: (e, raw, pierce = 0) =>
      dealEnemyDamage(
        e,
        raw,
        { s, q, h: heroOnSquad(q) },
        { normal: false, ignoreArmor: Math.min(0.8, skillSum(s, "armorPierce") + pierce) },
      ),
    heal: (m, amount) => { const before=m.s.hp; const healed=healTarget(m.s, amount, q); chronicleHeal(s,m.s,before,m.max); return healed; },
  };
  if (event === "heal") {
    c.target = c.friends.find((m) => m.s === target);
    if (c.target) c.target.beforeRatio = beforeRatio;
  }
  evolutionAction(s, c, event);
}
function battleEvolution(s, g, target, tower, stats, event = "attack", beforeRatio = null) {
  const B = battle;
  if (!B || (jobActionStage(s) < 0 && !insightOf(s).equipped.length)) return;
  let friends;
  const structure =
    !target && event === "attack"
      ? {
          structure: true,
          tower,
          x: tower ? tower.x : SIEGE_BATTLE.castle.x,
          y: tower ? tower.y : SIEGE_BATTLE.castle.y,
          get hp() {
            return tower ? tower.hp : B.castleHp;
          },
          get max() {
            return tower ? towerMaxHp(tower) : B.castleMax;
          },
        }
      : null;
  const c = {
    now: B.t,
    pos: g,
    team: g,
    get friends() {
      return (
        friends ||
        (friends = B.groups
          .filter(groupActive)
          .flatMap((o) =>
            groupAlive(o).map((m) => ({ s: m, team: o, x: o.x, y: o.y, max: battleStats(o, m).maxHp })),
          ))
      );
    },
    enemies: structure ? [...B.garrison, structure] : B.garrison,
    stats,
    target: target || structure,
    blocked: (e) =>
      !!e &&
      !e.structure &&
      g.state === "fight" &&
      Math.hypot(e.x - g.x, e.y - g.y) <= Math.max(60, stats.range),
    hit: (e, raw, pierce = 0) => {
      if (e.structure) {
        if (e.tower) battleHitTower(e.tower, raw);
        else B.castleHp = Math.max(0, B.castleHp - raw);
        return;
      }
      if (battleHitGarrison(e, raw, s, pierce)) {
        s.kills++;
        gainXp(s, SQUAD_RULES.xpPerKill + Math.round(e.reward / 2));
      }
    },
    heal: (m, amount) => {
      if (B.soulEat) return 0;
      const before = m.s.hp;
      m.s.hp = Math.min(m.max, m.s.hp + amount * healTakenMul(m.s));
      chronicleHeal(s,m.s,before,m.max);
      return Math.max(0, m.s.hp - before);
    },
  };
  if (event === "heal") {
    c.target = c.friends.find((m) => m.s === target);
    if (c.target) c.target.beforeRatio = beforeRatio;
  }
  evolutionAction(s, c, event);
}
function drawEvolutionFx(e, p, reduced) {
  ctx.save();
  ctx.globalAlpha = 1 - p;
  ctx.lineWidth = 2 + (e.variant || 0);
  ctx.strokeStyle = e.insight ? "#fff4a8" : "#d6efff";
  ctx.fillStyle = ctx.strokeStyle;
  const pts = e.points.length ? e.points : [{ x: e.x, y: e.y }],
    r = 12 + 18 * (reduced ? 0.3 : p),
    style = e.fx;
  const line = (...pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  const circle = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  const shield = (x, y, r) =>
    line(
      [x - r * 0.6, y - r],
      [x + r * 0.6, y - r],
      [x + r * 0.5, y],
      [x, y + r * 0.5],
      [x - r * 0.5, y],
      [x - r * 0.6, y - r],
    );
  const flag = (x, y) => {
    line([x - 6, y + 10], [x - 6, y - 16], [x + 12, y - 8], [x - 6, y - 3]);
  };
  const hoof = (x, y, r) => {
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI * 0.85, Math.PI * 0.15, true);
    ctx.stroke();
  };
  if (style === "bulb") {
    ctx.font = "18px sans-serif";
    ctx.fillText("💡", e.x - 8, e.y - 12);
  } else
    for (const t of pts) {
      const x = t.x,
        y = t.y;
      switch (style) {
        case "arrow":
        case "highbow":
        case "wind":
        case "windarrows":
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.quadraticCurveTo(
            (e.x + x) / 2,
            (e.y + y) / 2 - (style === "highbow" ? 55 : style === "windarrows" ? 30 : 18),
            x,
            y,
          );
          ctx.stroke();
          line([x - 7, y - 2], [x, y], [x - 3, y - 7]);
          if (style.startsWith("wind")) line([x - 18, y + 7], [x - 5, y + 3], [x + 8, y + 5]);
          break;
        case "bandage":
        case "pulse":
        case "triplepulse":
          if (style === "bandage") {
            ctx.beginPath();
            ctx.moveTo(e.x, e.y);
            ctx.bezierCurveTo(e.x + 15, e.y - 20, x - 15, y + 20, x, y);
            ctx.stroke();
            ctx.strokeRect(x - 4, y - 4, 8, 8);
          } else {
            line([x - 20, y], [x - 8, y], [x - 3, y - 10], [x + 2, y + 9], [x + 7, y], [x + 20, y]);
            if (style === "triplepulse") for (let i = -1; i <= 1; i++) circle(x + i * 12, y - 18, 3);
          }
          break;
        case "ring":
          circle(x, y, r);
          circle(x, y, r * 0.55);
          break;
        case "flag":
        case "bloodflag":
          flag(x, y);
          if (style === "bloodflag") {
            line([e.x, e.y], [x, y]);
            shield(x + 8, y + 6, 8);
          }
          break;
        case "iron":
        case "hoofwall":
          hoof(x, y, r);
          if (style === "hoofwall") {
            hoof(x - 14, y - 4, r * 0.6);
            hoof(x + 14, y - 4, r * 0.6);
          }
          break;
        case "wall":
        case "rampart":
          line([x - r, y + 8], [x - r, y - 8], [x + r, y - 8], [x + r, y + 8]);
          for (let i = -1; i <= 1; i++) line([x + i * r * 0.7, y - 14], [x + i * r * 0.7, y + 7]);
          if (style === "rampart") shield(x, y, 8);
          break;
        case "net":
        case "nightnet":
          for (let k = 0; k < 3; k++) line([x - r, y - 8 + k * 8], [x + r, y + 8 - k * 8]);
          line([x, y - r], [x, y + r]);
          if (style === "nightnet") circle(x, y, r);
          break;
        case "caltrop":
          for (let i = -1; i <= 1; i++)
            line(
              [x + i * 12 - 4, y + 6],
              [x + i * 12, y - 3],
              [x + i * 12 + 4, y + 6],
              [x + i * 12 - 4, y + 6],
            );
          break;
        case "moon":
          circle(x, y, r);
          line([x - r, y + 8], [x + r, y - 8]);
          break;
        case "hoof":
          hoof(x, y, r);
          line([x - r - 6, y + 8], [x - r + 3, y + 4]);
          break;
        case "shot":
          line([e.x, e.y], [x - 7, y + 7], [x, y], [x + 10, y - 9]);
          for (let i = 0; i < 3; i++) circle(x + i * 5, y - i * 4, 1);
          break;
        case "lead":
          line([e.x, e.y], [x, y]);
          ctx.strokeRect(x - 4, y - 2, 8, 4);
          line([x + 6, y - 8], [x + 10, y - 3]);
          break;
        case "shell":
          circle(x, y, r);
          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            line(
              [x + Math.cos(a) * r, y + Math.sin(a) * r],
              [x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8)],
            );
          }
          break;
        case "scabbard":
          ctx.strokeRect(x - r, y - 3, r * 2, 6);
          line([x - 3, y - 10], [x + 3, y + 10]);
          break;
        case "cross":
          line([x - r, y + 12], [x + r, y - 12]);
          line([x - r, y - 12], [x + r, y + 12]);
          break;
        case "fan":
          for (let i = -1; i <= 1; i++) line([x - r, y], [x + r, y + i * 13]);
          break;
        case "spear":
          line([x - r, y + 4], [x + r, y - 4], [x + r - 7, y - 9]);
          line([x + r, y - 4], [x + r - 7, y + 2]);
          break;
        case "cleave":
          line([x - r, y + 8], [x, y], [x + r, y - 12]);
          line([x, y], [x + r, y + 9]);
          break;
        case "riposte":
          line([x - r, y], [x + r, y], [x + r - 6, y - 6]);
          line([x + r - 4, y + 7], [x - r + 4, y + 7], [x - r + 10, y + 2]);
          break;
        case "sound":
          for (const k of [1, 0.65, 0.3]) circle(x, y, r * k);
          break;
        case "butt":
          ctx.strokeRect(x - 8, y - 5, 16, 10);
          for (let i = -1; i <= 1; i++) line([x + 10, y], [x + 18, y + i * 8]);
          break;
        case "pursuit":
          line([e.x - 15, e.y + 8], [e.x - 3, e.y + 4], [x, y], [x - 8, y - 5]);
          hoof(e.x - 10, e.y + 12, 5);
          break;
        case "knot":
          circle(x - 4, y, 6);
          circle(x + 4, y, 6);
          line([x, y], [x - 8, y + 13]);
          line([x, y], [x + 8, y + 13]);
          break;
        case "parry":
          ctx.beginPath();
          ctx.arc(x, y, r, -2.7, 0.3);
          ctx.stroke();
          line([x + 18, y - 13], [x + 4, y - 2], [x + 17, y + 4]);
          break;
        case "smoke":
          for (let i = -1; i <= 1; i++) circle(x + i * 8, y - Math.abs(i) * 5, r * 0.5);
          break;
        case "point":
          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            line([x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a) * 3, y + Math.sin(a) * 3]);
          }
          circle(x, y, 3);
          break;
        case "chainward":
          line([e.x, e.y], [x, y]);
          for (let i = 0; i < 3; i++) circle(e.x + ((x - e.x) * i) / 3, e.y + ((y - e.y) * i) / 3, 4);
          shield(x, y, 10);
          break;
        case "armorbreak":
          for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            const bx = x + Math.cos(a) * r * 0.7,
              by = y + Math.sin(a) * r * 0.7;
            line([bx - 4, by - 4], [bx + 3, by - 2], [bx + 1, by + 4]);
          }
          break;
        case "breakthrough":
          for (const dy of [-4, 4]) line([e.x, e.y + dy], [x + 12, y + dy], [x + 4, y + dy - 6]);
          break;
        case "mirror":
          circle(x, y, r);
          line([x - r, y + 12], [x + r, y - 12]);
          line([x - 3, y - r], [x + 3, y + r]);
          break;
        case "starmark":
          for (let i = 0; i < 5; i++) {
            const a = (i * 2 * Math.PI) / 5 - 0.5 * Math.PI,
              b = a + (4 * Math.PI) / 5;
            line([x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(b) * r, y + Math.sin(b) * r]);
          }
          for (let i = -1; i <= 1; i++) circle(x + i * 7, y + r + 6, 2);
          break;
        case "cartridge":
          ctx.strokeRect(x - 7, y - 3, 14, 6);
          line([x + 7, y - 3], [x + 13, y], [x + 7, y + 3]);
          for (let i = -1; i <= 1; i++) line([x - 7, y + 7], [x - 15, y + 12 + i * 6]);
          break;
        default:
          line([x - r, y + 10], [x + r, y - 10]);
      }
      if (e.variant === 1) circle(x, y, 5 + 8 * p);
    }
  if (e.insight && style !== "bulb") {
    ctx.font = "11px sans-serif";
    ctx.fillText("💡", e.x - 5, e.y - 10);
  }
  ctx.restore();
}
const INSIGHT_FX = Object.fromEntries(
  [
    "cleave",
    "riposte",
    "sound",
    "butt",
    "pursuit",
    "knot",
    "parry",
    "smoke",
    "point",
    "chainward",
    "armorbreak",
    "breakthrough",
    "windarrows",
    "bloodflag",
    "mirror",
    "nightnet",
    "rampart",
    "starmark",
    "cartridge",
    "hoofwall",
    "triplepulse",
  ].map((fx, i) => [Object.keys(INSIGHT_SKILLS)[i], fx]),
);
function jobActionText(j, stage) {
  return JOB_ACTION_TEXT[j][stage]
    .replace(/([0-9.]+)A/g, (_, n) => "攻撃力の" + Math.round(+n * 100) + "%分")
    .replace(/([0-9.]+)H/g, (_, n) => "通常回復量の" + Math.round(+n * 100) + "%分")
    .replace(/Mの/g, "最大HPの");
}
function jobActionBlock(s) {
  const j = jobOf(s),
    k = JOB_ACTIONS[j],
    n = jobActionStage(s);
  return (
    '<p class="muted"><small>🔄 職業固有技：' +
    (n >= 0
      ? esc(k.names[n]) + "（自動・" + k.cd[n] + "秒）"
      : "未解放：" + (JOBS[j].advanced ? "熟練3" : "Lv10・熟練2")) +
    "<br>上位技：" +
    esc(k.names[1]) +
    "（熟練8・Lv" +
    (JOBS[j].ultimate ? 150 : JOBS[j].advanced ? 60 : 30) +
    "）</small></p>"
  );
}

const JOB_ACTION_TEXT = {
  ashigaru: ["10秒ごと、近接の主対象へ追加0.25A", "12秒ごと、前方60・最大2体へ各追加0.3A"],
  spearman: ["足止め中の敵へ12秒ごと追加0.2A、1秒20%減速", "同条件、直線80・最大2体へ追加0.3A、1秒20%減速"],
  archer: ["12秒ごと、主対象と別の敵がいれば追加0.35Aの矢1本", "同条件、通常射程内の別の敵2体まで各0.3A"],
  gunner: [
    "16秒ごと、主対象の後方40以内の別の敵1体へ追加0.35A",
    "18秒ごと、主対象中心半径35・最大3体へ各追加0.25A",
  ],
  cavalry: [
    "接敵後10秒以上あいている通常攻撃で追加0.3A",
    "12秒ごと、主対象とその近く35以内の敵1体へ各追加0.3A",
  ],
  medic: ["12秒ごと、通常治療の対象へ追加0.2H", "16秒ごと、治療対象へ追加0.25H＋Mの3%の盾を4秒"],
  samurai: [
    "14秒ごと、主対象へ追加0.3A、次の通常攻撃の威力を10%下げる（3秒以内の1回）",
    "同条件、追加0.45A・次の攻撃を15%軽減",
  ],
  ninja: [
    "14秒ごと、主対象へ追加0.2A＋2秒20%減速",
    "18秒ごと、主対象中心半径40・最大2体へ各0.2A＋2秒25%減速",
  ],
  kensei: [
    "同じ相手へ通常攻撃が3回当たった後、14秒に1回追加0.5A",
    "同条件、追加0.7A、対象を倒したら残り効果を持ち越さない",
  ],
  sohei: [
    "通常攻撃時16秒ごと、自分にMの4%の盾を4秒",
    "同条件、自分と同じ部隊の最もHP割合の低い生存兵1人へ各Mの5%の盾を4秒",
  ],
  kibateppo: [
    "照準を終えた射撃で18秒ごと、主対象へ追加0.4A",
    "同条件、追加0.55Aの部分のみ防御を追加20%無視（合計80%以内）",
  ],
  yarikiba: ["16秒ごと、前方70・最大2体へ各追加0.3A", "18秒ごと、前方80・最大3体へ各追加0.35A"],
  yumikiba: [
    "14秒ごと、別の射程内の敵へ追加0.25A＋2秒15%減速",
    "16秒ごと、別の敵2体まで各追加0.25A＋2秒20%減速",
  ],
  akazonae: [
    "被弾後の通常攻撃で18秒ごと、自分へMの5%の盾を4秒",
    "同条件、同じ部隊のHP割合が低い生存兵2人へ各Mの5%の盾を4秒",
  ],
  sword_saint: ["18秒ごと、自分の周囲55・最大3体へ各追加0.3A", "20秒ごと、同範囲・最大3体へ各追加0.45A"],
  shinobi_head: [
    "18秒ごと、主対象へ追加0.25A＋3秒25%減速",
    "22秒ごと、近く45以内の敵を含む最大3体へ各0.25A＋3秒30%減速",
  ],
  spear_commander: [
    "足止め中、18秒ごと、直線90・最大2体へ各追加0.3A",
    "22秒ごと、同範囲・最大3体へ各0.3A＋自分にMの5%の盾を4秒",
  ],
  bow_saint: ["18秒ごと、射程内で進行が最も先の敵へ追加0.55A", "22秒ごと、射程内の別々の敵3体まで各追加0.4A"],
  gun_commander: ["22秒ごと、主対象へ追加0.6A", "26秒ごと、主対象中心半径45・最大3体へ各追加0.45A"],
  iron_cavalry: [
    "被弾後の通常攻撃で20秒ごと、自分へMの6%の盾を4秒",
    "24秒ごと、同部隊のHP割合が低い生存兵3人へ各Mの5%の盾を4秒",
  ],
  healing_master: [
    "通常治療時18秒ごと、その対象へ追加0.3H",
    "24秒ごと、射程内でHP割合が低い生存兵3人まで各0.2Hを追加回復",
  ],
};

for (const [j, base] of Object.entries({
  sword_saint: "kensei",
  shinobi_head: "ninja",
  spear_commander: "sohei",
  bow_saint: "archer",
  gun_commander: "gunner",
  iron_cavalry: "akazonae",
  healing_master: "medic",
}))
  for (const w of Object.values(WEAPON_TYPES)) if (w.jobs.includes(base)) w.jobs.push(j);
function saveEvolutionCooldowns(s) {
  const x = s.evolution;
  return x ? { mode: x.mode, ready: { ...x.ready }, common: x.common } : null;
}
function cleanEvolutionCooldowns(v, now) {
  const mode = "d:" + runId;
  if (!v || v.mode !== mode) return { mode, ready: {}, common: 0 };
  const ready = {};
  for (const [key, n] of Object.entries(v.ready || {}))
    if (
      (INSIGHT_SKILLS[key] || (key.startsWith("job:") && JOB_ACTIONS[key.slice(4)])) &&
      Number.isFinite(n) &&
      n >= now &&
      n <= now + 45
    )
      ready[key] = n;
  return {
    mode,
    ready,
    common: Number.isFinite(v.common) && v.common >= now && v.common <= now + 3 ? v.common : 0,
  };
}
