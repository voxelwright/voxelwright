# The street (spike for #118)

A world process that owns one simulation, and a page that draws it. It answers three
questions before any of the home's engine is moved: can the solver run a shared world
outside a page, does your own walker feel right over a network, and does the transport
reach past this machine. It is a spike: plain shapes, no sign-in, synthetic residents.

- `src/scene.ts`: the block as the engine's own data. The street, crates and balls are toys; a
  resident is a toy with one upright part and a `walker` gadget whose knobs are the seat's input.
- `src/block.ts`: the engine's `World` (`home/src/engine/world.ts`) built from those toys, with
  a seat for each resident.
- `src/server.ts`: steps it 60 times a second and gives each WebTransport session a seat.
  It refuses to listen on every interface. `run.mjs` starts it through Vite's in-process
  loader, because `World` is written for a bundler.
- `src/walk.ts`: how a walker moves. The world applies it; the page runs it ahead of the answer.
- `src/wire.ts`: datagrams for poses and inputs, JSON lines for what must arrive.
- `client/`: the page (three.js).

## Run it

```sh
cd home && npm ci      # the solver is the home's
cd street && npm ci
npm run world          # node run.mjs: WebTransport on 127.0.0.1:4433, /where and /stats on 4434
npm run page           # http://localhost:5318
```

Over the tailnet: `npm run world -- --host 127.0.0.1 --host <tailnet address> --name <tailnet name>`
and `tailscale serve --bg --https=10118 http://localhost:5318`. WebTransport is QUIC, which
`tailscale serve` does not carry, so the page comes through `serve` (a secure context) and
the session goes straight to the tailnet address, accepted by the certificate's hash.

`?predict=0` draws your walker from the world's answer instead of ahead of it;
`?delay=50` holds everything 50 ms each way; `?stop=1` stops your walker at things as they
are drawn. The page has buttons for all three, and says on screen why it could not sit down.

## Checks

```sh
npm run tick -- 1000 100 20                 # the block on World, every body kept awake
npm run two -- --delays 0,25,50,100         # two browsers, a fresh world per case
npm run push -- --delays 0,50,100           # walking into a crate, three worlds per case
node test/reach.ts <url> [chromium|webkit]  # can a browser sit down from this address
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

Not done: the page still draws its own plain shapes from sizes and colours it is sent. Next it
draws the same toys the server built (a `World` there over a solver core that is posed, not
stepped), and then steps the things near your walker to guess pushes. Fire's GPU field and
invented mechanics' page sandbox have not been tried off the page.
