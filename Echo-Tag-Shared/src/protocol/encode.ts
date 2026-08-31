import { MAX_DEPLOYED, MAX_DOORS, MAX_NESTS, MAX_PLAYERS, MAX_TOOL_SPAWNS, MAX_WARDROBES, MAX_WEB_SHOTS, TOOL_SLOTS } from '../constants.ts'
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
 *   i8  turningSlot   (the metamorphosing player, or -1)
 *   u8  turningTicksLeft (clamped to 255 — clients drive the animation from this)
 *   u16 itAgeTicks    (ticks since the ghost was crowned, clamped — mirrors gate the
 *                      trail on this so a late joiner never renders less trail than
 *                      the server collides with)
 *   u8  keyTaken      bitmask: floor key i has been claimed (spawn positions travel in
 *                      the welcome/round messages; they never move within a round)
 *   u8  toolTaken     bitmask: floor tool i has been claimed (spawns in welcome/round)
 *   u8  depCount      then per deployed tool: u8 (poolIdx<<4 | type), i16 x, i16 y,
 *                      u16 ticksLeft — clients rebuild the pool from this each snapshot
 *   u8  doorCount     then per door: u8 openness (0..255)
 *   u8  webCount      then per live web shot: i16 x, i16 y — the spider's projectiles
 *   u8  beamPhase     0 idle / 1 charging / 2 flash, u8 angle (0..255 → 2π),
 *   u8  beamTicksLeft (charge or flash remaining), u16 beamReach (world units)
 *   u8  abilityCd     ticks until the It's ability is ready, clamped to 255 (HUD)
 *   u8  nestCount     then per nest spider: i16 x, i16 y, u8 state
 *   i8  hazardKill    slot a nest spider killed THIS tick, or -1 (one-tick event)
 *   i8  portalUsed    slot that warped THIS tick, or -1 (one-tick event)
 *   u8  playerCount   then per player:
 *     u8  slot
 *     i16 x, i16 y    (quantised world units — invisible at our zoom)
 *     u8  flags       bit0 immune · bit1 isBot · bit2 hidden · bits 3-5 wardrobe index ·
 *                     bit6 unconscious · bit7 goo-slowed
 *     u8  keys        bitmask of wardrobe keys this player holds (drives the keyhole
 *                     markers, which update live as keys are grabbed)
 *     u8  held        tool inventory, one TOOL_* nibble per hand slot (drives the HUD)
 *
 * Both sides share this file, so the format cannot drift between them.
 */

export const SNAPSHOT_MAX_BYTES =
  18 + MAX_DEPLOYED * 7 + 1 + MAX_DOORS + 1 + MAX_WEB_SHOTS * 4 + 5 + 1 + 1 + MAX_NESTS * 5 + 2 + 1 + MAX_PLAYERS * 8

