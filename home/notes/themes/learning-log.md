# Themes learning log (#50)

Read before every round. Scores are overall out of 10.

## Where it stands (November 7, before regroup 1)

| Look | Opus | GPT-6.1 Sol |
| --- | --- | --- |
| Blue hour | n/a | 7 |
| Pastoral | 6 | 7 |
| 16-bit | 6 | 6 |
| Neon night | 6.5 | 6 |
| Comic | 6 | 6 |

Polish rounds moved scores by less than 0.3 over the last two rounds on every look: the plateau trigger.

## Ceilings: complaints that survived rounds and models, and why tuning can't fix them

1. **The world outside is the same yard in every theme.** Neon night's iso shows a suburban garden and a picket fence (GPT consistency 4); blue hour's iso has a tan afternoon backdrop; the seat window and the iso exterior disagree. Tokens only recolour the existing yard; they can't turn it into a city street or a twilight garden.
2. **Every surface keeps its 3D render shading.** Comic "reads as an outlined 3D render, not a printed page"; pastoral's fridge stays brushed steel and the chairs glossy; 16-bit "looks mechanically sampled". Roles group materials by where they are, not by what they are, so a matte override also frosts the window glass. Post-processing can't remove a specular highlight it can't tell from a light.
3. **The props are the same objects in every theme.** Pastoral's "furniture remains conspicuously precise"; 16-bit's small objects become "anonymous marks"; neon's trim reads as paint, not tubes. A theme recolours a table; it never builds a different one.
4. **The iso view floats.** No contact shadows under chairs and cabinets, hazy depth (pastoral, blue hour).

## Regroup 1: three strategies, prototyped side by side on Neon night and Comic

- **S1, the theme owns the world.** Each theme hides the default yard and stands its own exterior, sized from the house's bounds: a wet city block with signs and rain, a printed-page comic street, and so on. The seat window and the iso exterior show the same place.
- **S2, the theme owns the shading (too bold).** Every material is remapped by what it is (metal, glass, wood, fabric, painted, ceramic, emissive) into the theme's own shading model: toon ramps and flat fills for comic, wet PBR and tube emissive for neon. Classes also make "matte everything except glass" possible.
- **S3, the theme redecorates.** The five most visible props are remade per theme through the model and the prop sandbox, cached, and swapped in. Villager costumes take the theme's palette.

Each is scored by the same council (Opus and GPT-6.1 Sol) with the current look as the reference. The winner is adopted for every look; strategies can stack if more than one moves the score.

## Regroup 1 results: S1 and S2 (council: GPT-6.1 Sol and Opus, overall, iso weighted)

| Look | REF | S1 world | S2 shading |
| --- | --- | --- | --- |
| Neon night | 6.5 / 5.5 (mean 6.0) | 7.5 / 6.5 (**7.0**) | 6.5 / 6.0 (6.25) |
| Comic | 7.5 / 6.5 (**7.0**) | 6.5 / 6.5 (6.5) | 7.0 / 5.5 (6.25) |

What moved the score, and why:
- **Owning the world is the biggest single lever where the default world contradicts the theme.** Neon's iso finally reads as a city: +1.0 mean, seat/iso consistency 4-5 to 6-8. Tokens and post never got close.
- **But the window must show the same place, and keep its depth.** S1's neon seat window became a flat facade with white slabs; both reviewers marked it down. A painted card with rain and signs beat a real but flat 3D facade at that distance.
- **An exterior must be quieter than the room.** Bright window grids (neon) and pastel dots with heavy lines (comic) compete with the kitchen in iso. The room is the subject; the world is the frame.
- **Swapping shading models hurts a look built on shading.** Comic's halftone and ink read light and shade; S2's flat fills removed what they print (Opus: "drifts toward generic cel shading"). S2 helped neon only where materials should differ (chrome fridge, wet speculars), and overdid it (blazing counter).
- Stacking: both reviewers say S1 + S2 can stack for neon with quieter highlights; neither for comic as built.

## Regroup 1 results: S3 (props remade per theme), council GPT-6.1 Sol / Opus

| Look | REF | S3 |
| --- | --- | --- |
| Neon night | 7.5 / 5.5 (mean 6.5) | 6 / 5.5 (5.75) |
| Comic | 7.5 / 6.5 (**7.0**) | 6.5 / 6 (6.25) |

Not adopted. It stays behind `&redecorate=1`. Why it lost:
- **Remaking 5 of about 20 visible objects breaks cohesion.** The remade props speak a different language from everything left alone: "an LED furniture collection among ordinary possessions" (neon), "a coordinated toy set beside the quieter cabinetry" (comic). Partial redecoration reads as stickers.
- **A remade prop loses its lived-in detail.** The fridge lost its magnets and children's drawings, the strongest sign of a home. A theme must restyle an object, not replace it.
- **Emissive edges everywhere flatten the hierarchy.** Neon needs two or three motivated hero lights, not strips on every edge.
- What worked and is worth keeping later: the neon dome pendant, the comic polka-dot pendant and inked table edges, and villager hats that read without intruding.

