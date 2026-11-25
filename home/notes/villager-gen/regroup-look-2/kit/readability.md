# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 166 px tall.

- Role readability (nearest silhouette has the same role): 25% (chance about 8%)
- Mean IoU within a role 0.593, between roles 0.538
- Species: mean pairwise IoU 0.543 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 101 px, median 774 px of the 128 px render; share of the figure min 5.9%, median 34.2%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 103 px, median 723 px
- Felt moved off the owners' colours: 2 colours on 2 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r7-01 | Brock Crumb | cook | r7-02 | cook | 0.59 | 730 | 720 | 30.5% | Alex |  |  | forward 0.577, legs 0.057, neck 0, top 0.078, side 0 |
| r7-02 | Flapjack | cook | r7-20 | carer | 0.62 | 824 | 808 | 34.2% | Sam |  | #c9966a to #c8976b | forward 0.655, legs 0, neck 0, top 0.803, side 0 |
| r7-03 | Wendell | cook | r7-16 | maker | 0.58 | 1381 | 1365 | 38.8% | Mia |  |  | forward 0.315, legs 0, neck 0, top 0, side 0.016 |
| r7-04 | Thimble | gardener | r7-20 | carer | 0.76 | 1030 | 1103 | 38.8% | Robin |  |  | forward 0.352, legs 0.058, neck 0, top 1.096, side 0 |
| r7-05 | Winkle | gardener | r7-16 | maker | 0.68 | 774 | 723 | 38.1% | Alex |  |  | forward 1.983, legs 0.115, neck 0, top 0.858, side 0 |
| r7-06 | Barrow | gardener | r7-04 | gardener | 0.74 | 1618 | 1647 | 51.1% | Sam |  |  | forward 0.606, legs 0.059, neck 0, top 0, side 0.164 |
| r7-07 | Pinny | tidier | r7-15 | maker | 0.69 | 101 | 103 | 5.9% | Mia |  |  | forward 0.772, legs 0.08, neck 0, top 0.096, side 0 |
| r7-08 | Ottoline | tidier | r7-19 | carer | 0.50 | 576 | 573 | 22.1% | Robin |  |  | forward 0.642, legs 0.245, neck 0.091, top 1.093, side 0.587 |
| r7-09 | Ledger | keeper | r7-18 | carer | 0.78 | 146 | 145 | 6.3% | Alex |  |  | forward 0.327, legs 0.025, neck 0, top 0.336, side 0 |
| r7-10 | Chip | keeper | r7-20 | carer | 0.75 | 165 | 177 | 6.0% | Sam |  |  | forward 0.31, legs 0, neck 0, top 0, side 0 |
| r7-11 | Hazel | tutor | r7-12 | tutor | 0.77 | 1424 | 1438 | 42.5% | Mia |  |  | forward 0.317, legs 0.064, neck 0, top 0.514, side 1.035 |
| r7-12 | Ambrose | tutor | r7-11 | tutor | 0.77 | 1805 | 1808 | 47.7% | Robin |  |  | forward 0.642, legs 0.074, neck 0, top 0, side 0.389 |
| r7-13 | Skip | messenger | r7-14 | messenger | 0.67 | 414 | 405 | 14.0% | Alex |  | #d9a46c to #d3a775 | forward 0.642, legs 0, neck 0, top 0.677, side 0 |
| r7-14 | Perry | messenger | r7-09 | keeper | 0.70 | 371 | 385 | 14.6% | Sam |  |  | forward 0.524, legs 0.033, neck 0, top 0, side 0 |
| r7-15 | Brindle | maker | r7-07 | tidier | 0.69 | 183 | 178 | 10.5% | Mia |  |  | forward 1.053, legs 0.002, neck 0, top 0.07, side 0 |
| r7-16 | Bracket | maker | r7-18 | carer | 0.71 | 226 | 252 | 8.5% | Robin |  |  | forward 0.303, legs 0.039, neck 0, top 0.598, side 0.502 |
| r7-17 | Tickwick | maker | r7-20 | carer | 0.69 | 210 | 205 | 11.3% | Alex |  |  | forward 0.522, legs 0.082, neck 0, top 0.504, side 0.166 |
| r7-18 | Posset | carer | r7-09 | keeper | 0.78 | 1135 | 1115 | 45.1% | Sam |  |  | forward 0.474, legs 0.101, neck 0, top 0.165, side 0.574 |
| r7-19 | Biscuit | carer | r7-11 | tutor | 0.63 | 1213 | 1184 | 49.9% | Mia |  |  | forward 0.333, legs 0.063, neck 0, top 0.203, side 0 |
| r7-20 | Bao | carer | r7-04 | gardener | 0.76 | 1113 | 1104 | 44.7% | Robin |  |  | forward 0.355, legs 0.03, neck 0, top 0.203, side 0 |
