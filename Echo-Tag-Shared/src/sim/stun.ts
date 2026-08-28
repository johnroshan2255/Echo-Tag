import {
  ECHO_GRACE_SAMPLES,
  KO_MIN_SPEED,
  MAX_PLAYERS,
  TICK_MS,
  UNCONSCIOUS_MS,
} from '../constants.ts'
import { CELL_SIZE, CONTACT_RADIUS } from '../math/spatial-hash.ts'
import { NO_SLOT } from '../types.ts'
import type { World } from './world.ts'

/**
 * Unconsciousness on trail contact.
 *
 * Trails are not walls (ADR 0012) — they are hazards, and only the GHOST has one (humans
 * leave no live trail; see rebuildEchoBodies). WALK into the ghost's breadcrumbs and you
 * faint for UNCONSCIOUS_MS: input dead, body collapsed, fully vulnerable to the ghost.
 * Recovery is automatic — no mashing.
 *
 * "Walk into" is enforced literally, with two guards that exist because the trail
 * MOVES (it replays the ghost's past):
 *   1. speed gate — you must be moving faster than KO_MIN_SPEED. A replay sweeping over a
 *      stationary player is not the player's mistake.
 *   2. edge transition — KO fires only when you gain overlap with an owner's trail you
 *      were NOT overlapping last tick (per-owner bitmask). Waking up inside a trail and
 *      walking out of it cannot re-stun you; only crossing back IN can.
 *
 * Note: The ghost is immune to their own trail.
 *
 * Exemptions: the turning player (already locked in their metamorphosis), the hidden
 * (inside a wardrobe, off the floor), and the already-unconscious.
 *
 * Allocation-free: the 3x3 spatial-hash walk is inlined with function locals, same
 * discipline (and same reason) as math/collision.ts.
 */

const CONTACT_SQ = CONTACT_RADIUS * CONTACT_RADIUS
const KO_TICKS = Math.ceil(UNCONSCIOUS_MS / TICK_MS)
const KO_SPEED_SQ = KO_MIN_SPEED * KO_MIN_SPEED

export const isUnconscious = (w: World, slot: number): boolean =>
  w.tick < w.unconsciousUntilTick[slot]!

export const updateTrailStuns = (w: World): void => {
  const hash = w.hash
  const cols = hash.cols
  const rows = hash.rows
  const cellStart = hash.cellStart
  const items = hash.items
  const bodyX = w.bodyX
  const bodyY = w.bodyY
  const bodyLive = w.bodyLive
  const bodyOwner = w.bodyOwner
  const bodyAge = w.bodyAge

  for (let p = 0; p < MAX_PLAYERS; p++) {
    if (w.active[p] === 0 || w.hiddenIn[p] !== NO_SLOT) {
      w.trailOverlap[p] = 0
      continue
    }

    const px = w.x[p]!
    const py = w.y[p]!

    // Current overlap mask, one bit per trail owner.
    let mask = 0
    const cx = (px / CELL_SIZE) | 0
    const cy = (py / CELL_SIZE) | 0
    const gx0 = cx > 0 ? cx - 1 : 0
    const gy0 = cy > 0 ? cy - 1 : 0
    const gx1 = cx < cols - 1 ? cx + 1 : cols - 1
    const gy1 = cy < rows - 1 ? cy + 1 : rows - 1

    for (let gy = gy0; gy <= gy1; gy++) {
      const rowBase = gy * cols
      for (let gx = gx0; gx <= gx1; gx++) {
        const cell = rowBase + gx
        const end = cellStart[cell + 1]!
        for (let i = cellStart[cell]!; i < end; i++) {
          const id = items[i]!
          if (bodyLive[id] === 0) continue
          const owner = bodyOwner[id]!
          if (owner === p) continue // Ghost is immune to their own trail
          const grace = ECHO_GRACE_SAMPLES
          if (bodyAge[id]! <= grace) continue
          const dx = px - bodyX[id]!
          const dy = py - bodyY[id]!
          if (dx * dx + dy * dy < CONTACT_SQ) mask |= 1 << owner
        }
      }
    }

    const entered = mask & ~w.trailOverlap[p]!
    w.trailOverlap[p] = mask

    if (entered === 0) continue
    if (w.tick < w.unconsciousUntilTick[p]!) continue
    if (p === w.turningSlot) continue // already locked in the metamorphosis
    const vx = w.vx[p]!
    const vy = w.vy[p]!
    if (vx * vx + vy * vy < KO_SPEED_SQ) continue // swept over, not walked into

    w.unconsciousUntilTick[p] = w.tick + KO_TICKS
    w.vx[p] = 0
    w.vy[p] = 0
  }
}
