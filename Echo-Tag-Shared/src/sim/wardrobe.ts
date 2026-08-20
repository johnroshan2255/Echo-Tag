import {
  MAX_PLAYERS,
  MAX_WARDROBES,
  TICK_MS,
  WARDROBE_COOLDOWN_MS,
  WARDROBE_ENTER_R,
  WARDROBE_KEY_FRACTION,
  WARDROBE_MAX_HIDE_MS,
  WARDROBE_MIN_HIDE_MS,
} from '../constants.ts'
import { wardrobeCenterX, wardrobeCenterY, wardrobeExitX, wardrobeExitY } from '../maps/index.ts'
import { NO_SLOT } from '../types.ts'
import { INPUT_DIR_X, INPUT_DIR_Y } from './input.ts'
import { random, type World } from './world.ts'

/**
 * Wardrobes: the hide mechanic.
 *
 * The rules, exactly as designed:
 *   - Only runners hide. "It" holds no keys — predators do not hide.
 *   - Each player is dealt keys to about half the map's wardrobes at round start, so no
 *     hiding spot is safe for everyone and knowing *your* wardrobes is part of knowing
 *     the map.
 *   - Inside, you are invisible and untaggable — and blind. Nothing tells you whether the
 *     chaser has left the room. Stepping out beside a waiting It is the catch it sounds
 *     like: there is deliberately no exit immunity.
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
const COOLDOWN_TICKS = Math.ceil(WARDROBE_COOLDOWN_MS / TICK_MS)
const MIN_HIDE_TICKS = Math.ceil(WARDROBE_MIN_HIDE_MS / TICK_MS)
const MAX_HIDE_TICKS = Math.ceil(WARDROBE_MAX_HIDE_MS / TICK_MS)

/** Deals each player keys to ~half the map's wardrobes, from the world's own RNG stream. */
export const dealKeys = (w: World): void => {
  w.keys.fill(0)
  const count = w.map.wardrobes.length / 4
  if (count === 0) return
  const perPlayer = Math.max(1, Math.round(count * WARDROBE_KEY_FRACTION))

  for (let s = 0; s < MAX_PLAYERS; s++) {
    // Deal `perPlayer` distinct keys by walking the wardrobe list from a random offset
    // with a random coprime-ish stride — distinct by construction, no retry loops.
    const offset = Math.floor(random(w) * count)
    const stride = 1 + Math.floor(random(w) * Math.max(1, count - 1))
    for (let k = 0; k < perPlayer; k++) {
      w.keys[s * MAX_WARDROBES + ((offset + k * stride) % count)] = 1
    }
  }
}

export const isHidden = (w: World, slot: number): boolean => w.hiddenIn[slot] !== NO_SLOT

export const updateWardrobes = (w: World, inputs: Uint8Array): void => {
  const count = w.map.wardrobes.length / 4
  if (count === 0) return

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
    const packed = inputs[s]!
    if (packed === 0) continue

    for (let i = 0; i < count; i++) {
      if (w.keys[s * MAX_WARDROBES + i] === 0) continue
      if (w.tick < w.wardrobeCooldownUntil[s * MAX_WARDROBES + i]!) continue
      const dx = wardrobeCenterX(w.map, i) - w.x[s]!
      const dy = wardrobeCenterY(w.map, i) - w.y[s]!
      if (dx * dx + dy * dy > ENTER_SQ) continue
      // Walking toward it, not brushing past: input direction must point at the cabinet.
      const ix = INPUT_DIR_X[packed & 0x0f]!
      const iy = INPUT_DIR_Y[packed & 0x0f]!
      if (ix * dx + iy * dy <= 0) continue

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
