#!/usr/bin/env node
// 終盤の特殊装備の入手：爆炎の鉄砲は天下統一の報酬（1つ・小判では作れない）、幻影の指輪は最後の裏ボス（零式・天魔機神）を倒すと小判で作れる。
// 効果はその装備の解放後に働く・保存（失敗したら次の起動で渡す・二重に渡さない・倉庫が満杯でも消えない）・画面
//   node tools/test-endgame-gear.mjs
import { createRequire } from "node:module";
import path from "node:path";
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
const SKEY = "worldDefense.soldiers.v1",
  WKEY = "worldDefense.warlords.v1",
  CKEY = "worldDefense.conquest.v1";
const won = { attempts: 1, wins: 1, first: 1, best: 60 };
function roster() {
  const save = { version: 1, seq: 20, squadSeq: 2, squads: [], soldiers: [], fallen: [] };
  ["gunner", "archer"].forEach((t, q) => {
    save.squads.push({ id: q + 1, type: t, slot: q });
    for (let k = 0; k < 10; k++)
      save.soldiers.push({ id: q * 10 + k + 1, type: t, squadId: q + 1, level: 60, skills: [], learned: [] });
  });
  return save;
}
const forge = (o = {}) =>
  JSON.stringify({
    version: 1,
    owned: {},
    tickets: 0,
    history: [],
    forge: { items: [], seq: 0, koban: 5000, ...o },
  });
// 保存データは最初の読み込みの前に入れる（読み込んだ後に入れると、離れるときのゲームの保存で上書きされることがある）
async function newContext(seeds, failSave = false) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([seeds, failSave]) => {
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        localStorage.clear();
        for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
      }
      if (!failSave) return;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k) === "worldDefense.warlords.v1") throw new Error("QuotaExceededError");
        return set.call(this, k, v);
      };
    },
    [seeds, failSave],
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
const reload = async (page) => {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
};
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const guns = (page) =>
  ev(page, () =>
    WD_DEBUG.forgeApi
      .save()
      .items.filter((it) => it.id === "blastGun")
      .map((it) => it.lock),
  );

console.log("■ 天下統一の報酬：爆炎の鉄砲");
let { page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster()),
  [WKEY]: forge(),
  [CKEY]: JSON.stringify({ version: 2, tenka: true }),
});
let r = await ev(page, () => {
  const L = WD_DEBUG.legendApi;
  return {
    guns: WD_DEBUG.forgeApi
      .save()
      .items.filter((it) => it.id === "blastGun")
      .map((it) => it.lock),
    flag: WD_DEBUG.forgeApi.save().bossRewards.tenka,
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge.items.filter(
      (it) => it.id === "blastGun",
    ).length,
    on: L.endgameOn(),
    gunOn: L.gearUnlocked("blastGun"),
    ringOn: L.gearUnlocked("phantomRing"),
    craftGun: L.craftEndgame("blastGun"),
    craftMura: L.craftEndgame("lightMuramasa"),
    craftRing: L.craftEndgame("phantomRing"),
  };
});
check(
  "以前に天下統一した保存データには、起動時に爆炎の鉄砲を1つ渡す（ロック済み・保存済み）",
  r.guns.join() === "true" && r.flag === true && r.saved === 1,
  JSON.stringify(r),
);
check("（裏ボスは倒していないので終盤は未解放）", r.on === false && r.gunOn === true && r.ringOn === false);
check("爆炎の鉄砲は小判では作れない", /作れません/.test(r.craftGun || ""), r.craftGun);
check(
  "村正は終盤の解放後、指輪は天魔機神を倒すまで作れない",
  /終盤/.test(r.craftMura || "") && /天魔機神/.test(r.craftRing || ""),
  JSON.stringify([r.craftMura, r.craftRing]),
);
r = await ev(page, () => {
  const F = WD_DEBUG.forgeApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.type === "gunner"),
    it = F.save().items.find((x) => x.id === "blastGun");
  const eq = F.equipItem(s, it.uid);
  return { eq, blast: WD_DEBUG.squadApi.skillSum(s, "blast") };
});
check("天下統一だけで、鉄砲兵に装備すると爆発の効果が働く（60%）", r.blast === 0.6, JSON.stringify(r));
await reload(page);
r = await guns(page);
check("再読み込みしても二重には渡さない", r.length === 1, JSON.stringify(r));
// 売った・なくした保存データを、別の環境で開き直す（動いているページの保存データを書き換えると、ゲームの保存で上書きされることがある）
const sold = await ev(page, () => {
  const out = Object.fromEntries(
    Object.keys(localStorage)
      .filter((k) => k.startsWith("worldDefense."))
      .map((k) => [k, localStorage.getItem(k)]),
  );
  const d = JSON.parse(out["worldDefense.warlords.v1"]);
  d.forge.items = d.forge.items.filter((it) => it.id !== "blastGun");
  out["worldDefense.warlords.v1"] = JSON.stringify(d);
  return out;
});
await context.close();
({ page, errors, context } = await newContext(sold));
r = await guns(page);
check("手放した後は、もう一度は渡さない（1回だけの報酬）", r.length === 0, JSON.stringify(r));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 天下統一の前");
const sv = roster();
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(sv),
  [WKEY]: forge({ items: [{ uid: 1, id: "blastGun", owner: 1, lock: true }], seq: 1 }),
  [CKEY]: JSON.stringify({ version: 2, tenka: false }),
}));
r = await ev(page, () => ({
  guns: WD_DEBUG.forgeApi.save().items.filter((it) => it.id === "blastGun").length,
  blast: WD_DEBUG.squadApi.skillSum(
    WD_DEBUG.state().soldiers.find((x) => x.id === 1),
    "blast",
  ),
  grant: WD_DEBUG.legendApi.grantTenkaGun(),
}));
check(
  "天下統一の前は渡さない・装備していても爆発しない",
  r.guns === 1 && r.blast === 0 && r.grant === false,
  JSON.stringify(r),
);
await context.close();

