import { Room, type Client } from '@colyseus/core'
import {
  CHAT_MAX_LEN,
  CHAT_MIN_INTERVAL_MS,
  EMOTE_COUNT,
  EMOTE_MIN_INTERVAL_MS,
  LEADERBOARD_MS,
  MAP_COUNT,
  MAX_LOBBY_WAIT_MS,
  MAX_PLAYERS,
  MAX_TOOL_SPAWNS,
  MIN_PLAYERS,
  MSG,
  ROUND_MINS_MAX,
  ROUND_MINS_MIN,
  RoundPhase,
  SNAPSHOT_MAX_BYTES,
  TICK_MS,
  addPlayer,
  createWorld,
  enterPhase,
  filterProfanity,
  packKeys,
  queueAbility,
  queueToolUse,
  removePlayer,
  setIt,
  setMap,
  stepWorld,
  syntheticDriver,
  writeHistoryBlob,
  writeSnapshot,
  HISTORY_BLOB_BYTES,
  type World,
} from '@echo-tag/shared'
import { createDriverState } from '@echo-tag/shared/ai'
import { env } from '../config/env.ts'
import { usernameFromToken } from '../auth/cgToken.ts'
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
  /** CrazyGames user token (SDK.user.getUserToken()). The display name comes from its
   * VERIFIED claims — a client-chosen name is never accepted (auth/cgToken.ts). */
  cgToken?: string
}

/** Even a verified username is shown to strangers: whitelist the charset, cap, mask profanity. */
const cleanName = (raw: string): string => filterProfanity(raw.replace(/[^A-Za-z0-9_.]/g, '').slice(0, 20))

const isBotFill = (w: World, slot: number): boolean => w.isBot[slot] === 1

/** Input messages accepted per client per 50ms tick window. Honest clients send 1;
 * 8 tolerates reconnection/tab-resume bursts while capping a flood at 8x normal. */
const INPUT_MSGS_PER_TICK_MAX = 8

/** An empty room survives this long — a refresh (leave + rejoin by ?room=CODE) must not
 * destroy the room the player is trying to come back to. */
const EMPTY_ROOM_GRACE_MS = 30_000

export class ArenaRoom extends Room<{ state: ArenaStateT }> {
  override maxClients = MAX_PLAYERS
  // Disposal is manual (see emptyAt in tick): the default dispose-on-empty would kill a
  // room the instant its last player refreshes, breaking the URL rejoin.
  override autoDispose = false
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
  /** Wall-clock time to start the NEXT round, or 0. Set when a round ends and honoured
   * whatever phase the shared sim has meanwhile moved to — the sim flips Leaderboard→Lobby
   * at exactly LEADERBOARD_MS, the same instant this fires, so gating the continuation on
   * "still Leaderboard" is a race the sim can win, stranding a private room in its lobby. */
  private continueAt = 0
  private scorePatchAcc = 0
  /** Wall-clock time at which an empty room finally disposes. Infinity while occupied.
   * Armed from birth (onCreate): a room whose reservation is never consumed — the client
   * dropped mid-handshake, or onJoin threw — has no onLeave to arm it, and with
   * autoDispose off it would otherwise tick at 20Hz forever. onJoin lifts it. */
  private emptyAt = Date.now() + EMPTY_ROOM_GRACE_MS
  /** The pool key this room was created in ('' = public). Re-checked on EVERY join: the
   * matchmaker's filterBy only guards join/joinOrCreate, while joinById (a CrazyGames
   * friend following a public-room invite) reaches any room whose id you know. */
  private code = ''

