# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 160 px tall.

- Role readability (nearest silhouette has the same role): 40% (chance about 8%)
- Mean IoU within a role 0.572, between roles 0.518
- Species: mean pairwise IoU 0.522 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 154 px, median 382 px of the 128 px render; share of the figure min 7.1%, median 17.7%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 145 px, median 384 px
- Felt moved off the owners' colours: 1 colours on 1 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r6-01 | Brindle | cook | r6-03 | cook | 0.78 | 533 | 531 | 24.7% | Alex |  |  | forward 0.635, legs 0.075, neck 0, top 0.176, side 0 |
| r6-02 | Flapjack | cook | r6-01 | cook | 0.62 | 394 | 399 | 18.2% | Sam |  | #d4a874 to #d3a876 | forward 0.902, legs 0.092, neck 0, top 0.501, side 0.023 |
| r6-03 | Old Brine | cook | r6-01 | cook | 0.78 | 363 | 384 | 16.6% | Mia |  |  | forward 0.316, legs 0.006, neck 0, top 0, side 0.083 |
| r6-04 | Sorrel | gardener | r6-12 | tutor | 0.65 | 406 | 480 | 17.7% | Robin |  |  | forward 0.46, legs 0.112, neck 0, top 1.023, side 0 |
| r6-05 | Whorl | gardener | r6-15 | maker | 0.73 | 551 | 581 | 26.5% | Alex |  |  | forward 2.512, legs 0.099, neck 0, top 1.266, side 0 |
| r6-06 | Mudge | gardener | r6-07 | tidier | 0.73 | 887 | 950 | 37.6% | Sam |  |  | forward 0.629, legs 0.111, neck 0, top 0.053, side 0 |
| r6-07 | Burr | tidier | r6-15 | maker | 0.76 | 298 | 298 | 13.2% | Mia |  |  | forward 0.823, legs 0.026, neck 0, top 0.014, side 0.048 |
| r6-08 | Ottoline | tidier | r6-11 | tutor | 0.43 | 624 | 620 | 29.7% | Robin |  |  | forward 0.538, legs 0.258, neck 0.151, top 0.756, side 0.734 |
| r6-09 | Tally | keeper | r6-10 | keeper | 0.79 | 176 | 168 | 7.3% | Alex |  |  | forward 0.275, legs 0, neck 0, top 0.28, side 0 |
| r6-10 | Birch | keeper | r6-09 | keeper | 0.79 | 154 | 145 | 7.1% | Sam |  |  | forward 0.348, legs 0, neck 0, top 0.096, side 0.061 |
| r6-11 | Clover | tutor | r6-12 | tutor | 0.69 | 1988 | 2006 | 53.6% | Mia |  |  | forward 0.475, legs 0.089, neck 0, top 0.747, side 1.069 |
| r6-12 | Ambrose | tutor | r6-11 | tutor | 0.69 | 1749 | 1689 | 55.9% | Robin |  |  | forward 1.055, legs 0.116, neck 0, top 0, side 0.516 |
| r6-13 | Brisk | messenger | r6-09 | keeper | 0.57 | 236 | 249 | 9.8% | Alex |  |  | forward 1.232, legs 0.032, neck 0, top 0.634, side 0.039 |
| r6-14 | Pip Wren | messenger | r6-20 | carer | 0.58 | 224 | 203 | 15.1% | Sam |  |  | forward 0.756, legs 0.062, neck 0, top 0, side 0 |
| r6-15 | Burr | maker | r6-07 | tidier | 0.76 | 382 | 381 | 17.9% | Mia |  |  | forward 1.062, legs 0.091, neck 0, top 0, side 0 |
| r6-16 | Hobnail | maker | r6-20 | carer | 0.74 | 279 | 278 | 11.5% | Robin |  |  | forward 0.486, legs 0.143, neck 0, top 0.04, side 0.542 |
| r6-17 | Pinion | maker | r6-04 | gardener | 0.58 | 281 | 274 | 12.0% | Alex |  |  | forward 0.938, legs 0.07, neck 0, top 0.474, side 0.577 |
| r6-18 | Posset | carer | r6-15 | maker | 0.75 | 472 | 472 | 19.2% | Sam |  |  | forward 0.71, legs 0.113, neck 0, top 0, side 0.777 |
| r6-19 | Posset | carer | r6-18 | carer | 0.58 | 256 | 269 | 12.9% | Mia |  |  | forward 0.399, legs 0.007, neck 0, top 0.307, side 0 |
| r6-20 | Bao | carer | r6-16 | maker | 0.74 | 324 | 361 | 14.4% | Robin |  |  | forward 0.464, legs 0.104, neck 0, top 0.07, side 0.076 |
