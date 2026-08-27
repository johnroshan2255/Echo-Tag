import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  GOO_LIFE_MS,
  GOO_SLOW_MULT,
  MAX_PLAYERS,
  MAX_TOOL_SPAWNS,
  PLAYER_SPEED,
  TICK_MS,
  TOOL_GOO,
  TOOL_NONE,
  TOOL_SLOTS,
  TOOL_TRAP,
  TRAP_ARM_MS,
  UNCONSCIOUS_MS,
} from '../constants.ts'
import { MAP_TILE } from '../constants.ts'
import { RoundPhase } from '../types.ts'
import { encodeInput } from './input.ts'
import { enterPhase, stepWorld } from './step.ts'
import { setIt } from './tag.ts'
import { queueToolUse } from './tools.ts'
import { addPlayer, createWorld, type World } from './world.ts'

const EAST = encodeInput(1, 0)
const ARM_TICKS = Math.ceil(TRAP_ARM_MS / TICK_MS)
const KO_TICKS = Math.ceil(UNCONSCIOUS_MS / TICK_MS)

const playing = (n: number, seed = 5): World => {
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
  const base = slot * 60
  w.histX.fill(w.x[slot]!, base, base + 60)
  w.histY.fill(w.y[slot]!, base, base + 60)
}

/** Hands `slot` a tool directly and deploys it where they stand. */
const deployAt = (w: World, inputs: Uint8Array, slot: number, type: number, tx: number, ty: number): number => {
  park(w, slot, tx, ty)
  w.held[slot * TOOL_SLOTS] = type
  queueToolUse(w, slot, 0)
  stepWorld(w, inputs)
  for (let d = 0; d < 8; d++) if (w.depType[d] === type) return d
  return -1
}

