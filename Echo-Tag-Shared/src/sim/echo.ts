import {
  ECHO_BODIES_PER_PLAYER,
  ECHO_SAMPLES,
  ECHO_STRIDE,
  MAX_PLAYERS,
} from '../constants.ts'
import { rebuild } from '../math/spatial-hash.ts'
import type { World } from './world.ts'

/**
 * The echo system.
 *
 * An echo is not an entity — it is a *view* of a position ring buffer. Each tick we
 * append every live player's position, then derive the set of solid bodies by walking
 * each ring at `ECHO_STRIDE`. Because the ring rolls, the whole maze shifts every tick
 * with no per-echo state to update, which is exactly the "ghosts are not frozen"
 * behaviour the design calls for (GDD §3.1).
 *
 * It is also why echoes never touch the network (see docs/adr/0004): any client holding
 * the position stream can reconstruct the identical body set.
 *
 * Body ids are stable within a tick: `slot * ECHO_BODIES_PER_PLAYER + k`, where k=0 is
 * the freshest body and k=ECHO_BODIES_PER_PLAYER-1 is the one from 3 seconds ago.
 */

/** Appends the current positions of all live players to the history rings. */
export const sampleHistory = (w: World): void => {
  const head = w.histHead
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    const i = s * ECHO_SAMPLES + head
    w.histX[i] = w.x[s]!
    w.histY[i] = w.y[s]!
  }
  w.histHead = head + 1 === ECHO_SAMPLES ? 0 : head + 1
  if (w.histFilled < ECHO_SAMPLES) w.histFilled++
}

/**
 * Rewrites the derived body arrays and the broadphase from the current rings.
 * Must run after `sampleHistory` and before collision.
 *
 * Only the ghost ("It") gets live bodies: humans leave no active trail. History is still
 * sampled for everyone, but the ghost's trail admits only samples recorded SINCE it was
 * crowned (`itSinceTick`): a new ghost starts with no trail and grows one over 3 seconds,
 * and while someone is turning (`itSlot === NO_SLOT`) the arena holds no hazards at all
 * — the lull plus the ramp is the humans' head start.
 */
export const rebuildEchoBodies = (w: World): void => {
  const head = w.histHead
  const filled = w.histFilled
  // One sample per tick, so sample age and tick age share units.
  const ticksAsIt = w.tick - w.itSinceTick

  for (let s = 0; s < MAX_PLAYERS; s++) {
    const bodyBase = s * ECHO_BODIES_PER_PLAYER
    const histBase = s * ECHO_SAMPLES
    const live = w.active[s] === 1 && s === w.itSlot

    for (let k = 0; k < ECHO_BODIES_PER_PLAYER; k++) {
      const id = bodyBase + k
      // Age in samples: k=0 is one stride behind the write head.
      const age = (k + 1) * ECHO_STRIDE
      if (!live || age > filled || age > ticksAsIt) {
        w.bodyLive[id] = 0
        continue
      }
      // Walk backwards from the head, wrapping within this player's span.
      let idx = head - age
      if (idx < 0) idx += ECHO_SAMPLES
      w.bodyX[id] = w.histX[histBase + idx]!
      w.bodyY[id] = w.histY[histBase + idx]!
      w.bodyLive[id] = 1
      w.bodyOwner[id] = s
      w.bodyAge[id] = age
    }
  }

  rebuild(w.hash, w.bodyX, w.bodyY, w.bodyLive, MAX_PLAYERS * ECHO_BODIES_PER_PLAYER)
}

/**
 * Copies the full history rings into `out` for a one-time join snapshot.
 * Layout: `[histHead:u16][histFilled:u16]` then MAX_PLAYERS * ECHO_SAMPLES pairs of
 * quantised int16 x/y. ~2.9KB — sent once per join so a late arrival sees the same maze.
 */
export const HISTORY_BLOB_BYTES = 4 + MAX_PLAYERS * ECHO_SAMPLES * 4

export const writeHistoryBlob = (w: World, out: DataView): void => {
  out.setUint16(0, w.histHead, true)
  out.setUint16(2, w.histFilled, true)
  let o = 4
  const n = MAX_PLAYERS * ECHO_SAMPLES
  for (let i = 0; i < n; i++) {
    out.setInt16(o, Math.round(w.histX[i]!), true)
    out.setInt16(o + 2, Math.round(w.histY[i]!), true)
    o += 4
  }
}

export const readHistoryBlob = (w: World, src: DataView): void => {
  w.histHead = src.getUint16(0, true)
  w.histFilled = src.getUint16(2, true)
  let o = 4
  const n = MAX_PLAYERS * ECHO_SAMPLES
  for (let i = 0; i < n; i++) {
    w.histX[i] = src.getInt16(o, true)
    w.histY[i] = src.getInt16(o + 2, true)
    o += 4
  }
  rebuildEchoBodies(w)
}
