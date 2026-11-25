# Readability, 8 generated villagers

Silhouettes: 128 px framing 1.4 m from the dollhouse heading (fov 20), bottom- and centre-aligned IoU. Colour tiles: ?cam=iso at 1280x800, a villager about 158 px tall.

- Role readability (nearest silhouette has the same role): 13% (chance about 4%)
- Mean IoU within a role 0.564, between roles 0.528
- Species: mean pairwise IoU 0.529 (lower is more varied); 0 of 8 are the default round template
- Model declared the requested role: 8 of 8
- Visible accent: min 100 px, median 121 px of the 128 px render; share of the figure min 4.2%, median 5.2%
- Owner-colour parts hanging in front of the face: 0 of 8 villagers

| id | name | role | nearest | its role | IoU | accent px | accent share | hanging | owner | round template | species features |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gb-01 | Brindle | cook | gb-15 | maker | 0.60 | 130 | 5.1% | 0 | Alex |  | forward 0.618, legs 0.04, neck 0, top 0.212, side 0.03 |
| gb-02 | Flapjack | cook | gb-01 | cook | 0.56 | 128 | 5.2% | 0 | Sam |  | forward 1.177, legs 0.056, neck 0, top 0.778, side 0.055 |
| gb-05 | Hollis | gardener | gb-t1 | keeper | 0.65 | 121 | 6.2% | 0 | Alex |  | forward 2.193, legs 0.148, neck 0, top 0, side 0 |
| gb-08 | Olwen | tidier | gb-14 | messenger | 0.38 | 102 | 4.2% | 0 | Robin |  | forward 0.637, legs 0.201, neck 0.141, top 0.709, side 0.811 |
| gb-14 | Pipit | messenger | gb-18 | carer | 0.63 | 138 | 6.7% | 0 | Sam |  | forward 0.63, legs 0.105, neck 0, top 0, side 0 |
| gb-15 | Burdock | maker | gb-t1 | keeper | 0.65 | 100 | 5.5% | 0 | Mia |  | forward 1.2, legs 0.088, neck 0, top 0, side 0.2 |
| gb-18 | Bramble | carer | gb-t1 | keeper | 0.80 | 115 | 4.5% | 0 | Sam |  | forward 0.667, legs 0.094, neck 0, top 0, side 1.037 |
| gb-t1 | Rondo | keeper | gb-18 | carer | 0.80 | 115 | 4.3% | 0 | Alex |  | forward 1.635, legs 0.066, neck 0, top 0, side 0 |
