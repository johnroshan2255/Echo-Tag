/**
 * Echo Tag — single source of truth for every tunable.
 * Imported by client, server and bots so prediction can never disagree with authority.
 * Anything here may be rebalanced; nothing here may be duplicated elsewhere.
 */

// ── Round ────────────────────────────────────────────────────────────────────
export const ROUND_DURATION_MS = 180_000 // 3 minutes (GDD §2)
export const COUNTDOWN_MS = 1_500 // "3..2..1" before inputs unlock
export const LEADERBOARD_MS = 8_000 // then auto-requeue
export const MAX_LOBBY_WAIT_MS = 2_000 // hard cap before bot-fill (Tech doc §7)

// ── Simulation ───────────────────────────────────────────────────────────────
export const TICK_HZ = 20 // authoritative steps per second
export const TICK_MS = 1000 / TICK_HZ // 50ms
export const SNAPSHOT_HZ = 20 // server -> client broadcast rate
export const INPUT_HZ = 20 // client -> server input rate
export const INTERP_DELAY_MS = 100 // remote players rendered this far behind

// ── World / maps ─────────────────────────────────────────────────────────────
// The arena is no longer a single screen-sized box. Rounds play on one of four fixed,
// authored maps — a world larger than the viewport that players walk *through*, with the
// camera following them (see docs/adr/0005-camera-follow-maps.md). All maps share one tile
// grid size so every buffer in the simulation stays fixed-allocation.
export const MAP_TILE = 80 // world units per tile; corridors are 2-3 tiles wide
export const MAP_TILES_X = 40
export const MAP_TILES_Y = 22
export const MAP_W = MAP_TILE * MAP_TILES_X // 3200
export const MAP_H = MAP_TILE * MAP_TILES_Y // 1760
export const MAP_COUNT = 4

/** Tile values in a map's `walls` array. Anything non-zero is solid. */
export const TILE_OPEN = 0
export const TILE_WALL = 1
export const TILE_FURNITURE = 2

// ── Doors ────────────────────────────────────────────────────────────────────
// Doors are gameplay, not set dressing: they open themselves as anyone approaches, so a
// door creaking beyond your vision is information — someone is moving there. They are part
// of the deterministic simulation (both sides of a chase interact with them), and they can
// never close on a player standing in the frame.
export const MAX_DOORS = 8
/** A door starts opening when any live player is within this range of its centre. */
export const DOOR_TRIGGER_R = 130
/** And begins closing only once nobody is within this (hysteresis, so it never flutters). */
export const DOOR_RELEASE_R = 190
/** Openness change per tick: fully open in ~0.4s, fully closed in ~0.9s. */
export const DOOR_OPEN_RATE = 0.125
export const DOOR_CLOSE_RATE = 0.055
/** A door blocks movement while openness is below this. */
export const DOOR_SOLID_BELOW = 0.5

// ── Wardrobes ────────────────────────────────────────────────────────────────
// Hiding spots. A runner holding the key to a wardrobe can slip inside to vanish —
// untaggable, invisible, but blind and deaf: they cannot tell whether the chaser has left
// the room, and stepping out next to a waiting "It" is exactly the catch it sounds like.
// "It" never has keys: predators do not hide.
export const MAX_WARDROBES = 8
/** Each player is dealt keys to about half the map's wardrobes at round start. */
export const WARDROBE_KEY_FRACTION = 0.5
/** Contact range to slip inside (from the wardrobe centre, moving toward it). */
export const WARDROBE_ENTER_R = 78
/** The same wardrobe refuses the same player for this long after use. Others are fine. */
export const WARDROBE_COOLDOWN_MS = 20_000
/** You cannot bolt back out for a moment — the door has to shut first. */
export const WARDROBE_MIN_HIDE_MS = 500
/** And it will not shelter anyone forever: the door swings open on its own. */
export const WARDROBE_MAX_HIDE_MS = 10_000

/**
 * The most world a player is ever shown, per axis. The camera zooms so the view never
 * exceeds this window — roughly a 2.5x2.2 screens' walk to cross a map — which is what
 * makes the world feel like a place rather than a diagram, and it is a fairness bound:
 * no device gets to see more of the maze than another.
 */
export const VIEW_MAX_W = 1280
export const VIEW_MAX_H = 820

// ── Players ──────────────────────────────────────────────────────────────────
export const MAX_PLAYERS = 12
export const MIN_PLAYERS = 8 // bots top up to at least this many
export const SPAWNS_PER_MAP = 12 // authored spawn tiles, one per possible player
export const PLAYER_RADIUS = 18
export const PLAYER_SPEED = 240 // units/sec
export const IT_SPEED_MULT = 1.12 // "slightly faster" (GDD §3.2)
export const ACCEL = 2200 // units/sec² — snappy but not instant
export const FRICTION = 14 // per second, applied when input is idle

// ── Tagging ──────────────────────────────────────────────────────────────────
export const TAG_RADIUS = PLAYER_RADIUS * 2 // touch = overlap
export const TAG_IMMUNITY_MS = 1_000 // new It cannot be re-tagged (GDD §3.2)
export const TAG_COOLDOWN_MS = 250 // old It cannot be re-tagged instantly either

