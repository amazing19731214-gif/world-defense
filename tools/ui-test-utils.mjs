// 情報メニューを経由して既存の詳細画面を開く。画面の入口だけを共通化する。
export async function openInfoEntry(page, selector) {
  if (!(await page.locator(selector).isVisible())) await page.locator('#infoOpen').click();
  await page.locator(selector).click();
}
