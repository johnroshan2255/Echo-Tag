import {
  IT_RING_COLOR,
  MAX_PLAYERS,
  NO_SLOT,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  TAG_IMMUNITY_MS,
  TICK_MS,
  TRANSFORM_DELAY_MS,
  type World,
} from '@echo-tag/shared'
import { Part, BODY, GRID_GROUND, GRID_H, LEG_TOP } from './templates.ts'
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

/** Mixes a toward b by t — the ghost's body sinks toward dusk but keeps a trace of who it was. */
const mix = (a: number, b: number, t: number): number => {
  const r = ((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t
  const g = ((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t
  const bl = (a & 0xff) + ((b & 0xff) - (a & 0xff)) * t
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (bl & 0xff)
}

const PARKED = -9999
const TRANSFORM_TICKS = Math.ceil(TRANSFORM_DELAY_MS / TICK_MS)
/** The wraith's body colour: near-dusk, one step lighter than the arena floor. */
const WRAITH_DUSK = 0x241b38
/** The wraith's eyes: embers. The only warm light on the coldest thing in the room. */
const WRAITH_EYE = 0xff5040
/** Terror radius: closer than this to the ghost, a human's eyes go wide. */
const FEAR_RADIUS_SQ = (PLAYER_RADIUS * 8) ** 2
const LEG_ROWS = GRID_H - 1 - LEG_TOP

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
      layer.shadows[p]!.x = PARKED
      layer.shadows[p]!.y = PARKED
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
    // The ghost is a WRAITH, not a person with an outline: it hovers, its legs taper into
    // a wisp tail, its body sinks toward dusk and its eyes burn. The white edge cells and
    // the double halo stay — marking must survive a crowd — but the silhouette itself now
    // says what it is.
    const wraith = isIt
    const hover = wraith ? 3 + Math.sin(nowMs * 0.003 + phase) * 1.8 : 0
    // Fear: eyes go wide near the ghost. Cheap, readable, and it doubles as peripheral
    // information — your own avatar knows before you do.
    const fear =
      !isIt &&
      itSlot !== NO_SLOT &&
      world.active[itSlot] === 1 &&
      (world.x[itSlot]! - wx) ** 2 + (world.y[itSlot]! - wy) ** 2 < FEAR_RADIUS_SQ
    // Lean into travel: the whole body shears toward the heading, feet anchored.
    const lean = moving && !wraith ? Math.cos(facing) * Math.min(speed / PLAYER_SPEED, 1) * 1.4 : 0
    // Out cold on the floor: the body reads as a collapsed pile, eyes shut — the ghost
    // must be able to SPOT a faint through the fog, and the victim must see why their
    // input is dead. Mirrored in netplay via the snapshot's unconscious flag.
    const ko = world.tick < world.unconsciousUntilTick[p]!
    // Goo-slowed: the silhouette's edge drips green so everyone can see who got got.
    const slowed = world.tick < world.slowedUntilTick[p]!
    const color = PLAYER_COLORS[world.colorSlot[p]! % PLAYER_COLORS.length]!
    // The wraith keeps a trace of its player colour, sunk deep toward dusk.
    const bodyColor = wraith ? mix(color, WRAITH_DUSK, 0.72) : color

    // A newly-tagged It flashes toward white while immune, so the handover is unmissable.
    // A TURNING player flickers toward the ghost's white too — slowly at the touch,
    // frantically just before crowning, so everyone can read how long their head start is.
    const immuneLeft = (world.immuneUntilTick[p]! - world.tick) * 50
    const flashing = (isIt && immuneLeft > 0) || turning
    const flashHz = turning ? 0.008 + turnProgress * turnProgress * 0.05 : 0.03
    const flash = flashing ? (Math.sin(nowMs * flashHz) > 0 ? IT_RING_COLOR : bodyColor) : bodyColor

    // Wide fearful eyes never blink; neither do the wraith's embers.
    const blinkScale = wraith || fear ? 1 : blink(nowMs, phase)

    // Ground shadow: a flattened dark square at the feet. The wraith's is smaller and
    // fainter — a floating thing barely touches the floor; a collapsed body presses wide.
    const shadow = layer.shadows[p]!
    const shadowW = ko ? 15 : wraith ? 9 : 12
    shadow.x = wx
    shadow.y = wy + CELL_WORLD * 0.4
    shadow.scaleX = WORLD_SCALE * shadowW
    shadow.scaleY = WORLD_SCALE * 2.4
    shadow.alpha = wraith ? 0.16 : 0.3

    for (let i = 0; i < stride; i++) {
      const particle = particles[base + i]!
      const part = BODY.part[i]!

      const gy = BODY.gy[i]!
      let ox = cellOffsetX(BODY.gx[i]!)
      let oy = cellOffsetY(gy) + bob * CELL_WORLD

      // Lean into travel: feet stay planted, the head shifts up to ~1.4 cells forward.
      if (lean !== 0) ox += lean * ((GRID_GROUND - gy) / GRID_H) * CELL_WORLD

      // Collapsed: the whole grid flattens toward the ground and spreads slightly.
      if (ko) {
        ox *= 1.25
        oy = oy * 0.35 + PLAYER_RADIUS * 0.55
      }

      let cellScaleX = scaleX
      let cellScaleY = scaleY

      // Limb animation. Legs lift on alternate phases; arms counter-swing. The wraith
      // does neither: it hovers, its legs melting into a wisp tail, arms adrift.
      if (wraith && !ko) {
        oy -= hover
        if (part === Part.LegL || part === Part.LegR) {
          const taper = (gy - LEG_TOP) / LEG_ROWS // 0 at the hips → 1 at the feet
          ox *= 1 - taper * 0.55
          cellScaleX *= 1 - taper * 0.4
          cellScaleY *= 1 - taper * 0.3
          oy -= taper * 0.6 * CELL_WORLD
        } else if (part === Part.ArmL) {
          oy += Math.sin(nowMs * 0.0024 + phase) * 0.5 * CELL_WORLD
        } else if (part === Part.ArmR) {
          oy += Math.sin(nowMs * 0.0024 + phase + 2.6) * 0.5 * CELL_WORLD
        }
      } else {
        if (part === Part.LegL) oy += legLift(dist, 1) * CELL_WORLD
        else if (part === Part.LegR) oy += legLift(dist, -1) * CELL_WORLD
        else if (part === Part.ArmL) oy += armSwing(dist, 1) * CELL_WORLD
        else if (part === Part.ArmR) oy += armSwing(dist, -1) * CELL_WORLD
      }

      if (part === Part.Eye) {
        ox += eyeShift(facing, 0) * CELL_WORLD
        oy += eyeShift(facing, 1) * CELL_WORLD * 0.5
        cellScaleY *= ko ? 0.12 : blinkScale // eyes shut while out cold
        // Ember eyes on the wraith; wide fearful eyes near it.
        if (wraith) {
          cellScaleX *= 1.55
          cellScaleY *= 1.55
        } else if (fear && !ko) {
          cellScaleX *= 1.35
          cellScaleY *= 1.35
        }
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
          ? wraith
            ? WRAITH_EYE // embers — the only warm light on the coldest thing in the room
            : 0x101018
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
