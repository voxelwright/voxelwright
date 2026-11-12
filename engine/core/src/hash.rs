//! Numbers that are the same on every machine: whole-number hashes, and smooth noise built on
//! them with nothing but adds and multiplies (no sine, whose last digit differs between machines).

#[inline]
pub fn hash(x: i32, z: i32, seed: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(73856093) ^ (z as u32).wrapping_mul(83492791) ^ seed.wrapping_mul(2654435761);
    h = (h ^ (h >> 15)).wrapping_mul(0x2c1b3c6d);
    h = (h ^ (h >> 12)).wrapping_mul(0x297a2d39);
    h ^ (h >> 15)
}

#[inline]
pub fn hash3(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    hash(x ^ y.wrapping_mul(19349663), z, seed ^ (y as u32).rotate_left(13))
}

/// 0 up to but not 1.
#[inline]
pub fn unit(x: i32, z: i32, seed: u32) -> f32 {
    (hash(x, z, seed) >> 8) as f32 / 16777216.0
}

/// A whole number from `lo` up to but not `hi`.
#[inline]
pub fn pick(x: i32, z: i32, seed: u32, lo: i32, hi: i32) -> i32 {
    lo + (hash(x, z, seed) % (hi - lo).max(1) as u32) as i32
}

/// Smooth noise from 0 to 1 whose lumps are `period` cells across.
pub fn noise(x: i32, z: i32, period: i32, seed: u32) -> f32 {
    let (cx, cz) = (x.div_euclid(period), z.div_euclid(period));
    let (fx, fz) = (x.rem_euclid(period) as f32 / period as f32, z.rem_euclid(period) as f32 / period as f32);
    let (ux, uz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let a = unit(cx, cz, seed);
    let b = unit(cx + 1, cz, seed);
    let c = unit(cx, cz + 1, seed);
    let d = unit(cx + 1, cz + 1, seed);
    let top = a + (b - a) * ux;
    let bottom = c + (d - c) * ux;
    top + (bottom - top) * uz
}
