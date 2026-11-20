//! The San Francisco Bay Area at true size, from data (#373). Where the town (city.rs) is rules alone, this is
//! rules over packs: a pack holds what was measured of a square of the real place (the ground, what stands on it
//! and how high, what the ground is, a colour for each top, every building's outline, where trees have their
//! trunks: engine/bay/bake.py makes one), and the rules here say what each cell of it is, at any coarseness, the
//! same on every machine that holds the same packs. Nothing is on until a pack is loaded: then the whole world
//! is the Bay's, and what no pack covers is level water.
//!
//! The frame: a cell is 10 cm; x is east and z is south from 500,000 m east, 4,250,000 m north of UTM zone 10N;
//! y is up from the bay's water. Sources and licences: .agents/skills/bay-sources.

use crate::hash::{hash, hash3};
use crate::heroes;
use crate::kinds::*;
use crate::scratch::{Run, Scratch};
use crate::tree::{Kind, SIDE, at};
use std::cell::{Cell, RefCell};

thread_local! {
    static ON: Cell<bool> = const { Cell::new(false) };
    static PACKS: RefCell<Vec<Pack>> = const { RefCell::new(Vec::new()) };
    static ROOM: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static HEROES: RefCell<Vec<Hero>> = const { RefCell::new(Vec::new()) };
    static LANDMARKS: Cell<bool> = const { Cell::new(true) };
}

/// A landmark (#423, heroes.rs) standing in the world: which rule, where its frame's middle and foot are in cells,
/// which way its `u` runs in the world's x and z, and the square of the world's cells it keeps within. The page says
/// where each stands (#450, `hero`), every core alike, so that no tile is cut again for one.
#[derive(Clone, Copy)]
struct Hero {
    sort: u32,
    at: [i32; 3],
    along: [f32; 2],
    low: [i32; 2],
    high: [i32; 2],
}

/// A landmark stands at (x, z) in cells, its foot at height `foot`, its `u` turned `turn` millionths of a radian from
/// the world's x towards z. 0 where no rule has that sort.
pub fn hero(sort: u32, x: i32, z: i32, foot: i32, turn: i32) -> i32 {
    let Some(r) = heroes::reach(sort) else { return 0 };
    let t = turn as f32 * 1e-6;
    let along = [t.cos(), t.sin()];
    let (mut low, mut high) = ([i32::MAX; 2], [i32::MIN; 2]);
    for (u, w) in [(r[0], r[2]), (r[3], r[2]), (r[0], r[5]), (r[3], r[5])] {
        let corner = [x + ((u * along[0] - w * along[1]) * 10.0) as i32, z + ((u * along[1] + w * along[0]) * 10.0) as i32];
        for a in 0..2 {
            low[a] = low[a].min(corner[a] - 1);
            high[a] = high[a].max(corner[a] + 1);
        }
    }
    HEROES.with_borrow_mut(|h| h.push(Hero { sort, at: [x, foot, z], along, low, high }));
    1
}

/// Whether landmarks are made as the world's cells: off, the place is as the tiles have it (for what they cost).
pub fn landmarks(on: bool) {
    LANDMARKS.set(on);
}

/// Whether the world is the Bay's: a pack has been loaded.
#[inline]
pub fn on() -> bool {
    ON.get()
}

/// No sample: nothing stands here.
const NONE: i16 = i16::MIN;
/// The ground where no pack reaches, and under water: three metres down.
const BED: i32 = -30;
/// How far below the ground a column of sectors is made (as city.rs `DEEP`).
const DEEP: i32 = 192;
/// What the ground is, in a pack's `class` (bake.py): the low three bits, and 8 where leaves stand over it.
const ROAD: u8 = 0;
const PAVEMENT: u8 = 1;
const GRASS_HERE: u8 = 2;
const WATER_HERE: u8 = 5;
const YARD: u8 = 6;
const CANOPY: u8 = 8;
/// In a pack with no outlines (a coarse one, bay/tiles.py): a building stands over this sample.
const BUILT: u8 = 16;
/// Buildings are found by the patch of 12.8 m they reach into, and what stands is summed in patches of 6.4 m.
const PATCH: i32 = 7;
const BLOCK: i32 = 6;
/// How far from its trunk a tree's crown is shaped by it.
const REACH: i32 = 64;
/// How far out of its outline a building may put cells: a bay window, a cornice.
const OUT: i32 = 15;

struct Building {
    first: usize,
    count: usize,
    wall: Kind,
    trim: Kind,
    /// Cells a storey, cells a bay of the front, whether people live in it, and a number of its own.
    storey: i32,
    module: i32,
    home: bool,
    /// Coit Tower (1), Transamerica Pyramid (2), or a tall office lobby/arcade (3).
    special: u32,
    ground_floor: u32,
    seed: u32,
    /// The street's level at its lowest: where its storeys are counted from.
    base: i32,
    low: [i32; 2],
    high: [i32; 2],
}

struct Pack {
    /// The ground: a sample every `gstep` cells, `gw` a side, the first at (`gx0`, `gz0`).
    gstep: i32,
    gw: i32,
    gx0: i32,
    gz0: i32,
    ground: Vec<i16>,
    /// What stands (a roof, a crown), what the ground is and a colour for the top: one every `tstep` cells.
    tstep: i32,
    tw: i32,
    tx0: i32,
    tz0: i32,
    top: Vec<i16>,
    class: Vec<u8>,
    tint: Vec<u8>,
    /// Local asphalt greys for columns whose tint byte belongs to a measured crown.
    under_leaf_road: Vec<u8>,
    /// In a coarse pack: the wall's kind (its material and colour) of what stands over each sample.
    walls: Vec<u16>,
    buildings: Vec<Building>,
    /// Corners: x, z, and what the side from this corner on looks at (1 open air, 2 the street; 4 ends a ring).
    verts: Vec<[i32; 3]>,
    /// Trunks: x, z, the crown's top, how thick.
    trunks: Vec<[i32; 4]>,
    near: Vec<Vec<u32>>,
    stems: Vec<Vec<u32>>,
    fixtures: Vec<[i32; 8]>,
    fixtures_near: Vec<Vec<usize>>,
    pw: i32,
    /// The lowest ground and the highest thing in each patch of 6.4 m.
    lows: Vec<i16>,
    highs: Vec<i16>,
    bw: i32,
}

/// Room for a pack's bytes: write them at the address returned, then `load`.
pub fn room(bytes: usize) -> *mut u8 {
    ROOM.with_borrow_mut(|r| {
        r.clear();
        r.resize(bytes, 0);
        r.as_mut_ptr()
    })
}

/// Takes the pack in the room. Returns how many packs are held, or -1 where the bytes are not a pack (nothing changes).
pub fn load() -> i32 {
    let bytes = ROOM.with_borrow_mut(std::mem::take);
    let Some(pack) = read(&bytes) else { return -1 };
    let held = PACKS.with_borrow_mut(|p| {
        p.push(pack);
        // The finest first: where two packs cover a place, the one that knows it best answers.
        p.sort_by_key(|p| p.gstep);
        p.len() as i32
    });
    ON.set(true);
    held
}

/// Makes the world the Bay's before any pack has come: packs come and go as the eye moves (the page's bay.ts),
/// and where none is held yet there is water.
pub fn begin() {
    ON.set(true);
}

/// Lets go of the pack whose ground starts at (`x0`, `z0`) with a sample every `gstep` cells. Returns how many
/// packs are held after. The world stays the Bay's.
pub fn drop(x0: i32, z0: i32, gstep: i32) -> i32 {
    PACKS.with_borrow_mut(|p| {
        p.retain(|p| (p.gx0, p.gz0, p.gstep) != (x0, z0, gstep));
        p.len() as i32
    })
}

/// The pack that answers for a column made of cells `size` wide: the finest that holds it among those no finer
/// than such cells are worth (a far sector is made from a coarse pack, and so is made the same whichever finer
/// packs happen to be held); where there is none of those, the finest that holds it at all.
fn pick(packs: &[Pack], x: i32, z: i32, size: i32) -> Option<&Pack> {
    let least = least_step(size);
    packs.iter().find(|p| p.gstep >= least && p.holds(x, z)).or_else(|| packs.iter().find(|p| p.holds(x, z)))
}

/// The finest sampling worth holding for cells `size` wide: 1 m to cells of 0.8 m, 2 m to 6.4 m, 16 m past that.
/// The page's bay.ts asks for packs by the same rule.
pub fn least_step(size: i32) -> i32 {
    if size <= 8 { 0 } else if size <= 64 { 20 } else { 160 }
}

/// Lets every pack go: the world is the town's again.
pub fn clear() {
    PACKS.with_borrow_mut(|p| p.clear());
    ON.set(false);
}

