# Ina Coolbrith Park

The ordinary site build copies the files in `static/landing/`. The live view imports the Village device owner at `/vendor/village/blocks/renderer.js`, from the installed Voxelmorphism kit. The tow banner uses the kit’s Vox Text lettering. The marquee is built from solid letters and the park signs use the site’s faces: IBM Plex Sans from the kit and Source Serif 4.

## Source

| Asset | Village source |
| --- | --- |
| City, landmarks and camera | `24b416e0742d4cf834ee59393bb1783adf0f0066` on `feature/423-ina`, particularly `engine/landing/ina/README.md`, `camera.json`, `matte.py`, `heroes.mjs` and `cull.mjs`. The cached `place/ina` output has 707,795 actual faces. |
| Skyline poster | The unpainted model’s own `shots/r12-full.png`, made with `node landing/ina/shoot.mjs --place ina --name r12` from that engine checkout and its cache. The camera is at 86.98 m elevation, bearing 120.205°, with a vertical field of view of 25.049°. |
| Light and materials | Display paths of `engine/page/matte.ts`, `march.ts`, and `glow.ts` at that same commit. The adapter uses a single depth pass with an 8 m near plane, a cached city texture and procedural night windows. |
| Plane, clock and graphics settings | `bdd9e9675a50a21d3e7543eeefa129c17ca2a19b` on `feature/424-sky`, particularly `engine/landing/plane.ts`, `sky.ts`, `player/graphics.ts`, `player/smooth.ts` (FXAA) and the pacing rules in `player/stage.ts`. Low uses directional light, Medium adds baked shadows and FXAA, High adds reflected sky on glass-faced landmarks, and Ultra also supersamples at 1.4×. The landing adapts the backing canvas within the chosen limit, using active frame intervals after warmup. |
| Navigation and egg | The half-second departure follows `feature/421-landing`’s sign push. Keyboard activation follows the native link immediately. The Konami sequence from the site’s #426 notes changes the plane’s banner. |
| Shared device and sign type | The installed Voxelmorphism kit's renderer. |

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

The moon uses the sky pass and cycles through three disc radii on a night tap. The banner hit test projects the tow cloth endpoints from the Village plane. Tapping the cloth changes its message and a dancer appears on the directory. The Konami sequence changes that same cloth to +30 lives. Type “do a barrel roll” for a plane and compass roll, or “neo” / “wake up” to enter the Matrix (see below; the still and the plain page keep a brief fall of window glyphs). Going offline uncovers the cable car on the View sign, on the still directory, or in the plain-page caption.

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

Everything below composites after the cached city copy unless noted, so a still scene costs one copy and a few small passes. After dusk, above Low, the changing windows (see City life) also rebake the city once a second.

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
- **Shutter.** The view flashes white with the press and fades as the print comes out. The preview rises in. From the keyboard, or under reduced motion, there is no flash and the preview only fades. With sound on, `sound.js` plays a synthesised shutter (three filtered ticks and a thud) instead of the directory clack.

