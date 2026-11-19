// Instrument markup adapted from Village PR 443, engine/kit/showcase/index.html.
export function voxelmorphismPage(site) {
  const description = "Play the Signal Desk, a mechanical control surface built with Village’s Voxelmorphism kit.";
  return {
    path: "/voxelmorphism/",
    kind: "voxelmorphism",
    title: "Voxelmorphism",
    description,
    html: `<link rel="stylesheet" href="/vendor/village/kit/voxelmorphism.css">
<link rel="stylesheet" href="/vendor/village/kit/showcase/desk.css">
<link rel="stylesheet" href="/voxelmorphism/site.css">
<header class="signal-intro">
  <p>Voxelmorphism</p>
  <h1>Signal Desk</h1>
  <p>Press a lamp key to change the trace. Slide the contour fader to shape it, then scan for a new field.</p>
</header>
<div class="signal-desk">
<div class="workbench" hidden>
<section id="desk" aria-label="Signal Desk instrument">
<div class="mat"><div class="stitch"></div>
<div class="hardware"><div class="case-light" aria-hidden="true"><i></i><i></i></div><div class="vx-backplane" data-vx-casting aria-hidden="true"></div><div class="deckscrews" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
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
<div class="caption"><a id="view-mode" href="?view=2d">Use plain controls</a><span id="gain-help">Turn the dial or use the arrow keys.</span></div>
</section>
<aside class="setup" aria-label="Build settings"><header><h2>Finish &amp; fittings</h2></header>
<fieldset id="shells"><legend>Enclosure <output id="shell-name">Walnut</output></legend><div class="samples">
<label title="Walnut"><input type="radio" name="shell" value="walnut" checked><i style="--sample:url(/vendor/village/kit/showcase/materials/walnut.jpg) center / cover" aria-hidden="true"></i><span>Walnut</span></label>
<label title="Anodized aluminum"><input type="radio" name="shell" value="alloy"><i style="--sample:linear-gradient(130deg,#788b91,#2b404b)"></i><span>Alloy</span></label>
<label title="Smoked acrylic"><input type="radio" name="shell" value="smoke"><i style="--sample:linear-gradient(135deg,#33313e,#89838f 70%,#474552)"></i><span>Smoke</span></label>
<label title="Frosted acrylic"><input type="radio" name="shell" value="frost"><i style="--sample:linear-gradient(130deg,#c3cfc8,#eeeae1 65%,#afbdb7)"></i><span>Frost</span></label>
<label title="Clear acrylic"><input type="radio" name="shell" value="clear"><i style="--sample:linear-gradient(130deg,#98bdbb,#f4ffff 42%,#b9d9d7 48%,#edf4eb)"></i><span>Clear</span></label>
</div></fieldset>
<label class="choice" for="caps">Keycaps<select id="caps"><option value="field">Ridgeline PBT</option><option value="linen">Parchment</option><option value="carbon">Carbon PBT</option><option value="opal">Opal</option></select></label>
<fieldset class="profile"><legend>Key profile</legend><div><label><input type="radio" name="profile" value="low">Low</label><label><input type="radio" name="profile" value="high" checked>Sculpted</label></div></fieldset>
<fieldset class="profile rail-choice"><legend>Case lighting</legend><div><label><input type="radio" name="rail" value="steady" checked>Steady</label><label><input type="radio" name="rail" value="spectrum">Spectrum</label></div></fieldset>
<label class="sound vx-toggle"><input id="sound" type="checkbox" role="switch"><span class="vx-switch"></span><span>Switch sound<small>Cherry MX Brown</small></span></label>
</aside></div>
<p id="desk-fallback">The Signal Desk pairs a field scope with four latching lamp keys, a brass dimmer and a contour fader. The interactive controls use JavaScript.</p>
</div>
<script type="module" src="/voxelmorphism/desk.js"></script>`,
    markdown: `# Signal Desk

${description}

Amber, Tide, Lilac and Ember select the lamp color and a cross-section of the field. The contour fader changes the trace, the brass dial adjusts the lamp brightness, and Scan draws a new field.

Choose a walnut, anodized alloy or acrylic enclosure, change the keycaps and switch profile, or try the case lighting. Switch sound is optional. Both the voxel and plain controls support the keyboard.

[Play the Signal Desk](${site.origin}/voxelmorphism/) · [Use plain controls](${site.origin}/voxelmorphism/?view=2d)
`,
  };
}
