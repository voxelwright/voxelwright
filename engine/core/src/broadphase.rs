//! Spatial broadphase acceleration (`SpatialHash` + flat `DynamicBvh`) and Union-Find simulation
//! islands (`IslandSolver`) for rigid bodies (#166).
//!
//! Zero external crate dependencies; designed for deterministic, allocation-free reuse across
//! 120 Hz physics substeps in both native and `wasm32-unknown-unknown` builds.

/// Axis-aligned bounding box in world cell coordinates (1 cell = 10 cm).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl Aabb {
    #[inline]
    pub const fn new(min: [f32; 3], max: [f32; 3]) -> Self {
        Self { min, max }
    }

    #[inline]
    pub fn from_center_radius(center: [f32; 3], radius: f32) -> Self {
        let r = radius.max(0.0);
        Self {
            min: [center[0] - r, center[1] - r, center[2] - r],
            max: [center[0] + r, center[1] + r, center[2] + r],
        }
    }

    #[inline]
    pub fn intersects(&self, other: &Aabb) -> bool {
        self.min[0] <= other.max[0]
            && self.max[0] >= other.min[0]
            && self.min[1] <= other.max[1]
            && self.max[1] >= other.min[1]
            && self.min[2] <= other.max[2]
            && self.max[2] >= other.min[2]
    }

    #[inline]
    pub fn expand(&self, margin: f32) -> Aabb {
        Aabb {
            min: [self.min[0] - margin, self.min[1] - margin, self.min[2] - margin],
            max: [self.max[0] + margin, self.max[1] + margin, self.max[2] + margin],
        }
    }

    #[inline]
    pub fn union(&self, other: &Aabb) -> Aabb {
        Aabb {
            min: [
                self.min[0].min(other.min[0]),
                self.min[1].min(other.min[1]),
                self.min[2].min(other.min[2]),
            ],
            max: [
                self.max[0].max(other.max[0]),
                self.max[1].max(other.max[1]),
                self.max[2].max(other.max[2]),
            ],
        }
    }

    #[inline]
    pub fn centroid(&self) -> [f32; 3] {
        [
            0.5 * (self.min[0] + self.max[0]),
            0.5 * (self.min[1] + self.max[1]),
            0.5 * (self.min[2] + self.max[2]),
        ]
    }

    /// Slab-method ray-AABB intersection test.
    ///
    /// `inv_dir` is `[1.0 / dir[0], 1.0 / dir[1], 1.0 / dir[2]]`; non-finite components (rays
    /// parallel to an axis) are handled without NaN issues. Returns entry distance `t` in
    /// `[0.0, max_t]` (returning `0.0` when `origin` lies inside the box).
    #[inline]
    pub fn ray_hit(&self, origin: [f32; 3], inv_dir: [f32; 3], max_t: f32) -> Option<f32> {
        if max_t < 0.0 {
            return None;
        }
        let mut tmin = 0.0f32;
        let mut tmax = max_t;
        for a in 0..3 {
            let inv = inv_dir[a];
            if inv.is_finite() {
                let mut t0 = (self.min[a] - origin[a]) * inv;
                let mut t1 = (self.max[a] - origin[a]) * inv;
                if t0 > t1 {
                    core::mem::swap(&mut t0, &mut t1);
                }
                tmin = tmin.max(t0);
                tmax = tmax.min(t1);
                if tmin > tmax {
                    return None;
                }
            } else if origin[a] < self.min[a] || origin[a] > self.max[a] {
                return None;
            }
        }
        Some(tmin)
    }
}

/// Grid cell width for `SpatialHash`: 32 voxel cells = 3.2 m.
pub const HASH_CELL_SIZE: f32 = 32.0;
/// Bodies larger than 64 voxel cells (6.4 m) along any axis go into the overflow list.
pub const OVERFLOW_SPAN: f32 = 64.0;
/// Cap on hash grid cells touched per body before spilling into the overflow list.
const MAX_CELLS_PER_BODY: i64 = 27;
const INITIAL_BUCKETS: usize = 2048;
const EMPTY: u32 = u32::MAX;

#[derive(Clone, Copy, Debug)]
struct Item {
    index: usize,
    aabb: Aabb,
}

#[derive(Clone, Copy, Debug)]
struct BucketNode {
    slot: u32,
    next: u32,
}

#[inline]
fn cell_hash(gx: i32, gy: i32, gz: i32, mask: usize) -> usize {
    let h = (gx as u32).wrapping_mul(73_856_093)
        ^ (gy as u32).wrapping_mul(19_349_663)
        ^ (gz as u32).wrapping_mul(83_492_791);
    let h = h ^ (h >> 16);
    (h as usize) & mask
}

#[inline]
fn grid_coord(v: f32, inv_cell: f32) -> i32 {
    (v * inv_cell).floor() as i32
}

