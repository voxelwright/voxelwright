//! Water that flows (#140). Not cells: a tank of cells emptying would be a hundred thousand edits a second where a
//! burning house is a few hundred, and every edit is a sector made again and a tile of the sun's maps spoiled.
//! Flowing water is a depth over each column of a window of the world, two cells to a column, and it moves from
//! column to column by how much higher its top stands than its neighbour's (pipes between columns, each with the
//! flow it had and what the height between its ends adds). What it flows over is the world as it stands: a floor
//! is looked for where the water arrives, and looked for again where the world has changed, so a wall keeps it
//! in and a hole lets it out. The still sea stays a plane (city.rs); water that reaches it is the sea's.
//!
//! Where it comes from is the town's own: the tank of a yard's water tower holds forty cubic metres, and lets it
//! out through whatever holes are made in it, faster the deeper the hole is under what is left.
//!
//! Lengths are in the finest cells (10 cm), times in seconds. Told to the page as heights (FLOW, bodies.rs).

use crate::bodies::{Bodies, FLOW, Ground};
use crate::city;

/// Cells a column is wide.
pub const COL: i32 = 2;
/// Columns each way in the window: 77 m.
pub const N: usize = 384;
/// One step of the flow, seconds.
const TICK: f32 = 1.0 / 60.0;
const G: f32 = 98.0;
/// A tank's inside: how far from its middle to its wall, and how high.
const TANK_R: i32 = 18;
const TANK_HIGH: i32 = 42;
/// Water thinner than this on a column is gone: it has soaked in or dried.
const FILM: f32 = 0.04;
/// How fast standing water sinks away, cells a second.
const SOAKS: f32 = 0.004;
/// Water less than this far over a hole in a tank does not come out of it: the last of it would dribble for minutes.
const DRIBBLE: f32 = 0.5;

struct Tank {
    /// The middle of its floor, inside.
    at: [i32; 3],
    /// Cells of water left in it.
    left: f32,
    /// Holes in it: where the water comes out (a column of the window), how high over the tank's floor, how wide.
    holes: Vec<(usize, f32, f32)>,
}

#[derive(Default)]
pub struct Water {
    /// The world's cell at the window's low corner.
    low: [i32; 2],
    floor: Vec<f32>,
    depth: Vec<f32>,
    /// What leaves each column a second, to +x, -x, +z, -z.
    flux: Vec<[f32; 4]>,
    known: Vec<bool>,
    listed: Vec<bool>,
    wet: Vec<u32>,
    tanks: Vec<Tank>,
    owed: f32,
    /// Seconds since it was last told, and since anything moved.
    untold: f32,
    still: f32,
    awake: bool,
    /// Cells of water that have left: out of the window or into the sea, and soaked away. For measuring.
    pub sunk: f32,
    pub soaked: f32,
    pub steps: u32,
    /// What `flow` has cost, in all and at worst, ms: for the test.
    #[cfg(test)]
    pub spent: (f32, f32),
}

/// Where a floor is at a column, looked for from a height: the lowest free cell with something solid under it, at
/// or below `from`; or, if `from` is inside something, the first free cell over it.
fn floor_at(ground: &mut Ground, x: i32, z: i32, from: i32) -> f32 {
    let mut y = from;
    if ground.solid(x, y, z) {
        let top = y + 80;
        while y < top && ground.solid(x, y, z) {
            y += 1;
        }
        return y as f32;
    }
    let least = y - 600;
    while y > least && !ground.solid(x, y - 1, z) {
        y -= 1;
    }
    y as f32
}

impl Water {
    /// How many columns have water on them.
    pub fn wet(&self) -> usize {
        self.wet.len()
    }

    /// Whether it is moving, or may: the page keeps asking for time while it is.
    pub fn flowing(&self) -> bool {
        self.awake
    }

