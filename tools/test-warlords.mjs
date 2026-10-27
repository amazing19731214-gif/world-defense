#!/usr/bin/env node
import { openInfoEntry } from './ui-test-utils.mjs';
// 戦国武将ガチャと、武将の配属（塔・兵士部隊）の動作確認（Playwright / Chromium・iPhone相当の画面幅）
//   node tools/test-warlords.mjs
//   SCREENSHOTS=dir node tools/test-warlords.mjs … 画面写真も保存
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
const KEY = "worldDefense.warlords.v1";

let failures = 0,
  passes = 0;
// 雇用ボタンは「＋ 雇う」の中（畳まれていれば開いてから押す）
// Combat fixture: choose a known unit type through debug setup, not the removed recruitment UI.
async function tapHire(page, type) {
  await page.evaluate(type => WD_DEBUG.squadApi.selectUnitForFixture(type), type);
}
function check(name, cond, detail = "") {
  if (cond) passes++;
  else failures++;
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond || !detail ? "" : "  → " + detail));
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
// seed：保存データ（文字列）。null なら何も入れない（初めて遊ぶ状態）
async function newPage(seed = null, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  if (seed !== null)
    await context.addInitScript(
      ([k, v]) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem(k, v);
          sessionStorage.setItem("seeded", "1");
        }
      },
      [KEY, seed],
    );
  if (opts.noStorage)
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("denied");
        },
      });
    });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
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
const save = (page) => page.evaluate(() => JSON.parse(JSON.stringify(WD_DEBUG.heroApi.save())));
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);
const H = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const [id, h] of Object.entries(WD_DEBUG.heroApi.heroState()))
      out[id] = { tower: h.tower && h.tower.id, squad: h.squad && h.squad.id, active: h.active, cd: h.cd };
    return out;
  });
const step = (page, sec) => page.evaluate((s) => WD_DEBUG.step(s), sec);
async function startHeldWave(page) {
  await page.evaluate(() => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e9, speed: 0, holder: true });
  });
}
const deselect = async (page) => {
  for (const id of ["#tpClose", "#sqClose"]) if (await page.isVisible(id)) await page.tap(id);
};
const soldiersOf = (page, qid) =>
  page.evaluate((qid) => {
    const s = WD_DEBUG.state(),
      api = WD_DEBUG.squadApi,
      q = s.squads.find((q) => q.id === qid);
    return q ? api.members(q).map((m) => ({ id: m.id, hp: m.hp, ...api.soldierStats(m) })) : [];
  }, qid);
const M1 = [650, 300],
  M2 = [740, 300];

console.log("■ 初めて遊ぶとき");
let { page, errors, context } = await newPage();
let sv = await save(page);
check("所持武将は0人（武将はガチャでのみ獲得）", Object.keys(sv.owned).length === 0);
check("初回だけガチャ券3枚を配布", sv.tickets === 3);
check("ガチャボタンに券の枚数", /ガチャ\(3\)/.test(await page.textContent("#gacha")));
await openInfoEntry(page, '#roster');
check(
  "武将一覧：未所持なら案内とガチャへのボタン",
  /まだ武将がいません/.test(await page.textContent("#sheetHint")) &&
    (await page.isVisible("[data-open-gacha]")),
);
await page.tap("[data-open-gacha]");
check("武将一覧からガチャ画面へ", await page.isVisible("#gachaSheet"));

