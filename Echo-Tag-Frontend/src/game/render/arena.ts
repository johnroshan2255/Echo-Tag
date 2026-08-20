import { MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAP_W, MAP_H } from '@echo-tag/shared/constants'
import type { GameMap } from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import { cosmeticRng, FLOOR, FLOOR_SPECKLE, SPECKLES_PER_MAP, WALL_FILL, WALL_RIM, WALL_TUFT } from '../theme.ts'

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

  // Hedge fill: merge horizontal runs into single rects — fewer commands, no seams.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] === 0) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === 1) run++
      g.rect(tx * MAP_TILE, ty * MAP_TILE, run * MAP_TILE, MAP_TILE).fill({ color: WALL_FILL })
      tx += run - 1
    }
  }

  // Leafy clumps inside the hedges: a few soft lighter blobs per wall tile. Kept away from
  // tile edges so they never blur the collision boundary.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] === 0) continue
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
      if (walls[ty * MAP_TILES_X + tx] === 0) continue
      const x = tx * MAP_TILE
      const y = ty * MAP_TILE
      if (!isWallAt(tx, ty - 1)) g.rect(x, y, MAP_TILE, RIM_W).fill({ color: WALL_RIM, alpha: 0.85 })
      if (!isWallAt(tx, ty + 1)) g.rect(x, y + MAP_TILE - RIM_W, MAP_TILE, RIM_W).fill({ color: WALL_RIM, alpha: 0.85 })
      if (!isWallAt(tx - 1, ty)) g.rect(x, y, RIM_W, MAP_TILE).fill({ color: WALL_RIM, alpha: 0.85 })
      if (!isWallAt(tx + 1, ty)) g.rect(x + MAP_TILE - RIM_W, y, RIM_W, MAP_TILE).fill({ color: WALL_RIM, alpha: 0.85 })
    }
  }
}
