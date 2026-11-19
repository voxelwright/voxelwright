# Ina Coolbrith Park

The ordinary site build copies the files in `static/landing/`. It needs neither a Village checkout nor a running Village server. The live view imports the PR 443 device owner at `/vendor/village/blocks/renderer.js`, supplied by the Signal Desk distribution. Its sign and tow banner use the kit’s own Vox Text lettering.

## Source

| Asset | Village source |
| --- | --- |
| City, landmarks and camera | `24b416e0742d4cf834ee59393bb1783adf0f0066` on `feature/423-ina`, particularly `engine/landing/ina/README.md`, `camera.json`, `matte.py`, `heroes.mjs` and `cull.mjs`. The cached `place/ina` output has 707,795 actual faces. |
| Skyline poster | The unpainted model’s own `shots/r12-full.png`, made with `node landing/ina/shoot.mjs --place ina --name r12` from that engine checkout and its cache. The camera is at 86.98 m elevation, bearing 120.205°, with a vertical field of view of 25.049°. |
| Light and materials | Display paths of `engine/page/matte.ts`, `march.ts`, and `glow.ts` at that same commit. The adapter uses a single depth pass with an 8 m near plane, a cached city texture and procedural night windows. |
| Plane, clock and graphics settings | `bdd9e9675a50a21d3e7543eeefa129c17ca2a19b` on `feature/424-sky`, particularly `engine/landing/plane.ts`, `sky.ts` and `player/graphics.ts`. The graphics selector changes render resolution. |
| Navigation and egg | The half-second departure follows `feature/421-landing`’s sign push. Keyboard activation follows the native link immediately. The Konami sequence from the site’s #426 notes changes the plane’s banner. |
| Shared device and sign type | Village PR 443, `dda49b0f8f6353e1ed3bee76b15600f4e8cf4b31`. See the demo lane’s refresh script. |

The city uses USGS 3DEP lidar, DataSF buildings, Mapterhorn terrain, OpenStreetMap contributors and Overture Maps Foundation landmark outlines. Building colours, illumination and camera fitting reference Frank Schulenburg’s CC BY-SA 4.0 photograph. The page credits the image and links to its source and licence. The export uses the unpainted city pack exclusively. It contains no photographic atlas, reference picture, overlay or diagnostic render.

## Refresh

Run from the site checkout with its locked dependencies installed. The prep also uses Git and `cwebp` (libwebp). Supply a Village clone with both pinned commit objects, plus the private Ina build cache described in Village’s Ina README.

```sh
node scripts/landing/prepare.mjs "$VILLAGE_REPO" "$INA_CACHE"
git diff --exit-code -- static/landing
```

The cache must contain `home/.village/engine/place/ina/index.json`, its named binary blocks, and the original model capture under `shots/`. Prep verifies the capture’s digest, checks block lengths and face counts, groups matching byte positions for gzip, and emits the display shaders and sky code from the pinned Git objects. The scripts, build cache and screenshot evidence live outside the published static directory.
