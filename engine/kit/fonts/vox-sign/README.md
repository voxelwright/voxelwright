# vox-sign

Our own drawing: a glyph set from `src/core/fonts/` laid flat as a web font.
Ten cells to the em, so one cell is 2 px at 20 px and one voxel at 40 px.

Built by `node tools/vox-text-export.mjs sentence > glyphs.json` and
`python tools/vox-text-build.py glyphs.json packages/voxelmorphism/fonts/vox-text` (needs fonttools and brotli).

No licence has been chosen yet: this is unpublished work, and nothing here is released until the owner says so.
