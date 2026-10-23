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

## 路上配置の兵士（v7）

- 塔に配属する「武将」とは別システム。兵士ボタン（足軽・弓兵）を選び、**道をタップ**すると中心線に合わせて配置。
  草地・マップ外・入口付近・城の直前・ほかの兵士の近くには置けない（選択中は配置不可の区間を赤く表示）。
- 同時に4人まで。兵士をタップするとHPと「撤退」（費用×50%×残りHP割合を返金）。
- 足軽：触れた敵1体を足止めして近接攻撃。足止め上限を超えた敵・ドラゴンは通過。反撃を受けHP0で退場。
- 弓兵：射程内の敵に矢。足止めしない。近くを通る敵から攻撃を受ける。
- 撤退・戦闘不能の後は兵種ごとに再配置待ち（戦闘の時間で進行、停止中は止まる、x2で2倍速、ウェーブ間も止まる）。
- 数値は `src/index.template.html` の `UNIT_RULES` / `UNIT_CONFIG` / `ENEMY_VS_UNIT`。
  槍兵・鉄砲隊・騎馬兵は画像のみ保持（`enabled: false`）。

## ファイル構成

| パス | 内容 |
| --- | --- |
| `index.html` | **配布用（生成物）**。画像をすべて埋め込んだ単一ファイル |
| `src/index.template.html` | ゲーム本体のソース（編集はこちら） |
| `assets/manifest.json` | 画像の参照先の一覧 |
| `assets/sprites/`, `assets/heroes/`, `assets/units/` | 画像ファイル |
| `tools/build.mjs` | index.html の生成 |
| `tools/test.mjs` | 動作確認：塔・武将・20ウェーブ（Playwright, iPhone幅・タッチ操作） |
| `tools/test-units.mjs` | 動作確認：路上配置の兵士 |
| `ASSET_SPEC.md` | 画像の仕様と差し替え手順 |

## 配布用 index.html の作り方

```sh
node tools/build.mjs            # src/ と assets/ から index.html を生成
node tools/build.mjs --check    # index.html が最新か確認
node tools/test.mjs             # 動作確認（要 Playwright）
node tools/test-units.mjs       # 兵士の動作確認
```

iPhone から更新する場合は、生成済みの `index.html` をそのままアップロードすれば動きます。
`?debug` を付けて開いたときだけテスト用の `WD_DEBUG` が有効になります（通常プレイには影響しません）。
