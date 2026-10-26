#!/usr/bin/env node
// 超秘伝書：Lv100以上の指導員の引退で0.1%「貫通ビームサーベル」、SSR武将の秘伝錬成で1%「連鎖雷撃」。
// 手に入るのも使えるのもいつでも（終盤の解放前でも働く）・強さは抽選・保存（失敗したら出ない）・画面の表示
// 指導員の能力値の書（攻撃・防御・体力・射程の書。数値は引退のときに抽選）
//   node tools/test-super-books.mjs
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
  WKEY = "worldDefense.warlords.v1";
const save = { version: 1, seq: 20, squadSeq: 2, squads: [], soldiers: [], fallen: [] };
save.squads.push({ id: 1, type: "spearman", slot: 0 }, { id: 2, type: "ashigaru", slot: 1 });
for (let k = 0; k < 10; k++)
  save.soldiers.push({
    id: k + 1,
    type: "spearman",
    squadId: 1,
    level: 120,
    skills: ["spearMaster"],
    learned: ["spearMaster"],
    name: "老兵" + k,
  });
for (let k = 0; k < 10; k++)
  save.soldiers.push({ id: 11 + k, type: "ashigaru", squadId: 2, level: 30, skills: [], learned: [] });
const warlords = { version: 1, owned: { nobunaga: 5, kanbei: 5 }, tickets: 0, history: [] };

const context = await browser.newContext({
  viewport: { width: 375, height: 667 },
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
  ([a, b, c, d]) => {
    localStorage.clear();
    localStorage.setItem(a, JSON.stringify(b));
    localStorage.setItem(c, JSON.stringify(d));
  },
  [SKEY, save, WKEY, warlords],
);
const reload = async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
};
await reload();
const ev = (fn, arg) => page.evaluate(fn, arg);

console.log("■ 確率の設定");
let r = await ev(() => WD_DEBUG.legendApi.LEGEND);
check(
  "引退の超秘伝書（貫通ビームサーベル）0.1%・SSRの秘伝錬成（連鎖雷撃）1%",
  r.superBeam === 0.001 && r.superChain === 0.01,
  JSON.stringify([r.superBeam, r.superChain]),
);

console.log("■ 指導員の引退（Lv100以上）");
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi;
  L.setSuperRng(() => 0.0011); // 0.1% より上 → 出ない
  const e1 = L.retireSoldier(1, 0);
  const n1 = F.save().legendBooks.length;
  L.setSuperRng(() => 0.0009); // 0.1% より下 → 出る
  const e2 = L.retireSoldier(2, 0);
  L.setSuperRng();
  const books = F.save().legendBooks;
  return { e1, n1, e2, books, mentor: F.save().mentors[0].skill, on: L.endgameOn() };
});
check("（まだ終盤を解放していない）", r.on === false);
check("抽選が外れたら、選んだ書だけ", r.e1 === null && r.n1 === 1, JSON.stringify(r));
const sb = r.books.find((b) => b.super);
check(
  "当たったら、選んだ書とは別に🌟超秘伝書「貫通ビームサーベル」（強さは60〜120%の抽選）",
  r.e2 === null &&
    r.books.length === 3 &&
    sb &&
    sb.k === "beam" &&
    sb.v >= 0.6 &&
    sb.v <= 1.2 &&
    sb.from === "🎖老兵1",
  JSON.stringify(r.books),
);
check("指導員名簿にも超秘伝書を記録", /＋🌟超秘伝 🗡️貫通ビームサーベル/.test(r.mentor), r.mentor);

console.log("■ 終盤の解放前でも使える");
r = await ev((uid) => {
  const L = WD_DEBUG.legendApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 11),
    hits = [];
  const ok = L.equipBook(s, uid);
  L.legendStrike(
    s,
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    100,
    [
      { x: 40, y: 0 },
      { x: 120, y: 0 },
    ],
    (e, d) => hits.push(d),
  );
  return {
    on: L.endgameOn(),
    ok,
    eq: L.booksOf(11).map((b) => b.k + "=" + b.v),
    beam: WD_DEBUG.squadApi.skillSum(s, "beam"),
    hits: hits.length,
    left: WD_DEBUG.forgeApi.save().legendBooks.some((b) => b.uid === uid && b.owner === 11),
  };
}, sb.uid);
check(
  "解放前でも装備できて、同じ強さで効き、書はなくならない（装備中）",
  r.on === false &&
    r.ok === null &&
    r.eq.join() === "beam=" + sb.v &&
    Math.abs(r.beam - sb.v) < 1e-9 &&
    r.left,
  JSON.stringify(r),
);
check("解放前でも貫通ビームサーベルが発動する（一直線上の敵に当たる）", r.hits > 0, JSON.stringify(r));

