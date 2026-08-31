import {
  KEY_GRAB_R,
  KEY_SPAWN_CLEAR,
  NEST_RADIUS,
  PICKUP_SPACING,
  MAP_TILES_X,
  MAX_PLAYERS,
  MAX_WARDROBES,
  SPAWNS_PER_MAP,
  TICK_MS,
  WARDROBE_COOLDOWN_MS,
  WARDROBE_ENTER_R,
  WARDROBE_MAX_HIDE_MS,
  WARDROBE_MIN_HIDE_MS,
} from '../constants.ts'
import {
  tileCenterX,
  tileCenterY,
  wardrobeCenterX,
  wardrobeCenterY,
  wardrobeExitX,
  wardrobeExitY,
} from '../maps/index.ts'
import { NO_SLOT } from '../types.ts'
import { INPUT_DIR_X, INPUT_DIR_Y } from './input.ts'
import { random, type World } from './world.ts'

/**
 * Wardrobes: the hide mechanic.
 *
 * The rules, exactly as designed:
 *   - Only runners hide. "It" holds no keys — predators do not hide.
 *   - Keys are not dealt: one key per wardrobe lies on the floor at a seeded-random open
 *     tile (away from spawns and away from its own cabinet). Walk over a key to claim it
 *     for the round — first claimant keeps it, so keys are contested map knowledge.
 *   - Inside, you are invisible and untaggable — and blind. Nothing tells you whether the
 *     chaser has left the room. Stepping out beside a waiting It is the catch it sounds
 *     like: there is deliberately no exit immunity.
 *   - One body per wardrobe: an occupied cabinet refuses everyone else, key or no key.
 *     (With floor keys this is nearly structural — one key exists per wardrobe — but the
 *     sim enforces it directly so no future key rule can ever double-book a cabinet.)
 *   - A used wardrobe refuses you for 20 seconds. Other wardrobes are fine.
 *   - The door will not shelter you forever: it swings open on its own after 10 seconds.
 *     (Not in the original spec, but without it "hide until the clock runs out" would be
 *     the dominant strategy in a score-by-It-time game.)
 *
 * Entering is movement-only, keeping the one-input control scheme: walk into a wardrobe
 * you hold the key for. Exiting is pressing any direction after the door has shut.
 * Everything below is deterministic and allocation-free; hiding state is world state,
 * because a hider the server and client disagree about is a tag dispute.
 */

const ENTER_SQ = WARDROBE_ENTER_R * WARDROBE_ENTER_R
const GRAB_SQ = KEY_GRAB_R * KEY_GRAB_R
const CLEAR_SQ = KEY_SPAWN_CLEAR * KEY_SPAWN_CLEAR
const SPACING_SQ = PICKUP_SPACING * PICKUP_SPACING
const NEST_CLEAR_SQ = (NEST_RADIUS + 60) ** 2
const COOLDOWN_TICKS = Math.ceil(WARDROBE_COOLDOWN_MS / TICK_MS)
const MIN_HIDE_TICKS = Math.ceil(WARDROBE_MIN_HIDE_MS / TICK_MS)
const MAX_HIDE_TICKS = Math.ceil(WARDROBE_MAX_HIDE_MS / TICK_MS)

/**
 * Drops one key per wardrobe onto a seeded-random open tile, clear of every spawn point
 * and every wardrobe (bounded rerolls, so the tick discipline holds even on a bad seed).
 * Nobody holds anything at round start: finding a key is the first errand of the round.
 */
export const spawnKeys = (w: World): void => {
  w.keys.fill(0)
  w.keyTaken.fill(1) // slots beyond the map's count stay taken: never rendered, never grabbed
  const count = w.map.wardrobes.length / 4
  const open = w.map.openTiles

  for (let i = 0; i < count; i++) {
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
      for (let c = 0; clear && c < count; c++) {
        const dx = wardrobeCenterX(w.map, c) - x
        const dy = wardrobeCenterY(w.map, c) - y
        if (dx * dx + dy * dy < CLEAR_SQ) clear = false
      }
      // Never inside a nest spider's territory: a key at the spider's feet is not a
      // risk/reward call, it is a tax.
      for (let n = 0; clear && n * 2 < w.map.nests.length; n++) {
        const dx = tileCenterX(w.map.nests[n * 2]!) - x
        const dy = tileCenterY(w.map.nests[n * 2 + 1]!) - y
        if (dx * dx + dy * dy < NEST_CLEAR_SQ) clear = false
      }
      // Keep keys apart from each other: one walk-over must never scoop up two.
      for (let k = 0; clear && k < i; k++) {
        const dx = w.keyX[k]! - x
        const dy = w.keyY[k]! - y
        if (dx * dx + dy * dy < SPACING_SQ) clear = false
      }
      if (clear) break
    }
    w.keyX[i] = x
    w.keyY[i] = y
    w.keyTaken[i] = 0
  }
}

