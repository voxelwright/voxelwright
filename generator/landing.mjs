import { escapeHtml as e } from "./markdown.mjs";
import { markdownTwin, postPath } from "../lib/paths.mjs";

const destinations = [
  { href: "/blog/", label: "Blog" },
  { href: "/voxelmorphism/", label: "Voxelmorphism" },
];

export function homePage(site, posts, tagsWithPosts) {
  const latest = posts.filter((p) => !p.draft).slice(0, 3);
  const links = destinations
    .map(({ href, label }) => `<a href="${href}"><span>${label}</span><b aria-hidden="true">↗</b></a>`)
    .join("");
  const html = `<link rel="stylesheet" href="/landing/park.css">
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
<figcaption><div class="park-caption"><strong>Ina Coolbrith Park</strong><span>North Beach skyline, built in Village.</span></div>
<div class="park-tools" hidden>
<button type="button" data-time aria-pressed="false">Night</button>
<button type="button" data-pause aria-pressed="false">Pause flight</button>
<details class="display-settings"><summary>View</summary><div><label>Resolution <select><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option><option value="low">Low</option></select></label><a href="/?view=2d">Plain page</a></div></details>
</div></figcaption>
</figure>
${latest.length ? `<section class="park-writing"><h2>Recent writing</h2><ul>${latest.map((p) => `<li><a href="${e(postPath(p.slug))}">${e(p.title)}</a><time datetime="${e(p.date)}">${e(p.date)}</time></li>`).join("")}</ul></section>` : ""}
<details class="park-credit"><summary>About this view</summary><p>A Village reconstruction from USGS 3DEP lidar, DataSF buildings and Mapterhorn terrain, with landmark outlines from OpenStreetMap contributors and Overture Maps Foundation. Camera and colour reference from <a href="https://commons.wikimedia.org/wiki/File:View_of_San_Francisco_from_Ina_Coolbrith_Park-01445.jpg">Frank Schulenburg’s view of the park</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>).</p></details>
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
