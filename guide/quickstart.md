# Walk San Francisco

Install Node.js 25 or newer and stable Rust with Cargo. Add the Wasm target once with `rustup target add wasm32-unknown-unknown`. Open the world in a WebGPU-capable browser such as Chrome.

From the repository root on macOS or Linux, run:

```sh
./world
```

Open the printed address. The first view looks across the park. Choose **Explore** to enter the city. Keep the terminal open while you play and press Ctrl-C there to stop.

Exploring needs no account or key. To make something new, open the realm settings, choose **Your AI…**, select your provider and paste your own API key. The browser sends requests directly to that provider. Use **Forget** in the same panel to remove the saved key.

The command downloads the pinned SF release bundle and verifies its contents. Each map layer retains its [data licence](../DATA-LICENSES.md). Before the public release is available, set `VOXELWRIGHT_DATA_URL` to an HTTPS release mirror with the pinned tag and data.tar under it. Local testing also accepts an HTTP loopback mirror.

In a Dev Container, forward port 5760 and run the same command in its terminal. Open the forwarded port at `/sf/index.html?making=1`.

<!-- docs-verified 452a182c9cc8fc2ca4ffb8bba4e4c7c943646508 {"world":"2378ea1c03ac32ad3591a785e0f839d2","scripts/world.mjs":"57f1658d01ef15afab6b08906273937d","deploy/data.mjs":"15bd42d30cf7f5fd7a248656d73c6af1","engine/page/realm-ui.ts":"50f922f5cf756bae80e066aebab8c939",".devcontainer/devcontainer.json":"ebccba2df47ccded145c15adee4d311b"} -->
