import {
  MAX_PLAYERS,
  NEST_CARRY_SPEED,
  NEST_ESCAPE_IMMUNITY_MS,
  NEST_GRAB_MS,
  NEST_GRAB_R,
  NEST_HOLD_MS,
  NEST_LEASH,
  NEST_RADIUS,
  NEST_REST_MS,
  NEST_RETURN_SPEED,
  NEST_SPEED,
  PLAYER_RADIUS,
  TICK_MS,
} from '../constants.ts'
import { tileCenterX, tileCenterY } from '../maps/index.ts'
import { isIdle } from './input.ts'
import { NO_SLOT } from '../types.ts'
import type { World } from './world.ts'

/**
 * Lair grabbers: the environmental hazard — nest spiders on the manor and forest maps,
 * abduction UFOs over the hive.
 *
 * Each authored lair holds one grabber with a small state machine: LURK at home, LUNGE
 * at a runner who enters its territory, and on contact GRAB them — a HOLD, not a kill.
 * A held player's input is dead and they are dragged slowly toward the lair, in the
 * open, while the monster closes in. Three ways out:
 *
 *   - STRUGGLE: the hold breaks on its own after NEST_HOLD_MS, and every tick the victim
 *     mashes a movement input counts double — fighting halves the sentence. Escape grants
 *     a short immunity so the grabber cannot chain-grab.
 *   - THE MONSTER ARRIVES: a held player is fully taggable. The moment they start
 *     turning (or become the It), the grabber releases — it wants prey, not a peer.
 *   - The victim disconnects; the grabber goes home.
 *
 * One victim at a time per grabber, and a player held by one lair is invisible to the
 * others. The It is ignored entirely. No score is charged — being pinned in the open
 * while something hunts you IS the price. Deterministic, allocation-free.
 */

const GRAB_TICKS = Math.ceil(NEST_GRAB_MS / TICK_MS)
const HOLD_TICKS = Math.ceil(NEST_HOLD_MS / TICK_MS)
const REST_TICKS = Math.ceil(NEST_REST_MS / TICK_MS)
const ESCAPE_IMMUNE_TICKS = Math.ceil(NEST_ESCAPE_IMMUNITY_MS / TICK_MS)
const RADIUS_SQ = NEST_RADIUS * NEST_RADIUS
const LEASH_SQ = NEST_LEASH * NEST_LEASH
const GRAB_SQ = (NEST_GRAB_R + PLAYER_RADIUS) ** 2
const DT = TICK_MS / 1000

export const NestState = { Lurk: 0, Lunge: 1, Return: 2, Rest: 3, Hold: 4 } as const

/** Prey: live, visible, not the monster (nor the monster-to-be), not immune, not held. */
const huntable = (w: World, s: number): boolean =>
  w.active[s] === 1 &&
  s !== w.itSlot &&
  s !== w.turningSlot &&
  w.hiddenIn[s] === NO_SLOT &&
  w.tick >= w.immuneUntilTick[s]! &&
  w.heldByNest[s] === NO_SLOT

