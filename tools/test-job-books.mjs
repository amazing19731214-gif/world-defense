// 職業の書：全15職の条件・消費・旧セーブ、各戦場の実撃破、保存障害とリプレイ。
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
  W = "worldDefense.warlords.v1",
  S = "worldDefense.soldiers.v1",
  TX = "worldDefense.bookTransaction.v1";
let checks = 0;
const errors = [];
function check(v, label) {
  assert.ok(v, label);
  checks++;
  console.log("✓ " + label);
}
async function setup({ width = 390, debug = true, books = {}, known = [] } = {}) {
  const c = await browser.newContext({
    viewport: { width, height: 844 },
    isMobile: width < 700,
    hasTouch: width < 700,
  });
  await c.addInitScript(
    ({ W, S, books, known }) => {
      requestAnimationFrame = () => 0;
      if (sessionStorage.getItem("seed")) return;
      sessionStorage.setItem("seed", "1");
      localStorage.setItem(W, JSON.stringify({ forge: { jobBooks: books }, tickets: 2 }));
      localStorage.setItem("worldDefense.settings.v1", JSON.stringify({ auto: false, waveGoal: 1000 }));
      localStorage.setItem(
        S,
        JSON.stringify({
          seq: 2,
          squadSeq: 1,
          heroId: 1,
          squads: [{ id: 1, type: "ashigaru", slot: 0 }],
          soldiers: [1, 2].map((id) => ({
            id,
            type: "ashigaru",
            job: "ashigaru",
            jobs: ["ashigaru", ...known],
            squadId: 1,
            level: 200,
            bestLevel: 200,
            prof: { ashigaru: 8250 },
            skills: [],
            learned: [],
          })),
          fallen: [],
        }),
      );
    },
    { W, S, books, known },
  );
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url + (debug ? "?debug" : "?layout=classic"));
  return { p, c };
}
async function fault(p, key) {
  await p.evaluate((key) => {
    window.realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw Error("injected write failure");
      return window.realSet.call(this, k, v);
    };
  }, key);
}
async function unFault(p) {
  await p.evaluate(() => {
    Storage.prototype.setItem = window.realSet;
  });
}
const snapshot = (p) =>
  p.evaluate(() => ({
    books: { ...WD_DEBUG.forgeApi.save().jobBooks },
    claims: [...WD_DEBUG.forgeApi.save().jobBookClaims],
    job: WD_DEBUG.state().soldiers[0].job,
    jobs: WD_DEBUG.state().soldiers[0].jobs,
  }));
