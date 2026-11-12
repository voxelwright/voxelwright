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
pub mod scratch;
pub mod support;
pub mod tree;

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
}

/// One sector's cells as the world stands: the city's rules, then the edits, in order.
pub fn fill(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: &[Edit]) {
    s.start(sx, sy, sz, lod);
    city::make(s);
    for e in edits {
        match e {
            // The edge's lumps are the blast's own: the same wherever it is worked out.
            Edit::Ball { centre, radius, kind: 0 } => s.blast(*centre, *radius, hash::hash(centre[0], centre[2], centre[1] as u32)),
            Edit::Ball { centre, radius, kind } => s.ball(*centre, *radius, *kind, 0, 0, None),
            Edit::Runs(runs) => s.runs(runs),
        }
    }
}

/// One sector of the world as it stands, as a tree.
pub fn sector(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: &[Edit], out: &mut Vec<u32>) -> Whole {
    fill(s, sx, sy, sz, lod, edits);
    tree::encode(&s.cells, out)
}

/// Edits as whole numbers, one after another: 0, x, y, z, radius, kind for a ball; 1, how many rows, then x0, x1, y, z, kind for each.
pub fn read_edits(words: &[i32]) -> Vec<Edit> {
    let (mut out, mut i) = (Vec::new(), 0);
    while i < words.len() {
        if words[i] == 0 {
            out.push(Edit::Ball { centre: [words[i + 1], words[i + 2], words[i + 3]], radius: words[i + 4], kind: words[i + 5] as tree::Kind });
            i += 6;
        } else {
            let n = words[i + 1] as usize;
            out.push(Edit::Runs(words[i + 2..i + 2 + n * 5].chunks_exact(5).map(|r| scratch::Run { x0: r[0], x1: r[1], y: r[2], z: r[3], kind: r[4] as tree::Kind }).collect()));
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
    /// What has come loose and moves, in the one instance that is asked to move it.
    bodies: Option<Box<bodies::Bodies>>,
}

thread_local! {
    static INSTANCE: RefCell<Instance> = RefCell::new(Instance { scratch: Scratch::new(), tree: Vec::new(), edits: Vec::new(), out: [0; 4], bodies: None });
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

/// How big a box round a change is asked what still holds: 16 m across and deep, 22 m tall.
pub const SETTLE: [usize; 3] = [160, 224, 160];
/// How many times over what has landed is asked again whether it holds: a heap took six to come to rest.
pub const ROUNDS: u32 = 8;

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
    INSTANCE.with_borrow_mut(|i| moving(i).list.len())
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
