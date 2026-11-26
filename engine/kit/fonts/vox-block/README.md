# Vox Block

The kit's own lettering face: the Vox Block glyph set (`../../src/core/fonts/block.js`) laid flat
as a web font. Capitals 11 cells tall with a two-cell stroke, for signs and voxel headings. Ten
cells to the em, so one cell is 2 px at 20 px and one voxel at 40 px. The stylesheet carries this
face inlined as a data URI, so a heading has the same box with and without voxels.

Rebuild from `engine/kit` (needs Python with fonttools and brotli), then inline it again:

```sh
node tools/vox-text-export.mjs block > glyphs.json
python tools/vox-text-build.py glyphs.json fonts/vox-block "Vox Block" vox-block
python tools/type-inline.py
```

SIL Open Font License 1.1 with reserved font names (`OFL.txt`). How the Vox fonts are built:
[Blocks and the Vox fonts](../../../../guide/blocks-and-fonts.md).
