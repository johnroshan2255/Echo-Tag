import { Room, type Client } from '@colyseus/core'
import {
  LEADERBOARD_MS,
  MAP_COUNT,
  MAX_LOBBY_WAIT_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MSG,
  RoundPhase,
  SNAPSHOT_MAX_BYTES,
  TICK_MS,
  addPlayer,
  createWorld,
  enterPhase,
  packKeys,
  removePlayer,
  setMap,
  stepWorld,
  syntheticDriver,
  writeHistoryBlob,
  writeSnapshot,
  HISTORY_BLOB_BYTES,
  type World,
} from '@echo-tag/shared'
import { createDriverState } from '@echo-tag/shared/ai'
import { createArenaState, createPlayerMeta, type ArenaStateT } from './state/ArenaState.ts'

/**
 * The authoritative room: one shared-sim World stepped at 20Hz on the server.
 *
 * Authority is a thin shell around `stepWorld` — the same function the client runs — which
 * is the whole architecture (docs/adr/0001): the server's only jobs are collecting one
 * input byte per human per tick, driving bot slots with the shared synthetic driver, and
 * broadcasting the ~90-byte snapshot. Echo trails never touch the wire (docs/adr/0004):
 * clients rebuild them from the position stream, and a late joiner gets the full history
 * ring exactly once in their welcome.
 *
 * Matchmaking is split into pools by the `code` option (`filterBy` in index.ts):
 *   - Quick match: joinOrCreate with code '' — everyone lands in shared public rooms,
 *     which bot-fill and start ~2s after the first human arrives.
 *   - Host private: create with a fresh 5-letter code, room marked private so quick match
 *     never routes strangers in; friends `join` with the same code. The host starts the
 *     round; bots fill the empty seats either way. Max 12 humans, always.
 */

interface JoinOptions {
  code?: string
}

const isBotFill = (w: World, slot: number): boolean => w.isBot[slot] === 1

export class ArenaRoom extends Room<{ state: ArenaStateT }> {
  override maxClients = MAX_PLAYERS
  override state = createArenaState()

  private world: World = createWorld((Math.random() * 0xffffffff) | 0, 0)
  private driver = createDriverState()
  private inputs = new Uint8Array(MAX_PLAYERS)
  private lastSeq = new Uint16Array(MAX_PLAYERS)
  private slotOf = new Map<string, number>()
  private snapshotBuf = new ArrayBuffer(SNAPSHOT_MAX_BYTES)
  private snapshotView = new DataView(this.snapshotBuf)
  private simTick = 0
  private lobbyDeadline = Number.POSITIVE_INFINITY
  private leaderboardUntil = 0
  private scorePatchAcc = 0

  override onCreate(options: JoinOptions): void {
    this.state.isPrivate = Boolean(options.code)
    // NOT setPrivate(): that hides the room from ALL matchmaking, including friends joining
    // by code. Privacy here comes from filterBy(['code']) pool separation — quick-match
    // clients all carry code '' and can never be routed into a room keyed by a real code.
    this.state.mapIndex = this.world.map.index

    this.onMessage(MSG.Input, (client, data: ArrayBuffer | Uint8Array) => {
      const slot = this.slotOf.get(client.sessionId)
      if (slot === undefined) return
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      if (bytes.length < 3) return
      const seq = bytes[0]! | (bytes[1]! << 8)
      // Reject stale/replayed frames but tolerate the u16 wrap.
      const delta = (seq - this.lastSeq[slot]!) & 0xffff
      if (delta === 0 || delta > 0x8000) return
      this.lastSeq[slot] = seq
      this.lastHumanInput[slot] = bytes[2]!
    })

    this.onMessage(MSG.Go, (client) => {
      // Only the host starts a private lobby; public lobbies start themselves.
      if (client.sessionId !== this.state.hostId) return
      if (this.world.phase !== RoundPhase.Lobby) return
      this.startRound()
    })

    this.setSimulationInterval(() => this.tick(), TICK_MS)
  }

  override onJoin(client: Client, _options: JoinOptions): void {
    // Reclaim a bot seat if the room is full of fill; humans always outrank bots.
    let slot = addPlayer(this.world, false)
    if (slot < 0) {
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (isBotFill(this.world, s)) {
          removePlayer(this.world, s)
          this.state.players.delete(`b${s}`)
          slot = addPlayer(this.world, false)
          break
        }
      }
    }
    if (slot < 0) throw new Error('room full')

