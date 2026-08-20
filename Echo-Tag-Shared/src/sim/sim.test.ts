import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ECHO_BODIES_PER_PLAYER,
  ECHO_DELAY_MS,
  IT_SPEED_MULT,
  MAX_PLAYERS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  ROUND_DURATION_MS,
  TAG_IMMUNITY_MS,
  TICK_MS,
} from '../constants.ts'
import { NO_SLOT, RoundPhase } from '../types.ts'
import { encodeInput, IDLE_INPUT, inputX, inputY } from './input.ts'
import { leaderboard } from './leaderboard.ts'
import { enterPhase, stepWorld } from './step.ts'
import { setIt } from './tag.ts'
import { addPlayer, createWorld, removePlayer, type World } from './world.ts'
import { MAP_TILE } from '../constants.ts'

const EAST = encodeInput(1, 0)
const WEST = encodeInput(-1, 0)

/**
 * A world in Playing with `n` players, ready to receive inputs.
 * Defaults to map 1 (Pillars) — the most open map, so tests that place players by hand can
 * use known-open coordinates: every non-pillar row (e.g. tile rows 2, 6, 11, 16, 20) is
 * open from border to border.
 */
const playing = (n: number, seed = 1, mapIndex = 1): World => {
  const w = createWorld(seed, mapIndex)
  for (let i = 0; i < n; i++) addPlayer(w, false)
  enterPhase(w, RoundPhase.Countdown)
  const inputs = new Uint8Array(MAX_PLAYERS)
  while (w.phase === RoundPhase.Countdown) stepWorld(w, inputs)
  assert.equal(w.phase, RoundPhase.Playing)
  return w
}

const run = (w: World, ticks: number, inputs: Uint8Array): void => {
  for (let t = 0; t < ticks; t++) stepWorld(w, inputs)
}

describe('input codec', () => {
  it('round-trips every direction it can represent', () => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const packed = encodeInput(Math.cos(a), Math.sin(a))
      assert.notEqual(packed, IDLE_INPUT)
      // Decoded heading must match the original to within half a step.
      const decoded = Math.atan2(inputY(packed), inputX(packed))
      const delta = Math.abs(Math.atan2(Math.sin(decoded - a), Math.cos(decoded - a)))
      assert.ok(delta < Math.PI / 16, `direction ${i}: off by ${delta}`)
    }
  })

  it('treats sub-deadzone input as idle', () => {
    assert.equal(encodeInput(0, 0), IDLE_INPUT)
    assert.equal(encodeInput(0.05, 0.05), IDLE_INPUT)
    assert.equal(inputX(IDLE_INPUT), 0)
    assert.equal(inputY(IDLE_INPUT), 0)
  })

  it('fits in one byte', () => {
    for (let i = 0; i < 16; i++) {
      for (const m of [0.3, 0.7, 1]) {
        const a = (i / 16) * Math.PI * 2
        const packed = encodeInput(Math.cos(a) * m, Math.sin(a) * m)
        assert.ok(packed >= 0 && packed <= 255, `packed ${packed} out of byte range`)
      }
    }
  })
})

describe('determinism', () => {
  it('produces bit-identical state from the same seed and inputs', () => {
    const a = playing(8, 99)
    const b = playing(8, 99)
    const inputs = new Uint8Array(MAX_PLAYERS)

    for (let t = 0; t < 400; t++) {
      for (let s = 0; s < MAX_PLAYERS; s++) {
        inputs[s] = encodeInput(Math.cos(t * 0.1 + s), Math.sin(t * 0.13 + s))
      }
      stepWorld(a, inputs)
      stepWorld(b, inputs)
    }

    assert.deepEqual(Array.from(a.x), Array.from(b.x))
    assert.deepEqual(Array.from(a.y), Array.from(b.y))
    assert.deepEqual(Array.from(a.itTimeMs), Array.from(b.itTimeMs))
    assert.equal(a.itSlot, b.itSlot)
    // This is the property client prediction depends on: same rules, same result.
  })
})

