//! Elevated highway bridges, viaducts, overpass ramps, and untagged overpasses for San Francisco (#228).
//!
//! Loaded once per core from compact `bay/bridges.bin` bytes (`sf/bridges.mjs`, surveyed from 0.25 m USGS LiDAR,
//! 1 m bare-earth DEM, and OSM street graphs by `bay/bridges_survey.py`) into a zero-per-bucket-allocation CSR
//! spatial index. Supports arbitrarily stacked multi-level viaducts (up to 4 decks per column), smooth quarter-cell
//! driving surfaces, built-in lane markings that never bleed onto streets underneath, concrete box-girder decks with
//! cantilevered overhangs, merge-aware Jersey barriers, and road-clear concrete piers + bent caps.

use crate::kinds::*;
use crate::scratch::Run;
use crate::tree::Kind;

const BRIDGE_MAGIC: i32 = 0x4744_5242; // 'BRDG'
const BRIDGE_VERSION: i32 = 1;
/// Spatial bucket size: 256 cells = 25.6 m.
const BUCKET_SHIFT: i32 = 8;
const MAX_SPANS: usize = (1 << 16) - 1;
const MAX_VERTS_PER_SPAN: usize = 4096;
const MAX_TOTAL_VERTS: usize = 500_000;
const MAX_PIERS: usize = 100_000;

pub const FLAG_MOTORWAY: u16 = 1;
pub const FLAG_BARRIER_L: u16 = 2;
pub const FLAG_BARRIER_R: u16 = 4;
pub const FLAG_CAP_START: u16 = 16;
pub const FLAG_CAP_END: u16 = 32;
pub const FLAG_TWO_WAY: u16 = 4096;

const VFLAG_LEFT_OPEN: u8 = 1;
const VFLAG_RIGHT_OPEN: u8 = 2;
const VFLAG_RAMP_IN: u8 = 4;

#[derive(Clone, Copy)]
struct BridgeVert {
    x: i32,
    z: i32,
    /// Deck driving surface top in quarter-cells (2.5 cm), matching ground `road_top4 - 4`.
    y4: i32,
    /// Left half-width in 10 cm cells.
    hl: u8,
    /// Right half-width in 10 cm cells.
    hr: u8,
    vflags: u8,
    /// Cumulative arc length from span start in 10 cm cells (for continuous dashed lane stripes).
    arc: f32,
}

#[derive(Clone, Copy)]
struct BridgeSpan {
    first: u32,
    count: u16,
    flags: u16,
    thick: u8,
}

#[derive(Clone, Copy)]
pub struct BridgePier {
    pub x: i32,
    pub z: i32,
    pub y_top: i16,
    pub y_bot: i16,
    pub rad: u8,
    pub nx: i8,
    pub nz: i8,
    pub cap_l: u8,
    pub cap_r: u8,
}

/// Precomputed bridge segment hoisted once per sector column so all 4,096 columns evaluate cheaply.
#[derive(Clone, Copy)]
pub struct BridgeSegEval {
    ax: f32,
    az: f32,
    bx: f32,
    bz: f32,
    len: f32,
    nx: f32,
    nz: f32,
    /// Unit forward bisector normal at vertex A (perpendicular to segment at span start).
    ta_x: f32,
    ta_z: f32,
    /// Unit forward bisector normal at vertex B (perpendicular to segment at span end).
    tb_x: f32,
    tb_z: f32,
    /// Longitudinal overlap past vertex A/B (cells): 0 at grounded abutments, 0.05 at interior bisectors, 10 at elevated junctions.
    ext_start: f32,
    ext_end: f32,
    y4_a: f32,
    y4_b: f32,
    hl_a: f32,
    hr_a: f32,
    hl_b: f32,
    hr_b: f32,
    vf_a: u8,
    vf_b: u8,
    arc_a: f32,
    flags: u16,
    thick: i32,
    min_x: f32,
    max_x: f32,
    min_z: f32,
    max_z: f32,
}

/// One elevated bridge deck level intersecting a column `(x, z)`.
/// Up to 4 stacked decks can overlap the same `(x, z)` (e.g. 4-level I-280 / US-101 Alemany viaduct).
#[derive(Clone, Copy)]
pub struct BridgeHit {
    /// Driving surface top cell `g` (matches `ground_height` cell convention: cell `top_g` is top solid road cell).
    pub top_g: i32,
    /// Driving surface top in quarter-cells (`(y_cells + 1.0) * 4`, matching `Column::road_top4`).
    pub top4: i32,
    /// Bottom solid cell of box-girder structural soffit (including cantilevered edge chamfer).
    pub soffit: i32,
    /// Structural slab thickness (cells).
    pub thick: i32,
    /// Distance in cells inward from the outer edge of the deck (0 at outer edge).
    pub edge_dist: f32,
    /// Signed lateral offset from road centerline in cells (+ left, - right) for lane markings.
    pub signed: f32,
    /// Left & right half-widths at this column (cells).
    pub hl: f32,
    pub hr: f32,
    /// Cumulative arc length along the span in cells (for dashed lane lines).
    pub along: f32,
    /// True when this column lies on an outer concrete Jersey barrier / parapet.
    pub on_barrier: bool,
    /// True when on the outer sidewalk strip of a non-motorway city street bridge.
    pub on_sidewalk: bool,
    /// True when this column is on a grounded ramp-in transition (barriers taper out, asphalt blends into street).
    pub ramp_in: bool,
    /// Span flags (motorway, lanes, layer, two-way).
    pub flags: u16,
}

impl BridgeHit {
    #[inline]
    pub fn top_solid(&self, ground_g: i32) -> i32 {
        if self.on_barrier && !self.ramp_in && self.top_g - ground_g >= 8 {
            self.top_g + 9
        } else if self.on_sidewalk && !self.ramp_in && self.top_g - ground_g >= 6 {
            self.top_g + 1
        } else {
            self.top_g
        }
    }

    #[inline]
    pub fn layer(&self) -> i32 {
        (((self.flags >> 9) & 7) as i32) - 2
    }

    #[inline]
    pub fn lanes(&self) -> i32 {
        (((self.flags >> 6) & 7) as i32).max(1)
    }

    #[inline]
    pub fn is_motorway(&self) -> bool {
        self.flags & FLAG_MOTORWAY != 0
    }

    #[inline]
    pub fn is_two_way(&self) -> bool {
        self.flags & FLAG_TWO_WAY != 0
    }
}

/// One concrete viaduct pier column or bent-cap beam intersecting a column `(x, z)`.
#[derive(Clone, Copy)]
pub struct PierHit {
    pub y_bot: i32,
    pub y_top: i32,
    pub is_cap_only: bool,
}

/// Per-column stack of bridge decks (up to 4 vertically separated levels) and pier hits (up to 2).
#[derive(Clone, Copy)]
pub struct ColumnBridges {
    pub decks: [Option<BridgeHit>; 4],
    pub deck_n: u8,
    pub piers: [Option<PierHit>; 2],
    pub pier_n: u8,
}

