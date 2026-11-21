---
name: facade-evidence
description: How Village reads Mapillary panoramas as evidence for each San Francisco building's facade parameters (wall colour, material, window share, storefront, awning) with local models (PyTorch, Hugging Face transformers, UperNet ConvNeXt ADE20K, SigLIP), and how those records reach the bake (engine/bay/facade_evidence.py, evidence_tile.py, #450). Versions, licences, the venv, measured speeds, what the models can and cannot see, and the trust test. Load before changing the segmentation or classifier, measuring more buildings, or reading the records from a new rule.
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
- CPU only (`EVIDENCE_THREADS`, default 8). The GPU is shared with the renderer; MPS is not used.
- Weights come from the Hugging Face Hub on first use (anonymous), pinned by revision in `facade_evidence.py`.

## The models

| Role | Model and revision | Licence (model card tag) | Measured on the M1 Pro, CPU under load ~12 |
| --- | --- | --- | --- |
| Segmentation: wall, sky, tree, car, person, pole, awning, sign... | `openmmlab/upernet-convnext-tiny` @ `876ffc56` (ADE20K, 150 classes) | MIT | 2.1 s for a 512 x 640 face (small: 3.3 s; 384 x 480: 1.35 s) |
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
- What stands: the photo's own exposure, a white balance from the face's road and pavement clipped to 10% a
  channel, wall texels only (segmented, unclipped, not under half the median: those are windows), shade views at
  0.35 weight. Lightness therefore follows the camera's auto exposure; chroma is the reliable part.

## The trust test (`facade_evidence.consensus`)

Two views or more, from cameras at least 4 m apart, each with 30 clean wall texels and no more than 20% blown out,
whose colours lie within 10 of the building's (CIELAB, lightness at half weight, kL = 2), carrying 60% of the weight.
It is applied to the old reading (facade_paint's pixel rules) and the new on the same views for before and after.
Agreement is not correctness: whites from the old gain agree too. The panel proof compares against held-out
photographs for that (`evidence_proof.py`).

## Cameras

The survey's 44k lookups, the squares' 6.6k archived photos (in `sf-450-city/inputs/*.zip`) and the city run's
cached z14 coverage tiles. A coverage point is resolved (one Graph call for pose and thumbnail URL, one download)
only when picked. The 16 panel references and any camera within 5 m of one are never evidence. Graph pacing:
0.25 s spacing, slowed to 5 s when `X-App-Usage` reaches 75; the token is read from `keys/mapillary.token` and never
printed.

## Refresh when

transformers or torch change major version; a model is swapped; ADE20K labels change; the renderer gains a
material; the panel references change.
