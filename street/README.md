# The street (#118)

A world process that owns one simulation, and a page that draws it: one block of a hill
street in San Francisco, shared by everyone on it. It began as a spike that answered three
questions: can the solver run a shared world outside a page, does your own walker feel
right over a network, and does the transport reach past this machine. There is no sign-in
and the residents are synthetic.

- `src/scene.ts`: the block as the engine's own data. The street, its lamps and trees, crates,
  balls and bins are toys; a resident is a toy with one upright part and a `walker` gadget whose
  knobs are the seat's input.
- `src/houses.ts`: the houses along it, each a toy of one still part made of pieces.
- `src/block.ts`: the engine's `World` (`home/src/engine/world.ts`) built from those toys, with
  a seat for each resident.
- `src/server.ts`: steps it 60 times a second and gives each WebTransport session a seat.
  It refuses to listen on every interface. `run.mjs` starts it through Vite's in-process
  loader, because `World` is written for a bundler.
- `src/walk.ts`: how a walker moves. The world applies it; the page runs it ahead of the answer.
- `src/wire.ts`: datagrams for poses and inputs, JSON lines for what must arrive.
- `src/make.ts`: making by talking. One sentence in, one physical thing out: a model writes the
  thing as the engine's own toy data (one body drawn as several shapes), the engine's checker
  holds it to the street's limits, a scratch world lets it settle, and one failed answer is
  sent back once with the reason. Nothing the model writes runs.