fn read(b: &[u8]) -> Option<Pack> {
    let int = |i: usize| b.get(i * 4..i * 4 + 4).map(|w| i32::from_le_bytes([w[0], w[1], w[2], w[3]]));
    let head: Vec<i32> = (0..16).map(int).collect::<Option<_>>()?;
    if head[0] != 0x3159_4142 || head[4] <= 0 || head[5] <= 1 || head[8] < 0 || head[9] < 0 || head[12..15].iter().any(|&n| n < 0) {
        return None;
    }
    let (gw, tw) = (head[5] as usize, if head[8] > 0 { head[9] as usize } else { 0 });
    let (nb, nv, nt) = (head[12] as usize, head[13] as usize, head[14] as usize);
    let mut from: usize = 64;
    let mut take = |n: usize| {
        let part = b.get(from..from.checked_add(n)?)?;
        from += n;
        Some(part)
    };
    let shorts = |p: &[u8]| p.chunks_exact(2).map(|w| i16::from_le_bytes([w[0], w[1]])).collect::<Vec<_>>();
    let ints = |p: &[u8]| p.chunks_exact(4).map(|w| i32::from_le_bytes([w[0], w[1], w[2], w[3]])).collect::<Vec<_>>();
    let ground = shorts(take(gw.checked_mul(gw)?.checked_mul(2)?)?);
    let top = shorts(take(tw * tw * 2)?);
    let class = take(tw * tw)?.to_vec();
    let tint = take(tw * tw)?.to_vec();
    let walls = if head[15] & 1 == 1 { take(tw * tw * 2)?.chunks_exact(2).map(|w| u16::from_le_bytes([w[0], w[1]])).collect() } else { Vec::new() };
    let rows = ints(take(nb.checked_mul(24)?)?);
    let mut verts: Vec<[i32; 3]> = ints(take(nv.checked_mul(12)?)?).chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect();
    let trunks: Vec<[i32; 4]> = ints(take(nt.checked_mul(16)?)?).chunks_exact(4).map(|v| [v[0], v[1], v[2], v[3]]).collect();
    let mut fixtures = Vec::new();
    if b.get(from..).is_some_and(|tail| tail.starts_with(b"SFST")) {
        let extra = b.get(from..)?;
        if extra.get(..4)? != b"SFST" { return None; }
        let n = u32::from_le_bytes(extra.get(4..8)?.try_into().ok()?) as usize;
        let end = 8usize.checked_add(n.checked_mul(32)?)?;
        from = from.checked_add(end)?;
        for chunk in extra.get(8..end)?.chunks_exact(32) {
            let r: [i32; 8] = ints(chunk).try_into().ok()?;
            if !(1..=100).contains(&r[6]) || !(1..=65535).contains(&r[7])
                || r[..6].iter().any(|v| v.unsigned_abs() > 10_000_000) { return None; }
            fixtures.push(r);
        }
    }
    let mut paint = std::collections::BTreeMap::new();
    if from < b.len() {
        let mut tail = b.get(from..)?;
        if head[4] != 10 || tail.get(..4)? != b"SFPT" { return None; }
        let n = u32::from_le_bytes(tail.get(4..8)?.try_into().ok()?) as usize;
        if n > nv { return None; }
        tail = tail.get(8..)?;
        for _ in 0..n {
            let edge = u32::from_le_bytes(tail.get(..4)?.try_into().ok()?);
            // Bytes 4..8 are the wall's lowest cell: one colour for a building needs no place on its wall.
            let width = u16::from_le_bytes(tail.get(8..10)?.try_into().ok()?) as usize;
            let height = u16::from_le_bytes(tail.get(10..12)?.try_into().ok()?) as usize;
            if edge as usize >= nv || width == 0 || height == 0 { return None; }
            let end = 12 + width.checked_mul(height)?;
            if paint.insert(edge, tail.get(12..end)?).is_some() { return None; }
            tail = tail.get(end..)?;
        }
        if !tail.is_empty() { return None; }
    }
    let mut buildings = Vec::with_capacity(nb);
    for r in rows.chunks_exact(6) {
        let (first, count) = (r[0] as usize, r[1] as usize);
        let own = verts.get_mut(first..first.checked_add(count)?)?;
        if own.is_empty() {
            return None;
        }
        join_cornices(own);
        let style = r[4] as u32;
        buildings.push(Building {
            first,
            count,
            wall: match painted_colour((first..first + count).filter_map(|e| paint.get(&(e as u32)).copied())) {
                Some(tint) => kind(material(r[2] as Kind), tint),
                None => r[2] as Kind,
            },
            trim: r[3] as Kind,
            storey: (style & 255).max(20) as i32 * if style >> 19 & 1 == 1 { 3 } else { 1 },
            module: (style >> 8 & 255).max(16) as i32,
            home: style >> 16 & 1 == 1,
            special: style >> 17 & 3,
            ground_floor: style >> 20 & 7,
            seed: style >> 24,
            base: r[5],
            low: [own.iter().map(|v| v[0]).min()?, own.iter().map(|v| v[1]).min()?],
            high: [own.iter().map(|v| v[0]).max()?, own.iter().map(|v| v[1]).max()?],
        });
    }
    let under_leaf_road = road_greys(&class, &tint, tw);
    let mut p = Pack { gstep: head[4], gw: head[5], gx0: head[6], gz0: head[7], ground, tstep: head[8], tw: tw as i32, tx0: head[10], tz0: head[11], top, class, tint, under_leaf_road, walls, buildings, verts, trunks, near: Vec::new(), stems: Vec::new(), fixtures, fixtures_near: Vec::new(), pw: 0, lows: Vec::new(), highs: Vec::new(), bw: 0 };
    // Which buildings and trunks reach into each patch.
    let wide = (p.gw - 1) * p.gstep;
    p.pw = (wide >> PATCH) + 1;
    p.near = vec![Vec::new(); (p.pw * p.pw) as usize];
    p.stems = vec![Vec::new(); (p.pw * p.pw) as usize];
    let patch = |v: i32, o: i32, pw: i32| ((v - o) >> PATCH).clamp(0, pw - 1);
    for (i, b) in p.buildings.iter().enumerate() {
        for pz in patch(b.low[1] - OUT, p.gz0, p.pw)..=patch(b.high[1] + OUT, p.gz0, p.pw) {
            for px in patch(b.low[0] - OUT, p.gx0, p.pw)..=patch(b.high[0] + OUT, p.gx0, p.pw) {
                p.near[(pz * p.pw + px) as usize].push(i as u32);
            }
        }
    }
    for (i, t) in p.trunks.iter().enumerate() {
        for pz in patch(t[1] - REACH, p.gz0, p.pw)..=patch(t[1] + REACH, p.gz0, p.pw) {
            for px in patch(t[0] - REACH, p.gx0, p.pw)..=patch(t[0] + REACH, p.gx0, p.pw) {
                p.stems[(pz * p.pw + px) as usize].push(i as u32);
            }
        }
    }
    // The lowest ground and the highest thing in each patch of 6.4 m, for knowing which sectors are worth making.
    p.bw = (wide >> BLOCK) + 1;
    p.lows = vec![i16::MAX; (p.bw * p.bw) as usize];
    p.highs = vec![i16::MIN; (p.bw * p.bw) as usize];
    for j in 0..p.gw {
        for i in 0..p.gw {
            let g = p.ground[(j * p.gw + i) as usize];
            // A sample on a patch's edge is the next patch's too.
            for (bi, bj) in [(i * p.gstep >> BLOCK, j * p.gstep >> BLOCK), ((i * p.gstep - 1).max(0) >> BLOCK, (j * p.gstep - 1).max(0) >> BLOCK)] {
                let k = (bj.min(p.bw - 1) * p.bw + bi.min(p.bw - 1)) as usize;
                p.lows[k] = p.lows[k].min(g);
                p.highs[k] = p.highs[k].max(g);
            }
        }
    }
    for j in 0..p.tw {
        for i in 0..p.tw {
            let t = p.top[(j * p.tw + i) as usize];
            if t != NONE {
                let k = (((p.tz0 - p.gz0 + j * p.tstep) >> BLOCK).clamp(0, p.bw - 1) * p.bw + ((p.tx0 - p.gx0 + i * p.tstep) >> BLOCK).clamp(0, p.bw - 1)) as usize;
                p.highs[k] = p.highs[k].max(t);
            }
        }
    }
    if !p.fixtures.is_empty() {
        p.fixtures_near = vec![Vec::new(); (p.pw * p.pw) as usize];
        for (i, r) in p.fixtures.iter().enumerate() {
            let pad = (r[6] + 9) / 10 + 2;
            let lo = [r[0].min(r[3])-pad, r[2].min(r[5])-pad];
            let hi = [r[0].max(r[3])+pad, r[2].max(r[5])+pad];
            for z in patch(lo[1], p.gz0, p.pw)..=patch(hi[1], p.gz0, p.pw) {
                for x in patch(lo[0], p.gx0, p.pw)..=patch(hi[0], p.gx0, p.pw) {
                    p.fixtures_near[(z*p.pw+x) as usize].push(i);
                }
            }
            let clamp = |v:i32, origin:i32| ((v-origin)>>BLOCK).clamp(0,p.bw-1);
            for z in clamp(lo[1],p.gz0)..=clamp(hi[1],p.gz0) {
                for x in clamp(lo[0],p.gx0)..=clamp(hi[0],p.gx0) {
                    let k=(z*p.bw+x) as usize;
                    p.highs[k]=p.highs[k].max((r[1].max(r[4])+pad).clamp(-32767,32767) as i16);
                }
            }
        }
    }
    Some(p)
}

/// What a building's photographs (bay/facade_paint.py: a colour every 30 cm of a wall it was seen on) say its walls
/// are: the colour most of their light cells agree on. Drawn cell by cell they were a mosaic (#450), each cell keeping
/// whatever stood before the wall that day (leaves, shade, a sign, a passer-by) and the dark of windows the rules did
/// not draw. Dark cells (windows, shade) are not counted; where under three in ten of the rest agree, or there are
/// too few to say, the photographs say nothing and the building keeps the colour its bake gave it. Nor do they where
/// they agree on white: most painted walls are white by that count, cream and ochre fronts among them, a wall
/// blown out by the sun as often as a white one (North Beach), and the bake's colour (appearance.py) stands.
fn painted_colour<'a>(walls: impl Iterator<Item = &'a [u8]>) -> Option<u8> {
    // Greys from the ninth down, and each hue's deep, dark and dusty dark tones (kinds.rs `colour`).
    let dark = |v: u8| if v < 16 { v >= 9 } else { matches!((v - 16) % 10, 5 | 6 | 9) };
    let mut count = [0u32; 256];
    for cells in walls {
        for &c in cells.iter().filter(|&&c| c != 0 && !dark(c)) {
            count[c as usize] += 1;
        }
    }
    let total: u32 = count.iter().sum();
    let (best, &n) = count.iter().enumerate().max_by_key(|&(i, &n)| (n, std::cmp::Reverse(i)))?;
    (total >= 24 && n * 10 >= total * 3 && best > 2).then_some(best as u8)
}

