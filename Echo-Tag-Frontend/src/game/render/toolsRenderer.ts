import {
  GOO_LIFE_MS,
  MAX_DEPLOYED,
  MAX_TOOL_SPAWNS,
  TICK_MS,
  TOOL_GOO,
  TOOL_TRAP,
  TOOL_WEB,
  TRAP_ARM_MS,
  TRAP_LIFE_MS,
  WEB_PATCH_LIFE_MS,
  WEB_PATCH_RADIUS,
  type World,
} from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import { NEST_WEB_COLOR } from '../theme.ts'
import { JAR_ICON, TRAP_ICON, paintIcon } from './pixelIcons.ts'

/**
 * Tools on the floor and tools in play.
 *
 * Floor pickups bob and glint like the wardrobe keys — public information everyone
 * races for. Deployed tools read at a glance: a goo puddle is an obvious wet green
 * stain (walk around it!), a trap is a small jaw that blinks while arming and then
 * sits still and subtle — visible to the attentive, lethal to the hurried. Icons are
 * pixel-art bitmaps (pixelIcons.ts), matching the square-particle world; the puddle is
 * a ground decal, chunked to the same grid. All pooled Graphics, drawn once at
 * creation; per-frame work is transforms and alpha only.
 */

const GOO_TINT = 0x7ccb66
const GOO_DARK = 0x4c8f3e

const GOO_LIFE_TICKS = Math.ceil(GOO_LIFE_MS / TICK_MS)
const TRAP_LIFE_TICKS = Math.ceil(TRAP_LIFE_MS / TICK_MS)
const TRAP_ARM_TICKS = Math.ceil(TRAP_ARM_MS / TICK_MS)
const WEB_LIFE_TICKS = Math.ceil(WEB_PATCH_LIFE_MS / TICK_MS)

/** A landed web: concentric silk rings + radial threads, on the same fat-pixel grid. */
const drawWebPatch = (g: Graphics): void => {
  for (const frac of [0.45, 0.75, 1]) {
    const r = WEB_PATCH_RADIUS * frac
    const segs = 10
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2 + frac * 2.1
      g.rect(Math.cos(a) * r - 3, Math.sin(a) * r - 3, 6, 6).fill({ color: NEST_WEB_COLOR, alpha: 0.5 })
    }
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3
    g.moveTo(0, 0).lineTo(Math.cos(a) * WEB_PATCH_RADIUS, Math.sin(a) * WEB_PATCH_RADIUS)
  }
  g.stroke({ color: NEST_WEB_COLOR, alpha: 0.35, width: 2.5 })
  g.rect(-6, -6, 12, 12).fill({ color: 0xffffff, alpha: 0.5 })
}

export interface ToolsLayer {
  container: Container
  /** Floor pickups: [i][0] = goo jar glyph, [i][1] = trap glyph (one visible per spawn). */
  floorGoo: Graphics[]
  floorTrap: Graphics[]
  /** Deployed pool: puddle + jaws + web patch per slot, toggled by type. */
  puddles: Graphics[]
  jaws: Graphics[]
  webPatches: Graphics[]
}

/**
 * The puddle decal: an irregular splat of fat pixels on the same grid as everything
 * else. Sized to roughly cover GOO_RADIUS — a slow from unseen goo would read as a bug.
 */
const drawPuddle = (g: Graphics): void => {
  const CELL = 20
  // 'D' dark goo, 'o' bright goo.
  const rows = [
    '..DDDD...',
    '.DooooD..',
    'DooooooDD',
    'DoooooooD',
    '.DoooooD.',
    '..DDoDD..',
    '.....D...',
  ]
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!
    for (let x = 0; x < row.length; x++) {
      const c = row[x]!
      if (c === '.') continue
      const color = c === 'D' ? GOO_DARK : GOO_TINT
      g.rect((x - 4.5) * CELL, (y - 3.5) * CELL, CELL, CELL).fill({ color, alpha: c === 'D' ? 0.5 : 0.42 })
    }
  }
}

export const createToolsLayer = (): ToolsLayer => {
  const container = new Container()
  const floorGoo: Graphics[] = []
  const floorTrap: Graphics[] = []
  for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
    const jar = new Graphics()
    paintIcon(jar, JAR_ICON, 3)
    jar.visible = false
    container.addChild(jar)
    floorGoo.push(jar)

    const trap = new Graphics()
    paintIcon(trap, TRAP_ICON, 2.4)
    trap.visible = false
    container.addChild(trap)
    floorTrap.push(trap)
  }

  const puddles: Graphics[] = []
  const jaws: Graphics[] = []
  const webPatches: Graphics[] = []
  for (let i = 0; i < MAX_DEPLOYED; i++) {
    const p = new Graphics()
    drawPuddle(p)
    p.visible = false
    container.addChild(p)
    puddles.push(p)

    const j = new Graphics()
    paintIcon(j, TRAP_ICON, 3)
    j.visible = false
    container.addChild(j)
    jaws.push(j)

    const wp = new Graphics()
    drawWebPatch(wp)
    wp.visible = false
    container.addChild(wp)
    webPatches.push(wp)
  }

  return { container, floorGoo, floorTrap, puddles, jaws, webPatches }
}

export const renderTools = (layer: ToolsLayer, world: World, nowMs: number): void => {
  // Floor pickups.
  for (let i = 0; i < MAX_TOOL_SPAWNS; i++) {
    const type = world.toolType[i]!
    const show = world.toolTaken[i] === 0
    const jar = layer.floorGoo[i]!
    const trap = layer.floorTrap[i]!
    jar.visible = show && type === TOOL_GOO
    trap.visible = show && type === TOOL_TRAP
    const g = type === TOOL_GOO ? jar : trap
    if (!g.visible) continue
    g.x = world.toolX[i]!
    g.y = world.toolY[i]! - 6 + Math.sin(nowMs * 0.003 + i * 2.1) * 4
    g.alpha = 0.85 + 0.15 * Math.sin(nowMs * 0.006 + i)
  }

  // Deployed tools.
  for (let i = 0; i < MAX_DEPLOYED; i++) {
    const type = world.depType[i]!
    const puddle = layer.puddles[i]!
    const jaw = layer.jaws[i]!
    const webPatch = layer.webPatches[i]!
    puddle.visible = type === TOOL_GOO
    jaw.visible = type === TOOL_TRAP
    webPatch.visible = type === TOOL_WEB
    if (type === TOOL_WEB) {
      webPatch.x = world.depX[i]!
      webPatch.y = world.depY[i]!
      const left = world.depUntilTick[i]! - world.tick
      webPatch.alpha = 0.8 * Math.min(1, (left / WEB_LIFE_TICKS) * 3)
    }
    if (type === TOOL_GOO) {
      puddle.x = world.depX[i]!
      puddle.y = world.depY[i]!
      // Dries up: full presence most of its life, fading over the last quarter.
      const left = world.depUntilTick[i]! - world.tick
      puddle.alpha = 0.55 * Math.min(1, (left / GOO_LIFE_TICKS) * 4)
    } else if (type === TOOL_TRAP) {
      jaw.x = world.depX[i]!
      jaw.y = world.depY[i]!
      const age = TRAP_LIFE_TICKS - (world.depUntilTick[i]! - world.tick)
      if (age < TRAP_ARM_TICKS) {
        // Arming: blink hard so the owner (standing right there) knows to step away.
        jaw.alpha = Math.sin(nowMs * 0.03) > 0 ? 0.9 : 0.25
      } else {
        // Armed: quiet and easy to miss in the dusk — that is the trap.
        jaw.alpha = 0.42
      }
    }
  }
}
