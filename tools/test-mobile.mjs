#!/usr/bin/env node
// スマートフォンの画面の確認：横にはみ出さない・下のパネルで操作が隠れない・部隊から武将を直接配属
//   node tools/test-mobile.mjs
//   SCREENSHOTS=dir node tools/test-mobile.mjs … 画面写真も保存
// iPhone の実機（Safari のツールバー・キーボード）は確認できないので、画面の大きさを変えて確かめる
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href + "?debug";
const shots = process.env.SCREENSHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

let failures = 0,
  passes = 0;
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
// 第一 槍兵10・第二 弓兵10・第三 足軽10・第四 騎兵5。武将5人（上杉謙信は負傷中）
const types = ["spearman", "archer", "ashigaru", "cavalry"];
const save = { version: 1, seq: 40, squadSeq: 4, squads: [], soldiers: [], fallen: [] };
types.forEach((type, i) => {
  save.squads.push({ id: i + 1, type, slot: i });
  for (let k = 0; k < (i === 3 ? 5 : 10); k++)
    save.soldiers.push({ id: i * 10 + k + 1, type, squadId: i + 1, level: 3 + k });
});
const heroes = {
  version: 1,
  owned: { nobunaga: 2, kenshin: 1, yukimura: 1, kanetsugu: 1, hideyoshi: 1 },
  tickets: 2,
  history: [],
  injured: { kenshin: 2 },
};
async function newPage(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  await page.evaluate(
    ([s, h]) => {
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", s);
      localStorage.setItem("worldDefense.warlords.v1", h);
    },
    [JSON.stringify(save), JSON.stringify(heroes)],
  );
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
async function tapMap(page, x, y) {
  const p = await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById("game"),
        r = c.getBoundingClientRect();
      return {
        x: r.left + c.clientLeft + (x * c.clientWidth) / 960,
        y: r.top + c.clientTop + (y * c.clientHeight) / 600,
      };
    },
    [x, y],
  );
  await page.touchscreen.tap(p.x, p.y);
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
// 画面の中の操作がすべて届くか：スクロールしてボタンの中心を押したとき、上の帯や下のパネルに隠れずにそのボタンに当たる
const reachAll = (page, selector) =>
  ev(
    page,
    (selector) => {
      const bad = [];
      for (const b of document.querySelectorAll(selector)) {
        if (b.offsetParent === null) continue;
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect(),
          hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === b || b.contains(hit)))
          bad.push(b.id || b.dataset.t || b.dataset.chip || b.textContent.trim());
      }
      window.scrollTo(0, 0);
      return bad;
    },
    selector,
  );
const MAIN_BUTTONS = "main > .tools button, #unitTools button, #skillGuideOpen";

