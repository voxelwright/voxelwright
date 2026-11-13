//! A made-up city by the sea, as rules: any sector of it, at any coarseness, comes out of this
//! file the same on every machine, so nothing of it is stored until somebody changes it.
//! Hills from smooth noise, a grid of streets over them, rows of houses 7.6 m wide stepping
//! with the slope, blocks of towers where the town is busiest, parks, trees and lamps.
//! Synthetic: no real place's data is in here. All lengths are in the finest cells (10 cm).

use crate::hash::{hash, hash3, noise, unit};
use crate::kinds::*;
use crate::land::{HOME, REFUGE, arid, cold, dry, ease, far, off_road, offshore, on_way, open, peaks, red, reef_column, reef_form, way};
use crate::scratch::{Meet, Scratch};
use crate::tree::{Kind, SIDE, at};

/// A block and the streets on its low sides repeat every this many cells.
pub const BLOCK_X: i32 = 1280;
pub const BLOCK_Z: i32 = 800;
/// A street: two pavements and the road between.
const STREET: i32 = 140;
const PAVEMENT: i32 = 25;
const LOT_WIDE: i32 = 76;
const LOT_DEEP: i32 = 330;
const LOTS: i32 = 15;
const STOREY: i32 = 30;
const TOWER_WIDE: i32 = 380;
const TOWER_STOREY: i32 = 36;
/// The layer of cells under the top of the sea: the sea's top is the world's zero. The still sea is not cells. It is
/// all that lies under zero with nothing else in it, and the page draws its top as a level plane (march.ts): a look
/// through it then crosses open space as fast as air, what sinks in it sinks, and it lies level at every
/// coarseness. As cells it was crossed in small steps (a look under water cost three times a look through air),
/// and a coarse cell of it stood 2^k cells high, a step at the edge of every box.
pub const SEA: i32 = -1;
/// Nothing but earth lies further than this under the ground.
pub const DEEP: i32 = 192;

const EARTH_KIND: Kind = kind(EARTH, OWN);

pub use crate::land::ground;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Block {
    Shore,
    Park,
    Homes,
    Towers,
    /// A works yard: a few things that each stand, and so come down, in their own way.
    Yard,
    /// Open country, past the town's edge: no streets, nothing built (land.rs says what the land is).
    Open,
}

/// The yard everyone starts beside: the block across the street from where the page begins. The rule below puts a
/// yard there by itself; naming it keeps it there, for the board's shots and the tests stand in it.
pub const YARD: (i32, i32) = (0, 5);

/// Whether a block lies past the town's edge.
fn is_open(bx: i32, bz: i32) -> bool {
    open(bx * BLOCK_X + BLOCK_X / 2, bz * BLOCK_Z + BLOCK_Z / 2) > 0.5
}

pub(crate) fn block(bx: i32, bz: i32) -> Block {
    if is_open(bx, bz) {
        Block::Open
    } else if ground(bx * BLOCK_X + BLOCK_X / 2, bz * BLOCK_Z + BLOCK_Z / 2) < 15 {
        Block::Shore
    } else if (bx, bz) == YARD || hash(bx, bz, 23) % 17 == 0 {
        Block::Yard
    } else if noise(bx, bz, 7, 21) > 0.64 {
        Block::Towers
    } else if hash(bx, bz, 22) % 14 == 0 {
        Block::Park
    } else {
        Block::Homes
    }
}

/// Something built on a lot: a box on the ground with a front, which the shapes of a house or a tower are told against.
#[derive(Clone, Copy)]
struct Built {
    x0: i32,
    x1: i32,
    /// The z of its front face, and which way it runs back from there (+1 or -1).
    front: i32,
    back: i32,
    deep: i32,
    /// The cell its ground floor stands on top of.
    base: i32,
    storeys: i32,
    wall: Kind,
    trim: Kind,
    seed: u32,
}

impl Built {
    fn wide(&self) -> i32 {
        self.x1 - self.x0
    }
    /// A box told from the front's low corner: `u` along the front, `v` back from it, `y` up from the base.
    fn put(&self, s: &mut Scratch, u: (i32, i32), v: (i32, i32), y: (i32, i32), kind: Kind, meet: Meet) {
        let (z0, z1) = if self.back > 0 { (self.front + v.0, self.front + v.1) } else { (self.front - v.1, self.front - v.0) };
        s.fill([self.x0 + u.0, self.base + y.0, z0], [self.x0 + u.1, self.base + y.1, z1], kind, meet);
    }
    fn holds(&self, x: i32, z: i32) -> bool {
        let v = (z - self.front) * self.back;
        x >= self.x0 && x < self.x1 && v >= 0 && v < self.deep
    }
}

/// The house on lot `i` of a row (0 fronts the street on the block's low z side, 1 the next block's).
fn house(bx: i32, bz: i32, row: i32, i: i32) -> Option<Built> {
    let seed = hash(bx * 16 + i, bz * 2 + row, 31);
    let x0 = bx * BLOCK_X + STREET + i * LOT_WIDE;
    let setback = [0, 0, 6, 12][(seed >> 20) as usize & 3];
    let (front, back) = if row == 0 { (bz * BLOCK_Z + STREET + setback, 1) } else { ((bz + 1) * BLOCK_Z - setback, -1) };
    let base = ground(x0 + LOT_WIDE / 2, front);
    if base < 10 {
        return None;
    }
    let hue = ((seed >> 8) % 24) as u8;
    let wall = match (seed >> 13) % 10 {
        0 => kind(BRICK, colour(1, 8)),
        1 | 2 => kind(WOOD, colour(hue, [0, 1, 7][(seed >> 17) as usize % 3])),
        _ => kind(PLASTER, colour(hue, [0, 1, 1, 2, 7][(seed >> 17) as usize % 5])),
    };
    let trim = if (seed >> 23) & 3 == 0 { kind(WOOD, colour(hue, 5)) } else { kind(WOOD, WHITE) };
    Some(Built { x0, x1: x0 + LOT_WIDE, front, back, deep: 170 + ((seed >> 4) % 5) as i32 * 10, base, storeys: 2 + (seed % 3) as i32, wall, trim, seed })
}

/// The tower on lot `j` (0 to 2) of a row of a block of towers.
fn tower(bx: i32, bz: i32, row: i32, j: i32) -> Option<Built> {
    let seed = hash(bx * 4 + j, bz * 2 + row, 41);
    let x0 = bx * BLOCK_X + STREET + j * TOWER_WIDE + 12;
    let (front, back) = if row == 0 { (bz * BLOCK_Z + STREET + 12, 1) } else { ((bz + 1) * BLOCK_Z - 12, -1) };
    let base = ground(x0 + TOWER_WIDE / 2, front + back * 150);
    if base < 10 {
        return None;
    }
    let tall = unit(bx * 4 + j, bz * 2 + row, 42);
    let glass = kind(GLASS, colour([12, 14, 16, 17, 10][(seed >> 8) as usize % 5], [8, 9, 3, 7][(seed >> 12) as usize % 4]));
    Some(Built { x0, x1: x0 + TOWER_WIDE - 24, front, back, deep: LOT_DEEP - 24, base, storeys: 6 + (tall * tall * 34.0) as i32, wall: glass, trim: kind(CONCRETE, grey(2 + (seed >> 16) as u8 % 6)), seed })
}

fn house_tall(h: &Built) -> i32 {
    h.storeys * STOREY + 2
}
fn tower_tall(t: &Built) -> i32 {
    t.storeys * TOWER_STOREY
}

/// A window in the front or back wall: a frame, a pane set one cell in.
fn window(h: &Built, s: &mut Scratch, u: (i32, i32), y: (i32, i32), back: bool, pane: Kind) {
    let d = h.deep;
    let (outer, inner) = if back { ((d - 1, d), (d - 2, d - 1)) } else { ((0, 1), (1, 2)) };
    if s.lod > 1 {
        // Far off a wall is one coarse cell thick: the pane is its colour there.
        let t = 1 << s.lod;
        h.put(s, u, if back { (d - t, d) } else { (0, t) }, y, pane, Meet::Middle);
        return;
    }
    h.put(s, (u.0 - 1, u.1 + 1), outer, (y.0 - 1, y.1 + 1), h.trim, Meet::Middle);
    h.put(s, u, outer, y, 0, Meet::Middle);
    h.put(s, u, inner, y, pane, Meet::Middle);
}

fn stamp_house(h: &Built, s: &mut Scratch) {
    let (w, d, tall) = (h.wide(), h.deep, house_tall(h));
    let detail = s.lod <= 1;
    let pane = kind(GLASS, colour(14, 9));
    h.put(s, (0, w), (0, d), (-30, 0), kind(CONCRETE, OWN), Meet::Touch);
    h.put(s, (0, w), (0, d), (0, tall), h.wall, Meet::Touch);
    if detail {
        h.put(s, (2, w - 2), (2, d - 2), (2, tall - 2), 0, Meet::Within);
        for storey in 1..h.storeys {
            h.put(s, (2, w - 2), (2, d - 2), (storey * STOREY, storey * STOREY + 2), kind(WOOD, colour(3, 8)), Meet::Middle);
        }
        // One wall across the middle, so a house is not a hollow box.
        h.put(s, (2, w - 2), (d / 2, d / 2 + 2), (2, tall - 2), kind(PLASTER, WHITE), Meet::Middle);
        h.put(s, (30, 42), (d / 2, d / 2 + 2), (2, 24), 0, Meet::Middle);
    }
    h.put(s, (0, w), (0, d), (tall - 2, tall), kind(ROOFING, OWN), Meet::Middle);
    h.put(s, (0, w), (0, 2), (tall, tall + 6), h.wall, Meet::Middle);
    h.put(s, (0, w), (-2, 0), (tall - 4, tall), h.trim, Meet::Middle);
    let bay = (h.seed >> 26) % 3 != 0;
    let bay_at = if (h.seed >> 28) & 1 == 0 { 6 } else { w - 36 };
    let other = if bay_at == 6 { (48, 64) } else { (12, 28) };
    for storey in 0..h.storeys {
        let y = (storey * STOREY + 10, storey * STOREY + 25);
        window(h, s, (10, 26), y, true, pane);
        window(h, s, (50, 66), y, true, pane);
        if storey == 0 {
            // A garage and a front door.
            let door = if bay_at == 6 { (52, 64) } else { (10, 22) };
            let garage = if bay_at == 6 { (8, 36) } else { (40, 68) };
            if detail {
                h.put(s, garage, (0, 1), (2, 24), 0, Meet::Middle);
                h.put(s, door, (0, 1), (2, 25), 0, Meet::Middle);
                h.put(s, (door.0 - 2, door.1 + 2), (-5, 0), (0, 2), kind(CONCRETE, OWN), Meet::Middle);
            }
            let t = if detail { (1, 2) } else { (0, 1 << s.lod) };
            h.put(s, garage, t, (2, 24), kind(WOOD, grey(2)), Meet::Middle);
            h.put(s, door, t, (2, 25), kind(WOOD, colour((h.seed >> 3) as u8 % 24, 5)), Meet::Middle);
        } else if !bay {
            window(h, s, (10, 26), y, false, pane);
            window(h, s, (50, 66), y, false, pane);
        } else {
            window(h, s, other, y, false, pane);
        }
    }
    if bay {
        let (b0, b1) = (bay_at, bay_at + 30);
        h.put(s, (b0, b1), (-6, 0), (STOREY, tall - 2), h.wall, Meet::Middle);
        h.put(s, (b0 - 1, b1 + 1), (-7, 0), (tall - 3, tall - 1), h.trim, Meet::Middle);
        h.put(s, (b0 - 1, b1 + 1), (-7, 0), (STOREY - 1, STOREY + 1), h.trim, Meet::Middle);
        if detail {
            h.put(s, (b0 + 1, b1 - 1), (-5, 2), (STOREY + 2, tall - 4), 0, Meet::Middle);
        }
        for storey in 1..h.storeys {
            let y = (storey * STOREY + 10, storey * STOREY + 25);
            h.put(s, (b0 + 4, b1 - 4), (-6, -5), y, pane, Meet::Middle);
            if detail {
                h.put(s, (b0, b0 + 1), (-5, -1), y, pane, Meet::Middle);
                h.put(s, (b1 - 1, b1), (-5, -1), y, pane, Meet::Middle);
                if storey > 1 {
                    h.put(s, (b0 + 1, b1 - 1), (-5, 0), (storey * STOREY, storey * STOREY + 2), kind(WOOD, colour(3, 8)), Meet::Middle);
                }
            }
        }
    }
}

/// The four sides of a box, `t` thick, as boxes.
fn ring(b: &Built, s: &mut Scratch, y: (i32, i32), t: i32, kind: Kind) {
    let (w, d) = (b.wide(), b.deep);
    b.put(s, (0, w), (0, t), y, kind, Meet::Middle);
    b.put(s, (0, w), (d - t, d), y, kind, Meet::Middle);
    b.put(s, (0, t), (0, d), y, kind, Meet::Middle);
    b.put(s, (w - t, w), (0, d), y, kind, Meet::Middle);
}

fn stamp_tower(t: &Built, s: &mut Scratch) {
    let (w, d, tall) = (t.wide(), t.deep, tower_tall(t));
    let detail = s.lod <= 1;
    let skin = 2.max(1 << s.lod);
    t.put(s, (0, w), (0, d), (-30, 0), kind(CONCRETE, OWN), Meet::Touch);
    t.put(s, (0, w), (0, d), (0, tall), t.wall, Meet::Touch);
    if detail {
        t.put(s, (2, w - 2), (2, d - 2), (0, tall), 0, Meet::Within);
        for storey in 0..=t.storeys {
            t.put(s, (2, w - 2), (2, d - 2), (storey * TOWER_STOREY - 3, storey * TOWER_STOREY), kind(CONCRETE, OWN), Meet::Middle);
        }
        // The core that holds it up, and columns.
        t.put(s, (w / 2 - 40, w / 2 + 40), (d / 2 - 40, d / 2 + 40), (0, tall), kind(CONCRETE, OWN), Meet::Middle);
        for (u, v) in [(30, 30), (w - 34, 30), (30, d - 34), (w - 34, d - 34)] {
            t.put(s, (u, u + 4), (v, v + 4), (0, tall), kind(CONCRETE, OWN), Meet::Middle);
        }
    }
    for storey in 0..=t.storeys {
        ring(t, s, (storey * TOWER_STOREY - 6, storey * TOWER_STOREY + 2), skin, t.trim);
    }
    if s.lod <= 1 {
        let mut u = 0;
        while u < w {
            t.put(s, (u, u + 3), (0, 2), (0, tall), t.trim, Meet::Middle);
            t.put(s, (u, u + 3), (d - 2, d), (0, tall), t.trim, Meet::Middle);
            u += 24;
        }
        let mut v = 0;
        while v < d {
            t.put(s, (0, 2), (v, v + 3), (0, tall), t.trim, Meet::Middle);
            t.put(s, (w - 2, w), (v, v + 3), (0, tall), t.trim, Meet::Middle);
            v += 24;
        }
    }
    t.put(s, (0, w), (0, d), (tall - 3, tall), kind(ROOFING, OWN), Meet::Middle);
    t.put(s, (60, w - 60), (60, d - 60), (tall, tall + 28), t.trim, Meet::Middle);
}

/// A tree. Its crown fills only air, and only between the lines `keep` gives across (x) and deep (z):
/// a street tree is cut back from the house fronts, a yard tree from the neighbours.
fn stamp_tree(s: &mut Scratch, x: i32, z: i32, seed: u32, keep: ([i32; 2], [i32; 2])) {
    let g = ground(x, z);
    if g < 6 {
        return;
    }
    let (tall, r) = (26 + (seed % 14) as i32, 11 + ((seed >> 4) % 7) as i32);
    if s.lod <= 2 {
        s.fill([x - 1, g + 1, z - 1], [x + 2, g + 1 + tall, z + 2], kind(WOOD, colour(2, 9)), Meet::Touch);
    }
    let leaves = kind(LEAVES, colour(7 + (seed >> 8) as u8 % 3, [3, 5, 8, 9][(seed >> 11) as usize % 4]));
    let within = Some(([keep.0[0], i32::MIN, keep.1[0]], [keep.0[1], i32::MAX, keep.1[1]]));
    s.ball([x, g + tall + r / 2, z], r, leaves, if s.lod == 0 { 40 } else { 0 }, seed, within);
    s.ball([x + r / 2, g + tall + r / 3, z - r / 3], r * 3 / 4, leaves, if s.lod == 0 { 40 } else { 0 }, seed ^ 5, within);
}

