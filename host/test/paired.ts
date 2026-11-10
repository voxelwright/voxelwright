// Checks pair devices the way a page does (#85): a new link's code, exchanged once at POST /pair.
import { readFile } from 'node:fs/promises'
import type { PairingStore } from '../src/pairing.ts'

/** The secret from a /pair answer's Set-Cookie, or null. */
export const secretOf = (res: Response) => /village_[0-9a-f]+=([0-9a-f]{64})/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null

/** One more device for `person` (keeping the others, unless `keep` is false): its session secret, the cookie's value. */
export async function pairDevice(pairing: PairingStore, base: string, person: string, keep = true) {
  const code = await pairing.mint(person, { keep })
  return secretOf(await fetch(`${base}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }))
}

/** The host's port, and one paired device's session secret per person in `people` who is listed. */
export async function pairedLaunch(villager: { launchFile: string; pairing: PairingStore }, people: string[]) {
  const { port } = JSON.parse(await readFile(villager.launchFile, 'utf8')) as { port: number }
  const tokens: Record<string, string> = {}
  for (const person of people) {
    const secret = await pairDevice(villager.pairing, `http://127.0.0.1:${port}`, person)
    if (secret) tokens[person] = secret
  }
  return { port, tokens }
}
