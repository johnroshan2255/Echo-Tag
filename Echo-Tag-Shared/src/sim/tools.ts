import {
  GOO_LIFE_MS,
  GOO_LINGER_MS,
  GOO_RADIUS,
  KEY_SPAWN_CLEAR,
  NEST_RADIUS,
  PICKUP_SPACING,
  MAP_TILES_X,
  MAX_DEPLOYED,
  MAX_PLAYERS,
  MAX_TOOL_SPAWNS,
  SPAWNS_PER_MAP,
  TICK_MS,
  TOOL_GOO,
  TOOL_GRAB_R,
  TOOL_NONE,
  TOOL_SLOTS,
  TOOL_TRAP,
  TOOL_WEB,
  TRAP_ARM_MS,
  WEB_PATCH_RADIUS,
  TRAP_LIFE_MS,
  TRAP_RADIUS,
  UNCONSCIOUS_MS,
} from '../constants.ts'
import { tileCenterX, tileCenterY } from '../maps/index.ts'
import { NO_SLOT } from '../types.ts'
import { random, type World } from './world.ts'

/**
 * Tools: the mischief layer.
 *
 * Like keys, tools spawn on the floor at seeded-random open tiles and are grabbed by
 * walking over them — runners only, first come first kept, up to TOOL_SLOTS in hand.
 * Using one (a request queued by the input layer / a client message, consumed here on
 * the next tick so it is world state and stays deterministic) deploys it at the user's
 * feet:
 *
 *   - GOO shatters into a puddle: everyone ELSE crossing it is slowed hard, with a short
 *     lingering stickiness after stepping out. Slowing the ghost buys an escape; slowing
 *     a rival human feeds them to it.
 *   - TRAP arms after a beat, then knocks the first other player who crosses it out cold
 *     (the standard 3s unconsciousness) and is consumed. Yes, it works on the ghost.
 *
 * Owners are immune to their own deployments. The hidden are off the floor, the turning
 * are locked in their metamorphosis, and bots neither grab nor use tools — they never
 * deny a human the fun. Everything below is fixed-pool, deterministic, allocation-free.
 */

const GRAB_SQ = TOOL_GRAB_R * TOOL_GRAB_R
const GOO_SQ = GOO_RADIUS * GOO_RADIUS
const WEB_SQ = WEB_PATCH_RADIUS * WEB_PATCH_RADIUS
const TRAP_SQ = TRAP_RADIUS * TRAP_RADIUS
const CLEAR_SQ = KEY_SPAWN_CLEAR * KEY_SPAWN_CLEAR
const SPACING_SQ = PICKUP_SPACING * PICKUP_SPACING
const NEST_CLEAR_SQ = (NEST_RADIUS + 60) ** 2
const GOO_LIFE_TICKS = Math.ceil(GOO_LIFE_MS / TICK_MS)
const GOO_LINGER_TICKS = Math.ceil(GOO_LINGER_MS / TICK_MS)
const TRAP_LIFE_TICKS = Math.ceil(TRAP_LIFE_MS / TICK_MS)
const TRAP_ARM_TICKS = Math.ceil(TRAP_ARM_MS / TICK_MS)
const KO_TICKS = Math.ceil(UNCONSCIOUS_MS / TICK_MS)

/** A deployed trap is armed once it has sat on the floor for TRAP_ARM_MS. */
export const trapArmed = (w: World, d: number): boolean =>
  w.depUntilTick[d]! - w.tick <= TRAP_LIFE_TICKS - TRAP_ARM_TICKS

/**
 * Scatters MAX_TOOL_SPAWNS pickups (random type each) onto seeded-random open tiles,
 * clear of spawn points, and empties every hand and the deployed pool. Round entry only.
 */
export const spawnTools = (w: World): void => {
  w.held.fill(0)
  w.useQueued.fill(0)
  w.slowedUntilTick.fill(0)
  w.depType.fill(TOOL_NONE)
  w.toolTaken.fill(1)
  const open = w.map.openTiles

  const keyCount = w.map.wardrobes.length / 4
  for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
    let x = 0
    let y = 0
    for (let attempt = 0; attempt < 12; attempt++) {
      const tile = open[Math.floor(random(w) * open.length)]!
      x = tileCenterX(tile % MAP_TILES_X)
      y = tileCenterY(Math.floor(tile / MAP_TILES_X))
      let clear = true
      for (let sp = 0; clear && sp < SPAWNS_PER_MAP; sp++) {
        const dx = tileCenterX(w.map.spawns[sp * 2]!) - x
        const dy = tileCenterY(w.map.spawns[sp * 2 + 1]!) - y
        if (dx * dx + dy * dy < CLEAR_SQ) clear = false
      }
      // Pickups keep their distance from each other — tools AND keys — so grabbing one
      // can never silently scoop up a neighbour (spawnTools runs after spawnKeys).
      for (let t = 0; clear && t < i; t++) {
        const dx = w.toolX[t]! - x
        const dy = w.toolY[t]! - y
        if (dx * dx + dy * dy < SPACING_SQ) clear = false
      }
      for (let k = 0; clear && k < keyCount; k++) {
        const dx = w.keyX[k]! - x
        const dy = w.keyY[k]! - y
        if (dx * dx + dy * dy < SPACING_SQ) clear = false
      }
      // Never inside a nest spider's territory — same fairness rule as the keys.
      for (let n = 0; clear && n * 2 < w.map.nests.length; n++) {
        const dx = tileCenterX(w.map.nests[n * 2]!) - x
        const dy = tileCenterY(w.map.nests[n * 2 + 1]!) - y
        if (dx * dx + dy * dy < NEST_CLEAR_SQ) clear = false
      }
      if (clear) break
    }
    w.toolX[i] = x
    w.toolY[i] = y
    w.toolType[i] = random(w) < 0.5 ? TOOL_GOO : TOOL_TRAP
    w.toolTaken[i] = 0
  }
}

