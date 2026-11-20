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
use crate::kinds::*;
use crate::scratch::{Run, Scratch};
use crate::tree::{Kind, SIDE, at};
use std::cell::{Cell, RefCell};

thread_local! {
    static ON: Cell<bool> = const { Cell::new(false) };
    static PACKS: RefCell<Vec<Pack>> = const { RefCell::new(Vec::new()) };
    static ROOM: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
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
    /// 1: a round tower of concrete, fluted, with an arcade under its top.
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
    let verts: Vec<[i32; 3]> = ints(take(nv.checked_mul(12)?)?).chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect();
    let trunks: Vec<[i32; 4]> = ints(take(nt.checked_mul(16)?)?).chunks_exact(4).map(|v| [v[0], v[1], v[2], v[3]]).collect();
    let mut fixtures = Vec::new();
    if from < b.len() {
        let extra = b.get(from..)?;
        if extra.get(..4)? != b"SFST" { return None; }
        let n = u32::from_le_bytes(extra.get(4..8)?.try_into().ok()?) as usize;
        if n.checked_mul(32)? != extra.len().checked_sub(8)? { return None; }
        for chunk in extra[8..].chunks_exact(32) {
            let r: [i32; 8] = ints(chunk).try_into().ok()?;
            if !(1..=100).contains(&r[6]) || !(1..=65535).contains(&r[7])
                || r[..6].iter().any(|v| v.unsigned_abs() > 10_000_000) { return None; }
            fixtures.push(r);
        }
    }
    let mut buildings = Vec::with_capacity(nb);
    for r in rows.chunks_exact(6) {
        let (first, count) = (r[0] as usize, r[1] as usize);
        let own = verts.get(first..first.checked_add(count)?)?;
        if own.is_empty() {
            return None;
        }
        let style = r[4] as u32;
        buildings.push(Building {
            first,
            count,
            wall: r[2] as Kind,
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
    let mut p = Pack { gstep: head[4], gw: head[5], gx0: head[6], gz0: head[7], ground, tstep: head[8], tw: tw as i32, tx0: head[10], tz0: head[11], top, class, tint, walls, buildings, verts, trunks, near: Vec::new(), stems: Vec::new(), fixtures, fixtures_near: Vec::new(), pw: 0, lows: Vec::new(), highs: Vec::new(), bw: 0 };
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

impl Pack {
    /// Whether the pack knows a column: its samples reach round it.
    fn holds(&self, x: i32, z: i32) -> bool {
        let wide = (self.gw - 1) * self.gstep;
        x >= self.gx0 && z >= self.gz0 && x < self.gx0 + wide && z < self.gz0 + wide
    }

    /// The ground's top cell at a column: between the four samples round it.
    fn ground(&self, x: i32, z: i32) -> i32 {
        let (fx, fz) = ((x - self.gx0) as f32 / self.gstep as f32, (z - self.gz0) as f32 / self.gstep as f32);
        let (i, j) = ((fx as i32).clamp(0, self.gw - 2), (fz as i32).clamp(0, self.gw - 2));
        let (u, v) = ((fx - i as f32).clamp(0.0, 1.0), (fz - j as f32).clamp(0.0, 1.0));
        let s = |i: i32, j: i32| self.ground[(j * self.gw + i) as usize] as f32;
        let (a, b, c, d) = (s(i, j), s(i + 1, j), s(i, j + 1), s(i + 1, j + 1));
        // Water is level: beside the shore the bed does not climb the bank a sample early.
        if a.min(b).min(c).min(d) <= BED as f32 {
            return s(i + (u > 0.5) as i32, j + (v > 0.5) as i32) as i32;
        }
        (a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v + 0.5).floor() as i32
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
        (c & !7 | if road > 0.5 { ROAD } else { PAVEMENT }, tint)
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
            let rad = r[6] as f32/10.0 + if cable && size == 2 { 0.3 } else { size as f32*0.71 };
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
        (6.0 + (b.seed % 2) as f32, 9, storey - 6, 0)
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
        _ => if deep < 1.0 { 0 } else if deep < 2.0 { if mu.abs() < 0.6 || (fy - foot) == (head - foot) / 2 { b.trim } else { glass } } else { dark },
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
    /// The ground's top cell's kind, and how many cells of it stand over the ground (a pavement's kerb).
    ground: Kind,
    kerb: i32,
    what: What<'a>,
    fixtures: Vec<FixtureSpan>,
}

enum What<'a> {
    Open,
    /// In a building: its roof's cell and colour.
    In(&'a Building, Probe, i32, u8),
    /// Just outside one, where its bays and cornice stand: how high its wall is there.
    By(&'a Building, Probe, i32),
    /// Leaves from here up to there, and a trunk up to so high if one stands in this column.
    Crown(i32, i32, Option<i32>),
    /// A building seen from far, from a pack with no outlines: its roof's cell and colour, and its wall.
    Mass(i32, u8, Kind),
}

fn column<'a>(packs: &'a [Pack], x: i32, z: i32, size: i32) -> Column<'a> {
    let Some(p) = pick(packs, x, z, size) else {
        return Column { g: BED, ground: kind(SAND, OWN), kerb: 0, fixtures: Vec::new(), what: What::Open };
    };
    let g = p.ground(x, z);
    let (class, tint) = p.surface(x, z);
    let (ground, kerb) = match class & 7 {
        ROAD if class & 64 != 0 => (kind(STEEL, grey(8)), 0),
        ROAD if class & 32 != 0 => (kind(CONCRETE, grey(1)), 0),
        ROAD => (kind(ASPHALT, OWN), 0),
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
                (eave as f32 + (raster - eave) as f32 * blend).round() as i32
            } else { raster }.max(g + 22);
            What::In(b, probe, roof, tint)
        }
        Some((b, probe)) if size <= 2 && probe.looks & 2 != 0 => {
            // The wall's height where this column is nearest it: a little way in from the outline.
            let (dx, dz) = (probe.on[0] - (x as f32 + 0.5), probe.on[1] - (z as f32 + 0.5));
            let far = probe.far.max(0.01);
            let (ix, iz) = ((probe.on[0] + dx / far * 4.0) as i32, (probe.on[1] + dz / far * 4.0) as i32);
            match if probe.looks & 128 != 0 { Some((probe.looks >> 8) as i16 as i32) } else { p.top(ix, iz) } {
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
                        What::Crown(foot, t, (far <= (trunk[3] & 255) as f32 + 0.5).then(|| t - 8))
                    }
                    // A bush or a hedge is leaves to the ground.
                    _ => What::Crown(if tall < 28 { g + 1 } else { t - (tall / 2).clamp(10, 40) + ragged }, t, None),
                }
            }
            _ => What::Open,
        },
        _ => What::Open,
    };
    Column { g, ground, kerb, fixtures: p.fixture_spans(x,z,size), what }
}

