import {
  MAX_PLAYERS,
  MAX_TOOL_SPAWNS,
  MAX_WARDROBES,
  MSG,
  NO_SLOT,
  TICK_MS,
  TOOL_SLOTS,
  createSnapshot,
  createWorld,
  integratePlayer,
  readHistoryBlob,
  readSnapshot,
  rebuildEchoBodies,
  sampleHistory,
  setMap,
  type World,
} from '@echo-tag/shared'
import { Client, type Room } from '@colyseus/sdk'

/**
 * The network driver: keeps a local *mirror* of the authoritative world.
 *
 * The server is the only simulation that decides anything. The client holds a `World`
 * struct that it fills from 20Hz snapshots — and because every renderer reads a `World`
 * and echoes are derived from the position stream (docs/adr/0004), the entire
 * presentation stack works unchanged whether the world is local or mirrored. Each
 * snapshot is fed through `sampleHistory` + `rebuildEchoBodies`, so echo trails here are
 * bit-identical to the server's own.
 *
 * The local avatar gets prediction-lite: inputs apply immediately through the same
 * `integratePlayer` (against mirrored walls, doors and echoes), and the server's answer
 * is blended in at 12% per tick — instant feel, gentle correction, a snap only if the
 * error exceeds a body length. Full rewind-and-replay reconciliation is the Phase 5
 * upgrade; this is the honest MVP of it.
 */

export type JoinMode =
  | { kind: 'quick' }
  | { kind: 'host'; code: string }
  | { kind: 'code'; code: string }

export interface LobbyView {
  phase: number
  humans: number
  /** Bots the host has asked for (private rooms; public rooms auto-fill regardless). */
  bots: number
  /** Round length in whole minutes (private-room hosts may change it). */
  roundMins: number
  mapIndex: number
  isHost: boolean
  isPrivate: boolean
  code: string
  /** Ranked rows for the results screen: least It-time first, caught count as tiebreak. */
  scores: Array<{ colorSlot: number; itTimeMs: number; caught: number; isBot: boolean; slot: number }>
}

export interface NetGame {
  world: World
  mySlot: number
  /** Fraction [0,1) of the way to the next expected snapshot — the render lerp. */
  alpha(): number
  prevX: Float32Array
  prevY: Float32Array
  prevBodyX: Float32Array
  prevBodyY: Float32Array
  /** Called each fixed local tick with the current input byte. */
  sendInput(packed: number): void
  /** Fire-and-forget: use tool inventory slot 0 or 1. The server validates everything. */
  useTool(invSlot: number): void
  /** Sends a chat line to the room. Relay-only: nothing is stored anywhere. */
  sendChat(text: string): void
  onChat(cb: (slot: number, text: string) => void): void
  /** Flashes emote n above this player's head, for everyone. Relay-only, like chat. */
  sendEmote(n: number): void
  onEmote(cb: (slot: number, n: number) => void): void
  /** Host only, private lobbies: how many bots should join at round start. */
  setBots(n: number): void
  /** Host only, private lobbies: round length in whole minutes (clamped server-side). */
  setRoundMins(n: number): void
  /** Host only, private lobbies: select map. */
  setMapIndex(n: number): void
  onLobby(cb: (view: LobbyView) => void): void
  onTag(cb: (from: number, to: number) => void): void
  onRoundSetup(cb: () => void): void
  onHostLeft(cb: () => void): void
  start(): void
  destroy(): void
}

const wsOrigin = (): string => {
  // Test hook: the e2e check points a built page at its own server port.
  const override = (globalThis as { __wsOverride?: string }).__wsOverride
  if (override) return override
  const env = (import.meta as { env?: Record<string, string> }).env
  return env?.VITE_WS_ORIGIN ?? 'ws://localhost:2567'
}

export const makeCode = (): string => {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ' // no I/L/O — codes get read aloud
  let code = ''
  for (let i = 0; i < 5; i++) code += A[(Math.random() * A.length) | 0]
  return code
}

