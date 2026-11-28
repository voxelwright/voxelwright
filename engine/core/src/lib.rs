//! The engine's core (#140): cells, sectors and the generated city, and later what simulates
//! them. Built once as wasm for the page and the world process, so both get the same answers
//! from the same code; built natively for its own checks.
//!
//! What the outside calls is at the bottom: plain functions over the instance's own memory,
//! no generated glue. An instance does one thing at a time; a page runs one in each worker.

pub mod ballistics;
pub mod bay;
pub mod beams;
pub mod heroes;
pub mod bodies;
pub mod broadphase;
pub mod city;
pub mod eqs;
pub mod fine;
pub mod fire;
pub mod hash;
pub mod joints;
pub mod kinds;
pub mod land;
pub mod melee;
mod melee_ffi;
pub mod nav;
pub mod perception;
pub mod ragdoll;
pub mod scratch;
pub mod solver;
pub mod sports;
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
    /// Rows of cells finer than the world's (#259, an experiment): x0, x1, y, z count cells of which 4 (the second
    /// number is 2) or 8 (it is 3) lie along one of the world's.
    Fine(Vec<scratch::Run>, u32),
}

/// One sector's cells as the world stands: the city's rules, then the edits, in order.
pub fn fill(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: &[Edit]) {
    fill_of(s, sx, sy, sz, lod, edits.iter());
}

/// As `fill`, of edits picked out by whoever knows which can reach the sector: the order is still theirs.
pub fn fill_of<'a>(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: impl Iterator<Item = &'a Edit>) {
    s.start(sx, sy, sz, lod);
    city::make(s);
    let lumps = scratch::lumps;
    if lod == 0 {
        for e in edits {
            match e {
                Edit::Ball { centre, radius, kind: 0 } => s.blast(*centre, *radius, lumps(centre)),
                Edit::Ball { centre, radius, kind } => s.ball(*centre, *radius, scratch::plain(*kind), 0, 0, None),
                Edit::Runs(runs) | Edit::Rows(runs) => s.runs(runs),
                // A sector that does not take them says so itself (`Scratch::refused`).
                Edit::Fine(runs, shift) => drop(s.fine_runs(runs, *shift)),
            }
        }
        return;
    }
    // A coarser copy: balls and blasts meet its own cells in order, and the rows are laid in the finest cells, a
    // later over an earlier, each ball and blast told to them as it comes; what they came to is put in last
    // (`Scratch::rows`). So a coarse cell shows what the finest copy holds wherever a row has been.
    let mut laid = scratch::Laid::of(s);
    for e in edits {
        match e {
            Edit::Ball { centre, radius, kind: 0 } => {
                s.blast(*centre, *radius, lumps(centre));
                laid.blast(*centre, *radius, lumps(centre));
            }
            Edit::Ball { centre, radius, kind } => {
                s.ball(*centre, *radius, scratch::plain(*kind), 0, 0, None);
                laid.ball(*centre, *radius);
            }
            Edit::Runs(runs) => laid.take(runs, lod >= 2),
            Edit::Rows(runs) => laid.take(runs, false),
            Edit::Fine(runs, shift) => drop(s.fine_runs(runs, *shift)),
        }
    }
    s.rows(&laid.rows());
}

/// One sector of the world as it stands, as a tree.
pub fn sector(s: &mut Scratch, sx: i32, sy: i32, sz: i32, lod: u32, edits: &[Edit], out: &mut Vec<u32>) -> Whole {
    fill(s, sx, sy, sz, lod, edits);
    tree::encode_fine(&s.cells, &s.fine_of, &s.fine, out)
}

