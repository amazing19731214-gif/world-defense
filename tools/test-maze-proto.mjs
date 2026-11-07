// 迷路の関（試作）proto/maze.html の試験。柵の迷路・動き回る兵士と武将・持ち場・足止め・技
import { createRequire } from "node:module";
import assert from "node:assert";
const { chromium } = createRequire(import.meta.url)("playwright");
const file = new URL("../proto/maze.html", import.meta.url).href;
const OUT = process.env.MAZE_SHOTS;
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
let ok = 0;
const check = (c, n) => { assert.ok(c, n); ok++; console.log("✓", n); };
const fresh = async () => { await p.goto(file); await p.click("#helpClose"); };
const S = () => p.evaluate(() => MAZE.state());
const shot = (name) => OUT && p.screenshot({ path: OUT + "/" + name });
await fresh();

// ■ 柵の迷路
check((await S()).route === 16, "最初の道は門から城まで一直線（16マス）");
const r1 = await p.evaluate(() => { MAZE.setGold(9999); MAZE.select("fence"); for (let c = 0; c < 10; c++) MAZE.place(c, 4); return MAZE.state(); });
check(r1.route > 16, "柵の列で回り道になる（" + r1.route + "マス）");
check(/ふさぐ/.test(await p.evaluate(() => MAZE.error(10, 4, "fence"))), "最後の1マスをふさぐ置き方はできない");

// ■ 兵士は持ち場のまわりで敵を追いかけて戦い、敵がいなくなると持ち場へ戻る
const u1 = await p.evaluate(() => { for (let c = 1; c < 11; c++) MAZE.place(c, 9); MAZE.select("spearman"); MAZE.place(5, 6); MAZE.select("ashigaru"); MAZE.place(2, 11); MAZE.select("archer"); MAZE.place(4, 7); MAZE.place(3, 12); return MAZE.state(); });
check(u1.units.length === 4, "兵士を置ける（槍兵・足軽・弓兵2）");
check(/兵士がいるマス/.test(await p.evaluate(() => MAZE.error(5, 6, "fence"))), "兵士の持ち場には柵を置けない");
const box = await p.locator("#cv").boundingBox(), cs = box.width / 11;
// タップで選んで、別のマスをタップ → 持ち場が移る
await p.mouse.click(box.x + cs * 5.5, box.y + cs * 6.5);
await p.mouse.click(box.x + cs * 6.5, box.y + cs * 6.5);
const moved = (await S()).units.find((u) => u.kind === "spearman");
check(moved.home.c === 6 && moved.home.r === 6, "兵士をタップで選んで、マスをタップで持ち場を移せる");
await p.evaluate(() => MAZE.step(2));
const back = (await S()).units.find((u) => u.kind === "spearman");
check(Math.abs(back.x - 6.5) < 0.1 && Math.abs(back.y - 6.5) < 0.1, "兵士が歩いて新しい持ち場へ移る");
await p.evaluate(() => { MAZE.start(); MAZE.step(17); });
await shot("maze-units.png");
const mid = await S();
check(mid.units.some((u) => Math.hypot(u.x - (u.home.c + 0.5), u.y - (u.home.r + 0.5)) > 0.3), "戦闘中は兵士が持ち場を離れて敵を追う");
check(await p.evaluate(() => { const s = MAZE.state(); return s.enemies > 0; }), "敵が入ってくる");
const end = await p.evaluate(() => { MAZE.step(150); return MAZE.state(); });
check(!end.playing && end.heart > 0, "第1波をしのげる（❤️" + end.heart + "）");
await p.evaluate(() => MAZE.step(4));
const home = await S();
check(home.units.every((u) => Math.hypot(u.x - (u.home.c + 0.5), u.y - (u.home.r + 0.5)) < 0.2 && u.hp > 0), "波が終わると回復して持ち場へ戻る");

// ■ 近接の兵士は足止めする（弓兵は足止めしない）
await fresh();
const block = await p.evaluate(() => {
  MAZE.setGold(9999); MAZE.select("ashigaru"); MAZE.place(5, 3);
  MAZE.start(); MAZE.step(4);
  const s = MAZE.state();
  return { units: s.units, heart: s.heart };
});
const ash = block.units[0];
check(ash.hp < 80 || ash.down > 0, "足軽が敵の前に立って戦う（敵から攻撃を受ける）");
const fall = await p.evaluate(() => { MAZE.step(200); return MAZE.state(); });
check(fall.units[0].down >= 0, "兵士は倒れても消えない（城で起き上がる）");

// ■ 武将：何人でも置ける・同じ武将は1人まで・技
await fresh();
await p.click('#tools [data-tool="warlord"]');
check(await p.locator("#pickList button").count() === 30, "武将を選ぶ画面に30人");
const loaded = await p.evaluate(async () => { const ims = [...document.querySelectorAll("#pickList img")]; await Promise.all(ims.map((im) => (im.complete ? 0 : new Promise((r) => (im.onload = im.onerror = r))))); return ims.filter((im) => im.naturalWidth > 0).length; });
check(loaded === 30, "本番の武将アイコンが30人分読みこめる");
await p.click('#pickList [data-w="nobunaga"]');
const wl = await p.evaluate(() => { MAZE.setGold(9999); MAZE.place(5, 5); MAZE.pick("kenshin"); MAZE.place(4, 9); MAZE.pick("hideyoshi"); MAZE.place(6, 12); MAZE.pick("masamune"); MAZE.place(5, 3);
  MAZE.pick("nobunaga"); return { list: MAZE.state().units.map((u) => u.id), again: MAZE.error(8, 8, "warlord") }; });
check(wl.list.length === 4, "武将を何人も置ける（" + wl.list.join(",") + "）");
check(/もう出陣|先に/.test(wl.again), "同じ武将は2人置けない");
await p.click('#tools [data-tool="warlord"]');
check(await p.locator('#pickList [data-w="kenshin"]').isDisabled(), "出陣中の武将は選べない");
await p.click("#pickClose");
await p.evaluate(() => MAZE.select("spearman"));
const fight = await p.evaluate(() => { MAZE.select("ashigaru"); MAZE.place(3, 6); MAZE.place(7, 7); MAZE.start(); MAZE.step(9); const a = MAZE.state().units; return a; });
await p.waitForTimeout(200);
await shot("maze-warlord.png");
check(fight.some((u) => u.kind === "warlord" && u.scd > 5), "武将が技を使う");
const fin = await p.evaluate(() => { MAZE.step(150); return MAZE.state(); });
check(!fin.playing && fin.heart > 0, "武将と兵士で第1波をしのげる（❤️" + fin.heart + "）");
const sold = await p.evaluate(() => { const g = MAZE.state().gold, u = MAZE.state().units.find((o) => o.id === "nobunaga"); MAZE.select("sell"); MAZE.place(u.home.c, u.home.r); return { d: MAZE.state().gold - g, list: MAZE.state().units.map((o) => o.id) }; });
check(sold.d === 220 && !sold.list.includes("nobunaga"), "撤去すると武将が戻り代金も戻る");

// ■ 守りがないと落城
await fresh();
const lose = await p.evaluate(() => { for (let i = 0; i < 12 && !MAZE.state().over; i++) { MAZE.start(); MAZE.step(150); } return MAZE.state(); });
check(lose.over && (await p.locator("#over").isVisible()), "守りがないと落城の画面が出る（第" + lose.wave + "波）");
check(errs.length === 0, "エラーなし " + errs.join("|"));
console.log("結果: " + ok + " 件成功");
await b.close();
