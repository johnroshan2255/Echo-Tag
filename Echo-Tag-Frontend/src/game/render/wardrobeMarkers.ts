import {
  MAX_WARDROBES,
  NO_SLOT,
  wardrobeCenterX,
  wardrobeCenterY,
  type World,
} from '@echo-tag/shared'
import { Container, Graphics } from 'pixi.js'
import { KEY_MARKER } from '../theme.ts'

/**
 * Keyhole markers: the local player's private overlay of which wardrobes THEY can use.
 *
 * Keys are per-player information — your half of the wardrobes is not my half — so this is
 * the one piece of rendering keyed to the local slot. A small warm keyhole floats over each
 * wardrobe you hold the key to: solid when ready, dimmed to a sliver while that wardrobe is
 * refusing you (the 20s cooldown), absent where you have no key. No key, no marker: a
 * wardrobe you cannot use should read as furniture, not as a taunt.
 */

export interface MarkerLayer {
  container: Container
  markers: Graphics[]
}

export const createMarkerLayer = (): MarkerLayer => {
  const container = new Container()
  const markers: Graphics[] = []
  for (let i = 0; i < MAX_WARDROBES; i++) {
    const m = new Graphics()
    // A keyhole: circle over a wedge, drawn once; per-frame changes are transform/alpha.
    m.circle(0, -3, 5).fill({ color: KEY_MARKER })
    m.moveTo(-4, 0).lineTo(4, 0).lineTo(2, 10).lineTo(-2, 10).closePath().fill({ color: KEY_MARKER })
    m.visible = false
    container.addChild(m)
    markers.push(m)
  }
  return { container, markers }
}

export const renderMarkers = (
  layer: MarkerLayer,
  world: World,
  localSlot: number,
  nowMs: number,
): void => {
  const count = world.map.wardrobes.length / 4
  const hidden = world.hiddenIn[localSlot] !== NO_SLOT

  for (let i = 0; i < MAX_WARDROBES; i++) {
    const m = layer.markers[i]!
    if (i >= count || hidden || world.keys[localSlot * MAX_WARDROBES + i] === 0) {
      m.visible = false
      continue
    }
    m.visible = true
    m.x = wardrobeCenterX(world.map, i)
    m.y = wardrobeCenterY(world.map, i) - 56 // floats above the cabinet
    const ready = world.tick >= world.wardrobeCooldownUntil[localSlot * MAX_WARDROBES + i]!
    m.alpha = ready ? 0.75 + 0.2 * Math.sin(nowMs * 0.004) : 0.18
    m.scale.set(ready ? 1 : 0.8)
  }
}
