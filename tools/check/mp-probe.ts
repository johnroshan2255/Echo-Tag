/**
 * Multiplayer protocol probe: boots the real server, connects real SDK clients, and
 * asserts the whole loop — matchmaking pools, welcome payloads, snapshot flow, input
 * causing movement, and private-code semantics.
 */
import { spawn } from 'node:child_process'
import { Client, Room } from '@colyseus/sdk'
import {
  MAX_PLAYERS,
  MSG,
  NO_SLOT,
  createSnapshot,
  createWorld,
  encodeInput,
  readSnapshot,
  rebuildEchoBodies,
  sampleHistory,
  type Snapshot,
} from '../../Echo-Tag-Shared/src/index.ts'
import { MAPS, wardrobeCenterX, wardrobeCenterY, wardrobeExitX, wardrobeExitY } from '../../Echo-Tag-Shared/src/maps/index.ts'

const PORT = 2599
// TEST_HOOKS arms the room's test-only teleport/setIt messages, which the scenario
// assertions below need to stage deterministic situations (hide, get tagged).
const server = spawn(process.execPath, ['Echo-Tag-Server/src/index.ts'], {
  env: { ...process.env, PORT: String(PORT), TEST_HOOKS: 'true' },
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
  keySpawns: number[]
  colors: number[]
  history: Uint8Array
}

const collect = (room: Room, onSnap?: (snap: Snapshot) => void) => {
  const seen = {
    welcome: null as Welcome | null,
    keys: 0,
    keySpawns: [] as number[],
    toolSpawns: [] as number[],
    chat: null as { slot: number; text: string } | null,
    snapshots: 0,
    snap: createSnapshot(),
  }
  room.onMessage(MSG.Welcome, (m: Welcome) => (seen.welcome = m))
  room.onMessage(MSG.Round, (m: { keys: number; keySpawns: number[]; toolSpawns: number[] }) => {
    seen.keys = m.keys
    seen.keySpawns = m.keySpawns
    seen.toolSpawns = m.toolSpawns
  })
  room.onMessage(MSG.Chat, (m: { slot: number; text: string }) => (seen.chat = m))
  room.onMessage(MSG.Snapshot, (data: Uint8Array) => {
    seen.snapshots++
    readSnapshot(new DataView(data.buffer, data.byteOffset, data.byteLength), seen.snap)
    onSnap?.(seen.snap)
  })
  return seen
}

/**
 * A client-side mirror maintained EXACTLY like game/net/room.ts maintains its world:
 * positions + itSlot + itAgeTicks from each snapshot, then sampleHistory +
 * rebuildEchoBodies. What the probe asserts against this mirror is what every real
 * client renders and collides with.
 */
const mirror = createWorld(0, 0)
const mirrorSnap = (snap: Snapshot): void => {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    mirror.active[s] = snap.active[s]!
    if (snap.active[s] === 0) continue
    mirror.x[s] = snap.x[s]!
    mirror.y[s] = snap.y[s]!
    mirror.hiddenIn[s] = snap.hiddenIn[s]!
  }
  mirror.itSlot = snap.itSlot
  mirror.itSinceTick = snap.tick - snap.itAgeTicks
  mirror.turningSlot = snap.turningSlot
  mirror.tick = snap.tick
  sampleHistory(mirror)
  rebuildEchoBodies(mirror)
}
const mirrorBodies = (): number => {
  let n = 0
  for (const b of mirror.bodyLive) n += b
  return n
}

