import { TICK_MS } from '@echo-tag/shared/constants'

/**
 * Fixed-step accumulator.
 *
 * The simulation must advance in fixed 50ms steps — it is deterministic, and the server runs
 * it at exactly that rate — while the screen refreshes at whatever the display does. So:
 * accumulate real elapsed time, step the sim as many whole ticks as have come due, and hand
 * the renderer the leftover fraction to interpolate with. Without that fraction the avatars
 * visibly stutter at 20Hz on a 60Hz screen.
 *
 * `MAX_CATCHUP` bounds how much time a single frame may consume. When a tab is backgrounded
 * for thirty seconds, the naive version tries to simulate six hundred ticks in one frame and
 * locks the page up; this drops the backlog instead. In multiplayer the server is authority
 * anyway, so dropped local ticks are corrected by the next snapshot rather than being lost.
 */

const MAX_CATCHUP_TICKS = 5

export interface Ticker {
  accumulatorMs: number
  /** Fraction of the way to the next tick, in [0, 1). Interpolation weight. */
  alpha: number
  /** Ticks stepped since construction. */
  ticks: number
  /** Ticks discarded to catch-up clamping — a nonzero value means the client stalled. */
  dropped: number
}

export const createTicker = (): Ticker => ({ accumulatorMs: 0, alpha: 0, ticks: 0, dropped: 0 })

/**
 * Advances the clock and invokes `step` once per due tick. `step` is called with no
 * arguments and must not allocate — it is the simulation tick.
 */
export const advance = (ticker: Ticker, deltaMs: number, step: () => void): void => {
  ticker.accumulatorMs += deltaMs

  let due = (ticker.accumulatorMs / TICK_MS) | 0
  if (due > MAX_CATCHUP_TICKS) {
    ticker.dropped += due - MAX_CATCHUP_TICKS
    ticker.accumulatorMs -= (due - MAX_CATCHUP_TICKS) * TICK_MS
    due = MAX_CATCHUP_TICKS
  }

  for (let i = 0; i < due; i++) {
    step()
    ticker.accumulatorMs -= TICK_MS
    ticker.ticks++
  }

  ticker.alpha = ticker.accumulatorMs / TICK_MS
}
