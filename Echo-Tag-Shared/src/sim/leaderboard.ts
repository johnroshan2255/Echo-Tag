import { MAX_PLAYERS } from '../constants.ts'
import type { LeaderboardRow } from '../types.ts'
import type { World } from './world.ts'

/**
 * Ranks players by time spent as "It", least first (GDD §2).
 *
 * This is the one place in the sim allowed to allocate, because it runs once per round
 * on the Leaderboard transition — not in the tick path.
 *
 * Ties break by slot so client and server always render the same order.
 */
export const leaderboard = (w: World): LeaderboardRow[] => {
  const rows: LeaderboardRow[] = []
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    rows.push({
      slot: s,
      colorSlot: w.colorSlot[s]!,
      isBot: w.isBot[s] === 1,
      itTimeMs: w.itTimeMs[s]!,
      caught: w.timesCaught[s]!,
      rank: 0,
    })
  }
  // Least It-time wins; equal It-times break by who was caught less; then slot, for
  // determinism between client and server.
  rows.sort((a, b) => a.itTimeMs - b.itTimeMs || a.caught - b.caught || a.slot - b.slot)
  for (let i = 0; i < rows.length; i++) rows[i]!.rank = i + 1
  return rows
}