impl ColumnBridges {
    pub const EMPTY: Self = Self {
        decks: [None; 4],
        deck_n: 0,
        piers: [None; 2],
        pier_n: 0,
    };

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.deck_n == 0 && self.pier_n == 0
    }

    /// Highest cell emitted by any deck, barrier, or pier in this column.
    #[inline]
    pub fn max_y(&self, ground_g: i32) -> i32 {
        let mut hi = i32::MIN;
        for i in 0..self.deck_n as usize {
            if let Some(d) = self.decks[i] {
                hi = hi.max(d.top_solid(ground_g));
            }
        }
        for i in 0..self.pier_n as usize {
            if let Some(p) = self.piers[i] {
                hi = hi.max(p.y_top);
            }
        }
        hi
    }

    /// Lowest elevated bridge soffit above `ground_g`, if any (used to clip ground trees/fixtures from poking through decks).
    #[inline]
    pub fn lowest_soffit_above(&self, ground_g: i32) -> Option<i32> {
        let mut lo = i32::MAX;
        for i in 0..self.deck_n as usize {
            if let Some(d) = self.decks[i] {
                if d.top_g > ground_g + 8 {
                    lo = lo.min(d.soffit);
                }
            }
        }
        (lo < i32::MAX).then_some(lo)
    }

    /// True if any deck covers this column within `pad` cells vertically above ground (suppresses ground trunks).
    #[inline]
    pub fn has_deck(&self) -> bool {
        self.deck_n > 0
    }
}

#[derive(Default)]
pub struct Bridges {
    verts: Vec<BridgeVert>,
    spans: Vec<BridgeSpan>,
    piers: Vec<BridgePier>,
    bx0: i32,
    bz0: i32,
    bw: i32,
    bh: i32,
    seg_offsets: Vec<u32>,
    /// Packed `(span_idx << 12) | seg_idx`.
    seg_ids: Vec<u32>,
    pier_offsets: Vec<u32>,
    pier_ids: Vec<u32>,
    /// Max bridge top cell (+ barrier) per spatial bucket for O(buckets) `bay::span` height bounds.
    bucket_max_y: Vec<i16>,
    /// 1 if bucket lies within ~150 m of any motorway bridge/viaduct corridor (scopes steep-embankment cleanup).
    bucket_near_motorway: Vec<u8>,
}

impl Bridges {
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 20 || bytes.len() > 64 << 20 {
            return None;
        }
        let rd_i32 = |o: usize| i32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
        let rd_u16 = |o: usize| u16::from_le_bytes([bytes[o], bytes[o + 1]]);
        let rd_i16 = |o: usize| i16::from_le_bytes([bytes[o], bytes[o + 1]]);
        if rd_i32(0) != BRIDGE_MAGIC || rd_i32(4) != BRIDGE_VERSION {
            return None;
        }
        let n_spans = usize::try_from(rd_i32(8)).ok()?;
        let n_verts = usize::try_from(rd_i32(12)).ok()?;
        let n_piers = usize::try_from(rd_i32(16)).ok()?;
        if n_spans > MAX_SPANS || n_verts > MAX_TOTAL_VERTS || n_piers > MAX_PIERS {
            return None;
        }
        if n_spans == 0 && n_piers == 0 {
            return Some(Self::default());
        }

        let mut verts = Vec::with_capacity(n_verts);
        let mut spans = Vec::with_capacity(n_spans);
        let mut off = 20usize;
        let (mut min_bx, mut max_bx) = (i32::MAX, i32::MIN);
        let (mut min_bz, mut max_bz) = (i32::MAX, i32::MIN);

        let record_box = |x0: i32, z0: i32, x1: i32, z1: i32, min_bx: &mut i32, max_bx: &mut i32, min_bz: &mut i32, max_bz: &mut i32| {
            *min_bx = (*min_bx).min(x0 >> BUCKET_SHIFT);
            *max_bx = (*max_bx).max(x1 >> BUCKET_SHIFT);
            *min_bz = (*min_bz).min(z0 >> BUCKET_SHIFT);
            *max_bz = (*max_bz).max(z1 >> BUCKET_SHIFT);
        };

        for _ in 0..n_spans {
            if off + 8 > bytes.len() {
                return None;
            }
            let flags = rd_u16(off);
            let thick = bytes[off + 2].clamp(4, 40);
            let m = rd_u16(off + 4) as usize;
            off += 8;
            if !(2..=MAX_VERTS_PER_SPAN).contains(&m) {
                return None;
            }
            let need = off.checked_add(16)?.checked_add((m - 1).checked_mul(10)?)?;
            if need > bytes.len() || verts.len() + m > n_verts {
                return None;
            }
            let first = verts.len() as u32;
            let mut x = rd_i32(off);
            let mut z = rd_i32(off + 4);
            let mut y4 = rd_i32(off + 8);
            let hl0 = bytes[off + 12];
            let hr0 = bytes[off + 13];
            let vf0 = bytes[off + 14];
            off += 16;
            let pad0 = ((hl0.max(hr0) as i32) * 3) / 2 + 24;
            record_box(x - pad0, z - pad0, x + pad0, z + pad0, &mut min_bx, &mut max_bx, &mut min_bz, &mut max_bz);
            let mut arc = 0.0f32;
            verts.push(BridgeVert { x, z, y4, hl: hl0, hr: hr0, vflags: vf0, arc });
            for _ in 1..m {
                let dx = rd_i16(off) as i32;
                let dz = rd_i16(off + 2) as i32;
                let dy4 = rd_i16(off + 4) as i32;
                let hl = bytes[off + 6];
                let hr = bytes[off + 7];
                let vf = bytes[off + 8];
                off += 10;
                x = x.checked_add(dx)?;
                z = z.checked_add(dz)?;
                y4 = y4.checked_add(dy4)?;
                arc += ((dx * dx + dz * dz) as f32).sqrt();
                let pad = ((hl.max(hr) as i32) * 3) / 2 + 24;
                record_box(x - pad, z - pad, x + pad, z + pad, &mut min_bx, &mut max_bx, &mut min_bz, &mut max_bz);
                verts.push(BridgeVert { x, z, y4, hl, hr, vflags: vf, arc });
            }
            spans.push(BridgeSpan { first, count: m as u16, flags, thick });
        }

        let pier_need = off.checked_add(n_piers.checked_mul(20)?)?;
        if pier_need != bytes.len() || verts.len() != n_verts {
            return None;
        }
        let mut piers = Vec::with_capacity(n_piers);
        for _ in 0..n_piers {
            let x = rd_i32(off);
            let z = rd_i32(off + 4);
            let y_top = rd_i16(off + 8);
            let y_bot = rd_i16(off + 10);
            let rad = bytes[off + 12];
            let nx = bytes[off + 13] as i8;
            let nz = bytes[off + 14] as i8;
            let cap_l = bytes[off + 16];
            let cap_r = bytes[off + 17];
            off += 20;
            let reach = (rad as i32).max(cap_l.max(cap_r) as i32) + 12;
            record_box(x - reach, z - reach, x + reach, z + reach, &mut min_bx, &mut max_bx, &mut min_bz, &mut max_bz);
            piers.push(BridgePier { x, z, y_top, y_bot, rad, nx, nz, cap_l, cap_r });
        }

