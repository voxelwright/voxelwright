---
title: Walk San Francisco
description: Walk San Francisco in voxels on your own machine with one command.
---

`./world` builds the engine, fetches the pinned city and serves it on your machine. It is the same San Francisco that runs at [voxelwright.world](https://voxelwright.world).

## Run it

Install Node.js 25 or newer and stable Rust with Cargo. Add the Wasm target once with `rustup target add wasm32-unknown-unknown`. Open the world in a WebGPU-capable browser such as Chrome.

From the repository root on macOS or Linux, run:

```sh
./world
```

It runs three steps and prints the time of each:

1. **Core build.** Builds the Rust core to WebAssembly. A later run with the same committed core and compiler reuses that build from `~/.village/engine/core-cache`.
2. **Data fetch and verification.** Downloads the city data bundle named by the pin (about 800 MB), printing MB received, checks it is for that pin and that every file is the one packed, and records that in a stamp in the checkout's own data folder. A later run whose stamp, manifest and files still match skips the download. Run `HOME=.voxelwright node deploy/data.mjs fetch --force` to download it again.
3. **Realm build.** Builds the static realm into `engine/dist-sf`.

Then it serves the realm on port 5760 and prints the address to open, ending in `/sf/index.html`. Set `PORT` for another port, as in `PORT=8080 ./world`. If the port is taken, `./world` says so before it builds anything. Keep the terminal open while you play and press Ctrl-C there to stop.

The first view looks across the city from Ina Coolbrith Park. Click the **EXPLORE** board to open the interactive 3D map with a scenic starting spot selected (**North Beach**), pick any place you like on the map, and press **Start** (or Enter) to dive into the city.

## What to try

- Walk with WASD and look with the mouse. B switches between walking and flying.
- Stand beside a car and press E to get in and drive. Press N to cycle FM stations or R to choose music. On a phone, tap Radio in the driving controls or realm settings.
- Press M for the map. Click a place on it to get a route.
- Open the realm settings to change the hour, the weather and the graphics.

Every key, the gamepad and the touch controls are on [gameplay](/gameplay).

## Make something

Exploring needs no account or key. To make something new, open the realm settings, choose **Your AI…**, select your provider and paste your own API key. The browser sends requests directly to that provider. Use **Forget this key** in the same panel to remove the saved key.

## The city's data

The data bundle is a release asset in [the project repository](https://github.com/voxelwright/voxelwright). Each map layer keeps its [data licence](https://github.com/voxelwright/voxelwright/blob/main/DATA-LICENSES.md).

To fetch it from a mirror instead, set `VOXELWRIGHT_DATA_URL`. [The data bundle](/deploy#the-data-bundle) says what a mirror serves and how to make one.

## In a Dev Container

The repository's Dev Container has Node.js with npm and npx, and Rust with the Wasm target. It forwards port 5760. Run `./world` in its terminal and open the forwarded port at `/sf/index.html`. `npm ci` and each part's `npm test` work there too.
