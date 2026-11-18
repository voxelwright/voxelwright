// Navbar. The bar across the top of a site or an app: a name, links, and one key at the end at
// most. Where the bar is narrow its links fold away behind one key, and come back under the bar
// when that key is pressed.
// Tool: none of its own. The bar lies on a surface (the kit's .vx-card: a site's top bar is one,
// an app's bar is the top of its window's); its links are the kit's navs (.vx-nav) with the
// accent groove under the current one; its keys are the kit's keys.
// Markup: <header class="vx-card vx-navbar-surface" data-vx-bolts="none">
//           <div class="vx-navbar">
//             <a class="vx-navbar-brand" href="/">fogline</a>
//             <button class="vx-button vx-navbar-key" type="button" aria-expanded="false" aria-controls="top">Menu</button>
//             <div class="vx-navbar-fold" id="top">
//               <nav class="vx-nav" data-vx-mark="groove" aria-label="Main">
//                 <a href="/deploys" aria-current="page">Deploys</a> <a href="/logs">Logs</a>
//               </nav>
//               <a class="vx-button" data-vx-kind="main" href="/new">New project</a>
//             </div>
//           </div>
//         </header>
//         In a window that is a surface already, leave the <header> out and put a groove under
//         the bar. The key comes before what it folds.
// The fold is the bar's own width, not the window's (a container query): under 160 voxels the
// links go behind the key. Whether they are out is aria-expanded on the key, and nothing else:
// set it from code and the bar follows. Escape folds them away again and gives the focus back to
// the key; so does following a link.
// With no script the key is not shown and the links wrap under the name: they are never lost.


function wire(el, on) {
  const key = el.querySelector('.vx-navbar-key');
  const fold = (key?.getAttribute('aria-controls') && document.getElementById(key.getAttribute('aria-controls'))) || el.querySelector('.vx-navbar-fold');
  if (!key || !fold) return;
  if (!key.hasAttribute('aria-expanded')) key.setAttribute('aria-expanded', 'false');
  const out = () => key.getAttribute('aria-expanded') === 'true';
  const folded = () => getComputedStyle(key).display !== 'none'; // the key shows only while the bar is narrow
  const set = (yes) => key.setAttribute('aria-expanded', String(yes));
  on(key, 'click', () => set(!out()));
  on(el, 'keydown', (e) => {
    if (e.key !== 'Escape' || !out() || !folded() || e.defaultPrevented) return;
    // a float that is open inside the bar takes Escape first
    if (e.target.closest?.(':popover-open')) return;
    e.preventDefault();
    set(false);
    key.focus();
  });
  // a link that is followed puts them away: on a page that stays (a link to a place in it, an
  // app's router) they would otherwise lie over where it led
  on(fold, 'click', (e) => { if (folded() && out() && e.target.closest?.('a[href]')) set(false); });
  el.setAttribute('data-vx-on', '');
  on({ addEventListener() {}, removeEventListener() { el.removeAttribute('data-vx-on'); } }, 'end', set);
}

export const navbar = {
  name: 'navbar',
  selector: '.vx-navbar',
  plain: wire,
};
