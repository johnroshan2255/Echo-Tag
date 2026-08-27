import {
  ACCEL,
  FRICTION,
  GOO_SLOW_MULT,
  IT_SPEED_MULT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_MS,
  TURNING_SPEED_MULT,
} from '../constants.ts'
import { resolveWallCollisions } from '../math/collision.ts'
import { IDLE_INPUT, INPUT_DIR_X, INPUT_DIR_Y, INPUT_MAG } from './input.ts'
import type { World } from './world.ts'

const DT = TICK_MS / 1000

/**
 * Integrates one player for one tick: accelerate toward input, cap to their top speed,
 * move, resolve against echoes, then clamp to the arena.
 *
 * "It" gets IT_SPEED_MULT (1.12x). That number is deliberately small: the design wants
 * catching to be *possible*, not inevitable (GDD §3.2). A larger multiplier turns the
 * round into a chase the runner cannot win, which kills the "minimise It-time" scoring.
 *
 * Everything is kept in function locals and written back to the world exactly once, and
 * the input decode + arena clamp are inlined rather than called. Both are deliberate: a
 * `Float32Array` read produces a double, and handing that double across a call boundary
 * V8 chose not to inline boxes a HeapNumber. Split across small helpers this function
 * allocated ~45 bytes per tick; inlined it allocates nothing. See `math/collision.ts`.
 */
export const integratePlayer = (w: World, slot: number, packedInput: number): void => {
  const isIt = w.itSlot === slot
  // Mid-metamorphosis players stumble: enough motion to read as alive, not enough to flee.
  // Goo stacks multiplicatively on top of whatever you are: a slowed ghost is a slow ghost.
  const gooMult = w.tick < w.slowedUntilTick[slot]! ? GOO_SLOW_MULT : 1
  const maxSpeed =
    (slot === w.turningSlot
      ? PLAYER_SPEED * TURNING_SPEED_MULT
      : isIt
        ? PLAYER_SPEED * IT_SPEED_MULT
        : PLAYER_SPEED) * gooMult

  let vx = w.vx[slot]!
  let vy = w.vy[slot]!

  if (packedInput === IDLE_INPUT) {
    // Exponential decay rather than a linear stop: reads as momentum, not as ice.
    const decay = 1 - FRICTION * DT
    vx *= decay > 0 ? decay : 0
    vy *= decay > 0 ? decay : 0
  } else {
    const mag = INPUT_MAG[(packedInput >> 4) & 0x03]!
    const dir = packedInput & 0x0f
    const ax = INPUT_DIR_X[dir]! * mag
    const ay = INPUT_DIR_Y[dir]! * mag
    vx += ax * ACCEL * DT
    vy += ay * ACCEL * DT
    w.facing[slot] = Math.atan2(ay, ax)
  }

  const sp = Math.sqrt(vx * vx + vy * vy)
  if (sp > maxSpeed) {
    const k = maxSpeed / sp
    vx *= k
    vy *= k
  } else if (sp < 0.5) {
    vx = 0
    vy = 0
  }

  w.vx[slot] = vx
  w.vy[slot] = vy
  w.x[slot] = w.x[slot]! + vx * DT
  w.y[slot] = w.y[slot]! + vy * DT
  w.lastInput[slot] = packedInput

  // Echo trails are VISUAL ONLY (ADR 0012, owner decision): nobody collides with a ghost
  // image — the ghost hunts by *reading* trails, not by being walled by them. The old
  // resolver still exists one import away in math/collision.ts; re-enabling solidity (or
  // the trails-block-only-the-ghost variant) is a single call restored here.
  resolveWallCollisions(w, slot)

  // ── Arena clamp, inlined ──
  // Written straight into the typed arrays rather than via a local. Holding the position
  // in a `let` that is sometimes the float read back from the array and sometimes the
  // integer bound gives that local a mixed Smi/double representation, and V8 boxes a
  // HeapNumber on every write — worth ~45 bytes per tick on its own. Writing the bound
  // directly into the Float32Array keeps the whole clamp allocation-free.
  const r = PLAYER_RADIUS
  const maxX = w.arenaW - r
  const maxY = w.arenaH - r

  if (w.x[slot]! < r) {
    w.x[slot] = r
    if (w.vx[slot]! < 0) w.vx[slot] = 0
  } else if (w.x[slot]! > maxX) {
    w.x[slot] = maxX
    if (w.vx[slot]! > 0) w.vx[slot] = 0
  }

  if (w.y[slot]! < r) {
    w.y[slot] = r
    if (w.vy[slot]! < 0) w.vy[slot] = 0
  } else if (w.y[slot]! > maxY) {
    w.y[slot] = maxY
    if (w.vy[slot]! > 0) w.vy[slot] = 0
  }
}
