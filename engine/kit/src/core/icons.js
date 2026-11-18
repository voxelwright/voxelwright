// Icons are small reliefs: a few voxels standing one voxel proud of the face that carries them.
export const ICONS = {
  chevron: ['#.....#', '.#...#.', '..#.#..', '...#...'],
  plus: ['..#..', '..#..', '#####', '..#..', '..#..'],
  check: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
  cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  drop: ['..#..', '.###.', '.###.', '#####', '#####', '#####', '.###.'],
  seed: ['.##..', '####.', '#####', '.####', '..##.'],
};

/** Put an icon on a part. x, y is its top-left corner; z the layer it stands on. Returns [w, h]. */
export function icon(part, name, x, y, z, mat) {
  const g = ICONS[name];
  if (!g) return [0, 0];
  for (let j = 0; j < g.length; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === '#') part.plot(x + i, y + j, z, mat);
  return [g[0].length, g.length];
}
