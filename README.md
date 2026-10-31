# WORLD DEFENSE テストプレイ版（戦場試練）

このブランチ（`trial-test-preview`）は、iPhone の Safari で「⚔️ 戦場試練」をテストプレイするための**配信専用のブランチ**です。本番のゲーム（main・GitHub Pages）とは関係ありません。

- 中身：`index.html` 1つ。Draft PR #127〜#133 と Phase 4.1（サバイバル：主人公1人＋仲間4人）の機能を含むテスト用ビルドです（`node tools/build.mjs --test` で作成）。
- 開くURL：<https://raw.githack.com/amazing19731214-gif/world-defense/trial-test-preview/index.html>
  - 最初に raw.githack.com の注意の画面「External Content Notice」が出たら、「Open the page」を押してください。
  - このブランチに push するたびに、GitHub Actions「テスト配信の確認」が、このURLを iPhone 13 相当の WebKit と Chromium で開いて操作し、確かめます。
  - raw.githack.com（無料・登録不要）が、このブランチの `index.html` をそのまま配信します。
  - 本番の公開サイト（amazing19731214-gif.github.io）とは別のオリジンです。
- 保存：このページは、すべてのキーの頭に `wdtest:` を付けた別の保存領域だけを使います。本番の保存データは読まない・書かない・消さない。
- 停止・削除：このブランチを削除すると配信が止まります（raw.githack の短い保存期間のあと見られなくなります）。

- Phase 4 の遊び方：戦闘中に下の兵士の名前（または戦場の兵士）を押すと、その兵士を左下のスティックで動かせます。攻撃と技は自動です。「🤖 全員自動」で全員を AI に戻します。

- Phase 4.1 の遊び方：「⚔️ 戦場試練」の画面の上で「🔥 サバイバル」を押し、兵士を選んで「👑 主人公」を1人決めて開始。主人公をスティックで動かします（攻撃と技は自動・仲間はついてくる）。2分30秒で強敵が出て、倒せば勝利。

**マージしないでください。** このブランチは main とつながっていない（履歴が別の）配信専用のブランチです。
