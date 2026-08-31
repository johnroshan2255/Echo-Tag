import { MAX_PLAYERS, TAG_COOLDOWN_MS, TAG_IMMUNITY_MS, TAG_RADIUS, TICK_MS, TRANSFORM_DELAY_MS } from '../constants.ts'
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
const TRANSFORM_TICKS = Math.ceil(TRANSFORM_DELAY_MS / TICK_MS)

export const isImmune = (w: World, slot: Slot): boolean => w.tick < w.immuneUntilTick[slot]!

/** Transfers "It" to `to`, applying all three timers. Safe to call with NO_SLOT. */
export const setIt = (w: World, to: Slot): void => {
  const from = w.itSlot
  w.itSlot = to
  if (to !== NO_SLOT) {
    w.immuneUntilTick[to] = w.tick + IMMUNITY_TICKS
    // The trail is a property of BEING the ghost: it starts empty at crowning and grows
    // over the next 3s (rebuildEchoBodies admits only samples from itSinceTick on). The
    // new ghost's pre-crowning past never becomes a hazard — humans get the lull plus
    // this ramp as their head start.
    w.itSinceTick = w.tick
    // The ability comes with the crown: fresh monster, fresh cooldown clock — and any
    // beam the PREVIOUS monster left mid-charge dies with the handover, or it would
    // fire from the new monster's position at the old angle.
    w.abilityReadyTick = w.tick
    w.abilityQueued[to] = 0
    w.beamPhase = 0
  }
  if (from !== NO_SLOT && from !== to) {
    w.tagCooldownUntilTick[from] = w.tick + COOLDOWN_TICKS
    // No tag-backs: the pair overlap at the moment of transfer (bodies pass through),
    // so the previous It is off the new It's menu for the immunity window.
    w.tagBackSlot = from
    w.tagBackUntilTick = w.tick + IMMUNITY_TICKS
  }
}

/**
 * The transformation (owner spec, mechanic 1). A tag frees the old ghost IMMEDIATELY —
 * normal speed, free to run and hide — and puts the touched player into a 5-second
 * metamorphosis: stumbling at 10% speed, wreathed in the bat animation, untaggable,
 * accruing no It-time. While anyone is turning, `itSlot` is NO_SLOT: nobody hunts, and the
 * whole room gets the pacing lull. Activation grants the standard 1s immunity via setIt.
 */
export const enterTurning = (w: World, slot: Slot): void => {
  const from = w.itSlot
  w.itSlot = NO_SLOT // the old ghost is a person again, this very tick
  w.turningSlot = slot
  w.turningUntilTick = w.tick + TRANSFORM_TICKS
  if (w.timesCaught[slot]! < 255) w.timesCaught[slot]!++ // the score tie-breaker
  if (from !== NO_SLOT) {
    w.tagCooldownUntilTick[from] = w.tick + COOLDOWN_TICKS
    // No tag-backs, armed through the WHOLE metamorphosis plus the immunity window: the
    // pair often stand overlapped at the moment of touch, and without this the freshly
    // activated ghost converts its tagger straight back and the roles ping-pong forever.
    w.tagBackSlot = from
    w.tagBackUntilTick = w.tick + TRANSFORM_TICKS + IMMUNITY_TICKS
  }
}

/** Completes a metamorphosis whose timer has run out: the turning player becomes the ghost. */
export const updateTurning = (w: World): void => {
  if (w.turningSlot === NO_SLOT) return
  if (w.active[w.turningSlot] === 0) {
    w.turningSlot = NO_SLOT
    return
  }
  if (w.tick < w.turningUntilTick) return
  const slot = w.turningSlot
  w.turningSlot = NO_SLOT
  setIt(w, slot) // immunity applies from the moment they are the ghost, per spec
}

/**
 * Finds and applies at most one tag. Records the result in `w.events`.
 * Returns true when a metamorphosis began.
 */
export const resolveTags = (w: World): boolean => {
  const it = w.itSlot
  if (it === NO_SLOT || w.active[it] === 0) return false
  if (w.tick < w.tagCooldownUntilTick[it]!) return false
  if (w.tick < w.unconsciousUntilTick[it]!) return false // a fainted ghost tags nobody

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

  enterTurning(w, best)
  w.events.tagCount++
  w.events.tagFrom = it
  w.events.tagTo = best
  return true
}
