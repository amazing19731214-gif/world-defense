// 初回の操作だけを案内する。ゲーム進行・料金・保存の確定点は既存処理を使う。
function firstPlayPending(s = onboardStats()) {
  return s.maxWave < 1 && !s.attempted;
}
function firstPlayGoal(s) {
  if (uiSave.firstGuideHidden || !firstPlayPending(s) || battle || training || trial) return null;
  if (over || hp <= 0)
    return {
      intro: true,
      text: "城のハートが0になりました。「最初から」で防衛をやり直せます",
      detail: "育成の記録は残ります。塔を道の近くに置いて、もう一度挑戦しましょう。",
      act: "restart",
      label: "↻ 最初から",
      targets: ["#reset"],
    };
  if (playing)
    return {
      intro: true,
      text: "敵を迎え撃っています。攻撃は自動です",
      detail: "敵が城へ抜けるとハートが減ります。WAVEを守り切ると報酬を獲得し、自動保存されます。",
      targets: [],
    };
  const original = nextGoal(s);
  if (!towers.length)
    return {
      ...original,
      intro: true,
      act: "build",
      label: "🏯 建設を開く",
      detail: "1/4：最初は弓の塔がおすすめ。塔を選び、金色の丸がある草地をタップ。",
      targets: ["#dockBuild", '#towerTools [data-t="arrow"]'],
    };
  if (!soldiers.some((s) => s.alive))
    return {
      ...original,
      intro: true,
      text: "「＋ 雇う」で兵士を雇おう（塔と一緒に道を守ります）",
      act: "hire",
      label: "⚔️ 部隊を開く",
      detail: "2/4：最初の1人は無料。「＋ 雇う」を押しましょう。兵種はランダムです。",
      targets: ["#dockUnits", "#hireToggle"],
    };
  if (!fieldSquads().length) {
    const q = squads.find((q) => q.state === "reserve" && !q.locked && members(q).length);
    return {
      ...original,
      intro: true,
      text: "部隊のボタンを押し、道をタップして配置しよう",
      act: q ? "deploy" : "hire",
      label: q ? "📍 部隊を選ぶ" : "⚔️ 部隊を開く",
      detail: "3/4：部隊を選ぶと、道に金色の丸が出ます。そこをタップして配置。",
      targets: q ? ["#dockUnits", '[data-chip="' + q.id + '"]'] : ["#dockUnits"],
    };
  }
  return {
    ...original,
    intro: true,
    text: "「▶ ウェーブ開始」で敵を迎え撃とう",
    act: "start",
    label: "▶ 戦闘を始める",
    detail: "4/4：準備完了！まずは1WAVE守ってみましょう。準備中は配置を自分で変えられます。",
    targets: ["#start"],
  };
}
function renderFirstPlayTargets(goal) {
  const targets = new Set(goal?.targets || []);
  // 毎フレームのDOMの作り直しを避けつつ、選択・引き出しの変化にも追随する。
  document.querySelectorAll(".guide-target").forEach((el) => {
    if (![...targets].some((selector) => el.matches(selector))) el.classList.remove("guide-target");
  });
  for (const selector of targets) document.querySelector(selector)?.classList.add("guide-target");
  const pending = firstPlayPending();
  $("firstGuideOpen").hidden = !pending;
  $("firstGuideDone").hidden = pending;
}
function firstPlayAction(act) {
  // 操作は同じ既存ボタンへ渡し、建設・雇用・保存の別経路を作らない。
  if (firstPlayGoal(onboardStats())?.act !== act) return;
  if (act === "build" || act === "hire") {
    const id = act === "build" ? "towerTools" : "unitTools";
    if (compactUi()) setDrawer(act === "build" ? "dockBuild" : "dockUnits");
    const target = act === "build" ? document.querySelector('#towerTools [data-t="arrow"]') : $("hireToggle");
    $(id).scrollIntoView({ block: "nearest" });
    target.focus({ preventScroll: true });
  } else if (act === "deploy") {
    const q = squads.find((q) => q.state === "reserve" && !q.locked && members(q).length);
    if (!q) return;
    // 閉じる処理が選択を解除するため、必ず先に閉じてから配置する部隊を選ぶ。
    setDrawer(null);
    if (placeSquadId !== q.id) document.querySelector('[data-chip="' + q.id + '"]')?.click();
    C.scrollIntoView({ block: "center" });
  } else if (act === "start") {
    setDrawer(null);
    $("start").click();
    C.scrollIntoView({ block: "center" });
  } else if (act === "restart") $("reset").click();
}
function firstPlayPlacement() {
  if (
    !firstPlayReady ||
    uiSave.firstGuideHidden ||
    uiSave.maxWave >= 1 ||
    playing ||
    over ||
    paused ||
    drawerOpen ||
    !firstPlayGoal(onboardStats())
  )
    return null;
  if (!towers.length && !selectedUnitType && !placeSquadId && !selectedTower && !selectedSquad) {
    const p = [
      [330, 300],
      [600, 300],
      [450, 300],
    ].find(([x, y]) => towerSiteOk(x, y));
    if (p) return { x: p[0], y: p[1], label: "草地をタップ" };
  }
  if (!fieldSquads().length && placeSquadId) {
    const p = [
      [650, 300],
      [550, 165],
      [550, 435],
    ].find(([x, y]) => !placeCheck(x, y).error);
    if (p) return { x: p[0], y: p[1], label: "道をタップ" };
  }
  return null;
}
function drawFirstPlayHint() {
  const p = firstPlayPlacement();
  if (!p) return;
  ctx.save();
  ctx.strokeStyle = "#ffe178";
  ctx.fillStyle = "#ffe17833";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = "bold 30px system-ui";
  ctx.textAlign = "center";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#173b35";
  ctx.strokeText(p.label, p.x, p.y - 54);
  ctx.fillStyle = "#fff5be";
  ctx.fillText(p.label, p.x, p.y - 54);
  ctx.restore();
}
$("firstGuideOpen").onclick = () => {
  uiSave.firstGuideHidden = false;
  persistUi();
  closeInfo();
  renderOnboarding();
  $("nextGoal").scrollIntoView({ block: "nearest" });
  $("nextGoal").querySelector("[data-goal-act]")?.focus({ preventScroll: true });
};
$("hireToggle").addEventListener("click", () => {
  if (firstPlayGoal(onboardStats())?.act !== "deploy" || drawerOpen !== "dockUnits") return;
  // 初回の雇用が成功したら、引き出しの裏に配置案内を隠さない。
  setDrawer(null);
  $("nextGoal").scrollIntoView({ block: "nearest" });
});
firstPlayReady = true;
renderOnboarding();
