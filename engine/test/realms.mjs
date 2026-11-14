// Many realms on one server (#264): each a world of its own, in a file of its own, with a process that starts when
// someone needs it and stops when nobody has for a while. What is done in one is not done in another; a realm says
// what it is (its name, what it is about, where one arrives, how it looks) without being started; it is kept over
// a restart; one taken out is gone and its file moved aside; home is what `/world/…` always was. Plain requests
// against the real server: no browser and no model.
//
//   node test/realms.mjs              the check
//   node test/realms.mjs --measure    what a second and a tenth realm cost: memory, and time to the first answer
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { here } from './kit.mjs'

const failures = []
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const dir = join(tmpdir(), `engine-realms-${process.pid}`)
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** The server, keeping home in one file and the other realms in a folder, resting a realm after `idle` seconds. */
async function serve(idle) {
  const server = spawn('node', ['serve.mjs', '--port', '0', '--reports', '/dev/null', '--world', join(dir, 'home.log'), '--realms', join(dir, 'realms'), '--idle', String(idle)], { cwd: here, stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { const m = /engine page on http:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk)); if (m) resolve(Number(m[1])) })
    server.on('exit', (code) => reject(new Error(`the server ended (${code})`)))
  })
  const url = `http://127.0.0.1:${port}`
  const get = (path, headers) => fetch(url + path, { headers }).then(async (r) => ({ status: r.status, body: await r.text().then((t) => { try { return JSON.parse(t) } catch { return t } }) }))
  const post = (path, body, headers) => fetch(url + path, { method: 'POST', body: JSON.stringify(body), headers }).then(async (r) => ({ status: r.status, body: await r.text().then((t) => { try { return JSON.parse(t) } catch { return t } }) }))
  const del = (path, headers) => fetch(url + path, { method: 'DELETE', headers }).then(async (r) => ({ status: r.status, body: await r.text() }))
  const listed = async (id) => (await get('/realms')).body.realms.find((r) => r.id === id)
  return { url, pid: server.pid, get, post, del, listed, stop: () => new Promise((r) => { server.on('exit', r); server.kill() }) }
}
/** A cell of the air over the street where the town starts, and an edit that leaves a ball of brick lying there (a blast would not do: rubble comes to rest where it was). */
const CELL = 'x=700&y=157&z=4070', BUILD = { by: 'check', edit: [0, 700, 157, 4070, 3, 8], release: [700, 157, 4070] }

if (process.argv.includes('--measure')) {
  // A world's file as the server keeps it: `edits` balls of air and brick along the street, each an ask as it was done.
  const frame = (seq, ask) => { const payload = Buffer.from(JSON.stringify(ask)), head = Buffer.alloc(12); head.writeUInt32LE(3, 0); head.writeUInt32LE(seq, 4); head.writeUInt32LE(payload.length, 8); return Buffer.concat([head, payload]) }
  const file = (edits) => Buffer.concat(Array.from({ length: edits }, (_, i) => { const x = 400 + (i % 100) * 12, z = 4000 + Math.floor(i / 100) * 14, r = 3; return frame(i, { by: 'measure', edit: [0, x, 158, z, r, i % 2 ? 8 : 0], box: [x - 10, 148, z - 10, x + 11, 169, z + 11], release: [x, 158, z] }) }))
  const rss = (pid) => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString()) / 1024
  /** How many threads the server has (macOS: a line a thread). */
  const threads = (pid) => execFileSync('ps', ['-M', '-p', String(pid)]).toString().trim().split('\n').length - 1
  const rule = (seq) => frame(seq, { by: 'measure', rule: { id: 'greeter', name: 'Someone', source: 'on("start", (world) => world.actor("guide", {name: "Odile", at: [700, 4009]}))', by: 'measure' } })
  {
    // A realm with a rule rests: its process and its rule's thread both end.
    rmSync(join(dir, 'realms'), { recursive: true, force: true }); mkdirSync(join(dir, 'realms'), { recursive: true })
    writeFileSync(join(dir, 'realms', 'ruled.log'), rule(0))
    const s = await serve(5)
    await wait(500)
    const alone = threads(s.pid)
    await s.get(`/realm/ruled/world/at?${CELL}`); await wait(800)
    const up = threads(s.pid), doing = (await s.get('/realm/ruled/world/rules')).body
    await wait(7000)
    console.log(`threads of the server: ${alone} with home alone, ${up} with a realm of one rule awake (the rule running: ${doing[0]?.running}), ${threads(s.pid)} once the realm and home rest`)
    await s.stop()
  }
  for (const [edits, ruled] of process.argv.includes('--threads') ? [] : [[0, false], [1000, false], [0, true]]) {
    const runs = []
    for (let run = 0; run < 3; run++) {
      rmSync(join(dir, 'realms'), { recursive: true, force: true }); mkdirSync(join(dir, 'realms'), { recursive: true })
      for (let i = 1; i <= 10; i++) writeFileSync(join(dir, 'realms', `r${i}.log`), ruled ? rule(0) : file(edits))
      const s = await serve(600)
      await s.get(`/world/at?${CELL}`); await wait(500)
      const mb = [rss(s.pid)], ms = []
      for (let i = 1; i <= 10; i++) {
        const t0 = performance.now()
        await s.get(`/realm/r${i}/world/at?${CELL}`)
        ms.push(performance.now() - t0)
        await wait(400)
        mb.push(rss(s.pid))
      }
      runs.push({ mb, ms })
      await s.stop()
    }
    const mid = (f) => runs.map(f).sort((a, b) => a - b)[1]
    console.log(`realms of ${ruled ? 'one rule' : `${edits} edits`} each (the middle of three runs):`)
    console.log(`  the server with home alone ${mid((r) => r.mb[0]).toFixed(0)} MB; a second realm adds ${mid((r) => r.mb[1] - r.mb[0]).toFixed(1)} MB; with ten more than home ${mid((r) => r.mb[10]).toFixed(0)} MB, ${mid((r) => (r.mb[10] - r.mb[0]) / 10).toFixed(1)} MB a realm`)
    console.log(`  from asking a realm that sleeps to its first answer: the second realm ${mid((r) => r.ms[0]).toFixed(0)} ms, the tenth ${mid((r) => r.ms[9]).toFixed(0)} ms (each of ten: ${runs[1].ms.map((v) => v.toFixed(0)).join(', ')})`)
  }
  rmSync(dir, { recursive: true, force: true })
  process.exit(0)
}