A future S3 would restyle the whole room in one shared palette and keep each object's details (magnets, drawings, books). The model would be given the original's parts to restyle, not a blank brief. It would also take the room's own palette and ink weights as hard constraints.

## Rollout A: S1 adopted for Neon night, Comic and Blue hour

`world` is now a token (`neon-city`, `comic-page`, `twilight-street`), checked against the registry in `world/index.ts`; `&world=0` turns worlds off. Neon also carries `shade: 'wet'` (S2, quieter). Scorer: one fresh `claude -p --model opus` per round, seat and iso at `?q=high`, the previous `final/` shots as reference, rubric only. Round 1 and 2 are on the connected house (kitchen and living room); the reference is the one-room house.

| Look | Reference | Round 1 | Round 2 |
| --- | --- | --- | --- |
| Neon night | 6 to 7 | 6 | **7** |
| Comic | 6.5 to 7 | 6 | 6 |
| Blue hour | 5 | 7 | **7.5** |

Stopped after two rounds on time, not on a plateau.

What changed, and what moved:
- **Seat windows hang a painted card again, placed from the measured window card.** Every world hangs its own seat-only card where the window's card hung (`house.view`), and keeps its far row behind it. Neon got its rain, tubes and depth back (the reference card). Comic and blue hour paint the same street they stand in iso. Consistency went up: blue hour scored 8 twice, and neon 6 to 7.
- **Quieter towers helped neon only once they carried the card's tubes.** Dim, varied window kinds (four textures, about one window in ten lit) made the room the subject. But round 1 still said "no magenta or cyan in iso", so the window and the city disagreed. Biasing signs to magenta and cyan and adding plain vertical tubes moved neon from 6 to 7.
- **Letter-like sign marks read as words.** A stacked T-and-O mark read as "TOTO". Signs are now proportioned regions of one atlas (a tall blade, a 4:1 band, a shopfront), with abstract bars and waves, so nothing stretches.
- **S2 on neon, quieter.** Walls, emissives, glass and the floor keep their own shading. Painted props get darker but no glossier; that change is what removed the blazing counter edge. Chrome is satin at roughness 0.36 with a faint sky term. The wood keeps its wet satin. Nobody flagged the shading this time.
- **Blue hour's new world beat its reference by 2.5.** The sky cylinder replaced the tan backdrop. Taking the world out of the room's fog removed the "hazy" read. Nothing outside casts shadows (the sun has set), which removed the long stripes across the lawn.
- **Comic did not move.** Quieter panels and lines are calmer, and the facade UVs now show windows on every house. But both rounds score its print treatment of the room (soft render, thin uneven ink, halftone only in shade) and its seat/iso mismatch (pitched roofs on the card, flat boxes in 3D). Neither is a world problem alone. The next lever is S2 toon on the room plus gabled 3D houses, or a print pass.

Still open: blue hour's sky shows a hard edge between the neighbours, and the seat tree is a flat disc. Neon's iso lighting is split, with the living room hot pink and the dining side murky; that comes from the lounge lights under the theme, not the world. Comic's airbrushed wall shading is outside this rollout's files.

## Rollout B: pastoral and 16-bit own their worlds, contact shadows in every look

Scorer: a fresh `claude -p --model opus` each round, given seat and iso shots at `?q=high&world=1` and the `final/` references. The references frame only the kitchen in iso, so framing was left out of the score. Overall scores, candidate / reference:

| Round | Pastoral | 16-bit | What changed before it |
| --- | --- | --- | --- |
| 1 | 7 / 7 | 6 / 6 | Worlds stood. Pastoral: a heightfield with a gouache patchwork, a lane, hedgerows, layered trees, a far farmhouse and a sky arc. 16-bit: a lot painted one texel per 10 cm, a stone path, a fence, chunky trees, and a banded pixel sky for the window. Contact role (`contact-deep`). Broad pixel planks. |
| 2 | 6 / 7 | 6 / 6 | Pastoral world out of the fog, with a painted paper fade at the edges; window trees and farm moved. 16-bit: rounder two-tone canopies, fewer pines, calmer grass, floor gain 0.7 to 0.84. |

Seat and iso consistency rose on 16-bit in both rounds (reference 4, candidate 6 to 7). Pastoral's stayed at 6 (reference 5 to 6).

