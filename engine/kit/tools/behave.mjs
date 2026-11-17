// The same behaviour with voxels and without: tabs, a dialog's close button, a menu, and values set from code.
// node tools/behave.mjs   (needs the showcase server)
import { chromium } from 'playwright';
const port = process.env.PORT || 5985;
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let bad = 0;
const check = (mode, name, ok, got) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} ${name}${ok ? '' : '  got ' + JSON.stringify(got)}`); };
for (const mode of ['plain', 'live']) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/showcase/behave.html${mode === 'plain' ? '?plain' : ''}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const q = (fn, arg) => page.evaluate(fn, arg);
  check(mode, 'the page is ' + mode, (await q(() => document.querySelectorAll('[data-vx-live]').length > 0)) === (mode === 'live'));
  check(mode, 'no change event before anyone chose', (await q(() => window.changes.length)) === 0, await q(() => window.changes));
  check(mode, 'four tabs fit a 390 px page', await q(() => document.getElementById('tabs').getBoundingClientRect().right <= 390 - 16 && document.documentElement.scrollWidth <= 390), await q(() => document.getElementById('tabs').getBoundingClientRect().right));
  await page.click('#tabs [role="tab"]:nth-of-type(3)');
  await page.waitForTimeout(350);
  check(mode, 'a click chooses a tab and shows its panel', await q(() => document.querySelector('#tabs [aria-selected="true"]').textContent === 'High' && !document.getElementById('p2').hidden && document.getElementById('p1').hidden));
  await page.keyboard.press('ArrowRight');
  check(mode, 'ArrowRight moves on and focus follows', await q(() => document.activeElement.textContent === 'Ultra' && document.activeElement.getAttribute('aria-selected') === 'true' && document.activeElement.tabIndex === 0));
  await page.keyboard.press('Home');
  check(mode, 'Home goes to the first tab', await q(() => document.activeElement.textContent === 'Low'));
  await page.click('#tabs [role="tab"]:nth-of-type(1)');
  check(mode, 'one change event per choice, none for the tab already chosen', JSON.stringify(await q(() => window.changes)) === '[2,3,0]', await q(() => window.changes));
  // values set from code
  await q(() => { document.getElementById('sw').checked = true; document.getElementById('sl').value = 9; });
  await page.waitForTimeout(250);
  check(mode, 'values set from code are kept', await q(() => document.getElementById('sw').checked === true && document.getElementById('sl').value === '9'));
  if (mode === 'live') {
    check(mode, 'the switch knob followed a value set from code', await q(() => window.vx.live(document.querySelector('.vx-switch')).spring('at').x === 1), await q(() => window.vx.live(document.querySelector('.vx-switch')).spring('at').x));
    await q(() => { document.getElementById('sw').checked = false; });
    check(mode, 'and followed it back', await q(() => window.vx.live(document.querySelector('.vx-switch')).spring('at').x === 0));
  }
  // menu
  await page.focus('#trigger');
  await page.keyboard.press('Enter'); // opened from the keyboard, so the keyboard goes in
  await page.waitForTimeout(350);
  check(mode, 'an open menu marks its trigger', await q(() => document.getElementById('trigger').getAttribute('aria-expanded') === 'true'));
  const before = await q(() => document.activeElement.textContent);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  check(mode, 'opened from the keyboard, focus is on the first item', before === 'One', before);
  check(mode, 'ArrowDown moves through the menu', await q(() => document.activeElement.textContent === 'Two'), await q(() => document.activeElement.textContent));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  check(mode, 'choosing closes it and focus returns', await q(() => !document.getElementById('menu').matches(':popover-open') && document.activeElement.id === 'trigger' && document.getElementById('trigger').getAttribute('aria-expanded') === 'false'));
  // a dialog that is not modal
  await page.click('#open');
  await page.waitForTimeout(700);
  check(mode, 'a non-modal dialog opens and the page rules stay out', await q(() => { const d = document.getElementById('dlg'); const f = getComputedStyle(d.querySelector('footer')); return d.open && f.marginTop === '0px'; }));
  await page.click('#dlg [data-vx-close]');
  await page.waitForTimeout(700);
  check(mode, 'its close button closes it with the value', await q(() => { const d = document.getElementById('dlg'); return !d.open && d.returnValue === 'done'; }), await q(() => [document.getElementById('dlg').open, document.getElementById('dlg').returnValue]));
  check(mode, 'no errors', errors.length === 0, errors);
  await page.screenshot({ path: `shots/behave-${mode}.png` });
  await page.close();
}
await browser.close();
console.log(bad ? `${bad} failed` : 'all the same, plain and live');
process.exit(bad ? 1 : 0);
