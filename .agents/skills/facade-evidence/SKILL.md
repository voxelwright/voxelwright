---
name: facade-evidence
description: How Voxelwright reads Mapillary panoramas as evidence for each San Francisco building's facade parameters (wall colour, material, window share, storefront, awning) with local models (PyTorch, Hugging Face transformers, UperNet ConvNeXt ADE20K, SigLIP), and how those records reach the bake (engine/bay/facade_evidence.py, evidence_tile.py, #450). Versions, licences, the venv, measured speeds, what the models can and cannot see, and the trust test. Load before changing the segmentation or classifier, measuring more buildings, or reading the records from a new rule.
---

# Facade evidence: models that read the photographs

Adopted November 20, 2026 for #450. Photos and crops stay under `~/.village`; only derived numbers (colours,
classes, confidences) are written anywhere else.

## Where it runs

- Its own venv, so the bake's `venv` is untouched: `~/.village/engine/bay/evidence-venv` (Python 3.13, uv). It
  holds the bake's requirements plus `torch 2.15.0`, `transformers 5.23.0`, `sentencepiece 0.2.3` (SigLIP's
  tokenizer) and `protobuf`.
  ```
  cd ~/.village/engine/bay && uv venv evidence-venv --python 3.13
  VIRTUAL_ENV=$PWD/evidence-venv uv pip install -r <(venv/bin/pip freeze) torch transformers sentencepiece protobuf
  ```
- Segmentation runs on the Neural Engine through Core ML (`coremltools`, fp16; the package is converted once from the
  pinned weights into `evidence/upernet-convnext-tiny-640x512.mlpackage`): 0.16 s a face against 2.1 s in PyTorch on
  the CPU, agreeing on 99.75% of labels over 23 faces. Without coremltools, or with `EVIDENCE_SEGMENTER=cpu`, it falls
  back to PyTorch on the CPU (`EVIDENCE_THREADS`, default 8). The GPU is shared with the renderer; MPS is not used.
  coremltools warns that torch 2.15 is untested; the conversion and the agreement above held.
- Weights come from the Hugging Face Hub on first use (anonymous), pinned by revision in `facade_evidence.py`.

## The models

| Role | Model and revision | Licence (model card tag) | Measured on the M1 Pro, CPU under load ~12 |
| --- | --- | --- | --- |
| Segmentation: wall, sky, tree, car, person, pole, awning, sign... | `openmmlab/upernet-convnext-tiny` @ `876ffc56` (ADE20K, 150 classes) | MIT | 0.16 s a 512 x 640 face on the Neural Engine; 2.1 s on the CPU (small: 3.3 s; 384 x 480: 1.35 s) |
| Material, zero shot | `google/siglip-base-patch16-224` @ `7fd15f06` | Apache-2.0 | about 0.2 s a crop |

