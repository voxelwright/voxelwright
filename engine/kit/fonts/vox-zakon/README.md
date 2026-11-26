# Vox Zakon

A second Vox family, drawn after Zakon in the same cell grid: the Vox Zakon glyph sets
(`../../src/core/fonts/zakon.js` and `zakon-text.js`) laid flat as web fonts. Ten cells to the
em, so one cell is 2 px at 20 px and one voxel at 40 px. The San Francisco realm sets
`--vx-key-font` to "Vox Zakon Text" by default (`engine/page/typeface.ts`; `?face=block` uses Vox Text).

| File | Family | Glyph set |
| --- | --- | --- |
| `vox-zakon-400-normal.woff2` | Vox Zakon | `zakon`, the display set: capitals 11 cells tall, like Vox Block |
| `vox-zakon-text-400-normal.woff2` | Vox Zakon Text | `zakontext`, the key set: capitals 7 cells tall, like Vox Text |
| `vox-zakon-text-700-normal.woff2` | Vox Zakon Text, bold | `zakontextbold`, a drawn bold rather than a smeared one |

Rebuild from `engine/kit` (needs Python with fonttools and brotli). Export each set with
`node tools/vox-text-export.mjs <set> > glyphs.json`, then build it:

```sh
python tools/vox-text-build.py glyphs.json fonts/vox-zakon "Vox Zakon" vox-zakon                      # zakon
python tools/vox-text-build.py glyphs.json fonts/vox-zakon "Vox Zakon Text" vox-zakon-text            # zakontext
python tools/vox-text-build.py glyphs.json fonts/vox-zakon "Vox Zakon Text" vox-zakon-text --as-bold  # zakontextbold
```

SIL Open Font License 1.1 with reserved font names (`OFL.txt`). How the Vox fonts are built:
[Blocks and the Vox fonts](../../../../guide/blocks-and-fonts.md).