const ANYWHERE: [i32; 2] = [i32::MIN, i32::MAX];

/// The sea's floor is cut into patches this many cells square, and each may hold one thing.
const PATCH: i32 = 32;

/// What grows and lies on the sea's floor in one patch: eelgrass in tufts, ribbon weed that climbs towards the light
/// where the water is deep enough for it, here and there a boulder. Weed grows in groves and grass in meadows, with
/// bare sand between: most of the sea is open water, as it is, and a look through it crosses few things.
fn stamp_sea_floor(s: &mut Scratch, px: i32, pz: i32) {
    if s.lod > 2 {
        return;
    }
    let seed = hash(px, pz, 71);
    let (x, z) = (px * PATCH + 4 + (seed % 24) as i32, pz * PATCH + 4 + ((seed >> 5) % 24) as i32);
    let g = ground(x, z);
    // How many cells of water lie over the floor here.
    let deep = SEA - g;
    if deep < 12 {
        return;
    }
    let sort = (seed >> 10) % 16;
    let (grove, meadow) = (noise(px, pz, 14, 75) > 0.6, noise(px, pz, 9, 76) > 0.62);
    if sort == 0 {
        let r = 5 + ((seed >> 14) % 9) as i32;
        s.ball([x, g - r / 3, z], r, kind(ROCK, grey(7 + (seed >> 18) as u8 % 4)), 0, seed, None);
    } else if meadow && sort <= 12 {
        // Eelgrass: a tuft of blades a cell thick, none reaching the top of the water.
        for blade in 0..14u32 {
            let h = hash(px * 16 + blade as i32, pz, 72);
            let (bx, bz) = (x - 11 + (h % 23) as i32, z - 11 + ((h >> 5) % 23) as i32);
            let tall = (5 + ((h >> 8) % 16) as i32).min(deep - 3);
            let green = kind(LEAVES, colour(5 + (h >> 12) as u8 % 4, [1, 2, 3, 4][(h >> 14) as usize % 4]));
            s.fill([bx, g - 1, bz], [bx + 1, g + 1 + tall, bz + 1], green, Meet::Touch);
        }
    } else if grove && sort <= 11 && deep > 40 {
        // Ribbon weed: a few strands that wander as they climb, a short blade to one side at every other step,
        // to somewhere between half and nine tenths of the way up.
        for strand in 0..3 + (seed >> 14) % 3 {
            let h = hash(px * 16 + strand as i32, pz, 73);
            let (mut wx, mut wz) = (x - 9 + (h % 19) as i32, z - 9 + ((h >> 5) % 19) as i32);
            let tall = (deep * (50 + ((h >> 10) % 40) as i32) / 100).min(120);
            let weed = kind(LEAVES, colour(5 + (h >> 16) as u8 % 4, [2, 3, 4, 3][(h >> 18) as usize % 4]));
            let mut y = g - 1;
            let mut step = 0;
            while y < g + tall {
                let turn = hash(wx * 8 + step, wz * 8 + strand as i32, 74);
                s.fill([wx, y, wz], [wx + 2, y + 6, wz + 2], weed, Meet::Touch);
                if step % 2 == 1 {
                    let (dx, dz): (i32, i32) = [(1, 0), (-1, 0), (0, 1), (0, -1)][(turn >> 4) as usize % 4];
                    // A frond: out from the strand and up a little, wider than the strand is thick.
                    for (out, up) in [(2, 2), (4, 3), (6, 4)] {
                        let (fx, fz) = (wx + dx * out - dz.abs(), wz + dz * out - dx.abs());
                        s.fill([fx, y + up, fz], [fx + 2 + dz.abs() * 2, y + up + 2, fz + 2 + dx.abs() * 2], weed, Meet::Middle);
                    }
                }
                wx += [-1, 0, 0, 1][turn as usize % 4];
                wz += [0, -1, 1, 0][(turn >> 2) as usize % 4];
                y += 6;
                step += 1;
            }
        }
    }
}

/// A street lamp: a post, an arm out over the road (`dx`, `dz` say which way), a light.
fn stamp_lamp(s: &mut Scratch, x: i32, z: i32, dx: i32, dz: i32) {
    if s.lod > 2 {
        return;
    }
    let g = ground(x, z);
    if g < 6 {
        return;
    }
    let steel = kind(STEEL, grey(11));
    s.fill([x, g + 1, z], [x + 2, g + 72, z + 2], steel, Meet::Touch);
    let (ax, az) = (x + dx * 14, z + dz * 14);
    s.fill([x.min(ax), g + 70, z.min(az)], [x.max(ax) + 2, g + 72, z.max(az) + 2], steel, Meet::Touch);
    s.fill([ax - 1, g + 67, az - 1], [ax + 3, g + 70, az + 3], kind(LAMP, colour(3, 0)), Meet::Touch);
}

/// A level disc of cells: `r` cells across its half, from `y0` up to `y1`, solid or (`shell`) a ring that many cells thick.
fn disc(s: &mut Scratch, x: i32, z: i32, y0: i32, y1: i32, r: i32, shell: Option<i32>, k: Kind) {
    for dz in -r..=r {
        let half = (((r * r - dz * dz) as f32).sqrt()) as i32;
        let inner = shell.map(|t| {
            let q = r - t;
            if dz.abs() >= q { -1 } else { (((q * q - dz * dz) as f32).sqrt()) as i32 }
        });
        match inner {
            Some(q) if q >= 0 => {
                s.fill([x - half, y0, z + dz], [x - q, y1, z + dz + 1], k, Meet::Touch);
                s.fill([x + q, y0, z + dz], [x + half + 1, y1, z + dz + 1], k, Meet::Touch);
            }
            _ => s.fill([x - half, y0, z + dz], [x + half + 1, y1, z + dz + 1], k, Meet::Touch),
        }
    }
}

/// A water tower: a wooden tank on four steel legs, braced. Cut the legs on one side and it goes over.
fn stamp_water_tower(s: &mut Scratch, x: i32, z: i32) {
    let g = ground(x, z);
    let (steel, wood) = (kind(STEEL, grey(5)), kind(WOOD, colour(2, 6)));
    for (dx, dz) in [(-20, -20), (18, -20), (-20, 18), (18, 18)] {
        s.fill([x + dx, g - 10, z + dz], [x + dx + 2, g + 112, z + dz + 2], steel, Meet::Touch);
    }
    for h in [36, 74, 110] {
        for d in [-20, 18] {
            s.fill([x - 20, g + h, z + d], [x + 20, g + h + 2, z + d + 2], steel, Meet::Touch);
            s.fill([x + d, g + h, z - 20], [x + d + 2, g + h + 2, z + 20], steel, Meet::Touch);
        }
    }
    // Steel joists under the deck: a wooden deck alone cannot carry the tank (support.rs counts what each join bears).
    for dz in (-20..20).step_by(6) {
        s.fill([x - 20, g + 110, z + dz], [x + 20, g + 112, z + dz + 2], steel, Meet::Touch);
    }
    // The deck is steel plate, painted: wood would not carry the tank.
    s.fill([x - 24, g + 112, z - 24], [x + 24, g + 114, z + 24], kind(STEEL, colour(2, 8)), Meet::Touch);
    disc(s, x, z, g + 114, g + 116, 20, None, wood);
    disc(s, x, z, g + 116, g + 158, 20, Some(2), wood);
    for band in [126, 146] {
        disc(s, x, z, g + band, g + band + 2, 21, Some(1), kind(STEEL, grey(3)));
    }
    // Its roof, a low cone of sheet steel.
    for step in 0..6 {
        disc(s, x, z, g + 158 + step * 2, g + 160 + step * 2, 21 - step * 3, None, kind(STEEL, grey(12)));
    }
}

/// A brick chimney, hollow, a little narrower at each third of its height, with a pale band at each step.
fn stamp_chimney(s: &mut Scratch, x: i32, z: i32) {
    let g = ground(x, z);
    let (brick, band) = (kind(BRICK, OWN), kind(PLASTER, WHITE));
    for (third, half) in [7, 6, 5].into_iter().enumerate() {
        let (y0, y1) = (g - 8 + third as i32 * 62, g - 8 + (third as i32 + 1) * 62);
        for (lo, hi) in [([-half, -half], [half, -half + 2]), ([-half, half - 2], [half, half]), ([-half, -half], [-half + 2, half]), ([half - 2, -half], [half, half])] {
            s.fill([x + lo[0], y0, z + lo[1]], [x + hi[0], y1 - 2, z + hi[1]], brick, Meet::Touch);
            s.fill([x + lo[0], y1 - 2, z + lo[1]], [x + hi[0], y1, z + hi[1]], band, Meet::Touch);
        }
    }
}

/// An office of glass hung on a steel frame with concrete floors. A blast takes the glass and leaves the frame.
fn stamp_office(s: &mut Scratch, x0: i32, z0: i32) {
    // Six storeys of glass on a frame that is meant to be seen when the glass is gone: thick steel columns, a deep
    // concrete floor at each storey with a steel beam round its edge, and braces across two bays of each long side.
    let (wide, deep, storey, storeys) = (120, 100, 30, 6);
    let g = ground(x0 + wide / 2, z0 + deep / 2);
    let (base, top) = (g + 1, g + 1 + storey * storeys);
    let (glass, steel) = (kind(GLASS, OWN), kind(STEEL, grey(4)));
    for (lo, hi) in [([0, 0], [wide, 1]), ([0, deep - 1], [wide, deep]), ([0, 0], [1, deep]), ([wide - 1, 0], [wide, deep])] {
        s.fill([x0 + lo[0], base, z0 + lo[1]], [x0 + hi[0], top, z0 + hi[1]], glass, Meet::Middle);
    }
    // Its footing goes well into the ground: the yard may slope.
    s.fill([x0, g - 40, z0], [x0 + wide, base, z0 + deep], kind(CONCRETE, grey(4)), Meet::Touch);
    for k in 1..=storeys {
        let y = base + storey * k;
        s.fill([x0 + 1, y - 3, z0 + 1], [x0 + wide - 1, y, z0 + deep - 1], kind(CONCRETE, grey(6)), Meet::Touch);
        for (lo, hi) in [([0, 0], [wide, 2]), ([0, deep - 2], [wide, deep]), ([0, 0], [2, deep]), ([wide - 2, 0], [wide, deep])] {
            s.fill([x0 + lo[0], y - 4, z0 + lo[1]], [x0 + hi[0], y, z0 + hi[1]], steel, Meet::Touch);
        }
    }
    for cx in [0, 38, 77, wide - 5] {
        for cz in [0, 47, deep - 5] {
            s.fill([x0 + cx, base, z0 + cz], [x0 + cx + 5, top, z0 + cz + 5], steel, Meet::Touch);
        }
    }
    // Braces: a steel bar from the foot of one column to the head of the next, storey by storey, in the first and
    // the last bay of both long sides. A step of cells along, a step up.
    if s.lod <= 1 {
        for z in [z0 + 1, z0 + deep - 3] {
            for (from, to) in [(5, 38), (82, 115)] {
                for k in 0..storeys {
                    for n in 0..storey - 4 {
                        let x = x0 + from + (to - from) * n / (storey - 4);
                        s.fill([x, base + storey * k + n, z], [x + 3, base + storey * k + n + 2, z + 2], steel, Meet::Touch);
                    }
                }
            }
        }
    }
}

/// A flat concrete roof on six steel posts, open underneath.
fn stamp_canopy(s: &mut Scratch, x0: i32, z0: i32) {
    let (wide, deep) = (150, 80);
    let g = ground(x0 + wide / 2, z0 + deep / 2);
    for cx in [8, wide / 2 - 1, wide - 11] {
        for cz in [10, deep - 13] {
            s.fill([x0 + cx, g - 8, z0 + cz], [x0 + cx + 3, g + 36, z0 + cz + 3], kind(STEEL, grey(8)), Meet::Touch);
        }
    }
    s.fill([x0, g + 36, z0], [x0 + wide, g + 39, z0 + deep], kind(CONCRETE, WHITE), Meet::Touch);
    s.fill([x0, g + 39, z0], [x0 + wide, g + 40, z0 + deep], kind(CONCRETE, colour(1, 5)), Meet::Touch);
}

