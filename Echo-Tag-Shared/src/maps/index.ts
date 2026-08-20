import { MAP_COUNT, MAP_TILE, MAP_TILES_X, MAP_TILES_Y, SPAWNS_PER_MAP } from '../constants.ts'

/**
 * The four maps.
 *
 * Maps are fixed and authored — the same maze for every round on that map, for every player,
 * on every device. They are *painted in code* with the helpers below rather than drawn as
 * image or JSON assets, for the same reason the characters are generated squares: zero
 * asset requests, a few hundred bytes of source instead of files, and exact dimensions
 * guaranteed by construction instead of by counting characters in a 40x22 text block.
 *
 * Authoring rules (enforced by maps.test.ts, not just convention):
 *   - every map is the same 40x22 tile grid, so every simulation buffer stays fixed-size
 *   - a one-tile border wall all the way round; the arena clamp is only a backstop
 *   - corridors at least two tiles (160 units ≈ 4.4 player widths) — narrower reads as a
 *     wall once a couple of echo trails run through it
 *   - exactly 12 spawn tiles, mutually far apart, all in open space
 *   - every open tile reachable from every spawn: no pockets a player can be trapped in,
 *     which matters doubly here because echoes make temporary walls of their own
 */

export interface GameMap {
  readonly index: number
  readonly name: string
  /** 1 = wall, 0 = open. Length MAP_TILES_X * MAP_TILES_Y, row-major. */
  readonly walls: Uint8Array
  /** Spawn tiles as (tx, ty) pairs, length SPAWNS_PER_MAP * 2. */
  readonly spawns: Int16Array
  /** Indices of open tiles, for deterministic open-space sampling. */
  readonly openTiles: Int32Array
}

const TX = MAP_TILES_X
const TY = MAP_TILES_Y

// ── Painting helpers ──────────────────────────────────────────────────────────

const blank = (): Uint8Array => {
  const w = new Uint8Array(TX * TY)
  // Border wall.
  for (let x = 0; x < TX; x++) {
    w[x] = 1
    w[(TY - 1) * TX + x] = 1
  }
  for (let y = 0; y < TY; y++) {
    w[y * TX] = 1
    w[y * TX + (TX - 1)] = 1
  }
  return w
}

const rect = (w: Uint8Array, x0: number, y0: number, x1: number, y1: number): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w[y * TX + x] = 1
}

const clear = (w: Uint8Array, x0: number, y0: number, x1 = x0, y1 = y0): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w[y * TX + x] = 0
}

const hwall = (w: Uint8Array, y: number, x0: number, x1: number): void => rect(w, x0, y, x1, y)
const vwall = (w: Uint8Array, x: number, y0: number, y1: number): void => rect(w, x, y0, x, y1)

const finish = (index: number, name: string, walls: Uint8Array, spawns: number[]): GameMap => {
  if (spawns.length !== SPAWNS_PER_MAP * 2) {
    throw new Error(`${name}: ${spawns.length / 2} spawns, need ${SPAWNS_PER_MAP}`)
  }
  const open: number[] = []
  for (let i = 0; i < walls.length; i++) if (walls[i] === 0) open.push(i)
  for (let s = 0; s < spawns.length; s += 2) {
    const t = spawns[s + 1]! * TX + spawns[s]!
    if (walls[t] === 1) throw new Error(`${name}: spawn ${s / 2} at (${spawns[s]},${spawns[s + 1]}) is inside a wall`)
  }
  return { index, name, walls, spawns: new Int16Array(spawns), openTiles: new Int32Array(open) }
}

// ── Map 0: FOUNDRY — four big rooms joined by wide halls ──────────────────────
const foundry = (): GameMap => {
  const w = blank()
  // Central block with a cross of halls around it.
  rect(w, 17, 8, 22, 13)
  // Room dividers: a wall per quadrant boundary, each with a two-tile doorway.
  vwall(w, 12, 1, 6); clear(w, 12, 3, 12, 4)
  vwall(w, 12, 15, 20); clear(w, 12, 17, 12, 18)
  vwall(w, 27, 1, 6); clear(w, 27, 3, 27, 4)
  vwall(w, 27, 15, 20); clear(w, 27, 17, 27, 18)
  hwall(w, 7, 1, 8); hwall(w, 7, 31, 38)
  hwall(w, 14, 1, 8); hwall(w, 14, 31, 38)
  clear(w, 4, 7, 5, 7); clear(w, 34, 7, 35, 7)
  clear(w, 4, 14, 5, 14); clear(w, 34, 14, 35, 14)
  // Corner nooks for drama.
  rect(w, 4, 3, 6, 4); rect(w, 33, 3, 35, 4)
  rect(w, 4, 17, 6, 18); rect(w, 33, 17, 35, 18)
  return finish(0, 'Foundry', w, [
    2, 2, 37, 2, 2, 19, 37, 19, // far corners
    19, 2, 19, 19, 2, 11, 37, 11, // edge midpoints
    14, 10, 25, 11, 9, 10, 30, 11, // around the central block
  ])
}

