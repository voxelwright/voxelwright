// The sky's colours and where its sun stands, shared by the sky itself (plugins/atmosphere.ts),
// the key light (plugins/window.ts) and the leaves the sun warms (foliage.ts).
import * as THREE from 'three/webgpu'

/** The sky's colours, shared by the dome, the cloud sea and the light the environment gives. */
export const SKY = {
  zenith: '#3f8fe0',
  horizon: '#bfe3fb',
  /** The air under the island, between the clouds. */
  deep: '#5aa6ea',
  cloud: '#ffffff',
  cloudShade: '#a9b9e6',
  /** Warm light off the lawn and the floors, the underside of the environment. */
  bounce: '#f0c090',
}
/** Towards the sun, in world space. The key light (window.ts) and the cloud shading agree on it. */
export const SUN_DIRECTION = new THREE.Vector3(-0.52, 0.78, -0.35).normalize()
