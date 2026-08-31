import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAP_TILE,
  MAX_PLAYERS,
  PORTAL_COOLDOWN_MS,
  TICK_MS,
  TOOL_WEB,
  MAX_DEPLOYED,
  ECHO_BODIES_PER_PLAYER,
} from '../constants.ts'
import { NO_SLOT, RoundPhase } from '../types.ts'
import { queueAbility } from './monster.ts'
import { enterPhase, stepWorld } from './step.ts'
import { enterTurning, setIt } from './tag.ts'
import { addPlayer, createWorld, type World } from './world.ts'

/**
 * The themed-world mechanics: portals, nest spiders, the spider's web, the alien's beam,
 * and the no-trail rule on ability-monster maps. Same style as mechanics.test.ts: park
 * players at authored tiles, run ticks, assert what the rules promise.
 */

const playing = (n: number, mapIndex: number, seed = 33): World => {
  const w = createWorld(seed, mapIndex)
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

describe('portals', () => {
  it('teleports a player standing on a pad to its twin, then cools down', () => {
    const w = playing(2, 0) // Foundry: pads at (20,5) <-> (19,16)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 30, 11)
    park(w, 1, 20.5, 5.5) // dead centre of the pad
    stepWorld(w, inputs)
    assert.equal(Math.round(w.x[1]! / MAP_TILE - 0.5), 19, 'warped to the twin pad (x)')
    assert.equal(Math.round(w.y[1]! / MAP_TILE - 0.5), 16, 'warped to the twin pad (y)')
    assert.equal(w.events.portalUsed, 1, 'the warp reports itself')

    // Standing on the destination pad must NOT bounce straight back.
    const beforeX = w.x[1]!
    stepWorld(w, inputs)
    assert.equal(w.x[1], beforeX, 'cooldown holds the player put')

    // After the cooldown, the pad works again.
    for (let t = 0; t < Math.ceil(PORTAL_COOLDOWN_MS / TICK_MS) + 1; t++) stepWorld(w, inputs)
    assert.equal(Math.round(w.x[1]! / MAP_TILE - 0.5), 20, 'the pair is two-way once warm')
  })
})

describe('lair grabbers (nest spiders / hive UFOs)', () => {
  /** Steps until the grabber catches slot `victim`; returns the tick count, or -1. */
  const runUntilCaught = (w: ReturnType<typeof playing>, inputs: Uint8Array, victim: number, max = 60): number => {
    for (let t = 0; t < max; t++) {
      const ev = stepWorld(w, inputs)
      if (ev.hazardCaught === victim) return t
    }
    return -1
  }

  it('HOLDS a lingering runner — no score charge, input dead, dragged toward the lair', () => {
    const w = playing(2, 1) // Pillars: nests at (9,16), (37,15), (20,17)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 20, 2) // the monster, far away — grabbers ignore it anyway
    park(w, 1, 36, 15) // inside the (37,15) nest's territory
    assert.ok(runUntilCaught(w, inputs, 1) >= 0, 'the grabber catches a lingering runner')
    assert.notEqual(w.heldByNest[1], NO_SLOT, 'the victim is held, not killed')
    const nest = w.heldByNest[1]!

    // Held: pinned to the grabber, immobile, and NOT charged any It-time.
    inputs[1] = 8 | (3 << 4) // they mash west — it feeds the struggle, not movement
    stepWorld(w, inputs)
    assert.equal(w.x[1], w.nestX[nest], 'pinned to the grabber (x)')
    assert.equal(w.y[1], w.nestY[nest], 'pinned to the grabber (y)')
    assert.equal(w.itTimeMs[1], 0, 'being held costs no score-time')

    // The hold breaks; struggling makes it brief. Escape grants a breath of immunity.
    let freedAfter = -1
    for (let t = 0; t < 200 && freedAfter < 0; t++) {
      stepWorld(w, inputs)
      if (w.heldByNest[1] === NO_SLOT) freedAfter = t
    }
    assert.ok(freedAfter >= 0, 'the victim struggles free')
    assert.ok(w.tick < w.immuneUntilTick[1]!, 'escape immunity granted')
    assert.equal(w.itTimeMs[1], 0, 'still no score charge after the escape')
  })

  it('struggling frees you roughly twice as fast as going limp', () => {
    const hold = (struggle: boolean): number => {
      const w = playing(2, 1)
      const inputs = new Uint8Array(MAX_PLAYERS)
      setIt(w, 0)
      park(w, 0, 20, 2)
      park(w, 1, 36, 15)
      assert.ok(runUntilCaught(w, inputs, 1) >= 0)
      inputs[1] = struggle ? 8 | (3 << 4) : 0
      let held = 0
      while (w.heldByNest[1] !== NO_SLOT && held < 300) {
        stepWorld(w, inputs)
        held++
      }
      return held
    }
    const limp = hold(false)
    const fighting = hold(true)
    assert.ok(fighting < limp * 0.65, `struggling (${fighting} ticks) beats limp (${limp} ticks)`)
  })

  it('holds ONE victim at a time — the second runner stays free', () => {
    const w = playing(3, 1)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 20, 2)
    park(w, 1, 36, 15) // both runners inside the same territory
    park(w, 2, 37, 14)
    let caught = NO_SLOT
    for (let t = 0; t < 60 && caught === NO_SLOT; t++) {
      const ev = stepWorld(w, inputs)
      if (ev.hazardCaught !== NO_SLOT) caught = ev.hazardCaught
    }
    assert.notEqual(caught, NO_SLOT, 'someone got grabbed')
    const other = caught === 1 ? 2 : 1
    for (let t = 0; t < 20; t++) stepWorld(w, inputs)
    assert.equal(w.heldByNest[other], NO_SLOT, 'the grabber has only two hands')
  })

  it('releases its victim the moment the monster takes them', () => {
    const w = playing(2, 1)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 20, 2)
    park(w, 1, 36, 15)
    assert.ok(runUntilCaught(w, inputs, 1) >= 0)
    const nest = w.heldByNest[1]!
    // The ghost reaches the pinned victim: the tag starts their metamorphosis.
    enterTurning(w, 1)
    stepWorld(w, inputs)
    assert.equal(w.heldByNest[1], NO_SLOT, 'the grabber wants prey, not a peer')
    assert.notEqual(w.nestState[nest], 4, 'the hold ended')
  })

  it('ignores the It entirely', () => {
    const w = playing(2, 1)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 1)
    park(w, 0, 3, 2) // human far away
    park(w, 1, 36, 15) // the MONSTER stands in the territory
    for (let t = 0; t < 60; t++) {
      const ev = stepWorld(w, inputs)
      assert.equal(ev.hazardCaught, NO_SLOT, 'monsters are not prey')
    }
    assert.equal(w.itTimeMs[1]! > 0, true, 'still accruing It-time, unharmed')
  })

  it('the hive has UFO lairs with the same rules', () => {
    const w = playing(2, 3) // Warrens: UFO anchors at (20,4) and (20,18)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 3, 19)
    park(w, 1, 20, 4.8) // under the (20,4) saucer
    assert.ok(runUntilCaught(w, inputs, 1) >= 0, 'the tractor beam catches a wanderer')
    assert.notEqual(w.heldByNest[1], NO_SLOT)
    assert.equal(w.itTimeMs[1], 0, 'abduction costs no score-time either')
  })
})