/// A street front surveyed as a chain of bays is many short edges, and the bake (street_detail.py `facades`) gives
/// its details only to edges of 0.7 m or more. The cornice stood on the long edges and not on the short ones between
/// them: blocks with gaps, battlements along every bayed roofline (#450). An edge under 0.7 m whose nearest long
/// edges on either side both face the street with a cornice is part of that front: it takes their facing, their
/// cornice and, where both were surveyed, the mean of their eaves.
fn join_cornices(ring_verts: &mut [[i32; 3]]) {
    const SHORT: f32 = 7.0;
    const CORNICE: i32 = 2 << 24;
    const EAVE: i32 = 0xff_ff00;
    let mut start = 0;
    while start < ring_verts.len() {
        let end = (start..ring_verts.len()).find(|&i| ring_verts[i][2] & 4 != 0).unwrap_or(ring_verts.len() - 1) + 1;
        let ring = &mut ring_verts[start..end];
        let n = ring.len();
        let long: Vec<bool> = (0..n).map(|i| {
            let (a, c) = (ring[i], ring[(i + 1) % n]);
            (((c[0] - a[0]) as f32).powi(2) + ((c[1] - a[1]) as f32).powi(2)).sqrt() >= SHORT
        }).collect();
        if long.iter().any(|&l| l) {
            let looks: Vec<i32> = ring.iter().map(|v| v[2]).collect();
            let corniced = |i: usize| long[i] && looks[i] & 3 == 3 && looks[i] & CORNICE != 0;
            for i in (0..n).filter(|&i| !long[i]) {
                let before = (1..n).map(|k| (i + n - k) % n).find(|&k| long[k]).unwrap();
                let after = (1..n).map(|k| (i + k) % n).find(|&k| long[k]).unwrap();
                if !(corniced(before) && corniced(after)) {
                    continue;
                }
                let mut v = looks[i] | 3 | CORNICE;
                if v & 128 == 0 && looks[before] & looks[after] & 128 != 0 {
                    let eave = |l: i32| (l >> 8) as i16 as i32;
                    v = (v & !EAVE) | 128 | ((eave(looks[before]) + eave(looks[after])) / 2 & 0xffff) << 8;
                }
                ring[i][2] = v;
            }
        }
        start = end;
    }
}

impl Pack {
    /// Whether the pack knows a column: its samples reach round it.
    fn holds(&self, x: i32, z: i32) -> bool {
        let wide = (self.gw - 1) * self.gstep;
        x >= self.gx0 && z >= self.gz0 && x < self.gx0 + wide && z < self.gz0 + wide
    }

    /// The ground's top cell at a column: between the four samples round it.
    fn ground(&self, x: i32, z: i32) -> i32 {
        (self.ground_height(x, z) + 0.5).floor() as i32
    }

    fn ground_height(&self, x: i32, z: i32) -> f32 {
        let (fx, fz) = ((x - self.gx0) as f32 / self.gstep as f32, (z - self.gz0) as f32 / self.gstep as f32);
        let (i, j) = ((fx as i32).clamp(0, self.gw - 2), (fz as i32).clamp(0, self.gw - 2));
        let (u, v) = ((fx - i as f32).clamp(0.0, 1.0), (fz - j as f32).clamp(0.0, 1.0));
        let s = |i: i32, j: i32| self.ground[(j * self.gw + i) as usize] as f32;
        let (a, b, c, d) = (s(i, j), s(i + 1, j), s(i, j + 1), s(i + 1, j + 1));
        // Water is level: beside the shore the bed does not climb the bank a sample early.
        if a.min(b).min(c).min(d) <= BED as f32 {
            return s(i + (u > 0.5) as i32, j + (v > 0.5) as i32);
        }
        a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v
    }

    /// The sample of what stands that a column is in.
    fn cell(&self, x: i32, z: i32) -> Option<usize> {
        if self.tstep == 0 {
            return None;
        }
        let (i, j) = ((x - self.tx0).div_euclid(self.tstep), (z - self.tz0).div_euclid(self.tstep));
        (i >= 0 && j >= 0 && i < self.tw && j < self.tw).then(|| (j * self.tw + i) as usize)
    }

    /// How high what stands at a column is. Between samples that are of one surface (within a metre of each other)
    /// it slopes, so a pitched roof is a slope and not steps half a metre wide; across an edge it is the nearest.
    fn top(&self, x: i32, z: i32) -> Option<i32> {
        let here = self.cell(x, z)?;
        let half = self.tstep as f32 / 2.0;
        let (fx, fz) = (((x - self.tx0) as f32 + 0.5 - half) / self.tstep as f32, ((z - self.tz0) as f32 + 0.5 - half) / self.tstep as f32);
        let (i, j) = (fx.floor() as i32, fz.floor() as i32);
        if i >= 0 && j >= 0 && i < self.tw - 1 && j < self.tw - 1 {
            let s = |i: i32, j: i32| self.top[(j * self.tw + i) as usize];
            let four = [s(i, j), s(i + 1, j), s(i, j + 1), s(i + 1, j + 1)];
            let (lo, hi) = (*four.iter().min().unwrap(), *four.iter().max().unwrap());
            if lo != NONE && hi - lo <= 10 {
                let (u, v) = (fx - i as f32, fz - j as f32);
                let f = four.map(|v| v as f32);
                return Some((f[0] + (f[1] - f[0]) * u + (f[2] + (f[3] - f[2]) * u - (f[0] + (f[1] - f[0]) * u)) * v + 0.5).floor() as i32);
            }
        }
        (self.top[here] != NONE).then(|| self.top[here] as i32)
    }

    /// What the ground is at a column, and the colour of its top. Road against pavement is settled between samples,
    /// so a kerb runs straight and not in steps of half a metre.
    fn surface(&self, x: i32, z: i32) -> (u8, u8) {
        let Some(here) = self.cell(x, z) else { return (GRASS_HERE, 0) };
        let (c, tint) = (self.class[here], self.tint[here]);
        let sort = c & 7;
        if sort != ROAD && sort != PAVEMENT {
            return (c, tint);
        }
        let half = self.tstep as f32 / 2.0;
        let (fx, fz) = (((x - self.tx0) as f32 + 0.5 - half) / self.tstep as f32, ((z - self.tz0) as f32 + 0.5 - half) / self.tstep as f32);
        let (i, j) = ((fx.floor() as i32).clamp(0, self.tw - 2), (fz.floor() as i32).clamp(0, self.tw - 2));
        let (u, v) = ((fx - i as f32).clamp(0.0, 1.0), (fz - j as f32).clamp(0.0, 1.0));
        let s = |i: i32, j: i32| (self.class[(j * self.tw + i) as usize] & 7 == ROAD) as i32 as f32;
        let road = s(i, j) + (s(i + 1, j) - s(i, j)) * u + (s(i, j + 1) + (s(i + 1, j + 1) - s(i, j + 1)) * u - (s(i, j) + (s(i + 1, j) - s(i, j)) * u)) * v;
        let surface = if road > 0.5 { ROAD } else { PAVEMENT };
        let flags = if surface == sort { c & !7 } else { c & !135 };
        (flags | surface, tint)
    }

    /// The building a column is in, or the nearest one it is just outside of, with where on its outline.
    fn building(&self, x: i32, z: i32) -> Option<(&Building, Probe)> {
        let patch = (((z - self.gz0) >> PATCH).clamp(0, self.pw - 1) * self.pw + ((x - self.gx0) >> PATCH).clamp(0, self.pw - 1)) as usize;
        let mut best: Option<(&Building, Probe)> = None;
        for &i in &self.near[patch] {
            let b = &self.buildings[i as usize];
            if x < b.low[0] - OUT || z < b.low[1] - OUT || x > b.high[0] + OUT || z > b.high[1] + OUT {
                continue;
            }
            let p = self.probe(b, x, z);
            if p.inside {
                return Some((b, p));
            }
            if p.far < (if p.looks >> 24 != 0 { OUT } else { 8 }) as f32 && best.as_ref().is_none_or(|(_, q)| p.far < q.far) {
                best = Some((b, p));
            }
        }
        best
    }

    /// Where a column is against a building's outline: in it or not (a ring inside a ring is a yard), how far from
    /// its nearest side, how far along that side, how long the side is, what it looks at, and the nearest point of it.
    fn probe(&self, b: &Building, x: i32, z: i32) -> Probe {
        let (px, pz) = (x as f32 + 0.5, z as f32 + 0.5);
        let own = &self.verts[b.first..b.first + b.count];
        let mut p = Probe { inside: false, far: f32::MAX, along: 0.0, round: 0.0, long: 0.0, looks: 0, side: 0, on: [0.0; 2] };
        let (mut start, mut run) = (0, 0.0f32);
        for i in 0..own.len() {
            let a = own[i];
            let last = a[2] & 4 != 0 || i == own.len() - 1;
            let c = if last { own[start] } else { own[i + 1] };
            let before = run;
            let (ax, az, cx, cz) = (a[0] as f32, a[1] as f32, c[0] as f32, c[1] as f32);
            if (az > pz) != (cz > pz) && px < ax + (pz - az) / (cz - az) * (cx - ax) {
                p.inside = !p.inside;
            }
            let (dx, dz) = (cx - ax, cz - az);
            let long = (dx * dx + dz * dz).sqrt();
            run = if last { 0.0 } else { run + long };
            if last {
                start = i + 1;
            }
            if long < 0.5 {
                continue;
            }
            let t = (((px - ax) * dx + (pz - az) * dz) / (long * long)).clamp(0.0, 1.0);
            let (qx, qz) = (ax + dx * t, az + dz * t);
            let far = ((px - qx) * (px - qx) + (pz - qz) * (pz - qz)).sqrt();
            if far < p.far {
                p = Probe { inside: p.inside, far, along: t * long, round: before + t * long, long, looks: a[2], side: (b.first + i) as u32, on: [qx, qz] };
            }
        }
        p
    }