console.log("■ ガチャ（確定してから保存）");
check("排出率を表示", /SSR 6%・SR 30%・R 64%/.test(await page.textContent("#gachaRates")));
await page.tap("#gachaPull");
sv = await save(page);
let ls = await stored(page);
const first = sv.history[0];
check(
  "1回引くと券が1枚減り、武将を1人獲得",
  sv.tickets === 2 && Object.keys(sv.owned).length === 1 && first && sv.owned[first.id] === 1,
);
check(
  "結果は表示と同時に保存済み（券・所持・履歴）",
  ls.tickets === 2 && ls.owned[first.id] === 1 && ls.history[0].id === first.id,
);
check("結果カード（レア度・名前・NEW）", /NEW!/.test(await page.textContent("#gachaResult")));
{
  // ガチャ画面には、今引いた1人以外の武将名を出さない（全体の人数だけ）
  const g = await page.evaluate(() => {
    const { WARLORDS } = WD_DEBUG.config,
      text = document.getElementById("gachaSheet").textContent,
      pulled = WD_DEBUG.heroApi.save().history[0].id;
    return {
      others: Object.entries(WARLORDS)
        .filter(([id, w]) => id !== pulled && text.includes(w.name))
        .map(([, w]) => w.name),
      total: /登場する武将は全30人（所持 1人）/.test(text),
      recent: text.includes("最近の結果"),
    };
  });
  check(
    "ガチャ画面に他の武将名・最近の結果を出さない",
    g.others.length === 0 && !g.recent,
    JSON.stringify(g),
  );
  check("ガチャ画面に「全30人・所持数」だけ表示", g.total);
}
if (shots) await page.screenshot({ path: path.join(shots, "w1-gacha.png") });
await page.reload();
await page.waitForFunction(() => window.WD_DEBUG);
sv = await save(page);
check(
  "再読み込みしても結果は変わらない（引き直し不可・券は戻らない）",
  sv.tickets === 2 && sv.owned[first.id] === 1 && sv.history.length === 1,
);
check("再読み込みで初回の券を再配布しない", sv.tickets === 2);
await page.tap("#gacha");
await page.tap("#gachaPull");
await page.tap("#gachaPull");
sv = await save(page);
check("券がなくなるまで引ける", sv.tickets === 0 && sv.history.length === 3);
check("券0枚では引けない（ボタン無効）", await page.isDisabled("#gachaPull"));
check("券0枚の pullGacha はエラー", !!(await page.evaluate(() => WD_DEBUG.heroApi.pullGacha().error)));
await page.tap("#gachaClose");
await context.close();

console.log("■ 排出率・武将データ");
({ page, errors, context } = await newPage());
const rates = await page.evaluate(() => {
  const { GACHA, WARLORDS } = WD_DEBUG.config,
    api = WD_DEBUG.heroApi;
  const seq = (vals) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };
  const counts = { SSR: 0, SR: 0, R: 0 };
  const N = 20000;
  for (let i = 0; i < N; i++) counts[WARLORDS[api.rollWarlord(Math.random)].rarity]++;
  return {
    sum: Object.values(GACHA.rates).reduce((a, b) => a + b, 0),
    det: [
      WARLORDS[api.rollWarlord(seq([0.01, 0]))].rarity,
      WARLORDS[api.rollWarlord(seq([0.2, 0]))].rarity,
      WARLORDS[api.rollWarlord(seq([0.9, 0]))].rarity,
    ],
    freq: { SSR: counts.SSR / N, SR: counts.SR / N, R: counts.R / N },
    names: Object.values(WARLORDS).map((w) => w.name),
    allHaveSkill: Object.values(WARLORDS).every((w) => w.skill && w.skill.name && w.skill.cooldown > 0),
    skillNames: new Set(Object.values(WARLORDS).map((w) => w.skill.name)).size,
  };
});
check("排出率の合計が1", near(rates.sum, 1, 1e-9));
check("乱数に応じた抽選（SSR / SR / R）", rates.det.join() === "SSR,SR,R", rates.det.join());
check(
  "2万回の抽選で設定どおりの割合（SSR 6%・SR 30%・R 64%）",
  near(rates.freq.SSR, 0.06, 0.01) && near(rates.freq.SR, 0.3, 0.015) && near(rates.freq.R, 0.64, 0.015),
  JSON.stringify(rates.freq),
);
check(
  "実在の戦国武将（信長・信玄・謙信・幸村・兼続を含む）",
  ["織田信長", "武田信玄", "上杉謙信", "真田幸村", "直江兼続"].every((n) => rates.names.includes(n)),
);
check("武将ごとに異なる必殺技", rates.allHaveSkill && rates.skillNames === rates.names.length);

console.log("■ 重複（★）");
const dup = await page.evaluate(() => {
  const api = WD_DEBUG.heroApi,
    seq = [0.01, 0, 0.01, 0];
  let i = 0;
  const rng = () => seq[i++];
  const a = api.pullGacha(rng),
    b = api.pullGacha(rng);
  return { a, b };
});
check(
  "同じ武将を引くと★が増える（NEWではない）",
  dup.a.isNew && !dup.b.isNew && dup.b.stars === 2 && dup.a.id === dup.b.id,
);
await context.close();

