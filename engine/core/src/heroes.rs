//! Landmarks as programs (#423). What the map holds of a famous building is an outline and a height: Salesforce
//! Tower comes out a straight slab. A landmark here is a rule instead, written from its real dimensions and from
//! photographs: asked what the cell at a place in its own frame is, at any size of cell, it says. One rule serves
//! two readers. The Bay's sectors (bay.rs) ask it for the world's own cells where those are fine enough to show it
//! (`WORLD_MOST`), so it can be stood under, walked into and broken. The page asks it for blocks of coarser cells
//! (`faces`) which it draws as a far model of its own (page/heroes.ts), finer than the far boxes of the world are:
//! from 3 km the world's cells are 12.8 m, and a tower's taper is three steps.
//!
//! A landmark's frame: metres; `u` along it, `y` up from its foot, `w` across it (u, y, w right-handed). Where it
//! stands and how it is turned is the tile maker's to say (engine/bay/heroes.json), in a pack's list of landmarks.
//!
//! A rule must say how it meets cells coarser than its detail: a member thinner than a cell is still there where
//! the cell holds its middle line (a cable must not come and go), a pattern finer than a cell becomes its shade.

use crate::hash::hash3;
use crate::kinds::*;
use crate::tree::Kind;
use std::cell::RefCell;

pub const SALESFORCE: u32 = 1;
pub const GOLDEN_GATE: u32 = 2;
pub const TRANSAMERICA: u32 = 3;
pub const BAY_BRIDGE: u32 = 4;
pub const FERRY_BUILDING: u32 = 5;
pub const SUTRO_TOWER: u32 = 7;
pub const CITY_HALL: u32 = 8;
pub const FINE_ARTS: u32 = 9;
pub const FORT_POINT: u32 = 10;
pub const ACADEMY_SCIENCES: u32 = 11;
pub const JAPANESE_TEA_GARDEN: u32 = 12;
pub const BOTANICAL_GARDEN: u32 = 13;
pub const CONSERVATORY: u32 = 14;
pub const PAINTED_LADIES: u32 = 15;
pub const DE_YOUNG: u32 = 16;

/// The coarsest cells of the world a landmark is made in, in cells of 10 cm: 0.8 m, which are the far model's
/// finest, so that where the two meet they are cells of one size. (At 1.6 m the pyramid from 880 m was half the
/// world's coarse cells and half the model's fine ones, and looked two buildings.) Coarser sectors leave it out,
/// and the page draws its far model there instead (heroes.ts hands over where the box of such cells ends).
pub const WORLD_MOST: i32 = 8;
/// In the SF realm (#450) a landmark is also the world's cells in the box of 1.6 m (to 820 m from the eye), so that
/// it is cells as far as the far model's reach (500 m) and faces past it: no stretch where it is neither.
pub const REALM_MOST: i32 = 16;

/// The box a landmark keeps within, in its own metres: the low corner (u, y, w), then the high. None: no such landmark.
pub fn reach(sort: u32) -> Option<[f32; 6]> {
    match sort {
        SALESFORCE => Some([-34.0, 0.0, -34.0, 34.0, 327.0, 34.0]),
        GOLDEN_GATE => Some([GG_SOUTH - 10.0, -30.0, -100.0, GG_NORTH + 1.0, GG_TOP + 1.0, 54.0]),
        TRANSAMERICA => Some([-29.0, 0.0, -29.0, 29.0, TA_TOP + 1.0, 29.0]),
        BAY_BRIDGE => Some([BB_WEST - 16.0, -30.0, -30.0, BB_EAST + 16.0, 162.0, 30.0]),
        FERRY_BUILDING => Some([-104.0, 0.0, -29.0, 103.0, FB_TOP + 1.0, 33.0]),
        SUTRO_TOWER => Some([-40.0, 0.0, -40.0, 40.0, ST_TOP + 1.0, 40.0]),
        CITY_HALL => Some([-CH_LONG - 2.0, -2.0, -CH_WIDE - 8.0, CH_LONG + 2.0, CH_TOP + 1.0, CH_WIDE + 8.0]),
        FINE_ARTS => Some([-38.0, -2.0, -114.0, 54.0, PF_TOP + 2.0, 109.0]),
        FORT_POINT => Some([-54.0, -5.0, -34.0, 54.0, 25.0, 34.0]),
        ACADEMY_SCIENCES => Some([-81.0, -7.0, -66.5, 81.0, 24.0, 36.5]),
        JAPANESE_TEA_GARDEN => Some([-66.0, -10.0, -66.0, 66.0, 26.0, 66.0]),
        BOTANICAL_GARDEN => Some([-80.0, -10.0, -60.0, 80.0, 26.0, 60.0]),
        CONSERVATORY => Some([-50.0, -10.0, -22.0, 61.0, 24.0, 96.0]),
        PAINTED_LADIES => Some([-28.5, -5.0, -11.5, 27.0, 21.0, 13.0]),
        DE_YOUNG => Some([-80.0, -8.0, -40.0, 78.0, 47.0, 44.0]),
        _ => None,
    }
}

/// Whether a rule is all there is at a place in its box (its air is air: the lidar's columns under it, which cannot
/// say an arch or a lattice, are not), or only adds to what the map has there (a bridge over the water).
pub fn owns(sort: u32, u: f32, y: f32, w: f32) -> bool {
    match sort {
        SALESFORCE | TRANSAMERICA | SUTRO_TOWER | FORT_POINT
        | PAINTED_LADIES | DE_YOUNG => true,
        // Include the 1.5 m of trim that a generic tile facade may project outside its outline.
        FERRY_BUILDING => ferry_depth(u, w) >= -1.5,
        CITY_HALL => city_hall_footprint(u, w),
        ACADEMY_SCIENCES => academy_canopy(u, w),
        // Suspension spans over land or shore carry lidar cable/deck returns that otherwise extrude to ground as solid
        // curtains; below 22 m under the arch, Fort Point stays. Also claim the south anchorage block (eliminating the
        // embedded DataSF building at u=-1149 m), the south tower pier fender ring (eliminating the lidar spike beside
        // the pier), and the measured width of the northern approach deck (#60).
        GOLDEN_GATE => {
            ((-1095.0..=1095.0).contains(&u) && w.abs() <= 30.0 && (y <= 0.0 || y >= 22.0))
                || ((u + GG_TOWER).abs() <= 42.0 && w.abs() <= 52.0 && y >= 0.0)
                || ((-1265.0..-1090.0).contains(&u) && w.abs() <= 34.0 && y >= 0.0)
                || ((1050.0..GG_NORTH).contains(&u) && gg_offset(u, w).abs() <= 17.0 && y >= 0.0)
        }
        BAY_BRIDGE => (BB_WEST..=BB_EAST).contains(&u) && w.abs() <= 26.0 && (y <= 0.0 || y >= 24.0),
        FINE_ARTS => pf_owns(u, w),
        // Inside the mapped fence, less the mapped buildings each leaves to the map (heroes.rs `TEA_KEPT`, `BOTANICAL_KEPT`).
        JAPANESE_TEA_GARDEN => tea_garden_place(u, w),
        BOTANICAL_GARDEN => botanical_place(u, w),
        CONSERVATORY => conservatory_public(u, w),
        _ => false,
    }
}

/// Optional ground-surface override at `(u, w)` where a landmark turns dry/concrete tile cells into reflective ponds,
/// lagoons, raked Zen gravel, garden walkways, or Conservatory Valley's floral carpet parterres (#60).
pub fn surface_at(sort: u32, u: f32, w: f32, _ground_m: f32, s: f32) -> Option<Kind> {
    match sort {
        FINE_ARTS => fine_arts_surface(u, w),
        JAPANESE_TEA_GARDEN => tea_garden_surface(u, w, s),
        BOTANICAL_GARDEN => botanical_surface(u, w, s),
        CONSERVATORY => conservatory_surface(u, w, s),
        _ => None,
    }
}

/// World-aware landmark cell query receiving both `up` (metres above `h.foot`) and `over_g` (metres above local
/// ground `c.g`), allowing gardens and sloped valley parterres to hug hills while buildings stay level (#60).
pub fn kind_at_world(sort: u32, u: f32, up: f32, over_g: f32, w: f32, s: f32) -> Kind {
    match sort {
        GOLDEN_GATE if u > GG_ANCHOR_N && up - over_g >= gg_road(u) => 0,
        JAPANESE_TEA_GARDEN => japanese_tea_garden(u, over_g, w, s),
        BOTANICAL_GARDEN => botanical_garden(u, over_g, w, s),
        CONSERVATORY if w > 33.0 && over_g > 0.0 => {
            valley_planting(u, over_g, w, s).unwrap_or_else(|| conservatory(u, up, w, s))
        }
        _ => kind_at(sort, u, up, w, s),
    }
}

/// World-aware ownership check (terrain-following gardens clear raw lidar clutter above local ground `over_g`).
pub fn owns_world(sort: u32, u: f32, up: f32, over_g: f32, w: f32) -> bool {
    match sort {
        JAPANESE_TEA_GARDEN | BOTANICAL_GARDEN => over_g >= 0.0 && owns(sort, u, over_g, w),
        ACADEMY_SCIENCES | DE_YOUNG | PAINTED_LADIES | FORT_POINT | CONSERVATORY => over_g >= 0.0 && owns(sort, u, up, w),
        _ => up >= 0.0 && owns(sort, u, up, w),
    }
}

/// The kind of the cell `s` metres a side whose middle is at (u, y, w) in the landmark's frame. 0: air.
pub fn kind_at(sort: u32, u: f32, y: f32, w: f32, s: f32) -> Kind {
    match sort {
        SALESFORCE => salesforce(u, y, w, s),
        GOLDEN_GATE => golden_gate(u, y, w, s),
        TRANSAMERICA => transamerica(u, y, w, s),
        BAY_BRIDGE => bay_bridge(u, y, w, s),
        FERRY_BUILDING => ferry_building(u, y, w, s),
        SUTRO_TOWER => sutro_tower(u, y, w, s),
        CITY_HALL => city_hall(u, y, w, s),
        FINE_ARTS => fine_arts(u, y, w, s),
        FORT_POINT => fort_point(u, y, w, s),
        ACADEMY_SCIENCES => academy_sciences(u, y, w, s),
        JAPANESE_TEA_GARDEN => japanese_tea_garden(u, y, w, s),
        BOTANICAL_GARDEN => botanical_garden(u, y, w, s),
        CONSERVATORY => conservatory(u, y, w, s),
        PAINTED_LADIES => painted_ladies(u, y, w, s),
        DE_YOUNG => de_young(u, y, w, s),
        _ => 0,
    }
}

/// Which way a landmark's wall truly looks at a place on it, level, in its own frame (u, w): where its cells step
/// round a curve, the far model is lit by this and not by each step's own face. None: as the face looks.
pub fn looks(sort: u32, u: f32, y: f32, w: f32) -> Option<[f32; 2]> {
    match sort {
        SALESFORCE => {
            let a = SF_HALF * between(&SF_TAPER, y);
            let (qu, qw) = (u.abs() - a * (1.0 - SF_ROUND), w.abs() - a * (1.0 - SF_ROUND));
            let (nu, nw) = if qu > 0.0 && qw > 0.0 { (qu, qw) } else if qu > qw { (1.0, 0.0) } else { (0.0, 1.0) };
            let long = (nu * nu + nw * nw).sqrt();
            Some([nu / long * u.signum(), nw / long * w.signum()])
        }
        _ => None,
    }
}

/// A landmark's own light by night (#450): the part of it that a city knows it by in the dark, as numbers the page
/// hands to whatever draws it, cells or faces (march.ts `landmarkLight`), so that it is lit one way near and far and
/// needs no tile baked again. In its own metres, y up from its foot:
///   0, 1   the lit part's foot and top;
///   2, 3   half its width at each (it draws in between them);
///   4 to 7 its light's colour and how strong (1 is a lit wall; over 1.2 the last pass spreads it as a lamp's);
///   8      how far apart the dark rings across it are (0: none);
///   9      how tall the very top's lamp is, the one that is seen as a point from across the city (0: none);
///   10, 11 under the lit part, a storey's height and a bay's width where its glass is lit a floor at a time from
///          within (0: its walls are another's to light, the map's building with its own windows).
/// None: no such landmark. Every landmark answers, so that all are lit by one path: one with no light of its own
/// says 0 for its strength, and still has its glass lit and showing what the city's windows show (far.ts).
pub fn night(sort: u32) -> Option<[f32; 12]> {
    match sort {
        // The crown: nine storeys of lamps behind the open grid, a pale cold white that moves, and the offices under it.
        SALESFORCE => Some([SF_CROWN, SF_TOP, SF_HALF * between(&SF_TAPER, SF_CROWN), SF_HALF * between(&SF_TAPER, SF_TOP), 0.62, 0.8, 1.0, 0.95, SF_FLOOR / 2.0, 0.0, SF_FLOOR, 3.0]),
        // The spire: its louvres lit white from within, and the beacon at its point.
        TRANSAMERICA => Some([TA_SPIRE, TA_TOP, 23.1 * (TA_TOP - TA_SPIRE) / (TA_TOP - TA_SKIRT), 0.0, 1.0, 0.95, 0.86, 0.9, 0.0, 4.0, 0.0, 0.0]),
        // No light of their own, and what glass they have is their windows already: lit a room at a time, as any.
        GOLDEN_GATE | BAY_BRIDGE | FERRY_BUILDING | SUTRO_TOWER | CITY_HALL | FINE_ARTS | FORT_POINT
        | ACADEMY_SCIENCES | JAPANESE_TEA_GARDEN | BOTANICAL_GARDEN | CONSERVATORY | PAINTED_LADIES | DE_YOUNG => Some([0.0; 12]),
        _ => None,
    }
}

/// Between the entries of a table of (at, value), straight from one to the next; the ends hold.
fn between(table: &[(f32, f32)], at: f32) -> f32 {
    let mut last = table[0];
    if at <= last.0 {
        return last.1;
    }
    for &next in &table[1..] {
        if at <= next.0 {
            return last.1 + (next.1 - last.1) * (at - last.0) / (next.0 - last.0);
        }
        last = next;
    }
    last.1
}

/// Whether a line every `every` metres (the first `first` along) is in a cell `s` wide whose middle is at `at`: the
/// line is `wide`, and a cell coarser than that holds it where the cell holds its middle.
fn line(at: f32, every: f32, first: f32, wide: f32, s: f32) -> bool {
    let off = (at - first).rem_euclid(every);
    let off = if off > every / 2.0 { off - every } else { off };
    // (A line that falls on the join of two cells is the lower one's, whichever way the sums round.)
    let half = (wide / 2.0).max(s / 2.0);
    off >= -half - 0.001 * s && off < half - 0.001 * s
}

// ── Salesforce Tower (Pelli Clarke Pelli, 2018): 326 m, 61 floors, a square with round corners that draws in as it
// rises, glass behind white sunshades at every floor, and over the top floor an open crown of the same grid, 46 m
// high, with a screen of lamps inside it.
//
// Its foot is the map's outline (Overture: 53.8 by 54.2 m across the flats, 64 m corner to corner, so the corners
// are rounded at 0.55 of the half width). Above 193 m the outline clears the Potrero Hill skyline (Pi.1415926535,
// February 2020, CC BY-SA 3.0, 0.46 m/pixel). Use both edges: the crown's apparent centre drifts left in that
// photograph. Its widths are also checked from Ina Coolbrith Park in the solved camera and against 3DEP returns.
const SF_TOP: f32 = 326.0;
const SF_CROWN: f32 = 280.0;
const SF_FLOOR: f32 = 4.42;
const SF_HALF: f32 = 26.9;
const SF_ROUND: f32 = 0.55;
const SF_TAPER: [(f32, f32); 19] = [
    (0.0, 1.0), (60.0, 1.0), (120.0, 0.985), (160.0, 0.968), (193.0, 0.944), (215.0, 0.912), (235.0, 0.872), (248.0, 0.835), (260.0, 0.79),
    (271.0, 0.77), (282.0, 0.737), (293.0, 0.69), (304.0, 0.632), (310.0, 0.608), (315.0, 0.578), (320.0, 0.545), (323.0, 0.522), (325.0, 0.50), (326.0, 0.48),
];

fn salesforce(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if y < 0.0 || y >= SF_TOP {
        return 0;
    }
    // Its glass is a deeper blue than a window's: lit by the sun it is the sky's blue and not white.
    let glass = kind(GLASS, colour(14, 2));
    let white = kind(STEEL, WHITE);
    let a = SF_HALF * between(&SF_TAPER, y);
    let r = a * SF_ROUND;
    // How far outside the wall (inside is less than 0), and how far along it: across a flat from its middle, round
    // a corner from where the corner starts.
    let (qu, qw) = (u.abs() - (a - r), w.abs() - (a - r));
    let d = (qu.max(0.0) * qu.max(0.0) + qw.max(0.0) * qw.max(0.0)).sqrt() + qu.max(qw).min(0.0) - r;
    if d > 0.45 {
        return 0;
    }
    let corner = qu > 0.0 && qw > 0.0;
    let along = if corner { r * qw.atan2(qu) } else if qu > qw { w } else { u };
    // The grid: a sunshade at every floor, a fin every 3 m with a glass bay over the flat's middle.
    let shade = line(y, SF_FLOOR, 0.0, 0.5, s);
    let fin = line(along, 3.0, 1.5, 0.2, s) && s <= 0.5;
    // From further the fins are still the grid the tower is known by: a column of paler glass, to cells of a metre.
    let far_fin = s > 0.5 && s <= 1.0 && line(along, 3.0, 1.5, 0.2, s);
    // Two ribs up each flat of the crown, a third of the way in from its corners: they catch the light.
    let rib = !corner && s <= 1.0 && member(along.abs() - a * 0.3, 0.3, s);
    let skin = -(2.5 * s + 0.3);
    if y >= SF_CROWN {
        // The crown. Its skin is the grid alone with the air between; within it a wall that is the screen, and the
        // plant under an open top.
        let ring = line(y, SF_FLOOR / 2.0, 0.0, 0.3, s) || y >= SF_TOP - 0.6f32.max(s);
        if d > 0.0 {
            return if s <= 0.45 && d <= 0.3 && (ring || line(along, 1.5, 0.75, 0.2, s)) { white } else { 0 };
        }
        if d > -0.6f32.max(s) {
            // In cells of half a metre or more the grid is too fine to be open (it came out a skin with holes at
            // random): a pale skin, its rings paler still until they too are finer than a cell.
            return if s > 0.45 { if rib || ring && s <= 2.4 { kind(STEEL, grey(1)) } else { kind(GLASS, colour(14, 7)) } } else if rib || ring || line(along, 1.5, 0.75, 0.2, s) { white } else { 0 };
        }
        if y < SF_CROWN + 0.6f32.max(s) {
            return kind(ROOFING, grey(9));
        }
        if d <= -3.0 && d > -3.0 - 0.6f32.max(s) {
            return kind(PLASTER, grey(4));
        }
        // The plant: a block in the middle, lower than the crown.
        return if d < -9.0 && y < 306.0 * between(&SF_TAPER, y).max(0.9) { kind(CONCRETE, grey(6)) } else { 0 };
    }
    if d > 0.0 {
        // What stands proud of the glass: the sunshades, and the fins less far. Coarser than half a metre they are flush.
        return if s <= 0.45 && y >= 3.0 * SF_FLOOR && (shade || fin && d <= 0.2) { white } else { 0 };
    }
    if d <= skin {
        return kind(CONCRETE, grey(8));
    }
    if y < 3.0 * SF_FLOOR - 0.25 {
        // The lobby: three floors of glass between columns, under the first sunshade.
        return if line(along, 9.0, 4.5, 1.2, s) && s <= 1.0 { kind(STEEL, grey(3)) } else { kind(GLASS, colour(14, 8)) };
    }
    if shade {
        // A sunshade's row. Where a cell is a third of a floor or more the row is part glass: paler glass, not white.
        return if s <= 1.0 { white } else if s <= 2.4 { kind(GLASS, colour(14, 0)) } else { glass };
    }
    if fin { white } else if far_fin { kind(GLASS, colour(14, 0)) } else { glass }
}


// ── The Ferry Building (A. Page Brown, 1898). u runs southeast along the quay, w towards Market Street.
// DataSF footprint 201006.0000058 in square 552.7_4182.5 gives two nearly rectangular wings and a forward entrance.
// Overture Maps 2026-10-21.0 (© OpenStreetMap contributors, Overture Maps Foundation) gives the seven tower stages
// on a 12 m square. The operator's front elevation shows the arcade, four dials and belfry (source in sf/heroes.json).
const FB_NORTH: f32 = -101.8;
const FB_SOUTH: f32 = 100.7;
const FB_BACK: f32 = -27.0;
const FB_FRONT: f32 = 21.8;
const FB_PORTICO: f32 = 30.7;

fn ferry_depth(u: f32, w: f32) -> f32 {
    let hall = (u - FB_NORTH).min(FB_SOUTH - u).min(w - FB_BACK).min(FB_FRONT - w);
    let portico = (u + 23.0).min(22.0 - u).min(w).min(FB_PORTICO - w);
    hall.max(portico)
}

const FB_TOWER_W: f32 = 17.5;
const FB_TOP: f32 = 70.0;
/// The tower's stages: up to this height, half its side.
const FB_STAGES: [(f32, f32); 7] = [(43.5, 6.0), (50.5, 5.4), (54.2, 4.4), (60.5, 3.0), (64.5, 2.5), (68.2, 1.8), (70.0, 1.0)];

fn ferry_building(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if y < 0.0 || y >= FB_TOP {
        return 0;
    }
    let stone = kind(PLASTER, colour(2, 7));
    let trim = kind(PLASTER, WHITE);
    let dark = kind(GLASS, colour(14, 9));
    let roof = kind(ROOFING, grey(10));
    // The tower first: it stands out of the front, through the roof.
    let (tu, tw) = (u.abs(), (w - FB_TOWER_W).abs());
    if let Some(&(_, half)) = FB_STAGES.iter().find(|&&(top, _)| y < top) {
        if tu <= half.max(s * 0.5) && tw <= half.max(s * 0.5) {
            let face = (half - tu).min(half - tw);
            let along = if half - tu < half - tw { w - FB_TOWER_W } else { u };
            // The clock: a pale face on each side between 36 and 42 m, ringed dark.
            if (35.0..42.5).contains(&y) && face < 0.6f32.max(s) {
                let r = (along * along + (y - 39.0) * (y - 39.0)).sqrt();
                if r < 3.0 {
                    // Screen-right follows the outside of each dial. The long
                    // hand points to twelve, the short hand to two (14:00).
                    let right = if tu > tw { -along * u.signum() } else { along * (w - FB_TOWER_W).signum() };
                    let dy = y - 39.0;
                    // A rotated wall can skip a thin vertical mark between voxel columns.
                    let width = 0.26f32.max(s);
                    let minute = right.abs() <= width && (-0.2..=2.15).contains(&dy);
                    let hour = from_segment([right, dy, 0.0], [0.0; 3], [1.43, 0.83, 0.0]) <= width;
                    return if s <= 0.8 && (r > 2.55 || minute || hour) { kind(STEEL, grey(13)) } else { trim };
                }
            }
            // The belfry over it: three arches a side, open, with the dark of the stair behind.
            if (44.5..50.0).contains(&y) && face < 1.2f32.max(s) && s <= 0.8 {
                let a = (along + 4.5).rem_euclid(3.0);
                if (0.6..2.4).contains(&a) && y < 48.5 + 0.9 * (1.0 - ((a - 1.5) / 0.9).powi(2)).max(0.0).sqrt() {
                    return 0;
                }
            }
            // Cornices where a stage ends; slit windows up the shaft.
            if FB_STAGES.iter().any(|&(top, _)| y >= top - 0.6f32.max(s) && y < top) || y < 1.0 {
                return trim;
            }
            if y < 43.5 && face < 0.4f32.max(s) && s <= 0.4 && line(along, 3.0, 0.0, 0.8, s) && (y - 16.0).rem_euclid(5.0) < 3.2 && y > 16.0 && y < 34.0 {
                return dark;
            }
            return if y > 64.5 { kind(STEEL, colour(3, 2)) } else { stone };
        }
    }
    // The building: two long storeys under a cornice, a roof that pitches gently to a ridge with a skylight down the nave.
    let face = ferry_depth(u, w);
    if face < 0.0 {
        return 0;
    }
    let entrance = (-23.0..=22.0).contains(&u) && w > FB_FRONT;
    if entrance {
        // Three tall arched bays beneath the clock, flanked by smaller
        // openings. Their glazing is recessed behind the street colonnade.
        if y >= 16.0 { return 0; }
        if y > 14.7 { return trim; }
        let a = (u + 0.5 + 4.5).rem_euclid(9.0) - 4.5;
        let outer = (u + 0.5).abs() > 13.5;
        let radius = if outer { 2.2 } else { 3.55 };
        let crown = if outer { 6.0 } else { 9.4 };
        if a.abs() < radius && y > 0.5 && y < crown + (radius * radius - a * a).sqrt() {
            if face < 1.6 { return 0; }
            // The gallery floor and glazing bars are on the recessed plane.
            if !outer && (5.1..5.9).contains(&y) { return trim; }
            if a.abs() < 0.16f32.max(s * 0.55) || (9.1..9.5).contains(&y) {
                return kind(STEEL, grey(8));
            }
            return dark;
        }
        if outer && a.abs() < 1.8 && (8.8..11.6).contains(&y) {
            return if face < 0.6 { 0 } else { dark };
        }
        return stone;
    }
    let ridge = (16.1 - 2.4 * (w.abs() / 27.0)).max(14.4);
    if y >= 14.0 {
        if y >= ridge {
            return 0;
        }
        return if w.abs() < 3.0 && s <= 1.6 { kind(GLASS, colour(14, 6)) } else { roof };
    }
    if face > 1.0f32.max(s) {
        return kind(CONCRETE, grey(9));
    }
    if y >= 12.6 || y < 0.8 {
        return trim;
    }
    let along = if (u - FB_NORTH).min(FB_SOUTH - u) < (w - FB_BACK).min(FB_FRONT - w) { w } else { u };
    if s <= 0.8 {
        if y < 7.0 {
            // The arcade: an arch every 6 m, its opening 4 m wide and 5.6 m to the crown, the glass set back.
            let a = (along + 3.0).rem_euclid(6.0) - 3.0;
            let crown = 4.2 + 1.4 * (1.0 - (a / 2.0).powi(2)).max(0.0).sqrt();
            if a.abs() < 2.0 && y < crown {
                return if face < 0.5 { 0 } else { dark };
            }
        } else if (8.2..12.6).contains(&y) {
            // The upper arcade has a round head over two lower panes.
            let a = (along + 3.0).rem_euclid(6.0) - 3.0;
            let rounded = a * a + (y - 10.6).max(0.0).powi(2) < 1.85 * 1.85;
            if rounded && (a.abs() > 0.21 || y > 10.6) {
                return dark;
            }
        }
    }
    if (6.8..7.6).contains(&y) {
        return trim;
    }
    stone
}

// ── Sutro Tower (1973). Its frame: u towards the east, w towards the south, y up from the hilltop. Overture Maps
// 2026-10-21.0 (© OpenStreetMap contributors, Overture Maps Foundation): 298 m; platforms whose triangles are 40, 30,
// 21, 27 and 59 m across at 55, 115, 168, 198 and 230 m; legs of 3 by 3 m. Three legs that lean in to the waist at 168 m
// and out to the top platform, three masts on it to the top, X-bracing between the legs and banded red and white:
// the bands and the bracing by eye.
const ST_TOP: f32 = 298.0;
/// How far a leg is from the middle at a height (circumradius of the triangle of legs).
const ST_LEGS: [(f32, f32); 4] = [(0.0, 26.0), (168.0, 12.1), (230.0, 34.0), (298.0, 34.0)];
const ST_PLATFORMS: [f32; 6] = [55.0, 115.0, 168.0, 198.0, 230.0, 262.0];

fn st_leg(k: usize, y: f32) -> (f32, f32) {
    let r = between(&ST_LEGS, y);
    let a = std::f32::consts::FRAC_PI_2 + k as f32 * 2.0 * std::f32::consts::PI / 3.0;
    (r * a.cos(), r * a.sin())
}

/// How far a point is from a segment, in three dimensions.
fn from_segment(p: [f32; 3], a: [f32; 3], b: [f32; 3]) -> f32 {
    let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    let t = ((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]).max(1e-6)).clamp(0.0, 1.0);
    let d = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t];
    (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
}

fn sutro_tower(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(0.0..ST_TOP).contains(&y) {
        return 0;
    }
    // Banded: red and white, five bands of red up the tower, the masts' tops white.
    let band = ((y / 26.0) as i32) % 2 == 0;
    let red = kind(STEEL, colour(0, 3));
    let white = kind(STEEL, WHITE);
    let paint = if band { red } else { white };
    let thick = |half: f32| half.max(s * 0.55);
    // The legs, and over the top platform the masts.
    for k in 0..3 {
        let (lu, lw) = st_leg(k, y.min(230.0));
        let half = if y < 230.0 { 1.6 } else { 1.0 - 0.6 * ((y - 230.0) / 68.0) };
        if (u - lu).abs() <= thick(half) && (w - lw).abs() <= thick(half) {
            return if y > 285.0 { white } else { paint };
        }
    }
    // The platforms: a triangle of trusses 3 m deep at each, the top one decked.
    for &py in &ST_PLATFORMS {
        if (y - py).abs() <= thick(1.5) {
            let p = [u, y, w];
            for k in 0..3 {
                let (au, aw) = st_leg(k, py.min(230.0));
                let (bu, bw) = st_leg((k + 1) % 3, py.min(230.0));
                if from_segment(p, [au, py, aw], [bu, py, bw]) <= thick(1.1) {
                    return white;
                }
            }
            if py == 230.0 && s <= 3.2 {
                // Inside the top triangle: a deck.
                let inside = (0..3).all(|k| {
                    let (au, aw) = st_leg(k, 230.0);
                    let (bu, bw) = st_leg((k + 1) % 3, 230.0);
                    (bu - au) * (w - aw) - (bw - aw) * (u - au) >= 0.0
                });
                if inside && (y - py).abs() <= thick(0.6) {
                    return kind(STEEL, grey(6));
                }
            }
        }
    }
    // Bracing: a cross in each face of each bay between platforms, under the top.
    if s <= 3.2 && y < 230.0 {
        let p = [u, y, w];
        let mut lo = 0.0;
        for &hi in ST_PLATFORMS.iter().filter(|&&h| h <= 230.0) {
            if y >= lo && y <= hi {
                for k in 0..3 {
                    let (au, aw) = st_leg(k, lo);
                    let (bu, bw) = st_leg((k + 1) % 3, hi);
                    let (cu, cw) = st_leg((k + 1) % 3, lo);
                    let (du, dw) = st_leg(k, hi);
                    if from_segment(p, [au, lo, aw], [bu, hi, bw]) <= thick(0.6) || from_segment(p, [cu, lo, cw], [du, hi, dw]) <= thick(0.6) {
                        return paint;
                    }
                }
            }
            lo = hi;
        }
    }
    0
}

