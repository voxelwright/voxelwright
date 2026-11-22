---
name: game-hud
description: Rules for the controls laid over a game's picture while someone plays (tool and weapon choice, prompts, auto-hiding, touch sticks and thumb keys, keeping the character clear), drawn from shipped games and platform guidelines, with the source for each. Use when placing, hiding or changing anything over Village's realm picture (engine/page/realm-ui.ts, play-hud.ts, explore.ts, input.ts) on a desk or a phone.
---

# Game HUD

Version 1, read 2026-11-21 for #450. Scope: the controls over a third-person realm in a browser, on a desk
(keyboard and mouse, pointer lock) and on a phone (touch, upright). It does not cover menus, the first view or
the kit's own look (`engine/kit/SPEC.md`, `DESIGN.md`).

Each rule says where it comes from. **Fetched** means the page was opened and the fact is from its text.
**Snippet** means it came from a search summary or a secondary outlet. **Unverified** means nobody opened a
source for it. Don't treat an unverified claim as a rule. Measure it in the realm.

## Rules

### The body comes first

1. **Nothing is laid over the character's box, in any state.** That covers standing, falling with arms out,
   under the canopy and choosing a tool. The box is `engine.playHud.body()`, a projection of the figure's
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
   Village: the numbers, the arrows and Enter, a click or a tap on a slot, and Escape to leave unchanged.
