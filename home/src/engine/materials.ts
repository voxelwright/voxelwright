// The material registry (#74): the one place a material's physical facts live. Every part
// names a material; how it moves, bounces, sounds and looks follows from these facts. Open
// at runtime: the built-ins below register through registerMaterial, the same call a new
// material (a person's, or an agent's) uses. Thermal facts (fire.ts and heat.ts read them)
// are optional: a material that names none does not burn and warms like plaster.

export interface Material {
  /** kg/m³. */
  density: number
  /** Coulomb friction coefficient against itself, 0 to 2. */
  friction: number
  /** Coefficient of restitution, 0 (dead) to 1 (perfectly elastic). */
  restitution: number
  /** 0 (felt, cork) to 1 (steel, glass): how sharp an impact sounds and how little it gives. */
  hardness: number
  /** How it is drawn: base colour, roughness and metalness. */
  look: { color: string; roughness: number; metalness: number }
  /** How it takes heat and fire. Missing: does not burn. */
  heat?: Thermal
}

export interface Thermal {
  /** 0 (never burns: steel, glass, plaster) to 1 (paper, a match). How hot its fire burns and how readily it catches. */
  flammability: number
  /** °C at which it catches. */
  ignition: number
  /** Fraction of its fuel used per second while burning at full: felt 0.12 (gone in seconds), oak 0.02, a candle 0.0005. */
  burnRate: number
  /** 0.1 (warms fast: thin felt, paper) to 4 (slow: steel, stone): how slowly it follows the heat around it. */
  heatCapacity: number
  /** 0 (sheds water: steel, glass) to 1 (soaks it up: felt): how wet water makes it. */
  absorbs: number
}

const THERMAL = { flammability: [0, 1], ignition: [50, 2000], burnRate: [0, 1], heatCapacity: [0.1, 4], absorbs: [0, 1] } as const
/** What a material that names no thermal facts behaves as. */
export const INERT: Thermal = { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 1, absorbs: 0.2 }

const RANGES = { density: [1, 25000], friction: [0, 2], restitution: [0, 1], hardness: [0, 1] } as const
const registry = new Map<string, Material>()
let version = 0

/**
 * Adds or replaces a material. Data only: every number is checked against its range, the
 * colour must be #rrggbb. Returns null, or why it was refused (nothing changes then).
 */
export function registerMaterial(name: string, m: Material): string | null {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(name)) return 'a material name is lowercase letters, digits and dashes'
  if (!m || typeof m !== 'object') return 'a material is an object'
  for (const [key, [lo, hi]] of Object.entries(RANGES)) {
    const v = (m as unknown as Record<string, unknown>)[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return `${key} is a number from ${lo} to ${hi}`
  }
  const l = m.look
  if (!l || typeof l.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(l.color)) return 'look.color is #rrggbb'
  const unit = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1
  if (!unit(l.roughness) || !unit(l.metalness)) return 'look.roughness and look.metalness are 0 to 1'
  let heat: Thermal | undefined
  if (m.heat !== undefined) {
    if (!m.heat || typeof m.heat !== 'object') return 'heat is an object'
    for (const [key, [lo, hi]] of Object.entries(THERMAL)) {
      const v = (m.heat as unknown as Record<string, unknown>)[key]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return `heat.${key} is a number from ${lo} to ${hi}`
    }
    const h = m.heat
    heat = { flammability: h.flammability, ignition: h.ignition, burnRate: h.burnRate, heatCapacity: h.heatCapacity, absorbs: h.absorbs }
  }
  registry.set(name, { density: m.density, friction: m.friction, restitution: m.restitution, hardness: m.hardness, look: { color: l.color, roughness: l.roughness, metalness: l.metalness }, ...(heat ? { heat } : {}) })
  version++
  return null
}

export const material = (name: string): Material | undefined => registry.get(name)
export const materialNames = () => [...registry.keys()]
/** A material's thermal facts, or INERT's. */
export const thermal = (name: string): Thermal => registry.get(name)?.heat ?? INERT
export const isMaterial = (name: unknown): name is string => typeof name === 'string' && registry.has(name)
/** Bumped by every registration, so a world knows to rebuild its pair table. */
export const materialsVersion = () => version

