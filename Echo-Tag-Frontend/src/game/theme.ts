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

// ── Furniture & props ──
export const WOOD_FILL = 0x4a3527
export const WOOD_GRAIN = 0x5d4433 // plank lines and top highlights
export const WOOD_DARK = 0x33241a
export const RUG_FILL = 0x59303f // worn wine-red carpet
export const RUG_BORDER = 0x7a4457
export const PLANT_POT = 0x54382a
export const PLANT_LEAF = 0x41684a
export const LAMP_POST = 0x3b3050
export const LAMP_HEAD = 0xffd9a3
/** Standing lamps cast their own small pool, so rooms glow faintly through the fog. */
export const LAMP_LIGHT_RADIUS = 190
export const LAMP_LIGHT_ALPHA = 0.15
export const MAX_LAMPS = 12

// ── Wardrobes & windows ──
export const WARDROBE_FILL = 0x3c2b1e // darker timber than tables — a tall cabinet
export const WARDROBE_PANEL = 0x51392a
export const WARDROBE_HANDLE = 0xc9a05a
/** Keyhole marker over wardrobes the local player can use right now. */
export const KEY_MARKER = 0xffd9a3
export const WINDOW_GLOW = 0xffe3ad
export const WINDOW_FRAME = 0x2a2337
/** How tightly the fog closes while you are inside a wardrobe: you see the door, no more. */
export const HIDDEN_VISION_SCALE = 0.22

// ── Doors ──
export const DOOR_FILL = 0x6b4a2f // warm timber, clearly not hedge and not floor
export const DOOR_EDGE = 0x8a6440
export const DOOR_THICKNESS = 20 // world units

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

// ── Decay ──
// The maze is old and broken: cracked floors, eroded wall edges, rubble where corners have
// crumbled. All of it is drawing — collision stays on the clean tile grid, and the visual
// erosion never reaches deeper than ~8 world units into a walkway (PLAYER_RADIUS is 18, so
// nothing ever looks passable that is not, or blocked that is not).
export const FLOOR_CRACK = 0x17131f
export const FLOOR_CRACK_LIT = 0x3d3552 // a faint catch-light along one lip of the crack
export const WALL_CRACK = 0x0a1410
export const RUBBLE = 0x37304a
export const RUBBLE_DARK = 0x241f33
export const FLOOR_CRACKS_PER_MAP = 26
export const WALL_CRACKS_PER_MAP = 30

// ── Horror dressing ──
// The Koira register: cuteness against the unknown dark. Webs and spiders make the maze
// feel long-abandoned; bats make the dark feel inhabited. None of it touches gameplay.
export const WEB_COLOR = 0xa9a1c6
export const WEB_ALPHA = 0.22
export const WEBS_PER_MAP = 20
export const SPIDER_COUNT = 10
export const SPIDER_TINT = 0x0d0a16 // a shadow that moves
export const SPIDER_SIZE = 5.5
export const BAT_COUNT = 6
export const BAT_TINT = 0x171126
export const BAT_SIZE = 9
/** Seconds between bat flocks (min..max). */
export const BAT_LULL_MIN = 16
export const BAT_LULL_MAX = 36

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
