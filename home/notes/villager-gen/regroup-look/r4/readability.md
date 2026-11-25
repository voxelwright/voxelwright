# Readability, 8 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 152 px tall.

- Role readability (nearest silhouette has the same role): 13% (chance about 4%)
- Mean IoU within a role 0.582, between roles 0.476
- Species: mean pairwise IoU 0.48 (lower is more varied); 0 of 8 are the default round template
- Model declared the requested role: 8 of 8
- Visible accent: min 158 px, median 190 px of the 128 px render; share of the figure min 7.8%, median 10.1%
- Owner-colour parts hanging in front of the face: 8 of 8 villagers

| id | name | role | nearest | its role | IoU | accent px | accent share | hanging | owner | round template | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| r3-code-1 | Bramley | keeper | r4-18 | carer | 0.63 | 282 | 8.4% | 2 | Alex |  | forward 2.062, legs 0.235, neck 0, top 0, side 0 |
| r4-01 | Brindle | cook | r4-18 | carer | 0.60 | 206 | 8.9% | 2 | Alex |  | forward 0.87, legs 0.013, neck 0, top 0.237, side 0 |
| r4-02 | Pancake Fox | cook | r4-01 | cook | 0.58 | 190 | 8.9% | 2 | Sam |  | forward 1.257, legs 0.098, neck 0, top 0.746, side 0 |
| r4-05 | Sorrel | gardener | r4-15 | maker | 0.65 | 177 | 10.1% | 2 | Alex |  | forward 1.787, legs 0.062, neck 0, top 0, side 0 |
| r4-08 | Reed Longfellow | tidier | r3-code-1 | keeper | 0.43 | 296 | 14.5% | 2 | Robin |  | forward 0.798, legs 0.241, neck 0.071, top 1.222, side 0.842 |
| r4-14 | Pip Wren | messenger | r4-15 | maker | 0.63 | 184 | 12.7% | 2 | Sam |  | forward 0.677, legs 0.066, neck 0, top 0, side 0.073 |
| r4-15 | Burdock | maker | r4-05 | gardener | 0.65 | 158 | 10.1% | 2 | Mia |  | forward 1.28, legs 0.102, neck 0, top 0, side 0.05 |
| r4-18 | Bramble | carer | r3-code-1 | keeper | 0.63 | 176 | 7.8% | 2 | Sam |  | forward 1.081, legs 0.21, neck 0, top 0, side 1.079 |