/// Edits as whole numbers, one after another: 0, x, y, z, radius, kind for a ball; 1, how many rows, then x0, x1, y, z, kind for each;
/// 2 as 1, for rows that many edits came to; 3 as 1, for rows of cells a quarter the size (x0, x1, y, z in quarter cells); 4 as 3, in cells an eighth the size.
///
/// The numbers come from outside the core (a page, another player): any numbers at all are read without harm. An
/// edit is taken whole or not at all: one that says it has fewer than no rows, or more numbers than there are, is not
/// read, and nor is anything after it, for where the next would begin is not known. Any number but 0, 2, 3 and 4 that
/// begins an edit is read as 1, as it always was. No kind read has the mark of finer cells (kinds.rs `FINE`): that is
/// the core's own to give, so nothing that is told of an edit, the solver included, sees one from outside.
pub fn read_edits(words: &[i32]) -> Vec<Edit> {
    let (mut out, mut i) = (Vec::new(), 0);
    while i < words.len() {
        if words[i] == 0 {
            let Some(w) = words.get(i + 1..i + 6) else { break };
            out.push(Edit::Ball { centre: [w[0], w[1], w[2]], radius: w[3], kind: scratch::plain(w[4] as tree::Kind) });
            i += 6;
        } else {
            let Some(n) = words.get(i + 1).and_then(|&n| usize::try_from(n).ok()) else { break };
            // No more rows than there are numbers left, so this cannot overflow.
            let Some(w) = (n <= (words.len() - i - 2) / 5).then(|| &words[i + 2..i + 2 + n * 5]) else { break };
            let rows = w.chunks_exact(5).map(|r| scratch::Run { x0: r[0], x1: r[1], y: r[2], z: r[3], kind: scratch::plain(r[4] as tree::Kind) }).collect();
            out.push(match words[i] { 2 => Edit::Rows(rows), 3 => Edit::Fine(rows, 2), 4 => Edit::Fine(rows, 3), _ => Edit::Runs(rows) });
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
    /// For `make_finer`: the finer sector's cells, and which sector of the world's own cells the scratch now holds.
    finer: Vec<tree::Kind>,
    finer_of: Option<[i32; 3]>,
    /// Reusable scratch for fine-voxel meshing, RLE, coarsening and procedural vehicle sculpts (#139).
    fine_buf: fine::FineBuf,
    /// Precision 480 Hz sports/tennis physics & deterministic rollback state (#166).
    sports: Option<Box<sports::SportsWorld>>,
    /// Destructible tiled navmesh, HPA* portals, panic flow fields and ORCA/RVO2 crowd avoidance (#164).
    nav: nav::NavWorld,
}

thread_local! {
    static INSTANCE: RefCell<Instance> = RefCell::new(Instance { scratch: Scratch::new(), tree: Vec::new(), edits: Vec::new(), out: [0; 4], merged: Vec::new(), bodies: None, finer: Vec::new(), finer_of: None, fine_buf: fine::FineBuf::new(), sports: None, nav: nav::NavWorld::new() });
}

/// What a cell of a material weighs against water, set from outside while the core runs (#264: a kernel table as
/// data). 0 or less puts back the engine's own. Returns what it weighs now.
#[unsafe(no_mangle)]
pub extern "C" fn material_weighs(material: u32, value: f32) -> f32 {
    kinds::set_weighs((material & 255) as u8, value)
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

/// The edits in the room as one edit of rows that leaves a column of sectors the same in the copy `lod` times
/// coarser when it is put after every ball and blast among them (`scratch::merged`): the column from `x0`, `z0` up
/// to `x1`, `z1` in the finest cells. Returns how many words it is; they are at `merged_words`.
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

/// Whether cells may hold finer cells (#259, the page's `bricks`): not, until told. Where they may not, an edit of
/// tag 3 or 4 changes nothing in any copy, and each sector it is made with counts it in `fine_refused`.
#[unsafe(no_mangle)]
pub extern "C" fn fine_cells(on: u32) {
    INSTANCE.with_borrow_mut(|i| {
        i.scratch.finer = on != 0;
        // The solver's world is told too (#372): a cell that holds finer cells is to it a cell of the kind most of
        // them are (with the mark), so what is made of finer cells is stood on, walked into, looked at and broken as
        // the world's own cells are. Sectors it made before are made again.
        let g = &mut moving(i).ground;
        if g.scratch.finer != (on != 0) {
            g.scratch.finer = on != 0;
            g.forget_all();
        }
    })
}

/// How many edits of finer cells the sector last made by `make_sector` refused whole: the switch is off, or the
/// sector's limits (scratch.rs `FINE_BLOCKS`, `TREE_WORDS`).
#[unsafe(no_mangle)]
pub extern "C" fn fine_refused() -> u32 {
    INSTANCE.with_borrow(|i| i.scratch.refused)
}

/// Makes a sector. Returns how many words its tree is: 0 for all air, 1 for all one kind (that kind is the one word), else the tree. The words are at `tree_words`.
#[unsafe(no_mangle)]
pub extern "C" fn make_sector(sx: i32, sy: i32, sz: i32, lod: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        i.finer_of = None;
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

/// Makes a sector of cells finer than the world's (#259, an experiment): one 2^`fine`-th each way of the sector of the
/// world's own cells it lies in, every cell of that written 2^`fine` times each way. `sx`, `sy`, `sz` count sectors of
/// the finer cells. It holds no more shape than the world's cells do: it is what a finer box round the eye would hold
/// where nothing fine has been made, and so what such a box costs to make, keep and march. No edits are applied.
#[unsafe(no_mangle)]
pub extern "C" fn make_finer(sx: i32, sy: i32, sz: i32, fine: u32) -> usize {
    use tree::{at, SIDE};
    INSTANCE.with_borrow_mut(|i| {
        let parent = [sx >> fine, sy >> fine, sz >> fine];
        if i.finer_of != Some(parent) {
            fill(&mut i.scratch, parent[0], parent[1], parent[2], 0, &[]);
            i.finer_of = Some(parent);
        }
        let part = SIDE >> fine;
        let off = [sx, sy, sz].map(|v| (v & ((1 << fine) - 1)) as usize * part);
        i.finer.resize(tree::CELLS, 0);
        for y in 0..SIDE {
            for z in 0..SIDE {
                for x in 0..SIDE {
                    i.finer[at(x, y, z)] = i.scratch.cells[at(off[0] + (x >> fine), off[1] + (y >> fine), off[2] + (z >> fine))];
                }
            }
        }
        match tree::encode(&i.finer, &mut i.tree) {
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

/// Room for the bytes of a pack of the Bay (#373, bay.rs): write them at the address returned, then `bay_load`.
#[unsafe(no_mangle)]
pub extern "C" fn bay_room(bytes: usize) -> *mut u8 {
    bay::room(bytes)
}

/// Takes the pack in the room: from then on this core's world is the Bay's, not the town's. Returns how many packs
/// it holds, or -1 where the bytes are not a pack. Every core that makes or asks about the same world must hold
/// the same packs.
#[unsafe(no_mangle)]
pub extern "C" fn bay_load() -> i32 {
    bay::load()
}

/// Makes this core's world the Bay's with no pack held yet (bay.rs `begin`): packs then come and go.
#[unsafe(no_mangle)]
pub extern "C" fn bay_begin() {
    bay::begin()
}

/// Takes the road's marks from the street graph in the room (`bay_room`; bay.rs `marks`): every core of a world is told
/// the same before its sectors are made. Returns how many segments it holds, or -1 where the bytes are not marks.
#[unsafe(no_mangle)]
pub extern "C" fn bay_marks() -> i32 {
    bay::marks()
}

/// Takes surveyed kerb polylines from the street graph in the room (`bay_room`; bay.rs `kerbs`): every core of a world
/// is told the same before its sectors are made so sidewalks follow surveyed edges at sub-cell precision. Returns how
/// many polylines it holds, or -1 where the bytes are not kerbs.
#[unsafe(no_mangle)]
pub extern "C" fn bay_kerbs() -> i32 {
    bay::kerbs()
}

/// Lets go of one pack, named by where its ground starts and how far apart its samples are. Returns how many are held.
#[unsafe(no_mangle)]
pub extern "C" fn bay_drop(x0: i32, z0: i32, gstep: i32) -> i32 {
    bay::drop(x0, z0, gstep)
}

/// A landmark stands here (#450, bay.rs `hero`): its rule's sort, where its frame's middle is (x, z, cells), its foot's
/// height (cells) and its turn (millionths of a radian, from x towards z). Every core of a world is told the same,
/// before its sectors are made. 0 where no rule has that sort.
#[unsafe(no_mangle)]
pub extern "C" fn bay_hero(sort: u32, x: i32, z: i32, foot: i32, turn: i32) -> i32 {
    bay::hero(sort, x, z, foot, turn)
}

/// Whether this core makes landmarks as the world's cells (bay.rs `landmarks`): 0 leaves them out.
#[unsafe(no_mangle)]
pub extern "C" fn bay_landmarks(on: i32) {
    bay::landmarks(on != 0)
}

/// The outside faces of a block of a landmark (#423, heroes.rs `faces`) in cells `step` wide, for its far model:
/// returns how many words, which are at `hero_faces_at`.
#[unsafe(no_mangle)]
pub extern "C" fn hero_faces(sort: u32, step: i32, u: i32, y: i32, w: i32, nu: i32, ny: i32, nw: i32) -> usize {
    heroes::faces(sort, step, [u, y, w], [nu, ny, nw])
}

#[unsafe(no_mangle)]
pub extern "C" fn hero_faces_at() -> *const u32 {
    heroes::faces_at()
}

/// One number of the box a landmark keeps within, in its own metres (heroes.rs `reach`): 0 to 2 its low corner
/// (u, y, w), 3 to 5 its high. Not a number where there is no such landmark.
#[unsafe(no_mangle)]
pub extern "C" fn hero_reach(sort: u32, which: usize) -> f32 {
    heroes::reach(sort).and_then(|r| r.get(which).copied()).unwrap_or(f32::NAN)
}

/// One number of a landmark's own light by night (heroes.rs `night`). Not a number where it has none.
#[unsafe(no_mangle)]
pub extern "C" fn hero_night(sort: u32, which: usize) -> f32 {
    heroes::night(sort).and_then(|r| r.get(which).copied()).unwrap_or(f32::NAN)
}

/// Whether a landmark's rule is all there is at (u, w) in its frame, metres (heroes.rs `owns`): 1, or 0.
#[unsafe(no_mangle)]
pub extern "C" fn hero_owns(sort: u32, u: f32, w: f32) -> i32 {
    heroes::owns(sort, u, 0.0, w) as i32
}

/// Only tree faces inside a measured Conservatory palm crown are replaced by its fronds.
#[unsafe(no_mangle)]
pub extern "C" fn hero_owns_tree(sort: u32, u: f32, w: f32) -> i32 {
    (sort == heroes::CONSERVATORY && heroes::valley_palm_return(u, w)) as i32
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

/// What the ground's top is made of at a column by the land's own rule, before anything was done to it: its kind.
/// A question of the rule alone, so it costs what `ground_at` does and makes no sector (`world_kind` makes one).
#[unsafe(no_mangle)]
pub extern "C" fn top_at(x: i32, z: i32) -> u32 {
    city::top(x, z) as u32
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
    // A solver made anew (after `world_forget`) is told what the last was: whether cells may hold finer cells.
    let finer = i.scratch.finer;
    i.bodies.get_or_insert_with(|| {
        let mut b = Box::new(bodies::Bodies::new());
        b.ground.scratch.finer = finer;
        b
    })
}

/// Tells the solver of edits made by someone else (a blast): the edits written at `edits_room`. `after` is how many of
/// the solver's own edits their maker had heard of when it made them, so that everyone applies all edits in one order;
/// under zero puts them last.
#[unsafe(no_mangle)]
pub extern "C" fn world_edit(after: i32) {
    INSTANCE.with_borrow_mut(|i| {
        let edits = read_edits(&i.edits);
        for e in &edits {
            let (lo, hi) = bodies::reach(e);
            i.nav.mark_dirty_box(lo, hi);
        }
        let b = moving(i);
        for e in edits {
            // Whatever sleeps where the world has changed is stepped again, and sleeps again if nothing reached it.
            let (lo, hi) = bodies::reach(&e);
            b.wake_in_aabb(lo.map(|v| v as f32 - 2.0), hi.map(|v| v as f32 + 2.0));
            b.stir_edit(&e);
            b.ground.push(e, false, if after < 0 { None } else { Some(after as usize) });
        }
        b.invalidate_joint_world_anchors();
        let n_edits = b.ground.edits.len();
        i.nav.seen_edits = n_edits;
    })
}

/// Has the solver make again what it kept of the world's cells in a box of columns (#526): a pack of the Bay came there
/// after it was asked about. Nothing done to the world is forgotten.
#[unsafe(no_mangle)]
pub extern "C" fn world_regrow(x0: i32, z0: i32, x1: i32, z1: i32) {
    INSTANCE.with_borrow_mut(|i| {
        i.nav.mark_dirty_box([x0, i32::MIN / 2, z0], [x1, i32::MAX / 2, z1]);
        moving(i).ground.forget_columns(x0, z0, x1, z1);
    })
}

/// Forgets everything done to the world and everything that moves in it: the instance is as it began. For a page that
/// leaves one world for another (#264): the other's edits are then told with `world_edit`.
#[unsafe(no_mangle)]
pub extern "C" fn world_forget() {
    INSTANCE.with_borrow_mut(|i| {
        i.bodies = None;
        i.nav.reset();
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
        let edits_before = b.ground.edits.len();
        b.out.clear();
        b.blast([x, y, z], radius, if after < 0 { None } else { Some(after as usize) }, spark != 0);
        let out_len = b.out.len();
        let extra: Vec<_> = b.ground.edits[edits_before..].iter().map(bodies::reach).collect();
        let n_edits = b.ground.edits.len();
        let far = radius.saturating_mul(3).saturating_add(2);
        i.nav.mark_dirty_box(
            [x.saturating_sub(far), y.saturating_sub(far), z.saturating_sub(far)],
            [x.saturating_add(far).saturating_add(1), y.saturating_add(far).saturating_add(1), z.saturating_add(far).saturating_add(1)],
        );
        for (lo, hi) in extra {
            i.nav.mark_dirty_box(lo, hi);
        }
        i.nav.seen_edits = n_edits;
        out_len
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

/// Top solid cell + 1 at or below `y` within `depth` cells (edits and all), or `i32::MIN` if none.
#[unsafe(no_mangle)]
pub extern "C" fn world_under(x: i32, y: i32, z: i32, depth: i32) -> i32 {
    INSTANCE.with_borrow_mut(|i| moving(i).ground.under(x, y, z, depth))
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

/// Extra driving state for a living vehicle (#28): nitrous boost (`> 0.5`), rain wetness (`0..1`), and optional
/// explicit surface grip override (`<= 0` uses `city::top`). Keeps `living_drive`'s ABI unchanged. Returns 1 if found.
#[unsafe(no_mangle)]
pub extern "C" fn living_drive_aux(id: u32, boost: f32, wetness: f32, surface_grip: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).drive_aux(id, boost, wetness, surface_grip) as u32)
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

/// Makes someone's body (bodies/living.rs `figure`): a box so wide, tall and deep with its low corner at a place.
/// Returns how many words tell it, at `bodies_words`; `living_last` is its id. Give it a motor with `living_motor`.
#[unsafe(no_mangle)]
pub extern "C" fn living_figure(x: i32, y: i32, z: i32, wide: u32, tall: u32, deep: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.figure([wide as usize, tall as usize, deep as usize], [x, y, z]);
        b.out.len()
    })
}

/// Tells what goes on legs how to go: the way it faces (radians: its front at cos, 0, sin), forward and to its
/// right from -1 to 1, up and down for what flies, and whether to jump. Held for a second. Returns 1 if it is there.
#[unsafe(no_mangle)]
pub extern "C" fn living_walk(id: u32, heading: f32, go: f32, side: f32, rise: f32, jump: i32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).walk(id, heading, go, side, rise, jump != 0) as u32)
}

/// Takes a living thing out of the world at once, leaving nothing. Returns how many words tell it, at `bodies_words`.
#[unsafe(no_mangle)]
pub extern "C" fn living_vanish(id: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.vanish(id);
        b.out.len()
    })
}

/// How a living thing falls (1 as everything does, less slowly, 0 not at all) and how high a wall it climbs when
/// told to go on against it (cells; none for steps only). Returns 1 if it is there.
#[unsafe(no_mangle)]
pub extern "C" fn living_ways(id: u32, fall: f32, climb: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).ways(id, fall, climb) as u32)
}

/// Makes a ghost (bodies/living.rs `ghost`): a box for a body that is moved elsewhere, so that what flies and falls
/// meets it. Returns its id, 0 if it could not be made. Put it where that body is with `living_place`.
#[unsafe(no_mangle)]
pub extern "C" fn living_ghost(x: i32, y: i32, z: i32, wide: u32, tall: u32, deep: u32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).ghost([wide as usize, tall as usize, deep as usize], [x, y, z]))
}

/// A push on a living thing: so much speed added to it at once (cells a second). Returns 1 if it is there.
#[unsafe(no_mangle)]
pub extern "C" fn living_kick(id: u32, vx: f32, vy: f32, vz: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).kick(id, [vx, vy, vz]) as u32)
}

