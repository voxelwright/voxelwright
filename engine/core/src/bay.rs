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
    static PACK_GEN: Cell<u32> = const { Cell::new(1) };
    static ROOM: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static HEROES: RefCell<Vec<Hero>> = const { RefCell::new(Vec::new()) };
    static LANDMARKS: Cell<bool> = const { Cell::new(true) };
    static MARKS: RefCell<Marks> = RefCell::new(Marks::default());
    static SECTOR_COLS: RefCell<SectorColCache> = RefCell::new(SectorColCache::default());
    static SOLID_CACHE: RefCell<Box<[SolidEntry; 512]>> = RefCell::new(Box::new([SolidEntry::EMPTY; 512]));
}

#[inline]
fn bump_gen() {
    let next = PACK_GEN.get().wrapping_add(1);
    PACK_GEN.set(if next == 0 { 1 } else { next });
}

#[derive(Clone, Copy)]
struct SolidEntry {
    x: i32,
    z: i32,
    epoch: u32,
    top: i32,
    g: i32,
    ground: Kind,
    /** Lowest fixture cell in this column (`i32::MAX` when none): queries below `ceil` hit the O(1) cache even under overhead wires (#129). */
    ceil: i32,
}

impl SolidEntry {
    const EMPTY: Self = Self { x: 0, z: 0, epoch: 0, top: 0, g: 0, ground: 0, ceil: 0 };
}

#[derive(Default)]
struct SectorColCache {
    low_x: i32,
    low_z: i32,
    lod: u32,
    epoch: u32,
    cols: Vec<OwnedColumn>,
}

/// Paint and rails on the road, from the street graph (#450, the page's `marks`): lane lines, centre lines, crossings
/// and tracks. The march draws them as lines over the asphalt (page/marks.ts); the core needs only where they are
/// drawn, for there the bake's own paint and rails (class bits 32 and 64, settled per 50 cm sample from the aerial)
/// are not: they were blocks and bands. Drawn as 10 cm cells here, a line at an angle to the cells was a staircase.
#[derive(Default)]
struct Marks {
    covers: Vec<[i32; 4]>,
}

/// Takes the marks in the room (`room`): little-endian words, `MARK`, how many covered squares and how many segments,
/// then the squares (x0, z0, x1, z1) and the segments (x0, z0, x1, z1, style). Returns the segments, or -1.
pub fn marks() -> i32 {
    let bytes = ROOM.with_borrow_mut(std::mem::take);
    if bytes.len() % 4 != 0 || bytes.len() > 128 << 20 { return -1; }
    let w: Vec<i32> = bytes.chunks_exact(4).map(|b| i32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    if w.len() < 3 || w[0] != 0x4b52_414d { return -1; }
    let (Ok(nc), Ok(ns)) = (usize::try_from(w[1]), usize::try_from(w[2])) else { return -1; };
    let Some(end) = nc.checked_mul(4).and_then(|n| n.checked_add(3)) else { return -1; };
    if ns.checked_mul(5).and_then(|n| end.checked_add(n)) != Some(w.len()) { return -1; }
    let covers = w[3..end].chunks_exact(4).map(|c| [c[0], c[1], c[2], c[3]]).collect();
    MARKS.with_borrow_mut(|held| *held = Marks { covers });
    bump_gen();
    ns as i32
}

/// Whether the graph's marks are drawn at a column: then the bake's paint and rails are not.
fn marked_place(x: i32, z: i32) -> bool {
    MARKS.with_borrow(|m| m.covers.iter().any(|c| x >= c[0] && z >= c[1] && x < c[2] && z < c[3]))
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

impl Hero {
    fn local(&self, x: i32, z: i32, half: f32) -> (f32, f32) {
        let (dx, dz) = ((x - self.at[0]) as f32 + half, (z - self.at[2]) as f32 + half);
        ((dx * self.along[0] + dz * self.along[1]) * 0.1, (dz * self.along[0] - dx * self.along[1]) * 0.1)
    }
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
    bump_gen();
    1
}

/// Whether landmarks are made as the world's cells: off, the place is as the tiles have it (for what they cost).
pub fn landmarks(on: bool) {
    LANDMARKS.set(on);
    bump_gen();
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
    /// The glass share of its upper walls as its photographs measured it (bay/facade_evidence.py), if they did.
    glass: Option<f32>,
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
    /// True when the surveyed footprint already traces bay windows or faceted street projections.
    has_surveyed_bays: bool,
    /// Clean median eave/wall-top height (in cells) derived from valid roof samples, for uniform roof slopes.
    eave_med: i32,
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
    /// Precomputed edge lengths for each vertex in `verts` (avoids per-edge sqrt in `Pack::probe`).
    edge_len: Vec<f32>,
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
    bump_gen();
    held
}

/// Makes the world the Bay's before any pack has come: packs come and go as the eye moves (the page's bay.ts),
/// and where none is held yet there is water.
pub fn begin() {
    ON.set(true);
    bump_gen();
}

/// Lets go of the pack whose ground starts at (`x0`, `z0`) with a sample every `gstep` cells. Returns how many
/// packs are held after. The world stays the Bay's.
pub fn drop(x0: i32, z0: i32, gstep: i32) -> i32 {
    let held = PACKS.with_borrow_mut(|p| {
        p.retain(|p| (p.gx0, p.gz0, p.gstep) != (x0, z0, gstep));
        p.len() as i32
    });
    bump_gen();
    held
}

/// The pack that answers for a column made of cells `size` wide: the finest that holds it among those no finer
/// than such cells are worth (a far sector is made from a coarse pack, and so is made the same whichever finer
/// packs happen to be held); where there is none of those, the finest that holds it at all.
fn pick(packs: &[Pack], x: i32, z: i32, size: i32) -> Option<&Pack> {
    let least = least_step(size);
    packs.iter().find(|p| p.gstep >= least && p.holds(x, z)).or_else(|| packs.iter().find(|p| p.holds(x, z)))
}

/// The finest sampling worth holding for cells `size` wide: 1 m to cells of 0.8 m, 2 m at 1.6 m (covering the
/// handover to the far model at 500 m), and 16 m past that (where the far model draws the city).
/// The page's bay.ts asks for packs by the same rule.
pub fn least_step(size: i32) -> i32 {
    if size <= 8 { 0 } else if size <= 16 { 20 } else { 160 }
}

/// Lets every pack go: the world is the town's again.
pub fn clear() {
    PACKS.with_borrow_mut(|p| p.clear());
    ON.set(false);
    bump_gen();
}

fn read(b: &[u8]) -> Option<Pack> {
    let int = |i: usize| b.get(i * 4..i * 4 + 4).map(|w| i32::from_le_bytes([w[0], w[1], w[2], w[3]]));
    let head: Vec<i32> = (0..16).map(int).collect::<Option<_>>()?;
    if head[0] != 0x3159_4142 || head[4] <= 0 || head[5] <= 1 || head[8] < 0 || head[9] < 0 || head[12..15].iter().any(|&n| n < 0) {
        return None;
    }
    let gw = usize::try_from(head[5]).ok()?;
    let tw = if head[8] > 0 { usize::try_from(head[9]).ok()? } else { 0 };
    if gw > 8192 || tw > 8192 || (head[8] > 0 && tw < 2) || b.len() > 256 << 20 { return None; }
    let wide = (head[5] - 1).checked_mul(head[4])?;
    if wide > 64_000 || head[6].checked_add(wide).is_none() || head[7].checked_add(wide).is_none() { return None; }
    // The top grid is indexed relative to the ground origin using signed cell coordinates.
    let top_span = head[9].saturating_sub(1).checked_mul(head[8])?;
    for axis in [0, 1] {
        let offset = head[10 + axis].checked_sub(head[6 + axis])?;
        offset.checked_add(top_span)?;
        head[10 + axis].checked_add(top_span)?;
    }
    let samples = tw.checked_mul(tw)?;
    let top_bytes = samples.checked_mul(2)?;
    let (nb, nv, nt) = (usize::try_from(head[12]).ok()?, usize::try_from(head[13]).ok()?, usize::try_from(head[14]).ok()?);
    let mut from: usize = 64;
    let mut take = |n: usize| {
        let part = b.get(from..from.checked_add(n)?)?;
        from += n;
        Some(part)
    };
    let shorts = |p: &[u8]| p.chunks_exact(2).map(|w| i16::from_le_bytes([w[0], w[1]])).collect::<Vec<_>>();
    let ints = |p: &[u8]| p.chunks_exact(4).map(|w| i32::from_le_bytes([w[0], w[1], w[2], w[3]])).collect::<Vec<_>>();
    let ground = shorts(take(gw.checked_mul(gw)?.checked_mul(2)?)?);
    let top = shorts(take(top_bytes)?);
    let class = take(samples)?.to_vec();
    let tint = take(samples)?.to_vec();
    let walls = if head[15] & 1 == 1 { take(top_bytes)?.chunks_exact(2).map(|w| u16::from_le_bytes([w[0], w[1]])).collect() } else { Vec::new() };
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
            let end = 12usize.checked_add(width.checked_mul(height)?)?;
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
        propagate_fronts(own);
        let has_surveyed_bays = ring_has_surveyed_bays(own);
        let style = r[4] as u32;
        let evidence = Evidence::of(r[3]);
        buildings.push(Building {
            first,
            count,
            // Who says what a wall is, first to last: its photographs as evidence (a colour and a material several
            // views agree on), the majority of its painted cells, the bake's rule.
            wall: match painted_colour((first..first + count).filter_map(|e| paint.get(&(e as u32)).copied())) {
                _ if evidence.wall => r[2] as Kind,
                Some(tint) => kind(material(r[2] as Kind), tint),
                None => r[2] as Kind,
            },
            trim: r[3] as Kind,
            glass: evidence.glass,
            storey: (style & 255).max(20) as i32 * if style >> 19 & 1 == 1 { 3 } else { 1 },
            module: (style >> 8 & 255).max(16) as i32,
            home: style >> 16 & 1 == 1,
            special: style >> 17 & 3,
            ground_floor: style >> 20 & 7,
            seed: style >> 24,
            base: r[5],
            has_surveyed_bays,
            eave_med: r[5] + 2 * ((style & 255).max(20) as i32 * if style >> 19 & 1 == 1 { 3 } else { 1 }),
            low: [own.iter().map(|v| v[0]).min()?, own.iter().map(|v| v[1]).min()?],
            high: [own.iter().map(|v| v[0]).max()?, own.iter().map(|v| v[1]).max()?],
        });
    }
    let under_leaf_road = road_greys(&class, &tint, tw);
    let mut edge_len = vec![0.0f32; verts.len()];
    for b in &buildings {
        let own = &verts[b.first..b.first + b.count];
        let mut start = 0;
        for i in 0..own.len() {
            let a = own[i];
            let last = a[2] & 4 != 0 || i == own.len() - 1;
            let c = if last { own[start] } else { own[i + 1] };
            let (dx, dz) = ((c[0] - a[0]) as f32, (c[1] - a[1]) as f32);
            edge_len[b.first + i] = (dx * dx + dz * dz).sqrt();
            if last {
                start = i + 1;
            }
        }
    }
    let mut p = Pack { gstep: head[4], gw: head[5], gx0: head[6], gz0: head[7], ground, tstep: head[8], tw: tw as i32, tx0: head[10], tz0: head[11], top, class, tint, under_leaf_road, walls, buildings, verts, edge_len, trunks, near: Vec::new(), stems: Vec::new(), fixtures, fixtures_near: Vec::new(), pw: 0, lows: Vec::new(), highs: Vec::new(), bw: 0 };
    despike_roofs(&mut p.top, &p.class, tw, p.tstep);
    repair_building_roofs(&mut p);
    // Which buildings and trunks reach into each patch.
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
        // Never plant a tree trunk directly inside an asphalt carriageway, nor keep skinny poles (>7.5 m tall with
        // measured crown radius <= 1.2 m) that lidar misclassified as tall green needles.
        let measured = t[3] >> 8;
        if p.tstep > 0 && (p.surface(t[0], t[1]).0 & 7 == ROAD || (measured > 0 && measured <= 12 && t[2] - p.ground(t[0], t[1]) > 75)) {
            continue;
        }
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
        // Relocate or drop standing street fixtures (street lamps, stop signs, hydrants, utility poles, sensed poles)
        // whose surveyed or OSM base landed on asphalt (ROAD).
        if p.tstep > 0 {
            p.clean_road_fixtures();
        }
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

/// Remove narrow vertical lidar spikes (rooftop light poles, masts, vents, antennas) from building roofs.
/// At L0 (`tstep == 5`, 0.5 m samples), a separable 5x5 (2.5 m) morphological opening over non-canopy roof
/// samples removes isolated pillars narrower than 2.5 m that rise more than 2.5 m above the surrounding roof,
/// while preserving flat/pitched roofs, parapets <= 2.5 m, step edges between wide buildings, standalone
/// narrow buildings, and tree canopies. At L1 (`tstep == 20`, 2 m samples), a bounded 3-cell connected
/// component filter removes 1- to 3-cell spikes (poles straddling a 2 m grid line) without flattening
/// narrow rowhouses.
fn despike_roofs(top: &mut [i16], class: &[u8], tw: usize, tstep: i32) {
    const THRESH: i32 = 25; // 2.5 m in 10 cm cells
    if tstep == 5 && tw >= 5 {
        let n = tw * tw;
        let is_roof = |t: &[i16], i: usize| t[i] != NONE && class[i] & CANOPY == 0;
        let mut hmin = vec![i16::MAX; n];
        let mut eroded = vec![i16::MAX; n];
        for j in 0..tw {
            let row = j * tw;
            for i in 0..tw {
                let mut m = i16::MAX;
                for x in i.saturating_sub(2)..=(i + 2).min(tw - 1) {
                    let k = row + x;
                    if is_roof(top, k) { m = m.min(top[k]); }
                }
                hmin[row + i] = m;
            }
        }
        for j in 0..tw {
            let row = j * tw;
            for i in 0..tw {
                let mut m = i16::MAX;
                for y in j.saturating_sub(2)..=(j + 2).min(tw - 1) {
                    m = m.min(hmin[y * tw + i]);
                }
                eroded[row + i] = m;
            }
        }
        let mut hmax = vec![i16::MIN; n];
        for j in 0..tw {
            let row = j * tw;
            for i in 0..tw {
                let mut m = i16::MIN;
                for x in i.saturating_sub(2)..=(i + 2).min(tw - 1) {
                    let k = row + x;
                    if is_roof(top, k) && eroded[k] != i16::MAX { m = m.max(eroded[k]); }
                }
                hmax[row + i] = m;
            }
        }
        for j in 0..tw {
            let row = j * tw;
            for i in 0..tw {
                let k = row + i;
                if !is_roof(top, k) { continue; }
                let mut opened = i16::MIN;
                for y in j.saturating_sub(2)..=(j + 2).min(tw - 1) {
                    opened = opened.max(hmax[y * tw + i]);
                }
                if opened != i16::MIN && top[k] as i32 - opened as i32 > THRESH {
                    top[k] = opened;
                }
            }
        }
    } else if tstep == 20 && tw >= 3 {
        let is_built = |t: &[i16], i: usize| t[i] != NONE && class[i] & BUILT != 0;
        let tw_i = tw as isize;
        let mut comp = [(0isize, 0isize); 4];
        for j in 0..tw_i {
            for i in 0..tw_i {
                let idx = (j * tw_i + i) as usize;
                if !is_built(top, idx) { continue; }
                let t0 = top[idx] as i32;
                let mut lo = t0;
                for (dy, dx) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                    let (ny, nx) = (j + dy, i + dx);
                    if ny >= 0 && ny < tw_i && nx >= 0 && nx < tw_i {
                        let nk = (ny * tw_i + nx) as usize;
                        if is_built(top, nk) { lo = lo.min(top[nk] as i32); }
                    }
                }
                if t0 - lo <= THRESH { continue; }
                comp[0] = (j, i);
                let (mut len, mut head, mut too_big) = (1usize, 0usize, false);
                while head < len && !too_big {
                    let (y, x) = comp[head];
                    head += 1;
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            if dy == 0 && dx == 0 { continue; }
                            let (ny, nx) = (y + dy, x + dx);
                            if ny < 0 || ny >= tw_i || nx < 0 || nx >= tw_i { continue; }
                            let nk = (ny * tw_i + nx) as usize;
                            if !is_built(top, nk) || top[nk] as i32 <= t0 - THRESH { continue; }
                            if comp[..len].contains(&(ny, nx)) { continue; }
                            if len == 3 { too_big = true; break; }
                            comp[len] = (ny, nx);
                            len += 1;
                        }
                        if too_big { break; }
                    }
                }
                if too_big { continue; }
                let mut comp_min = i32::MAX;
                let mut ring_max = i32::MIN;
                let mut ring = [(0isize, 0isize); 24];
                let mut ring_cnt = 0usize;
                for &(y, x) in &comp[..len] {
                    comp_min = comp_min.min(top[(y * tw_i + x) as usize] as i32);
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            let (ny, nx) = (y + dy, x + dx);
                            if ny < 0 || ny >= tw_i || nx < 0 || nx >= tw_i { continue; }
                            if comp[..len].contains(&(ny, nx)) || ring[..ring_cnt].contains(&(ny, nx)) { continue; }
                            let nk = (ny * tw_i + nx) as usize;
                            if is_built(top, nk) {
                                ring_max = ring_max.max(top[nk] as i32);
                                if ring_cnt < ring.len() {
                                    ring[ring_cnt] = (ny, nx);
                                    ring_cnt += 1;
                                }
                            }
                        }
                    }
                }
                if ring_cnt >= 3 && comp_min > ring_max + THRESH {
                    for &(y, x) in &comp[..len] {
                        top[(y * tw_i + x) as usize] = ring_max as i16;
                    }
                }
            }
        }
    }
}

/// What a building's photographs say of it as evidence (bay/facade_evidence.py, written by bay/evidence_tile.py), in
/// the 16 bits over its trim's kind: bit 16, its wall's kind (`r[2]`) is measured; bits 17 to 23, the glass share of
/// its upper walls in hundredths, present when bit 24 is set. A building no photograph spoke for has none of them.
struct Evidence {
    wall: bool,
    glass: Option<f32>,
}

