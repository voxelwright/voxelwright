import { escapeHtml as e } from "./markdown.mjs";
import { markdownTwin, postPath } from "../lib/paths.mjs";
import { postListHtml } from "./pages.mjs";

const destinations = [
  { href: "/blog/", label: "Blog" },
  { href: "/voxelmorphism/", label: "Voxelmorphism" },
];

export function homePage(site, posts, tagsWithPosts) {
  const latest = posts.filter((p) => !p.draft).slice(0, 3);
  const links = (local = false) => destinations
    .map(({ href, label }) => {
      const lettering = href === "/blog/" ? '<i class="breakable-b">B</i><i class="log-tail">log</i>' : label;
      const sign = href === "/blog/" ? "blog" : "voxel";
      return `<a href="${href}" data-sign="${local ? "local-" : ""}${sign}"${local ? ' class="scene-only"' : ""} aria-label="${label}"><span>${lettering}</span></a>`;
    })
    .join("");
  const html = `<div class="overlook">
<header class="overlook-title"><div><h1 class="vx-sign page-title" data-vx-board="none">${e(site.title)}</h1><p class="page-lead">Writing and experiments in voxels.</p></div>
<div class="bearing" aria-label="Looking east-southeast, San Francisco"><i aria-hidden="true"></i><span>San Francisco<br><small>120° ESE</small></span></div></header>
<figure class="park">
<div class="park-view">
<img class="park-skyline" src="/landing/ina.webp" width="2018" height="864" fetchpriority="high" alt="From Ina Coolbrith Park, the Bay Bridge, Transamerica Pyramid and Salesforce Tower rise above the roofs of North Beach.">
<canvas class="park-canvas" aria-hidden="true" hidden></canvas>
<canvas class="park-still" aria-hidden="true" hidden></canvas>
<i class="postcard-flash" aria-hidden="true"></i>
<nav class="park-sign" aria-label="Park directory">
${links()}
${links(true)}
</nav>
<div class="park-tools" hidden>
<span data-sign="station-face" class="fixture-face" aria-hidden="true"></span>
<span data-sign="settings-face" class="fixture-face" aria-hidden="true"></span>
<button type="button" data-sign="time" data-time aria-label="Night lighting" aria-pressed="false">Night</button>
<button type="button" data-sign="pause" data-pause aria-label="Pause flight" aria-pressed="false">Pause flight</button>
<button type="button" data-sign="sound" data-sound aria-label="City sound" aria-pressed="false">Sound</button>
<a data-sign="about-still" href="/?view=2d#about-view">About this view</a>
<button type="button" data-sign="support-still">Support</button>
<a data-sign="plain-still" data-view="2d" href="/?view=2d">Plain page</a>
<button type="button" data-sign="postcard" aria-haspopup="dialog" title="Make a postcard">Make a postcard</button>
<button type="button" data-sign="matrix-exit" hidden>Exit the Matrix</button>
<details class="display-settings"><summary data-sign="view">View</summary>
<div class="view-panel"><fieldset><legend>Graphics</legend>
<label data-sign="preset">Quality <select name="preset"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
<label data-sign="scale" for="park-scale">Resolution limit <span data-scale-value aria-hidden="true"></span>
<input id="park-scale" name="scale" type="range" min="30" max="100" step="5"></label>
<label data-sign="dynamic">Dynamic resolution <input name="dynamic" type="checkbox"></label>
<label data-sign="target">Frame target <select name="target"><option value="30">30 fps</option><option value="60" selected>60 fps</option><option value="120">120 fps</option></select></label>
</fieldset><a data-sign="about" href="/?view=2d#about-view">About this view</a>
<button type="button" data-sign="support">Support</button>
<a data-sign="plain" data-view="2d" href="/?view=2d">Plain page</a></div></details>
</div></div>
<figcaption><div class="park-caption"><strong>Ina Coolbrith Park</strong><span>North Beach skyline, built in Village.</span>
<span class="park-caption-actions"><a class="vx-button" data-view="3d" href="/?view=3d" hidden>City view</a>
<button type="button" class="vx-button" data-vx-material="chalk" data-postcard-plain aria-haspopup="dialog" hidden>Make a postcard</button></span>
<button type="button" class="offline-car" data-sign="car" hidden><i aria-hidden="true"></i>Hop the offline cable car</button></div></figcaption>
</figure>
<dialog class="vx-dialog postcard" aria-labelledby="postcard-title">
<header id="postcard-title">Your postcard</header>
<div class="vx-dialog-body"><img class="postcard-print" alt=""><p class="postcard-status" role="status" aria-live="polite"></p></div>
<footer><button type="button" class="vx-button" data-vx-material="chalk" data-postcard-close>Close</button>
<button type="button" class="vx-button" data-vx-material="chalk" data-postcard-share hidden>Share</button>
<a class="vx-button" data-vx-material="chalk" data-postcard-save href="#" download>Download PNG</a></footer>
</dialog>
${latest.length ? `<section class="park-writing" aria-labelledby="recent-title"><h2 id="recent-title">Recent writing</h2>${postListHtml(latest)}</section>` : ""}
<section class="park-log" id="site-log" tabindex="-1" aria-labelledby="log-title" hidden>
<h2 id="log-title">Site log</h2>
<time datetime="2026-11-18">18 November 2026</time>
<ul><li>Rebuilt the North Beach skyline from the Village city model.</li><li>Mounted the Blog and Voxelmorphism links on the park directory.</li><li>Added the Signal Desk to Voxelmorphism.</li></ul>
<p class="park-log-actions"><button class="vx-button" type="button" data-mend>Mend the B</button><a href="/blog/">Read the blog</a></p>
</section>
<details class="park-credit" id="about-view"><summary>About this view</summary><p>A Village reconstruction from USGS 3DEP lidar, DataSF buildings and Mapterhorn terrain, with landmark outlines from OpenStreetMap contributors and Overture Maps Foundation. Camera and colour reference from <a href="https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg">Frank Schulenburg’s view of the park</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>).</p>
<details class="park-secrets" hidden><summary>Park secrets</summary>
<p>Hold the B on the park sign, or focus Blog and press Space.</p>
<div class="egg-actions">
<button class="vx-button" type="button" data-egg="break">Loosen the B</button>
<button class="vx-button" type="button" data-egg="god" aria-pressed="false">IDDQD</button>
<button class="vx-button" type="button" data-egg="moon">Resize the moon <i aria-hidden="true"></i></button>
<button class="vx-button" type="button" data-egg="roll">Do a barrel roll</button>
<button class="vx-button" type="button" data-egg="rain" aria-pressed="false">Wake up</button>
<button class="vx-button" type="button" data-egg="rick">Tune the tow banner</button>
<button class="vx-button" type="button" data-egg="lives">Konami code</button>
</div></details></details><p class="egg-status" role="status" aria-live="polite"></p>
</div>`;
  const markdown =
    [
      "# " + site.title,
      "Writing and experiments in voxels.",
      "Ina Coolbrith Park, San Francisco. A view over North Beach built in Village.",
      destinations.map((l) => `- [${l.label}](${site.origin}${markdownTwin(l.href)})`).join("\n"),
      ...(latest.length
        ? [
            "## Recent writing",
            latest.map((p) => `- [${p.title}](${site.origin}${markdownTwin(postPath(p.slug))})`).join("\n"),
          ]
        : []),
      ...(site.links?.length ? ["## Elsewhere", site.links.map((l) => `- [${l.name}](${l.url})`).join("\n")] : []),
    ].join("\n\n") + "\n";
  return {
    path: "/", kind: "home", title: site.title, description: site.description, html, markdown,
    stylesheets: ["/landing/park.css", "/landing/eggs.css"],
    script: "/landing/home.js",
  };
}
