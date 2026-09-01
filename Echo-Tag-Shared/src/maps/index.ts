import { MAP_COUNT, MAP_TILE, MAP_TILES_X, MAP_TILES_Y, MAX_DOORS, MAX_NESTS, MAX_PORTALS, MAX_WARDROBES, SPAWNS_PER_MAP, TILE_FURNITURE } from '../constants.ts'

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

/** Decorative, non-colliding furnishings. Values for `decor` triples. */
export const Decor = {
  Rug: 0, // 3x2 tiles of soft carpet, anchored at its top-left tile
  Lamp: 1, // a standing lamp; the renderer gives it a warm light pool
  Plant: 2, // a potted plant
  Window: 3, // a lit pane set into a wall tile — pure architecture, walls become a house
} as const
export type Decor = (typeof Decor)[keyof typeof Decor]

export interface GameMap {
  readonly index: number
  readonly name: string
  /** TILE_OPEN / TILE_WALL / TILE_FURNITURE. Non-zero is solid. Row-major. */
  readonly walls: Uint8Array
  /** Spawn tiles as (tx, ty) pairs, length SPAWNS_PER_MAP * 2. */
  readonly spawns: Int16Array
  /** Indices of walkable tiles, for deterministic open-space sampling. */
  readonly openTiles: Int32Array
  /**
   * Doors as (tx, ty, axis) triples, at most MAX_DOORS. A door fills the two-tile doorway
   * starting at (tx, ty): axis 0 spans (tx,ty)+(tx+1,ty); axis 1 spans (tx,ty)+(tx,ty+1).
   * Both tiles must be open — a door lives in a gap, its leaves retract into the walls.
   */
  readonly doors: Int16Array
  /** Decorative props as (type, tx, ty) triples. Never collide, never networked. */
  readonly decor: Int16Array
  /**
   * Wardrobes as (tx, ty, exitTx, exitTy) quads, at most MAX_WARDROBES. The wardrobe tile
   * itself is painted TILE_FURNITURE (solid); the exit tile is the open neighbour a hider
   * steps out onto, resolved at build time so the simulation never searches.
   */
  readonly wardrobes: Int16Array
  /**
   * Portals as (tx, ty, destTx, destTy) quads, at most MAX_PORTALS directed entries.
   * Step on (tx, ty) and you are at (destTx, destTy); a two-way pair is two entries.
   */
  readonly portals: Int16Array
  /**
   * Spider nests as (tx, ty) pairs, at most MAX_NESTS. The nest tile is open — the
   * spider stands on it — and its webbed territory is drawn around it by the renderer.
   */
  readonly nests: Int16Array
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

/**
 * A stepped-oval blob of solid wall: the end rows are inset so the silhouette reads as a
 * grown pod rather than a built panel. The hive's architecture, in one shape.
 */
const lens = (w: Uint8Array, x: number, y: number, wide: number, tall: number): void => {
  const inset = Math.max(1, Math.floor(wide / 3))
  for (let r = 0; r < tall; r++) {
    const cap = r === 0 || r === tall - 1
    rect(w, x + (cap ? inset : 0), y + r, x + wide - 1 - (cap ? inset : 0), y + r)
  }
}

/** Solid furniture: blocks movement like a wall, renders as wood. */
const furn = (w: Uint8Array, x0: number, y0: number, x1 = x0, y1 = y0): void => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) w[y * TX + x] = TILE_FURNITURE
}

