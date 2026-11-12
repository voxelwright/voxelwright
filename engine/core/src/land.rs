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

/// How high the ground is at a column: its top cell.
pub fn ground(x: i32, z: i32) -> i32 {
    let town = noise(x, z, 9000, 11) * 1200.0 + noise(x, z, 2600, 12) * 300.0 + noise(x, z, 700, 13) * 50.0 - 560.0;
    if open(x, z) == 0.0 {
        return town.floor() as i32;
    }
    let (p, d) = (peaks(x, z), dry(x, z));
    let mut h = town;
    if d > 0.0 {
        // The plain lies level, well clear of the sea, with flat-topped hills standing off the road.
        let away = ease(3_000.0, 14_000.0, (z - HOME.1).abs() as f32);
        let table = noise(x, z, 11_000, 37);
        let plain = 420.0 + noise(x, z, 7000, 35) * 200.0 * (0.3 + 0.7 * away) + noise(x, z, 1100, 36) * 30.0 + (ease(0.64, 0.67, table) * 620.0 + ease(0.78, 0.8, table) * 380.0) * away;
        h += (plain - h) * d;
    }
    if p > 0.0 {
        // Ridges: each size of them highest along the lines where its noise crosses the middle.
        let ridge = |period: i32, seed: u32| 1.0 - (noise(x, z, period, seed) * 2.0 - 1.0).abs();
        let high = ridge(42_000, 31) * 0.55 + ridge(17_000, 32) * 0.28 + ridge(6400, 33) * 0.12 + ridge(2300, 34) * 0.05;
        h += p * high * high * 36_000.0;
    }
    h.floor() as i32
}
