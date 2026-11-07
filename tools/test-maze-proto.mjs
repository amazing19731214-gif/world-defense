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
const u1 = await p.evaluate(() => { for (let c = 1; c < 11; c++) MAZE.place(c, 9); MAZE.pickNamed("sakon"); MAZE.place(5, 6); MAZE.pickNamed("hanzo"); MAZE.place(2, 11); MAZE.pickNamed("takakage"); MAZE.place(4, 7); MAZE.pickNamed("magoichi"); MAZE.place(3, 12); return MAZE.state(); });
check(u1.units.length === 4 && u1.units.every((u) => u.kind === "named"), "ネームド兵士を置ける（左近・半蔵・隆景・孫市）");
check(/もう出陣|先に/.test(await p.evaluate(() => { MAZE.pickNamed("sakon"); return MAZE.error(8, 8, "named"); })), "同じネームド兵士は2人置けない");
check(/兵士がいるマス/.test(await p.evaluate(() => MAZE.error(5, 6, "fence"))), "兵士の持ち場には柵を置けない");
const box = await p.locator("#cv").boundingBox(), cs = box.width / 11;
// タップで選んで、別のマスをタップ → 持ち場が移る
await p.mouse.click(box.x + cs * 5.5, box.y + cs * 6.5);
await p.mouse.click(box.x + cs * 6.5, box.y + cs * 6.5);
const moved = (await S()).units.find((u) => u.id === "sakon");
check(moved.home.c === 6 && moved.home.r === 6, "兵士をタップで選んで、マスをタップで持ち場を移せる");
await p.evaluate(() => MAZE.step(2));
const back = (await S()).units.find((u) => u.id === "sakon");
check(Math.abs(back.x - 6.5) < 0.1 && Math.abs(back.y - 6.5) < 0.1, "兵士が歩いて新しい持ち場へ移る");
await p.evaluate(() => { MAZE.start(); MAZE.step(17); });
await shot("maze-units.png");
const mid = await S();
check(mid.units.some((u) => Math.hypot(u.x - (u.home.c + 0.5), u.y - (u.home.r + 0.5)) > 0.3), "戦闘中は兵士が持ち場を離れて敵を追う");
check(await p.evaluate(() => { const s = MAZE.state(); return s.enemies > 0; }), "敵が入ってくる");
const end = await p.evaluate(() => { MAZE.step(150); return MAZE.state(); });
check(!end.playing && !end.over && end.hero.hp > 0, "第1波をしのげる（殿のHP " + Math.round(end.hero.hp) + "）");
await p.evaluate(() => MAZE.step(4));
const home = await S();
check(home.units.every((u) => Math.hypot(u.x - (u.home.c + 0.5), u.y - (u.home.r + 0.5)) < 0.2 && u.hp > 0), "波が終わると回復して持ち場へ戻る");
check(home.units.some((u) => u.lv > 1), "敵を倒したネームド兵士はレベルが上がる（" + home.units.map((u) => u.id + "Lv" + u.lv).join(",") + "）");

// ■ 近接の兵士は足止めする（弓兵は足止めしない）
await fresh();
const block = await p.evaluate(() => {
  MAZE.setGold(9999); MAZE.pickNamed("motoharu"); MAZE.place(5, 3);
  MAZE.start(); MAZE.step(4);
  const s = MAZE.state();
  return { units: s.units };
});
const ash = block.units[0];
check(ash.hp < 85 || ash.down > 0, "足軽（吉川元春）が敵の前に立って戦う（敵から攻撃を受ける）");
const fall = await p.evaluate(() => { MAZE.step(200); return MAZE.state(); });
check(fall.units[0].down >= 0, "兵士は倒れても消えない（城で起き上がる）");

// ■ 道の上の兵士は敵を止めて斬り合う（HPが減る）。止めている間、敵は殿へ届かない
await fresh();
const hold = await p.evaluate(() => {
  MAZE.setGold(9999); MAZE.pickNamed("sakon"); MAZE.place(5, 6); MAZE.pickNamed("takakage"); MAZE.place(4, 9);
  MAZE.start(); const log = [];
  for (let i = 0; i < 5; i++) { MAZE.step(1.6); const s = MAZE.state(); log.push({ hp: s.units[0].hp, down: s.units[0].down, hero: s.hero.hp }); }
  return log;
});
check(hold.some((h) => h.hp < 60 || h.down > 0), "道に立つ兵士は敵と斬り合ってHPが減る（左近 " + hold.map((h) => Math.round(h.hp)).join("→") + "）");
check(hold.every((h) => h.hero >= 320), "兵士が止めている間、敵は殿へ届かない");

