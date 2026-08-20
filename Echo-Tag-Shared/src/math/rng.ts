/**
 * xorshift32. Deterministic, seedable, and fast enough to call in a tick.
 *
 * Why not `Math.random()`: spawn points, bot decisions and the last-place gag all
 * have to be reproducible so a client's prediction matches the server's authority,
 * and so a failing round can be replayed from its seed in a test.
 *
 * State is a single number held by the caller (the World), not module-level, so two
 * worlds in one process (server room + client prediction) can never share a stream.
 */

/** Advances `state` and returns the new state. Never returns 0. */
export const nextState = (state: number): number => {
  let s = state | 0
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  return s | 0 || 0x9e3779b9
}

/** Maps a state to a float in [0, 1). */
export const toFloat = (state: number): number => (state >>> 0) / 0x1_0000_0000

/** Maps a state to an integer in [0, n). */
export const toInt = (state: number, n: number): number => ((state >>> 0) % n) | 0

/** Mixes an arbitrary integer into a well-distributed non-zero seed. */
export const seedFrom = (n: number): number => {
  let s = (n | 0) + 0x9e3779b9
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad)
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97)
  s ^= s >>> 15
  return s | 0 || 0x9e3779b9
}
