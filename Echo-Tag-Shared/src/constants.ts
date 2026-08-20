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

// ── Arena ────────────────────────────────────────────────────────────────────
/** Base play area in simulation units. Rendered letterboxed to 16:9. */
export const ARENA_BASE_W = 1600
export const ARENA_BASE_H = 900
/** Area scales with headcount so echo density per player stays constant (GDD §6). */
export const ARENA_AREA_PER_PLAYER = (ARENA_BASE_W * ARENA_BASE_H) / 12

// ── Players ──────────────────────────────────────────────────────────────────
export const MAX_PLAYERS = 12
export const MIN_PLAYERS = 8 // bots top up to at least this many
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
export const ECHO_ALPHA = 0.26 // Tech doc §2 says 30-40%; measured lower, see below
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

// ── Palette (Tech doc §2) ────────────────────────────────────────────────────
export const BG_COLOR = 0x12141c
export const PLAYER_COLORS = [
  0xff2e88, // hot pink
  0x38e8ff, // cyan
  0x7dff3a, // lime
  0xff9a1f, // orange
  0xb15cff, // purple
  0xffe93a, // yellow
  0xff4d4d, // red
  0x1fffc4, // teal
  0x5c8cff, // periwinkle
  0xff6ad5, // magenta
  0x9dff8c, // mint
  0xffb3b3, // salmon
] as const
export const IT_RING_COLOR = 0xffffff

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
