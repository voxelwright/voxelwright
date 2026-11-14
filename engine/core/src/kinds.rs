//! What a cell can be. A kind is two bytes: the material (what it weighs, how it breaks, how it
//! shines) and a colour from one palette of 256 that every thing in the world shares, so a model
//! or a rule names any colour on any material without a table to keep.

use crate::tree::Kind;

pub const EARTH: u8 = 1;
pub const ROCK: u8 = 2;
pub const GRASS: u8 = 3;
pub const SAND: u8 = 4;
pub const WATER: u8 = 5;
pub const ASPHALT: u8 = 6;
pub const CONCRETE: u8 = 7;
pub const BRICK: u8 = 8;
pub const PLASTER: u8 = 9;
pub const WOOD: u8 = 10;
pub const GLASS: u8 = 11;
pub const STEEL: u8 = 12;
pub const LEAVES: u8 = 13;
pub const ROOFING: u8 = 14;
pub const LAMP: u8 = 15;
/// One more than the last material.
pub const MATERIALS: u8 = 16;

/// Colour 0 is the material's own. 1 to 15 run from white to black.
pub const OWN: u8 = 0;
pub const WHITE: u8 = 1;
pub const fn grey(step: u8) -> u8 {
    1 + if step > 14 { 14 } else { step }
}
/// The rest are 24 hues round the wheel (0 red, 4 yellow, 8 green, 12 cyan, 16 blue, 20 magenta), each in ten tones:
/// 0 palest, 1 pastel, 2 soft, 3 mid, 4 vivid, 5 deep, 6 dark, 7 dusty pale, 8 dusty, 9 dusty dark.
pub const fn colour(hue: u8, tone: u8) -> u8 {
    16 + (hue % 24) * 10 + tone % 10
}

#[inline]
pub const fn kind(material: u8, colour: u8) -> Kind {
    material as Kind | (colour as Kind) << 8
}
#[inline]
pub const fn material(kind: Kind) -> u8 {
    (kind & 15) as u8
}
/// A cell that is rubble: stuff that came down and lies loose (bodies.rs `heap`). It is still its material, to
/// break and to burn, but it holds nothing up beside it and hangs from nothing (support.rs), and is drawn broken.
pub const RUBBLE: Kind = 16;
#[inline]
pub const fn rubble(kind: Kind) -> bool {
    kind & RUBBLE != 0
}

/// A cell that goes up when it is hit: caught in a blast, or beside a fire, the thing it is part of is gone a moment
/// later in a blast of its own (bodies.rs `go_up`), which may catch the next. It is still its material, to draw and
/// to weigh. Nothing in the town is made of it yet: a model or an edit puts it there.
pub const CHARGED: Kind = 32;
/// Bit 6 (#259, an experiment): the cell holds a block of 4 x 4 x 4 cells a quarter its size. Its own kind is what
/// most of them are: all that anything but the tree and the march knows of it.
pub const FINE: Kind = 64;
#[inline]
pub const fn charged(kind: Kind) -> bool {
    kind & CHARGED != 0
}

/// A cell that is polished (a spell's "make it shiny", #246): it mirrors and glints. A look only: it weighs, breaks,
/// bears and burns as its material does. Bit 7: bit 6 is the mark of finer cells, which no edit may carry (scratch.rs
/// `plain`), and while both were 64 a polish was taken off every cell it was put on. No bit of the low byte is free now.
pub const POLISHED: Kind = 128;

/// How far a blast reaches into each material, in sixteenths of its own radius: what a thing
/// is made of decides how it breaks. Glass is brittle and goes far beyond the hole, masonry
/// crumbles to about the blast's size, steel and rock barely give, leaves and water are thrown aside.
pub const fn gives(material: u8) -> i32 {
    match material {
        GLASS => 44,
        LEAVES => 28,
        WATER => 24,
        PLASTER | WOOD | LAMP => 18,
        EARTH | GRASS | SAND | BRICK | ROOFING => 16,
        ASPHALT => 13,
        CONCRETE => 11,
        ROCK => 7,
        STEEL => 4,
        _ => 16,
    }
}
/// How ragged a blast leaves each material's edge, in sixteenths of the radius: masonry and earth break in lumps, glass and steel cleanly.
pub const fn crumbles(material: u8) -> i32 {
    match material {
        GLASS | STEEL | WATER => 0,
        WOOD | LAMP => 2,
        _ => 4,
    }
}

/// How far sideways from what holds it up a cell of this material can reach, in cells. Resting on something
/// costs nothing, each cell sideways costs one, each cell hung from above two: past this a cell is not held.
/// A floor reaches from wall to wall, a lintel across a garage, earth barely over a hole.
pub const fn spans(material: u8) -> u8 {
    match material {
        STEEL => 150,
        CONCRETE => 90,
        WOOD | ROOFING => 50,
        ROCK | LEAVES | LAMP => 40,
        BRICK | PLASTER => 30,
        GLASS => 20,
        ASPHALT => 12,
        _ => 6,
    }
}
/// How many cells one sideways or hanging join of this material can carry. A panel left hanging by a cell
/// tears off; a slab joined along its whole edge does not. A join is as strong as the stronger of its two
/// cells. Leaves join only to leaves (support.rs), and there they do not tear: a crown is branches as well, and
/// holds together on its own trunk however it is cut.
pub const fn carries(material: u8) -> u32 {
    match material {
        LEAVES => 1 << 30,
        STEEL => 20000,
        CONCRETE => 2500,
        ROCK => 2000,
        WOOD => 600,
        BRICK | LAMP => 500,
        PLASTER | ROOFING => 400,
        GLASS | ASPHALT => 150,
        _ => 60,
    }
}