export const updateNests = (w: World, inputs: Uint8Array): void => {
  const nests = w.map.nests
  const count = nests.length / 2

  for (let n = 0; n < count; n++) {
    const homeX = tileCenterX(nests[n * 2]!)
    const homeY = tileCenterY(nests[n * 2 + 1]!)
    const state = w.nestState[n]!

    if (state === NestState.Rest) {
      if (w.tick >= w.nestUntilTick[n]!) w.nestState[n] = NestState.Lurk
      continue
    }

    if (state === NestState.Lurk) {
      // Anyone in the territory wakes the grabber; nearest prey first.
      let best = NO_SLOT
      let bestSq = RADIUS_SQ
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (!huntable(w, s)) continue
        const dx = w.x[s]! - homeX
        const dy = w.y[s]! - homeY
        const d = dx * dx + dy * dy
        if (d < bestSq) {
          bestSq = d
          best = s
        }
      }
      if (best !== NO_SLOT) {
        w.nestState[n] = NestState.Lunge
        w.nestTarget[n] = best
        w.nestContact[n] = 0
      }
      continue
    }

    if (state === NestState.Return) {
      const dx = homeX - w.nestX[n]!
      const dy = homeY - w.nestY[n]!
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 6) {
        w.nestX[n] = homeX
        w.nestY[n] = homeY
        w.nestState[n] = NestState.Lurk
      } else {
        const step = Math.min(dist, NEST_RETURN_SPEED * DT)
        w.nestX[n] = w.nestX[n]! + (dx / dist) * step
        w.nestY[n] = w.nestY[n]! + (dy / dist) * step
      }
      continue
    }

    if (state === NestState.Hold) {
      const t = w.nestTarget[n]!
      // The grip breaks when the victim is gone — or when they became the monster: the
      // grabber wanted prey, and what it is holding now hunts back.
      if (t === NO_SLOT || w.active[t] === 0 || t === w.itSlot || t === w.turningSlot) {
        if (t !== NO_SLOT && w.active[t] === 1) w.heldByNest[t] = NO_SLOT
        w.nestState[n] = NestState.Return
        w.nestTarget[n] = NO_SLOT
        continue
      }
      // Struggling counts double: each tick of live movement input shortens the hold by
      // one extra tick, so a fighter is out in half the time.
      if (!isIdle(inputs[t] ?? 0)) w.nestUntilTick[n] = w.nestUntilTick[n]! - 1
      // Carried toward the lair, slowly, in the open — the monster knows where to look.
      const dx = homeX - w.nestX[n]!
      const dy = homeY - w.nestY[n]!
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > 4) {
        const step = Math.min(dist, NEST_CARRY_SPEED * DT)
        w.nestX[n] = w.nestX[n]! + (dx / dist) * step
        w.nestY[n] = w.nestY[n]! + (dy / dist) * step
      }
      w.x[t] = w.nestX[n]!
      w.y[t] = w.nestY[n]!
      w.vx[t] = 0
      w.vy[t] = 0
      if (w.tick >= w.nestUntilTick[n]!) {
        // Torn free: a breath of immunity so it cannot chain-grab, and the grabber sulks.
        w.heldByNest[t] = NO_SLOT
        w.immuneUntilTick[t] = w.tick + ESCAPE_IMMUNE_TICKS
        w.nestState[n] = NestState.Rest
        w.nestUntilTick[n] = w.tick + REST_TICKS
        w.nestTarget[n] = NO_SLOT
      }
      continue
    }

    // ── Lunge ──
    const t = w.nestTarget[n]!
    const targetGone = t === NO_SLOT || !huntable(w, t)
    const leashDx = targetGone ? 0 : w.x[t]! - homeX
    const leashDy = targetGone ? 0 : w.y[t]! - homeY
    if (targetGone || leashDx * leashDx + leashDy * leashDy > LEASH_SQ) {
      w.nestState[n] = NestState.Return
      w.nestTarget[n] = NO_SLOT
      w.nestContact[n] = 0
      continue
    }

    const dx = w.x[t]! - w.nestX[n]!
    const dy = w.y[t]! - w.nestY[n]!
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > 1) {
      const step = Math.min(dist, NEST_SPEED * DT)
      w.nestX[n] = w.nestX[n]! + (dx / dist) * step
      w.nestY[n] = w.nestY[n]! + (dy / dist) * step
    }

    if (dx * dx + dy * dy <= GRAB_SQ) {
      w.nestContact[n] = (w.nestContact[n]! + 1) & 0xff
      if (w.nestContact[n]! >= GRAB_TICKS) {
        // CAUGHT — held, not killed. The clock to freedom starts now.
        w.heldByNest[t] = n
        w.nestState[n] = NestState.Hold
        w.nestUntilTick[n] = w.tick + HOLD_TICKS
        w.nestContact[n] = 0
        w.vx[t] = 0
        w.vy[t] = 0
        w.events.hazardCaught = t
      }
    } else {
      w.nestContact[n] = 0
    }
  }
}
