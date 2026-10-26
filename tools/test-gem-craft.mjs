#!/usr/bin/env node
// 八玉の交換：8種類を1つずつ使って「復活の書」「召喚の書」を作る。
// 召喚の書：好きなネームド兵士を Lv1・固有スキルつきで（同じ人物は1人まで）。復活の書：英霊名鑑の兵士を戦死したときの育成のまま。
// 戦死したときの育成の控え・保存（失敗したら取り消す）・ウェーブ中は使えない・画面
//   node tools/test-gem-craft.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require(path.join(process.execPath, "../../lib/node_modules/playwright")));
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(root, "index.html")));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = "http://127.0.0.1:" + server.address().port + "/index.html?debug";

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
// 槍兵の部隊（8人・空き2）と、鉄砲兵の部隊（10人・満員）。英霊名鑑に島左近（育成の控えつき）と、以前の形式の記録
const save = { version: 1, seq: 30, squadSeq: 2, squads: [], soldiers: [], fallen: [] };
save.squads.push({ id: 1, type: "spearman", slot: 0 }, { id: 2, type: "gunner", slot: 1 });
for (let k = 0; k < 8; k++)
  save.soldiers.push({ id: k + 1, type: "spearman", squadId: 1, level: 30, skills: [], learned: [] });
for (let k = 0; k < 10; k++)
  save.soldiers.push({ id: 11 + k, type: "gunner", squadId: 2, level: 30, skills: [], learned: [] });