/// The kind of the cell whose low corner is at height `y` in a column (cells of `size`: `y` is a multiple of it).
fn kind_at(c: &Column, x: i32, y: i32, z: i32, size: i32) -> Kind {
    // A coarse cell is what its middle is.
    let mid = y + size / 2;
    if mid <= c.g {
        return if mid >= c.g - 3 * size.max(2) { c.ground } else { kind(EARTH, OWN) };
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
            if detail & 2 != 0 && p.far <= 4.0 && up >= top-4 && up <= top+3 { return b.trim; }
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
        What::Crown(foot, top, trunk) => {
            if trunk.is_some_and(|t| mid <= t) {
                kind(WOOD, colour(2, 9))
            } else if size == 1 && mid <= c.g + c.kerb {
                c.ground
            } else if mid < *foot || mid > *top {
                0
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
        (lo, hi)
    });
    ((lo - DEEP).div_euclid(size), (hi + 4).div_euclid(size))
}

/// Makes one sector of the Bay in `s`, at the coarseness `s` was started with.
pub fn make(s: &mut Scratch) {
    let (k, size) = (s.lod, 1i32 << s.lod);
    let side = SIDE as i32;
    let mut cables = Vec::new();
    PACKS.with_borrow(|packs| {
        for cz in 0..side {
            for cx in 0..side {
                let (x, z) = (((s.low[0] + cx) << k) + size / 2, ((s.low[2] + cz) << k) + size / 2);
                let mut c = column(packs, x, z, size);
                if s.finer && k == 0 {
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