impl Evidence {
    fn of(trim: i32) -> Evidence {
        let bits = trim as u32 >> 16;
        Evidence { wall: bits & 1 == 1, glass: (bits >> 8 & 1 == 1).then(|| (bits >> 1 & 127).min(100) as f32 / 100.0) }
    }
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

/// Propagates street-facing and open-air flags across recessed porches and faceted bay-window segments that erosion or
/// setback distance left unmarked, and ensures no standalone building outer ring is completely windowless (#60).
fn propagate_fronts(ring_verts: &mut [[i32; 3]]) {
    const FACET_MAX: f32 = 22.0; // 2.2 m (bay facets & recessed porch jogs, never 3+ m side party walls)
    let mut start = 0;
    let mut outer = true;
    while start < ring_verts.len() {
        let end = (start..ring_verts.len()).find(|&i| ring_verts[i][2] & 4 != 0).unwrap_or(ring_verts.len() - 1) + 1;
        let ring = &mut ring_verts[start..end];
        let n = ring.len();
        if n >= 3 {
            let lens: Vec<f32> = (0..n).map(|i| {
                let (a, c) = (ring[i], ring[(i + 1) % n]);
                (((c[0] - a[0]) as f32).powi(2) + ((c[1] - a[1]) as f32).powi(2)).sqrt()
            }).collect();
            let orig: Vec<i32> = ring.iter().map(|v| v[2]).collect();
            // Fill short unmarked chains (<= 6 edges, <= 12 m) bounded on both sides by street-facing edges (bit 1).
            for i in 0..n {
                if orig[i] & 3 == 3 || lens[i] >= FACET_MAX {
                    continue;
                }
                let mut steps_b = 0usize;
                let mut len_sum = lens[i];
                let mut before_street = false;
                for k in 1..=6.min(n - 1) {
                    let j = (i + n - k) % n;
                    if orig[j] & 2 != 0 {
                        before_street = true;
                        break;
                    }
                    if lens[j] >= FACET_MAX {
                        break;
                    }
                    steps_b += 1;
                    len_sum += lens[j];
                }
                if !before_street {
                    continue;
                }
                let mut after_street = false;
                for k in 1..=6.min(n - 1) {
                    let j = (i + k) % n;
                    if orig[j] & 2 != 0 {
                        after_street = true;
                        break;
                    }
                    if lens[j] >= FACET_MAX || steps_b + k > 6 {
                        break;
                    }
                    len_sum += lens[j];
                }
                if after_street && len_sum <= 120.0 {
                    ring[i][2] |= 3;
                }
            }
            // Fallback: if an outer ring has zero open-air edges (erosion swallowed every face), open its longest
            // fronts (>= 2.0 m, or at least its longest edge) so the building is never a blind blank box.
            if outer && !ring.iter().any(|v| v[2] & 1 != 0) {
                let longest = lens.iter().copied().fold(0.0f32, f32::max);
                let thresh = (longest * 0.6).max(20.0).min(longest);
                for (i, &l) in lens.iter().enumerate() {
                    if l >= thresh - 0.1 {
                        ring[i][2] |= 1;
                    }
                }
            }
        }
        outer = false;
        start = end;
    }
}

/// True when a building's outer ring already traces bay windows or stepped/angled street projections, so `What::By`
/// does not glue a second synthetic bay box on top of surveyed bay geometry (#60).
fn ring_has_surveyed_bays(ring_verts: &[[i32; 3]]) -> bool {
    let end = (0..ring_verts.len()).find(|&i| ring_verts[i][2] & 4 != 0).unwrap_or(ring_verts.len().saturating_sub(1)) + 1;
    let ring = &ring_verts[..end.min(ring_verts.len())];
    let n = ring.len();
    if n < 7 {
        return false;
    }
    let mut faceted_street = 0usize;
    let mut angled_bends = 0usize;
    for i in 0..n {
        let (a, b, c) = (ring[i], ring[(i + 1) % n], ring[(i + 2) % n]);
        let (dx1, dz1) = ((b[0] - a[0]) as f32, (b[1] - a[1]) as f32);
        let len1 = (dx1 * dx1 + dz1 * dz1).sqrt();
        if a[2] & 2 != 0 && (5.0..=45.0).contains(&len1) {
            faceted_street += 1;
            let (dx2, dz2) = ((c[0] - b[0]) as f32, (c[1] - b[1]) as f32);
            let len2 = (dx2 * dx2 + dz2 * dz2).sqrt();
            if len1 > 0.5 && len2 > 0.5 {
                let cos_a = (dx1 * dx2 + dz1 * dz2) / (len1 * len2);
                if cos_a.abs() < 0.92 {
                    angled_bends += 1;
                }
            }
        }
    }
    faceted_street >= 3 || (faceted_street >= 2 && angled_bends >= 1)
}

/// Repairs collapsed perimeter ground-level lidar dropouts (where a surveyed footprint extends 0.5–1.5 m past the
/// lidar roof return edge), denoises single-cell rooftop spikes/potholes with a 3x3 building-interior median, and
/// fills missing horizontal eaves on street-facing edges so houses never render as broken/demolished stubs (#60).
fn repair_building_roofs(p: &mut Pack) {
    if p.tstep <= 0 || p.tstep > 10 || p.buildings.is_empty() {
        return;
    }
    let (tw, tstep, tx0, tz0) = (p.tw, p.tstep, p.tx0, p.tz0);
    let nb = p.buildings.len();
    for bi in 0..nb {
        if p.buildings[bi].special != 0 {
            continue;
        }
        let b_low = p.buildings[bi].low;
        let b_high = p.buildings[bi].high;
        let b_base = p.buildings[bi].base;
        let b_first = p.buildings[bi].first;
        let b_count = p.buildings[bi].count;
        let i0 = ((b_low[0] - tx0).div_euclid(tstep)).clamp(0, tw - 1);
        let i1 = ((b_high[0] - tx0).div_euclid(tstep)).clamp(0, tw - 1);
        let j0 = ((b_low[1] - tz0).div_euclid(tstep)).clamp(0, tw - 1);
        let j1 = ((b_high[1] - tz0).div_euclid(tstep)).clamp(0, tw - 1);
        let (w, h) = ((i1 - i0 + 1) as usize, (j1 - j0 + 1) as usize);
        if w == 0 || h == 0 || w * h > 12000 {
            continue;
        }
        let mut inside = vec![false; w * h];
        let mut repaired = vec![NONE; w * h];
        let mut valid_heights = Vec::new();
        for lj in 0..h {
            let j = j0 + lj as i32;
            let cz = tz0 + j * tstep + tstep / 2;
            for li in 0..w {
                let i = i0 + li as i32;
                let cx = tx0 + i * tstep + tstep / 2;
                if p.probe(&p.buildings[bi], cx, cz).inside {
                    let k = lj * w + li;
                    inside[k] = true;
                    let v = p.top[(j * tw + i) as usize];
                    repaired[k] = v;
                    if v != NONE && (v as i32) >= b_base + 24 {
                        valid_heights.push(v);
                    }
                }
            }
        }
        if valid_heights.is_empty() {
            continue;
        }
        valid_heights.sort_unstable();
        let roof_lo = valid_heights[valid_heights.len() / 4];
        // Pass A: Fill collapsed perimeter dropouts (< base + 24, i.e. ground/car/missing lidar inside the footprint)
        // by sampling straight inward from the outer edge into the same building's valid roof.
        let mut filled = repaired.clone();
        for lj in 0..h {
            let j = j0 + lj as i32;
            let cz = tz0 + j * tstep + tstep / 2;
            for li in 0..w {
                let k = lj * w + li;
                if !inside[k] {
                    continue;
                }
                let v = repaired[k];
                if v != NONE && (v as i32) >= b_base + 24 {
                    continue;
                }
                let i = i0 + li as i32;
                let cx = tx0 + i * tstep + tstep / 2;
                let pr = p.probe(&p.buildings[bi], cx, cz);
                if pr.far >= 24.0 {
                    continue;
                }
                let far = pr.far.max(0.01);
                let (ix, iz) = ((cx as f32 + 0.5 - pr.on[0]) / far, (cz as f32 + 0.5 - pr.on[1]) / far);
                let mut found = None;
                // Prefer the nearest valid inside roof sample (radius 1..=3) so a corner dropout next to a lower
                // front eave inherits that front roof instead of jumping up to a taller rear roof (`roof_lo`).
                let mut near_vals = [0i16; 49];
                for rad in 1i32..=3 {
                    let mut m = 0usize;
                    for dj in -rad..=rad {
                        let nj = lj as i32 + dj;
                        if nj < 0 || nj >= h as i32 { continue; }
                        for di in -rad..=rad {
                            if di.abs().max(dj.abs()) != rad { continue; }
                            let ni = li as i32 + di;
                            if ni < 0 || ni >= w as i32 { continue; }
                            let nk = nj as usize * w + ni as usize;
                            if inside[nk] && repaired[nk] != NONE && (repaired[nk] as i32) >= b_base + 26 {
                                near_vals[m] = repaired[nk];
                                m += 1;
                            }
                        }
                    }
                    if m > 0 {
                        near_vals[..m].sort_unstable();
                        found = Some(near_vals[m / 4]);
                        break;
                    }
                }
                if found.is_none() {
                    for &d in &[8.0f32, 14.0, 20.0, 26.0] {
                        let sx = ((cx as f32 + 0.5 + ix * d).floor() as i32 - tx0).div_euclid(tstep) - i0;
                        let sz = ((cz as f32 + 0.5 + iz * d).floor() as i32 - tz0).div_euclid(tstep) - j0;
                        if sx >= 0 && sz >= 0 && (sx as usize) < w && (sz as usize) < h {
                            let sk = sz as usize * w + sx as usize;
                            if inside[sk] && repaired[sk] != NONE && (repaired[sk] as i32) >= b_base + 26 {
                                found = Some(repaired[sk]);
                                break;
                            }
                        }
                    }
                }
                if found.is_none() && pr.looks & 128 != 0 {
                    let eave = (pr.looks >> 8) as i16;
                    if (eave as i32) >= b_base + 26 {
                        found = Some(eave);
                    }
                }
                if found.is_none() && (roof_lo as i32) >= b_base + 28 {
                    found = Some(roof_lo);
                }
                if let Some(fv) = found {
                    filled[k] = fv;
                }
            }
        }
        // Pass B: 3x3 edge-preserving building-interior median to strip lidar vents, poles, potholes and jagged teeth,
        // plus a perimeter-sliver clamp on residential roofs so 0.5-1.0 m corner fins never protrude above the eave (#60).
        let is_home = p.buildings[bi].home;
        let mut nbrs = [0i16; 9];
        let mut wide_nbrs = [0i16; 25];
        for lj in 0..h {
            let j = j0 + lj as i32;
            for li in 0..w {
                let k = lj * w + li;
                if !inside[k] {
                    continue;
                }
                let cur = filled[k];
                if cur == NONE || (cur as i32) < b_base + 24 {
                    continue;
                }
                let mut n = 0usize;
                for dj in -1i32..=1 {
                    let nj = lj as i32 + dj;
                    if nj < 0 || nj >= h as i32 { continue; }
                    for di in -1i32..=1 {
                        let ni = li as i32 + di;
                        if ni < 0 || ni >= w as i32 { continue; }
                        let nk = nj as usize * w + ni as usize;
                        if inside[nk] && filled[nk] != NONE && (filled[nk] as i32) >= b_base + 24 {
                            nbrs[n] = filled[nk];
                            n += 1;
                        }
                    }
                }
                let mut out = cur;
                if n >= 4 {
                    nbrs[..n].sort_unstable();
                    let med = nbrs[n / 2];
                    let flat = nbrs[..n].iter().filter(|&&nv| (nv - med).abs() <= 8).count();
                    if (cur - med).abs() <= 18 || flat >= 5 {
                        out = med;
                    }
                }
                if is_home && n <= 4 {
                    let mut wn = 0usize;
                    for dj in -2i32..=2 {
                        let nj = lj as i32 + dj;
                        if nj < 0 || nj >= h as i32 { continue; }
                        for di in -2i32..=2 {
                            let ni = li as i32 + di;
                            if ni < 0 || ni >= w as i32 { continue; }
                            let nk = nj as usize * w + ni as usize;
                            if inside[nk] && filled[nk] != NONE && (filled[nk] as i32) >= b_base + 24 {
                                wide_nbrs[wn] = filled[nk];
                                wn += 1;
                            }
                        }
                    }
                    if wn >= 6 {
                        wide_nbrs[..wn].sort_unstable();
                        let wmed = wide_nbrs[wn / 2];
                        if out > wmed + 6 {
                            out = wmed;
                        }
                    }
                }
                let i = i0 + li as i32;
                p.top[(j * tw + i) as usize] = out;
            }
        }
        // Pass C: Fill missing or collapsed surveyed eaves on street-facing edges using the repaired roof grid.
        let mut best_street: Option<(f32, i32)> = None;
        let mut ring_start = 0usize;
        for ei in 0..b_count {
            let a = p.verts[b_first + ei];
            let last = a[2] & 4 != 0 || ei == b_count - 1;
            let c = p.verts[b_first + if last { ring_start } else { ei + 1 }];
            if last {
                ring_start = ei + 1;
            }
            if a[2] & 2 == 0 {
                continue;
            }
            let (dx, dz) = ((c[0] - a[0]) as f32, (c[1] - a[1]) as f32);
            let long = (dx * dx + dz * dz).sqrt();
            if long < 7.0 {
                continue;
            }
            let has_valid = a[2] & 128 != 0 && ((a[2] >> 8) as i16 as i32) >= b_base + 28;
            if has_valid && !is_home {
                let ev = (a[2] >> 8) as i16 as i32;
                if best_street.is_none_or(|(bl, _)| long > bl) {
                    best_street = Some((long, ev));
                }
                continue;
            }
            let (tx, tz) = (dx / long, dz / long);
            let (mx, mz) = ((a[0] + c[0]) as f32 * 0.5, (a[1] + c[1]) as f32 * 0.5);
            let n1 = (-tz, tx);
            let inward = if p.probe(&p.buildings[bi], (mx + n1.0 * 5.0) as i32, (mz + n1.1 * 5.0) as i32).inside {
                n1
            } else {
                (tz, -tx)
            };
            let mut samples = Vec::new();
            for &t in &[0.15f32, 0.32, 0.50, 0.68, 0.85] {
                let sx = (a[0] as f32 + dx * t + inward.0 * 6.0) as i32;
                let sz = (a[1] as f32 + dz * t + inward.1 * 6.0) as i32;
                if let Some(top_v) = p.top(sx, sz) {
                    if top_v >= b_base + 28 {
                        samples.push(top_v);
                    }
                }
            }
            if has_valid {
                let mut ev = (a[2] >> 8) as i16 as i32;
                // Check both 0.6 m and 1.2 m inward before lowering a valid baked eave so a shallow front bay/porch
                // ledge (0.6 m deep) never collapses a genuine two-storey street wall.
                let mut deep_samples = Vec::new();
                for &t in &[0.15f32, 0.32, 0.50, 0.68, 0.85] {
                    let s1 = p.top((a[0] as f32 + dx * t + inward.0 * 6.0) as i32, (a[1] as f32 + dz * t + inward.1 * 6.0) as i32)
                        .filter(|&v| v >= b_base + 28);
                    let s2 = p.top((a[0] as f32 + dx * t + inward.0 * 12.0) as i32, (a[1] as f32 + dz * t + inward.1 * 12.0) as i32)
                        .filter(|&v| v >= b_base + 28);
                    if let Some(best) = s1.into_iter().chain(s2).max() {
                        deep_samples.push(best);
                    }
                }
                if deep_samples.len() >= 3 {
                    deep_samples.sort_unstable();
                    let med_eave = deep_samples[deep_samples.len() / 2];
                    // Clamp stale baked eaves that sit > 0.6 m taller than the actual repaired roof behind the edge.
                    if ev > med_eave + 6 {
                        ev = med_eave;
                        p.verts[b_first + ei][2] = (a[2] & !0xff_ff00) | 128 | ((ev & 0xffff) << 8);
                    }
                }
                if best_street.is_none_or(|(bl, _)| long > bl) {
                    best_street = Some((long, ev));
                }
            } else if samples.len() >= 3 {
                samples.sort_unstable();
                let med_eave = samples[samples.len() / 2];
                p.verts[b_first + ei][2] = (a[2] & !0xff_ff00) | 128 | ((med_eave & 0xffff) << 8);
                if best_street.is_none_or(|(bl, _)| long > bl) {
                    best_street = Some((long, med_eave));
                }
            }
        }
        p.buildings[bi].eave_med = best_street.map_or(roof_lo as i32, |(_, ev)| ev);
    }
}

impl Pack {
    /// Roof height at an interior building cell, falling back to the nearest valid adjacent interior sample when a
    /// narrow perimeter cell's `tstep` grid center sits just outside the polygon (`NONE`), before synthetic `2 * storey`.
    #[inline]
    fn roof_raster(&self, b: &Building, x: i32, z: i32) -> i32 {
        if let Some(v) = self.top(x, z) {
            return v;
        }
        if self.tstep > 0 {
            let s = self.tstep;
            let mut best = i32::MAX;
            for (nx, nz) in [(x - s, z), (x + s, z), (x, z - s), (x, z + s)] {
                if let Some(v) = self.top(nx, nz) {
                    if v >= b.base + 24 && v < best && self.probe(b, nx, nz).inside {
                        best = v;
                    }
                }
            }
            if best != i32::MAX {
                return best;
            }
        }
        b.base + 2 * b.storey
    }

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
        self.building_idx(x, z).map(|(i, p)| (&self.buildings[i], p))
    }

    fn building_idx(&self, x: i32, z: i32) -> Option<(usize, Probe)> {
        let patch = (((z - self.gz0) >> PATCH).clamp(0, self.pw - 1) * self.pw + ((x - self.gx0) >> PATCH).clamp(0, self.pw - 1)) as usize;
        let mut best: Option<(usize, Probe)> = None;
        for &i in &self.near[patch] {
            let bi = i as usize;
            let b = &self.buildings[bi];
            if x < b.low[0] - OUT || z < b.low[1] - OUT || x > b.high[0] + OUT || z > b.high[1] + OUT {
                continue;
            }
            let p = self.probe(b, x, z);
            if p.inside {
                return Some((bi, p));
            }
            if p.far < (if p.looks >> 24 != 0 { OUT } else { 8 }) as f32 && best.as_ref().is_none_or(|(_, q)| p.far < q.far) {
                best = Some((bi, p));
            }
        }
        best
    }

