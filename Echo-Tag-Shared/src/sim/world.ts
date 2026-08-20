import {
  ECHO_BODIES_PER_PLAYER,
  ECHO_SAMPLES,
  MAP_COUNT,
  MAP_H,
  MAX_DOORS,
  MAX_WARDROBES,
  MAP_TILES_X,
  MAP_W,
  MAX_PLAYERS,
  PLAYER_COLORS,
  SPAWNS_PER_MAP,
} from '../constants.ts'
import { MAPS, tileCenterX, tileCenterY, type GameMap } from '../maps/index.ts'
import { createSpatialHash, MAX_BODIES, type SpatialHash } from '../math/spatial-hash.ts'
import { nextState, seedFrom, toFloat } from '../math/rng.ts'
import { NO_SLOT, RoundPhase, type Slot, type StepEvents } from '../types.ts'
import { IDLE_INPUT } from './input.ts'

/**
 * The entire game state, as structure-of-arrays over typed arrays.
 *
 * Every array is allocated once, here, at its maximum size. Nothing in the tick path
 * ever grows, shrinks, or creates an array — that is what keeps `stepWorld` free of
 * GC pauses on mid-range Android, where a 30ms collection is a visible stutter.
 *
 * Index convention: a *slot* is a fixed 0..MAX_PLAYERS-1 index. Slots are reused when
 * players leave; `active[slot]` is the source of truth for occupancy.
 */
export interface World {
  // ── Round ──
  tick: number
  phase: RoundPhase
  /** Milliseconds elapsed in the current phase. */
  phaseMs: number
  /** Milliseconds elapsed in Playing. Drives the round clock and It-time. */
  clockMs: number
  rng: number
  seed: number

  // ── Arena ──
  /** Always MAP_W / MAP_H — kept as fields so nothing downstream hardcodes map size. */
  arenaW: number
  arenaH: number
  /** The authored map this round plays on. Swapped between rounds, never mid-round. */
  map: GameMap
  /** Openness per door slot, 0 (shut) .. 1 (open). Indexed by the map's door order. */
  doorOpen: Float32Array

  // ── Wardrobes ──
  /** Wardrobe index a player is hidden in, or NO_SLOT. Hidden = invisible + untaggable. */
  hiddenIn: Int8Array
  hiddenSinceTick: Int32Array
  /** Per (player, wardrobe): tick until that wardrobe accepts that player again. */
  wardrobeCooldownUntil: Int32Array
  /** Per (player, wardrobe): 1 when the player holds this wardrobe's key. */
  keys: Uint8Array

  // ── Players (length MAX_PLAYERS) ──
  active: Uint8Array
  isBot: Uint8Array
  colorSlot: Uint8Array
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  /** Heading in radians; keeps its last value while idle so avatars don't snap. */
  facing: Float32Array
  /** Accumulated time as "It" in ms. The score. Lower is better. */
  itTimeMs: Float32Array
  /** Tick until which this player cannot be tagged. */
  immuneUntilTick: Int32Array
  /** Tick until which this player cannot tag. Stops instant tag-backs. */
  tagCooldownUntilTick: Int32Array
  /** Last input byte applied, retained for render-side animation. */
  lastInput: Uint8Array

  /** Who is "It", or NO_SLOT during Lobby/Leaderboard. */
  itSlot: Slot
  /** Number of occupied slots. Derived, kept in sync by add/remove. */
  playerCount: number

  // ── Echo history ──
  /**
   * Ring buffers of past positions, `MAX_PLAYERS * ECHO_SAMPLES` long, indexed
   * `slot * ECHO_SAMPLES + i`. All players are sampled on the same tick, so a single
   * shared write cursor is correct and saves 12 separate heads.
   */
  histX: Float32Array
  histY: Float32Array
  /** Next write index within each player's span. */
  histHead: number
  /** Samples written so far, capped at ECHO_SAMPLES. Echoes fade in over the first 3s. */
  histFilled: number

  // ── Echo bodies (derived each tick from the rings) ──
  bodyX: Float32Array
  bodyY: Float32Array
  bodyLive: Uint8Array
  /** Owning slot per body id, so a player can skip its own too-fresh echoes. */
  bodyOwner: Uint8Array
  /** Age of the body in samples (0 = freshest). */
  bodyAge: Uint8Array
  hash: SpatialHash

