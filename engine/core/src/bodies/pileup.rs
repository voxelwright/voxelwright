//! Cars that strike cars hard (#72): a car at 150 km/h into a line of three, and a car that comes to life already
//! inside the one that struck it (as the street's drawn cars did, page/street.ts `wake`). Read from where the
//! bodies are: no car is left inside another, none on another's roof, and each can still be driven away.
//!
//!   cargo test --release pileup -- --nocapture
use super::living::tests::{level, shell, the, tipped};
use super::*;
use crate::kinds::{OWN, STEEL, kind};

const SIZE: [usize; 3] = [48, 16, 22];
/// Overlap of two cars' outlines on the road that is a fault when it lasts (0.4 m), and at once (0.8 m): the
/// telemetry's own numbers (#64, page/recorder.ts `vehicle_overlap`).
const LASTS: f32 = 4.0;
const DEEP: f32 = 8.0;

/// A car as the street's are (the SUV of sf/cars.mjs): a steel shell 4.8 m by 2.2 m, hollow, its floor 0.2 m up and
/// its side windows open, so nothing in it is shut in; 150 km/h at the top, `tough` 280.
fn suv(bodies: &mut Bodies, low: [i32; 3]) -> u32 {
    let mut cells = shell(SIZE, kind(STEEL, OWN));
    let at = |x: usize, y: usize, z: usize| x + SIZE[0] * (z + SIZE[2] * y);
    for y in 0..2 { for z in 0..SIZE[2] { for x in 0..SIZE[0] { cells[at(x, y, z)] = 0; } } }
    for y in 9..14 { for x in 14..34 { for z in [0, SIZE[2] - 1] { cells[at(x, y, z)] = 0; } } }
    let id = bodies.spawn(cells, SIZE, low, false);
    let mut numbers = vec![0.0, 0.88, 56.0, 420.0, 0.716, 0.0, 0.0, 0.0, 0.0, 0.0, 280.0];
    for (x, z, reach, front) in [(38.56, 2.7, 5.94, true), (38.56, 19.3, 5.94, true), (9.62, 2.7, 7.09, false), (9.62, 19.3, 7.09, false)] {
        numbers.extend([x, 3.88, z, reach, front as u32 as f32, 1.0]);
    }
    assert!(bodies.motor(id, &numbers));
    id
}

/// A level plain 3 km by 200 m high over the town, as `level` is but wide: cars knocked aside stay on it. Returns
/// where a car's low corner goes.
fn plain(bodies: &mut Bodies) -> [i32; 3] {
    let runs: Vec<Run> = (2398..2400).flat_map(|y| (3000..5000).map(move |z| Run { x0: 0, x1: 30000, y, z, kind: kind(crate::kinds::ASPHALT, OWN) })).collect();
    bodies.ground.push(Edit::Runs(runs), false, None);
    [760, 2403, 4055]
}

/// How far two of the SUVs' outlines on the road are into each other (cells; under 0 they are apart).
fn into(a: &Body, b: &Body) -> f32 {
    outlines(a, b, SIZE[0] as f32 / 2.0, SIZE[2] as f32 / 2.0)
}

/// How far the outlines on the road of two cars, each half so long and half so wide, are into each other: the least
/// overlap along the four ways the two outlines face.
fn outlines(a: &Body, b: &Body, long: f32, wide: f32) -> f32 {
    let (fa, fb) = (turn(a.rot, [1.0, 0.0, 0.0]), turn(b.rot, [1.0, 0.0, 0.0]));
    let flat = |f: V| { let l = (f[0] * f[0] + f[2] * f[2]).sqrt().max(1e-6); [f[0] / l, f[2] / l] };
    let (fa, fb) = (flat(fa), flat(fb));
    let (ra, rb) = ([-fa[1], fa[0]], [-fb[1], fb[0]]);
    let d = [b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]];
    let mut gap = f32::MIN;
    for u in [fa, ra, fb, rb] {
        let reach = |f: [f32; 2], r: [f32; 2]| long * (f[0] * u[0] + f[1] * u[1]).abs() + wide * (r[0] * u[0] + r[1] * u[1]).abs();
        gap = gap.max((d[0] * u[0] + d[1] * u[1]).abs() - reach(fa, ra) - reach(fb, rb));
    }
    -gap
}

