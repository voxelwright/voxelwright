//! Fine-voxel geometry operations (#139): outside face meshing with smooth corner normals and
//! ambient openness (`fine.ts`), base64/LEB128 RLE decode and encode (`runs.ts`, `robotaxi.ts`),
//! shell-preserving coarsening and edge-leak sealing (`car-sculpt.ts`), and procedural vehicle
//! sculptors (`car-sculpt.ts`, `ojai-sculpt.ts`).
//!
//! Runs in the same `core.wasm` module (compiled with `+simd128,+bulk-memory`) as the voxel world
//! core, reusing scratch allocations across calls so vehicle loading and prewarming do not churn
//! memory or stall the page thread.

use crate::tree::Kind;

const GLASS: u16 = 11;
const STEEL: u16 = 12;
const ROOFING: u16 = 14;
const LAMP: u16 = 15;
const PLASTER: u16 = 9;

const OPEN_REACH: usize = 3;
const LEAST_FACING: f64 = 0.0;

#[inline]
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[inline]
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

#[inline]
fn smooth(a: f64, b: f64, v: f64) -> f64 {
    let t = clamp((v - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn bump(v: f64, at: f64, wide: f64) -> f64 {
    let d = (v - at) / wide;
    (-(d * d)).exp()
}

#[inline]
fn through_cos(pts: &[(f64, f64)], s: f64) -> f64 {
    if s <= pts[0].0 {
        return pts[0].1;
    }
    for i in 1..pts.len() {
        if s <= pts[i].0 {
            let (s0, y0) = pts[i - 1];
            let (s1, y1) = pts[i];
            let t = (s - s0) / (s1 - s0);
            return y0 + (y1 - y0) * (1.0 - (std::f64::consts::PI * t).cos()) * 0.5;
        }
    }
    pts[pts.len() - 1].1
}

#[inline]
fn through_lin(pts: &[(f64, f64)], s: f64) -> f64 {
    if s <= pts[0].0 {
        return pts[0].1;
    }
    for i in 1..pts.len() {
        if s <= pts[i].0 {
            let (s0, y0) = pts[i - 1];
            let (s1, y1) = pts[i];
            let t = (s - s0) / (s1 - s0);
            return y0 + (y1 - y0) * t;
        }
    }
    pts[pts.len() - 1].1
}

#[inline]
const fn k_kind(material: u16, colour: u16) -> u16 {
    material | (colour << 8)
}

#[inline]
const fn hue(h: u16, tone: u16) -> u16 {
    16 + (h % 24) * 10 + (tone % 10)
}

#[inline]
const fn grey(step: u16) -> u16 {
    1 + if step > 14 { 14 } else { step }
}

/// Reusable scratch storage for fine-voxel operations on one core instance.
#[derive(Default)]
pub struct FineBuf {
    pub cells: Vec<Kind>,
    pub out_cells: Vec<Kind>,
    pub out_size: [usize; 3],
    pub bytes: Vec<u8>,
    pub palette: Vec<Kind>,
    pub faces: Vec<u32>,
    pub smooth: Vec<u32>,
    pub params: Vec<f64>,
    pub filled: usize,
    // Reusable working arrays for smooth normals & flood fills.
    wall: Vec<u8>,
    out_air: Vec<u8>,
    queue: Vec<u32>,
    sum: Vec<i32>,
    shut: Vec<i32>,
    slot: Vec<u32>,
    known: Vec<[f32; 4]>,
    holes: Vec<u32>,
    pub raw_bytes: Vec<u8>,
}

impl FineBuf {
    pub fn new() -> Self {
        Self::default()
    }
}

// ── Base64 + LEB128 RLE decode & encode ─────────────────────────────────────

const B64_ENC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#[inline]
fn b64_val(b: u8) -> i8 {
    match b {
        b'A'..=b'Z' => (b - b'A') as i8,
        b'a'..=b'z' => (b - b'a' + 26) as i8,
        b'0'..=b'9' => (b - b'0' + 52) as i8,
        b'+' => 62,
        b'/' => 63,
        _ => -1,
    }
}

/// Decodes standard ASCII base64 (ignoring ASCII whitespace, matching `atob`) into `out`.
fn decode_base64(input: &[u8], out: &mut Vec<u8>) -> bool {
    out.clear();
    out.reserve((input.len() * 3) / 4 + 3);
    let mut vals = [0u8; 4];
    let mut count = 0usize;
    let mut pad = 0usize;
    for &b in input {
        if b.is_ascii_whitespace() {
            continue;
        }
        if b == b'=' {
            pad += 1;
            if pad > 2 {
                return false;
            }
            vals[count] = 0;
            count += 1;
        } else {
            if pad > 0 {
                return false;
            }
            let v = b64_val(b);
            if v < 0 {
                return false;
            }
            vals[count] = v as u8;
            count += 1;
        }
        if count == 4 {
            let n = ((vals[0] as u32) << 18) | ((vals[1] as u32) << 12) | ((vals[2] as u32) << 6) | (vals[3] as u32);
            out.push((n >> 16) as u8);
            if pad < 2 {
                out.push((n >> 8) as u8);
            }
            if pad == 0 {
                out.push(n as u8);
            }
            count = 0;
            pad = 0;
        }
    }
    if count == 1 || (count > 0 && pad > 0) {
        return false;
    }
    if count == 2 {
        let n = ((vals[0] as u32) << 18) | ((vals[1] as u32) << 12);
        out.push((n >> 16) as u8);
    } else if count == 3 {
        let n = ((vals[0] as u32) << 18) | ((vals[1] as u32) << 12) | ((vals[2] as u32) << 6);
        out.push((n >> 16) as u8);
        out.push((n >> 8) as u8);
    }
    true
}

fn encode_base64(input: &[u8], out: &mut Vec<u8>) {
    out.clear();
    out.reserve(input.len().div_ceil(3) * 4);
    let mut chunks = input.chunks_exact(3);
    for c in &mut chunks {
        let n = ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | (c[2] as u32);
        out.push(B64_ENC[((n >> 18) & 63) as usize]);
        out.push(B64_ENC[((n >> 12) & 63) as usize]);
        out.push(B64_ENC[((n >> 6) & 63) as usize]);
        out.push(B64_ENC[(n & 63) as usize]);
    }
    let rem = chunks.remainder();
    if rem.len() == 1 {
        let n = (rem[0] as u32) << 16;
        out.push(B64_ENC[((n >> 18) & 63) as usize]);
        out.push(B64_ENC[((n >> 12) & 63) as usize]);
        out.push(b'=');
        out.push(b'=');
    } else if rem.len() == 2 {
        let n = ((rem[0] as u32) << 16) | ((rem[1] as u32) << 8);
        out.push(B64_ENC[((n >> 18) & 63) as usize]);
        out.push(B64_ENC[((n >> 12) & 63) as usize]);
        out.push(B64_ENC[((n >> 6) & 63) as usize]);
        out.push(b'=');
    }
}

/// Decodes raw LEB128 runs (`count`, `palette_index`) into `cells` (exact length `n`).
/// Returns `Some(filled_count)` or `None` if malformed (matching `runs.ts` validation).
fn unrun_raw_into(raw: &[u8], palette: &[Kind], n: usize, cells: &mut Vec<Kind>) -> Option<usize> {
    cells.clear();
    cells.resize(n, 0);
    let mut at = 0usize;
    let mut k = 0usize;
    let mut filled = 0usize;
    let read_u32 = |at: &mut usize| -> Option<usize> {
        let mut v = 0u64;
        let mut shift = 0u32;
        loop {
            if *at >= raw.len() || shift > 28 {
                return None;
            }
            let b = raw[*at];
            *at += 1;
            v += ((b & 127) as u64) << shift;
            if b < 128 {
                return usize::try_from(v).ok();
            }
            shift += 7;
        }
    };
    while at < raw.len() {
        let c = read_u32(&mut at)?;
        let v = read_u32(&mut at)?;
        if c > n - k || v >= palette.len() {
            return None;
        }
        if v != 0 {
            let kind = palette[v];
            if kind != 0 {
                cells[k..k + c].fill(kind);
                filled += c;
            }
        }
        k += c;
    }
    if k != n {
        return None;
    }
    Some(filled)
}

/// Decodes base64 LEB128 runs in `buf.bytes` with `buf.palette` into `buf.cells[..n]`.
/// Returns filled cell count on success, or -1 on invalid input.
pub fn unrun_b64(buf: &mut FineBuf, n: usize) -> i32 {
    let FineBuf { bytes, raw_bytes, palette, cells, filled, .. } = buf;
    if !decode_base64(bytes, raw_bytes) {
        return -1;
    }
    match unrun_raw_into(raw_bytes, palette, n, cells) {
        Some(cnt) => {
            *filled = cnt;
            cnt as i32
        }
        None => -1,
    }
}

/// Encodes `cells` into `(palette, base64 LEB128 runs)` matching `robotaxi.ts:encodeRuns`.
/// Palette goes to `buf.palette` (0 first for air), base64 ASCII goes to `buf.bytes`.
pub fn encode_runs(cells: &[Kind], palette: &mut Vec<Kind>, raw_bytes: &mut Vec<u8>, b64_bytes: &mut Vec<u8>) {
    palette.clear();
    palette.push(0);
    raw_bytes.clear();
    raw_bytes.reserve(cells.len() / 8 + 64);

    #[inline]
    fn push_leb(mut v: usize, out: &mut Vec<u8>) {
        loop {
            let mut b = (v & 127) as u8;
            v >>= 7;
            if v != 0 {
                b |= 128;
            }
            out.push(b);
            if v == 0 {
                break;
            }
        }
    }

    let n = cells.len();
    let mut i = 0usize;
    while i < n {
        let kk = cells[i];
        let mut j = i + 1;
        while j < n && cells[j] == kk {
            j += 1;
        }
        let idx = if kk == 0 {
            0
        } else if let Some(pos) = palette.iter().position(|&p| p == kk) {
            pos
        } else {
            let pos = palette.len();
            palette.push(kk);
            pos
        };
        push_leb(j - i, raw_bytes);
        push_leb(idx, raw_bytes);
        i = j;
    }
    encode_base64(raw_bytes, b64_bytes);
}

// ── Face meshing & smooth normals (`fine.ts`) ───────────────────────────────

#[inline]
fn count_nonzero(cells: &[Kind]) -> usize {
    #[cfg(target_arch = "wasm32")]
    {
        use core::arch::wasm32::*;
        let zero = u16x8_splat(0);
        let one = u16x8_splat(1);
        let mut total = 0usize;
        let chunks = cells.chunks_exact(8);
        let rem = chunks.remainder();
        // Accumulate into a u16x8 lane counter in batches of up to 32768 chunks to avoid u16 overflow.
        let mut ptr = cells.as_ptr();
        let mut left = chunks.len();
        while left > 0 {
            let batch = left.min(32768);
            let mut acc = zero;
            for _ in 0..batch {
                // SAFETY: `ptr` is within `cells` for `batch * 8` elements.
                let v = unsafe { v128_load(ptr as *const v128) };
                ptr = unsafe { ptr.add(8) };
                let nz = v128_andnot(one, u16x8_eq(v, zero));
                acc = u16x8_add(acc, nz);
            }
            total += u16x8_extract_lane::<0>(acc) as usize
                + u16x8_extract_lane::<1>(acc) as usize
                + u16x8_extract_lane::<2>(acc) as usize
                + u16x8_extract_lane::<3>(acc) as usize
                + u16x8_extract_lane::<4>(acc) as usize
                + u16x8_extract_lane::<5>(acc) as usize
                + u16x8_extract_lane::<6>(acc) as usize
                + u16x8_extract_lane::<7>(acc) as usize;
            left -= batch;
        }
        for &k in rem {
            total += (k != 0) as usize;
        }
        return total;
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        cells.iter().filter(|&&k| k != 0).count()
    }
}

/// Adds `src[0..len]` elementwise into `dst[0..len]` (contiguous i32 slices), SIMD-accelerated on wasm32.
#[inline]
fn add_i32_slice(dst: &mut [i32], src: &[i32]) {
    debug_assert_eq!(dst.len(), src.len());
    #[cfg(target_arch = "wasm32")]
    {
        use core::arch::wasm32::*;
        let n = dst.len();
        let mut i = 0;
        let dptr = dst.as_mut_ptr();
        let sptr = src.as_ptr();
        while i + 4 <= n {
            unsafe {
                let a = v128_load(dptr.add(i) as *const v128);
                let b = v128_load(sptr.add(i) as *const v128);
                v128_store(dptr.add(i) as *mut v128, i32x4_add(a, b));
            }
            i += 4;
        }
        while i < n {
            dst[i] += src[i];
            i += 1;
        }
        return;
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        for (d, &s) in dst.iter_mut().zip(src.iter()) {
            *d += s;
        }
    }
}

#[inline]
fn alike(v: u32) -> u32 {
    if v == 0 {
        0
    } else {
        (((v & 1023) + 4) >> 3) | ((((v >> 10) & 1023) + 4) >> 3) << 7 | ((v >> 24) & 255) << 14
    }
}

#[inline]
fn fold(x: f64, y: f64, z: f64) -> u32 {
    let s = x.abs() + y.abs() + z.abs();
    let mut u = x / s;
    let mut v = y / s;
    if z < 0.0 {
        let pu = u;
        u = (1.0 - v.abs()) * if pu >= 0.0 { 1.0 } else { -1.0 };
        v = (1.0 - pu.abs()) * if v >= 0.0 { 1.0 } else { -1.0 };
    }
    (js_round((u * 0.5 + 0.5) * 1022.0) as u32) | ((js_round((v * 0.5 + 0.5) * 1022.0) as u32) << 10)
}

/// Square outside faces (exact match with `fine.ts` `faces`). Returns number of faces.
pub fn faces_square(buf: &mut FineBuf, w: usize, h: usize, d: usize) -> usize {
    let n = w * h * d;
    if buf.cells.len() < n {
        return 0;
    }
    let cells = &buf.cells[..n];
    buf.filled = count_nonzero(cells);
    buf.faces.clear();
    buf.smooth.clear();
    if buf.filled == 0 {
        return 0;
    }
    let out = &mut buf.faces;
    for axis in 0..3usize {
        for side in 0..2usize {
            let step: isize = side as isize * 2 - 1;
            let inner = if axis == 0 { w } else { d };
            let along = if axis == 0 { d } else { w };
            let stride = if axis == 0 { w } else { 1 };
            let next: isize = match axis {
                0 => step,
                1 => step * (w * d) as isize,
                _ => step * w as isize,
            };
            let room = match axis {
                0 => w as isize,
                1 => h as isize,
                _ => d as isize,
            };
            for a in 0..h {
                for b in 0..inner {
                    let looked_in = if axis == 1 { a as isize + step } else { b as isize + step };
                    let open = looked_in < 0 || looked_in >= room;
                    let row = if axis == 0 { (a * d) * w + b } else { (a * d + b) * w };
                    let mut start = 0usize;
                    let mut kind = 0u16;
                    let mut i = row;
                    for c in 0..=along {
                        let own = if c < along { cells[i] } else { 0 };
                        if own == 0 && kind == 0 {
                            i += stride;
                            continue;
                        }
                        let k = if own != 0 && (open || cells[(i as isize + next) as usize] == 0) { own } else { 0 };
                        if k == kind && c - start < 255 {
                            i += stride;
                            continue;
                        }
                        if kind != 0 {
                            let sx = if axis == 0 { b } else { start };
                            let sz = if axis == 0 { start } else { b };
                            out.push((sx | (a << 10) | (sz << 20)) as u32);
                            out.push(((c - start) | (axis << 8) | (side << 10) | ((kind as usize) << 16)) as u32);
                        }
                        start = c;
                        kind = k;
                        i += stride;
                    }
                }
            }
        }
    }
    out.len() / 2
}

struct Lookups {
    normal: [Vec<(isize, f64)>; 3],
    open: Vec<(isize, i32)>,
}

fn build_lookups(pw: usize, pd: usize, r: usize) -> Lookups {
    let sy = (pw * pd) as isize;
    let w = pw as isize;
    let ri = r as isize;

    // Preserve exact insertion order (matching JS Map) so floating-point sums match bit-for-bit even on
    // symmetric octahedral fold seams.
    let add_entry = |into: &mut Vec<(isize, f64)>, at: isize, delta: f64| {
        for item in into.iter_mut() {
            if item.0 == at {
                item.1 += delta;
                return;
            }
        }
        into.push((at, delta));
    };

    let add_corners = |lo: [isize; 3], hi: [isize; 3], by: f64, into: &mut Vec<(isize, f64)>| {
        for &(cy, sy1) in &[(hi[1], 1.0), (lo[1] - 1, -1.0)] {
            for &(cz, sz1) in &[(hi[2], 1.0), (lo[2] - 1, -1.0)] {
                for &(cx, sx1) in &[(hi[0], 1.0), (lo[0] - 1, -1.0)] {
                    let at = cy * sy + cz * w + cx;
                    add_entry(into, at, by * sy1 * sz1 * sx1);
                }
            }
        }
    };

    let lo = [-ri, -ri, -ri];
    let hi = [ri - 1, ri - 1, ri - 1];
    let mut normal_vecs: [Vec<(isize, f64)>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut spread = 0.0f64;
    for j in -ri..ri {
        let v = j as f64 + 0.5;
        spread += v * v;
    }
    for k in 0..3 {
        for j in -ri..ri {
            let mut slab_lo = lo;
            let mut slab_hi = hi;
            slab_lo[k] = j;
            slab_hi[k] = j;
            add_corners(slab_lo, slab_hi, -(j as f64 + 0.5) / spread, &mut normal_vecs[k]);
        }
    }
    let or = OPEN_REACH as isize;
    let mut open_vec = Vec::new();
    add_corners([-or, -or, -or], [or - 1, or - 1, or - 1], 1.0, &mut open_vec);

    let [mut m0, mut m1, mut m2] = normal_vecs;
    m0.retain(|&(_, v)| v.abs() > 1e-12);
    m1.retain(|&(_, v)| v.abs() > 1e-12);
    m2.retain(|&(_, v)| v.abs() > 1e-12);
    Lookups {
        normal: [m0, m1, m2],
        open: open_vec.into_iter().filter(|&(_, v)| v != 0.0).map(|(k, v)| (k, v as i32)).collect(),
    }
}

/// Outside faces with smooth corner normals and openness (exact match with `fine.ts` `facesWithSmooth`).
/// Returns number of faces (`buf.faces.len() / 2`; `buf.smooth.len() == 4 * faces`).
pub fn faces_with_smooth(buf: &mut FineBuf, w: usize, h: usize, d: usize, reach: usize) -> usize {
    let n = w * h * d;
    if buf.cells.len() < n {
        return 0;
    }
    let reach = if reach == 0 { 5 } else { reach };
    buf.filled = count_nonzero(&buf.cells[..n]);
    buf.faces.clear();
    buf.smooth.clear();
    if buf.filled == 0 {
        return 0;
    }

    let pad = reach.max(OPEN_REACH) + 2;
    let pw = w + 2 * pad;
    let ph = h + 2 * pad;
    let pd = d + 2 * pad;
    let pn = pw * ph * pd;
    let sz = pw;
    let sy = pw * pd;

    // 1. Build padded `wall` (0 air, 1 cell, 2 outer frame, 3 small hole).
    buf.wall.clear();
    buf.wall.resize(pn, 0);
    let wall = &mut buf.wall;
    for y in 0..ph {
        for z in 0..pd {
            let row = (y * pd + z) * pw;
            if y == 0 || z == 0 || y == ph - 1 || z == pd - 1 {
                wall[row..row + pw].fill(2);
            } else {
                wall[row] = 2;
                wall[row + pw - 1] = 2;
            }
        }
    }
    let cells = &buf.cells[..n];
    for y in 0..h {
        for z in 0..d {
            let from = (y * d + z) * w;
            let to = ((y + pad) * pd + z + pad) * pw + pad;
            for x in 0..w {
                if cells[from + x] != 0 {
                    wall[to + x] = 1;
                }
            }
        }
    }

    // 2. Holes 1 cell across walled on >= 4 of 6 sides.
    buf.holes.clear();
    let holes = &mut buf.holes;
    for y in pad..pad + h {
        for z in pad..pad + d {
            let base = (y * pd + z) * pw + pad;
            for i in base..base + w {
                if wall[i] != 0 {
                    continue;
                }
                let cnt = (wall[i - 1] & 1)
                    + (wall[i + 1] & 1)
                    + (wall[i - sz] & 1)
                    + (wall[i + sz] & 1)
                    + (wall[i - sy] & 1)
                    + (wall[i + sy] & 1);
                if cnt >= 4 {
                    holes.push(i as u32);
                }
            }
        }
    }
    for &i in holes.iter() {
        wall[i as usize] = 3;
    }

    // 3. Outside-air BFS packed directly into `wall` (value 4 = outside air), halving memory bandwidth.
    buf.queue.resize(pn, 0);
    let queue = &mut buf.queue;
    let mut head = 0usize;
    let mut tail = 0usize;
    let corner = (pd + 1) * pw + 1;
    wall[corner] = 4;
    queue[tail] = corner as u32;
    tail += 1;
    while head < tail {
        let i = queue[head] as usize;
        head += 1;
        macro_rules! visit {
            ($j:expr) => {
                let j = $j;
                // SAFETY: outer frame (value 2) surrounds the padded volume, so BFS stays in bounds.
                unsafe {
                    if *wall.get_unchecked(j) == 0 {
                        *wall.get_unchecked_mut(j) = 4;
                        *queue.get_unchecked_mut(tail) = j as u32;
                        tail += 1;
                    }
                }
            };
        }
        visit!(i - 1);
        visit!(i + 1);
        visit!(i - sz);
        visit!(i + sz);
        visit!(i - sy);
        visit!(i + sy);
    }

    // 4. `sum` (solid or interior air) and `shut` (with 1-2 cell seams filled), then cache-friendly 3D prefix sums.
    buf.sum.resize(pn, 0);
    buf.shut.resize(pn, 0);
    let sum = &mut buf.sum;
    let shut = &mut buf.shut;
    for i in 0..pn {
        // wall values: 0 interior air, 1 solid, 2 frame, 3 small hole, 4 outside air.
        let wv = wall[i];
        let v = (wv != 2 && wv != 4) as i32;
        sum[i] = v;
        shut[i] = v;
    }
    let z2 = 2 * sz;
    let y2 = 2 * sy;
    for y in 2..ph - 2 {
        for z in 2..pd - 2 {
            let base = (y * pd + z) * pw + 2;
            let end = base + pw - 4;
            for i in base..end {
                // SAFETY: `y in 2..ph-2`, `z in 2..pd-2`, `x in 2..pw-2`, so ±2 along x/z/y are in bounds.
                unsafe {
                    if *sum.get_unchecked(i) != 0 {
                        continue;
                    }
                    let ax = (*sum.get_unchecked(i - 1) & (*sum.get_unchecked(i + 1) | *sum.get_unchecked(i + 2)))
                        | (*sum.get_unchecked(i + 1) & *sum.get_unchecked(i - 2));
                    let az = (*sum.get_unchecked(i - sz) & (*sum.get_unchecked(i + sz) | *sum.get_unchecked(i + z2)))
                        | (*sum.get_unchecked(i + sz) & *sum.get_unchecked(i - z2));
                    let ay = (*sum.get_unchecked(i - sy) & (*sum.get_unchecked(i + sy) | *sum.get_unchecked(i + y2)))
                        | (*sum.get_unchecked(i + sy) & *sum.get_unchecked(i - y2));
                    if (ax | az | ay) != 0 {
                        *shut.get_unchecked_mut(i) = 1;
                    }
                }
            }
        }
    }
    // Plane-fused X + Z + Y 3D prefix sum: keeps each 80 KB Y-plane hot in L1/L2 cache.
    for s in [sum.as_mut_slice(), shut.as_mut_slice()] {
        for y in 0..ph {
            let y_base = y * sy;
            // X prefix for every row in this Y plane, fused with Z accumulation.
            for z in 0..pd {
                let row = &mut s[y_base + z * sz..y_base + (z + 1) * sz];
                let mut acc = row[0];
                for v in &mut row[1..] {
                    acc += *v;
                    *v = acc;
                }
                if z > 0 {
                    let (prev, curr) = s[y_base + (z - 1) * sz..y_base + (z + 1) * sz].split_at_mut(sz);
                    add_i32_slice(curr, prev);
                }
            }
            if y > 0 {
                let (prev, curr) = s[(y - 1) * sy..(y + 1) * sy].split_at_mut(sy);
                add_i32_slice(curr, prev);
            }
        }
    }

    // 5. Corner lookup stencils + lazy corner normal/openness cache.
    let way = build_lookups(pw, pd, reach);
    let open_size = ((2 * OPEN_REACH).pow(3)) as f64;
    buf.slot.clear();
    buf.slot.resize(pn, 0);
    buf.known.clear();
    let slot = &mut buf.slot;
    let known = &mut buf.known;
    let sum_ref = &buf.sum;
    let shut_ref = &buf.shut;
    let wall_ref = &buf.wall;
    let strides: [isize; 3] = [1, sy as isize, pw as isize];
    let sum_ptr = sum_ref.as_ptr();
    let shut_ptr = shut_ref.as_ptr();
    let n0 = &way.normal[0];
    let n1 = &way.normal[1];
    let n2 = &way.normal[2];
    let open_l = &way.open;

    // 6. Merged face pass with smooth corners.
    let faces_out = &mut buf.faces;
    let smooth_out = &mut buf.smooth;
    let mut here = [0u32; 4];
    let mut first = [0u32; 4];
    let mut last = [0u32; 4];

    for axis in 0..3usize {
        for side in 0..2usize {
            let step: isize = side as isize * 2 - 1;
            let inner = if axis == 0 { w } else { d };
            let along = if axis == 0 { d } else { w };
            let stride = if axis == 0 { w } else { 1 };
            let next: isize = match axis {
                0 => step,
                1 => step * (w * d) as isize,
                _ => step * w as isize,
            };
            let room = match axis {
                0 => w as isize,
                1 => h as isize,
                _ => d as isize,
            };
            let ox = if axis == 0 { step as f64 } else { 0.0 };
            let oy = if axis == 1 { step as f64 } else { 0.0 };
            let oz = if axis == 2 { step as f64 } else { 0.0 };
            let lift = (side as isize) * strides[axis];
            let u_stride: isize = if axis == 0 { pw as isize } else { 1 };
            let v_stride: isize = if axis == 1 { pw as isize } else { sy as isize };
            let sign_stride = step * strides[axis];

            for a in 0..h {
                let py = a + pad;
                for b in 0..inner {
                    let looked_in = if axis == 1 { a as isize + step } else { b as isize + step };
                    let open = looked_in < 0 || looked_in >= room;
                    let row = if axis == 0 { (a * d) * w + b } else { (a * d + b) * w };
                    let mut start = 0usize;
                    let mut kind = 0u16;
                    let mut soft = false;
                    let mut ci = row;
                    for c in 0..=along {
                        let own = if c < along { cells[ci] } else { 0 };
                        if own == 0 && kind == 0 {
                            ci += stride;
                            continue;
                        }
                        let k = if own != 0 && (open || cells[(ci as isize + next) as usize] == 0) { own } else { 0 };
                        let s = if k != 0 {
                            let px = if axis == 0 { b } else { c } + pad;
                            let pz = if axis == 0 { c } else { b } + pad;
                            let pi = ((py * pd + pz) * pw + px) as isize;
                            let o = (pi + sign_stride) as usize;
                            let wo = wall_ref[o];
                            let outside_face = wo == 4
                                || (wo == 3
                                    && (wall_ref[o - 1] == 4
                                        || wall_ref[o + 1] == 4
                                        || wall_ref[o - pw] == 4
                                        || wall_ref[o + pw] == 4
                                        || wall_ref[o - sy] == 4
                                        || wall_ref[o + sy] == 4));
                            if !outside_face {
                                false
                            } else {
                                for q in 0..4usize {
                                    let qi = (pi + lift + ((q & 1) as isize) * u_stride + ((q >> 1) as isize) * v_stride) as usize;
                                    let idx = if slot[qi] != 0 {
                                        (slot[qi] - 1) as usize
                                    } else {
                                        let mut nx = 0.0f64;
                                        let mut ny = 0.0f64;
                                        let mut nz = 0.0f64;
                                        // SAFETY: `qi` is in `[pad..=pad+h, pad..=pad+d, pad..=pad+w]` and `pad = max(reach, OPEN_REACH) + 2`,
                                        // while stencil offsets span `[-reach-1..reach-1]` and `[-OPEN_REACH-1..OPEN_REACH-1]`.
                                        unsafe {
                                            let sp = shut_ptr.add(qi);
                                            for &(at, by) in n0 {
                                                nx += *sp.offset(at) as f64 * by;
                                            }
                                            for &(at, by) in n1 {
                                                ny += *sp.offset(at) as f64 * by;
                                            }
                                            for &(at, by) in n2 {
                                                nz += *sp.offset(at) as f64 * by;
                                            }
                                        }
                                        let l = (nx * nx + ny * ny + nz * nz).sqrt();
                                        if l > 1e-6 {
                                            nx /= l;
                                            ny /= l;
                                            nz /= l;
                                            let (ax, ay, az) = (nx.abs(), ny.abs(), nz.abs());
                                            let m = if ax >= ay && ax >= az {
                                                nx
                                            } else if ay >= az {
                                                ny
                                            } else {
                                                nz
                                            };
                                            let lean = |v: f64| -> f64 {
                                                let r = v / m;
                                                if r.abs() < 1e-6 {
                                                    1.5 * r * m
                                                } else {
                                                    ((-1.0 + (1.0 + 3.0 * r * r).sqrt()) / r) * m
                                                }
                                            };
                                            if m == nx {
                                                ny = lean(ny);
                                                nz = lean(nz);
                                            } else if m == ny {
                                                nx = lean(nx);
                                                nz = lean(nz);
                                            } else {
                                                nx = lean(nx);
                                                ny = lean(ny);
                                            }
                                            let l2 = (nx * nx + ny * ny + nz * nz).sqrt();
                                            nx /= l2;
                                            ny /= l2;
                                            nz /= l2;
                                        } else {
                                            nx = 0.0;
                                            ny = 0.0;
                                            nz = 0.0;
                                        }
                                        let mut shut_cnt = 0i32;
                                        unsafe {
                                            let op_p = sum_ptr.add(qi);
                                            for &(at, sign) in open_l {
                                                shut_cnt += *op_p.offset(at) * sign;
                                            }
                                        }
                                        let op = clamp(1.0 - 2.0 * (shut_cnt as f64 / open_size - 0.5), 0.0, 1.0) as f32;
                                        let id = known.len();
                                        known.push([nx as f32, ny as f32, nz as f32, op]);
                                        slot[qi] = (id + 1) as u32;
                                        id
                                    };
                                    let kv = known[idx];
                                    let (mut nx, mut ny, mut nz) = (kv[0] as f64, kv[1] as f64, kv[2] as f64);
                                    if nx == 0.0 && ny == 0.0 && nz == 0.0 {
                                        nx = ox;
                                        ny = oy;
                                        nz = oz;
                                    }
                                    let facing = nx * ox + ny * oy + nz * oz;
                                    if facing < LEAST_FACING {
                                        let corr = LEAST_FACING - facing;
                                        nx += ox * corr;
                                        ny += oy * corr;
                                        nz += oz * corr;
                                        let l = (nx * nx + ny * ny + nz * nz).sqrt();
                                        nx /= l;
                                        ny /= l;
                                        nz /= l;
                                    }
                                    let op_byte = js_round(kv[3] as f64 * 255.0) as u32;
                                    here[q] = fold(nx, ny, nz) | (op_byte << 20) | (7 << 28) | 0x8000_0000;
                                }
                                true
                            }
                        } else {
                            false
                        };

                        if k == kind && s == soft && c - start < 255 {
                            if !s {
                                ci += stride;
                                continue;
                            }
                            let a0 = alike(first[0]);
                            let a2 = alike(first[2]);
                            if alike(first[1]) == a0
                                && alike(first[3]) == a2
                                && alike(here[0]) == a0
                                && alike(here[1]) == a0
                                && alike(here[2]) == a2
                                && alike(here[3]) == a2
                            {
                                last = here;
                                ci += stride;
                                continue;
                            }
                        }
                        if kind != 0 {
                            let sx = if axis == 0 { b } else { start };
                            let sz = if axis == 0 { start } else { b };
                            faces_out.push((sx | (a << 10) | (sz << 20)) as u32);
                            faces_out.push(((c - start) | (axis << 8) | (side << 10) | ((kind as usize) << 16)) as u32);
                            if soft {
                                smooth_out.extend_from_slice(&[first[0], last[1], first[2], last[3]]);
                            } else {
                                smooth_out.extend_from_slice(&[0, 0, 0, 0]);
                            }
                        }
                        start = c;
                        kind = k;
                        soft = s;
                        if s {
                            first = here;
                            last = here;
                        }
                        ci += stride;
                    }
                }
            }
        }
    }
    faces_out.len() / 2
}

// ── Outside air, leak sealing, and shell-preserving coarsening (`car-sculpt.ts`) ──

fn outside_air_u8(solid: &[u8], w: usize, h: usize, d: usize, out: &mut Vec<u8>, queue: &mut Vec<u32>) {
    let n = w * h * d;
    out.clear();
    out.resize(n, 0);
    queue.resize(n, 0);
    let mut head = 0usize;
    let mut tail = 0usize;
    let wd = w * d;
    let pack = w <= 1024 && h <= 1024 && d <= 1024;
    if pack {
        macro_rules! push_p {
            ($x:expr, $y:expr, $z:expr, $idx:expr) => {
                let j = $idx;
                if solid[j] == 0 && out[j] == 0 {
                    out[j] = 1;
                    queue[tail] = ($x as u32) | (($z as u32) << 10) | (($y as u32) << 20);
                    tail += 1;
                }
            };
        }
        for y in 0..h {
            let y_edge = y == 0 || y == h - 1;
            for z in 0..d {
                let z_edge = z == 0 || z == d - 1;
                let row = (y * d + z) * w;
                if y_edge || z_edge {
                    for x in 0..w {
                        push_p!(x, y, z, row + x);
                    }
                } else {
                    push_p!(0, y, z, row);
                    if w > 1 {
                        push_p!(w - 1, y, z, row + w - 1);
                    }
                }
            }
        }
        while head < tail {
            let q = queue[head];
            head += 1;
            let x = (q & 1023) as usize;
            let z = ((q >> 10) & 1023) as usize;
            let y = (q >> 20) as usize;
            let i = (y * d + z) * w + x;
            if x > 0 { push_p!(x - 1, y, z, i - 1); }
            if x + 1 < w { push_p!(x + 1, y, z, i + 1); }
            if z > 0 { push_p!(x, y, z - 1, i - w); }
            if z + 1 < d { push_p!(x, y, z + 1, i + w); }
            if y > 0 { push_p!(x, y - 1, z, i - wd); }
            if y + 1 < h { push_p!(x, y + 1, z, i + wd); }
        }
        return;
    }
    macro_rules! push {
        ($idx:expr) => {
            let j = $idx;
            if solid[j] == 0 && out[j] == 0 {
                out[j] = 1;
                queue[tail] = j as u32;
                tail += 1;
            }
        };
    }
    for y in 0..h {
        let y_edge = y == 0 || y == h - 1;
        for z in 0..d {
            let z_edge = z == 0 || z == d - 1;
            let row = (y * d + z) * w;
            if y_edge || z_edge {
                for x in 0..w {
                    push!(row + x);
                }
            } else {
                push!(row);
                if w > 1 {
                    push!(row + w - 1);
                }
            }
        }
    }
    while head < tail {
        let i = queue[head] as usize;
        head += 1;
        let y = i / wd;
        let rem = i - y * wd;
        let z = rem / w;
        let x = rem - z * w;
        if x > 0 { push!(i - 1); }
        if x + 1 < w { push!(i + 1); }
        if z > 0 { push!(i - w); }
        if z + 1 < d { push!(i + w); }
        if y > 0 { push!(i - wd); }
        if y + 1 < h { push!(i + wd); }
    }
}

fn outside_air_u16(kinds: &[Kind], w: usize, h: usize, d: usize, out: &mut Vec<u8>, queue: &mut Vec<u32>) {
    let n = w * h * d;
    out.clear();
    out.resize(n, 0);
    queue.resize(n, 0);
    let mut head = 0usize;
    let mut tail = 0usize;
    let wd = w * d;
    let pack = w <= 1024 && h <= 1024 && d <= 1024;
    if pack {
        macro_rules! push_p {
            ($x:expr, $y:expr, $z:expr, $idx:expr) => {
                let j = $idx;
                if kinds[j] == 0 && out[j] == 0 {
                    out[j] = 1;
                    queue[tail] = ($x as u32) | (($z as u32) << 10) | (($y as u32) << 20);
                    tail += 1;
                }
            };
        }
        for y in 0..h {
            let y_edge = y == 0 || y == h - 1;
            for z in 0..d {
                let z_edge = z == 0 || z == d - 1;
                let row = (y * d + z) * w;
                if y_edge || z_edge {
                    for x in 0..w {
                        push_p!(x, y, z, row + x);
                    }
                } else {
                    push_p!(0, y, z, row);
                    if w > 1 {
                        push_p!(w - 1, y, z, row + w - 1);
                    }
                }
            }
        }
        while head < tail {
            let q = queue[head];
            head += 1;
            let x = (q & 1023) as usize;
            let z = ((q >> 10) & 1023) as usize;
            let y = (q >> 20) as usize;
            let i = (y * d + z) * w + x;
            if x > 0 { push_p!(x - 1, y, z, i - 1); }
            if x + 1 < w { push_p!(x + 1, y, z, i + 1); }
            if z > 0 { push_p!(x, y, z - 1, i - w); }
            if z + 1 < d { push_p!(x, y, z + 1, i + w); }
            if y > 0 { push_p!(x, y - 1, z, i - wd); }
            if y + 1 < h { push_p!(x, y + 1, z, i + wd); }
        }
        return;
    }
    macro_rules! push {
        ($idx:expr) => {
            let j = $idx;
            if kinds[j] == 0 && out[j] == 0 {
                out[j] = 1;
                queue[tail] = j as u32;
                tail += 1;
            }
        };
    }
    for y in 0..h {
        let y_edge = y == 0 || y == h - 1;
        for z in 0..d {
            let z_edge = z == 0 || z == d - 1;
            let row = (y * d + z) * w;
            if y_edge || z_edge {
                for x in 0..w {
                    push!(row + x);
                }
            } else {
                push!(row);
                if w > 1 {
                    push!(row + w - 1);
                }
            }
        }
    }
    while head < tail {
        let i = queue[head] as usize;
        head += 1;
        let y = i / wd;
        let rem = i - y * wd;
        let z = rem / w;
        let x = rem - z * w;
        if x > 0 { push!(i - 1); }
        if x + 1 < w { push!(i + 1); }
        if z > 0 { push!(i - w); }
        if z + 1 < d { push!(i + w); }
        if y > 0 { push!(i - wd); }
        if y + 1 < h { push!(i + wd); }
    }
}

fn most_around(kinds: &[Kind], w: usize, h: usize, d: usize, i: usize, is_paint: impl Fn(Kind) -> bool) -> Kind {
    let wd = w * d;
    let y = i / wd;
    let rem = i - y * wd;
    let z = rem / w;
    let x = rem - z * w;
    let mut tally = [(0u16, 0.0f64); 6];
    let mut len = 0usize;
    let mut add_k = |k: Kind| {
        if k == 0 {
            return;
        }
        let wt = if (k & 15) == LAMP {
            0.25
        } else if is_paint(k) || (k & 15) == GLASS {
            1.5
        } else {
            1.0
        };
        for slot in &mut tally[..len] {
            if slot.0 == k {
                slot.1 += wt;
                return;
            }
        }
        tally[len] = (k, wt);
        len += 1;
    };
    if x + 1 < w { add_k(kinds[i + 1]); }
    if x > 0 { add_k(kinds[i - 1]); }
    if y + 1 < h { add_k(kinds[i + wd]); }
    if y > 0 { add_k(kinds[i - wd]); }
    if z + 1 < d { add_k(kinds[i + w]); }
    if z > 0 { add_k(kinds[i - w]); }

    // Sort by kind ascending so ties go to the lower kind (matching `car-sculpt.ts:mostAround`).
    tally[..len].sort_unstable_by_key(|&(k, _)| k);
    let mut best = 0u16;
    let mut top = -1.0f64;
    for &(k, v) in &tally[..len] {
        if v > top {
            top = v;
            best = k;
        }
    }
    best
}

fn seal_leaks_impl(
    kinds: &mut [Kind],
    w: usize,
    h: usize,
    d: usize,
    is_paint: impl Fn(Kind) -> bool,
    out_air: &mut Vec<u8>,
    queue: &mut Vec<u32>,
) -> usize {
    let mut filled = 0usize;
    let mut to_fill: Vec<(usize, Kind)> = Vec::new();
    for _pass in 0..4 {
        outside_air_u16(kinds, w, h, d, out_air, queue);
        to_fill.clear();
        for y in 0..h {
            for z in 0..d {
                for x in 0..w {
                    let i = x + w * (z + d * y);
                    if kinds[i] != 0 || out_air[i] != 0 {
                        continue;
                    }
                    let mut near = false;
                    'outer: for b in -1isize..=1 {
                        let yy = y as isize + b;
                        if yy < 0 || yy >= h as isize { continue; }
                        for c in -1isize..=1 {
                            let zz = z as isize + c;
                            if zz < 0 || zz >= d as isize { continue; }
                            let base = (yy as usize * d + zz as usize) * w;
                            for a in -1isize..=1 {
                                let xx = x as isize + a;
                                if xx >= 0 && xx < w as isize && out_air[base + xx as usize] != 0 {
                                    near = true;
                                    break 'outer;
                                }
                            }
                        }
                    }
                    if near {
                        let k = most_around(kinds, w, h, d, i, &is_paint);
                        if k != 0 {
                            to_fill.push((i, k));
                        }
                    }
                }
            }
        }
        if to_fill.is_empty() {
            break;
        }
        for &(i, k) in &to_fill {
            kinds[i] = k;
        }
        filled += to_fill.len();
    }
    filled
}

/// Shell-preserving coarsening (`car-sculpt.ts:coarser`). Reads from `buf.cells[..w*h*d]`,
/// writes coarsened grid to `buf.out_cells`, sets `buf.out_size`, returns packed `cw | (ch<<10) | (cd<<20)`.
pub fn coarser(buf: &mut FineBuf, w: usize, h: usize, d: usize, by: usize) -> usize {
    let n = w * h * d;
    if by == 0 || buf.cells.len() < n {
        return 0;
    }
    let cw = w.div_ceil(by);
    let ch = h.div_ceil(by);
    let cd = d.div_ceil(by);
    let cn = cw * ch * cd;
    buf.out_size = [cw, ch, cd];

    outside_air_u16(&buf.cells[..n], w, h, d, &mut buf.out_air, &mut buf.queue);
    let kinds = &buf.cells[..n];
    let outside = &buf.out_air;

    buf.out_cells.clear();
    buf.out_cells.resize(cn, 0);
    let mut shut = vec![0u8; cn];
    let mut best = vec![0u16; cn];
    let by3 = by * by * by;
    let mut counts: Vec<(Kind, f64)> = Vec::with_capacity(16);

    for y in 0..ch {
        for z in 0..cd {
            for x in 0..cw {
                counts.clear();
                let mut filled = 0usize;
                let mut inside = 0usize;
                let y_end = ((y + 1) * by).min(h);
                let z_end = ((z + 1) * by).min(d);
                let x_end = ((x + 1) * by).min(w);
                for yy in y * by..y_end {
                    for zz in z * by..z_end {
                        let row = (yy * d + zz) * w;
                        for xx in x * by..x_end {
                            let i = row + xx;
                            let k = kinds[i];
                            if k == 0 {
                                if outside[i] == 0 {
                                    inside += 1;
                                }
                                continue;
                            }
                            filled += 1;
                            let wt = if (k & 15) == GLASS { 0.6 } else { 1.0 };
                            if let Some(entry) = counts.iter_mut().find(|e| e.0 == k) {
                                entry.1 += wt;
                            } else {
                                counts.push((k, wt));
                            }
                        }
                    }
                }
                let c = x + cw * (z + cd * y);
                if inside != 0 {
                    shut[c] = 1;
                }
                counts.sort_unstable_by_key(|&(k, _)| k);
                let mut b = 0u16;
                let mut m = 0.0f64;
                for &(kk, v) in &counts {
                    if v > m {
                        m = v;
                        b = kk;
                    }
                }
                best[c] = b;
                if filled * 3 >= by3 {
                    buf.out_cells[c] = b;
                }
            }
        }
    }

    let c_layer = cw * cd;
    for y in 0..ch {
        for z in 0..cd {
            for x in 0..cw {
                let c = x + cw * (z + cd * y);
                if buf.out_cells[c] != 0 || best[c] == 0 {
                    continue;
                }
                let near = shut[c] != 0
                    || (x > 0 && shut[c - 1] != 0)
                    || (x + 1 < cw && shut[c + 1] != 0)
                    || (z > 0 && shut[c - cw] != 0)
                    || (z + 1 < cd && shut[c + cw] != 0)
                    || (y > 0 && shut[c - c_layer] != 0)
                    || (y + 1 < ch && shut[c + c_layer] != 0);
                if near {
                    buf.out_cells[c] = best[c];
                }
            }
        }
    }

    seal_leaks_impl(
        &mut buf.out_cells,
        cw,
        ch,
        cd,
        |k| (k & 15) == STEEL,
        &mut buf.out_air,
        &mut buf.queue,
    );
    cw | (ch << 10) | (cd << 20)
}

// ── Procedural vehicle sculptors (`car-sculpt.ts`, `ojai-sculpt.ts`) ────────

struct CoupeKinds {
    glass: u16, screen: u16, gloss: u16, carbon: u16, liner: u16, grille: u16,
    tyre: u16, rim: u16, barrel: u16, caliper: u16, chrome: u16, head: u16,
    amber: u16, tail: u16, reverse: u16, plate: u16, seat: u16, insert: u16,
    dash: u16, alloy: u16,
}

const COUPE_K: CoupeKinds = CoupeKinds {
    glass: k_kind(GLASS, grey(12)),
    screen: k_kind(GLASS, grey(11)),
    gloss: k_kind(STEEL, grey(13)),
    carbon: k_kind(ROOFING, grey(12)),
    liner: k_kind(ROOFING, grey(13)),
    grille: k_kind(STEEL, grey(10)),
    tyre: k_kind(ROOFING, grey(14)),
    rim: k_kind(STEEL, grey(3)),
    barrel: k_kind(STEEL, grey(11)),
    caliper: k_kind(STEEL, hue(4, 3)),
    chrome: k_kind(STEEL, grey(4)),
    head: k_kind(LAMP, grey(0)),
    amber: k_kind(LAMP, hue(3, 4)),
    tail: k_kind(LAMP, hue(0, 4)),
    reverse: k_kind(LAMP, grey(0)),
    plate: k_kind(PLASTER, grey(1)),
    seat: k_kind(ROOFING, grey(12)),
    insert: k_kind(ROOFING, grey(10)),
    dash: k_kind(ROOFING, grey(11)),
    alloy: k_kind(STEEL, grey(6)),
};

/// 2-layer 27-neighbor skin depth marking from solid + outside air.
fn mark_two_layer_skin(solid: &[u8], outside: &[u8], w: usize, h: usize, d: usize, depth: &mut Vec<u8>) {
    let n = w * h * d;
    depth.clear();
    depth.resize(n, 0);
    for layer in 1u8..=2 {
        for y in 0..h {
            for z in 0..d {
                for x in 0..w {
                    let i = x + w * (z + d * y);
                    if solid[i] == 0 || depth[i] != 0 {
                        continue;
                    }
                    let mut near = false;
                    'nbr: for b in -1isize..=1 {
                        let yy = y as isize + b;
                        for c in -1isize..=1 {
                            let zz = z as isize + c;
                            for a in -1isize..=1 {
                                let xx = x as isize + a;
                                if xx < 0 || yy < 0 || zz < 0 || xx >= w as isize || yy >= h as isize || zz >= d as isize {
                                    if layer == 1 {
                                        near = true;
                                        break 'nbr;
                                    }
                                    continue;
                                }
                                let j = xx as usize + w * (zz as usize + d * yy as usize);
                                let hit = if layer == 1 { outside[j] != 0 } else { depth[j] == 1 };
                                if hit {
                                    near = true;
                                    break 'nbr;
                                }
                            }
                        }
                    }
                    if near {
                        depth[i] = layer + 8;
                    }
                }
            }
        }
        for v in depth.iter_mut() {
            if *v > 8 {
                *v -= 8;
            }
        }
    }
}

#[inline]
fn facing_5(solid: &[u8], w: usize, h: usize, d: usize, x: usize, y: usize, z: usize) -> (f64, f64, f64) {
    let mut gx = 0i32;
    let mut gy = 0i32;
    let mut gz = 0i32;
    let y0 = y.saturating_sub(2);
    let y1 = (y + 2).min(h - 1);
    let z0 = z.saturating_sub(2);
    let z1 = (z + 2).min(d - 1);
    let x0 = x.saturating_sub(2);
    let x1 = (x + 2).min(w - 1);
    for yy in y0..=y1 {
        let dy = yy as i32 - y as i32;
        for zz in z0..=z1 {
            let dz = zz as i32 - z as i32;
            let row = (yy * d + zz) * w;
            for xx in x0..=x1 {
                if solid[row + xx] != 0 {
                    gx += xx as i32 - x as i32;
                    gy += dy;
                    gz += dz;
                }
            }
        }
    }
    let l = ((gx as f64) * (gx as f64) + (gy as f64) * (gy as f64) + (gz as f64) * (gz as f64)).sqrt();
    let inv = if l == 0.0 { 1.0 } else { 1.0 / l };
    (-(gx as f64) * inv, -(gy as f64) * inv, (gz.abs() as f64) * inv)
}

/// Exact port of `car-sculpt.ts:sculptCoupe`. Params (13 f64):
/// `[L, H, W, per, xr, xf, wheelY, wheelR, tyreW, eyeX, eyeY, eyeZ, paint]`.
/// Writes cells into `buf.cells`, returns packed `w | (h<<10) | (d<<20)`.
pub fn sculpt_coupe(buf: &mut FineBuf) -> usize {
    if buf.params.len() < 13 {
        return 0;
    }
    let len = buf.params[0];
    let height = buf.params[1];
    let width = buf.params[2];
    let per = buf.params[3];
    let xr = buf.params[4];
    let xf = buf.params[5];
    let wheel_y = buf.params[6];
    let wheel_r = buf.params[7];
    let tyre_w = buf.params[8];
    let ex = buf.params[9];
    let ey = buf.params[10];
    let ez = buf.params[11];
    let paint = buf.params[12] as u16;

    let s_scale = per * 10.0;
    let w = (len * s_scale).ceil() as usize;
    let h = (height * s_scale).ceil() as usize;
    let d = (width * s_scale).ceil() as usize;
    let zc = d as f64 / (2.0 * s_scale);
    let n = w * h * d;
    let hw = width * 0.5 - 0.005;
    let h_roof = height - 0.02;

    let s_c = 0.635;
    let s_h = 0.525;
    let s_r = 0.335;
    let s_t = 0.075;
    let cowl_y = 0.785;
    let deck_y = 0.835;

    let b_plan = |x_m: f64| -> f64 {
        let s = x_m / len;
        let mut b = (hw - 0.042 + 0.042 * bump(x_m, xr, 0.5) + 0.032 * bump(x_m, xf, 0.45)).min(hw);
        if s > 0.8 { b *= 1.0 - 0.2 * ((s - 0.8) / 0.2).powf(2.2); }
        if s < 0.1 { b *= 1.0 - 0.09 * ((0.1 - s) / 0.1).powi(2); }
        b
    };
    const TOP_PTS: [(f64, f64); 9] = [
        (0.0, 0.80), (0.05, 0.835), (0.2, 0.81), (0.38, 0.745), (0.58, 0.755),
        (0.645, 0.785), (0.8, 0.705), (0.93, 0.625), (1.0, 0.55),
    ];
    let bottom = |x_m: f64| -> f64 {
        let s = x_m / len;
        0.145 + 0.03 * smooth(0.94, 1.0, s) + 0.06 * smooth(0.1, 0.0, s)
    };
    let lower_top = |x_m: f64, u: f64, b: f64| -> f64 {
        let s = x_m / len;
        let q = u / b;
        let mut y = through_cos(&TOP_PTS, s);
        y += 0.018 * (1.0 - smooth(0.0, 0.45, q)) * smooth(0.63, 0.72, s) * (1.0 - smooth(0.88, 0.98, s));
        y += 0.065 * bump(x_m, xf, 0.5) * smooth(0.4, 0.8, q) * smooth(0.6, 0.7, s);
        y += 0.06 * bump(x_m, xr, 0.55) * smooth(0.45, 0.85, q);
        let r = 0.09;
        let e = q * b - (b - r);
        if e > 0.0 {
            y -= r - (r * r - e * e).max(0.0).sqrt();
        }
        y
    };
    let side_fn = |x_m: f64, y_m: f64| -> f64 {
        let b = b_plan(x_m);
        let yb = bottom(x_m);
        let rb = 0.1;
        let mut u = b - 0.028 * smooth(0.46, 0.78, y_m);
        if y_m < yb + rb {
            let t = yb + rb - y_m;
            u -= rb - (rb * rb - t * t).max(0.0).sqrt();
        }
        let line = 0.615 + 0.045 * bump(x_m, xr, 0.6) + 0.02 * bump(x_m, xf, 0.5);
        if y_m < line && y_m > yb + 0.06 {
            u -= 1.0 / s_scale;
        }
        u
    };
    let front_fn = |y_m: f64, u: f64| -> f64 {
        len - 0.012
            - 0.2 * (u / hw).powi(3)
            - if y_m < 0.26 { 0.06 * ((0.26 - y_m) / 0.11).powi(2) } else { 0.0 }
            - if y_m > 0.44 { 0.1 * ((y_m.min(0.62) - 0.44) / 0.12).powi(2) } else { 0.0 }
    };
    let back_fn = |y_m: f64, u: f64| -> f64 {
        0.012
            + 0.11 * (u / hw).powi(3)
            + if y_m < 0.32 { 0.07 * ((0.32 - y_m) / 0.17).powi(2) } else { 0.0 }
            + if y_m > 0.6 { 0.07 * ((y_m.min(0.86) - 0.6) / 0.26).powi(2) } else { 0.0 }
    };
    let roof_fn = |s: f64| -> f64 {
        if s >= s_h {
            let t = clamp((s_c - s) / (s_c - s_h), 0.0, 1.0);
            cowl_y + (h_roof - 0.012 - cowl_y) * ((t * std::f64::consts::PI * 0.5).sin()).powf(0.85)
        } else if s >= s_r {
            h_roof - 0.012 * ((s - 0.45) / 0.075).powi(2)
        } else {
            let t = clamp((s_r - s) / (s_r - s_t), 0.0, 1.0);
            h_roof - 0.0045 - (h_roof - 0.0045 - deck_y) * t.powf(1.55)
        }
    };
    let belt = |x_m: f64| -> f64 { 0.735 + 0.045 * bump(x_m, xr, 0.55) };
    let glasshouse = |x_m: f64, y_m: f64| -> f64 {
        let s = x_m / len;
        let b = b_plan(x_m);
        let yb = belt(x_m);
        let g0 = b - 0.075 - 0.07 * smooth(0.55, s_c + 0.02, s) - 0.06 * smooth(0.2, s_t, s);
        g0 - 0.17 * clamp((y_m - yb) / (h_roof - yb), 0.0, 1.0).powf(1.25)
    };

    let lamp_low = |q: f64| -> f64 { 0.452 + 0.04 * clamp((q - 0.5) / 0.45, 0.0, 1.0) };
    let lamp_zone = |y_m: f64, u: f64, b: f64| -> bool {
        let q = u / b;
        let hi = 0.512 + 0.035 * clamp((q - 0.5) / 0.45, 0.0, 1.0);
        q > 0.47 && q < 0.95 && y_m > lamp_low(q) && y_m < hi - 0.03 * clamp((0.62 - q) / 0.15, 0.0, 1.0)
    };
    let grille_zone = |y_m: f64, u: f64, b: f64| -> bool {
        y_m > 0.215 && y_m < 0.41 && u < b * (0.36 + 0.16 * (0.41 - y_m) / 0.195)
    };
    let intake_zone = |y_m: f64, u: f64, b: f64| -> bool {
        y_m > 0.2 && y_m < 0.34 && u > b * 0.62 && u < b * 0.88
    };
    let tail_zone = |y_m: f64, u: f64, b: f64| -> bool { y_m > 0.66 && y_m < 0.705 && u < b * 0.97 };
    let plate_zone = |y_m: f64, u: f64| -> bool { y_m > 0.4 && y_m < 0.52 && u < 0.26 };
    let diffuser_zone = |y_m: f64, u: f64, b: f64| -> bool { y_m < 0.3 && u < b * 0.78 };
    let strake = |u: f64| -> bool {
        [0.08, 0.24, 0.4, 0.56].iter().any(|&c| (u - c).abs() < 0.013)
    };
    let b_front = b_plan(len - 0.1);
    let b_back = b_plan(0.1);
    let recess = |at_front: bool, y_m: f64, u: f64| -> f64 {
        if at_front {
            if lamp_zone(y_m, u, b_front) { 0.045 }
            else if grille_zone(y_m, u, b_front) { 0.06 }
            else if intake_zone(y_m, u, b_front) { 0.045 }
            else { 0.0 }
        } else if tail_zone(y_m, u, b_back) { 0.028 }
        else if plate_zone(y_m, u) { 0.03 }
        else if diffuser_zone(y_m, u, b_back) && !strake(u) { 0.12 * clamp((0.3 - y_m) / 0.16, 0.0, 1.0) }
        else { 0.0 }
    };

    // 1. Primary solid (precompute X-only & XY-only profiles to avoid millions of redundant exp/powf/sin calls).
    let mut solid = vec![0u8; n];
    let arch_r = wheel_r + 0.045;
    let inner = width * 0.5 - tyre_w - 0.09;
    let xs_m: Vec<f64> = (0..w).map(|x| (x as f64 + 0.5) / s_scale).collect();
    let bs_x: Vec<f64> = xs_m.iter().map(|&x_m| b_plan(x_m)).collect();
    let bots_x: Vec<f64> = xs_m.iter().map(|&x_m| bottom(x_m)).collect();
    let belts_x: Vec<f64> = xs_m.iter().map(|&x_m| belt(x_m)).collect();
    let top_x: Vec<f64> = xs_m.iter().map(|&x_m| through_cos(&TOP_PTS, x_m / len)).collect();
    let hood_x: Vec<f64> = xs_m.iter().map(|&x_m| { let s = x_m / len; 0.018 * smooth(0.63, 0.72, s) * (1.0 - smooth(0.88, 0.98, s)) }).collect();
    let bxf_x: Vec<f64> = xs_m.iter().map(|&x_m| 0.065 * bump(x_m, xf, 0.5) * smooth(0.6, 0.7, x_m / len)).collect();
    let bxr_x: Vec<f64> = xs_m.iter().map(|&x_m| 0.06 * bump(x_m, xr, 0.55)).collect();
    let line_x: Vec<f64> = xs_m.iter().map(|&x_m| 0.615 + 0.045 * bump(x_m, xr, 0.6) + 0.02 * bump(x_m, xf, 0.5)).collect();
    let roof_x: Vec<f64> = xs_m.iter().map(|&x_m| roof_fn(x_m / len)).collect();
    let g0_x: Vec<f64> = (0..w).map(|x| { let s = xs_m[x] / len; bs_x[x] - 0.075 - 0.07 * smooth(0.55, s_c + 0.02, s) - 0.06 * smooth(0.2, s_t, s) }).collect();
    let in_cabin_x: Vec<bool> = xs_m.iter().map(|&x_m| { let s = x_m / len; s >= s_t - 0.01 && s <= s_c + 0.005 }).collect();
    let us_z: Vec<f64> = (0..d).map(|z| ((z as f64 + 0.5) / s_scale - zc).abs()).collect();

    let mut side_yx = vec![0.0f64; h * w];
    let mut glass_yx = vec![0.0f64; h * w];
    let mut arch_hit = vec![false; w];
    for y in 0..h {
        let y_m = (y as f64 + 0.5) / s_scale;
        let sm_side = 0.028 * smooth(0.46, 0.78, y_m);
        let yw = y * w;
        for x in 0..w {
            let x_m = xs_m[x];
            let yb = bots_x[x];
            let rb = 0.1;
            let mut su = bs_x[x] - sm_side;
            if y_m < yb + rb {
                let t = yb + rb - y_m;
                su -= rb - (rb * rb - t * t).max(0.0).sqrt();
            }
            if y_m < line_x[x] && y_m > yb + 0.06 {
                su -= 1.0 / s_scale;
            }
            side_yx[yw + x] = su;
            let ybelt = belts_x[x];
            glass_yx[yw + x] = if y_m >= ybelt - 0.06 {
                g0_x[x] - 0.17 * clamp((y_m - ybelt) / (h_roof - ybelt), 0.0, 1.0).powf(1.25)
            } else {
                0.0
            };
            arch_hit[x] = (x_m - xr).hypot(y_m - wheel_y) < arch_r || (x_m - xf).hypot(y_m - wheel_y) < arch_r;
        }
        for z in 0..d {
            let u = us_z[z];
            let f = front_fn(y_m, u);
            let r0 = back_fn(y_m, u);
            let row = (y * d + z) * w;
            let rec_f = recess(true, y_m, u);
            let rec_r = recess(false, y_m, u);
            let u_gt_inner = u > inner;
            for x in 0..w {
                let x_m = xs_m[x];
                if x_m > f || x_m < r0 {
                    continue;
                }
                if u_gt_inner && arch_hit[x] {
                    continue;
                }
                let b = bs_x[x];
                let lower = if y_m >= bots_x[x] && u <= side_yx[yw + x] {
                    let q = u / b;
                    let mut ly = top_x[x]
                        + hood_x[x] * (1.0 - smooth(0.0, 0.45, q))
                        + bxf_x[x] * smooth(0.4, 0.8, q)
                        + bxr_x[x] * smooth(0.45, 0.85, q);
                    let r = 0.09;
                    let e = q * b - (b - r);
                    if e > 0.0 {
                        ly -= r - (r * r - e * e).max(0.0).sqrt();
                    }
                    y_m <= ly
                } else {
                    false
                };
                if !lower {
                    if !in_cabin_x[x] || y_m < belts_x[x] - 0.06 {
                        continue;
                    }
                    let g = glass_yx[yw + x];
                    if u > g {
                        continue;
                    }
                    let rx = roof_x[x];
                    if y_m > rx {
                        continue;
                    }
                    if y_m > rx - 0.065 && y_m > rx - 0.065 * clamp(u / g.max(0.05), 0.0, 1.0).powf(2.4) {
                        continue;
                    }
                }
                if x_m > f - 0.07 && x_m > f - rec_f {
                    continue;
                }
                if x_m < r0 + 0.13 && x_m < r0 + rec_r {
                    continue;
                }
                solid[row + x] = 1;
            }
        }
    }

    // Added exterior parts.
    let mut add = |x0: f64, x1: f64, y0: f64, y1: f64, test: &dyn Fn(f64, f64, f64) -> bool| {
        let ya = (y0 * s_scale).floor().max(0.0) as usize;
        let yb = ((y1 * s_scale).ceil().max(0.0) as usize).min(h);
        let xa = (x0 * s_scale).floor().max(0.0) as usize;
        let xb = ((x1 * s_scale).ceil().max(0.0) as usize).min(w);
        for y in ya..yb {
            let y_m = (y as f64 + 0.5) / s_scale;
            for z in 0..d {
                let u = us_z[z];
                let row = (y * d + z) * w;
                for x in xa..xb {
                    if test(xs_m[x], y_m, u) {
                        solid[row + x] = 2;
                    }
                }
            }
        }
    };
    add(len - 0.2, len, 0.12, 0.17, &|x_m, y_m, u| {
        y_m >= 0.125 && y_m < 0.16 && u < b_plan(x_m) * 0.94 && x_m < len - 0.004 - 0.16 * (u / hw).powi(3) && x_m > len - 0.2
    });
    add(xr, xf, 0.14, 0.21, &|x_m, y_m, u| {
        x_m > xr + wheel_r + 0.1 && x_m < xf - wheel_r - 0.1 && y_m > 0.15 && y_m < 0.205 && u <= b_plan(x_m) - 0.03 + 0.0125 && u > b_plan(x_m) - 0.09
    });
    add(0.0, 0.14, deck_y - 0.02, deck_y + 0.04, &|x_m, y_m, u| {
        x_m > back_fn(y_m, u) - 0.012 && x_m < 0.13 && y_m > deck_y - 0.01 && y_m < deck_y + 0.032 - 0.02 * (x_m / 0.13) && u < b_back * 0.9
    });
    let mx = s_c * len - 0.16;
    let my = 0.88;
    let mu_c = glasshouse(mx, my) + 0.075;
    add(mx - 0.1, mx + 0.1, my - 0.07, my + 0.06, &|x_m, y_m, u| {
        ((x_m - mx) / 0.075).powi(2) + ((y_m - my) / 0.045).powi(2) + ((u - mu_c) / 0.065).powi(2) <= 1.0
            || ((x_m - mx - 0.02).abs() < 0.014 && (y_m - (my - 0.035)).abs() < 0.014 && u > mu_c - 0.11 && u < mu_c)
    });
    let pipe_u = b_back * 0.6;
    let pipe_y = 0.235;
    add(0.0, 0.25, pipe_y - 0.05, pipe_y + 0.05, &|x_m, y_m, u| {
        x_m > back_fn(y_m, u) - 0.035 && x_m < back_fn(y_m, u) + 0.12 && (y_m - pipe_y).hypot(u - pipe_u) < 0.044
    });

    // 2. Two-cell skin.
    outside_air_u8(&solid, w, h, d, &mut buf.out_air, &mut buf.queue);
    let mut depth = Vec::new();
    mark_two_layer_skin(&solid, &buf.out_air, w, h, d, &mut depth);

    // 3. Surface material assignment.
    let screen_at = |y_m: f64| -> f64 {
        s_c - (s_c - s_h) * (2.0 / std::f64::consts::PI) * clamp((y_m - cowl_y) / (h_roof - 0.012 - cowl_y), 0.0, 1.0).powf(1.0 / 0.85).asin()
    };
    let side_glass = |x_m: f64, y_m: f64| -> bool {
        let s = x_m / len;
        let yb = belt(x_m) + 0.035;
        let t = clamp((y_m - yb) / (h_roof - yb), 0.0, 1.0);
        let fwd = screen_at(y_m) - 0.045 / len;
        let aft = 0.205 + 0.14 * t.powf(0.8);
        y_m > yb && y_m < roof_fn(s) - 0.115 && s < fwd && s > aft && !(s > 0.4 && s < 0.416)
    };
    let near_arch = |x_m: f64, y_m: f64, extra: f64| -> bool {
        (x_m - xr).hypot(y_m - wheel_y).min((x_m - xf).hypot(y_m - wheel_y)) < arch_r + extra
    };
    let kind_at = |x: usize, y: usize, z: usize, added: bool| -> u16 {
        let x_m = xs_m[x];
        let y_m = (y as f64 + 0.5) / s_scale;
        let u = us_z[z];
        let s = x_m / len;
        let b = bs_x[x];
        if added {
            if y_m < 0.21 { return COUPE_K.carbon; }
            if (y_m - pipe_y).hypot(u - pipe_u) < 0.05 && x_m < 0.3 {
                return if (y_m - pipe_y).hypot(u - pipe_u) < 0.028 { COUPE_K.liner } else { COUPE_K.chrome };
            }
            if x_m < 0.15 { return COUPE_K.carbon; }
            let cap = ((x_m - mx) / 0.075).powi(2) + ((y_m - my) / 0.045).powi(2) + ((u - mu_c) / 0.065).powi(2) <= 1.0;
            return if !cap { COUPE_K.gloss } else if x_m < mx - 0.045 { COUPE_K.gloss } else { paint };
        }
        if u > inner - 2.2 / s_scale && u < side_fn(x_m, y_m) - 1.5 / s_scale && near_arch(x_m, y_m, 1.4 / s_scale) {
            if u <= inner + 0.8 / s_scale && near_arch(x_m, y_m, 0.6 / s_scale) && y_m > bots_x[x] + 1.0 / s_scale {
                return COUPE_K.liner;
            }
            if u > inner - 1.0 / s_scale {
                let (_, f_up, f_out) = facing_5(&solid, w, h, d, x, y, z);
                if f_out < 0.6 && f_up < 0.3 {
                    return COUPE_K.liner;
                }
            }
        }
        if x_m > front_fn(y_m, u) - 0.11 {
            let q = u / b_front;
            if lamp_zone(y_m, u, b_front) {
                return if q > 0.85 { COUPE_K.amber } else if y_m < lamp_low(q) + 0.012 { COUPE_K.gloss } else { COUPE_K.head };
            }
            if grille_zone(y_m, u, b_front) {
                return if (y + ((z / 2) & 1)) % 3 == 0 { COUPE_K.grille } else { COUPE_K.liner };
            }
            if intake_zone(y_m, u, b_front) {
                return if (q - 0.75).abs() < 0.02 { COUPE_K.carbon } else { COUPE_K.liner };
            }
            if y_m < 0.2 { return COUPE_K.carbon; }
        }
        if x_m < back_fn(y_m, u) + 0.15 {
            if tail_zone(y_m, u, b_back) {
                return if u > b_back * 0.14 && u < b_back * 0.28 { COUPE_K.reverse } else { COUPE_K.tail };
            }
            if plate_zone(y_m, u) {
                return if u > 0.235 || y_m < 0.415 || y_m > 0.505 { COUPE_K.liner } else { COUPE_K.plate };
            }
            if diffuser_zone(y_m, u, b_back) { return COUPE_K.carbon; }
        }
        if x_m < 0.16 && y_m > 0.66 && y_m < 0.705 && u > b - 0.04 {
            return COUPE_K.tail;
        }
        let lower = y_m >= bots_x[x] && u <= side_fn(x_m, y_m) && y_m <= lower_top(x_m, u, b);
        if !lower && y_m > belt(x_m) - 0.01 && s > s_t - 0.012 && s < s_c + 0.01 {
            let (f_ahead, f_up, f_out) = facing_5(&solid, w, h, d, x, y, z);
            let g = glasshouse(x_m, y_m);
            if f_up + f_ahead.max(0.0) > f_out * 1.1 {
                if s > s_h - 0.004 {
                    return if y_m < cowl_y + 0.025 || u > g - 0.04 { COUPE_K.gloss } else { COUPE_K.screen };
                }
                if s < s_r - 0.01 && s > 0.13 && s < 0.315 && u < g - 0.07 {
                    return COUPE_K.glass;
                }
                return paint;
            }
            if side_glass(x_m, y_m) {
                return COUPE_K.glass;
            }
            return if s > screen_at(y_m) - 0.045 / len || (s > 0.395 && s < 0.421 && y_m > belt(x_m) + 0.03 && y_m < roof_fn(s) - 0.04) {
                COUPE_K.gloss
            } else {
                paint
            };
        }
        if s > 0.468 && s < 0.49 && y_m > 0.6 && y_m < 0.625 && u > side_fn(x_m, y_m) - 0.03 {
            return COUPE_K.gloss;
        }
        paint
    };

    buf.cells.clear();
    buf.cells.resize(n, 0);
    let kinds = &mut buf.cells;
    for y in 0..h {
        for z in 0..d {
            let row = (y * d + z) * w;
            for x in 0..w {
                let i = row + x;
                if depth[i] == 1 {
                    kinds[i] = kind_at(x, y, z, solid[i] == 2);
                }
            }
        }
    }
    for y in 0..h {
        for z in 0..d {
            let row = (y * d + z) * w;
            for x in 0..w {
                let i = row + x;
                if depth[i] != 2 {
                    continue;
                }
                let mut glass = 0u16;
                let mut first = 0u16;
                for c in -1isize..=1 {
                    let zz = z as isize + c;
                    if zz < 0 || zz >= d as isize { continue; }
                    for b in -1isize..=1 {
                        let yy = y as isize + b;
                        if yy < 0 || yy >= h as isize { continue; }
                        let base = (yy as usize * d + zz as usize) * w;
                        for a in -1isize..=1 {
                            let xx = x as isize + a;
                            if xx < 0 || xx >= w as isize { continue; }
                            let j = base + xx as usize;
                            if depth[j] != 1 { continue; }
                            if (kinds[j] & 15) == GLASS {
                                glass = kinds[j];
                            } else if first == 0 || (a.abs() + b.abs() + c.abs() == 1) {
                                first = kinds[j];
                            }
                        }
                    }
                }
                kinds[i] = if glass != 0 {
                    glass
                } else if first != 0 {
                    first
                } else {
                    kind_at(x, y, z, solid[i] == 2)
                };
            }
        }
    }

    // Fill corner notches.
    let wd = w * d;
    for y in 1..h - 1 {
        for z in 1..d - 1 {
            let row = (y * d + z) * w;
            for x in 1..w - 1 {
                let i = row + x;
                if kinds[i] != 0 { continue; }
                let pairs = ((kinds[i - 1] != 0 && kinds[i + 1] != 0) as u8)
                    + ((kinds[i - w] != 0 && kinds[i + w] != 0) as u8)
                    + ((kinds[i - wd] != 0 && kinds[i + wd] != 0) as u8);
                if pairs >= 2 {
                    kinds[i] = most_around(kinds, w, h, d, i, |k| k == paint);
                }
            }
        }
    }

    // 4. Wheels.
    for xm in [xr, xf] {
        for left in [true, false] {
            let z0 = if left { zc - (width * 0.5 - 0.005) } else { zc + (width * 0.5 - 0.005) - tyre_w };
            let z1 = z0 + tyre_w;
            let ya = ((wheel_y - wheel_r) * s_scale).floor() as isize;
            let yb = ((wheel_y + wheel_r) * s_scale).ceil() as isize;
            let za = (z0 * s_scale).floor() as isize;
            let zb = (z1 * s_scale).ceil() as isize;
            let xa = ((xm - wheel_r) * s_scale).floor() as isize;
            let xb = ((xm + wheel_r) * s_scale).ceil() as isize;
            for y in ya.max(0)..=yb.min(h as isize - 1) {
                let y_m = (y as f64 + 0.5) / s_scale;
                for z in za.max(0)..zb.min(d as isize) {
                    let z_m = (z as f64 + 0.5) / s_scale;
                    let out = if left { z_m - z0 } else { z1 - z_m };
                    let shoulder = out.min(tyre_w - out);
                    let r_lim = (wheel_r - 0.03 + (0.03f64).min(shoulder * 0.6)).min(wheel_r);
                    let row = (y as usize * d + z as usize) * w;
                    for x in xa.max(0)..=xb.min(w as isize - 1) {
                        let x_m = (x as f64 + 0.5) / s_scale;
                        let r = (x_m - xm).hypot(y_m - wheel_y);
                        if r > r_lim { continue; }
                        let a = (y_m - wheel_y).atan2(x_m - xm);
                        let kind = if r > wheel_r * 0.7 {
                            COUPE_K.tyre
                        } else if out < 0.025 {
                            let spoke = (5.0 * a).cos() > 0.62 || (5.0 * a + 0.55).cos() > 0.86;
                            if r > wheel_r * 0.62 { COUPE_K.rim }
                            else if r < wheel_r * 0.16 { if r < wheel_r * 0.07 { COUPE_K.chrome } else { COUPE_K.barrel } }
                            else if spoke { COUPE_K.rim }
                            else { 0 }
                        } else if out < 0.06 {
                            let toward = if xm < len * 0.5 { a.cos() > 0.55 } else { a.cos() < -0.55 };
                            if r > wheel_r * 0.3 && r < wheel_r * 0.56 && toward && a.sin() > -0.2 { COUPE_K.caliper }
                            else if r < wheel_r * 0.56 { COUPE_K.alloy }
                            else { COUPE_K.barrel }
                        } else {
                            COUPE_K.barrel
                        };
                        kinds[row + x as usize] = kind;
                    }
                }
            }
        }
    }

    // 5. Interior.
    let outside = &buf.out_air;
    let dz = (ez - zc).abs();
    let mut fill = |x0: f64, x1: f64, y0: f64, y1: f64, test: &dyn Fn(f64, f64, f64, f64) -> u16| {
        let ya = (y0 * s_scale).floor().max(0.0) as usize;
        let yb = ((y1 * s_scale).ceil().max(0.0) as usize).min(h);
        let xa = (x0 * s_scale).floor().max(0.0) as usize;
        let xb = ((x1 * s_scale).ceil().max(0.0) as usize).min(w);
        for y in ya..yb {
            let y_m = (y as f64 + 0.5) / s_scale;
            for z in 0..d {
                let z_m = (z as f64 + 0.5) / s_scale;
                let zs = z_m - zc;
                let u = zs.abs();
                let row = (y * d + z) * w;
                for x in xa..xb {
                    let i = row + x;
                    if kinds[i] != 0 || outside[i] != 0 { continue; }
                    let k = test(xs_m[x], y_m, u, zs);
                    if k != 0 { kinds[i] = k; }
                }
            }
        }
    };
    let cab0 = ex - 0.55;
    let cab1 = s_c * len;
    fill(cab0 - 0.4, cab1, 0.17, 0.23, &|_, _, _, _| COUPE_K.dash);
    fill(cab0, cab1, 0.23, 0.44, &|x_m, y_m, u, _| {
        if u < 0.1 - if y_m > 0.4 { 0.02 } else { 0.0 } {
            if y_m > 0.42 && x_m > ex + 0.1 && x_m < ex + 0.2 && u < 0.03 { COUPE_K.alloy } else { COUPE_K.dash }
        } else { 0 }
    });
    for sz_s in [-dz, dz] {
        let cx = ex + 0.06;
        fill(cx - 0.5, cx + 0.3, 0.22, ey + 0.02, &|x_m, y_m, _, zs| {
            let q = (zs - sz_s).abs();
            if q > 0.25 { return 0; }
            let bolster = q > 0.16;
            if x_m > cx - 0.24 && x_m < cx + 0.26 && y_m < 0.36 + if bolster { 0.06 } else { 0.0 } - 0.04 * clamp((x_m - cx) / 0.26, 0.0, 1.0) {
                return if bolster { COUPE_K.seat } else { COUPE_K.insert };
            }
            let lean = cx - 0.24 - (y_m - 0.36) * 0.28;
            let thick = if bolster { 0.15 } else { 0.1 };
            if y_m > 0.3 && y_m < ey - 0.1 && x_m < lean + thick && x_m > lean - 0.03 {
                return if bolster { COUPE_K.seat } else { COUPE_K.insert };
            }
            if y_m >= ey - 0.12 && y_m < ey + 0.02 && q < 0.13 && x_m < lean + 0.08 && x_m > lean - 0.03 {
                return COUPE_K.seat;
            }
            0
        });
    }
    let dash_back = ex + 0.42;
    fill(dash_back, cab1 + 0.05, 0.5, cowl_y + 0.02, &|x_m, y_m, u, zs| {
        if u > glasshouse(x_m, y_m) - 0.005 && y_m > belt(x_m) - 0.02 { return 0; }
        let lid = 0.775 + 0.03 * clamp((x_m - dash_back) / 0.3, 0.0, 1.0);
        if y_m < lid {
            return if y_m > lid - 0.025 && x_m < dash_back + 0.03 { COUPE_K.alloy } else { COUPE_K.dash };
        }
        if (zs + if ez < zc { dz } else { -dz }).abs() < 0.14 && x_m < dash_back + 0.14 && y_m < lid + 0.05 { COUPE_K.dash } else { 0 }
    });
    let wx = dash_back - 0.16;
    let wy = ey - 0.25;
    let wr = 0.155;
    let lean = 0.36f64;
    let e1 = [-lean.sin(), lean.cos()];
    let nrm = [lean.cos(), lean.sin()];
    fill(wx - 0.25, wx + 0.35, wy - 0.2, wy + 0.2, &|x_m, y_m, _, zs| {
        let vx = x_m - wx;
        let vy = y_m - wy;
        let vz = zs - (ez - zc);
        let a = vx * e1[0] + vy * e1[1];
        let c = vx * nrm[0] + vy * nrm[1];
        let r = a.hypot(vz);
        if c.abs() < 0.022 && (r - wr).abs() < 0.02 { return COUPE_K.gloss; }
        if c.abs() < 0.018 && r < wr && (r < 0.045 || (vz.abs() < 0.016 && a < 0.0) || (a + 0.01).abs() < 0.016) {
            return if r < 0.045 { COUPE_K.dash } else { COUPE_K.alloy };
        }
        let along0 = vx - c * nrm[0];
        let along1 = vy - c * nrm[1];
        let d_col = ((along0 + c * 0.3 * lean.sin()).powi(2) + (along1 + c * 0.3).powi(2) + vz * vz).sqrt();
        if c > 0.0 && c < 0.32 && d_col < 0.028 { COUPE_K.dash } else { 0 }
    });

    buf.out_size = [w, h, d];
    w | (h << 10) | (d << 20)
}

/// Exact port of `car-sculpt.ts:sculptKart`. Params: `paint` and `per` (default 4).
pub fn sculpt_kart(buf: &mut FineBuf, paint: u16, per: f64) -> usize {
    let per = if per <= 0.0 { 4.0 } else { per };
    let len = 2.4;
    let height = 0.85;
    let width = 1.4;
    let s_scale = per * 10.0;
    let w = (len * s_scale).ceil() as usize;
    let h = (height * s_scale).ceil() as usize;
    let d = (width * s_scale).ceil() as usize;
    let zc = d as f64 / (2.0 * s_scale);
    let n = w * h * d;
    buf.cells.clear();
    buf.cells.resize(n, 0);
    let kinds = &mut buf.cells;
    let xr = 0.5;
    let xf = 1.9;
    let wheel_y = 0.3;
    let wheel_r = 0.3;
    let tyre_w = 0.22;

    for y in 0..h {
        let y_m = (y as f64 + 0.5) / s_scale;
        for z in 0..d {
            let z_m = (z as f64 + 0.5) / s_scale;
            let u = (z_m - zc).abs();
            let row = (y * d + z) * w;
            for x in 0..w {
                let x_m = (x as f64 + 0.5) / s_scale;
                let mut k0 = 0u16;
                let tray_u = if x_m > 1.75 { 0.34 - (x_m - 1.75) * 0.22 } else if x_m < 0.55 { 0.34 } else { 0.42 };
                if y_m >= 0.14 && y_m < 0.21 && x_m >= 0.18 && x_m <= 2.28 && u <= tray_u { k0 = COUPE_K.carbon; }
                if x_m >= 2.24 && x_m <= 2.38 && y_m >= 0.17 && y_m <= 0.30 && u <= 0.54 { k0 = COUPE_K.carbon; }
                if x_m >= 0.04 && x_m <= 0.18 && y_m >= 0.18 && y_m <= 0.34 && u <= 0.56 { k0 = COUPE_K.carbon; }
                if x_m >= 1.46 && x_m <= 2.34 {
                    let t = clamp((x_m - 1.46) / 0.88, 0.0, 1.0);
                    let hw = 0.26 * (1.0 - 0.52 * t * t);
                    let top_y = 0.52 - 0.23 * t.powf(1.15) - 0.06 * clamp(u / hw.max(0.05), 0.0, 1.0).powi(2);
                    if u <= hw && y_m >= 0.20 && y_m <= top_y {
                        let lamp = x_m > 2.22 && u > hw * 0.42 && y_m > 0.22 && y_m < 0.31;
                        let badge = x_m > 1.78 && x_m < 1.96 && u < 0.06 && y_m > top_y - 0.03;
                        k0 = if lamp { COUPE_K.head } else if badge { COUPE_K.gloss } else { paint };
                    }
                }
                if x_m >= 0.86 && x_m <= 1.56 && u >= 0.32 && u <= 0.64 {
                    let s = (x_m - 0.86) / 0.70;
                    let top_y = 0.43 - 0.05 * (s - 0.45).abs() - 0.04 * clamp((u - 0.32) / 0.32, 0.0, 1.0).powi(2);
                    if y_m >= 0.19 && y_m <= top_y {
                        let intake = x_m > 1.44 && u > 0.40 && u < 0.58 && y_m > 0.24 && y_m < top_y - 0.04;
                        k0 = if y_m < 0.23 { COUPE_K.carbon } else if intake { COUPE_K.liner } else { paint };
                    }
                }
                if x_m >= 0.16 && x_m <= 0.64 && u <= 0.32 && y_m >= 0.20 && y_m <= 0.48 {
                    let fin = x_m >= 0.26 && x_m <= 0.54 && u <= 0.20 && y_m >= 0.34 && y_m <= 0.47
                        && (((x_m * s_scale).floor() as i32 + (y_m * s_scale).floor() as i32) & 1) == 0;
                    let tail = x_m <= 0.22 && u >= 0.14 && u <= 0.28 && y_m >= 0.30 && y_m <= 0.37;
                    k0 = if tail { COUPE_K.tail } else if fin { COUPE_K.alloy } else if y_m < 0.34 { COUPE_K.liner } else { COUPE_K.gloss };
                }
                if x_m >= 0.06 && x_m <= 0.32 && (y_m - 0.32).hypot(z_m - (zc + 0.24)) < 0.045 {
                    k0 = COUPE_K.chrome;
                }
                if x_m >= 0.60 && x_m <= 1.24 && u <= 0.27 {
                    let bolster = u > 0.17;
                    if x_m >= 0.80 && x_m <= 1.22 && y_m >= 0.21 && y_m <= 0.31 + if bolster { 0.06 } else { 0.0 } {
                        k0 = if bolster { COUPE_K.seat } else { COUPE_K.insert };
                    }
                    let lean = 0.80 - (y_m - 0.30) * 0.28;
                    if y_m >= 0.26 && y_m <= 0.76 && x_m <= lean + if bolster { 0.12 } else { 0.08 } && x_m >= lean - 0.05 {
                        k0 = if x_m <= lean - 0.01 { paint } else if bolster { COUPE_K.seat } else { COUPE_K.insert };
                    }
                }
                if k0 != 0 { kinds[row + x] = k0; }
            }
        }
    }

    let wx = 1.44;
    let wy = 0.56;
    let wr = 0.14;
    let lean = 0.42f64;
    let e1 = [-lean.sin(), lean.cos()];
    let nrm = [lean.cos(), lean.sin()];
    let ya = (0.30 * s_scale).floor().max(0.0) as usize;
    let yb = ((0.74 * s_scale).ceil().max(0.0) as usize).min(h);
    let za = ((zc - 0.20) * s_scale).floor().max(0.0) as usize;
    let zb = (((zc + 0.20) * s_scale).ceil().max(0.0) as usize).min(d);
    let xa = (1.25 * s_scale).floor().max(0.0) as usize;
    let xb = ((1.85 * s_scale).ceil().max(0.0) as usize).min(w);
    for y in ya..yb {
        let y_m = (y as f64 + 0.5) / s_scale;
        for z in za..zb {
            let vz = (z as f64 + 0.5) / s_scale - zc;
            let row = (y * d + z) * w;
            for x in xa..xb {
                let x_m = (x as f64 + 0.5) / s_scale;
                let vx = x_m - wx;
                let vy = y_m - wy;
                let a = vx * e1[0] + vy * e1[1];
                let c = vx * nrm[0] + vy * nrm[1];
                let r = a.hypot(vz);
                if c.abs() < 0.022 && (r - wr).abs() < 0.022 {
                    kinds[row + x] = COUPE_K.gloss;
                } else if c.abs() < 0.018 && r < wr && (r < 0.042 || (vz.abs() < 0.016 && a < 0.0) || (a + 0.01).abs() < 0.016) {
                    kinds[row + x] = if r < 0.042 { COUPE_K.dash } else { COUPE_K.alloy };
                } else if c > 0.0 && c < 0.38 {
                    let dx = vx - c * nrm[0] + c * 0.32 * lean.sin();
                    let dy = vy - c * nrm[1] + c * 0.32;
                    if (dx * dx + dy * dy + vz * vz).sqrt() < 0.025 {
                        kinds[row + x] = COUPE_K.dash;
                    }
                }
            }
        }
    }

    for xm in [xr, xf] {
        for left in [true, false] {
            let z0 = if left { zc - (width * 0.5 - 0.005) } else { zc + (width * 0.5 - 0.005) - tyre_w };
            let z1 = z0 + tyre_w;
            let ya = ((wheel_y - wheel_r) * s_scale).floor() as isize;
            let yb = ((wheel_y + wheel_r) * s_scale).ceil() as isize;
            let za = (z0 * s_scale).floor() as isize;
            let zb = (z1 * s_scale).ceil() as isize;
            let xa = ((xm - wheel_r) * s_scale).floor() as isize;
            let xb = ((xm + wheel_r) * s_scale).ceil() as isize;
            for y in ya.max(0)..=yb.min(h as isize - 1) {
                let y_m = (y as f64 + 0.5) / s_scale;
                for z in za.max(0)..zb.min(d as isize) {
                    let z_m = (z as f64 + 0.5) / s_scale;
                    let out = if left { z_m - z0 } else { z1 - z_m };
                    let shoulder = out.min(tyre_w - out);
                    let r_lim = (wheel_r - 0.025 + (0.025f64).min(shoulder * 0.6)).min(wheel_r);
                    let row = (y as usize * d + z as usize) * w;
                    for x in xa.max(0)..=xb.min(w as isize - 1) {
                        let x_m = (x as f64 + 0.5) / s_scale;
                        let r = (x_m - xm).hypot(y_m - wheel_y);
                        if r > r_lim { continue; }
                        let a = (y_m - wheel_y).atan2(x_m - xm);
                        let kind = if r > wheel_r * 0.66 {
                            COUPE_K.tyre
                        } else if out < 0.025 {
                            if r > wheel_r * 0.58 { COUPE_K.rim }
                            else if r < wheel_r * 0.16 { COUPE_K.chrome }
                            else if (5.0 * a).cos() > 0.55 { COUPE_K.rim }
                            else { COUPE_K.barrel }
                        } else {
                            COUPE_K.barrel
                        };
                        kinds[row + x as usize] = kind;
                    }
                }
            }
        }
    }
    buf.out_size = [w, h, d];
    w | (h << 10) | (d << 20)
}

fn glyph_5x7(ch: u8) -> [u8; 7] {
    match ch {
        b'A' => [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        b'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        b'C' => [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
        b'D' => [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
        b'E' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
        b'F' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
        b'G' => [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
        b'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        b'I' => [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        b'J' => [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
        b'K' => [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
        b'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        b'M' => [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
        b'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
        b'O' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        b'P' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
        b'Q' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
        b'R' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
        b'S' => [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
        b'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        b'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        b'V' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        b'W' => [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b01010],
        b'X' => [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
        b'Y' => [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
        b'Z' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
        b'0' => [0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b10001, 0b01110],
        b'1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        b'2' => [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
        b'3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        b'4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        b'5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        b'6' => [0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110],
        b'7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        b'8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        b'9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
        b'?' => [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0b00000, 0b00100],
        b'!' => [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
        b'-' => [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
        b'.' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
        _ => [0; 7],
    }
}

struct OjaiKinds {
    glass: u16, screen: u16, gloss: u16, cladding: u16, liner: u16, tyre: u16,
    rim: u16, barrel: u16, alloy: u16, caliper: u16, chrome: u16, head: u16,
    amber: u16, tail: u16, reverse: u16, plate: u16, seat: u16, cushion: u16, dash: u16,
}

const OJAI_K: OjaiKinds = OjaiKinds {
    glass: k_kind(GLASS, grey(12)),
    screen: k_kind(GLASS, grey(11)),
    gloss: k_kind(STEEL, grey(13)),
    cladding: k_kind(ROOFING, grey(13)),
    liner: k_kind(ROOFING, grey(13)),
    tyre: k_kind(ROOFING, grey(14)),
    rim: k_kind(STEEL, grey(3)),
    barrel: k_kind(STEEL, grey(12)),
    alloy: k_kind(STEEL, grey(6)),
    caliper: k_kind(STEEL, grey(9)),
    chrome: k_kind(STEEL, grey(2)),
    head: k_kind(LAMP, grey(0)),
    amber: k_kind(LAMP, hue(2, 4)),
    tail: k_kind(LAMP, hue(0, 4)),
    reverse: k_kind(LAMP, grey(0)),
    plate: k_kind(PLASTER, grey(1)),
    seat: k_kind(ROOFING, grey(11)),
    cushion: k_kind(ROOFING, grey(9)),
    dash: k_kind(ROOFING, grey(12)),
};

/// Exact port of `ojai-sculpt.ts:sculptOjai`.
/// Params (16 f64): `[L, H, W, per, xr, xf, wheelY, wheelR, tyreW, domeOffX, domeOffY, livBody, livRoof, livAccent, livText, livTrim]`.
/// Badge ASCII bytes live in `buf.bytes` (already trimmed & uppercased, or empty).
/// Writes sculpted cells into `buf.cells`, returns packed `w | (h<<10) | (d<<20)`.
pub fn sculpt_ojai(buf: &mut FineBuf) -> usize {
    if buf.params.len() < 16 {
        return 0;
    }
    let len = buf.params[0];
    let height = buf.params[1];
    let width = buf.params[2];
    let per = buf.params[3];
    let xr = buf.params[4];
    let xf = buf.params[5];
    let wheel_y = buf.params[6];
    let wheel_r = buf.params[7];
    let tyre_w = buf.params[8];
    let dome_x = buf.params[9];
    let dome_y = buf.params[10];
    let liv_body = buf.params[11] as u16;
    let liv_roof = buf.params[12] as u16;
    let liv_accent = buf.params[13] as u16;
    let liv_text = buf.params[14] as u16;
    let liv_trim = buf.params[15] as u16;

    let s_scale = per * 10.0;
    let w = (len * s_scale).ceil() as usize;
    let h = (height * s_scale).ceil() as usize;
    let d = (width * s_scale).ceil() as usize;
    let zc = d as f64 / (2.0 * s_scale);
    let n = w * h * d;
    let hw = (0.98f64).min(width * 0.5 - 0.08);

    const UPPER_PTS: [(f64, f64); 16] = [
        (0.0, 0.72), (0.018, 1.15), (0.042, 1.49), (0.085, 1.62),
        (0.16, 1.68), (0.36, 1.71), (0.56, 1.715), (0.655, 1.70),
        (0.69, 1.67), (0.73, 1.58), (0.84, 1.235), (0.89, 1.09),
        (0.945, 0.98), (0.975, 0.91), (0.992, 0.82), (1.0, 0.72),
    ];

    let b_plan = |x_m: f64| -> f64 {
        let s = x_m / len;
        let mut b = (hw - 0.028 + 0.026 * bump(x_m, xr, 0.46) + 0.024 * bump(x_m, xf, 0.46)).min(hw);
        if s > 0.76 { b *= 1.0 - 0.25 * ((s - 0.76) / 0.24).powf(2.05); }
        if s < 0.16 { b *= 1.0 - 0.16 * ((0.16 - s) / 0.16).powi(2); }
        b
    };
    let bottom = |x_m: f64| -> f64 {
        let s = x_m / len;
        0.23 + 0.08 * smooth(0.86, 1.0, s) + 0.10 * smooth(0.14, 0.0, s)
    };
    let belt = |x_m: f64| -> f64 {
        let s = x_m / len;
        1.095 - 0.065 * smooth(0.33, 0.22, s) - 0.015 * smooth(0.78, 0.92, s)
    };
    let front_x = |y_m: f64, u: f64| -> f64 {
        let q = clamp(u / hw, 0.0, 1.0);
        let chin = if y_m < 0.44 { 0.10 * ((0.44 - y_m) / 0.21).powi(2) } else { 0.0 };
        let brow = if y_m > 0.76 { 0.14 * ((y_m.min(1.05) - 0.76) / 0.29).powf(1.8) } else { 0.0 };
        len - 0.015 - 0.27 * q.powf(2.25) - chin - brow
    };
    let back_x = |y_m: f64, u: f64| -> f64 {
        let q = clamp(u / hw, 0.0, 1.0);
        let diff = if y_m < 0.46 { 0.09 * ((0.46 - y_m) / 0.23).powi(2) } else { 0.0 };
        let hatch = if y_m > 0.92 { 0.18 * ((y_m.min(1.70) - 0.92) / 0.78).powf(1.7) } else { 0.0 };
        0.015 + 0.18 * q.powf(2.2) + diff + hatch
    };
    let side_fn = |x_m: f64, y_m: f64| -> f64 {
        let b = b_plan(x_m);
        let yb = bottom(x_m);
        let y_belt = belt(x_m);
        let s = x_m / len;
        let y_top = (y_belt + 0.1).max(through_lin(&UPPER_PTS, s));
        let mut u = b - 0.022 * smooth(0.56, y_belt, y_m);
        let rb = 0.11;
        if y_m < yb + rb {
            let t = yb + rb - y_m;
            u -= rb - (rb * rb - t * t).max(0.0).sqrt();
        }
        if s > 0.24 && s < 0.76 && y_m > 0.34 && y_m < 0.46 {
            u -= 0.016 * (((y_m - 0.34) / 0.12) * std::f64::consts::PI).sin();
        }
        if y_m > y_belt {
            let t = clamp((y_m - y_belt) / (y_top - y_belt).max(0.25), 0.0, 1.0);
            u -= 0.155 * t.powf(1.38);
        }
        u.max(0.05)
    };
    let top_at = |x_m: f64, u: f64| -> f64 {
        let s = x_m / len;
        let y_mid = through_lin(&UPPER_PTS, s);
        let b_ref = side_fn(x_m, y_mid.min(belt(x_m) + 0.35)).max(0.18);
        let q = clamp(u / b_ref, 0.0, 1.0);
        let crown = if s > 0.78 || s < 0.10 { 0.075 } else { 0.095 };
        y_mid - crown * q.powf(2.35)
    };

    let front_intake = |y_m: f64, u: f64, b: f64| -> bool { y_m > 0.27 && y_m < 0.45 && u < b * 0.66 };
    let rear_bar = |y_m: f64, u: f64, b: f64| -> bool { y_m > 0.845 && y_m < 0.955 && u < b * 0.96 };
    let rear_plate = |y_m: f64, u: f64| -> bool { y_m > 0.44 && y_m < 0.59 && u < 0.245 };
    let rear_diffuser = |y_m: f64, u: f64, b: f64| -> bool { y_m < 0.385 && u < b * 0.86 };
    let bf = b_plan(len - 0.22);
    let bt = b_plan(0.22);
    let recess = |at_front: bool, y_m: f64, u: f64| -> f64 {
        if at_front {
            if front_intake(y_m, u, bf) { 0.048 } else { 0.0 }
        } else if rear_bar(y_m, u, bt) { 0.028 }
        else if rear_plate(y_m, u) { 0.026 }
        else if rear_diffuser(y_m, u, bt) { 0.035 }
        else { 0.0 }
    };

    // Precompute X, XZ, and XY tables to eliminate millions of redundant exp/powf/sin/hypot calls.
    let xs_m: Vec<f64> = (0..w).map(|x| (x as f64 + 0.5) / s_scale).collect();
    let bs_x: Vec<f64> = xs_m.iter().map(|&x_m| b_plan(x_m)).collect();
    let bots_x: Vec<f64> = xs_m.iter().map(|&x_m| bottom(x_m)).collect();
    let belts_x: Vec<f64> = xs_m.iter().map(|&x_m| belt(x_m)).collect();
    let y_mid_x: Vec<f64> = xs_m.iter().map(|&x_m| through_lin(&UPPER_PTS, x_m / len)).collect();
    let y_top_x: Vec<f64> = (0..w).map(|x| (belts_x[x] + 0.1).max(y_mid_x[x])).collect();
    let b_ref_x: Vec<f64> = (0..w).map(|x| side_fn(xs_m[x], y_mid_x[x].min(belts_x[x] + 0.35)).max(0.18)).collect();
    let crown_x: Vec<f64> = xs_m.iter().map(|&x_m| { let s = x_m / len; if s > 0.78 || s < 0.10 { 0.075 } else { 0.095 } }).collect();
    let us_z: Vec<f64> = (0..d).map(|z| ((z as f64 + 0.5) / s_scale - zc).abs()).collect();
    let mut top_xz = vec![0.0f64; d * w];
    for z in 0..d {
        let u = us_z[z];
        let zw = z * w;
        for x in 0..w {
            let q = clamp(u / b_ref_x[x], 0.0, 1.0);
            top_xz[zw + x] = y_mid_x[x] - crown_x[x] * q.powf(2.35);
        }
    }
    let mut side_yx = vec![0.0f64; h * w];
    for y in 0..h {
        let y_m = (y as f64 + 0.5) / s_scale;
        let yw = y * w;
        let groove_y = if y_m > 0.34 && y_m < 0.46 {
            0.016 * (((y_m - 0.34) / 0.12) * std::f64::consts::PI).sin()
        } else {
            0.0
        };
        for x in 0..w {
            let s = xs_m[x] / len;
            let b = bs_x[x];
            let yb = bots_x[x];
            let y_belt = belts_x[x];
            let mut su = b - 0.022 * smooth(0.56, y_belt, y_m);
            let rb = 0.11;
            if y_m < yb + rb {
                let t = yb + rb - y_m;
                su -= rb - (rb * rb - t * t).max(0.0).sqrt();
            }
            if groove_y != 0.0 && s > 0.24 && s < 0.76 {
                su -= groove_y;
            }
            if y_m > y_belt {
                let t = clamp((y_m - y_belt) / (y_top_x[x] - y_belt).max(0.25), 0.0, 1.0);
                su -= 0.155 * t.powf(1.38);
            }
            side_yx[yw + x] = su.max(0.05);
        }
    }

    // 1. Primary sculpted capsule solid.
    let mut solid = vec![0u8; n];
    let arch_r = wheel_r + 0.045;
    let inner = hw - tyre_w - 0.08;
    let mut arch_hit = vec![false; w];
    for y in 0..h {
        let y_m = (y as f64 + 0.5) / s_scale;
        let yw = y * w;
        for x in 0..w {
            let x_m = xs_m[x];
            arch_hit[x] = (x_m - xr).hypot(y_m - wheel_y) < arch_r || (x_m - xf).hypot(y_m - wheel_y) < arch_r;
        }
        for z in 0..d {
            let u = us_z[z];
            let f = front_x(y_m, u);
            let r0 = back_x(y_m, u);
            let rec_f = recess(true, y_m, u);
            let rec_r = recess(false, y_m, u);
            let row = (y * d + z) * w;
            let zw = z * w;
            let u_gt_inner = u > inner;
            for x in 0..w {
                let x_m = xs_m[x];
                if x_m > f || x_m < r0 { continue; }
                if y_m < bots_x[x] { continue; }
                if u_gt_inner && arch_hit[x] { continue; }
                if u > side_yx[yw + x] { continue; }
                if y_m > top_xz[zw + x] { continue; }
                if x_m > f - 0.075 && x_m > f - rec_f { continue; }
                if x_m < r0 + 0.075 && x_m < r0 + rec_r { continue; }
                solid[row + x] = 1;
            }
        }
    }

    // 2. Integrated exterior hardware.
    let mut add = |x0: f64, x1: f64, y0: f64, y1: f64, test: &dyn Fn(f64, f64, f64) -> bool| {
        let ya = (y0 * s_scale).floor().max(0.0) as usize;
        let yb = ((y1 * s_scale).ceil().max(0.0) as usize).min(h);
        let xa = (x0 * s_scale).floor().max(0.0) as usize;
        let xb = ((x1 * s_scale).ceil().max(0.0) as usize).min(w);
        for y in ya..yb {
            let y_m = (y as f64 + 0.5) / s_scale;
            for z in 0..d {
                let u = us_z[z];
                let row = (y * d + z) * w;
                for x in xa..xb {
                    if test(xs_m[x], y_m, u) {
                        solid[row + x] = 2;
                    }
                }
            }
        }
    };
    let pod_cx = len * 0.5 + dome_x / 10.0;
    add(pod_cx - 0.30, pod_cx + 0.30, 1.49, 1.82, &|x_m, y_m, u| {
        let dx = (x_m - pod_cx) / 0.29;
        let dz = u / 0.74;
        if dx.powi(4) + dz.powi(6) > 1.0 { return false; }
        let top = dome_y / 10.0 - 0.034 * dz.powi(4) - 0.018 * dx.powi(4);
        y_m >= top_at(x_m, u) - 0.025 && y_m <= top
    });
    add(0.54, 0.84, 1.56, 1.76, &|x_m, y_m, u| {
        let base = top_at(x_m, u) - 0.02;
        let dx = (x_m - 0.69) / 0.14;
        let dz = u / 0.21;
        let arch = 1.0 - dx * dx - dz * dz;
        arch > 0.0 && y_m >= base && y_m <= base + 0.075 * arch.sqrt()
    });
    let cheek_x = xf + 0.055;
    let cheek_y = 0.955;
    add(cheek_x - 0.30, cheek_x + 0.30, cheek_y - 0.12, cheek_y + 0.12, &|x_m, y_m, u| {
        let dx = (x_m - cheek_x) / 0.29;
        let dy = (y_m - cheek_y) / 0.115;
        let outline = dx.powi(4) + dy.powi(4);
        if outline > 1.0 { return false; }
        u >= side_fn(x_m, y_m) - 0.045 && u < 1.046 - 0.036 * outline
    });
    let corner_x = 0.30;
    let corner_y = 1.38;
    add(corner_x - 0.18, corner_x + 0.18, corner_y - 0.145, corner_y + 0.145, &|x_m, y_m, u| {
        let dx = (x_m - corner_x) / 0.18;
        let dy = (y_m - corner_y) / 0.145;
        let outline = dx.powi(4) + dy.powi(4);
        outline < 1.0 && u > 0.69 && u < 1.025 - 0.066 * outline
    });
    let mx = 3.15;
    let my = 1.16;
    let mu = side_fn(mx, my) + 0.072;
    let stalk_side = side_fn(mx, my - 0.04) - 0.04;
    add(mx - 0.10, mx + 0.10, my - 0.08, my + 0.07, &|x_m, y_m, u| {
        let cap = ((x_m - mx) / 0.078).powi(2) + ((y_m - my) / 0.048).powi(2) + ((u - mu) / 0.058).powi(2) <= 1.0;
        let stalk = (x_m - (mx + 0.015)).abs() < 0.025 && y_m > my - 0.068 && y_m < my - 0.005 && u > stalk_side && u < mu + 0.01;
        cap || stalk
    });

    // 3. Two-cell skin.
    outside_air_u8(&solid, w, h, d, &mut buf.out_air, &mut buf.queue);
    let mut depth = Vec::new();
    mark_two_layer_skin(&solid, &buf.out_air, w, h, d, &mut depth);

    // 4. Surface material assignment.
    let near_arch = |x_m: f64, y_m: f64, extra: f64| -> bool {
        (x_m - xr).hypot(y_m - wheel_y).min((x_m - xf).hypot(y_m - wheel_y)) < arch_r + extra
    };
    let kind_at = |x: usize, y: usize, z: usize, added: bool| -> u16 {
        let x_m = xs_m[x];
        let y_m = (y as f64 + 0.5) / s_scale;
        let u = us_z[z];
        let s = x_m / len;
        if added {
            if x_m < corner_x + 0.18 && y_m < 1.53 {
                if u > 0.98 && (x_m - corner_x + 0.06).hypot(y_m - corner_y) < 0.042 { return OJAI_K.barrel; }
                return OJAI_K.gloss;
            }
            if x_m > pod_cx - 0.31 && x_m < pod_cx + 0.31 && y_m > 1.48 {
                if x_m > pod_cx + 0.16 && (u - 0.51).abs() < 0.08 && (y_m - 1.70).abs() < 0.035 { return OJAI_K.alloy; }
                return OJAI_K.gloss;
            }
            if y_m > 1.50 { return OJAI_K.gloss; }
            if x_m > cheek_x - 0.30 {
                if u > 1.0 && ((x_m - cheek_x).abs() - 0.16).abs() < 0.050 && (y_m - cheek_y).abs() < 0.038 { return OJAI_K.alloy; }
                return OJAI_K.gloss;
            }
            if y_m > 0.96 {
                let cap = ((x_m - mx) / 0.078).powi(2) + ((y_m - my) / 0.048).powi(2) + ((u - mu) / 0.058).powi(2) <= 1.0;
                if cap && x_m > mx - 0.01 && (y_m - my).abs() < 0.020 && u > mu + 0.022 { return OJAI_K.amber; }
                return OJAI_K.gloss;
            }
            return OJAI_K.gloss;
        }
        if u > inner - 1.2 / s_scale && near_arch(x_m, y_m, 1.8 / s_scale) {
            let (_, f_up, f_out) = facing_5(&solid, w, h, d, x, y, z);
            if f_out < 0.58 && f_up < 0.35 { return OJAI_K.liner; }
        }
        if near_arch(x_m, y_m, 0.052) && y_m < 0.88 && u > side_fn(x_m, y_m) - 0.045 { return liv_trim; }
        let fx = front_x(y_m, u);
        let s_front = side_fn(x_m, y_m).max(0.25);
        let hood_y = top_at(x_m, u);
        if s > 0.865 && y_m > 0.805 && y_m > hood_y - 0.075 && u < s_front - 0.025 {
            let dx = (x_m - (4.40 - 0.13 * u)) / 0.16;
            let dz = (u - 0.53) / 0.23;
            if dx.powi(4) + dz.powi(4) <= 1.0 {
                if dz > 0.63 && dz < 0.85 && dx.abs() < 0.53 { return OJAI_K.amber; }
                if dx > 0.10 && dx < 0.56 && dz.abs() < 0.72 { return OJAI_K.head; }
                if dx > -0.48 && dx <= 0.10 && dz.abs() < 0.65 { return OJAI_K.alloy; }
                return OJAI_K.gloss;
            }
            return if y_m > belt(x_m) - 0.035 { OJAI_K.gloss } else { liv_body };
        }
        if x_m > fx - 0.105 {
            if front_intake(y_m, u, bf) {
                if u < 0.16 && y_m > 0.32 && y_m < 0.41 { return OJAI_K.gloss; }
                return OJAI_K.cladding;
            }
            if y_m < 0.32 { return liv_trim; }
        }
        let rx = back_x(y_m, u);
        if x_m < rx + 0.105 {
            let q = u / bt;
            if rear_bar(y_m, u, bt) {
                if q > 0.76 { return OJAI_K.amber; }
                if q > 0.18 && q < 0.33 && y_m < 0.88 { return OJAI_K.reverse; }
                if y_m > 0.875 && y_m < 0.928 { return OJAI_K.tail; }
                return OJAI_K.gloss;
            }
            if rear_plate(y_m, u) {
                if u > 0.22 || y_m < 0.455 || y_m > 0.575 { return OJAI_K.cladding; }
                if y_m > 0.545 && u < 0.18 { return liv_text; }
                if y_m > 0.485 && y_m < 0.525 && u < 0.16 { return OJAI_K.gloss; }
                return OJAI_K.plate;
            }
            if rear_diffuser(y_m, u, bt) { return liv_trim; }
        }
        if x_m < 0.32 && y_m > 0.85 && y_m < 0.95 && u > side_yx[y * w + x] - 0.055 && u > bt * 0.76 {
            return OJAI_K.amber;
        }
        let y_belt = belts_x[x];
        if y_m >= y_belt - 0.01 {
            let (f_ahead, f_up, _) = facing_5(&solid, w, h, d, x, y, z);
            let y_top = top_xz[z * w + x];
            let s_u = side_yx[y * w + x];
            if s > 0.675 && f_ahead > 0.16 && u < s_u - 0.035 {
                if y_m < y_belt + 0.025 || u > s_u - 0.075 { return OJAI_K.gloss; }
                return OJAI_K.screen;
            }
            if s < 0.10 && f_ahead < -0.18 && u < s_u - 0.12 {
                return if y_m > y_belt + 0.04 && y_m < 1.56 { OJAI_K.glass } else { liv_body };
            }
            if s < 0.69 && (y_m > y_top - 0.092 || f_up > 0.72) { return liv_roof; }
            if s < 0.14 + 0.025 * clamp((y_m - y_belt) / 0.6, 0.0, 1.0) { return liv_body; }
            let a_pillar = 0.90 - clamp((y_m - y_belt) / 0.60, 0.0, 1.0) * 0.21;
            if s < a_pillar - 0.028 && y_m > y_belt + 0.018 {
                if (s - 0.48).abs() < 0.005 || (s - 0.32).abs() < 0.004 { return OJAI_K.gloss; }
                return OJAI_K.glass;
            }
            return OJAI_K.gloss;
        }
        if y_m < 0.355 { return liv_trim; }
        if x_m > xr + 0.44 && x_m < xf - 0.44 && y_m >= 0.355 && y_m < 0.42 { return liv_accent; }
        if y_m > 0.875 && y_m < 0.91 && u > side_yx[y * w + x] - 0.035 && ((x_m > 2.08 && x_m < 2.24) || (x_m > 2.44 && x_m < 2.60)) {
            return OJAI_K.gloss;
        }
        liv_body
    };

    buf.cells.clear();
    buf.cells.resize(n, 0);
    let kinds = &mut buf.cells;
    for y in 0..h {
        for z in 0..d {
            let row = (y * d + z) * w;
            for x in 0..w {
                let i = row + x;
                if depth[i] == 1 {
                    kinds[i] = kind_at(x, y, z, solid[i] == 2);
                }
            }
        }
    }
    for y in 0..h {
        for z in 0..d {
            let row = (y * d + z) * w;
            for x in 0..w {
                let i = row + x;
                if depth[i] != 2 { continue; }
                let mut glass = 0u16;
                let mut first = 0u16;
                for c in -1isize..=1 {
                    let zz = z as isize + c;
                    if zz < 0 || zz >= d as isize { continue; }
                    for b in -1isize..=1 {
                        let yy = y as isize + b;
                        if yy < 0 || yy >= h as isize { continue; }
                        let base = (yy as usize * d + zz as usize) * w;
                        for a in -1isize..=1 {
                            let xx = x as isize + a;
                            if xx < 0 || xx >= w as isize { continue; }
                            let j = base + xx as usize;
                            if depth[j] != 1 { continue; }
                            if (kinds[j] & 15) == GLASS {
                                glass = kinds[j];
                            } else if first == 0 || a.abs() + b.abs() + c.abs() == 1 {
                                first = kinds[j];
                            }
                        }
                    }
                }
                kinds[i] = if glass == OJAI_K.glass && xs_m[x] < 2.99 {
                    OJAI_K.dash
                } else if glass != 0 {
                    glass
                } else if first != 0 {
                    first
                } else {
                    kind_at(x, y, z, solid[i] == 2)
                };
            }
        }
    }

    // Corner notch fill.
    let wd = w * d;
    for y in 1..h - 1 {
        for z in 1..d - 1 {
            let row = (y * d + z) * w;
            for x in 1..w - 1 {
                let i = row + x;
                if kinds[i] != 0 { continue; }
                let pairs = ((kinds[i - 1] != 0 && kinds[i + 1] != 0) as u8)
                    + ((kinds[i - w] != 0 && kinds[i + w] != 0) as u8)
                    + ((kinds[i - wd] != 0 && kinds[i + wd] != 0) as u8);
                if pairs >= 2 {
                    kinds[i] = most_around(kinds, w, h, d, i, |kk| kk == liv_body || kk == liv_roof);
                }
            }
        }
    }

    // 5. Conformal door badge lettering.
    if !buf.bytes.is_empty() {
        let chars: Vec<u8> = buf.bytes.iter().map(|b| b.to_ascii_uppercase()).collect();
        let total_cols = chars.len() * 6 - 1;
        let avail_x = (1.56 * s_scale).floor() as usize;
        let pitch_x = (avail_x / total_cols.max(1)).clamp(1, 2) as isize;
        let pitch_y = pitch_x;
        let start_xi = js_round(2.34 * s_scale - (total_cols as isize * pitch_x) as f64 * 0.5) as isize;
        let top_yi = js_round(0.66 * s_scale + (7 * pitch_y) as f64 * 0.5) as isize;
        for left_side in [true, false] {
            for (ci, &ch) in chars.iter().enumerate() {
                let glyph = glyph_5x7(ch);
                for r in 0..7usize {
                    let bits = glyph[r];
                    for col in 0..5usize {
                        if (bits >> (4 - col)) & 1 == 0 { continue; }
                        let lc = if left_side { (chars.len() - 1 - ci) * 6 + (4 - col) } else { ci * 6 + col } as isize;
                        let x0 = start_xi + lc * pitch_x;
                        let x1 = x0 + pitch_x;
                        let y0 = top_yi - (r as isize + 1) * pitch_y;
                        let y1 = y0 + pitch_y;
                        for yi in y0.max(0)..y1.min(h as isize) {
                            for xi in x0.max(0)..x1.min(w as isize) {
                                if left_side {
                                    for zi in 0..(d / 2) {
                                        let idx = xi as usize + w * (zi + d * yi as usize);
                                        if kinds[idx] == 0 { continue; }
                                        if kinds[idx] == liv_body { kinds[idx] = liv_text; }
                                        break;
                                    }
                                } else {
                                    for zi in ((d / 2)..d).rev() {
                                        let idx = xi as usize + w * (zi + d * yi as usize);
                                        if kinds[idx] == 0 { continue; }
                                        if kinds[idx] == liv_body { kinds[idx] = liv_text; }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 6. 19-inch EV aero turbine wheels.
    for xm in [xr, xf] {
        for left in [true, false] {
            let z0 = if left { zc - (hw - 0.004) } else { zc + (hw - 0.004) - tyre_w };
            let z1 = z0 + tyre_w;
            let ya = ((wheel_y - wheel_r) * s_scale).floor() as isize;
            let yb = ((wheel_y + wheel_r) * s_scale).ceil() as isize;
            let za = (z0 * s_scale).floor() as isize;
            let zb = (z1 * s_scale).ceil() as isize;
            let xa = ((xm - wheel_r) * s_scale).floor() as isize;
            let xb = ((xm + wheel_r) * s_scale).ceil() as isize;
            for y in ya.max(0)..=yb.min(h as isize - 1) {
                let y_m = (y as f64 + 0.5) / s_scale;
                for z in za.max(0)..zb.min(d as isize) {
                    let z_m = (z as f64 + 0.5) / s_scale;
                    let out = if left { z_m - z0 } else { z1 - z_m };
                    let shoulder = out.min(tyre_w - out);
                    let r_lim = (wheel_r - 0.032 + (0.032f64).min(shoulder * 0.65)).min(wheel_r);
                    let row = (y as usize * d + z as usize) * w;
                    for x in xa.max(0)..=xb.min(w as isize - 1) {
                        let x_m = (x as f64 + 0.5) / s_scale;
                        let r = (x_m - xm).hypot(y_m - wheel_y);
                        if r > r_lim { continue; }
                        let a = (y_m - wheel_y).atan2(x_m - xm);
                        let kind = if r > wheel_r * 0.70 {
                            OJAI_K.tyre
                        } else if out < 0.028 {
                            let blade = (5.0 * a + r * 3.0).cos() > 0.35;
                            if r > wheel_r * 0.62 { OJAI_K.rim }
                            else if r < wheel_r * 0.16 { if r < wheel_r * 0.08 { OJAI_K.chrome } else { OJAI_K.barrel } }
                            else if blade { OJAI_K.rim }
                            else { 0 }
                        } else if out < 0.065 {
                            let toward = if xm < len * 0.5 { a.cos() > 0.55 } else { a.cos() < -0.55 };
                            if r > wheel_r * 0.30 && r < wheel_r * 0.56 && toward && a.sin() > -0.2 { OJAI_K.caliper }
                            else if r < wheel_r * 0.56 { OJAI_K.alloy }
                            else { OJAI_K.barrel }
                        } else {
                            OJAI_K.barrel
                        };
                        kinds[row + x as usize] = kind;
                    }
                }
            }
        }
    }

    // 7. Interior lounge.
    let outside = &buf.out_air;
    let mut fill = |x0: f64, x1: f64, y0: f64, y1: f64, test: &dyn Fn(f64, f64, f64, f64) -> u16| {
        let ya = (y0 * s_scale).floor().max(0.0) as usize;
        let yb = ((y1 * s_scale).ceil().max(0.0) as usize).min(h);
        let xa = (x0 * s_scale).floor().max(0.0) as usize;
        let xb = ((x1 * s_scale).ceil().max(0.0) as usize).min(w);
        for y in ya..yb {
            let y_m = (y as f64 + 0.5) / s_scale;
            for z in 0..d {
                let z_m = (z as f64 + 0.5) / s_scale;
                let zs = z_m - zc;
                let u = zs.abs();
                let row = (y * d + z) * w;
                for x in xa..xb {
                    let i = row + x;
                    if kinds[i] != 0 || outside[i] != 0 { continue; }
                    let kk = test(xs_m[x], y_m, u, zs);
                    if kk != 0 { kinds[i] = kk; }
                }
            }
        }
    };
    fill(0.95, 3.65, 0.34, 0.40, &|_, _, _, _| OJAI_K.dash);
    for sz_s in [-0.42, 0.42] {
        fill(2.40, 3.12, 0.40, 1.24, &|x_m, y_m, _, zs| {
            let q = (zs - sz_s).abs();
            if q > 0.27 { return 0; }
            if x_m > 2.55 && x_m < 3.08 && y_m < 0.60 {
                return if q > 0.18 { OJAI_K.seat } else { OJAI_K.cushion };
            }
            let lean = 2.55 - (y_m - 0.58) * 0.24;
            if y_m >= 0.52 && y_m < 1.12 && x_m > lean - 0.04 && x_m < lean + 0.13 {
                return if q > 0.19 { OJAI_K.seat } else { OJAI_K.cushion };
            }
            if y_m >= 1.10 && y_m < 1.24 && q < 0.13 && x_m > lean - 0.03 && x_m < lean + 0.10 {
                return OJAI_K.seat;
            }
            0
        });
    }
    fill(1.05, 1.80, 0.40, 1.26, &|x_m, y_m, u, _| {
        if u > 0.72 { return 0; }
        if x_m > 1.24 && x_m < 1.78 && y_m < 0.60 { return OJAI_K.cushion; }
        let lean = 1.24 - (y_m - 0.58) * 0.22;
        if y_m >= 0.52 && y_m < 1.24 && x_m > lean - 0.04 && x_m < lean + 0.14 { return OJAI_K.seat; }
        0
    });
    fill(3.32, 3.96, 0.77, 0.97, &|x_m, y_m, u, _| {
        let top = 0.86 + 0.10 * smooth(3.32, 3.96, x_m) - 0.035 * (u / 0.8).powi(2);
        if u < 0.80 && y_m < top && y_m > top - 0.055 { OJAI_K.dash } else { 0 }
    });
    fill(3.29, 3.36, 0.84, 0.975, &|x_m, y_m, u, _| {
        if u > 0.15 { return 0; }
        if x_m < 3.32 && u < 0.12 && y_m > 0.865 && y_m < 0.948 { OJAI_K.alloy } else { OJAI_K.gloss }
    });

    seal_leaks_impl(
        &mut buf.cells,
        w,
        h,
        d,
        |kk| kk == liv_body || kk == liv_roof,
        &mut buf.out_air,
        &mut buf.queue,
    );
    buf.out_size = [w, h, d];
    w | (h << 10) | (d << 20)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rle_roundtrip_and_invalid_rejected() {
        let mut buf = FineBuf::new();
        let src: Vec<Kind> = (0..4096).map(|i| if i % 17 < 5 { 0 } else if i % 3 == 0 { 0x050c } else { 0x020b }).collect();
        encode_runs(&src, &mut buf.palette, &mut buf.raw_bytes, &mut buf.bytes);
        let filled = unrun_b64(&mut buf, src.len());
        assert_eq!(filled as usize, src.iter().filter(|&&k| k != 0).count());
        assert_eq!(buf.cells, src);
        // Wrong length fails.
        assert_eq!(unrun_b64(&mut buf, src.len() + 1), -1);
        // Corrupt base64 fails.
        buf.bytes = b"!!!".to_vec();
        assert_eq!(unrun_b64(&mut buf, 10), -1);
    }

    #[test]
    fn box_smooth_merges_and_hollow_dome_cabin_stays_square() {
        let mut buf = FineBuf::new();
        let (w, h, d) = (40, 20, 40);
        buf.cells = vec![0; w * h * d];
        for y in 4..16 {
            for z in 4..36 {
                for x in 4..36 {
                    buf.cells[(y * d + z) * w + x] = 12;
                }
            }
        }
        let plain = faces_square(&mut buf, w, h, d);
        let smooth_n = faces_with_smooth(&mut buf, w, h, d, 5);
        assert_eq!(plain, 112);
        assert_eq!(buf.faces.len(), smooth_n * 2);
        assert_eq!(buf.smooth.len(), smooth_n * 4);
        let mut mid_len = 0;
        for f in 0..smooth_n {
            let a = buf.faces[f * 2];
            let b = buf.faces[f * 2 + 1];
            if ((b >> 8) & 3) == 1 && ((b >> 10) & 1) == 1 && ((a >> 20) & 1023) == 20 && (a & 1023) <= 10 && (a & 1023) + (b & 255) >= 30 {
                mid_len = b & 255;
            }
        }
        assert!(mid_len >= 20, "middle flat row merged to {mid_len}");
    }

    #[test]
    fn sculpt_coupe_coarser_and_smooth_end_to_end() {
        let mut buf = FineBuf::new();
        buf.params = vec![4.5, 1.28, 1.92, 4.0, 0.95, 3.55, 0.34, 0.34, 0.25, 1.95, 0.98, 0.55, (12 | (16 << 8) | 128) as f64];
        let packed = sculpt_coupe(&mut buf);
        let (w, h, d) = (packed & 1023, (packed >> 10) & 1023, (packed >> 20) & 1023);
        assert_eq!((w, h, d), (180, 52, 77));
        let nf = faces_with_smooth(&mut buf, w, h, d, 5);
        assert!(nf > 30_000, "coupe faces: {nf}");
        let cpacked = coarser(&mut buf, w, h, d, 4);
        assert_eq!((cpacked & 1023, (cpacked >> 10) & 1023, (cpacked >> 20) & 1023), (45, 13, 20));
    }
}
