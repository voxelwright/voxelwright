# Vox Sign

The kit's narrow lettering face: the Vox Sign glyph set (`../../src/core/fonts/sign.js`,
registered as "Vox Sign 2") laid flat as a web font. Capitals 7 cells tall, used where a column
is too narrow for Vox Block. Ten cells to the em, so one cell is 2 px at 20 px and one voxel at
40 px. The stylesheet carries this face inlined as a data URI.

Rebuild from `engine/kit` (needs Python with fonttools and brotli), then inline it again:

```sh
node tools/vox-text-export.mjs sign > glyphs.json
python tools/vox-text-build.py glyphs.json fonts/vox-sign "Vox Sign" vox-sign
python tools/type-inline.py
```

SIL Open Font License 1.1 with reserved font names (`OFL.txt`). How the Vox fonts are built:
[Blocks and the Vox fonts](../../../../guide/blocks-and-fonts.md).