        let bw = max_bx.checked_sub(min_bx)?.checked_add(1)?;
        let bh = max_bz.checked_sub(min_bz)?.checked_add(1)?;
        let n_buckets = usize::try_from(bw).ok()?.checked_mul(usize::try_from(bh).ok()?)?;
        if bw <= 0 || bh <= 0 || n_buckets > 4_000_000 {
            return None;
        }

        // 2-pass CSR for segments + bucket max height + motorway corridor mask
        let mut seg_counts = vec![0u32; n_buckets];
        let mut bucket_max_y = vec![i16::MIN; n_buckets];
        let mut bucket_near_motorway = vec![0u8; n_buckets];
        for sp in &spans {
            let start = sp.first as usize;
            let segs = (sp.count as usize).saturating_sub(1);
            let is_mw = (sp.flags & FLAG_MOTORWAY) != 0;
            for si in 0..segs {
                let a = verts[start + si];
                let b = verts[start + si + 1];
                let pad = ((a.hl.max(a.hr).max(b.hl).max(b.hr) as i32) * 3) / 2 + 24;
                let x0 = (((a.x.min(b.x) - pad) >> BUCKET_SHIFT) - min_bx).clamp(0, bw - 1);
                let x1 = (((a.x.max(b.x) + pad) >> BUCKET_SHIFT) - min_bx).clamp(0, bw - 1);
                let z0 = (((a.z.min(b.z) - pad) >> BUCKET_SHIFT) - min_bz).clamp(0, bh - 1);
                let z1 = (((a.z.max(b.z) + pad) >> BUCKET_SHIFT) - min_bz).clamp(0, bh - 1);
                let top_hi = ((a.y4.max(b.y4) >> 2) + 14).clamp(-32767, 32767) as i16;
                for bz in z0..=z1 {
                    let row = (bz * bw) as usize;
                    for bx in x0..=x1 {
                        let idx = row + bx as usize;
                        seg_counts[idx] += 1;
                        if top_hi > bucket_max_y[idx] {
                            bucket_max_y[idx] = top_hi;
                        }
                    }
                }
                if is_mw {
                    let mx0 = (x0 - 6).max(0);
                    let mx1 = (x1 + 6).min(bw - 1);
                    let mz0 = (z0 - 6).max(0);
                    let mz1 = (z1 + 6).min(bh - 1);
                    for bz in mz0..=mz1 {
                        let row = (bz * bw) as usize;
                        for bx in mx0..=mx1 {
                            bucket_near_motorway[row + bx as usize] = 1;
                        }
                    }
                }
            }
        }
        let mut seg_offsets = Vec::with_capacity(n_buckets + 1);
        let mut total_segs = 0u32;
        for &c in &seg_counts {
            seg_offsets.push(total_segs);
            total_segs = total_segs.checked_add(c)?;
        }
        seg_offsets.push(total_segs);
        let mut seg_cursor = seg_offsets[..n_buckets].to_vec();
        let mut seg_ids = vec![0u32; total_segs as usize];
        for (spi, sp) in spans.iter().enumerate() {
            let start = sp.first as usize;
            let segs = (sp.count as usize).saturating_sub(1);
            for si in 0..segs {
                let a = verts[start + si];
                let b = verts[start + si + 1];
                let pad = ((a.hl.max(a.hr).max(b.hl).max(b.hr) as i32) * 3) / 2 + 24;
                let x0 = (((a.x.min(b.x) - pad) >> BUCKET_SHIFT) - min_bx).clamp(0, bw - 1);
                let x1 = (((a.x.max(b.x) + pad) >> BUCKET_SHIFT) - min_bx).clamp(0, bw - 1);
                let z0 = (((a.z.min(b.z) - pad) >> BUCKET_SHIFT) - min_bz).clamp(0, bh - 1);
                let z1 = (((a.z.max(b.z) + pad) >> BUCKET_SHIFT) - min_bz).clamp(0, bh - 1);
                let id = ((spi as u32) << 12) | (si as u32);
                for bz in z0..=z1 {
                    let row = (bz * bw) as usize;
                    for bx in x0..=x1 {
                        let idx = row + bx as usize;
                        let slot = seg_cursor[idx] as usize;
                        seg_ids[slot] = id;
                        seg_cursor[idx] = (slot + 1) as u32;
                    }
                }
            }
        }

        // 2-pass CSR for piers
        let mut pier_counts = vec![0u32; n_buckets];
        for p in &piers {
            let reach = (p.rad as i32).max(p.cap_l.max(p.cap_r) as i32) + 12;
            let x0 = ((p.x - reach) >> BUCKET_SHIFT) - min_bx;
            let x1 = ((p.x + reach) >> BUCKET_SHIFT) - min_bx;
            let z0 = ((p.z - reach) >> BUCKET_SHIFT) - min_bz;
            let z1 = ((p.z + reach) >> BUCKET_SHIFT) - min_bz;
            for bz in z0..=z1 {
                let row = (bz * bw) as usize;
                for bx in x0..=x1 {
                    let idx = row + bx as usize;
                    pier_counts[idx] += 1;
                    if p.y_top > bucket_max_y[idx] {
                        bucket_max_y[idx] = p.y_top;
                    }
                }
            }
        }
        let mut pier_offsets = Vec::with_capacity(n_buckets + 1);
        let mut total_piers = 0u32;
        for &c in &pier_counts {
            pier_offsets.push(total_piers);
            total_piers = total_piers.checked_add(c)?;
        }
        pier_offsets.push(total_piers);
        let mut pier_cursor = pier_offsets[..n_buckets].to_vec();
        let mut pier_ids = vec![0u32; total_piers as usize];
        for (pi, p) in piers.iter().enumerate() {
            let reach = (p.rad as i32).max(p.cap_l.max(p.cap_r) as i32) + 12;
            let x0 = ((p.x - reach) >> BUCKET_SHIFT) - min_bx;
            let x1 = ((p.x + reach) >> BUCKET_SHIFT) - min_bx;
            let z0 = ((p.z - reach) >> BUCKET_SHIFT) - min_bz;
            let z1 = ((p.z + reach) >> BUCKET_SHIFT) - min_bz;
            for bz in z0..=z1 {
                let row = (bz * bw) as usize;
                for bx in x0..=x1 {
                    let idx = row + bx as usize;
                    let slot = pier_cursor[idx] as usize;
                    pier_ids[slot] = pi as u32;
                    pier_cursor[idx] = (slot + 1) as u32;
                }
            }
        }

