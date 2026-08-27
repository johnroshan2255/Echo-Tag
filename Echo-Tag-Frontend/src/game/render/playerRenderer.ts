import {
  IT_RING_COLOR,
  MAX_PLAYERS,
  NO_SLOT,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  TAG_IMMUNITY_MS,
  TICK_MS,
  TRANSFORM_DELAY_MS,
  type World,
} from '@echo-tag/shared'
import { Part, BODY } from './templates.ts'
import { CELL_WORLD, cellOffsetX, cellOffsetY, WORLD_SCALE, type BodyLayer } from './squareBody.ts'
import { armSwing, blink, eyeShift, idleBob, legLift, scatter, squashAcross, stretchAlong } from '../anim/procedural.ts'

/**
 * Per-frame transform of every live player's particle slice.
 *
 * This is the hottest loop on the client: 12 players x 168 squares = ~2000 particles, every
 * frame. It therefore does three things and no more — writes `x`, `y`, `scaleX`, `scaleY`
 * and `tint` on existing particles. It never walks the template to *decide* which cells
 * exist, never constructs a Particle, and never allocates.
 *
 * Everything is written in WORLD coordinates. The follow camera transforms the world-root
 * container once per frame; no renderer knows the camera exists. That is what makes the
 * camera pivot a container-transform change rather than a rewrite of every renderer.
 *
 * The template is walked for geometry only; part tags drive the animation, which is what
 * keeps `templates.ts` (what an avatar *is*) separate from this file (what it is *doing*).
 */

/** Per-player animation state the sim does not carry. Allocated once. */
export interface PlayerAnimState {
  /** Distance travelled, drives the walk cycle phase. */
  distance: Float32Array
  /** Timestamp of the tick this player became It, for the scatter burst. */
  taggedAtMs: Float32Array
  /** Smoothed facing, so the eyes do not snap. */
  facing: Float32Array
  /** Per-player phase offset so twelve avatars never bob or blink in unison. */
  phase: Float32Array
}

export const createAnimState = (): PlayerAnimState => {
  const phase = new Float32Array(MAX_PLAYERS)
  for (let i = 0; i < MAX_PLAYERS; i++) phase[i] = (i * 2.399963) % 6.2831853 // golden-angle spread
  return {
    distance: new Float32Array(MAX_PLAYERS),
    taggedAtMs: new Float32Array(MAX_PLAYERS).fill(-9999),
    facing: new Float32Array(MAX_PLAYERS),
    phase,
  }
}