  override onCreate(options: JoinOptions): void {
    this.code = typeof options.code === 'string' ? options.code : ''
    this.state.isPrivate = Boolean(options.code)
    // NOT setPrivate(): that hides the room from ALL matchmaking, including friends joining
    // by code. Privacy here comes from filterBy(['code']) pool separation — quick-match
    // clients all carry code '' and can never be routed into a room keyed by a real code.
    this.state.mapIndex = this.world.map.index
    this.state.roundMins = Math.round(this.world.roundDurationMs / 60_000)

    this.onMessage(MSG.Input, (client, data: ArrayBuffer | Uint8Array) => {
      const slot = this.slotOf.get(client.sessionId)
      if (slot === undefined) return
      // Rate cap: an honest client sends exactly one of these per 50ms tick; allow a
      // generous burst (tab-resume clumps) and silently drop the rest, so a flooding
      // client costs one map lookup and a counter check instead of full processing.
      if (this.inputBudget[slot]! >= INPUT_MSGS_PER_TICK_MAX) return
      this.inputBudget[slot]!++
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      if (bytes.length < 3) return
      const seq = bytes[0]! | (bytes[1]! << 8)
      // Reject stale/replayed frames but tolerate the u16 wrap.
      const delta = (seq - this.lastSeq[slot]!) & 0xffff
      if (delta === 0 || delta > 0x8000) return
      this.lastSeq[slot] = seq
      this.lastHumanInput[slot] = bytes[2]!
    })

    this.onMessage(MSG.Use, (client, invSlot: number) => {
      const slot = this.slotOf.get(client.sessionId)
      if (slot === undefined) return
      // Slot 2 is the monster ability (spider web / alien beam) — the sim validates who
      // may fire it and when; anyone else's press is a no-op there.
      if (invSlot === 2) return queueAbility(this.world, slot)
      if (invSlot !== 0 && invSlot !== 1) return
      queueToolUse(this.world, slot, invSlot)
    })

    this.onMessage(MSG.Chat, (client, text: unknown) => {
      // Pure relay: sanitised, profanity-masked (portal requirement — CrazyGames et al.
      // demand at least a word filter on any chat), rate-limited, broadcast to the room,
      // NEVER stored — chat exists only in the room context, exactly as long as the
      // clients showing it.
      const slot = this.slotOf.get(client.sessionId)
      if (slot === undefined || typeof text !== 'string') return
      const now = Date.now()
      if (now < (this.chatNextAt.get(client.sessionId) ?? 0)) return
      const clean = filterProfanity(
        text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX_LEN),
      )
      if (clean.length === 0) return
      this.chatNextAt.set(client.sessionId, now + CHAT_MIN_INTERVAL_MS)
      this.broadcast(MSG.Chat, { slot, text: clean })
    })

