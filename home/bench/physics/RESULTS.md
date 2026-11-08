# Physics bench results

`npm run bench` on Apple M1 Pro, Node v25.1.0, 2026-11-08. Node only, single thread; no browser numbers yet.

## Pinball tunnelling (1000 random shots at 10 m/s, 27 mm ball, 5 mm walls, 45 frames each)

| engine | ccd | substeps | tunnelled | ms per 60 Hz frame |
|---|---|---|---|---|
| rapier 0.21.0 | off | 1 | 0 | 0.0184 |
| rapier 0.21.0 | off | 2 | 0 | 0.0253 |
| rapier 0.21.0 | off | 4 | 0 | 0.0465 |
| rapier 0.21.0 | off | 8 | 0 | 0.0855 |
| rapier 0.21.0 | off | 16 | 0 | 0.1593 |
| rapier 0.21.0 | on | 1 | 0 | 0.0137 |
| jolt 1.1.1 | off | 1 | 896 | 0.0079 |
| jolt 1.1.1 | off | 2 | 500 | 0.0103 |
| jolt 1.1.1 | off | 4 | 43 | 0.0191 |
| jolt 1.1.1 | off | 8 | 0 | 0.0380 |
| jolt 1.1.1 | off | 16 | 0 | 0.0728 |
| jolt 1.1.1 | on | 1 | 0 | 0.0066 |
| xpbd (TS) | off | 4 | 701 | 0.0146 |
| xpbd (TS) | off | 8 | 126 | 0.0252 |
| xpbd (TS) | off | 12 | 1 | 0.0358 |
| xpbd (TS) | off | 16 | 1 | 0.0461 |
| xpbd (TS) | off | 24 | 0 | 0.0664 |

## Pinball at the best setting per engine

| engine | setting | tunnelled at 25 m/s | bounce out/in (expect 0.50) | bumper contacts seen | ball speed after bumper kick (m/s) | impulse at bumper (N·s) | flipper launch speed median / min (m/s) | flipper tunnelled | deterministic rerun |
|---|---|---|---|---|---|---|---|---|---|
| rapier 0.21.0 | ccd, 1 substep | 0/500 | 0.493 | 200/200 | 4.21 ± 0.09 | 0.361 | 0.73 / 0.44 | 0/200 | identical |
| jolt 1.1.1 | ccd, 1 substep | 0/500 | 0.493 | 200/200 | 4.22 ± 0.08 | 0.339 | 1.40 / 0.56 | 0/200 | identical |
| xpbd (TS) | 16 substeps | 154/500 | 0.500 | 200/200 | 4.38 ± 0.07 | 0.364 | 1.24 / 0.83 | 0/200 | identical |

## Scale: 180 dynamic boxes + 20 kinematic capsule villagers, 60 Hz, node, single thread

| engine | setting | step median ms | step p95 ms | boxes lost | new contacts reported | 50 sphere overlap queries, ms |
|---|---|---|---|---|---|---|
| rapier 0.21.0 | 1 step, events on | 0.250 | 0.318 | 0 | 485 | 0.112 |
| jolt 1.1.1 | 1 step, JS contact listener | 0.231 | 0.359 | 0 | 782 | 0.075 |
| jolt 1.1.1 | 1 step, no listener | 0.174 | 0.264 | 0 | 0 | 0.072 |
| rapier 0.21.0 | 4 steps | 0.754 | 0.894 | 0 | 932 | 0.112 |
| jolt 1.1.1 | 4 collision steps, listener | 0.973 | 1.291 | 0 | 752 | 0.072 |
| xpbd (TS) | 8 substeps | 1.516 | 2.030 | 0 | 1242 | 0.276 |
| xpbd (TS) | 4 substeps | 0.991 | 1.445 | 0 | 1127 | 0.295 |

## Heightfield 128x128 (32 m), 40 resting 0.5 m boxes, 9 on the edited area

| engine | asleep before | placed right | 16x16 raise ms | awake after raise | right after raise | 48x48 crater ms | awake after crater | right after crater | others still right |
|---|---|---|---|---|---|---|---|---|---|
| rapier 0.21.0 (collider rebuilt) | 26/40 | 40/40 | 0.497 | 2/9 | 9/9 | 0.498 | 1/9 | 9/9 | 31/31 |
| jolt 1.1.1 (SetHeights + wake box) | 40/40 | 40/40 | 0.765 | 9/9 | 9/9 | 0.162 | 9/9 | 9/9 | 31/31 |
| jolt 1.1.1 (SetHeights, no wake) | 40/40 | 40/40 | 0.062 | 0/9 | 0/9 | 0.088 | 0/9 | 0/9 | 31/31 |
| xpbd (TS) | 40/40 | 40/40 | 0.145 | 9/9 | 9/9 | 0.165 | 9/9 | 9/9 | 31/31 |

## Size and load (node, median of 5 cold processes)

| engine | raw wasm | wasm gzip | shipped JS module (wasm inlined as base64) | cold load ms |
|---|---|---|---|---|
| rapier | 3010 KB | 1149 KB | 4239 KB | 63.6 |
| jolt | 1977 KB | 735 KB | 3156 KB | 78.1 |
| xpbd | - | - | 22 KB | 15.0 |
