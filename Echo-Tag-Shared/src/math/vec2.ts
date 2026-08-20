/**
 * Flat 2D helpers. Everything takes and returns numbers — no vector objects —
 * because the simulation must not allocate inside a tick.
 */

export const TAU = Math.PI * 2

export const len = (x: number, y: number): number => Math.sqrt(x * x + y * y)

export const dist = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  return Math.sqrt(dx * dx + dy * dy)
}

export const distSq = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/** Linear interpolation. `t` is not clamped. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Shortest signed angular delta from `a` to `b`, in (-PI, PI]. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  else if (d < -Math.PI) d += TAU
  return d
}
