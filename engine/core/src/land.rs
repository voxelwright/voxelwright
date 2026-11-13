//! The land the town stands in. Within 3 km of where the page starts it is the town's own rolling
//! ground, and nothing here moves a cell of it (city.rs holds a sum of it). Beyond, the town
//! gives way to open country: a range of mountains to the north, a dry plain to the east with
//! the road out of town running across it, and between them the same rolling ground under grass.

use crate::hash::{noise, unit};

/// Where the page starts, in the street by the yard: the middle of the town.
pub const HOME: (i32, i32) = (700, 4070);
/// Out to here the land is the town's own; by `EDGE` it is open country.
const TOWN: f32 = 30_000.0;
const EDGE: f32 = 40_000.0;

pub fn ease(lo: f32, hi: f32, v: f32) -> f32 {
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

/// How much of the ground at a place is the planet's and not the town's country: none within some 22 km of the
/// start, all of it from some 60 km, along a line that wanders (from high up a ring round the town showed). Seen from space the land is the planet's (page/space.ts `land`), and far from the town the
/// cells must be the same land, so that coming down finds what was seen: sea where there was sea, mountains where
/// there were ranges.
pub fn far(x: i32, z: i32) -> f32 {
    let (dx, dz) = ((x - HOME.0) as f32, (z - HOME.1) as f32);
    if dx.abs() < 120_000.0 && dz.abs() < 120_000.0 {
        return 0.0;
    }
    ease(220_000.0, 600_000.0, (dx * dx + dz * dz).sqrt() + (noise(x, z, 150_000, 76) - 0.5) * 100_000.0)
}

/// The planet's own noise, as its pass asks it (space.ts `noise`, `folds`, `wisps`): places in km east and south of
/// the start, lumps `period` km across. The same numbers must come out there and here.
fn noise_km(p: (f32, f32), period: f32, seed: u32) -> f32 {
    let (qx, qz) = (p.0 / period, p.1 / period);
    let (cx, cz) = (qx.floor(), qz.floor());
    let (fx, fz) = (qx - cx, qz - cz);
    let (ux, uz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let (cx, cz) = (cx as i32, cz as i32);
    let top = unit(cx, cz, seed) + (unit(cx + 1, cz, seed) - unit(cx, cz, seed)) * ux;
    let bottom = unit(cx, cz + 1, seed) + (unit(cx + 1, cz + 1, seed) - unit(cx, cz + 1, seed)) * ux;
    top + (bottom - top) * uz
}
fn folds(p: (f32, f32), period: f32, seed: u32) -> f32 {
    noise_km(p, period, seed) * 0.5 + noise_km(p, period / 2.3, seed + 1) * 0.27 + noise_km(p, period / 5.1, seed + 2) * 0.15 + noise_km(p, period / 11.0, seed + 3) * 0.08
}
fn wisps(p: (f32, f32), period: f32, seed: u32) -> f32 {
    let (mut q, mut size, mut sum, mut weight) = (p, period, 0.0, 0.5);
    for k in 0..5u32 {
        sum += noise_km((q.0 + k as f32 * 37.0, q.1 + k as f32 * 91.0), size, seed + k) * weight;
        q = (q.0 * 0.8 - q.1 * 0.6, q.0 * 0.6 + q.1 * 0.8);
        size *= 0.47;
        weight *= 0.5;
    }
    sum / 0.97
}
fn km(x: i32, z: i32) -> (f32, f32) {
    ((x - HOME.0) as f32 / 10_000.0, (z - HOME.1) as f32 / 10_000.0)
}

/// The planet's land and sea at a place: over 0 is land, under it sea (space.ts `land`, its `c`).
pub fn continent(x: i32, z: i32) -> f32 {
    let p = km(x, z);
    let far = (p.0 * p.0 + p.1 * p.1).sqrt();
    let out = ease(40.0, 160.0, far);
    let mut west = -p.0 + ((noise_km(p, 90.0, 62) - 0.5) * 120.0 + (wisps(p, 380.0, 98) - 0.5) * 520.0) * out;
    // That coast in detail, coves and points down to a kilometre or two, asked only where it can matter.
    if (west - 25.0).abs() < 50.0 {
        west += (wisps(p, 40.0, 93) - 0.5) * 56.0 * out;
    }
    let c0 = folds(p, 5200.0, 61) - 0.5 + 0.2 * (-far * far / (1100.0 * 1100.0)).exp() - 0.7 * ease(5.0, 45.0, west) * (-far * far / (1500.0 * 1500.0)).exp();
    let mut c = c0 + ((wisps(p, 420.0, 91) - 0.5) * 0.1 + (wisps(p, 60.0, 92) - 0.5) * 0.024) * out;
    // Close to a shore, inlets and islets a kilometre or two across.
    if c.abs() < 0.03 {
        c += (wisps(p, 14.0, 94) - 0.5) * 0.008 * out * (1.0 - ease(0.012, 0.03, c.abs()));
    }
    c
}

/// Where the planet has its ranges of mountains, 0 to 1 (space.ts `land`, its `range`, before the coast cuts it).
fn ranges(x: i32, z: i32) -> f32 {
    let p = km(x, z);
    // One range runs off north from the town's own massif, so that from high up the massif is the near end of
    // something and not a patch with an edge.
    let north = 1.0 - ease(0.6, 1.2, ((p.0 - 15.0) * (p.0 - 15.0) + (p.1 + 140.0) * (p.1 + 140.0)).sqrt() / (150.0 * (0.6 + 0.55 * noise_km(p, 120.0, 65) + 0.3 * noise_km(p, 31.0, 67))));
    ease(0.5, 0.66, folds(p, 1700.0, 64) + 0.8 * north)
}

/// How cold the planet is at a place, 0 to 1: by how far it is from the planet's middle line (space.ts `cold`).
/// The page starts 0.66 of a radian north of that line.
pub fn cold(z: i32) -> f32 {
    ease(0.95, 1.25, (0.66 - km(0, z).1 / 6371.0).abs())
}

/// How dry the planet's land is at a place, 0 to 1 (space.ts `land`, its `dry`): its deserts, one of which begins
/// east of the town where the town's own dry plain ends.
pub fn arid(x: i32, z: i32) -> f32 {
    let p = km(x, z);
    let east = 1.0 - ease(0.6, 1.2, ((p.0 - 130.0) * (p.0 - 130.0) + (p.1 - 40.0) * (p.1 - 40.0)).sqrt() / (150.0 * (0.6 + 0.55 * noise_km(p, 120.0, 66) + 0.3 * noise_km(p, 31.0, 68))));
    ease(0.5, 0.64, folds((p.0 + 900.0, p.1), 3100.0, 71) + 0.8 * east) * (1.0 - cold(z))
}

/// Whether the planet's dry land at a place is red earth (or pale sand): in countries a few hundred km across, and
/// red round the town, whose own plain is.
pub fn red(x: i32, z: i32) -> bool {
    let p = km(x, z);
    noise_km(p, 420.0, 77) + 0.4 * (-(p.0 * p.0 + p.1 * p.1) / (600.0 * 600.0)).exp() > 0.5
}

/// The planet's rivers (space.ts `land`, its `wind` and `broad`): how far a place is from the middle of one, in the
/// noise's own measure (a thousandth is about a kilometre), and how far the water reaches from that middle.
pub fn river(x: i32, z: i32) -> (f32, f32) {
    let p = km(x, z);
    let (a, b) = (noise_km(p, 90.0, 96), noise_km(p, 90.0, 97));
    ((wisps((p.0 + a * 40.0, p.1 + b * 40.0), 330.0, 95) - 0.5).abs(), 0.0004 + 0.0012 * a)
}

/// How much of a far land's height is left at a place by a river: none in its water, all of it from some six
/// kilometres off. Every river runs in a broad valley down to the sea's level, so that its water is the sea's.
pub fn valley(x: i32, z: i32) -> f32 {
    let (wind, broad) = river(x, z);
    ease(broad, broad + 0.012, wind)
}

/// How far a place is into the mountains: they rise north of the town (towards -z), from 4.5 km out; far from the
/// town they are where the planet has its ranges.
pub fn peaks(x: i32, z: i32) -> f32 {
    let w = far(x, z);
    let near = if w < 1.0 { open(x, z) * ease(45_000.0, 85_000.0, (HOME.1 - z) as f32) * (1.0 - w) } else { 0.0 };
    if w > 0.0 { near + ranges(x, z) * w } else { near }
}

/// How far a place is into the dry plain: east of the town (towards +x), short of the mountains, and not for ever.
pub fn dry(x: i32, z: i32) -> f32 {
    open(x, z) * ease(38_000.0, 60_000.0, (x - HOME.0) as f32) * (1.0 - ease(25_000.0, 50_000.0, (HOME.1 - z) as f32)) * (1.0 - far(x, z))
}

/// The refuge below the pass, in a high valley of the massif north of the town under a wall of rock: its yard's
/// middle and how high it lies. The ground is levelled for it, as a builder would, and eases back into the valley
/// round it.
pub const REFUGE: (i32, i32, i32) = (47_300, -126_620, 7220);

/// The marked way from the refuge up the valley to the pass: how far along it a place is and how far to its right,
/// in cells; `None` away from it. It wanders as a trodden way does. It runs a little east of north (5 east for
/// every 12 north).
pub fn way(x: i32, z: i32) -> Option<(i32, i32)> {
    let (dx, dz) = (x - REFUGE.0, z - REFUGE.1);
    if dx < -900 || dx > 3400 || dz > 500 || dz < -6200 {
        return None;
    }
    let (along, aside) = ((dx * 5 - dz * 12) / 13, (dx * 12 + dz * 5) / 13);
    (along > 150 && along < 6000).then(|| (along, aside - ((noise(along, 0, 1100, 77) - 0.5) * 700.0 + (noise(along, 0, 320, 78) - 0.5) * 120.0) as i32 * (along - 150).min(600) / 600))
}

/// Where a place `along` the way and `aside` to its right is.
pub fn on_way(along: i32, aside: i32) -> (i32, i32) {
    (REFUGE.0 + (along * 5 + aside * 12) / 13, REFUGE.1 + (-along * 12 + aside * 5) / 13)
}

/// How far a place is from the middle of the road out of town, which runs east from the start along its street.
pub fn off_road(x: i32, z: i32) -> Option<i32> {
    (x > HOME.0).then(|| (z - HOME.1).abs())
}

/// `noise` for places too big for its whole numbers: the mountains ask theirs sixteen times finer than a cell.
fn fine(x: i64, z: i64, period: i64, seed: u32) -> f32 {
    let (cx, cz) = (x.div_euclid(period) as i32, z.div_euclid(period) as i32);
    let (fx, fz) = (x.rem_euclid(period) as f32 / period as f32, z.rem_euclid(period) as f32 / period as f32);
    let (ux, uz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let top = unit(cx, cz, seed) + (unit(cx + 1, cz, seed) - unit(cx, cz, seed)) * ux;
    let bottom = unit(cx, cz + 1, seed) + (unit(cx + 1, cz + 1, seed) - unit(cx, cz + 1, seed)) * ux;
    top + (bottom - top) * uz
}

/// How high the mountains stand at a place, 0 to 1. Ridges of several sizes, each highest along the lines where its
/// noise crosses the middle, and each asked across the land at its own slant: asked all one way they ran along the
/// noise's own squares, north to south and east to west, a maze seen from over it. The finer ridges stand on the
/// flanks of the bigger and die out in the valleys between, and the valleys between whole massifs are wide.
fn high(x: i32, z: i32) -> f32 {
    // Turned places are kept sixteen times finer than a cell (and the sizes asked are sixteen times as big): rounded
    // to whole cells a turned place stood still or jumped two from one column to the next, and on a steep face the
    // ground did too, a stubble of single cells standing out of every slope.
    let turned = |c: i64, s: i64| (x as i64 * c - z as i64 * s, x as i64 * s + z as i64 * c);
    let ridge = |(u, v): (i64, i64), period: i64, seed: u32| {
        let r = 1.0 - (fine(u, v, period * 16, seed) * 2.0 - 1.0).abs();
        r * r
    };
    let (a, b, c, d) = (turned(14, 8), turned(7, -14), turned(16, 3), turned(-9, 13));
    // Where one range's line bends: the big ridges are asked a little aside by two slow noises, one for each way,
    // so a ridge is an arc and seldom a ring.
    let (bend, twist) = (((noise(x, z, 30_000, 39) - 0.5) * 22_000.0 * 16.0) as i64, ((noise(x, z, 21_000, 71) - 0.5) * 16_000.0 * 16.0) as i64);
    // The massif north of the town stands whole whatever the slow noise says; further off there are wide valleys.
    let (nx, nz) = ((x - HOME.0) as f32, (z - HOME.1 + 105_000) as f32);
    let home = 1.0 - ease(45_000.0, 110_000.0, (nx * nx + nz * nz).sqrt());
    let mass = 0.3 + 0.7 * ease(0.3, 0.62, fine(a.0, a.1, 95_000 * 16, 38)).max(home);
    let first = ridge((a.0 + bend, a.1 - twist), 46_000, 31);
    let second = ridge((b.0 - twist / 2, b.1 + bend / 2), 19_000, 32);
    let third = ridge((c.0 + twist / 4, c.1), 7200, 33);
    let fourth = ridge(d, 2600, 34);
    let body = first * 0.62 + second * 0.38 * (0.35 + 0.65 * first);
    // Spurs and gullies down the flanks, and the small faces of broken rock: creases a hundred metres and a few
    // tens of metres across, deepest where the mountain is high. Without them a mountain close to was a dune.
    let spur = 1.0 - (fine(a.0, a.1, 950 * 16, 72) * 2.0 - 1.0).abs();
    let face = 1.0 - (fine(b.0, b.1, 330 * 16, 73) * 2.0 - 1.0).abs();
    let flank = (0.25 + body * 1.5).min(1.0);
    mass * (body * 0.84 + (third * 0.1 + fourth * 0.04) * flank + (spur * 0.016 + face * 0.005) * flank * (0.3 + body))
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

/// One of the columns a reef is grown over with, 0 to 1: they are three cells square, and each stands to a height
/// of its own (city.rs colours a column by the same number, pale where it stands tall).
pub fn reef_column(x: i32, z: i32) -> f32 {
    unit(x.div_euclid(3), z.div_euclid(3), 75)
}

/// The form of what a reef's rock is grown over with, in cells over the rock where the reef is whole, and how far
/// up its mound a place is (0 to 1): mounds a dozen metres across with round heads of a few metres on them.
pub fn reef_form(x: i32, z: i32) -> (f32, f32) {
    let (mound, head) = (ease(0.25, 0.8, noise(x, z, 105, 74)), noise(x, z, 29, 76));
    (mound * 46.0 + ease(0.3, 0.75, head) * 26.0 * (0.3 + mound), mound)
}

/// A reef's form and, on it, the ragged tops of what grows there column by column. Without it a reef was a smooth
/// slope in patches of colour.
fn overgrown(x: i32, z: i32) -> f32 {
    let (form, mound) = reef_form(x, z);
    form + reef_column(x, z) * (2.0 + 6.0 * mound)
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
        // Nearer the road stand what is left of tables worn away: buttes some tens of metres across and spires, each
        // on its own skirt, none within 60 m of the road.
        let butte = noise(x, z, 2300, 83) * 0.8 + noise(x, z, 520, 84) * 0.2 - (1.0 - ease(600.0, 3000.0, (z - HOME.1).abs() as f32)) * 0.35;
        let plain = 420.0 + noise(x, z, 7000, 35) * 200.0 * (0.3 + 0.7 * away) + noise(x, z, 1100, 36) * 40.0 - ease(0.86, 0.97, wash) * 26.0 * away
            + ease(0.5, 0.6, table) * 220.0 + ease(0.6, 0.612, table) * 800.0 + ease(0.67, 0.68, table) * 600.0
            + ease(0.66, 0.74, butte) * 130.0 + ease(0.74, 0.752, butte) * (300.0 + noise(x, z, 9000, 85) * 500.0) + ease(0.79, 0.8, butte) * 260.0;
        h += (plain - h) * d;
    }
    if p > 0.0 {
        h += p * high(x, z) * 36_000.0;
        let (dx, dz) = ((x - REFUGE.0) as f32, (z - REFUGE.1) as f32);
        if dx.abs() < 420.0 && dz.abs() < 420.0 {
            h += (REFUGE.2 as f32 - h) * (1.0 - ease(170.0, 420.0, (dx * dx + dz * dz).sqrt()));
        }
    }
    let w = far(x, z);
    if let Some(s) = offshore(x, z).filter(|_| w < 1.0) {
        let o = open(x, z) * (1.0 - w);
        if s > -7000.0 && o > 0.0 {
            // Hills stand along the coast and end in cliffs where they are high, in a beach where they are low.
            let hills = noise(x, z, 8200, 54);
            h += o * ease(-7000.0, -500.0, s) * (ease(0.3, 0.75, hills) * 1300.0 + noise(x, z, 2100, 55) * 260.0);
            if s > -500.0 {
                // The sea's floor: a shelf of sand with reefs standing off it in mounds, then down into the deep.
                let shelf = ease(100.0, 700.0, s);
                let reef = ease(0.5, 0.8, noise(x, z, 900, 56));
                let mut bed = -45.0 - ease(0.0, 2600.0, s) * 150.0 - ease(2600.0, 40_000.0, s) * 900.0 + (reef * (25.0 + noise(x, z, 230, 57) * 70.0) + noise(x, z, 60, 58) * 8.0) * shelf;
                if reef * shelf > 0.0 {
                    // What grows stops short of the top of the water: two metres under it, or where the rock was.
                    bed = (bed + overgrown(x, z) * reef * shelf).min(bed.max(-20.0));
                }
                // Stacks of rock stand out of the water off the headlands.
                let stack = noise(x, z, 310, 59);
                if stack > 0.8 && s < 5000.0 {
                    bed += ease(0.8, 0.9, stack) * (260.0 + noise(x, z, 2900, 60) * 300.0) * shelf * (1.0 - ease(2500.0, 5000.0, s));
                }
                h += (bed - h) * o * ease(-500.0, 60.0, s);
            }
        }
    }
    if w > 0.0 {
        // The planet's land: higher inland, and its sea with a shelf and then the deep.
        let c = continent(x, z);
        let mut dry_land = h.max(town) + ease(0.0, 0.02, c) * 600.0 + c.max(0.0) * 8000.0;
        if c > -0.004 {
            // Rivers: the land comes down to each in a valley, and its bed is three metres under the sea's level.
            dry_land = -30.0 + (dry_land + 30.0) * valley(x, z);
        }
        let bed = -45.0 - ease(0.0, 0.01, -c) * 150.0 - ease(0.01, 0.2, -c) * 900.0 + noise(x, z, 60, 58) * 8.0;
        let mut there = dry_land + (bed - dry_land) * (1.0 - ease(-0.004, -0.001, c));
        // Where the planet is coldest the sea is under ice: floes at its edge, then a sheet, a little over the water.
        if there < 3.0 && cold(z) + (noise(x, z, 30_000, 75) - 0.5) * 0.06 > 0.9 {
            there = 3.0;
        }
        h += (there - h) * w;
    }
    h.floor() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What asking for the ground costs in the town's country and far from it:
    /// `cargo test --release ground_cost -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn ground_cost() {
        for (name, x0, z0) in [("town", 700, 4070), ("plain", 90_000, 4070), ("mountains", 700, -90_000), ("far land", 3_000_000, 4_000_000), ("far sea", -8_000_000, 4070)] {
            let t = std::time::Instant::now();
            let mut sum = 0i64;
            for i in 0..200_000 {
                sum += ground(x0 + (i % 450) * 7, z0 + (i / 450) * 7) as i64;
            }
            println!("{name}: {:.0} ns a column (mean height {})", t.elapsed().as_nanos() as f64 / 200_000.0, sum / 200_000);
        }
    }

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
