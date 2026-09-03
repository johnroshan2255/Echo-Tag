import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DOOR_SOLID_BELOW,
  DOOR_TRIGGER_R,
  MAP_TILE,
  MAX_PLAYERS,
  PLAYER_SPEED,
} from '../constants.ts'
import { doorCenterX, doorCenterY } from '../maps/index.ts'
import { RoundPhase } from '../types.ts'
import { encodeInput } from './input.ts'
import { integratePlayer } from './player.ts'
import { enterPhase, stepWorld } from './step.ts'
import { addPlayer, createWorld, type World } from './world.ts'

/**
 * Door invariants. Doors run on map 0 (Foundry), whose first door sits in the vertical
 * doorway at tiles (12,3)-(12,4) — approached along the open row from either side.
 */

const DOOR = 0

const playing = (n: number): World => {
  const w = createWorld(7, 0)
  for (let i = 0; i < n; i++) addPlayer(w, false)
  enterPhase(w, RoundPhase.Countdown)
  const inputs = new Uint8Array(MAX_PLAYERS)
  while (w.phase === RoundPhase.Countdown) stepWorld(w, inputs)
  return w
}

/** Parks every player far from the door under test. */
const parkAway = (w: World): void => {
  for (let s = 0; s < MAX_PLAYERS; s++) {
    w.x[s] = w.arenaW - MAP_TILE * 2
    w.y[s] = w.arenaH - MAP_TILE * 2
    w.vx[s] = 0
    w.vy[s] = 0
  }
}

describe('doors', () => {
  it('start closed, open on approach, and close after everyone leaves', () => {
    const w = playing(2)
    parkAway(w)
    const inputs = new Uint8Array(MAX_PLAYERS)

    // Drain any openness from spawn positions.
    for (let t = 0; t < 40; t++) stepWorld(w, inputs)
    assert.equal(w.doorOpen[DOOR], 0, 'door should be shut with nobody around')

    // Stand just inside trigger range.
    w.x[0] = doorCenterX(w.map, DOOR) - DOOR_TRIGGER_R + 10
    w.y[0] = doorCenterY(w.map, DOOR)
    for (let t = 0; t < 12; t++) stepWorld(w, inputs)
    assert.equal(w.doorOpen[DOOR], 1, 'door should be fully open after ~0.5s of presence')

    // Leave; door must drift shut.
    parkAway(w)
    for (let t = 0; t < 40; t++) stepWorld(w, inputs)
    assert.equal(w.doorOpen[DOOR], 0, 'door should have closed after everyone left')
  })

  it('blocks a player while closed', () => {
    // Collision is asserted below stepWorld, via integratePlayer directly — a real
    // stepWorld would (correctly) open the door for the approaching player, which is
    // the next test. Here the door is pinned shut to prove the shut state is a wall.
    const w = playing(1)
    parkAway(w)
    const inputs = new Uint8Array(MAX_PLAYERS)
    for (let t = 0; t < 40; t++) stepWorld(w, inputs)

    const cx = doorCenterX(w.map, DOOR)
    const cy = doorCenterY(w.map, DOOR)
    w.x[0] = cx - MAP_TILE * 3
    w.y[0] = cy
    const east = encodeInput(1, 0)
    w.doorOpen[DOOR] = 0
    for (let t = 0; t < 40; t++) integratePlayer(w, 0, east)
    assert.ok(
      w.x[0]! < cx - MAP_TILE / 2,
      `walked through a shut door: x=${w.x[0]!.toFixed(1)}, door at ${cx}`,
    )
  })

  it('lets a player through once open', () => {
    const w = playing(1)
    parkAway(w)
    const inputs = new Uint8Array(MAX_PLAYERS)
    for (let t = 0; t < 40; t++) stepWorld(w, inputs)

    const cx = doorCenterX(w.map, DOOR)
    const cy = doorCenterY(w.map, DOOR)
    w.x[0] = cx - MAP_TILE * 2.5
    w.y[0] = cy
    inputs[0] = encodeInput(1, 0)
    // Walk at the door: it should open on approach and let the player pass.
    const ticks = Math.ceil(((MAP_TILE * 5) / PLAYER_SPEED) * 20) + 30
    for (let t = 0; t < ticks; t++) stepWorld(w, inputs)
    assert.ok(
      w.x[0]! > cx + MAP_TILE / 2,
      `door never let the player through: x=${w.x[0]!.toFixed(1)}, door at ${cx}`,
    )
  })

  it('never closes on a player standing in the frame', () => {
    const w = playing(1)
    parkAway(w)
    const inputs = new Uint8Array(MAX_PLAYERS)
    for (let t = 0; t < 40; t++) stepWorld(w, inputs)

    // Stand exactly in the doorway; give the door its opening ramp first.
    w.x[0] = doorCenterX(w.map, DOOR)
    w.y[0] = doorCenterY(w.map, DOOR)
    for (let t = 0; t < 20; t++) stepWorld(w, inputs)
    assert.equal(w.doorOpen[DOOR], 1, 'door should be fully open around an occupant')

    // From here on it must never drop toward solid while they remain in the frame.
    for (let t = 0; t < 200; t++) {
      stepWorld(w, inputs)
      assert.ok(
        w.doorOpen[DOOR]! >= DOOR_SOLID_BELOW,
        `door went solid around an occupant at tick ${t} (openness ${w.doorOpen[DOOR]})`,
      )
    }
  })
})

describe('doors across rounds', () => {
  it('a new round starts with every door shut, even without a map change', () => {
    // Public rooms keep their map between rounds (matchmaking pooled players INTO it), so
    // the reset must live in the round start itself, not only in setMap().
    const w = createWorld(7, 0)
    addPlayer(w, false)
    w.doorOpen[DOOR] = 1
    enterPhase(w, RoundPhase.Leaderboard)
    enterPhase(w, RoundPhase.Countdown)
    assert.equal(w.doorOpen[DOOR], 0, 'door shut at round start')
  })
})