6. **Hold to open, and offer a tap that latches.** Holding and releasing is how console wheels work (RDR2:
   hold to open, snippet). GAG asks to "avoid / provide alternatives to requiring buttons to be held down"
   (fetched, [GAG full list](https://gameaccessibilityguidelines.com/full-list/)). In Village a tap of E or of
   the tool key leaves the wheel open, and a hold of over 280 ms picks on release.
7. **Time slowing while a wheel is open is reported, not confirmed.** For GTA V the evidence is a mod page that
   removes the slowdown. Ratchet & Clank comes from snippets, and Tears of the Kingdom is unverified (see
   [sources.md](sources.md)). Village stops the body (a solid input mode) but not the world.

### Prompts and auto-hiding

8. **Show a control only while it can do something.** Apple: "hide controls when an action isn't available or
   relevant" (fetched). In Village the parachute cue shows while falling, the fly cue while standing and never
   flown, and the walk cue just after taking off. A cue goes once it has been used a few times.
9. **A cue stands beside the thing it is about.** XAG 101 shows Fenyx's "Y Collect" over the character, outlined
   (fetched,
   [XAG 101](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101)). No
   source compares this with a fixed corner. Village puts cues beside the body's box, on the side with more
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
13. **No source gives fade timings.** Village's quiet mode hides while the picture holds the pointer and three
    seconds after the last touch. These are numbers to tune by playing, not rules.

### Touch

14. **The stick is not drawn until a thumb is down, and comes where the thumb lands.** Apple: "consider hiding
    movement controls until a player touches the screen" and "show a virtual thumbstick wherever the player
    lands their thumb… use direct touch to pan the camera" (fetched). Call of Duty Mobile floats its stick by
    default, and locking it in place is a setting (confirmed, Activision blog). In Village the well is not drawn
    while it meets the body. A thumb on the body steers unseen: the thumb is the mark, and the body stays in view.
15. **Frequent keys near the right thumb, outside the move and look circles. Secondary keys at the top.**
    Apple: "Place frequently used buttons near a player's thumb, avoiding the circular regions where players
    expect movement and camera input to happen. Place secondary controls, like menus, at the top" (fetched).
16. **Sizes.** Apple: 44 x 44 pt for frequent controls and 28 x 28 pt at the least (fetched). Android: 48 x 48 dp,
    8 dp apart ([Android accessibility](https://support.google.com/accessibility/android/answer/7101858),
    fetched). XAG 107: 15 mm on a phone (fetched). Village's thumb keys are 52 px tall or more, and Use is
    72 to 84.
17. **Press feedback that shows past the thumb.** Apple: "a visual press state effect, such as a glow, that they
    can see even when their finger is covering the control" (fetched). The kit's keys travel and their light
    changes on pointer down.
18. **Keep off the Home indicator and the Dynamic Island.** Apple, game-controls (fetched). Use `viewport-fit=cover`
    and `env(safe-area-inset-*)`. Headless Chrome gives `env()` as 0. `sf-hud.mjs` sets real insets with CDP
    `Emulation.setSafeAreaInsetsOverride` (works in Chrome 158).
19. **Let players move the keys, later.** COD Mobile's Custom Layout is "a mock HUD where you can drag, drop, and
    change the size and opacity of everything on-screen" ([Activision blog,
    2019](https://blog.activision.com/call-of-duty/2019-10/Getting-a-Grip-on-the-Call-of-Duty-Mobile-Controls),
    fetched). Fortnite's HUD Layout Tool is snippet. Not built in Village yet.
20. **Floating or fixed stick is contested.** Fireproof says "no floating d-pads". Others point to the lack of
    feel on any screen stick (snippet, pocketgamer.biz). Apple recommends floating. Village floats, so try it on
    a real phone.
21. **Most phones are held in one hand.** Hoober observed 780 people: 49% one-handed, 36% cradled, 15% two-handed
    ([UXmatters 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php),
    fetched). That was browsing, not play, so don't stretch it.

### Access

22. **Everything by keyboard alone, and remappable.** XAG 107 and GAG (fetched). The wheel takes focus order,
    `aria-keyshortcuts` and an `aria-label` on its dialog.
23. **Less motion: the controls still come and go, without travel.** Apple: replace movement with fades under
    Reduce Motion (fetched). Village honours `prefers-reduced-motion` by dropping translations.
24. **Text over the picture.** XAG 101: at least 18 px at 1080p on PC (fetched). XAG 102: 4.5:1 contrast for
    standard text (fetched). Cues sit on a kit card, not on the bare picture.

## Found in Village (measured, November 21)

These come from `engine/test/sf-hud.mjs` and its pictures in `~/.village/engine/sf/hud` (the `boxes/` copies have the
boxes drawn on).

- **Measure a kit key by its solid, not its canvas.** The kit's canvas is the key's box plus 6 voxels of mostly
  empty pad all round. The solid stands up and to the left of the face by half its height (`--vx-face-z` × 0.5
  voxel). Counting the canvas flagged empty corners; counting the button alone missed the solid.
- **Measure the body in parts, turned as it faces.** A box square to the world was 1.7 times the figure standing
  and 3 times it in a fall. Under a canopy one box round the dome and the figure covers the empty space beside
  the lines, so the check uses three parts: figure, lines and dome.
- **Upright phone, third person: the body is where the left thumb rests.** Standing, it covers about x 64 to 171
  and y 450 to 750 of 390 x 844, and in a fall up to x 240. The only clear place for a stick in the left half is
  above the body (y ≈ 390). The floating stick is therefore not drawn when the thumb lands on the body. Moving
  the camera (person.ts) is the real fix and belongs to that lane.
- **Upright phone: no ring of seven keys fits.** Above the body it runs into the top keys, and beside it there is
  less than 200 px. The touch form of the wheel is a column dropped from the tool's key, picked by sliding down.
- **The thumb's keys go in one column at the right edge.** A fall's arms-out box reaches 240 px from the left, so
  an arc round Use met it.
- **`env()` needs one CDP session.** `Emulation.setSafeAreaInsetsOverride` set on one session was 0 on the page
  once a second session was opened.
- **A plate under the desk wheel read as a dialog over the city.** A tight ring (radius 135 px) reads as one thing.
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

- the owner picks a direction (record which, and why);
- a real iPhone run contradicts a touch rule;
- the kit changes how keys are drawn past their box (the check's measurement depends on it).
