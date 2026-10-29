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
  if (!s?.alive || e._chronicleCredited) return;
  e._chronicleCredited = true;
  const c = chronicleOf(s);
  chronicleTouch(s);
  chronicleAdd(c, "kills");
  if (e.kind === "boss" || e.boss) {
    chronicleAdd(c, "bossKills");
    chronicleLog(s, "強敵に最後の一撃");
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
    '<details class="legend-box chronicle"><summary>📖 戦歴帳</summary><p><small>導入後の記録・保存は戦闘進行と共通</small></p><p>討伐 ' +
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
