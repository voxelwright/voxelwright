// The colour of San Francisco's painted crossings as OpenStreetMap says it (#450), for sf/marks.mjs: the street graph
// keeps a crossing's markings (bay/street_graph.py) but not its colour, and the city paints its school crossings and
// some others yellow, and the Castro's in a rainbow.
//
//   node sf/crossing-colours.mjs [--out sf/crossing-colours.json]
//
// Asks Overpass once for every crossing way (footway=crossing) and crossing node (highway=crossing) in the city with
// a colour: crossing:markings:colour, else road_marking:colour, else colour. A crossing of the graph takes its way's
// colour, else that of a node it ends at (the node where the way crosses the road carries the crossing's tags as
// often as the way does). Kept: yellow and rainbow (white is the rule, and "white;yellow" is drawn white). The file:
// {"ways": {id: colour}, "nodes": {id: colour}, "asked": date}.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const at = process.argv.indexOf('--out'), out = at > 0 ? process.argv[at + 1] : join(dirname(fileURLToPath(import.meta.url)), 'crossing-colours.json')
const query = '[out:json][timeout:90];(way["footway"="crossing"](37.70,-122.52,37.82,-122.35);node["highway"="crossing"](37.70,-122.52,37.82,-122.35););out tags;'
const answer = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': 'village-engine' }, body: new URLSearchParams({ data: query }) })
if (!answer.ok) { console.error(`Overpass: ${answer.status}`); process.exit(1) }
const { elements } = await answer.json()
const kept = { ways: {}, nodes: {}, asked: new Date().toISOString().slice(0, 10) }
for (const e of elements) {
  const t = e.tags ?? {}, colour = t['crossing:markings:colour'] ?? t['road_marking:colour'] ?? t.colour
  if (colour === 'yellow' || colour === 'gold' || colour === 'rainbow') kept[e.type === 'way' ? 'ways' : 'nodes'][e.id] = colour === 'gold' ? 'yellow' : colour
}
writeFileSync(out, JSON.stringify(kept, null, 0))
console.log(`  ${elements.length} crossings asked about: ${Object.keys(kept.ways).length} ways and ${Object.keys(kept.nodes).length} nodes coloured`)
