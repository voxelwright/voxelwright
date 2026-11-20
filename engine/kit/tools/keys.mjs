// A keyboard pass over the showcase: tab order, focus rings, arrows in tabs and the menu, Escape.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
await p.goto(`http://127.0.0.1:${process.env.PORT || 5985}/kit/showcase/principles.html`);
await p.waitForFunction(() => document.documentElement.dataset.ready === '1');
await p.waitForTimeout(600);
const active = () => p.evaluate(() => { const a = document.activeElement; return a ? (a.id ? '#' + a.id : a.tagName.toLowerCase() + (a.getAttribute('role') ? `[${a.getAttribute('role')}]` : '') + ' "' + (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 24) + '"') : 'none'; });
const out = [];
const check = (name, ok, detail = '') => out.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);

// tab order from the top
const stops = [];
for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); stops.push(await active()); }
check('first stop is the skip link', stops[0].includes('Skip'), stops[0]);
check('the light tabs are one stop (roving)', stops[1].includes('[tab]') && !stops[2].includes('[tab]'), stops.slice(1, 4).join(' | '));

// arrows in the tablist
await p.focus('#light [role="tab"][aria-selected="true"]');
await p.keyboard.press('ArrowRight');
check('ArrowRight picks the next tab', await p.evaluate(() => document.activeElement.getAttribute('aria-selected') === 'true' && document.activeElement.textContent.trim() === 'Day'), await active());
check('and the page follows', await p.evaluate(() => document.documentElement.dataset.theme === 'light'));
await p.keyboard.press('Home');

// a focus ring you can see
await p.focus('#kit .vx-button'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
// live, a key's ring is drawn round its whole solid by ::after; the element's own outline is clear
const ring = await p.evaluate(() => { const el = document.activeElement, own = getComputedStyle(el), s = own.outlineColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(el, '::after') : own; return s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor; });
check('a focused button has a ring', /solid 2px/.test(ring), ring);
await p.locator('#kit .vx-button').first().scrollIntoViewIfNeeded();
await p.screenshot({ path: 'shots/keys-focus.png', clip: await p.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 30), width: r.width + 260, height: r.height + 60 }; }) });

// Space presses a button down
await p.keyboard.down('Space'); await p.waitForTimeout(200);
check('Space presses the button down', await p.evaluate(() => window.vx.live(document.activeElement).model.byName.cap.tz < -2));
await p.keyboard.up('Space');

// menu by keyboard
await p.focus('[popovertarget="plant-menu"]'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
await p.keyboard.press('Enter'); await p.waitForTimeout(400);
check('Enter opens the menu and focus goes to its first item', (await active()).includes('Water it'), await active());
await p.keyboard.press('ArrowDown');
check('ArrowDown moves to the next item', (await active()).includes('Move to another'), await active());
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
check('Escape closes it', await p.evaluate(() => !document.querySelector('#plant-menu').matches(':popover-open')));
check('and focus is back on the trigger', (await active()).includes('This plant'), await active());

// dialog by keyboard
await p.focus('#open-dialog'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
check('Enter opens the dialog with focus inside', await p.evaluate(() => document.querySelector('#dlg').open && document.querySelector('#dlg').contains(document.activeElement)), await active());
await p.keyboard.press('Escape'); await p.waitForTimeout(700);
check('Escape closes it', await p.evaluate(() => !document.querySelector('#dlg').open));
check('and focus is back on the button that opened it', (await active()) === '#open-dialog', await active());

// a switch by keyboard
await p.focus('#sound'); await p.keyboard.press('Space');
check('Space flips a switch', await p.evaluate(() => document.querySelector('#sound').checked));
await p.keyboard.press('Space');

console.log(out.join('\n'));
await b.close();
process.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