/**
 * Key pickups. A live human runner walking over an unclaimed key takes it: predators
 * ("It" and the mid-metamorphosis) do not pick up keys, the hidden are off the floor,
 * the unconscious are in no state to grab anything, and bots never hide so they never
 * deny a human a key. Lowest slot wins a same-tick tie — deterministic.
 */
export const updateKeys = (w: World): void => {
  const count = w.map.wardrobes.length / 4
  for (let i = 0; i < count; i++) {
    if (w.keyTaken[i] === 1) continue
    const kx = w.keyX[i]!
    const ky = w.keyY[i]!
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (w.active[s] === 0 || w.isBot[s] === 1) continue
      if (s === w.itSlot || s === w.turningSlot) continue
      if (w.hiddenIn[s] !== NO_SLOT) continue
      if (w.tick < w.unconsciousUntilTick[s]!) continue
      const dx = w.x[s]! - kx
      const dy = w.y[s]! - ky
      if (dx * dx + dy * dy > GRAB_SQ) continue
      w.keyTaken[i] = 1
      w.keys[s * MAX_WARDROBES + i] = 1
      break
    }
  }
}

export const isHidden = (w: World, slot: number): boolean => w.hiddenIn[slot] !== NO_SLOT

export const updateWardrobes = (w: World, inputs: Uint8Array): void => {
  const count = w.map.wardrobes.length / 4
  if (count === 0) return

  // Occupancy bitmask, taken BEFORE any exits this tick resolve: a cabinet vacated this
  // tick accepts nobody until the next (conservative, and it keeps the loop order-free).
  // Entries granted below set their bit immediately, so one tick can never double-book.
  let occupied = 0
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 1 && w.hiddenIn[s]! !== NO_SLOT) occupied |= 1 << w.hiddenIn[s]!
  }

  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue

    const inside = w.hiddenIn[s]!
    if (inside !== NO_SLOT) {
      const heldTicks = w.tick - w.hiddenSinceTick[s]!
      const wantsOut = inputs[s] !== 0 && heldTicks >= MIN_HIDE_TICKS
      const evicted = heldTicks >= MAX_HIDE_TICKS
      if (wantsOut || evicted) {
        w.x[s] = wardrobeExitX(w.map, inside)
        w.y[s] = wardrobeExitY(w.map, inside)
        w.vx[s] = 0
        w.vy[s] = 0
        w.hiddenIn[s] = NO_SLOT
        w.wardrobeCooldownUntil[s * MAX_WARDROBES + inside] = w.tick + COOLDOWN_TICKS
      }
      continue
    }

    // Entering: runners only, moving, and moving *toward* a keyed, ready wardrobe in reach.
    if (s === w.itSlot) continue
    if (s === w.turningSlot) continue // mid-metamorphosis: locked out
    if (w.tick < w.unconsciousUntilTick[s]!) continue // out cold on the floor
    const packed = inputs[s]!
    if (packed === 0) continue

    for (let i = 0; i < count; i++) {
      if ((occupied >> i) & 1) continue // one body per wardrobe, no exceptions
      if (w.keys[s * MAX_WARDROBES + i] === 0) continue
      if (w.tick < w.wardrobeCooldownUntil[s * MAX_WARDROBES + i]!) continue
      const dx = wardrobeCenterX(w.map, i) - w.x[s]!
      const dy = wardrobeCenterY(w.map, i) - w.y[s]!
      if (dx * dx + dy * dy > ENTER_SQ) continue
      // Walking toward it, not brushing past: input direction must point at the cabinet.
      const ix = INPUT_DIR_X[packed & 0x0f]!
      const iy = INPUT_DIR_Y[packed & 0x0f]!
      if (ix * dx + iy * dy <= 0) continue

      occupied |= 1 << i
      w.hiddenIn[s] = i
      w.hiddenSinceTick[s] = w.tick
      w.x[s] = wardrobeCenterX(w.map, i)
      w.y[s] = wardrobeCenterY(w.map, i)
      w.vx[s] = 0
      w.vy[s] = 0
      break
    }
  }
}
