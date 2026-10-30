// コンパクト表示（v103・UI改善の第1段階）。部隊・建設・必殺技・メニューを1列のボタンにまとめ、押したものだけ下から開く。
// 中のボタンは従来の要素そのものなので、ここでは開き方・表示・従来の操作がそのまま使えることを確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html;charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const types = ["spearman", "cavalry", "archer", "medic", "gunner", "spearman", "cavalry", "archer"],
  save = { seq: 80, squadSeq: 8, squads: [], soldiers: [], fallen: [] };
let sid = 0;
types.forEach((t, i) => {
  save.squads.push({ id: i + 1, type: t, slot: i });
  for (let k = 0; k < 10; k++) save.soldiers.push({ id: ++sid, type: t, squadId: i + 1, level: 200 });
});
// seed：既存のセーブ（武将2人・券5枚）。fresh：保存データなしで始める
async function open({ width = 390, height = 844, query = "?debug&layout=compact", fresh = false } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 });
  await c.addInitScript(
    ({ save, fresh }) => {
      requestAnimationFrame = () => 0;
      if (location.protocol !== "http:" || sessionStorage.s) return;
      sessionStorage.s = 1;
      if (fresh) return;
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ owned: { nobunaga: 1, yukimura: 1 }, tickets: 5 }));
    },
    { save, fresh },
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG || document.body.classList.length >= 0);
  return { c, p };
}
const at = (p, x, y) =>
  p.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return { x: r.left + c.clientLeft + (x * c.clientWidth) / 960, y: r.top + c.clientTop + (y * c.clientHeight) / 600 };
    },
    [x, y],
  );
