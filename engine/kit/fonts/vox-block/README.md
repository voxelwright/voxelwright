# vox-block

Our own drawing: a glyph set from `src/core/fonts/` laid flat as a web font.
Ten cells to the em, so one cell is 2 px at 20 px and one voxel at 40 px.

Build from `engine/kit` with `node tools/vox-text-export.mjs block > glyphs.json` and
`python tools/vox-text-build.py glyphs.json fonts/vox-block "Vox Block" vox-block` (needs fonttools and brotli).
