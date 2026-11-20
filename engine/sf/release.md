# San Francisco release, v1

Fetch `sf/current.json` once per page load with revalidation. Its `manifest` is relative to the pointer URL. The lowercase 64-hex `release` is SHA-256 of the exact decoded manifest bytes, including its final newline. Check it before loading assets. Give every worker the same resolved manifest and base URL until reload.

The manifest contains `version: 1`, `frame: "10n4250"`, a displayable list of `credits`, a `names` dictionary keyed by southwest UTM square name, and three `levels` in increasing resolution-step order. All object records have a relative `path`, decoded `bytes` and lowercase decoded-byte `sha256`. Resolve paths relative to the manifest URL.

For each level, `level` is the integer index. `size` is the tile side and `gstep` the ground sampling interval, both in 10 cm cells. The frame origin is NAD83 UTM 10N (500000 E, 4250000 N), with x east and z south. Divide x and z in cells by size and floor each to obtain the key `x_z`, including for negative positions. Look up that key in `tiles` for its BAY1 object. A key in the `sea` list is verified open water and takes no request. An unlisted key is outside inventory. A failed fetch for a listed object is a load error.

The layout is `sf/releases/<release>/manifest.json`, with `tiles/<level>/<x>_<z>.bay` and `names/<square>.json` underneath the same directory. Immutable objects may be served with Brotli content encoding. The generator hashes uncompressed bytes. Replace the pointer after all objects exist.

Run the following from the repository root to stage a six-square release from the retained pilot packs. The output directory represents the site's sf directory.

```sh
~/.village/engine/bay/venv/bin/python engine/sf/release.py ~/.village/engine/bay/450-paint/final/pilot /tmp/village-sf/sf
```

## Optional far model

Supply `--far /local/build/far.json` to include face objects in the pin. The far producer writes this v1 inventory beside its `far/<band>/<key>.far` objects. The generator checks each path, length and SHA-256, then includes the producer's inventory, LODs and credit in the same release digest.

The runtime manifest has `far.size = 5000` cells and `far.bands = [4,1,0]` in metres. Each `far.tiles[x_z]` is a three-element array of object records or null. Each FAR1 object contains its section headers and face payload. Fetch coarse band 0 first and add finer bands toward the eye. Unlisted keys have no far coverage.

## Promotion after a visual pass

The generator stages a local candidate and prints its digest. Score each fixed camera from `engine/bay/neighbourhoods.json` at street level and at 100 m. Run the same command with `--panel /path/to/panel.json` to move `current.json`. The receipt contains the candidate `release`, the `previousRelease` currently pinned in this output directory (JSON null for a first release), the SHA-256 of the tested Wasm in `coreSha256`, the SHA-256 of `neighbourhoods.json` in `panelSpecSha256`, and a `scores` object keyed by all sixteen place names. The default Wasm comes from `engine/page/core.wasm` by default. Pass `--core` for a staged build. Each value is a pair of numbers ordered street, 100 m. Every value must equal or exceed the preceding pin and the committed visual floors. A stale receipt or one lower score leaves the existing pointer in place. Inventory-only output stages metadata for inspection.

A prototype may append an `SFPT` trailer to a level-zero BAY1 tile, following the optional `SFST` fixtures. All numbers are little-endian. The four-byte magic and uint32 record count precede records containing the directed edge's vertex index (uint32), absolute base height in 10 cm cells (int32), width and height (uint16 each), and width × height palette bytes in row-major order from the bottom. Each texel covers 30 cm along and up its edge. Zero uses the procedural wall. The building's existing style field identifies Transamerica's perimeter truss and surveyed tall lobby or arcade uses. Install the matching core with a painted pin.

## Street life and vehicles

Supply the directories written by `sf/life.py` and `sf/cars.mjs` as `--life DIR --cars DIR`, or place them under the bake root as `life/` and `cars/`. Each optional manifest member has an `index` object record and an `objects` dictionary. Life keys are the exact named squares in the release. Car keys are the vehicle IDs. Every record has the ordinary manifest-relative path, decoded length and SHA-256. The index files keep their producer format and resolve their child paths relative to the index. The release digest covers both indexes and their complete libraries.

A static build can take `--street-manifest …/releases/<digest>/manifest.json`. It checks the digest and each library object, sets both realm street URLs inside that pin, and uses the original square and car loaders. Older standalone builds still use the six-square sample. To apply a gated paint batch to verified cell tiles, pass `--paint …/450-city-paint/accepted/<batch>.json` to the release generator. The resulting tile bytes enter the normal release digest and promotion gate.

The combined local pilot manifest at `pilot/releases/877b9a7e5695183243d79a2f148e9166b85a3354f61e0f41b5903317edb4ea5f/manifest.json` is a worked example with 149 cell tiles, six graph and life squares, four vehicles and 1,360 far objects. Its two street indexes are included in the 1,533 verified objects.

## Compact local storage

The city runner checkpoints decoded square and tile hashes. After a checkpoint, it writes the base with zstd level 3, decodes the stored object, checks SHA-256 and switches the square or tile to a `.bay.zst` link. It retains the survey ZIP. The cutter opens the frozen bake recipe and decodes the contributors for one tile group in its private scratch directory.

Pass `--compact-store ~/.village/engine/bay/sf-450-city/objects` when staging city release generations. Each compact pin has a local `.bay-store` link. The store shares the zstd geometry base and individual SFPT wall records across versions. Reassembly preserves record order and checks the complete tile hash. Names, graphs, life, vehicles and far objects share verified library directories across paint generations. When the city publication job supersedes an unpublished candidate, it compresses its manifest and keeps its objects available to the exporter. Promoted manifests stay directly readable. The public manifest, paths, decoded lengths and pins use the ordinary static format.

To export one object for a static build or a consuming stream, run the following from the repository root. Omitting `--object` exports all objects and the manifest to an explicitly chosen destination. The local city services keep their releases compact.

```sh
~/.village/engine/bay/venv/bin/python engine/bay/compact_store.py "$manifest" "$destination" --object tiles/0/206_265.bay
```
