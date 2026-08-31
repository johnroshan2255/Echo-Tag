import {
  IT_RING_COLOR,
  MAX_PLAYERS,
  Monster,
  MONSTER_BY_MAP,
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
import { CELL_WORLD, cellOffsetX, cellOffsetY, DUST_MAX, EMOTE_CELLS, STARS_PER_PLAYER, WORLD_SCALE, type BodyLayer } from './squareBody.ts'
import { EMOTE_ICONS } from './pixelIcons.ts'
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
  /** Footstep dust ring buffer: birth timestamp (-inf when dead), position, drift. */
  dustBornMs: Float32Array
  dustX: Float32Array
  dustY: Float32Array
  dustDriftX: Float32Array
  dustDriftY: Float32Array
  /** Next slot to overwrite in the dust ring. */
  dustHead: Int32Array
  /** Per-player distance at the last dust puff, for spawn cadence. */
  lastDustAt: Float32Array
}

export const createAnimState = (): PlayerAnimState => {
  const phase = new Float32Array(MAX_PLAYERS)
  for (let i = 0; i < MAX_PLAYERS; i++) phase[i] = (i * 2.399963) % 6.2831853 // golden-angle spread
  return {
    distance: new Float32Array(MAX_PLAYERS),
    taggedAtMs: new Float32Array(MAX_PLAYERS).fill(-9999),
    facing: new Float32Array(MAX_PLAYERS),
    phase,
    dustBornMs: new Float32Array(DUST_MAX).fill(-9999),
    dustX: new Float32Array(DUST_MAX),
    dustY: new Float32Array(DUST_MAX),
    dustDriftX: new Float32Array(DUST_MAX),
    dustDriftY: new Float32Array(DUST_MAX),
    dustHead: new Int32Array(1),
    lastDustAt: new Float32Array(MAX_PLAYERS),
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
/** Terror radius: closer than this to the monster, a human's eyes go wide. */
const FEAR_RADIUS_SQ = (PLAYER_RADIUS * 8) ** 2
const LEG_ROWS = GRID_H - 1 - LEG_TOP

// ── Monster costumes ──────────────────────────────────────────────────────────
// The It player wears the map's monster. All of it is per-frame transforms of the SAME
// body template — no extra particles, no extra draw calls: the ghost is the classic
// white-sheeted spirit (big dark eyes, a wavy tail where the legs were), the wraith is
// its woodland twin, the spider is a squat wide thing on eight skittering legs, the
// alien is a dome-headed grey-green with huge black eyes.
const FORM_BODY: readonly number[] = [0xf2eefc, 0xd6f2dc, 0x2c2438, 0xa8d890]
const FORM_EDGE: readonly number[] = [0xbdb3dc, 0x93cfa4, 0xc9b8ff, 0x567a3f]
const FORM_EYE: readonly number[] = [0x241f38, 0x35604a, 0xff5040, 0x101018]

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
      for (let s = 0; s < STARS_PER_PLAYER; s++) {
        layer.stars[p * STARS_PER_PLAYER + s]!.x = PARKED
        layer.stars[p * STARS_PER_PLAYER + s]!.y = PARKED
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
    // In a grabber's grip: the whole body thrashes — the struggle must read from afar.
    if (world.heldByNest[p] !== NO_SLOT) {
      wx += Math.sin(nowMs * 0.09 + anim.phase[p]!) * 2.6
      wy += Math.cos(nowMs * 0.12 + anim.phase[p]! * 1.4) * 2
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
    // The It wears the map's monster: ghost, wraith, spider or alien (see FORM_* above).
    const form = isIt ? (MONSTER_BY_MAP[world.map.index] ?? Monster.Ghost) : -1
    const ghostly = form === Monster.Ghost || form === Monster.Wraith
    const spider = form === Monster.Spider
    const alien = form === Monster.Alien
    const hover = ghostly ? 3 + Math.sin(nowMs * 0.003 + phase) * 1.8 : 0
    // Fear: eyes go wide near the monster. Cheap, readable, and it doubles as peripheral
    // information — your own avatar knows before you do.
    const fear =
      !isIt &&
      itSlot !== NO_SLOT &&
      world.active[itSlot] === 1 &&
      (world.x[itSlot]! - wx) ** 2 + (world.y[itSlot]! - wy) ** 2 < FEAR_RADIUS_SQ
    // Lean into travel: the whole body shears toward the heading, feet anchored.
    const lean = moving && !ghostly && !spider ? Math.cos(facing) * Math.min(speed / PLAYER_SPEED, 1) * 1.4 : 0
    // Out cold on the floor: the body reads as a collapsed pile, eyes shut — the monster
    // must be able to SPOT a faint through the fog, and the victim must see why their
    // input is dead. Mirrored in netplay via the snapshot's unconscious flag.
    const ko = world.tick < world.unconsciousUntilTick[p]!
    // Goo-slowed (or webbed): the silhouette's edge drips so everyone can see who got got.
    const slowed = world.tick < world.slowedUntilTick[p]!
    const color = PLAYER_COLORS[world.colorSlot[p]! % PLAYER_COLORS.length]!
    // The monster is a full costume; player identity lives in the halo, roster and trail.
    const bodyColor = isIt ? FORM_BODY[form]! : color

    // A newly-tagged It flashes toward white while immune, so the handover is unmissable.
    // A TURNING player flickers toward the ghost's white too — slowly at the touch,
    // frantically just before crowning, so everyone can read how long their head start is.
    const immuneLeft = (world.immuneUntilTick[p]! - world.tick) * 50
    const flashing = (isIt && immuneLeft > 0) || turning
    const flashHz = turning ? 0.008 + turnProgress * turnProgress * 0.05 : 0.03
    const flash = flashing ? (Math.sin(nowMs * flashHz) > 0 ? IT_RING_COLOR : bodyColor) : bodyColor

    // Wide fearful eyes never blink; neither do a monster's.
    const blinkScale = isIt || fear ? 1 : blink(nowMs, phase)

    // Ground shadow: a flattened dark square at the feet. A floating ghost barely touches
    // the floor; a squat spider presses wide; a collapsed body spreads.
    const shadow = layer.shadows[p]!
    const shadowW = ko ? 15 : ghostly ? 9 : spider ? 16 : 12
    shadow.x = wx
    shadow.y = wy + CELL_WORLD * 0.4
    shadow.scaleX = WORLD_SCALE * shadowW
    shadow.scaleY = WORLD_SCALE * 2.4
    shadow.alpha = ghostly ? 0.16 : 0.3

    // Footstep dust: running feet kick up a puff every ~30 world units. Ghosts float
    // and leave none — their trail is the echo wall.
    if (moving && !ghostly && !ko && dist - anim.lastDustAt[p]! > 30) {
      anim.lastDustAt[p] = dist
      const h = anim.dustHead[0]!
      anim.dustHead[0] = (h + 1) % DUST_MAX
      anim.dustBornMs[h] = nowMs
      anim.dustX[h] = wx + (Math.random() - 0.5) * 6
      anim.dustY[h] = wy + CELL_WORLD * 0.5
      anim.dustDriftX[h] = -vx * 0.03 + (Math.random() - 0.5) * 8
      anim.dustDriftY[h] = -vy * 0.03 - 4
    }

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

      // Limb animation and the monster costumes. Everything below is offsets and scales
      // on template cells — the emoji-ghost's tail, the spider's eight legs and the
      // alien's dome are the same squares, moved.
      if (ghostly && !ko) {
        // The white-sheeted ghost: hover, arms tucked into stubby sleeves, and the legs
        // gathered into ONE wavy tail that trails below the hem and swishes.
        oy -= hover
        if (part === Part.LegL || part === Part.LegR) {
          const taper = (gy - LEG_TOP) / LEG_ROWS // 0 at the hips → 1 at the tail tip
          ox *= 1 - taper * 0.85 // both legs gather onto the centreline
          ox += Math.sin(nowMs * 0.006 + taper * 4.2 + phase) * taper * 5 // the swish
          cellScaleX *= 1 - taper * 0.4
          oy += taper * 0.9 * CELL_WORLD // the tail hangs below the hem
        } else if (part === Part.ArmL || part === Part.ArmR) {
          ox *= 0.8
          oy -= 0.4 * CELL_WORLD
          cellScaleX *= 0.7
          oy += Math.sin(nowMs * 0.0024 + phase + (part === Part.ArmR ? 2.6 : 0)) * 0.4 * CELL_WORLD
        }
      } else if (spider && !ko) {
        // The cave spider, properly: a two-lobe body (small head with eyes, big round
        // abdomen behind it) and EIGHT arched legs — arm cells make the raised inner
        // segments, leg cells the planted outer tips, four per side, skittering.
        if (part === Part.ArmL || part === Part.ArmR || part === Part.LegL || part === Part.LegR) {
          const side = part === Part.ArmL || part === Part.LegL ? -1 : 1
          const legI = gy & 3 // which of the four legs on this side
          const inner = part === Part.ArmL || part === Part.ArmR
          // Root at the body's flank, arch up over the knee, plant the tip wide and low.
          ox = side * (inner ? 15 + legI * 2 : 26 + legI * 3.5)
          oy = -4 + legI * 5 + (inner ? -6 : 4)
          const skitter = moving
            ? Math.sin(dist * 0.45 + legI * 1.7 + (side > 0 ? 0 : 2.2)) * 3
            : Math.sin(nowMs * 0.002 + legI * 1.3) * 0.8
          oy += inner ? 0 : skitter
          cellScaleX *= 1.7
          cellScaleY *= 0.9
        } else {
          // Body lobes: head (with the eyes) front-top, abdomen big and round below.
          const abdomen = part === Part.Torso
          oy = oy * 0.45 + PLAYER_RADIUS * 0.2 + (abdomen ? 3 : -2)
          ox *= abdomen ? 1.5 : 1.1
          cellScaleX *= abdomen ? 1.9 : 1.5
          cellScaleY *= abdomen ? 1.5 : 1.3
        }
      } else if (alien && !ko) {
        // The hive alien: walk cycle first, then the reshape — dome head, slim body.
        if (part === Part.LegL) oy += legLift(dist, 1) * CELL_WORLD
        else if (part === Part.LegR) oy += legLift(dist, -1) * CELL_WORLD
        else if (part === Part.ArmL) oy += armSwing(dist, 1) * CELL_WORLD
        else if (part === Part.ArmR) oy += armSwing(dist, -1) * CELL_WORLD
        if (part === Part.Head || part === Part.Eye) {
          // The dome grows: spacing AND cell size scale together, so it stays solid.
          const hcy = cellOffsetY(3.2)
          ox *= 1.45
          oy = hcy + (oy - hcy) * 1.35 - CELL_WORLD * 0.8
          cellScaleX *= 1.5
          cellScaleY *= 1.4
        } else if (part === Part.Torso) {
          ox *= 0.7
        } else {
          ox *= 0.78
          cellScaleX *= 0.75
        }
      } else {
        if (part === Part.LegL) oy += legLift(dist, 1) * CELL_WORLD
        else if (part === Part.LegR) oy += legLift(dist, -1) * CELL_WORLD
        else if (part === Part.ArmL) oy += armSwing(dist, 1) * CELL_WORLD
        else if (part === Part.ArmR) oy += armSwing(dist, -1) * CELL_WORLD
      }

      if (part === Part.Eye) {
        ox += eyeShift(facing, 0) * CELL_WORLD * (spider ? 1.6 : 1)
        oy += eyeShift(facing, 1) * CELL_WORLD * 0.5
        cellScaleY *= ko ? 0.12 : blinkScale // eyes shut while out cold
        if (ghostly) {
          // The emoji ghost's big dark oval eyes.
          cellScaleX *= 1.8
          cellScaleY *= 2.1
        } else if (spider) {
          cellScaleX *= 2.2
          cellScaleY *= 2.2
          oy += 4 // eyes sit on the front of the squat body, not floating above it
        } else if (alien) {
          // Huge almond eyes on the dome.
          cellScaleX *= 2.1
          cellScaleY *= 1.5
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
      // Monsters get their own eye and edge colours; runners keep the classic marking.
      let cellTint =
        part === Part.Eye
          ? isIt
            ? FORM_EYE[form]!
            : 0x101018
          : BODY.edge[i] === 1
            ? isIt
              ? FORM_EDGE[form]!
              : slowed
                ? 0x7ccb66 // goo (or web) drips
                : darken(flash, 0.62)
            : flash
      // The ghost's tail shades hard toward lavender-grey: the tail hangs in the centre
      // of the ghost's own lantern glow, and white-on-white would erase it.
      if (ghostly && (part === Part.LegL || part === Part.LegR)) {
        cellTint = darken(cellTint, 0.8 - ((gy - LEG_TOP) / LEG_ROWS) * 0.28)
      }
      particle.tint = cellTint
    }

    // Dizzy stars over a knocked-out body — the state reads at a glance through the fog.
    const starBase = p * STARS_PER_PLAYER
    for (let s = 0; s < STARS_PER_PLAYER; s++) {
      const star = layer.stars[starBase + s]!
      if (!ko) {
        star.x = PARKED
        star.y = PARKED
        continue
      }
      const a = nowMs * 0.006 + (s * 6.2831853) / STARS_PER_PLAYER
      star.x = wx + Math.cos(a) * PLAYER_RADIUS * 0.95
      star.y = wy - PLAYER_RADIUS * 0.35 + Math.sin(a) * PLAYER_RADIUS * 0.3
      const tw = WORLD_SCALE * (1.7 + 0.6 * Math.sin(nowMs * 0.02 + s * 2.1))
      star.scaleX = tw
      star.scaleY = tw
      star.alpha = 0.9
    }
  }

  // Age the dust pool once per frame: shrink, fade, then park.
  for (let i = 0; i < DUST_MAX; i++) {
    const life = (nowMs - anim.dustBornMs[i]!) / 450
    const d = layer.dust[i]!
    if (life < 0 || life >= 1) {
      d.x = PARKED
      d.y = PARKED
      continue
    }
    d.x = anim.dustX[i]! + anim.dustDriftX[i]! * life
    d.y = anim.dustY[i]! + anim.dustDriftY[i]! * life
    const s = WORLD_SCALE * 2.4 * (1 - life * 0.55)
    d.scaleX = s
    d.scaleY = s
    d.alpha = 0.38 * (1 - life)
  }
}

// ── Emotes ────────────────────────────────────────────────────────────────────
// A fixed roster of pixel icons (see pixelIcons.EMOTE_ICONS) flashed above a head for a
// couple of seconds. Rendered as particles from each player's reserved EMOTE_CELLS slice
// of the body container — same texture, same draw call as everything else.

export interface EmoteState {
  /** Active icon index per slot, -1 when none. */
  icon: Int8Array
  /** When the active emote started, ms. */
  sinceMs: Float32Array
}

export const createEmoteState = (): EmoteState => ({
  icon: new Int8Array(MAX_PLAYERS).fill(-1),
  sinceMs: new Float32Array(MAX_PLAYERS),
})

export const triggerEmote = (st: EmoteState, slot: number, n: number, nowMs: number): void => {
  if (slot < 0 || slot >= MAX_PLAYERS || n < 0 || n >= EMOTE_GRIDS.length) return
  st.icon[slot] = n
  st.sinceMs[slot] = nowMs
}

interface EmoteCell {
  x: number
  y: number
  tint: number
}

/** Lit cells per icon, centred, in world units — computed once at module load. */
const EMOTE_GRIDS: EmoteCell[][] = EMOTE_ICONS.map((icon) => {
  const cells: EmoteCell[] = []
  const w = icon.rows[0]!.length
  const h = icon.rows.length
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = icon.rows[y]![x]!
      if (c === '.') continue
      cells.push({ x: (x - (w - 1) / 2) * CELL_WORLD, y: (y - (h - 1) / 2) * CELL_WORLD, tint: icon.palette[c]! })
    }
  }
  return cells.slice(0, EMOTE_CELLS)
})

export const renderEmotes = (
  layer: BodyLayer,
  world: World,
  prevX: Float32Array,
  prevY: Float32Array,
  alpha: number,
  st: EmoteState,
  nowMs: number,
  showMs: number,
): void => {
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const base = p * EMOTE_CELLS
    const icon = st.icon[p]!
    const age = nowMs - st.sinceMs[p]!
    const live = icon >= 0 && age < showMs && world.active[p] === 1 && world.hiddenIn[p] === NO_SLOT
    if (!live) {
      if (icon >= 0 && age >= showMs) st.icon[p] = -1
      for (let i = 0; i < EMOTE_CELLS; i++) {
        const q = layer.emotes[base + i]!
        q.x = PARKED
        q.y = PARKED
      }
      continue
    }
    const wx = prevX[p]! + (world.x[p]! - prevX[p]!) * alpha
    const wy = prevY[p]! + (world.y[p]! - prevY[p]!) * alpha
    const pop = Math.min(1, age / 140) // quick pop-in
    const fade = Math.max(0, Math.min(1, (showMs - age) / 300))
    const k = 0.8 + 0.35 * pop
    // Clear of the avatar: the body is GRID_H cells tall from its feet anchor, so the
    // icon centre floats ~5 cells above the head (plus a rise as it pops in).
    const oy = -(GRID_H + 5) * CELL_WORLD - pop * 3
    const cells = EMOTE_GRIDS[icon]!
    for (let i = 0; i < EMOTE_CELLS; i++) {
      const q = layer.emotes[base + i]!
      const c = cells[i]
      if (!c) {
        q.x = PARKED
        q.y = PARKED
        continue
      }
      q.x = wx + c.x * k
      q.y = wy + oy + c.y * k
      q.scaleX = WORLD_SCALE * k
      q.scaleY = WORLD_SCALE * k
      q.alpha = fade
      q.tint = c.tint
    }
  }
}

/** Records a tag so the scatter animation can fire. Called from the sim event. */
export const onTagged = (anim: PlayerAnimState, slot: number, nowMs: number): void => {
  anim.taggedAtMs[slot] = nowMs
}

export const IMMUNITY_TICKS = Math.ceil(TAG_IMMUNITY_MS / 50)