export const connect = async (mode: JoinMode): Promise<NetGame> => {
  const client = new Client(wsOrigin())
  let room: Room
  const code = mode.kind === 'quick' ? '' : mode.code
  if (mode.kind === 'quick') room = await client.joinOrCreate('arena', { code: '' })
  else if (mode.kind === 'host') room = await client.create('arena', { code })
  else room = await client.join('arena', { code })

  // The room code lives in the URL, so a refresh rejoins the same room and keeps playing.
  // Quick-match rooms have no code and stay unaddressable, exactly as before.
  if (code !== '') {
    try {
      history.replaceState(null, '', `?room=${code}`)
    } catch {
      /* embedded contexts may forbid history access; the game works without it */
    }
  }

  const world = createWorld(0, 0)
  const snap = createSnapshot()
  let mySlot = 0
  let sinceSnapMs = 0
  let lastSnapAt = performance.now()
  let seq = 1
  const inputBuf = new Uint8Array(3)

  // Server's latest word on the local avatar, blended into the prediction.
  let serverMyX = 0
  let serverMyY = 0
  let havePrediction = false

  const prevX = new Float32Array(MAX_PLAYERS)
  const prevY = new Float32Array(MAX_PLAYERS)
  const prevBodyX = new Float32Array(world.bodyX.length)
  const prevBodyY = new Float32Array(world.bodyY.length)

  let lobbyCb: ((v: LobbyView) => void) | null = null
  let tagCb: ((from: number, to: number) => void) | null = null
  let roundCb: (() => void) | null = null
  let chatCb: ((slot: number, text: string) => void) | null = null
  let emoteCb: ((slot: number, n: number) => void) | null = null
  let hostLeftCb: (() => void) | null = null
  let lastLobbyView: LobbyView | null = null
  let prevIt = NO_SLOT
  let firstSnapshot = true
  let hasRoundSetup = false

  room.onMessage(MSG.Chat, (m: { slot: number; text: string }) => {
    if (typeof m?.slot === 'number' && typeof m?.text === 'string') chatCb?.(m.slot, m.text)
  })

  room.onMessage(MSG.Emote, (m: { slot: number; n: number }) => {
    if (typeof m?.slot === 'number' && typeof m?.n === 'number') emoteCb?.(m.slot, m.n)
  })

  room.onMessage(MSG.HostLeft, () => {
    hostLeftCb?.()
  })

  const applyKeys = (mask: number): void => {
    world.keys.fill(0)
    for (let i = 0; i < MAX_WARDROBES; i++) {
      if (mask & (1 << i)) world.keys[mySlot * MAX_WARDROBES + i] = 1
    }
  }

  /** Floor-key spawn positions, fixed for the round; snapshots then track who took what. */
  const applyKeySpawns = (spawns: number[]): void => {
    world.keyTaken.fill(1)
    for (let i = 0; i * 2 + 1 < spawns.length && i < MAX_WARDROBES; i++) {
      world.keyX[i] = spawns[i * 2]!
      world.keyY[i] = spawns[i * 2 + 1]!
      world.keyTaken[i] = 0
    }
  }

  /** Floor-tool spawns, (x, y, type) triples — same lifecycle as key spawns. */
  const applyToolSpawns = (spawns: number[]): void => {
    world.toolTaken.fill(1)
    world.toolType.fill(0)
    for (let i = 0; i * 3 + 2 < spawns.length && i < MAX_TOOL_SPAWNS; i++) {
      world.toolX[i] = spawns[i * 3]!
      world.toolY[i] = spawns[i * 3 + 1]!
      world.toolType[i] = spawns[i * 3 + 2]!
      world.toolTaken[i] = 0
    }
  }

  interface Welcome {
    slot: number
    mapIndex: number
    roundMs?: number
    tick: number
    keys: number
    keySpawns: number[]
    toolSpawns: number[]
    colors: number[]
    history: Uint8Array
  }

  interface RoundSetup {
    mapIndex: number
    roundMs?: number
    keys: number
    keySpawns: number[]
    toolSpawns: number[]
    colors: number[]
  }

  room.onMessage(MSG.Welcome, (m: Welcome) => {
    mySlot = m.slot
    setMap(world, m.mapIndex)
    world.roundDurationMs = m.roundMs ?? world.roundDurationMs
    for (let s = 0; s < MAX_PLAYERS; s++) world.colorSlot[s] = m.colors[s] ?? s
    readHistoryBlob(world, new DataView(m.history.buffer, m.history.byteOffset, m.history.byteLength))
    world.tick = m.tick
    applyKeys(m.keys)
    applyKeySpawns(m.keySpawns ?? [])
    applyToolSpawns(m.toolSpawns ?? [])
    havePrediction = false
    hasRoundSetup = true
    roundCb?.()
  })

  room.onMessage(MSG.Round, (m: RoundSetup) => {
    setMap(world, m.mapIndex)
    world.roundDurationMs = m.roundMs ?? world.roundDurationMs
    for (let s = 0; s < MAX_PLAYERS; s++) world.colorSlot[s] = m.colors[s] ?? s
    applyKeys(m.keys)
    applyKeySpawns(m.keySpawns ?? [])
    applyToolSpawns(m.toolSpawns ?? [])
    havePrediction = false
    hasRoundSetup = true
    roundCb?.()
  })

  room.onMessage(MSG.Snapshot, (data: Uint8Array) => {
    readSnapshot(new DataView(data.buffer, data.byteOffset, data.byteLength), snap)

    prevX.set(world.x)
    prevY.set(world.y)
    prevBodyX.set(world.bodyX)
    prevBodyY.set(world.bodyY)

    const dtSec = TICK_MS / 1000
    for (let s = 0; s < MAX_PLAYERS; s++) {
      world.active[s] = snap.active[s]!
      if (snap.active[s] === 0) continue
      world.isBot[s] = snap.isBot[s]!
      // Hide onset: stamp the sim clock so the interior overlay's creak runs on the same
      // tick count as the server's eviction timer — correct even in a throttled
      // background tab, because snapshots keep arriving while rAF does not.
      if (snap.hiddenIn[s] !== NO_SLOT && world.hiddenIn[s] === NO_SLOT) {
        world.hiddenSinceTick[s] = snap.tick
      }
      world.hiddenIn[s] = snap.hiddenIn[s]!
      world.immuneUntilTick[s] = snap.immune[s] === 1 ? snap.tick + 2 : 0
      // Mirrored the same way as immunity: renewed every snapshot while the flag holds,
      // so renderers (collapsed pose) and prediction (input is dead while out cold) agree
      // with the server without needing the exact wake tick on the wire.
      world.unconsciousUntilTick[s] = snap.unconscious[s] === 1 ? snap.tick + 2 : 0
      // Live key ownership: keyhole markers appear the moment anyone grabs a floor key.
      for (let i = 0; i < MAX_WARDROBES; i++) {
        world.keys[s * MAX_WARDROBES + i] = (snap.keys[s]! >> i) & 1
      }
      world.slowedUntilTick[s] = snap.slowed[s] === 1 ? snap.tick + 2 : 0
      world.held[s * TOOL_SLOTS] = snap.held[s]! & 0x0f
      world.held[s * TOOL_SLOTS + 1] = (snap.held[s]! >> 4) & 0x0f

      if (s === mySlot && havePrediction && snap.hiddenIn[s] === NO_SLOT) {
        // Remember the server's answer; the fixed tick blends it into the prediction.
        serverMyX = snap.x[s]!
        serverMyY = snap.y[s]!
      } else {
        const jx = snap.x[s]! - world.x[s]!
        const jy = snap.y[s]! - world.y[s]!
        // Teleport-sized jumps — the first snapshot after joining (the mirror still reads
        // 0,0), round-start respawns, wardrobe exits — must not read as movement: a
        // velocity derived from one screeches the footstep voice (hundreds of times
        // normal playback rate) and the render lerp would glide the body across the map.
        // Snap instead. 60 units is ~4x the fastest legitimate per-snapshot delta.
        if (jx * jx + jy * jy > 60 * 60) {
          world.vx[s] = 0
          world.vy[s] = 0
          prevX[s] = snap.x[s]!
          prevY[s] = snap.y[s]!
        } else {
          world.vx[s] = jx / dtSec
          world.vy[s] = jy / dtSec
        }
        world.x[s] = snap.x[s]!
        world.y[s] = snap.y[s]!
        if (s === mySlot) {
          serverMyX = snap.x[s]!
          serverMyY = snap.y[s]!
          havePrediction = true
        }
      }
    }

    const prevTurning = world.turningSlot
    world.itSlot = snap.itSlot
    // Trail gating and the transformation effect both come straight from the snapshot, so
    // a late joiner never renders less trail than the server collides with.
    world.itSinceTick = snap.tick - snap.itAgeTicks
    world.turningSlot = snap.turningSlot
    world.turningUntilTick = snap.tick + snap.turningTicksLeft
    world.phase = snap.phase as World['phase']
    world.clockMs = snap.clockMs
    world.tick = snap.tick
    for (let d = 0; d < snap.doorCount; d++) world.doorOpen[d] = snap.doorOpen[d]!
    // Exact mirror, both directions: a disconnecting player's keys and tools RETURN to
    // the floor (removePlayer puts them back), so a cleared bit must clear here too.
    // Safe because the websocket is ordered — a snapshot can never arrive before the
    // round-setup message that defined this round's spawns.
    for (let i = 0; i < MAX_WARDROBES; i++) {
      world.keyTaken[i] = (snap.keyTaken >> i) & 1
    }
    for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
      world.toolTaken[i] = (snap.toolTaken >> i) & 1
    }
    // Deployed tools: rebuild the pool from the snapshot (it is small and authoritative).
    world.depType.set(snap.depType)
    for (let i = 0; i < world.depType.length; i++) {
      if (snap.depType[i] === 0) continue
      world.depX[i] = snap.depX[i]!
      world.depY[i] = snap.depY[i]!
      world.depUntilTick[i] = snap.tick + snap.depTicksLeft[i]!
    }

    // Echo trails: identical reconstruction to the server, per ADR 0004.
    sampleHistory(world)
    rebuildEchoBodies(world)

    // The tag lands at the START of the metamorphosis (itSlot passes through NO_SLOT for
    // the whole lull, so watching itSlot alone would never fire). Never on the FIRST
    // snapshot: a joiner arriving mid-metamorphosis would otherwise replay a seconds-old
    // tag — sting and scatter burst — the moment they connect.
    if (!firstSnapshot && snap.turningSlot !== NO_SLOT && snap.turningSlot !== prevTurning) {
      tagCb?.(prevIt, snap.turningSlot)
    }
    firstSnapshot = false
    if (world.itSlot !== NO_SLOT) prevIt = world.itSlot
    // Round boundaries pass through non-Playing phases; last round's ghost must not be
    // blamed for the next round's first tag.
    if (world.phase !== 2) prevIt = NO_SLOT

    sinceSnapMs = 0
    lastSnapAt = performance.now()
  })

  room.onStateChange((state) => {
    const s = state as unknown as {
      phase: number
      mapIndex: number
      humans: number
      bots: number
      roundMins: number
      hostId: string
      isPrivate: boolean
      players: { forEach(cb: (m: { slot: number; colorSlot: number; isBot: boolean; itTimeMs: number; caught: number }) => void): void }
    }
    const scores: LobbyView['scores'] = []
    s.players.forEach((m) => {
      world.colorSlot[m.slot] = m.colorSlot
      scores.push({ slot: m.slot, colorSlot: m.colorSlot, isBot: m.isBot, itTimeMs: m.itTimeMs, caught: m.caught ?? 0 })
    })
    // Same ordering as the shared leaderboard(): least It-time, then fewest catches, then slot.
    scores.sort((a, b) => a.itTimeMs - b.itTimeMs || a.caught - b.caught || a.slot - b.slot)
    lastLobbyView = {
      phase: s.phase,
      mapIndex: s.mapIndex ?? 0,
      humans: s.humans,
      bots: s.bots ?? 0,
      roundMins: s.roundMins || 3,
      isHost: s.hostId === room.sessionId,
      isPrivate: s.isPrivate,
      code,
      scores,
    }
    lobbyCb?.(lastLobbyView)
  })

  return {
    world,
    get mySlot() {
      return mySlot
    },
    alpha: () => Math.min((performance.now() - lastSnapAt) / TICK_MS, 1) + sinceSnapMs * 0,
    prevX,
    prevY,
    prevBodyX,
    prevBodyY,

    sendInput(packed: number): void {
      inputBuf[0] = seq & 0xff
      inputBuf[1] = (seq >> 8) & 0xff
      inputBuf[2] = packed
      seq = (seq + 1) & 0xffff
      try {
        room.send(MSG.Input, inputBuf)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }

      // Prediction-lite: move now, agree with the server gradually. Never predict while
      // out cold — the server holds the body still, and predicting through a KO makes the
      // faint feel like rubber-banding instead of a knockout.
      if (
        havePrediction &&
        world.active[mySlot] === 1 &&
        world.hiddenIn[mySlot] === NO_SLOT &&
        world.tick >= world.unconsciousUntilTick[mySlot]! &&
        world.phase === 2
      ) {
        integratePlayer(world, mySlot, packed)
        const errX = serverMyX - world.x[mySlot]!
        const errY = serverMyY - world.y[mySlot]!
        const errSq = errX * errX + errY * errY
        if (errSq > 120 * 120) {
          world.x[mySlot] = serverMyX
          world.y[mySlot] = serverMyY
        } else {
          world.x[mySlot] = world.x[mySlot]! + errX * 0.12
          world.y[mySlot] = world.y[mySlot]! + errY * 0.12
        }
      }
    },

    useTool(invSlot: number): void {
      try {
        room.send(MSG.Use, invSlot)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }
    },

    sendChat(text: string): void {
      try {
        room.send(MSG.Chat, text)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }
    },
    onChat(cb): void {
      chatCb = cb
    },

    sendEmote(n: number): void {
      try {
        room.send(MSG.Emote, n)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }
    },
    onEmote(cb): void {
      emoteCb = cb
    },

    setBots(n: number): void {
      try {
        room.send(MSG.Bots, n)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }
    },

    setRoundMins(n: number): void {
      try {
        room.send(MSG.Mins, n)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }
    },

    setMapIndex(n: number): void {
      try {
        room.send(MSG.Map, n)
      } catch {
        /* transient disconnects surface via onLeave, not here */
      }
    },

    onLobby(cb): void {
      lobbyCb = cb
      // The initial state often lands before the caller has registered (imports in
      // between are async) — replay the latest view so the lobby never renders stale.
      if (lastLobbyView) cb(lastLobbyView)
    },
    onTag(cb): void {
      tagCb = cb
    },
    onRoundSetup(cb): void {
      roundCb = cb
      if (hasRoundSetup) cb()
    },
    onHostLeft(cb): void {
      hostLeftCb = cb
    },
    start(): void {
      room.send(MSG.Go)
    },
    destroy(): void {
      void room.leave()
    },
  }
}
