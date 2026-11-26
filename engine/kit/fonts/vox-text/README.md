# Vox Text

The face for words on keys (`--vx-key-font`): the Vox Sentence glyph set
(`../../src/core/fonts/sentence.js`) laid flat as a web font, with lowercase, capitals 7 cells
tall and an x-height of 5. Ten cells to the em, so one cell is 2 px at 20 px and one voxel at
40 px. Two weights: 400, and a 700 the build makes by smearing each cell one to the right.

Rebuild from `engine/kit` (needs Python with fonttools and brotli):

```sh
node tools/vox-text-export.mjs sentence > glyphs.json
python tools/vox-text-build.py glyphs.json fonts/vox-text "Vox Text" vox-text --bold
```

SIL Open Font License 1.1 with reserved font names (`OFL.txt`). How the Vox fonts are built:
[Blocks and the Vox fonts](../../../../guide/blocks-and-fonts.md).
