// 能力順が実能力と一致し、表示操作で所属・保存を変えないこと。横スワイプ・折りたたみ。
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const server = http.createServer((q, r) => {
  r.setHeader("Content-Type", "text/html; charset=utf-8");
  r.end(fs.readFileSync(new URL("../index.html", import.meta.url)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const url = `http://127.0.0.1:${server.address().port}/`,
  S = "worldDefense.soldiers.v1",
  W = "worldDefense.warlords.v1",
  K = "worldDefense.settings.v1";
const errors = [];
let count = 0;
function check(v, label) {
  assert.ok(v, label);
  count++;
  console.log("✓ " + label);
}
async function setup({ width = 390, debug = true, empty = false, formation } = {}) {
  const c = await browser.newContext({
    viewport: { width, height: width === 375 ? 560 : 844 },
    isMobile: width < 700,
    hasTouch: width < 700,
  });
  await c.addInitScript(
    ({ S, W, K, empty, formation }) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.getItem("seed")) return;
      sessionStorage.setItem("seed", "1");
      const levels = [30, 5, 110, 10, 70, 1, 30, 90, 45, 60, 25, 10, 5, 99, 100, 30],
        types = [
          "spearman",
          "archer",
          "gunner",
          "medic",
          "cavalry",
          "ashigaru",
          "spearman",
          "archer",
          "gunner",
          "medic",
          "cavalry",
          "ashigaru",
          "archer",
          "gunner",
          "medic",
          "spearman",
        ];
      localStorage.setItem(
        S,
        JSON.stringify({
          seq: 16,
          squadSeq: 8,
          heroId: 1,
          squads: empty
            ? []
            : Array.from({ length: 8 }, (_, i) => ({ id: i + 1, type: types[i * 2], slot: i })),
          soldiers: empty
            ? []
            : levels.map((level, i) => ({
                id: i + 1,
                type: types[i],
                squadId: Math.floor(i / 2) + 1,
                level,
                bestLevel: level,
                skills: [],
                learned: [],
                name: "兵" + (i + 1),
              })),
          fallen: [],
        }),
      );
      localStorage.setItem(
        W,
        JSON.stringify({
          owned: {},
          tickets: 5,
          forge: { seq: 1, items: [{ uid: 1, id: "nanbando", owner: 2, lock: true }] },
        }),
      );
      localStorage.setItem(K, JSON.stringify({ auto: false, waveGoal: 200, formation }));
    },
    { S, W, K, empty, formation },
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url + (debug ? "?debug" : ""));
  await p.locator("#organize").click();
  return { p, c };
}
const ids = (p) =>
  p.locator("[data-formation-row]").evaluateAll((es) => es.map((e) => +e.dataset.formationRow));
const filter = (p, v) => p.locator(`[data-squad-filter="${v}"]`).click();
const snapshot = (p) =>
  p.evaluate(
    ({ S, W }) => ({
      s: localStorage.getItem(S),
      w: localStorage.getItem(W),
      order: WD_DEBUG.state().soldiers.map((s) => [s.id, s.squadId]),
      groups: WD_DEBUG.state().squads.map((q) => q.id),
    }),
    { S, W },
  );
async function expected(p, key, asc = false, slot = null) {
  return p.evaluate(
    ({ key, asc, slot }) => {
      const D = WD_DEBUG;
      return D.state()
        .soldiers.filter(
          (s) => s.alive && (slot === null || D.state().squads.find((q) => q.id === s.squadId).slot === slot),
        )
        .map((s) => ({
          id: s.id,
          value: key === "level" ? s.level : D.squadApi.soldierStats(s)[key === "hp" ? "maxHp" : key],
          slot: D.state().squads.find((q) => q.id === s.squadId).slot,
        }))
        .sort((a, b) => (asc ? 1 : -1) * (a.value - b.value) || a.slot - b.slot || a.id - b.id)
        .map((s) => s.id);
    },
    { key, asc, slot },
  );
}
try {
  {
    const { p, c } = await setup();
    const before = await snapshot(p);
    check(
      (await ids(p)).join() === Array.from({ length: 16 }, (_, i) => i + 1).join(),
      "旧設定は部隊順で全16人を表示",
    );
    check(
      (await p.locator("#formationSort option").count()) === 6,
      "部隊順・最大HP・攻撃力・防御力・射程・Lvを選択可能",
    );
    for (const key of ["hp", "atk", "def", "range", "level"]) {
      await p.selectOption("#formationSort", key);
      check(
        (await ids(p)).join() === (await expected(p, key)).join(),
        key + "高い順：全隊をまたぎ実能力と一致",
      );
      check(
        (await p.locator("#squadList .formation-group-controls").count()) === 1 &&
          (await p
            .locator("#squadList .formation-record")
            .first()
            .innerText()
            .then((t) => /部隊/.test(t))),
        key + "順でも所属を表示し配置・治療の入口を維持",
      );
      await p.locator("#formationSortDirection").click();
      check((await ids(p)).join() === (await expected(p, key, true)).join(), key + "低い順：方向を切替");
      await p.locator("#formationSortDirection").click();
    }
    const tied = (await ids(p)).filter((id) => [1, 7, 16].includes(id));
    check(tied.join() === "1,7,16", "同Lvでは部隊順・ID順で安定");
    await filter(p, "0");
    check(
      (await ids(p)).join() === (await expected(p, "level", false, 0)).join(),
      "部隊を選ぶと所属内だけを並べ替え",
    );
    await filter(p, "all");
    await p.locator('[data-formation-soldier="3"]').click();
    await p.locator("#soldierClose").click();
    check(
      (await p.inputValue("#formationSort")) === "level" &&
        (await ids(p)).join() === (await expected(p, "level")).join(),
      "詳細・育成から戻っても並び順を維持",
    );
    await p.selectOption("#formationSort", "squad");
    check((await ids(p)).join() === Array.from({ length: 16 }, (_, i) => i + 1).join(), "部隊順へ戻せる");
    check(
      JSON.stringify(await snapshot(p)) === JSON.stringify(before),
      "閲覧・ソートで兵士配列・所属・部隊順・兵士/武将保存を変更しない",
    );
    await p.selectOption("#formationSort", "atk");
    await p.locator('[data-move="3"]').click();
    check(
      (await p.locator("#formationSort").isDisabled()) &&
        (await p.inputValue("#formationSort")) === "squad" &&
        (await p.locator('[data-move-to="1"]').count()) === 1,
      "能力順から移籍を始めても部隊ごとの移籍先を選択できる",
    );
    await p.locator("[data-cancel-move]").click();
    check(
      !(await p.locator("#formationSort").isDisabled()) &&
        (await ids(p)).join() === (await expected(p, "atk")).join(),
      "移籍取消で能力順を復元",
    );
    await p.locator("[data-bulk-swap-start]").click();
    await filter(p, "0");
    await p.locator('[data-bulk-pick="1"]').click();
    await filter(p, "7");
    await p.locator('[data-bulk-pick="16"]').click();
    await p.locator("#formationTabsToggle").click();
    await p.locator("#formationTabsToggle").click();
    check(
      (await p.locator("[data-bulk-swap-go]").isEnabled()) &&
        (await p.locator("#formationSort").isDisabled()),
      "タブ折りたたみ・部隊切替でまとめて交代の選択を失わない",
    );
    await p.locator("[data-bulk-swap-go]").click();
    check(
      await p.evaluate(
        () =>
          WD_DEBUG.state().soldiers.find((s) => s.id === 1).squadId === 8 &&
          WD_DEBUG.state().soldiers.find((s) => s.id === 16).squadId === 1,
      ),
      "既存のまとめて交代が正しい兵士IDに反映",
    );
    await filter(p, "candidates");
    check(
      (await p.locator("#formationSort").isDisabled()) &&
        (await p.inputValue("#formationSort")) === "level" &&
        (
          await p
            .locator("[data-mentor-candidate]")
            .evaluateAll((es) => es.map((e) => +e.dataset.mentorCandidate))
        ).join() === "15,3",
      "指導員候補はLv100以上・主人公除外・Lv昇順を維持",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    await p.selectOption("#formationSort", "def");
    await p.locator("#formationSortDirection").click();
    const height = await p.locator(".formation-head").evaluate((e) => e.getBoundingClientRect().height);
    await p.locator("#formationTabsToggle").click();
    await p.waitForTimeout(220);
    const closed = await p.evaluate(() => ({
      height: document.querySelector(".formation-head").getBoundingClientRect().height,
      drawer: document.querySelector("#squadTabDrawer").getBoundingClientRect().height,
      inert: document.querySelector("#squadTabDrawer").inert,
    }));
    check(
      closed.inert &&
        closed.drawer < 1 &&
        closed.height < height - 20 &&
        (await p.locator("#formationTabsToggle").getAttribute("aria-expanded")) === "false",
      "折りたたみはスライドして高さを減らしタブをフォーカス対象から外す",
    );
    await p.reload();
    await p.locator("#organize").click();
    check(
      (await p.inputValue("#formationSort")) === "def" &&
        (await p
          .locator("#formationSortDirection")
          .innerText()
          .then((t) => t.includes("低い順"))) &&
        (await p.locator("#formationTabsToggle").getAttribute("aria-expanded")) === "false",
      "並べ替え・方向・折りたたみを再読込後も保持",
    );
    await p.locator("#formationTabsToggle").click();
    await p.waitForTimeout(220);
    await filter(p, "7");
    await p.keyboard.press("ArrowLeft");
    check(
      (await p.locator("#squadFilter-6").getAttribute("aria-selected")) === "true",
      "キーボード切替でも横に隠れた部隊を選べる",
    );
    await p.keyboard.press("End");
    check(
      (await p.locator("#squadFilter-candidates").getAttribute("aria-selected")) === "true",
      "Endで指導員候補へ移動",
    );
    await p.keyboard.press("Home");
    check((await p.locator("#squadFilter-all").getAttribute("aria-selected")) === "true", "Homeで全隊へ移動");
    await p.locator("#siege").click();
    check(
      (await p.locator("#formationRosterTools").isHidden()) && (await p.locator("#siegeSheet").isVisible()),
      "攻城用武将では兵士用ソートと部隊タブを隠す",
    );
    await p.locator("#formationSoldiers").click();
    check(
      (await p.locator("#formationRosterTools").isVisible()) &&
        (await p.inputValue("#formationSort")) === "def",
      "兵士へ戻ると表示設定を維持",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const rail = p.locator("#squadRosterTabs");
    await rail.evaluate((e) => {
      e.scrollLeft = 0;
    });
    const r = await rail.boundingBox(),
      y = r.y + r.height / 2,
      cdp = await c.newCDPSession(p);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: r.x + r.width - 12, y }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: r.x + r.width - 12 - ((r.width - 24) * i) / 8, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await p.waitForTimeout(250);
    check(
      (await rail.evaluate((e) => e.scrollLeft)) > 60 &&
        (await p.locator("#squadFilter-all").getAttribute("aria-selected")) === "true",
      "実際のタッチ横スワイプでタブを送り、勝手に部隊を切り替えない",
    );
    await cdp.detach();
    await c.close();
  }
  {
    const { p, c } = await setup({
      formation: { sort: "invalid", direction: "broken", tabsCollapsed: "true" },
    });
    check(
      (await p.inputValue("#formationSort")) === "squad" &&
        (await p.locator("#formationTabsToggle").getAttribute("aria-expanded")) === "true",
      "破損/旧設定は部隊順・開いたタブへ正規化",
    );
    await c.close();
    const z = await setup({ empty: true });
    await z.p.selectOption("#formationSort", "hp");
    check(
      (await ids(z.p)).length === 0 &&
        (await z.p.locator("#squadList").innerText()).includes("部隊がありません"),
      "兵士0人でもソート可能・空表示",
    );
    await z.c.close();
  }
  for (const width of [375, 390, 430, 1280]) {
    const { p, c } = await setup({ width, debug: false });
    await p.selectOption("#formationSort", "range");
    const before = await p.locator(".formation-head").evaluate((e) => e.getBoundingClientRect().height);
    const r = await p.evaluate(() => ({
      fit: document.documentElement.scrollWidth <= innerWidth,
      controls: [
        ...document.querySelectorAll(".formation-view-controls button,.formation-view-controls select"),
      ].every((b) => {
        const r = b.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.height >= 32;
      }),
      rows: document.querySelectorAll("[data-formation-row]").length,
      scroll:
        document.querySelector("#squadRosterTabs").scrollWidth >
        document.querySelector("#squadRosterTabs").clientWidth,
    }));
    check(
      r.fit && r.controls && r.rows === 16 && before <= 200 && r.scroll,
      width + "px通常URL：横はみ出しなし・見出し200px以内・部隊タブは横に送れる",
    );
    await p.locator("#formationTabsToggle").click();
    await p.waitForTimeout(220);
    check(
      (await p.locator(".formation-head").evaluate((e) => e.getBoundingClientRect().height)) < before - 20,
      width + "px：折りたたみで兵士一覧の領域を拡大",
    );
    if (process.env.SCREENSHOTS) {
      fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
      await p.screenshot({ path: process.env.SCREENSHOTS + "/formation-sort-" + width + ".png" });
      await p.locator("#formationTabsToggle").click();
      await p.waitForTimeout(220);
      await p.screenshot({ path: process.env.SCREENSHOTS + "/formation-tabs-" + width + ".png" });
    }
    await c.close();
  }
  check(errors.length === 0, "JavaScriptエラーなし：" + errors.join(","));
  console.log(`${count} passed, 0 failed`);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