  // ── Per-tick scratch ──
  events: StepEvents
}

/**
 * Swaps the round's map. Only meaningful between rounds — the next enterPhase(Countdown)
 * respawns everyone on it. All maps share one grid size, so no buffer resizes.
 */
export const setMap = (w: World, mapIndex: number): void => {
  w.map = MAPS[((mapIndex % MAP_COUNT) + MAP_COUNT) % MAP_COUNT]!
  w.doorOpen.fill(0)
  w.hiddenIn.fill(NO_SLOT)
  w.wardrobeCooldownUntil.fill(0)
}

export const createWorld = (seed: number, mapIndex = 0): World => {
  const arenaW = MAP_W
  const arenaH = MAP_H
  return {
    tick: 0,
    phase: RoundPhase.Lobby,
    phaseMs: 0,
    clockMs: 0,
    rng: seedFrom(seed),
    seed,

    arenaW,
    arenaH,
    map: MAPS[((mapIndex % MAP_COUNT) + MAP_COUNT) % MAP_COUNT]!,
    doorOpen: new Float32Array(MAX_DOORS),
    hiddenIn: new Int8Array(MAX_PLAYERS).fill(NO_SLOT),
    hiddenSinceTick: new Int32Array(MAX_PLAYERS),
    wardrobeCooldownUntil: new Int32Array(MAX_PLAYERS * MAX_WARDROBES),
    keys: new Uint8Array(MAX_PLAYERS * MAX_WARDROBES),

    active: new Uint8Array(MAX_PLAYERS),
    isBot: new Uint8Array(MAX_PLAYERS),
    colorSlot: new Uint8Array(MAX_PLAYERS),
    x: new Float32Array(MAX_PLAYERS),
    y: new Float32Array(MAX_PLAYERS),
    vx: new Float32Array(MAX_PLAYERS),
    vy: new Float32Array(MAX_PLAYERS),
    facing: new Float32Array(MAX_PLAYERS),
    itTimeMs: new Float32Array(MAX_PLAYERS),
    immuneUntilTick: new Int32Array(MAX_PLAYERS),
    tagCooldownUntilTick: new Int32Array(MAX_PLAYERS),
    lastInput: new Uint8Array(MAX_PLAYERS),

    itSlot: NO_SLOT,
    playerCount: 0,

    histX: new Float32Array(MAX_PLAYERS * ECHO_SAMPLES),
    histY: new Float32Array(MAX_PLAYERS * ECHO_SAMPLES),
    histHead: 0,
    histFilled: 0,

    bodyX: new Float32Array(MAX_BODIES),
    bodyY: new Float32Array(MAX_BODIES),
    bodyLive: new Uint8Array(MAX_BODIES),
    bodyOwner: new Uint8Array(MAX_BODIES),
    bodyAge: new Uint8Array(MAX_BODIES),
    hash: createSpatialHash(arenaW, arenaH),

    events: { tagCount: 0, tagFrom: NO_SLOT, tagTo: NO_SLOT, roundEnded: false },
  }
}

/** Draws the next float in [0, 1) and advances the world's stream. */
export const random = (w: World): number => {
  w.rng = nextState(w.rng)
  return toFloat(w.rng)
}

/**
 * Places players on the map's authored spawn tiles, rotated by a seed-derived offset so the
 * same map does not deal the same matchups every round. Spawns are authored far apart, so
 * the opening 30 seconds read as "open space" (GDD §5) even inside a maze.
 */
export const spawnAll = (w: World): void => {
  const offset = Math.floor(random(w) * SPAWNS_PER_MAP)

  let i = 0
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    const slot = ((i + offset) % SPAWNS_PER_MAP) * 2
    w.x[s] = tileCenterX(w.map.spawns[slot]!)
    w.y[s] = tileCenterY(w.map.spawns[slot + 1]!)
    w.vx[s] = 0
    w.vy[s] = 0
    // Face the map's centre: the action is inward, and it looks intentional.
    w.facing[s] = Math.atan2(w.arenaH / 2 - w.y[s]!, w.arenaW / 2 - w.x[s]!)
    i++
  }

  // Seed the whole history with the spawn position so the first 3 seconds of echoes
  // trail out of the spawn point instead of out of (0, 0).
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const base = s * ECHO_SAMPLES
    const px = w.x[s]!
    const py = w.y[s]!
    w.histX.fill(px, base, base + ECHO_SAMPLES)
    w.histY.fill(py, base, base + ECHO_SAMPLES)
  }
  w.histHead = 0
  w.histFilled = 0
}

