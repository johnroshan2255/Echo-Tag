import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_PLAYERS } from '../constants.ts'
import { RoundPhase } from '../types.ts'
import { queueAbility } from '../sim/monster.ts'
import { enterPhase, stepWorld } from '../sim/step.ts'
import { setIt } from '../sim/tag.ts'
import { addPlayer, createWorld } from '../sim/world.ts'
import { createSnapshot, readSnapshot, SNAPSHOT_MAX_BYTES, writeSnapshot } from './encode.ts'

/**
 * Wire round-trip: whatever writeSnapshot packs, readSnapshot must unpack — especially
 * now that webs, the beam, nest spiders and the one-tick events sit BETWEEN the doors
 * and the player block, where a single miscounted byte would garble every position.
 */

describe('snapshot codec', () => {
  it('round-trips a live world with nests, webs and a charging beam', () => {
    const w = createWorld(7, 2) // Serpentine: the spider map (webs) — nests come from map 1
    for (let i = 0; i < 5; i++) addPlayer(w, i > 0)
    enterPhase(w, RoundPhase.Countdown)
    const inputs = new Uint8Array(MAX_PLAYERS)
    while (w.phase === RoundPhase.Countdown) stepWorld(w, inputs)
    setIt(w, 0)
    w.facing[0] = 0
    queueAbility(w, 0) // a web shot will be in flight
    inputs[1] = 8 | (3 << 4)
    for (let t = 0; t < 4; t++) stepWorld(w, inputs)

    const buf = new ArrayBuffer(SNAPSHOT_MAX_BYTES)
    const len = writeSnapshot(w, w.map.index, new DataView(buf))
    assert.ok(len <= SNAPSHOT_MAX_BYTES, `snapshot ${len}B exceeds SNAPSHOT_MAX_BYTES`)

    const snap = createSnapshot()
    readSnapshot(new DataView(buf, 0, len), snap)

    assert.equal(snap.tick, w.tick)
    assert.equal(snap.phase, w.phase)
    assert.equal(snap.itSlot, w.itSlot)
    assert.equal(snap.mapIndex, w.map.index)
    for (let s = 0; s < MAX_PLAYERS; s++) {
      assert.equal(snap.active[s], w.active[s], `active[${s}]`)
      if (w.active[s] === 0) continue
      assert.equal(snap.x[s], Math.round(w.x[s]!), `x[${s}]`)
      assert.equal(snap.y[s], Math.round(w.y[s]!), `y[${s}]`)
      assert.equal(snap.isBot[s], w.isBot[s], `isBot[${s}]`)
    }
    // The web shot fired above must have crossed the wire.
    let liveWebs = 0
    for (let i = 0; i < w.webUntilTick.length; i++) if (w.webUntilTick[i]! > w.tick) liveWebs++
    assert.equal(snap.webCount, liveWebs, 'web shots survive the wire')
    assert.equal(snap.abilityCdTicks, Math.min(255, Math.max(0, w.abilityReadyTick - w.tick)))
  })

  it('round-trips lair grabbers, the held victim, and one-tick events', () => {
    const w = createWorld(9, 1) // Pillars: three nests
    addPlayer(w, false)
    addPlayer(w, false)
    enterPhase(w, RoundPhase.Countdown)
    const inputs = new Uint8Array(MAX_PLAYERS)
    while (w.phase === RoundPhase.Countdown) stepWorld(w, inputs)
    setIt(w, 0)
    // Park the runner in a nest territory and step until the grabber CATCHES them — the
    // event and the held-slot must ride the very snapshots written those ticks.
    w.x[1] = 36 * 80
    w.y[1] = 15 * 80
    const buf = new ArrayBuffer(SNAPSHOT_MAX_BYTES)
    const snap = createSnapshot()
    let sawCatch = false
    let sawHeld = false
    for (let t = 0; t < 120 && !(sawCatch && sawHeld); t++) {
      stepWorld(w, inputs)
      const len = writeSnapshot(w, w.map.index, new DataView(buf))
      readSnapshot(new DataView(buf, 0, len), snap)
      assert.equal(snap.nestCount, w.map.nests.length / 2)
      for (let n = 0; n < snap.nestCount; n++) {
        assert.equal(snap.nestX[n], Math.round(w.nestX[n]!), `nestX[${n}] at t=${t}`)
        assert.equal(snap.nestState[n], w.nestState[n], `nestState[${n}] at t=${t}`)
        if (snap.nestState[n] === 4) {
          assert.equal(snap.nestHeld[n], w.nestTarget[n], `nestHeld[${n}] at t=${t}`)
          if (snap.nestHeld[n] === 1) sawHeld = true
        }
      }
      if (snap.hazardCaught === 1) sawCatch = true
      // Player positions must stay intact on every tick regardless of grabber churn.
      assert.equal(snap.x[0], Math.round(w.x[0]!))
      assert.equal(snap.y[1], Math.round(w.y[1]!))
    }
    assert.ok(sawCatch, 'the catch event crosses the wire on its tick')
    assert.ok(sawHeld, 'the held slot crosses the wire while the grip lasts')
  })
})