const BUILT_IN: Record<string, Material> = {
  steel: { density: 7850, friction: 0.25, restitution: 0.45, hardness: 1, look: { color: '#dfe2e6', roughness: 0.22, metalness: 0.55 }, heat: { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 3, absorbs: 0 } },
  brass: { density: 8500, friction: 0.3, restitution: 0.4, hardness: 0.9, look: { color: '#c9a04f', roughness: 0.3, metalness: 1 }, heat: { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 2.5, absorbs: 0 } },
  rubber: { density: 1100, friction: 0.9, restitution: 0.8, hardness: 0.25, look: { color: '#d9573f', roughness: 0.7, metalness: 0 }, heat: { flammability: 0.5, ignition: 350, burnRate: 0.015, heatCapacity: 1.5, absorbs: 0 } },
  maple: { density: 700, friction: 0.45, restitution: 0.45, hardness: 0.6, look: { color: '#d8b07c', roughness: 0.55, metalness: 0 }, heat: { flammability: 0.6, ignition: 300, burnRate: 0.02, heatCapacity: 1.6, absorbs: 0.3 } },
  walnut: { density: 650, friction: 0.45, restitution: 0.4, hardness: 0.6, look: { color: '#a8774c', roughness: 0.5, metalness: 0 }, heat: { flammability: 0.6, ignition: 300, burnRate: 0.02, heatCapacity: 1.6, absorbs: 0.3 } },
  /** Painted, lacquered wood: the playfield. Slick, so a steel ball rolls far. */
  lacquer: { density: 700, friction: 0.12, restitution: 0.35, hardness: 0.7, look: { color: '#f1e3c4', roughness: 0.25, metalness: 0 }, heat: { flammability: 0.65, ignition: 280, burnRate: 0.025, heatCapacity: 1.5, absorbs: 0.1 } },
  felt: { density: 300, friction: 0.8, restitution: 0.1, hardness: 0.05, look: { color: '#b8644a', roughness: 0.95, metalness: 0 }, heat: { flammability: 0.9, ignition: 230, burnRate: 0.12, heatCapacity: 0.4, absorbs: 1 } },
  cork: { density: 240, friction: 0.7, restitution: 0.3, hardness: 0.15, look: { color: '#b98a5a', roughness: 0.9, metalness: 0 }, heat: { flammability: 0.55, ignition: 300, burnRate: 0.04, heatCapacity: 0.8, absorbs: 0.6 } },
  glass: { density: 2500, friction: 0.2, restitution: 0.55, hardness: 0.95, look: { color: '#dfeef0', roughness: 0.05, metalness: 0 }, heat: { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 2, absorbs: 0 } },
  plaster: { density: 1100, friction: 0.6, restitution: 0.2, hardness: 0.5, look: { color: '#efe2cc', roughness: 0.9, metalness: 0 }, heat: { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 3, absorbs: 0.4 } },
  /** People and their villagers: felt over a soft body. Followers are kinematic, so density matters only once they can be pushed. */
  /** Candle wax: catches at the wick and burns for hours. */
  wax: { density: 900, friction: 0.5, restitution: 0.2, hardness: 0.3, look: { color: '#f4ecd8', roughness: 0.6, metalness: 0 }, heat: { flammability: 0.35, ignition: 220, burnRate: 0.0005, heatCapacity: 1, absorbs: 0 } },
  /** Books, cards, a match head: catches first, gone fast. */
  paper: { density: 800, friction: 0.5, restitution: 0.1, hardness: 0.2, look: { color: '#efe6d2', roughness: 0.9, metalness: 0 }, heat: { flammability: 1, ignition: 220, burnRate: 0.08, heatCapacity: 0.2, absorbs: 0.8 } },
  /** Glazed pots and bowls: hold heat, never burn. */
  ceramic: { density: 2300, friction: 0.5, restitution: 0.3, hardness: 0.85, look: { color: '#e9e2d4', roughness: 0.4, metalness: 0 }, heat: { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 2.5, absorbs: 0.05 } },
  /** An apple, an onion, a lemon: firm, a little bounce, a dull knock. */
  fruit: { density: 900, friction: 0.6, restitution: 0.25, hardness: 0.3, look: { color: '#e8892c', roughness: 0.6, metalness: 0 }, heat: { flammability: 0.1, ignition: 400, burnRate: 0.01, heatCapacity: 3, absorbs: 0.1 } },
  villager: { density: 600, friction: 0.7, restitution: 0.05, hardness: 0.05, look: { color: '#c97a5a', roughness: 0.95, metalness: 0 }, heat: { flammability: 0, ignition: 2000, burnRate: 0, heatCapacity: 4, absorbs: 0.5 } },
}
for (const [name, m] of Object.entries(BUILT_IN)) registerMaterial(name, m)

/** Drops every material added at runtime and restores the built-ins (the plugin unloading). */
export function resetMaterials() {
  registry.clear()
  for (const [name, m] of Object.entries(BUILT_IN)) registerMaterial(name, m)
}
