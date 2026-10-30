// 職業の書は兵士ごとの初回転職で消費する。装備書4冊・閃きの2枠とは別在庫。
const JOB_BOOK_RULES = Object.freeze({ stock: 9999, claims: 2048, ultimateLevel: 100 });
const ADVANCED_JOB_REQ = Object.freeze({
  samurai: [["ashigaru", 5]],
  ninja: [
    ["ashigaru", 3],
    ["cavalry", 3],
  ],
  kensei: [["samurai", 5]],
  sohei: [
    ["spearman", 3],
    ["medic", 3],
  ],
  kibateppo: [
    ["cavalry", 3],
    ["gunner", 3],
  ],
  yarikiba: [
    ["cavalry", 3],
    ["spearman", 3],
  ],
  yumikiba: [
    ["cavalry", 3],
    ["archer", 3],
  ],
  akazonae: [["cavalry", 6]],
});
const JOB_BOOK_IDS = Object.keys(JOBS).filter((j) => JOBS[j].advanced);
function cleanJobBooks(v) {
  return Object.fromEntries(
    JOB_BOOK_IDS.map((j) => [j, intIn(v?.[j], 0, JOB_BOOK_RULES.stock, 0)]).filter(([, n]) => n),
  );
}
function cleanJobBookClaims(v) {
  return [
    ...new Set((Array.isArray(v) ? v : []).filter((k) => typeof k === "string" && k.length <= 200)),
  ].slice(-JOB_BOOK_RULES.claims);
}
function cleanJobDefenseClaims(v) {
  if (!v || typeof v.runId !== "string" || v.runId.length > 100) return null;
  return { runId: v.runId, boss: intIn(v.boss, 0, 1000, 0), intruder: intIn(v.intruder, 0, 1000, 0) };
}
function hasJobDropClaim(key, defense) {
  const F = forgeSave(),
    mark = F.jobDefenseClaims;
  return (
    F.jobBookClaims.includes(key) ||
    !!(defense && mark?.runId === defense.runId && mark[defense.kind] >= defense.wave)
  );
}
function jobBookCount() {
  return Object.values(forgeSave().jobBooks).reduce((a, n) => a + n, 0);
}
function jobEntryText(j) {
  if (!JOBS[j].advanced) return "Lv" + JOB_RULES.unlockLevel + "（基本職・書不要）";
  const req = JOBS[j].ultimate
    ? evolutionRequirementText(j)
    : "Lv" +
      JOB_RULES.unlockLevel +
      "・" +
      ADVANCED_JOB_REQ[j].map(([id, n]) => JOBS[id].name + "熟練" + n).join("・");
  return req + "・「" + JOBS[j].name + "の書」1冊消費";
}
function jobEntryError(s, j) {
  if (jobsOf(s).includes(j) || !JOBS[j].advanced) return null;
  if (s.level < JOB_RULES.unlockLevel) return "初回転職：" + jobEntryText(j);
  const err = evolutionJobRequirement(s, j);
  if (err) return err + "・対応する職業の書1冊";
  if (ADVANCED_JOB_REQ[j]?.some(([id, n]) => profLv(s, id) < n)) return "初回転職：" + jobEntryText(j);
  if (!(forgeSave().jobBooks[j] > 0))
    return "「" + JOBS[j].name + "の書」がありません。ボスを倒して入手してください。";
  if (!savedSoldier(s.id)) return "先に準備中の「途中保存」をしてから職業の書を使ってください。";
  return null;
}
function jobEntryHtml(s, j) {
  if (!JOBS[j].advanced) return "";
  const been = jobsOf(s).includes(j),
    n = forgeSave().jobBooks[j] || 0;
  return (
    "<br><b>初回転職：</b>" +
    esc(jobEntryText(j)) +
    "<br>📕 " +
    esc(JOBS[j].name) +
    "の書：<b>" +
    n +
    "冊</b>" +
    (been
      ? "（就職済み・再転職では消費しない）"
      : "<br>" + esc(jobEntryError(s, j) || "条件達成・転職すると1冊消費します。")) +
    "<br><small>入手：通常防衛・修練場・全国の守備大将・秘境ボス。最上級の書は通常WAVE100以降／敵Lv100以上。</small>"
  );
}
function commitJobChange(s, j) {
  if (
    gameSaveBatchActive ||
    (gameSaveBatch && !commitGameSaveBatch()) ||
    (pendingInsights.size && !flushInsights())
  )
    return "未保存の進行があります。先に途中保存を再試行してください。";
  try {
    flushBookTransaction();
  } catch {
    return "保存待ちの記録があります。転職前に途中保存を再試行してください。";
  }
  const error = jobChangeError(s, j);
  if (error) return error;
  const saved = savedSoldier(s.id),
    F = forgeSave(),
    before = {
      job: s.job,
      type: s.type,
      jobs: [...jobsOf(s)],
      jobHist: [...(s.jobHist || [])],
      history: [...(s.history || [])],
      hp: s.hp,
      iaiTarget: s.iaiTarget,
    },
    oldSaved = saved ? JSON.parse(JSON.stringify(saved)) : null,
    oldForge = JSON.parse(JSON.stringify(F)),
    batch = gameSaveBatch,
    active = gameSaveBatchActive,
    q = squadById(s.squadId),
    consumes = JOBS[j].advanced && !jobsOf(s).includes(j);
  s.job = j;
  s.type = JOBS[j].base;
  if (!s.jobs.includes(j)) s.jobs.push(j);
  s.jobHist = s.jobHist.concat({ from: before.job, to: j, lv: s.level }).slice(-JOB_RULES.histMax);
  logHistory(s, JOBS[before.job].name + " から " + JOBS[j].name + " に転職");
  if (q) refreshSquadType(q);
  s.hp = Math.min(s.hp, soldierStats(s).maxHp);
  s.iaiTarget = null;
  if (consumes && --F.jobBooks[j] <= 0) delete F.jobBooks[j];
  if (saved) Object.assign(saved, pickSaved(s));
  let ok = false;
  evolutionSaving = true;
  try {
    ok = commitLegend();
  } finally {
    evolutionSaving = false;
  }
  if (!ok) {
    Object.assign(s, before);
    if (saved) Object.assign(saved, oldSaved);
    Object.assign(F, oldForge);
    gearMap = bookMap = null;
    gameSaveBatch = batch;
    gameSaveBatchActive = active;
    if (q) refreshSquadType(q);
    return "保存できなかったので転職しませんでした。職業と書は元のままです。";
  }
  zukanSync();
  return null;
}
function newJobDropRunId() {
  return crypto.randomUUID();
}
function jobDropPool(level) {
  return JOB_BOOK_IDS.filter((j) => level >= JOB_BOOK_RULES.ultimateLevel || !JOBS[j].ultimate);
}
function rollJobBook(key, level, boss = null) {
  const focus =
    {
      hiei: ["samurai", "kensei", "sword_saint"],
      yomi: ["ninja", "sohei", "shinobi_head", "healing_master"],
      fuji: ["kibateppo", "yarikiba", "yumikiba", "akazonae", "iron_cavalry", "gun_commander", "bow_saint"],
    }[boss] || [];
  const pool = jobDropPool(level),
    weighted = pool.concat(
      focus.filter((j) => pool.includes(j)),
      focus.filter((j) => pool.includes(j)),
    );
  return weighted[insightHash("job-book-v1:" + key) % weighted.length];
}
let jobDropFlushQueued = false;
const pendingJobDrops = new Map();
function scheduleJobDropFlush() {
  if (jobDropFlushQueued || !pendingJobDrops.size) return;
  jobDropFlushQueued = true;
  queueMicrotask(() => {
    jobDropFlushQueued = false;
    flushJobDrops();
  });
}
function queueJobDrop(key, level, source, boss = null, owner = null, defense = null) {
  if (hasJobDropClaim(key, defense)) return null;
  if (!pendingJobDrops.has(key))
    pendingJobDrops.set(key, { key, id: rollJobBook(key, level, boss), source, owner, defense });
  flushJobDrops();
  return pendingJobDrops.get(key)?.id || null;
}
function flushJobDrops() {
  if (!pendingJobDrops.size) return true;
  if (gameSaveBatchActive || gameSaveBatch) return false;
  try {
    flushBookTransaction();
  } catch {
    return false;
  }
  const F = forgeSave();
  for (const [key, drop] of pendingJobDrops) {
    if (hasJobDropClaim(key, drop.defense)) {
      pendingJobDrops.delete(key);
      continue;
    }
    if ((F.jobBooks[drop.id] || 0) >= JOB_BOOK_RULES.stock) return false;
    const oldBooks = F.jobBooks,
      oldClaims = F.jobBookClaims,
      oldDefense = F.jobDefenseClaims;
    F.jobBooks = { ...oldBooks, [drop.id]: (oldBooks[drop.id] || 0) + 1 };
    F.jobBookClaims = oldClaims.concat(key).slice(-JOB_BOOK_RULES.claims);
    if (drop.defense) {
      const d = drop.defense;
      F.jobDefenseClaims = {
        ...(oldDefense?.runId === d.runId ? oldDefense : { runId: d.runId, boss: 0, intruder: 0 }),
        [d.kind]: d.wave,
      };
    }
    if (!persistHeroes()) {
      F.jobBooks = oldBooks;
      F.jobBookClaims = oldClaims;
      F.jobDefenseClaims = oldDefense;
      mapToast("📕 職業の書は保存待ちです。途中保存で再試行してください。");
      return false;
    }
    pendingJobDrops.delete(key);
    if (drop.owner) (drop.owner.jobBookDrops ||= []).push(drop.id);
    eventNotice("book", JOBS[drop.id].name + "の書（" + drop.source + "）");
  }
  return true;
}
function defenseJobBookDrop(e) {
  if (e.kind !== "boss" || e.jobBookDropped) return;
  e.jobBookDropped = true;
  const T = training,
    key = T ? "training:" + (T.jobDropRunId ||= newJobDropRunId()) : "defense:" + runId;
  queueJobDrop(
    key + ":" + wave + ":" + (e.intruder ? "intruder" : "boss"),
    T ? trainLevel(T, wave) : wave,
    T ? "修練場" : e.intruder ? "乱入ボス" : "通常防衛",
    null,
    T,
    T ? null : { runId, wave, kind: e.intruder ? "intruder" : "boss" },
  );
}
function battleJobBookDrop(e, B = battle) {
  if (!B || e.kind !== "boss" || e.jobBookDropped) return;
  e.jobBookDropped = true;
  const key =
    "battle:" + (B.jobDropRunId ||= newJobDropRunId()) + ":" + (B.boss ? "boss" : (e.jobDropOrdinal ?? 0));
  queueJobDrop(
    key,
    B.boss ? BOSSES[B.boss].lv : B.enemyLevel,
    B.boss ? BOSSES[B.boss].name : B.castleName,
    B.boss,
    B,
  );
}
function jobBookStoreHtml() {
  return (
    "<h3>📕 職業の書 <small>" +
    jobBookCount() +
    "冊</small></h3>" +
    (pendingJobDrops.size
      ? '<p class="injured">職業の書 ' +
        pendingJobDrops.size +
        "冊が保存待ちです。途中保存を再試行してください。</p>"
      : "") +
    '<p class="muted"><small>上級職・最上級職の初回転職で1冊消費。兵士の「転職」で使います。一度就いた職業には書なしで戻れます。既存の装備書4冊とは別在庫です。<br>入手：通常防衛・修練場・全国の守備大将・秘境ボスの撃破で1冊。最上級の書は通常WAVE100以降／敵Lv100以上。各書は最大9,999冊。</small></p><div class="gear-list">' +
    JOB_BOOK_IDS.map(
      (j) =>
        '<div class="gear-line"><p><b>' +
        JOBS[j].icon +
        " " +
        esc(JOBS[j].name) +
        "の書</b> ×" +
        (forgeSave().jobBooks[j] || 0) +
        "<br><small>" +
        esc(jobEntryText(j)) +
        "</small></p></div>",
    ).join("") +
    "</div>"
  );
}
function jobBookResultHtml(B) {
  const ids = B.jobBookDrops || [];
  return ids.length
    ? '<p class="capture">📕 ボス報酬：' + ids.map((j) => esc(JOBS[j].name) + "の書").join("・") + "</p>"
    : "";
}
