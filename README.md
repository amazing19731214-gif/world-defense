# world-defense
Tower Defense Game

ブラウザで遊べるタワーディフェンス。配布物は画像込みの単一ファイル `index.html` です
（GitHub Pages ではこのファイルをそのまま公開します）。

## 武将配属（v6）

- 「弓の名手」「砲術家」「軍師」の3人を最初から使えます（ガチャは未実装）。
- 建っている塔をタップ → パネルの「👤 武将配属」から配属。1基に1人、同じ武将は1か所だけ。
- 必殺技は塔パネルのボタンから（ウェーブ中のみ）。効果時間・再使用待ちは戦闘の時間で進み、
  停止中・ウェーブ間は止まり、x2 では2倍速で進みます。再配属しても再使用待ちはリセットされません。
- 塔を売却すると武将は未配属に戻ります。「最初から」で配属と必殺技の時間は初期化されます。
- 武将の数値は `src/index.template.html` の `HERO_CONFIG` / `HERO_RULES` にまとめてあります。
- 所持武将と最後に配属した武将は localStorage（`worldDefense.heroes.v1`）に保存。戦闘の途中保存はしません。

## ファイル構成

| パス | 内容 |
| --- | --- |
| `index.html` | **配布用（生成物）**。画像をすべて埋め込んだ単一ファイル |
| `src/index.template.html` | ゲーム本体のソース（編集はこちら） |
| `assets/manifest.json` | 画像の参照先の一覧 |
| `assets/sprites/`, `assets/heroes/` | 画像ファイル |
| `tools/build.mjs` | index.html の生成 |
| `tools/test.mjs` | 動作確認（Playwright, iPhone幅・タッチ操作） |
| `ASSET_SPEC.md` | 画像の仕様と差し替え手順 |

## 配布用 index.html の作り方

```sh
node tools/build.mjs            # src/ と assets/ から index.html を生成
node tools/build.mjs --check    # index.html が最新か確認
node tools/test.mjs             # 動作確認（要 Playwright）
```

iPhone から更新する場合は、生成済みの `index.html` をそのままアップロードすれば動きます。
`?debug` を付けて開いたときだけテスト用の `WD_DEBUG` が有効になります（通常プレイには影響しません）。
