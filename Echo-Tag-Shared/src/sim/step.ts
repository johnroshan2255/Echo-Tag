import {
  COUNTDOWN_MS,
  LEADERBOARD_MS,
  MAX_PLAYERS,
  TICK_MS,
} from '../constants.ts'
import { NO_SLOT, RoundPhase, type Slot, type StepEvents } from '../types.ts'
import { updateDoors } from './door.ts'
import { updateMonster } from './monster.ts'
import { updateNests } from './nest.ts'
import { updatePortals } from './portal.ts'
import { updateTrailStuns } from './stun.ts'
import { updateTurning } from './tag.ts'
import { spawnKeys, updateKeys, updateWardrobes } from './wardrobe.ts'
import { spawnTools, updateTools } from './tools.ts'
import { rebuildEchoBodies, sampleHistory } from './echo.ts'
import { IDLE_INPUT } from './input.ts'
import { integratePlayer } from './player.ts'
import { resolveTags, setIt } from './tag.ts'
import { leastItTimeSlot, random, resetHazards, spawnAll, type World } from './world.ts'

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
  ev.hazardCaught = NO_SLOT
  ev.portalUsed = NO_SLOT

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
  // Keys before wardrobes: a runner can grab a key and slip inside on the same tick.
  updateKeys(w)
  // Tools: pickups, queued uses, and puddle/trap effects — all before integration, so a
  // fresh slow or KO shapes this very tick's movement.
  updateTools(w)
  // The monster's own weapons (spider webs, alien beam) resolve with the tools, before
  // integration, so a fresh root or beam-KO shapes this very tick's movement too.
  updateMonster(w)
  // Then wardrobes: entries and exits resolve before integration, so a player who slips
  // inside this tick does not also move this tick.
  updateWardrobes(w, inputs)

  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    if (w.hiddenIn[s] !== NO_SLOT) continue // inside a wardrobe: no movement, no collision
    if (w.tick < w.unconsciousUntilTick[s]!) continue // out cold: input dead, body still
    if (w.heldByNest[s] !== NO_SLOT) continue // in a grabber's grip: input feeds the struggle
    integratePlayer(w, s, inputs[s] ?? IDLE_INPUT)
  }

  // Teleports and grabs happen AFTER movement and BEFORE history sampling, so the ring
  // records where the body actually ended up — a trail never bridges a warp or a drag.
  updatePortals(w)
  updateNests(w, inputs)

  sampleHistory(w)
  rebuildEchoBodies(w)
  updateTrailStuns(w) // trails are hazards, not walls: walking into one faints you
  updateTurning(w) // a finished metamorphosis crowns the new ghost (with 1s immunity)
  resolveTags(w)

  // The score. Accrued after tag resolution so the tick a tag lands is charged to the
  // player who was It for it — you are not billed for the tick you escaped on.
  const it = w.itSlot
  if (it !== NO_SLOT && w.active[it] === 1) {
    w.itTimeMs[it] = w.itTimeMs[it]! + TICK_MS
  }

  w.clockMs += TICK_MS
  if (w.clockMs >= w.roundDurationMs) {
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
    w.timesCaught.fill(0)
    w.hiddenIn.fill(-1)
    w.wardrobeCooldownUntil.fill(0)
    w.doorOpen.fill(0) // shut whatever the round-ending tick left ajar; updateDoors only runs in Playing
    w.turningSlot = -1
    w.unconsciousUntilTick.fill(0)
    w.trailOverlap.fill(0)
    resetHazards(w) // nest spiders home, webs cleared, beam idle, portals warm
    spawnAll(w)
    spawnKeys(w)
    spawnTools(w)
    setIt(w, pickStartingIt(w))
    rebuildEchoBodies(w)
  }

  if (phase === RoundPhase.Playing) {
    // The trail clock starts when play does: the opening ghost begins trail-less too,
    // not standing on a stack of its own countdown samples.
    w.itSinceTick = w.tick
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