Check it in Chrome with WebGPU. Postcards and screenshots go to `.shots/postcard` (or `OUT`).

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-postcard.mjs
```

It makes a night and a day card in the live city and shares one through a stubbed share sheet. It then makes a card by touch from the GPU-free still on a 390 px phone, and one by keyboard on the plain page. Each PNG comes from the real download and must have the card’s size and a varied picture in its photo window. The night card must be darker than the day card. `test/landing-postcard.test.mjs` covers the layout, crop, date and file name, and the HTML twins.

## Lost in the fog (404)

The 404 page (`notFoundPage` in `generator/pages.mjs`, with `static/lost/`) reuses the skyline poster, `static/landing/ina.webp`, under the marine layer. It is served for every unknown address at any depth (`notFoundHandling: "404-page"` in `cloudflare.config.ts`, and the same in `scripts/serve.mjs`), so every URL on it is absolute.

- **Fog.** `lost.css` draws a veil and four banks with gradients. That is the whole picture without a script and under reduced motion or forced colours. With motion allowed, `lost.js` loads `fog.js`, which paints the same veil and banks on one 2D canvas at about a third of the page size, at 30 frames a second, with about sixty soft sprites from a seeded field. The fog drifts left, as the bank moves east, away from the park, in `landing/fog.js`. There is no WebGPU. The fog stops if reduced motion or forced colours turn on.
- **Night.** It follows the system's dark setting and the Night key, as the kit does. The city dims and the bank is navy, lit orange from below by a screen-blended glow: the 3D fog's night colours, in 2D. The canvas reads its colours from the CSS custom properties again on `vx-night`.
- **Interaction.** It is decorative only, and the canvas is `aria-hidden`. A mouse or pen clears a little fog where it moves, and a press or tap on the scene parts it. The gap closes in about two seconds.
- **Sign.** It is HTML and CSS in the park directory's colours from `landing/sign-paint.js`: enamel, rim, rivets, brass and cream, with plates that turn brass on hover, focus and press. The painter's `paintBoards` draws the 3D directory's atlas, with a fixed header and label map and no Home plate, and its drawing helpers are private. So the page copies its palette rather than calling it. The sign names the asked-for address when a script runs, and says "this address" when none does.
- **Twin.** There is no Markdown twin: `/404.html` is not a page route, and the Worker falls back to this HTML.

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-lost.mjs
```

It checks the 404 status at several depths, including a request that accepts Markdown. It follows each way out and runs without a script. It checks reduced motion, including when it turns on mid-visit, and night from the system, a saved Night and a saved day. At 390 px it uses a long address and checks the edges and plate sizes, and it checks the edges again at 768 px. It checks that a tall screen doesn't scroll. It also checks that the pointer and a tap clear the fog. Screenshots go to `.shots/lost` (or `OUT`).

## City life

`static/landing/life.js` adds the life that reads from the park over the roofs and the skyline. Everything moves on the paused clock, so Pause stops it where it is. It is off on Low, and reduced motion keeps the GPU-free still.

- **Windows.** The city shader gives each pane a fixed lit value. `windowsShader` patches that line at runtime, and `shaders.js` stays as the refresh emits it. Each pane now keeps its state for two to eight minutes, then rolls again. The rolls land on whole seconds of the paused clock (`Globals.pad1`). After dusk the cached city rebakes once a second, and a few panes across the city change on each rebake. By day and on Low the clock is not baked in. A zero clock reproduces the original pattern exactly, so the first frame matches the still.
- **Gulls.** Four small flocks of western gulls (18 birds) circle over the slope between the park and downtown, 100 to 310 m out. Each flock is placed by bearing and range from the survey station in `place.json`, at 100 to 116 m over NAVD88. They circle at 9 m/s, bank into the turn and flap in short bursts, with a 1.3 m wingspan at true scale. `test/landing-life.test.mjs` checks that the lowest bird stays at least 10 m above every roof under its orbit, wander included, and that every flock is inside the surveyed view. After dark the city's light catches their undersides. The gulls are drawn in one pass after the fog, the beacons and the tow plane. They depth-test against the cached city and never write depth, so towers, roofs and the signs hide them.

Some candidates were tried and dropped. Street traffic and the cable cars were dropped because almost no street is visible from the survey camera. A raster of the pack from the camera finds about 160 half-resolution pixels of road surface, nearly all of it a sliver of the Embarcadero at the left edge. Boats were dropped because the bay shows only as a small window under the Bay Bridge, cropped out at 16:10 and on phones. Rooftop steam was dropped because plumes on the flat roofs of large office blocks 300 m to 1.2 km out barely showed by day at true scale. At night the nearest plume read as a grey smear rather than steam. Rooftop flags were dropped because the pack does not record which roofs have flagpoles. The tower beacons already light the tallest roofs.

