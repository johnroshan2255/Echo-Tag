import {
  COUNTDOWN_MS,
  LEADERBOARD_MS,
  MAX_PLAYERS,
  ROUND_DURATION_MS,
  TICK_MS,
} from '../constants.ts'
import { NO_SLOT, RoundPhase, type Slot, type StepEvents } from '../types.ts'
import { updateDoors } from './door.ts'
import { dealKeys, updateWardrobes } from './wardrobe.ts'
import { rebuildEchoBodies, sampleHistory } from './echo.ts'
import { IDLE_INPUT } from './input.ts'
import { integratePlayer } from './player.ts'
import { resolveTags, setIt } from './tag.ts'
import { leastItTimeSlot, random, spawnAll, type World } from './world.ts'

/**
 * THE tick. The only place game rules advance.
 *
 * The server calls this from `setSimulationInterval(TICK_MS)`; the client calls it for
 * local prediction and again for every replayed input during reconciliation. Both must
 * get identical results from identical inputs, which is why:
 *   - inputs arrive as packed bytes, so there is no float to disagree about,
 *   - all randomness comes from `w.rng`, never `Math.random()`,
 *   - the order of operations below is fixed and must not be rearranged.
 *
 * Order matters. Integrate first, then sample history, then derive bodies, then tag:
 * sampling before movement would make an echo lag a full tick behind its player, and
 * tagging before collision could hand out a tag through an echo wall.
 *
 * `inputs` is a Uint8Array of length MAX_PLAYERS indexed by slot. Inactive slots and
 * bot slots are read the same way — a bot input byte is written by `ai/bot.ts` before
 * this is called, which is what makes bots indistinguishable from humans downstream.
 */
export const stepWorld = (w: World, inputs: Uint8Array): StepEvents => {
  const ev = w.events
  ev.tagCount = 0
  ev.tagFrom = NO_SLOT
  ev.tagTo = NO_SLOT
  ev.roundEnded = false

  w.tick++
  w.phaseMs += TICK_MS

  switch (w.phase) {
    case RoundPhase.Lobby:
      // Nothing simulates. The room decides when to start (bot-fill timer).
      return ev

    case RoundPhase.Countdown:
      // Players are visible and frozen. History still samples so echoes exist from t=0
      // rather than popping in three seconds after the round starts.
      sampleHistory(w)
      rebuildEchoBodies(w)
      if (w.phaseMs >= COUNTDOWN_MS) enterPhase(w, RoundPhase.Playing)
      return ev

    case RoundPhase.Playing:
      break

    case RoundPhase.Leaderboard:
      if (w.phaseMs >= LEADERBOARD_MS) enterPhase(w, RoundPhase.Lobby)
      return ev
  }

  // ── Playing ──────────────────────────────────────────────────────────────────

  // Doors first, from last tick's positions, so a door starts opening the tick you arrive
  // and this tick's collision already sees the new openness.
  updateDoors(w)
  // Then wardrobes: entries and exits resolve before integration, so a player who slips
  // inside this tick does not also move this tick.
  updateWardrobes(w, inputs)

  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    if (w.hiddenIn[s] !== NO_SLOT) continue // inside a wardrobe: no movement, no collision
    integratePlayer(w, s, inputs[s] ?? IDLE_INPUT)
  }

  sampleHistory(w)
  rebuildEchoBodies(w)
  resolveTags(w)

  // The score. Accrued after tag resolution so the tick a tag lands is charged to the
  // player who was It for it — you are not billed for the tick you escaped on.
  const it = w.itSlot
  if (it !== NO_SLOT && w.active[it] === 1) {
    w.itTimeMs[it] = w.itTimeMs[it]! + TICK_MS
  }

  w.clockMs += TICK_MS
  if (w.clockMs >= ROUND_DURATION_MS) {
    ev.roundEnded = true
    enterPhase(w, RoundPhase.Leaderboard)
  }

  return ev
}

/** Switches phase and applies the entry side effects for the new one. */
export const enterPhase = (w: World, phase: RoundPhase): void => {
  w.phase = phase
  w.phaseMs = 0

  if (phase === RoundPhase.Countdown) {
    // The arena no longer scales with headcount — the map defines it. Spawns are authored
    // far apart, so a small lobby on a big map still starts with breathing room.
    w.clockMs = 0
    for (let s = 0; s < MAX_PLAYERS; s++) {
      w.itTimeMs[s] = 0
      w.immuneUntilTick[s] = 0
      w.tagCooldownUntilTick[s] = 0
      w.lastInput[s] = IDLE_INPUT
    }
    w.hiddenIn.fill(-1)
    w.wardrobeCooldownUntil.fill(0)
    spawnAll(w)
    dealKeys(w)
    setIt(w, pickStartingIt(w))
    rebuildEchoBodies(w)
  }

  if (phase === RoundPhase.Leaderboard) {
    // Freeze: zero velocity so nothing drifts under the results overlay.
    for (let s = 0; s < MAX_PLAYERS; s++) {
      w.vx[s] = 0
      w.vy[s] = 0
    }
  }

  if (phase === RoundPhase.Lobby) {
    w.itSlot = NO_SLOT
  }
}

/**
 * Picks the first "It" at random from live players. Random rather than "the last to
 * join" because starting as It is a small penalty and it shouldn't be predictable.
 */
const pickStartingIt = (w: World): Slot => {
  if (w.playerCount === 0) return NO_SLOT
  let target = Math.floor(random(w) * w.playerCount)
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    if (target === 0) return s
    target--
  }
  return leastItTimeSlot(w)
}
