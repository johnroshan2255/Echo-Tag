import {
  BEAM_HALF_WIDTH,
  BEAM_RANGE,
  MAP_TILE,
  MAX_NESTS,
  MAX_PORTALS,
  MAX_WEB_SHOTS,
  Monster,
  MONSTER_BY_MAP,
  NO_SLOT,
  type World,
} from '@echo-tag/shared'
import { Container, Sprite, type Texture } from 'pixi.js'
import { NEST_SPIDER_BODY, NEST_SPIDER_EYE, NEST_SPIDER_LEG, NEST_WEB_COLOR, PORTAL_COLOR, PORTAL_CORE } from '../theme.ts'

/** UFO grabber palette (the hive's lairs are saucers, not spiders). */
const UFO_HULL = 0x8fa4c4
const UFO_DOME = 0xbfffe8
const UFO_LIGHT = 0x2fd4b8
const UFO_BEAM = 0x9fffe0

/**
 * The moving parts of the themed worlds: web shots in flight, the alien's beam
 * (telegraph + flash), the portal swirls, and the nest spiders themselves.
 *
 * Everything is a pooled Sprite of the shared 8px square texture, created once and
 * transform-only per frame — the same discipline as doors.ts, so the whole layer batches
 * with its neighbours and allocates nothing at runtime.
 */

const PARKED = -9999
const LEGS = 8

interface NestSprites {
  body: Sprite
  head: Sprite
  eyeL: Sprite
  eyeR: Sprite
  legs: Sprite[]
}

export interface MonsterFxLayer {
  container: Container
  webs: Sprite[]
  webCores: Sprite[]
  beamCore: Sprite
  beamGlow: Sprite
  /** 4 orbiting motes + 1 pulsing core per portal entry. */
  portalBits: Sprite[]
  portalCount: number
  portalX: Float32Array
  portalY: Float32Array
  nests: NestSprites[]
}

export const createMonsterFxLayer = (texture: Texture): MonsterFxLayer => {
  const container = new Container()
  const make = (tint: number, alpha = 1): Sprite => {
    const s = new Sprite(texture)
    s.anchor.set(0.5)
    s.tint = tint
    s.alpha = alpha
    s.x = PARKED
    s.y = PARKED
    container.addChild(s)
    return s
  }

  const webs: Sprite[] = []
  const webCores: Sprite[] = []
  for (let i = 0; i < MAX_WEB_SHOTS; i++) {
    webs.push(make(NEST_WEB_COLOR, 0.9))
    webCores.push(make(0xffffff, 0.95))
  }

  const beamGlow = make(0x7a4bd8, 0)
  beamGlow.anchor.set(0, 0.5)
  const beamCore = make(0xe6dcff, 0)
  beamCore.anchor.set(0, 0.5)

  const portalBits: Sprite[] = []
  for (let i = 0; i < MAX_PORTALS * 5; i++) portalBits.push(make(i % 5 === 4 ? PORTAL_CORE : PORTAL_COLOR, 0))

  const nests: NestSprites[] = []
  for (let n = 0; n < MAX_NESTS; n++) {
    const legs: Sprite[] = []
    for (let l = 0; l < LEGS; l++) legs.push(make(NEST_SPIDER_BODY, 0.95))
    nests.push({
      body: make(NEST_SPIDER_BODY),
      head: make(NEST_SPIDER_BODY),
      eyeL: make(NEST_SPIDER_EYE),
      eyeR: make(NEST_SPIDER_EYE),
      legs,
    })
  }

  return {
    container,
    webs,
    webCores,
    beamCore,
    beamGlow,
    portalBits,
    portalCount: 0,
    portalX: new Float32Array(MAX_PORTALS),
    portalY: new Float32Array(MAX_PORTALS),
    nests,
  }
}

/** Reads the map's portal pads. Call on map change. */
export const setMonsterFxMap = (fx: MonsterFxLayer, map: { portals: Int16Array }): void => {
  fx.portalCount = map.portals.length / 4
  for (let p = 0; p < fx.portalCount; p++) {
    fx.portalX[p] = (map.portals[p * 4]! + 0.5) * MAP_TILE
    fx.portalY[p] = (map.portals[p * 4 + 1]! + 0.5) * MAP_TILE
  }
  for (const b of fx.portalBits) {
    b.alpha = 0
    b.x = PARKED
    b.y = PARKED
  }
}

