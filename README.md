# Voxelwright

Voxelwright is one systemic, multiplayer world that people make by talking, and the stack that builds it: its own engine (10 cm cells drawn with raw WebGPU, its core in Rust), UI kit (Voxelmorphism), fonts, sound, servers and site generator. Today the world is San Francisco, live at [voxelwright.world](https://voxelwright.world). Pavlo Zahynailo builds it with AI agents.

![San Francisco in voxels, seen from Ina Coolbrith Park](site/static/landing/ina.webp)

*The first view: San Francisco in voxels from Ina Coolbrith Park, rebuilt from Frank Schulenburg's photograph ([CC BY-SA 4.0](CREDITS.md#ina-coolbrith-park-landing)).*

## Walk the city

Install Node.js 25 or newer and stable Rust, then add the Wasm target once with `rustup target add wasm32-unknown-unknown`. From the repository root on macOS or Linux:

```sh
./world
```

It builds the core, downloads and verifies the pinned city data, builds the realm and serves it. Open the printed address in a WebGPU browser such as Chrome and choose the **EXPLORE** board twice: the first click arms it, and a second at least 300 ms later enters the city. The [quickstart](guide/quickstart.md) covers mirrors, the Dev Container and what to try first.

## What works today

- Walk, fly and drive through 155 one-kilometre squares of San Francisco, on a desk or a phone.
- A sky that follows the city's real hour and weather.
- Make new things by typing a wish, with your own AI provider key, under **Your AI…** in the realm settings.
- Host a shared world on your own machine that others join through a master server.

## Where things are

| Folder | What it is |
| --- | --- |
| [engine/](engine/README.md) | The engine: the Rust core (`engine/core`), the WebGPU page (`engine/page`), the world server and the San Francisco build (`engine/sf`, `engine/bay`). |
| [engine/kit/](engine/kit/README.md) | Voxelmorphism, the UI kit the realm and the site share. |
| [master/](master/README.md) | The master server, which lists player-hosted lobbies and passes one WebRTC offer and one answer per join. |
| [site/](site/README.md) | The site generator for the owner's front page and blog at zahynailo.dev. |
| [deploy/](deploy/README.md) | The two Cloudflare Workers: the realm at voxelwright.world and the site at zahynailo.dev. |
| `guide/` | The documentation, published with Mintlify. |
| `.agents/` | Skills for the agents that build the project. [AGENTS.md](AGENTS.md) holds the working rules. |

Read next:

- [Voxelwright in one page](guide/index.md): how the parts connect.
- [The project map](guide/project.md): every part, every guide page and what each name means.
- [How the project is built](guide/building.md): agents, skills, the gate and the documentation check.
- [Contributing](CONTRIBUTING.md): how to test each part.

## Earlier prototypes (paused)

Village, a private home for a family with villagers, reminders and the Elder, came first. It and its shared street are paused. Their code and commands are in [home/](home/README.md), [host/](host/README.md) and [street/](street/README.md), and [Village](guide/village.md) says what they were and which ideas carry forward.

## Checks

The root check runner covers the documentation and the paused Village folders. Each active part has its own tests; see [Contributing](CONTRIBUTING.md). Install the dependencies with `npm ci` in both `home/` and `host/`, then run from the repository root:

```sh
npm run check
npm run check -- --only docs docs-coverage
npm run check -- --ci --webgl --timeout 240
```

Run the last command before merging. See the [runner options](guide/check-cli.md) and [check names and prerequisites](guide/checks.md). Logs are written to `.check/`. GitHub runs the check workflow on pull requests and pushes to main.

## Licences

Copyright 2026 Pavlo Zahynailo. Project code carries the [Apache License 2.0](LICENSE). Project documentation and prose carry [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), except for the owner's personal writing in [site/posts](site/posts/NOTICE) and [site/writing](site/writing/NOTICE), which is all rights reserved. The project's Vox fonts carry the SIL Open Font License 1.1 with reserved names. Third-party works and baked data retain their source terms. See [credits](CREDITS.md), [data licences](DATA-LICENSES.md) and [NOTICE](NOTICE).

Voxelwright and Voxelmorphism are names belonging to Pavlo Zahynailo. Please choose another name for your fork.
