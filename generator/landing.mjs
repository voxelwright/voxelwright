import { escapeHtml as e } from "./markdown.mjs";
import { markdownTwin, postPath } from "../lib/paths.mjs";

const destinations = [
  { href: "/blog/", label: "Blog" },
  { href: "/voxelmorphism/", label: "Voxelmorphism" },
];

export function homePage(site, posts, tagsWithPosts) {
  const latest = posts.filter((p) => !p.draft).slice(0, 3);
  const links = destinations
    .map(({ href, label }) => {
      const lettering = href === "/blog/" ? '<i class="breakable-b">B</i><i class="log-tail">log</i>' : label;
      return `<a href="${href}" aria-label="${label}"><span>${lettering}</span><b aria-hidden="true">↗</b></a>`;
    })
    .join("");
  const html = `<link rel="stylesheet" href="/landing/park.css"><link rel="stylesheet" href="/landing/eggs.css">
<div class="overlook">
<header class="overlook-title"><div><h1>${e(site.title)}</h1><p>Writing and experiments in voxels.</p></div>
<div class="bearing" aria-label="Looking east-southeast, San Francisco"><i aria-hidden="true"></i><span>San Francisco<br><small>120° ESE</small></span></div></header>
<figure class="park">
<div class="park-view">
<img class="park-skyline" src="/landing/ina.webp" width="2018" height="864" fetchpriority="high" alt="From Ina Coolbrith Park, the Bay Bridge, Transamerica Pyramid and Salesforce Tower rise above the roofs of North Beach.">
<canvas class="park-canvas" aria-hidden="true" hidden></canvas>
<div class="sign-mount"><nav class="park-sign" aria-label="Park directory">
<span class="park-name">Ina Coolbrith Park</span>
${links}
</nav></div>
</div>
<figcaption><div class="park-caption"><strong>Ina Coolbrith Park</strong><span>North Beach skyline, built in Village.</span>
<button type="button" class="offline-car" hidden><i aria-hidden="true"></i>Hop the offline cable car</button></div>
<div class="park-tools" hidden>
<button type="button" data-time aria-pressed="false">Night</button>
<button type="button" data-pause aria-pressed="false">Pause flight</button>
<details class="display-settings"><summary>View</summary>
<div class="view-panel"><fieldset><legend>Graphics</legend>
<label>Quality <select name="preset"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>
<label for="park-scale">Resolution limit <span data-scale-value aria-hidden="true"></span>
<input id="park-scale" name="scale" type="range" min="30" max="100" step="5"></label>
<label>Dynamic resolution <input name="dynamic" type="checkbox"></label>
<label>Frame target <select name="target"><option value="30">30 fps</option><option value="60" selected>60 fps</option><option value="120">120 fps</option></select></label>
</fieldset><a data-view="2d" href="/?view=2d">Plain page</a><a data-view="3d" href="/?view=3d" hidden>Live view</a></div></details>
</div></figcaption>
</figure>
${latest.length ? `<section class="park-writing"><h2>Recent writing</h2><ul>${latest.map((p) => `<li><a href="${e(postPath(p.slug))}">${e(p.title)}</a><time datetime="${e(p.date)}">${e(p.date)}</time></li>`).join("")}</ul></section>` : ""}
<section class="park-log" id="site-log" tabindex="-1" aria-labelledby="log-title" hidden>
<h2 id="log-title">Site log</h2>
<time datetime="2026-11-18">18 November 2026</time>
<ul><li>Rebuilt the North Beach skyline from the Village city model.</li><li>Mounted the Blog and Voxelmorphism links on the park directory.</li><li>Added the Signal Desk to Voxelmorphism.</li></ul>
<button type="button" data-mend>Mend the B</button> · <a href="/blog/">Read the blog</a>
</section>
<details class="park-credit"><summary>About this view</summary><p>A Village reconstruction from USGS 3DEP lidar, DataSF buildings and Mapterhorn terrain, with landmark outlines from OpenStreetMap contributors and Overture Maps Foundation. Camera and colour reference from <a href="https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg">Frank Schulenburg’s view of the park</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>).</p>
<details class="park-secrets" hidden><summary>Park secrets</summary>
<p>Hold the B on the park sign, or focus Blog and press Space.</p>
<div class="egg-actions">
<button type="button" data-egg="break">Loosen the B</button>
<button type="button" data-egg="god" aria-pressed="false">IDDQD</button>
<button type="button" data-egg="moon">Resize the moon <i aria-hidden="true"></i></button>
<button type="button" data-egg="roll">Do a barrel roll</button>
<button type="button" data-egg="rain">Wake up</button>
<button type="button" data-egg="rick">Tune the tow banner</button>
<button type="button" data-egg="lives">Konami code</button>
</div></details></details><p class="egg-status" role="status" aria-live="polite"></p>
</div><script type="module" src="/landing/home.js"></script>`;
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
  return { path: "/", kind: "home", title: site.title, description: site.description, html, markdown };
}