console.log("■ ガチャ券の獲得（ウェーブクリア・ボス撃破）");
({ page, errors, context } = await newPage(JSON.stringify({ owned: {}, tickets: 0, history: [] })));
const playWave = async (boss) => {
  await page.evaluate((boss) => {
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    WD_DEBUG.state().enemies.length = 0;
    if (boss) WD_DEBUG.addEnemy({ kind: "boss", d: 600, hp: 1, reward: 150, speed: 0 });
  }, boss);
  await step(page, boss ? 2 : 0.2);
};
await playWave(false);
check("1ウェーブ目のクリアでは券なし（2ウェーブごと）", (await save(page)).tickets === 0);
await playWave(false);
check(
  "2ウェーブ目のクリアで券 +1（保存済み）",
  (await save(page)).tickets === 1 && (await stored(page)).tickets === 1,
);
await page.evaluate(() => WD_DEBUG.setGold(5000));
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225);
await playWave(true);
const t3 = (await save(page)).tickets;
check("ボス撃破で券 +1（3ウェーブ目はクリア分なし）", t3 === 2, String(t3));
await step(page, 2);
check("同じ撃破・クリアで二重に配らない", (await save(page)).tickets === 2);
await context.close();

console.log("■ 保存データの破損・保存できない環境");
({ page, errors, context } = await newPage("{{{broken"));
sv = await save(page);
check("壊れた保存データでも起動（所持なし）", errors.length === 0 && Object.keys(sv.owned).length === 0);
check("壊れた保存データで初回の券を配らない（券の水増し防止）", sv.tickets === 0);
await context.close();
({ page, errors, context } = await newPage(null, { noStorage: true }));
await page.tap("#gacha");
await page.tap("#gachaPull");
check(
  "localStorage が使えなくても引ける（保存できない旨を表示）",
  errors.length === 0 && /保存できませんでした/.test(await page.textContent("#gachaResult")),
);
await context.close();

console.log("■ 武将を兵士部隊に配属");
const OWN = JSON.stringify({
  owned: { yukimura: 1, kanetsugu: 1, kenshin: 1, nobunaga: 2, shingen: 1 },
  tickets: 0,
  history: [],
});
({ page, errors, context } = await newPage(OWN));
await page.evaluate(() => WD_DEBUG.setGold(9000));
await tapHire(page, "ashigaru");
await tapMap(page, ...M1);
const base = (await soldiersOf(page, 1))[0];
await tapMap(page, 650, 280);
await page.tap("#sqHero");
check(
  "部隊パネルの中に武将の選択欄が開く（別の画面を開かない）",
  (await page.isVisible("#sqHeroPick")) &&
    !(await page.isVisible("#heroSheet")) &&
    /第一部隊/.test(await page.textContent("#sqTitle")),
);
check(
  "未配属の武将には「配属」ボタン",
  /配属/.test(await page.textContent('#sqHeroPick [data-pick-hero="yukimura"]')),
);
await page.tap('#sqHeroPick [data-pick-hero="yukimura"]');
let hs = await H(page);
check("真田幸村を足軽隊#1に配属", hs.yukimura.squad === 1 && hs.yukimura.tower === null);
const withY = (await soldiersOf(page, 1))[0];
check(
  "幸村の配属で最大HP+30%・防御+20%、現在HPは増やさない",
  near(withY.atk, base.atk) && near(withY.def, base.def * 1.2) && withY.maxHp === Math.round(base.maxHp * 1.3) && withY.hp === base.hp,
);
check("部隊パネルに武将名", /真田幸村/.test(await page.textContent("#sqHeroLine")));
check("必殺技ボタンを部隊パネルに表示", await page.isVisible("#sqSkill"));
if (shots) await page.screenshot({ path: path.join(shots, "w2-squad-hero.png"), fullPage: true });
// 塔へ移すと部隊からは外れる（同時に2か所へは配属できない）
await deselect(page);
await page.tap('[data-t="arrow"]');
await tapMap(page, 650, 225);
await tapMap(page, 650, 225);
await page.tap("#assign");
check(
  "部隊に配属中の武将は、塔の選択欄では「移す」",
  /移す/.test(await page.textContent('#tpHeroPick [data-pick-hero="yukimura"]')),
);
await page.tap('#tpHeroPick [data-pick-hero="yukimura"]');
hs = await H(page);
check(
  "同じ武将を塔へ配属すると部隊からは外れる（1か所だけ）",
  hs.yukimura.tower === 1 && hs.yukimura.squad === null,
);
check("部隊の兵士の能力は元に戻る", near((await soldiersOf(page, 1))[0].def, base.def));
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  WD_DEBUG.heroApi.assignHero("yukimura", s.squads[0]);
});
check("部隊へ戻すと塔の武将は外れる", (await H(page)).yukimura.tower === null);