    /// Where a column is against a building's outline: in it or not (a ring inside a ring is a yard), how far from
    /// its nearest side, how far along that side, how long the side is, what it looks at, and the nearest point of it.
    fn probe(&self, b: &Building, x: i32, z: i32) -> Probe {
        let (px, pz) = (x as f32 + 0.5, z as f32 + 0.5);
        let own = &self.verts[b.first..b.first + b.count];
        let lens = &self.edge_len[b.first..b.first + b.count];
        let mut p = Probe { inside: false, far: f32::MAX, along: 0.0, round: 0.0, long: 0.0, looks: 0, side: 0, on: [0.0; 2] };
        let mut best_far2 = f32::MAX;
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
            let long = lens[i];
            run = if last { 0.0 } else { run + long };
            if last {
                start = i + 1;
            }
            if long < 0.5 {
                continue;
            }
            let (dx, dz) = (cx - ax, cz - az);
            let t = (((px - ax) * dx + (pz - az) * dz) / (long * long)).clamp(0.0, 1.0);
            let (qx, qz) = (ax + dx * t, az + dz * t);
            let far2 = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
            if far2 < best_far2 {
                best_far2 = far2;
                p = Probe { inside: p.inside, far: far2, along: t * long, round: before + t * long, long, looks: a[2], side: (b.first + i) as u32, on: [qx, qz] };
            }
        }
        if best_far2 < f32::MAX {
            p.far = best_far2.sqrt();
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
            // Thin aerial cables (<= 3 cm radius) are rendered as 2.5 cm fine subcells at L0 (size == 1); at size >= 2
            // (20 cm+) they bloat into solid beams and cast coarse sawtooth shadows across streets.
            if cable && size > 1 { continue; }
            // A cell is in a rod when its middle is within the rod's radius, and never less than the 0.71 of a cell
            // that keeps a thin one whole at any slant. Added to the radius, it made a stop sign's plate a red box
            // 1 m across and 24 cm deep and every lamp's mast 38 cm thick (#450).
            let cable_rad = (r[6] as f32 / 10.0).min(0.18);
            let rad = if cable { cable_rad + size as f32 * 0.71 } else { (r[6] as f32 / 10.0).max(size as f32 * 0.71) };
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
    /// 0.6 m apart along it. Read once a column, a corniced front's cornice followed the lidar's returns up and
    /// down in teeth (#450); 17% of the corniced street edges in the panel's tiles have no surveyed eave.
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

    /// Whether `(x, z)` lies inside a surveyed building footprint or within `clear` cells of its exterior wall.
    fn in_building(&self, x: i32, z: i32, clear: f32) -> bool {
        self.building(x, z).is_some_and(|(_, q)| q.inside || q.far < clear)
    }

    /// Nearest off-road spot at street grade, clear of buildings, for relocating a road-standing fixture.
    /// Prefers PAVEMENT (up to 7.2 m); falls back to roadside GRASS/YARD (up to 4.8 m) for park roads without
    /// sidewalks. Insets 40 cm behind the edge so the mast clears the carriageway.
    fn off_road_spot(&self, ox: i32, oz: i32, base_y: i32) -> Option<(i32, i32, i32)> {
        // Exact 16-compass unit directions (no trig calls so wasm and native stay bit-identical).
        const DIRS: [(f32, f32); 16] = [
            (1.0, 0.0), (0.9238795, 0.38268343), (0.70710677, 0.70710677), (0.38268343, 0.9238795),
            (0.0, 1.0), (-0.38268343, 0.9238795), (-0.70710677, 0.70710677), (-0.9238795, 0.38268343),
            (-1.0, 0.0), (-0.9238795, -0.38268343), (-0.70710677, -0.70710677), (-0.38268343, -0.9238795),
            (0.0, -1.0), (0.38268343, -0.9238795), (0.70710677, -0.70710677), (0.9238795, -0.38268343),
        ];
        let valid = |x: i32, z: i32, want_pav: bool| -> bool {
            if self.cell(x, z).is_none() {
                return false;
            }
            let s = self.surface(x, z).0 & 7;
            let ok_surf = if want_pav { s == PAVEMENT } else { s == GRASS_HERE || s == YARD };
            ok_surf && (self.ground(x, z) - base_y).abs() <= 15 && !self.in_building(x, z, 4.0)
        };
        let mut best_pav: Option<(i32, i32, i32, f32, f32)> = None;
        let mut best_verge: Option<(i32, i32, i32, f32, f32)> = None;
        for rad in (4..=72).step_by(4) {
            for &(ux, uz) in &DIRS {
                let nx = ox + (ux * rad as f32).round() as i32;
                let nz = oz + (uz * rad as f32).round() as i32;
                if best_pav.is_none() && valid(nx, nz, true) {
                    best_pav = Some((rad, nx, nz, ux, uz));
                } else if best_verge.is_none() && rad <= 48 && valid(nx, nz, false) {
                    best_verge = Some((rad, nx, nz, ux, uz));
                }
            }
            if best_pav.is_some() {
                break;
            }
        }
        let (nx, nz, ux, uz, want_pav) = match (best_pav, best_verge) {
            (Some(p), Some(v)) if p.0 <= v.0 + 12 => (p.1, p.2, p.3, p.4, true),
            (_, Some(v)) => (v.1, v.2, v.3, v.4, false),
            (Some(p), None) => (p.1, p.2, p.3, p.4, true),
            (None, None) => return None,
        };
        let sx = nx + (ux * 4.0).round() as i32;
        let sz = nz + (uz * 4.0).round() as i32;
        let (fx, fz) = if valid(sx, sz, want_pav) { (sx, sz) } else { (nx, nz) };
        Some((fx, self.ground(fx, fz), fz))
    }

    /// Relocate or remove standing street fixtures whose surveyed/OSM base landed on asphalt (ROAD).
    /// Handles street lamps (mast + bracket arm + luminaire head), stop signs (post + octagon bars),
    /// fire hydrants (body + nozzles + cap), utility poles (mast + crossarm), and sensed poles (mast + span wires).
    fn clean_road_fixtures(&mut self) {
        let orig = self.fixtures.clone();
        let n = orig.len();
        let mut keep = vec![true; n];

        let is_lamp_mast = |r: &[i32; 8]| {
            r[0] == r[3] && r[2] == r[5] && r[6] == 12 && material(r[7] as Kind) == STEEL && r[4] - r[1] >= 60
        };
        // Track already-off-road lamps so a snapped road lamp never stacks on top of an existing corner lamp.
        let mut kept_lamps: Vec<(i32, i32)> = orig
            .iter()
            .filter(|r| is_lamp_mast(r) && self.surface(r[0], r[2]).0 & 7 != ROAD)
            .map(|r| (r[0], r[2]))
            .collect();

        let shift_seg = |seg: &mut [i32; 8], dx: i32, dy: i32, dz: i32| {
            seg[0] += dx; seg[3] += dx;
            seg[1] += dy; seg[4] += dy;
            seg[2] += dz; seg[5] += dz;
        };

        for (i, r) in orig.iter().enumerate() {
            if r[0] != r[3] || r[2] != r[5] {
                continue;
            }
            let (ox, oy, oz) = (r[0], r[1], r[2]);
            let dh = r[4] - r[1];
            if dh < 6 || self.surface(ox, oz).0 & 7 != ROAD {
                continue;
            }

            if is_lamp_mast(r) {
                // Street lamp: mast (r=12, STEEL) + arm (r=5 from oy+79) + luminaire head (r=12, LAMP from arm tip).
                let arms: Vec<usize> = (0..n)
                    .filter(|&j| j != i && orig[j][6] == 5 && orig[j][0] == ox && orig[j][1] == oy + 79 && orig[j][2] == oz)
                    .collect();
                let mut heads: Vec<(usize, usize)> = Vec::new();
                for &j in &arms {
                    let a = orig[j];
                    for k in 0..n {
                        if orig[k][6] == 12 && material(orig[k][7] as Kind) == LAMP
                            && orig[k][0] == a[3] && orig[k][1] == a[4] && orig[k][2] == a[5]
                        {
                            heads.push((j, k));
                        }
                    }
                }
                let spot = self.off_road_spot(ox, oz, oy).filter(|&(fx, _, fz)| {
                    !kept_lamps.iter().any(|&(lx, lz)| (lx - fx) * (lx - fx) + (lz - fz) * (lz - fz) <= 25 * 25)
                });
                if let Some((fx, fy, fz)) = spot {
                    kept_lamps.push((fx, fz));
                    self.fixtures[i] = [fx, fy, fz, fx, fy + dh, fz, r[6], r[7]];
                    // Re-aim arm and luminaire back over the carriageway instead of into a building behind the sidewalk.
                    let (vx, vz) = ((ox - fx) as f32, (oz - fz) as f32);
                    let len = (vx * vx + vz * vz).sqrt().max(1.0);
                    let (ux, uz) = (vx / len, vz / len);
                    let (ax2, ay2, az2) = (fx + (13.0 * ux).round() as i32, fy + 85, fz + (13.0 * uz).round() as i32);
                    let (hx2, hz2) = (fx + (18.0 * ux).round() as i32, fz + (18.0 * uz).round() as i32);
                    for &j in &arms {
                        self.fixtures[j] = [fx, fy + 79, fz, ax2, ay2, az2, orig[j][6], orig[j][7]];
                    }
                    for &(_, k) in &heads {
                        self.fixtures[k] = [ax2, ay2, az2, hx2, ay2, hz2, orig[k][6], orig[k][7]];
                    }
                } else {
                    keep[i] = false;
                    for &j in &arms { keep[j] = false; }
                    for &(_, k) in &heads { keep[k] = false; }
                }
            } else if r[6] == 5 && dh >= 20 {
                // Stop sign: post (r=5) + horizontal octagon bars (r=5) around its top.
                let bars: Vec<usize> = (0..n)
                    .filter(|&j| {
                        j != i && orig[j][6] == 5
                            && (orig[j][0] != orig[j][3] || orig[j][2] != orig[j][5])
                            && ((orig[j][0] + orig[j][3]) / 2 - ox).abs() <= 4
                            && ((orig[j][2] + orig[j][5]) / 2 - oz).abs() <= 4
                            && orig[j][1] >= oy && orig[j][1] <= r[4] + 4
                    })
                    .collect();
                if let Some((fx, fy, fz)) = self.off_road_spot(ox, oz, oy) {
                    let (dx, dy, dz) = (fx - ox, fy - oy, fz - oz);
                    shift_seg(&mut self.fixtures[i], dx, dy, dz);
                    for j in bars { shift_seg(&mut self.fixtures[j], dx, dy, dz); }
                } else {
                    keep[i] = false;
                    for j in bars { keep[j] = false; }
                }
            } else if r[6] == 15 && dh == 7 {
                // Fire hydrant: body (r=15, dh=7) + cross nozzles (r=10 at oy+4) + cap (r=12 at oy+7..oy+8).
                let parts: Vec<usize> = (0..n)
                    .filter(|&j| {
                        j != i && (
                            (orig[j][6] == 10 && orig[j][1] == oy + 4 && orig[j][4] == oy + 4
                                && (orig[j][0] + orig[j][3]) / 2 == ox && orig[j][2] == oz && orig[j][5] == oz)
                            || (orig[j][6] == 12 && orig[j][0] == ox && orig[j][3] == ox
                                && orig[j][2] == oz && orig[j][5] == oz && orig[j][1] == oy + 7 && orig[j][4] == oy + 8)
                        )
                    })
                    .collect();
                if let Some((fx, fy, fz)) = self.off_road_spot(ox, oz, oy) {
                    let (dx, dy, dz) = (fx - ox, fy - oy, fz - oz);
                    shift_seg(&mut self.fixtures[i], dx, dy, dz);
                    for j in parts { shift_seg(&mut self.fixtures[j], dx, dy, dz); }
                } else {
                    keep[i] = false;
                    for j in parts { keep[j] = false; }
                }
            } else if r[6] == 16 && dh >= 60 {
                // Utility pole (OSM pole / metalPole): mast (r=16, dh=96) + crossarm (r=8 at oy+88).
                let cross: Vec<usize> = (0..n)
                    .filter(|&j| {
                        j != i && orig[j][6] == 8 && orig[j][1] == oy + 88 && orig[j][4] == oy + 88
                            && ((orig[j][0] + orig[j][3]) / 2 - ox).abs() <= 1
                            && ((orig[j][2] + orig[j][5]) / 2 - oz).abs() <= 1
                    })
                    .collect();
                if let Some((fx, fy, fz)) = self.off_road_spot(ox, oz, oy) {
                    let (dx, dy, dz) = (fx - ox, fy - oy, fz - oz);
                    shift_seg(&mut self.fixtures[i], dx, dy, dz);
                    for j in cross { shift_seg(&mut self.fixtures[j], dx, dy, dz); }
                } else {
                    keep[i] = false;
                    for j in cross { keep[j] = false; }
                }
            } else if r[6] == 14 && material(r[7] as Kind) == WOOD && dh >= 40 {
                // Sensed pole (r=14, WOOD) + attached overhead span wire endpoints (r=3 at top-4).
                let attach = (ox, r[4] - 4, oz);
                if let Some((fx, fy, fz)) = self.off_road_spot(ox, oz, oy) {
                    let (dx, dy, dz) = (fx - ox, fy - oy, fz - oz);
                    shift_seg(&mut self.fixtures[i], dx, dy, dz);
                    for j in 0..n {
                        if orig[j][6] == 3 {
                            if (orig[j][0], orig[j][1], orig[j][2]) == attach {
                                self.fixtures[j][0] += dx;
                                self.fixtures[j][1] += dy;
                                self.fixtures[j][2] += dz;
                            }
                            if (orig[j][3], orig[j][4], orig[j][5]) == attach {
                                self.fixtures[j][3] += dx;
                                self.fixtures[j][4] += dy;
                                self.fixtures[j][5] += dz;
                            }
                        }
                    }
                } else {
                    keep[i] = false;
                    for j in 0..n {
                        if orig[j][6] == 3
                            && ((orig[j][0], orig[j][1], orig[j][2]) == attach
                                || (orig[j][3], orig[j][4], orig[j][5]) == attach)
                        {
                            keep[j] = false;
                        }
                    }
                }
            }
        }

        let mut idx = 0usize;
        self.fixtures.retain(|_| {
            let k = keep[idx];
            idx += 1;
            k
        });
    }
}

#[derive(Clone, Copy)]
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
fn front(b: &Building, p: &Probe, up: i32, top: i32, over_ground: i32, deep: f32, size: i32, pitched: bool) -> Kind {
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
    // Place the entry beside the garage, recessed cleanly inside trim jambs & lintels; never fall through to cut a
    // Floor-0 window straight across the top of a garage door or front entry door (#60).
    if detail != 0 && over_ground < storey {
        let entry = (p.long * 0.22).clamp(7.0, 18.0);
        if detail & 8 != 0 && (p.along - entry).abs() <= 5.5 {
            if (4..=27).contains(&over_ground) {
                let jamb = (p.along - entry).abs() > 4.2;
                if over_ground == 27 || jamb {
                    return b.trim;
                }
                if deep < 1.1 && size == 1 {
                    return 0;
                }
                return if over_ground > 21 { glass } else { kind(WOOD, grey(9)) };
            }
            return b.wall;
        }
        let half_g = (p.long * 0.23).min(19.0);
        if detail & 4 != 0 && (p.along - p.long * 0.66).abs() <= half_g {
            if over_ground <= 23 {
                let jamb = (p.along - p.long * 0.66).abs() > half_g - 1.2;
                if over_ground == 23 || jamb {
                    return b.trim;
                }
                if deep < 1.0 && size == 1 {
                    return 0;
                }
                return if over_ground % 5 == 0 { b.trim } else { kind(WOOD, grey(5)) };
            }
            return b.wall;
        }
        // On a residential garage+entry ground floor, never squeeze a broken narrow window sliver into the small
        // pier between the entry door and garage door (or beside them when < 1.2 m of wall remains) (#60).
        if detail & 12 == 12 {
            let lo = (entry - 5.5).min(p.long * 0.66 - half_g) - 4.0;
            let hi = (entry + 5.5).max(p.long * 0.66 + half_g) + 4.0;
            if p.along >= lo && p.along <= hi {
                return b.wall;
            }
        }
    }
    // The cornice: the wall's last cells are trim (slim 1-cell verge on pitched gables so gable slopes stay clean).
    if size <= 2 && up >= top - if pitched { 1 } else { 3 } {
        return b.trim;
    }
    // A side that looks on nothing (a neighbour's wall, a light well) or is too short for a window is plain.
    if p.looks & 1 == 0 || (p.long < module && p.looks & 2 == 0) {
        return b.wall;
    }
    let (floor, fy) = (up.div_euclid(storey), up.rem_euclid(storey));
    // A surveyed faceted bay edge (0.8 m to 1 module wide on a street front) centers one sash window cleanly on that
    // facet rather than risking falling entirely inside a solid pier between continuous ring bays (#60).
    let facet = p.looks & 2 != 0 && p.long >= 8.0 && p.long < module;
    let count = (p.long / module).floor().max(1.0);
    let (bay, mu, bay_half_cap) = if facet {
        (0, p.along - p.long * 0.5, (p.long * 0.5 - 2.0).max(2.0))
    } else {
        // A curved wall made of tiny < 0.8 m chords continues its spacing around the ring.
        let within = if p.long < module { p.round.rem_euclid(module) } else { p.along - (p.long - count * module) / 2.0 };
        if within < 0.0 || within >= count * module {
            return b.wall;
        }
        ((within / module) as i32, within % module - module / 2.0, module / 2.0 - 2.0)
    };
    let chance = hash(bay, p.side as i32, b.seed);
    // What the opening is: its half width, its foot and its head, and whether it is a door.
    let (mut half, foot, head, door) = if floor == 0 && p.looks & 2 != 0 && over_ground < storey && storey <= 60 {
        if b.ground_floor == 2 || b.ground_floor == 3 {
            (module / 2.0 - 2.0, 0, if b.ground_floor == 3 { storey - 3 } else { 24 }, 2)
        } else if b.ground_floor == 4 {
            (module / 2.0 - 4.0, 0, storey - 4, 3)
        } else if b.ground_floor == 5 {
            (module / 2.0 - 2.0, 0, storey - 3, 4)
        } else if b.ground_floor == 1 || !b.home {
            (module / 2.0 - 3.0, 5, storey - 7, 0) // a shop's window
        } else if facet {
            (bay_half_cap, 9, storey - 6, 0) // ground-level bay facet gets a clean window, not a cut-off garage
        } else if chance % 3 == 0 {
            (module / 2.0 - 4.0, 0, 23, 2) // a garage
        } else if chance % 3 == 1 {
            (5.0, 0, 22, 1) // the way in
        } else {
            (6.0, 10, storey - 6, 0)
        }
    } else if b.home {
        // A home's front is mostly glass: its window spans the bay but for a pier of 0.6 m, in sashes (#450).
        (measured_half(b, 8, storey - 5).unwrap_or((module / 2.0 - 3.0).max(6.0)), 8, storey - 5, 0)
    } else if storey > 60 {
        (4.5, 14, storey - 12, 0) // a church's windows: tall and narrow
    } else {
        (measured_half(b, 8, storey - 6).unwrap_or((module / 2.0 - 5.0).min(8.0)), 8, storey - 6, 0)
    };
    if facet {
        half = half.min(bay_half_cap);
    }
    // Clamp the top floor's window head cleanly below the cornice instead of deleting the entire floor of windows
    // whenever a 2-story house sits slightly under `2 * storey` tall (#60: fixed blank 2nd floors across Outer Sunset).
    let max_fy = top - 4 - floor * storey;
    let eff_head = head.min(max_fy);
    let eff_foot = if door == 0 && floor > 0 && eff_head < foot + 10 {
        (eff_head - 14).max(3)
    } else {
        foot
    };
    let has_opening = eff_head - eff_foot >= if door == 0 { 8 } else { 14 };
    // A belt at each floor and a sill under each window, where cells are fine enough to show them.
    if size == 1 && deep < 1.0 {
        if fy == 0 && floor > 0 && !b.home {
            return b.trim;
        }
        if has_opening && door == 0 && fy == eff_foot - 1 && mu.abs() < half + 1.0 && over_ground + (fy - eff_foot) >= 2 {
            return b.trim;
        }
    }
    if !has_opening || mu.abs() >= half || fy < eff_foot || fy >= eff_head || (over_ground + (fy - eff_foot) < 3 && door == 0) {
        return b.wall;
    }
    match door {
        4 => if deep < 2.0 * size as f32 { 0 } else { dark },
        3 => if deep < 1.0 { 0 } else { glass },
        2 => if deep < 1.0 && size == 1 { 0 } else { kind(WOOD, grey(4 + (chance >> 4) as u8 % 6)) },
        1 => if deep < 1.0 && size == 1 { 0 } else if fy >= eff_head - 4 { glass } else { kind(WOOD, colour((chance >> 6) as u8 % 24, 5 + (chance >> 12) as u8 % 2)) },
        // A window sits a cell back in its wall, with the room dark behind it.
        _ if size > 1 => if deep < size as f32 { glass } else { dark },
        _ => if deep < 1.0 { 0 } else if deep < 2.0 {
            // Sashes of about 0.9 m: a narrow window is two, divided in the middle.
            let sashes = (2.0 * half / 9.0).round().max(2.0);
            let across = (mu + half) / (2.0 * half) * sashes;
            let mullion = (across - across.round()).abs() * 2.0 * half / sashes < 0.6 && across.round() > 0.0 && across.round() < sashes;
            if mullion || (fy - eff_foot) == (eff_head - eff_foot) / 2 { b.trim } else { glass }
        } else { dark },
    }
}

/// An upper window's half width where the photographs measured the building's glass share: the bay's glass over a
/// storey of `foot` to `head` is that share of the bay's wall, with a pier of at least 0.3 m either side.
fn measured_half(b: &Building, foot: i32, head: i32) -> Option<f32> {
    let share = b.glass?;
    let module = b.module as f32;
    Some((share * module * b.storey as f32 / (2.0 * (head - foot).max(1) as f32)).clamp(2.0, module / 2.0 - 3.0))
}

/// What a column of the Bay holds, in one pack's knowledge: asked cell by cell with `kind_at`.
#[derive(Clone, Copy)]
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
        // Cap aerial cables to 1.8 cm radius (1-2 fine 2.5 cm subcells, guaranteed gap-free along any diagonal)
        // so overhead trolley/utility wires stay slim rather than rendering as thick 7.5 cm black pipes (#129).
        let radius2 = (r[6] as f32 / 10.0).min(0.18).powi(2);
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

struct OwnedColumn {
    g: i32,
    road_top4: Option<i32>,
    ground: Kind,
    kerb: i32,
    what: OwnedWhat,
    fixtures: Vec<FixtureSpan>,
    heroes: [Option<(Hero, f32, f32)>; 2],
    hero_n: u8,
}

enum OwnedWhat {
    Open,
    In(usize, usize, Probe, i32, u8, bool, i32, i32, f32),
    By(usize, usize, Probe, i32, bool),
    Crown { foot: i32, top: i32, trunk: Option<i32>, tint: u8, edge: f32 },
    Mass(i32, u8, Kind),
}

impl OwnedColumn {
    #[inline]
    fn as_column<'a>(&'a self, packs: &'a [Pack]) -> Column<'a> {
        let what = match self.what {
            OwnedWhat::Open => What::Open,
            OwnedWhat::In(pi, bi, probe, roof, tint, pitched, wall_top, step_below, step_far) =>
                What::In(&packs[pi].buildings[bi], probe, roof, tint, pitched, wall_top, step_below, step_far),
            OwnedWhat::By(pi, bi, probe, roof, stepped) => What::By(&packs[pi].buildings[bi], probe, roof, stepped),
            OwnedWhat::Crown { foot, top, trunk, tint, edge } => What::Crown { foot, top, trunk, tint, edge },
            OwnedWhat::Mass(roof, tint, wall) => What::Mass(roof, tint, wall),
        };
        Column {
            g: self.g,
            road_top4: self.road_top4,
            ground: self.ground,
            kerb: self.kerb,
            what,
            fixtures: Vec::new(),
            heroes: self.heroes,
            hero_n: self.hero_n,
        }
    }
}

#[inline]
fn heroes_from_slice(heroes: &[Hero], x: i32, z: i32, size: i32) -> ([Option<(Hero, f32, f32)>; 2], u8) {
    if heroes.is_empty() {
        return ([None, None], 0);
    }
    let mut out = [None, None];
    let mut n = 0u8;
    let half = if size == 1 { 0.5 } else { size as f32 * 0.5 };
    for h in heroes {
        if x < h.low[0] || z < h.low[1] || x > h.high[0] || z > h.high[1] {
            continue;
        }
        let (u, w) = h.local(x, z, half);
        let Some(r) = heroes::reach(h.sort) else { continue };
        if u >= r[0] && u < r[3] && w >= r[2] && w < r[5] {
            out[n as usize] = Some((*h, u, w));
            n += 1;
            if n == 2 {
                break;
            }
        }
    }
    (out, n)
}

fn owned_column(packs: &[Pack], pack_indices: &[usize], heroes_slice: &[Hero], marks: &[[i32; 4]], x: i32, z: i32, size: i32, least: i32) -> OwnedColumn {
    let (heroes, hero_n) = heroes_from_slice(heroes_slice, x, z, size);
    let picked = pack_indices.iter().copied().find(|&pi| packs[pi].gstep >= least && packs[pi].holds(x, z))
        .or_else(|| pack_indices.iter().copied().find(|&pi| packs[pi].holds(x, z)));
    let Some(pi) = picked else {
        return OwnedColumn { g: BED, road_top4: None, ground: kind(SAND, OWN), kerb: 0, fixtures: Vec::new(), what: OwnedWhat::Open, heroes, hero_n };
    };
    let p = &packs[pi];
    let tread = tread_ground(&heroes[..hero_n as usize]);
    let ground_height = tread.unwrap_or_else(|| p.ground_height(x, z));
    let g = (ground_height + 0.5).floor() as i32;
    let (mut class, tint) = p.surface(x, z);
    if class & 7 == ROAD && heroes[..hero_n as usize].iter().flatten().any(|(h, u, w)| {
        h.sort == heroes::GOLDEN_GATE && heroes::draped_north_highway(*u, *w, ground_height * 0.1)
    }) {
        class = GRASS_HERE;
    }
    let graphed = class & 7 == ROAD && marks.iter().any(|c| x >= c[0] && z >= c[1] && x < c[2] && z < c[3]);
    if graphed { class &= !96; }
    let road_grey = |t: u8| 8 + ((t.clamp(4, 11) - 4) * 4 + 3) / 7;
    let asphalt = if class & 159 == 128 && (1..=15).contains(&tint) {
        Some(road_grey(tint))
    } else if class & 31 == CANOPY && measured_foliage(tint) && !p.under_leaf_road.is_empty() {
        p.cell(x, z).map(|i| {
            let w = p.tw as usize;
            road_grey(p.under_leaf_road[(i / w / 16) * w.div_ceil(16) + (i % w) / 16])
        })
    } else { None };
    let (ground, kerb) = match class & 7 {
        _ if tread.is_some() => (kind(CONCRETE, colour(2, 7)), 0),
        ROAD if class & 64 != 0 => (kind(STEEL, grey(8)), 0),
        ROAD if class & 32 != 0 => (kind(CONCRETE, grey(1)), 0),
        ROAD => (kind(ASPHALT, asphalt.unwrap_or(OWN)), 0),
        PAVEMENT => (kind(CONCRETE, grey(5)), if class & 32 != 0 { 0 } else if class & 128 != 0 { 2 } else { 1 }),
        GRASS_HERE => (kind(GRASS, OWN), 0),
        WATER_HERE if g > 4 => (kind(WATER, colour(13, 5)), 0),
        WATER_HERE => (kind(SAND, OWN), 0),
        YARD => (kind(CONCRETE, tint), 0),
        _ => (kind(EARTH, OWN), 0),
    };
    let what = match p.building_idx(x, z) {
        Some((bi, probe)) if probe.inside => {
            let b = &p.buildings[bi];
            let raster = p.roof_raster(b, x, z);
            let mut pitched = false;
            let (roof, wall_top) = if probe.looks & 128 != 0 && probe.far < 15.0 {
                let eave = (probe.looks >> 8) as i16 as i32;
                let blend = ((probe.far - 5.0) / 10.0).clamp(0.0, 1.0);
                let blended = (eave as f32 + (raster - eave) as f32 * blend).round() as i32;
                pitched = raster > eave + 6;
                let r = if probe.looks >> 24 & 2 != 0 && !pitched { blended.min(eave + 3) } else { blended };
                (r, eave)
            } else if probe.looks >> 24 & 2 != 0 && probe.far < 15.0 {
                let (far, cx, cz) = (probe.far.max(0.01), x as f32 + 0.5, z as f32 + 0.5);
                match p.eave_near(probe.on, [(cx - probe.on[0]) / far, (cz - probe.on[1]) / far]) {
                    Some(eave) => {
                        // Blend from the smoothed eave at the wall face (`far <= 5`) into the roof raster over
                        // `far = 5..15`, matching surveyed eaves so perimeter lidar dropouts never carve mid-wall
                        // notches with floating white cornice/roofing strips (#129).
                        let blend = ((probe.far - 5.0) / 10.0).clamp(0.0, 1.0);
                        let blended = (eave as f32 + (raster - eave) as f32 * blend).round() as i32;
                        pitched = raster > eave + 6;
                        (if pitched { blended } else { blended.min(eave + 3) }, eave)
                    }
                    None => (raster, b.eave_med),
                }
            } else {
                let eave = if probe.looks & 128 != 0 { (probe.looks >> 8) as i16 as i32 } else { b.eave_med };
                (raster, eave)
            };
            let roof = roof.max(g + 22);
            let (mut step_below, mut step_far) = (i32::MAX, 1e9f32);
            if probe.far >= 3.0 * size as f32 && size <= 4 && probe.looks & 2 != 0 {
                let (cx, cz) = (x as f32 + 0.5, z as f32 + 0.5);
                let far = probe.far.max(0.01);
                let (ox, oz) = ((probe.on[0] - cx) / far, (probe.on[1] - cz) / far);
                let d1 = 1.4 * size as f32;
                let d2 = 2.6 * size as f32;
                let d3 = 3.8 * size as f32;
                let f1 = p.top((cx + ox * d1).floor() as i32, (cz + oz * d1).floor() as i32);
                let f2 = p.top((cx + ox * d2).floor() as i32, (cz + oz * d2).floor() as i32);
                let f3 = p.top((cx + ox * d3).floor() as i32, (cz + oz * d3).floor() as i32);
                if let Some(low) = f1.filter(|&fr| roof > fr + 14) {
                    step_below = low;
                    step_far = if size == 1 { 0.5 } else { 1.5 };
                } else if let Some(low) = f2.filter(|&fr| roof > fr + 14) {
                    step_below = low;
                    step_far = 1.6;
                } else if let Some(low) = f3.filter(|&fr| roof > fr + 14) {
                    step_below = low;
                    step_far = 2.5;
                }
            }
            OwnedWhat::In(pi, bi, probe, roof, tint, pitched, wall_top, step_below, step_far)
        }
        Some((bi, probe)) if size <= 2 && probe.looks & 2 != 0 => {
            let b = &p.buildings[bi];
            let (dx, dz) = (probe.on[0] - (x as f32 + 0.5), probe.on[1] - (z as f32 + 0.5));
            let far = probe.far.max(0.01);
            let (ux, uz) = (dx / far, dz / far);
            let (ix, iz) = ((probe.on[0] + ux * 4.0) as i32, (probe.on[1] + uz * 4.0) as i32);
            let eave = if probe.looks & 128 != 0 {
                Some((probe.looks >> 8) as i16 as i32)
            } else if probe.looks >> 24 & 2 != 0 {
                p.eave_near(probe.on, [ux, uz]).or_else(|| p.top(ix, iz))
            } else {
                p.top(ix, iz)
            };
            match eave {
                Some(roof) => {
                    let b1 = p.top((probe.on[0] + ux * 16.0) as i32, (probe.on[1] + uz * 16.0) as i32);
                    let b2 = p.top((probe.on[0] + ux * 36.0) as i32, (probe.on[1] + uz * 36.0) as i32);
                    let behind = b1.into_iter().chain(b2).max();
                    let stepped = behind.is_some_and(|rb| rb > roof + 8) || (roof - b.base) < 44;
                    OwnedWhat::By(pi, bi, probe, roof, stepped)
                }
                None => OwnedWhat::Open,
            }
        }
        _ if class & BUILT != 0 => match (p.top(x, z), p.cell(x, z)) {
            (Some(roof), Some(here)) if roof > g => OwnedWhat::Mass(roof, tint, match p.walls.get(here) { Some(&w) if w != 0 => w as Kind, _ => kind(PLASTER, OWN) }),
            _ => OwnedWhat::Open,
        },
        _ if class & CANOPY != 0 => match p.top(x, z) {
            Some(t) if t > g + 4 => {
                let tall = t - g;
                let ragged = (hash(x >> 2, z >> 2, 7) % 7) as i32;
                let on_road = class & 7 == ROAD;
                match p.trunk(x, z) {
                    Some((_, stem)) if tall >= 28 && heroes.iter().flatten().any(|(h, _, _)|
                        h.sort == heroes::CONSERVATORY && {
                            let (u, w) = h.local(stem[0], stem[1], 0.0);
                            heroes::valley_palm_stem(u, w)
                        }) => OwnedWhat::Open,
                    Some((far, trunk)) if tall >= 28 => {
                        let high = (trunk[2] - g).max(tall);
                        let measured = trunk[3] >> 8;
                        let rim = if measured > 0 { measured.min(REACH) as f32 } else { (high as f32 * 0.4).clamp(14.0, REACH as f32) };
                        if far > rim + 4.0 {
                            OwnedWhat::Open
                        } else {
                            let deep = (high as f32 * 0.55).clamp(16.0, 90.0).min((rim * 2.2).max(20.0));
                            let middle = g as f32 + high as f32 - deep / 2.0;
                            let under = if far < rim { middle - deep / 2.0 * (1.0 - (far / rim) * (far / rim)).sqrt() } else { (t as f32 - 22.0).max(middle) };
                            let min_foot = if on_road { g + 32 } else { g + 18 };
                            let foot = (under as i32 + ragged).max(min_foot).min(t - 3);
                            let crown = ((g as f32 + high as f32 - deep) as i32).max(g + 18);
                            OwnedWhat::Crown { foot, top: t, trunk: (!on_road && far <= (trunk[3] & 255) as f32 + 0.5).then(|| crown + (t - crown) / 3), tint, edge: (far / rim.max(1.0)).min(1.0) }
                        }
                    }
                    _ if tall < 28 && !on_road => OwnedWhat::Crown { foot: g + 1, top: t, trunk: None, tint, edge: 0.6 },
                    _ => OwnedWhat::Open,
                }
            }
            _ => OwnedWhat::Open,
        },
        _ => OwnedWhat::Open,
    };
    let ramped = size == 1 && class & 7 != WATER_HERE && !matches!(what, OwnedWhat::In(..) | OwnedWhat::Mass(..));
    let road_top4 = ramped.then(|| ((ground_height + 1.0 + kerb as f32) * 4.0).round() as i32);
    OwnedColumn { g, road_top4, ground, kerb, fixtures: p.fixture_spans(x, z, size), what, heroes, hero_n }
}

/// Fast single-cell kind query for unedited Bay columns (#73). Uses a 512-entry direct-mapped cache for simple open columns.
pub fn kind_single(x: i32, y: i32, z: i32) -> Kind {
    let epoch = PACK_GEN.get();
    let idx = ((x.wrapping_mul(73856093) ^ z.wrapping_mul(19349663)) as usize) & 511;
    let cached = SOLID_CACHE.with_borrow(|cache| {
        let e = cache[idx];
        (e.epoch == epoch && e.x == x && e.z == z && y < e.ceil).then_some(e)
    });
    if let Some(e) = cached {
        return if y <= e.g {
            if y >= e.g - 6 { e.ground } else { kind(EARTH, OWN) }
        } else if y <= e.top {
            e.ground
        } else {
            0
        };
    }
    PACKS.with_borrow(|packs| {
        let c = column(packs, x, z, 1);
        if matches!(c.what, What::Open) && c.hero_n == 0 {
            let ceil = c.fixtures.iter().map(|f| f.low).min().unwrap_or(i32::MAX);
            SOLID_CACHE.with_borrow_mut(|cache| {
                cache[idx] = SolidEntry { x, z, epoch, top: c.g + c.kerb, g: c.g, ground: c.ground, ceil };
            });
        }
        kind_at(&c, x, y, z, 1)
    })
}

/// Fast single-cell solidity query for unedited Bay columns (#73), used by `Ground::solid` so moving cars never build 262k-cell sectors.
#[inline]
pub fn solid_single(x: i32, y: i32, z: i32) -> bool {
    let epoch = PACK_GEN.get();
    let idx = ((x.wrapping_mul(73856093) ^ z.wrapping_mul(19349663)) as usize) & 511;
    let cached = SOLID_CACHE.with_borrow(|cache| {
        let e = cache[idx];
        (e.epoch == epoch && e.x == x && e.z == z && y < e.ceil).then_some(e)
    });
    if let Some(e) = cached {
        return y <= e.top;
    }
    kind_single(x, y, z) != 0
}

/// Fast single-column top solid cell + 1 at or below `y` within `depth` cells (#73), or `i32::MIN` if none.
pub fn under(x: i32, y: i32, z: i32, depth: i32) -> i32 {
    let epoch = PACK_GEN.get();
    let idx = ((x.wrapping_mul(73856093) ^ z.wrapping_mul(19349663)) as usize) & 511;
    let cached = SOLID_CACHE.with_borrow(|cache| {
        let e = cache[idx];
        (e.epoch == epoch && e.x == x && e.z == z && y < e.ceil).then_some(e)
    });
    if let Some(e) = cached {
        return if y <= e.top {
            y + 1
        } else if e.top > y - depth {
            e.top + 1
        } else {
            i32::MIN
        };
    }
    PACKS.with_borrow(|packs| {
        let c = column(packs, x, z, 1);
        if matches!(c.what, What::Open) && c.hero_n == 0 {
            let top = c.g + c.kerb;
            let ceil = c.fixtures.iter().map(|f| f.low).min().unwrap_or(i32::MAX);
            SOLID_CACHE.with_borrow_mut(|cache| {
                cache[idx] = SolidEntry { x, z, epoch, top, g: c.g, ground: c.ground, ceil };
            });
            if y < ceil {
                return if y <= top { y + 1 } else if top > y - depth { top + 1 } else { i32::MIN };
            }
        }
        let end = y - depth;
        let mut at = y;
        while at > end {
            if kind_at(&c, x, at, z, 1) != 0 {
                return at + 1;
            }
            at -= 1;
        }
        i32::MIN
    })
}

/// What a column of the Bay holds, in one pack's knowledge: asked cell by cell with `kind_at`.
struct Column<'a> {
    g: i32,
    road_top4: Option<i32>,
    /// The ground's top cell's kind, and how many cells of it stand over the ground (a pavement's kerb).
    ground: Kind,
    kerb: i32,
    what: What<'a>,
    fixtures: Vec<FixtureSpan>,
    /// Up to two overlapping landmarks this column is in (e.g. Fort Point under the Golden Gate arch), and each
    /// column's middle in its frame (u, w, in metres).
    heroes: [Option<(Hero, f32, f32)>; 2],
    hero_n: u8,
}

