import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ECHO_BODIES_PER_PLAYER,
  ECHO_DELAY_MS,
  MAP_TILE,
  MAX_PLAYERS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TICK_MS,
  TRANSFORM_DELAY_MS,
  UNCONSCIOUS_MS,
} from '../constants.ts'
import { NO_SLOT, RoundPhase } from '../types.ts'
import { encodeInput } from './input.ts'
import { enterPhase, stepWorld } from './step.ts'
import { setIt } from './tag.ts'
import { addPlayer, createWorld, type World } from './world.ts'

const EAST = encodeInput(1, 0)
const WEST = encodeInput(-1, 0)
const TRANSFORM_TICKS = Math.ceil(TRANSFORM_DELAY_MS / TICK_MS)
const KO_TICKS = Math.ceil(UNCONSCIOUS_MS / TICK_MS)

const playing = (n: number, seed = 21): World => {
  const w = createWorld(seed, 1) // Pillars: open lanes for controlled runs
  for (let i = 0; i < n; i++) addPlayer(w, false)
  enterPhase(w, RoundPhase.Countdown)
  const inputs = new Uint8Array(MAX_PLAYERS)
  while (w.phase === RoundPhase.Countdown) stepWorld(w, inputs)
  return w
}

const park = (w: World, slot: number, tx: number, ty: number): void => {
  w.x[slot] = MAP_TILE * tx
  w.y[slot] = MAP_TILE * ty
  w.vx[slot] = 0
  w.vy[slot] = 0
  // Flatten their history so no stale trail interferes with the scenario.
  const base = slot * 60
  w.histX.fill(w.x[slot]!, base, base + 60)
  w.histY.fill(w.y[slot]!, base, base + 60)
}

/** Drives It into a stationary victim; returns after the touch registers. */
const tagHappens = (w: World, inputs: Uint8Array, it: number, victim: number): void => {
  setIt(w, it)
  w.tagBackUntilTick = 0 // scaffold setIt is not a real handover: no tag-back shield
  park(w, it, 4, 6.5)
  park(w, victim, 6, 6.5)
  inputs[it] = EAST
  for (let t = 0; t < 60 && w.events.tagCount === 0; t++) stepWorld(w, inputs)
  inputs[it] = 0
  assert.ok(w.turningSlot === victim, 'touch should begin the metamorphosis')
}

describe('transformation delay', () => {
  it('frees the old ghost immediately and suspends the hunt', () => {
    const w = playing(3)
    const inputs = new Uint8Array(MAX_PLAYERS)
    park(w, 2, 20, 11)
    tagHappens(w, inputs, 0, 1)

    assert.equal(w.itSlot, NO_SLOT, 'nobody hunts during the lull')
    assert.equal(w.turningSlot, 1)

    // The freed ghost is a normal player at once: can even hide (not blocked as It).
    // And no tag can occur for the whole window, no matter the overlap.
    park(w, 0, 6, 6.5) // stand right on the turning player
    for (let t = 0; t < TRANSFORM_TICKS - 2; t++) {
      const ev = stepWorld(w, inputs)
      assert.equal(ev.tagCount, 0, `a tag fired mid-lull at t=${t}`)
      assert.equal(w.itSlot, NO_SLOT)
    }
  })

  it('cannot flee while turning: stumble speed only', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    tagHappens(w, inputs, 0, 1)
    park(w, 0, 20, 11)

    const x0 = w.x[1]!
    inputs[1] = EAST
    for (let t = 0; t < 20; t++) stepWorld(w, inputs) // one second of trying to run
    inputs[1] = 0
    const fled = w.x[1]! - x0
    assert.ok(fled < PLAYER_SPEED * 0.2, `turning player outran the stumble: ${fled.toFixed(0)}wu in 1s`)
    assert.ok(fled > 0, 'stumbling should still move a little')
  })

  it('activates as the ghost after the delay, with fresh immunity and It-time from zero', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    tagHappens(w, inputs, 0, 1)
    park(w, 0, 20, 11)

    const itBefore = w.itTimeMs[1]!
    for (let t = 0; t < TRANSFORM_TICKS + 2; t++) stepWorld(w, inputs)

    assert.equal(w.itSlot, 1, 'the turned player should now be the ghost')
    assert.equal(w.turningSlot, NO_SLOT)
    assert.ok(w.immuneUntilTick[1]! > w.tick, 'standard immunity applies on becoming ghost')
    // No It-time accrued during the lull itself (itSlot was NO_SLOT throughout).
    assert.ok(w.itTimeMs[1]! - itBefore <= TICK_MS * 3, 'the mandatory lull must not be charged as It-time')
  })

  it('the lull is hazard-free: every trail vanishes while someone turns', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    // The ghost lays its trail driving into the victim; the touch frees it and empties
    // `itSlot` — and with it, the arena: only the ghost has a live trail, and there is
    // no ghost while the metamorphosis runs. Stumbling back through where the trail
    // was must never KO.
    tagHappens(w, inputs, 0, 1)
    inputs[1] = WEST
    for (let t = 0; t < TRANSFORM_TICKS - 2; t++) {
      stepWorld(w, inputs)
      assert.equal(w.turningSlot, 1)
      assert.ok(w.tick >= w.unconsciousUntilTick[1]!, 'turning player was knocked unconscious')
      for (let id = 0; id < w.bodyLive.length; id++) {
        assert.equal(w.bodyLive[id], 0, `echo body ${id} live during the lull`)
      }
    }
  })
})