export const renderMonsterFx = (fx: MonsterFxLayer, world: World, nowMs: number): void => {
  const t = nowMs * 0.001

  // ── Web shots: a spinning wad of silk ──
  for (let i = 0; i < MAX_WEB_SHOTS; i++) {
    const live = world.webUntilTick[i]! > world.tick
    const outer = fx.webs[i]!
    const core = fx.webCores[i]!
    if (!live) {
      outer.x = PARKED
      outer.y = PARKED
      core.x = PARKED
      core.y = PARKED
      continue
    }
    outer.x = world.webX[i]!
    outer.y = world.webY[i]!
    outer.rotation = t * 9 + i
    outer.scale.set(20 / 8, 20 / 8)
    core.x = outer.x
    core.y = outer.y
    core.rotation = -t * 7 + i
    core.scale.set(11 / 8, 11 / 8)
  }

  // ── The beam ──
  const it = world.itSlot
  if (world.beamPhase !== 0 && it !== NO_SLOT && world.active[it] === 1) {
    const ox = world.x[it]!
    const oy = world.y[it]!
    fx.beamCore.x = ox
    fx.beamCore.y = oy
    fx.beamGlow.x = ox
    fx.beamGlow.y = oy
    fx.beamCore.rotation = world.beamAngle
    fx.beamGlow.rotation = world.beamAngle
    if (world.beamPhase === 1) {
      // Charging: a thin flickering aim line the whole room can dodge.
      const flicker = 0.3 + 0.25 * Math.sin(nowMs * 0.045)
      fx.beamGlow.scale.set(BEAM_RANGE / 8, 10 / 8)
      fx.beamGlow.alpha = flicker * 0.5
      fx.beamCore.scale.set(BEAM_RANGE / 8, 3 / 8)
      fx.beamCore.alpha = flicker + 0.25
    } else {
      // Fired: a fat bright bar along exactly the distance the sim resolved.
      const reach = Math.max(world.beamReach, 40)
      fx.beamGlow.scale.set(reach / 8, (BEAM_HALF_WIDTH * 2.6) / 8)
      fx.beamGlow.alpha = 0.55
      fx.beamCore.scale.set(reach / 8, (BEAM_HALF_WIDTH * 1.3) / 8)
      fx.beamCore.alpha = 0.95
    }
  } else {
    fx.beamCore.alpha = 0
    fx.beamGlow.alpha = 0
    fx.beamCore.x = PARKED
    fx.beamGlow.x = PARKED
  }

  // ── Portal swirls ──
  for (let p = 0; p < fx.portalCount; p++) {
    const cx = fx.portalX[p]!
    const cy = fx.portalY[p]!
    for (let k = 0; k < 4; k++) {
      const bit = fx.portalBits[p * 5 + k]!
      const a = t * 2.4 + (k * Math.PI) / 2 + p * 1.3
      const r = 20 + Math.sin(t * 3 + k) * 5
      bit.x = cx + Math.cos(a) * r
      bit.y = cy + Math.sin(a) * r * 0.85
      bit.scale.set(7 / 8, 7 / 8)
      bit.rotation = a
      bit.alpha = 0.55 + 0.2 * Math.sin(t * 5 + k)
    }
    const corePulse = fx.portalBits[p * 5 + 4]!
    corePulse.x = cx
    corePulse.y = cy
    const s = 10 + Math.sin(t * 4 + p) * 3
    corePulse.scale.set(s / 8, s / 8)
    corePulse.rotation = t * 1.6
    corePulse.alpha = 0.5
  }

  // ── Lair grabbers: nest spiders, or abduction UFOs on the alien's map ──
  const ufo = MONSTER_BY_MAP[world.map.index] === Monster.Alien
  const nestCount = world.map.nests.length / 2
  for (let n = 0; n < MAX_NESTS; n++) {
    const sp = fx.nests[n]!
    if (n >= nestCount) {
      sp.body.x = PARKED
      sp.body.y = PARKED
      sp.head.x = PARKED
      sp.head.y = PARKED
      sp.eyeL.x = PARKED
      sp.eyeL.y = PARKED
      sp.eyeR.x = PARKED
      sp.eyeR.y = PARKED
      for (const l of sp.legs) {
        l.x = PARKED
        l.y = PARKED
      }
      continue
    }
    const x = world.nestX[n]!
    const y = world.nestY[n]!
    const state = world.nestState[n]!
    const lunging = state === 1
    const resting = state === 3
    const holding = state === 4

    if (ufo) {
      // A saucer hovering above its anchor: hull disc + glass dome + two blink-lights,
      // with a tractor beam of widening light bars while it hunts or holds.
      const hover = -88 + Math.sin(t * 1.7 + n * 2.1) * 5
      sp.body.tint = UFO_HULL
      sp.body.x = x
      sp.body.y = y + hover
      sp.body.scale.set(60 / 8, 13 / 8)
      sp.head.tint = UFO_DOME
      sp.head.x = x
      sp.head.y = y + hover - 11
      sp.head.scale.set(26 / 8, 12 / 8)
      sp.head.alpha = 0.9
      sp.eyeL.tint = UFO_LIGHT
      sp.eyeR.tint = UFO_LIGHT
      sp.eyeL.x = x - 20
      sp.eyeR.x = x + 20
      sp.eyeL.y = sp.eyeR.y = y + hover + 5
      sp.eyeL.scale.set(4 / 8, 4 / 8)
      sp.eyeR.scale.set(4 / 8, 4 / 8)
      sp.eyeL.alpha = Math.sin(t * 6 + n) > 0 ? 1 : 0.25
      sp.eyeR.alpha = Math.sin(t * 6 + n + Math.PI) > 0 ? 1 : 0.25
      // Legs 0-3: the tractor beam, widening toward the ground. Legs 4-7: parked.
      const beamOn = lunging || holding
      for (let l = 0; l < LEGS; l++) {
        const leg = sp.legs[l]!
        if (l >= 4 || !beamOn) {
          leg.x = PARKED
          leg.y = PARKED
          continue
        }
        const f = (l + 1) / 4
        leg.tint = UFO_BEAM
        leg.x = x
        leg.y = y + hover + 12 + f * (-hover - 12)
        leg.scale.set(((18 + f * 30) / 8) * (holding ? 1.15 : 1), 5 / 8)
        leg.rotation = 0
        leg.alpha = (holding ? 0.55 : 0.35) + 0.15 * Math.sin(t * 9 + l)
      }
      continue
    }

    // The nest spider: body breathes while lurking, flattens while sulking, bristles
    // mid-lunge, and clamps its legs around the victim while holding.
    const breathe = resting ? 0.85 : 1 + Math.sin(t * (lunging ? 14 : 2.2) + n) * (lunging ? 0.1 : 0.04)
    sp.body.tint = NEST_SPIDER_BODY
    sp.head.tint = NEST_SPIDER_BODY
    sp.eyeL.tint = NEST_SPIDER_EYE
    sp.eyeR.tint = NEST_SPIDER_EYE
    sp.body.x = x
    sp.body.y = y
    sp.body.scale.set((26 / 8) * breathe, (19 / 8) * breathe)
    sp.head.x = x
    sp.head.y = y - 12 * breathe
    sp.head.scale.set(15 / 8, 10 / 8)
    sp.eyeL.x = x - 4
    sp.eyeL.y = y - 13 * breathe
    sp.eyeL.scale.set(3.4 / 8, 3.4 / 8)
    sp.eyeR.x = x + 4
    sp.eyeR.y = y - 13 * breathe
    sp.eyeR.scale.set(3.4 / 8, 3.4 / 8)
    sp.eyeL.alpha = sp.eyeR.alpha = lunging || holding ? 1 : 0.85
    for (let l = 0; l < LEGS; l++) {
      const leg = sp.legs[l]!
      const side = l < 4 ? -1 : 1
      const idx = l % 4
      const skitter = lunging ? Math.sin(t * 22 + l * 1.9) * 4 : Math.sin(t * 2.4 + l) * 1.2
      leg.tint = NEST_SPIDER_LEG
      // Holding: the legs wrap inward around the victim instead of splaying.
      leg.x = x + side * (holding ? 9 + idx * 2 : 16 + idx * 4)
      leg.y = y - 8 + idx * 6 + (holding ? Math.sin(t * 10 + l) * 1.5 : skitter)
      leg.scale.set(12 / 8, 3 / 8)
      leg.rotation = side * (holding ? 1.1 - idx * 0.2 : 0.5 - idx * 0.25)
      leg.alpha = 0.95
    }
  }
}
