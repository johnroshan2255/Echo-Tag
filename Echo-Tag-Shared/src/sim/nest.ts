import {
  MAX_PLAYERS,
  NEST_KILL_MS,
  NEST_KILL_R,
  NEST_LEASH,
  NEST_PENALTY_MS,
  NEST_RADIUS,
  NEST_RESPAWN_IMMUNITY_MS,
  NEST_REST_MS,
  NEST_RETURN_SPEED,
  NEST_SPEED,
  PLAYER_RADIUS,
  SPAWNS_PER_MAP,
  TICK_MS,
} from '../constants.ts'
import { tileCenterX, tileCenterY } from '../maps/index.ts'
import { NO_SLOT } from '../types.ts'
import type { World } from './world.ts'

/**
 * Nest spiders: the environmental hazard.
 *
 * Some maps author spider nests (see maps/index.ts). Each nest holds one spider with a
 * small state machine — LURK at home, LUNGE at a runner who enters its territory, drag
 * back and REST after a catch, RETURN home when the prey escapes the leash. Hold contact
 * for NEST_KILL_MS and it catches you: you respawn at the spawn point farthest from the
 * nest and NEST_PENALTY_MS lands straight on your It-time — the score is time, lower
 * wins, so a spider death is a real price.
 *
 * The It is ignored: monsters do not fear spiders. Deterministic, allocation-free.
 */

const KILL_TICKS = Math.ceil(NEST_KILL_MS / TICK_MS)
const REST_TICKS = Math.ceil(NEST_REST_MS / TICK_MS)
const IMMUNE_TICKS = Math.ceil(NEST_RESPAWN_IMMUNITY_MS / TICK_MS)
const RADIUS_SQ = NEST_RADIUS * NEST_RADIUS
const LEASH_SQ = NEST_LEASH * NEST_LEASH
const KILL_SQ = (NEST_KILL_R + PLAYER_RADIUS) ** 2
const DT = TICK_MS / 1000

export const NestState = { Lurk: 0, Lunge: 1, Return: 2, Rest: 3 } as const

/** Prey: live, visible, not the monster (or the monster-to-be), not freshly respawned. */
const huntable = (w: World, s: number): boolean =>
  w.active[s] === 1 &&
  s !== w.itSlot &&
  s !== w.turningSlot &&
  w.hiddenIn[s] === NO_SLOT &&
  w.tick >= w.immuneUntilTick[s]!

export const updateNests = (w: World): void => {
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
      // Anyone in the territory wakes the spider; nearest prey first.
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

    if (dx * dx + dy * dy <= KILL_SQ) {
      w.nestContact[n] = (w.nestContact[n]! + 1) & 0xff
      if (w.nestContact[n]! >= KILL_TICKS) {
        // CAUGHT. The price is paid in score-time, and the victim wakes far away.
        w.itTimeMs[t] = w.itTimeMs[t]! + NEST_PENALTY_MS
        let bestSpawn = 0
        let bestSq = -1
        for (let sp = 0; sp < SPAWNS_PER_MAP; sp++) {
          const sx = tileCenterX(w.map.spawns[sp * 2]!)
          const sy = tileCenterY(w.map.spawns[sp * 2 + 1]!)
          const ddx = sx - homeX
          const ddy = sy - homeY
          const d = ddx * ddx + ddy * ddy
          if (d > bestSq) {
            bestSq = d
            bestSpawn = sp
          }
        }
        w.x[t] = tileCenterX(w.map.spawns[bestSpawn * 2]!)
        w.y[t] = tileCenterY(w.map.spawns[bestSpawn * 2 + 1]!)
        w.vx[t] = 0
        w.vy[t] = 0
        w.immuneUntilTick[t] = w.tick + IMMUNE_TICKS
        w.events.hazardKill = t
        w.nestState[n] = NestState.Rest
        w.nestUntilTick[n] = w.tick + REST_TICKS
        w.nestTarget[n] = NO_SLOT
        w.nestContact[n] = 0
        w.nestX[n] = homeX
        w.nestY[n] = homeY
      }
    } else {
      w.nestContact[n] = 0
    }
  }
}
