import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert";
const file = new URL("../proto/maze.html", import.meta.url).href;
const OUT = process.env.MAZE_SHOTS;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(file);
await p.click("#helpClose");
let ok = 0; const check = (c, n) => { assert.ok(c, n); ok++; console.log("✓", n); };
const s0 = await p.evaluate(() => MAZE.state());
check(s0.route === 16, "最初の道は門から城まで一直線（16マス）");
// 柵で横一列（端を1マスあける）を作ると回り道
const r1 = await p.evaluate(() => { MAZE.setGold(9999); MAZE.select("fence"); for (let c = 0; c < 10; c++) MAZE.place(c, 4); return MAZE.state(); });
check(r1.route > 16, "柵の列で回り道になる（" + r1.route + "マス）");
const err = await p.evaluate(() => MAZE.error(10, 4, "fence"));
check(/ふさぐ/.test(err), "最後の1マスをふさぐ置き方はできない");
// 蛇行
await p.evaluate(() => { for (let c = 1; c < 11; c++) MAZE.place(c, 8); MAZE.select("arrow"); MAZE.place(5, 6); MAZE.place(4, 10); MAZE.select("cannon"); MAZE.place(6, 10); MAZE.select("water"); MAZE.place(2, 6); MAZE.select("gun"); MAZE.place(8, 6); });
const r2 = await p.evaluate(() => MAZE.state());
check(r2.route > r1.route, "2本目の柵でさらに長い迷路（" + r2.route + "マス）");
await p.screenshot({ path: (OUT || "/tmp") + "/maze-build.png" });
await p.evaluate(() => { MAZE.setGold(300); MAZE.start(); MAZE.step(9); });
await p.waitForTimeout(400);
await p.screenshot({ path: (OUT || "/tmp") + "/maze-wave.png" });
// 戦闘中に柵を足しても敵は道を探し直す・閉じこめない
const mid = await p.evaluate(() => { MAZE.select("fence"); const before = MAZE.state().route; MAZE.place(3, 12); MAZE.place(7, 12); return { before, after: MAZE.state().route }; });
check(mid.after >= mid.before, "戦闘中の柵の追加で道が変わる");
const end = await p.evaluate(() => { MAZE.step(120); return MAZE.state(); });
check(!end.playing && end.heart > 0, "第1波をしのげる（❤️" + end.heart + "）");
// 撤去
const sell = await p.evaluate(() => { const g = MAZE.state().gold; MAZE.select("sell"); MAZE.place(0, 4); return MAZE.state().gold - g; });
check(sell === 6, "準備中の撤去は全額戻る");
// タップで置ける
await p.evaluate(() => MAZE.select("fence"));
const box = await p.locator("#cv").boundingBox(), cs = box.width / 11;
await p.mouse.click(box.x + cs * 0.5, box.y + cs * 2.5);
check((await p.evaluate(() => MAZE.state().grid[2][0])) === "fence", "画面をタップして柵を置ける");
// 無防備で何波か流すと落城する
await p.reload(); await p.click("#helpClose");
const fall = await p.evaluate(() => { for (let i = 0; i < 12 && !MAZE.state().over; i++) { MAZE.start(); MAZE.step(150); } return MAZE.state(); });
check(fall.over && (await p.locator("#over").isVisible()), "守りがないと落城の画面が出る（第" + fall.wave + "波）");
check(errs.length === 0, "エラーなし " + errs.join("|"));
console.log("結果: " + ok + " 件成功");
await b.close();
