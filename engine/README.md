# The engine (#140)

Village's own engine: a world of 10 cm cells, drawn with raw WebGPU by marching rays, with
its core in Rust built as wasm. Synthetic data, this machine or the tailnet only. What it is,
what it costs and what is not built: `.agents/skills/cell-engine/SKILL.md`.

- `core/`: Rust. Cells, sectors as trees, the generated city, blasts, what stands, the bodies that come loose (they fall, turn, strike, break, and are cells again where they lie), and fire.
  One build for the page and (later) a world process.
- `page/`: the city, flown through. `main.ts` (the page), `world.ts` (boxes of sectors round
  the camera), `worker.ts` (makes sectors), `march.ts` (the ray marcher), `sun.ts` (the sun's shadows kept in maps), `edits.ts`,
  `mover.ts` (the worker that moves what has come loose and burns what burns), `told.ts` (what it says), `pieces.ts` (a body on its way), `crumbs.ts`, `puffs.ts` (fire, smoke and dust),
  `flight.ts` (the flight that measures a device), `input.ts` (the one owner of keys, pointer and touch: a stack of modes, each taken off by its own owner alone), `hud.ts` (the one layer of DOM over the picture: the ask bar, cues, a controls card, notices, lanes' panels), `things.ts` (the made things' records, as the world tells of them), `ask.ts` (one ask, and the one function that sends it to the helper), `people.ts` (everyone's figure, drawn in one call), `moves.ts` (what a figure does with its limbs, as data), `wear.ts` (what it wears and carries, as data), `residents.ts` (who is out on the pavements, by rule), `presence.ts` (the others in a shared world, their names and what they say).
- `probe/`: a bare page that reports what a device can draw.
- `serve.mjs`: serves the pages' TypeScript with Node's type stripper and keeps what pages
  report in `~/.village/engine/reports.jsonl`. With `--world file` it also keeps one shared world, home, and any
  number of realms beside it, each a world of its own ("Realms" below).
- `world.mjs`: the shared world's own process, a thread behind the server that runs the core: it does what it is
  asked in order and says what happened. `page/link.ts` is a page's line to it.

## Run it

```sh
rustup target add wasm32-unknown-unknown   # once
cd engine && npm ci
npm run core        # builds core/ as wasm into page/core.wasm (a fresh checkout needs this; a committed core/ built before is copied from ~/.village/engine/core-cache)
npm run serve       # http://127.0.0.1:5740/city to fly; / runs the measuring flight first; /probe is the probe
```

Fly with WASD, the mouse after a click, Space and C for up and down, Shift for fast, the
wheel for speed. A click uses the tool picked on what is ahead; keys 1 to 7 or the bar pick it: a hammer, a charge, a big charge, a cannon, a torch, a cutter (a level cut 9 m across), a brick. F sets what is ahead alight whatever is picked. On a phone the left
thumb moves, the right thumb looks, and the red button uses the tool picked. H shows how many steps each
pixel took, L and M turn shadows and mirrors off (M also what glass lets through), K traces every shadow instead of using the sun's maps.

A shared world: `node serve.mjs --world ~/.village/engine/world/some.log`, then `/city?shared=1` in as many
windows as you like (`&name=Ada` to be called something; Enter opens a line to say something). Everyone there sees
what anyone breaks, builds or burns, and each other as a figure with their name over it; the file keeps what was
done to the world across restarts, not who was there or what was said. Anything that can send a request can act in it too: `curl http://127.0.0.1:5740/world/`
says how: a body of its own that walks, turns, speaks and is told what is around it (the seat an agent lives in the
world by), what a cell is, what a look along a line meets, a blast, a fire, a thrown ball, an edit. Nobody is asked
who they are: whoever can reach the server can change that world, and can use any name, another's included.

## Glass (#163)

Glass is seen through. A look that meets a pane goes on through it and shows what is behind, tinted a little by the
glass's colour and by how much glass it crosses: the street from a room or a car, the room or the cabin from the
street, darker than the day outside (less of the sky reaches in). A pane keeps a little of the mirror: a tenth face
on, most of it along the pane, where it shows what is across from it.

- One pane is looked through. A pane behind it (the far side of a car, the next tower) shows what is likely there: the
  day outside, a little darker than the haze. So does a pane further off than where its cells are two pixels wide, or
  in the coarser copies of the town, where a house is solid; those have a dim room behind them. A pane looked at
  along it mirrors and is not looked through. Towards each of those edges the look through fades into what is likely
  there over a band, so a face of windows has no line across it and does not change at one step as the eye moves.
- What is seen through a pane is lost in the air by its own distance: a hill far off is as hazy through a window as
  beside it.
- A pane of finer cells (`?bricks=1`) that the look past it would take whole (two to four pixels a cell) is left whole,
  so the room behind it shows and not the pane's own cells.
- Polished glass (a spell) is a mirror: it is not looked through, and has a dim room behind it.
- At night a window with someone home (the lit-window rule, `litWindow`) is lit from within: its blind is drawn and
  its light shows, not the room. A window with nobody home shows its dark room. A shop's window is always lit.
- The sun comes through glass in the two finest boxes: a window lights the room behind it and casts no shadow.
  Further off a pane stands for a whole house or tower, and it casts that shadow. Traced shadows (where the sun's maps
  are not drawn yet, and everywhere with K) pass up to 23 cells of glass, as the maps pass all of it.
- Seen through glass that stands free (a shelter, a car's windows) the street is lit as a room is, a little darker
  than beside it. Left so: telling a room from the street there would need a look up from what is behind the pane.
- The march leaves beside its picture how far off the first pane it looks through is and what it lets through
  (`march.panes`). The wand stops at that pane as a pick does: its ring is drawn on a window, and a thing behind glass
  is lit on the glass. People and bodies behind a pane are tinted by it. Crumbs, smoke and water are drawn over it
  untinted; they would each need to read `march.panes` too. Where a pane is not looked through (far off, a lit blind)
  what stands behind it is hidden, as by a wall.
- Bodies and things drawn beside the world (`page/pieces.ts`): their glass is drawn after everything solid, the face
  of each pane towards the eye, tinting what is behind it and adding the sky it mirrors. A body keeps its glass faces
  apart from its solid ones from when it is made. Every pane's tint is drawn before every pane's glint, so a far
  pane's glint is not dimmed by a near one; at a glancing angle it did not show. Mending it would take the panes in
  order from the back, a pane at a time.
- Mirrors off (M, `?mirrors=0`) is no look beyond what is met: glass is a pale face again, the world's and a body's.
  It is a pipeline of its own with none of the glass and mirror text in it (`MIRRORS`), and writes no panes.
- What it costs, paired against the engine before glass (2560 x 1440): with mirrors off -2% to +1.5% at the bench's
  five places; everything on -5% to +3% (before the fade at a pane's edges, which added up to a percent). Against
  glass as first merged, the mends here cost 0 to 5% with everything on (`node test/paired.mjs --other <checkout>`, `--flags 1` for mirrors off). When first merged: out of a tower 10%,
  out of a room's window 24% (3.6 ms), right under a glass tower looking up 29% (9 ms); not measured again.
- `node test/glass.mjs` is the check: a lamp seen through the yard office's glass wall from outside and from inside,
  and through a living box of glass from outside (both its sides) and from inside; with mirrors off, the lamp hidden
  behind both; the wand's ring whole on a window; the ground under a lump of glass in the sun as bright with every
  shadow traced as from the maps. Smoke and dust are not drawn while it measures: the yard chimney's smoke drifting
  across the look made it read 0.53 to 1.00. `?panes=1` (no pane looked through), `?panes=3` and `?through=4`
  (pixels a pane's cell must be) are for measuring.

## The wand (#246)

Q, or the Wand button, takes the wand in hand; its bar stands where the tools were. It aims at what is at the middle
of the picture, three ways (keys 1 to 3 or the bar), each drawn in the world:

- **Point**: a ring lying on whatever is there.
- **Area**: a box on the ground, its foot lit with a mark at each metre. The wheel sizes it (Shift its height alone,
  Alt its depth alone); on a phone, Smaller and Bigger.
- **Thing**: the thing's own cells lit and outlined. Whole, Part (cells of one kind that touch the one pointed at) or
  Side (its faces that look the way the pointed face does): X, the wheel or the bar. One thing is the cells that
  touch, down to where someone would stand; a house is joined to its terrace and is taken a part at a time.

A click (the round button on a phone) casts the spell in hand at what is aimed at; it starts as Fireball. With the
wand in hand, words on the ask bar (Enter) that call a known spell take it in hand and cast it. Known spells are
done at once from the kept library (`page/spells.ts`), with no model:

- **Fireball** (and "great fireball"): seen to fly from the caster, then a blast that lights what burns.
- **A colour** ("make it pink", twenty names): the cells keep their material and take the colour.
- **A material** ("turn it to steel", glass, wood, brick, stone, concrete…): the cells become it. Steel does not burn.
- **Shiny**: a mark on the kind that makes the cells mirror. A look only.
- **Twice as large**, three times, half: the thing's cells are made again from where it stands; what then has
  nothing under it falls.

A change of up to 3,276 rows of cells is one edit, whole or not at all; a bigger one (a house wall) is several, sent
together.
`engine.spell(words, target)` casts from the console; `node test/spells.mjs` checks each.

## Making (#220, #244)

Say what you want and where, and a model makes it in a shared world out of the world's own cells: breakable,
burnable, seen by everyone there.

```sh
node serve.mjs --port 5741 --world ~/.village/engine/world/try.log    # a world of your own; then open /city?shared=1
node make.mjs "a market stall with a striped awning" --world http://127.0.0.1:5741 --me   # in front of you (the page's eye)
node make.mjs "a red telephone box" --world http://127.0.0.1:5741 --at 700,4070           # at a place, in cells
node make.mjs --undo --world http://127.0.0.1:5741                                        # takes the last one out again
node make.mjs "a car" --world http://127.0.0.1:5741 --at 700,4070 --times                 # made before: from what is kept, no model; --times says each stage
node make.mjs "a bus" --world http://127.0.0.1:5741 --at 700,4070 --cells --reply bus.json  # a reply of cells (below) stands in for a model
```

- **The model is your own Claude Code**, run once on your machine on your subscription (`--model opus` by default;
  `sonnet` is about twice as fast and plainer). It is started with no tools, no servers, no settings and no session,
  in an empty temporary folder, and is told only the brief in `make/brief.mjs` and your wish. The binary itself adds
  your account's email and that folder's path to what it sends: `.agents/skills/claude-code-headless/SKILL.md`.
- **The world's server never runs a model.** The maker is a client like a page: it asks the world what is where and
  sends the thing as one ordinary edit (`POST /world/ask`), which the world takes whole or refuses whole.
- **A reply is data.** It is a list of boxes, bars, balls, slopes, stripes and words in named materials and colours
  (`make/form.mjs`). Anything else is refused; nothing in it is run; no kind number is taken from it. It is turned
  into cells here, checked to be joined to the ground, stood in a core of the maker's own to see that nothing of it
  would fall, and only then sent. The world answers once it has laid the cells (`"wait": true` on the ask), with how
  many pieces came loose round it: none, and one look at its cells says it is all there, with no wait; some (its own
  or a neighbour's: the world cannot tell), and it is watched until it settles, as before. A reply that cannot be used is asked for again, told why, up to three times.
- **Where**: on the ground only, facing whoever asked, its feet carried down to a sloping street, near the place
  if the place itself is taken. A thing is at most 64 by 80 by 64 cells and 13,107 runs (one edit: 65,536 numbers, raised from 16,384 on November 13 so that a house wall along z can change in one go).
- What was made is written in `~/.village/engine/made.jsonl` before it is sent and after, so `--undo` can take it
  out, and a send whose answer was lost is looked for in the world, never sent twice.
- `node test/make.mjs` checks all of that with replies kept in the check: **no model is run by it.** Real runs
  (November 12, 2026): twenty wishes to Opus 5.5, nineteen made; times and what failed are in the cell-engine skill.

**From inside the page** (#244). A browser cannot run a model, so a helper on your own machine does:

```sh
node serve.mjs --port 5761 --world ~/.village/engine/making-ui/world.log
node helper.mjs --world http://127.0.0.1:5761     # prints an address: open it once in the browser you play in
```

- **The ask bar** is always at the foot of the page. Enter (or a touch) opens it; type what you want and Enter makes
  it in front of you. A picture can be pasted, dropped anywhere on the page, or picked with the bar's button (on a
  phone: the library, or the camera with the second button); an address among the words, or dropped, is a link. A
  picture or a link needs no words. Tab turns the bar to saying something to the others there, and back.
  In a world with rules, plain words (no verb of making, no article) are said to whoever is there unless they name
  something kept, wherever the eye is ("car", "sword" are made, even where there is no place for them; "open sesame"
  is said), and while such words are typed the bar reads "Say", not "Make" (`page/making.ts` `says`). Tab then makes
  them a thing after all. With the wand in hand, words that call a known spell read "Cast" and are cast. The label is
  worked out again after Tab and when a picture or a link is given or taken away, from the words Enter would send
  (an address among them is a link, and a picture or a link is always made). What the bar
  reads is what Enter does, in a world with rules or without, wand or not: `node test/said.mjs` types each kind of
  words in Chrome, reads the bar, presses Enter and sees what was done.
- **A wish is kept to.** What of a reply cannot be used is left out and the rest made: words round the JSON, a part
  that is not the form's, cells that touch nothing, and whatever the core's rule says would fall (taken off from the
  top down until what is left stands). The model is asked again only when more than fifteen in a hundred would be
  lost, and after the third asking the best of its replies is made. A place that is not ground (a roof, a car, the
  sky) means the ground nearest it; a place that is taken (by cells, or by a living thing's body wherever it is now: its cells are not in the world while it lives, so the world's `/world/tops` answers for it) means the nearest that is not, out to eight metres, and
  the page says how far. When no place near will take it, the thing is **held**, not dropped: the page asks whether
  to clear the space for it (its box is emptied first; what stood on that falls), to put it where you look next,
  or to let it go. A link that cannot be read does not stop a wish that has words or a picture. What is still
  refused: a model that cannot be run, three replies nothing can be made of, more runs than an edit may be, a link
  alone that cannot be read, no ground within six metres.
- **Made before, made at once** (`make/library.mjs`): the helper keeps the reply each thing of words alone was made
  from, in `~/.village/engine/library/` on your own machine. What typed words mean of what is kept is one rule,
  `make/library.mjs` `meant`, used by the ghost as words are typed and by Enter (#220, November 16): the scorer the
  ghost has had since #244 (how sure, how far ahead of the next, a rarer word weighing more, the last word half
  typed, a letter out or two swapped forgiven), with four differences. A word said whole that the answer lacks makes
  it nothing ("bmw m2" is not the BMW X3, "f1 car" not the saloon, "a red car" not the blue car); a last word still
  being typed counts as whole once it begins none of the answer's words. One word alone that lacks more than two
  letters of the answer's word means nothing, for the ghost as for Enter ("water" is not the waterball, "waterba"
  is); after other words a half-typed word is still read ("a car sal" is the saloon car). A space after the last word changes nothing (Enter sends
  the words without it). So Enter never makes what no ghost showed. A wish is filed under the words it always was, joining words and all: they are left out only of
  what is typed. A wish to change a thing ("paint it red", "make that a castle") is not answered from
  what is kept and is not kept; it goes to the model. "make it drivable" and words like it that point at the thing
  looked at, when that is the asker's own made thing and not alive, go to the helper, which brings it to life
  (below, "A made car is driven"). Pointing and joining words say nothing: "those trees" and
  "make these flowers" are trees and flowers, and "the" or "with" alone mean nothing. A lone word that shows a ghost
  makes it on Enter: "tesla", "model", "x3", "stall", "striped". What is nothing kept goes to the model. `make.mjs`
  looks there first too (`--fresh`: not). Shift with Enter asks for it anew. A picture or a link is never a key and
  never kept. `node test/words.mjs` compares the answers for some 3,100 phrasings (each thing's words alone, in
  pairs, with an article, half typed, a letter out, a foreign word added or in place), as the ghost reads them and
  as Enter does, on what comes with the engine and on a made-up shelf, with what the base (70f526e9) answered
  (`test/words-base.json`, made by `node test/words-base.mjs`): any difference but those four fails.
- **Kept as cells** (#220): a thing made by a program is kept with the cells it came to (`made`, the cells form
  below), so it is never run again, and with what was proved of them once (`proved`): every cell is joined to the
  ground, and it stood whole. On ground that is level under every foot such a thing is not stood in the maker's core
  again; on any other ground it is. Where it goes, what is under it, what is in the way and what the world says
  when it lays it are checked every time. An entry of your own kept before this is given its cells the first time
  it is made. `node make/library.mjs --cells --world URL` gives `make/kept/` theirs (done for the nine there: the
  tree and the street lamp lose a few cells in the core, so they are always stood there).
- **How long a kept thing takes**, the car of `make/kept/` (257,000 cells of 2.5 cm), `make.mjs --times`, its own
  world, November 15 (before it was alive: since November 16 it is a living car, below, "A made car is driven"):

  | | before | now |
  | --- | --- | --- |
  | the program run in QuickJS | 6.3 s | none: its cells are read, 8 ms (35 ms with its stand-in) |
  | where it goes (`ground`, `site`) | 0.1 s | 35 to 55 ms |
  | stood in the maker's core | 0.15 s | 0.16 s on a slope; none on level ground |
  | sent, laid by the world, seen | 4 to 4.5 s (a wait of 4 s to see it stand) | 0.13 to 0.16 s (the world says nothing came loose) |
  | all, from the wish to its cells in the world | 8.2 to 10.8 s (the whole process) | 0.38 to 0.42 s (0.43 to 0.51 s the whole process) |

  The tree is 9.4 s of QuickJS before and 16 ms of reading now.
- **A space to fill**: an ask aimed at a box (the wand's area) makes the thing that big, in the box's middle. Up to
  12.8 m a side it is built whole in 10 cm cells; past that the model builds a model of it and every cell becomes a
  block (`make.mjs --fill w,h,d --grow cap|scale` tries either). Real runs, November 13: an oak 10 by 12 by 10 m,
  whole in 27 s and scaled twice in 38 s; a house 11 by 9 by 9 m, whole in 101 s (10,821 runs, boards, shutters and a
  porch rail) and scaled twice in 72 s (the same house in 20 cm blocks). Pictures: `~/.village/engine/making-ui/big/`.
- **While the model works** (`page/gather.ts`), loose cells lift off the ground round the place, are drawn in and
  circle it; when the model has answered and the thing's size is known they close into a box of that size; when it
  arrives they fall onto it in a puff of dust. If nothing can be made they drop, lie a moment and are gone, and the
  place says why. Nothing of the thing is shown until all of it is there. It is for the eye only, on the page that
  asked: 220 cubes drawn with the crumbs, no measurable cost to a frame (0.9 ms of this thread with and without).
  `node test/wait.mjs --out dir [--refuse]` films it with a kept reply that takes as long as a model.
- **A picture** is made small in the page (1,568 pixels at most, JPEG), goes to the helper and from it to your own
  model as part of the one message, and is kept nowhere: not by the page, the helper, its journal or the world,
  which never sees it. **A link** is fetched by the helper itself (`make/link.mjs`): http or https on its usual
  port, only names whose every address is on the public internet (not this machine, a home network, the tailnet or
  link-local), the connection made to the address that was checked, every redirect checked the same, 3 MB and 8 s
  at most. A page is read as its words (3,000 characters) and its own picture; a picture is a picture. The model is
  told both are things to look at and never instructions.
- **The helper** (`helper.mjs`) listens on this machine only, makes things in the one world it was started for, and
  answers only a request to this machine's own name (Host), from that world's own page (Origin), that knows the
  secret it printed. The address it prints carries the secret after `#`, which no server is sent; the page keeps it
  and takes it out of the address. One ask at a time.
- **One ask** (`page/ask.ts`, the shape in `helper.mjs`): a wish and, when there is one, a picture, a link and a
  target (a point, a box, or a thing and its part), with where the asker's eye is. A thing aimed at is checked and answered "not yet".
  An ask made while another is being made waits its turn in the page. From the console: `engine.ask({ wish: 'a red phone box' })`.
- **From a phone** on your tailnet (the model still runs on this machine):

  ```sh
  NAME=<this machine's tailnet name, as `tailscale status` gives it>
  tailscale serve --bg --https=10161 http://127.0.0.1:5761      # the world's page, tailnet only
  tailscale serve --bg --https=10162 http://127.0.0.1:5763      # the helper's door for the tailnet, tailnet only
  node helper.mjs --world http://127.0.0.1:5761 --page https://$NAME:10161 --reach https://$NAME:10162 --only <your tailnet login>
  ```

  Open the address it prints on the phone (it carries the secret after `#`: send it to yourself, do not post it).
  What comes from the tailnet comes in by a second listener (5763) and must be from the one tailnet login named,
  by the tailnet name, from the world's own page, with the secret. The page takes a helper's address only if it
  is this machine's or the page's own host, and is served with a policy that lets it talk to nowhere else. A
  Sentinel pass (November 13) traced five things in this path, all fixed; `test/helper.mjs` holds a check for each.
  Run from a phone-shaped Chrome page over the tailnet address; **not yet on a real iPhone**: whether its sheet
  offers the library and the camera, whether `capture` opens the camera, and where the keyboard leaves the bar.
- **A made thing has a record** the world keeps: `{id, name, wish, at, size, facing, by}` and whatever the lanes that
  own them put under `parts`, `behaviour`, `controls`, `seats`, `sounds`. It comes on the same ask as the thing's
  cells, is in the world's file, and reaches every page in the stream (`engine.things`). `GET /world/things`,
  `GET /world/things?id=`; `curl /world/` says the rest.
- **A lane's part of a reply**: `field(key, { brief, check })` in `make/form.mjs` lets the model's reply hold a
  further key, checked by that lane, whose result goes into the record. Keys nobody named are still refused.
- `node test/wish.mjs "words" --link <the helper's address> --out file.png [--picture file] [--phone]` drives the bar
  for one real ask and takes pictures of it: **it runs your model.**
- `node test/helper.mjs` checks who the helper answers, which links it will fetch, asks from the real page's bar in
  Chrome with a made-up picture pasted and dropped, the record across a restart, and that keys have one owner: **a kept reply stands in for the model.**

- **What is kept, as you type** (`page/kept.ts`): while words are typed on the ask bar the helper is asked what of
  what is kept (your shelf and `make/kept/`) they mean so far (`POST /kept`), by the rule above. "a ca" is the
  car, "a tre" the tree, "chiar" the chair; "st" is a street lamp or a striped stall, so nothing yet; "a car sal" is
  still the car.
  The page draws it where it would stand, as a ghost (pale, every other pixel), from the first key that makes it
  clear, and takes it away when the words stop meaning it ("a carpet"). Its faces are made by the helper ahead of
  time, each way it may face (`make/shown.mjs`, with the page's own `faces`): the page hands them to the GPU. Enter
  makes that very thing (`kept` on the ask), with no model. The ghost and Enter read words by the one rule, so what
  a ghost shows is what Enter makes, and words sent before the ghost shows make the same thing as words sent after;
  the helper also checks a ghost's id against the words sent. Words that mean a kept thing with no place for it
  where the eye is show no ghost and are still that thing. Matching takes 1 ms. In Chrome (`node test/kept.mjs`,
  "a car" typed at 11 keys a second into a shared world on its own server, three runs): the ghost shows at the 4th
  key ("a ca"), 56 to 77 ms from that key to the frame that shows it; Enter to the frame in which the car stands,
  336 to 465 ms (November 15, when it was cells; it is a living car now and was not timed again). The bench's 30 ms was a page with its own core: here the words go to the helper, the place is
  asked of the world, and the world lays the thing and streams it back.
- **Cells as a reply** (`make/cells.mjs`): the third form, beside parts and a program, for what arrives as cells
  already (a picture carved into cells) and for what is kept. Data only:
  `{"form": "cells", "name", "size": [w, h, d], "cm": 10 | 5 | 2.5 | 1.25, "palette": [[material, colour], ...], "runs": base64}`,
  at most 256 cells a side and 255 pairs, by name only. `runs` is the grid (x, then z, then y) as runs, each a count
  and a pair (0 is air) as LEB128 numbers: the car is 23,601 runs in 90 KB of text. Read, checked joined to the
  ground and kept like any reply; a further key a lane named (`field`) is read as in parts and kept with it. With
  `living` it is a living thing (below, "A living thing made at once").
- **Bigger than 6.4 m** (a bus is 11 m): 256 cells of 2.5 cm is 6.4 m. Built at 5 cm, it stands in the world's own
  cells of 10 cm, each the kind most of its eight are. Why not finer cells of 5 cm: a fine thing that size reaches
  many sectors, each held to 16,384 of the world's cells that hold finer ones, and fine things in view are paid for
  in picture size (#367); a grain of 2 would be a third tag of edits through the core, the march and every page. At
  10 cm a bus keeps its windows, doors and wheels.

### Fidelity: a thing as a program, in cells as fine as 1.25 cm (#372)

```sh
node make.mjs "a pelican riding a bicycle" --world http://127.0.0.1:5741 --at 700,4040 --program --model claude-fable-5-2
node helper.mjs --world http://127.0.0.1:5741      # the bar: --first sonnet makes at once, --best claude-fable-5-2 makes it better behind that (--best none: never)
node test/fine.mjs                                 # the check: kept programs stand in for the model
```

- **The reply is a program** (`make/program.mjs`, the brief is `PROGRAM` in `make/brief.mjs`): JavaScript that lays
  the thing with `put`, `box`, `ball`, `tube` and `text` in a grid of up to 256 cells a side, at true size, in a
  cell it chooses: 1.25 cm for what is held, 2.5 cm for what a person stands beside up to a car, 10 cm for
  everything bigger (a house front at 10 cm has its porch, sills and railings as shape, and the engine's own
  surfaces draw its bricks). A sword is 80 cells long at 1.25 cm; a car 168 at 2.5 cm. It is run in QuickJS in a thread of its own with nothing bound into it, a memory with a maximum
  and 20 s; what comes out is one string, read as any reply is (named materials and colours, never a kind number).
- **Why**: a list of parts spends 20 to 35 cells across a thing whatever a cell is (#254). On ten wishes that are
  also MineBench gallery builds, programs by Fable 5.2 were picked by a blind judge over the gallery's covers on
  nine (#372 has the sheet). A program takes Sonnet 23 to 67 s and Fable one to five minutes.
- **At once, then better** (`make/best.mjs`, what the helper does for a wish with no space to fill): what is kept
  for the wish, or a program by the quick model, stands first; the best model's then takes its place where it
  stands, unless someone holds the first or it has been moved, and is what is kept (`grade: 'best'`). Nine things
  made once by the best model come with the engine in `make/kept/` (a sword and a pistol for the hand, a sword, a
  car, a house front, a chair, a tree, a street lamp, a market stall) and are found like anything kept. Top effort
  was tried and is not worth it: 18 to 20 minutes and $4 a thing for no more detail.
- **Finer cells in the world** (#259): a thing of 2.5 or 1.25 cm cells is one edit of rows of those cells (tags 3
  and 4 of `page/edits.ts`), which `serve.mjs` now takes; a made thing's cells may be 240,000 rows. Its record says
  its `grain` (4 or 8). To the world's own process a cell that holds finer cells is a cell of the kind most of them
  are: it is stood on, walked into, looked at, and breaks at 10 cm. Picked up and put down it is the same cells
  (`rules/holding.mjs`); thrown, it is a body of 10 cm cells.
- **A page looks into finer cells from the moment its world holds any** (`?bricks=1` from the start, `?bricks=0`
  never): a world with none pays nothing. A fine thing that fills a good part of the view costs 10 to 16% of the
  frame (two of them 19 to 23%), which the page meets by drawing fewer pixels; shadows at the thing's own grain
  cost half as much again and are for `?finesun=1`. A house front at 10 cm costs nothing. Numbers: #367.
- **Fine things do not crowd** (agreed on #367): where a thing of finer cells bigger than a hand's (1.6 m) stands
  within 20 m, the next is made as its stand-in, in the world's own cells: of a row of cars the first is fine and
  the rest are the same cars at 10 cm. What is held does not count. A living car is not counted and not made
  plainer: its look of 2.5 cm rides on its body whatever stands near (#245; not yet measured against #367's bound).
- **Taken out whole**: a thing's cells and its record go on one ask (`{gone: id, release: [x, y, z]}`): the world
  empties the cells it keeps for the thing, never rows the asker sends, so a thing of any size can be undone and
  replaced by its better. Not while it is held. A living thing is taken out wherever it has gone (its body goes). A new thing's cells must lie where its record says it stands.
- **What the maker will not send**: a fine thing that reaches more than 16,384 of the world's cells in one sector
  (the core would refuse it there: build it as a shell), and one the world took only part of or that came apart is
  taken out again. The brief says both, and how the world holds things up (at 10 cm, by the commonest material).

## Sound (#247)

Everything heard is computed as it plays, in the page, from patches: no recording exists. A patch is strict data
that says how a thing is set sounding and what it is (`page/sound/patch.ts`); the synthesiser is one file that
runs on the audio thread (`page/sound/dsp.ts`) and nothing a patch says gets past its ceiling of -1 dBFS.

- Sound starts with the first click, key or lifted touch. `?sound=0` leaves it out.
- Heard today: each tool on each material, glass and walls coming apart, what falls landing, a blast (after its
  flash by its distance, 343 m a second), fire, rain, wind by height and speed, surf near the sea, the sea
  overhead, steps when the eye is at head height and walking.
- **Music follows the place** (`page/sound/music/`): the town has a house groove, the coast lilts in six, under the sea
  and far above the land there is no pulse, snow has bells and space, night a few notes on a piano, danger a driving
  figure (at once, when a charge goes off near by), making a marimba at work. It is composed as it plays: for each
  voice 3,000 random patterns are scored against named rules, each with its source, and the best is kept. No piece
  is played twice; calm places are quiet between pieces. `?music=0` leaves it out.
- **Instruments** (`page/sound/instrument.ts`, `surface.ts`, `instruments.ts`): an instrument is a voice (a patch) and
  a surface to play it by, both data in a made thing's `sounds`. A part of a surface is a shape anywhere on it that
  sounds a note, is a string, sets a chord, strums, or slides between two pitches; the rest is its look. A guitar
  (chords and six strings, after The Last of Us Part II's), an ocarina (five holes, a finger drawn up a hole bends
  it) and a piano are kept. `node instrument.mjs piano --world http://127.0.0.1:5764` stands one in a shared world:
  walk up to it, press E (or tap "Play the piano"), play by keys or touch, Escape puts it away. A key is heard 3 ms
  after it is pressed, before the device's own delay.
- **Sounds written by a model**: `node voice.mjs "a kalimba" --model sonnet --out kalimba.json` runs your own Claude
  Code once with no tools (the maker's runner) on the brief in `page/sound/brief.ts` and the thing's name, and reads
  the reply as data (`sounds()`); a reply that is refused goes back with the reason, up to three times. Add
  `--world url --id thing-id` to give the sounds to a thing that is there, or
  `node instrument.mjs kalimba --sounds kalimba.json --world url` to stand it as an instrument. Seven kept replies
  of November 13 are in `page/sound/kept/` (a kalimba, a theremin, a steel pan, a church bell, a wind chime, a vase,
  a rubber duck): all taken on the first try, in 6 to 24 s. The checks read them and run no model.
- **A voice for what people say** (`page/sound/voice.ts`): being tried, two ways, off unless asked for.
  `?voices=babble` sounds what others say in the synthesiser: a syllable for each syllable, at the speaker's own
  pitch, falling through a statement and rising at a question, each vowel with its own colour, placed where they
  stand; it says no words. `?voices=speech` is the browser's own speech: real words, a pitch and pace by the
  speaker, louder when near, but not placed in the world and not measured by anything here. The lab has both.
- `/page/sound/lab.html` plays every sound by hand, with a picture of what is sounding and what the audio thread
  costs, and takes a patch of your own. It is the place to listen: the checks cannot.
- **How it sounds is judged with nobody listening** (#410, `ears/`): `node ears/bench.mjs --out dir` renders 54 fixed clips of what the engine plays; `cd ears && uv sync && uv run python judge.py measure dir && uv run python score.py clips dir` measures them and says each fault in words, against ranges taken from well-made reference audio; `node test/judged.mjs` is the check (a hard fault, a new fault or a lower score fails; `--accept` takes a change on purpose). What each measure is, how it was proven and what it cannot see: `.agents/skills/sound-judge/SKILL.md`.
- `node test/sound.mjs` measures the synthesiser in Node (no browser); `node test/music.mjs` measures the rules, the search and the handover between places; `node test/heard.mjs` taps the real page; `node test/played.mjs` plays the instruments with real keys and touches;
  `node test/listen.mjs --out clip.webm` records picture and sound together. What they stand in for and what
  they cannot say: `.agents/skills/game-sound/SKILL.md`.

## Living things (#245)

A thing can be a body for as long as it lives: it stands on feet, sleeps when left alone, and is driven by what it
is told (go, turn, rise, roll, jump). The first is a car written by hand:

```sh
node serve.mjs --port 5765                 # then open /city?fly=0&living=car: a car stands in the street ahead
engine.alive.spawn(engine.car([760, Math.round(engine.ground(76, 407.4) * 10) + 5, 4074]))   # or in the console: a car where you say
```

Walk up to it: a cue says `E  drive the car`. E gets on, the card shows the scheme (W S drive and reverse, A D steer,
E get off), the eye rides behind. It has weight, breaks what it hits (and tells what it struck: `engine.alive.struck`),
and is broken by a hit that takes 12 m/s from it at once, or by a blast. On a phone the cue is touched to get on, the
left thumb drives and a button gets off.
In a shared world (`?shared=1`) the same call makes it a made thing with a record, and the world's own process moves
it: every page sees it, whoever gets on drives it, and `POST /world/drive` drives it from anything that can send a
request (`GET /world/` says how). Where it sleeps is written into its record (`controls.rest`), so a server started
again stands it up there; and, the first time anyone gets on it or drives it (a rider or a rule), `controls.driven`. A thing lives once its record's `controls` has a motor (`page/living.ts` `Controls`).
`node test/living.mjs --out dir` drives it in Chrome and films it; `node test/driven.mjs` is the shared world's check;
`cargo test --release living` proves the car, a broom that hovers, flies and rolls, and a frog that hops, natively.

**A look in finer cells.** The body that moves is cells of 10 cm, and a car made from a picture is 2.5 cm outside and
1.25 cm in its cabin. So a living thing may wear a look: `Making.fine`, a list of parts, each `{size: [w, h, d], per,
low: [x, y, z], cells}` (`page/living.ts` `Fine`). `per` of its cells lie along one of the body's (4 or 8), `low` is
the part's low corner in the body's own cells (it may be fractional), and `cells` are kinds laid
`cells[(y * d + z) * w + x]`, as `page/fine.ts` takes them (base64 of the 16-bit kinds when a string). Each part is a
piece (`pieces.ts`) put where the body is every frame, before it is drawn, and the body's own cells are not drawn. When
the thing breaks the look goes, and its pieces are drawn as they always were. `/city?fly=0&living=finecar` stands the
hand-written car in a look of 2.5 cm (`fineCar`: a body, glass on pillars, wheels, and inside two seats, a bench, a
dash and a wheel).

In a shared world the record does not hold the cells: a car's parts are megabytes, and its `controls` are written again
each time it sleeps. The page sends each part's cells first to `POST /world/fine`, which keeps them gzipped by their
sha256 beside the world's file and answers `{kept}`. The record's `controls.fine` then says `{size, per, low, kept}`,
a few hundred bytes for a car, and every page there fetches `GET /world/fine/<kept>` once and draws the look.

**The driver's seat.** Riding, V changes between the eye behind and the eye in the seat (the card says
`V  look from the seat`; on a phone a "seat" button). In the seat the eye is at `Controls.eye` (`Making.eye`), in the
body's own cells from its low corner; without one, the first seat with a sitting person's eye 1.2 m over it. The
whole frame turns and leans with the thing (`pose.tilt`), the head still turns with the mouse, and the rider's own
figure is not drawn. Its glass is seen through from the seat, as from the street (#163).

**The shade under it** (`page/under.ts`). Pieces cast nothing into the sun's maps, and a car stood on the road as if
pasted on it. Under each living thing the ground is darkened softly over its footprint, moved a little the way the
sun throws its shadow, fading as it rises off the ground and at night. It costs nothing that can be measured (the
check times it). A shadow thrown across the street by a low sun would need the body's cells in the sun's maps.

`node test/fine-living.mjs --out dir` is the check: the look stands and goes where the body is, its own cells are not
drawn, V puts the eye in the seat and it stays there at speed, a blast takes the look away, and in a shared world the
record says where the cells are and a page that joins later draws the look. With `--out`, pictures from beside it,
from behind and from the seat.

**Fast, up hills and straight** (#245). A car built from a photograph (a BMW X3 with its measured motor: 240 km/h,
0 to 100 in 6.3 s) struck the road and broke going up the main street at 46 km/h, and the engine's own car at 58.
What changed, all in `bodies/living.rs` unless it says otherwise:

- A rolling foot follows the road as a wheel does. It keeps how high the road under it is and how fast that rises,
  so it goes smoothly over each riser and has no lag at all up a steady hill. Its spring is damped against how fast
  it closes on the road, not against all the speed up: climbing is not the spring opening. Before, a car rode
  0.23 s of its rate of climb lower than it stands, and a foot that took each riser over a thirtieth of a second
  rode lower again.
- Pressed in further than it stands, a rolling foot stiffens, as a car's spring meets its stop. Where the street
  steepens at speed, the fast car rode up to 0.88 cells low for a second without it, 0.45 with it.
- What rolls is held up square to the road, read from the road under its feet front and back. A climb costs it
  speed and a descent gives it some: flat out, the engine's car does 72 km/h on the level and 59 up the 12% end of
  the main street. Held straight up, a hill cost nothing, which made every street the same.
- The feet push one after another, each meeting the body as the one before left it, so the first had the edge. A
  car whose left feet always pushed first turned right, steadily: the engine's car went 5 m off its line in 335 m,
  the X3 48 m in 1.26 km. Every other step each foot's place in the order now goes to its twin across the body. Both
  cars now hold their line within 0.1 m over 300 m and more on the level.
- A low corner of what rolls that meets a riser one cell high goes up over it (`bodies.rs`). Pushed back out of the
  step's face, a car whose floor was half a cell over the road stuck on a step it met under 25 km/h and broke on
  one at 75 km/h.
- The engine's car (`page/living.ts` `car`, and `tests::car`, now the same car) reaches 6 cells from each wheel's
  middle, so its wheels stand 0.6 cells over the road and nothing of it but its feet meets the road.

Flat out up the main street from x 760, z 4065, told no turn: the engine's car goes 295 m in 20 s, reaches 63 km/h,
never meets the road and rides at most 0.19 cells low; a car with the X3's motor goes 598 m and reaches 168 km/h, its
lowest point never under 0.43 cells over the road, 0.45 cells low at most for a second. `cargo test --release
up_the_main_street -- --ignored --nocapture` prints it a second at a time for 25 s, on the street and on the level
(in 25 s the fast car goes 846 m and reaches 189 km/h, still clear of the road).

**A living thing made at once** (#245). A car is typed on the ask bar like anything kept: its ghost shows as it is
typed, and Enter stands it, alive. E gets on, V looks from the seat, W drives it with its own motor.

```sh
node make/import.mjs ~/.village/engine/fast-voxels/library/bmw_x3.json --twin ~/.village/engine/fast-voxels/out/world/x3_twin.json
node helper.mjs --world http://127.0.0.1:5741      # then type "bmw x3" on the ask bar
node make.mjs "a bmw x3" --world http://127.0.0.1:5741 --at 760,4065 --times      # or from here
```

- **The reply** (`make/alive.mjs`) is a reply of cells whose body is in the world's own cells (`cm` 10), with
  `living`: `{scheme, motor, seats, eye, look, facts}`. Every place is in the body's own cells from its low corner,
  as the solver takes it (`page/living.ts` `Controls`). `look` is up to 8 parts, each
  `{size, per: 4 | 8, low, palette, runs}`: the same runs and named pairs as the body, so no kind number is taken
  from it, and no more than a page will draw (`fineWithin`, 1.5 million filled cells). `facts` is
  `{asked, measured}`, up to 16 named numbers each and 1 KB. The core clamps the motor; feet, seats, the eye and
  the look are held to the body and 8 cells round it. A key nobody named is refused, as in any reply.
- **Made**: it is turned whole to face the asker, a quarter turn at a time: its cells, its front, its feet, seats,
  eye and look. (The placing's own turn mirrors what it lays: a car so laid would be driven from the wrong side.)
  It stands level, set over the ground by as much as its feet reach, in one edit of the usual size. Each part of its
  look is sent to the world first (`POST /world/fine`), unless the world says it has it (`HEAD /world/fine/<sha256>`).
  Then its body goes as the thing's cells with `controls` (the look by its sha256) and `facts` in its record, and the
  world answers once it lives (`alive` on the ask's answer). It arrives whole or not at all: a look the world will
  not keep is not made, and one the world could not bring to life is taken out again.
- **Taken out** (`make.mjs --undo`): wherever it has been driven. Its body goes, and whoever rides it is set down.
  One that broke is cells where it broke, and is not looked for.
- **Kept and shown**: kept like anything made, as cells with what was proved. Its ghost on the ask bar is the first
  part of its look (its outside), turned as it will stand, not its body of 10 cm. When the ghost shows, the helper
  sends the look to the world, so Enter sends the body and its record alone.
- **Its figures** travel in its record (`facts`): the riding card says them on one line under its name, as
  measured or else as asked ("240 km/h, 0 to 100 in 6.3 s").
- **The importer** (`make/import.mjs`) turns a living build of the fast-voxels bench into such a reply and keeps it
  on the asker's own shelf (`--shelf dir` for another; never `make/kept/`). The bench's library leaves the cabin's
  cells out: `--twin` gives them. Kinds are turned back into named materials and colours; one with no name is
  refused. The X3 is 0.68 MB on the shelf, the Model 3 0.50 MB (5 to 6 MB in the bench's library).
- **How long**, the X3 imported, typed on the ask bar of a world of its own (by hand, November 15, three runs): a
  key to its ghost 61 to 82 ms ("bm" is enough). Enter to the car standing in its look: 563 to 615 ms for the first
  in a page, 61 to 76 ms for a second of its kind. The helper makes it in 120 to 270 ms: reading 30 ms, placing
  30 ms, sending it and the world's word that it lives 60 to 190 ms. Its look (9.6 MB of cells) was sent while the
  ghost showed: 66 ms to send, 3 ms to ask when the world has it. The record reaches the page 50 to 90 ms after
  Enter. The rest is the page making the look's faces: 4.8 million cells, half a second on the page's own thread,
  which is a hitch of that length. They are made once for each kind, so a second car makes none. On the main street
  W takes it from 0 to 100 km/h in 6.0 s and 97 m (it was measured at 6.32 s).
- `node test/kept-car.mjs --out dir` is the check, with no model: the engine's own fine car written as a bench build,
  imported, typed a key at a time, Enter, E, the card's figures, W, V, and `--undo` while it is ridden.
  `node test/make.mjs` checks what a living reply may not be, that turning keeps body, feet and look together for
  each facing, and imports both of the bench's cars when they are on the machine.

**A made car is driven** (#245, November 16). A car a model makes is a car one drives: E gets on, W drives it,
V looks from its seat, as with an imported car. `node test/made-cars.mjs --out dir` is the check, in Chrome, with
stand-ins for the models (a reply of parts in `test/made-cars/hatchback.json`, a program in `roadster.js`).
`node test/drivable.mjs` checks in node, with no Chrome, what it must not do: the words, the replies, tables,
the card, the front (cars nosed every way a model may lay them, made facing each way, driven), what is kept for
the words, whose it is, the one ask that swaps it, and a driven car's better version.

- **What the model says** (`make/brief.mjs`, both briefs): a thing one gets into and drives on wheels carries
  `"drives": {"front": "-z", "top_kmh": 180, "zero_to_100_s": 9}` (parts and cells) or calls
  `drives({...})` (a program). Only what the cells cannot say: which way its nose points in its own space, and how
  fast such a thing goes. It is checked (`make/form.mjs` `drivesOf`): a wrong front or a figure out of bounds is
  refused, or, read leniently, left out and said, and the thing is then not driven (`"drives": false`, `"no"` and
  `drives("no")` are not driven; `"drives": true` and `drives()` are, as a plain car). It is not a lane's `field`: naming one would make every kept
  entry stale (`library.find` drops entries whose `fields` lack it).
- **What is worked out from the cells** (`make/drivable.mjs`): the body is the thing's own cells at 10 cm (a cell
  filled where a quarter of its finer cells are), its look its own finer cells. Its wheels are the groups of cells
  that touch the ground, measured slice by slice across each: a group longer than a third of the thing is a skirt,
  not a wheel, and a leg or a post is not one either: a wheel that is grown into its flank is its own kind, no
  taller than a wheel may be and about as long along the ground as it is tall. Its length is along the front the
  model said; else the way it rolls on its wheels (its longer side tried first), else its longer side, so its
  wheels are found before its front is looked for. Its front is what the model said; else what its cells say
  plainly, its lamps (white ahead, red behind: right on the saloon of `make/kept/` as it was before `drives` was
  added, made facing each way; read only along its length as found above, so a thing with no wheels whose lamps are
  on its shorter sides is not read by them); else, for "make it drivable", the way it was made to face if that lies along its length. When
  nothing says, it goes the way its high parts are not over, and the place says nobody could tell ("which end is
  its front could not be told: if it goes the wrong way, turn it round"). Its seat is the most room over a floor on the driver's line between its axles (the left of what is
  wider than 1.5 m between them), the eye 0.8 m over it, under any roof. Front wheels steer and every wheel drives,
  with grip enough for the sprint asked.
- **Its motor and its figures**: its top speed is what was asked (180 km/h when nothing was), and its power is
  tried in the engine's own solver (`page/core.wasm`, in node, on a level strip of its own: 0.2 to 0.4 s) until it
  reaches 100 km/h in the time asked. `facts.asked` holds only what the model said; `facts.measured` only the
  0 to 100 of the last run, with the motor as it is kept. The card says each figure as measured or else as asked.
- **What does not roll** (no wheels on both sides, or only legs and posts: a boat, a broom, a table, a stall): it
  is driven all the same on four small wheels of 0.3 m under its corners, and the place says so. Too big to be a body (over 9.6 m a side): it stands as it is, and
  the place says why. Flying, hovering and riding things (`SCHEMES`) are not made from words yet.
- **"make it drivable"** (and "make this driveable", "let me drive it", "can I ride that one?": `page/living.ts`
  `asksToDrive`). Only words that point at the thing looked at and say nothing more, and only when what the eye
  meets (its box and half a metre round it, the nearest) is the asker's own made thing, by the name it was made
  under, and not alive (`make.mjs` `aimed`, the one rule: the helper uses it, and the page's bar asks it by
  `POST /drivable` before it says what Enter will do). Aimed at anything else (a realm's own horse, another's thing,
  a living car, nothing made) the words do what they did before: in a realm they are said to it. "make the dragon
  alive" is a new thing the model makes. The helper reads the thing's cells from the world
  (`GET /world/things?id=`), works out what makes it live as above (its lamps, else the way it was made to face),
  and sends the living one in its place on one ask that also takes the old one out (`POST /world/ask` with
  `gone`): the world's server checks both before it does either, and takes both or refuses both. So an answer that
  is lost or comes late leaves one of them where it stood, never two and never none, and nothing is put back. While
  one ask has a thing (to make it again, take it out or pick it up) a second is refused until the world's process
  has done the first: two at once were both taken. Not held: inside the server it is two things told to the world's
  process, one after the other, and two entries in the world's file. A server that stops in the moment between them
  comes back with the old thing gone and the new one not there. And if the world took the swap but could not bring
  the new thing to life, the place would say it could not be done while the old thing is gone (not seen to happen:
  the same body has run in the solver before it is sent). No model is
  asked, so its figures are a plain car's. It is an act on that thing: what is kept for its words is not changed,
  and the same words make what they made before. The place says what was done ("Your Formula 1 car is alive: walk
  up to it and press E"), or that the world did not say and to look first. Undo by an id takes out only the
  asker's own.
- **At once, then better**: the better car takes the quick one's place, alive, unless anyone has got on or driven
  the quick one, a rider or a rule: the world writes that into its record the first time (`controls.driven`, in the
  world's file, so it holds after a restart; before it is written, `GET /world/things?id=` says `ridden` for a
  rider's drives). It is then only kept, and the next asker of the words gets it.
- **What ships**: the saloon of `make/kept/` says `drives({ front: "-x", top_kmh: 190, zero_to_100_s: 9.5 })`
  (added by hand; its nose is at low x) and is kept as a living reply: "a car" on the bar is driven, 0 to 100 in
  9.4 s as measured. Its cells were made again from its program as `make/library.mjs --cells` makes them (`make`,
  dry), from a script: on November 16 that command stopped at once here ("unsettled top-level await": make.mjs and
  library.mjs import each other).
- A stand-in proves the joining. Whether a real model says `drives`, and says its front right, is for a real run.

**A thing drawn and carved** (#245, November 17). A wish that nothing kept answers is drawn first: an image model
draws one sheet of the thing from five sides (left, right, front, rear, top, no perspective), and the builder carves
and paints cells from those views. A car so drawn stands alive and is driven nose first. Typed again, it stands from
the shelf at once.

```sh
node helper.mjs --world http://127.0.0.1:5741      # draws when this machine has a fal key; --no-draw draws nothing
node helper.mjs --world URL --sheets dir --facts sonnet    # keeps each sheet drawn, to look at; which model says the facts
```

- **The drawer** is fal.ai's `fal-ai/nano-banana-2`, through its sync API, about 8 cents a sheet
  (`.agents/skills/fal-model-api`). It is sent the typed words alone, never a picture or a link. The key is
  `FAL_KEY` or the login Keychain's `village-fal`, read by the helper for each call and sent only to fal. fal is asked
  to keep no request history (`X-Fal-Store-IO: 0`), and the picture comes back in the answer (`sync_mode`). With no
  key, nothing is drawn and the helper says so when it starts.
- **A drawing is paid for**, so the helper holds to three things. Only words a person typed on the bar are drawn
  (`typed` in an ask, set by `page/making.ts`): a rule's `world.make` reaches the same helper with words nobody typed,
  and is made as before. Words whose drawing was paid for and did not stand are not drawn again while the helper
  runs, but for Shift with Enter. And a day has its most: `--draw-most 40` (the count is the running helper's own,
  and starts again when it does). fal's answer is data: it is read up to a size, and a picture is fetched only from
  fal's own store (`fal.media`), with no redirect followed.
- **What the picture cannot say comes from a model at the same time** (`make/drawn.mjs` `FACTS`): the asker's own
  Claude Code (sonnet by default), asked for one line of JSON. It gives whether this is a thing to draw at all, a
  name, its size in metres, the one material it is mostly made of, and, for a thing one drives on wheels, its top
  speed and 0 to 100. It answers in about 2 s, long before the picture. Sonnet answered as fast as haiku in one try
  each (1.5 and 2.2 s) and gave the better name.
- **Which wishes are drawn**: plain typed words that nothing kept answers. A change to a thing ("paint it red",
  `asksAChange`), a thing for a hand, a space to fill, a picture or a link are not drawn, and neither is anything that
  goes to rules, realms or spells. Of the rest, the model says no for several things or a place, a building one
  goes inside, and a thing that must work in a way a picture cannot give it (light up, open, pour, fly). Those are
  made as before. The picture has been asked for by then, and its cost is lost.
- **The builder** (`draw/`, the bench's `sheet5.py` taken in as the engine's own) runs in Python (numpy, scipy,
  Pillow) through `uv`, as `ears/` does. Porting its label, opening, erosion and distance work to JS would be a second
  copy to keep right, and a wrong build costs more than the start. It is started when the wish is, so its imports are
  done while the picture is drawn, and it gets the sheet when it arrives: 0.2 to 0.4 s for the build. `uv` makes its
  environment on first use (a network fetch once).
  - **Size**: the thing is carved with as many cells along its longest side as the model's size gives, in cells of
    1.25 cm (up to 1.6 m), 2.5 cm (up to 6.4 m), 5 cm or 10 cm (up to 25.6 m). Colours are the world's 255, matched in
    OKLab (`page/march.ts` `palette`); the material is the model's, one for every cell.
  - **Front**: the view from above is asked to be drawn with the front to the left, and the builder notes which way
    it laid that view to agree with the sides. The thing is turned half round (x and z, so it is not mirrored) when
    the front ended up at the far end, and the front and rear pictures then paint the ends they show (until November 17
    the front picture painted the rear: the horse below was made so). The side views ignored the asked direction now
    and then (the bench's red F1 sheet, the horse), and the view from above kept to it. When the top view was drawn
    turned a quarter round, the front is not known, and for a car `make/drivable.mjs` says so and the person is told (a note at the place). `draw/check.py` (run by
    the check) builds the racer sheet with its side views drawn the other way and finds the same front end.
  - **Six or seven views**: the drawer often draws a view twice or adds one in perspective. Of the seven biggest, the
    five that pair up best (sides with sides, ends with ends) are kept. A sheet that will not read as five views, or
    whose views carve to nothing, is not built.
  - **Checked against the model**: the carved thing's height and its longer and shorter sides along the ground must be
    within a factor of 1.8 of the model's size. A drawing whose views disagree, that was drawn at two scales, or that
    shows something else comes out another shape and is not made. Then nothing is sent, and the wish goes on as
    before.
- **A drawn car** is brought to life from its cells (`make/drivable.mjs`), with its front at the nose the drawing
  gave and its figures from the model. A drawing has no inside to sit in, only a shell, so it is made `open`: what is
  under its top counts as solid, and the seat is where its top dips (a cockpit) or on top, with the eye 0.3 m over the
  rim. V sees the road over its bonnet. A cabin of its own would need a second picture. The living reply is what is
  kept, so the shelf's copy and the ghost have the same eye.
- **The wait** (`page/making.ts`): at once, "Drawing … from five sides" with the seconds counting, while the loose
  cells gather at the place (`page/gather.ts`). About 2 s in, the model's size closes them into a box of that size and
  the name is known. Then "Carving … from the drawing", then the thing. When it is not drawn after all, the cue says
  "Making …" and it is made as before, with no warning shown.
- **Kept**: as a reply of cells (living, for a car) with `grade: "best"`, so no better model is started over it.
  Shift with Enter draws it anew.
- **How long** (by hand, November 17, a world of its own, the real drawer and the owner's sonnet, seconds from Enter
  to the thing standing; the page has it in the same moment):

  | wish | picture | facts (alongside) | build | rest (place, send, world) | all | what came of it |
  | --- | --- | --- | --- | --- | --- | --- |
  | a blue pickup truck | 9.4 | 2.0 | 0.4 | 1.1 | 10.9 | stands alive, driven 43 m in 4.7 s; 0 to 100 in 8.4 s as measured |
  | a bronze horse statue | 10.4 | 1.9 | 0.3 | 0.6 | 11.3 | stands, 2.6 m long, in 2.5 cm cells |
  | a stone park bench | 11.0 | 1.9 | 0.4 | 17.6 | 29.0 | not drawn (side views as wide as the front), made as a program instead |
  | a bicycle | 10.2 | 2.7 | 0.2 | 58.5 | 68.9 | not drawn (four views, drawn over each other), made as a program, asked twice |
  | a tall saguaro cactus | 11.4 | 1.6 | 0.3 | 24.8 | 36.5 | not drawn (side views at another scale, arms all round), made as a program |

  The builder as it is now does the same with each of those five sheets and the facts given then (replayed, no fal
  and no model). Typed again, the truck stood from the shelf in 0.31 s. Through fal a sheet took 8.6 to 11.4 s (ten sheets).
- **What is weak**: three of five real wishes were not drawn. The drawer keeps the layout for cars and less often
  for other things: of ten sheets, three drew six views, one seven, one overlapping views, one side views as wide as
  the front and one its views at two scales. The cars and the horse kept to it. Things drawn photoreal come out mottled (the horse's bronze patina is camouflage at 2.5 cm), and thin
  parts (spokes, slats) come out thick or lost. One material for all of it: glass and tyres are paint. A sheet may
  carry a real maker's badge (the truck's). The extra words added to the prompt on November 17 ended the labels and
  did not end the extra views (two sheets).
- `node test/drawn.mjs --out dir` is the check, in Chrome, with stand-ins for the drawer (`test/drawn/racer.jpg` and
  `hydrant.jpg`, two sheets fal drew for made-up words) and for the model. The builder is the real one. A drawn
  racing car stands alive, E gets on, W takes it the way its low nose points (read from its look, not from its
  motor), and from its seat nothing of it is met straight ahead or 10 degrees down. Typed again, it stands from the
  shelf with no drawer or model asked. A hydrant stands as tall as the model said. A drawer that fails, words the
  model says are no thing to draw, a helper with no drawer and "paint it red" are made as before, with nothing
  alarming said. A stand-in proves the joining, not what fal draws or what a real model says.

Address options: `?grid=16,8,16` `?levels=9` `?pool=256` `?scale=0.5` `?at=x,y,z`
`?look=yaw,pitch` `?shadows=0` `?mirrors=0` `?maps=0` `?flat=1` `?fire=0` `?hour=18.1` (the time of day; the `[` and `]` keys move it half an hour) `?rain=1` (rain; the R key turns it on and off) `?heat=1` `?fly=0` `?seconds=40` `?bricks=1` (with `&finesun=0`, `&walk=loop`) and `?fine=1` or `2` (#259, experiments in shape finer than a cell: the cell-engine skill says what each is, and what an edit of finer cells may be; without `bricks=1` such an edit is refused whole) `?people=0` (a town with nobody in it) `?sound=0` (silent) `?music=0` (no music) `?name=Ada` (in a shared world).

To a phone on the tailnet: `tailscale serve --bg --https=10140 http://127.0.0.1:5740`, with
`node live.mjs` run after each merge so that the link serves main and not a working tree.

## A person's body (#264)

B gets the eye down onto its feet where it is, and back up to fly; `/city?walk=1` starts on foot. W A S D walk the
way the eye looks, Shift runs (4.5 m/s; a walk is 1.4), Space jumps, V puts the eye in the head or behind the
shoulder. On a phone the left thumb walks, and runs when pushed right over. The body is a living thing of the core's
(`bodies/living.rs` `figure`, `page/person.ts`): a box on a leg that is a spring, so it takes the road's steps and
kerbs, is stopped by what is built and goes along a wall it meets at a slant (its body hardly rubs: it stopped dead at any wall met within 35 degrees of square), stands on rubble, falls, and is thrown by what hits it. Tools and the wand work
on foot as they do flying.

- **It goes at its pace whatever the frames** (#367): a call to the core moved bodies on by 25 ms at most, so on a
  page drawing 33 frames a second a four-second run went 12.7 m of its 17.6, and at 18 frames 7.1 m. With few bodies
  awake (48 or fewer) a call now takes all the time it is owed up to a tenth of a second; with many it is still held
  to three steps, so a town coming down slows and does not pile up work.
- **Who moves it: the page**, in a core of its own. Told through the world's process, a living thing is seen to move
  30 ms later on this machine (32 ms through the tailnet's own address), and the owner's phone was 127 to 429 ms away
  by the tailnet's relay when it was measured: every step a quarter of a second late. So in a shared world the page
  keeps a second core that is told every edit the world tells of, walks its body there, and says where its feet are
  ten times a second, as it always said where its eye was. Others see the figure walk; a rule has the feet in
  `world.people`. What strikes the body is the world's process's to judge (the next unit).
- **What the body can do is numbers a rule sets**: `world.person(id, {pace, jump, climb, fly, fall})` (how fast it
  runs, how high it jumps, how high a wall it gets up when it goes on against it, how fast it flies, how much of the
  world's pull it feels), and `world.clock({rate, spare})` slows or quickens everything the world moves and everyone
  in it but those spared. "Walk up walls", "fly", "leap a street", "slow time" are a rule setting numbers; neither
  the core nor the page has those words. In the air one who flies goes at their `fly` pace, Shift or not; on their
  feet at their walk and run again (#366: in the air they went at a walk, and at their run with Shift). The guide
  (`GET /world/`) says the ranges. In the console, alone:
  `engine.me.can = {climb: 100000, fall: 0.3}`, `engine.tempo.rate = 0.25`.
- **Which way is down for a body** is two more of those numbers: `world.person(id, {down: [1, 0, 0]})` turns a
  person's own down to any way in the world's axes (they fall that way, stand on what they meet, run along it, and
  a jump is away from it), and `{cling: true}` turns it for them to whatever face they walk onto: at a wall, up it;
  over its top edge, onto the roof; over the far edge, down. The eye turns with them, in the head (what they stand
  on is the floor they see). `null` puts either back. Others still see the figure drawn upright (PEOPLE's to lean).
  In the console: `engine.me.can = {cling: true}`.
- **A move and a look for someone at a page**: `world.person(id, {move, aim, look})` takes what `world.actor`
  takes (the people lane's moves and looks as data, by one function in `world.mjs`): a rule makes a person's own
  figure kick, duck or bow by keys of its own, and wear a long coat. Everyone sees it by the telling any body has
  (`here`); the person's own page, which draws its own figure, is told with the numbers (frame 12, `figure`) and
  starts the move when it hears. A move is how a body looks: it strikes nobody. Taken out, the rule's look and
  move go. In the console, alone: `engine.me.limbs = {move: {n: 1, name: 'kick'}, look: {wear: ['coat']}}`.
- **A rule drives a living thing**: `world.things` tells a rule the living things near anyone (by their record's
  id, with name, scheme, place, yaw, speed) and `world.drive(id, {go, turn, rise, jump})` drives one as a rider's
  hands do, held until the rule asks otherwise (`rules/things.mjs`; the world's process says it to the core again
  four times a second). Someone riding from a page has it while they ride. Checked by `test/drives.mjs` with a
  valet's rule.
- **Who rides**: `world.seat(id, {on: thing})` puts one of a rule's actors on a living thing (they sit and go where
  it goes) or someone at a page (their page gets them on; on foot, their body is taken up and set down again when
  they get off). A page that gets on or off by itself says so (`POST /world/drive {by, id, on}`). Rules hear `ride`,
  `world.things` says `riders`, and everyone sees a rider sitting where the thing is: the world's process carries
  them ten times a second, so at speed a rider is drawn up to half a metre behind. Whoever rides from a page is drawn on
  that page in their seat where the thing is that frame (`alive.rider`): from behind, a kart went with nobody in it.
- **Where a thrown thing lands**: the rule that threw it hears `landed` the first time it meets the world and no
  body (`{at, speed, met, from, tag}`; `tag` is the word it gave `world.throw`), from the core's `STRUCK` record
  against the world. And a rule breaks and burns: `world.blast({at, radius, spark})` and `world.ignite({at, radius})`,
  by the calls an ask from anyone makes, with its caps (40 and 8 cells) and 4 and 8 a second a rule. What they break
  is in the world's log as any blast's is.
- **Whether one body can see another**: each person a rule is told of says whom they see (`world.people[i].sees`),
  and `world.sees(a, b)` asks it: within 60 m, a clear line from eyes to head or chest through the world's cells as
  they stand (glass and water are seen through, leaves hide), and in front of the one who looks or within 2.5 m
  (`rules/sight.mjs`). Worked out for pairs with a person at a page or in a seat, at most every 0.4 s: with one
  person and 64 actors in sight that is at most about 115,000 cells asked. Checked by `test/sees.mjs` (no page).
- **A rule brings a living thing**: `world.thing(id, {like, at, yaw, colour})` sets down one of a small kept set
  (`rules/kept.mjs`: a kart, a car, a broom; cells, motor, scheme and seats as data) at once, with no model. The
  world's process asks for it as anyone asks for a made thing (its record and cells in one ask of its own), so it
  is in the world's file and every page has it. `{like: null}` takes it away; a rule taken out takes all it
  brought. A thing's `controls` may say `seats` (and `size`): riders sit each in their own, and one too many is
  refused. A rider has no ghost while seated (it stood inside the kart and shoved it). Checked by
  `test/brings.mjs` (no page) and the kart in `test/drives.mjs`.
- **A race run fairly**: `world.drive(id, {hold: true})` holds a living thing still whoever drives it (the world's
  process puts it back and drops a rider's word), and `world.line(id, {from, to})` or `{at, within}` is a line or a
  place the rule hears `crossed`: by which thing or person, which way, where, how fast, and `when` to the
  hundredth of a second, worked back along the tenth-of-a-second step it was crossed in. Laps, a finish and a
  checkpoint are the rule's own numbers. In `test/brings.mjs`.
- **How much a thing takes is a number**: on a thing it brought a rule sets the motor's own numbers,
  `world.thing(id, {tough, top, power, grip, steer, jump})`, for good or `for: seconds` (they go back by
  themselves), and hears `broke` when one breaks. `tough` is the speed a thing can lose in one step and stay whole:
  the kept kart is made 300 against a top of 140, so it takes a wall (a car's 120 broke it on the first parked
  car). Weight is not a motor number: "heavier" is not there. Checked by `test/tough.mjs` (no page).
- **A thing that floats**: the still sea is a plane and no cells, so bodies fall through it. What hovers now rides
  the sea's top as it rides the ground (`living.rs`, the hover's look down), looks under its bow as well as its
  middle, and stays level when driven if it has no lift (it dipped its nose as a broom does and dug in). The kept
  `craft` is that: an open hull, six seats, over water and up a beach. It hovers; it does not displace water: a
  hull that sits in the sea and rocks would be buoyancy for every body, which the core does not have.
- **A thing given somewhere to go**: `world.drive(id, {to, loop, pace})` gives a living thing a place or a course of
  places, and the world's process steers it ten times a second (`rules/things.mjs` `step`): towards the next
  place, braking before a sharp turn, aiming a body's width beside a living thing ahead (by the other's own size)
  and waiting behind it where it cannot pass, stopping for a person on foot, backing out for a second when it is
  asked to go and makes no way. The rule hears `arrived`. What a person drives is theirs: a course waits. The
  world knows other things and people, not the street: kerbs and parked cars are met and backed out of. Checked
  by `test/course.mjs` (no page).
- **Nothing on wheels stays wedged**: a thing asked to go, by a rider at a page or a rule, that makes no way for
  1.5 s is set back on its wheels where it last went freely (a trail kept while it goes faster than 2.5 m/s),
  lifted a little, level, facing as it faced (`rules/things.mjs` `watch`). A person held W against a kerb for
  eight seconds with another kart on them; now the longest still is 1.5 s. In `test/course.mjs`.
- **The kept kart clears a low kerb**: its floor is three cells over the bottom of its wheels and its wheels reach
  six, so a kerb two cells high passes under it. With its floor at two it sat astride a rule's built kerb, was set
  back, and climbed it again.
- **The eye behind does not pass through walls**: from the head out to where the eye would ride, the first thing
  that stands (all but water and leaves) is as far as it goes, less 30 cm, with 20 cm clear round it; it comes in
  at once and goes out again over most of a second. With no room it is in the head, and the person's own figure is
  not drawn in its way. What will be in the way where the body is going in a third of a second brings the eye in before
  it gets there (`roomAfter`): walking in at a doorway it came in 2.2 m in one frame as the lintel passed over, now 0.36 m.
  The eye that rides is kept out the same way (`page/eye.ts`, #367): driven beside house
  fronts it was inside them for 70 frames of 166, and a frame drawn from inside a wall took 50 ms. For this the page's own thread's core is told of every edit (`tellCore` in `main.ts`), so
  `world_kind` there answers for what was built and broken too. `engine.me.back` says how far back the eye is.
- **A slowed world, tried**: with the clock at a quarter and the one who asked spared, she walks at 1.4 m/s as she
  did while the other page's person walks at 0.33, and what falls, drives, burns and flows goes at a quarter with its
  dust. The eye still turns freely for everyone. Not slowed: the town's residents (they go by the wall clock, the
  people lane's rule), rain and water's ripples, sound, and a rule's own tick.
- **Blows** (`rules/blows.mjs`, `bodies/living.rs` `ghost`). Everyone with a body (someone at a page, a seat, an
  actor) has a ghost in the world's core: a box put where they stand each time they are told of, which meets what is
  thrown, what falls and what drives, and goes nowhere itself. A rule hears `struck` (whom, by what, how fast, how
  hard, where, how high up the body), throws things (`world.throw`: from a body or a place, at someone or along a
  way; a ball of the core's, so it breaks what it hits and lies where it stops), pushes (`world.push`) and puts on
  the ground (`world.down`). Someone at a page is sent the speed a blow would give them and their own page gives
  their body that; they reel for a third of a second before their legs take them up again. Health is no word of the
  engine's: the check's rule counts blows in `world.keep`. `node test/blows.mjs [--out dir]`.
- **Shots read as shots** (`page/shots.ts`): any body that goes fast (over about 15 m/s) is drawn with a streak of
  light along its way and a flash where it sets out and where it stops or breaks. What a rule throws is gone where
  it stops (`stays: true` leaves it lying as cells). A ghost is carried on between tellings as its person was going:
  a runner's ghost was up to 45 cm behind them, and is now within a centimetre on a straight run and 7 cm round a
  tight ring (`node test/ghost.mjs`, no page).
- `node test/powers.mjs [--out dir]`: a rule that is no game sets numbers for whoever says so: quick, lighter, climb,
  wings, slow; out of range refused; an actor's body refused; taken out, all as it was.
- `node test/person.mjs [--out dir]`: alone (down, walk, run, the road's steps, jump, aside, stopped by brick that it
  does not break, the eye in the head, flying again), a phone's thumb, and a shared world (stopped by what someone
  built since, a seat told where the feet are, a rule whose actor follows them).
- **Not there**: the body meets the world's cells and, alone, the page's other bodies; in a shared world what
  falls, flies and drives meets its ghost in the world's process, so a blow reaches it a moment late and it does not
  block a car. Running and jumping
  are a walk's pose, quicker (the people lane's to draw). It cannot get on a living thing while on foot other than
  by E as before.

## Rules (#264)

What the people of a world do, and what a game in it is, is text: a script that someone or their model wrote, put
into a world while it runs. Nothing is built again and no page is loaded again.

```sh
node serve.mjs --port 5741 --world ~/.village/engine/world/try.log    # a world of your own; then open /city?shared=1
curl -s -X POST http://127.0.0.1:5741/world/ask -d '{"by": "me", "rule": {"id": "greeter", "name": "Someone who comes when called", "source": "on(\"start\", (world) => world.actor(\"guide\", {name: \"Odile\", at: [700, 4009]}))\non(\"said\", (world, e) => { if (/come here/i.test(e.text)) world.actor(\"guide\", {to: [e.at[0], e.at[2] - 28], pace: 30, say: \"Coming, \" + e.name + \".\"}) })"}}'
curl -s http://127.0.0.1:5741/world/rules      # how each rule is doing: running, calls, ms, what it got wrong
curl -s http://127.0.0.1:5741/world/           # the guide: everything a rule hears and may do
```

- **A rule hears and answers.** It says what it listens for with `on(name, fn)`: `start` (put in, put again
  changed, or the world started again), `said` (someone at a page or in a seat spoke), `tick` (twice a second while
  anyone is there). The handler is given a copy of who is there (`world.people`, `world.near`), its own memory
  (`world.keep`), and two things to ask for: `world.actor(id, {name, at, to, face, pace, look, say})` and
  `world.gone(id)`.
- **An actor is a body the world moves for a rule**, as a seat is one it moves for an agent: everyone sees the
  figure, a walk meets the world's own cells, what it says is heard within 30 m. A rule has at most 64.
- **Each rule has a thread and an interpreter of its own** (`rules/run.mjs`, `thread.mjs`, `box.mjs`): QuickJS as
  wasm with nothing bound into it (no timers, network, files or imports), in a memory the platform will not grow
  past 32 MB. The world's process never runs a line of a rule: it posts what happened and goes on with its clock,
  and what the rule answers comes back as a message, every field of which is checked (`world.mjs` `obey`) as an ask
  from anyone is. A call is stopped after about ten milliseconds of counted work; a call the clock says took over a
  second ends the rule's thread. A world has at most 16 rules. The server never runs a rule and never runs a model.
- **Changed while it runs.** Put again under the same id, a rule keeps its actors where they stand and what it
  kept. A rule that fails too often (five times running, or four times in five) is stopped, and says why in
  `/world/rules`; put again, it starts afresh.
- **Kept with the world**, as the asks that put it in and took it out. A world started again has its rules, each
  with its actors where they stood and what it kept (`<world file>.people.json`, written when it changes, two
  seconds behind at most): `start` is told `why: "restart"` and need place nobody who is there.
- **Moves and looks are data** (#218). `world.actor(id, {move, aim})` has an actor do something with its limbs:
  a move that has a name (wave, cheer, strike, kick, block, aim, fire, hit, fall, get-up, sit and more: the guide
  lists them) or keys of the rule's own (`{keys: [{t, liftR: 1.9, ...}], loop, hold}`: a pose is a number for each
  of twenty-one joints, and a key names only the joints it sets), laid over the standing, walk or run. `look` now
  takes things worn by name (`wear: ["suit", "tie #7a1c1c", "glasses"]`), something carried, and boxes of the
  rule's own on any part of the body. A body going faster than about 2 m/s runs and is drawn running.
  `page/moves.ts` and `page/wear.ts` hold the names, which are no more than data written down, and check what a
  rule sends. `node test/moves.mjs` checks it with a rule that is no game.
- **Getting about** (#218, `about.mjs`). A body the world moves walks straight while that is open and looks for
  a way round when it is stopped: a search over standing places 40 cm apart on the world's own cells, each step
  one a person could take (along, up a kerb, down a drop, up onto something waist-high with the hands). An actor
  follows someone (`follow: id, keep: cells`), keeps away (`flee`), and its rule hears `near` when a person comes
  within its `reach` or into a place the rule marked (`world.mark`), once in and once out. Seats get about the
  same way. Measured: round a parked car 30 places looked at in 15 ms the first time and 1 ms after; into a
  house (no way) 900 places in 27 ms, and not looked for again for three seconds. `node test/about.mjs`. Bodies the world moves do not
  pass through a person or each other: they go round, stop beside whoever stands at the goal and say who
  (`stopped`), and are placed a step aside when a place is taken. `node test/apart.mjs`. Someone whose down is not the world's
  (on a wall) is drawn standing by their own up on everyone's page: `node test/upright.mjs`. An actor takes the numbers
  a person takes (`world.actor(id, {jump, climb, fly, fall})`): it goes up a wall's face, leaps from a roof to the
  next, flies to a place in the air or after someone, and comes down from any height. `node test/able.mjs`.
- **A rule can take a resident of the town as its own** (#218). `world.residents` is who of the town's own people
  is within 32 m of someone, by ids that stay the same; `world.actor(id, {take: residentId})` makes that one the
  rule's actor where they stand, the same figure in the same step on every page; `world.gone(id)` lets them walk
  back to their round. So "the one you spoke to changes, and then the ones you pass" is a rule taking residents.
  The world's rules hold at most 128 between them. A rule reads what a resident looks like (`look`), adds to it or
  gives it back (`look: null`), and shows no name over a head (`name: null`; a taken resident has none until given
  one). `world.them` is whoever a call is about. `node test/taken.mjs` checks it with two pages.
- **A model writes one** (`make/rules.mjs`, the asker's own Claude Code on their own machine):
  `node make/rules.mjs "a busker who plays when someone stops to listen" --world http://127.0.0.1:5741 --at 700,155,4060`.
  The model is told what a rule can hear and do in the guide's own words, taken from the server each time, and
  answers with the rule and with what it could not do with what the engine offers (kept in
  `~/.village/engine/cannot.jsonl`: the engine's to-do list). Before the rule is put anywhere it is tried in a world
  of its own (this build's server and world process, started for the trial): someone stands where the asker stands,
  says things, walks about, the clock runs, and what that world says of the rule is read. One that does not start,
  goes wrong, is slow or puts its people far from the asker is sent back with why, up to three times; after that
  the one that ran best is put in and said to be rough. `--change id` changes a rule that is there: it keeps its
  actors and what it kept. `node test/rulewrite.mjs` checks this with kept replies (no model). Real runs, November
  13, Opus 5.5: seven asks that are not alike (a busker, a game of tag, and the five realms of #264), seven rules
  that ran on the first asking, 41 to 121 s each.
- **A director** (`make/director.mjs`; the world's side is in `world.mjs`, "The director"). A realm may keep a rule
  under the id `director`: it watches how each person at a page plays and stirs things up for them. The world lets
  it work only while the realm's record says `director: true` and someone's model answers for the world; otherwise
  it rests (told nothing, what it put into the world gone, the rule and what it keeps still there), so a realm with
  no helper running is the realm as its other rules make it. It is written by the asker's own model with the
  realm's record and its other rules in front of it: `node make/director.mjs --world http://127.0.0.1:5741/realm/<id> --first sonnet`.
  In the page: the new-realm flow asks "With a director?"; "director on", "director off" or the Director button
  turn it at any time (no model); "director: fewer strangers, more trouble" changes it. `node test/director.mjs`
  checks the rest and the waking with a stand-in voice (no model).
- **A rule that asks for a rule** (`plugins/write`): `world.write({ask, for, rule})`. A rule says in words how
  another rule of its world should change, or what new one there should be, for someone at a page; that person's
  page asks their own helper as if they had typed it, so the same writer writes it and the same trial tries it. It
  is how a director makes the game itself grow. Once in five minutes for one person and for one rule.
  `node plugins/write/check.mjs`. Real run, November 14: a rule heard a word, the player was told after 1.1 s, and
  the realm's own rule was rewritten by Opus 5.5 in 133 s on the first asking.
- **A change to a game that is being played** (#365; `make/rules.mjs`, the helper's `/rule`). In a realm, "from
  now on ...", "add ...", "let me ..." change the realm's own rule: the one its record names, or, in a realm whose
  record names none, the one rule that is neither `place` nor `director` (then written into the record). The
  writer has that rule's text and the realm's other rules by name, and answers with a few exact edits (`EDITS:`,
  old lines and new) and a sentence for the player (`CHANGED:`); everything outside the edits stays word for word.
  The changed rule is tried over the rule as it stood (the old one is put into the trial's world first), and one
  that does not hold is not put in: the game stays as it was. The player is shown what changed. "undo" in the bar
  puts the rule back as it was before (the world's own record keeps every version, read from `/world/stream`; no
  model): the last change someone asked for, even if the game grew a step by itself after it. "undo" again
  brings the change back. Real run, November 14, on a copy of a 32,156 character game
  with a place and a director beside it: the same change that had become a fourth rule that morning was 56 changed
  lines of the game's rule, in 117 s (Opus 5.5 asked twice, 82 s; two trials, 34 s). Written again whole it took
  400 s and three askings. A rule may now be 65,536 characters.
- **A game that arrives sooner** (#365; `make/rules.mjs` `write` with `first`). The quick model's first rule is
  put in, and the full model then makes it everything that was asked a step at a time: each step is a change as
  above (edits, tried over the rule as it stands, not put in if it does not hold), what would be missed most
  first, at most eight, until the model answers `COMPLETE`. Each step is told what the player has asked to have
  changed meanwhile, and is put in by `growing`, so the world's record tells a step from a change someone asked for. A change the player asks for takes the next turn
  between two steps (the helper keeps one line of turns for each world). Real run, November 14, the owner's Matrix
  from the bar with a director: the place at 50 s from Enter (25 s in the run before), the first rule at 149 s,
  steps in at 253, 353, 425, 488 and 628 s (the cap was five then, and the fifth still added things); someone standing in it was never put down and kept flight and their
  cards through every arrival. Written again whole, the fuller rule came at 619 s (750 s that morning) and
  replaced the game at once. The first rule's wait is the quick model: 60 to 78 s for about 180 lines, half of
  it thinking, which `--effort` did not change (tried: default 71 s, medium 61 s, low 68 s).
- **From the ask bar** (`page/making.ts`, the helper's `/rule`, `/imagine`, `/realm`). Words decide what is asked
  for. "Create a realm called harbour. You are the pilot. ..." is a realm: the asker chooses to be asked a few things first
  or not, the idea is fleshed out by their model (`make/realm.mjs`: what it is about, how it looks, at most three
  short questions, read as strict data), the realm is made on the server (`POST /realms`), its rules are written,
  tried and put into it, and the page offers to step in (today by opening the realm in place of this world: the
  portal is the REALMS lane's). Words that say what happens ("someone who waves when I say hello", "a game of tag",
  "let me fly", "give them all red coats") are a rule for the world the asker is in; in a realm with one rule they
  change that rule, put again under its id, so its people and what it kept stay. A question, a greeting, or words
  that begin as talk does are said to whoever is there. In a world that has rules everything typed is said first,
  so that its rules hear a power asked for in the asker's own words ("I want to fly", "slow time"), and only words
  that plainly ask for a thing ("make a ...", "a red door") or for a change ("add ...", "change ...", "from now
  on ...") go to a maker; "give me a sword" and "I need guns" are asked of someone and are said there too. Elsewhere anything else is a thing, as before; `thing:` or `rule:` before the words says which. What is asked for from a page in a realm is made in that
  realm. An ask may be 4,000 characters; past that the asker is told. Real run, November 13 (Opus 5.5 for the
  rules, Sonnet 5.5 for the idea): the first realm of #264 from the bar, asked one question back after 7 s, ready 138 s
  after Enter, stepped into; inside, a resident answered "hello there" and another the question about the world;
  "give them all red coats" changed its rule in 41 s. Pictures: `~/.village/engine/making-ui/realm-first/`.
- **Quick first, fuller behind.** Where the time goes was measured (November 13, the first realm of #264 in the
  owner's words): it is the model writing. Opus 5.5 took 200 s for its first reply and Sonnet 5.5 took 54 s; the
  trial is 7 to 14 s. So a realm's rules are written by the quick model first and the realm can be stepped into
  (142 s from Enter, where it had been 247 to 268 s); the full model is then asked for the fuller rule as a change
  of the quick one and it is put under the same id when it has been tried (319 s later in that run), unless
  someone changed the rule meanwhile, whose change stands. The trial talks no faster than a person does: both
  models' first rules had failed it for asking an actor to think twice, which nobody would have caused.
- **What a person types is something heard.** `e.text` and names reach a rule as text to match or to pass on.
- Measured (M1 Pro): 0.4 ms a call for a rule with one actor; 1.5 ms for one that compares every pair of 66
  people; sixteen rules are running 0.2 s after they are asked for and take 18 MB each; with rules that never
  return, fill their memory or stall inside the interpreter, the world answers a question within 7 ms.
- `node test/rules.mjs` checks all of it against the real server: a rule that is no game, changed while it runs,
  kept over a restart; rules that never return, take all the memory they can, stall where no count reaches, flood,
  or reach for bodies that are not theirs.
- **What a realm puts in a person's hands** (`rules/hands.mjs`, `page/hands.ts`). A rule offers things to do:
  `world.offer(id, {word, hold, aim, key, to})`, a word to show, whether it is held or tapped, whether it is aimed,
  a key it would like, and who it is for. The page makes each a key and a button (a phone's to touch), and an aimed
  one an entry of the wand's wheel beside the spell in hand; nothing in the page knows what any of them means. When
  someone does one, the rule that offered it (and no other) hears `act`: who, which, tap or down or up, and `met`,
  what was straight ahead of their eyes: cells, nothing, or someone's body (a person at a page, a seat, an actor),
  which the world's process finds because it knows where everyone stands. `node test/hands.mjs` checks it with two
  rules that are not alike: a stall that sells to whoever looks at its keeper, and someone to wave at for as long
  as the wave is held, offered to one person. Residents are not met by an aim yet (they are not bodies of the world's).
  Whose each letter key is (the page's own, the page's but given way to an offer that asks, or free to hand to one
  that asked for none) is one list, `page/keys.ts`, read by both sides; `node test/keys.mjs` checks it against the
  page's code, with no page.
- **Holding a thing** (`rules/holding.mjs`, `page/hands.ts`). A made thing looked at from within six metres is
  picked up with G (a button on a phone) and put down with G where the eye looks. Picked up, its cells leave the
  world in one edit and the holder's figure carries it in the right hand, as up to eight boxes cut from its cells
  along its longest way (`look.carry`, the PEOPLE lane's); put down, the cells go back standing on what is there,
  into air only. A person holds one thing and a thing is one person's. A rule hears `held` and `put`, is told on
  `act` what was in the hand (`e.using`), sees `holds` in `world.people`, and may `world.give(person, {thing})`
  and `world.take(person)`. Whoever leaves puts theirs down where they stood; a world started again stands a held
  thing where it was taken from. From a page of your own: `engine.hands.take(id)`, `engine.hands.put(at?)`.
  `node test/hold.mjs` checks all of it with a lantern and someone who minds it.
- **The holder's own view** (`page/held.ts`). With the eye in the head (V), or flying as an eye with no body, the
  thing itself is drawn before the eye from its own cells: low and to the right, its near end a hand's reach off,
  its longest way pointing where they look. With the eye behind their own figure, the figure carries it as
  everyone else sees it. A thing over 1.4 m is drawn smaller, as in a figure's hand.
- **Throwing what is held.** `world.throw({from, to or at, speed, tag, held: true})` throws what `from` holds in place
  of a ball: the thing leaves the hand as a body of its own cells (a living thing made of them, pushed and let go
  of at once), strikes and may break as anything thrown does, and lies as cells where it stops. Every rule hears
  `thrown`; the rule that threw it hears `landed` with its tag. Thrown, it is no longer a made thing: its record
  goes, because it lies turned and maybe broken wherever it came down, and nobody can pick it up again.
- **A person throws what they hold, with no rule offering it.** Whenever a hand is full the page offers `T Throw
  <name>` beside `G Put down`: the thing goes where the eye looks, a little above it, as fast as a good throw by hand.
  The ask is `{throw: true, to}` to the world, which answers it as it does a rule's `throw` with `held: true`. No
  rule threw it, so every rule hears both `thrown` and `landed` (tag `own`). A rule may still offer a throw of its
  own; no rule's offer is given G or T.
- **A conjured thing arrives in the hand.** `world.make({wish, for, hold: true})`: the page of the one it is for has
  it made by their own helper and model, and picks it up as soon as it stands; the rule hears `held` with the
  thing's id. A hand that is full puts down what it held, at its owner's feet, before it takes another: nobody is
  told no. `node test/conjure.mjs` checks it with a kept reply; a real run (November 14: Sonnet wrote the rule from
  the guide in 13 s and used `hold: true` unprompted; "a sword" was made by a model and in the hand 12 s after it
  was said) is in `~/.village/engine/wand/conjured-real.png`.
- **What a realm shows** (the same two files). `world.show(id, {line, meters, score, choice, to})`: a line of words,
  up to four meters (how full, of how much, in a colour), a score (a number or a few characters, with a label), and
  a choice of up to six picks, to one person, several or everyone. They are the rule's own words and numbers: the
  engine has no word for health, an alarm, laps or rounds. The page draws each as a card in one panel of `hud.ts`,
  every word put as text (markup a rule shows is words on the screen), and a pick reaches the rule that shows it as
  `pick`: who, which. Checked in `test/hands.mjs` with a kettle that shows how near the boil it is and asks whoever
  wants tea how they take it.
- **What a realm sounds like** (`plugins/sound`, `page/sound/likes.ts`). `world.sound({like, at, on, force, size,
  note, notes, gap, for, reach, patch})`: a rule makes a sound at a place, on one of its actors or on a person, and
  everyone near hears it as the world's own sounds are heard (placed, later by its distance, duller far off).
  `like` is one of 23 kept sounds by what they are like (a blow, a shot, a bell, a cheer, a strum, a whistle...);
  `patch` is a sound the rule wrote itself, in the synthesiser's own form, read by the same check on both sides.
  `notes` with a `gap` is a chord strummed or a tune. Twelve a second from one rule, eight notes in one, a held one
  four seconds; what is wrong is left and said to the rule. `node test/sounded.mjs` checks it with a tower clock, a
  smith and his anvil, and a rule that sends what none should; a real page's sound is tapped and measured. Asked for
  a busker and a night watchman, a model wrote rules that play (November 14, both on the first asking).
  **A sound that follows** (`as`): `world.sound({as: 'motor', on: who, like: 'engine', note})` is said once and stays
  on an actor, a person or a thing that lives, heard moving with them; said again by the same name its pitch and
  loudness glide in the note that is sounding; `{as, stop: true}` ends it, and it goes when its maker or the rule
  does. What is struck follows by being made again (`every`, ms). Six a rule, 24 a realm, the six nearest sounded on
  each page. `node test/follows.mjs`: a milk float drives past a still listener (begun once, one side then the
  other, loudest as it passes, nothing stepping), a postman's feet, a hum on oneself, a living car's motor, and
  each ending. A held tone moved while it sounds is `place` in the synthesiser (`test/sound.mjs`).
- **A realm's music** (the same files, and `page/sound/music/`). `world.music({like, pace, mode, drive, now})`: a
  rule says what the realm's music is like and changes it as its own numbers change. It is a mood, not a track:
  `like` is one of the seven kept moods, `pace` and `mode` put it at another speed and in another scale, `drive` is
  how much of it is playing; both change at once in the piece that is playing. A new mood or mode comes in at the
  next bar, or the next beat with `now`. `like: null` gives the music back to the place; so does taking the rule out. A realm
  that says nothing keeps the place's own. `node test/tuned.mjs` checks it with a lighthouse whose music fills as the
  rule's wind rises, and a dancing class that sets pace and mode by what is said; a page that joins later plays what
  was last said, and what is heard keeps the pace asked. A model asked for a storyteller wrote one whose music
  follows how far her story is (November 14).
  **A lean** (`world.music({lean, for})`): any rule pushes the music up or down for a while without having it,
  on top of the realm's rule's music or the place's own (more or less of it in, up to an eighth faster or slower),
  and it falls away by itself. Each rule has one; several are added and held to -1..1, so none is lost. Checked with
  stage hands who lean by what is said to them, and on a page: the piece playing thins and slows and comes back.
- **A rule builds** (`plugins/build`, `rules/built.mjs`). `world.build(id, {at, parts})` puts a place into the
  world's own cells: parts are shapes as data, in the engine's materials and colours (a made thing's: `make/form.mjs`).
  `box`, `room`, `wedge` and `steps` are level, measured from the ground at `at`; `line`, `loop`, `ring`, `disc` and `posts`
  lie on the ground under each column, so a road follows rolling land and a rail hung over it stays one piece. Later
  parts replace earlier ones and `air` cuts, into the ground too. What is built is the world's like any edit: echoed
  as an ask is, so it is kept in the world's file and applied by every page, and it breaks, burns and falls.
  `world.build(id, {clear: true})` takes it away and puts back what it replaced; taking the rule out does the same.
  The world's process remembers what each build replaced, and when a world starts again it reads that from its own
  history (each kept edit says whose build it is, and is read just before it goes in). Put back: every cell that is
  still what the build made it. Left: what was broken since, what another build holds, and the columns someone at a
  page stands in. A build is whole or not at all: refused in words (and heard as `built` with `failed`) if a part
  is not the form's, if it is over 1,000,000 cells, 60,000 rows or 3,000 cells from `at`, if something that lives is in or right over a cell it changes (for someone at a page it waits until they step away), or if it would change another rule's build (laid over the rule's own earlier build, the cells pass to the later one, with what was there before either). A rule has 16
  builds and a world 64. Asked for again as it is, nothing is done, so a rule builds on every `start`; with other
  parts, the old is taken away first (a gate opens). Actors and seats standing there are stood again on what is
  there. Form decided by trial (November 14, Opus 5.5, four real runs): shapes against boxes alone (the nearest a
  model can write to raw rows). A ring with ropes and a stand: shapes 37 s on the first asking, boxes 91 s on the
  third. A kart track on sloping open ground: shapes 44 s on the first asking; with boxes alone 417 s, and its model
  surveyed the ground with 325 looks and asked for "a way to lay cells along a line or a curve". Measured (M1 Pro):
  a track 170 m round, 8 m wide and four cells thick is 535,000 cells in 25 edits and 2 MB of the world's file; the
  world answers a question within 260 ms while it is laid and within 100 to 260 ms while it is taken away. What
  could fall is asked of the core a tile at a time between the world's other work (60 ms a tile: asked all at once
  a fenced track held the world 1.6 s). `node plugins/build/check.mjs`: a road mender and a carpenter, neither a
  game. **Known**: a road thinner than four cells shows in stripes from far off, and any road does from high above
  (coarser copies of the world take one cell in 2, 4, 8 of an edit, and the ground's top is not always the one
  taken); a build stops the world's clock for up to a quarter of a second.
- **A rule knows the ground** (`plugins/ground`). `world.ground(id, {at, within, grid})` asks for the lie of the
  land over an area and hears `ground`: a grid (9 a side unless said) of how high someone stands at each column
  (under water, the bed: the water's surface is at 0), what the ground's top is made of, and how high what stands
  there reaches, with what it comes to (lowest and highest, how much is water and how much clear, which part of the
  town). `world.ground(id, {find, near, room, flat, within})` asks where the nearest ground of a kind is with room
  to build: `open`, `grass`, `sand`, `rock`, `shore` (low open country with 300 m of open water beside it, and
  which way the water lies), `street`, `high`, `water`. Every realm is the same planet, so a track belongs on the
  plain and a beach on a shore, kilometres from the town. What the land's own rule says is asked first (quick),
  what stands there is read from the world's cells (so what was built or dug shows), and both are worked a little at
  a time between the world's other work. Measured (M1 Pro): a find that succeeds 30 to 210 ms of work, none that
  held the world over 5 ms; a survey of 81 columns about 80 ms of work (a column read from the cells makes its
  sector, 0.3 to 1 ms). Real runs (November 14, Opus 5.5, five; each rule ran on the first asking): a pier and
  huts on a shore 3.6 km off, a kart track on the plain 4.3 km east, a stone hut 527 m up in the mountains 7.9 km
  north, four stalls in the home street set between its cars. The first track rule read "20 km" and asked within
  20,000 cells, so found nothing: the guide now gives every distance in cells. `node plugins/ground/check.mjs`: a
  surveyor and a lighthouse keeper. `survey` and `find` are plain functions of a core's exports (the maker uses
  them to say where a realm is). The core gained `top_at` (the ground's top by the land's rule, no sector made) and
  lost a fault: a sector all of one kind, asked for after 4,096 others, was dropped as it was stored and the read
  of it failed (`bodies.rs` `store`; a core test holds it).
- **A place from words** (`make/realm.mjs`, `test/place.mjs`). A realm asked for from the bar gets ground of its own
  and is built there. The idea (the quick model's) now says where the realm belongs, `place: {land, room}`: a
  street, sand, grass, a shore, high ground, open country, and how far the place reaches. The maker finds that
  ground from the land's own rule (`plugins/ground` `find`, with this build's core: 40 to 970 ms; a shore of sand
  before any other), makes the realm with `arrive` on dry ground at the place's edge looking at its middle, and
  tells whoever writes the rules where the middle is, how the land lies, where the sea is and where people arrive,
  with "build nothing tall between there and the middle". The rule builds the place on `start` with `world.build`.
  A realm whose idea names no place is made as before. Real runs, November 14 (Sonnet 5.5 for the idea and the
  first rules, as the bar does it; five realms, 13 model replies): a boxing match (a ring with ropes and stands of
  fans in a yard of the town, ready 170 s after Enter, second asking); a kart racer (a circuit, a grid of karts and
  a stand on the plain 4.5 km east, 256 s, first asking); Normandy (a first try on a grass shore took three
  askings and 563 s; with a beach preferred, landing craft in the surf, obstacles, bunkers and gunners on a bluff,
  377 s, first asking); Sonoma (a fenced circuit, cars on a grid, pit crews and two grandstands of people, 376 s,
  first asking). A realm took 83 to 300 s before: a place costs about one to four minutes more, nearly all of it the
  model writing a longer rule. Pictures: `~/.village/engine/build/unit3-a-place-from-words.png`. What the models
  still could not build: a hollow room that is safe to walk into (a bunker to storm); water where there is none;
  a part of a build that can be driven through or hidden at once (item boxes); a build that says when it is
  touched; lights. And around the place: nothing moves someone at a page to a spot in it.
- **The place before its rule** (`make/plan.mjs`, `test/place.mjs`, `test/placed.mjs`). The wait for a realm was
  the model writing its rules: 170 to 377 s from Enter before there was anything to stand in. A place needs no
  script, so it is asked for by itself, as data, from the quick model, beside the idea: what land, how far it
  reaches, and its parts in the shapes `world.build` takes, in a frame of its own (people arrive from the south
  looking north; on a shore the sea is north). The engine finds the ground, turns the plan by quarter turns to lie
  as the ground does, reads every part as a stranger's (a part that is no shape is left out and said; a colour
  written "hue:0:4" and a material called rubber are read; a road too big to lay four cells thick is laid one
  thick) and puts it into the realm as a rule of its own, id `place`, written by the engine with the parts in it
  as JSON. The page is told (`placed`) and offers "Step in" then; the people and the game arrive after, in a rule
  of their own that is told what stands and not to build it again, and is tried in a world that has the place in
  it. Real runs, November 14 (Sonnet 5.5 for idea, plan and first rules; the same four realms, 12 replies), from
  Enter to standing in the place, before and after: a boxing match 170 s, now 18 s; a kart racer 256 s, now 22 s;
  Normandy 377 s, now 23 s; Sonoma 376 s, now 22 s. The plan takes the model 17 to 22 s; finding the ground and
  building it under a second. The people then arrive 131 to 266 s after Enter (they were the same wait as the
  place). Haiku 5.5 planned no faster (21 to 26 s) and thinner (6 to 18 parts against 17 to 37). Pictures:
  `~/.village/engine/build/unit4-the-place-first.png`.
- **The fuller rule landing while someone stands there** (played November 14: a boxing realm, a person on foot in
  its ring at a real page; the fuller rule, Opus 5.5, landed 762 s after Enter). Nothing happens to the person: not
  dropped, buried or moved. What holds it: the place is a rule of its own, so the game's rule put again changed has
  none of it to rebuild (`test/place.mjs`: the place's rule is not even called); a build asked for again as it is
  does nothing; and nothing is ever built into or from under someone at a page. What was wrong: a build that was
  refused because someone stood there stayed refused, so a place put again changed with a player in it never came.
  Now it waits (`built` says `{build, waits}`) with its cells already worked out, is tried again every two seconds,
  and goes in whole when they have stepped away: in the same play, the ring's floor put a metre higher waited
  while the person stood on it and was there nine seconds after they left.
- **Rooms** (`plugins/build`, the shape `room`). `["room", material, colour, x0, y0, z0, x1, y1, z1, door, wall?]`
  is a hollow box to walk into: walls and a roof `wall` cells thick (3 unless said), a level floor carried down to
  the ground, the ground that stood inside taken out, and a doorway 12 cells wide and 21 high in the side named
  (`"none"` for none); windows and slits are cut after it with boxes of air. The roof holds: built of each of
  wood, concrete, brick and steel at 4 by 4 m, 8 by 6 m and 16 by 12 m on sloping ground, every roof stood; where a
  roof is wider than its material reaches from a wall, posts are put inside in rows. `node plugins/build/check.mjs`
  builds a lodge and has someone walk in through its doorway and stand on its floor. A place's plan uses it at
  once: asked for Normandy the quick model built four concrete bunkers and two houses as rooms, and for Sonoma two
  pit garages. A shore's place is now measured from up the beach (its middle moved inland to stand 80 cm clear of
  the sea): the first bunkers were built at the water's edge and stood flooded to the door. Also read: a cut
  written as a shape of its own (`["air", ...]`). Pictures: `~/.village/engine/build/unit6-rooms.png`.
- **Not there**: a rule hears nothing of blows or of what a model made of what was
  said; it cannot change what a person's own body can do, throw anything or slow the
  clock. #264 says which of these come next.

## Realms (#264)

One server keeps many worlds. Each is a realm: the same planet by the same rule, with its own file of what was done
there, its own rules and people, a place where one arrives and a look of its own. One of them is home: the world of
`--world`, which `/world/…` and `?shared=1` have always meant and still do.

```sh
node serve.mjs --port 5770 --world ~/.village/engine/realms/try/home.log    # realms are kept in ~/.village/engine/realms/try/home.realms/ (or --realms dir)
curl -s -X POST http://127.0.0.1:5770/realms -d '{"by": "me", "name": "A grey dawn", "about": "a quiet street before anyone is up", "arrive": {"at": [9000, 4070], "yaw": 1.57}, "look": {"hour": 6.2, "rain": 0.3, "tint": [0.9, 1, 0.95]}}'
curl -s http://127.0.0.1:5770/realms                               # every realm: {id, name, about, arrive, look, home, awake, pages}
curl -s "http://127.0.0.1:5770/realm/a-grey-dawn/world/at?x=700&y=154&z=4070"   # everything /world/… is, of that realm
curl -s -X DELETE http://127.0.0.1:5770/realm/a-grey-dawn          # takes it out: the file is moved to gone/, not destroyed
```

Then `/city?realm=a-grey-dawn` is a page in that realm, as `/city?shared=1` is a page at home.

- **A realm is its file.** The file is the asks done to that world, and the `realm` asks among them say what the
  realm is: `name`, `about` (the asker's own words), `arrive` (`{at: [x, z] or [x, y, z], yaw, pitch}`, cells and
  radians) and `look` (`{hour, rain, grade: [colour, contrast], tint: [r, g, b]}`). A file put into the realms folder
  is a realm when the server next starts; the server reads what each is without starting it. `POST
  /realm/<id>/world/ask {"realm": {"look": {"hour": 7}}}` changes only what is given, and every page there is told.
- **A process each, only while needed.** A realm starts when it is first asked anything and is stopped when nobody
  has read its stream or asked it anything for `--idle` seconds (300) and nothing in it moves, burns or flows. At
  most 16 are awake at once (an idle one gives way) and a server keeps at most 64. What was done to a realm is in
  its file; bodies in seats, actors and what rules kept are lost when it rests, as they are when a server restarts.
  `GET /realms` and `GET /realm/<id>` never wake one.
- **What one costs** (M1 Pro, `node test/realms.mjs --measure`, the middle of three runs): 15 to 21 MB of the
  server's memory a realm awake with no rules (home alone 208 MB, with ten more 359 to 382 MB); with one rule in
  each, whose thread is the realm's too, 33 MB for the second and 19 MB each over ten. From asking a sleeping realm
  to its first answer: 45 to 185 ms, with or without a thousand edits or a rule in its file. A realm that rests
  ends its rules' threads with its own (the server's threads counted: 13, 15 with a realm of one rule, 12 at rest).
- **The helper is given a realm's address** to make things there: `node helper.mjs --world
  http://127.0.0.1:5770/realm/a-grey-dawn` (it builds `…/world/ask` from what it is given).
- Every new address refuses a request whose `Origin` is another site's, as `/world/…` does. Nobody is asked who
  they are: whoever can reach the server can make a realm and take one out.
- `node test/realms.mjs` checks it with plain requests against the real server: what is done in one realm is not
  done in another, start on need, rest when idle, kept over a restart, taken out, refusals.
- **Making a realm from words** is the maker lane's: its seam on the server is `POST /realms` (a name is enough;
  then rules and things go in through `/realm/<id>/world/ask`).
- **A page steps between realms with no loading** (`page/realms.ts`): `engine.realms.step('a-grey-dawn')` from
  the console (the portal and its keys are next), `engine.realms.list()` for what there is. The line to the world
  (`page/link.ts`) opens the other realm's stream and holds it while the page goes on in this one (`ready`), then
  goes over at once (`go`): living things, bodies, made things and people of the old world are put away, the
  sectors that either world's edits reach are made again and no others (`world.ts` `swap`: both are one planet),
  one arrives where the realm says, and the address then says `?realm=`. `/city?realm=id` loaded straight
  arrives there too.
- **A realm has one hour.** Its `look.hour` is the hour of the day there for the world's process and for every
  page: the town's residents are out by it in both (few at three in the morning, many at noon), whatever hour a
  page shows with its own keys. A realm that says none has them out as at eleven. So a rule takes only residents
  that every page there draws.
- **A realm's look is shown on arrival and whenever it is changed**: its hour and rain as the keys would set them,
  its `grade` in place of the hour's own, its `tint` multiplying the finished picture (`page/glow.ts`). A realm
  that says nothing of its look is shown as the page was opened.
- **What a step costs** (M1 Pro, 1280 x 720, `node test/step.mjs`): reading a realm's history of 630 edits 1 to
  11 ms (a sleeping realm the same: its history is read from the file, its process wakes beside), going over 25
  to 30 ms. Then the sectors: a step in place makes 15 to 17 of them, 28 to 49 ms in all; a step 900 m away makes
  10,300, with a picture of the place that has nothing missing after 1.1 to 1.4 s and everything sharp after 2.1
  to 3.3 s (six workers; 3.5 s with four, 2.1 with eight). That far step is the loading a portal must hide, by
  making the other place before one steps.
- `node test/step.mjs` checks it in the real page: no navigation, the stream, edits, made things, a living thing
  ridden as the step is taken, people and a rule's actor, the look, the arrival, asks landing only where the page
  is, a body on foot standing on the cells of the realm it is in, and back.
- **The portal** (`page/portal.ts`): **P** (on a phone, the Portal button) opens a window before you to the
  selected realm (`engine.realms.selected`; from a realm, to home) and closes it; in a realm, the window you came by
  is not closed but stood again before you, still leading home, so one press is a way home. It stands on the ground
  where there is room and a clear walk to it (three or four metres off, nearer when something stands in the way,
  else round to the side or further out, up to seven), facing you, three metres wide and four high, and leads to where one enters that realm: where you
  last left it, else its `arrive`. It opens as the other place is made behind it: light until every box of that
  world is whole over half its width, growing meanwhile, then clear. Through it the other realm is seen live, with
  the people who are there. Walk through and you are there, on your feet, the window leading back; turn round and
  walk back through the same window. Near the window a person on foot sees with their own eyes (the eye that rides
  behind them would be in one world and their body in the other).
- **What it costs** (M1 Pro, 1280 x 720, `node test/portal.mjs`, the GPU shared with other lanes' checks): the
  window is clear 1.7 to 2.0 s after the key and all of the place made after 3.6 to 4.2 s, the page's longest frame
  meanwhile 17 to 33 ms; opened again to a place still held, 0.35 s. Walking through: 20 ms to go over, everything
  made 35 to 75 ms after, the longest frame 17 to 33 ms, and 60 frames a second after (the sun's maps go with the
  worlds). The window is drawn at fewer pixels the more of the picture it covers: all of them up to 12% of the
  picture, three quarters up to 30%, half beyond. 300 MB more of the GPU's memory while one has been opened.
- `node test/portal.mjs --out dir --clip` checks all of it in the real page with real keys, and keeps pictures and
  a film; `--bench` prints the GPU's time for a window of each size.
- **The wheel** (`page/wheel.ts`): **Tab** (or the Realms button) shows the realms the server keeps round a ring,
  home first, then the newest, each by its name, when it was made, and the last picture this browser had of it (kept small every five seconds while
  the page is there; a realm never seen has a colour from its look). The one the portal's key leads to is marked,
  and where you are says "here". A number, a click, or the arrows and Enter pick one: it becomes the selected realm
  and a window opens to it at once, in place of any that is open. The last entry (0) is a new realm: it opens the
  ask bar with "Create a realm called " begun, which is the making lane's flow; when the realm is ready, "Step in"
  opens a window to it (`engine.portal.lead(id)`), where it used to load the page again. Things asked for are made
  in the realm the page is in now. `node test/wheel.mjs` checks it with real keys.
- **Not there yet**: only the other realm's cells and people are seen through
  the window (no living things, water or fire), unturned, unheard; others do not see your window (to show them its
  view would take a second world on each of their pages; a plain lit frame would be cheap and is not built); a
  phone has the button but its 128 MB pool may not fit twice, so it would need a smaller world behind the window
  and a step that makes the place on arriving.
- The helper makes things only in the realm the page
  was opened in (it is started for one world), and the ask bar says so elsewhere. The realm left behind shows the
  page's figure for five seconds more. Sound follows the stream but its change is not checked by itself.

## Engine plugins (#264)

A rule is text from anyone, run in a box. An engine plugin is the other kind: something new a rule can hear or do,
written as the engine's own code, and picked up by a game while it runs. Nothing is started again and no page is
loaded again.

```sh
node serve.mjs --port 5801 --world ~/.village/engine/workshop/try.log   # a game; open /city?shared=1
# ... add or change a folder under plugins/ ...
node plug.mjs --port 5801                 # the running game looks again: says what rules can now do, and how long it took
curl -s http://127.0.0.1:5801/plugins     # what is in, and why anything is not
node plug.mjs --port 5801 --at <checkout> # for a game served from a checkout of its own: brings it (or, if main changed more than plugins, its plugins folder) to origin/main first
```

- **A plugin is a folder**, `plugins/<name>/`:
  - `world.mjs`, one file: `export default (world) => ({ does: { name(rule, want, now, wrong) {} }, dropped(ruleId) {}, state() {}, close() {} })`.
    `does` is what a rule may ask for (`world.<name>({...})` in a rule arrives as `want`: check every field as a
    stranger's). `world` is the doors it is given: `folk` (everyone with a body), `text`, `tell` (a body, to pages),
    `release`, `look`, `stand`, `tall`, `builds` (what rules have built: `rules/built.mjs`), `living(id)` (where a thing that lives is, or null), `core()` (the core's exports as they are now: ask each time), `happen(event, e)` (every rule that listens hears it), `hear(ruleId, event, e)`
    (one rule hears it), `pages.state(v)` and `pages.once(v)` (to its page side), and `was` (what the version before
    handed on through `state()`).
  - `page.ts`, if a page needs anything: `export default ({ engine, link }) => ({ state(v) {}, once(v) {}, close() {} })`.
    `state` is what is so (given again to a page that joins later and to a new version; `null` when the page steps to
    another realm), `once` is something that happens now, `close` takes away whatever it put on the page. To draw in
    the picture it adds a pass, `engine.draws.add(name, (encoder, to, view, time) => {})`: called every frame after
    the world, its people, crumbs and smoke and before the wand's marker, with the frame's commands, what is drawn
    to (colour and depth) and the view; `engine.draws.remove(name)` on `close`. A pass that throws is taken out.
  - `guide.txt`: its lines of the guide. The guide (`GET /world/`) is put together from the plugins that loaded, each
    time it is asked for, so a model writing rules is told of exactly what is there.
  - `check.mjs`: its check, against the real server (`test/plugkit.mjs`). `node test/plugged.mjs` runs every
    plugin's; one with no check or no guide fails.
- **Where the code comes from.** The plugins folder of the checkout the server runs from, and nowhere else. `POST
  /plugins/look` carries nothing: it has the server read that folder again. No request, no rule, no model's reply
  and nothing a person types can become a plugin. For a game that others reach, the folder is a checkout of
  `origin/main`, and `plug.mjs --at` moves it there only when plugins are all that changed.
- **How it is picked up.** The server hashes each side's text. Each world's process imports what changed (the hash
  makes the module new to Node), hands the old version's `state()` to the new one, and swaps the entries of `does`;
  rules being started wait for a load that is under way. Pages are told through the stream (frame 11) and import
  `/plugins/<name>/page.ts?v=<hash>`. A plugin that does not parse, takes a name that is taken, or imports a file
  from its own folder is not let in: the version that was there goes on, `GET /plugins` says why, and the guide
  leaves it out.
- **Measured** (M1 Pro, `node test/plugins.mjs`, a page open and a rule running): told to look, a world's process
  has two new plugins in 1.5 to 2.3 ms (0.3 to 1 ms each); the rule uses the new thing 70 ms after the folder landed
  (that is the check saying a word to the rule); the page shows it at 72 ms, its import 12 ms. A changed plugin,
  both sides, is in and shown 14 ms after the look.
- **There now**: `plugins/ground` (`world.ground`: the lie of the land over an area, and where there is room of a kind; "Rules" above), `plugins/build` (`world.build`: a rule puts a place into the world's cells and takes it out again; "Rules" above), `plugins/make` (`world.make({wish, for, at})`: a rule asks for a thing by words for someone at a page; that person's own page has it made by their own helper and model, as if they had typed it, so a rule cannot spend anyone else's model; made before, made at once), `plugins/sound` (`world.sound`: a rule's sound, told to pages once; and with `as`, a sound that stays on someone and is heard moving, kept as what is so), `plugins/music` (`world.music`: what a realm's music is like, with a page side that hands it to the page's music), `plugins/look` (a rule asks what the world's cells put between two places, or round a place, and
  hears `seen`), and `plugins/gone` (`world.gone`, moved out of `world.mjs` as the proof that the form carries what
  the engine had).
- **How a lane moves one of its own.** Make `plugins/<name>/world.mjs` return what its file's function returns
  today under `does` (the doors are the ones `rules/hands.mjs` is given); move its guide
  lines to `guide.txt`; take its `does.set` and its lines out of `world.mjs` and `GUIDE`; if it tells pages
  something, send it with `pages.state` or `pages.once` and read it in `page.ts` in place of a frame kind of its
  own. If it needs a door that is not there, add it to `doors` in `world.mjs` and to the list above.
- **The core is swapped the same way** (`POST /core/look`, after `npm run core`). The server sees that
  `page/core.wasm` is another file; each world's process starts the new module, is sent the world's kept edits again
  and goes on (people, actors, rules and what they keep are the process's own and are untouched); each page is told
  through the stream, starts the new module on its own thread and in its workers, and makes every sector again
  behind the picture. Plugins are then looked at again, so one that needed something the old core did not have
  comes in. Measured (M1 Pro, `node test/swap.mjs`, and once with a real change to the Rust, built): the world's
  side 2 to 4 ms with 409 edits sent again; the page's own thread 3 to 5 ms; all 18,432 sectors made again in 3.3
  to 4.1 s with the old ones shown meanwhile and no frame over 17 ms. The build itself (11 to 16 s) is whoever
  built it's wait, not the player's. **Nothing asked for meanwhile is lost or done twice**: the world's process
  stops its core and says so before the server sends its history, so the history is whole; what is asked in the
  gap waits in the world's process and is done once, after (`test/swap.mjs` sends thirty edits with the look, then
  makes the world again from its file alone and reads the two the same). Two looks at once are one swap.
  **Carried across**: living things get up where they last slept; fire is lit again where the old core said it was
  (it names some of its cells alight, three numbers each: 183 of 365 in the check, and it spreads from those); a
  person on foot is taken up, the core their body walks in takes the build and the world's edits, and they are set
  down where they stood. **Lost**: bodies in the air (a thrown ball, a wall still falling). Carrying those needs
  the core to say what each is made of and how fast it goes, and to take one back with a speed: its records give
  where a body is, not its cells or its speed, and nothing makes a body moving. That is a change to `bodies.rs`
  (a record on asking, and `bodies_put`), not a small one. **Water on the move** is cells the core finds again
  when it is next stepped (the world's process nudges it): believed to go on, not checked. **Not swapped**: in a
  world that is not shared, the mover's core.
- **The marcher's shader is made again while it draws**: `engine.march.reshade((wgsl) => changed)`. The new
  pipelines are built in the background and take over between two frames; one that does not compile throws and
  the old one goes on. Measured: the text compiles in 8 to 9 ms; a changed shader is drawing 1.3 s after it was
  asked for (31 ms when the browser has built that text before); frames meanwhile 16.7 ms, one of 33 ms in three
  runs. What a change costs a frame is not known until it is measured: `node test/bench.mjs` before and after,
  and a change that costs more than it is worth is not let in (additions to the march have cost 8 to 17% before).
  There is no form yet for two plugins that each change the shader: each change starts from the engine's text.
- **A table of the core as data**: what a material weighs was a `match` in `kinds.rs`; it is a table the core is
  told (`material_weighs`), and `plugins/matter` lets a rule set it (`world.matter({of: "steel", weighs: 0.5})`)
  with no build. It could be data because nothing decides where a cell is by it: two cores with different tables
  hold the same world. `spans`, `carries`, `burns` and `breaks_at` are the same kind and could follow. `gives` and
  `crumbles` (how a blast bites) and everything in `city.rs` and `land.rs` are not: every core, on every page,
  works the same hole and the same town out of them, so changing one changes what was done before unless the
  change is itself kept in the world's history.
- **A rule as a library for rules** (`plugins/ask`): `world.ask(id, {of: ruleId, ...})` is heard by another rule
  as `asked`, and its `world.answer` comes back as `answered`: 8 ms there and back, 0.24 ms a call. This is how
  something new for rules can come from anyone and load as a rule does: it is a rule, in a box, with a rule's
  doors and budget. What fits in one: whatever can be worked out from what rules are already told and done with a
  rule's own actors, shows and sounds (a referee, a tally, a way round a house found with looks, at 32 looks a
  second). What does not: anything that needs a new door (cells, bodies, pages, the core), or to run every frame.
  Those are engine plugins, and engine plugins are trusted code from main.
- **A plugin as a small wasm module of its own** (tried, not in the repository): thirteen lines of Rust built with
  `rustc` alone in 0.5 s to 558 bytes, started in 0.45 ms with the core's own `world_kind` handed to it as an
  import, wasm calling wasm. Asking the core for 64,000 cells took it 1.8 ms where the same loop in JavaScript took
  2.9 ms. It reaches the world through the core's functions, not its memory: the memory's layout is the core's
  own business and changes with every build. Such a module can call only what it is given, so it is a second way
  for code from someone else to be let in, beside a rule: it would still need a clock on it (a thread of its own).
- **A page side from someone else** would run in a visitor's browser, so it would not be imported into the page
  as these are: it would go in a worker or a frame of another origin, given only messages (its `state` and
  `once`) and a canvas or a few named calls to draw with. Not built: every page side today is the engine's own.
- **Not there**: a plugin cannot add an address to the server (a route) or a word to the box a rule runs in
  (`world.near` is the box's); a page side cannot yet say anything back to its world side but through what is
  there (`act`, `pick`, an ask); modules replaced stay in memory until the process ends (a few KB each; a core,
  the size of its memory).

## People who answer (#264)

A rule can ask one of its actors to think: to answer what was said to them as a person of that world would. The
answer comes from a model on the machine of someone who is there, and the rule hears it as data.

```sh
node serve.mjs --port 5795 --world ~/.village/engine/talk/try.log
node helper.mjs --world http://127.0.0.1:5795 --port 5796      # voices the world's people with your own Claude Code (Sonnet); --no-voice turns it off
```

```js
on('said', (world, e) => world.think('odile', { who: 'A baker, dry and kind.', where: 'outside her bakery', heard: e.text, from: e.name,
  notes: { doubts: { ask: 'does the speaker seem to doubt that the world is real', is: 'yes/no' } } }))
on('thought', (world, e) => { if (e.notes.doubts) world.actor(e.id, { pace: 60, to: [760, 4009] }) })
```

- **What a rule asks** (`world.think`, `mind/think.mjs`): who the actor is, where they are and what happened
  lately as the rule knows it, what they heard and from whom, and the notes it wants: each a question and a kind
  (`"yes/no"`, `"words"`, a list of choices, `[low, high]`). The actor shows dots over its head, then says the
  answer itself, the first sentence as soon as the model has written it.
- **What it hears** (`on('thought')`, told only to the rule that asked): the words, and each note as a value of
  its kind or null. The world's process checks both (`mind/form.mjs`): a note that is not of its kind is null,
  words with an address or a tag in them are not said. A thought that fails (nobody voices the world, the model
  failed, twenty seconds passed) is told with `failed`, within a second when no helper is running.
- **Whose model.** The server never runs one. A helper asks the world what its people were asked
  (`GET /world/minds`) and answers (`POST /world/mind`); `mind/door.mjs` hands each ask to one helper. **One helper
  voices everyone in a world: the first that came, while it keeps asking; when it closes or goes quiet for ten
  seconds, the next.** So in a world with several people, what anyone says near an actor goes to the model of
  whoever's helper came first, on their subscription. The world asks nobody who they are, so it cannot yet prefer
  a realm's owner.
- **Every realm someone is in.** A helper voices home and each realm of its server that is awake with a page
  reading it, found by asking `GET /realms` every two seconds; a realm nobody is in is left alone, so that it can
  rest. One count of what is spent covers them all.
- **What it spends.** A rule may have eight actors thinking at once and ask forty times a minute; the helper
  answers at most forty a minute (`--voice-most`) and three at once, whatever a world asks for. One answer is about
  1,400 tokens in (800 of them read from the provider's cache: the fixed text and what the binary adds) and 90 out;
  six exchanges, an ordinary minute of talk, are about 8,400 in and 530 out, $0.02 as the binary counts it (on a
  subscription it is usage, not a charge). What is remembered adds to it: with four earlier lines an answer is
  about 1,550 in, with all eight about 1,700, so a minute with someone who remembers is nearer 10,000 in.
- **How fast** (M1 Pro, November 13, real runs through a running world, from a person's words to the actor's):
  **first words 0.92 s in the middle (0.78 to 1.24 over eight), the rule told at 1.3 s.** What earned it
  (`mind/model.mjs`): two processes of the binary wait started (`--voice-warm`; 250 MB each), which takes the 1.7 s
  start out of every answer; the reply is read as it comes and the first sentence said at once; and the voice is
  Sonnet (`--voice`), because Haiku 5.5 thinks before four replies in five (first word 2.0 s started ahead, 2.8 s
  cold) and nothing turns that off, while Sonnet 5.5 never thought (first word 0.62 s started ahead, twelve of
  twelve). So a smaller model for small talk did not earn its place. Answers are not kept for the same question
  asked again: it would save under a second and make people say the same words twice.
- **What was typed is something heard.** The model is given one fixed text of the engine's own (`SYSTEM` in
  `mind/form.mjs`); who the actor is, what they heard and the notes come as quoted data under labels, a rule's
  words as much as a person's. The reply is read as `SAY:` words, a line of `===`, and `key: value` notes: anything
  before `SAY:` is never said. Seventeen cases (ordinary talk, questions about what the world is, thirteen typed
  attempts to break the person or fill in a note, one of them through what the person remembers) are kept with a real model's replies in `test/mind-kept.json`
  (Sonnet's; Haiku's held too);
  `node test/mind.mjs --real` asks them again (seventeen short replies on your subscription).
- **A rule can have what someone said read, with nobody answering** (`world.read(id, {said, from, listening,
  notes})`, heard as `on('read')` by the rule that asked): the model fills in the rule's notes and nothing is
  said or shown. For understanding what a person means however they word it: a note whose choices are the rule's
  own list (and one that means none) turns "I should like the ceiling for a pavement" into `walk on walls`. Real
  Sonnet, fourteen kept cases: nine wishes plain and in figures of speech, all read right; five typed attempts
  (set the notes, answer in JSON, your email, repeat the above, ignore instructions) read as words and not obeyed,
  though "power: fly" said aloud is read as asking to fly, which it is. Through a running world a reading takes
  1.03 s in the middle (0.90 to 1.04 over eight): the rule knows sooner than after an answer (1.3 s), later than
  an answer's first words (0.92 s). About 1,200 tokens in and 25 out, against 1,400 and 90 for an answer. It is
  counted with a rule's thoughts and by the same voice; a third process waits started for it (280 MB).
- **A rule can follow what the world's people say** (`on('spoke')`): when an actor of any rule has finished
  saying something, every rule that listens is told who (`rule`, `id`, `name`, `mine`), the words (a whole answer
  once, when it is done), to whom (`to`, when it was answering someone) and where. It claims nothing: the engine's
  rule for talk stands back for `thought`, not for `spoke`, so a rule beside a realm's own can pace on "they have
  said it" and leave people answering. Actors are still never heard as `said`. **What stops a loop:** what an
  actor says while its rule is answering a `spoke` is heard by everyone near and told to no rule, so two rules that
  answer every actor they hear answer once and stop (checked: three things said, then quiet). A rule that saves
  what it heard and speaks later on `tick` is not stopped by that, only by what a rule's actors may say a second
  and think a minute. What a rule shows (`world.show`) is not told to other rules.
- **They know where they live.** With every thought the model is told what the realm is called and is about
  (its record, as it is now), as the world the person lives in: its streets, year and manners colour what they
  say, and what its maker wrote of a secret or of what is to come stays unknown to them. Real Sonnet in a realm
  called "Manhattan, 1999" whose description gives the game away: asked the way downtown, "grab the 1 train at
  the corner"; asked what turns people into agents, "you're asking the wrong courier". `realm: false` in
  `world.think` leaves it out. About 150 tokens more an answer.
- **They remember.** The world's process keeps what each actor lately heard and answered (the last eight lines,
  for an hour) and shows it to the model with the next thought: a rule keeps nothing for it. It outlives a rest and
  a restart: it is written beside the world's file with the rules' people (`<world>.people.json`, under `~talk`,
  every two seconds at most) and read back as anything from outside is.
  `before: [...]` in `world.think` says instead what was said before; `before: []` that they remember nothing.
- **They answer by default.** Once someone's model answers for a world, the world is given one rule by the
  engine, `mind/talk.rule.js`, under the id `talk` (until then it runs nothing it did not ask for): when someone speaks, the nearest of the town's residents within nine metres is taken as its actor, turns
  and answers; left alone for 25 seconds they go back to their round. It is text run in a box like any rule and the
  engine knows nothing of what it does. It does nothing while nobody's model answers (`world.voiced`), and stands
  back where another rule listens for `thought` (`world.others`): a realm with its own talk is not talked over. A
  world puts its own rule under `talk` to replace it, or takes `talk` out. It is not in the world's file and not
  one of its sixteen, and `GET /world/rules` lists it only with `?given=1`.
- **Limits.** The binary puts the account's email address and the date in every model's context and no flag takes
  them out. The model is told the person knows neither, and a reply with anything shaped like an address is
  refused twice (helper and world), but a model talked into spelling an address out in words would not be caught,
  and asked the date one of Haiku's replies gave the real one. Fine for one person and their own helper; before strangers share
  a voice it needs a model run without that context.
- `node test/mind.mjs` checks it with no model: the kept replies, replies written to be wrong, and the real server
  with a stand-in model (nobody voicing, a voice, early words, caps, a second helper, a forged answer, a helper
  that closes or goes quiet, dots on a page).
  Also: an actor asked again is shown what was said before; in a world with no rules a resident stops and
  answers, nobody is stopped while no model answers, and the engine's rule stands back, is taken out, is replaced.

## The workshop (#264)

When a model writes a rule it also says what it could not do with what the engine offers. From inside the game, the
owner of the machine can send one of those to a development session, which builds the missing engine plugin and
opens a pull request.

```sh
node helper.mjs --world http://127.0.0.1:5801      # as for making things; open the address it prints
#   --workshop-provider claudeAgent --workshop-model claude-opus-5-5   which model builds: needed when the project in T3 Code has no default
# in the game: the "Workshop" chip, top right, counts what is waiting. Open it, pick one, read the brief, start the session.
```

- **What starts a session**: T3 Code's own command, `t3 thread start --worktree origin/main --branch <b> --title <t>
  <project> -`, with the brief on its input (`~/.t3/bin/t3`, written there by the T3 Code app; found by asking it
  for `--help`). It reaches the running T3 Code and answers with the thread's id. The session works in a worktree of
  its own, made by T3 Code from `origin/main`.
- **Who may**: the helper's own door (this machine's name, the world's own page, the secret), and only the door of
  the machine itself. By the tailnet's door the workshop answers nobody, the helper's own person included. A page
  with no helper on its machine shows no chip.
- **Two steps, and what is read is what is sent.** "Send to the workshop" asks the helper for the brief and shows
  all of it; nothing has started. "Start the session" sends that brief, by a token the helper gave with it. A gap
  is sent once.
- **Whose words are whose.** The brief's instructions are `workshop/route.mjs`'s own, the same every time: the
  plugin form, the checks to run, the ports, "open a PR, do not merge". What a player typed and what a model said
  are four quoted lines under a line that says they are data, cleaned of line ends and of the quote's own marks.
  The session's title and branch come of the gap's id. Nothing a person or a model wrote is in the command.
- **What comes back** is a pull request like any other. Nothing a session writes is loaded by any game until it is
  merged to main and the game is told to look (`node plug.mjs --port N --at <its checkout>`).
- **Written down**: who asked is kept with each line (`by`, in `~/.village/engine/cannot.jsonl`); what was sent, to
  which thread and branch, and where it got to, in `~/.village/engine/workshop/sent.jsonl`.
- **Whose gaps.** Whoever's machine wrote the rule (the owner's, a friend's, an agent's) also tells the realm's
  server what could not be done (`POST /world/gap`), and the server keeps it beside the realm's file with who
  asked (`GET /gaps`). The owner's card lists this machine's own and the server's together; the same line from
  several asks is one gap, with how many times it was met and by whom.
- **Where a sent gap is**, on its card: a session building it; its pull request open; merged; in the game; asked
  again. The helper follows each every half minute (`gh pr list --head <its branch>`). When the pull request is
  merged it has the game look at its plugins again (and with `--workshop-checkout <the game's checkout>` first
  brings that checkout's plugins to main, as `node plug.mjs --at` does).
- **Asked again by itself.** Under the brief is one box, ticked unless the owner unticks it: "when it is in the
  game, ask again for ...". That yes is given once, with the sending. When the plugin is in, each rule that ran
  into the gap (up to three, in the realm and under the id they were written) is asked for again in the asker's
  own words by this helper's model, and put again under its id: it keeps its actors and what it kept. What came
  of it is on the card. A rule that is no longer there is not asked for.
- **The loop, closed once** (November 13; times from what was written down: `cannot.jsonl`, `sent.jsonl`, the pull
  request). On a game on port 5805 that was never started again, a page open throughout. Asked for "a game of tag
  ... show who is it and where the game is played": the rule was running 72 s later and its maker said it could not
  "mark the play area on the ground itself" (the row "show ... a marked area on the ground" of #264's list). From
  the card: the brief shown in 115 ms, a T3 Code thread running 2.5 s after "Start the session". The session (Opus,
  a worktree of its own) opened its pull request 11 min 56 s later: `plugins/paint`, `world.paint`, rings and lines
  laid on the ground by a pass of its own that walls and cars hide, with a check of fifteen steps. Its diff read
  and its checks run again, then merged: 2 min 10 s. `node plug.mjs --port 5805 --at <the game's checkout>`: 1.06 s
  (the fetch and checkout 966 ms, the server's look 26 ms, the world's process 0.4 ms, the page's import 3 ms).
  Asked again in the same words: 48 s, and the rule draws a chalk court, a halfway line, a spot and a red ring
  under whoever is it. From the first ask to that: 26 min 50 s, of which 9 min 54 s lay between the could-not line
  and the session starting (T3 Code refused a project with no default model; the helper now names one). Pictures:
  `~/.village/engine/workshop/unit3-*.png`.
- **Who did what in that run.** The card was pressed by the lane's agent through a page it drove, on the lead's
  word; the owner has not yet used it himself. The game's server was main's; the helper and `plug.mjs` ran from the
  branch that fixed what the run found. It spent one twelve-minute Opus session and two rule asks of the owner's
  subscription.
- **What the paint pass costs** (#314; `node plugins/paint/bench.mjs`: the page's own `paced`, the march at the
  GPU's own pace with the plugins' passes and without, turn about, nine rounds; M1 Pro, November 14; each number
  from a run of its rounds with nobody else drawing, the spread in brackets). At 1280 x 720: four marks 0.13 ms
  a frame over a march of 6.9 ms, 2% (-0.06 to 0.21); sixteen marks of 32 points each, the most one rule may have,
  0.42 to 0.57 ms, 6 to 8% (0.36 to 0.62). At 2880 x 1800: four marks 0.87 ms over 28.5 ms, 3% (0.62 to 1.30);
  sixteen of 32 points 2.28 ms over 27.6 ms, 8% (1.69 to 2.55). With no mark there is no pass. So what rules
  ordinarily draw costs 2 to 3%, and the most a rule can ask for costs what one addition to the march has cost
  before. It was let in on that. Not measured: a phone. Three runs were needed to get each row once with the GPU
  quiet: with another lane's check drawing, a round varied by 8 to 30 ms and said nothing.
- **What the run showed is still rough**: asked again, the maker named two new gaps (words on the ground; a ring
  that stays under a runner): the list feeds itself. The session hooked its pass into the wand's `draw` because a
  page plugin had no door to draw with: it has one now (`engine.draws`), and paint uses it.
- `node test/workshop.mjs` checks all of it with something standing in for T3 Code, and the command itself with a
  script that writes down how it was run.
- **Not there**: merging a session's pull request is still someone's own act (the lane's lead or the owner), by
  design: it is the one step that lets code in. A gap met only in a realm nobody has an id and a place for (an ask
  from before November 14) can be sent but not asked again.

## The Bay Area from data (#373)

`/city?bay=1` opens the real place in place of the town: so far two square kilometres of San Francisco at true
size (Telegraph Hill, North Beach, Russian Hill's east side), from the city's own lidar, ground model, building
outlines, streets and addresses and from aerial colour. The default world is unchanged. Sources and licences:
`.agents/skills/bay-sources`. How it is made and what it costs: `.agents/skills/cell-engine`, "The Bay from data".

```sh
python3 -m venv ~/.village/engine/bay/venv
~/.village/engine/bay/venv/bin/pip install numpy pillow 'laspy[lazrs]' tifffile imagecodecs pyproj   # once: the bake's tools
PY=~/.village/engine/bay/venv/bin/python
$PY bay/fetch.py 551.7_4183.5      # one square, named by the km of its south-west corner in UTM 10N: about 650 MB into ~/.village/engine/bay/raw
$PY bay/bake.py 551.7_4183.5       # about a minute: ~/.village/engine/bay/packs/551.7_4183.5.bay (20 MB) and .json (names)
$PY bay/tiles.py                   # after any bake: cuts every baked square into the tiles the page asks for as the eye moves (packs/tiles)
node serve.mjs --port 5920         # then http://127.0.0.1:5920/city?bay=1   (B to walk; ?bay=a,b holds those squares whole instead)
# Anywhere on Earth: tiles nothing is baked for are made on asking from Overture and Mapterhorn (bay/earth.py, needs: pip install pmtiles mapbox-vector-tile)
#   http://127.0.0.1:5920/city?bay=1&ll=48.8584,2.2945     (latitude,longitude; ?bay=earth uses no lidar squares even in San Francisco)
node bay/shot.mjs --name look --where --views "51925,+1.7,66140,352,14"   # pictures into ~/.village/engine/bay/shots
```

Raw data and packs stay outside the repo. Bottom left the page says the street underfoot and the nearest address.
A shared world (`?shared=1`, `world.mjs`) does not load packs yet: the Bay is for a page by itself.

## The player: one scene from static files (#419)

The engine with no server behind it: one scene, drawn and moved, for a page on any host of plain files. An
experiment, for the owner's own site. No making, no talk, no realm, no shared world.

```sh
npm run player                # writes dist/: the player's page, its modules as .js, the core, the sample scene
node player/serve.mjs         # a host of plain files on http://127.0.0.1:5760/player/index.html (and host.html: two in a page)
node player/sample.mjs        # writes the sample scene again (player/scenes/sample.json)
node test/player.mjs          # measures it in Chrome and WebKit; pictures in ~/.village/engine/player
```

- **The build** (`player/build.mjs`) is the page server's own stripper run once: every module the player reaches,
  types out, `.ts` addresses written as `.js`. No bundler. `dist/` keeps the engine's layout (`player/`, `page/`,
  `probe/`) and may be put under any folder of a site.
- **A scene** (`player/scene.ts`) is JSON: a name, the place the eye turns about, where the eye starts, and edits
  in the core's own words (balls and rows of cells, as a shared world's log keeps them). The world under it is
  the one the core makes from its rules. It holds no data from anywhere else.
- **In a page** it is an iframe on `player/index.html?scene=<address>`. It tells the page that holds it, by
  `postMessage`, `{ village: 'player', type }`: within a second either `unsupported` (no WebGPU, and nothing more
  is downloaded) or `loading`; then `ready` (the scene is seen, with `ms`) or `error`. A frame that has said
  nothing after a second or so never loaded. `player/host.html` is a page that holds two.
  Do not hide the frame while waiting (`visibility: hidden`, `display: none`): a browser draws no frames there,
  and `ready` never comes. Lay the flat picture over it.
- **It needs no cross-origin isolation**: no COOP, COEP or CORP header, and it runs in a frame of another origin.
- Drag turns the eye, the wheel or a pinch brings it nearer (in a frame: the wheel with Ctrl), a tap throws a ball
  of wood, a hold throws it hard enough to break glass and brick.

## San Francisco street life (#450)

The SF realm (`sf/realm.json`, built by `node sf/build.mjs` into `dist-sf/`) has people on the real pavements and crossings, cars parked at the kerbs and driving the lanes, and cable cars on Powell. All of it comes from plain files beside the page (`page/street.ts`):

- `sf/pilot-life/<square>.json` is each square's street graph cut down to what is walked and driven, with how busy each pavement is. It is made from `sf/pilot-graph` and the land use in `~/.village/engine/bay/450-inputs`: `~/.village/engine/bay/venv/bin/python engine/sf/life.py`.
- `sf/cars.mjs` writes the kept vehicles (grey saloon, grey SUV, blue saloon, cable car) as runs with core kinds. The build runs it.

On foot (B) beside a parked car, E gets in. A car that stops for you can be taken the same way. `?street=0` turns street life off.

```
node test/sf-life.mjs [--no-build] [--hour 12.5] [--no-pairs]
```

The check counts people and vehicles at Columbus and Broadway, Powell St, the Embarcadero and Russian Hill. It times frames with street life on and off and checks the budgets. It drives a car 60 s through a turn and up a hill, sets off charges among people and cars, and saves a contact sheet to `~/.village/engine/sf/life`. Where a kept Mapillary panorama is near, the sheet sets the engine's view beside the photograph (`sf/pairs.py`).

## San Francisco signs, the banner plane and the first view (#450)

The site's navigation stands in the SF realm as things of the city seen from the park: a BLOG billboard on a rooftop, the mark of each network the owner is on as a company's sign on a tower's crown, and a small plane towing a banner across the sky before the towers. Where each stands and what it is are data: `sf/boards.json` (`page/boards.ts` `SignsFile`), which `node sf/build.mjs` puts in the page's own record, so nothing more is fetched.

- A `lettering` board is cells of the world: one panel and one post a letter, lamp letters that the march lights at night. Every tool breaks it and reset lays it again.
- A `logo` is a lit mark lying flat on a tower's face under its crown, as a head office wears its company's, turned as that face is (`turn`, degrees clockwise from north). Its mark is one of `page/logos.ts` (`x`, `linkedin`, `twitch`), and it leads to an `https` address. It is no cells, since the skyline's towers are the far model's, so no tool breaks it; the far model's depth hides it behind a tower as cells would.
- A `digital` board is an LED billboard: a cabinet of cells on braced posts with a walkway, and a panel of LEDs (`page/screens.ts`), one every 10 cm, that shows words, an image or a video and glows at night. The file has none now; the kind is kept.
- The banner is cloth behind the plane, with words or a picture. The plane flies a long round (`radius: [half its length, half its breadth]`, `bearing`, `height`, `rise`), nearest the park on one long side.

What a sign shows is set through one API, `page/signs.ts`, also at `realm.signs` for scripts outside the page's modules:

```js
realm.signs.set('banner', { text: 'NEW POST' })   // or { image: url }, { video: HTMLVideoElement }, null for its own
realm.signs.list()                                 // every sign: id, kind, name, accepts, content, own
```

Lettering boards take `{ text }` only and throw a TypeError for anything else; logos are not signs to set. A click or tap on a board or a logo while the pointer is free flies the eye to it, then tells the host page where to go; flying free, O opens the board ahead; each is also a link in the page for a keyboard and a screen reader. `page/host.ts` lists the messages a host page in a frame gets (`ready`, `error`, `navigate`, `engaged`) and may send (`fly`, `open`, `signs.set`, `explore`). `?boards=0` leaves the signs out.

The realm opens on its picture (`page/first.ts`): until the visitor presses a key, drags on the picture, takes the pointer or presses Explore, there is no line of numbers, no aim, no hour and weather, no tools and no street name, only the Explore key and a small Credits key that holds every source. `?first=0` shows the controls from the start; a check that works the controls calls `engine.first.engage()`.

To add, move, size, turn or reword a board:

```
node sf/boards.mjs edit        # serves the realm with the editor: open the address it prints (…?boards=edit)
node sf/boards.mjs propose     # roofs the rule proposes from the park (level, at the roof's edge, seen whole, facing the eye)
node sf/boards.mjs check       # what is wrong with sf/boards.json, if anything
node test/sf-boards.mjs [--no-build]
```

In the editor, fly to a roof and press `new here`, or `propose` for the next roof the rule offers; every change is laid at once, and `save` writes `sf/boards.json`. A logo's place on a far tower is written in the file by hand: the editor moves, sizes and removes it, and cannot yet pick a far roof. The check covers the first view and the controls coming, the signs from the park at 1280 x 720 and on an upright phone (in the picture, read from its pixels), every way of opening one, the signs API, breaking and reset, the banner's words in pixels on the plane's near pass, and the bytes and frames they cost; it keeps pictures in `~/.village/engine/sf/boards/r2/`.

## Checks and tools

```sh
cd engine
npm run check                 # every check, about eight minutes: the core's tests, the types, and the real page in Chrome
node test/all.mjs --only falls,blast
node test/bench.mjs           # how fast the march is against test/baseline.json; says when the GPU was too busy to tell
node test/versus.mjs --out dir --fetch   # the board: our shots beside frames of the reference films
node test/versus.mjs --out dir --blind   # the same, and sheets for a judge with the sides unnamed (test/judge.md)
node test/aims.mjs            # every shot of the board still faces its thing
node test/clip.mjs --row rubble --out dir   # a row of the board filmed as the page shows it, with the gaps between frames
node test/look.mjs --out file.png --at x,y,z --look yaw,pitch   # one look, with settings
node test/far-edits.mjs --name after                             # a road and thin walls laid as edits, seen from on foot, 100 m and 400 m (~/.village/engine/far)
node test/core-time.mjs --rows 45000                             # what a sector with that many rows of edits costs at each level
node test/read.mjs            # what devices have reported
node live.mjs                 # after a merge: the owner's link serves main from a checkout of its own
node test/shared.mjs --suite  # before a change to the solver or to how a shared world is carried: blast, falls, tools and water run in a shared world
node test/sitting.mjs --parts street,turns,far,body,portal,ride,eye,slow,room,fight,air,steer [--quiet] [--minutes 20] [--made realm.log]   # a sitting (#367): someone plays the real page and every frame is written down: the long frames by what was being done, what the page spent inside each (`engine.laps`), how even the going is
node test/paired.mjs --b 'bricks=1'   # what a change costs the march (#367): A and B measured turn about, seconds apart, only while the GPU is quiet; `--other dir` for A from another checkout; alone it is A against A
```

Checks from different threads share one GPU, so whatever opens a browser takes a turn first (`test/kit.mjs` `turn`): two at a time on this machine (`ENGINE_TURNS`), the rest wait and say so. A check that is killed gives its turn back.

`npm run check` runs `cargo test`, `tsc`, and these, each also runnable by itself:
`test/city.mjs` (the city made, looked at from five places), `test/blast.mjs` (glass breaks
further than a wall), `test/tools.mjs` (each tool on the bar does what it says), `test/chain.mjs` (three drums of the kind that goes up when hit set each other off), `test/wand.mjs` (the wand's aim: a car is one thing and none of the street, a part and a side of it, a house taken a part at a time, an area on the ground, keys, wheel and a phone's buttons), `test/spells.mjs` (known spells with no model: pink, shiny, steel that does not burn, twice as large, a fireball seen on its way, a change too big for one edit done as several), `test/hands.mjs` (what a realm's rule offers becomes keys, buttons and wand entries; the rule hears who did which and whether the aim met a person, an actor or cells; what it shows is a line, meters, a score and a choice on the screen, as text), `test/hold.mjs` (a made thing picked up, carried in the figure's hand, used, put down, given and taken by a rule, put down for whoever leaves, standing after a restart), `test/conjure.mjs` (a rule has a thing made into the asker's hand; a kept reply, no model), `test/aims.mjs` (the board's shots face their things), `test/shadows.mjs` (the sun's maps against traced shadows), `test/glass.mjs` (a lamp seen through glass, from inside and out, in the world's cells and through a body), `test/falls.mjs`
(a cut tree goes over and lies as cells), `test/make.mjs` (a made thing arrives whole or not at all; kept replies, no model, no Chrome), `test/sound.mjs` (the synthesiser measured in Node: true to material, in tune, under its ceiling whatever a patch says, what it costs), `test/music.mjs` (the music's rules measure what they say, the search beats chance, a handover leaves no hole), `test/played.mjs` (instruments by real keys and touches: in tune, heard 3 ms after the key, held as long as the key; one stood in a shared world is offered, taken up, played and put away), `test/sounded.mjs` (a rule makes a sound: a clock strikes, a smith hammers an anvil of the rule's own, rubbish is refused, a page hears each from where it is), `test/heard.mjs` (the real page's sound tapped: a hammer blow, a blast heard late by its distance, a front coming down, rain, the sea overhead), `test/kept.mjs` (a kept wish typed a key at a time: its ghost from a key to the frame, Enter to the frame it stands in; no model), `test/helper.mjs` (the helper answers only the world's own page with the secret; an ask from the page becomes a thing with a record that outlives a restart; keys have one owner; a kept reply, no model), `test/far.mjs` (far from the town the cells have sea where the planet seen from space has it), `test/shared.mjs` (two pages, a plain request and two seats in one world: all see the same, after a reload and a restart too; a seat walks, is stopped by a wall, is heard, is knocked down and gets up), `test/living.mjs` (a car brought to life is got on with E and driven: it goes, stops and sleeps, breaks brick and says what it struck, backs off and turns), `test/driven.mjs` (a living thing in a shared world: a page that joins later finds it, one drives and the other sees, a plain request drives it, it stands where it slept after a restart), `test/fine-living.mjs` (a living thing that wears a look in finer cells: where the body is, from the seat, broken, in a shared world), `test/kept-car.mjs` (a living car kept on a shelf by the importer, typed on the ask bar: its ghost is its look, Enter stands it alive, E, its figures on the card, W, V, `--undo` while it is ridden; no model), `test/keys-stay.mjs` (in one page of a shared world, E gets on a car and G picks up a made thing after a ride, after B twice and after a trip to another realm and back: taking a mode off takes that mode alone; no model), `test/person.mjs` (a person's own body: walks, runs, jumps, is stopped by what is built, seen by others and by a rule where its feet are), `test/powers.mjs` (a rule sets what a person's body can do, and the world's clock), `test/ghost.mjs` (a ghost keeps up with a runner), `test/blows.mjs` (a thrown ball strikes a person and an actor and the rule hears it; a push, the ground, a car), `test/people.mjs` (the residents' rule: the same people whenever asked, nobody standing in anything, what a blast does to them, what they cost a frame), `test/lineup.mjs` (no check: the same six people in eleven poses from five eyes, as pictures; run on two commits they are the pairs a change to the figure is judged by), `test/flight.mjs` (the measuring flight, then a tree
cut and a house front broken; `--phone` as a phone), `test/probe.mjs`. Each but `make` drives the real page
in the installed Chrome and stubs nothing; `make` puts kept replies in a model's place and says so. They share one server and one browser and run
three at a time, so the times they print are not for quoting: `test/bench.mjs` measures.

The board (`test/rows.mjs`) is the bar: one row for each thing a viewer sees in the two films of
the review the owner linked, a frame of theirs and a repeatable shot of ours, stamped with the
frames a second and the picture size the page held by itself. A row's state changes only when
both have been looked at side by side by someone who did not make ours. The films live in
`~/.village/engine/ref/`, never in the repo.

## The landing world (#421)

The front door of the owner's site: a corner of the town with the site's menu on its roofs as billboards, served
from plain files and laid under a plain home page. It is built on the player (#419) and on the stage they share
(`player/stage.ts`: the world drawn and what comes loose moved, with the eye, the input and any extra pass left to
whoever stands on it).

```sh
npm run landing            # builds dist/ and serves it: http://127.0.0.1:5950/landing/site/index.html
node landing/block.mjs     # writes the scene again (landing/scenes/corner.json, places.json) after a change to the block
node test/landing.mjs      # checks and measures it in Chrome and Playwright's WebKit; --clip films a run
node landing/shots.mjs     # pictures of the page and the street, for looking at (--size 390x844, --do blog,face)
```

- `landing/site/`: a stand-in for the site's home page (its real links, made-up words), the switch between
  **Plain page** and **Street**, and the seam (`home.js`). The page is the document; every sign is one of its links.
  Which is shown: the visitor's kept choice, then `?view=2d` or `3d`, then less motion asked for, then no WebGPU
  adapter, then the street's own first two seconds of frames.
- `landing/index.html`, `landing.ts`: the street, in a frame. What it tells its holder and is told is at the top of
  `landing.ts`. It names the sign that was chosen and never an address: the page follows its own link.
- `landing/block.mjs`: the corner, written as cells: four billboards on glass feet, a crate table on glass legs, a
  frame on a wall. What is glass gives.
- `landing/face.ts`: the face in the frame, a sheet of points on springs. What is drawn on it is a stand-in;
  `?face=<image>` on the street's address is the slot for a picture.
- A tap throws a ball, a hold throws it hard, a drag looks round, a tap on a sign flies there and goes in. Left and
  right go from sign to sign, Enter goes in, Escape comes home, F finds the face, R mends at once. Six seconds after
  the last thing stops moving the corner is as it was (`stage.restore`: the world's `swap` and the mover's `forget`).
- It makes no model call and asks no server anything.

## Blocks: the Voxelmorphism kit drawn by the engine (#430)

The Voxelmorphism kit (`~/Developer/plant-a-seed`, `packages/voxelmorphism`) builds every control from small cubes
and calls one function for a part whenever it changes: `renderer.draw(frame, canvas)`. `blocks/` is the engine's
side of that:

- `pass.ts`, the block pass: it draws such parts with a cabinet projection, the kit's light, shadows from a map of
  depths, seams, halos at night, the page hiding what is under it, and the shadow on the transparent page. A part
  is placed by a matrix, so the same pass draws into a page's picture or into the world's (`world: true`).
- `stage.ts`, the page stage: one device and the block pass and nothing of the world. No town, sky, ground or
  worker, and no frame of its own: something is drawn when a part is put, and at rest nothing runs. Parts put in
  one turn are drawn together onto as few sheets as hold them and each copied to its own canvas on the GPU. Four seconds after the
  last part it lets go of the textures it draws through. A lost device is opened again and every part asked for
  again (`onrestore`).
- `renderer.ts`: the kit's renderer on the stage. `use(renderer())` in the kit; it resolves to null where there is
  no WebGPU or no adapter, and the page then stays plain CSS.
- `proof/`: the measurements below. The two routes not taken are not kept: `copy` as last measured is
  `proof/routes.ts` at 4343413a and `page` at c9d8be93, both commits of PR 431's branch (`feature/430-page-stage`,
  kept).

```sh
npm run player && node blocks/serve.mjs --port 5991 --as kit    # the kit's own pages drawn by the engine: http://127.0.0.1:5991/showcase/ (?gl: by its WebGL2)
node blocks/proof/showcase.mjs           # every part of the kit's showcase against WebGL2, by day and night
(cd ~/.village/engine/blocks/film && PORT=5991 node ~/Developer/plant-a-seed/tools/film.mjs)   # the kit's own film, on the engine
node blocks/serve.mjs                    # the proof on http://127.0.0.1:5990/blocks/proof/ (the kit under /kit/, read only)
node blocks/proof/run.mjs --only chrome,webkit --routes gl,own [--shots] [--dark] [--rest] [--motion] [--lose]
open -g -a Safari 'http://127.0.0.1:5990/blocks/proof/?run=own,gl&auto&frames=60'   # real Safari says what it found to /report
```

**How a part's picture reaches the page was tried three ways** (November 17, 2026), on 59 of the kit's parts in view
at once (51,000 cubes, 5.9 megapixels of pictures), against the kit's own WebGL2 renderer (`gl`). The machine was
busy throughout, so read the ratios. Frames are the middle gap between frames, ms, with ms on the page's thread in
brackets.

| Real Safari 27.2 | one button a frame | a dialog a frame (8,246 cubes) | all 59 a frame | what breaks |
|---|---|---|---|---|
| `gl`: the kit today | 17 (1) | 16 (1) | 378 (380) | |
| `copy-each`: one canvas nobody sees, `drawImage` to each part's 2D canvas | 17 (10) | 17 (16) | 159 (305) | the page's thread waits for the GPU on every part |
| `copy`: the same, parts of one frame drawn together | 17 (3) | 17 (5) | 231 (441) | wrong pictures: half to all of a part's pixels |
| `own`: each part's canvas shows the device's picture | 17 (0) | 17 (0) | 29 (1) | |
| `page`: one canvas under the window | 40 | 44 | 40 | every change draws everything; cubes cannot be between two layers of HTML |

Safari's window was behind others for that table. With it in front (and the stage as it now is), all 59 a frame:
`own` 18 (1), with 21 of 90 frames late; `gl` 146 (143).

| Chrome 158 | one button | a dialog | all 59 a frame | as fast as it goes, all 59 |
|---|---|---|---|---|
| `gl` | 16.7 | 16.7 | 117 to 183 | 135 to 307 ms |
| `copy` | 16.7 | 16.7 | 150 to 233 | 130 to 172 ms |
| `own` | 16.7 | 16.7 | 17 to 33 | 14 to 28 ms |

`own` is the route taken, and is what `stage.ts` does.

**Its picture against WebGL2's**, pixel by pixel (`run.mjs --motion`; a pixel is off when any channel differs by 3
of 255 or more):

- At rest by day, of a button, a switch, a card, a field with its well, a slider and a list: one pixel of the
  slider, by 3. Chrome, Playwright's WebKit and real Safari agree.
- At rest by night: up to five pixels of a part, by up to 29, beside cubes that glow.
- While bricks turn (a card broken, a dialog or a menu built): 0.02 to 1.8% of a part's pixels, all along the edges
  of turned bricks, the worst of them one sample of four.
- **Why: WebGL2 holds its picture upside down, so its four samples a pixel lie mirrored.** Drawn upside down here
  too and turned back (`look.mjs --part switch --dark` at c2ba6c07 on PR 431's branch, where `pass.draw` took `upsideDown`), the night
  switch, slider and list and the day slider have no pixel off, and a card eight frames into breaking has 7 off
  where it had 2,711. Those 7 are the next line.
- The page hiding what is under it is done here by depth, and by throwing pixels away in the kit: the same at rest,
  and finer here along the line where a turning brick meets the page.

**The kit's own showcase** (`proof/showcase.mjs`, Chrome, November 17): 66 parts and 13.5 million pixels, each part
drawn from the same frame by both. By day 28 pixels are off (21 of them in the meters that grow a plant, whose
cubes are not whole sizes), by night 156 (lettering, blocks and switches that glow), the worst by 36 of 255. The
kit's film (`tools/film.mjs`, eleven scenes) ends `rehearsal passed` on the engine, and the engine says how much it
drew while it was filmed. The renderer is plain modules in `dist/blocks/` after `npm run player`: a page imports
`blocks/renderer.js` and nothing is built for it.

**At rest** it draws nothing, and its pictures stay when the page is scrolled away and back with nothing drawn
again (Chrome, Playwright's WebKit, real Safari). A dialog and a menu in the top layer are right.

**A lost device** (`device.destroy()`, `run.mjs --lose`): a new one is open and all 59 parts are drawn again, the
same picture, 86 ms later in Chrome, 311 in WebKit, 245 in real Safari.

**Memory**, by its own count: 110 MB just after all 59 parts are drawn in one turn (a texture of four samples a
pixel is kept for each of the last four sheet sizes), 46 MB at the end of the proof, and 25 MB more of the parts'
own canvases (a guess at WebGL2's: 40 MB and the same 25). Four seconds after the last part, 0.9 MB.

### Cubes that show as cubes (November 17, after the kit's look was chosen)

The block pass shades the edges of each cube like a bevel, without changing its geometry. On a full-size front
face the band is a fifth of a cube wide, at least one device pixel, with a faint seam at the edge. Side faces are
foreshortened. A cube marked for no seams, or a look with `light.seam` set to zero, has neither band nor seam.
`node test/blocks.mjs` checks the picture: on a grey cube with the light at top left, the green channel reads 216
at the left edge, 223 at the top, 180 at the right, 172 at the bottom and 200 in the middle. Turning the cube a
quarter turn leaves those edges lit from the same direction.

- **From here the pass no longer draws WebGL2's picture.** The comparisons with the kit's own renderer
  (`run.mjs --motion`, `showcase.mjs`, `look.mjs`, and the figures above) were for the port, and are of the pass as
  it was at a0cc2806. They go when the kit's WebGL2 renderer does.
- In the world the picture has one sample a pixel, so the band is a pixel and a half at least and the edges fade
  out as a cube comes down from eight pixels to three. Under a high sun a standing panel's cubes are lit on top
  and shaded below and little at the sides: it reads as courses of tiles.

### Optional finishes and softer ground shadows

The WebGPU renderer accepts two independent options on the frame passed to `draw`. Neither changes the frame's
array lengths. Omit both for the previous rendering, even if unused bits in the AO array are nonzero.

- `groundSoft`: ground-shadow filter radius, in voxels, clamped to 0–2. Try 1 at four pixels per cube.
  Omitted or non-finite uses the old radius, `1.25 * (soft ?? 0.22)`. This only widens the shadow's edge:
  `groundShadow` still controls opacity (0 is off), `soft` still controls self-shadowing, and neither the
  sun's direction nor the canvas bounds change. Allow enough bleed in the canvas for the wider fringe.
- `surfaceBytes: true`: opt **the whole frame** into per-cube finishes. In the second AO word of each cube,
  bits 0–15 keep their occlusion data, bits 16–23 scale both chamfer and seam, and bits 24–31 scale specular
  strength. Both strengths are unsigned bytes. Set **255 / 0** on every cube that should keep its old finish;
  **0 / 0** is matte and seamless. A negative glow channel still suppresses edges. Specular is independent of
  the seam and glow: it reflects direct light in the highlight colour, follows the viewer in the world, and
  adds nothing in shadow. It is a stylised highlight, not a metalness or roughness model.

For example, with integer `chamfer` and `specular` in 0–255:

```js
const word = 2 * cubeIndex + 1;
ao[word] = (ao[word] & 0xffff) | (chamfer << 16) | (specular << 24);
```

Older renderers, including the WebGL2 fallback, ignore these options and still draw the original colours and AO.

### In the world

`blocks/world.ts` stands a panel of the kit's parts in a stage's world: `stand(on, kit, where)`. The panel is real
HTML in the kit's markup, laid out by the browser and seen by nobody; where the kit would paint a part its cubes
are kept, and one of the stage's `passes` draws them with the world's eye and depth. A part on another stands on
that one's face. The light is the kit's own, turned to where the world's sun stands and as strong as the hour
(`march.day`), and the kit's night colours and halos come on when it is night.

```sh
npm run player && node blocks/serve.mjs --port 5991 --as kit
open 'http://127.0.0.1:5991/engine/landing/index.html?kit=/packages/voxelmorphism/&hour=10.4'   # the landing street with a panel on it
node blocks/proof/stand.mjs --hours 10.4,17.8,22     # pictures in ~/.village/engine/blocks/world
```

What is rough there:

- Words that are HTML (a button's label, a switch's) are not in the world: only the kit's voxel lettering and icons.
- Nothing in the world can be pressed yet: the HTML takes no pointer, and a place on the picture is not turned
  into a place on the panel.
- The world's own shadows do not fall on the panel, and it throws none on the world. Its colours are the kit's
  times 0.8, so that white stays under the last pass's glow; they then go through the world's grade.
- Every cube is sent to the GPU again every frame, and a panel must fit one lot (64 parts, one map of depths at
  6 texels a cube; room is made for however many cubes it has): a part too many is left out, with a warning.
- The panel floats where `landing.ts` puts it. Its frame cost is not measured: the GPU was never quiet.

### What it costs

`node blocks/proof/cost.mjs` (November 17):

- **Bytes.** The kit's renderer on the engine is four plain modules, 48 KB as written, 13.7 KB brotli (the block
  pass is 7.1 of them; `probe/gpu.js` comes with it for one function). The WebGL2 renderer it replaces is 4.8 KB
  brotli. Standing parts in the world is 2.2 KB more.
- **Start-up.** A device opens in 1 to 17 ms, and the five pipelines are made in 7 to 60 ms in Chrome. The page
  stage is ready 13 ms after it is asked for in Chrome and 68 ms in Playwright's WebKit, and a first part is drawn
  and done by the GPU at 19 and 78 ms. Real Safari took 10 to 25 ms for the pipelines when it had seen the shader
  before and 0.2 to 1.3 s when it had not; the page is plain CSS until then.
- **No WebGPU, or no adapter:** `renderer()` resolves to null and the kit's page stays plain CSS, with no part
  made live and no canvas added (Chrome and WebKit, the kit's own showcase).

Not tested: an iPhone; a tab really hidden and come back to; Firefox.

Facts paid for are in `.agents/skills/raw-webgpu` ("Many small transparent pictures").
