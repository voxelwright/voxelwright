//! The land the town stands in. Within 3 km of where the page starts it is the town's own rolling
//! ground, and nothing here moves a cell of it (city.rs holds a sum of it). Beyond, the town
//! gives way to open country: a range of mountains to the north, a dry plain to the east with
//! the road out of town running across it, and between them the same rolling ground under grass.

use crate::hash::noise;

/// Where the page starts, in the street by the yard: the middle of the town.
pub const HOME: (i32, i32) = (700, 4070);
/// Out to here the land is the town's own; by `EDGE` it is open country.
const TOWN: f32 = 30_000.0;
const EDGE: f32 = 40_000.0;

fn ease(lo: f32, hi: f32, v: f32) -> f32 {
    let t = ((v - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How far a place is out of the town: 0 in it, 1 in open country.
pub fn open(x: i32, z: i32) -> f32 {
    let (dx, dz) = ((x - HOME.0) as f32, (z - HOME.1) as f32);
    // Most asking is from inside the town: a square that lies within its circle says so at once.
    if dx.abs() < 21_000.0 && dz.abs() < 21_000.0 {
        return 0.0;
    }
    ease(TOWN, EDGE, (dx * dx + dz * dz).sqrt())
}

/// How far a place is into the mountains: they rise north of the town (towards -z), from 4.5 km out.
pub fn peaks(x: i32, z: i32) -> f32 {
    open(x, z) * ease(45_000.0, 85_000.0, (HOME.1 - z) as f32)
}

/// How far a place is into the dry plain: east of the town (towards +x), short of the mountains.
pub fn dry(x: i32, z: i32) -> f32 {
    open(x, z) * ease(38_000.0, 60_000.0, (x - HOME.0) as f32) * (1.0 - ease(25_000.0, 50_000.0, (HOME.1 - z) as f32))
}

/// How far a place is from the middle of the road out of town, which runs east from the start along its street.
pub fn off_road(x: i32, z: i32) -> Option<i32> {
    (x > HOME.0).then(|| (z - HOME.1).abs())
}

/// How high the mountains stand at a place, 0 to 1. Ridges of several sizes, each highest along the lines where its
/// noise crosses the middle, and each asked across the land at its own slant: asked all one way they ran along the
/// noise's own squares, north to south and east to west, a maze seen from over it. The finer ridges stand on the
/// flanks of the bigger and die out in the valleys between, and the valleys between whole massifs are wide.
fn high(x: i32, z: i32) -> f32 {
    let turned = |c: i64, s: i64| (((x as i64 * c - z as i64 * s) / 16) as i32, ((x as i64 * s + z as i64 * c) / 16) as i32);
    let ridge = |(u, v): (i32, i32), period: i32, seed: u32| {
        let r = 1.0 - (noise(u, v, period, seed) * 2.0 - 1.0).abs();
        r * r
    };
    let (a, b, c, d) = (turned(14, 8), turned(7, -14), turned(16, 3), turned(-9, 13));
    // Where one range's line bends: the big ridges are asked a little aside by a slow noise.
    let bend = ((noise(x, z, 30_000, 39) - 0.5) * 16_000.0) as i32;
    // The massif north of the town stands whole whatever the slow noise says; further off there are wide valleys.
    let (nx, nz) = ((x - HOME.0) as f32, (z - HOME.1 + 105_000) as f32);
    let home = 1.0 - ease(45_000.0, 110_000.0, (nx * nx + nz * nz).sqrt());
    let mass = 0.3 + 0.7 * ease(0.3, 0.62, noise(a.0, a.1, 95_000, 38)).max(home);
    let first = ridge((a.0 + bend, a.1 - bend), 46_000, 31);
    let second = ridge((b.0 - bend / 2, b.1), 19_000, 32);
    let third = ridge(c, 7200, 33);
    let fourth = ridge(d, 2600, 34);
    let body = first * 0.62 + second * 0.38 * (0.35 + 0.65 * first);
    mass * (body * 0.86 + (third * 0.1 + fourth * 0.04) * (0.25 + body * 1.5).min(1.0))
}

/// How far a place is out to sea, in cells: the coast lies some 6 km west of the town and wanders into coves and
/// out round pointed headlands. Over 0 is sea, under it land; `None` well inland, where nobody need ask.
pub fn offshore(x: i32, z: i32) -> Option<f32> {
    let west = (HOME.0 - x) as f32;
    if west < 43_000.0 {
        return None;
    }
    let cape = 1.0 - (noise(x, z, 7300, 52) * 2.0 - 1.0).abs();
    Some(west - 66_000.0 + (noise(x, z, 23_000, 51) - 0.5) * 20_000.0 + (0.5 - cape) * 10_000.0 + (noise(x, z, 1500, 53) - 0.5) * 1800.0)
}

/// How high the ground is at a column: its top cell.
pub fn ground(x: i32, z: i32) -> i32 {
    let town = noise(x, z, 9000, 11) * 1200.0 + noise(x, z, 2600, 12) * 300.0 + noise(x, z, 700, 13) * 50.0 - 560.0;
    if open(x, z) == 0.0 {
        return town.floor() as i32;
    }
    let (p, d) = (peaks(x, z), dry(x, z));
    let mut h = town;
    if d > 0.0 {
        // The plain lies in long low swells, well clear of the sea, with dry washes cut a little into it. Off the
        // road stand tables of rock: a skirt of fallen stone, a wall, a level top, and on some a second, smaller one.
        let away = ease(1_500.0, 9_000.0, (z - HOME.1).abs() as f32);
        let table = noise(x, z, 6400, 37) * 0.75 + noise(x, z, 17_000, 70) * 0.25 + (noise(x, z, 1300, 61) - 0.5) * 0.04 + (noise(x, z, 240, 62) - 0.5) * 0.01 - (1.0 - away) * 0.3;
        let wash = 1.0 - (noise(x, z, 3900, 63) * 2.0 - 1.0).abs();
        let plain = 420.0 + noise(x, z, 7000, 35) * 200.0 * (0.3 + 0.7 * away) + noise(x, z, 1100, 36) * 40.0 - ease(0.86, 0.97, wash) * 26.0 * away
            + ease(0.5, 0.6, table) * 220.0 + ease(0.6, 0.612, table) * 800.0 + ease(0.67, 0.68, table) * 600.0;
        h += (plain - h) * d;
    }
    if p > 0.0 {
        h += p * high(x, z) * 36_000.0;
    }
    if let Some(s) = offshore(x, z) {
        let o = open(x, z);
        if s > -7000.0 && o > 0.0 {
            // Hills stand along the coast and end in cliffs where they are high, in a beach where they are low.
            let hills = noise(x, z, 8200, 54);
            h += o * ease(-7000.0, -500.0, s) * (ease(0.3, 0.75, hills) * 1300.0 + noise(x, z, 2100, 55) * 260.0);
            if s > -500.0 {
                // The sea's floor: a shelf of sand with reefs standing off it in mounds, then down into the deep.
                let shelf = ease(100.0, 700.0, s);
                let reef = ease(0.5, 0.8, noise(x, z, 900, 56));
                let mut bed = -45.0 - ease(0.0, 2600.0, s) * 150.0 - ease(2600.0, 40_000.0, s) * 900.0 + (reef * (25.0 + noise(x, z, 230, 57) * 70.0) + noise(x, z, 60, 58) * 8.0) * shelf;
                // Stacks of rock stand out of the water off the headlands.
                let stack = noise(x, z, 310, 59);
                if stack > 0.8 && s < 5000.0 {
                    bed += ease(0.8, 0.9, stack) * (260.0 + noise(x, z, 2900, 60) * 300.0) * shelf * (1.0 - ease(2500.0, 5000.0, s));
                }
                h += (bed - h) * o * ease(-500.0, 60.0, s);
            }
        }
    }
    h.floor() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A picture of the land from over it, for looking at: `LAND_MAP=file.ppm cargo test --release land_map -- --ignored`
    /// (`LAND_AT=x,z,span` in cells; a pixel is span / 800).
    #[test]
    #[ignore]
    fn land_map() {
        let at: Vec<i32> = std::env::var("LAND_AT").unwrap_or("-40000,4070,120000".into()).split(',').map(|v| v.parse().unwrap()).collect();
        let (n, step) = (800, at[2] / 800);
        let mut out = format!("P6 {n} {n} 255\n").into_bytes();
        for j in 0..n {
            for i in 0..n {
                let (x, z) = (at[0] + (i - n / 2) * step, at[1] + (j - n / 2) * step);
                let (g, e) = (ground(x, z), ground(x + step, z + step));
                let shade = (1.0 + (g - e) as f32 / step as f32 * 0.6).clamp(0.4, 1.6);
                let c = if g < 0 { [20.0, (110 + g / 4).max(40) as f32, (160 + g / 4).max(70) as f32] } else if g < 4600 { [90.0 + g as f32 / 40.0, 140.0, 70.0] } else { let v = 120.0 + (g as f32 / 36_000.0) * 135.0; [v, v, v + 10.0] };
                let s = if g < 0 { 1.0 } else { shade };
                out.extend(c.map(|v| (v * s).clamp(0.0, 255.0) as u8));
            }
        }
        std::fs::write(std::env::var("LAND_MAP").unwrap(), out).unwrap();
    }
}
