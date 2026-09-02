import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LEADERBOARD_MS, RoundPhase, createWorld, enterPhase, stepWorld, addPlayer } from '@echo-tag/shared'

/**
 * The shared sim flips Leaderboard→Lobby at exactly LEADERBOARD_MS. This pins that fact,
 * which is why ArenaRoom drives the next round off a wall-clock flag (continueAt) rather
 * than off "phase is still Leaderboard" — otherwise a private room can stall in its lobby.
 */
describe('round flow: leaderboard → lobby handoff', () => {
  it('the sim leaves Leaderboard for Lobby at LEADERBOARD_MS, so the server cannot rely on the phase to still be Leaderboard', () => {
    const w = createWorld(1, 0)
    addPlayer(w, false)
    enterPhase(w, RoundPhase.Leaderboard)
    const inputs = new Uint8Array(12)
    let ticks = 0
    while (w.phase === RoundPhase.Leaderboard && ticks < 100000) {
      stepWorld(w, inputs)
      ticks++
    }
    assert.equal(w.phase, RoundPhase.Lobby, 'ends in Lobby')
    // It transitions right around LEADERBOARD_MS — the same instant the server would fire
    // its own continuation, which is the race the continueAt flag removes.
    assert.ok(ticks * 50 >= LEADERBOARD_MS - 100 && ticks * 50 <= LEADERBOARD_MS + 100, `~LEADERBOARD_MS (${ticks * 50}ms)`)
  })
})