Cost on the default path: one extra render pass with one draw a frame (18 gulls of three boxes each, 1,944 vertices) and one 16-byte uniform write. There is no per-frame simulation on the CPU, because all motion is computed in the vertex shader. After dusk the city also rebakes once a second.

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-life.mjs
```

The check counts the gull draws and the city's rebakes by wrapping WebGPU's encoder. It covers one gull draw per frame and a steady preset over 30 idle seconds at night (`IDLE` overrides the duration). It also covers one rebake a second at night on a fixed High setting and none by day. Under Pause the life clock is frozen, Low draws nothing, reduced motion keeps the still, and the phone layout has no sideways scroll. It saves day, night and phone screenshots to `.shots/life` (`OUT` overrides).

## Window screen and the Matrix

`static/landing/screen.js` turns the city's glazed panes into one screen seen from the park. Every pane is a pixel: it shows the colour of a small picture at the spot where the pane's centre lands on the view. A program fills RGBA bytes for a time in seconds (`draw(pixels, width, height, t)`); the picture is 90 rows by default, with its width following the view's aspect so pixels stay square. Anything that can fill those pixels can play: `testCard()` (a hue sweep with a grid, for calibration), the code rain, and later stills, video frames or an equalizer from an `AnalyserNode`.

- **Window map.** When the city rebakes and something is showing, a second pass reruns the city's vertex shader against the city's own depth (`less-equal`, no writes, so the signs hide what is behind them) with a `panes` fragment appended by `screenShader`. It writes, for each pixel on glass, the pane centre's view position and the pane's glass coverage. The centre is found in world space from the facade's axes, so a near window is one flat pixel and a distant facade becomes a solid block of light. The city and the map share one explicit pipeline layout and the position is `@invariant`, so both land on identical depths. The map pipeline compiles the first time something is shown.
- **Composite.** Each frame one full-screen pass reads the map and the picture and blends premultiplied: alpha is how much of the pane's own look the picture covers, colour is the light it gives off. It draws after the cached copy and before the marine layer, so fog veils the far towers.
- **Cost.** With nothing showing, neither pass runs and the frame is exactly the old one (checked pixel for pixel under Pause). While showing: one full-screen pass and one small texture upload a frame, plus the map pass on each rebake.

`static/landing/mood.js` is the weather half. `world.mood(0..1)` rolls an overcast deck over the sky in 2.6 s (and clears in 1.4 s) on real time, so it settles under Pause. `moody` adjusts the baked Globals: daylight and direct sun drop, the fill and sky go to dark grey-green, `weather.x` carries the deck and `weather.z` (the lamps and lit windows) goes to zero. `moodSky` adds the deck at the end of the pinned sky shader, behind a `weather.x > 0` branch, and the moon fades with it. The marine layer (`fog.js`, given the mood) thickens 1.4 times, rises 60 m, comes in to 120 m from the eye, fills its gaps and turns pale grey-green; with the bank above the eye, rising rays cross it too, so there is no seam at the horizon. A final multiply grade tints everything drawn (signs, gulls and the tow plane included) toward green with a soft vignette. Every change is the identity at mood 0.

**The Matrix** (`static/landing/matrix.js`, triggered in `eggs.js`). Type “neo”, “wake up”, “red pill” or “follow the white rabbit”, press Wake up in Park secrets, or tap one of the red tower beacons (the red pill). The city's lights go out, the deck closes over the park and code rain arrives from the top of the view and falls down the facades: pale heads, green tails and panes that flicker as their glyph changes. While it runs the park directory acts as a digital billboard: its control row (Night, Pause, Sound, Postcard, View) gives way to one Exit the Matrix plate in phosphor green, backed by a native button like every other plate. Leave with that plate, Esc, “blue pill” or Wake up again. Pause freezes the rain on a full frame. Low keeps its marine layer off except for a light four-step one while the mood is up. Reduced motion, forced colours and the GPU-free still keep the brief CSS glyph fall. Nothing is saved, and the visitor's Night choice is never touched. The rain, its timing and the glyph flicker are original to this site.

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-matrix.mjs
```

