import { MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAP_W, MAP_H, NEST_RADIUS, TILE_FURNITURE, TILE_WALL } from '@echo-tag/shared/constants'
import { Decor, type GameMap } from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import {
  cosmeticRng,
  NEST_WEB_COLOR,
  PORTAL_COLOR,
  PORTAL_CORE,
  THEMES,
  WallStyle,
  WEB_ALPHA,
  WEB_COLOR,
  WARDROBE_FILL,
  WARDROBE_HANDLE,
  WARDROBE_PANEL,
  WINDOW_FRAME,
  LAMP_POST,
  PLANT_LEAF,
  PLANT_POT,
  RUG_BORDER,
  RUG_FILL,
  WOOD_DARK,
  WOOD_FILL,
  WOOD_GRAIN,
  type MapTheme,
} from '../theme.ts'

/**
 * The world, drawn per-theme (ADR 0006 grown up: each map is a WORLD).
 *
 * One `Graphics` in world coordinates, rebuilt only on map change — the camera moves the
 * container, so scrolling costs nothing here.
 *
 * The same tile data dresses four different ways: the manor keeps the hedge-maze-at-dusk
 * look, the forest grows grass and canopy-trees with visible trunks, the cave is bare
 * stone under fifty years of webs, and the hive is seamed deck-plate with glowing trim.
 * All of it stays squares and rects — pixel language everywhere — and all of it is seeded
 * per map so a map always dresses itself identically. boot/minimap.ts mirrors these
 * passes with the same seed and the same rng call order, which is what keeps the lobby
 * preview an exact screenshot; change a pass here and change it there.
 */

export interface ArenaLayer {
  container: Container
  graphics: Graphics
}

export const createArenaLayer = (): ArenaLayer => {
  const graphics = new Graphics()
  const container = new Container()
  container.addChild(graphics)
  return { container, graphics }
}