/// What was seen of a set of cars over a run: the deepest any two were into each other and the longest any two stayed
/// more than `LASTS` in (seconds), how high the highest stood over where it stands on the road, and how many broke.
#[derive(Default, Debug)]
struct Seen { deepest: f32, longest: f32, highest: f32, broke: usize }

/// Runs the solver for some seconds with `go` told to the first of `ids`, watching every pair.
fn watch(bodies: &mut Bodies, ids: &[u32], seconds: f32, go: f32, stands: f32, seen: &mut Seen, streaks: &mut Vec<f32>) {
    streaks.resize(ids.len() * ids.len(), 0.0);
    for _ in 0..(seconds * 60.0) as usize {
        bodies.drive(ids[0], go, 0.0, 0.0, false, false);
        bodies.out.clear();
        bodies.advance(1.0 / 60.0);
        let alive: Vec<Option<&Body>> = ids.iter().map(|&id| bodies.list.iter().find(|b| b.id == id && b.live.is_some())).collect();
        seen.broke = alive.iter().filter(|b| b.is_none()).count();
        for i in 0..ids.len() {
            let Some(a) = alive[i] else { continue };
            seen.highest = seen.highest.max(a.pos[1] - stands);
            for j in i + 1..ids.len() {
                let Some(b) = alive[j] else { continue };
                // Only cars at one height are in each other: one that flies over another is not.
                let deep = if (a.pos[1] - b.pos[1]).abs() < SIZE[1] as f32 { into(a, b) } else { 0.0 };
                seen.deepest = seen.deepest.max(deep);
                let streak = &mut streaks[i * ids.len() + j];
                *streak = if deep >= LASTS { *streak + 1.0 / 60.0 } else { 0.0 };
                seen.longest = seen.longest.max(*streak);
            }
        }
    }
}

/// At rest: no two outlines overlap, each car stands on the road on its wheels, and each drives away when told.
fn stands_clear_and_drives(bodies: &mut Bodies, ids: &[u32], stands: f32, what: &str) {
    for (i, &a) in ids.iter().enumerate() {
        let body = the(bodies, a);
        assert!((body.pos[1] - stands).abs() < 2.0, "{what}: car {i} rests {:.1} cells off where a car stands on the road (on another's roof, or sunk)", body.pos[1] - stands);
        assert!(tipped(body) < 12.0, "{what}: car {i} rests tipped {:.0} degrees", tipped(body));
        for (j, &b) in ids.iter().enumerate().skip(i + 1) {
            let deep = into(body, the(bodies, b));
            assert!(deep < 1.0, "{what}: cars {i} and {j} rest {deep:.1} cells into each other");
        }
    }
    // Told to go, forward and then back, each moves: none is held by another.
    for (i, &id) in ids.iter().enumerate() {
        let from = the(bodies, id).pos;
        let mut went = 0.0f32;
        for go in [1.0, -1.0] {
            for _ in 0..90 {
                bodies.drive(id, go, 0.0, 0.0, false, false);
                bodies.out.clear();
                bodies.advance(1.0 / 60.0);
            }
            let at = the(bodies, id).pos;
            went = went.max(((at[0] - from[0]).powi(2) + (at[2] - from[2]).powi(2)).sqrt());
        }
        assert!(went > 20.0, "{what}: car {i} told to go for 1.5 s each way moved {went:.1} cells: it is held");
    }
}

/// Lets cars stand until they sleep, and says how high a car's middle then is.
fn settle(bodies: &mut Bodies, ids: &[u32]) -> f32 {
    for _ in 0..150 {
        bodies.out.clear();
        bodies.advance(1.0 / 60.0);
    }
    the(bodies, ids[0]).pos[1]
}

fn speed(bodies: &mut Bodies, id: u32, vel: V) {
    let b = bodies.list.iter_mut().find(|b| b.id == id).unwrap();
    (b.vel, b.asleep) = (vel, false);
}