    /// Cells of water on the ground, and left in tanks.
    pub fn held(&self) -> (f32, f32) {
        (self.wet.iter().map(|&i| self.depth[i as usize]).sum::<f32>() * (COL * COL) as f32, self.tanks.iter().map(|t| t.left).sum())
    }

    fn open(&mut self, mid: [i32; 2]) {
        let half = N as i32 * COL / 2;
        self.low = [(mid[0] - half).div_euclid(COL) * COL, (mid[1] - half).div_euclid(COL) * COL];
        self.floor = vec![0.0; N * N];
        self.depth = vec![0.0; N * N];
        self.flux = vec![[0.0; 4]; N * N];
        self.known = vec![false; N * N];
        self.listed = vec![false; N * N];
        self.wet.clear();
    }

    fn column(&self, x: i32, z: i32) -> Option<usize> {
        let (cx, cz) = ((x - self.low[0]).div_euclid(COL), (z - self.low[1]).div_euclid(COL));
        if cx < 1 || cz < 1 || cx >= N as i32 - 1 || cz >= N as i32 - 1 { None } else { Some(cx as usize + N * cz as usize) }
    }

    /// The world changed in a box: a tank there is looked at for holes, and floors there are looked for again.
    fn changed(&mut self, ground: &mut Ground, lo: [i32; 3], hi: [i32; 3]) {
        let mid = [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2];
        if let Some(at) = city::tank_near(mid[0], mid[1]) {
            // Within reach of the tank itself, not just in its yard.
            let near = lo[0] <= at[0] + 24 && hi[0] >= at[0] - 24 && lo[2] <= at[2] + 24 && hi[2] >= at[2] - 24 && hi[1] >= at[1] - 4 && lo[1] <= at[1] + TANK_HIGH + 4;
            if near && !self.tanks.iter().any(|t| t.at == at) {
                if self.floor.is_empty() {
                    self.open([at[0], at[2]]);
                }
                self.tanks.push(Tank { at, left: std::f32::consts::PI * (TANK_R * TANK_R * (TANK_HIGH - 2)) as f32, holes: Vec::new() });
            }
        }
        if self.floor.is_empty() {
            return;
        }
        let (x0, x1) = (((lo[0] - self.low[0]).div_euclid(COL)).clamp(0, N as i32) as usize, ((hi[0] - self.low[0]).div_euclid(COL) + 1).clamp(0, N as i32) as usize);
        let (z0, z1) = (((lo[2] - self.low[1]).div_euclid(COL)).clamp(0, N as i32) as usize, ((hi[2] - self.low[1]).div_euclid(COL) + 1).clamp(0, N as i32) as usize);
        for cz in z0..z1 {
            for cx in x0..x1 {
                self.known[cx + N * cz] = false;
            }
        }
        for k in 0..self.tanks.len() {
            self.holes(ground, k);
        }
        self.awake = !self.tanks.is_empty();
        self.still = 0.0;
    }

    /// Looks a tank over for holes: its wall at sixty-four places round, each cell of its height, and its floor.
    fn holes(&mut self, ground: &mut Ground, k: usize) {
        let at = self.tanks[k].at;
        let mut holes = Vec::new();
        if self.tanks[k].left > 0.0 {
            for a in 0..64 {
                let (sin, cos) = (a as f32 * std::f32::consts::TAU / 64.0).sin_cos();
                let (x, z) = (at[0] + ((TANK_R + 1) as f32 * cos).round() as i32, at[2] + ((TANK_R + 1) as f32 * sin).round() as i32);
                let out = self.column(at[0] + ((TANK_R + 5) as f32 * cos).round() as i32, at[2] + ((TANK_R + 5) as f32 * sin).round() as i32);
                let Some(out) = out else { continue };
                for y in 0..TANK_HIGH {
                    if !ground.solid(x, at[1] + y, z) {
                        holes.push((out, y as f32, 1.9));
                    }
                }
            }
            for dz in (-12..=12).step_by(6) {
                for dx in (-12..=12).step_by(6) {
                    if !ground.solid(at[0] + dx, at[1] - 1, at[2] + dz) && !ground.solid(at[0] + dx, at[1] - 2, at[2] + dz) {
                        if let Some(c) = self.column(at[0] + dx, at[2] + dz) {
                            holes.push((c, 0.0, 36.0));
                        }
                    }
                }
            }
        }
        self.tanks[k].holes = holes;
    }

