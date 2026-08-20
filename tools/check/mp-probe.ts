/**
 * Multiplayer protocol probe: boots the real server, connects real SDK clients, and
 * asserts the whole loop — matchmaking pools, welcome payloads, snapshot flow, input
 * causing movement, and private-code semantics.
 */
import { spawn } from 'node:child_process'
import { Client, Room } from '@colyseus/sdk'
import { MSG, createSnapshot, readSnapshot, encodeInput } from '../../Echo-Tag-Shared/src/index.ts'

const PORT = 2599
const server = spawn(process.execPath, ['Echo-Tag-Server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server never listened')), 10_000)
  server.stdout.on('data', (d: Buffer) => {
    if (d.toString().includes('listening')) {
      clearTimeout(t)
      resolve()
    }
  })
})

const failures: string[] = []
const ok = (cond: boolean, msg: string): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures.push(msg)
}

const client = () => new Client(`ws://127.0.0.1:${PORT}`)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Welcome {
  slot: number
  mapIndex: number
  tick: number
  keys: number
  colors: number[]
  history: Uint8Array
}

const collect = (room: Room) => {
  const seen = { welcome: null as Welcome | null, keys: 0, snapshots: 0, snap: createSnapshot() }
  room.onMessage(MSG.Welcome, (m: Welcome) => (seen.welcome = m))
  room.onMessage(MSG.Round, (m: { keys: number }) => (seen.keys = m.keys))
  room.onMessage(MSG.Snapshot, (data: Uint8Array) => {
    seen.snapshots++
    readSnapshot(new DataView(data.buffer, data.byteOffset, data.byteLength), seen.snap)
  })
  return seen
}

try {
  // ── Quick match: two strangers share a public room ──
  const a = await client().joinOrCreate('arena', { code: '' })
  const sa = collect(a)
  const b = await client().joinOrCreate('arena', { code: '' })
  const sb = collect(b)
  ok(a.roomId === b.roomId, `quick match pools strangers together (${a.roomId})`)

  await wait(2600) // past MAX_LOBBY_WAIT — public room must auto-start with bot fill
  ok(sa.welcome !== null && sb.welcome !== null, 'both received welcome payloads')
  ok(sa.welcome!.slot !== sb.welcome!.slot, 'distinct slots assigned')
  ok(sa.welcome!.history.length > 2000, `welcome carries the echo history blob (${sa.welcome!.history.length}B)`)
  ok(sa.keys > 0, `round setup deals wardrobe keys (mask ${sa.keys.toString(2)})`)
  ok(sa.snap.phase >= 1, `round auto-started without host action (phase ${sa.snap.phase})`)

  let bots = 0
  for (let s = 0; s < 12; s++) if (sa.snap.active[s] === 1 && sa.snap.isBot[s] === 1) bots++
  ok(bots >= 6, `bots filled the empty seats (${bots} bots)`)

  // ── Input moves the avatar ──
  const slot = sa.welcome!.slot
  const x0 = sa.snap.x[slot]!
  const y0 = sa.snap.y[slot]!
  const inputMsg = new Uint8Array(3)
  for (let seq = 1; seq <= 30; seq++) {
    inputMsg[0] = seq & 0xff
    inputMsg[1] = seq >> 8
    inputMsg[2] = encodeInput(1, 0)
    a.send(MSG.Input, inputMsg)
    await wait(50)
  }
  const moved = Math.hypot(sa.snap.x[slot]! - x0, sa.snap.y[slot]! - y0)
  ok(moved > 100, `input moved the avatar ${moved.toFixed(0)} world units`)
  ok(sa.snapshots > 30, `snapshots flowing (${sa.snapshots} received)`)
  ok(sb.snap.x[slot] === sa.snap.x[slot], "the other client sees the mover's position")

  await a.leave()
  await b.leave()

  // ── Private rooms: code creates a pool; wrong code refuses ──
  const code = 'QQZZT'
  const host = await client().create('arena', { code })
  collect(host)
  const friend = await client().join('arena', { code })
  const sf = collect(friend)
  ok(host.roomId === friend.roomId, 'friend with the code lands in the host room')

  let refused = false
  try {
    await client().join('arena', { code: 'WRONG' })
  } catch {
    refused = true
  }
  ok(refused, 'a wrong code is refused, not silently given a fresh room')

  // Quick match must never route strangers into the private room.
  const stranger = await client().joinOrCreate('arena', { code: '' })
  ok(stranger.roomId !== host.roomId, 'quick match never lands in a private room')
  await stranger.leave()

  await wait(2600)
  ok(sf.snapshots === 0 || sf.snap.phase === 0, 'private lobby does NOT auto-start')
  host.send(MSG.Go)
  await wait(600)
  ok(sf.snap.phase >= 1, `host start begins the private round (phase ${sf.snap.phase})`)

  await host.leave()
  await friend.leave()
} catch (err) {
  failures.push(`probe crashed: ${(err as Error).message}`)
  console.error(err)
} finally {
  server.kill('SIGTERM')
}

if (failures.length > 0) {
  console.error(`\n✗ multiplayer probe FAILED:\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log('\n✓ multiplayer probe passed')
