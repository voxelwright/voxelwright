# Readability, 20 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 170 px tall.

- Role readability (nearest silhouette has the same role): 30% (chance about 8%)
- Mean IoU within a role 0.594, between roles 0.54
- Species: mean pairwise IoU 0.545 (lower is more varied); 0 of 20 are the default round template
- Model declared the requested role: 20 of 20
- Visible accent: min 145 px, median 710 px of the 128 px render; share of the figure min 6.2%, median 25.0%
- Owner colour by the trusted check (gen/checks.ts ownerArea, CPU): min 143 px, median 704 px
- Felt moved off the owners' colours: 0 colours on 0 of 20 villagers

Blind colour sheet: readability-colour.jpg, its key in readability-colour-key.md (a different order from the silhouettes).

| id | name | role | nearest | its role | IoU | accent px | trusted px | accent share | owner | round template | felt moved | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r8-01 | Barley | cook | r8-03 | cook | 0.70 | 857 | 838 | 27.3% | Alex |  |  | forward 0.548, legs 0.016, neck 0, top 0.133, side 0 |
| r8-02 | Flip | cook | r8-01 | cook | 0.60 | 710 | 704 | 24.4% | Sam |  |  | forward 0.71, legs 0.007, neck 0, top 0.475, side 0 |
| r8-03 | Bramwell | cook | r8-01 | cook | 0.70 | 1539 | 1519 | 39.2% | Mia |  |  | forward 1.067, legs 0.048, neck 0, top 0, side 0 |
| r8-04 | Clover Nib | gardener | r8-12 | tutor | 0.78 | 1038 | 1088 | 39.1% | Robin |  |  | forward 0.3, legs 0.105, neck 0, top 0.783, side 0 |
| r8-05 | Pottle | gardener | r8-18 | carer | 0.76 | 933 | 953 | 34.4% | Alex |  |  | forward 1.916, legs 0.147, neck 0, top 0.94, side 0 |
| r8-06 | Barnaby | gardener | r8-04 | gardener | 0.73 | 868 | 929 | 33.0% | Sam |  |  | forward 0.381, legs 0.086, neck 0, top 0.007, side 0 |
| r8-07 | Burr | tidier | r8-15 | maker | 0.63 | 145 | 146 | 7.1% | Mia |  |  | forward 0.602, legs 0.024, neck 0, top 0, side 0.03 |
| r8-08 | Penhallow | tidier | r8-03 | cook | 0.46 | 691 | 685 | 24.5% | Robin |  |  | forward 0.73, legs 0.206, neck 0.201, top 0.747, side 0.728 |
| r8-09 | Tally | keeper | r8-10 | keeper | 0.75 | 149 | 151 | 6.2% | Alex |  |  | forward 0.188, legs 0, neck 0, top 0.272, side 0 |
| r8-10 | Alder | keeper | r8-09 | keeper | 0.75 | 151 | 143 | 6.3% | Sam |  |  | forward 0.555, legs 0.072, neck 0, top 0.144, side 0 |
| r8-11 | Bramble | tutor | r8-04 | gardener | 0.70 | 522 | 531 | 25.0% | Mia |  |  | forward 0.333, legs 0.024, neck 0, top 1.36, side 0 |
| r8-12 | Oliphant | tutor | r8-04 | gardener | 0.78 | 1203 | 1216 | 36.9% | Robin |  |  | forward 1.113, legs 0.093, neck 0, top 0, side 0.691 |
| r8-13 | Quill | messenger | r8-10 | keeper | 0.61 | 223 | 235 | 9.9% | Alex |  |  | forward 0.727, legs 0.045, neck 0, top 0.825, side 0 |
| r8-14 | Pipit | messenger | r8-18 | carer | 0.66 | 249 | 229 | 10.2% | Sam |  |  | forward 0.397, legs 0.089, neck 0, top 0, side 0 |
| r8-15 | Bramble Pin | maker | r8-05 | gardener | 0.71 | 158 | 153 | 7.6% | Mia |  |  | forward 1.218, legs 0.103, neck 0, top 0.463, side 0.945 |
| r8-16 | Hobnail | maker | r8-18 | carer | 0.65 | 301 | 308 | 11.4% | Robin |  |  | forward 0.369, legs 0.132, neck 0, top 0.686, side 1.015 |
| r8-17 | Sprocket | maker | r8-11 | tutor | 0.59 | 184 | 190 | 10.9% | Alex |  |  | forward 0.868, legs 0.071, neck 0, top 0.656, side 1.157 |
| r8-18 | Clover Fleece | carer | r8-05 | gardener | 0.76 | 950 | 956 | 36.2% | Sam |  |  | forward 0.929, legs 0.119, neck 0, top 0, side 0.905 |
| r8-19 | Pepper | carer | r8-11 | tutor | 0.68 | 1157 | 1126 | 46.4% | Mia |  |  | forward 0.304, legs 0.066, neck 0, top 0.551, side 0 |
| r8-20 | Bamboo Hush | carer | r8-04 | gardener | 0.70 | 1249 | 1208 | 45.2% | Robin |  |  | forward 0.324, legs 0.03, neck 0, top 0.156, side 0 |