    /// Vertical intervals cut by visible street furniture in one column. Sample
    /// a narrow wire across the cell width so a diagonal remains connected.
    fn fixture_spans(&self, x: i32, z: i32, size: i32) -> Vec<FixtureSpan> {
        let mut spans = Vec::new();
        if size > 4 || self.fixtures_near.is_empty() { return spans; }
        let px = ((x-self.gx0)>>PATCH).clamp(0,self.pw-1);
        let pz = ((z-self.gz0)>>PATCH).clamp(0,self.pw-1);
        for &i in &self.fixtures_near[(pz*self.pw+px) as usize] {
            let r = self.fixtures[i];
            let (dx,dz) = ((r[3]-r[0]) as f32,(r[5]-r[2]) as f32);
            let middle = if size == 1 { 0.5 } else { 0.0 };
            let (ux,uz) = ((x-r[0]) as f32 + middle,(z-r[2]) as f32 + middle);
            let length = dx*dx+dz*dz;
            let t = if length > 0.0 { ((ux*dx+uz*dz)/length).clamp(0.0,1.0) } else { 0.0 };
            let cable = r[6] <= 3;
            if cable && size > 2 { continue; }
            // A cell is in a rod when its middle is within the rod's radius, and never less than the 0.71 of a cell
            // that keeps a thin one whole at any slant. Added to the radius, it made a stop sign's plate a red box
            // 1 m across and 24 cm deep and every lamp's mast 38 cm thick (#450).
            let rad = if cable { r[6] as f32/10.0 + if size == 2 { 0.3 } else { size as f32*0.71 } } else { (r[6] as f32/10.0).max(size as f32*0.71) };
            let far = (ux-dx*t).powi(2)+(uz-dz*t).powi(2);
            if far > rad*rad { continue; }
            let height = |v:f32| r[1] as f32 + v*(r[4]-r[1]) as f32;
            let reach = if length>0.0 { ((rad*rad-far)/length).sqrt() } else { 1.0 };
            let a = height((t-reach).max(0.0));
            let b = height((t+reach).min(1.0));
            spans.push(FixtureSpan { low: (a.min(b)-rad).floor() as i32, high: (a.max(b)+rad).floor() as i32, rod: r });
        }
        spans
    }

    /// How high a front's wall stands near where a column meets it (`on`, with `inward` a unit step into the
    /// building), where no eave was surveyed: the middle of five readings of the roof 0.4 m in from the outline,
    /// 0.6 m apart along it. Read once a column, a corniced front's cornice stood in teeth along the lidar's
    /// returns, battlements down every street of the Outer Sunset (#450).
    fn eave_near(&self, on: [f32; 2], inward: [f32; 2]) -> Option<i32> {
        let mut seen: Vec<i32> = [-12.0f32, -6.0, 0.0, 6.0, 12.0].iter().filter_map(|&k| {
            self.top((on[0] + inward[0] * 4.0 - inward[1] * k) as i32, (on[1] + inward[1] * 4.0 + inward[0] * k) as i32)
        }).collect();
        if seen.len() < 3 {
            return None;
        }
        seen.sort_unstable();
        Some(seen[seen.len() / 2])
    }

    /// The trunk nearest a column, if one stands within reach: how far off it is, and the trunk.
    fn trunk(&self, x: i32, z: i32) -> Option<(f32, [i32; 4])> {
        let patch = (((z - self.gz0) >> PATCH).clamp(0, self.pw - 1) * self.pw + ((x - self.gx0) >> PATCH).clamp(0, self.pw - 1)) as usize;
        let far = |t: &[i32; 4]| (x - t[0]) * (x - t[0]) + (z - t[1]) * (z - t[1]);
        self.stems[patch].iter().map(|&i| self.trunks[i as usize]).min_by_key(far).filter(|t| far(t) <= REACH * REACH).map(|t| ((far(&t) as f32).sqrt(), t))
    }
}

struct Probe {
    inside: bool,
    far: f32,
    along: f32,
    /// How far round its ring from the ring's first corner.
    round: f32,
    long: f32,
    looks: i32,
    side: u32,
    on: [f32; 2],
}

/// What a front is at one place on it: how its storeys, windows and doors go. `up` is cells above the building's
/// base, `top` where its wall ends, `deep` how many cells in from the outline, `size` the cell's size.
fn front(b: &Building, p: &Probe, up: i32, top: i32, over_ground: i32, deep: f32, size: i32) -> Kind {
    let glass = kind(GLASS, OWN);
    let dark = kind(PLASTER, grey(13));
    let (storey, module) = (b.storey, b.module as f32);
    if b.special == 1 {
        // The tower: flutes up its shaft, and under its top an arcade of open arches with the dark behind.
        let round = p.round as i32;
        return if up > top - 62 && up < top - 24 && round % 21 < 11 && (up < top - 30 || (round % 21 - 5).abs() < top - 24 - up) {
            if deep < 3.0 * size as f32 { 0 } else { kind(PLASTER, grey(13)) }
        } else if size == 1 && deep < 1.0 && up < top - 70 && up > 60 && round % 9 < 2 {
            0
        } else {
            b.wall
        };
    }
    let detail = p.looks >> 24;
    // Place the entry beside the garage, with both meeting the local street grade.
    if detail != 0 && over_ground < 30 {
        let entry = (p.long * 0.22).clamp(7.0, 18.0);
        if detail & 8 != 0 && (p.along - entry).abs() <= 5.0 && (4..=26).contains(&over_ground) {
            return if over_ground > 21 { glass } else { kind(WOOD, grey(9)) };
        }
        if detail & 4 != 0 && (p.along - p.long * 0.66).abs() < (p.long * 0.23).min(19.0) && over_ground < 23 {
            return if over_ground % 5 == 0 { b.trim } else { kind(WOOD, grey(5)) };
        }
    }
    // The cornice: the wall's last cells are trim.
    if up >= top - 3 && size <= 2 {
        return b.trim;
    }
    // A side that looks on nothing (a neighbour's wall, a light well) or is too short for a window is plain.
    if p.looks & 1 == 0 || (p.long < module && p.looks & 2 == 0) {
        return b.wall;
    }
    let (floor, fy) = (up.div_euclid(storey), up.rem_euclid(storey));
    let count = (p.long / module).floor().max(1.0);
    // A surveyed bay or curved street wall can comprise many edges shorter
    // than a window module. Continue its spacing around the ring.
    let within = if p.long < module { p.round.rem_euclid(module) } else { p.along - (p.long - count * module) / 2.0 };
    if within < 0.0 || within >= count * module {
        return b.wall;
    }
    let (bay, mu) = ((within / module) as i32, within % module - module / 2.0);
    let chance = hash(bay, p.side as i32, b.seed);
    // What the opening is: its half width, its foot and its head, and whether it is a door.
    let (half, foot, head, door) = if floor == 0 && p.looks & 2 != 0 && over_ground < storey && storey <= 60 {
        if b.ground_floor == 2 || b.ground_floor == 3 {
            (module / 2.0 - 2.0, 0, if b.ground_floor == 3 { storey - 3 } else { 24 }, 2)
        } else if b.ground_floor == 4 {
            (module / 2.0 - 4.0, 0, storey - 4, 3)
        } else if b.ground_floor == 5 {
            (module / 2.0 - 2.0, 0, storey - 3, 4)
        } else if b.ground_floor == 1 || !b.home {
            (module / 2.0 - 3.0, 5, storey - 7, 0) // a shop's window
        } else if chance % 3 == 0 {
            (module / 2.0 - 4.0, 0, 23, 2) // a garage
        } else if chance % 3 == 1 {
            (5.0, 0, 22, 1) // the way in
        } else {
            (6.0, 10, storey - 6, 0)
        }
    } else if b.home {
        // A home's front is mostly glass: its window spans the bay but for a pier of 0.6 m, in sashes (#450).
        ((module / 2.0 - 3.0).max(6.0), 8, storey - 5, 0)
    } else if storey > 60 {
        (4.5, 14, storey - 12, 0) // a church's windows: tall and narrow
    } else {
        ((module / 2.0 - 5.0).min(8.0), 8, storey - 6, 0)
    };
    // A belt at each floor and a sill under each window, where cells are fine enough to show them.
    if size == 1 && deep < 1.0 {
        if fy == 0 && floor > 0 && !b.home {
            return b.trim;
        }
        if door == 0 && fy == foot - 1 && mu.abs() < half + 1.0 {
            return b.trim;
        }
    }
    if mu.abs() >= half || fy < foot || fy >= head || up + (head - fy) > top - 4 || over_ground + (fy - foot) < 3 && door == 0 {
        return b.wall;
    }
    match door {
        4 => if deep < 2.0 * size as f32 { 0 } else { dark },
        3 => if deep < 1.0 { 0 } else { glass },
        2 => if deep < 1.0 && size == 1 { 0 } else { kind(WOOD, grey(4 + (chance >> 4) as u8 % 6)) },
        1 => if deep < 1.0 && size == 1 { 0 } else if fy >= head - 4 { glass } else { kind(WOOD, colour((chance >> 6) as u8 % 24, 5 + (chance >> 12) as u8 % 2)) },
        // A window sits a cell back in its wall, with the room dark behind it.
        _ if size > 1 => if deep < size as f32 { glass } else { dark },
        _ => if deep < 1.0 { 0 } else if deep < 2.0 {
            // Sashes of about 0.9 m: a narrow window is two, divided in the middle.
            let sashes = (2.0 * half / 9.0).round().max(2.0);
            let across = (mu + half) / (2.0 * half) * sashes;
            let mullion = (across - across.round()).abs() * 2.0 * half / sashes < 0.6 && across.round() > 0.0 && across.round() < sashes;
            if mullion || (fy - foot) == (head - foot) / 2 { b.trim } else { glass }
        } else { dark },
    }
}