const finish = (
  index: number,
  name: string,
  walls: Uint8Array,
  spawns: number[],
  doors: number[] = [],
  decor: number[] = [],
  wardrobeTiles: number[] = [], // (tx, ty) pairs; exits are resolved here
  portals: number[] = [], // (tx, ty, destTx, destTy) directed entries
  nests: number[] = [], // (tx, ty) pairs
): GameMap => {
  if (spawns.length !== SPAWNS_PER_MAP * 2) {
    throw new Error(`${name}: ${spawns.length / 2} spawns, need ${SPAWNS_PER_MAP}`)
  }
  if (doors.length / 3 > MAX_DOORS) throw new Error(`${name}: ${doors.length / 3} doors, max ${MAX_DOORS}`)
  const open: number[] = []
  for (let i = 0; i < walls.length; i++) if (walls[i] === 0) open.push(i)
  for (let s = 0; s < spawns.length; s += 2) {
    const t = spawns[s + 1]! * TX + spawns[s]!
    if (walls[t] !== 0) throw new Error(`${name}: spawn ${s / 2} at (${spawns[s]},${spawns[s + 1]}) is not walkable`)
  }
  for (let d = 0; d < doors.length; d += 3) {
    const [tx, ty, axis] = [doors[d]!, doors[d + 1]!, doors[d + 2]!]
    const t2 = axis === 0 ? ty * TX + tx + 1 : (ty + 1) * TX + tx
    if (walls[ty * TX + tx] !== 0 || walls[t2] !== 0) {
      throw new Error(`${name}: door ${d / 3} at (${tx},${ty}) is not in an open doorway`)
    }
  }
  if (wardrobeTiles.length / 2 > MAX_WARDROBES) {
    throw new Error(`${name}: ${wardrobeTiles.length / 2} wardrobes, max ${MAX_WARDROBES}`)
  }
  const wardrobes: number[] = []
  for (let i = 0; i < wardrobeTiles.length; i += 2) {
    const tx = wardrobeTiles[i]!
    const ty = wardrobeTiles[i + 1]!
    if (walls[ty * TX + tx] !== 0) throw new Error(`${name}: wardrobe at (${tx},${ty}) tile not free`)
    walls[ty * TX + tx] = TILE_FURNITURE // the cabinet is solid
    // Exit: the first open orthogonal neighbour. Every wardrobe must have one.
    const exits = [[tx, ty + 1], [tx, ty - 1], [tx - 1, ty], [tx + 1, ty]] as const
    const exit = exits.find(([ex, ey]) => walls[ey! * TX + ex!] === 0)
    if (!exit) throw new Error(`${name}: wardrobe at (${tx},${ty}) has no open neighbour to exit onto`)
    wardrobes.push(tx, ty, exit[0], exit[1])
  }
  // Wardrobe tiles were just made solid; rebuild the open list after them.
  open.length = 0
  for (let i = 0; i < walls.length; i++) if (walls[i] === 0) open.push(i)

  // Windows must sit in a wall with at least one open side to shine into.
  for (let i = 0; i < decor.length; i += 3) {
    if (decor[i] !== Decor.Window) continue
    const tx = decor[i + 1]!
    const ty = decor[i + 2]!
    if (walls[ty * TX + tx] === 0) throw new Error(`${name}: window at (${tx},${ty}) is not in a wall`)
  }

  // Portals: both ends walkable, and never directly on a spawn tile — nobody starts a
  // round mid-warp.
  if (portals.length / 4 > MAX_PORTALS) throw new Error(`${name}: ${portals.length / 4} portals, max ${MAX_PORTALS}`)
  for (let p = 0; p < portals.length; p += 4) {
    for (const [px, py] of [[portals[p]!, portals[p + 1]!], [portals[p + 2]!, portals[p + 3]!]]) {
      if (walls[py! * TX + px!] !== 0) throw new Error(`${name}: portal tile (${px},${py}) is not walkable`)
      for (let sp = 0; sp < spawns.length; sp += 2) {
        if (spawns[sp] === px && spawns[sp + 1] === py) {
          throw new Error(`${name}: portal at (${px},${py}) sits on a spawn tile`)
        }
      }
    }
  }

  // Nests: on open ground, and far enough from every spawn that nobody spawns inside a
  // spider's territory (NEST_RADIUS is ~1.6 tiles; demand 3).
  if (nests.length / 2 > MAX_NESTS) throw new Error(`${name}: ${nests.length / 2} nests, max ${MAX_NESTS}`)
  for (let n = 0; n < nests.length; n += 2) {
    const nx = nests[n]!
    const ny = nests[n + 1]!
    if (walls[ny * TX + nx] !== 0) throw new Error(`${name}: nest at (${nx},${ny}) is not on open ground`)
    for (let sp = 0; sp < spawns.length; sp += 2) {
      const dx = spawns[sp]! - nx
      const dy = spawns[sp + 1]! - ny
      if (dx * dx + dy * dy < 9) throw new Error(`${name}: nest at (${nx},${ny}) is too close to a spawn`)
    }
  }

  return {
    index,
    name,
    walls,
    spawns: new Int16Array(spawns),
    openTiles: new Int32Array(open),
    doors: new Int16Array(doors),
    decor: new Int16Array(decor),
    wardrobes: new Int16Array(wardrobes),
    portals: new Int16Array(portals),
    nests: new Int16Array(nests),
  }
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
  // Furnishing: long tables in the side halls, crates around the central block.
  furn(w, 6, 10, 7, 10)
  furn(w, 32, 11, 33, 11)
  furn(w, 16, 6); furn(w, 23, 15)
  furn(w, 2, 5); furn(w, 37, 16)
  return finish(0, 'Foundry', w, [
    2, 2, 37, 2, 2, 19, 37, 19, // far corners
    19, 2, 19, 19, 2, 11, 37, 11, // edge midpoints
    14, 10, 25, 11, 9, 10, 30, 11, // around the central block
  ], [
    // Doors on the four quadrant doorways: the ambush alarm bells of this map.
    12, 3, 1, 27, 3, 1, 12, 17, 1, 27, 17, 1,
  ], [
    Decor.Rug, 5, 9, Decor.Rug, 31, 10, Decor.Rug, 18, 2,
    Decor.Lamp, 13, 2, Decor.Lamp, 26, 19, Decor.Lamp, 2, 12, Decor.Lamp, 37, 9,
    Decor.Lamp, 16, 9, Decor.Lamp, 23, 12,
    Decor.Plant, 1, 1, Decor.Plant, 38, 1, Decor.Plant, 1, 20, Decor.Plant, 38, 20,
    Decor.Plant, 7, 3, Decor.Plant, 32, 18,
    Decor.Window, 12, 5, Decor.Window, 27, 16, Decor.Window, 19, 8, Decor.Window, 20, 13,
    Decor.Window, 0, 6, Decor.Window, 39, 15,
  ], [
    // One hiding spot per quadrant.
    3, 3, 36, 3, 3, 18, 36, 18,
  ], [
    // One two-way portal linking the top and bottom mid-halls, diagonal-ish so the warp
    // is worth its cooldown.
    20, 5, 19, 16,
    19, 16, 20, 5,
  ], [
    // A nest in the top-left and bottom-right quadrant interiors — off the main halls,
    // exactly where a cornered runner is tempted to cut through.
    9, 3, 30, 18,
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
  // The courtyard map: no doors, benches along the mid lanes instead.
  furn(w, 12, 11); furn(w, 27, 11)
  return finish(1, 'Pillars', w, [
    2, 2, 37, 2, 2, 19, 37, 19,
    12, 6, 27, 6, 12, 16, 27, 16,
    20, 2, 20, 20, 2, 11, 37, 11,
  ], [], [
    Decor.Lamp, 6, 5, Decor.Lamp, 33, 5, Decor.Lamp, 6, 15, Decor.Lamp, 33, 15,
    Decor.Lamp, 20, 10,
    Decor.Plant, 3, 2, Decor.Plant, 36, 2, Decor.Plant, 3, 19, Decor.Plant, 36, 19,
    Decor.Plant, 19, 5, Decor.Plant, 20, 16,
    Decor.Window, 0, 5, Decor.Window, 39, 5, Decor.Window, 0, 16, Decor.Window, 39, 16,
  ], [
    // The courtyard keeps two garden sheds.
    7, 2, 32, 19,
  ], [
    // A two-way portal across the mid lane: the forest's fairy rings.
    6, 11, 33, 11,
    33, 11, 6, 11,
  ], [
    // The forest is the spiders' home turf: three nests guarding quiet clearings —
    // kept clear of the canonical test lanes (x3-8/y6-10 and the mid crossing).
    9, 16, 37, 15, 20, 17,
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
  // Crates tucked at lane ends, where a chase has to commit.
  furn(w, 36, 3); furn(w, 2, 6, 2, 7); furn(w, 36, 10, 36, 11); furn(w, 2, 14)
  return finish(2, 'Serpentine', w, [
    2, 2, 37, 2, 2, 19, 37, 19,
    35, 6, 4, 10, 35, 14, 10, 18,
    19, 2, 19, 6, 19, 10, 19, 18,
  ], [
    // Doors on the four shortcuts: taking the fast way through announces you.
    15, 4, 0, 23, 8, 0, 15, 12, 0, 23, 16, 0,
  ], [
    Decor.Lamp, 32, 2, Decor.Lamp, 7, 6, Decor.Lamp, 32, 10, Decor.Lamp, 7, 14, Decor.Lamp, 32, 18,
    Decor.Plant, 1, 3, Decor.Plant, 38, 6, Decor.Plant, 1, 11, Decor.Plant, 38, 14, Decor.Plant, 1, 18,
    Decor.Window, 10, 4, Decor.Window, 28, 8, Decor.Window, 10, 12, Decor.Window, 28, 16,
  ], [
    // Lane-end wardrobes: bolt-holes at the exact spots a chase corners you.
    34, 2, 5, 10, 34, 13, 5, 18,
  ], [
    // A two-way portal between the first and last lanes: the long way, skipped — with
    // the spider's webs waiting, running the comb is the risk.
    5, 2, 34, 19,
    34, 19, 5, 2,
  ])
  // No nests: the cave's monster IS the spider.
}

// ── Map 3: WARRENS — an organic field of grown pods; the alien map ───────────
const warrens = (): GameMap => {
  const w = blank()
  // No lattice, no right angles as far as the eye can wander: the hive is an open cavern
  // studded with lens-shaped pods of grown wall, so every sightline curves around a bulge
  // instead of running down a corridor.
  lens(w, 5, 3, 7, 4); lens(w, 17, 3, 5, 3); lens(w, 27, 4, 7, 4)
  lens(w, 3, 10, 5, 3); lens(w, 13, 8, 4, 3); lens(w, 19, 10, 7, 4); lens(w, 31, 10, 5, 3)
  lens(w, 6, 15, 7, 4); lens(w, 16, 17, 5, 3); lens(w, 26, 15, 7, 4)
  // Four of the big pods are hollowed: a two-tile duct bored straight through, each with a
  // membrane door — the ambush routes, and the only place a door belongs in a grown world.
  clear(w, 30, 4, 31, 7)
  clear(w, 22, 10, 23, 13)
  clear(w, 9, 15, 10, 18)
  clear(w, 29, 15, 30, 18)
  // Small budding growths along the rim: texture, and half-cover on the open runs.
  furn(w, 30, 1, 31, 1); furn(w, 24, 20, 25, 20); furn(w, 1, 6); furn(w, 38, 16)
  return finish(3, 'Warrens', w, [
    2, 2, 20, 1, 37, 2, 2, 19, 37, 19, 20, 20,
    13, 6, 26, 9, 2, 8, 37, 8, 13, 19, 26, 2,
  ], [
    // Membrane doors seal the four pod ducts — take the fast way through and it announces you.
    30, 5, 0, 22, 11, 0, 9, 16, 0, 29, 16, 0,
  ], [
    Decor.Rug, 12, 11, Decor.Rug, 23, 5, Decor.Rug, 31, 13,
    Decor.Lamp, 3, 3, Decor.Lamp, 36, 3, Decor.Lamp, 3, 18, Decor.Lamp, 36, 18, Decor.Lamp, 14, 14,
    Decor.Plant, 1, 1, Decor.Plant, 38, 1, Decor.Plant, 1, 20, Decor.Plant, 38, 20,
    Decor.Plant, 24, 8, Decor.Plant, 15, 20,
    Decor.Window, 0, 7, Decor.Window, 39, 12, Decor.Window, 12, 0, Decor.Window, 27, 21,
    Decor.Window, 7, 4, Decor.Window, 28, 5, Decor.Window, 7, 16, Decor.Window, 27, 17,
    Decor.Window, 20, 18,
  ], [
    // Cocoon pods around the rim — where hiding lives on this map.
    5, 2, 34, 2, 1, 10, 38, 10, 5, 19, 34, 19,
  ], [
    // A two-way portal between opposite reaches: the hive's transit tubes.
    14, 2, 25, 19,
    25, 19, 14, 2,
  ], [
    // Abduction UFOs hover over the open middle: the hive's grabbers. Same lair
    // mechanics as the nest spiders, drawn as saucers with tractor beams.
    20, 7, 20, 14,
  ])
}

export const MAPS: readonly GameMap[] = [foundry(), pillars(), serpentine(), warrens()]

if (MAPS.length !== MAP_COUNT) throw new Error('MAP_COUNT out of sync with MAPS')

/** Solid lookup (wall or furniture). Out-of-bounds counts as solid. */
export const isWall = (map: GameMap, tx: number, ty: number): boolean =>
  tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y || map.walls[ty * MAP_TILES_X + tx] !== 0

/** World-space centre of a wardrobe. */
export const wardrobeCenterX = (map: GameMap, i: number): number => (map.wardrobes[i * 4]! + 0.5) * MAP_TILE
export const wardrobeCenterY = (map: GameMap, i: number): number => (map.wardrobes[i * 4 + 1]! + 0.5) * MAP_TILE
/** World-space centre of a wardrobe's exit tile. */
export const wardrobeExitX = (map: GameMap, i: number): number => (map.wardrobes[i * 4 + 2]! + 0.5) * MAP_TILE
export const wardrobeExitY = (map: GameMap, i: number): number => (map.wardrobes[i * 4 + 3]! + 0.5) * MAP_TILE

/** World-space centre of a door (the midpoint of its two tiles). */
export const doorCenterX = (map: GameMap, d: number): number => {
  const tx = map.doors[d * 3]!
  return map.doors[d * 3 + 2] === 0 ? (tx + 1) * MAP_TILE : (tx + 0.5) * MAP_TILE
}
export const doorCenterY = (map: GameMap, d: number): number => {
  const ty = map.doors[d * 3 + 1]!
  return map.doors[d * 3 + 2] === 1 ? (ty + 1) * MAP_TILE : (ty + 0.5) * MAP_TILE
}

/** World-space centre of a tile. */
export const tileCenterX = (tx: number): number => (tx + 0.5) * MAP_TILE
export const tileCenterY = (ty: number): number => (ty + 0.5) * MAP_TILE
