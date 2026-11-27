# engine/mind

The people of a world who answer when spoken to. A rule asks one of its actors to think (`world.think`) or asks a model to read what someone said (`world.read`). The ask goes to a helper on someone's own machine, which has that person's own Claude Code answer, and the answer comes back to the rule as data. The world server never runs a model.

The concepts, the full loop and the trust boundary are in [living things and people](../../guide/living.md#people-who-answer).

## Files

| File | Runs in | What it does |
| --- | --- | --- |
| `think.mjs` | The world process | The `think` and `read` wants: checks an ask, hands it out, checks the answer, has the actor say it, tells only the asking rule. Remembers each actor's last 8 lines of talk for an hour. |
| `door.mjs` | The server | Hands asks to the one helper that voices the world (`GET /world/minds`) and takes its answers (`POST /world/mind`). The first helper to come voices the world until it closes or is quiet for 10 s. |
| `voice.mjs` | The helper | Asks the world what to answer, has the model answer, posts the first sentence at once and the rest with the notes. Counts what it spends. `voices` covers home and every awake realm with a page in it. |
| `model.mjs` | The helper | Runs Claude Code once per reply with no tools, no MCP servers, no settings and no session, in an empty folder. Keeps processes started ahead so an answer does not wait for one to start. |
| `form.mjs` | Both sides | The fixed system texts (`SYSTEM`, `READING`), how an ask is quoted to a model (`asked`, `reading`) and how a reply is read (`read`, `readNotes`, `worldly`, `noted`). |
| `talk.rule.js` | A rule's box | The rule the engine gives a world once someone's model answers for it: the nearest resident within 9 m stops and answers. |

Model output is data. `form.mjs` quotes everything a rule or a person wrote as a JSON string under a label, reads only what follows `SAY:`, refuses words shaped like an address or a tag, and coerces each note to the kind the rule asked for or null. `think.mjs` checks it all again in the world process.

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
node test/mind.mjs --real      # asks the kept cases of the real model again, on your subscription
```

The kept cases are in `test/mind-kept.json`. A pass with the stand-in proves the plumbing, not what a model says.