/// How many cells the join between two cells can carry.
pub const fn join_carries(a: u8, b: u8) -> u32 {
    if a == LEAVES || b == LEAVES {
        return carries(LEAVES);
    }
    let (ca, cb) = (carries(a), carries(b));
    if ca > cb { ca } else { cb }
}

/// How heavy a cell of this material is, against one of water: what a body weighs and how hard it is to turn.
/// These are the numbers the engine starts with: `weighs` is what is so now.
const fn weighs_own(material: u8) -> f32 {
    match material {
        STEEL => 7.8,
        ROCK => 2.6,
        CONCRETE | GLASS => 2.4,
        ASPHALT => 2.2,
        BRICK | LAMP => 1.9,
        EARTH | SAND | PLASTER | ROOFING => 1.6,
        WOOD => 0.6,
        LEAVES => 0.15,
        _ => 1.0,
    }
}

const WEIGHS_OWN: [f32; MATERIALS as usize] = {
    let mut table = [0.0; MATERIALS as usize];
    let mut m = 0;
    while m < MATERIALS as usize {
        table[m] = weighs_own(m as u8);
        m += 1;
    }
    table
};
thread_local! {
    /// What each material weighs now (#264): a table, not a rule of the build, so that whoever runs the core may
    /// change it while it runs (`set_weighs`). The first of the kernel's tables to be data; the others above
    /// (`gives`, `spans`, `carries`, `burns`) could follow the same way. Only what moves bodies reads it: no cell of
    /// the world is where it is because of it, so two cores with different tables still hold the same world.
    static WEIGHS: std::cell::Cell<[f32; MATERIALS as usize]> = const { std::cell::Cell::new(WEIGHS_OWN) };
}
/// How heavy a cell of this material is, against one of water: what a body weighs and how hard it is to turn.
pub fn weighs(material: u8) -> f32 {
    WEIGHS.with(|w| w.get()[(material % MATERIALS) as usize])
}
/// Sets what a material weighs, from a twentieth of water to fifty times it; anything else (0, a negative, not a
/// number) puts back the engine's own. Returns what it weighs now. A body already made keeps the mass it was made with.
pub fn set_weighs(material: u8, value: f32) -> f32 {
    let at = (material % MATERIALS) as usize;
    WEIGHS.with(|w| {
        let mut table = w.get();
        table[at] = if value.is_finite() && value > 0.0 { value.clamp(0.05, 50.0) } else { WEIGHS_OWN[at] };
        w.set(table);
        table[at]
    })
}

/// How hard a knock a body of this material takes before it breaks: a change of speed, cells a second. A brick
/// wall dropped a metre holds; dropped three, it does not.
pub const fn breaks_at(material: u8) -> f32 {
    match material {
        STEEL => 500.0,
        WOOD => 90.0,
        CONCRETE | ROCK => 70.0,
        LEAVES => 60.0,
        BRICK | LAMP | ROOFING | ASPHALT => 48.0,
        PLASTER => 38.0,
        GLASS => 14.0,
        _ => 40.0,
    }
}

/// How a material burns: how many tenths of a second a cell of it lasts alight, and how readily it catches from a
/// burning neighbour (of 256, each tenth of a second). Nothing at all for what does not burn.
pub const fn burns(material: u8) -> (u16, u8) {
    match material {
        LEAVES => (14, 60),
        GRASS => (20, 9),
        WOOD => (80, 7),
        ROOFING => (60, 6),
        _ => (0, 0),
    }
}

/// How many cells can rest on one cell of this material before it is crushed. A wall of brick bears a house; one
/// brick does not.
pub const fn bears(material: u8) -> u32 {
    match material {
        STEEL => 400_000,
        ROCK | CONCRETE => 40_000,
        WOOD | ASPHALT => 20_000,
        BRICK => 6_000,
        PLASTER | ROOFING | LAMP => 4_000,
        GLASS => 3_000,
        _ => 1 << 30,
    }
}

/// How far, in cells, the weight on a thing of this material may lie outside what carries it before it goes over:
/// how well it takes being bent. A steel post holds an arm out; a brick chimney must stand over its own foot.
pub const fn leans(material: u8) -> f32 {
    match material {
        STEEL | LAMP => 9.0,
        WOOD | LEAVES => 4.0,
        CONCRETE => 2.0,
        _ => 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_a_material_weighs_can_be_set_and_put_back() {
        assert_eq!(weighs(STEEL), 7.8);
        assert_eq!(set_weighs(STEEL, 0.5), 0.5);
        assert_eq!(weighs(STEEL), 0.5);
        assert_eq!(weighs(WOOD), 0.6);
        assert_eq!(set_weighs(STEEL, 1.0e9), 50.0);
        assert_eq!(set_weighs(STEEL, f32::NAN), 7.8);
        assert_eq!(set_weighs(STEEL, 0.0), 7.8);
    }
}