// ── City Hall (Bakewell & Brown, 1915). u towards the south end, w west, y above its 17.6 m foot.
// DataSF footprint in the hero frame, simplified to 0.65 m. The two porticos extend past the long facades.
// The 0.25 m lidar in 550.7_4180.5 and 550.7_4181.5 locates the roofs, courts and drum in this same frame.
const CH_LONG: f32 = 64.0;
const CH_WIDE: f32 = 49.3;
const CH_TOP: f32 = 93.6;
const CH_OUTLINE: &[(f32, f32)] = &[
    (-59.9, -45.0), (-15.0, -44.8), (-15.0, -46.4), (-12.0, -46.4), (-12.0, -49.0),
    (12.6, -48.9), (12.6, -46.1), (15.9, -46.1), (15.8, -44.6), (60.5, -44.3),
    (60.5, -42.9), (63.8, -41.1), (63.7, -22.6), (62.1, -22.5), (62.1, 20.7),
    (63.6, 20.8), (63.5, 38.8), (62.1, 38.8), (60.1, 40.7), (60.1, 42.2),
    (58.3, 42.2), (58.3, 42.9), (15.4, 41.9), (15.4, 43.5), (12.7, 44.8),
    (12.2, 49.2), (-12.3, 49.1), (-12.3, 46.1), (-14.5, 43.5), (-15.6, 43.5),
    (-15.6, 41.8), (-48.1, 41.6), (-48.1, 42.5), (-58.4, 42.4), (-58.4, 41.5),
    (-60.3, 41.5), (-60.3, 39.2), (-63.7, 37.9), (-63.7, 19.8), (-61.9, 19.7),
    (-61.5, -23.6), (-63.4, -23.8), (-63.2, -41.4), (-60.2, -43.1),
];

fn city_hall_footprint(u: f32, w: f32) -> bool {
    // Most cell queries are well inside the envelope. Only trace the polygon near its edges.
    (u.abs() < 59.0 && (w + 1.5).abs() < 42.0)
        || (u.abs() <= CH_LONG && w.abs() <= CH_WIDE && inside(CH_OUTLINE, u, w))
}

const CH_STONE: Kind = kind(CONCRETE, grey(2));
const CH_TRIM: Kind = kind(PLASTER, grey(1));
const CH_GLASS: Kind = kind(GLASS, colour(15, 9));
const CH_LEAD: Kind = kind(ROOFING, grey(5));
const CH_GOLD: Kind = kind(STEEL, colour(3, 3));

// u and w here are relative to the surveyed dome axis (0.5, -1.5). Below it the square roof of the
// rotunda has a clipped octagonal parapet. Above it sixteen window bays alternate with paired stonework.
fn city_hall_drum(u: f32, y: f32, w: f32, s: f32) -> Kind {
    let side = u.abs().max(w.abs());
    if side > 20.5 || y >= CH_TOP {
        return 0;
    }
    if y < 35.0 {
        if side <= 20.0 && y <= 30.3 {
            return CH_STONE;
        }
        let inset = (20.0 - side).min((28.9 - u.abs() - w.abs()) * std::f32::consts::FRAC_1_SQRT_2);
        return if inset < 0.0 || (y > 33.0 && inset > 1.2 && u * u + w * w > 17.4 * 17.4) { 0 } else { CH_TRIM };
    }
    let r = u.hypot(w);
    let theta = w.atan2(u);
    if y < 55.4 {
        // The pilasters and entablature project past the glazed wall. Each bay faces radially.
        let round = 16.0 * theta;
        let bay = std::f32::consts::TAU; // pitch at 16 m radius, for sixteen bays
        let across_window = ((round + bay * 0.5).rem_euclid(bay) - bay * 0.5).abs();
        let pier = line(round, bay, bay * 0.5, 1.6, s);
        if y < 40.0 {
            return if r > 17.4 { 0 } else if y > 38.5 { CH_TRIM } else { CH_STONE };
        }
        if y < 50.2 {
            let pediment_top = 49.3 - across_window * 0.45;
            let pediment = (47.9..=pediment_top).contains(&y);
            let radius = if pier { 17.5 } else if pediment || y > 49.5 { 16.3 } else { 15.5 };
            if r > radius {
                return 0;
            }
            if pediment || (pier && (y < 41.0 || y > 47.6)) {
                return CH_TRIM;
            }
            let window = across_window < 1.55 && (41.3..47.8).contains(&y);
            return if window && r > 14.7 { CH_GLASS } else { CH_STONE };
        }
        if y < 51.2 && r <= 15.7 {
            return CH_TRIM;
        }
        if pier && (r - 16.2).abs() < 0.6 && y < 54.5 {
            return if y > 53.8 { CH_GOLD } else { CH_TRIM };
        }
        return if r <= 14.4 { CH_STONE } else { 0 };
    }
    if y < 71.6 {
        // Survey sections through the lead roof (height above foot, outer radius).
        let radius = between(&[(55.4, 13.8), (59.0, 13.2), (62.0, 12.35), (65.0, 10.9),
            (67.0, 9.1), (69.0, 6.45), (70.3, 4.85), (71.6, 3.65)], y);
        if r > radius {
            return 0;
        }
        let rib = s <= 1.6 && line(13.5 * theta, 13.5 * std::f32::consts::TAU / 16.0, 0.0, 0.35, s);
        return if rib || y < 56.1 { CH_GOLD } else { CH_LEAD };
    }
    // Lantern sill, open ring of eight shafts, gilded cornice, then the narrowing cupola and spire.
    if y < 74.6 {
        let sill = between(&[(71.6, 3.65), (73.9, 4.0), (74.6, 3.25)], y);
        return if r > sill { 0 } else if y > 73.9 { CH_GOLD } else { CH_LEAD };
    }
    if y < 78.5 {
        let on_shaft = (r - 2.6).abs() <= 0.42f32.max(s * 0.5)
            && line(2.6 * theta, 2.6 * std::f32::consts::TAU / 8.0, 0.0, 0.72, s);
        return if on_shaft { CH_GOLD } else { 0 };
    }
    let radius = between(&[(78.5, 3.45), (79.3, 3.45), (80.6, 2.05), (81.4, 1.5),
        (82.0, 1.75), (84.5, 1.05), (85.1, 1.15), (86.2, 0.7), (89.0, 0.55), (CH_TOP, 0.15)], y);
    if r <= radius.max(s * std::f32::consts::FRAC_1_SQRT_2) { CH_GOLD } else { 0 }
}

fn city_hall(u: f32, y: f32, w: f32, s: f32) -> Kind {
    let a = (u - 0.5).abs();
    let b = (w + 1.5).abs();
    if y >= 30.9 || (y >= 25.0 && a <= 20.0 && b <= 20.0) {
        return city_hall_drum(u - 0.5, y, w + 1.5, s);
    }
    if y < -2.0 || !city_hall_footprint(u, w) {
        return 0;
    }
    // The light courts are 16.5 m wide, inset between the transept and end wings. Each contains
    // a low glazed skylight above the court roof, visible from the dome.
    if a > 20.0 && a < 36.5 && b < 18.5 {
        let ridge = (a - 28.0).abs();
        let rise = ((6.0 - ridge).min(16.0 - b) * 0.55).clamp(0.0, 2.25);
        if y > 10.8 + rise {
            return 0;
        }
        if y > 10.8 && y >= 10.8 + rise - s && !line(w, 3.1, 0.0, 0.25, s) {
            return kind(GLASS, colour(15, 7));
        }
        return CH_STONE;
    }
    // The longitudinal ridge of each entrance roof runs out to its pediment. Its six columns
    // stand free of the portal wall above the landing.
    let wing_edge = 43.3 - b;
    if a < 15.6 {
        let ridge = 30.9 - 0.35 * a.min(13.0);
        if y > ridge {
            return 0;
        }
        let front = 49.0 - w.abs();
        if wing_edge < 0.0 {
            let stair = 1.0 + 0.3 * (front.max(0.0) / 0.35).floor();
            if y <= stair.min(2.8) {
                return CH_STONE;
            }
            if y >= 23.8 {
                return if y > ridge - 0.65 || y < 24.6 { CH_TRIM } else { CH_STONE };
            }
            let cap = y > 22.7 || y < 3.6;
            let radius: f32 = if cap { 1.05 } else { 0.78 };
            let along = (u.rem_euclid(4.4) - 2.2).abs();
            return if along.hypot(front - 1.3) <= radius.max(s * 0.6) { CH_STONE } else { 0 };
        }
        if y >= 24.0 {
            return if y > ridge - 0.6 { CH_LEAD } else { CH_STONE };
        }
        if b > 40.0 && y < 7.8 && round_arch((u + 4.4).rem_euclid(8.8) - 4.4, y, 2.2, 4.8, 2.0) && y > 1.2 {
            return CH_GLASS;
        }
    }
    let end_edge = 63.5 - u.abs();
    let face = wing_edge.min(end_edge);
    if y >= 20.7 && a >= 15.6 {
        // Steep outer mansard returns to a shallow inner pitch beyond the ridges.
        // Both long facades have small triangular end pediments in front of a recessed attic.
        if wing_edge < 2.4 {
            let pediment = 23.1 - 0.41 * (a - 53.0).abs();
            if y <= pediment {
                return if y >= pediment - 0.4 { CH_TRIM } else { CH_STONE };
            }
        }
        let roof = between(&[(0.0, 20.9), (1.3, 22.1), (2.4, 24.9), (4.5, 25.0),
            (10.5, 26.8), (15.0, 25.3)], face);
        if y > roof {
            return 0;
        }
        if face < 2.5 {
            if (22.0..23.3).contains(&y) && line(u, 4.6, 2.3, 1.3, s) {
                return CH_GLASS;
            }
            return if y > roof - 0.5 { CH_TRIM } else { CH_STONE };
        }
        return CH_LEAD;
    }
    let along = if end_edge < wing_edge { w } else { u };
    // Rusticated base, two-storey colonnade with recessed windows, and a projecting attic cornice.
    if face < 3.2 && (6.6..20.0).contains(&y) {
        let cap = y > 19.1 || y < 7.4;
        if face < 2.35 {
            return if line(along, 4.6, 0.0, if cap { 1.65 } else { 1.15 }, s) { CH_STONE } else { 0 };
        }
        if line(along, 4.6, 2.3, 2.0, s) && (y - 7.5).rem_euclid(6.0) < 4.25 {
            return CH_GLASS;
        }
    }
    if face < 3.0 && (1.8..5.5).contains(&y) && line(along, 4.6, 2.3, 1.85, s) {
        return CH_GLASS;
    }
    if (5.9..6.6).contains(&y) || (20.0..20.7).contains(&y) { CH_TRIM } else { CH_STONE }
}

// ── The Palace of Fine Arts (Maybeck, 1915, rebuilt 1965) (#60). Its frame: u east (towards the lagoon), w south, y up
// from its foot. Where each part stands is OpenStreetMap's (© OpenStreetMap contributors, ODbL, read 2026-11-26),
// projected into this frame; the way ids are beside the outlines. How high each part is comes from the lidar under
// the landmark's own grid (raw tops less the foot of 1.7 m), which agrees with the NPS listing (a rotunda 160 feet
// across on eight piers, 162 feet to its top, its two arcades running north and south). Rotunda: the dome is 49.0 m
// at its middle and falls to the drum's 40.0 m at 17 m out; the deck between drum and piers is 36.8 m and its outer
// step to 25.4 m out 28.5 m, and past that the piers' feet 5.3 m; under the deck (OSM min_height 25 m) the arches open between the piers.
// Arcades: each is its mapped outline, the entablature at the lidar's 17.7 m over columns, and where the lidar has a
// block to 21.7 m over the arcade's turns, a planter box. The grid ends 85.5 m north and south: past it the arcades
// keep their entablature and have no boxes, and the gateways are their outlines to OSM's 21 m. The column spacing
// (4.5 m), the arch rise (5 m) and the dome's thickness are by eye. The exhibition hall behind (way 288371302), the
// small buildings round the rotunda, the lagoon, its islands and trees are the map's: the rule owns only its outlines.
const PF_MID: (f32, f32) = (0.6, 0.8);
const PF_TOP: f32 = 49.0;
/// The dome's top at each distance from the middle, from the lidar's median over all bearings.
const PF_DOME_RISE: [(f32, f32); 9] = [(0.0, 49.0), (3.0, 48.8), (6.0, 48.3), (9.0, 47.2), (12.0, 45.4), (14.0, 43.6), (16.0, 41.1), (16.3, 40.6), (17.0, 40.0)];
const PF_DOME: f32 = 16.3; // way 456820271's mean radius
const PF_DRUM: f32 = 17.9; // way 456820274's mean radius
const PF_DRUM_TOP: f32 = 40.0;
const PF_HOLLOW: f32 = 15.5; // inside this the rotunda is open from its floor up to the dome's underside
const PF_UNDER: f32 = 25.0; // the deck's and drum's min_height (ways 1549377350, 456820274)
const PF_DECK: f32 = 36.8;
const PF_INNER: f32 = 22.5; // past this the deck and piers stop at their outer step
const PF_OUTER: f32 = 25.4; // past this a pier is only its 5.3 m foot (the lidar's 160 feet across)
const PF_PIER_FOOT: f32 = 5.3;
const PF_STEP: f32 = 28.5;
const PF_ARCH: f32 = 5.0;
const PF_ARCADE: f32 = 17.7;
const PF_ARCADE_BEAM: f32 = 14.9;
const PF_BOX: f32 = 21.7;
const PF_GATE: f32 = 21.0;
/// The lidar's blocks to 21.7 m over the arcades' turns: their middles and half widths.
const PF_BOXES: [(f32, f32, f32); 10] = [
    (-22.7, 36.2, 2.8), (-10.4, 53.9, 3.1), (5.4, 68.8, 3.1), (29.0, 75.0, 4.7), (43.0, 72.9, 4.0),
    (17.9, -81.1, 4.0), (2.5, -78.6, 4.1), (-15.9, -65.5, 3.0), (-26.8, -46.5, 3.0), (-32.5, -25.6, 2.9),
];
/// OSM way 288371295 (137 points).
const PF_TEMPLE: &[(f32, f32)] = &[(11.8, -25.9), (12.2, -24.0), (12.6, -24.5), (14.1, -23.4), (13.3, -22.2), (12.5, -22.7), (10.2, -19.4), (17.1, -14.7), (16.6, -15.7), (19.2, -17.8), (19.0, -18.0), (19.8, -19.1), (21.1, -17.8), (23.6, -18.2), (24.9, -19.2), (25.8, -21.6), (27.1, -21.3), (26.3, -19.1), (29.6, -14.5), (27.9, -13.4), (26.1, -10.8), (26.4, -7.0), (22.1, -6.1), (23.4, 1.0), (27.8, 1.0), (27.8, 2.2), (28.9, 4.9), (30.2, 6.0), (32.9, 7.0), (31.8, 12.4), (32.9, 13.8), (31.7, 14.3), (30.1, 12.7), (28.5, 12.0), (26.9, 12.0), (25.8, 12.3), (26.2, 12.7), (25.2, 14.2), (23.9, 13.3), (24.4, 12.6), (21.3, 10.8), (16.8, 17.3), (19.2, 19.9), (20.1, 19.0), (21.2, 20.0), (19.9, 21.4), (19.4, 21.0), (19.4, 22.3), (20.4, 24.1), (21.7, 25.4), (23.2, 26.0), (22.3, 31.9), (17.5, 29.8), (15.0, 26.8), (14.3, 24.6), (9.3, 26.4), (8.5, 22.3), (0.4, 23.7), (0.8, 28.1), (-4.6, 27.4), (-4.6, 29.7), (-5.8, 32.6), (-6.9, 34.5), (-9.7, 36.9), (-12.4, 31.6), (-10.6, 29.5), (-10.3, 26.1), (-10.5, 25.6), (-10.9, 26.3), (-12.3, 25.3), (-11.5, 23.9), (-10.7, 24.5), (-8.8, 21.5), (-15.5, 16.6), (-17.8, 19.7), (-17.3, 20.0), (-18.1, 21.1), (-20.2, 19.5), (-19.6, 18.6), (-20.1, 17.9), (-20.9, 18.5), (-23.3, 17.7), (-24.8, 15.3), (-24.8, 12.6), (-23.8, 11.8), (-24.1, 11.2), (-25.3, 11.4), (-25.6, 8.8), (-24.4, 8.6), (-24.3, 9.2), (-20.4, 8.5), (-21.0, 4.0), (-21.6, 0.4), (-25.5, 0.9), (-25.4, 1.7), (-26.8, 1.9), (-27.3, -0.8), (-25.9, -0.9), (-25.8, -1.8), (-27.3, -2.5), (-27.8, -3.7), (-27.7, -6.3), (-26.5, -8.4), (-25.4, -8.9), (-24.2, -8.9), (-24.0, -9.4), (-25.2, -10.1), (-23.5, -12.3), (-22.5, -11.5), (-22.8, -11.0), (-19.3, -8.7), (-14.6, -15.4), (-17.6, -17.9), (-18.2, -17.0), (-19.4, -17.9), (-18.4, -19.5), (-17.5, -18.8), (-17.4, -19.4), (-17.8, -21.2), (-18.8, -22.7), (-21.5, -24.2), (-20.5, -29.9), (-16.6, -28.2), (-14.6, -26.3), (-13.2, -24.2), (-12.7, -22.6), (-7.6, -24.7), (-6.7, -20.1), (1.5, -21.5), (0.8, -26.3), (6.4, -25.5), (6.3, -27.0), (7.1, -30.1), (8.5, -32.2), (11.5, -34.9), (13.9, -29.7), (12.3, -27.9)];
/// OSM way 1549377350 (52 points).
const PF_DECK_OUTLINE: &[(f32, f32)] = &[(21.3, 10.8), (24.4, 12.6), (23.9, 13.3), (25.2, 14.2), (26.2, 12.7), (25.8, 12.3), (28.2, 3.6), (27.8, 1.0), (23.4, 1.0), (22.1, -6.1), (26.4, -7.0), (26.1, -10.8), (21.2, -18.0), (19.8, -19.1), (19.0, -18.0), (19.2, -17.8), (16.6, -15.7), (17.1, -14.7), (10.2, -19.4), (12.5, -22.7), (12.2, -24.0), (6.4, -25.5), (0.8, -26.3), (1.5, -21.5), (-6.7, -20.1), (-7.6, -24.7), (-12.7, -22.6), (-17.5, -18.8), (-17.6, -17.9), (-14.6, -15.4), (-19.3, -8.7), (-22.8, -11.0), (-25.0, -5.7), (-25.5, 0.9), (-21.6, 0.4), (-20.4, 8.5), (-24.3, 9.2), (-21.9, 15.3), (-17.8, 19.7), (-15.5, 16.6), (-8.8, 21.5), (-10.7, 24.5), (-10.5, 25.6), (-3.3, 27.7), (0.8, 28.1), (0.4, 23.7), (8.5, 22.3), (9.3, 26.4), (14.3, 24.6), (19.4, 21.0), (19.3, 19.9), (16.8, 17.3)];
/// OSM way 288371310 (71 points).
const PF_NORTH: &[(f32, f32)] = &[(14.4, -109.9), (18.6, -110.3), (19.3, -105.0), (16.4, -104.6), (19.0, -85.0), (21.6, -85.4), (22.4, -80.1), (19.4, -79.7), (20.0, -76.2), (15.2, -75.5), (14.7, -78.8), (6.8, -77.5), (7.3, -74.4), (2.8, -73.7), (2.1, -76.2), (0.0, -75.2), (-0.7, -76.7), (-7.1, -72.5), (-12.3, -67.4), (-13.3, -66.0), (-11.5, -64.5), (-14.6, -60.6), (-16.2, -62.0), (-18.2, -59.3), (-24.1, -47.6), (-22.2, -46.7), (-24.1, -42.5), (-25.9, -43.3), (-26.7, -41.3), (-29.5, -32.3), (-30.6, -27.2), (-28.7, -26.9), (-29.5, -22.1), (-30.6, -22.3), (-31.0, -20.2), (-32.5, -19.1), (-33.7, -19.0), (-34.9, -19.5), (-35.9, -21.1), (-35.6, -23.1), (-36.2, -23.2), (-35.4, -28.0), (-33.7, -27.8), (-30.7, -39.5), (-28.7, -44.6), (-30.3, -45.3), (-28.4, -49.5), (-27.0, -48.9), (-24.5, -54.3), (-20.7, -60.8), (-18.5, -63.8), (-19.9, -64.9), (-16.8, -68.8), (-15.6, -67.8), (-11.7, -72.5), (-2.1, -79.5), (-2.8, -80.7), (0.8, -82.1), (0.3, -85.2), (3.1, -85.7), (3.7, -82.5), (4.3, -82.6), (4.6, -80.4), (15.7, -82.1), (15.5, -84.4), (16.0, -84.5), (13.2, -104.1), (12.5, -107.3), (10.4, -107.0), (9.2, -112.4), (13.7, -112.9)];
/// OSM way 288371306 (75 points).
const PF_SOUTH: &[(f32, f32)] = &[(-21.7, 33.3), (-20.8, 33.0), (-18.6, 37.2), (-20.1, 38.0), (-17.0, 43.1), (-10.6, 51.5), (-9.4, 50.4), (-6.3, 53.9), (-7.5, 55.0), (-4.8, 58.0), (0.1, 62.7), (4.8, 66.3), (5.8, 65.0), (9.6, 67.8), (8.7, 69.0), (13.7, 71.9), (20.5, 74.3), (23.7, 75.0), (23.8, 73.7), (26.4, 74.0), (25.9, 71.5), (30.5, 71.0), (31.0, 73.5), (39.0, 72.3), (38.5, 69.6), (43.1, 68.9), (43.6, 71.7), (46.8, 71.1), (47.8, 76.5), (44.9, 77.1), (48.5, 96.6), (51.6, 96.0), (52.7, 101.2), (48.3, 102.1), (49.0, 105.4), (44.2, 106.2), (43.5, 100.9), (45.8, 100.4), (45.3, 97.3), (45.6, 97.2), (41.1, 75.5), (39.6, 75.7), (39.5, 75.3), (31.6, 76.5), (31.7, 77.3), (30.0, 77.3), (30.5, 79.8), (30.0, 79.8), (30.2, 82.6), (27.2, 82.8), (26.9, 79.8), (23.1, 79.8), (23.3, 77.9), (15.5, 75.9), (10.7, 73.8), (6.9, 71.6), (5.8, 73.0), (2.0, 70.3), (3.0, 68.8), (-2.6, 64.2), (-9.8, 57.0), (-11.1, 58.2), (-14.2, 54.7), (-12.9, 53.5), (-19.2, 45.2), (-22.8, 39.4), (-24.4, 40.2), (-26.5, 35.9), (-25.5, 35.4), (-26.9, 34.2), (-27.2, 32.9), (-26.9, 31.7), (-25.5, 30.4), (-23.7, 30.3), (-22.2, 31.4)];
/// OSM way 288371313 (12 points).
const PF_NORTH_GATE: &[(f32, f32)] = &[(0.0, -102.0), (0.5, -99.3), (-2.4, -98.7), (-2.9, -101.4), (-5.8, -100.8), (-6.9, -106.2), (-3.4, -106.9), (-4.0, -110.0), (1.3, -111.0), (2.4, -105.4), (-0.0, -105.0), (0.6, -102.1)];
/// OSM way 288371314 (10 points).
const PF_SOUTH_GATE: &[(f32, f32)] = &[(32.0, 96.3), (33.2, 102.3), (35.5, 102.0), (36.2, 107.3), (31.8, 108.0), (31.3, 104.8), (27.1, 105.4), (26.3, 100.0), (29.4, 99.6), (29.0, 96.7)];
/// The eight piers, OSM ways 1549377328, 1549377331, 1549377334, 1549377335, 1549377338, 1549377341, 1549377344, 1549377345 (building:part, 36 m).
const PF_PIERS: [&[(f32, f32)]; 8] = [
    &[(6.4, -25.5), (12.2, -24.0), (12.5, -22.7), (10.3, -19.4), (1.5, -21.5), (0.8, -26.3)], // 1549377328
    &[(-7.6, -24.7), (-12.7, -22.6), (-17.5, -18.8), (-17.6, -17.9), (-14.6, -15.4), (-6.7, -20.1)], // 1549377331
    &[(-19.3, -8.7), (-21.6, 0.4), (-25.5, 0.9), (-25.0, -5.7), (-22.8, -11.0)], // 1549377334
    &[(-20.4, 8.5), (-15.5, 16.6), (-17.8, 19.7), (-21.9, 15.3), (-24.3, 9.2)], // 1549377335
    &[(-8.8, 21.5), (0.4, 23.7), (0.8, 28.1), (-3.3, 27.7), (-10.5, 25.6), (-10.7, 24.5)], // 1549377338
    &[(8.5, 22.3), (16.8, 17.3), (19.3, 19.9), (19.4, 21.0), (14.3, 24.6), (12.0, 25.6), (9.3, 26.4)], // 1549377341
    &[(19.2, -17.8), (19.0, -18.0), (19.8, -19.1), (21.2, -18.0), (21.1, -17.8), (26.1, -10.8), (26.4, -7.0), (22.1, -6.1), (16.6, -15.7)], // 1549377344
    &[(23.4, 1.0), (21.3, 10.8), (24.4, 12.6), (23.9, 13.3), (25.2, 14.2), (26.2, 12.7), (25.8, 12.3), (28.2, 3.6), (27.8, 2.2), (27.8, 1.0)], // 1549377345
];
/// The low parts round the piers' feet and their mapped heights, OSM ways 1549377329 to 1549377349.
const PF_STEPS: [(&[(f32, f32)], f32); 14] = [
    (&[(11.5, -34.9), (9.7, -33.5), (8.5, -32.2), (7.1, -30.1), (6.3, -27.0), (6.4, -25.5), (12.2, -24.0), (11.9, -24.4), (11.8, -25.9), (12.3, -27.9), (13.9, -29.7)], 5.0), // 1549377329
    (&[(12.2, -24.0), (12.5, -22.7), (13.3, -22.2), (14.1, -23.4), (12.6, -24.5)], 2.0), // 1549377330
    (&[(-17.5, -18.8), (-12.7, -22.6), (-13.2, -24.2), (-14.6, -26.3), (-16.6, -28.2), (-18.5, -29.3), (-20.5, -29.9), (-21.5, -24.2), (-20.2, -23.7), (-18.8, -22.7), (-17.8, -21.2), (-17.4, -19.4)], 5.0), // 1549377332
    (&[(-17.5, -18.8), (-17.6, -17.9), (-18.2, -17.0), (-19.4, -17.9), (-18.4, -19.5)], 3.0), // 1549377333
    (&[(-25.0, -5.7), (-22.5, -11.5), (-23.5, -12.3), (-25.2, -10.1), (-24.0, -9.4), (-24.2, -8.9), (-25.4, -8.9), (-26.5, -8.4), (-27.7, -6.3), (-27.8, -3.7), (-27.3, -2.5), (-26.6, -2.0), (-25.8, -1.8), (-25.9, -0.9), (-27.3, -0.8), (-26.8, 1.9), (-25.4, 1.7)], 4.0), // 1549377336
    (&[(-21.9, 15.3), (-17.3, 20.0), (-18.1, 21.1), (-20.2, 19.5), (-19.6, 18.6), (-20.1, 17.9), (-20.9, 18.5), (-21.8, 18.4), (-23.3, 17.7), (-24.2, 16.6), (-24.8, 15.3), (-25.0, 13.6), (-24.8, 12.6), (-23.8, 11.8), (-24.1, 11.2), (-25.3, 11.4), (-25.6, 8.8), (-24.4, 8.6)], 4.0), // 1549377337
    (&[(-10.7, 24.5), (-10.5, 25.6), (-10.9, 26.3), (-12.3, 25.3), (-11.5, 23.9)], 3.0), // 1549377339
    (&[(-10.5, 25.6), (-4.6, 27.4), (-4.6, 29.7), (-5.8, 32.6), (-6.9, 34.5), (-9.7, 36.9), (-12.4, 31.6), (-11.5, 30.8), (-10.6, 29.5), (-10.2, 27.6)], 5.0), // 1549377340
    (&[(19.4, 21.0), (19.9, 21.4), (21.2, 20.0), (20.1, 19.0), (19.3, 19.9)], 5.0), // 1549377342
    (&[(14.3, 24.6), (15.0, 26.8), (16.1, 28.4), (17.5, 29.8), (20.6, 31.4), (22.3, 31.9), (23.2, 26.0), (21.7, 25.4), (20.4, 24.1), (19.4, 22.3), (19.4, 21.0)], 5.0), // 1549377343
    (&[(31.8, 12.4), (31.1, 13.5), (30.1, 12.7), (28.5, 12.0), (26.9, 12.0), (25.8, 12.3), (28.2, 3.6), (28.9, 4.9), (30.2, 6.0), (32.9, 7.0)], 5.0), // 1549377346
    (&[(26.1, -10.8), (21.1, -17.8), (22.1, -17.8), (23.6, -18.2), (24.9, -19.2), (25.5, -20.3), (29.6, -14.5), (27.9, -13.4), (26.8, -12.1)], 5.0), // 1549377347
    (&[(25.5, -20.3), (26.3, -19.1), (27.1, -21.3), (25.8, -21.6)], 2.0), // 1549377348
    (&[(31.8, 12.4), (31.1, 13.5), (31.7, 14.3), (32.9, 13.8)], 5.0), // 1549377349
];
/// Bounding boxes (u, w low, then high) of the outlines above, to turn most cells away before a polygon test.
const PF_TEMPLE_BOX: [f32; 4] = [-27.9, -35.0, 33.0, 37.0];
const PF_NORTH_BOX: [f32; 4] = [-36.3, -113.0, 22.5, -18.9];
const PF_SOUTH_BOX: [f32; 4] = [-27.3, 30.1, 52.8, 106.3];
const PF_NORTH_GATE_BOX: [f32; 4] = [-7.0, -111.1, 2.5, -98.6];
const PF_SOUTH_GATE_BOX: [f32; 4] = [26.2, 96.2, 36.3, 108.1];
/// The arcades' columns, one every 4.5 m or more along the middle of each mapped outline (63).
const PF_COLUMNS: [(f32, f32); 63] = [(-34.7, -24.1), (-30.3, -25.5), (-31.4, -29.8), (-30.1, -34.7), (-28.8, -39.0), (-27.1, -43.7), (-25.4, -47.9), (-23.4, -52.5), (-21.0, -56.9), (-18.4, -61.2), (-14.1, -63.2), (-13.4, -68.1), (-9.9, -71.6), (-6.0, -74.8), (-1.9, -77.5), (2.9, -77.3), (7.3, -78.9), (11.7, -79.6), (16.1, -78.4), (19.8, -81.1), (17.7, -85.1), (17.0, -90.0), (16.4, -95.0), (15.7, -99.9), (15.1, -104.4), (17.5, -108.4), (13.1, -109.8), (2.5, -81.9), (-0.9, -102.9), (0.7, -107.4), (-4.8, -105.3), (-24.8, 36.5), (-21.2, 39.5), (-18.8, 43.3), (-16.0, 47.4), (-13.0, 51.4), (-11.5, 55.8), (-7.3, 57.8), (-3.7, 61.3), (0.0, 64.7), (3.5, 67.5), (7.1, 70.3), (11.5, 72.7), (15.6, 74.5), (20.4, 76.0), (24.6, 77.9), (28.3, 80.8), (29.2, 76.3), (33.8, 74.8), (38.3, 74.2), (42.6, 76.0), (43.7, 80.8), (44.6, 85.3), (45.6, 90.2), (46.4, 94.6), (47.0, 99.5), (45.2, 104.0), (45.8, 72.8), (41.8, 70.4), (-23.3, 32.2), (30.9, 97.8), (27.8, 101.2), (31.9, 103.6)];