/// What a column of the Bay holds, in one pack's knowledge: asked cell by cell with `kind_at`.
struct FixtureSpan {
    low: i32,
    high: i32,
    rod: [i32; 8],
}

impl FixtureSpan {
    // Rasterize a cable at 2.5 cm only inside the candidate 10 cm column.
    // Relative coordinates retain sub-centimetre precision far from the engine origin.
    fn cable_rows(&self, x: i32, z: i32, floor: i32, rows: &mut Vec<Run>) {
        let r = self.rod;
        let dx = (r[3]-r[0]) as f32;
        let dy = (r[4]-r[1]) as f32;
        let dz = (r[5]-r[2]) as f32;
        let length2 = (dx*dx+dy*dy+dz*dz).max(1.0);
        let radius2 = (r[6] as f32 / 10.0).powi(2);
        for y in self.low.max(floor)..=self.high.min(floor+SIDE as i32-1) {
            for sy in 0..4 {
                for sz in 0..4 {
                    let uy = (y-r[1]) as f32 + (sy as f32+0.5)/4.0;
                    let uz = (z-r[2]) as f32 + (sz as f32+0.5)/4.0;
                    let (mut first,mut end) = (4,0);
                    for sx in 0..4 {
                        let ux = (x-r[0]) as f32 + (sx as f32+0.5)/4.0;
                        let t = ((ux*dx+uy*dy+uz*dz)/length2).clamp(0.0,1.0);
                        if (ux-t*dx).powi(2)+(uy-t*dy).powi(2)+(uz-t*dz).powi(2) <= radius2 {
                            first=first.min(sx);
                            end=sx+1;
                        }
                    }
                    if first<end {
                        rows.push(Run { x0:x*4+first, x1:x*4+end, y:y*4+sy, z:z*4+sz, kind:r[7] as Kind });
                    }
                }
            }
        }
    }
}

struct Column<'a> {
    g: i32,
    road_top4: Option<i32>,
    /// The ground's top cell's kind, and how many cells of it stand over the ground (a pavement's kerb).
    ground: Kind,
    kerb: i32,
    what: What<'a>,
    fixtures: Vec<FixtureSpan>,
    /// A landmark this column is in, and where in its frame the column's middle is (u, w, in metres).
    hero: Option<(Hero, f32, f32)>,
}

enum What<'a> {
    Open,
    /// In a building: its roof's cell and colour.
    In(&'a Building, Probe, i32, u8),
    /// Just outside one, where its bays and cornice stand: how high its wall is there.
    By(&'a Building, Probe, i32),
    /// Leaves from here up to there, and a trunk up to so high if one stands in this column.
    Crown { foot: i32, top: i32, trunk: Option<i32>, tint: u8, edge: f32 },
    /// A building seen from far, from a pack with no outlines: its roof's cell and colour, and its wall.
    Mass(i32, u8, Kind),
}

/// The landmark a column is in, where the world's cells are fine enough to show it (heroes.rs `REALM_MOST`).
fn hero_at(x: i32, z: i32, size: i32) -> Option<(Hero, f32, f32)> {
    if size > heroes::REALM_MOST || !LANDMARKS.get() {
        return None;
    }
    HEROES.with_borrow(|all| {
        all.iter().filter(|h| x >= h.low[0] && z >= h.low[1] && x <= h.high[0] && z <= h.high[1]).find_map(|h| {
            // A column of the finest cells is named by its cell; a coarser one by its middle.
            let half = if size == 1 { 0.5 } else { size as f32 * 0.5 };
            let (dx, dz) = ((x - h.at[0]) as f32 + half, (z - h.at[2]) as f32 + half);
            let (u, w) = ((dx * h.along[0] + dz * h.along[1]) * 0.1, (dz * h.along[0] - dx * h.along[1]) * 0.1);
            let r = heroes::reach(h.sort)?;
            (u >= r[0] && u < r[3] && w >= r[2] && w < r[5]).then_some((*h, u, w))
        })
    })
}

fn column<'a>(packs: &'a [Pack], x: i32, z: i32, size: i32) -> Column<'a> {
    let hero = hero_at(x, z, size);
    let Some(p) = pick(packs, x, z, size) else {
        return Column { g: BED, road_top4: None, ground: kind(SAND, OWN), kerb: 0, fixtures: Vec::new(), what: What::Open, hero };
    };
    let ground_height = p.ground_height(x, z);
    let g = (ground_height + 0.5).floor() as i32;
    let (class, tint) = p.surface(x, z);
    let asphalt = if class & 159 == 128 && (1..=15).contains(&tint) {
        Some(tint)
    } else if class & 31 == CANOPY && measured_foliage(tint) && !p.under_leaf_road.is_empty() {
        p.cell(x,z).map(|i| {
            let w = p.tw as usize;
            p.under_leaf_road[(i / w / 16) * w.div_ceil(16) + (i % w) / 16]
        })
    } else { None };
    let road_top4 = (size == 1 && asphalt.is_some()).then(|| ((ground_height+1.0)*4.0).round() as i32);
    let (ground, kerb) = match class & 7 {
        ROAD if class & 64 != 0 => (kind(STEEL, grey(8)), 0),
        ROAD if class & 32 != 0 => (kind(CONCRETE, grey(1)), 0),
        ROAD => (kind(ASPHALT, asphalt.unwrap_or(OWN)), 0),
        PAVEMENT => (kind(CONCRETE, OWN), if class & 32 != 0 { 0 } else if class & 128 != 0 { 2 } else { 1 }),
        GRASS_HERE => (kind(GRASS, OWN), 0),
        // Water above the sea's level (a river, a lake): the engine's water is the sea's alone, so it is dark glass.
        WATER_HERE if g > 4 => (kind(GLASS, colour(14, 5)), 0),
        WATER_HERE => (kind(SAND, OWN), 0),
        YARD => (kind(CONCRETE, tint), 0),
        _ => (kind(EARTH, OWN), 0),
    };
    let what = match p.building(x, z) {
        Some((b, probe)) if probe.inside => {
            let raster = p.top(x, z).unwrap_or(b.base + 2 * b.storey);
            // Glass and the vertical wall can be the highest lidar return at its edge.
            // Give a surveyed plane one eave; blend into the roof over the next metre.
            let roof = if probe.looks & 128 != 0 && probe.far < 15.0 {
                let eave = (probe.looks >> 8) as i16 as i32;
                let blend = ((probe.far - 5.0) / 10.0).clamp(0.0, 1.0);
                let blended = (eave as f32 + (raster - eave) as f32 * blend).round() as i32;
                // Behind a cornice (kind_at `By`, to three cells over the eave) the roof's railings and the lidar's
                // mixed returns stood up in teeth over it (#450): within 1.5 m of the front it is the wall's top.
                if probe.looks >> 24 & 2 != 0 { blended.min(eave + 3) } else { blended }
            } else if probe.looks >> 24 & 2 != 0 && probe.far < 15.0 {
                let (far, cx, cz) = (probe.far.max(0.01), x as f32 + 0.5, z as f32 + 0.5);
                match p.eave_near(probe.on, [(cx - probe.on[0]) / far, (cz - probe.on[1]) / far]) {
                    Some(eave) => raster.min(eave + 3),
                    None => raster,
                }
            } else { raster }.max(g + 22);
            What::In(b, probe, roof, tint)
        }
        Some((b, probe)) if size <= 2 && probe.looks & 2 != 0 => {
            // The wall's height where this column is nearest it: a little way in from the outline.
            let (dx, dz) = (probe.on[0] - (x as f32 + 0.5), probe.on[1] - (z as f32 + 0.5));
            let far = probe.far.max(0.01);
            let (ix, iz) = ((probe.on[0] + dx / far * 4.0) as i32, (probe.on[1] + dz / far * 4.0) as i32);
            let eave = if probe.looks & 128 != 0 {
                Some((probe.looks >> 8) as i16 as i32)
            } else if probe.looks >> 24 & 2 != 0 {
                p.eave_near(probe.on, [dx / far, dz / far]).or_else(|| p.top(ix, iz))
            } else {
                p.top(ix, iz)
            };
            match eave {
                Some(roof) => What::By(b, probe, roof),
                None => What::Open,
            }
        }
        _ if class & BUILT != 0 => match (p.top(x, z), p.cell(x, z)) {
            (Some(roof), Some(here)) if roof > g => What::Mass(roof, tint, match p.walls.get(here) { Some(&w) if w != 0 => w as Kind, _ => kind(PLASTER, OWN) }),
            _ => What::Open,
        },
        _ if class & CANOPY != 0 => match p.top(x, z) {
            Some(t) if t > g + 4 => {
                let tall = t - g;
                let ragged = (hash(x >> 2, z >> 2, 7) % 7) as i32;
                match p.trunk(x, z) {
                    // A tree: its crown is round underneath, deepest at the trunk and rising to its rim; past the
                    // rim what the lidar saw is a spray of leaves and no more.
                    Some((far, trunk)) if tall >= 28 => {
                        let high = (trunk[2] - g).max(tall);
                        let deep = (high as f32 * 0.55).clamp(16.0, 90.0);
                        let measured = trunk[3] >> 8;
                        let rim = if measured > 0 { measured.min(REACH) as f32 } else { (high as f32 * 0.4).clamp(14.0, REACH as f32) };
                        let middle = g as f32 + high as f32 - deep / 2.0;
                        let under = if far < rim { middle - deep / 2.0 * (1.0 - (far / rim) * (far / rim)).sqrt() } else { (t as f32 - 22.0).max(middle) };
                        let foot = (under as i32 + ragged).max(g + 18).min(t - 3);
                        // The trunk goes a third of the way up into its crown, where its limbs take over. Up to the
                        // crown's top it showed through the crown's openings as a bare rod from above (#450).
                        let crown = ((g as f32 + high as f32 - deep) as i32).max(g + 18);
                        What::Crown { foot, top: t, trunk: (far <= (trunk[3] & 255) as f32 + 0.5).then(|| crown + (t - crown) / 3),
                            tint, edge: (far/rim.max(1.0)).min(1.0) }
                    }
                    // A bush or a hedge is leaves to the ground.
                    _ => What::Crown { foot: if tall < 28 { g + 1 } else { t - (tall / 2).clamp(10, 40) + ragged },
                        top: t, trunk: None, tint, edge: 0.6 },
                }
            }
            _ => What::Open,
        },
        _ => What::Open,
    };
    Column { g, road_top4, ground, kerb, fixtures: p.fixture_spans(x,z,size), what, hero }
}

