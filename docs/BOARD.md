# 💬 掲示板（プレイヤーどうしの交流）

メニューの「記録・その他」にある **💬 掲示板** から開きます。書きこみは Firebase（Google のサービス）の Firestore に置きます。
プレイヤーは登録なしで書きこめます（匿名ログイン）。

`src/board.js` の `BOARD.config` が `null` のあいだは「準備中」と出るだけで、外へは何も通信しません。

## 仕様

| 項目 | 値 |
| --- | --- |
| 名前 | 12文字まで。空なら「名無しの足軽」。端末に覚えておく |
| 本文 | 140文字まで。改行できる |
| 表示 | 新しい順に50件。時刻は「いま／○分前／○時間前／月/日」 |
| 連続投稿 | 30秒あける（画面とルールの両方で止める） |
| 書きこめないもの | URL、NGことば（`BOARD.ng`。ひらがな・カタカナ・空白を区別せず探す）、同じ文字の10回以上の連続 |
| 通報 | 1人1回。3人に通報された書きこみは「表示していません」になる（本人には見える） |
| 消す | 自分の書きこみだけ。運営は Firebase の画面からどれでも消せる |

## 運営の準備（Firebase）

1. <https://console.firebase.google.com/> で「プロジェクトを作成」（Google アナリティクスはオフでよい）。
2. 「構築 → Authentication → 始める → ログイン方法 → 匿名」を有効にする。
3. 「構築 → Firestore Database → データベースの作成」。場所は `asia-northeast1`（東京）、「本番環境モード」で作る。
4. Firestore の「ルール」に下のルールを貼って「公開」。
5. 「プロジェクトの設定 → 全般 → マイアプリ → ウェブ（</>）」でアプリを登録し、表示される `firebaseConfig`（apiKey・authDomain・projectId・storageBucket・messagingSenderId・appId）を `BOARD.config` に入れる。
   これらの値はページに載せて公開してよい値です（守りは下のルールで行います）。
6. 「Authentication → 設定 → 承認済みドメイン」に `amazing19731214-gif.github.io` を追加する。

無料のプラン（Spark）のままで使えます。目安：1日あたり読みこみ5万件・書きこみ2万件まで。

## Firestore のルール

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{id} {
      allow read: if true;
      // 書きこみ：本人・文字数・時刻・通報なしで作る。users の最終投稿時刻を同時に更新していること（30秒あけるルールは users 側）
      allow create: if request.auth != null
        && request.resource.data.keys().hasOnly(['name', 'text', 'uid', 'createdAt', 'reportedBy'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 12
        && request.resource.data.text is string && request.resource.data.text.size() > 0 && request.resource.data.text.size() <= 140
        && request.resource.data.createdAt == request.time
        && request.resource.data.reportedBy == []
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.last == request.time;
      // 自分の書きこみだけ消せる
      allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
      // 通報：reportedBy に自分を1人だけ足す（ほかは変えられない）
      allow update: if request.auth != null
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reportedBy'])
        && !(request.auth.uid in resource.data.reportedBy)
        && request.resource.data.reportedBy.size() == resource.data.reportedBy.size() + 1
        && request.resource.data.reportedBy.hasAll(resource.data.reportedBy)
        && request.auth.uid in request.resource.data.reportedBy;
    }
    // 最終投稿時刻（連続投稿を30秒あける）。だれも読めない
    match /users/{uid} {
      allow read: if false;
      allow write: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['last'])
        && request.resource.data.last == request.time
        && (resource == null || request.time > resource.data.last + duration.value(30, 's'));
    }
  }
}
```

## 試験

`node tools/test-board.mjs` … 本物の Firebase にはつながず、作り物の置き場（`window.WD_BOARD_BACKEND`）で、表示・書きこみ・NGことば・URL・連続投稿・通報・削除・HTMLが文字のまま出ることを確かめる。