describe('echoes', () => {
  it('fills the trail in over exactly the echo delay', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = EAST
    inputs[1] = EAST

    const ticksToFill = ECHO_DELAY_MS / TICK_MS
    let live = 0
    for (const b of w.bodyLive) live += b
    // The Countdown already samples, so some bodies exist — but not all of them.
    assert.ok(live < MAX_PLAYERS * ECHO_BODIES_PER_PLAYER, 'trail should not start full')

    run(w, ticksToFill, inputs)
    live = 0
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < ECHO_BODIES_PER_PLAYER; k++) {
        live += w.bodyLive[s * ECHO_BODIES_PER_PLAYER + k]!
      }
    }
    assert.equal(live, 2 * ECHO_BODIES_PER_PLAYER, 'both trails should be fully populated')
  })

  it('does not weld a player to their own freshest echo', () => {
    // A full lobby, for the largest arena — with a small arena the player would reach the
    // wall inside the measurement window and we would be testing the bounds, not echoes.
    const w = playing(MAX_PLAYERS)
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = EAST

    // Park slot 0 at the west end of Pillars' open row 6 (fully open border to border),
    // and everyone else far away in the open row 2.
    w.x[0] = MAP_TILE * 2
    w.y[0] = MAP_TILE * 6.5
    for (let s = 1; s < MAX_PLAYERS; s++) {
      w.x[s] = w.arenaW - MAP_TILE * 2
      w.y[s] = MAP_TILE * 2.5
    }

    const x0 = w.x[0]!
    run(w, 40, inputs) // 2 seconds of running east
    const travelled = w.x[0]! - x0

    // Two seconds at PLAYER_SPEED, minus the acceleration ramp. If self-collision were
    // trapping the player behind their own tail this would be near zero.
    assert.ok(travelled > PLAYER_SPEED * 1.5, `only travelled ${travelled.toFixed(1)}`)
  })

  it('is purely visual: doubling back through your own trail is unimpeded (ADR 0012)', () => {
    const w = playing(MAX_PLAYERS)
    const inputs = new Uint8Array(MAX_PLAYERS)

    w.x[0] = MAP_TILE * 2
    w.y[0] = MAP_TILE * 6.5
    for (let s = 1; s < MAX_PLAYERS; s++) {
      w.x[s] = w.arenaW - MAP_TILE * 2
      w.y[s] = MAP_TILE * 2.5
    }

    inputs[0] = EAST
    run(w, 60, inputs) // lay down 3 seconds of trail heading east
    const turnX = w.x[0]!

    inputs[0] = WEST
    run(w, 60, inputs) // drive straight back through it

    const backtracked = turnX - w.x[0]!
    const unobstructed = (PLAYER_SPEED * (60 * TICK_MS)) / 1000
    assert.ok(
      backtracked > unobstructed * 0.9,
      `a ghost image blocked movement: went back ${backtracked.toFixed(1)} of ${unobstructed.toFixed(1)}`,
    )
  })

  it('never makes a standing player solid via their own stacked echoes', () => {
    // The old solid-trail rule had an emergent quirk: an idle player's echoes piled on top
    // of them and made their position a de-facto wall. Visual-only trails must not.
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    w.x[0] = MAP_TILE * 4
    w.y[0] = MAP_TILE * 6.5
    w.x[1] = MAP_TILE * 8
    w.y[1] = MAP_TILE * 6.5
    run(w, 80, inputs) // slot 1 stands still long enough to stack a full echo pile

    inputs[0] = EAST
    run(w, 60, inputs)
    assert.ok(
      w.x[0]! > MAP_TILE * 8 + PLAYER_RADIUS * 2,
      `walked into a standing player's echo pile and stuck: x=${w.x[0]!.toFixed(0)}`,
    )
  })
})

