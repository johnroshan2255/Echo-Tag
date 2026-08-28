import { MapSchema, schema } from '@colyseus/schema'

/**
 * Cold state, synced via Colyseus Schema: everything the lobby and leaderboard UI needs,
 * none of what changes 20 times a second. Hot state (positions, doors, hiding) rides the
 * hand-packed binary snapshot instead — see shared/protocol and docs/adr/0004.
 *
 * Built with schema v4's `schema()` factory rather than decorators: the server runs on
 * Node's native TypeScript support, which strips types but does not transform decorator
 * syntax — and the factory is also what wires the `Symbol.metadata` the v4 encoder needs
 * (`defineTypes` + declared class fields does not, and crashes on first full-state encode).
 */

export const PlayerMeta = schema(
  {
    slot: 'uint8',
    colorSlot: 'uint8',
    isBot: 'boolean',
    /** Milliseconds spent as It — the score. Patched once a second, not per tick. */
    itTimeMs: 'uint32',
    /** Times caught this round — the score tie-breaker (fewer is better). */
    caught: 'uint8',
  },
  'PlayerMeta',
)
export type PlayerMetaT = InstanceType<typeof PlayerMeta>

export const ArenaState = schema(
  {
    /** RoundPhase value, mirrored from the sim for lobby/results UI. */
    phase: 'uint8',
    mapIndex: 'uint8',
    /** Session id of the host — the first human in, migrates on leave. */
    hostId: 'string',
    /** Private rooms wait for the host; public rooms auto-start. */
    isPrivate: 'boolean',
    /** Humans currently connected (bots are sim-side only). */
    humans: 'uint8',
    /** Private rooms: how many bots the host wants at round start (0 = humans only).
     * Public rooms ignore this and fill to MIN_PLAYERS as always. */
    bots: 'uint8',
    /** Round length in whole minutes. Private-room hosts may change it; public rooms
     * keep the default. */
    roundMins: 'uint8',
    players: { map: PlayerMeta },
  },
  'ArenaState',
)
export type ArenaStateT = InstanceType<typeof ArenaState>

/** Fresh state with sane defaults. */
export const createArenaState = (): ArenaStateT => {
  const s = new ArenaState()
  s.phase = 0
  s.mapIndex = 0
  s.hostId = ''
  s.isPrivate = false
  s.humans = 0
  s.bots = 0
  s.roundMins = 3
  s.players = new MapSchema()
  return s
}

export const createPlayerMeta = (slot: number, colorSlot: number, isBot: boolean): PlayerMetaT => {
  const m = new PlayerMeta()
  m.slot = slot
  m.colorSlot = colorSlot
  m.isBot = isBot
  m.itTimeMs = 0
  m.caught = 0
  return m
}
