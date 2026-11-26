# The player

The engine with no server behind it: one scene, drawn and poked, from plain static files that any host can serve.
No making, no talk, no realm and no shared world. It is meant for a page on someone's site, in an iframe.

```
player/index.html?scene=…   →  player.ts (the eye and the throw)  →  stage.ts (core, march, mover, pieces)
landing/index.html          →  landing/landing.ts (the signs)      ↗
```

`stage.ts` is the shared part: the core, the sector makers, the march, the mover, pieces, crumbs and smoke, and the
frame that draws them. Whoever stands on it says where the eye is each frame (`view`), may add to a frame (`each`,
`passes`) and hears what breaks (`broke`). The player and the landing world (below) both stand on it.

## Run it

From `engine/`:

```sh
npm run player            # the core, then dist/: the player's page, its modules as .js, the core, the scenes
node player/serve.mjs     # a host of plain files on http://127.0.0.1:5760/player/index.html (host.html: two in a page)
node player/sample.mjs    # writes the sample scene again (player/scenes/sample.json), after npm run core
node test/player.mjs      # measures it in Chrome and WebKit; pictures in ~/.village/engine/player
```

- **The build** (`build.mjs`) strips the types from every module the pages reach, once, with Node's own stripper,
  and writes each `.ts` address as `.js`. Nothing is bundled or minified. `dist/` keeps the engine's layout
  (`player/`, `page/`, `probe/`, `landing/`, `blocks/`, `kit/`), so it can sit under any folder of a site. It also
  carries the kit's renderer, modules, stylesheet and the fonts the stylesheet names.
- **The host** (`serve.mjs`) serves plain files as a static host would: the usual types, an ETag, ten minutes'
  keeping, and none of the page server's headers (no COOP, COEP or CSP). Unless asked to serve plainly, it also sends
  a file's `.br` copy to a browser that takes Brotli and keeps `releases/` a year, as the realm's host does. Tests
  import its `plain()`.

## A scene

A scene (`scene.ts`, read by `sceneOf`) is JSON and data only: nothing in it runs or names another address.

| Field | What it holds |
| --- | --- |
| `village`, `version` | `"scene"` and `1`. |
| `name` | Up to 80 characters, told to the holder. |
| `centre` | What the eye turns about: cells of 10 cm, x east, y up, z south. |
| `eye` | `far`, `yaw`, `pitch`, and optional `nearest` and `farthest`. |
| `edits` | The core's own words for each edit (balls and rows of cells only) and the box it can change. At most 4M words. |

The world under it is the one the core makes from its rules wherever it runs. A scene holds no data from anywhere
else.

## In a page

Put it in an iframe on `player/index.html?scene=<address>`. Query parameters size the world it holds: `?grid=8,8,8`,
`?levels=6`, `?pool=64`, `?workers=4`, and `?scale=0.75` fixes the pixels drawn per pixel shown.

It tells its holder by `postMessage`, `{ village: 'player', type, ... }`:

| `type` | When |
| --- | --- |
| `unsupported` `{ reason }` | No WebGPU: said within a second, and nothing more is downloaded. |
| `loading` `{}` | WebGPU is here and the engine is being fetched: said within that same second. |
| `ready` `{ ms, firstFrame, scene }` | The scene is seen. |
| `error` `{ message }` | Something failed after WebGPU was found. |

A frame that has said nothing after a second never loaded. `player/host.html` is a page that holds two.

**Don't hide the frame while it loads** (`visibility: hidden`, `display: none`): a browser draws no frames there, so
`ready` never comes. Lay the flat picture over it instead. The player needs no cross-origin isolation and runs in a
frame of another origin.

Drag turns the eye, the wheel or a pinch brings it nearer (in a frame, the wheel with Ctrl, so the holder can scroll),
a tap throws a ball of wood, and a hold throws it harder, hard enough to break glass and brick.

## The landing world

A street corner of the engine's generated town with a menu standing on its roofs as billboards, built beside the
player by the same `build.mjs` and served by the same host. Its files are in `landing/`. It asks no server anything
and calls no model.

```sh
npm run landing            # builds dist/ and serves it: http://127.0.0.1:5950/landing/site/index.html
node landing/block.mjs     # writes the scene again (landing/scenes/corner.json, places.json), after npm run core
node test/landing.mjs      # checks and measures it in Chrome and WebKit; --clip films a run
node landing/shots.mjs     # pictures of the page and the street (--size 390x844, --do home|sign|face|page)
```

- `landing/site/`: a stand-in home page with the switch between Plain page and Street (`home.js`). Every sign is one
  of the page's links. Which view shows: the visitor's kept choice, then `?view=2d` or `3d`, then reduced motion,
  then no WebGPU adapter, then the street's own first frames.
- `landing/index.html`, `landing.ts`: the street, in a frame. The messages it sends (`{ village: 'landing', ... }`)
  and takes (`{ village: 'host', ... }`) are listed at the top of `landing.ts`. It names the chosen sign, never an
  address; the page follows its own link.
- `landing/block.mjs`: the corner, written as cells: billboards on glass feet, a crate table on glass legs, a frame
  on a wall. What is glass gives.
- `landing/face.ts`: a face in relief on a wall that stretches and springs back. `?face=<image>` on the street's
  address draws a picture on it.
- A tap throws a ball, a hold throws it hard, a drag looks round, a tap on a sign flies there and goes in. Left and
  right go from sign to sign, Enter goes in, Escape comes home, F finds the face and R mends at once. Six seconds after
  the last thing stops moving, the corner is put back.

This street is an earlier landing than the site's Ina Coolbrith Park view, which lives in `site/static/landing/`
([the site guide](../../guide/site.md#the-landing)). `landing/ina/` holds that view's model pipeline.