describe('tagging', () => {
  it('transfers It on contact and grants the new It immunity', () => {
    const w = playing(2)
    setIt(w, 0)
    // Place them a hair outside tag range, facing each other.
    w.x[0] = w.arenaW / 2
    w.y[0] = w.arenaH / 2
    w.x[1] = w.arenaW / 2 + PLAYER_RADIUS * 2 + 4
    w.y[1] = w.arenaH / 2
    w.immuneUntilTick[1] = 0

    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = EAST
    let tagged = false
    for (let t = 0; t < 20 && !tagged; t++) tagged = stepWorld(w, inputs).tagCount > 0

    assert.ok(tagged, 'It should have caught a stationary neighbour')
    assert.equal(w.itSlot, 1)
    assert.ok(w.immuneUntilTick[1]! > w.tick, 'new It must be briefly untaggable')
  })

  it('blocks an instant tag-back for the full immunity window', () => {
    const w = playing(2)
    setIt(w, 0)
    w.x[0] = w.arenaW / 2
    w.y[0] = w.arenaH / 2
    w.x[1] = w.arenaW / 2 + PLAYER_RADIUS * 2 + 4
    w.y[1] = w.arenaH / 2
    w.immuneUntilTick[1] = 0

    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = EAST
    while (stepWorld(w, inputs).tagCount === 0) {
      /* close the distance */
    }

    const newIt = w.itSlot
    const immunityTicks = Math.ceil(TAG_IMMUNITY_MS / TICK_MS)

    // Both now sit on top of each other; the new It must not be able to tag straight back.
    inputs[0] = IDLE_INPUT
    inputs[1] = IDLE_INPUT
    for (let t = 0; t < immunityTicks - 1; t++) {
      assert.equal(stepWorld(w, inputs).tagCount, 0, `tag-back leaked at tick ${t}`)
      assert.equal(w.itSlot, newIt)
    }
  })

  it('never lets a ghost be tagged — only live players', () => {
    const w = playing(1) // a lone player: every obstacle around them is their own echo
    setIt(w, 0)
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = EAST
    // A lone It surrounded only by its own echoes must never find a tag target.
    for (let t = 0; t < 200; t++) assert.equal(stepWorld(w, inputs).tagCount, 0)
    assert.equal(w.itSlot, 0)
  })

  it('gives It a real but modest speed advantage', () => {
    const w = playing(2)
    setIt(w, 0)
    assert.ok(IT_SPEED_MULT > 1 && IT_SPEED_MULT < 1.3, 'catching must be possible, not certain')
  })
})

describe('scoring', () => {
  it('charges It-time only to the current It, one tick at a time', () => {
    const w = playing(3)
    setIt(w, 1)
    const inputs = new Uint8Array(MAX_PLAYERS)
    // Park them far apart in known-open Pillars tiles so no tag interrupts the measurement.
    // (Tile (1,1) inside the border, the open map centre, and tile (38,20).)
    const m = MAP_TILE * 1.5
    w.x[0] = m
    w.y[0] = m
    w.x[1] = w.arenaW / 2
    w.y[1] = w.arenaH / 2
    w.x[2] = w.arenaW - m
    w.y[2] = w.arenaH - m

    const N = 25
    run(w, N, inputs)

    assert.equal(w.itSlot, 1, 'no tag should have happened')
    assert.equal(w.itTimeMs[1], N * TICK_MS)
    assert.equal(w.itTimeMs[0], 0)
    assert.equal(w.itTimeMs[2], 0)
  })

  it('ranks least It-time first, breaking ties by slot', () => {
    const w = playing(4)
    w.itTimeMs[0] = 5000
    w.itTimeMs[1] = 1000
    w.itTimeMs[2] = 1000
    w.itTimeMs[3] = 0

    const board = leaderboard(w)
    assert.deepEqual(
      board.map((r) => r.slot),
      [3, 1, 2, 0],
    )
    assert.deepEqual(
      board.map((r) => r.rank),
      [1, 2, 3, 4],
    )
  })
})

describe('round lifecycle', () => {
  it('runs for exactly the round duration then shows the leaderboard', () => {
    const w = playing(4)
    const inputs = new Uint8Array(MAX_PLAYERS)
    const expected = ROUND_DURATION_MS / TICK_MS

    let ticks = 0
    while (w.phase === RoundPhase.Playing) {
      stepWorld(w, inputs)
      ticks++
      assert.ok(ticks <= expected + 1, 'round overran its duration')
    }

    assert.equal(ticks, expected)
    assert.equal(w.clockMs, ROUND_DURATION_MS)
    assert.equal(w.phase, RoundPhase.Leaderboard)
  })

  it('freezes everyone when the round ends', () => {
    const w = playing(4)
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs.fill(EAST)
    while (w.phase === RoundPhase.Playing) stepWorld(w, inputs)
    for (let s = 0; s < MAX_PLAYERS; s++) {
      assert.equal(w.vx[s], 0)
      assert.equal(w.vy[s], 0)
    }
  })

  it('starts every round with exactly one It', () => {
    for (let seed = 0; seed < 20; seed++) {
      const w = playing(8, seed)
      assert.notEqual(w.itSlot, NO_SLOT)
      assert.equal(w.active[w.itSlot], 1)
    }
  })
})

