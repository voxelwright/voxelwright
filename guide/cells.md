# Worlds as cells

A world in [the engine](engine.md) is a function plus a history. A rule (the generated town in `engine/core/src/city.rs`, or San Francisco's packs in `engine/core/src/bay.rs`) says what every cell is before anyone touches it. The edits since then say what changed. Nothing else is stored: any sector, at any coarseness, is made again on demand from the rule and the edits. This page gives the formats that make that work, from a single cell to a pinned release.

## Concepts

- **Cell.** 10 cm a side at level 0. It holds a **kind**: a 16-bit number, with the material in the low 4 bits, flags in bits 4 to 7 and the palette colour in the high byte (`engine/core/src/kinds.rs`).
- **Sector.** 64 cells a side. The unit that is made, stored on the GPU and marched.
- **Level.** A copy of the world at cells 2^level times larger. The page keeps 9 levels on a desktop and 8 on a phone (`levels` in `engine/page/main.ts`), so the coarsest box has cells of 25.6 m or 12.8 m.
- **History.** The ordered edits. A shared world appends them to its world file. The page holds them in `engine/page/world.ts`, and each ask to a sector worker carries the edits that reach that column.
- **Release.** A content-addressed set of San Francisco tiles and their manifest, named by the SHA-256 of the manifest. A world on San Francisco is pinned to one release.

## A kind

| Bits | Meaning | Names in `kinds.rs` |
| --- | --- | --- |
| 0 to 3 | Material, 0 to 15. 0 is air. | `EARTH` = 1 through `LAMP` = 15 |
| 4 | Rubble: loose, holds nothing up | `RUBBLE` = 16 |
| 5 | Charged: goes up in a blast when hit | `CHARGED` = 32 |
| 6 | Holds a block of finer cells. Only the core sets it; no edit from outside carries it. | `FINE` = 64 |
| 7 | Polished: mirrors and glints, a look only | `POLISHED` = 128 |
| 8 to 15 | Colour. 0 is the material's own; 1 to 15 are greys; then 24 hues in 10 tones (`colour(hue, tone)`). | `OWN`, `WHITE`, `grey`, `colour` |

## A sector as a tree

`encode` in `engine/core/src/tree.rs` writes a sector's 64³ cells as `u32` words. The answer is one of three shapes:

| Words | Meaning |
| --- | --- |
| 0 | All air. |
| 1 | All one kind; that word is the kind. |
| n | A tree of n words. |

The tree has three levels of nodes: a root that splits the sector into 4 × 4 × 4 parts of 16 cells, those split into 4 × 4 × 4 leaves of 4 cells, and each leaf holds 4 × 4 × 4 cells. Child `c` of a node is at `x + 4z + 16y` within it, and only children that hold something are stored, in that order. A node is four words:

| Word | Contents |
| --- | --- |
| 0, 1 | The 64-bit mask, low half then high half: which of the 64 children hold anything. |
| 2 | Where the children are, in words from the start of the sector (low 20 bits, `CHILD`). For a leaf, where its cells' kinds are, two kinds to a word. For a root or mid node, bits 20 to 31 hold the high corner of the box around its contents. |
| 3 | The kind seen from far off in the low 16 bits, and `UNIFORM` (bit 31) when the node is all that kind. Bits 16 to 27 hold the content box: for a leaf both corners, 2 bits a number; for a root or mid node the low corner, 4 bits a number. |

The content box lets a ray skip a whole node when it passes over a roof or a slab. The same words are what the ray marcher reads, what the solver collides with, and what is kept or sent. With finer cells on (`FINE`), a leaf adds one more word per cell pointing to a block of 4³ or 8³ smaller cells; `encode_fine` describes it.

## Edits and the world file

An edit is a run of `Int32` words: a ball, a blast, or rows of cells. The table is in [the core's edit format](engine-core.md#the-edit-format). Every core that applies the same edits in the same order makes the same cells.

A shared world started with `node serve.mjs --world FILE` (in `engine/`) appends the frames it keeps to `FILE`. They use the stream's binary layout: a 12-byte little-endian header (kind, number, payload length as `u32`), then the payload. The kinds are in `engine/page/frames.ts`. Two kinds are kept: `LOG` (the core's words for what changed) and `ECHO` (each ask as JSON, at the moment the world did it). Reading the file again rebuilds the world. Realms are kept the same way, one `.log` file each, in a folder beside it.

## San Francisco tiles

A **pack** (or tile) holds what was measured of one square of the city: ground heights, what stands on the ground, building outlines and tree trunks. The core turns a pack into cells by rule (`bay.rs`). Packs are binary, little-endian, and start with the magic `BAY1`. `read` in `bay.rs` is the reader and `engine/bay/bake.py` is the writer.

| Header word (`int32`) | Field |
| --- | --- |
| 0 | `0x31594142`, the bytes `BAY1` |
| 1, 2, 3 | The square's corner x, z and its size, in cells |
| 4, 5, 6, 7 | Ground: sample step `gstep`, samples a side `gw`, first sample's x and z |
| 8, 9, 10, 11 | Tops: step `tstep`, samples a side `tw`, first sample's x and z |
| 12, 13, 14 | Counts: buildings, outline vertices, trunks |
| 15 | Flags. Bit 0: a walls array follows. |

After the 64-byte header come the ground (`gw²` × `i16`), tops (`tw²` × `i16`), class (`tw²` bytes), tint (`tw²` bytes), walls if flagged (`tw²` × `u16`), buildings (6 × `int32` each), vertices (3 × `int32`: x, z, what the side faces), trunks (4 × `int32`). Two optional trailers may follow: `SFST` street fixtures, and `SFPT` wall paint, which only a level-0 pack may carry. A pack that fails any length or range check is refused whole, and `bay_load` returns -1.

The frame is UTM zone 10N with its origin at 500,000 m east and 4,250,000 m north (`FRAME` = `10n4250` in `engine/page/bay.ts`). x runs east and z south, in cells. A tile's key at a level is `floor(x / size)_floor(z / size)`.

## A release

A release is static files that any HTTPS server can host:

```text
current.json                        the pointer, the only file that changes
releases/<sha256>/manifest.json     the manifest; its SHA-256 is the release name
releases/<sha256>/tiles/<level>/<x>_<z>.bay
releases/<sha256>/names/<square>.json
releases/<sha256>/far/...           optional far model (FAR1 faces)
```

The pointer is `{"version": 1, "release": "<64 hex>", "manifest": "<path relative to the pointer>"}`. The manifest has `version: 1`, `frame`, `credits`, `names` and `levels`. Each level has `level`, `size`, `gstep`, a `tiles` map from key to object record, and a `sea` list of keys that are verified open water. Every object record is `{path, bytes, sha256}`, with the hash over the decoded bytes. The page reads this as the `Manifest` and `Record` interfaces in `engine/page/bay.ts`.

What a reader must do, as `released` in `engine/page/bay.ts` does:

1. Fetch the pointer once per page load, past any cache.
2. Fetch the manifest and check its SHA-256 against `release`. Refuse a mismatch, an unknown `version` or another `frame`.
3. From then on ask only for objects that manifest lists. A key in `sea`, or a key not listed, is water and needs no request. A listed tile that fails to load is an error, never water. Per-square `names/<square>.json` files are fetched lazily around the eye rather than all at startup.

The full specification, including the far model, street life, vehicles and promotion after a visual check, is [engine/sf/release.md](../engine/sf/release.md). How a release is made is in [the city pipeline](city-pipeline.md).

## What would break if a field changed

- A renamed manifest field must change its writer, `engine/sf/release.py`, and its readers: `released` in `bay.ts` and the tile counts in `engine/sf/build.mjs`. A restaged manifest has a new hash, so the pin moves.
- A new pack header field or array changes `read` in `bay.rs`, `bake.py` and every staged tile. Old tiles are then refused, not misread, because the reader checks lengths exactly.
- A change to `tree.rs` encoding must change the WGSL reader in `engine/page/march.ts` in the same commit, because the GPU reads the words directly.

<!-- docs-verified 9075b5ef14578ad2fef8aab83b15a5e17ec14e5a {"engine/core/src/tree.rs":"02263380a20615fc50f449a0d04be2e0","engine/core/src/kinds.rs":"929afd0ffdb18c6ae56caf9449d546bd","engine/core/src/bay.rs":"9d62bad0aba6c79d30498345f47a2bd2","engine/bay/bake.py":"3827dff4cef6f8ca3beb4dc39f3b3b53","engine/page/bay.ts":"3c703f4b66b11eed07072d235b11d9dd","engine/page/main.ts":"5dfbe68c246dfe39741141ac8fd9b2a7","engine/serve.mjs":"ed02ff9bc2fec74458c497cc4161929f","engine/page/frames.ts":"982add52463aa24c413035bc86d1cd99","engine/sf/build.mjs":"a02914d1ec1942ee616eccb9a1233d66","engine/sf/release.py":"6e154c6d4d4e67bc12d1bdd68591911e"} -->