console.log("■ SSR武将の秘伝錬成");
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi;
  L.setSuperRng(() => 0.0099);
  const ssr = F.forge("nobunaga", "book");
  const r1 = F.forge("kanbei", "book"); // R武将：出ない
  L.setSuperRng(() => 0.011);
  const ssr2 = F.forge("nobunaga", "gear"); // 1%より上：出ない
  L.setSuperRng();
  return {
    ssr: ssr.superBook,
    r1: r1.superBook || null,
    ssr2: ssr2.superBook || null,
    chain: F.save().legendBooks.filter((b) => b.super && b.k === "chain").length,
    saved: JSON.parse(localStorage.getItem("worldDefense.warlords.v1")).forge.legendBooks.filter(
      (b) => b.super && b.k === "chain",
    ).length,
  };
});
check(
  "SSR武将（織田信長）で当たると🌟超秘伝書「連鎖雷撃」",
  r.ssr && r.ssr.k === "chain" && r.ssr.super && r.ssr.v >= 0.4 && r.ssr.v <= 0.9,
  JSON.stringify(r.ssr),
);
check(
  "SSR以外（黒田官兵衛）では出ない・1%より上では出ない",
  r.r1 === null && r.ssr2 === null && r.chain === 1,
  JSON.stringify(r),
);
check("錬成と同じ保存で確定している", r.saved === 1, String(r.saved));

console.log("■ 画面");
await ev(() => WD_DEBUG.legendApi.setSuperRng(() => 0));
await page.tap("#forgeOpen");
let text = await page.textContent("#forgeBody");
check(
  "秘伝錬成の説明に「SSR武将のカードでは1%で超秘伝書」",
  /SSR武将のカードでは、まれに（1%）🌟超秘伝書「連鎖雷撃」/.test(text),
  text.slice(0, 200),
);
await page.tap('[data-forge-pick="nobunaga"]');
await page.tap("[data-forge-go]");
text = await page.textContent("#forgeBody");
check(
  "錬成の結果に「🌟 さらに超秘伝書…を手に入れた！」",
  /🌟 さらに超秘伝書「⚡連鎖雷撃（\d+%）」を手に入れた！/.test(text) &&
    /兵士に使える/.test(text) &&
    !/終盤/.test(text),
  text.slice(0, 300),
);
await page.tap("#forgeClose");
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="books"]');
text = await page.textContent("#gearBody");
check("スキルの書の一覧に🌟超秘伝の書", /🌟超秘伝 ⚡連鎖雷撃/.test(text), text.slice(0, 300));
await page.tap("#gearClose");
await page.tap("#soldiers");
await page.tap('[data-retire="3"]');
text = await page.textContent("#retireBody");
check(
  "引退の画面に「まれに（0.1%）超秘伝書」の説明",
  /まれに（0.1%）、別に🌟超秘伝書「貫通ビームサーベル」/.test(text),
  text,
);
await page.tap('[data-retire-pick="0"]');
await page.tap("[data-retire-go]");
const toast = await page.textContent("#toast");
check(
  "引退で当たると知らせる",
  /超秘伝書「貫通ビームサーベル」を手に入れた/.test(toast) &&
    /さらに 🌟超秘伝/.test(await page.textContent("#msg")),
  toast,
);
const bs = await ev(() => {
  const b = [...document.querySelectorAll("button")].filter((x) => x.getClientRects().length);
  return { hScroll: document.documentElement.scrollWidth > innerWidth };
});
check("375×667：横にはみ出さない", !bs.hScroll);