for (const [w, h] of [
  [375, 667],
  [390, 844],
  [430, 932],
  [375, 560], // アドレスバーとツールバーが出ていて縦が短いとき
]) {
  console.log(`■ ${w}×${h}`);
  const { page, errors, context } = await newPage(w, h);
  let r = await ev(page, () => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
    header: document.querySelector("header").getBoundingClientRect().height,
    stats: ["hp", "gold", "wave", "deployStat"].map((id) => document.getElementById(id).textContent),
    canvas: document.getElementById("game").getBoundingClientRect().width,
  }));
  check("横にはみ出さない", r.sw <= r.iw, JSON.stringify(r));
  check(
    "上の帯に城HP・所持金・ウェーブ・配置数（1行・小さく）",
    r.header <= 64 &&
      /❤️/.test(r.stats[0]) &&
      /G/.test(r.stats[1]) &&
      /WAVE/.test(r.stats[2]) &&
      /配置 0\/4/.test(r.stats[3]),
    JSON.stringify(r),
  );
  check("マップは画面の幅いっぱい（左右の余白16px以下）", r.canvas >= w - 16, String(r.canvas));
  r = await reachAll(page, MAIN_BUTTONS);
  check("すべてのボタンにスクロールで届く（隠れない）", r.length === 0, r.join());
  r = await ev(page, () => {
    window.scrollTo(0, document.body.scrollHeight);
    const top = document.querySelector("header").getBoundingClientRect().top;
    window.scrollTo(0, 0);
    return top;
  });
  check("下までスクロールしても上の帯は見えたまま", Math.abs(r) < 1, String(r));

  // 部隊のパネル（画面の下から出るシート）
  await ev(page, () => {
    const a = WD_DEBUG.squadApi;
    a.deployReserve(WD_DEBUG.state().squads[0], 650, 300);
  });
  await page.tap('[data-chip="1"]');
  r = await ev(page, () => {
    const p = document.getElementById("squadPanel").getBoundingClientRect(),
      c = document.getElementById("sqClose").getBoundingClientRect();
    return {
      top: p.top,
      bottom: p.bottom,
      h: p.height,
      ih: innerHeight,
      closeTop: c.top,
      closeBottom: c.bottom,
    };
  });
  check(
    "部隊のパネルは画面の下に収まる（下が切れない）",
    r.bottom <= r.ih + 0.5 && r.top >= 0,
    JSON.stringify(r),
  );
  check("パネルは画面の6割まで（マップが見える）", r.h <= r.ih * 0.6 + 1, JSON.stringify(r));
  check("「閉じる」ボタンが見える", r.closeTop >= r.top && r.closeBottom <= r.ih, JSON.stringify(r));
  r = await reachAll(page, "#squadPanel button");
  check("パネルのボタンにすべて届く（パネルの中をスクロール）", r.length === 0, r.join());
  r = await reachAll(page, MAIN_BUTTONS);
  check("パネルを開いていても、ほかのボタンに届く（下に余白）", r.length === 0, r.join());
  await page.tap("#sqHero");
  r = await ev(page, () => {
    const p = document.getElementById("squadPanel");
    p.scrollTop = p.scrollHeight;
    const close = document.getElementById("sqClose").getBoundingClientRect(),
      pr = p.getBoundingClientRect(),
      last = [...p.querySelectorAll("button")]
        .filter((b) => b.offsetParent)
        .pop()
        .getBoundingClientRect();
    return {
      scrolls: p.scrollHeight > p.clientHeight,
      closeVisible: close.top >= pr.top - 0.5 && close.bottom <= innerHeight,
      lastVisible: last.bottom <= innerHeight + 0.5,
    };
  });
  check(
    "武将の一覧を開くと中身はパネルの中でスクロールし、「閉じる」は上に残る",
    r.closeVisible && r.lastVisible,
    JSON.stringify(r),
  );
  if (shots) await page.screenshot({ path: path.join(shots, `m-${w}x${h}-pick.png`) });
  r = await ev(page, () => document.documentElement.scrollWidth <= innerWidth);
  check("武将の一覧を開いても横にはみ出さない", r);
  await page.tap("#sqClose");

  // ほかの画面（シート）
  for (const [open, sheet, close] of [
    ["#skillGuideOpen", "#skillGuideSheet", "#skillGuideClose"],
    ["#organize", "#squadSheet", "#squadClose"],
    ["#soldiers", "#soldierSheet", "#soldierClose"],
    ["#siege", "#siegeSheet", "#siegeClose"],
    ["#gacha", "#gachaSheet", "#gachaClose"],
    ["#roster", "#heroSheet", "#sheetClose"],
  ]) {
    await page.evaluate((sel) => document.querySelector(sel).click(), open);
    r = await ev(
      page,
      ([sheet, close]) => {
        const s = document.querySelector(sheet + " .sheet").getBoundingClientRect(),
          c = document.querySelector(close).getBoundingClientRect();
        return {
          top: s.top,
          bottom: s.bottom,
          ih: innerHeight,
          closeIn: c.top >= 0 && c.bottom <= innerHeight,
          sw: document.documentElement.scrollWidth <= innerWidth && s.right <= innerWidth + 0.5,
        };
      },
      [sheet, close],
    );
    check(
      `${sheet}：画面の中に収まり、閉じるボタンが見える`,
      r.top >= 0 && r.bottom <= r.ih + 0.5 && r.closeIn && r.sw,
      JSON.stringify(r),
    );
    await page.evaluate((sel) => document.querySelector(sel).click(), close);
  }
  check("エラーなし", errors.length === 0, errors.join(" / "));
  await context.close();
}

console.log("■ 部隊から武将を直接配属（390×844）");
let { page, errors, context } = await newPage(390, 844);
let r;
const H = () =>
  ev(page, () =>
    JSON.parse(
      JSON.stringify(WD_DEBUG.heroApi.heroState(), (k, v) =>
        (k === "tower" || k === "squad") && v ? v.id : v,
      ),
    ),
  );
