import assert from "node:assert/strict";
import fs from "node:fs";
import { harness } from "./chronicle-test-utils.mjs";
const H = await harness();
let n = 0;
const check = (v, t) => {
  assert.ok(v, t);
  n++;
  console.log("✓ " + t);
};
const keys = ["hp", "atk", "def", "heal"];
const seed = (value = 1) => ({
  seq: 2,
  squadSeq: 1,
  heroId: 1,
  squads: [{ id: 1, type: "medic", slot: 0 }],
  soldiers: [1, 2].map((id) => ({
    id,
    type: "medic",
    job: "medic",
    squadId: 1,
    level: 40,
    skills: [],
    learned: [],
    fruit: { hp: 2, atk: 3, def: 4, rng: 5 },
    chronicle: {
      life: "fruit-test:" + id,
      aptitude: {
        version: 1,
        type: "balanced",
        level: 40,
        startAt: 40,
        ranks: {
          version: 1,
          level: 40,
          startAt: 40,
          values: { hp: value, atk: value, def: value, heal: value },
          gains: {},
        },
      },
    },
  })),
  fallen: [],
});
async function setup(value = 1) {
  const result = await H.setup(seed(value));
  const { p } = result;
  await p.evaluate(() => {
    const key = "worldDefense.warlords.v1",
      d = JSON.parse(localStorage.getItem(key));
    d.forge = { ...d.forge, koban: 100000, fruits: { hp: 20, atk: 20, def: 20, heal: 20, rng: 20 } };
    localStorage.setItem(key, JSON.stringify(d));
  });
  await p.reload();
  return result;
}
const snapshot = async (p) =>
  p.evaluate(() => ({
    soldiers: localStorage.getItem("worldDefense.soldiers.v1"),
    heroes: localStorage.getItem("worldDefense.warlords.v1"),
  }));
const fail = async (p, on, mode = "all") =>
  p.evaluate(
    ({ on, mode }) => {
      if (on) {
        window.originalSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (
            String(k).startsWith("worldDefense.") &&
            (mode === "all" || k === "worldDefense.warlords.v1" || k === "worldDefense.soldiers.v1")
          )
            throw Error("QuotaExceededError");
          return window.originalSet.call(this, k, v);
        };
      } else Storage.prototype.setItem = window.originalSet;
    },
    { on, mode },
  );