        Some(Self {
            verts,
            spans,
            piers,
            bx0: min_bx,
            bz0: min_bz,
            bw,
            bh,
            seg_offsets,
            seg_ids,
            pier_offsets,
            pier_ids,
            bucket_max_y,
            bucket_near_motorway,
        })
    }

    pub fn span_count(&self) -> usize {
        self.spans.len()
    }

    /// True if `(x, z)` lies within ~150 m of a surveyed motorway bridge/viaduct corridor.
    #[inline]
    pub fn near_motorway(&self, x: i32, z: i32) -> bool {
        if self.bw <= 0 || self.bh <= 0 {
            return false;
        }
        let bx = (x >> BUCKET_SHIFT) - self.bx0;
        let bz = (z >> BUCKET_SHIFT) - self.bz0;
        if bx < 0 || bx >= self.bw || bz < 0 || bz >= self.bh {
            return false;
        }
        self.bucket_near_motorway[(bz * self.bw + bx) as usize] != 0
    }

    /// True if any part of `[x0, x1] x [z0, z1]` touches a motorway bridge/viaduct corridor.
    pub fn near_motorway_box(&self, x0: i32, z0: i32, x1: i32, z1: i32) -> bool {
        if self.bw <= 0 || self.bh <= 0 {
            return false;
        }
        let bx0 = ((x0 >> BUCKET_SHIFT) - self.bx0).max(0);
        let bx1 = ((x1 >> BUCKET_SHIFT) - self.bx0).min(self.bw - 1);
        let bz0 = ((z0 >> BUCKET_SHIFT) - self.bz0).max(0);
        let bz1 = ((z1 >> BUCKET_SHIFT) - self.bz0).min(self.bh - 1);
        if bx0 > bx1 || bz0 > bz1 {
            return false;
        }
        for bz in bz0..=bz1 {
            let row = (bz * self.bw) as usize;
            for bx in bx0..=bx1 {
                if self.bucket_near_motorway[row + bx as usize] != 0 {
                    return true;
                }
            }
        }
        false
    }

    /// Maximum bridge/pier height within world cell box `[x0, x1) x [z0, z1)` for `bay::span`.
    pub fn max_y_in(&self, x0: i32, z0: i32, x1: i32, z1: i32) -> i32 {
        if self.bw <= 0 || self.bh <= 0 {
            return i32::MIN;
        }
        let bx0 = (x0 >> BUCKET_SHIFT).max(self.bx0);
        let bx1 = ((x1 - 1) >> BUCKET_SHIFT).min(self.bx0 + self.bw - 1);
        let bz0 = (z0 >> BUCKET_SHIFT).max(self.bz0);
        let bz1 = ((z1 - 1) >> BUCKET_SHIFT).min(self.bz0 + self.bh - 1);
        if bx0 > bx1 || bz0 > bz1 {
            return i32::MIN;
        }
        let mut hi = i16::MIN;
        for bz in bz0..=bz1 {
            let row = ((bz - self.bz0) * self.bw) as usize;
            for bx in bx0..=bx1 {
                let v = self.bucket_max_y[row + (bx - self.bx0) as usize];
                if v > hi {
                    hi = v;
                }
            }
        }
        if hi == i16::MIN { i32::MIN } else { hi as i32 }
    }

    fn eval_of(&self, span_idx: usize, seg_idx: usize) -> Option<BridgeSegEval> {
        let sp = self.spans[span_idx];
        let start = sp.first as usize;
        let count = sp.count as usize;
        let a = self.verts[start + seg_idx];
        let b = self.verts[start + seg_idx + 1];
        let ax = a.x as f32;
        let az = a.z as f32;
        let bx = b.x as f32;
        let bz = b.z as f32;
        let dx = bx - ax;
        let dz = bz - az;
        let len2 = dx * dx + dz * dz;
        if len2 <= 1e-4 {
            return None;
        }
        let len = len2.sqrt();
        let inv_len = 1.0 / len;
        let (ux, uz) = (dx * inv_len, dz * inv_len);
        let (nx, nz) = (-uz, ux);

        // Compute exact Voronoi bisector plane normals at interior vertices so consecutive slabs share
        // the exact diagonal cut across the full width: zero pie-slice cracks on curves, zero protruding
        // semicircles past span ends, zero mid-deck ledges, and zero transverse barriers.
        let (ta_x, ta_z) = if seg_idx > 0 {
            let p = self.verts[start + seg_idx - 1];
            let (pdx, pdz) = ((a.x - p.x) as f32, (a.z - p.z) as f32);
            let plen = (pdx * pdx + pdz * pdz).sqrt();
            if plen > 1e-2 {
                let (pux, puz) = (pdx / plen, pdz / plen);
                if pux * ux + puz * uz > 0.25 {
                    let (sx, sz) = (pux + ux, puz + uz);
                    let sl = (sx * sx + sz * sz).sqrt();
                    (sx / sl, sz / sl)
                } else {
                    (ux, uz)
                }
            } else {
                (ux, uz)
            }
        } else {
            (ux, uz)
        };
        let (tb_x, tb_z) = if seg_idx + 2 < count {
            let n = self.verts[start + seg_idx + 2];
            let (ndx, ndz) = ((n.x - b.x) as f32, (n.z - b.z) as f32);
            let nlen = (ndx * ndx + ndz * ndz).sqrt();
            if nlen > 1e-2 {
                let (nux, nuz) = (ndx / nlen, ndz / nlen);
                if ux * nux + uz * nuz > 0.25 {
                    let (sx, sz) = (ux + nux, uz + nuz);
                    let sl = (sx * sx + sz * sz).sqrt();
                    (sx / sl, sz / sl)
                } else {
                    (ux, uz)
                }
            } else {
                (ux, uz)
            }
        } else {
            (ux, uz)
        };

        let ext_start = if seg_idx > 0 {
            0.05
        } else if (sp.flags & FLAG_CAP_START) != 0 {
            10.0
        } else {
            0.0
        };
        let ext_end = if seg_idx + 2 < count {
            0.05
        } else if (sp.flags & FLAG_CAP_END) != 0 {
            10.0
        } else {
            0.0
        };
        let pad = (a.hl.max(a.hr).max(b.hl).max(b.hr) as f32) * 1.45 + 16.0;
        Some(BridgeSegEval {
            ax,
            az,
            bx,
            bz,
            len,
            nx,
            nz,
            ta_x,
            ta_z,
            tb_x,
            tb_z,
            ext_start,
            ext_end,
            y4_a: a.y4 as f32,
            y4_b: b.y4 as f32,
            hl_a: a.hl as f32,
            hr_a: a.hr as f32,
            hl_b: b.hl as f32,
            hr_b: b.hr as f32,
            vf_a: a.vflags,
            vf_b: b.vflags,
            arc_a: a.arc,
            flags: sp.flags,
            thick: sp.thick as i32,
            min_x: ax.min(bx) - pad,
            max_x: ax.max(bx) + pad,
            min_z: az.min(bz) - pad,
            max_z: az.max(bz) + pad,
        })
    }

    /// Hoist all bridge segments and piers touching `[x0, x1] x [z0, z1]` for one sector column.
    pub fn for_box(&self, x0: i32, z0: i32, x1: i32, z1: i32) -> (Vec<BridgeSegEval>, Vec<BridgePier>) {
        if self.bw <= 0 || self.bh <= 0 {
            return (Vec::new(), Vec::new());
        }
        let bx0 = (x0 >> BUCKET_SHIFT).max(self.bx0);
        let bx1 = (x1 >> BUCKET_SHIFT).min(self.bx0 + self.bw - 1);
        let bz0 = (z0 >> BUCKET_SHIFT).max(self.bz0);
        let bz1 = (z1 >> BUCKET_SHIFT).min(self.bz0 + self.bh - 1);
        if bx0 > bx1 || bz0 > bz1 {
            return (Vec::new(), Vec::new());
        }
        let mut s_ids = Vec::new();
        let mut p_ids = Vec::new();
        for bz in bz0..=bz1 {
            let row = ((bz - self.bz0) * self.bw) as usize;
            for bx in bx0..=bx1 {
                let idx = row + (bx - self.bx0) as usize;
                let slo = self.seg_offsets[idx] as usize;
                let shi = self.seg_offsets[idx + 1] as usize;
                if slo < shi {
                    s_ids.extend_from_slice(&self.seg_ids[slo..shi]);
                }
                let plo = self.pier_offsets[idx] as usize;
                let phi = self.pier_offsets[idx + 1] as usize;
                if plo < phi {
                    p_ids.extend_from_slice(&self.pier_ids[plo..phi]);
                }
            }
        }
        let (fx0, fz0, fx1, fz1) = (x0 as f32, z0 as f32, x1 as f32, z1 as f32);
        let mut segs = Vec::new();
        if !s_ids.is_empty() {
            s_ids.sort_unstable();
            s_ids.dedup();
            segs.reserve(s_ids.len());
            for packed in s_ids {
                let spi = (packed >> 12) as usize;
                let si = (packed & 0xfff) as usize;
                if let Some(e) = self.eval_of(spi, si) {
                    if e.max_x >= fx0 && e.min_x <= fx1 && e.max_z >= fz0 && e.min_z <= fz1 {
                        segs.push(e);
                    }
                }
            }
        }
        let mut piers = Vec::new();
        if !p_ids.is_empty() {
            p_ids.sort_unstable();
            p_ids.dedup();
            piers.reserve(p_ids.len());
            for pid in p_ids {
                let p = self.piers[pid as usize];
                let reach = (p.rad as i32).max(p.cap_l.max(p.cap_r) as i32) + 10;
                if p.x + reach >= x0 && p.x - reach <= x1 && p.z + reach >= z0 && p.z - reach <= z1 {
                    piers.push(p);
                }
            }
        }
        (segs, piers)
    }

    /// Point query for single-column lookups (`column`, `kind_single`, `solid_single`, `under`, `bridge_y_at`).
    pub fn eval_point(&self, px: f32, pz: f32, size: i32) -> ColumnBridges {
        if self.bw <= 0 || self.bh <= 0 {
            return ColumnBridges::EMPTY;
        }
        let bx = (px.floor() as i32) >> BUCKET_SHIFT;
        let bz = (pz.floor() as i32) >> BUCKET_SHIFT;
        if bx < self.bx0 || bx >= self.bx0 + self.bw || bz < self.bz0 || bz >= self.bz0 + self.bh {
            return ColumnBridges::EMPTY;
        }
        let idx = ((bz - self.bz0) * self.bw + (bx - self.bx0)) as usize;
        let slo = self.seg_offsets[idx] as usize;
        let shi = self.seg_offsets[idx + 1] as usize;
        let plo = self.pier_offsets[idx] as usize;
        let phi = self.pier_offsets[idx + 1] as usize;
        if slo == shi && plo == phi {
            return ColumnBridges::EMPTY;
        }
        let mut out = ColumnBridges::EMPTY;
        for &packed in &self.seg_ids[slo..shi] {
            let spi = (packed >> 12) as usize;
            let si = (packed & 0xfff) as usize;
            if let Some(e) = self.eval_of(spi, si) {
                eval_seg_into(&e, px, pz, size, &mut out);
            }
        }
        if size <= 16 {
            for &pid in &self.pier_ids[plo..phi] {
                eval_pier_into(&self.piers[pid as usize], px, pz, size, &mut out);
            }
        }
        out
    }

    /// Return the bridge driving surface cell top (`top_g + 1`, matching `feet_at`) at `(x, z)` matching `layer_hint`,
    /// or `i32::MIN` when no deck at that layer covers `(x, z)`.
    /// Used by `street.ts` so vehicles on `layer=2` stay on the upper flyover, vehicles on `layer=1` stay on the
    /// lower viaduct, and vehicles on `layer=0` ride over untagged overpasses (`way 31487923`) without snapping up
    /// onto overhead `layer >= 1` bridges!
    pub fn deck_y_for_layer(&self, x: i32, z: i32, layer_hint: i32) -> i32 {
        let cb = self.eval_point(x as f32 + 0.5, z as f32 + 0.5, 1);
        if cb.deck_n == 0 {
            return i32::MIN;
        }
        let mut best_y = i32::MIN;
        let mut best_diff = i32::MAX;
        for i in 0..cb.deck_n as usize {
            if let Some(d) = cb.decks[i] {
                let dl = d.layer();
                // For ground-level roads (layer_hint == 0), ONLY match layer <= 0 untagged overpasses (never snap up
                // onto a layer >= 1 bridge hanging overhead!).
                if layer_hint <= 0 && dl > 0 {
                    continue;
                }
                let diff = (dl - layer_hint).abs();
                if diff < best_diff || (diff == best_diff && d.top_g > best_y) {
                    best_diff = diff;
                    best_y = d.top_g + 1;
                }
            }
        }
        best_y
    }
}

