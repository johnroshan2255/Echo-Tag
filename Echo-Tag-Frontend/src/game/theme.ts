/**
 * The cozy dusk theme (ADR 0006).
 *
 * One file owns every environmental colour and atmosphere number, because a mood is a set
 * of decisions that only work *together* — a warmer floor with a colder fog is not a tweak,
 * it is a different (worse) theme. Player colours stay in shared constants: they are
 * gameplay data (trail ownership, leaderboard), not set dressing.
 *
 * Direction: a hedge-maze at dusk. The ground is dark plum-violet, walls read as clipped
 * pine hedges, the world past your lantern falls off into fog, and fireflies drift in the
 * open spaces. The chase stays legible because the actors are the brightest, warmest things
 * in view — coziness comes from the world, never at the price of reading the game.
 */

// ── Ground ──
export const FLOOR = 0x262038
export const FLOOR_SPECKLE = 0x342c4c // pebbles/leaf-litter, barely lighter than the floor
export const SPECKLES_PER_MAP = 900

// ── Walls: the hedges ──
export const WALL_FILL = 0x14231d // dark pine
export const WALL_RIM = 0x4a6b52 // moss where the hedge meets walkable ground
export const WALL_TUFT = 0x243b2e // leafy interior clumps that break up the flat fill

// ── Fog of war ──
/** Fully clear within this many world units of you. Roughly half a room. */
export const VISION_CLEAR = 280
/** Fully fogged beyond this. Roughly one room — the ask, verbatim. */
export const VISION_MAX = 520
/** Fog is dusk, not blackness: distant things dim and warm out, they don't vanish into void. */
export const FOG_COLOR: [number, number, number] = [15, 11, 26]
export const FOG_MAX_ALPHA = 0.97

// ── Lantern ──
export const LANTERN_TINT = 0xffd9a3
export const LANTERN_RADIUS = 420 // world units; slightly larger than VISION_CLEAR so light feathers into fog
export const LANTERN_ALPHA = 0.16

// ── Fireflies ──
export const FIREFLY_TINT = 0xffe9b0
export const FIREFLY_COUNT = 130
export const FIREFLY_SIZE = 3.2 // world units
export const FIREFLY_DRIFT = 26 // world units of wander amplitude

/**
 * Tiny deterministic PRNG for cosmetic scatter (speckles, fireflies), seeded per map so a
 * map always dresses itself the same way. Client-only — nothing gameplay-relevant may use
 * this, which is why it lives here and not in the shared package.
 */
export const cosmeticRng = (seed: number): (() => number) => {
  let s = (seed | 0) + 0x6d2b79f5
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1)
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61)
    return ((s ^ (s >>> 14)) >>> 0) / 0x1_0000_0000
  }
}