/// A car at 150 km/h into the back of three parked nose to tail 0.8 m apart: the telemetry's fault (two outlines
/// 0.4 m into each other for 0.2 s, or 0.8 m at all) is never seen, none ends on another, and all four drive away.
#[test]
fn a_car_at_150_kmh_into_a_line_of_three_leaves_none_inside_another() {
    let mut bodies = Bodies::new();
    let low = level(&mut bodies);
    let ids: Vec<u32> = [0, 300, 356, 412].iter().map(|dx| suv(&mut bodies, [low[0] + dx, low[1], low[2]])).collect();
    let stands = settle(&mut bodies, &ids);
    speed(&mut bodies, ids[0], [420.0, 0.0, 0.0]);
    let (mut seen, mut streaks) = (Seen::default(), Vec::new());
    watch(&mut bodies, &ids, 4.0, 1.0, stands, &mut seen, &mut streaks);
    watch(&mut bodies, &ids, 3.0, 0.0, stands, &mut seen, &mut streaks);
    eprintln!("150 km/h into three: {seen:?}; they rest at x {:?}", ids.iter().map(|&id| bodies.list.iter().find(|b| b.id == id).map(|b| b.pos[0].round())).collect::<Vec<_>>());
    assert_eq!(seen.broke, 0, "a car of the street's toughness is whole after it");
    assert!(seen.deepest < DEEP, "two cars were {:.1} cells into each other (the telemetry's fault at {DEEP})", seen.deepest);
    assert!(seen.longest < 0.2, "two cars stayed over {LASTS} cells into each other for {:.2} s", seen.longest);
    assert!(seen.highest < SIZE[1] as f32 * 0.5, "a car rose {:.1} cells: onto another", seen.highest);
    stands_clear_and_drives(&mut bodies, &ids, stands, "150 km/h into three");
}

/// A car that comes to life with the one that struck it already in it, as the street's drawn cars did (the page
/// learns of the touch a frame or three late): 1.5 m in with both standing, and 3.3 m in with the striker still at
/// 150 km/h, which is further than out through its side (2.2 m). It is put clear ahead of what struck it, in its
/// lane: not left wedged, not put out sideways into the kerb, not lifted onto the other's roof.
#[test]
fn a_car_put_down_inside_another_comes_out_along_the_road() {
    for moving in [false, true] {
        let what = if moving { "woken inside a car at 150 km/h" } else { "woken inside a standing car" };
        let mut bodies = Bodies::new();
        let low = level(&mut bodies);
        let mut ids = vec![suv(&mut bodies, low)];
        // A third stands 0.8 m ahead of where the woken one is to be, as the next parked car does.
        let ahead = if moving { 15 } else { 33 };
        ids.push(suv(&mut bodies, [low[0] + ahead + 56, low[1], low[2]]));
        let stands = settle(&mut bodies, &ids);
        let at = the(&bodies, ids[0]).pos;
        if moving {
            speed(&mut bodies, ids[0], [420.0, 0.0, 0.0]);
        }
        // Born elsewhere, then put where it was drawn, inside the first.
        let woken = suv(&mut bodies, [low[0], low[1] + 60, low[2] + 200]);
        assert!(bodies.place(woken, [at[0] + ahead as f32, at[1] + 1.0, at[2]], [0.0, 0.0, 0.0, 1.0]));
        if moving {
            let (put, striker) = (the(&bodies, woken).pos, the(&bodies, ids[0]).pos);
            assert!(put[0] - striker[0] >= SIZE[0] as f32 && (put[2] - at[2]).abs() < 1.0, "it is put clear ahead of what struck it, in its lane ({:.1} ahead, {:.1} aside)", put[0] - striker[0], put[2] - at[2]);
            assert!(bodies.kick(woken, [330.0, 6.0, 0.0]));
        }
        ids.insert(1, woken);
        let (mut seen, mut streaks) = (Seen::default(), Vec::new());
        watch(&mut bodies, &ids, 4.0, if moving { 1.0 } else { 0.0 }, stands, &mut seen, &mut streaks);
        watch(&mut bodies, &ids, 3.0, 0.0, stands, &mut seen, &mut streaks);
        eprintln!("{what}: {seen:?}; they rest at x {:?}", ids.iter().map(|&id| bodies.list.iter().find(|b| b.id == id).map(|b| b.pos[0].round())).collect::<Vec<_>>());
        assert_eq!(seen.broke, 0, "{what}: all whole");
        assert!(seen.longest < 0.2, "{what}: two cars stayed over {LASTS} cells into each other for {:.2} s", seen.longest);
        assert!(seen.highest < SIZE[1] as f32 * 0.5, "{what}: a car rose {:.1} cells: onto another", seen.highest);
        let aside = ids.iter().map(|&id| (the(&bodies, id).pos[2] - at[2]).abs()).fold(0.0, f32::max);
        assert!(aside < 12.0, "{what}: one ended {aside:.1} cells out of its lane");
        stands_clear_and_drives(&mut bodies, &ids, stands, what);
    }
}

