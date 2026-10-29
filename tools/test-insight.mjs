// 閃きの確定保存、転職・再読込、独立した2枠、引退・書消費・保存障害。
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
  ),
  W = "worldDefense.warlords.v1",
  S = "worldDefense.soldiers.v1",
  TX = "worldDefense.bookTransaction.v1";
let n = 0;
const errors = [];
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
async function setup(known = []) {
  const c = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await c.addInitScript(
    ({ known, W, S }) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.getItem("seed")) return;
      sessionStorage.setItem("seed", "1");
      localStorage.setItem(
        S,
        JSON.stringify({
          seq: 2,
          squadSeq: 1,
          squads: [{ id: 1, type: "ashigaru", slot: 0 }],
          soldiers: [1, 2].map((id) => ({
            id,
            type: "ashigaru",
            squadId: 1,
            level: 100,
            bestLevel: 100,
            job: "ashigaru",
            jobs: ["ashigaru"],
            prof: { ashigaru: 8250 },
            skills: [],
            learned: [],
            ...(id === 1 && known.length
              ? { insight: { seed: 45, evaluatedMaxLevel: 100, known, equipped: known.slice(0, 2) } }
              : {}),
          })),
          fallen: [],
        }),
      );
      localStorage.setItem(
        W,
        JSON.stringify({
          owned: {},
          forge: {
            items: [],
            seq: 0,
            legendBooks: Array.from({ length: 4 }, (_, i) => ({
              uid: i + 1,
              type: "stat",
              k: "hpFlat",
              v: 20,
              owner: 2,
            })),
            lseq: 4,
          },
        }),
      );
    },
    { known, W, S },
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:" + server.address().port + "/?debug");
  return { p, c };
}
const state = (p) =>
  p.evaluate(() => ({
    soldiers: WD_DEBUG.state().soldiers.map((s) => ({ id: s.id, level: s.level, insight: s.insight })),
    books: WD_DEBUG.forgeApi.save().insightBooks,
    found: WD_DEBUG.insightApi.found(),
    four: WD_DEBUG.legendApi.booksOf(2).length,
  }));
const learn = (p) =>
  p.evaluate(() => {
    const D = WD_DEBUG,
      s = D.state().soldiers[0];
    D.insightApi.setRoll(() => 0);
    D.squadApi.gainXp(s, 1e5, true);
    D.insightApi.flush();
    return {
      known: s.insight.known,
      trial: s.insight.evaluatedMaxLevel,
      level: s.level,
      pending: D.insightApi.pending(),
    };
  });
const fault = (p, key) =>
  p.evaluate((key) => {
    window.oldSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw Error("injected");
      return oldSet.call(this, k, v);
    };
  }, key);