save.fallen.push(
  {
    id: 25,
    name: "島左近",
    type: "spearman",
    level: 120,
    skills: ["spearMaster"],
    battles: 300,
    kills: 900,
    wave: 640,
    named: "sakon",
    snap: {
      learned: ["spearMaster", "ironWall"],
      pts: { atk: 100, def: 50, spd: 0, rng: 0 },
      legend: { stats: [{ k: "atkFlat", v: 77 }], on: 0, abil: [{ k: "beam", v: 0.9 }] },
      fruit: { atk: 3, hp: 2 },
      bestLevel: 130,
    },
  },
  {
    id: 26,
    name: "古参の弥助",
    type: "spearman",
    level: 45,
    skills: ["ironWall"],
    battles: 50,
    kills: 120,
    wave: 30,
    named: null,
  },
);
const all = { jin: 2, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 };
const forge = { version: 1, owned: {}, tickets: 0, history: [], forge: { items: [], seq: 0, gems: all } };
const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(
  ([a, b]) => {
    if (location.protocol !== "http:" || window.name === "seeded") return;
    window.name = "seeded";
    localStorage.clear();
    localStorage.setItem("worldDefense.soldiers.v1", a);
    localStorage.setItem("worldDefense.warlords.v1", b);
  },
  [JSON.stringify(save), JSON.stringify(forge)],
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
await page.goto(url);
await page.waitForFunction(() => window.WD_DEBUG);
const ev = (fn, arg) => page.evaluate(fn, arg);
const reload = async () => {
  await page.reload();
  await page.waitForFunction(() => window.WD_DEBUG);
};
const stored = () =>
  ev(() => ({
    sv: JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")),
    fg: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge,
  }));

console.log("■ 八玉の交換");
let r = await ev(() => {
  const G = WD_DEBUG.gemApi;
  const e1 = G.craftScroll("revive");
  const gems = WD_DEBUG.intruderApi.gems();
  const e2 = G.craftScroll("summon"); // もう8種類そろっていない
  return { e1, gems, e2, scrolls: G.scrolls() };
});
check(
  "8種類そろうと復活の書を作れる（八玉を1つずつ使う）",
  r.e1 === null && JSON.stringify(r.gems) === '{"jin":1}' && r.scrolls.revive === 1,
  JSON.stringify(r),
);
check("そろっていなければ作れない", /そろっていません（1\/8）/.test(r.e2 || ""), r.e2);
let st = await stored();
check(
  "作った書と残りの八玉は保存される",
  JSON.stringify(st.fg.gems) === '{"jin":1}' && JSON.stringify(st.fg.scrolls) === '{"revive":1}',
  JSON.stringify(st.fg),
);
r = await ev(() => {
  const G = WD_DEBUG.gemApi;
  G.setGems({ jin: 1, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 });
  const a = G.craftScroll("summon");
  G.setGems({ jin: 1, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 });
  const b = G.craftScroll("summon");
  return { a, b, scrolls: G.scrolls(), gems: WD_DEBUG.intruderApi.gems() };
});
check(
  "召喚の書も作れる（2冊）・八玉は空になる",
  r.a === null && r.b === null && r.scrolls.summon === 2 && JSON.stringify(r.gems) === "{}",
  JSON.stringify(r),
);

console.log("■ 召喚の書");
r = await ev(() => {
  const G = WD_DEBUG.gemApi,
    S = WD_DEBUG.state,
    q1 = S().squads.find((q) => q.id === 1),
    q2 = S().squads.find((q) => q.id === 2);
  const list = G.summonable();
  const full = G.summonNamed("magoichi", q2);
  const e = G.summonNamed("magoichi", q1);
  const s = S().soldiers.find((x) => x.named === "magoichi");
  const again = G.summonNamed("magoichi", q1);
  return {
    n: list.length,
    full,
    e,
    s: s && { lv: s.level, name: s.name, type: s.type, squad: s.squadId, hp: s.hp > 0 },
    again,
    left: G.scrolls().summon,
  };
});
check("今いないネームド兵士18人から選べる", r.n === 18, String(r.n));
check("満員の部隊には加えられない", /満員/.test(r.full || ""), r.full);
check(
  "好きな人物（雑賀孫市）を Lv1・ネームド兵士として召喚（空きのある部隊へ・混成部隊になる）",
  r.e === null &&
    r.s &&
    r.s.lv === 1 &&
    r.s.name === "雑賀孫市" &&
    r.s.type === "gunner" &&
    r.s.squad === 1 &&
    r.s.hp,
  JSON.stringify(r),
);
check(
  "同じ人物は2人召喚できない（書は減らない）",
  /もう部隊にいます/.test(r.again || "") && r.left === 1,
  JSON.stringify(r),
);
st = await stored();
check(
  "召喚した兵士はすぐ保存される（書の消費も同じ保存）",
  st.sv.soldiers.some((v) => v.named === "magoichi" && v.level === 1 && v.squadId === 1) &&
    JSON.stringify(st.fg.scrolls) === '{"revive":1,"summon":1}',
  JSON.stringify(st.fg.scrolls),
);

console.log("■ 復活の書");
r = await ev(() => {
  const G = WD_DEBUG.gemApi,
    S = WD_DEBUG.state,
    q1 = S().squads.find((q) => q.id === 1);
  const list = G.revivable().map((f) => f.name);
  const e = G.reviveFallen(25, q1);
  const s = S().soldiers.find((x) => x.named === "sakon");
  return {
    list,
    e,
    s: s && {
      lv: s.level,
      best: s.bestLevel,
      learned: s.learned,
      skills: s.skills,
      pts: s.pts,
      legend: s.legend,
      fruit: s.fruit,
      kills: s.kills,
      name: s.name,
    },
    fallen: G.revivable().map((f) => f.name),
    left: G.scrolls().revive || 0,
  };
});
check("英霊名鑑の兵士から選べる", r.list.join() === "島左近,古参の弥助", r.list.join());
check(
  "戦死したときのレベル・スキル・ポイント・伝説の能力・能力の実のまま復活",
  r.e === null &&
    r.s &&
    r.s.lv === 120 &&
    r.s.best === 130 &&
    r.s.learned.join() === "spearMaster,ironWall" &&
    r.s.skills.join() === "spearMaster" &&
    r.s.pts.atk === 100 &&
    r.s.legend.stats[0].v === 77 &&
    r.s.fruit.atk === 3 &&
    r.s.kills === 900 &&
    r.s.name === "島左近",
  JSON.stringify(r),
);
check(
  "復活した兵士は英霊名鑑から外れ、書はなくなる",
  r.fallen.join() === "古参の弥助" && r.left === 0,
  JSON.stringify(r),
);
st = await stored();
check(
  "復活はすぐ保存される（名鑑・書も同じ保存）",
  st.sv.soldiers.some((v) => v.named === "sakon" && v.level === 120) &&
    !st.sv.fallen.some((f) => f.id === 25) &&
    JSON.stringify(st.fg.scrolls) === '{"summon":1}',
  JSON.stringify(st.fg.scrolls),
);
r = await ev(() => WD_DEBUG.gemApi.reviveFallen(26, WD_DEBUG.state().squads[0]));
check("書がなければ使えない", /持っていません/.test(r || ""), r);

console.log("■ 戦死したときの育成の控え");
r = await ev(() => {
  const S = WD_DEBUG.state,
    s = S().soldiers.find((x) => x.named === "sakon");
  WD_DEBUG.squadApi.killSoldier(
    s,
    S().squads.find((q) => q.id === s.squadId),
  );
  const f = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).fallen[0];
  return { name: f.name, snap: f.snap };
});
check(
  "名前のある兵士が戦死すると、英霊名鑑に育成の控え（習得スキル・ポイント・職業・伝説の能力・実）も残る",
  r.name === "島左近" &&
    r.snap &&
    r.snap.learned.includes("ironWall") &&
    r.snap.pts.atk === 100 &&
    r.snap.legend.stats[0].v === 77 &&
    r.snap.fruit.atk === 3 &&
    r.snap.job,
  JSON.stringify(r),
);
await reload();
r = await ev(() => WD_DEBUG.gemApi.revivable().find((f) => f.name === "島左近"));
check("読み込み直しても控えは残る", r && r.snap && r.snap.pts.atk === 100, JSON.stringify(r && r.snap));