What moved the scores, and what didn't:
- **A window needs its own sightline plan.** The seat sees only about 13 degrees of elevation through the window. In that band a tree 15 m out fills a whole pane, and a 2.4 m farmhouse 15 m out reads as a box. Work out the window's view before placing anything (x about -4 to -0.5 at 10 m back), and open a vista in tree rows that cross it.
- **Fog belongs to the camera, not the world.** The seated room's fog (6 to 22 m) blanked a 20 m view to paper, and the dollhouse fog veiled the whole meadow. A world that must read at both distances turns fog off and paints its own aerial fade.
- **A ground read one texel per art pixel or so is what makes 16-bit read as pixel art.** At 10 cm a texel, with nearest filtering and no mipmaps, the grass, path stones and single-texel flowers stay crisp through the pixel stage. Large light and dark blotches read as noise; a flat mid green with sparse two-texel tufts is calmer.
- **Faceted icosahedra read as PS1 low-poly, not as sprites.** Detail-1 crowns, coloured in three tones by facing, read as rounded sprites.
- **The theme was lightening the contact shadows.** The decals fell into the `other` role, so pastoral's cream tint brightened them. They now have their own role, a denser painter and a hue per theme. A near-black tint read as stains, and a saturated violet read as purple paint. A mid grey-brown core multiplied by a muted hue works.
- **Still capping both looks in both rounds:**
  - Large diagonal light and shadow wedges across the iso yard. They were already in the pre-world baseline: the long golden-hour house shadow plus the edge of the 18 m shadow box.
  - Interior legibility in 16-bit iso: at whole-house zoom, dither and bloom turn the furniture to mud.

  Neither is world work.

## Council 2: all six looks with their worlds, on the connected house (GPT-6.1 Sol / Opus)

| Look | GPT | Opus | Mean | Before regroup 1 (council, mean) |
| --- | --- | --- | --- | --- |
| Golden hour (home) | 7.5 | 7.5 | 7.5 | n/a |
| Blue hour | 7.5 | 6.5 | 7.0 | 7 (GPT only) |
| Pastoral | 7 | 7 | 7.0 | 6.5 |
| 16-bit | 6.5 | 7 | 6.75 | 6 |
| Neon night | 6.5 | 5.5 | 6.0 | 6.25 |
| Comic | 6.5 | 5.5 | 6.0 | 6 |