fn in_box(b: [f32; 4], u: f32, w: f32) -> bool {
    u >= b[0] && u <= b[2] && w >= b[1] && w <= b[3]
}

/// What part of the Palace stands at (u, w), if any: its rotunda, an arcade or a gateway.
#[derive(Clone, Copy, PartialEq, Debug)]
enum PfPart {
    Rotunda,
    Arcade,
    Gate,
}

fn pf_part(u: f32, w: f32) -> Option<PfPart> {
    if in_box(PF_TEMPLE_BOX, u, w) && inside(PF_TEMPLE, u, w) {
        Some(PfPart::Rotunda)
    } else if (in_box(PF_NORTH_BOX, u, w) && inside(PF_NORTH, u, w)) || (in_box(PF_SOUTH_BOX, u, w) && inside(PF_SOUTH, u, w)) {
        Some(PfPart::Arcade)
    } else if (in_box(PF_NORTH_GATE_BOX, u, w) && inside(PF_NORTH_GATE, u, w)) || (in_box(PF_SOUTH_GATE_BOX, u, w) && inside(PF_SOUTH_GATE, u, w)) {
        Some(PfPart::Gate)
    } else {
        None
    }
}

/// The ordinary footprints in BAY1 tile 194_263 sit 1.2 m west and 0.6 m north
/// of these same OSM buildings. The distant walls are rasterized at 1 m.
fn pf_owns(u: f32, w: f32) -> bool {
    if pf_part(u, w).is_some() || pf_part(u + 1.2, w + 0.6).is_some() {
        return true;
    }
    // One-metre far wall faces are binned by their midpoints. Include the
    // registration difference plus half a cell around the elevated openings.
    // Past the rotunda deck the steps share space with separate mapped plinths.
    let margin = 2.0;
    let borders = |[x0, z0, x1, z1]: [f32; 4], polygon: &[(f32, f32)]| {
        in_box([x0 - margin, z0 - margin, x1 + margin, z1 + margin], u, w)
            && edge_distance(polygon, u, w) <= margin
    };
    ((u - PF_MID.0).powi(2) + (w - PF_MID.1).powi(2) <= (PF_OUTER + margin).powi(2)
        && borders(PF_TEMPLE_BOX, PF_TEMPLE))
        || borders(PF_NORTH_BOX, PF_NORTH) || borders(PF_SOUTH_BOX, PF_SOUTH)
        || borders(PF_NORTH_GATE_BOX, PF_NORTH_GATE) || borders(PF_SOUTH_GATE_BOX, PF_SOUTH_GATE)
}

/// The Palace's floors are stone inside its outlines; outside them the ground is the map's (the lagoon is the terrain's).
fn fine_arts_surface(u: f32, w: f32) -> Option<Kind> {
    pf_part(u, w).map(|_| kind(CONCRETE, colour(2, 0)))
}

fn fine_arts(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(-1.5..PF_TOP + 1.0).contains(&y) {
        return 0;
    }
    let Some(part) = pf_part(u, w) else { return 0 };
    // The reconstructed travertine finish and friezes are buff, with russet
    // shafts on the rotunda's outer piers (NPS registration, section 7).
    let stone = kind(CONCRETE, colour(3, 1));
    let stone_light = kind(CONCRETE, colour(3, 0));
    let frieze = kind(CONCRETE, colour(2, 1));
    let dome = kind(CONCRETE, colour(3, 0));
    if y < 0.0 {
        return stone;
    }
    if part != PfPart::Rotunda {
        let top = if part == PfPart::Gate { PF_GATE } else { PF_ARCADE };
        if y < 0.8 {
            return stone_light;
        }
        if y >= top {
            let boxed = part == PfPart::Arcade && y < PF_BOX && PF_BOXES.iter().any(|&(bu, bw, h)| (u - bu).abs() <= h && (w - bw).abs() <= h);
            return if boxed { if y < PF_BOX - 0.8 { frieze } else { stone_light } } else { 0 };
        }
        if y >= PF_ARCADE_BEAM {
            return if (15.6..16.6).contains(&y) { frieze } else { stone_light };
        }
        // Corinthian columns, each with a wider base and capital, on the middle of the band.
        let rad = if y < 1.8 || y > PF_ARCADE_BEAM - 1.4 { 0.95f32 } else { 0.75 };
        let near = PF_COLUMNS.iter().any(|&(cu, cw)| (u - cu).powi(2) + (w - cw).powi(2) <= rad.max(s * 0.55).powi(2));
        return if near { stone } else { 0 };
    }
    // ── The rotunda.
    let r = ((u - PF_MID.0).powi(2) + (w - PF_MID.1).powi(2)).sqrt();
    if y >= PF_DRUM_TOP {
        if r >= PF_DOME {
            return 0;
        }
        let top = between(&PF_DOME_RISE, r);
        return if y < top && (y >= top - 1.2f32.max(s) || r >= PF_HOLLOW) { dome } else { 0 };
    }
    if y >= PF_UNDER && r < PF_DRUM {
        // The drum, and inside it the open rotunda up to the dome's underside.
        return if r >= PF_HOLLOW { if y < PF_UNDER + 1.0 { stone_light } else { stone } } else { 0 };
    }
    let pier = PF_PIERS.iter().any(|p| inside(p, u, w));
    if pier {
        let outer = if r <= PF_INNER { PF_DECK } else if r <= PF_OUTER { PF_STEP } else { PF_PIER_FOOT };
        if y >= outer { return 0; }
        if (PF_PIER_FOOT..PF_UNDER).contains(&y) {
            // Each mapped pier faces out, the eastern one at 13 degrees. On the
            // NPS lagoon photograph its two shafts span about a quarter of the
            // pier's width each, with their axes a little over two diameters apart.
            let bearing = (w - PF_MID.1).atan2(u - PF_MID.0) - 13.0_f32.to_radians();
            let angle = (bearing + std::f32::consts::FRAC_PI_8).rem_euclid(std::f32::consts::FRAC_PI_4)
                - std::f32::consts::FRAC_PI_8;
            let depth = r * angle.cos();
            let across = (r * angle.sin()).abs();
            let moulding = y < PF_PIER_FOOT + 1.0 || y >= PF_UNDER - 1.8;
            let radius: f32 = if moulding { 1.6 } else { 1.3 };
            if (depth - 23.9).powi(2) + (across - 3.1).powi(2) <= radius.powi(2) {
                return if moulding { stone_light } else { kind(CONCRETE, colour(1, 2)) };
            }
            if depth > 23.8 { return 0; }
        }
        return if y < 2.2 || (PF_UNDER - 0.7..PF_UNDER).contains(&y) { stone_light } else { stone };
    }
    for (outline, h) in PF_STEPS {
        if inside(outline, u, w) {
            return if y < h { stone_light } else { 0 };
        }
    }
    let outer = if r <= PF_INNER { PF_DECK } else { PF_STEP };
    if r < PF_HOLLOW || !inside(PF_DECK_OUTLINE, u, w) || y >= outer {
        return 0;
    }
    if y >= PF_UNDER {
        return if (PF_UNDER + 2.0..PF_UNDER + 3.4).contains(&y) { frieze } else { stone_light };
    }
    // Under the deck an arch springs from each pier: its underside rises with the distance from the nearest pier.
    let d = PF_PIERS.iter().map(|p| edge_distance(p, u, w)).fold(f32::MAX, f32::min).min(PF_ARCH);
    let under = PF_UNDER - PF_ARCH + (PF_ARCH * PF_ARCH - (PF_ARCH - d).powi(2)).sqrt();
    if y >= under { stone } else { 0 }
}

// ── The Golden Gate Bridge (Strauss, Ellis, Morrow, Moisseiff; 1937). Its frame: u from the middle of the main span
// towards Marin, y up from the water, w towards the bay. Published figures: main span 1,280 m between towers 227 m
// over the water and 152 m over the roadway; side spans 343 m; roadway 27.4 m wide between two cables 0.92 m thick
// that sag 143.5 m; hangers every 15.24 m; a stiffening truss 7.6 m deep; steel in International Orange. The towers'
// legs, their setbacks, the four portal struts over the roadway and the bracing under it are as Overture's parts
// have them (from OpenStreetMap: legs 27.4 m apart, 14 by 8 m at the pier, struts at 111, 151, 185 and 215 m).
// The concrete pylons, the arch over Fort Point, the anchorages and the approach bents are placed by eye from
// photographs, not surveyed; the south approach is drawn straight and in truth curves.
const GG_TOWER: f32 = 640.0;
const GG_PYLON: f32 = 983.0;
const GG_SOUTH: f32 = -1340.0;
/// Road contact in tile 0/182_250 on the mapped midpoint of the two US 101 carriageways.
const GG_NORTH: f32 = 1413.0;
const GG_TOP: f32 = 227.0;
/// The cables, the trusses and the legs' middles: this far either side of the centre line.
const GG_PLANE: f32 = 13.7;
const GG_PANEL: f32 = 7.62;

/// The north anchorage's far face: past it the roadway is the north approach, carrying US 101 onto Marin.
const GG_ANCHOR_N: f32 = 1110.0;
/// Where the north approach lands, and how high: the deck meets tile 0/182_250's ground (USGS CA_SanFrancisco_B23
/// 1 m bare earth, NAVD88 metres, taken as the foot's datum) on 101's line at u 1413 m, 73.0 m up. The district
/// publishes no length for either approach (abutment to abutment 2,737 m, the suspended spans 1,966 m).
const GG_LANDING_Y: f32 = 73.0;
/// US 101's middle line over the north approach, (u, w): halfway between Overture's two carriageways (2026-10-21.0,
/// segments 1b5877f0 and 82e8434e), which leave the bridge's axis at u 1220 m and bend towards the ocean.
const GG_101: [(f32, f32); 9] =
    [(1220.0, 0.0), (1253.0, -3.5), (1282.0, -8.5), (1311.0, -16.5), (1325.0, -21.5), (1354.0, -34.5), (1380.0, -48.5), (1405.0, -66.0), (1425.0, -81.0)];

/// Where 101's middle line is across the frame (w) at `u`, and how it turns there (dw/du): the axis south of the bend.
fn gg_line(u: f32) -> (f32, f32) {
    if u <= GG_101[0].0 {
        return (0.0, 0.0);
    }
    let i = GG_101.iter().position(|p| p.0 >= u).unwrap_or(GG_101.len() - 1).max(1);
    let ((u0, w0), (u1, w1)) = (GG_101[i - 1], GG_101[i]);
    let turn = (w1 - w0) / (u1 - u0);
    (w0 + turn * (u - u0), turn)
}

/// Perpendicular distance from the carriageway centre, measured in metres.
fn gg_offset(u: f32, w: f32) -> f32 {
    if u <= GG_101[0].0 { return w; }
    let (centre, slope) = gg_line(u);
    (w - centre) / (1.0 + slope * slope).sqrt()
}

/// The ground road class doubled an elevated US 101 carriageway in this part of the gully.
pub fn draped_north_highway(u: f32, w: f32, ground: f32) -> bool {
    (GG_ANCHOR_N..GG_NORTH).contains(&u) && gg_offset(u, w).abs() <= 15.0 && ground < gg_road(u) - 3.0
}

/// How high the roadway is: highest in the middle of the main span, falling away past the towers.
/// Past the north anchorage it climbs evenly to where the approach lands.
fn gg_road(u: f32) -> f32 {
    let a = u.abs();
    if a <= GG_TOWER {
        75.0 + 3.0 * (1.0 - (a / GG_TOWER) * (a / GG_TOWER))
    } else if u > GG_ANCHOR_N {
        let from = 75.0 - 0.012 * (GG_ANCHOR_N - GG_TOWER);
        from + (GG_LANDING_Y - from) * ((u - GG_ANCHOR_N) / (GG_NORTH - GG_ANCHOR_N)).min(1.0)
    } else {
        75.0 - 0.012 * (a - GG_TOWER)
    }
}

/// How high a cable's middle is, and how steep it is there: a parabola between the towers, another down each side
/// span of the same curve (the pull along it is one), then straight down into the anchorage.
fn gg_cable(u: f32) -> Option<(f32, f32)> {
    let a = u.abs();
    if a <= GG_TOWER {
        return Some((81.5 + 143.5 * (a / GG_TOWER) * (a / GG_TOWER), 2.0 * 143.5 * a / (GG_TOWER * GG_TOWER)));
    }
    let x = GG_PYLON - a;
    let end = gg_road(GG_PYLON) + 2.5;
    if x >= 0.0 { Some((end + 0.322 * x + 3.5e-4 * x * x, 0.322 + 7.0e-4 * x)) } else if x > -150.0 { Some((end + 0.322 * x, 0.322)) } else { None }
}

/// Whether a member `half` thick, whose middle line is `off` from a cell's middle (measured square to it), is in the cell.
fn member(off: f32, half: f32, s: f32) -> bool {
    off.abs() < half.max(s * 0.55)
}

fn golden_gate(u: f32, y: f32, w: f32, s: f32) -> Kind {
    let orange = kind(STEEL, colour(0, 4));
    let concrete = kind(CONCRETE, grey(5));
    if !(-30.0..GG_TOP).contains(&y) || !(GG_SOUTH - 6.0..GG_NORTH).contains(&u) {
        return 0;
    }
    let w = gg_offset(u, w);
    let (a, aw) = (u.abs(), w.abs());
    // ── A tower: its pier, its two legs, the struts between them.
    let du = a - GG_TOWER;
    if du.abs() < 30.0 {
        if y < 13.0 {
            // The pier: concrete, round-ended, down into the water. Round the south one a fender, a ring of concrete.
            let past = (aw - 9.4).max(0.0);
            if du.abs() <= 11.85 && past * past + du * du <= 11.85 * 11.85 {
                return concrete;
            }
            let ring = ((w / 45.0) * (w / 45.0) + (du / 27.5) * (du / 27.5)).sqrt();
            return if u < 0.0 && y < 5.0 && ring <= 1.0 && ring > 1.0 - (3.0f32.max(s) / 36.0) { concrete } else { 0 };
        }
        // A leg draws in at each setback: half its width across the bridge and along it.
        let (hw, hu): (f32, f32) = if y < 21.0 { (4.95, 8.0) } else if y < 74.0 { (4.0, 7.0) } else if y < 123.0 { (4.0, 6.0) } else if y < 162.0 { (4.0, 5.0) } else if y < 195.0 { (2.85, 5.0) } else { (1.9, 4.0) };
        let lw = aw - GG_PLANE;
        if lw.abs() <= hw.max(s * 0.5) && du.abs() <= hu.max(s * 0.5) {
            // Its faces are ribbed: the cells of riveted plate it is built of show as flutes.
            let face = (hw - lw.abs()).min(hu - du.abs());
            let flute = if hw - lw.abs() < hu - du.abs() { line(du, 1.4, 0.7, 0.5, s) } else { line(lw, 1.4, 0.7, 0.5, s) };
            return if s <= 0.25 && face < 0.2 && flute && y > 21.0 { 0 } else { orange };
        }
        let between = GG_PLANE - hw - aw;
        if between > 0.0 {
            // Over the roadway four struts, each on stepped brackets; under it two, with crossed braces between.
            for (foot, head) in [(111.0, 121.0), (151.0, 161.0), (185.0, 193.0), (215.0, 223.0)] {
                if du.abs() <= 2.9f32.max(s * 0.5) && y >= foot - 4.0 && y < head {
                    let step = ((foot - y) / 1.0).ceil().max(0.0);
                    if y >= foot || between < (4.0 - step) * 1.2 {
                        return if s <= 0.25 && du.abs() > 2.7 && y >= foot && line(w, 1.6, 0.8, 0.6, s) { 0 } else { orange };
                    }
                }
            }
            if du.abs() <= 2.9f32.max(s * 0.5) && ((24.0..26.0).contains(&y) || (50.0..52.0).contains(&y)) {
                return orange;
            }
            if du.abs() <= 2.0f32.max(s * 0.5) {
                for (foot, head) in [(26.0, 50.0), (52.0, 67.0)] {
                    if y >= foot && y < head {
                        let wide = 2.0 * (GG_PLANE - hw);
                        let t = (w + wide / 2.0) / wide;
                        let slope = (head - foot) / wide;
                        let square = 1.0 / (1.0 + slope * slope).sqrt();
                        if member((y - foot - (head - foot) * t) * square, 1.0, s) || member((y - head + (head - foot) * t) * square, 1.0, s) {
                            return orange;
                        }
                    }
                }
            }
        }
    }
    if aw > 23.0 {
        return 0;
    }
    let road = gg_road(u);
    let dy = y - road;
    // ── The pylons: two concrete shafts beside the roadway where each side span ends, and a second pair beyond.
    let second = if u < 0.0 { 1085.0 } else { 1050.0 };
    for (at, over) in [(GG_PYLON, 16.0), (second, 12.0)] {
        if (a - at).abs() <= 4.5 && (14.6..21.4).contains(&aw) && dy < over {
            // Stepped in at the top, as the towers are.
            let step = ((dy - (over - 6.0)) / 2.0).ceil().max(0.0);
            return if (a - at).abs() <= 4.5 - step * 0.8 && aw >= 14.6 + step * 0.4 && aw < 21.4 - step * 0.8 { concrete } else { 0 };
        }
    }
    // ── The cables, and the hangers from them to the truss.
    if let Some((high, steep)) = gg_cable(u) {
        if member(aw - GG_PLANE, 0.46, s) {
            if member((y - high) / (1.0 + steep * steep).sqrt(), 0.46, s) {
                return orange;
            }
            // Keep iconic vertical hangers visible through 1.6 m cells (up to ~800 m) instead of vanishing at 0.8 m;
            // drop past 1.6 m so distant silhouettes stay clean (#60).
            let hanger_step = if s <= 0.8 { 15.24 } else { 30.48 };
            if s <= 1.6 && member(aw - GG_PLANE, 0.16, s) && a < GG_PYLON - 4.0 && du.abs() > 6.0 && y < high && dy > -1.0 && line(u, hanger_step, 0.0, 0.3, s) {
                return orange;
            }
        }
    }
    // Art Deco light standards along both sidewalks every 45.72 m (3 hanger bays).
    if s <= 0.8 && dy > 0.0 && dy <= 8.6 && u > GG_SOUTH + 22.0 && u < GG_NORTH - 12.0 && du.abs() > 10.0 && line(u, 45.72, 22.86, 0.45, s) {
        if (aw - (GG_PLANE - 0.3)).abs() <= 0.25f32.max(s * 0.5) && dy <= 8.2 {
            return orange;
        }
        if dy >= 7.6 && dy <= 8.5 && aw >= GG_PLANE - 2.0 && aw <= GG_PLANE - 0.1 {
            return if dy <= 8.0 && aw < GG_PLANE - 1.0 { kind(LAMP, colour(3, 0)) } else { orange };
        }
    }
    if dy > 1.4 || dy < -40.0 && a < 1080.0 {
        return 0;
    }
    // ── The roadway, 6-lane striping, movable yellow/concrete median barrier, sidewalks and truss.
    if dy <= 0.0 && dy > -(1.0f32.max(s)) && aw <= GG_PLANE + 0.5 {
        let top = dy > -(0.3f32.max(s));
        if !top {
            return orange;
        }
        if aw > 10.4 {
            return concrete;
        }
        if s <= 0.4 {
            // Double yellow center line beside the movable barrier, dashed white 6-lane dividers & solid white shoulders.
            if (aw - 0.55).abs() < 0.14 {
                return kind(PLASTER, colour(3, 4));
            }
            if ((aw - 3.45).abs() < 0.12 || (aw - 6.75).abs() < 0.12) && u.rem_euclid(10.0) < 3.6 {
                return kind(PLASTER, WHITE);
            }
            if (aw - 10.0).abs() < 0.14 {
                return kind(PLASTER, WHITE);
            }
        }
        return kind(ASPHALT, OWN);
    }
    if dy > 0.0 {
        // Movable concrete/yellow zipper median barrier along the center of the 6-lane deck.
        if aw <= 0.32f32.max(s * 0.5) && dy <= 0.78 && s <= 0.8 {
            return if dy > 0.55 { kind(PLASTER, colour(3, 4)) } else { kind(CONCRETE, grey(3)) };
        }
        // Pedestrian/roadway curb barrier & Art Deco rail at each edge.
        if (aw - 10.55).abs() <= 0.22 && dy <= 0.85 && s <= 0.4 {
            return orange;
        }
        let rail = (aw - GG_PLANE).abs() <= 0.15f32.max(s * 0.5) && dy <= 1.3f32.max(s);
        return if rail && s <= 1.0 && (s > 0.25 || dy > 1.05 || line(u, 0.6, 0.0, 0.1, s)) { orange } else { 0 };
    }
    if dy > -8.2 - s * 0.5 {
        let within = dy <= -1.0 && dy >= -7.6;
        if member(aw - GG_PLANE, 0.5, s) {
            // A truss in each cable's plane: two chords, a post at every panel and a diagonal across each, leaning
            // one way and then the other.
            if member(dy + 1.0, 0.5, s) || member(dy + 7.6, 0.5, s) {
                return orange;
            }
            let panel = (u / GG_PANEL).floor();
            let t = u / GG_PANEL - panel;
            let across = if panel.rem_euclid(2.0) < 1.0 { t } else { 1.0 - t };
            if within && (line(u, GG_PANEL, 0.0, 0.6, s) || member((dy + 1.0 + 6.6 * across) * 0.756, 0.3, s)) {
                return orange;
            }
        }
        if aw < GG_PLANE && s <= 1.6 {
            // Under the roadway a beam across at every panel, and at the lower chords a strut across with a brace.
            if line(u, GG_PANEL, 0.0, 0.5, s) && (dy <= -1.0 && dy > -2.6 || member(dy + 7.6, 0.3, s)) {
                return orange;
            }
            let t = (u / GG_PANEL).rem_euclid(2.0);
            let lean = if t < 1.0 { t } else { 2.0 - t };
            if s <= 0.8 && member(dy + 7.6, 0.3, s) && member((w + GG_PLANE - 2.0 * GG_PLANE * lean) * 0.268, 0.25, s) {
                return orange;
            }
        }
    }
    // ── What carries the roadway past the cables: the arch over Fort Point, the anchorages, the approach bents.
    let under = dy < -8.0;
    if u < 0.0 && a > 989.0 && a < 1079.0 && under {
        let x = (a - 1034.0) / 45.0;
        let rib = road - 8.6 - 27.0 * x * x;
        let steep = 2.0 * 27.0 * x / 45.0;
        if member(aw - 10.5, 0.75, s) && (member((y - rib + 1.5) / (1.0 + steep * steep).sqrt(), 1.5, s) || y > rib && line(a, GG_PANEL, 0.0, 0.6, s)) {
            return orange;
        }
        return 0;
    }
    let (block, last) = if u < 0.0 { (1091.0..1150.0, -GG_SOUTH) } else { (1056.0..1110.0, GG_NORTH) };
    if under && block.contains(&a) && aw <= 20.0 {
        return concrete;
    }
    if under && a >= block.end && a < last {
        // A bent every five panels: two legs, struts between them.
        if line(a, 5.0 * GG_PANEL, block.end + 19.0, 1.2, s) && (member(aw - 9.0, 0.6, s) || aw < 9.0 && s <= 0.8 && line(y, 12.0, 6.0, 0.6, s)) {
            return orange;
        }
    }
    0
}

// ── The Transamerica Pyramid (Pereira, 1972): 260 m. As Overture's parts have it (from OpenStreetMap): a foot
// 54.8 m square that draws in to 46.2 m at 30 m up, a four-sided pyramid from there to the point, and a slab 6.8 m
// thick through its middle to 215 m, which stands out of two faces from 124 m up as the wings (lifts in one,
// stairs in the other). The top 65 m is a spire of aluminium louvres; below it are 48 floors of white precast
// panels with a band of windows each; the foot is a colonnade of crossed struts. Floors, spire and colonnade are
// as remembered and by eye, not surveyed.
const TA_TOP: f32 = 260.0;
const TA_SPIRE: f32 = 195.0;
const TA_SKIRT: f32 = 30.0;
const TA_FLOOR: f32 = 3.84;

fn transamerica(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(0.0..TA_TOP).contains(&y) {
        return 0;
    }
    let white = kind(CONCRETE, WHITE);
    let half = if y < TA_SKIRT { 27.4 - 4.3 * y / TA_SKIRT } else { 23.1 * (TA_TOP - y) / (TA_TOP - TA_SKIRT) };
    let (au, aw) = (u.abs(), w.abs());
    let d = au.max(aw) - half;
    if d > 0.0 {
        // The wings: what of the slab through its middle stands out of the faces. A cell coarser than the slab holds it.
        return if (120.0..215.0).contains(&y) && au <= 3.4f32.max(s * 0.5) && aw <= 13.7 { white } else { 0 };
    }
    let skin = -(2.5 * s + 0.3);
    // Along the face a column is on: across it from its middle.
    let along = if au > aw { w } else { u };
    if y >= TA_SPIRE {
        // The spire: louvres of aluminium, a line of shadow between each near.
        return if d <= skin { kind(STEEL, grey(6)) } else if s <= 0.45 && line(y, 1.2, 0.0, 0.3, s) { kind(STEEL, grey(8)) } else { kind(STEEL, grey(2)) };
    }
    if y < TA_SKIRT {
        // The foot: struts that cross, leaning out to the ground, with the lobby's dark glass set back behind them.
        if s > 0.8 {
            return if d > -(s.max(1.6)) { kind(CONCRETE, grey(3)) } else { kind(CONCRETE, grey(8)) };
        }
        if d > -1.6f32.max(s) {
            let t = (along / 11.0).rem_euclid(1.0);
            let high = TA_SKIRT * (2.0 * t - 1.0).abs();
            return if member((y - high) * 0.18, 0.55, s) || member((y - (TA_SKIRT - high)) * 0.18, 0.55, s) || y > TA_SKIRT - 1.5f32.max(s) { white } else { 0 };
        }
        return if d > -4.0 { 0 } else if d > -4.0 - 0.6f32.max(s) { kind(GLASS, colour(15, 9)) } else { kind(CONCRETE, grey(8)) };
    }
    if d <= skin {
        return kind(CONCRETE, grey(8));
    }
    // A floor: a band of windows between panels, a post between windows. From far the band is a shade of the wall.
    let band = line(y - TA_SKIRT, TA_FLOOR, TA_FLOOR / 2.0, 1.7, s.min(1.6));
    if !band || along.abs() > half - 1.2 && s <= 0.8 {
        return white;
    }
    if s > 2.4 { kind(CONCRETE, grey(1)) } else if s > 1.0 { kind(CONCRETE, grey(4)) } else if s <= 0.25 && line(along, 1.5, 0.0, 0.25, s) { white } else { kind(GLASS, colour(15, 9)) }
}

// ── The Bay Bridge's western span (Purcell, 1936): two suspension bridges end to end, joined at an anchorage of
// concrete that stands in the middle of the water. Its frame: u from that middle anchorage towards Yerba Buena
// Island, y up from the water, w across. Where its four towers and the middle anchorage stand, and the towers'
// 160 m, are the map's (Overture, from OpenStreetMap: main spans of 704 m, 378.5 m each side of the middle anchorage);
// the shore anchorages are a side span of 354 m past the end towers, where the map has the island's. Two
// roadways, one over the other, in a truss 20 m wide; towers braced with crossed diagonals; all steel in a silver
// grey. The roadway's height (66 m), the cables' sag and the towers' bracing are as remembered and by eye from
// photographs, not surveyed. The approaches past the anchorages are not built.
const BB_WEST: f32 = -1436.4;
const BB_EAST: f32 = 1436.4;
const BB_PLANE: f32 = 10.1;
const BB_PANEL: f32 = 9.14;
const BB_ROAD: f32 = 66.0;
/// Each tower: where it stands along the bridge, and how high.
const BB_TOWERS: [(f32, f32); 4] = [(-1082.4, 160.0), (-378.5, 160.0), (378.5, 160.0), (1082.4, 160.0)];

/// How high a cable's middle is: hung between the towers' tops, and from each end tower and each inner tower down
/// to an anchorage a little over the roadway.
fn bb_cable(u: f32) -> Option<(f32, f32)> {
    let ends = [(BB_WEST, BB_ROAD + 3.0), (0.0, BB_ROAD + 9.0), (BB_EAST, BB_ROAD + 3.0)];
    let hung = |(u0, y0): (f32, f32), (u1, y1): (f32, f32), sag: f32| {
        let t = (u - u0) / (u1 - u0);
        (y0 + (y1 - y0) * t - 4.0 * sag * t * (1.0 - t), ((y1 - y0) - 4.0 * sag * (1.0 - 2.0 * t)) / (u1 - u0))
    };
    let top = |i: usize| (BB_TOWERS[i].0, BB_TOWERS[i].1 - 2.0);
    if !(BB_WEST..=BB_EAST).contains(&u) {
        None
    } else if u < BB_TOWERS[0].0 {
        Some(hung(ends[0], top(0), 9.0))
    } else if u < BB_TOWERS[1].0 {
        Some(hung(top(0), top(1), 81.0))
    } else if u < 0.0 {
        Some(hung(top(1), ends[1], 9.0))
    } else if u < BB_TOWERS[2].0 {
        Some(hung(ends[1], top(2), 9.0))
    } else if u < BB_TOWERS[3].0 {
        Some(hung(top(2), top(3), 81.0))
    } else {
        Some(hung(top(3), ends[2], 9.0))
    }
}

