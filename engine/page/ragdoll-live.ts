// Associates street residents with the solver's own ragdoll identifiers (#166).
import {
  BONE, RAGDOLL_MODE, poseToLimbTransforms, type BoneId, type LimbTransform,
  type RagdollPoseRecord, type RagdollRenderPose, type Vec3,
} from './ragdoll-bridge.ts'
import type { CombatSound } from './sound/combat.ts'

type Reply<T> = T | Promise<T>
export interface RagdollMoverCallbacks {
  ragdollSpawn(feet: Vec3): Reply<number>
  ragdollHit(id: number, bone: BoneId, impulse: Vec3, cutEnergy: number): Reply<boolean>
  /** The final feet anchor is available to the NPC owner when locomotion resumes. */
  onSettled?(npcId: number, pose: RagdollRenderPose): void
  combatAudio?: Pick<CombatSound, 'bluntHit' | 'bladeStab' | 'shockwaveBoom'>
}

export type HitOrBlast = BoneId | { bone: BoneId; cutEnergy?: number } | { radius: number }
interface Actor {
  npcId: number
  spawn: Promise<number>
  mover: RagdollMoverCallbacks
  pendingHits: number
  pose?: RagdollRenderPose
  // POSE has no detached-body translations. Keep the joint frame at first observed separation.
  detached: Map<BoneId, LimbTransform>
}

export class RagdollLiveController {
  private byNpc = new Map<number, Actor>()
  private byRagdoll = new Map<number, Actor>()

  poseFor(npcId: number): RagdollRenderPose | undefined {
    return this.byNpc.get(npcId)?.pose
  }

  detachedFor(npcId: number): ReadonlyMap<BoneId, LimbTransform> | undefined {
    return this.byNpc.get(npcId)?.detached
  }

  /** Use a bone for a blunt hit, a bone and cut energy for a blade, or a radius for a blast. */
  async onHitOrBlast(npcId: number, npcPos: Readonly<Vec3>, impulse: Readonly<Vec3>, boneOrRadius: HitOrBlast, mover: RagdollMoverCallbacks): Promise<boolean> {
    const at: Vec3 = [...npcPos], push: Vec3 = [...impulse]
    let actor = this.byNpc.get(npcId)
    if (!actor) {
      actor = { npcId, spawn: Promise.resolve(mover.ragdollSpawn(at)), mover, pendingHits: 0, detached: new Map() }
      this.byNpc.set(npcId, actor)
    }
    let id: number
    try {
      id = await actor.spawn
    } catch (error) {
      if (this.byNpc.get(npcId) === actor) this.byNpc.delete(npcId)
      throw error
    }
    if (this.byNpc.get(npcId) !== actor) return false
    if (!id) {
      this.byNpc.delete(npcId)
      return false
    }
    this.byRagdoll.set(id, actor)
    const target = typeof boneOrRadius === 'number' ? { bone: boneOrRadius } : boneOrRadius
    const bone = 'bone' in target ? target.bone : BONE.Chest
    const cut = 'cutEnergy' in target ? target.cutEnergy ?? 0 : 0
    actor.pendingHits++
    try {
      if (!await mover.ragdollHit(id, bone, push, cut) || this.byNpc.get(npcId) !== actor) return false
    } finally {
      actor.pendingHits--
    }
    const audio = mover.combatAudio
    if ('radius' in target) audio?.shockwaveBoom({ at, radius: target.radius })
    else if (cut > 0) audio?.bladeStab({ at, material: 'flesh' })
    else audio?.bluntHit({ at, material: 'flesh' })
    return true
  }

  ingestPoses(poses: readonly RagdollPoseRecord[]): void {
    for (const record of poses) {
      const actor = this.byRagdoll.get(record.id)
      if (!actor) continue
      // The upright spawn can precede the hit. A recovered intact person can resume their route.
      if (record.mode === RAGDOLL_MODE.Locomotion && !record.missingLimbs && actor.pendingHits) continue
      const pose = poseToLimbTransforms(record)
      if (record.mode === RAGDOLL_MODE.Locomotion && !record.missingLimbs) {
        this.byNpc.delete(actor.npcId)
        this.byRagdoll.delete(record.id)
        actor.mover.onSettled?.(actor.npcId, pose)
        continue
      }
      for (const cap of pose.stumpCaps) {
        if (!actor.detached.has(cap.severedBone)) actor.detached.set(cap.severedBone, pose.limbs[cap.severedBone])
      }
      actor.pose = pose
    }
  }

  /** Forget mappings and pending spawns when the mover forgets the world. */
  clear(): void {
    this.byNpc.clear()
    this.byRagdoll.clear()
  }
}
