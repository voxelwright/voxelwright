//! Fire (#151). Wood, leaves, roofing and grass burn. A burning cell lasts as long as its
//! material does, may set each neighbour that can burn alight (the one above most readily), and
//! is then gone or left as char. What burns away is an edit like any other, so what it held up
//! comes loose and falls. Ten times a second, in whole numbers and hashes: the same fire from
//! the same spark.
//!
//! Fire is part of what the solver holds (bodies.rs): it reads the same standing world and
//! changes it the same way. Flames and smoke are the page's, drawn where this says cells burn.

use crate::bodies::{Bodies, FIRE, Map};
use crate::city;
use crate::hash::hash3;
use crate::kinds::{EARTH, GRASS, ROCK, WOOD, burns, grey, kind, material};
use crate::scratch::Run;

/// One turn of the fire, seconds.
pub const TICK: f32 = 0.1;
/// The most burning cells told to the page each turn: enough flames to see, whatever the fire's size.
const SHOWN: usize = 260;
/// The most cells alight at once: past this nothing new catches until some have burnt out.
const MOST: usize = 60_000;

#[derive(Default)]
pub struct Fire {
    /// The cells alight, and how many turns each has left.
    pub(crate) alight: Map<[i32; 3], u16>,
    owed: f32,
    turn: u32,
    /// Cells burnt away since what they held was last asked about, and where the last of them was.
    burnt: usize,
    last: [i32; 3],
    since: f32,
}

impl Bodies {
    /// Sets alight what can burn within `radius` cells of a point: every cell of it, or (`some`) about one in twelve,
    /// as a blast does. Returns how many caught.
    pub fn ignite(&mut self, at: [i32; 3], radius: i32, some: bool) -> usize {
        let mut caught = 0;
        for y in -radius..=radius {
            for z in -radius..=radius {
                for x in -radius..=radius {
                    if x * x + y * y + z * z > radius * radius {
                        continue;
                    }
                    let c = [at[0] + x, at[1] + y, at[2] + z];
                    if some && hash3(c[0], c[1], c[2], 31) % 12 != 0 {
                        continue;
                    }
                    caught += self.light(c, 0) as usize;
                }
            }
        }
        caught
    }

    /// Sets one cell alight if it is there, can burn and is not burning. `late` is how many turns longer it lasts than its material says.
    fn light(&mut self, c: [i32; 3], late: u16) -> bool {
        if self.fire.alight.len() >= MOST || self.fire.alight.contains_key(&c) || !self.ground.fuel(c[0], c[1], c[2]) {
            return false;
        }
        // Nothing burns under the sea: its weed is leaves, and leaves burn.
        if c[1] <= city::SEA && city::ground(c[0], c[2]) < city::SEA {
            return false;
        }
        let (lasts, _) = burns(material(self.ground.kind(c[0], c[1], c[2])));
        if lasts == 0 {
            return false;
        }
        // No two cells burn for quite the same time.
        let own = (hash3(c[0], c[1], c[2], 32) % (lasts as u32 / 2 + 1)) as u16;
        self.fire.alight.insert(c, lasts + own + late);
        true
    }