fn bay_bridge(u: f32, y: f32, w: f32, s: f32) -> Kind {
    let steel = kind(STEEL, grey(6));
    let concrete = kind(CONCRETE, grey(5));
    let aw = w.abs();
    if !(-30.0..162.0).contains(&y) || !(BB_WEST - 14.0..BB_EAST + 14.0).contains(&u) {
        return 0;
    }
    let dy = y - BB_ROAD;
    // ── The anchorages: the one in the middle of the water, a block of concrete to under the roadway with a house
    // for the cables' ends over it; and one at each shore.
    if u.abs() <= 14.0 && aw <= 24.0 && (dy < -9.0 || aw > 13.0 && dy < 12.0) {
        return concrete;
    }
    if (u - BB_WEST).abs().min((u - BB_EAST).abs()) <= 14.0 && aw <= 22.0 && dy < -9.0 {
        return concrete;
    }
    // ── A tower: a pier, two legs, struts and crossed braces between them.
    for (at, high) in BB_TOWERS {
        let du = u - at;
        if du.abs() > 22.0 {
            continue;
        }
        if y < 12.0 {
            let past = (aw - 12.0).max(0.0);
            return if du.abs() <= 9.0 && past * past + du * du <= 81.0 { concrete } else { 0 };
        }
        if y >= high {
            return 0;
        }
        let lw = aw - BB_PLANE;
        if lw.abs() <= 2.2f32.max(s * 0.5) && du.abs() <= 3.2f32.max(s * 0.5) {
            return steel;
        }
        let between = BB_PLANE - 2.2 - aw;
        if between > 0.0 && du.abs() <= 1.6f32.max(s * 0.5) {
            // Over the upper roadway a portal, then panels of crossed braces to a strut at the top; under the lower
            // roadway one tall panel.
            let (foot, head) = (BB_ROAD + 9.0, high - 4.0);
            let panels = ((head - foot) / 24.0).round().max(1.0);
            let tall = (head - foot) / panels;
            let wide = 2.0 * (BB_PLANE - 2.2);
            let square = |tall: f32| 1.0 / (1.0 + (tall / wide) * (tall / wide)).sqrt();
            let t = (w + wide / 2.0) / wide;
            if y >= foot && y < head {
                let up = (y - foot).rem_euclid(tall);
                if up < 2.0f32.max(s) || member((up - tall * t) * square(tall), 0.7, s) || member((up - tall * (1.0 - t)) * square(tall), 0.7, s) {
                    return steel;
                }
            }
            if y >= head {
                return steel;
            }
            let (foot, head) = (14.0, BB_ROAD - 12.0);
            if y >= foot && y < head && (member((y - foot - (head - foot) * t) * square(head - foot), 0.9, s) || member((y - head + (head - foot) * t) * square(head - foot), 0.9, s) || y < foot + 2.0) {
                return steel;
            }
        }
    }
    if aw > BB_PLANE + 1.0 + s {
        return 0;
    }
    // ── The cables and the hangers from them.
    if let Some((high, steep)) = bb_cable(u) {
        if member(aw - BB_PLANE, 0.37, s) && member((y - high) / (1.0 + steep * steep).sqrt(), 0.37, s) {
            return steel;
        }
        if s <= 0.8 && member(aw - BB_PLANE, 0.12, s) && y < high && dy > -1.0 && line(u, BB_PANEL, 0.0, 0.25, s) && BB_TOWERS.iter().all(|t| (u - t.0).abs() > 5.0) && u.abs() > 16.0 {
            return steel;
        }
    }
    if dy > 1.4 || dy < -9.2 - s * 0.5 || !(BB_WEST..BB_EAST).contains(&u) {
        return 0;
    }
    // ── Two roadways and the truss they ride in.
    for road in [0.0, -7.6] {
        let d = dy - road;
        if d <= 0.0 && d > -(0.8f32.max(s)) && aw <= BB_PLANE {
            return if d > -(0.3f32.max(s)) { kind(ASPHALT, OWN) } else { steel };
        }
    }
    if dy > 0.0 {
        let rail = (aw - BB_PLANE).abs() <= 0.15f32.max(s * 0.5) && dy <= 1.1f32.max(s);
        return if rail && s <= 1.0 { steel } else { 0 };
    }
    if member(aw - BB_PLANE, 0.45, s) {
        if member(dy + 0.6, 0.45, s) || member(dy + 8.4, 0.45, s) {
            return steel;
        }
        let panel = (u / BB_PANEL).floor();
        let t = u / BB_PANEL - panel;
        let across = if panel.rem_euclid(2.0) < 1.0 { t } else { 1.0 - t };
        if dy < -0.6 && dy > -8.4 && (line(u, BB_PANEL, 0.0, 0.5, s) || member((dy + 0.6 + 7.8 * across) * 0.76, 0.3, s)) {
            return steel;
        }
    }
    if aw < BB_PLANE && s <= 1.6 && line(u, BB_PANEL, 0.0, 0.5, s) && (dy <= -0.8 && dy > -2.0 || dy <= -8.4 && dy > -9.4) {
        return steel;
    }
    0
}

// ── Reusable multi-city architectural & landscape primitives (#60) ─────────────────────────────────────────

/// Semicircular/elliptical arch test: true inside the opening below the crown.
fn round_arch(x: f32, y: f32, half_span: f32, spring_y: f32, rise: f32) -> bool {
    if x.abs() >= half_span {
        return false;
    }
    let crown = spring_y + rise * (1.0 - (x / half_span).powi(2)).max(0.0).sqrt();
    y < crown
}

/// Traditional curved upturned pagoda roof tier (reusable for Asian pavilions, tea houses & pagodas).
#[allow(clippy::too_many_arguments)]
fn pagoda_tier(
    du: f32,
    dw: f32,
    dy: f32,
    half: f32,
    wall_h: f32,
    eave_out: f32,
    roof_h: f32,
    s: f32,
    wall: Kind,
    pillar: Kind,
    roof: Kind,
    trim: Kind,
) -> Kind {
    if dy < 0.0 || dy >= wall_h + roof_h + 0.5 {
        return 0;
    }
    let (au, aw) = (du.abs(), dw.abs());
    let m = au.max(aw);
    // Story body: corner vermilion pillars, inset pale shoji/plaster panels & subtle balustrade.
    if dy < wall_h {
        if m <= half {
            if (au > half - 0.55 || aw > half - 0.55) && (au > half - 0.85 && aw > half - 0.85 || dy < 0.35 || dy > wall_h - 0.45) {
                return pillar;
            }
            if m > half - 0.45f32.max(s) {
                return wall;
            }
            return pillar;
        }
        // Subtle perimeter gallery railing at floor level.
        if dy < 0.9 && m <= half + 0.7 && m >= half + 0.45 && (dy > 0.65 || line(du + dw, 0.8, 0.0, 0.2, s)) {
            return pillar;
        }
        return 0;
    }
    // Flared upturned hipped pagoda roof with sweeping concave eaves and upturned corner tips.
    let ry = dy - wall_h;
    let t = (ry / roof_h).clamp(0.0, 1.0);
    // Concave sweep: eaves flare sharply outward near the bottom and curl upward at the 4 diagonal corners.
    let corner_flare = ((au.min(aw) / (m + 0.01)).powi(2)) * 0.45 * (1.0 - t);
    let eave_half = half + eave_out * (1.0 - t).powf(1.35) + corner_flare;
    let curl = ((m - half).max(0.0) / eave_out.max(0.1)).powi(2) * 0.55 + corner_flare * 0.55;
    if m <= eave_half && ry >= curl - 0.45f32.max(s) && ry <= roof_h + 0.1 {
        let on_ridge = (au - aw).abs() < 0.38f32.max(s * 0.6) && m > half * 0.4;
        if on_ridge && ry > curl + 0.1 {
            return trim;
        }
        if ry < curl + 0.25 && m > half + 0.3 {
            return pillar; // red/timber underside eave brackets
        }
        return roof;
    }
    0
}

/// Naturalistic multi-cluster ornamental tree: cloud-pruned multi-pad crowns with visible forked branches & organic
/// airy openings (deciduous cherry blossom / Japanese maple / magnolia) or tiered conical conifer boughs (redwood/pine).
#[allow(clippy::too_many_arguments)]
fn ornamental_tree(
    du: f32,
    dy: f32,
    dw: f32,
    trunk_h: f32,
    crown_r: f32,
    crown_h: f32,
    seed: u32,
    s: f32,
    bark: Kind,
    canopy: Kind,
    accent: Kind,
) -> Kind {
    let r2 = du * du + dw * dw;
    if r2 > (crown_r + 2.2).powi(2) || dy < 0.0 || dy > trunk_h + crown_h + 1.5 {
        return 0;
    }
    let conifer = crown_h > crown_r * 1.65;
    let lean_u = (dy / trunk_h.max(1.0)) * (((seed % 5) as f32 - 2.0) * 0.14);
    let lean_w = (dy / trunk_h.max(1.0)) * ((((seed >> 3) % 5) as f32 - 2.0) * 0.14);
    let tr = (0.42 - 0.16 * (dy / (trunk_h + crown_h * 0.6).max(1.0))).max(0.18).max(s * 0.5);
    if dy < trunk_h + crown_h * (if conifer { 0.72 } else { 0.35 }) && (du - lean_u).powi(2) + (dw - lean_w).powi(2) <= tr * tr {
        return bark;
    }
    if conifer {
        // Tiered conical coastal redwood / Japanese black pine boughs tapering cleanly to a spire tip.
        let cy = dy - trunk_h * 0.65;
        let span = crown_h + trunk_h * 0.35;
        if cy < 0.0 || cy > span {
            return 0;
        }
        let t = (cy / span).clamp(0.0, 1.0);
        let tier = 0.76 + 0.34 * ((cy * 1.45).sin() * 0.5 + 0.5);
        let ang = dw.atan2(du);
        let bough = 0.82 + 0.24 * (ang * 5.0 + (cy * 0.8).floor() * 1.7 + seed as f32).sin();
        let rad = crown_r * (1.0 - t.powf(0.85)) * tier * bough;
        if r2 <= rad * rad {
            let h = hash3((du * 2.5) as i32, (dy * 2.5) as i32, (dw * 2.5) as i32, seed);
            let edge = r2 > (rad * 0.72).powi(2);
            if s <= 0.6 && (edge && h % 3 == 0 || h % 7 == 0) {
                return 0;
            }
            return if h % 3 == 0 { accent } else { canopy };
        }
        return 0;
    }
    // Layered cloud-pruned / spreading deciduous canopy: 4 organic offset horizontal clusters + airy openings!
    let clusters: [(f32, f32, f32, f32, f32); 4] = [
        (0.0, trunk_h + crown_h * 0.66, 0.0, crown_r * 0.76, crown_h * 0.36),
        (crown_r * 0.44, trunk_h + crown_h * 0.38, crown_r * 0.28, crown_r * 0.62, crown_h * 0.30),
        (-crown_r * 0.46, trunk_h + crown_h * 0.44, crown_r * 0.22, crown_r * 0.60, crown_h * 0.30),
        (crown_r * 0.06, trunk_h + crown_h * 0.32, -crown_r * 0.46, crown_r * 0.58, crown_h * 0.28),
    ];
    let rot = (seed as f32) * 1.13;
    let (cr, sr) = (rot.cos(), rot.sin());
    let ru = du * cr + dw * sr;
    let rw = -du * sr + dw * cr;
    // Forked main boughs reaching out toward the canopy pads.
    if dy >= trunk_h * 0.75 && dy <= trunk_h + crown_h * 0.42 {
        let bt = ((dy - trunk_h * 0.75) / (crown_h * 0.42 + trunk_h * 0.25)).clamp(0.0, 1.0);
        for &(cu, _, cw, _, _) in &clusters[1..] {
            if (ru - cu * bt).powi(2) + (rw - cw * bt).powi(2) <= (0.22f32.max(s * 0.5)).powi(2) {
                return bark;
            }
        }
    }
    let mut best = 2.0f32;
    for &(cu, cy, cw, rx, ry) in &clusters {
        let d = ((ru - cu) / rx).powi(2) + ((rw - cw) / rx).powi(2) + ((dy - cy) / ry).powi(2);
        if d < best {
            best = d;
        }
    }
    if best <= 1.05 {
        let h = hash3((du * 2.5) as i32, (dy * 2.5) as i32, (dw * 2.5) as i32, seed);
        let lump = hash3((du * 1.1) as i32, (dy * 1.4) as i32, (dw * 1.1) as i32, seed ^ 17);
        if s <= 0.6 && ((best > 0.62 && h % 3 == 0) || (best > 0.78 && lump % 2 == 0) || h % 8 == 0) {
            return 0;
        }
        return if h % 3 == 0 { accent } else { canopy };
    }
    0
}

/// Traditional carved granite Japanese stone lantern (`toro`) with glowing amber firebox.
fn stone_lantern(du: f32, dy: f32, dw: f32, s: f32) -> Kind {
    let m = du.abs().max(dw.abs());
    if m > 0.85 || !(0.0..=2.3).contains(&dy) {
        return 0;
    }
    let stone = kind(ROCK, grey(5));
    if dy < 0.35 && m <= 0.52 {
        return stone;
    }
    if (0.35..1.25).contains(&dy) && m <= 0.24f32.max(s * 0.5) {
        return stone;
    }
    if (1.25..1.72).contains(&dy) && m <= 0.36 {
        return if (1.35..1.62).contains(&dy) && (du.abs() < 0.2 || dw.abs() < 0.2) { kind(LAMP, colour(3, 0)) } else { stone };
    }
    let cap = 0.78 * (1.0 - ((dy - 1.72) / 0.58).clamp(0.0, 1.0)) + 0.12;
    if dy >= 1.72 && m <= cap {
        return stone;
    }
    0
}

/// Stepped arched wooden Moon/Drum footbridge spanning a koi pond or stream.
fn arched_bridge(u: f32, dy: f32, w: f32, half_span: f32, half_w: f32, arch_rise: f32, s: f32, deck: Kind, rail: Kind) -> Kind {
    if u.abs() > half_span + 0.6 || w.abs() > half_w + 0.4 || dy < -0.5 || dy > arch_rise + 1.6 {
        return 0;
    }
    let t = (u / half_span).clamp(-1.0, 1.0);
    let arch_y = arch_rise * (1.0 - t * t).max(0.0).sqrt();
    // Timber arch deck & wooden steps.
    if w.abs() <= half_w && dy <= arch_y && dy >= arch_y - 0.55f32.max(s) {
        return deck;
    }
    // Curved handrails & vertical balustrade posts along both sides of the bridge.
    if (w.abs() - (half_w - 0.14)).abs() <= 0.16f32.max(s * 0.5) && dy > arch_y && dy <= arch_y + 1.05 {
        if dy >= arch_y + 0.82 || (dy >= arch_y + 0.42 && dy <= arch_y + 0.54) || line(u, 1.1, 0.0, 0.18, s) {
            return rail;
        }
    }
    0
}

// ── Fort Point National Historic Site (1861, Third System brick coastal fort directly beneath the Golden Gate
// Bridge's south steel arch). Frame: u along the long seawall axis, w across, y up from base 1.8 m.
fn fort_point(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(-4.5..24.5).contains(&y) || u.abs() > 53.0 || w.abs() > 33.0 {
        return 0;
    }
    let granite = kind(ROCK, grey(7));
    let granite_trim = kind(CONCRETE, grey(4));
    let brick = kind(BRICK, colour(0, 4));
    let brick_dark = kind(BRICK, colour(1, 5));
    let white = kind(PLASTER, WHITE);
    // Granite seawall apron & foundation base (covers full historic footprint including bastion point).
    let in_bastion = u > 30.0 && ((u - 30.0) / 17.5).powi(2) + (w / 18.5).powi(2) <= 1.0;
    if y < 2.2 {
        return if (u.abs() <= 46.0 && w.abs() <= 27.5) || (u > 30.0 && ((u - 30.0) / 21.5).powi(2) + (w / 22.5).powi(2) <= 1.0) {
            granite
        } else {
            0
        };
    }
    // Iconic small white cast-iron Fort Point Lighthouse perched on the northwest barbette parapet.
    if y >= 15.8 && (u + 24.0).abs() <= 3.2 && (w + 15.0).abs() <= 3.2 {
        let lr = ((u + 24.0).powi(2) + (w + 15.0).powi(2)).sqrt();
        if y < 21.6 && lr <= 1.8 - (y - 15.8) * 0.08 {
            return white;
        }
        if (21.6..23.2).contains(&y) && lr <= 1.4 {
            return if lr > 0.9 { kind(GLASS, colour(14, 2)) } else { kind(LAMP, colour(3, 0)) };
        }
        if (23.2..24.4).contains(&y) && lr <= (1.6 - (y - 23.2) * 1.2).max(0.2) {
            return kind(STEEL, grey(12));
        }
        return 0;
    }
    // Main 3-tier red-brick masonry fort enclosure (74 x 44 m + rounded seaward bastion) around open parade courtyard.
    let in_rect = u >= -38.0 && u <= 34.0 && w.abs() <= 22.0;
    if (!in_rect && !in_bastion) || y > 17.5 {
        return 0;
    }
    let in_court = u >= -28.0 && u <= 24.0 && w.abs() < 12.5;
    if in_court {
        return if y < 2.8 { granite_trim } else { 0 };
    }
    // Rooftop barbette parapet wall & granite coping (15.8..17.5 m).
    if y >= 15.8 {
        let outer = if in_bastion {
            ((u - 30.0) / 17.5).powi(2) + (w / 18.5).powi(2) > 0.78
        } else {
            (u + 38.0).min(34.0 - u).min(22.0 - w.abs()) < 1.8
        };
        let inner = in_rect && (u.abs() - 25.0).min(w.abs() - 12.5).max(0.0) < 1.2;
        if outer || (inner && y < 16.9) {
            return if y > 17.0 { granite_trim } else { brick };
        }
        return if y < 16.2 { granite_trim } else { 0 };
    }
    // Granite stringcourse bands separating the 3 tiers of casemates.
    let tier_y = (y - 2.2).rem_euclid(4.5);
    if tier_y < 0.45 {
        return granite_trim;
    }
    let outer_face = if in_bastion {
        (1.0 - (((u - 30.0) / 17.5).powi(2) + (w / 18.5).powi(2)).sqrt()) * 17.5
    } else {
        (u + 38.0).min(34.0 - u).min(22.0 - w.abs())
    };
    let inner_u = (u + 28.0).min(24.0 - u);
    let inner_w = w.abs() - 12.5;
    let inner_face = if u >= -28.0 && u <= 24.0 {
        inner_w
    } else if w.abs() < 12.5 {
        (-28.0 - u).max(u - 24.0)
    } else {
        inner_u.abs().min(inner_w)
    };
    // Interior 3-tier arched brick casemate arcades facing the parade ground.
    if in_rect && inner_face >= 0.0 && inner_face < 2.2 && s <= 0.8 {
        let along = if w.abs() < 12.5 { w } else { u };
        let bay = (along + 2.4).rem_euclid(4.8) - 2.4;
        if round_arch(bay, tier_y, 1.55, 2.3, 1.4) && tier_y >= 0.45 {
            return if inner_face < 1.4 { 0 } else { brick_dark };
        }
    }
    // Exterior seaward gun-embrasure loopholes in rhythmic rows across all 3 tiers.
    if outer_face < 1.8 && s <= 0.8 {
        let along = if in_bastion { w.atan2(u - 30.0) * 18.0 } else if (u + 38.0).min(34.0 - u) < 22.0 - w.abs() { w } else { u };
        let bay = (along + 2.4).rem_euclid(4.8) - 2.4;
        if bay.abs() < 0.72 && (1.2..3.2).contains(&tier_y) {
            return if outer_face < 0.9 { 0 } else { kind(PLASTER, grey(13)) };
        }
    }
    if hash3((u * 1.4).floor() as i32, (y * 2.4).floor() as i32, (w * 1.4).floor() as i32, 41) % 7 == 0 { brick_dark } else { brick }
}

// California Academy of Sciences. In the DataSF footprint the canopy ends at w=36.2 m. The narrow path
// to w=66.2 belongs to the landscape. Its two outer corners on each end step in by about three metres.
fn academy_canopy(u: f32, w: f32) -> bool {
    u.abs() <= 80.5 && (-66.2..=36.3).contains(&w)
        && (u.abs() <= 77.5 || (-63.1..=33.1).contains(&w))
}

// Retained 0.25 m lidar from square 546.7_4179.5. Each entry is the median of a 2 m patch, in decimetres
// above the landmark datum. Rows start at w=-55, columns at u=-65, five metres apart (bay/roof_samples.py).
const ACADEMY_ROOF: [[u8; 27]; 17] = [
    [144, 142, 143, 141, 141, 142, 137, 142, 144, 144, 144, 144, 144, 144, 144, 144, 144, 144, 144, 140, 142, 143, 141, 141, 143, 142, 144],
    [147, 147, 154, 146, 146, 146, 146, 156, 147, 147, 150, 145, 145, 145, 145, 145, 147, 149, 147, 147, 147, 147, 147, 147, 147, 146, 147],
    [146, 148, 147, 149, 148, 148, 156, 157, 132, 156, 150, 151, 150, 150, 150, 151, 151, 149, 150, 149, 149, 149, 148, 148, 147, 147, 146],
    [176, 148, 148, 148, 148, 156, 156, 156, 207, 156, 155, 164, 159, 153, 156, 166, 157, 151, 151, 151, 150, 150, 149, 148, 148, 147, 146],
    [145, 148, 149, 149, 151, 153, 152, 153, 154, 152, 160, 174, 166, 152, 160, 175, 165, 154, 153, 152, 152, 151, 150, 149, 148, 148, 147],
    [144, 149, 149, 150, 151, 153, 161, 168, 166, 160, 156, 153, 145, 138, 142, 150, 155, 157, 165, 168, 163, 154, 150, 149, 149, 148, 147],
    [144, 149, 149, 149, 152, 163, 188, 201, 197, 176, 153, 134, 141, 146, 143, 131, 148, 171, 195, 202, 192, 168, 153, 149, 149, 148, 147],
    [144, 149, 148, 149, 153, 175, 206, 220, 216, 193, 154, 126, 144, 151, 147, 122, 147, 187, 213, 220, 211, 183, 157, 149, 149, 149, 147],
    [145, 148, 149, 150, 153, 176, 207, 221, 218, 194, 156, 125, 145, 151, 147, 123, 147, 187, 214, 221, 211, 185, 157, 149, 149, 148, 147],
    [145, 149, 150, 150, 151, 163, 188, 202, 199, 178, 154, 133, 140, 150, 142, 129, 150, 171, 196, 203, 193, 170, 153, 149, 148, 148, 147],
    [145, 149, 149, 150, 151, 152, 161, 170, 168, 159, 153, 148, 141, 140, 140, 143, 153, 158, 165, 169, 163, 155, 151, 149, 148, 148, 147],
    [145, 148, 149, 149, 149, 150, 152, 153, 155, 155, 154, 156, 164, 173, 167, 157, 154, 155, 156, 153, 152, 152, 150, 149, 149, 148, 147],
    [147, 148, 148, 148, 150, 150, 151, 152, 162, 169, 158, 161, 186, 201, 191, 167, 156, 167, 168, 153, 150, 150, 150, 149, 148, 148, 146],
    [146, 148, 148, 148, 149, 149, 149, 160, 165, 174, 158, 162, 190, 203, 195, 170, 156, 172, 171, 154, 150, 149, 149, 148, 149, 148, 146],
    [149, 149, 147, 147, 149, 148, 149, 149, 153, 155, 152, 155, 171, 185, 175, 158, 152, 154, 154, 150, 148, 148, 149, 148, 147, 147, 146],
    [147, 147, 147, 148, 147, 147, 147, 147, 148, 148, 149, 149, 153, 157, 155, 151, 149, 149, 149, 148, 148, 148, 147, 147, 147, 147, 146],
    [150, 146, 147, 149, 148, 146, 146, 146, 147, 149, 148, 148, 148, 148, 149, 150, 148, 150, 147, 147, 146, 146, 146, 146, 145, 145, 145],
];

fn academy_roof_height(u: f32, w: f32) -> f32 {
    let col = ((u + 65.0) / 5.0).clamp(0.0, 26.0);
    let row = ((w + 55.0) / 5.0).clamp(0.0, 16.0);
    let (i, j) = ((col as usize).min(25), (row as usize).min(15));
    let across = |r: usize| {
        let a = f32::from(ACADEMY_ROOF[r][i]);
        a + (f32::from(ACADEMY_ROOF[r][i + 1]) - a) * (col - i as f32)
    };
    let a = across(j);
    (a + (across(j + 1) - a) * (row - j as f32)) * 0.1
}

fn academy_sciences(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(-6.5..24.0).contains(&y) || !academy_canopy(u, w) { return 0; }
    let concrete = kind(CONCRETE, grey(3));
    let white_steel = kind(STEEL, grey(2));
    let dark_steel = kind(STEEL, grey(12));
    let clear_glass = kind(GLASS, colour(13, 7));
    // The registry origin lies about 15 m off the centre of the rectangular roof.
    let (au, aw) = (u.abs(), (w + 15.0).abs());
    let overhang = au > 70.0 || aw > 41.0;
    if y < 0.0 { return if overhang { 0 } else { concrete }; }
    let in_piazza = (u + 0.5).abs() < 10.8 && (w + 19.0).abs() < 14.4;
    if overhang && y >= 13.9 {
        if y > 14.55 { return 0; }
        let rib = line(u, 4.8, 0.0, 0.22, s) || line(w, 4.8, 0.0, 0.22, s);
        return if au > 79.4 || aw > 50.1 || rib { white_steel } else { kind(GLASS, colour(14, 7)) };
    }
    if !overhang && y >= 10.0 {
        let top = academy_roof_height(u, w);
        if y > top { return 0; }
        if in_piazza {
            if y < top - s.max(0.4) { return 0; }
            let rib = line(u + w, 4.0, 0.0, 0.18, s) || line(u - w, 4.0, 0.0, 0.18, s);
            return if rib { white_steel } else { clear_glass };
        }
        if y >= top - 0.7f32.max(s) {
            // The aerial shows a broad field of skylights on the rainforest dome and a small cluster on the
            // other dome. Both flank the glazing over the piazza. Their individual positions are approximate.
            let (du, dw, radius) = if u < 0.0 { (u + 30.0, w + 18.0, 12.0) } else { (u - 28.0, w + 19.0, 3.7) };
            if du * du + dw * dw <= radius * radius {
                let row = (dw / 2.6).round();
                let dx = (du - row.rem_euclid(2.0) * 1.3 + 1.3).rem_euclid(2.6) - 1.3;
                let d = dx.hypot(dw - row * 2.6);
                if d < 0.68 { return kind(GLASS, colour(14, 8)); }
                if d < 0.86 { return white_steel; }
            }
            let patch = hash3((u / 3.0).floor() as i32, 0, (w / 3.0).floor() as i32, 37);
            return kind(GRASS, if patch % 5 == 0 { colour(5, 8) } else { colour(6, 8) });
        }
        if y >= 13.0 { return concrete; }
    }
    // ── Slender white perimeter canopy support columns along the Music Concourse & garden porticos.
    if overhang {
        if ((aw - 48.0).abs() < 0.45 && au <= 75.0 && line(u, 10.0, 0.0, 0.55, s))
            || ((au - 77.5).abs() < 0.45 && aw <= 48.0 && line(w, 10.0, 0.0, 0.55, s))
        {
            return white_steel;
        }
        return 0;
    }
    // ── Main museum volume (140 x 82 m): board-formed concrete corner pavilions + 11.4 m sheer glazed halls.
    if in_piazza {
        return if y < 0.4 { kind(CONCRETE, colour(3, 0)) } else { 0 };
    }
    let face = (70.0 - au).min(41.0 - aw);
    // Board-formed architectural concrete corner anchor blocks.
    let corner_mass = au > 54.0 && aw > 29.0;
    if corner_mass {
        if face < 1.2 && (y - 5.8).abs() < 0.3 {
            return dark_steel;
        }
        return concrete;
    }
    // Sheer floor-to-ceiling clear glass curtain wall with slim vertical steel mullions & subtle interior floors.
    if face <= 0.9f32.max(s) {
        let along = if 70.0 - au < 41.0 - aw { w } else { u };
        let mullion = s <= 0.6 && (line(along, 2.6, 0.0, 0.18, s) || line(y, 3.8, 0.0, 0.2, s));
        return if mullion { dark_steel } else { clear_glass };
    }
    // Warm interior exhibit floors & planetarium/rainforest drums glimpsed through the glass walls.
    let floor_slab = (y - 0.2).rem_euclid(5.4) < 0.45;
    if floor_slab || ((u + 26.0).powi(2) + (w + 18.0).powi(2) < 18.0 * 18.0) {
        return concrete;
    }
    if (u - 26.0).powi(2) + (w + 19.0).powi(2) < 16.5 * 16.5 && y > 1.0 && y < 10.0 {
        let h = hash3((u * 1.5) as i32, (y * 1.5) as i32, (w * 1.5) as i32, 71);
        if h % 3 == 0 {
            return kind(LEAVES, colour(8, 5)); // rainforest dome greenery visible inside glass!
        }
    }
    0
}

// ── The two Golden Gate Park gardens (#60) are sited from OpenStreetMap (© OpenStreetMap contributors, ODbL), read
// 2026-11-26 with api.openstreetmap.org/api/0.6/map.json?bbox=-122.4725,37.7660,-122.4640,37.7715. Each point below
// is an OSM way's vertex in the landmark's own frame (u east, w south, metres from its `at` in sf/heroes.json); the
// way id is beside it, so a point can be checked against https://www.openstreetmap.org/way/<id>. A mapped building
// the rule does not draw itself is kept: the rule neither owns nor adds to its cells, so the map's own stays.

/// Whether (u, w) is inside a closed outline of points (even-odd rule).
fn inside(outline: &[(f32, f32)], u: f32, w: f32) -> bool {
    let mut odd = false;
    let mut j = outline.len() - 1;
    for i in 0..outline.len() {
        let ((ui, wi), (uj, wj)) = (outline[i], outline[j]);
        if (wi > w) != (wj > w) && u < (uj - ui) * (w - wi) / (wj - wi) + ui {
            odd = !odd;
        }
        j = i;
    }
    odd
}

/// How far (u, w) is from the nearest edge of an outline.
fn edge_distance(outline: &[(f32, f32)], u: f32, w: f32) -> f32 {
    let mut best = f32::MAX;
    for i in 0..outline.len() {
        let (a, b) = (outline[i], outline[(i + 1) % outline.len()]);
        best = best.min(segment_distance(a, b, u, w));
    }
    best
}

fn segment_distance(a: (f32, f32), b: (f32, f32), u: f32, w: f32) -> f32 {
    let (du, dw) = (b.0 - a.0, b.1 - a.1);
    let t = (((u - a.0) * du + (w - a.1) * dw) / (du * du + dw * dw).max(1e-6)).clamp(0.0, 1.0);
    ((u - a.0 - t * du).powi(2) + (w - a.1 - t * dw).powi(2)).sqrt()
}