export const writeSnapshot = (w: World, mapIndex: number, out: DataView): number => {
  out.setUint32(0, w.tick, true)
  out.setUint8(4, w.phase)
  out.setUint32(5, w.clockMs, true)
  out.setInt8(9, w.itSlot)
  out.setUint8(10, mapIndex)
  out.setInt8(11, w.turningSlot)
  out.setUint8(12, w.turningSlot >= 0 ? Math.min(255, Math.max(0, w.turningUntilTick - w.tick)) : 0)
  out.setUint16(13, Math.min(65535, Math.max(0, w.tick - w.itSinceTick)), true)

  let takenMask = 0
  for (let i = 0; i < MAX_WARDROBES; i++) {
    if (w.keyTaken[i] === 1) takenMask |= 1 << i
  }
  out.setUint8(15, takenMask)

  let toolMask = 0
  for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
    if (w.toolTaken[i] === 1) toolMask |= 1 << i
  }
  out.setUint8(16, toolMask)

  const depCountAt = 17
  let o = 18
  let deps = 0
  for (let d = 0; d < MAX_DEPLOYED; d++) {
    if (w.depType[d] === 0) continue
    out.setUint8(o, (d << 4) | w.depType[d]!)
    out.setInt16(o + 1, Math.round(w.depX[d]!), true)
    out.setInt16(o + 3, Math.round(w.depY[d]!), true)
    out.setUint16(o + 5, Math.min(65535, Math.max(0, w.depUntilTick[d]! - w.tick)), true)
    o += 7
    deps++
  }
  out.setUint8(depCountAt, deps)

  const doorCount = w.map.doors.length / 3
  out.setUint8(o++, doorCount)
  for (let d = 0; d < doorCount; d++) {
    out.setUint8(o++, Math.round(w.doorOpen[d]! * 255))
  }

  // Monster weapons: web shots in flight, then the beam's phase/aim/clock/reach.
  const webCountAt = o++
  let webs = 0
  for (let i = 0; i < MAX_WEB_SHOTS; i++) {
    if (w.webUntilTick[i]! <= w.tick) continue
    out.setInt16(o, Math.round(w.webX[i]!), true)
    out.setInt16(o + 2, Math.round(w.webY[i]!), true)
    o += 4
    webs++
  }
  out.setUint8(webCountAt, webs)
  out.setUint8(o++, w.beamPhase)
  out.setUint8(o++, Math.round(((w.beamAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * (255 / (Math.PI * 2))) & 0xff)
  out.setUint8(o++, Math.min(255, Math.max(0, w.beamUntilTick - w.tick)))
  out.setUint16(o, Math.round(w.beamReach), true)
  o += 2
  out.setUint8(o++, Math.min(255, Math.max(0, w.abilityReadyTick - w.tick)))

  // Nest spiders: position + state, so the hazard reads identically on every screen.
  const nestCount = w.map.nests.length / 2
  out.setUint8(o++, nestCount)
  for (let n = 0; n < nestCount; n++) {
    out.setInt16(o, Math.round(w.nestX[n]!), true)
    out.setInt16(o + 2, Math.round(w.nestY[n]!), true)
    out.setUint8(o + 4, w.nestState[n]!)
    o += 5
  }
  out.setInt8(o++, w.events.hazardKill)
  out.setInt8(o++, w.events.portalUsed)

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
        ((hidden ? w.hiddenIn[s]! & 0x07 : 0) << 3) |
        (w.tick < w.unconsciousUntilTick[s]! ? 64 : 0) |
        (w.tick < w.slowedUntilTick[s]! ? 128 : 0),
    )
    out.setUint8(o + 6, packKeys(w, s))
    out.setUint8(o + 7, (w.held[s * TOOL_SLOTS]! & 0x0f) | ((w.held[s * TOOL_SLOTS + 1]! & 0x0f) << 4))
    o += 8
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
  turningSlot: number
  turningTicksLeft: number
  /** Ticks since the current ghost was crowned; gates the trail on mirrors. */
  itAgeTicks: number
  /** Bitmask: floor key i has been claimed. */
  keyTaken: number
  /** Bitmask: floor tool i has been claimed. */
  toolTaken: number
  /** Deployed tools, decoded into fixed pool arrays indexed by pool slot. */
  depType: Uint8Array
  depX: Float32Array
  depY: Float32Array
  depTicksLeft: Uint16Array
  doorOpen: Float32Array
  doorCount: number
  /** Web shots in flight (spider monster). */
  webCount: number
  webX: Float32Array
  webY: Float32Array
  /** Beam (alien monster): 0 idle / 1 charging / 2 flash, aim in radians, ticks left. */
  beamPhase: number
  beamAngle: number
  beamTicksLeft: number
  beamReach: number
  /** Ticks until the It's ability is ready (clamped 0..255) — drives the HUD sweep. */
  abilityCdTicks: number
  /** Nest spiders. */
  nestCount: number
  nestX: Float32Array
  nestY: Float32Array
  nestState: Uint8Array
  /** One-tick events: slot killed by a nest / slot that warped, or NO_SLOT. */
  hazardKill: number
  portalUsed: number
  /** Dense per-slot arrays; inactive slots read active=0. */
  active: Uint8Array
  x: Float32Array
  y: Float32Array
  immune: Uint8Array
  isBot: Uint8Array
  hiddenIn: Int8Array
  unconscious: Uint8Array
  slowed: Uint8Array
  /** Per-slot bitmask of held wardrobe keys. */
  keys: Uint8Array
  /** Per-slot tool inventory: TOOL_* nibble per hand (low = slot A, high = slot B). */
  held: Uint8Array
}

