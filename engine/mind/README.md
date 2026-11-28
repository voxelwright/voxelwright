# engine/mind

The people of a world who answer when spoken to. A rule asks one of its actors to think (`world.think`) or asks a model to read what someone said (`world.read`). The ask goes to a helper on someone's own machine, which has that person's own Claude Code answer, and the answer comes back to the rule as data. The world server never runs a model.

The concepts, the full loop and the trust boundary are in [living things and people](../../guide/living.md#people-who-answer).

## Files

| File | Runs in | What it does |
| --- | --- | --- |
| `think.mjs` | The world process | The `think` and `read` wants: checks an ask (including optional Blackboard `context`), hands it out, checks the answer, has the actor say it, tells only the asking rule. Remembers each actor's last 8 lines of talk for an hour. |
| `door.mjs` | The server | Hands asks to the one helper that voices the world (`GET /world/minds`) and takes its answers (`POST /world/mind`). The first helper to come voices the world until it closes or is quiet for 10 s. |
| `voice.mjs` | The helper | Asks the world what to answer, has the model answer, posts the first sentence at once and the rest with the notes. Counts what it spends. `voices` covers home and every awake realm with a page in it. |
| `model.mjs` | The helper | Runs Claude Code once per reply with no tools, no MCP servers, no settings and no session, in an empty folder. Keeps processes started ahead so an answer does not wait for one to start. |
| `form.mjs` | Both sides | The fixed system texts (`SYSTEM`, `READING`), how an ask is quoted to a model (`asked`, `reading`), strict Blackboard context sanitization (`sanitizeContext`), standardized behavioral action notes (`BEHAVIOR_NOTES`), and how a reply is read (`read`, `readNotes`, `worldly`, `noted`). |
| `talk.rule.js` | A rule's box | The default street-talk rule: handles quick greets/antagonizes/defuses and unvoiced worlds with 0 ms fast barks and per-pair memory, and hands open-ended or escalated talk to `world.think` with Blackboard `context` and `mood`/`intent`/`trust_delta` notes to drive `flee`, `follow`, `confront`, `report`, and `help` actions. |

Model output is data. `form.mjs` quotes everything a rule or a person wrote—including optional Blackboard `context` fields (`district`, `weather`, `activity`, `mood`, `reputation`, `witnessed`, `nearby_made`)—as JSON strings under labels, reads only what follows `SAY:`, refuses words shaped like an address or a tag, and coerces each note (including `BEHAVIOR_NOTES`) to the kind the rule asked for or null. `think.mjs` checks it all again in the world process.

### Systemic consequence & fast-bark helpers

Companion classical modules in `engine/rules/` feed into and pair with `engine/mind/`:

- `engine/rules/memory.mjs`: bounded per-NPC attitude/trust LRU memory, district reputation & `WantedHistory` decay, local proximity gossip (max 2 hops, never global), and `descriptorOf` appearance/vehicle snapshots.
- `engine/rules/dispatch.mjs`: non-omniscient Witness Chain FSM (interceptable 4–8 s reporting window + bystander secondary witnesses), descriptor-based Heat & outfit/vehicle-swap evasion, and last-known-sighting Tactical Dispatch.
- `engine/rules/barks.mjs`: 0 ms deterministic contextual bark & Greet/Antagonize social escalation engine with neighborhood tone profiles and an `escalateToMind` handoff flag.

## Run it

Run commands from `engine/`. Start a world, then a helper that voices it:

```sh
node serve.mjs --port 5795 --world ~/.village/engine/talk/try.log
node helper.mjs --world http://127.0.0.1:5795 --port 5796
```

| Helper flag | Default | What it sets |
| --- | --- | --- |
| `--voice` | `sonnet` | Which of your models answers |
| `--no-voice` | | Nobody is voiced from this machine |
| `--voice-most` | 40 | The most answers a minute |
| `--voice-warm` | 2 | Processes kept started ahead |

`--reply` on the helper also turns voicing off, since no model runs then.

## Check it

```sh
node test/mind.mjs             # kept real replies and replies written to be wrong, a stand-in model, the real server
node test/witness-dispatch.mjs # witness chains, descriptor Heat, proximity gossip, and 0 ms barks
node test/mind.mjs --real      # asks the kept cases of the real model again, on your subscription
```

The kept cases are in `test/mind-kept.json`. A pass with the stand-in proves the plumbing, not what a model says.
