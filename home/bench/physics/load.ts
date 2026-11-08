// Prints the ms from import to a ready engine, for one engine named on the command line.
const t0 = performance.now()
const which = process.argv[2]
if (which === 'rapier') { const { loadRapier } = await import('./rapier.ts'); await loadRapier() }
else if (which === 'jolt') { const { loadJolt } = await import('./jolt.ts'); await loadJolt() }
else await import('./xpbd.ts')
console.log((performance.now() - t0).toFixed(1))
