import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAP_COUNT, MAP_TILES_X, MAP_TILES_Y, SPAWNS_PER_MAP } from '../constants.ts'
import { MAPS, isWall } from './index.ts'

/**
 * Map authoring rules, enforced. The maps are painted in code, so a one-line edit can
 * silently disconnect a room or bury a spawn — these tests are what make the authoring
 * helpers safe to touch.
 */

describe('maps', () => {
  it(`ships exactly ${MAP_COUNT} maps with distinct names`, () => {
    assert.equal(MAPS.length, MAP_COUNT)
    assert.equal(new Set(MAPS.map((m) => m.name)).size, MAP_COUNT)
    MAPS.forEach((m, i) => assert.equal(m.index, i))
  })

  for (const map of MAPS) {
    describe(map.name, () => {
      it('is a full border-walled grid', () => {
        assert.equal(map.walls.length, MAP_TILES_X * MAP_TILES_Y)
        for (let x = 0; x < MAP_TILES_X; x++) {
          assert.ok(isWall(map, x, 0) && isWall(map, x, MAP_TILES_Y - 1), `open border at column ${x}`)
        }
        for (let y = 0; y < MAP_TILES_Y; y++) {
          assert.ok(isWall(map, 0, y) && isWall(map, MAP_TILES_X - 1, y), `open border at row ${y}`)
        }
      })

      it(`has ${SPAWNS_PER_MAP} spawns, all in open space, all spread out`, () => {
        assert.equal(map.spawns.length, SPAWNS_PER_MAP * 2)
        for (let s = 0; s < map.spawns.length; s += 2) {
          assert.ok(!isWall(map, map.spawns[s]!, map.spawns[s + 1]!), `spawn ${s / 2} in a wall`)
        }
        // Every pair at least 4 tiles apart, so no two players spawn on top of each other.
        for (let a = 0; a < map.spawns.length; a += 2) {
          for (let b = a + 2; b < map.spawns.length; b += 2) {
            const dx = map.spawns[a]! - map.spawns[b]!
            const dy = map.spawns[a + 1]! - map.spawns[b + 1]!
            assert.ok(dx * dx + dy * dy >= 16, `spawns ${a / 2} and ${b / 2} are ${Math.sqrt(dx * dx + dy * dy).toFixed(1)} tiles apart`)
          }
        }
      })

      it('is fully connected — every open tile reachable from spawn 0', () => {
        // Echoes already make temporary walls; the map itself may not add permanent traps.
        const seen = new Uint8Array(map.walls.length)
        const queue: number[] = [map.spawns[1]! * MAP_TILES_X + map.spawns[0]!]
        seen[queue[0]!] = 1
        let reached = 0
        while (queue.length > 0) {
          const t = queue.pop()!
          reached++
          const tx = t % MAP_TILES_X
          const ty = (t / MAP_TILES_X) | 0
          for (const [nx, ny] of [[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]] as const) {
            const n = ny * MAP_TILES_X + nx
            if (!isWall(map, nx, ny) && seen[n] === 0) {
              seen[n] = 1
              queue.push(n)
            }
          }
        }
        assert.equal(reached, map.openTiles.length, `${map.openTiles.length - reached} open tiles unreachable`)
      })

      it('has no dead-end cells a player could be sealed into', () => {
        // Every open tile needs at least two open orthogonal neighbours: with one, a single
        // echo trail across the mouth seals the pocket for its owner's whole 3s loop.
        for (const t of map.openTiles) {
          const tx = t % MAP_TILES_X
          const ty = (t / MAP_TILES_X) | 0
          let exits = 0
          if (!isWall(map, tx - 1, ty)) exits++
          if (!isWall(map, tx + 1, ty)) exits++
          if (!isWall(map, tx, ty - 1)) exits++
          if (!isWall(map, tx, ty + 1)) exits++
          assert.ok(exits >= 2, `tile (${tx},${ty}) has ${exits} exit`)
        }
      })

      it('leaves a majority of the grid walkable', () => {
        // A maze that is mostly wall feels cramped before echoes even accumulate.
        assert.ok(map.openTiles.length > map.walls.length * 0.6, `${map.openTiles.length} open of ${map.walls.length}`)
      })
    })
  }
})
