# The engine (#140)

Village's own engine: a world of 10 cm cells, drawn with raw WebGPU by marching rays, with
its core in Rust built as wasm. Synthetic data, this machine or the tailnet only. What it is,
what it costs and what is not built: `.agents/skills/cell-engine/SKILL.md`.

- `core/`: Rust. Cells, sectors as trees, the generated city, blasts, what stands, the bodies that come loose (they fall, turn, strike, break, and are cells again where they lie), and fire.
  One build for the page and (later) a world process.
- `page/`: the city, flown through. `main.ts` (the page), `world.ts` (boxes of sectors round
  the camera), `worker.ts` (makes sectors), `march.ts` (the ray marcher), `sun.ts` (the sun's shadows kept in maps), `edits.ts`,
  `mover.ts` (the worker that moves what has come loose and burns what burns), `told.ts` (what it says), `pieces.ts` (a body on its way), `crumbs.ts`, `puffs.ts` (fire, smoke and dust),
  `flight.ts` (the flight that measures a device), `input.ts` (the one owner of keys, pointer and touch: a stack of modes), `hud.ts` (the one layer of DOM over the picture: the ask bar, cues, a controls card, notices, lanes' panels), `things.ts` (the made things' records, as the world tells of them), `ask.ts` (one ask, and the one function that sends it to the helper), `people.ts` (everyone's figure, drawn in one call), `moves.ts` (what a figure does with its limbs, as data), `wear.ts` (what it wears and carries, as data), `residents.ts` (who is out on the pavements, by rule), `presence.ts` (the others in a shared world, their names and what they say).
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
- **A voice for what people say** (`page/sound/voice.ts`): being tried, two ways, off unless asked for.
  `?voices=babble` sounds what others say in the synthesiser: a syllable for each syllable, at the speaker's own
  pitch, falling through a statement and rising at a question, each vowel with its own colour, placed where they
  stand; it says no words. `?voices=speech` is the browser's own speech: real words, a pitch and pace by the
  speaker, louder when near, but not placed in the world and not measured by anything here. The lab has both.
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

## A person's body (#264)

B gets the eye down onto its feet where it is, and back up to fly; `/city?walk=1` starts on foot. W A S D walk the
way the eye looks, Shift runs (4.5 m/s; a walk is 1.4), Space jumps, V puts the eye in the head or behind the
shoulder. On a phone the left thumb walks, and runs when pushed right over. The body is a living thing of the core's
(`bodies/living.rs` `figure`, `page/person.ts`): a box on a leg that is a spring, so it takes the road's steps and
kerbs, is stopped by what is built, stands on rubble, falls, and is thrown by what hits it. Tools and the wand work
on foot as they do flying.

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
  the core nor the page has those words. The guide (`GET /world/`) says the ranges. In the console, alone:
  `engine.me.can = {climb: 100000, fall: 0.3}`, `engine.tempo.rate = 0.25`.
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
- `node test/powers.mjs [--out dir]`: a rule that is no game sets numbers for whoever says so: quick, lighter, climb,
  wings, slow; out of range refused; an actor's body refused; taken out, all as it was.
- `node test/person.mjs [--out dir]`: alone (down, walk, run, the road's steps, jump, aside, stopped by brick that it
  does not break, the eye in the head, flying again), a phone's thumb, and a shared world (stopped by what someone
  built since, a seat told where the feet are, a rule whose actor follows them).
- **Not there**: the body meets the world's cells and, alone, the page's other bodies; in a shared world what
  falls, flies and drives meets its ghost in the world's process, so a blow reaches it a moment late and it does not
  block a car. The eye behind goes through walls. Running and jumping
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
  house (no way) 900 places in 27 ms, and not looked for again for three seconds. `node test/about.mjs`.
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
- **From the ask bar** (`page/making.ts`, the helper's `/rule`, `/imagine`, `/realm`). Words decide what is asked
  for. "Create a realm called matrix. You are Neo. ..." is a realm: the asker chooses to be asked a few things first
  or not, the idea is fleshed out by their model (`make/realm.mjs`: what it is about, how it looks, at most three
  short questions, read as strict data), the realm is made on the server (`POST /realms`), its rules are written,
  tried and put into it, and the page offers to step in (today by opening the realm in place of this world: the
  portal is the REALMS lane's). Words that say what happens ("someone who waves when I say hello", "a game of tag",
  "let me fly", "give them all red coats") are a rule for the world the asker is in; in a realm with one rule they
  change that rule, put again under its id, so its people and what it kept stay. A question, a greeting, or words
  that begin as talk does ("I am in the Matrix") are said to whoever is there. Anything else is a thing, as
  before; `thing:` or `rule:` before the words says which. What is asked for from a page in a realm is made in that
  realm. An ask may be 4,000 characters; past that the asker is told. Real run, November 13 (Opus 5.5 for the
  rules, Sonnet 5.5 for the idea): the Matrix realm from the bar, asked one question back after 7 s, ready 138 s
  after Enter, stepped into; inside, a resident answered "hello there" and another the question about the world;
  "give them all red coats" changed its rule in 41 s. Pictures: `~/.village/engine/making-ui/realm-matrix/`.
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
- **A realm's music** (the same files, and `page/sound/music/`). `world.music({like, pace, mode, drive, now})`: a
  rule says what the realm's music is like and changes it as its own numbers change. It is a mood, not a track:
  `like` is one of the seven kept moods, `pace` and `mode` put it at another speed and in another scale, `drive` is
  how much of it is playing; both change at once in the piece that is playing. A new mood or mode comes in at the
  next bar, or the next beat with `now`. `like: null` gives the music back to the place; so does taking the rule out. A realm
  that says nothing keeps the place's own. `node test/tuned.mjs` checks it with a lighthouse whose music fills as the
  rule's wind rises, and a dancing class that sets pace and mode by what is said; a page that joins later plays what
  was last said, and what is heard keeps the pace asked. A model asked for a storyteller wrote one whose music
  follows how far her story is (November 14).
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
- **The portal, as an experiment** (`page/portal.ts`, from the console; no key yet): `await engine.portal.open(id,
  {at: [x, y, z], yaw, size: [wide, high], to: [x, y, z]})` stands a window in this world that shows the other
  realm live, from an eye as far from `to` as this eye is from the window. Walk through it (or `engine.portal
  .step()`) and the page is in the other realm, the window leading back. `node test/portal.mjs --out dir` measures
  it and keeps pictures; the numbers are in the cell-engine skill, "The portal".
- **Not there yet**: a key that opens and closes the portal, and the wheel that picks a realm (next). The helper makes things only in the realm the page
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
node plug.mjs --port 5801 --at <checkout> # for a game served from a checkout of its own: moves it to origin/main first
```

- **A plugin is a folder**, `plugins/<name>/`:
  - `world.mjs`, one file: `export default (world) => ({ does: { name(rule, want, now, wrong) {} }, dropped(ruleId) {}, state() {}, close() {} })`.
    `does` is what a rule may ask for (`world.<name>({...})` in a rule arrives as `want`: check every field as a
    stranger's). `world` is the doors it is given: `folk` (everyone with a body), `text`, `tell` (a body, to pages),
    `release`, `look`, `stand`, `tall`, `core()` (the core's exports as they are now: ask each time), `happen(event, e)` (every rule that listens hears it), `hear(ruleId, event, e)`
    (one rule hears it), `pages.state(v)` and `pages.once(v)` (to its page side), and `was` (what the version before
    handed on through `state()`).
  - `page.ts`, if a page needs anything: `export default ({ engine, link }) => ({ state(v) {}, once(v) {}, close() {} })`.
    `state` is what is so (given again to a page that joins later and to a new version; `null` when the page steps to
    another realm), `once` is something that happens now, `close` takes away whatever it put on the page.
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
- **There now**: `plugins/sound` (`world.sound`: a rule's sound, told to pages once), `plugins/music` (`world.music`: what a realm's music is like, with a page side that hands it to the page's music), `plugins/look` (a rule asks what the world's cells put between two places, or round a place, and
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
  built it's wait, not the player's. **Lost at a swap**, as at a restart: bodies in the air, fire, water on the
  move. Living things get up where they last slept. **Not swapped**: the core a person's own body walks in
  (`shadow` in `main.ts`) and, in a world that is not shared, the mover's: they go on with the old build until the
  page is loaded again.
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
- **They remember.** The world's process keeps what each actor lately heard and answered (the last eight lines,
  for an hour, while the world runs) and shows it to the model with the next thought: a rule keeps nothing for it.
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
further than a wall), `test/tools.mjs` (each tool on the bar does what it says), `test/chain.mjs` (three drums of the kind that goes up when hit set each other off), `test/wand.mjs` (the wand's aim: a car is one thing and none of the street, a part and a side of it, a house taken a part at a time, an area on the ground, keys, wheel and a phone's buttons), `test/spells.mjs` (known spells with no model: pink, shiny, steel that does not burn, twice as large, a fireball seen on its way, a change too big for one edit done as several), `test/hands.mjs` (what a realm's rule offers becomes keys, buttons and wand entries; the rule hears who did which and whether the aim met a person, an actor or cells; what it shows is a line, meters, a score and a choice on the screen, as text), `test/aims.mjs` (the board's shots face their things), `test/shadows.mjs` (the sun's maps against traced shadows), `test/falls.mjs`
(a cut tree goes over and lies as cells), `test/make.mjs` (a made thing arrives whole or not at all; kept replies, no model, no Chrome), `test/sound.mjs` (the synthesiser measured in Node: true to material, in tune, under its ceiling whatever a patch says, what it costs), `test/music.mjs` (the music's rules measure what they say, the search beats chance, a handover leaves no hole), `test/played.mjs` (instruments by real keys and touches: in tune, heard 3 ms after the key, held as long as the key; one stood in a shared world is offered, taken up, played and put away), `test/sounded.mjs` (a rule makes a sound: a clock strikes, a smith hammers an anvil of the rule's own, rubbish is refused, a page hears each from where it is), `test/heard.mjs` (the real page's sound tapped: a hammer blow, a blast heard late by its distance, a front coming down, rain, the sea overhead), `test/helper.mjs` (the helper answers only the world's own page with the secret; an ask from the page becomes a thing with a record that outlives a restart; keys have one owner; a kept reply, no model), `test/far.mjs` (far from the town the cells have sea where the planet seen from space has it), `test/shared.mjs` (two pages, a plain request and two seats in one world: all see the same, after a reload and a restart too; a seat walks, is stopped by a wall, is heard, is knocked down and gets up), `test/living.mjs` (a car brought to life is got on with E and driven: it goes, stops and sleeps, breaks brick and says what it struck, backs off and turns), `test/driven.mjs` (a living thing in a shared world: a page that joins later finds it, one drives and the other sees, a plain request drives it, it stands where it slept after a restart), `test/person.mjs` (a person's own body: walks, runs, jumps, is stopped by what is built, seen by others and by a rule where its feet are), `test/powers.mjs` (a rule sets what a person's body can do, and the world's clock), `test/blows.mjs` (a thrown ball strikes a person and an actor and the rule hears it; a push, the ground, a car), `test/people.mjs` (the residents' rule: the same people whenever asked, nobody standing in anything, what a blast does to them, what they cost a frame), `test/flight.mjs` (the measuring flight, then a tree
cut and a house front broken; `--phone` as a phone), `test/probe.mjs`. Each but `make` drives the real page
in the installed Chrome and stubs nothing; `make` puts kept replies in a model's place and says so. They share one server and one browser and run
three at a time, so the times they print are not for quoting: `test/bench.mjs` measures.

The board (`test/rows.mjs`) is the bar: one row for each thing a viewer sees in the two films of
the review the owner linked, a frame of theirs and a repeatable shot of ours, stamped with the
frames a second and the picture size the page held by itself. A row's state changes only when
both have been looked at side by side by someone who did not make ours. The films live in
`~/.village/engine/ref/`, never in the repo.