/// Struck other ways at 150 km/h: square in the side, half a car's width off its line, and two meeting nose to nose
/// at 108 km/h each. However they meet, none passes into another and each drives away.
#[test]
fn cars_struck_in_the_side_off_centre_and_head_on_part_cleanly() {
    let side = [0.0, std::f32::consts::FRAC_1_SQRT_2, 0.0, std::f32::consts::FRAC_1_SQRT_2];
    for (what, off, rot, back) in [("into its side", 0.0, Some(side), 0.0), ("half a width off its line", 11.0, None, 0.0), ("nose to nose", 0.0, None, -300.0)] {
        let mut bodies = Bodies::new();
        let low = plain(&mut bodies);
        let ids = vec![suv(&mut bodies, low), suv(&mut bodies, [low[0] + 300, low[1], low[2]])];
        let stands = settle(&mut bodies, &ids);
        let at = the(&bodies, ids[1]).pos;
        assert!(bodies.place(ids[1], [at[0], at[1], at[2] + off], rot.unwrap_or([0.0, 0.0, 0.0, 1.0])));
        speed(&mut bodies, ids[0], [if back < 0.0 { 300.0 } else { 420.0 }, 0.0, 0.0]);
        if back < 0.0 {
            speed(&mut bodies, ids[1], [back, 0.0, 0.0]);
        }
        let (mut seen, mut streaks) = (Seen::default(), Vec::new());
        watch(&mut bodies, &ids, 3.0, 1.0, stands, &mut seen, &mut streaks);
        watch(&mut bodies, &ids, 4.0, 0.0, stands, &mut seen, &mut streaks);
        eprintln!("{what}: {seen:?}; they rest at {:?}", ids.iter().map(|&id| bodies.list.iter().find(|b| b.id == id).map(|b| [b.pos[0].round(), b.pos[2].round()])).collect::<Vec<_>>());
        assert_eq!(seen.broke, 0, "{what}: both whole");
        assert!(seen.deepest < DEEP && seen.longest < 0.2, "{what}: two cars were {:.1} cells into each other, and over {LASTS} for {:.2} s", seen.deepest, seen.longest);
        assert!(seen.highest < SIZE[1] as f32 * 0.5, "{what}: a car rose {:.1} cells: onto the other", seen.highest);
        stands_clear_and_drives(&mut bodies, &ids, stands, what);
    }
}

/// One that comes down on another's roof from above stays on it: it is not thrown out sideways through the other, and
/// is pushed up only as far as the roof.
#[test]
fn a_car_let_fall_onto_another_lands_on_its_roof() {
    let mut bodies = Bodies::new();
    let low = level(&mut bodies);
    let ids = vec![suv(&mut bodies, low)];
    let stands = settle(&mut bodies, &ids);
    let over = suv(&mut bodies, [low[0] + 6, low[1] + 40, low[2] + 2]);
    for _ in 0..180 {
        bodies.out.clear();
        bodies.advance(1.0 / 60.0);
    }
    let (under, upper) = (the(&bodies, ids[0]), the(&bodies, over));
    eprintln!("let fall onto another: the lower at {:?}, the upper at {:?}, {:.1} over where a car stands", under.pos.map(f32::round), upper.pos.map(f32::round), upper.pos[1] - stands);
    assert!((upper.pos[1] - stands - SIZE[1] as f32 + 2.0).abs() < 4.0, "the upper rests a car's height up, on the roof ({:.1} over where a car stands)", upper.pos[1] - stands);
    assert!((upper.pos[0] - under.pos[0]).abs() < 12.0 && (upper.pos[2] - under.pos[2]).abs() < 8.0, "and over the lower still");
}

/// As the page does it on the town's main street, which climbs 6% there (test/crash-stack.mjs): the engine's own car
/// at 150 km/h reaches a drawn car, which comes to life four frames on, or eight, born in the sky and put where it
/// was drawn, the next parked car 0.8 m ahead of it. After eight the striker's middle is past the drawn car's own:
/// it is still put ahead of the striker, not left behind in it. And moved out along a hill, each keeps its height
/// over the road: put where the road is two cells higher, it sprang up and came down on the next one's roof.
#[test]
fn a_car_woken_on_a_hill_with_the_striker_in_its_place_is_not_thrown_onto_the_next() {
    for frames in [4, 8] {
        woken_on_a_hill(frames);
    }
}

