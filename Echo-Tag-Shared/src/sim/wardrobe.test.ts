import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_PLAYERS,
  MAX_WARDROBES,
  TICK_MS,
  WARDROBE_COOLDOWN_MS,
  WARDROBE_MAX_HIDE_MS,
} from '../constants.ts'
import { wardrobeCenterX, wardrobeCenterY, wardrobeExitX, wardrobeExitY, MAPS } from '../maps/index.ts'
import { NO_SLOT, RoundPhase } from '../types.ts'
import { encodeInput } from './input.ts'
import { enterPhase, stepWorld } from './step.ts'
import { setIt } from './tag.ts'
import { addPlayer, createWorld, type World } from './world.ts'

/** Tests run on Warrens (map 3) — six wardrobes, the hiding map. */
const MAP = 3
const W = 0 // wardrobe under test

const playing = (n: number): World => {
  const w = createWorld(11, MAP)
  for (let i = 0; i < n; i++) addPlayer(w, false)
  enterPhase(w, RoundPhase.Countdown)
  const inputs = new Uint8Array(MAX_PLAYERS)
  while (w.phase === RoundPhase.Countdown) stepWorld(w, inputs)
  return w
}

const parkAway = (w: World, ...slots: number[]) => {
  for (const s of slots) {
    w.x[s] = w.arenaW - 160
    w.y[s] = w.arenaH - 160
    w.vx[s] = 0
    w.vy[s] = 0
  }
}

/** Puts `slot` at the wardrobe's exit tile, holding its key, cooldown clear. */
const stage = (w: World, slot: number): void => {
  w.keys[slot * MAX_WARDROBES + W] = 1
  w.wardrobeCooldownUntil[slot * MAX_WARDROBES + W] = 0
  w.x[slot] = wardrobeExitX(w.map, W)
  w.y[slot] = wardrobeExitY(w.map, W)
  w.vx[slot] = 0
  w.vy[slot] = 0
}

/** Input byte pointing from the exit tile into the wardrobe. */
const inward = (w: World): number =>
  encodeInput(
    wardrobeCenterX(w.map, W) - wardrobeExitX(w.map, W),
    wardrobeCenterY(w.map, W) - wardrobeExitY(w.map, W),
  )

/**
 * Walks slot 0 into the wardrobe. Entry legitimately takes a few ticks: the player
 * approaches, collides with the cabinet, and is accepted once pressed against it.
 */
const pressIn = (w: World, inputs: Uint8Array, slot = 0): void => {
  inputs[slot] = inward(w)
  for (let t = 0; t < 8 && w.hiddenIn[slot] === NO_SLOT; t++) stepWorld(w, inputs)
  inputs[slot] = 0
}

