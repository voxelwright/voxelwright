/** The pinned survey predates per-layer fixture credits in the release writer. */
export function releaseCredits(release: string, credits: string[]): string[] {
  if (release === '89d8b029f0d24556a712519a4ea8d9a7a588415b44c31398a2d199ab5d11a473') {
    return [...credits, 'Street lamps and trolley wires: San Francisco Public Works']
  }
  return credits
}
