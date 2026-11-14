//! The engine's core (#140): cells, sectors and the generated city, and later what simulates
//! them. Built once as wasm for the page and the world process, so both get the same answers
//! from the same code; built natively for its own checks.
//!
//! What the outside calls is at the bottom: plain functions over the instance's own memory,
//! no generated glue. An instance does one thing at a time; a page runs one in each worker.

pub mod bodies;
pub mod city;
pub mod fire;
pub mod hash;
pub mod kinds;
pub mod land;
pub mod scratch;
pub mod support;
pub mod tree;
pub mod water;

use scratch::Scratch;
use std::cell::RefCell;
use tree::Whole;

/// Something done to the world, in the finest cells: a ball filled with one kind; a blast (a ball of kind 0),
/// which empties each material as far as that material gives; or rows of cells set or emptied, which is how
/// a piece that fell is taken from where it was and put where it landed.
#[derive(Clone)]
pub enum Edit {
    Ball { centre: [i32; 3], radius: i32, kind: tree::Kind },
    Runs(Vec<scratch::Run>),
    /// Rows of cells set or emptied, each by itself in every copy however coarse: what many edits of rows come to
    /// (`merged`).
    Rows(Vec<scratch::Run>),
}

/// One sector's cells as the world stands: the city's rules, then the edits, in order.
pub fn fill(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: &[Edit]) {
    fill_of(s, sx, sy, sz, lod, edits.iter());
}

/// As `fill`, of edits picked out by whoever knows which can reach the sector: the order is still theirs.
pub fn fill_of<'a>(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: impl Iterator<Item = &'a Edit>) {
    s.start(sx, sy, sz, lod);
    city::make(s);
    for e in edits {
        match e {
            // The edge's lumps are the blast's own: the same wherever it is worked out.
            Edit::Ball { centre, radius, kind: 0 } => s.blast(*centre, *radius, hash::hash(centre[0], centre[2], centre[1] as u32)),
            Edit::Ball { centre, radius, kind } => s.ball(*centre, *radius, *kind, 0, 0, None),
            Edit::Runs(runs) => s.runs(runs, true),
            Edit::Rows(runs) => s.runs(runs, false),
        }
    }
}

/// One sector of the world as it stands, as a tree.
pub fn sector(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: &[Edit], out: &mut Vec<u32>) -> Whole {
    fill(s, sx, sy, sz, lod, edits);
    tree::encode(&s.cells, out)
}

/// Edits as whole numbers, one after another: 0, x, y, z, radius, kind for a ball; 1, how many rows, then x0, x1, y, z, kind for each;
/// 2 as 1, for rows that many edits came to.
pub fn read_edits(words: &[i32]) -> Vec<Edit> {
    let (mut out, mut i) = (Vec::new(), 0);
    while i < words.len() {
        if words[i] == 0 {
            out.push(Edit::Ball { centre: [words[i + 1], words[i + 2], words[i + 3]], radius: words[i + 4], kind: words[i + 5] as tree::Kind });
            i += 6;
        } else {
            let n = words[i + 1] as usize;
            let rows = words[i + 2..i + 2 + n * 5].chunks_exact(5).map(|r| scratch::Run { x0: r[0], x1: r[1], y: r[2], z: r[3], kind: r[4] as tree::Kind }).collect();
            out.push(if words[i] == 2 { Edit::Rows(rows) } else { Edit::Runs(rows) });
            i += 2 + n * 5;
        }
    }
    out
}

// ── What a page or a world process calls ────────────────────────────────────

struct Instance {
    scratch: Scratch,
    tree: Vec<u32>,
    /// Edits for the next calls, as `read_edits` reads them.
    edits: Vec<i32>,
    out: [i32; 4],
    /// What `merge_rows` made, as `read_edits` reads it.
    merged: Vec<i32>,
    /// What has come loose and moves, in the one instance that is asked to move it.
    bodies: Option<Box<bodies::Bodies>>,
}

thread_local! {
    static INSTANCE: RefCell<Instance> = RefCell::new(Instance { scratch: Scratch::new(), tree: Vec::new(), edits: Vec::new(), out: [0; 4], merged: Vec::new(), bodies: None });
}

/// Room for edits of `words` whole numbers (see `read_edits`); write them at the address returned. They stay for every call until asked for again.
#[unsafe(no_mangle)]
pub extern "C" fn edits_room(words: usize) -> *mut i32 {
    INSTANCE.with_borrow_mut(|i| {
        i.edits.clear();
        i.edits.resize(words, 0);
        i.edits.as_mut_ptr()
    })
}

