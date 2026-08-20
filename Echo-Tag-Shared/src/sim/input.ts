import { TAU } from '../math/vec2.ts'

/**
 * One player-tick of input, packed into a single byte.
 *
 *   bits 0-3  direction, 16 evenly spaced headings
 *   bits 4-5  magnitude bucket, 1..3 (analogue joystick pressure)
 *   0x00      idle — no input at all
 *
 * A byte is chosen over a float pair for three reasons: it makes the client->server
 * message trivially small, it makes the unacked-input ring buffer a plain Uint8Array,
 * and — most importantly — it removes any float-precision difference between the
 * client's predicted step and the server's authoritative one. Both sides decode the
 * exact same 48 possible vectors.
 */

export const IDLE_INPUT = 0

const DIRS = 16
const DIR_STEP = TAU / DIRS

/** Precomputed decode table: 16 headings x 3 magnitudes, built once at module load. */
const DIR_X = new Float32Array(DIRS)
const DIR_Y = new Float32Array(DIRS)
for (let i = 0; i < DIRS; i++) {
  DIR_X[i] = Math.cos(i * DIR_STEP)
  DIR_Y[i] = Math.sin(i * DIR_STEP)
}

const MAG = new Float32Array([0, 1 / 3, 2 / 3, 1])

/**
 * The decode tables, exported for the one caller that must not pay for a function call:
 * `integratePlayer` decodes inline so the resulting doubles stay in registers. Going
 * through `inputX`/`inputY` there boxed a HeapNumber per call — see the performance note
 * in `math/collision.ts`. Everyone else should use the accessors below.
 */
export const INPUT_DIR_X: Float32Array = DIR_X
export const INPUT_DIR_Y: Float32Array = DIR_Y
export const INPUT_MAG: Float32Array = MAG

/**
 * Packs a raw stick/keyboard vector. `deadzone` is in the same 0..1 space as the
 * input, so callers pass a normalised vector (keyboard) or a clamped stick offset.
 */
export const encodeInput = (dx: number, dy: number, deadzone = 0.12): number => {
  const mag = Math.sqrt(dx * dx + dy * dy)
  if (mag < deadzone) return IDLE_INPUT

  let dirIdx = Math.round(Math.atan2(dy, dx) / DIR_STEP) % DIRS
  if (dirIdx < 0) dirIdx += DIRS

  // Buckets: <0.5 -> 1, <0.85 -> 2, else 3. Keyboard always lands on 3.
  const bucket = mag < 0.5 ? 1 : mag < 0.85 ? 2 : 3
  return dirIdx | (bucket << 4)
}

export const isIdle = (packed: number): boolean => (packed & 0x30) === 0

/** Decoded x component of a packed input, already scaled by magnitude. */
export const inputX = (packed: number): number =>
  packed === IDLE_INPUT ? 0 : DIR_X[packed & 0x0f]! * MAG[(packed >> 4) & 0x03]!

/** Decoded y component of a packed input, already scaled by magnitude. */
export const inputY = (packed: number): number =>
  packed === IDLE_INPUT ? 0 : DIR_Y[packed & 0x0f]! * MAG[(packed >> 4) & 0x03]!

/** Heading in radians, or NaN when idle. Used for facing/eye direction. */
export const inputAngle = (packed: number): number =>
  packed === IDLE_INPUT ? Number.NaN : (packed & 0x0f) * DIR_STEP
