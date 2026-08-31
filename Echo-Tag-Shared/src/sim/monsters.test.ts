import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAP_TILE,
  MAX_PLAYERS,
  NEST_PENALTY_MS,
  PORTAL_COOLDOWN_MS,
  TICK_MS,
  TOOL_WEB,
  MAX_DEPLOYED,
  ECHO_BODIES_PER_PLAYER,
} from '../constants.ts'
import { NO_SLOT, RoundPhase } from '../types.ts'
import { queueAbility } from './monster.ts'
import { enterPhase, stepWorld } from './step.ts'
import { setIt } from './tag.ts'
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

describe('nest spiders', () => {
  it('catches a runner who lingers in the territory: penalty, far respawn, immunity', () => {
    const w = playing(2, 1) // Pillars: nests at (9,16), (37,15), (20,17)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 0)
    park(w, 0, 20, 2) // the monster, far away — spiders ignore it anyway
    park(w, 1, 36, 15) // inside the (37,15) nest's territory
    const nestX = MAP_TILE * 37.5
    const nestY = MAP_TILE * 15.5

    let killedAt = -1
    for (let t = 0; t < 80 && killedAt < 0; t++) {
      const ev = stepWorld(w, inputs)
      if (ev.hazardKill === 1) killedAt = t
    }
    assert.ok(killedAt >= 0, 'the spider catches a lingering runner')
    assert.equal(w.itTimeMs[1], NEST_PENALTY_MS, 'the kill costs score-time')
    const dx = w.x[1]! - nestX
    const dy = w.y[1]! - nestY
    assert.ok(Math.sqrt(dx * dx + dy * dy) > 1000, 'respawned far from the nest')
    assert.ok(w.tick < w.immuneUntilTick[1]!, 'respawn immunity granted')
  })

  it('ignores the It entirely', () => {
    const w = playing(2, 1)
    const inputs = new Uint8Array(MAX_PLAYERS)
    setIt(w, 1)
    park(w, 0, 3, 2) // human far away
    park(w, 1, 36, 15) // the MONSTER stands in the territory
    for (let t = 0; t < 60; t++) {
      const ev = stepWorld(w, inputs)
      assert.equal(ev.hazardKill, NO_SLOT, 'monsters are not prey')
    }
    assert.equal(w.itTimeMs[1]! > 0, true, 'still accruing It-time, unharmed')
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
