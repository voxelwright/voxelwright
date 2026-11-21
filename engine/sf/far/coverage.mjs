// How much of the city has faces (#450): the land squares the city's run means to bake (bay/sf-squares.json `lidar`),
// how many have an archive, how many are baked into the far model, and the far tiles and bytes listed.
//
//   node sf/far/coverage.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { here } from '../../test/kit.mjs'

const bay = join(homedir(), '.village', 'engine', 'bay'), far = join(homedir(), '.village', 'engine', 'sf', 'far')
const wanted = JSON.parse(readFileSync(join(here, 'bay', 'sf-squares.json'), 'utf8')).lidar
const archived = new Set([join(bay, 'sf-450-city', 'inputs'), join(bay, '450-inputs')].filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.zip')).map((f) => f.slice(0, -4))))
const baked = new Set(existsSync(join(far, 'squares')) ? readdirSync(join(far, 'squares')).filter((d) => existsSync(join(far, 'squares', d, 'index.json'))) : [])
const listing = existsSync(join(far, 'release', 'far.json')) ? JSON.parse(readFileSync(join(far, 'release', 'far.json'), 'utf8')) : { tiles: {} }
const bytes = Object.values(listing.tiles).flat().reduce((n, r) => n + (r?.bytes ?? 0), 0)
const of = (set) => wanted.filter((s) => set.has(s)).length
console.log(`city squares: ${wanted.length}; archived by the run ${of(archived)}; with faces ${of(baked)} (${((100 * of(baked)) / wanted.length).toFixed(0)}%); far tiles listed ${Object.keys(listing.tiles).length}, ${(bytes / 1048576).toFixed(0)} MiB as written`)
