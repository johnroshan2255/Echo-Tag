import {
  ECHO_BODIES_PER_PLAYER,
  ECHO_SAMPLES,
  MAP_COUNT,
  MAP_H,
  MAX_DEPLOYED,
  MAX_DOORS,
  MAX_NESTS,
  MAX_TOOL_SPAWNS,
  MAX_WARDROBES,
  MAX_WEB_SHOTS,
  MAP_TILES_X,
  MAP_W,
  MAX_PLAYERS,
  PLAYER_COLORS,
  ROUND_DURATION_MS,
  SPAWNS_PER_MAP,
  TOOL_SLOTS,
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
  /** Round length. ROUND_DURATION_MS by default; a private-room host may change it. */
  roundDurationMs: number
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
  /** Floor keys, one per wardrobe: world position and whether someone has claimed it.
   * Spawned at seeded-random open tiles each round (spawnKeys); slots beyond the map's
   * wardrobe count stay marked taken so nothing renders or grabs them. */
  keyX: Float32Array
  keyY: Float32Array
  keyTaken: Uint8Array

  // ── Tools ──
  /** Floor tool pickups: position, type (TOOL_*, 0 = nothing here), claimed flag. */
  toolX: Float32Array
  toolY: Float32Array
  toolType: Uint8Array
  toolTaken: Uint8Array
  /** Per (player, inventory slot): the TOOL_* type held, 0 = empty. */
  held: Uint8Array
  /** Pending use requests, consumed by the next tick: 0 none, 1 slot A, 2 slot B. */
  useQueued: Uint8Array
  /** Tick until which each player is goo-slowed. */
  slowedUntilTick: Int32Array
  /** Deployed tools, fixed pool: type (0 = free), owner, position, expiry tick. */
  depType: Uint8Array
  depOwner: Uint8Array
  depX: Float32Array
  depY: Float32Array
  depUntilTick: Int32Array

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
  /** Times each player was caught this round (entered a metamorphosis). Score tie-breaker. */
  timesCaught: Uint8Array
  /** Tick until which this player cannot be tagged. */
  immuneUntilTick: Int32Array
  /** Tick until which this player cannot tag. Stops instant tag-backs. */
  tagCooldownUntilTick: Int32Array
  /** Last input byte applied, retained for render-side animation. */
  lastInput: Uint8Array

  /** Who is "It", or NO_SLOT during Lobby/Leaderboard. */
  itSlot: Slot
  /**
   * Tick the current ghost was crowned. The ghost's trail only admits samples recorded
   * from this tick on, so a new ghost starts with NO trail and grows one over the next
   * 3 seconds — the metamorphosis lull plus this ramp is the humans' head start.
   */
  itSinceTick: number
  /**
   * No-tag-backs: the player who just handed "It" over, untouchable BY the new It for the
   * immunity window. Solid trails used to keep the pair physically separated after a tag;
   * with visual-only trails (ADR 0012) they overlap, and without this rule the new It
   * returns the tag instantly and the role ping-pongs.
   */
  tagBackSlot: Slot
  tagBackUntilTick: number

  // ── Transformation ──
  /** Player mid-metamorphosis into the ghost, or NO_SLOT. While set, nobody hunts. */
  turningSlot: Slot
  turningUntilTick: number

  // ── Monster ability (spider web / alien beam; see sim/monster.ts) ──
  /** Pending ability press per slot, consumed next tick. Only the It's counts. */
  abilityQueued: Uint8Array
  /** Tick the It may use its ability again. Reset whenever the role changes hands. */
  abilityReadyTick: number
  /** Web shots, fixed pool: position, velocity, expiry tick (0 = free), firing slot. */
  webX: Float32Array
  webY: Float32Array
  webVX: Float32Array
  webVY: Float32Array
  webUntilTick: Int32Array
  webOwner: Uint8Array
  /** Beam: 0 idle, 1 charging, 2 flash (just fired, still drawn). */
  beamPhase: number
  beamUntilTick: number
  /** Aim, locked at the press. */
  beamAngle: number
  /** How far the fired beam reached (walls stop it) — the renderer draws exactly this. */
  beamReach: number

  // ── Nest spiders (environmental hazard; see sim/nest.ts) ──
  /** Spider position per nest (home is the map's nest tile). */
  nestX: Float32Array
  nestY: Float32Array
  /** 0 lurk, 1 lunge, 2 return, 3 rest. */
  nestState: Uint8Array
  /** Slot being hunted while lunging, else NO_SLOT. */
  nestTarget: Int8Array
  /** Rest-until tick while resting. */
  nestUntilTick: Int32Array
  /** Consecutive ticks of contact with the target — the grab needs NEST_GRAB_MS held. */
  nestContact: Uint8Array
  /** Lair index currently holding this player, or NO_SLOT. Held = input dead, carried. */
  heldByNest: Int8Array

  // ── Portals ──
  /** Tick until which each player's portals stay cold (anti ping-pong). */
  portalCooldownUntil: Int32Array

  // ── Unconsciousness ──
  /** Tick until which each player is out cold. 0 = awake. */
  unconsciousUntilTick: Int32Array
  /** Bitmask per player of trail owners they overlapped LAST tick — KO fires only on a
   * fresh 0→1 transition while moving, which is what makes it "walking into" a trail. */
  trailOverlap: Uint16Array
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
  resetHazards(w)
}

