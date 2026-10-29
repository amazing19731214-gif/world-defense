import assert from "node:assert/strict";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
try {
  const { p, c } = await H.setup();
  let r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    const stats = Q.soldierStats(s);
    Q.saveRoster();
    return {
      retro: s.chronicle.honors,
      pending: s.chronicle.pending,
      same: JSON.stringify(stats) === JSON.stringify(Q.soldierStats(s)),
    };
  });
  check(
    r.retro.includes("kills1000") && r.pending.length === 0,
    "過去討伐は称号のみ遡及し記念装備を配らない",
  );
  check(r.same, "称号で能力が変化しない");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    A.of(s).kills = 100;
    Q.saveRoster();
    return { pending: s.chronicle.pending, err: A.title(s, "kills100"), title: s.chronicle.selected };
  });
  check(
    r.pending.includes("kills100") && r.title === "kills100" && !r.err,
    "達成後の受取待ちと称号選択を保存",
  );
  await p.reload();
  check(
    await p.evaluate(() => WD_DEBUG.state().soldiers[0].chronicle.selected === "kills100"),
    "称号の表示選択を再読込後も保持",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      F = D.forgeApi.save(),
      s = D.state().soldiers[0];
    const old = F.items;
    F.items = Array.from({ length: D.forgeApi.FORGE.maxItems }, (_, i) => ({
      uid: i + 1,
      id: "uchigatana",
      owner: null,
      lock: false,
    }));
    const err = A.claim(s, "kills100");
    const pending = s.chronicle.pending.includes("kills100");
    F.items = old;
    return { err, pending };
  });
  check(/いっぱい/.test(r.err) && r.pending, "倉庫満杯で報酬が消えず受取待ちに残る");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers[0];
    window.originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === "worldDefense.bookTransaction.v1") throw Error("fault");
      return originalSet.call(this, k, v);
    };
    const before = D.forgeApi.save().items.length,
      err = A.claim(s, "kills100");
    Storage.prototype.setItem = originalSet;
    return {
      err,
      same: D.forgeApi.save().items.length === before,
      pending: s.chronicle.pending.includes("kills100"),
    };
  });
  check(r.err && r.same && r.pending, "保存失敗時は報酬と受取権を両方ロールバック");
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      s = D.state().soldiers[0];
    const err = A.claim(s, "kills100"),
      again = A.claim(s, "kills100");
    return {
      err,
      again,
      count: D.forgeApi.save().items.filter((x) => x.id === "chronicleBlade").length,
      lock: D.forgeApi.save().items.find((x) => x.id === "chronicleBlade")?.lock,
    };
  });
  check(!r.err && r.again && r.count === 1 && r.lock, "成功時はロック付き記念武器を一度だけ発行");
  await p.reload();
  check(
    await p.evaluate(
      () =>
        WD_DEBUG.chronicleApi.claim(WD_DEBUG.state().soldiers[0], "kills100") !== null &&
        WD_DEBUG.forgeApi.save().items.filter((x) => x.id === "chronicleBlade").length === 1,
    ),
    "リロード後も二重受取を拒否",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0];
    s.chronicle.healed = 10000;
    s.chronicle.rescues = 10;
    s.chronicle.survivedSingle = 1;
    Q.saveRoster();
    A.open("live");
    return { honors: s.chronicle.honors, pending: s.chronicle.pending };
  });
  check(
    r.honors.includes("heal10000") && r.honors.includes("rescue10") && r.honors.includes("single"),
    "回復・救命・一桁生還に称号と報酬を用意",
  );
  await p.locator(".chronicle-honors").first().locator("summary").click();
  check((await p.locator("[data-chronicle-reward]").count()) > 0, "スマホの兵士詳細から報酬を受け取れる");
  check(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    "390px幅で横にはみ出さない",
  );
  r = await p.evaluate(() => {
    const D = WD_DEBUG,
      A = D.chronicleApi,
      Q = D.squadApi,
      s = D.state().soldiers[0],
      q = D.state().squads[0];
    const life = s.chronicle.life;
    s.hp = 0;
    Q.killSoldier(s, q);
    const err = D.gemApi.reviveFallen(s.id, q);
    const back = D.state().soldiers.find((x) => x.alive && x.chronicle.life === life);
    Q.saveRoster();
    return {
      err,
      back: !!back,
      claimed: back?.chronicle.claimed.includes("kills100"),
      retry: back ? A.claim(back, "kills100") : null,
      revived: back?.chronicle.honors.includes("revived"),
    };
  });
  check(
    !r.err && r.back && r.claimed && r.retry && r.revived,
    "復活後も受取済みを維持し黄泉帰りの称号を獲得",
  );
  await c.close();
  check(H.errors.length === 0, "ブラウザJavaScriptエラーなし：" + H.errors.join(","));
  console.log("全" + n + "項目が成功");
} finally {
  await H.close();
}
