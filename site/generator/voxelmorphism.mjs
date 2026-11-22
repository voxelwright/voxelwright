// /voxelmorphism/: the Signal Desk, an instrument made from Village's Voxelmorphism kit, shown on
// the instrument's mat. The desk's hardware and its controller are the kit's showcase desk
// (Village engine/kit/showcase); its settings are built here from the kit's own parts.
import { sitePath } from "../lib/paths.mjs";

export function voxelmorphismPage(site) {
  const at = (p) => sitePath(site.base, p);
  const description = "Play the Signal Desk, a mechanical control surface built with Village’s Voxelmorphism kit.";
  const shell = (value, name, title, sample, checked = false) =>
    `<label class="sample" title="${title}"><input type="radio" name="shell" value="${value}"${checked ? " checked" : ""}><i style="--sample:${sample}" aria-hidden="true"></i><span>${name}</span></label>`;
  return {
    path: at("/voxelmorphism/"),
    kind: "voxelmorphism",
    title: "Voxelmorphism",
    description,
    stylesheets: ["/vendor/village/kit/showcase/desk.css", "/voxelmorphism/desk.css"],
    script: "/voxelmorphism/desk.js",
    html: `<header class="page-head">
<h1 class="vx-sign page-title" data-vx-board="none">Signal Desk</h1>
<p class="page-lead">An instrument built from Voxelmorphism, the kit every page of this site is made of. Press a lamp key to change the trace, slide the contour fader to shape it, then scan for a new field.</p>
</header>
<div class="signal-desk">
<div class="workbench">
<section id="desk" aria-label="Signal Desk instrument">
<div class="mat"><div class="stitch"></div>
<div class="hardware" inert><div class="case-light" aria-hidden="true"><i></i><i></i></div><div class="vx-backplane" data-vx-casting aria-hidden="true"></div><div class="deckscrews" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
<div class="faceplate">
<div class="facehead"><strong>Village <em>/</em> SD–01</strong><button type="button" id="scan" aria-label="Scan field"><span class="vx-label">Scan</span></button></div>
<div class="console">
<div class="display"><div class="readout"><output for="scan" id="sweep">FIELD SCOPE / 01</output><span id="display-lamp">AMBER</span></div><canvas id="scope" width="444" height="124" aria-hidden="true"></canvas><div class="readout"><span>CONTOUR</span><output for="contour" id="contour-out">04</output></div></div>
<div class="gain"><div class="dial-scale"><span class="vx-rotary" data-vx-detent="release"><input id="gain" type="range" min="0" max="10" value="7" aria-label="Lamp brightness" aria-describedby="gain-help"></span></div><label for="gain">Light <output id="gain-out" for="gain">70%</output></label></div>
</div>
<div class="mix"><label for="contour">Contour</label><span class="vx-slider contour-fader"><input type="range" min="1" max="9" value="4" id="contour"></span></div>
<div id="lamp-bank" class="keybed" role="group" aria-label="Lamp color">
<button class="vx-button" data-vx-pilot="status" data-lamp="amber" aria-pressed="true"><i></i>Amber</button>
<button class="vx-button" data-vx-pilot="status" data-lamp="tide" aria-pressed="false"><i></i>Tide</button>
<button class="vx-button" data-vx-pilot="status" data-lamp="lilac" aria-pressed="false"><i></i>Lilac</button>
<button class="vx-button" data-vx-pilot="status" data-lamp="ember" aria-pressed="false"><i></i>Ember</button>
</div></div></div>
<span class="mat-tag">Village <b>Field series</b></span></div>
<p class="desk-note"><span id="desk-fallback">The controls need JavaScript.</span><span id="gain-help" hidden>Turn the dial or use the arrow keys.</span></p>
</section>
<aside class="vx-card fittings" aria-labelledby="fittings-title" data-vx-bolts="none" inert>
<h2 id="fittings-title">Finish and fittings</h2>
<p class="fittings-note">The whole site is fitted like the desk: change the enclosure and every page follows for this visit.</p>
<div class="vx-groove" role="separator"></div>
<fieldset class="fitting"><legend>Enclosure <output id="shell-name">Walnut</output></legend><div class="samples">
${shell("walnut", "Walnut", "Walnut", `url(${at("/vendor/village/kit/showcase/materials/walnut.jpg")}) center / cover`, true)}
${shell("alloy", "Alloy", "Anodized aluminum", "linear-gradient(130deg,#788b91,#2b404b)")}
${shell("smoke", "Smoke", "Smoked acrylic", "linear-gradient(135deg,#33313e,#89838f 70%,#474552)")}
${shell("frost", "Frost", "Frosted acrylic", "linear-gradient(130deg,#c3cfc8,#eeeae1 65%,#afbdb7)")}
${shell("clear", "Clear", "Clear acrylic", "linear-gradient(130deg,#98bdbb,#f4ffff 42%,#b9d9d7 48%,#edf4eb)")}
</div></fieldset>
<div class="fitting"><label for="caps">Keycaps</label><span class="vx-select"><select id="caps"><option value="field">Ridgeline PBT</option><option value="linen">Parchment</option><option value="carbon">Carbon PBT</option><option value="opal">Opal</option></select></span></div>
<fieldset class="fitting"><legend>Key profile</legend><div class="vx-toggle-group" role="radiogroup" aria-label="Key profile"><label><input type="radio" name="profile" value="low">Low</label><label><input type="radio" name="profile" value="high" checked>Sculpted</label></div></fieldset>
<fieldset class="fitting"><legend>Case lighting</legend><div class="vx-toggle-group" role="radiogroup" aria-label="Case lighting"><label><input type="radio" name="rail" value="steady" checked>Steady</label><label><input type="radio" name="rail" value="spectrum">Spectrum</label></div></fieldset>
<div class="vx-groove" role="separator"></div>
<label class="vx-toggle fitting-sound"><input id="sound" type="checkbox" role="switch"><span class="vx-switch"></span><span>Switch sound <small>Cherry MX Brown</small></span></label>
</aside></div>
</div>`,
    markdown: `# Signal Desk

${description}

Amber, Tide, Lilac and Ember select the lamp color and a cross-section of the field. The contour fader changes the trace, the brass dial adjusts the lamp brightness, and Scan draws a new field.

Choose a walnut, anodized alloy or acrylic enclosure, change the keycaps and switch profile, or try the case lighting. Switch sound is optional. Both the voxel and plain controls support the keyboard.

[Play the Signal Desk](${site.origin}${at("/voxelmorphism/")}) · [Use plain controls](${site.origin}${at("/voxelmorphism/")}?view=2d)
`,
  };
}