fn measured_foliage(tint: u8) -> bool {
    tint >= 16 && (3..=10).contains(&((tint-16)/10)) && matches!((tint-16)%10, 2 | 5 | 6 | 8 | 9)
}

/// A crown and the asphalt underneath share one column. Carry nearby open-road
/// reflectance under the leaves once at load time. An old pack has no survey greys.
fn road_greys(class: &[u8], tint: &[u8], width: usize) -> Vec<u8> {
    let n = width.div_ceil(16);
    let mut bins = vec![(0u32, 0u32); n*n];
    let (mut sum, mut count) = (0u32, 0u32);
    for (i, (&c, &t)) in class.iter().zip(tint).enumerate() {
        if c == 128 && (1..=15).contains(&t) {
            let bin = &mut bins[(i / width / 16) * n + i % width / 16];
            bin.0 += t as u32;
            bin.1 += 1;
            sum += t as u32;
            count += 1;
        }
    }
    if count == 0 { return Vec::new(); }
    let average = |s: u32, k: u32| ((s+k/2)/k) as u8;
    let mut greys = Vec::with_capacity(n*n);
    for j in 0..n {
        for i in 0..n {
            let (mut s, mut k) = bins[j*n+i];
            if k == 0 {
                for z in j.saturating_sub(1)..=(j+1).min(n-1) {
                    for x in i.saturating_sub(1)..=(i+1).min(n-1) {
                        let bin = bins[z*n+x];
                        s += bin.0;
                        k += bin.1;
                    }
                }
            }
            greys.push(if k == 0 { average(sum, count) } else { average(s,k) });
        }
    }
    greys
}

/// Open loggias have depth. Keep glass and doors on their inner plane. The
/// Pyramid's perimeter truss sits between its second and fifth floors (USGS).
fn tower_base(b: &Building, p: &Probe, rise: i32, size: i32) -> Option<Kind> {
    if size > 8 || !(2..=3).contains(&b.special) { return None; }
    let pyramid = b.special == 2;
    let (height, recess, spacing) = if pyramid { (163, 42.0, 109.0) } else { (55, 22.0, 56.0) };
    if rise < 0 || rise > height || p.far >= recess + 6.0 || (!pyramid && p.looks & 2 == 0) {
        return None;
    }
    let along = p.round.rem_euclid(spacing);
    let edge = along.min(spacing - along);
    let stone = if pyramid { kind(CONCRETE, grey(2)) } else { b.trim };
    if p.far < 8.0 {
        let diagonal = ((rise - 32) as f32 / 125.0 * spacing * 0.5).clamp(0.0, spacing*0.5);
        if rise > height-5 || (pyramid && ((rise - 36).abs() < 4 || (edge-diagonal).abs() < 4.0))
            || (!pyramid && edge < 2.8) {
            return Some(stone);
        }
    }
    if p.far < recess { return Some(0); }
    let jamb = along.rem_euclid(18.0);
    Some(if jamb < 1.6 || (rise-24).abs() < 2 { kind(STEEL, grey(10)) }
        else { kind(GLASS, colour(13,9)) })
}

/// The kind of the cell whose low corner is at height `y` in a column (cells of `size`: `y` is a multiple of it).
fn kind_at(c: &Column, x: i32, y: i32, z: i32, size: i32) -> Kind {
    // A coarse cell is what its middle is.
    let mid = y + size / 2;
    if mid <= c.g {
        return if mid >= c.g - 3 * size.max(2) { c.ground } else { kind(EARTH, OWN) };
    }
    // A landmark (#423, #450): what its rule says, and where the rule owns its place, its air too.
    if let Some((h, u, w)) = c.hero {
        let up = (y - h.at[1]) as f32 * 0.1 + size as f32 * 0.05;
        let made = heroes::kind_at(h.sort, u, up, w, size as f32 * 0.1);
        if made != 0 {
            return made;
        }
        if heroes::owns(h.sort, u, up, w) && up >= 0.0 {
            return 0;
        }
    }
    for fixture in &c.fixtures {
        if mid >= fixture.low && mid <= fixture.high { return fixture.rod[7] as Kind; }
    }
    match &c.what {
        What::Open => if size == 1 && mid <= c.g + c.kerb { c.ground } else { 0 },
        What::In(b, p, roof, tint) => {
            if mid > *roof {
                0
            } else if mid > *roof - size {
                kind(ROOFING, *tint)
            } else if let Some(form) = tower_base(b, p, mid - c.g, size) {
                form
            } else if p.far < 3.0 * size as f32 && size <= 8 {
                front(b, p, mid - b.base, *roof - b.base, mid - c.g, p.far, size)
            } else {
                b.wall
            }
        }
        What::Mass(roof, tint, wall) => if mid > *roof { 0 } else if mid > *roof - size { kind(ROOFING, *tint) } else { *wall },
        What::By(b, p, roof) => {
            if size == 1 && mid <= c.g + c.kerb {
                return c.ground;
            }
            let (up, top) = (mid - b.base, *roof - b.base);
            let detail = p.looks >> 24;
            let street_y = mid - c.g;
            if detail & 8 != 0 && (p.along - (p.long * 0.22).clamp(7.0, 18.0)).abs() < 7.0 {
                let step = (4 - (p.far / 3.0) as i32).max(0);
                if street_y <= step * 2 { return kind(CONCRETE, grey(4)); }
            }
            if detail & 16 != 0 && p.along > 2.0 && p.along < p.long - 2.0 && p.far < 14.0 {
                let canopy = 32 - (p.far * 0.42) as i32;
                if (canopy-1..=canopy).contains(&street_y) || p.far > 12.0 && (canopy-4..canopy).contains(&street_y) {
                    return kind(PLASTER, if p.along as i32 / 4 % 2 == 0 { grey(2) } else { colour(8, 8) });
                }
            }
            if detail & 32 != 0 && up >= b.storey - 2 && up < top-5 && p.far <= 10.0 {
                let along = p.along-p.long*0.5;
                let fy = (up+2).rem_euclid(b.storey);
                if along.abs() <= 12.0 && (fy < 2 || ((fy == 11 || (along as i32 % 5 == 0 && fy < 11)) && p.far >= 9.0))
                    || (along + 8.0).abs() < 3.0 && p.far >= 7.0 && ((along + 8.0).abs() >= 2.0 || fy % 4 == 0) {
                    return kind(STEEL, grey(13));
                }
            }
            // A cornice is a painted moulding in the trim's colour: concrete's slab joints every 1.6 m cut it into
            // merlons (#450).
            if detail & 2 != 0 && p.far <= 4.0 && up >= top-4 && up <= top+3 { return kind(PLASTER, (b.trim >> 8) as u8); }
            // The cornice stands a cell or two out from the wall's top.
            if p.far < 2.0 && up >= top - 3 && up <= top {
                return b.trim;
            }
            // Bay windows: on a home's street front, over every other bay of it, from the first floor to the cornice.
            if (if detail != 0 { detail & 1 == 0 } else { !b.home }) || p.long < b.module as f32 || up < b.storey || up > top - 4 {
                return 0;
            }
            let module = b.module as f32;
            let count = (p.long / module).floor().max(1.0);
            let within = p.along - (p.long - count * module) / 2.0;
            if within < 0.0 || within >= count * module {
                return 0;
            }
            let (bay, mu) = ((within / module) as i32, within % module - module / 2.0);
            if count > 1.0 && (bay + b.seed as i32) % 2 == 1 || detail == 0 && b.seed % 5 == 0 {
                return 0;
            }
            // Six cells out across the middle, slanting back to the wall at each side.
            let out = 6.0 - (mu.abs() - 5.0).max(0.0);
            if p.far >= out {
                return 0;
            }
            let fy = up.rem_euclid(b.storey);
            if up >= top - 6 {
                b.trim
            } else if p.far >= out - 1.2 && fy >= 9 && fy < b.storey - 6 {
                kind(GLASS, OWN)
            } else {
                b.wall
            }
        }
        What::Crown { foot, top, trunk, tint, edge } => {
            if trunk.is_some_and(|t| mid <= t) {
                kind(WOOD, colour(2, 9))
            } else if size == 1 && mid <= c.g + c.kerb {
                c.ground
            } else if mid < *foot || mid > *top {
                0
            } else if measured_foliage(*tint) {
                // Correlated openings expose the branch structure and the sky.
                // Keep the trunk and the denser centre of the surveyed crown.
                let fringe = *edge > 0.76 || mid < *foot + 7 || mid > *top - 6;
                let cluster = hash3((x+z).div_euclid(9), mid.div_euclid(6), (x-z).div_euclid(9), 43);
                let gap = size <= 8 && cluster % 100 < if fringe { 48 } else { 22 };
                if gap || (size <= 2 && hash3(x >> 1, mid >> 1, z >> 1, 3) % 9 == 0) {
                    0
                } else { kind(LEAVES, *tint) }
            } else if size == 1 && hash3(x >> 1, y >> 1, z >> 1, 3) % 7 == 0 {
                0 // light comes through a crown
            } else {
                kind(LEAVES, if hash3(x >> 2, y >> 2, z >> 2, 5) % 4 == 0 { colour(7, 5) } else { OWN })
            }
        }
    }
}

