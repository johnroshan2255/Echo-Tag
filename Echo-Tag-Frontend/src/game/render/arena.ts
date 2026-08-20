import { BG_COLOR, MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAP_W, MAP_H } from '@echo-tag/shared/constants'
import type { GameMap } from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'

/**
 * The map, drawn.
 *
 * One `Graphics` in world coordinates, rebuilt only when the map changes — the camera
 * moves the container, so scrolling costs nothing here. Everything is flat fills: the
 * visual identity is neon actors on a dark world, and the world's job is to stay quiet.
 *
 * Walls get a two-tone treatment (face + a darker inset) so they read as solid *mass*
 * rather than as lines, which matters because echoes are also obstacle-coloured shapes —
 * a player must never wonder which kind of wall they are looking at. Walls are heavy,
 * static, and darker than the floor; echoes are bright, translucent, and moving.
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

const FLOOR = 0x1a1e2c
const WALL = 0x090b11 // same family as the page void: walls read as absence of floor
const RIM = 0x424b6e // lit rim exactly where wall mass meets walkable floor
const RIM_W = 5 // world units

/** Rebuilds the world drawing for a map. Call on map change, never per frame. */
export const layoutArena = (layer: ArenaLayer, map: GameMap): void => {
  const g = layer.graphics
  g.clear()

  // Floor — clearly lighter than walls and the page void, so "where can I walk" is a
  // one-glance read. (An earlier draft used three near-identical darks for void, wall and
  // floor; in a moving camera view the walls dissolved into the floor entirely.)
  g.rect(0, 0, MAP_W, MAP_H).fill({ color: FLOOR })

  // Tile grid on the floor: gives motion a reference everywhere, at walking scale.
  for (let x = MAP_TILE; x < MAP_W; x += MAP_TILE) {
    g.moveTo(x, 0).lineTo(x, MAP_H)
  }
  for (let y = MAP_TILE; y < MAP_H; y += MAP_TILE) {
    g.moveTo(0, y).lineTo(MAP_W, y)
  }
  g.stroke({ color: 0xffffff, alpha: 0.03, width: 1 })

  const walls = map.walls
  const isWallAt = (tx: number, ty: number): boolean =>
    tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y || walls[ty * MAP_TILES_X + tx] === 1

  // Wall fill: merge horizontal runs into single rects — fewer commands, no seams.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] === 0) continue
      let run = 1
      while (tx + run < MAP_TILES_X && walls[ty * MAP_TILES_X + tx + run] === 1) run++
      g.rect(tx * MAP_TILE, ty * MAP_TILE, run * MAP_TILE, MAP_TILE).fill({ color: WALL })
      tx += run - 1
    }
  }

  // Rims: a lit strip on every wall face that touches floor — and only those. Outlining
  // whole wall rects striped every vertical wall (each tile row drew its own top edge);
  // testing each face against its neighbour puts light exactly on the walkable boundary,
  // which is the line the player actually needs.
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (walls[ty * MAP_TILES_X + tx] === 0) continue
      const x = tx * MAP_TILE
      const y = ty * MAP_TILE
      if (!isWallAt(tx, ty - 1)) g.rect(x, y, MAP_TILE, RIM_W).fill({ color: RIM })
      if (!isWallAt(tx, ty + 1)) g.rect(x, y + MAP_TILE - RIM_W, MAP_TILE, RIM_W).fill({ color: RIM })
      if (!isWallAt(tx - 1, ty)) g.rect(x, y, RIM_W, MAP_TILE).fill({ color: RIM })
      if (!isWallAt(tx + 1, ty)) g.rect(x + MAP_TILE - RIM_W, y, RIM_W, MAP_TILE).fill({ color: RIM })
    }
  }
}

export { BG_COLOR }