describe('spider web', () => {
  it('roots the runner it hits and splats a web patch', () => {
    const w = playing(2, 2) // Serpentine: the spider map
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 10, 2)
    park(w, 1, 14, 2) // four tiles east, same lane
    w.facing[0] = 0 // aim east
    // Fresh spawn immunity must lapse before webs count.
    w.immuneUntilTick[1] = 0
    queueAbility(w, 0)
    let rooted = -1
    for (let t = 0; t < 30 && rooted < 0; t++) {
      stepWorld(w, inputs)
      if (w.tick < w.slowedUntilTick[1]!) rooted = t
    }
    assert.ok(rooted >= 0, 'the web roots the runner')
    let patches = 0
    for (let d = 0; d < MAX_DEPLOYED; d++) if (w.depType[d] === TOOL_WEB) patches++
    assert.ok(patches >= 1, 'a web patch lingers where it landed')
  })

  it('leaves no echo trail on the spider map', () => {
    const w = playing(2, 2)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 10, 2)
    park(w, 1, 30, 19)
    inputs[0] = 0x30 // run east at full speed
    for (let t = 0; t < 70; t++) stepWorld(w, inputs)
    let live = 0
    for (let k = 0; k < ECHO_BODIES_PER_PLAYER; k++) live += w.bodyLive[0 * ECHO_BODIES_PER_PLAYER + k]!
    assert.equal(live, 0, 'the spider hunts with webs, not a trail')
  })
})

