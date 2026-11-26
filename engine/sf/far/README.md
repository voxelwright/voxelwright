# The far view

Past about a kilometre the realm's cells are boxes of 6.4 m and more, and a tower becomes a plain block. So the city is also baked as faces: the outside faces of the lidar's columns, every side of them, in 500 m tiles. `page/far.ts` draws them past 500 m from the eye. Past that distance `page/march.ts` leaves whatever its cells meet in a tile the far model holds, so cells are drawn near and faces far, never both.

The faces ship in the release as its `far` section and `.far` objects. Their format (`FAR1`, 20-byte faces in three bands by size) is in [the San Francisco release](../../../guide/sf-release.md#far1-far-faces).

## Where the faces come from

| Source | Covers | Made by |
| --- | --- | --- |
| The Ina wedge | Bearings 87 to 152 degrees from the eye of the photograph the first view is rebuilt from, out to 3.3 km | `landing/ina/matte.py` (place `ina-all`). Faces are 25 cm out to 700 m from the apex and 50 cm past that, laid out along the streets. Colours are fitted to the photograph. |
| The squares | Everywhere else | `bake.py`, from each square's retained archive. Faces are 1 m. |
| Landmarks | Each landmark in `sf/heroes.json` | `heroes.mjs`, from the core's own rule (`core/src/heroes.rs`) |

`pack.mjs` gives each place one owner. Inside the wedge the wedge's faces win; a tile the wedge holds only in part takes each face by where its middle is. Lidar faces are left out wherever a landmark rule owns the place.

In the wedge, faces begin 100 m from the eye instead of 500 m, but only through a lens narrower than 50 degrees. That is where the first view's 25 degree lens makes each cell 3 to 7 pixels across, and the wedge's finer faces look better. The listing's `wedge` says where it is. Cut the first view (`landing.mjs`) with `--reach 100` so its first picture has that foreground.

The wedge's colours were fitted under the photograph's light (`landing/ina/light.json`). The listing's `light` carries it, and `far.ts` uses it only inside the wedge through a narrow lens, which is all the photograph vouches for. Faces take the march's fog as cells do.

### Trees

Lidar sees a tree as a solid green column, and a crown over a building's outline as part of that building. One rule, `crown_rule` in `landing/ina/matte.py`, finds every crown and gives it trunks, a ragged top and gaps. Both the wedge and `bake.py` call it. The wedge bakes crowns in layered slabs, with the ragged top and gaps only within 400 m of the eye (`DETAILED`). The square bake writes one smooth slab per crown. Raising `VERSION` in `bake.py` makes `grow.sh` bake every square again.

## Run it

From `engine/`:

```sh
cd engine
sh sf/far/grow.sh                    # bake new or changed squares, repack only the tiles they touch
sh sf/far/grow.sh --watch 300        # the same every five minutes, while the city run goes on
node sf/far/coverage.mjs             # how many lidar squares are archived, baked and packed
node sf/build.mjs                    # the static realm, with the far model
node sf/far/check.mjs                # four views: the park beside the photograph, downtown, the Pyramid, a street
node sf/far/check.mjs --only park    # one view
```

Baked blocks go to `~/.village/engine/sf/far/squares/<square>/`, the packed listing and tiles to `~/.village/engine/sf/far/release/`, and pictures to `~/.village/engine/sf/far/shots/`. The Python tools use the Ina venv, `~/.village/engine/landing/ina/venv/bin/python`.

To put new far tiles or a new first-view cut into a release, restock it ([release.md](../release.md)): far tiles first, then cut the first view from that release, because a cut holds faces of the tiles it was made from.

## Files

| File | What it does |
| --- | --- |
| `bake.py` | One square's faces, a block per 500 m tile it touches. Skips a square whose archive is unchanged. |
| `pack.mjs` | Packs the blocks into far tiles and their listing (`far.json`, `far/<band>/<x>_<z>.far`). Repacks only tiles whose sources changed. Raise `PACKED` when the object layout changes. |
| `heroes.mjs` | Landmarks' faces from their rules, as a source for `pack.mjs` |
| `landing.mjs` | The first-view cut: of every band, only the faces seen from the realm's arrival camera (`sf/realm.json`), one object a tile, fetched before the first picture |
| `grow.sh` | Runs `bake.py`, `pack.mjs` and `coverage.mjs` |
| `coverage.mjs` | Squares wanted, archived, baked and packed |
| `check.mjs` | Shots from four eyes with faces drawn, bytes held and fetched, and GPU ms with and without the far model |
| `first.mjs` | The park as first shown on a throttled link, and what crossed the wire until then |
| `peek.mjs` | A quick picture of the static realm after a while |
| `measure.py` | The park's skyline against the photograph |
| `sheet.py` | Contact sheets of `check.mjs` runs |
| `strike.mjs` | Where a ray meets the far faces, without a GPU (used to seat signs on towers) |

## Address switches

| Switch | Default | Meaning |
| --- | --- | --- |
| `?farreach=` | 500 | Metres from the eye where faces begin. 0 turns the far model off. |
| `?farnear=` | 100 | Metres from the eye where faces begin inside the wedge |
| `?farlight=fill,gain` | the listing's `light` | The faces' light |
| `?fardetail=` | 0.75 | How many pixels across a face must be to be drawn |
| `?farfaces=` | 12000000 | The most faces held |
| `?farlanding=URL` | | A first-view cut's listing, for a release without one |
| `?farcutfit=` | 1.6 | How much taller than its tallest picture the first-view cut is still trusted |
