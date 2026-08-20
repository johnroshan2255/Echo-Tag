/** Slot index into the world's parallel arrays. `-1` means "nobody". */
export type Slot = number

export const NO_SLOT = -1

export const RoundPhase = {
  /** Waiting for players; bot-fill timer running. Inputs ignored. */
  Lobby: 0,
  /** "3..2..1" — everyone visible, inputs still locked. */
  Countdown: 1,
  /** The 3-minute round. */
  Playing: 2,
  /** Frozen world, tallies shown. */
  Leaderboard: 3,
} as const
export type RoundPhase = (typeof RoundPhase)[keyof typeof RoundPhase]

/** Bit flags packed into the snapshot's per-player `flags` byte. */
export const Flag = {
  Active: 1 << 0,
  IsIt: 1 << 1,
  Immune: 1 << 2,
  IsBot: 1 << 3,
} as const

export interface LeaderboardRow {
  slot: Slot
  colorSlot: number
  isBot: boolean
  /** Total milliseconds spent as "It". Lower is better. */
  itTimeMs: number
  /** 1-based, ties broken by slot for determinism. */
  rank: number
}

/** What a single tick produced, for the caller to react to. Reused, never reallocated. */
export interface StepEvents {
  /** Number of tags this tick (0 or 1 — one It means at most one transfer). */
  tagCount: number
  /** Who tagged, and who became It. Valid only when `tagCount > 0`. */
  tagFrom: Slot
  tagTo: Slot
  /** True on the tick the round clock ran out. */
  roundEnded: boolean
}
