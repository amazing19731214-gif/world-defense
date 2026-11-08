        // ===== 💬 掲示板（プレイヤーどうしの交流） =====
        // 書きこみは Firebase（Firestore）に置く。プレイヤーは登録なしで書きこめる（匿名ログイン）。
        // BOARD.config に Firebase のウェブアプリの設定（apiKey など。ページに載せて公開してよい値）を入れると動く。
        // null のあいだは「準備中」と出るだけで、外へは何も通信しない。
        // 荒らし対策：文字数の上限・NGことば・URL禁止・連続投稿の間隔（Firestore のルールでも同じ間隔を強制）・
        //   通報が hideAt 人に達した書きこみは隠す・自分の書きこみは消せる。運営は Firebase の画面から消せる。
        // 試験では window.WD_BOARD_BACKEND に作り物の置き場を入れて動かす（本物の Firebase へはつながない）。
        const BOARD = {
          config: null,
          sdk: "https://www.gstatic.com/firebasejs/10.12.2/",
          nameMax: 12, // 名前の文字数
          textMax: 140, // 本文の文字数
          show: 50, // 新しい順に表示する件数
          cooldown: 30, // 次に書きこめるまでの秒数（ルール側も30秒）
          hideAt: 3, // この人数に通報されたら隠す
          defaultName: "名無しの足軽",
          nameKey: "worldDefense.boardName.v1",
          lastKey: "worldDefense.boardLast.v1",
          // 書きこめないことば（ひらがな・カタカナ・大文字小文字・空白を区別せずに探す）。
          // 「ばか（ばかり）」「えろ（かえろう）」「しね（ですしね）」のように、ふつうの文に入ってしまう短いことばは入れない
          ng: ["死ね", "氏ね", "殺す", "ころす", "殺してやる", "きもい", "うざい", "くたばれ", "ちんこ", "まんこ", "せっくす", "がいじ", "害児", "きちがい", "気違い", "fuck", "shit"],
        };
        let boardApi = null, boardReady = null, boardPosts = [], boardUid = "", boardStop = null, boardErr = "";
        const boardNorm = (s) =>
          String(s)
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // カタカナ → ひらがな
            .replace(/[\s・。、！？!?.,ー〜~_\-]/g, "");
        function boardCheck(name, text) {
          name = String(name || "").trim();
          text = String(text || "").trim();
          if (!text) return { error: "本文を書いてね。" };
          if (text.length > BOARD.textMax) return { error: "本文は" + BOARD.textMax + "文字までです。" };
          if (name.length > BOARD.nameMax) return { error: "名前は" + BOARD.nameMax + "文字までです。" };
          if (/https?:|www\.|\.(com|net|jp|org|io|ly)\b/i.test(name + " " + text)) return { error: "URL（リンク）は書きこめません。" };
          const all = boardNorm(name + text);
          if (BOARD.ng.some((w) => all.includes(boardNorm(w)))) return { error: "使えないことばが入っています。やさしいことばで書いてね。" };
          if (/(.)\1{9,}/.test(text)) return { error: "同じ文字の連続が多すぎます。" };
          const wait = boardWait();
          if (wait > 0) return { error: "連続では書きこめません。あと" + wait + "秒まってね。" };
          return { name: name || BOARD.defaultName, text };
        }
        function boardWait() {
          let last = 0;
          try { last = +localStorage.getItem(BOARD.lastKey) || 0; } catch (e) {}
          return Math.max(0, Math.ceil(BOARD.cooldown - (Date.now() - last) / 1000));
        }
        // Firebase の置き場。初めて掲示板を開いたときだけ、Firebase の部品を読みこむ
        function boardFirebase(cfg) {
          let fs = null, db = null, uid = "";
          return {
            async init() {
              const [appM, authM, storeM] = await Promise.all(["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map((f) => import(BOARD.sdk + f)));
              fs = storeM;
              const app = appM.initializeApp(cfg, "wd-board");
              const auth = authM.getAuth(app);
              await authM.signInAnonymously(auth);
              uid = auth.currentUser.uid;
              db = fs.getFirestore(app);
              return uid;
            },
            listen(cb, fail) {
              const q = fs.query(fs.collection(db, "posts"), fs.orderBy("createdAt", "desc"), fs.limit(BOARD.show));
              return fs.onSnapshot(
                q,
                (snap) =>
                  cb(
                    snap.docs.map((d) => {
                      const v = d.data(), t = d.get("createdAt");
                      return { id: d.id, name: v.name, text: v.text, uid: v.uid, at: t && t.toMillis ? t.toMillis() : Date.now(), reports: (v.reportedBy || []).length, reportedByMe: (v.reportedBy || []).includes(uid) };
                    }),
                  ),
                fail,
              );
            },
            async post(name, text) {
              const b = fs.writeBatch(db), ref = fs.doc(fs.collection(db, "posts"));
              b.set(ref, { name, text, uid, createdAt: fs.serverTimestamp(), reportedBy: [] });
              b.set(fs.doc(db, "users", uid), { last: fs.serverTimestamp() }); // ルールで連続投稿の間隔を確かめる
              await b.commit();
            },
            remove: (id) => fs.deleteDoc(fs.doc(db, "posts", id)),
            report: (id) => fs.updateDoc(fs.doc(db, "posts", id), { reportedBy: fs.arrayUnion(uid) }),
          };
        }
        function boardBackend() {
          if (window.WD_BOARD_BACKEND) return window.WD_BOARD_BACKEND;
          return BOARD.config ? boardFirebase(BOARD.config) : null;
        }
        function boardConnect() {
          if (boardReady) return boardReady;
          boardApi = boardBackend();
          if (!boardApi) return (boardReady = Promise.resolve(false));
          boardReady = boardApi
            .init()
            .then((uid) => {
              boardUid = uid;
              boardStop = boardApi.listen(
                (list) => {
                  boardPosts = list;
                  boardErr = "";
                  renderBoard();
                },
                () => {
                  boardErr = "掲示板を読みこめませんでした。通信の具合を確かめてね。";
                  renderBoard();
                },
              );
              return true;
            })
            .catch(() => {
              boardErr = "掲示板につながりませんでした。少したってから開き直してね。";
              boardReady = null; // 次に開いたときにもう一度つなぐ
              renderBoard();
              return false;
            });
          return boardReady;
        }
        function boardAgo(t) {
          const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
          if (s < 60) return "いま";
          if (s < 3600) return Math.floor(s / 60) + "分前";
          if (s < 86400) return Math.floor(s / 3600) + "時間前";
          const d = new Date(t);
          return d.getMonth() + 1 + "/" + d.getDate();
        }
        function renderBoard() {
          const sheet = $("boardSheet");
          if (!sheet || sheet.hidden) return;
          const on = !!boardApi && !!boardUid;
          $("boardStatus").textContent = !boardBackend() ? "掲示板は準備中です。もうしばらく待ってね。" : boardErr || (on ? "" : "つないでいます…");
          $("boardForm").hidden = !on;
          $("boardList").innerHTML = on
            ? boardPosts.length
              ? boardPosts
                  .map((p) => {
                    const mine = p.uid === boardUid, hide = p.reports >= BOARD.hideAt && !mine;
                    return (
                      '<li class="board-post' + (mine ? " mine" : "") + '" data-id="' + esc(p.id) + '"><div class="board-meta"><b>' + esc(p.name) + "</b><small>" + boardAgo(p.at) + "</small>" +
                      (mine ? '<button class="board-del" data-board-del="' + esc(p.id) + '">消す</button>' : p.reportedByMe ? "<small>通報ずみ</small>" : '<button class="board-report" data-board-report="' + esc(p.id) + '">通報</button>') +
                      '</div><p class="board-text">' + (hide ? '<span class="muted">（通報が多いため表示していません）</span>' : esc(p.text)) + "</p></li>"
                    );
                  })
                  .join("")
              : '<li class="muted">まだ書きこみはありません。最初のひとことをどうぞ！</li>'
            : "";
          boardCount();
        }
        function boardCount() {
          const t = $("boardText"), n = t ? t.value.length : 0, w = boardWait();
          $("boardCount").textContent = n + "/" + BOARD.textMax;
          $("boardCount").classList.toggle("over", n > BOARD.textMax);
          $("boardSend").disabled = w > 0;
          $("boardSend").textContent = w > 0 ? "あと" + w + "秒" : "書きこむ";
        }
        async function boardSubmit(ev) {
          if (ev) ev.preventDefault();
          const r = boardCheck($("boardName").value, $("boardText").value);
          if (r.error) return ($("boardMsg").textContent = r.error);
          $("boardSend").disabled = true;
          $("boardMsg").textContent = "書きこんでいます…";
          try {
            await boardApi.post(r.name, r.text);
            try {
              localStorage.setItem(BOARD.nameKey, $("boardName").value.trim()); // 空のままなら名無しのまま
              localStorage.setItem(BOARD.lastKey, String(Date.now()));
            } catch (e) {}
            $("boardText").value = "";
            $("boardMsg").textContent = "書きこみました！";
          } catch (e) {
            $("boardMsg").textContent = "書きこめませんでした（続けて書きこんだときは、少し待ってね）。";
          }
          boardCount();
        }
        function openBoard() {
          $("boardSheet").hidden = false;
          try { $("boardName").value = localStorage.getItem(BOARD.nameKey) || ""; } catch (e) {}
          $("boardName").placeholder = BOARD.defaultName;
          $("boardName").maxLength = BOARD.nameMax;
          $("boardMsg").textContent = "";
          renderBoard();
          boardConnect().then(renderBoard);
        }
        $("boardOpen").onclick = openBoard;
        $("boardClose").onclick = () => ($("boardSheet").hidden = true);
        $("boardSheet").addEventListener("click", async (ev) => {
          if (ev.target.id === "boardSheet") return ($("boardSheet").hidden = true);
          const del = ev.target.closest("[data-board-del]"), rep = ev.target.closest("[data-board-report]");
          if (del && confirm("この書きこみを消しますか？")) {
            try { await boardApi.remove(del.dataset.boardDel); } catch (e) { $("boardMsg").textContent = "消せませんでした。"; }
          }
          if (rep && confirm("この書きこみを通報しますか？（" + BOARD.hideAt + "人に通報されると表示されなくなります）")) {
            try { await boardApi.report(rep.dataset.boardReport); $("boardMsg").textContent = "通報しました。ありがとう。"; } catch (e) { $("boardMsg").textContent = "通報できませんでした。"; }
          }
        });
        $("boardForm").addEventListener("submit", boardSubmit);
        $("boardText").addEventListener("input", boardCount);
        setInterval(() => { if (!$("boardSheet").hidden) boardCount(); }, 1000);
