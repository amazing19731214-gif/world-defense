// テストプレイ版（node tools/build.mjs --test）だけに入る道具。本番の index.html には入らない（ボタンも出ない）。
//   ・画面の左下に「🧪 テスト環境」の札
//   ・メニューに「🧪 テスト用兵士を準備」「🧪 テストデータを初期化」
//   保存はすべて test-env-head.js の分離された領域（wdtest:）にだけ書く。本番のデータには触らない
(() => {
  if (window.WD_TEST_BUILD !== true) return;
  const $ = (id) => document.getElementById(id);
  // テスト用兵士：正式な兵種・職業・閃き・装備だけを使う（職業は JOBS・閃きは INSIGHT_SKILLS・装備は GEAR にあるもの）
  //   [名前, 兵種, Lv, 職業, 熟練度を上げる職業, 閃き, 装備]
  const MAX = 1e15; // 熟練度は読み込みのときに上限（10）に収まる
  const PRESET = [
    ["試・新兵", "ashigaru", 30, null, ["ashigaru"], null, []],
    ["試・弓兵", "archer", 60, null, ["archer"], null, ["shigeto"]],
    ["試・鉄砲", "gunner", 60, null, ["gunner"], null, ["sakaizutsu"]],
    ["試・衛生", "medic", 100, null, ["medic"], null, ["haramaki"]],
    ["試・剣聖", "ashigaru", 150, "sword_saint", ["ashigaru", "samurai", "kensei", "sword_saint"], "in_sword_saint", ["haramaki"]],
    ["試・弓聖", "archer", 300, "bow_saint", ["archer", "bow_saint"], "in_bow_saint", ["tosei", "shippu"]],
    ["試・銃将", "gunner", 300, "gun_commander", ["gunner", "gun_commander"], "in_gun_commander", ["tosei", "shippu"]],
    ["試・医王", "medic", 300, "healing_master", ["medic", "healing_master"], "in_healing_master", ["tosei", "omamori"]],
    ["試・槍将", "spearman", 300, "spear_commander", ["spearman", "spear_commander"], "in_spear_commander", ["tosei", "bushin"]],
    ["試・剣神", "ashigaru", 1500, "sword_saint", ["ashigaru", "samurai", "kensei", "sword_saint"], "in_sword_saint", ["tosei", "bushin"]],
  ];
  function testSave() {
    const items = [];
    let uid = 0;
    const soldiers = PRESET.map(([name, type, level, job, profJobs, ins, gear], i) => {
      const id = i + 1;
      for (const g of gear) items.push({ uid: ++uid, id: g, owner: id, lock: true });
      return {
        id,
        type,
        squadId: i < 5 ? 1 : 2,
        level,
        name,
        ...(job ? { job, jobs: [...new Set([type, ...profJobs])] } : {}),
        prof: Object.fromEntries(profJobs.map((j) => [j, MAX])),
        // v108.4 ステータスポイント「速さ」：Lv の分だけ（最大100。攻撃の速さと、戦場試練・攻城戦の歩く速さに効く）
        pts: { atk: 0, def: 0, spd: Math.min(100, level), rng: 0 },
        ...(ins ? { insight: { known: [ins], equipped: [ins] } } : {}),
      };
    });
    return {
      soldiers: { version: 1, seq: soldiers.length, squadSeq: 2, fallen: [], squads: [{ id: 1, type: "ashigaru", slot: 0 }, { id: 2, type: "archer", slot: 1 }], soldiers },
      warlords: { version: 1, owned: {}, tickets: 3, history: [], forge: { items } },
      ui: { version: 1, all: true, seen: {}, fresh: {} },
      // v108.3 剣聖の伝説の奥義3つの奥義書と、奥義継承者（試・剣神・八方天翔斬）。継承する奥義は兵士名簿の「⚔ 奥義」で変えられる
      ougi: (() => {
        const sid = PRESET.findIndex((p) => p[0] === "試・剣神") + 1,
          at = Date.now(),
          books = ["happouTenshou", "mumyouIssen", "tenkenRanbu"].map((k, i) => ({ uid: i + 1, k, from: "試・剣神（テスト）", job: "sword_saint", level: 1500, at }));
        return { version: 1, seq: books.length, books, known: {}, rolls: {}, fails: {}, heir: { sid, k: "happouTenshou", book: 1 }, run: null };
      })(),
    };
  }
  // 準備：今のテスト用データを控え（wdtest:testBackup）に残してから、テスト用データを作り直す
  function prepare() {
    if (!confirm("テスト用のセーブデータを初期化して、テスト用兵士（10人）を用意します。\n\n・本番のゲームのデータには影響しません。\n・今のテスト用データは1つだけ控えを残します。\n\nよろしいですか？")) return;
    const backup = {};
    for (const k of window.WD_TEST_STORAGE.keys()) if (k !== "testBackup") backup[k] = localStorage.getItem(k);
    localStorage.clear(); // テストの領域だけが消える
    try {
      localStorage.setItem("testBackup", JSON.stringify({ at: Date.now(), data: backup }));
    } catch (err) {
      /* 控えが入らなくても続ける */
    }
    const S = testSave();
    localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(S.soldiers));
    localStorage.setItem("worldDefense.warlords.v1", JSON.stringify(S.warlords));
    localStorage.setItem("worldDefense.ui.v1", JSON.stringify(S.ui));
    localStorage.setItem("worldDefense.ougi.v1", JSON.stringify(S.ougi));
    location.reload();
  }
  function reset() {
    if (!confirm("テスト用のセーブデータをすべて消します（本番のゲームのデータは消えません）。\nよろしいですか？")) return;
    localStorage.clear(); // テストの領域だけが消える
    location.reload();
  }
  // 画面：左上の札と、メニューの2つのボタン（テスト版だけ）
  const badge = document.createElement("div");
  badge.id = "testBadge";
  badge.textContent = "🧪 テスト環境";
  badge.setAttribute("aria-label", "テストプレイ用の環境です（本番のデータとは別）");
  badge.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:30;opacity:.9;padding:2px 8px;border-radius:8px;font:bold 12px system-ui;background:#7a1fa2e6;color:#fff;pointer-events:none;max-width:40vw";
  document.body.appendChild(badge);
  const menu = $("menuTools");
  if (menu) {
    const mk = (id, text, fn) => {
      const b = document.createElement("button");
      b.id = id;
      b.type = "button";
      b.textContent = text;
      b.onclick = fn;
      b.style.gridColumn = "1 / -1";
      menu.prepend(b);
      return b;
    };
    mk("testReset", "🧪 テストデータを初期化", reset);
    mk("testPrepare", "🧪 テスト用兵士を準備", prepare);
  }
  window.WD_TEST_TOOLS = { prepare, reset, preset: PRESET, testSave };
})();
