# San Francisco release, v1

Fetch `sf/current.json` once per page load with revalidation. Its `manifest` is relative to the pointer URL. The lowercase 64-hex `release` is SHA-256 of the exact decoded manifest bytes, including its final newline. Check it before loading assets. Give every worker the same resolved manifest and base URL until reload.

The manifest contains `version: 1`, `frame: "10n4250"`, a displayable list of `credits`, a `names` dictionary keyed by southwest UTM square name, and three `levels` in increasing resolution-step order. All object records have a relative `path`, decoded `bytes` and lowercase decoded-byte `sha256`. Resolve paths relative to the manifest URL.

For each level, `level` is the integer index. `size` is the tile side and `gstep` the ground sampling interval, both in 10 cm cells. The frame origin is NAD83 UTM 10N (500000 E, 4250000 N), with x east and z south. Divide x and z in cells by size and floor each to obtain the key `x_z`, including for negative positions. Look up that key in `tiles` for its BAY1 object. A key in the `sea` list is verified open water and takes no request. An unlisted key is outside inventory. A failed fetch for a listed object is a load error.

The layout is `sf/releases/<release>/manifest.json`, with `tiles/<level>/<x>_<z>.bay` and `names/<square>.json` underneath the same directory. Immutable objects may be served with Brotli content encoding. The generator hashes uncompressed bytes. Replace the pointer after all objects exist.

Run the following from the repository root, with the Bay Python environment. The output directory represents the site's sf directory. The checked-in pilot fixture contains metadata only. To materialize its matching assets locally use

```sh
~/.village/engine/bay/venv/bin/python engine/sf/release.py ~/.village/engine/bay/pilot450/final-release /tmp/village-sf/sf --graphs engine/sf/pilot-graph
```

## Optional far model

Supply `--far /local/build/far.json` to include face objects in the pin. The far producer writes this v1 inventory beside its `far/<band>/<key>.far` objects. The generator checks each path, length and SHA-256, then includes the producer's inventory, LODs and credit in the same release digest.

The runtime manifest has `far.size = 5000` cells and `far.bands = [4,1,0]` in metres. Each `far.tiles[x_z]` is a three-element array of object records or null. Each FAR1 object contains its section headers and face payload. Fetch coarse band 0 first and add finer bands toward the eye. Unlisted keys have no far coverage.
