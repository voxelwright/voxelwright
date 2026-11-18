// Walk the real tab sequence from wherever the prior interaction left focus.
// The showcase header and footer are legitimate stops on component pages.
export async function reachByTab(page, selector) {
  const limit = await page.locator('a[href],button,input,select,textarea,summary,[tabindex]').count() + 2;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(sel => Boolean(document.activeElement?.closest(sel)), selector)) return true;
  }
  return false;
}
