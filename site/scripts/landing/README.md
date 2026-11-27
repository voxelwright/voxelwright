# Ina Coolbrith Park: the 3D landing

The landing is a full-screen WebGPU view of San Francisco from Ina Coolbrith Park, with the site's menu standing on
real roofs: the BLOG marquee on building 3174 and the Voxelmorphism lightbox on building 1374, and a park directory
in front of the camera. Its files are in `static/landing/`. This folder holds the script that refreshes them from the
engine and the browser checks.

**The landing is built only when the site owns its origin** (`base: "/"`, `generator/landing.mjs`). The shipped site
is mounted at `/blog/` with the personal front page at `/`, so zahynailo.dev does not serve it today. The 404 page
reuses the poster (`static/landing/ina.webp`), and `npm run cards` paints the share cards from the poster and
`sign-paint.js`. See [the site guide](../../../guide/site.md#the-landing).

Run the commands below from `site/`.

## How it is put together

- **The city** is the engine's Ina place (`engine/landing/ina/`), exported as one gzip of faces
  (`static/landing/ina.faces.gz`) in the engine's Bay frame. `place.js` draws it once into a cached texture, and each
  frame composites the passes below over that copy, so a still scene costs one copy and a few small passes.
- **Fixtures** (`signs.js`) take an easting and northing in NAD83 / UTM zone 10N (EPSG:26910) and an elevation in NAVD88
  metres. `surveyPoint` (`survey.js`) maps them to the pack's 10 cm cells. They share the city's depth buffer, and
  real links and form controls follow their projected faces for keyboard, touch and modified clicks.
- **Graphics presets.** Low uses directional light, Medium adds baked shadows and FXAA, High adds reflected sky on
  glass-faced landmarks, and Ultra also supersamples. The canvas adapts within the chosen limit.
- **The view rule.** The home page is always the full-screen city. Only `?view=2d` (the Plain page sign, the first
  Tab stop) gives the plain document. Reduced motion, forced colours and Save-Data get the GPU-free still: the poster
  with the fixtures over it, navigation intact.

| File in `static/landing/` | What it adds |
| --- | --- |
| `home.js` | Starts the view, the still and the plain page, and wires the directory's controls. |
| `fog.js` | The marine layer: a depth-aware march through a drifting fog slab. Off on Low. |
| `beacons.js` | Red flashers on the 14 tallest roofs above 140 m within 6 km. |
| `survey.js` | The survey frame, and the lean: with a fine pointer the eye shifts a little and the directory stays on its ray. |
| `life.js` | Windows that change after dusk, and four flocks of gulls. Off on Low. |
| `sound.js` | Synthesised wind, hum, foghorn, cable car bell, the tow plane and the directory's clack. Silent until the visitor presses Sound. |
| `postcard.js` | Prints the current view as a 6 by 4 inch postcard (1800 × 1200, or 1200 × 1800 upright), downloadable and shareable. |
| `screen.js` | The window screen: every glazed pane is a pixel of a small picture a program fills. Draws nothing until something shows. |
| `mood.js` | Weather moods: an overcast deck, dimmed light, a thicker fog and a final grade. The identity at mood 0. |
| `matrix.js`, `video.js`, `eggs.js` | The eggs (below). |

## Easter eggs

Each egg has a native button in About this view → Park secrets, so the plain page and keyboard reach it too.

| Egg | Trigger |
| --- | --- |
| LOG | Hold the B on the BLOG sign for at least 540 ms and release (or focus Blog and press Space). It breaks off; LOG opens a log of the site. Mend restores it. |
| God mode | Type IDDQD: the sign is mended and protected until it is typed again. |
| The moon | Tap it at night; it cycles through three sizes. |
| The tow banner | Tap the cloth to change its message; the Konami code makes it +30 lives. |
| Barrel roll | Type "do a barrel roll". |
| The Matrix | Type "neo", "wake up", "red pill" or "follow the white rabbit", or tap a red tower light. Code rain falls down the facades and the directory becomes one Exit the Matrix plate. Leave with it, Esc or "blue pill". |
| Rickroll | Tap the tuned banner a second time, or type "rickroll" or "never gonna give you up". The song plays on every window. |
| Bad Apple!! | Flip Night four times within four seconds, or type "bad apple". |
| The cable car | Go offline: it shows on the View sign, the still or the plain page. |

The two videos play from one muxed MP4 each, fetched whole as a blob when the egg starts (a static host may not serve
byte ranges, and Safari won't play a video without them), and started inside the visitor's gesture so sound is allowed. If
sound is refused anyway, the egg plays muted and says so. Without WebGPU, or under reduced motion, an egg is sound only.
Nothing is saved, and the visitor's Night and Sound choices are never changed.

Both clips come from the private media folder in `VOXELWRIGHT_EGG_MEDIA` (`rick.mp4`, `bad-apple.mp4`, from
`lib/egg-overlay.mjs`) and are copied only into an opted-in build. They are never in the repository. Encode them
(160 × 120 H.264, HE-AAC normalised to −16 LUFS) from sources kept outside the repo:

```sh
uvx yt-dlp -f "bv*[height<=480]+ba" -o "%(id)s.%(ext)s" https://youtu.be/dQw4w9WgXcQ https://youtu.be/FtutLA63Cp8   # in a folder outside the repo
node scripts/landing/encode-eggs.mjs --rick <folder>/dQw4w9WgXcQ.webm --apple <folder>/FtutLA63Cp8.webm
```

- "Never Gonna Give You Up", Rick Astley (1987), written and produced by Stock Aitken Waterman; music video directed
  by Simon West. RCA Records / Sony Music. https://youtu.be/dQw4w9WgXcQ
- "Bad Apple!! feat. nomico", Alstroemeria Records (arrangement by Masayoshi Minoshima of ZUN's "Bad Apple!!" from the
  Touhou Project). Shadow-art PV by Anira (あにら). https://youtu.be/FtutLA63Cp8

Every other egg's art and sound is original to this site: no downloaded sprites or audio.

## The 404 page

"Lost in the fog" (`notFoundPage` in `generator/pages.mjs`, with `static/lost/`) puts the skyline poster under the
marine layer. It is served for every unknown address at any depth (`notFoundHandling: "404-page"`), so every URL on it
is absolute. Without a script, or under reduced motion, CSS draws the fog still. With motion, `fog.js` paints it on a 2D
canvas (`static/lost/fog.js`, no WebGPU), and a pointer or tap clears a little of it. It follows the system's dark setting and the Night key.
It has no Markdown twin.

## Sources and refresh

The city uses USGS 3DEP lidar, DataSF buildings, Mapterhorn terrain, OpenStreetMap contributors and Overture Maps
Foundation landmark outlines. Colours, light and the camera were fitted to Frank Schulenburg's CC BY-SA 4.0 photograph,
which the page credits and links. The export holds only the unpainted city: no photographic atlas, reference picture
or overlay.

`prepare.mjs` writes `static/landing/` from two pinned commits of the engine's history (the Ina place and the sky),
reading the display shaders and sky code from them with `git show`, plus the private Ina build cache. Those commits
are not in this repository's history, so a refresh needs a clone that still has them. It also needs `cwebp`.

```sh
node scripts/landing/prepare.mjs "$VILLAGE_REPO" "$INA_CACHE"
git diff --exit-code -- static/landing
```

The cache must hold `home/.village/engine/place/ina/index.json`, its binary blocks and the model capture under
`shots/`. The script checks the capture's digest, the block lengths and the face count before it writes.

## Checks

The unit tests (`test/landing-*.test.mjs`, in `npm test`) cover the shader patches, the identity at mood 0, the
gulls' clearance over the roofs, the postcard layout and the video palettes.

The browser checks open Chrome with WebGPU. Each serves `dist/` on a loopback port (`check-eggs.mjs` and
`check-lost.mjs` use `BASE` instead when it is set) and writes screenshots under `.shots/<name>` (or `OUT`). Set `PLAYWRIGHT` when Playwright does not resolve from the site.

```sh
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-eggs.mjs       # graphics controls, Pause, Support, still, plain page
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-postcard.mjs   # night, day, touch and keyboard postcards
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-life.mjs       # gull draws and window rebakes per frame
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-matrix.mjs     # the Matrix passes, Pause, Esc, phone
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/landing/check-video.mjs      # both videos, Pause, Mute, Stop, fallbacks
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-lost.mjs               # the 404 page
```

**These five landing checks expect the landing at the root of `dist/`.** Today's `npm run build` mounts the site at
`/blog/` and puts the front page there instead, so they need a build with `base: "/"`. `check-lost.mjs` works on
today's build.
