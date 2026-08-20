/**
 * The six easing curves the game actually uses.
 *
 * This file is why `gsap` is not a dependency — it was in the original tech stack for
 * leaderboard tweening, at ~70KB brotli for what fits in thirty lines. See
 * docs/adr/0003-drop-gsap-and-nipplejs.md.
 *
 * All take and return normalised `t` in [0, 1] and allocate nothing.
 */

export const linear = (t: number): number => t

export const easeOutQuad = (t: number): number => t * (2 - t)

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2

/** Overshoots past 1 then settles — for squares snapping back into formation. */
export const easeOutBack = (t: number): number => {
  const c = 1.70158
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2
}

/** Decaying bounce, for the tagged scatter recovering. */
export const easeOutElastic = (t: number): number => {
  if (t === 0 || t === 1) return t
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

/** Frame-rate independent exponential approach. `rate` is per second. */
export const approach = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt))
