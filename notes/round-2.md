# Round 2: site-side work

Engine parts are tracked on the private source repository: #421 (landing; comment of Nov 17), #423 (the place), #424 (sky and
time), #425 (graphics settings), #426 (easter eggs). The full brief is in COORDINATOR.md. This file covers the parts
that live in this repo.

## Ports for this round (tailnet port = local port + 5000)

| Ports     | Lane |
|-----------|------|
| 5960-5964 | The place experiment (#423), Village |
| 5965-5969 | Sky, time and graphics settings (#424, #425), Village |
| 5970-5974 | Tsundere support button, this repo |
| 5975      | Blog look preview switcher (`designs/iterations/serve.mjs`), already running |
| 5976-5980 | Writing: editor, AI-session block, store and auth spike, this repo |
| 5981-5984 | Landmark heroes and far-tile fix (#423), Village |
| 5985-5989 | Voxelmorphism + Plant a Seed (~/Developer/plant-a-seed) |

## Lanes in this repo

1. **Tsundere support button.** A floating element in the top right that stands alone and works over both the 2D
   page and the 3D world:
   - Its eyes follow the pointer and it dodges.
   - The first click annoys it.
   - A second click starts the standoff: "are you threatening me?!", a MUDA MUDA barrage at the cursor, a
     bulldozer smash, "good grief", and then it escapes.
   - All art and sound are our own.
   - There is no real contact route (owner, Nov 17: "There is no real contact for support. That's the joke.").
     Keyboard and screen-reader users get the same joke: a real button, its lines announced politely, Esc to
     dismiss. Reduced motion gets a calm version.
   - It comes in two versions: skeuomorphic and unbiased.
   - Built on branch `support-button`: `static/support/`, demo and notes in `designs/support-button/`. Not wired
     into a look yet.
2. **Writing.** Post from the website with a best-in-class custom editor.
   - AI sessions are a first-class block, like code blocks: a better take on `~/.claude/skills/conversation-artifact`.
   - Output is still Markdown plus assets in `posts/<slug>/`, which the generator builds.
   - Choose and test the store: commits to a private repo, or D1/R2.
   - Choose and test the auth: Cloudflare Access, or passkeys.
   - Everything stays local (`cf dev`, local D1/R2) until the owner says yes.
3. **Blog MCP server.** A remote MCP on Workers with OAuth, sharing the editor's write path. It starts after the
   writing lane settles that write path, and gets the seven-lens review with Sentinel first.
4. **Social links.** X, LinkedIn, YouTube, and optionally Twitch. This waits on the owner's handles.
5. **Console greeting** on the 2D page. Shared with #426.

## Decided by the owner (Nov 17)

- Engine lanes run in their own Village threads. Lanes may open PRs and push, to their own branch or to main.
- One tap on a sign flies there and opens the page.
- Billboards are voxels and break into pieces. The B breaks off BLOG to leave LOG, and the LOG page is a site
  changelog.
- The support button has no real contact anywhere: that is the joke. Keep the button itself keyboard- and
  screen-reader-friendly.
- The blog look is iter-1 ("Ink"); site.config.mjs is set. Superseded Nov 19: see below.
- His face photo is the cropped selfie at `~/.village/site/face/owner-face.jpg` (private, mode 600). Use only this
  crop, never the original group photo. Do not send it to outside services without asking him.
- Socials: X `pasha_knz`, LinkedIn `pavlo-zahynailo`, Twitch `p_bender`, no YouTube for now. They can be logos on
  office buildings rather than billboards.
- The menu in a view with few logical billboard spots: one natural surface carries the whole menu, inspired by Midnight
  Club 3's projected menu but not taken literally. No billboard on top of a painted lady.
- Mapillary: he leans to using assets derived from it. I explained the share-alike terms (see the chat), so this is
  pending his final word.

## Still waiting on the owner

- View: DECIDED, Ina Coolbrith Park, matching the Schulenburg photo; a screenshot overlaid on it must line up (lane feature/423-ina).

## Voxelmorphism kit in Village

- Village holds a copy of the kit, taken from plant-a-seed with `engine/landing/site/sync-voxelmorphism.mjs`. It sits on
  branch feature/424-sky.
- Since plant-a-seed `0ac4a76`, `adopt()` alone asks for the engine's WebGPU renderer. Before the first `adopt()`,
  call `use(<the world's renderer>)` or `use(null)`; otherwise a page asks for a second WebGPU device.
  `controls.js:50` (`?vx=live`) needs this. The sky lane was told on Nov 17.
- The kit has its own thread, "Voxelmorphism: the UI kit" (plant-a-seed branch `kit`). It coordinates with #423 on UI
  on building surfaces, and it tells the engine lane before it changes the renderer.
- The landing menu lane is not started yet. It starts once the Ina camera is solved and #424 has landed. It builds the
  interaction against an interface with a placeholder skin, and adopts the kit's winning system once the owner picks
  one. The kit thread has been told what the lane needs (Nov 17).
- The owner calls the blue and yellow billboard street the "old prototype": design nothing there and show nothing
  there. Judge everything against the Ina Coolbrith view.
- The owner is choosing among five candidate design systems in the kit thread: cube-grid buttons, cards and bars that
  depress or shatter, menus and cursors inside the engine in the world's own light, and parts that glow at night.
- Nov 17: the kit moves into Village at `engine/kit` (Village #434, branch feature/434-kit, done by the kit thread
  with its history). It follows #430 / PR 431, the page stage, which owns the kit's block pass and also takes the
  shading changes (chamfer, light, gloss). PR 429's sync script and vendored copy are deleted when the kit lands.
  plant-a-seed's garden then copies the kit from a tagged Village commit.
- The lead's conditions for the kit move are on #434:
  - import from plant-a-seed main (5bf93a7 or later), never from the `font` branch; Vox Zakon stays in plant-a-seed
    until its licence is settled;
  - the glyph sets and type tools move with the kit;
  - `engine/kit` ignores milestones/, shots/ and the skills folders before the first push;
  - the garden's copy includes `showcase/showcase.css`.
  The font thread has been told.

## Nov 19: the whole site is built from Voxelmorphism

The owner asked for every page to be built with the kit, nothing implemented twice. Done on site
branch `vx/site-on-kit` (fast-forwarded into main):

- One layout for every page (generator/pages.mjs): the kit's ground, navbar, list groups, prose,
  code window, figures, callouts, lettering and keys, fitted as the Signal Desk's walnut
  instrument from the HTML, with a night. Ink (iter-1), the other looks, designs/*, world-shell.css
  and the fresh/blend demo scripts are retired. The landing's plain page is on the kit too; the
  city keeps its painted signs but shares the site's faces and its choices (night, plain, sound).
- The vendored kit is pinned to Village `feature/442-site-dogfood`, PR 448, stacked on PR 443 and
  not merged. Merging 443 then 448 and re-pinning to main is the owner's step.
- What building the site found in the kit, and what is still open: notes/voxelmorphism-dogfood.md.
- The writing branches (writing-1, writing-2) predate the kit: their editor and pages use the
  retired looks and need moving onto the kit's parts before they land.
- Dev server for this lane: port 5986, tailnet 10986 (`tailscale serve --https=10986 off`).