/// Marks a loose body as one that passes: come to rest it is gone and leaves no cells (a shot, not litter). Its
/// pieces pass too. Returns 1 if there is such a body.
#[unsafe(no_mangle)]
pub extern "C" fn bodies_passing(id: u32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).list.iter_mut().find(|b| b.id == id).map(|b| b.passing = true).is_some() as u32)
}

// ── Systemic body carving, environment, joints, ragdolls, ballistics, shockwaves & beams (#166) ──

/// Carves a world-space sphere out of dynamic body `body_id`, updating or splitting it in place.
/// Returns the number of output record words at `bodies_words` (`DUST`, `BROKE`, `BORN`/`GONE`).
#[unsafe(no_mangle)]
pub extern "C" fn bodies_carve_sphere(body_id: u32, x: f32, y: f32, z: f32, r: f32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.carve_sphere(body_id, [x, y, z], r);
        b.out.len()
    })
}

/// Carves a world-space swept capsule out of dynamic body `body_id`. Returns the `bodies_words` word count.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn bodies_carve_capsule(
    body_id: u32,
    ax: f32,
    ay: f32,
    az: f32,
    bx: f32,
    by: f32,
    bz: f32,
    r: f32,
) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.carve_capsule(body_id, [ax, ay, az], [bx, by, bz], r);
        b.out.len()
    })
}

/// Slices dynamic body `body_id` along a world-space plane of kerf `thick`. Returns the `bodies_words` word count.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn bodies_carve_plane(
    body_id: u32,
    px: f32,
    py: f32,
    pz: f32,
    nx: f32,
    ny: f32,
    nz: f32,
    thick: f32,
) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.out.clear();
        b.carve_plane(body_id, [px, py, pz], [nx, ny, nz], thick);
        b.out.len()
    })
}

/// Configures global sea plane (`sea_on != 0` sets sea level to `sea_y`) and rain intensity (`0..=1`).
#[unsafe(no_mangle)]
pub extern "C" fn bodies_set_env(sea_on: i32, sea_y: f32, rain: f32) {
    INSTANCE.with_borrow_mut(|i| {
        moving(i).set_env(if sea_on != 0 { Some(sea_y) } else { None }, rain);
    });
}

/// Adds a 1-DOF revolute hinge between bodies `a` and `b` (`0` = static world) at world pivot `(px, py, pz)`
/// along world axis `(ax, ay, az)`, anchored to world cell `(wx, wy, wz)` when one side is static (`i32::MIN` = free).
/// Returns the non-zero joint ID, or `0` if an endpoint body was not found.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn joints_add_hinge(
    a: u32,
    b: u32,
    px: f32,
    py: f32,
    pz: f32,
    ax: f32,
    ay: f32,
    az: f32,
    wx: i32,
    wy: i32,
    wz: i32,
) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).add_hinge(a, b, [px, py, pz], [ax, ay, az], [wx, wy, wz]))
}

/// Adds a unilateral rope/cable between `a` and `b` (`0` = static world) from world `(ax, ay, az)` to
/// `(bx, by, bz)` with taut length `max_len` and optional `break_force` (`<= 0` = unbreakable). Returns joint ID or `0`.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn joints_add_rope(
    a: u32,
    b: u32,
    ax: f32,
    ay: f32,
    az: f32,
    bx: f32,
    by: f32,
    bz: f32,
    max_len: f32,
    break_force: f32,
) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).add_rope(a, b, [ax, ay, az], [bx, by, bz], max_len, break_force))
}

/// Sets the winch reel speed (cells/s; positive reels in, negative pays out) on a distance/rope joint. Returns 1 if set.
#[unsafe(no_mangle)]
pub extern "C" fn joints_set_winch(joint_id: u32, speed: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).set_winch(joint_id, speed) as u32)
}

/// Returns the number of currently active (unbroken) joints.
#[unsafe(no_mangle)]
pub extern "C" fn joints_count() -> usize {
    INSTANCE.with_borrow(|i| i.bodies.as_ref().map_or(0, |b| b.joints.active_count()))
}

/// Spawns a standing 13-bone active ragdoll with feet at `(x, y, z)`. Returns its non-zero ID.
#[unsafe(no_mangle)]
pub extern "C" fn ragdoll_spawn(x: f32, y: f32, z: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).ragdoll_spawn([x, y, z], 0.0))
}

/// Applies an impact impulse `(ix, iy, iz)` (`kg * cells/s`) and optional `cut_energy` (`> 0` enables Tier-A severing)
/// to bone index `bone` (`0..13`) of ragdoll `id`. Returns 1 if applied.
#[unsafe(no_mangle)]
pub extern "C" fn ragdoll_hit(id: u32, bone: u32, ix: f32, iy: f32, iz: f32, cut_energy: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).ragdoll_hit(id, bone, [ix, iy, iz], cut_energy) as u32)
}

/// Returns the number of active ragdolls.
#[unsafe(no_mangle)]
pub extern "C" fn ragdoll_count() -> usize {
    INSTANCE.with_borrow(|i| i.bodies.as_ref().map_or(0, |b| b.ragdolls.len()))
}

/// Fires a ballistic projectile of `caliber` (`0` = 9mm, `1` = 5.56mm, `2` = .50 cal, `3` = Shrapnel, `4` = Rocket)
/// from `(ox, oy, oz)` along `(dx, dy, dz)`. Returns its projectile ID.
#[unsafe(no_mangle)]
pub extern "C" fn ballistics_fire(caliber: u32, ox: f32, oy: f32, oz: f32, dx: f32, dy: f32, dz: f32) -> u32 {
    let cal = match caliber {
        0 => ballistics::Caliber::Pistol9mm,
        1 => ballistics::Caliber::Rifle556,
        2 => ballistics::Caliber::Heavy50Cal,
        3 => ballistics::Caliber::Shrapnel,
        4 => ballistics::Caliber::Rocket,
        _ => ballistics::Caliber::Rifle556,
    };
    INSTANCE.with_borrow_mut(|i| moving(i).ballistics_fire(cal, [ox, oy, oz], [dx, dy, dz]))
}

/// Spawns an occluded delayed blast shockwave and directional shrapnel at `(x, y, z)`.
/// Returns the number of active shockwaves.
#[unsafe(no_mangle)]
pub extern "C" fn shockwave_blast(x: f32, y: f32, z: f32, radius: f32, pressure: f32, shrapnel: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).shockwave_blast([x, y, z], radius, pressure, shrapnel))
}

/// Fires a continuous multi-bounce thermal laser/beam from `(ox, oy, oz)` along `(dx, dy, dz)` with `power` for `dt` s.
/// Returns the number of traced beam segments.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn beams_fire(
    ox: f32,
    oy: f32,
    oz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    power: f32,
    dt: f32,
) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).beams_fire([ox, oy, oz], [dx, dy, dz], power, dt))
}

/// Which way is down for a living thing (a way; all zero for the world's own), and whether it clings: walked at a
/// wall its down turns into the wall, and over an edge it turns again. Returns 1 if it is there.
#[unsafe(no_mangle)]
pub extern "C" fn living_down(id: u32, dx: f32, dy: f32, dz: f32, cling: i32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).down(id, [dx, dy, dz], cling != 0) as u32)
}