fn woken_on_a_hill(frames: usize) {
    use super::living::tests::car;
    let mut bodies = Bodies::new();
    let ground = |x: i32| city::ground(x, 4070);
    let stand = |bodies: &mut Bodies, x: i32, y: i32| {
        let id = car(bodies, [x - 21, y, 4061]);
        let mut numbers = vec![0.0, 1.3, 60.0, 420.0, 0.55, 0.0, 0.0, 0.0, 0.0, 0.0, 280.0];
        for (x, z, front) in [(7.0, 1.0, false), (7.0, 17.0, false), (35.0, 1.0, true), (35.0, 17.0, true)] {
            numbers.extend([x, 3.0, z, 6.0, front as u32 as f32, !front as u32 as f32]);
        }
        assert!(bodies.motor(id, &numbers));
        id
    };
    let mut ids = vec![stand(&mut bodies, 2000, ground(2000) + 5), stand(&mut bodies, 2350, ground(2350) + 5)];
    settle(&mut bodies, &ids);
    let over = |bodies: &Bodies, id: u32| { let b = the(bodies, id); b.pos[1] - city::ground(b.pos[0] as i32, 4070) as f32 };
    let stands = over(&bodies, ids[0]);
    speed(&mut bodies, ids[0], [420.0, 0.0, 0.0]);
    let step = |bodies: &mut Bodies, id: u32| { bodies.drive(id, 1.0, 0.0, 0.0, false, false); bodies.out.clear(); bodies.advance(1.0 / 60.0); };
    while the(&bodies, ids[0]).pos[0] + 21.0 < 2279.0 { step(&mut bodies, ids[0]); }
    let woken = stand(&mut bodies, 2300, ground(2300) + 3000);
    let com = sub(the(&bodies, woken).pos, [2279.0, (ground(2300) + 3000) as f32, 4061.0]);
    for _ in 0..frames { step(&mut bodies, ids[0]); }
    let was = the(&bodies, ids[0]).pos[0];
    assert!(bodies.place(woken, [2279.0 + com[0], ground(2300) as f32 + 1.0 + com[1], 4061.0 + com[2]], [0.0, 0.0, 0.0, 1.0]));
    assert!(bodies.kick(woken, [340.0, 6.0, 0.0]));
    ids.insert(1, woken);
    assert!(the(&bodies, woken).pos[0] - was >= 42.0, "after {frames} frames the striker's middle was {:.0} cells from the drawn car's: it is put ahead of the striker ({:.0})", 2300.0 - was, the(&bodies, woken).pos[0] - was);
    eprintln!("on a hill, {frames} frames: put at {:?}", ids.iter().map(|&id| { let b = the(&bodies, id); [b.pos[0].round(), (over(&bodies, id) - stands).round()] }).collect::<Vec<_>>());
    let (mut highest, mut longest, mut streak, mut on_another) = (0.0f32, 0.0f32, 0.0f32, 0usize);
    for k in 0..420 {
        step(&mut bodies, ids[0]);
        if k == 120 { ids.iter().for_each(|&id| { bodies.drive(id, 0.0, 0.0, 0.0, false, false); }); }
        let mut deep = 0.0f32;
        for i in 0..3 {
            for j in i + 1..3 {
                let far = outlines(the(&bodies, ids[i]), the(&bodies, ids[j]), 21.0, 9.0);
                deep = deep.max(far);
                // One over another: their outlines 2 cells in each other, one 6 or more higher over its road than the other over its own.
                on_another += (far > 2.0 && (over(&bodies, ids[i]) - over(&bodies, ids[j])).abs() >= 6.0) as usize;
            }
        }
        streak = if deep >= LASTS { streak + 1.0 / 60.0 } else { 0.0 };
        longest = longest.max(streak);
        highest = ids.iter().map(|&id| over(&bodies, id) - stands).fold(highest, f32::max);
    }
    eprintln!("on a hill, {frames} frames: highest {highest:.1} over where a car stands, {on_another} frames one over another, longest {longest:.2} s over {LASTS} cells; at rest {:?}", ids.iter().map(|&id| { let b = the(&bodies, id); [b.pos[0].round(), (over(&bodies, id) - stands).round()] }).collect::<Vec<_>>());
    assert!(longest < 0.2, "two stayed over {LASTS} cells into each other for {longest:.2} s");
    // (How high one's middle rose says little on a hill at this speed: it pitches and leaves the road at each change of slope.)
    assert_eq!(on_another, 0, "one was over another for {on_another} frames (the highest rose {highest:.1} cells; a car is 10 high)");
}