console.log("■ 部隊での必殺技・再使用待ち");
await startHeldWave(page);
await deselect(page);
await tapMap(page, 650, 280);
check("ウェーブ中は部隊の必殺技を使える", !(await page.isDisabled("#sqSkill")));
await page.tap("#sqSkill");
hs = await H(page);
const sk = (await soldiersOf(page, 1))[0];
check("日本一の兵：効果8秒・再使用40秒", near(hs.yukimura.active, 8, 0.2) && near(hs.yukimura.cd, 40, 0.2));
check(
  "日本一の兵は被ダメージ半減、攻撃力と攻撃間隔は維持",
  near(sk.atk, base.atk) && near(sk.def, base.def * 1.2) && near(sk.rate, base.rate) && near(await page.evaluate(() => {const D=WD_DEBUG;return D.heroApi.heroGuard(D.squadApi.members(D.state().squads[0])[0],false);}), 0.5),
);
await step(page, 3);
const cdMid = (await H(page)).yukimura.cd;
await page.evaluate(() => {
  const api = WD_DEBUG.heroApi,
    s = WD_DEBUG.state();
  api.unassignHero("yukimura");
  api.assignHero("yukimura", s.squads[0]);
});
hs = await H(page);
check(
  "解除・再配属しても再使用待ちはリセットされない",
  // リセットされていなければ、再使用待ちは増えず、その間に経過したわずかな時間だけ減っている
  hs.yukimura.cd <= cdMid + 0.001 && hs.yukimura.cd > cdMid - 0.5 && hs.yukimura.active === 0,
  JSON.stringify({ cdMid, now: hs.yukimura }),
);
check(
  "再使用待ち中は使えない",
  await page.evaluate(() => !WD_DEBUG.heroApi.canUseSkill(WD_DEBUG.heroApi.heroState().yukimura)),
);

console.log("■ 部隊の全滅と武将");
const cdBeforeWipe = (await H(page)).yukimura.cd;
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  for (const m of WD_DEBUG.squadApi.members(s.squads[0])) m.hp = 0.5;
  WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 60, hp: 1e6, speed: 0 });
});
// 10人の部隊は前から順に戦うので、全員が倒れるまで進める
for (let i = 0; i < 80 && (await page.evaluate(() => WD_DEBUG.state().squads.length)); i++) await step(page, 0.25);
hs = await H(page);
let squadsLeft = await page.evaluate(() => WD_DEBUG.state().squads.length);
check("部隊は全滅", squadsLeft === 0);
check(
  "武将は死亡せず未配属に戻る（所持も残る）",
  hs.yukimura &&
    hs.yukimura.squad === null &&
    hs.yukimura.tower === null &&
    (await save(page)).owned.yukimura === 1,
);
check("全滅しても武将の再使用待ちは残る", hs.yukimura.cd > 0 && hs.yukimura.cd < cdBeforeWipe);
check("全滅の通知に武将の負傷", /負傷して退却/.test(await page.textContent("#msg")));
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  for (let i = s.enemies.length - 1; i >= 0; i--) if (!s.enemies[i].holder) s.enemies.splice(i, 1);
});