console.log("■ 保存に失敗したとき・倉庫が満杯のとき");
({ page, errors, context } = await newContext(
  { [SKEY]: JSON.stringify(roster()), [WKEY]: forge(), [CKEY]: JSON.stringify({ version: 2, tenka: true }) },
  true,
));
r = await ev(page, () => ({
  guns: WD_DEBUG.forgeApi.save().items.filter((it) => it.id === "blastGun").length,
  flag: !!WD_DEBUG.forgeApi.save().bossRewards.tenka,
}));
check(
  "保存できなければ渡さない（受け取った印も付けない）",
  r.guns === 0 && r.flag === false,
  JSON.stringify(r),
);
// 保存データをそのまま、保存できる環境で開き直す
const kept = await ev(page, () =>
  Object.fromEntries(
    Object.keys(localStorage)
      .filter((k) => k.startsWith("worldDefense."))
      .map((k) => [k, localStorage.getItem(k)]),
  ),
);
await context.close();
({ page, errors, context } = await newContext(kept));
r = await guns(page);
check("保存できるようになった次の起動で渡す", r.length === 1, JSON.stringify(r));
await context.close();
const full = Array.from({ length: 300 }, (_, i) => ({
  uid: i + 1,
  id: "uchigatana",
  owner: null,
  lock: false,
}));
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster()),
  [WKEY]: forge({ items: full, seq: 300 }),
  [CKEY]: JSON.stringify({ version: 2, tenka: true }),
}));
await reload(page);
r = await ev(page, () => ({
  guns: WD_DEBUG.forgeApi.save().items.filter((it) => it.id === "blastGun").length,
  n: WD_DEBUG.forgeApi.save().items.length,
}));
check("倉庫が満杯（300）でも渡し、再読み込みで消えない", r.guns === 1 && r.n === 301, JSON.stringify(r));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 最後の裏ボス（零式・天魔機神）の討伐：幻影の指輪");
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster()),
  [WKEY]: forge(),
  [CKEY]: JSON.stringify({ version: 2, tenka: false, bosses: { fuji: won } }),
}));
r = await ev(page, () => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi;
  const res = {
    on: L.endgameOn(),
    list: ["lightMuramasa", "raijinSpear", "blastGun", "phantomRing"].filter(L.endgameCraftable),
    mura: L.craftEndgame("lightMuramasa"),
    ring: L.craftEndgame("phantomRing"),
    koban: F.koban(),
  };
  const s = WD_DEBUG.state().soldiers.find((x) => x.type === "archer"),
    it = F.save().items.find((x) => x.id === "phantomRing");
  F.equipItem(s, it.uid);
  res.shadow = WD_DEBUG.squadApi.skillSum(s, "shadow");
  res.lock = it.lock;
  return res;
});
check(
  "天魔機神を倒すと、幻影の指輪だけ小判で作れる（終盤の解放の前でも）",
  r.on === false && r.list.join() === "phantomRing" && /終盤/.test(r.mura || ""),
  JSON.stringify(r),
);
check(
  "小判2,000両で作れて、ロック済み・影分身の効果が働く（30%）",
  r.ring === null && r.koban === 3000 && r.lock === true && r.shadow === 0.3,
  JSON.stringify(r),
);
await page.tap("#gearOpen");
let text = await page.textContent("#gearBody");
const btns = await ev(page, () =>
  [...document.querySelectorAll("[data-endgame-craft]")].map((b) => b.dataset.endgameCraft),
);
check(
  "装備倉庫に「幻影の指輪」を作るボタン（爆炎の鉄砲は出ない）",
  btns.join() === "phantomRing" && /天魔機神を倒すと作れる/.test(text),
  btns.join() + " / " + text.slice(0, 200),
);
await page.tap('[data-endgame-craft="phantomRing"]');
r = await ev(page, () => ({
  n: WD_DEBUG.forgeApi.save().items.filter((x) => x.id === "phantomRing").length,
  h: document.documentElement.scrollWidth > innerWidth,
}));
check("ボタンで作れる・375×667で横にはみ出さない", r.n === 2 && !r.h, JSON.stringify(r));
check("エラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 天魔機神を倒す前");
({ page, errors, context } = await newContext({
  [SKEY]: JSON.stringify(roster()),
  [WKEY]: forge({ items: [{ uid: 1, id: "phantomRing", owner: 11, lock: true }], seq: 1 }),
  [CKEY]: JSON.stringify({ version: 2, tenka: true, bosses: { hiei: won, yomi: won } }),
}));
r = await ev(page, () => ({
  shadow: WD_DEBUG.squadApi.skillSum(
    WD_DEBUG.state().soldiers.find((x) => x.id === 11),
    "shadow",
  ),
  list: ["lightMuramasa", "raijinSpear", "blastGun", "phantomRing"].filter(
    WD_DEBUG.legendApi.endgameCraftable,
  ),
  btn: !!document.querySelector("[data-endgame-craft]"),
}));
check(
  "天魔機神を倒す前は、指輪は作れず・装備していても影分身は出ない",
  r.shadow === 0 && r.list.length === 0,
  JSON.stringify(r),
);
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