/// Evaluate hoisted sector bridge segments & piers for one column `(px, pz)`.
#[inline]
pub fn eval_slice(segs: &[BridgeSegEval], piers: &[BridgePier], px: f32, pz: f32, size: i32) -> ColumnBridges {
    if segs.is_empty() && piers.is_empty() {
        return ColumnBridges::EMPTY;
    }
    let mut out = ColumnBridges::EMPTY;
    for e in segs {
        if px >= e.min_x && px <= e.max_x && pz >= e.min_z && pz <= e.max_z {
            eval_seg_into(e, px, pz, size, &mut out);
        }
    }
    if size <= 16 {
        for p in piers {
            eval_pier_into(p, px, pz, size, &mut out);
        }
    }
    out
}

#[inline]
fn eval_seg_into(e: &BridgeSegEval, px: f32, pz: f32, size: i32, out: &mut ColumnBridges) {
    let ax_dx = px - e.ax;
    let ax_dz = pz - e.az;
    let d_a = ax_dx * e.ta_x + ax_dz * e.ta_z;
    if d_a < -e.ext_start {
        return;
    }
    let d_b = (e.bx - px) * e.tb_x + (e.bz - pz) * e.tb_z;
    if d_b < -e.ext_end {
        return;
    }

    let da_pos = d_a.max(0.0);
    let db_pos = d_b.max(0.0);
    let denom = da_pos + db_pos;
    let t = if denom > 1e-4 { (da_pos / denom).clamp(0.0, 1.0) } else { 0.0 };

    let hl = e.hl_a + (e.hl_b - e.hl_a) * t;
    let hr = e.hr_a + (e.hr_b - e.hr_a) * t;
    let signed = ax_dx * e.nx + ax_dz * e.nz;
    let eff_half = if signed >= 0.0 { hl } else { hr };
    let abs_s = signed.abs();
    // Ensure thin decks stay visible at coarse LODs (size >= 8).
    let lod_pad = if size >= 8 { (size as f32) * 0.35 } else { 0.0 };
    if abs_s > eff_half + lod_pad {
        return;
    }
    let edge_dist = (eff_half - abs_s).max(0.0);

    let y4_f = e.y4_a + (e.y4_b - e.y4_a) * t;
    let top_g = (y4_f * 0.25 + 0.5).floor() as i32;
    let top4 = (y4_f + 4.0).round() as i32;
    let vf = if t < 0.5 { e.vf_a } else { e.vf_b };
    let ramp_in = (vf & VFLAG_RAMP_IN) != 0;
    let left_open = (vf & VFLAG_LEFT_OPEN) != 0 || (e.flags & FLAG_BARRIER_L == 0);
    let right_open = (vf & VFLAG_RIGHT_OPEN) != 0 || (e.flags & FLAG_BARRIER_R == 0);
    let side_open = if signed >= 0.0 { left_open } else { right_open };

    // Cantilevered box-girder wing taper along outer 1.2 m (12 cells) of the soffit
    let wing_lift = if !side_open && edge_dist < 12.0 {
        ((12.0 - edge_dist) * 0.52) as i32
    } else {
        0
    };
    let soffit = top_g - (e.thick - wing_lift).max(4);

    let barrier_w = if size >= 4 { size as f32 } else { 4.2 };
    let on_barrier = !side_open && !ramp_in && edge_dist < barrier_w;
    let is_motorway = (e.flags & FLAG_MOTORWAY) != 0;
    let on_sidewalk = !is_motorway && !side_open && !ramp_in && !on_barrier && edge_dist < 16.0;

    let hit = BridgeHit {
        top_g,
        top4,
        soffit,
        thick: e.thick,
        edge_dist,
        signed,
        hl,
        hr,
        along: e.arc_a + t * e.len,
        on_barrier,
        on_sidewalk,
        ramp_in,
        flags: e.flags,
    };

    // Merge with an existing deck hit at the same vertical level (within 1.8 m = 18 cells) so curved joints and
    // flush ramp merges fuse seamlessly with ZERO internal barriers!
    for i in 0..out.deck_n as usize {
        if let Some(prev) = out.decks[i] {
            if (prev.top_g - hit.top_g).abs() <= 18 {
                let merged_barrier = prev.on_barrier && hit.on_barrier;
                let merged_sidewalk = prev.on_sidewalk && hit.on_sidewalk;
                let merged_edge = prev.edge_dist.max(hit.edge_dist);
                let merged_soffit = prev.soffit.min(hit.soffit);
                let merged_ramp = prev.ramp_in || hit.ramp_in;
                // Prefer mainline motorway surface/lane markings over merging link ramp when overlapping
                let keep_new = hit.top4 > prev.top4 || (hit.is_motorway() && !prev.is_motorway());
                let base = if keep_new { hit } else { prev };
                out.decks[i] = Some(BridgeHit {
                    top_g: prev.top_g.max(hit.top_g),
                    top4: prev.top4.max(hit.top4),
                    soffit: merged_soffit,
                    edge_dist: merged_edge,
                    on_barrier: merged_barrier,
                    on_sidewalk: merged_sidewalk && !merged_barrier,
                    ramp_in: merged_ramp,
                    ..base
                });
                return;
            }
        }
    }

    // Distinct vertical level (double-deck viaduct or crossing flyover ramp): insert sorted bottom-to-top
    if (out.deck_n as usize) < 4 {
        let n = out.deck_n as usize;
        out.decks[n] = Some(hit);
        out.deck_n += 1;
        // Bubble into bottom-to-top order
        let mut k = n;
        while k > 0 {
            if out.decks[k].unwrap().top_g < out.decks[k - 1].unwrap().top_g {
                out.decks.swap(k, k - 1);
                k -= 1;
            } else {
                break;
            }
        }
    }
}