/// The edits in the room, all of rows, as one edit of rows that leaves a column of sectors the same in the copy
/// `lod` times coarser: the column from `x0`, `z0` up to `x1`, `z1` in the finest cells. Returns how many words it
/// is; they are at `merged_words`.
#[unsafe(no_mangle)]
pub extern "C" fn merge_rows(lod: u32, x0: i32, x1: i32, z0: i32, z1: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let rows = scratch::merged(&read_edits(&i.edits), lod, [x0, x1], [z0, z1]);
        i.merged.clear();
        i.merged.extend([2, rows.len() as i32]);
        for r in rows {
            i.merged.extend([r.x0, r.x1, r.y, r.z, r.kind as i32]);
        }
        i.merged.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn merged_words() -> *const i32 {
    INSTANCE.with_borrow(|i| i.merged.as_ptr())
}

/// Makes a sector. Returns how many words its tree is: 0 for all air, 1 for all one kind (that kind is the one word), else the tree. The words are at `tree_words`.
#[unsafe(no_mangle)]
pub extern "C" fn make_sector(sx: i32, sy: i32, sz: i32, lod: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let edits = read_edits(&i.edits);
        match sector(&mut i.scratch, sx, sy, sz, lod, &edits, &mut i.tree) {
            Whole::Empty => 0,
            Whole::Uniform(kind) => {
                i.tree.clear();
                i.tree.push(kind as u32);
                1
            }
            Whole::Tree(words) => words,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn tree_words() -> *const u32 {
    INSTANCE.with_borrow(|i| i.tree.as_ptr())
}

/// The sectors of a column of sectors worth making: writes the first and last to the address returned. Below is earth, above is air.
#[unsafe(no_mangle)]
pub extern "C" fn sector_span(sx: i32, sz: i32, lod: u32) -> *const i32 {
    INSTANCE.with_borrow_mut(|i| {
        let (lo, hi) = city::span(sx, sz, lod);
        i.out[0] = lo;
        i.out[1] = hi;
        i.out.as_ptr()
    })
}

/// How high the ground is at a column of the finest cells.
#[unsafe(no_mangle)]
pub extern "C" fn ground_at(x: i32, z: i32) -> i32 {
    city::ground(x, z)
}

/// Where someone on foot stands at a column by the town's rule (city::footing): the height of their feet.
#[unsafe(no_mangle)]
pub extern "C" fn feet_at(x: i32, z: i32) -> i32 {
    city::footing(x, z).0
}

/// What is under someone on foot at a column by the town's rule: the sort of block (0 open country, 1 shore, 2 park,
/// 3 homes, 4 towers, 5 yard), and 8 more if it is paving.
#[unsafe(no_mangle)]
pub extern "C" fn paving_at(x: i32, z: i32) -> i32 {
    let (_, paved, sort) = city::footing(x, z);
    sort + if paved { 8 } else { 0 }
}

/// How big a box round a change is asked what still holds: 16 m across and deep, 22 m tall.
pub const SETTLE: [usize; 3] = [160, 224, 160];
/// The box a charge is asked about in again, in blocks (support.rs `release_far`): 32 m across, 25.6 m tall, whole sectors.
pub const WIDE: [usize; 3] = [320, 256, 320];
/// How many times over what has landed is asked again whether it holds, in the support rule's own tests: a heap
/// took six to come to rest, and nine once a cell could be crushed by what rests on it.
pub const ROUNDS: u32 = 12;

// ── Bodies: what has come loose and moves (bodies.rs). One instance, in a worker of its own or the world process. ──

fn moving(i: &mut Instance) -> &mut bodies::Bodies {
    i.bodies.get_or_insert_with(|| Box::new(bodies::Bodies::new()))
}

/// Tells the solver of edits made by someone else (a blast): the edits written at `edits_room`. `after` is how many of
/// the solver's own edits their maker had heard of when it made them, so that everyone applies all edits in one order;
/// under zero puts them last.
#[unsafe(no_mangle)]
pub extern "C" fn world_edit(after: i32) {
    INSTANCE.with_borrow_mut(|i| {
        let edits = read_edits(&i.edits);
        let b = moving(i);
        for e in edits {
            // Whatever sleeps where the world has changed is stepped again, and sleeps again if nothing reached it.
            b.stir_edit(&e);
            b.ground.push(e, false, if after < 0 { None } else { Some(after as usize) });
        }
    })
}

/// A blast at a point, of the solver's own doing: the edit is made here (do not also tell it with `world_edit`),
/// what it empties comes out as lumps, and what it leaves unheld comes loose. `after` is how many of the solver's own
/// edits the blast's maker had heard of; under zero puts it last. `spark` (not zero) lets it set alight what can
/// burn round it. Returns how many words tell it, at `bodies_words`:
/// records as in bodies.rs (cells taken out of the world, each body born, dust).
#[unsafe(no_mangle)]
pub extern "C" fn bodies_blast(x: i32, y: i32, z: i32, radius: i32, after: i32, spark: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.blast([x, y, z], radius, if after < 0 { None } else { Some(after as usize) }, spark != 0);
        b.out.len()
    })
}

/// Moves the bodies on by `dt` seconds. Returns how many words tell it, at `bodies_words`: where each body is, which
/// have come to rest and the cells they are now.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_advance(dt: f32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.advance(dt);
        b.out.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn bodies_words() -> *const u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).out.as_ptr())
}