/// Fixed-cell spatial hash (32-cell = 3.2 m grid) with an overflow list for giant bodies (> 64
/// cells) and O(1) generation-stamped clearing.
pub struct SpatialHash {
    cell_size: f32,
    inv_cell: f32,
    items: Vec<Item>,
    overflow: Vec<u32>,
    /// Per-bucket `(stamp, head_node_idx)`.
    buckets: Vec<(u32, u32)>,
    bucket_mask: usize,
    stamp: u32,
    nodes: Vec<BucketNode>,
    active_buckets: Vec<u32>,
}

impl Default for SpatialHash {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialHash {
    pub fn new() -> Self {
        Self::with_cell_size(HASH_CELL_SIZE)
    }

    pub fn with_cell_size(cell_size: f32) -> Self {
        let cell_size = cell_size.max(1.0);
        Self {
            cell_size,
            inv_cell: 1.0 / cell_size,
            items: Vec::new(),
            overflow: Vec::new(),
            buckets: vec![(0, EMPTY); INITIAL_BUCKETS],
            bucket_mask: INITIAL_BUCKETS - 1,
            stamp: 1,
            nodes: Vec::new(),
            active_buckets: Vec::new(),
        }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.overflow.clear();
        self.nodes.clear();
        self.active_buckets.clear();
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.buckets.fill((0, EMPTY));
            self.stamp = 1;
        }
    }

    pub fn insert(&mut self, index: usize, aabb: Aabb) {
        let slot = self.items.len() as u32;
        self.items.push(Item { index, aabb });
        self.insert_slot(slot, aabb);
    }

    fn insert_slot(&mut self, slot: u32, aabb: Aabb) {
        let giant = (0..3).any(|a| {
            !aabb.min[a].is_finite()
                || !aabb.max[a].is_finite()
                || (aabb.max[a] - aabb.min[a]) > OVERFLOW_SPAN
        });
        if giant {
            self.overflow.push(slot);
            return;
        }
        let lo = [
            grid_coord(aabb.min[0], self.inv_cell),
            grid_coord(aabb.min[1], self.inv_cell),
            grid_coord(aabb.min[2], self.inv_cell),
        ];
        let hi = [
            grid_coord(aabb.max[0], self.inv_cell),
            grid_coord(aabb.max[1], self.inv_cell),
            grid_coord(aabb.max[2], self.inv_cell),
        ];
        let dx = (hi[0] as i64 - lo[0] as i64 + 1).max(0);
        let dy = (hi[1] as i64 - lo[1] as i64 + 1).max(0);
        let dz = (hi[2] as i64 - lo[2] as i64 + 1).max(0);
        let count = dx.saturating_mul(dy).saturating_mul(dz);
        if count == 0 || count > MAX_CELLS_PER_BODY {
            self.overflow.push(slot);
            return;
        }
        let stamp = self.stamp;
        let mask = self.bucket_mask;
        for gz in lo[2]..=hi[2] {
            for gy in lo[1]..=hi[1] {
                for gx in lo[0]..=hi[0] {
                    let h = cell_hash(gx, gy, gz, mask);
                    let bucket = &mut self.buckets[h];
                    let head = if bucket.0 == stamp {
                        bucket.1
                    } else {
                        self.active_buckets.push(h as u32);
                        bucket.0 = stamp;
                        EMPTY
                    };
                    let node_idx = self.nodes.len() as u32;
                    self.nodes.push(BucketNode { slot, next: head });
                    bucket.1 = node_idx;
                }
            }
        }
    }

    /// Re-buckets only if the table load factor grew past 0.5; otherwise O(1).
    pub fn rebuild(&mut self) {
        if self.items.len() * 2 <= self.buckets.len() {
            return;
        }
        let new_len = (self.items.len() * 4).next_power_of_two().max(INITIAL_BUCKETS);
        self.buckets.resize(new_len, (0, EMPTY));
        self.buckets.fill((0, EMPTY));
        self.bucket_mask = new_len - 1;
        self.stamp = 1;
        self.overflow.clear();
        self.nodes.clear();
        self.active_buckets.clear();
        for slot in 0..self.items.len() {
            let aabb = self.items[slot].aabb;
            self.insert_slot(slot as u32, aabb);
        }
    }

