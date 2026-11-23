// The loader a realm's page shows until the visitor can use it (#450, loading.html, put in by sf/build.mjs): told
// each stage as it ends, how far the last one is, and when the place is ready or the page has failed. A page without
// it (the engine's own, a world the server keeps) is told nothing.

/** The stages, in the order main.ts passes them. The last, the view, ends with `done`. */
export type Stage = 'gpu' | 'engine' | 'skyline' | 'streets'

interface Loader {
  step(stage: Stage): void
  progress(share: number): void
  /** Which of its pictures is the eye the page opens with, or none where it opens elsewhere: said once chosen, and as it is reframed. */
  view(picture: 'wide' | 'upright' | null): void
  done(): void
  fail(): void
}

const shown = (globalThis as { villageLoading?: Loader }).villageLoading

export const loading: Loader = {
  step: (stage) => shown?.step(stage),
  progress: (share) => shown?.progress(share),
  view: (picture) => shown?.view(picture),
  done: () => shown?.done(),
  fail: () => shown?.fail(),
}
