import { PLAYER_SPEED } from '@echo-tag/shared/constants'

/**
 * Procedural animation, as scalar functions.
 *
 * The avatars have no animation frames — they are square clusters transformed per frame.
 * Everything here returns a *number*, never an object, so the renderer can apply offsets
 * without allocating inside the frame loop. That constraint is not academic: the same class
 * of mistake cost ~175 bytes a tick in the simulation (see math/collision.ts).
 *
 * Amplitudes are in grid cells, so they scale with the avatar automatically.
 */

/** Idle: a slow vertical bob so a standing player never looks frozen. */
export const idleBob = (timeMs: number, phase: number): number =>
  Math.sin(timeMs * 0.0028 + phase) * 0.22

/**
 * Walk cycle: legs swing in opposite phase. Returns the vertical lift for one leg;
 * `side` is +1 or -1 to put the two legs half a cycle apart.
 */
export const legLift = (distance: number, side: number): number => {
  const phase = distance * 0.055
  const s = Math.sin(phase + (side > 0 ? 0 : Math.PI))
  return s > 0 ? -s * 0.9 : 0 // only lift, never sink through the floor
}

/** Arms counter-swing against the legs — cheap, and it sells the walk. */
export const armSwing = (distance: number, side: number): number =>
  Math.sin(distance * 0.055 + (side > 0 ? Math.PI : 0)) * 0.45

/**
 * Squash and stretch along the direction of travel. Returns a multiplier pair via two
 * calls rather than a tuple, to stay allocation-free.
 */
export const stretchAlong = (speed: number): number => 1 + (speed / PLAYER_SPEED) * 0.12
export const squashAcross = (speed: number): number => 1 - (speed / PLAYER_SPEED) * 0.09

/** Eyes shift toward the heading, so the avatar looks where it is going. */
export const eyeShift = (facing: number, axis: 0 | 1): number =>
  (axis === 0 ? Math.cos(facing) : Math.sin(facing)) * 0.55

/**
 * Blink: eyes shrink briefly on a per-player irregular schedule. Returns a scale
 * multiplier. The 3.7s period is deliberately not a round number so twelve avatars never
 * blink in unison.
 */
export const blink = (timeMs: number, phase: number): number => {
  const t = ((timeMs * 0.001 + phase * 3.7) % 3.7) / 3.7
  return t > 0.97 ? 0.15 : 1
}

/**
 * Tagged scatter: squares fly outward and snap back. Returns the outward displacement in
 * grid cells for a cell at normalised radius `r`, `age` seconds since the tag.
 */
export const scatter = (age: number, r: number): number => {
  const DURATION = 0.42
  if (age < 0 || age > DURATION) return 0
  const t = age / DURATION
  // Out fast, back slower — an impulse, not a wobble.
  const envelope = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75
  return envelope * envelope * r * 3.4
}
