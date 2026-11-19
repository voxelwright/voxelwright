# Ina Coolbrith Park

The ordinary site build copies the files in `static/landing/`. It needs neither a Village checkout nor a running Village server. The live view imports the Village device owner at `/vendor/village/blocks/renderer.js`, vendored with the Voxelmorphism kit (pinned in `scripts/refresh-voxelmorphism.mjs`). The tow banner uses the kit’s Vox Text lettering. The marquee is built from solid letters and the park signs use the site’s faces: IBM Plex Sans from the kit and Source Serif 4.

## Source

| Asset | Village source |
| --- | --- |
| City, landmarks and camera | `24b416e0742d4cf834ee59393bb1783adf0f0066` on `feature/423-ina`, particularly `engine/landing/ina/README.md`, `camera.json`, `matte.py`, `heroes.mjs` and `cull.mjs`. The cached `place/ina` output has 707,795 actual faces. |
| Skyline poster | The unpainted model’s own `shots/r12-full.png`, made with `node landing/ina/shoot.mjs --place ina --name r12` from that engine checkout and its cache. The camera is at 86.98 m elevation, bearing 120.205°, with a vertical field of view of 25.049°. |
| Light and materials | Display paths of `engine/page/matte.ts`, `march.ts`, and `glow.ts` at that same commit. The adapter uses a single depth pass with an 8 m near plane, a cached city texture and procedural night windows. |
| Plane, clock and graphics settings | `bdd9e9675a50a21d3e7543eeefa129c17ca2a19b` on `feature/424-sky`, particularly `engine/landing/plane.ts`, `sky.ts`, `player/graphics.ts`, `player/smooth.ts` (FXAA) and the pacing rules in `player/stage.ts`. Low uses directional light, Medium adds baked shadows and FXAA, High adds reflected sky on glass-faced landmarks, and Ultra also supersamples at 1.4×. The landing adapts the backing canvas within the chosen limit, using active frame intervals after warmup. |
| Navigation and egg | The half-second departure follows `feature/421-landing`’s sign push. Keyboard activation follows the native link immediately. The Konami sequence from the site’s #426 notes changes the plane’s banner. |
| Shared device and sign type | The Voxelmorphism kit's vendored renderer, at the commit pinned as `PIN` in `scripts/refresh-voxelmorphism.mjs`. |

The city uses USGS 3DEP lidar, DataSF buildings, Mapterhorn terrain, OpenStreetMap contributors and Overture Maps Foundation landmark outlines. Building colours, illumination and camera fitting reference Frank Schulenburg’s CC BY-SA 4.0 photograph. The page credits the image and links to its source and licence. The export uses the unpainted city pack exclusively. It contains no photographic atlas, reference picture, overlay or diagnostic render.

## Refresh

Run from the site checkout with its locked dependencies installed. The prep also uses Git and `cwebp` (libwebp). Supply a Village clone with both pinned commit objects, plus the private Ina build cache described in Village’s Ina README.

```sh
node scripts/landing/prepare.mjs "$VILLAGE_REPO" "$INA_CACHE"
git diff --exit-code -- static/landing
```

The cache must contain `home/.village/engine/place/ina/index.json`, its named binary blocks, and the original model capture under `shots/`. An existing local Ina cache is usually at `~/.village/engine/landing/ina`. Prep verifies the capture’s digest, checks block lengths and face counts, groups matching byte positions for gzip, and emits the display shaders and sky code from the pinned Git objects. The scripts, build cache and screenshot evidence live outside the published static directory.

## Park secrets (#426)

The short tap and held press follow the interaction in Village `feature/421-landing` at `ef68e752dc98135994e8f6ffaaaa9fc987a4e481`. On this directory, hold the B for at least 540 ms and release, or focus Blog and press Space. LOG opens a fragment on the same home page. Mend restores the Blog link. IDDQD mends the sign and protects it until the code is entered again. The log describes site commits `311b936`, `9606bb8` and `cf84767`.

The moon uses the sky pass and cycles through three disc radii on a night tap. The banner hit test projects the tow cloth endpoints from the Village plane. Tapping the cloth changes its message and a dancer appears on the directory. The Konami sequence changes that same cloth to +30 lives. Type “do a barrel roll” for a plane and compass roll, or “neo” / “wake up” for a brief fall of window glyphs. Going offline uncovers the cable car on the View sign, on the still directory, or in the plain-page caption.

About this view → Park secrets carries native button equivalents, including a moon-size sample and banner text on the plain page. The B bitmap, cable car, dancer, glyph arrangement, console skyline and procedural lunar marks are original to this adapter. The roll is a small addition to the pinned plane shader in the refresh script. There are no downloaded sprites, audio, or new runtime dependencies.

