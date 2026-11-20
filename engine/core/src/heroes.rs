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
        GOLDEN_GATE => Some([GG_SOUTH - 4.0, -30.0, -48.0, GG_NORTH + 4.0, GG_TOP + 1.0, 48.0]),
        TRANSAMERICA => Some([-29.0, 0.0, -29.0, 29.0, TA_TOP + 1.0, 29.0]),
        BAY_BRIDGE => Some([BB_WEST - 16.0, -30.0, -30.0, BB_EAST + 16.0, 162.0, 30.0]),
        FERRY_BUILDING => Some([-FB_HALF - 1.0, 0.0, -FB_DEEP - 1.0, FB_HALF + 1.0, FB_TOP + 1.0, FB_DEEP + 1.0]),
        SUTRO_TOWER => Some([-40.0, 0.0, -40.0, 40.0, ST_TOP + 1.0, 40.0]),
        CITY_HALL => Some([-CH_LONG - 1.0, 0.0, -CH_WIDE - 1.0, CH_LONG + 1.0, CH_TOP + 1.0, CH_WIDE + 1.0]),
        FINE_ARTS => Some([-PF_ARC - 8.0, 0.0, -PF_ARC - 8.0, PF_ARC * 0.5, PF_TOP + 1.0, PF_ARC + 8.0]),
        _ => None,
    }
}