/// (u, w) turned into a mapped footprint's own axes: about its middle (cu, cw), by `degrees` from the frame's u.
fn turned(u: f32, w: f32, cu: f32, cw: f32, degrees: f32) -> (f32, f32) {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let (du, dw) = (u - cu, w - cw);
    (du * cos + dw * sin, -du * sin + dw * cos)
}

// ── Japanese Tea Garden (1894, Makoto Hagiwara). Frame from sf/heroes.json: `at` 37.770194, -122.470198, u east.
/// The garden's fence, way 30900516: a rotated quadrilateral, not a square. Only inside it is the place the rule's.
pub(crate) const TEA_OUTLINE: [(f32, f32); 10] = [
    (86.7, -35.2), (30.2, 53.9), (-9.5, 57.1), (-25.4, 56.6), (-30.0, 54.0),
    (-56.8, 17.6), (-61.0, 4.4), (-55.5, -26.4), (6.5, -75.5), (26.3, -90.2),
];
/// Gravel stipple and the two unhatched islands in Rec & Park's Project Location plan (p. 4, no. 59).
/// Registered on the Pagoda, Temple Gate, Tea House, Main Gate and the two bridges. At a page width of
/// 1440 px, (u,w) = (-95.906,-5.202) + x*(0.10608,-0.08409) + y*(0.08409,0.10608); RMS 0.63 m.
const TEA_DRY_GRAVEL: [(f32, f32); 18] = [
    (-51.3, -0.1), (-51.7, -2.3), (-50.6, -4.8), (-45.4, -10.8), (-43.9, -13.4), (-42.5, -14.2),
    (-41.3, -13.5), (-41.0, -12.5), (-41.6, -10.7), (-42.3, -8.9), (-43.7, -3.7), (-44.5, -2.2),
    (-45.9, -0.1), (-46.6, 0.5), (-47.4, 1.0), (-48.6, 1.2), (-49.7, 1.0), (-50.8, 0.4),
];
const TEA_DRY_ISLAND: [(f32, f32); 7] = [
    (-45.4, -5.9), (-45.2, -7.3), (-44.7, -7.8), (-44.3, -7.7), (-44.1, -7.4), (-44.2, -7.0), (-45.0, -5.7),
];
const TEA_DRY_STONE: [(f32, f32); 6] = [
    (-45.2, -9.7), (-45.2, -10.0), (-45.0, -10.2), (-44.6, -10.1), (-44.5, -9.7), (-44.7, -9.6),
];
/// The pond, way 409163924 (natural=water), south of the middle.
pub(crate) const TEA_POND: [(f32, f32); 24] = [
    (10.1, 17.2), (14.2, 9.3), (16.4, 12.2), (19.8, 18.0), (20.6, 21.6), (23.4, 24.9), (27.5, 27.8), (30.8, 31.1),
    (29.0, 34.7), (25.0, 39.8), (24.3, 43.1), (21.5, 46.6), (18.2, 43.4), (13.1, 41.0), (8.1, 40.3), (4.5, 40.8),
    (-1.3, 42.3), (-1.6, 39.1), (2.1, 35.8), (6.3, 34.8), (13.6, 34.9), (15.8, 32.6), (14.8, 28.3), (11.2, 22.3),
];
/// The Japanese Pagoda, way 34221099: an 8.2 m square turned 21.5 degrees, its middle at (-17.8, 9.2).
pub(crate) const TEA_PAGODA: (f32, f32, f32, f32) = (-17.8, 9.2, 21.5, 4.1);
/// The Tea House, way 34220947: an 8.1 m square turned 45 degrees, its middle at (33.2, -21.9).
pub(crate) const TEA_HOUSE: (f32, f32, f32, f32) = (33.2, -21.9, 45.0, 4.05);
/// The Main Gate, way 494967002 and node 392430963 (barrier=toll_booth, "Main Gate"), on the east side.
pub(crate) const TEA_GATE: (f32, f32, f32) = (57.5, -3.9, 45.0);
/// The Drum Bridge, way 136898969: a 6.4 m footway from (29.9, 6.1) to (31.6, -0.1), running north and south.
pub(crate) const TEA_DRUM_BRIDGE: ((f32, f32), (f32, f32)) = ((29.9, 6.1), (31.6, -0.1));
/// The wooden footbridge, way 34218824 (bridge=yes, surface=wood), 19 m from (10.2, -13.3) to (-2.6, 1.2).
pub(crate) const TEA_FOOTBRIDGE: ((f32, f32), (f32, f32)) = ((10.2, -13.3), (-2.6, 1.2));
/// Mapped buildings the rule does not draw, so the map keeps them: the Gift Shop (way 34220963), the Temple Gate
/// (way 136888944) and an unnamed building (way 931569317).
const TEA_KEPT: [&[(f32, f32)]; 3] = [
    &[(31.1, -37.1), (35.8, -41.1), (39.1, -37.1), (34.3, -33.2)],
    &[(-13.2, 26.3), (-10.2, 27.6), (-7.1, 28.9), (-5.0, 24.2), (-8.2, 22.8), (-11.1, 21.5)],
    &[(-50.1, -18.1), (-46.0, -15.5), (-42.5, -20.9), (-46.7, -23.6)],
];

/// Whether (u, w) is the Tea Garden's to say: inside its fence and not a building the map keeps.
pub(crate) fn tea_garden_place(u: f32, w: f32) -> bool {
    u.abs() <= 64.0 && w.abs() <= 64.0 && inside(&TEA_OUTLINE, u, w) && !TEA_KEPT.iter().any(|k| inside(k, u, w))
}

/// Water under a bridge. OSM maps no water under either bridge, but a bridge=yes footway crosses something: the
/// water here is inferred, kept to a pool 3.5 m round under the Drum Bridge and a channel 2.5 m either side of the
/// footbridge's middle two thirds.
fn tea_bridge_water(u: f32, w: f32) -> bool {
    let (a, b) = TEA_DRUM_BRIDGE;
    let drum = ((u - (a.0 + b.0) / 2.0).powi(2) + (w - (a.1 + b.1) / 2.0).powi(2)).sqrt() < 3.5;
    let (a, b) = TEA_FOOTBRIDGE;
    let (du, dw) = (b.0 - a.0, b.1 - a.1);
    let t = ((u - a.0) * du + (w - a.1) * dw) / (du * du + dw * dw);
    drum || ((0.17..=0.83).contains(&t) && segment_distance(a, b, u, w) < 2.5)
}

fn tea_garden_surface(u: f32, w: f32, s: f32) -> Option<Kind> {
    if !tea_garden_place(u, w) {
        return None;
    }
    if inside(&TEA_POND, u, w) || tea_bridge_water(u, w) {
        // Floating emerald lily pads & bright orange/white koi flecks on shimmering water!
        let h = hash3((u * 1.8) as i32, 0, (w * 1.8) as i32, 53);
        if h % 29 == 0 {
            return Some(kind(LEAVES, colour(8, 5)));
        }
        if h % 97 == 1 {
            return Some(kind(PLASTER, colour(1, 4))); // bright orange koi carp
        }
        return Some(kind(WATER, colour(12, 5)));
    }
    if edge_distance(&TEA_POND, u, w) < 0.9 {
        return Some(kind(ROCK, grey(8))); // natural moss-stone pond rim
    }
    if (-52.0..=-41.0).contains(&u) && inside(&TEA_DRY_GRAVEL, u, w) {
        // Rake grooves in the operator's photo are finer than the cells. Average the gravel at distance.
        let grain = s <= 0.2 && hash3((u * 10.0).floor() as i32, 0, (w * 10.0).floor() as i32, 53) % 4 == 0;
        return Some(kind(SAND, grey(if grain { 5 } else { 4 })));
    }
    // Winding warm gravel & flagstone paths from the Main Gate west past the Drum Bridge and Pagoda.
    let main_path = (w + 2.0 + 7.0 * (u * 0.055).sin()).abs() < 2.2 && (-36.0..=56.0).contains(&u);
    let cross_path = (u - 4.0 - 5.0 * (w * 0.06).cos()).abs() < 2.1 && (-32.0..=42.0).contains(&w);
    if main_path || cross_path {
        let paver = hash3((u * 1.5) as i32, 1, (w * 1.5) as i32, 17) % 5 == 0;
        return Some(if paver { kind(ROCK, grey(6)) } else { kind(SAND, colour(3, 1)) });
    }
    let h = hash3((u * 2.6).floor() as i32, 2, (w * 2.6).floor() as i32, 91);
    Some(kind(GRASS, if h % 5 == 0 { colour(8, 5) } else { colour(8, 6) }))
}

fn japanese_tea_garden(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(0.0..25.0).contains(&y) || !tea_garden_place(u, w) {
        return 0;
    }
    let vermilion = kind(WOOD, colour(0, 4));
    let dark_timber = kind(WOOD, colour(2, 9));
    let dark_tile = kind(ROOFING, grey(12));
    let shoji = kind(PLASTER, colour(3, 0));
    let warm_shoji = kind(LAMP, colour(3, 0));
    let gold = kind(STEEL, colour(3, 3));
    let stone = kind(ROCK, grey(7));

    // 1. The five-storey vermilion Pagoda, on its mapped 8.2 m footprint (eaves included), turned as mapped. Its tiers
    // were drawn for a 5.6 m half-width; they are drawn in a frame scaled to the mapped 4.1 m.
    let (cu, cw, turn, half) = TEA_PAGODA;
    let scale = 5.6 / half;
    let (pu, pw) = turned(u, w, cu, cw, turn);
    let (pu, pw) = (pu * scale, pw * scale);
    if pu.abs() <= 7.0 && pw.abs() <= 7.0 && y < 22.0 {
        if y < 1.1 && pu.abs() <= 4.8 && pw.abs() <= 4.8 {
            return stone;
        }
        let tiers: [(f32, f32, f32, f32); 5] = [
            (1.1, 3.6, 2.4, 2.0),
            (4.7, 3.1, 2.2, 1.8),
            (8.0, 2.6, 2.0, 1.6),
            (11.0, 2.2, 1.8, 1.4),
            (13.7, 1.8, 1.7, 1.5),
        ];
        for &(base_y, half, wall_h, eave_out) in &tiers {
            let roof_h = 1.65;
            if y >= base_y && y < base_y + wall_h + roof_h + 0.4 {
                let k = pagoda_tier(pu, pw, y - base_y, half, wall_h, eave_out, roof_h, s * scale, shoji, vermilion, dark_tile, gold);
                if k != 0 {
                    return k;
                }
            }
        }
        // Tall bronze sorin spire crowning the 5th tier.
        if (16.8..21.2).contains(&y) && (pu * pu + pw * pw).sqrt() / scale <= (0.42 - (y - 16.8) * 0.06).max(0.14).max(s * 0.5) {
            return gold;
        }
    }

    // 2. The arched wooden Drum Bridge on its mapped line, its span running north and south.
    let (a, b) = TEA_DRUM_BRIDGE;
    let (bu, bw) = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
    let k_bridge = arched_bridge(w - bw, y, u - bu, 3.4, 1.0, 2.4, s, kind(WOOD, colour(1, 4)), dark_timber);
    if k_bridge != 0 {
        return k_bridge;
    }
    // The flat wooden footbridge (way 34218824): a deck 0.5 m over the water with low rails.
    let (a, b) = TEA_FOOTBRIDGE;
    let (du, dw) = (b.0 - a.0, b.1 - a.1);
    let t = ((u - a.0) * du + (w - a.1) * dw) / (du * du + dw * dw);
    let off = segment_distance(a, b, u, w);
    if (0.0..=1.0).contains(&t) && off <= 1.0f32.max(s * 0.5) && y < 1.5 {
        if y < 0.6 {
            return kind(WOOD, colour(2, 6));
        }
        if (off - 0.9).abs() <= 0.15f32.max(s * 0.5) && y < 1.4 {
            return dark_timber;
        }
    }

    // 3. The Tea House on its mapped 8.1 m footprint, turned 45 degrees: a low timber room under one wide roof.
    let (cu, cw, turn, half) = TEA_HOUSE;
    let (tu, tw) = turned(u, w, cu, cw, turn);
    if tu.abs() <= half + 0.2 && tw.abs() <= half + 0.2 && y < 6.5 {
        if y < 0.6 {
            if tu.abs() <= half - 0.4 && tw.abs() <= half - 0.4 {
                return dark_timber; // timber veranda deck
            }
        } else {
            let k = pagoda_tier(tu, tw, y - 0.6, half - 1.3, 2.6, 1.3, 2.2, s, warm_shoji, dark_timber, dark_tile, gold);
            if k != 0 {
                return k;
            }
        }
    }

    // 4. The Main Gate on the east side, turned as its mapped building; drawn 0.7 of its first size to fit it.
    let (cu, cw, turn) = TEA_GATE;
    let (gu, gw) = turned(u, w, cu, cw, turn);
    let (gu, gw) = (gu / 0.7, gw / 0.7);
    if gu.abs() <= 7.0 && gw.abs() <= 10.5 && y < 9.5 {
        // Open arched/trabeated central portal between massive carved timber gateposts.
        if y < 4.2 {
            let post = (gu.abs() - 2.4).abs() < 0.55 && ((gw.abs() - 3.6).abs() < 0.55 || (gw.abs() - 6.8).abs() < 0.55);
            let wing_wall = gu.abs() <= 2.4 && gw.abs() >= 3.8 && gw.abs() <= 6.8 && y < 3.4;
            if post {
                return vermilion;
            }
            if wing_wall {
                return if y > 2.8 { dark_timber } else { shoji };
            }
        } else {
            // Sweeping dark tiled double-eave gate roof.
            let ry = y - 4.2;
            let roof_h = 3.8;
            if ry <= roof_h {
                let t = (ry / roof_h).clamp(0.0, 1.0);
                let hu = 4.6 * (1.0 - t * 0.88);
                let hw = 8.8 * (1.0 - t * 0.25);
                if gu.abs() <= hu && gw.abs() <= hw {
                    return if ry > roof_h - 0.45 { gold } else if ry < 0.4 { vermilion } else { dark_tile };
                }
            }
        }
    }

    // The photo guides the low moss and exposed stone. The plan fixes their footprints only.
    if y < 0.4 && (-45.4..=-44.1).contains(&u) {
        if inside(&TEA_DRY_ISLAND, u, w) && y < (edge_distance(&TEA_DRY_ISLAND, u, w) * 0.8).min(0.32) {
            return kind(GRASS, colour(5, 9));
        }
        if inside(&TEA_DRY_STONE, u, w) && y < (edge_distance(&TEA_DRY_STONE, u, w) * 1.4).min(0.38) {
            return kind(ROCK, grey(8));
        }
    }

    // 6. Carved granite stone lanterns; the first is the mapped Peace Lantern (node 4110675669), the rest unchecked.
    for &(lu, lw) in &[(-33.0f32, 9.0f32), (13.0, 7.0), (-4.0, 4.0), (26.0, -5.0), (2.0, 28.0)] {
        let kl = stone_lantern(u - lu, y, w - lw, s);
        if kl != 0 {
            return kl;
        }
    }

    // 7. Blossoming Pink Sakura Cherry Trees, Crimson Japanese Maples & Sculpted Black Pines (places unchecked; the
    // two that stood in the Tea House and the Gift Shop are gone).
    let sakura_a = kind(LEAVES, colour(22, 1));
    let sakura_b = kind(LEAVES, WHITE);
    let maple_a = kind(LEAVES, colour(0, 5));
    let maple_b = kind(LEAVES, colour(23, 4));
    let pine_a = kind(LEAVES, colour(9, 6));
    let pine_b = kind(LEAVES, colour(8, 5));
    let trees: [(f32, f32, f32, f32, f32, u32, u8); 16] = [
        // (u, w, trunk_h, crown_r, crown_h, seed, species: 0=sakura, 1=maple, 2=pine)
        (-3.0, -20.0, 3.2, 5.4, 4.5, 11, 0),
        (22.0, -16.0, 3.0, 5.2, 4.4, 17, 0),
        (19.0, 24.0, 2.8, 5.0, 4.2, 23, 0),
        (-34.0, -18.0, 3.4, 5.6, 4.8, 29, 0),
        (36.0, 14.0, 3.0, 4.8, 4.2, 31, 0),
        (-28.0, 4.0, 2.4, 4.2, 3.6, 37, 1),
        (12.0, -4.0, 2.2, 3.8, 3.4, 41, 1),
        (-4.0, 36.0, 2.6, 4.5, 3.8, 43, 1),
        (-44.0, -34.0, 5.0, 5.8, 6.2, 53, 2),
        (46.0, -30.0, 4.8, 5.5, 6.0, 59, 2),
        (46.0, 32.0, 5.2, 6.0, 6.5, 61, 2),
        (-48.0, 44.0, 4.6, 5.4, 5.8, 67, 2),
        (10.0, -42.0, 5.0, 6.2, 6.2, 71, 2),
        (-22.0, -44.0, 4.5, 5.5, 5.5, 73, 0),
        (24.0, 44.0, 4.2, 5.2, 5.0, 79, 1),
        (-52.5, -4.0, 4.5, 5.4, 5.4, 83, 2), // Trunk on the planted margin; NAIP shows canopy over the bed.
    ];
    for &(tu, tw, th, cr, ch, seed, sp) in &trees {
        let (ca, cb) = match sp {
            0 => (sakura_a, sakura_b),
            1 => (maple_a, maple_b),
            _ => (pine_a, pine_b),
        };
        let kt = ornamental_tree(u - tu, y, w - tw, th, cr, ch, seed, s, dark_timber, ca, cb);
        if kt != 0 {
            return kt;
        }
    }
    0
}

// ── San Francisco Botanical Garden. Frame from sf/heroes.json: `at` 37.7672, -122.4679 (the Great Meadow, way
// 476290501, landuse=grass), u east. The main entrance, fountain court and flowerbeds lie in this reach.
// The surrounding ponds and their islands are terrain in both views (bay/sf-garden-water.json).
/// The fountain, way 1036243321, in the fine-gravel court of way 1064976638 (about 7.5 m round its middle).
pub(crate) const BOTANICAL_FOUNTAIN: (f32, f32) = (26.2, 21.3);
/// Flowerbeds, as (middle u, middle w, half u, half w): ways 1072073350, 1063385914 (Rock Garden Circle), 1072073345.
const BOTANICAL_BEDS: [(f32, f32, f32, f32, u8, u8); 3] = [
    (53.1, -10.6, 4.3, 5.2, colour(21, 4), colour(22, 2)),
    (35.6, 2.3, 3.4, 3.4, colour(3, 4), colour(1, 4)),
    (65.1, -34.2, 9.9, 8.8, colour(16, 3), colour(18, 2)),
];
/// Mapped buildings the rule leaves to the map: the County Fair Building (way 25822470, which holds the Helen
/// Crocker Russell Library), the toilets (way 402054690), the bookstore (way 941355659) and the ticket kiosk at the
/// main gate (way 839987588).
pub(crate) const BOTANICAL_KEPT: [&[(f32, f32)]; 4] = [
    &[
        (61.4, 105.8), (60.1, 109.5), (94.1, 121.1), (99.3, 106.0), (100.3, 103.2), (82.1, 96.9), (79.7, 96.1),
        (85.0, 80.6), (77.5, 78.1), (66.1, 74.1), (70.8, 60.4), (81.2, 30.4), (73.8, 27.8), (72.9, 30.5),
        (62.9, 27.0), (64.1, 23.3), (57.3, 21.0), (51.2, 38.6), (41.5, 35.3), (41.9, 34.4), (42.2, 33.5),
        (43.8, 34.0), (49.3, 17.8), (36.8, 13.6), (34.2, 21.1), (33.3, 20.8), (31.5, 26.0), (32.4, 26.3),
        (31.2, 29.7), (32.6, 30.2), (29.3, 40.0), (39.1, 43.3), (39.5, 42.2), (48.8, 45.4), (35.7, 83.5),
        (41.7, 85.6), (42.9, 82.3), (49.9, 84.7), (44.7, 100.1),
    ],
    &[(-45.0, 40.3), (-37.0, 41.2), (-37.3, 44.4), (-45.4, 43.5)],
    &[(73.2, 5.3), (74.8, 0.6), (81.8, 2.8), (80.3, 7.6)],
    &[(42.5, -6.2), (41.3, -2.1), (44.4, -1.2), (45.6, -5.3)],
];

/// Whether (u, w) is the Botanical Garden's to say: in its box and not a building the map keeps.
pub(crate) fn botanical_place(u: f32, w: f32) -> bool {
    u.abs() <= 76.0 && w.abs() <= 56.0 && !BOTANICAL_KEPT.iter().any(|k| inside(k, u, w))
}

fn botanical_surface(u: f32, w: f32, _s: f32) -> Option<Kind> {
    if !botanical_place(u, w) {
        return None;
    }
    let (fu, fw) = BOTANICAL_FOUNTAIN;
    let fp_r = ((u - fu).powi(2) + (w - fw).powi(2)).sqrt();
    if fp_r < 1.1 {
        return Some(kind(WATER, colour(13, 3))); // the fountain's pool
    }
    if fp_r < 7.5 {
        return Some(kind(SAND, colour(3, 1))); // the fine-gravel court round it
    }
    // A decomposed-granite walk west from the main gate (node 7838519208) across the meadow. Its line is unchecked.
    let walk_ew = (w + 2.0 - 8.0 * (u * 0.045).sin()).abs() < 2.6 && u < 46.0;
    if walk_ew {
        return Some(kind(SAND, colour(3, 1)));
    }
    for &(bu, bw, ru, rw, c1, c2) in &BOTANICAL_BEDS {
        let d = ((u - bu) / ru).powi(2) + ((w - bw) / rw).powi(2);
        if d < 1.0 {
            let h = hash3((u * 2.5) as i32, 3, (w * 2.5) as i32, 47);
            return Some(match h % 5 {
                0 => kind(LEAVES, c1),
                1 => kind(LEAVES, c2),
                2 => kind(LEAVES, WHITE),
                _ => kind(GRASS, colour(8, 5)),
            });
        }
    }
    // Great Meadow turf (feathered into Golden Gate Park's own grass at the perimeter).
    if u.abs() > 62.0 || w.abs() > 44.0 {
        return None;
    }
    let h = hash3((u * 0.8) as i32, 1, (w * 0.8) as i32, 13);
    Some(kind(GRASS, if h % 3 == 0 { colour(7, 5) } else { colour(7, 8) }))
}

fn botanical_garden(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(0.0..25.0).contains(&y) || !botanical_place(u, w) {
        return 0;
    }
    let dark_wood = kind(WOOD, colour(2, 9));
    let stone = kind(CONCRETE, colour(3, 0));

    // 1. The fountain: a low stone basin round its pool, a column and a jet.
    let (fu, fw) = BOTANICAL_FOUNTAIN;
    let fp_r = ((u - fu).powi(2) + (w - fw).powi(2)).sqrt();
    if fp_r <= 1.6 && y < 2.6 {
        if (fp_r - 1.25).abs() < 0.3f32.max(s * 0.5) && y < 0.6 {
            return stone;
        }
        if fp_r < 0.4f32.max(s * 0.5) && y < 1.4 {
            return stone;
        }
        if fp_r < 0.2f32.max(s * 0.5) && y < 2.4 {
            return kind(WATER, colour(13, 0));
        }
    }

    // 2. Low blooming shrubs rising 0.2..1.0 m over the mapped flowerbeds.
    if y < 1.15 {
        for &(bu, bw, ru, rw, c1, c2) in &BOTANICAL_BEDS {
            let d = ((u - bu) / ru).powi(2) + ((w - bw) / rw).powi(2);
            if d < 0.92 {
                let mound = 0.85 * (1.0 - d).sqrt() + 0.25 * (u * 0.9).sin().abs();
                if y < mound {
                    let h = hash3((u * 3.0) as i32, (y * 3.0) as i32, (w * 3.0) as i32, 29);
                    return match h % 4 {
                        0 => kind(LEAVES, c1),
                        1 => kind(LEAVES, c2),
                        _ => kind(LEAVES, colour(8, 5)),
                    };
                }
            }
        }
    }

    // 3. Specimen trees: magnolias, redwoods and acacias round the meadow (places unchecked; those that stood in the
    // County Fair Building are gone).
    let mag_a = kind(LEAVES, colour(22, 1));
    let mag_b = kind(LEAVES, colour(21, 2));
    let red_a = kind(LEAVES, colour(9, 6));
    let red_b = kind(LEAVES, colour(8, 6));
    let gold_a = kind(LEAVES, colour(4, 3));
    let gold_b = kind(LEAVES, colour(5, 4));
    let trees: [(f32, f32, f32, f32, f32, u32, u8); 15] = [
        (-10.0, 16.0, 3.0, 5.2, 4.4, 101, 0),
        (16.0, -34.0, 3.2, 5.5, 4.6, 103, 0),
        (36.0, -34.0, 3.0, 5.0, 4.2, 107, 0),
        (-24.0, -30.0, 3.0, 5.0, 4.4, 113, 0),
        (-62.0, -34.0, 7.5, 6.2, 13.5, 127, 1),
        (-64.0, 14.0, 8.0, 6.4, 14.0, 131, 1),
        (-56.0, 38.0, 7.0, 5.8, 12.5, 137, 1),
        (-28.0, 42.0, 7.5, 6.0, 13.0, 139, 1),
        (64.0, -36.0, 7.2, 5.8, 12.8, 149, 1),
        (4.0, -44.0, 7.0, 5.8, 12.2, 157, 1),
        (6.0, 44.0, 7.4, 6.0, 12.8, 163, 1),
        (-46.0, -24.0, 3.4, 5.4, 4.8, 167, 2),
        (-42.0, 30.0, 3.6, 5.2, 4.6, 179, 2),
        (64.0, 4.0, 3.5, 5.0, 4.6, 181, 0),
        (-66.0, -8.0, 6.5, 5.6, 11.0, 191, 1),
    ];
    for &(tu, tw, th, cr, ch, seed, sp) in &trees {
        let (ca, cb) = match sp {
            0 => (mag_a, mag_b),
            1 => (red_a, red_b),
            _ => (gold_a, gold_b),
        };
        let kt = ornamental_tree(u - tu, y, w - tw, th, cr, ch, seed, s, dark_wood, ca, cb);
        if kt != 0 {
            return kt;
        }
    }
    0
}

// ── Conservatory of Flowers (1879) + Conservatory Valley Floral Parterres (Golden Gate Park).
// Frame: u along the glasshouse east-west axis (76 m), w south down Conservatory Valley (+w toward JFK Dr),
// y up from terrace foot 74.4 m (glasshouse) and over_g for the sloping Valley carpet parterres (#60).
// Street-facing public galleries of OSM way 30675038. The service ranges behind them
// stay in the lidar. The three narrow south projections face Conservatory Valley.
const CONSERVATORY_PUBLIC: &[(f32, f32)] = &[
    (-36.6, -3.7), (-8.4, -3.9), (-5.5, -6.9), (6.5, -6.9), (9.5, -3.9),
    (35.1, -3.9), (36.2, -4.9), (38.5, -2.7), (37.6, -1.3), (37.3, 15.0),
    (35.8, 16.7), (33.4, 16.6), (33.4, 17.6), (30.3, 17.6), (30.3, 16.7),
    (27.9, 16.6), (26.4, 15.0), (26.5, 7.1), (9.3, 7.0), (9.3, 7.5),
    (6.2, 10.4), (4.5, 10.4), (4.5, 17.4), (2.2, 17.3), (2.1, 18.9),
    (-1.3, 18.8), (-1.2, 17.5), (-3.4, 17.3), (-3.3, 10.4), (-5.4, 10.5),
    (-8.4, 7.5), (-25.2, 7.0), (-25.1, 14.4), (-26.9, 16.4), (-29.2, 16.5),
    (-29.2, 17.5), (-32.4, 17.4), (-32.4, 16.5), (-34.8, 16.3), (-36.6, 14.5),
];

// Mapped circular beds and borders in Conservatory Valley. Each entry gives the centre,
// half-widths, and whether the bed is round. Bounds are rounded to 0.1 m from the OSM ways.
const VALLEY_BEDS: &[(f32, f32, f32, f32, bool)] = &[
    (32.0, 39.6, 3.9, 5.8, false), // 1168983830
    (-40.7, 58.8, 1.9, 1.9, true), // 1168986284
    (-21.2, 59.0, 1.9, 1.9, true), // 1168986285
    (-31.3, 58.9, 3.5, 2.0, false), // 1168986286
    (-10.9, 59.0, 3.5, 2.0, false), // 1168986287
    (-10.7, 83.7, 3.5, 1.9, false), // 1168986288
    (-40.5, 83.5, 1.9, 1.9, true), // 1168986289
    (-31.0, 83.7, 3.5, 2.0, false), // 1168986290
    (-21.0, 83.7, 1.9, 1.9, true), // 1168986291
    (-19.6, 74.2, 12.3, 2.0, false), // 1168986292
    (-19.5, 68.5, 12.3, 2.0, false), // 1168986293
    (-43.0, 71.2, 4.9, 4.9, true), // 1168986294
    (44.6, 71.3, 4.9, 4.9, true), // 1168986295
    (21.2, 68.3, 12.3, 2.1, false), // 1168986296
    (21.1, 74.1, 12.3, 2.1, false), // 1168986297
    (32.7, 59.0, 3.5, 1.9, false), // 1168986298
    (42.5, 58.8, 1.9, 1.9, true), // 1168986299
    (42.5, 83.5, 1.9, 1.9, true), // 1168986300
    (32.9, 83.5, 3.5, 1.9, false), // 1168986301
    (22.8, 83.5, 1.9, 1.9, true), // 1168986302
    (12.5, 83.6, 3.5, 1.9, false), // 1168986303
    (12.3, 58.9, 3.5, 1.9, false), // 1168986304
    (22.5, 58.8, 1.9, 1.9, true), // 1168986305
    (0.8, 76.4, 2.1, 19.3, false), // 1168986307
];

// The crescent follows the curved east edge of the valley, OSM way 1168986306.
const VALLEY_CRESCENT: &[(f32, f32)] = &[
    (49.6, 83.3), (50.4, 85.4), (54.3, 83.5), (56.0, 81.9),
    (58.5, 78.2), (60.2, 71.9), (59.5, 67.7), (57.8, 63.9),
    (54.9, 60.2), (51.2, 57.4), (50.2, 59.3), (55.8, 64.7),
    (57.2, 68.2), (57.5, 72.1), (56.7, 75.9), (54.9, 79.1),
    (52.5, 81.5),
];

fn conservatory_public(u: f32, w: f32) -> bool {
    (-36.6..=38.5).contains(&u) && (-6.9..=18.9).contains(&w) && inside(CONSERVATORY_PUBLIC, u, w)
}