#[inline]
fn eval_pier_into(p: &BridgePier, px: f32, pz: f32, size: i32, out: &mut ColumnBridges) {
    let dx = px - p.x as f32;
    let dz = pz - p.z as f32;
    let rad = (p.rad as f32).max(size as f32 * 0.5);
    let ax = dx.abs();
    let az = dz.abs();
    // Octagonal chamfered Caltrans pier column shaft
    let in_shaft = ax <= rad && az <= rad && (ax + az) <= rad * 1.42;
    if in_shaft {
        push_pier(out, PierHit { y_bot: p.y_bot as i32, y_top: p.y_top as i32, is_cap_only: false });
        return;
    }
    // Transverse concrete bent cap directly beneath the box girder (y in [y_top - 8 ..= y_top])
    let nx = p.nx as f32 / 127.0;
    let nz = p.nz as f32 / 127.0;
    let along = dx * nx + dz * nz;
    let across = (dx * (-nz) + dz * nx).abs();
    let cap_half_thick = 7.0f32.max(size as f32 * 0.5);
    if across <= cap_half_thick && along >= -(p.cap_r as f32) && along <= (p.cap_l as f32) {
        let cap_bot = (p.y_top as i32 - 8).max(p.y_bot as i32);
        push_pier(out, PierHit { y_bot: cap_bot, y_top: p.y_top as i32, is_cap_only: true });
    }
}

#[inline]
fn push_pier(out: &mut ColumnBridges, hit: PierHit) {
    if (out.pier_n as usize) < 2 {
        out.piers[out.pier_n as usize] = Some(hit);
        out.pier_n += 1;
    }
}

/// Evaluate bridge decks and concrete viaduct piers at `(x, y, z)` for cell size `size`. Returns 0 (air) if none.
#[inline]
pub fn kind_at(cb: &ColumnBridges, ground_g: i32, mid: i32, size: i32) -> Kind {
    // 1. Check stacked bridge decks (highest priority over pier caps right at the soffit seam)
    for i in 0..cb.deck_n as usize {
        let Some(d) = cb.decks[i] else { continue };
        let top_solid = d.top_solid(ground_g);
        if mid < d.soffit || mid > top_solid {
            continue;
        }
        // Flush abutment ramp-in: only fill above ground (never overwrite ground below)
        let clearance = d.top_g - ground_g;
        if d.ramp_in && mid <= ground_g {
            continue;
        }
        // Outer concrete Jersey barrier / parapet (0.9 m tall): crisp uniform concrete with lighter cap
        if mid > d.top_g {
            if d.on_barrier {
                return if mid >= top_solid {
                    kind(CONCRETE, grey(3))
                } else {
                    kind(CONCRETE, grey(4))
                };
            }
            if d.on_sidewalk {
                return kind(CONCRETE, grey(5));
            }
        }
        // Driving surface top cell (and sub-layer directly underneath for coarse LODs)
        if mid >= d.top_g - (size - 1).max(0) && mid <= d.top_g {
            if clearance < 6 && d.ramp_in {
                // Blend smoothly into ground asphalt at abutment
                return kind(ASPHALT, grey(10));
            }
            // Non-motorway city bridge raised sidewalk edge
            if d.on_sidewalk {
                return kind(CONCRETE, grey(5));
            }
            // Crisp built-in highway/bridge lane markings up to LOD 2 (on CONCRETE so 2D lower-street marks.ts never bleed up!)
            if size <= 4 && !d.on_barrier {
                if let Some(stripe) = deck_marking(&d, size) {
                    return stripe;
                }
            }
            // Paved shoulder strip beside Jersey barrier on motorways
            if d.is_motorway() && !d.on_barrier && d.edge_dist < 10.5 && clearance >= 8 {
                return kind(CONCRETE, grey(8));
            }
            // Weathered Caltrans concrete-asphalt highway deck surface (dark cool grey; distinct from pale white YARD!)
            return kind(CONCRETE, grey(9));
        }
        // Structural prestressed concrete box-girder slab & cantilevered wing soffit
        if mid <= d.soffit + 1 {
            return kind(CONCRETE, grey(7));
        }
        // Crisp light concrete fascia strip along outer girder face
        if d.edge_dist < 4.5 {
            return kind(CONCRETE, grey(5));
        }
        return kind(CONCRETE, grey(6));
    }

    // 2. Concrete viaduct piers & transverse bent caps (only strictly above ground `mid > ground_g`)
    for i in 0..cb.pier_n as usize {
        let Some(p) = cb.piers[i] else { continue };
        if mid >= p.y_bot && mid <= p.y_top {
            if p.is_cap_only {
                return if mid <= p.y_bot + 1 { kind(CONCRETE, grey(6)) } else { kind(CONCRETE, grey(5)) };
            }
            return if mid >= p.y_top - 5 { kind(CONCRETE, grey(6)) } else { kind(CONCRETE, grey(5)) };
        }
    }
    0
}

