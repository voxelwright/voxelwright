//! A made-up city by the sea, as rules: any sector of it, at any coarseness, comes out of this
//! file the same on every machine, so nothing of it is stored until somebody changes it.
//! Hills from smooth noise, a grid of streets over them, rows of houses 7.6 m wide stepping
//! with the slope, blocks of towers where the town is busiest, parks, trees and lamps.
//! Synthetic: no real place's data is in here. All lengths are in the finest cells (10 cm).

use crate::hash::{hash, noise, unit};
use crate::kinds::*;
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

/// How high the ground is at a column: its top cell.
pub fn ground(x: i32, z: i32) -> i32 {
    (noise(x, z, 9000, 11) * 1200.0 + noise(x, z, 2600, 12) * 300.0 + noise(x, z, 700, 13) * 50.0 - 560.0).floor() as i32
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Block {
    Shore,
    Park,
    Homes,
    Towers,
    /// A works yard: a few things that each stand, and so come down, in their own way.
    Yard,
}

/// The yard everyone starts beside: the block across the street from where the page begins. The rule below puts a
/// yard there by itself; naming it keeps it there, for the board's shots and the tests stand in it.
pub const YARD: (i32, i32) = (0, 5);

pub(crate) fn block(bx: i32, bz: i32) -> Block {
    if ground(bx * BLOCK_X + BLOCK_X / 2, bz * BLOCK_Z + BLOCK_Z / 2) < 15 {
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
    let (wide, deep, storey, storeys) = (120, 100, 34, 3);
    let g = ground(x0 + wide / 2, z0 + deep / 2);
    let (base, top) = (g + 1, g + 1 + storey * storeys);
    let glass = kind(GLASS, OWN);
    for (lo, hi) in [([0, 0], [wide, 1]), ([0, deep - 1], [wide, deep]), ([0, 0], [1, deep]), ([wide - 1, 0], [wide, deep])] {
        s.fill([x0 + lo[0], base, z0 + lo[1]], [x0 + hi[0], top, z0 + hi[1]], glass, Meet::Middle);
    }
    // Its footing goes well into the ground: the yard may slope.
    s.fill([x0, g - 40, z0], [x0 + wide, base, z0 + deep], kind(CONCRETE, grey(4)), Meet::Touch);
    for k in 1..=storeys {
        s.fill([x0, base + storey * k - 2, z0], [x0 + wide, base + storey * k, z0 + deep], kind(CONCRETE, grey(6)), Meet::Touch);
    }
    for cx in [0, 39, 78, wide - 3] {
        for cz in [0, 48, deep - 3] {
            s.fill([x0 + cx, base, z0 + cz], [x0 + cx + 3, top, z0 + cz + 3], kind(STEEL, grey(4)), Meet::Touch);
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

/// What the ground's top cell is at a column, and how many cells stand on it (a pavement is a kerb above the road).
fn surface(x: i32, z: i32, g: i32) -> (Kind, i32) {
    if g < SEA + 6 {
        return (kind(SAND, OWN), 0);
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
    ((lo - DEEP).div_euclid(size), top.div_euclid(size))
}

/// Makes one sector of the city in `s`, at the coarseness `s` was started with.
pub fn make(s: &mut Scratch) {
    let (k, half) = (s.lod, (1 << s.lod) / 2);
    let side = SIDE as i32;
    let (lo, hi) = s.bounds();
    let near = k <= SHAPES_TO;
    // The ground, a column at a time: earth up to its top cell, then what the surface is.
    for cz in 0..side {
        for cx in 0..side {
            let (x, z) = (((s.low[0] + cx) << k) + half, ((s.low[2] + cz) << k) + half);
            let g = ground(x, z);
            let (top, raise) = surface(x, z, g);
            // Under the sea a coarse column's ground stays a cell under the sea's top, however shallow the water: far
            // water stays water.
            let gy = if g < SEA { (g >> k).min((SEA >> k) - 1) } else { g >> k } - s.low[1];
            let (ux, uz) = (cx as usize, cz as usize);
            for y in 0..gy.clamp(0, side) {
                s.cells[at(ux, y as usize, uz)] = EARTH_KIND;
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
        }
        if sort != Block::Shore {
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