The check counts the egg's passes by pipeline label. Without the egg the city draws no map, screen or grade. Under Pause it enters by typing, checks the rain holds, leaves with Esc and compares the view pixel for pixel with the one before. Playing, it taps a red tower light (the check exposes the live world to find one) and checks one screen and grade draw a frame and a map only with each rebake. It also covers day, “blue pill” and “follow the white rabbit”, Low with the mood’s light fog (and none after), 20 s of lean on the adaptive default with the egg on (the preset holds), that no tower light’s tap reach covers the moon, a 390 px phone by touch in both themes (the controls give way to the exit plate) and reduced motion. Screenshots go to `.shots/matrix` (or `OUT`). `test/landing-matrix.test.mjs` covers the shader patches, the identity at mood 0 and the rain's arrival.

## Video on the windows: the Rickroll and Bad Apple!!

`static/landing/video.js` plays video on the window screen. One hidden `<video>` element plays an egg's file, sound included, and is the clock. Each frame the program draws whatever frame the element is showing into the picture (`drawImage`, then `getImageData`), fitted into the band of the view where the windows are (10–98 % of its height). A wide view shows a 4:3 picture whole; a tall phone crops up to half its width rather than shrinking it to a strip. The program gives the screen a `key()` that changes only when the element presents a new frame (`requestVideoFrameCallback`, or a seek), so the picture uploads at the video's own rate (25 or 30 a second) and not at all while paused or loading. Pausing the element pauses the windows and the sound together, so they can't drift.

Why one muxed MP4 per egg and not a frame pack plus `<audio>`: the media element keeps picture and sound in sync for free, H.264 at window resolution is far smaller than any frame pack for a colour video, and one element is one clock. Each file is fetched whole as a blob when its egg starts, then played from an object URL. A media element otherwise streams by byte ranges. Cloudflare's static assets may not serve those, and Safari won't play a video without them. Nothing loads with the page. The element is started inside the visitor's tap or key press, before its file arrives, because some browsers only let an element play sound if it was first started from a gesture. If the browser still refuses, the egg plays muted and says so. Unmute (a fresh tap) brings the sound, or on the plain page, which has no directory, the egg's own button pressed again.

**Sound.** An egg's sound plays because the visitor started the egg, whatever the site's Sound choice is (off by default). While a video plays, the city's soundscape steps aside and comes back after. The billboard's Mute silences only that video, for that play. Nothing is saved, and the saved Sound choice is never changed.

**The billboard.** While a video plays, the park directory's control row becomes Pause, Mute and Stop, each backed by a native button (the existing Pause, and `[data-sign="video-mute"]` and `[data-sign="video-stop"]`). Its header reads "Now playing" and the title. Pause is the city's own Pause: it holds the video, its sound, the flight and the fog together. An egg started under Pause holds a frame a few seconds in (`still`) and starts from the top on Play. Leave with Stop, Esc, the egg's own trigger again, or by letting the song end. Starting the Matrix stops a video, and a video leaves the Matrix.

**Moods.** `mood.js` takes a palette. Each one sets the overcast deck's share of the sky, the sun and daylight left, the lamps left on, the marine layer's thickness and tone, and a final grade: tint, saturation, vignette and scan lines. The Matrix is the original green (its grade is still the multiply). Bad Apple is a black, starless night in black and white, with only the windows lit. The Rickroll is a 1987 dusk: a magenta horizon under a violet sky, a thin rose stage haze, half the lamps on, a warm tint and the faint lines of a tape. A grade that changes saturation or draws lines copies the view and reads it (the canvas has `COPY_SRC` for that); at mood 0 neither the copy nor the pass runs. A new palette waits for the old one to clear. Every palette is the identity at 0 (`test/landing-video.test.mjs`).