try {
  // ── Quick match: two strangers share a public room ──
  const a = await client().joinOrCreate('arena', { code: '' })
  const sa = collect(a, mirrorSnap)
  const b = await client().joinOrCreate('arena', { code: '' })
  const sb = collect(b)
  ok(a.roomId === b.roomId, `quick match pools strangers together (${a.roomId})`)

  await wait(2600) // past MAX_LOBBY_WAIT — public room must auto-start with bot fill
  ok(sa.welcome !== null && sb.welcome !== null, 'both received welcome payloads')
  ok(sa.welcome!.slot !== sb.welcome!.slot, 'distinct slots assigned')
  ok(sa.welcome!.history.length > 2000, `welcome carries the echo history blob (${sa.welcome!.history.length}B)`)
  ok(sa.keys === 0, 'keys are not dealt at round start — they lie on the floor')
  ok(sa.keySpawns.length >= 2, `key spawn positions broadcast (${sa.keySpawns.length / 2} keys)`)
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
  // Let friction settle the mover first: the two collectors read snapshots that can be a
  // tick apart, so comparing mid-decay flakes on exactly that one-tick difference.
  await wait(400)
  ok(sb.snap.x[slot] === sa.snap.x[slot], "the other client sees the mover's position")

  let seq = 31
  const sendInput = (dx: number, dy: number): void => {
    inputMsg[0] = seq & 0xff
    inputMsg[1] = seq >> 8
    inputMsg[2] = encodeInput(dx, dy)
    seq++
    a.send(MSG.Input, inputMsg)
  }

  // ── Hiding: walk into a keyed wardrobe; both clients see the hider vanish into it ──
  // If we happen to be It, hand the role to a bot first — predators hold no keys.
  if (sa.snap.itSlot === slot) {
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (sa.snap.active[s] === 1 && sa.snap.isBot[s] === 1) {
        a.send('test:setIt', { slot: s })
        break
      }
    }
    await wait(200)
  }
  const map = MAPS[sa.snap.mapIndex]!

  // Park the ghost far away so no tag interferes, then grab floor key 0 by walking
  // over its broadcast spawn position — that key opens wardrobe 0.
  a.send('test:teleport', { slot: sa.snap.itSlot, x: 3080, y: 1650 })
  a.send('test:teleport', { slot, x: sa.keySpawns[0]!, y: sa.keySpawns[1]! })
  await wait(300)
  ok((sa.snap.keys[slot]! & 1) === 1, 'walking over a floor key claims it (live in the snapshot)')
  ok((sa.snap.keyTaken & 1) === 1, 'the claimed key vanishes from the floor for everyone')
  const wIdx = 0

  // Now use it: stand on the wardrobe's exit tile (open by map construction) and walk in.
  const ex = wardrobeExitX(map, wIdx)
  const ey = wardrobeExitY(map, wIdx)
  const dirX = Math.sign(wardrobeCenterX(map, wIdx) - ex)
  const dirY = Math.sign(wardrobeCenterY(map, wIdx) - ey)
  a.send('test:teleport', { slot, x: ex, y: ey })
  await wait(150)
  for (let t = 0; t < 40 && sa.snap.hiddenIn[slot] === NO_SLOT; t++) {
    sendInput(dirX, dirY)
    await wait(50)
  }
  ok(sa.snap.hiddenIn[slot] === wIdx, `walking into a keyed wardrobe hides us (wardrobe ${wIdx})`)
  ok(sb.snap.hiddenIn[slot] === wIdx, 'the other client mirrors the hidden state (interior view + parked avatar)')

  // Exit: any input after the door has shut steps us back out onto the exit tile.
  await wait(700)
  for (let t = 0; t < 20 && sa.snap.hiddenIn[slot] !== NO_SLOT; t++) {
    sendInput(dirX, dirY)
    await wait(50)
  }
  ok(sa.snap.hiddenIn[slot] === NO_SLOT, 'input after the minimum hide steps us back out')

  // ── Tools: grab one from the floor, deploy it, and feed a bot to it — on the wire ──
  const toolType = sa.toolSpawns[2]! // (x, y, type) triples; we take tool 0
  ok(sa.toolSpawns.length >= 3, `tool spawns broadcast (${sa.toolSpawns.length / 3} tools)`)
  a.send('test:teleport', { slot, x: sa.toolSpawns[0]!, y: sa.toolSpawns[1]! })
  await wait(300)
  ok((sa.snap.held[slot]! & 0x0f) === toolType, `walking over a tool puts it in hand A (type ${toolType})`)
  ok((sa.snap.toolTaken & 1) === 1, 'the claimed tool vanishes from the floor for everyone')

  a.send(MSG.Use, 0)
  await wait(300)
  let dep = -1
  for (let i = 0; i < 8; i++) if (sa.snap.depType[i] !== 0) dep = i
  ok(dep >= 0, 'using the tool deploys it at our feet')
  ok((sa.snap.held[slot]! & 0x0f) === 0, 'the used tool leaves the hand')

  let victim = -1
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (sa.snap.active[s] === 1 && sa.snap.isBot[s] === 1 && s !== sa.snap.itSlot) {
      victim = s
      break
    }
  }
  if (toolType === 2) await wait(1400) // let the trap arm
  let affected = false
  for (let t = 0; t < 12 && !affected; t++) {
    if (dep >= 0 && (t % 3 === 0 || sa.snap.depType[dep] !== 0)) {
      a.send('test:teleport', { slot: victim, x: sa.snap.depX[dep]!, y: sa.snap.depY[dep]! })
    }
    await wait(150)
    affected = toolType === 2 ? sa.snap.unconscious[victim] === 1 : sa.snap.slowed[victim] === 1
  }
  ok(affected, toolType === 2 ? 'the trap knocked the bot out cold (on the wire)' : 'the goo slows the bot (on the wire)')

  // ── Chat: relayed to the whole room, sanitised, never stored ──
  a.send(MSG.Chat, '  the ghost is by the lamp!  ')
  await wait(300)
  ok(
    sb.chat !== null && sb.chat.slot === slot && sb.chat.text === 'the ghost is by the lamp!',
    `chat relays to the other client, trimmed and sanitised (got: ${JSON.stringify(sb.chat)})`,
  )
  ok(sa.chat !== null, 'the sender hears their own line back (single source of truth)')
  sb.chat = null
  a.send(MSG.Chat, 'too fast') // inside the 600ms rate window: dropped
  await wait(250)
  ok(sb.chat === null, 'a second line inside the rate window is dropped')

  // ── Transformation: the tag, the lull, the crowning, the trail growth — on the wire ──
  let taggedUs = false
  for (let tries = 0; tries < 60 && !taggedUs; tries++) {
    const g = sa.snap.itSlot
    if (g !== NO_SLOT && g !== slot) a.send('test:teleport', { slot, x: sa.snap.x[g]!, y: sa.snap.y[g]! })
    await wait(150)
    taggedUs = sa.snap.turningSlot === slot
  }
  ok(taggedUs, 'standing on the ghost begins our metamorphosis')

  await wait(250)
  ok(sa.snap.itSlot === NO_SLOT && sa.snap.turningSlot === slot, 'nobody hunts during the lull')
  ok(sb.snap.turningSlot === slot, 'the other client sees the metamorphosis (wreath + halo target)')
  ok(mirrorBodies() === 0, 'no trail bodies exist anywhere during the lull (client-mirror derived)')

  let crowned = false
  for (let t = 0; t < 60 && !crowned; t++) {
    await wait(120)
    crowned = sa.snap.itSlot === slot
  }
  ok(crowned, 'the metamorphosis crowns us as the ghost')
  ok(sa.snap.itAgeTicks < 40, `the trail clock restarted at crowning (age ${sa.snap.itAgeTicks} ticks)`)
  const bodies0 = mirrorBodies()
  await wait(1300)
  const bodies1 = mirrorBodies()
  ok(
    bodies1 > bodies0 && bodies1 <= 15,
    `the ghost trail grows from empty after crowning (${bodies0} -> ${bodies1} bodies, cap 15)`,
  )

  await a.leave()
  await b.leave()

  // ── Private rooms: code creates a pool; wrong code refuses ──
  const code = 'QQZZT'
  const host = await client().create('arena', { code })
  const sh = collect(host)
  host.send(MSG.Go) // alone: must be refused
  await wait(400)
  ok(sh.snapshots === 0 || sh.snap.phase === 0, 'a lone host cannot start — two humans minimum')
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
  host.send(MSG.Bots, 3) // the host chooses the bot count — including zero
  await wait(200)
  host.send(MSG.Go)
  await wait(600)
  ok(sf.snap.phase >= 1, `host start begins the private round (phase ${sf.snap.phase})`)
  let privBots = 0
  let privSeats = 0
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (sf.snap.active[s] !== 1) continue
    privSeats++
    if (sf.snap.isBot[s] === 1) privBots++
  }
  ok(
    privBots === 3 && privSeats === 5,
    `the host chose the bot count: 2 humans + 3 bots = ${privSeats} seats (${privBots} bots)`,
  )

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
