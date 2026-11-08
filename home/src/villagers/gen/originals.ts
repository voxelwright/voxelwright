// #47 schema coverage: the hand-made felt plush (kinds.ts PLUSH) written as specs.
// The lineup renders each next to its original with the same accent; if the spec
// cannot come close, the schema is too narrow.
import type { VillagerSpec } from './spec'

const voice = { pitch: 240, range: 3, formant: 1.1, rate: 10, breath: 0.1, wobble: 0.25, wobbleRate: 5, tilt: 1.6, gain: 0.9 }

export const COVERAGE: { key: string; index: number; accent: string; spec: VillagerSpec }[] = [
  {
    key: 'dumpling', index: 0, accent: '#c8553d',
    spec: {
      name: 'Dumpling', role: 'cook', bark: "Soup's on for Thursday. Shall I add bread to the list?",
      body: { shape: 'round', r: 0.2, tall: 0.9, head: 0.82, legs: 0 },
      face: { snout: 'muzzle', ears: 'floppy', eyes: 1 }, tail: 'none', back: 'none', pattern: 'belly',
      palette: { felt: '#e2b98a', belly: '#f6e6cc', inner: '#e8a3a0' }, accessories: [], prop: 'spoon',
      gait: { speed: 0.38, stride: 0.24, bob: 0.04, stepped: true, fidget: 0 }, voice,
    },
  },
  {
    key: 'tuft', index: 1, accent: '#e0b53a',
    spec: {
      name: 'Tuft', role: 'tidier', bark: 'I found three socks and a crayon under the sofa.',
      body: { shape: 'round', r: 0.14, tall: 1.5, head: 0.82, legs: 0 },
      face: { snout: 'muzzle', ears: 'tuft', eyes: 1 }, tail: 'none', back: 'none', pattern: 'belly',
      palette: { felt: '#8a9cba', belly: '#e6dccb', inner: '#e3a92b' }, accessories: [], prop: 'duster',
      gait: { speed: 0.38, stride: 0.24, bob: 0.04, stepped: true, fidget: 0 }, voice,
    },
  },
  {
    key: 'moss', index: 2, accent: '#3d7cc8',
    spec: {
      name: 'Moss', role: 'gardener', bark: 'The basil on the sill is thirsty. I am on it.',
      body: { shape: 'round', r: 0.17, tall: 1.1, head: 0.82, legs: 0 },
      face: { snout: 'muzzle', ears: 'round', eyes: 1 }, tail: 'none', back: 'none', pattern: 'belly',
      palette: { felt: '#97a85e', belly: '#ece3c0', inner: '#5f7f42' }, accessories: ['leaf'], prop: 'can',
      gait: { speed: 0.38, stride: 0.24, bob: 0.04, stepped: true, fidget: 0 }, voice,
    },
  },
]
