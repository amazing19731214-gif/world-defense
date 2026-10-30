// 表示だけを並べ替える。兵士・部隊・攻城編成の配列を並べ替えない。
function formationEffectiveSort() {
  return movingSoldierId || bulkPick || bulkSwapMode || squadRosterFilter === "candidates"
    ? "squad"
    : settings.formation.sort;
}
function sortFormationSoldiers(list, stats, key) {
  const copy = list.slice();
  if (key === "squad") return copy;
  const value = (s) => (key === "level" ? s.level : stats.get(s.id)?.[key === "hp" ? "maxHp" : key] || 0);
  const slot = (s) => {
    const q = squadById(s.squadId);
    return q?.slot >= 0 ? q.slot : SQUAD_RULES.maxDeployed + (q?.id || 0);
  };
  return copy.sort(
    (a, b) =>
      (value(a) - value(b)) * (settings.formation.direction === "asc" ? 1 : -1) ||
      slot(a) - slot(b) ||
      a.id - b.id,
  );
}
function renderFormationViewControls() {
  const candidate = squadRosterFilter === "candidates",
    editing = !!(movingSoldierId || bulkPick || bulkSwapMode),
    collapsed = settings.formation.tabsCollapsed,
    name =
      squadRosterFilter === "all"
        ? "全隊"
        : candidate
          ? "候補"
          : SQUAD_RULES.slotNames[+squadRosterFilter].replace("部隊", ""),
    toggle = $("formationTabsToggle"),
    drawer = $("squadTabDrawer");
  toggle.textContent = "部隊：" + name + (collapsed ? " ▸" : " ▾");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.setAttribute(
    "aria-label",
    "部隊タブを" + (collapsed ? "開く" : "閉じる") + "（" + (candidate ? "指導員候補" : name) + "）",
  );
  drawer.classList.toggle("collapsed", collapsed);
  drawer.inert = collapsed;
  drawer.setAttribute("aria-hidden", String(collapsed));
  $("formationSort").value = candidate ? "level" : editing ? "squad" : settings.formation.sort;
  $("formationSort").disabled = candidate || editing;
  $("formationSort").title = candidate
    ? "指導員候補はLvの低い順です"
    : editing
      ? "移籍・交代中は部隊順で表示します"
      : "HPは最大HPを比較します";
  const asc = candidate || settings.formation.direction === "asc";
  $("formationSortDirection").textContent = asc ? "↑ 低い順" : "↓ 高い順";
  $("formationSortDirection").disabled = candidate || editing || settings.formation.sort === "squad";
  $("formationSortDirection").setAttribute(
    "aria-label",
    "並び順：現在" + (asc ? "低い順" : "高い順") + "。押すと" + (asc ? "高い順" : "低い順"),
  );
}
function revealSquadFilter() {
  if (settings.formation.tabsCollapsed || $("squadSheet").hidden || formationKind !== "soldiers") return;
  const rail = $("squadRosterTabs"),
    button = $("squadFilter-" + squadRosterFilter);
  if (!button) return;
  const a = rail.getBoundingClientRect(),
    b = button.getBoundingClientRect();
  if (b.left < a.left) rail.scrollLeft += b.left - a.left - 4;
  else if (b.right > a.right) rail.scrollLeft += b.right - a.right + 4;
}
$("formationTabsToggle").onclick = (ev) => {
  ev.stopPropagation();
  settings.formation.tabsCollapsed = !settings.formation.tabsCollapsed;
  renderFormationViewControls();
  saveSettings();
  if (!settings.formation.tabsCollapsed) revealSquadFilter();
};
$("formationSort").onchange = () => {
  const value = $("formationSort").value;
  if (!Object.hasOwn(FORMATION_SORTS, value) || $("formationSort").disabled) return;
  settings.formation.sort = value;
  saveSettings();
  renderSquadSheet();
  $("squadSheet").querySelector(".sheet").scrollTop = 0;
};
$("formationSortDirection").onclick = (ev) => {
  ev.stopPropagation();
  if ($("formationSortDirection").disabled) return;
  settings.formation.direction = settings.formation.direction === "asc" ? "desc" : "asc";
  saveSettings();
  renderSquadSheet();
  $("squadSheet").querySelector(".sheet").scrollTop = 0;
};
function formationSquadActions(q, list, moving, bulk) {
  let acts = "";
  if (bulk) {
    const all = list.length && list.every((s) => bulkPick.includes(s.id));
    if (list.length)
      acts +=
        '<button data-bulk-all="' +
        q.id +
        '"' +
        (!bulkSwapCanSelect(q.id) ? " disabled" : "") +
        ">" +
        (all ? "全員を外す" : "全員を選ぶ") +
        "</button>";
  } else if (moving) {
    if (q.id !== moving.squadId && list.length < SQUAD_RULES.squadSize)
      acts += '<button data-move-to="' + q.id + '">ここへ編入</button>';
  } else {
    if (q.state === "reserve" && !q.locked) acts += '<button data-place="' + q.id + '">配置する</button>';
    if (q.state === "deployed") acts += '<button data-retreat="' + q.id + '">撤退</button>';
    if (!playing && q.state === "reserve") acts += '<button data-disband="' + q.id + '">解散</button>';
    if (!playing && healCost(q))
      acts += '<button data-heal="' + q.id + '">🩹 治療 ' + healCost(q) + "G</button>";
  }
  return acts;
}
function formationSoldierRow(s, q, st, moving, bulk, showSquad, order = null) {
  const heal = !!unitOf(s).heal;
  const metric =
    '<small class="formation-stats"><span>HP ' +
    Math.ceil(s.hp) +
    "/" +
    st.maxHp +
    "</span><span>" +
    (heal ? "回復 " + fmt(st.heal) : "攻 " + fmt(st.atk)) +
    "</span><span>防 " +
    fmt(st.def) +
    "</span><span>射程 " +
    fmt(st.range) +
    "</span></small>";
  let acts;
  if (bulk)
    acts =
      '<button class="pick' +
      (bulkPick.includes(s.id) ? " on" : "") +
      '" data-bulk-pick="' +
      s.id +
      '"' +
      (!bulkSwapCanSelect(q.id) ? " disabled" : "") +
      ' aria-pressed="' +
      bulkPick.includes(s.id) +
      '">' +
      (bulkPick.includes(s.id) ? "☑ 選択中" : "☐ 選ぶ") +
      "</button>";
  else if (!moving)
    acts =
      '<div class="formation-soldier-actions"><button data-formation-soldier="' +
      s.id +
      '" aria-label="' +
      esc(soldierName(s)) +
      'の詳細・育成">詳細・育成</button>' +
      (!playing ? '<button data-move="' + s.id + '">移籍</button>' : "") +
      "</div>";
  else if (moving.id === s.id) acts = '<span class="moving-tag">移籍中</span>';
  else acts = s.squadId !== moving.squadId ? '<button data-swap="' + s.id + '">⇄ 入れ替え</button>' : "";
  return (
    '<div class="soldier-row' +
    (moving?.id === s.id ? " moving" : "") +
    '" data-formation-row="' +
    s.id +
    '"' +
    (order && order.drag ? ' data-drag-soldier="' + s.id + '" data-drag-squad="' + q.id + '"' : "") +
    "><span>" +
    // 部隊内の並べ替え（v105.4）：つまみをドラッグ。先頭は敵の攻撃を最初に受ける
    (order && order.drag ? '<span class="drag-handle" aria-hidden="true">☰</span>' : "") +
    (order && order.front ? '<em class="front-tag" title="先頭：敵の攻撃を最初に受けます">🛡先頭</em>' : "") +
    "<b>" +
    esc(soldierName(s)) +
    "</b>" +
    (s.out ? "（離脱中）" : "") +
    " Lv" +
    s.level +
    " " +
    titleText(s) +
    metric +
    chronicleSummary(s) +
    '<small class="formation-record">' +
    (showSquad ? esc(squadName(q)) + "・" : "") +
    "撃破" +
    s.kills +
    "・生存" +
    s.wavesSurvived +
    "W</small></span>" +
    acts +
    "</div>"
  );
}
function formationGroupHtml(q, list, stats, moving, bulk) {
  const title = q
    ? SOLDIER_TYPES[q.type].icon +
      " " +
      esc(squadName(q)) +
      " <small>" +
      squadStateText(q) +
      "・生存" +
      list.length +
      "・戦死" +
      q.fallen +
      "</small>"
    : esc(FORMATION_SORTS[settings.formation.sort]) +
      (settings.formation.direction === "asc" ? "の低い順" : "の高い順") +
      " <small>全隊 " +
      list.length +
      "人</small>";
  const acts = q ? formationSquadActions(q, list, moving, bulk) : "";
  return (
    '<div class="squad-card"><h3>' +
    title +
    "</h3>" +
    list
      .map((s, i) => formationSoldierRow(s, squadById(s.squadId), stats.get(s.id), moving, bulk, !q, q && formationEffectiveSort() === "squad" ? { front: i === 0, drag: soldierReorderOk() && !moving && !bulk && list.length > 1 } : null))
      .join("") +
    (acts ? '<div class="card-actions">' + acts + "</div>" : "") +
    "</div>"
  );
}
