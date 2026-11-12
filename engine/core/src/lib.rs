//! The engine's core (#140): cells, sectors and the generated city, and later what simulates
//! them. Built once as wasm for the page and the world process, so both get the same answers
//! from the same code; built natively for its own checks.
//!
//! What the outside calls is at the bottom: plain functions over the instance's own memory,
//! no generated glue. An instance does one thing at a time; a page runs one in each worker.

pub mod city;
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
    /// What `settle_round` found, as whole numbers.
    settled: Vec<i32>,
}

thread_local! {
    static INSTANCE: RefCell<Instance> = RefCell::new(Instance { scratch: Scratch::new(), tree: Vec::new(), edits: Vec::new(), out: [0; 4], settled: Vec::new() });
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

/// Lets what is no longer held round a point fall, with the edits given as the world. Returns how many whole numbers
/// tell it, at `settled_words`: how many pieces, how many crumbs were lost, then for each piece its drop, its round,
/// how many cells, its low and high corners, how many rows and how many faces, the rows (x0, x1, y, z, kind) and the
/// faces (two words each, see `support::faces`).
#[unsafe(no_mangle)]
pub extern "C" fn settle_round(x: i32, y: i32, z: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let edits = read_edits(&i.edits);
        // Most of the box is above the point: what a blast undermines is over it.
        let low = [x - SETTLE[0] as i32 / 2, y - 48, z - SETTLE[2] as i32 / 2];
        let mut region = support::Region::gather(low, SETTLE, &edits, &mut i.scratch);
        let done = support::settle(&mut region, ROUNDS);
        let out = &mut i.settled;
        out.clear();
        out.extend_from_slice(&[done.moves.len() as i32, done.dust as i32]);
        for m in &done.moves {
            let faces = support::faces(m);
            out.extend_from_slice(&[m.drop, m.round as i32, m.cells as i32]);
            out.extend_from_slice(&m.low);
            out.extend_from_slice(&m.high);
            out.extend_from_slice(&[m.runs.len() as i32, (faces.len() / 2) as i32]);
            for r in &m.runs {
                out.extend_from_slice(&[r.x0, r.x1, r.y, r.z, r.kind as i32]);
            }
            out.extend(faces.iter().map(|&w| w as i32));
        }
        out.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn settled_words() -> *const i32 {
    INSTANCE.with_borrow(|i| i.settled.as_ptr())
}
