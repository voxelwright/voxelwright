---
name: game-hud
description: Rules for the controls laid over a game's picture while someone plays (tool and weapon choice, prompts, auto-hiding, touch sticks and thumb keys, keeping the character clear), drawn from shipped games and platform guidelines, with the source for each. Use when placing, hiding or changing anything over Voxelwright's realm picture (engine/page/realm-ui.ts, play-hud.ts, explore.ts, input.ts) on a desk or a phone.
---

# Game HUD

Version 7, 2026-11-27 (#140: touch driving schemes; version 6, 2026-11-26, #75: the Make bar dismissible, no Back or Seat key over play, Settings in sections, the first view slim; version 5 the slim Voxelmorphism v1 in-play HUD; version 3 2026-11-24 the pie wheel; version 2 2026-11-22 for #450, version 1 read 2026-11-21). Scope: the controls over a third-person realm in a
browser, on a desk (keyboard and mouse, pointer lock) and on a phone (touch, upright and on its side). It does not
cover menus (the Sky panel open is one: what it covers is measured and said, not failed), the first view or the
kit's own look (`engine/kit/SPEC.md`, `DESIGN.md`).

**Direction (owner, November 26):** the in-play HUD stays voxelmorphic — built from real lit WebGPU voxels rather
than flat CSS glass — by refining the kit itself into a compact, low-profile hardware tier (`slim` look,
`engine/kit/src/looks/slim.js`): `--vx: 2px` on HUD keys and `--vx: 3px` on the Settings enclosure, 3-course floating
keycaps with 1.5-voxel press travel, translucent smoked polycarbonate (`transmission: 0.14–0.15`) with Fresnel rim
gleam, deep cobalt enamel (`transmission: 0.06`) on primary/active actions, and a hollow stepped octagonal voxel
thumbstick gimbal with backlit compass ticks and a sculpted concave voxel cap. Layout stays lean and contextual: Credits
moves out of HUD corners (both first view and play) into the Settings panel's keys, and Mapillary attribution moves out of the HUD and minimap into the Credits card; the Make composer collapses to a slim voxel trigger
(`✦ Make ↵` bottom-right on desktop, `✦` 44×44 voxel key bottom-left on mobile that fades out while steering) and
expands into a centered composer only when opened; mobile puts the minimap top-left, the Settings (`⚙`) slim voxel key alone top-right, the hollow voxel thumbstick under the left thumb, compact
icon-led slim voxel thumb controls bottom-right, and suppresses the redundant floating `Fly` banner.

**Cross-lane slots (November 26):**
- **On-foot bottom-left utility slot (`[data-panel="summon"] .vx-button` / `.foot-summon`):** `44×44` slim voxel key
  sitting at `left: safe + 66px, bottom: safe + 14px` beside `✦` Make (`SLIM_ICONS.car`), auto-hiding while steering,
  riding, choosing a tool, or with a drawer/composer open.
- **Touch driving schemes (#140, `engine/page/drive-touch.ts`, `.dt-cluster` in `[data-panel="living"]`):** one way to
  steer and one way to drive, never two at once (#75's stick steered and, with no pedal held, drove too). The left half of
  the picture turns the head while driving (`input.stickSide = null`), except with Slide, where it is a slide that steers
  across only. Settings → `Controls…` (touch only) opens the sheet (`#drive-controls`): Steer with Arrows (default) /
  Wheel / Slide / Tilt, Gas Pedals (default) / Auto, Pedals on the Right (default) / Left, Key size, Key opacity, Steering
  sensitivity, Center tilt. `layout()` places every key from the bottom corners: the main pedal tall at the edge
  (`80×108` at Medium on its side), Boost above it, Brake and Drift beside it; arrows `84×84`; the wheel a `150` px
  hollow voxel ring (`.vx-recess[data-vx-ring]`) with a stick cap on its rim. Keys shrink to fit: the clusters stay
  `>= 24px` apart, the driving cluster stays in the lower half, no key goes under 44 px (`test/drive-touch.mjs` checks
  every scheme, hand and size on four phone screens). A cluster is one pad: a thumb sliding from key to key holds the
  key it is on. Everything is let go on touch end or cancel, blur, the page hidden, or anything opened over the keys.
- **Top-right utility rail (`.drive-util`):** quiet `44×44` icon-only keys (`Horn`, `Radio`, `Cam`, `Get off`, no `Seat`
  key since Cam cycles through seat, #74) beside Settings (`⚙`) on its side, below `drive-hud` and `⚙` upright. `Repair`
  stays hidden while undamaged (Rule 8) and appears below them only when the car takes damage.
- **YouTube mini-player (`[data-panel="radio-yt"]`) by touch:** the bottom corners are the thumbs', so it stands at the
  top left (over the minimap on its side, below it upright). `sf-hud.mjs` counts it among the controls that must not meet.

**Direction (owner, November 26, #75):** the Make bar opened must always have a way out by touch: a × key before the
line, a press anywhere on the picture (its click is swallowed, so it does nothing else), or Escape; each gives the keys
back to the world and brings the keys of play straight back. No Back (`<`) key over play: Back to the view lives in the
Settings panel (and Backquote). The first view uses the same slim look as play (credits and lockers keys, the gear, the
panel, the EXPLORE hint as a smoked plate with the cobalt edge). The Settings panel is in sections that are always all
shown (tests press its controls by place): Time & weather, Graphics (with the resolution), and the keys that act; two
columns at a desk in play, one on an upright phone, columns on a phone on its side. `sf-hud.mjs` fails a section
missing, two panel controls meeting, a Back key in the HUD, a Seat key while driving, a Make bar that does not close, and a
first-view key not built slim. It switches street life off: a stopped car beside the body offers E over it.

**Direction (owner, November 22):** the wheel, as the lead recommended. It is what the page has with no switch;
`?hud=classic` keeps the controls as they were, and `?hud=context` and `?hud=quiet` stay to compare. The wand is a
tool: it is the wheel's last choice, and has no key of its own with the wheel.

**Direction (owner, November 24):** the wheel is a pie over the middle of the picture, as a game's buy wheel is
(`engine/page/radial.ts`): a dark disc of wedges, each with a white picture and a name, a ring round the middle, an
accent arc on the rim over the wedge pointed at. A tap of E (or a click on the held key, or by touch a tap on the tool
key) leaves it open until a wedge is clicked; held, letting go picks the wedge pointed at, and a click while held
picks too. It is the same pie on a phone. While it is open it is over the body: rules 1 and 2 hold for everything
else, and `sf-hud` reports the wheel as a menu.

Each rule says where it comes from. **Fetched** means the page was opened and the fact is from its text.
**Snippet** means it came from a search summary or a secondary outlet. **Unverified** means nobody opened a
source for it. Don't treat an unverified claim as a rule. Measure it in the realm.

## Rules

### The body comes first

1. **Nothing is laid over the character's box, in any state.** That covers standing, falling with arms out,
   under the canopy (choosing a tool is the exception, by the owner's direction of November 24). The box is `engine.playHud.body()`, a projection of the figure's
   corners. `engine/test/sf-hud.mjs` fails if any seen element meets it, kit canvases included. Kit canvases
   draw a key's solid up and to the left of its DOM box, so measure the canvas, not the button.
   *Source:* Apple HIG, Game controls: "reduce the amount of virtual controls that overlap your game content"
   (fetched,
   [game-controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)). No source gives
   a clear fraction of the screen centre, so the box is measured, not guessed.
2. **Corners and edges hold the controls. The middle is the world's.** In the realm's third-person view the
   body touches the bottom edge in the middle at 1280 x 720, and sits left of centre on an upright phone. The
   bottom centre is never free. *Source:* tvOS layout insets content 60 pt top and bottom and 80 pt at the
   sides (fetched, Apple HIG layout JSON). The 90% title-safe and 93% action-safe figures are unverified.

### Choosing a tool

3. **Seven tools fit a wheel.** A radial menu holds about 3 to 12 items. Callahan et al. (1988) found pie
   menus 15% faster with fewer errors than linear menus, because each slice is big and near the pointer and
   direction is remembered by the hand (fetched, Wikipedia
   [Pie menu](https://en.wikipedia.org/wiki/Pie_menu), secondary to the paper). GTA V picks weapons from one
   (same page).
4. **Number keys stay.** A hotbar of slots picked by number or by touch is the PC norm (fetched,
   [Minecraft wiki, Hotbar](https://minecraft.wiki/w/Hotbar): "tapping on a hotbar slot with touch controls
   selects the item"). Apple: "Prioritize single-key commands" and use "the number keys for inventory
   categories" (fetched, game-controls).
5. **A wheel needs a route without aiming.** XAG 107 asks for any directional input to be available "through
   other means… (such as from a menu)" (fetched,
   [XAG 107](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107)). In
   Voxelwright: the numbers, the arrows and Enter, a click or a tap on a slot, and Escape to leave unchanged.
6. **Hold to open, and offer a tap that latches.** Holding and releasing is how console wheels work (RDR2:
   hold to open, snippet). GAG asks to "avoid / provide alternatives to requiring buttons to be held down"
   (fetched, [GAG full list](https://gameaccessibilityguidelines.com/full-list/)). In Voxelwright a tap of E or of
   the tool key leaves the wheel open, and on release a hold picks the wedge pointed at (pointed at nothing, a
   hold of over 280 ms puts it away as it was).
7. **Time slowing while a wheel is open is reported, not confirmed.** For GTA V the evidence is a mod page that
   removes the slowdown. Ratchet & Clank comes from snippets, and Tears of the Kingdom is unverified (see
   [sources.md](sources.md)). Voxelwright stops the body (a solid input mode) but not the world.

### Prompts and auto-hiding

8. **Show a control only while it can do something.** Apple: "hide controls when an action isn't available or
   relevant" (fetched). In Voxelwright the parachute cue shows while falling, the fly cue while standing and never
   flown, and the walk cue just after taking off. A cue goes once it has been used a few times. Riding (#11) is the
   plainest case: the keys of one on foot, the tool's key, the tools and the cues step aside (`html.riding`, set by
   `living.ts`), and by touch the thing's own keys (Down, Up, what it does once, Seat, Get off) stand where the
   thumb's keys stood, a kit key each. By touch the card of keyboard keys is not shown. While riding, the thing
   ridden is the body that nothing may cover (`parts()`), and `sf-hud.mjs` measures it riding a car and a
   hovering thing (`--ride-only` runs just that).
9. **A cue stands beside the thing it is about.** XAG 101 shows Fenyx's "Y Collect" over the character, outlined
   (fetched,
   [XAG 101](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101)). No
   source compares this with a fixed corner. Voxelwright puts cues beside the body's box, on the side with more
   room.
10. **Fold variants of one action into one key.** Apple: "Combine functionality into a single control… walking
    or sprinting… a single control" (fetched). The thumb's rising key is Jump on the ground, Chute in the air
    and Up when flying.
11. **Prefer a world signal to a HUD element where one exists.** Ghost of Tsushima has no waypoint marker or
    minimap on screen: "how can we keep people immersed in this world instead of just more compasses and
    mini-maps on the screen" (confirmed, the creative director interviewed by
    [Android Central](https://www.androidcentral.com/ghost-tsushima-creative-director-interview)).
12. **A minimal mode is a setting, not a loss.** Breath of the Wild and Tears of the Kingdom ship a Pro HUD that
    can be switched any time (snippet, Kotaku). RDR2 lets each HUD piece be switched (snippet). GAG: "Provide an
    option to turn off / hide all non interactive elements" (fetched).
13. **No source gives fade timings.** Voxelwright's quiet mode hides while the picture holds the pointer and three
    seconds after the last touch. These are numbers to tune by playing, not rules.

### Touch

14. **The stick is not drawn until a thumb is down, and comes where the thumb lands.** Apple: "consider hiding
    movement controls until a player touches the screen" and "show a virtual thumbstick wherever the player
    lands their thumb… use direct touch to pan the camera" (fetched). Call of Duty Mobile floats its stick by
    default, and locking it in place is a setting (confirmed, Activision blog). In Voxelwright the well is not drawn
    while it meets the body. A thumb on the body steers unseen: the thumb is the mark, and the body stays in view.
15. **Frequent keys near the right thumb, outside the move and look circles. Secondary keys at the top.**
    Apple: "Place frequently used buttons near a player's thumb, avoiding the circular regions where players
    expect movement and camera input to happen. Place secondary controls, like menus, at the top" (fetched).
16. **Sizes.** Apple: 44 x 44 pt for frequent controls and 28 x 28 pt at the least (fetched). Android: 48 x 48 dp,
    8 dp apart ([Android accessibility](https://support.google.com/accessibility/android/answer/7101858),
    fetched). XAG 107: 15 mm on a phone (fetched). Voxelwright's thumb keys are 44 px to hit (64 by 44), Use 60,
    and `sf-hud.mjs` fails a key under 44 or larger than it needs (Use 64, the others 48 tall).
17. **Press feedback that shows past the thumb.** Apple: "a visual press state effect, such as a glow, that they
    can see even when their finger is covering the control" (fetched). The kit's keys travel and their light
    changes on pointer down.
18. **Keep off the Home indicator and the Dynamic Island.** Apple, game-controls (fetched). Use `viewport-fit=cover`
    and `env(safe-area-inset-*)`. Headless Chrome gives `env()` as 0. `sf-hud.mjs` sets real insets with CDP
    `Emulation.setSafeAreaInsetsOverride` (works in Chrome 158).
19. **Let players move the keys, later.** COD Mobile's Custom Layout is "a mock HUD where you can drag, drop, and
    change the size and opacity of everything on-screen" ([Activision blog,
    2019](https://blog.activision.com/call-of-duty/2019-10/Getting-a-Grip-on-the-Call-of-Duty-Mobile-Controls),
    fetched). Fortnite's HUD Layout Tool is snippet. Not built in Voxelwright yet.
20. **Floating or fixed stick is contested.** Fireproof says "no floating d-pads". Others point to the lack of
    feel on any screen stick (snippet, pocketgamer.biz). Apple recommends floating. Voxelwright floats, so try it on
    a real phone.
21. **Most phones are held in one hand.** Hoober observed 780 people: 49% one-handed, 36% cradled, 15% two-handed
    ([UXmatters 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php),
    fetched). That was browsing, not play, so don't stretch it.

### Access

22. **Everything by keyboard alone, and remappable.** XAG 107 and GAG (fetched). The wheel takes focus order,
    `aria-keyshortcuts` and an `aria-label` on its dialog.
23. **Less motion: the controls still come and go, without travel.** Apple: replace movement with fades under
    Reduce Motion (fetched). Voxelwright honours `prefers-reduced-motion` by dropping translations.
24. **Text over the picture.** XAG 101: at least 18 px at 1080p on PC (fetched). XAG 102: 4.5:1 contrast for
    standard text (fetched). Cues sit on a kit card, not on the bare picture.

## Found in Voxelwright (measured, November 21)

These come from `engine/test/sf-hud.mjs` and its pictures in `~/.village/engine/sf/hud` (the `boxes/` copies have the
boxes drawn on).

- **Measure a kit key by its solid, not its canvas.** The kit's canvas is the key's box plus 6 voxels of mostly
  empty pad all round. The solid stands up and to the left of the face by half its height (`--vx-face-z` × 0.5
  voxel). Counting the canvas flagged empty corners; counting the button alone missed the solid.
- **Measure the body in parts, turned as it faces.** A box square to the world was 1.7 times the figure standing
  and 3 times it in a fall. Under a canopy one box round the dome and the figure covers the empty space beside
  the lines, so the check uses three parts: figure, lines and dome.
- **Upright phone, third person: from behind the shoulder the body was where the left thumb rests.** Standing, it
  covered about x 64 to 171 and y 450 to 750 of 390 x 844, and the only clear place for a stick was above it
  (y ≈ 390). By touch the eye now stands further back and higher, over the body's middle (person.ts `BEHIND`:
  4.8 m back, 1 m up, 0.1 m left): standing, x 174 to 237 and y 478 to 680, between the thumbs, and the stick has
  room low on the left. On its side (844 x 390) the body is in the middle, x 407 to 452.
- **(Before November 24) Upright phone: no ring of seven keys fits.** Above the body it runs into the top keys, and beside it there is
  less than 200 px. The touch form of the wheel is a column that hangs from where the tool's key is (the key is not
  shown meanwhile, so the tool is not said twice), its names' left edges in one line, picked by sliding down. The
  thumb's keys step aside while it is open, so eight fit in one column. On its side it is a grid, two columns of four.
- **A tap's click lands where the column has just come.** Opened by a press on the tool's key, the first tool is
  under the finger, and the tap's click went to it and picked it. A tool is picked by a click only where it was pressed.
- **(Before November 24) Eight round a circle tight enough to read as one thing lay on one another.** On a desk the wheel is an ellipse
  1.9 times as wide as it is tall (115 px up and down).
- **The thumb's keys go in one column at the right edge.** A fall's arms-out box reaches 240 px from the left, so
  an arc round Use met it.
- **`env()` needs one CDP session.** `Emulation.setSafeAreaInsetsOverride` set on one session was 0 on the page
  once a second session was opened.
- **(Before November 24, when the wheel was keys beside the body) A plate under the desk wheel read as a dialog over the city.** A tight ring (radius 135 px) reads as one thing.
- **Put the stick away with a margin either way.** Deciding at the edge every frame made it flicker as the body
  bobbed there. Deciding once per touch left it over a body that walked under a still thumb. It is put away when
  the well meets the body and comes back once it is 16 px clear.
- **Measure controls against each other, not only against the body.** A cue placed beside the body landed on the
  phone's Fly key, and the body-and-safe-area measures could not see it.
- **Place with `translate`, and keep it under less motion.** A less-motion rule that reset `translate` would have
  pinned every cue and slot to the corner.

## Patterns by game (what was checked)

A second pass on the game-specific claims is recorded in [sources.md](sources.md) with each verdict.
Read it before quoting a game as precedent.

## Refresh when

- the owner changes the direction (record which, and why);
- a real iPhone run contradicts a touch rule;
- the kit changes how keys are drawn past their box (the check's measurement depends on it).