Build and smoke-test the production output.

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-eggs.mjs
```

If Playwright already resolves from the site checkout, omit `PLAYWRIGHT`. The test serves `dist/` on a loopback port and closes the server at the end. Set `BASE` to use an already running site or `OUT` to override the screenshot directory (`.shots/eggs`). The test opens Chrome with WebGPU and a light saved graphics setup, then exercises the graphics controls, paused rendering, and the docked Support button. It also checks that reduced motion keeps the city as its still, then the plain page (`?view=2d`) with reduced motion and at a touch viewport.

## Full-screen city and signs

The home view keeps the exported Ina geometry in the Village Bay frame. New fixtures in `static/landing/signs.js` take an easting and northing in NAD83 / UTM zone 10N (EPSG:26910) and an elevation in NAVD88 metres. `surveyPoint` maps these to the pack's decimetres, with X east of 500,000 m, Z south of 4,250,000 m, and Y above the 1 m datum. A 1 m move along any axis spans ten engine units. The display crop changes the lens framing while preserving the world scale.

The BLOG marquee stands on building 3174 and the Voxelmorphism lightbox on building 1374. Their supports were placed against the Ina lidar surface. The park directory and folding graphics panel stand on the slope in front of the survey camera. Letters, cabinets, posts and lamps share the buildings' depth buffer. Browser links and form controls follow the projected faces for keyboard, touch and modified clicks. Narrow views repeat the destinations on the directory.

The shipped model covers the surveyed, visibility-culled view from Ina Coolbrith Park. Additional city blocks can use the same survey frame. A GPU-free still draws the fixtures over the model capture and keeps navigation available. The home page is always the full-screen city: reduced motion, forced colours and data saver get that GPU-free still, and a saved "Plain page" choice from the reading pages does not apply here. Only `?view=2d` (the city's Plain page sign and first Tab stop) uses the plain document.

## Atmosphere, arrival and sound

Everything below composites after the cached city copy unless noted, so a still scene costs one copy and a few small passes.

- **Marine layer** (`static/landing/fog.js`). A depth-aware march through a drifting fog slab that tops out between 70 and 125 m, beginning 420 m from the eye, so the signs stay clear and the downtown footings sink into it. It uses the paused clock, takes 6, 9 or 12 steps on Medium, High or Ultra, and is off on Low.
- **Tower beacons** (`static/landing/beacons.js`). Red flashers on the 14 tallest roofs above 140 m within 6 km, found in the decoded face buffer at load. They pulse together about thirty times a minute.
- **Lean** (`lean` in `static/landing/survey.js`). With a fine pointer the eye shifts up to 25 cm sideways and 10 cm up, and the camera turns so the park directory stays on the same view ray. The city rebakes only while the spring moves. The rest pose is the exact survey camera; Low, touch, the open graphics panel and Pause keep the eye still.
- **Arrival**. On the first visit of a session the directory strikes, the BLOG bulbs light one by one and the Voxelmorphism tubes catch twice before they hold. This rebakes for 2.4 s after dusk only. Fog rolls in over 3.5 s and the beacons start at 2 s on every visit.
- **Sound** (`static/landing/sound.js`). Synthesised wind and street hum, a distant foghorn, a cable car bell, the panned tow plane and a clack under directory presses. It stays silent until the visitor presses Sound. A saved choice waits for their first key or press, and hiding the tab stops it.

## Postcards

`static/landing/postcard.js` prints the view as a 6 by 4 inch picture postcard (1800 × 1200, or 1200 × 1800 when the view is taller than wide). The photo fills the card inside a printed margin, with “Greetings from” in Source Serif 4 over SAN FRANCISCO in the kit’s Vox Block glyphs. Those are set as solid gold voxels, extruded and bevelled cell by cell. The wider foot margin carries Ina Coolbrith Park, San Francisco, the date and `zahynailo.dev`. The preview is the kit’s dialog, labelled “Your postcard”. It offers Download PNG, Share (only where `navigator.canShare({ files })` accepts the PNG) and Close. Escape and the backdrop also close it, and focus returns to the control that opened it.

- **Where the control is.** Postcard is its own icon plate on the park directory, between Sound and View. It isn’t in the View panel, because opening that panel brings the lean back to rest and reframes the camera for the panel. A control there couldn’t capture the view the visitor had been looking at. The plate also stands in the same place on the GPU-free still (after Plain page), and the plain page has a Make a postcard button under the picture. Sound and Postcard plates are 0.65 of a worded plate, so they stay at least 44 px wide on a 390 px phone.
- **What it shows.** The card shows the current frame, with its time of day, lean, moon, tow banner, fog and beacons. The BLOG marquee and the Voxelmorphism lightbox stay in the picture, because they stand on real roofs like any neon on a city postcard. They are drawn unlit by pointer or focus. The park directory and its folding panel are interface, so `signs.js` drops fixture 3’s faces for that one frame. Its hits, cabinet and crop stay, so neither the camera nor the native controls move.
- **Reading WebGPU.** The canvas is configured without `COPY_SRC` in `place.js`, and its picture is gone once the frame is presented. `home.js` therefore asks for one frame without the directory, copies the canvas with `drawImage` in the same task that submitted it, and then lets the next frame restore the directory. Those frames don’t count as pacing evidence. If the GPU falls back while a postcard is waiting, the still takes the postcard. The card is printed at the canvas’s current backing resolution; making a postcard never changes the visitor’s graphics settings.
- **Still and plain page.** The still’s card is drawn from the poster at the still’s crop, with the fixtures over it and the directory left out. The plain page prints the poster alone, kept a little left of centre so the Pyramid and Salesforce Tower stay in. Both are daytime, like the poster.
- **Shutter.** The view flashes white with the press and fades as the print comes out. The preview rises in. Under reduced motion there is no flash and the preview only fades. With sound on, `sound.js` plays a synthesised shutter (three filtered ticks and a thud) instead of the directory clack.

Check it in Chrome with WebGPU. Postcards and screenshots go to `.shots/postcard` (or `OUT`).

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-postcard.mjs
```

It makes a night and a day card in the live city and shares one through a stubbed share sheet. It then makes a card by touch from the GPU-free still on a 390 px phone, and one by keyboard on the plain page. Each PNG comes from the real download and must have the card’s size and a varied picture in its photo window. The night card must be darker than the day card. `test/landing-postcard.test.mjs` covers the layout, crop, date and file name, and the HTML twins.