try {
  {
    const { p, c } = await setup();
    let r = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.jobBookApi,
        s = D.state().soldiers[0],
        F = D.forgeApi.save();
      const noBook = D.jobApi.changeJob(s, "samurai");
      F.jobBooks.samurai = 2;
      s.prof.ashigaru = 0;
      const noProf = D.jobApi.changeJob(s, "samurai");
      s.prof.ashigaru = 8250;
      s.level = 29;
      const low = D.jobApi.changeJob(s, "samurai");
      s.level = 200;
      const ok = D.jobApi.changeJob(s, "samurai"),
        left = F.jobBooks.samurai;
      const second = D.jobApi.changeJob(D.state().soldiers[1], "samurai");
      const back = D.jobApi.changeJob(s, "ashigaru");
      s.level = 1;
      const again = D.jobApi.changeJob(s, "samurai");
      return {
        noBook,
        noProf,
        low,
        ok,
        left,
        second,
        back,
        again,
        books: F.jobBooks,
        skills: s.learned,
        job: s.job,
      };
    });
    check(
      /の書/.test(r.noBook) && /熟練/.test(r.noProf) && /Lv30/.test(r.low),
      "書だけ・熟練だけ・Lv不足の初回転職を拒否",
    );
    check(
      r.ok === null && r.left === 1 && r.second === null && !r.books.samurai,
      "兵士ごとの初回転職で1冊ずつ消費",
    );
    check(r.back === null && r.again === null && r.job === "samurai", "就職済みならLv1・書0冊でも戻れる");
    await p.reload();
    r = await snapshot(p);
    check(
      r.job === "samurai" && r.jobs.includes("samurai") && !r.books.samurai,
      "転職・書の消費・解放履歴が再読込で一致",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const rows = await p.evaluate(() => {
      const D = WD_DEBUG,
        J = D.jobApi,
        A = D.jobBookApi,
        s = D.state().soldiers[0],
        F = D.forgeApi.save(),
        out = [];
      for (const [j, job] of Object.entries(J.JOBS).filter(([, v]) => v.advanced)) {
        s.job = "ashigaru";
        s.type = "ashigaru";
        s.jobs = ["ashigaru"];
        s.level = 200;
        s.prof = Object.fromEntries(Object.keys(J.JOBS).map((k) => [k, 12375]));
        F.jobBooks = {};
        const missing = J.changeJob(s, j);
        F.jobBooks[j] = 1;
        const req = A.ADVANCED_JOB_REQ[j] || D.insightApi.EVOLUTION_JOBS[j].req;
        s.prof[req[0][0]] = 0;
        const noProf = J.changeJob(s, j);
        s.prof[req[0][0]] = 12375;
        const ok = J.changeJob(s, j);
        out.push({ j, missing, noProf, ok, job: s.job, left: F.jobBooks[j] || 0 });
      }
      return out;
    });
    for (const r of rows)
      check(
        /書/.test(r.missing) && /熟練|進化/.test(r.noProf) && r.ok === null && r.job === r.j && r.left === 0,
        r.j + "：対応書・熟練条件・1冊消費",
      );
    const pools = await p.evaluate(() => {
      const A = WD_DEBUG.jobBookApi;
      return {
        early: A.dropPool(99),
        late: A.dropPool(100),
        modes: ["normal", "training", "siege", "hiei", "yomi", "fuji", "orochi"].map(
          (mode) => new Set(Array.from({ length: 3000 }, (_, i) => A.roll(mode + ":" + i, 100, mode))).size,
        ),
      };
    });
    check(pools.early.length === 8 && pools.late.length === 15, "Lv/WAVE100を境に上級8種→最上級を含む15種");
    check(
      pools.modes.every((n) => n === 15),
      "通常・修練場・全国・全裏ボスで全15職の書を入手可能",
    );
    await c.close();
  }
  {
    const { p, c } = await setup({ books: { samurai: 1 } });
    await fault(p, TX);
    const failed = await p.evaluate(() => WD_DEBUG.jobApi.changeJob(WD_DEBUG.state().soldiers[0], "samurai"));
    let r = await snapshot(p);
    check(
      /保存/.test(failed) && r.job === "ashigaru" && r.books.samurai === 1 && !r.jobs.includes("samurai"),
      "確定ログ失敗なら職業・書・履歴をすべて戻す",
    );
    check(
      !(await p.evaluate(() => WD_DEBUG.forgeApi.zukan().jobs.samurai)),
      "失敗した転職を職業図鑑に登録しない",
    );
    await unFault(p);
    await p.reload();
    r = await snapshot(p);
    check(r.job === "ashigaru" && r.books.samurai === 1, "保存失敗後の再読込でも消費しない");
    await c.close();
  }
  for (const key of [W, S]) {
    const { p, c } = await setup({ books: { samurai: 1 } });
    await fault(p, key);
    const r = await p.evaluate(() => ({
      err: WD_DEBUG.jobApi.changeJob(WD_DEBUG.state().soldiers[0], "samurai"),
      log: !!localStorage.getItem("worldDefense.bookTransaction.v1"),
    }));
    check(r.err === null && r.log, "確定後の転記失敗はログを正本にする：" + key);
    await unFault(p);
    await p.reload();
    const after = await snapshot(p);
    check(after.job === "samurai" && !after.books.samurai, "ログから職業と消費を同時復元：" + key);
    await c.close();
  }
  {
    const { p, c } = await setup({ known: ["samurai", "sword_saint"] });
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      s.level = 1;
      s.prof = {};
      return [D.jobApi.changeJob(s, "samurai"), D.jobApi.changeJob(s, "sword_saint")];
    });
    check(
      r.every((x) => x === null),
      "v81旧セーブの就職済み上級・最上級に書を遡及要求しない",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const r = await p.evaluate(() => {
      const A = WD_DEBUG.jobBookApi;
      return A.cleanJobBooks({ samurai: 1.8, ninja: -5, kibateppo: 1e9, unknown: 99, sohei: "3" });
    });
    check(
      r.samurai === 1 && r.kibateppo === 9999 && !r.ninja && !r.unknown && !r.sohei,
      "破損した書の個数・未知IDを正規化",
    );
    await p.locator("#start").click();
    let first = await p.evaluate(() => {
      const D = WD_DEBUG;
      D.stopSpawning();
      D.addEnemy({ kind: "boss", hp: 0 });
      D.step(0.1);
      return D.forgeApi.save().jobBookClaims.length;
    });
    check(first === 1, "通常防衛の実際の撃破処理で書を獲得");
    const before = await snapshot(p);
    await p.reload();
    await p.evaluate(() => {
      WD_DEBUG.jobBookApi.queue(WD_DEBUG.forgeApi.save().jobBookClaims[0], 1, "再評価");
    });
    check(
      JSON.stringify((await snapshot(p)).books) === JSON.stringify(before.books),
      "確定済み撃破の再評価・再読込で報酬を二重取得しない",
    );
    await p.locator("#start").click();
    await p.evaluate(() => {
      const D = WD_DEBUG;
      D.stopSpawning();
      D.state().enemies.length = 0;
      D.addEnemy({ kind: "goblin", hp: 0 });
      D.step(0.1);
    });
    check((await snapshot(p)).claims.length === 1, "通常兵の撃破は書を出さない");
    await c.close();
  }
  {
    const { p, c } = await setup();
    for (let i = 0; i < 4; i++) {
      await p.locator("#start").click();
      await p.evaluate(() => {
        const D = WD_DEBUG;
        D.stopSpawning();
        D.state().enemies.length = 0;
        D.step(0.1);
      });
    }
    await p.locator("#start").click();
    const first = await p.evaluate(() => {
      const D = WD_DEBUG;
      D.stopSpawning();
      D.state().enemies.length = 0;
      D.addEnemy({ kind: "goblin", hp: 10000, speed: 0 });
      D.addEnemy({ kind: "boss", hp: 0 });
      D.step(0.1);
      return { wave: D.state().wave, playing: D.state().playing, books: { ...D.forgeApi.save().jobBooks } };
    });
    check(
      first.wave === 5 && first.playing && Object.values(first.books).reduce((a, b) => a + b, 0) === 1,
      "WAVE5の戦闘中にボス報酬だけ先に保存",
    );
    await p.evaluate(() => {
      WD_DEBUG.forgeApi.save().jobBookClaims = [];
      WD_DEBUG.heroApi.persistHeroes();
    }); // recent receipts may rotate out after long training
    await p.reload();
    check(await p.evaluate(() => WD_DEBUG.state().wave === 4), "リロードは撃破前のWAVE4準備へ戻る");
    await p.locator("#start").click();
    await p.evaluate(() => {
      const D = WD_DEBUG;
      D.stopSpawning();
      D.state().enemies.length = 0;
      D.addEnemy({ kind: "boss", hp: 0 });
      D.step(0.1);
    });
    check(
      JSON.stringify((await snapshot(p)).books) === JSON.stringify(first.books),
      "受領印の整理後も同じWAVE5の再撃破では書は増えない",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    await fault(p, W);
    await p.evaluate(() => WD_DEBUG.jobBookApi.queue("save-fault", 100, "試験"));
    let r = await snapshot(p);
    check(
      Object.keys(r.books).length === 0 && r.claims.length === 0,
      "ドロップ保存失敗時は書と受領印を同時に戻す",
    );
    await unFault(p);
    await p.evaluate(() => WD_DEBUG.jobBookApi.flush());
    r = await snapshot(p);
    check(
      Object.values(r.books).reduce((a, b) => a + b, 0) === 1 && r.claims.includes("save-fault"),
      "保存待ちを再試行して1冊だけ獲得",
    );
    await p.reload();
    check(
      Object.values((await snapshot(p)).books).reduce((a, b) => a + b, 0) === 1,
      "ドロップ再試行後の再読込で1冊を保持",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const r = await p.evaluate(() => {
      const D = WD_DEBUG;
      D.trainingApi.startTraining("advanced");
      document.querySelector("#start").click();
      D.stopSpawning();
      D.addEnemy({ kind: "boss", hp: 0 });
      D.step(0.1);
      return { books: D.forgeApi.save().jobBooks, claims: D.forgeApi.save().jobBookClaims };
    });
    check(
      r.claims.some((k) => k.startsWith("training:")) &&
        Object.values(r.books).reduce((a, b) => a + b, 0) === 1,
      "修練場でも実際のボス撃破で永続の書を獲得",
    );
    await p.evaluate(() => WD_DEBUG.trainingApi.endTraining("retreat"));
    await p.reload();
    check(
      Object.values((await snapshot(p)).books).reduce((a, b) => a + b, 0) === 1,
      "修練場から撤退・再読込しても撃破済み報酬は残る",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.squadApi;
      const err = A.startBattle("okazaki"),
        B = A.battle(),
        e = B.garrison.find((e) => e.kind === "boss");
      if (!e) return { err, missing: true };
      e.hp = 1;
      A.battleHitGarrison(e, 1e9, null);
      A.battleHitGarrison(e, 1e9, null);
      return { err, books: D.forgeApi.save().jobBooks, drops: B.jobBookDrops };
    });
    check(
      r.err === null &&
        !r.missing &&
        r.drops.length === 1 &&
        Object.values(r.books).reduce((a, b) => a + b, 0) === 1,
      "全国の守備大将を実際に倒すと1冊・複数命中でも1回",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.squadApi;
      A.setBossTarget("orochi");
      const err = A.startBattle(),
        B = A.battle(),
        e = B.garrison[0];
      e.hp = 1;
      A.battleHitGarrison(e, 1e12, null);
      A.endBattle("win");
      return { err, books: D.forgeApi.save().jobBooks, drops: B.jobBookDrops };
    });
    check(
      r.err === null && r.drops.length === 1 && Object.values(r.books).reduce((a, b) => a + b, 0) === 1,
      "裏ボス撃破と勝利報酬の両方を通っても書は1冊",
    );
    await c.close();
  }
  {
    const { p, c } = await setup();
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        A = D.jobBookApi,
        F = D.forgeApi.save();
      const gid = Object.keys(D.forgeApi.GEAR).find((id) => D.forgeApi.GEAR[id].grade === 1);
      F.items = Array.from({ length: D.forgeApi.FORGE.maxItems }, (_, i) => ({
        uid: i + 1,
        id: gid,
        owner: null,
      }));
      A.queue("full-gear", 100, "倉庫満杯");
      const fullGear = Object.values(F.jobBooks).reduce((a, b) => a + b, 0);
      const j = A.roll("full-stock", 100);
      F.jobBooks[j] = 9999;
      A.queue("full-stock", 100, "書の在庫上限");
      const pending = A.pending(),
        stock = F.jobBooks[j];
      const s = D.state().soldiers[0];
      s.prof = Object.fromEntries(Object.keys(D.jobApi.JOBS).map((k) => [k, 12375]));
      return { fullGear, pending, stock, j, err: D.jobApi.changeJob(s, j) };
    });
    check(r.fullGear === 1, "装備倉庫が満杯でも別在庫に書を入手");
    check(r.pending === 1 && r.stock === 9999, "書の個数上限では受領を保留し超過・消失させない");
    const after = await snapshot(p);
    check(
      r.err === null && after.books[r.j] === 9999 && after.claims.includes("full-stock"),
      "転職で空いた在庫へ保留中の書を一度だけ保存",
    );
    await c.close();
  }
  for (const width of [375, 390, 430, 1280]) {
    const { p, c } = await setup({ width, debug: false, books: { kibateppo: 2 } });
    await p.locator("#gearOpen").click();
    await p.locator('[data-gear-tab="books"]').click();
    const r = await p.evaluate(() => ({
      text: document.querySelector("#gearBody").innerText,
      fit: document.documentElement.scrollWidth <= innerWidth,
    }));
    check(
      r.fit && r.text.includes("騎馬鉄砲の書") && r.text.includes("×2") && r.text.includes("初回転職"),
      width + "px通常URL：書の在庫・条件・入手先を表示",
    );
    await c.close();
  }
  check(errors.length === 0, "JavaScriptエラーなし：" + errors.join(","));
  console.log(`${checks} passed, 0 failed`);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