/// How many bodies are moving, and how many points were tried against the world in the last call: for measuring.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_count() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).busy())
}

#[unsafe(no_mangle)]
pub extern "C" fn bodies_tried() -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).tried)
}

/// Sets alight what can burn within `radius` cells of a point. Returns how many cells caught.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_ignite(x: i32, y: i32, z: i32, radius: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).ignite([x, y, z], radius, false))
}

/// How many cells are alight.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_burning() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).fire.alight.len())
}

/// What a cell of the world the solver moves in is made of, edits and all: 0 for air (kinds.rs for the rest).
#[unsafe(no_mangle)]
pub extern "C" fn world_kind(x: i32, y: i32, z: i32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).ground.kind(x, y, z) as u32)
}

/// Whether water is flowing, or may: 1 while the page should keep asking for time.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_flowing() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).water.flowing() as usize)
}

/// Sends a ball of `kind`, `radius` cells across its half, from a place at a speed (cells a second). Returns how many
/// words tell it, at `bodies_words`: the body born.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_throw(x: f32, y: f32, z: f32, vx: f32, vy: f32, vz: f32, radius: i32, kind: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.throw_ball([x, y, z], [vx, vy, vz], radius, kind as tree::Kind);
        b.out.len()
    })
}

/// What is no longer held round a point comes loose as bodies (after an edit told with `world_edit`). Returns how
/// many words tell it, at `bodies_words`.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_release(x: i32, y: i32, z: i32, radius: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.release([x, y, z], radius);
        b.out.len()
    })
}

// ── Living things (bodies/living.rs, #245): bodies that are kept, and driven from outside the solver. ──

/// Makes a living thing of cells written at `edits_room` (one kind a word, laid out x, then z, then y, `sx * sy * sz`
/// of them) with its low corner at a place. With `take` not zero those cells are taken out of the world as it is
/// born: a thing that stood there as cells gets up. Returns how many words tell it, at `bodies_words` (the cells
/// taken out, the body born); `living_last` is its id, 0 if it could not be made.
#[unsafe(no_mangle)]
pub extern "C" fn living_spawn(sx: u32, sy: u32, sz: u32, x: i32, y: i32, z: i32, take: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let size = [sx as usize, sy as usize, sz as usize];
        let count = size[0].saturating_mul(size[1]).saturating_mul(size[2]);
        let cells: Vec<tree::Kind> = if count <= i.edits.len() { i.edits[..count].iter().map(|&k| k as tree::Kind).collect() } else { Vec::new() };
        let b = moving(i);
        b.out.clear();
        b.spawn(cells, size, [x, y, z], take != 0);
        b.out.len()
    })
}

/// The id of the thing `living_spawn` last made, 0 if it made none.
#[unsafe(no_mangle)]
pub extern "C" fn living_last() -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).spawned)
}

/// Gives a living thing its motor: `count` numbers written at `edits_room` as the bits of floats (`Live::set`:
/// front, grip, power, top, steer, hover, lift, upright, turns, jump, tough, then x, y, z, reach, steers, drives for
/// each foot). Returns 1 if it was taken.
#[unsafe(no_mangle)]
pub extern "C" fn living_motor(id: u32, count: usize) -> u32 {
    INSTANCE.with_borrow_mut(|i| {
        let numbers: Vec<f32> = i.edits.iter().take(count).map(|&w| f32::from_bits(w as u32)).collect();
        (numbers.len() == count && moving(i).motor(id, &numbers)) as u32
    })
}

/// Tells a living thing what to do, until it is told again or a second has gone: go, turn and rise from -1 to 1,
/// whether to roll over once and whether to jump. Returns 1 if there is such a thing.
#[unsafe(no_mangle)]
pub extern "C" fn living_drive(id: u32, go: f32, turn: f32, rise: f32, roll: i32, jump: i32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).drive(id, go, turn, rise, roll != 0, jump != 0) as u32)
}

/// A living thing lives no more: it is a loose body, and cells again where it comes to lie. Returns 1 if there was one.
#[unsafe(no_mangle)]
pub extern "C" fn living_end(id: u32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).end(id) as u32)
}

/// Puts a living thing at a place (its middle of mass, in cells) with a turn (a quaternion), still: where it last
/// slept, for a world that is started again. Returns 1 if there is such a thing.
#[unsafe(no_mangle)]
pub extern "C" fn living_place(id: u32, x: f32, y: f32, z: f32, qx: f32, qy: f32, qz: f32, qw: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).place(id, [x, y, z], [qx, qy, qz, qw]) as u32)
}
