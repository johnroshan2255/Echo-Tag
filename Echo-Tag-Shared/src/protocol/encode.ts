import { MAX_DOORS, MAX_PLAYERS, MAX_WARDROBES } from '../constants.ts'
import { NO_SLOT } from '../types.ts'
import type { World } from '../sim/world.ts'

/**
 * The snapshot codec — the hot state, hand-packed (docs/adr/0004).
 *
 * Positions are the only high-frequency truth: echoes are derived client-side from the
 * position stream, doors and hiding states are single bytes, and velocities are
 * reconstructed from position deltas. One snapshot for a full 12-player room is ~90 bytes;
 * at 20Hz that is ~1.8KB/s per client.
 *
 * Layout (little-endian):
 *   u32 tick
 *   u8  phase
 *   u32 clockMs
 *   i8  itSlot
 *   u8  mapIndex
 *   u8  doorCount     then per door: u8 openness (0..255)
 *   u8  playerCount   then per player:
 *     u8  slot
 *     i16 x, i16 y    (quantised world units — invisible at our zoom)
 *     u8  flags       bit0 immune · bit1 isBot · bit2 hidden · bits 3-5 wardrobe index
 *
 * Both sides share this file, so the format cannot drift between them.
 */

export const SNAPSHOT_MAX_BYTES = 12 + MAX_DOORS + 1 + MAX_PLAYERS * 6

export const writeSnapshot = (w: World, mapIndex: number, out: DataView): number => {
  out.setUint32(0, w.tick, true)
  out.setUint8(4, w.phase)
  out.setUint32(5, w.clockMs, true)
  out.setInt8(9, w.itSlot)
  out.setUint8(10, mapIndex)

  const doorCount = w.map.doors.length / 3
  out.setUint8(11, doorCount)
  let o = 12
  for (let d = 0; d < doorCount; d++) {
    out.setUint8(o++, Math.round(w.doorOpen[d]! * 255))
  }

  const countAt = o++
  let n = 0
  for (let s = 0; s < MAX_PLAYERS; s++) {
    if (w.active[s] === 0) continue
    out.setUint8(o, s)
    out.setInt16(o + 1, Math.round(w.x[s]!), true)
    out.setInt16(o + 3, Math.round(w.y[s]!), true)
    const hidden = w.hiddenIn[s]! !== NO_SLOT
    out.setUint8(
      o + 5,
      (w.tick < w.immuneUntilTick[s]! ? 1 : 0) |
        (w.isBot[s] === 1 ? 2 : 0) |
        (hidden ? 4 : 0) |
        ((hidden ? w.hiddenIn[s]! & 0x07 : 0) << 3),
    )
    o += 6
    n++
  }
  out.setUint8(countAt, n)
  return o
}

export interface Snapshot {
  tick: number
  phase: number
  clockMs: number
  itSlot: number
  mapIndex: number
  doorOpen: Float32Array
  doorCount: number
  /** Dense per-slot arrays; inactive slots read active=0. */
  active: Uint8Array
  x: Float32Array
  y: Float32Array
  immune: Uint8Array
  isBot: Uint8Array
  hiddenIn: Int8Array
}

/** A reusable snapshot holder — decode into it, never allocate per packet. */
export const createSnapshot = (): Snapshot => ({
  tick: 0,
  phase: 0,
  clockMs: 0,
  itSlot: NO_SLOT,
  mapIndex: 0,
  doorOpen: new Float32Array(MAX_DOORS),
  doorCount: 0,
  active: new Uint8Array(MAX_PLAYERS),
  x: new Float32Array(MAX_PLAYERS),
  y: new Float32Array(MAX_PLAYERS),
  immune: new Uint8Array(MAX_PLAYERS),
  isBot: new Uint8Array(MAX_PLAYERS),
  hiddenIn: new Int8Array(MAX_PLAYERS),
})

export const readSnapshot = (src: DataView, into: Snapshot): void => {
  into.tick = src.getUint32(0, true)
  into.phase = src.getUint8(4)
  into.clockMs = src.getUint32(5, true)
  into.itSlot = src.getInt8(9)
  into.mapIndex = src.getUint8(10)

  into.doorCount = src.getUint8(11)
  let o = 12
  for (let d = 0; d < into.doorCount; d++) {
    into.doorOpen[d] = src.getUint8(o++) / 255
  }

  into.active.fill(0)
  const n = src.getUint8(o++)
  for (let i = 0; i < n; i++) {
    const s = src.getUint8(o)
    into.active[s] = 1
    into.x[s] = src.getInt16(o + 1, true)
    into.y[s] = src.getInt16(o + 3, true)
    const flags = src.getUint8(o + 5)
    into.immune[s] = flags & 1 ? 1 : 0
    into.isBot[s] = flags & 2 ? 1 : 0
    into.hiddenIn[s] = flags & 4 ? (flags >> 3) & 0x07 : NO_SLOT
    o += 6
  }
}

/** Own-keys bitmask for the welcome/round messages. */
export const packKeys = (w: World, slot: number): number => {
  let mask = 0
  for (let i = 0; i < MAX_WARDROBES; i++) {
    if (w.keys[slot * MAX_WARDROBES + i] === 1) mask |= 1 << i
  }
  return mask
}