await ev(page, () => WD_DEBUG.squadApi.deployReserve(WD_DEBUG.state().squads[0], 650, 300));
await page.tap('[data-chip="1"]');
check("部隊を押すと下にパネル", await page.isVisible("#squadPanel"));
check(
  "パネルに部隊名・人数・平均Lv・HP",
  /第一部隊（槍兵）/.test(await page.textContent("#sqTitle")) &&
    /生存 10人/.test(await page.textContent("#sqSummary")) &&
    /HP \d+\/\d+/.test(await page.textContent("#sqSummary")),
);
await page.tap("#sqHero");
let rows = await page.$$eval("#sqHeroPick .pick-hero", (rs) =>
  rs.map((r) => ({
    text: r.textContent,
    btn: r.querySelector("button").textContent,
    disabled: r.querySelector("button").disabled,
  })),
);
check(
  "武将の一覧（名前・レア度・★・配属先）",
  rows.length === 5 &&
    /SSR/.test(rows[0].text) &&
    /織田信長★★/.test(rows.map((r) => r.text).join()) &&
    /未配属/.test(rows[0].text),
  JSON.stringify(rows.map((r) => r.text)),
);
check(
  "配属できる武将が先、負傷中は最後で押せない",
  /上杉謙信/.test(rows[4].text) && /負傷中/.test(rows[4].text) && rows[4].disabled && !rows[0].disabled,
  JSON.stringify(rows.map((r) => r.btn)),
);
await page.tap('#sqHeroPick [data-pick-hero="yukimura"]');
let hs = await H();
check("押すとすぐ配属（3タップ：部隊 → 武将を選択 → 武将）", hs.yukimura.squad === 1);
check(
  "配属すると一覧は閉じ、パネルに武将名",
  !(await page.isVisible("#sqHeroPick")) &&
    /真田幸村/.test(await page.textContent("#sqHeroLine")) &&
    /武将を変更/.test(await page.textContent("#sqHero")),
);
await page.tap("#sqHero");
await page.tap('#sqHeroPick [data-pick-hero="nobunaga"]');
hs = await H();
check(
  "武将を変更：前の武将は未配属に戻る（1部隊1人）",
  hs.nobunaga.squad === 1 && hs.yukimura.squad === null,
);
await page.tap("#sqHero");
check(
  "配属中の武将は「外す」",
  /外す/.test(await page.textContent('#sqHeroPick [data-pick-off="nobunaga"]')),
);
await page.tap('#sqHeroPick [data-pick-off="nobunaga"]');
hs = await H();
check(
  "「外す」で配属を解除",
  hs.nobunaga.squad === null && /武将なし/.test(await page.textContent("#sqHeroLine")),
);
await ev(page, () => WD_DEBUG.heroApi.assignHero("kenshin", WD_DEBUG.state().squads[0]));
check("負傷中の武将は配属できない（いままでの決まりのまま）", (await H()).kenshin.squad === null);
// 塔に配属中の武将を部隊へ移すと、塔からは外れる
await page.tap("#sqClose");
await ev(page, () => WD_DEBUG.setGold(9999));
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225);
await tapMap(page, 650, 225);
check("塔を押すと下に塔のパネル", await page.isVisible("#towerPanel"));
await page.tap("#assign");
await page.tap('#tpHeroPick [data-pick-hero="hideyoshi"]');
check("塔のパネルからも同じように武将を配属", (await H()).hideyoshi.tower === 1);
await page.tap("#upgrade");
check("塔の強化", (await ev(page, () => WD_DEBUG.state().towers[0].level)) === 2);
await ev(page, () => (WD_DEBUG.state().towers[0].hp = 50));
await page.tap("#tpClose");
await tapMap(page, 650, 225);
await page.tap("#repair");
check("塔の修理", (await ev(page, () => WD_DEBUG.state().towers[0].hp)) > 50);
await page.tap("#tpClose");
await page.tap('[data-chip="1"]');
await page.tap("#sqHero");
check(
  "塔に配属中の武将は部隊の一覧で「移す」",
  /移す/.test(await page.textContent('#sqHeroPick [data-pick-hero="hideyoshi"]')),
);
await page.tap('#sqHeroPick [data-pick-hero="hideyoshi"]');
hs = await H();
check("移すと塔からは外れる（同じ武将は1か所だけ）", hs.hideyoshi.squad === 1 && hs.hideyoshi.tower === null);

