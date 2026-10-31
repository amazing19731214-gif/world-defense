// raw.githack.com のテスト版を、iPhone 13 相当で開いて操作する（テスト配信の確認用。ゲームの中身は変えない）
import { webkit, chromium, devices } from "playwright";
const URL = "https://raw.githack.com/amazing19731214-gif/world-defense/trial-test-preview/index.html";
const engine = process.argv[2] === "chromium" ? chromium : webkit;
const out = { engine: process.argv[2] || "webkit" };
const errors = [];
const browser = await engine.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const p = await ctx.newPage();
p.setDefaultTimeout(30000);
p.on("pageerror", (e) => {
  if (/carbonads|githack\.com\/(?!amazing)/.test(e.message)) return console.log("IGNORED_3RD_PARTY " + e.message.slice(0, 120)); // 配信サービスの広告のエラー（ゲームとは無関係）
  errors.push(e.message);
});
p.on("dialog", (d) => d.accept());
let ok = true;
const step = (name, value, pass) => {
  out[name] = value;
  console.log((pass ? "OK  " : "NG  ") + name + " " + JSON.stringify(value));
  if (!pass) ok = false;
};
try {
  let res = await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2500);
  // raw.githack.com は、ブラウザで開くと「External Content Notice」（外部の中身の注意）の画面を先に出すことがある。
  // その画面の文と、先へ進むボタン・リンクを記録して、押せるなら押して進む
  if (!(await p.title()).includes("【テスト】")) {
    const notice = await p.evaluate(() => ({
      title: document.title,
      text: document.body.innerText.slice(0, 1500),
      links: [...document.querySelectorAll("a,button,input[type=submit]")].map((a) => [a.tagName, (a.innerText || a.value || "").trim().slice(0, 60), a.getAttribute("href")]).slice(0, 20),
    }));
    console.log("NOTICE " + JSON.stringify(notice, null, 1));
    const go = p.locator("a,button,input[type=submit]").filter({ hasText: /continue|proceed|view|続|進|open|I understand|accept/i }).first();
    if (await go.count()) {
      await go.tap();
      await p.waitForLoadState("load");
      await p.waitForTimeout(3000);
      console.log("AFTER_NOTICE " + JSON.stringify({ url: p.url(), title: await p.title() }));
    }
  }
  // raw.githack.com の注意の画面（広告など、ゲームの外のスクリプト）で出たエラーは数えない。ゲームのページが開いてからのエラーだけを見る
  errors.length = 0;
  step("1 ページが表示される", { status: res.status(), type: res.headers()["content-type"], title: await p.title() }, res.status() === 200 && (await p.title()).includes("【テスト】"));
  const badge = await p.evaluate(() => {
    const b = document.getElementById("testBadge");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent, left: Math.round(r.left), bottom: Math.round(r.bottom), h: innerHeight };
  });
  step("2 左下に「🧪 テスト環境」", badge, !!badge && badge.text.includes("テスト環境") && badge.left < 20 && badge.h - badge.bottom < 20);
  await p.locator("#dockMenu").tap();
  await p.waitForTimeout(400);
  step("3 メニューが開く", await p.locator("#testPrepare").isVisible(), await p.locator("#testPrepare").isVisible());
  await p.locator("#testPrepare").tap();
  await p.waitForLoadState("load");
  await p.waitForTimeout(2500);
  const n = await p.evaluate(() => JSON.parse(localStorage.getItem("worldDefense.soldiers.v1") || "{}").soldiers?.length || 0);
  const raw = await p.evaluate(() => Object.keys(localStorage).sort());
  step("4 テスト用兵士を準備できる（10人・保存は wdtest: の領域だけ）", { n, raw }, n === 10 && raw.every((k) => k.startsWith("wdtest:")));
  await p.locator("#dockMenu").tap();
  await p.locator("#trialOpen").scrollIntoViewIfNeeded();
  await p.locator("#trialOpen").tap();
  await p.waitForTimeout(400);
  for (const name of ["試・剣神", "試・槍将", "試・弓聖", "試・銃将", "試・医王"]) await p.locator("[data-trial-pick]", { hasText: name }).tap();
  await p.locator("[data-trial-go]").tap();
  await p.waitForTimeout(400);
  // v108：広い戦場。配置は「🧭 自動で並べる」
  await p.locator("#trialAuto").tap();
  await p.locator("#trialGo").tap();
  await p.waitForTimeout(8000);
  const info = await p.evaluate(() => document.getElementById("trialInfo").textContent);
  step("5 戦場試練を開始できる（8秒たって戦闘が進む）", info, /味方 \d\/5/.test(info) && /\d+秒/.test(info));
  // 兵士の札を押して操作 → スティックを指で倒す → 全員自動
  await p.locator("#trialUnits [data-trial-ctl]").first().tap();
  await p.waitForTimeout(500);
  const ctl = await p.evaluate(() => ({ info: document.getElementById("trialInfo").textContent, chips: document.querySelectorAll("#trialUnits [data-trial-ctl]").length, pad: document.getElementById("trialPad").offsetParent !== null }));
  step("6 兵士の札を押すと、その兵士を操作できる", ctl, ctl.info.includes("操作中") && ctl.chips === 5 && ctl.pad);
  const pad = await p.locator("#trialPad").boundingBox();
  const sy0 = await p.evaluate(() => scrollY);
  const cx = pad.x + pad.width / 2,
    cy = pad.y + pad.height / 2;
  // 指の操作（タッチの pointer）を送る：押す → 左へ倒す → 離す
  const knob = await p.evaluate(
    async ([cx, cy]) => {
      const pad = document.getElementById("trialPad"),
        ev = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev("pointerdown", cx, cy);
      for (let i = 1; i <= 5; i++) ev("pointermove", cx - i * 10, cy);
      await new Promise((r) => setTimeout(r, 1200));
      const t = getComputedStyle(pad.querySelector(".trial-knob")).transform;
      ev("pointerup", cx - 50, cy);
      return t;
    },
    [cx, cy],
  );
  const sy1 = await p.evaluate(() => scrollY);
  step("7 スティックを指で倒せる（画面はスクロールしない）", { knob, sy0, sy1 }, knob !== "none" && sy0 === sy1);
  await p.locator("#trialAutoAll").tap();
  await p.waitForTimeout(300);
  const auto = await p.evaluate(() => document.getElementById("trialInfo").textContent);
  step("8 「🤖 全員自動」で操作を外せる", auto, auto.includes("全員自動"));
  await p.locator("#trialRetreat").tap();
  await p.waitForTimeout(800);
  const result = await p.evaluate(() => ({ open: !document.getElementById("trialSheet").hidden, rows: document.querySelectorAll(".trial-unit").length, text: document.querySelector(".trial-result")?.textContent }));
  step("9 撤退すると結果の画面", result, result.open && result.rows === 5);
  // v108.1 サバイバル：もう一度 → 「🔥 サバイバル」→ 主人公（試・弓聖）→ 開始 → スティック → 撤退
  await p.locator("[data-trial-again]").tap();
  await p.locator('[data-trial-mode="survival"]').tap();
  await p.locator("[data-trial-hero]", { hasText: "試・弓聖" }).tap();
  const heroBtn = await p.evaluate(() => [...document.querySelectorAll("[data-trial-hero]")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]));
  step("10 サバイバル：選んだ5人から主人公（試・弓聖）を選べる", heroBtn, heroBtn.length === 5 && heroBtn.some(([t, a]) => t.includes("試・弓聖") && a === "true"));
  await p.locator("[data-trial-go]").tap();
  await p.waitForTimeout(6000);
  const sv = await p.evaluate(() => ({ info: document.getElementById("trialInfo").textContent, units: document.getElementById("trialUnits").hidden, pad: document.getElementById("trialPad").offsetParent !== null }));
  step("11 サバイバルが主人公1人で始まる（仲間 0/4・スティック）", sv, /サバイバル/.test(sv.info) && /試・弓聖/.test(sv.info) && /仲間 [01]\/4/.test(sv.info) && sv.units && sv.pad);
  const pad2 = await p.locator("#trialPad").boundingBox();
  const knob2 = await p.evaluate(
    async ([cx, cy]) => {
      const pad = document.getElementById("trialPad"),
        ev = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, { pointerId: 8, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      ev("pointerdown", cx, cy);
      for (let i = 1; i <= 5; i++) ev("pointermove", cx + i * 10, cy - i * 6);
      await new Promise((r) => setTimeout(r, 1500));
      const t = getComputedStyle(pad.querySelector(".trial-knob")).transform;
      ev("pointerup", cx + 50, cy - 30);
      return t;
    },
    [pad2.x + pad2.width / 2, pad2.y + pad2.height / 2],
  );
  step("12 サバイバル：主人公をスティックで動かせる", knob2, knob2 !== "none");
  // v108.2 敵を倒して経験値がたまると、戦闘が止まり選択画面 →「👥 仲間を1人加入」を指で押す
  let lvUp = false;
  for (let i = 0; i < 60 && !lvUp; i++) {
    await p.waitForTimeout(1000);
    lvUp = await p.evaluate(() => !document.getElementById("trialLevelUp").hidden);
  }
  const choice = await p.evaluate(() => [...document.querySelectorAll("[data-trial-choose]")].map((b) => b.textContent.slice(0, 40)));
  step("12b レベルアップで選択画面が出る（仲間の加入＋強化）", { lvUp, choice }, lvUp && choice.length === 3 && choice[0].includes("仲間を1人加入"));
  if (lvUp) await p.locator('[data-trial-choose="0"]').tap();
  await p.waitForTimeout(800);
  const kills = await p.evaluate(() => ({ info: document.getElementById("trialInfo").textContent, box: document.getElementById("trialLevelUp").hidden }));
  step("12c 「仲間を1人加入」で仲間が1人増え、戦闘が再開する", kills, /仲間 1\/4/.test(kills.info) && kills.box);
  // v108.6 効果音の音量のボタン：押すたびに 大→中→小→消音（音を出す処理で JavaScript のエラーが出ないこと）
  const snd = [];
  for (let i = 0; i < 4; i++) {
    await p.locator("#trialSound").tap();
    snd.push(await p.locator("#trialSound").textContent());
  }
  step("12d 効果音の音量のボタン（中→小→消音→大→中）", snd, snd.join() === "🔈 小,🔇 消音,🔊 大,🔉 中");
  if (await p.evaluate(() => !document.getElementById("trialLevelUp").hidden)) await p.locator('[data-trial-choose="0"]').tap();
  await p.locator("#trialRetreat").tap();
  await p.waitForTimeout(800);
  const svr = await p.evaluate(() => ({ open: !document.getElementById("trialSheet").hidden, title: document.getElementById("trialTitle").textContent, text: document.getElementById("trialBody").textContent.slice(0, 600) }));
  step("13 サバイバル：撤退すると結果の画面（主人公に👑）", { svr, kills }, svr.open && svr.title.includes("サバイバル") && svr.text.includes("撤退") && svr.text.includes("👑"));
  // v108.5 経験値コイン：拾った枚数と経験値が結果の画面に出る（レベルアップしていれば、コインを拾って経験値が入っている）
  const coin = (svr.text.match(/経験値コイン：(\d+)枚・EXP (\d+)/) || []).slice(1).map(Number);
  step("13a サバイバル：経験値コインを拾って経験値が入る（結果：" + (coin[0] ?? "?") + "枚・EXP " + (coin[1] ?? "?") + "）", coin, coin.length === 2 && coin[0] > 0 && coin[1] >= 4);
  // v108.3 奥義：テスト用兵士の準備で「試・剣神」が奥義継承者（八方天翔斬）。主人公にして右下のボタンを押す
  await p.locator("[data-trial-again]").tap();
  await p.locator("[data-trial-hero]", { hasText: "試・剣神" }).tap();
  await p.locator("[data-trial-go]").tap();
  await p.waitForTimeout(800);
  const ob = await p.evaluate(() => {
    const b = document.getElementById("trialOugiBtn"),
      a = document.getElementById("trialPad").getBoundingClientRect(),
      c = b && b.getBoundingClientRect();
    return b && { text: b.textContent, disabled: b.disabled, overlap: !(a.right <= c.left || c.right <= a.left || a.bottom <= c.top || c.bottom <= a.top) };
  });
  step("13b 奥義継承者（試・剣神）を主人公にすると、右下に「奥義 八方天翔斬」（スティックと重ならない）", ob, ob && !ob.disabled && /八方天翔斬/.test(ob.text) && !ob.overlap);
  let used = null;
  for (let i = 0; i < 45 && !used; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => !document.getElementById("trialLevelUp").hidden)) await p.locator('[data-trial-choose="0"]').tap();
    if (await p.evaluate(() => { const b = document.getElementById("trialOugiBtn"); return b && !b.disabled; })) await p.locator("#trialOugiBtn").tap();
    used = await p.evaluate(() => {
      const b = document.getElementById("trialOugiBtn");
      return b && b.disabled && /もう使いました/.test(b.textContent) ? b.textContent : null;
    });
  }
  step("13c 指で奥義のボタンを押すと発動（この戦闘ではもう使えない）", used, !!used);
  if (await p.evaluate(() => !document.getElementById("trialLevelUp").hidden)) await p.locator('[data-trial-choose="0"]').tap();
  await p.locator("#trialRetreat").tap();
  await p.waitForTimeout(800);
  const ores = await p.evaluate(() => document.getElementById("trialBody").textContent.slice(0, 400));
  step("13d 結果の画面に使った奥義が出る", ores, /奥義「八方天翔斬」/.test(ores));
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  step("14 横にはみ出さない", overflow, overflow <= 0);
  step("15 JavaScript のエラーなし", errors, errors.length === 0);
} catch (e) {
  step("例外", String(e && e.message), false);
}
await browser.close();
console.log(JSON.stringify(out));
process.exit(ok ? 0 : 1);
