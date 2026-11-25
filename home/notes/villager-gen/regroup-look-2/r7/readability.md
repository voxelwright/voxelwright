# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 163 px tall.

- Role readability (nearest silhouette has the same role): 30% (chance about 8%)
- Mean IoU within a role 0.596, between roles 0.549
- Species: mean pairwise IoU 0.553 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 132 px, median 443 px of the 128 px render; share of the figure min 5.7%, median 18.6%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 136 px, median 425 px
- Felt moved off the owners' colours: 2 colours on 2 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r7-01 | Brock Crumb | cook | r7-02 | cook | 0.66 | 511 | 515 | 23.2% | Alex |  |  | forward 0.577, legs 0.058, neck 0, top 0.078, side 0 |
| r7-02 | Flapjack | cook | r7-01 | cook | 0.66 | 358 | 367 | 18.2% | Sam |  | #c9966a to #c8976b | forward 0.655, legs 0, neck 0, top 0.803, side 0 |
| r7-03 | Wendell | cook | r7-06 | gardener | 0.68 | 432 | 425 | 15.4% | Mia |  |  | forward 0.315, legs 0, neck 0, top 0, side 0.016 |
| r7-04 | Thimble | gardener | r7-20 | carer | 0.74 | 415 | 405 | 18.0% | Robin |  |  | forward 0.352, legs 0.058, neck 0, top 1.096, side 0 |
| r7-05 | Winkle | gardener | r7-06 | gardener | 0.66 | 615 | 494 | 30.5% | Alex |  |  | forward 1.983, legs 0.115, neck 0, top 0.858, side 0 |
| r7-06 | Barrow | gardener | r7-10 | keeper | 0.74 | 862 | 831 | 30.9% | Sam |  |  | forward 0.606, legs 0.054, neck 0, top 0, side 0.164 |
| r7-07 | Pinny | tidier | r7-15 | maker | 0.70 | 157 | 159 | 9.0% | Mia |  |  | forward 0.772, legs 0.08, neck 0, top 0.096, side 0 |
| r7-08 | Ottoline | tidier | r7-11 | tutor | 0.49 | 492 | 498 | 19.9% | Robin |  |  | forward 0.642, legs 0.245, neck 0.091, top 1.093, side 0.587 |
| r7-09 | Ledger | keeper | r7-18 | carer | 0.80 | 132 | 136 | 5.7% | Alex |  |  | forward 0.327, legs 0.024, neck 0, top 0.336, side 0 |
| r7-10 | Chip | keeper | r7-18 | carer | 0.76 | 186 | 177 | 6.7% | Sam |  |  | forward 0.31, legs 0, neck 0, top 0, side 0 |
| r7-11 | Hazel | tutor | r7-12 | tutor | 0.74 | 1589 | 1495 | 46.6% | Mia |  |  | forward 0.317, legs 0.064, neck 0, top 0.514, side 1.035 |
| r7-12 | Ambrose | tutor | r7-11 | tutor | 0.74 | 2070 | 2061 | 52.6% | Robin |  |  | forward 0.642, legs 0.075, neck 0, top 0, side 0.389 |
| r7-13 | Skip | messenger | r7-10 | keeper | 0.67 | 269 | 264 | 9.5% | Alex |  | #d9a46c to #d3a775 | forward 0.642, legs 0, neck 0, top 0.677, side 0 |
| r7-14 | Perry | messenger | r7-09 | keeper | 0.72 | 232 | 225 | 9.7% | Sam |  |  | forward 0.524, legs 0.036, neck 0, top 0, side 0 |
| r7-15 | Brindle | maker | r7-07 | tidier | 0.70 | 326 | 314 | 18.1% | Mia |  |  | forward 1.053, legs 0.002, neck 0, top 0.07, side 0 |
| r7-16 | Bracket | maker | r7-10 | keeper | 0.71 | 687 | 712 | 22.7% | Robin |  |  | forward 0.303, legs 0.038, neck 0, top 0.598, side 0.502 |
| r7-17 | Tickwick | maker | r7-04 | gardener | 0.60 | 449 | 466 | 22.4% | Alex |  |  | forward 0.522, legs 0.079, neck 0, top 0.504, side 0.166 |
| r7-18 | Posset | carer | r7-09 | keeper | 0.80 | 670 | 653 | 25.5% | Sam |  |  | forward 0.474, legs 0.086, neck 0, top 0.165, side 0.574 |
| r7-19 | Biscuit | carer | r7-20 | carer | 0.67 | 239 | 258 | 11.3% | Mia |  |  | forward 0.333, legs 0.063, neck 0, top 0.203, side 0 |
| r7-20 | Bao | carer | r7-04 | gardener | 0.74 | 443 | 413 | 18.6% | Robin |  |  | forward 0.355, legs 0.027, neck 0, top 0.203, side 0 |
