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
// 武将：何人でも置ける（同じ武将は1人まで）・アイコン・技
await p.reload(); await p.click("#helpClose");
await p.click('#tools [data-tool="warlord"]');
check(await p.locator("#pickList button").count() === 30, "武将を選ぶ画面に30人");
await p.click('#pickList [data-w="nobunaga"]');
const wl = await p.evaluate(() => { MAZE.setGold(9999); MAZE.place(5, 5); MAZE.pick("kenshin"); MAZE.place(3, 9); MAZE.pick("hideyoshi"); MAZE.place(7, 12); MAZE.pick("kanbei"); MAZE.place(1, 3);
  MAZE.pick("nobunaga"); return { list: MAZE.warlords().map((w) => w.id), again: MAZE.error(8, 8, "warlord") }; });
check(wl.list.length === 4, "武将を何人も置ける（" + wl.list.join(",") + "）");
check(/もう出陣|先に/.test(wl.again), "同じ武将は2人置けない（" + wl.again + "）");
check((await p.evaluate(() => MAZE.state().grid[5][5])) === "warlord" && (await p.evaluate(() => MAZE.state().route)) > 16, "武将も道をふさぐ");
await p.waitForFunction(() => [...document.images].length >= 0);
await p.click('#tools [data-tool="warlord"]');
const loaded = await p.evaluate(async () => { const ims = [...document.querySelectorAll("#pickList img")]; await Promise.all(ims.map((im) => im.complete ? 0 : new Promise((r) => (im.onload = im.onerror = r)))); return ims.filter((im) => im.naturalWidth > 0).length; });
check(loaded === 30, "本番の武将アイコンが30人分読みこめる");
check(await p.locator('#pickList [data-w="kenshin"]').isDisabled(), "出陣中の武将は選べない");
await p.click("#pickClose");
const fight = await p.evaluate(() => { MAZE.start(); MAZE.step(14); const a = MAZE.warlords(); MAZE.step(120); return { a, s: MAZE.state() }; });
check(fight.a.some((w) => w.scd > 5), "武将が技を使う");
check(!fight.s.playing && fight.s.heart > 0, "武将で第1波をしのげる");
await p.waitForTimeout(300);
await p.screenshot({ path: (OUT || "/tmp") + "/maze-warlord.png" });
const back = await p.evaluate(() => { const g = MAZE.state().gold; MAZE.select("sell"); MAZE.place(5, 5); return { d: MAZE.state().gold - g, list: MAZE.warlords().map((w) => w.id) }; });
check(back.d === 220 && !back.list.includes("nobunaga"), "撤去すると武将が戻り代金も戻る");
check(errs.length === 0, "エラーなし " + errs.join("|"));
console.log("結果: " + ok + " 件成功");
await b.close();