    /// Water onto a column, from a height.
    fn pour(&mut self, ground: &mut Ground, c: usize, cells: f32, from: i32) {
        if !self.known[c] || self.depth[c] <= 0.0 {
            let (x, z) = (self.low[0] + (c % N) as i32 * COL + 1, self.low[1] + (c / N) as i32 * COL + 1);
            self.floor[c] = floor_at(ground, x, z, from);
            self.known[c] = true;
        }
        self.depth[c] += cells / (COL * COL) as f32;
        if !self.listed[c] {
            self.listed[c] = true;
            self.wet.push(c as u32);
        }
    }

    fn step(&mut self, ground: &mut Ground, dt: f32) {
        // What the tanks let out.
        for k in 0..self.tanks.len() {
            let level = self.tanks[k].left / (std::f32::consts::PI * (TANK_R * TANK_R) as f32);
            let holes = std::mem::take(&mut self.tanks[k].holes);
            let at = self.tanks[k].at;
            for &(c, high, wide) in &holes {
                let head = level - high;
                if head <= DRIBBLE || self.tanks[k].left <= 0.0 {
                    continue;
                }
                // Out of a hole as fast as the water over it drives it; half of that gets through a ragged hole.
                let out = (0.5 * wide * (2.0 * G * head).sqrt() * dt).min(self.tanks[k].left);
                self.tanks[k].left -= out;
                self.pour(ground, c, out, at[1] + high as i32);
            }
            self.tanks[k].holes = holes;
        }
        // What leaves each wet column, from where everything stands now.
        let n = self.wet.len();
        let mut moved = 0.0f32;
        for w in 0..n {
            let i = self.wet[w] as usize;
            let (cx, cz) = (i % N, i / N);
            if cx == 0 || cz == 0 || cx == N - 1 || cz == N - 1 || self.floor[i] <= 0.0 {
                // Out of the window, or down at the sea's own level: it is gone.
                self.sunk += self.depth[i] * (COL * COL) as f32;
                self.depth[i] = 0.0;
                self.flux[i] = [0.0; 4];
                continue;
            }
            let h = self.floor[i] + self.depth[i];
            // Thin water drags on what it runs over.
            let drag = 1.0 / (1.0 + dt * 2.5 / self.depth[i].max(0.25));
            let mut out = [0.0f32; 4];
            for (d, j) in [i + 1, i - 1, i + N, i - N].into_iter().enumerate() {
                if !self.known[j] {
                    let (x, z) = (self.low[0] + (j % N) as i32 * COL + 1, self.low[1] + (j / N) as i32 * COL + 1);
                    self.floor[j] = floor_at(ground, x, z, (h + 4.0) as i32);
                    self.known[j] = true;
                }
                let fall = h - (self.floor[j] + self.depth[j]);
                out[d] = (self.flux[i][d] * drag + dt * G * COL as f32 * fall).max(0.0);
            }
            let (all, have) = (out.iter().sum::<f32>() * dt, self.depth[i] * (COL * COL) as f32);
            if all > have {
                let part = have / all;
                out = out.map(|f| f * part);
            }
            self.flux[i] = out;
        }
        for w in 0..n {
            let i = self.wet[w] as usize;
            for (d, j) in [i + 1, i - 1, i + N, i - N].into_iter().enumerate() {
                let v = self.flux[i][d] * dt / (COL * COL) as f32;
                if v <= 0.0 {
                    continue;
                }
                moved += v;
                self.depth[i] -= v;
                self.depth[j] += v;
                if !self.listed[j] {
                    self.listed[j] = true;
                    self.wet.push(j as u32);
                }
            }
        }
        // It soaks away slowly, and a film of it is gone.
        let (depth, flux, listed) = (&mut self.depth, &mut self.flux, &mut self.listed);
        let mut soaked = 0.0;
        self.wet.retain(|&i| {
            let i = i as usize;
            let lost = (SOAKS * dt).min(depth[i]);
            depth[i] -= lost;
            soaked += lost;
            if depth[i] < FILM && flux[i].iter().all(|&f| f < 0.5) {
                soaked += depth[i];
                depth[i] = 0.0;
                flux[i] = [0.0; 4];
                listed[i] = false;
                return false;
            }
            true
        });
        self.soaked += soaked * (COL * COL) as f32;
        // A tank is letting water out while any hole in it is under what is left.
        let leaking = self.tanks.iter().any(|t| {
            let level = t.left / (std::f32::consts::PI * (TANK_R * TANK_R) as f32);
            t.holes.iter().any(|&(_, high, _)| level - high > DRIBBLE)
        });
        self.still = if leaking || moved > 0.02 * self.wet.len().max(1) as f32 * dt { 0.0 } else { self.still + dt };
        self.steps += 1;
    }