// ── Fine-voxel geometry, RLE and vehicle sculptors (fine.rs, #139) ──────────

#[unsafe(no_mangle)]
pub extern "C" fn fine_cells_room(n: usize) -> *mut u16 {
    INSTANCE.with_borrow_mut(|i| {
        i.fine_buf.cells.resize(n, 0);
        i.fine_buf.cells.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_cells_ptr() -> *const u16 {
    INSTANCE.with_borrow(|i| i.fine_buf.cells.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_out_cells_ptr() -> *const u16 {
    INSTANCE.with_borrow(|i| i.fine_buf.out_cells.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_bytes_room(n: usize) -> *mut u8 {
    INSTANCE.with_borrow_mut(|i| {
        i.fine_buf.bytes.resize(n, 0);
        i.fine_buf.bytes.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_bytes_ptr() -> *const u8 {
    INSTANCE.with_borrow(|i| i.fine_buf.bytes.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_bytes_len() -> usize {
    INSTANCE.with_borrow(|i| i.fine_buf.bytes.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_palette_room(n: usize) -> *mut u16 {
    INSTANCE.with_borrow_mut(|i| {
        i.fine_buf.palette.resize(n, 0);
        i.fine_buf.palette.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_palette_ptr() -> *const u16 {
    INSTANCE.with_borrow(|i| i.fine_buf.palette.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_palette_len() -> usize {
    INSTANCE.with_borrow(|i| i.fine_buf.palette.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_params_room(n: usize) -> *mut f64 {
    INSTANCE.with_borrow_mut(|i| {
        i.fine_buf.params.resize(n, 0.0);
        i.fine_buf.params.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_faces_ptr() -> *const u32 {
    INSTANCE.with_borrow(|i| i.fine_buf.faces.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_smooth_ptr() -> *const u32 {
    INSTANCE.with_borrow(|i| i.fine_buf.smooth.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_filled() -> usize {
    INSTANCE.with_borrow(|i| i.fine_buf.filled)
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_swap_out_to_cells() {
    INSTANCE.with_borrow_mut(|i| {
        std::mem::swap(&mut i.fine_buf.cells, &mut i.fine_buf.out_cells);
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_unrun_b64(n: usize) -> i32 {
    INSTANCE.with_borrow_mut(|i| fine::unrun_b64(&mut i.fine_buf, n))
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_encode_runs(n: usize, from_out: u32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let fb = &mut i.fine_buf;
        let src = if from_out != 0 {
            &fb.out_cells[..n.min(fb.out_cells.len())]
        } else {
            &fb.cells[..n.min(fb.cells.len())]
        };
        fine::encode_runs(src, &mut fb.palette, &mut fb.raw_bytes, &mut fb.bytes);
        fb.bytes.len()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_faces(w: usize, h: usize, d: usize) -> usize {
    INSTANCE.with_borrow_mut(|i| fine::faces_square(&mut i.fine_buf, w, h, d))
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_faces_smooth(w: usize, h: usize, d: usize, reach: usize) -> usize {
    INSTANCE.with_borrow_mut(|i| fine::faces_with_smooth(&mut i.fine_buf, w, h, d, reach))
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_coarser(w: usize, h: usize, d: usize, by: usize) -> usize {
    INSTANCE.with_borrow_mut(|i| fine::coarser(&mut i.fine_buf, w, h, d, by))
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_sculpt_coupe() -> usize {
    INSTANCE.with_borrow_mut(|i| fine::sculpt_coupe(&mut i.fine_buf))
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_sculpt_kart(paint: u32, per: f64) -> usize {
    INSTANCE.with_borrow_mut(|i| fine::sculpt_kart(&mut i.fine_buf, paint as u16, per))
}

#[unsafe(no_mangle)]
pub extern "C" fn fine_sculpt_ojai() -> usize {
    INSTANCE.with_borrow_mut(|i| fine::sculpt_ojai(&mut i.fine_buf))
}

// ── Precision 480 Hz sports physics & deterministic rollback (sports.rs, #166) ──

fn sports_world(i: &mut Instance) -> &mut sports::SportsWorld {
    i.sports.get_or_insert_with(|| Box::new(sports::SportsWorld::new()))
}

/// Clears all active sports balls, queued racket swings, and resets the sports tick counter to 0.
#[unsafe(no_mangle)]
pub extern "C" fn sports_reset() {
    INSTANCE.with_borrow_mut(|i| sports_world(i).reset());
}

/// Configures the sports court surface (`0` = Hard, `1` = Clay, `2` = Grass) and optional analytical
/// ITF court plane at `ground_y` with regulation net at `net_z` (`enabled != 0`).
#[unsafe(no_mangle)]
pub extern "C" fn sports_set_court(surface: u32, ground_y: f32, net_z: f32, enabled: u32) {
    INSTANCE.with_borrow_mut(|i| {
        sports_world(i).set_court(sports::CourtSurface::from_u32(surface), ground_y, net_z, enabled != 0);
    });
}

/// Spawns a regulation tennis ball at `(x, y, z)` cells with velocity `(vx, vy, vz)` cells/s and
/// spin `(wx, wy, wz)` rad/s. Returns its non-zero id.
#[unsafe(no_mangle)]
pub extern "C" fn sports_spawn(
    x: f32,
    y: f32,
    z: f32,
    vx: f32,
    vy: f32,
    vz: f32,
    wx: f32,
    wy: f32,
    wz: f32,
) -> u32 {
    INSTANCE.with_borrow_mut(|i| sports_world(i).spawn([x, y, z], [vx, vy, vz], [wx, wy, wz]))
}

/// Removes a sports ball by id. Returns 1 if removed, 0 if not found.
#[unsafe(no_mangle)]
pub extern "C" fn sports_remove(id: u32) -> u32 {
    INSTANCE.with_borrow_mut(|i| sports_world(i).remove(id) as u32)
}

/// Number of currently active sports balls.
#[unsafe(no_mangle)]
pub extern "C" fn sports_count() -> usize {
    INSTANCE.with_borrow(|i| i.sports.as_ref().map_or(0, |s| s.count()))
}

/// Queues a swept elliptic racket motion (`prev` -> `curr` pose in cells + unit quaternion)
/// for the next `sports_step` tick.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn sports_racket_swing(
    p0x: f32,
    p0y: f32,
    p0z: f32,
    q0x: f32,
    q0y: f32,
    q0z: f32,
    q0w: f32,
    p1x: f32,
    p1y: f32,
    p1z: f32,
    q1x: f32,
    q1y: f32,
    q1z: f32,
    q1w: f32,
) {
    INSTANCE.with_borrow_mut(|i| {
        let prev = sports::RacketPose::new([p0x, p0y, p0z], [q0x, q0y, q0z, q0w]);
        let curr = sports::RacketPose::new([p1x, p1y, p1z], [q1x, q1y, q1z, q1w]);
        sports_world(i).queue_racket(sports::RacketSwing::new(prev, curr));
    });
}

/// Advances all active sports balls by `ticks` fixed `1/120 s` ticks (`4` × 480 Hz substeps each).
/// When `use_world != 0`, swept-sphere CCD also collides against the solver's 10 cm voxel world
/// with coplanar face normal welding. Returns the new simulation tick.
#[unsafe(no_mangle)]
pub extern "C" fn sports_step(ticks: u32, use_world: u32) -> u32 {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let sw = i.sports.get_or_insert_with(|| Box::new(sports::SportsWorld::new()));
        if use_world != 0 {
            let b = i.bodies.get_or_insert_with(|| {
                let mut b = Box::new(bodies::Bodies::new());
                b.ground.scratch.finer = finer;
                b
            });
            sw.step(ticks, true, |[x, y, z]| b.ground.kind(x, y, z) != 0)
        } else {
            sw.step(ticks, false, |_| false)
        }
    })
}

/// Writes `[px, py, pz, vx, vy, vz, wx, wy, wz]` (9 `f32` values) for ball `id` and returns its
/// pointer in linear memory, or null if not found.
#[unsafe(no_mangle)]
pub extern "C" fn sports_ball_read(id: u32) -> *const f32 {
    INSTANCE.with_borrow_mut(|i| sports_world(i).read_ball(id).unwrap_or(core::ptr::null()))
}

/// Encodes ball `id`'s current state into a compact 32-byte deterministic wire snapshot and
/// returns its pointer in linear memory, or null if not found.
#[unsafe(no_mangle)]
pub extern "C" fn sports_snapshot_write(id: u32) -> *const u8 {
    INSTANCE.with_borrow_mut(|i| sports_world(i).write_snapshot(id).unwrap_or(core::ptr::null()))
}

/// Returns a mutable pointer to the 32-byte snapshot buffer for writing an incoming server
/// snapshot before calling `sports_rollback`.
#[unsafe(no_mangle)]
pub extern "C" fn sports_snapshot_room() -> *mut u8 {
    INSTANCE.with_borrow_mut(|i| sports_world(i).snap_buf.as_mut_ptr())
}

/// Reconciles ball `id` against the 32-byte authoritative snapshot written at `sports_snapshot_room`.
/// Returns `0` if matched, `> 0` for the number of replayed ticks after rewind, or `-1` if the
/// ball is missing or the server tick lies outside the rollback window.
#[unsafe(no_mangle)]
pub extern "C" fn sports_rollback(id: u32, use_world: u32) -> i32 {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let sw = i.sports.get_or_insert_with(|| Box::new(sports::SportsWorld::new()));
        if use_world != 0 {
            let b = i.bodies.get_or_insert_with(|| {
                let mut b = Box::new(bodies::Bodies::new());
                b.ground.scratch.finer = finer;
                b
            });
            sw.rollback_from_buf(id, true, |[x, y, z]| b.ground.kind(x, y, z) != 0)
        } else {
            sw.rollback_from_buf(id, false, |_| false)
        }
    })
}

// ── Destructible tiled navmesh, HPA* portals, panic flow fields & ORCA/RVO2 crowd avoidance (nav/, #164) ──

/// Clears all cached nav tiles, portals, dirty queue, panic flow field, path output and crowd slots.
#[unsafe(no_mangle)]
pub extern "C" fn nav_reset() {
    INSTANCE.with_borrow_mut(|i| i.nav.reset())
}

/// Marks nav tiles intersecting `[x0..x1) × [z0..z1)` (fine cells, plus a 1-tile portal margin) dirty.
#[unsafe(no_mangle)]
pub extern "C" fn nav_mark_dirty(x0: i32, z0: i32, x1: i32, z1: i32) {
    INSTANCE.with_borrow_mut(|i| i.nav.mark_dirty_box([x0, i32::MIN / 2, z0], [x1, i32::MAX / 2, z1]))
}

/// Number of nav tiles currently queued for incremental rebake.
#[unsafe(no_mangle)]
pub extern "C" fn nav_dirty_count() -> usize {
    INSTANCE.with_borrow(|i| i.nav.cache.dirty_count())
}

/// Number of nav tiles currently held in the tile cache.
#[unsafe(no_mangle)]
pub extern "C" fn nav_tile_count() -> usize {
    INSTANCE.with_borrow(|i| i.nav.cache.tile_count())
}

/// Number of walkable spans inside cached nav tile `(tx, tz)`, or `0` if not baked.
#[unsafe(no_mangle)]
pub extern "C" fn nav_tile_spans(tx: i32, tz: i32) -> usize {
    INSTANCE.with_borrow(|i| i.nav.cache.get((tx, tz)).map_or(0, |t| t.spans.len()))
}

/// Number of cross-tile portals attached to cached nav tile `(tx, tz)`, or `0` if not baked.
#[unsafe(no_mangle)]
pub extern "C" fn nav_tile_portals(tx: i32, tz: i32) -> usize {
    INSTANCE.with_borrow(|i| i.nav.cache.get((tx, tz)).map_or(0, |t| t.portals.len()))
}

/// Sorts dirty nav tiles by squared distance to `(fx, fz)` (fine cells) and incrementally rebakes
/// up to `max_tiles` nearest dirty tiles. Returns the number of tiles rebaked.
#[unsafe(no_mangle)]
pub extern "C" fn nav_rebake_budget(fx: f32, fz: f32, max_tiles: usize) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.rebake_budget(&mut bodies.ground, fx, fz, max_tiles)
    })
}

/// Ensures nav tiles within `radius_tiles` around `(fx, fz)` are baked (up to `max_tiles`, nearest-first).
#[unsafe(no_mangle)]
pub extern "C" fn nav_bake_area(fx: f32, fz: f32, radius_tiles: i32, max_tiles: usize) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.bake_area(&mut bodies.ground, fx, fz, radius_tiles, max_tiles)
    })
}

/// Finds a smoothed multi-layer HPA* path from `(sx, sy, sz)` to `(gx, gy, gz)` (fine cells) under
/// capability `flags` (0 = walk+vault+drop; bit 0 vault, bit 1 drop, bit 2 climb, bit 3 walk-only).
/// Stores `[x, y, z, move_kind]` floats in the path buffer (`nav_path_ptr`, `nav_path_len`) and
/// returns the waypoint count (`0` if unreachable).
#[unsafe(no_mangle)]
pub extern "C" fn nav_find_path(
    sx: f32,
    sy: f32,
    sz: f32,
    gx: f32,
    gy: f32,
    gz: f32,
    flags: u32,
) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.find_path(&mut bodies.ground, sx, sy, sz, gx, gy, gz, flags)
    })
}

/// Pointer to the reusable `[x, y, z, move_kind]` f32 waypoint buffer (`nav_path_len() * 4` floats).
#[unsafe(no_mangle)]
pub extern "C" fn nav_path_ptr() -> *const f32 {
    INSTANCE.with_borrow(|i| i.nav.path_out.as_ptr())
}

/// Number of waypoints produced by the last `nav_find_path` call.
#[unsafe(no_mangle)]
pub extern "C" fn nav_path_len() -> usize {
    INSTANCE.with_borrow(|i| i.nav.path_out.len() / 4)
}

/// Clears all panic flow-field threats and resets the field.
#[unsafe(no_mangle)]
pub extern "C" fn nav_flow_clear() {
    INSTANCE.with_borrow_mut(|i| i.nav.flow.clear())
}

/// Registers a threat source `(x, y, z, radius)` in fine cells for the panic flow field.
#[unsafe(no_mangle)]
pub extern "C" fn nav_flow_add_threat(x: f32, y: f32, z: f32, radius: f32) {
    INSTANCE.with_borrow_mut(|i| i.nav.flow.add_threat(x, y, z, radius))
}

/// Builds the escape vector field over walkable spans within all registered threat radii.
/// Returns the number of walkable spans with an active escape vector.
#[unsafe(no_mangle)]
pub extern "C" fn nav_flow_build() -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.flow_build(&mut bodies.ground)
    })
}

/// Samples the panic escape vector `(dx, dz)` at `(x, y, z)` in O(1), writing `[dx, dz]` to
/// `nav_flow_vec_ptr()`. Returns `1` if inside the escape field, `0` if safe/outside.
#[unsafe(no_mangle)]
pub extern "C" fn nav_flow_sample(x: f32, y: f32, z: f32) -> i32 {
    INSTANCE.with_borrow_mut(|i| i.nav.flow_sample(x, y, z))
}

/// Pointer to the 2-float `[dx, dz]` unit escape vector from the last `nav_flow_sample` call.
#[unsafe(no_mangle)]
pub extern "C" fn nav_flow_vec_ptr() -> *const f32 {
    INSTANCE.with_borrow(|i| i.nav.flow.last_vec.as_ptr())
}

/// Resets all ORCA/RVO2 crowd agent slots and explicit 2D obstacle segments.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_reset() {
    INSTANCE.with_borrow_mut(|i| i.nav.crowd.reset())
}

/// Pointer to the contiguous SoA crowd buffer (`10 * 512` f32s: `pos_x, pos_z, pos_y, vel_x,
/// vel_z, pref_vx, pref_vz, radius, max_speed, flags`, each plane stride `512`).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_agents_ptr() -> *mut f32 {
    INSTANCE.with_borrow_mut(|i| i.nav.crowd.agents_ptr())
}

/// Maximum number of active agents supported in the SoA crowd buffer (`512`).
#[unsafe(no_mangle)]
pub extern "C" fn crowd_capacity() -> usize {
    nav::rvo::MAX_AGENTS
}

/// Writes one agent slot in the SoA crowd buffer.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_set_agent(
    idx: usize,
    x: f32,
    y: f32,
    z: f32,
    vx: f32,
    vz: f32,
    pref_vx: f32,
    pref_vz: f32,
    radius: f32,
    max_speed: f32,
    flags: u32,
) {
    INSTANCE.with_borrow_mut(|i| {
        i.nav.crowd.set_agent(idx, x, y, z, vx, vz, pref_vx, pref_vz, radius, max_speed, flags)
    })
}

/// Clears explicit 2D static wall segments in the ORCA/RVO2 crowd solver.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_clear_obstacles() {
    INSTANCE.with_borrow_mut(|i| i.nav.crowd.clear_obstacles())
}

/// Adds a 2D static obstacle wall segment `(x0, z0) -> (x1, z1)` to the ORCA/RVO2 crowd solver.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_add_obstacle(x0: f32, z0: f32, x1: f32, z1: f32) {
    INSTANCE.with_borrow_mut(|i| i.nav.crowd.add_obstacle(x0, z0, x1, z1))
}

/// Runs one ORCA/RVO2 avoidance step over agents `0..count.min(512)` with time step `dt` and
/// lookahead `time_horizon`. Updates `vel_x, vel_z` and integrates `pos_x, pos_z` (unless flagged
/// static or velocity-only). Returns the number of agents stepped.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_step(count: usize, dt: f32, time_horizon: f32) -> usize {
    INSTANCE.with_borrow_mut(|i| i.nav.crowd_step(count, dt, time_horizon))
}

// ── EQS-Lite spatial queries & spatial visual/acoustic perception (eqs.rs, perception.rs, #164) ──

/// Pointer to the reusable `[x, y, z, score]` f32 output buffer (`eqs_results_len() * 4` floats).
#[unsafe(no_mangle)]
pub extern "C" fn eqs_results_ptr() -> *const f32 {
    eqs::results_ptr()
}

/// Number of ranked candidates produced by the last `eqs_find_*` query (`0..=32`).
#[unsafe(no_mangle)]
pub extern "C" fn eqs_results_len() -> usize {
    eqs::results_len()
}

/// Finds up to 32 scored cover positions within `radius` cells of `(ox, oy, oz)` occluded from
/// threat `(tx, ty, tz)`. Returns the number of results written to `eqs_results_ptr()`.
#[unsafe(no_mangle)]
pub extern "C" fn eqs_find_cover(
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    radius: f32,
) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.sync_edits(&bodies.ground);
        eqs::query_cover(&mut i.nav.cache, &mut bodies.ground, ox, oy, oz, tx, ty, tz, radius)
    })
}

/// Finds up to 32 scored rain-shelter positions within `radius` cells of `(ox, oy, oz)` with a
/// solid overhead roof/awning `18..=60` cells above the floor. Returns result count at `eqs_results_ptr()`.
#[unsafe(no_mangle)]
pub extern "C" fn eqs_find_shelter(ox: f32, oy: f32, oz: f32, radius: f32) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.sync_edits(&bodies.ground);
        eqs::query_shelter(&mut i.nav.cache, &mut bodies.ground, ox, oy, oz, radius)
    })
}

/// Finds up to 32 scored vantage positions within `[min_range, max_range]` cells of `(tx, ty, tz)`
/// with clear eye-to-head/chest LOS. Returns result count at `eqs_results_ptr()`.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn eqs_find_vantage(
    ox: f32,
    oy: f32,
    oz: f32,
    tx: f32,
    ty: f32,
    tz: f32,
    min_range: f32,
    max_range: f32,
) -> usize {
    INSTANCE.with_borrow_mut(|i| {
        let finer = i.scratch.finer;
        let bodies = i.bodies.get_or_insert_with(|| {
            let mut b = Box::new(bodies::Bodies::new());
            b.ground.scratch.finer = finer;
            b
        });
        i.nav.sync_edits(&bodies.ground);
        eqs::query_vantage(
            &mut i.nav.cache,
            &mut bodies.ground,
            ox,
            oy,
            oz,
            tx,
            ty,
            tz,
            min_range,
            max_range,
        )
    })
}

/// Fast 3D Amanatides-Woo DDA voxel line-of-sight check between `(ax, ay, az)` and `(bx, by, bz)`.
/// Treats air (`0`), water (`5`), and glass (`11`) as transparent (`kind & 15`). Returns `1` if clear, `0` if blocked.
#[unsafe(no_mangle)]
pub extern "C" fn perception_los(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32) -> i32 {
    INSTANCE.with_borrow_mut(|i| {
        perception::has_los(&mut moving(i).ground, [ax, ay, az], [bx, by, bz]) as i32
    })
}

/// Acoustic attenuation (`0.0..=1.0` remaining salience) from `(ax, ay, az)` to `(bx, by, bz)`
/// within `max_radius` cells, combining `(1 - d/R)^1.5` falloff and per-material voxel absorption.
#[unsafe(no_mangle)]
pub extern "C" fn perception_acoustic_attenuation(
    ax: f32,
    ay: f32,
    az: f32,
    bx: f32,
    by: f32,
    bz: f32,
    max_radius: f32,
) -> f32 {
    INSTANCE.with_borrow_mut(|i| {
        perception::acoustic_attenuation(&mut moving(i).ground, [ax, ay, az], [bx, by, bz], max_radius)
    })
}

/// Resets the batch spatial vision SoA agent slots and pair output buffer.
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_reset() {
    perception::vision_reset();
}

/// Maximum number of agents supported by batch spatial vision (`256`).
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_capacity() -> usize {
    perception::VISION_MAX_AGENTS
}

/// Pointer to the contiguous SoA batch vision input buffer (`6 * 256` f32s: `x, y, z, yaw, lod_ring, flags`).
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_agents_ptr() -> *mut f32 {
    perception::vision_agents_ptr()
}

/// Writes one agent slot in the batch spatial vision SoA buffer.
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_set_agent(
    idx: usize,
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
    lod_ring: f32,
    flags: u32,
) {
    perception::vision_set_agent(idx, x, y, z, yaw, lod_ring, flags);
}

/// Executes one batch spatial vision pass over `0..count.min(256)` agents within `range` cells.
/// Writes directed `(observer_idx, target_idx)` `u32` pairs to `perception_vision_pairs_ptr()` and returns pair count.
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_step(count: usize, range: f32) -> usize {
    INSTANCE.with_borrow_mut(|i| perception::vision_step(&mut moving(i).ground, count, range))
}

/// Pointer to the `[obs_0, tgt_0, ...]` `u32` pair buffer produced by the last `perception_vision_step`.
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_pairs_ptr() -> *const u32 {
    perception::vision_pairs_ptr()
}

/// Number of directed visibility pairs produced by the last `perception_vision_step`.
#[unsafe(no_mangle)]
pub extern "C" fn perception_vision_pairs_len() -> usize {
    perception::vision_pairs_len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kinds::FINE;
    use crate::scratch::{FINE_BLOCKS, Run, TREE_WORDS};
    use crate::tree::{CELLS, Kind, SIDE, at};

    /// A sector made of edits as a page sends them, with cells allowed to hold finer cells.
    fn made(words: &[i32], sx: i32, sy: i32, sz: i32, lod: u32) -> (Scratch, Vec<u32>, Whole) {
        let (mut s, mut tree) = (Scratch::new(), Vec::new());
        s.finer = true;
        let whole = sector(&mut s, sx, sy, sz, lod, &read_edits(words), &mut tree);
        (s, tree, whole)
    }

    /// What must hold of any sector made of any edits: a cell has the mark only with a block of its own that is
    /// neither empty nor all one kind, the limits hold, and the tree is sound and says the same.
    fn sane(s: &Scratch, tree: &[u32], whole: Whole) {
        let marked: Vec<usize> = (0..CELLS).filter(|&i| s.cells[i] & FINE != 0).collect();
        assert!(s.lod == 0 && s.finer || marked.is_empty(), "a mark where no cell may hold finer cells");
        assert!(marked.len() <= FINE_BLOCKS && s.fine.len() <= 2 * FINE_BLOCKS, "{} blocks, room for {}", marked.len(), s.fine.len());
        let mut blocks = std::collections::HashSet::new();
        for &i in &marked {
            let block = *s.fine_of.get(&(i as u32)).expect("a cell with the mark and no block");
            assert!(blocks.insert(block), "two cells share a block");
            let b = &s.fine[block as usize];
            assert!(b.iter().any(|&k| k != 0) && b.iter().any(|&k| k != b[0]), "a block that is empty or all one kind");
            assert!(b.iter().all(|&k| k & FINE == 0), "a mark inside a block");
        }
        match whole {
            Whole::Tree(words) => {
                assert!(words == tree.len() && words <= TREE_WORDS, "{words} words");
                assert_eq!(tree::tests::sound(tree), marked.len());
            }
            Whole::Uniform(kind) => assert_eq!(kind & FINE, 0),
            Whole::Empty => {}
        }
    }

    /// Defect 1: no edit can give a cell the mark, so rows of finer cells never look for a block that is not there.
    #[test]
    fn a_plain_row_of_a_marked_kind_then_fine_rows_on_its_cell() {
        for tag in [0, 1, 2] {
            let first: &[i32] = if tag == 0 { &[0, 10, 5, 5, 0, 0x0541] } else { &[tag, 1, 10, 11, 5, 5, 0x0541] };
            for (fine, x, yz) in [(3, 40, 20), (4, 80, 40)] {
                let (s, tree, whole) = made(&[first, &[fine, 1, x, x + 1, yz, yz, 0x0509]].concat(), 0, 0, 0, 0);
                sane(&s, &tree, whole);
                assert_eq!(s.cells[at(10, 5, 5)], 0x0501 | FINE, "most of the cell is the first edit's kind, without the mark it came with");
                assert_eq!(tree::fine_at(&tree, 80, 40, 40), 0x0509);
                assert_eq!(tree::fine_at(&tree, 87, 47, 47), 0x0501);
            }
        }
    }

    /// Defect 2: a row of kind 0 into air leaves no block behind, and a marked kind written there after is a plain cell.
    #[test]
    fn a_fine_row_of_nothing_into_air_then_a_marked_kind() {
        let (s, tree, whole) = made(&[3, 1, 40, 41, 2600, 20, 0, 1, 1, 10, 11, 650, 5, 0x0541], 0, 10, 0, 0);
        sane(&s, &tree, whole);
        assert_eq!(s.cells[at(10, 10, 5)], 0x0501);
        assert!(s.fine_of.is_empty());
    }

    /// One row of eighth cells across every line of cells of sector (0, 10, 0): a block for each of its 262,144 cells.
    fn a_block_for_every_cell() -> Vec<i32> {
        let mut words = vec![4, 4096];
        for y in 0..64 {
            for z in 0..64 {
                words.extend([0, 512, (640 + y) * 8, z * 8, 0x0509]);
            }
        }
        words
    }

    /// Defect 3: an edit that would give a sector more blocks than it may hold is refused whole. The sector is as it
    /// was, says so, and took no room for the blocks.
    #[test]
    fn an_edit_of_too_many_blocks_is_refused_whole() {
        let before: &[i32] = &[3, 2, 40, 41, 2600, 20, 0x0509, 43, 44, 2600, 20, 0x0303];
        let (was, was_tree, _) = made(before, 0, 10, 0, 0);
        let (s, tree, whole) = made(&[before, &a_block_for_every_cell()].concat(), 0, 10, 0, 0);
        sane(&s, &tree, whole);
        assert_eq!(s.refused, 1);
        assert!(s.cells == was.cells && tree == was_tree, "the sector is as it was before the edit");
        assert!(s.fine.capacity() <= 64, "room for {} blocks was taken", s.fine.capacity());
        // Taking away from a sector that is full is not refused: not where the rows pass through air, nor where they
        // empty whole cells that had no block.
        let full = Edit::Fine((0..FINE_BLOCKS as i32).map(|i| Run { x0: (i % 64) * 8, x1: (i % 64) * 8 + 1, y: 5120 + (i / 4096) * 8, z: (i / 64 % 64) * 8, kind: 0x0509 }).collect(), 3);
        let solid = Edit::Runs(vec![Run { x0: 0, x1: 64, y: 700, z: 0, kind: 0x0303 }]);
        // Half of the blocks, a row of whole cells, and 32,768 cells of air.
        let half = (0..64 * 16).map(|i| Run { x0: 0, x1: 512, y: 5120 + i / 64, z: (i % 64) * 8, kind: 0 });
        let row = (0..64).map(|i| Run { x0: 0, x1: 512, y: 5600 + i / 8, z: i % 8, kind: 0 });
        let air = (0..512).map(|i| Run { x0: 0, x1: 512, y: 5300 + (i / 64) * 8, z: (i % 64) * 8, kind: 0 });
        let away = Edit::Fine(half.chain(row).chain(air).collect(), 3);
        let (mut s, mut tree) = (Scratch::new(), Vec::new());
        s.finer = true;
        let whole = sector(&mut s, 0, 10, 0, 0, &[full.clone(), solid.clone()], &mut tree);
        sane(&s, &tree, whole);
        assert_eq!((s.refused, s.fine_of.len()), (0, FINE_BLOCKS));
        let whole = sector(&mut s, 0, 10, 0, 0, &[full.clone(), solid.clone(), Edit::Fine(vec![Run { x0: 9, x1: 10, y: 5200, z: 9, kind: 0x0509 }], 3)], &mut tree);
        sane(&s, &tree, whole);
        assert_eq!((s.refused, s.fine_of.len()), (1, FINE_BLOCKS));
        let whole = sector(&mut s, 0, 10, 0, 0, &[full, solid, away], &mut tree);
        sane(&s, &tree, whole);
        assert_eq!((s.refused, s.fine_of.len(), s.cells[at(5, 60, 0)]), (0, FINE_BLOCKS / 2, 0));
    }

    /// Defect 3: an edit whose blocks could take the sector's tree past its limit is refused whole, and one after it
    /// that takes blocks away is taken.
    #[test]
    fn an_edit_of_too_many_words_is_refused_whole() {
        // Blocks 8 a side, full, of two kinds in sheets turn about, a leaf apart: each is 16 words of mask, one, 256
        // of kinds, and its leaf's table of 64.
        let rows = |cells: std::ops::Range<i32>, kinds: [Kind; 2]| {
            let mut rows = Vec::new();
            for c in cells {
                let (x, y, z) = ((c % 16) * 32, 5120 + (c / 256) * 32, (c / 16 % 16) * 32);
                for i in 0..64 {
                    rows.push(Run { x0: x, x1: x + 8, y: y + i / 8, z: z + i % 8, kind: kinds[i as usize % 2] });
                }
            }
            Edit::Fine(rows, 3)
        };
        let (mut s, mut tree, mut other) = (Scratch::new(), Vec::new(), Vec::new());
        s.finer = true;
        let mut edits = vec![rows(0..1000, [0x0509, 0x0303])];
        let whole = sector(&mut s, 0, 10, 0, 0, &edits, &mut tree);
        sane(&s, &tree, whole);
        assert_eq!((s.refused, s.fine_of.len()), (0, 1000));
        let was = s.cells.clone();
        // The next changes half of those blocks and adds a thousand more.
        edits.push(rows(500..2000, [0x0303, 0x0509]));
        edits.push(rows(0..600, [0, 0]));
        let whole = sector(&mut s, 0, 10, 0, 0, &edits[..2], &mut other);
        sane(&s, &other, whole);
        assert_eq!((s.refused, s.fine_of.len()), (1, 1000));
        assert!(s.cells == was && other == tree, "the sector is as it was before the edit");
        let whole = sector(&mut s, 0, 10, 0, 0, &edits, &mut other);
        sane(&s, &other, whole);
        assert_eq!((s.refused, s.fine_of.len()), (1, 400));
    }

    /// Defect 4: what rows of finer cells put in the world, the same rows of kind 0 take away, in every copy.
    #[test]
    fn a_fine_thing_taken_away_is_gone_from_the_coarser_copies() {
        let thing = |kind: i32| {
            let mut words = vec![4, 256];
            for y in 5200..5216 {
                for z in 32..48 {
                    words.extend([32, 48, y, z, kind]);
                }
            }
            words
        };
        let (put, gone) = (thing(0x0509), thing(0));
        for lod in 0..4 {
            let (sy, cell) = (10 >> lod, at(4 >> lod, (650 >> lod) & 63, 4 >> lod));
            let plain = made(&[], 0, sy, 0, lod).0.cells;
            let there = made(&put, 0, sy, 0, lod).0.cells;
            // The thing is two of the world's cells each way: a copy twice as coarse has it as one cell, the next has not.
            assert_eq!(there[cell], if lod < 2 { 0x0509 } else { plain[cell] }, "{lod} times coarser");
            for words in [[&put[..], &gone].concat(), [&put[..], &put, &gone].concat()] {
                let (s, tree, whole) = made(&words, 0, sy, 0, lod);
                sane(&s, &tree, whole);
                assert!(s.cells == plain, "{lod} times coarser the thing is still there");
            }
            assert!(made(&[&gone[..], &put].concat(), 0, sy, 0, lod).0.cells == there, "{lod} times coarser, taken away and then put");
        }
    }

    /// Defect 7: a row of finer cells across a far sector is one fill, not a count for each fine cell it covers.
    #[test]
    fn fine_rows_across_a_far_sector_are_quick() {
        let n = 2048;
        // 13,000 such rows were 15 s when each fine cell was counted (4,000 were 4.7 s).
        let mut words = vec![4, 13000];
        for i in 0..13000 {
            words.extend([-(1 << 30), 1 << 30, n / 2 + n * (i % 64), n / 2 + n * (i / 64 % 64), 0x0509]);
        }
        let began = std::time::Instant::now();
        let (s, tree, whole) = made(&words, 0, 0, 0, 8);
        assert!(began.elapsed().as_millis() < 3000, "{} ms", began.elapsed().as_millis());
        sane(&s, &tree, whole);
        assert_eq!(s.cells[at(63, 63, 61)], 0x0509);
    }

    /// With the switch off, as it is until a page says otherwise, an edit of finer cells changes nothing in any copy:
    /// each sector is what it is without the edit, and says it refused it.
    #[test]
    fn with_the_switch_off_fine_rows_change_nothing() {
        let plain: &[i32] = &[1, 1, 3, 9, 650, 5, 0x0509];
        let fine: Vec<i32> = (3..=4).flat_map(|tag| [tag, 2, 0, 4096, 2600 << (tag - 3), 16 << (tag - 3), 0x0303, 40, 41, 2600 << (tag - 3), 20 << (tag - 3), 0]).collect();
        for lod in 0..4 {
            let (mut s, mut tree, mut other) = (Scratch::new(), Vec::new(), Vec::new());
            let whole = sector(&mut s, 0, 10 >> lod, 0, lod, &read_edits(&[plain, &fine, plain].concat()), &mut tree);
            sane(&s, &tree, whole);
            assert_eq!(s.refused, 2);
            let cells = s.cells.clone();
            assert_eq!(sector(&mut s, 0, 10 >> lod, 0, lod, &read_edits(&[plain, plain].concat()), &mut other), whole);
            assert!(s.cells == cells && tree == other && s.refused == 0, "{lod} times coarser the sector differs");
            // And on, it is taken: in the finest copy the rows are there.
            s.finer = true;
            sector(&mut s, 0, 10 >> lod, 0, lod, &read_edits(&[plain, &fine, plain].concat()), &mut other);
            assert!(s.refused == 0 && (lod > 0 || s.cells != cells));
        }
    }

    /// Numbers that are not whole edits: what can be read is, and the rest is left.
    #[test]
    fn edits_cut_short_are_not_read() {
        let whole = [0, 1, 2, 3, 4, 5, 1, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        assert_eq!(read_edits(&whole).len(), 2);
        for cut in 0..whole.len() {
            assert_eq!(read_edits(&whole[..cut]).len(), (cut >= 6) as usize, "cut at {cut}");
        }
        for words in [&[1][..], &[3, -1, 0, 0, 0, 0, 0], &[4, i32::MAX, 1, 2, 3, 4, 5], &[2, i32::MIN], &[0, 1, 2], &[3, 2, 1, 2, 3, 4, 5, 6]] {
            assert!(read_edits(words).is_empty());
        }
        assert_eq!(read_edits(&[7, 0, -9, 1, 1, 2, 3, 4, 5, 3, 1]).len(), 2);
    }

    /// Defect 5, and all of them together: edits are numbers from outside, and the core takes any of them. Several
    /// thousand strings of edits by a fixed seed (every tag and some that are none, counts that lie, strings cut short,
    /// places at the ends of the numbers and crowded into a few cells so that edits meet, kinds of every bit) are
    /// applied to sectors at several coarsenesses. Nothing panics, the limits hold, and no cell has the mark without
    /// a block.
    #[test]
    fn any_numbers_are_edits_that_do_no_harm() {
        struct Dice(u64);
        impl Dice {
            fn next(&mut self) -> u64 {
                self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
                let mut z = self.0;
                z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
                z ^ (z >> 31)
            }
            /// One of `n`.
            fn of(&mut self, n: u64) -> u64 {
                self.next() % n
            }
        }
        const ENDS: [i32; 10] = [i32::MIN, i32::MIN + 1, i32::MAX, i32::MAX - 1, 0, -1, 1, i32::MAX / 2, i32::MIN / 2, 1 << 30];
        let mut d = Dice(0x2590_0259);
        let (mut s, mut tree) = (Scratch::new(), Vec::new());
        let (mut marked, mut refused, mut read) = (0, 0, 0);
        for round in 0..4000 {
            let lod = [0, 0, 0, 0, 1, 2, 5, 8][d.of(8) as usize];
            // A sector in the air, one at the ground, one far off and below zero.
            let [sx, sy, sz] = [[0, 10 >> lod, 0], [0, 0, 0], [-3, 2, -(1 << 20) >> lod]][d.of(3) as usize];
            let low = [sx, sy, sz].map(|v| (v as i64 * SIDE as i64) << lod);
            // A few cells of the sector that this round's edits crowd into, in the world's cells.
            let hot: Vec<[i64; 3]> = (0..3).map(|_| low.map(|v| v + (d.of(64) << lod) as i64)).collect();
            let wide = 1u64 << lod;
            let mut words = Vec::new();
            for _ in 0..1 + d.of(6) {
                let tag = [0, 1, 1, 2, 3, 3, 3, 4, 4, 4, 5, -1][d.of(12) as usize];
                let per: i64 = match tag { 3 => 4, 4 => 8, _ => 1 };
                let place = |d: &mut Dice, axis: usize| -> i32 {
                    match d.of(20) {
                        0 => ENDS[d.of(10) as usize],
                        1 => d.next() as i32,
                        2..=4 => ((low[axis] + d.of(96 * wide) as i64 - 16 * wide as i64) * per) as i32,
                        _ => (hot[d.of(3) as usize][axis] * per + d.of(3 * per as u64 * wide) as i64 - per) as i32,
                    }
                };
                let kind = |d: &mut Dice| match d.of(4) { 0 => d.next() as i32, 1 => 0, 2 => 0x0509 + d.of(3) as i32, _ => 0x0340 + d.of(16) as i32 };
                if tag == 0 {
                    let radius = match d.of(10) { 0 => ENDS[d.of(10) as usize], 1 => d.next() as i32, _ => d.of(6 * wide) as i32 };
                    words.extend([0, place(&mut d, 0), place(&mut d, 1), place(&mut d, 2), radius, kind(&mut d)]);
                    continue;
                }
                let rows = match d.of(12) { 0 => 0, 1 => 300, _ => 1 + d.of(24) } as i32;
                words.extend([tag, match d.of(40) { 0 => -1, 1 => rows + 1, 2 => i32::MAX, _ => rows }]);
                for _ in 0..rows {
                    let x0 = place(&mut d, 0);
                    let x1 = match d.of(8) { 0 => place(&mut d, 0), 1 => x0.wrapping_add(d.of(70 * per as u64 * wide) as i32), _ => x0.wrapping_add(1 + d.of(2 * per as u64 * wide) as i32) };
                    words.extend([x0, x1, place(&mut d, 1), place(&mut d, 2), kind(&mut d)]);
                }
            }
            if d.of(10) == 0 {
                words.truncate(d.of(words.len() as u64 + 1) as usize);
            }
            let edits = read_edits(&words);
            read += edits.len();
            for e in &edits {
                bodies::reach(e);
            }
            scratch::merged(&edits, lod, [low[0] as i32, (low[0] as i32).wrapping_add((SIDE as i32) << lod)], [low[2] as i32, (low[2] as i32).wrapping_add((SIDE as i32) << lod)]);
            s.finer = round % 8 != 7;
            let whole = sector(&mut s, sx, sy, sz, lod, &edits, &mut tree);
            sane(&s, &tree, whole);
            marked += s.cells.iter().filter(|&&k| k & FINE != 0).count();
            refused += s.refused;
        }
        // The edits met: there were cells of finer cells, and edits refused where the switch was off.
        assert!(read > 8000 && marked > 20000 && refused > 500, "{read} edits read, {marked} cells of finer cells, {refused} refused");
    }

    /// End-to-end verification of every new systemic WASM `extern "C"` export:
    /// carving, environment, hinges, ropes/winches, ragdolls + POSE output, ballistics, shockwaves, and laser beams.
    #[test]
    fn wasm_abi_systemic_exports_end_to_end() {
        world_forget();
        let g = ground_at(700, 4070);
        let y0 = g + 90;

        // 1. Environment switch (`bodies_set_env`).
        bodies_set_env(1, (g + 40) as f32, 0.25);

        // 2. Spawn a 6x6x6 wood block via `living_spawn` + `living_end` (or `bodies_throw`) and carve it.
        let throw_words = bodies_throw(700.0, y0 as f32, 4070.0, 0.0, 0.0, 0.0, 3, kinds::kind(kinds::WOOD, kinds::OWN) as u32);
        assert!(throw_words > 0);
        // First body ID is 1.
        let carve_s = bodies_carve_sphere(1, 700.0, y0 as f32, 4070.0, 1.5);
        assert!(carve_s > 0, "bodies_carve_sphere must emit output records");
        let carve_c = bodies_carve_capsule(1, 698.0, y0 as f32, 4070.0, 702.0, y0 as f32, 4070.0, 0.8);
        assert!(carve_c > 0, "bodies_carve_capsule must emit output records");
        let carve_p = bodies_carve_plane(1, 700.0, (y0 + 1) as f32, 4070.0, 0.0, 1.0, 0.0, 1.2);
        assert!(carve_p > 0, "bodies_carve_plane must emit output records");

        // 3. Joints: hinge, rope, winch, count, and world-edit anchor invalidation.
        let edit_words = [1, 1, 710, 711, y0, 4070, kinds::kind(kinds::CONCRETE, kinds::OWN) as i32];
        unsafe {
            let ptr = edits_room(edit_words.len());
            std::ptr::copy_nonoverlapping(edit_words.as_ptr(), ptr, edit_words.len());
        }
        world_edit(-1);
        assert_ne!(world_kind(710, y0, 4070), 0);

        let j_hinge = joints_add_hinge(0, 1, 700.0, y0 as f32, 4070.0, 0.0, 1.0, 0.0, 710, y0, 4070);
        let j_rope = joints_add_rope(0, 1, 700.0, (y0 + 10) as f32, 4070.0, 700.0, y0 as f32, 4070.0, 12.0, 50_000.0);
        assert_ne!(j_hinge, 0);
        assert_ne!(j_rope, 0);
        assert_eq!(joints_count(), 2);
        assert_eq!(joints_set_winch(j_rope, 5.0), 1);
        assert_eq!(joints_set_winch(j_hinge, 5.0), 0, "winch only applies to distance/rope joints");

        // Clear the hinge's world voxel via `world_edit` -> hinge snaps immediately.
        let clear_words = [1, 1, 710, 711, y0, 4070, 0];
        unsafe {
            let ptr = edits_room(clear_words.len());
            std::ptr::copy_nonoverlapping(clear_words.as_ptr(), ptr, clear_words.len());
        }
        world_edit(-1);
        assert_eq!(joints_count(), 1, "world_edit removing anchor cell must snap hinge");

        // 4. Ragdoll spawn, hit, count, and POSE record emitted by `bodies_advance`.
        let rid = ragdoll_spawn(720.0, y0 as f32, 4070.0);
        assert_ne!(rid, 0);
        assert_eq!(ragdoll_count(), 1);
        assert_eq!(ragdoll_hit(rid, ragdoll::BoneId::Chest as u32, 120.0, 0.0, 0.0, 0.0), 1);

        // 5. Ballistics, shockwave, and thermal beam exports.
        let pid = ballistics_fire(1, 705.0, (y0 + 10) as f32, 4070.0, 1.0, 0.0, 0.0);
        assert_ne!(pid, 0);
        let waves = shockwave_blast(715.0, (y0 + 5) as f32, 4070.0, 20.0, 300.0, 8);
        assert_eq!(waves, 1);
        let segs = beams_fire(705.0, (y0 + 5) as f32, 4070.0, 1.0, 0.0, 0.0, 150.0, 0.05);
        assert!(segs >= 1);

        let n_words = bodies_advance(1.0 / 60.0);
        assert!(n_words > 0);
        let out = unsafe { std::slice::from_raw_parts(bodies_words(), n_words) };
        let mut saw_pose = false;
        let mut idx = 0;
        while idx < out.len() {
            let tag = out[idx];
            let len = out[idx + 1] as usize;
            if tag == bodies::POSE && len == 18 && out[idx + 2] == rid {
                saw_pose = true;
            }
            idx += 2 + len;
        }
        assert!(saw_pose, "bodies_advance must stream POSE (tag 14) record via bodies_words()");

        // Clean up global thread-local state so other tests remain isolated.
        bodies_set_env(0, 0.0, 0.0);
        world_forget();
    }
}
