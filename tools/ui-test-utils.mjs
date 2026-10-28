// 情報メニューを経由して既存の詳細画面を開く。画面の入口だけを共通化する。
export async function openInfoEntry(page, selector) {
  if (!(await page.locator(selector).isVisible())) await page.locator('#infoOpen').click();
  await page.locator(selector).click();
}

export async function setPace(page, mode) {
  for (let i = 0; i < 4; i++) {
    if (await page.locator('#pace').getAttribute('data-mode') === mode) return;
    await page.locator('#pace').click();
  }
  throw new Error('Could not set playback mode: ' + mode);
}
export async function togglePause(page) {
  const stopped = await page.locator('#pace').getAttribute('data-mode') === 'paused';
  await setPace(page, stopped ? 'x1' : 'paused');
}
export async function toggleSpeed(page) {
  const speed = await page.evaluate(() => WD_DEBUG.state().speed);
  await setPace(page, speed === 1 ? 'x2' : 'x1');
}

// 共通の「編成」画面から攻城用武将のタブを開く。
export async function openSiegeFormation(page) {
  if (!(await page.locator('#squadSheet').isVisible())) await page.locator('#organize').click();
  await page.locator('#siege').click();
}