    /// What the page is told: the window, then for each column of the box round the wet ones a word: how high the
    /// water's top is over `base` in eighths of a cell (18 bits), how deep in sixteenths (8 bits), how fast it runs
    /// in pairs of cells a second (6 bits). A dry column is 0.
    fn tell(&self) -> Vec<u32> {
        let (mut x0, mut z0, mut x1, mut z1) = (N, N, 0, 0);
        for &i in &self.wet {
            let (cx, cz) = (i as usize % N, i as usize / N);
            (x0, z0, x1, z1) = (x0.min(cx), z0.min(cz), x1.max(cx + 1), z1.max(cz + 1));
        }
        if self.wet.is_empty() {
            (x0, z0, x1, z1) = (0, 0, 0, 0);
        }
        let base = self.tanks.first().map_or(0, |t| city::ground(t.at[0], t.at[2])) - 800;
        let (w, h) = (x1 - x0, z1 - z0);
        let mut words = vec![self.low[0] as u32, self.low[1] as u32, COL as u32, N as u32, base as u32, x0 as u32, z0 as u32, w as u32, h as u32];
        words.resize(9 + w * h, 0);
        for &i in &self.wet {
            let i = i as usize;
            let (cx, cz) = (i % N, i / N);
            let top = ((self.floor[i] + self.depth[i] - base as f32) * 8.0).clamp(1.0, 262143.0) as u32;
            let deep = (self.depth[i] * 16.0).clamp(1.0, 255.0) as u32;
            let f = self.flux[i];
            let fast = (((f[0] - f[1]).hypot(f[2] - f[3]) / (self.depth[i].max(0.1) * COL as f32)) / 2.0).min(63.0) as u32;
            words[9 + (cx - x0) + w * (cz - z0)] = top | deep << 18 | fast << 26;
        }
        words
    }
}

impl Bodies {
    /// Moves the water on by `dt` seconds, and tells the page where it stands twenty times a second while it moves.
    pub(crate) fn flow(&mut self, dt: f32) {
        #[cfg(test)]
        let t0 = std::time::Instant::now();
        self.flowed(dt);
        #[cfg(test)]
        {
            let ms = t0.elapsed().as_secs_f32() * 1000.0;
            self.water.spent = (self.water.spent.0 + ms, self.water.spent.1.max(ms));
        }
    }

