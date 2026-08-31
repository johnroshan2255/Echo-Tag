import { Decor, MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAP_W, MAP_H, TILE_FURNITURE, TILE_WALL } from '@echo-tag/shared'
import type { GameMap } from '@echo-tag/shared'
import {
  cosmeticRng,
  DOOR_EDGE,
  DOOR_FILL,
  DOOR_THICKNESS,
  FLOOR,
  FLOOR_CRACK,
  FLOOR_CRACK_LIT,
  FLOOR_CRACKS_PER_MAP,
  FLOOR_SPECKLE,
  LAMP_HEAD,
  LAMP_LIGHT_ALPHA,
  LAMP_LIGHT_RADIUS,
  LAMP_POST,
  PLANT_LEAF,
  PLANT_POT,
  RUBBLE,
  RUBBLE_DARK,
  RUG_BORDER,
  RUG_FILL,
  SPECKLES_PER_MAP,
  WALL_CRACK,
  WALL_CRACKS_PER_MAP,
  WALL_FILL,
  WALL_RIM,
  WALL_TUFT,
  WARDROBE_FILL,
  WARDROBE_HANDLE,
  WARDROBE_PANEL,
  WEB_ALPHA,
  WEB_COLOR,
  WEBS_PER_MAP,
  WINDOW_FRAME,
  WINDOW_GLOW,
  WOOD_DARK,
  WOOD_FILL,
  WOOD_GRAIN,
} from '../game/theme.ts'

/**
 * The map preview: a true miniature of the arena.
 *
 * This is a canvas-2D port of `render/arena.ts`, pass for pass, with the SAME seed and the
 * SAME rng call order — so the speckles, cracks, webs, eroded edges and crumbled corners
 * land exactly where the real map has them. What the picker shows is what you spawn into,
 * shrunk: the whole 40x22 arena scaled onto the canvas, closed doors and lamp glow
 * included. Only the live things are absent (players, fireflies, fog).
 *
 * Boot-chunk rules apply: no PixiJS, no Preact — `theme.ts` is pure constants, so the
 * palette stays single-sourced without dragging the engine in.
 */

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