// ■ 敵は兵士を全滅させるつもりで来る：道から外れた兵士にも向かい、群がって斬りかかる。ほかの守り手が倒れると殿へ
await fresh();
const hunt = await p.evaluate(() => {
  MAZE.setGold(9999); MAZE.pickNamed("hanzo"); MAZE.place(0, 8); // 道から離れた左端
  MAZE.start(); let near = 0, maxOff = 0;
  for (let i = 0; i < 40; i++) { MAZE.step(0.5); const s = MAZE.state(); const u = s.units[0]; maxOff = Math.max(maxOff, ...MAZE.enemyPos().map((e) => Math.abs(e.x - 5.5))); if (u.hp < 85) near++; }
  return { near, maxOff, downs: MAZE.state().downs };
});
check(hunt.maxOff > 3.5, "敵が道を外れて、端にいる兵士へ向かってくる");
check(hunt.near > 0 && hunt.downs >= 1, "敵が群がって兵士を倒す（退却 " + hunt.downs + "回）");
const after = await p.evaluate(() => { let hit = false; for (let i = 0; i < 120; i++) { MAZE.step(0.5); const s = MAZE.state(); if (s.hero.hp < s.hero.max) hit = true; } return { hit, over: MAZE.state().over }; });
check(after.hit || after.over, "兵士が倒れている間は、敵が殿に襲いかかる");

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
// 武将をタップするとステータスが出る
{
  const k = (await S()).units.find((u) => u.id === "kenshin");
  await p.mouse.click(box.x + cs * k.x, box.y + cs * k.y);
  await p.waitForTimeout(300);
  const t = await p.locator("#card").textContent();
  check(await p.locator("#card").isVisible() && /上杉謙信/.test(t) && /Lv1/.test(t) && /HP/.test(t) && /攻撃/.test(t) && /車懸りの陣/.test(t) && /経験値/.test(t), "武将をタップするとステータス（名前・Lv・HP・攻撃・技・経験値）が出る");
  await shot("maze-card.png");
  await p.click("#cardClose");
  await p.waitForTimeout(300);
  check(!(await p.locator("#card").isVisible()), "×でステータスを閉じる");
  const h = await S();
  await p.mouse.click(box.x + cs * h.hero.x, box.y + cs * h.hero.y);
  await p.waitForTimeout(300);
  check(/殿/.test(await p.locator("#card").textContent()) && /倒れたら負け/.test(await p.locator("#card").textContent()), "殿のステータスも見られる");
  await p.mouse.click(box.x + cs * h.hero.x, box.y + cs * h.hero.y);
  // ネームド兵士：足元・体・頭・名札のどこをタップしてもステータスが出る（柵は置かれない）
  await p.evaluate(() => { MAZE.pickNamed("sakon"); MAZE.place(2, 12); MAZE.select("fence"); });
  for (const [dy, where] of [[0.25, "足元"], [-0.2, "体"], [-0.55, "頭"], [-0.8, "名札"]]) {
    await p.mouse.click(box.x + cs * 2.5, box.y + cs * (12.5 + dy));
    await p.waitForTimeout(250);
    const ok = (await p.locator("#card").isVisible()) && /島左近/.test(await p.locator("#card").textContent()) && /鬼左近/.test(await p.locator("#card").textContent());
    const fence = await p.evaluate(() => MAZE.state().grid.flat().filter((g) => g === "fence").length);
    check(ok && fence === 0, "兵士の" + where + "をタップするとステータスが出る（柵は置かれない）");
    if (where === "体") await shot("maze-card-soldier.png");
    await p.click("#cardClose"); await p.waitForTimeout(250);
  }
}
const fight = await p.evaluate(() => { MAZE.pickNamed("kotaro"); MAZE.place(3, 6); MAZE.pickNamed("gensaku"); MAZE.place(7, 7); MAZE.start(); MAZE.step(9); const a = MAZE.state().units; return a; });
await p.waitForTimeout(200);
await shot("maze-warlord.png");
check(fight.some((u) => u.kind === "warlord" && u.scd > 5), "武将が技を使う");
const fin = await p.evaluate(() => { MAZE.step(150); return MAZE.state(); });
check(!fin.playing && !fin.over, "武将と兵士で第1波をしのげる（殿のHP " + Math.round(fin.hero.hp) + "）");
check(fin.units.some((u) => u.kind === "warlord" && u.lv > 1), "武将もレベルが上がる（" + fin.units.filter((u) => u.kind === "warlord").map((u) => u.id + "Lv" + u.lv).join(",") + "）");
const sold = await p.evaluate(() => { const g = MAZE.state().gold, u = MAZE.state().units.find((o) => o.id === "nobunaga"); MAZE.select("sell"); MAZE.place(u.home.c, u.home.r); return { d: MAZE.state().gold - g, list: MAZE.state().units.map((o) => o.id) }; });
check(sold.d === 220 && !sold.list.includes("nobunaga"), "撤去すると武将が戻り代金も戻る");

// ■ ネームド兵士の一覧
await p.click('#tools [data-tool="named"]');
check(await p.locator("#pickList button").count() === 18 && (await p.locator("#pickTitle").textContent()).includes("ネームド"), "兵士を選ぶ画面にネームド兵士18人");
check(await p.locator('#pickList [data-n="kotaro"]').isDisabled(), "出陣中のネームド兵士は選べない");
await shot("maze-named.png");
await p.click("#pickClose");

// ■ 殿：撤去できない・持ち場を移せる・倒れたら負け
await fresh();
check(/撤去できません/.test(await p.evaluate(() => { MAZE.select("sell"); MAZE.place(5, 16); return document.getElementById("msg").textContent; })), "殿は撤去できない");
check((await p.locator("#heart").textContent()).includes("殿"), "上の表示に殿のHP");
await p.evaluate(() => MAZE.select("fence"));
await p.mouse.click(box.x + cs * 5.5, box.y + cs * 16.5);
await p.mouse.click(box.x + cs * 5.5, box.y + cs * 13.5);
await p.evaluate(() => MAZE.step(3));
const hm = (await S()).hero;
check(Math.abs(hm.y - 13.5) < 0.1, "殿もタップで選んで持ち場を移せる");

// ■ 守りがないと殿が討ち死にして負け
await fresh();
const lose = await p.evaluate(() => { for (let i = 0; i < 30 && !MAZE.state().over; i++) { MAZE.start(); MAZE.step(150); } return MAZE.state(); });
await p.waitForTimeout(800);
check(lose.over && lose.hero.hp <= 0 && (await p.locator("#over").isVisible()) && (await p.locator("#overTitle").textContent()).includes("殿"), "殿が倒れると負けの画面が出る（第" + lose.wave + "波）");
check(errs.length === 0, "エラーなし " + errs.join("|"));
console.log("結果: " + ok + " 件成功");
await b.close();