try {
  {
    const { p, c } = await setup();
    let r = await state(p);
    check(
      r.soldiers.every((s) => s.insight.known.length === 0 && s.insight.evaluatedMaxLevel === 100),
      "旧セーブは最高Lvまで再抽選せず未習得として移行",
    );
    r = await learn(p);
    check(
      r.known.join() === "in_ashigaru" && r.trial === r.level && r.pending === 0,
      "複数Lvでも現在職の技は1つだけ習得・評価位置を確定",
    );
    let before = await state(p);
    check(before.found.includes("in_ashigaru") && before.four === 4, "図鑑の発見正本へ記録・既存書4冊を維持");
    await p.reload();
    r = await state(p);
    check(
      r.soldiers[0].level === 100 && r.soldiers[0].insight.known.includes("in_ashigaru"),
      "戦闘中のXPをチェックポイントへ移さず閃きだけ即時保存",
    );
    check(
      r.soldiers[0].insight.evaluatedMaxLevel === before.soldiers[0].insight.evaluatedMaxLevel,
      "再読込で評価済みLvを保持し同じLvを再抽選しない",
    );
    const rr = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      D.jobApi.changeJob(s, "medic");
      return { known: s.insight.known, fit: D.insightApi.compatible(s, "in_ashigaru"), old: s.learned };
    });
    check(
      rr.known.includes("in_ashigaru") && !rr.fit && !rr.old.includes("in_ashigaru"),
      "転職後も保持・治療職では攻撃技を発動せず通常スキルと分離",
    );
    await c.close();
  }
  {
    const { p, c } = await setup(["in_ashigaru", "in_spearman", "in_medic"]);
    let r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      return {
        full: D.insightApi.toggle(s, "in_medic"),
        off: D.insightApi.toggle(s, "in_spearman"),
        on: D.insightApi.toggle(s, "in_medic"),
        eq: s.insight.equipped,
      };
    });
    check(
      !!r.full && r.off === null && r.on === null && r.eq.join() === "in_ashigaru,in_medic",
      "有効2枠を守り解除・設定できる",
    );
    await p.reload();
    check(
      (await state(p)).soldiers[0].insight.equipped.join() === "in_ashigaru,in_medic",
      "有効枠の変更を保存",
    );
    r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0],
        a = D.legendApi.inheritables(s),
        i = a.findIndex((b) => b.type === "insight" && b.id === "in_ashigaru");
      D.legendApi.setSuperRng(() => 1);
      return {
        err: D.legendApi.retireSoldier(s.id, i),
        live: D.state().soldiers.map((s) => s.id),
        books: D.forgeApi.save().insightBooks,
        legacy: D.forgeApi.save().legendBooks.length,
      };
    });
    check(
      r.err === null &&
        r.live.join() === "2" &&
        r.books.length === 1 &&
        r.books[0].id === "in_ashigaru" &&
        r.legacy === 4,
      "指導員は本命1つだけを閃き秘伝書として発行・既存4冊を維持",
    );
    await p.reload();
    let before = await state(p);
    check(before.books.length === 1 && before.soldiers.length === 1, "引退と発行を同時保存");
    r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0],
        uid = D.forgeApi.save().insightBooks[0].uid;
      return {
        err: D.insightApi.useBook(s, uid),
        again: D.insightApi.useBook(s, uid),
        known: s.insight.known,
        books: D.forgeApi.save().insightBooks.length,
        four: D.legendApi.booksOf(s.id).length,
      };
    });
    check(
      r.err === null && !!r.again && r.known.includes("in_ashigaru") && r.books === 0 && r.four === 4,
      "閃き秘伝書を1回だけ消費・二重継承を拒否・4冊装備中も習得可能",
    );
    await p.reload();
    check(
      (await state(p)).books.length === 0 &&
        (await state(p)).soldiers[0].insight.known.includes("in_ashigaru"),
      "書の消費と習得を再読込でも維持",
    );
    await c.close();
  }
  for (const key of [TX, S]) {
    const { p, c } = await setup();
    await fault(p, key);
    const r = await learn(p);
    if (key === TX)
      check(r.known.length === 0 && r.pending === 1, "確定前の障害では未習得・同じ抽選結果を保存待ちにする");
    else check(r.known.length === 1, "転記障害でも確定ログを正本として習得");
    await p.evaluate(() => (Storage.prototype.setItem = oldSet));
    if (key === TX) await p.evaluate(() => WD_DEBUG.insightApi.flush());
    await p.reload();
    check((await state(p)).soldiers[0].insight.known.length === 1, "保存再試行・再読込で習得は1つ：" + key);
    await c.close();
  }
  for (const key of [TX, W, S]) {
    const { p, c } = await setup(["in_ashigaru"]);
    await p.evaluate(() => {
      const D = WD_DEBUG;
      D.legendApi.setSuperRng(() => 1);
      D.legendApi.retireSoldier(1, 0);
    });
    const before = await state(p);
    await fault(p, key);
    const err = await p.evaluate(() =>
      WD_DEBUG.insightApi.useBook(WD_DEBUG.state().soldiers[0], WD_DEBUG.forgeApi.save().insightBooks[0].uid),
    );
    const after = await state(p);
    if (key === TX)
      check(
        !!err && JSON.stringify(before) === JSON.stringify(after),
        "書使用の確定前失敗で書と兵士を完全に元へ戻す",
      );
    else check(err === null && after.books.length === 0, "書使用の転記障害は確定ログから復元：" + key);
    await p.evaluate(() => (Storage.prototype.setItem = oldSet));
    await p.reload();
    check(
      JSON.stringify((await state(p)).books) === JSON.stringify(after.books),
      "障害後の再読込で書が増殖しない：" + key,
    );
    await c.close();
  }
  {
    const { p, c } = await setup(["in_ashigaru"]);
    const before = await state(p);
    await fault(p, TX);
    const err = await p.evaluate(() => WD_DEBUG.legendApi.retireSoldier(1, 0));
    check(
      !!err && JSON.stringify(before) === JSON.stringify(await state(p)),
      "引退の保存失敗で兵士・書・4冊を取り消す",
    );
    await p.evaluate(() => (Storage.prototype.setItem = oldSet));
    await p.reload();
    check((await state(p)).soldiers.length === 2, "取り消した引退が後から確定しない");
    await c.close();
  }
  for (const [j, grade] of [
    ["ashigaru", 0],
    ["samurai", 1],
    ["sword_saint", 2],
  ])
    for (const success of [false, true]) {
      const { p, c } = await setup();
      const r = await p.evaluate(
        ({ j, grade, success }) => {
          const D = WD_DEBUG,
            s = D.state().soldiers[0],
            k = "in_" + j;
          Object.assign(s, {
            job: j,
            type: D.jobApi.JOBS[j].base,
            level: 200,
            bestLevel: 200,
            prof: { [j]: 8250 },
            insight: { seed: 3, evaluatedMaxLevel: 199, known: [], equipped: [] },
          });
          D.insightApi.setRoll(() => D.insightApi.INSIGHT_RULES.rates[grade] - (success ? 1e-9 : 0));
          D.insightApi.queueInsight(s, true);
          D.insightApi.flush();
          return s.insight.known.includes(k);
        },
        { j, grade, success },
      );
      check(r === success, j + "：確率境界" + (success ? "未満なら習得" : "以上では習得しない"));
      await c.close();
    }
  {
    const { p, c } = await setup(["in_ashigaru"]);
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        F = D.forgeApi.save();
      F.insightBooks = Array.from({ length: 200 }, (_, i) => ({
        type: "insight",
        uid: i + 1,
        id: "in_ashigaru",
        from: "先代",
      }));
      F.insightSeq = 200;
      const err = D.legendApi.retireSoldier(1, 0);
      return { err, count: F.insightBooks.length, live: D.state().soldiers.length };
    });
    check(!!r.err && r.count === 200 && r.live === 2, "閃き秘伝書が満杯なら兵士も書も失わず引退を拒否");
    await c.close();
  }
  {
    const { p, c } = await setup();
    await fault(p, TX);
    await learn(p);
    await p.evaluate(() => {
      Storage.prototype.setItem = oldSet;
      const F = WD_DEBUG.forgeApi.save();
      F.insightBooks = [{ type: "insight", uid: 1, id: "in_spearman", from: "指導員" }];
      F.insightSeq = 1;
      WD_DEBUG.insightApi.useBook(WD_DEBUG.state().soldiers[0], 1);
    });
    check(
      await p.evaluate(() => {
        const s = WD_DEBUG.state().soldiers[0];
        return s.insight.known.includes("in_ashigaru") && s.insight.known.includes("in_spearman");
      }),
      "保存待ちの自然習得と書の継承が続いても両方の技を保持",
    );
    await p.reload();
    check(
      (await state(p)).soldiers[0].insight.known.length === 2 && (await state(p)).books.length === 0,
      "保存待ちの解決と継承後の再読込で技も書も増殖・消失しない",
    );
    await c.close();
  }
  check(errors.length === 0, "JavaScriptエラーなし：" + errors.join(";"));
  console.log(`\n${n} passed, 0 failed`);
} finally {
  await browser.close();
  server.close();
}