let s = await serve(2)
try {
  // Home is what /world/ always was.
  const home = await s.get(`/world/at?${CELL}`), named = await s.get(`/realm/home/world/at?${CELL}`)
  check(home.status === 200 && home.body.material === 0 && JSON.stringify(home.body) === JSON.stringify(named.body), 'home answers at /world/ as it always did, and at /realm/home/world/ the same')
  check((await s.get('/realms')).body.realms.length === 1 && (await s.listed('home')).home, 'a server lists its realms: home alone to begin with')

  // Making one.
  const made = await s.post('/realms', { by: 'check', name: 'A grey dawn', about: 'a quiet street before anyone is up', arrive: { at: [9000, 4070], yaw: 1.57 }, look: { hour: 6.2, rain: 0.3, tint: [0.9, 1, 0.95] } })
  check(made.status === 201 && made.body.id === 'a-grey-dawn' && made.body.arrive.at[0] === 9000 && made.body.look.hour === 6.2 && made.body.awake === false, `a realm is made from a name, with where one arrives and how it looks; its process is not started (${made.status} ${JSON.stringify(made.body).slice(0, 80)})`)
  check((await s.post('/realms', { by: 'check', name: 'A grey dawn' })).status === 409, 'a second of the same id is refused')
  const bad = [{ name: '' }, { name: 'x', id: '../up' }, { name: 'x', id: 'Has Capitals' }, { name: 'x', look: { hour: 99 } }, { name: 'x', look: { tint: [1, 1] } }, { name: 'x', arrive: { at: [1.5, 2] } }, { name: 'x', arrive: { at: [1, 2], yaw: 'north' } }, []]
  const refused = await Promise.all(bad.map((b) => s.post('/realms', b)))
  check(refused.every((r) => r.status === 400), `a realm with no name, an id that is a path, an hour of 99, a tint of two, a place that is not whole cells is refused (${refused.map((r) => r.status).join(' ')})`)
  check(!existsSync(join(dir, 'up.log')) && readdirSync(join(dir, 'realms')).join() === 'a-grey-dawn.log', 'and nothing was written but the one realm\'s file')

  // What is done in one is not done in another; a realm starts when asked.
  const R = '/realm/a-grey-dawn'
  const before = await s.get(`${R}/world/at?${CELL}`)
  check(before.body.material === 0 && before.body.ground === 154 && (await s.listed('a-grey-dawn')).awake, 'asked what a cell is, the realm starts and answers: the same planet, the same street')
  await s.post(`${R}/world/ask`, BUILD); await wait(600)
  const there = await s.get(`${R}/world/at?${CELL}`), atHome = await s.get(`/world/at?${CELL}`)
  check(there.body.material === 8 && atHome.body.material === 0, 'brick put down in the realm is there and not at home')
  await s.post('/world/ask', { by: 'check', rule: { id: 'greeter', name: 'Someone', source: 'on("start", (world) => world.actor("guide", {name: "Odile", at: [700, 4009]}))' } }); await wait(300)
  check((await s.get('/world/realm')).body.rules.includes('greeter') && (await s.get(`${R}/world/realm`)).body.rules.length === 0, 'a rule put into home is home\'s alone')

  // What a realm is: changed by an ask in it, only what is given.
  await s.post(`${R}/world/ask`, { by: 'check', realm: { look: { hour: 7 } } }); await wait(200)
  const record = (await s.get(R)).body
  check(record.name === 'A grey dawn' && record.look.hour === 7 && record.look.rain === 0.3 && record.arrive.yaw === 1.57, 'an ask in the realm changes how it looks: the hour given, and the rain, the name and the arrival as they were')

  // Nobody there: it rests, and starts again as it was left.
  await wait(3500)
  check((await s.listed('a-grey-dawn')).awake === false && (await s.listed('home')).awake === false, 'with nobody in them for longer than the idle time, the realm and home rest')
  const again = await s.get(`${R}/world/at?${CELL}`)
  check(again.body.material === 8 && (await s.listed('a-grey-dawn')).awake, 'asked again, the realm starts with what was done to it')
  // Someone reading its stream keeps it awake.
  const reading = new AbortController(), stream = await fetch(`${s.url}${R}/world/stream?from=0`, { signal: reading.signal })
  void stream.body.getReader().read()
  await wait(3500)
  const held = await s.listed('a-grey-dawn')
  check(held.awake && held.pages === 1, 'a realm someone is reading the stream of does not rest')
  reading.abort()
  await wait(3500)
  check((await s.listed('a-grey-dawn')).awake === false, 'and rests once they have gone')

  // A page of another site may not act here, on any of the new addresses.
  const evil = { Origin: 'http://elsewhere.example' }
  const foreign = [await s.get('/realms', evil), await s.post('/realms', { name: 'theirs' }, evil), await s.get(R, evil), await s.del(R, evil), await s.get(`${R}/world/at?${CELL}`, evil), await s.post(`${R}/world/ask`, BUILD, evil)]
  check(foreign.every((r) => r.status === 403) && !(await s.listed('theirs')) && (await s.listed('a-grey-dawn')), `a request with another site's Origin is refused: the list, making, a record, taking out, a question, an ask (${foreign.map((r) => r.status).join(' ')})`)

  // Kept over a restart, and said without being started.
  await s.stop()
  s = await serve(2)
  const kept = await s.listed('a-grey-dawn')
  check(kept && kept.awake === false && kept.name === 'A grey dawn' && kept.look.hour === 7 && kept.look.tint[0] === 0.9 && kept.arrive.at[0] === 9000, 'the server started again lists the realm with its record, and has not started it')
  check((await s.get(`${R}/world/at?${CELL}`)).body.material === 8 && (await s.get(`/world/at?${CELL}`)).body.material === 0, 'and what was done there is still done, and still only there')

  // More realms than may be awake at once: the idle ones give way.
  for (let i = 0; i < 18; i++) await s.post('/realms', { by: 'check', name: `Spare ${i}` })
  const answers = []
  for (let i = 0; i < 18; i++) answers.push((await s.get(`/realm/spare-${i}/world/at?${CELL}`)).status)
  const up = (await s.get('/realms')).body.realms.filter((r) => r.awake).length
  check(answers.every((a) => a === 200) && up <= 16, `eighteen more realms asked one after another all answer, and ${up} are awake: at most sixteen`)

  // One hour for a realm: the world's process has the town's residents out by the realm's own hour, as its pages do.
  await s.post('/realms', { by: 'check', id: 'night', name: 'Three in the morning', look: { hour: 3 } })
  await s.post('/realms', { by: 'check', id: 'noon', name: 'Noon', look: { hour: 12 } })
  await s.post('/realms', { by: 'check', id: 'eleven', name: 'Eleven', look: { hour: 11 } })
  const near = async (realm) => { const base = realm ? `/realm/${realm}/world` : '/world'; await s.post(`${base}/join`, { by: 'counter', at: [700, 4009] }); return (await s.get(`${base}/around?by=counter&within=400`)).body.residents.near }
  const [atNight, atNoon, atEleven, outAtHome] = [await near('night'), await near('noon'), await near('eleven'), await near('')]
  check(atNoon >= 6 && atNight * 2 < atNoon, `a realm at three in the morning has few of the town's residents out, one at noon many (${atNight} against ${atNoon} within 40 m)`)
  check(Math.abs(outAtHome - atEleven) <= 2, `a world that says no hour has them out as at eleven, which is what a page shows when nothing says (${outAtHome} against ${atEleven})`)
  await s.post('/realm/night/world/ask', { by: 'check', realm: { look: { hour: 12 } } }); await wait(300)
  const later = await near('night')
  check(Math.abs(later - atNoon) <= 2, `an ask that sets the realm's hour to noon brings them out there (${later})`)

  // Taking one out.
  check((await s.del('/realm/home')).status === 409, 'home is not taken out')
  const gone = await s.del(R)
  check(gone.status === 200 && !(await s.listed('a-grey-dawn')) && (await s.get(`${R}/world/at?${CELL}`)).status === 404, 'a realm taken out is not listed and not answered for')
  check(!existsSync(join(dir, 'realms', 'a-grey-dawn.log')) && readdirSync(join(dir, 'realms', 'gone')).some((f) => f.startsWith('a-grey-dawn-')), 'its file is moved aside, not destroyed')
  check((await s.get(`/world/at?${CELL}`)).body.material === 0, 'and home goes on')
} catch (e) { failures.push(`the check itself failed: ${e.stack ?? e}`) }
await s.stop()
rmSync(dir, { recursive: true, force: true })
if (failures.length) { console.error(`FAILED\n  ${failures.join('\n  ')}`); process.exit(1) }
console.log('realms: ok')
