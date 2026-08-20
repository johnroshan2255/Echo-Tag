import { MAX_PLAYERS, TAG_COOLDOWN_MS, TAG_IMMUNITY_MS, TAG_RADIUS, TICK_MS } from '../constants.ts'
import { NO_SLOT, type Slot } from '../types.ts'
import type { World } from './world.ts'

/**
 * Tag resolution.
 *
 * Only one player is "It", so at most one tag can happen per tick. When several
 * candidates overlap simultaneously we take the *closest* — deterministic, and it
 * matches what the player sees (you tagged the one you ran into).
 *
 * Two separate timers, doing different jobs:
 *  - `immuneUntilTick` on the new It: they cannot be tagged for TAG_IMMUNITY_MS, which
 *    is what stops the pair-of-players infinite tag-back loop (GDD §3.2).
 *  - `tagCooldownUntilTick` on the old It: they cannot *initiate* a tag for a moment,
 *    so the instant they stop being It they can't immediately re-take it by standing still.
 */

const TAG_RADIUS_SQ = TAG_RADIUS * TAG_RADIUS
const IMMUNITY_TICKS = Math.ceil(TAG_IMMUNITY_MS / TICK_MS)
const COOLDOWN_TICKS = Math.ceil(TAG_COOLDOWN_MS / TICK_MS)

export const isImmune = (w: World, slot: Slot): boolean => w.tick < w.immuneUntilTick[slot]!

/** Transfers "It" to `to`, applying all three timers. Safe to call with NO_SLOT. */
export const setIt = (w: World, to: Slot): void => {
  const from = w.itSlot
  w.itSlot = to
  if (to !== NO_SLOT) w.immuneUntilTick[to] = w.tick + IMMUNITY_TICKS
  if (from !== NO_SLOT && from !== to) {
    w.tagCooldownUntilTick[from] = w.tick + COOLDOWN_TICKS
    // No tag-backs: the pair overlap at the moment of transfer (bodies pass through),
    // so the previous It is off the new It's menu for the immunity window.
    w.tagBackSlot = from
    w.tagBackUntilTick = w.tick + IMMUNITY_TICKS
  }
}

/**
 * Finds and applies at most one tag. Records the result in `w.events`.
 * Returns true when "It" changed hands.
 */
export const resolveTags = (w: World): boolean => {
  const it = w.itSlot
  if (it === NO_SLOT || w.active[it] === 0) return false
  if (w.tick < w.tagCooldownUntilTick[it]!) return false

  const ix = w.x[it]!
  const iy = w.y[it]!

  let best = NO_SLOT
  let bestSq = TAG_RADIUS_SQ

  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (s === it || w.active[s] === 0) continue
    if (w.hiddenIn[s] !== NO_SLOT) continue // inside a wardrobe: unseen, untouchable
    if (w.tick < w.immuneUntilTick[s]!) continue
    if (s === w.tagBackSlot && w.tick < w.tagBackUntilTick) continue // no tag-backs

    const dx = w.x[s]! - ix
    const dy = w.y[s]! - iy
    const dSq = dx * dx + dy * dy
    if (dSq < bestSq) {
      bestSq = dSq
      best = s
    }
  }

  if (best === NO_SLOT) return false

  setIt(w, best)
  w.events.tagCount++
  w.events.tagFrom = it
  w.events.tagTo = best
  return true
}