    /// Emits all overlapping `(i, j)` pairs (`i < j`), sorted and deduplicated.
    pub fn query_pairs(&self, out: &mut Vec<(usize, usize)>) {
        out.clear();
        if self.items.len() < 2 {
            return;
        }
        for &b_idx in &self.active_buckets {
            let mut e1 = self.buckets[b_idx as usize].1;
            while e1 != EMPTY {
                let n1 = self.nodes[e1 as usize];
                let s1 = n1.slot as usize;
                let a = self.items[s1];
                let mut e2 = n1.next;
                while e2 != EMPTY {
                    let n2 = self.nodes[e2 as usize];
                    let s2 = n2.slot as usize;
                    if s1 != s2 {
                        let b = self.items[s2];
                        if a.aabb.intersects(&b.aabb) {
                            out.push(if a.index < b.index {
                                (a.index, b.index)
                            } else {
                                (b.index, a.index)
                            });
                        }
                    }
                    e2 = n2.next;
                }
                e1 = n1.next;
            }
        }
        for &o_slot in &self.overflow {
            let o = o_slot as usize;
            let a = self.items[o];
            for s in 0..self.items.len() {
                if s == o {
                    continue;
                }
                let b = self.items[s];
                if a.aabb.intersects(&b.aabb) {
                    out.push(if a.index < b.index {
                        (a.index, b.index)
                    } else {
                        (b.index, a.index)
                    });
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }

    /// Emits all body indices whose AABB intersects `aabb`, sorted and deduplicated.
    pub fn query_aabb(&self, aabb: Aabb, out: &mut Vec<usize>) {
        out.clear();
        if self.items.is_empty() {
            return;
        }
        let finite = (0..3).all(|a| aabb.min[a].is_finite() && aabb.max[a].is_finite());
        if !finite {
            for item in &self.items {
                if item.aabb.intersects(&aabb) {
                    out.push(item.index);
                }
            }
            out.sort_unstable();
            out.dedup();
            return;
        }
        let lo = [
            grid_coord(aabb.min[0], self.inv_cell),
            grid_coord(aabb.min[1], self.inv_cell),
            grid_coord(aabb.min[2], self.inv_cell),
        ];
        let hi = [
            grid_coord(aabb.max[0], self.inv_cell),
            grid_coord(aabb.max[1], self.inv_cell),
            grid_coord(aabb.max[2], self.inv_cell),
        ];
        let dx = (hi[0] as i64 - lo[0] as i64 + 1).max(0);
        let dy = (hi[1] as i64 - lo[1] as i64 + 1).max(0);
        let dz = (hi[2] as i64 - lo[2] as i64 + 1).max(0);
        let count = dx.saturating_mul(dy).saturating_mul(dz);
        if count == 0 || count > 64 {
            for item in &self.items {
                if item.aabb.intersects(&aabb) {
                    out.push(item.index);
                }
            }
        } else {
            let stamp = self.stamp;
            let mask = self.bucket_mask;
            for gz in lo[2]..=hi[2] {
                for gy in lo[1]..=hi[1] {
                    for gx in lo[0]..=hi[0] {
                        let h = cell_hash(gx, gy, gz, mask);
                        let bucket = self.buckets[h];
                        if bucket.0 != stamp {
                            continue;
                        }
                        let mut e = bucket.1;
                        while e != EMPTY {
                            let node = self.nodes[e as usize];
                            let item = self.items[node.slot as usize];
                            if item.aabb.intersects(&aabb) {
                                out.push(item.index);
                            }
                            e = node.next;
                        }
                    }
                }
            }
            for &o_slot in &self.overflow {
                let item = self.items[o_slot as usize];
                if item.aabb.intersects(&aabb) {
                    out.push(item.index);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }

    /// Raycasts through the spatial hash (3D DDA up to 256 grid steps, falling back to linear scan
    /// for very long rays or small item counts). Output is sorted and deduplicated.
    pub fn raycast(&self, origin: [f32; 3], inv_dir: [f32; 3], max_t: f32, out: &mut Vec<usize>) {
        out.clear();
        if self.items.is_empty() || max_t < 0.0 {
            return;
        }
        if self.items.len() <= 64 || !max_t.is_finite() {
            for item in &self.items {
                if item.aabb.ray_hit(origin, inv_dir, max_t).is_some() {
                    out.push(item.index);
                }
            }
            out.sort_unstable();
            out.dedup();
            return;
        }
        let dir = [
            if inv_dir[0].is_finite() && inv_dir[0] != 0.0 { 1.0 / inv_dir[0] } else { 0.0 },
            if inv_dir[1].is_finite() && inv_dir[1] != 0.0 { 1.0 / inv_dir[1] } else { 0.0 },
            if inv_dir[2].is_finite() && inv_dir[2] != 0.0 { 1.0 / inv_dir[2] } else { 0.0 },
        ];
        let mut cell = [
            grid_coord(origin[0], self.inv_cell),
            grid_coord(origin[1], self.inv_cell),
            grid_coord(origin[2], self.inv_cell),
        ];
        let step = [
            if dir[0] > 0.0 { 1 } else if dir[0] < 0.0 { -1 } else { 0 },
            if dir[1] > 0.0 { 1 } else if dir[1] < 0.0 { -1 } else { 0 },
            if dir[2] > 0.0 { 1 } else if dir[2] < 0.0 { -1 } else { 0 },
        ];
        let mut t_max = [0.0f32; 3];
        let mut t_delta = [f32::INFINITY; 3];
        for a in 0..3 {
            if step[a] > 0 {
                let next_border = (cell[a] + 1) as f32 * self.cell_size;
                t_max[a] = (next_border - origin[a]) * inv_dir[a];
                t_delta[a] = self.cell_size * inv_dir[a].abs();
            } else if step[a] < 0 {
                let next_border = cell[a] as f32 * self.cell_size;
                t_max[a] = (next_border - origin[a]) * inv_dir[a];
                t_delta[a] = self.cell_size * inv_dir[a].abs();
            } else {
                t_max[a] = f32::INFINITY;
            }
        }
        let stamp = self.stamp;
        let mask = self.bucket_mask;
        let mut t = 0.0f32;
        let mut steps = 0usize;
        while t <= max_t {
            let h = cell_hash(cell[0], cell[1], cell[2], mask);
            let bucket = self.buckets[h];
            if bucket.0 == stamp {
                let mut e = bucket.1;
                while e != EMPTY {
                    let node = self.nodes[e as usize];
                    let item = self.items[node.slot as usize];
                    if item.aabb.ray_hit(origin, inv_dir, max_t).is_some() {
                        out.push(item.index);
                    }
                    e = node.next;
                }
            }
            steps += 1;
            if steps >= 256 {
                // Very long ray: fall back to checking all items rather than risking missed hits.
                out.clear();
                for item in &self.items {
                    if item.aabb.ray_hit(origin, inv_dir, max_t).is_some() {
                        out.push(item.index);
                    }
                }
                out.sort_unstable();
                out.dedup();
                return;
            }
            if t_max[0] <= t_max[1] && t_max[0] <= t_max[2] {
                t = t_max[0];
                cell[0] += step[0];
                t_max[0] += t_delta[0];
            } else if t_max[1] <= t_max[2] {
                t = t_max[1];
                cell[1] += step[1];
                t_max[1] += t_delta[1];
            } else {
                t = t_max[2];
                cell[2] += step[2];
                t_max[2] += t_delta[2];
            }
        }
        for &o_slot in &self.overflow {
            let item = self.items[o_slot as usize];
            if item.aabb.ray_hit(origin, inv_dir, max_t).is_some() {
                out.push(item.index);
            }
        }
        out.sort_unstable();
        out.dedup();
    }
}

/// Flat array-backed bounding volume hierarchy (pre-order binary AABB tree).
///
/// Built top-down with median splits along the longest centroid axis so tree depth stays strictly
/// bounded by `ceil(log2(N)) + 1`, allowing fixed-stack traversal with zero heap allocations.
#[derive(Clone, Copy, Debug)]
struct BvhNode {
    aabb: Aabb,
    /// For internal nodes: index of the right child (the left child is always `node_idx + 1`).
    /// For leaf nodes: slot index into `DynamicBvh::items`.
    right_or_item: u32,
    is_leaf: u8,
}

#[derive(Default)]
pub struct DynamicBvh {
    items: Vec<Item>,
    order: Vec<u32>,
    nodes: Vec<BvhNode>,
}

impl DynamicBvh {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.order.clear();
        self.nodes.clear();
    }

    pub fn insert(&mut self, index: usize, aabb: Aabb) {
        self.items.push(Item { index, aabb });
    }

    /// Rebuilds the flat pre-order AABB tree over all inserted items, reusing internal buffers.
    pub fn rebuild(&mut self) {
        self.nodes.clear();
        self.order.clear();
        let n = self.items.len();
        if n == 0 {
            return;
        }
        self.order.extend(0..n as u32);
        let needed = 2 * n - 1;
        if self.nodes.capacity() < needed {
            self.nodes.reserve(needed - self.nodes.len());
        }
        self.build_range(0, n);
    }

    fn build_range(&mut self, start: usize, end: usize) -> usize {
        let mut bounds = self.items[self.order[start] as usize].aabb;
        let first_c = bounds.centroid();
        let (mut cmin, mut cmax) = (first_c, first_c);
        for &slot in &self.order[start + 1..end] {
            let aabb = self.items[slot as usize].aabb;
            bounds = bounds.union(&aabb);
            let c = aabb.centroid();
            for a in 0..3 {
                cmin[a] = cmin[a].min(c[a]);
                cmax[a] = cmax[a].max(c[a]);
            }
        }
        let node_idx = self.nodes.len();
        if end - start == 1 {
            self.nodes.push(BvhNode {
                aabb: bounds,
                right_or_item: self.order[start],
                is_leaf: 1,
            });
            return node_idx;
        }
        let ext = [cmax[0] - cmin[0], cmax[1] - cmin[1], cmax[2] - cmin[2]];
        let axis = if ext[0] >= ext[1] && ext[0] >= ext[2] {
            0
        } else if ext[1] >= ext[2] {
            1
        } else {
            2
        };
        let mid = start + (end - start) / 2;
        let items = &self.items;
        self.order[start..end].select_nth_unstable_by(mid - start, |&a, &b| {
            let ca = items[a as usize].aabb.min[axis] + items[a as usize].aabb.max[axis];
            let cb = items[b as usize].aabb.min[axis] + items[b as usize].aabb.max[axis];
            ca.total_cmp(&cb).then_with(|| a.cmp(&b))
        });
        // Reserve internal node slot; left child is placed immediately at `node_idx + 1`.
        self.nodes.push(BvhNode { aabb: bounds, right_or_item: 0, is_leaf: 0 });
        self.build_range(start, mid);
        let right = self.build_range(mid, end);
        self.nodes[node_idx].right_or_item = right as u32;
        node_idx
    }

    pub fn query_pairs(&self, out: &mut Vec<(usize, usize)>) {
        out.clear();
        if self.items.len() < 2 {
            return;
        }
        if self.nodes.is_empty() {
            for i in 0..self.items.len() {
                for j in i + 1..self.items.len() {
                    if self.items[i].aabb.intersects(&self.items[j].aabb) {
                        let (a, b) = (self.items[i].index, self.items[j].index);
                        out.push(if a < b { (a, b) } else { (b, a) });
                    }
                }
            }
            out.sort_unstable();
            out.dedup();
            return;
        }
        let mut stack = [0usize; 64];
        for slot in 0..self.items.len() {
            let a = self.items[slot];
            if !self.nodes[0].aabb.intersects(&a.aabb) {
                continue;
            }
            let mut sp = 1usize;
            stack[0] = 0;
            while sp > 0 {
                sp -= 1;
                let idx = stack[sp];
                let node = self.nodes[idx];
                if node.is_leaf != 0 {
                    let other_slot = node.right_or_item as usize;
                    if other_slot > slot {
                        let b = self.items[other_slot];
                        if a.aabb.intersects(&b.aabb) {
                            out.push(if a.index < b.index {
                                (a.index, b.index)
                            } else {
                                (b.index, a.index)
                            });
                        }
                    }
                } else {
                    let left = idx + 1;
                    let right = node.right_or_item as usize;
                    if self.nodes[right].aabb.intersects(&a.aabb) && sp < stack.len() {
                        stack[sp] = right;
                        sp += 1;
                    }
                    if self.nodes[left].aabb.intersects(&a.aabb) && sp < stack.len() {
                        stack[sp] = left;
                        sp += 1;
                    }
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }

    pub fn query_aabb(&self, aabb: Aabb, out: &mut Vec<usize>) {
        out.clear();
        if self.items.is_empty() {
            return;
        }
        if self.nodes.is_empty() {
            for item in &self.items {
                if item.aabb.intersects(&aabb) {
                    out.push(item.index);
                }
            }
            out.sort_unstable();
            out.dedup();
            return;
        }
        if !self.nodes[0].aabb.intersects(&aabb) {
            return;
        }
        let mut stack = [0usize; 64];
        let mut sp = 1usize;
        stack[0] = 0;
        while sp > 0 {
            sp -= 1;
            let idx = stack[sp];
            let node = self.nodes[idx];
            if node.is_leaf != 0 {
                out.push(self.items[node.right_or_item as usize].index);
            } else {
                let left = idx + 1;
                let right = node.right_or_item as usize;
                if self.nodes[right].aabb.intersects(&aabb) && sp < stack.len() {
                    stack[sp] = right;
                    sp += 1;
                }
                if self.nodes[left].aabb.intersects(&aabb) && sp < stack.len() {
                    stack[sp] = left;
                    sp += 1;
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }

    pub fn raycast(&self, origin: [f32; 3], inv_dir: [f32; 3], max_t: f32, out: &mut Vec<usize>) {
        out.clear();
        if self.items.is_empty() || max_t < 0.0 {
            return;
        }
        if self.nodes.is_empty() {
            for item in &self.items {
                if item.aabb.ray_hit(origin, inv_dir, max_t).is_some() {
                    out.push(item.index);
                }
            }
            out.sort_unstable();
            out.dedup();
            return;
        }
        if self.nodes[0].aabb.ray_hit(origin, inv_dir, max_t).is_none() {
            return;
        }
        let mut stack = [0usize; 64];
        let mut sp = 1usize;
        stack[0] = 0;
        while sp > 0 {
            sp -= 1;
            let idx = stack[sp];
            let node = self.nodes[idx];
            if node.is_leaf != 0 {
                out.push(self.items[node.right_or_item as usize].index);
            } else {
                let left = idx + 1;
                let right = node.right_or_item as usize;
                if self.nodes[right].aabb.ray_hit(origin, inv_dir, max_t).is_some()
                    && sp < stack.len()
                {
                    stack[sp] = right;
                    sp += 1;
                }
                if self.nodes[left].aabb.ray_hit(origin, inv_dir, max_t).is_some()
                    && sp < stack.len()
                {
                    stack[sp] = left;
                    sp += 1;
                }
            }
        }
        out.sort_unstable();
        out.dedup();
    }
}

/// Combined broadphase owning a `SpatialHash` (fast O(N) substep pair queries & local AABB queries)
/// and a `DynamicBvh` (O(log N) unbounded raycasts and wide AABB queries).
#[derive(Default)]
pub struct Broadphase {
    pub hash: SpatialHash,
    pub bvh: DynamicBvh,
    bvh_ready: bool,
}

impl Broadphase {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.hash.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.hash.is_empty()
    }

    pub fn clear(&mut self) {
        self.hash.clear();
        self.bvh.clear();
        self.bvh_ready = false;
    }

    pub fn insert(&mut self, index: usize, aabb: Aabb) {
        self.hash.insert(index, aabb);
        self.bvh.insert(index, aabb);
        self.bvh_ready = false;
    }

    /// Populates only the spatial hash (fast path for 120 Hz physics substeps).
    pub fn clear_hash_only(&mut self) {
        self.hash.clear();
        self.bvh_ready = false;
    }

    #[inline]
    pub fn insert_hash_only(&mut self, index: usize, aabb: Aabb) {
        self.hash.insert(index, aabb);
    }

    #[inline]
    pub fn rebuild_hash(&mut self) {
        self.hash.rebuild();
    }

    /// Rebuilds both the spatial hash (if needed) and the flat BVH.
    pub fn rebuild(&mut self) {
        self.hash.rebuild();
        self.bvh.rebuild();
        self.bvh_ready = true;
    }

    #[inline]
    pub fn query_pairs(&self, out: &mut Vec<(usize, usize)>) {
        self.hash.query_pairs(out);
    }

    #[inline]
    pub fn query_aabb(&self, aabb: Aabb, out: &mut Vec<usize>) {
        self.hash.query_aabb(aabb, out);
    }

    #[inline]
    pub fn raycast(&self, origin: [f32; 3], inv_dir: [f32; 3], max_t: f32, out: &mut Vec<usize>) {
        if self.bvh_ready {
            self.bvh.raycast(origin, inv_dir, max_t, out);
        } else {
            self.hash.raycast(origin, inv_dir, max_t, out);
        }
    }
}

/// Connected component of bodies in contact.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Island {
    pub members: Vec<usize>,
}

/// Union-Find (disjoint-set) solver with path compression and union by rank.
///
/// Reuses all internal buffers across steps so building islands performs zero allocations once warm.
#[derive(Default)]
pub struct IslandSolver {
    parent: Vec<usize>,
    rank: Vec<u8>,
    root_slot: Vec<usize>,
    islands: Vec<Island>,
    count: usize,
}

impl IslandSolver {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self, n: usize) {
        self.parent.clear();
        self.parent.extend(0..n);
        self.rank.clear();
        self.rank.resize(n, 0);
        self.count = 0;
    }

    #[inline]
    pub fn find(&mut self, x: usize) -> usize {
        let mut root = x;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        let mut cur = x;
        while self.parent[cur] != root {
            let next = self.parent[cur];
            self.parent[cur] = root;
            cur = next;
        }
        root
    }

    #[inline]
    pub fn union(&mut self, a: usize, b: usize) {
        if a >= self.parent.len() || b >= self.parent.len() {
            return;
        }
        let ra = self.find(a);
        let rb = self.find(b);
        if ra == rb {
            return;
        }
        if self.rank[ra] < self.rank[rb] {
            self.parent[ra] = rb;
        } else if self.rank[ra] > self.rank[rb] {
            self.parent[rb] = ra;
        } else if ra < rb {
            self.parent[rb] = ra;
            self.rank[ra] = self.rank[ra].saturating_add(1);
        } else {
            self.parent[ra] = rb;
            self.rank[rb] = self.rank[rb].saturating_add(1);
        }
    }

    /// Groups indices `0..n` into deterministic connected islands.
    pub fn build_islands(&mut self, n: usize) -> &[Island] {
        let n = n.min(self.parent.len());
        self.root_slot.clear();
        self.root_slot.resize(n, usize::MAX);
        self.count = 0;
        for i in 0..n {
            let r = self.find(i);
            let slot = if self.root_slot[r] == usize::MAX {
                let s = self.count;
                self.count += 1;
                if s >= self.islands.len() {
                    self.islands.push(Island::default());
                } else {
                    self.islands[s].members.clear();
                }
                self.root_slot[r] = s;
                s
            } else {
                self.root_slot[r]
            };
            self.islands[slot].members.push(i);
        }
        &self.islands[..self.count]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic xorshift32 PRNG for reproducible tests without external crates.
    struct Rng(u32);
    impl Rng {
        fn next_u32(&mut self) -> u32 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            self.0 = x;
            x
        }
        fn f32(&mut self, lo: f32, hi: f32) -> f32 {
            let t = (self.next_u32() as f64 / u32::MAX as f64) as f32;
            lo + t * (hi - lo)
        }
    }

    fn random_aabbs(count: usize, seed: u32, spread: f32) -> Vec<Aabb> {
        let mut rng = Rng(seed);
        (0..count)
            .map(|i| {
                let c = [rng.f32(-spread, spread), rng.f32(0.0, spread), rng.f32(-spread, spread)];
                // Include a mix of small, medium, and occasional giant (> 64 cells) boxes.
                let half = if i % 40 == 0 {
                    [rng.f32(35.0, 50.0), rng.f32(35.0, 50.0), rng.f32(35.0, 50.0)]
                } else {
                    [rng.f32(2.0, 14.0), rng.f32(2.0, 14.0), rng.f32(2.0, 14.0)]
                };
                Aabb::new(
                    [c[0] - half[0], c[1] - half[1], c[2] - half[2]],
                    [c[0] + half[0], c[1] + half[1], c[2] + half[2]],
                )
            })
            .collect()
    }

    #[test]
    fn broadphase_parity_with_brute_force_200_aabbs() {
        let boxes = random_aabbs(200, 0xA1B2_C3D4, 140.0);
        let mut expected = Vec::new();
        for i in 0..boxes.len() {
            for j in i + 1..boxes.len() {
                if boxes[i].intersects(&boxes[j]) {
                    expected.push((i, j));
                }
            }
        }
        assert!(expected.len() > 20, "test scene must have non-trivial overlaps, got {}", expected.len());

        let mut hash = SpatialHash::new();
        let mut bvh = DynamicBvh::new();
        let mut bp = Broadphase::new();
        for (i, &b) in boxes.iter().enumerate() {
            hash.insert(i, b);
            bvh.insert(i, b);
            bp.insert(i, b);
        }
        hash.rebuild();
        bvh.rebuild();
        bp.rebuild();

        let (mut hash_pairs, mut bvh_pairs, mut bp_pairs) = (Vec::new(), Vec::new(), Vec::new());
        hash.query_pairs(&mut hash_pairs);
        bvh.query_pairs(&mut bvh_pairs);
        bp.query_pairs(&mut bp_pairs);

        assert_eq!(hash_pairs, expected, "SpatialHash pairs must match brute-force O(N^2)");
        assert_eq!(bvh_pairs, expected, "DynamicBvh pairs must match brute-force O(N^2)");
        assert_eq!(bp_pairs, expected, "Broadphase pairs must match brute-force O(N^2)");

        // Also check AABB query parity on several query windows.
        let queries = [
            Aabb::new([-30.0, 0.0, -30.0], [30.0, 40.0, 30.0]),
            Aabb::new([40.0, 20.0, -80.0], [110.0, 90.0, 10.0]),
            Aabb::new([-500.0, -500.0, -500.0], [-450.0, -450.0, -450.0]),
        ];
        let (mut q_hash, mut q_bvh) = (Vec::new(), Vec::new());
        for q in queries {
            let exp: Vec<usize> = boxes
                .iter()
                .enumerate()
                .filter_map(|(i, b)| b.intersects(&q).then_some(i))
                .collect();
            hash.query_aabb(q, &mut q_hash);
            bvh.query_aabb(q, &mut q_bvh);
            assert_eq!(q_hash, exp, "SpatialHash query_aabb mismatch");
            assert_eq!(q_bvh, exp, "DynamicBvh query_aabb mismatch");
        }
    }

    #[test]
    fn broadphase_raycast_hits_intersected_and_skips_missed() {
        let boxes = vec![
            Aabb::new([10.0, 0.0, -2.0], [14.0, 4.0, 2.0]),   // 0: on +X ray
            Aabb::new([30.0, 1.0, -1.0], [36.0, 5.0, 1.0]),   // 1: on +X ray further out
            Aabb::new([20.0, 10.0, -2.0], [24.0, 14.0, 2.0]), // 2: above ray (missed)
            Aabb::new([-20.0, 0.0, -2.0], [-10.0, 4.0, 2.0]), // 3: behind ray (missed)
            Aabb::new([80.0, 0.0, -2.0], [84.0, 4.0, 2.0]),   // 4: beyond max_t (missed)
            Aabb::new([-1.0, 0.0, -1.0], [1.0, 4.0, 1.0]),    // 5: encloses origin (hit at t=0)
        ];

        let mut bp = Broadphase::new();
        for (i, &b) in boxes.iter().enumerate() {
            bp.insert(i, b);
        }
        bp.rebuild();

        let origin = [0.0, 2.0, 0.0];
        let dir = [1.0f32, 0.0, 0.0];
        let inv_dir = [1.0 / dir[0], 1.0 / dir[1], 1.0 / dir[2]];
        let max_t = 50.0;

        let mut bvh_hits = Vec::new();
        let mut hash_hits = Vec::new();
        bp.raycast(origin, inv_dir, max_t, &mut bvh_hits);
        bp.hash.raycast(origin, inv_dir, max_t, &mut hash_hits);

        assert_eq!(bvh_hits, vec![0, 1, 5], "BVH raycast must hit only intersected boxes within max_t");
        assert_eq!(hash_hits, vec![0, 1, 5], "SpatialHash raycast must match BVH raycast");

        // Diagonal ray test against 120 random AABBs verifying exact parity with brute-force.
        let rand_boxes = random_aabbs(120, 0x55AA_1234, 120.0);
        bp.clear();
        for (i, &b) in rand_boxes.iter().enumerate() {
            bp.insert(i, b);
        }
        bp.rebuild();
        let orig = [-120.0, 10.0, -120.0];
        let d = [0.6f32, 0.2, 0.7745967];
        let inv = [1.0 / d[0], 1.0 / d[1], 1.0 / d[2]];
        let expected: Vec<usize> = rand_boxes
            .iter()
            .enumerate()
            .filter_map(|(i, b)| b.ray_hit(orig, inv, 300.0).is_some().then_some(i))
            .collect();
        bp.raycast(orig, inv, 300.0, &mut bvh_hits);
        bp.hash.raycast(orig, inv, 300.0, &mut hash_hits);
        assert_eq!(bvh_hits, expected);
        assert_eq!(hash_hits, expected);
    }

    #[test]
    fn island_solver_groups_connected_components_deterministically() {
        let mut solver = IslandSolver::new();
        solver.reset(6);
        solver.union(0, 1);
        solver.union(1, 2);
        solver.union(3, 5);
        let islands = solver.build_islands(6);
        assert_eq!(islands.len(), 3);
        assert_eq!(islands[0].members, vec![0, 1, 2]);
        assert_eq!(islands[1].members, vec![3, 5]);
        assert_eq!(islands[2].members, vec![4]);
    }

    #[test]
    fn broadphase_1000_bodies_query_pairs_under_1ms() {
        // 1,000 realistic debris bodies in a demolition zone (32 m x 8 m x 32 m = 320 x 80 x 320 cells)
        // with hundreds of overlapping pairs plus occasional giant structural chunks.
        let mut rng = Rng(0xDEAD_BEEF);
        let boxes: Vec<Aabb> = (0..1000)
            .map(|i| {
                let c = [rng.f32(0.0, 320.0), rng.f32(0.0, 80.0), rng.f32(0.0, 320.0)];
                let half = if i % 100 == 0 {
                    [rng.f32(34.0, 42.0), rng.f32(34.0, 42.0), rng.f32(34.0, 42.0)]
                } else {
                    [rng.f32(3.0, 12.0), rng.f32(3.0, 12.0), rng.f32(3.0, 12.0)]
                };
                Aabb::new(
                    [c[0] - half[0], c[1] - half[1], c[2] - half[2]],
                    [c[0] + half[0], c[1] + half[1], c[2] + half[2]],
                )
            })
            .collect();

        let mut hash = SpatialHash::new();
        let mut pairs = Vec::with_capacity(2048);
        // Warm up allocations.
        for (i, &b) in boxes.iter().enumerate() {
            hash.insert(i, b);
        }
        hash.rebuild();
        hash.query_pairs(&mut pairs);
        assert!(pairs.len() > 200, "benchmark scene must exercise dense overlaps, got {}", pairs.len());

        // Measure 50 iterations of clear + insert + rebuild + query_pairs.
        let iters = 50u32;
        let t0 = std::time::Instant::now();
        for _ in 0..iters {
            hash.clear();
            for (i, &b) in boxes.iter().enumerate() {
                hash.insert(i, b);
            }
            hash.rebuild();
            hash.query_pairs(&mut pairs);
        }
        let avg_ms = t0.elapsed().as_secs_f64() * 1000.0 / iters as f64;
        eprintln!("broadphase 1000 bodies avg: {avg_ms:.3} ms ({} overlapping pairs)", pairs.len());
        #[cfg(not(debug_assertions))]
        assert!(avg_ms < 1.0, "1,000-body broadphase query_pairs took {avg_ms:.3} ms (>= 1.0 ms budget)");
    }
}
