import { MAP_TILE, type World } from '@echo-tag/shared'
import { Container, Sprite, type Texture } from 'pixi.js'
import { DOOR_EDGE, DOOR_FILL, DOOR_THICKNESS } from '../theme.ts'

/**
 * Door rendering: two timber leaves per doorway that retract into the walls as the door
 * opens. Sprites of the shared 8px square texture, transform-only per frame — openness
 * comes straight from the simulation (`world.doorOpen`), so what you see is exactly what
 * collision does, including under prediction.
 *
 * Each leaf carries a thin lighter edge strip (a second sprite) so the door reads as a
 * built thing rather than a filled rectangle.
 */

const MAX_LEAVES = 16 // MAX_DOORS * 2

export interface DoorLayer {
  container: Container
  leaves: Sprite[]
  edges: Sprite[]
}

export const createDoorLayer = (texture: Texture): DoorLayer => {
  const container = new Container()
  const leaves: Sprite[] = []
  const edges: Sprite[] = []
  for (let i = 0; i < MAX_LEAVES; i++) {
    const leaf = new Sprite(texture)
    leaf.anchor.set(0.5)
    leaf.tint = DOOR_FILL
    leaf.visible = false
    const edge = new Sprite(texture)
    edge.anchor.set(0.5)
    edge.tint = DOOR_EDGE
    edge.visible = false
    container.addChild(leaf)
    container.addChild(edge)
    leaves.push(leaf)
    edges.push(edge)
  }
  return { container, leaves, edges }
}

export const renderDoors = (layer: DoorLayer, world: World): void => {
  const doors = world.map.doors
  const count = doors.length / 3

  for (let i = 0; i < MAX_LEAVES; i++) {
    const d = i >> 1
    const leaf = layer.leaves[i]!
    const edge = layer.edges[i]!
    if (d >= count) {
      leaf.visible = false
      edge.visible = false
      continue
    }

    const base = d * 3
    const axis = doors[base + 2]! // 0: spans x, leaves slide left/right; 1: spans y
    const side = (i & 1) === 0 ? -1 : 1
    const open = world.doorOpen[d]!

    // Leaf home: the centre of its own tile; retracts up to ~0.96 tile into the wall.
    const tx = doors[base]! + (axis === 0 ? (side === 1 ? 1 : 0) : 0)
    const ty = doors[base + 1]! + (axis === 1 ? (side === 1 ? 1 : 0) : 0)
    const slide = open * MAP_TILE * 0.96 * side

    const cx = (tx + 0.5) * MAP_TILE + (axis === 0 ? slide : 0)
    const cy = (ty + 0.5) * MAP_TILE + (axis === 1 ? slide : 0)

    leaf.visible = true
    edge.visible = true
    leaf.x = cx
    leaf.y = cy
    edge.x = cx
    edge.y = cy

    if (axis === 0) {
      leaf.width = MAP_TILE
      leaf.height = DOOR_THICKNESS
      edge.width = MAP_TILE
      edge.height = 4
      edge.y = cy - DOOR_THICKNESS / 2 + 2
    } else {
      leaf.width = DOOR_THICKNESS
      leaf.height = MAP_TILE
      edge.width = 4
      edge.height = MAP_TILE
      edge.x = cx - DOOR_THICKNESS / 2 + 2
    }
  }
}
