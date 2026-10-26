#!/usr/bin/env node
// 戦国図鑑（武将・スキル・アイテム・職業）の確認：初めて手に入れた・習得した・就いたときの登録、重複で増えない、
// 錬成・売却・戦死・「最初から」・読み込み直しでも残る、以前の保存データからの移行（推測では登録しない）、未発見の情報を出さない、画面
//   node tools/test-zukan.mjs
//   SCREENSHOTS=dir node tools/test-zukan.mjs … 画面写真も保存
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
const SKEY = "worldDefense.soldiers.v1",
  WKEY = "worldDefense.warlords.v1",
  ZKEY = "worldDefense.zukan.v1";
// 以前の保存データ（図鑑なし）
//   武将：信長2枚・幸村1枚を所持。官兵衛はガチャ履歴だけ（持っていた記録あり）。謙信は錬成で使った記録（used）だけ → 推測では登録しない
//   装備：蜻蛉切を所持。当世具足は錬成の履歴だけ（売った）。白虎の雷鎧は初回報酬の記録あり。「剛力」の書は持っているが未習得
//   兵士：#1 槍兵 → 侍に転職（転職履歴）・居合斬り・鉄壁を習得。英霊名鑑に弓兵（スキル：遠矢）
const oldWarlords = {
  version: 1,
  owned: { nobunaga: 2, yukimura: 1 },
  tickets: 3,
  history: [{ id: "kanbei", isNew: true }],
  forge: {
    items: [{ uid: 1, id: "tonbokiri", owner: null }],
    seq: 1,
    history: [{ w: "kanbei", kind: "gear", tier: "hit", got: "tosei" }],
    books: { goriki: 1 },
    used: { kenshin: 3 },
    bossRewards: { hiei: true },
  },
};
const oldSoldiers = { version: 1, seq: 20, squadSeq: 2, squads: [], soldiers: [], fallen: [] };
oldSoldiers.squads.push({ id: 1, type: "spearman", slot: 0 }, { id: 2, type: "archer", slot: 1 });
for (let k = 0; k < 10; k++)
  oldSoldiers.soldiers.push({
    id: k + 1,
    type: k === 0 ? "ashigaru" : "spearman",
    job: k === 0 ? "samurai" : "spearman",
    jobs: k === 0 ? ["spearman", "samurai"] : ["spearman"],
    jobHist: k === 0 ? [{ from: "spearman", to: "samurai", lv: 30 }] : [],
    squadId: 1,
    level: k === 0 ? 30 : 4,
    name: k === 0 ? "鬼若" : null,
    skills: k === 0 ? ["iai", "ironWall"] : [],
    learned: k === 0 ? ["iai", "ironWall"] : [],
  });
for (let k = 0; k < 10; k++)
  oldSoldiers.soldiers.push({ id: 11 + k, type: "archer", squadId: 2, level: 4, skills: [] });
oldSoldiers.fallen.push({
  id: 99,
  name: "弥助",
  type: "gunner",
  level: 12,
  skills: ["longShot"],
  kills: 3,
  battles: 4,
});

async function newContext(extra = {}, width = 390, height = 844) {
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
  const seeds = Object.assign(
    { [SKEY]: JSON.stringify(oldSoldiers), [WKEY]: JSON.stringify(oldWarlords) },
    extra,
  );
  await page.evaluate((seeds) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
  }, seeds);
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
  return { page, errors, context };
}
async function reload(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.WD_DEBUG);
}
const Z = (page) => page.evaluate(() => WD_DEBUG.forgeApi.zukan());
const counts = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ["warlords", "skills", "items", "jobs"].map((c) => [c, WD_DEBUG.forgeApi.zukanCount(c)]),
    ),
  );
const keys = (o) => Object.keys(o).sort().join();

let { page, errors, context } = await newContext();

console.log("■ 図鑑の数");
let r = await counts(page);
check(
  "武将30・スキル85（未実装の「城攻め名人」は入れない）・アイテム35・職業14（v49で騎馬の上級職4つと職業スキル4つを追加）",
  r.warlords.total === 30 && r.skills.total === 85 && r.items.total === 35 && r.jobs.total === 14,
  JSON.stringify(r),
);