describe('tools', () => {
  it('spawns tool pickups on the floor with valid types, nobody holding any', () => {
    const w = playing(4)
    for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
      assert.equal(w.toolTaken[i], 0, `tool ${i} should start on the floor`)
      assert.ok(w.toolType[i] === TOOL_GOO || w.toolType[i] === TOOL_TRAP, `tool ${i} has no type`)
    }
    for (let s = 0; s < 4; s++) {
      assert.equal(w.held[s * TOOL_SLOTS], TOOL_NONE)
      assert.equal(w.held[s * TOOL_SLOTS + 1], TOOL_NONE)
    }
  })

  it('walking over a tool claims it into a free hand — two hands max, ghost excluded', () => {
    const w = playing(3)
    setIt(w, 2)
    park(w, 2, 20, 11)
    const inputs = new Uint8Array(MAX_PLAYERS)

    w.x[0] = w.toolX[0]!
    w.y[0] = w.toolY[0]!
    stepWorld(w, inputs)
    assert.equal(w.held[0 * TOOL_SLOTS], w.toolType[0], 'first tool should land in hand A')
    assert.equal(w.toolTaken[0], 1)

    w.x[0] = w.toolX[1]!
    w.y[0] = w.toolY[1]!
    stepWorld(w, inputs)
    assert.equal(w.held[0 * TOOL_SLOTS + 1], w.toolType[1], 'second tool should land in hand B')

    w.x[0] = w.toolX[2]!
    w.y[0] = w.toolY[2]!
    stepWorld(w, inputs)
    assert.equal(w.toolTaken[2], 0, 'a third tool must stay on the floor — hands are full')

    // The ghost walks over a tool: nothing happens.
    w.x[2] = w.toolX[2]!
    w.y[2] = w.toolY[2]!
    w.vx[2] = 0
    w.vy[2] = 0
    for (let t = 0; t < 5; t++) stepWorld(w, inputs)
    assert.equal(w.toolTaken[2], 0, 'the ghost claimed a tool')
  })

  it('goo slows everyone else who crosses the puddle — never its owner', () => {
    const w = playing(3)
    setIt(w, 2)
    park(w, 2, 20, 11)
    const inputs = new Uint8Array(MAX_PLAYERS)
    const d = deployAt(w, inputs, 0, TOOL_GOO, 6, 6.5)
    assert.ok(d >= 0, 'the goo should have deployed')
    assert.equal(w.held[0 * TOOL_SLOTS], TOOL_NONE, 'the jar is spent on use')

    // The owner stands in their own puddle at full speed; a rival wades through slowed.
    park(w, 1, 3, 6.5)
    inputs[0] = EAST
    inputs[1] = EAST
    const x0 = w.x[0]!
    const x1 = w.x[1]!
    for (let t = 0; t < 30; t++) stepWorld(w, inputs)
    const owner = w.x[0]! - x0
    const rival = w.x[1]! - x1
    assert.ok(owner > PLAYER_SPEED * 1.2, `owner slowed by own goo (${owner.toFixed(0)}wu in 1.5s)`)
    assert.ok(
      rival < owner * (GOO_SLOW_MULT + 0.25),
      `rival not slowed crossing the puddle (${rival.toFixed(0)} vs owner ${owner.toFixed(0)})`,
    )
  })

  it('goo dries up after its lifetime', () => {
    const w = playing(2)
    setIt(w, 1)
    park(w, 1, 20, 11)
    const inputs = new Uint8Array(MAX_PLAYERS)
    const d = deployAt(w, inputs, 0, TOOL_GOO, 6, 6.5)
    for (let t = 0; t <= Math.ceil(GOO_LIFE_MS / TICK_MS) + 1; t++) stepWorld(w, inputs)
    assert.equal(w.depType[d], TOOL_NONE, 'the puddle should have dried up')
  })

  it('a trap arms, knocks the first other body out cold, and is consumed — even the ghost', () => {
    const w = playing(2)
    setIt(w, 1)
    park(w, 1, 20, 11)
    const inputs = new Uint8Array(MAX_PLAYERS)
    const d = deployAt(w, inputs, 0, TOOL_TRAP, 6, 6.5)
    assert.ok(d >= 0)

    // The owner stands ON the trap through arming and beyond: never triggers it.
    for (let t = 0; t < ARM_TICKS + 10; t++) stepWorld(w, inputs)
    assert.equal(w.depType[d], TOOL_TRAP, 'the trap sprang on its own owner')
    assert.ok(w.tick >= w.unconsciousUntilTick[0]!, 'the owner was knocked out by their own trap')

    // The ghost steps onto it: out cold, trap spent.
    w.x[1] = w.depX[d]!
    w.y[1] = w.depY[d]!
    w.vx[1] = 0
    w.vy[1] = 0
    stepWorld(w, inputs)
    assert.ok(w.tick < w.unconsciousUntilTick[1]!, 'the ghost should be out cold')
    assert.equal(w.depType[d], TOOL_NONE, 'a sprung trap is consumed')

    // And it wakes like any faint: no input for the duration, then control returns.
    for (let t = 0; t < KO_TICKS + 2; t++) stepWorld(w, inputs)
    assert.ok(w.tick >= w.unconsciousUntilTick[1]!)
  })

  it('a trap does nothing before it is armed', () => {
    const w = playing(3)
    setIt(w, 2)
    park(w, 2, 20, 11)
    const inputs = new Uint8Array(MAX_PLAYERS)
    const d = deployAt(w, inputs, 0, TOOL_TRAP, 6, 6.5)
    // A rival stands on it immediately — inside the arming window nothing happens.
    park(w, 1, 6, 6.5)
    for (let t = 0; t < ARM_TICKS - 4; t++) {
      stepWorld(w, inputs)
      assert.ok(w.tick >= w.unconsciousUntilTick[1]!, 'trap sprang while still arming')
    }
    // Once armed, standing on it is enough.
    for (let t = 0; t < 8; t++) stepWorld(w, inputs)
    assert.ok(w.tick < w.unconsciousUntilTick[1]!, 'armed trap should have sprung')
    assert.equal(w.depType[d], TOOL_NONE)
  })

  it('the ghost cannot use tools, and an empty hand does nothing', () => {
    const w = playing(2)
    setIt(w, 0)
    park(w, 1, 20, 11)
    const inputs = new Uint8Array(MAX_PLAYERS)
    park(w, 0, 6, 6.5)
    w.held[0 * TOOL_SLOTS] = TOOL_TRAP
    queueToolUse(w, 0, 0)
    stepWorld(w, inputs)
    let deployed = 0
    for (const t of w.depType) if (t !== TOOL_NONE) deployed++
    assert.equal(deployed, 0, 'the ghost deployed a tool')
    assert.equal(w.held[0 * TOOL_SLOTS], TOOL_TRAP, 'the tool must stay in hand')

    // Empty hand: queue a use on the empty slot B — nothing deploys, nothing breaks.
    setIt(w, 1)
    w.tagBackUntilTick = 0
    queueToolUse(w, 0, 1)
    stepWorld(w, inputs)
    deployed = 0
    for (const t of w.depType) if (t !== TOOL_NONE) deployed++
    assert.equal(deployed, 0)
  })
})
