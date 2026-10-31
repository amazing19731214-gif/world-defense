// テストプレイ版（node tools/build.mjs --test）だけに入る。本番の index.html には入らない。
// 保存領域の分離：このページの localStorage の読み書きは、すべてキーの頭に「wdtest:」を付けた別の場所に向ける。
//   ・本番のキー（worldDefense.*）は読まない・書かない・消さない（同じ場所で開いても混ざらない）
//   ・length・key()・clear() も「wdtest:」のキーだけを数える・消す
//   ・テスト用のホスト（本番の公開サイトとは別のオリジン）で開くので、二重の分離になる
(() => {
  const P = "wdtest:",
    S = Storage.prototype,
    raw = {
      get: S.getItem,
      set: S.setItem,
      remove: S.removeItem,
      key: S.key,
      clear: S.clear,
      length: Object.getOwnPropertyDescriptor(S, "length").get,
    };
  let local = null;
  try {
    local = window.localStorage;
  } catch (err) {
    local = null; // 保存が使えない環境（プライベートなど）は、そのまま
  }
  const isLocal = (st) => !!local && st === local;
  const keys = (st) => {
    const out = [];
    const n = raw.length.call(st);
    for (let i = 0; i < n; i++) {
      const k = raw.key.call(st, i);
      if (k && k.startsWith(P)) out.push(k.slice(P.length));
    }
    return out;
  };
  S.getItem = function (k) {
    return isLocal(this) ? raw.get.call(this, P + k) : raw.get.call(this, k);
  };
  S.setItem = function (k, v) {
    return isLocal(this) ? raw.set.call(this, P + k, v) : raw.set.call(this, k, v);
  };
  S.removeItem = function (k) {
    return isLocal(this) ? raw.remove.call(this, P + k) : raw.remove.call(this, k);
  };
  S.key = function (i) {
    return isLocal(this) ? (keys(this)[i] ?? null) : raw.key.call(this, i);
  };
  S.clear = function () {
    if (!isLocal(this)) return raw.clear.call(this);
    for (const k of keys(this)) raw.remove.call(this, P + k); // テストのキーだけを消す
  };
  Object.defineProperty(S, "length", {
    configurable: true,
    get() {
      return isLocal(this) ? keys(this).length : raw.length.call(this);
    },
  });
  window.WD_TEST_BUILD = true;
  window.WD_TEST_STORAGE = { prefix: P, keys: () => (local ? keys(local) : []), raw };
})();