console.log("■ 使えないとき・保存に失敗したとき");
r = await ev(() => {
  const G = WD_DEBUG.gemApi,
    S = WD_DEBUG.state;
  document.getElementById("start").click();
  const e = G.summonNamed("hanzo", S().squads[0]);
  WD_DEBUG.stopSpawning();
  S().enemies.length = 0;
  WD_DEBUG.step(0.2);
  return e;
});
check("ウェーブ中は使えない", /ウェーブ中/.test(r || ""), r);
r = await ev(() => {
  const G = WD_DEBUG.gemApi,
    S = WD_DEBUG.state;
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).startsWith("worldDefense.")) throw new Error("QuotaExceededError");
    return set.call(this, k, v);
  };
  const n0 = S().soldiers.filter((x) => x.alive).length;
  const e = G.summonNamed(
    "hanzo",
    S().squads.find((q) => q.id === 1),
  );
  Storage.prototype.setItem = set;
  return {
    e,
    n: S().soldiers.filter((x) => x.alive).length - n0,
    left: G.scrolls().summon,
    hanzo: S().soldiers.some((x) => x.named === "hanzo"),
  };
});
check(
  "保存できなければ召喚しない（兵士は増えず、書は残る）",
  /保存できなかった/.test(r.e || "") && r.n === 0 && r.left === 1 && !r.hanzo,
  JSON.stringify(r),
);

console.log("■ 画面（375×667）");
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="gems"]');
let text = await page.textContent("#gearBody");
check(
  "📿 八玉タブに交換（復活の書・召喚の書）と「書を使う」",
  /八玉の交換/.test(text) && /復活の書/.test(text) && /召喚の書/.test(text) && /書を使う/.test(text),
  text.slice(0, 300),
);
r = await ev(() => [...document.querySelectorAll("[data-scroll-craft]")].map((b) => b.disabled));
check("八玉がそろっていなければ「作る」は押せない", r.length === 2 && r.every(Boolean), JSON.stringify(r));
await page.tap('[data-scroll-use="summon"]');
text = await page.textContent("#gearBody");
check(
  "召喚する人物の一覧（固有スキルの説明つき）",
  /召喚する人物を選んでください/.test(text) &&
    /服部半蔵/.test(text) &&
    /伊賀の頭領/.test(text) &&
    !/雑賀孫市/.test(text),
  text.slice(0, 400),
);
await page.tap('[data-scroll-pick="hanzo"]');
text = await page.textContent("#gearBody");
check(
  "次に部隊を選ぶ（空きのある部隊だけ）",
  /加える部隊を選んでください/.test(text) && /第一部隊/.test(text) && !/第二部隊/.test(text),
  text.slice(0, 400),
);
await page.tap('[data-scroll-to="1"]');
r = await ev(() => ({
  hanzo: WD_DEBUG.state().soldiers.find((x) => x.named === "hanzo"),
  note: document.querySelector("#gearBody .saved").textContent,
  h: document.documentElement.scrollWidth > innerWidth,
}));
check(
  "画面から召喚できる（服部半蔵 Lv1）・375pxで横にはみ出さない",
  r.hanzo && r.hanzo.level === 1 && /服部半蔵 を召喚した/.test(r.note) && !r.h,
  JSON.stringify(r.note),
);
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
server.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
