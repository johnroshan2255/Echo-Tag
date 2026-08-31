import { Decor, MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAP_W, MAP_H, Monster, MONSTER_BY_MAP, NEST_RADIUS, TILE_FURNITURE, TILE_WALL } from '@echo-tag/shared'
import type { GameMap } from '@echo-tag/shared'
import {
  cosmeticRng,
  DOOR_EDGE,
  DOOR_FILL,
  DOOR_THICKNESS,
  LAMP_LIGHT_ALPHA,
  LAMP_LIGHT_RADIUS,
  LAMP_POST,
  NEST_SPIDER_BODY,
  NEST_SPIDER_EYE,
  NEST_WEB_COLOR,
  PLANT_LEAF,
  PLANT_POT,
  PORTAL_COLOR,
  PORTAL_CORE,
  RUG_BORDER,
  RUG_FILL,
  THEMES,
  WallStyle,
  WARDROBE_FILL,
  WARDROBE_HANDLE,
  WARDROBE_PANEL,
  WEB_ALPHA,
  WEB_COLOR,
  WINDOW_FRAME,
  WOOD_DARK,
  WOOD_FILL,
  WOOD_GRAIN,
  type MapTheme,
} from '../game/theme.ts'

/**
 * The map preview: a true miniature of the arena.
 *
 * This is a canvas-2D port of `render/arena.ts`, pass for pass, with the SAME seed and
 * the SAME rng call order per theme — so every speckle, grass blade, web and eroded edge
 * lands exactly where the real map has them. Change a pass there and change it here.
 * Closed doors, portal pads, nest spiders and lamp glow are painted too; only the live
 * things are absent (players, fireflies, fog).
 *
 * Boot-chunk rules apply: no PixiJS, no Preact — `theme.ts` is pure constants.
 */

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

