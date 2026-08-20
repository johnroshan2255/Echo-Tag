import { MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAP_W, MAP_H, TILE_FURNITURE, TILE_WALL } from '@echo-tag/shared/constants'
import { Decor, type GameMap } from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import {
  cosmeticRng,
  FLOOR,
  WEB_ALPHA,
  WEB_COLOR,
  WEBS_PER_MAP,
  WARDROBE_FILL,
  WARDROBE_HANDLE,
  WARDROBE_PANEL,
  WINDOW_FRAME,
  WINDOW_GLOW,
  FLOOR_SPECKLE,
  LAMP_HEAD,
  LAMP_POST,
  PLANT_LEAF,
  PLANT_POT,
  RUG_BORDER,
  RUG_FILL,
  SPECKLES_PER_MAP,
  WALL_FILL,
  WALL_RIM,
  WALL_TUFT,
  WOOD_DARK,
  WOOD_FILL,
  WOOD_GRAIN,
} from '../theme.ts'

/**
 * The world, drawn cozy (ADR 0006).
 *
 * One `Graphics` in world coordinates, rebuilt only on map change — the camera moves the
 * container, so scrolling costs nothing here.
 *
 * The old draft was a grid on a flat rectangle: honest, and clinical. This one dresses the
 * same tile data as a hedge-maze at dusk: leaf-litter speckles instead of grid lines (they
 * give motion the same reference, without the graph paper), walls filled as dark pine with
 * mossy rims where they meet walkable ground, and leafy interior clumps so a long hedge is
 * texture rather than a slab. All of it is seeded per map, so a map always dresses itself
 * identically — set dressing must never look like information.
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

const RIM_W = 5 // world units

/** Rebuilds the world drawing for a map. Call on map change, never per frame. */
export const layoutArena = (layer: ArenaLayer, map: GameMap): void => {
  const g = layer.graphics
  g.clear()

  const rng = cosmeticRng(0xc02e + map.index * 977)
  const walls = map.walls
  const isWallAt = (tx: number, ty: number): boolean =>
    tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y || walls[ty * MAP_TILES_X + tx] === 1

  // Ground.
  g.rect(0, 0, MAP_W, MAP_H).fill({ color: FLOOR })

  // Leaf litter: small seeded speckles on open tiles only. Two sizes, so it reads as
  // scatter rather than noise.
  for (let i = 0; i < SPECKLES_PER_MAP; i++) {
    const tile = map.openTiles[Math.floor(rng() * map.openTiles.length)]!
    const tx = tile % MAP_TILES_X
    const ty = (tile / MAP_TILES_X) | 0
    const x = tx * MAP_TILE + rng() * MAP_TILE
    const y = ty * MAP_TILE + rng() * MAP_TILE
    const s = rng() < 0.25 ? 5 : 3
    g.rect(x, y, s, s).fill({ color: FLOOR_SPECKLE, alpha: 0.5 + rng() * 0.5 })
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

  // Hedge fill: merge horizontal runs into single rects — fewer commands, no seams.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === TILE_WALL) run++
      g.rect(tx * MAP_TILE, ty * MAP_TILE, run * MAP_TILE, MAP_TILE).fill({ color: WALL_FILL })
      tx += run - 1
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

  // Cobwebs: strung across the inside corners where two walls meet — the classic sign of
  // a place nobody has dusted in years. A web is three concentric quarter-arcs plus three
  // anchor threads, seeded per map. Corners are found, not authored: any open tile whose
  // two orthogonal neighbours on one diagonal are both solid can hold one.
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
    // Spread deterministically: walk the corner list at a seeded stride instead of random
    // splices — same dressing every visit, and the first pick is stable for review crops.
    const stride = Math.max(1, Math.floor(corners.length / WEBS_PER_MAP))
    const offset = Math.floor(rng() * stride)
    for (let n = 0; n < WEBS_PER_MAP && n * stride + offset < corners.length; n++) {
      const [x, y, dx, dy] = corners[n * stride + offset]!
      const size = 46 + rng() * 34
      for (const frac of [0.45, 0.72, 1]) {
        const r = size * frac
        // Quarter-arc as a 4-segment polyline sagging slightly toward the corner.
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
  // Distinct from tables at a glance, because these are the ones you can step inside.
  const wr = map.wardrobes
  for (let i = 0; i < wr.length; i += 4) {
    const x = wr[i]! * MAP_TILE
    const y = wr[i + 1]! * MAP_TILE
    g.rect(x + 2, y + MAP_TILE - 10, MAP_TILE - 4, 8).fill({ color: 0x090b11, alpha: 0.8 })
    g.rect(x + 4, y + 2, MAP_TILE - 8, MAP_TILE - 10).fill({ color: WARDROBE_FILL })
    // Two door panels with a centre seam.
    g.rect(x + 8, y + 8, MAP_TILE / 2 - 10, MAP_TILE - 22).fill({ color: WARDROBE_PANEL })
    g.rect(x + MAP_TILE / 2 + 2, y + 8, MAP_TILE / 2 - 10, MAP_TILE - 22).fill({ color: WARDROBE_PANEL })
    g.rect(x + MAP_TILE / 2 - 1, y + 6, 2, MAP_TILE - 16).fill({ color: 0x090b11, alpha: 0.6 })
    // Handles.
    g.rect(x + MAP_TILE / 2 - 8, y + MAP_TILE / 2 - 6, 4, 10).fill({ color: WARDROBE_HANDLE })
    g.rect(x + MAP_TILE / 2 + 4, y + MAP_TILE / 2 - 6, 4, 10).fill({ color: WARDROBE_HANDLE })
  }

  // Windows: lit panes set into wall tiles. Pure architecture — walls become a house, and
  // a warm rectangle in the dark reads from far outside vision range.
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Window) continue
    const x = decor[i + 1]! * MAP_TILE
    const y = decor[i + 2]! * MAP_TILE
    g.rect(x + 16, y + 20, MAP_TILE - 32, MAP_TILE - 40).fill({ color: WINDOW_FRAME })
    g.rect(x + 20, y + 24, MAP_TILE - 40, MAP_TILE - 48).fill({ color: WINDOW_GLOW, alpha: 0.6 })
    // Cross mullions.
    g.rect(x + MAP_TILE / 2 - 2, y + 22, 4, MAP_TILE - 44).fill({ color: WINDOW_FRAME })
    g.rect(x + 18, y + MAP_TILE / 2 - 2, MAP_TILE - 36, 4).fill({ color: WINDOW_FRAME })
  }

  // Standing props: plants and lamp bases. (Lamp light pools are additive sprites in the
  // fx layer, placed by setLampsFromMap — a Graphics can't blend additively per-shape.)
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
      g.rect(cx - 10, cy - 40, 20, 16).fill({ color: LAMP_HEAD, alpha: 0.95 })
    }
  }

  // Leafy clumps inside the hedges: a few soft lighter blobs per wall tile. Kept away from
  // tile edges so they never blur the collision boundary. Hedge tiles only — an earlier
  // pass grew leaves on the furniture.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue
      const n = 2 + ((rng() * 2) | 0)
      for (let k = 0; k < n; k++) {
        const s = 10 + rng() * 16
        const x = tx * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
        const y = ty * MAP_TILE + 8 + rng() * (MAP_TILE - 16 - s)
        g.rect(x, y, s, s).fill({ color: WALL_TUFT, alpha: 0.35 + rng() * 0.4 })
      }
    }
  }

  // Mossy rims: a lit strip on every hedge face that touches floor — and only those.
  // (Outlining whole wall rects striped every vertical wall; testing each face against its
  // neighbour puts light exactly on the walkable boundary, the line the player needs.)
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] !== TILE_WALL) continue // furniture carries its own wood edges
      const x = tx * MAP_TILE
      const y = ty * MAP_TILE
      if (!isWallAt(tx, ty - 1)) g.rect(x, y, MAP_TILE, RIM_W).fill({ color: WALL_RIM, alpha: 0.85 })
      if (!isWallAt(tx, ty + 1)) g.rect(x, y + MAP_TILE - RIM_W, MAP_TILE, RIM_W).fill({ color: WALL_RIM, alpha: 0.85 })
      if (!isWallAt(tx - 1, ty)) g.rect(x, y, RIM_W, MAP_TILE).fill({ color: WALL_RIM, alpha: 0.85 })
      if (!isWallAt(tx + 1, ty)) g.rect(x + MAP_TILE - RIM_W, y, RIM_W, MAP_TILE).fill({ color: WALL_RIM, alpha: 0.85 })
    }
  }
}