describe('wardrobes', () => {
  it('deals every player keys to some wardrobes, never all', () => {
    const w = playing(8)
    const count = w.map.wardrobes.length / 4
    for (let s = 0; s < 8; s++) {
      let held = 0
      for (let i = 0; i < count; i++) held += w.keys[s * MAX_WARDROBES + i]!
      assert.ok(held >= 1, `player ${s} holds no keys`)
      assert.ok(held < count, `player ${s} holds every key — hiding would be safe everywhere`)
    }
  })

  it('lets a keyed runner hide, and hides them from the tagger', () => {
    const w = playing(2)
    setIt(w, 1)
    parkAway(w, 1)
    stage(w, 0)
    const inputs = new Uint8Array(MAX_PLAYERS)
    pressIn(w, inputs)
    assert.equal(w.hiddenIn[0], W, 'runner with key should have slipped inside')

    // Park It on top of the wardrobe: no tag may happen.
    w.x[1] = wardrobeCenterX(w.map, W)
    w.y[1] = wardrobeCenterY(w.map, W)
    for (let t = 0; t < 30; t++) {
      const ev = stepWorld(w, inputs)
      assert.equal(ev.tagCount, 0, 'tagged a player inside a wardrobe')
    }
  })

  it('refuses a runner without the key', () => {
    const w = playing(2)
    setIt(w, 1)
    parkAway(w, 1)
    stage(w, 0)
    w.keys[0 * MAX_WARDROBES + W] = 0
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = inward(w)
    for (let t = 0; t < 5; t++) stepWorld(w, inputs)
    assert.equal(w.hiddenIn[0], NO_SLOT, 'entered without the key')
  })

  it('refuses "It" even with a key', () => {
    const w = playing(2)
    setIt(w, 0)
    parkAway(w, 1)
    stage(w, 0)
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = inward(w)
    for (let t = 0; t < 5; t++) stepWorld(w, inputs)
    assert.equal(w.hiddenIn[0], NO_SLOT, 'the predator hid')
  })

  it('exits on movement input, with no exit immunity, onto the exit tile', () => {
    const w = playing(2)
    setIt(w, 1)
    parkAway(w, 1)
    stage(w, 0)
    const inputs = new Uint8Array(MAX_PLAYERS)
    pressIn(w, inputs)
    assert.equal(w.hiddenIn[0], W)

    // Waiting predator right at the exit tile.
    w.x[1] = wardrobeExitX(w.map, W)
    w.y[1] = wardrobeExitY(w.map, W)
    w.vx[1] = 0
    w.vy[1] = 0

    // Hold still past the door-shut delay, then step out — into a predator who lunges.
    inputs[0] = 0
    for (let t = 0; t < 12; t++) stepWorld(w, inputs)
    inputs[0] = inward(w) // any movement input exits
    let tagged = false
    for (let t = 0; t < 6 && !tagged; t++) {
      inputs[1] = encodeInput(w.x[0]! - w.x[1]!, w.y[0]! - w.y[1]!) // It chases
      tagged = stepWorld(w, inputs).tagCount > 0
    }
    assert.equal(w.hiddenIn[0], NO_SLOT, 'should have stepped out')
    assert.ok(tagged, 'stepping out beside a waiting It must be a catch — no exit immunity')
    assert.equal(w.turningSlot, 0, 'the caught hider begins metamorphosing')
  })

  it('evicts after the maximum hide time', () => {
    const w = playing(2)
    setIt(w, 1)
    parkAway(w, 1)
    stage(w, 0)
    const inputs = new Uint8Array(MAX_PLAYERS)
    pressIn(w, inputs)
    assert.equal(w.hiddenIn[0], W)

    inputs[0] = 0 // never asks to leave
    const maxTicks = Math.ceil(WARDROBE_MAX_HIDE_MS / TICK_MS)
    for (let t = 0; t <= maxTicks + 1; t++) stepWorld(w, inputs)
    assert.equal(w.hiddenIn[0], NO_SLOT, 'the door should have swung open on its own')
  })

  it('enforces the 20s per-wardrobe cooldown, but leaves other wardrobes usable', () => {
    const w = playing(2)
    setIt(w, 1)
    parkAway(w, 1)
    stage(w, 0)
    const inputs = new Uint8Array(MAX_PLAYERS)
    pressIn(w, inputs)
    assert.equal(w.hiddenIn[0], W)

    // Leave (the exit itself sets the 20s cooldown), then immediately try to re-enter.
    inputs[0] = 0
    for (let t = 0; t < 12; t++) stepWorld(w, inputs)
    inputs[0] = inward(w)
    stepWorld(w, inputs) // exit
    assert.equal(w.hiddenIn[0], NO_SLOT)
    assert.ok(
      w.wardrobeCooldownUntil[0 * MAX_WARDROBES + W]! > w.tick,
      'exit should have armed the cooldown',
    )
    inputs[0] = inward(w)
    for (let t = 0; t < 10; t++) stepWorld(w, inputs)
    assert.equal(w.hiddenIn[0], NO_SLOT, 're-entered inside the cooldown window')
    inputs[0] = 0

    // A different wardrobe accepts immediately.
    const other = 1
    w.keys[0 * MAX_WARDROBES + other] = 1
    w.x[0] = wardrobeExitX(w.map, other)
    w.y[0] = wardrobeExitY(w.map, other)
    w.vx[0] = 0
    w.vy[0] = 0
    inputs[0] = encodeInput(
      wardrobeCenterX(w.map, other) - w.x[0]!,
      wardrobeCenterY(w.map, other) - w.y[0]!,
    )
    for (let t = 0; t < 8 && w.hiddenIn[0] === NO_SLOT; t++) stepWorld(w, inputs)
    assert.equal(w.hiddenIn[0], other, 'a different wardrobe should accept during the cooldown')
  })

  it('cooldown expires after 20 seconds', () => {
    const w = playing(2)
    setIt(w, 1) // the lone-player version made the hider "It", who can never hide
    parkAway(w, 1)
    stage(w, 0)
    const cooldownTicks = Math.ceil(WARDROBE_COOLDOWN_MS / TICK_MS)
    w.wardrobeCooldownUntil[0 * MAX_WARDROBES + W] = w.tick + cooldownTicks
    const inputs = new Uint8Array(MAX_PLAYERS)
    for (let t = 0; t < cooldownTicks + 1; t++) stepWorld(w, inputs)
    stage(w, 0)
    pressIn(w, inputs)
    assert.equal(w.hiddenIn[0], W, 'cooldown should have expired')
  })

  it('every map wardrobe is reachable: exit tile is open and adjacent', () => {
    for (const map of MAPS) {
      const count = map.wardrobes.length / 4
      for (let i = 0; i < count; i++) {
        const dx = Math.abs(map.wardrobes[i * 4]! - map.wardrobes[i * 4 + 2]!)
        const dy = Math.abs(map.wardrobes[i * 4 + 1]! - map.wardrobes[i * 4 + 3]!)
        assert.equal(dx + dy, 1, `${map.name} wardrobe ${i}: exit not adjacent`)
      }
    }
  })
})
