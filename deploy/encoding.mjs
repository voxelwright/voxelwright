// Whether a client takes Brotli (#450, worker.mjs): `br` listed with no q, or a q above 0 (`br;q=0` refuses it).
export const takesBrotli = (header) => (header ?? '').split(',').some((part) => {
  const [name, ...params] = part.split(';').map((s) => s.trim().toLowerCase())
  const q = params.find((p) => p.startsWith('q='))
  return name === 'br' && (!q || Number(q.slice(2)) > 0)
})