/// A works yard. Where each thing stands, from the block's low corner.
/// A parked car, 4.2 m by 1.8 m: a painted steel body on four wheels, a cabin of glass under a steel roof, lamps
/// at both ends. `along_x` is which way it points; its wheels reach down to the street, which may slope under it.
fn stamp_car(s: &mut Scratch, x: i32, z: i32, along_x: bool, seed: u32) {
    if s.lod > 2 {
        return;
    }
    let (long, wide) = (42, 18);
    // A box told along the car and across it from its low corner.
    let at = |a: (i32, i32), c: (i32, i32)| if along_x { ([x + a.0, z + c.0], [x + a.1, z + c.1]) } else { ([x + c.0, z + a.0], [x + c.1, z + a.1]) };
    let wheels = [((5, 12), (0, 3)), ((5, 12), (wide - 3, wide)), ((30, 37), (0, 3)), ((30, 37), (wide - 3, wide))];
    let under = |w: &((i32, i32), (i32, i32))| {
        let (lo, hi) = at(w.0, w.1);
        ground((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
    };
    let base = wheels.iter().map(under).max().unwrap() + 1;
    if base < 8 {
        return;
    }
    let mut put = |s: &mut Scratch, a: (i32, i32), c: (i32, i32), y: (i32, i32), k: Kind| {
        let (lo, hi) = at(a, c);
        s.fill([lo[0], y.0, lo[1]], [hi[0], y.1, hi[1]], k, Meet::Middle);
    };
    let paint = kind(STEEL, [colour((seed >> 4) as u8 % 24, [3, 4, 5, 8][(seed >> 10) as usize & 3]), grey(1), grey(11), grey(6)][(seed >> 13) as usize & 3]);
    let dark = kind(STEEL, grey(13));
    for w in &wheels {
        put(s, w.0, w.1, (under(w) + 1, base + 6), dark);
    }
    put(s, (0, long), (0, wide), (base + 3, base + 9), paint);
    // The cabin: glass all round, hollow, a roof on it.
    let cabin = if (seed >> 16) & 1 == 0 { (9, 33) } else { (7, 38) };
    put(s, cabin, (1, wide - 1), (base + 9, base + 15), kind(GLASS, colour(14, 9)));
    if s.lod == 0 {
        put(s, (cabin.0 + 1, cabin.1 - 1), (2, wide - 2), (base + 9, base + 14), 0);
    }
    put(s, cabin, (1, wide - 1), (base + 14, base + 15), paint);
    if s.lod <= 1 {
        for c in [(2, 5), (wide - 5, wide - 2)] {
            put(s, (long - 1, long), c, (base + 5, base + 7), kind(LAMP, colour(3, 0)));
            put(s, (0, 1), c, (base + 5, base + 7), kind(STEEL, colour(0, 4)));
        }
    }
}

/// A fire hydrant, a mailbox, or a bin: small things that stand on the pavement.
fn stamp_small(s: &mut Scratch, x: i32, z: i32, which: u32) {
    if s.lod > 1 {
        return;
    }
    let g = ground(x, z) + 2;
    if g < 8 {
        return;
    }
    match which % 3 {
        0 => {
            s.fill([x, g - 2, z], [x + 3, g + 7, z + 3], kind(STEEL, colour(4, 4)), Meet::Touch);
            s.fill([x - 1, g + 4, z + 1], [x + 4, g + 5, z + 2], kind(STEEL, grey(2)), Meet::Touch);
            s.fill([x, g + 7, z], [x + 3, g + 8, z + 3], kind(STEEL, grey(2)), Meet::Touch);
        }
        1 => {
            // Its legs go into the pavement, which may step under it.
            s.fill([x + 1, g - 3, z + 1], [x + 2, g + 3, z + 2], kind(STEEL, grey(12)), Meet::Touch);
            s.fill([x + 3, g - 3, z + 3], [x + 4, g + 3, z + 4], kind(STEEL, grey(12)), Meet::Touch);
            s.fill([x, g + 3, z], [x + 5, g + 12, z + 5], kind(STEEL, colour(16, 5)), Meet::Touch);
            s.fill([x, g + 12, z + 1], [x + 5, g + 13, z + 4], kind(STEEL, colour(16, 5)), Meet::Touch);
        }
        _ => {
            s.fill([x, g - 2, z], [x + 4, g + 9, z + 4], kind(STEEL, colour(9, 9)), Meet::Touch);
            s.fill([x, g + 9, z], [x + 4, g + 10, z + 4], kind(STEEL, grey(12)), Meet::Touch);
        }
    }
}

/// A stop sign on a pole, its face across the way `dx`, `dz` points along.
fn stamp_stop(s: &mut Scratch, x: i32, z: i32, dx: i32, dz: i32) {
    if s.lod > 1 {
        return;
    }
    let g = ground(x, z) + 2;
    if g < 8 {
        return;
    }
    s.fill([x, g - 2, z], [x + 1, g + 24, z + 1], kind(STEEL, grey(8)), Meet::Touch);
    // Eight sides, as near as cells go: a square with its corners off.
    for (row, half) in [3, 4, 4, 4, 4, 4, 3].into_iter().enumerate() {
        let y = g + 19 + row as i32;
        let red = kind(STEEL, colour(0, if row == 3 { 0 } else { 4 }));
        if dx != 0 {
            s.fill([x + dx, y, z - half], [x + dx + 1, y + 1, z + half + 1], red, Meet::Touch);
        } else {
            s.fill([x - half, y, z + dz], [x + half + 1, y + 1, z + dz + 1], red, Meet::Touch);
        }
    }
}

/// A shipping container, 6 m by 2.4 m by 2.6 m: a hollow box of painted steel with doors at one end, standing on `y`.
fn stamp_container(s: &mut Scratch, x: i32, y: i32, z: i32, along_x: bool, seed: u32) {
    let (long, wide, tall) = (60, 24, 26);
    let (ex, ez) = if along_x { (long, wide) } else { (wide, long) };
    let paint = kind(STEEL, colour([1, 16, 9, 3, 13, 21][(seed % 6) as usize], [5, 4, 8, 3][(seed >> 5) as usize & 3]));
    s.fill([x, y, z], [x + ex, y + tall, z + ez], paint, Meet::Touch);
    if s.lod <= 1 {
        s.fill([x + 1, y + 1, z + 1], [x + ex - 1, y + tall - 1, z + ez - 1], 0, Meet::Within);
        // Its doors: a darker end with a bar down the middle.
        let door = kind(STEEL, grey(10));
        if along_x {
            s.fill([x + long - 1, y + 2, z + wide / 2 - 1], [x + long, y + tall - 2, z + wide / 2 + 1], door, Meet::Touch);
        } else {
            s.fill([x + wide / 2 - 1, y + 2, z + long - 1], [x + wide / 2 + 1, y + tall - 2, z + long], door, Meet::Touch);
        }
    }
}

/// The letters a shop's sign is told in: five cells wide and seven tall, a row of bits each, the top row first.
fn letter(c: u8) -> [u8; 7] {
    match c {
        b'A' => [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        b'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        b'C' => [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
        b'D' => [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
        b'E' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
        b'F' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
        b'G' => [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
        b'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        b'I' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b11111],
        b'K' => [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
        b'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        b'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
        b'O' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        b'R' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
        b'S' => [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
        b'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        b'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        b'W' => [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
        b'Y' => [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
        _ => [0; 7],
    }
}

/// What the shops are.
const SHOPS: [&str; 10] = ["CAFE", "BOOKS", "BAKERY", "FLOWERS", "BIKES", "RECORDS", "TEA", "HARDWARE", "LAUNDRY", "GROCER"];

/// Whether a house keeps a shop on its ground floor: the houses at a block's ends mostly, one in seven of the rest.
fn shop(h: &Built, i: i32) -> Option<&'static str> {
    let ends = i == 0 || i == LOTS - 1;
    // Across the street from the yard's water tower the first five houses of the row are shops, each with the
    // next name on the list. (No further along: the houses across from the start keep their doors and their
    // street trees, which the checks stand at.)
    let market = i <= 4 && h.back < 0 && (0..=12).contains(&(YARD.1 * BLOCK_Z - h.front)) && h.x0.div_euclid(BLOCK_X) == YARD.0;
    if market {
        return Some(SHOPS[(i as usize + (h.seed >> 14) as usize % 3) % SHOPS.len()]);
    }
    ((ends && (h.seed >> 11) % 3 != 0) || (h.seed >> 11) % 7 == 0).then(|| SHOPS[(h.seed >> 14) as usize % SHOPS.len()])
}

/// A shop's front on a house: a window where the garage was, an awning in stripes over the pavement, and over that
/// a board with what it sells in letters. The letters read from the street, whichever way the house faces.
fn stamp_shop(h: &Built, s: &mut Scratch, name: &str) {
    if s.lod > 1 {
        return;
    }
    let w = h.wide();
    let hue = (h.seed >> 19) as u8 % 24;
    h.put(s, (6, w - 6), (0, 1), (8, 23), 0, Meet::Middle);
    h.put(s, (6, w - 6), (1, 2), (2, 23), kind(GLASS, colour(13, 0)), Meet::Middle);
    h.put(s, (6, w - 6), (0, 2), (2, 8), h.trim, Meet::Middle);
    // The door is kept: it is cut again through the sill.
    let door = if (h.seed >> 28) & 1 == 0 { (52, 64) } else { (10, 22) };
    h.put(s, door, (0, 1), (2, 25), 0, Meet::Middle);
    h.put(s, door, (1, 2), (2, 25), kind(WOOD, colour(hue, 5)), Meet::Middle);
    for stripe in 0..(w - 8) / 4 {
        let cloth = if stripe % 2 == 0 { kind(PLASTER, colour(hue, 4)) } else { kind(PLASTER, WHITE) };
        // No further out than a street tree's crown is kept from the fronts.
        h.put(s, (4 + stripe * 4, 8 + stripe * 4), (-7, 0), (25, 26), cloth, Meet::Middle);
        h.put(s, (4 + stripe * 4, 8 + stripe * 4), (-7, -6), (23, 25), cloth, Meet::Middle);
    }
    // The board stands out past a bay over it, so the bay does not hide what it says.
    h.put(s, (6, w - 6), (-9, 0), (27, 38), kind(WOOD, colour(hue, 6)), Meet::Middle);
    if s.lod == 0 {
        // The letters are lamp, in a pale tint of the shop's own: white by day, lit in that colour after dark.
        let lit = kind(LAMP, colour((h.seed >> 23) as u8 % 24, 1));
        let long = name.len() as i32 * 6 - 1;
        let from = (w - long) / 2;
        for (n, c) in name.bytes().enumerate() {
            for (row, bits) in letter(c).into_iter().enumerate() {
                for col in 0..5 {
                    if bits >> (4 - col) & 1 == 1 {
                        let across = from + n as i32 * 6 + col;
                        // From the street a front that runs back along +z is seen with x to the left.
                        let u = if h.back > 0 { w - 1 - across } else { across };
                        h.put(s, (u, u + 1), (-10, -9), (35 - row as i32, 36 - row as i32), lit, Meet::Touch);
                    }
                }
            }
        }
    }
}

pub const YARD_TOWER: (i32, i32) = (400, 250);
pub const YARD_CHIMNEY: (i32, i32) = (700, 190);
pub const YARD_OFFICE: (i32, i32) = (940, 550);
pub const YARD_CANOPY: (i32, i32) = (400, 470);
pub const YARD_STACK: (i32, i32) = (560, 560);

/// The tank of the water tower in the yard a place is in, if it is in one: the middle of its floor, inside
/// (`stamp_water_tower`). Whether it still stands is the world's to say.
pub fn tank_near(x: i32, z: i32) -> Option<[i32; 3]> {
    let (bx, bz) = (x.div_euclid(BLOCK_X), z.div_euclid(BLOCK_Z));
    if block(bx, bz) != Block::Yard {
        return None;
    }
    let (tx, tz) = (bx * BLOCK_X + YARD_TOWER.0, bz * BLOCK_Z + YARD_TOWER.1);
    Some([tx, ground(tx, tz) + 116, tz])
}

fn stamp_yard(s: &mut Scratch, x0: i32, z0: i32, reaches: &impl Fn(i32, i32, i32, i32) -> bool) {
    let (tx, tz) = (x0 + YARD_TOWER.0, z0 + YARD_TOWER.1);
    if reaches(tx - 26, tx + 26, tz - 26, tz + 26) {
        stamp_water_tower(s, tx, tz);
    }
    let (cx, cz) = (x0 + YARD_CHIMNEY.0, z0 + YARD_CHIMNEY.1);
    if reaches(cx - 8, cx + 8, cz - 8, cz + 8) {
        stamp_chimney(s, cx, cz);
    }
    let (ox, oz) = (x0 + YARD_OFFICE.0, z0 + YARD_OFFICE.1);
    if reaches(ox, ox + 120, oz, oz + 100) {
        stamp_office(s, ox, oz);
    }
    // Containers stacked by the far fence: three on the ground, two on them.
    let (kx, kz) = (x0 + YARD_STACK.0, z0 + YARD_STACK.1);
    if reaches(kx, kx + 200, kz, kz + 70) && s.lod <= 2 {
        let g = (0..3).map(|n| ground(kx + n * 66 + 30, kz + 12)).max().unwrap() + 1;
        for n in 0..3 {
            // Each stands on footings down to the yard, which may slope.
            s.fill([kx + n * 66, ground(kx + n * 66 + 30, kz + 12) - 2, kz], [kx + n * 66 + 60, g, kz + 24], kind(CONCRETE, grey(8)), Meet::Touch);
            stamp_container(s, kx + n * 66, g, kz, true, hash(x0 + n, z0, 71));
        }
        for n in 0..2 {
            stamp_container(s, kx + 30 + n * 66, g + 26, kz, true, hash(x0 + n, z0, 72));
        }
    }
    let (px, pz) = (x0 + YARD_CANOPY.0, z0 + YARD_CANOPY.1);
    if reaches(px, px + 150, pz, pz + 80) {
        stamp_canopy(s, px, pz);
    }
    for (i, (dx, dz)) in [(250, 180), (560, 420), (860, 300), (1050, 200), (200, 620), (700, 620)].into_iter().enumerate() {
        if reaches(x0 + dx - 20, x0 + dx + 20, z0 + dz - 20, z0 + dz + 20) {
            stamp_tree(s, x0 + dx, z0 + dz, hash(x0 + dx, z0 + dz, 61 + i as u32), (ANYWHERE, ANYWHERE));
        }
    }
}

/// Where someone on foot stands at a column by the town's rule (#218): how high their feet are (the first cell over
/// the ground's top and its kerb), whether what is under them is paving (a street's pavement, a paved lot), and what
/// sort of block it is (0 open country, 1 shore, 2 park, 3 homes, 4 towers, 5 yard). It reads the rule and changes
/// nothing: the people of the town are never cells of it.
pub fn footing(x: i32, z: i32) -> (i32, bool, i32) {
    let g = ground(x, z);
    let (top, kerb) = surface(x, z, g);
    let sort = match block(x.div_euclid(BLOCK_X), z.div_euclid(BLOCK_Z)) { Block::Open => 0, Block::Shore => 1, Block::Park => 2, Block::Homes => 3, Block::Towers => 4, Block::Yard => 5 };
    (g + 1 + kerb, material(top) == CONCRETE, sort)
}

/// What the ground's top cell is at a column, and how many cells stand on it (a pavement is a kerb above the road).
fn surface(x: i32, z: i32, g: i32) -> (Kind, i32) {
    let country_here = is_open(x.div_euclid(BLOCK_X), z.div_euclid(BLOCK_Z));
    if g < SEA + 6 {
        return (if country_here { sea_bed(x, z, g) } else { kind(SAND, OWN) }, 0);
    }
    if country_here {
        return (country(x, z, g), 0);
    }
    let (lx, lz) = (x.rem_euclid(BLOCK_X), z.rem_euclid(BLOCK_Z));
    let (along_z, along_x) = (lx < STREET, lz < STREET);
    if !along_z && !along_x {
        let kind_of = block(x.div_euclid(BLOCK_X), z.div_euclid(BLOCK_Z));
        return (match kind_of { Block::Towers => kind(CONCRETE, grey(4)), Block::Yard => kind(ASPHALT, grey(9)), _ => kind(GRASS, OWN) }, 0);
    }
    let asphalt = kind(ASPHALT, OWN);
    if along_z && along_x {
        return (asphalt, 0);
    }
    // `across` runs from one side of the street to the other, `along` down it from the crossing.
    let (across, along) = if along_z { (lx, lz - STREET) } else { (lz, lx - STREET) };
    let length = if along_z { BLOCK_Z } else { BLOCK_X } - STREET;
    if across < PAVEMENT || across >= STREET - PAVEMENT {
        return (kind(CONCRETE, grey(3)), 1);
    }
    if (along >= 4 && along < 26) || (along >= length - 26 && along < length - 4) {
        return (if (across / 5) % 2 == 0 { kind(ASPHALT, WHITE) } else { asphalt }, 0);
    }
    if (across == STREET / 2 - 1 || across == STREET / 2) && (along / 30) % 2 == 0 {
        return (kind(ASPHALT, colour(4, 3)), 0);
    }
    (asphalt, 0)
}

/// What open country is covered with at a column: the road, snow where it is high and not too steep, bare rock
/// where it is steep, sand on the dry plain, forest floor under the pines, else grass.
fn country(x: i32, z: i32, g: i32) -> Kind {
    if let Some(off) = off_road(x, z) {
        if off < 36 {
            let along = x - HOME.0;
            // An old road: its lines worn through in places, cracks across and along it, darker lengths where it was
            // mended, and its edges broken.
            let worn = unit(x >> 3, z >> 2, 87);
            if off < 1 && (along / 30) % 2 == 0 && worn > 0.12 {
                return kind(ASPHALT, colour(4, 3));
            }
            if (off == 32 || off == 33) && worn > 0.08 {
                return kind(ASPHALT, WHITE);
            }
            if off > 33 && unit(x >> 2, z, 88) < (off - 33) as f32 * 0.3 {
                return kind(SAND, colour(2, 8));
            }
            // A crack is where a noise crosses its middle between this column and the next: one cell wide wherever it runs.
            let side = |n: f32| n > 0.5;
            let crack = side(noise(x * 5, z, 900, 89)) != side(noise(x * 5 + 5, z + 1, 900, 89)) || side(noise(x, z * 7, 1300, 90)) != side(noise(x + 1, z * 7 + 7, 1300, 90));
            return kind(ASPHALT, if crack { grey(13) } else if noise(x, z * 3, 700, 91) > 0.68 { grey(11) } else { OWN });
        }
    }
    let (p, d) = (peaks(x, z), dry(x, z));
    // Far from the town the land is the planet's (#228), and is covered as the planet shows it from space: snow
    // and ice where it is coldest, whatever the land is.
    let w = far(x, z);
    let frost = if w > 0.0 { cold(z) } else { 0.0 };
    if frost > 0.0 && frost + (noise(x, z, 30_000, 75) - 0.5) * 0.06 > 0.87 {
        return kind(SAND, WHITE);
    }
    // How steep: the most the ground changes over 4.8 m to either side, in cells a cell. Taken over that much so
    // that snow and rock lie in sheets and faces, not cell by cell.
    // Also how far the ground falls to the south over that much (cells): a face that looks south.
    let lie = |far: i32| {
        let (a, b, c, e) = (ground(x - far, z), ground(x + far, z), ground(x, z - far), ground(x, z + far));
        (((a - b).abs().max((c - e).abs())) as f32 / (far * 2) as f32, (c - e) * 48 / far, (a + b + c + e) as f32 / 4.0 - g as f32)
    };
    let steep = || lie(48).0;
    // By the sea: dark rock where the land falls to it in cliffs and where stacks stand out of it, a beach where it
    // comes down gently.
    if offshore(x, z).is_some_and(|s| s > -1400.0) {
        let s = steep();
        if s > 0.75 {
            return kind(ROCK, if noise(x, z + g * 3, 260, 47) > 0.5 { colour(2, 9) } else { grey(9 + (noise(x, z, 900, 48) * 3.0) as u8) });
        }
        if g < 26 + (noise(x, z, 400, 49) * 30.0) as i32 {
            return kind(SAND, colour(3, 7));
        }
    }
    if p > 0.0 {
        // The way down from the refuge: snow trodden hard and grey, earth where it has left the snow.
        if let Some((_, aside)) = way(x, z).filter(|w| w.1.abs() < 7) {
            let line = 4300 + (noise(x, z, 5200, 41) * 2000.0) as i32;
            return if g > line { kind(SAND, grey(if aside.abs() < 4 { 4 } else { 2 })) } else { kind(EARTH, OWN) };
        }
        // In the mountains how steep is taken over 16 m to either side: over less, the small broken faces made every
        // high flank steep, and from far a mountain was a grey speckle of rock and snow.
        let (s, south, hollow) = lie(160);
        // The snow lies from about 430 m up, lower on faces that look north than on those that look south, and in
        // patches for the first 90 m. It holds on all but the steep faces, deeper in the gullies and hollows and
        // blown off the ribs and crests between them: rock shows in streaks down a face, not in blots.
        let south = south.clamp(-60, 60);
        let line = 4300 + (noise(x, z, 5200, 41) * 2000.0) as i32 + south * 12;
        if g > line && noise(x, z, 330, 50) * 900.0 < (g - line) as f32 && s - hollow.clamp(-10.0, 40.0) * 0.006 < 1.2 + noise(x, z, 1300, 40) * 0.25 {
            return snow(x, z, s);
        }
        if s > 0.7 || g > 5000 {
            return crag(x, z, g);
        }
        if wooded(x, z, g) {
            return kind(GRASS, colour(8, 6));
        }
    }
    if d > 0.0 && unit(x >> 3, z >> 3, 43) < d * 1.4 {
        if d > 0.5 && steep() > 0.7 {
            // The walls of the tables: beds of rock a few metres thick, red and paler, one over another.
            let bed = (g + (noise(x, z, 2600, 67) * 60.0) as i32).div_euclid(28);
            return kind(ROCK, colour(1 + (hash(bed, 0, 68) % 2) as u8, [9, 8, 9, 5, 8][(hash(bed, 1, 68) % 5) as usize]));
        }
        // By the road a shoulder of grit. Then red earth, paler and darker in drifts a few hundred metres across,
        // speckled: pale crusts some metres across, dark fields of small stones, and everywhere the dull green of
        // what grows low, which far off is all that is seen of the scrub.
        if off_road(x, z).is_some_and(|off| off < 60) {
            return kind(SAND, colour(2, if unit(x >> 1, z >> 1, 92) > 0.5 { 8 } else { 7 }));
        }
        let patch = noise(x, z, 190, 93) * 0.6 + noise(x, z, 47, 94) * 0.4;
        if unit(x >> 3, z >> 3, 95) < 0.08 && unit(x >> 2, z >> 2, 96) < 0.7 {
            return kind(SAND, colour(4, 9));
        }
        if patch > 0.66 {
            return kind(SAND, colour(2, 7));
        }
        if patch < 0.3 {
            return kind(SAND, colour(1, 9));
        }
        let tone = noise(x, z, 2400, 44) * 3.0 + unit(x >> 2, z >> 2, 46) * 1.2;
        return kind(SAND, colour(if noise(x, z, 5300, 69) > 0.5 { 1 } else { 2 }, [8, 8, 9, 5][(tone as usize).min(3)]));
    }
    if w > 0.0 {
        // The planet's dry lands: thin dry grass at their edges, then bare ground, red earth in some countries
        // and pale sand in others, in drifts. Its cold lands short of the snow: brown moor.
        let (a, chance) = (arid(x, z), unit(x >> 3, z >> 3, 43));
        if chance < ease(0.35, 0.9, a) * w * 1.4 {
            let tone = (noise(x, z, 2400, 44) * 3.0 + unit(x >> 2, z >> 2, 46) * 1.2) as usize;
            return kind(SAND, if red(x, z) { colour(1, [8, 8, 9, 5][tone.min(3)]) } else { colour(3, [7, 7, 8, 2][tone.min(3)]) });
        }
        if chance < ease(0.0, 0.5, a) * w * 1.4 {
            return kind(GRASS, colour(5, 8));
        }
        if chance < ease(0.1, 0.6, frost) * w * 1.4 {
            return kind(GRASS, colour(4, 9));
        }
    }
    if grove(x, z, g).is_some() { meadow(x, z, g) } else { kind(GRASS, OWN) }
}

/// Snow at a place, `steep` cells a cell. It is sand in white (it lies even, where rock is rough), and not one
/// white: the wind lays it in long drifts and scours it to pale blue ice between them, and on steep faces it has
/// slid and is greyer.
fn snow(x: i32, z: i32, steep: f32) -> Kind {
    // Along the wind and across it: the drifts are some ten times longer than they are wide.
    let (along, across) = ((x * 3 + z) / 4, (z * 3 - x) * 2);
    let drift = noise(along, across, 700, 74) * 0.45 + noise(along * 2, across * 3, 260, 75) * 0.55;
    kind(SAND, if drift > 0.64 { colour(15, 0) } else if steep > 1.05 || drift < 0.34 { grey(2) } else if drift < 0.52 { grey(1) } else { WHITE })
}

/// Bare rock in the mountains: dark beside the snow, in beds some metres thick that dip across the range, a thick
/// bed and thin ones, a few of them brown.
fn crag(x: i32, z: i32, g: i32) -> Kind {
    let lie = g + x / 5 - z / 9 + (noise(x, z, 3100, 42) * 420.0) as i32;
    let (thick, thin) = (lie.div_euclid(260), lie.div_euclid(34));
    let tone = 9 + (hash(thick, 0, 76) % 3) as u8 + (hash(thin, 1, 76) % 2) as u8;
    kind(ROCK, if hash(thick, 2, 76) % 5 == 0 && hash(thin, 3, 76) % 2 == 0 { colour(2, 9) } else { grey(tone) })
}

/// Reefs and what grows on them keep to water this deep, in cells: the shelf. Under that the floor is bare sand.
const SHELF: i32 = 260;

/// How much of a reef a place on the sea's floor is: 0 on the open sand, 1 on the mounds (land.rs raises them by the
/// same noise).
fn reef(x: i32, z: i32) -> f32 {
    let r = noise(x, z, 900, 56);
    ((r - 0.5) / 0.3).clamp(0.0, 1.0) * (0.4 + 0.6 * noise(x, z, 230, 57))
}

/// What the sea's floor is covered with out of town: pale sand in drifts, and on the reefs rock with what grows flat
/// on it in patches a few metres across, rose and olive and ochre.
fn sea_bed(x: i32, z: i32, g: i32) -> Kind {
    if g < SEA && g > SEA - SHELF && reef(x, z) > 0.12 {
        // A reef is grown over column by column (land.rs `reef_column`). The mounds are pale heads and gold and olive
        // weed, paler the taller a column stands and the higher on its mound; the hollows between are dark; a
        // patch of violet now and then. What sort grows changes from mound to mound, not from column to column: at
        // random it was camouflage. (Red and orange are black at this depth.)
        let (cx, cz) = (x.div_euclid(3), z.div_euclid(3));
        // A stack's foot is bare dark rock, banded.
        if noise(x, z, 310, 59) > 0.8 {
            return kind(ROCK, if noise(x, z + g * 3, 260, 47) > 0.5 { colour(2, 9) } else { grey(9 + (noise(x, z, 900, 48) * 3.0) as u8) });
        }
        let smooth = reef_form(x, z).0 / 64.0;
        let high = smooth + reef_column(x, z) * 0.3;
        let sort = noise(x, z, 150, 62) + (unit(cx, cz, 63) - 0.5) * 0.1;
        let pick = hash(cx, cz, 64);
        // Tone by height: 0 the hollows, 3 the crowns.
        let tone = ((high - 0.12) * 5.5).clamp(1.0, 3.0) as usize;
        return if smooth < 0.1 {
            kind(ROCK, [colour(9, 9), colour(6, 9), colour(10, 9)][pick as usize % 3])
        } else if sort < 0.42 {
            kind(ROCK, [[colour(4, 7), colour(3, 7)], [colour(3, 0), colour(4, 7)], [colour(3, 0), colour(4, 0)]][tone - 1][pick as usize % 2])
        } else if sort < 0.47 && pick % 2 == 0 {
            kind(ROCK, [colour(19, 1), colour(21, 1), colour(18, 2)][(pick >> 4) as usize % 3])
        } else if sort < 0.62 {
            kind(ROCK, [[colour(5, 8), colour(5, 9)], [colour(5, 7), colour(4, 8)], [colour(5, 1), colour(4, 1)]][tone - 1][pick as usize % 2])
        } else {
            kind(ROCK, [[colour(3, 8), colour(4, 8)], [colour(3, 7), colour(4, 2)], [colour(4, 1), colour(4, 0)]][tone - 1][pick as usize % 2])
        };
    }
    // Ripples in the sand: a paler line every few cells, bent by a slow noise; darker sand in drifts.
    let ripple = (x + (noise(x, z, 90, 65) * 60.0) as i32).rem_euclid(6);
    kind(SAND, if ripple == 0 { WHITE } else if noise(x, z, 300, 66) > 0.6 { colour(4, 7) } else { colour(4, 0) })
}

/// The eight ways the sea may be drifting at a place, and so the way everything that grows in it streams.
const DRIFT: [(i32, i32); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];

/// One blade of kelp from a float at a stipe's side: a ribbon two cells thick that streams `way`, lifted by its
/// float and hanging over towards its end, wide in its middle and ragged along its edges. `spare` is how much
/// further from the ground the support rule lets leaves reach from here (a cell sideways is 1, a cell down 2, up
/// is free): a blade is cut to it, and one with nothing to spare is not grown.
fn stamp_blade(s: &mut Scratch, at: [i32; 3], way: usize, long: i32, lift: i32, hang: i32, spare: i32, shade: Kind, pale: Kind, seed: u32) {
    let dark = kind(LEAVES, colour(5, 9));
    let (dx, dz) = DRIFT[way % 8];
    // A step along a slanting way is two cells sideways, and the wide middle one or two more.
    let reach = if dx != 0 && dz != 0 { 2 } else { 1 };
    // (Kept back: the float's own step out, the wide middle, and the cells of a box that lean on the one that hangs.)
    let kept = 4 + 2 * reach;
    let long = long.min((spare - kept) / reach);
    if long < 4 {
        return;
    }
    let most = (spare - kept - long * reach) / 2;
    s.fill([at[0] + dx, at[1], at[2] + dz], [at[0] + dx + 2, at[1] + 3, at[2] + dz + 2], pale, Meet::Middle);
    let mut drop = 0;
    for out in 2..=long {
        // It hangs over more and more steeply, never by more than its own thickness in a step: it would part.
        drop = ((out - 2) * (out - 2) / hang).min(most).min(drop + 2);
        let y = at[1] + out.min(4) / 2 + out / lift - drop;
        let ragged = hash(out, way as i32, seed);
        let wide = if out < 3 || out > long - 1 { 0 } else { 1 } + if long > 9 && out > 3 && out < long - 2 && ragged % 3 != 0 { 1 } else { 0 };
        // Wider to one side than the other, by turns: an edge that is not a ruled line.
        let (l, r) = (wide - (ragged >> 3) as i32 % 2 * wide.min(1), wide - (ragged >> 4) as i32 % 2 * wide.min(1));
        let (cx, cz) = (at[0] + dx * out, at[2] + dz * out);
        // Dark by the stipe, its own colour along it, pale at its end.
        let tone = if out * 3 < long { dark } else if out >= long - 1 { pale } else { shade };
        s.fill([cx - dz.abs() * l, y, cz - dx.abs() * l], [cx + 2 + dz.abs() * r, y + 2, cz + 2 + dx.abs() * r], tone, Meet::Middle);
    }
}

/// A frond of kelp that hangs: out from its float a step or two, then down along the stipe as a ragged ribbon,
/// drawn a little the way the sea drifts. Tiers of blades held out level were the branches of a pine; what hangs
/// is weed. A cell down is 2 by the support rule, so a frond is as long as `spare` lets it be.
fn stamp_frond(s: &mut Scratch, at: [i32; 3], way: usize, long: i32, spare: i32, shade: Kind, pale: Kind, seed: u32) {
    let dark = kind(LEAVES, colour(5, 9));
    let (dx, dz) = DRIFT[way % 8];
    let reach = if dx != 0 && dz != 0 { 2 } else { 1 };
    let long = long.min((spare - 4 - 5 * reach) / 2);
    if long < 3 {
        return;
    }
    s.fill([at[0] + dx, at[1], at[2] + dz], [at[0] + dx + 2, at[1] + 3, at[2] + dz + 2], pale, Meet::Middle);
    let (mut cx, mut cz) = (at[0] + dx * 2, at[2] + dz * 2);
    let mut outs = 2;
    for down in 0..long {
        let ragged = hash(down, way as i32, seed);
        // A step further out now and then, three at most: it hangs away from the stipe as it goes down.
        if outs < 5 && down > 0 && ragged % 4 == 0 {
            cx += dx;
            cz += dz;
            outs += 1;
        }
        let wide = if down == 0 || down >= long - 1 { 0 } else { 1 };
        let (l, r) = (wide - (ragged >> 3) as i32 % 2 * wide, wide - (ragged >> 4) as i32 % 3 / 2 * wide);
        let y = at[1] + 1 - down;
        let tone = if down < 2 { dark } else if down >= long - 2 { pale } else { shade };
        s.fill([cx - dz.abs() * l, y, cz - dx.abs() * l], [cx + 2 + dz.abs() * r, y + 2, cz + 2 + dx.abs() * r], tone, Meet::Middle);
    }
}

/// Giant kelp: from a holdfast on the rock a few stipes climb towards the top of the water and fan apart, each
/// leaning its own way round the sea's drift. Fronds grow in clumps with bare stipe between: in a clump blades of
/// every length stream from floats, some held up, some level, most hanging over, gold and olive; and a stipe that
/// reaches the top lies along under it, its blades hanging. (Pairs of blades at every step, turned a quarter each
/// time, were a fir tree; a blade at every step all the way up, a cypress.) Leaves reach 40 from the ground by the
/// support rule: what a stipe leans is taken off what its blades may reach.
fn stamp_kelp(s: &mut Scratch, x: i32, z: i32, g: i32, deep: i32, seed: u32) {
    let drift = (noise(x, z, 5000, 87) * 24.0) as usize % 8;
    let stem = kind(LEAVES, colour(5, 9));
    let golds = [colour(4, 3), colour(4, 4), colour(5, 3), colour(4, 5), colour(4, 8), colour(5, 4), colour(3, 3), colour(4, 4)];
    let pale = kind(LEAVES, colour(4, 2));
    s.ball([x, g, z], 4, kind(LEAVES, colour(5, 6)), 0, seed, None);
    // No two alike: one plant is young and half the height, one leans hard with shorter blades, one stands nearly
    // straight with long ones.
    let grown = [100, 100, 85, 100, 60, 100, 45, 90][(seed >> 9) as usize % 8];
    let leans = 3 + (seed >> 14) as i32 % 7;
    for n in 0..3 + (seed >> 6) % 3 {
        let h = hash(x + n as i32 * 7, z, seed ^ 77);
        // Each stipe its own way: down the drift, or a turn or two to either side of it.
        let way = (drift + [0, 1, 7, 2, 6][n as usize % 5]) % 8;
        let (dx, dz) = DRIFT[way];
        let slant = if dx != 0 && dz != 0 { 2 } else { 1 };
        // Most stop short of the top; some reach it and lie along it.
        let tall = (deep - 3).min(deep * (58 + (h % 50) as i32) / 100 * grown / 100);
        let (mut wx, mut wz, mut y) = (x - 2 + (h >> 8) as i32 % 4, z - 2 + (h >> 11) as i32 % 4, g);
        // How far from the ground the stipe is here, as the support rule counts it.
        let mut far = 3;
        // A clump of fronds is this many steps more; then bare stipe until the next begins. None in the first two
        // metres over the rock, and none hangs down into them: what stands on the reef round it (tubes, heads of
        // rock) is put after and would cut a blade through, and its end would be loose.
        let (mut clump, mut bare) = (0, 5 + (h >> 20) as i32 % 4);
        while y < g + tall {
            let t = hash3(wx, y, wz, h);
            s.fill([wx, y, wz], [wx + 2, y + 4, wz + 2], stem, Meet::Touch);
            if clump == 0 && bare == 0 {
                clump = 2 + (t % 4) as i32;
                bare = 1 + ((t >> 3) % 4) as i32;
            }
            if clump > 0 && y + 6 < SEA {
                clump -= 1;
                for b in 0..2 + (t >> 6) % 2 {
                    let t = hash3(wx, y + b as i32, wz, h ^ 9);
                    // Mostly the stipe's own way, some a turn or two to either side, a short one against it.
                    let turn = [0, 0, 1, 7, 0, 2, 6, 4][(t >> 4) as usize % 8];
                    let long = if turn == 4 { 4 + (t >> 8) as i32 % 3 } else { 5 + (t >> 8) as i32 % 7 + (y - g) * 4 / tall.max(1) };
                    // Two in three hang down along the stipe; the rest stream out from it, held up by the float or
                    // hanging over.
                    if (t >> 1) % 3 != 0 {
                        stamp_frond(s, [wx, y + b as i32, wz], way + [0, 1, 7, 2, 6, 4, 3, 5][(t >> 4) as usize % 8], 5 + (t >> 8) as i32 % 9, (40 - far).min(8 + (y - g - 20) * 2), kind(LEAVES, golds[(t >> 18) as usize % 8]), pale, t);
                        continue;
                    }
                    stamp_blade(s, [wx, y + b as i32, wz], way + turn, long, [2, 99, 99, 99, 99, 99][(t >> 26) as usize % 6], [1, 1, 2, 2, 3, 5, 8, 30][(t >> 13) as usize % 8], (40 - far).min(8 + (y - g - 20) * 2), kind(LEAVES, golds[(t >> 18) as usize % 8]), pale, t);
                }
            } else if bare > 0 {
                bare -= 1;
            }
            // It leans its way, more the higher it is, and wanders a little.
            if far < leans && ((t >> 22) % 100) as i32 * tall < leans * 400 / slant * (50 + (y - g) * 100 / tall.max(1)) / 100 {
                wx += dx;
                wz += dz;
                far += slant;
            } else if far < leans && (t >> 29) == 0 {
                wx += dz;
                wz -= dx;
                far += slant;
            }
            y += 4;
        }
        if tall == deep - 3 {
            // Along under the top of the water, its blades hanging from it.
            for along in 0..(6 + (h >> 16) as i32 % 8) / slant {
                wx += dx;
                wz += dz;
                far += slant;
                s.fill([wx, y - 2, wz], [wx + 2, y, wz + 2], stem, Meet::Touch);
                let t = hash3(wx, along, wz, h);
                if t % 2 == 0 {
                    stamp_blade(s, [wx, y - 5, wz], way + [0, 1, 7][(t >> 4) as usize % 3], 5 + (t >> 8) as i32 % 7, 99, 3 + (t >> 13) as i32 % 4, 40 - far - 6, kind(LEAVES, golds[(t >> 18) as usize % 8]), pale, t);
                }
            }
        }
    }
}

/// What grows and lies on the sea's floor in one patch out of town. On the reefs kelp stands in forests with open
/// water between, and round it the small things of a reef: tubes in bunches, round heads of rock, red weed, dark
/// urchins. On the sand eelgrass in meadows and a boulder now and then.
fn stamp_reef(s: &mut Scratch, x: i32, z: i32, g: i32, seed: u32) {
    let deep = SEA - g;
    // Nothing grows in the deep: kelp 90 m tall would stand there otherwise, through a dozen sectors.
    if deep < 14 || deep > SHELF {
        return;
    }
    let (px, pz) = (x.div_euclid(FIELD), z.div_euclid(FIELD));
    let sort = (seed >> 12) % 24;
    let on = reef(x, z);
    if on > 0.12 {
        if deep > 45 && sort < 5 && noise(px, pz, 5, 78) > 0.42 {
            stamp_kelp(s, x, z, g, deep, seed);
            return;
        }
        // Small things, a few to a patch, each on its own ground. The round heads of rock are put last: a blade of
        // weed put through the edge of one left a cell of it hanging in the water.
        for n in (0..8u32).map(|n| n % 4 + (n / 4) * 16) {
            let (heads, n) = (n >= 16, n % 16);
            let h = hash(px * 8 + n as i32, pz, 79);
            if heads != ((h >> 12) % 9 == 2 || (h >> 12) % 9 == 5) {
                continue;
            }
            let (tx, tz) = (px * FIELD + 3 + (h % 42) as i32, pz * FIELD + 3 + ((h >> 6) % 42) as i32);
            let tg = ground(tx, tz);
            if SEA - tg < 14 {
                continue;
            }
            match (h >> 12) % 9 {
                0 | 1 => {
                    // Tubes in a bunch, pale at their mouths.
                    let hue = [4u8, 19, 21, 5][(h >> 16) as usize % 4];
                    for tube in 0..3 + (h >> 18) % 4 {
                        let t = hash(tx + tube as i32, tz, 80);
                        let (ux, uz, high) = (tx - 3 + (t % 7) as i32, tz - 3 + ((t >> 3) % 7) as i32, 4 + ((t >> 6) % 9) as i32);
                        let ug = ground(ux, uz);
                        s.fill([ux, ug - 2, uz], [ux + 2, ug + high, uz + 2], kind(ROCK, colour(hue, 1)), Meet::Touch);
                        s.fill([ux, ug + high, uz], [ux + 2, ug + high + 1, uz + 2], kind(ROCK, colour(hue, 0)), Meet::Middle);
                    }
                }
                2 => {
                    let r = 3 + ((h >> 16) % 5) as i32;
                    s.ball([tx, tg + r / 2, tz], r, kind(ROCK, colour([4u8, 3, 20, 7][(h >> 20) as usize % 4], [1, 2, 7][(h >> 22) as usize % 3])), 0, h, None);
                }
                3 | 4 => {
                    // Red weed: a low tuft.
                    for blade in 0..7u32 {
                        let t = hash(tx + blade as i32, tz, 82);
                        let (ux, uz) = (tx - 4 + (t % 9) as i32, tz - 4 + ((t >> 4) % 9) as i32);
                        let ug = ground(ux, uz);
                        s.fill([ux, ug, uz], [ux + 1, ug + 3 + ((t >> 8) % 6) as i32, uz + 1], kind(LEAVES, colour(21, [3, 4, 2][(t >> 12) as usize % 3])), Meet::Touch);
                    }
                }
                5 => s.ball([tx, tg, tz], 2, kind(ROCK, colour(18, 5)), 0, h, None),
                _ => {}
            }
        }
        return;
    }
    if noise(px, pz, 9, 83) > 0.6 && sort < 14 {
        // Eelgrass on the sand: a tuft of blades that bend over the way the sea drifts. (Straight up they were
        // sticks.)
        let (dx, dz) = DRIFT[(noise(x, z, 5000, 87) * 24.0) as usize % 8];
        for blade in 0..18u32 {
            let h = hash(px * 32 + blade as i32, pz, 84);
            let (bx, bz) = (x - 9 + (h % 19) as i32, z - 9 + ((h >> 5) % 19) as i32);
            let bg = ground(bx, bz);
            let tall = (4 + ((h >> 8) % 10) as i32).min(SEA - bg - 3);
            let leaf = kind(LEAVES, colour(5 + (h >> 12) as u8 % 3, [2, 3, 1, 2][(h >> 14) as usize % 4]));
            let (wide_x, wide_z) = (1 + (h >> 16) as i32 % 2, 1 + (h >> 17) as i32 % 2);
            // Three lengths of it, each a cell further down the drift than the one under it.
            // (Each a step across one face: on a slanting drift first along x, then along z.)
            let steps = [(0, 0), if dx != 0 { (dx, 0) } else { (0, dz) }, if dx != 0 && dz != 0 { (dx, dz) } else { (dx * 2, dz * 2) }];
            for (part, (ox, oz)) in steps.into_iter().enumerate() {
                let part = part as i32;
                let (lo, hi) = (bg + (tall * part / 3 - 1).max(0), bg + 1 + tall * (part + 1) / 3);
                s.fill([bx + ox, lo, bz + oz], [bx + ox + wide_x, hi, bz + oz + wide_z], leaf, Meet::Touch);
            }
        }
    } else if sort == 23 {
        let r = 4 + ((seed >> 17) % 8) as i32;
        s.ball([x, g - r / 3, z], r, kind(ROCK, grey(8 + (seed >> 21) as u8 % 3)), 0, seed, None);
    }
}

/// Whether pines grow at a place: on the mountains' lower slopes and in the hills before them, in woods with
/// clearings between, not up where the snow lies nor down by the sea.
fn wooded(x: i32, z: i32, g: i32) -> bool {
    g > 300 && g < 4800 && peaks(x, z) > 0.02 && noise(x, z, 2600, 45) > 0.42
}

/// How many patches of every 24 hold a pine at a place: most in the woods, fewer and fewer above them to where
/// the last stand in the snow at about 900 m, in the same stands and clearings as below.
fn pines(x: i32, z: i32, g: i32) -> u32 {
    if g <= 300 || g >= 9000 || peaks(x, z) <= 0.02 || noise(x, z, 2600, 45) <= 0.42 {
        0
    } else if g < 4300 {
        17
    } else {
        1 + (9000 - g) as u32 * 16 / 4700
    }
}

/// How much of a broadleaf wood a place in the grass country is, 0 to 1 (a wood from 0.58, its edge from 0.52):
/// `None` out of that country, which is the town's own land between the mountains, the plain and a kilometre short
/// of the coast, above the lakes' shores.
fn grove(x: i32, z: i32, g: i32) -> Option<f32> {
    if g < SEA + 6 || peaks(x, z) > 0.0 || dry(x, z) > 0.0 || far(x, z) > 0.0 || offshore(x, z).is_some_and(|s| s > -10_000.0) {
        return None;
    }
    Some(noise(x, z, 3400, 97) * 0.7 + noise(x, z, 900, 98) * 0.3)
}

/// What the grass country is covered with: under the woods a dark floor with fallen leaves; by the water dark wet
/// grass; else meadow in several greens, dry and yellow on some swells, and in places thick with small flowers.
fn meadow(x: i32, z: i32, g: i32) -> Kind {
    if grove(x, z, g).is_some_and(|w| w > 0.58) {
        return kind(GRASS, if unit(x >> 1, z >> 1, 102) < 0.22 { colour(2, 9) } else { colour(8, 9) });
    }
    if g < SEA + 14 + (noise(x, z, 300, 103) * 14.0) as i32 {
        return kind(GRASS, colour(8, 6));
    }
    if noise(x, z, 600, 101) > 0.68 && unit(x >> 1, z >> 1, 104) < 0.07 {
        return kind(GRASS, colour([4, 4, 0, 20, 2][hash(x >> 1, z >> 1, 105) as usize % 5], 4));
    }
    let tone = noise(x, z, 1700, 99) * 0.6 + noise(x, z, 310, 100) * 0.4;
    kind(GRASS, if tone < 0.36 { colour(6, 8) } else if tone < 0.5 { OWN } else if tone < 0.66 { colour(7, 3) } else { colour(8, 8) })
}

/// A broad-leaved tree of the grass country: a stout trunk, a crown of three or four balls of leaves, some tall and
/// narrow and some low and wide, each its own green. Far off it is its crown.
fn stamp_oak(s: &mut Scratch, x: i32, z: i32, seed: u32) {
    let g = ground(x, z);
    let (tall, r) = (22 + (seed % 26) as i32, 10 + ((seed >> 5) % 7) as i32);
    let leaves = kind(LEAVES, colour(6 + (seed >> 8) as u8 % 4, [3, 5, 8, 9, 6][(seed >> 11) as usize % 5]));
    if s.lod <= 2 {
        s.fill([x - 1, g - 3, z - 1], [x + 2, g + 1 + tall, z + 2], kind(WOOD, colour(2, 9)), Meet::Touch);
    }
    // Whole balls: a crown thinned out leaves single cells in the air, which nothing holds.
    let thin = 0;
    s.ball([x, g + tall + r / 2, z], r, leaves, thin, seed, None);
    for n in 0..2 + (seed >> 14) % 2 {
        let h = hash(x, z + n as i32, 109);
        let (dx, dz) = ((h % 15) as i32 - 7, ((h >> 4) % 15) as i32 - 7);
        s.ball([x + dx, g + tall + r / 2 + ((h >> 8) % 6) as i32 + 1, z + dz], r * 2 / 3, leaves, thin, h, None);
    }
}

/// A bush: two or three balls of leaves sunk a little into the ground.
fn stamp_bush(s: &mut Scratch, x: i32, z: i32, seed: u32) {
    let leaves = kind(LEAVES, colour(7 + (seed >> 8) as u8 % 3, [5, 8, 9, 6][(seed >> 11) as usize % 4]));
    for n in 0..2 + (seed >> 14) % 2 {
        let h = hash(x + n as i32, z, 106);
        let (bx, bz, r) = (x - 6 + (h % 13) as i32, z - 6 + ((h >> 4) % 13) as i32, 4 + ((h >> 8) % 5) as i32);
        s.ball([bx, ground(bx, bz) + r - 3, bz], r, leaves, 0, h, None);
    }
}

/// Whether a place is kept clear of trees: the refuge's yard, and its way.
fn cleared(x: i32, z: i32) -> bool {
    ((x - REFUGE.0).abs() < 300 && (z - REFUGE.1).abs() < 300) || way(x, z).is_some_and(|w| w.1.abs() < 22)
}

/// Open country is cut into patches this many cells square, and each may hold one thing.
const FIELD: i32 = 48;

/// What stands in one patch of open country: a pine in the woods, a bush or a stone on the dry plain, now and
/// then a tree in the grass.
fn stamp_country(s: &mut Scratch, px: i32, pz: i32) {
    // Far off only the pines are stood, as their shapes: a wood seen from a few hundred metres is still trees.
    if s.lod > 4 {
        return;
    }
    let seed = hash(px, pz, 81);
    let (x, z) = (px * FIELD + 6 + (seed % 36) as i32, pz * FIELD + 6 + ((seed >> 6) % 36) as i32);
    if s.lod > 2 {
        let g = ground(x, z);
        if (seed >> 12) % 24 < pines(x, z, g) && !cleared(x, z) {
            stamp_pine(s, x, z, g, seed);
        } else if let Some(wood) = grove(x, z, g) {
            // A wood far off is still its trees.
            if (seed >> 12) % 24 < if wood > 0.58 { 15 } else if wood > 0.52 { 5 } else { 1 } {
                stamp_oak(s, x, z, seed);
            }
        } else if (seed >> 12) % 24 < 11 && s.lod == 3 && g > SEA + 10 && dry(x, z) > 0.5 && !off_road(x, z).is_some_and(|off| off < 60) {
            // A clump of scrub as one low lump.
            s.fill([x - 5, g - 2, z - 5], [x + 6, g + 7, z + 6], kind(LEAVES, colour(6 + (seed % 3) as u8, [8, 9, 7, 8][(seed >> 2) as usize % 4])), Meet::Middle);
        }
        return;
    }
    let g = ground(x, z);
    if g < SEA {
        return stamp_reef(s, x, z, g, seed);
    }
    if g < SEA + 10 || off_road(x, z).is_some_and(|off| off < 60) || cleared(x, z) {
        return;
    }
    // Nothing is planted on rock that stands in the sea: a tree on a stack's steep top was not held by it.
    if offshore(x, z).is_some_and(|s| s > 0.0) {
        return;
    }
    let sort = (seed >> 12) % 24;
    if pines(x, z, g) > 0 {
        if sort < pines(x, z, g) {
            stamp_pine(s, x, z, g, seed);
        }
    } else if dry(x, z) > 0.5 {
        // Scrub: grey-green bushes in clumps, tufts of dry grass, a spiked plant on a stem now and then, stones.
        let dusty = |n: u32| kind(LEAVES, colour(6 + (n % 3) as u8, [8, 9, 7, 8][(n >> 2) as usize % 4]));
        if sort < 11 {
            for n in 0..2 + (seed >> 17) % 3 {
                let h = hash(px * 4 + n as i32, pz, 85);
                let (bx, bz, r) = (x - 12 + (h % 25) as i32, z - 12 + ((h >> 5) % 25) as i32, 3 + ((h >> 10) % 5) as i32);
                s.ball([bx, ground(bx, bz) + r - 2, bz], r, dusty(h >> 13), 0, h, None);
            }
        } else if sort < 17 {
            for blade in 0..14u32 {
                let h = hash(px * 16 + blade as i32, pz, 86);
                let (bx, bz) = (x - 7 + (h % 15) as i32, z - 7 + ((h >> 4) % 15) as i32);
                let bg = ground(bx, bz);
                s.fill([bx, bg - 1, bz], [bx + 1, bg + 3 + ((h >> 8) % 7) as i32, bz + 1], kind(LEAVES, colour(3 + (h >> 12) as u8 % 2, [7, 8, 2][(h >> 14) as usize % 3])), Meet::Touch);
            }
        } else if sort == 17 {
            let tall = 7 + ((seed >> 17) % 9) as i32;
            s.fill([x, g - 2, z], [x + 2, g + tall, z + 2], kind(WOOD, colour(2, 9)), Meet::Touch);
            s.ball([x + 1, g + tall + 1, z + 1], 3, kind(LEAVES, colour(7, 9)), 0, seed, None);
        } else if sort < 21 {
            let r = 3 + ((seed >> 17) % 8) as i32;
            s.ball([x, g - r / 3, z], r, kind(ROCK, colour(1, 9)), 0, seed, None);
        }
    } else if let Some(wood) = grove(x, z, g) {
        // The grass country: woods of broad-leaved trees with bushes under them and thick at their edges; in the
        // meadows a tree now and then, bushes, tall grass in tufts, a boulder; reeds where the ground is low and wet.
        let (trees, bushes) = if wood > 0.58 { (15, 19) } else if wood > 0.52 { (5, 13) } else { (1, 3) };
        if sort < trees {
            stamp_oak(s, x, z, seed);
        } else if sort < bushes {
            stamp_bush(s, x, z, seed);
        } else if g < SEA + 26 && sort < 17 {
            // Reeds: tall thin stems, some with a brown head.
            for stem in 0..12u32 {
                let h = hash(px * 16 + stem as i32, pz, 107);
                let (bx, bz) = (x - 8 + (h % 17) as i32, z - 8 + ((h >> 5) % 17) as i32);
                let (bg, tall) = (ground(bx, bz), 10 + ((h >> 10) % 12) as i32);
                if bg > SEA {
                    s.fill([bx, bg - 1, bz], [bx + 1, bg + tall, bz + 1], kind(LEAVES, colour(6, 8)), Meet::Touch);
                    if h >> 28 < 6 {
                        s.fill([bx, bg + tall, bz], [bx + 1, bg + tall + 3, bz + 1], kind(LEAVES, colour(2, 9)), Meet::Touch);
                    }
                }
            }
        } else if wood <= 0.52 && sort < 9 {
            // Tall grass in a tuft, green going to straw.
            for blade in 0..12u32 {
                let h = hash(px * 16 + blade as i32, pz, 108);
                let (bx, bz) = (x - 6 + (h % 13) as i32, z - 6 + ((h >> 4) % 13) as i32);
                let bg = ground(bx, bz);
                s.fill([bx, bg - 1, bz], [bx + 1, bg + 3 + ((h >> 8) % 6) as i32, bz + 1], kind(LEAVES, colour(5 + (h >> 12) as u8 % 3, [8, 3, 7][(h >> 14) as usize % 3])), Meet::Touch);
            }
        } else if wood <= 0.52 && sort == 9 {
            let r = 4 + ((seed >> 17) % 8) as i32;
            s.ball([x, g - r / 3, z], r, kind(ROCK, grey(5 + (seed >> 21) as u8 % 4)), 0, seed, None);
        }
    } else if sort == 0 && peaks(x, z) == 0.0 && g >= 6 {
        // (The town's own tree has a thinned crown, which leaves single cells in the air: the rest check found them.)
        stamp_oak(s, x, z, seed);
    }
}

/// A pine: a trunk and tiers of needles that narrow to a point, the upper ones white where it stands near the snow.
/// A tier is eight-sided (two oblongs crossed) and no wider than leaves hold from a trunk.
fn stamp_pine(s: &mut Scratch, x: i32, z: i32, g: i32, seed: u32) {
    // High up they are small.
    let tiers = (5 + ((seed >> 17) % 4) as i32).min(3 + (9300 - g) / 700);
    let green = kind(LEAVES, colour(8 + (seed >> 20) as u8 % 2, [6, 6, 9][(seed >> 22) as usize % 3]));
    if s.lod > 2 {
        // Far off: a wide part under a narrow one.
        let white = if g > 3800 { kind(LEAVES, WHITE) } else { green };
        s.fill([x - 8, g + 8, z - 8], [x + 9, g + 14 + tiers * 4, z + 9], green, Meet::Middle);
        s.fill([x - 4, g + 8, z - 4], [x + 5, g + 18 + tiers * 8, z + 5], white, if s.lod > 3 { Meet::Touch } else { Meet::Middle });
        return;
    }
    s.fill([x - 1, g + 1, z - 1], [x + 2, g + 14 + tiers * 8, z + 2], kind(WOOD, colour(2, 9)), Meet::Touch);
    for tier in 0..tiers {
        let (r, y) = ((3 + (tiers - 1 - tier) * 2).min(13), g + 12 + tier * 8);
        let needles = if g > 3800 && tier * 2 >= tiers { kind(LEAVES, WHITE) } else { green };
        let narrow = r * 3 / 5;
        s.fill([x - r, y, z - narrow], [x + 1 + r, y + 5, z + 1 + narrow], needles, Meet::Middle);
        s.fill([x - narrow, y, z - r], [x + 1 + narrow, y + 5, z + 1 + r], needles, Meet::Middle);
    }
    // The point.
    s.fill([x - 1, g + 14 + tiers * 8, z - 1], [x + 2, g + 20 + tiers * 8, z + 2], if g > 3800 { kind(LEAVES, WHITE) } else { green }, Meet::Middle);
}

/// A scratch with x and z changed over: a thing written to face east is stood to face south.
struct Turned<'a>(&'a mut Scratch);
impl Turned<'_> {
    fn fill(&mut self, lo: [i32; 3], hi: [i32; 3], kind: Kind, meet: Meet) {
        self.0.fill([lo[2], lo[1], lo[0]], [hi[2], hi[1], hi[0]], kind, meet);
    }
    fn ball(&mut self, c: [i32; 3], r: i32, kind: Kind) {
        self.0.ball([c[2], c[1], c[0]], r, kind, 0, 0, None);
    }
}

/// How far the refuge's things stand from its yard's middle, and how high over it: what a sector must reach to hold any.
const REFUGE_REACH: (i32, i32) = (230, 128);

/// The refuge below the pass: a house of stone and dark timber under a steep red roof with snow on it, its windows
/// lit, a chimney, a store of logs under a lean-to, a hut of stone beside it and a mast with a lamp for bad
/// weather. It faces east, where the way comes over the pass. Far off it is its walls and roofs and no more.
fn stamp_refuge(s: &mut Scratch) {
    // Written as if it faced east, and stood turned a quarter: what is x here is the world's z, so the door
    // and the long front look south, down the valley and into the sun.
    let (x, g, z) = (REFUGE.1, REFUGE.2, REFUGE.0);
    let mut s = Turned(s);
    let (near, lod) = (s.0.lod <= 1, s.0.lod);
    // Snow on a roof is roofing in white: sand holds to nothing a few cells from the ground.
    let (stone, timber, roof, snow) = (kind(ROCK, grey(5)), kind(WOOD, colour(1, 9)), kind(ROOFING, colour(0, 5)), kind(ROOFING, WHITE));
    // The house: 7 m across (x) and 12 m long (z), on a foot of stone carried down into the ground.
    let (x0, x1, z0, z1) = (x - 35, x + 35, z - 60, z + 60);
    s.fill([x0 - 4, g - 12, z0 - 4], [x1 + 4, g + 5, z1 + 4], kind(ROCK, grey(7)), Meet::Touch);
    s.fill([x0, g + 5, z0], [x1, g + 17, z1], stone, Meet::Touch);
    s.fill([x0, g + 17, z0], [x1, g + 33, z1], timber, Meet::Touch);
    if near {
        s.fill([x0 + 3, g + 5, z0 + 3], [x1 - 3, g + 33, z1 - 3], 0, Meet::Within);
        s.fill([x0 + 3, g + 4, z0 + 3], [x1 - 3, g + 6, z1 - 3], kind(WOOD, colour(2, 8)), Meet::Touch);
        for pz in [z - 21, z + 18] {
            s.fill([x0 + 3, g + 6, pz], [x1 - 3, g + 33, pz + 3], timber, Meet::Touch);
            s.fill([x - 4, g + 6, pz], [x + 4, g + 25, pz + 3], 0, Meet::Touch);
        }
    }
    // The roof: its ridge along the house, a step up for each step in, over eaves that stand out; the gables are
    // timber to the ridge. Snow lies on it but for the edge of every step and the lowest two.
    for step in 0..20 {
        let (in_by, y) = (step * 2 - 5, g + 33 + step * 2);
        s.fill([x0 + in_by, y, z0 - 5], [x1 - in_by, y + 2, z1 + 5], roof, Meet::Touch);
        if step == 19 {
            s.fill([x0 + in_by, y + 2, z0 - 3], [x1 - in_by, y + 3, z1 + 3], snow, Meet::Middle);
        }
        // Snow on each step of it, all along the upper part and in lengths lower down, where some has slid.
        for part in 0..13 {
            if step > 1 && (step > 9 || hash(part, step / 3, 79) % 3 != 0) {
                let (pz0, pz1) = (z0 - 3 + part * 10, (z0 + 7 + part * 10).min(z1 + 3));
                s.fill([x0 + in_by, y + 2, pz0], [x0 + in_by + 2, y + 3, pz1], snow, Meet::Middle);
                s.fill([x1 - in_by - 2, y + 2, pz0], [x1 - in_by, y + 3, pz1], snow, Meet::Middle);
            }
        }
        // Under it the roof is open to the room, but for the half of each step that the next one stands on.
        let open = (in_by + 4).max(3);
        if near && open + 1 < 35 {
            s.fill([x0 + open, y, z0 + 3], [x1 - open, y + 2, z1 - 3], 0, Meet::Within);
            // The gables, and the two walls that part the house into three rooms, go up to the roof and carry it.
            for gz in [z0, z - 21, z + 18, z1 - 3] {
                s.fill([x0 + open, y, gz], [x1 - open, y + 2, gz + 3], timber, Meet::Touch);
            }
        }
    }
    // The chimney, of stone, through the roof near its north end, with a cap.
    s.fill([x - 16, g + 5, z0 + 14], [x - 8, g + 86, z0 + 22], stone, Meet::Touch);
    s.fill([x - 17, g + 86, z0 + 13], [x - 7, g + 88, z0 + 23], kind(ROCK, grey(9)), Meet::Touch);
    // Windows with the lamps lit behind them, a shutter to each side, and the door in the east wall.
    let (lit, shutter) = (kind(LAMP, colour(3, 1)), kind(WOOD, colour(0, 5)));
    for wz in [z - 44, z - 22, z + 22, z + 44] {
        for (wx0, wx1) in [(x1 - 1, x1), (x0, x0 + 1)] {
            s.fill([wx0, g + 19, wz - 4], [wx1, g + 28, wz + 4], lit, if near { Meet::Touch } else { Meet::Middle });
            if near {
                s.fill([wx0, g + 19, wz - 7], [wx1, g + 28, wz - 4], shutter, Meet::Touch);
                s.fill([wx0, g + 19, wz + 4], [wx1, g + 28, wz + 7], shutter, Meet::Touch);
            }
        }
    }
    if near {
        s.fill([x1 - 3, g + 6, z - 5], [x1, g + 26, z + 5], kind(WOOD, colour(0, 5)), Meet::Touch);
        s.fill([x1 + 4, g + 1, z - 8], [x1 + 10, g + 4, z + 8], kind(ROCK, grey(6)), Meet::Touch);
        // Logs stacked under a lean-to against the south gable.
        for row in 0..7 {
            s.fill([x0 + 6, g + 5 + row * 2, z1 + 4], [x1 - 8, g + 7 + row * 2, z1 + 11], kind(WOOD, colour(2, [8, 9, 3][row as usize % 3])), Meet::Touch);
        }
    }
    s.fill([x0 - 4, g - 12, z1 + 4], [x1 + 4, g + 5, z1 + 16], kind(ROCK, grey(7)), Meet::Touch);
    for step in 0..7 {
        s.fill([x0 + 2, g + 30 - step, z1 + step * 2], [x1 - 4, g + 31 - step, z1 + step * 2 + 3], roof, Meet::Touch);
    }
    s.fill([x0 + 2, g + 5, z1 + 12], [x0 + 5, g + 24, z1 + 15], timber, Meet::Touch);
    s.fill([x1 - 7, g + 5, z1 + 12], [x1 - 4, g + 24, z1 + 15], timber, Meet::Touch);
    // The hut of stone north of the house, its roof one slope under snow.
    let (hx, hz) = (x - 20, z - 130);
    s.fill([hx - 2, g - 12, hz - 2], [hx + 42, g + 4, hz + 34], kind(ROCK, grey(7)), Meet::Touch);
    s.fill([hx, g + 4, hz], [hx + 40, g + 24, hz + 32], kind(ROCK, grey(6)), Meet::Touch);
    for step in 0..8 {
        s.fill([hx - 3 + step * 6, g + 24 + step, hz - 3], [hx + 3 + step * 6, g + 26 + step, hz + 35], roof, Meet::Touch);
        s.fill([hx + step * 6, g + 26 + step, hz - 1], [hx + 3 + step * 6, g + 27 + step, hz + 33], snow, Meet::Middle);
        s.fill([hx + step * 6, g + 20, hz], [hx + 6 + step * 6, g + 24 + step, hz + 32], kind(ROCK, grey(6)), Meet::Touch);
    }
    if near {
        s.fill([hx + 39, g + 5, hz + 11], [hx + 40, g + 22, hz + 21], kind(WOOD, colour(2, 9)), Meet::Touch);
    }
    // The mast south-east of the house: steel on a block of stone, a bar across it, a lamp at its head.
    let (mx, mz) = (x + 90, z + 110);
    s.fill([mx - 5, g - 8, mz - 5], [mx + 7, g + 8, mz + 7], stone, Meet::Touch);
    s.fill([mx, g + 8, mz], [mx + 2, g + 120, mz + 2], kind(STEEL, grey(9)), Meet::Touch);
    s.fill([mx, g + 100, mz - 8], [mx + 2, g + 102, mz + 10], kind(STEEL, grey(9)), Meet::Touch);
    s.fill([mx - 1, g + 120, mz - 1], [mx + 3, g + 125, mz + 3], kind(LAMP, colour(2, 4)), Meet::Touch);
    // A low wall of dry stone along the yard's west side, with a gap where the way goes out.
    for n in 0..34 {
        let (wz, h) = (z - 170 + n * 10, hash(n, 0, 80));
        if !(22..=24).contains(&n) {
            s.fill([x - 172 - (h % 3) as i32, g - 6, wz], [x - 164, g + 6 + (h >> 3) as i32 % 4, wz + 10], kind(ROCK, grey(5 + (h >> 6) as u8 % 4)), Meet::Touch);
        }
    }
    // A pennant under the mast's lamp, red with a white band.
    if lod <= 2 {
        for band in 0..3 {
            s.fill([mx - 14, g + 106 + band * 3, mz], [mx, g + 109 + band * 3, mz + 1], kind(PLASTER, if band == 1 { WHITE } else { colour(0, 4) }), Meet::Touch);
        }
    }
    // A cairn where the way leaves the yard.
    for (r, up) in [(9, 0), (6, 8), (4, 14)] {
        s.ball([x - 150, g + up, z + 120], r, kind(ROCK, grey(7 + up as u8 % 3)));
    }
}

/// A stake by the way down from the refuge: a post taller than the snow lies deep, its head painted to be seen.
fn stamp_stake(s: &mut Scratch, x: i32, z: i32) {
    let g = ground(x, z);
    s.fill([x, g - 4, z], [x + 2, g + 36, z + 2], kind(WOOD, colour(2, 9)), Meet::Touch);
    s.fill([x, g + 36, z], [x + 2, g + 46, z + 2], kind(WOOD, colour(1, 4)), Meet::Touch);
    if s.lod <= 2 {
        s.fill([x - 3, g + 40, z], [x + 5, g + 43, z + 2], kind(WOOD, colour(1, 4)), Meet::Touch);
    }
}

/// A windpump on the plain, south of the road: a tower of four steel legs that lean in, braced, a wheel of blades at
/// its head turned to the road and a vane behind it, and beside it a round tank of rusted steel and a trough.
fn stamp_windpump(s: &mut Scratch, x: i32, z: i32) {
    if s.lod > 4 {
        return;
    }
    let g = [ground(x - 12, z - 12), ground(x + 12, z - 12), ground(x - 12, z + 12), ground(x + 12, z + 12)].into_iter().min().unwrap();
    let (steel, rust) = (kind(STEEL, grey(6)), kind(STEEL, colour(1, 9)));
    // The legs, in lengths that step in towards the head; a ring of braces at the top of each length.
    for part in 0..9 {
        let (out, y) = (12 - part, g - 6 + part * 11);
        for (dx, dz) in [(-1, -1), (1, -1), (-1, 1), (1, 1)] {
            let (lx, lz) = (x + dx * out - (dx - 1) / 2 * 0 - if dx > 0 { 2 } else { 0 }, z + dz * out - if dz > 0 { 2 } else { 0 });
            s.fill([lx, y, lz], [lx + 2, y + 12, lz + 2], steel, Meet::Touch);
        }
        if s.lod <= 2 && part % 2 == 1 {
            s.fill([x - out, y + 10, z - out], [x + out, y + 12, z - out + 2], steel, Meet::Touch);
            s.fill([x - out, y + 10, z + out - 2], [x + out, y + 12, z + out], steel, Meet::Touch);
            s.fill([x - out, y + 10, z - out], [x - out + 2, y + 12, z + out], steel, Meet::Touch);
            s.fill([x + out - 2, y + 10, z - out], [x + out, y + 12, z + out], steel, Meet::Touch);
        }
    }
    // The head: a block, the wheel west of it (a ring and eight blades, one cell thick), the vane east of it.
    let top = g - 6 + 99;
    s.fill([x - 4, top, z - 4], [x + 4, top + 4, z + 4], steel, Meet::Touch);
    let (wx, wy) = (x - 7, top + 2);
    s.fill([x - 7, top + 1, z - 1], [x - 4, top + 3, z + 1], steel, Meet::Touch);
    if s.lod <= 2 {
        for a in -13..=13i32 {
            for b in -13..=13i32 {
                let d2 = a * a + b * b;
                // Blades: wedges round the hub, with gaps between; and the rim.
                let blade = d2 > 9 && d2 <= 150 && (a * b == 0 || a.abs() == b.abs() || (a.abs() - b.abs()).abs() == 1 || a.abs() == 1 || b.abs() == 1);
                if d2 <= 9 || blade || (d2 > 150 && d2 <= 180) {
                    s.fill([wx, wy + a, z + b], [wx + 1, wy + a + 1, z + b + 1], if d2 > 150 { steel } else { kind(STEEL, grey(3)) }, Meet::Touch);
                }
            }
        }
    } else {
        s.fill([wx, wy - 12, z - 12], [wx + 1, wy + 13, z + 13], kind(STEEL, grey(4)), Meet::Middle);
    }
    s.fill([x + 4, top + 1, z], [x + 16, top + 3, z + 1], steel, Meet::Touch);
    s.fill([x + 16, top - 3, z], [x + 26, top + 7, z + 1], kind(STEEL, colour(0, 5)), Meet::Touch);
    // The tank: eight-sided, open, water in it; and the pipe from the tower.
    let (tx, tz) = (x + 45, z + 5);
    let tg = ground(tx, tz);
    for (half, wide) in [(18, 8), (14, 14), (8, 18)] {
        s.fill([tx - half, tg - 8, tz - wide], [tx + half, tg + 22, tz + wide], rust, Meet::Touch);
    }
    if s.lod <= 1 {
        for (half, wide) in [(16, 7), (13, 13), (7, 16)] {
            s.fill([tx - half, tg + 16, tz - wide], [tx + half, tg + 22, tz + wide], 0, Meet::Within);
            s.fill([tx - half, tg + 14, tz - wide], [tx + half, tg + 17, tz + wide], kind(WATER, OWN), Meet::Within);
        }
        s.fill([x + 12, tg + 2, z], [tx - 17, tg + 4, z + 2], steel, Meet::Touch);
        // The trough.
        s.fill([tx - 10, tg - 3, tz + 26], [tx + 22, tg + 6, tz + 36], kind(CONCRETE, grey(5)), Meet::Touch);
        s.fill([tx - 8, tg + 3, tz + 28], [tx + 20, tg + 6, tz + 34], kind(WATER, OWN), Meet::Touch);
    }
}

/// A sign by the road: two posts and a board, green with a white band and an arrow's head.
fn stamp_sign(s: &mut Scratch, x: i32, z: i32) {
    if s.lod > 3 {
        return;
    }
    let g = ground(x, z).min(ground(x, z + 22));
    let post = kind(STEEL, grey(7));
    s.fill([x, g - 4, z], [x + 2, g + 34, z + 2], post, Meet::Touch);
    s.fill([x, g - 4, z + 22], [x + 2, g + 34, z + 24], post, Meet::Touch);
    s.fill([x - 1, g + 20, z - 3], [x, g + 34, z + 27], kind(STEEL, colour(9, 6)), Meet::Touch);
    if s.lod <= 1 {
        s.fill([x - 2, g + 21, z - 2], [x - 1, g + 22, z + 26], kind(STEEL, WHITE), Meet::Touch);
        s.fill([x - 2, g + 32, z - 2], [x - 1, g + 33, z + 26], kind(STEEL, WHITE), Meet::Touch);
        for n in 0..5 {
            s.fill([x - 2, g + 27 - n, z + 6 + n], [x - 1, g + 28 + n, z + 7 + n], kind(STEEL, WHITE), Meet::Touch);
        }
        s.fill([x - 2, g + 26, z + 10], [x - 1, g + 29, z + 20], kind(STEEL, WHITE), Meet::Touch);
    }
}

/// A length of the fence south of the road: a post every 4 m and two wires between.
fn stamp_fence(s: &mut Scratch, x: i32, z: i32) {
    let (g, next) = (ground(x, z), ground(x + 40, z));
    s.fill([x, g - 4, z], [x + 2, g + 13, z + 2], kind(WOOD, colour(2, 9)), Meet::Touch);
    if s.lod <= 1 {
        // The wires run from this post's height to the next one's, a cell at a time.
        for n in 2..40 {
            let lift = (next - g) * n / 40;
            for wire in [6, 11] {
                s.fill([x + n, g + wire + lift, z], [x + n + 1, g + wire + lift + 1, z + 1], kind(STEEL, grey(8)), Meet::Touch);
            }
        }
    }
}

/// A pole by the road: a post and a bar across its top.
fn stamp_pole(s: &mut Scratch, x: i32, z: i32) {
    if s.lod > 2 {
        return;
    }
    let g = ground(x, z);
    if g < SEA + 10 {
        return;
    }
    let wood = kind(WOOD, colour(2, 9));
    s.fill([x, g + 1, z], [x + 2, g + 92, z + 2], wood, Meet::Touch);
    s.fill([x, g + 84, z - 9], [x + 2, g + 86, z + 11], wood, Meet::Touch);
}

/// What stands at a column, for a copy too coarse for walls and windows: its top cell, its sides and its roof.
fn standing(x: i32, z: i32) -> Option<(i32, Kind, Kind)> {
    let (bx, bz) = (x.div_euclid(BLOCK_X), z.div_euclid(BLOCK_Z));
    let (lx, lz) = (x - bx * BLOCK_X - STREET, z - bz * BLOCK_Z - STREET);
    if lx < 0 || lz < 0 {
        return None;
    }
    let row = if lz < LOT_DEEP { 0 } else { 1 };
    match block(bx, bz) {
        Block::Homes => {
            let h = house(bx, bz, row, lx / LOT_WIDE)?;
            h.holds(x, z).then(|| (h.base + house_tall(&h), h.wall, kind(ROOFING, OWN)))
        }
        Block::Towers => {
            let t = tower(bx, bz, row, (lx / TOWER_WIDE).min(2))?;
            t.holds(x, z).then(|| (t.base + tower_tall(&t), t.wall, kind(ROOFING, OWN)))
        }
        _ => None,
    }
}

/// The most that stands above the ground anywhere in a block of this sort.
fn reach(b: Block) -> i32 {
    match b {
        Block::Towers => 40 * TOWER_STOREY + 40,
        Block::Homes => 160,
        Block::Park => 90,
        Block::Shore => 90,
        Block::Yard => 220,
        Block::Open => 130,
    }
}

/// The blocks a box of columns touches, with room for what leans over their edges.
fn blocks(x0: i32, z0: i32, x1: i32, z1: i32) -> impl Iterator<Item = (i32, i32)> {
    let m = 40;
    let (b0, b1) = ((x0 - m).div_euclid(BLOCK_X), (x1 + m).div_euclid(BLOCK_X));
    let (c0, c1) = ((z0 - m).div_euclid(BLOCK_Z), (z1 + m).div_euclid(BLOCK_Z));
    (c0..=c1).flat_map(move |bz| (b0..=b1).map(move |bx| (bx, bz)))
}

/// Copies up to this coarse keep walls, windows, trees and lamps; coarser ones are heights and colours.
const SHAPES_TO: u32 = 3;

/// The ground under a sector as its own coarse columns see it: lowest, highest.
fn ground_range(sx: i32, sz: i32, lod: u32) -> (i32, i32) {
    let (half, mut lo, mut hi) = ((1 << lod) / 2, i32::MAX, i32::MIN);
    for cz in 0..SIDE as i32 {
        for cx in 0..SIDE as i32 {
            let g = ground(((sx * SIDE as i32 + cx) << lod) + half, ((sz * SIDE as i32 + cz) << lod) + half);
            lo = lo.min(g);
            hi = hi.max(g);
        }
    }
    (lo, hi)
}

/// Which sectors of a column of sectors are worth making: below the first is all earth, above the last all air.
pub fn span(sx: i32, sz: i32, lod: u32) -> (i32, i32) {
    let size = (SIDE as i32) << lod;
    let (lo, hi) = ground_range(sx, sz, lod);
    let mut top = hi.max(SEA) + 2;
    if lod <= SHAPES_TO {
        let above = blocks(sx * size, sz * size, (sx + 1) * size, (sz + 1) * size).map(|(bx, bz)| reach(block(bx, bz))).max().unwrap_or(0);
        top += above;
    } else {
        let half = (1 << lod) / 2;
        for cz in 0..SIDE as i32 {
            for cx in 0..SIDE as i32 {
                if let Some((t, _, _)) = standing(((sx * SIDE as i32 + cx) << lod) + half, ((sz * SIDE as i32 + cz) << lod) + half) {
                    top = top.max(t + 1);
                }
            }
        }
    }
    // The refuge is seen from far: its roofs are over the ground in the coarse copies too.
    if lod > SHAPES_TO && (sx + 1) * size > REFUGE.0 - REFUGE_REACH.0 && sx * size < REFUGE.0 + REFUGE_REACH.0 && (sz + 1) * size > REFUGE.1 - REFUGE_REACH.0 && sz * size < REFUGE.1 + REFUGE_REACH.0 {
        top = top.max(REFUGE.2 + REFUGE_REACH.1);
    }
    ((lo - DEEP).div_euclid(size), top.div_euclid(size))
}

/// Makes one sector of the city in `s`, at the coarseness `s` was started with.
pub fn make(s: &mut Scratch) {
    let (k, half) = (s.lod, (1 << s.lod) / 2);
    let side = SIDE as i32;
    let (lo, hi) = s.bounds();
    let near = k <= SHAPES_TO;
    // The ground under every column, and under one beyond each edge.
    let wide = side + 2;
    let mut tops = vec![0i32; (wide * wide) as usize];
    for cz in -1..=side {
        for cx in -1..=side {
            tops[((cz + 1) * wide + cx + 1) as usize] = ground(((s.low[0] + cx) << k) + half, ((s.low[2] + cz) << k) + half);
        }
    }
    // The ground, a column at a time: earth up to its top cell, then what the surface is.
    for cz in 0..side {
        for cx in 0..side {
            let (x, z) = (((s.low[0] + cx) << k) + half, ((s.low[2] + cz) << k) + half);
            let here = ((cz + 1) * wide + cx + 1) as usize;
            let g = tops[here];
            let (top, raise) = surface(x, z, g);
            // Under the sea a coarse column's ground stays a cell under the sea's top, however shallow the water: far
            // water stays water.
            let gy = if g < SEA { (g >> k).min((SEA >> k) - 1) } else { g >> k } - s.low[1];
            let (ux, uz) = (cx as usize, cz as usize);
            // Out of town, what covers the land goes down the side of every step in it, as far as
            // the lowest column beside this one: with earth there, a slope of snow or grass or sand was banded with
            // brown, a line for every step, and a mountain was terraces.
            let covered = if is_open(x.div_euclid(BLOCK_X), z.div_euclid(BLOCK_Z)) {
                let lowest = tops[here - 1].min(tops[here + 1]).min(tops[here - wide as usize]).min(tops[here + wide as usize]);
                (gy - ((g - lowest.min(g)) >> k) - 1).max(0)
            } else {
                gy
            };
            for y in 0..gy.clamp(0, side) {
                s.cells[at(ux, y as usize, uz)] = if y >= covered { top } else { EARTH_KIND };
            }
            let lifted = if k == 0 { raise } else { 0 };
            for y in gy..=gy + lifted {
                if y >= 0 && y < side {
                    s.cells[at(ux, y as usize, uz)] = top;
                }
            }
            if !near {
                if let Some((t, wall, roof)) = standing(x, z) {
                    let ty = (t >> k) - s.low[1];
                    for y in (gy + 1).max(0)..ty.min(side) {
                        s.cells[at(ux, y as usize, uz)] = wall;
                    }
                    if ty > gy && ty >= 0 && ty < side {
                        s.cells[at(ux, ty as usize, uz)] = roof;
                    }
                }
            }
        }
    }
    if !near {
        return;
    }
    for (bx, bz) in blocks(lo[0], lo[2], hi[0], hi[2]) {
        let (x0, z0) = (bx * BLOCK_X, bz * BLOCK_Z);
        let sort = block(bx, bz);
        let reaches = |a0: i32, a1: i32, c0: i32, c1: i32| a1 > lo[0] - 40 && a0 < hi[0] + 40 && c1 > lo[2] - 40 && c0 < hi[2] + 40;
        match sort {
            Block::Homes => {
                for row in 0..2 {
                    for i in 0..LOTS {
                        let lx = x0 + STREET + i * LOT_WIDE;
                        let lz = z0 + STREET + row * LOT_DEEP;
                        if !reaches(lx, lx + LOT_WIDE, lz - 30, lz + LOT_DEEP + 30) {
                            continue;
                        }
                        if let Some(h) = house(bx, bz, row, i) {
                            if h.base - 30 < hi[1] && h.base + house_tall(&h) + 8 > lo[1] {
                                stamp_house(&h, s);
                                if let Some(name) = shop(&h, i) {
                                    stamp_shop(&h, s, name);
                                }
                            }
                            // A tree on the pavement in front of some, its crown kept clear of the house fronts and their bays.
                            // None before a shop: its board stands further out than a crown is kept back.
                            if (h.seed >> 5) % 5 < 2 && shop(&h, i).is_none() {
                                let (tz, keep) = if row == 0 { (z0 + STREET - 16, [i32::MIN, z0 + STREET - 8]) } else { (z0 + BLOCK_Z + 16, [z0 + BLOCK_Z + 8, i32::MAX]) };
                                stamp_tree(s, lx + LOT_WIDE / 2, tz, h.seed, (ANYWHERE, keep));
                            }
                            // And one in some back yards, kept to its own yard.
                            if (h.seed >> 9) % 4 == 0 {
                                stamp_tree(s, lx + 20 + (h.seed % 30) as i32, h.front + h.back * (h.deep + 50), h.seed ^ 77, ([lx + 1, lx + LOT_WIDE - 1], ANYWHERE));
                            }
                        }
                    }
                }
            }
            Block::Towers => {
                for row in 0..2 {
                    for j in 0..3 {
                        let lx = x0 + STREET + j * TOWER_WIDE;
                        let lz = z0 + STREET + row * LOT_DEEP;
                        if !reaches(lx, lx + TOWER_WIDE, lz, lz + LOT_DEEP) {
                            continue;
                        }
                        if let Some(t) = tower(bx, bz, row, j) {
                            if t.base - 30 < hi[1] && t.base + tower_tall(&t) + 30 > lo[1] {
                                stamp_tower(&t, s);
                            }
                        }
                    }
                }
            }
            Block::Park => {
                for j in 0..6 {
                    for i in 0..10 {
                        let seed = hash(bx * 16 + i, bz * 16 + j, 51);
                        if seed % 3 == 0 {
                            continue;
                        }
                        let (tx, tz) = (x0 + STREET + 50 + i * 110 + (seed >> 8) as i32 % 50, z0 + STREET + 50 + j * 105 + (seed >> 16) as i32 % 50);
                        if reaches(tx - 20, tx + 20, tz - 20, tz + 20) {
                            stamp_tree(s, tx, tz, seed, (ANYWHERE, ANYWHERE));
                        }
                    }
                }
            }
            Block::Yard => stamp_yard(s, x0, z0, &reaches),
            Block::Shore => {
                // The sea's floor, patch by patch: the patches of this block that reach into the sector.
                for pz in (lo[2] - 40).max(z0).div_euclid(PATCH)..=(hi[2] + 40).min(z0 + BLOCK_Z - 1).div_euclid(PATCH) {
                    for px in (lo[0] - 40).max(x0).div_euclid(PATCH)..=(hi[0] + 40).min(x0 + BLOCK_X - 1).div_euclid(PATCH) {
                        stamp_sea_floor(s, px, pz);
                    }
                }
            }
            Block::Open => {}
        }
        if sort == Block::Open {
            // Open country, patch by patch: the patches of this block that reach into the sector.
            for pz in (lo[2] - 40).max(z0).div_euclid(FIELD)..=(hi[2] + 40).min(z0 + BLOCK_Z - 1).div_euclid(FIELD) {
                for px in (lo[0] - 40).max(x0).div_euclid(FIELD)..=(hi[0] + 40).min(x0 + BLOCK_X - 1).div_euclid(FIELD) {
                    stamp_country(s, px, pz);
                }
            }
            // The refuge and the stakes down its way, one every 18 m, on one side and the other.
            if reaches(REFUGE.0 - REFUGE_REACH.0, REFUGE.0 + REFUGE_REACH.0, REFUGE.1 - REFUGE_REACH.0, REFUGE.1 + REFUGE_REACH.0) {
                stamp_refuge(s);
            }
            if s.lod <= 4 && reaches(REFUGE.0 - 900, REFUGE.0 + 3400, REFUGE.1 - 6200, REFUGE.1 + 500) {
                for n in 1..33 {
                    // Where the stake stands: along the way, to one side of it and the other by turns.
                    let at = on_way(n * 180, 0);
                    if let Some((_, aside)) = way(at.0, at.1) {
                        // `aside` is how far this place is to the right of the way's middle.
                        let (sx, sz) = on_way(n * 180, -aside + if n % 2 == 0 { 12 } else { -12 });
                        if reaches(sx, sx + 2, sz, sz + 2) && sx >= x0 && sx < x0 + BLOCK_X && sz >= z0 && sz < z0 + BLOCK_Z {
                            stamp_stake(s, sx, sz);
                        }
                    }
                }
            }
            // South of the road: a fence, a sign every 1.2 km and a windpump every 1.2 km, 5 m and 38 m off it.
            if z0 <= HOME.1 + 600 && HOME.1 + 100 < z0 + BLOCK_Z && x0 > HOME.0 + 40_000 {
                if s.lod <= 2 && reaches(lo[0], hi[0], HOME.1 + 100, HOME.1 + 104) {
                    for post in (lo[0] - 40).max(x0).div_euclid(40)..=(hi[0] + 40).min(x0 + BLOCK_X - 1).div_euclid(40) {
                        if post * 40 >= x0 && z0 <= HOME.1 + 100 && HOME.1 + 100 < z0 + BLOCK_Z && dry(post * 40, HOME.1) > 0.5 {
                            stamp_fence(s, post * 40, HOME.1 + 100);
                        }
                    }
                }
                for n in (x0 - 400).div_euclid(12_000)..=(x0 + BLOCK_X + 400).div_euclid(12_000) {
                    let (sx, wx) = (n * 12_000 + 10_300, n * 12_000 + 10_960);
                    if reaches(sx - 4, sx + 4, HOME.1 + 50, HOME.1 + 80) && sx >= x0 && sx < x0 + BLOCK_X && z0 <= HOME.1 + 50 && HOME.1 + 50 < z0 + BLOCK_Z {
                        stamp_sign(s, sx, HOME.1 + 50);
                    }
                    if reaches(wx - 30, wx + 80, HOME.1 + 340, HOME.1 + 420) && wx >= x0 && wx < x0 + BLOCK_X && z0 <= HOME.1 + 380 && HOME.1 + 380 < z0 + BLOCK_Z {
                        stamp_windpump(s, wx, HOME.1 + 380);
                    }
                }
            }
            // Poles along the north side of the road, one every 40 m.
            if z0 <= HOME.1 - 70 && HOME.1 - 70 < z0 + BLOCK_Z {
                for pole in (lo[0] - 40).max(x0).div_euclid(400)..=(hi[0] + 40).min(x0 + BLOCK_X - 1).div_euclid(400) {
                    if pole * 400 >= x0 && pole * 400 > HOME.0 {
                        stamp_pole(s, pole * 400, HOME.1 - 70);
                    }
                }
            }
        } else if sort != Block::Shore {
            // Along the street on the block's low z side and the one on its low x side: cars parked at both kerbs,
            // and now and then something small on the pavement.
            for (along_x, length) in [(true, BLOCK_X - STREET), (false, BLOCK_Z - STREET)] {
                for n in 0..(length - 80) / 58 {
                    let along = STREET + 40 + n * 58;
                    for (side, across) in [(0, PAVEMENT + 2), (1, STREET - PAVEMENT - 20)] {
                        let seed = hash(bx * 64 + n, bz * 4 + side + if along_x { 0 } else { 2 }, 61);
                        let (cx, cz) = if along_x { (x0 + along, z0 + across) } else { (x0 + across, z0 + along) };
                        if seed % 100 < 55 && reaches(cx, cx + 42, cz, cz + 42) {
                            stamp_car(s, cx, cz, along_x, seed);
                        }
                        if (seed >> 7) % 5 == 0 {
                            let edge = if side == 0 { PAVEMENT - 5 } else { STREET - PAVEMENT + 1 };
                            let (px, pz) = if along_x { (x0 + along + 48, z0 + edge) } else { (x0 + edge, z0 + along + 48) };
                            if reaches(px - 2, px + 6, pz - 2, pz + 6) {
                                stamp_small(s, px, pz, seed >> 9);
                            }
                        }
                    }
                }
            }
            // A stop sign at two corners of the crossing, facing who comes to it.
            for (cx, cz, dx, dz) in [(x0 + STREET - 3, z0 + STREET + 6, 0, 1), (x0 + STREET + 6, z0 + 2, -1, 0)] {
                if reaches(cx - 6, cx + 6, cz - 6, cz + 6) {
                    stamp_stop(s, cx, cz, dx, dz);
                }
            }
            // A lamp at each corner of the crossing on the block's low corner, and down both streets at the kerb, now on
            // one side and now on the other: between lots, clear of the street trees and the shops' boards. (The page
            // works out the light they throw from these same places: march.ts LAMPS.)
            let along = [(x0 + STREET + 3 * LOT_WIDE, z0 + 20, 0, 1), (x0 + STREET + 7 * LOT_WIDE, z0 + STREET - 22, 0, -1), (x0 + STREET + 11 * LOT_WIDE, z0 + 20, 0, 1), (x0 + 20, z0 + STREET + 220, 1, 0), (x0 + STREET - 22, z0 + STREET + 440, -1, 0)];
            for (cx, cz, dx, dz) in [(x0 + 8, z0 + 8, 1, 0), (x0 + STREET - 10, z0 + 8, 0, 1), (x0 + 8, z0 + STREET - 10, 0, -1), (x0 + STREET - 10, z0 + STREET - 10, -1, 0)].into_iter().chain(along) {
                if reaches(cx - 16, cx + 18, cz - 16, cz + 18) {
                    stamp_lamp(s, cx, cz, dx, dz);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::{Whole, encode};

    /// The ground a sector of the finest cells stands on, at its middle.
    fn sector_at_ground(x: i32, z: i32) -> (i32, i32, i32) {
        (x.div_euclid(64), ground(x, z).div_euclid(64), z.div_euclid(64))
    }

    /// The town is the same town, cell for cell: sectors at the start, in the yard, on the lake and its floor, and out
    /// to 2.5 km, at every coarseness the page draws them at, made and summed. The board's judged pictures, the bench's
    /// views and the flight all stand inside this. A change to the land round the town, or to anything else, that
    /// moves a cell here fails; if the town was meant to change, the pictures and the baseline are to be taken
    /// again and the sum set to what the failure prints. (Set again on November 12 for the shopping street across
    /// from the water tower and the yard's six-storey office; the shops' row is one of the places since then.)
    #[test]
    fn the_town_is_cell_for_cell_what_it_was() {
        let mut sum = 0xcbf29ce484222325u64;
        let mut s = Scratch::new();
        let places: [(i32, i32); 13] = [(700, 4070), (330, 3990), (400, 4250), (700, 4190), (940, 4550), (680, 4040), (-12000, 4070), (-16300, 4070), (-12760, 3980), (30700, 4070), (15000, 15000), (-20000, -10000), (0, 25000)];
        for (n, &(x, z)) in places.iter().enumerate() {
            // Coarse copies only round the start: further out their sectors reach past the town.
            for lod in if n == 0 { 0..9u32 } else { 0..4u32 } {
                let side = (SIDE as i32) << lod;
                for up in 0..2 {
                    s.start(x.div_euclid(side), ground(x, z).div_euclid(side) + up, z.div_euclid(side), lod);
                    make(&mut s);
                    for &k in &s.cells {
                        sum = (sum ^ k as u64).wrapping_mul(0x100000001b3);
                    }
                }
            }
        }
        assert_eq!(sum, 12774791369607163724, "the town's sum");
    }

    /// Looking for earth laid bare: in the yard across from the start, at each coarseness, how many columns of a
    /// sector at the ground have earth as their top cell. `cargo test --release bare_earth -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bare_earth() {
        for lod in 0..3u32 {
            let side = (SIDE as i32) << lod;
            let mut s = Scratch::new();
            for (x, z) in [(900, 4300), (1000, 4400), (1100, 4350), (600, 4500), (760, 4110), (800, 4200), (900, 4352), (1000, 4250)] {
                let g = ground(x, z);
                let (sx, sy, sz) = (x.div_euclid(side), g.div_euclid(side), z.div_euclid(side));
                s.start(sx, sy, sz, lod);
                make(&mut s);
                let (mut bare, mut tops) = (0, std::collections::BTreeMap::new());
                for cz in 0..SIDE {
                    for cx in 0..SIDE {
                        if let Some(y) = (0..SIDE).rev().find(|&y| s.cells[at(cx, y, cz)] != 0) {
                            *tops.entry(s.cells[at(cx, y, cz)]).or_insert(0) += 1;
                            if s.cells[at(cx, y, cz)] == EARTH_KIND && y < SIDE - 1 { bare += 1 }
                        }
                    }
                }
                let mut tree = Vec::new();
                let whole = encode(&s.cells, &mut tree);
                let high = if tree.len() > 2 { ((tree[2] >> 24) & 15) as usize * 4 + 4 } else { 0 };
                let top = (0..SIDE).rev().find(|&y| (0..SIDE).any(|z| (0..SIDE).any(|x| s.cells[at(x, y, z)] != 0))).unwrap_or(0);
                eprintln!("lod {lod} at {x},{z} (ground {g}, sector {sx} {sy} {sz}): {bare} columns bare; highest cell {top}, the tree says {high} ({}); tops {tops:?}", match whole { Whole::Empty => "empty", Whole::Uniform(_) => "uniform", _ => "tree" });
            }
        }
    }

    #[test]
    fn same_sector_twice_is_the_same() {
        let (mut a, mut b) = (Scratch::new(), Scratch::new());
        let (sx, sy, sz) = sector_at_ground(5000, 3000);
        a.start(sx, sy, sz, 0);
        make(&mut a);
        b.start(sx, sy, sz, 0);
        make(&mut b);
        assert!(a.cells == b.cells);
        assert!(a.cells.iter().any(|&c| c != 0) && a.cells.iter().any(|&c| c == 0), "the ground's sector has ground and air");
    }

    #[test]
    fn span_bounds_what_is_made() {
        let mut s = Scratch::new();
        let mut tree = Vec::new();
        for lod in [0, 2, 4, 6] {
            for (sx, sz) in [(3, 7), (-12, 40), (100, -31), (17, 17)] {
                let (lo, hi) = span(sx, sz, lod);
                assert!(hi >= lo && hi - lo < 40, "lod {lod} span {lo}..{hi}");
                s.start(sx, lo - 1, sz, lod);
                make(&mut s);
                assert_eq!(encode(&s.cells, &mut tree), Whole::Uniform(EARTH_KIND), "under the span is earth (lod {lod}, {sx} {sz})");
                s.start(sx, hi + 1, sz, lod);
                make(&mut s);
                assert_eq!(encode(&s.cells, &mut tree), Whole::Empty, "over the span is air (lod {lod}, {sx} {sz})");
            }
        }
    }

    #[test]
    fn a_blast_takes_glass_further_than_wall() {
        use crate::tree::at;
        // A sector of wall with a pane in it, as a house front is: plaster 2 cells thick, glass in the middle of it.
        let mut s = Scratch::new();
        s.start(0, 0, 0, 0);
        s.fill([0, 0, 30], [64, 64, 32], kind(PLASTER, WHITE), Meet::Touch);
        s.fill([0, 20, 30], [64, 44, 31], kind(GLASS, OWN), Meet::Touch);
        let before: Vec<_> = s.cells.clone();
        s.blast([32, 32, 30], 6, 9);
        let gone = |m: u8| (0..64).filter(|&x| before[at(x, 32, 30)] != 0 && material(before[at(x, 32, 30)]) == m && s.cells[at(x, 32, 30)] == 0).count();
        let (glass, wall_row) = (gone(GLASS), (0..64).filter(|&x| s.cells[at(x, 50, 30)] == 0).count());
        // Along the pane's row the hole is 2.75 radii each way; in the plaster above it, about one radius, and none 18 cells up.
        assert!(glass >= 30 && glass <= 34, "{glass} glass cells gone");
        assert_eq!(wall_row, 0, "the wall 18 cells above the blast stands");
        let wall_near = (0..64).filter(|&x| before[at(x, 36, 31)] != 0 && s.cells[at(x, 36, 31)] == 0).count();
        assert!(wall_near >= 6 && wall_near <= 16, "{wall_near} wall cells gone 4 cells above");
        // The same blast again leaves the same cells.
        let once = s.cells.clone();
        s.cells = before.clone();
        s.blast([32, 32, 30], 6, 9);
        assert!(s.cells == once);
    }

    #[test]
    fn the_city_has_all_sorts_of_block() {
        let mut seen = [0; 5];
        for bz in -20..20 {
            for bx in -20..20 {
                seen[block(bx, bz) as usize] += 1;
            }
        }
        assert!(seen.iter().all(|&n| n > 10), "{seen:?}");
    }
}