What this says:
- **The ceiling moved from the outside to the inside.** Both models: "the exterior worlds do most of the stylizing, while the interiors stay close to home". In iso, comic and pastoral interiors look nearly like the home. The worlds fixed seat and iso consistency (neon 8, pastoral 8), but the overall score is now set by the room.
- **Neon's S1 gain was lost on the connected house.** The prototype scored 7.0 on one room. On two rooms, the kitchen falls to near-black and the living room glows hot pink: "a nightclub installation rather than a refuge". The world was right; the interior lighting hierarchy is wrong.
- **Every look needs one warm, motivated light pool as the room's focal point** (neon's kitchen, blue hour's pendant), and grounding (contact shadows under chairs and sofa).
- **Shared engine artifact:** hard diagonal shadow wedges on the iso lawn in 16-bit and pastoral (the sun's shadow box), not a per-look issue.
- **16-bit iso:** furniture dissolves at home-screen scale; dither should be reserved for silhouettes and shadow edges.
- A single scorer moves by about 1 point between sessions (blue hour 7.5 in rollout A, 6.5 here). Trust the mean of the two models.

## Regroup 2 (comic): three print strategies side by side

Ceiling: every round and both models read the room as a soft 3D render with outlines, not a printed page. Soft gradients and a beige wash dominate, and the world outside can't fix the room. Three prototypes, all post stages in `fx/print.ts` (one new `print` stage kind), behind `&comic=c1|c2|c3` on the connected house. Shots: `regroup2/comic-<c1|c2|c3>-<seat|iso|villager>.jpg`.

- **C1, toon plus tonal halftone (`&comic=c1`).** S2's toon model on every classified surface (`shade: 'toon'`). In post, each surface's own colour (the albedo attachment) snaps by OKLab to one shared set of 18 comic inks, so walls, wood and props share a palette and the beige wash goes. Light becomes three flat steps from lit over albedo: sunlit, ambient (a fine 45° dot screen) and shadow (merging plum dots). Ink is 3 px. Magnets, drawings, books and the window street stay readable. Rough edges: the palette is 18 inks, not about 12, and the living-room floor lands on a greige.
- **C2, the frame is a printed page (`&comic=c2`).** Post only. The same colourist's flats (the comic inks, in three light steps) are separated into cyan, magenta, yellow and black plates. Each plate is bare, a light or full Ben-Day tint, or solid, and prints with its own screen angle. Newsprint fibre, uneven solids and noisy dot edges stand in for bleed; the exterior prints the same way. Every flat-and-step recipe is matched once on the CPU. A per-pixel search over the 49 overprints cost 19 to 24 ms GPU, and the table brought it to 7.9. Rough edges: plates are not misregistered yet. The colour comes from the albedo attachment, so the `chroma` stage left in the variant only shifts sky and glass pixels (the same holds for C1). Real misregistration needs the albedo sampled at a per-plate offset. The soft wall shading crosses the shadow step in blotches. The window glass (transmissive without toon) writes a pale albedo, so the street outside prints near-blank.
- **C3, too bold: inked line art with spot colour (`&comic=c3`).** Paper everywhere. Flat spot colour (six inks) only where the surface's own colour is saturated (fruit, plants, magnets, pot, pink boxes), spotted blacks on dark neutral surfaces (the lamp shade, a chair) and 45° hatching, crossed in deep shadow, instead of shading. Ink is 2.6 px with full creases. It reads as a clean graphic-novel page in the seat. The iso loses floors and rugs to paper and shows doubled lines on walls. The felt villager b is cream, so it prints as paper with pink cheeks: readable but not spot-coloured. The same glass problem as C2 hits the window.

Frame cost, `npm run measure -- '<url>' --perf --gpu`, `?theme=comic&q=high`, DPR 2, GPU ms p50 / p95:

| | seat | iso |
| --- | --- | --- |
| Current comic | 8.6 / 10.4 | 8.5 / 10.8 |
| C1 | 7.7 / 10.0 | 7.4 / 9.4 |
| C2 | 7.9 / 9.4 | 7.6 / 9.4 |
| C3 | 7.8 / 9.0 | 7.0 / 8.5 |

All three are cheaper than the current look (the print stage replaces the halftone's 12-tap flattening) and within the high tier's 13 / 16 ms.

## Regroup 2 results: comic (GPT-6.1 Sol / Opus)

| Candidate | GPT | Opus | Mean |
| --- | --- | --- | --- |
| REF | 7.0 | 5 | 6.0 |
| **C1 toon + tonal halftone + 18 shared inks** | 7.5 | 6.5 | **7.0** |
| C2 printed CMYK page | 4.5 | 3 | 3.75 |
| C3 inked line art + spot colour | 5.5 | 4.5 | 5.0 |

C1 adopted as the comic direction, +1.0. What the round taught:
- **Unity beats texture.** One shared ink palette and halftone carrying tone across the whole room is what finally made it "a printed page" (unity 7 to 8). Dots stuck on as a surface texture never did.
- **Print mechanics must serve the values, not replace them.** C2's CMYK plates turned into "mould or water damage". Separation screens are a finishing layer on a solid value hierarchy, never the hierarchy itself.
- **Line art alone collapses in iso.** C3 is elegant at eye level, but from above with no floor or wall colour the house stops reading. The home screen needs colour masses.
- **Both reviewers asked C1 for the same thing:** a warm, dot-free paper pool under the lamp, with dots densening away from it. They also want lighter dot coverage on walls (dense only in shadow and under furniture), heavier silhouettes with finer inner lines, contact shadows, and material cues on the iso floor. That is the same "one warm light pool" lesson council 2 gave every look.

## Regroup 3 (interiors): three strategies side by side

Ceiling (council 2): the worlds do the stylising and the rooms stay close to home. Three prototypes in `src/theme/interior/`, behind flags, on the connected house. Shots: `regroup3/<i1|i2|i3>-<look>-<seat|iso>[-off].jpg` at `?q=high`, DPR 1. The `-off` shots carry the wedge fix below (it is on whenever a world stands), so the off/on pair isolates the strategy. Self-check only; the council has not scored these yet.

- **I1, a motivated light hierarchy (`&pools=1`), neon night and blue hour.** Config per theme in `interior/pools.ts` (no token, so `check()` is untouched). Warm painted pools (additive radial decals) lie on the dining table, around it, in front of the counter, by the reading chair and at the sofa's end. One real point light per room is added (under the kitchen cabinets, at the lounge lamp). The room's own lights are re-balanced after the theme's shift. Neon: the pendant goes amber and reaches the whole table, its bulb and the reading-lamp shade glow amber, the lounge glow goes cool violet at 0.28, and the magenta rim is halved. Result: the kitchen is a warm refuge and the lounge is cool instead of hot pink; the kitchen's toy corner stays dark. Blue hour: a warmer pendant, the lounge glow cooled and the window key lifted 1.35; the warmth now gathers at the focal points. Rough edges: the reading lamp has no light of its own (decal only), and the lounge's neon walls still read lilac. Adding lights recompiles every lit pipeline once (about 10 s settle at a theme switch).
- **I2, sized for the dollhouse view (`&isofit=1`), 16-bit.** In iso the art pixel follows the house's projected height (260 art rows across it): 300 rows instead of 225 at DPR 1. Outlines use the depth jump in metres (Laplacian of 1/z times z², 0.14 m) instead of a share of view distance. At 15 m the old threshold missed most chair-to-floor edges, which is why furniture dissolved. Flat midtones keep a dither seam of 0.15 (was 0.35). Furniture now has crisp dark silhouettes. At 0 the lawn showed a hard ring: the indoor point lights reach the yard through the walls (no point shadows), and dither had been hiding it. That ring still shows faintly; it is a lighting bug, not a pixel one. Hooks: `pixelFit` in `fx/pixel.ts` (rows, edge, flat), a no-op unless set.
- **I3, the room repainted by class (`&repaint=1`, too bold), pastoral.** A `gouache` model through the S2 twin hook (`interior/repaint.ts`). Every classified interior surface's colour (material × vertex colour × map mean) is pulled 60% to the nearest of 16 gouache colours in OKLab, per fragment, so vertex-coloured merged props unify too. A picture map is kept as its ratio to its mean (magnets, drawings and books stay); grain maps soften to a wash (ratio^0.35). A world-space triplanar brush (from the gouache wall painter) is scaled by class: long strokes on wood, dabs on fabric, faint on enamel. Metal becomes enamel; nothing is glossy. The theme's world (`themeOwned`) is skipped. The first build repainted the meadow beige and pulled the lounge floor to dusty rose: a palette needs no pink near a floor's beige, and the world must be excluded by ancestor. Result: one palette for the whole room, a sky-blue enamel fridge, and the iso reads painted. Rough edges: the brush tiles visibly as brick-like bands on the lounge's right wall; the notebook's faint writing is lost (not a picture by variance); and the seat p95 is over budget (below).

**Shared engine fix: no more shadow wedges on the lawn** (`interior/sun.ts`, on whenever a world stands outside the seat, `&sunfit=0` to compare). The sun's shadow box is fitted to the house's bounds plus 2.2 m in light space (was 18 m square), and every world mesh that receives shadows fades them out between 0.3 and 1.8 m from the walls (`receivedShadowNode`). The long evening house shadow and its cut-off edges are gone in 16-bit and pastoral iso; interior shadows get more texels. The seat's box and no-theme are unchanged.

Frame cost, `npm run measure -- '<url>' --perf --gpu`, `?q=high`, DPR 2, GPU ms p50 / p95, one run each (gate: 13 / 16):

| | seat | iso |
| --- | --- | --- |
| I1 neon night | 10.1 / 12.6 | 8.7 / 10.5 |
| I1 blue hour | 6.8 / 7.6 | 6.7 / 8.4 |
| I2 16-bit | 7.0 / 8.7 | 8.4 / 15.1 |
| I3 pastoral | 10.1 / **18.5** | 10.4 / 12.3 |

All ran at 59.9 fps. I3's seat p95 fails the gate in this single run. Its cost is the per-fragment palette search (16 colours) plus three brush taps on every interior surface; pulling on the CPU for materials without vertex colours would remove most of it. I2's iso p95 is close to the line.

## Regroup 3 results: interiors (GPT-6.1 Sol / Opus, overall)

| Strategy, look | Off (mean) | On (mean) | Decision |
| --- | --- | --- | --- |
| I1 pools, neon night | 6.5 / 5 (5.75) | 7.5 / 6.5 (**7.0**) | adopted, +1.25 |
| I1 pools, blue hour | 7.5 / 6.5 (7.0) | 7.7 / 6.5 (7.1) | adopted, with fixes |
| I2 isofit, 16-bit | 6.2 / 6 (6.1) | 7.0 / 6.5 (**6.75**) | adopted, +0.65 |
| I3 repaint, pastoral | 7.3 / 7 (7.15) | 7.0 / 5.5 (6.25) | not adopted, -0.9 |

What moved, and why:
- **A motivated warm refuge is what a night look needs.** Neon's amber pool at the table, against a violet city with magenta kept to a rim, turned "nightclub" into "refuge". It was the largest single interior gain. On a look that is already warm (blue hour), a broad pool only washes the dusk peach.
- **Pools must be light on surfaces, not volume.** A haze slab over the fridge base hid it in both I1 seat shots. Light should fall off from its fixture, tight around each source (the sofa is still underlit).
- **Readability at home-screen scale is a sizing problem before it is a style problem.** Sizing pixel art to the house on screen, with silhouettes from depth jumps, made iso furniture read. The remaining asks: selective outlines (not every seam), every object outlined the same way (shelves, fridge), and the light quantised into 3-4 bands.
- **One texture language for every material reads as wallpaper, not paint.** I3's shared brush tiling turned walls into concrete or brick and lost the pictures. A repaint has to give each material its own brush direction and keep small props' own colours. Unity of palette, yes; unity of texture, no.
- Three regroups in, every look's mean is 6.75 to 7.5. The next gains are polish on the adopted winners, not another strategy change.

## Comic C1 polish

Fixes for the six requests both reviewers made of C1. Scorer: a fresh `claude -p --model opus` each round, given seat, iso and `?villager=b` at `?q=high`, the `regroup2/comic-c1-*` shots as reference, and the rubric with no target. Candidate / reference, overall:

| Round | Candidate | Reference | What changed before it |
| --- | --- | --- | --- |
| 1 | 6.5 | 6.0 | Lamp pools from the real point lights; walls flat in the ambient; shadow step moved below the walls; quiet exterior inks; line weight hierarchy; board seams in ink. |
| 2 | **7.0** | 6.5 | Dot size follows the shading (none where light reaches, larger towards shadow) on a coarser screen; stronger pool; no bloom under print; the window card's street one step bolder. |

Round 2 per category (candidate / reference): printed page 7 / 7, warm home 8 / 6.5, lighting and depth 6.5 / 6, material honesty 7 / 6.5, restraint and legibility 7.5 / 6, seat and iso consistency 7 / 6.5. Stopped after two rounds on the time box, not on a plateau. One scorer only: GPT-6.1 Sol has not seen it.

What moved the score:
- **Pools come from the lights, not the screen.** `fx/print.ts` reads every visible point light each frame (position, colour, intensity, range, decay), rebuilds each pixel's view position from depth and its normal from the ink stage's attachment, and works out the light each lamp lays there as three's punctual lights do. A core and a rim, both hard-edged, print as a lighter flat in the lamp's hue with no dots. Each lamp counts at up to unit intensity: with raw intensity the lounge glow (2.6, 5.5 m range) swallowed half the living room and dwarfed the pendant.
- **Walls in light print flat.** The old shadow step (-1.9 stops) sat on the walls' own ambient (-1.5 to -2), so half of every wall printed shadow dots. At -2.3 only shadow sides, cast and contact shadows take dense dots, merging to near solid below -3.
- **Uniform dots read as wallpaper.** Round 1 gave walls one faint fixed-size screen; the scorer called it a texture, not a tone. Dot radius now grows with the shading and with distance from the lamps, floors in full and walls at about half.
- **Line weight.** The ink stage's optional `crease` width draws folds at 1.4 px while contours stay at 2.4 px, doubling where a depth jump is large (a second ring of taps at twice the width with a higher threshold).
- **Board seams.** The toon twin finds maps painted as evenly spaced boards (dark seam rows down the image, four to sixteen of them) and draws their seams as a line about a pixel wide at any distance, from the map's own UV transform. The first pass drew lines 2 to 4 px wide at 50 % and read as stripes; 1 px at 70 % reads as boards. The detection must demand even spacing, or the comic street's kerbs and dashes print as boards too.
- **A quiet world, a punchy window.** The iso houses use the room's quiet inks (tan, sage, grey, pale pink, oak) with pale panes the house colour multiplies. With the window card on the same quiet palette, round 1 lost the "printed page punch" through the window, so the card's fronts are one step bolder in the same hue families.

Frame cost, `npm run measure -- '<url>' --perf --gpu`, DPR 2, GPU ms p50 / p95: seat high 6.6 / 7.6, iso high 6.2 / 8.0, seat low 2.5 / 3.9.

Still capping it (round 2):
- **Felt villagers shade smoothly.** They keep their own costume, so they get no toon twin, and their felt map's variation snaps to several inks. They need the toon model with a flat felt fill, or a print rule for small curved things.
- **The lounge glow's pool on the back wall** reads as a soft blob from above. Its core edge is hard, but the falloff across the wall looks airbrushed.
- **The pendant's pool in the seat** covers the table and chairs but not the back wall, which is more than 2 m away, so the lamp still seems to light little.
- **Dot scales differ:** the ambient screen, the shadow dots and the braided rug's stripes beat against each other.
- **Iso:** the tan and oak neighbours are close in value to the ground, so the house stands out less.
- **The living-room floor got no board seams** (its map isn't detected as boards). Not yet looked into.

## Interiors polish (I1 pools, I2 isofit): council fixes

Shots: `council2/<neon-night|blue-hour|sixteen-bit>-<seat|iso>.jpg`, `?q=high`, DPR 1, wait 10 s.

- **Haze slab: the table's painted pool hung in the air.** It was centred on the pendant and 1.2 m wide in x, so past the table's end it was a lit disc floating at 0.77 m. From the seat that disc covered the fridge's lower door. The table pool is gone; the pendant's real light lights the table. The other pools lie on the floor only, centred under the pendant and each fixture.
- **Fixture lights.** Three point lights stand at the house's fixtures (under the kitchen cabinets, the lounge's floor lamp behind the sofa, the reading lamp by the armchair), decay 2 and 2.2 to 3 m reach. The sofa and the armchair are now lit by the lamps beside them. Blue hour keeps the dusk blue: pools at half strength, the pendant's reach 3 m (was 4.4).
- **Switch cost.** The lamps stand for as long as the theme plugin is loaded (dark where a look leaves them out), so the light list never changes on a switch. A light's id is in every lit material's cache key, so a new light recompiles the whole house in one frame. Painted pools are hidden in looks without them: additive blending reaches every target of the scene pass, so even a black pool would add its normal to the floor's. Golden hour to Neon night, `check-themes`, plugin already loaded: worst frame **69.9 ms (was 8034 ms)**. On a fresh Golden-hour page the theme plugin only loads on the first switch (`main.ts`), so its lamps join the light list then and the live chain rebuilds once: about 190 ms warm, and check-themes' first blend (home to blue hour) still fails its 100 ms gate. Fixing that needs the theme plugin loaded with the page, or an async rebuild of the live chain (`main.ts` or `postfx.ts`). `check-themes` overall: 56/61. Besides that blend (5000 ms), four rebuilds went over 100 ms: blue hour to neon 1222, neon to 16-bit 397, 16-bit to comic 7326, comic to home 188. Run by run with the plugin loaded, the same pairs took 50 to 75 ms warm, and six other headless Chrome processes shared the GPU during this run. So contention or cold shader compiles are likely, but there is no c883536 baseline for the same run. Rerun on a quiet machine before merging.
- **Indoor lights stay indoors** (`interior/outdoors.ts`). A theme world's lit materials get their own light list: the sun, the sky fill, the rim, and the world's own lights. The ring on the 16-bit lot is gone. This applies to every world, comic's too.
- **16-bit light banding.** The pixel stage writes each surface's own colour (`diffuseColor`) and rounds the light ratio to 0.6-stop steps, leaving out dark surfaces, glows over 4 times their surface and the sky. The lounge's smooth blotch is now concentric bands.
- **16-bit selective outlines.** A silhouette (iso: depth jump 0.1 to 0.22 m; seat: relative 0.06 to 0.14) is drawn at full strength, and a small step between an object's own parts at 0.3. Shelves and the fridge now have edges.

| Round (Opus, fresh, regroup3 as reference) | Neon night | Blue hour | 16-bit |
| --- | --- | --- | --- |
| Regroup 3 council (mean) | 7.0 | 7.1 | 6.75 |
| 1 | 6 | 6 | 7 |

Round 1 scored each category: neon 7/6/6/5/7/6, blue hour 6/7/5/7/8/5, 16-bit 7/8/6/6/6/7 (style, warm, lighting, material, restraint, consistency). One round only, stopped on the time box. The scorer called 16-bit clearly better and neon better (haze gone). It called blue hour about the same: the seat is cleaner, but the iso lost its warm pools. The score is not comparable with the council mean, which came from two models.

Open, from round 1:
- Neon seat: the pendant's pool on the table is weaker than with the old decal. The magenta floor spill at the bottom right pulls the eye. The iso floor reads as wet asphalt.
- Blue hour iso: too even. The pools need about 1.5 times their strength there.
- 16-bit: the lounge glow banded into a hard, spotlight-like disc on the right wall. Dim the lounge glow in 16-bit, or band in finer steps near the top. Outlines are still missing on wall items and the table's edge.

Frame cost, `npm run measure -- '<url>' --perf --gpu`, DPR 2, GPU ms p50 / p95 (gate: 13 / 16), all at 59.9 fps:

| | seat high | iso high | seat low |
| --- | --- | --- | --- |
| Neon night | 9.1 / 10.2 | 10.0 / 11.3 | 2.7 / 7.0 |
| Blue hour | 8.6 / 10.9 | 6.0 / 7.9 | 2.6 / 4.4 |
| 16-bit | 7.0 / 10.1 | 7.4 / 9.8 | 3.6 / 4.9 |

## Blue hour and neon polish

Fixes both council models asked for. Shots: `council2/<blue-hour|neon-night>-<seat|iso>.jpg` (replaced), `?q=high`, DPR 1, wait 10 s. Scorer: a fresh `claude -p --model opus` each round, given seat and iso of both looks, the previous `council2/` shots as reference, and the rubric with no target.

- **Blue hour iso showed apartment blocks because of a UV scale bug.** `cellBox` maps one whole texture repeat to `cell` metres. The fronts' texture holds 4 by 4 windows, so `cell: [1.8, 1.5]` put 4 bays and 4 storeys into 1.8 by 1.5 m. Each repeat is now 4 bays of 1.5 m and 4 storeys of 1.05 m, aligned to each house's corner and the lawn. The houses are two storeys (2.05 m) under a gable that faces the street, as on the seat card, with a rise of 0.3 to 0.36 of the width.
- **Seat card.** The far tree line now runs down to the houses' feet, so no sky shows in a sliver below them. A haze band softens the line into the sky. The streetlamp's pool is an ellipse clipped at the houses' feet; before, a rectangle cut a lit box into the walls. The card's houses are lower (their tops at about 0.43 of the card), so the window keeps a band of dusk sky that fades to peach. The tree is many small leaf dabs in three close values, with a dusk-lit edge, and stands at the band's left edge. A first pass (before scoring) used large, pale dabs that read as bubbles.
- **Iso trees.** Each tree has five offset clumps instead of three smooth balls. Each clump has a lump that follows the vertex direction, so faces stay closed. Each vertex is painted from five leaf values by height and lump, with the ball's own normals for soft shading.
- **Blue hour lawn and fill.** The lawn moved from saturated teal (round 1: "looks like water") to a muted blue-green, with three grain scales. The sky fill is cooler and lower (gain 0.8 to 0.64).
- **Neon floor and the magenta spill are one lever.** SSR is gated by metalness (`SSRNode` discards non-metals by default, and `postfx.ts` keeps the default). With the floor at metalness 0.45 and roughness 0.42, it reflected like asphalt, and the magenta rim laid a specular streak by the counter. The floor is now dark stained boards: metalness 0, roughness 0.78, a lighter tint (0.45). The road (metalness 0.35) and the pavements (0.2) carry the wet look instead.
- **Neon trim.** Glow 0.12 to 0.04, a duller teal and roughness 0.85. The wall caps and the sill read as dark trim, not as a selection outline.
- **Neon round 2.** The moonlight key went from 0.03 to 0.1, now that the floor no longer glares. Shopfronts show shelves of goods, a ceiling strip and a figure at the till. Each is tinted warm or cool by where it stands, not by `r`, so the city's layout is unchanged.

| Round | Blue hour (candidate / ref) | Neon night (candidate / ref) | Changed before it |
| --- | --- | --- | --- |
| 1 | 6.5 / 6 | 6.5 / 6 | Houses, card seam and tree, iso trees; neon floor, trim, wet road |
| 2 | **7.5** / 6.5 | **7** / 6 | Card sky band and smaller dabs, lawn, cooler fill; key 0.1, shopfronts, wet pavement |

Round 2 by category, candidate / reference (style, warm, lighting, material, restraint, consistency):
- Blue hour: 7.5/6.5, 8/8, 7/6.5, 6.5/6.5, 7/7, 8/6.
- Neon: 7/7, 7.5/6.5, 7/6, 6/5.5, 7.5/5.5, 6.5/6.

Stopped at the two-round cap. One scorer only; GPT-6.1 Sol has not seen this.

Still open (round 2):
- **Blue hour iso:** the house stands on bare lawn, with no path, driveway or hedge.
- **Blue hour seat:** the back wall is still an even lavender, with no warm-to-cool falloff from the pendant. The shade's inside reads lime. Dust specks read as indoor snow.
- **Stray lines, both looks:** a white diagonal by the iso window and a line at the seat's left edge. They belong to the house, not the world.
- **Neon seat:** the neon stops at the glass. The room wants a faint magenta and cyan patch from the window on the table edge and the chair backs.
- **Neon iso:**
  - The tower windows read as LED noise at house scale. They want a grid 3 to 4 times larger.
  - The living room's back wall is the brightest surface. The cool lounge glow is in `pools.ts`, left alone as asked.
  - The road still reads mostly dry from above.

Frame cost, `npm run measure -- '<url>' --perf --gpu`, DPR 2, GPU ms p50 / p95 (gate: 13 / 16), all at 59.9 fps. About eight other headless Chrome processes shared the GPU.

| | seat high | iso high |
| --- | --- | --- |
| Blue hour | 9.0 / 11.1 | 7.8 / 10.1 |
| Neon night | 9.3 / 11.0 | 9.9 / 10.7 |

## Council 3: final, after three regroups and polish (GPT-6.1 Sol / Opus)

| Look | Before regroup 1 (mean) | Council 3 GPT | Opus | Mean |
| --- | --- | --- | --- | --- |
| Golden hour (home) | n/a | 7.8 | 7 | 7.4 |
| Blue hour | 7 (GPT only) | 8.0 | 7.5 | **7.75** |
| Pastoral | 6.5 | 7.4 | 7.5 | 7.45 |
| Neon night | 6.25 | 7.7 | 7 | 7.35 |
| 16-bit | 6 | 7.2 | 7 | 7.1 |
| Comic | 6 | 7.0 | 7 | 7.0 |

Every look gained about a point. The themed looks now score at or above the untouched home. None reaches 9.

**The ceiling, stated plainly.** Three regroups moved the looks from 6 to 7 to about 7.5. The remaining asks are no longer about a strategy. They are about authored detail that a token, a stage or a procedural world can't author:
- Furniture painted in the style. Pastoral wants brush-stroke albedo on the table and chairs. Comic wants interiors with a deliberate light shape. 16-bit wants hand-placed pixel clusters, not fragments.
- A lighting hierarchy designed per room and per look: neon light reaching into the room, and pools with authored falloff.
- An iso composition with a focal hierarchy: the home, not the skyline, owns attention; grounded edges; no stray cord.

What it would take to reach 9:
- Per-look, artist-quality restyled assets for the props, made through the prop sandbox as restyles that keep detail (the S3 lesson). That needs a stronger restyle path than "make a new prop".
- A baked or authored light layout per look.
- An iso composition pass shared with the house thread.

These are a different kind of work: an asset pipeline plus art direction, not engine range.

**Shared house defect.** In every iso view, including the home's, a thin diagonal line runs from above the back wall to the dining pendant: the lamp cord drawn to a ceiling the dollhouse view removes. It belongs to the house (#42), not the themes.

## Lessons that generalise (copied into ui-craft)
- **Find the ceiling's owner before tuning.** The world (exterior) and the room (interior) were two separate ceilings. Fixing one revealed the other: the score moved from "outside is wrong" to "inside looks like the baseline".
- **Partial restyling reads as stickers.** Five of twenty objects remade looked worse than none. Change the whole set in one language, or restyle each object keeping its details.
- **A night or dusk look needs one warm, motivated refuge.** This was the largest interior gain (+1.25 on neon).
- **The view must agree with the world.** A window that shows a different place costs consistency points in both views.
- **Fix the scale bug before blaming the style.** "Apartment towers" were a texture repeat, "wet asphalt indoors" was a metalness value, and "furniture dissolves in iso" was a pixel size sized for another camera.
- **One scorer moves about 1 point between sessions.** Decide on the mean of two models, and keep the reference shots in the same capture session.