export const drawMinimap = (ctx: CanvasRenderingContext2D, map: GameMap, canvasW: number, canvasH: number): void => {
  const theme: MapTheme = THEMES[map.index] ?? THEMES[0]!
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
  const strokeRect = (x: number, y: number, w: number, h: number, color: number, alpha: number, width: number): void => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = css(color)
    ctx.lineWidth = width
    ctx.strokeRect(x, y, w, h)
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
  rect(0, 0, MAP_W, MAP_H, theme.floor)

  // Hive floors are plated: seam lines on the tile grid.
  if (theme.panelSeams) {
    for (let tx = 1; tx < MAP_TILES_X; tx++) rect(tx * MAP_TILE - 1, 0, 2, MAP_H, 0x10161f, 0.9)
    for (let ty = 1; ty < MAP_TILES_Y; ty++) rect(0, ty * MAP_TILE - 1, MAP_W, 2, 0x10161f, 0.9)
  }

  // Speckles.
  for (let i = 0; i < theme.speckles; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    const tx = tile % MAP_TILES_X
    const ty = (tile / MAP_TILES_X) | 0
    const x = tx * MAP_TILE + rng() * MAP_TILE
    const y = ty * MAP_TILE + rng() * MAP_TILE
    const s = rng() < 0.25 ? 5 : 3
    rect(x, y, s, s, theme.floorSpeckle, 0.5 + rng() * 0.5)
  }

  // Forest ground sprouts.
  if (theme.grass) {
    for (let i = 0; i < map.openTiles.length; i++) {
      if (rng() >= 0.3) continue
      const tile = map.openTiles[i]!
      const bx = (tile % MAP_TILES_X) * MAP_TILE
      const by = ((tile / MAP_TILES_X) | 0) * MAP_TILE
      const n = 1 + ((rng() * 2) | 0)
      for (let k = 0; k < n; k++) {
        const x = bx + 6 + rng() * (MAP_TILE - 12)
        const y = by + 6 + rng() * (MAP_TILE - 12)
        const h = 8 + rng() * 8
        rect(x, y - h, 3, h, 0x4f7a3c, 0.7)
        if (rng() < 0.5) rect(x + 4, y - h * 0.6, 3, h * 0.6, 0x3f6430, 0.6)
        if (rng() < 0.06) rect(x - 1, y - h - 5, 5, 5, 0xf2b4c6, 0.9)
      }
    }
  }

  // Floor cracks with rubble.
  for (let i = 0; i < theme.floorCracks; i++) {
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
    stroke(theme.floorCrack, 0.95, 3.5)
    ctx.beginPath()
    ctx.moveTo(litPts[0]! + 2, litPts[1]! + 2)
    for (let k = 2; k < litPts.length; k += 2) ctx.lineTo(litPts[k]! + 2, litPts[k + 1]! + 2)
    stroke(theme.floorCrackLit, 0.28, 1.5)
    if (rng() < 0.55) {
      for (let r = 0; r < 3 + ((rng() * 3) | 0); r++) {
        const sz = 4 + rng() * 7
        rect(x + (rng() - 0.5) * 46, y + (rng() - 0.5) * 46, sz, sz, rng() < 0.5 ? theme.rubble : theme.rubbleDark, 0.8)
      }
    }
  }

  // Rugs (recessed deck panels on the hive — mirror arena.ts).
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Rug) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    const rw = MAP_TILE * 3
    const rh = MAP_TILE * 2
    if (theme.panelSeams) {
      rect(x, y, rw, rh, 0x131b28, 0.9)
      strokeRect(x, y, rw, rh, theme.wallRim, 0.25, 3)
      continue
    }
    rect(x, y, rw, rh, RUG_FILL, 0.55)
    strokeRect(x, y, rw, rh, RUG_BORDER, 0.6, 5)
    strokeRect(x + 14, y + 14, rw - 28, rh - 28, RUG_BORDER, 0.35, 3)
  }

  // Wall fill, merged runs.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === TILE_WALL) run++
      rect(tx * MAP_TILE, ty * MAP_TILE, run * MAP_TILE, MAP_TILE, theme.wallFill)
      tx += run - 1
    }
  }

  // Cave strata.
  if (theme.strata) {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        rect(x, y + MAP_TILE * 0.3, MAP_TILE, 3, theme.wallRim, 0.14)
        rect(x, y + MAP_TILE * 0.68, MAP_TILE, 2, theme.wallRim, 0.1)
      }
    }
  }

  // Furniture.
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

  // Cobwebs — same corner walk and stride as the arena.
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
    const stride = Math.max(1, Math.floor(corners.length / Math.max(1, theme.webs)))
    const offset = Math.floor(rng() * stride)
    for (let n = 0; n < theme.webs && n * stride + offset < corners.length; n++) {
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

  // Wardrobes.
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

  // Windows.
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Window) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    rect(x + 16, y + 20, MAP_TILE - 32, MAP_TILE - 40, WINDOW_FRAME)
    rect(x + 20, y + 24, MAP_TILE - 40, MAP_TILE - 48, theme.windowGlow, 0.6)
    rect(x + MAP_TILE / 2 - 2, y + 22, 4, MAP_TILE - 44, WINDOW_FRAME)
    rect(x + 18, y + MAP_TILE / 2 - 2, MAP_TILE - 36, 4, WINDOW_FRAME)
  }

  // Standing props.
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
      rect(cx - 10, cy - 40, 20, 16, theme.lampHead, 0.95)
    }
  }

  // Interior clumps / metal vents.
  if (theme.wallStyle !== WallStyle.Metal) {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        const n = 2 + ((rng() * 2) | 0)
        for (let k = 0; k < n; k++) {
          const s = 10 + rng() * 16
          const x = tx * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
          const y = ty * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
          rect(x, y, s, s, theme.wallTuft, 0.35 + rng() * 0.4)
        }
      }
    }
  } else {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        if ((tx * 7 + ty * 13) % 5 !== 0) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        rect(x + 24, y + 30, 32, 20, theme.wallTuft, 0.8)
        for (let vy = 0; vy < 3; vy++) rect(x + 27, y + 34 + vy * 5, 26, 2, 0x0a0f18, 0.8)
      }
    }
  }

  // Tree trunks.
  if (theme.wallStyle === WallStyle.Trees) {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        if (isWallAt(tx, ty + 1)) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        rect(x + MAP_TILE / 2 - 9, y + MAP_TILE - 24, 18, 24, theme.trunk)
        rect(x + MAP_TILE / 2 - 9, y + MAP_TILE - 24, 4, 24, 0x33241a, 0.7)
      }
    }
  }

  if (theme.eroded) {
    // Eroded wall edges with rims.
    const edge = (x: number, y: number, horizontal: boolean, outward: number): void => {
      const SEGS = 4
      for (let k = 0; k < SEGS; k++) {
        const len = MAP_TILE / SEGS
        const thick = 3 + rng() * 5
        const slump = rng() < 0.3 ? (2 + rng() * 6) * outward : 0
        if (horizontal) {
          const sy = outward > 0 ? y - thick + slump : y - slump
          rect(x + k * len, sy, len + 1, thick + Math.abs(slump), theme.wallFill)
          rect(x + k * len, outward > 0 ? sy : y + thick - slump - 2, len + 1, 2.5 + rng() * 2, theme.wallRim, 0.7 + rng() * 0.25)
        } else {
          const sx = outward > 0 ? x - thick + slump : x - slump
          rect(sx, y + k * len, thick + Math.abs(slump), len + 1, theme.wallFill)
          rect(outward > 0 ? sx : x + thick - slump - 2, y + k * len, 2.5 + rng() * 2, len + 1, theme.wallRim, 0.7 + rng() * 0.25)
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
          rect(cx - (dx < 0 ? 0 : bite), cy - (dy < 0 ? 0 : bite), bite, bite, theme.floor)
          const half = bite * 0.55
          rect(cx - (dx < 0 ? -bite : bite + half), cy - (dy < 0 ? 0 : half), half, half, theme.floor, 0.9)
          for (let r = 0; r < 2 + ((rng() * 3) | 0); r++) {
            const sz = 5 + rng() * 8
            rect(cx - dx * (4 + rng() * 22) - sz / 2, cy - dy * (4 + rng() * 22) - sz / 2, sz, sz, rng() < 0.4 ? theme.wallRim : theme.rubble, 0.75)
          }
        }
      }
    }
  } else {
    // Machined trim.
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        if (!isWallAt(tx, ty - 1)) rect(x, y, MAP_TILE, 3, theme.wallRim, 0.55)
        if (!isWallAt(tx, ty + 1)) rect(x, y + MAP_TILE - 3, MAP_TILE, 3, theme.wallRim, 0.55)
        if (!isWallAt(tx - 1, ty)) rect(x, y, 3, MAP_TILE, theme.wallRim, 0.55)
        if (!isWallAt(tx + 1, ty)) rect(x + MAP_TILE - 3, y, 3, MAP_TILE, theme.wallRim, 0.55)
      }
    }
  }

  // Wall cracks.
  {
    const wallTiles: number[] = []
    for (let i = 0; i < walls.length; i++) if (walls[i] === TILE_WALL) wallTiles.push(i)
    for (let i = 0; i < theme.wallCracks && wallTiles.length > 0; i++) {
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
      stroke(theme.wallCrack, 0.9, 2.5)
    }
  }

  // Lair territories + the resident grabber, so the preview warns exactly like the
  // arena: webbed spider dens, or the hive's teal abduction pads with a saucer.
  const nests = map.nests
  const ufoLairs = MONSTER_BY_MAP[map.index] === Monster.Alien
  for (let n = 0; n < nests.length; n += 2) {
    const cx = (nests[n]! + 0.5) * MAP_TILE
    const cy = (nests[n + 1]! + 0.5) * MAP_TILE
    if (ufoLairs) {
      rect(cx - 30, cy - 30, 60, 60, 0x0a141c, 0.55)
      for (const frac of [0.7, 1]) {
        const r = NEST_RADIUS * frac
        const segs = 16
        for (let k = 0; k < segs; k++) {
          const a = (k / segs) * Math.PI * 2 + frac * 2.3
          rect(cx + Math.cos(a) * r - 4, cy + Math.sin(a) * r - 2, 8, 4, 0x2fd4b8, 0.2)
        }
      }
      // The saucer: hull disc, glass dome, running lights.
      rect(cx - 22, cy - 46, 44, 10, 0x8fa4c4)
      rect(cx - 10, cy - 54, 20, 9, 0xbfffe8, 0.9)
      rect(cx - 14, cy - 35, 4, 4, 0x2fd4b8)
      rect(cx + 10, cy - 35, 4, 4, 0x2fd4b8)
      continue
    }
    rect(cx - 26, cy - 26, 52, 52, 0x0d0a16, 0.5)
    for (const frac of [0.55, 0.8, 1]) {
      const r = NEST_RADIUS * frac
      const segs = 14
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2 + frac * 1.7
        rect(cx + Math.cos(a) * r - 3, cy + Math.sin(a) * r - 3, 6, 6, NEST_WEB_COLOR, 0.16)
      }
    }
    ctx.beginPath()
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.4
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * NEST_RADIUS, cy + Math.sin(a) * NEST_RADIUS)
    }
    stroke(NEST_WEB_COLOR, 0.1, 2)
    // The spider itself: fat body, red eyes, splayed legs.
    rect(cx - 12, cy - 9, 24, 18, NEST_SPIDER_BODY)
    rect(cx - 7, cy - 15, 14, 8, NEST_SPIDER_BODY)
    rect(cx - 5, cy - 13, 3, 3, NEST_SPIDER_EYE)
    rect(cx + 2, cy - 13, 3, 3, NEST_SPIDER_EYE)
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 4; leg++) {
        rect(cx + side * (12 + leg * 2), cy - 8 + leg * 5, side * 10, 3, NEST_SPIDER_BODY, 0.9)
      }
    }
  }

  // Portal pads.
  const portals = map.portals
  for (let p = 0; p < portals.length; p += 4) {
    const cx = (portals[p]! + 0.5) * MAP_TILE
    const cy = (portals[p + 1]! + 0.5) * MAP_TILE
    rect(cx - 34, cy - 34, 68, 68, 0x0d0a16, 0.6)
    strokeRect(cx - 34, cy - 34, 68, 68, PORTAL_COLOR, 0.5, 4)
    strokeRect(cx - 22, cy - 22, 44, 44, PORTAL_COLOR, 0.35, 3)
    rect(cx - 5, cy - 5, 10, 10, PORTAL_CORE, 0.8)
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      rect(cx + nx * 30 - 3, cy + ny * 30 - 3, 6, 6, PORTAL_CORE, 0.7)
    }
  }

  // Doors, closed: two timber leaves per doorway with a lighter edge strip.
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

  // Lamp light pools and window spill: the fx layer's additive warmth.
  ctx.globalCompositeOperation = 'lighter'
  const lampR = (theme.lampHead >> 16) & 0xff
  const lampG = (theme.lampHead >> 8) & 0xff
  const lampB = theme.lampHead & 0xff
  for (let i = 0; i < decor.length; i += 3) {
    const kind = decor[i]
    if (kind !== Decor.Lamp && kind !== Decor.Window) continue
    const cx = (decor[i + 1]! + 0.5) * MAP_TILE
    const cy = (decor[i + 2]! + 0.5) * MAP_TILE
    const r = kind === Decor.Lamp ? LAMP_LIGHT_RADIUS : LAMP_LIGHT_RADIUS * 0.55
    const a = kind === Decor.Lamp ? LAMP_LIGHT_ALPHA : LAMP_LIGHT_ALPHA * 0.7
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, `rgba(${lampR}, ${lampG}, ${lampB}, ${a})`)
    grad.addColorStop(1, `rgba(${lampR}, ${lampG}, ${lampB}, 0)`)
    ctx.fillStyle = grad
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}
