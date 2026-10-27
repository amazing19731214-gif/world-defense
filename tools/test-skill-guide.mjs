#!/usr/bin/env node
import { openInfoEntry } from './ui-test-utils.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.execPath, '../../lib/node_modules/playwright'))); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {});
let pass=0;
function check(name, condition) { if (!condition) throw Error(name); console.log('✓ '+name);pass++; }
try {
 const context = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 const page = await context.newPage(), errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.join(root,'index.html')).href+'?debug');
 await page.waitForFunction(()=>window.WD_DEBUG);
 check('起動時は一覧を隠す',await page.locator('#skillGuideSheet').isHidden());
 const layout = await page.evaluate(()=>{const w=document.getElementById('wave').getBoundingClientRect(),b=document.getElementById('infoOpen').getBoundingClientRect();return {right:b.left>=w.right,same:Math.abs((w.top+w.bottom-b.top-b.bottom)/2)<2,h:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});
 check('390pxで情報がWAVEの右側・高さ44px以上・横はみ出しなし',layout.right&&layout.same&&layout.h>=44&&!layout.overflow);
 const saved=await page.evaluate(()=>JSON.stringify(localStorage));
 await openInfoEntry(page, '#skillGuideOpen');
 check('タッチで説明画面を開く',await page.locator('#skillGuideSheet').isVisible());
 check('未所持でも全30人を表示',await page.locator('[data-guide-hero]').count()===30);
 check('常時効果と技名と再使用時間', (await page.locator('[data-guide-hero="nobunaga"]').innerText()).includes('三段撃ち')&&(await page.locator('[data-guide-hero="nobunaga"]').innerText()).includes('40秒'));
 check('フォーカスは閉じるボタン',await page.evaluate(()=>document.activeElement.id==='skillGuideClose'));
 await page.locator('#skillGuideSearch').fill('織田信長');
 check('武将名で検索',await page.locator('[data-guide-hero]').count()===1);
 await page.locator('#skillGuideSearch').fill('三段撃ち');
 check('必殺技名で検索',await page.locator('[data-guide-hero]').count()===1);
 await page.locator('#skillGuideSearch').fill('攻撃力');
 check('効果で検索',(await page.locator('[data-guide-hero]').count())>1);
 await page.locator('#skillGuideSearch').fill('<img src=x onerror=alert(1)>');
 check('該当なし表示とHTML注入の防止',(await page.locator('#skillGuidePanel').innerText()).includes('該当するスキルがありません')&&await page.locator('#skillGuidePanel img').count()===0);
 await page.tap('#skillGuideSoldiers');
 check('兵士タブは検索をクリア',await page.locator('#skillGuideSearch').inputValue()==='');
 check('兵士スキル（職業スキルを含む）をすべて表示',await page.locator('[data-guide-soldier]').count()===await page.evaluate(()=>Object.keys(WD_DEBUG.squadApi.SOLDIER_SKILLS).length));
 const text=await page.locator('#skillGuideHint').innerText();
 check('習得条件を設定から表示',text.includes('Lv5・Lv15')&&text.includes('Lv30')&&text.includes('30%')&&text.includes('最大20個'));
 check('城攻め名人は習得不可と明示',(await page.locator('[data-guide-soldier="siegeMaster"]').innerText()).includes('未実装・習得不可'));
 await page.locator('#skillGuideSearch').fill('衛生兵');
 check('兵種から適合スキルを検索（衛生兵の職業スキル「応急処置」・衛生兵向けの秘伝スキル4つを含む）',await page.locator('[data-guide-soldier]').count()===11);
  await page.locator('#skillGuideSearch').fill('秘伝');
  check('秘伝スキル（スキルの書）を検索・区別して表示',await page.locator('[data-guide-soldier]').count()===await page.evaluate(()=>Object.values(WD_DEBUG.squadApi.SOLDIER_SKILLS).filter((k)=>k.book).length)&&(await page.locator('[data-guide-soldier="kongo"]').innerText()).includes('秘伝スキル')&&(await page.locator('[data-guide-soldier="kongo"]').innerText()).includes('スキルの書で習得'));
  await page.locator('#skillGuideSearch').fill('衛生兵');
 await page.locator('#skillGuideSearch').fill('');
 const folder=process.env.SCREENSHOTS;
 if(folder){fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:path.join(folder,'skills-soldiers.png')});}
 await page.tap('#skillGuideHeroes');
 if(folder)await page.screenshot({path:path.join(folder,'skills-heroes.png')});
 await page.tap('#skillGuideClose');
 check('戦闘前は元の停止状態に戻る',!await page.evaluate(()=>WD_DEBUG.state().paused));
 check('情報ボタンへフォーカスを復元',await page.evaluate(()=>document.activeElement.id==='infoOpen'));
 check('所持武将・ガチャ券・保存内容は不変',await page.evaluate(()=>JSON.stringify(localStorage))===saved);
 await page.tap('#start');
 await page.waitForTimeout(700);
 await openInfoEntry(page, '#skillGuideOpen');
 const before=await page.evaluate(()=>{const s=WD_DEBUG.state();return {gold:s.gold,hp:s.hp,wave:s.wave,enemyD:s.enemies.map(e=>e.d),speed:s.speed}});
 check('閲覧中は停止',await page.evaluate(()=>WD_DEBUG.state().paused));
 await page.waitForTimeout(250);
 await page.evaluate(()=>WD_DEBUG.step(2));
 const after=await page.evaluate(()=>{const s=WD_DEBUG.state();return {gold:s.gold,hp:s.hp,wave:s.wave,enemyD:s.enemies.map(e=>e.d),speed:s.speed}});
 check('閲覧中は敵・ゴールド・HP・ウェーブが進まない',JSON.stringify(before)===JSON.stringify(after));
 await page.keyboard.press('Escape');
 check('Escapeで閉じて再開',await page.locator('#skillGuideSheet').isHidden()&&!await page.evaluate(()=>WD_DEBUG.state().paused));
 await page.tap('#pause');
 await page.tap('#speed');
 await openInfoEntry(page, '#skillGuideOpen');
 await page.tap('#skillGuideClose');
 check('もともと停止中なら停止を保つ',await page.evaluate(()=>WD_DEBUG.state().paused));
 check('2倍速を保つ',await page.evaluate(()=>WD_DEBUG.state().speed===2));
 await openInfoEntry(page, '#skillGuideOpen');
 const rect=await page.locator('#skillGuideSheet .sheet').boundingBox();
 check('一覧は画面の88%以内',rect.height<=844*.89);
 await page.touchscreen.tap(10,5);
 check('背景タップでも閉じる',await page.locator('#skillGuideSheet').isHidden());
 await page.evaluate(()=>window.scrollTo(0,300));
 // Keyboard opening must keep the previous scroll position as well.
 const prevY=await page.evaluate(()=>window.scrollY);
 await page.evaluate(()=>document.getElementById('skillGuideOpen').click());
 await page.evaluate(()=>document.getElementById('skillGuideClose').click());
 check('スクロール位置を復元',Math.abs(await page.evaluate(()=>window.scrollY)-prevY)<2);
 await page.evaluate(()=>window.scrollTo(0,0));
 if(folder)await page.screenshot({path:path.join(folder,'skills-button.png')});
 for(const width of [320,375,430,1080]){
  await page.setViewportSize({width,height:844});
  check(width+'pxで横はみ出しなし',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.setViewportSize({width:390,height:844});
 await openInfoEntry(page, '#skillGuideOpen');
 await page.locator('#skillGuideHeroes').focus();
 await page.keyboard.press('ArrowRight');
 check('矢印キーでタブ切替',await page.locator('#skillGuideSoldiers').getAttribute('aria-selected')==='true');
 await page.locator('#skillGuideClose').focus();
 await page.keyboard.press('Shift+Tab');
 check('ダイアログ内にフォーカスを保つ',await page.evaluate(()=>document.getElementById('skillGuideSheet').contains(document.activeElement)&&document.activeElement.id!=='skillGuideClose'));
 await page.keyboard.press('Escape');
 check('操作後もJSエラーなし',errors.length===0);
 // The production URL also works without the debug API.
 await page.goto(pathToFileURL(path.join(root,'index.html')).href);
 await openInfoEntry(page, '#skillGuideOpen');
 check('通常プレイURLでも全武将を表示',await page.locator('[data-guide-hero]').count()===30&&!await page.evaluate(()=>!!window.WD_DEBUG));
 console.log('結果: '+pass+'件成功');
} finally { await browser.close(); }