    fn flowed(&mut self, dt: f32) {
        // What changed in the world since it was last asked.
        let boxes = std::mem::take(&mut self.ground.latest);
        for (lo, hi) in boxes {
            let mut water = std::mem::take(&mut self.water);
            water.changed(&mut self.ground, lo, hi);
            self.water = water;
        }
        if !self.water.awake {
            return;
        }
        let mut water = std::mem::take(&mut self.water);
        water.owed = (water.owed + dt).min(TICK * 3.0);
        while water.owed >= TICK {
            water.owed -= TICK;
            water.step(&mut self.ground, TICK);
        }
        water.untold += dt;
        // Still for three seconds with nothing left to come out: it sleeps where it lies until the world changes.
        if water.still > 3.0 {
            water.awake = false;
            water.untold = 1.0;
        }
        if water.untold >= 0.05 {
            water.untold = 0.0;
            let words = water.tell();
            self.record(FLOW, &words);
        }
        self.water = water;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::city::{BLOCK_X, BLOCK_Z, YARD, YARD_TOWER};

    /// A charge against the side of the yard's tank: the water comes out, runs over the yard and stops; none of it is
    /// made or lost unaccounted for; and a step of it is cheap.
    #[test]
    fn a_tank_with_a_hole_in_it_empties_over_the_yard() {
        let (x, z) = (YARD.0 * BLOCK_X + YARD_TOWER.0, YARD.1 * BLOCK_Z + YARD_TOWER.1);
        let g = city::ground(x, z);
        let mut bodies = Bodies::new();
        // Low on its wall, on the side towards the street.
        bodies.blast([x, g + 124, z - 19], 8, None, false);
        let full = std::f32::consts::PI * (TANK_R * TANK_R * (TANK_HIGH - 2)) as f32;
        let (mut t, mut calls, mut widest, mut words, mut quiet) = (0.0f32, 0u32, 0usize, 0usize, 0.0f32);
        while t < 200.0 && (t < 1.0 || bodies.water.flowing() || !bodies.list.is_empty()) {
            bodies.out.clear();
            // The bodies the blast made are moved on too, as the page would: they land in the water's way.
            bodies.advance(1.0 / 60.0);
            calls += 1;
            widest = widest.max(bodies.water.wet());
            // What the page is told of the water alone: its records are the long ones.
            let (mut i, out) = (0, &bodies.out);
            while i < out.len() {
                if out[i] == FLOW { words += out[i + 1] as usize }
                i += 2 + out[i + 1] as usize;
            }
            t += 1.0 / 60.0;
            if bodies.water.flowing() { quiet = t }
            if std::env::var("WATCH").is_ok() && calls % 600 == 0 { let (l, k) = bodies.water.held(); eprintln!("  {t:.0} s: tank {k:.0}, lying {l:.0}, wet {}, still {:.1}, bodies {}", bodies.water.wet(), bodies.water.still, bodies.list.len()); }
        }
        let (spent, worst) = bodies.water.spent;
        let (on_ground, in_tank) = bodies.water.held();
        let w = &bodies.water;
        eprintln!("{full:.0} cells of water: {in_tank:.0} left in the tank, {on_ground:.0} lying, {:.0} gone out of the window or into the sea, {:.0} soaked away; {} columns wet at most, {} at the end; still after {quiet:.1} s; a call took {:.2} ms on average and {worst:.2} at worst; {:.0} kB told a second",
            w.sunk, w.soaked, widest, w.wet(), spent / calls as f32, words as f32 * 4.0 / 1000.0 / quiet.max(1.0));
        assert!(in_tank < full * 0.5, "the tank let out {:.0} of its {full:.0} cells", full - in_tank);
        assert!(widest > 2000, "the water spread over {widest} columns");
        let all = in_tank + on_ground + w.sunk + w.soaked;
        assert!((all - full).abs() < full * 0.01, "{all:.0} cells of water are accounted for, of {full:.0}");
        assert!(!w.flowing(), "it never came to rest");
        assert!(spent / (calls as f32) < 2.0, "a call took {:.2} ms on average", spent / calls as f32);
    }
}