/// Crisp highway & street bridge lane markings painted directly onto the concrete deck surface:
///   - Motorways/ramps: yellow left edge line, white right edge line, 3 m / 9 m dashed white lane lines
///   - Two-way city street bridges: double yellow center line + dashed white multi-lane dividers
#[inline]
fn deck_marking(d: &BridgeHit, size: i32) -> Option<Kind> {
    let white = kind(CONCRETE, grey(1));
    let yellow = kind(CONCRETE, colour(4, 4));
    let lanes = d.lanes();
    let half_w = if size >= 4 { 2.0f32 } else if size >= 2 { 1.1 } else { 0.85 };

    if d.is_motorway() {
        // Solid outer edge stripes ~1.0 m inward from the Jersey barrier
        if d.edge_dist >= 9.2 && d.edge_dist <= 9.2 + half_w * 2.1 {
            return Some(if d.signed > 0.0 { yellow } else { white });
        }
        // Dashed white lane lines between lanes (3.4 m lane spacing, 3.0 m dash every 9.0 m)
        if lanes >= 2 && d.edge_dist > 14.0 {
            let lane_w = 34.0f32;
            let total_w = lanes as f32 * lane_w;
            let u = d.signed + total_w * 0.5;
            if u > lane_w * 0.5 && u < total_w - lane_w * 0.5 {
                let k = (u / lane_w).round();
                if k >= 1.0 && k < lanes as f32 {
                    let dist = (u - k * lane_w).abs();
                    if dist <= half_w && d.along.rem_euclid(90.0) < 30.0 {
                        return Some(white);
                    }
                }
            }
        }
        return None;
    }

    // Non-motorway city street bridge
    if d.is_two_way() {
        let a = d.signed.abs();
        if a >= 0.4 && a <= 0.4 + half_w * 1.8 {
            return Some(yellow);
        }
        if lanes >= 4 && d.edge_dist > 20.0 {
            let per_dir = lanes / 2;
            for k in 1..per_dir {
                let pos = k as f32 * 33.0;
                if (a - pos).abs() <= half_w && d.along.rem_euclid(90.0) < 30.0 {
                    return Some(white);
                }
            }
        }
    } else if lanes >= 2 && d.edge_dist > 18.0 {
        let lane_w = 33.0f32;
        let total_w = lanes as f32 * lane_w;
        let u = d.signed + total_w * 0.5;
        let k = (u / lane_w).round();
        if k >= 1.0 && k < lanes as f32 && (u - k * lane_w).abs() <= half_w && d.along.rem_euclid(90.0) < 30.0 {
            return Some(white);
        }
    }
    None
}

