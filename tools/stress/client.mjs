// Room-leak regression client — see tools/stress/server.mjs for how to run the pair.
// Waves of simultaneous private-room hosts (host leaves first, guests must be kicked),
// a bots-round wave abandoned mid-round, and a public-room grace-window check.
import { Client } from '@colyseus/sdk'
import { MSG } from '@echo-tag/shared'

const URL = 'ws://localhost:2599'
const code = () =>
  Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[(Math.random() * 23) | 0]).join('')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Flood mode: `node tools/stress/client.mjs --flood` ──
// One hostile client spamming MSG.Input at ~4000/s for 10s: the server's input cap
// should keep cpu= low and the room must still dispose cleanly afterwards.
if (process.argv.includes('--flood')) {
  const room = await new Client(URL).create('arena', { code: code() })
  room.onMessage('*', () => {})
  room.send(MSG.Bots, 3)
  room.send(MSG.Go)
  console.log('flood: one room, ~4000 input msgs/s for 10s')
  let seq = 1
  const buf = new Uint8Array(3)
  const pump = setInterval(() => {
    for (let i = 0; i < 200; i++) {
      buf[0] = seq & 0xff
      buf[1] = (seq >> 8) & 0xff
      buf[2] = 8 | (3 << 4) // left, full magnitude (see sim/input.ts)
      seq = (seq + 1) & 0xffff
      try { room.send(MSG.Input, buf) } catch {}
    }
  }, 50)
  await sleep(10_000)
  clearInterval(pump)
  await Promise.race([room.leave().catch(() => {}), sleep(2000)])
  console.log('flood: left')
  await sleep(3000)
  process.exit(0)
}

// ── Idle mode: `node tools/stress/client.mjs --idle 200 --secs 20` ──
// N rooms parked in the lobby (host connected, round never started): the cost of
// people hosting and waiting, which is most of what "everyone hosts at once" is.
const idleIx = process.argv.indexOf('--idle')
if (idleIx !== -1) {
  const n = Number(process.argv[idleIx + 1] ?? 200)
  const secsIx = process.argv.indexOf('--secs')
  const secs = Number(secsIx === -1 ? 20 : process.argv[secsIx + 1])
  const rooms = await Promise.all(
    Array.from({ length: n }, async () => {
      const r = await new Client(URL).create('arena', { code: code() })
      r.onMessage('*', () => {})
      return r
    }),
  )
  console.log(`idle: ${n} rooms parked in lobby, ${secs}s`)
  await sleep(secs * 1000)
  await Promise.all(rooms.map((r) => Promise.race([r.leave().catch(() => {}), sleep(2000)])))
  console.log('idle: all left')
  await sleep(3000)
  process.exit(0)
}

// ── Load mode: `node tools/stress/client.mjs --load 25 --secs 30` ──
// N rooms, each 3 humans + 9 bots, ALL mid-round at once, every human sending real
// 20Hz input traffic. Watch the server's cpu= / loop_p99= telemetry while it runs.
const loadIx = process.argv.indexOf('--load')
if (loadIx !== -1) {
  const n = Number(process.argv[loadIx + 1] ?? 25)
  const secsIx = process.argv.indexOf('--secs')
  const secs = Number(secsIx === -1 ? 30 : process.argv[secsIx + 1])
  const humans = []
  await Promise.all(
    Array.from({ length: n }, async () => {
      const c = code()
      const host = await new Client(URL).create('arena', { code: c })
      host.onMessage('*', () => {})
      const g1 = await new Client(URL).join('arena', { code: c })
      g1.onMessage('*', () => {})
      const g2 = await new Client(URL).join('arena', { code: c })
      g2.onMessage('*', () => {})
      host.send(MSG.Bots, 9)
      host.send(MSG.Go)
      humans.push(host, g1, g2)
    }),
  )
  console.log(`load: ${n} rooms playing (${humans.length} humans + ${n * 9} bots), ${secs}s`)
  let seq = 1
  const buf = new Uint8Array(3)
  const pump = setInterval(() => {
    for (const room of humans) {
      buf[0] = seq & 0xff
      buf[1] = (seq >> 8) & 0xff
      buf[2] = ((Math.random() * 16) | 0) | (3 << 4) // wander: random heading, full magnitude
      try { room.send(MSG.Input, buf) } catch {}
    }
    seq = (seq + 1) & 0xffff
  }, 50)
  await sleep(secs * 1000)
  clearInterval(pump)
  await Promise.all(humans.map((r) => Promise.race([r.leave().catch(() => {}), sleep(2000)])))
  console.log('load: all left')
  await sleep(3000)
  process.exit(0)
}
// A room the server already disconnected can leave() into a promise that never settles;
// the real client never awaits leave, so neither does the harness.
const leaveQuiet = (r) => Promise.race([r.leave().catch(() => {}), sleep(2000)])
const quiet = (r) => {
  r.onMessage('*', () => {})
  return r
}

// ── Scenario 1: five waves of 20 simultaneous hosts, each with 2 friends joining ──
for (let w = 1; w <= 5; w++) {
  const rooms = []
  await Promise.all(
    Array.from({ length: 20 }, async () => {
      const c = code()
      const host = quiet(await new Client(URL).create('arena', { code: c }))
      const g1 = quiet(await new Client(URL).join('arena', { code: c }))
      const g2 = quiet(await new Client(URL).join('arena', { code: c }))
      rooms.push([host, g1, g2])
    }),
  )
  console.log(`wave ${w}: 20 rooms hosted, 60 clients in`)
  await sleep(800)
  // Host leaves first — the room must collapse and kick the guests.
  await Promise.all(rooms.map(([h]) => leaveQuiet(h)))
  await sleep(1000)
  await Promise.all(rooms.flatMap(([, a, b]) => [leaveQuiet(a), leaveQuiet(b)]))
  console.log(`wave ${w}: all left`)
  await sleep(1000)
}

// ── Scenario 2: 10 hosts actually playing rounds with bots, then leaving mid-round ──
{
  const rooms = await Promise.all(
    Array.from({ length: 10 }, async () => {
      const room = quiet(await new Client(URL).create('arena', { code: code() }))
      room.send(MSG.Bots, 3)
      room.send(MSG.Go)
      return room
    }),
  )
  console.log('round wave: 10 rooms playing with bots')
  await sleep(5000) // let the sim run
  await Promise.all(rooms.map((r) => leaveQuiet(r)))
  console.log('round wave: all hosts left mid-round')
}

// ── Scenario 3: public quick-match rooms abandoned (exercises the 30s grace window) ──
{
  const rooms = await Promise.all(
    Array.from({ length: 5 }, async () => quiet(await new Client(URL).joinOrCreate('arena', { code: '' }))),
  )
  console.log('public wave: 5 quick-match clients in')
  await sleep(500)
  await Promise.all(rooms.map((r) => leaveQuiet(r)))
  console.log('public wave: all left — rooms should dispose after the 30s grace')
}

await sleep(36_000)
console.log('client done')
process.exit(0)