console.log("■ 待機中の部隊・補充・治療・撤退");
await page.tap('[data-chip="2"]');
check(
  "待機中の部隊を押すとパネルが小さく開き、道をタップするよう案内",
  (await page.isVisible("#sqPlaceHint")) && !(await page.isVisible("#sqSummary")),
);
await tapMap(page, 300, 165);
r = await ev(page, () => ({
  state: WD_DEBUG.state().squads[1].state,
  sel: WD_DEBUG.state().selectedSquad && WD_DEBUG.state().selectedSquad.id,
}));
check(
  "そのまま道をタップすると配置され、パネルはその部隊のまま",
  r.state === "deployed" && r.sel === 2,
  JSON.stringify(r),
);
check("配置するとパネルは元の大きさ（武将・撤退などが出る）", await page.isVisible("#sqSummary"));
await page.tap("#sqHero");
await page.tap('#sqHeroPick [data-pick-hero="kanetsugu"]');
check("待機から出した部隊にも配属できる", (await H()).kanetsugu.squad === 2);
await page.tap('[data-chip="4"]');
await page.tap('[data-chip="4"]'); // もう一度押すと配置をやめる
check("もう一度押すと配置をやめてパネルを閉じる", !(await page.isVisible("#squadPanel")));
await page.tap('[data-chip="4"]');
await tapMap(page, 300, 440);
check("第四部隊を下の道に配置", (await ev(page, () => WD_DEBUG.state().squads[3].state)) === "deployed");
r = await ev(page, () => WD_DEBUG.squadApi.roster(WD_DEBUG.state().squads[3]).length);
await page.tap("#sqRecruit");
let r2 = await ev(page, () => WD_DEBUG.squadApi.roster(WD_DEBUG.state().squads[3]).length);
check("「＋ 補充」で新兵を1人", r2 === r + 1, `${r} → ${r2}`);
await ev(page, () => {
  for (const m of WD_DEBUG.squadApi.roster(WD_DEBUG.state().squads[3])) m.hp = 1;
});
await page.tap("#sqHero"); // 画面を描き直す
await page.tap("#sqHero");
await page.tap("#sqHeal");
r = await ev(page, () => WD_DEBUG.squadApi.roster(WD_DEBUG.state().squads[3]).every((m) => m.hp > 1));
check("「治療」で全員回復", r);
r = await ev(page, () => ({
  label: document.getElementById("retreat").textContent,
  organize: !!document.getElementById("sqOrganize"),
  buttons: [...document.querySelectorAll("#squadPanel .panel-actions button")].map((b) => b.textContent.trim()),
}));
check(
  "部隊のボタンは「撤退」「治療」「補充」の3つ（「待機へ」「兵士」はない）",
  r.label === "↩ 撤退" && !r.organize && r.buttons.length === 3,
  JSON.stringify(r),
);
await page.tap("#retreat");
r = await ev(page, () => WD_DEBUG.state().squads[3].state);
check("ウェーブの合間の「撤退」で待機に戻る", r === "reserve", r);
check(
  "待機に戻ってもパネルは開いたまま（「配置」ボタン）",
  (await page.isVisible("#squadPanel")) && /配置/.test(await page.textContent("#retreat")),
);
check("上の帯の配置数も更新（配置 2/4）", /配置 2\/4/.test(await page.textContent("#deployStat")));
check(
  "部隊の列に「配置 n/4｜保有 n/4」（設定の上限）",
  /配置 2\/4｜保有 4\/4/.test(await page.textContent("#unitCount")),
  await page.textContent("#unitCount"),
);
check(
  "部隊ボタンは横1列",
  await ev(page, () => {
    const tops = [...document.querySelectorAll("[data-chip]")].map((b) =>
      Math.round(b.getBoundingClientRect().top),
    );
    return new Set(tops).size === 1;
  }),
);
check(
  "選んだ部隊のボタンが目立つ",
  await ev(page, () => document.querySelector('[data-chip="4"]').classList.contains("active")),
);
if (shots) await page.screenshot({ path: path.join(shots, "m-flow.png") });

console.log("■ 攻城戦の画面（375×560）");
{
  const m = await newPage(375, 560);
  await ev(m.page, () => {
    WD_DEBUG.squadApi.siegeSetHero(0, "nobunaga");
    WD_DEBUG.squadApi.startBattle();
  });
  await m.page.waitForTimeout(100);
  const bad = await reachAll(m.page, "#battleBar button, main > .tools button");
  check("攻城戦の必殺技・全軍撤退のボタンに届く", bad.length === 0, bad.join());
  check(
    "攻城戦でも横にはみ出さない",
    await ev(m.page, () => document.documentElement.scrollWidth <= innerWidth),
  );
  if (shots) await m.page.screenshot({ path: path.join(shots, "m-battle.png") });
  check("エラーなし", m.errors.length === 0, m.errors.join(" / "));
  await m.context.close();
}

console.log("■ 保存・再読み込み");
await ev(page, () => {
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  WD_DEBUG.state().enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブをクリアして保存
});
const before = await ev(page, () =>
  WD_DEBUG.state()
    .squads.map((q) => q.id + ":" + WD_DEBUG.squadApi.roster(q).length)
    .join(),
);
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const after = await ev(page, () =>
  WD_DEBUG.state()
    .squads.map((q) => q.id + ":" + WD_DEBUG.squadApi.roster(q).length)
    .join(),
);
check("再読み込みしても部隊・兵士はそのまま", before === after, `${before} / ${after}`);
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