/// Whether a rule is all there is at a place in its box (its air is air: the lidar's columns under it, which cannot
/// say an arch or a lattice, are not), or only adds to what the map has there (a bridge over the water).
pub fn owns(sort: u32, u: f32, _y: f32, w: f32) -> bool {
    match sort {
        SALESFORCE | TRANSAMERICA | FERRY_BUILDING | SUTRO_TOWER | CITY_HALL => true,
        // The rotunda and the colonnade's band, not the exhibition hall behind it.
        FINE_ARTS => {
            let r = (u * u + w * w).sqrt();
            r < PF_ROTUNDA + 4.0 || ((r - PF_ARC).abs() < 9.0 && pf_on_arc(u, w))
        }
        _ => false,
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
// are rounded at 0.55 of the half width). How it draws in was measured off a photograph from 3.3 km (Commons,
// "San Francisco skyline from Potrero Hill, February 2020", Pi.1415926535, CC BY-SA 3.0; 0.46 m a pixel): the right
// edge of its outline against the sky every 5.5 m from 193 m up. Below that the photograph's skyline hides it.
const SF_TOP: f32 = 326.0;
const SF_CROWN: f32 = 280.0;
const SF_FLOOR: f32 = 4.42;
const SF_HALF: f32 = 26.9;
const SF_ROUND: f32 = 0.55;
const SF_TAPER: [(f32, f32); 19] = [
    (0.0, 1.0), (60.0, 1.0), (120.0, 0.985), (160.0, 0.968), (193.0, 0.944), (215.0, 0.912), (235.0, 0.872), (248.0, 0.835), (260.0, 0.79),
    (271.0, 0.75), (282.0, 0.70), (293.0, 0.64), (304.0, 0.572), (310.0, 0.535), (315.0, 0.497), (320.0, 0.452), (323.0, 0.415), (325.0, 0.37), (326.0, 0.33),
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


// ── The Ferry Building (A. Page Brown, 1898). Its frame: u along the building towards the south-east, w across it
// towards the city (Market Street), y up from the plaza. Overture Maps 2026-10-21.0 (© OpenStreetMap contributors,
// Overture Maps Foundation): the building 202 by 56 m, 15 to 16 m high, along bearing 143 degrees; the clock tower in
// seven stages over a 12 m square, 17.5 m out from the building's middle line towards the city: 43.5, 50.5, 54.2,
// 60.5, 64.5, 68.2 and a dome to 70 m. The arcade, the clock's faces and the belfry's arches are by eye.
const FB_HALF: f32 = 101.0;
const FB_DEEP: f32 = 28.0;
const FB_TOWER_W: f32 = 17.5;
const FB_TOP: f32 = 70.0;
/// The tower's stages: up to this height, half its side.
const FB_STAGES: [(f32, f32); 7] = [(43.5, 6.0), (50.5, 5.4), (54.2, 4.4), (60.5, 3.0), (64.5, 2.5), (68.2, 1.8), (70.0, 1.0)];

fn ferry_building(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if y < 0.0 || y >= FB_TOP {
        return 0;
    }
    let stone = kind(PLASTER, colour(3, 0));
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
                    return if r > 2.4 && s <= 0.8 { kind(STEEL, grey(13)) } else { trim };
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
    if u.abs() > FB_HALF || w.abs() > FB_DEEP {
        return 0;
    }
    let ridge = 16.1 - 2.4 * (w.abs() / FB_DEEP);
    if y >= 14.0 {
        if y >= ridge {
            return 0;
        }
        return if w.abs() < 3.0 && s <= 1.6 { kind(GLASS, colour(14, 6)) } else { roof };
    }
    let face = (FB_HALF - u.abs()).min(FB_DEEP - w.abs());
    if face > 1.0f32.max(s) {
        return kind(CONCRETE, grey(9));
    }
    if y >= 12.6 || y < 0.8 {
        return trim;
    }
    let along = if FB_HALF - u.abs() < FB_DEEP - w.abs() { w } else { u };
    if s <= 0.8 {
        if y < 7.0 {
            // The arcade: an arch every 6 m, its opening 4 m wide and 5.6 m to the crown, the glass set back.
            let a = (along + 3.0).rem_euclid(6.0) - 3.0;
            let crown = 4.2 + 1.4 * (1.0 - (a / 2.0).powi(2)).max(0.0).sqrt();
            if a.abs() < 2.0 && y < crown {
                return if face < 0.5 { 0 } else { dark };
            }
        } else if (8.2..11.6).contains(&y) {
            // Upstairs a pair of windows in each bay.
            let a = (along + 3.0).rem_euclid(6.0) - 3.0;
            if (0.5..1.7).contains(&a.abs()) {
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

// ── City Hall (Bakewell & Brown, 1915). Its frame: u along the building (towards the south, a little east), w across
// it, y up from the ground. Overture Maps 2026-10-21.0 (© OpenStreetMap contributors, Overture Maps Foundation): the
// building 127 by 98 m and 30 m high; a wing across it 28 m wide to 35 m, its roof pitched to 38; the rotunda's base
// 41 by 39 m to 32 m, then 40 m to 40, 34 to 46, 31 to 56, 29 to 60, and the dome to 75 m with its lantern over.
// The dome's top at 93.6 m (307.5 feet) as published; the colonnades, light courts, ribs and gilding by eye.
const CH_LONG: f32 = 63.5;
const CH_WIDE: f32 = 49.0;
const CH_TOP: f32 = 93.6;

fn city_hall(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if y < 0.0 || y >= CH_TOP {
        return 0;
    }
    let granite = kind(CONCRETE, grey(2));
    let dark = kind(GLASS, colour(14, 9));
    let lead = kind(ROOFING, grey(10));
    let gold = kind(STEEL, colour(3, 3));
    let r = (u * u + w * w).sqrt();
    // The dome over the drum: a little taller than round, ribbed in gold, under a lantern of columns and a cupola.
    if y >= 32.0 {
        let half = if y < 40.0 { 20.0 } else if y < 46.0 { 17.0 } else if y < 56.0 { 15.5 } else { 14.5 };
        if y < 60.0 {
            if y < 40.0 {
                // The square base of the drum, cut at its corners.
                if u.abs().max(w.abs()) <= half && u.abs() + w.abs() <= half * 1.4 {
                    return if y > 39.0 { gold } else { granite };
                }
                return 0;
            }
            if r > half {
                return 0;
            }
            // The drum's colonnade: a column every 2.6 m round it, tall windows between.
            if (46.0..55.0).contains(&y) && r > half - 1.2f32.max(s) && s <= 0.8 {
                let round = r * w.atan2(u);
                return if line(round, 2.6, 0.0, 0.9, s) { granite } else { dark };
            }
            return granite;
        }
        if y < 75.0 {
            let h = (y - 60.0) / 15.0;
            let rd = 13.5 * (1.0 - h * h).max(0.0).sqrt();
            if r > rd.max(s * 0.5) {
                return 0;
            }
            let round = 13.5 * w.atan2(u);
            return if line(round, 13.5 * std::f32::consts::PI / 12.0, 0.0, 0.5, s) && s <= 1.6 { gold } else { lead };
        }
        // The lantern, its cupola and the finial.
        if y < 84.0 {
            if r > 4.5 {
                return 0;
            }
            return if r > 3.5 && s <= 0.4 && !line(4.0 * w.atan2(u), 1.6, 0.0, 0.5, s) { 0 } else { gold };
        }
        if y < 89.0 {
            let rd = 4.5 * (1.0 - ((y - 84.0) / 5.0).powi(2)).max(0.0).sqrt();
            return if r <= rd.max(s * 0.5) { gold } else { 0 };
        }
        return if r <= 0.6f32.max(s * 0.55) { gold } else { 0 };
    }
    if u.abs() > CH_LONG || w.abs() > CH_WIDE {
        return 0;
    }
    // Two light courts either side of the rotunda, open from the second floor up.
    let court = (u.abs() - 37.0).abs() < 14.0 && w.abs() < 22.0;
    if court && y > 9.0 {
        return 0;
    }
    // The wing across the middle stands higher, to a pitched roof.
    if y >= 30.0 {
        if u.abs() <= 14.0 && y < 35.0 + 3.0 * (1.0 - w.abs() / CH_WIDE) {
            return if y >= 35.0 { lead } else { granite };
        }
        return 0;
    }
    let face = (CH_LONG - u.abs()).min(CH_WIDE - w.abs());
    if face > 3.0f32.max(s) {
        return granite;
    }
    let along = if CH_LONG - u.abs() < CH_WIDE - w.abs() { w } else { u };
    // A rusticated base, a colonnade two storeys tall over it with the wall 2.5 m behind, and an attic.
    if y >= 27.0 || y < 1.0 {
        return granite;
    }
    if (9.0..25.0).contains(&y) && s <= 1.6 {
        if face < 2.5 {
            // In the colonnade: a column every 4.6 m; the central pavilion on each long side stands proud.
            return if line(along, 4.6, 0.0, 1.2, s) || (along.abs() < 18.0 && CH_WIDE - w.abs() < 2.5) { granite } else { 0 };
        }
        return if (along + 2.3).rem_euclid(4.6) < 2.2 && (y - 10.5).rem_euclid(7.5) < 4.5 { dark } else { granite };
    }
    if y < 9.0 && s <= 0.8 && (along + 2.3).rem_euclid(4.6) < 1.8 && (2.0..6.5).contains(&y) {
        return dark;
    }
    granite
}

// ── The Palace of Fine Arts (Maybeck, 1915, rebuilt 1965). Its frame: u towards the east (the lagoon), w towards the
// south, y up from the ground. A rotunda of eight arches on piers with a dome, 49 m (162 feet) to its top, and round it
// to the west a colonnade on an arc, its columns in pairs under an entablature, with tall planter boxes at intervals.
// The exhibition hall behind is the map's. Sizes as published (the dome's height) and by eye.
const PF_ROTUNDA: f32 = 17.0;
const PF_TOP: f32 = 49.0;
const PF_ARC: f32 = 62.0;

/// Whether a point lies on the colonnade's arc: round the west, from north-north-east to south-south-east.
fn pf_on_arc(u: f32, w: f32) -> bool {
    // The angle from the east, positive towards the south: the arc covers all but 110 degrees facing the lagoon.
    w.atan2(u).abs() > 55f32.to_radians()
}

fn fine_arts(u: f32, y: f32, w: f32, s: f32) -> Kind {
    if y < 0.0 || y >= PF_TOP {
        return 0;
    }
    let stone = kind(PLASTER, colour(2, 1));
    let dome = kind(PLASTER, colour(1, 2));
    let r = (u * u + w * w).sqrt();
    let round = w.atan2(u);
    // ── The rotunda: an octagon of piers carrying arches, an entablature, a drum and the dome with its lantern.
    let oct = {
        let a = (round.rem_euclid(std::f32::consts::FRAC_PI_4)) - std::f32::consts::FRAC_PI_8;
        r * a.cos()
    };
    if r < PF_ROTUNDA + 2.0 {
        if y < 25.0 {
            if oct > PF_ROTUNDA || oct < PF_ROTUNDA - 3.5f32.max(s) {
                return 0;
            }
            // Between two piers an arch: open below its crown.
            let a = (round + std::f32::consts::FRAC_PI_8).rem_euclid(std::f32::consts::FRAC_PI_4) - std::f32::consts::FRAC_PI_8;
            let half = PF_ROTUNDA * (std::f32::consts::FRAC_PI_8).tan();
            let x = (a.tan() * oct).abs();
            let pier = 2.6;
            if x < half - pier {
                let span = half - pier;
                let crown = 13.0 + span * (1.0 - (x / span).powi(2)).max(0.0).sqrt();
                if y < crown {
                    return 0;
                }
            }
            return stone;
        }
        if y < 29.0 {
            return if oct <= PF_ROTUNDA + 1.0 { stone } else { 0 };
        }
        if y < 31.0 {
            return if r <= PF_ROTUNDA - 2.0 { stone } else { 0 };
        }
        let rd = (PF_ROTUNDA - 3.0) * (1.0 - ((y - 31.0) / 14.0).powi(2)).max(0.0).sqrt();
        if y < 45.0 {
            return if r <= rd.max(s * 0.5) { dome } else { 0 };
        }
        return if r <= 1.6f32.max(s * 0.55) { stone } else { 0 };
    }
    // ── The colonnade: paired columns every 7 m along the arc, 15 m tall, under an entablature 3 m deep; every
    // fifth pair a planter box, a block 5 m square standing to 21 m.
    let off = r - PF_ARC;
    if off.abs() > 4.5 || !pf_on_arc(u, w) || y > 21.5 {
        return 0;
    }
    let along = PF_ARC * round;
    let pair = (along + 3.5).rem_euclid(7.0) - 3.5;
    let box_at = (along + 17.5).rem_euclid(35.0) - 17.5;
    if box_at.abs() < 2.5 && off.abs() < 2.5 {
        return if y > 20.0 { kind(PLASTER, colour(1, 3)) } else { stone };
    }
    if y >= 15.0 {
        return if y < 17.5 && off.abs() <= 2.0 { stone } else { 0 };
    }
    // Two columns side by side across the arc, round, 1.6 m thick.
    for c in [-1.3f32, 1.3] {
        let (dx, dy) = (pair, off - c);
        if dx * dx + dy * dy <= (0.8f32).max(s * 0.55).powi(2) {
            return stone;
        }
    }
    if y < 1.0 && off.abs() <= 2.5 {
        return stone;
    }
    0
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
const GG_NORTH: f32 = 1330.0;
const GG_TOP: f32 = 227.0;
/// The cables, the trusses and the legs' middles: this far either side of the centre line.
const GG_PLANE: f32 = 13.7;
const GG_PANEL: f32 = 7.62;

/// How high the roadway is: highest in the middle of the main span, falling away past the towers.
fn gg_road(u: f32) -> f32 {
    let a = u.abs();
    if a <= GG_TOWER { 75.0 + 3.0 * (1.0 - (a / GG_TOWER) * (a / GG_TOWER)) } else { 75.0 - 0.012 * (a - GG_TOWER) }
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
    let (a, aw) = (u.abs(), w.abs());
    if !(-30.0..GG_TOP).contains(&y) || !(GG_SOUTH..GG_NORTH).contains(&u) {
        return 0;
    }
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
            // (A hanger is four ropes 7 cm thick. In cells over 0.8 m it would be drawn many times its width, a comb
            // across the span from 2 km where the eye sees hairs: from there it is left out.)
            if s <= 0.8 && member(aw - GG_PLANE, 0.15, s) && a < GG_PYLON - 4.0 && du.abs() > 6.0 && y < high && dy > -1.0 && line(u, 15.24, 0.0, 0.3, s) {
                return orange;
            }
        }
    }
    if dy > 1.4 || dy < -40.0 && a < 1080.0 {
        return 0;
    }
    // ── The roadway and its truss.
    if dy <= 0.0 && dy > -(1.0f32.max(s)) && aw <= GG_PLANE + 0.5 {
        let top = dy > -(0.3f32.max(s));
        return if !top { orange } else if aw > 10.4 { kind(CONCRETE, grey(5)) } else { kind(ASPHALT, OWN) };
    }
    if dy > 0.0 {
        // The rail at each edge: pickets under a top rail near, a low wall from further, nothing from far.
        let rail = (aw - GG_PLANE).abs() <= 0.15f32.max(s * 0.5) && dy <= 1.2f32.max(s);
        return if rail && s <= 1.0 && (s > 0.25 || dy > 1.0 || line(u, 0.6, 0.0, 0.1, s)) { orange } else { 0 };
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
        save("ferry-front-0.2", picture(FERRY_BUILDING, 0.2, 2, [-FB_HALF - 2.0, 0.0, FB_HALF + 2.0, 72.0]));
        save("ferry-tower-0.1", picture(FERRY_BUILDING, 0.1, 2, [-10.0, 30.0, 10.0, 71.0]));
        save("ferry-front-1.6", picture(FERRY_BUILDING, 1.6, 2, [-FB_HALF - 2.0, 0.0, FB_HALF + 2.0, 72.0]));
        save("sutro-0.8", picture(SUTRO_TOWER, 0.8, 2, [-40.0, 0.0, 40.0, 300.0]));
        save("sutro-end-0.8", picture(SUTRO_TOWER, 0.8, 0, [-40.0, 0.0, 40.0, 300.0]));
        save("sutro-3.2", picture(SUTRO_TOWER, 3.2, 2, [-40.0, 0.0, 40.0, 300.0]));
        save("cityhall-0.2", picture(CITY_HALL, 0.2, 0, [-CH_WIDE - 2.0, 0.0, CH_WIDE + 2.0, 95.0]));
        save("cityhall-1.6", picture(CITY_HALL, 1.6, 0, [-CH_WIDE - 2.0, 0.0, CH_WIDE + 2.0, 95.0]));
        save("finearts-0.2", picture(FINE_ARTS, 0.2, 0, [-PF_ARC - 8.0, 0.0, PF_ARC + 8.0, 50.0]));
        save("finearts-1.6", picture(FINE_ARTS, 1.6, 0, [-PF_ARC - 8.0, 0.0, PF_ARC + 8.0, 50.0]));
        for s in [0.8, 1.6, 3.2, 6.4, 12.8] {
            save(&format!("gate-side-{s}"), picture(GOLDEN_GATE, s, 2, [GG_SOUTH, -10.0, -600.0, 235.0]));
        }
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
            assert!((high / foot - 0.47).abs() < 0.06 + s / 25.0, "{s} m cells: {high} of {foot} at 318 m");
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
        assert_eq!(material(golden_gate(0.05, 77.95, 0.05, 0.1)), ASPHALT);
        assert_eq!(golden_gate(0.05, 78.25, 0.05, 0.1), 0);
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
        // A hanger is there in cells of 0.4 m and left out of cells of 1.6 m.
        let hanger = |s: f32| (-1..=1).any(|i| golden_gate(((15.24 * 10.0 / s).floor() + i as f32) * s + s / 2.0, 84.0 + s / 2.0, (GG_PLANE / s).floor() * s + s / 2.0, s) != 0);
        assert!(hanger(0.4));
        assert!(!hanger(1.6));
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
}