    /// Moves the fire on by `dt` seconds, in whole turns. Tells the page where it burns.
    pub(crate) fn burn(&mut self, dt: f32) {
        if self.fire.alight.is_empty() {
            self.fire.owed = 0.0;
            return;
        }
        self.fire.owed = (self.fire.owed + dt).min(TICK * 2.0);
        self.fire.since += dt;
        while self.fire.owed >= TICK {
            self.fire.owed -= TICK;
            self.fire.turn += 1;
            let turn = self.fire.turn;
            let cells: Vec<([i32; 3], u16)> = self.fire.alight.iter().map(|(c, left)| (*c, *left)).collect();
            let mut gone: Vec<Run> = Vec::new();
            for (c, left) in cells {
                if !self.ground.solid(c[0], c[1], c[2]) {
                    // Blasted away, or come loose and fallen: its fire is out.
                    self.fire.alight.remove(&c);
                    continue;
                }
                // It may set each neighbour alight: the one above twice as readily, and now and then one two above.
                for (i, d) in [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [0, 2, 0]].into_iter().enumerate() {
                    let n = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
                    // Most neighbours are air or will not burn: that is asked first, and quickly.
                    if !self.ground.fuel(n[0], n[1], n[2]) || self.fire.alight.contains_key(&n) {
                        continue;
                    }
                    let (_, catches) = burns(material(self.ground.kind(n[0], n[1], n[2])));
                    let chance = match i { 5 => catches as u32 * 2, 6 => catches as u32 / 2, 4 => catches as u32 / 2, _ => catches as u32 };
                    if chance > 0 && hash3(n[0], n[1], n[2], turn.wrapping_mul(7).wrapping_add(i as u32)) % 256 < chance {
                        self.light(n, 0);
                    }
                }
                if left > 1 {
                    self.fire.alight.insert(c, left - 1);
                    continue;
                }
                self.fire.alight.remove(&c);
                // Burnt out: leaves and roofing are gone, grass is bare earth, wood is gone or (two times in five) char that still stands.
                let was = self.ground.kind(c[0], c[1], c[2]);
                let now = match material(was) {
                    GRASS => kind(EARTH, grey(3)),
                    WOOD if hash3(c[0], c[1], c[2], 33) % 5 < 2 => kind(ROCK, grey(2)),
                    _ => 0,
                };
                gone.push(Run { x0: c[0], x1: c[0] + 1, y: c[1], z: c[2], kind: now });
                if now == 0 {
                    self.fire.burnt += 1;
                    self.fire.last = c;
                }
            }
            self.change(gone);
        }
        // What the fire ate may have held something up: asked once a second, where it last ate.
        if self.fire.burnt > 40 && self.fire.since > 1.0 {
            self.fire.burnt = 0;
            self.fire.since = 0.0;
            let at = self.fire.last;
            self.release(at, 0);
        }
        // Where it burns: some of the cells, a different some each turn.
        let n = self.fire.alight.len();
        let skip = n / SHOWN + 1;
        let mut words: Vec<u32> = Vec::with_capacity(SHOWN * 3 + 1);
        words.push(n as u32);
        for (i, c) in self.fire.alight.keys().enumerate() {
            if (i + self.fire.turn as usize) % skip == 0 && words.len() < SHOWN * 3 {
                words.extend(c.iter().map(|&v| (v as f32 + 0.5).to_bits()));
            }
        }
        self.record(FIRE, &words);
    }
}

#[cfg(test)]
mod tests {
    use crate::bodies::Bodies;
    use crate::city;
    use crate::kinds::{LEAVES, material};

    #[test]
    fn weed_under_the_lake_does_not_catch() {
        // The grove the board's under-water row looks at: weed is leaves, and leaves burn anywhere else.
        let mut bodies = Bodies::new();
        let found = (-12_800..-12_600).step_by(3).flat_map(|x| (3960..4140).step_by(3).map(move |z| (x, z))).find_map(|(x, z)| {
            let ground = city::ground(x, z);
            (ground < -40).then(|| (ground + 8..ground + 40).find(|&y| material(bodies.ground.kind(x, y, z)) == LEAVES).map(|y| (x, y, z))).flatten()
        });
        let Some((x, y, z)) = found else { panic!("no weed in the lake where the under-water row looks: the check needs some") };
        assert_eq!(bodies.ignite([x, y, z], 4, false), 0, "weed {} cells under the sea's top caught", -y);
    }

    #[test]
    fn a_tree_set_alight_burns_away_and_the_fire_goes_out() {
        // A street tree near the start: the first leaves found over the pavements there.
        let mut bodies = Bodies::new();
        let found = (600..700).step_by(4).flat_map(|x| (3980..4060).step_by(4).map(move |z| (x, z))).find_map(|(x, z)| {
            let ground = city::ground(x, z);
            (ground + 25..ground + 90).find(|&y| material(bodies.ground.kind(x, y, z)) == LEAVES).map(|y| (x, y, z))
        });
        let Some((x, y, z)) = found else { panic!("no tree near the start: the check needs one") };
        let leaves_before = (0..40).flat_map(|dy| (-20..20).map(move |dx| (dx, dy))).filter(|&(dx, dy)| material(bodies.ground.kind(x + dx, y + dy, z)) == LEAVES).count();
        assert!(leaves_before > 100, "a crown's slice has {leaves_before} leaves");
        let caught = bodies.ignite([x, y + 2, z], 3, false);
        assert!(caught > 10, "{caught} cells caught");
        let (mut most, mut t) = (0, 0.0);
        while !bodies.fire.alight.is_empty() && t < 240.0 {
            bodies.out.clear();
            bodies.advance(1.0 / 30.0);
            most = most.max(bodies.fire.alight.len());
            t += 1.0 / 30.0;
        }
        assert!(bodies.fire.alight.is_empty(), "the fire was still burning after four minutes ({} cells)", bodies.fire.alight.len());
        assert!(most > caught * 5, "the fire spread: {most} cells alight at its height from {caught}");
        let leaves_after = (0..40).flat_map(|dy| (-20..20).map(move |dx| (dx, dy))).filter(|&(dx, dy)| material(bodies.ground.kind(x + dx, y + dy, z)) == LEAVES).count();
        assert!(leaves_after * 4 < leaves_before, "most of the crown burnt: {leaves_before} leaves before, {leaves_after} after {t:.0} s");
    }
}