console.log("■ 以前の保存データからの移行");
let z = await Z(page);
check(
  "武将：所持（信長・幸村）とガチャ履歴（官兵衛）を登録",
  keys(z.warlords) === "kanbei,nobunaga,yukimura",
  keys(z.warlords),
);
check("錬成で使った記録しかない武将（謙信）は推測で登録しない", !z.warlords.kenshin);
check(
  "アイテム：所持（蜻蛉切）・錬成の履歴（当世具足）・裏ボスの初回報酬（白虎の雷鎧）",
  keys(z.items) === "byakkoArmor,tonbokiri,tosei",
  keys(z.items),
);
check(
  "スキル：習得したもの（居合斬り・鉄壁）と英霊名鑑の記録（遠矢）。持っているだけの書（剛力）は未習得なので登録しない",
  keys(z.skills) === "iai,ironWall,longShot",
  keys(z.skills),
);
check(
  "職業：今の職業・転職履歴・初期職（槍兵・侍・弓兵）と英霊名鑑（鉄砲兵）",
  keys(z.jobs) === "archer,gunner,samurai,spearman",
  keys(z.jobs),
);
r = await counts(page);
check(
  "武将の必殺技は武将を手に入れたら発見（3人分＋スキル3 = 6）",
  r.skills.found === 6,
  JSON.stringify(r.skills),
);
check("図鑑を保存", !!(await page.evaluate((k) => localStorage.getItem(k), ZKEY)));

console.log("■ 初めて手に入れたとき・重複");
r = await page.evaluate(() => {
  const H = WD_DEBUG.heroApi,
    F = WD_DEBUG.forgeApi;
  H.grantTickets(2, "試験");
  let n = 0;
  const a = H.pullGacha(() => (n++ === 0 ? 0.01 : 0.2)); // SSR の2番目（武田信玄）
  const c1 = F.zukanCount("warlords").found;
  n = 0;
  const b = H.pullGacha(() => (n++ === 0 ? 0.01 : 0.2)); // もう一度同じ武将
  const c2 = F.zukanCount("warlords").found;
  return { a: a.id, b: b.id, c1, c2, skills: F.zukanCount("skills").found, z: F.zukan().warlords };
});
check(
  "ガチャで初めての武将を引くと登録（必殺技も発見）",
  r.a === "shingen" && r.c1 === 4 && r.skills === 7 && r.z.shingen,
  JSON.stringify(r),
);
check("同じ武将を重ねて引いても発見数は増えない", r.b === "shingen" && r.c2 === 4, JSON.stringify(r));
r = await page.evaluate(() => {
  // 錬成で装備を手に入れる → 売る。武将カードを使っても武将の登録は残る
  const F = WD_DEBUG.forgeApi;
  let n = 0;
  const res = F.forge("nobunaga", "gear", () => (n++ === 0 ? 0.3 : 0)); // 普通（良）の先頭
  const got = res.gear,
    reg = F.zukan().items[got];
  const it = F.save().items.find((x) => x.uid === res.uid);
  const sold = F.sellItems([it.uid]);
  return {
    got,
    reg,
    sold: !sold.error,
    after: F.zukan().items[got],
    nobu: F.zukan().warlords.nobunaga,
    owned: F.owned().nobunaga,
  };
});
check("錬成で手に入れた装備を登録", r.reg === true, JSON.stringify(r));
check("売っても登録は残る", r.sold && r.after === true, JSON.stringify(r));
check("武将カードを錬成で使っても武将の登録は残る", r.nobu === true && r.owned === 1, JSON.stringify(r));
r = await page.evaluate(() => {
  // スキルの書で習得・レベルアップで習得・転職・雇用
  const F = WD_DEBUG.forgeApi,
    a = WD_DEBUG.squadApi,
    J = WD_DEBUG.jobApi,
    S = WD_DEBUG.state().soldiers,
    s1 = S[0],
    s5 = S[4];
  const out = {};
  out.book = F.useBook(s1, "goriki") === null && F.zukan().skills.goriki === true;
  const before = Object.keys(F.zukan().skills).length;
  a.setSkillRng(() => 0);
  for (let i = 0; i < 50 && s5.level < 5; i++) a.gainXp(s5, 200, true);
  a.setSkillRng();
  const learned = s5.learned.filter((id) => !a.SOLDIER_SKILLS[id].job);
  out.lv =
    learned.length > 0 &&
    learned.every((id) => F.zukan().skills[id]) &&
    Object.keys(F.zukan().skills).length > before;
  for (let i = 0; i < 200 && s5.level < 30; i++) a.gainXp(s5, 2000, true);
  out.job =
    J.changeJob(s5, "ninja") === null && F.zukan().jobs.ninja === true && F.zukan().jobs.cavalry !== true;
  // 熟練度で職業スキル（影走り）
  for (let i = 0; i < 400 && J.profLv(s5) < 3; i++) a.gainXp(s5, 50, true);
  out.jobSkill = F.zukan().skills.shadowRun === true;
  return out;
});
check("スキルの書で習得したら登録", r.book, JSON.stringify(r));
check("レベルアップで習得したら登録", r.lv, JSON.stringify(r));
check("転職したら職業を登録（ほかの職業は増えない）", r.job, JSON.stringify(r));
check("熟練度で習得した職業スキルを登録", r.jobSkill, JSON.stringify(r));
r = await page.evaluate(() => {
  // 新しい兵種を雇うと、その職業を登録
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    q = S.squads[1];
  WD_DEBUG.setGold(9999);
  // 第二部隊は満員なので、1人を新しい部隊へ移して空きを作り、衛生兵を補充する
  a.transferSoldier(a.roster(q)[0].id, "new");
  const e = a.recruitInto(q, "medic");
  return { e, medic: WD_DEBUG.forgeApi.zukan().jobs.medic };
});
check("衛生兵を雇うと初期職（衛生兵）を登録", r.medic === true, JSON.stringify(r));