// ── Map 1: PILLARS — an open field of columns; the chase map ─────────────────
const pillars = (): GameMap => {
  const w = blank()
  for (const gy of [3, 8, 13, 18]) {
    for (const gx of [4, 9, 14, 19, 24, 29, 34]) {
      rect(w, gx, gy, gx + 1, Math.min(gy + 1, TY - 2))
    }
  }
  return finish(1, 'Pillars', w, [
    2, 2, 37, 2, 2, 19, 37, 19,
    12, 6, 27, 6, 12, 16, 27, 16,
    20, 2, 20, 20, 2, 11, 37, 11,
  ])
}

// ── Map 2: SERPENTINE — long winding lanes; the corridor map ─────────────────
const serpentine = (): GameMap => {
  const w = blank()
  // Alternating combs from the left and right walls, three-tile lanes between them.
  hwall(w, 4, 1, 30)
  hwall(w, 8, 9, 38)
  hwall(w, 12, 1, 30)
  hwall(w, 16, 9, 38)
  // A shortcut punched through each comb, so a cornered runner always has two ways out —
  // one exit per lane makes being It trivially strong at the dead ends.
  clear(w, 15, 4, 16, 4)
  clear(w, 23, 8, 24, 8)
  clear(w, 15, 12, 16, 12)
  clear(w, 23, 16, 24, 16)
  return finish(2, 'Serpentine', w, [
    2, 2, 37, 2, 2, 19, 37, 19,
    35, 6, 4, 10, 35, 14, 10, 18,
    19, 2, 19, 6, 19, 10, 19, 18,
  ])
}

// ── Map 3: WARRENS — small chambers, many doorways; the ambush map ───────────
const warrens = (): GameMap => {
  const w = blank()
  // A lattice of walls with doors knocked through at varying offsets, so no two chambers
  // connect the same way and sightlines stay short.
  for (const x of [8, 16, 24, 32]) vwall(w, x, 1, 20)
  for (const y of [6, 11, 16]) hwall(w, y, 1, 38)
  // Doorways, two tiles each.
  clear(w, 8, 3, 8, 4); clear(w, 16, 2, 16, 3); clear(w, 24, 3, 24, 4); clear(w, 32, 2, 32, 3)
  clear(w, 8, 8, 8, 9); clear(w, 16, 8, 16, 9); clear(w, 24, 8, 24, 9); clear(w, 32, 8, 32, 9)
  clear(w, 8, 13, 8, 14); clear(w, 16, 12, 16, 13); clear(w, 24, 13, 24, 14); clear(w, 32, 12, 32, 13)
  clear(w, 8, 18, 8, 19); clear(w, 16, 17, 16, 18); clear(w, 24, 18, 24, 19); clear(w, 32, 17, 32, 18)
  clear(w, 3, 6, 4, 6); clear(w, 11, 6, 12, 6); clear(w, 19, 6, 20, 6); clear(w, 27, 6, 28, 6); clear(w, 35, 6, 36, 6)
  clear(w, 3, 11, 4, 11); clear(w, 11, 11, 12, 11); clear(w, 19, 11, 20, 11); clear(w, 27, 11, 28, 11); clear(w, 35, 11, 36, 11)
  clear(w, 3, 16, 4, 16); clear(w, 11, 16, 12, 16); clear(w, 19, 16, 20, 16); clear(w, 27, 16, 28, 16); clear(w, 35, 16, 36, 16)
  return finish(3, 'Warrens', w, [
    3, 2, 36, 2, 3, 19, 36, 19,
    12, 4, 28, 4, 12, 18, 28, 18,
    20, 9, 20, 13, 4, 9, 36, 13,
  ])
}

export const MAPS: readonly GameMap[] = [foundry(), pillars(), serpentine(), warrens()]

if (MAPS.length !== MAP_COUNT) throw new Error('MAP_COUNT out of sync with MAPS')

/** Tile lookup. Out-of-bounds counts as wall, so nothing can ever leave the grid. */
export const isWall = (map: GameMap, tx: number, ty: number): boolean =>
  tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y || map.walls[ty * MAP_TILES_X + tx] === 1

/** World-space centre of a tile. */
export const tileCenterX = (tx: number): number => (tx + 0.5) * MAP_TILE
export const tileCenterY = (ty: number): number => (ty + 0.5) * MAP_TILE