console.log("■ 指導員の能力値の書");
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    find = (id) => WD_DEBUG.state().soldiers.find((x) => x.id === id);
  const seq = (arr) => {
    let i = 0;
    return () => arr[i++ % arr.length];
  };
  L.setSuperRng(() => 1); // 超秘伝書は出さない
  const list = L.inheritables(find(5))
    .filter((b) => b.type === "statRoll")
    .map((b) => b.g);
  const idx = (s, g) => L.inheritables(s).findIndex((b) => b.type === "statRoll" && b.g === g);
  L.setRng(seq([0.7, 0.999999])); // 割合・最大 → 攻撃 +15%
  const e1 = L.retireSoldier(5, idx(find(5), "atk"));
  const atkBook = F.save().legendBooks.at(-1);
  L.setRng(seq([0.2, 0])); // 固定・最小 → 射程 +1
  const e2 = L.retireSoldier(6, idx(find(6), "rng"));
  const rngBook = F.save().legendBooks.at(-1);
  L.setRng(seq([0.3, 0.5])); // 固定・中央 → 最大HP +255
  const e3 = L.retireSoldier(7, idx(find(7), "hp"));
  const hpBook = F.save().legendBooks.at(-1);
  L.setRng();
  const s = find(12),
    base = a.soldierStats(s).atk;
  const use = L.equipBook(s, atkBook.uid);
  return {
    list: list.join(),
    e: [e1, e2, e3],
    atkBook,
    rngBook,
    hpBook,
    use,
    ratio: a.soldierStats(s).atk / base,
    on: (F.save().legendBooks.find((b) => b.uid === atkBook.uid) || {}).owner,
    mentor: F.save().mentors[1].skill, // 新しい順（[0] は体力の書）
    left: F.save().legendBooks.some((b) => b.uid === atkBook.uid),
    sid: s.id,
  };
});
check("どの兵士でも能力値の書4種（攻撃・防御・体力・射程）を選べる", r.list === "atk,def,hp,rng", r.list);
check(
  "引退のときに数値が決まる（攻撃 +15%・射程 +1・最大HP +255）",
  r.e.every((e) => e === null) &&
    r.atkBook.k === "atkPct" &&
    r.atkBook.v === 15 &&
    r.rngBook.k === "rngFlat" &&
    r.rngBook.v === 1 &&
    r.hpBook.k === "hpFlat" &&
    r.hpBook.v === 255,
  JSON.stringify(r),
);
check("指導員名簿に「🎯射程の書（射程 +1）」と記録", /🎯射程の書（射程 \+1）/.test(r.mentor), r.mentor);
check(
  "攻撃の書を装備すると、解放前でも攻撃 +15% が働く（書はなくならない）",
  r.use === null && Math.abs(r.ratio - 1.15) < 0.02 && r.on === r.sid && r.left,
  JSON.stringify(r),
);
if (await page.isVisible("#soldierClose")) await page.tap("#soldierClose");
await page.tap("#soldiers");
await page.tap("#tabLive");
await page.tap('[data-retire="8"]');
text = await page.textContent("#retireBody");
check(
  "引退の画面に能力値の書（数値の範囲つき）と説明",
  /⚔️攻撃の書（攻撃 \+1〜100 か \+1〜15%・引退のときに決まる）/.test(text) &&
    /🎯射程の書/.test(text) &&
    /能力値の書（攻撃・防御・体力・射程の書）も選べます/.test(text) &&
    !/終盤の解放後/.test(text),
  text,
);
const pick = await ev(() =>
  [...document.querySelectorAll("[data-retire-pick]")].findIndex((b) => /🛡️防御の書/.test(b.textContent)),
);
await page.tap(`[data-retire-pick="${pick}"]`);
await page.tap("[data-retire-go]");
check(
  "引退すると、決まった数値を知らせる",
  /🛡️防御の書（防御 \+\d+%?） を残しました/.test(await page.textContent("#msg")),
  await page.textContent("#msg"),
);
r = await ev(() => document.documentElement.scrollWidth > innerWidth);
check("375×667：横にはみ出さない（引退の画面）", !r);
await page.tap("#retireClose").catch(() => {});