/// How high the ground is at a column: its top cell.
pub fn ground(x: i32, z: i32) -> i32 {
    PACKS.with_borrow(|packs| packs.iter().find(|p| p.holds(x, z)).map_or(BED, |p| p.ground(x, z)))
}

/// Where someone on foot stands at a column, whether it is paved, and the sort of place (always 0: the town's
/// blocks are not the Bay's). On a roof where a building stands.
pub fn footing(x: i32, z: i32) -> (i32, bool, i32) {
    PACKS.with_borrow(|packs| {
        let c = column(packs, x, z, 1);
        match c.what {
            What::In(b, ref probe, _, _) if tower_base(b, probe, 16, 1) == Some(0) =>
                (c.g + 1, true, 0),
            What::In(_, _, roof, _) => (roof + 1, false, 0),
            _ => (c.g + 1 + c.kerb, material(c.ground) == CONCRETE || material(c.ground) == ASPHALT, 0),
        }
    })
}

/// What the ground's top is made of at a column.
pub fn top(x: i32, z: i32) -> Kind {
    PACKS.with_borrow(|packs| column(packs, x, z, 1).ground)
}

/// Which sectors of a column of sectors are worth making: below the first is all earth, above the last all air.
pub fn span(sx: i32, sz: i32, lod: u32) -> (i32, i32) {
    let size = (SIDE as i32) << lod;
    let (x0, z0, x1, z1) = (sx * size, sz * size, (sx + 1) * size, (sz + 1) * size);
    let (lo, hi) = PACKS.with_borrow(|packs| {
        let (mut lo, mut hi) = (BED, 0);
        for p in packs {
            let wide = (p.gw - 1) * p.gstep;
            if x1 <= p.gx0 || z1 <= p.gz0 || x0 >= p.gx0 + wide || z0 >= p.gz0 + wide {
                continue;
            }
            for bz in ((z0 - p.gz0) >> BLOCK).max(0)..=((z1 - 1 - p.gz0) >> BLOCK).min(p.bw - 1) {
                for bx in ((x0 - p.gx0) >> BLOCK).max(0)..=((x1 - 1 - p.gx0) >> BLOCK).min(p.bw - 1) {
                    let k = (bz * p.bw + bx) as usize;
                    lo = lo.min(p.lows[k] as i32);
                    hi = hi.max(p.highs[k] as i32);
                }
            }
        }
        // A landmark stands higher than what the map has under it: its sectors are worth making too.
        HEROES.with_borrow(|all| {
            for h in all.iter().filter(|h| x1 > h.low[0] && z1 > h.low[1] && x0 <= h.high[0] && z0 <= h.high[1]) {
                if let Some(r) = heroes::reach(h.sort) {
                    lo = lo.min(h.at[1] + (r[1] * 10.0) as i32);
                    hi = hi.max(h.at[1] + (r[4] * 10.0) as i32);
                }
            }
        });
        (lo, hi)
    });
    ((lo - DEEP).div_euclid(size), (hi + 4).div_euclid(size))
}

/// At eye level, carry the interpolated road grade into the top 10 cm cell.
fn grade_rows(c: &Column, x: i32, z: i32, low_y: i32, rows: &mut Vec<Run>) {
    let Some(top4) = c.road_top4 else { return };
    let y = top4.div_euclid(4);
    let fill = top4.rem_euclid(4);
    if fill == 0 || y < low_y || y >= low_y + SIDE as i32 ||
        c.fixtures.iter().any(|s| s.low <= y && y <= s.high) { return; }
    let (lo, hi, kind) = if y <= c.g { (fill, 4, 0) } else { (0, fill, c.ground) };
    for sy in lo..hi {
        for sz in 0..4 {
            rows.push(Run { x0:x*4, x1:x*4+4, y:y*4+sy, z:z*4+sz, kind });
        }
    }
}

