import { MAX_PLAYERS, NEST_RADIUS, SPAWNS_PER_MAP } from '../constants.ts'
import { tileCenterX, tileCenterY } from '../maps/index.ts'
import { encodeInput } from '../sim/input.ts'
import type { World } from '../sim/world.ts'

/**
 * The synthetic driver — NOT the Phase 6 bot.
 *
 * This exists so the renderer and the benchmark can run a full-density arena before real AI
 * exists, and so both use the *same* placeholder rather than two drifting copies. It knows
 * nothing about echoes and does not pathfind; it gives each slot a spawn-tile waypoint that
 * rotates on a fixed cadence, steers straight at it, and turns when stuck against a wall.
 * That is enough to produce map-wide movement, wall grinding, a dense self-crossing ghost
 * trail and regular tags — the load profile that matters — while being trivially deterministic.
 *
 * Phase 6 replaces this with `bot.ts` proper: seek/flee against It, echo avoidance via a
 * raycast fan, capped reaction time. The signature is the contract: bots are input bytes.
 *
 * Allocation-free; per-slot state lives in caller-owned typed arrays.
 */
export interface DriverState {
  /** Last tick's position, for stuck detection. */
  lastX: Float32Array
  lastY: Float32Array
  /** Current escape heading while stuck, in radians; NaN when not escaping. */
  escape: Float32Array
}

export const createDriverState = (): DriverState => ({
  lastX: new Float32Array(MAX_PLAYERS),
  lastY: new Float32Array(MAX_PLAYERS),
  escape: new Float32Array(MAX_PLAYERS).fill(Number.NaN),
})

/**
 * Writes an input byte for every active slot except `skip` (the human, if any).
 * Deterministic in (world state, tick).
 */
export const syntheticDriver = (
  w: World,
  inputs: Uint8Array,
  tick: number,
  state: DriverState,
  skip = -1,
): void => {
  const spawns = w.map.spawns

  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (s === skip || w.active[s] === 0) continue

    const px = w.x[s]!
    const py = w.y[s]!

    // Waypoint: a spawn tile, rotating every ~4.5s with a per-slot stagger so twelve
    // drivers never converge on one tile in lockstep.
    const wp = ((s * 5 + ((tick / 90) | 0)) % SPAWNS_PER_MAP) * 2
    const twx = tileCenterX(spawns[wp]!)
    const twy = tileCenterY(spawns[wp + 1]!)

    let dx = twx - px
    let dy = twy - py

    // Stuck against a wall or an echo: pick a deterministic sideways escape heading and
    // hold it for a while instead of grinding.
    const moved = Math.abs(px - state.lastX[s]!) + Math.abs(py - state.lastY[s]!)
    if (moved < 1.2 && tick % 8 === 0) {
      state.escape[s] = Math.atan2(dy, dx) + ((s + ((tick / 8) | 0)) % 2 === 0 ? 1.9 : -1.9)
    } else if (moved > 4) {
      state.escape[s] = Number.NaN
    }
    if (!Number.isNaN(state.escape[s]!)) {
      dx = Math.cos(state.escape[s]!)
      dy = Math.sin(state.escape[s]!)
    }

    // Nest spiders eat careless bots: a repulsion field around every nest, strong enough
    // that a wandering bot skirts the web ring instead of blundering into it. The It
    // ignores it (spiders ignore the It right back).
    if (s !== w.itSlot) {
      const nests = w.map.nests
      const AVOID = NEST_RADIUS + 90
      for (let n = 0; n < nests.length; n += 2) {
        const nx = px - tileCenterX(nests[n]!)
        const ny = py - tileCenterY(nests[n + 1]!)
        const d = Math.sqrt(nx * nx + ny * ny)
        if (d > AVOID || d < 1) continue
        const push = ((AVOID - d) / AVOID) * 3
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        dx = dx / len + (nx / d) * push
        dy = dy / len + (ny / d) * push
      }
    }

    state.lastX[s] = px
    state.lastY[s] = py

    const len = Math.sqrt(dx * dx + dy * dy)
    inputs[s] = len < 1 ? 0 : encodeInput(dx / len, dy / len)
  }
}

export { createDriverState as createSyntheticDriverState }
