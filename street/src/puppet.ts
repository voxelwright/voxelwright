// A solver core that solves nothing (#118): each body is where it was last put. The street's
// page builds the engine's World over it, so the page draws the same toys the world process
// simulates, posed from what the wire says, and never steps them itself.
import type { BodyId, BodySpec, Contact, PhysicsCore, Quat, Vec3 } from '../../home/src/engine/core.ts'

const STILL: Vec3 = [0, 0, 0]
const NONE: Contact[] = []

export class Puppet implements PhysicsCore {
  readonly name = 'puppet'
  private places: Vec3[] = []
  private turns: Quat[] = []

  /** How many bodies were ever added: the next body's id. */
  get size() { return this.places.length }

  addBody(spec: BodySpec): BodyId {
    this.places.push([...spec.position])
    this.turns.push(spec.rotation ? [...spec.rotation] : [0, 0, 0, 1])
    return this.places.length - 1
  }
  /** Puts a body where the world process says it is. The arrays are kept, so whoever holds them may change them in place. */
  pose(id: BodyId, position: Vec3, rotation: Quat) {
    this.places[id] = position
    this.turns[id] = rotation
  }
  position(id: BodyId) { return this.places[id] ?? STILL }
  rotation(id: BodyId): Quat { return this.turns[id] ?? [0, 0, 0, 1] }
  setPose(id: BodyId, position: Vec3, rotation: Quat) { this.pose(id, position, rotation) }
  setState(id: BodyId, position: Vec3, _velocity: Vec3, rotation?: Quat) { this.pose(id, position, rotation ?? this.rotation(id)) }
  rest(id: BodyId, position: Vec3, rotation: Quat) { this.pose(id, position, rotation) }

  // Everything a solver does is somebody else's here.
  removeBody() {}
  setGravity() {}
  setRestSpeed() {}
  setCombine() {}
  addHinge() { return 0 }
  addSlider() { return 0 }
  setLimits() {}
  removeJoint() {}
  setMotor() {}
  jointPosition() { return 0 }
  step() {}
  contacts() { return NONE }
  applyImpulse() {}
  velocity() { return STILL }
  setVelocity() {}
  moveKinematic() {}
  setLinearDamping() {}
  setGravityFactor() {}
  setSolid() {}
  mass() { return 1 }
  sleeping() { return false }
  wake() {}
  activity() { return [] }
  angularVelocity() { return STILL }
  setAngularVelocity() {}
  castRay() { return null }
  dispose() {}
}
