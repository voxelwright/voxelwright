---
title: Walk San Francisco
description: Walk San Francisco in voxels on your own machine with one command.
---

Install Node.js 25 or newer and stable Rust with Cargo. Add the Wasm target once with `rustup target add wasm32-unknown-unknown`. Open the world in a WebGPU-capable browser such as Chrome.

From the repository root on macOS or Linux, run:

```sh
./world
```

Open the printed address. The first view looks across the park. Choose **Explore** to enter the city. Keep the terminal open while you play and press Ctrl-C there to stop.

Exploring needs no account or key. To make something new, open the realm settings, choose **Your AI…**, select your provider and paste your own API key. The browser sends requests directly to that provider. Use **Forget** in the same panel to remove the saved key.

The command downloads the pinned SF release bundle and verifies its contents. Each map layer retains its [data licence](https://github.com/voxelwright/voxelwright/blob/main/DATA-LICENSES.md). The default download comes from the public city release in [the project repository](https://github.com/voxelwright/voxelwright). To use a mirror, set `VOXELWRIGHT_DATA_URL` to an HTTPS release mirror with the pinned tag and data.tar under it. Local testing also accepts an HTTP loopback mirror. A maintainer can create the same mirror layout with `node deploy/data.mjs pack-local PIN DIRECTORY` after building a staged release.

In a Dev Container, forward port 5760 and run the same command in its terminal. Open the forwarded port at `/sf/index.html`.