console.log("■ 直江兼続（回復）・上杉謙信（範囲攻撃）");
await page.evaluate(() => {
  const api = WD_DEBUG.squadApi;
  const q1 = api.hireSquad("spearman", 650, 300);
  const q2 = api.hireSquad("ashigaru", 740, 300);
  WD_DEBUG.heroApi.assignHero("kanetsugu", q1);
  WD_DEBUG.heroApi.assignHero("kenshin", q2);
  // 兵士を傷つけ、1人は戦死させる
  const ms = api.members(q1);
  for (const m of ms) m.hp = 20;
  ms[0].hp = 0.1;
  WD_DEBUG.addEnemy({ kind: "goblin", d: 694 + 60, hp: 1e6, speed: 0, unitCd: 0 });
});
await step(page, 1.2);
const heal = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    api = WD_DEBUG.squadApi,
    q1 = s.squads.find((q) => q.type === "spearman");
  const dead = s.soldiers.filter((m) => m.squadId === q1.id && !m.alive).map((m) => m.id);
  const before = api.members(q1).map((m) => m.hp);
  for (const e of s.enemies) e.unitCd = 99999;
  WD_DEBUG.heroApi.useSkill(WD_DEBUG.heroApi.heroState().kanetsugu, {point:q1});
  WD_DEBUG.step(0.5);
  const after = api.members(q1).map((m) => m.hp);
  return {
    dead,
    before,
    after,
    stillDead: dead.every((id) => !s.soldiers.find((m) => m.id === id).alive),
    max: api.soldierStats(api.members(q1)[0]).maxHp,
  };
});
check(
  "愛の救護陣：生存兵のHPを継続回復",
  heal.after.every((h, i) => h > heal.before[i]),
);
check("回復でも戦死者は復活しない", heal.dead.length >= 1 && heal.stillDead, JSON.stringify(heal));
const vol = await page.evaluate(() => {
  const s = WD_DEBUG.state();
  const e = WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 230, hp: 1e6, speed: 0 }); // 部隊#3（740）の近く
  const hp0 = e.hp;
  WD_DEBUG.heroApi.useSkill(WD_DEBUG.heroApi.heroState().kenshin);
  WD_DEBUG.step(1.6);
  return { dmg: hp0 - e.hp };
});
check("車懸りの陣：部隊の周囲の敵に範囲攻撃", vol.dmg > 10, String(vol.dmg));

console.log("■ 待機中の部隊・解散");
await page.evaluate(() => {
  const s = WD_DEBUG.state();
  for (let i = s.enemies.length - 1; i >= 0; i--) if (!s.enemies[i].holder) s.enemies.splice(i, 1);
  s.enemies.length = 0;
  WD_DEBUG.step(0.1); // ウェーブ終了
  const q = s.squads.find((q) => q.type === "ashigaru");
  WD_DEBUG.squadApi.orderRetreat(q);
});
const reserve = await page.evaluate(() => {
  const h = WD_DEBUG.heroApi.heroState().kenshin;
  return { squad: !!h.squad, usable: WD_DEBUG.heroApi.canUseSkill(h) };
});
check("待機中の部隊に付いた武将は必殺技を使えない（配属は保持）", reserve.squad && !reserve.usable);
const disband = await page.evaluate(() => {
  const s = WD_DEBUG.state(),
    api = WD_DEBUG.squadApi,
    q = s.squads.find((q) => q.type === "ashigaru");
  // 1人目で新しい部隊を作り、残りもその部隊へ移す（部隊は4つまでなので、毎回新しい部隊は作らない）
  const list = api.members(q),
    errs = [api.transferSoldier(list[0].id, "new")],
    to = WD_DEBUG.state().squads.find((x) => x !== q && x.type === "ashigaru");
  for (const m of list.slice(1)) errs.push(api.transferSoldier(m.id, to.id));
  return {
    exists: WD_DEBUG.state().squads.includes(q),
    hero: WD_DEBUG.heroApi.heroState().kenshin.squad,
    errs,
  };
});
check(
  "全員を移籍して部隊が解散すると武将は未配属に戻る",
  !disband.exists && disband.hero === null,
  JSON.stringify(disband),
);