Rejected: `nvidia/segformer-*` and `facebook/mask2former-*` (licence "other", NVIDIA's is non-commercial);
UperNet ConvNeXt small (1.5x slower; its labels were not compared).

Interfaces used: `AutoModelForSemanticSegmentation(...).logits.argmax(1)` on a tensor normalised with ImageNet's
mean and std (the processor's own numbers, applied by hand); `AutoModel.get_text_features` /
`get_image_features`. **In transformers 5 these return an output object; the embedding is its `pooler_output`**
(`facade_evidence._pooled`). SigLIP scores each prompt with a sigmoid; the code takes a softmax over the five
prompts' logits to compare them.

## What the models can and cannot see (probed)

- **ADE20K labels a street front's windows as `building`.** No `windowpane` texel on any of 21 Nob Hill fronts.
  So the window share is a proxy: facade texels under half the view's median wall brightness. It misses windows
  that mirror the sky, so it is a floor.
- Occluders are labelled well: a trolleybus across a front, parked cars, people, trees, wires' poles (Nob Hill
  overlays, November 20).
- **Material from 2048 px panoramas is mostly holistic.** 5.7 px a degree: a 10 to 15 cm clapboard lap is 3 to 5
  px at 10 m and under 2 px at 25 m; brick courses (7.5 cm) are 2 px at 10 m. SigLIP answers from the whole crop
  (style, colour, era), not from the texture. Treat its class as a prior with a confidence, never as a measurement.
- The renderer draws 15 materials. Clapboard is `PLASTER` (lapped boards), brick `BRICK`, glass `GLASS`;
  **stucco and stone both draw as `CONCRETE`** (slabs). The record keeps all five apart.

## Exposure (what failed, what stands)

- `facade_paint.exposure()` calibrates a panorama on lidar asphalt. On Nob Hill it hit its 2.0 ceiling on well
  exposed photos, and the gain applied to encoded values turned unclipped walls (raw max under 250) white. That is
  where most of round 2's "white" paint came from, not blown-out photos.
- Road and pavement are no exposure reference either: one panorama's road median ran 0.03 to 0.25 (linear) by
  heading, sun against shade.
- PR 484 kept the photo's own exposure. The cameras expose for the sky, so a sunlit cream front reads sRGB 110 to 140
  in its own pixels (North Beach row 1368, four views): records' median L* 47, 98 of 134 walls on a grey entry.
- What stands (evidence-2, November 21): each face is scaled so the 95th percentile of its luminance outside the sky
  is 0.75 linear (`WHITE`, gain within 0.7 to 6), with the road and pavement white balance kept. A view more than 12
  L* below the building's second brightest, and the same colour once brought up to its light, is the wall in shade and
  is dropped (`SHADE`). The trust test then holds lightness at kL 1.5. Chosen offline on 663 panel views (dump of
  per-view stats) against 82 walls classed by eye; other percentiles and a per-camera white did no better.
- **Mapillary `captured_at` is often wrong** (daylight frames with the sun in them stamped 22:33 local), so the sun's
  position cannot say sun from shade or backlit. `sun()` was correct; its inputs were not. It is gone.
- Still fails when every view sees the wall in shade while the face's bright things are in sun (Telegraph Hill 328,
  North Beach 1372), and on open structures whose voids read as wall (Fishermans Wharf's garage, L* 18).

## Checking lightness (`evidence_check.py`)

Not the records' own pipeline: `evidence_eye.json` (82 panel walls classed light, mid or dark by eye) and the bake's
own wall colours as a population. Bars fixed before scoring: light median L* >= 68 with <= 10% under 50, dark median
<= 52 with <= 10% at 68 or more, mid 45 to 75, population median (measured - bake) within 15. PR 484's panel records
fail (light 52.9, 38% under 50; population -28.1); evidence-2's pass narrowly (light 72.4, 9%; dark 43.6; -14.5). The
eye set also chose the normaliser, so only its population half is independent of that choice.

## The trust test (`facade_evidence.consensus`)

Two views or more, from cameras at least 4 m apart, each with 30 clean wall texels and no more than 20% blown out,
whose colours lie within 10 of the building's (CIELAB, lightness at 1 / kL: 2 for the old reading, 1.5 for the new),
carrying 60% of the weight.
It is applied to the old reading (facade_paint's pixel rules) and the new on the same views for before and after.
Agreement is not correctness: whites from the old gain agree too. The panel proof compares against held-out
photographs for that (`evidence_proof.py`).

## What the panel render showed (November 21)

- 137 of 217 panel buildings took a measured wall (the round-2 tiles drew none from photographs); 32 of 58 changed
  walls a held-out photograph saw clearly moved closer in chroma, 7 farther.
- Looked at beside the photographs, the hue and material were right more often than not, but lightness was far too
  dark: 98 of 134 trusted walls snap to grey palette entries, records' median L is 47, and cream fronts in sun drew
  charcoal (North Beach, Chinatown, Haight-Ashbury, Fishermans Wharf). The held-out check cannot see this: it reads the
  photograph with the same method. Next: take a* and b* from the record and lightness from a reference of its own
  (white trim or sky in the same face), or from the bake's tone.
- The window share is a floor and drew upper windows at a median 20% of the bay against the rule's 48%; the judge
  failed two views for narrow windows. `evidence_tile.fields` no longer writes it.

## Material and palette

- Brick: SigLIP's "red brick" answers from colour and era. By eye 9 of 61 panel brick calls were brick. Drawn only when
  both views say brick at 0.85 or more and the trusted wall is reddish (a* >= 4) and not light (L* <= 62)
  (`evidence_tile.clear_brick`): 4 of the 9, none of the 52 others. Stucco and clapboard keep the 0.5 floor.
- Palette entries are picked nearest in CIELAB, not sRGB: grey picks went 71 to 56 of 134; the rest are walls whose
  chroma is under about 5. The palette (march.ts, bake.py) is full and shared; it was not changed.
- The far model finds records by the city's building number. `city_ids` matched only 22 of 717 records (pack rows are
  not one to one with footprint parts); `city_of` finds the footprint the building overlaps most (agrees on all 22) and
  `evidence_run.py cities` fills it in on existing records.

## Cameras

The survey's 44k lookups, the squares' 6.6k archived photos (in `sf-450-city/inputs/*.zip`) and the city run's
cached z14 coverage tiles. A coverage point is resolved (one Graph call for pose and thumbnail URL, one download)
only when picked. The 16 panel references and any camera within 5 m of one are never evidence. Graph pacing:
0.25 s spacing, slowed to 5 s when `X-App-Usage` reaches 75; the token is read from `keys/mapillary.token` and never
printed.

## Refresh when

transformers or torch change major version; a model is swapped; ADE20K labels change; the renderer gains a
material; the panel references change.
