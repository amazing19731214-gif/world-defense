// 奥義書・奥義継承者・奥義の閃き（v106.2試作）：修練場の「新しい戦い（試作）」・専用の保存キー worldDefense.ougi.v1
//   node tools/test-ougi-books.mjs
//   閃き（剣聖だけ・条件・再読み込みでやり直せない）、引退で奥義書、全軍で継承者1人（有効な書は1冊）、
//   1回の挑戦で1回（再読み込みでも復活しない）、戦死・復活の書・引退の途中で閉じたとき、伝承の秘伝書がそのまま動くこと
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
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const base = "http://127.0.0.1:" + server.address().port + "/";
const errors = [];
let n = 0;
const check = (ok, text, detail) => {
  assert.ok(ok, text + (detail === undefined ? "" : " " + JSON.stringify(detail)));
  n++;
  console.log("✓ " + text);
};
const OUGI = "worldDefense.ougi.v1",
  SOLD = "worldDefense.soldiers.v1",
  WAR = "worldDefense.warlords.v1";
// 第一部隊：1・2 は奥義を閃ける剣聖（Lv200・熟練度10・強敵撃破12）、3 は Lv120 の剣聖（閃けないが継承はできる）、4 は剣豪
// 第二部隊：槍兵（5〜8）
const saint = { job: "sword_saint", jobs: ["ashigaru", "samurai", "kensei", "sword_saint"], prof: { sword_saint: 1e15, samurai: 1e15, kensei: 1e15 } };
const save = {
  version: 1,
  seq: 8,
  squadSeq: 2,
  fallen: [],
  squads: [
    { id: 1, type: "ashigaru", slot: 0 },
    { id: 2, type: "spearman", slot: 1 },
  ],
  soldiers: [
    { id: 1, type: "ashigaru", squadId: 1, level: 200, name: "月影", ...saint, chronicle: { life: "soldier:life1", bossKills: 12 } },
    { id: 2, type: "ashigaru", squadId: 1, level: 200, name: "朧", ...saint, chronicle: { life: "soldier:life2", bossKills: 12 } },
    { id: 3, type: "ashigaru", squadId: 1, level: 120, ...saint, chronicle: { life: "soldier:life3", bossKills: 12 } },
    { id: 4, type: "ashigaru", squadId: 1, level: 200, job: "kensei", jobs: ["ashigaru", "samurai", "kensei"], prof: { kensei: 1e15 }, chronicle: { life: "soldier:life4", bossKills: 12 } },
    ...[5, 6, 7, 8].map((id) => ({ id, type: "spearman", squadId: 2, level: 200, chronicle: { life: "soldier:life" + id } })),
  ],
};
async function open({ query = "?debug&proto=combat", ougi = null, width = 375, height = 667 } = {}) {
  const c = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(
    ([save, ougi]) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(save));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [] }));
      localStorage.setItem("worldDefense.training.v1", JSON.stringify({ best: { beginner: { waves: 3, level: 6 } }, clears: { beginner: 2 } }));
      if (ougi) localStorage.setItem("worldDefense.ougi.v1", JSON.stringify(ougi));
    },
    [save, ougi],
  );
  const p = await c.newPage();
  p.setDefaultTimeout(8000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(base + query);
  await p.waitForFunction(() => window.WD_DEBUG);
  return { c, p };
}
const reload = async (p) => {
  await p.reload();
  await p.waitForFunction(() => window.WD_DEBUG);
};
const raw = (p, k) => p.evaluate((k) => localStorage.getItem(k), k);
// 伝承の秘伝書（武将の保存データの中の legendBooks）を数える
const legendBookCount = (p) =>
  p.evaluate((k) => {
    const find = (o) => (Array.isArray(o?.legendBooks) ? o.legendBooks.length : o && typeof o === "object" ? Object.values(o).map(find).find((v) => v != null) : undefined);
    return find(JSON.parse(localStorage.getItem(k) || "{}")) ?? 0;
  }, WAR);