/// Walking surface of the Conservatory's 18 stone treads, measured over the landmark datum.
/// OSM way 867911035 joins the paths at w=41.8 and 49.7. The lidar records a level upper
/// landing, then a 2.8 m descent between the flanking cheek walls.
pub(crate) fn conservatory_stairs(u: f32, w: f32) -> Option<f32> {
    if !(41.8..=49.85).contains(&w) || (u - 0.6).abs() > 6.9 {
        return None;
    }
    let tread = ((49.85 - w) * (18.0 / 7.0)).ceil().min(18.0);
    Some(-3.5 + tread * (2.8 / 18.0))
}

fn valley_bed(u: f32, w: f32) -> bool {
    if !(33.7..=95.8).contains(&w) || !(-48.0..=60.3).contains(&u) {
        return false;
    }
    VALLEY_BEDS.iter().any(|&(cu, cw, hu, hw, round)| {
        let dx = (u - cu).abs();
        let dz = (w - cw).abs();
        dx <= hu && dz <= hw && (!round || (dx / hu).powi(2) + (dz / hw).powi(2) <= 1.0)
    }) || (u >= 49.5 && w <= 85.5 && inside(VALLEY_CRESCENT, u, w))
}

/// A bed's soil is hidden by the leaf rosettes the flower spikes rise from.
fn conservatory_surface(u: f32, w: f32, _s: f32) -> Option<Kind> {
    valley_bed(u, w).then_some(kind(LEAVES, colour(8, 6)))
}

// OSM 10725865300..303. In order: u, w, ground relative to the 74.4 m
// terrace, height above ground, and approximate crown radius (metres).
const VALLEY_PALMS: [(f32, f32, f32, f32, f32); 4] = [
    (-12.0, 33.3, -0.1, 21.6, 3.9), (-10.5, 36.5, -0.1, 21.5, 3.6),
    (11.4, 42.6, -0.9, 17.6, 4.2), (11.2, 33.7, 0.3, 16.3, 3.8),
];

/// The near tile inferred a single stem under the overlapping western crowns,
/// and three under the two eastern crowns. Match its stem, so every return it
/// supports goes away together, even when well outside the new palm's crown.
pub fn valley_palm_stem(u: f32, w: f32) -> bool {
    VALLEY_PALMS.iter().any(|&(x, z, _, _, _)| (u - x).powi(2) + (w - z).powi(2) < 3.0 * 3.0)
}

/// Distant survey faces carry no trunk ID. The centres and crown radii of the
/// four inferred stems in near tile 190_277 delimit these tree-only returns.
pub fn valley_palm_return(u: f32, w: f32) -> bool {
    if !(25.0..51.0).contains(&w) || u.abs() > 21.0 { return false; }
    [(-12.4, 34.7, 6.4), (12.0, 32.5, 5.8), (12.7, 35.6, 5.2), (13.2, 44.2, 4.2)]
        .iter().any(|&(x, z, radius)| (u - x).powi(2) + (w - z).powi(2) <= (radius + 0.5_f32).powi(2))
}

fn valley_palms(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(27.0..49.0).contains(&w) || u.abs() > 18.0 { return 0; }
    for (i, &(x, z, foot, height, radius)) in VALLEY_PALMS.iter().enumerate() {
        let dx = u - x;
        let dz = w - z;
        let h = y - foot;
        if dx.abs() > radius || dz.abs() > radius || h < -0.8 || h > height { continue; }
        let r = dx.hypot(dz);
        let head = height - 1.9;
        if r < (0.34 + 0.08 * (1.0 - h / height)).max(s * 0.55) && h < head {
            let tone = if (h * 3.5 + dx * 0.7).fract() < 0.18 { 8 } else { 9 };
            return kind(WOOD, colour(2, tone));
        }
        if h < head - 3.8 || r > radius { continue; }
        // Three whorls of offset arching fronds. The upper spears rise from the
        // same bud as the long outer fronds that bend back toward the trunk.
        let angle = dz.atan2(dx) + i as f32 * 2.4;
        for (tier, &(count, reach, lift, drop)) in
            [(9, 0.64, 3.1, 1.6), (12, 1.0, 3.3, 4.0), (13, 0.89, 1.3, 4.6)].iter().enumerate() {
            let spacing = std::f32::consts::TAU / count as f32;
            let a = angle + tier as f32 * 1.71 + r * 0.07;
            let spoke = (a / spacing).round();
            let phase = (spoke * spacing * 3.0 + i as f32).sin();
            let t = r / (radius * reach * (0.96 + 0.04 * phase));
            if t > 1.0 { continue; }
            let across = (a - spoke * spacing).abs() * r;
            let midrib = head + lift * (2.0 * t - t * t) - (drop + 0.35 * phase) * t * t;
            let blade = 0.06 + 0.32 * (std::f32::consts::PI * t).sin();
            let leaflet = (r * 3.8 - across * 3.3 + phase).rem_euclid(1.0);
            let width = if s <= 0.2 && leaflet < 0.32 { blade * 0.46 } else { blade };
            if across <= width.max(s * 0.45) && (h - midrib + 0.8 * across).abs() < 0.12 + 0.55 * s {
                let hue = if tier == 2 { 5 } else { 6 };
                return kind(LEAVES, colour(hue, if across < 0.1 && tier != 2 { 8 } else { 6 }));
            }
        }
    }
    0
}

/// Low leaves carry the mass of the border. A 10 cm cell already represents a
/// whole cluster of bells, so apply flower colour sparingly to the spike itself.
fn valley_planting(u: f32, y: f32, w: f32, s: f32) -> Option<Kind> {
    if y > 1.30 || !valley_bed(u, w) { return None; }
    const STEP: f32 = 0.48;
    let (pu, pw) = ((u / STEP).floor() as i32, (w / STEP).floor() as i32);
    let rnd = |seed: i32| hash3(pu, seed, pw, 83) as f32 / 4_294_967_296.0;
    let dx = u - (pu as f32 + 0.20 + 0.60 * rnd(1)) * STEP;
    let dz = w - (pw as f32 + 0.20 + 0.60 * rnd(2)) * STEP;
    let radius = dx.hypot(dz);
    let leaf = kind(LEAVES, colour(6, 8));
    // The central display grades from a low edging to taller flowering drifts.
    let margin = if w > 56.0 && (u - 0.8).abs() < 2.2 {
        ((95.7 - w) * 0.11).clamp(0.0, 1.0) * (2.1 - (u - 0.8).abs()).clamp(0.15, 1.0)
    } else { 1.0 };
    // Plant leaves overlap into a bank with an uneven top. Small rosettes
    // emerge above it, giving the sparse spikes a leafy silhouette at the foot.
    let ground_cover = crate::hash::noise((u * 10.0).floor() as i32, (w * 10.0).floor() as i32, 5, 41);
    let bank = 0.09 + 0.15 * ground_cover + (0.11 + 0.10 * margin) * (1.0 - radius / 0.28).max(0.0);
    if y < bank {
        let hue = if ground_cover > 0.63 { 6 } else { 7 };
        return Some(kind(LEAVES, colour(hue, if y < bank - 0.10 { 6 } else { 5 })));
    }
    let height = 0.14 + margin * (0.47 + 0.69 * rnd(3));
    if y > height { return None; }
    let t = y / height;
    let drift = hash3((u / 1.5).floor() as i32, 4, (w / 1.5).floor() as i32, 83);
    // A slightly leaning spike ends in a green bud. Each coloured band is at
    // most one fine cell high; occasional paired cells stay part of the spike.
    let stem = (dx - (rnd(4) - 0.5) * 0.20 * t).hypot(dz - (rnd(5) - 0.5) * 0.14 * t);
    if y < bank + 0.16 * margin && (dx + 0.65 * (y - bank)).abs() + dz.abs() < 0.14 {
        return Some(kind(LEAVES, colour(6, 6)));
    }
    let bells = margin > 0.25 && t > 0.47 && t < 0.95 && (height - y).rem_euclid(0.21) < 0.095;
    if bells && stem < 0.085 {
        let bloom = [colour(21, 2), colour(22, 8), grey(2), colour(17, 8), WHITE][(drift % 5) as usize];
        return Some(kind(LEAVES, bloom));
    }
    (stem < (0.044 + 0.032 * (1.0 - t)).max((s * 0.45).min(0.06))).then_some(leaf)
}

fn conservatory(u: f32, y: f32, w: f32, s: f32) -> Kind {
    let palm = valley_palms(u, y, w, s);
    if palm != 0 { return palm; }
    if let Some(tread) = conservatory_stairs(u, w) {
        if y <= tread && y > tread - 0.45 {
            return kind(CONCRETE, colour(2, 7));
        }
        let side = (u - 0.6).abs();
        if s <= 0.4 && side.min((side - 6.5).abs()) <= 0.05f32.max(s * 0.5) {
            let rail = -2.6 + ((49.85 - w) * (2.8 / 7.0)).min(2.8);
            if member(y - rail, 0.045, s) || (y >= tread && y < rail && line(w, 1.8, 42.0, 0.08, s)) {
                return kind(STEEL, grey(8));
            }
        }
        return 0;
    }
    if !(-2.5..=19.0).contains(&y) || !conservatory_public(u, w) {
        return 0;
    }
    let timber = kind(WOOD, WHITE);
    let clear = kind(GLASS, colour(14, 7));
    // The park's daylight exterior photograph shows the opaque whitewash on the large panes.
    // Clear entrance lights and muntins remain individually visible in front of that coating.
    let wash = kind(PLASTER, WHITE);
    // The glazing bars are a few centimetres: a cell coarser than a quarter metre shows the whitewashed glass.
    let bar = kind(WOOD, grey(3));
    let fine = s <= 0.25;
    let du = u - 1.1;
    let dw = w - 2.1;
    let (x, z) = (du.abs(), dw.abs());
    let octagon = x.max(z).max((x + z) * std::f32::consts::FRAC_1_SQRT_2);
    // Every vertical stack of coarse cells must intersect the roof, including at the crest.
    let skin = s.max(0.35);
    if y < 0.0 {
        return kind(CONCRETE, grey(2));
    }

    // The octagonal Palm House has two distinct roofs. The upper dome springs out of a
    // narrow drum at 85.8 m; the lower roof sweeps down to the wider gallery at 79.8 m.
    if octagon <= 9.7 {
        let upper = octagon <= 5.05;
        let ridge = if upper {
            11.4 + 5.4 * (1.0 - (octagon / 5.05).powi(2)).max(0.0).sqrt()
        } else {
            5.4 + 4.0 * (1.0 - ((octagon - 5.05) / 4.65).powi(2)).max(0.0).sqrt()
        };
        let finial_radius = ((18.6 - y) * 0.85 + 0.18).clamp(0.12, 0.8).max(s * 0.5);
        if y > 16.4 && y <= 18.6 && x.hypot(z) <= finial_radius {
            return timber;
        }
        let drum = (upper && octagon > 5.05 - skin && y >= 9.1) || octagon > 9.7 - skin;
        let roof = y >= ridge - skin;
        if y <= ridge && (drum || roof) {
            let corner = line(dw.atan2(du) * 8.0, std::f32::consts::PI, 0.0, 0.10, s);
            let rail = (y - 9.25).abs() < 0.28 || (y - 11.3).abs() < 0.3;
            // The forward arch on the lowest tier is glazed; the rest of the drum is white.
            if dw > 7.0 && x < 1.25 && (3.4..6.6).contains(&y) && !line(du, 0.65, 0.0, 0.09, s) {
                return clear;
            }
            if rail || y < 0.65 {
                return timber;
            }
            return if fine && (corner || line(y, 1.25, 0.0, 0.10, s)) { bar } else { wash };
        }
        return 0;
    }

    let entry = u > -3.4 && u < 4.5 && w >= 10.3;
    let end_axis = if u < 0.0 { -30.9 } else { 32.0 };
    let side = (u - end_axis).abs();
    let half = 5.65;
    // Horizontal galleries run east-west. The end houses run towards the visitor,
    // with a barrel vault at right angles to the long gallery.
    let end = side <= half && w >= -3.7;
    let radial = if entry { (u - 0.6).abs() / 3.95 } else if end && w >= 2.0 {
        (side / half).max(((w - 11.8) / 5.15).max(0.0))
    } else { (w - 1.8).abs() / half };
    let ridge = if entry { 5.4 - 0.45 * (u - 0.6).abs() } else {
        // Survey cross section: 79.7 m at the ridge, 77.0 m 4.3 m from it.
        1.25 + 4.15 * (1.0 - radial.min(1.0).powf(1.45))
    };
    let cupola = end && side.max(z) < 0.95;
    if cupola && y > ridge && y <= 7.6 - 1.2 * side.max(z) {
        return timber;
    }
    if y > ridge {
        return 0;
    }
    let boundary = if entry {
        w >= 17.2 - skin || (u - 0.6).abs() > 3.9 - skin
    } else {
        (end && (side >= half - skin || w >= 16.5 - skin))
            || (!end && (radial >= 1.0 - skin / half)) || u < -36.6 + skin || u > 37.5 - skin
    };
    if !boundary && y < ridge - skin {
        return 0;
    }
    if entry && w > 17.0 && x < 1.55 && y < 3.9 && !line(du, 0.8, 0.0, 0.1, s) {
        return clear;
    }
    // Over the doors, the portico's arched window under its gable.
    if entry && w > 17.0 && y >= 4.1 && y < 4.1 + 0.75 * (1.25f32.powi(2) - x * x).max(0.0).sqrt() {
        return if line(du, 0.6, 0.0, 0.08, s) && s <= 0.25 { timber } else { clear };
    }
    let along = if end && w >= 2.0 { w } else { u };
    if y < 0.6 { timber } else if fine && line(along, 1.4, 0.0, 0.11, s) { bar } else { wash }
}

// ── The Painted Ladies — 710–722 Steiner Street (Matthew Kavanaugh, 1892–1896).
// Seven stepped Queen Anne Victorian rowhouses climbing the Steiner St hill across from Alamo Square.
// Frame: u runs north-to-south along Steiner St (from 722 at -21.15 m to 710 at +23.25 m), +w faces west toward
// Alamo Square, y up from 722's base datum (60.6 m). Verified against Painted Ladies.jpg (#60): the corner house, 722,
// is hipped and flat-crowned; the six to its south are front-gabled. OSM footprints (261412887 and the six beside it)
// give the seven lot positions and the two different bays at the corner.
/// 722's hipped roof: metres it rises per metre in from its eaves, and the height of its flat crown above 722's base.
/// The lidar eaves on both sides are at 71 m above the Bay. Its central roof reaches 74.8 to 75.3 m.
const CORNER_PITCH: f32 = 1.7;
const CORNER_CROWN: f32 = 14.4;

// The street front of 722 has a square bay on the north, an entrance between the bays,
// and an angled bay on the south. OSM way 261412887, projected with the registry's frame.
const STEINER_CORNER: &[(f32, f32)] = &[
    (-16.6, 1.1), (-17.4, 1.2), (-17.4, 6.0), (-18.6, 7.4), (-20.4, 7.4),
    (-21.5, 6.3), (-22.8, 6.3), (-22.8, 7.8), (-24.8, 7.8), (-24.8, 6.3),
    (-25.6, 6.3), (-25.7, -10.1), (-24.3, -10.2), (-24.3, -11.1), (-21.4, -11.0),
    (-21.4, -10.2), (-19.9, -10.2), (-19.9, -8.7), (-16.6, -8.6),
];

fn steiner_corner(u: f32, y: f32, w: f32, s: f32, body: Kind, trim: Kind) -> Kind {
    if !inside(STEINER_CORNER, u, w) {
        return 0;
    }
    // The squared bay ends a storey below the angled one. Behind it the main front stands at w=6.3.
    let square = (-24.8..=-22.8).contains(&u);
    if square && w > 6.3 {
        if y > 7.0 { return 0; }
        if y > 6.7 { return kind(ROOFING, grey(12)); }
    }
    if y < 0.0 { return kind(CONCRETE, grey(6)); }
    // The setback and bay faces are measured. Sash positions are illustrative.
    let front = if square && y < 7.0 { 7.8 } else if (-21.5..-20.4).contains(&u) { 6.3 + u + 21.5 }
        else if (-20.4..=-18.6).contains(&u) { 7.4 }
        else if (-18.6..-17.4).contains(&u) { 7.4 - (u + 18.6) * 1.4 / 1.2 }
        else { 6.3 };
    let face = front - w < s.max(0.4);
    let side = u < -25.05;
    if face || side {
        if (y - 2.1).abs() < 0.16 || (y - 5.6).abs() < 0.18 || y > 9.95 { return trim; }
        if face && (-22.65..-21.65).contains(&u) && (2.15..4.85).contains(&y) {
            return if y > 4.35 { kind(GLASS, colour(14, 9)) } else { kind(WOOD, colour(1, 8)) };
        }
        let openings = if side { line(w, 3.0, 0.0, 1.2, s) } else {
            [-24.25, -23.35, -20.83, -19.5, -18.2].iter().any(|mid| (u - mid).abs() < 0.38)
        };
        if openings && ((2.7..5.05).contains(&y) || (6.25..9.25).contains(&y)) {
            return if (y - 3.9).abs() < 0.1 || (y - 7.8).abs() < 0.1 { trim } else { kind(GLASS, colour(14, 9)) };
        }
    }
    body
}

fn painted_ladies(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(-4.5..20.5).contains(&y) || u < -28.0 || u > 26.8 || w < -11.2 || w > 12.6 {
        return 0;
    }
    // Exact surveyed (u_mid, half_width, base_rel_m, body_colour, accent_colour, trim_colour) from north (722) to south (710):
    let houses: [(f32, f32, f32, u8, u8, u8); 7] = [
        (-21.15, 4.55, 0.0, colour(15, 9), colour(14, 8), WHITE),          // 722 Steiner: deep charcoal-navy & crisp white
        (-12.25, 3.55, 0.8, colour(6, 8), colour(4, 2), colour(4, 0)),    // 720 Steiner: warm olive-sage & cream trim
        (-5.2, 3.6, 1.4, colour(10, 8), colour(11, 2), WHITE),         // 718 Steiner: muted slate-teal & crisp white
        (1.85, 3.45, 2.2, colour(3, 1), colour(1, 2), WHITE),            // 716 Steiner: warm butter-cream & coral accent
        (8.8, 3.5, 2.8, colour(21, 7), colour(20, 8), WHITE),          // 714 Steiner: soft lavender-taupe & dusty rose
        (16.05, 3.45, 3.4, colour(12, 1), colour(13, 2), WHITE),         // 712 Steiner: pale robins-egg aqua & crisp white
        (23.25, 3.45, 4.0, colour(4, 7), colour(3, 0), WHITE),           // 710 Steiner: pale cream & white trim (May 2022 photo)
    ];
    let slate = kind(ROOFING, grey(12));
    let brick = kind(BRICK, colour(0, 6));
    let glass = kind(GLASS, colour(14, 9));
    let dark_room = kind(PLASTER, grey(13));

    for (idx, &(um, hw, base, body_c, acc_c, trim_c)) in houses.iter().enumerate() {
        let lu = u - um;
        if lu.abs() > hw - 0.08 {
            continue;
        }
        let body = kind(PLASTER, body_c);
        let accent = kind(PLASTER, acc_c);
        let trim = kind(PLASTER, trim_c);
        let hy = y - base;
        if hy < -4.2 || hy > 14.8 {
            continue;
        }
        // Main house box: w from -9.0 (rear) to +7.8 (main front plane).
        // Foundation skirt down to -4.2 m embeds cleanly into Steiner St's hillside.
        if idx == 0 && hy < 10.4 {
            return steiner_corner(u, hy, w, s, body, trim);
        }
        if hy < 0.0 {
            return if w >= -9.0 && w <= 9.6 { kind(CONCRETE, grey(6)) } else { 0 };
        }
        // Brick chimney rising near the rear ridge.
        if hy >= 9.0 && hy < 14.4 && (lu - 1.2).abs() < 0.55 && (w + 3.5).abs() < 0.55 {
            return brick;
        }
        // Steep Queen Anne pitched front gable roof (hy = 9.4..13.5 m) running front-to-back!
        let roof_eave = if idx == 0 { 10.4 } else { 9.4 };
        let gable_peak = 13.4;
        let slope_y = gable_peak - (lu.abs() / hw) * (gable_peak - roof_eave);
        if hy >= roof_eave {
            // Front bay-window decorative hipped turret cap & gable overhang.
            let front_w = if idx == 0 { 7.6 } else { 8.6 };
            if w > front_w || w < -9.2 {
                return 0;
            }
            // 722, the dark corner house, has no front gable: its roof is hipped on all sides, steep, and flat on top,
            // a broad crown whose ridge runs along the street (Painted Ladies.jpg and the panorama it is cut from).
            if idx == 0 {
                let across = hw - lu.abs();
                let depth = (front_w - w).min(w + 9.2);
                // The lidar sections toward the front and rear rise about 0.83 m per metre.
                let roof_top = (roof_eave + (across * CORNER_PITCH).min(depth * 0.83)).min(CORNER_CROWN);
                if hy > roof_top {
                    return 0;
                }
                if across.min(depth) < 0.6 && hy - roof_eave < 0.45 {
                    return trim;
                }
                return if roof_top - hy < 0.55f32.max(s) { slate } else { body };
            }
            if hy > slope_y {
                return 0;
            }
            // Front gable facade (w = 7.4..8.6): crisp white scalloped bargeboard verge, decorative attic window!
            if w > 7.4 {
                if (slope_y - hy) < 0.55 || (hy - roof_eave) < 0.45 {
                    return trim;
                }
                if lu.abs() < 0.75 && hy > roof_eave + 0.8 && hy < gable_peak - 1.2 {
                    return if w > 7.9 { 0 } else if lu.abs() < 0.14 || (hy - (roof_eave + 1.8)).abs() < 0.14 { trim } else { glass };
                }
                return if ((hy * 3.0) as i32) % 2 == 0 { accent } else { body };
            }
            // Dark slate pitched roof over the house body.
            if (slope_y - hy) < 0.55f32.max(s) {
                return slate;
            }
            return body;
        }
        // ── Prominent 2-Story 3-Sided Polygonal Bay Window on the north side of each house front (lu = -hw+0.3 .. +0.75).
        let bay_u0 = -hw + 0.35;
        let bay_u1 = 0.75;
        let bay_mid = (bay_u0 + bay_u1) * 0.5;
        let bay_hw = (bay_u1 - bay_u0) * 0.5;
        let in_bay_u = lu >= bay_u0 && lu <= bay_u1;
        if w > 7.8 && in_bay_u {
            let edge_t = ((lu - bay_mid).abs() - bay_hw * 0.55).max(0.0) / (bay_hw * 0.45);
            let bay_proj = 7.8 + 1.55 * (1.0 - edge_t * 0.75); // crisp 3-sided polygonal bay bevel!
            if w > bay_proj {
                return 0;
            }
            // Bay roof cornice & floor belt courses.
            if hy >= 8.95 || (hy - 5.5).abs() < 0.25 || (hy - 2.1).abs() < 0.25 {
                return trim;
            }
            // Ground-floor raised basement bay windows (0.4..1.8) + 2 tall Victorian stories (2.3..5.2 and 5.7..8.7).
            let fy = if hy >= 5.5 { hy - 5.5 } else if hy >= 2.1 { hy - 2.1 } else { -1.0 };
            let on_face = bay_proj - w < 0.45f32.max(s);
            if fy >= 0.0 && on_face {
                // Three tall narrow double-hung Victorian sash windows across the 3 facets of the bay!
                let pane_c = (lu - bay_mid).abs() < 0.62;
                let pane_side = ((lu - bay_mid).abs() - bay_hw * 0.68).abs() < 0.46;
                if (pane_c || pane_side) && (0.45..2.85).contains(&fy) {
                    let sash = (fy - 1.65).abs() < 0.12 || (fy - 0.45) < 0.14 || (2.85 - fy) < 0.14;
                    return if sash { trim } else if bay_proj - w < 0.18 && s <= 0.25 { 0 } else { glass };
                }
                // Decorative Queen Anne spandrel panel below each window.
                if fy < 0.45 {
                    return accent;
                }
            }
            if hy < 2.1 && on_face && (lu - bay_mid).abs() < 0.85 && (0.6..1.7).contains(&hy) {
                return glass;
            }
            return body;
        }
        // ── Recessed Covered Front Entry Porch & Stairs on the south side of each house front (lu = +0.75 .. +hw-0.2).
        if w > 7.8 && lu > bay_u1 {
            // Elevated front porch stairs descending toward Steiner St sidewalk (w = 7.8..11.0).
            if w <= 11.2 && hy < 2.2 {
                let step_h = 2.15 * (1.0 - ((w - 8.2).max(0.0) / 3.0)).clamp(0.0, 1.0);
                if hy <= step_h {
                    return if (lu - (bay_u1 + 0.18)).abs() < 0.18 || (lu - (hw - 0.25)).abs() < 0.18 { trim } else { kind(CONCRETE, grey(4)) };
                }
            }
            // Porch deck, white balustrade, turned white corner columns & porch cornice (w = 7.8..9.6).
            if w <= 9.6 {
                if (2.1..2.35).contains(&hy) || (5.3..5.65).contains(&hy) {
                    return trim;
                }
                // Porch railing balusters.
                if (2.35..3.15).contains(&hy) && w > 9.2 && lu < bay_u1 + 0.9 {
                    return if hy > 3.0 || line(lu, 0.35, 0.0, 0.12, s) { trim } else { 0 };
                }
                // Turned white porch columns supporting the second-floor porch roof.
                if (2.3..5.35).contains(&hy) && w > 9.15 && ((lu - (bay_u1 + 0.2)).abs() < 0.2 || (lu - (hw - 0.35)).abs() < 0.2) {
                    return trim;
                }
                // Upstairs decorative porch balcony rail (5.65..6.45).
                if (5.65..6.45).contains(&hy) && w > 9.2 {
                    return if hy > 6.3 || line(lu, 0.4, 0.0, 0.12, s) { trim } else { 0 };
                }
            }
            return 0;
        }
        // ── Main Victorian house body (w = -9.0..+7.8).
        if w >= -9.0 && w <= 7.8 {
            let on_front = 7.8 - w < 0.6f32.max(s);
            let on_rear = w + 9.0 < 0.5f32.max(s);
            if on_front {
                if hy >= 9.0 || (hy - 5.5).abs() < 0.22 || (hy - 2.1).abs() < 0.22 {
                    return trim;
                }
                // Recessed panelled front entry door with transom on porch side (lu > 0.9).
                if lu > 1.1 && lu < hw - 0.6 && (2.2..4.9).contains(&hy) {
                    if hy > 4.2 {
                        return glass; // glass fanlight/transom
                    }
                    return if 7.8 - w < 0.25 { 0 } else { kind(WOOD, colour(1, 6)) };
                }
                // Tall upstairs sash window over the front porch.
                if lu > 1.2 && lu < hw - 0.7 && (6.0..8.6).contains(&hy) {
                    let sash = (hy - 7.3).abs() < 0.12 || (lu - (hw * 0.5 + 0.4)).abs() < 0.1;
                    return if sash { trim } else if 7.8 - w < 0.2 && s <= 0.25 { 0 } else { glass };
                }
            }
            if on_rear && hy > 2.2 && hy < 8.6 && (hy - 2.2).rem_euclid(3.3) > 0.6 && (hy - 2.2).rem_euclid(3.3) < 2.6 && line(lu, 2.8, 0.0, 1.2, s) {
                return glass;
            }
            return if on_front || on_rear || (hw - lu.abs()) < 0.5 { body } else { dark_room };
        }
    }
    0
}

// ── de Young Museum (Herzog & de Meuron, 2005, Golden Gate Park).
// Frame: u along the main gallery axis (150 m), w across (74 m, -w facing Music Concourse), y up from 74.5 m.
// Signature oxidized perforated copper cladding, deeply recessed glass ground floor beneath a sweeping cantilevered
// copper roof overhang and the Hamon Observation Tower, northeast of the main galleries (#60).
fn de_young(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if !(-7.5..46.0).contains(&y) || u.abs() > 78.0 || w.abs() > 42.0 {
        return 0;
    }
    let copper_a = kind(STEEL, colour(2, 8));
    let copper_b = kind(STEEL, colour(2, 5));
    let copper_patina = kind(STEEL, colour(6, 9));
    let dark_steel = kind(STEEL, grey(12));
    let glass = kind(GLASS, colour(13, 7));
    let concrete = kind(CONCRETE, grey(5));

    // Refined architectural oxidized copper cladding: uniform warm bronze sheets with fine vertical standing seams
    // (1.8 m pitch) and subtle horizontal panel joints rather than blocky camouflage noise (#60).
    let copper_at = |a: f32, b: f32| {
        if line(a, 1.8, 0.0, 0.14, s) || line(b, 3.2, 0.0, 0.12, s) {
            copper_b
        } else if (hash3((a * 0.55).floor() as i32, (b * 0.32).floor() as i32, 0, 29) % 11) == 0 {
            copper_patina
        } else {
            copper_a
        }
    };

    // Hamon Tower's floors are parallelograms. The short ends remain parallel to the gallery
    // grid as their centres slide in opposite directions. OSM ways 1418750068–73 show the
    // intervening floors. The 0.25 m lidar gives the four corners of the top deck in this frame.
    if (-78.0..=-48.0).contains(&u) && (8.6..=37.6).contains(&w) && (-7.0..=44.5).contains(&y) {
        let rise = ((y - 13.0) / 26.0).clamp(0.0, 1.0);
        let front_w = 9.6 - rise;
        let back_w = 37.6;
        let front_mid = -64.15 + 9.15 * rise;
        let back_mid = -63.65 - 7.5 * rise;
        let depth = (w - front_w) / (back_w - front_w);
        let ru = u - (front_mid + depth * (back_mid - front_mid));
        let rw = w - front_w;
        let half_width = 4.55 + 1.7 * rise;
        let face = (half_width - ru.abs()).min(rw).min(back_w - w);
        if face >= 0.0 {
            if y < 0.0 { return concrete; }
            // Most of the deck is at 117.65 m above the Bay. The thin rim reaches 118.9 m.
            if y > 43.2 {
                return if face < 0.45f32.max(s * 0.5) { dark_steel } else { 0 };
            }
            // Panoramic 360-degree glazed observation floor near the top (37.5..41.2 m).
            if (37.5..41.2).contains(&y) {
                if face < 0.8f32.max(s) {
                    let post = line(ru + rw, 3.2, 0.0, 0.25, s);
                    return if post { dark_steel } else { glass };
                }
                return if y < 38.0 { concrete } else { 0 };
            }
            // Perforated oxidized copper tower skin with narrow vertical slit windows.
            if face < 0.7f32.max(s) && s <= 0.6 && (8.0..35.0).contains(&y) && line(ru + rw, 4.6, 0.0, 0.35, s) && (y as i32) % 7 < 3 {
                return glass;
            }
            return copper_at(ru + rw, y);
        }
    }

    // 2. Main 3-Story Sweeping Copper Museum Volume (148 x 72 m, height 13.8 m).
    if u.abs() > 74.5 || w.abs() > 36.5 || y > 14.2 {
        return 0;
    }
    if y < 0.0 {
        return if u.abs() <= 71.0 && w.abs() <= 33.0 { concrete } else { 0 };
    }
    // Signature sculptural cantilevered copper roof slab (11.2..13.8 m) overhanging deeply recessed Music Concourse plaza!
    if y >= 11.2 {
        // Flush linear architectural roof skylight above the central concourse hall (no exposed solid notch).
        let skylight = (u - 6.0).abs() < 4.5 && w > -18.0 && w < 8.0 && y > 13.3;
        if skylight {
            return if line(u, 2.2, 0.0, 0.22, s) || line(w, 2.6, 0.0, 0.22, s) { dark_steel } else { glass };
        }
        return if y > 13.4 { kind(ROOFING, grey(10)) } else { copper_at(u + w, y) };
    }
    // Deeply recessed transparent glass ground floor & entry court (0..5.2 m).
    if y < 5.2 {
        if u.abs() > 67.0 || w.abs() > 28.0 {
            // Slender dark steel columns supporting the dramatic cantilevered copper overhang.
            if (w + 33.0).abs() < 0.45 && u.abs() <= 70.0 && line(u, 11.0, 0.0, 0.6, s) {
                return dark_steel;
            }
            return 0;
        }
        let face = (67.0 - u.abs()).min(28.0 - w.abs());
        if face < 0.8f32.max(s) {
            let along = if 67.0 - u.abs() < 28.0 - w.abs() { w } else { u };
            return if line(along, 2.8, 0.0, 0.2, s) { dark_steel } else { glass };
        }
        return concrete;
    }
    // Upper copper-clad gallery box (5.2..11.2 m) with crisp horizontal clerestory ribbon windows.
    if u.abs() <= 72.0 && w.abs() <= 33.5 {
        let face = (72.0 - u.abs()).min(33.5 - w.abs());
        if face < 0.8f32.max(s) && (7.6..9.1).contains(&y) && s <= 0.8 {
            let along = if 72.0 - u.abs() < 33.5 - w.abs() { w } else { u };
            if (along + 4.0).rem_euclid(14.0) < 7.5 {
                return glass;
            }
        }
        return copper_at(u + w, y);
    }
    0
}