const tapMap = async (p, x, y) => {
  const pt = await at(p, x, y);
  await p.touchscreen.tap(pt.x, pt.y);
};
const box = (p, sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; }, sel);
const shown = (p, sel) => p.locator(sel).isVisible();
try {
  // ===== 表示の種類の決まり方 =====
  let { c, p } = await open({ query: "" });
  check(await p.evaluate(() => document.body.classList.contains("compact-ui")), "通常のURLはコンパクト表示が既定");
  await c.close();
  ({ c, p } = await open({ query: "?debug" }));
  check(await p.evaluate(() => !document.body.classList.contains("compact-ui")) && (await shown(p, "#gacha")), "?debug は既存の試験のため従来表示が既定");
  await c.close();

  // ===== スマホ縦画面 =====
  ({ c, p } = await open());
  await p.evaluate(() => {
    const S = WD_DEBUG.state, A = WD_DEBUG.squadApi;
    [[300, 165], [300, 440], [620, 300], [780, 300]].forEach((pt, i) => A.deployReserve(S().squads[i], ...pt));
    WD_DEBUG.heroApi.draw();
    // 試験ではAPIで配置したので、画面の更新（実際の操作では毎回行われる）を一度だけ起こす
    document.getElementById("dockUnits").click();
    document.getElementById("dockUnits").click();
  });
  let g = await box(p, "#game"),
    dock = await box(p, "#dockBar");
  check(Math.round(g.width) === 390 && g.left === 0, "戦場を画面の端から端まで表示（390px幅いっぱい）", g);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "横にはみ出さない");
  check(dock.bottom <= 844 && (await box(p, "#start")).bottom <= 844, "戦場・ウェーブ開始・部隊/建設/必殺技/メニューがスクロールなしで見える", dock);
  check(
    !(await shown(p, "#squadChips")) && !(await shown(p, '[data-t="arrow"]')) && !(await shown(p, "#mapOpen")),
    "部隊8つ・塔4種・メニューは、ふだんは折りたたむ",
  );
  check(/配置 4\/8/.test(await p.locator("#dockUnits").innerText()) && /塔 0\/6/.test(await p.locator("#dockBuild").innerText()), "ボタンに配置数・塔の数を表示");

  // 部隊
  await p.locator("#dockUnits").tap();
  check(
    (await p.locator("#squadChips button").count()) === 8 && (await shown(p, "#squadChips button >> nth=7")) && (await p.getAttribute("#dockUnits", "aria-expanded")) === "true",
    "「部隊」で8部隊の一覧が下から開く",
  );
  check((await box(p, "#unitTools")).top >= g.bottom - 1, "部隊の一覧を開いても戦場は隠れない");
  await p.locator("#squadChips button >> nth=4").tap();
  await tapMap(p, 700, 300);
  check((await p.evaluate(() => WD_DEBUG.state().squads[4].state)) === "deployed", "一覧の待機部隊を押して道をタップすると配置（従来どおり）");
  check(/配置 5\/8/.test(await p.locator("#dockUnits").innerText()), "配置するとボタンの数も更新");
  await p.locator("#dockUnits").tap().catch(() => {});
  if (!(await shown(p, "#squadChips"))) await p.locator("#dockUnits").tap();
  await p.locator("#squadChips button >> nth=0").tap();
  check((await shown(p, "#squadPanel")) && !(await p.evaluate(() => document.getElementById("unitTools").classList.contains("open"))), "出陣中の部隊を押すと部隊の操作パネル（撤退・治療・武将）を開き、一覧は閉じる");
  await p.locator("#sqClose").tap();

  // 建設
  await p.locator("#dockBuild").tap();
  const labels = await p.locator("#towerTools [data-t]").allInnerTexts();
  check(labels.length === 4 && /弓.*100G/s.test(labels[0]) && /大砲.*180G/s.test(labels[1]) && /鉄砲.*220G/s.test(labels[2]) && /水攻め.*150G/s.test(labels[3]), "「建設」で4種類の塔と値段", labels);
  await p.locator('[data-t="cannon"]').tap();
  check(!(await shown(p, '[data-t="cannon"]')), "塔を選ぶと引き出しを閉じて戦場をタップできる");
  const gold0 = await p.evaluate(() => WD_DEBUG.state().gold);
  await tapMap(p, 330, 300);
  let t = await p.evaluate(() => WD_DEBUG.state().towers.map((t) => ({ type: t.type, level: t.level })));
  check(t.length === 1 && t[0].type === "cannon" && (await p.evaluate(() => WD_DEBUG.state().gold)) === gold0 - 180, "草地をタップすると大砲の塔を建設（180G）", t);
  await p.evaluate(() => WD_DEBUG.setGold(5000));
  await tapMap(p, 330, 300);
  await p.locator("#upgrade").tap();
  check((await p.evaluate(() => WD_DEBUG.state().towers[0].level)) === 2, "塔を選んで強化（従来どおり）");
  await p.locator("#sell").tap();
  check((await p.evaluate(() => WD_DEBUG.state().towers.length)) === 0, "塔の売却（従来どおり）");

  // 必殺技
  await p.evaluate(() => WD_DEBUG.heroApi.assignHero("nobunaga", WD_DEBUG.state().squads[0]));
  await p.locator("#dockSkills").tap();
  check(/織田信長（部隊）.*ウェーブ中に使えます/.test(await p.locator("#skillDockList").innerText()) && (await p.locator("[data-skill-hero]").isDisabled()), "必殺技の一覧：準備中は使えない理由を表示");
  await p.locator("#skillDock [data-drawer-close]").tap();
  await p.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    for (let i = 0; i < 6; i++) WD_DEBUG.addEnemy({ kind: "goblin", d: 230 + i * 8, hp: 1e9, speed: 0 });
    WD_DEBUG.step(0.05);
  });
  await p.locator("#dockSkills").tap();
  check(/使える/.test(await p.locator("#dockSkills").innerText()) && (await p.locator("[data-skill-hero]").isEnabled()), "ウェーブ中は「使える」と表示し発動できる");
  await p.locator("[data-skill-hero]").tap();
  const used = await p.evaluate(() => { const h = WD_DEBUG.state().heroState.nobunaga; return { cd: h.cd, active: h.active }; });
  check(used.cd > 0 || used.active > 0, "一覧から必殺技を発動（従来の必殺技ボタンと同じ処理）", used);
  check(/発動中|あと\d+秒/.test(await p.locator("#skillDockList").innerText()), "発動後は再使用までの秒数を表示");
  await p.evaluate(() => {
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.step(0.1);
  });
  await p.locator("#skillDock [data-drawer-close]").tap();

  // メニュー
  await p.locator("#dockMenu").tap();
  const menuText = await p.locator("#menuTools").innerText();
  check(["戦い", "武将・兵士の育成", "装備・アイテム", "記録・その他", "世界", "編成", "修練場", "ガチャ", "主人公", "育成情報", "装備倉庫", "商店", "秘伝錬成", "図鑑", "途中保存", "最初から", "データ消去", "表示"].every((w) => menuText.includes(w)), "メニューに世界・編成・ガチャ・育成・装備・商店・修練場・図鑑・設定をまとめる", menuText);
  check((await box(p, "#menuTools")).height <= 844 * 0.56, "メニューは画面の半分ほどの高さで、中だけスクロール");
  await p.locator("#mapOpen").tap();
  check((await shown(p, "#mapSheet")) && !(await p.evaluate(() => document.getElementById("menuTools").classList.contains("open"))), "世界を押すと世界地図を開き、メニューは閉じる");
  await p.locator("#mapClose").tap();
  for (const [btn, sheet, text] of [["#menuOrganize", "#squadSheet", "編成"], ["#menuShop", "#gearSheet", "商店"], ["#menuInfo", "#infoSheet", "育成情報"]]) {
    await p.locator("#dockMenu").tap();
    await p.locator(btn).tap();
    const ok = await shown(p, sheet);
    const shop = btn === "#menuShop" ? await p.evaluate(() => document.querySelector('[data-gear-tab="shop"]')?.getAttribute("aria-pressed") === "true") : true;
    check(ok && shop, "メニューの「" + text + "」から従来の画面を開く");
    await p.keyboard.press("Escape").catch(() => {});
    await p.evaluate(() => document.querySelectorAll(".sheet-back:not([hidden]) .icon-btn").forEach((b) => b.click()));
  }
  check(!(await p.evaluate(() => document.querySelector(".sheet-back:not([hidden])"))), "開いた画面は従来どおり閉じられる");
  await p.locator("#dockMenu").tap();
  await p.locator("#layoutToggle").tap();
  check(
    (await p.evaluate(() => !document.body.classList.contains("compact-ui"))) && (await shown(p, "#gacha")) && (await shown(p, '[data-t="arrow"]')) && !(await shown(p, "#dockBar")),
    "メニューの「表示」で従来の表示に切り替え",
  );
  await p.goto(base + "?debug");
  check(await p.evaluate(() => !document.body.classList.contains("compact-ui") && JSON.parse(localStorage.getItem("worldDefense.ui.v1")).layout === "classic"), "表示の切り替えを保存");
  await p.locator("#layoutToggle").click();
  check(await p.evaluate(() => document.body.classList.contains("compact-ui")), "従来の表示からもコンパクトへ戻せる");
  await c.close();

  // ===== 初めてのプレイ：新しく使える機能はメニューのボタンに印 =====
  ({ c, p } = await open({ fresh: true }));
  check((await p.evaluate(() => !document.getElementById("dockMenuBadge").hidden)) && /ガチャ/.test(await p.evaluate(() => document.querySelector("#menuTools .feature-new")?.textContent || "")), "新しく使えるようになった機能（ガチャ）があればメニューに印");
  await c.close();

  // ===== PC =====
  ({ c, p } = await open({ width: 1280, height: 900 }));
  g = await box(p, "#game");
  dock = await box(p, "#dockBar");
  check(g.height >= 560 && dock.bottom <= 900, "PCでも戦場と操作の列が1画面に収まる", { g, dock });
  await p.locator("#dockBuild").click();
  await p.keyboard.press("Escape");
  check(!(await shown(p, '[data-t="arrow"]')), "PC：Escキーで引き出しを閉じる");
  await p.locator("#dockMenu").click();
  await p.locator("#zukanOpen").click();
  check(await shown(p, "#zukanSheet"), "PC：メニューから図鑑を開く");
  await c.close();
  check(!errors.length, "JavaScript例外なし", errors);
  console.log("全" + n + "項目が成功");
} finally {
  await browser.close();
  server.close();
}
