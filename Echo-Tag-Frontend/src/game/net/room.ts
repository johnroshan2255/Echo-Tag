import {
  MAX_PLAYERS,
  MAX_WARDROBES,
  MSG,
  NO_SLOT,
  TICK_MS,
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
  isHost: boolean
  isPrivate: boolean
  code: string
  /** (colorSlot, itTimeMs, isBot) triples for the results screen. */
  scores: Array<{ colorSlot: number; itTimeMs: number; isBot: boolean; slot: number }>
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
  onLobby(cb: (view: LobbyView) => void): void
  onTag(cb: (from: number, to: number) => void): void
  onRoundSetup(cb: () => void): void
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
  let prevIt = NO_SLOT

  const applyKeys = (mask: number): void => {
    world.keys.fill(0)
    for (let i = 0; i < MAX_WARDROBES; i++) {
      if (mask & (1 << i)) world.keys[mySlot * MAX_WARDROBES + i] = 1
    }
  }

  interface Welcome {
    slot: number
    mapIndex: number
    tick: number
    keys: number
    colors: number[]
    history: Uint8Array
  }

  room.onMessage(MSG.Welcome, (m: Welcome) => {
    mySlot = m.slot
    setMap(world, m.mapIndex)
    for (let s = 0; s < MAX_PLAYERS; s++) world.colorSlot[s] = m.colors[s] ?? s
    readHistoryBlob(world, new DataView(m.history.buffer, m.history.byteOffset, m.history.byteLength))
    world.tick = m.tick
    applyKeys(m.keys)
    havePrediction = false
    roundCb?.()
  })

  room.onMessage(MSG.Round, (m: { mapIndex: number; keys: number; colors: number[] }) => {
    setMap(world, m.mapIndex)
    for (let s = 0; s < MAX_PLAYERS; s++) world.colorSlot[s] = m.colors[s] ?? s
    applyKeys(m.keys)
    havePrediction = false
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
      world.hiddenIn[s] = snap.hiddenIn[s]!
      world.immuneUntilTick[s] = snap.immune[s] === 1 ? snap.tick + 2 : 0

      if (s === mySlot && havePrediction && snap.hiddenIn[s] === NO_SLOT) {
        // Remember the server's answer; the fixed tick blends it into the prediction.
        serverMyX = snap.x[s]!
        serverMyY = snap.y[s]!
      } else {
        world.vx[s] = (snap.x[s]! - world.x[s]!) / dtSec
        world.vy[s] = (snap.y[s]! - world.y[s]!) / dtSec
        world.x[s] = snap.x[s]!
        world.y[s] = snap.y[s]!
        if (s === mySlot) {
          serverMyX = snap.x[s]!
          serverMyY = snap.y[s]!
          havePrediction = true
        }
      }
    }

    world.itSlot = snap.itSlot
    world.phase = snap.phase as World['phase']
    world.clockMs = snap.clockMs
    world.tick = snap.tick
    for (let d = 0; d < snap.doorCount; d++) world.doorOpen[d] = snap.doorOpen[d]!

    // Echo trails: identical reconstruction to the server, per ADR 0004.
    sampleHistory(world)
    rebuildEchoBodies(world)

    if (world.itSlot !== prevIt && world.itSlot !== NO_SLOT && prevIt !== NO_SLOT) {
      tagCb?.(prevIt, world.itSlot)
    }
    prevIt = world.itSlot

    sinceSnapMs = 0
    lastSnapAt = performance.now()
  })

  room.onStateChange((state) => {
    const s = state as unknown as {
      phase: number
      humans: number
      hostId: string
      isPrivate: boolean
      players: { forEach(cb: (m: { slot: number; colorSlot: number; isBot: boolean; itTimeMs: number }) => void): void }
    }
    const scores: LobbyView['scores'] = []
    s.players.forEach((m) => scores.push({ slot: m.slot, colorSlot: m.colorSlot, isBot: m.isBot, itTimeMs: m.itTimeMs }))
    scores.sort((a, b) => a.itTimeMs - b.itTimeMs)
    lobbyCb?.({
      phase: s.phase,
      humans: s.humans,
      isHost: s.hostId === room.sessionId,
      isPrivate: s.isPrivate,
      code,
      scores,
    })
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

      // Prediction-lite: move now, agree with the server gradually.
      if (havePrediction && world.active[mySlot] === 1 && world.hiddenIn[mySlot] === NO_SLOT && world.phase === 2) {
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

    onLobby(cb): void {
      lobbyCb = cb
    },
    onTag(cb): void {
      tagCb = cb
    },
    onRoundSetup(cb): void {
      roundCb = cb
    },
    start(): void {
      room.send(MSG.Go)
    },
    destroy(): void {
      void room.leave()
    },
  }
}