try {
  // 1. 閃き：剣聖・Lv150・熟練度10・強敵撃破10 の兵士だけ。修練場（試作）の中だけで抽選
  let { c, p } = await open();
  let r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    WD_DEBUG.trainingApi.startTraining("beginner");
    const el = [1, 2, 3, 4, 5].map((id) => K.eligible(id));
    K.setRoll(() => 0); // 必ず閃く
    const got = [3, 4, 5].map((id) => K.roll(id)),
      got1 = K.roll(1),
      fx = WD_DEBUG.combat.fx();
    K.setRoll(null);
    return { el, got, got1, known1: K.known(1), fx };
  });
  check(r.el.join() === "true,true,false,false,false", "閃きの条件を満たすのは Lv150以上・熟練度10・強敵撃破10 の剣聖だけ", r.el);
  check(r.got.every((v) => v === null), "条件を満たさない兵士（Lv不足の剣聖・剣豪・槍兵）は閃かない", r.got);
  check(r.got1 && r.known1.length === 1 && r.known1[0] === r.got1, "剣聖が伝説の奥義を閃く（伝説の奥義として別に記録）", r);
  check(r.fx.banner && r.fx.banner.name.startsWith("閃き！ 奥義・") && r.fx.banner.who.includes("月影"), "閃いたとき、兵士の名前と奥義名を大きく出す", r.fx.banner);
  r = await p.evaluate(() => {
    const s = WD_DEBUG.state().soldiers.find((x) => x.id === 1);
    return { insight: JSON.stringify(s.insight), saved: JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.find((x) => x.id === 1).insight };
  });
  check(!/happou|mumyou|tenken/.test(r.insight) && !/happou|mumyou|tenken/.test(JSON.stringify(r.saved)), "閃きの2枠（兵士の閃き）には入れない");
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    WD_DEBUG.trainingApi.endTraining("retreat");
    WD_DEBUG.combat.pick(false);
    WD_DEBUG.trainingApi.startTraining("beginner");
    K.setRoll(() => 0);
    const v = K.roll(2);
    K.setRoll(null);
    WD_DEBUG.trainingApi.endTraining("retreat");
    return v;
  });
  check(r === null, "試作をオフにした修練場では閃かない");
  await c.close();

  // 2. 抽選の機会：強敵（中ボス・大将）への最後の一撃と、修練場のクリア。雑魚を倒しても引かない
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi,
      S = WD_DEBUG.state,
      life = "soldier:life2",
      rolls = () => K.save().rolls[life] || 0;
    WD_DEBUG.trainingApi.startTraining("beginner");
    WD_DEBUG.squadApi.deployReserve(S().squads[0], 620, 300);
    document.getElementById("start").click();
    WD_DEBUG.stopSpawning();
    S().enemies.length = 0;
    WD_DEBUG.addEnemy({ d: 100, hp: 9e9, speed: 0, unitCd: 1e9 }); // ウェーブが終わらないように
    const a = rolls();
    const weak = WD_DEBUG.addEnemy({ d: 600, hp: 5, speed: 0 });
    weak.lastHitBy = 2;
    weak.hp = 0;
    WD_DEBUG.step(0.05);
    const b = rolls();
    const mid = WD_DEBUG.addEnemy({ d: 600, hp: 5, speed: 0, kind: "boss", role: "mid" });
    mid.lastHitBy = 2;
    mid.hp = 0;
    WD_DEBUG.step(0.05);
    const c2 = rolls();
    WD_DEBUG.trainingApi.training().joined.add(2);
    WD_DEBUG.trainingApi.endTraining("clear");
    return { a, b, c: c2, d: rolls() };
  });
  check(r.a === 0 && r.b === 0, "雑魚を倒しても抽選しない", r);
  check(r.c === 1 && r.d === 2, "強敵への最後の一撃と、修練場のクリアで1回ずつ抽選する", r);
  // 3. 再読み込みでやり直せない：結果は兵士の閃きの種と回数で決まり、回数は保存される
  const first = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    WD_DEBUG.trainingApi.startTraining("beginner");
    const out = [];
    for (let i = 0; i < 6; i++) out.push(K.roll(2));
    return { out, rolls: K.save().rolls["soldier:life2"] };
  });
  await reload(p);
  r = await p.evaluate(() => WD_DEBUG.combat.ougi.save().rolls["soldier:life2"]);
  check(first.rolls === 8 && r === 8, "抽選の回数は保存され、再読み込みしても同じ回から引き直せない", { first, after: r });
  await c.close();
  // 同じ保存データ（同じ兵士・同じ回数）なら、何度開いても同じ結果
  const runs = [];
  for (let t = 0; t < 2; t++) {
    ({ c, p } = await open());
    runs.push(
      await p.evaluate(() => {
        const K = WD_DEBUG.combat.ougi;
        WD_DEBUG.trainingApi.startTraining("beginner");
        K.setRoll((s, n) => (n % 4 === 1 ? 0 : 1));
        const v = [];
        for (let i = 0; i < 8; i++) v.push(K.roll(1));
        K.setRoll(null);
        const h = [];
        for (let i = 0; i < 20; i++) h.push(K.roll(2));
        return { v, h, known: K.known(1), k2: K.known(2) };
      }),
    );
    await c.close();
  }
  check(JSON.stringify(runs[0]) === JSON.stringify(runs[1]), "抽選の結果は兵士と回数で決まる（開き直しても同じ）", runs);
  check(runs[0].known.length === 2 && runs[0].v.filter(Boolean).length === 2, "閃いた奥義は重ならず、まだ知らない奥義から選ぶ", runs[0]);

  // 4. 引退で奥義書：伝承の秘伝書とは別に1冊。名前・職業・Lv・日時。複数知っていれば1つ選ぶ
  ({ c, p } = await open());
  const lb0 = await legendBookCount(p);
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    K.grant(1, "happouTenshou");
    K.grant(1, "mumyouIssen");
    const noPick = K.retire(1, 0);
    const alive = !!WD_DEBUG.state().soldiers.find((x) => x.id === 1 && x.alive);
    const ok = K.retire(1, 0, "mumyouIssen");
    return { noPick, alive, ok, save: K.save(), gone: !WD_DEBUG.state().soldiers.some((x) => x.id === 1) };
  });
  const b1 = r.save.books[0];
  check(typeof r.noPick === "string" && r.noPick.includes("選んで") && r.alive, "複数の奥義を知っているときは、残す奥義を選ばないと引退しない", r.noPick);
  check(r.ok === null && r.gone && r.save.books.length === 1 && b1.k === "mumyouIssen", "奥義を閃いた剣聖が引退すると、選んだ奥義の奥義書が残る", r.save.books);
  check(b1.from.includes("月影") && b1.job === "sword_saint" && b1.level === 200 && b1.at > 0 && Number.isInteger(b1.uid) && b1.pending === undefined, "奥義書に奥義のID・伝承者の名前・職業・Lv・作成日時を記録する", b1);
  check(!r.save.known["soldier:life1"], "引退した兵士の奥義の知識は奥義書に移る", r.save.known);
  check((await legendBookCount(p)) === lb0 + 1, "伝承の秘伝書もいつもどおり1冊残る（200冊の倉庫に奥義書は入らない）", { lb0, now: await legendBookCount(p) });
  r = await p.evaluate(() => WD_DEBUG.combat.ougi.retire(5, 0));
  check(r === null && (await p.evaluate(() => WD_DEBUG.combat.ougi.save().books.length)) === 1 && (await legendBookCount(p)) === lb0 + 2, "奥義を知らない兵士の引退は今までどおり（伝承の秘伝書だけ）", r);
  await reload(p);
  r = await p.evaluate(() => WD_DEBUG.combat.ougi.save().books);
  check(r.length === 1 && r[0].from.includes("月影"), "再読み込みしても奥義書は消えない", r);
  check(JSON.parse(await raw(p, OUGI)).books.length === 1 && !(await raw(p, WAR)).includes("mumyouIssen"), "奥義書は専用の保存キーにだけ保存する（伝承の秘伝書とは別）");
  await c.close();

  // 5. 引退の保存に失敗したら、引退も奥義書も元に戻す
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    K.grant(2, "tenkenRanbu");
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "worldDefense.bookTransaction.v1" || k === "worldDefense.soldiers.v1" || k === "worldDefense.warlords.v1") throw new Error("quota");
      return set.call(this, k, v);
    };
    const err = K.retire(2, 0);
    Storage.prototype.setItem = set;
    return { err, alive: WD_DEBUG.state().soldiers.some((x) => x.id === 2 && x.alive), save: K.save(), known: K.known(2) };
  });
  check(typeof r.err === "string" && r.alive && r.save.books.length === 0 && r.known[0] === "tenkenRanbu", "引退の保存に失敗すると、兵士も奥義書も奥義の知識も元のまま", r);
  await c.close();
  // 引退の途中で閉じた：兵士の保存が残っていれば書を消し、兵士がいなければ書を確定する
  ({ c, p } = await open({
    ougi: {
      version: 1,
      seq: 2,
      books: [
        { uid: 1, k: "happouTenshou", from: "朧", job: "sword_saint", level: 200, at: 1, pending: 2, life: "soldier:life2" },
        { uid: 2, k: "tenkenRanbu", from: "古老", job: "sword_saint", level: 300, at: 1, pending: 99, life: "soldier:gone" },
      ],
      known: { "soldier:life2": { list: [{ k: "happouTenshou", at: 1 }] }, "soldier:gone": { list: [{ k: "tenkenRanbu", at: 1 }] } },
      rolls: {},
      heir: null,
      run: null,
    },
  }));
  r = await p.evaluate(() => WD_DEBUG.combat.ougi.save());
  check(r.books.length === 1 && r.books[0].uid === 2 && r.books[0].pending === undefined && !r.known["soldier:gone"] && r.known["soldier:life2"], "引退の途中で閉じても、兵士の保存データに合わせて奥義書を確定・取り消す", r);
  await c.close();

  // 6. 継承者は全軍で1人、有効な奥義書は1冊。剣聖だけ。戦闘中は変えられない
  const twoBooks = {
    version: 1,
    seq: 2,
    books: [
      { uid: 1, k: "happouTenshou", from: "初代 剣聖", job: "sword_saint", level: 300, at: 1 },
      { uid: 2, k: "mumyouIssen", from: "二代 剣聖", job: "sword_saint", level: 400, at: 2 },
    ],
    known: {},
    rolls: {},
    heir: null,
    run: null,
  };
  ({ c, p } = await open({ ougi: twoBooks }));
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    const notSaint = [K.setHeir(4, { book: 1 }), K.setHeir(5, { book: 1 })];
    const a = K.setHeir(2, { book: 1 }),
      h1 = K.heir();
    const b = K.setHeir(3, { book: 2 }),
      h2 = K.heir();
    K.grant(1, "tenkenRanbu");
    const c = K.setHeir(1, { k: "tenkenRanbu" }),
      h3 = K.heir();
    return { notSaint, a, h1, b, h2, c, h3, saved: JSON.parse(localStorage.getItem("worldDefense.ougi.v1")).heir };
  });
  check(r.notSaint.every((e) => typeof e === "string" && e.includes("剣聖だけ")), "奥義書を継承できるのは剣聖だけ", r.notSaint);
  check(r.a === null && r.b === null && r.h2.sid === 3 && r.h2.book === 2, "別の剣聖が継承すると、前の継承者は外れる（継承者は全軍で1人）", r);
  check(r.c === null && r.h3.sid === 1 && r.h3.book === null && r.saved.sid === 1, "自分で閃いた剣聖も、奥義書なしで継承者になれる（有効な書は0冊）", r);
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    WD_DEBUG.trainingApi.startTraining("beginner");
    const e = K.setHeir(2, { book: 1 }),
      e2 = K.clearHeir();
    WD_DEBUG.trainingApi.endTraining("retreat");
    return { e, e2, heir: K.heir() };
  });
  check(r.e.includes("戦闘の前") && r.e2.includes("戦闘の前") && r.heir.sid === 1, "戦闘中（修練場の挑戦中）は継承者を変えられない", r);
  // UI：兵士名簿の剣聖に「⚔ 奥義」と継承者の印、奥義書の一覧（奥義名・伝承者・効果・今の継承者）
  await p.evaluate(() => document.getElementById("soldiers").click());
  r = await p.evaluate(() => {
    const cards = [...document.querySelectorAll("#soldierList .s-card")];
    const card = (name) => cards.find((x) => x.querySelector("h3").textContent.includes(name));
    return {
      saint: !!card("月影")?.querySelector("[data-ougi-for]"),
      tag: card("月影")?.querySelector("h3").textContent,
      spear: cards.filter((x) => x.querySelector("[data-ougi-for]")).length,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  check(r.saint && r.tag.includes("⚔ 奥義継承者") && r.spear === 3, "剣聖のカードに「⚔ 奥義」、継承者に「⚔ 奥義継承者」の印（ほかの職業には出ない）", r);
  await p.evaluate(() => document.querySelector('#soldierList [data-ougi-for="2"]').click());
  r = await p.evaluate(() => {
    const body = document.getElementById("ougiBody");
    return {
      open: !document.getElementById("ougiSheet").hidden,
      cards: [...body.querySelectorAll(".ougi-card")].map((x) => x.textContent),
      buttons: [...body.querySelectorAll("[data-ougi-book]")].map((x) => x.textContent),
      overflow: document.documentElement.scrollWidth - innerWidth,
      sheetOverflow: [...body.querySelectorAll("*")].some((el) => el.getBoundingClientRect().right > innerWidth + 1),
    };
  });
  check(r.open && r.cards.length === 2 && r.cards[0].includes("八方天翔斬") && r.cards[0].includes("初代 剣聖") && r.cards[0].includes("八方向") && r.cards[0].includes("今の継承者：なし"), "奥義書の一覧に奥義名・伝承者・効果・今の継承者", r.cards);
  check(r.buttons.length === 2 && r.buttons[0].includes("継承する"), "剣聖の兵士の画面から奥義書を継承できる", r.buttons);
  check(r.overflow <= 0 && !r.sheetOverflow, "iPhone縦（375px）で奥義の画面がはみ出さない", r);
  await p.evaluate(() => document.querySelector('#ougiBody [data-ougi-book="2"]').click());
  r = await p.evaluate(() => ({ heir: WD_DEBUG.combat.ougi.heir(), text: document.getElementById("ougiBody").textContent }));
  check(r.heir.sid === 2 && r.heir.book === 2 && /今の継承者：⚔ \S*朧/.test(r.text), "ボタンで継承すると、一覧の今の継承者が変わる", r.heir);
  await c.close();

  // 7. 使用回数：1回の挑戦で1回。途中で再読み込みしても復活しない。挑戦が終われば次の挑戦でまた使える
  ({ c, p } = await open({ ougi: twoBooks }));
  const startRun = () =>
    p.evaluate(() => {
      const S = WD_DEBUG.state;
      WD_DEBUG.trainingApi.startTraining("beginner");
      WD_DEBUG.squadApi.deployReserve(S().squads[0], 620, 300);
      for (const s of S().soldiers) s.cd = 1e9;
      document.getElementById("start").click();
      WD_DEBUG.stopSpawning();
      S().enemies.length = 0;
      WD_DEBUG.addEnemy({ d: 600, hp: 9e5, speed: 0, unitCd: 1e9 });
      WD_DEBUG.step(0.05);
      return WD_DEBUG.combat.ougi.state();
    });
  await p.evaluate(() => WD_DEBUG.combat.ougi.setHeir(1, { book: 1 }));
  r = await startRun();
  const runA = await p.evaluate(() => WD_DEBUG.combat.ougi.run());
  const used = await p.evaluate(() => ({ use: WD_DEBUG.combat.ougi.use(), again: WD_DEBUG.combat.ougi.use(), err: WD_DEBUG.combat.ougi.error(), run: WD_DEBUG.combat.ougi.save().run }));
  check(r.heirId === 1 && r.used === false && used.use && !used.again && used.err.includes("もう使いました"), "新しい挑戦では1回使える。同じ挑戦では2回発動できない", used);
  check(used.run && used.run.id === runA && used.run.used && /^ougi-run:/.test(runA), "使用記録は挑戦IDといっしょに保存する", used.run);
  r = await p.evaluate((id) => ({ same: WD_DEBUG.combat.ougi.runStart(id).used, other: WD_DEBUG.combat.ougi.runStart("ougi-run:other").used }), runA);
  check(r.same === true && r.other === false, "同じ挑戦IDなら使用済みを戻せる（将来の途中再開の用意）。別の挑戦IDなら戻さない", r);
  await reload(p);
  r = await startRun();
  const runB = await p.evaluate(() => WD_DEBUG.combat.ougi.run());
  const why = await p.evaluate(() => ({ err: WD_DEBUG.combat.ougi.error(), use: WD_DEBUG.combat.ougi.use() }));
  check(runB !== runA && r.used === false && why.err === null && why.use, "再読み込みのあと、新しく始めた挑戦は不当に使用済みにならない（新しい挑戦ID・1回使える）", { runA, runB, r, why });
  r = await p.evaluate(() => {
    const again = WD_DEBUG.combat.ougi.use();
    WD_DEBUG.trainingApi.endTraining("retreat");
    return { again, run: WD_DEBUG.combat.ougi.save().run };
  });
  const next = await startRun();
  check(!r.again && r.run.id === runB && r.run.used && r.run.ended && next.used === false, "挑戦が終わると使用記録を確定し、次の挑戦（新しいID）でまた1回使える", { r, next });
  // 戦死しても使用回数は戻らない
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi,
      S = WD_DEBUG.state,
      use = K.use(),
      s = S().soldiers.find((x) => x.id === 1),
      q = S().squads[0];
    s.hp = 0;
    WD_DEBUG.squadApi.killSoldier(s, q);
    return { use, state: K.state(), heir: K.heir(), books: K.save().books.length, err: K.error() };
  });
  check(r.use && r.state.used && r.heir === null && r.books === 2, "継承者が戦死すると指定は外れ、奥義書は倉庫に残る。使用回数は戻らない", r);
  await c.close();

  // 8. 戦死と復活の書：名前のある兵士の奥義の知識は、復活すると戻る（継承者には自動で戻らない）。名前のない兵士の知識は失われる
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi,
      D = WD_DEBUG,
      S = D.state,
      q = S().squads[0];
    K.grant(2, "tenkenRanbu");
    K.grant(3, "happouTenshou");
    K.setHeir(2, { k: "tenkenRanbu" });
    const s2 = S().soldiers.find((x) => x.id === 2),
      s3 = S().soldiers.find((x) => x.id === 3);
    s2.hp = 0;
    D.squadApi.killSoldier(s2, q);
    s3.hp = 0;
    D.squadApi.killSoldier(s3, q);
    const afterDeath = { heir: K.heir(), known: Object.keys(K.save().known) };
    D.gemApi.setGems({ jin: 1, gi: 1, rei: 1, chi: 1, chu: 1, shin: 1, ko: 1, tei: 1 });
    const craft = D.gemApi.craftScroll("revive"),
      err = D.gemApi.reviveFallen(2, q),
      back = S().soldiers.find((x) => x.alive && x.chronicle.life === "soldier:life2");
    return { afterDeath, craft, err, backId: back && back.id, known: back && K.known(back.id), heir: K.heir() };
  });
  check(r.afterDeath.heir === null && r.afterDeath.known.join() === "soldier:life2", "戦死：継承者の指定を外す。英霊名鑑に載らない兵士（名前なし）の奥義は失われる", r.afterDeath);
  check(!r.err && r.backId && r.known.join() === "tenkenRanbu" && r.heir === null, "復活の書で戻ると奥義の知識は戻るが、継承者には自動で戻らない", r);
  await reload(p);
  r = await p.evaluate(() => ({ known: Object.keys(WD_DEBUG.combat.ougi.save().known), heir: WD_DEBUG.combat.ougi.heir() }));
  check(r.known.join() === "soldier:life2" && r.heir === null, "再読み込みしても戦死・復活の結果は変わらない（データが矛盾しない）", r);
  await c.close();

  // 10. 閃きの確率：0.1%から、続けて外れた10回ごとに +0.1ポイント、最大2%。閃いたら外れた回数を0に。3つ覚えたら引かない
  ({ c, p } = await open());
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    return [0, 9, 10, 19, 20, 29, 50, 59, 100, 109, 189, 190, 500, 1e6].map((f) => Math.round(K.rateFor(f) * 1e4) / 1e4);
  });
  check(r.join() === "0.001,0.001,0.002,0.002,0.003,0.003,0.006,0.006,0.011,0.011,0.019,0.02,0.02,0.02", "確率：外れ0〜9回 0.1%・10〜19回 0.2%・20回台 0.3%・50回台 0.6%・100回台 1.1%・190回以上 2%（2%を超えない）", r);
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi,
      life = "soldier:life2",
      fails = () => K.save().fails[life] || 0;
    WD_DEBUG.trainingApi.startTraining("beginner");
    K.setRoll(() => 0.0015); // 0.1%では外れ、0.2%なら当たる値
    const out = [];
    for (let i = 0; i < 10; i++) out.push(K.roll(2));
    const f10 = fails(),
      rate10 = K.rate(2);
    const hit = K.roll(2); // 外れ10回 → 0.2% なので当たる
    const after = { fails: fails(), rate: K.rate(2), known: K.known(2) };
    K.setRoll(() => 0);
    K.roll(2);
    K.roll(2);
    const all = K.known(2).length,
      rolls = K.save().rolls[life];
    const none = K.roll(2),
      rolls2 = K.save().rolls[life];
    K.setRoll(null);
    return { misses: out.every((v) => v === null), f10, rate10, hit, after, all, none, rolls, rolls2, eligible: K.eligible(2) };
  });
  check(r.misses && r.f10 === 10 && r.rate10 === 0.002, "外れるたびに外れた回数を数え、10回で確率が0.2%に上がる", r);
  check(r.hit && r.after.fails === 0 && r.after.rate === 0.001 && r.after.known.length === 1, "閃くと外れた回数を0に戻し、確率も0.1%に戻る", r.after);
  check(r.all === 3 && r.none === null && r.rolls === r.rolls2 && r.eligible === false, "3つすべて覚えたら、もう抽選しない（回数も増えない）", r);
  await reload(p);
  r = await p.evaluate(() => ({ fails: WD_DEBUG.combat.ougi.save().fails, rolls: WD_DEBUG.combat.ougi.save().rolls["soldier:life2"] }));
  check(r.rolls === 13 && !r.fails["soldier:life2"], "抽選の回数と外れた回数は保存され、再読み込みでやり直せない", r);
  await c.close();

  // 11. 奥義書の倉庫：500冊まで。満杯なら引退を止める。処分は確認つき・継承中は処分できない・ほかの保存データは変わらない
  const full = {
    version: 1,
    seq: 500,
    books: Array.from({ length: 500 }, (_, i) => ({ uid: i + 1, k: ["happouTenshou", "mumyouIssen", "tenkenRanbu"][i % 3], from: "剣聖" + (i + 1), job: "sword_saint", level: 150 + i, at: 1 })),
    known: { "soldier:life1": { list: [{ k: "happouTenshou", at: 1 }] } },
    rolls: {},
    fails: {},
    heir: { sid: 2, k: "happouTenshou", book: 1 },
    run: null,
  };
  ({ c, p } = await open({ ougi: full }));
  const lbFull = await legendBookCount(p);
  const before = { s: await raw(p, SOLD), w: await raw(p, WAR) };
  r = await p.evaluate(() => {
    const K = WD_DEBUG.combat.ougi;
    return { n: K.save().books.length, heir: K.heir(), err: K.retire(1, 0), alive: WD_DEBUG.state().soldiers.some((x) => x.id === 1 && x.alive), n2: K.save().books.length };
  });
  check(r.n === 500 && r.heir.valid, "奥義書を500冊まで保存できる", r);
  check(typeof r.err === "string" && r.err.includes("いっぱい") && r.alive && r.n2 === 500, "倉庫が満杯のときは引退を止める（兵士はそのまま）", r);
  check((await raw(p, SOLD)) === before.s && (await raw(p, WAR)) === before.w && (await legendBookCount(p)) === lbFull, "止めた引退は、兵士・伝承の秘伝書の保存データを変えない");
  await p.evaluate(() => document.getElementById("soldiers").click());
  await p.evaluate(() => document.querySelector('#soldierList [data-retire="1"]').click());
  await p.evaluate(() => document.querySelector('[data-retire-pick="0"]').click());
  r = await p.evaluate(() => ({ warn: document.getElementById("retireBody").textContent.includes("倉庫がいっぱい"), go: !!document.querySelector("[data-retire-go]"), open: !!document.querySelector("[data-retire-ougi-open]") }));
  check(r.warn && !r.go && r.open, "引退の画面で、引退の前に倉庫が満杯と表示し、引退させるボタンを出さない（整理の画面へ）", r);
  await p.evaluate(() => document.querySelector("[data-retire-ougi-open]").click());
  r = await p.evaluate(() => {
    const t0 = performance.now();
    const body = document.getElementById("ougiBody");
    return {
      open: !document.getElementById("ougiSheet").hidden,
      cards: body.querySelectorAll(".ougi-card").length,
      del: body.querySelectorAll("[data-ougi-del]").length,
      activeNote: body.textContent.includes("継承中の奥義書は処分できません"),
      overflow: document.documentElement.scrollWidth - innerWidth,
      wide: [...body.querySelectorAll(".ougi-card")].slice(0, 5).some((el) => el.getBoundingClientRect().right > innerWidth + 1),
    };
  });
  check(r.open && r.cards === 500 && r.del === 499 && r.activeNote, "整理の画面：500冊の一覧。継承中の1冊は処分できない", r);
  check(r.overflow <= 0 && !r.wide, "iPhone縦（375px）で整理の画面がはみ出さない", r);
  r = await p.evaluate(() => ({ active: WD_DEBUG.combat.ougi.deleteBook(1), n: WD_DEBUG.combat.ougi.save().books.length }));
  check(typeof r.active === "string" && r.active.includes("継承中") && r.n === 500, "継承中の奥義書は、継承をやめるまで処分できない", r);
  await p.evaluate(() => document.querySelector('#ougiBody [data-ougi-del="2"]').click());
  r = await p.evaluate(() => ({ confirm: !!document.querySelector('#ougiBody [data-ougi-del-go="2"]'), n: WD_DEBUG.combat.ougi.save().books.length }));
  await p.evaluate(() => document.querySelector("#ougiBody [data-ougi-del-cancel]").click());
  const kept = await p.evaluate(() => WD_DEBUG.combat.ougi.save().books.length);
  check(r.confirm && r.n === 500 && kept === 500, "処分は確認つき（「処分…」→「処分する」。やめれば何も消えない）", { r, kept });
  await p.evaluate(() => document.querySelector('#ougiBody [data-ougi-del="2"]').click());
  await p.evaluate(() => document.querySelector('#ougiBody [data-ougi-del-go="2"]').click());
  r = await p.evaluate(() => ({ n: WD_DEBUG.combat.ougi.save().books.length, gone: !WD_DEBUG.combat.ougi.save().books.some((b) => b.uid === 2), heir: WD_DEBUG.combat.ougi.heir() }));
  check(r.n === 499 && r.gone && r.heir.valid, "確認すると1冊処分する（継承中の書・継承者はそのまま）", r);
  check((await raw(p, SOLD)) === before.s && (await raw(p, WAR)) === before.w, "奥義書の処分で、兵士・伝承の秘伝書の保存データは変わらない");
  r = await p.evaluate(() => ({ err: WD_DEBUG.combat.ougi.retire(1, 0), n: WD_DEBUG.combat.ougi.save().books.length }));
  check(r.err === null && r.n === 500 && (await legendBookCount(p)) === lbFull + 1, "空きができると引退でき、奥義書がまた500冊になる", r);
  await c.close();

  // 9. 旧版に戻したとき：旧版は奥義のキーを読まない。旧版で継承者が戦死・引退していたら、次に開いたときに直す
  const oldPlay = JSON.parse(JSON.stringify(save));
  oldPlay.soldiers = oldPlay.soldiers.filter((s) => s.id !== 1); // 旧版で継承者（1）が引退・戦死した
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(
    ([s, o]) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.s) return;
      sessionStorage.s = 1;
      localStorage.clear();
      localStorage.setItem("worldDefense.soldiers.v1", JSON.stringify(s));
      localStorage.setItem("worldDefense.warlords.v1", JSON.stringify({ version: 1, owned: {}, tickets: 3, history: [] }));
      localStorage.setItem("worldDefense.ougi.v1", JSON.stringify(o));
    },
    [oldPlay, { ...twoBooks, heir: { sid: 1, k: "happouTenshou", book: 1 }, known: { "soldier:life1": { list: [{ k: "mumyouIssen", at: 1 }] } } }],
  );
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "?debug");
  await p.waitForFunction(() => window.WD_DEBUG);
  r = await p.evaluate(() => ({ heir: WD_DEBUG.combat.ougi.heir(), save: WD_DEBUG.combat.ougi.save(), tx: localStorage.getItem("worldDefense.bookTransaction.v1") }));
  check(r.heir === null && r.save.books.length === 2 && !r.save.known["soldier:life1"] && r.tx === null, "旧版で継承者がいなくなっていたら指定を外す。奥義書は残る（先行ログには奥義を入れない）", r);
  await ctx.close();

  check(errors.length === 0, "ページのエラーなし", errors);
  console.log(`\n${n} 件すべて成功`);
} finally {
  await browser.close();
  server.close();
}