/**
 * Queues "use inventory slot k" for the next tick. Called by the local input layer or
 * the server's message handler — the request becomes world state, so both sides of the
 * wire resolve it identically. Invalid requests simply do nothing next tick.
 */
export const queueToolUse = (w: World, slot: number, invSlot: number): void => {
  if (invSlot !== 0 && invSlot !== 1) return
  if (w.useQueued[slot] === 0) w.useQueued[slot] = invSlot + 1
}

/** True while a player is goo-slowed — exported for renderers and the movement code. */
export const isSlowed = (w: World, slot: number): boolean => w.tick < w.slowedUntilTick[slot]!

export const updateTools = (w: World): void => {
  // ── Pickups: same predicate as keys — live human runners with a free hand ──
  for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
    if (w.toolTaken[i] === 1) continue
    const tx = w.toolX[i]!
    const ty = w.toolY[i]!
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (w.active[s] === 0 || w.isBot[s] === 1) continue
      if (s === w.itSlot || s === w.turningSlot) continue
      if (w.hiddenIn[s] !== NO_SLOT) continue
      if (w.tick < w.unconsciousUntilTick[s]!) continue
      const free = w.held[s * TOOL_SLOTS] === 0 ? 0 : w.held[s * TOOL_SLOTS + 1] === 0 ? 1 : -1
      if (free < 0) continue // hands full
      const dx = w.x[s]! - tx
      const dy = w.y[s]! - ty
      if (dx * dx + dy * dy > GRAB_SQ) continue
      w.toolTaken[i] = 1
      w.held[s * TOOL_SLOTS + free] = w.toolType[i]!
      break
    }
  }

  // ── Uses: consume the queue, deploy at the user's feet ──
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const q = w.useQueued[s]!
    if (q === 0) continue
    w.useQueued[s] = 0
    if (w.active[s] === 0) continue
    if (s === w.itSlot || s === w.turningSlot) continue // predators use trails, not tools
    if (w.hiddenIn[s] !== NO_SLOT) continue
    if (w.tick < w.unconsciousUntilTick[s]!) continue
    const inv = s * TOOL_SLOTS + (q - 1)
    const type = w.held[inv]!
    if (type === TOOL_NONE) continue

    let d = -1
    for (let i = 0; i < MAX_DEPLOYED; i++) {
      if (w.depType[i] === TOOL_NONE) {
        d = i
        break
      }
    }
    if (d < 0) continue // pool full: the use fails and the tool stays in hand

    w.held[inv] = TOOL_NONE
    w.depType[d] = type
    w.depOwner[d] = s
    w.depX[d] = w.x[s]!
    w.depY[d] = w.y[s]!
    w.depUntilTick[d] = w.tick + (type === TOOL_GOO ? GOO_LIFE_TICKS : TRAP_LIFE_TICKS)
  }

  // ── Effects ──
  for (let d = 0; d < MAX_DEPLOYED; d++) {
    const type = w.depType[d]!
    if (type === TOOL_NONE) continue
    if (w.tick >= w.depUntilTick[d]!) {
      w.depType[d] = TOOL_NONE
      continue
    }
    const dxp = w.depX[d]!
    const dyp = w.depY[d]!
    const owner = w.depOwner[d]!

    if (type === TOOL_GOO) {
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (s === owner || w.active[s] === 0) continue
        if (w.hiddenIn[s] !== NO_SLOT) continue
        const dx = w.x[s]! - dxp
        const dy = w.y[s]! - dyp
        if (dx * dx + dy * dy > GOO_SQ) continue
        w.slowedUntilTick[s] = w.tick + GOO_LINGER_TICKS
      }
      continue
    }

    // Web patch (a landed spider web, deployed by sim/monster.ts): the goo rules with the
    // spider's radius — the spider itself walks its own webs freely.
    if (type === TOOL_WEB) {
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (s === owner || w.active[s] === 0) continue
        if (w.hiddenIn[s] !== NO_SLOT) continue
        const dx = w.x[s]! - dxp
        const dy = w.y[s]! - dyp
        if (dx * dx + dy * dy > WEB_SQ) continue
        w.slowedUntilTick[s] = w.tick + GOO_LINGER_TICKS
      }
      continue
    }

    // Trap: waits out its arming beat, then takes the first other body that crosses it.
    if (!trapArmed(w, d)) continue
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (s === owner || w.active[s] === 0) continue
      if (w.hiddenIn[s] !== NO_SLOT) continue
      if (s === w.turningSlot) continue // locked in the metamorphosis, like trail stuns
      if (w.tick < w.unconsciousUntilTick[s]!) continue // a body cannot be re-trapped
      const dx = w.x[s]! - dxp
      const dy = w.y[s]! - dyp
      if (dx * dx + dy * dy > TRAP_SQ) continue
      w.unconsciousUntilTick[s] = w.tick + KO_TICKS
      w.vx[s] = 0
      w.vy[s] = 0
      w.depType[d] = TOOL_NONE // sprung
      break
    }
  }
}