enum What<'a> {
    Open,
    /// In a building: its roof's cell, colour, whether its roof rises into a pitched gable behind the front,
    /// its clean wall-top eave height (above which interior roof slopes are painted `ROOFING` rather than stucco),
    /// and (for stepped-back upper walls behind a lower wing) the lower roof height and depth into the step.
    In(&'a Building, Probe, i32, u8, bool, i32, i32, f32),
    /// Just outside one, where its bays and cornice stand: how high its wall is there, and whether a pitched gable
    /// or taller upper wall rises directly behind it.
    By(&'a Building, Probe, i32, bool),
    /// Leaves from here up to there, and a trunk up to so high if one stands in this column.
    Crown { foot: i32, top: i32, trunk: Option<i32>, tint: u8, edge: f32 },
    /// A building seen from far, from a pack with no outlines: its roof's cell and colour, and its wall.
    Mass(i32, u8, Kind),
}

/// The landmarks a column is in (up to two overlapping), where the world's cells are fine enough to show them.
fn heroes_at(x: i32, z: i32, size: i32) -> ([Option<(Hero, f32, f32)>; 2], u8) {
    if size > heroes::REALM_MOST || !LANDMARKS.get() {
        return ([None, None], 0);
    }
    HEROES.with_borrow(|all| {
        let mut out = [None, None];
        let mut n = 0u8;
        let half = if size == 1 { 0.5 } else { size as f32 * 0.5 };
        for h in all.iter().filter(|h| x >= h.low[0] && z >= h.low[1] && x <= h.high[0] && z <= h.high[1]) {
            let (u, w) = h.local(x, z, half);
            if let Some(r) = heroes::reach(h.sort) {
                if u >= r[0] && u < r[3] && w >= r[2] && w < r[5] {
                    out[n as usize] = Some((*h, u, w));
                    n += 1;
                    if n == 2 {
                        break;
                    }
                }
            }
        }
        (out, n)
    })
}

/// The top solid cell of a measured stair tread. Its upper face is the walking height.
fn tread_ground(places: &[Option<(Hero, f32, f32)>]) -> Option<f32> {
    places.iter().flatten().find_map(|(h, u, w)| {
        if h.sort != heroes::CONSERVATORY { return None; }
        heroes::conservatory_stairs(*u, *w).map(|height| h.at[1] as f32 + height * 10.0 - 1.0)
    })
}

fn column<'a>(packs: &'a [Pack], x: i32, z: i32, size: i32) -> Column<'a> {
    let (heroes, hero_n) = heroes_at(x, z, size);
    let Some(p) = pick(packs, x, z, size) else {
        return Column { g: BED, road_top4: None, ground: kind(SAND, OWN), kerb: 0, fixtures: Vec::new(), what: What::Open, heroes, hero_n };
    };
    let tread = tread_ground(&heroes[..hero_n as usize]);
    let ground_height = tread.unwrap_or_else(|| p.ground_height(x, z));
    let g = (ground_height + 0.5).floor() as i32;
    let (mut class, tint) = p.surface(x, z);
    if class & 7 == ROAD && heroes[..hero_n as usize].iter().flatten().any(|(h, u, w)| {
        h.sort == heroes::GOLDEN_GATE && heroes::draped_north_highway(*u, *w, ground_height * 0.1)
    }) {
        class = GRASS_HERE;
    }
    // Where the graph's marks are drawn, the bake's paint and rails are not (`Marks`).
    let graphed = class & 7 == ROAD && marked_place(x, z);
    if graphed { class &= !96; }
    // A measured asphalt's byte is the aerial's daylight brightness of the road as a step of the palette's greys
    // (bay/surface_detail.py: 4 the palest to 11 the darkest). The aerial is stretched bright: read as the road's own
    // colour it made every street as pale as its pavement (#450). As colour, the same range runs from the grey of worn
    // asphalt (8) to fresh (12), so the street photographs' road against pavement holds (sf/street_checks.py).
    let road_grey = |t: u8| 8 + ((t.clamp(4, 11) - 4) * 4 + 3) / 7;
    let asphalt = if class & 159 == 128 && (1..=15).contains(&tint) {
        Some(road_grey(tint))
    } else if class & 31 == CANOPY && measured_foliage(tint) && !p.under_leaf_road.is_empty() {
        p.cell(x,z).map(|i| {
            let w = p.tw as usize;
            road_grey(p.under_leaf_road[(i / w / 16) * w.div_ceil(16) + (i % w) / 16])
        })
    } else { None };
    let (ground, kerb) = match class & 7 {
        _ if tread.is_some() => (kind(CONCRETE, colour(2, 7)), 0),
        ROAD if class & 64 != 0 => (kind(STEEL, grey(8)), 0),
        ROAD if class & 32 != 0 => (kind(CONCRETE, grey(1)), 0),
        ROAD => (kind(ASPHALT, asphalt.unwrap_or(OWN)), 0),
        // Pavement a grey step under the concrete's own: in sun it read brighter than the street photographs' (#450).
        PAVEMENT => (kind(CONCRETE, grey(5)), if class & 32 != 0 { 0 } else if class & 128 != 0 { 2 } else { 1 }),
        GRASS_HERE => (kind(GRASS, OWN), 0),
        // Elevated inland water (park ponds, lagoons, lakes, rivers): render as real water so it ripples and reflects (#60).
        WATER_HERE if g > 4 => (kind(WATER, colour(13, 5)), 0),
        WATER_HERE => (kind(SAND, OWN), 0),
        YARD => (kind(CONCRETE, tint), 0),
        _ => (kind(EARTH, OWN), 0),
    };
    let what = match p.building(x, z) {
        Some((b, probe)) if probe.inside => {
            let raster = p.roof_raster(b, x, z);
            // Glass and the vertical wall can be the highest lidar return at its edge.
            // Give a surveyed plane one eave; blend into the roof over the next metre.
            // On pitched gables where lidar rises > 0.6 m above the eave, keep the gable slope intact instead of
            // decapitating it flat at `eave + 3` (#60).
            let mut pitched = false;
            let (roof, wall_top) = if probe.looks & 128 != 0 && probe.far < 15.0 {
                let eave = (probe.looks >> 8) as i16 as i32;
                let blend = ((probe.far - 5.0) / 10.0).clamp(0.0, 1.0);
                let blended = (eave as f32 + (raster - eave) as f32 * blend).round() as i32;
                pitched = raster > eave + 6;
                let r = if probe.looks >> 24 & 2 != 0 && !pitched { blended.min(eave + 3) } else { blended };
                (r, eave)
            } else if probe.looks >> 24 & 2 != 0 && probe.far < 15.0 {
                let (far, cx, cz) = (probe.far.max(0.01), x as f32 + 0.5, z as f32 + 0.5);
                match p.eave_near(probe.on, [(cx - probe.on[0]) / far, (cz - probe.on[1]) / far]) {
                    Some(eave) => {
                        // Blend from the smoothed eave at the wall face (`far <= 5`) into the roof raster over
                        // `far = 5..15`, matching surveyed eaves so perimeter lidar dropouts never carve mid-wall
                        // notches with floating white cornice/roofing strips (#129).
                        let blend = ((probe.far - 5.0) / 10.0).clamp(0.0, 1.0);
                        let blended = (eave as f32 + (raster - eave) as f32 * blend).round() as i32;
                        pitched = raster > eave + 6;
                        (if pitched { blended } else { blended.min(eave + 3) }, eave)
                    }
                    None => (raster, b.eave_med),
                }
            } else {
                let eave = if probe.looks & 128 != 0 { (probe.looks >> 8) as i16 as i32 } else { b.eave_med };
                (raster, eave)
            };
            let roof = roof.max(g + 22);
            // Exposed stepped-back upper walls (e.g. a genuine 2nd storey rising behind a lower 1-storey wing) sit past
            // `probe.far >= 3*size`; probe 3 depths so recessed glass gets real dark interior backing instead of stucco (#60).
            let (mut step_below, mut step_far) = (i32::MAX, 1e9f32);
            if probe.far >= 3.0 * size as f32 && size <= 4 && probe.looks & 2 != 0 {
                let (cx, cz) = (x as f32 + 0.5, z as f32 + 0.5);
                let far = probe.far.max(0.01);
                let (ox, oz) = ((probe.on[0] - cx) / far, (probe.on[1] - cz) / far);
                let d1 = 1.4 * size as f32;
                let d2 = 2.6 * size as f32;
                let d3 = 3.8 * size as f32;
                let f1 = p.top((cx + ox * d1).floor() as i32, (cz + oz * d1).floor() as i32);
                let f2 = p.top((cx + ox * d2).floor() as i32, (cz + oz * d2).floor() as i32);
                let f3 = p.top((cx + ox * d3).floor() as i32, (cz + oz * d3).floor() as i32);
                if let Some(low) = f1.filter(|&fr| roof > fr + 14) {
                    step_below = low;
                    step_far = if size == 1 { 0.5 } else { 1.5 };
                } else if let Some(low) = f2.filter(|&fr| roof > fr + 14) {
                    step_below = low;
                    step_far = 1.6;
                } else if let Some(low) = f3.filter(|&fr| roof > fr + 14) {
                    step_below = low;
                    step_far = 2.5;
                }
            }
            What::In(b, probe, roof, tint, pitched, wall_top, step_below, step_far)
        }
        Some((b, probe)) if size <= 2 && probe.looks & 2 != 0 => {
            // The wall's height where this column is nearest it: a little way in from the outline.
            let (dx, dz) = (probe.on[0] - (x as f32 + 0.5), probe.on[1] - (z as f32 + 0.5));
            let far = probe.far.max(0.01);
            let (ux, uz) = (dx / far, dz / far);
            let (ix, iz) = ((probe.on[0] + ux * 4.0) as i32, (probe.on[1] + uz * 4.0) as i32);
            let eave = if probe.looks & 128 != 0 {
                Some((probe.looks >> 8) as i16 as i32)
            } else if probe.looks >> 24 & 2 != 0 {
                p.eave_near(probe.on, [ux, uz]).or_else(|| p.top(ix, iz))
            } else {
                p.top(ix, iz)
            };
            match eave {
                Some(roof) => {
                    // Check deeper behind the front edge (1.6 m and 3.6 m inward): if the building rises > 0.8 m
                    // higher (a pitched gable or a taller upper storey behind a protruding front garage/porch),
                    // suppress heavy protruding cornice slabs that would otherwise float mid-wall (#60).
                    let b1 = p.top((probe.on[0] + ux * 16.0) as i32, (probe.on[1] + uz * 16.0) as i32);
                    let b2 = p.top((probe.on[0] + ux * 36.0) as i32, (probe.on[1] + uz * 36.0) as i32);
                    let behind = b1.into_iter().chain(b2).max();
                    let stepped = behind.is_some_and(|rb| rb > roof + 8) || (roof - b.base) < 44;
                    What::By(b, probe, roof, stepped)
                }
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
                let on_road = class & 7 == ROAD;
                match p.trunk(x, z) {
                    Some((_, stem)) if tall >= 28 && heroes.iter().flatten().any(|(h, _, _)|
                        h.sort == heroes::CONSERVATORY && {
                            let (u, w) = h.local(stem[0], stem[1], 0.0);
                            heroes::valley_palm_stem(u, w)
                        }) => What::Open,
                    // A tree: its crown is round underneath, deepest at the trunk and rising to its rim; past the
                    // rim what the lidar saw is a spray of leaves and no more.
                    Some((far, trunk)) if tall >= 28 => {
                        let high = (trunk[2] - g).max(tall);
                        let measured = trunk[3] >> 8;
                        let rim = if measured > 0 { measured.min(REACH) as f32 } else { (high as f32 * 0.4).clamp(14.0, REACH as f32) };
                        // Suppress detached lidar leaf specks hovering past the tree's own crown rim (e.g. on adjacent upper walls).
                        if far > rim + 4.0 {
                            What::Open
                        } else {
                            // Bound crown depth proportionally to crown width so narrow tall trees/palms don't extrude into vertical columns.
                            let deep = (high as f32 * 0.55).clamp(16.0, 90.0).min((rim * 2.2).max(20.0));
                            let middle = g as f32 + high as f32 - deep / 2.0;
                            let under = if far < rim { middle - deep / 2.0 * (1.0 - (far / rim) * (far / rim)).sqrt() } else { (t as f32 - 22.0).max(middle) };
                            let min_foot = if on_road { g + 32 } else { g + 18 };
                            let foot = (under as i32 + ragged).max(min_foot).min(t - 3);
                            // The trunk goes a third of the way up into its crown, where its limbs take over. Up to the
                            // crown's top it showed through the crown's openings as a bare rod from above (#450).
                            let crown = ((g as f32 + high as f32 - deep) as i32).max(g + 18);
                            What::Crown { foot, top: t, trunk: (!on_road && far <= (trunk[3] & 255) as f32 + 0.5).then(|| crown + (t - crown) / 3),
                                tint, edge: (far/rim.max(1.0)).min(1.0) }
                        }
                    }
                    // A bush or a hedge is leaves to the ground; suppress floating mid-air canopy blobs (tall >= 28 without a trunk).
                    _ if tall < 28 && !on_road => What::Crown { foot: g + 1, top: t, trunk: None, tint, edge: 0.6 },
                    _ => What::Open,
                }
            }
            _ => What::Open,
        },
        _ => What::Open,
    };
    // The ground's top in quarter cells, for the finest cells' ramp (`grade_rows`): a road's, a pavement's (over its
    // kerb, so the kerb keeps its height up a hill) and a bank's, wherever the ground is open to the sky. Only the
    // measured asphalt had it, and every pavement and bank up Nob Hill and Telegraph Hill was a stair of 10 cm (#450).
    let ramped = size == 1 && tread.is_none() && class & 7 != WATER_HERE && !matches!(what, What::In(..) | What::Mass(..));
    let road_top4 = ramped.then(|| ((ground_height + 1.0 + kerb as f32) * 4.0).round() as i32);
    Column { g, road_top4, ground, kerb, fixtures: p.fixture_spans(x,z,size), what, heroes, hero_n }
}