thread_local! {
    static FACES: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
}

/// The outside faces of a block of a landmark in cells `step` wide (cells of 10 cm), for the page's far model:
/// `size` cells a side (each at most 1,023) from cell `from` of the landmark's own grid of such cells, counted from
/// its frame's middle (u, w) and foot (y). A face is two words, as a body's are (page/pieces.ts): where its row
/// starts in the block (ten bits each of u, y, w), then how long it is, which way it looks and its kind. Rows run
/// along w where a face looks along u, along u otherwise. Bits 11 to 15 of the second word are how far the wall
/// truly looks from the way the face does (`looks`), about y, in steps of 6 degrees from 16: 0 is not at all.
/// Returns how many words; `faces_at` is where they are.
pub fn faces(sort: u32, step: i32, from: [i32; 3], size: [i32; 3]) -> usize {
    let [nu, ny, nw] = size.map(|n| n.clamp(0, 1023) as usize);
    let s = step as f32 * 0.1;
    // The block with a cell more all round, so that a face at its edge knows what is beyond it.
    let (gu, gy, gw) = (nu + 2, ny + 2, nw + 2);
    let mut cells = vec![0 as Kind; gu * gy * gw];
    let at = |i: usize, j: usize, k: usize| (j * gw + k) * gu + i;
    for j in 0..gy {
        let y = (from[1] + j as i32 - 1) as f32 * s + s / 2.0;
        for k in 0..gw {
            let w = (from[2] + k as i32 - 1) as f32 * s + s / 2.0;
            for i in 0..gu {
                let u = (from[0] + i as i32 - 1) as f32 * s + s / 2.0;
                cells[at(i, j, k)] = kind_at(sort, u, y, w, s);
            }
        }
    }
    FACES.with_borrow_mut(|out| {
        out.clear();
        for axis in 0..3usize {
            for side in 0..2usize {
                let (outer, inner, run) = if axis == 0 { (ny, nu, nw) } else { (ny, nw, nu) };
                for a in 0..outer {
                    for b in 0..inner {
                        // What a run of faces holds: its kind, and over it how its wall leans.
                        let (mut start, mut held) = (0usize, 0u32);
                        for c in 0..=run {
                            let mut k = 0u32;
                            if c < run {
                                let (i, j, kk) = if axis == 0 { (b + 1, a + 1, c + 1) } else { (c + 1, a + 1, b + 1) };
                                let beyond = match axis {
                                    0 => at(i + side * 2 - 1, j, kk),
                                    1 => at(i, j + side * 2 - 1, kk),
                                    _ => at(i, j, kk + side * 2 - 1),
                                };
                                if cells[beyond] == 0 {
                                    k = cells[at(i, j, kk)] as u32;
                                }
                                if k != 0 && axis != 1 {
                                    let middle = |n: usize, o: i32| (o + n as i32 - 1) as f32 * s + s / 2.0;
                                    if let Some(t) = looks(sort, middle(i, from[0]), middle(j, from[1]), middle(kk, from[2])) {
                                        let out = side as f32 * 2.0 - 1.0;
                                        let (fu, fw) = if axis == 0 { (out, 0.0) } else { (0.0, out) };
                                        let turn = (t[0] * fw - t[1] * fu).atan2(t[0] * fu + t[1] * fw).to_degrees();
                                        let steps = (turn / 6.0).round() as i32;
                                        if steps != 0 {
                                            k |= ((steps + 16).clamp(1, 31) as u32) << 16;
                                        }
                                    }
                                }
                            }
                            if k == held && c - start < 255 {
                                continue;
                            }
                            if held != 0 {
                                let (su, sy, sw) = if axis == 0 { (b, a, start) } else { (start, a, b) };
                                out.push((su | sy << 10 | sw << 20) as u32);
                                out.push(((c - start) | axis << 8 | side << 10) as u32 | (held >> 16) << 11 | (held & 0xffff) << 16);
                            }
                            start = c;
                            held = k;
                        }
                    }
                }
            }
        }
        out.len()
    })
}

