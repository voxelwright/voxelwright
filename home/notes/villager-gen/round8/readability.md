# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 166 px tall.

- Role readability (nearest silhouette has the same role): 30% (chance about 8%)
- Mean IoU within a role 0.585, between roles 0.535
- Species: mean pairwise IoU 0.54 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 138 px, median 692 px of the 128 px render; share of the figure min 5.8%, median 26.2%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 143 px, median 704 px
- Felt moved off the owners' colours: 0 colours on 0 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r8-01 | Barley | cook | r8-03 | cook | 0.70 | 850 | 838 | 27.3% | Alex |  |  | forward 0.548, legs 0.016, neck 0, top 0.133, side 0 |
| r8-02 | Flip | cook | r8-19 | carer | 0.59 | 692 | 704 | 24.3% | Sam |  |  | forward 0.71, legs 0.007, neck 0, top 0.475, side 0 |
| r8-03 | Bramwell | cook | r8-01 | cook | 0.70 | 1540 | 1519 | 40.4% | Mia |  |  | forward 1.067, legs 0.048, neck 0, top 0, side 0 |
| r8-04 | Clover Nib | gardener | r8-12 | tutor | 0.77 | 1092 | 1088 | 41.5% | Robin |  |  | forward 0.3, legs 0.105, neck 0, top 0.783, side 0 |
| r8-05 | Pottle | gardener | r8-18 | carer | 0.73 | 948 | 953 | 35.0% | Alex |  |  | forward 1.916, legs 0.147, neck 0, top 0.94, side 0 |
| r8-06 | Barnaby | gardener | r8-04 | gardener | 0.72 | 899 | 929 | 34.4% | Sam |  |  | forward 0.381, legs 0.086, neck 0, top 0.007, side 0 |
| r8-07 | Burr | tidier | r8-15 | maker | 0.61 | 140 | 146 | 6.8% | Mia |  |  | forward 0.602, legs 0.024, neck 0, top 0, side 0.03 |
| r8-08 | Penhallow | tidier | r8-01 | cook | 0.47 | 676 | 685 | 24.3% | Robin |  |  | forward 0.73, legs 0.206, neck 0.201, top 0.747, side 0.728 |
| r8-09 | Tally | keeper | r8-10 | keeper | 0.73 | 138 | 151 | 5.8% | Alex |  |  | forward 0.188, legs 0, neck 0, top 0.272, side 0 |
| r8-10 | Alder | keeper | r8-09 | keeper | 0.73 | 141 | 143 | 6.0% | Sam |  |  | forward 0.555, legs 0.072, neck 0, top 0.144, side 0 |
| r8-11 | Bramble | tutor | r8-04 | gardener | 0.68 | 539 | 531 | 26.2% | Mia |  |  | forward 0.333, legs 0.024, neck 0, top 1.36, side 0 |
| r8-12 | Oliphant | tutor | r8-04 | gardener | 0.77 | 1220 | 1216 | 37.7% | Robin |  |  | forward 1.113, legs 0.093, neck 0, top 0, side 0.691 |
| r8-13 | Quill | messenger | r8-10 | keeper | 0.63 | 218 | 235 | 9.7% | Alex |  |  | forward 0.727, legs 0.045, neck 0, top 0.825, side 0 |
| r8-14 | Pipit | messenger | r8-05 | gardener | 0.64 | 249 | 229 | 10.2% | Sam |  |  | forward 0.397, legs 0.089, neck 0, top 0, side 0 |
| r8-15 | Bramble Pin | maker | r8-05 | gardener | 0.72 | 161 | 153 | 7.7% | Mia |  |  | forward 1.218, legs 0.103, neck 0, top 0.463, side 0.945 |
| r8-16 | Hobnail | maker | r8-15 | maker | 0.60 | 304 | 308 | 11.8% | Robin |  |  | forward 0.369, legs 0.132, neck 0, top 0.686, side 1.015 |
| r8-17 | Sprocket | maker | r8-11 | tutor | 0.58 | 192 | 190 | 11.1% | Alex |  |  | forward 0.868, legs 0.071, neck 0, top 0.656, side 1.157 |
| r8-18 | Clover Fleece | carer | r8-05 | gardener | 0.73 | 993 | 956 | 37.5% | Sam |  |  | forward 0.929, legs 0.119, neck 0, top 0, side 0.905 |
| r8-19 | Pepper | carer | r8-09 | keeper | 0.71 | 1161 | 1126 | 46.6% | Mia |  |  | forward 0.304, legs 0.066, neck 0, top 0.551, side 0 |
| r8-20 | Bamboo Hush | carer | r8-09 | keeper | 0.71 | 1233 | 1208 | 44.8% | Robin |  |  | forward 0.324, legs 0.03, neck 0, top 0.156, side 0 |