describe('closed doors block monster weapons', () => {
  it('a web splats against a shut door instead of flying through it', () => {
    const w = playing(2, 2) // Serpentine: door at (15,4) spans (15,4)+(16,4), axis 0
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 15.5, 6.5) // south of the door, outside its 130-unit trigger
    park(w, 1, 15.5, 2.5) // north of the door — sheltered while it stays shut
    w.facing[0] = -Math.PI / 2 // aim north, straight at the doorway
    w.immuneUntilTick[1] = 0
    queueAbility(w, 0)
    for (let t = 0; t < 30; t++) stepWorld(w, inputs)
    assert.equal(w.tick < w.slowedUntilTick[1]!, false, 'the shut door shielded the runner')
    let patches = 0
    for (let d = 0; d < MAX_DEPLOYED; d++) if (w.depType[d] === TOOL_WEB) patches++
    assert.ok(patches >= 1, 'the web splats where the door stopped it')
  })

  it('a beam stops at a shut door', () => {
    const w = playing(2, 3) // Warrens: door at (8,3) spans (8,3)+(8,4), axis 1
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 5.5, 3.5) // west of the door, outside its trigger radius
    park(w, 1, 11.5, 3.5) // east of the door, on the beam line
    w.facing[0] = 0
    w.immuneUntilTick[1] = 0
    queueAbility(w, 0)
    for (let t = 0; t < 30; t++) stepWorld(w, inputs)
    assert.equal(w.tick < w.unconsciousUntilTick[1]!, false, 'the shut door absorbed the beam')
  })
})

describe('beam edge cases', () => {
  it('a trapped alien mid-charge fires nothing', () => {
    const w = playing(2, 3)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 10, 3)
    park(w, 1, 13, 3)
    w.facing[0] = 0
    w.immuneUntilTick[1] = 0
    queueAbility(w, 0)
    stepWorld(w, inputs)
    assert.equal(w.beamPhase, 1)
    w.unconsciousUntilTick[0] = w.tick + 100 // a trap springs on the charging alien
    for (let t = 0; t < 20; t++) stepWorld(w, inputs)
    assert.equal(w.beamPhase, 0, 'the charge died with the faint')
    assert.equal(w.tick < w.unconsciousUntilTick[1]!, false, 'nobody was hit')
  })
})

describe('alien beam', () => {
  it('charges, then knocks out everyone on the line', () => {
    const w = playing(3, 3) // Warrens: the alien map
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 10, 3)
    park(w, 1, 13, 3) // on the beam line
    park(w, 2, 13, 19) // far off the line
    w.facing[0] = 0 // aim east
    w.immuneUntilTick[1] = 0
    w.immuneUntilTick[2] = 0
    queueAbility(w, 0)

    // During the charge nobody is harmed yet.
    stepWorld(w, inputs)
    assert.equal(w.beamPhase, 1, 'the beam telegraphs its charge')
    assert.equal(w.tick < w.unconsciousUntilTick[1]!, false, 'no harm mid-charge')

    let downAt = -1
    for (let t = 0; t < 30 && downAt < 0; t++) {
      stepWorld(w, inputs)
      if (w.tick < w.unconsciousUntilTick[1]!) downAt = t
    }
    assert.ok(downAt >= 0, 'the fired beam floors the runner on the line')
    assert.equal(w.tick < w.unconsciousUntilTick[2]!, false, 'off the line, untouched')
  })
})