- `src/agents.ts`: a door for agents. A resident may be an agent in its own harness (a Claude Code
  session on its owner's subscription), sat down through a standard MCP server at `/mcp` with a
  key a resident asked for. It gets a body like anyone's and these tools: `arrive`, `look`,
  `walk_to`, `face`, `say`, `make`, `guide`, `build`, `undo`, `top`, `observe`.
- `src/puppet.ts`: a solver core that solves nothing: each body is where it was last put.
- `client/`: the page. It runs the engine's `World` too, over the puppet, so it draws the same
  toys the world process built (their materials, paint and shadows), posed from the wire.
  `client/place.ts` draws the land round the block, `client/figure.ts` the residents.

## Play it

Walk with WASD (or the left side of a phone's screen), jump with Space, turn with Q and E or
by dragging. Press Enter and type what you want: "a big red dog", "a plank bridge across the
trench", "stairs". It appears on the ground in front of you, for everyone. The `make` button
switches to `say`, which puts your words over your head. `undo` takes back the last thing you
made; `top` takes you back to where you arrived. A trench crosses the street, too wide to jump
and too deep to climb out of. Open the page with `?name=Pavlo` to be called that.

To bring an agent of yours: press `+agent`. The page shows you, and only you, a command with a
key in it (good for 12 hours, one agent). Run it where that agent's Claude Code is, on this
machine, then tell the agent to join the street: it arrives with a name over its head, can see
what is around it as data, walk, talk, and make or build things like you.

## Run it

```sh
cd home && npm ci      # the solver is the home's
cd street && npm ci
npm run world          # node run.mjs: WebTransport on 127.0.0.1:4433, /where and /stats on 4434
                       #   -- --maker sonnet   turns making on (spends the signed-in Claude Code's usage);
                       #                       --maker stub makes a crate of anything, for checks
                       #   -- --world <dir>    where made things are kept (default ~/.village/street)
npm run page           # http://localhost:5318
```

Over the tailnet: `npm run world -- --host 127.0.0.1 --host <tailnet address> --name <tailnet name>`
and `tailscale serve --bg --https=10118 http://localhost:5318`. WebTransport is QUIC, which
`tailscale serve` does not carry, so the page comes through `serve` (a secure context) and
the session goes straight to the tailnet address, accepted by the certificate's hash.

`?predict=0` draws your walker from the world's answer instead of ahead of it;
`?delay=50` holds everything 50 ms each way; `?stop=1` stops your walker at things as they
are drawn. The page has buttons for all three, and says on screen why it could not sit down.

The page is drawn on the home's stage (`home/src/plugins/renderer.ts`, its post effects and
its sky), so it shares the home's quality tiers: `?q=low` asks for the cheapest one.
`?post=0` leaves the post effects out, `?sky=0` the sky, and `?lens=0.5` adds the home's
miniature blur for a picture. Residents are drawn as the home's felt villagers
(`client/figure.ts`) over the capsule the world simulates.

The block is a place: a roadway between two pavements, sixteen painted houses stepping
down the hill (`src/houses.ts`, each a toy of one still part made of pieces), lamps, trees,
two bins that can be knocked over, and barriers where it ends (`src/scene.ts`). All of that
is the world's data, so the world process, every page and an agent hold the same street.
Round it the page alone draws the land (`client/place.ts`): the hill carried on to a crest
and down to the bay, streets and rows of the same houses along them, a red bridge and the
hills across the water. Nothing can go there yet. `?land=0` leaves it out.

## Checks

```sh
npm run tick -- 1000 100 20                 # the block on World, every body kept awake
npm run two -- --delays 0,25,50,100         # two browsers, a fresh world per case
npm run push -- --delays 0,50,100           # walking into a crate, three worlds per case
node test/make.ts                           # making end to end with a stand-in maker
node test/clear.mjs [lab.json]              # a made thing asked for at a house front, a tree or an end stands in the open
node test/agent.ts                          # an agent's seat, with a plain MCP client as the agent
node test/reach.ts <url> [chromium|webkit]  # can a browser sit down from this address
# With a real model, by hand:
node test/make-lab.mjs out.json sonnet,opus "a big red dog" "a ladder"   # what does a model make of a sentence
node test/gallery.ts out.json pictures/                                  # photograph it all as one sheet
node test/shots.ts out.json look/ [q=low]                                # the same six views every time, to compare one look with the next
node test/clip.ts clip/ sonnet "a plank bridge across the trench"        # record the walk, the ask and the crossing
node test/resident.ts clip/ sonnet sonnet                                # a real Claude Code session as a resident, recorded
npm run typecheck
```

## What it measured (November 10, 2026)

The first tables are from the spike's first server, which stepped bare solver bodies
(`src/sim.ts`, since removed). The server now steps `World`; the last section has its numbers.

**The solver runs in Node as it is.** One change to `home/src/engine/jolt.ts`: the page asks
the bundler where the wasm is, Node lets the package find it. Loads in 42 ms.

**Ticks, every body kept awake, two walkers, one thread** (budget 16.7 ms):

| Bodies | Machine | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| 342 | Ally (Ryzen Z1 Extreme, load 1) | 1.8 ms | 2.0 | 2.2 | 6.7 |
| 1,102 | Ally, load 1 | 6.0 ms | 6.7 | 7.2 | 11.2 |
| 342 | dev Mac, load 8 | 2.0 ms | 2.4 | 3.1 | 9.0 |
| 1,102 | dev Mac, load 9 | 6.3 ms | 7.7 | 9.7 | 53.6 |

Past about 1,100 awake bodies is not measured (a 3,200 run stacked crates inside each
other and says nothing). The street's bodies here are bare solver bodies: the engine's
`World` adds its own work per contact and is not in these numbers. Resting bodies sleep and cost nothing.

On the dev Mac at load 30 (other threads building) the tick started up to 244 ms late in one
run. The world process needs a machine that is not also running builders.

**Feel, two Chrome pages on loopback, 144 things, snapshots at 30 a second:**

| Held each way | Round trip | Key to motion, walker ahead | Key to motion, from the answer | Guess put right, walking free (p95) |
| --- | --- | --- | --- | --- |
| 0 ms | 1 ms | 13 ms | 98 ms | 0.2 mm |
| 25 ms | 51 ms | 14 ms | 150 ms | 0.4 mm |
| 50 ms | 102 ms | 14 ms | 214 ms | 0.7 mm |
| 100 ms | 203 ms | 15 ms | 292 ms | 0.4 mm |

Drawn ahead, your walker answers in one frame at any delay, and the page's guess matches the
world to under a millimetre on open ground (one run at machine load 31 read 6.4 mm; a ball
rolling into the walker is put right by tens of millimetres). Drawn from the answer it is late by the round
trip plus about 100 ms (two snapshots of drawing in the past, and a tick or two).

**What does not feel right yet: pushing.** The page's guess knows the ground and nothing that
moves. A crate at rest starts to move one round trip and about 50 ms (a snapshot and a tick
or two) after the walker drawn ahead reaches it. Three fresh worlds for each case, on a quiet
tick; the middle and the range:

| Held each way | Touching a crate to seeing it move | Drawn inside the crate, walking into it | With `?stop=1` |
| --- | --- | --- | --- |
| 0 ms | 50 ms (33-51) | 186 mm (114-186) | 0 mm |
| 50 ms | 151 ms (150-167) | 482 mm | 0 mm |
| 100 ms | 250 ms (249-266) | 482 mm | 0 mm |

`?stop=1` makes the walker stop at things where they are drawn. It is never drawn inside one,
but it then stands behind where the world has it, and while it keeps pushing its place is put
right by 150 to 480 mm (p95) at every answer. Drawing other things one snapshot back instead
of two changed nothing: a thing at rest has no later pose to wait for. Neither knob is the
fix. The page has to guess the push itself, by running the same solver for the things near
your walker (the home already runs it in a page).

**The wire.** 26 to 38 kB/s down and 0.9 kB/s up for each seat with 24 balls rolling, by how
much is awake (12 bytes a pose, only what is awake). No snapshot lost on loopback.

**Reach.** Through `tailscale serve` for the page and the tailnet address for the session,
Chrome 158 and Playwright's WebKit 27.2 both sat down. This was the dev Mac reaching its own
tailnet address: no real network was crossed. Not tested: an iPhone, Wi-Fi loss and jitter,
a second machine (the Ally's Tailscale runs in userspace and has no UDP path), sustained load.

## The block on the engine's own `World`

`World` runs in Node as it is, loaded through Vite's in-process module runner, so the street
does not need it split into simulation and view first (PR 120 took out the few places that
assumed the home's page). `npm run tick` builds the block, walks two residents and times it:

| Bodies, all awake | Bare solver (`src/sim.ts`) | On `World` |
| --- | --- | --- |
| 342 | 2.0 ms p50, 2.4 p95 | 2.0 ms p50, 2.3 p95 |
| 1,102 | 6.3 ms p50, 7.7 p95 | 9.0 ms p50, 12.2 p95 |

(Dev Mac, load 8.)

With the server stepping `World`, two browsers measured the same as on the bare solver:
key to motion 13 to 14 ms drawn ahead and 98 to 229 ms from the answer; touching a crate to
seeing it move 67 ms with nothing held and 167 ms at 50 ms each way. On open ground the page's
guess is now put right by 0.0 mm (p95): the block turns air drag off, and the walker gadget
applies exactly the rule the page runs.

What it found in the engine:
- A part is at most 20 m from its middle (`toy.ts`), so the road is laid in two lengths.
- The speed limit rule (12 m/s) holds balls on a long hill; a street wants it higher.
- A thing put back because it was lost is not always said: a speed limit said in the last
  quarter second hides the event.
- Solver contact settings are tuned for toy-sized things. They held for 0.6 m crates.

The page draws through `World` as well: the world process sends each toy as it built it,
less its gadgets and wires, and the page builds it over a solver core that is posed, not
stepped. Page work is 1.2 ms a frame for 145 moving things (WebGPU, Chrome). `node test/look.ts
out.png` takes a picture of it.

## Making by talking (November 10, 2026)

Real-model runs by hand, on the owner's signed-in Claude Code:

- Ten street-scale sentences (a big red dog, a pool noodle, a plank bridge, a ladder, a large
  rubber duck, a park bench, a seesaw, a small car, a snowman, stairs to a platform) on three
  models: all 30 answers passed the checker and settled. Haiku took 7 s at the middle (9
  pieces a thing), Sonnet 14 s and Opus 14 s (14 pieces). Sonnet and Opus read clearly as
  the thing asked for; Haiku is cruder. The run cost about a dollar.
- Things on a round bottom rolled away down the slope (the snowmen, a duck). The maker is now
  told about the slope, and a many-pieced thing that is on its side within two seconds is
  sent back once.
- End to end: a walker at the trench typed "a plank bridge across the trench"; Sonnet's bridge
  appeared spanning it 16 s later and the walker crossed. The maker is told where the ground
  drops away in front of the asker.

What a made thing is: nearly always one part made of pieces (`PartSpec.pieces`), so a dog is one
body. Its material decides how it moves; the street adds stone, foam, plastic, fur, ice and
jelly to the home's. The street's limits are sizes to 4 m, 4,000 kg, 8 parts, 40 pieces a part,
and one gadget kind (a pivot). 80 made things at most, each kept as a file under
`<world>/made/`, so they are there after a restart.

Walkers now step onto things up to 0.45 m high (a kerb stone, a stair, a bridge's deck), and
the page keeps your walker at the height the world last said it stands at on a thing.

## An agent as a resident (November 10, 2026)

A real run, by hand: the `claude` CLI (Sonnet) was given a key and one goal, "get to the far
side of the trench". It arrived as Juno, greeted the resident there, walked down, wrote a stone
bridge itself and placed it with `build` (the street's maker was not called), checked with
`look` that it was in place, walked over and said so: 15 turns, 36 s, 18 cents. A page watched
the whole thing. The world's tick stayed on time (late by 2.2 ms at p95).

An agent thinks in seconds, so it says where to go (`walk_to`) and the world walks its body
there, hopping once when stuck and reporting `blocked` when that does not help. What it is
told of the street is data: where it stands, who is near, what was made and by whom, what was
said. A seat nobody calls for five minutes is given up; its key sits down again.

Not done: the page steps nothing, so a push is still seen late. Cards and glows are not sent,
so made things have no score cards or lamps. A made thing can land on someone. Asking spends
the world owner's Claude usage and there is no sign-in: tailnet only. The agents' door listens
on this machine only, so an agent must run on the same machine as the world. Fire's GPU field and
invented mechanics' page sandbox have not been tried off the page.