/// Makes one sector of the Bay in `s`, at the coarseness `s` was started with.
pub fn make(s: &mut Scratch) {
    let (k, size) = (s.lod, 1i32 << s.lod);
    let side = SIDE as i32;
    let mut cables = Vec::new();
    let mut road = Vec::new();
    PACKS.with_borrow(|packs| {
        for cz in 0..side {
            for cx in 0..side {
                let (x, z) = (((s.low[0] + cx) << k) + size / 2, ((s.low[2] + cz) << k) + size / 2);
                let mut c = column(packs, x, z, size);
                if s.finer && k == 0 {
                    grade_rows(&c, x, z, s.low[1], &mut road);
                    c.fixtures.retain(|fixture| {
                        if fixture.rod[6] > 3 { return true; }
                        fixture.cable_rows(x,z,s.low[1],&mut cables);
                        false
                    });
                }
                for cy in 0..side {
                    let v = kind_at(&c, x, (s.low[1] + cy) << k, z, size);
                    if v != 0 {
                        s.cells[at(cx as usize, cy as usize, cz as usize)] = v;
                    }
                }
            }
        }
    });
    if !road.is_empty() { s.fine_runs(&road,2); }
    if !cables.is_empty() { s.fine_runs(&cables,2); }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A pack of the bake's own shape, made here: a slope, a road and a pavement, one house.
    fn pack() -> Vec<u8> {
        let (gw, tw) = (65i32, 128i32);
        let mut b: Vec<u8> = Vec::new();
        for v in [0x3159_4142, 0, 0, 640, 10, gw, 0, 0, 5, tw, 0, 0, 1, 4, 1, 0] {
            b.extend((v as i32).to_le_bytes());
        }
        for _ in 0..gw {
            for i in 0..gw {
                b.extend(((100 + i * 2) as i16).to_le_bytes());
            }
        }
        let inside = |i: i32, j: i32| (40..80).contains(&i) && (40..80).contains(&j);
        for j in 0..tw {
            for i in 0..tw {
                b.extend((if inside(i, j) { 260i16 } else { NONE }).to_le_bytes());
            }
        }
        for j in 0..tw {
            b.extend(std::iter::repeat_n(if j < 20 { ROAD } else if j < 30 { PAVEMENT } else { YARD }, tw as usize));
        }
        b.extend(std::iter::repeat_n(3u8, (tw * tw) as usize));
        for v in [0, 4, kind(PLASTER, WHITE) as i32, kind(PLASTER, grey(3)) as i32, 32 | 30 << 8 | 1 << 16 | 7 << 24, 140] {
            b.extend(v.to_le_bytes());
        }
        for v in [[200, 200, 3], [400, 200, 1], [400, 400, 1], [200, 400, 1 | 4]] {
            for n in v {
                b.extend((n as i32).to_le_bytes());
            }
        }
        for n in [500, 500, 300, 1] {
            b.extend((n as i32).to_le_bytes());
        }
        b
    }

    fn with_pack(f: impl FnOnce()) {
        let bytes = pack();
        let at = room(bytes.len());
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), at, bytes.len()) };
        assert_eq!(load(), 1);
        f();
        clear();
    }

    /// A coarse pack of the same place: a sample every 16 m, flat ground at 300, nothing standing.
    fn coarse() -> Vec<u8> {
        let mut b: Vec<u8> = Vec::new();
        for v in [0x3159_4142, 0, 0, 640, 160, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] {
            b.extend((v as i32).to_le_bytes());
        }
        b.extend(std::iter::repeat_n(300i16.to_le_bytes(), 25).flatten());
        b
    }

    #[test]
    fn a_road_below_foliage_uses_nearby_measured_asphalt() {
        let mut class = vec![CANOPY; 32*32];
        let mut tint = vec![colour(6,5); 32*32];
        assert!(road_greys(&class,&tint,32).is_empty());
        for (i,grey) in [(0,5),(1,7),(31,10)] {
            class[i] = 128;
            tint[i] = grey;
        }
        assert_eq!(road_greys(&class,&tint,32), [6,10,7,7]);
    }

    #[test]
    fn measured_crowns_have_openings_and_keep_the_trunk() {
        let tint = colour(6, 5);
        let mut c = Column { g: 0, road_top4: None, ground: kind(EARTH, OWN), kerb: 0,
            what: What::Crown { foot: 25, top: 70, trunk: None, tint, edge: 0.9 }, fixtures: Vec::new(), hero: None };
        let mut gaps = 0;
        let mut leaves = 0;
        for x in 0..90 {
            for y in 25..70 {
                match kind_at(&c, x, y, 35, 1) {
                    0 => gaps += 1,
                    value if value == kind(LEAVES, tint) => leaves += 1,
                    _ => panic!("unexpected crown material"),
                }
            }
        }
        assert!(gaps > 300 && leaves > 300);
        c.what = What::Crown { foot: 25, top: 70, trunk: Some(62), tint, edge: 0.0 };
        assert!((1..=62).all(|y| kind_at(&c, 0, y, 35, 1) == kind(WOOD, colour(2, 9))));
    }

    #[test]
    fn a_surveyed_grade_has_quarter_cell_risers_on_both_sides_of_zero() {
        let ground = kind(ASPHALT, grey(5));
        let mut c = Column { g: 3, road_top4: Some(17), ground, kerb: 0,
            what: What::Open, fixtures: Vec::new(), hero: None };
        let mut rows = Vec::new();
        grade_rows(&c, 4, 2, 0, &mut rows);
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|r| r.y == 16 && r.kind == ground && r.x0 == 16 && r.x1 == 20));
        c.g = -2;
        c.road_top4 = Some(-5);
        rows.clear();
        grade_rows(&c, 4, 2, -64, &mut rows);
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|r| r.y == -5 && r.kind == 0));
    }

    #[test]
    fn a_far_sector_is_made_from_the_coarse_pack_and_a_pack_let_go_is_gone() {
        clear();
        for bytes in [pack(), coarse()] {
            let at = room(bytes.len());
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), at, bytes.len()) };
            assert!(load() > 0);
        }
        // Near, the fine pack answers; in cells of 12.8 m the coarse one does, though the fine one is held.
        assert_eq!(ground(320, 320), 164);
        PACKS.with_borrow(|p| {
            assert_eq!(column(p, 320, 320, 1).g, 164);
            assert_eq!(column(p, 320, 320, 128).g, 300);
        });
        // The fine pack let go: the coarse one answers near too. Both let go: water, and the world is still the Bay's.
        assert_eq!(drop(0, 0, 10), 1);
        assert_eq!(ground(320, 320), 300);
        assert_eq!(drop(0, 0, 160), 0);
        assert_eq!(ground(320, 320), BED);
        assert!(on());
        clear();
    }

    #[test]
    fn a_pack_is_read_and_bad_bytes_are_not() {
        assert!(read(&pack()).is_some());
        assert!(read(&pack()[..5000]).is_none());
        assert!(read(&[0u8; 64]).is_none());
        let mut wrong = pack();
        // A building that says it has more corners than there are.
        let rows = 64 + 65 * 65 * 2 + 128 * 128 * 4;
        wrong[rows + 4..rows + 8].copy_from_slice(&900i32.to_le_bytes());
        assert!(read(&wrong).is_none());
    }

    /// A pack with one painted wall on the house's first side: `cells` 6 wide, 5 high.
    fn painted(cells: &[u8; 30]) -> Vec<u8> {
        let mut bytes = pack();
        bytes.extend(b"SFPT");
        bytes.extend(1u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(40i32.to_le_bytes());
        bytes.extend(6u16.to_le_bytes());
        bytes.extend(5u16.to_le_bytes());
        bytes.extend(cells);
        bytes
    }

    #[test]
    fn photographs_give_a_house_one_wall_colour_not_a_mosaic() {
        let (cream, sky, window) = (colour(4, 7), colour(16, 1), colour(16, 6));
        // Mostly cream, windows dark, a few cells of whatever stood before the wall: the house is cream throughout.
        let mut cells = [cream; 30];
        cells[..3].copy_from_slice(&[window; 3]);
        cells[3..6].copy_from_slice(&[sky, colour(8, 2), 0]);
        let p = read(&painted(&cells)).unwrap();
        assert_eq!(p.buildings[0].wall, kind(PLASTER, cream));
        // Cells that do not agree (under three in ten of the light ones on any colour) say nothing.
        let mosaic: [u8; 30] = std::array::from_fn(|i| colour(i as u8 % 24, [0, 1, 2, 3, 7][i / 6]));
        assert_eq!(read(&painted(&mosaic)).unwrap().buildings[0].wall, kind(PLASTER, WHITE));
        // White, or dark cells alone (windows, shade), say nothing either.
        let mut white = [WHITE; 30];
        white[..6].copy_from_slice(&[cream; 6]);
        assert_eq!(painted_colour([&white[..]].into_iter()), None);
        assert_eq!(painted_colour([&cells[..]].into_iter()), Some(cream));
        assert_eq!(read(&painted(&[window; 30])).unwrap().buildings[0].wall, kind(PLASTER, WHITE));
        let bytes = painted(&cells);
        assert!(read(&bytes[..bytes.len() - 1]).is_none());
    }

    #[test]
    fn an_unsurveyed_eave_is_the_middle_of_five_readings_not_one_spike() {
        let mut p = read(&pack()).unwrap();
        // The house's roof is 260 throughout; one reading of it 0.4 m in from its north side stands at 300.
        assert_eq!(p.top(300, 204), Some(260));
        p.top[40 * 128 + 60] = 300;
        assert_eq!(p.top(300, 204), Some(300));
        assert_eq!(p.eave_near([300.0, 200.0], [0.0, 1.0]), Some(260));
    }

    #[test]
    fn short_edges_between_corniced_bays_carry_the_cornice() {
        // A front of three bays, 1.2 m each, joined by 0.4 m edges the bake gave no detail; and a 0.4 m edge turning
        // the corner onto a side with no cornice keeps none.
        let corniced = |eave: i32| 3 | 2 << 24 | 128 | eave << 8;
        let mut ring = [[0, 0, corniced(300)], [12, 0, 0], [16, 0, corniced(320)], [28, 0, 0], [32, 0, corniced(300)],
            [44, 0, 0], [48, 0, 1], [48, 40, 1], [0, 40, 4 | 1]];
        join_cornices(&mut ring);
        for i in [1, 3] {
            assert_eq!(ring[i][2] & (3 | 2 << 24 | 128), 3 | 2 << 24 | 128, "edge {i}");
        }
        assert_eq!(ring[1][2] >> 8 & 0xffff, 310);
        assert_eq!(ring[5][2], 0);
        assert_eq!(ring[8][2], 4 | 1);
    }

    #[test]
    fn a_street_fixture_spans_its_cells_and_rejects_a_truncated_record() {
        let mut bytes = pack();
        bytes.extend(b"SFST");
        bytes.extend(1u32.to_le_bytes());
        for n in [120, 180, 120, 120, 265, 120, 12, kind(STEEL, OWN) as i32] {
            bytes.extend(n.to_le_bytes());
        }
        let p = read(&bytes).unwrap();
        assert!(p.fixture_spans(120,120,1).iter().any(|s| s.low <= 180 && s.high >= 265 && s.rod[7] == kind(STEEL,OWN) as i32));
        assert!(p.fixture_spans(125,120,1).is_empty());
        assert!(p.highs.iter().copied().max().unwrap() >= 265);
        bytes.pop();
        assert!(read(&bytes).is_none());
    }

    #[test]
    fn a_cable_occupies_only_the_subcells_its_radius_reaches() {
        let span = FixtureSpan { low: 31, high: 33, rod: [10,32,20, 30,32,20, 3, STEEL as i32] };
        let mut runs = Vec::new();
        span.cable_rows(15,20,0,&mut runs);
        let count: i32 = runs.iter().map(|r| r.x1-r.x0).sum();
        assert!(count > 0 && count < 64);
        assert!(runs.iter().all(|r| r.z == 80 && (127..=128).contains(&r.y)));
        runs.clear();
        span.cable_rows(15,22,0,&mut runs);
        assert!(runs.is_empty());
    }

    #[test]
    fn the_ground_follows_the_samples_and_what_no_pack_holds_is_water() {
        with_pack(|| {
            assert!(on());
            assert_eq!(ground(0, 0), 100);
            assert_eq!(ground(100, 300), 120);
            assert_eq!(ground(105, 300), 121);
            assert_eq!(ground(-50, 0), BED);
            assert_eq!(ground(5000, 5000), BED);
        });
        assert!(!on());
    }

    #[test]
    fn a_house_stands_where_its_outline_is_with_a_roof_and_windows() {
        with_pack(|| {
            // On its roof inside, on the ground outside; the pavement is a kerb over the road.
            assert_eq!(footing(300, 300).0, 261);
            assert_eq!(footing(100, 50).0, ground(100, 50) + 1);
            assert_eq!(footing(100, 120).0, ground(100, 120) + 2);
            let mut s = Scratch::new();
            let mut kinds = std::collections::HashMap::new();
            for sy in 1..5 {
                for (sx, sz) in [(3, 3), (4, 3), (3, 4), (4, 4), (5, 5), (6, 6), (3, 2), (2, 3)] {
                    s.start(sx, sy, sz, 0);
                    make(&mut s);
                    for &c in &s.cells {
                        *kinds.entry(material(c)).or_insert(0) += 1;
                    }
                }
            }
            for m in [PLASTER, GLASS, ROOFING, CONCRETE] {
                assert!(kinds.get(&m).copied().unwrap_or(0) > 50, "material {m}: {kinds:?}");
            }
            // Every sector with something in it is within the span, at every coarseness.
            for lod in 0..6 {
                let size = 64 << lod;
                for sx in -1..=640 / size {
                    for sz in -1..=640 / size {
                        let (lo, hi) = span(sx, sz, lod);
                        for sy in [lo - 1, hi + 1] {
                            s.start(sx, sy, sz, lod);
                            make(&mut s);
                            let full = s.cells.iter().filter(|&&c| c != 0).count();
                            assert!(if sy < lo { full == s.cells.len() } else { full == 0 }, "lod {lod} sector {sx} {sy} {sz}: {full} cells, span {lo} to {hi}");
                        }
                    }
                }
            }
        });
    }
}