// ── Echoes ───────────────────────────────────────────────────────────────────
export const ECHO_DELAY_MS = 3_000 // your ghost is you, 3s ago (GDD §3.1)
export const ECHO_SAMPLE_HZ = TICK_HZ // one sample per authoritative tick
/** 3s @ 20Hz = 60 samples. Ring buffer length per player, fixed allocation. */
export const ECHO_SAMPLES = (ECHO_DELAY_MS / 1000) * ECHO_SAMPLE_HZ
/** How many of those samples are rendered/collidable as bodies (every Nth sample). */
export const ECHO_STRIDE = 4 // every 4th sample becomes a solid body
/** 60 / 4 = 15 solid echo bodies per player -> 180 max in the arena. */
export const ECHO_BODIES_PER_PLAYER = ECHO_SAMPLES / ECHO_STRIDE
export const ECHO_RADIUS = PLAYER_RADIUS * 0.9 // slightly forgiving vs live bodies
export const ECHO_ALPHA = 0.3 // pastels need a touch more presence on the dusk floor than the old neons did
export const ECHO_GRACE_MS = 400 // your own freshest echoes don't collide with you
/** Grace expressed in ring samples, so the sim never divides in a tick. */
export const ECHO_GRACE_SAMPLES = Math.round((ECHO_GRACE_MS / 1000) * ECHO_SAMPLE_HZ)
/** Collision passes per tick. 2 is enough to resolve a corner without jitter. */
export const COLLISION_PASSES = 2
/** Fraction of tangential velocity kept when sliding along an echo. */
export const SLIDE_FRICTION = 0.92

// ── Rendering budget (Tech doc §3.2) ─────────────────────────────────────────
export const SQUARES_PER_PLAYER = 180 // within the 150–250 band
export const SQUARE_SIZE = 3 // simulation units per body square
export const ECHO_SQUARES = 16 // simplified silhouette only — coarse enough to read as a wall
/**
 * How wide an echo is *drawn*, relative to its collision diameter.
 *
 * Tuned by looking at 1:1 crops of a dense arena, not by arithmetic. At 1.35 the echo blocks
 * out-weighed the avatars and the arena inverted its own visual hierarchy — the obstacles
 * read as the subject and the players became hard to pick out, which is the exact failure
 * every past-self game warns about. 1.15 is the smallest value that still closes the gaps
 * between consecutive bodies at full speed.
 *
 * At full speed a player lays down echo bodies `PLAYER_SPEED * ECHO_STRIDE * TICK_MS` apart
 * — 48 world units — while an echo only blocks within `ECHO_RADIUS` (16.2) of its centre.
 * The trail is still solid to walk into (the midpoint between two bodies is inside both
 * contact circles) but drawn at true collision size it *looks* like a dotted line of
 * separate blobs, which tells the player they can slip through a gap that is not there.
 *
 * So echoes are drawn slightly larger than they collide. The direction matters: erring
 * generous means a player occasionally finds a gap where they expected a wall, which reads
 * as luck. Erring mean would mean being stopped by empty space, which reads as a bug.
 */
export const ECHO_VISUAL_SCALE = 1.15
/** 12*180 + 180*28 ≈ 7.2k particles, two ParticleContainers, ~2 draw calls. */

// ── Palette ──────────────────────────────────────────────────────────────────
// Revised with the cozy retheme (ADR 0006): the tech doc's harsh neon-on-charcoal read as
// clinical once the world became a place. Players are now warm pastels against a dusk-plum
// world — still one unmistakable hue per player (trail ownership is gameplay information),
// but soft enough to sit inside lantern light instead of cutting through it.
export const BG_COLOR = 0x161226 // dusk plum, the page void
export const PLAYER_COLORS = [
  0xff85ad, // rose
  0x7fd6e8, // sky
  0xa4dd85, // leaf
  0xffb46e, // apricot
  0xc79ef2, // lilac
  0xf6e28c, // butter
  0xf28d77, // coral
  0x83e2c4, // mint
  0x93aaf4, // periwinkle
  0xe392d5, // orchid
  0xbcdb90, // sage
  0xf2b4c6, // blush
] as const
export const IT_RING_COLOR = 0xfff3dc // warm lantern-white, not clinical white

// ── Input ────────────────────────────────────────────────────────────────────
export const JOYSTICK_BASE_PX = 110
export const JOYSTICK_KNOB_PX = 55
export const JOYSTICK_DEADZONE_PX = 10
export const SAFE_AREA_PX = 20 // clear of iOS home bar / Android back gesture

// ── Performance gates (enforced in CI, see tools/ci/size-check.mjs) ──────────
export const TARGET_FPS = 60
export const MIN_ACCEPTABLE_FPS = 30
export const BOOT_CHUNK_BUDGET_KB = 16 // brotli, must be interactive on its own
export const TOTAL_JS_BUDGET_KB = 260 // brotli, everything needed to play