describe('unconscious on trail contact', () => {
  /** Slot 0 — the ghost, since only the ghost's trail is live — lays an east trail;
   * slot 1 crosses it from the south. */
  const crossTrail = (w: World, inputs: Uint8Array): void => {
    setIt(w, 0)
    park(w, 0, 4, 6.5)
    inputs[0] = EAST
    for (let t = 0; t < Math.ceil(ECHO_DELAY_MS / TICK_MS); t++) stepWorld(w, inputs)
    inputs[0] = 0
    // Slot 1 approaches the middle of that trail from just below, walking north into it
    // (close enough that the segment has not aged out of the ring by the time they arrive).
    park(w, 1, 7, 8)
    inputs[1] = encodeInput(0, -1)
    for (let t = 0; t < 80 && w.tick >= w.unconsciousUntilTick[1]!; t++) stepWorld(w, inputs)
    inputs[1] = 0
  }

  it("faints a player who walks into the ghost's trail, and recovers them automatically", () => {
    const w = playing(3)
    const inputs = new Uint8Array(MAX_PLAYERS)
    park(w, 2, 20, 11) // bystander, out of the way
    crossTrail(w, inputs)

    assert.ok(w.tick < w.unconsciousUntilTick[1]!, 'crossing a trail should faint the walker')
    const wakeTick = w.unconsciousUntilTick[1]!
    const koX = w.x[1]!

    // Input is dead while out cold.
    inputs[1] = EAST
    for (let t = 0; t < KO_TICKS - 2; t++) stepWorld(w, inputs)
    assert.ok(Math.abs(w.x[1]! - koX) < 1, 'an unconscious body moved under input')

    // Passive recovery, then control returns.
    while (w.tick < wakeTick + 2) stepWorld(w, inputs)
    const x0 = w.x[1]!
    for (let t = 0; t < 10; t++) stepWorld(w, inputs)
    inputs[1] = 0
    assert.ok(w.x[1]! > x0 + 20, 'control should return after recovery, no interaction needed')
  })

  it('is an automatic catch: the ghost tags a fainted player by reaching them', () => {
    const w = playing(3)
    const inputs = new Uint8Array(MAX_PLAYERS)
    park(w, 2, 20, 11) // bystander, out of the way
    crossTrail(w, inputs) // ghost 0 lays the trail; slot 1 faints on it
    assert.ok(w.tick < w.unconsciousUntilTick[1]!)

    // Ghost approaches the body from the south — a path clear of its own old trail,
    // which still replays along the row it was laid on.
    w.x[0] = w.x[1]!
    w.y[0] = w.y[1]! + MAP_TILE * 2
    inputs[0] = encodeInput(0, -1)
    let caught = false
    for (let t = 0; t < 60 && !caught; t++) caught = stepWorld(w, inputs).tagCount > 0
    assert.ok(caught, 'an unconscious player must be catchable where they lie')
    assert.equal(w.turningSlot, 1)
  })

  it('does not faint a player standing still while a trail sweeps over them', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    // The ghost runs a loop THROUGH slot 1's position; slot 1 never moves. Slot 1 gets
    // scaffold immunity so the pass-through cannot tag — only the trail question remains.
    park(w, 1, 8, 6.5)
    park(w, 0, 4, 6.5)
    setIt(w, 0)
    w.immuneUntilTick[1] = 1 << 30
    inputs[0] = EAST
    for (let t = 0; t < 100; t++) {
      stepWorld(w, inputs)
      assert.ok(w.tick >= w.unconsciousUntilTick[1]!, 'a stationary player was fainted by a passing replay')
    }
  })

  it("own trail counts: the ghost circling back across its own path faints it", () => {
    const w = playing(1)
    assert.equal(w.itSlot, 0, 'a lone player is always the ghost')
    const inputs = new Uint8Array(MAX_PLAYERS)
    park(w, 0, 4, 6.5)
    // Run a tight box so the path crosses its own year-old (in echo terms) segment.
    const legs = [encodeInput(1, 0), encodeInput(0, 1), encodeInput(-1, 0), encodeInput(0, -1)]
    let fainted = false
    for (let leg = 0; leg < 8 && !fainted; leg++) {
      inputs[0] = legs[leg % 4]!
      for (let t = 0; t < 16 && !fainted; t++) {
        stepWorld(w, inputs)
        fainted = w.tick < w.unconsciousUntilTick[0]!
      }
    }
    assert.ok(fainted, "crossing your own old trail should be as dangerous as anyone else's")
  })

  it('does not chain-stun at spawn or when walking out of your own fresh trail', () => {
    const w = playing(4)
    const inputs = new Uint8Array(MAX_PLAYERS)
    // Straight runs from spawn: own trail directly behind, seeded stack underfoot.
    for (let s = 0; s < 4; s++) inputs[s] = encodeInput(Math.cos(s), Math.sin(s))
    for (let t = 0; t < 30; t++) {
      stepWorld(w, inputs)
      for (let s = 0; s < 4; s++) {
        assert.ok(w.tick >= w.unconsciousUntilTick[s]!, `slot ${s} chain-stunned by own fresh trail at t=${t}`)
      }
    }
  })

  it('humans leave no live trail — only the ghost has echo bodies', () => {
    const w = playing(3)
    const inputs = new Uint8Array(MAX_PLAYERS)
    park(w, 2, 20, 11)
    setIt(w, 2) // ghost parked far away; slots 0 and 1 are humans
    // Slot 0 lays a path exactly like a ghost would...
    park(w, 0, 4, 6.5)
    inputs[0] = EAST
    for (let t = 0; t < Math.ceil(ECHO_DELAY_MS / TICK_MS); t++) stepWorld(w, inputs)
    inputs[0] = 0
    // ...but none of their bodies is ever live.
    for (let id = 0; id < w.bodyLive.length; id++) {
      if (w.bodyLive[id] === 1) assert.equal(w.bodyOwner[id], 2, `body ${id} live for a non-ghost`)
    }
    // And crossing that path faints nobody.
    park(w, 1, 7, 10)
    inputs[1] = encodeInput(0, -1)
    for (let t = 0; t < 80; t++) {
      stepWorld(w, inputs)
      assert.ok(w.tick >= w.unconsciousUntilTick[1]!, `fainted on a human's trail at t=${t}`)
    }
  })

  it('crowning does not faint the new ghost — their trail starts empty', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    tagHappens(w, inputs, 0, 1)
    park(w, 0, 20, 11)
    // Stumble east through the whole metamorphosis, so the moment slot 1 is crowned they
    // are moving fast right where their past 3 seconds happened — none of which may be
    // a hazard, because the ghost trail only begins at the crowning.
    inputs[1] = EAST
    for (let t = 0; t < TRANSFORM_TICKS + 1; t++) stepWorld(w, inputs)
    assert.equal(w.itSlot, 1, 'the turned player should now be the ghost')
    for (let t = 0; t < 20; t++) {
      stepWorld(w, inputs)
      assert.ok(w.tick >= w.unconsciousUntilTick[1]!, `new ghost fainted at crowning at t=${t}`)
    }
  })

  it("the new ghost's trail starts empty and fills over exactly the echo delay", () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    tagHappens(w, inputs, 0, 1)
    park(w, 0, 20, 11)
    inputs[1] = EAST // plenty of pre-crowning movement that must never become a hazard
    for (let t = 0; t < TRANSFORM_TICKS + 1; t++) stepWorld(w, inputs)
    assert.equal(w.itSlot, 1)

    let live = 0
    for (const b of w.bodyLive) live += b
    assert.equal(live, 0, 'the new ghost must be crowned with no trail — that is the head start')

    for (let t = 0; t < Math.ceil(ECHO_DELAY_MS / TICK_MS); t++) stepWorld(w, inputs)
    live = 0
    for (const b of w.bodyLive) live += b
    assert.equal(live, ECHO_BODIES_PER_PLAYER, 'the trail should be full 3s after crowning')
  })
})
