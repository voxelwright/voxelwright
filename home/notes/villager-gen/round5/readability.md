# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 159 px tall.

- Role readability (nearest silhouette has the same role): 25% (chance about 8%)
- Mean IoU within a role 0.581, between roles 0.55
- Species: mean pairwise IoU 0.553 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 170 px, median 421 px of the 128 px render; share of the figure min 7.4%, median 16.9%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 161 px, median 422 px
- Felt moved off the owners' colours: 1 colours on 1 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r5-01 | Brindle | cook | r5-20 | carer | 0.75 | 515 | 516 | 20.2% | Alex |  |  | forward 0.795, legs 0.001, neck 0, top 0.282, side 0 |
| r5-02 | Pip Flapjack | cook | r5-03 | cook | 0.64 | 397 | 390 | 17.0% | Sam |  |  | forward 0.905, legs 0.078, neck 0, top 0.74, side 0.033 |
| r5-03 | Old Brine | cook | r5-01 | cook | 0.74 | 468 | 472 | 20.6% | Mia |  |  | forward 0.409, legs 0, neck 0, top 0, side 0.136 |
| r5-04 | Sorrel | gardener | r5-11 | tutor | 0.67 | 435 | 481 | 16.9% | Robin |  |  | forward 0.333, legs 0, neck 0, top 1.346, side 0 |
| r5-05 | Sorrel | gardener | r5-15 | maker | 0.67 | 421 | 446 | 29.0% | Alex |  |  | forward 2.875, legs 0.042, neck 0, top 2.013, side 0 |
| r5-06 | Barrow | gardener | r5-01 | cook | 0.74 | 799 | 850 | 31.6% | Sam |  |  | forward 0.558, legs 0.061, neck 0, top 0.019, side 0.032 |
| r5-07 | Quill | tidier | r5-15 | maker | 0.72 | 297 | 300 | 16.3% | Mia |  |  | forward 1.245, legs 0.121, neck 0, top 0.126, side 0.07 |
| r5-08 | Stilt | tidier | r5-09 | keeper | 0.57 | 436 | 431 | 22.9% | Robin |  |  | forward 0.957, legs 0.224, neck 0.034, top 1.138, side 0.943 |
| r5-09 | Tally | keeper | r5-10 | keeper | 0.81 | 195 | 186 | 8.0% | Alex |  |  | forward 0.365, legs 0, neck 0, top 0.245, side 0 |
| r5-10 | Birch | keeper | r5-09 | keeper | 0.81 | 170 | 161 | 7.4% | Sam |  |  | forward 0.322, legs 0, neck 0, top 0, side 0 |
| r5-11 | Clover | tutor | r5-04 | gardener | 0.67 | 1058 | 1078 | 34.0% | Mia |  |  | forward 0.362, legs 0, neck 0, top 1.25, side 1.321 |
| r5-12 | Ambrose | tutor | r5-11 | tutor | 0.65 | 1614 | 1580 | 40.5% | Robin |  |  | forward 0.924, legs 0.016, neck 0, top 0, side 0.865 |
| r5-13 | Sorrel | messenger | r5-03 | cook | 0.66 | 211 | 229 | 9.2% | Alex |  | #d6a273 to #d4a376 | forward 1.142, legs 0.049, neck 0, top 1.076, side 0 |
| r5-14 | Pipkin | messenger | r5-18 | carer | 0.72 | 250 | 246 | 12.0% | Sam |  |  | forward 0.694, legs 0.087, neck 0, top 0, side 0 |
| r5-15 | Burr | maker | r5-07 | tidier | 0.72 | 307 | 304 | 16.9% | Mia |  |  | forward 0.952, legs 0.003, neck 0, top 0, side 0.143 |
| r5-16 | Brindle | maker | r5-06 | gardener | 0.71 | 497 | 485 | 17.8% | Robin |  |  | forward 0.734, legs 0.076, neck 0, top 0.347, side 0.92 |
| r5-17 | Sprocket | maker | r5-07 | tidier | 0.58 | 222 | 213 | 14.9% | Alex |  |  | forward 0.83, legs 0.046, neck 0, top 0.459, side 0.28 |
| r5-18 | Bramwell | carer | r5-14 | messenger | 0.72 | 274 | 271 | 13.8% | Sam |  |  | forward 1.05, legs 0.177, neck 0, top 0, side 0.794 |
| r5-19 | Hettie | carer | r5-01 | cook | 0.59 | 287 | 284 | 13.6% | Mia |  |  | forward 0.432, legs 0.031, neck 0, top 0.431, side 0.044 |
| r5-20 | Ning | carer | r5-01 | cook | 0.75 | 442 | 422 | 16.3% | Robin |  |  | forward 0.418, legs 0, neck 0, top 0.053, side 0 |
