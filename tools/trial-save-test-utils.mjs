import assert from "node:assert/strict";
// 経験値の正確な配布・成長・保存障害はtest-trial-carry-xpで検証する。
// 既存の遊び方のテストでは、持ち帰りEXP/熟練度・確定した奥義用戦歴を除き、
// 元から保存されている兵士・装備・通貨・奥義等が維持されることを比較する。
export async function trialAssetsPreserved(page, baseline) {
  const before = JSON.parse(baseline);
  const after = await page.evaluate(() =>
    Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
  );
  function subset(old, now, path = "") {
    // v123以降、試練の勝利で回復実績と奥義条件の戦歴も正式に確定する。
    // 減少・非数・上限超過は許さず、その他の戦歴は従来どおり厳密に比較する。
    if (/^soldiers\.soldiers\.\d+\.chronicle\.(healed|ougiRescues|ougiControlKills|ougiBlockWins|ougiGuardWins|ougiBossContrib)$/.test(path)) {
      assert.ok(Number.isFinite(now) && now >= old && now <= 1e12, path);
      return;
    }
    if (/^soldiers\.soldiers\.\d+\.chronicle\.segment$/.test(path) && JSON.stringify(now) !== JSON.stringify(old)) {
      assert.ok(now && /^trial:/.test(now.key) && now.finished === true && now.dead === false && now.ougi?.done === true, path + " must be a committed trial result");
      return;
    }
    if (/^soldiers\.soldiers\.\d+\.(xp|prof)$/.test(path)) {
      if (path.endsWith(".xp")) assert.ok(Number.isFinite(now) && now >= 0, path);
      else assert.ok(now && Object.values(now).every((v) => Number.isFinite(v) && v >= 0), path);
      return;
    }
    if (Array.isArray(old)) {
      assert.ok(Array.isArray(now), path);
      assert.equal(now.length, old.length, path);
      old.forEach((v, i) => subset(v, now[i], path + "." + i));
    } else if (old && typeof old === "object") {
      assert.ok(now && typeof now === "object", path);
      for (const [k, v] of Object.entries(old)) subset(v, now[k], path + "." + k);
    } else assert.deepEqual(now, old, path);
  }
  for (const [key, raw] of Object.entries(before)) {
    if (key === "worldDefense.soldiers.v1") subset(JSON.parse(raw), JSON.parse(after[key]), "soldiers");
    else if (key === "worldDefense.warlords.v1") subset(JSON.parse(raw), JSON.parse(after[key]), "heroes");
    else assert.equal(after[key], raw, key);
  }
  // 本番のセーブに挑戦限定の状態を持ち込まない。
  const saved = JSON.parse(after["worldDefense.soldiers.v1"] || '{"soldiers":[]}');
  for (const s of saved.soldiers) {
    for (const key of ["slv", "boons", "carryCoins", "trialShadow", "joinedAt", "atkMul", "rateMul"])
      assert.equal(s[key], undefined, "transient soldier field " + key);
  }
  return true;
}