/** A reusable snapshot holder — decode into it, never allocate per packet. */
export const createSnapshot = (): Snapshot => ({
  tick: 0,
  phase: 0,
  clockMs: 0,
  itSlot: NO_SLOT,
  mapIndex: 0,
  turningSlot: NO_SLOT,
  turningTicksLeft: 0,
  itAgeTicks: 0,
  keyTaken: 0,
  toolTaken: 0,
  depType: new Uint8Array(MAX_DEPLOYED),
  depX: new Float32Array(MAX_DEPLOYED),
  depY: new Float32Array(MAX_DEPLOYED),
  depTicksLeft: new Uint16Array(MAX_DEPLOYED),
  doorOpen: new Float32Array(MAX_DOORS),
  doorCount: 0,
  webCount: 0,
  webX: new Float32Array(MAX_WEB_SHOTS),
  webY: new Float32Array(MAX_WEB_SHOTS),
  beamPhase: 0,
  beamAngle: 0,
  beamTicksLeft: 0,
  beamReach: 0,
  abilityCdTicks: 0,
  nestCount: 0,
  nestX: new Float32Array(MAX_NESTS),
  nestY: new Float32Array(MAX_NESTS),
  nestState: new Uint8Array(MAX_NESTS),
  hazardKill: NO_SLOT,
  portalUsed: NO_SLOT,
  active: new Uint8Array(MAX_PLAYERS),
  x: new Float32Array(MAX_PLAYERS),
  y: new Float32Array(MAX_PLAYERS),
  immune: new Uint8Array(MAX_PLAYERS),
  isBot: new Uint8Array(MAX_PLAYERS),
  hiddenIn: new Int8Array(MAX_PLAYERS),
  unconscious: new Uint8Array(MAX_PLAYERS),
  slowed: new Uint8Array(MAX_PLAYERS),
  keys: new Uint8Array(MAX_PLAYERS),
  held: new Uint8Array(MAX_PLAYERS),
})

export const readSnapshot = (src: DataView, into: Snapshot): void => {
  into.tick = src.getUint32(0, true)
  into.phase = src.getUint8(4)
  into.clockMs = src.getUint32(5, true)
  into.itSlot = src.getInt8(9)
  into.mapIndex = src.getUint8(10)
  into.turningSlot = src.getInt8(11)
  into.turningTicksLeft = src.getUint8(12)
  into.itAgeTicks = src.getUint16(13, true)
  into.keyTaken = src.getUint8(15)
  into.toolTaken = src.getUint8(16)

  into.depType.fill(0)
  const depCount = src.getUint8(17)
  let o = 18
  for (let i = 0; i < depCount; i++) {
    const head = src.getUint8(o)
    const idx = (head >> 4) & 0x0f
    into.depType[idx] = head & 0x0f
    into.depX[idx] = src.getInt16(o + 1, true)
    into.depY[idx] = src.getInt16(o + 3, true)
    into.depTicksLeft[idx] = src.getUint16(o + 5, true)
    o += 7
  }

  into.doorCount = src.getUint8(o++)
  for (let d = 0; d < into.doorCount; d++) {
    into.doorOpen[d] = src.getUint8(o++) / 255
  }

  into.webCount = src.getUint8(o++)
  for (let i = 0; i < into.webCount; i++) {
    into.webX[i] = src.getInt16(o, true)
    into.webY[i] = src.getInt16(o + 2, true)
    o += 4
  }
  into.beamPhase = src.getUint8(o++)
  into.beamAngle = (src.getUint8(o++) / 255) * Math.PI * 2
  into.beamTicksLeft = src.getUint8(o++)
  into.beamReach = src.getUint16(o, true)
  o += 2
  into.abilityCdTicks = src.getUint8(o++)

  into.nestCount = src.getUint8(o++)
  for (let n = 0; n < into.nestCount; n++) {
    into.nestX[n] = src.getInt16(o, true)
    into.nestY[n] = src.getInt16(o + 2, true)
    into.nestState[n] = src.getUint8(o + 4)
    o += 5
  }
  into.hazardKill = src.getInt8(o++)
  into.portalUsed = src.getInt8(o++)

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
    into.unconscious[s] = flags & 64 ? 1 : 0
    into.slowed[s] = flags & 128 ? 1 : 0
    into.keys[s] = src.getUint8(o + 6)
    into.held[s] = src.getUint8(o + 7)
    o += 8
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