/** Parks every nest spider at its home tile and clears ability/portal transients. */
export const resetHazards = (w: World): void => {
  const nests = w.map.nests
  for (let n = 0; n < MAX_NESTS; n++) {
    w.nestX[n] = n * 2 + 1 < nests.length ? tileCenterX(nests[n * 2]!) : -9999
    w.nestY[n] = n * 2 + 1 < nests.length ? tileCenterY(nests[n * 2 + 1]!) : -9999
    w.nestState[n] = 0
    w.nestTarget[n] = NO_SLOT
    w.nestUntilTick[n] = 0
    w.nestContact[n] = 0
  }
  w.webUntilTick.fill(0)
  w.beamPhase = 0
  w.beamUntilTick = 0
  w.abilityQueued.fill(0)
  w.abilityReadyTick = 0
  w.portalCooldownUntil.fill(0)
  w.heldByNest.fill(NO_SLOT)
}

export const createWorld = (seed: number, mapIndex = 0): World => {
  const arenaW = MAP_W
  const arenaH = MAP_H
  const w: World = {
    tick: 0,
    phase: RoundPhase.Lobby,
    phaseMs: 0,
    clockMs: 0,
    roundDurationMs: ROUND_DURATION_MS,
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
    keyX: new Float32Array(MAX_WARDROBES),
    keyY: new Float32Array(MAX_WARDROBES),
    keyTaken: new Uint8Array(MAX_WARDROBES).fill(1),

    toolX: new Float32Array(MAX_TOOL_SPAWNS),
    toolY: new Float32Array(MAX_TOOL_SPAWNS),
    toolType: new Uint8Array(MAX_TOOL_SPAWNS),
    toolTaken: new Uint8Array(MAX_TOOL_SPAWNS).fill(1),
    held: new Uint8Array(MAX_PLAYERS * TOOL_SLOTS),
    useQueued: new Uint8Array(MAX_PLAYERS),
    slowedUntilTick: new Int32Array(MAX_PLAYERS),
    depType: new Uint8Array(MAX_DEPLOYED),
    depOwner: new Uint8Array(MAX_DEPLOYED),
    depX: new Float32Array(MAX_DEPLOYED),
    depY: new Float32Array(MAX_DEPLOYED),
    depUntilTick: new Int32Array(MAX_DEPLOYED),

    active: new Uint8Array(MAX_PLAYERS),
    isBot: new Uint8Array(MAX_PLAYERS),
    colorSlot: new Uint8Array(MAX_PLAYERS),
    x: new Float32Array(MAX_PLAYERS),
    y: new Float32Array(MAX_PLAYERS),
    vx: new Float32Array(MAX_PLAYERS),
    vy: new Float32Array(MAX_PLAYERS),
    facing: new Float32Array(MAX_PLAYERS),
    itTimeMs: new Float32Array(MAX_PLAYERS),
    timesCaught: new Uint8Array(MAX_PLAYERS),
    immuneUntilTick: new Int32Array(MAX_PLAYERS),
    tagCooldownUntilTick: new Int32Array(MAX_PLAYERS),
    lastInput: new Uint8Array(MAX_PLAYERS),

    itSlot: NO_SLOT,
    itSinceTick: 0,
    tagBackSlot: NO_SLOT,
    tagBackUntilTick: 0,
    turningSlot: NO_SLOT,
    turningUntilTick: 0,

    abilityQueued: new Uint8Array(MAX_PLAYERS),
    abilityReadyTick: 0,
    webX: new Float32Array(MAX_WEB_SHOTS),
    webY: new Float32Array(MAX_WEB_SHOTS),
    webVX: new Float32Array(MAX_WEB_SHOTS),
    webVY: new Float32Array(MAX_WEB_SHOTS),
    webUntilTick: new Int32Array(MAX_WEB_SHOTS),
    webOwner: new Uint8Array(MAX_WEB_SHOTS),
    beamPhase: 0,
    beamUntilTick: 0,
    beamAngle: 0,
    beamReach: 0,
    nestX: new Float32Array(MAX_NESTS).fill(-9999),
    nestY: new Float32Array(MAX_NESTS).fill(-9999),
    nestState: new Uint8Array(MAX_NESTS),
    nestTarget: new Int8Array(MAX_NESTS).fill(NO_SLOT),
    nestUntilTick: new Int32Array(MAX_NESTS),
    nestContact: new Uint8Array(MAX_NESTS),
    heldByNest: new Int8Array(MAX_PLAYERS).fill(NO_SLOT),
    portalCooldownUntil: new Int32Array(MAX_PLAYERS),

    unconsciousUntilTick: new Int32Array(MAX_PLAYERS),
    trailOverlap: new Uint16Array(MAX_PLAYERS),
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

    events: { tagCount: 0, tagFrom: NO_SLOT, tagTo: NO_SLOT, roundEnded: false, hazardCaught: NO_SLOT, portalUsed: NO_SLOT },
  }
  resetHazards(w)
  return w
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
    w.timesCaught[s] = 0
    w.immuneUntilTick[s] = 0
    w.tagCooldownUntilTick[s] = 0
    w.lastInput[s] = IDLE_INPUT
    // A reused slot must not inherit a departed player's claimed keys, tools, cooldowns
    // or transient states. removePlayer clears these too; both ends stay defensive so no
    // future removal path can hand a joiner a hidden or knocked-out body.
    w.keys.fill(0, s * MAX_WARDROBES, (s + 1) * MAX_WARDROBES)
    w.wardrobeCooldownUntil.fill(0, s * MAX_WARDROBES, (s + 1) * MAX_WARDROBES)
    w.held.fill(0, s * TOOL_SLOTS, (s + 1) * TOOL_SLOTS)
    w.useQueued[s] = 0
    w.slowedUntilTick[s] = 0
    w.hiddenIn[s] = NO_SLOT
    w.unconsciousUntilTick[s] = 0
    w.abilityQueued[s] = 0
    w.portalCooldownUntil[s] = 0
    w.heldByNest[s] = NO_SLOT
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

  // Return what the leaver holds to the floor, at the original spawn spots. A mid-round
  // disconnect must not shrink the round's key/tool economy — the refresh-rejoin flow
  // leans on this: a player who refreshes re-earns their kit instead of destroying it
  // for the whole room. A held tool goes back to the first claimed spawn of its type
  // (equivalent economy; the sim does not track which spawn a held tool came from).
  for (let i = 0; i < MAX_WARDROBES; i++) {
    if (w.keys[slot * MAX_WARDROBES + i] === 1) w.keyTaken[i] = 0
  }
  w.keys.fill(0, slot * MAX_WARDROBES, (slot + 1) * MAX_WARDROBES)
  for (let t = 0; t < TOOL_SLOTS; t++) {
    const held = w.held[slot * TOOL_SLOTS + t]!
    if (held === 0) continue
    w.held[slot * TOOL_SLOTS + t] = 0
    for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
      if (w.toolTaken[i] === 1 && w.toolType[i] === held) {
        w.toolTaken[i] = 0
        break
      }
    }
  }

  // Transient states die with the leaver: a hider's wardrobe must not stay haunted, a
  // KO must not outlive its body, and the no-tag-back pairing must not bind a stranger
  // who later reuses the slot.
  w.hiddenIn[slot] = NO_SLOT
  w.unconsciousUntilTick[slot] = 0
  w.useQueued[slot] = 0
  w.abilityQueued[slot] = 0
  w.heldByNest[slot] = NO_SLOT
  if (w.tagBackSlot === slot) w.tagBackUntilTick = 0
  // A lair grabber hunting (or holding) the leaver goes home rather than gripping a ghost.
  for (let n = 0; n < MAX_NESTS; n++) {
    if (w.nestTarget[n] === slot) {
      w.nestTarget[n] = NO_SLOT
      if (w.nestState[n] === 1 || w.nestState[n] === 4) w.nestState[n] = 2 // → return
      w.nestContact[n] = 0
    }
  }

  w.active[slot] = 0
  w.playerCount--
  // If "It" leaves, hand it to whoever has spent the least time as It — the fairest
  // choice available, and deterministic so client and server agree.
  const itBefore = w.itSlot
  if (w.itSlot === slot) w.itSlot = leastItTimeSlot(w, slot)
  // If the metamorphosing player leaves, the transformation dies with them and the role
  // passes directly — a 5s lull with no incoming ghost would otherwise strand the round.
  if (w.turningSlot === slot) {
    w.turningSlot = NO_SLOT
    if (w.itSlot === NO_SLOT) w.itSlot = leastItTimeSlot(w, slot)
  }
  // A handover crowns a new ghost: their trail starts empty from this tick (see itSinceTick).
  if (w.itSlot !== itBefore && w.itSlot !== NO_SLOT) w.itSinceTick = w.tick
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
