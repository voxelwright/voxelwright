# The engine (#140)

Village's own engine: a world of 10 cm cells, drawn with raw WebGPU by marching rays, with
its core in Rust built as wasm. Synthetic data, this machine or the tailnet only. What it is,
what it costs and what is not built: `.agents/skills/cell-engine/SKILL.md`.

- `core/`: Rust. Cells, sectors as trees, the generated city, blasts, what stands, the bodies that come loose (they fall, turn, strike, break, and are cells again where they lie), and fire.
  One build for the page and (later) a world process.
- `page/`: the city, flown through. `main.ts` (the page), `world.ts` (boxes of sectors round
  the camera), `worker.ts` (makes sectors), `march.ts` (the ray marcher), `sun.ts` (the sun's shadows kept in maps), `edits.ts`,
  `mover.ts` (the worker that moves what has come loose and burns what burns), `told.ts` (what it says), `pieces.ts` (a body on its way), `crumbs.ts`, `puffs.ts` (fire, smoke and dust),
  `flight.ts` (the flight that measures a device), `input.ts` (the one owner of keys, pointer and touch: a stack of modes), `hud.ts` (the one layer of DOM over the picture: the ask bar, cues, a controls card, notices, lanes' panels), `things.ts` (the made things' records, as the world tells of them), `ask.ts` (one ask, and the one function that sends it to the helper), `people.ts` (everyone's figure, drawn in one call), `residents.ts` (who is out on the pavements, by rule), `presence.ts` (the others in a shared world, their names and what they say).
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
npm run core        # builds core/ as wasm into page/core.wasm (a fresh checkout needs this)
npm run serve       # http://127.0.0.1:5740/city to fly; / runs the measuring flight first; /probe is the probe
```

Fly with WASD, the mouse after a click, Space and C for up and down, Shift for fast, the
wheel for speed. A click uses the tool picked on what is ahead; keys 1 to 7 or the bar pick it: a hammer, a charge, a big charge, a cannon, a torch, a cutter (a level cut 9 m across), a brick. F sets what is ahead alight whatever is picked. On a phone the left
thumb moves, the right thumb looks, and the red button uses the tool picked. H shows how many steps each
pixel took, L and M turn shadows and mirrors off, K traces every shadow instead of using the sun's maps.

A shared world: `node serve.mjs --world ~/.village/engine/world/some.log`, then `/city?shared=1` in as many
windows as you like (`&name=Ada` to be called something; Enter opens a line to say something). Everyone there sees
what anyone breaks, builds or burns, and each other as a figure with their name over it; the file keeps what was
done to the world across restarts, not who was there or what was said. Anything that can send a request can act in it too: `curl http://127.0.0.1:5740/world/`
says how: a body of its own that walks, turns, speaks and is told what is around it (the seat an agent lives in the
world by), what a cell is, what a look along a line meets, a blast, a fire, a thrown ball, an edit. Nobody is asked
who they are: whoever can reach the server can change that world, and can use any name, another's included.

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
  would fall, and only then sent. A reply that cannot be used is asked for again, told why, up to three times.
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
- **A wish is kept to.** What of a reply cannot be used is left out and the rest made: words round the JSON, a part
  that is not the form's, cells that touch nothing, and whatever the core's rule says would fall (taken off from the
  top down until what is left stands). The model is asked again only when more than fifteen in a hundred would be
  lost, and after the third asking the best of its replies is made. A place that is not ground (a roof, a car, the
  sky) means the ground nearest it; a place that is taken means the nearest that is not, out to eight metres, and
  the page says how far. When no place near will take it, the thing is **held**, not dropped: the page asks whether
  to clear the space for it (its box is emptied first; what stood on that falls), to put it where you look next,
  or to let it go. A link that cannot be read does not stop a wish that has words or a picture. What is still
  refused: a model that cannot be run, three replies nothing can be made of, more runs than an edit may be, a link
  alone that cannot be read, no ground within six metres.
- **Made before, made at once** (`make/library.mjs`): the helper keeps the reply each thing of words alone was made
  from, in `~/.village/engine/library/` on your own machine. The same wish, or one whose words are three parts in
  four the same, is made from it with no model: read, checked, stood and placed as a fresh reply is. Shift with
  Enter asks for it anew. A picture or a link is never a key and never kept.
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
- `/page/sound/lab.html` plays every sound by hand, with a picture of what is sounding and what the audio thread
  costs, and takes a patch of your own. It is the place to listen: the checks cannot.
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
again stands it up there. A thing lives once its record's `controls` has a motor (`page/living.ts` `Controls`).
`node test/living.mjs --out dir` drives it in Chrome and films it; `node test/driven.mjs` is the shared world's check;
`cargo test --release living` proves the car, a broom that hovers, flies and rolls, and a frog that hops, natively.

Address options: `?grid=16,8,16` `?levels=9` `?pool=256` `?scale=0.5` `?at=x,y,z`
`?look=yaw,pitch` `?shadows=0` `?mirrors=0` `?maps=0` `?flat=1` `?fire=0` `?hour=18.1` (the time of day; the `[` and `]` keys move it half an hour) `?rain=1` (rain; the R key turns it on and off) `?heat=1` `?fly=0` `?seconds=40` `?bricks=1` (with `&finesun=0`, `&walk=loop`) and `?fine=1` or `2` (#259, experiments in shape finer than a cell: the cell-engine skill says what each is, and what an edit of finer cells may be; without `bricks=1` such an edit is refused whole) `?people=0` (a town with nobody in it) `?sound=0` (silent) `?music=0` (no music) `?name=Ada` (in a shared world).

To a phone on the tailnet: `tailscale serve --bg --https=10140 http://127.0.0.1:5740`, with
`node live.mjs` run after each merge so that the link serves main and not a working tree.

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
- **Kept with the world**, as the asks that put it in and took it out. A world started again has its rules; their
  actors and what each kept are not kept yet, so `start` places them again.
- **What a person types is something heard.** `e.text` and names reach a rule as text to match or to pass on.
- Measured (M1 Pro): 0.4 ms a call for a rule with one actor; 1.5 ms for one that compares every pair of 66
  people; sixteen rules are running 0.2 s after they are asked for and take 18 MB each; with rules that never
  return, fill their memory or stall inside the interpreter, the world answers a question within 7 ms.
- `node test/rules.mjs` checks all of it against the real server: a rule that is no game, changed while it runs,
  kept over a restart; rules that never return, take all the memory they can, stall where no count reaches, flood,
  or reach for bodies that are not theirs.
- **Not there**: a rule hears nothing of blows, of keys, of someone coming near or of what a model made of what was
  said; it cannot change what a person's own body can do, throw anything, show anything on the screen or slow the
  clock. Residents (the town's own rule) are not actors. #264 says which of these come next.

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
- **Not there yet**: a page steps between realms only by loading again with another `?realm=` (next), and `arrive`
  and `look` are kept and told but no page applies them yet (next).

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
node test/read.mjs            # what devices have reported
node live.mjs                 # after a merge: the owner's link serves main from a checkout of its own
node test/shared.mjs --suite  # before a change to the solver or to how a shared world is carried: blast, falls, tools and water run in a shared world
```

Checks from different threads share one GPU, so whatever opens a browser takes a turn first (`test/kit.mjs` `turn`): two at a time on this machine (`ENGINE_TURNS`), the rest wait and say so. A check that is killed gives its turn back.

`npm run check` runs `cargo test`, `tsc`, and these, each also runnable by itself:
`test/city.mjs` (the city made, looked at from five places), `test/blast.mjs` (glass breaks
further than a wall), `test/tools.mjs` (each tool on the bar does what it says), `test/chain.mjs` (three drums of the kind that goes up when hit set each other off), `test/wand.mjs` (the wand's aim: a car is one thing and none of the street, a part and a side of it, a house taken a part at a time, an area on the ground, keys, wheel and a phone's buttons), `test/spells.mjs` (known spells with no model: pink, shiny, steel that does not burn, twice as large, a fireball seen on its way, a change too big for one edit done as several), `test/aims.mjs` (the board's shots face their things), `test/shadows.mjs` (the sun's maps against traced shadows), `test/falls.mjs`
(a cut tree goes over and lies as cells), `test/make.mjs` (a made thing arrives whole or not at all; kept replies, no model, no Chrome), `test/sound.mjs` (the synthesiser measured in Node: true to material, in tune, under its ceiling whatever a patch says, what it costs), `test/music.mjs` (the music's rules measure what they say, the search beats chance, a handover leaves no hole), `test/played.mjs` (instruments by real keys and touches: in tune, heard 3 ms after the key, held as long as the key; one stood in a shared world is offered, taken up, played and put away), `test/heard.mjs` (the real page's sound tapped: a hammer blow, a blast heard late by its distance, a front coming down, rain, the sea overhead), `test/helper.mjs` (the helper answers only the world's own page with the secret; an ask from the page becomes a thing with a record that outlives a restart; keys have one owner; a kept reply, no model), `test/far.mjs` (far from the town the cells have sea where the planet seen from space has it), `test/shared.mjs` (two pages, a plain request and two seats in one world: all see the same, after a reload and a restart too; a seat walks, is stopped by a wall, is heard, is knocked down and gets up), `test/living.mjs` (a car brought to life is got on with E and driven: it goes, stops and sleeps, breaks brick and says what it struck, backs off and turns), `test/driven.mjs` (a living thing in a shared world: a page that joins later finds it, one drives and the other sees, a plain request drives it, it stands where it slept after a restart), `test/people.mjs` (the residents' rule: the same people whenever asked, nobody standing in anything, what a blast does to them, what they cost a frame), `test/flight.mjs` (the measuring flight, then a tree
cut and a house front broken; `--phone` as a phone), `test/probe.mjs`. Each but `make` drives the real page
in the installed Chrome and stubs nothing; `make` puts kept replies in a model's place and says so. They share one server and one browser and run
three at a time, so the times they print are not for quoting: `test/bench.mjs` measures.

The board (`test/rows.mjs`) is the bar: one row for each thing a viewer sees in the two films of
the review the owner linked, a frame of theirs and a repeatable shot of ours, stamped with the
frames a second and the picture size the page held by itself. A row's state changes only when
both have been looked at side by side by someone who did not make ours. The films live in
`~/.village/engine/ref/`, never in the repo.