/// Emit quarter-cell smooth longitudinal ramp runs (`2.5 cm` vertical resolution) for elevated bridge decks at LOD 0,
/// matching `bay::grade_rows` so cars drive smoothly across curved ramps and viaducts with zero 10 cm stair-steps.
pub fn grade_rows(cb: &ColumnBridges, ground_g: i32, x: i32, z: i32, low_y: i32, rows: &mut Vec<Run>) {
    for i in 0..cb.deck_n as usize {
        let Some(d) = cb.decks[i] else { continue };
        if d.on_barrier || d.on_sidewalk {
            continue;
        }
        let top4 = d.top4;
        let y = top4.div_euclid(4);
        let fill = top4.rem_euclid(4);
        if fill == 0 || y < low_y || y >= low_y + crate::tree::SIDE as i32 {
            continue;
        }
        // Only carve/pad the bridge deck's own top cell (not into an upper overlapping deck or ground)
        if d.ramp_in && y <= ground_g {
            continue;
        }
        let surf_kind = kind_at(cb, ground_g, d.top_g, 1);
        if surf_kind == 0 {
            continue;
        }
        let (lo, hi, k) = if y <= d.top_g { (fill, 4, 0) } else { (0, fill, surf_kind) };
        if kind_at(cb, ground_g, y, 1) != if k == 0 { surf_kind } else { 0 } {
            continue;
        }
        if k == 0 && kind_at(cb, ground_g, y + 1, 1) != 0 {
            continue;
        }
        for sy in lo..hi {
            for sz in 0..4 {
                rows.push(Run { x0: x * 4, x1: x * 4 + 4, y: y * 4 + sy, z: z * 4 + sz, kind: k });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_bin(spans: &[(u16, u8, &[(i32, i32, i32, u8, u8, u8)])], piers: &[(i32, i32, i16, i16, u8, i8, i8, u8, u8)]) -> Vec<u8> {
        let n_verts: usize = spans.iter().map(|s| s.2.len()).sum();
        let mut b = Vec::new();
        for w in [BRIDGE_MAGIC, BRIDGE_VERSION, spans.len() as i32, n_verts as i32, piers.len() as i32] {
            b.extend(w.to_le_bytes());
        }
        for &(flags, thick, vs) in spans {
            b.extend(flags.to_le_bytes());
            b.push(thick);
            b.push(0);
            b.extend((vs.len() as u16).to_le_bytes());
            b.extend(0u16.to_le_bytes());
            let v0 = vs[0];
            b.extend(v0.0.to_le_bytes());
            b.extend(v0.1.to_le_bytes());
            b.extend(v0.2.to_le_bytes());
            b.extend([v0.3, v0.4, v0.5, 0]);
            for w in vs.windows(2) {
                b.extend(((w[1].0 - w[0].0) as i16).to_le_bytes());
                b.extend(((w[1].1 - w[0].1) as i16).to_le_bytes());
                b.extend(((w[1].2 - w[0].2) as i16).to_le_bytes());
                b.extend([w[1].3, w[1].4, w[1].5, 0]);
            }
        }
        for &(x, z, yt, yb, r, nx, nz, cl, cr) in piers {
            b.extend(x.to_le_bytes());
            b.extend(z.to_le_bytes());
            b.extend(yt.to_le_bytes());
            b.extend(yb.to_le_bytes());
            b.extend([r, nx as u8, nz as u8, 0, cl, cr, 0, 0]);
        }
        b
    }

    #[test]
    fn parses_double_deck_viaduct_with_open_air_and_piers() {
        // Two stacked motorway spans along x=[0..600] at z=200:
        //   lower deck (layer=1): y = 160 cells (16 m), y4 = 640
        //   upper deck (layer=2): y = 240 cells (24 m), y4 = 960
        let f_lo = FLAG_MOTORWAY | FLAG_BARRIER_L | FLAG_BARRIER_R | (2 << 6) | (3 << 9); // layer 1
        let f_hi = FLAG_MOTORWAY | FLAG_BARRIER_L | FLAG_BARRIER_R | (3 << 6) | (4 << 9); // layer 2
        let bin = make_test_bin(
            &[
                (f_lo, 14, &[(0, 200, 640, 50, 50, 0), (600, 200, 640, 50, 50, 0)]),
                (f_hi, 16, &[(0, 200, 960, 60, 60, 0), (600, 200, 960, 60, 60, 0)]),
            ],
            &[(300, 200, 147, 90, 9, 0, 127, 40, 40)],
        );
        let br = Bridges::parse(&bin).expect("valid BRDG bytes");
        assert_eq!(br.span_count(), 2);
        assert!(br.max_y_in(0, 0, 640, 640) >= 249);

        // Center of viaduct away from pier: open air below lower deck, solid lower deck, open air between decks, solid upper deck!
        let cb = br.eval_point(150.5, 200.5, 1);
        assert_eq!(cb.deck_n, 2);
        assert_eq!(kind_at(&cb, 100, 120, 1), 0, "open air below lower deck");
        assert_ne!(kind_at(&cb, 100, 160, 1), 0, "lower deck driving surface solid");
        assert_eq!(kind_at(&cb, 100, 195, 1), 0, "open air between lower and upper decks");
        assert_ne!(kind_at(&cb, 100, 240, 1), 0, "upper deck driving surface solid");
        assert_eq!(kind_at(&cb, 100, 242, 1), 0, "open air above driving lanes");

        // Outer edge of upper deck (z = 258, within 4 cells of edge 260) has a 0.9 m concrete Jersey barrier
        let cb_edge = br.eval_point(150.5, 258.5, 1);
        assert_ne!(kind_at(&cb_edge, 100, 245, 1), 0, "Jersey barrier rises above deck edge");
        assert_eq!(material(kind_at(&cb_edge, 100, 245, 1)), CONCRETE);

        // Pier shaft at (300, 200) supports lower soffit down to ground
        let cb_pier = br.eval_point(300.5, 200.5, 1);
        assert_eq!(material(kind_at(&cb_pier, 100, 120, 1)), CONCRETE, "pier shaft solid");

        // Layer-aware height queries separate upper deck, lower deck, and ground street cleanly
        assert_eq!(br.deck_y_for_layer(150, 200, 0), i32::MIN, "ground road does not snap up to layer>=1 bridges");
        assert_eq!(br.deck_y_for_layer(150, 200, 1), 161, "layer 1 hits lower deck");
        assert_eq!(br.deck_y_for_layer(150, 200, 2), 241, "layer 2 hits upper deck");
    }

    #[test]
    fn merge_gore_opens_barrier_between_overlapping_same_level_decks() {
        let f = FLAG_MOTORWAY | FLAG_BARRIER_L | FLAG_BARRIER_R | (2 << 6) | (3 << 9);
        // Mainline along z=200 (half-width 50 -> z in [150..250]); merging ramp along z=248 (half-width 35 -> z in [213..283]) at same height
        let bin = make_test_bin(
            &[
                (f, 14, &[(0, 200, 640, 50, 50, 0), (400, 200, 640, 50, 50, 0)]),
                (f, 14, &[(0, 248, 640, 35, 35, 0), (400, 248, 640, 35, 35, 0)]),
            ],
            &[],
        );
        let br = Bridges::parse(&bin).unwrap();
        // At z=248 (mainline's outer barrier edge, inside the merging ramp!): barrier MUST be open!
        let cb_merge = br.eval_point(200.5, 248.5, 1);
        assert_eq!(cb_merge.deck_n, 1, "same-level overlapping decks merge into 1");
        assert_eq!(kind_at(&cb_merge, 100, 165, 1), 0, "no barrier blocking merge gore");
        // True outer edge at z=281 STILL has its Jersey barrier
        let cb_outer = br.eval_point(200.5, 281.5, 1);
        assert_ne!(kind_at(&cb_outer, 100, 165, 1), 0, "outer ramp edge keeps Jersey barrier");
    }

    #[test]
    fn multi_segment_sloped_bridge_has_no_protruding_end_cap_or_mid_deck_ledge() {
        // Mirrors I-280 S over Lyell St (wide 24 m deck with a short 4 m grounded ramp-in tail):
        // previously interior segments bulged 12 m past the span end as curved concrete barriers across the freeway
        // and created horizontal elevation ledges across interior vertices.
        let f = FLAG_MOTORWAY | FLAG_BARRIER_L | FLAG_BARRIER_R | (4 << 6) | (3 << 9);
        let bin = make_test_bin(
            &[(
                f,
                16,
                &[
                    (0, 200, 1940, 120, 120, VFLAG_RAMP_IN),
                    (50, 200, 1930, 120, 120, 0),
                    (300, 200, 1880, 120, 120, 0),
                    (560, 200, 1840, 120, 120, 0),
                    (600, 200, 1832, 120, 120, VFLAG_RAMP_IN),
                ],
            )],
            &[],
        );
        let br = Bridges::parse(&bin).unwrap();
        // 1. 5 cells past the grounded end (x=605): MUST be completely empty (zero semicircular barrier wall!)
        let cb_past = br.eval_point(605.5, 200.5, 1);
        assert_eq!(cb_past.deck_n, 0, "no protruding semicircular end-cap past grounded abutment");
        // 2. Across interior vertices & driving lanes: smooth monotonic elevation with zero mid-deck barriers
        let mut prev_top = i32::MAX;
        for x in (60..=590).step_by(10) {
            let cb = br.eval_point(x as f32 + 0.5, 260.5, 1);
            assert_eq!(cb.deck_n, 1, "driving lane solid at x={x}");
            let d = cb.decks[0].unwrap();
            assert!(!d.on_barrier, "no transverse barrier in driving lane at x={x}");
            if prev_top != i32::MAX {
                assert!((prev_top - d.top_g).abs() <= 2, "no mid-deck step ledge at x={x}: {prev_top} -> {}", d.top_g);
            }
            prev_top = d.top_g;
        }
        // 3. Curved flyover miter continuity: a 25-degree bend has zero pie-slice gap on the outside corner
        let curve_bin = make_test_bin(
            &[(
                f,
                14,
                &[
                    (0, 200, 2000, 60, 60, 0),
                    (200, 200, 2000, 60, 60, 0),
                    (380, 285, 2000, 60, 60, 0),
                ],
            )],
            &[],
        );
        let cbr = Bridges::parse(&curve_bin).unwrap();
        // Outside of the bend at x=200..215, z=142..155 must be continuously covered with no gap
        let cb_corner = cbr.eval_point(210.5, 145.5, 1);
        assert_eq!(cb_corner.deck_n, 1, "outer corner of curved flyover has continuous miter deck");
    }
}