    this.onMessage(MSG.Emote, (client, n: unknown) => {
      // Pure relay, like chat: a valid index in, {slot, n} out to the room, nothing stored.
      const slot = this.slotOf.get(client.sessionId)
      if (slot === undefined) return
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= EMOTE_COUNT) return
      const now = Date.now()
      if (now < (this.emoteNextAt.get(client.sessionId) ?? 0)) return
      this.emoteNextAt.set(client.sessionId, now + EMOTE_MIN_INTERVAL_MS)
      this.broadcast(MSG.Emote, { slot, n })
    })

    this.onMessage(MSG.Bots, (client, n: unknown) => {
      // The host of a private room decides how many bots join at round start — zero is a
      // legitimate choice: four friends, one ghost, nobody artificial.
      if (client.sessionId !== this.state.hostId) return
      if (!this.state.isPrivate || this.world.phase !== RoundPhase.Lobby) return
      if (typeof n !== 'number' || !Number.isInteger(n)) return
      this.state.bots = Math.max(0, Math.min(MAX_PLAYERS - this.state.humans, n))
    })

    this.onMessage(MSG.Mins, (client, n: unknown) => {
      // The host of a private room picks the round length, in the lobby only — changing
      // it mid-round would move the finish line under everyone's feet.
      if (client.sessionId !== this.state.hostId) return
      if (!this.state.isPrivate || this.world.phase !== RoundPhase.Lobby) return
      if (typeof n !== 'number' || !Number.isInteger(n)) return
      const mins = Math.max(ROUND_MINS_MIN, Math.min(ROUND_MINS_MAX, n))
      this.state.roundMins = mins
      this.world.roundDurationMs = mins * 60_000
    })

    this.onMessage(MSG.Map, (client, n: unknown) => {
      // The host of a private room picks the arena, in the lobby only — same rules as
      // bots and round length.
      if (client.sessionId !== this.state.hostId) return
      if (!this.state.isPrivate || this.world.phase !== RoundPhase.Lobby) return
      if (typeof n !== 'number' || !Number.isInteger(n)) return
      const index = Math.max(0, Math.min(MAP_COUNT - 1, n))
      setMap(this.world, index)
      this.state.mapIndex = index
    })

    this.onMessage(MSG.Go, (client) => {
      // Only the host starts a private lobby; public lobbies start themselves.
      if (client.sessionId !== this.state.hostId) return
      if (this.world.phase !== RoundPhase.Lobby) return
      // A private round needs at least two players. Bots count: a solo host who dialed
      // bots up is asking for a warm-up round, and the +/- control they were shown must
      // be able to take effect. A tag game against literally nobody is still refused.
      if (this.state.isPrivate && this.state.humans + this.state.bots < 2) return
      this.startRound()
    })

    if (env.testHooks) {
      // Test-only seams for tools/check/mp-probe.ts, which needs deterministic scenarios
      // (walk into a keyed wardrobe, get tagged by the ghost) that real matchmaking cannot
      // stage. Registered ONLY when the probe's own server spawn sets TEST_HOOKS=true —
      // a production boot never has these messages.
      this.onMessage('test:teleport', (_client, m: { slot: number; x: number; y: number }) => {
        if (!Number.isInteger(m?.slot) || m.slot < 0 || m.slot >= MAX_PLAYERS) return
        if (this.world.active[m.slot] === 0) return
        this.world.x[m.slot] = m.x
        this.world.y[m.slot] = m.y
        this.world.vx[m.slot] = 0
        this.world.vy[m.slot] = 0
      })
      this.onMessage('test:setIt', (_client, m: { slot: number }) => {
        if (!Number.isInteger(m?.slot) || m.slot < 0 || m.slot >= MAX_PLAYERS) return
        if (this.world.active[m.slot] === 0) return
        setIt(this.world, m.slot)
      })
    }

    this.setSimulationInterval(() => this.tick(), TICK_MS)
  }

  override async onJoin(client: Client, options: JoinOptions): Promise<void> {
    // A private room admits only clients carrying its code, whatever route they took in.
    if ((typeof options?.code === 'string' ? options.code : '') !== this.code) throw new Error('wrong room')
    // The name comes from the verified CrazyGames token or not at all (see JoinOptions).
    const name = cleanName(await usernameFromToken(options?.cgToken))
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

    this.emptyAt = Number.POSITIVE_INFINITY
    this.slotOf.set(client.sessionId, slot)
    this.inputs[slot] = 0
    this.lastHumanInput[slot] = 0
    this.lastSeq[slot] = 0

    this.state.players.set(client.sessionId, createPlayerMeta(slot, this.world.colorSlot[slot]!, false, name))
    this.state.humans++
    if (this.state.hostId === '') this.state.hostId = client.sessionId

    // Public rooms arm the auto-start clock on the first arrival.
    if (!this.state.isPrivate && this.world.phase === RoundPhase.Lobby) {
      this.lobbyDeadline = Math.min(this.lobbyDeadline, Date.now() + MAX_LOBBY_WAIT_MS)
    }

    this.sendWelcome(client, slot)
  }

  override onLeave(client: Client, _code: number): void {
    this.chatNextAt.delete(client.sessionId)
    this.emoteNextAt.delete(client.sessionId)
    const slot = this.slotOf.get(client.sessionId)
    if (slot === undefined) return
    
    const wasHost = this.state.hostId === client.sessionId

    this.slotOf.delete(client.sessionId)
    this.state.players.delete(client.sessionId)
    this.state.humans--
    removePlayer(this.world, slot)
    
    if (wasHost) {
      if (this.state.isPrivate) {
        // In private co-op rooms, the host's departure collapses the room.
        this.broadcast(MSG.HostLeft, {})
        void this.disconnect()
        return
      }
      // Otherwise, hand the host crown to the next player.
      this.state.hostId = this.slotOf.keys().next().value ?? ''
    }
    // Last human out: hold the room for the grace window — they may just be refreshing.
    if (this.state.humans === 0) this.emptyAt = Date.now() + EMPTY_ROOM_GRACE_MS
  }

  // ── Round lifecycle ──────────────────────────────────────────────────────────

  private startRound(): void {
    // Seat the bots. Public rooms fill to MIN_PLAYERS so quick match always feels alive
    // (GDD §7); private rooms seat exactly as many bots as the host asked for — including
    // none. Reconcile rather than only add: a host can also dial bots DOWN between rounds.
    const target = this.state.isPrivate
      ? Math.min(MAX_PLAYERS, this.state.humans + this.state.bots)
      : Math.max(MIN_PLAYERS, this.world.playerCount)
    for (let s = 0; s < MAX_PLAYERS && this.world.playerCount > target; s++) {
      if (this.world.active[s] === 1 && isBotFill(this.world, s)) {
        removePlayer(this.world, s)
        this.state.players.delete(`b${s}`)
      }
    }
    while (this.world.playerCount < target) {
      const slot = addPlayer(this.world, true)
      if (slot < 0) break
      this.state.players.set(`b${slot}`, createPlayerMeta(slot, this.world.colorSlot[slot]!, true))
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
    this.inputBudget.fill(0) // a fresh per-client input allowance every tick window

    if (Date.now() >= this.emptyAt) {
      void this.disconnect() // nobody came back inside the grace window
      return
    }

    if (w.phase === RoundPhase.Lobby) {
      // A round that just ended lands here (sim flipped to Lobby); continueAt drives the
      // next round. Only a FIRST-round lobby (continueAt === 0) waits on lobbyDeadline.
      if (this.continueAt !== 0 && Date.now() >= this.continueAt) {
        this.continueAt = 0
        this.nextRound()
      } else if (this.continueAt === 0 && this.state.humans > 0 && Date.now() >= this.lobbyDeadline) {
        this.startRound()
      }
      return
    }

    // Bots first (the driver writes every active slot), then overlay each human's latest byte.
    syntheticDriver(w, this.inputs, this.simTick, this.driver)
    for (const slot of this.slotOf.values()) {
      this.inputs[slot] = this.lastHumanInput[slot]!
    }

    const ev = stepWorld(w, this.inputs)
    this.simTick++
    // stepWorld mutates w.phase (it flips Leaderboard→Lobby at LEADERBOARD_MS); read it
    // through a widened alias so the earlier `phase !== Lobby` narrowing does not apply.
    const phaseNow = w.phase as RoundPhase

    if (ev.roundEnded) {
      this.continueAt = Date.now() + LEADERBOARD_MS
      this.syncScores() // the results screen must open with the FINAL scores, not ~1s-stale ones
    }
    // Auto-continue with the same group (no return to any menu — a CrazyGames requirement,
    // and what the offline client does too). Deterministic: the flag, not the live phase,
    // decides, so the sim's own Leaderboard→Lobby flip at the same tick cannot swallow it.
    if (this.continueAt !== 0 && Date.now() >= this.continueAt &&
        (phaseNow === RoundPhase.Leaderboard || phaseNow === RoundPhase.Lobby)) {
      this.continueAt = 0
      this.nextRound()
      return
    }

    if (this.state.phase !== w.phase) this.state.phase = w.phase

    // Scores patch once a second — cold data does not ride the hot path.
    this.scorePatchAcc += TICK_MS
    if (this.scorePatchAcc >= 1000) {
      this.scorePatchAcc = 0
      this.syncScores()
    }

    const len = writeSnapshot(w, w.map.index, this.snapshotView)
    this.broadcast(MSG.Snapshot, new Uint8Array(this.snapshotBuf, 0, len))
  }

  /** Copies the sim's It-times into the synced state the lobby/results UI reads. */
  private syncScores(): void {
    this.state.players.forEach((meta) => {
      meta.itTimeMs = Math.round(this.world.itTimeMs[meta.slot]!)
      meta.caught = this.world.timesCaught[meta.slot]!
    })
  }

  // Humans' most recent input bytes, kept apart so the bot driver can't clobber them.
  private lastHumanInput = new Uint8Array(MAX_PLAYERS)

  // Input messages consumed by each slot this tick window (see INPUT_MSGS_PER_TICK_MAX).
  private inputBudget = new Uint8Array(MAX_PLAYERS)

  // Chat rate limit: earliest wall-clock time each client may speak again.
  private chatNextAt = new Map<string, number>()

  // Emote rate limit, same shape.
  private emoteNextAt = new Map<string, number>()

  /** Floor-key spawn positions as flat (x, y) pairs. Fixed within a round; empty in the
   * lobby, where no keys exist yet (the round-setup broadcast delivers the real ones). */
  private keySpawns(): number[] {
    if (this.world.phase === RoundPhase.Lobby) return []
    const count = this.world.map.wardrobes.length / 4
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      out.push(Math.round(this.world.keyX[i]!), Math.round(this.world.keyY[i]!))
    }
    return out
  }

  /** Floor-tool spawns as flat (x, y, type) triples. Fixed within a round; empty in lobby. */
  private toolSpawns(): number[] {
    if (this.world.phase === RoundPhase.Lobby) return []
    const out: number[] = []
    for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
      out.push(Math.round(this.world.toolX[i]!), Math.round(this.world.toolY[i]!), this.world.toolType[i]!)
    }
    return out
  }

  private sendWelcome(client: Client, slot: number): void {
    const history = new ArrayBuffer(HISTORY_BLOB_BYTES)
    writeHistoryBlob(this.world, new DataView(history))
    client.send(MSG.Welcome, {
      slot,
      mapIndex: this.world.map.index,
      roundMs: this.world.roundDurationMs,
      tick: this.world.tick,
      keys: packKeys(this.world, slot),
      keySpawns: this.keySpawns(),
      toolSpawns: this.toolSpawns(),
      colors: Array.from(this.world.colorSlot),
      history: new Uint8Array(history),
    })
  }

  private broadcastRoundSetup(): void {
    for (const [sessionId, slot] of this.slotOf) {
      const client = this.clients.find((c) => c.sessionId === sessionId)
      client?.send(MSG.Round, {
        mapIndex: this.world.map.index,
        roundMs: this.world.roundDurationMs,
        keys: packKeys(this.world, slot),
        keySpawns: this.keySpawns(),
        toolSpawns: this.toolSpawns(),
        colors: Array.from(this.world.colorSlot),
      })
    }
  }
}