console.log("■ リセット");
await page.tap("#reset");
hs = await H(page);
sv = await save(page);
check(
  "リセット後も所持武将とガチャ券は残る",
  Object.keys(sv.owned).length === 5 && Object.keys(hs).length === 5,
);
check(
  "リセットで配属と必殺技の時間は初期化",
  Object.values(hs).every((h) => h.tower === null && h.squad === null && h.cd === 0 && h.active === 0),
);
check("ここまでエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

console.log("■ 武将30人（第2弾の20人を含む）");
{
  const ALL = await (async () => {
    const r = await newPage();
    const ids = await r.page.evaluate(() => Object.keys(WD_DEBUG.config.WARLORDS));
    await r.context.close();
    return ids;
  })();
  const owned = Object.fromEntries(ALL.map((id) => [id, 1]));
  ({ page, errors, context } = await newPage(JSON.stringify({ owned, tickets: 0, history: [] })));
  const info = await page.evaluate(() => {
    const W = WD_DEBUG.config.WARLORDS;
    const count = { SSR: 0, SR: 0, R: 0 };
    for (const w of Object.values(W)) count[w.rarity]++;
    return { n: Object.keys(W).length, count, names: Object.values(W).map((w) => w.name) };
  });
  check(
    "武将は30人（SSR 5・SR 11・R 14）",
    info.n === 30 && info.count.SSR === 5 && info.count.SR === 11 && info.count.R === 14,
    JSON.stringify(info.count),
  );
  check(
    "第2弾の武将（松平元康・羽柴秀吉・明智光秀・石田三成・島津義弘 ほか）を含む",
    [
      "松平元康",
      "羽柴秀吉",
      "明智光秀",
      "石田三成",
      "島津義弘",
      "長宗我部元親",
      "加藤清正",
      "立花宗茂",
      "竹中半兵衛",
      "北条氏康",
      "福島正則",
      "山本勘助",
      "最上義光",
      "朝倉義景",
      "斎藤道三",
      "六角義賢",
      "尼子晴久",
      "大友宗麟",
      "龍造寺隆信",
      "毛利輝元",
    ].every((n) => info.names.includes(n)),
  );
  check("名前の重複なし", new Set(info.names).size === 30);
  await openInfoEntry(page, '#roster');
  const roster = await page.evaluate(() => ({
    hint: document.getElementById("sheetHint").textContent,
    cards: document.querySelectorAll("#heroList .hero-card").length,
    withImg: [...document.querySelectorAll("#heroList .avatar")].filter((a) =>
      /url\(/.test(a.style.backgroundImage),
    ).length,
  }));
  check(
    "武将一覧に30人・全員の画像",
    roster.cards === 30 && roster.withImg === 30 && /所持 30\/30/.test(roster.hint),
    JSON.stringify(roster),
  );
  await page.tap("#sheetClose");
  // 全員をガチャで引ける（各武将を狙った乱数で抽選）
  const drawable = await page.evaluate(() => {
    const { WARLORDS, GACHA } = WD_DEBUG.config,
      api = WD_DEBUG.heroApi,
      keys = Object.keys(GACHA.rates);
    const got = new Set();
    for (const [id, w] of Object.entries(WARLORDS)) {
      let lo = 0;
      for (const k of keys) {
        if (k === w.rarity) break;
        lo += GACHA.rates[k];
      }
      const pool = Object.keys(WARLORDS).filter((x) => WARLORDS[x].rarity === w.rarity);
      const seq = [lo + GACHA.rates[w.rarity] / 2, (pool.indexOf(id) + 0.5) / pool.length];
      let i = 0;
      got.add(api.rollWarlord(() => seq[i++]));
    }
    return got.size;
  });
  check("30人全員がガチャの抽選対象", drawable === 30, String(drawable));
  // 全員を塔と部隊に配属して必殺技を使ってもエラーにならない
  const run = await page.evaluate(() => {
    const api = WD_DEBUG.heroApi,
      sq = WD_DEBUG.squadApi,
      s = WD_DEBUG.state();
    WD_DEBUG.setGold(1e6);
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    s.enemies.length = 0;
    WD_DEBUG.addEnemy({ kind: "knight", d: 0, hp: 1e12, speed: 0, holder: true });
    WD_DEBUG.addEnemy({ kind: "knight", d: 694 + 40, hp: 1e12, speed: 0 });
    const q = sq.hireSquad("spearman", 650, 300);
    const used = [];
    for (const id of Object.keys(WD_DEBUG.config.WARLORDS)) {
      for (const target of ["tower", "squad"]) {
        const st = WD_DEBUG.state();
        if (q.state === "reserve") sq.deployReserve(q, 650, 300);
        for (const e of st.enemies) e.unitCd = 1e9;
        if (target === "tower") {
          if (!st.towers.length) {
            // 道の外の草地に塔を1基
            st.towers.push({ id: 99, x: 650, y: 225, type: "cannon", level: 1, cd: 0, spent: 180, hp: 1e9 }); // 敵に壊されないように
          }
          api.assignHero(id, st.towers[0]);
        } else api.assignHero(id, q);
        const h = api.heroState()[id];
        api.endSkill(h);
        h.cd = 0;
        const kind = WD_DEBUG.config.WARLORDS[id].skill.target;
        const input = kind === "enemy" ? {enemy:st.enemies.find(e=>!e.holder)} : kind === "ally" ? {ally:q} : kind === "heal" ? {heal:sq.members(q)[0]} : kind === "road" ? {point:q} : undefined;
        api.useSkill(h, input);
        WD_DEBUG.step(1.2);
        used.push(h.cd > 0);
      }
      api.unassignHero(id);
    }
    return { ok: used.every(Boolean), n: used.length };
  });
  check("30人全員の必殺技を塔・部隊の両方で発動できる", run.ok && run.n === 60, JSON.stringify(run));
  check("第2弾の確認でエラーなし", errors.length === 0, errors.join(" / "));
  await context.close();
}

console.log("■ モバイル表示（390px）");
({ page, errors, context } = await newPage(
  JSON.stringify({ owned: { nobunaga: 1 }, tickets: 5, history: [] }),
));
await page.tap("#gacha");
await page.tap("#gachaPull");
const g = await page.evaluate(() => {
  const r = document.querySelector("#gachaSheet .sheet").getBoundingClientRect();
  return {
    h: r.height / innerHeight,
    minBtn: Math.min(
      ...[...document.querySelectorAll("#gachaSheet button")].map((b) => b.getBoundingClientRect().height),
    ),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check("ガチャ画面は画面の72%以下", g.h <= 0.73, g.h.toFixed(2));
check("ガチャ画面のボタン 44px 以上", g.minBtn >= 44, String(g.minBtn));
check("横スクロールが出ない", !g.hScroll);
await page.tap("#gachaClose");
await page.evaluate(() => WD_DEBUG.setGold(500));
await tapHire(page, "ashigaru");
await tapMap(page, ...M1);
await page.evaluate(() => WD_DEBUG.heroApi.assignHero("nobunaga", WD_DEBUG.state().squads[0]));
await tapMap(page, 650, 280);
const lay = await page.evaluate(() => {
  const vis = (el) => el.offsetParent !== null;
  const panel = document.getElementById("squadPanel").getBoundingClientRect(),
    canvas = document.getElementById("game").getBoundingClientRect();
  const btns = [...document.querySelectorAll("#squadPanel button")].filter(vis);
  const texts = [...document.querySelectorAll("#squadPanel *, #toolbar *")].filter(
    (e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
  );
  return {
    overlap: panel.top < canvas.bottom - 1,
    minBtn: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
    minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))),
    hScroll: document.documentElement.scrollWidth > innerWidth,
  };
});
check("武将付きの部隊パネル：マップに重ならない", !lay.overlap);
check(
  "武将付きの部隊パネル：ボタン 44px 以上・文字 14px 以上",
  lay.minBtn >= 44 && lay.minFont >= 14,
  JSON.stringify(lay),
);
check("横スクロールが出ない（部隊パネル）", !lay.hScroll);
if (shots) await page.screenshot({ path: path.join(shots, "w3-mobile.png"), fullPage: true });
check("モバイル表示でエラーなし", errors.length === 0, errors.join(" / "));
await context.close();

await browser.close();
console.log(`\n結果: ${passes} 件成功 / ${failures} 件失敗`);
process.exit(failures ? 1 : 0);