console.log("■ 書の装備（1人4冊まで・付けた書は全部効く・外せる）");
r = await ev(() => {
  const L = WD_DEBUG.legendApi,
    F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    s = WD_DEBUG.state().soldiers.find((x) => x.id === 13),
    st = () => a.soldierStats(s),
    free = (pred) => F.save().legendBooks.filter((b) => b.owner == null && pred(b)),
    base = st();
  const rng = free((b) => b.k === "rngFlat")[0],
    hp = free((b) => b.k === "hpFlat")[0],
    def = free((b) => b.k === "defFlat" || b.k === "defPct")[0],
    chains = free((b) => b.k === "chain");
  const errs = [rng, hp, def, chains[0]].map((b) => L.equipBook(s, b.uid));
  const full = st(),
    fifth = L.equipBook(s, chains[1].uid),
    off = L.unequipBook(hp.uid),
    afterOff = st(),
    again = L.equipBook(s, chains[1].uid);
  return {
    errs,
    n: L.booksOf(13).length,
    range: full.range - base.range,
    hp: full.maxHp - base.maxHp,
    def: full.def > base.def,
    fifth,
    off,
    hpBack: afterOff.maxHp - base.maxHp,
    hpOwner: F.save().legendBooks.find((b) => b.uid === hp.uid).owner,
    again,
    chain: a.skillSum(s, "chain"),
    chainWant: chains[0].v + chains[1].v,
    hpUid: hp.uid,
  };
});
check(
  "能力値の書3冊＋特殊能力の書1冊を装備できる（4冊）",
  r.errs.every((e) => e === null) && r.n === 4,
  JSON.stringify(r),
);
check(
  "付けた書は全部効く（射程 +1・最大HP +255・防御）",
  Math.abs(r.range - 1) < 1e-6 && r.hp === 255 && r.def,
  JSON.stringify(r),
);
check("5冊目は装備できない（1人4冊まで）", /4冊まで/.test(r.fifth || ""), r.fifth);
check(
  "外すと効果がなくなり、倉庫に戻る",
  r.off === null && r.hpBack === 0 && r.hpOwner === undefined,
  JSON.stringify(r),
);
check(
  "同じ特殊能力の書を2冊付けると足し算（連鎖雷撃）",
  r.again === null && Math.abs(r.chain - r.chainWant) < 1e-9,
  JSON.stringify(r),
);
r = await ev((uid) => {
  const L = WD_DEBUG.legendApi;
  L.setSuperRng(() => 1);
  const e1 = L.equipBook(
    WD_DEBUG.state().soldiers.find((x) => x.id === 9),
    uid,
  );
  const e2 = L.retireSoldier(9, 0);
  L.setSuperRng();
  return { e1, e2, owner: WD_DEBUG.forgeApi.save().legendBooks.find((b) => b.uid === uid).owner };
}, r.hpUid);
check(
  "装備していた兵士が引退すると、書は倉庫に戻る",
  r.e1 === null && r.e2 === null && r.owner === undefined,
  JSON.stringify(r),
);
if (await page.isVisible("#soldierClose")) await page.tap("#soldierClose");
await page.tap("#soldiers");
await page.tap("#tabLive");
text = await ev(
  () =>
    [...document.querySelectorAll(".s-card")].find((c) => c.querySelector('[data-gear-open="13"]'))
      .textContent,
);
check(
  "名簿の札に「装備している書（4/4・全部効く）」",
  /装備している書（4\/4・全部効く）/.test(text),
  text.slice(0, 300),
);
await page.tap('[data-gear-open="13"]');
text = await page.textContent("#gearBody");
r = await ev(() => ({
  off: document.querySelectorAll("#gearBody [data-lbook-off]").length,
  on: [...document.querySelectorAll("#gearBody [data-lbook-on]")].map((b) => b.disabled),
  h: document.documentElement.scrollWidth > innerWidth,
}));
check(
  "兵士の装備の画面に「📚 書（4/4）」・外すボタン・倉庫の書（満杯なので押せない）",
  /📚 書（4\/4）/.test(text) && r.off === 4 && r.on.length > 0 && r.on.every(Boolean) && !r.h,
  JSON.stringify(r),
);
await page.tap("#gearBody [data-lbook-off]");
r = await ev(() => ({
  n: WD_DEBUG.legendApi.booksOf(13).length,
  text: document.getElementById("gearBody").textContent,
}));
check(
  "画面から外せる（3/4 になる）",
  r.n === 3 && /外して倉庫に戻しました/.test(r.text) && /📚 書（3\/4）/.test(r.text),
  r.text.slice(0, 200),
);
await page.tap("#gearBody [data-lbook-on]:not([disabled])");
r = await ev(() => WD_DEBUG.legendApi.booksOf(13).length);
check("画面から装備できる（4/4 に戻る）", r === 4, String(r));
await page.tap("#gearClose");
if (await page.isVisible("#soldierClose")) await page.tap("#soldierClose");
await page.tap("#gearOpen");
await page.tap('[data-gear-tab="books"]');
text = await page.textContent("#gearBody");
check(
  "倉庫の一覧：装備中の書は「🎖 装備中」と「外す」、説明に「なくなりません」「1人4冊まで」",
  /🎖 装備中/.test(text) && /なくなりません/.test(text) && /1人4冊まで/.test(text),
  text.slice(0, 300),
);
await page.tap("#gearClose");
await reload();
r = await ev(() => WD_DEBUG.legendApi.booksOf(13).length);
check("再読み込みしても装備したまま", r === 4, String(r));

console.log("■ 保存と再読み込み");
await reload();
r = await ev(() =>
  WD_DEBUG.forgeApi
    .save()
    .legendBooks.filter((b) => b.super)
    .map((b) => b.k + ":" + b.super),
);
check(
  "再読み込みしても超秘伝書（印つき）が残る",
  r.sort().join() === "beam:true,beam:true,chain:true,chain:true",
  r.join(),
);
await ev(() => {
  window.__set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).startsWith("worldDefense.")) throw new Error("QuotaExceededError");
    return window.__set.call(this, k, v);
  };
});
r = await ev(() => {
  const L = WD_DEBUG.legendApi;
  L.setSuperRng(() => 0);
  const before = WD_DEBUG.forgeApi.save().legendBooks.length;
  const err = L.retireSoldier(4, 0);
  return {
    err,
    before,
    after: WD_DEBUG.forgeApi.save().legendBooks.length,
    alive: WD_DEBUG.state().soldiers.some((s) => s.id === 4),
  };
});
check(
  "保存に失敗したら引退も超秘伝書も取り消す（増えない）",
  /保存できなかった/.test(r.err || "") && r.before === r.after && r.alive,
  JSON.stringify(r),
);
await ev(() => (Storage.prototype.setItem = window.__set));
check("エラーなし", errors.length === 0, errors.join(" / "));

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
