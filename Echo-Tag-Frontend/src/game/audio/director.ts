import { MAX_DOORS, MAX_PLAYERS, NO_SLOT, doorCenterX, doorCenterY, type World } from '@echo-tag/shared'
import { createAudioEngine, distanceGain, panFor, setMuted, type AudioEngine } from './engine.ts'
import { doorCreak, doorThud, footstep, heartThump, startAmbientBed, tagSting } from './voices.ts'

/**
 * The audio director: decides each frame what the world sounds like from where you stand.
 *
 * Under fog of war, sound is the second sense — most of what it reports is *off-screen*:
 *   - a door creaking in the dark means someone is moving over there (doors are audible
 *     well beyond vision range, on purpose),
 *   - footsteps within earshot let you track a neighbour through a hedge,
 *   - and your heart starts when It is near and beats faster the closer they are — the
 *     scare register of the whole game, tuned to dread rather than fright.
 *
 * Everything is derived from world state transitions; nothing here mutates the world.
 */

const DOOR_EARSHOT = 1100 // world units — you hear doors you cannot see
const STEP_EARSHOT = 520
const HEART_MAX_DIST = 760
const STRIDE = 58 // world units per footstep

export interface AudioDirector {
  engine: AudioEngine
  update(world: World, localSlot: number, dtMs: number): void
  onTag(world: World, localSlot: number, from: number, to: number): void
  destroy(): void
}

export const createAudioDirector = (): AudioDirector => {
  const engine = createAudioEngine()
  startAmbientBed(engine)

  const prevDoorOpen = new Float32Array(MAX_DOORS)
  const strideAcc = new Float32Array(MAX_PLAYERS)
  let heartCooldownMs = 0
  let heartAlternate = false

  const onVisibility = (): void => setMuted(engine, document.hidden)
  document.addEventListener('visibilitychange', onVisibility)

  return {
    engine,

    update(world, localSlot, dtMs): void {
      if (!engine.ctx || engine.muted) return
      const lx = world.x[localSlot]!
      const ly = world.y[localSlot]!

      // ── Doors ──
      const doorCount = world.map.doors.length / 3
      for (let d = 0; d < doorCount; d++) {
        const open = world.doorOpen[d]!
        const prev = prevDoorOpen[d]!
        if (open !== prev) {
          const dx = doorCenterX(world.map, d) - lx
          const dy = doorCenterY(world.map, d) - ly
          const dist = Math.sqrt(dx * dx + dy * dy)
          const gain = distanceGain(dist, DOOR_EARSHOT)
          const pan = panFor(dx)
          // Rising through nearly-shut = it just started opening. Landing on 0 = it shut.
          if (prev <= 0.01 && open > 0.01) doorCreak(engine, { gain: gain * 0.8, pan })
          else if (open === 0 && prev > 0) doorThud(engine, { gain: gain * 0.9, pan })
        }
        prevDoorOpen[d] = open
      }

      // ── Footsteps ──
      for (let s = 0; s < MAX_PLAYERS; s++) {
        if (world.active[s] === 0) continue
        const speed = Math.sqrt(world.vx[s]! * world.vx[s]! + world.vy[s]! * world.vy[s]!)
        if (speed < 20) {
          strideAcc[s] = 0
          continue
        }
        strideAcc[s] = strideAcc[s]! + speed * (dtMs / 1000)
        if (strideAcc[s]! < STRIDE) continue
        strideAcc[s] = 0

        if (s === localSlot) {
          footstep(engine, { gain: 0.1, pan: 0 }) // your own steps: felt, not heard
          continue
        }
        const dx = world.x[s]! - lx
        const dy = world.y[s]! - ly
        const dist = Math.sqrt(dx * dx + dy * dy)
        const gain = distanceGain(dist, STEP_EARSHOT)
        if (gain > 0.01) footstep(engine, { gain: gain * 0.55, pan: panFor(dx) })
      }

      // ── Heartbeat ──
      const it = world.itSlot
      heartCooldownMs -= dtMs
      if (it !== NO_SLOT && it !== localSlot && world.active[it] === 1) {
        const dx = world.x[it]! - lx
        const dy = world.y[it]! - ly
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < HEART_MAX_DIST && heartCooldownMs <= 0) {
          const closeness = 1 - dist / HEART_MAX_DIST
          // Lub-dub pairing: the second thump lands sooner and softer.
          heartThump(engine, 0.1 + closeness * 0.34)
          heartAlternate = !heartAlternate
          heartCooldownMs = heartAlternate ? 190 : 1050 - closeness * 660
        }
      } else {
        heartAlternate = false
      }
    },

    onTag(world, localSlot, from, to): void {
      if (!engine.ctx || engine.muted) return
      const involvesMe = from === localSlot || to === localSlot
      const dx = world.x[to]! - world.x[localSlot]!
      const dy = world.y[to]! - world.y[localSlot]!
      const dist = Math.sqrt(dx * dx + dy * dy)
      const gain = involvesMe ? 0.9 : distanceGain(dist, DOOR_EARSHOT) * 0.6
      if (gain > 0.02) tagSting(engine, { gain, pan: involvesMe ? 0 : panFor(dx) })
    },

    destroy(): void {
      document.removeEventListener('visibilitychange', onVisibility)
      void engine.ctx?.close()
    },
  }
}