/** Darkens a colour for edge cells, giving the silhouette definition against the floor. */
const darken = (color: number, f: number): number => {
  const r = ((color >> 16) & 0xff) * f
  const g = ((color >> 8) & 0xff) * f
  const b = (color & 0xff) * f
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

const PARKED = -9999
const TRANSFORM_TICKS = Math.ceil(TRANSFORM_DELAY_MS / TICK_MS)

export const renderPlayers = (
  layer: BodyLayer,
  world: World,
  prevX: Float32Array,
  prevY: Float32Array,
  alpha: number,
  anim: PlayerAnimState,
  nowMs: number,
): void => {
  const { particles, stride } = layer
  const baseScale = WORLD_SCALE
  const itSlot = world.itSlot

  for (let p = 0; p < MAX_PLAYERS; p++) {
    const base = p * stride

    if (world.active[p] === 0 || world.hiddenIn[p] !== NO_SLOT) {
      // Hidden players are inside a wardrobe: invisible is the whole point.
      for (let i = 0; i < stride; i++) {
        const particle = particles[base + i]!
        particle.x = PARKED
        particle.y = PARKED
      }
      continue
    }

    // Interpolate between the last two authoritative ticks. Without this the avatars step
    // at 20Hz while the screen runs at 60.
    let wx = prevX[p]! + (world.x[p]! - prevX[p]!) * alpha
    let wy = prevY[p]! + (world.y[p]! - prevY[p]!) * alpha

    // The metamorphosis: the turning player trembles, harder as the ghost takes hold.
    const turning = p === world.turningSlot
    const turnProgress = turning
      ? 1 - Math.min(1, Math.max(0, (world.turningUntilTick - world.tick) / TRANSFORM_TICKS))
      : 0
    if (turning) {
      const tremor = 1.2 + turnProgress * 3.2
      wx += Math.sin(nowMs * 0.055 + anim.phase[p]!) * tremor
      wy += Math.cos(nowMs * 0.047 + anim.phase[p]! * 1.3) * tremor
    }

    const vx = world.vx[p]!
    const vy = world.vy[p]!
    const speed = Math.sqrt(vx * vx + vy * vy)
    const moving = speed > 8

    anim.distance[p] = anim.distance[p]! + speed * (1 / 60)
    const dist = anim.distance[p]!
    const phase = anim.phase[p]!

    // Facing follows the heading, eased so a flick of the stick does not snap the eyes.
    if (moving) {
      const target = Math.atan2(vy, vx)
      const d = Math.atan2(Math.sin(target - anim.facing[p]!), Math.cos(target - anim.facing[p]!))
      anim.facing[p] = anim.facing[p]! + d * 0.25
    }
    const facing = anim.facing[p]!

    // Squash and stretch along travel. Applied as axis-aligned scale, which is a lie at
    // 45 degrees but reads correctly and costs one multiply instead of a rotation.
    const along = moving ? stretchAlong(speed) : 1
    const across = moving ? squashAcross(speed) : 1
    const horizontal = Math.abs(Math.cos(facing)) > Math.abs(Math.sin(facing))
    // A turning body convulses: a slow breathing swell that deepens toward the crowning.
    const convulse = turning ? 1 + 0.08 * turnProgress * Math.sin(nowMs * 0.02 + anim.phase[p]!) : 1
    const scaleX = baseScale * (horizontal ? along : across) * convulse
    const scaleY = baseScale * (horizontal ? across : along) * convulse

    const bob = moving ? 0 : idleBob(nowMs, phase)
    const scatterAge = (nowMs - anim.taggedAtMs[p]!) / 1000
    const isIt = p === itSlot
    // Out cold on the floor: the body reads as a collapsed pile, eyes shut — the ghost
    // must be able to SPOT a faint through the fog, and the victim must see why their
    // input is dead. Mirrored in netplay via the snapshot's unconscious flag.
    const ko = world.tick < world.unconsciousUntilTick[p]!
    // Goo-slowed: the silhouette's edge drips green so everyone can see who got got.
    const slowed = world.tick < world.slowedUntilTick[p]!
    const color = PLAYER_COLORS[world.colorSlot[p]! % PLAYER_COLORS.length]!

    // A newly-tagged It flashes toward white while immune, so the handover is unmissable.
    // A TURNING player flickers toward the ghost's white too — slowly at the touch,
    // frantically just before crowning, so everyone can read how long their head start is.
    const immuneLeft = (world.immuneUntilTick[p]! - world.tick) * 50
    const flashing = (isIt && immuneLeft > 0) || turning
    const flashHz = turning ? 0.008 + turnProgress * turnProgress * 0.05 : 0.03
    const flash = flashing ? (Math.sin(nowMs * flashHz) > 0 ? IT_RING_COLOR : color) : color

    const blinkScale = blink(nowMs, phase)

    for (let i = 0; i < stride; i++) {
      const particle = particles[base + i]!
      const part = BODY.part[i]!

      let ox = cellOffsetX(BODY.gx[i]!)
      let oy = cellOffsetY(BODY.gy[i]!) + bob * CELL_WORLD

      // Collapsed: the whole grid flattens toward the ground and spreads slightly.
      if (ko) {
        ox *= 1.25
        oy = oy * 0.35 + PLAYER_RADIUS * 0.55
      }

      // Limb animation. Legs lift on alternate phases; arms counter-swing.
      if (part === Part.LegL) oy += legLift(dist, 1) * CELL_WORLD
      else if (part === Part.LegR) oy += legLift(dist, -1) * CELL_WORLD
      else if (part === Part.ArmL) oy += armSwing(dist, 1) * CELL_WORLD
      else if (part === Part.ArmR) oy += armSwing(dist, -1) * CELL_WORLD

      let cellScaleX = scaleX
      let cellScaleY = scaleY

      if (part === Part.Eye) {
        ox += eyeShift(facing, 0) * CELL_WORLD
        oy += eyeShift(facing, 1) * CELL_WORLD * 0.5
        cellScaleY *= ko ? 0.12 : blinkScale // eyes shut while out cold
      }

      // Tag burst: every square is an independent object, so scattering them outward and
      // letting them snap back costs almost nothing to implement.
      if (scatterAge >= 0 && scatterAge < 0.42) {
        const rx = ox
        const ry = oy + PLAYER_RADIUS * 0.5
        const r = Math.sqrt(rx * rx + ry * ry) / (PLAYER_RADIUS * 1.5)
        const push = scatter(scatterAge, r)
        const len = Math.max(0.0001, Math.sqrt(rx * rx + ry * ry))
        ox += (rx / len) * push * CELL_WORLD
        oy += (ry / len) * push * CELL_WORLD
      }

      particle.x = wx + ox
      particle.y = wy + oy
      particle.scaleX = cellScaleX
      particle.scaleY = cellScaleY
      // The It player gets white edge cells: a bright outline around the silhouette itself,
      // so the marking survives even when the halo behind them is lost in a crowd.
      particle.tint =
        part === Part.Eye
          ? 0x101018
          : BODY.edge[i] === 1
            ? isIt
              ? IT_RING_COLOR
              : slowed
                ? 0x7ccb66 // goo drips
                : darken(flash, 0.62)
            : flash
    }
  }
}

/** Records a tag so the scatter animation can fire. Called from the sim event. */
export const onTagged = (anim: PlayerAnimState, slot: number, nowMs: number): void => {
  anim.taggedAtMs[slot] = nowMs
}

export const IMMUNITY_TICKS = Math.ceil(TAG_IMMUNITY_MS / 50)