describe('arena', () => {
  it('stops a player at an interior wall', () => {
    const w = playing(1) // Pillars
    const inputs = new Uint8Array(MAX_PLAYERS)
    // A pillar occupies tiles x 4-5 of row 3-4. Approach its west face along its row.
    w.x[0] = MAP_TILE * 2.5
    w.y[0] = MAP_TILE * 3.5
    w.vx[0] = 0
    w.vy[0] = 0
    inputs[0] = EAST
    run(w, 60, inputs) // 3 seconds straight at the pillar

    const faceX = MAP_TILE * 4 // west face of the pillar
    assert.ok(
      w.x[0]! <= faceX - PLAYER_RADIUS + 0.1,
      `walked through a wall: x=${w.x[0]!.toFixed(1)}, face at ${faceX}`,
    )
    assert.ok(w.x[0]! > MAP_TILE * 3, 'never approached the wall at all')
  })

  it('slides along a wall instead of sticking to it', () => {
    const w = playing(1) // Pillars
    const inputs = new Uint8Array(MAX_PLAYERS)
    // Run diagonally into the long border wall: the southward component must survive.
    w.x[0] = MAP_TILE * 2
    w.y[0] = MAP_TILE * 6.5
    inputs[0] = encodeInput(-1, 1) // south-west, into the west border
    const y0 = w.y[0]!
    run(w, 30, inputs)
    assert.ok(w.x[0]! >= PLAYER_RADIUS + MAP_TILE - 0.1, 'pushed inside the border wall')
    assert.ok(w.y[0]! - y0 > PLAYER_SPEED * 0.5, `did not slide along the wall: moved ${(w.y[0]! - y0).toFixed(1)}`)
  })

  it('never lets a player leave the bounds', () => {
    const w = playing(12)
    const inputs = new Uint8Array(MAX_PLAYERS)
    // Everyone drives at a wall for 10 seconds.
    for (let t = 0; t < 200; t++) {
      for (let s = 0; s < MAX_PLAYERS; s++) {
        const a = (s / MAX_PLAYERS) * Math.PI * 2
        inputs[s] = encodeInput(Math.cos(a), Math.sin(a))
      }
      stepWorld(w, inputs)
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (w.active[s] === 0) continue
        assert.ok(w.x[s]! >= PLAYER_RADIUS - 0.01, `slot ${s} escaped left: ${w.x[s]}`)
        assert.ok(w.x[s]! <= w.arenaW - PLAYER_RADIUS + 0.01, `slot ${s} escaped right`)
        assert.ok(w.y[s]! >= PLAYER_RADIUS - 0.01, `slot ${s} escaped top`)
        assert.ok(w.y[s]! <= w.arenaH - PLAYER_RADIUS + 0.01, `slot ${s} escaped bottom`)
      }
    }
  })

})

describe('joining and leaving', () => {
  it('gives every player a distinct colour', () => {
    const w = createWorld(3)
    const seen = new Set<number>()
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const slot = addPlayer(w, false)
      assert.notEqual(slot, NO_SLOT)
      assert.ok(!seen.has(w.colorSlot[slot]!), 'colours must be unique — trails identify players')
      seen.add(w.colorSlot[slot]!)
    }
    assert.equal(addPlayer(w, false), NO_SLOT, 'a full room must refuse')
  })

  it('hands It to the least-penalised player when It disconnects', () => {
    const w = playing(3)
    setIt(w, 0)
    w.itTimeMs[1] = 9000
    w.itTimeMs[2] = 500

    removePlayer(w, 0)
    assert.equal(w.itSlot, 2, 'It should pass to whoever has suffered least')
  })

  it('does not drag a departed player trail into a reused slot', () => {
    const w = playing(2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    inputs[0] = EAST
    run(w, 60, inputs)

    removePlayer(w, 0)
    const slot = addPlayer(w, true)
    assert.equal(slot, 0)

    // Every history sample for the reused slot must sit on the new spawn point.
    for (let i = 0; i < 60; i++) {
      assert.equal(w.histX[i], w.x[0])
      assert.equal(w.histY[i], w.y[0])
    }
  })
})
