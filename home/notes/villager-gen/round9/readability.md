# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 171 px tall.

- Role readability (nearest silhouette has the same role): 30% (chance about 8%)
- Mean IoU within a role 0.6, between roles 0.542
- Species: mean pairwise IoU 0.547 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 131 px, median 694 px of the 128 px render; share of the figure min 5.5%, median 24.6%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 143 px, median 685 px
- Felt moved off the owners' colours: 0 colours on 0 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r8-01 | Barley | cook | r8-03 | cook | 0.71 | 865 | 849 | 26.7% | Alex |  |  | forward 0.548, legs 0.016, neck 0, top 0.133, side 0 |
| r8-02 | Flip | cook | r8-01 | cook | 0.64 | 704 | 702 | 23.0% | Sam |  |  | forward 0.71, legs 0.007, neck 0, top 0.475, side 0 |
| r8-03 | Bramwell | cook | r8-01 | cook | 0.71 | 1535 | 1519 | 39.4% | Mia |  |  | forward 1.067, legs 0.048, neck 0, top 0, side 0 |
| r8-04 | Clover Nib | gardener | r8-12 | tutor | 0.77 | 1030 | 1088 | 38.9% | Robin |  |  | forward 0.3, legs 0.105, neck 0, top 0.783, side 0 |
| r8-05 | Pottle | gardener | r8-18 | carer | 0.77 | 917 | 953 | 33.9% | Alex |  |  | forward 1.916, legs 0.147, neck 0, top 0.94, side 0 |
| r8-06 | Barnaby | gardener | r8-04 | gardener | 0.74 | 635 | 627 | 23.8% | Sam |  |  | forward 0.381, legs 0.086, neck 0, top 0.007, side 0 |
| r8-07 | Burr | tidier | r8-15 | maker | 0.61 | 143 | 146 | 7.0% | Mia |  |  | forward 0.602, legs 0.024, neck 0, top 0, side 0.03 |
| r8-08 | Penhallow | tidier | r8-01 | cook | 0.48 | 694 | 685 | 24.6% | Robin |  |  | forward 0.73, legs 0.206, neck 0.201, top 0.747, side 0.728 |
| r8-09 | Tally | keeper | r8-10 | keeper | 0.72 | 135 | 151 | 5.7% | Alex |  |  | forward 0.188, legs 0, neck 0, top 0.272, side 0 |
| r8-10 | Alder | keeper | r8-09 | keeper | 0.72 | 131 | 143 | 5.5% | Sam |  |  | forward 0.555, legs 0.072, neck 0, top 0.144, side 0 |
| r8-11 | Bramble | tutor | r8-06 | gardener | 0.70 | 520 | 531 | 25.3% | Mia |  |  | forward 0.333, legs 0.024, neck 0, top 1.36, side 0 |
| r8-12 | Oliphant | tutor | r8-04 | gardener | 0.77 | 1043 | 1117 | 32.7% | Robin |  |  | forward 1.113, legs 0.089, neck 0, top 0, side 0.691 |
| r8-13 | Quill | messenger | r8-10 | keeper | 0.64 | 221 | 235 | 9.8% | Alex |  |  | forward 0.727, legs 0.045, neck 0, top 0.825, side 0 |
| r8-14 | Pipit | messenger | r8-18 | carer | 0.66 | 248 | 229 | 10.2% | Sam |  |  | forward 0.397, legs 0.089, neck 0, top 0, side 0 |
| r8-15 | Bramble Pin | maker | r8-05 | gardener | 0.70 | 132 | 153 | 6.5% | Mia |  |  | forward 1.218, legs 0.103, neck 0, top 0.463, side 0.945 |
| r8-16 | Hobnail | maker | r8-12 | tutor | 0.67 | 305 | 308 | 11.5% | Robin |  |  | forward 0.369, legs 0.132, neck 0, top 0.686, side 1.015 |
| r8-17 | Sprocket | maker | r8-11 | tutor | 0.58 | 181 | 190 | 11.0% | Alex |  |  | forward 0.868, legs 0.071, neck 0, top 0.656, side 1.157 |
| r8-18 | Clover Fleece | carer | r8-05 | gardener | 0.77 | 934 | 956 | 35.5% | Sam |  |  | forward 0.929, legs 0.119, neck 0, top 0, side 0.905 |
| r8-19 | Pepper | carer | r8-09 | keeper | 0.69 | 1153 | 1126 | 46.1% | Mia |  |  | forward 0.304, legs 0.066, neck 0, top 0.551, side 0 |
| r8-20 | Bamboo Hush | carer | r8-09 | keeper | 0.70 | 1239 | 1208 | 44.6% | Robin |  |  | forward 0.324, legs 0.03, neck 0, top 0.156, side 0 |