    this.slotOf.set(client.sessionId, slot)
    this.inputs[slot] = 0
    this.lastHumanInput[slot] = 0
    this.lastSeq[slot] = 0

    this.state.players.set(client.sessionId, createPlayerMeta(slot, this.world.colorSlot[slot]!, false))
    this.state.humans++
    if (this.state.hostId === '') this.state.hostId = client.sessionId

    // Public rooms arm the auto-start clock on the first arrival.
    if (!this.state.isPrivate && this.world.phase === RoundPhase.Lobby) {
      this.lobbyDeadline = Math.min(this.lobbyDeadline, Date.now() + MAX_LOBBY_WAIT_MS)
    }

    this.sendWelcome(client, slot)
  }

  override onLeave(client: Client, _code: number): void {
    const slot = this.slotOf.get(client.sessionId)
    if (slot === undefined) return
    this.slotOf.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    this.state.humans--
    removePlayer(this.world, slot)
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = this.slotOf.keys().next().value ?? ''
    }
  }

  // ── Round lifecycle ──────────────────────────────────────────────────────────

  private startRound(): void {
    // Fill the empty seats with bots so the round starts full-feeling (GDD §7).
    let seats = this.world.playerCount
    for (let s = 0; seats < MIN_PLAYERS && s < MAX_PLAYERS; s++) {
      if (this.world.active[s] === 1) continue
      const slot = addPlayer(this.world, true)
      if (slot < 0) break
      this.state.players.set(`b${slot}`, createPlayerMeta(slot, this.world.colorSlot[slot]!, true))
      seats++
    }

    enterPhase(this.world, RoundPhase.Countdown)
    this.state.phase = this.world.phase
    this.broadcastRoundSetup()
    this.lobbyDeadline = Number.POSITIVE_INFINITY
  }

  private nextRound(): void {
    setMap(this.world, (this.world.map.index + 1) % MAP_COUNT)
    this.state.mapIndex = this.world.map.index
    this.startRound()
  }

  // ── The tick ─────────────────────────────────────────────────────────────────

  private tick(): void {
    const w = this.world

    if (w.phase === RoundPhase.Lobby) {
      if (this.state.humans > 0 && Date.now() >= this.lobbyDeadline) this.startRound()
      return
    }

    // Bots first (the driver writes every active slot), then overlay each human's latest byte.
    syntheticDriver(w, this.inputs, this.simTick, this.driver)
    for (const slot of this.slotOf.values()) {
      this.inputs[slot] = this.lastHumanInput[slot]!
    }

    const ev = stepWorld(w, this.inputs)
    this.simTick++

    if (ev.roundEnded) {
      this.leaderboardUntil = Date.now() + LEADERBOARD_MS
    }
    if (w.phase === RoundPhase.Leaderboard && Date.now() >= this.leaderboardUntil) {
      this.nextRound()
      return
    }

    if (this.state.phase !== w.phase) this.state.phase = w.phase

    // Scores patch once a second — cold data does not ride the hot path.
    this.scorePatchAcc += TICK_MS
    if (this.scorePatchAcc >= 1000) {
      this.scorePatchAcc = 0
      this.state.players.forEach((meta) => {
        meta.itTimeMs = Math.round(w.itTimeMs[meta.slot]!)
      })
    }

    const len = writeSnapshot(w, w.map.index, this.snapshotView)
    this.broadcast(MSG.Snapshot, new Uint8Array(this.snapshotBuf, 0, len))
  }

  // Humans' most recent input bytes, kept apart so the bot driver can't clobber them.
  private lastHumanInput = new Uint8Array(MAX_PLAYERS)

  private sendWelcome(client: Client, slot: number): void {
    const history = new ArrayBuffer(HISTORY_BLOB_BYTES)
    writeHistoryBlob(this.world, new DataView(history))
    client.send(MSG.Welcome, {
      slot,
      mapIndex: this.world.map.index,
      tick: this.world.tick,
      keys: packKeys(this.world, slot),
      colors: Array.from(this.world.colorSlot),
      history: new Uint8Array(history),
    })
  }

  private broadcastRoundSetup(): void {
    for (const [sessionId, slot] of this.slotOf) {
      const client = this.clients.find((c) => c.sessionId === sessionId)
      client?.send(MSG.Round, {
        mapIndex: this.world.map.index,
        keys: packKeys(this.world, slot),
        colors: Array.from(this.world.colorSlot),
      })
    }
  }
}