/** Rebuilds the world drawing for a map. Call on map change, never per frame. */
export const layoutArena = (layer: ArenaLayer, map: GameMap): void => {
  const g = layer.graphics
  g.clear()

  const theme: MapTheme = THEMES[map.index] ?? THEMES[0]!
  const rng = cosmeticRng(0xc02e + map.index * 977)
  const walls = map.walls
  const isWallAt = (tx: number, ty: number): boolean =>
    tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y || walls[ty * MAP_TILES_X + tx] === 1

  // Ground.
  g.rect(0, 0, MAP_W, MAP_H).fill({ color: theme.floor })

  // Hive floors are plated: seam lines on the tile grid, under everything else.
  if (theme.panelSeams) {
    for (let tx = 1; tx < MAP_TILES_X; tx++) {
      g.rect(tx * MAP_TILE - 1, 0, 2, MAP_H).fill({ color: 0x10161f, alpha: 0.9 })
    }
    for (let ty = 1; ty < MAP_TILES_Y; ty++) {
      g.rect(0, ty * MAP_TILE - 1, MAP_W, 2).fill({ color: 0x10161f, alpha: 0.9 })
    }
  }

  // Speckles: leaf litter / stone chips / metal flecks, per theme.
  for (let i = 0; i < theme.speckles; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    const tx = tile % MAP_TILES_X
    const ty = (tile / MAP_TILES_X) | 0
    const x = tx * MAP_TILE + rng() * MAP_TILE
    const y = ty * MAP_TILE + rng() * MAP_TILE
    const s = rng() < 0.25 ? 5 : 3
    g.rect(x, y, s, s).fill({ color: theme.floorSpeckle, alpha: 0.5 + rng() * 0.5 })
  }

  // Forest ground sprouts: pixel grass blades and the odd flower.
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
        g.rect(x, y - h, 3, h).fill({ color: 0x4f7a3c, alpha: 0.7 })
        if (rng() < 0.5) g.rect(x + 4, y - h * 0.6, 3, h * 0.6).fill({ color: 0x3f6430, alpha: 0.6 })
        if (rng() < 0.06) g.rect(x - 1, y - h - 5, 5, 5).fill({ color: 0xf2b4c6, alpha: 0.9 })
      }
    }
  }

  // Floor cracks (manor/cave) or dirt paths (forest) or scored plating (hive).
  for (let i = 0; i < theme.floorCracks; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    let x = (tile % MAP_TILES_X) * MAP_TILE + rng() * MAP_TILE
    let y = ((tile / MAP_TILES_X) | 0) * MAP_TILE + rng() * MAP_TILE
    let a = rng() * Math.PI * 2
    const segs = 3 + ((rng() * 3) | 0)
    g.moveTo(x, y)
    const litPts: number[] = [x, y]
    for (let k = 0; k < segs; k++) {
      a += (rng() - 0.5) * 1.6
      x += Math.cos(a) * (26 + rng() * 34)
      y += Math.sin(a) * (26 + rng() * 34)
      g.lineTo(x, y)
      litPts.push(x, y)
    }
    g.stroke({ color: theme.floorCrack, alpha: 0.95, width: 3.5 })
    g.moveTo(litPts[0]! + 2, litPts[1]! + 2)
    for (let k = 2; k < litPts.length; k += 2) g.lineTo(litPts[k]! + 2, litPts[k + 1]! + 2)
    g.stroke({ color: theme.floorCrackLit, alpha: 0.28, width: 1.5 })
    // Rubble scatter near one end of the deeper cracks.
    if (rng() < 0.55) {
      for (let r = 0; r < 3 + ((rng() * 3) | 0); r++) {
        const sz = 4 + rng() * 7
        g.rect(x + (rng() - 0.5) * 46, y + (rng() - 0.5) * 46, sz, sz)
          .fill({ color: rng() < 0.5 ? theme.rubble : theme.rubbleDark, alpha: 0.8 })
      }
    }
  }

  // Rugs go under everything that stands on the floor.
  const decor = map.decor
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Rug) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    const rw = MAP_TILE * 3
    const rh = MAP_TILE * 2
    g.rect(x, y, rw, rh).fill({ color: RUG_FILL, alpha: 0.55 })
    g.rect(x, y, rw, rh).stroke({ color: RUG_BORDER, alpha: 0.6, width: 5 })
    g.rect(x + 14, y + 14, rw - 28, rh - 28).stroke({ color: RUG_BORDER, alpha: 0.35, width: 3 })
  }

  // Wall fill: merge horizontal runs into single rects — fewer commands, no seams.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === TILE_WALL) run++
      g.rect(tx * MAP_TILE, ty * MAP_TILE, run * MAP_TILE, MAP_TILE).fill({ color: theme.wallFill })
      tx += run - 1
    }
  }

  // Cave walls carry strata: two pale bands per wall tile row, deterministic positions.
  if (theme.strata) {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        g.rect(x, y + MAP_TILE * 0.3, MAP_TILE, 3).fill({ color: theme.wallRim, alpha: 0.14 })
        g.rect(x, y + MAP_TILE * 0.68, MAP_TILE, 2).fill({ color: theme.wallRim, alpha: 0.1 })
      }
    }
  }

  // Furniture tiles: solid like walls, but read as built wooden things — tabletop fill,
  // plank grain, and a dark base shadow so they sit on the floor instead of floating.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_FURNITURE) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === TILE_FURNITURE) run++
      const x = tx * MAP_TILE
      const y = ty * MAP_TILE
      const wpx = run * MAP_TILE
      g.rect(x + 4, y + MAP_TILE - 12, wpx - 8, 10).fill({ color: WOOD_DARK, alpha: 0.8 })
      g.rect(x + 6, y + 6, wpx - 12, MAP_TILE - 16).fill({ color: WOOD_FILL })
      g.rect(x + 6, y + 6, wpx - 12, 6).fill({ color: WOOD_GRAIN })
      for (let px = x + 22; px < x + wpx - 14; px += 26) {
        g.rect(px, y + 14, 3, MAP_TILE - 26).fill({ color: WOOD_DARK, alpha: 0.5 })
      }
      tx += run - 1
    }
  }

  // Cobwebs: strung across the inside corners where two walls meet. Corners are found,
  // not authored; the cave's count turns the whole map into a den.
  {
    const corners: Array<[number, number, number, number]> = [] // x, y, dirX, dirY
    for (let ty = 1; ty < MAP_TILES_Y - 1; ty++) {
      for (let tx = 1; tx < MAP_TILES_X - 1; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== 0) continue
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          if (isWallAt(tx + dx, ty) && isWallAt(tx, ty + dy)) {
            corners.push([
              (tx + (dx < 0 ? 0 : 1)) * MAP_TILE,
              (ty + (dy < 0 ? 0 : 1)) * MAP_TILE,
              -dx,
              -dy,
            ])
          }
        }
      }
    }
    const stride = Math.max(1, Math.floor(corners.length / Math.max(1, theme.webs)))
    const offset = Math.floor(rng() * stride)
    for (let n = 0; n < theme.webs && n * stride + offset < corners.length; n++) {
      const [x, y, dx, dy] = corners[n * stride + offset]!
      const size = 46 + rng() * 34
      for (const frac of [0.45, 0.72, 1]) {
        const r = size * frac
        g.moveTo(x + dx * r, y)
        for (let k = 1; k <= 4; k++) {
          const a = (k / 4) * (Math.PI / 2)
          const sag = 1 - 0.12 * Math.sin(a * 2)
          g.lineTo(x + dx * Math.cos(a) * r * sag, y + dy * Math.sin(a) * r * sag)
        }
      }
      for (const a of [0.12, 0.5, 0.88]) {
        g.moveTo(x, y).lineTo(x + dx * Math.cos(a * (Math.PI / 2)) * size, y + dy * Math.sin(a * (Math.PI / 2)) * size)
      }
      g.stroke({ color: WEB_COLOR, alpha: WEB_ALPHA, width: 2.5 })
    }
  }

  // Wardrobes: tall cabinets on their (solid) tiles — double doors, handles, a plinth.
  const wr = map.wardrobes
  for (let i = 0; i < wr.length; i += 4) {
    const x = wr[i]! * MAP_TILE
    const y = wr[i + 1]! * MAP_TILE
    g.rect(x + 2, y + MAP_TILE - 10, MAP_TILE - 4, 8).fill({ color: 0x090b11, alpha: 0.8 })
    g.rect(x + 4, y + 2, MAP_TILE - 8, MAP_TILE - 10).fill({ color: WARDROBE_FILL })
    g.rect(x + 8, y + 8, MAP_TILE / 2 - 10, MAP_TILE - 22).fill({ color: WARDROBE_PANEL })
    g.rect(x + MAP_TILE / 2 + 2, y + 8, MAP_TILE / 2 - 10, MAP_TILE - 22).fill({ color: WARDROBE_PANEL })
    g.rect(x + MAP_TILE / 2 - 1, y + 6, 2, MAP_TILE - 16).fill({ color: 0x090b11, alpha: 0.6 })
    g.rect(x + MAP_TILE / 2 - 8, y + MAP_TILE / 2 - 6, 4, 10).fill({ color: WARDROBE_HANDLE })
    g.rect(x + MAP_TILE / 2 + 4, y + MAP_TILE / 2 - 6, 4, 10).fill({ color: WARDROBE_HANDLE })
  }

  // Windows: lit panes set into wall tiles — glow colour is the theme's.
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Window) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    g.rect(x + 16, y + 20, MAP_TILE - 32, MAP_TILE - 40).fill({ color: WINDOW_FRAME })
    g.rect(x + 20, y + 24, MAP_TILE - 40, MAP_TILE - 48).fill({ color: theme.windowGlow, alpha: 0.6 })
    g.rect(x + MAP_TILE / 2 - 2, y + 22, 4, MAP_TILE - 44).fill({ color: WINDOW_FRAME })
    g.rect(x + 18, y + MAP_TILE / 2 - 2, MAP_TILE - 36, 4).fill({ color: WINDOW_FRAME })
  }

  // Standing props: plants and lamp bases (light pools are additive fx sprites).
  for (let i = 0; i < decor.length; i += 3) {
    const cx = (decor[i + 1]! + 0.5) * MAP_TILE
    const cy = (decor[i + 2]! + 0.5) * MAP_TILE
    if (decor[i] === Decor.Plant) {
      g.rect(cx - 12, cy + 2, 24, 18).fill({ color: PLANT_POT })
      g.rect(cx - 17, cy - 16, 14, 16).fill({ color: PLANT_LEAF })
      g.rect(cx - 4, cy - 24, 13, 22).fill({ color: PLANT_LEAF, alpha: 0.85 })
      g.rect(cx + 6, cy - 12, 11, 13).fill({ color: PLANT_LEAF, alpha: 0.7 })
    } else if (decor[i] === Decor.Lamp) {
      g.rect(cx - 4, cy - 26, 8, 40).fill({ color: LAMP_POST })
      g.rect(cx - 12, cy + 12, 24, 6).fill({ color: LAMP_POST })
      g.rect(cx - 10, cy - 40, 20, 16).fill({ color: theme.lampHead, alpha: 0.95 })
    }
  }

  // Interior clumps: hedge leaves / canopy foliage / stone chips. Metal walls carry
  // recessed vent squares instead, and those consume no randomness.
  if (theme.wallStyle !== WallStyle.Metal) {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        const n = 2 + ((rng() * 2) | 0)
        for (let k = 0; k < n; k++) {
          const s = 10 + rng() * 16
          const x = tx * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
          const y = ty * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
          g.rect(x, y, s, s).fill({ color: theme.wallTuft, alpha: 0.35 + rng() * 0.4 })
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
        g.rect(x + 24, y + 30, 32, 20).fill({ color: theme.wallTuft, alpha: 0.8 })
        for (let vy = 0; vy < 3; vy++) {
          g.rect(x + 27, y + 34 + vy * 5, 26, 2).fill({ color: 0x0a0f18, alpha: 0.8 })
        }
      }
    }
  }

  // Tree trunks: canopy walls whose south face meets open ground show their wood.
  if (theme.wallStyle === WallStyle.Trees) {
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        if (isWallAt(tx, ty + 1)) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        g.rect(x + MAP_TILE / 2 - 9, y + MAP_TILE - 24, 18, 24).fill({ color: theme.trunk })
        g.rect(x + MAP_TILE / 2 - 9, y + MAP_TILE - 24, 4, 24).fill({ color: 0x33241a, alpha: 0.7 })
      }
    }
  }

  if (theme.eroded) {
    // Eroded edges: four seeded segments of varying thickness per exposed face, the wall
    // occasionally slumping outward — every silhouette ragged, collision on the grid.
    const edge = (x: number, y: number, horizontal: boolean, outward: number): void => {
      const SEGS = 4
      for (let k = 0; k < SEGS; k++) {
        const len = MAP_TILE / SEGS
        const thick = 3 + rng() * 5
        const slump = rng() < 0.3 ? (2 + rng() * 6) * outward : 0
        if (horizontal) {
          const sy = outward > 0 ? y - thick + slump : y - slump
          g.rect(x + k * len, sy, len + 1, thick + Math.abs(slump)).fill({ color: theme.wallFill })
          g.rect(x + k * len, outward > 0 ? sy : y + thick - slump - 2, len + 1, 2.5 + rng() * 2).fill({ color: theme.wallRim, alpha: 0.7 + rng() * 0.25 })
        } else {
          const sx = outward > 0 ? x - thick + slump : x - slump
          g.rect(sx, y + k * len, thick + Math.abs(slump), len + 1).fill({ color: theme.wallFill })
          g.rect(outward > 0 ? sx : x + thick - slump - 2, y + k * len, 2.5 + rng() * 2, len + 1).fill({ color: theme.wallRim, alpha: 0.7 + rng() * 0.25 })
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

    // Crumbled corners: every convex wall corner has visibly shed material.
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          if (isWallAt(tx + dx, ty) || isWallAt(tx, ty + dy)) continue
          const cx = (tx + (dx < 0 ? 0 : 1)) * MAP_TILE
          const cy = (ty + (dy < 0 ? 0 : 1)) * MAP_TILE
          const bite = 8 + rng() * 12
          g.rect(cx - (dx < 0 ? 0 : bite), cy - (dy < 0 ? 0 : bite), bite, bite).fill({ color: theme.floor })
          const half = bite * 0.55
          g.rect(cx - (dx < 0 ? -bite : bite + half), cy - (dy < 0 ? 0 : half), half, half)
            .fill({ color: theme.floor, alpha: 0.9 })
          for (let r = 0; r < 2 + ((rng() * 3) | 0); r++) {
            const sz = 5 + rng() * 8
            g.rect(cx - dx * (4 + rng() * 22) - sz / 2, cy - dy * (4 + rng() * 22) - sz / 2, sz, sz)
              .fill({ color: rng() < 0.4 ? theme.wallRim : theme.rubble, alpha: 0.75 })
          }
        }
      }
    }
  } else {
    // Machined walls: a clean glowing trim where the wall meets walkable ground.
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
        if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
        const x = tx * MAP_TILE
        const y = ty * MAP_TILE
        if (!isWallAt(tx, ty - 1)) g.rect(x, y, MAP_TILE, 3).fill({ color: theme.wallRim, alpha: 0.55 })
        if (!isWallAt(tx, ty + 1)) g.rect(x, y + MAP_TILE - 3, MAP_TILE, 3).fill({ color: theme.wallRim, alpha: 0.55 })
        if (!isWallAt(tx - 1, ty)) g.rect(x, y, 3, MAP_TILE).fill({ color: theme.wallRim, alpha: 0.55 })
        if (!isWallAt(tx + 1, ty)) g.rect(x + MAP_TILE - 3, y, 3, MAP_TILE).fill({ color: theme.wallRim, alpha: 0.55 })
      }
    }
  }

  // Wall cracks: pale fissures across the wall mass itself.
  {
    const wallTiles: number[] = []
    for (let i = 0; i < walls.length; i++) if (walls[i] === TILE_WALL) wallTiles.push(i)
    for (let i = 0; i < theme.wallCracks && wallTiles.length > 0; i++) {
      const t = wallTiles[Math.floor(rng() * wallTiles.length)]!
      let x = (t % MAP_TILES_X) * MAP_TILE + 10 + rng() * (MAP_TILE - 20)
      let y = ((t / MAP_TILES_X) | 0) * MAP_TILE + 10 + rng() * (MAP_TILE - 20)
      let a = rng() * Math.PI * 2
      g.moveTo(x, y)
      for (let k = 0; k < 3; k++) {
        a += (rng() - 0.5) * 1.4
        x += Math.cos(a) * (12 + rng() * 16)
        y += Math.sin(a) * (12 + rng() * 16)
        g.lineTo(x, y)
      }
      g.stroke({ color: theme.wallCrack, alpha: 0.9, width: 2.5 })
    }
  }

  // Nest territories: a webbed carpet ring telegraphing exactly where the hazard bites —
  // a spider death must never feel unannounced. Deterministic pattern, no rng.
  const nests = map.nests
  for (let n = 0; n < nests.length; n += 2) {
    const cx = (nests[n]! + 0.5) * MAP_TILE
    const cy = (nests[n + 1]! + 0.5) * MAP_TILE
    g.rect(cx - 26, cy - 26, 52, 52).fill({ color: 0x0d0a16, alpha: 0.5 }) // the den stain
    for (const frac of [0.55, 0.8, 1]) {
      const r = NEST_RADIUS * frac
      const segs = 14
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2 + frac * 1.7
        g.rect(cx + Math.cos(a) * r - 3, cy + Math.sin(a) * r - 3, 6, 6)
          .fill({ color: NEST_WEB_COLOR, alpha: 0.16 })
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.4
      g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * NEST_RADIUS, cy + Math.sin(a) * NEST_RADIUS)
    }
    g.stroke({ color: NEST_WEB_COLOR, alpha: 0.1, width: 2 })
  }

  // Portal pads: the same arcane violet on every world — a pad must be instantly known.
  // The static base lives here; the animated swirl is monsterFx's per-frame job.
  const portals = map.portals
  for (let p = 0; p < portals.length; p += 4) {
    const cx = (portals[p]! + 0.5) * MAP_TILE
    const cy = (portals[p + 1]! + 0.5) * MAP_TILE
    g.rect(cx - 34, cy - 34, 68, 68).fill({ color: 0x0d0a16, alpha: 0.6 })
    g.rect(cx - 34, cy - 34, 68, 68).stroke({ color: PORTAL_COLOR, alpha: 0.5, width: 4 })
    g.rect(cx - 22, cy - 22, 44, 44).stroke({ color: PORTAL_COLOR, alpha: 0.35, width: 3 })
    g.rect(cx - 5, cy - 5, 10, 10).fill({ color: PORTAL_CORE, alpha: 0.8 })
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      g.rect(cx + nx * 30 - 3, cy + ny * 30 - 3, 6, 6).fill({ color: PORTAL_CORE, alpha: 0.7 })
    }
  }
}