/// Where the words of the last `faces` are.
pub fn faces_at() -> *const u32 {
    FACES.with_borrow(|f| f.as_ptr())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ferry_front_follows_the_surveyed_portico_and_wings() {
        // DataSF footprint 201006.0000058. The two wings stop at w=21.8,
        // the entrance projects to w=30.7. The plaza and pier stay mapped.
        let reach = reach(FERRY_BUILDING).unwrap();
        assert!(reach[5] >= 31.0, "central entrance lies outside the registered landmark");
        for u in [-15.0, 0.0, 15.0] {
            assert!(owns(FERRY_BUILDING, u, 8.0, 30.6));
            assert_ne!(ferry_building(u, 14.0, 30.4, 0.4), 0);
        }
        // Three two-storey openings with their glass behind the piers.
        for u in [-9.5, -0.5, 8.5] {
            assert_eq!(ferry_building(u, 8.0, 30.4, 0.4), 0);
            assert_eq!(material(ferry_building(u + 1.0, 8.0, 28.6, 0.4)), GLASS);
            assert_eq!(material(ferry_building(u + 4.2, 8.0, 30.4, 0.4)), PLASTER);
        }
        for u in [-72.0, 72.0] {
            assert!(!owns(FERRY_BUILDING, u, 5.0, 27.0));
            assert_eq!(ferry_building(u, 5.0, 27.0, 0.4), 0);
            assert_eq!(material(ferry_building(u, 3.0, 21.0, 0.4)), GLASS);
            assert_eq!(material(ferry_building(u + 3.0, 3.0, 21.6, 0.4)), PLASTER);
        }
        assert!(!owns(FERRY_BUILDING, 38.0, 1.0, -42.0));
    }

    #[test]
    fn ferry_clock_shows_two_oclock_on_all_four_faces() {
        for (nu, nw) in [(0.0, 1.0), (0.0, -1.0), (1.0, 0.0), (-1.0, 0.0)] {
            let dial = |right: f32, up: f32| material(ferry_building(
                nu * 5.9 + nw * right, 39.0 + up, FB_TOWER_W + nw * 5.9 - nu * right, 0.4,
            ));
            assert_eq!(dial(0.0, 1.9), STEEL, "minute hand");
            assert_eq!(dial(0.3, 1.2), STEEL, "minute hand survives an offset column");
            assert_eq!(dial(1.1, 0.65), STEEL, "hour hand");
            assert_eq!(dial(-1.1, 0.65), PLASTER, "unmarked dial");
        }
    }

    /// A landmark seen square on from one side, as a picture (PPM), for looking at a rule without a page:
    ///   HEROES_OUT=/some/dir cargo test --release heroes::tests::pictures -- --ignored
    /// `across` is the axis looked along: 2 from the bay side (u across the picture), 0 from the end (w across).
    fn picture(sort: u32, s: f32, across: usize, window: [f32; 4]) -> (usize, usize, Vec<u8>) {
        let r = reach(sort).unwrap();
        let [x0, y0, x1, y1] = window;
        let (wide, high) = (((x1 - x0) / s) as usize, ((y1 - y0) / s) as usize);
        let (deep0, deep1) = (r[across], r[across + 3]);
        let mut out = vec![0u8; wide * high * 3];
        for j in 0..high {
            let y = y1 - (j as f32 + 0.5) * s;
            for i in 0..wide {
                let x = x0 + (i as f32 + 0.5) * s;
                let mut rgb = [150u8, 185, 225];
                let mut d = deep1 - s / 2.0;
                while d > deep0 {
                    let k = if across == 2 { kind_at(sort, x, y, d, s) } else { kind_at(sort, d, y, x, s) };
                    if k != 0 {
                        let shade = 1.0 - 0.35 * (deep1 - d) / (deep1 - deep0);
                        let base: [f32; 3] = match (material(k), (k >> 8) as u8) {
                            (STEEL, c) if c == colour(0, 4) => [192.0, 54.0, 44.0],
                            (STEEL, c) if c <= 15 && c > 0 => [235.0 - 12.0 * c as f32; 3],
                            (GLASS, c) if c == colour(15, 9) => [50.0, 60.0, 80.0],
                            (GLASS, _) => [120.0, 150.0, 185.0],
                            (CONCRETE, c) if c <= 15 && c > 0 => [235.0 - 12.0 * c as f32; 3],
                            (CONCRETE, _) => [170.0, 168.0, 160.0],
                            (ASPHALT, _) => [70.0, 72.0, 78.0],
                            _ => [110.0, 110.0, 110.0],
                        };
                        rgb = base.map(|v| (v * shade) as u8);
                        break;
                    }
                    d -= s;
                }
                out[(j * wide + i) * 3..(j * wide + i) * 3 + 3].copy_from_slice(&rgb);
            }
        }
        (wide, high, out)
    }

    #[test]
    #[ignore]
    fn pictures() {
        let Ok(dir) = std::env::var("HEROES_OUT") else { return };
        let save = |name: &str, (w, h, rgb): (usize, usize, Vec<u8>)| {
            let mut bytes = format!("P6 {w} {h} 255\n").into_bytes();
            bytes.extend(rgb);
            std::fs::write(format!("{dir}/{name}.ppm"), bytes).unwrap();
        };
        save("salesforce-0.4", picture(SALESFORCE, 0.4, 2, [-40.0, 0.0, 40.0, 330.0]));
        save("salesforce-crown-0.1", picture(SALESFORCE, 0.1, 2, [-25.0, 270.0, 25.0, 328.0]));
        save("gate-whole-3.2", picture(GOLDEN_GATE, 3.2, 2, [GG_SOUTH, -10.0, GG_NORTH, 235.0]));
        save("gate-tower-side-0.4", picture(GOLDEN_GATE, 0.4, 2, [-760.0, -10.0, -520.0, 235.0]));
        save("gate-tower-end-0.2", picture(GOLDEN_GATE, 0.2, 0, [-48.0, -10.0, 48.0, 235.0]));
        save("gate-south-0.8", picture(GOLDEN_GATE, 0.8, 2, [GG_SOUTH, -10.0, -900.0, 120.0]));
        save("gate-deck-0.1", picture(GOLDEN_GATE, 0.1, 2, [-40.0, 66.0, 10.0, 86.0]));
        save("bay-whole-3.2", picture(BAY_BRIDGE, 3.2, 2, [BB_WEST - 16.0, -10.0, BB_EAST + 16.0, 165.0]));
        save("bay-tower-end-0.2", picture(BAY_BRIDGE, 0.2, 0, [-30.0, -5.0, 30.0, 165.0]));
        save("bay-middle-0.8", picture(BAY_BRIDGE, 0.8, 2, [-420.0, -10.0, 420.0, 165.0]));
        save("pyramid-0.4", picture(TRANSAMERICA, 0.4, 2, [-30.0, 0.0, 30.0, 262.0]));
        save("pyramid-end-0.4", picture(TRANSAMERICA, 0.4, 0, [-30.0, 0.0, 30.0, 262.0]));
        save("pyramid-1.6", picture(TRANSAMERICA, 1.6, 2, [-30.0, 0.0, 30.0, 262.0]));
        save("pyramid-foot-0.1", picture(TRANSAMERICA, 0.1, 2, [-30.0, 0.0, 30.0, 40.0]));
        save("ferry-front-0.2", picture(FERRY_BUILDING, 0.2, 2, [FB_NORTH - 2.0, 0.0, FB_SOUTH + 2.0, 72.0]));
        save("ferry-tower-0.1", picture(FERRY_BUILDING, 0.1, 2, [-10.0, 30.0, 10.0, 71.0]));
        save("ferry-front-1.6", picture(FERRY_BUILDING, 1.6, 2, [FB_NORTH - 2.0, 0.0, FB_SOUTH + 2.0, 72.0]));
        save("sutro-0.8", picture(SUTRO_TOWER, 0.8, 2, [-40.0, 0.0, 40.0, 300.0]));
        save("sutro-end-0.8", picture(SUTRO_TOWER, 0.8, 0, [-40.0, 0.0, 40.0, 300.0]));
        save("sutro-3.2", picture(SUTRO_TOWER, 3.2, 2, [-40.0, 0.0, 40.0, 300.0]));
        save("cityhall-0.2", picture(CITY_HALL, 0.2, 0, [-CH_WIDE - 2.0, 0.0, CH_WIDE + 2.0, 95.0]));
        save("cityhall-1.6", picture(CITY_HALL, 1.6, 0, [-CH_WIDE - 2.0, 0.0, CH_WIDE + 2.0, 95.0]));
        save("finearts-0.2", picture(FINE_ARTS, 0.2, 0, [-36.0, 0.0, 54.0, 50.0]));
        save("finearts-1.6", picture(FINE_ARTS, 1.6, 0, [-36.0, 0.0, 54.0, 50.0]));
        for s in [0.8, 1.6, 3.2, 6.4, 12.8] {
            save(&format!("gate-side-{s}"), picture(GOLDEN_GATE, s, 2, [GG_SOUTH, -10.0, -600.0, 235.0]));
        }
    }

    #[test]
    fn city_hall_roof_matches_the_survey_sections() {
        // Heights above the 17.6 m BAY1 foot at centres of 1 m samples in both City Hall squares.
        for (u, w, measured) in [
            (44.5, -0.5, 25.2), (22.5, -6.5, 11.1), (28.5, -8.5, 13.1),
            (53.5, 42.5, 23.0), (28.5, 23.5, 25.1), (5.5, -39.5, 29.3), (19.5, -1.5, 34.6),
            (8.5, -0.5, 67.5), (-4.5, -1.5, 69.8), (1.5, -1.5, 84.4),
        ] {
            let top = (0..95).rev().find(|&y| city_hall(u, y as f32 + 0.5, w, 1.0) != 0)
                .map_or(0.0, |y| (y + 1) as f32);
            assert!((top - measured).abs() <= 1.2, "at ({u}, {w}): roof {top} m, lidar {measured} m");
        }
    }

    #[test]
    fn city_hall_lantern_opens_below_its_finial() {
        let (u, w) = (0.5, -1.5);
        assert_eq!(city_hall(u, 76.0, w, 0.2), 0, "sky between the lantern columns");
        assert_ne!(city_hall(u + 2.6, 76.0, w, 0.2), 0, "lantern shaft");
        assert_eq!(city_hall(u + 4.0, 84.0, w, 0.2), 0, "narrow spire");
        assert_ne!(city_hall(u, 93.5, w, 0.2), 0, "published finial height");
        assert_eq!(city_hall(u, 93.7, w, 0.2), 0);
    }

    #[test]
    fn city_hall_owns_the_courts_and_leaves_the_sidewalk_to_the_map() {
        for (u, w) in [(43.0, 47.0), (63.3, 3.0), (38.0, -48.0), (0.0, 52.0)] {
            assert!(!owns(CITY_HALL, u, 2.0, w));
            assert_eq!(city_hall(u, -1.0, w, 0.4), 0, "foundation at ({u}, {w})");
        }
        assert!(owns(CITY_HALL, 28.0, 20.0, -9.0));
        assert!(owns(CITY_HALL, 3.0, 6.0, 48.0));
    }

    /// How wide the tower's outline is at a height, seen square on, in cells of `s`.
    fn width(y: f32, s: f32) -> f32 {
        let n = (80.0 / s) as i32;
        (-n..n).filter(|&i| (-n..n).any(|k| salesforce(i as f32 * s + s / 2.0, y, k as f32 * s + s / 2.0, s) != 0)).count() as f32 * s
    }

    #[test]
    fn the_tower_draws_in_as_it_was_measured_at_every_size_of_cell() {
        for s in [0.1f32, 0.4, 1.6, 6.4] {
            let (foot, mid, high) = (width(40.0 + s / 2.0, s), width(240.0 + s / 2.0, s), width(318.0 + s / 2.0, s));
            assert!((foot - 53.8).abs() <= 2.0 * s + 1.0, "{s} m cells: {foot} m wide at its foot");
            assert!((mid / foot - 0.86).abs() < 0.05 + s / 50.0, "{s} m cells: {mid} of {foot} at 240 m");
            assert!((high / foot - 0.56).abs() < 0.06 + s / 25.0, "{s} m cells: {high} of {foot} at 318 m");
        }
        // Clear sky on both sides at Ina and Potrero. Across the flats (in 0.8 m far cells),
        // the silhouette at world heights 290, 315 and 325 m includes the outer screen.
        for (world, metres) in [(290.0, 39.0), (315.0, 32.5), (325.0, 29.0)] {
            let measured = width(world - 4.1, 0.8);
            assert!((measured - metres).abs() <= 1.2, "at {world} m: {measured} m across the crown");
        }
        assert_eq!(salesforce(0.0, 326.5, 0.0, 0.1), 0);
        assert_eq!(salesforce(40.0, 100.0, 0.0, 0.1), 0);
    }

    #[test]
    fn a_sunshade_is_one_row_of_coarse_cells_and_the_crown_is_open_near() {
        // Up one flat's middle, in cells of 0.8 m: one row in each floor is the sunshade.
        let rows = (40..140).filter(|&j| salesforce(SF_HALF - 0.4, j as f32 * 0.8 + 0.4, 0.3, 0.8) == kind(STEEL, WHITE)).count();
        assert!((17..=19).contains(&rows), "{rows} rows of sunshade in 80 m");
        // The crown's skin at 10 cm is mostly air; in cells of 1.6 m it is shut.
        let a = SF_HALF * between(&SF_TAPER, 300.05);
        let open = (0..200).filter(|&i| salesforce(a - 0.05, 300.05 + i as f32 * 0.1, 1.0 + i as f32 * 0.013, 0.1) == 0).count();
        assert!(open > 100, "{open} of 200 cells of the crown's skin are air");
        assert_ne!(salesforce(SF_HALF * between(&SF_TAPER, 300.8) - 0.8, 300.8, 0.8, 1.6), 0);
    }

    #[test]
    fn the_bridge_keeps_its_figures_and_its_cables_at_every_size_of_cell() {
        // The towers stand 227 m over the water, 640 m either side of the middle; the roadway is 78 m up in the
        // middle and 75 m at a tower; under the main span there is only air down to the water.
        for u in [-GG_TOWER, GG_TOWER] {
            assert_ne!(golden_gate(u, 226.95, GG_PLANE, 0.1), 0);
            assert_eq!(golden_gate(u, 227.05, GG_PLANE, 0.1), 0);
        }
        assert_eq!(material(golden_gate(0.05, 77.95, 2.05, 0.1)), ASPHALT);
        assert_eq!(golden_gate(0.05, 78.25, 2.05, 0.1), 0);
        // Movable concrete/yellow median barrier runs down the centre line of the 6-lane deck (#60).
        assert_eq!(material(golden_gate(0.05, 78.25, 0.05, 0.1)), CONCRETE);
        assert_eq!(material(golden_gate(600.05, 75.3, 3.05, 0.1)), ASPHALT);
        assert!((1..600).all(|j| golden_gate(300.05, j as f32 * 0.1 + 0.05, 0.05, 0.1) == 0));
        // Past a quarter of the way along the span, between two hangers, a cable is 119 m up: in every size of cell one cell of it or two
        // stand in its plane there, and that is where they are.
        for s in [0.1f32, 0.4, 1.6, 6.4, 12.8] {
            let (u, w) = ((327.0 / s).floor() * s + s / 2.0, (GG_PLANE / s).floor() * s + s / 2.0);
            let high = gg_cable(u).unwrap().0;
            let held: Vec<f32> = (0..(230.0 / s) as i32).map(|j| j as f32 * s + s / 2.0).filter(|&y| y > 90.0 && golden_gate(u, y, w, s) != 0).collect();
            assert!(!held.is_empty() && held.len() as f32 * s <= 1.2f32.max(2.0 * s), "{s} m cells: {held:?}");
            assert!(held.iter().all(|y| (y - high).abs() <= 0.6f32.max(s)), "{s} m cells: {held:?} against {high}");
        }
        // A hanger is visible through cells of 1.6 m and left out at 3.2 m (#60).
        let hanger = |s: f32| (-1..=1).any(|i| golden_gate(((15.24 * 10.0 / s).floor() + i as f32) * s + s / 2.0, 84.0 + s / 2.0, (GG_PLANE / s).floor() * s + s / 2.0, s) != 0);
        assert!(hanger(0.4));
        assert!(hanger(1.6));
        assert!(!hanger(3.2));
    }

    #[test]
    fn the_pyramid_comes_to_a_point_with_wings_and_the_bay_bridge_hangs_between_its_towers() {
        // The pyramid: 46.2 m square at 30 m up, a point at 260 m; a wing stands out of two faces at 170 m and not of the other two.
        for s in [0.1f32, 1.6] {
            let wide = |y: f32| (-400..400).filter(|&i| transamerica(i as f32 * s + s / 2.0, y, 20.0, s) != 0 || transamerica(i as f32 * s + s / 2.0, y, s / 2.0, s) != 0).count() as f32 * s;
            assert!((wide(30.0 + s / 2.0) - 46.2).abs() <= 2.0 * s, "{s} m cells: {} m wide at 30 m", wide(30.0 + s / 2.0));
            assert!(wide(258.0 + s / 2.0) <= 0.5 + 2.0 * s);
        }
        let half = 23.1 * 90.0 / 230.0;
        assert_ne!(transamerica(0.05, 170.05, half + 2.0, 0.1), 0);
        assert_eq!(transamerica(half + 2.0, 170.05, 0.05, 0.1), 0);
        // The Bay Bridge: a tower stands 160 m either side of each main span; half way along a main span the cable
        // is a little over the upper roadway, and there are two roadways there, one 7.6 m under the other.
        for (at, high) in BB_TOWERS {
            assert_ne!(bay_bridge(at, high - 0.05, BB_PLANE, 0.1), 0);
            assert_eq!(bay_bridge(at, high + 0.05, BB_PLANE, 0.1), 0);
        }
        let middle = (BB_TOWERS[2].0 + BB_TOWERS[3].0) / 2.0;
        let cable = bb_cable(middle).unwrap().0;
        assert!(cable > BB_ROAD + 3.0 && cable < BB_ROAD + 14.0, "the cable is {cable} m up at the middle of a span");
        assert_eq!(material(bay_bridge(middle, BB_ROAD - 0.05, 0.05, 0.1)), ASPHALT);
        assert_eq!(material(bay_bridge(middle, BB_ROAD - 7.65, 0.05, 0.1)), ASPHALT);
        assert_eq!(bay_bridge(middle, BB_ROAD - 4.0, 0.05, 0.1), 0);
        assert_eq!(bay_bridge(middle, 30.0, 0.05, 0.1), 0);
    }

    #[test]
    fn the_far_model_has_faces_on_every_side_and_no_more_than_its_cells_allow() {
        let r = reach(SALESFORCE).unwrap();
        let step = 32;
        let s = step as f32 * 0.1;
        let from = [(r[0] / s).floor() as i32, 0, (r[2] / s).floor() as i32];
        let size = [((r[3] - r[0]) / s).ceil() as i32, (r[4] / s).ceil() as i32, ((r[5] - r[2]) / s).ceil() as i32];
        let n = faces(SALESFORCE, step, from, size);
        assert!(n > 2000 && n % 2 == 0, "{n} words");
        let words = FACES.with_borrow(|f| f.clone());
        let mut looks = [0usize; 6];
        for f in words.chunks_exact(2) {
            let (long, axis, side) = ((f[1] & 255) as i32, (f[1] >> 8 & 3) as usize, (f[1] >> 10 & 1) as usize);
            looks[axis * 2 + side] += 1;
            let start = [(f[0] & 1023) as i32, (f[0] >> 10 & 1023) as i32, (f[0] >> 20 & 1023) as i32];
            assert!(long > 0 && start[0] < size[0] && start[1] < size[1] && start[2] < size[2]);
            assert_ne!(f[1] >> 16, 0);
        }
        assert!(looks.iter().all(|&n| n > 50), "{looks:?}");
    }

    #[test]
    fn golden_gate_north_approach_follows_highway_101_down_to_its_measured_landing() {
        // Overture's two US 101 carriageways (2026-10-21.0, transportation segments 1b5877f0, 82e8434e) leave the
        // bridge's axis at u 1220 m and land 70 m to the ocean side at u 1413 m, where tile 0/182_250 has its ground
        // at 73.0 m. A deck straight on to u 1360 would stand in the Vista Point car park.
        let deck = |u: f32, w: f32, ground: f32| {
            let road = gg_road(u);
            material(kind_at_world(GOLDEN_GATE, u, road - 0.05, road - 0.05 - ground, w, 0.1))
        };
        assert_eq!(deck(1360.0, -37.7, 47.9), ASPHALT, "the approach deck over the gully, on 101's line");
        assert_eq!(deck(1360.0, 0.0, 57.0), 0, "no deck off 101's line");
        assert_eq!(deck(1410.0, -69.8, 72.0), ASPHALT, "the deck reaches the abutment");
        assert_eq!(deck(1411.25, -65.7, 72.5), ASPHALT, "the last half metre of clearance stays bridged");
        assert!((gg_road(1413.0) - 73.0).abs() < 0.3, "and meets the ground there: {}", gg_road(1413.0));
        assert_eq!(deck(1430.0, -81.0, 73.7), 0, "past the landing the road is the ground's");
        // Under the deck the draped copy of the same carriageways is ground, not a second road; the gully's own
        // service roads and trails to either side keep their class.
        assert!(draped_north_highway(1250.0, -3.0, 20.0));
        assert!(draped_north_highway(1360.0, -37.7, 47.9));
        assert!(!draped_north_highway(1250.0, -36.0, 23.0));
        assert!(!draped_north_highway(1420.0, -77.0, 73.3));
        assert!(!owns(GOLDEN_GATE, 1360.0, 0.0, 0.0));
        assert!(owns(GOLDEN_GATE, 1360.0, 0.0, -37.7));
        assert_ne!(kind_at(GOLDEN_GATE, 1360.0, gg_road(1360.0) - 0.05, -37.7, 0.1), 0);
    }

    #[test]
    fn golden_gate_leaves_the_marin_gully_open_in_near_and_distant_views() {
        // Marin tile 0/183_250 (#60): 636 m north of the main span's middle, 40 m to the bay side, the ground is 17 m
        // over the water and the deck 67 m. The stand-in bluff made a black wall of rock between them.
        let world = |y: f32, ground: f32| kind_at_world(GOLDEN_GATE, 1276.0, y, y - ground, 40.0, 0.4);
        assert_eq!(world(40.0, 17.0), 0, "rock bluff over Marin's own hillside");
        assert_eq!(world(40.0, -3.0), 0, "water cells do not generate a projecting cliff");
        assert_eq!(kind_at(GOLDEN_GATE, 1276.0, 40.0, 40.0, 0.4), 0, "far bridge faces must leave room for the measured gully");
        assert!(!owns(GOLDEN_GATE, 1276.0, 40.0, 40.0));
        // The north anchorage block still stands on the real ground under the deck.
        assert_eq!(material(kind_at_world(GOLDEN_GATE, 1080.0, 50.0, 50.0 - 26.0, 0.0, 0.4)), CONCRETE);
    }

    #[test]
    fn suspension_bridges_own_their_spans_in_far_and_high_cells_while_keeping_shore_below() {
        assert!(owns(GOLDEN_GATE, -800.0, 0.0, 0.0));
        assert!(owns(GOLDEN_GATE, -800.0, 60.0, 14.0));
        assert!(!owns(GOLDEN_GATE, -800.0, 10.0, 0.0));
        assert!(!owns(GOLDEN_GATE, -800.0, 60.0, 40.0));
        assert!(owns(BAY_BRIDGE, 0.0, 0.0, 0.0));
        assert!(owns(BAY_BRIDGE, 0.0, 50.0, 10.0));
        assert!(!owns(BAY_BRIDGE, 0.0, 10.0, 0.0));
        // Golden Gate also owns its south anchorage (clearing the embedded building at u=-1149 m) and south pier
        // fender (clearing the concrete lidar spike beside the pier), while keeping Fort Point under the arch (#60).
        assert!(owns(GOLDEN_GATE, -1149.0, 40.0, -3.0));
        assert!(owns(GOLDEN_GATE, -640.0, 10.0, 44.0));
        assert!(!owns(GOLDEN_GATE, -1022.0, 10.0, 28.0));
    }

    #[test]
    fn every_sf_landmark_has_reach_night_and_distinct_geometry() {
        let all = [
            SALESFORCE, GOLDEN_GATE, TRANSAMERICA, BAY_BRIDGE, FERRY_BUILDING, SUTRO_TOWER, CITY_HALL, FINE_ARTS,
            FORT_POINT, ACADEMY_SCIENCES, JAPANESE_TEA_GARDEN, BOTANICAL_GARDEN, CONSERVATORY, PAINTED_LADIES, DE_YOUNG,
        ];
        for sort in all {
            assert!(reach(sort).is_some(), "missing reach for sort {sort}");
            assert!(night(sort).is_some(), "missing night for sort {sort}");
        }
        // Fort Point: red brick casemates + open central parade courtyard.
        assert_eq!(material(fort_point(30.0, 8.0, 0.0, 0.2)), BRICK);
        assert_eq!(fort_point(0.0, 8.0, 0.0, 0.2), 0);
        // The measured high domes flank the glazed piazza at the same depth. The plaza path behind the
        // museum is only 5.5 m wide, so the canopy must release the gardens to either side of it.
        let surface = |u, w| academy_sciences(u, academy_roof_height(u, w) - 0.1, w, 0.2);
        assert_eq!(material(surface(-30.0, -18.0)), GLASS);
        assert_eq!(material(surface(-29.25, -18.0)), STEEL);
        assert_eq!(material(surface(0.0, -19.0)), GLASS);
        assert_eq!(material(surface(19.0, -19.0)), GRASS);
        assert_eq!(material(academy_sciences(1.3, 6.0, -55.8, 0.2)), GLASS);
        // Conservatory Valley has planted parterres downhill of the public galleries.
        assert_eq!(surface_at(CONSERVATORY, 0.0, 72.0, 71.0, 0.2).map(material), Some(LEAVES));
        // Painted Ladies: all 7 distinct houses rise sequentially up Steiner St with pitched slate roofs.
        for (idx, &(um, base)) in [(-21.15f32, 0.0f32), (-12.25, 0.8), (-5.2, 1.4), (1.85, 2.2), (8.8, 2.8), (16.05, 3.4), (23.25, 4.0)].iter().enumerate() {
            assert_ne!(painted_ladies(um, base + 4.0, 6.0, 0.2), 0, "house at u={um}");
            let peak = if idx == 0 { CORNER_CROWN - 0.15 } else { 13.25 };
            assert_eq!(material(painted_ladies(um, base + peak, 0.0, 0.2)), ROOFING, "gable roof at u={um}");
        }
        // de Young Museum: copper cladding and twisting 44 m Hamon Observation Tower.
        assert_eq!(material(de_young(0.0, 10.0, 33.2, 0.2)), STEEL);
        assert_eq!(material(de_young(-53.0, 39.0, 8.9, 0.2)), GLASS);
        assert_ne!(de_young(-63.0, 42.5, 23.0, 0.2), 0);
        // Palace of Fine Arts: its lagoon is the terrain's water, not the rule's (#60).
        assert_eq!(surface_at(FINE_ARTS, 55.0, 0.0, 0.6, 0.2), None);
    }
    /// The Palace of Fine Arts stands on what is surveyed (#60): OSM's parts (ways named at `PF_TEMPLE` and below)
    /// for where, the lidar in square 9's grid and the NPS listing for how high. From the rotunda's middle (0.6, 0.8)
    /// the median top over 32 bearings at each radius is the lidar's within a metre and a half: a dome 49 m up and no
    /// finial over it, the drum at 40, the deck at 36.8 and its outer step at 28.5 m.
    #[test]
    fn palace_rotunda_and_arcades_stand_on_their_surveyed_parts() {
        let top = |u: f32, w: f32| (0..270).map(|i| 53.9 - i as f32 * 0.2).find(|&y| kind_at(FINE_ARTS, u, y, w, 0.2) != 0);
        for (r, want) in [(0.0f32, 49.0f32), (5.0, 48.4), (10.0, 46.5), (15.0, 41.6), (17.0, 39.9), (19.0, 36.8), (23.0, 28.4)] {
            let mut tops: Vec<f32> = (0..32)
                .map(|i| {
                    let a = i as f32 * std::f32::consts::TAU / 32.0;
                    top(0.6 + r * a.cos(), 0.8 + r * a.sin()).unwrap_or(0.0)
                })
                .collect();
            tops.sort_by(f32::total_cmp);
            let median = (tops[15] + tops[16]) / 2.0;
            assert!((median - want).abs() <= 1.5, "at {r} m the median top is {median}, the lidar's {want}");
        }
        assert_eq!(kind_at(FINE_ARTS, 0.6, 50.5, 0.8, 0.2), 0, "no finial over the dome");
        // The piers are where OSM maps them (way 1549377334 at the west), 23 m out, and under the deck the arches open.
        assert_ne!(kind_at(FINE_ARTS, -22.5, 20.0, -4.5, 0.2), 0);
        assert_eq!(kind_at(FINE_ARTS, -24.8, 10.0, -4.5, 0.2), 0, "past 25.4 m out a pier is only its foot");
        assert_ne!(kind_at(FINE_ARTS, -24.8, 4.0, -4.5, 0.2), 0);
        assert_eq!(kind_at(FINE_ARTS, -21.5, 8.0, 4.5, 0.2), 0, "the west arch between ways 1549377334 and 1549377335");
        // No colonnade on a ring round the west: that is the exhibition hall (way 288371302), the map's.
        assert_eq!(kind_at(FINE_ARTS, -62.0, 16.4, 0.0, 0.2), 0);
        assert!(!owns(FINE_ARTS, -62.0, 5.0, 0.0));
        assert!(!owns(FINE_ARTS, -45.0, 5.0, 40.0));
        // The two arcades are the mapped ways 288371306 (south) and 288371310 (north), with their gateways.
        assert_ne!(kind_at(FINE_ARTS, 12.0, 16.5, 72.6, 0.2), 0, "the south arcade's entablature");
        assert_ne!(kind_at(FINE_ARTS, -23.4, 16.5, -52.5, 0.2), 0, "the north arcade's entablature");
        assert!(owns(FINE_ARTS, -2.3, 10.0, -104.0), "the north gateway, way 288371313");
        assert!(owns(FINE_ARTS, 31.2, 10.0, 102.0), "the south gateway, way 288371314");
        let r = reach(FINE_ARTS).unwrap();
        assert!(r[2] <= -113.0 && r[5] >= 108.0 && r[0] <= -36.5 && r[3] >= 52.8, "{r:?}");
        // Columns stand apart along the arcade: at 8 m up some of its middle line is air.
        let air = (0..40).filter(|i| kind_at(FINE_ARTS, 31.0 + *i as f32 * 0.25, 8.0, 74.0, 0.2) == 0).count();
        assert!(air > 8 && air < 36, "{air} of 40 cells along the arcade at 8 m are air");
        // Edges of three small, independent DataSF plinths close to the rotunda steps.
        for (u, w) in [(14.5, -29.0), (23.4, 24.3), (29.0, 15.7)] {
            assert!(!owns(FINE_ARTS, u, 10.0, w), "took adjacent plinth at {u}, {w}");
        }
        // The lagoon and its islands are the terrain's: no water or coping by a height threshold, no box owned.
        for (u, w) in [(55.0, 0.0), (40.0, -50.0), (80.0, 60.0)] {
            assert_eq!(surface_at(FINE_ARTS, u, w, 0.6, 0.2), None);
            assert!(!owns(FINE_ARTS, u, 1.0, w));
        }
        // What else is mapped round the rotunda stays the map's: way 288371317 (16 m) and the low ways beside it.
        assert!(!owns(FINE_ARTS, 16.6, 10.0, -29.0));
        assert!(!owns(FINE_ARTS, 25.0, 1.0, 24.2));
        assert!(!owns(FINE_ARTS, 24.0, 1.0, -23.4));
    }

    #[test]
    fn palace_archways_clear_the_streamed_building_walls() {
        // Wall cells sampled at 10 m up in near tile 194_263: the west arch of the
        // rotunda, its east approach, then the north and south colonnades.
        for (u, w) in [(-21.9, 3.5), (-21.0, 6.3), (26.0, 0.8), (-27.0, -51.0), (-12.5, 57.0),
                          // Midpoints of 1 m distant wall faces in 97_131 on two lagoon-side openings.
                          (23.2, -2.9), (20.1, 12.6)] {
            assert!(owns(FINE_ARTS, u, 10.0, w), "ordinary wall at {u}, {w}");
            assert_eq!(kind_at(FINE_ARTS, u, 10.0, w, 0.1), 0, "blocked opening at {u}, {w}");
        }
    }

    #[test]
    fn palace_piers_have_two_engaged_shafts_on_each_outer_face() {
        for pier in 0..8 {
            let a = (13.0 + 45.0 * pier as f32).to_radians();
            let at = |out: f32, across: f32| fine_arts(
                PF_MID.0 + out * a.cos() - across * a.sin(), 12.0,
                PF_MID.1 + out * a.sin() + across * a.cos(), 0.2);
            for side in [-3.1, 3.1] {
                assert_eq!(at(24.5, side), kind(CONCRETE, colour(1, 2)), "pier {pier}, shaft {side}");
            }
            assert_eq!(at(24.5, 0.0), 0, "recess between the shafts on pier {pier}");
            assert_ne!(at(23.6, 0.0), 0, "pier backing below the deck");
        }
    }

    #[test]
    fn conservatory_walk_climbs_eighteen_level_stone_treads() {
        let mut last = -3.5;
        for i in 0..18 {
            let w = 49.85 - (i as f32 + 0.5) * (7.0 / 18.0);
            let top = conservatory_stairs(0.6, w).unwrap();
            assert!((top - last - 2.8 / 18.0).abs() < 0.001);
            for u in [-5.0, 3.0, 7.0] {
                assert_eq!(conservatory_stairs(u, w - 0.1), Some(top));
                assert_eq!(material(kind_at(CONSERVATORY, u, top - 0.05, w, 0.1)), CONCRETE);
                assert_eq!(kind_at(CONSERVATORY, u, top + 0.3, w, 0.1), 0);
            }
            last = top;
        }
        assert!(conservatory_stairs(-7.5, 46.0).is_none());
        assert!(conservatory_stairs(0.6, 54.0).is_none());
    }

    #[test]
    fn conservatory_roof_follows_the_survey_across_the_public_galleries() {
        // Independent lidar columns in 546.7_4180.5, metres over the 74.4 m terrace.
        for (u, w, height) in [
            (-15.5, 2.5, 5.2), (16.5, -2.5, 2.6), (32.5, 10.5, 5.3),
            (1.5, 2.5, 18.3), (1.5, 6.5, 13.4), (1.5, 9.5, 8.9), (1.5, 15.5, 5.1),
        ] {
            let top = (0..240).rev().map(|n| n as f32 * 0.1)
                .find(|&y| conservatory(u, y, w, 0.2) != 0).unwrap_or_default();
            assert!((top - height).abs() < 0.9, "at {u}, {w} expected {height} m, drew {top}");
        }
        for size in [0.4_f32, 0.8, 1.0, 1.6] {
            for (u, w) in [(-15.5, 1.5), (16.5, 1.5), (2.5, 3.5)] {
                let hits = (0..64).map(|i| (i as f32 + 0.5) * size)
                    .any(|y| y > 3.5 && conservatory(u, y, w, size) != 0);
                assert!(hits, "roof missing at {u}, {w} with {size} m cells");
            }
        }
        // The long central border is flanked by walks, then four beds. The original medallion
        // covered those walks and erased the palms standing above them.
        for (u, w, flowers) in [(0.7, 91.0, true), (-21.2, 59.0, true), (32.0, 39.6, true),
                                (4.5, 60.0, false), (-21.2, 63.0, false), (0.0, 45.0, false)] {
            assert_eq!(conservatory_surface(u, w, 0.2).is_some(), flowers);
            assert!(!owns(CONSERVATORY, u, 4.0, w));
            assert_eq!(kind_at(CONSERVATORY, u, 0.2, w, 0.2), 0, "far foliage must follow terrain");
        }
        // The separated rear growing houses and both projection kiosks keep their surveyed cells.
        for (u, w) in [(16.0, -10.0), (-9.8, 28.0), (10.5, 28.0)] {
            assert!(!owns(CONSERVATORY, u, 4.0, w));
            assert_eq!(conservatory(u, 4.0, w, 0.2), 0);
            assert_eq!(conservatory_surface(u, w, 0.2), None);
        }
    }

    #[test]
    fn hamon_observation_deck_follows_the_surveyed_parallelogram() {
        // Local 0.25 m lidar reads 117.5–117.7 m at the first two points, and 75–80 m at the last two.
        // The deck spans the front and back of the long parallelogram, with the gallery or park beside it.
        for (u, w) in [(-53.0, 12.0), (-75.0, 36.0)] {
            assert_ne!(de_young(u, 42.0, w, 0.4), 0, "missing observation deck at {u}, {w}");
        }
        for (u, w) in [(-72.0, 20.0), (-74.0, 22.0)] {
            assert_eq!(de_young(u, 42.0, w, 0.4), 0, "tower over the park at {u}, {w}");
        }
    }

    #[test]
    fn academy_roof_matches_the_surveyed_domes_and_south_canopy_edge() {
        // In the raw lidar both summits are about 22.3 m above the registry datum. At w=52 m
        // the DataSF ring is only the narrow central walkway. The garden 40 m to its side is open.
        assert_ne!(kind_at(ACADEMY_SCIENCES, -30.0, 21.5, -18.0, 0.2), 0);
        assert_ne!(kind_at(ACADEMY_SCIENCES, 30.0, 21.5, -18.0, 0.2), 0);
        assert!(!owns(ACADEMY_SCIENCES, 40.0, 12.0, 52.0));
        assert_eq!(kind_at(ACADEMY_SCIENCES, 40.0, 12.0, 52.0, 0.4), 0);
    }


    #[test]
    fn dry_landscape_follows_the_project_location_plan() {
        let surface = |u, w| surface_at(JAPANESE_TEA_GARDEN, u, w, 75.0, 0.2).map(material);
        // Across the broad southwest end, along the narrow northeast end, and into its planted margins.
        for (u, w) in [(-49.0, -1.0), (-48.0, -4.0), (-42.5, -12.0)] {
            assert_eq!(surface(u, w), Some(SAND), "gravel at {u}, {w}");
        }
        for (u, w) in [(-52.0, -5.0), (-41.0, -5.0), (-47.0, 3.0)] {
            assert_eq!(surface(u, w), Some(GRASS), "planting at {u}, {w}");
        }
        // The two plan symbols and the open gravel between them.
        let above = |u, w, y| kind_at_world(JAPANESE_TEA_GARDEN, u, y, y, w, 0.1);
        assert_eq!(material(above(-44.8, -6.9, 0.12)), GRASS);
        assert_eq!(material(above(-44.85, -9.86, 0.12)), ROCK);
        assert_eq!(above(-44.85, -8.6, 0.12), 0);
        assert_eq!(above(-48.0, -4.0, 0.7), 0, "no trunk in the gravel");
    }

    #[test]
    fn tea_garden_has_no_gravel_or_boulders_at_the_old_target() {
        for (u, w) in [(-31.0, 29.0), (-25.0, 34.0), (-37.0, 24.0)] {
            assert_eq!(surface_at(JAPANESE_TEA_GARDEN, u, w, 75.0, 0.2).map(material), Some(GRASS));
            assert_eq!(kind_at_world(JAPANESE_TEA_GARDEN, u, 0.8, 0.8, w, 0.2), 0);
        }
    }

    /// The gardens' parts stand where OpenStreetMap maps them (#60). Each place is an OSM way's middle in the
    /// landmark's frame (u east, w south of its `at`); the ways are named at the constants in this file.
    #[test]
    fn tea_garden_parts_stand_on_their_mapped_footprints() {
        let g = |u: f32, y: f32, w: f32| japanese_tea_garden(u, y, w, 0.2);
        // The Pagoda (way 34221099) at (-17.8, 9.2), 8.2 m across: a storey at its middle, and nothing 22 m north
        // of it where it was drawn before (-16, -12).
        assert_ne!(g(-17.8, 3.0, 9.2), 0);
        assert!(!matches!(material(g(-17.8, 3.0, 9.2)), LEAVES));
        assert_eq!(g(-16.0, 3.0, -12.0), 0);
        assert_eq!(g(-17.8, 3.0, 9.2 + 6.5), 0, "the pagoda keeps to its 8.2 m footprint");
        // The Tea House (way 34220947) at (33.2, -21.9) in the north-east, not across the garden at (-14, 24).
        assert_ne!(g(33.2, 2.0, -21.9), 0);
        assert_eq!(g(-14.0, 2.0, 24.0), 0);
        // The Drum Bridge (way 136898969) crosses at (30.75, 3.0), running north and south.
        assert_eq!(material(g(30.75, 2.1, 3.0)), WOOD);
        assert_eq!(g(9.0, 4.0, 8.0), 0);
        // The Main Gate (way 494967002, node 392430963) at (57.5, -3.9).
        assert_ne!(g(57.5, 6.0, -3.9), 0);
        assert_eq!(g(42.0, 6.0, -2.0), 0);
        // The pond (way 409163924) is water inside its outline, and the old invented lobe at (2, 13) is not.
        assert_eq!(surface_at(JAPANESE_TEA_GARDEN, 20.0, 38.0, 75.0, 0.2).map(material), Some(WATER));
        assert_ne!(surface_at(JAPANESE_TEA_GARDEN, 2.0, 13.0, 75.0, 0.2).map(material), Some(WATER));
        // Outside the mapped fence (way 30900516) the park is the map's own: the old square's corner, the drive.
        assert!(!owns(JAPANESE_TEA_GARDEN, 58.0, 2.0, 55.0));
        assert!(!owns(JAPANESE_TEA_GARDEN, -58.0, 2.0, -58.0));
        assert_eq!(surface_at(JAPANESE_TEA_GARDEN, 58.0, 55.0, 75.0, 0.2), None);
        assert!(owns(JAPANESE_TEA_GARDEN, 0.0, 2.0, 0.0));
        // Mapped buildings the rule does not draw stay the map's: the Gift Shop and the Temple Gate.
        assert!(!owns(JAPANESE_TEA_GARDEN, 35.1, 2.0, -37.1));
        assert!(!owns(JAPANESE_TEA_GARDEN, -9.1, 2.0, 25.2));
        assert_eq!(g(35.1, 2.0, -37.1), 0);
    }

    #[test]
    fn botanical_garden_draws_only_what_is_mapped_in_its_box() {
        let g = |u: f32, y: f32, w: f32| botanical_garden(u, y, w, 0.2);
        // The Great Meadow (way 476290501) is grass: no invented pond or Moon Viewing Pavilion on it.
        assert_eq!(surface_at(BOTANICAL_GARDEN, -26.0, -4.0, 74.0, 0.2).map(material), Some(GRASS));
        assert_eq!(g(-10.0, 1.5, -4.0), 0);
        // No glasshouse at the gate: nothing of the rule's is glass anywhere in its box.
        for u in (-76..=76).step_by(2) {
            for w in (-56..=56).step_by(2) {
                for y in [1.0, 3.0, 6.0] {
                    assert_ne!(material(g(u as f32, y, w as f32)), GLASS, "glass at ({u}, {y}, {w})");
                }
            }
        }
        // The fountain (way 1036243321) at (26.2, 21.3), its pool water and its court gravel.
        assert_eq!(surface_at(BOTANICAL_GARDEN, 26.2, 21.3 + 0.6, 74.0, 0.2).map(material), Some(WATER));
        assert_eq!(surface_at(BOTANICAL_GARDEN, 26.2 - 5.0, 21.3, 74.0, 0.2).map(material), Some(SAND));
        // The County Fair Building (way 25822470) and the ticket kiosk (way 839987588) are the map's, not erased.
        assert!(!owns(BOTANICAL_GARDEN, 45.0, 3.0, 25.0));
        assert_eq!(g(45.0, 3.0, 25.0), 0);
        assert_eq!(surface_at(BOTANICAL_GARDEN, 45.0, 25.0, 74.0, 0.2), None);
        assert!(!owns(BOTANICAL_GARDEN, 43.5, 2.0, -3.7));
        assert!(owns(BOTANICAL_GARDEN, 0.0, 2.0, 0.0));
    }

    #[test]
    fn the_garden_leaves_the_surveyed_southern_ponds_to_the_terrain() {
        for (u, w) in [(-17.0, 63.0), (-57.0, 75.0), (-62.0, 112.0)] {
            assert_eq!(botanical_surface(u, w, 0.2), None);
            assert!(!owns(BOTANICAL_GARDEN, u, 1.0, w));
            assert_eq!(botanical_garden(u, 0.5, w, 0.2), 0);
        }
    }

    #[test]
    fn steiner_corner_has_two_bays_and_a_recessed_entrance() {
        // Cross-sections of way 261412887 at 722 Steiner. The upper limit on the square bay is
        // independently visible at 67.5 m above the Bay in the 0.25 m lidar (base 60.6 m).
        let front = |u: f32, y: f32| {
            (50..=115).rev().map(|i| i as f32 * 0.1)
                .find(|&w| painted_ladies(u, y, w, 0.1) != 0).unwrap_or(0.0)
        };
        for (u, w) in [(-23.8, 7.8), (-22.1, 6.3), (-19.5, 7.4), (-18.0, 6.7)] {
            assert!((front(u, 4.0) - w).abs() < 0.25, "at {u} got {} expected {w}", front(u, 4.0));
        }
        assert!(front(-23.8, 8.0) < 6.5);
        assert!(front(-19.5, 8.0) > 7.0);
    }

    /// The owner saw seven like gables (#60). In the photo the dark corner house, 722, has a flat-crowned hipped
    /// roof, and only the six to its south have front gables. Sampled at the cells of every size the rule is baked
    /// at (0.2 m to the realm's 1.6 m) across each house's frontage 3 m above its eave, halfway back: 722's crown is
    /// roof over most of it, a gable only near its middle. On 722's front above the eave is roof or air, never a wall.
    #[test]
    fn painted_ladies_corner_house_is_hipped_and_the_six_are_gabled() {
        let houses = [(-21.15f32, 4.55f32, 0.0f32), (-12.25, 3.55, 0.8), (-5.2, 3.6, 1.4), (1.85, 3.45, 2.2), (8.8, 3.5, 2.8), (16.05, 3.45, 3.4), (23.25, 3.45, 4.0)];
        for (idx, &(um, hw, base)) in houses.iter().enumerate() {
            for s in [0.2f32, 0.4, 0.8, 1.6] {
                let eave = base + if idx == 0 { 10.4 } else { 9.4 };
                let y = ((eave + 3.0) / s).floor() * s + s / 2.0;
                let cells: Vec<f32> = (0..(2.0 * hw / s) as i32 + 2)
                    .map(|i| ((um - hw) / s).floor() * s + s / 2.0 + i as f32 * s)
                    .filter(|u| (u - um).abs() < hw - 0.1)
                    .collect();
                let share = cells.iter().filter(|&&u| painted_ladies(u, y, 0.0, s) != 0).count() as f32 / cells.len() as f32;
                if idx == 0 {
                    let width = share * cells.len() as f32 * s;
                    assert!(width > hw, "722's crown spans {width:.2} m of its {:.2} m frontage at {s} m cells", 2.0 * hw);
                } else {
                    // A 7 m frontage is only four or five columns at 1.6 m. Its measured lot position
                    // can put a narrow gable equally across two columns. Bound its width in metres.
                    let expected = (2.0 * hw) * (1.0 - (y - eave) / 4.0).max(0.0);
                    let width = share * cells.len() as f32 * s;
                    assert!((width - expected).abs() <= s + 0.01, "house {idx}: {width} m, expected {expected} at {s}");
                    if s <= 0.4 { assert!(share < 0.35); }
                }
            }
            if idx == 0 {
                for lu in [-3.0f32, -1.5, 0.0, 1.5, 3.0] {
                    for hy in [10.4f32, 11.4, 12.4] {
                        let k = painted_ladies(um + lu, base + hy, 8.1, 0.2);
                        assert!(k == 0 || material(k) == ROOFING, "722 front at lu={lu} hy={hy} is a wall, not roof");
                    }
                }
            } else {
                assert_ne!(painted_ladies(um, base + 12.4, 8.1, 0.2), 0, "house {idx} has a gable face");
            }
        }
    }
    #[test]
    fn conservatory_far_faces_include_four_open_palm_crowns() {
        // Read the actual packed face runs consumed by the far baker, in its 0.4 m cells.
        for (u, w, top) in [(-12.0_f32, 33.3_f32, 21.5_f32), (-10.5, 36.5, 21.4),
                             (11.4, 42.6, 16.7), (11.2, 33.7, 16.6)] {
            let from = [(u / 0.4).floor() as i32 - 12, 0, (w / 0.4).floor() as i32 - 12];
            faces(CONSERVATORY, 4, from, [25, 58, 25]);
            FACES.with_borrow(|words| {
                let mut trunk = false;
                let mut crown = std::collections::BTreeSet::new();
                let mut highest = 0.0_f32;
                for pair in words.chunks_exact(2) {
                    let (a, b) = (pair[0], pair[1]);
                    let axis = (b >> 8) & 3;
                    let x = ((a & 1023) as i32 + from[0]) as f32 * 0.4 + 0.2;
                    let y = ((a >> 10) & 1023) as f32 * 0.4 + 0.2;
                    let z = ((a >> 20) as i32 + from[2]) as f32 * 0.4 + 0.2;
                    let mat = material((b >> 16) as Kind);
                    if mat == WOOD && y > 3.0 && y < 6.0 && (x-u).hypot(z-w) < 0.8 {
                        trunk = true;
                    }
                    if axis == 1 && mat == LEAVES {
                        for n in 0..(b & 255) {
                            let dx = x + n as f32 * 0.4 - u;
                            let dz = z - w;
                            if dx.hypot(dz) < 1.0 { highest = highest.max(y); }
                            if dx.hypot(dz) > 3.0 && dx.hypot(dz) < 4.3 {
                                crown.insert((dz.atan2(dx).to_degrees() / 30.0).floor() as i32);
                            }
                        }
                    }
                }
                assert!(trunk && (highest - top).abs() < 1.0 && crown.len() >= 8,
                    "palm at {u}, {w}: trunk {trunk}, top {highest}, outer crown sectors {crown:?}");
            });
        }
    }

    #[test]
    fn conservatory_border_tapers_at_the_end_of_the_central_walk() {
        // Put the end of the mapped bed inside one 6.4 m sector of level terrain.
        // Count its emitted cells after the same Bay column pass the renderer uses.
        use crate::{bay, scratch::Scratch, tree::at};
        let ground = bay::ground(0, 0);
        bay::hero(CONSERVATORY, 20, -920, ground + 30, 0);
        let mut sector = Scratch::new();
        sector.start(0, ground.div_euclid(64), 0, 0);
        bay::make(&mut sector);
        let mut upper = 0;
        let mut lower = 0;
        for x in 8..48 {
            for z in 5..35 {
                for h in 1..14 {
                    let y = (ground - sector.low[1]) as usize + h;
                    if sector.cells[at(x, y, z)] != 0 {
                        if h >= 5 { upper += 1; } else { lower += 1; }
                    }
                }
            }
        }
        assert!(lower > 100 && upper * 24 < lower, "front border: {upper} upper cells, {lower} lower cells");
    }

    #[test]
    fn conservatory_blossoms_leave_gaps_along_the_stalk() {
        // At the engine's ten-centimetre resolution a bell or a pair of bells fits in two cells.
        // A solid half-metre column of petals made the foreground border look like masonry.
        let mut coloured_cells = 0;
        for i in 0..40 {
            for j in 0..40 {
                let (u, w) = (-1.2 + i as f32 * 0.1, 70.0 + j as f32 * 0.1);
                let mut run = 0;
                for k in 3..16 {
                    let y = k as f32 * 0.1 + 0.05;
                    let hue = valley_planting(u, y, w, 0.1).map(|kind| (kind >> 8) as u8);
                    if hue.is_some_and(|c| c == WHITE || c >= colour(16, 0)) {
                        run += 1;
                        coloured_cells += 1;
                        assert!(run <= 2, "solid blossom column at ({u}, {w}) through {y} m");
                    } else {
                        run = 0;
                    }
                }
            }
        }
        assert!(coloured_cells > 100, "the border must still have flowers");
    }

    #[test]
    fn conservatory_valley_flowers_stand_on_stems_inside_their_beds() {
        let cell = |u: f32, y: f32, w: f32, s: f32| kind_at_world(CONSERVATORY, u, y - 2.0, y, w, s);
        // The paths either side of the central border stay clear from the ground to over a head's height.
        for w in [60.0, 76.4, 90.0] {
            for y in [0.05, 0.6, 1.2, 1.9] {
                assert_eq!(cell(-2.2, y, w, 0.1), 0, "west path at w={w}, y={y}");
                assert_eq!(cell(3.8, y, w, 0.1), 0, "east path at w={w}, y={y}");
            }
        }
        // In the border, fine cells hold thin stems with grouped blooms above them, not a flat mat.
        let (mut stems, mut blooms, mut air) = (0, 0, 0);
        for i in 0..40 {
            for j in 0..40 {
                let (u, w) = (-1.2 + i as f32 * 0.1, 70.0 + j as f32 * 0.1);
                let low = cell(u, 0.35, w, 0.1);
                let high = cell(u, 0.8, w, 0.1);
                let leaf = kind(LEAVES, colour(6, 8));
                if low == leaf { stems += 1 } else if low == 0 { air += 1 }
                if high != 0 && high != leaf { blooms += 1 }
            }
        }
        assert!(stems > 0 && air > stems * 5, "stems {stems}, air {air}");
        assert!(blooms > 30, "expected distinct blooms across this four-metre patch, found {blooms}");
        // Nothing grows over a metre and a half, so the photograph's view down the border is open.
        assert_eq!(cell(0.8, 1.65, 76.4, 0.1), 0);
    }

    #[test]
    fn conservatory_glass_is_whitewashed_with_only_fine_glazing_bars() {
        // The gallery roof near its south eaves: at a coarse cell every sample is the whitewash, with no stripes.
        let (y, w) = (2.0, 6.6);
        let coarse: std::collections::BTreeSet<Kind> = (0..120).map(|i| conservatory(-25.0 + i as f32 * 0.4, y, w, 0.4)).filter(|&k| k != 0).collect();
        assert_eq!(coarse.len(), 1, "{coarse:?}");
        assert_eq!((|k: Kind| (k >> 8) as u8)(*coarse.iter().next().unwrap()), WHITE);
        // A fine cell still finds the bars.
        let fine: Vec<Kind> = (0..200).map(|i| conservatory(-25.0 + i as f32 * 0.05, y, w, 0.1)).collect();
        assert!(fine.iter().any(|&k| material(k) == WOOD), "{fine:?}");
        // The portico's arched window over the doors.
        assert_eq!(material(conservatory(1.5, 4.4, 17.1, 0.1)), GLASS);
    }

}
