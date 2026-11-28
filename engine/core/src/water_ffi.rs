//! What a page or a world process asks of the water beyond its heights (#226): how its layers lie over one another,
//! where it changed, and its surface as bricks of a distance field (water.rs says what a brick holds). Plain
//! functions over the instance's own memory, as lib.rs's are; what they answer with stays where it is until the
//! same question is asked again.

use crate::water::{BRICK_BYTES, DirtyBox, SDF_LODS};
use crate::{INSTANCE, moving};
use std::cell::RefCell;

struct Room {
    brick: [i8; BRICK_BYTES],
    layers: Vec<u32>,
    window: [i32; 4],
}

thread_local! {
    static ROOM: RefCell<Room> = const { RefCell::new(Room { brick: [0; BRICK_BYTES], layers: Vec::new(), window: [0; 4] }) };
}

/// How many layers have water on them: one for a wet column, more where water lies over water.
#[unsafe(no_mangle)]
pub extern "C" fn water_layer_count() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).water.wet())
}

/// The most wet layers any one column holds: 2 where water runs over a bridge and under it.
#[unsafe(no_mangle)]
pub extern "C" fn water_layers_stacked() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).water.stacked())
}

/// How many layers (wet or dry) are known at a column of the world.
#[unsafe(no_mangle)]
pub extern "C" fn water_layers_at(x: i32, z: i32) -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).water.layers_at(x as f32 + 0.5, z as f32 + 0.5).len())
}

/// Every wet layer, five words each (water.rs `tell_layers`): how many words. They are at `water_layers_ptr`.
#[unsafe(no_mangle)]
pub extern "C" fn water_layers_len() -> usize {
    INSTANCE.with_borrow_mut(|i| {
        ROOM.with_borrow_mut(|r| {
            moving(i).water.tell_layers(&mut r.layers);
            r.layers.len()
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn water_layers_ptr() -> *const u32 {
    ROOM.with_borrow(|r| r.layers.as_ptr())
}

/// The window: its low corner in the world (x, z), a column's width in cells, columns each way (0 before any water).
#[unsafe(no_mangle)]
pub extern "C" fn water_window_ptr() -> *const i32 {
    INSTANCE.with_borrow_mut(|i| {
        ROOM.with_borrow_mut(|r| {
            r.window = moving(i).water.window();
            r.window.as_ptr()
        })
    })
}

/// How many boxes water changed in since `water_dirty_clear`. Each is six whole numbers at `water_dirty_boxes_ptr`:
/// its low corner, then its high one (exclusive), in cells of the world.
#[unsafe(no_mangle)]
pub extern "C" fn water_dirty_boxes_len() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).water.dirty().len())
}

#[unsafe(no_mangle)]
pub extern "C" fn water_dirty_boxes_ptr() -> *const DirtyBox {
    INSTANCE.with_borrow_mut(|i| moving(i).water.dirty().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn water_dirty_clear() {
    INSTANCE.with_borrow_mut(|i| moving(i).water.clear_dirty())
}

/// Lets `cells` of water go at a place in the world, of a kind (0 fresh, 1 the sea's). 1 if it was in the window.
#[unsafe(no_mangle)]
pub extern "C" fn water_pour(x: i32, y: i32, z: i32, cells: f32, fluid: u32) -> u32 {
    INSTANCE.with_borrow_mut(|i| {
        let b = moving(i);
        b.water.pour_at(&mut b.ground, x, y, z, cells, fluid as u8) as u32
    })
}

/// A body in the water at a place pushes `cells` of it aside. 1 if there was water there.
#[unsafe(no_mangle)]
pub extern "C" fn water_displace(x: f32, y: f32, z: f32, cells: f32) -> u32 {
    INSTANCE.with_borrow_mut(|i| moving(i).water.displace(x, y, z, cells) as u32)
}

/// Of which layers the distance field is: 0 (as it begins) those under other water, which the heights cannot show;
/// 1 all of them.
#[unsafe(no_mangle)]
pub extern "C" fn water_sdf_cover(all: u32) {
    INSTANCE.with_borrow_mut(|i| moving(i).water.sdf_cover(all != 0))
}

/// How many of the finest bricks hold some of the field's surface. Where they are is at `water_sdf_bricks_ptr`:
/// three whole numbers each, x and z counted in bricks from the window's low corner, y from the world's zero.
#[unsafe(no_mangle)]
pub extern "C" fn water_sdf_brick_count() -> usize {
    INSTANCE.with_borrow_mut(|i| moving(i).water.sdf_bricks().len())
}

#[unsafe(no_mangle)]
pub extern "C" fn water_sdf_bricks_ptr() -> *const [i32; 3] {
    INSTANCE.with_borrow_mut(|i| moving(i).water.sdf_bricks().as_ptr())
}

/// Room for one brick (512 bytes): somewhere for `water_sdf_build_brick` to write when the caller has none.
#[unsafe(no_mangle)]
pub extern "C" fn water_sdf_room() -> *mut i8 {
    ROOM.with_borrow_mut(|r| r.brick.as_mut_ptr())
}

fn build(b: [i32; 3], lod: u32, out: *mut i8) -> u32 {
    if lod >= SDF_LODS {
        return 0;
    }
    INSTANCE.with_borrow_mut(|i| {
        ROOM.with_borrow_mut(|r| {
            let held = moving(i).water.sdf_brick(b, lod, &mut r.brick);
            if !out.is_null() && out != r.brick.as_mut_ptr() {
                // SAFETY: the caller gives the address of 512 bytes of this instance's memory, as it does for every
                // other buffer it hands over; it is not the room just written (checked above), so they do not overlap.
                unsafe { std::ptr::copy_nonoverlapping(r.brick.as_ptr(), out, BRICK_BYTES) };
            }
            held
        })
    })
}

/// Makes the finest brick at (bx, by, bz): 8 x 8 x 8 signed bytes (6 x 6 x 6 of its own and a voxel all round),
/// x fastest, then y, then z, written at `out_ptr` (or at `water_sdf_room` when that is 0). What it holds:
/// 0 nothing, 1 only water, 2 only air near water, 3 a surface.
#[unsafe(no_mangle)]
pub extern "C" fn water_sdf_build_brick(bx: i32, by: i32, bz: i32, out_ptr: *mut i8) -> u32 {
    build([bx, by, bz], 0, out_ptr)
}

/// As `water_sdf_build_brick`, of a brick whose voxels are twice as wide for each step of `lod` (0 to 2), counted in
/// bricks of that size.
#[unsafe(no_mangle)]
pub extern "C" fn water_sdf_build_brick_lod(bx: i32, by: i32, bz: i32, lod: u32, out_ptr: *mut i8) -> u32 {
    build([bx, by, bz], lod, out_ptr)
}