console.log("■ 戦死・「最初から」・読み込み直し");
r = await page.evaluate(() => {
  const a = WD_DEBUG.squadApi,
    S = WD_DEBUG.state(),
    s = S.soldiers[0],
    q = S.squads[0];
  a.deployReserve(q, 650, 300);
  document.getElementById("start").click();
  WD_DEBUG.stopSpawning();
  S.enemies.length = 0;
  WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  q.frontId = s.id;
  s.skills = s.skills.filter((x) => x !== "unyielding");
  s.hp = 0.1;
  a.damageSquad(q, 99999, false);
  S.enemies.length = 0;
  WD_DEBUG.step(0.1);
  const z = WD_DEBUG.forgeApi.zukan();
  return { alive: s.alive, samurai: z.jobs.samurai, iai: z.skills.iai };
});
check(
  "兵士が戦死しても、その兵士の職業・スキルの登録は残る",
  !r.alive && r.samurai && r.iai,
  JSON.stringify(r),
);
const before = await Z(page);
await page.evaluate(() => document.getElementById("reset").click());
z = await Z(page);
check("「最初から」でも登録は残る", JSON.stringify(z) === JSON.stringify(before));
await reload(page);
z = await Z(page);
check(
  "読み込み直しても登録は残る",
  keys(z.warlords) === keys(before.warlords) &&
    keys(z.items) === keys(before.items) &&
    keys(z.skills) === keys(before.skills) &&
    keys(z.jobs) === keys(before.jobs),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 図鑑の画面（375×667）");
({ page, errors, context } = await newContext({}, 375, 667));
await page.tap("#zukanOpen");
let text = await page.textContent("#zukanBody");
r = await counts(page);
const total = r.warlords.found + r.skills.found + r.items.found + r.jobs.found;
check(
  "総合の発見数と達成率（ネームド兵士を含む179）・タブと発見数",
  new RegExp("総合 " + total + "/179（" + Math.floor((total / 179) * 100) + "%）").test(text) &&
    /武将3\/30/.test(text.replace(/\s/g, "")) &&
    /スキル6\/85/.test(text.replace(/\s/g, "")) &&
    /アイテム3\/35/.test(text.replace(/\s/g, "")) &&
    /職業4\/14/.test(text.replace(/\s/g, "")),
  text.slice(0, 200),
);
check("進み具合のバー", (await page.$$("#zukanBody .zk-bar")).length === 2);
r = await page.evaluate(() => ({
  tiles: document.querySelectorAll(".zk-tile").length,
  locked: document.querySelectorAll(".zk-tile.lock").length,
  nos:
    /No\.001/.test(document.getElementById("zukanBody").textContent) &&
    /No\.030/.test(document.getElementById("zukanBody").textContent),
  hidden: !/上杉謙信|毛利元就|前田慶次/.test(document.getElementById("zukanBody").innerHTML),
  q: (document.getElementById("zukanBody").textContent.match(/\?\?\?/g) || []).length,
}));
check(
  "武将図鑑：30人ぶんの番号・未発見は「???」（27人）",
  r.tiles === 30 && r.locked === 27 && r.q === 27 && r.nos,
  JSON.stringify(r),
);
check("未発見の武将の名前はページに出さない", r.hidden);
await page.tap('[data-zk-no="17"]').catch(() => {});
await page.tap('[data-zk-no="16"]');
text = await page.textContent("#zkDetail");
check(
  "所持していない（ガチャ履歴だけの）武将も詳細を出す（名前・レア度・必殺技・部隊・塔・所持していない）",
  /黒田官兵衛/.test(text) &&
    /R/.test(text) &&
    /必殺技「軍略・集中砲火」/.test(text) &&
    /部隊/.test(text) &&
    /塔/.test(text) &&
    /今は所持していない/.test(text),
  text,
);
await page.tap('[data-zk-no="0"]');
text = await page.textContent("#zkDetail");
check(
  "武将の詳細：画像・所持枚数と★",
  (await page.$$("#zkDetail .avatar")).length === 1 && /所持 2枚・★2/.test(text),
  text,
);
if (shots) await page.screenshot({ path: path.join(shots, "z1-warlord.png") });
await page.tap('[data-zk-tab="skills"]');
r = await page.evaluate(() => ({
  groups: [...document.querySelectorAll(".zk-group")].map((h) => h.textContent).join("|"),
  tiles: document.querySelectorAll(".zk-tile").length,
  noFuture: !/城攻め名人/.test(document.getElementById("zukanBody").innerHTML),
  hidden: !/影走り|天下無双|一騎当千/.test(document.getElementById("zukanBody").innerHTML),
}));
check(
  "スキル図鑑：武将の必殺技・兵士のスキル・固有・職業・秘伝に分ける（85）",
  r.groups === "武将の必殺技|兵士のスキル|固有スキル（Lv30）|職業スキル|秘伝スキル（スキルの書）" &&
    r.tiles === 85,
  JSON.stringify(r),
);
check("未実装のスキルは出さない・未習得の名前も出さない", r.noFuture && r.hidden);
const iaiNo = await page.evaluate(() => {
  const b = [...document.querySelectorAll(".zk-tile")].find((t) => /居合斬り/.test(t.textContent));
  return b && b.dataset.zkNo;
});
await page.tap(`[data-zk-no="${iaiNo}"]`);
text = await page.textContent("#zkDetail");
check(
  "習得したスキルの詳細（効果・習得の条件）",
  /居合斬り/.test(text) && /職業スキル/.test(text) && /侍の熟練度 3/.test(text),
  text,
);
await page.tap('[data-zk-tab="items"]');
r = await page.evaluate(() => ({
  tiles: document.querySelectorAll(".zk-tile").length,
  locked: document.querySelectorAll(".zk-tile.lock").length,
  hidden: !/妖刀・村正|天魔機神の神鎧|不死鳥/.test(document.getElementById("zukanBody").innerHTML),
}));
check(
  "アイテム図鑑：35品・未発見は「???」で名前を出さない",
  r.tiles === 35 && r.locked === 32 && r.hidden,
  JSON.stringify(r),
);
const bNo = await page.evaluate(
  () => [...document.querySelectorAll(".zk-tile")].find((t) => /白虎の雷鎧/.test(t.textContent)).dataset.zkNo,
);
await page.tap(`[data-zk-no="${bNo}"]`);
text = await page.textContent("#zkDetail");
check(
  "裏ボスの報酬：品質・性能・入手方法（秘境の裏ボスを初めて倒す）",
  /白虎の雷鎧/.test(text) &&
    /伝説/.test(text) &&
    /雷撃/.test(text) &&
    /秘境の裏ボスを初めて倒す（比叡山の封印）/.test(text),
  text,
);
const tNo = await page.evaluate(
  () => [...document.querySelectorAll(".zk-tile")].find((t) => /当世具足/.test(t.textContent)).dataset.zkNo,
);
await page.tap(`[data-zk-no="${tNo}"]`);
text = await page.textContent("#zkDetail");
check(
  "売った装備も詳細を出す（入手方法：装備錬成・倉庫に0個）",
  /当世具足/.test(text) && /装備錬成（当たり）/.test(text) && /倉庫に 0個/.test(text),
  text,
);
await page.tap('[data-zk-tab="jobs"]');
r = await page.evaluate(() => ({
  tiles: document.querySelectorAll(".zk-tile").length,
  locked: document.querySelectorAll(".zk-tile.lock").length,
  hidden: !/剣豪|僧兵|忍者/.test(document.getElementById("zukanBody").innerHTML),
}));
check(
  "職業図鑑：14職業・未経験は「???」で名前を出さない",
  r.tiles === 14 && r.locked === 10 && r.hidden,
  JSON.stringify(r),
);
await page.tap('[data-zk-no="6"]');
text = await page.textContent("#zkDetail");
check(
  "職業の詳細：特徴・能力・装備できる武器・職業スキル・熟練度",
  /侍/.test(text) &&
    /攻撃\+15%/.test(text) &&
    /足軽の動き/.test(text) &&
    /装備できる武器：刀/.test(text) &&
    /居合斬り」熟練度3/.test(text) &&
    /最高の熟練度/.test(text),
  text,
);
if (shots) await page.screenshot({ path: path.join(shots, "z2-job.png") });
r = await page.evaluate(() => {
  const sh = document.querySelector("#zukanSheet .sheet"),
    rr = sh.getBoundingClientRect(),
    btns = [...sh.querySelectorAll("button")].filter((b) => b.getClientRects().length);
  return {
    inView: rr.top >= 0 && rr.bottom <= innerHeight + 0.5,
    hScroll: document.documentElement.scrollWidth > innerWidth,
    wide: btns.every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5),
    minBtn: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
  };
});
check(
  "375×667：画面に収まる・横にはみ出さない・ボタンは44px以上",
  r.inView && !r.hScroll && r.wide && r.minBtn >= 44,
  JSON.stringify(r),
);
await page.keyboard.press("Escape");
check("Escで閉じる", await page.isHidden("#zukanSheet"));
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 画面（390×844）・新しいゲーム");
({ page, errors, context } = await newContext(
  {
    [SKEY]: JSON.stringify({ version: 1, seq: 0, squadSeq: 0, squads: [], soldiers: [], fallen: [] }),
    [WKEY]: JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [] }),
  },
  390,
  844,
));
r = await counts(page);
check(
  "何も持っていない新しいゲームは 0/179（ネームド兵士15・騎馬の上級職を含む）",
  r.warlords.found + r.skills.found + r.items.found + r.jobs.found === 0,
  JSON.stringify(r),
);
await page.tap("#zukanOpen");
r = await page.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > innerWidth,
  text: document.getElementById("zukanBody").textContent,
}));
check(
  "390×844：横にはみ出さない・総合 0/179（0%）",
  !r.hScroll && /総合 0\/179（0%）/.test(r.text),
  r.text.slice(0, 80),
);
await page.tap("#zukanClose");
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