**Triggers.**
- **Rickroll.** Tap the tow banner once and it reads "Never gonna give you up" and the dancer appears (as before). Tap the tuned banner again and the song plays on every window. On a narrow view (a phone) the plane used to start mostly beyond the left edge and come into view only minutes later. It now starts where tuning puts it, in view; wide views are unchanged. You can also type "rickroll" or "never gonna give you up", or use Rickroll the windows in Park secrets. Park secrets lives under About this view, which only the plain page shows, so a phone with reduced motion reaches it through the still's About plate.
- **Bad Apple!!** Flip Night four times within four seconds: black and white, black and white. It works by click, tap or keyboard on the Night plate; only real presses count, not system theme changes. You can also type "bad apple" or use Bad Apple!! in Park secrets.

**Fallbacks.** Reduced motion, forced colours, no WebGPU, and the plain page have no windows to play on. There the egg is sound only: the still's directory shows Mute and Stop (no Pause), Park secrets toggles it on the plain page, and Esc stops it. If the GPU is lost mid-play, the song carries on as sound only; a paused egg stops. Hiding the tab pauses the video and showing it resumes it, as with the city's sound.

**Assets and credit.** Both clips come from the optional private media overlay; neither is in the repository. Only what the windows need ships: 160 × 120 H.264 frames at the source frame rate and 48 kb/s HE-AAC audio normalised to −16 LUFS (Bad Apple's master is about 8 dB hotter than Rick's, and a phone ignores a page's volume), about 3 MiB each, in the private directory selected by `VOXELWRIGHT_EGG_MEDIA`. Both sources and encodes stay outside the repo. The standalone landing copies them only for an opted-in build. Rebuild with:

```sh
uvx yt-dlp -f "bv*[height<=480]+ba" -o "%(id)s.%(ext)s" https://youtu.be/dQw4w9WgXcQ https://youtu.be/FtutLA63Cp8   # in a folder outside the repo
node scripts/landing/encode-eggs.mjs --rick <folder>/dQw4w9WgXcQ.webm --apple <folder>/FtutLA63Cp8.webm
```

- "Never Gonna Give You Up", Rick Astley (1987), written and produced by Stock Aitken Waterman; music video directed by Simon West. RCA Records / Sony Music. https://youtu.be/dQw4w9WgXcQ
- "Bad Apple!! feat. nomico", Alstroemeria Records (arrangement by Masayoshi Minoshima of ZUN's "Bad Apple!!" from the Touhou Project). Shadow-art PV by Anira (あにら). https://youtu.be/FtutLA63Cp8

```sh
npm run build
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-video.mjs
```

Every egg in the check starts from a click, key press or tap. Playwright's input counts as a user gesture, so it cannot show a browser refusing sound; one section simulates that with a `play()` that refuses, and checks the egg plays muted and the button brings the sound. The check confirms that no egg file loads with the page or with a single banner tap, and that the file loads on the trigger and is reused on a replay. With nothing playing the city draws no map, screen, grade or upload. Under Pause the tuned banner's second tap holds a frame (the media is paused at its still, nothing uploads, the pixels hold); Stop then gives back the exact city, pixel for pixel, and nothing is left drawing. Playing, the song starts from the top with sound, and the media clock runs in real time. There is one screen draw and one grade per frame, and uploads come at the video's 25 fps. Pause freezes the clock and the pixels; Mute and Unmute change only the element, and nothing is saved. Stop and the song's end both end the egg. A video and the Matrix give way to each other, and Esc stops. Bad Apple plays on the fourth Night flip (not the third) by night and by day. A 390 px phone, by touch in both themes, taps the banner twice and Night four times; the three plates are full touch targets and nothing scrolls sideways. It also checks that the sound is decoded (`webkitAudioDecodedByteCount`), not only unmuted. Reduced motion plays sound only from the still, with Mute and Stop on its directory; switched on mid-song, the song carries on as sound only, and a paused song stops. The plain page plays from Park secrets, stopped by Esc or the same button. A Low preset run plays and leaves nothing drawing. Screenshots go to `.shots/video` (or `OUT`).
