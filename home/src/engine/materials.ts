// The material registry (#74): the one place a material's physical facts live. Every part
// names a material; how it moves, bounces, sounds and looks follows from these facts. Branch
// two adds thermal and optical facts (fire, water, heat, light) beside the motion ones here.

export interface Material {
  /** kg/m³. */
  density: number
  /** Coulomb friction coefficient against itself, 0 to about 1.2. */
  friction: number
  /** Coefficient of restitution, 0 (dead) to 1 (perfectly elastic). */
  restitution: number
  /** 0 (felt, cork) to 1 (steel, glass): how sharp an impact sounds and how little it gives. */
  hardness: number
  /** How it is drawn: base colour, roughness and metalness. */
  look: { color: string; roughness: number; metalness: number }
}

export const MATERIALS = {
  steel: { density: 7850, friction: 0.25, restitution: 0.45, hardness: 1, look: { color: '#dfe2e6', roughness: 0.22, metalness: 0.55 } },
  brass: { density: 8500, friction: 0.3, restitution: 0.4, hardness: 0.9, look: { color: '#c9a04f', roughness: 0.3, metalness: 1 } },
  rubber: { density: 1100, friction: 0.9, restitution: 0.8, hardness: 0.25, look: { color: '#d9573f', roughness: 0.7, metalness: 0 } },
  maple: { density: 700, friction: 0.45, restitution: 0.45, hardness: 0.6, look: { color: '#d8b07c', roughness: 0.55, metalness: 0 } },
  walnut: { density: 650, friction: 0.45, restitution: 0.4, hardness: 0.6, look: { color: '#a8774c', roughness: 0.5, metalness: 0 } },
  /** Painted, lacquered wood: the playfield. Slick, so a steel ball rolls far. */
  lacquer: { density: 700, friction: 0.12, restitution: 0.35, hardness: 0.7, look: { color: '#f1e3c4', roughness: 0.25, metalness: 0 } },
  felt: { density: 300, friction: 0.8, restitution: 0.1, hardness: 0.05, look: { color: '#b8644a', roughness: 0.95, metalness: 0 } },
  cork: { density: 240, friction: 0.7, restitution: 0.3, hardness: 0.15, look: { color: '#b98a5a', roughness: 0.9, metalness: 0 } },
  glass: { density: 2500, friction: 0.2, restitution: 0.55, hardness: 0.95, look: { color: '#dfeef0', roughness: 0.05, metalness: 0 } },
  plaster: { density: 1100, friction: 0.6, restitution: 0.2, hardness: 0.5, look: { color: '#efe2cc', roughness: 0.9, metalness: 0 } },
  /** Villagers: felt over a soft body. Kinematic, so density only matters once they can be pushed. */
  villager: { density: 600, friction: 0.7, restitution: 0.05, hardness: 0.05, look: { color: '#c97a5a', roughness: 0.95, metalness: 0 } },
} satisfies Record<string, Material>

export type MaterialName = keyof typeof MATERIALS
export const MATERIAL_NAMES = Object.keys(MATERIALS) as MaterialName[]
export const isMaterial = (name: unknown): name is MaterialName => typeof name === 'string' && Object.hasOwn(MATERIALS, name)