try {
  {
    const { p, c } = await setup();
    const baseline = await p.evaluate(() => WD_DEBUG.squadApi.soldierStats(WD_DEBUG.state().soldiers[0]));
    for (const k of keys)
      for (let rank = 1; rank < 10; rank++) {
        const r = await p.evaluate(
          ({ k, rank }) => {
            const D = WD_DEBUG,
              s = D.state().soldiers[0],
              e = D.legendApi.useFruit(s, k);
            return { e, rank: D.chronicleApi.growthRanks(s).values[k], stock: D.forgeApi.save().fruits[k] };
          },
          { k, rank },
        );
        check(
          r.e === null && r.rank === rank + 1 && r.stock === 20 - rank,
          k + "適性を" + rank + "から1ランク上げ、実を1個だけ消費",
        );
      }
    const before = await snapshot(p);
    for (const k of keys) {
      const r = await p.evaluate((k) => {
        const D = WD_DEBUG,
          s = D.state().soldiers[0];
        return {
          e: D.legendApi.useFruit(s, k),
          rank: D.chronicleApi.growthRanks(s).values[k],
          stock: D.forgeApi.save().fruits[k],
        };
      }, k);
      check(/S/.test(r.e) && r.rank === 10 && r.stock === 11, k + "がSなら使用不可・消費なし");
    }
    check(JSON.stringify(await snapshot(p)) === JSON.stringify(before), "Sへの使用で保存を変更しない");
    check(
      JSON.stringify(await p.evaluate(() => WD_DEBUG.squadApi.soldierStats(WD_DEBUG.state().soldiers[0]))) ===
        JSON.stringify(baseline),
      "実を使っても過去の成長と旧仕様の実の能力補正を変更しない",
    );
    await p.reload();
    check(
      await p.evaluate(
        () =>
          Object.values(WD_DEBUG.chronicleApi.growthRanks(WD_DEBUG.state().soldiers[0]).values).every(
            (v) => v === 10,
          ) && Object.values(WD_DEBUG.forgeApi.save().fruits).join() === "11,11,11,11,20",
      ),
      "再読込でSと残り個数を保持",
    );
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0],
        before = { ...D.chronicleApi.growthRanks(s).gains },
        lv = s.level;
      s.level++;
      D.chronicleApi.grow(s, lv);
      const after = D.chronicleApi.growthRanks(s);
      return {
        hp: after.gains.hp - (before.hp || 0),
        heal: after.gains.heal - (before.heal || 0),
        def: after.gains.def - (before.def || 0),
        fruit: s.fruit,
      };
    });
    check(
      r.hp === 10 && r.heal === 10 && r.def === 10,
      "次のレベルアップから新しい成長適性でHP・回復・防御が伸びる",
    );
    check(
      JSON.stringify(r.fruit) === '{"atk":3,"def":4,"hp":2,"rng":5}' ||
        Object.entries({ hp: 2, atk: 3, def: 4, rng: 5 }).every(([k, v]) => r.fruit[k] === v),
      "旧仕様の実の食べた数を維持",
    );
    check(
      await p.evaluate(() => {
        const D = WD_DEBUG,
          s = D.state().soldiers[0];
        D.chronicleApi.resetGrowth(s);
        return Object.values(D.chronicleApi.growthRanks(s).values).every((v) => v === 10);
      }),
      "主人公の成長リセットでも向上した適性は残る",
    );
    await c.close();
  }
  {
    const { p, c } = await setup(9),
      before = await snapshot(p);
    await fail(p, true);
    for (const k of keys) {
      const r = await p.evaluate((k) => {
        const D = WD_DEBUG,
          s = D.state().soldiers[0];
        return {
          e: D.legendApi.useFruit(s, k),
          rank: D.chronicleApi.growthRanks(s).values[k],
          stock: D.forgeApi.save().fruits[k],
        };
      }, k);
      check(
        /保存できなかった/.test(r.e) && r.rank === 9 && r.stock === 20,
        k + "保存失敗で適性・在庫をロールバック",
      );
    }
    await fail(p, false);
    check(JSON.stringify(await snapshot(p)) === JSON.stringify(before), "保存失敗で永続データを変えない");
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      D.forgeApi.save().koban += 1;
      return {
        e: D.legendApi.buyFruit("rng"),
        rank: D.chronicleApi.growthRanks(s).values.hp,
        stock: D.forgeApi.save().fruits.hp,
      };
    });
    check(r.e === null && r.rank === 9 && r.stock === 20, "後続の別保存で失敗した成長効果・消費が復活しない");
    check(
      await p.evaluate(() => WD_DEBUG.legendApi.useFruit(WD_DEBUG.state().soldiers[0], "hp") === null),
      "保存復旧後に同じ実を正常使用できる",
    );
    await p.reload();
    check(
      await p.evaluate(
        () =>
          WD_DEBUG.chronicleApi.growthRanks(WD_DEBUG.state().soldiers[0]).values.hp === 10 &&
          WD_DEBUG.forgeApi.save().fruits.hp === 19,
      ),
      "再試行後の再読込でも1ランク・1個だけ反映",
    );
    await c.close();
  }
  {
    const { p, c } = await setup(8);
    await fail(p, true, "copies");
    check(
      await p.evaluate(() => WD_DEBUG.legendApi.useFruit(WD_DEBUG.state().soldiers[0], "heal") === null),
      "保存ログ確定後の転記失敗では使用成功として扱う",
    );
    await fail(p, false);
    await p.reload();
    check(
      await p.evaluate(
        () =>
          WD_DEBUG.chronicleApi.growthRanks(WD_DEBUG.state().soldiers[0]).values.heal === 9 &&
          WD_DEBUG.forgeApi.save().fruits.heal === 19,
      ),
      "転記失敗後の再読込は適性・消費をまとめて1回だけ復元",
    );
    const [stale] = await Promise.all([c.waitForEvent("page"), p.evaluate(() => window.open(location.href))]);
    stale.on("pageerror", (e) => H.errors.push(e.message));
    await stale.goto(p.url());
    await stale.waitForFunction(() => window.WD_DEBUG);
    check(
      await p.evaluate(() => WD_DEBUG.legendApi.useFruit(WD_DEBUG.state().soldiers[0], "atk") === null),
      "先行タブで成長の実を使用",
    );
    const r = await stale.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0];
      return {
        e: D.legendApi.useFruit(s, "hp"),
        rank: D.chronicleApi.growthRanks(s).values.hp,
        stock: D.forgeApi.save().fruits.hp,
      };
    });
    check(
      /保存できなかった|再読み込み/.test(r.e) && r.rank === 8 && r.stock === 20,
      "古いタブでの使用は拒否し、適性・在庫を元に戻す",
    );
    await p.reload();
    check(
      await p.evaluate(() => {
        const D = WD_DEBUG,
          r = D.chronicleApi.growthRanks(D.state().soldiers[0]).values;
        return (
          r.atk === 9 &&
          r.hp === 8 &&
          D.forgeApi.save().fruits.atk === 19 &&
          D.forgeApi.save().fruits.hp === 20
        );
      }),
      "古いタブから先行タブの成功を上書きしない",
    );
    await c.close();
  }
  {
    const { p, c } = await setup(8);
    const r = await p.evaluate(() => {
      const D = WD_DEBUG,
        s = D.state().soldiers[0],
        before = D.squadApi.soldierStats(s),
        grades = JSON.stringify(D.chronicleApi.growthRanks(s).values),
        e = D.legendApi.useFruit(s, "rng");
      return {
        e,
        delta: D.squadApi.soldierStats(s).range - before.range,
        unchanged: grades === JSON.stringify(D.chronicleApi.growthRanks(s).values),
        count: s.fruit.rng,
      };
    });
    check(
      r.e === null && Math.abs(r.delta - 1) < 1e-8 && r.unchanged && r.count === 6,
      "射程の実は従来どおり射程+1で成長適性を変えない",
    );
    await p.locator("#gearOpen").click();
    await p.locator('[data-gear-tab="shop"]').click();
    await p.locator('[data-fruit-pick="heal"]').click();
    check(
      /回復適性 B → A/.test(await p.locator("#gearBody").innerText()),
      "回復の実の使用候補に現在ランクと次ランクを表示",
    );
    await p.evaluate(() => {
      WD_DEBUG.state().soldiers[1].chronicle.kills = 99;
    });
    await p.locator('[data-fruit-to="heal"][data-to="2"]').click();
    check(
      await p.evaluate(
        () => WD_DEBUG.chronicleApi.growthRanks(WD_DEBUG.state().soldiers[1]).values.heal === 9,
      ),
      "画面から回復の実を兵士に使える",
    );
    check(
      await p.evaluate(() => {
        const saved = JSON.parse(localStorage.getItem("worldDefense.soldiers.v1")).soldiers.find(
          (s) => s.id === 2,
        );
        return (
          WD_DEBUG.state().soldiers[1].chronicle.kills === 99 &&
          saved.chronicle.kills === 0 &&
          saved.chronicle.aptitude.ranks.values.heal === 9
        );
      }),
      "実の使用で未確定の戦歴を保存せず、成長適性だけを確定する",
    );
    for (const width of [375, 390, 430, 1280]) {
      await p.setViewportSize({ width, height: 844 });
      check(
        await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "商店" + width + "pxで横はみ出しなし",
      );
      if (process.env.SCREENSHOTS) {
        fs.mkdirSync(process.env.SCREENSHOTS, { recursive: true });
        await p.screenshot({ path: process.env.SCREENSHOTS + "/growth-fruit-" + width + ".png" });
      }
    }
    await c.close();
  }
  check(!H.errors.length, "JavaScriptエラーなし：" + H.errors.join(","));
  console.log("結果: " + n + " 件成功 / 0 件失敗");
} finally {
  await H.close();
}
