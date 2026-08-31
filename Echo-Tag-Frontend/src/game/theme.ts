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

// ── Transformation wreath ──
// The metamorphosis telegraph: a whirl of moonlit bats around the turning player,
// tightening as the ghost forms. Unlike the ambient bats this IS gameplay information,
// so it is bright enough to read on the bare dusk floor, not just inside the halo.
export const WREATH_COUNT = 10
export const WREATH_TINT = 0x9d82ea
export const WREATH_SIZE = 8
/** The turning player's halo: a cold violet, distinct from the ghost's lantern-white. */
export const TURN_GLOW_TINT = 0x7a4bd8

// ── Fireflies ──
export const FIREFLY_TINT = 0xffe9b0
export const FIREFLY_COUNT = 130
export const FIREFLY_SIZE = 3.2 // world units
export const FIREFLY_DRIFT = 26 // world units of wander amplitude

// ── Per-map worlds ───────────────────────────────────────────────────────────
// Each map is a WORLD now, not a palette swap: the manor keeps the dusk hedge look above,
// the forest grows grass and trees, the cave is stone and webs, the hive is metal and
// glow. One theme object carries every environmental colour + dressing knob; arena.ts and
// boot/minimap.ts read the same table so the preview stays a true screenshot of the map.
// Player colours, fog and the It marking are deliberately NOT per-theme: legibility rules.

/** How wall tiles are dressed. */
export const WallStyle = { Hedge: 0, Trees: 1, Stone: 2, Metal: 3 } as const
export type WallStyle = (typeof WallStyle)[keyof typeof WallStyle]

export interface MapTheme {
  floor: number
  floorSpeckle: number
  speckles: number
  floorCrack: number
  floorCrackLit: number
  floorCracks: number
  rubble: number
  rubbleDark: number
  wallFill: number
  wallRim: number
  wallTuft: number
  wallCrack: number
  wallCracks: number
  wallStyle: WallStyle
  /** Cobweb count for the corner pass (the cave is draped in them). */
  webs: number
  /** Erosion & crumbled corners suit organic walls; metal keeps clean seams instead. */
  eroded: boolean
  /** Forest floors sprout pixel grass blades and the odd flower. */
  grass: boolean
  /** Hive floors carry tile-grid panel seams. */
  panelSeams: boolean
  /** Cave walls carry pale strata lines. */
  strata: boolean
  /** Trunk wood for tree walls (unused by other styles). */
  trunk: number
  windowGlow: number
  lampHead: number
}

const MANOR: MapTheme = {
  floor: FLOOR,
  floorSpeckle: FLOOR_SPECKLE,
  speckles: SPECKLES_PER_MAP,
  floorCrack: FLOOR_CRACK,
  floorCrackLit: FLOOR_CRACK_LIT,
  floorCracks: FLOOR_CRACKS_PER_MAP,
  rubble: RUBBLE,
  rubbleDark: RUBBLE_DARK,
  wallFill: WALL_FILL,
  wallRim: WALL_RIM,
  wallTuft: WALL_TUFT,
  wallCrack: WALL_CRACK,
  wallCracks: WALL_CRACKS_PER_MAP,
  wallStyle: WallStyle.Hedge,
  webs: WEBS_PER_MAP,
  eroded: true,
  grass: false,
  panelSeams: false,
  strata: false,
  trunk: 0x4a3527,
  windowGlow: WINDOW_GLOW,
  lampHead: LAMP_HEAD,
}

const FOREST: MapTheme = {
  ...MANOR,
  floor: 0x223021, // dark meadow
  floorSpeckle: 0x35502f,
  floorCrack: 0x3a2f22, // dirt paths, not fissures
  floorCrackLit: 0x54432f,
  floorCracks: 18,
  rubble: 0x3f5c33, // leaf litter
  rubbleDark: 0x2b401f,
  wallFill: 0x1b2b18, // tree canopy
  wallRim: 0x517d3f,
  wallTuft: 0x2f4d26,
  wallCrack: 0x0d1a0b,
  wallStyle: WallStyle.Trees,
  webs: 6,
  grass: true,
}

const CAVE: MapTheme = {
  ...MANOR,
  floor: 0x2a2733, // worn stone
  floorSpeckle: 0x3a3647,
  floorCrack: 0x191622,
  floorCrackLit: 0x474156,
  floorCracks: 34,
  rubble: 0x45405a,
  rubbleDark: 0x2e2a3e,
  wallFill: 0x191527, // deep rock
  wallRim: 0x5b5470,
  wallTuft: 0x2b2640,
  wallCrack: 0x0c0a14,
  wallCracks: 44,
  wallStyle: WallStyle.Stone,
  webs: 46, // the spider's den is draped in silk
  strata: true,
  windowGlow: 0xbfe0ff, // pale cold light through the rock
}

const HIVE: MapTheme = {
  ...MANOR,
  floor: 0x1c2430, // brushed deck plate
  floorSpeckle: 0x27384a,
  speckles: 320, // metal carries flecks, not leaf litter
  floorCrack: 0x121822, // scored plating
  floorCrackLit: 0x33475c,
  floorCracks: 10,
  rubble: 0x31455c,
  rubbleDark: 0x1f2c3c,
  wallFill: 0x121a26,
  wallRim: 0x2fd4b8, // the glowing conduit trim
  wallTuft: 0x1c2f3d,
  wallCrack: 0x0a0f18,
  wallCracks: 8,
  wallStyle: WallStyle.Metal,
  webs: 0,
  eroded: false, // machines do not crumble; they seam
  panelSeams: true,
  windowGlow: 0x9fffe0, // teal viewports
  lampHead: 0xc8ffe8,
}

/** Indexed by map: manor, forest, cave, hive — matching MONSTER_BY_MAP. */
export const THEMES: readonly MapTheme[] = [MANOR, FOREST, CAVE, HIVE]

/** Portals read the same arcane violet on every world — a pad must be instantly known. */
export const PORTAL_COLOR = 0x9d82ea
export const PORTAL_CORE = 0xe6dcff
/** Nest spiders and their web carpets. */
export const NEST_WEB_COLOR = 0xcfc8e8
export const NEST_SPIDER_BODY = 0x241d33
export const NEST_SPIDER_EYE = 0xff5040

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