fn measured_foliage(tint: u8) -> bool {
    tint >= 16 && (3..=10).contains(&((tint-16)/10)) && matches!((tint-16)%10, 2 | 5 | 6 | 8 | 9)
}

/// True when a building roof's aerial tint is genuine green meadow/foliage (living green roofs).
fn living_roof_foliage(tint: u8) -> bool {
    tint >= 16 && (5..=10).contains(&((tint - 16) / 10)) && matches!((tint - 16) % 10, 2 | 3 | 4 | 5 | 6 | 8 | 9)
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
    let s_m = size as f32 * 0.1;
    if mid <= c.g {
        if mid >= c.g - 3 * size.max(2) {
            for slot in 0..c.hero_n as usize {
                if let Some((h, u, w)) = c.heroes[slot] {
                    if let Some(surf) = heroes::surface_at(h.sort, u, w, c.g as f32 * 0.1, s_m) {
                        return surf;
                    }
                }
            }
            return c.ground;
        }
        return kind(EARTH, OWN);
    }
    // Landmarks (#423, #450, #60): check all overlapping rules; what a rule says wins, and where a rule owns its
    // place, its air clears underlying lidar clutter.
    let over_g = (y - c.g) as f32 * 0.1 + size as f32 * 0.05;
    let mut owned_air = false;
    for slot in 0..c.hero_n as usize {
        if let Some((h, u, w)) = c.heroes[slot] {
            let up = (y - h.at[1]) as f32 * 0.1 + size as f32 * 0.05;
            let made = heroes::kind_at_world(h.sort, u, up, over_g, w, s_m);
            if made != 0 {
                return made;
            }
            if heroes::owns_world(h.sort, u, up, over_g, w) {
                owned_air = true;
            }
        }
    }
    if owned_air {
        return 0;
    }
    for fixture in &c.fixtures {
        if mid >= fixture.low && mid <= fixture.high { return fixture.rod[7] as Kind; }
    }
    match &c.what {
        What::Open => if size == 1 && mid <= c.g + c.kerb { c.ground } else { 0 },
        What::In(b, p, roof, tint, pitched, wall_top, step_below, step_far) => {
            let on_roof_slope = (p.far >= 3.0 * size as f32 || (b.home && p.looks & 2 == 0))
                && *roof - *wall_top <= 30 && mid > *wall_top && mid <= *step_below;
            if mid > *roof {
                0
            } else if mid > *roof - size || on_roof_slope {
                if material(b.wall) == GLASS {
                    kind(GLASS, colour(14, 7))
                } else if living_roof_foliage(*tint) {
                    kind(GRASS, *tint)
                } else {
                    kind(ROOFING, *tint)
                }
            } else if let Some(form) = tower_base(b, p, mid - c.g, size) {
                form
            } else if p.far < 3.0 * size as f32 && size <= 8 {
                front(b, p, mid - b.base, *roof - b.base, mid - c.g, p.far, size, *pitched)
            } else if mid >= b.base + b.storey && mid > step_below.saturating_add(4) && *step_far < 3.0 * size as f32 && size <= 4 {
                front(b, p, mid - b.base, *roof - b.base, (mid - c.g).max(32), *step_far, size, *pitched)
            } else {
                b.wall
            }
        }
        What::Mass(roof, tint, wall) => if mid > *roof { 0 } else if mid > *roof - size {
            if material(*wall) == GLASS { kind(GLASS, colour(14, 7)) } else if living_roof_foliage(*tint) { kind(GRASS, *tint) } else { kind(ROOFING, *tint) }
        } else { *wall },
        What::By(b, p, roof, stepped) => {
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
                    let stripe = p.along as i32 / 4 % 2 == 0;
                    let aw = match b.seed % 7 {
                        0 => if stripe { grey(2) } else { colour(0, 8) },    // burgundy & cream stripe
                        1 => if stripe { grey(2) } else { colour(14, 8) },   // navy & cream stripe
                        2 => if stripe { grey(2) } else { colour(8, 8) },    // forest green & cream stripe
                        3 => if stripe { grey(2) } else { colour(2, 7) },    // terracotta & cream stripe
                        4 => grey(11),                                       // charcoal canvas
                        5 => colour(14, 9),                                  // deep navy canvas
                        _ => colour(1, 8),                                   // dark rust canvas
                    };
                    return kind(PLASTER, aw);
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
            // A cornice is a painted moulding in the trim's colour on flat/parapet fronts. Never protrude a thick
            // parapet slab on a stepped lower porch/garage, a pitched gable, an unsurveyed/jagged roofline, or a short stub (#60).
            let flat_eave = p.looks & 128 != 0;
            if detail & 2 != 0 && flat_eave && !*stepped && p.long >= 18.0 && top >= 44 && p.far <= 3.5 && up >= top - 4 && up <= top + 1 {
                return kind(PLASTER, (b.trim >> 8) as u8);
            }
            // Slim eave trim at the wall's top (never protrude on stepped mid-wall garage/porch eaves).
            if !*stepped && p.far < 1.8 && up >= top - 2 && up <= top {
                return b.trim;
            }
            // Synthetic bay windows: only on plain flat-fronted homes whose surveyed outline does NOT already trace
            // bay windows (#60), and wide enough for a real bay.
            if b.has_surveyed_bays
                || (if detail != 0 { detail & 1 == 0 } else { !b.home })
                || p.long < (b.module as f32 * 1.4).max(40.0)
                || up < b.storey
                || up > top - 4
            {
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
    PACKS.with_borrow(|packs| packs.iter().find(|p| p.holds(x, z)).map_or(BED, |p| {
        let (places, n) = heroes_at(x, z, 1);
        tread_ground(&places[..n as usize]).map_or_else(|| p.ground(x, z), |height| height.round() as i32)
    }))
}

/// Where someone on foot stands at a column, whether it is paved, and the sort of place (always 0: the town's
/// blocks are not the Bay's). On a roof where a building stands.
pub fn footing(x: i32, z: i32) -> (i32, bool, i32) {
    PACKS.with_borrow(|packs| {
        let c = column(packs, x, z, 1);
        match c.what {
            What::In(b, ref probe, _, _, _, _, _, _) if tower_base(b, probe, 16, 1) == Some(0) =>
                (c.g + 1, true, 0),
            What::In(_, _, roof, _, _, _, _, _) => (roof + 1, false, 0),
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

/// At eye level, carry the interpolated grade of the ground (a road's, a pavement's, a bank's) into its top 10 cm cell.
fn grade_rows(c: &Column, x: i32, z: i32, low_y: i32, rows: &mut Vec<Run>) {
    let Some(top4) = c.road_top4 else { return };
    let y = top4.div_euclid(4);
    let fill = top4.rem_euclid(4);
    if fill == 0 || y < low_y || y >= low_y + SIDE as i32 ||
        c.fixtures.iter().any(|s| s.low <= y && y <= s.high) { return; }
    // Do not carve or pad raw terrain grade over a landscape hero's pond, plaza or floral parterre (#60).
    for slot in 0..c.hero_n as usize {
        if let Some((h, u, w)) = c.heroes[slot] {
            if heroes::surface_at(h.sort, u, w, c.g as f32 * 0.1, 0.1).is_some() {
                return;
            }
        }
    }
    // Its top cell is the ground's, or a pavement's kerb over it. The grade is carved only from that ground and laid
    // only into air: not into a tree's trunk, a stoop's step or a landmark's foot, which stand in the same cells.
    let (lo, hi, kind) = if y <= c.g + c.kerb { (fill, 4, 0) } else { (0, fill, c.ground) };
    // (Carving, the cell over it must be air too: kind_at answers the ground for every cell at or under its top, so a
    // landmark, a bush or a stoop standing on it is seen only from there.)
    if kind_at(c, x, y, z, 1) != if kind == 0 { c.ground } else { 0 } || kind == 0 && kind_at(c, x, y + 1, z, 1) != 0 { return; }
    for sy in lo..hi {
        for sz in 0..4 {
            rows.push(Run { x0:x*4, x1:x*4+4, y:y*4+sy, z:z*4+sz, kind });
        }
    }
}

/// Makes one sector of the Bay in `s`, at the coarseness `s` was started with.
/// Caches the 4,096 column evaluations for the current `(low_x, low_z, lod)` across vertical sectors `sy`,
/// hoists sector-invariant pack/hero/mark filters outside the loop, and early-exits above open/roof tops (#73).
pub fn make(s: &mut Scratch) {
    let (k, size) = (s.lod, 1i32 << s.lod);
    let side = SIDE as i32;
    let mut cables = Vec::new();
    let mut road = Vec::new();
    let epoch = PACK_GEN.get();
    let x_min = (s.low[0] << k) + size / 2;
    let z_min = (s.low[2] << k) + size / 2;
    let x_max = ((s.low[0] + side - 1) << k) + size / 2;
    let z_max = ((s.low[2] + side - 1) << k) + size / 2;
    let least = least_step(size);
    let low_y = s.low[1] << k;
    let skip_cables = s.finer && k == 0;

    PACKS.with_borrow(|packs| {
        SECTOR_COLS.with_borrow_mut(|cache| {
            if cache.epoch != epoch || cache.low_x != s.low[0] || cache.low_z != s.low[2] || cache.lod != k || cache.cols.len() != SIDE * SIDE {
                let sector_packs: Vec<usize> = packs.iter().enumerate().filter_map(|(i, p)| {
                    let wide = (p.gw - 1) * p.gstep;
                    (x_max >= p.gx0 && z_max >= p.gz0 && x_min < p.gx0 + wide && z_min < p.gz0 + wide).then_some(i)
                }).collect();
                let sector_heroes: Vec<Hero> = if size <= heroes::REALM_MOST && LANDMARKS.get() {
                    HEROES.with_borrow(|all| {
                        all.iter().copied().filter(|h| x_max >= h.low[0] && z_max >= h.low[1] && x_min <= h.high[0] && z_min <= h.high[1]).collect()
                    })
                } else {
                    Vec::new()
                };
                let sector_marks: Vec<[i32; 4]> = MARKS.with_borrow(|m| {
                    m.covers.iter().copied().filter(|c| x_max >= c[0] && z_max >= c[1] && x_min < c[2] && z_min < c[3]).collect()
                });
                cache.cols.clear();
                cache.cols.reserve(SIDE * SIDE);
                for cz in 0..side {
                    let z = ((s.low[2] + cz) << k) + size / 2;
                    for cx in 0..side {
                        let x = ((s.low[0] + cx) << k) + size / 2;
                        cache.cols.push(owned_column(packs, &sector_packs, &sector_heroes, &sector_marks, x, z, size, least));
                    }
                }
                cache.low_x = s.low[0];
                cache.low_z = s.low[2];
                cache.lod = k;
                cache.epoch = epoch;
            }

            let half = size / 2;
            let ground_band = 3 * size.max(2);
            for cz in 0..side {
                let z = ((s.low[2] + cz) << k) + half;
                let row_base = (cz as usize) * SIDE;
                for cx in 0..side {
                    let x = ((s.low[0] + cx) << k) + half;
                    let oc = &cache.cols[row_base + cx as usize];
                    let has_fixtures = !oc.fixtures.is_empty();
                    if skip_cables {
                        if oc.road_top4.is_some() {
                            let mut c = oc.as_column(packs);
                            if has_fixtures { c.fixtures = oc.fixtures.clone(); }
                            grade_rows(&c, x, z, s.low[1], &mut road);
                        }
                        if has_fixtures {
                            for fixture in &oc.fixtures {
                                if fixture.rod[6] <= 3 {
                                    fixture.cable_rows(x, z, s.low[1], &mut cables);
                                }
                            }
                        }
                    }
                    let has_solid_fixture = if skip_cables {
                        oc.fixtures.iter().any(|f| f.rod[6] > 3)
                    } else {
                        has_fixtures
                    };
                    if matches!(oc.what, OwnedWhat::Open) && oc.hero_n == 0 && !has_solid_fixture {
                        let top = if size == 1 { oc.g + oc.kerb } else { oc.g };
                        let min_mid = low_y + half;
                        if min_mid > top {
                            continue;
                        }
                        let cy_end = (((top - min_mid) >> k) + 1).min(side);
                        let earth_cut = oc.g - ground_band;
                        for cy in 0..cy_end {
                            let mid = low_y + (cy << k) + half;
                            let v = if mid <= oc.g {
                                if mid >= earth_cut { oc.ground } else { kind(EARTH, OWN) }
                            } else {
                                oc.ground
                            };
                            if v != 0 {
                                s.cells[at(cx as usize, cy as usize, cz as usize)] = v;
                            }
                        }
                        continue;
                    }
                    let cy_end = if oc.hero_n == 0 && !has_solid_fixture {
                        let max_mid = match oc.what {
                            OwnedWhat::Open => if size == 1 { oc.g + oc.kerb } else { oc.g },
                            OwnedWhat::In(_, _, _, roof, ..) | OwnedWhat::Mass(roof, _, _) => roof.max(oc.g),
                            OwnedWhat::By(_, _, _, roof, _) => (roof + 3).max(oc.g + oc.kerb),
                            OwnedWhat::Crown { top, .. } => top.max(oc.g + oc.kerb),
                        };
                        let min_mid = low_y + half;
                        if min_mid > max_mid { continue; }
                        (((max_mid - min_mid) >> k) + 1).min(side)
                    } else {
                        side
                    };
                    let mut c = oc.as_column(packs);
                    if has_solid_fixture {
                        if skip_cables {
                            c.fixtures.extend(oc.fixtures.iter().copied().filter(|f| f.rod[6] > 3));
                        } else {
                            c.fixtures.extend_from_slice(&oc.fixtures);
                        }
                    }
                    for cy in 0..cy_end {
                        let v = kind_at(&c, x, low_y + (cy << k), z, size);
                        if v != 0 {
                            s.cells[at(cx as usize, cy as usize, cz as usize)] = v;
                        }
                    }
                }
            }
        });
    });
    if !road.is_empty() { s.fine_runs(&road, 2); }
    if !cables.is_empty() { s.fine_runs(&cables, 2); }
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

    /// Marks as the page hands them over (sf/marks.mjs): one covered square and the segments given.
    fn take_marks(segs: &[[i32; 5]]) -> i32 {
        let mut words = vec![0x4b52_414d, 1, segs.len() as i32, 0, 0, 1000, 1000];
        for s in segs { words.extend(s); }
        let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), room(bytes.len()), bytes.len()); }
        marks()
    }

    #[test]
    fn marks_say_where_the_bakes_paint_is_not_drawn() {
        // A dashed lane line along x at z = 100 in a square from 0 to 1000: the square is covered, nothing else is.
        assert_eq!(take_marks(&[[0, 100, 400, 100, 2]]), 1);
        assert!(marked_place(10, 10) && marked_place(999, 999));
        assert!(!marked_place(-1, 10) && !marked_place(10, 1000));
        // Bytes that are not marks are refused, and leave what was held.
        ROOM.with_borrow_mut(|r| *r = vec![1, 2, 3, 4]);
        assert_eq!(marks(), -1);
        take_marks(&[]);
    }

    #[test]
    fn measured_asphalt_reads_darker_than_pavement() {
        // The aerial's brightest road (4) and its darkest (11), as the column draws them: darker than the concrete of
        // a pavement, and darkest for the darkest.
        let pale = 8 + ((4u8 - 4) * 4 + 3) / 7;
        let dark = 8 + ((11u8 - 4) * 4 + 3) / 7;
        assert_eq!((pale, dark), (8, 12));
        // Palette grey 8 is 0.86 - 7/14 * 0.8 = 0.46 of white; the concrete material is #a9a69f, 0.66 (march.ts).
        assert!(0.86 - (pale as f32 - 1.0) / 14.0 * 0.8 < 0.66 * 0.75);
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
    fn conservatory_replaces_the_whole_surveyed_crown_of_a_matched_trunk() {
        // Reproduce the western stem in 190_277: lidar merges the two mapped
        // palms and gives it a 6.4 m radius. Its east rim is outside both new crowns.
        let mut bytes = pack();
        let tops = 64 + 65 * 65 * 2;
        let classes = tops + 128 * 128 * 2;
        for z in 96..104 {
            for x in 96..114 {
                let i = z * 128 + x;
                bytes[tops + 2 * i..tops + 2 * i + 2].copy_from_slice(&415_i16.to_le_bytes());
                bytes[classes + i] = CANOPY | GRASS_HERE;
            }
        }
        let end = bytes.len();
        bytes[end - 8..end - 4].copy_from_slice(&415_i32.to_le_bytes());
        bytes[end - 4..].copy_from_slice(&((64_i32 << 8) | 4).to_le_bytes());
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), room(bytes.len()), bytes.len()) };
        assert_eq!(load(), 1);
        let rim = || {
            let mut sector = Scratch::new();
            sector.start(8, 6, 7, 0);
            make(&mut sector);
            let mut leaves = 0;
            for x in 560..565 {
                for z in 496..506 {
                    for y in 384..410 {
                        if material(sector.cells[at(x - 512, y - 384, z - 448)]) == LEAVES { leaves += 1; }
                    }
                }
            }
            leaves
        };
        assert!(rim() > 0, "fixture must emit a raw crown at its rim");
        hero(heroes::CONSERVATORY, 624, 153, 200, 0);
        assert_eq!(rim(), 0, "the displaced lidar stem still has a second crown");
        clear();
    }

    #[test]
    fn measured_crowns_have_openings_and_keep_the_trunk() {
        let tint = colour(6, 5);
        let mut c = Column { g: 0, road_top4: None, ground: kind(EARTH, OWN), kerb: 0,
            what: What::Crown { foot: 25, top: 70, trunk: None, tint, edge: 0.9 }, fixtures: Vec::new(), heroes: [None, None], hero_n: 0 };
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
            what: What::Open, fixtures: Vec::new(), heroes: [None, None], hero_n: 0 };
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
        // A pavement a cell over the ground: its ramp is over its kerb, carved from the kerb's top cell when the grade
        // is under it and laid on it when over.
        c.g = 3;
        c.kerb = 1;
        c.road_top4 = Some(4 * 4 + 1);
        rows.clear();
        grade_rows(&c, 4, 2, 0, &mut rows);
        assert_eq!(rows.len(), 12);
        assert!(rows.iter().all(|r| r.y >= 17 && r.y < 20 && r.kind == 0));
        c.road_top4 = Some(5 * 4 + 2);
        rows.clear();
        grade_rows(&c, 4, 2, 0, &mut rows);
        assert_eq!(rows.len(), 8);
        assert!(rows.iter().all(|r| (r.y == 20 || r.y == 21) && r.kind == ground));
        // A tree's trunk stands in the kerb's top cell: the grade is not carved through it, nor laid over a trunk. A bush
        // standing on the ground's top cell keeps its foot too.
        c.what = What::Crown { foot: 25, top: 70, trunk: Some(40), tint: 0, edge: 0.0 };
        for top4 in [4 * 4 + 2, 5 * 4 + 2] {
            c.road_top4 = Some(top4);
            rows.clear();
            grade_rows(&c, 4, 2, 0, &mut rows);
            assert!(rows.is_empty(), "{top4}: {} rows", rows.len());
        }
        c.kerb = 0;
        c.what = What::Crown { foot: 4, top: 20, trunk: None, tint: 0, edge: 0.6 };
        c.road_top4 = Some(3 * 4 + 2);
        rows.clear();
        grade_rows(&c, 4, 2, 0, &mut rows);
        assert!(rows.is_empty(), "a bush's foot: {} rows", rows.len());
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
    fn photographs_as_evidence_name_the_wall_and_the_glass_and_an_unmarked_row_reads_as_before() {
        let cream = colour(4, 7);
        let cells = [cream; 30];
        // The trim's kind is the row's fourth number; the 16 bits over it are the evidence.
        let trim_at = 64 + 65 * 65 * 2 + 128 * 128 * 4 + 12;
        let with = |bits: u32| {
            let mut bytes = painted(&cells);
            let trim = kind(PLASTER, grey(3)) as u32 | bits << 16;
            bytes[trim_at..trim_at + 4].copy_from_slice(&trim.to_le_bytes());
            read(&bytes).unwrap()
        };
        // No evidence: the paint's majority stands, as it did, and the windows keep their rule.
        let plain = read(&painted(&cells)).unwrap();
        assert_eq!((plain.buildings[0].wall, plain.buildings[0].trim, plain.buildings[0].glass), (kind(PLASTER, cream), kind(PLASTER, grey(3)), None));
        assert_eq!(with(0).buildings[0].wall, plain.buildings[0].wall);
        // A measured wall is the row's own kind (the bake wrote the photographs' colour there), over the paint's.
        let measured = with(1);
        assert_eq!((measured.buildings[0].wall, measured.buildings[0].trim), (kind(PLASTER, WHITE), kind(PLASTER, grey(3))));
        // A measured glass share of 0.35 makes the upper windows that share of the bay's wall (the pack's house: a
        // storey of 32 cells and a bay of 30); none at all keeps the rule's, and the pier never goes under 0.3 m.
        let glassy = with(1 << 8 | 35 << 1);
        let b = &glassy.buildings[0];
        assert_eq!(b.glass, Some(0.35));
        assert!((measured_half(b, 8, b.storey - 5).unwrap() - 0.35 * 30.0 * 32.0 / 38.0).abs() < 1e-4);
        assert_eq!(measured_half(&plain.buildings[0], 8, 27), None);
        assert_eq!(measured_half(&with(1 << 8 | 100 << 1).buildings[0], 8, 27), Some(12.0));
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

    #[test]
    fn road_trunks_floating_canopy_and_road_stop_signs_are_cleaned() {
        let mut bytes = Vec::new();
        let (gw, tw) = (5i32, 32i32);
        // Header: 64 bytes; gstep=80, gw=5 (320 cells), tstep=10, tw=32 (320 cells), 0 buildings, 0 verts, 1 trunk on road
        let head = [0x3159_4142i32, 1, 0, 0, 80, gw, 0, 0, 10, tw, 0, 0, 0, 0, 1, 0];
        for w in head { bytes.extend(w.to_le_bytes()); }
        for _ in 0..(gw * gw) { bytes.extend(100i16.to_le_bytes()); }
        let mut top = vec![100i16; (tw * tw) as usize];
        let mut cls = vec![ROAD; (tw * tw) as usize];
        // Right half (x >= 160) is pavement; left half (x < 160) is road.
        for j in 0..tw {
            for i in 16..tw { cls[(j * tw + i) as usize] = PAVEMENT; }
        }
        // Put floating canopy (tall=60, no trunk nearby) on pavement at (280, 280), and a trunk on road at (100, 100).
        cls[(28 * tw + 28) as usize] = PAVEMENT | CANOPY;
        top[(28 * tw + 28) as usize] = 160;
        cls[(10 * tw + 10) as usize] = ROAD | CANOPY;
        top[(10 * tw + 10) as usize] = 220;
        for t in top { bytes.extend(t.to_le_bytes()); }
        bytes.extend(&cls);
        bytes.extend(vec![0u8; (tw * tw) as usize]);
        // 1 trunk standing on road at (100, 100)
        for v in [100i32, 100, 220, 2] { bytes.extend(v.to_le_bytes()); }
        // SFST: 1 stop sign post + 1 octagon bar standing on road at (140, 140), 2 m from pavement at x=160
        bytes.extend(b"SFST");
        bytes.extend(2u32.to_le_bytes());
        for v in [140i32, 100, 140, 140, 127, 140, 5, kind(STEEL, grey(9)) as i32] { bytes.extend(v.to_le_bytes()); }
        for v in [136i32, 124, 140, 144, 124, 140, 5, kind(STEEL, colour(0, 4)) as i32] { bytes.extend(v.to_le_bytes()); }

        let pack = read(&bytes).expect("valid pack");
        // Road trunk was not added to stems.
        assert!(pack.stems.iter().all(|s| s.is_empty()), "road trunk should be skipped");
        // Stop sign moved off ROAD onto PAVEMENT (x >= 160).
        assert_eq!(pack.fixtures.len(), 2);
        assert!(pack.fixtures[0][0] >= 160 && pack.surface(pack.fixtures[0][0], pack.fixtures[0][2]).0 & 7 == PAVEMENT);
        assert_eq!((pack.fixtures[1][0] + pack.fixtures[1][3]) / 2, pack.fixtures[0][0]);
        // Trunkless tall floating canopy at (285, 285) becomes Open.
        let packs = [pack];
        let c = column(&packs, 285, 285, 1);
        assert!(matches!(c.what, What::Open), "trunkless tall canopy should not float");
    }

    #[test]
    fn faceted_bays_get_windows_without_double_bays_or_floating_cornices() {
        // An 8-vertex house with a surveyed 3-sided bay front whose angled facets were left unmarked by erosion.
        let mut ring = [
            [0, 0, 3], [20, 0, 0], [32, -8, 0], [44, 0, 0], [64, 0, 3],
            [64, 80, 1], [0, 80, 1], [0, 40, 4 | 1],
        ];
        propagate_fronts(&mut ring);
        assert!(ring[1][2] & 3 == 3 && ring[2][2] & 3 == 3 && ring[3][2] & 3 == 3, "bay facets inherit street facing");
        assert!(ring_has_surveyed_bays(&ring), "surveyed bay geometry detected to prevent double bay extrusion");
        // An outer ring with zero open faces gets its longest edge opened so no house is a blind concrete box.
        let mut blind = [[0, 0, 0], [50, 0, 0], [50, 30, 0], [0, 30, 4]];
        propagate_fronts(&mut blind);
        assert!(blind[0][2] & 1 != 0 && blind[2][2] & 1 != 0, "blind building opens longest walls");
        // Narrow 1.4 m street-facing bay facet centers a real glass sash window (mullion at centre, glass on either pane).
        let b = Building {
            first: 0, count: 4, wall: kind(PLASTER, WHITE), trim: kind(PLASTER, grey(2)), glass: None,
            storey: 32, module: 30, home: true, special: 0, ground_floor: 0, seed: 1, base: 100,
            has_surveyed_bays: true, eave_med: 180, low: [0, 0], high: [100, 100],
        };
        let p_pane = Probe { inside: true, far: 1.5, along: 5.0, round: 23.0, long: 14.0, looks: 3, side: 1, on: [5.0, 0.0] };
        assert_eq!(material(front(&b, &p_pane, 48, 96, 48, 1.5, 1, false)), GLASS);
        let p = Probe { inside: true, far: 1.5, along: 7.0, round: 25.0, long: 14.0, looks: 3, side: 1, on: [7.0, 0.0] };
        assert_eq!(front(&b, &p, 48, 96, 48, 1.5, 1, false), b.trim);
        // Stepped/pitched What::By suppresses protruding 40 cm white cornice slabs that would float mid-wall.
        let p_by = Probe { inside: false, far: 3.0, along: 10.0, round: 10.0, long: 20.0, looks: 3 | (2 << 24), side: 1, on: [10.0, 0.0] };
        let c_stepped = Column {
            g: 100, road_top4: None, ground: kind(CONCRETE, grey(5)), kerb: 0,
            what: What::By(&b, p_by, 140, true), fixtures: Vec::new(), heroes: [None, None], hero_n: 0,
        };
        assert_eq!(kind_at(&c_stepped, 10, 141, -3, 1), 0, "stepped roof must not float cornice mid-wall");
        // Living green roofs and glass roofs render as GRASS / GLASS rather than grey ROOFING shingles.
        let c_green = Column {
            g: 100, road_top4: None, ground: kind(GRASS, OWN), kerb: 0,
            what: What::In(&b, p, 180, colour(8, 5), false, 180, i32::MAX, 1e9), fixtures: Vec::new(), heroes: [None, None], hero_n: 0,
        };
        assert_eq!(material(kind_at(&c_green, 10, 180, 10, 1)), GRASS);
        // 2-story Outer Sunset house (5.9 m tall, storey 34): floor 1 must get real GLASS windows below its cornice,
        // never an orphan white sill on a blank wall (#60).
        let sunset = Building {
            first: 0, count: 4, wall: kind(PLASTER, colour(6, 7)), trim: kind(PLASTER, WHITE), glass: None,
            storey: 34, module: 30, home: true, special: 0, ground_floor: 0, seed: 2, base: 585,
            has_surveyed_bays: false, eave_med: 643, low: [0, 0], high: [100, 100],
        };
        let p_sun = Probe { inside: true, far: 1.5, along: 22.0, round: 22.0, long: 48.0, looks: 3, side: 1, on: [22.0, 0.0] };
        let glass_cells = (34..58).filter(|&up| material(front(&sunset, &p_sun, up, 58, up, 1.5, 1, false)) == GLASS).count();
        assert!(glass_cells >= 8, "2-story 5.8 m house floor 1 should have real windows, got {glass_cells}");
        // Stepped-back 2nd-floor wall behind a lower wing (probe.far = 18.0 >= 3.0) still gets windows on floor >= 1!
        let p_setback = Probe { inside: true, far: 18.0, along: 22.0, round: 22.0, long: 48.0, looks: 3, side: 1, on: [22.0, 0.0] };
        let c_setback = Column {
            g: 585, road_top4: None, ground: kind(CONCRETE, grey(5)), kerb: 0,
            what: What::In(&sunset, p_setback, 643, 0, false, 643, 611, 1.6), fixtures: Vec::new(), heroes: [None, None], hero_n: 0,
        };
        let setback_glass = (619..643).filter(|&y| material(kind_at(&c_setback, 22, y, 18, 1)) == GLASS).count();
        assert!(setback_glass >= 8, "stepped-back 2nd floor behind wing should have windows, got {setback_glass}");
    }

    #[test]
    fn collapsed_front_lidar_and_garage_overlap_are_repaired() {
        // Reproduces the exact Outer Sunset fault (owner feedback on IMG_6768.png, #60):
        // (1) Front 1.0 m of building footprint has ground-level lidar dropouts (base+6) while interior is base+56..68,
        // (2) Single-cell +3.0 m rooftop spike, (3) Sloped roof rising from eave+0 to eave+14, (4) Garage+entry front.
        let mut bytes = Vec::new();
        let (gw, tw, gstep, tstep) = (33i32, 64i32, 10i32, 5i32);
        for v in [0x31594142i32, 0, 0, 320, gstep, gw, 0, 0, tstep, tw, 0, 0, 1, 4, 0, 0] {
            bytes.extend(v.to_le_bytes());
        }
        bytes.extend(vec![100i16; (gw * gw) as usize].into_iter().flat_map(|v| v.to_le_bytes()));
        let mut top = vec![NONE; (tw * tw) as usize];
        let mut cls = vec![PAVEMENT; (tw * tw) as usize];
        // Building spans x=60..180, z=60..140 (base=100, storey=32); west front at x=60 faces street.
        for j in 12..28 {
            for i in 12..36 {
                let k = (j * tw + i) as usize;
                cls[k] = BUILT | PAVEMENT;
                if i < 14 {
                    // Front 1.0 m lidar dropout: ground-level returns (base + 6) that collapsed the front wall to 2.2 m!
                    top[k] = 106;
                } else {
                    // Sloped hip roof rising cleanly from 154 at front to 168 at ridge.
                    top[k] = (154 + ((i - 14) * 4).min(14)) as i16;
                }
            }
        }
        // Single-cell rooftop antenna/vent spike (+3.0 m above surrounding roof).
        top[(20 * tw + 24) as usize] = 198;
        for t in top { bytes.extend(t.to_le_bytes()); }
        bytes.extend(&cls);
        bytes.extend(vec![grey(9); (tw * tw) as usize]);
        // Building record: first=0, count=4, wall=cream plaster, trim=white, storey=32, mod=28, home=1, base=100
        let style = 32 | (28 << 8) | (1 << 16);
        for v in [0i32, 4, kind(PLASTER, colour(3, 1)) as i32, kind(PLASTER, WHITE) as i32, style, 100] {
            bytes.extend(v.to_le_bytes());
        }
        // 4 corners: west front (60,140)->(60,60) has street + garage + entry + cornice (0xf << 24), NO eave bit!
        let front_looks: i32 = 3 | (0xf << 24);
        for [x, z, l] in [[60i32, 140, front_looks], [60, 60, 1], [180, 60, 1], [180, 140, 4 | 1]] {
            for v in [x, z, l] { bytes.extend(v.to_le_bytes()); }
        }
        let pack = read(&bytes).expect("valid pack");
        let packs = [pack];
        // 1. Collapsed front 1.0 m wall is restored up to the real ~5.4 m eave, never left as a 2.2 m stub!
        let c_front = column(&packs, 62, 100, 1);
        match c_front.what {
            What::In(_, _, roof, _, _, _, _, _) => assert!(roof >= 150, "front wall collapsed to {roof}"),
            _ => panic!("expected What::In at front wall"),
        }
        // 2. Single-cell +3.0 m rooftop spike at (122, 102) is denoised down to the roof plane (~168).
        assert!(packs[0].top(122, 102).unwrap() <= 172, "rooftop spike survived: {:?}", packs[0].top(122, 102));
        // 3. Interior sloped roof voxels above the eave render as ROOFING, never flashing bright stucco risers!
        let c_slope = column(&packs, 92, 100, 1);
        assert_eq!(material(kind_at(&c_slope, 92, 158, 100, 1)), ROOFING, "sloped roof step flashed wall stucco");
        // 4. Garage header (over_ground = 23..30) directly above the garage door must NEVER cut a Floor-0 glass window!
        let p_gar = Probe { inside: true, far: 1.5, along: 52.0, round: 52.0, long: 80.0, looks: front_looks, side: 0, on: [60.0, 88.0] };
        let b0 = &packs[0].buildings[0];
        let clipped_glass = (23..31).filter(|&y| material(front(b0, &p_gar, y, 56, y, 1.5, 1, false)) == GLASS).count();
        assert_eq!(clipped_glass, 0, "window clipped straight into top of garage door ({clipped_glass} cells)");
    }

    #[test]
    fn residential_roof_end_corner_fins_are_flattened() {
        // Reproduces the 36th Ave corner fin artifact (#60): a residential front corner beside a side lightwell has a
        // ground-level dropout next to a 5.2 m front eave while the rear roof is 6.6 m, plus a 1-sample corner spike.
        let mut bytes = Vec::new();
        let (gw, tw, gstep, tstep) = (33i32, 64i32, 10i32, 5i32);
        for v in [0x31594142i32, 0, 0, 320, gstep, gw, 0, 0, tstep, tw, 0, 0, 1, 6, 0, 0] {
            bytes.extend(v.to_le_bytes());
        }
        bytes.extend(vec![100i16; (gw * gw) as usize].into_iter().flat_map(|v| v.to_le_bytes()));
        let mut top = vec![NONE; (tw * tw) as usize];
        let mut cls = vec![PAVEMENT; (tw * tw) as usize];
        // L-shaped front corner: x=60..160, z=60..120 plus a narrow front corner stub x=60..70, z=120..125 (alley behind x=70..160)
        for j in 12..25 {
            for i in 12..32 {
                if j == 24 && i >= 14 { continue; }
                let k = (j * tw + i) as usize;
                cls[k] = BUILT | PAVEMENT;
                top[k] = if i < 16 { 152 } else { 166 };
            }
        }
        // Front-right corner dropout (104) + adjacent 1-sample perimeter fin (168) sticking +1.6 m above the 152 eave.
        top[(24 * tw + 12) as usize] = 104;
        top[(24 * tw + 13) as usize] = 168;
        for t in top { bytes.extend(t.to_le_bytes()); }
        bytes.extend(&cls);
        bytes.extend(vec![grey(9); (tw * tw) as usize]);
        let style = 32 | (28 << 8) | (1 << 16);
        for v in [0i32, 6, kind(PLASTER, colour(3, 1)) as i32, kind(PLASTER, WHITE) as i32, style, 100] {
            bytes.extend(v.to_le_bytes());
        }
        for [x, z, l] in [
            [60i32, 125, 3], [60, 60, 1], [160, 60, 1], [160, 120, 1], [70, 120, 1], [70, 125, 4 | 1],
        ] {
            for v in [x, z, l] { bytes.extend(v.to_le_bytes()); }
        }
        let pack = read(&bytes).expect("valid pack");
        let corner_drop = pack.top(62, 122).expect("repaired corner");
        let corner_fin = pack.top(67, 122).expect("flattened fin");
        assert!(corner_drop <= 156, "corner dropout jumped to rear roof height: {corner_drop}");
        assert!(corner_fin <= 156, "1-sample perimeter roof-end fin survived: {corner_fin}");

        // A valid baked two-storey eave (160) behind a shallow 0.6 m lower bay shelf (137, rising to 160 at 1.2 m in)
        // must keep its 160 eave and never collapse to the 137 shelf.
        let mut bytes2 = Vec::new();
        for v in [0x31594142i32, 0, 0, 320, gstep, gw, 0, 0, tstep, tw, 0, 0, 1, 4, 0, 0] {
            bytes2.extend(v.to_le_bytes());
        }
        bytes2.extend(vec![100i16; (gw * gw) as usize].into_iter().flat_map(|v| v.to_le_bytes()));
        let mut top2 = vec![NONE; (tw * tw) as usize];
        let mut cls2 = vec![PAVEMENT; (tw * tw) as usize];
        for j in 12..24 {
            for i in 12..28 {
                let k = (j * tw + i) as usize;
                cls2[k] = BUILT | PAVEMENT;
                top2[k] = if i < 14 { 137 } else { 160 };
            }
        }
        for t in top2 { bytes2.extend(t.to_le_bytes()); }
        bytes2.extend(&cls2);
        bytes2.extend(vec![grey(9); (tw * tw) as usize]);
        for v in [0i32, 4, kind(PLASTER, colour(6, 7)) as i32, kind(PLASTER, WHITE) as i32, style, 100] {
            bytes2.extend(v.to_le_bytes());
        }
        let baked_160: i32 = 3 | 128 | (160 << 8) | (15 << 24);
        for [x, z, l] in [[60i32, 120, baked_160], [60, 60, 1], [140, 60, 1], [140, 120, 4 | 1]] {
            for v in [x, z, l] { bytes2.extend(v.to_le_bytes()); }
        }
        let pack2 = read(&bytes2).expect("valid pack2");
        let kept_eave = (pack2.verts[0][2] >> 8) as i16 as i32;
        assert_eq!(kept_eave, 160, "shallow 0.6 m bay shelf collapsed valid 2-storey eave to {kept_eave}");
    }

    #[test]
    fn road_standing_lamps_hydrants_and_poles_are_snapped_or_dropped_cleanly() {
        let mut bytes = Vec::new();
        let (gw, tw) = (5i32, 32i32);
        // Header: gstep=80, gw=5 (320 cells), tstep=10, tw=32 (320 cells), 1 building, 4 verts, 0 trunks
        let head = [0x3159_4142i32, 1, 0, 0, 80, gw, 0, 0, 10, tw, 0, 0, 1, 4, 0, 0];
        for w in head { bytes.extend(w.to_le_bytes()); }
        for _ in 0..(gw * gw) { bytes.extend(100i16.to_le_bytes()); }
        let top = vec![100i16; (tw * tw) as usize];
        // x < 220 is ROAD; x >= 220 is PAVEMENT (except z < 80, x >= 220 is GRASS_HERE for park road test).
        let mut cls = vec![ROAD; (tw * tw) as usize];
        for j in 0..tw {
            for i in 22..tw {
                cls[(j * tw + i) as usize] = if j < 8 { GRASS_HERE } else { PAVEMENT };
            }
        }
        for t in top { bytes.extend(t.to_le_bytes()); }
        bytes.extend(&cls);
        bytes.extend(vec![0u8; (tw * tw) as usize]);
        // Building sitting on pavement at x in [220, 290], z in [250, 310]: fixtures must not snap inside it.
        for w in [0i32, 4, kind(BRICK, OWN) as i32, kind(CONCRETE, OWN) as i32, 30, 100] {
            bytes.extend(w.to_le_bytes());
        }
        for v in [[220i32, 250, 3], [290, 250, 3], [290, 310, 3], [220, 310, 7]] {
            for w in v { bytes.extend(w.to_le_bytes()); }
        }

        let steel = kind(STEEL, grey(9)) as i32;
        let dark = kind(STEEL, grey(14)) as i32;
        let wood = kind(WOOD, colour(3, 0)) as i32;
        let white = kind(CONCRETE, grey(1)) as i32;
        let lamp = kind(LAMP, colour(3, 0)) as i32;

        let fixtures: Vec<[i32; 8]> = vec![
            // 1. Road-standing lamp at (185, 100, 140), 3.5 m west of pavement -> snaps to x >= 220, arm aims west (-x).
            [185, 100, 140, 185, 183, 140, 12, steel],
            [185, 179, 140, 198, 185, 140, 5, steel],  // originally aimed east (into sidewalk!)
            [198, 185, 140, 203, 185, 140, 12, lamp],
            // 2. Mid-intersection lamp at (50, 100, 140), 17 m from pavement -> mast, arm, head all dropped.
            [50, 100, 140, 50, 183, 140, 12, steel],
            [50, 179, 140, 50, 185, 153, 5, steel],
            [50, 185, 153, 50, 185, 158, 12, lamp],
            // 3. Existing sidewalk lamp at (224, 100, 200) + duplicate road lamp at (195, 100, 200) -> road one dropped.
            [224, 100, 200, 224, 183, 200, 12, steel],
            [224, 179, 200, 211, 185, 200, 5, steel],
            [211, 185, 200, 206, 185, 200, 12, lamp],
            [195, 100, 200, 195, 183, 200, 12, steel],
            [195, 179, 200, 182, 185, 200, 5, steel],
            [182, 185, 200, 177, 185, 200, 12, lamp],
            // 4. Fire hydrant on road at (200, 100, 100) -> body, nozzles, cap all snap to pavement.
            [200, 100, 100, 200, 107, 100, 15, white],
            [198, 104, 100, 202, 104, 100, 10, white],
            [200, 107, 100, 200, 108, 100, 12, white],
            // 5. Utility pole on road at (205, 100, 170) -> mast + crossarm snap to pavement.
            [205, 100, 170, 205, 196, 170, 16, wood],
            [205, 188, 162, 205, 188, 178, 8, wood],
            // 6. Sensed pole on road at (205, 100, 225) + span wire -> pole snaps & wire endpoint follows it.
            [205, 100, 225, 205, 190, 225, 14, wood],
            [205, 186, 225, 260, 180, 225, 3, dark],
            // 7. Park-road lamp at (200, 100, 40), 2 m west of GRASS_HERE -> snaps onto GRASS_HERE.
            [200, 100, 40, 200, 183, 40, 12, steel],
            [200, 179, 40, 213, 185, 40, 5, steel],
            [213, 185, 40, 218, 185, 40, 12, lamp],
            // 8. Road lamp right beside the building wall at (205, 100, 280) -> must NOT snap inside building [220..290, 250..310].
            [205, 100, 280, 205, 183, 280, 12, steel],
            [205, 179, 280, 192, 185, 280, 5, steel],
            [192, 185, 280, 187, 185, 280, 12, lamp],
        ];
        bytes.extend(b"SFST");
        bytes.extend((fixtures.len() as u32).to_le_bytes());
        for f in &fixtures {
            for w in f { bytes.extend(w.to_le_bytes()); }
        }

        let pack = read(&bytes).expect("valid pack");
        // No standing vertical mast/body may remain on ROAD or inside the building.
        let masts: Vec<_> = pack.fixtures.iter()
            .filter(|r| r[0] == r[3] && r[2] == r[5] && (r[4] - r[1]) >= 6)
            .collect();
        for m in &masts {
            assert_ne!(pack.surface(m[0], m[2]).0 & 7, ROAD, "fixture mast stayed on ROAD: {m:?}");
            assert!(!pack.in_building(m[0], m[2], 0.0), "fixture mast snapped into building: {m:?}");
        }
        // Kept street lamps: #1 (snapped to pavement), #3a (already on pavement), #7 (snapped to grass).
        // Dropped: #2 (mid-road), #3b (duplicate), #8 (blocked by building within 4 m).
        // Wait: #8 at (205, 280) is 3.5 m north of z=246 pavement outside the building, so check count is 3 or 4 and none inside building.
        let lamp_masts: Vec<_> = masts.iter().filter(|r| r[6] == 12 && r[4] - r[1] == 83).copied().collect();
        assert!(lamp_masts.len() >= 3 && lamp_masts.len() <= 4, "unexpected lamp mast count: {lamp_masts:?}");
        // Every luminaire head must correspond to a kept lamp mast (zero orphaned floating lamp heads).
        let lamp_heads: Vec<_> = pack.fixtures.iter().filter(|r| r[6] == 12 && material(r[7] as Kind) == LAMP).collect();
        assert_eq!(lamp_heads.len(), lamp_masts.len(), "lamp head/mast mismatch: heads={lamp_heads:?} masts={lamp_masts:?}");
        // Lamp #1 snapped to pavement near z=140 and its arm now points west (-x) back over the road.
        let l1 = lamp_masts.iter().find(|r| (r[2] - 140).abs() <= 4).expect("lamp #1 snapped");
        assert!(l1[0] >= 220);
        let a1 = pack.fixtures.iter().find(|r| r[6] == 5 && r[0] == l1[0] && r[1] == l1[1] + 79 && r[2] == l1[2]).expect("lamp #1 arm");
        assert!(a1[3] < a1[0], "snapped lamp arm should reach west over carriageway: {a1:?}");
        // Hydrant #4: all 3 segments moved off ROAD onto pavement.
        let h4 = masts.iter().find(|r| r[6] == 15).expect("hydrant #4 snapped");
        assert!(h4[0] >= 220);
        assert!(pack.fixtures.iter().any(|r| r[6] == 10 && (r[0] + r[3]) / 2 == h4[0] && r[2] == h4[2]));
        assert!(pack.fixtures.iter().any(|r| r[6] == 12 && r[0] == h4[0] && r[2] == h4[2] && r[4] - r[1] == 1));
        // Utility pole #5: mast + crossarm moved off ROAD onto pavement.
        let p5 = masts.iter().find(|r| r[6] == 16).expect("pole #5 snapped");
        assert!(p5[0] >= 220);
        assert!(pack.fixtures.iter().any(|r| r[6] == 8 && ((r[0] + r[3]) / 2 - p5[0]).abs() <= 1 && ((r[2] + r[5]) / 2 - p5[2]).abs() <= 1));
        // Sensed pole #6: mast moved off ROAD and span wire endpoint followed it.
        let s6 = masts.iter().find(|r| r[6] == 14).expect("sensed pole #6 snapped");
        assert!(s6[0] >= 220);
        assert!(pack.fixtures.iter().any(|r| r[6] == 3 && r[0] == s6[0] && r[1] == s6[4] - 4 && r[2] == s6[2]));
    }

    #[test]
    fn fast_column_queries_and_cached_make_match_reference() {
        with_pack(|| {
            let mut s = Scratch::new();
            // Build sectors across sy = 1..5 in one column (exercising SECTOR_COLS reuse) and compare
            // every cell against kind_single, solid_single, and under.
            let (sx, sz) = (4, 4);
            let mut cached = Vec::new();
            for sy in 1..5 {
                s.start(sx, sy, sz, 0);
                make(&mut s);
                cached.push(s.cells.clone());
            }
            // Invalidate SECTOR_COLS by bumping epoch and rebuild each sy fresh.
            PACK_GEN.with(|g| g.set(g.get().wrapping_add(1)));
            for (idx, sy) in (1..5).enumerate() {
                PACK_GEN.with(|g| g.set(g.get().wrapping_add(1)));
                s.start(sx, sy, sz, 0);
                make(&mut s);
                assert_eq!(s.cells, cached[idx], "cached make drifted at sy={sy}");
                // Spot-check kind_single / solid_single across the sector (building wall, windows, roof, open road).
                let x0 = sx * 64;
                let y0 = sy * 64;
                let z0 = sz * 64;
                for lz in (0..64).step_by(7) {
                    for lx in (0..64).step_by(7) {
                        for ly in (0..64).step_by(5) {
                            let expected = s.cells[(lx + 64 * (lz + 64 * ly)) as usize];
                            let got = kind_single(x0 + lx, y0 + ly, z0 + lz);
                            assert_eq!(got, expected, "kind_single mismatch at ({},{},{})", x0 + lx, y0 + ly, z0 + lz);
                            assert_eq!(solid_single(x0 + lx, y0 + ly, z0 + lz), expected != 0);
                        }
                    }
                }
            }
            // Verify under(x, y, z, 40) matches a downward scan of kind_single across road, pavement, and roof.
            for (x, z, y) in [(100, 50, 130), (100, 120, 130), (300, 300, 290), (300, 300, 200), (100, 50, 105)] {
                let mut expected = i32::MIN;
                for at in ((y - 39)..=y).rev() {
                    if kind_single(x, at, z) != 0 {
                        expected = at + 1;
                        break;
                    }
                }
                assert_eq!(under(x, y, z, 40), expected, "under mismatch at ({x},{y},{z})");
            }
        });
    }

    #[test]
    fn rooftop_narrow_pillars_are_despiked_in_fine_and_coarse_packs() {
        // L0 (tstep=5, 0.5 m samples): a flat roof at 150 with a 2.0 m x 1.5 m (4x3) light-pole pillar at 220,
        // a 1.5 m parapet at 165, a 4 m x 4 m (8x8) real penthouse at 200, and a tree canopy spike at 240.
        let (gw, tw) = (5i32, 32i32);
        let mut b0 = Vec::new();
        for w in [0x3159_4142i32, 0, 0, 160, 40, gw, 0, 0, 5, tw, 0, 0, 0, 0, 0, 0] { b0.extend(w.to_le_bytes()); }
        for _ in 0..(gw * gw) { b0.extend(20i16.to_le_bytes()); }
        let mut top0 = vec![150i16; (tw * tw) as usize];
        let mut cls0 = vec![YARD; (tw * tw) as usize];
        for j in 6..9 { for i in 6..10 { top0[(j * tw + i) as usize] = 220; } } // 2.0 m x 1.5 m pillar
        for i in 4..20 { top0[(12 * tw + i) as usize] = 165; } // 1.5 m parapet
        for j in 18..26 { for i in 18..26 { top0[(j * tw + i) as usize] = 200; } } // 4 m x 4 m penthouse
        top0[(3 * tw + 27) as usize] = 240;
        cls0[(3 * tw + 27) as usize] = YARD | CANOPY; // tree crown must stay untouched
        for t in &top0 { b0.extend(t.to_le_bytes()); }
        b0.extend(&cls0);
        b0.extend(vec![0u8; (tw * tw) as usize]);
        let p0 = read(&b0).expect("valid L0 pack");
        for j in 6..9 {
            for i in 6..10 {
                assert_eq!(p0.top[(j * tw + i) as usize], 150, "L0 pillar at ({i},{j}) should be removed");
            }
        }
        assert_eq!(p0.top[(12 * tw + 10) as usize], 165, "1.5 m parapet must stay");
        assert_eq!(p0.top[(21 * tw + 21) as usize], 200, "4 m x 4 m penthouse must stay");
        assert_eq!(p0.top[(3 * tw + 27) as usize], 240, "canopy spike must stay");

        // L1 (tstep=20, 2.0 m samples): flat BUILT roof at 150 with a 1-cell spike (220), a 2-cell straddling
        // spike (216), and a 2x5 (4 m x 10 m) taller rowhouse (220).
        let mut b1 = Vec::new();
        for w in [0x3159_4142i32, 0, 0, 640, 160, gw, 0, 0, 20, tw, 0, 0, 0, 0, 0, 0] { b1.extend(w.to_le_bytes()); }
        for _ in 0..(gw * gw) { b1.extend(20i16.to_le_bytes()); }
        let mut top1 = vec![150i16; (tw * tw) as usize];
        let cls1 = vec![YARD | BUILT; (tw * tw) as usize];
        top1[(5 * tw + 5) as usize] = 220; // 1-cell spike
        top1[(10 * tw + 10) as usize] = 216;
        top1[(10 * tw + 11) as usize] = 216; // 2-cell straddling spike
        for j in 16..21 { for i in 16..18 { top1[(j * tw + i) as usize] = 220; } } // 4 m x 10 m rowhouse
        for t in &top1 { b1.extend(t.to_le_bytes()); }
        b1.extend(&cls1);
        b1.extend(vec![0u8; (tw * tw) as usize]);
        let p1 = read(&b1).expect("valid L1 pack");
        assert_eq!(p1.top[(5 * tw + 5) as usize], 150, "L1 1-cell spike should be removed");
        assert_eq!(p1.top[(10 * tw + 10) as usize], 150, "L1 2-cell spike should be removed");
        assert_eq!(p1.top[(10 * tw + 11) as usize], 150, "L1 2-cell spike should be removed");
        assert_eq!(p1.top[(18 * tw + 16) as usize], 220, "4 m x 10 m rowhouse must stay");
    }

    #[test]
    fn aerial_cables_rasterize_slim_and_open_columns_below_them_hit_cache() {
        let mut b = pack();
        // Add a horizontal trolley wire (rad=3 cm in tile format, steel dark) at y=160 spanning x=60..140, z=50 (over road).
        let wire: [i32; 8] = [60, 160, 50, 140, 160, 50, 3, kind(STEEL, grey(14)) as i32];
        b.extend_from_slice(b"SFST");
        b.extend_from_slice(&1u32.to_le_bytes());
        for w in wire { b.extend_from_slice(&w.to_le_bytes()); }
        let at = room(b.len());
        unsafe { std::ptr::copy_nonoverlapping(b.as_ptr(), at, b.len()) };
        assert_eq!(load(), 1);
        // Check cable_rows emits slim 1-2 fine subcells per cross-section (never 3x3 bloated pipes) and zero gaps.
        let p = PACKS.with_borrow(|ps| ps[0].fixture_spans(100, 50, 1));
        assert_eq!(p.len(), 1);
        let mut rows = Vec::new();
        p[0].cable_rows(100, 50, 128, &mut rows);
        assert!(!rows.is_empty(), "cable must emit fine subcell runs");
        let min_y = rows.iter().map(|r| r.y).min().unwrap();
        let max_y = rows.iter().map(|r| r.y).max().unwrap();
        assert!(max_y - min_y <= 1, "aerial cable vertical thickness must be <= 2 fine subcells (got {})", max_y - min_y + 1);
        // Check kind_single & under return exact road ground below wire (hitting SolidEntry.ceil cache) AND wire at y=160.
        let g = ground(100, 50);
        assert_eq!(material(kind_single(100, g, 50)), ASPHALT);
        assert_eq!(kind_single(100, g + 10, 50), 0);
        assert_eq!(under(100, g + 20, 50, 40), g + 1);
        assert_eq!(material(kind_single(100, 160, 50)), STEEL, "wire remains visible at wire height");
        clear();
    }

    #[test]
    fn unsurveyed_corniced_facade_blends_perimeter_lidar_dropouts() {
        // Unsurveyed corniced building (detail=2, eave=0) with flat roof at y=260 and a perimeter lidar dropout to y=210
        // right along the street edge z=200 (x=280..320). Blending from eave_near must keep the facade unbroken up to 260.
        let mut b = pack();
        // Patch vertex 0 of the house at (200,200) to carry detail=2 (cornice, unsurveyed eave) and street front flag 0x3.
        // Header=64, ground=65*65*2=8450, top=128*128*2=32768, class=16384, tint=16384, bld=24 -> verts at 74074.
        let top_off = 64 + 65 * 65 * 2;
        let verts_off = top_off + 128 * 128 * 2 + 128 * 128 + 128 * 128 + 24;
        // Drop lidar top right on the front lip j=40 (z=200..204), i=56..64 (x=280..319) down to 210 while j>=41 stays 260.
        for i in 56..64 {
            let k = top_off + (40 * 128 + i) * 2;
            b[k..k + 2].copy_from_slice(&210i16.to_le_bytes());
        }
        // Set v0 looks = 0x3 | (2 << 24) (cornice, unsurveyed eave).
        let v0_looks = (3i32 | (2 << 24)).to_le_bytes();
        b[verts_off + 8..verts_off + 12].copy_from_slice(&v0_looks);
        let at = room(b.len());
        unsafe { std::ptr::copy_nonoverlapping(b.as_ptr(), at, b.len()) };
        assert_eq!(load(), 1);
        // At x=300, z=201 (far=1.5 inside front lip), y=208..212 must NOT be air, ROOFING, or floating mid-wall cornice trim.
        for y in 207..=214 {
            let k = kind_single(300, y, 201);
            assert_ne!(k, 0, "perimeter lidar dropout must not carve air notch at y={y}");
            assert_ne!(material(k), ROOFING, "perimeter lidar dropout must not emit mid-wall roofing at y={y}");
        }
        // Wall continues cleanly up near the eave (260).
        assert_ne!(kind_single(300, 250, 201), 0, "wall must continue unbroken up to eave");
        clear();
    }
}

#[cfg(test)]
mod header_limits {
    use super::*;

    #[test]
    fn marks_reject_impossible_counts() {
        for (covers, segments) in [(-1, 0), (0, -1), (i32::MAX, 0), (0, i32::MAX)] {
            ROOM.with_borrow_mut(|r| *r = [0x4b52_414d, covers, segments].into_iter().flat_map(i32::to_le_bytes).collect());
            assert_eq!(marks(), -1);
        }
    }

    #[test]
    fn pack_rejects_oversize_grids_and_spans() {
        for (gw, step, tw) in [(i32::MAX, 1, 0), (2, 1, i32::MAX), (3, i32::MAX, 2)] {
            let words = [0x3159_4142, 0, 0, 0, step, gw, 0, 0, 1, tw, 0, 0, 0, 0, 0, 0];
            let bytes: Vec<_> = words.into_iter().flat_map(i32::to_le_bytes).collect();
            assert!(read(&bytes).is_none());
        }
    }
}