export const drawMinimap = (ctx: CanvasRenderingContext2D, map: GameMap, canvasW: number, canvasH: number): void => {
  const rng = cosmeticRng(0xc02e + map.index * 977)
  const walls = map.walls
  const decor = map.decor
  const isWallAt = (tx: number, ty: number): boolean =>
    tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y || walls[ty * MAP_TILES_X + tx] === 1

  // Draw everything in world units; the transform shrinks the 3200x1760 arena to fit.
  ctx.setTransform(canvasW / MAP_W, 0, 0, canvasH / MAP_H, 0, 0)
  ctx.globalAlpha = 1

  const rect = (x: number, y: number, w: number, h: number, color: number, alpha = 1): void => {
    ctx.globalAlpha = alpha
    ctx.fillStyle = css(color)
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 1
  }
  const stroke = (color: number, alpha: number, width: number): void => {
    ctx.strokeStyle = css(color)
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Ground.
  rect(0, 0, MAP_W, MAP_H, FLOOR)

  // Leaf litter.
  for (let i = 0; i < SPECKLES_PER_MAP; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    const tx = tile % MAP_TILES_X
    const ty = (tile / MAP_TILES_X) | 0
    const x = tx * MAP_TILE + rng() * MAP_TILE
    const y = ty * MAP_TILE + rng() * MAP_TILE
    const s = rng() < 0.25 ? 5 : 3
    rect(x, y, s, s, FLOOR_SPECKLE, 0.5 + rng() * 0.5)
  }

  // Floor cracks with rubble.
  for (let i = 0; i < FLOOR_CRACKS_PER_MAP; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    let x = (tile % MAP_TILES_X) * MAP_TILE + rng() * MAP_TILE
    let y = ((tile / MAP_TILES_X) | 0) * MAP_TILE + rng() * MAP_TILE
    let a = rng() * Math.PI * 2
    const segs = 3 + ((rng() * 3) | 0)
    ctx.beginPath()
    ctx.moveTo(x, y)
    const litPts: number[] = [x, y]
    for (let k = 0; k < segs; k++) {
      a += (rng() - 0.5) * 1.6
      x += Math.cos(a) * (26 + rng() * 34)
      y += Math.sin(a) * (26 + rng() * 34)
      ctx.lineTo(x, y)
      litPts.push(x, y)
    }
    stroke(FLOOR_CRACK, 0.95, 3.5)
    ctx.beginPath()
    ctx.moveTo(litPts[0]! + 2, litPts[1]! + 2)
    for (let k = 2; k < litPts.length; k += 2) ctx.lineTo(litPts[k]! + 2, litPts[k + 1]! + 2)
    stroke(FLOOR_CRACK_LIT, 0.28, 1.5)
    if (rng() < 0.55) {
      for (let r = 0; r < 3 + ((rng() * 3) | 0); r++) {
        const sz = 4 + rng() * 7
        rect(x + (rng() - 0.5) * 46, y + (rng() - 0.5) * 46, sz, sz, rng() < 0.5 ? RUBBLE : RUBBLE_DARK, 0.8)
      }
    }
  }

  // Rugs.
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Rug) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    const rw = MAP_TILE * 3
    const rh = MAP_TILE * 2
    rect(x, y, rw, rh, RUG_FILL, 0.55)
    ctx.beginPath()
    ctx.rect(x, y, rw, rh)
    stroke(RUG_BORDER, 0.6, 5)
    ctx.beginPath()
    ctx.rect(x + 14, y + 14, rw - 28, rh - 28)
    stroke(RUG_BORDER, 0.35, 3)
  }

  // Hedge fill, merged runs.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === TILE_WALL) run++
      rect(tx * MAP_TILE, ty * MAP_TILE, run * MAP_TILE, MAP_TILE, WALL_FILL)
      tx += run - 1
    }
  }

  // Furniture: tabletop, grain, plank lines, base shadow.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_FURNITURE) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === TILE_FURNITURE) run++
      const x = tx * MAP_TILE
      const y = ty * MAP_TILE
      const wpx = run * MAP_TILE
      rect(x + 4, y + MAP_TILE - 12, wpx - 8, 10, WOOD_DARK, 0.8)
      rect(x + 6, y + 6, wpx - 12, MAP_TILE - 16, WOOD_FILL)
      rect(x + 6, y + 6, wpx - 12, 6, WOOD_GRAIN)
      for (let px = x + 22; px < x + wpx - 14; px += 26) {
        rect(px, y + 14, 3, MAP_TILE - 26, WOOD_DARK, 0.5)
      }
      tx += run - 1
    }
  }

  // Cobwebs in inside corners — same corner walk and stride as the arena.
  {
    const corners: Array<[number, number, number, number]> = []
    for (let ty = 1; ty < MAP_TILES_Y - 1; ty++) {
      for (let tx = 1; tx < MAP_TILES_X - 1; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== 0) continue
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          if (isWallAt(tx + dx, ty) && isWallAt(tx, ty + dy)) {
            corners.push([(tx + (dx < 0 ? 0 : 1)) * MAP_TILE, (ty + (dy < 0 ? 0 : 1)) * MAP_TILE, -dx, -dy])
          }
        }
      }
    }
    const stride = Math.max(1, Math.floor(corners.length / WEBS_PER_MAP))
    const offset = Math.floor(rng() * stride)
    for (let n = 0; n < WEBS_PER_MAP && n * stride + offset < corners.length; n++) {
      const [x, y, dx, dy] = corners[n * stride + offset]!
      const size = 46 + rng() * 34
      ctx.beginPath()
      for (const frac of [0.45, 0.72, 1]) {
        const r = size * frac
        ctx.moveTo(x + dx * r, y)
        for (let k = 1; k <= 4; k++) {
          const a = (k / 4) * (Math.PI / 2)
          const sag = 1 - 0.12 * Math.sin(a * 2)
          ctx.lineTo(x + dx * Math.cos(a) * r * sag, y + dy * Math.sin(a) * r * sag)
        }
      }
      for (const a of [0.12, 0.5, 0.88]) {
        ctx.moveTo(x, y)
        ctx.lineTo(x + dx * Math.cos(a * (Math.PI / 2)) * size, y + dy * Math.sin(a * (Math.PI / 2)) * size)
      }
      stroke(WEB_COLOR, WEB_ALPHA, 2.5)
    }
  }

  // Wardrobes: plinth, carcass, two door panels, seam, handles.
  const wr = map.wardrobes
  for (let i = 0; i < wr.length; i += 4) {
    const x = wr[i]! * MAP_TILE
    const y = wr[i + 1]! * MAP_TILE
    rect(x + 2, y + MAP_TILE - 10, MAP_TILE - 4, 8, 0x090b11, 0.8)
    rect(x + 4, y + 2, MAP_TILE - 8, MAP_TILE - 10, WARDROBE_FILL)
    rect(x + 8, y + 8, MAP_TILE / 2 - 10, MAP_TILE - 22, WARDROBE_PANEL)
    rect(x + MAP_TILE / 2 + 2, y + 8, MAP_TILE / 2 - 10, MAP_TILE - 22, WARDROBE_PANEL)
    rect(x + MAP_TILE / 2 - 1, y + 6, 2, MAP_TILE - 16, 0x090b11, 0.6)
    rect(x + MAP_TILE / 2 - 8, y + MAP_TILE / 2 - 6, 4, 10, WARDROBE_HANDLE)
    rect(x + MAP_TILE / 2 + 4, y + MAP_TILE / 2 - 6, 4, 10, WARDROBE_HANDLE)
  }

  // Windows: lit panes with cross mullions.
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Window) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    rect(x + 16, y + 20, MAP_TILE - 32, MAP_TILE - 40, WINDOW_FRAME)
    rect(x + 20, y + 24, MAP_TILE - 40, MAP_TILE - 48, WINDOW_GLOW, 0.6)
    rect(x + MAP_TILE / 2 - 2, y + 22, 4, MAP_TILE - 44, WINDOW_FRAME)
    rect(x + 18, y + MAP_TILE / 2 - 2, MAP_TILE - 36, 4, WINDOW_FRAME)
  }

  // Standing props: plants and lamps.
  for (let i = 0; i < decor.length; i += 3) {
    const cx = (decor[i + 1]! + 0.5) * MAP_TILE
    const cy = (decor[i + 2]! + 0.5) * MAP_TILE
    if (decor[i] === Decor.Plant) {
      rect(cx - 12, cy + 2, 24, 18, PLANT_POT)
      rect(cx - 17, cy - 16, 14, 16, PLANT_LEAF)
      rect(cx - 4, cy - 24, 13, 22, PLANT_LEAF, 0.85)
      rect(cx + 6, cy - 12, 11, 13, PLANT_LEAF, 0.7)
    } else if (decor[i] === Decor.Lamp) {
      rect(cx - 4, cy - 26, 8, 40, LAMP_POST)
      rect(cx - 12, cy + 12, 24, 6, LAMP_POST)
      rect(cx - 10, cy - 40, 20, 16, LAMP_HEAD, 0.95)
    }
  }

  // Leafy clumps inside the hedges.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      const n = 2 + ((rng() * 2) | 0)
      for (let k = 0; k < n; k++) {
        const s = 10 + rng() * 16
        const x = tx * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
        const y = ty * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
        rect(x, y, s, s, WALL_TUFT, 0.35 + rng() * 0.4)
      }
    }
  }

  // Eroded wall edges with mossy rims — the ragged silhouettes of the real arena.
  const edge = (x: number, y: number, horizontal: boolean, outward: number): void => {
    const SEGS = 4
    for (let k = 0; k < SEGS; k++) {
      const len = MAP_TILE / SEGS
      const thick = 3 + rng() * 5
      const slump = rng() < 0.3 ? (2 + rng() * 6) * outward : 0
      if (horizontal) {
        const sy = outward > 0 ? y - thick + slump : y - slump
        rect(x + k * len, sy, len + 1, thick + Math.abs(slump), WALL_FILL)
        rect(x + k * len, outward > 0 ? sy : y + thick - slump - 2, len + 1, 2.5 + rng() * 2, WALL_RIM, 0.7 + rng() * 0.25)
      } else {
        const sx = outward > 0 ? x - thick + slump : x - slump
        rect(sx, y + k * len, thick + Math.abs(slump), len + 1, WALL_FILL)
        rect(outward > 0 ? sx : x + thick - slump - 2, y + k * len, 2.5 + rng() * 2, len + 1, WALL_RIM, 0.7 + rng() * 0.25)
      }
    }
  }
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      const x = tx * MAP_TILE
      const y = ty * MAP_TILE
      if (!isWallAt(tx, ty - 1)) edge(x, y, true, -1)
      if (!isWallAt(tx, ty + 1)) edge(x, y + MAP_TILE, true, 1)
      if (!isWallAt(tx - 1, ty)) edge(x, y, false, -1)
      if (!isWallAt(tx + 1, ty)) edge(x + MAP_TILE, y, false, 1)
    }
  }

  // Crumbled corners with spilled rubble.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        if (isWallAt(tx + dx, ty) || isWallAt(tx, ty + dy)) continue
        const cx = (tx + (dx < 0 ? 0 : 1)) * MAP_TILE
        const cy = (ty + (dy < 0 ? 0 : 1)) * MAP_TILE
        const bite = 8 + rng() * 12
        rect(cx - (dx < 0 ? 0 : bite), cy - (dy < 0 ? 0 : bite), bite, bite, FLOOR)
        const half = bite * 0.55
        rect(cx - (dx < 0 ? -bite : bite + half), cy - (dy < 0 ? 0 : half), half, half, FLOOR, 0.9)
        for (let r = 0; r < 2 + ((rng() * 3) | 0); r++) {
          const sz = 5 + rng() * 8
          rect(cx - dx * (4 + rng() * 22) - sz / 2, cy - dy * (4 + rng() * 22) - sz / 2, sz, sz, rng() < 0.4 ? WALL_RIM : RUBBLE, 0.75)
        }
      }
    }
  }

  // Wall cracks.
  {
    const wallTiles: number[] = []
    for (let i = 0; i < walls.length; i++) if (walls[i] === TILE_WALL) wallTiles.push(i)
    for (let i = 0; i < WALL_CRACKS_PER_MAP && wallTiles.length > 0; i++) {
      const t = wallTiles[Math.floor(rng() * wallTiles.length)]!
      let x = (t % MAP_TILES_X) * MAP_TILE + 10 + rng() * (MAP_TILE - 20)
      let y = ((t / MAP_TILES_X) | 0) * MAP_TILE + 10 + rng() * (MAP_TILE - 20)
      let a = rng() * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let k = 0; k < 3; k++) {
        a += (rng() - 0.5) * 1.4
        x += Math.cos(a) * (12 + rng() * 16)
        y += Math.sin(a) * (12 + rng() * 16)
        ctx.lineTo(x, y)
      }
      stroke(WALL_CRACK, 0.9, 2.5)
    }
  }

  // Doors, closed: two timber leaves per doorway with a lighter edge strip, exactly where
  // renderDoors puts them at openness 0.
  const doors = map.doors
  for (let d = 0; d < doors.length; d += 3) {
    const axis = doors[d + 2]!
    for (const side of [0, 1]) {
      const tx = doors[d]! + (axis === 0 ? side : 0)
      const ty = doors[d + 1]! + (axis === 1 ? side : 0)
      const cx = (tx + 0.5) * MAP_TILE
      const cy = (ty + 0.5) * MAP_TILE
      if (axis === 0) {
        rect(cx - MAP_TILE / 2, cy - DOOR_THICKNESS / 2, MAP_TILE, DOOR_THICKNESS, DOOR_FILL)
        rect(cx - MAP_TILE / 2, cy - DOOR_THICKNESS / 2, MAP_TILE, 4, DOOR_EDGE)
      } else {
        rect(cx - DOOR_THICKNESS / 2, cy - MAP_TILE / 2, DOOR_THICKNESS, MAP_TILE, DOOR_FILL)
        rect(cx - DOOR_THICKNESS / 2, cy - MAP_TILE / 2, 4, MAP_TILE, DOOR_EDGE)
      }
    }
  }

  // Lamp light pools and window spill: the fx layer's additive warmth, so rooms glow.
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < decor.length; i += 3) {
    const kind = decor[i]
    if (kind !== Decor.Lamp && kind !== Decor.Window) continue
    const cx = (decor[i + 1]! + 0.5) * MAP_TILE
    const cy = (decor[i + 2]! + 0.5) * MAP_TILE
    const r = kind === Decor.Lamp ? LAMP_LIGHT_RADIUS : LAMP_LIGHT_RADIUS * 0.55
    const a = kind === Decor.Lamp ? LAMP_LIGHT_ALPHA : LAMP_LIGHT_ALPHA * 0.7
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, `rgba(255, 217, 163, ${a})`)
    grad.addColorStop(1, 'rgba(255, 217, 163, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