/** Claims a free slot. Returns NO_SLOT when the room is full. */
export const addPlayer = (w: World, isBot: boolean): Slot => {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 1) continue

    w.active[s] = 1
    w.isBot[s] = isBot ? 1 : 0
    w.colorSlot[s] = pickColorSlot(w, s)
    w.vx[s] = 0
    w.vy[s] = 0
    w.itTimeMs[s] = 0
    w.immuneUntilTick[s] = 0
    w.tagCooldownUntilTick[s] = 0
    w.lastInput[s] = IDLE_INPUT
    w.playerCount++

    // A mid-round joiner starts wherever there is the most room, and their history is
    // flattened to that point so they don't drag a trail in from a previous occupant.
    placeInOpenSpace(w, s)
    const base = s * ECHO_SAMPLES
    w.histX.fill(w.x[s]!, base, base + ECHO_SAMPLES)
    w.histY.fill(w.y[s]!, base, base + ECHO_SAMPLES)

    return s
  }
  return NO_SLOT
}

export const removePlayer = (w: World, slot: Slot): void => {
  if (w.active[slot] === 0) return
  w.active[slot] = 0
  w.playerCount--
  // If "It" leaves, hand it to whoever has spent the least time as It — the fairest
  // choice available, and deterministic so client and server agree.
  if (w.itSlot === slot) w.itSlot = leastItTimeSlot(w, slot)
}

/** Lowest unused colour slot, falling back to the player slot itself. */
const pickColorSlot = (w: World, self: Slot): number => {
  for (let c = 0; c < PLAYER_COLORS.length; c++) {
    let taken = false
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (s !== self && w.active[s] === 1 && w.colorSlot[s] === c) {
        taken = true
        break
      }
    }
    if (!taken) return c
  }
  return self % PLAYER_COLORS.length
}

export const leastItTimeSlot = (w: World, exclude: Slot = NO_SLOT): Slot => {
  let best = NO_SLOT
  let bestMs = Number.POSITIVE_INFINITY
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0 || s === exclude) continue
    if (w.hiddenIn[s] !== NO_SLOT) continue // never hand "It" to someone inside a wardrobe
    if (w.itTimeMs[s]! < bestMs) {
      bestMs = w.itTimeMs[s]!
      best = s
    }
  }
  return best
}

/**
 * Picks the emptiest of a fixed set of candidate tiles, sampled from the map's open-tile
 * list — so a candidate can never be inside a wall. Deterministic (candidates come from the
 * world's RNG stream) and allocation-free.
 */
const placeInOpenSpace = (w: World, slot: Slot): void => {
  const CANDIDATES = 8
  const open = w.map.openTiles
  let bestX = w.arenaW / 2
  let bestY = w.arenaH / 2
  let bestScore = -1

  for (let c = 0; c < CANDIDATES; c++) {
    const tile = open[Math.floor(random(w) * open.length)]!
    const px = tileCenterX(tile % MAP_TILES_X)
    const py = tileCenterY(Math.floor(tile / MAP_TILES_X))

    // Score = distance to the nearest other live player. Higher is better.
    let nearest = Number.POSITIVE_INFINITY
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (s === slot || w.active[s] === 0) continue
      const dx = w.x[s]! - px
      const dy = w.y[s]! - py
      const d = dx * dx + dy * dy
      if (d < nearest) nearest = d
    }
    if (nearest > bestScore) {
      bestScore = nearest
      bestX = px
      bestY = py
    }
  }

  w.x[slot] = bestX
  w.y[slot] = bestY
  w.facing[slot] = Math.atan2(w.arenaH / 2 - bestY, w.arenaW / 2 - bestX)
}

/** Total live echo bodies possible right now. Grows as history fills during the first 3s. */
export const bodyCount = (): number => MAX_PLAYERS * ECHO_BODIES_PER_PLAYER
